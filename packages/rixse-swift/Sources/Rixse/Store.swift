// rixse core: one state, two authors.
//
//   ui     = view(state)
//   state' = apply(state, action)   — the human and the agent both write here
//
// The agent never touches state directly: it proposes actions from the same
// typed vocabulary the UI uses. Every applied action is logged with its author,
// so the log is the record of what the agent touched, and undo works for both.
//
// This is the Swift port of packages/rixse/src/index.js, held to it by the
// shared vectors in conformance/ — same semantics, same rejection texts.
import Foundation

/// A rejection with a reason the log (and the agent) can read. Throw it from `apply`.
public struct Rejected: Error, Equatable, Sendable, CustomStringConvertible {
  public let message: String
  public init(_ message: String) { self.message = message }
  public var description: String { message }
}

/// A wrong definition (unknown size, missing source…), like JS throwing a plain Error at definition time.
public struct DefinitionError: Error, Equatable, Sendable, CustomStringConvertible {
  public let message: String
  public init(_ message: String) { self.message = message }
  public var description: String { message }
}

public enum ParamType: Equatable, Sendable {
  case string, number, boolean, `enum`([String])

  /// The name the vocabulary and catalogue use.
  public var text: String {
    switch self {
    case .string: return "string"
    case .number: return "number"
    case .boolean: return "boolean"
    case .enum: return "enum"
    }
  }
}

public struct Param: Equatable, Sendable {
  public var type: ParamType
  public var optional: Bool
  public var describe: String?
  public var ref: String?
  /// nil means the parameter has no default (JS: no `default` key).
  public var `default`: JSONValue?

  public init(type: ParamType, optional: Bool = false, describe: String? = nil, ref: String? = nil, default: JSONValue? = nil) {
    self.type = type
    self.optional = optional
    self.describe = describe
    self.ref = ref
    self.default = `default`
  }
}

/// Named parameters in definition order — order is part of the vocabulary text,
/// exactly like JS object key order.
public struct Params: Equatable, Sendable {
  public struct Entry: Equatable, Sendable {
    public let name: String
    public var param: Param
    public init(_ name: String, _ param: Param) {
      self.name = name
      self.param = param
    }
  }

  public private(set) var entries: [Entry]

  public init(_ entries: [(String, Param)] = []) {
    self.entries = entries.map(Entry.init)
  }

  public subscript(name: String) -> Param? {
    entries.first { $0.name == name }?.param
  }

  public func contains(_ name: String) -> Bool { self[name] != nil }
  public var names: [String] { entries.map(\.name) }
  public var isEmpty: Bool { entries.isEmpty }

  public mutating func append(_ name: String, _ param: Param) {
    entries.append(Entry(name, param))
  }
}

public enum Author: String, Sendable {
  case you, agent
}

/// One action as it crosses the door: a type and a payload object.
public struct Action: Equatable, Sendable {
  public var type: String
  public var payload: JSONValue
  public init(_ type: String, payload: JSONValue = .object([])) {
    self.type = type
    self.payload = payload
  }
}

public struct ActionDef<State>: Sendable {
  public var type: String
  public var describe: String
  public var params: Params
  public var apply: @Sendable (State, JSONValue) throws -> State

  public init(type: String, describe: String, params: Params, apply: @escaping @Sendable (State, JSONValue) throws -> State) {
    self.type = type
    self.describe = describe
    self.params = params
    self.apply = apply
  }
}

public func defineAction<State>(_ type: String, describe: String, params: Params, apply: @escaping @Sendable (State, JSONValue) throws -> State) -> ActionDef<State> {
  ActionDef(type: type, describe: describe, params: params, apply: apply)
}

/// A log entry. `at` is wall-clock and never part of a conformance vector.
public struct LogEntry: Sendable {
  public let seq: Int
  public let at: Date
  public let author: Author
  public let type: String
  public let payload: JSONValue
  public let why: String?
  public var undone: Bool
}

extension LogEntry: Equatable {
  public static func == (a: LogEntry, b: LogEntry) -> Bool {
    a.seq == b.seq && a.author == b.author && a.type == b.type && a.payload == b.payload && a.why == b.why && a.undone == b.undone
  }
}

public enum StoreEvent: Sendable {
  case applied(LogEntry)
  case rejected(Action, Author, String)
  case undone(LogEntry)
}

public enum DispatchResult: Sendable {
  case applied(LogEntry)
  case rejected(String)

  public var ok: Bool { if case .applied = self { return true }; return false }
  public var entry: LogEntry? { if case .applied(let e) = self { return e }; return nil }
  public var error: String? { if case .rejected(let e) = self { return e }; return nil }
}

/// Payload validation against a parameter spec; returns the rejection reason or nil.
public func validate(_ params: Params, _ payload: JSONValue) -> String? {
  guard case .object(let pairs) = payload else { return "payload must be an object" }
  for pair in pairs where !params.contains(pair.key) {
    return "unknown field \"\(pair.key)\""
  }
  for entry in params.entries {
    let name = entry.name
    let p = entry.param
    let v = payload[name]
    if v == nil || v == .null {
      if p.optional { continue }
      return "missing \"\(name)\""
    }
    switch p.type {
    case .enum(let values):
      guard case .string(let s) = v!, values.contains(s) else {
        return "\"\(name)\" must be one of \(values.joined(separator: ", "))"
      }
    case .number:
      guard case .number = v! else { return "\"\(name)\" must be a number" }
    case .string:
      guard case .string = v! else { return "\"\(name)\" must be a string" }
    case .boolean:
      guard case .bool = v! else { return "\"\(name)\" must be a boolean" }
    }
  }
  return nil
}

/// The store: dispatch is the only door, the log is authored, undo walks back
/// the latest action in effect, whoever made it. Never throws a Rejected — a
/// bad action is a logged rejection; any other error from `apply` propagates,
/// exactly like the JS core.
public final class Store<State> {
  public private(set) var state: State
  public private(set) var log: [LogEntry] = []
  private var before: [Int: State] = [:]
  private var seq = 0
  private var listeners: [UUID: (StoreEvent, State) -> Void] = [:]
  private let defs: [String: ActionDef<State>]
  private let orderedActions: [ActionDef<State>]

  public init(initial: State, actions: [ActionDef<State>]) {
    state = initial
    orderedActions = actions
    var d: [String: ActionDef<State>] = [:]
    for a in actions { d[a.type] = a }
    defs = d
  }

  @discardableResult
  public func subscribe(_ fn: @escaping (StoreEvent, State) -> Void) -> () -> Void {
    let id = UUID()
    listeners[id] = fn
    return { [weak self] in self?.listeners[id] = nil }
  }

  private func emit(_ e: StoreEvent) {
    for fn in listeners.values { fn(e, state) }
  }

  /// Apply one action. A bad action is a logged rejection, never a throw
  /// (except a non-Rejected error from `apply`, which propagates like JS).
  @discardableResult
  public func dispatch(_ action: Action, author: Author, why: String? = nil) throws -> DispatchResult {
    let reject: (String) -> DispatchResult = { error in
      self.emit(.rejected(action, author, error))
      return .rejected(error)
    }
    guard let def = defs[action.type] else { return reject("unknown action \"\(action.type)\"") }
    if let invalid = validate(def.params, action.payload) { return reject(invalid) }
    let next: State
    do {
      next = try def.apply(state, action.payload)
    } catch let r as Rejected {
      return reject(r.message)
    }
    seq += 1
    let entry = LogEntry(seq: seq, at: Date(), author: author, type: def.type, payload: action.payload, why: why, undone: false)
    before[entry.seq] = state
    state = next
    log.append(entry)
    emit(.applied(entry))
    return .applied(entry)
  }

  /// An action's parameter definitions (e.g. for translating wire handles), or nil.
  public func params(_ type: String) -> Params? { defs[type]?.params }

  /// Undo the latest action that is still in effect, whoever made it.
  @discardableResult
  public func undo() -> LogEntry? {
    guard let i = log.lastIndex(where: { !$0.undone }) else { return nil }
    // Everything after it was undone already, so its "before" is exact.
    state = before[log[i].seq]!
    log[i].undone = true
    emit(.undone(log[i]))
    return log[i]
  }

  /// The vocabulary, written for a model: what it may propose.
  public func vocabulary() -> String {
    orderedActions.map { a in
      let fields = a.params.entries.map { e -> String in
        let t: String
        switch e.param.type {
        case .enum(let values): t = values.map { jsQuote($0) }.joined(separator: " | ")
        default: t = e.param.type.text
        }
        return "\(e.name)\(e.param.optional ? "?" : ""): \(t)\(e.param.describe.map { " — \($0)" } ?? "")"
      }
      return "\(a.type) { \(fields.joined(separator: "; ")) } — \(a.describe)"
    }.joined(separator: "\n")
  }

  /// Apply an agent's proposal in order. Each action succeeds or is rejected
  /// on its own; the results go back to the agent on its next turn.
  @discardableResult
  public func applyProposal(_ proposed: [Action], why: String? = nil) throws -> [(action: Action, result: DispatchResult)] {
    try proposed.map { ($0, try dispatch($0, author: .agent, why: why)) }
  }
}
