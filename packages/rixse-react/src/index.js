// React bindings: components read state and the event stream from a rixse
// store. They write only through store.dispatch — the same door the agent uses.
import { useSyncExternalStore, useEffect, useState } from 'react';

let order = 0;
/** A monotonic counter shared by events and app notes, so a log sorts in the order things happened. */
export function nextOrder() { return ++order; }

/** The store's current state; re-renders on every applied or undone action. */
export function useRixseState(store) {
  return useSyncExternalStore(
    (onChange) => store.subscribe(onChange),
    () => store.state,
    () => store.state,
  );
}

/** Every event the store emits (applied, rejected, undone), oldest first. */
export function useRixseEvents(store, limit = 200) {
  const [events, setEvents] = useState([]);
  useEffect(() => store.subscribe((e) => setEvents((list) => [...list.slice(-(limit - 1)), { ...e, at: Date.now(), order: nextOrder() }])), [store, limit]);
  return events;
}
