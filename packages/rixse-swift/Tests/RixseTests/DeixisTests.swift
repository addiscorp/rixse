// Voice deictic pairing (APS 6) and plain year ticks (rixse#7): a scripted
// utterance with word timings plus taps at known times must attach the right
// selection to each "this". Pure data, so it runs without a mic.
import Testing
import Rixse

@Suite struct DeixisTests {
  @Test func eachThisGetsTheSelectionInEffectWhenItWasSpoken() {
    var timeline = SelectionTimeline()
    timeline.record(Selection(view: "v1", items: ["movie:Alien"]), at: 0.5)
    timeline.record(Selection(view: "v1", items: ["movie:Aliens", "movie:Alien"]), at: 1.5)
    timeline.record(nil, at: 3.0) // select.clear

    let words = [
      SpokenWord("compare", at: 1.0),
      SpokenWord("this", at: 1.2),
      SpokenWord("with", at: 2.0),
      SpokenWord("this", at: 2.5),
      SpokenWord("and", at: 3.4),
      SpokenWord("that", at: 3.6),
    ]
    let pairings = pairDeictics(words: words, timeline: timeline)

    #expect(pairings.map(\.word) == ["this", "this", "that"])
    // The first "this" was said at 1.2 s, before the second tap at 1.5 s —
    // it must NOT get the selection that was in effect at the end.
    #expect(pairings[0].selection == Selection(view: "v1", items: ["movie:Alien"]))
    #expect(pairings[1].selection == Selection(view: "v1", items: ["movie:Aliens", "movie:Alien"]))
    #expect(pairings[2].selection == nil)

    let message = voiceMessage("compare this with this and that", pairings: pairings)
    #expect(message.hasPrefix("compare this with this and that"))
    #expect(message.contains("\"this\" #1 — The user has selected: Alien (movie)."))
    #expect(message.contains("\"this\" #2 — The user has selected: Aliens (movie), Alien (movie)."))
    #expect(message.contains("\"that\" #3 — The user had nothing selected."))
  }

  @Test func aWordBeforeTheFirstTapHasNothingSelected() {
    var timeline = SelectionTimeline()
    timeline.record(Selection(view: "v1", items: ["movie:Alien"]), at: 1.0)
    let pairings = pairDeictics(words: [SpokenWord("this", at: 0.2)], timeline: timeline)
    #expect(pairings.count == 1)
    #expect(pairings[0].selection == nil)
  }

  @Test func noDeicticWordsLeavesTheTranscriptAlone() {
    let words = [SpokenWord("top", at: 0), SpokenWord("10", at: 0.3), SpokenWord("movies", at: 0.5)]
    let message = voiceMessage("top 10 movies", pairings: pairDeictics(words: words, timeline: SelectionTimeline()))
    #expect(message == "top 10 movies")
  }

  @Test func punctuationAndCaseDoNotHideADeicticWord() {
    let pairings = pairDeictics(words: [SpokenWord("This.", at: 0.2)], timeline: SelectionTimeline())
    #expect(pairings.count == 1)
    #expect(pairings[0].word == "this")
  }

  @Test func yearTicksLandOnRoundYearsWithPlainIntegerLabels() {
    let ticks = yearTicks((2000...2020).map(Double.init))
    #expect(ticks.contains(2010))
    #expect(ticks.allSatisfy { $0.truncatingRemainder(dividingBy: 5) == 0 })
    #expect(yearTickText(2010) == "2010")
    #expect(!yearTickText(2010).contains(","))
  }

  @Test func yearTicksStayWithinTheCap() {
    let ticks = yearTicks([1927, 2026])
    #expect(ticks.count <= 7)
    #expect(ticks.first! <= 1927)
    #expect(ticks.last! >= 2020)
  }
}
