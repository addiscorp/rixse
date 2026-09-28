// End-of-speech detection (APS 6, rixse#9): an utterance ends when the
// recognizer delivers a final result, or when the partial transcript has not
// changed for `silenceAfter` seconds — whichever comes first, and then the
// message sends by itself. Partial results that repeat the same text do NOT
// push the end out: on-device recognizers keep revising and re-emitting
// results during a pause, which is why a silence timer re-armed on every
// result never fires on a real phone.
import Foundation

public struct EndOfSpeech: Equatable, Sendable {
  public enum Trigger: String, Equatable, Sendable {
    case final
    case silence
  }

  /// How long the transcript must be unchanged before the utterance ends.
  public var silenceAfter: TimeInterval
  /// The latest transcript, and when it last changed (seconds from the start
  /// of the utterance).
  public private(set) var transcript = ""
  public private(set) var lastChange: TimeInterval = 0
  /// Once set, the decision is final.
  public private(set) var trigger: Trigger?

  public init(silenceAfter: TimeInterval = 1.2) {
    self.silenceAfter = silenceAfter
  }

  /// A partial result. Returns true only when the text changed — the caller
  /// re-arms its silence timer on new words, never on a re-emitted result.
  @discardableResult
  public mutating func partial(_ text: String, at t: TimeInterval) -> Bool {
    guard trigger == nil, text != transcript else { return false }
    transcript = text
    lastChange = t
    return true
  }

  /// The recognizer's final result: the utterance ends immediately.
  @discardableResult
  public mutating func final(at t: TimeInterval) -> Trigger {
    if trigger == nil {
      trigger = .final
      lastChange = max(lastChange, t)
    }
    return trigger ?? .final
  }

  /// Poll from the silence timer: the utterance ends once the transcript has
  /// been unchanged for `silenceAfter`. With nothing heard yet it never ends.
  @discardableResult
  public mutating func shouldEnd(at t: TimeInterval) -> Trigger? {
    if let trigger { return trigger }
    guard !transcript.isEmpty, t - lastChange >= silenceAfter else { return nil }
    trigger = .silence
    return trigger
  }
}
