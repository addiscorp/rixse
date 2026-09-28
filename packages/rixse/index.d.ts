export type Author = 'you' | 'agent';
export type Param = { type: 'string' | 'number' | 'boolean' | 'enum'; values?: readonly string[]; optional?: boolean; describe?: string; /** the entity type this value names, for wire handles */ ref?: string };

/** The value one Param descriptor admits: 'number' → number, 'enum' with values → the union of its literals. */
export type ParamValue<P> =
  P extends { type: 'enum'; values: readonly (infer V)[] } ? V
  : P extends { type: 'number' } ? number
  : P extends { type: 'boolean' } ? boolean
  : P extends { type: 'string' } ? string
  : P extends { type: 'enum' } ? string
  : unknown;

/** The payload object a params descriptor map describes; `optional: true` descriptors become optional keys. */
export type PayloadOf<Params> = Params extends Record<string, Param> ? {
  -readonly [K in keyof Params as Params[K] extends { optional: true } ? K : never]?: ParamValue<Params[K]>;
} & {
  -readonly [K in keyof Params as Params[K] extends { optional: true } ? never : K]: ParamValue<Params[K]>;
} : never;

export type ActionDef<S = any, P = any, T extends string = string> = { type: T; describe: string; params: Record<string, Param>; apply: (state: S, payload: P) => S };
export type Action = { type: string; payload?: unknown };
export type Entry = { seq: number; at: number; author: Author; type: string; payload: unknown; why?: string; undone?: boolean };
export type RixseEvent =
  | { kind: 'applied'; entry: Entry }
  | { kind: 'undone'; entry: Entry }
  | { kind: 'rejected'; action: Action; author: Author; error: string };
export type Result = { ok: true; entry: Entry } | { ok: false; error: string };

export class Rejected extends Error {}

/** An action definition a store can hold; the payload type is recovered per action at the dispatch door. */
type AnyActionDef = { type: string; describe: string; params: Record<string, Param>; apply: (state: any, payload: any) => any };

/** The union of { type, payload } a store's actions accept, for dispatch. */
type DispatchOne<D> = D extends { type: infer T extends string; apply: (state: any, payload: infer P) => any } ? { type: T; payload?: P } : never;
export type DispatchOf<A extends readonly AnyActionDef[]> = DispatchOne<A[number]>;

/** The payload type is inferred from the params descriptors. */
export function defineAction<S, const Params, T extends string>(type: T, def: { describe: string; params: Params & Record<string, Param>; apply: (state: S, payload: PayloadOf<Params>) => S }): ActionDef<S, PayloadOf<Params>, T>;
export function defineAction<S, P>(type: string, def: Omit<ActionDef<S, P>, 'type'>): ActionDef<S, P>;
export function validate(params: Record<string, Param>, payload: unknown): string | null;
export type Store<S, D extends Action = Action> = {
  readonly state: S;
  readonly log: Entry[];
  subscribe(fn: (e: RixseEvent, state: S) => void): () => void;
  dispatch(action: D, author: Author, meta?: { why?: string }): Result;
  params(type: string): Record<string, Param> | undefined;
  undo(): Entry | null;
  vocabulary(): string;
  /** The agent's door: parsed proposals, each applied or rejected on its own. */
  applyProposal(proposed: Action[], why?: string): { action: Action; result: Result }[];
};
export function createStore<S, const A extends readonly AnyActionDef[] = readonly AnyActionDef[]>(options: { initial: S; actions: A }): Store<S, DispatchOf<A>>;

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
export type ViewportState<I = Item> = { items: Record<string, I>; order: string[]; selection: Selection | null };
export type ComponentDef = {
  describe: string;
  sizes: readonly Size[];
  size?: Size;
  params?: Record<string, ComponentParam>;
  /** the data source it reads; rows never pass through the model */
  source?: string;
  /** params that make two components "the same one" (ensure mode) */
  identity?: readonly string[];
  /** a reason the rows can't be drawn with these params, or null */
  check?: (rows: any[], item: any) => string | null;
  /** what a selection in it names, for the agent */
  select?: string;
};
/** A component as declared: the literal kind and the params descriptors it was defined with. */
export type ComponentSpec<K extends string = string, Def extends ComponentDef = ComponentDef> = Def & {
  kind: K;
  size: Size;
  params: Def['params'] extends Record<string, ComponentParam> ? Def['params'] : Record<string, ComponentParam>;
};
export function defineComponent<const K extends string, const Def extends ComponentDef>(kind: K, def: Def): ComponentSpec<K, Def>;
export type SourceDef = { describe: string | (() => string); /** one line: the query language and its shape, shown on the query param */ query?: string; run: (query: string) => any[]; hint?: (error: string) => string };
export function defineSource(def: SourceDef): SourceDef;
export function place(order: string[], id: string, at?: Place, target?: string): { order: string[]; removed?: string };
export function layout(state: ViewportState<any>, width: number, bands?: { min: number; cols: number }[]): { cols: number; cells: { id: string; cols: number; rows: number }[] };

/** The kinds a component catalogue declares. */
export type KindsOf<Components extends readonly ComponentSpec[]> = Components[number] extends { kind: infer K extends string } ? K : never;
/** A state item's shape: the shared fields plus each of its kind's params. */
export type ItemOf<C> = C extends { kind: infer K extends string; params: infer P }
  ? { id: string; kind: K; title: string; size: Size; query: string } & { -readonly [Name in keyof P]: ParamValue<P[Name]> }
  : never;
export type ItemsOf<Components extends readonly ComponentSpec[]> = Components[number] extends infer C ? ItemOf<C> : never;

/** view.show's payload: one branch per kind — the kind's own params, a size from that kind's sizes, and where to put it. */
export type ShowOf<Components extends readonly ComponentSpec[]> = {
  [C in Components[number] as C extends { kind: infer K extends string } ? K : never]:
    C extends { kind: infer K extends string; sizes: readonly Size[]; params: infer P }
    ? { id: string; kind: K; title: string; query?: string; size?: C['sizes'][number]; at?: Place; target?: string } & PayloadOf<P>
    : never;
}[KindsOf<Components>];

/** The viewport's seven actions, payloads inferred from the catalogue. */
export type ViewportActions<Components extends readonly ComponentSpec[], S = ViewportState<ItemsOf<Components>>> = readonly [
  ActionDef<S, ShowOf<Components>, 'view.show'>,
  ActionDef<S, { id: string; at: 'end' | 'before' | 'after'; target?: string }, 'view.move'>,
  ActionDef<S, { id: string; size: Size }, 'view.resize'>,
  ActionDef<S, { id: string }, 'view.remove'>,
  ActionDef<S, Record<string, never>, 'view.clear'>,
  ActionDef<S, { view: string; items: string }, 'select.set'>,
  ActionDef<S, Record<string, never>, 'select.clear'>,
];
export function createViewport<const Components extends readonly ComponentSpec[]>(options: { components: Components; sources: Record<string, SourceDef> }): {
  initial(): ViewportState<ItemsOf<Components>>;
  actions: ViewportActions<Components>;
  catalogue(): string;
  rowsFor(item: ItemsOf<Components>): any[];
  components: Map<KindsOf<Components>, Components[number]>;
};
