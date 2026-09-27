// The movies data layer, ported from demos/canvas/lib/movies.ts: rows → the
// numbers a component draws. ZQL has no sorting or aggregation, so those live
// in the view spec (sort, limit, sum/count/avg of a field), applied to zega's
// rows here. The checks in the catalogue use these, so a bad query rejects
// with the same fix-shaped reason as on the web.
import Foundation
import Rixse

private let AGG = try! NSRegularExpression(pattern: #"^(sum|count|avg|max|min)\(([\w.]*)\)$"#)

private func aggParts(_ spec: String) -> (fn: String, path: String)? {
  let s = spec.trimmingCharacters(in: .whitespaces)
  guard let m = AGG.firstMatch(in: s, range: NSRange(s.startIndex..., in: s)),
        let fn = Range(m.range(at: 1), in: s),
        let path = Range(m.range(at: 2), in: s) else { return nil }
  return (String(s[fn]), String(s[path]))
}

/// Every value at a dotted path, flattening arrays on the way ("movies.gross").
func atPath(_ row: JSONValue, _ path: String) -> [JSONValue] {
  var cur: [JSONValue] = [row]
  for key in path.split(separator: ".").map(String.init) where !key.isEmpty {
    cur = cur.flatMap { v in v.arrayValue ?? [v] }.compactMap { $0[key] }
  }
  return cur.flatMap { v in v.arrayValue ?? [v] }
}

/// JS Number(v): numbers as-is, strings parsed, booleans 0/1, null 0, else NaN (filtered).
private func jsNumberValue(_ v: JSONValue) -> Double? {
  switch v {
  case .number(let d): return d
  case .string(let s): return Double(s.trimmingCharacters(in: .whitespaces))
  case .bool(let b): return b ? 1 : 0
  case .null: return 0
  default: return nil
  }
}

/// JS String(v).
func jsText(_ v: JSONValue) -> String {
  switch v {
  case .string(let s): return s
  case .number(let d): return jsNumber(d)
  case .bool(let b): return b ? "true" : "false"
  case .null: return "null"
  case .array(let a): return a.map(jsText).joined(separator: ",")
  case .object: return "[object Object]"
  }
}

/// A value spec on one row: a field path, or sum/count/avg/max/min(path).
func valueOf(_ row: JSONValue, _ spec: String) -> Double? {
  let m = aggParts(spec)
  let vals = atPath(row, m?.path ?? spec.trimmingCharacters(in: .whitespaces))
  if m?.fn == "count" { return Double(vals.count) }
  let nums = vals.compactMap(jsNumberValue)
  if nums.isEmpty { return nil }
  guard let fn = m?.fn else { return nums[0] }
  switch fn {
  case "sum": return nums.reduce(0, +)
  case "avg": return nums.reduce(0, +) / Double(nums.count)
  case "max": return nums.max()!
  default: return nums.min()!
  }
}

func labelOf(_ row: JSONValue, _ spec: String) -> String {
  let joined = atPath(row, spec.isEmpty ? "title" : spec).map(jsText).joined(separator: ", ")
  if !joined.isEmpty { return joined }
  return atPath(row, "name").first.map(jsText) ?? ""
}

struct Datum: Equatable {
  var label: String
  var value: Double
}

/// What a component reads from its item (the materialised params of the JS View).
struct ViewSpec {
  var label: String = ""
  var value: String = ""
  var sort: String = ""
  var limit: Double = 0
  var x: String = ""
  var flag: String = "none"
  var threshold: Double = 0
  var notes: String = ""
  var title: String = ""

  init(_ item: Item) {
    label = item.extra["label"]?.stringValue ?? ""
    value = item.extra["value"]?.stringValue ?? ""
    sort = item.extra["sort"]?.stringValue ?? ""
    limit = item.extra["limit"]?.numberValue ?? 0
    x = item.extra["x"]?.stringValue ?? ""
    flag = item.extra["flag"]?.stringValue ?? "none"
    threshold = item.extra["threshold"]?.numberValue ?? 0
    notes = item.extra["notes"]?.stringValue ?? ""
    title = item.title
  }
}

/// Rows → the numbers a bar or pie chart draws. Rows with the same label are
/// grouped (films of one year become one bar): summed, or averaged/maxed/mined
/// when the value spec says so. Then sorted and cut exactly as the view says.
func series(_ rows: [JSONValue], _ v: ViewSpec) -> [Datum] {
  let how = aggParts(v.value)?.fn ?? "sum"
  var groups: [String: [Double]] = [:]
  var groupOrder: [String] = []
  for r in rows {
    let label = labelOf(r, v.label)
    guard let value = valueOf(r, v.value), !label.isEmpty else { continue }
    if groups[label] == nil { groupOrder.append(label) }
    groups[label, default: []].append(value)
  }
  var data: [Datum] = groupOrder.map { label in
    let vals = groups[label]!
    let value: Double
    switch how {
    case "avg": value = vals.reduce(0, +) / Double(vals.count)
    case "max": value = vals.max()!
    case "min": value = vals.min()!
    default: value = vals.reduce(0, +)
    }
    return Datum(label: label, value: value)
  }
  let parts = (v.sort.isEmpty ? "value desc" : v.sort).split(whereSeparator: { $0 == " " || $0 == "\t" || $0 == "\n" }).map(String.init)
  let key = parts.first ?? "value"
  let sign: Double = parts.count > 1 && parts[1] == "asc" ? 1 : -1
  data.sort { a, b in
    if key == "label" {
      // JS localeCompare with numeric: true
      return a.label.localizedStandardCompare(b.label) == (sign > 0 ? .orderedAscending : .orderedDescending)
    }
    return (a.value - b.value) * sign < 0
  }
  return v.limit > 0 ? Array(data.prefix(Int(v.limit))) : data
}

/// A stat's one number (summed over rows, or as the value spec says) and its
/// caption: the row's name when there is one real name, else the view's title.
func statOf(_ rows: [JSONValue], _ v: ViewSpec) -> (value: Double, caption: String)? {
  let vals = rows.compactMap { valueOf($0, v.value) }
  if vals.isEmpty { return nil }
  let how = aggParts(v.value)?.fn
  let value: Double
  switch how {
  case "avg": value = vals.reduce(0, +) / Double(vals.count)
  case "max": value = vals.max()!
  case "min": value = vals.min()!
  default: value = vals.reduce(0, +)
  }
  var seen = Set<String>()
  var names: [String] = []
  let numeric = try! NSRegularExpression(pattern: #"^[\d.,\s]+$"#)
  for l in rows.map({ labelOf($0, v.label) }) where !l.isEmpty && !seen.contains(l) {
    if numeric.firstMatch(in: l, range: NSRange(l.startIndex..., in: l)) == nil {
      seen.insert(l)
      names.append(l)
    }
  }
  return (value, names.count == 1 ? names[0] : v.title)
}

struct LinePoint: Equatable { var x: Double; var y: Double }
struct LineSeries: Equatable { var name: String; var points: [LinePoint] }
struct LineFlag: Equatable { var series: String; var x: Double; var from: Double; var to: Double; var pct: Int }
struct LineData: Equatable { var series: [LineSeries]; var flags: [LineFlag]; var xs: [Double] }

/// Rows → line series. label names each series, x and value are paths that may
/// reach into a nested list: each nested item gives a point, grouped per
/// (series, x) by the value's aggregate. The axis spans whole years; each
/// series has points only where it has data (the line joins across gaps), and
/// drops/rises of at least `threshold` percent are computed here.
func lineData(_ rows: [JSONValue], _ v: ViewSpec) -> LineData {
  let m = aggParts(v.value)
  let fn = m?.fn ?? "sum"
  let valuePath = m?.path ?? v.value.trimmingCharacters(in: .whitespaces)
  let xPath = v.x.trimmingCharacters(in: .whitespaces).isEmpty ? "year" : v.x.trimmingCharacters(in: .whitespaces)
  let common: (String, String) -> String = { a, b in
    let pa = a.split(separator: ".").map(String.init), pb = b.split(separator: ".").map(String.init)
    var i = 0
    while i < pa.count - 1 && i < pb.count - 1 && pa[i] == pb[i] { i += 1 }
    return pa.prefix(i).joined(separator: ".")
  }
  let prefix = common(xPath, valuePath.isEmpty ? xPath : valuePath)
  let strip: (String) -> String = { path in
    prefix.isEmpty ? path : String(path.dropFirst(prefix.count + 1))
  }
  let agg: ([Double]) -> Double = { ys in
    switch fn {
    case "avg": return ys.reduce(0, +) / Double(ys.count)
    case "max": return ys.max()!
    case "min": return ys.min()!
    default: return ys.reduce(0, +)
    }
  }
  var groups: [String: [Double: [Double]]] = [:]
  var seriesOrder: [String] = []
  for row in rows {
    let name = labelOf(row, v.label).isEmpty ? "total" : labelOf(row, v.label)
    let items: [JSONValue]
    if prefix.isEmpty {
      items = [row]
    } else {
      items = atPath(row, prefix).filter { $0.isObject }
    }
    if groups[name] == nil { seriesOrder.append(name) }
    for it in items {
      guard let x = atPath(it, strip(xPath)).first.flatMap(jsNumberValue), x != 0 else { continue }
      let y: Double
      if fn == "count" {
        y = 1
      } else {
        guard let n = atPath(it, strip(valuePath)).first.flatMap(jsNumberValue) else { continue }
        y = n
      }
      groups[name, default: [:]][x, default: []].append(y)
    }
  }
  var allX = Array(Set(groups.values.flatMap { $0.keys })).sorted()
  // Trim a long, near-empty lead-in: start where some series first reaches 20% of the overall peak.
  let totalAt: (Double) -> Double = { x in
    groups.values.map { g in g[x].map(agg) ?? 0 }.max() ?? 0
  }
  let overall = allX.map(totalAt).max() ?? 0
  if let firstBig = allX.firstIndex(where: { totalAt($0) >= overall * 0.2 }), firstBig > 1 {
    allX = Array(allX[(firstBig - 1)...])
  }
  let whole = allX.allSatisfy { $0 == $0.rounded() }
  let xs: [Double]
  if whole && !allX.isEmpty {
    xs = (Int(allX.first!)...Int(allX.last!)).map(Double.init)
  } else {
    xs = allX
  }
  let lo = xs.first ?? -.infinity
  var series: [LineSeries] = seriesOrder.compactMap { name in
    guard let g = groups[name] else { return nil }
    let points = g.keys.filter { $0 >= lo }.sorted().map { LinePoint(x: $0, y: agg(g[$0]!)) }
    return LineSeries(name: name, points: points)
  }
  .filter { s in s.points.contains { $0.y > 0 } }
  series.sort { a, b in
    a.points.reduce(0) { $0 + $1.y } > b.points.reduce(0) { $0 + $1.y }
  }
  let limit = v.limit > 0 ? Int(v.limit) : 5
  series = Array(series.prefix(limit))
  var flags: [LineFlag] = []
  let th = (v.threshold > 0 ? v.threshold : 25) / 100
  if !v.flag.isEmpty && v.flag != "none" {
    for s in series {
      let peakOf = s.points.map(\.y).max() ?? 0
      var changes: [(x: Double, from: Double, to: Double, pct: Double)] = []
      for i in 1..<s.points.count where s.points.count > 1 {
        let from = s.points[i - 1].y
        let to = s.points[i].y
        let pct = from > 0 ? (to - from) / from : 0
        // A change only counts from a meaningful level: at least 15% of the series' peak.
        if from >= peakOf * 0.15 && (v.flag == "both" || (v.flag == "drops" ? pct <= -th : pct >= th)) && abs(pct) >= th {
          changes.append((s.points[i].x, from, to, pct))
        }
      }
      changes.sort { abs($0.pct) > abs($1.pct) }
      for c in changes.prefix(2) {
        flags.append(LineFlag(series: s.name, x: c.x, from: c.from, to: c.to, pct: Int((c.pct * 100).rounded())))
      }
    }
  }
  return LineData(series: series, flags: flags, xs: xs)
}

/// How many bars or slices a view may draw; the rest are summarised, never dropped silently.
let CAP = (bar: 30, pie: 8)

/// What a chart actually draws: at most CAP items; a pie folds the rest into "Other".
func capped(_ data: [Datum], _ kind: String) -> (data: [Datum], hidden: Int) {
  let cap = kind == "bar" ? CAP.bar : CAP.pie
  if data.count <= cap { return (data, 0) }
  if kind == "bar" { return (Array(data.prefix(cap)), data.count - cap) }
  let rest = data[(cap - 1)...]
  return (Array(data.prefix(cap - 1)) + [Datum(label: "Other (\(rest.count))", value: rest.reduce(0) { $0 + $1.value })], rest.count)
}

/// A zega error, made actionable: for the mistakes models make most, the
/// schema tells us the exact correction, so the rejection says it.
func hintFor(_ error: String, _ schema: String) -> String {
  func firstMatch(_ pattern: String, in text: String, _ group: Int) -> String? {
    guard let re = try? NSRegularExpression(pattern: pattern),
          let m = re.firstMatch(in: text, range: NSRange(text.startIndex..., in: text)),
          let r = Range(m.range(at: group), in: text) else { return nil }
    return String(text[r])
  }
  // "Movie.genres does not reach name": a relationship needs its type and braces.
  if let type = firstMatch(#"(\w+)\.(\w+) does not reach (\w+)"#, in: error, 1),
     let rel = firstMatch(#"(\w+)\.(\w+) does not reach (\w+)"#, in: error, 2),
     let field = firstMatch(#"(\w+)\.(\w+) does not reach (\w+)"#, in: error, 3),
     let block = firstMatch("type \(type) \\{([\\s\\S]*?)\\n\\s*\\}", in: schema, 1),
     let arrow = firstMatch("\\b\(rel):\\s*\\w+\\s*(->|<-)\\s*(\\w+)", in: block, 1),
     let target = firstMatch("\\b\(rel):\\s*\\w+\\s*(->|<-)\\s*(\\w+)", in: block, 2) {
    return " Fix: follow it with its arrow, type and braces — write `\(rel) \(arrow) \(target) { \(field) }`."
  }
  // "Person.acted_in does not point ->": the arrow is the other way.
  if let rel = firstMatch(#"(\w+)\.(\w+) does not point (->|<-)"#, in: error, 2),
     let dir = firstMatch(#"(\w+)\.(\w+) does not point (->|<-)"#, in: error, 3) {
    return " Fix: write `\(rel) \(dir == "->" ? "<-" : "->") …`."
  }
  return ""
}
