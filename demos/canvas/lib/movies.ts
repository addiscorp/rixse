// The movies vocabulary: the agent decides WHAT to show — a query and a chart —
// and the page runs the query in zega. The rows never pass through the model.
// ZQL has no sorting or aggregation, so those live in the view spec (sort,
// limit, sum/count/avg of a field), applied to zega's rows by the page.
import { createStore, createWire, defineAction, Rejected, type ActionDef } from 'rixse';
import { getZega } from './zega.ts';

export const VIEW_KINDS = ['stat', 'bar', 'line', 'pie', 'table', 'graph'] as const;
export type ViewKind = (typeof VIEW_KINDS)[number];
export const PLACES = ['end', 'before', 'after', 'replace'] as const;
export type Place = (typeof PLACES)[number];
export const FLAGS = ['none', 'drops', 'rises', 'both'] as const;
export type View = { id: string; kind: ViewKind; title: string; query: string; label: string; value: string; sort: string; limit: number; size: 'half' | 'full'; x: string; flag: (typeof FLAGS)[number]; threshold: number; notes: string };
/** What the user (or the agent) has selected in one view: graph nodes "person:Chris Evans", edges "person:Chris Evans > movie:Avatar", or bars "Avatar". */
export type Selection = { view: string; items: string[] };
export type MoviesState = { views: Record<string, View>; order: string[]; selection: Selection | null };
export type Datum = { label: string; value: number };

const initial = (): MoviesState => ({ views: {}, order: [], selection: null });

/** Every value at a dotted path, flattening arrays on the way ("movies.gross"). */
function at(row: unknown, path: string): unknown[] {
  let cur: unknown[] = [row];
  for (const key of path.split('.').filter(Boolean)) {
    cur = cur.flatMap((v) => (Array.isArray(v) ? v : [v])).map((v) => (v && typeof v === 'object' ? (v as Record<string, unknown>)[key] : undefined)).filter((v) => v !== undefined);
  }
  return cur.flatMap((v) => (Array.isArray(v) ? v : [v]));
}

const AGG = /^(sum|count|avg|max|min)\(([\w.]*)\)$/;
/** A value spec on one row: a field path, or sum/count/avg/max/min(path). */
export function valueOf(row: unknown, spec: string): number | null {
  const m = spec.trim().match(AGG);
  const vals = m ? at(row, m[2]!) : at(row, spec.trim());
  if (m?.[1] === 'count') return vals.length;
  const nums = vals.map(Number).filter((n) => Number.isFinite(n));
  if (!nums.length) return null;
  if (!m) return nums[0]!;
  if (m[1] === 'sum') return nums.reduce((a, b) => a + b, 0);
  if (m[1] === 'avg') return nums.reduce((a, b) => a + b, 0) / nums.length;
  return m[1] === 'max' ? Math.max(...nums) : Math.min(...nums);
}
export const labelOf = (row: unknown, spec: string) => at(row, spec || 'title').map(String).join(', ') || String(at(row, 'name')[0] ?? '');

/** How many bars or slices a view may draw; the rest are summarised, never dropped silently. */
export const CAP = { bar: 30, pie: 8 } as const;

/**
 * Rows → the numbers a bar or pie chart draws. Rows with the same label are
 * grouped (films of one year become one bar): summed, or averaged/maxed/mined
 * when the value spec says so. Then sorted and cut exactly as the view says.
 */
export function series(rows: unknown[], v: Pick<View, 'label' | 'value' | 'sort' | 'limit'>): Datum[] {
  const how = v.value.trim().match(AGG)?.[1] ?? 'sum';
  const groups = new Map<string, number[]>();
  for (const r of rows) {
    const label = labelOf(r, v.label), value = valueOf(r, v.value);
    if (value === null || label === '') continue;
    groups.set(label, [...(groups.get(label) ?? []), value]);
  }
  let data: Datum[] = [...groups].map(([label, vals]) => ({
    label,
    value: how === 'avg' ? vals.reduce((a, b) => a + b, 0) / vals.length : how === 'max' ? Math.max(...vals) : how === 'min' ? Math.min(...vals) : vals.reduce((a, b) => a + b, 0),
  }));
  const [key, dir] = (v.sort || 'value desc').split(/\s+/);
  const sign = dir === 'asc' ? 1 : -1;
  data = data.sort((a, b) => (key === 'label' ? a.label.localeCompare(b.label, undefined, { numeric: true }) * sign : (a.value - b.value) * sign));
  return v.limit > 0 ? data.slice(0, v.limit) : data;
}

/**
 * A stat's one number (summed over rows, or as the value spec says) and its caption:
 * the row's name when there is one real name, else the view's title.
 */
export function statOf(rows: unknown[], v: Pick<View, 'label' | 'value' | 'title'>): { value: number; caption: string } | null {
  const vals = rows.map((r) => valueOf(r, v.value)).filter((x): x is number => x !== null);
  if (!vals.length) return null;
  const how = v.value.trim().match(AGG)?.[1];
  const value = how === 'avg' ? vals.reduce((a, b) => a + b, 0) / vals.length : how === 'max' ? Math.max(...vals) : how === 'min' ? Math.min(...vals) : vals.reduce((a, b) => a + b, 0);
  const names = [...new Set(rows.map((r) => labelOf(r, v.label)).filter((l) => l && !/^[\d.,\s]+$/.test(l)))];
  return { value, caption: names.length === 1 ? names[0]! : v.title };
}

export type LinePoint = { x: number; y: number };
export type LineSeries = { name: string; points: LinePoint[] };
export type LineFlag = { series: string; x: number; from: number; to: number; pct: number };
export type LineData = { series: LineSeries[]; flags: LineFlag[]; xs: number[] };

/**
 * Rows → line series for a chart the model does not draw. label names each series
 * ("name"), x and value are paths that may reach into a nested list ("movies.year",
 * "sum(movies.gross)"): each nested item gives a point, grouped per (series, x) by the
 * value's aggregate. The axis spans whole years; each series has points only where it has
 * data (the line joins across gaps), and changes compare consecutive real points. Drops or
 * rises of at least `threshold` percent are found here, from the data: the callouts'
 * numbers are computed, never written by the model.
 */
export function lineData(rows: unknown[], v: Pick<View, 'label' | 'x' | 'value' | 'flag' | 'threshold' | 'limit'>): LineData {
  const m = v.value.trim().match(AGG);
  const fn = m?.[1] ?? 'sum';
  const valuePath = m ? m[2]! : v.value.trim();
  const xPath = v.x.trim() || 'year';
  const common = (a: string, b: string) => { const pa = a.split('.'), pb = b.split('.'); let i = 0; while (i < pa.length - 1 && i < pb.length - 1 && pa[i] === pb[i]) i++; return pa.slice(0, i).join('.'); };
  const prefix = common(xPath, valuePath || xPath);
  const strip = (path: string) => (prefix ? path.slice(prefix.length + 1) : path);
  const groups = new Map<string, Map<number, number[]>>();
  const agg = (ys: number[]) => fn === 'avg' ? ys.reduce((a, b) => a + b, 0) / ys.length : fn === 'max' ? Math.max(...ys) : fn === 'min' ? Math.min(...ys) : ys.reduce((a, b) => a + b, 0);
  for (const row of rows) {
    const name = labelOf(row, v.label) || 'total';
    const items = prefix ? at(row, prefix).filter((i) => i && typeof i === 'object') : [row];
    const g = groups.get(name) ?? groups.set(name, new Map()).get(name)!;
    for (const it of items) {
      const x = Number(at(it, strip(xPath))[0]);
      if (!Number.isFinite(x) || x === 0) continue;
      const y = fn === 'count' ? 1 : Number(at(it, strip(valuePath))[0]);
      if (!Number.isFinite(y)) continue;
      (g.get(x) ?? g.set(x, []).get(x)!).push(y);
    }
  }
  let allX = [...new Set([...groups.values()].flatMap((g) => [...g.keys()]))].sort((a, b) => a - b);
  // Trim a long, near-empty lead-in: start where some series first reaches 10% of the overall peak
  // (one step earlier, so the rise is visible). The story is where the data is.
  const totalAt = (x: number) => Math.max(0, ...[...groups.values()].map((g) => (g.has(x) ? agg(g.get(x)!) : 0)));
  const overall = Math.max(0, ...allX.map(totalAt));
  const firstBig = allX.findIndex((x) => totalAt(x) >= overall * 0.2);
  if (firstBig > 1) allX = allX.slice(firstBig - 1);
  const whole = allX.every((x) => Number.isInteger(x));
  const xs = whole && allX.length ? Array.from({ length: allX.at(-1)! - allX[0]! + 1 }, (_, i) => allX[0]! + i) : allX;
  // Only years with data are points; the line joins across gaps. (A year missing from a
  // top-N dataset means "none made the list", not zero — drawing it as zero would lie.)
  const lo = xs[0] ?? -Infinity;
  let series: LineSeries[] = [...groups].map(([name, g]) => ({ name, points: [...g.keys()].filter((x) => x >= lo).sort((a, b) => a - b).map((x) => ({ x, y: agg(g.get(x)!) })) }))
    .filter((s) => s.points.some((p) => p.y > 0))
    .sort((a, b) => b.points.reduce((t, p) => t + p.y, 0) - a.points.reduce((t, p) => t + p.y, 0));
  series = series.slice(0, v.limit > 0 ? v.limit : 5);
  const flags: LineFlag[] = [];
  const th = (v.threshold > 0 ? v.threshold : 25) / 100;
  if (v.flag && v.flag !== 'none') {
    for (const s of series) {
      const peakOf = Math.max(...s.points.map((p) => p.y));
      // The biggest qualifying change per series (at most two), so the chart tells a story, not a list.
      const changes = s.points.slice(1).map((p, i) => ({ x: p.x, from: s.points[i]!.y, to: p.y, pct: s.points[i]!.y > 0 ? (p.y - s.points[i]!.y) / s.points[i]!.y : 0 }))
        // A change only counts from a meaningful level: at least 15% of the series' peak.
        .filter((c) => c.from >= peakOf * 0.15 && (v.flag === 'both' || (v.flag === 'drops' ? c.pct <= -th : c.pct >= th)) && Math.abs(c.pct) >= th)
        .sort((a, b) => Math.abs(b.pct) - Math.abs(a.pct)).slice(0, 2);
      for (const c of changes) flags.push({ series: s.name, x: c.x, from: c.from, to: c.to, pct: Math.round(c.pct * 100) });
    }
  }
  return { series, flags, xs };
}

/** What a chart actually draws: at most CAP items; a pie folds the rest into "Other". */
export function capped(data: Datum[], kind: 'bar' | 'pie'): { data: Datum[]; hidden: number } {
  const cap = CAP[kind];
  if (data.length <= cap) return { data, hidden: 0 };
  if (kind === 'bar') return { data: data.slice(0, cap), hidden: data.length - cap };
  const rest = data.slice(cap - 1);
  return { data: [...data.slice(0, cap - 1), { label: `Other (${rest.length})`, value: rest.reduce((a, d) => a + d.value, 0) }], hidden: rest.length };
}

/**
 * A zega error, made actionable: for the mistakes models make most, the
 * schema tells us the exact correction, so the rejection says it.
 */
export function hintFor(error: string, schema: string): string {
  // "Movie.genres does not reach name": a relationship needs its type and braces.
  const reach = error.match(/(\w+)\.(\w+) does not reach (\w+)/);
  if (reach) {
    const [, type, rel, field] = reach;
    const block = schema.match(new RegExp(`type ${type} \\{([\\s\\S]*?)\\n\\s*\\}`))?.[1] ?? '';
    const m = block.match(new RegExp(`\\b${rel}:\\s*\\w+\\s*(->|<-)\\s*(\\w+)`));
    if (m) return ` Fix: follow it with its arrow, type and braces — write \`${rel} ${m[1]} ${m[2]} { ${field} }\`.`;
  }
  // "Person.acted_in does not point ->": the arrow is the other way.
  const dir = error.match(/(\w+)\.(\w+) does not point (->|<-)/);
  if (dir) return ` Fix: write \`${dir[2]} ${dir[3] === '->' ? '<-' : '->'} …\`.`;
  return '';
}

/** Run a view's query in zega; a zega error becomes a rejection the agent can read and act on. */
export function runQuery(query: string): unknown[] {
  const z = getZega();
  if (!z) throw new Rejected('the movies database is still loading; try again in a moment');
  try { return z.run(query); }
  catch (e) {
    const msg = String(e instanceof Error ? e.message : e).replace(/^execution error: /, '');
    const first = msg.split('\n').find((l) => /error:/.test(l)) ?? msg.split('\n')[0]!;
    throw new Rejected(`zega rejected the query: ${first.trim().slice(0, 240)}.${hintFor(msg, z.schema)}`);
  }
}

const act = <P,>(type: string, def: Omit<ActionDef<MoviesState, P>, 'type'>) => defineAction<MoviesState, P>(type, def);

/**
 * Where a view goes in the order. The agent decides (end, before/after a view,
 * or replace one); rixse checks the target exists and is not the view itself.
 * Returns the new order and the id a replace removes.
 */
export function place(order: string[], id: string, at: Place = 'end', target?: string): { order: string[]; removed?: string } {
  const rest = order.filter((x) => x !== id);
  if (at === 'end') return { order: [...rest, id] };
  if (!target) throw new Rejected(`at "${at}" needs a target view`);
  if (target === id) throw new Rejected('a view cannot be placed relative to itself');
  const i = rest.indexOf(target);
  if (i < 0) throw new Rejected(`no view "${target}" to place ${at === 'replace' ? 'over' : at}`);
  if (at === 'replace') return { order: [...rest.slice(0, i), id, ...rest.slice(i + 1)], removed: target };
  const j = at === 'before' ? i : i + 1;
  return { order: [...rest.slice(0, j), id, ...rest.slice(j)] };
}

const PLACE_PARAMS = {
  at: { type: 'enum', values: PLACES, optional: true, describe: 'where it goes: "end" (default), "before"/"after" the target, or "replace" the target (the target view is removed; its spot is taken)' },
  target: { type: 'string', ref: 'view', optional: true, describe: 'the view id (or handle) that "at" refers to' },
} as const;

export const movieActions = [
  act('view.show', {
    describe: 'Show a view of query results, or replace the view with this id. The page runs the query in zega and draws the rows; you never see or write the data.',
    params: {
      id: { type: 'string', ref: 'view', describe: 'a short slug; reuse an existing id (or its handle) to change that view instead of adding one' },
      kind: { type: 'enum', values: VIEW_KINDS, describe: 'stat: ONE number (how much, how many, what year) shown large; bar: compare amounts; pie: shares of a whole; table: detail rows; graph: how movies and people connect' },
      title: { type: 'string' },
      query: { type: 'string', describe: 'one ZQL read query' },
      label: { type: 'string', optional: true, describe: 'bar/pie: field path for each slice/bar name, e.g. "title" or "name"' },
      value: { type: 'string', optional: true, describe: 'bar/pie: field path or sum|count|avg|max|min(path), e.g. "gross", "sum(movies.gross)", "count(acted_in)"' },
      sort: { type: 'string', optional: true, describe: '"value desc" (default), "value asc" or "label asc"' },
      limit: { type: 'number', optional: true, describe: 'keep the first N after sorting' },
      size: { type: 'enum', values: ['half', 'full'], optional: true, describe: 'half (default) or full width' },
      x: { type: 'string', optional: true, describe: 'line: the x-axis field path, e.g. "movies.year" (label names each series, value its y)' },
      flag: { type: 'enum', values: FLAGS, optional: true, describe: 'line: mark the biggest drops/rises; the chart computes the % from the data' },
      threshold: { type: 'number', optional: true, describe: 'line: minimum change in percent to flag (default 25)' },
      notes: { type: 'string', optional: true, describe: 'line: context at x values, "2020:Theaters close|2012:The Avengers opens" (words only; no numbers)' },
      ...PLACE_PARAMS,
    },
    apply: (s: MoviesState, p: Partial<View> & { id: string; kind: ViewKind; title: string; query: string; at?: Place; target?: string }) => {
      const rows = runQuery(p.query);
      if (!rows.length) throw new Rejected('the query ran but returned no rows; loosen the filter (findLike folds case) or check the names');
      const view: View = { id: p.id, kind: p.kind, title: p.title, query: p.query, label: p.label ?? '', value: p.value ?? '', sort: p.sort ?? '', limit: p.limit ?? 0, size: p.size ?? s.views[p.id]?.size ?? (p.kind === 'line' ? 'full' : 'half'), x: p.x ?? '', flag: p.flag ?? 'none', threshold: p.threshold ?? 0, notes: p.notes ?? '' };
      if (p.kind === 'stat' && !statOf(rows, view)) {
        const keys = Object.keys((rows[0] ?? {}) as object).join(', ');
        throw new Rejected(`value "${view.value}" gives no number; the rows have fields: ${keys}`);
      }
      if (p.kind === 'line' && !lineData(rows, view).series.length) {
        const keys = Object.keys((rows[0] ?? {}) as object).join(', ');
        throw new Rejected(`x "${view.x}" and value "${view.value}" give no points; the rows have fields: ${keys} (for per-genre years use label "name", x "movies.year", value "sum(movies.gross)")`);
      }
      if ((p.kind === 'bar' || p.kind === 'pie') && !series(rows, view).length) {
        const keys = Object.keys((rows[0] ?? {}) as object).join(', ');
        throw new Rejected(`value "${view.value}" gives no numbers for label "${view.label}"; the rows have fields: ${keys}`);
      }
      // Re-showing an existing id keeps its spot unless a place is given.
      const placed = p.at ? place(s.order, p.id, p.at, p.target) : { order: s.order.includes(p.id) ? s.order : [...s.order, p.id] };
      const views = { ...s.views, [p.id]: view };
      if ('removed' in placed && placed.removed) delete views[placed.removed];
      // A changed or removed view drops its selection: the items may no longer be on screen.
      const selection = s.selection && views[s.selection.view] && s.selection.view !== p.id ? s.selection : null;
      return { views, order: placed.order, selection };
    },
  }),
  act('view.move', {
    describe: 'Move a view to the end, or before/after another view.',
    params: { id: { type: 'string', ref: 'view' }, at: { type: 'enum', values: ['end', 'before', 'after'] }, target: { type: 'string', ref: 'view', optional: true } },
    apply: (s: MoviesState, p: { id: string; at: 'end' | 'before' | 'after'; target?: string }) => {
      if (!s.views[p.id]) throw new Rejected(`no view "${p.id}"`);
      return { ...s, order: place(s.order, p.id, p.at, p.target).order };
    },
  }),
  act('view.resize', {
    describe: 'Make a view half or full width.',
    params: { id: { type: 'string', ref: 'view' }, size: { type: 'enum', values: ['half', 'full'] } },
    apply: (s: MoviesState, p: { id: string; size: 'half' | 'full' }) => {
      const v = s.views[p.id];
      if (!v) throw new Rejected(`no view "${p.id}"`);
      return { ...s, views: { ...s.views, [p.id]: { ...v, size: p.size } } };
    },
  }),
  act('view.remove', {
    describe: 'Remove a view.',
    params: { id: { type: 'string', ref: 'view' } },
    apply: (s: MoviesState, p: { id: string }) => {
      if (!s.views[p.id]) throw new Rejected(`no view "${p.id}"`);
      const { [p.id]: _gone, ...views } = s.views;
      return { views, order: s.order.filter((x) => x !== p.id), selection: s.selection?.view === p.id ? null : s.selection };
    },
  }),
  act('view.clear', { describe: 'Remove every view.', params: {}, apply: () => initial() }),
  act('select.set', {
    describe: 'Select things in one view (the user does this by clicking; you may too, to point at something). Replaces the current selection.',
    params: {
      view: { type: 'string', ref: 'view' },
      items: { type: 'string', describe: 'graph: "person:Name|movie:Title|person:Name > movie:Title" (nodes, and edges as "a > b"); bar: bar labels "Avatar|Titanic"' },
    },
    apply: (s: MoviesState, p: { view: string; items: string }) => {
      if (!s.views[p.view]) throw new Rejected(`no view "${p.view}"`);
      const items = [...new Set(p.items.split('|').map((x) => x.trim()).filter(Boolean))];
      if (!items.length) throw new Rejected('select at least one item, or use select.clear');
      return { ...s, selection: { view: p.view, items } };
    },
  }),
  act('select.clear', { describe: 'Clear the selection.', params: {}, apply: (s: MoviesState) => ({ ...s, selection: null }) }),
];

export function moviesBrief(schema: string) {
  return `You answer questions about movies by showing views on the page. You decide WHAT to show: a ZQL query and a chart kind. The page runs the query in the zega database and draws the result; you never see the rows, so never state numbers in "say" — say what you are showing.
Pick the view: line for change over time (years): series are labels, x a year path, value summed per year; set flag "drops" to have the chart mark the big falls, and notes for context at a year; stat for a single number ("how much did this make", "how many films", "what year"; value is the field or count(...), label names what it is), bar to compare amounts (box office, counts; use limit, e.g. 10–20), pie for shares of a whole (it shows 7 slices plus Other), table for detail rows, graph to show how movies and people connect (shared cast, a director's films).
Views sit in a two-column grid in order. You decide where: "at" end (default), before/after a target view, or "replace" a target (e.g. "turn that bar chart into a pie" = a new view that replaces it). size "full" spans both columns. Reuse a view's id to change it in place; view.move and view.resize rearrange.
The user's current selection (what they clicked in a graph or chart) is in the state as "selected" rows. "this", "these", "them", "the selected ones" mean the selection: use those names in your query. You may select things yourself with select.set to point at an answer.
Keep "say" to one short sentence.

The database (ZQL schema; -> points out of a type, <- points in):
${schema}

ZQL, the read queries you may write:
- Shape: { Type(filter) limit 10000000 { field field } }. Always add "limit 10000000" (it covers every row) after a list filter; a filter of only equality tests means exactly ONE node.
- Tests: = != > < >= <=, &&, ||, parentheses. Text: field findLike "x" (case-insensitive substring; prefer it for names and titles).
- Follow a relationship inside the braces with its own arrow: { Movie(title findLike "Titanic") limit 100000 { title cast -> Person { name } } } and { Person(name findLike "Tom Hanks") limit 100000 { name acted_in <- Movie { title year } } }.
- Filter across a relationship with has: Movie(has cast(name findLike "Tom Hanks") && has cast(name findLike "Meg Ryan")). has genres(name findLike "animated").
- There is NO sort, count, sum or group in ZQL: fetch the rows and let the view do it with value ("sum(movies.gross)", "count(acted_in)"), sort and limit. Rows with the same label are grouped and summed (e.g. label "year", value "gross" gives one bar per year).
Examples:
- Box office over time for a few genres, with the big drops flagged: kind line, query { Genre(name = "superhero" || name = "science fiction") limit 100000 { name movies <- Movie { year gross } } }, label "name", x "movies.year", value "sum(movies.gross)", flag "drops", notes "2020:Theaters close".
- One film's box office: kind stat, query { Movie(title findLike "Titanic") limit 100000 { title gross } }, label "title", value "gross".
- Top 10 by box office: kind bar, query { Movie limit 100000 { title gross } }, label "title", value "gross", limit 10.
- Box office by genre: kind pie, query { Genre limit 100000 { name movies <- Movie { gross } } }, label "name", value "sum(movies.gross)", limit 8.
- Films two actors share: kind graph, query { Movie(has cast(name findLike "A") && has cast(name findLike "B")) limit 100000 { title cast -> Person { name } } }.
- A director's films: kind table, query { Person(name findLike "Christopher Nolan") limit 100000 { name directed <- Movie { title year gross } } }.`;
}

export function createMoviesWire() {
  return createWire<MoviesState>({
    entities: [{
      type: 'selected', list: (s) => (s.selection ? s.selection.items.map((item) => ({ view: s.selection!.view, item })) : []),
      fields: [{ name: 'view', ref: 'view' }, { name: 'item' }],
    }, {
      type: 'view', list: (s) => s.order.map((id) => s.views[id]!), id: (v) => v.id,
      fields: [{ name: 'kind' }, { name: 'title' }, { name: 'query' }, { name: 'label', default: '' }, { name: 'value', default: '' }, { name: 'sort', default: '' }, { name: 'limit', default: 0 }, { name: 'size', default: 'half' }, { name: 'x', default: '' }, { name: 'flag', default: 'none' }, { name: 'threshold', default: 0 }, { name: 'notes', default: '' }],
    }],
  });
}

export function createMoviesStore() {
  return createStore<MoviesState>({ initial: initial(), actions: movieActions });
}
export type MoviesStore = ReturnType<typeof createMoviesStore>;
