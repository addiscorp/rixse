// The Movies components in SwiftUI: stat, bar, pie, line, table. Each runs
// its own ZQL in zega (in the app) and draws the rows; taps dispatch
// select.set as "you" through the same door the agent uses.
import SwiftUI
import Charts
import Rixse

private let PALETTE: [Color] = [.init(red: 0.31, green: 0.49, blue: 1.0), .init(red: 0.89, green: 0.33, blue: 0.12), .init(red: 0.12, green: 0.62, blue: 0.42), .init(red: 0.61, green: 0.42, blue: 1.0), .init(red: 0.88, green: 0.64, blue: 0.11), .init(red: 0.88, green: 0.31, blue: 0.55), .init(red: 0.17, green: 0.7, blue: 0.75), .init(red: 0.54, green: 0.6, blue: 0.23)]

func moneyText(_ n: Double) -> String {
  if n >= 1e9 { return String(format: "$%.2fB", n / 1e9) }
  if n >= 1e6 { return "$\(Int((n / 1e6).rounded()))M" }
  return NumberFormatter.localizedString(from: NSNumber(value: n), number: .decimal)
}

func fmtText(_ n: Double, isMoney: Bool) -> String {
  isMoney ? moneyText(n) : NumberFormatter.localizedString(from: NSNumber(value: n), number: .decimal)
}

/// One number, large: the answer to "how much / how many / when".
struct StatComponent: View {
  let item: Item
  let rows: [JSONValue]

  var body: some View {
    let v = ViewSpec(item)
    if let stat = statOf(rows, v) {
      let isMoney = v.value.contains("gross")
      let isYear = v.value.contains("year") && !v.value.contains("count")
      VStack(alignment: .leading, spacing: 4) {
        Text(isMoney ? moneyText(stat.value) : isYear ? "\(Int(stat.value.rounded()))" : fmtText(stat.value, isMoney: false))
          .font(.system(size: 34, weight: .semibold))
          .monospacedDigit()
        Text("\(stat.caption)\(isMoney ? " · worldwide box office" : "")")
          .font(.callout)
          .foregroundStyle(.secondary)
      }
      .padding(.vertical, 4)
    }
  }
}

/// Compare amounts across things. Tap a bar to select it.
struct BarComponent: View {
  @EnvironmentObject var movies: MovieStore
  let item: Item
  let rows: [JSONValue]
  let selected: [String]

  var body: some View {
    let v = ViewSpec(item)
    let (data, hidden) = capped(series(rows, v), "bar")
    let isMoney = v.value.contains("gross")
    ZStack(alignment: .bottomLeading) {
      Chart(data, id: \.label) { d in
        BarMark(
          x: .value("value", d.value),
          y: .value("label", d.label)
        )
        .foregroundStyle(selected.contains(d.label) ? PALETTE[1] : PALETTE[0])
        .cornerRadius(4)
      }
      .chartXAxis {
        AxisMarks { value in
          AxisValueLabel {
            if let n = value.as(Double.self) { Text(fmtText(n, isMoney: isMoney)).font(.caption2) }
          }
          AxisGridLine()
        }
      }
      .chartYAxis {
        AxisMarks { _ in AxisValueLabel().font(.caption) }
      }
      .chartOverlay { proxy in
        Rectangle().fill(.clear).contentShape(Rectangle())
          .onTapGesture { location in
            // The bar nearest the tap, by category position on the y axis.
            guard let frame = proxy.plotFrame else { return }
            let plot = proxy[frame]
            guard plot.contains(location) else { return }
            let slot = plot.height / Double(data.count)
            let index = min(data.count - 1, max(0, Int((location.y - plot.minY) / max(slot, 1))))
            let label = data[index].label
            let action: Action = selected.contains(label) && selected.count == 1
              ? Action("select.clear")
              : Action("select.set", payload: jsonObject([("view", .string(item.id)), ("items", .string(label))]))
            movies.dispatch(action, .you)
          }
      }
      .frame(height: max(180, Double(data.count) * 30 + 20))
      if hidden > 0 {
        Text("Showing the first \(data.count) of \(data.count + hidden). Ask for a limit to change it.")
          .font(.caption2).foregroundStyle(.secondary).offset(y: 24)
      }
      SelectionOverlay(selected: selected)
    }
  }
}

/// Shares of a whole.
struct PieComponent: View {
  let item: Item
  let rows: [JSONValue]

  var body: some View {
    let v = ViewSpec(item)
    let (data, _) = capped(series(rows, v), "pie")
    let isMoney = v.value.contains("gross")
    let total = data.reduce(0) { $0 + $1.value }
    HStack(alignment: .center, spacing: 16) {
      Chart {
        ForEach(Array(data.enumerated()), id: \.offset) { i, d in
          SectorMark(
            angle: .value("value", d.value),
            innerRadius: .ratio(0.45),
            angularInset: 1.5
          )
          .foregroundStyle(PALETTE[i % PALETTE.count])
        }
      }
      .chartLegend(.hidden)
      .frame(width: 180, height: 180)
      VStack(alignment: .leading, spacing: 4) {
        ForEach(Array(data.enumerated()), id: \.offset) { i, d in
          HStack(spacing: 6) {
            Circle().fill(PALETTE[i % PALETTE.count]).frame(width: 9, height: 9)
            Text(d.label).font(.caption).lineLimit(1)
            Spacer()
            Text("\(total > 0 ? Int((d.value / total * 100).rounded()) : 0)%")
              .font(.caption).monospacedDigit().foregroundStyle(.secondary)
          }
        }
      }
      .frame(maxWidth: .infinity, alignment: .leading)
    }
    .accessibilityLabel("\(item.title): pie chart of \(fmtText(total, isMoney: isMoney)) total")
  }
}

/// Change over time, with the story drawn on it: the big drops/rises computed
/// from the data, the agent's notes at years. Tap a year for a "now" marker —
/// the selection the agent sees.
struct LineComponent: View {
  @EnvironmentObject var movies: MovieStore
  let item: Item
  let rows: [JSONValue]
  let selected: [String]

  private let colors: [Color] = [.init(red: 0.94, green: 0.52, blue: 0.37), .init(red: 0.24, green: 0.77, blue: 0.6), .init(red: 0.91, green: 0.93, blue: 0.94), .init(red: 0.43, green: 0.61, blue: 1.0), .init(red: 0.77, green: 0.61, blue: 1.0)]

  var body: some View {
    let v = ViewSpec(item)
    let data = lineData(rows, v)
    let isMoney = v.value.contains("gross")
    let focusX = selected.compactMap { i -> Double? in
      guard i.hasPrefix("x:") else { return nil }
      return Double(i.dropFirst(2))
    }.first
    let notes = v.notes.split(separator: "|").compactMap { n -> (x: Double, text: String)? in
      let parts = n.split(separator: ":")
      guard let x = Double(parts.first ?? ""), parts.count > 1 else { return nil }
      let text = parts.dropFirst().joined(separator: ":").trimmingCharacters(in: .whitespaces)
      return data.xs.contains(x) && !text.isEmpty ? (x, text) : nil
    }
    ZStack(alignment: .topLeading) {
      Chart {
        ForEach(Array(data.series.enumerated()), id: \.offset) { i, s in
          ForEach(s.points, id: \.x) { p in
            LineMark(
              x: .value("year", p.x),
              y: .value("value", p.y),
              series: .value("series", s.name)
            )
            .foregroundStyle(colors[i % colors.count])
            .lineStyle(.init(lineWidth: 2.4))
            .interpolationMethod(.catmullRom)
          }
          if let base = s.points.first(where: { $0.y > 0 }) {
            RuleMark(y: .value("base", base.y))
              .foregroundStyle(colors[i % colors.count].opacity(0.35))
              .lineStyle(.init(lineWidth: 1, dash: [5, 5]))
          }
          if let last = s.points.last {
            PointMark(x: .value("year", last.x), y: .value("value", last.y))
              .foregroundStyle(colors[i % colors.count])
              .symbolSize(30)
          }
        }
        ForEach(Array(data.flags.enumerated()), id: \.offset) { _, fl in
          PointMark(x: .value("year", fl.x), y: .value("value", fl.to))
            .foregroundStyle(.red)
            .symbolSize(60)
            .annotation(position: .top, spacing: 4) {
              Text("\(fl.pct > 0 ? "▲" : "▼") \(abs(fl.pct))% \(fl.pct > 0 ? "rise" : "drop")")
                .font(.caption2.weight(.semibold))
                .foregroundStyle(.red)
                .padding(.horizontal, 6)
                .padding(.vertical, 2)
                .background(Color.red.opacity(0.12))
                .clipShape(Capsule())
            }
        }
        ForEach(Array(notes.enumerated()), id: \.offset) { _, n in
          RuleMark(x: .value("year", n.x))
            .foregroundStyle(.secondary.opacity(0.4))
            .lineStyle(.init(lineWidth: 1, dash: [2, 4]))
            .annotation(position: .top, spacing: 2) {
              Text(n.text).font(.caption2).foregroundStyle(.secondary)
            }
        }
        if let focusX, data.xs.contains(focusX) {
          RuleMark(x: .value("year", focusX))
            .foregroundStyle(Color(red: 0.43, green: 0.61, blue: 1.0))
            .annotation(position: .top, spacing: 2) {
              Text("\(Int(focusX))")
                .font(.caption2.weight(.semibold))
                .foregroundStyle(Color(red: 0.43, green: 0.61, blue: 1.0))
            }
        }
      }
      .chartYAxis {
        AxisMarks { value in
          AxisValueLabel {
            if let n = value.as(Double.self) { Text(fmtText(n, isMoney: isMoney)).font(.caption2) }
          }
          AxisGridLine()
        }
      }
      .chartXAxis {
        AxisMarks { value in
          AxisValueLabel {
            if let n = value.as(Double.self) { Text("\(Int(n))").font(.caption2) }
          }
        }
      }
      .chartOverlay { proxy in
        Rectangle().fill(.clear).contentShape(Rectangle())
          .onTapGesture { location in
            guard let frame = proxy.plotFrame else { return }
            let plot = proxy[frame]
            guard plot.contains(location), !data.xs.isEmpty else { return }
            let span = data.xs.last! - data.xs.first!
            let fraction = (location.x - plot.minX) / max(plot.width, 1)
            let raw = data.xs.first! + span * fraction
            let nearest = data.xs.min(by: { abs($0 - raw) < abs($1 - raw) })!
            let sel = "x:\(Int(nearest))"
            let action: Action = selected.contains(sel)
              ? Action("select.clear")
              : Action("select.set", payload: jsonObject([("view", .string(item.id)), ("items", .string(sel))]))
            movies.dispatch(action, .you)
          }
      }
      .frame(height: 260)
      SelectionOverlay(selected: selected)
    }
  }
}

/// Detail rows: scalar fields as-is, nested lists as their names.
struct TableComponent: View {
  let rows: [JSONValue]

  private var flat: [[String: JSONValue]] {
    rows.flatMap { r -> [[String: JSONValue]] in
      let pairs = r.objectPairs
      let nestedKey = pairs.first { ($0.value.arrayValue ?? []).contains { $0.isObject } }?.key
      if rows.count <= 3, let nestedKey, let nested = r[nestedKey]?.arrayValue {
        return nested.map { Dictionary($0.objectPairs.map { ($0.key, $0.value) }) { a, _ in a } }
      }
      return [Dictionary(pairs.map { ($0.key, $0.value) }) { a, _ in a }]
    }
  }

  private func cell(_ v: JSONValue?, _ key: String) -> String {
    guard let v else { return "" }
    if let a = v.arrayValue {
      return a.map { x in
        x.isObject ? (x["name"]?.stringValue ?? x["title"]?.stringValue ?? "") : jsText(x)
      }.filter { !$0.isEmpty }.joined(separator: ", ")
    }
    if case .number(let n) = v, key.contains("gross") { return moneyText(n) }
    return jsText(v)
  }

  var body: some View {
    let flat = flat
    let rank: (String) -> Int = { $0 == "title" || $0 == "name" ? 0 : 1 }
    var seen = Set<String>()
    var cols: [String] = []
    for r in flat {
      for k in r.keys where !seen.contains(k) {
        seen.insert(k)
        cols.append(k)
      }
    }
    cols = cols.sorted { rank($0) < rank($1) }.prefix(6).map { $0 }
    ScrollView([.horizontal, .vertical]) {
      Grid(alignment: .leading, horizontalSpacing: 16, verticalSpacing: 6) {
        GridRow {
          ForEach(cols, id: \.self) { c in Text(c).font(.caption.weight(.semibold)) }
        }
        Divider()
        ForEach(Array(flat.prefix(100).enumerated()), id: \.offset) { _, r in
          GridRow {
            ForEach(cols, id: \.self) { c in
              Text(cell(r[c], c)).font(.caption).lineLimit(1)
            }
          }
        }
      }
      .padding(.vertical, 4)
    }
    .frame(maxHeight: 320)
  }
}
