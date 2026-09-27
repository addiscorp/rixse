// The agent client: one model call per chat message, streamed. It sends the
// same request the web Chat sends to the demo's /api/agent (brief = generated
// catalogue + app text, vocabulary, wire context, the selection attached to
// the message) and applies streamed NDJSON actions as they arrive, with one
// self-correcting retry on rejection (APS 2). The route calls the models
// through the iMac's proxy, so no key is ever in the app.
import Foundation
import Rixse

private let ENDPOINT = URL(string: "http://samis-imac:3100/api/agent")!

private struct AgentEvent {
  var kind: String = ""
  var say: String?
  var action: Action?
  var error: String?
  var model: String?
  var usage: (input: Int, output: Int)?
  var timing: (firstToken: Int?, model: Int?, server: Int?)?
}

private func parseEvent(_ line: String) -> AgentEvent? {
  guard let v = try? parseJSON(line) else { return nil }
  var e = AgentEvent()
  e.kind = v["kind"]?.stringValue ?? ""
  e.say = v["say"]?.stringValue
  if let a = v["action"], let type = a["type"]?.stringValue {
    e.action = Action(type, payload: a["payload"] ?? .object([]))
  }
  e.error = v["error"]?.stringValue
  e.model = v["model"]?.stringValue
  if let u = v["usage"] {
    e.usage = (Int(u["input"]?.numberValue ?? 0), Int(u["output"]?.numberValue ?? 0))
  }
  if let t = v["timing"] {
    e.timing = (t["firstToken"]?.numberValue.map(Int.init), t["model"]?.numberValue.map(Int.init), t["server"]?.numberValue.map(Int.init))
  }
  return e
}

extension MovieStore {
  /// One model round trip: send, stream, apply each action as it lands.
  /// Returns (say, rejected action lines, action count, latency line).
  private func turn(_ message: String, history: [[String: String]], retryOf failed: [String]?) async throws -> (say: String, failed: [String], total: Int, latency: String) {
    let t0 = Date()
    let context = wireContext
    let label = failed == nil ? "" : "retry · "
    note(.agent, "→ \(label)\(model == "opus" ? "Opus 5.5" : "Gemma 4")\(focusText.isEmpty ? "" : " · with selection") · wire context \(context.count) chars · \(state.order.count) views")

    let bodyPairs: [(String, JSONValue)] = [
      ("brief", .string(brief)),
      ("message", .string(focusText.isEmpty ? message : "\(message)\n(\(focusText))")),
      ("history", .array(history.map { jsonObject([("role", .string($0["role"]!)), ("content", .string($0["content"]!))]) })),
      ("context", .string(context)),
      ("format", .string("wire")),
      ("legend", .string(legend)),
      ("model", .string(model)),
      ("vocabulary", .string(vocabulary)),
      ("rejections", .array((failed ?? []).map { .string($0) })),
    ]

    var request = URLRequest(url: ENDPOINT)
    request.httpMethod = "POST"
    request.setValue("application/json", forHTTPHeaderField: "content-type")
    request.httpBody = Data(jsStringify(jsonObject(bodyPairs)).utf8)

    let (bytes, response) = try await URLSession.shared.bytes(for: request)
    guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
      throw NSError(domain: "agent", code: 1, userInfo: [NSLocalizedDescriptionKey: "HTTP \((response as? HTTPURLResponse)?.statusCode ?? 0)"])
    }

    var say = ""
    var tFirstAction: Date?
    var results: [(ok: Bool, line: String)] = []
    var done: AgentEvent?
    for try await line in bytes.lines {
      guard let e = parseEvent(line) else { continue }
      switch e.kind {
      case "say":
        say = e.say ?? say
      case "action":
        guard let raw = e.action else { continue }
        if tFirstAction == nil { tFirstAction = Date() }
        // The model refers to items by wire handle; translate back to real ids before dispatch.
        let action = resolveWithWire(raw)
        let result = dispatch(action, .agent, why: message)
        results.append((result.ok, result.ok ? "" : "\(action.type) \(jsStringify(action.payload)): \(result.error ?? "")"))
      case "error":
        throw NSError(domain: "agent", code: 2, userInfo: [NSLocalizedDescriptionKey: e.error ?? "model error"])
      case "done":
        done = e
      default:
        continue
      }
    }

    let rejected = results.filter { !$0.ok }.map(\.line)
    let usage = done?.usage
    note(.agent, "← \(done?.model ?? model): \(results.count) action\(results.count == 1 ? "s" : "")\(usage.map { " · \($0.input) in / \($0.output) out tokens" } ?? "")")
    let totalMs = Int(Date().timeIntervalSince(t0) * 1000)
    let firstMs = tFirstAction.map { Int($0.timeIntervalSince(t0) * 1000) }
    let latency = "⏱ \(label)first action \(firstMs.map { "\($0) ms" } ?? "—") · total \(totalMs) ms\(usage.map { " · \($0.input) in / \($0.output) out tokens" } ?? "")"
    note(.agent, latency)
    return (say, rejected, results.count, latency)
  }

  /// Send a chat message: one turn, then one self-correcting retry if rixse rejected anything.
  func send(_ text: String) async {
    let message = text.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !message.isEmpty, !busy else { return }
    busy = true
    defer { busy = false }
    let history = turns.suffix(8).map { t -> [String: String] in
      ["role": t.role, "content": t.footnote.map { "\(t.content)\n(\($0))" } ?? t.content]
    }
    turns.append(ChatTurn(role: "user", content: message))
    turns.append(ChatTurn(role: "assistant", content: "…"))
    do {
      let first = try await turn(message, history: history, retryOf: nil)
      var final = first
      if !first.failed.isEmpty {
        note(.agent, "↻ \(first.failed.count) rejected — sending the reasons back once to self-correct")
        let retryHistory = history + [["role": "user", "content": message], ["role": "assistant", "content": first.say.isEmpty ? "(no reply)" : first.say]]
        let correction = "Your actions were rejected by rixse:\n\(first.failed.map { "- \($0)" }.joined(separator: "\n"))\nSend corrected actions for my request: \"\(message)\". Keep the same view id."
        final = try await turn(correction, history: retryHistory, retryOf: first.failed)
        if final.failed.isEmpty { note(.agent, "✓ self-corrected on the retry") }
      }
      let say = final.say.isEmpty ? first.say : final.say
      turns[turns.count - 1].content = say.isEmpty ? "(done)" : say
      if !final.failed.isEmpty {
        turns[turns.count - 1].footnote = "\(final.failed.count) of \(final.total) changes didn't apply — see the logs."
      }
    } catch {
      note(.error, "agent: \(error.localizedDescription)")
      turns[turns.count - 1].content = "Couldn't reach the agent: \(error.localizedDescription)"
    }
  }
}
