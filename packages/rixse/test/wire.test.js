import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createWireContext, decodeWireState, encodeWireState, parseWireOps } from '../src/wire.js';

function random(seed) {
  let n = seed >>> 0;
  return () => { n = (n * 1664525 + 1013904223) >>> 0; return n / 0x1_0000_0000; };
}

test('wire state round-trips 500 deterministic randomized canvas states exactly', () => {
  const rand = random(0x72697873);
  const tones = ['plain', 'accent', 'good', 'warn'];
  for (let sample = 0; sample < 500; sample++) {
    const state = { cards: {}, links: [] };
    const count = Math.floor(rand() * 18);
    for (let i = 0; i < count; i++) {
      const id = `card ${sample}-${i}`;
      state.cards[id] = { id, title: `title ${i} "quoted"`, body: rand() < 0.5 ? '' : `body, ${i}\nnext`, x: Math.floor(rand() * 981), y: Math.floor(rand() * 681), tone: tones[Math.floor(rand() * tones.length)] };
    }
    const ids = Object.keys(state.cards);
    for (let i = 1; i < ids.length; i++) if (rand() < 0.4) state.links.push({ from: ids[i - 1], to: ids[i], label: rand() < 0.5 ? '' : `label ${i}` });
    const context = createWireContext(state);
    assert.deepEqual(decodeWireState(encodeWireState(state, context), context), state, `sample ${sample}`);
  }
});

test('wire operations map handles to the canvas vocabulary and count invalid lines', () => {
  const context = createWireContext({ cards: { alpha: { id: 'alpha' }, beta: { id: 'beta' } }, links: [] });
  const parsed = parseWireOps('say: Done\n+c3 card "Pay now" accent 580,200 "body text"\n~c1 tone=warn title="Risk"\n>c2 80,90\n=c1 c2 "next"\n-c2\n?bad', context);
  assert.equal(parsed.say, 'Done');
  assert.deepEqual(parsed.actions.map((action) => action.type), ['card.add', 'card.update', 'card.move', 'link.add', 'card.remove']);
  assert.deepEqual(parsed.actions[0].payload, { id: 'wire-c3', title: 'Pay now', tone: 'accent', x: 580, y: 200, body: 'body text' });
  assert.equal(parsed.rejected.length, 1);
  assert.match(parsed.rejected[0].reason, /unknown operation/);
});
