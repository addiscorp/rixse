# rixse on iOS — the Movies demo

The Movies demo (demos/canvas) as a native SwiftUI app, proving rixse's
primitives on iOS (rixse#2):

- `packages/rixse-swift` is the store, components, layout and wire — the same
  code the conformance vectors check against the JS core.
- `vendor/ZegaEngine.xcframework` is the real zega engine (the `zega-ios`
  shim crate here builds it; pinned to the same zega commit as the web demo's
  wasm). The app loads the same samples and runs the same ZQL, synchronously.
- The agent talks to the demo route (`/api/agent`) over plain http; nothing
  model-related lives in the app.

Build (needs Xcode with the iOS platform and xcodegen):

```sh
xcodegen
xcodebuild -scheme RixseMovies -destination 'platform=iOS Simulator,name=iPhone 17' build
```

`project.yml` wires: the local `Rixse` SwiftPM package, the xcframework, the
`zega/` samples folder as a bundle folder reference, and the ATS exception for
the http agent endpoint.
