'use client';
// The real zega engine in the page (the same wasm build zega.earth uses). The
// movies graph loads once (~120 ms); after that a query runs synchronously in
// a few milliseconds, which is what lets a rixse action validate its query at
// the moment it is applied.

type ZegaWasm = { run(schema: string, zql: string): string; load_locations(source: string, strict: boolean): string; apply_with_sources(source: string, sources: string): void };
export type Zega = { run(zql: string): unknown[]; schema: string; loadMs: number };

let zega: Zega | null = null;
let loading: Promise<Zega> | null = null;

export function getZega(): Zega | null { return zega; }

export function loadZega(): Promise<Zega> {
  if (zega) return Promise.resolve(zega);
  loading ??= (async () => {
    const t0 = performance.now();
    // Loaded at runtime from /public, outside the bundler.
    const mod = await import(/* webpackIgnore: true */ '/zega/zega_wasm.js' as string) as { default: (o: { module_or_path: string }) => Promise<unknown>; ZegaWasm: new () => ZegaWasm };
    await mod.default({ module_or_path: '/zega/zega_wasm_bg.wasm' });
    const source = await (await fetch('/zega/samples/movies.zql')).text();
    const db = new mod.ZegaWasm();
    const sources: Record<string, string> = {};
    await Promise.all((JSON.parse(db.load_locations(source, true)) as string[]).map(async (loc) => {
      sources[loc] = await (await fetch(`/zega/${loc.replace(/^\.\//, '')}`)).text();
    }));
    db.apply_with_sources(source, JSON.stringify(sources));
    zega = {
      schema: source.slice(source.indexOf('schema {'), source.indexOf('display {')).trim() + '\n}',
      loadMs: Math.round(performance.now() - t0),
      run: (zql) => JSON.parse(db.run(source, zql)) as unknown[],
    };
    return zega;
  })();
  return loading;
}
