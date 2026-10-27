// A UI vocabulary: the screen is a tree of nodes. Containers hold children in
// order; layout is INTENT (direction, alignment, gap, columns, grow), never
// coordinates. Each platform's own layout system does the placing: flexbox and
// grid on the web, stacks and grids in SwiftUI, Yoga in Ink. An empty layout
// field means "the platform's default".
import { createStore, createWire, defineAction, Rejected, type ActionDef } from 'rixse/ui';

export const CONTAINERS = ['stack', 'grid', 'card'] as const;
// Leaves are shadcn/ui components (plus a few compositions of them); icons are lucide names.
export const LEAVES = ['spacer', 'heading', 'text', 'button', 'badge', 'input', 'switch', 'avatar', 'separator', 'progress', 'alert', 'table', 'skeleton', 'icon', 'image', 'metric', 'list', 'chart'] as const;
export const KINDS = [...CONTAINERS, ...LEAVES];
export type Kind = 'screen' | (typeof KINDS)[number];

export type UiNode = {
  id: string; kind: Kind; parent: string | null; children: string[];
  text: string; variant: string;
  dir: '' | 'row' | 'column'; align: '' | 'start' | 'center' | 'end' | 'stretch'; justify: '' | 'start' | 'center' | 'end' | 'between';
  gap: '' | 'none' | 'sm' | 'md' | 'lg'; cols: number; grow: boolean;
};
export type UiState = { nodes: Record<string, UiNode> };
export const ROOT = 'screen';

const blank = (id: string, kind: Kind, parent: string | null): UiNode => ({ id, kind, parent, children: [], text: '', variant: '', dir: '', align: '', justify: '', gap: '', cols: 0, grow: false });
export const initialUi = (): UiState => ({ nodes: { [ROOT]: blank(ROOT, 'screen', null) } });

const isContainer = (n: UiNode) => n.kind === 'screen' || (CONTAINERS as readonly string[]).includes(n.kind);
const need = (s: UiState, id: string) => { const n = s.nodes[id]; if (!n) throw new Rejected(`no node "${id}"`); return n; };
const needContainer = (s: UiState, id: string) => { const n = need(s, id); if (!isContainer(n)) throw new Rejected(`"${id}" is a ${n.kind}; only stack, grid, card or screen can hold children`); return n; };
const insert = (list: string[], id: string, index?: number) => { const l = list.filter((x) => x !== id); l.splice(index === undefined ? l.length : Math.max(0, Math.min(l.length, index)), 0, id); return l; };
const descendants = (s: UiState, id: string): string[] => [id, ...s.nodes[id]!.children.flatMap((c) => descendants(s, c))];


// ── Blocks: one action places a whole section ─────────────────────────────
// The agent decides at the level of sections; rixse expands a block locally
// into ordinary nodes with predictable ids (e.g. "hero.price"), which the agent
// can still update, move or remove one by one afterwards.
export const BLOCKS = ['header', 'hero', 'cards', 'stats', 'section', 'form'] as const;
type BlockProps = { id: string; parent: string; block: (typeof BLOCKS)[number]; title?: string; text?: string; price?: string; badge?: string; image?: string; items?: string; actions?: string; cta?: string; secondary?: string; cols?: number; index?: number };
type Spec = { kind: Kind; id: string; text?: string; variant?: string; dir?: UiNode['dir']; align?: UiNode['align']; justify?: UiNode['justify']; gap?: UiNode['gap']; cols?: number; grow?: boolean; children?: Spec[] };

const rows = (items: string | undefined) => (items ?? '').split(';').map((r) => r.split('|').map((x) => x.trim())).filter((r) => r.some(Boolean));
const list = (items: string | undefined) => (items ?? '').split('|').map((x) => x.trim()).filter(Boolean);

function blockSpec(p: BlockProps): Spec {
  const id = p.id;
  switch (p.block) {
    case 'header': {
      // Brand, spacer, then each action: "icon:shopping-cart|avatar:Ana Ruiz|text:Ana|button:Sign in"
      const actions = list(p.actions).map((a, i): Spec => {
        const [k, ...rest] = a.split(':'); const v = rest.join(':').trim();
        const kind = (['icon', 'avatar', 'text', 'button', 'badge'].includes(k!.trim()) ? k!.trim() : 'text') as Kind;
        return { kind, id: `${id}.${kind}${i + 1}`, text: v || k!.trim(), variant: kind === 'button' ? 'outline' : undefined };
      });
      return { kind: 'stack', id, dir: 'row', align: 'center', gap: 'md', children: [
        { kind: 'heading', id: `${id}.title`, text: p.title ?? 'Brand', variant: 'h3' },
        { kind: 'spacer', id: `${id}.spacer` },
        ...actions,
      ] };
    }
    case 'hero': return { kind: 'grid', id, cols: 2, gap: 'lg', children: [
      { kind: 'image', id: `${id}.image`, text: p.image ?? p.title ?? 'image' },
      { kind: 'stack', id: `${id}.info`, gap: 'md', children: [
        ...(p.badge ? [{ kind: 'badge' as Kind, id: `${id}.badge`, text: p.badge }] : []),
        { kind: 'heading', id: `${id}.title`, text: p.title ?? 'Title', variant: 'h1' },
        ...(p.price ? [{ kind: 'heading' as Kind, id: `${id}.price`, text: p.price, variant: 'h2' }] : []),
        ...(p.text ? [{ kind: 'text' as Kind, id: `${id}.text`, text: p.text }] : []),
        ...(p.items ? [{ kind: 'list' as Kind, id: `${id}.list`, text: list(p.items).join('|') }] : []),
        { kind: 'stack', id: `${id}.actions`, dir: 'row', gap: 'sm', children: [
          { kind: 'button', id: `${id}.cta`, text: p.cta ?? 'Get started' },
          ...(p.secondary ? [{ kind: 'button' as Kind, id: `${id}.secondary`, text: p.secondary, variant: 'outline' }] : []),
        ] },
      ] },
    ] };
    case 'cards': return { kind: 'stack', id, gap: 'md', children: [
      ...(p.title ? [{ kind: 'heading' as Kind, id: `${id}.title`, text: p.title, variant: 'h2' }] : []),
      // items: "Name|$45|alt text;Name|$60|alt text"
      { kind: 'grid', id: `${id}.grid`, cols: p.cols ?? 3, gap: 'md', children: rows(p.items).map(([name, price, alt], i): Spec => ({
        kind: 'card', id: `${id}.${i + 1}`, text: name, gap: 'sm', children: [
          { kind: 'image', id: `${id}.${i + 1}.image`, text: alt || name },
          ...(price ? [{ kind: 'text' as Kind, id: `${id}.${i + 1}.price`, text: price }] : []),
          ...(p.cta ? [{ kind: 'button' as Kind, id: `${id}.${i + 1}.cta`, text: p.cta, variant: 'outline' }] : []),
        ],
      })) },
    ] };
    case 'stats': return { kind: 'grid', id, cols: p.cols ?? Math.max(1, Math.min(4, rows(p.items).length)), gap: 'md', children: rows(p.items).map(([label, value, delta], i): Spec => ({
      kind: 'card', id: `${id}.${i + 1}`, children: [{ kind: 'metric', id: `${id}.${i + 1}.metric`, text: [label, value, delta].filter((x) => x !== undefined).join('|'), variant: delta?.startsWith('-') ? 'down' : 'up' }],
    })) };
    case 'section': return { kind: 'stack', id, gap: 'sm', children: [
      { kind: 'heading', id: `${id}.title`, text: p.title ?? 'Section', variant: 'h2' },
      ...(p.text ? [{ kind: 'text' as Kind, id: `${id}.text`, text: p.text }] : []),
      ...(p.items ? [{ kind: 'list' as Kind, id: `${id}.list`, text: list(p.items).join('|') }] : []),
    ] };
    case 'form': return { kind: 'card', id, text: p.title ?? 'Form', gap: 'md', children: [
      ...(p.text ? [{ kind: 'text' as Kind, id: `${id}.text`, text: p.text }] : []),
      ...list(p.items).map((f, i): Spec => ({ kind: 'input', id: `${id}.field${i + 1}`, text: f })),
      { kind: 'button', id: `${id}.submit`, text: p.cta ?? 'Submit' },
    ] };
  }
}

function flatten(spec: Spec, parent: string): UiNode[] {
  const { children = [], ...rest } = spec;
  const node: UiNode = { ...blank(spec.id, spec.kind, parent), ...Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined)) as Partial<UiNode>, children: children.map((c) => c.id) };
  return [node, ...children.flatMap((c) => flatten(c, spec.id))];
}

const act = <P,>(type: string, def: Omit<ActionDef<UiState, P>, 'type'>) => defineAction<UiState, P>(type, def);
const LAYOUT = {
  dir: { type: 'enum', values: ['row', 'column'], optional: true, describe: 'default column' },
  align: { type: 'enum', values: ['start', 'center', 'end', 'stretch'], optional: true, describe: 'cross-axis' },
  justify: { type: 'enum', values: ['start', 'center', 'end', 'between'], optional: true, describe: 'main-axis; "between" pushes the last child to the far end' },
  gap: { type: 'enum', values: ['none', 'sm', 'md', 'lg'], optional: true },
  cols: { type: 'number', optional: true, describe: 'grid columns' },
  grow: { type: 'boolean', optional: true, describe: 'take the remaining space in its parent' },
} as const;

export const uiActions = [
  act('ui.block', {
    describe: 'Place a whole section in ONE action; rixse expands it into nodes with ids like "<id>.title", "<id>.price", "<id>.cta", "<id>.1" that you can update later. Prefer this over many ui.add lines.',
    params: {
      id: { type: 'string', describe: 'a new short slug for the section' },
      parent: { type: 'string', ref: 'node' },
      block: { type: 'enum', values: BLOCKS, describe: 'header: title + actions pushed right; hero: image beside badge/title/price/text/items/cta/secondary; cards: title + grid of items; stats: items as metrics; section: title + text/items; form: title + items as fields + cta' },
      title: { type: 'string', optional: true },
      text: { type: 'string', optional: true },
      price: { type: 'string', optional: true },
      badge: { type: 'string', optional: true },
      image: { type: 'string', optional: true, describe: 'alt text' },
      items: { type: 'string', optional: true, describe: 'cards: "Name|$45|alt;Name|$60|alt"; stats: "Label|Value|+8%;…"; hero/section list and form fields: "a|b|c"' },
      actions: { type: 'string', optional: true, describe: 'header only: "icon:shopping-cart|avatar:Ana Ruiz|text:Ana|button:Sign in" (left to right, all at the far end)' },
      cta: { type: 'string', optional: true },
      secondary: { type: 'string', optional: true },
      cols: { type: 'number', optional: true },
      index: { type: 'number', optional: true },
    },
    apply: (s: UiState, p: BlockProps) => {
      const parent = needContainer(s, p.parent);
      const made = flatten(blockSpec(p), p.parent);
      const taken = made.find((n) => s.nodes[n.id]);
      if (taken) throw new Rejected(`node "${taken.id}" already exists — pick another block id`);
      const nodes = { ...s.nodes };
      for (const n of made) nodes[n.id] = n;
      nodes[parent.id] = { ...parent, children: insert(parent.children, p.id, p.index) };
      return { nodes };
    },
  }),
  act('ui.add', {
    describe: 'Add a node as the last child of a container (or at index). Parents must be added before their children.',
    params: {
      id: { type: 'string', describe: 'a new short descriptive slug' },
      parent: { type: 'string', ref: 'node', describe: `a stack, grid, card, or "${ROOT}"` },
      kind: { type: 'enum', values: KINDS },
      text: { type: 'string', optional: true, describe: 'spacer: none (it takes the free space in its row or column, pushing what follows to the far end); heading/text/button/badge label; card: its title; input: placeholder; switch: its label; avatar: a person\'s name; progress: 0–100; alert: "title|description"; table: "col,col;cell,cell;cell,cell" (first row is the header); icon: a lucide icon name (shopping-cart, search, user, bell, menu, heart, star, settings, house, mail, plus, chevron-right…); image: alt text; metric: "label|value|delta"; list: "item|item|item"; chart: "3,5,4,8,6"' },
      variant: { type: 'string', optional: true, describe: 'heading: h1|h2|h3; button: default|secondary|outline|ghost|destructive; badge: default|secondary|outline|destructive; alert: default|destructive; metric delta: up|down' },
      index: { type: 'number', optional: true },
      ...LAYOUT,
    },
    apply: (s: UiState, p: Partial<UiNode> & { id: string; parent: string; kind: Kind; index?: number }) => {
      if (s.nodes[p.id]) throw new Rejected(`node "${p.id}" already exists`);
      const parent = needContainer(s, p.parent);
      const { index, ...rest } = p;
      const node: UiNode = { ...blank(p.id, p.kind, p.parent), ...Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined)) as Partial<UiNode> };
      return { nodes: { ...s.nodes, [p.id]: node, [parent.id]: { ...parent, children: insert(parent.children, p.id, index) } } };
    },
  }),
  act('ui.update', {
    describe: "Change a node's text or variant.",
    params: { id: { type: 'string', ref: 'node' }, text: { type: 'string', optional: true }, variant: { type: 'string', optional: true } },
    apply: (s: UiState, p: { id: string; text?: string; variant?: string }) => {
      const n = need(s, p.id);
      return { nodes: { ...s.nodes, [p.id]: { ...n, ...(p.text !== undefined ? { text: p.text } : {}), ...(p.variant !== undefined ? { variant: p.variant } : {}) } } };
    },
  }),
  act('ui.layout', {
    describe: "Change a node's layout intent. Omitted fields keep their value.",
    params: { id: { type: 'string', ref: 'node' }, ...LAYOUT },
    apply: (s: UiState, p: Partial<UiNode> & { id: string }) => {
      const n = need(s, p.id);
      return { nodes: { ...s.nodes, [p.id]: { ...n, ...Object.fromEntries(Object.entries(p).filter(([k, v]) => k !== 'id' && v !== undefined)) as Partial<UiNode> } } };
    },
  }),
  act('ui.move', {
    describe: 'Move a node (and its children) into a container, at index or last.',
    params: { id: { type: 'string', ref: 'node' }, parent: { type: 'string', ref: 'node' }, index: { type: 'number', optional: true } },
    apply: (s: UiState, p: { id: string; parent: string; index?: number }) => {
      const n = need(s, p.id);
      if (p.id === ROOT) throw new Rejected('the screen cannot move');
      const to = needContainer(s, p.parent);
      if (descendants(s, p.id).includes(p.parent)) throw new Rejected(`cannot move "${p.id}" into itself`);
      const nodes = { ...s.nodes };
      const from = nodes[n.parent!]!;
      nodes[from.id] = { ...from, children: from.children.filter((c) => c !== p.id) };
      const target = nodes[to.id]!;
      nodes[to.id] = { ...target, children: insert(target.children, p.id, p.index) };
      nodes[p.id] = { ...n, parent: to.id };
      return { nodes };
    },
  }),
  act('ui.remove', {
    describe: 'Remove a node and everything inside it.',
    params: { id: { type: 'string', ref: 'node' } },
    apply: (s: UiState, p: { id: string }) => {
      const n = need(s, p.id);
      if (p.id === ROOT) throw new Rejected('the screen cannot be removed; use ui.clear');
      const gone = new Set(descendants(s, p.id));
      const nodes = Object.fromEntries(Object.entries(s.nodes).filter(([k]) => !gone.has(k)));
      const parent = nodes[n.parent!]!;
      nodes[parent.id] = { ...parent, children: parent.children.filter((c) => c !== p.id) };
      return { nodes };
    },
  }),
  act('ui.clear', { describe: 'Empty the screen.', params: {}, apply: () => initialUi() }),
];

export const UI_BRIEF = `You build and edit an app screen for the user. The screen is a tree of nodes under the root "${ROOT}". Containers (stack, grid, card) hold children in order; everything else is a leaf.
Layout is intent only — dir, align, justify, gap, cols, grow — and the platform lays it out. There are no coordinates. Unset layout means the platform default (a column, top to bottom).
Placement is structure, and a spacer is how you push things apart (like SwiftUI's Spacer): a spacer takes all the free space in its row or column.
- "Top right" = a header row: [title, spacer, …the things on the right]. Everything after the spacer sits together at the far end, in order.
- "Next to X" = in the same row as X, right before or after it. To move a group, move its container, not each child.
- Never rely on justify "between" with three or more children: it puts the middle ones in the middle.
- A sidebar = a row whose first child is a narrow stack and whose second child grows.
Components are shadcn/ui: make it look like real software — headings, short real-looking copy, buttons, badges, inputs, cards, tables, metrics, charts, lucide icons. Add parents before children, in visual order.`;

/** Document order: parents before children, children in order (so a model reads the tree top-down). */
function inOrder(s: UiState): UiNode[] {
  const out: UiNode[] = [];
  const walk = (id: string) => { const n = s.nodes[id]; if (!n) return; out.push(n); n.children.forEach(walk); };
  walk(ROOT);
  return out;
}

export function createUiWire() {
  return createWire<UiState>({
    entities: [{
      type: 'node', list: inOrder, id: (n) => n.id,
      fields: [
        { name: 'kind' }, { name: 'parent', default: '', get: (n) => n.parent ?? '', ref: 'node' },
        { name: 'text', default: '' }, { name: 'variant', default: '' },
        { name: 'dir', default: '' }, { name: 'align', default: '' }, { name: 'justify', default: '' }, { name: 'gap', default: '' },
        { name: 'cols', default: 0 }, { name: 'grow', default: false },
      ],
    }],
  });
}

export function createUiStore() {
  return createStore<UiState>({ initial: initialUi(), actions: uiActions });
}
export type UiStore = ReturnType<typeof createUiStore>;
