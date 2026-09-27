// The chat bar: a floating composer at the bottom — the message field gets
// the full width; the transcript rides above it when open. The model switch
// lives in the logs sheet.
import SwiftUI

struct ChatBar: View {
  @EnvironmentObject var movies: MovieStore
  @State private var draft = ""
  @State private var showTranscript = false
  @FocusState private var composing: Bool

  var body: some View {
    VStack(spacing: 0) {
      if showTranscript {
        TranscriptView()
          .frame(maxHeight: 280)
          .transition(.move(edge: .bottom).combined(with: .opacity))
      }
      HStack(spacing: 10) {
        TextField("Message the agent", text: $draft, axis: .vertical)
          .textFieldStyle(.plain)
          .lineLimit(1...3)
          .focused($composing)
          .onSubmit(send)
          .disabled(movies.busy)

        Button {
          withAnimation { showTranscript.toggle() }
        } label: {
          Image(systemName: showTranscript ? "chevron.down" : "chevron.up")
        }
        .buttonStyle(.borderless)
        .disabled(movies.turns.isEmpty)
        .accessibilityLabel(showTranscript ? "Hide transcript" : "Show transcript")

        Button(action: send) {
          Image(systemName: "arrow.up.circle.fill")
            .font(.title2)
        }
        .disabled(movies.busy || draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
        .accessibilityLabel("Send")
      }
      .padding(.horizontal, 14)
      .padding(.vertical, 10)
      .background(.regularMaterial)
      .clipShape(RoundedRectangle(cornerRadius: 20))
      .shadow(color: .black.opacity(0.12), radius: 8, y: 2)
      .padding(.horizontal, 12)
      .padding(.vertical, 8)
    }
    .background(Color.clear)
  }

  private func send() {
    let text = draft
    guard !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return }
    draft = ""
    showTranscript = true
    Task { await movies.send(text) }
  }
}

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
