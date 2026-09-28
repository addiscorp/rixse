// Generates the shared conformance vectors from the JS core. The committed
// files under conformance/ are the ONE definition of correct behaviour: the JS
// test suite fails if regenerating changes them, and packages/rixse-swift's
// `swift test` replays every one of them. Never hand-edit the generated files;
// change this generator or the core and regenerate.
//
//   node conformance/generate.mjs          # write the vectors
//   node conformance/generate.mjs --check  # exit 1 if the committed files differ
import { existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createStore, createViewport, createWire, defineComponent, defineSource, layout, place, validate } from '../packages/rixse/src/index.js';

const DIR = path.resolve(fileURLToPath(new URL('.', import.meta.url)));
const REPO = path.resolve(DIR, '..');

// demos/shared/movies.js imports the bare specifier 'rixse'. Give node a
// workspace symlink when npm install has not made one (tooling only).
if (!existsSync(path.join(REPO, 'node_modules/rixse'))) {
  mkdirSync(path.join(REPO, 'node_modules'), { recursive: true });
  symlinkSync('../packages/rixse', path.join(REPO, 'node_modules/rixse'), 'dir');
}

/** JSON.stringify with object keys sorted, so files compare byte-for-byte across runs and platforms. */
const stable = (v) => JSON.stringify(v, (_k, x) => (x && typeof x === 'object' && !Array.isArray(x)
  ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, x[k]]))
  : x), 2) + '\n';

// ---------------------------------------------------------------------------
// The fixture catalogue (shared with the Swift tests through fixture.json).
// A stat/bar/note catalogue over a two-table source, rich enough to hit every
// viewport check: sizes, identity, defaults, a check, source errors and hints.
// ---------------------------------------------------------------------------
const TABLES = { films: [{ title: 'Heat', gross: 187 }, { title: 'Up', gross: 735 }], none: [] };

const fixtureSource = () => defineSource({
  describe: 'tiny',
  run: (q) => { if (!(q in TABLES)) throw new Error(`no table ${q}`); return TABLES[q]; },
  hint: (e) => `${e}; tables are films, none`,
});

const fixtureComponents = () => [
  defineComponent('stat', {
    describe: 'one number', sizes: ['small', 'medium'], source: 'db', identity: ['query', 'value'],
    params: { value: { type: 'string' } },
    check: (rows, it) => (rows.every((x) => typeof x[it.value] === 'number') ? null : `"${it.value}" is not a number field`),
  }),
  defineComponent('bar', {
    describe: 'compare', sizes: ['medium', 'large', 'viewport'], size: 'large', source: 'db',
    params: { label: { type: 'string', default: 'title' }, value: { type: 'string' } },
  }),
  defineComponent('note', { describe: 'text', sizes: ['small'] }),
];

const fixtureViewport = () => createViewport({ components: fixtureComponents(), sources: { db: fixtureSource() } });
const fixtureStore = () => { const vp = fixtureViewport(); return createStore({ initial: vp.initial(), actions: vp.actions }); };

// ---------------------------------------------------------------------------
// Component/source definitions exported as data, so Swift builds the SAME
// catalogues from this file instead of a hand-copied translation.
// ---------------------------------------------------------------------------
const paramSpec = (p) => ({
  type: p.type,
  ...(p.values ? { values: p.values } : {}),
  ...(p.optional ? { optional: true } : {}),
  ...(p.describe !== undefined ? { describe: p.describe } : {}),
  ...(p.ref ? { ref: p.ref } : {}),
  ...('default' in p ? { default: p.default } : {}),
});
const componentSpec = (c) => ({
  kind: c.kind, describe: c.describe, sizes: c.sizes, size: c.size,
  ...(c.source ? { source: c.source } : {}),
  ...(c.identity ? { identity: c.identity } : {}),
  ...(c.select ? { select: c.select } : {}),
  ...(c.check ? { hasCheck: true } : {}),
  params: Object.fromEntries(Object.entries(c.params).map(([n, p]) => [n, paramSpec(p)])),
});

// ---------------------------------------------------------------------------
// Viewport scenarios: a script of dispatches/undos with the full state and
// authored log recorded after every step. Swift replays them and must land on
// the same state, the same ok/error, and the same log (minus timestamps).
// ---------------------------------------------------------------------------
function scenario(name, steps) {
  const store = fixtureStore();
  const snap = () => ({ state: store.state, log: store.log.map(({ at: _at, ...e }) => e) });
  const out = [];
  for (const step of steps) {
    if (step.dispatch) {
      const author = step.dispatch.author ?? 'agent';
      const r = store.dispatch(step.dispatch.action, author, step.dispatch.why ? { why: step.dispatch.why } : {});
      out.push({ op: 'dispatch', action: step.dispatch.action, author, ...(step.dispatch.why ? { why: step.dispatch.why } : {}), ok: r.ok, ...(r.ok ? {} : { error: r.error }), ...snap() });
    } else if (step.undo) {
      const e = store.undo();
      out.push({ op: 'undo', entry: e ? { seq: e.seq, author: e.author, type: e.type } : null, ...snap() });
    } else if (step.proposal) {
      const results = store.applyProposal(step.proposal.actions, step.proposal.why);
      out.push({ op: 'proposal', actions: step.proposal.actions, ...(step.proposal.why ? { why: step.proposal.why } : {}), results: results.map((r) => ({ ok: r.result.ok, ...(r.result.ok ? {} : { error: r.result.error }) })), ...snap() });
    } else {
      throw new Error(`unknown step in scenario "${name}"`);
    }
  }
  return { name, steps: out };
}

const show = (payload, extra = {}) => ({ dispatch: { action: { type: 'view.show', payload }, ...extra } });

const scenarios = [
  scenario('size: a size outside the kind is rejected; defaults and re-show keep the size', [
    show({ id: 's', kind: 'stat', title: 'Gross', query: 'films', value: 'gross', size: 'large' }),
    show({ id: 's', kind: 'stat', title: 'Gross', query: 'films', value: 'gross' }),
    { dispatch: { action: { type: 'view.resize', payload: { id: 's', size: 'viewport' } }, author: 'you' } },
    { dispatch: { action: { type: 'view.resize', payload: { id: 's', size: 'medium' } }, author: 'you' } },
    show({ id: 's', kind: 'stat', title: 'Gross again', query: 'films', value: 'gross' }),
  ]),
  scenario('params belong to their kind; defaults fill in', [
    show({ id: 'b', kind: 'bar', title: 'Top', query: 'films', value: 'gross', x: 'year' }),
    show({ id: 's', kind: 'stat', title: 'Top', query: 'films', value: 'gross', label: 'title' }),
    show({ id: 'b', kind: 'bar', title: 'Top', query: 'films', value: 'gross' }),
  ]),
  scenario('missing required params and queries reject', [
    show({ id: 's', kind: 'stat', title: 'x', query: 'films' }),
    show({ id: 'b', kind: 'bar', title: 'x', value: 'gross' }),
  ]),
  scenario('source errors come back as the fix; empty rows and checks reject', [
    show({ id: 's', kind: 'stat', title: 'x', query: 'flims', value: 'gross' }),
    show({ id: 's', kind: 'stat', title: 'x', query: 'none', value: 'gross' }),
    show({ id: 's', kind: 'stat', title: 'x', query: 'films', value: 'title' }),
  ]),
  scenario('ensure: the same identity twice points at the one on screen', [
    show({ id: 's1', kind: 'stat', title: 'a', query: 'films', value: 'gross' }),
    show({ id: 's2', kind: 'stat', title: 'b', query: 'films', value: 'gross' }),
    show({ id: 's1', kind: 'stat', title: 'renamed', query: 'films', value: 'gross' }),
  ]),
  scenario('replace takes the spot and drops the old one and its selection', [
    show({ id: 'a', kind: 'note', title: 'a' }),
    show({ id: 'b', kind: 'bar', title: 'b', query: 'films', value: 'gross' }),
    show({ id: 'c', kind: 'note', title: 'c' }),
    { dispatch: { action: { type: 'select.set', payload: { view: 'b', items: 'Heat' } }, author: 'you' } },
    show({ id: 'p', kind: 'stat', title: 'p', query: 'films', value: 'gross', at: 'replace', target: 'b' }),
  ]),
  scenario('changing the selected component drops its selection', [
    show({ id: 'b', kind: 'bar', title: 'b', query: 'films', value: 'gross' }),
    { dispatch: { action: { type: 'select.set', payload: { view: 'b', items: 'Heat|Up' } }, author: 'you' } },
    show({ id: 'b', kind: 'bar', title: 'b2', query: 'films', value: 'gross', label: 'name' }),
  ]),
  scenario('placement: before/after/replace and their rejections', [
    show({ id: 'a', kind: 'note', title: 'a' }),
    show({ id: 'b', kind: 'note', title: 'b', at: 'before', target: 'a' }),
    show({ id: 'c', kind: 'note', title: 'c', at: 'after', target: 'a' }),
    show({ id: 'd', kind: 'note', title: 'd', at: 'before' }),
    show({ id: 'd', kind: 'note', title: 'd', at: 'before', target: 'zz' }),
    show({ id: 'd', kind: 'note', title: 'd', at: 'replace', target: 'zz' }),
    show({ id: 'a', kind: 'note', title: 'a', at: 'after', target: 'a' }),
  ]),
  scenario('move: end/before/after, unknown components and bad "at" reject', [
    show({ id: 'a', kind: 'note', title: 'a' }),
    show({ id: 'b', kind: 'note', title: 'b' }),
    show({ id: 'c', kind: 'note', title: 'c' }),
    { dispatch: { action: { type: 'view.move', payload: { id: 'a', at: 'after', target: 'c' } }, author: 'you' } },
    { dispatch: { action: { type: 'view.move', payload: { id: 'c', at: 'before', target: 'b' } }, author: 'agent' } },
    { dispatch: { action: { type: 'view.move', payload: { id: 'c', at: 'end' } }, author: 'agent' } },
    { dispatch: { action: { type: 'view.move', payload: { id: 'zz', at: 'end' } }, author: 'agent' } },
    { dispatch: { action: { type: 'view.move', payload: { id: 'a', at: 'replace', target: 'b' } }, author: 'agent' } },
  ]),
  scenario('remove and clear; removing the selected component clears the selection', [
    show({ id: 'a', kind: 'note', title: 'a' }),
    show({ id: 'b', kind: 'bar', title: 'b', query: 'films', value: 'gross' }),
    { dispatch: { action: { type: 'view.remove', payload: { id: 'zz' } }, author: 'you' } },
    { dispatch: { action: { type: 'select.set', payload: { view: 'b', items: 'Heat' } }, author: 'you' } },
    { dispatch: { action: { type: 'view.remove', payload: { id: 'b' } }, author: 'agent' } },
    { dispatch: { action: { type: 'view.clear', payload: {} }, author: 'agent' } },
  ]),
  scenario('select: missing views, empty selections, dedupe, clear', [
    show({ id: 'b', kind: 'bar', title: 'b', query: 'films', value: 'gross' }),
    { dispatch: { action: { type: 'select.set', payload: { view: 'zz', items: 'Heat' } }, author: 'you' } },
    { dispatch: { action: { type: 'select.set', payload: { view: 'b', items: ' | ' } }, author: 'you' } },
    { dispatch: { action: { type: 'select.set', payload: { view: 'b', items: 'Heat|Heat| Up ' } }, author: 'you' } },
    { dispatch: { action: { type: 'select.clear', payload: {} }, author: 'agent' } },
  ]),
  scenario('undo walks back one action at a time, whoever made it', [
    show({ id: 'a', kind: 'note', title: 'a', }, { author: 'you' }),
    show({ id: 'b', kind: 'note', title: 'b' }),
    { dispatch: { action: { type: 'select.set', payload: { view: 'a', items: 'x' } }, author: 'you', why: 'pointing' } },
    { undo: true },
    { undo: true },
    show({ id: 'c', kind: 'note', title: 'c' }),
    { undo: true },
    { undo: true },
    { undo: true },
  ]),
  scenario('the door: unknown actions and bad payloads reject without touching state', [
    show({ id: 'a', kind: 'note', title: 'a' }),
    { dispatch: { action: { type: 'nope', payload: {} }, author: 'agent' } },
    { dispatch: { action: { type: 'view.remove', payload: {} }, author: 'agent' } },
    { dispatch: { action: { type: 'view.show', payload: { id: 'x', kind: 'zz', title: 't' } }, author: 'agent' } },
  ]),
  scenario('a proposal applies in order; each action succeeds or fails alone', [
    { proposal: { actions: [
      { type: 'view.show', payload: { id: 'a', kind: 'note', title: 'a' } },
      { type: 'view.show', payload: { id: 'b', kind: 'stat', title: 'b', query: 'flims', value: 'gross' } },
      { type: 'view.show', payload: { id: 'c', kind: 'note', title: 'c' } },
    ], why: 'three things' } },
  ]),
];

// ---------------------------------------------------------------------------
// Layout: states (with the dispatch script that built them, for reading) and
// the cells layout() must return at 400/900/1400 with default bands, plus one
// custom-bands case.
// ---------------------------------------------------------------------------
function layoutCase(name, steps, widths = [400, 900, 1400], bands) {
  const store = fixtureStore();
  for (const p of steps) store.dispatch({ type: 'view.show', payload: p }, 'agent');
  return {
    name,
    shown: steps,
    state: store.state,
    ...(bands ? { bands } : {}),
    expect: Object.fromEntries(widths.map((w) => [w, layout(store.state, w, bands)])),
  };
}
const layouts = [
  layoutCase('columns follow the container; sizes clamp; viewport takes the row', [
    { id: 's', kind: 'stat', title: 's', query: 'films', value: 'gross' },
    { id: 'b', kind: 'bar', title: 'b', query: 'films', value: 'gross' },
    { id: 'w', kind: 'bar', title: 'w', query: 'films', value: 'gross', size: 'viewport' },
  ]),
  layoutCase('custom bands', [
    { id: 'a', kind: 'note', title: 'a' },
    { id: 'b', kind: 'bar', title: 'b', query: 'films', value: 'gross' },
  ], [400, 900], [{ min: 0, cols: 1 }, { min: 500, cols: 3 }]),
];

// ---------------------------------------------------------------------------
// validate(), place(), defineComponent() and createViewport() as pure vectors.
// ---------------------------------------------------------------------------
const validates = [
  { name: 'payload must be an object', params: { id: { type: 'string' } }, payload: [1, 2], expect: 'payload must be an object' },
  { name: 'payload null', params: { id: { type: 'string' } }, payload: null, expect: 'payload must be an object' },
  { name: 'unknown field', params: { id: { type: 'string' } }, payload: { id: 'x', zz: 1 }, expect: 'unknown field "zz"' },
  { name: 'missing required', params: { id: { type: 'string' }, n: { type: 'number', optional: true } }, payload: {}, expect: 'missing "id"' },
  { name: 'null is missing when required', params: { id: { type: 'string' } }, payload: { id: null }, expect: 'missing "id"' },
  { name: 'null is fine when optional', params: { id: { type: 'string', optional: true } }, payload: { id: null }, expect: null },
  { name: 'enum rejects other values', params: { t: { type: 'enum', values: ['a', 'b'] } }, payload: { t: 'z' }, expect: '"t" must be one of a, b' },
  { name: 'enum accepts', params: { t: { type: 'enum', values: ['a', 'b'] } }, payload: { t: 'a' }, expect: null },
  { name: 'number rejects strings', params: { n: { type: 'number' } }, payload: { n: '3' }, expect: '"n" must be a number' },
  { name: 'number accepts', params: { n: { type: 'number' } }, payload: { n: 3.5 }, expect: null },
  { name: 'boolean rejects', params: { b: { type: 'boolean' } }, payload: { b: 'yes' }, expect: '"b" must be a boolean' },
  { name: 'string rejects', params: { s: { type: 'string' } }, payload: { s: 4 }, expect: '"s" must be a string' },
  { name: 'ok', params: { id: { type: 'string' }, n: { type: 'number', optional: true } }, payload: { id: 'x' }, expect: null },
];

const places = [
  { name: 'end appends', order: ['a', 'b'], id: 'c', expect: { order: ['a', 'b', 'c'] } },
  { name: 'end moves an existing id', order: ['a', 'b'], id: 'a', expect: { order: ['b', 'a'] } },
  { name: 'before', order: ['a', 'b'], id: 'c', at: 'before', target: 'b', expect: { order: ['a', 'c', 'b'] } },
  { name: 'after', order: ['a', 'b'], id: 'c', at: 'after', target: 'a', expect: { order: ['a', 'c', 'b'] } },
  { name: 'replace removes the target and takes its spot', order: ['a', 'b', 'c'], id: 'd', at: 'replace', target: 'b', expect: { order: ['a', 'd', 'c'], removed: 'b' } },
  { name: 'replace of an id already present', order: ['a', 'b', 'c'], id: 'c', at: 'replace', target: 'a', expect: { order: ['c', 'b'], removed: 'a' } },
  { name: 'at needs a target', order: ['a'], id: 'b', at: 'before', expect: { error: 'at "before" needs a target' } },
  { name: 'not relative to itself', order: ['a'], id: 'a', at: 'after', target: 'a', expect: { error: 'a component cannot be placed relative to itself' } },
  { name: 'unknown target before', order: ['a'], id: 'b', at: 'before', target: 'zz', expect: { error: 'no component "zz" to place before' } },
  { name: 'unknown target replace', order: ['a'], id: 'b', at: 'replace', target: 'zz', expect: { error: 'no component "zz" to place over' } },
];

const definitions = [
  { name: 'no sizes', kind: 'x', def: { describe: 'd', sizes: [] }, error: 'component "x" needs at least one size' },
  { name: 'sizes missing', kind: 'x', def: { describe: 'd' }, error: 'component "x" needs at least one size' },
  { name: 'unknown size', kind: 'x', def: { describe: 'd', sizes: ['huge'] }, error: 'component "x": unknown size "huge"' },
  { name: 'default size not one of its sizes', kind: 'x', def: { describe: 'd', sizes: ['small'], size: 'large' }, error: 'component "x": default size "large" is not one of its sizes' },
];

const viewportErrors = [
  { name: 'a component reading an unknown source', error: 'component "stat" reads unknown source "db"' },
];

// ---------------------------------------------------------------------------
// Wire: entity specs as data, rows materialised by the REAL createWire (list +
// get applied), the exact encode text, and resolve() cases with the store's
// own param specs. Swift feeds the same specs and rows through its encoder.
// ---------------------------------------------------------------------------
const materialise = (wire, entities, state) => Object.fromEntries(entities.map((e) => [e.type, e.list(state).map((item) => ({
  ...(e.id ? { _id: e.id(item) } : {}),
  ...Object.fromEntries(e.fields.map((f) => [f.name, f.get ? f.get(item) : item[f.name]])),
}))]));

const cardLinkEntities = [
  { type: 'card', list: (s) => Object.values(s.cards), id: (c) => c.id, fields: [
    { name: 'title' }, { name: 'at', get: (c) => [c.x, c.y] }, { name: 'tone', default: 'plain' }, { name: 'body', default: '' },
  ] },
  { type: 'link', list: (s) => s.links, fields: [{ name: 'from', ref: 'card' }, { name: 'to', ref: 'card' }, { name: 'label', default: '' }] },
];
const cardLinkSpec = {
  entities: [
    { type: 'card', idField: 'id', fields: [{ name: 'title' }, { name: 'at' }, { name: 'tone', default: 'plain' }, { name: 'body', default: '' }] },
    { type: 'link', fields: [{ name: 'from', ref: 'card' }, { name: 'to', ref: 'card' }, { name: 'label', default: '' }] },
  ],
};
const cardLinkState = {
  cards: {
    'visit-page': { id: 'visit-page', title: 'Visit', x: 40, y: 40, tone: 'plain', body: '' },
    checkout: { id: 'checkout', title: 'Check out', x: 580, y: 40, tone: 'warn', body: 'most "drop" here' },
  },
  links: [{ from: 'visit-page', to: 'checkout', label: '' }],
};

function wireFile(spec, entities, cases) {
  const legend = createWire({ entities }).legend();
  return {
    spec,
    legend,
    cases: cases.map((c) => {
      const wire = createWire({ entities });
      const text = wire.encode(c.state);
      return {
        name: c.name,
        state: c.state,
        rows: materialise(wire, entities, c.state),
        encode: text,
        resolves: (c.resolves ?? []).map((r) => ({ action: r.action, params: r.params, expect: wire.resolve(r.action, r.params) })),
      };
    }),
  };
}

const wires = wireFile(cardLinkSpec, cardLinkEntities, [
  {
    name: 'schema line per type, handles, defaults omitted, strings quoted only when needed',
    state: cardLinkState,
    resolves: [
      { action: { type: 'link.add', payload: { from: 'c2', to: 'c1', label: 'c1' } }, params: { from: { ref: 'card' }, to: { ref: 'card' }, label: {} } },
      { action: { type: 'link.add', payload: { from: 'checkout', to: 'c9' } }, params: { from: { ref: 'card' }, to: { ref: 'card' } } },
    ],
  },
  { name: 'an empty collection says none', state: { cards: {}, links: [] } },
]);

export async function build() {
  // The movies catalogue and vocabulary, from the demo's own definitions, with
  // the real schema text in the source description.
  const movies = await import(path.join(REPO, 'demos/shared/movies.js'));
  const zql = readFileSync(path.join(REPO, 'demos/canvas/public/zega/samples/movies.zql'), 'utf8');
  const schema = zql.slice(zql.indexOf('schema {'), zql.indexOf('display {')).trim() + '\n}';
  const moviesBriefText = movies.moviesBrief(schema); // also fixes the schema into the source description
  const moviesStore = movies.createMoviesStore();

  const fixture = {
    source: { describe: 'tiny', hintSuffix: '; tables are films, none', tables: TABLES },
    components: fixtureComponents().map(componentSpec),
    movies: {
      sourceDescribe: movies.zegaSource.describe(),
      sourceQuery: movies.zegaSource.query,
      components: movies.movieComponents.map(componentSpec),
    },
  };

  // Movies wire: entity specs match createMoviesWire; states are literals.
  const moviesWireEntities = [
    { type: 'selected', list: (s) => (s.selection ? s.selection.items.map((item) => ({ view: s.selection.view, item })) : []), fields: [{ name: 'view', ref: 'view' }, { name: 'item' }] },
    { type: 'view', list: (s) => s.order.map((id) => s.items[id]), id: (v) => v.id, fields: [{ name: 'kind' }, { name: 'title' }, { name: 'size' }, { name: 'query' }, ...['label', 'value', 'sort', 'limit', 'x', 'flag', 'threshold', 'notes'].map((name) => { const d = { limit: 0, threshold: 0, flag: 'none' }[name] ?? ''; return { name, default: d, get: (v) => v[name] ?? d }; })] },
  ];
  const moviesWireSpec = {
    entities: [
      { type: 'selected', fields: [{ name: 'view', ref: 'view' }, { name: 'item' }] },
      { type: 'view', idField: 'id', fields: [{ name: 'kind' }, { name: 'title' }, { name: 'size' }, { name: 'query' }, ...['label', 'value', 'sort', 'limit', 'x', 'flag', 'threshold', 'notes'].map((name) => ({ name, default: { limit: 0, threshold: 0, flag: 'none' }[name] ?? '' }))] },
    ],
  };
  const moviesState = {
    items: {
      'top-10': { id: 'top-10', kind: 'bar', title: 'Top 10', size: 'medium', query: '{ Movie limit 100000 { title gross } }', label: 'title', value: 'gross', sort: '', limit: 10 },
      titanic: { id: 'titanic', kind: 'stat', title: 'Titanic', size: 'small', query: '{ Movie(title findLike "Titanic") limit 100000 { title gross } }', label: 'title', value: 'gross' },
    },
    order: ['top-10', 'titanic'],
    selection: { view: 'top-10', items: ['Avatar', 'Titanic'] },
  };
  const moviesWires = wireFile(moviesWireSpec, moviesWireEntities, [
    {
      name: 'selection rows come first and name their view by handle',
      state: moviesState,
      resolves: [
        { action: { type: 'view.resize', payload: { id: 'v2', size: 'large' } }, params: moviesStore.params('view.resize') },
        { action: { type: 'select.set', payload: { view: 'v1', items: 'Titanic' } }, params: moviesStore.params('select.set') },
        { action: { type: 'view.show', payload: { id: 'new-slug', kind: 'bar', title: 'x', query: 'q', at: 'after', target: 'v1' } }, params: moviesStore.params('view.show') },
        { action: { type: 'view.remove', payload: { id: 'v9' } }, params: moviesStore.params('view.remove') },
        { action: { type: 'view.remove', payload: { id: 'top-10' } }, params: moviesStore.params('view.remove') },
      ],
    },
    { name: 'empty state', state: { items: {}, order: [], selection: null } },
  ]);

  // view.show needs a query for sourced kinds; the fixture run never touches it.
  const vp = fixtureViewport();
  return new Map(Object.entries({
    // fixture.json carries component definitions whose param ORDER is semantic
    // (it drives the catalogue and vocabulary text), so it is written in
    // definition order, not key-sorted.
    'fixture.json': JSON.stringify(fixture, null, 2) + '\n',
    'validate.json': stable(validates.map((v) => ({ ...v, expect: validate(v.params, v.payload) }))),
    'place.json': stable(places.map((p) => {
      try { return { ...p, expect: place(p.order, p.id, p.at, p.target) }; }
      catch (e) { return { ...p, expect: { error: e.message } }; }
    })),
    'define-component.json': stable(definitions.map((d) => {
      try { defineComponent(d.kind, d.def); return { ...d, error: null }; }
      catch (e) { return { ...d, error: e.message }; }
    })),
    'create-viewport.json': stable(viewportErrors.map((v) => {
      try { createViewport({ components: fixtureComponents(), sources: {} }); return { ...v, error: null }; }
      catch (e) { return { ...v, error: e.message }; }
    })),
    'viewport.json': stable(scenarios),
    'layout.json': stable(layouts),
    'wire.json': stable(wires),
    'movies-wire.json': stable(moviesWires),
    'catalogue.txt': vp.catalogue() + '\n',
    'vocabulary.txt': fixtureStore().vocabulary() + '\n',
    'movies-catalogue.txt': movies.moviesViewport.catalogue() + '\n',
    'movies-vocabulary.txt': moviesStore.vocabulary() + '\n',
    'movies-brief.txt': moviesBriefText + '\n',
  }));
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const files = await build();
  const check = process.argv.includes('--check');
  let failed = false;
  for (const [name, content] of files) {
    const file = path.join(DIR, name);
    if (check) {
      const current = existsSync(file) ? readFileSync(file, 'utf8') : null;
      if (current !== content) { console.error(`stale: conformance/${name}`); failed = true; }
    } else {
      writeFileSync(file, content);
      console.log(`wrote conformance/${name}`);
    }
  }
  if (failed) { console.error('run: node conformance/generate.mjs'); process.exit(1); }
  if (check) console.log('conformance vectors are up to date');
}
