// The movies vocabulary: the agent decides WHAT to show — a query and a chart —
// and the page runs the query in zega. The rows never pass through the model.
// ZQL has no sorting or aggregation, so those live in the view spec (sort,
// limit, sum/count/avg of a field), applied to zega's rows by the page.
import { createStore, createViewport, createWire, defineComponent, defineSource, Rejected, type Size } from 'rixse';
import { getZega } from './zega.ts';

export const VIEW_KINDS = ['stat', 'bar', 'line', 'pie', 'table', 'graph'] as const;
export type ViewKind = (typeof VIEW_KINDS)[number];
export { place } from 'rixse';
export const FLAGS = ['none', 'drops', 'rises', 'both'] as const;
export type View = { id: string; kind: ViewKind; title: string; query: string; label: string; value: string; sort: string; limit: number; size: Size; x: string; flag: (typeof FLAGS)[number]; threshold: number; notes: string };
/** What the user (or the agent) has selected in one view: graph nodes "person:Chris Evans", edges "person:Chris Evans > movie:Avatar", or bars "Avatar". */
export type Selection = { view: string; items: string[] };
export type MoviesState = { items: Record<string, View>; order: string[]; selection: Selection | null };
export type Datum = { label: string; value: number };


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


/** The movies database as a rixse data source: ZQL in, rows out; its errors come back as the fix. */
let schemaText = '(loading)';
export const zegaSource = defineSource({
  describe: () => `The movies database, queried in ZQL (-> points out of a type, <- points in):
${schemaText}

ZQL, the read queries you may write:
- Shape: { Type(filter) limit 100000 { field field } }. Always add "limit 100000" (it covers every row) after a list filter; a filter of only equality tests means exactly ONE node.
- Tests: = != > < >= <=, &&, ||, parentheses. Text: field findLike "x" (case-insensitive substring; prefer it for names and titles).
- Follow a relationship inside the braces with its own arrow: { Movie(title findLike "Titanic") limit 100000 { title cast -> Person { name } } } and { Person(name findLike "Tom Hanks") limit 100000 { name acted_in <- Movie { title year } } }.
- Filter across a relationship with has: Movie(has cast(name findLike "Tom Hanks") && has cast(name findLike "Meg Ryan")). has genres(name findLike "animated").
- There is NO sort, count, sum or group in ZQL: fetch the rows and let the component do it with value ("sum(movies.gross)", "count(acted_in)"), sort and limit. Rows with the same label are grouped and summed.`,
  query: 'one ZQL read query, shaped { Type(filter) limit 100000 { field rel -> Type { field } } }',
  run: (query) => {
    const z = getZega();
    if (!z) throw new Error('LOADING');
    return z.run(query);
  },
  hint: (error) => {
    if (error === 'LOADING') return 'the movies database is still loading; try again in a moment';
    const msg = error.replace(/^execution error: /, '');
    const first = msg.split('\n').find((l) => /error:/.test(l)) ?? msg.split('\n')[0]!;
    return `zega rejected the query: ${first.trim().slice(0, 240)}.${hintFor(msg, schemaText)}`;
  },
});

const fields = (rows: unknown[]) => Object.keys((rows[0] ?? {}) as object).join(', ');
const LABEL = { type: 'string', default: '', describe: 'field path naming each bar/slice/series, e.g. "title", "name"' } as const;
const VALUE = { type: 'string', default: '', describe: 'field path or sum|count|avg|max|min(path), e.g. "gross", "sum(movies.gross)", "count(acted_in)"' } as const;
const SORT = { type: 'string', default: '', describe: '"value desc" (default), "value asc" or "label asc"' } as const;
const LIMIT = { type: 'number', default: 0, describe: 'keep the first N after sorting' } as const;

/** The movies catalogue: rixse Components reading zega. */
export const movieComponents = [
  defineComponent('stat', {
    describe: 'ONE number shown large: how much, how many, what year. Several rows are summed (or as the value says).',
    sizes: ['small', 'medium'], source: 'zega', identity: ['query', 'value'],
    params: { label: LABEL, value: VALUE },
    check: (rows, v) => (statOf(rows, v) ? null : `value "${v.value}" gives no number; the rows have fields: ${fields(rows)}`),
  }),
  defineComponent('bar', {
    describe: 'compare amounts across things (box office, counts); use limit, e.g. 10–20.',
    sizes: ['medium', 'large', 'viewport'], size: 'medium', source: 'zega', identity: ['query', 'label', 'value', 'sort', 'limit'],
    params: { label: LABEL, value: VALUE, sort: SORT, limit: LIMIT },
    select: 'bar labels, "Avatar|Titanic"',
    check: (rows, v) => (series(rows, v).length ? null : `value "${v.value}" gives no numbers for label "${v.label}"; the rows have fields: ${fields(rows)}`),
  }),
  defineComponent('pie', {
    describe: 'shares of a whole; shows 7 slices plus Other.',
    sizes: ['medium', 'large'], source: 'zega', identity: ['query', 'label', 'value'],
    params: { label: LABEL, value: VALUE, sort: SORT, limit: LIMIT },
    check: (rows, v) => (series(rows, v).length ? null : `value "${v.value}" gives no numbers for label "${v.label}"; the rows have fields: ${fields(rows)}`),
  }),
  defineComponent('line', {
    describe: 'change over time (years): series are labels, x a year path, value summed per year. The chart computes and flags the big changes itself.',
    sizes: ['large', 'viewport'], size: 'viewport', source: 'zega', identity: ['query', 'label', 'x', 'value'],
    params: {
      label: LABEL, value: VALUE, limit: LIMIT,
      x: { type: 'string', describe: 'the x-axis field path, e.g. "movies.year"' },
      flag: { type: 'enum', values: FLAGS, default: 'none', describe: 'mark the biggest drops/rises' },
      threshold: { type: 'number', default: 0, describe: 'minimum change in percent to flag (default 25)' },
      notes: { type: 'string', default: '', describe: 'context at x values, "2020:Theaters close|2012:The Avengers opens" (words only)' },
    },
    select: 'a year, "x:2019"',
    check: (rows, v) => (lineData(rows, v).series.length ? null : `x "${v.x}" and value "${v.value}" give no points; the rows have fields: ${fields(rows)} (for per-genre years use label "name", x "movies.year", value "sum(movies.gross)")`),
  }),
  defineComponent('table', {
    describe: 'detail rows.',
    sizes: ['medium', 'large', 'viewport'], size: 'large', source: 'zega', identity: ['query'],
  }),
  defineComponent('graph', {
    describe: 'how movies and people connect (shared cast, a director’s films).',
    sizes: ['large', 'viewport'], source: 'zega', identity: ['query'],
    select: 'nodes and edges, "person:Name|movie:Title|person:Name > movie:Title"',
  }),
];

export const moviesViewport = createViewport<View & { [k: string]: unknown }>({ components: movieComponents, sources: { zega: zegaSource } });
export const movieActions = moviesViewport.actions;

/** Run a component's query (the page draws with this; rejections read the same). */
export function runQuery(query: string): unknown[] {
  try { return zegaSource.run(query); }
  catch (e) { throw new Rejected(zegaSource.hint!(e instanceof Error ? e.message : String(e))); }
}

export function moviesBrief(schema: string) {
  schemaText = schema;
  return `You answer questions about movies by showing components on the page. You decide WHAT to show: a component, its ZQL query and params. The page runs the query in the zega database and draws the result; you never see the rows, so never state numbers in "say" — say what you are showing.
Where it goes is yours: "at" end (default), before/after a target, or "replace" a target (e.g. "turn that bar chart into a pie" = a new component that replaces it). Pick a size the kind comes in; the page lays out columns. Reuse an id to change a component in place; view.move and view.resize rearrange.
The user's current selection (what they clicked) is in the state as "selected" rows. "this", "these", "them", "the selected ones" mean the selection: use those names in your query. You may select things yourself with select.set to point at an answer.
Keep "say" to one short sentence.

${moviesViewport.catalogue()}

Examples:
- Box office over time for a few genres, big drops flagged: kind line, query { Genre(name = "superhero" || name = "science fiction") limit 100000 { name movies <- Movie { year gross } } }, label "name", x "movies.year", value "sum(movies.gross)", flag "drops", notes "2020:Theaters close".
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
      type: 'view', list: (s) => s.order.map((id) => s.items[id]!), id: (v) => v.id,
      fields: [{ name: 'kind' }, { name: 'title' }, { name: 'size' }, { name: 'query' }, ...(['label', 'value', 'sort', 'limit', 'x', 'flag', 'threshold', 'notes'] as const).map((name) => { const d = ({ limit: 0, threshold: 0, flag: 'none' } as Record<string, unknown>)[name] ?? ''; return { name, default: d, get: (v: View) => v[name] ?? d }; })],
    }],
  });
}

export function createMoviesStore() {
  return createStore<MoviesState>({ initial: moviesViewport.initial() as MoviesState, actions: movieActions as never });
}
export type MoviesStore = ReturnType<typeof createMoviesStore>;
