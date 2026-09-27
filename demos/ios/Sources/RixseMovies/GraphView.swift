// The graph component: how movies and people connect. Rows → nodes and edges
// (every object with a title or name is a node; nesting is an edge), a small
// force layout settled before first paint, drawn on a Canvas. Tapping a node
// or edge dispatches select.set as "you" — the agent sees the selection.
// (Buoyancy and the selection fade can come later, as on the web.)
import SwiftUI
import Rixse

struct GNode: Identifiable, Equatable {
  let id: String
  let label: String
  let type: String // "movie" | "person" | "other"
  var degree: Int = 0
}

struct GLink: Equatable {
  var source: String
  var target: String
  var rel: String
}

/// Rows → a graph: every object with a title or name is a node; nesting is an edge.
func toGraph(_ rows: [JSONValue]) -> (nodes: [GNode], links: [GLink]) {
  var nodes: [String: GNode] = [:]
  var order: [String] = []
  var links: [GLink] = []

  func visit(_ value: JSONValue, parent: String?, rel: String) {
    guard value.isObject else { return }
    let label = value["title"]?.stringValue ?? value["name"]?.stringValue ?? ""
    var id = parent
    if !label.isEmpty {
      let type = value["title"] != nil ? "movie" : value["name"] != nil ? "person" : "other"
      id = "\(type):\(label)"
      if nodes[id!] == nil {
        nodes[id!] = GNode(id: id!, label: label, type: type)
        order.append(id!)
      }
      if let parent, parent != id! {
        links.append(GLink(source: parent, target: id!, rel: rel))
        nodes[parent]!.degree += 1
        nodes[id!]!.degree += 1
      }
    }
    for pair in value.objectPairs {
      if let a = pair.value.arrayValue {
        for x in a { visit(x, parent: id, rel: pair.key) }
      }
    }
  }
  for r in rows { visit(r, parent: nil, rel: "") }

  // With several movies, the story is who they share: drop people linked to only one.
  let all = order.map { nodes[$0]! }
  let movies = all.filter { $0.type == "movie" }.count
  let shared = movies >= 2 ? all.filter { $0.type == "movie" || $0.degree >= 2 } : all
  // Cap the drawing, and keep only links whose both ends survived.
  let kept = Array(shared.prefix(160))
  let ids = Set(kept.map(\.id))
  return (kept, links.filter { ids.contains($0.source) && ids.contains($0.target) }.prefix(600).map { $0 })
}

/// A small deterministic force layout: repulsion, link springs, collision and
/// a gentle center pull, settled synchronously (like the web demo ticking its
/// simulation to rest before first paint).
func forceLayout(nodes: [GNode], links: [GLink], size: CGSize) -> [String: CGPoint] {
  guard !nodes.isEmpty else { return [:] }
  var pos: [String: CGPoint] = [:]
  var vel: [String: CGVector] = [:]
  // Deterministic start: ring around the center.
  for (i, n) in nodes.enumerated() {
    let angle = Double(i) / Double(nodes.count) * 2 * .pi
    pos[n.id] = CGPoint(x: size.width / 2 + cos(angle) * 80, y: size.height / 2 + sin(angle) * 80)
    vel[n.id] = .zero
  }
  let index = Dictionary(uniqueKeysWithValues: nodes.enumerated().map { ($0.element.id, $0.offset) })
  let edges: [(Int, Int)] = links.compactMap { l in
    guard let a = index[l.source], let b = index[l.target] else { return nil }
    return (a, b)
  }
  let ids = nodes.map(\.id)
  let k = 105.0 // link distance
  let repulsion = max(140.0, 45 * sqrt(Double(nodes.count)))
  let radius = 22.0
  let pad = 10.0

  for _ in 0..<300 {
    var forces = Dictionary(uniqueKeysWithValues: ids.map { ($0, CGVector.zero) })
    // Repulsion (O(n²), n ≤ 160).
    for i in 0..<ids.count {
      for j in (i + 1)..<ids.count {
        var dx = pos[ids[i]]!.x - pos[ids[j]]!.x
        var dy = pos[ids[i]]!.y - pos[ids[j]]!.y
        var d = (dx * dx + dy * dy).squareRoot()
        if d < 1 { dx = Double(i - j) * 0.1; dy = 0.1; d = 0.14 }
        // Collide: extra push inside node + padding.
        let minD = (radius + pad) * 2
        let f = repulsion * repulsion / (d * d) + (d < minD ? (minD - d) * 2 : 0)
        let fx = dx / d * f / 60, fy = dy / d * f / 60
        forces[ids[i]]!.dx += fx; forces[ids[i]]!.dy += fy
        forces[ids[j]]!.dx -= fx; forces[ids[j]]!.dy -= fy
      }
    }
    // Springs.
    for (a, b) in edges {
      let dx = pos[ids[b]]!.x - pos[ids[a]]!.x
      let dy = pos[ids[b]]!.y - pos[ids[a]]!.y
      let d = max((dx * dx + dy * dy).squareRoot(), 1)
      let f = (d - k) * 0.05
      let fx = dx / d * f, fy = dy / d * f
      forces[ids[a]]!.dx += fx; forces[ids[a]]!.dy += fy
      forces[ids[b]]!.dx -= fx; forces[ids[b]]!.dy -= fy
    }
    // Center pull + integrate.
    for id in ids {
      forces[id]!.dx += (size.width / 2 - pos[id]!.x) * 0.01
      forces[id]!.dy += (size.height / 2 - pos[id]!.y) * 0.01
      vel[id]!.dx = (vel[id]!.dx + forces[id]!.dx) * 0.6
      vel[id]!.dy = (vel[id]!.dy + forces[id]!.dy) * 0.6
      pos[id]!.x += vel[id]!.dx
      pos[id]!.y += vel[id]!.dy
    }
  }
  return pos
}

struct GraphComponent: View {
  @EnvironmentObject var movies: MovieStore
  let item: Item
  let rows: [JSONValue]
  let selected: [String]

  private let colors: [Color] = [.init(red: 0.55, green: 0.83, blue: 0.78), .init(red: 0.75, green: 0.73, blue: 0.85), .init(red: 0.98, green: 0.5, blue: 0.45), .init(red: 0.5, green: 0.69, blue: 0.83), .init(red: 0.99, green: 0.71, blue: 0.38), .init(red: 0.7, green: 0.87, blue: 0.41)]
  private let radius = 22.0

  var body: some View {
    let graph = toGraph(rows)
    // Colours by type in first-appearance order — Set order would change between runs.
    var seenTypes = Set<String>()
    let types: [String] = graph.nodes.filter { seenTypes.insert($0.type).inserted }.map(\.type)
    let colorOf: (String) -> Color = { type in
      colors[(types.firstIndex(of: type) ?? 0) % colors.count]
    }
    ZStack(alignment: .bottomLeading) {
      GeometryReader { geo in
        let settled = settle(rows: rows, size: geo.size)
        Canvas { context, _ in
          let sel = Set(selected)
          for link in settled.graph.links {
            guard let a = settled.positions[link.source], let b = settled.positions[link.target] else { continue }
            let dx = b.x - a.x, dy = b.y - a.y
            let d = max((dx * dx + dy * dy).squareRoot(), 1)
            let r = radius * settled.scale
            let from = CGPoint(x: a.x + dx / d * r, y: a.y + dy / d * r)
            let to = CGPoint(x: b.x - dx / d * (r + 2), y: b.y - dy / d * (r + 2))
            var path = Path()
            path.move(to: from)
            path.addLine(to: to)
            let key = "\(link.source) > \(link.target)"
            context.stroke(path, with: .color(sel.contains(key) ? .orange : Color(white: 0.6)), lineWidth: sel.contains(key) ? 2.5 : 1.2)
          }
          for node in settled.graph.nodes {
            guard let p = settled.positions[node.id] else { continue }
            let r = radius * settled.scale
            let on = sel.contains(node.id)
            let rect = CGRect(x: p.x - r, y: p.y - r, width: r * 2, height: r * 2)
            context.fill(Path(ellipseIn: rect), with: .color(colorOf(node.type)))
            context.stroke(Path(ellipseIn: rect), with: .color(on ? .orange : .secondary), lineWidth: on ? 2.5 : 1)
            let label = node.label.count > 22 ? String(node.label.prefix(21)) + "…" : node.label
            context.draw(Text(label).font(.system(size: max(8, 11 * settled.scale))), at: CGPoint(x: p.x, y: p.y + r + 10 * settled.scale), anchor: .center)
          }
        }
        .contentShape(Rectangle())
        .onTapGesture { location in
          tap(at: location, settled: settled)
        }
      }
      .background(Color(uiColor: .tertiarySystemGroupedBackground))
      .clipShape(RoundedRectangle(cornerRadius: 8))
      .frame(height: 340)
      SelectionOverlay(selected: selected)
    }
  }

  /// Hit-testing: nearest node within its radius, else the nearest edge
  /// within a few points, else clear (background tap).
  private func tap(at location: CGPoint, settled: SettledGraph) {
    var bestNode: (id: String, d: Double)?
    for (id, p) in settled.positions {
      let dx = p.x - location.x, dy = p.y - location.y
      let d = (dx * dx + dy * dy).squareRoot()
      if d <= radius * settled.scale + 6 && (bestNode == nil || d < bestNode!.d) {
        bestNode = (id, d)
      }
    }
    var bestEdge: (key: String, d: Double)?
    if bestNode == nil {
      for link in settled.graph.links {
        guard let a = settled.positions[link.source], let b = settled.positions[link.target] else { continue }
        let d = distanceToSegment(location, a, b)
        if d <= 8 && (bestEdge == nil || d < bestEdge!.d) {
          bestEdge = ("\(link.source) > \(link.target)", d)
        }
      }
    }
    let action: Action
    if let bestNode {
      action = selected.contains(bestNode.id) && selected.count == 1
        ? Action("select.clear")
        : Action("select.set", payload: jsonObject([("view", .string(item.id)), ("items", .string(bestNode.id))]))
    } else if let bestEdge {
      action = selected.contains(bestEdge.key) && selected.count == 1
        ? Action("select.clear")
        : Action("select.set", payload: jsonObject([("view", .string(item.id)), ("items", .string(bestEdge.key))]))
    } else {
      action = Action("select.clear")
    }
    movies.dispatch(action, .you)
  }

  private func distanceToSegment(_ p: CGPoint, _ a: CGPoint, _ b: CGPoint) -> Double {
    let dx = b.x - a.x, dy = b.y - a.y
    let len2 = dx * dx + dy * dy
    if len2 == 0 { let px = p.x - a.x, py = p.y - a.y; return (px * px + py * py).squareRoot() }
    var t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2
    t = max(0, min(1, t))
    let q = CGPoint(x: a.x + t * dx, y: a.y + t * dy)
    let qx = p.x - q.x, qy = p.y - q.y
    return (qx * qx + qy * qy).squareRoot()
  }
}

/// The settled graph for one canvas size: positions with the fit transform
/// already applied, so drawing and hit-testing always agree. The layout runs
/// in the web demo's virtual 800×480 space and scales down to the canvas, so
/// nodes and labels come out the same apparent size as on the web.
private struct SettledGraph {
  var graph: (nodes: [GNode], links: [GLink])
  var positions: [String: CGPoint]
  var scale: Double
}

private let GRAPH_SPACE = CGSize(width: 800, height: 480)

private func settle(rows: [JSONValue], size: CGSize) -> SettledGraph {
  let graph = toGraph(rows)
  let pos = forceLayout(nodes: graph.nodes, links: graph.links, size: GRAPH_SPACE)
  let xs = pos.values.map(\.x), ys = pos.values.map(\.y)
  guard let minX = xs.min(), let maxX = xs.max(), let minY = ys.min(), let maxY = ys.max() else {
    return SettledGraph(graph: graph, positions: [:], scale: 1)
  }
  // Fit the laid-out bounds with no zoom-in cap: at phone widths the scale
  // lands near the web demo's viewBox shrink, so nodes and labels come out
  // the same apparent size as on the web.
  let margin = 90.0
  let w = max(maxX - minX + margin * 2, 1), h = max(maxY - minY + margin * 2, 1)
  let scale = min(size.width / w, size.height / h)
  let ox = (size.width - w * scale) / 2 - (minX - margin) * scale
  let oy = (size.height - h * scale) / 2 - (minY - margin) * scale
  var out: [String: CGPoint] = [:]
  for (id, p) in pos {
    out[id] = CGPoint(x: p.x * scale + ox, y: p.y * scale + oy)
  }
  return SettledGraph(graph: graph, positions: out, scale: scale)
}
