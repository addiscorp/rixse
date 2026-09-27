// The observable face of the rixse store for SwiftUI. All writes go through
// dispatch — the same door for the user and the agent (APS 2).
import Foundation
import Rixse
import SwiftUI

struct LogNote: Identifiable {
  enum Kind { case applied, rejected, undone, agent, error }
  let id = UUID()
  let kind: Kind
  let text: String
  let author: Author?
}

struct ChatTurn: Identifiable {
  let id = UUID()
  let role: String // "user" | "assistant"
  var content: String
  var footnote: String?
}

@MainActor
final class MovieStore: ObservableObject {
  @Published private(set) var state: ViewportState
  @Published private(set) var log: [LogEntry]
  @Published private(set) var notes: [LogNote] = []
  @Published var turns: [ChatTurn] = []
  @Published var busy = false
  @Published var model = "gemma"
  /// Script progress, mirrored to a hidden view so UI tests can wait on it.
  @Published var scriptStatus = ""

  let catalogue: MoviesCatalogue
  let engine: Zega

  private var unsubscribe: (() -> Void)?

  init(catalogue: MoviesCatalogue) {
    self.catalogue = catalogue
    engine = catalogue.engine
    state = catalogue.store.state
    log = catalogue.store.log
    unsubscribe = catalogue.store.subscribe { [weak self] event, state in
      guard let self else { return }
      Task { @MainActor in
        self.state = state
        self.log = self.catalogue.store.log
        switch event {
        case .applied(let e):
          self.note(.applied, "\(e.type) — \(e.author.rawValue)\(e.why.map { " · “\($0)”" } ?? "")", e.author)
        case .rejected(let action, let author, let error):
          self.note(.rejected, "\(action.type) — \(author.rawValue): \(error)", author)
        case .undone(let e):
          self.note(.undone, "\(e.type) — was \(e.author.rawValue)", e.author)
        }
      }
    }
  }

  deinit { unsubscribe?() }

  @discardableResult
  func dispatch(_ action: Action, _ author: Author, why: String? = nil) -> DispatchResult {
    do {
      return try catalogue.store.dispatch(action, author: author, why: why)
    } catch {
      note(.error, "dispatch failed: \(error)", nil)
      return .rejected("\(error)")
    }
  }

  func undo() {
    _ = catalogue.store.undo()
  }

  func note(_ kind: LogNote.Kind, _ text: String, _ author: Author? = nil) {
    notes.append(LogNote(kind: kind, text: text, author: author))
    if notes.count > 200 { notes.removeFirst(notes.count - 200) }
  }

  /// What "this"/"these" refer to right now, attached to the message itself (APS 2).
  var focusText: String {
    guard let selection = state.selection, !selection.items.isEmpty else { return "" }
    let names = selection.items.map { item -> String in
      if item.contains(" > ") {
        return "the link \(item.replacingOccurrences(of: #"(person|movie|other):"#, with: "", options: .regularExpression))"
      }
      let type = item.split(separator: ":").first.map(String.init) ?? ""
      let name = item.replacingOccurrences(of: #"^(person|movie|other):"#, with: "", options: .regularExpression)
      return "\(name) (\(type))"
    }
    return "The user has selected: \(names.joined(separator: ", ")). \"this\", \"these\", \"them\" and \"the selected\" mean exactly these, not anything from earlier turns."
  }

  var wireContext: String { catalogue.wire.encode(state) }
  var legend: String { catalogue.wire.legend() }
  var vocabulary: String { catalogue.store.vocabulary() }
  var brief: String { catalogue.brief }

  func resolveWithWire(_ action: Action) -> Action {
    guard let params = catalogue.store.params(action.type) else { return action }
    return catalogue.wire.resolve(action, params: params)
  }
}
