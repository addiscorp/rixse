# rixse

Agentic UI: `ui = view(state)`, and the agent writes state through the same typed actions you do.

Early development. The architecture will be driven by the demos we build.

| path | what |
|---|---|
| `packages/rixse` | the core (placeholder release `0.0.0` holds the npm name) |
| `packages/rixse-react` | React hooks: `useRixseState`, `useRixseEvents` |
| `packages/rixse-swift` | the Swift core, proven against the shared conformance vectors |
| `demos/canvas` | Next.js demo: chat · canvas · logs, agent on Workers AI |
| `site/` | rixse.dev (Cloudflare Worker, static assets) |

Planned packages: `rixse` (core), `rixse-dom`, `rixse-react`; later `rixse-kotlin`, `rixse-rust`.

## Swift Package Manager

The Swift core is a SwiftPM dependency from the repository root (iOS 17, macOS 14):

```swift
// Package.swift
dependencies: [
  .package(url: "https://github.com/rixsedev/rixse.git", branch: "main"),
],
targets: [
  .target(
    name: "YourApp",
    dependencies: [.product(name: "Rixse", package: "rixse")]
  ),
]
```

Then `import Rixse` — `createViewport`, `Store`, `layout` and the rest of the
core are all in the one library. (Until the first tagged release, depend on
the branch; a `from:` version replaces it once releases exist.)

## Run the canvas demo

```
npm install
CLOUDFLARE_API_TOKEN=… CLOUDFLARE_ACCOUNT_ID=… npm run demo   # http://localhost:3100
npm test                                                   # core tests
```

The AI binding is always remote, so the demo needs Cloudflare credentials that can run Workers AI.
