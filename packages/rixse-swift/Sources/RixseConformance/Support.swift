// Loading and decoding for the shared conformance vectors, plus the fixture
// catalogue built from fixture.json — the same definitions the JS generator
// used, so Swift and JS run the same viewport, not two hand-copied ones.
import Foundation
import Rixse

public func vectorURL(_ name: String) -> URL {
  URL(fileURLWithPath: #filePath)
    .deletingLastPathComponent() // RixseTests
    .deletingLastPathComponent() // Tests
    .deletingLastPathComponent() // rixse-swift
    .deletingLastPathComponent() // packages
    .deletingLastPathComponent() // the repo root
    .appendingPathComponent("conformance")
    .appendingPathComponent(name)
}

public func loadVector(_ name: String) throws -> JSONValue {
  try parseJSON(String(contentsOf: vectorURL(name), encoding: .utf8))
}

public func loadVectorText(_ name: String) throws -> String {
  try String(contentsOf: vectorURL(name), encoding: .utf8)
}

// MARK: - Decoders

public func param(from json: JSONValue) -> Param {
  let type: ParamType
  switch json["type"]?.stringValue {
  case "number": type = .number
  case "boolean": type = .boolean
  case "enum": type = .enum(json["values"]!.arrayValue!.map { $0.stringValue! })
  default: type = .string // absent (resolve-only params) or "string"
  }
  return Param(type: type, optional: json["optional"]?.boolValue ?? false, describe: json["describe"]?.stringValue, ref: json["ref"]?.stringValue, default: json["default"])
}

public func params(from json: JSONValue) -> Params {
  Params(json.objectPairs.map { ($0.key, param(from: $0.value)) })
}

public func componentDef(from json: JSONValue, check: (@Sendable ([JSONValue], Item) -> String?)?) -> ComponentDef {
  ComponentDef(
    describe: json["describe"]!.stringValue!,
    sizes: json["sizes"]?.arrayValue?.map { $0.stringValue! } ?? [],
    size: json["size"]?.stringValue,
    params: json["params"].map(params(from:)) ?? Params(),
    source: json["source"]?.stringValue,
    identity: json["identity"]?.arrayValue?.map { $0.stringValue! },
    select: json["select"]?.stringValue,
    check: check
  )
}

public func action(from json: JSONValue) -> Action {
  Action(json["type"]!.stringValue!, payload: json["payload"] ?? .object([]))
}

public func actionJSON(_ a: Action) -> JSONValue {
  jsonObject([("payload", a.payload), ("type", .string(a.type))])
}

public func wireSpec(from json: JSONValue) -> [WireEntitySpec] {
  json["entities"]!.arrayValue!.map { e in
    WireEntitySpec(type: e["type"]!.stringValue!, idField: e["idField"]?.stringValue, fields: e["fields"]!.arrayValue!.map { f in
      WireFieldSpec(name: f["name"]!.stringValue!, ref: f["ref"]?.stringValue, default: f["default"])
    })
  }
}

public func wireRows(from json: JSONValue) -> [String: [WireRow]] {
  var rows: [String: [WireRow]] = [:]
  for p in json.objectPairs {
    rows[p.key] = p.value.arrayValue!.map { row in
      var values: [String: JSONValue] = [:]
      for rp in row.objectPairs where rp.key != "_id" { values[rp.key] = rp.value }
      return WireRow(id: row["_id"]?.stringValue, values: values)
    }
  }
  return rows
}

/// The authored log, in the same shape the generator records it (no timestamps).
public func logJSON(_ log: [LogEntry]) -> JSONValue {
  .array(log.map { e in
    var pairs: [(String, JSONValue)] = [
      ("author", .string(e.author.rawValue)),
      ("payload", e.payload),
      ("seq", .number(Double(e.seq))),
      ("type", .string(e.type)),
    ]
    if let why = e.why { pairs.append(("why", .string(why))) }
    if e.undone { pairs.append(("undone", .bool(true))) }
    return jsonObject(pairs)
  })
}

// MARK: - The fixture catalogue (fixture.json + the fixture's two native closures)

public struct Fixture {
  public let components: [Component]
  public let sources: [(String, SourceDef)]

  public static func load() throws -> Fixture {
    let root = try loadVector("fixture.json")
    let sourceJSON = root["source"]!
    var tableMap: [String: [JSONValue]] = [:]
    for p in sourceJSON["tables"]!.objectPairs { tableMap[p.key] = p.value.arrayValue! }
    let tables = tableMap
    let describe = sourceJSON["describe"]!.stringValue!
    let hintSuffix = sourceJSON["hintSuffix"]!.stringValue!
    let source = SourceDef(describe: { describe }, run: { q in
      guard let rows = tables[q] else { throw Rejected("no table \(q)") }
      return rows
    }, hint: { e in "\(e)\(hintSuffix)" })
    let statCheck: @Sendable ([JSONValue], Item) -> String? = { rows, item in
      let field = item.value("value")?.stringValue ?? ""
      return rows.allSatisfy { $0[field]?.numberValue != nil } ? nil : "\"\(field)\" is not a number field"
    }
    var components: [Component] = []
    for c in root["components"]!.arrayValue! {
      let check = c["hasCheck"]?.boolValue == true ? statCheck : nil
      components.append(try defineComponent(c["kind"]!.stringValue!, componentDef(from: c, check: check)))
    }
    return Fixture(components: components, sources: [("db", source)])
  }

  public func viewport() throws -> Viewport { try createViewport(components: components, sources: sources) }

  public func store() throws -> Store<ViewportState> {
    let vp = try viewport()
    return Store(initial: vp.initial(), actions: vp.actions)
  }
}

/// The movies catalogue from fixture.json, for the catalogue/vocabulary text
/// vectors. Its queries run against zega, which is not part of conformance —
/// the source and checks are never invoked by these vectors.
public struct MoviesFixture {
  public let viewport: Viewport

  public static func load() throws -> MoviesFixture {
    let root = try loadVector("fixture.json")["movies"]!
    let describe = root["sourceDescribe"]!.stringValue!
    let source = SourceDef(describe: { describe }, query: root["sourceQuery"]!.stringValue!, run: { _ in
      throw Rejected("zega is not part of the conformance fixture")
    })
    // Movies checks run against zega, which is not part of conformance; the
    // catalogue/vocabulary vectors never invoke them.
    let noCheck: @Sendable ([JSONValue], Item) -> String? = { _, _ in
      preconditionFailure("movies checks run against zega, not the conformance fixture")
    }
    var components: [Component] = []
    for c in root["components"]!.arrayValue! {
      let check = c["hasCheck"]?.boolValue == true ? noCheck : nil
      components.append(try defineComponent(c["kind"]!.stringValue!, componentDef(from: c, check: check)))
    }
    return MoviesFixture(viewport: try createViewport(components: components, sources: [("zega", source)]))
  }
}
