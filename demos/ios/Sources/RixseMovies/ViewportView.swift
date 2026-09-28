// view(state) for the movies vocabulary: the viewport lays the components out
// from layout(), using its own container width (GeometryReader), never the
// window. The agent never positions anything.
import SwiftUI
import Rixse

extension MovieStore {
  /// A component's rows, cached by its full identity: the queries are
  /// deterministic and the database never changes after load.
  private static var rowsCache: [String: (rows: [JSONValue], ms: Double, error: String?)] = [:]

  func rowsFor(_ item: Item) -> (rows: [JSONValue], ms: Double, error: String?) {
    let key = jsStringify(item.toJSON())
    if let hit = MovieStore.rowsCache[key] { return hit }
    let t = Date()
    let result: (rows: [JSONValue], ms: Double, error: String?)
    do {
      result = (try engine.run(item.query), Date().timeIntervalSince(t) * 1000, nil)
    } catch {
      result = ([], 0, "\(error)")
    }
    MovieStore.rowsCache[key] = result
    return result
  }
}

/// Row-by-row packing of layout() cells: a cell wider than the space left in
/// the row wraps to the next one, like the web demo's CSS grid.
private func rows(cells: [LayoutCell], cols: Int) -> [[LayoutCell]] {
  var out: [[LayoutCell]] = [[]]
  var used = 0
  for cell in cells {
    if used > 0 && used + cell.cols > cols {
      out.append([])
      used = 0
    }
    out[out.count - 1].append(cell)
    used += cell.cols
  }
  return out
}

struct ViewportView: View {
  @EnvironmentObject var movies: MovieStore

  var body: some View {
    GeometryReader { geo in
      let grid = layout(movies.state, width: geo.size.width)
      ScrollViewReader { proxy in
        ScrollView {
          if movies.state.order.isEmpty {
            Text("Ask about movies, e.g. “top 10 movies by box office”, “box office by genre”, “movies Tom Hanks and Meg Ryan are both in”.")
              .font(.callout)
              .foregroundStyle(.secondary)
              .padding(24)
              .frame(maxWidth: .infinity, alignment: .leading)
          } else {
            VStack(spacing: 12) {
              ForEach(Array(rows(cells: grid.cells, cols: grid.cols).enumerated()), id: \.offset) { _, row in
                HStack(alignment: .top, spacing: 12) {
                  ForEach(row, id: \.id) { cell in
                    if let item = movies.state.items[cell.id] {
                      ComponentCard(item: item)
                        .frame(width: cellWidth(cell, in: grid.cols, container: geo.size.width), alignment: .top)
                        .id(item.id)
                    }
                  }
                }
              }
            }
            .padding(12)
          }
        }
        // The agent added or changed a component: the newest answer is what
        // you see — scroll it into view (the card itself highlights). State
        // lands a Task-hop after dispatch, so try on both signals; scrollTo
        // is idempotent.
        .onChange(of: movies.lastChange) { _, _ in scrollToLastChange(proxy) }
        .onChange(of: movies.state.order) { _, _ in scrollToLastChange(proxy) }
      }
      .background(Color(uiColor: .systemGroupedBackground))
    }
  }

  private func scrollToLastChange(_ proxy: ScrollViewProxy) {
    guard let change = movies.lastChange, movies.state.order.contains(change.view) else { return }
    withAnimation { proxy.scrollTo(change.view) }
  }

  private func cellWidth(_ cell: LayoutCell, in cols: Int, container width: Double) -> CGFloat {
    let spacing = 12.0
    let unit = (width - 24 - spacing * Double(cols - 1)) / Double(cols)
    return unit * Double(cell.cols) + spacing * Double(cell.cols - 1)
  }
}

/// One component with its card chrome: title, and the same readout as the web
/// (kind · rows · zega ms). A broken component shows its own error.
struct ComponentCard: View {
  @EnvironmentObject var movies: MovieStore
  let item: Item

  var body: some View {
    let result = movies.rowsFor(item)
    let selected = movies.state.selection?.view == item.id ? movies.state.selection!.items : []
    VStack(alignment: .leading, spacing: 8) {
      VStack(alignment: .leading, spacing: 2) {
        Text(item.title).font(.headline)
        Text("\(item.kind) · \(result.rows.count) rows\(result.error == nil ? String(format: " · zega %.1f ms", result.ms) : "")")
          .font(.caption2)
          .foregroundStyle(.secondary)
          .lineLimit(1)
      }
      if let error = result.error {
        Text(error).font(.caption).foregroundStyle(.red)
      } else {
        ComponentBody(item: item, rows: result.rows, selected: selected)
      }
    }
    .padding(12)
    .background(Color(uiColor: .secondarySystemGroupedBackground))
    .clipShape(RoundedRectangle(cornerRadius: 12))
    // The component the agent just added or changed flashes a highlight.
    .overlay(
      RoundedRectangle(cornerRadius: 12)
        .stroke(Color.accentColor, lineWidth: 2)
        .opacity(movies.highlightedView == item.id ? 1 : 0)
        .animation(.easeOut(duration: 0.3), value: movies.highlightedView)
    )
    .accessibilityElement(children: .contain)
    .accessibilityLabel(item.title)
    .accessibilityIdentifier("component.\(item.id)")
  }
}

struct ComponentBody: View {
  @EnvironmentObject var movies: MovieStore
  let item: Item
  let rows: [JSONValue]
  let selected: [String]

  var body: some View {
    switch item.kind {
    case "stat": StatComponent(item: item, rows: rows)
    case "line": LineComponent(item: item, rows: rows, selected: selected)
    case "bar": BarComponent(item: item, rows: rows, selected: selected)
    case "pie": PieComponent(item: item, rows: rows)
    case "table": TableComponent(rows: rows)
    default: GraphComponent(item: item, rows: rows, selected: selected)
    }
  }
}

/// What is selected, overlaid where it never moves the layout (APS 2).
struct SelectionOverlay: View {
  @EnvironmentObject var movies: MovieStore
  let selected: [String]

  private func clean(_ item: String) -> String {
    item.replacingOccurrences(of: #"(^|> )(person|movie|other):"#, with: "$1", options: .regularExpression)
  }

  var body: some View {
    if !selected.isEmpty {
      HStack(spacing: 6) {
        Text("Selected").font(.caption2).foregroundStyle(.secondary)
        ForEach(selected, id: \.self) { item in
          Text(clean(item))
            .font(.caption2)
            .padding(.horizontal, 5)
            .padding(.vertical, 2)
            .overlay(RoundedRectangle(cornerRadius: 4).stroke(Color.orange, lineWidth: 1))
        }
        Button("clear") { movies.dispatch(Action("select.clear"), .you) }
          .font(.caption2)
      }
      .padding(.horizontal, 8)
      .padding(.vertical, 4)
      .background(.ultraThinMaterial)
      .clipShape(RoundedRectangle(cornerRadius: 8))
      .padding(6)
    }
  }
}
