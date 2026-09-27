import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore, defineComponent, createViewport, layout } from '../src/index.js';

// APS 4: components that hold components (the zega.earth page / cqx pane case).
const note = defineComponent('note', { describe: 'text', sizes: ['small', 'medium', 'large', 'viewport'] });
const section = defineComponent('section', { describe: 'a titled group', sizes: ['large', 'viewport'], size: 'viewport', holds: 'grid' });
const tabs = defineComponent('tabs', { describe: 'one child at a time', sizes: ['viewport'], holds: 'tabs' });
const make = () => { const vp = createViewport({ components: [note, section, tabs], sources: {} }); return { vp, store: createStore({ initial: vp.initial(), actions: vp.actions }) }; };
const act = (store, type, payload) => store.dispatch({ type, payload }, 'agent');

test('components go into containers with "in", placed among their siblings', () => {
  const { store } = make();
  act(store, 'view.show', { id: 's', kind: 'section', title: 'Box office' });
  act(store, 'view.show', { id: 'a', kind: 'note', title: 'a', in: 's' });
  act(store, 'view.show', { id: 'b', kind: 'note', title: 'b', in: 's', at: 'before', target: 'a' });
  assert.deepEqual(store.state.order, ['s']);
  assert.deepEqual(store.state.items.s.children, ['b', 'a']);
  assert.match(act(store, 'view.show', { id: 'c', kind: 'note', title: 'c', in: 'b' }).error, /note "b" does not hold components/);
  assert.match(act(store, 'view.show', { id: 's', kind: 'section', title: 'x', in: 's' }).error, /cannot go inside itself/);
  assert.match(act(store, 'view.show', { id: 'd', kind: 'note', title: 'd', at: 'after', target: 'a' }).error, /"a" is not on the page/);
});

test('moving between containers and removing a container takes its children and selection', () => {
  const { store } = make();
  act(store, 'view.show', { id: 's', kind: 'section', title: 's' });
  act(store, 'view.show', { id: 'a', kind: 'note', title: 'a', in: 's' });
  act(store, 'view.show', { id: 'top', kind: 'note', title: 'top' });
  assert.equal(act(store, 'view.move', { id: 'top', at: 'end', in: 's' }).ok, true);
  assert.deepEqual(store.state.order, ['s']);
  assert.deepEqual(store.state.items.s.children, ['a', 'top']);
  store.dispatch({ type: 'select.set', payload: { view: 'a', items: 'x' } }, 'you');
  act(store, 'view.remove', { id: 's' });
  assert.deepEqual(store.state.order, []);
  assert.deepEqual(Object.keys(store.state.items), []);
  assert.equal(store.state.selection, null);
});

test('tabs: showing into tabs brings it to the front; view.focus switches; layout shows only the active tab', () => {
  const { store } = make();
  act(store, 'view.show', { id: 't', kind: 'tabs', title: 'Views' });
  act(store, 'view.show', { id: 'one', kind: 'note', title: '1', in: 't' });
  act(store, 'view.show', { id: 'two', kind: 'note', title: '2', in: 't' });
  assert.equal(store.state.items.t.active, 'two');
  assert.equal(act(store, 'view.focus', { id: 'one' }).ok, true);
  assert.equal(store.state.items.t.active, 'one');
  assert.deepEqual(layout(store.state, 1400, undefined, 't').cells, [{ id: 'one', cols: 6, rows: 0 }]);
  assert.match(act(store, 'view.focus', { id: 't' }).error, /not a tab/);
  act(store, 'view.remove', { id: 'one' });
  assert.equal(store.state.items.t.active, 'two', 'removing the front tab shows the next');
});

test('a container lays out its children for its own width', () => {
  const { store } = make();
  act(store, 'view.show', { id: 's', kind: 'section', title: 's' });
  act(store, 'view.show', { id: 'a', kind: 'note', title: 'a', in: 's', size: 'small' });
  act(store, 'view.show', { id: 'b', kind: 'note', title: 'b', in: 's', size: 'large' });
  assert.deepEqual(layout(store.state, 500, undefined, 's').cells.map((c) => [c.id, c.cols]), [['a', 1], ['b', 2]]);
  assert.deepEqual(layout(store.state, 1400).cells, [{ id: 's', cols: 6, rows: 0 }]);
});

test('catalogues without containers get no "in" and no view.focus', () => {
  const vp = createViewport({ components: [note], sources: {} });
  assert.equal(vp.actions.some((a) => a.type === 'view.focus'), false);
  assert.equal('in' in vp.actions.find((a) => a.type === 'view.show').params, false);
  assert.match(make().vp.catalogue(), /tabs \[viewport\*\] holds components as tabs/);
});
