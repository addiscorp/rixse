// Components (APS 4): everything the agent places is a component, sized
//
//   viewport → large → medium → small
//
// small/medium/large are fixed shapes that mean the same on every platform;
// viewport fills its container and owns the layout of what it holds. The agent
// picks a kind, its params, a size and a relative place; it never sees columns
// or pixels. Components read rows from a data source adapter, so rows never
// pass through the model, and rixse never knows which database is behind it.

import { Rejected, defineAction } from './index.js';

/** @typedef {'small' | 'medium' | 'large' | 'viewport'} Size */
/** @typedef {import('./index.js').Param} Param */
/**
 * @typedef {{
 *   describe: string,
 *   sizes: Size[],
 *   size?: Size,
 *   params?: Record<string, Param & { default?: any }>,
 *   source?: string,
 *   identity?: string[],
 *   check?: (rows: any[], item: Item) => string | null,
 *   select?: string,
 * }} ComponentDef
 * @typedef {ComponentDef & { kind: string, size: Size, params: Record<string, Param & { default?: any }> }} Component
 * @typedef {{ describe: string | (() => string), query?: string, run: (query: string) => any[], hint?: (error: string) => string }} SourceDef
 * @typedef {{ id: string, kind: string, title: string, size: Size, query: string, [param: string]: any }} Item
 * @typedef {{ view: string, items: string[] }} Selection
 * @typedef {{ items: Record<string, Item>, order: string[], selection: Selection | null }} ViewportState
 */

/** Largest first: the order the ladder is written in. */
export const SIZES = /** @type {const} */ (['viewport', 'large', 'medium', 'small']);
export const PLACES = /** @type {const} */ (['end', 'before', 'after', 'replace']);

/** @param {string} kind @param {ComponentDef} def @returns {Component} */
export function defineComponent(kind, def) {
  if (!def.sizes?.length) throw new Error(`component "${kind}" needs at least one size`);
  for (const s of def.sizes) if (!SIZES.includes(s)) throw new Error(`component "${kind}": unknown size "${s}"`);
  const size = def.size ?? def.sizes[0];
  if (!def.sizes.includes(size)) throw new Error(`component "${kind}": default size "${size}" is not one of its sizes`);
  return { ...def, kind, size, params: def.params ?? {} };
}

/** @param {SourceDef} def @returns {SourceDef} */
export const defineSource = (def) => def;

/**
 * Where an item goes in the order. The agent decides (end, before/after an
 * item, or replace one); rixse checks the target. Returns the new order and
 * the id a replace removes.
 * @param {string[]} order @param {string} id @param {(typeof PLACES)[number]} [at] @param {string} [target]
 */
export function place(order, id, at = 'end', target) {
  const rest = order.filter((x) => x !== id);
  if (at === 'end') return { order: [...rest, id] };
  if (!target) throw new Rejected(`at "${at}" needs a target`);
  if (target === id) throw new Rejected('a component cannot be placed relative to itself');
  const i = rest.indexOf(target);
  if (i < 0) throw new Rejected(`no component "${target}" to place ${at === 'replace' ? 'over' : at}`);
  if (at === 'replace') return { order: [...rest.slice(0, i), id, ...rest.slice(i + 1)], removed: target };
  const j = at === 'before' ? i : i + 1;
  return { order: [...rest.slice(0, j), id, ...rest.slice(j)] };
}

/**
 * Grid cells per size. Columns come from the viewport's container width, never
 * the window; a size wider than the grid takes the whole row.
 */
const SPAN = { small: [1, 1], medium: [2, 1], large: [2, 2] };

/**
 * Lay out a viewport's items for a container width. Pure: the same state and
 * width always give the same cells, on every platform.
 * @param {ViewportState} state @param {number} width
 * @param {{ min: number, cols: number }[]} [bands] container widths → column count
 * @returns {{ cols: number, cells: { id: string, cols: number, rows: number }[] }}
 */
export function layout(state, width, bands = [{ min: 0, cols: 2 }, { min: 720, cols: 4 }, { min: 1280, cols: 6 }]) {
  const cols = [...bands].sort((a, b) => a.min - b.min).filter((b) => width >= b.min).at(-1)?.cols ?? 1;
  const cells = state.order.map((id) => {
    const size = state.items[id].size;
    if (size === 'viewport') return { id, cols, rows: 0 };
    const [c, r] = SPAN[size];
    return { id, cols: Math.min(c, cols), rows: r };
  });
  return { cols, cells };
}

/**
 * A viewport component's state, actions and agent text, from a catalogue of
 * components and the data sources they read.
 * @param {{ components: Component[], sources: Record<string, SourceDef> }} options
 */
export function createViewport({ components, sources }) {
  const byKind = new Map(components.map((c) => [c.kind, c]));
  for (const c of components) if (c.source && !sources[c.source]) throw new Error(`component "${c.kind}" reads unknown source "${c.source}"`);
  const kinds = components.map((c) => c.kind);
  /** Every component's params, merged: the one door takes any of them, and each kind checks its own. */
  /** @type {Record<string, Param & { default?: any }>} */
  const allParams = {};
  for (const c of components) for (const [n, p] of Object.entries(c.params)) allParams[n] ??= { ...p, optional: true, describe: undefined };

  /** @returns {ViewportState} */
  const initial = () => ({ items: {}, order: [], selection: null });

  /** @param {string} kind @param {string} size */
  const sizeError = (kind, size) => {
    const c = /** @type {Component} */ (byKind.get(kind));
    return c.sizes.includes(/** @type {Size} */ (size)) ? null : `${kind} comes in ${c.sizes.join(', ')}, not ${size}`;
  };

  /** Run an item's query through its source; a failure comes back as the fix, where the source knows it. */
  function rowsFor(/** @type {Item} */ item) {
    const c = /** @type {Component} */ (byKind.get(item.kind));
    if (!c.source) return [];
    const src = sources[c.source];
    try {
      return src.run(item.query);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Rejected(src.hint ? src.hint(msg) : msg);
    }
  }

  // Models lean on the action's own words: name the query language and its shape right here.
  const queryText = Object.entries(sources).map(([n, src]) => (src.query ? `${n}: ${src.query}` : '')).filter(Boolean).join('; ') || 'one query in the source’s language';

  const PLACE_PARAMS = {
    at: { type: 'enum', values: [...PLACES], optional: true, describe: '"end" (default), "before"/"after" the target, or "replace" the target (it is removed; its spot is taken)' },
    target: { type: 'string', ref: 'view', optional: true, describe: 'the component id (or handle) "at" refers to' },
  };

  const actions = [
    defineAction('view.show', {
      describe: 'Show a component, or change the one with this id. The page runs its query and draws the rows; you never see or write the data.',
      params: {
        id: { type: 'string', ref: 'view', describe: 'a short slug; reuse an existing id (or its handle) to change it instead of adding one' },
        kind: { type: 'enum', values: kinds, describe: 'see the components list' },
        title: { type: 'string' },
        query: { type: 'string', optional: true, describe: queryText },
        size: { type: 'enum', values: [...SIZES], optional: true, describe: 'one of the sizes the kind comes in; default is its usual size' },
        ...allParams,
        ...PLACE_PARAMS,
      },
      apply: (/** @type {ViewportState} */ s, /** @type {any} */ p) => {
        const c = /** @type {Component} */ (byKind.get(p.kind));
        for (const key of Object.keys(p)) {
          if (key in allParams && !(key in c.params)) throw new Rejected(`${c.kind} has no "${key}"; its params are ${Object.keys(c.params).join(', ') || 'none'}`);
        }
        for (const [n, def] of Object.entries(c.params)) if (!def.optional && p[n] === undefined && def.default === undefined) throw new Rejected(`${c.kind} needs "${n}"`);
        if (c.source && !p.query) throw new Rejected(`${c.kind} needs a query`);
        const prev = s.items[p.id];
        const size = p.size ?? (prev?.kind === c.kind ? prev.size : c.size);
        const bad = sizeError(c.kind, size);
        if (bad) throw new Rejected(bad);
        /** @type {Item} */
        const item = { id: p.id, kind: c.kind, title: p.title, size, query: p.query ?? '' };
        for (const [n, def] of Object.entries(c.params)) item[n] = p[n] ?? def.default;
        // Ensure (APS 2): one component per identity. Showing it again is a
        // pointer to the one on screen, never a duplicate.
        if (c.identity) {
          const same = Object.values(s.items).find((o) => o.id !== p.id && o.kind === c.kind && c.identity?.every((k) => o[k] === item[k]));
          if (same) throw new Rejected(`already showing as "${same.id}"; reuse id "${same.id}" to change it`);
        }
        const rows = rowsFor(item);
        if (c.source && !rows.length) throw new Rejected('the query ran but returned no rows; loosen the filter or check the names');
        const why = c.check?.(rows, item);
        if (why) throw new Rejected(why);
        const placed = p.at ? place(s.order, p.id, p.at, p.target) : { order: s.order.includes(p.id) ? s.order : [...s.order, p.id] };
        const items = { ...s.items, [p.id]: item };
        if ('removed' in placed && placed.removed) delete items[placed.removed];
        // A changed or removed component drops its selection: the items may no longer be on screen.
        const selection = s.selection && items[s.selection.view] && s.selection.view !== p.id ? s.selection : null;
        return { items, order: placed.order, selection };
      },
    }),
    defineAction('view.move', {
      describe: 'Move a component to the end, or before/after another.',
      params: { id: { type: 'string', ref: 'view' }, at: { type: 'enum', values: ['end', 'before', 'after'] }, target: { type: 'string', ref: 'view', optional: true } },
      apply: (/** @type {ViewportState} */ s, /** @type {any} */ p) => {
        if (!s.items[p.id]) throw new Rejected(`no component "${p.id}"`);
        return { ...s, order: place(s.order, p.id, p.at, p.target).order };
      },
    }),
    defineAction('view.resize', {
      describe: 'Change a component’s size (only to a size its kind comes in).',
      params: { id: { type: 'string', ref: 'view' }, size: { type: 'enum', values: [...SIZES] } },
      apply: (/** @type {ViewportState} */ s, /** @type {any} */ p) => {
        const it = s.items[p.id];
        if (!it) throw new Rejected(`no component "${p.id}"`);
        const bad = sizeError(it.kind, p.size);
        if (bad) throw new Rejected(bad);
        return { ...s, items: { ...s.items, [p.id]: { ...it, size: p.size } } };
      },
    }),
    defineAction('view.remove', {
      describe: 'Remove a component.',
      params: { id: { type: 'string', ref: 'view' } },
      apply: (/** @type {ViewportState} */ s, /** @type {any} */ p) => {
        if (!s.items[p.id]) throw new Rejected(`no component "${p.id}"`);
        const { [p.id]: _gone, ...items } = s.items;
        return { items, order: s.order.filter((x) => x !== p.id), selection: s.selection?.view === p.id ? null : s.selection };
      },
    }),
    defineAction('view.clear', { describe: 'Remove every component.', params: {}, apply: initial }),
    defineAction('select.set', {
      describe: 'Select things in one component (the user does this by clicking; you may too, to point at an answer). Replaces the selection.',
      params: { view: { type: 'string', ref: 'view' }, items: { type: 'string', describe: '"|"-separated; what each kind selects is in the components list' } },
      apply: (/** @type {ViewportState} */ s, /** @type {any} */ p) => {
        if (!s.items[p.view]) throw new Rejected(`no component "${p.view}"`);
        const items = [...new Set(String(p.items).split('|').map((x) => x.trim()).filter(Boolean))];
        if (!items.length) throw new Rejected('select at least one item, or use select.clear');
        return { ...s, selection: { view: p.view, items } };
      },
    }),
    defineAction('select.clear', { describe: 'Clear the selection.', params: {}, apply: (/** @type {ViewportState} */ s) => ({ ...s, selection: null }) }),
  ];

  /** The component catalogue, written for a model. Generated: adding a component adds its words. */
  function catalogue() {
    const lines = components.map((c) => {
      const params = Object.entries(c.params).map(([n, p]) => {
        const t = p.type === 'enum' ? p.values?.map((v) => JSON.stringify(v)).join('|') : p.type;
        return `${n}${p.optional || p.default !== undefined ? '?' : ''}: ${t}${p.default !== undefined && p.default !== '' ? ` = ${JSON.stringify(p.default)}` : ''}${p.describe ? ` (${p.describe})` : ''}`;
      });
      const sizes = c.sizes.map((s) => (s === c.size ? `${s}*` : s)).join('|');
      return `- ${c.kind} [${sizes}]${c.source ? ` reads ${c.source}` : ''}: ${c.describe}${params.length ? `\n    params: ${params.join('; ')}` : ''}${c.select ? `\n    select: ${c.select}` : ''}`;
    });
    const srcs = Object.entries(sources).map(([n, s]) => `## Source "${n}"\n${typeof s.describe === 'function' ? s.describe() : s.describe}`);
    return [
      'Components (sizes: viewport = the whole width, large = a big tile, medium = a wide tile, small = a small tile; * marks the usual size). The page lays them out; you choose kind, params, size and where it goes relative to the others.',
      ...lines,
      ...srcs,
    ].join('\n');
  }

  return { initial, actions, catalogue, rowsFor, components: byKind };
}
