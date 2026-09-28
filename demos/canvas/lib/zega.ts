// The zega loader lives in demos/shared (framework-free plain ESM), so the
// plain-JS demo imports the very same module. This shim keeps the demo's
// existing import paths working.
export * from 'rixse-demo-shared/zega';
