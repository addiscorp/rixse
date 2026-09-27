// Voice-bar acceptance (rixse#7, APS 6): the mic is the input surface, and
// the keyboard is one gesture away. On the simulator on-device recognition
// is unavailable, so the mic explains itself instead of recording; the
// long-press keyboard path works everywhere.
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

    // Type and send: the message lands in the transcript and the keyboard closes.
    field.tap()
    field.typeText("hello from the keyboard")
    app.buttons["Send"].tap()
    XCTAssertTrue(app.staticTexts["hello from the keyboard"].waitForExistence(timeout: 5), "the typed message never landed in the transcript")
    XCTAssertFalse(field.waitForExistence(timeout: 5), "the keyboard stayed open after sending")
  }
}
