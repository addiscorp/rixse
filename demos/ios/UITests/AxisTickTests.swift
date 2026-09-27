// Axis-tick acceptance (rixse#7): the line chart's x-axis years are plain
// integers — a tick reads "2010", never "2,010". Numeric tick labels are not
// in the accessibility tree, so the component exposes the axis summary (the
// same ticks/yearTickText strings the axis draws) as its accessibility label.
import XCTest

final class AxisTickTests: XCTestCase {
  func testLineChartYearTicksArePlainIntegers() throws {
    let app = XCUIApplication()
    app.launchArguments = ["-script", "lineticks"]
    app.launch()

    let status = app.staticTexts["scriptStatus"]
    XCTAssertTrue(status.waitForExistence(timeout: 30), "no script status — did the app launch with -script?")
    let done = NSPredicate(format: "label == 'done' OR label == 'error'")
    expectation(for: done, evaluatedWith: status)
    waitForExpectations(timeout: 300)
    XCTAssertEqual(status.label, "done", "the lineticks script did not finish: \(status.label)")

    let axis = app.descendants(matching: .any)
      .matching(NSPredicate(format: "identifier BEGINSWITH 'lineXAxis-'"))
      .firstMatch
    XCTAssertTrue(axis.waitForExistence(timeout: 10), "the line chart's x-axis summary is missing")
    XCTAssertTrue(axis.label.contains("2010"), "expected a tick reading 2010, got: \(axis.label)")
    XCTAssertFalse(axis.label.contains("2,010"), "a grouped year label (2,010) leaked through: \(axis.label)")
  }
}
