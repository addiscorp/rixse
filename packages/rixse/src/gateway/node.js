// What `import 'rixse'` gives outside Bun: the gateway uses Bun's runtime
// (Bun.CryptoHasher, TypeScript sources), so it says so instead of failing
// on a .ts file. The UI core works anywhere, at 'rixse/ui'.
throw new Error("rixse's gateway runs on Bun; for the UI core import 'rixse/ui'")
