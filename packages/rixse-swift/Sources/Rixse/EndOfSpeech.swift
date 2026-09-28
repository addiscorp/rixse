// End-of-speech detection (APS 6, rixse#9): an utterance ends when the
// recognizer delivers a final result, or when the partial transcript has not
// changed for `silenceAfter` seconds — whichever comes first, and then the
// message sends by itself. Partial results that repeat the same text do NOT
// push the end out: on-device recognizers keep revising and re-emitting
// results during a pause, which is why a silence timer re-armed on every
// result never fires on a real phone. And with no words at all the utterance
// ends after `noSpeechAfter` seconds (rixse#13): the silence clock only arms
// on the first words, so a tap followed by silence would otherwise never end.
import Foundation

public struct EndOfSpeech: Equatable, Sendable {
  public enum Trigger: String, Equatable, Sendable {
    case final
    case silence
    case noSpeech
  }

  /// How long the transcript must be unchanged before the utterance ends.
  public var silenceAfter: TimeInterval
  /// How long the mic stays open with no words at all before giving up.
  public var noSpeechAfter: TimeInterval
  /// The latest transcript, and when it last changed (seconds from the start
  /// of the utterance).
  public private(set) var transcript = ""
  public private(set) var lastChange: TimeInterval = 0
  /// Once set, the decision is final.
  public private(set) var trigger: Trigger?

  public init(silenceAfter: TimeInterval = 1.2, noSpeechAfter: TimeInterval = 6) {
    self.silenceAfter = silenceAfter
    self.noSpeechAfter = noSpeechAfter
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

  /// Poll from the end timer: the utterance ends once the transcript has been
  /// unchanged for `silenceAfter` — or, with nothing heard at all, once
  /// `noSpeechAfter` has passed since the start. Empty partials re-emitted by
  /// the recognizer count as nothing heard.
  @discardableResult
  public mutating func shouldEnd(at t: TimeInterval) -> Trigger? {
    if let trigger { return trigger }
    if transcript.isEmpty {
      guard t >= noSpeechAfter else { return nil }
      trigger = .noSpeech
    } else {
      guard t - lastChange >= silenceAfter else { return nil }
      trigger = .silence
    }
    return trigger
  }
}
