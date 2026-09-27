// The voice-first input bar (APS 6): one floating mic, never pushing layout.
// Tap to talk (ends on silence), hold to talk (ends on release); the live
// transcript rides in a chip above the mic — tap the chip to correct the text
// before sending. Long-press the mic for the keyboard, which closes after
// sending. The model switch lives in the logs sheet.
import SwiftUI
import Rixse

struct VoiceBar: View {
  @EnvironmentObject var movies: MovieStore
  @StateObject private var voice = VoiceController()
  @State private var showTranscript = false
  @State private var tapSession = false
  @State private var pressBegan: Date?
  @State private var draft: String?
  @State private var utterance: VoiceUtterance?
  @State private var keyboardOpen = false
  @State private var keyboardDraft = ""
  @FocusState private var typing: Bool

  var body: some View {
    VStack(spacing: 8) {
      if showTranscript {
        TranscriptView()
          .frame(maxHeight: 280)
          .transition(.move(edge: .bottom).combined(with: .opacity))
      }
      if let draft {
        chip(text: draft, correctable: true)
      } else if voice.recording && !voice.liveTranscript.isEmpty {
        chip(text: voice.liveTranscript, correctable: false)
      }
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
        micRow
      }
    }
    .background(Color.clear)
    .task { await voice.prepare() }
    .onAppear { voice.onSilence = endTapSession }
  }

  // MARK: mic

  private var micRow: some View {
    ZStack {
      HStack {
        Button {
          withAnimation { showTranscript.toggle() }
        } label: {
          Image(systemName: showTranscript ? "chevron.down" : "chevron.up")
        }
        .buttonStyle(.borderless)
        .disabled(movies.turns.isEmpty)
        .accessibilityLabel(showTranscript ? "Hide transcript" : "Show transcript")
        Spacer()
      }
      micButton
    }
    .padding(.horizontal, 16)
    .padding(.vertical, 8)
  }

  private var micButton: some View {
    let available = voice.status == .ready
    return Image(systemName: voice.recording ? "mic.fill" : "mic")
      .font(.title2.weight(.semibold))
      .foregroundStyle(.white)
      .frame(width: 60, height: 60)
      .background(voice.recording ? Color.red : available ? Color.accentColor : Color.gray)
      .clipShape(Circle())
      .shadow(color: .black.opacity(0.18), radius: 8, y: 2)
      .scaleEffect(voice.recording ? 1.08 : 1)
      .contentShape(Circle())
      .gesture(
        DragGesture(minimumDistance: 0)
          .onChanged { _ in
            guard pressBegan == nil else { return }
            pressBegan = Date()
            if available { voice.start(tracking: movies) }
          }
          .onEnded { _ in
            let held = Date().timeIntervalSince(pressBegan ?? Date())
            pressBegan = nil
            // With no on-device recognition the mic is off; any press explains
            // itself, and typing is one gesture away.
            guard available else { keyboardOpen = true; return }
            if voice.heardSpeech {
              // Hold-to-talk ends on release and sends; a tap session ends on
              // a second tap and waits in the chip for a correction or a send.
              let sendNow = !tapSession
              tapSession = false
              finishVoice(sendImmediately: sendNow)
            } else if held >= 0.6 {
              // A long hold with nothing said is the keyboard request.
              voice.cancel()
              tapSession = false
              keyboardOpen = true
            } else if tapSession {
              tapSession = false
              finishVoice(sendImmediately: false)
            } else {
              // A short tap starts tap-to-talk; it ends on silence.
              tapSession = true
            }
          }
      )
      .accessibilityLabel("Microphone")
      .accessibilityIdentifier("micButton")
  }

  /// Tap-to-talk ends on silence: the transcript waits in the chip.
  private func endTapSession() {
    tapSession = false
    finishVoice(sendImmediately: false)
  }

  private func finishVoice(sendImmediately: Bool) {
    guard let heard = voice.finish() else { return }
    if sendImmediately {
      send(heard, text: heard.transcript)
    } else {
      utterance = heard
      draft = heard.transcript
    }
  }

  // MARK: transcript chip

  private func chip(text: String, correctable: Bool) -> some View {
    HStack(spacing: 8) {
      Button {
        guard correctable else { return }
        keyboardDraft = draft ?? text
        draft = nil
        utterance = nil
        keyboardOpen = true
      } label: {
        HStack(spacing: 6) {
          Image(systemName: correctable ? "text.bubble" : "waveform")
            .foregroundStyle(.secondary)
          Text(text)
            .font(.callout)
            .multilineTextAlignment(.leading)
            .lineLimit(3)
          if correctable {
            Image(systemName: "pencil")
              .font(.caption)
              .foregroundStyle(.secondary)
          }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 10)
        .background(.regularMaterial)
        .clipShape(RoundedRectangle(cornerRadius: 16))
        .shadow(color: .black.opacity(0.1), radius: 6, y: 2)
      }
      .buttonStyle(.plain)
      .accessibilityIdentifier("transcriptChip")
      if correctable {
        Button {
          if let utterance { send(utterance, text: draft ?? utterance.transcript) }
          draft = nil
          utterance = nil
        } label: {
          Image(systemName: "arrow.up.circle.fill")
            .font(.title2)
        }
        .disabled(movies.busy)
        .accessibilityLabel("Send")
        .accessibilityIdentifier("chipSend")
      }
    }
    .padding(.horizontal, 16)
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
    showTranscript = true
    Task { await movies.send(text) }
  }

  // MARK: sending a voice turn

  private func send(_ heard: VoiceUtterance, text: String) {
    let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !trimmed.isEmpty else { return }
    showTranscript = true
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

// MARK: chat history

private struct TranscriptView: View {
  @EnvironmentObject var movies: MovieStore

  var body: some View {
    ScrollViewReader { proxy in
      ScrollView {
        LazyVStack(alignment: .leading, spacing: 8) {
          ForEach(movies.turns) { turn in
            TurnBubble(turn: turn)
              .id(turn.id)
          }
          if movies.busy {
            Text("thinking…")
              .font(.callout)
              .foregroundStyle(.secondary)
              .frame(maxWidth: .infinity, alignment: .leading)
          }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
      }
      .background(.bar)
      .onChange(of: movies.turns.count) { _, _ in
        if let last = movies.turns.last { proxy.scrollTo(last.id, anchor: .bottom) }
      }
    }
  }
}

private struct TurnBubble: View {
  let turn: ChatTurn

  var body: some View {
    HStack {
      if turn.role == "user" { Spacer(minLength: 40) }
      VStack(alignment: .leading, spacing: 2) {
        Text(turn.content)
          .font(.callout)
          .foregroundStyle(turn.role == "user" ? .white : .primary)
        if let footnote = turn.footnote {
          Text(footnote)
            .font(.caption2)
            .foregroundStyle(turn.role == "user" ? .white.opacity(0.8) : .secondary)
        }
      }
      .padding(.horizontal, 12)
      .padding(.vertical, 8)
      .background(turn.role == "user" ? Color.accentColor : Color(.secondarySystemBackground))
      .clipShape(RoundedRectangle(cornerRadius: 14))
      if turn.role != "user" { Spacer(minLength: 40) }
    }
  }
}
