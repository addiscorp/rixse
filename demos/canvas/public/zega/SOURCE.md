# zega in the page

- `zega_wasm.js`, `zega_wasm_bg.wasm`: the zega engine compiled to WebAssembly, copied unchanged from zegadb/earth `vendor/explorer/browser/pkg` (built from zegadb/zega commit ef0982c01e770c604637e59cf42582f298af07c7 with wasm-pack --target web --release).
- `samples/movies.zql` and `samples/movies-*.csv`: the 250 highest-grossing films with a US-dollar box office figure on Wikidata, with cast, directors and genres. Wikidata is CC0. Pulled 26 Sep 2026 with the queries in the rixse repo's `demos/canvas/data/`.
