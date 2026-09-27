export type Author = 'you' | 'agent';
export type Param = { type: 'string' | 'number' | 'boolean' | 'enum'; values?: readonly string[]; optional?: boolean; describe?: string; /** the entity type this value names, for wire handles */ ref?: string };
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
  params(type: string): Record<string, Param> | undefined;
  undo(): Entry | null;
  vocabulary(): string;
  applyProposal(proposed: Action[], why?: string): { action: Action; result: Result }[];
};
export function createStore<S>(options: { initial: S; actions: ActionDef<S, any>[] }): Store<S>;

export type WireField = { name: string; get?: (item: any) => unknown; default?: unknown; ref?: string };
export type WireEntity<S> = { type: string; list: (state: S) => any[]; id?: (item: any) => string; fields: WireField[] };
export type Wire<S> = {
  legend(): string;
  encode(state: S): string;
  resolve(action: Action, params: Record<string, Param> | undefined): Action;
  handle(type: string, id: string): string | undefined;
};
export function createWire<S>(options: { entities: WireEntity<S>[] }): Wire<S>;

export type Size = 'viewport' | 'large' | 'medium' | 'small';
export const SIZES: readonly Size[];
export const PLACES: readonly ['end', 'before', 'after', 'replace'];
export type Place = (typeof PLACES)[number];
export type ComponentParam = Param & { default?: unknown };
export type Item = { id: string; kind: string; title: string; size: Size; query: string; [param: string]: unknown };
export type Selection = { view: string; items: string[] };
export type ViewportState<I extends Item = Item> = { items: Record<string, I>; order: string[]; selection: Selection | null };
export type ComponentDef = {
  describe: string;
  sizes: Size[];
  size?: Size;
  params?: Record<string, ComponentParam>;
  /** the data source it reads; rows never pass through the model */
  source?: string;
  /** params that make two components "the same one" (ensure mode) */
  identity?: string[];
  /** a reason the rows can't be drawn with these params, or null */
  check?: (rows: any[], item: any) => string | null;
  /** what a selection in it names, for the agent */
  select?: string;
  /** a container: holds other components as a grid or as tabs (APS 4) */
  holds?: 'grid' | 'tabs';
};
export type ComponentSpec = ComponentDef & { kind: string; size: Size; params: Record<string, ComponentParam> };
export type SourceDef = { describe: string | (() => string); /** one line: the query language and its shape, shown on the query param */ query?: string; run: (query: string) => any[]; hint?: (error: string) => string };
export function defineComponent(kind: string, def: ComponentDef): ComponentSpec;
export function defineSource(def: SourceDef): SourceDef;
export function place(order: string[], id: string, at?: Place, target?: string): { order: string[]; removed?: string };
export function layout(state: ViewportState<any>, width: number, bands?: { min: number; cols: number }[], container?: string): { cols: number; cells: { id: string; cols: number; rows: number }[] };
export function createViewport<I extends Item = Item>(options: { components: ComponentSpec[]; sources: Record<string, SourceDef> }): {
  initial(): ViewportState<I>;
  actions: ActionDef<ViewportState<I>, any>[];
  catalogue(): string;
  rowsFor(item: I): any[];
  components: Map<string, ComponentSpec>;
};
