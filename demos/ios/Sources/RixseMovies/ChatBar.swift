// The chat bar: transcript above a composer, model switch on the left. The
// model switch only covers the two models the demo route exposes without a
// local key (gemma on the iMac, opus through its proxy).
import SwiftUI

private let MODEL_LABELS: [(id: String, label: String)] = [
  ("gemma", "Gemma 4"),
  ("opus", "Opus 5.5"),
]

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
      Divider()
      HStack(spacing: 10) {
        Picker("Model", selection: $movies.model) {
          ForEach(MODEL_LABELS, id: \.id) { m in
            Text(m.label).tag(m.id)
          }
        }
        .pickerStyle(.segmented)
        .frame(width: 190)

        TextField("Message the agent", text: $draft, axis: .vertical)
          .textFieldStyle(.roundedBorder)
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
      .padding(.horizontal, 12)
      .padding(.vertical, 8)
    }
    .background(.bar)
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
