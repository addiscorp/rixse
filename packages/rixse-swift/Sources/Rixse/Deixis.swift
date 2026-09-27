// Voice input (APS 6): the recogniser's word timings pair each deictic word
// with the selection in effect when it was spoken — never the selection at the
// end of the utterance — and the message carries those pairings in APS 2's
// "The user has selected: …" form.
import Foundation

/// A word the recogniser heard, at seconds from the start of the utterance.
public struct SpokenWord: Equatable, Sendable {
  public var text: String
  public var at: TimeInterval
  public init(_ text: String, at: TimeInterval) {
    self.text = text
    self.at = at
  }
}

/// Every selection change while the mic was open, at seconds from the start of
/// the utterance. A select.clear records a nil selection.
public struct SelectionTimeline: Equatable, Sendable {
  public struct Entry: Equatable, Sendable {
    public var at: TimeInterval
    public var selection: Selection?
    public init(at: TimeInterval, selection: Selection?) {
      self.at = at
      self.selection = selection
    }
  }

  public private(set) var entries: [Entry] = []
  public init() {}

  public mutating func record(_ selection: Selection?, at: TimeInterval) {
    entries.append(Entry(at: at, selection: selection))
  }

  /// The selection in effect at `at`: the latest record not later than it.
  /// Before the first record (and after a clear) that is nil — nothing selected.
  public func selection(at: TimeInterval) -> Selection? {
    entries.filter { $0.at <= at }.last?.selection
  }
}

/// Words that point at the selection instead of naming a thing.
public let deicticWords: Set<String> = [
  "this", "these", "that", "those", "here", "there",
  "it", "its", "she", "her", "hers", "he", "him", "his", "they", "them", "their",
]

/// A deictic word paired with the selection in effect when it was spoken.
public struct DeicticPairing: Equatable, Sendable {
  public var word: String
  public var at: TimeInterval
  public var selection: Selection?
  public init(word: String, at: TimeInterval, selection: Selection?) {
    self.word = word
    self.at = at
    self.selection = selection
  }
}

/// The answer to APS 2's open question (APS 6): each "this" means the
/// selection at the moment it was said, so "compare this … and this" while
/// tapping two bars attaches both.
public func pairDeictics(words: [SpokenWord], timeline: SelectionTimeline) -> [DeicticPairing] {
  words.compactMap { word in
    let normalized = word.text.lowercased().trimmingCharacters(in: CharacterSet.alphanumerics.inverted)
    guard deicticWords.contains(normalized) else { return nil }
    return DeicticPairing(word: normalized, at: word.at, selection: timeline.selection(at: word.at))
  }
}

/// The names as the agent should read them ("Alien (movie)"); an edge item
/// ("a > b") reads as "the link a > b" without type prefixes.
public func selectionItemNames(_ items: [String]) -> String {
  items.map { item -> String in
    if item.contains(" > ") {
      return "the link \(item.replacingOccurrences(of: #"(person|movie|other):"#, with: "", options: .regularExpression))"
    }
    let type = item.split(separator: ":").first.map(String.init) ?? ""
    let name = item.replacingOccurrences(of: #"^(person|movie|other):"#, with: "", options: .regularExpression)
    return "\(name) (\(type))"
  }.joined(separator: ", ")
}

/// APS 2's intent sentence, attached to the user's words — not only the
/// state block, which the demo showed models ignore.
public func selectionIntentText(_ selection: Selection?) -> String {
  guard let selection, !selection.items.isEmpty else { return "The user had nothing selected." }
  return "The user has selected: \(selectionItemNames(selection.items))."
}

/// The voice turn's message: the transcript plus, for each deictic word, the
/// selection it refers to (APS 6). With no deictic words the transcript goes
/// as-is, and the caller attaches the end selection like a typed message.
public func voiceMessage(_ transcript: String, pairings: [DeicticPairing]) -> String {
  guard !pairings.isEmpty else { return transcript }
  let refs = pairings.enumerated().map { i, pairing in
    "\"\(pairing.word)\" #\(i + 1) — \(selectionIntentText(pairing.selection))"
  }
  return "\(transcript)\n(\(refs.joined(separator: " ")))"
}
