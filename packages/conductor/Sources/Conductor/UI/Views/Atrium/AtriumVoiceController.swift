// AtriumVoiceController.swift — #atrium-voice
// Keyword-driven dictation loop for the ATRIUM composer, modeled on a-aloud's
// reply-window loop. REUSES Conductor's existing WhisperVoiceProvider (WhisperKit
// CoreML STT + AVCaptureSession mic) — no new STT dependency.
//
// RUNTIME FAILURE FIXED (founder live-test):
//   Previously, clicking the mic called `provider.start()` directly, which calls
//   `AudioCapture.setup()` → that constructs an `AVCaptureDeviceInput` WITHOUT
//   ever calling `AVCaptureDevice.requestAccess(for:.audio)`. On a fresh install
//   the TCC microphone authorization is `.notDetermined`, so no system prompt
//   ever appeared and capture silently failed (no audio, no transcription).
//
//   FIX: the mic path now (a) checks AVCaptureDevice.authorizationStatus(for:
//   .audio); (b) on .notDetermined, AWAITS AVCaptureDevice.requestAccess (this
//   triggers the TCC prompt — Info.plist has NSMicrophoneUsageDescription);
//   (c) on .denied/.restricted surfaces a `blocked` state + offers to open
//   System Settings; (d) on authorized, loads the WhisperKit model (showing a
//   `loading` state) and starts the continuous transcription loop. Every step is
//   logged via ConductorLog.component("atrium-voice") so the founder can diagnose
//   from Console with NO screen.
//
// State machine (founder spec):
//   off  --click-->  requesting -->  loading  -->  armed  --hear "respond"-->  composing
//   composing --hear "send it"--> sending --(auto)--> armed
//   composing --hear "scratch that"/"never mind"--> (clear draft) armed
//   any --click--> off
//   any (auth denied) --> blocked
//
// In `armed` the mic is open but transcripts are only scanned for the WAKE
// keyword. In `composing`, subsequent speech transcribes LIVE into the bound
// draft (keyword text stripped). The controller never owns the draft text — it
// pushes updates through callbacks so the SwiftUI composer stays the source of
// truth and the founder can still type/clip mid-dictation.

import AVFoundation
import AppKit
import Foundation

/// Voice activation state for the ATRIUM composer's mic affordance.
enum AtriumVoiceState: Equatable {
    /// Mic closed, not listening.
    case off
    /// Asking the OS for microphone permission (TCC prompt in flight).
    case requesting
    /// Authorized — loading the WhisperKit model before listening.
    case loading
    /// Permission denied/restricted — user must enable mic in System Settings.
    case blocked
    /// Mic open, scanning transcript for the wake keyword.
    case armed
    /// Wake heard — speech streams into the draft.
    case composing
    /// Send keyword heard — submitting, transient before returning to armed.
    case sending
}

/// Owns the voice provider + keyword loop that drives the ATRIUM composer draft.
@MainActor
final class AtriumVoiceController: ObservableObject {

    // MARK: - Keyword Defaults (constants now; settings UI later)

    /// Wake keyword: transitions armed → composing.
    static let wakeKeyword = "respond"
    /// Send phrase: transitions composing → sending → armed.
    static let sendKeyword = "send it"
    /// Cancel phrases: clear the draft and return to armed.
    static let cancelKeywords = ["scratch that", "never mind", "nevermind"]

    // MARK: - Published State

    @Published private(set) var state: AtriumVoiceState = .off

    // MARK: - Callbacks (composer owns the draft)

    /// Append/replace dictated text into the live draft. Receives the cleaned
    /// transcript fragment to append (already keyword-stripped).
    var onDraftAppend: ((String) -> Void)?
    /// Clear the draft (cancel phrase heard).
    var onDraftClear: (() -> Void)?
    /// Submit the current draft (send phrase heard).
    var onSubmit: (() -> Void)?

    // MARK: - Private

    private let provider = WhisperVoiceProvider()
    private var listenTask: Task<Void, Never>?
    private let log = ConductorLog.component("atrium-voice")

    // MARK: - Toggle

    /// Click handler for the voice icon: off/blocked → start; anything else → off.
    func toggle() {
        log.info("Mic button clicked — current state: \(String(describing: self.state))")
        switch state {
        case .off:
            Task { await self.beginListening() }
        case .blocked:
            // A second click while blocked opens System Settings so the founder
            // can flip the toggle, then they can click again.
            log.info("Mic blocked — opening System Settings › Privacy › Microphone")
            openMicrophoneSettings()
        default:
            disarm()
        }
    }

    // MARK: - Permission + Start (THE fix)

    /// Full mic-button path: authorize → load model → start listening.
    private func beginListening() async {
        guard state == .off else {
            log.info("beginListening ignored — not in .off (state: \(String(describing: self.state)))")
            return
        }

        // (a) Check current authorization.
        let status = AVCaptureDevice.authorizationStatus(for: .audio)
        log.info("Microphone authorization status: \(Self.describe(status))")

        switch status {
        case .authorized:
            await loadAndArm()

        case .notDetermined:
            // (b) Trigger the TCC prompt and AWAIT the user's decision.
            state = .requesting
            log.info("Requesting microphone access (TCC prompt)…")
            let granted = await AVCaptureDevice.requestAccess(for: .audio)
            log.info("requestAccess result: granted=\(granted)")
            if granted {
                await loadAndArm()
            } else {
                state = .blocked
                log.error("Microphone access DENIED by user at prompt")
            }

        case .denied, .restricted:
            // (c) Already blocked — surface the blocked state. The next click
            // opens System Settings.
            state = .blocked
            log.error("Microphone access \(Self.describe(status)) — surfacing blocked state")

        @unknown default:
            state = .blocked
            log.error("Microphone authorization unknown — surfacing blocked state")
        }
    }

    /// Load the WhisperKit model (if needed), start audio capture + the continuous
    /// transcription loop, then enter `armed`.
    private func loadAndArm() async {
        state = .loading
        log.info("Authorized — starting voice provider + loading model")

        do {
            try await provider.start()
            log.info("Voice provider started (audio capture configured)")
        } catch {
            log.error("Voice provider failed to start: \(error.localizedDescription)")
            state = .off
            return
        }

        // Begin continuous chunked transcription. WhisperKit model loads lazily
        // on the first chunk inside the provider (logged under
        // #whisper-voice-provider).
        provider.startContinuous()
        log.info("Continuous transcription started — entering armed")
        state = .armed
        log.info("Voice armed — listening for wake keyword '\(Self.wakeKeyword)'")

        listenTask = Task { [weak self] in
            guard let self else { return }
            for await result in self.provider.transcriptionStream {
                if Task.isCancelled { break }
                self.log.debug("Transcript chunk: \"\(result.text.prefix(80))\"")
                self.handle(transcript: result.text)
            }
            self.log.info("Transcription stream ended")
        }
    }

    // MARK: - Lifecycle

    private func disarm() {
        listenTask?.cancel()
        listenTask = nil
        provider.stopContinuous()
        provider.stop()
        state = .off
        log.info("Voice disarmed")
    }

    // MARK: - System Settings deep-link

    private func openMicrophoneSettings() {
        let url = URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone")!
        NSWorkspace.shared.open(url)
    }

    // MARK: - Transcript Handling

    private func handle(transcript raw: String) {
        let text = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }

        switch state {
        case .off, .requesting, .loading, .blocked, .sending:
            // Ignore transcripts unless actively armed/composing.
            return

        case .armed:
            // Only listen for the wake keyword. Everything before it is discarded;
            // anything after it begins the dictation.
            if let after = Self.textAfterKeyword(text, keyword: Self.wakeKeyword) {
                state = .composing
                log.info("Wake keyword '\(Self.wakeKeyword)' heard — composing")
                if !after.isEmpty {
                    onDraftAppend?(after)
                }
            }

        case .composing:
            // Cancel phrases take priority — clear and re-arm.
            if Self.containsKeyword(text, anyOf: Self.cancelKeywords) {
                onDraftClear?()
                state = .armed
                log.info("Cancel phrase heard — draft cleared, re-armed")
                return
            }

            // Send phrase — submit everything before it, then re-arm.
            if let before = Self.textBeforeKeyword(text, keyword: Self.sendKeyword) {
                if !before.isEmpty {
                    onDraftAppend?(before)
                }
                state = .sending
                log.info("Send phrase '\(Self.sendKeyword)' heard — submitting")
                onSubmit?()
                // Brief settle, then return to armed for the next turn.
                state = .armed
                return
            }

            // Plain dictation — append to the draft. Strip a stray leading wake
            // keyword if WhisperKit re-emitted it in the same chunk.
            let cleaned = Self.stripLeadingKeyword(text, keyword: Self.wakeKeyword)
            if !cleaned.isEmpty {
                log.debug("Dictation appended: \"\(cleaned.prefix(60))\"")
                onDraftAppend?(cleaned)
            }
        }
    }

    // MARK: - Authorization helper

    private static func describe(_ status: AVAuthorizationStatus) -> String {
        switch status {
        case .authorized: return "authorized"
        case .denied: return "denied"
        case .restricted: return "restricted"
        case .notDetermined: return "notDetermined"
        @unknown default: return "unknown"
        }
    }

    // MARK: - Keyword Grammar (forgiving, word-boundary anchored)
    //
    // Concept mirrors a-aloud's keyword-grammar: case/punctuation-normalized,
    // anchored on word boundaries (so "respond" does not fire inside
    // "responsible"), supports multi-word phrases, matches the LAST occurrence.
    // Implemented independently (no copied text).

    /// Normalize: lowercase, strip punctuation to spaces, collapse whitespace.
    private static func normalize(_ s: String) -> String {
        let lowered = s.lowercased()
        let scalars = lowered.unicodeScalars.map { scalar -> Character in
            if CharacterSet.alphanumerics.contains(scalar) || scalar == " " {
                return Character(scalar)
            }
            return " "
        }
        return String(scalars)
            .split(separator: " ", omittingEmptySubsequences: true)
            .joined(separator: " ")
    }

    /// Tokenize into normalized words.
    private static func words(_ s: String) -> [String] {
        normalize(s).split(separator: " ").map(String.init)
    }

    /// Find the index range of the LAST occurrence of `keyword` (which may be a
    /// multi-word phrase) within `words`, anchored to whole words. Returns the
    /// (startIndex, endIndexExclusive) word range, or nil.
    private static func lastKeywordRange(in tokens: [String], keyword: String) -> (Int, Int)? {
        let kw = words(keyword)
        guard !kw.isEmpty, tokens.count >= kw.count else { return nil }
        var found: (Int, Int)? = nil
        var i = 0
        while i <= tokens.count - kw.count {
            if Array(tokens[i..<i + kw.count]) == kw {
                found = (i, i + kw.count) // keep scanning → last occurrence wins
            }
            i += 1
        }
        return found
    }

    /// True if any of `keywords` appears (whole-word) in `text`.
    static func containsKeyword(_ text: String, anyOf keywords: [String]) -> Bool {
        let tokens = words(text)
        return keywords.contains { lastKeywordRange(in: tokens, keyword: $0) != nil }
    }

    /// If `keyword` occurs, return the normalized text AFTER its last occurrence
    /// (the dictation that follows the wake word). Returns nil if not present.
    static func textAfterKeyword(_ text: String, keyword: String) -> String? {
        let tokens = words(text)
        guard let (_, end) = lastKeywordRange(in: tokens, keyword: keyword) else { return nil }
        return tokens[end...].joined(separator: " ")
    }

    /// If `keyword` occurs, return the normalized text BEFORE its last occurrence
    /// (the dictation to submit). Returns nil if not present.
    static func textBeforeKeyword(_ text: String, keyword: String) -> String? {
        let tokens = words(text)
        guard let (start, _) = lastKeywordRange(in: tokens, keyword: keyword) else { return nil }
        return tokens[..<start].joined(separator: " ")
    }

    /// Remove a single leading occurrence of `keyword` if the chunk starts with it.
    static func stripLeadingKeyword(_ text: String, keyword: String) -> String {
        let tokens = words(text)
        let kw = words(keyword)
        guard tokens.count >= kw.count, Array(tokens[0..<kw.count]) == kw else {
            return tokens.joined(separator: " ")
        }
        return tokens[kw.count...].joined(separator: " ")
    }
}
