# zega in the page

- `zega_wasm.js`, `zega_wasm_bg.wasm`: copied unchanged from `zegadb/zega` `browser/pkg`, rebuilt from commit `6ce07f7db56f3407b85cdb7aa7d285d4a7614ae6` using `cd browser && npm run wasm:rebuild -- /absolute/path/to/zega` (which runs `wasm-pack build zega-wasm --target web --release --locked`). Toolchain: rustc 1.96.0, wasm-pack 0.15.0.
- `samples/movies.zql` and `samples/movies-*.csv`: the 250 highest-grossing films with a US-dollar box office figure on Wikidata, with cast, directors and genres. Wikidata is CC0. Pulled 26 Sep 2026 with the queries in the rixse repo's `demos/canvas/data/`.
