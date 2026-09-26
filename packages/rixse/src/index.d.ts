export type Author = 'you' | 'agent';
export type Param = { type: 'string' | 'number' | 'boolean' | 'enum'; values?: readonly string[]; optional?: boolean; describe?: string };
export type ActionDef<S = any, P = any> = { type: string; describe: string; params: Record<string, Param>; apply: (state: S, payload: P) => S };
export type Action = { type: string; payload?: unknown };
export type Entry = { seq: number; at: number; author: Author; type: string; payload: unknown; why?: string; undone?: boolean };
export type RixseEvent =
  | { kind: 'applied'; entry: Entry }
  | { kind: 'undone'; entry: Entry }
  | { kind: 'rejected'; action: Action; author: Author; error: string };
export type Result = { ok: true; entry: Entry } | { ok: false; error: string };

export class Rejected extends Error {}
export function defineAction<S, P>(type: string, def: Omit<ActionDef<S, P>, 'type'>): ActionDef<S, P>;
export function validate(params: Record<string, Param>, payload: unknown): string | null;
export type Store<S> = {
  readonly state: S;
  readonly log: Entry[];
  subscribe(fn: (e: RixseEvent, state: S) => void): () => void;
  dispatch(action: Action, author: Author, meta?: { why?: string }): Result;
  undo(): Entry | null;
  vocabulary(): string;
  applyProposal(proposed: Action[], why?: string): { action: Action; result: Result }[];
};
export function createStore<S>(options: { initial: S; actions: ActionDef<S, any>[] }): Store<S>;
