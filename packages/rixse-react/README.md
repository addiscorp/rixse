# rixse-react

React bindings for [rixse](https://www.npmjs.com/package/rixse). Components read
state and the event stream from a rixse store and write only through
`store.dispatch` — the same door the agent uses.

Full documentation: https://rixse.dev/docs

## Install

```sh
npm install rixse rixse-react
```

Peer dependencies: `react >= 19` and `rixse`.

## Hooks

- `useRixseState(store)` — the store's current state; re-renders on every
  applied or undone action.
- `useRixseEvents(store, limit?)` — every event the store emits (applied,
  rejected, undone), oldest first, annotated with `at` and `order`.
- `nextOrder()` — a monotonic counter shared by events and app notes, so a log
  sorts in the order things happened.

## Example

```jsx
import { createStore, defineAction } from 'rixse';
import { useRixseState, useRixseEvents } from 'rixse-react';

const store = createStore({
  initial: { count: 0 },
  actions: [
    defineAction('count.increment', {
      describe: 'Increment the counter',
      params: {},
      apply: (state) => ({ ...state, count: state.count + 1 }),
    }),
  ],
});

function Counter() {
  const state = useRixseState(store);
  const events = useRixseEvents(store);
  return (
    <button onClick={() => store.dispatch({ type: 'count.increment' }, 'you')}>
      count: {state.count} ({events.length} events)
    </button>
  );
}
```

Server-side rendering works as-is: the hooks read the store's current state
synchronously, so `renderToString` from `react-dom/server` renders the state at
dispatch time.

## License

Apache-2.0.
