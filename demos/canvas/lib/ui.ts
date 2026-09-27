// A UI vocabulary: the screen is a tree of nodes. Containers hold children in
// order; layout is INTENT (direction, alignment, gap, columns, grow), never
// coordinates. Each platform's own layout system does the placing: flexbox and
// grid on the web, stacks and grids in SwiftUI, Yoga in Ink. An empty layout
// field means "the platform's default".
import { createStore, createWire, defineAction, Rejected, type ActionDef } from 'rixse';

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
