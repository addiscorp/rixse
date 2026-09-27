// The conformance checks, shared by the swift-testing suite (RixseTests) and
// the `rixse-conformance-check` executable. One implementation: both runners
// call these, so the two gates can never disagree. Each function returns how
// many vectors it exercised and throws CheckFailure on the first mismatch.
import Foundation
import Rixse

public struct CheckFailure: Error, CustomStringConvertible {
  public let message: String
  public var description: String { message }
  public init(_ message: String) { self.message = message }
}

func check(_ condition: Bool, _ message: @autoclosure () -> String) throws {
  if !condition { throw CheckFailure(message()) }
}

func checkEqual<T: Equatable>(_ actual: T, _ expected: T, _ message: @autoclosure () -> String) throws {
  if actual != expected { throw CheckFailure("\(message()):\n  got  \(actual)\n  want \(expected)") }
}

public func checkValidate() throws -> Int {
  let vectors = try loadVector("validate.json").arrayValue!
  for v in vectors {
    let expected = v["expect"]! == .null ? nil : v["expect"]!.stringValue!
    try checkEqual(validate(params(from: v["params"]!), v["payload"]!), expected, "\(v["name"]!)")
  }
  return vectors.count
}

public func checkPlace() throws -> Int {
  let vectors = try loadVector("place.json").arrayValue!
  for p in vectors {
    let name = "\(p["name"]!)"
    let order = p["order"]!.arrayValue!.map { $0.stringValue! }
    let at = p["at"]?.stringValue.flatMap { Place(rawValue: $0) } ?? .end
    do {
      let placed = try place(order, p["id"]!.stringValue!, at: at, target: p["target"]?.stringValue)
      try check(p["expect"]!["error"] == nil, name)
      try checkEqual(placed.order, p["expect"]!["order"]!.arrayValue!.map { $0.stringValue! }, name)
      try checkEqual(placed.removed, p["expect"]!["removed"]?.stringValue, name)
    } catch let r as Rejected {
      try checkEqual(r.message, p["expect"]!["error"]?.stringValue, name)
    }
  }
  return vectors.count
}

public func checkDefineComponent() throws -> Int {
  let vectors = try loadVector("define-component.json").arrayValue!
  for d in vectors {
    let def = componentDef(from: d["def"]!, check: nil)
    do {
      _ = try defineComponent(d["kind"]!.stringValue!, def)
      throw CheckFailure("\(d["name"]!): expected the definition to throw")
    } catch let e as DefinitionError {
      try checkEqual(e.message, d["error"]!.stringValue!, "\(d["name"]!)")
    }
  }
  return vectors.count
}

public func checkCreateViewport() throws -> Int {
  let fixture = try Fixture.load()
  let vectors = try loadVector("create-viewport.json").arrayValue!
  for v in vectors {
    do {
      _ = try createViewport(components: fixture.components, sources: [])
      throw CheckFailure("\(v["name"]!): expected createViewport to throw")
    } catch let e as DefinitionError {
      try checkEqual(e.message, v["error"]!.stringValue!, "\(v["name"]!)")
    }
  }
  return vectors.count
}

public func checkViewportScenarios() throws -> Int {
  let fixture = try Fixture.load()
  let scenarios = try loadVector("viewport.json").arrayValue!
  var steps = 0
  for scenario in scenarios {
    let name = scenario["name"]!.stringValue!
    let store = try fixture.store()
    for (i, step) in scenario["steps"]!.arrayValue!.enumerated() {
      steps += 1
      let at = "\(name) step \(i)"
      switch step["op"]!.stringValue! {
      case "dispatch":
        let result = try store.dispatch(action(from: step["action"]!), author: Author(rawValue: step["author"]!.stringValue!)!, why: step["why"]?.stringValue)
        try checkEqual(result.ok, step["ok"]!.boolValue!, at)
        if !result.ok { try checkEqual(result.error, step["error"]!.stringValue!, at) }
      case "undo":
        let entry = store.undo()
        if step["entry"]! == .null {
          try check(entry == nil, at)
        } else {
          try checkEqual(entry?.seq, Int(step["entry"]!["seq"]!.numberValue!), at)
          try checkEqual(entry?.author.rawValue, step["entry"]!["author"]!.stringValue!, at)
          try checkEqual(entry?.type, step["entry"]!["type"]!.stringValue!, at)
        }
      case "proposal":
        let results = try store.applyProposal(step["actions"]!.arrayValue!.map(action(from:)), why: step["why"]?.stringValue)
        for (j, r) in results.enumerated() {
          let expect = step["results"]!.arrayValue![j]
          try checkEqual(r.result.ok, expect["ok"]!.boolValue!, "\(at) action \(j)")
          if !r.result.ok { try checkEqual(r.result.error, expect["error"]!.stringValue!, "\(at) action \(j)") }
        }
      default:
        throw CheckFailure("\(at): unknown op")
      }
      try checkEqual(canonicalJSON(store.state.toJSON()), canonicalJSON(step["state"]!), "\(at): state")
      try checkEqual(canonicalJSON(logJSON(store.log)), canonicalJSON(step["log"]!), "\(at): log")
    }
  }
  return steps
}

public func checkLayout() throws -> Int {
  let cases = try loadVector("layout.json").arrayValue!
  var n = 0
  for c in cases {
    let name = c["name"]!.stringValue!
    guard let state = ViewportState(json: c["state"]!) else { throw CheckFailure("\(name): bad state") }
    let bands = c["bands"]?.arrayValue?.map { LayoutBand(min: $0["min"]!.numberValue!, cols: Int($0["cols"]!.numberValue!)) }
    for pair in c["expect"]!.objectPairs {
      n += 1
      let result = layout(state, width: Double(pair.key)!, bands: bands ?? DEFAULT_BANDS)
      try checkEqual(result.cols, Int(pair.value["cols"]!.numberValue!), "\(name) @ \(pair.key)")
      let cells = pair.value["cells"]!.arrayValue!.map { LayoutCell(id: $0["id"]!.stringValue!, cols: Int($0["cols"]!.numberValue!), rows: Int($0["rows"]!.numberValue!)) }
      try checkEqual(result.cells, cells, "\(name) @ \(pair.key)")
    }
  }
  return n
}

public func checkCatalogueAndVocabulary() throws -> Int {
  let fixture = try Fixture.load()
  try checkEqual(fixture.viewport().catalogue() + "\n", loadVectorText("catalogue.txt"), "catalogue")
  try checkEqual(fixture.store().vocabulary() + "\n", loadVectorText("vocabulary.txt"), "vocabulary")
  return 2
}

public func checkMoviesCatalogueAndVocabulary() throws -> Int {
  let movies = try MoviesFixture.load()
  try checkEqual(movies.viewport.catalogue() + "\n", loadVectorText("movies-catalogue.txt"), "movies catalogue")
  let store = Store(initial: movies.viewport.initial(), actions: movies.viewport.actions)
  try checkEqual(store.vocabulary() + "\n", loadVectorText("movies-vocabulary.txt"), "movies vocabulary")
  return 2
}

public func checkWire() throws -> Int {
  try runWireFile("wire.json")
}

public func checkMoviesWire() throws -> Int {
  try runWireFile("movies-wire.json")
}

private func runWireFile(_ name: String) throws -> Int {
  let file = try loadVector(name)
  var n = 0
  for c in file["cases"]!.arrayValue! {
    n += 1
    let caseName = c["name"]!.stringValue!
    let runtime = WireRuntime(entities: wireSpec(from: file["spec"]!))
    try checkEqual(runtime.legend(), file["legend"]!.stringValue!, caseName)
    try checkEqual(runtime.encodeRows(wireRows(from: c["rows"]!)), c["encode"]!.stringValue!, caseName)
    for r in c["resolves"]?.arrayValue ?? [] {
      let resolved = runtime.resolve(action(from: r["action"]!), params: params(from: r["params"]!))
      try checkEqual(canonicalJSON(actionJSON(resolved)), canonicalJSON(r["expect"]!), caseName)
    }
  }
  return n
}

/// Every check suite, in order.
public let allChecks: [(name: String, run: @Sendable () throws -> Int)] = [
  ("validate", checkValidate),
  ("place", checkPlace),
  ("defineComponent", checkDefineComponent),
  ("createViewport", checkCreateViewport),
  ("viewport scenarios", checkViewportScenarios),
  ("layout", checkLayout),
  ("catalogue + vocabulary", checkCatalogueAndVocabulary),
  ("movies catalogue + vocabulary", checkMoviesCatalogueAndVocabulary),
  ("wire", checkWire),
  ("movies wire", checkMoviesWire),
]
