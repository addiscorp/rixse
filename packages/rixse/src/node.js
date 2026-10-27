// What `import 'rixse'` gives outside Bun: the gateway uses Bun's runtime
// (Bun.CryptoHasher, TypeScript sources), so it says so instead of failing
// on a .ts file.
throw new Error("rixse runs on Bun: the gateway uses Bun's runtime")
