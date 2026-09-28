// swift-tools-version: 6.2
import PackageDescription

// The distributable Swift package (rixse#13): SwiftPM resolves a remote
// dependency only from a manifest at the repository root, so this one
// publishes the Rixse library whose sources live in packages/rixse-swift.
// That package keeps its own manifest for the conformance executable and the
// tests — `swift run rixse-conformance-check` and the iOS demo's local
// package reference are unchanged. Platforms match packages/rixse-swift.
let package = Package(
  name: "Rixse",
  platforms: [.macOS(.v14), .iOS(.v17)],
  products: [.library(name: "Rixse", targets: ["Rixse"])],
  targets: [
    .target(name: "Rixse", path: "packages/rixse-swift/Sources/Rixse"),
  ]
)
