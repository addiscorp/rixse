// swift-tools-version: 6.2
import Foundation
import PackageDescription

// The Swift command-line tools ship swift-testing in
// <devdir>/Library/Developer/Frameworks (with its support dylib in
// <devdir>/Library/Developer/usr/lib), but SwiftPM only finds it automatically
// with a full Xcode install. Add the search paths by hand when the framework
// exists there (CLT machines); on Xcode and Linux the module resolves on its
// own and no flags are added.
func swiftTestingDirs() -> (frameworks: String, lib: String)? {
  let process = Process()
  process.executableURL = URL(fileURLWithPath: "/usr/bin/xcode-select")
  process.arguments = ["-p"]
  let pipe = Pipe()
  process.standardOutput = pipe
  guard (try? process.run()) != nil else { return nil }
  process.waitUntilExit()
  guard process.terminationStatus == 0,
        let devDir = String(data: pipe.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8)?
          .trimmingCharacters(in: .whitespacesAndNewlines),
        !devDir.isEmpty else { return nil }
  let candidates = [
    (frameworks: "\(devDir)/Library/Developer/Frameworks", lib: "\(devDir)/Library/Developer/usr/lib"),
    (frameworks: "\(devDir)/Library/Frameworks", lib: "\(devDir)/Library/usr/lib"),
  ]
  return candidates.first {
    FileManager.default.fileExists(atPath: "\($0.frameworks)/Testing.framework")
      && FileManager.default.fileExists(atPath: "\($0.lib)/lib_TestingInterop.dylib")
  }
}

var testSwiftSettings: [SwiftSetting] = []
var testLinkerSettings: [LinkerSetting] = []
if let testing = swiftTestingDirs() {
  testSwiftSettings.append(.unsafeFlags(["-F", testing.frameworks]))
  testLinkerSettings.append(.unsafeFlags([
    "-F", testing.frameworks,
    "-Xlinker", "-rpath", "-Xlinker", testing.frameworks,
    "-Xlinker", "-rpath", "-Xlinker", testing.lib,
  ]))
}

let package = Package(
  name: "Rixse",
  platforms: [.macOS(.v14), .iOS(.v16)],
  products: [.library(name: "Rixse", targets: ["Rixse"])],
  targets: [
    .target(name: "Rixse"),
    .target(name: "RixseConformance", dependencies: ["Rixse"]),
    .executableTarget(name: "rixse-conformance-check", dependencies: ["RixseConformance"]),
    .testTarget(
      name: "RixseTests",
      dependencies: ["Rixse", "RixseConformance"],
      swiftSettings: testSwiftSettings,
      linkerSettings: testLinkerSettings
    ),
  ]
)
