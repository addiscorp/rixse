// End-of-speech and mic-level (rixse#9, APS 6): the detector is fed scripted
// partial results with timestamps and must end at the right time — never while
// words are still arriving — and the level model's ring must follow scripted
// RMS values. Pure data, so these run without a mic. (Mutating calls sit
// outside #expect, which evaluates its expression immutably.)
import Testing
import Rixse

@Suite struct EndOfSpeechTests {
  @Test func endsAfterSilenceOnceWordsStopArriving() {
    var eos = EndOfSpeech(silenceAfter: 1.2)
    // Words keep arriving: no end while they do.
    let changed1 = eos.partial("top", at: 0.4)
    let early1 = eos.shouldEnd(at: 1.0)
    let changed2 = eos.partial("top ten", at: 0.9)
    let early2 = eos.shouldEnd(at: 1.5)
    let changed3 = eos.partial("top ten movies", at: 1.6)
    let tooSoon = eos.shouldEnd(at: 2.7) // 1.1 s — too soon
    let end = eos.shouldEnd(at: 2.81) // 1.2 s after the last word (past it — fp)
    #expect(changed1 && changed2 && changed3)
    #expect(early1 == nil && early2 == nil && tooSoon == nil)
    #expect(end == .silence)
  }

  @Test func repeatedIdenticalPartialsDoNotPushTheEndOut() {
    // What happens on-device during a pause: the recognizer keeps re-emitting
    // the same partial. A timer re-armed on every result never fires — the red
    // mic that never sends. Only new words re-arm.
    var eos = EndOfSpeech(silenceAfter: 1.2)
    let changed = eos.partial("zoe saldana movies", at: 1.0)
    var reArmed = false
    var endedEarly = false
    var t = 1.2
    while t < 2.2 {
      reArmed = reArmed || eos.partial("zoe saldana movies", at: t)
      endedEarly = endedEarly || eos.shouldEnd(at: t) != nil
      t += 0.2
    }
    let sameAgain = eos.partial("zoe saldana movies", at: 2.4)
    let end = eos.shouldEnd(at: 2.4)
    #expect(changed)
    #expect(!reArmed && !endedEarly && !sameAgain)
    #expect(end == .silence)
  }

  @Test func aFinalResultEndsImmediately() {
    var eos = EndOfSpeech()
    _ = eos.partial("compare this", at: 0.8)
    let trigger = eos.final(at: 1.0)
    let polled = eos.shouldEnd(at: 1.01) // already decided
    // Late partials change nothing once decided.
    let changed = eos.partial("compare this with that", at: 1.2)
    #expect(trigger == .final)
    #expect(polled == .final)
    #expect(!changed)
    #expect(eos.transcript == "compare this")
  }

  @Test func nothingHeardNeverEnds() {
    var eos = EndOfSpeech(silenceAfter: 1.2)
    let end = eos.shouldEnd(at: 10)
    #expect(end == nil)
    #expect(eos.trigger == nil)
  }
}

@Suite struct MicLevelTests {
  @Test func silenceKeepsTheRingAtRestSize() {
    var level = MicLevel()
    for _ in 0..<50 { level.push(rms: 0) }
    #expect(level.level == 0)
    #expect(level.ringScale == 1)
  }

  @Test func loudSpeechGrowsTheRing() {
    var level = MicLevel()
    for _ in 0..<20 { level.push(rms: 0.5) } // ≈ −6 dB, above the −10 dB top
    #expect(level.level > 0.95)
    #expect(level.ringScale > 1.4)
  }

  @Test func theRingSettlesBackAfterSpeech() {
    var level = MicLevel()
    for _ in 0..<20 { level.push(rms: 0.5) }
    let loud = level.ringScale
    for _ in 0..<60 { level.push(rms: 0.0001) } // ≈ −80 dB: silence
    #expect(level.ringScale < loud)
    #expect(level.level < 0.05)
  }

  @Test func normalizationIsPerceptual() {
    #expect(MicLevel.normalize(rms: 0) == 0)
    #expect(MicLevel.normalize(rms: 0.003) < 0.05) // ≈ −50 dB, a quiet room
    #expect(MicLevel.normalize(rms: 0.35) == 1) // ≈ −9 dB, loud speech
  }
}
