import type { ActionDef, Item, Size, SourceDef, Store, ViewportState, Wire } from 'rixse';

export declare const VIEW_KINDS: readonly ['stat', 'bar', 'line', 'pie', 'table', 'graph'];
export type ViewKind = (typeof VIEW_KINDS)[number];
export { place } from 'rixse';
export declare const FLAGS: readonly ['none', 'drops', 'rises', 'both'];
export type View = {
  id: string; kind: ViewKind; title: string; query: string; label: string; value: string;
  sort: string; limit: number; size: Size; x: string; flag: (typeof FLAGS)[number];
  threshold: number; notes: string;
};
/** What the user (or the agent) has selected in one view: graph nodes "person:Chris Evans", edges "person:Chris Evans > movie:Avatar", or bars "Avatar". */
export type Selection = { view: string; items: string[] };
export type MoviesState = { items: Record<string, View>; order: string[]; selection: Selection | null };
export type Datum = { label: string; value: number };

export declare function valueOf(row: unknown, spec: string): number | null;
export declare const labelOf: (row: unknown, spec: string) => string;
export declare const CAP: { readonly bar: 30; readonly pie: 8 };
export declare function series(rows: unknown[], v: Pick<View, 'label' | 'value' | 'sort' | 'limit'>): Datum[];
export declare function statOf(rows: unknown[], v: Pick<View, 'label' | 'value' | 'title'>): { value: number; caption: string } | null;

export type LinePoint = { x: number; y: number };
export type LineSeries = { name: string; points: LinePoint[] };
export type LineFlag = { series: string; x: number; from: number; to: number; pct: number };
export type LineData = { series: LineSeries[]; flags: LineFlag[]; xs: number[] };
export declare function lineData(rows: unknown[], v: Pick<View, 'label' | 'x' | 'value' | 'flag' | 'threshold' | 'limit'>): LineData;
export declare function capped(data: Datum[], kind: 'bar' | 'pie'): { data: Datum[]; hidden: number };
export declare function hintFor(error: string, schema: string): string;

export declare const zegaSource: SourceDef;
export declare const movieComponents: import('rixse').ComponentSpec[];
export declare const moviesViewport: ReturnType<typeof import('rixse').createViewport<View & Item>>;
export declare const movieActions: ActionDef<ViewportState<View & Item>, any>[];
export declare function runQuery(query: string): unknown[];
export declare function moviesBrief(schema: string): string;
export declare function createMoviesWire(): Wire<MoviesState>;
export declare function createMoviesStore(): Store<MoviesState>;
export type MoviesStore = Store<MoviesState>;
