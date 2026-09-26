import type { RixseEvent, Store } from 'rixse';
export function useRixseState<S>(store: Store<S>): S;
export function useRixseEvents(store: Store<any>, limit?: number): (RixseEvent & { at: number; order: number })[];
export function nextOrder(): number;
