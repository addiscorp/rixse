// The canvas's vocabulary: the only things the human or the agent can do to it.
import { createStore, createWire, defineAction, Rejected, type ActionDef } from 'rixse';

export type Tone = 'plain' | 'accent' | 'good' | 'warn';
export type Card = { id: string; title: string; body: string; x: number; y: number; tone: Tone };
export type Link = { from: string; to: string; label: string };
export type CanvasState = { cards: Record<string, Card>; links: Link[] };

export const WIDTH = 1200;
export const HEIGHT = 800;
const TONES: Tone[] = ['plain', 'accent', 'good', 'warn'];

const clampX = (x: number) => Math.max(0, Math.min(WIDTH - 220, Math.round(x)));
const clampY = (y: number) => Math.max(0, Math.min(HEIGHT - 120, Math.round(y)));
const need = (s: CanvasState, id: string) => {
  if (!s.cards[id]) throw new Rejected(`no card "${id}"`);
  return s.cards[id]!;
};
/** The next free slot on a loose grid, for cards added without a position. */
function freeSlot(s: CanvasState) {
  const n = Object.keys(s.cards).length;
  return { x: 40 + (n % 4) * 270, y: 40 + Math.floor(n / 4) * 170 };
}

/** Every action reads and returns the whole canvas state. */
const act = <P,>(type: string, def: Omit<ActionDef<CanvasState, P>, 'type'>) => defineAction<CanvasState, P>(type, def);

export const actions = [
  act('card.add', {
    describe: 'Add a card. Omit x/y to place it automatically.',
    params: {
      id: { type: 'string', describe: 'a new short unique slug naming this card' },
      title: { type: 'string' },
      body: { type: 'string', optional: true },
      x: { type: 'number', optional: true, describe: `0–${WIDTH}` },
      y: { type: 'number', optional: true, describe: `0–${HEIGHT}` },
      tone: { type: 'enum', values: TONES, optional: true },
    },
    apply: (s: CanvasState, p: Partial<Card> & { id: string; title: string }) => {
      if (s.cards[p.id]) throw new Rejected(`card "${p.id}" already exists`);
      const slot = freeSlot(s);
      const card: Card = { id: p.id, title: p.title, body: p.body ?? '', x: clampX(p.x ?? slot.x), y: clampY(p.y ?? slot.y), tone: p.tone ?? 'plain' };
      return { ...s, cards: { ...s.cards, [p.id]: card } };
    },
  }),
  act('card.update', {
    describe: "Change a card's title, body or tone.",
    params: { id: { type: 'string', ref: 'card' }, title: { type: 'string', optional: true }, body: { type: 'string', optional: true }, tone: { type: 'enum', values: TONES, optional: true } },
    apply: (s: CanvasState, p: Partial<Card> & { id: string }) => {
      const card = need(s, p.id);
      const next: Card = { ...card, ...(Object.fromEntries(Object.entries(p).filter(([, v]) => v !== undefined)) as Partial<Card>) };
      return { ...s, cards: { ...s.cards, [p.id]: next } };
    },
  }),
  act('card.move', {
    describe: 'Move a card.',
    params: { id: { type: 'string', ref: 'card' }, x: { type: 'number' }, y: { type: 'number' } },
    apply: (s: CanvasState, p: { id: string; x: number; y: number }) => {
      const card = need(s, p.id);
      return { ...s, cards: { ...s.cards, [p.id]: { ...card, x: clampX(p.x), y: clampY(p.y) } } };
    },
  }),
  act('card.remove', {
    describe: 'Remove a card and its links.',
    params: { id: { type: 'string', ref: 'card' } },
    apply: (s: CanvasState, p: { id: string }) => {
      need(s, p.id);
      const { [p.id]: _gone, ...cards } = s.cards;
      return { cards, links: s.links.filter((l) => l.from !== p.id && l.to !== p.id) };
    },
  }),
  act('link.add', {
    describe: 'Draw an arrow from one card to another.',
    params: { from: { type: 'string', ref: 'card' }, to: { type: 'string', ref: 'card' }, label: { type: 'string', optional: true } },
    apply: (s: CanvasState, p: { from: string; to: string; label?: string }) => {
      need(s, p.from); need(s, p.to);
      if (p.from === p.to) throw new Rejected('a card cannot link to itself');
      if (s.links.some((l) => l.from === p.from && l.to === p.to)) throw new Rejected(`link ${p.from} → ${p.to} exists`);
      return { ...s, links: [...s.links, { from: p.from, to: p.to, label: p.label ?? '' }] };
    },
  }),
  act('link.remove', {
    describe: 'Remove an arrow.',
    params: { from: { type: 'string', ref: 'card' }, to: { type: 'string', ref: 'card' } },
    apply: (s: CanvasState, p: { from: string; to: string }) => {
      if (!s.links.some((l) => l.from === p.from && l.to === p.to)) throw new Rejected(`no link ${p.from} → ${p.to}`);
      return { ...s, links: s.links.filter((l) => !(l.from === p.from && l.to === p.to)) };
    },
  }),
  act('canvas.clear', {
    describe: 'Remove everything.',
    params: {},
    apply: () => ({ cards: {}, links: [] }),
  }),
];

/** How the canvas reads to a model in rixse wire (APS 2): one schema line per type, one row per item. */
export function createCanvasWire() {
  return createWire<CanvasState>({
    entities: [
      { type: 'card', list: (s) => Object.values(s.cards), id: (c) => c.id, fields: [
        { name: 'title' }, { name: 'at', get: (c) => [c.x, c.y] }, { name: 'tone', default: 'plain' }, { name: 'body', default: '' },
      ] },
      { type: 'link', list: (s) => s.links, fields: [{ name: 'from', ref: 'card' }, { name: 'to', ref: 'card' }, { name: 'label', default: '' }] },
    ],
  });
}

export const CANVAS_BRIEF = `You operate a canvas of cards and arrows on behalf of the user. The canvas is ${WIDTH}×${HEIGHT}.`;

export function createCanvasStore() {
  return createStore<CanvasState>({ initial: { cards: {}, links: [] }, actions });
}
export type CanvasStore = ReturnType<typeof createCanvasStore>;
