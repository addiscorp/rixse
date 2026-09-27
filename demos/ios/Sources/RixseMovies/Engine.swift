// The real zega engine in the app, over the C ABI of ZegaEngine.xcframework —
// the same calls the web demo's wasm build makes (demos/canvas/lib/zega.ts):
// load the document's locations, apply it with their raw texts, then run ZQL
// synchronously in milliseconds. Errors carry the engine's own message, so the
// rixse source's hint rewrites them into the same fixes as on the web.
import Foundation
import Rixse
import ZegaEngine

enum ZegaLoadError: Error, CustomStringConvertible {
  case message(String)
  var description: String {
    if case .message(let m) = self { return m }
    return "zega failed"
  }
}

final class Zega {
  struct EngineError: Error, CustomStringConvertible {
    let message: String
    var description: String { message }
  }

  private let handle: OpaquePointer
  /// The full samples document (schema, unique, mutations) — passed to run, like the web demo.
  let source: String
  /// The `schema { … }` text the model sees (same slice as the web demo computes).
  let schema: String
  let loadMs: Int

  private init(handle: OpaquePointer, source: String, schema: String, loadMs: Int) {
    self.handle = handle
    self.source = source
    self.schema = schema
    self.loadMs = loadMs
  }

  deinit { zega_ios_free(handle) }

  private static func envelope(_ ptr: UnsafeMutablePointer<CChar>?) throws -> JSONValue {
    guard let ptr else { throw ZegaLoadError.message("zega returned nothing") }
    defer { zega_ios_free_string(ptr) }
    let text = String(cString: ptr)
    let value = try parseJSON(text)
    if let err = value["err"]?.stringValue { throw EngineError(message: err) }
    return value["ok"] ?? .null
  }

  /// Load the bundled samples the same way the web demo fetches them.
  static func load() throws -> Zega {
    let t0 = Date()
    guard let dir = Bundle.main.resourceURL?.appendingPathComponent("zega"),
          let sourceURL = Bundle.main.resourceURL?.appendingPathComponent("zega/samples/movies.zql"),
          let source = try? String(contentsOf: sourceURL, encoding: .utf8) else {
      throw ZegaLoadError.message("the movies samples are missing from the app bundle")
    }
    var sources: [(String, JSONValue)] = []
    for loc in try envelope(zega_ios_load_locations(source, true)).arrayValue ?? [] {
      guard let loc = loc.stringValue else { continue }
      let rel = loc.hasPrefix("./") ? String(loc.dropFirst(2)) : loc
      let text = try String(contentsOf: dir.appendingPathComponent(rel), encoding: .utf8)
      sources.append((loc, .string(text)))
    }
    guard let handle = zega_ios_new() else { throw ZegaLoadError.message("zega failed to start") }
    _ = try envelope(zega_ios_apply_with_sources(handle, source, jsStringify(jsonObject(sources))))
    guard let from = source.range(of: "schema {"), let to = source.range(of: "display {") else {
      throw ZegaLoadError.message("movies.zql has no schema/display blocks")
    }
    let schema = source[from.lowerBound..<to.lowerBound].trimmingCharacters(in: .whitespacesAndNewlines) + "\n}"
    return Zega(handle: handle, source: source, schema: schema, loadMs: Int(Date().timeIntervalSince(t0) * 1000))
  }

  /// Run one ZQL read query, like the web demo's `run(schema, zql)`.
  func run(_ zql: String) throws -> [JSONValue] {
    try Zega.envelope(zega_ios_run(handle, source, zql)).arrayValue ?? []
  }
}
