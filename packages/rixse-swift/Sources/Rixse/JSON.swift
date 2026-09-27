// A JSON value whose objects keep document order. The JS core's vocabulary,
// catalogue and validation iterate object keys in insertion order, so matching
// its output byte-for-byte takes ordered objects — Swift dictionaries are not.
import Foundation

public enum JSONValue: Sendable {
  case null
  case bool(Bool)
  case number(Double)
  case string(String)
  case array([JSONValue])
  case object([Pair])

  public struct Pair: Sendable {
    public let key: String
    public let value: JSONValue
    public init(_ key: String, _ value: JSONValue) {
      self.key = key
      self.value = value
    }
  }
}

extension JSONValue: Equatable {
  /// Objects compare without regard to key order, like JS deep-equal on parsed JSON.
  public static func == (a: JSONValue, b: JSONValue) -> Bool {
    switch (a, b) {
    case (.null, .null): return true
    case (.bool(let x), .bool(let y)): return x == y
    case (.number(let x), .number(let y)): return x == y
    case (.string(let x), .string(let y)): return x == y
    case (.array(let x), .array(let y)): return x == y
    case (.object(let x), .object(let y)):
      return x.count == y.count && x.allSatisfy { b[$0.key] == $0.value }
    default: return false
    }
  }
}

extension JSONValue {
  public subscript(key: String) -> JSONValue? {
    guard case .object(let pairs) = self else { return nil }
    return pairs.first { $0.key == key }?.value
  }

  public var isObject: Bool { if case .object = self { return true }; return false }
  public var objectPairs: [Pair] { guard case .object(let pairs) = self else { return [] } ; return pairs }
  public var arrayValue: [JSONValue]? { guard case .array(let a) = self else { return nil }; return a }
  public var stringValue: String? { guard case .string(let s) = self else { return nil }; return s }
  public var numberValue: Double? { guard case .number(let n) = self else { return nil }; return n }
  public var boolValue: Bool? { guard case .bool(let b) = self else { return nil }; return b }
}

// MARK: - Writing, the way JS writes it

/// An object from (key, value) pairs, in order.
public func jsonObject(_ pairs: [(String, JSONValue)]) -> JSONValue {
  .object(pairs.map(JSONValue.Pair.init))
}

/// A number the way JS String(n) writes it: integers without a fraction.
public func jsNumber(_ d: Double) -> String {
  if d == d.rounded() && abs(d) < 9_007_199_254_740_992 { return String(Int(d)) }
  return String(d)
}

/// A string the way JSON.stringify writes it (raw non-ASCII, lowercase \uXXXX for control chars).
public func jsQuote(_ s: String) -> String {
  var out = "\""
  for scalar in s.unicodeScalars {
    switch scalar {
    case "\"": out += "\\\""
    case "\\": out += "\\\\"
    case "\n": out += "\\n"
    case "\r": out += "\\r"
    case "\t": out += "\\t"
    case "\u{08}": out += "\\b"
    case "\u{0C}": out += "\\f"
    default:
      if scalar.value < 0x20 { out += String(format: "\\u%04x", scalar.value) }
      else { out.unicodeScalars.append(scalar) }
    }
  }
  return out + "\""
}

/// JSON.stringify for a JSONValue: keys in document order.
public func jsStringify(_ v: JSONValue) -> String {
  switch v {
  case .null: return "null"
  case .bool(let b): return b ? "true" : "false"
  case .number(let n): return jsNumber(n)
  case .string(let s): return jsQuote(s)
  case .array(let a): return "[" + a.map(jsStringify).joined(separator: ",") + "]"
  case .object(let pairs):
    return "{" + pairs.map { jsQuote($0.key) + ":" + jsStringify($0.value) }.joined(separator: ",") + "}"
  }
}

/// JSON.stringify with object keys sorted: the canonical form vectors compare by.
public func canonicalJSON(_ v: JSONValue) -> String {
  switch v {
  case .object(let pairs):
    return "{" + pairs.sorted { $0.key < $1.key }.map { jsQuote($0.key) + ":" + canonicalJSON($0.value) }.joined(separator: ",") + "}"
  case .array(let a): return "[" + a.map(canonicalJSON).joined(separator: ",") + "]"
  default: return jsStringify(v)
  }
}

// MARK: - Parsing (order-preserving)

public struct JSONParseError: Error, CustomStringConvertible, Equatable {
  public let message: String
  public var description: String { message }
  public init(_ message: String) { self.message = message }
}

public func parseJSON(_ text: String) throws -> JSONValue {
  var p = JSONParser(scalars: Array(text.unicodeScalars))
  let v = try p.value()
  p.space()
  guard p.atEnd else { throw JSONParseError("trailing characters") }
  return v
}

private struct JSONParser {
  let scalars: [Unicode.Scalar]
  var i = 0

  init(scalars: [Unicode.Scalar]) { self.scalars = scalars }

  var atEnd: Bool { i >= scalars.count }
  var peek: Unicode.Scalar? { atEnd ? nil : scalars[i] }

  mutating func space() {
    while let c = peek, c == " " || c == "\n" || c == "\t" || c == "\r" { i += 1 }
  }

  mutating func expect(_ c: Unicode.Scalar) throws {
    guard peek == c else { throw JSONParseError("expected '\(c)' at offset \(i)") }
    i += 1
  }

  mutating func value() throws -> JSONValue {
    space()
    guard let c = peek else { throw JSONParseError("unexpected end of input") }
    switch c {
    case "{": return try object()
    case "[": return try array()
    case "\"": return .string(try string())
    case "t":
      try word("true"); return .bool(true)
    case "f":
      try word("false"); return .bool(false)
    case "n":
      try word("null"); return .null
    default: return try number()
    }
  }

  mutating func word(_ w: String) throws {
    for c in w.unicodeScalars { try expect(c) }
  }

  mutating func object() throws -> JSONValue {
    try expect("{")
    var pairs: [JSONValue.Pair] = []
    space()
    if peek == "}" { i += 1; return .object(pairs) }
    while true {
      space()
      let key = try string()
      space()
      try expect(":")
      let v = try value()
      pairs.append(JSONValue.Pair(key, v))
      space()
      if peek == "}" { i += 1; return .object(pairs) }
      try expect(",")
    }
  }

  mutating func array() throws -> JSONValue {
    try expect("[")
    var items: [JSONValue] = []
    space()
    if peek == "]" { i += 1; return .array(items) }
    while true {
      items.append(try value())
      space()
      if peek == "]" { i += 1; return .array(items) }
      try expect(",")
    }
  }

  mutating func string() throws -> String {
    try expect("\"")
    var out = String.UnicodeScalarView()
    while true {
      guard let c = peek else { throw JSONParseError("unterminated string") }
      i += 1
      if c == "\"" { return String(out) }
      if c == "\\" {
        guard let e = peek else { throw JSONParseError("unterminated escape") }
        i += 1
        switch e {
        case "\"": out.append("\"")
        case "\\": out.append("\\")
        case "/": out.append("/")
        case "b": out.append("\u{08}")
        case "f": out.append("\u{0C}")
        case "n": out.append("\n")
        case "r": out.append("\r")
        case "t": out.append("\t")
        case "u":
          let hi = try hex4()
          if (0xD800...0xDBFF).contains(hi), peek == "\\" {
            i += 1
            try expect("u")
            let lo = try hex4()
            guard (0xDC00...0xDFFF).contains(lo) else { throw JSONParseError("bad surrogate pair") }
            out.append(Unicode.Scalar(0x10000 + ((hi - 0xD800) << 10) + (lo - 0xDC00))!)
          } else {
            out.append(Unicode.Scalar(hi)!)
          }
        default: throw JSONParseError("bad escape '\\(\(e))'")
        }
      } else {
        out.append(c)
      }
    }
  }

  mutating func hex4() throws -> UInt32 {
    var value: UInt32 = 0
    for _ in 0..<4 {
      guard let c = peek else { throw JSONParseError("bad \\u escape") }
      let d: UInt32
      switch c.value {
      case 48...57: d = c.value - 48 // 0-9
      case 65...70: d = c.value - 65 + 10 // A-F
      case 97...102: d = c.value - 97 + 10 // a-f
      default: throw JSONParseError("bad \\u escape")
      }
      value = value * 16 + d
      i += 1
    }
    return value
  }

  mutating func number() throws -> JSONValue {
    let start = i
    if peek == "-" { i += 1 }
    while let c = peek, "0123456789+-.eE".unicodeScalars.contains(c) { i += 1 }
    guard i > start, let d = Double(String(String.UnicodeScalarView(scalars[start..<i]))) else {
      throw JSONParseError("bad number at offset \(start)")
    }
    return .number(d)
  }
}
