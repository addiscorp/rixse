// A scripted run for headless acceptance: launched with `-script <name>`, the
// app plays scripts/<name>.txt from the bundle — one step per line —
// through the same door as the UI (send() for chat, dispatch for taps), and
// appends one progress line per step to Documents/script-progress.txt, which
// the host polls between `simctl io booted screenshot` captures. The script
// changes nothing about how the app behaves for a person.
import Foundation
import Rixse

extension MovieStore {
  func runScript(named name: String) async {
    progress("SCRIPT \(name) — state reset, starting")
    guard let url = Bundle.main.url(forResource: name, withExtension: "txt", subdirectory: "scripts"),
          let text = try? String(contentsOf: url, encoding: .utf8) else {
      progress("SCRIPT ERROR — scripts/\(name).txt is not in the bundle")
      return
    }
    let lines = text.split(separator: "\n", omittingEmptySubsequences: false)
      .map { $0.trimmingCharacters(in: .whitespaces) }
      .filter { !$0.isEmpty && !$0.hasPrefix("#") }
    for (i, line) in lines.enumerated() {
      await step(line, index: i + 1)
      try? await Task.sleep(for: .milliseconds(900)) // let the step paint before the host screenshots
    }
    progress("SCRIPT DONE — \(lines.count) steps")
  }

  private func step(_ line: String, index: Int) async {
    let head = line.split(separator: " ", maxSplits: 1).map(String.init)
    let command = head.first ?? ""
    let rest = head.count > 1 ? head[1] : ""
    switch command {
    case "send":
      let before = log.count
      let notesBefore = notes.count
      await send(rest)
      let applied = log.dropFirst(before).filter { !$0.undone }
      let detail = applied.map { "\($0.type) \(jsStringify($0.payload))" }.joined(separator: " | ")
      let rejected = notes.dropFirst(notesBefore).filter { $0.kind == .rejected || $0.kind == .error }.map(\.text)
      let latency = notes.dropFirst(notesBefore).map(\.text).last(where: { $0.hasPrefix("⏱") })
      let say = turns.last?.content ?? ""
      progress("STEP \(index) send \"\(rest)\" — \(applied.count) applied\(detail.isEmpty ? "" : ": \(detail)")\(rejected.isEmpty ? "" : " — rejected: \(rejected.joined(separator: " | "))")\(latency.map { " — \($0)" } ?? "") — say: \(say)")
    case "tapbars":
      // What tapping the first N bars of the first bar chart dispatches.
      let n = Int(rest) ?? 2
      guard let id = state.order.first(where: { state.items[$0]?.kind == "bar" }),
            let item = state.items[id] else {
        progress("STEP \(index) tapbars \(rest) — ERROR: no bar chart on the page")
        return
      }
      let result = rowsFor(item)
      let labels = capped(series(result.rows, ViewSpec(item)), "bar").data.prefix(n).map(\.label)
      guard !labels.isEmpty else {
        progress("STEP \(index) tapbars \(rest) — ERROR: the bar chart has no rows")
        return
      }
      dispatch(Action("select.set", payload: jsonObject([("view", .string(id)), ("items", .string(labels.joined(separator: "|")))])), .you)
      progress("STEP \(index) tapbars \(n) — selected \(labels.joined(separator: ", ")) in \(id)")
    case "wait":
      try? await Task.sleep(for: .milliseconds(Int(rest) ?? 1000))
      progress("STEP \(index) wait \(rest)")
    default:
      progress("STEP \(index) UNKNOWN — \(line)")
    }
  }

  private func progress(_ line: String) {
    if line.hasPrefix("SCRIPT DONE") { scriptStatus = "done" }
    else if line.hasPrefix("SCRIPT ERROR") { scriptStatus = "error" }
    else if line.hasPrefix("SCRIPT ") { scriptStatus = "running" }
    else if line.hasPrefix("STEP ") { scriptStatus = String(line.prefix(24)) }
    let url = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
      .appendingPathComponent("script-progress.txt")
    let stamped = "\(line)\n"
    if let handle = try? FileHandle(forWritingTo: url) {
      handle.seekToEndOfFile()
      handle.write(Data(stamped.utf8))
      try? handle.close()
    } else {
      try? stamped.write(to: url, atomically: true, encoding: .utf8)
    }
  }
}
