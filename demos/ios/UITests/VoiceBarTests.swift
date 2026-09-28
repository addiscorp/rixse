// Voice-bar acceptance (rixse#7, APS 6): the mic is the input surface, and
// the keyboard is one gesture away. On the simulator on-device recognition
// is unavailable, so the mic explains itself instead of recording; the
// long-press keyboard path works everywhere. Since rixse#9 the conversation
// gets out of the way: the lasting transcript lives in Settings, and the one
// ephemeral line above the mic (covered by UsabilityTests) fades by itself.
import XCTest

final class VoiceBarTests: XCTestCase {
  func testMicIsTheInputAndKeyboardIsOneGestureAway() throws {
    let app = XCUIApplication()
    app.launch()

    // If the simulator can recognize on-device, the first mic use may ask
    // for speech/microphone permission — accept it.
    addUIInterruptionMonitor(withDescription: "permissions") { alert in
      for label in ["Allow", "OK", "Continue"] where alert.buttons[label].exists {
        alert.buttons[label].tap()
        return true
      }
      return false
    }

    // The composer is gone; the floating mic is the input. The mic is an
    // Image with a gesture, not a Button — query .any like the chart labels.
    let mic = app.descendants(matching: .any)["micButton"]
    XCTAssertTrue(mic.waitForExistence(timeout: 15), "the floating mic is missing")
    XCTAssertFalse(app.textFields["keyboardField"].exists, "a keyboard is visible by default")

    // Long-press the mic: the keyboard opens on request.
    mic.press(forDuration: 1.2)
    app.tap() // let the interruption monitor fire if an alert showed
    let field = app.textFields["keyboardField"]
    XCTAssertTrue(field.waitForExistence(timeout: 5), "long-pressing the mic did not open the keyboard")

    // Type and send: the keyboard closes after sending.
    field.tap()
    field.typeText("hello from the keyboard")
    app.buttons["Send"].tap()
    XCTAssertFalse(field.waitForExistence(timeout: 5), "the keyboard stayed open after sending")

    // The lasting transcript is in Settings: the turn is in the history.
    // (The ephemeral line above the mic is covered by UsabilityTests — the
    // reply can land within a second and fade four seconds later, faster
    // than this test's queries get there.)
    app.buttons["settingsButton"].tap()
    XCTAssertTrue(app.staticTexts["hello from the keyboard"].waitForExistence(timeout: 10), "the typed message never landed in the conversation history")
  }
}
