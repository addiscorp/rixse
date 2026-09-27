// The movies vocabulary, ported from demos/canvas/lib/movies.ts: the six
// components, the zega data source, the brief the model reads, and the wire
// the state is sent in. The agent decides WHAT to show — a query and a chart —
// and the app runs the query in zega. The rows never pass through the model.
import Foundation
import Rixse

let FLAGS = ["none", "drops", "rises", "both"]

func fieldsList(_ rows: [JSONValue]) -> String {
  rows.first?.objectPairs.map(\.key).joined(separator: ", ") ?? ""
}

/// The movies catalogue + store + wire + brief over a loaded zega engine.
struct MoviesCatalogue {
  let engine: Zega
  let viewport: Viewport
  let store: Store<ViewportState>
  let wire: Wire<ViewportState>
  let brief: String

  init(engine: Zega) throws {
    self.engine = engine

    let source = SourceDef(
      describe: {
        """
        The movies database, queried in ZQL (-> points out of a type, <- points in):
        \(engine.schema)

        ZQL, the read queries you may write:
        - Shape: { Type(filter) limit 100000 { field field } }. Always add "limit 100000" (it covers every row) after a list filter; a filter of only equality tests means exactly ONE node.
        - Tests: = != > < >= <=, &&, ||, parentheses. Text: field findLike "x" (case-insensitive substring; prefer it for names and titles).
        - Follow a relationship inside the braces with its own arrow: { Movie(title findLike "Titanic") limit 100000 { title cast -> Person { name } } } and { Person(name findLike "Tom Hanks") limit 100000 { name acted_in <- Movie { title year } } }.
        - Filter across a relationship with has: Movie(has cast(name findLike "Tom Hanks") && has cast(name findLike "Meg Ryan")). has genres(name findLike "animated").
        - There is NO sort, count, sum or group in ZQL: fetch the rows and let the component do it with value ("sum(movies.gross)", "count(acted_in)"), sort and limit. Rows with the same label are grouped and summed.
        """
      },
      query: "one ZQL read query, shaped { Type(filter) limit 100000 { field rel -> Type { field } } }",
      run: { query in
        try engine.run(query)
      },
      hint: { error in
        let msg = error.hasPrefix("execution error: ") ? String(error.dropFirst("execution error: ".count)) : error
        let first = msg.split(separator: "\n", omittingEmptySubsequences: false).first(where: { $0.contains("error:") }).map(String.init) ?? msg.split(separator: "\n", omittingEmptySubsequences: false).first.map(String.init) ?? msg
        return "zega rejected the query: \(first.trimmingCharacters(in: .whitespaces).prefix(240)).\(hintFor(msg, engine.schema))"
      }
    )

    let LABEL = Param(type: .string, describe: "field path naming each bar/slice/series, e.g. \"title\", \"name\"", default: .string(""))
    let VALUE = Param(type: .string, describe: "field path or sum|count|avg|max|min(path), e.g. \"gross\", \"sum(movies.gross)\", \"count(acted_in)\"", default: .string(""))
    let SORT = Param(type: .string, describe: "\"value desc\" (default), \"value asc\" or \"label asc\"", default: .string(""))
    let LIMIT = Param(type: .number, describe: "keep the first N after sorting", default: .number(0))

    let components = [
      try defineComponent("stat", ComponentDef(
        describe: "ONE number shown large: how much, how many, what year. Several rows are summed (or as the value says).",
        sizes: ["small", "medium"], source: "zega", identity: ["query", "value"],
        params: Params([("label", LABEL), ("value", VALUE)]),
        check: { rows, item in
          statOf(rows, ViewSpec(item)) != nil ? nil : "value \"\(item.extra["value"]?.stringValue ?? "")\" gives no number; the rows have fields: \(fieldsList(rows))"
        })),
      try defineComponent("bar", ComponentDef(
        describe: "compare amounts across things (box office, counts); use limit, e.g. 10–20.",
        sizes: ["medium", "large", "viewport"], size: "medium", source: "zega", identity: ["query", "label", "value", "sort", "limit"],
        params: Params([("label", LABEL), ("value", VALUE), ("sort", SORT), ("limit", LIMIT)]),
        select: "bar labels, \"Avatar|Titanic\"",
        check: { rows, item in
          let v = ViewSpec(item)
          return !series(rows, v).isEmpty ? nil : "value \"\(v.value)\" gives no numbers for label \"\(v.label)\"; the rows have fields: \(fieldsList(rows))"
        })),
      try defineComponent("pie", ComponentDef(
        describe: "shares of a whole; shows 7 slices plus Other.",
        sizes: ["medium", "large"], source: "zega", identity: ["query", "label", "value"],
        params: Params([("label", LABEL), ("value", VALUE), ("sort", SORT), ("limit", LIMIT)]),
        check: { rows, item in
          let v = ViewSpec(item)
          return !series(rows, v).isEmpty ? nil : "value \"\(v.value)\" gives no numbers for label \"\(v.label)\"; the rows have fields: \(fieldsList(rows))"
        })),
      try defineComponent("line", ComponentDef(
        describe: "change over time (years): series are labels, x a year path, value summed per year. The chart computes and flags the big changes itself.",
        sizes: ["large", "viewport"], size: "viewport", source: "zega", identity: ["query", "label", "x", "value"],
        params: Params([
          ("label", LABEL), ("value", VALUE), ("limit", LIMIT),
          ("x", Param(type: .string, describe: "the x-axis field path, e.g. \"movies.year\"")),
          ("flag", Param(type: .enum(FLAGS), describe: "mark the biggest drops/rises", default: .string("none"))),
          ("threshold", Param(type: .number, describe: "minimum change in percent to flag (default 25)", default: .number(0))),
          ("notes", Param(type: .string, describe: "context at x values, \"2020:Theaters close|2012:The Avengers opens\" (words only)", default: .string(""))),
        ]),
        select: "a year, \"x:2019\"",
        check: { rows, item in
          let v = ViewSpec(item)
          return !lineData(rows, v).series.isEmpty ? nil : "x \"\(v.x)\" and value \"\(v.value)\" give no points; the rows have fields: \(fieldsList(rows)) (for per-genre years use label \"name\", x \"movies.year\", value \"sum(movies.gross)\")"
        })),
      try defineComponent("table", ComponentDef(
        describe: "detail rows.",
        sizes: ["medium", "large", "viewport"], size: "large", source: "zega", identity: ["query"])),
      try defineComponent("graph", ComponentDef(
        describe: "how movies and people connect (shared cast, a director’s films).",
        sizes: ["large", "viewport"], source: "zega", identity: ["query"],
        select: "nodes and edges, \"person:Name|movie:Title|person:Name > movie:Title\"")),
    ]

    let viewport = try createViewport(components: components, sources: [("zega", source)])
    self.viewport = viewport
    store = Store(initial: viewport.initial(), actions: viewport.actions)

    // The wire, matching createMoviesWire: selection rows first, then the views.
    wire = Wire(entities: [
      WireEntity(spec: WireEntitySpec(type: "selected", fields: [
        WireFieldSpec(name: "view", ref: "view"),
        WireFieldSpec(name: "item"),
      ])) { state in
        guard let selection = state.selection else { return [] }
        return selection.items.map { WireRow(values: ["view": .string(selection.view), "item": .string($0)]) }
      },
      WireEntity(spec: WireEntitySpec(type: "view", idField: "id", fields: [
        WireFieldSpec(name: "kind"),
        WireFieldSpec(name: "title"),
        WireFieldSpec(name: "size"),
        WireFieldSpec(name: "query"),
        WireFieldSpec(name: "label", default: .string("")),
        WireFieldSpec(name: "value", default: .string("")),
        WireFieldSpec(name: "sort", default: .string("")),
        WireFieldSpec(name: "limit", default: .number(0)),
        WireFieldSpec(name: "x", default: .string("")),
        WireFieldSpec(name: "flag", default: .string("none")),
        WireFieldSpec(name: "threshold", default: .number(0)),
        WireFieldSpec(name: "notes", default: .string("")),
      ])) { state in
        state.order.compactMap { state.items[$0] }.map { item in
          var values: [String: JSONValue] = [
            "kind": .string(item.kind),
            "title": .string(item.title),
            "size": .string(item.size.rawValue),
            "query": .string(item.query),
          ]
          for name in ["label", "value", "sort", "limit", "x", "flag", "threshold", "notes"] {
            values[name] = item.extra[name]
          }
          return WireRow(id: item.id, values: values)
        }
      },
    ])

    brief = """
    You answer questions about movies by showing components on the page. You decide WHAT to show: a component, its ZQL query and params. The page runs the query in the zega database and draws the result; you never see the rows, so never state numbers in "say" — say what you are showing.
    Where it goes is yours: "at" end (default), before/after a target, or "replace" a target (e.g. "turn that bar chart into a pie" = a new component that replaces it). Pick a size the kind comes in; the page lays out columns. Reuse an id to change a component in place; view.move and view.resize rearrange.
    The user's current selection (what they clicked) is in the state as "selected" rows. "this", "these", "them", "the selected ones" mean the selection: use those names in your query. You may select things yourself with select.set to point at an answer.
    Keep "say" to one short sentence.

    \(viewport.catalogue())

    Examples:
    - Box office over time for a few genres, big drops flagged: kind line, query { Genre(name = "superhero" || name = "science fiction") limit 100000 { name movies <- Movie { year gross } } }, label "name", x "movies.year", value "sum(movies.gross)", flag "drops", notes "2020:Theaters close".
    - One film's box office: kind stat, query { Movie(title findLike "Titanic") limit 100000 { title gross } }, label "title", value "gross".
    - Top 10 by box office: kind bar, query { Movie limit 100000 { title gross } }, label "title", value "gross", limit 10.
    - Box office by genre: kind pie, query { Genre limit 100000 { name movies <- Movie { gross } } }, label "name", value "sum(movies.gross)", limit 8.
    - Films two actors share: kind graph, query { Movie(has cast(name findLike "A") && has cast(name findLike "B")) limit 100000 { title cast -> Person { name } } }.
    - A director's films: kind table, query { Person(name findLike "Christopher Nolan") limit 100000 { name directed <- Movie { title year gross } } }.
    """
  }
}
