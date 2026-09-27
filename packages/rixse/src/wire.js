// rixse wire: the compact form of state a model reads (APS 2; bench v1 measured
// it at ~43% fewer tokens than JSON and ~31× fewer than RSC Flight, with no loss
// of accuracy). The app declares its entities once; rixse gives every item a
// short session handle (c1, l2…), writes one schema line per type, then one row
// per item. Required fields are positional; optional fields appear as
// name=value only when they differ from their default. Handles stay stable for
// the whole session, so the model can refer back to earlier turns.

/**
 * @typedef {{ name: string, get?: (item: any) => unknown, default?: unknown, ref?: string }} WireField
 * @typedef {{ type: string, list: (state: any) => any[], id?: (item: any) => string, fields: WireField[] }} WireEntity
 */

const BARE = /^[A-Za-z_][\w.-]*$/;

/** A value as the model reads it: numbers and plain words bare, other strings JSON-quoted. */
function show(value) {
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return value.map(show).join(',');
  const s = String(value ?? '');
  return BARE.test(s) ? s : JSON.stringify(s);
}

/** @param {{ entities: WireEntity[] }} options */
export function createWire({ entities }) {
  const byType = new Map(entities.map((e) => [e.type, e]));
  /** id → handle, per type; handle → { type, id } */
  const handles = new Map();
  const owners = new Map();
  const counters = new Map();
  const prefixes = new Map();
  for (const e of entities) {
    let p = e.type[0];
    for (let n = 2; [...prefixes.values()].includes(p); n++) p = e.type.slice(0, n);
    prefixes.set(e.type, p);
  }

  /** The stable handle for one item, assigned on first sight. */
  function handleOf(type, id) {
    const key = `${type}\u0000${id}`;
    let h = handles.get(key);
    if (!h) {
      const n = (counters.get(type) ?? 0) + 1;
      counters.set(type, n);
      h = `${prefixes.get(type)}${n}`;
      handles.set(key, h);
      owners.set(h, { type, id });
    }
    return h;
  }

  const valueOf = (field, item) => (field.get ? field.get(item) : item[field.name]);
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

  return {
    /** How to read the format, for the system prompt. */
    legend() {
      return 'Each type starts with a schema line: type(h required… [optional=default]…). Then one row per item: its handle, required fields in order, then name=value for optional fields that differ from their default. Refer to existing items by handle.';
    },

    /** The state as wire text. */
    encode(state) {
      const out = [];
      for (const e of entities) {
        const items = e.list(state);
        const required = e.fields.filter((f) => !('default' in f));
        const optional = e.fields.filter((f) => 'default' in f);
        const head = [e.id ? 'h' : null, ...required.map((f) => f.name), ...optional.map((f) => `[${f.name}=${show(f.default)}]`)].filter(Boolean);
        out.push(`${e.type}(${head.join(' ')})${items.length ? '' : ' none'}`);
        for (const item of items) {
          const row = [];
          if (e.id) row.push(handleOf(e.type, e.id(item)));
          for (const f of required) {
            const v = valueOf(f, item);
            row.push(f.ref ? handleOf(f.ref, String(v)) : show(v));
          }
          for (const f of optional) {
            const v = valueOf(f, item);
            if (!same(v, f.default)) row.push(`${f.name}=${f.ref ? handleOf(f.ref, String(v)) : show(v)}`);
          }
          out.push(row.join(' '));
        }
      }
      return out.join('\n');
    },

    /**
     * Translate an action the model wrote with handles back to real ids.
     * Only params declared with `ref` are translated, and only when the value
     * is a handle of that type; anything else passes through untouched.
     * @param {{ type: string, payload?: any }} action @param {Record<string, { ref?: string }>} params
     */
    resolve(action, params) {
      if (!action?.payload || typeof action.payload !== 'object') return action;
      const payload = { ...action.payload };
      for (const [name, p] of Object.entries(params ?? {})) {
        const owner = p.ref ? owners.get(payload[name]) : undefined;
        if (owner && owner.type === p.ref) payload[name] = owner.id;
      }
      return { ...action, payload };
    },

    /** The handle for a real id, e.g. to show it in logs. */
    handle: (type, id) => (byType.has(type) ? handleOf(type, id) : undefined),
  };
}
