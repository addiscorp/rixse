import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createStore, defineAction, Rejected } from '../src/index.js';

const add = defineAction('item.add', {
  describe: 'Add an item.',
  params: { id: { type: 'string' }, tone: { type: 'enum', values: ['a', 'b'], optional: true } },
  apply: (s, p) => {
    if (s.items[p.id]) throw new Rejected(`item "${p.id}" exists`);
    return { items: { ...s.items, [p.id]: { tone: p.tone ?? 'a' } } };
  },
});
const store = () => createStore({ initial: { items: {} }, actions: [add] });

test('an applied action changes state and is logged with its author', () => {
  const s = store();
  const r = s.dispatch({ type: 'item.add', payload: { id: 'x' } }, 'agent', { why: 'asked' });
  assert.equal(r.ok, true);
  assert.deepEqual(s.state, { items: { x: { tone: 'a' } } });
  assert.deepEqual(s.log.map((e) => [e.author, e.type, e.why]), [['agent', 'item.add', 'asked']]);
});

test('invalid and rejected actions leave state and log untouched, with a reason', () => {
  const s = store();
  const events = [];
  s.subscribe((e) => events.push(e.kind === 'rejected' ? e.error : e.kind));
  s.dispatch({ type: 'item.add', payload: { id: 'x' } }, 'you');
  const before = s.state;
  assert.deepEqual(s.dispatch({ type: 'nope' }, 'agent'), { ok: false, error: 'unknown action "nope"' });
  assert.equal(s.dispatch({ type: 'item.add', payload: { id: 'y', tone: 'z' } }, 'agent').ok, false);
  assert.equal(s.dispatch({ type: 'item.add', payload: { id: 'y', extra: 1 } }, 'agent').ok, false);
  assert.equal(s.dispatch({ type: 'item.add', payload: { id: 'x' } }, 'agent').ok, false);
  assert.equal(s.state, before);
  assert.equal(s.log.length, 1);
  assert.deepEqual(events, ['applied', 'unknown action "nope"', '"tone" must be one of a, b', 'unknown field "extra"', 'item "x" exists']);
});

test('undo walks back one action at a time, whoever made it', () => {
  const s = store();
  s.dispatch({ type: 'item.add', payload: { id: 'a' } }, 'you');
  s.dispatch({ type: 'item.add', payload: { id: 'b' } }, 'agent');
  assert.equal(s.undo()?.author, 'agent');
  assert.deepEqual(Object.keys(s.state.items), ['a']);
  s.dispatch({ type: 'item.add', payload: { id: 'c' } }, 'agent');
  s.undo();
  assert.deepEqual(Object.keys(s.state.items), ['a']);
  s.undo();
  assert.deepEqual(s.state.items, {});
  assert.equal(s.undo(), null);
});

test('a proposal applies in order; each action succeeds or fails alone', () => {
  const s = store();
  const results = s.applyProposal([
    { type: 'item.add', payload: { id: 'a' } },
    { type: 'item.add', payload: { id: 'a' } },
    { type: 'item.add', payload: { id: 'b', tone: 'b' } },
  ], 'two items');
  assert.deepEqual(results.map((r) => r.result.ok), [true, false, true]);
  assert.deepEqual(Object.keys(s.state.items), ['a', 'b']);
});

test('the vocabulary names every action and its fields for the model', () => {
  assert.equal(store().vocabulary(), 'item.add { id: string; tone?: "a" | "b" } — Add an item.');
});
