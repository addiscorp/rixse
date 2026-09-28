// Listening feedback (APS 6, rixse#9): the mic's ring follows the live input
// level. Raw RMS from the input tap is normalized to 0…1 (−50 dB … −10 dB) and
// smoothed — fast attack, gentle release — so the ring breathes with speech
// instead of flickering per buffer. Input buffers arrive at ~40–60 fps, which
// is the animation rate.
import Foundation

public struct MicLevel: Equatable, Sendable {
  /// The smoothed level: 0 is silence, 1 is loud speech.
  public private(set) var level = 0.0
  /// Per-buffer smoothing factors: how fast the level rises and falls.
  public var attack = 0.45
  public var `release` = 0.12

  public init() {}

  /// One input buffer's RMS (0…1 full scale). Returns the smoothed level.
  @discardableResult
  public mutating func push(rms: Double) -> Double {
    let target = MicLevel.normalize(rms: rms)
    level += (target - level) * (target > level ? attack : `release`)
    return level
  }

  /// The ring's scale around the mic: rest size in silence, larger when loud.
  public var ringScale: Double { 1 + 0.45 * level }
  /// The ring's opacity: faint in silence, solid when loud.
  public var ringOpacity: Double { 0.3 + 0.55 * level }

  /// RMS (0…1 full scale) to a perceptual 0…1: −50 dB is a quiet room,
  /// −10 dB is loud speech into the mic.
  public static func normalize(rms: Double) -> Double {
    guard rms > 0 else { return 0 }
    let db = 20 * log10(rms)
    return min(1, max(0, (db + 50) / 40))
  }
}
