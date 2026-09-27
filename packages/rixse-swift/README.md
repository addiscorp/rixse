# rixse-swift

The Swift core of rixse (APS 2): one state, two authors — the store with its
authored log and undo, Components (APS 4: the `viewport → large → medium →
small` ladder, relative placement, container-width layout), data-source
adapters, and the wire format. No UIKit/SwiftUI in the core target: every
platform is just another `view(state)`.

The package is held to the JS core (`packages/rixse`) by the shared
conformance vectors in `conformance/`: the same files drive the JS tests and
the checks here, so the two implementations cannot drift.

```
swift run rixse-conformance-check   # runs every vector, exits non-zero on failure
swift test                          # the same checks through the swift-testing suite
```

`swift run rixse-conformance-check --dump <vector>.txt` prints what the Swift
core generates for one text vector, for diffing when a check fails.

One environment note: the bare command-line tools (no Xcode) ship
swift-testing, but their SwiftPM builds the test bundle without running it —
`swift test` exits 0 having run zero tests there. The executable gate above is
the check that actually runs on such machines; `swift test` works on full
Xcode installs, and `Package.swift` adds the framework search paths the CLT
layout needs.

## Layout

| target | what |
|---|---|
| `Rixse` | the core: `Store`, `Rejected`, `Param`/`validate`, Components (`defineComponent`, `place`, `layout`, `createViewport`), `Wire` |
| `RixseConformance` | the vector loaders and check functions, shared so the two runners can never disagree |
| `rixse-conformance-check` | executable gate over the vectors |
| `RixseTests` | swift-testing suite over the same check functions |
