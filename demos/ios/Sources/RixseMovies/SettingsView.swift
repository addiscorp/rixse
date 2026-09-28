// The Settings sheet (rixse#9, APS 6): the conversation gets out of the way —
// the canvas owns the screen, and everything else lives behind the gear:
// Undo of the last agent change, the model switch, the conversation history,
// and the logs and latency lines (kind, author, text) the logs sheet had.
import SwiftUI
import Rixse

struct SettingsView: View {
  @EnvironmentObject var movies: MovieStore
  @Environment(\.dismiss) private var dismiss

  var body: some View {
    NavigationStack {
      List {
        Section {
          Button { movies.undo() } label: {
            Label("Undo last change", systemImage: "arrow.uturn.backward")
          }
          .disabled(!movies.log.contains { !$0.undone })
          .accessibilityIdentifier("undoRow")
        }
        Section("Model") {
          Picker("Model", selection: $movies.model) {
            Text("Gemma 4").tag("gemma")
            Text("Opus 5.5").tag("opus")
          }
          .pickerStyle(.segmented)
        }
        Section("Conversation (\(movies.turns.count))") {
          ForEach(movies.turns) { turn in
            TurnBubble(turn: turn)
              .listRowSeparator(.hidden)
          }
        }
        Section("Action log (\(movies.log.count))") {
          ForEach(movies.log.reversed(), id: \.seq) { entry in
            HStack(alignment: .top, spacing: 8) {
              Image(systemName: entry.undone ? "arrow.uturn.backward" : "checkmark.circle")
                .foregroundStyle(entry.undone ? Color.secondary : Color.green)
                .accessibilityHidden(true)
              VStack(alignment: .leading, spacing: 2) {
                Text("#\(entry.seq) \(entry.type) — \(entry.author.rawValue)")
                  .font(.callout)
                  .strikethrough(entry.undone)
                if let why = entry.why {
                  Text(why)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                }
              }
            }
          }
        }
        Section("Notes (\(movies.notes.count))") {
          ForEach(movies.notes.reversed()) { note in
            HStack(alignment: .top, spacing: 8) {
              Image(systemName: icon(note.kind))
                .foregroundStyle(color(note.kind))
                .accessibilityHidden(true)
              Text(note.text)
                .font(.caption)
            }
          }
        }
      }
      .listStyle(.insetGrouped)
      .navigationTitle("Settings")
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .topBarTrailing) {
          Button("Done") { dismiss() }
        }
      }
    }
  }

  private func icon(_ kind: LogNote.Kind) -> String {
    switch kind {
    case .applied: return "checkmark.circle"
    case .rejected: return "xmark.circle"
    case .undone: return "arrow.uturn.backward"
    case .agent: return "bubble.left"
    case .error: return "exclamationmark.triangle"
    }
  }

  private func color(_ kind: LogNote.Kind) -> Color {
    switch kind {
    case .applied: return .green
    case .rejected: return .orange
    case .undone: return .secondary
    case .agent: return .accentColor
    case .error: return .red
    }
  }
}

/// One conversation turn, user right / agent left — inside Settings now, never
/// over the canvas.
struct TurnBubble: View {
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
