// The logs sheet: every store event and agent note, newest first, with the
// same information the web demo's Logs pane shows (kind, author, text).
import SwiftUI
import Rixse

struct LogsView: View {
  @EnvironmentObject var movies: MovieStore
  @Environment(\.dismiss) private var dismiss

  var body: some View {
    NavigationStack {
      List {
        Section("Model") {
          Picker("Model", selection: $movies.model) {
            Text("Gemma 4").tag("gemma")
            Text("Opus 5.5").tag("opus")
          }
          .pickerStyle(.segmented)
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
      .navigationTitle("Logs")
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
