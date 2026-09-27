// Runs the shared conformance vectors against the Swift core and exits
// non-zero on the first failure. This is the gate for machines whose SwiftPM
// cannot run test bundles (the bare command-line tools); on Xcode, `swift
// test` runs the same functions through the RixseTests suite.
import Foundation
import Rixse
import RixseConformance

// --dump <name>: print what the Swift core generates for one text vector, for
// diffing against conformance/<name> when a check fails.
if CommandLine.arguments.count == 3 && CommandLine.arguments[1] == "--dump" {
  let name = CommandLine.arguments[2]
  do {
    switch name {
    case "catalogue.txt": print(try Fixture.load().viewport().catalogue())
    case "vocabulary.txt": print(try Fixture.load().store().vocabulary())
    case "movies-catalogue.txt": print(try MoviesFixture.load().viewport.catalogue())
    case "movies-vocabulary.txt":
      let movies = try MoviesFixture.load()
      print(Store(initial: movies.viewport.initial(), actions: movies.viewport.actions).vocabulary())
    default:
      FileHandle.standardError.write(Data("unknown dump \(name)\n".utf8))
      exit(2)
    }
    exit(0)
  } catch {
    FileHandle.standardError.write(Data("dump failed: \(error)\n".utf8))
    exit(2)
  }
}

var failed = false
for (name, run) in allChecks {
  do {
    let n = try run()
    print("✔ \(name) (\(n) vectors)")
  } catch let failure as CheckFailure {
    FileHandle.standardError.write(Data("✘ \(name): \(failure.message)\n".utf8))
    failed = true
    break
  } catch {
    FileHandle.standardError.write(Data("✘ \(name): unexpected error: \(error)\n".utf8))
    failed = true
    break
  }
}
exit(failed ? 1 : 0)
