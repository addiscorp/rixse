// rixse core: one state, two authors.
//
//   ui     = view(state)
//   state' = apply(state, action)   — the human and the agent both write here
//
// The agent never touches state directly: it proposes actions from the same
// typed vocabulary the UI uses. Every applied action is logged with its author,
// so the log is the record of what the agent touched, and undo works for both.

/**
 * @typedef {{ type: 'string' | 'number' | 'boolean' | 'enum', values?: string[], optional?: boolean, describe?: string, ref?: string }} Param
 * @typedef {{ type: string, describe: string, params: Record<string, Param>, apply: (state: any, payload: any) => any }} ActionDef
 * @typedef {'you' | 'agent'} Author
 * @typedef {{ seq: number, at: number, author: Author, type: string, payload: any, why?: string, undone?: boolean }} Entry
 * @typedef {{ kind: 'applied' | 'rejected' | 'undone', entry?: Entry, action?: any, author?: Author, error?: string }} Event
 */

export { createWire } from './wire.js';
export { SIZES, PLACES, defineComponent, defineSource, place, layout, createViewport } from './components.js';

/** A rejection with a reason the log (and the agent) can read. Throw it from `apply`. */
export class Rejected extends Error {}

/** @param {string} type @param {Omit<ActionDef, 'type'>} def @returns {ActionDef} */
export function defineAction(type, def) {
  return { type, ...def };
}

/** @param {Record<string, Param>} params @param {any} payload @returns {string | null} */
export function validate(params, payload) {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) return 'payload must be an object';
  for (const key of Object.keys(payload)) {
    if (!(key in params)) return `unknown field "${key}"`;
  }
  for (const [name, p] of Object.entries(params)) {
    const v = payload[name];
    if (v === undefined || v === null) {
      if (p.optional) continue;
      return `missing "${name}"`;
    }
    if (p.type === 'enum') {
      if (!p.values?.includes(v)) return `"${name}" must be one of ${p.values?.join(', ')}`;
    } else if (p.type === 'number') {
      if (typeof v !== 'number' || !Number.isFinite(v)) return `"${name}" must be a number`;
    } else if (typeof v !== p.type) {
      return `"${name}" must be a ${p.type}`;
    }
  }
  return null;
}

/**
 * @template S
 * @param {{ initial: S, actions: ActionDef[] }} options
 */
export function createStore({ initial, actions }) {
  /** @type {S} */
  let state = initial;
  let seq = 0;
  /** @type {Entry[]} */
  const log = [];
  /** @type {Map<number, S>} state before each entry, for undo */
  const before = new Map();
  /** @type {Set<(e: Event, state: S) => void>} */
  const listeners = new Set();
  const defs = new Map(actions.map((a) => [a.type, a]));

  /** @param {Event} e */
  const emit = (e) => { for (const fn of listeners) fn(e, state); };

  return {
    get state() { return state; },
    get log() { return log.slice(); },

    /** @param {(e: Event, state: S) => void} fn */
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },

    /**
     * Apply one action. Never throws: a bad action is a logged rejection.
     * @param {{ type: string, payload?: any }} action @param {Author} author @param {{ why?: string }} [meta]
     * @returns {{ ok: true, entry: Entry } | { ok: false, error: string }}
     */
    dispatch(action, author, meta = {}) {
      const def = defs.get(action?.type);
      const payload = action?.payload ?? {};
      const reject = (/** @type {string} */ error) => { emit({ kind: 'rejected', action, author, error }); return /** @type {const} */ ({ ok: false, error }); };
      if (!def) return reject(`unknown action "${action?.type}"`);
      const invalid = validate(def.params, payload);
      if (invalid) return reject(invalid);
      let next;
      try {
        next = def.apply(state, payload);
      } catch (err) {
        if (err instanceof Rejected) return reject(err.message);
        throw err;
      }
      /** @type {Entry} */
      const entry = { seq: ++seq, at: Date.now(), author, type: def.type, payload, ...(meta.why ? { why: meta.why } : {}) };
      before.set(entry.seq, state);
      state = next;
      log.push(entry);
      emit({ kind: 'applied', entry });
      return { ok: true, entry };
    },

    /** An action's parameter definitions (e.g. for translating wire handles), or undefined. */
    params(type) { return defs.get(type)?.params; },

    /** Undo the latest action that is still in effect, whoever made it. */
    undo() {
      const entry = [...log].reverse().find((e) => !e.undone);
      if (!entry) return null;
      // Everything after it was undone already, so its "before" is exact.
      state = /** @type {S} */ (before.get(entry.seq));
      entry.undone = true;
      emit({ kind: 'undone', entry });
      return entry;
    },

    /** The vocabulary, written for a model: what it may propose. */
    vocabulary() {
      return actions.map((a) => {
        const fields = Object.entries(a.params).map(([n, p]) => {
          const t = p.type === 'enum' ? p.values?.map((v) => JSON.stringify(v)).join(' | ') : p.type;
          return `${n}${p.optional ? '?' : ''}: ${t}${p.describe ? ` — ${p.describe}` : ''}`;
        });
        return `${a.type} { ${fields.join('; ')} } — ${a.describe}`;
      }).join('\n');
    },

    /**
     * Apply an agent's proposal in order. Each action succeeds or is rejected
     * on its own; the results go back to the agent on its next turn.
     * @param {{ type: string, payload?: any }[]} proposed @param {string} [why]
     */
    applyProposal(proposed, why) {
      return proposed.map((a) => ({ action: a, result: this.dispatch(a, 'agent', { why }) }));
    },
  };
}
