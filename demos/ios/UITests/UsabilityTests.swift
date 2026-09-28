// Usability acceptance (rixse#9, APS 6): run Sami's two steps — "top 10
// movies by box office", then "Zoe Saldana movies" — and check the canvas
// owns the screen: the newest answer is fully visible and clear of the mic,
// and no transcript bubble lingers once the reply has faded. The voiceLine
// expectations are registered up front and latch on the poller's first
// sighting — the reply can land within a second and fades four seconds
// later, faster than a post-hoc query gets there.
import XCTest

final class UsabilityTests: XCTestCase {
  func testNewestAnswerIsFullyVisibleAndTheConversationFades() throws {
    let app = XCUIApplication()
    app.launchArguments = ["-script", "usability"]
    app.launch()

    let status = app.staticTexts["scriptStatus"]
    XCTAssertTrue(status.waitForExistence(timeout: 30), "no script status — did the app launch with -script?")
    let voiceLine = app.descendants(matching: .any)["voiceLine"]
    let lineShown = expectation(for: NSPredicate(format: "exists == true"), evaluatedWith: voiceLine)
    let done = expectation(for: NSPredicate(format: "label == 'done' OR label == 'error'"), evaluatedWith: status)
    wait(for: [done, lineShown], timeout: 420)
    XCTAssertEqual(status.label, "done", "the usability script did not finish: \(status.label)")

    // (a) The component the agent just changed is fully on screen, and the
    // mic's frame does not touch it. viewportDebug reads "v1:bar|v2:table>v2".
    let debug = app.staticTexts["viewportDebug"]
    XCTAssertTrue(debug.waitForExistence(timeout: 5))
    let parts = debug.label.split(separator: ">")
    let changed = parts.count > 1 ? String(parts[1]) : ""
    XCTAssertFalse(changed.isEmpty || changed == "-", "the agent changed nothing: \(debug.label)")
    let card = app.descendants(matching: .any)["component.\(changed)"]
    XCTAssertTrue(card.waitForExistence(timeout: 10), "the new component (\(changed)) is not on the page: \(debug.label)")
    let mic = app.descendants(matching: .any)["micButton"]
    XCTAssertTrue(mic.waitForExistence(timeout: 10), "the floating mic is missing")
    let win = app.windows.element(boundBy: 0).frame
    let nav = app.navigationBars.firstMatch.frame
    XCTAssertTrue(win.contains(card.frame), "the new component is not fully visible: card \(card.frame) in window \(win)")
    XCTAssertFalse(card.frame.intersects(nav), "the new component is under the header: card \(card.frame), nav \(nav)")
    XCTAssertFalse(card.frame.intersects(mic.frame), "the new component is under the mic: card \(card.frame), mic \(mic.frame)")
    attach(XCUIScreen.main.screenshot(), named: "newest answer")

    // (b) The line was seen during the run (latched above); now it must be
    // gone — the reply faded ~4 s after landing, and no transcript bubble
    // stays on the canvas.
    let lineGone = expectation(for: NSPredicate(format: "exists == false"), evaluatedWith: voiceLine)
    wait(for: [lineGone], timeout: 10)
    attach(XCUIScreen.main.screenshot(), named: "after the fade")
  }

  private func attach(_ screenshot: XCUIScreenshot, named name: String) {
    let attachment = XCTAttachment(screenshot: screenshot)
    attachment.name = name
    attachment.lifetime = .keepAlways
    add(attachment)
  }
}
