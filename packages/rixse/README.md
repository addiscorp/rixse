# rixse

Agentic UI: `ui = view(state)`, and the agent writes state through the same typed
actions you do. The renderer owns pixels; the agent proposes typed actions from a
vocabulary the app defines; rixse validates and applies them, and records every
action with its author (`you` or `agent`) so undo and audit work for both.

Full documentation: https://rixse.dev/docs

## Install

```sh
npm install rixse
```

React bindings live in [`rixse-react`](https://www.npmjs.com/package/rixse-react).

## Core: one store, two authors

```js
import { createStore, defineAction, Rejected } from 'rixse';

const actions = [
  defineAction('movie.rate', {
    describe: 'Rate a movie',
    params: {
      title: { type: 'string', describe: 'the movie title' },
      stars: { type: 'number', describe: '1–5' },
    },
    apply: (state, { title, stars }) => {
      if (stars < 1 || stars > 5) throw new Rejected('stars must be 1–5');
      return { ...state, ratings: { ...state.ratings, [title]: stars } };
    },
  }),
];

const store = createStore({ initial: { ratings: {} }, actions });

store.dispatch({ type: 'movie.rate', payload: { title: 'Avatar', stars: 5 } }, 'you');
store.dispatch({ type: 'movie.rate', payload: { title: 'Avatar', stars: 9 } }, 'agent');
// → { ok: false, error: 'stars must be 1–5' }, logged as a rejection

store.log;       // every applied action, with author, payload and reason
store.undo();    // undoes the latest action still in effect, whoever made it
store.vocabulary(); // the actions written for a model: what it may propose
store.applyProposal(proposed, why); // apply an agent's batch, result per action
```

A bad action never throws: it is rejected with a readable reason and logged.

## Components: the agent's visual vocabulary

`defineComponent(kind, def)` names the sizes, parameters, data source and
selection a kind of component supports. `layout(state, width, bands)` maps the
viewport's ordered items to grid cells, deterministically.

```js
import { defineComponent, defineSource, createViewport, createStore, layout } from 'rixse';

const line = defineComponent('line', {
  describe: 'Yearly values',
  sizes: ['large', 'viewport'],
  source: 'movies',
  params: {
    label: { type: 'string', optional: true },
    x: { type: 'string' },
    value: { type: 'string' },
  },
});
const movies = defineSource({
  describe: 'A local Movies source',
  query: 'ZQL',
  run: () => [{ title: 'Avatar', year: 2009, gross: 1 }],
});

const viewport = createViewport({ components: [line], sources: { movies } });
const store = createStore({ initial: viewport.initial(), actions: viewport.actions });

store.dispatch({ type: 'view.show', payload: {
  id: 'years', kind: 'line', title: 'By year',
  query: '{ Movie limit 100000 { title year gross } }',
  label: 'title', x: 'year', value: 'gross', size: 'large',
} }, 'agent');

layout(store.state, 800, [
  { min: 0, cols: 2 },
  { min: 720, cols: 4 },
  { min: 1280, cols: 6 },
]);
// → { cols: 4, cells: [{ id, cols, rows }, ...] }
```

The viewport generates typed actions — `view.show`, `view.move`, `view.resize`,
`view.remove`, `view.clear`, `select.set`, `select.clear` — each validated and
applied atomically or rejected with a readable reason. Selection is state: the
renderer reports clicks through `select.set`, and the selection can be attached
to the user's prompt so words like "these" have a concrete referent.
`rowsFor(item)` runs an item's query through its source; rows stay in the app
and never pass through the model.

## Wire: handles for the model

`createWire({ entities })` encodes state as a compact text wire format, resolves
wire handles in action payloads back to entity ids, and writes a `legend()` the
model reads.

## API

- `createStore({ initial, actions })` → `{ state, log, subscribe, dispatch, params, undo, vocabulary, applyProposal }`
- `defineAction(type, def)`, `validate(params, payload)`, `class Rejected`
- `defineComponent(kind, def)`, `defineSource(def)`
- `createViewport({ components, sources })` → `{ initial, actions, catalogue, rowsFor, components }`
- `place(order, id, at?, target?)`, `layout(state, width, bands?)`
- `createWire({ entities })`, `SIZES`, `PLACES`

## License

Apache-2.0.
