import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createWire } from '../src/index.js';

const wire = () => createWire({
  entities: [
    { type: 'card', list: (s) => Object.values(s.cards), id: (c) => c.id, fields: [
      { name: 'title' }, { name: 'at', get: (c) => [c.x, c.y] }, { name: 'tone', default: 'plain' }, { name: 'body', default: '' },
    ] },
    { type: 'link', list: (s) => s.links, fields: [{ name: 'from', ref: 'card' }, { name: 'to', ref: 'card' }, { name: 'label', default: '' }] },
  ],
});
const state = {
  cards: {
    'visit-page': { id: 'visit-page', title: 'Visit', x: 40, y: 40, tone: 'plain', body: '' },
    checkout: { id: 'checkout', title: 'Check out', x: 580, y: 40, tone: 'warn', body: 'most "drop" here' },
  },
  links: [{ from: 'visit-page', to: 'checkout', label: '' }],
};

test('encode: schema line per type, handles, defaults omitted, strings quoted only when needed', () => {
  assert.equal(wire().encode(state), [
    'card(h title at [tone=plain] [body=""])',
    'c1 Visit 40,40',
    'c2 "Check out" 580,40 tone=warn body="most \\"drop\\" here"',
    'link(from to [label=""])',
    'c1 c2',
  ].join('\n'));
});

test('handles are stable across encodes and new items get the next one', () => {
  const w = wire();
  w.encode(state);
  const next = { ...state, cards: { pay: { id: 'pay', title: 'Pay', x: 0, y: 0, tone: 'plain', body: '' }, ...state.cards } };
  const lines = w.encode(next).split('\n');
  assert.ok(lines.includes('c3 Pay 0,0'), lines.join('\n'));
  assert.ok(lines.includes('c1 Visit 40,40'));
});

test('an empty collection says none', () => {
  assert.equal(wire().encode({ cards: {}, links: [] }), 'card(h title at [tone=plain] [body=""]) none\nlink(from to [label=""]) none');
});

test('resolve: handles in ref params become real ids; everything else passes through', () => {
  const w = wire();
  w.encode(state);
  const params = { from: { ref: 'card' }, to: { ref: 'card' }, label: {} };
  assert.deepEqual(w.resolve({ type: 'link.add', payload: { from: 'c2', to: 'c1', label: 'c1' } }, params).payload, { from: 'checkout', to: 'visit-page', label: 'c1' });
  assert.deepEqual(w.resolve({ type: 'link.add', payload: { from: 'checkout', to: 'c9' } }, params).payload, { from: 'checkout', to: 'c9' }, 'real ids and unknown handles are left alone');
});
