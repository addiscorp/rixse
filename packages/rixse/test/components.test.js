import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore, defineComponent, defineSource, createViewport, layout } from '../src/index.js';

const rows = { films: [{ title: 'Heat', gross: 187 }, { title: 'Up', gross: 735 }], none: [] };
const db = defineSource({ describe: 'tiny', run: (q) => { if (!(q in rows)) throw new Error(`no table ${q}`); return rows[q]; }, hint: (e) => `${e}; tables are films, none` });
const stat = defineComponent('stat', { describe: 'one number', sizes: ['small', 'medium'], source: 'db', identity: ['query', 'value'], params: { value: { type: 'string' } },
  check: (r, it) => (r.every((x) => typeof x[it.value] === 'number') ? null : `"${it.value}" is not a number field`) });
const bar = defineComponent('bar', { describe: 'compare', sizes: ['medium', 'large', 'viewport'], size: 'large', source: 'db', params: { label: { type: 'string', default: 'title' }, value: { type: 'string' } } });
const note = defineComponent('note', { describe: 'text', sizes: ['small'] });
const make = () => { const vp = createViewport({ components: [stat, bar, note], sources: { db } }); return { vp, store: createStore({ initial: vp.initial(), actions: vp.actions }) }; };
const show = (store, p) => store.dispatch({ type: 'view.show', payload: p }, 'agent');

test('a size outside the kind is rejected with the sizes it has', () => {
  const { store } = make();
  const r = show(store, { id: 's', kind: 'stat', title: 'Gross', query: 'films', value: 'gross', size: 'large' });
  assert.equal(r.ok, false);
  assert.match(r.error, /stat comes in small, medium, not large/);
  assert.equal(show(store, { id: 's', kind: 'stat', title: 'Gross', query: 'films', value: 'gross' }).ok, true);
  assert.equal(store.state.items.s.size, 'small');
  assert.equal(store.dispatch({ type: 'view.resize', payload: { id: 's', size: 'viewport' } }, 'you').ok, false);
});

test('params belong to their kind; defaults fill in', () => {
  const { store } = make();
  const r = show(store, { id: 'b', kind: 'bar', title: 'Top', query: 'films', value: 'gross', x: 'year' });
  assert.equal(r.ok, false); // x is nobody's param: the door rejects it
  const r2 = show(store, { id: 's', kind: 'stat', title: 'Top', query: 'films', value: 'gross', label: 'title' });
  assert.match(r2.error, /stat has no "label"/);
  assert.equal(show(store, { id: 'b', kind: 'bar', title: 'Top', query: 'films', value: 'gross' }).ok, true);
  assert.equal(store.state.items.b.label, 'title');
  assert.equal(store.state.items.b.size, 'large');
});

test('source errors come back as the source’s fix; empty rows and checks reject', () => {
  const { store } = make();
  assert.match(show(store, { id: 's', kind: 'stat', title: 'x', query: 'flims', value: 'gross' }).error, /no table flims; tables are films, none/);
  assert.match(show(store, { id: 's', kind: 'stat', title: 'x', query: 'none', value: 'gross' }).error, /returned no rows/);
  assert.match(show(store, { id: 's', kind: 'stat', title: 'x', query: 'films', value: 'title' }).error, /"title" is not a number field/);
});

test('ensure: the same identity twice points at the one on screen', () => {
  const { store } = make();
  assert.equal(show(store, { id: 's1', kind: 'stat', title: 'a', query: 'films', value: 'gross' }).ok, true);
  const r = show(store, { id: 's2', kind: 'stat', title: 'b', query: 'films', value: 'gross' });
  assert.match(r.error, /already showing as "s1"/);
  assert.equal(show(store, { id: 's1', kind: 'stat', title: 'renamed', query: 'films', value: 'gross' }).ok, true);
  assert.deepEqual(store.state.order, ['s1']);
});

test('replace takes the spot and drops the old one and its selection', () => {
  const { store } = make();
  show(store, { id: 'a', kind: 'note', title: 'a' });
  show(store, { id: 'b', kind: 'bar', title: 'b', query: 'films', value: 'gross' });
  show(store, { id: 'c', kind: 'note', title: 'c' });
  store.dispatch({ type: 'select.set', payload: { view: 'b', items: 'Heat' } }, 'you');
  assert.equal(show(store, { id: 'p', kind: 'stat', title: 'p', query: 'films', value: 'gross', at: 'replace', target: 'b' }).ok, true);
  assert.deepEqual(store.state.order, ['a', 'p', 'c']);
  assert.equal(store.state.items.b, undefined);
  assert.equal(store.state.selection, null);
});

test('layout: columns follow the container; sizes clamp; viewport takes the row', () => {
  const { store } = make();
  show(store, { id: 's', kind: 'stat', title: 's', query: 'films', value: 'gross' });
  show(store, { id: 'b', kind: 'bar', title: 'b', query: 'films', value: 'gross' });
  show(store, { id: 'w', kind: 'bar', title: 'w', query: 'films', value: 'gross', size: 'viewport' });
  const wide = layout(store.state, 1400), narrow = layout(store.state, 400);
  assert.equal(wide.cols, 6);
  assert.deepEqual(wide.cells.map((c) => [c.id, c.cols, c.rows]), [['s', 1, 1], ['b', 2, 2], ['w', 6, 0]]);
  assert.equal(narrow.cols, 2);
  assert.deepEqual(narrow.cells.map((c) => c.cols), [1, 2, 2]);
});

test('the catalogue is generated from the definitions', () => {
  const { vp } = make();
  const text = vp.catalogue();
  assert.match(text, /- stat \[small\*\|medium\] reads db: one number/);
  assert.match(text, /- bar \[medium\|large\*\|viewport\]/);
  assert.match(text, /label\?: string = "title"/);
  assert.match(text, /## Source "db"\ntiny/);
});
