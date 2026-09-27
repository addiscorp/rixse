import React from 'react';

const h = React.createElement;
const CARD_W = 220;

export function canvasTree(state) {
  const cards = Object.values(state.cards);
  const at = Object.fromEntries(cards.map((c) => [c.id, c]));
  const paths = state.links.flatMap((l) => {
    const a = at[l.from], b = at[l.to];
    if (!a || !b) return [];
    const x1 = a.x + CARD_W, y1 = a.y + 36, x2 = b.x, y2 = b.y + 36;
    const back = x2 < x1;
    const d = back ? `M${a.x + CARD_W / 2} ${a.y + 72} C ${a.x + CARD_W / 2} ${a.y + 140}, ${b.x + CARD_W / 2} ${b.y - 60}, ${b.x + CARD_W / 2} ${b.y}` : `M${x1} ${y1} C ${x1 + 50} ${y1}, ${x2 - 50} ${y2}, ${x2} ${y2}`;
    return [h('g', { key: `${l.from}>${l.to}` }, h('path', { d, markerEnd: 'url(#arrow)' }), l.label && h('text', { x: (x1 + x2) / 2, y: (y1 + y2) / 2 - 6, textAnchor: 'middle' }, l.label))];
  });
  return h('section', { className: 'pane canvas', 'aria-label': 'Canvas' },
    h('div', { className: 'pane-head' }, h('h2', { className: 'pane-title' }, 'Canvas'), h('span', { className: 'soft' }, `${cards.length} cards · ${state.links.length} arrows · drag to move · double-click to add · 100%`)),
    h('div', { className: 'board-scroll' }, h('div', { className: 'board', style: { width: 1200, height: 800, transform: 'scale(1)' } },
      h('svg', { className: 'links', width: 1200, height: 800, 'aria-hidden': 'true' }, h('defs', null, h('marker', { id: 'arrow', viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 7, markerHeight: 7, orient: 'auto-start-reverse' }, h('path', { d: 'M0 0 L10 5 L0 10 z' }))), paths),
      ...cards.map((c) => h('article', { key: c.id, className: `card tone-${c.tone}`, style: { left: c.x, top: c.y, width: CARD_W } },
        h('header', null, h('strong', null, c.title), h('button', { type: 'button', 'aria-label': `Remove ${c.title}` }, '×')),
        c.body && h('p', null, c.body), h('small', { className: 'mono' }, c.id))))));
}
