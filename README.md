# rixse

Agentic UI: `ui = view(state)`, and the agent writes state through the same typed actions you do.

Early development. The architecture will be driven by the demos we build.

| path | what |
|---|---|
| `packages/rixse` | the core (placeholder release `0.0.0` holds the npm name) |
| `packages/rixse-react` | React hooks: `useRixseState`, `useRixseEvents` |
| `demos/canvas` | Next.js demo: chat · canvas · logs, agent on Workers AI |
| `site/` | rixse.dev (Cloudflare Worker, static assets) |

Planned packages: `rixse` (core), `rixse-dom`, `rixse-react`; later `rixse-swift`, `rixse-kotlin`, `rixse-rust`.

## Run the canvas demo

```
npm install
CLOUDFLARE_API_TOKEN=… CLOUDFLARE_ACCOUNT_ID=… npm run demo   # http://localhost:3100
npm test                                                   # core tests
```

The AI binding is always remote, so the demo needs Cloudflare credentials that can run Workers AI.
