# conformance — one definition of correct behaviour, two languages

The files in this directory are **generated from the JS core** by
`generate.mjs` and committed. They are the single source of truth the JS core
and the Swift core (`packages/rixse-swift`) are both held to — there is no
hand-copied expectation on either side, so the two cannot drift.

- `node conformance/generate.mjs` — regenerate after a core change.
- `npm test` (root) — fails if the committed files differ from what the JS
  core generates, so a behaviour change always lands with its vectors.
- `swift run rixse-conformance-check` / `swift test` in `packages/rixse-swift`
  — replays every vector against the Swift core.

## The vectors

| file | what it pins |
|---|---|
| `fixture.json` | the fixture catalogue (stat/bar/note over a two-table source) and the Movies catalogue as data; Swift builds the same viewports from this |
| `validate.json` | `validate(params, payload)` → rejection text or null |
| `place.json` | `place(order, id, at, target)` → new order / rejection |
| `define-component.json`, `create-viewport.json` | definition-time errors |
| `viewport.json` | dispatch/undo/proposal scenarios with the full state and authored log after every step (size checks, per-kind params, ensure, replace drops selection, source errors as fixes, …) |
| `layout.json` | `layout(state, width)` cells at 400/900/1400, plus custom bands |
| `wire.json`, `movies-wire.json` | entity specs + materialised rows → exact `encode` text, and `resolve` handle translation |
| `catalogue.txt`, `vocabulary.txt`, `movies-catalogue.txt`, `movies-vocabulary.txt` | the generated agent texts, byte for byte |
| `movies-brief.txt` | the Movies demo brief (JS-side pin only; its prose is app text, not core) |

Timestamps in log entries are wall-clock and deliberately excluded from the
recorded logs.
