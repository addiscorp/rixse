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

/// The latest message and the agent's short reply — the ephemeral line above
/// the mic reads this (APS 6). A new id per message so repeat sends re-fire.
struct ChatExchange: Equatable {
  let id = UUID()
  var sent: String
  var reply: String?
}

/// The component the agent just added or changed — the viewport scrolls it
/// into view and highlights it. A new id per change so repeat changes re-fire.
struct ViewChange: Equatable {
  let id = UUID()
  let view: String
}

@MainActor
final class MovieStore: ObservableObject {
  @Published private(set) var state: ViewportState
  @Published private(set) var log: [LogEntry]
  @Published private(set) var notes: [LogNote] = []
  @Published var turns: [ChatTurn] = []
  @Published var busy = false
  @Published var model = "gemma"
  /// The latest sent message + the agent's reply, for the ephemeral line.
  @Published var lastExchange: ChatExchange?
  /// The component the agent last added or changed (scroll + highlight).
  @Published private(set) var lastChange: ViewChange?
  /// Set while a changed component shows its highlight ring.
  @Published private(set) var highlightedView: String?
  /// Script progress, mirrored to a hidden view so UI tests can wait on it.
  @Published var scriptStatus = ""

  private var highlightTask: Task<Void, Never>?

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
      let result = try catalogue.store.dispatch(action, author: author, why: why)
      // An agent change to a component scrolls it into view and highlights
      // it: the newest answer is what you see (APS 6). view.add/move/resize/
      // remove carry "id", select.set carries "view".
      if result.ok, author == .agent,
         let view = action.payload["id"]?.stringValue ?? action.payload["view"]?.stringValue {
        lastChange = ViewChange(view: view)
        highlightTask?.cancel()
        highlightedView = view
        highlightTask = Task { @MainActor [weak self] in
          try? await Task.sleep(for: .milliseconds(1600))
          guard !Task.isCancelled, let self, self.highlightedView == view else { return }
          self.highlightedView = nil
        }
      }
      return result
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
    return "\(selectionIntentText(selection)) \"this\", \"these\", \"them\" and \"the selected\" mean exactly these, not anything from earlier turns."
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
