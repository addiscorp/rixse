// The real zega engine in the page (the same wasm build zega.earth uses). The
// movies graph loads once (~120 ms); after that a query runs synchronously in
// a few milliseconds, which is what lets a rixse action validate its query at
// the moment it is applied. Framework-free: used by the canvas demo (React)
// and the plain demo (no framework) alike.

let zega = null;
let loading = null;

export function getZega() { return zega; }

/** Load the engine and the movies graph from `base` (default /zega/, the canvas demo's public dir). */
export function loadZega(base = '/zega/') {
  if (zega) return Promise.resolve(zega);
  loading ??= (async () => {
    const t0 = performance.now();
    // Loaded at runtime, outside any bundler.
    const mod = await import(/* webpackIgnore: true */ base + 'zega_wasm.js');
    await mod.default({ module_or_path: base + 'zega_wasm_bg.wasm' });
    const source = await (await fetch(base + 'samples/movies.zql')).text();
    const db = new mod.ZegaWasm();
    const sources = {};
    await Promise.all(JSON.parse(db.load_locations(source, true)).map(async (loc) => {
      sources[loc] = await (await fetch(base + loc.replace(/^\.\//, ''))).text();
    }));
    db.apply_with_sources(source, JSON.stringify(sources));
    zega = {
      schema: source.slice(source.indexOf('schema {'), source.indexOf('display {')).trim() + '\n}',
      loadMs: Math.round(performance.now() - t0),
      run: (zql) => JSON.parse(db.run(source, zql)),
    };
    return zega;
  })();
  return loading;
}
