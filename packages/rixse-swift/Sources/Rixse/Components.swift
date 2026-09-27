// Components (APS 4): everything the agent places is a component, sized
//
//   viewport → large → medium → small
//
// small/medium/large are fixed shapes that mean the same on every platform;
// viewport fills its container and owns the layout of what it holds. The agent
// picks a kind, its params, a size and a relative place; it never sees columns
// or pixels. Components read rows from a data source adapter, so rows never
// pass through the model, and rixse never knows which database is behind it.
//
// Swift port of packages/rixse/src/components.js, held to it by conformance/.

public enum Size: String, Sendable, CaseIterable {
  case viewport, large, medium, small
}

/// Largest first: the order the ladder is written in.
public let SIZES: [Size] = [.viewport, .large, .medium, .small]

public enum Place: String, Sendable {
  case end, before, after, replace
}

public let PLACES: [Place] = [.end, .before, .after, .replace]

/// A component as declared, before defineComponent checks it. Sizes are raw
/// strings so a bad size produces the definition error, like JS.
public struct ComponentDef: Sendable {
  public var describe: String
  public var sizes: [String]
  public var size: String?
  public var params: Params
  public var source: String?
  public var identity: [String]?
  public var select: String?
  public var check: (@Sendable ([JSONValue], Item) -> String?)?

  public init(describe: String, sizes: [String] = [], size: String? = nil, params: Params = Params(), source: String? = nil, identity: [String]? = nil, select: String? = nil, check: (@Sendable ([JSONValue], Item) -> String?)? = nil) {
    self.describe = describe
    self.sizes = sizes
    self.size = size
    self.params = params
    self.source = source
    self.identity = identity
    self.select = select
    self.check = check
  }
}

public struct Component: Sendable {
  public var kind: String
  public var describe: String
  public var sizes: [Size]
  public var size: Size
  public var params: Params
  public var source: String?
  public var identity: [String]?
  public var select: String?
  public var check: (@Sendable ([JSONValue], Item) -> String?)?
}

public func defineComponent(_ kind: String, _ def: ComponentDef) throws -> Component {
  guard !def.sizes.isEmpty else { throw DefinitionError("component \"\(kind)\" needs at least one size") }
  for s in def.sizes {
    guard Size(rawValue: s) != nil else { throw DefinitionError("component \"\(kind)\": unknown size \"\(s)\"") }
  }
  let sizeRaw = def.size ?? def.sizes[0]
  guard let size = Size(rawValue: sizeRaw), def.sizes.contains(sizeRaw) else {
    throw DefinitionError("component \"\(kind)\": default size \"\(sizeRaw)\" is not one of its sizes")
  }
  return Component(kind: kind, describe: def.describe, sizes: def.sizes.map { Size(rawValue: $0)! }, size: size, params: def.params, source: def.source, identity: def.identity, select: def.select, check: def.check)
}

/// A data source adapter: runs a component's query and turns its errors into
/// fix-shaped rejection reasons. rixse never knows which database is behind it.
public struct SourceDef: Sendable {
  public var describe: @Sendable () -> String
  public var query: String?
  public var run: @Sendable (String) throws -> [JSONValue]
  public var hint: (@Sendable (String) -> String)?

  public init(describe: @escaping @Sendable () -> String, query: String? = nil, run: @escaping @Sendable (String) throws -> [JSONValue], hint: (@Sendable (String) -> String)? = nil) {
    self.describe = describe
    self.query = query
    self.run = run
    self.hint = hint
  }
}

public func defineSource(_ def: SourceDef) -> SourceDef { def }

/// One component on screen: its identity (kind + identifying params) and its
/// parameters, with defaults already materialised. `extra` holds the kind's
/// params (label, value, sort…), exactly the extra keys of the JS item object.
public struct Item: Equatable, Sendable {
  public var id: String
  public var kind: String
  public var title: String
  public var size: Size
  public var query: String
  public var extra: [String: JSONValue]

  public init(id: String, kind: String, title: String, size: Size, query: String, extra: [String: JSONValue] = [:]) {
    self.id = id
    self.kind = kind
    self.title = title
    self.size = size
    self.query = query
    self.extra = extra
  }

  /// Any field, like JS `item[key]` over the flat object.
  public func value(_ key: String) -> JSONValue? {
    switch key {
    case "id": return .string(id)
    case "kind": return .string(kind)
    case "title": return .string(title)
    case "size": return .string(size.rawValue)
    case "query": return .string(query)
    default: return extra[key]
    }
  }
}

/// What the user (or the agent) has selected in one component.
public struct Selection: Equatable, Sendable {
  public var view: String
  public var items: [String]
  public init(view: String, items: [String]) {
    self.view = view
    self.items = items
  }
}

public struct ViewportState: Equatable, Sendable {
  public var items: [String: Item]
  public var order: [String]
  public var selection: Selection?

  public init(items: [String: Item], order: [String], selection: Selection?) {
    self.items = items
    self.order = order
    self.selection = selection
  }
}

// MARK: - JSON

extension Item {
  /// The flat JSON form, like the JS item object: fixed keys plus the params.
  public func toJSON() -> JSONValue {
    var pairs: [(String, JSONValue)] = [
      ("id", .string(id)), ("kind", .string(kind)), ("title", .string(title)),
      ("size", .string(size.rawValue)), ("query", .string(query)),
    ]
    for key in extra.keys.sorted() { pairs.append((key, extra[key]!)) }
    return jsonObject(pairs)
  }

  public init?(json: JSONValue) {
    guard let id = json["id"]?.stringValue,
          let kind = json["kind"]?.stringValue,
          let title = json["title"]?.stringValue,
          let sizeRaw = json["size"]?.stringValue,
          let size = Size(rawValue: sizeRaw) else { return nil }
    self.id = id
    self.kind = kind
    self.title = title
    self.size = size
    self.query = json["query"]?.stringValue ?? ""
    var extra: [String: JSONValue] = [:]
    for pair in json.objectPairs where !["id", "kind", "title", "size", "query"].contains(pair.key) {
      extra[pair.key] = pair.value
    }
    self.extra = extra
  }
}

extension Selection {
  public func toJSON() -> JSONValue {
    jsonObject([("view", .string(view)), ("items", .array(items.map { .string($0) }))])
  }

  public init?(json: JSONValue) {
    guard let view = json["view"]?.stringValue,
          let items = json["items"]?.arrayValue?.compactMap({ $0.stringValue }) else { return nil }
    self.init(view: view, items: items)
  }
}

extension ViewportState {
  public func toJSON() -> JSONValue {
    var itemPairs: [(String, JSONValue)] = []
    for key in items.keys.sorted() { itemPairs.append((key, items[key]!.toJSON())) }
    return jsonObject([
      ("items", jsonObject(itemPairs)),
      ("order", .array(order.map { .string($0) })),
      ("selection", selection?.toJSON() ?? .null),
    ])
  }

  public init?(json: JSONValue) {
    var items: [String: Item] = [:]
    for pair in json["items"]?.objectPairs ?? [] {
      guard let item = Item(json: pair.value) else { return nil }
      items[pair.key] = item
    }
    guard let order = json["order"]?.arrayValue?.compactMap({ $0.stringValue }) else { return nil }
    let selection: Selection?
    if let sel = json["selection"], sel != .null {
      guard let s = Selection(json: sel) else { return nil }
      selection = s
    } else {
      selection = nil
    }
    self.init(items: items, order: order, selection: selection)
  }
}

// MARK: - place

public struct Placed: Equatable, Sendable {
  public var order: [String]
  public var removed: String?
}

/// Where an item goes in the order. The agent decides (end, before/after an
/// item, or replace one); rixse checks the target. Returns the new order and
/// the id a replace removes.
public func place(_ order: [String], _ id: String, at: Place = .end, target: String? = nil) throws -> Placed {
  let rest = order.filter { $0 != id }
  if at == .end { return Placed(order: rest + [id], removed: nil) }
  guard let target, !target.isEmpty else { throw Rejected("at \"\(at.rawValue)\" needs a target") }
  guard target != id else { throw Rejected("a component cannot be placed relative to itself") }
  guard let i = rest.firstIndex(of: target) else {
    throw Rejected("no component \"\(target)\" to place \(at == .replace ? "over" : at.rawValue)")
  }
  if at == .replace {
    return Placed(order: Array(rest[..<i]) + [id] + Array(rest[(i + 1)...]), removed: target)
  }
  let j = at == .before ? i : i + 1
  return Placed(order: Array(rest[..<j]) + [id] + Array(rest[j...]), removed: nil)
}

// MARK: - layout

public struct LayoutBand: Equatable, Sendable {
  public var min: Double
  public var cols: Int
  public init(min: Double, cols: Int) {
    self.min = min
    self.cols = cols
  }
}

public struct LayoutCell: Equatable, Sendable {
  public var id: String
  public var cols: Int
  public var rows: Int
  public init(id: String, cols: Int, rows: Int) {
    self.id = id
    self.cols = cols
    self.rows = rows
  }
}

public let DEFAULT_BANDS = [LayoutBand(min: 0, cols: 2), LayoutBand(min: 720, cols: 4), LayoutBand(min: 1280, cols: 6)]

/// Grid cells per size. Columns come from the viewport's container width, never
/// the window; a size wider than the grid takes the whole row.
private let SPAN: [Size: (cols: Int, rows: Int)] = [.small: (1, 1), .medium: (2, 1), .large: (2, 2)]

/// Lay out a viewport's items for a container width. Pure: the same state and
/// width always give the same cells, on every platform.
public func layout(_ state: ViewportState, width: Double, bands: [LayoutBand] = DEFAULT_BANDS) -> (cols: Int, cells: [LayoutCell]) {
  let cols = bands.sorted { $0.min < $1.min }.filter { width >= $0.min }.last?.cols ?? 1
  let cells = state.order.map { id -> LayoutCell in
    let size = state.items[id]!.size
    if size == .viewport { return LayoutCell(id: id, cols: cols, rows: 0) }
    let span = SPAN[size]!
    return LayoutCell(id: id, cols: min(span.cols, cols), rows: span.rows)
  }
  return (cols, cells)
}

// MARK: - createViewport

/// A viewport component's state, actions and agent text, from a catalogue of
/// components and the data sources they read.
public struct Viewport: Sendable {
  public let components: [Component]
  public let byKind: [String: Component]
  public let sources: [(String, SourceDef)]
  public let actions: [ActionDef<ViewportState>]

  public func initial() -> ViewportState { ViewportState(items: [:], order: [], selection: nil) }

  private var sourceMap: [String: SourceDef] {
    var m: [String: SourceDef] = [:]
    for (n, s) in sources { m[n] = s }
    return m
  }

  /// Run an item's query through its source; a failure comes back as the fix, where the source knows it.
  public func rowsFor(_ item: Item) throws -> [JSONValue] {
    guard let c = byKind[item.kind], let srcName = c.source else { return [] }
    let src = sourceMap[srcName]!
    do {
      return try src.run(item.query)
    } catch {
      let msg = (error as? Rejected)?.message ?? String(describing: error)
      throw Rejected(src.hint?(msg) ?? msg)
    }
  }

  /// The component catalogue, written for a model. Generated: adding a component adds its words.
  public func catalogue() -> String {
    let lines = components.map { c -> String in
      let params = c.params.entries.map { e -> String in
        let t: String
        switch e.param.type {
        case .enum(let values): t = values.map { jsQuote($0) }.joined(separator: "|")
        default: t = e.param.type.text
        }
        var s = "\(e.name)\(e.param.optional || e.param.default != nil ? "?" : ""): \(t)"
        if let d = e.param.default, d != .string("") { s += " = \(jsStringify(d))" }
        if let describe = e.param.describe { s += " (\(describe))" }
        return s
      }
      let sizes = c.sizes.map { $0 == c.size ? "\($0.rawValue)*" : $0.rawValue }.joined(separator: "|")
      var line = "- \(c.kind) [\(sizes)]\(c.source.map { " reads \($0)" } ?? ""): \(c.describe)"
      if !params.isEmpty { line += "\n    params: \(params.joined(separator: "; "))" }
      if let select = c.select { line += "\n    select: \(select)" }
      return line
    }
    let srcs = sources.map { "## Source \"\($0)\"\n\($1.describe())" }
    return ([
      "Components (sizes: viewport = the whole width, large = a big tile, medium = a wide tile, small = a small tile; * marks the usual size). The page lays them out; you choose kind, params, size and where it goes relative to the others.",
    ] + lines + srcs).joined(separator: "\n")
  }
}

public func createViewport(components: [Component], sources: [(String, SourceDef)]) throws -> Viewport {
  var kindMap: [String: Component] = [:]
  for c in components {
    if let src = c.source, !sources.contains(where: { $0.0 == src }) {
      throw DefinitionError("component \"\(c.kind)\" reads unknown source \"\(src)\"")
    }
    kindMap[c.kind] = c
  }
  let byKind = kindMap
  let kinds = components.map(\.kind)
  /// Every component's params, merged: the one door takes any of them, and each kind checks its own.
  var merged = Params()
  for c in components {
    for e in c.params.entries where !merged.contains(e.name) {
      var p = e.param
      p.optional = true
      p.describe = nil
      merged.append(e.name, p)
    }
  }
  let allParams = merged

  // Models lean on the action's own words: name the query language and its shape right here.
  let queryText = sources.compactMap { (n, src) in src.query.map { "\(n): \($0)" } }.joined(separator: "; ")
  let queryDescribe = queryText.isEmpty ? "one query in the source’s language" : queryText

  let sizeError: @Sendable (Component, Size) -> String? = { c, size in
    c.sizes.contains(size) ? nil : "\(c.kind) comes in \(c.sizes.map(\.rawValue).joined(separator: ", ")), not \(size.rawValue)"
  }

  let placeParams = Params([
    ("at", Param(type: .enum(PLACES.map(\.rawValue)), optional: true, describe: "\"end\" (default), \"before\"/\"after\" the target, or \"replace\" the target (it is removed; its spot is taken)")),
    ("target", Param(type: .string, optional: true, describe: "the component id (or handle) \"at\" refers to", ref: "view")),
  ])

  var showParams = Params([
    ("id", Param(type: .string, describe: "a short slug; reuse an existing id (or its handle) to change it instead of adding one", ref: "view")),
    ("kind", Param(type: .enum(kinds), describe: "see the components list")),
    ("title", Param(type: .string)),
    ("query", Param(type: .string, optional: true, describe: queryDescribe)),
    ("size", Param(type: .enum(SIZES.map(\.rawValue)), optional: true, describe: "one of the sizes the kind comes in; default is its usual size")),
  ])
  for e in allParams.entries { showParams.append(e.name, e.param) }
  for e in placeParams.entries { showParams.append(e.name, e.param) }

  let rowsFor: @Sendable (Item) throws -> [JSONValue] = { item in
    guard let c = byKind[item.kind], let srcName = c.source else { return [] }
    let src = sources.first { $0.0 == srcName }!.1
    do {
      return try src.run(item.query)
    } catch {
      let msg = (error as? Rejected)?.message ?? String(describing: error)
      throw Rejected(src.hint?(msg) ?? msg)
    }
  }

  let actions: [ActionDef<ViewportState>] = [
    defineAction("view.show", describe: "Show a component, or change the one with this id. The page runs its query and draws the rows; you never see or write the data.", params: showParams) { s, payload in
      let c = byKind[payload["kind"]!.stringValue!]!
      for pair in payload.objectPairs {
        if allParams.contains(pair.key) && !c.params.contains(pair.key) {
          throw Rejected("\(c.kind) has no \"\(pair.key)\"; its params are \(c.params.isEmpty ? "none" : c.params.names.joined(separator: ", "))")
        }
      }
      for e in c.params.entries where !e.param.optional && e.param.default == nil && payload[e.name] == nil {
        throw Rejected("\(c.kind) needs \"\(e.name)\"")
      }
      if c.source != nil {
        let q = payload["query"]
        if q == nil || q == .null || q == .string("") { throw Rejected("\(c.kind) needs a query") }
      }
      let id = payload["id"]!.stringValue!
      let prev = s.items[id]
      let sizeRaw: String
      if let p = payload["size"]?.stringValue {
        sizeRaw = p
      } else if prev?.kind == c.kind {
        sizeRaw = prev!.size.rawValue
      } else {
        sizeRaw = c.size.rawValue
      }
      let size = Size(rawValue: sizeRaw)!
      if let bad = sizeError(c, size) { throw Rejected(bad) }
      var extra: [String: JSONValue] = [:]
      for e in c.params.entries {
        let v = payload[e.name]
        if v == nil || v == .null {
          if let d = e.param.default { extra[e.name] = d }
        } else {
          extra[e.name] = v!
        }
      }
      let item = Item(id: id, kind: c.kind, title: payload["title"]!.stringValue!, size: size, query: payload["query"]?.stringValue ?? "", extra: extra)
      // Ensure (APS 2): one component per identity. Showing it again is a
      // pointer to the one on screen, never a duplicate.
      if let identity = c.identity {
        // JS iterates the items object in insertion order; placement order is
        // the closest deterministic order Swift has, and identical in practice.
        for oid in s.order {
          guard let o = s.items[oid], o.id != id, o.kind == c.kind else { continue }
          if identity.allSatisfy({ o.value($0) == item.value($0) }) {
            throw Rejected("already showing as \"\(o.id)\"; reuse id \"\(o.id)\" to change it")
          }
        }
      }
      let rows = try rowsFor(item)
      if c.source != nil && rows.isEmpty { throw Rejected("the query ran but returned no rows; loosen the filter or check the names") }
      if let why = c.check?(rows, item) { throw Rejected(why) }
      let placed: Placed
      if let atRaw = payload["at"]?.stringValue, !atRaw.isEmpty {
        placed = try place(s.order, id, at: Place(rawValue: atRaw)!, target: payload["target"]?.stringValue)
      } else {
        placed = Placed(order: s.order.contains(id) ? s.order : s.order + [id], removed: nil)
      }
      var items = s.items
      items[id] = item
      if let removed = placed.removed { items[removed] = nil }
      // A changed or removed component drops its selection: the items may no longer be on screen.
      let selection: Selection?
      if let sel = s.selection, items[sel.view] != nil, sel.view != id {
        selection = sel
      } else {
        selection = nil
      }
      return ViewportState(items: items, order: placed.order, selection: selection)
    },
    defineAction("view.move", describe: "Move a component to the end, or before/after another.", params: Params([
      ("id", Param(type: .string, ref: "view")),
      ("at", Param(type: .enum([Place.end, .before, .after].map(\.rawValue)))),
      ("target", Param(type: .string, optional: true, ref: "view")),
    ])) { s, payload in
      let id = payload["id"]!.stringValue!
      guard s.items[id] != nil else { throw Rejected("no component \"\(id)\"") }
      var next = s
      next.order = try place(s.order, id, at: Place(rawValue: payload["at"]!.stringValue!)!, target: payload["target"]?.stringValue).order
      return next
    },
    defineAction("view.resize", describe: "Change a component’s size (only to a size its kind comes in).", params: Params([
      ("id", Param(type: .string, ref: "view")),
      ("size", Param(type: .enum(SIZES.map(\.rawValue)))),
    ])) { s, payload in
      let id = payload["id"]!.stringValue!
      guard let it = s.items[id] else { throw Rejected("no component \"\(id)\"") }
      let size = Size(rawValue: payload["size"]!.stringValue!)!
      if let bad = sizeError(byKind[it.kind]!, size) { throw Rejected(bad) }
      var next = s
      next.items[id]!.size = size
      return next
    },
    defineAction("view.remove", describe: "Remove a component.", params: Params([
      ("id", Param(type: .string, ref: "view")),
    ])) { s, payload in
      let id = payload["id"]!.stringValue!
      guard s.items[id] != nil else { throw Rejected("no component \"\(id)\"") }
      var items = s.items
      items[id] = nil
      return ViewportState(items: items, order: s.order.filter { $0 != id }, selection: s.selection?.view == id ? nil : s.selection)
    },
    defineAction("view.clear", describe: "Remove every component.", params: Params()) { _, _ in
      ViewportState(items: [:], order: [], selection: nil)
    },
    defineAction("select.set", describe: "Select things in one component (the user does this by clicking; you may too, to point at an answer). Replaces the selection.", params: Params([
      ("view", Param(type: .string, ref: "view")),
      ("items", Param(type: .string, describe: "\"|\"-separated; what each kind selects is in the components list")),
    ])) { s, payload in
      let view = payload["view"]!.stringValue!
      guard s.items[view] != nil else { throw Rejected("no component \"\(view)\"") }
      var seen = Set<String>()
      var items: [String] = []
      for part in payload["items"]!.stringValue!.split(separator: "|", omittingEmptySubsequences: false) {
        let t = part.trimmingCharacters(in: .whitespaces)
        if !t.isEmpty && !seen.contains(t) {
          seen.insert(t)
          items.append(t)
        }
      }
      guard !items.isEmpty else { throw Rejected("select at least one item, or use select.clear") }
      var next = s
      next.selection = Selection(view: view, items: items)
      return next
    },
    defineAction("select.clear", describe: "Clear the selection.", params: Params()) { s, _ in
      var next = s
      next.selection = nil
      return next
    },
  ]

  return Viewport(components: components, byKind: byKind, sources: sources, actions: actions)
}
