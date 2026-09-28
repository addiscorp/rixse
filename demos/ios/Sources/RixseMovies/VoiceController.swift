// Voice input (APS 6): on-device speech recognition with word timings, and
// the selection timeline while the mic is open. Audio never leaves the
// device — there is no cloud fallback, so if on-device recognition is not
// available the mic stays off and the UI says so. End of speech sends by
// itself (rixse#9): the EndOfSpeech detector ends the utterance on the
// recognizer's final result or ~1.2 s with no new words, whichever comes
// first, and the mic returns to idle the moment the audio stops.
import Foundation
import Speech
import AVFoundation
import Combine
import Rixse

/// One finished utterance: what was heard, when each word was said, and what
/// was selected as it was said.
struct VoiceUtterance {
  var transcript: String
  var words: [SpokenWord]
  var timeline: SelectionTimeline
  var speechEnd: Date
}

@MainActor
final class VoiceController: ObservableObject {
  enum Status: Equatable {
    case checking
    case ready
    case unavailable(String)
  }

  @Published private(set) var status: Status = .checking
  @Published private(set) var recording = false
  @Published private(set) var liveTranscript = ""
  @Published private(set) var heardSpeech = false
  /// The smoothed input level from the audio tap — the listening ring follows it.
  @Published private(set) var micLevel = MicLevel()

  /// End of speech (final result, or the transcript unchanged for
  /// EndOfSpeech.silenceAfter): the audio stops and the utterance is ready to
  /// send. The view sends it — there is no send-or-correct wait (rixse#9).
  var onEndOfSpeech: ((VoiceUtterance) -> Void)?

  private let recognizer = SFSpeechRecognizer(locale: Locale(identifier: "en-US"))
  private let audioEngine = AVAudioEngine()
  private var request: SFSpeechAudioBufferRecognitionRequest?
  private var recognitionTask: SFSpeechRecognitionTask?
  private var silenceTimer: Task<Void, Never>?
  private var selectionCancellable: AnyCancellable?

  private var detector = EndOfSpeech()
  private var startedAt = Date()
  private var words: [SpokenWord] = []
  private var timeline = SelectionTimeline()

  func prepare() async {
    guard status == .checking else { return }
    guard let recognizer, recognizer.isAvailable else {
      status = .unavailable("Speech recognition is not available on this device.")
      return
    }
    guard recognizer.supportsOnDeviceRecognition else {
      status = .unavailable("On-device speech recognition is not available here — audio would have to leave this device to be recognized, so the mic stays off. Long-press the mic to type instead.")
      return
    }
    let speech = await withCheckedContinuation { (cont: CheckedContinuation<SFSpeechRecognizerAuthorizationStatus, Never>) in
      SFSpeechRecognizer.requestAuthorization { cont.resume(returning: $0) }
    }
    guard speech == .authorized else {
      status = .unavailable("Speech recognition permission was denied — enable it in Settings to talk to the agent.")
      return
    }
    guard await AVAudioApplication.requestRecordPermission() else {
      status = .unavailable("Microphone permission was denied — enable it in Settings to talk to the agent.")
      return
    }
    status = .ready
  }

  func start(tracking store: MovieStore) {
    guard status == .ready, !recording else { return }
    liveTranscript = ""
    heardSpeech = false
    words = []
    timeline = SelectionTimeline()
    detector = EndOfSpeech()
    micLevel = MicLevel()
    let start = Date()
    startedAt = start

    // Every select.set / select.clear while the mic is open, with its time —
    // whichever author changed the selection.
    selectionCancellable = store.$state
      .map(\.selection)
      .removeDuplicates()
      .dropFirst()
      .sink { [weak self] selection in
        self?.timeline.record(selection, at: Date().timeIntervalSince(start))
      }

    let request = SFSpeechAudioBufferRecognitionRequest()
    request.requiresOnDeviceRecognition = true
    request.shouldReportPartialResults = true
    self.request = request

    do {
      let session = AVAudioSession.sharedInstance()
      try session.setCategory(.record, mode: .measurement, options: .duckOthers)
      try session.setActive(true, options: .notifyOthersOnDeactivation)
      let input = audioEngine.inputNode
      let format = input.outputFormat(forBus: 0)
      input.installTap(onBus: 0, bufferSize: 1024, format: format) { buffer, _ in
        request.append(buffer)
        // Live input level for the listening ring (~43 buffers/s at 44.1 kHz).
        if let channel = buffer.floatChannelData?[0] {
          let n = Int(buffer.frameLength)
          var sum = 0.0
          for i in 0..<n { let v = Double(channel[i]); sum += v * v }
          let rms = n > 0 ? (sum / Double(n)).squareRoot() : 0
          Task { @MainActor [weak self] in
            guard let self, self.recording else { return }
            self.micLevel.push(rms: rms)
          }
        }
      }
      audioEngine.prepare()
      try audioEngine.start()
    } catch {
      teardownAudio()
      status = .unavailable("The microphone could not start: \(error.localizedDescription)")
      return
    }
    recording = true

    recognitionTask = recognizer?.recognitionTask(with: request) { [weak self] result, error in
      Task { @MainActor [weak self] in
        guard let self else { return }
        if let result {
          let segments = result.bestTranscription.segments
          if !segments.isEmpty { self.heardSpeech = true }
          self.words = segments.map { SpokenWord($0.substring, at: $0.timestamp) }
          self.liveTranscript = result.bestTranscription.formattedString
          let t = Date().timeIntervalSince(self.startedAt)
          if result.isFinal {
            self.detector.final(at: t)
            self.endOfSpeech()
          } else if self.detector.partial(self.liveTranscript, at: t) {
            // New words: the silence clock starts over. A re-emitted partial
            // with the same text does not touch it.
            self.armSilenceTimer()
          }
        }
        if error != nil, self.recording {
          self.endOfSpeech() // keep whatever was heard; the view sends it
        }
      }
    }
  }

  private func armSilenceTimer() {
    silenceTimer?.cancel()
    let after = detector.silenceAfter
    silenceTimer = Task { [weak self] in
      try? await Task.sleep(for: .milliseconds(Int(after * 1000)))
      guard !Task.isCancelled, let self else { return }
      let t = Date().timeIntervalSince(self.startedAt)
      if self.detector.shouldEnd(at: t) != nil { self.endOfSpeech() }
    }
  }

  /// The detector decided: stop the audio and hand the utterance to the view.
  private func endOfSpeech() {
    guard recording else { return }
    if let heard = finish() { onEndOfSpeech?(heard) }
  }

  /// Stop listening and return what was heard — nil when there is nothing to send.
  @discardableResult
  func finish() -> VoiceUtterance? {
    guard recording else { return nil }
    let end = Date()
    teardownAudio()
    let transcript = liveTranscript.trimmingCharacters(in: .whitespacesAndNewlines)
    guard heardSpeech, !transcript.isEmpty else { return nil }
    return VoiceUtterance(transcript: transcript, words: words, timeline: timeline, speechEnd: end)
  }

  /// Stop listening and throw the utterance away.
  func cancel() {
    teardownAudio()
  }

  private func teardownAudio() {
    silenceTimer?.cancel()
    silenceTimer = nil
    selectionCancellable?.cancel()
    selectionCancellable = nil
    recognitionTask?.cancel()
    recognitionTask = nil
    request?.endAudio()
    request = nil
    if audioEngine.isRunning { audioEngine.stop() }
    audioEngine.inputNode.removeTap(onBus: 0)
    try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    // The mic returns to idle (not red) the moment the audio stops.
    recording = false
    micLevel = MicLevel()
  }
}
