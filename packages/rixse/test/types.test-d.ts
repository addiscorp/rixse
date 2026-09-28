// Compile-time proof for the typed API (rixse#18): everything here is checked
// by `tsc --noEmit`. Lines that must compile stand alone; lines that must NOT
// compile carry @ts-expect-error — if a loosened type lets one through, tsc
// fails on the unused directive.
import { createStore, createViewport, defineAction, defineComponent, defineSource } from 'rixse';

const stat = defineComponent('stat', {
  describe: 'one number',
  sizes: ['small', 'medium'],
  params: {
    label: { type: 'string', describe: 'field path' },
    precision: { type: 'number', optional: true },
  },
});

const bar = defineComponent('bar', {
  describe: 'bars',
  sizes: ['medium', 'large', 'viewport'],
  size: 'medium',
  source: 'db',
  params: {
    metric: { type: 'enum', values: ['gross', 'count'] as const, describe: 'what to compare' },
    limit: { type: 'number', optional: true },
  },
  select: 'bar labels',
});

// defineComponent keeps the literal kind and the params descriptors.
const statKind: 'stat' = stat.kind;
const barMetric = bar.params.metric;
const metricType: 'enum' = barMetric.type;
const metricValues: readonly ['gross', 'count'] = barMetric.values as readonly ['gross', 'count'];

const view = createViewport({ components: [stat, bar], sources: { db: defineSource({ describe: 'the db', run: () => [] }) } });
const store = createStore({ initial: view.initial(), actions: view.actions });

// ——— must compile ———

// view.show accepts declared kinds with that kind's params; sizes come from the kind.
store.dispatch({ type: 'view.show', payload: { id: 'a', kind: 'bar', title: 'Box office', metric: 'gross', limit: 10, size: 'large', at: 'end' } }, 'you');
// optional params may be omitted; a kind without params takes none.
store.dispatch({ type: 'view.show', payload: { id: 'b', kind: 'stat', title: 'Total', label: 'title', size: 'small' } }, 'agent');
store.dispatch({ type: 'view.show', payload: { id: 'c', kind: 'bar', title: 'Count', metric: 'count', at: 'before', target: 'a' } }, 'you');
// view.move takes only end/before/after, view.resize a real Size.
store.dispatch({ type: 'view.move', payload: { id: 'a', at: 'before', target: 'b' } }, 'you');
store.dispatch({ type: 'view.resize', payload: { id: 'a', size: 'medium' } }, 'you');
store.dispatch({ type: 'view.remove', payload: { id: 'b' } }, 'you');
store.dispatch({ type: 'view.clear' }, 'you');
// select.* is typed.
store.dispatch({ type: 'select.set', payload: { view: 'a', items: 'Avatar' } }, 'you');
store.dispatch({ type: 'select.clear' }, 'you');

// State items carry the declared kinds, and the catalogue map is keyed by them.
const first = store.state.order[0]!;
const itemKind: 'stat' | 'bar' = store.state.items[first]!.kind;
const foundKind: 'stat' | 'bar' | undefined = view.components.get('bar')?.kind;
const rows: unknown[] = view.rowsFor(store.state.items[first]!);

// defineAction infers its payload from the params descriptors; the store's
// dispatch is the union of its actions' { type, payload }. (Explicit type
// arguments list every parameter — old-style defineAction<S, P> keeps working
// via the second overload.)
type Counter = { count: number };
const bump = defineAction('bump', {
  describe: 'bump the counter',
  params: { by: { type: 'number', optional: true } },
  apply: (s: Counter, p) => ({ count: s.count + (p.by ?? 1) }),
});
const counter = createStore({ initial: { count: 0 }, actions: [bump] });
counter.dispatch({ type: 'bump', payload: { by: 2 } }, 'you');
counter.dispatch({ type: 'bump' }, 'you');

// ——— must NOT compile ———

// @ts-expect-error unknown kind
store.dispatch({ type: 'view.show', payload: { id: 'a', kind: 'pie', title: 'x', metric: 'gross' } }, 'you');
// @ts-expect-error wrong param type: limit is a number
store.dispatch({ type: 'view.show', payload: { id: 'a', kind: 'bar', title: 'x', metric: 'gross', limit: 'ten' } }, 'you');
// @ts-expect-error bad enum value
store.dispatch({ type: 'view.show', payload: { id: 'a', kind: 'bar', title: 'x', metric: 'revenue' } }, 'you');
// @ts-expect-error bad size: stat comes in small|medium, not viewport
store.dispatch({ type: 'view.show', payload: { id: 'b', kind: 'stat', title: 'x', label: 't', size: 'viewport' } }, 'you');
// @ts-expect-error stat has no metric param
store.dispatch({ type: 'view.show', payload: { id: 'b', kind: 'stat', title: 'x', label: 't', metric: 'gross' } }, 'you');
// @ts-expect-error bar requires metric
store.dispatch({ type: 'view.show', payload: { id: 'a', kind: 'bar', title: 'x' } }, 'you');
// @ts-expect-error resize size must be a Size
store.dispatch({ type: 'view.resize', payload: { id: 'a', size: 'huge' } }, 'you');
// @ts-expect-error move takes end|before|after, not sideways
store.dispatch({ type: 'view.move', payload: { id: 'a', at: 'sideways' } }, 'you');
// @ts-expect-error select.set names a view and items
store.dispatch({ type: 'select.set', payload: { view: 'a', items: 42 } }, 'you');
// @ts-expect-error defineAction payload: by is a number
counter.dispatch({ type: 'bump', payload: { by: 'two' } }, 'you');
// @ts-expect-error the store has no such action
counter.dispatch({ type: 'bump.bump', payload: { by: 2 } }, 'you');

export { statKind, barMetric, metricType, metricValues, itemKind, foundKind, rows };
