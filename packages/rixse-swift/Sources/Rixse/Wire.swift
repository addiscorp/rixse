// rixse wire: the compact form of state a model reads (APS 2; bench v1 measured
// it at ~43% fewer tokens than JSON and ~31× fewer than RSC Flight, with no loss
// of accuracy). The app declares its entities once; rixse gives every item a
// short session handle (c1, l2…), writes one schema line per type, then one row
// per item. Required fields are positional; optional fields appear as
// name=value only when they differ from their default. Handles stay stable for
// the whole session, so the model can refer back to earlier turns.
//
// Swift port of packages/rixse/src/wire.js, held to it by conformance/.

/// One field of a wire entity. A nil `default` marks a required (positional)
/// field; a field with a default only appears when its value differs.
public struct WireFieldSpec: Equatable, Sendable {
  public var name: String
  public var ref: String?
  public var `default`: JSONValue?

  public init(name: String, ref: String? = nil, default: JSONValue? = nil) {
    self.name = name
    self.ref = ref
    self.default = `default`
  }
}

public struct WireEntitySpec: Equatable, Sendable {
  public var type: String
  /// The field holding the real id handles are assigned for (JS `id`). nil = no handle column.
  public var idField: String?
  public var fields: [WireFieldSpec]

  public init(type: String, idField: String? = nil, fields: [WireFieldSpec]) {
    self.type = type
    self.idField = idField
    self.fields = fields
  }
}

/// One materialised row: the values each field reads, with `get` already applied.
public struct WireRow: Sendable {
  public var id: String?
  public var values: [String: JSONValue]

  public init(id: String? = nil, values: [String: JSONValue]) {
    self.id = id
    self.values = values
  }
}

/// A value as the model reads it: numbers and plain words bare, other strings JSON-quoted.
private func wireShow(_ value: JSONValue) -> String {
  switch value {
  case .number(let d): return jsNumber(d)
  case .bool(let b): return b ? "true" : "false"
  case .array(let a): return a.map(wireShow).joined(separator: ",")
  case .string(let s): return isBareWord(s) ? s : jsQuote(s)
  case .null: return jsQuote("")
  case .object: return jsQuote("[object Object]") // JS String({})
  }
}

/// JS String(v), for turning a ref value into the id a handle was assigned for.
private func wireKey(_ value: JSONValue) -> String {
  switch value {
  case .string(let s): return s
  case .number(let d): return jsNumber(d)
  case .bool(let b): return b ? "true" : "false"
  case .null: return "null"
  case .array(let a): return a.map(wireKey).joined(separator: ",")
  case .object: return "[object Object]"
  }
}

private func isBareWord(_ s: String) -> Bool {
  // /^[A-Za-z_][\w.-]*$/
  guard let first = s.unicodeScalars.first else { return false }
  let isAlpha: (Unicode.Scalar) -> Bool = { ($0.value >= 65 && $0.value <= 90) || ($0.value >= 97 && $0.value <= 122) }
  guard isAlpha(first) || first == "_" else { return false }
  return s.unicodeScalars.dropFirst().allSatisfy { isAlpha($0) || ($0.value >= 48 && $0.value <= 57) || $0 == "_" || $0 == "." || $0 == "-" }
}

/// The stateful core: handle assignment, encode, resolve. Kept separate from
/// the entity declarations so the conformance vectors (and apps) can feed
/// materialised rows straight in. Handles mutate as encoding proceeds; like
/// the JS store it belongs to one thread/actor (hence @unchecked).
public final class WireRuntime: @unchecked Sendable {
  public let entities: [WireEntitySpec]
  private let byType: [String: WireEntitySpec]
  /// id → handle ("type\0id"), handle → (type, id)
  private var handles: [String: String] = [:]
  private var owners: [String: (type: String, id: String)] = [:]
  private var counters: [String: Int] = [:]
  private let prefixes: [String: String]

  public init(entities: [WireEntitySpec]) {
    self.entities = entities
    var byType: [String: WireEntitySpec] = [:]
    var prefixes: [String: String] = [:]
    for e in entities {
      byType[e.type] = e
      var p = String(e.type.prefix(1))
      var n = 2
      while prefixes.values.contains(p) {
        p = String(e.type.prefix(n))
        n += 1
      }
      prefixes[e.type] = p
    }
    self.byType = byType
    self.prefixes = prefixes
  }

  /// The stable handle for one item, assigned on first sight.
  private func handleOf(_ type: String, _ id: String) -> String {
    let key = "\(type)\u{0}\(id)"
    if let h = handles[key] { return h }
    let n = (counters[type] ?? 0) + 1
    counters[type] = n
    let h = "\(prefixes[type]!)\(n)"
    handles[key] = h
    owners[h] = (type, id)
    return h
  }

  /// How to read the format, for the system prompt.
  public func legend() -> String {
    "Each type starts with a schema line: type(h required… [optional=default]…). Then one row per item: its handle, required fields in order, then name=value for optional fields that differ from their default. Refer to existing items by handle."
  }

  /// The state as wire text.
  public func encodeRows(_ rows: [String: [WireRow]]) -> String {
    var out: [String] = []
    for e in entities {
      let items = rows[e.type] ?? []
      let required = e.fields.filter { $0.default == nil }
      let optional = e.fields.filter { $0.default != nil }
      var head: [String] = []
      if e.idField != nil { head.append("h") }
      head += required.map(\.name)
      head += optional.map { "[\($0.name)=\(wireShow($0.default!))]" }
      out.append("\(e.type)(\(head.joined(separator: " ")))\(items.isEmpty ? " none" : "")")
      for row in items {
        var r: [String] = []
        if e.idField != nil { r.append(handleOf(e.type, row.id ?? "")) }
        for f in required {
          let v = row.values[f.name] ?? .null
          r.append(f.ref != nil ? handleOf(f.ref!, wireKey(v)) : wireShow(v))
        }
        for f in optional {
          let v = row.values[f.name] ?? .null
          if v != f.default! {
            r.append("\(f.name)=\(f.ref != nil ? handleOf(f.ref!, wireKey(v)) : wireShow(v))")
          }
        }
        out.append(r.joined(separator: " "))
      }
    }
    return out.joined(separator: "\n")
  }

  /// Translate an action the model wrote with handles back to real ids.
  /// Only params declared with `ref` are translated, and only when the value
  /// is a handle of that type; anything else passes through untouched.
  public func resolve(_ action: Action, params: Params) -> Action {
    guard case .object(let pairs) = action.payload else { return action }
    var out = pairs
    for e in params.entries {
      guard let ref = e.param.ref,
            let v = action.payload[e.name],
            case .string(let h) = v,
            let owner = owners[h],
            owner.type == ref else { continue }
      if let i = out.firstIndex(where: { $0.key == e.name }) {
        out[i] = JSONValue.Pair(e.name, .string(owner.id))
      }
    }
    return Action(action.type, payload: .object(out))
  }

  /// The handle for a real id, e.g. to show it in logs.
  public func handle(_ type: String, _ id: String) -> String? {
    byType[type] != nil ? handleOf(type, id) : nil
  }
}

/// An entity declaration over app state: the spec plus how to list its rows.
public struct WireEntity<State>: Sendable {
  public var spec: WireEntitySpec
  public var list: @Sendable (State) -> [WireRow]

  public init(spec: WireEntitySpec, list: @escaping @Sendable (State) -> [WireRow]) {
    self.spec = spec
    self.list = list
  }
}

/// The app-facing wire: declared entities, stable session handles, encode and resolve.
public struct Wire<State>: Sendable {
  private let entities: [WireEntity<State>]
  private let runtime: WireRuntime

  public init(entities: [WireEntity<State>]) {
    self.entities = entities
    runtime = WireRuntime(entities: entities.map(\.spec))
  }

  public func legend() -> String { runtime.legend() }

  public func encode(_ state: State) -> String {
    var rows: [String: [WireRow]] = [:]
    for e in entities { rows[e.spec.type] = e.list(state) }
    return runtime.encodeRows(rows)
  }

  public func resolve(_ action: Action, params: Params) -> Action {
    runtime.resolve(action, params: params)
  }

  public func handle(_ type: String, _ id: String) -> String? {
    runtime.handle(type, id)
  }
}
