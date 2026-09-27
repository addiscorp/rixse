// The movies vocabulary: the agent decides WHAT to show — a query and a chart —
// and the page runs the query in zega. The rows never pass through the model.
// ZQL has no sorting or aggregation, so those live in the view spec (sort,
// limit, sum/count/avg of a field), applied to zega's rows by the page.
import { createStore, createWire, defineAction, Rejected, type ActionDef } from 'rixse';
import { getZega } from './zega.ts';

export const VIEW_KINDS = ['bar', 'pie', 'table', 'graph'] as const;
export type ViewKind = (typeof VIEW_KINDS)[number];
export type View = { id: string; kind: ViewKind; title: string; query: string; label: string; value: string; sort: string; limit: number };
export type MoviesState = { views: Record<string, View>; order: string[] };
export type Datum = { label: string; value: number };

const initial = (): MoviesState => ({ views: {}, order: [] });

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

/** What a chart actually draws: at most CAP items; a pie folds the rest into "Other". */
export function capped(data: Datum[], kind: 'bar' | 'pie'): { data: Datum[]; hidden: number } {
  const cap = CAP[kind];
  if (data.length <= cap) return { data, hidden: 0 };
  if (kind === 'bar') return { data: data.slice(0, cap), hidden: data.length - cap };
  const rest = data.slice(cap - 1);
  return { data: [...data.slice(0, cap - 1), { label: `Other (${rest.length})`, value: rest.reduce((a, d) => a + d.value, 0) }], hidden: rest.length };
}

/** Run a view's query in zega; a zega error becomes a rejection the agent can read. */
export function runQuery(query: string): unknown[] {
  const z = getZega();
  if (!z) throw new Rejected('the movies database is still loading; try again in a moment');
  try { return z.run(query); }
  catch (e) { throw new Rejected(`zega rejected the query: ${String(e instanceof Error ? e.message : e).replace(/^execution error: /, '').slice(0, 400)}`); }
}

const act = <P,>(type: string, def: Omit<ActionDef<MoviesState, P>, 'type'>) => defineAction<MoviesState, P>(type, def);

export const movieActions = [
  act('view.show', {
    describe: 'Show a view of query results, or replace the view with this id. The page runs the query in zega and draws the rows; you never see or write the data.',
    params: {
      id: { type: 'string', ref: 'view', describe: 'a short slug; reuse an existing id (or its handle) to change that view instead of adding one' },
      kind: { type: 'enum', values: VIEW_KINDS, describe: 'bar: compare amounts; pie: shares of a whole; table: detail rows; graph: how movies and people connect' },
      title: { type: 'string' },
      query: { type: 'string', describe: 'one ZQL read query' },
      label: { type: 'string', optional: true, describe: 'bar/pie: field path for each slice/bar name, e.g. "title" or "name"' },
      value: { type: 'string', optional: true, describe: 'bar/pie: field path or sum|count|avg|max|min(path), e.g. "gross", "sum(movies.gross)", "count(acted_in)"' },
      sort: { type: 'string', optional: true, describe: '"value desc" (default), "value asc" or "label asc"' },
      limit: { type: 'number', optional: true, describe: 'keep the first N after sorting' },
    },
    apply: (s: MoviesState, p: Partial<View> & { id: string; kind: ViewKind; title: string; query: string }) => {
      const rows = runQuery(p.query);
      if (!rows.length) throw new Rejected('the query ran but returned no rows; loosen the filter (findLike folds case) or check the names');
      const view: View = { id: p.id, kind: p.kind, title: p.title, query: p.query, label: p.label ?? '', value: p.value ?? '', sort: p.sort ?? '', limit: p.limit ?? 0 };
      if ((p.kind === 'bar' || p.kind === 'pie') && !series(rows, view).length) {
        const keys = Object.keys((rows[0] ?? {}) as object).join(', ');
        throw new Rejected(`value "${view.value}" gives no numbers for label "${view.label}"; the rows have fields: ${keys}`);
      }
      return { views: { ...s.views, [p.id]: view }, order: s.order.includes(p.id) ? s.order : [...s.order, p.id] };
    },
  }),
  act('view.remove', {
    describe: 'Remove a view.',
    params: { id: { type: 'string', ref: 'view' } },
    apply: (s: MoviesState, p: { id: string }) => {
      if (!s.views[p.id]) throw new Rejected(`no view "${p.id}"`);
      const { [p.id]: _gone, ...views } = s.views;
      return { views, order: s.order.filter((x) => x !== p.id) };
    },
  }),
  act('view.clear', { describe: 'Remove every view.', params: {}, apply: () => initial() }),
];

export function moviesBrief(schema: string) {
  return `You answer questions about movies by showing views on the page. You decide WHAT to show: a ZQL query and a chart kind. The page runs the query in the zega database and draws the result; you never see the rows, so never state numbers in "say" — say what you are showing.
Pick the view: bar to compare amounts (box office, counts; use limit, e.g. 10–20), pie for shares of a whole (it shows 7 slices plus Other), table for detail rows, graph to show how movies and people connect (shared cast, a director's films).
Reuse a view's id to change it. Keep "say" to one short sentence.

The database (ZQL schema; -> points out of a type, <- points in):
${schema}

ZQL, the read queries you may write:
- Shape: { Type(filter) limit 10000000 { field field } }. Always add "limit 10000000" (it covers every row) after a list filter; a filter of only equality tests means exactly ONE node.
- Tests: = != > < >= <=, &&, ||, parentheses. Text: field findLike "x" (case-insensitive substring; prefer it for names and titles).
- Follow a relationship inside the braces with its own arrow: { Movie(title findLike "Titanic") limit 100000 { title cast -> Person { name } } } and { Person(name findLike "Tom Hanks") limit 100000 { name acted_in <- Movie { title year } } }.
- Filter across a relationship with has: Movie(has cast(name findLike "Tom Hanks") && has cast(name findLike "Meg Ryan")). has genres(name findLike "animated").
- There is NO sort, count, sum or group in ZQL: fetch the rows and let the view do it with value ("sum(movies.gross)", "count(acted_in)"), sort and limit. Rows with the same label are grouped and summed (e.g. label "year", value "gross" gives one bar per year).
Examples:
- Top 10 by box office: kind bar, query { Movie limit 100000 { title gross } }, label "title", value "gross", limit 10.
- Box office by genre: kind pie, query { Genre limit 100000 { name movies <- Movie { gross } } }, label "name", value "sum(movies.gross)", limit 8.
- Films two actors share: kind graph, query { Movie(has cast(name findLike "A") && has cast(name findLike "B")) limit 100000 { title cast -> Person { name } } }.
- A director's films: kind table, query { Person(name findLike "Christopher Nolan") limit 100000 { name directed <- Movie { title year gross } } }.`;
}

export function createMoviesWire() {
  return createWire<MoviesState>({
    entities: [{
      type: 'view', list: (s) => s.order.map((id) => s.views[id]!), id: (v) => v.id,
      fields: [{ name: 'kind' }, { name: 'title' }, { name: 'query' }, { name: 'label', default: '' }, { name: 'value', default: '' }, { name: 'sort', default: '' }, { name: 'limit', default: 0 }],
    }],
  });
}

export function createMoviesStore() {
  return createStore<MoviesState>({ initial: initial(), actions: movieActions });
}
export type MoviesStore = ReturnType<typeof createMoviesStore>;
