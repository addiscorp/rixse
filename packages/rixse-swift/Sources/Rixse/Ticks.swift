// Chart axis ticks for year-magnitude x values: round steps (1/2/5/10…), so
// ticks land on the years a person expects, and plain-integer labels — "2010",
// never "2,010".
import Foundation

/// Round year ticks spanning `xs`, at most `maxCount` of them.
public func yearTicks(_ xs: [Double], maxCount: Int = 7) -> [Double] {
  let years = xs.map { Int($0.rounded()) }
  guard let lo = years.min(), let hi = years.max() else { return [] }
  guard lo < hi else { return [Double(lo)] }
  let span = hi - lo
  let steps = [1, 2, 5, 10, 20, 25, 50, 100]
  let step = steps.first { span / $0 + 1 <= maxCount } ?? steps.last!
  let start = (lo / step) * step
  return stride(from: start, through: hi, by: step).map(Double.init)
}

/// One tick's label: the plain integer, no grouping separators.
public func yearTickText(_ x: Double) -> String {
  String(Int(x.rounded()))
}
