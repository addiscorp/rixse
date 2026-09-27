// Rotation acceptance (rixse#2): run the full acceptance script, then rotate
// the simulator and check the size ladder holds — columns come from the
// container width, the components' sizes do not change.
import XCTest

final class RotateTests: XCTestCase {
  func testRotateChangesColumnsNotSizes() throws {
    let app = XCUIApplication()
    app.launchArguments = ["-script", "acceptance"]
    app.launch()

    // Wait for the scripted run to finish (hidden status text, set by the runner).
    let status = app.staticTexts["scriptStatus"]
    XCTAssertTrue(status.waitForExistence(timeout: 30), "no script status — did the app launch with -script?")
    let done = NSPredicate(format: "label == 'done' OR label == 'error'")
    expectation(for: done, evaluatedWith: status)
    waitForExpectations(timeout: 420)
    XCTAssertEqual(status.label, "done", "the acceptance script did not finish: \(status.label)")
    sleep(2)

    // Portrait: the stat (small) takes a fraction of the row.
    let statTitle = app.staticTexts["Titanic Gross"]
    XCTAssertTrue(statTitle.waitForExistence(timeout: 10), "the stat component is missing in portrait")
    let portraitWidth = statTitle.frame.width / app.frame.width
    attach(XCUIScreen.main.screenshot(), named: "portrait")

    XCUIDevice.shared.orientation = .landscapeLeft
    sleep(3)

    // Landscape: more columns — the same small stat takes a smaller fraction
    // of the wider container, and it is still there (its size did not change).
    XCTAssertTrue(statTitle.waitForExistence(timeout: 10), "the stat component is missing in landscape")
    let landscapeWidth = statTitle.frame.width / app.frame.width
    attach(XCUIScreen.main.screenshot(), named: "landscape")
    XCTAssertLessThan(landscapeWidth, portraitWidth - 0.05,
      "the small stat should take a smaller share of the row in landscape (\(landscapeWidth)) than portrait (\(portraitWidth))")
    XCTAssertTrue(app.staticTexts["Top 10 Movies by Box Office"].exists, "the bar chart is missing in landscape")

    XCUIDevice.shared.orientation = .portrait
    sleep(2)
  }

  private func attach(_ screenshot: XCUIScreenshot, named name: String) {
    let attachment = XCTAttachment(screenshot: screenshot)
    attachment.name = name
    attachment.lifetime = .keepAlways
    add(attachment)
  }
}
