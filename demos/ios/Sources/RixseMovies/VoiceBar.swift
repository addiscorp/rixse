// The voice-first input (APS 6, rixse#9): one mic in the bottom safe area on
// an opaque strip — the canvas is never under it. Tap to talk: end of speech
// sends by itself. Hold to talk: release sends. One ephemeral line above the
// mic — the live transcript while listening, then the sent text, then the
// agent's short reply, which fades after ~4 s or on a tap. Correcting means
// saying it again, or typing via long-press. History lives in Settings.
import SwiftUI
import Rixse

struct VoiceBar: View {
  @EnvironmentObject var movies: MovieStore
  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  @StateObject private var voice = VoiceController()
  @State private var tapSession = false
  @State private var pressBegan: Date?
  @State private var keyboardOpen = false
  @State private var keyboardDraft = ""
  @State private var replyVisible = false
  @State private var replyFade: Task<Void, Never>?
  @State private var pulse = false
  @FocusState private var typing: Bool

  var body: some View {
    VStack(spacing: 8) {
      ephemeralLine
      if case .unavailable(let why) = voice.status {
        Text(why)
          .font(.caption2)
          .foregroundStyle(.secondary)
          .multilineTextAlignment(.center)
          .padding(.horizontal, 24)
          .accessibilityIdentifier("voiceUnavailable")
      }
      if keyboardOpen {
        keyboardBar
      } else {
        micButton
          .frame(maxWidth: .infinity)
          .padding(.horizontal, 16)
          .padding(.vertical, 8)
      }
    }
    .padding(.top, 4)
    .frame(maxWidth: .infinity)
    // Opaque: component content scrolls into this safe-area strip otherwise.
    .background(Color(uiColor: .systemGroupedBackground))
    .task { await voice.prepare() }
    .onAppear { voice.onEndOfSpeech = autoSend }
    .onChange(of: movies.lastExchange) { _, exchange in
      replyFade?.cancel()
      guard let exchange, exchange.reply != nil else { replyVisible = false; return }
      replyVisible = true
      replyFade = Task { @MainActor in
        try? await Task.sleep(for: .seconds(4))
        guard !Task.isCancelled else { return }
        withAnimation { replyVisible = false }
      }
    }
  }

  // MARK: the one ephemeral line

  @ViewBuilder
  private var ephemeralLine: some View {
    if voice.recording, !voice.liveTranscript.isEmpty {
      line(text: voice.liveTranscript, icon: "waveform")
    } else if let exchange = movies.lastExchange {
      if let reply = exchange.reply, replyVisible {
        line(text: reply, icon: "bubble.left")
          .onTapGesture { dismissReply() }
      } else if exchange.reply == nil {
        line(text: exchange.sent, icon: "checkmark")
      }
    }
  }

  private func line(text: String, icon: String) -> some View {
    HStack(spacing: 6) {
      Image(systemName: icon)
        .foregroundStyle(.secondary)
      Text(text)
        .font(.callout)
        .multilineTextAlignment(.leading)
        .lineLimit(2)
        .accessibilityIdentifier("voiceLine")
    }
    .padding(.horizontal, 14)
    .padding(.vertical, 10)
    .background(.regularMaterial)
    .clipShape(RoundedRectangle(cornerRadius: 16))
    .shadow(color: .black.opacity(0.1), radius: 6, y: 2)
    .padding(.horizontal, 16)
    .transition(.opacity)
  }

  private func dismissReply() {
    replyFade?.cancel()
    withAnimation { replyVisible = false }
  }

  // MARK: mic — idle / listening / thinking at a glance

  private var micButton: some View {
    let available = voice.status == .ready
    return ZStack {
      if voice.recording {
        // Live input level: the ring scales with the audio RMS (smoothed in
        // MicLevel). Reduce Motion: a gentle pulse instead of movement.
        Circle()
          .stroke(Color.red.opacity(reduceMotion ? 1 : voice.micLevel.ringOpacity), lineWidth: 3)
          .frame(width: 60, height: 60)
          .scaleEffect(reduceMotion ? 1 : voice.micLevel.ringScale)
          .opacity(reduceMotion ? (pulse ? 0.25 : 0.6) : 1)
          .animation(reduceMotion ? .easeInOut(duration: 0.9).repeatForever(autoreverses: true) : nil, value: pulse)
          .onAppear { pulse = true }
          .onDisappear { pulse = false }
      }
      Image(systemName: voice.recording ? "mic.fill" : "mic")
        .font(.title2.weight(.semibold))
        .foregroundStyle(.white)
        .frame(width: 60, height: 60)
        .background(voice.recording ? Color.red : available ? Color.accentColor : Color.gray)
        .clipShape(Circle())
      if movies.busy {
        // Sending/thinking, until the agent answers.
        Circle()
          .fill(Color(uiColor: .systemGroupedBackground).opacity(0.7))
          .frame(width: 60, height: 60)
        ProgressView()
          .accessibilityIdentifier("micBusy")
      }
    }
    .shadow(color: .black.opacity(0.18), radius: 8, y: 2)
    .contentShape(Circle())
    .gesture(
      DragGesture(minimumDistance: 0)
        .onChanged { _ in
          guard pressBegan == nil else { return }
          pressBegan = Date()
          dismissReply()
          if available { voice.start(tracking: movies) }
        }
        .onEnded { _ in
          let held = Date().timeIntervalSince(pressBegan ?? Date())
          pressBegan = nil
          // With no on-device recognition the mic is off; any press explains
          // itself, and typing is one gesture away.
          guard available else { keyboardOpen = true; return }
          if voice.heardSpeech {
            // Hold-to-talk ends on release and sends; a second tap ends the
            // tap session and sends. End of speech sends by itself too.
            tapSession = false
            finishVoice()
          } else if held >= 0.6 {
            // A long hold with nothing said is the keyboard request.
            voice.cancel()
            tapSession = false
            keyboardOpen = true
          } else if tapSession {
            // A second tap with nothing heard: stop, nothing to send.
            tapSession = false
            voice.cancel()
          } else {
            // A short tap starts tap-to-talk; end of speech sends it.
            tapSession = true
          }
        }
    )
    .accessibilityLabel("Microphone")
    .accessibilityIdentifier("micButton")
  }

  /// End of speech: the transcript sends as heard — no send-or-correct wait.
  /// Correcting means saying it again ("no, the 2014 one") or long-pressing
  /// to type.
  private func autoSend(_ heard: VoiceUtterance) {
    tapSession = false
    send(heard, text: heard.transcript)
  }

  private func finishVoice() {
    guard let heard = voice.finish() else { return }
    send(heard, text: heard.transcript)
  }

  // MARK: keyboard on request

  private var keyboardBar: some View {
    HStack(spacing: 10) {
      TextField("Type to the agent", text: $keyboardDraft, axis: .vertical)
        .textFieldStyle(.plain)
        .lineLimit(1...3)
        .focused($typing)
        .onSubmit(sendKeyboard)
        .disabled(movies.busy)
        .accessibilityIdentifier("keyboardField")
      Button {
        keyboardDraft = ""
        keyboardOpen = false
      } label: {
        Image(systemName: "xmark")
      }
      .buttonStyle(.borderless)
      .accessibilityLabel("Close keyboard")
      Button(action: sendKeyboard) {
        Image(systemName: "arrow.up.circle.fill")
          .font(.title2)
      }
      .disabled(movies.busy || keyboardDraft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
      .accessibilityLabel("Send")
    }
    .padding(.horizontal, 14)
    .padding(.vertical, 10)
    .background(.regularMaterial)
    .clipShape(RoundedRectangle(cornerRadius: 20))
    .shadow(color: .black.opacity(0.12), radius: 8, y: 2)
    .padding(.horizontal, 12)
    .padding(.vertical, 8)
    .onAppear { typing = true }
  }

  private func sendKeyboard() {
    let text = keyboardDraft.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !text.isEmpty else { return }
    keyboardDraft = ""
    keyboardOpen = false // the keyboard closes after sending (APS 6)
    Task { await movies.send(text) }
  }

  // MARK: sending a voice turn

  private func send(_ heard: VoiceUtterance, text: String) {
    let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !trimmed.isEmpty else { return }
    if trimmed == heard.transcript {
      // Unedited: pair each deictic word with the selection in effect when it
      // was spoken, in APS 2's "The user has selected: …" form. With no
      // deictic words the end selection attaches like a typed message.
      let pairings = pairDeictics(words: heard.words, timeline: heard.timeline)
      let message = voiceMessage(trimmed, pairings: pairings)
      movies.note(.agent, "🎙 “\(trimmed)”\(pairings.isEmpty ? "" : " — \(pairings.count) deictic word\(pairings.count == 1 ? "" : "s") paired by time")")
      Task { await movies.send(message, attachSelection: pairings.isEmpty, speechEnd: heard.speechEnd) }
    } else {
      // Corrected text has no word timings — it goes as a typed message.
      Task { await movies.send(trimmed) }
    }
  }
}
