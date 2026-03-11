// InputOrchestrator.swift — #input-orchestrator
// Central coordinator wiring all input streams together.
// Subscribes to eyebrow, voice, gesture, and gaze streams.
// Routes events through ActionRegistry to BufferEngine and dispatch.

import Foundation

/// Coordinates all input providers and routes their outputs to the buffer and dispatch targets.
@MainActor
final class InputOrchestrator: ObservableObject {

    // MARK: - Published State

    @Published private(set) var isRunning = false
    @Published private(set) var eyebrowEnabled = false
    @Published private(set) var videoActive = false
    @Published private(set) var voiceActive = false
    @Published private(set) var lastRecognizedGesture: RecognizedGesture?
    @Published private(set) var lastTranscription: String = ""
    @Published private(set) var lastError: String?

    // MARK: - Dependencies

    let buffer: BufferEngine
    let gazeRouter: GazeRouter
    let actionRegistry: ActionRegistry
    let eyebrowDetector: EyebrowDetector
    let eyebrowStateMachine: EyebrowStateMachineWrapper
    let voiceCoordinator: VoiceControlCoordinator
    let gazeZoneRouter: GazeZoneRouter
    let customGestureClassifier: CustomGestureClassifier
    let voiceCommandRegistry: VoiceCommandRegistry
    let voiceCommandMatcher: VoiceCommandMatcher

    // Input providers (optional — may not all be active)
    var gazeProvider: MediaPipeGazeProvider?
    var gestureProvider: VisionGestureProvider?
    var voiceProvider: WhisperVoiceProvider?

    // Workspace
    var workspaceManager: WorkspaceManager?

    // Dispatch
    let dispatchTarget: AXDispatchTarget

    // MARK: - Private

    private var inputTasks: [Task<Void, Never>] = []

    // MARK: - Init

    init(
        buffer: BufferEngine,
        gazeRouter: GazeRouter,
        dispatchTarget: AXDispatchTarget = AXDispatchTarget()
    ) {
        self.buffer = buffer
        self.gazeRouter = gazeRouter
        self.dispatchTarget = dispatchTarget
        self.actionRegistry = ActionRegistry()
        self.eyebrowDetector = EyebrowDetector()
        self.eyebrowStateMachine = EyebrowStateMachineWrapper()
        self.voiceCoordinator = VoiceControlCoordinator()
        self.gazeZoneRouter = GazeZoneRouter()
        self.customGestureClassifier = CustomGestureClassifier()
        self.voiceCommandRegistry = VoiceCommandRegistry()
        self.voiceCommandMatcher = VoiceCommandMatcher()
    }

    /// Configure workspace manager for grid-based gaze routing.
    func setWorkspaceManager(_ manager: WorkspaceManager) {
        self.workspaceManager = manager
        self.gazeZoneRouter.setWorkspaceManager(manager)
    }

    // MARK: - Lifecycle

    /// Start all input subscriptions. Call after providers are configured.
    func start() {
        guard !isRunning else { return }
        isRunning = true

        ConductorLog.component("input-orchestrator").info("Starting input orchestration")

        // Wire voice coordinator
        if let voiceProvider {
            voiceCoordinator.configure(voiceProvider: voiceProvider, buffer: buffer)
        }

        // Subscribe to eyebrow events
        if eyebrowEnabled {
            subscribeToEyebrowEvents()
            // Feed eyebrow frames from gaze provider to detector
            if let gazeProvider {
                subscribeToEyebrowFrames(gazeProvider)
            }
        }

        // Subscribe to gesture actions
        if let gestureProvider {
            subscribeToGestureActions(gestureProvider)
        }

        // Subscribe to voice transcriptions
        if let voiceProvider {
            subscribeToTranscriptions(voiceProvider)
        }

        // Subscribe to gaze points (use zone router if workspace is configured)
        if let gazeProvider {
            subscribeToGazePoints(gazeProvider)
        }

        // Subscribe to custom gesture actions
        customGestureClassifier.loadTemplates()
        if let gestureProvider {
            subscribeToCustomGestures(gestureProvider)
        }

        // Start all configured providers
        Task {
            // Start video providers (gaze + gesture share the camera pipeline)
            if gazeProvider != nil || gestureProvider != nil {
                await startVideoProviders()
            }

            // Start voice provider
            if voiceProvider != nil {
                ConductorLog.component("input-orchestrator").info("Starting voice provider...")
                try? await voiceProvider?.start()
                voiceActive = voiceProvider?.isActive ?? false
            }
        }
    }

    /// Stop all input subscriptions and providers.
    func stop() {
        for task in inputTasks {
            task.cancel()
        }
        inputTasks.removeAll()

        // Stop all providers
        gazeProvider?.stop()
        gestureProvider?.stop()
        voiceProvider?.stop()
        videoActive = false
        voiceActive = false

        isRunning = false
        ConductorLog.component("input-orchestrator").info("Input orchestration stopped")
    }

    /// Toggle eyebrow-based voice control.
    func setEyebrowEnabled(_ enabled: Bool) {
        eyebrowEnabled = enabled
        UserDefaults.standard.set(enabled, forKey: "eyebrowEnabled")
        if enabled && isRunning {
            subscribeToEyebrowEvents()
        }
    }

    // MARK: - Video (Gaze + Gesture) Lifecycle

    /// Start gaze and gesture providers.
    /// IMPORTANT: Both use the camera — gaze (Python/OpenCV) and gesture (AVCaptureSession)
    /// cannot share the camera on macOS. Gesture provider gets priority since it uses native
    /// Vision framework. Gaze provider only starts if gesture is disabled.
    /// Creates providers on demand if none exist.
    func startVideoProviders() async {
        lastError = nil

        // Gesture provider (native AVCaptureSession + Vision) — gets camera priority
        if gestureProvider == nil {
            gestureProvider = VisionGestureProvider()
            ConductorLog.component("input-orchestrator").info("Created gesture provider on demand")
            subscribeToGestureActions(gestureProvider!)
            subscribeToCustomGestures(gestureProvider!)
        }
        if let gestureProvider, !gestureProvider.isActive {
            ConductorLog.component("input-orchestrator").info("Starting gesture provider...")
            do {
                try await gestureProvider.start()
            } catch {
                lastError = "Gestures: \(error.localizedDescription)"
                ConductorLog.component("input-orchestrator").error("Gesture provider failed: \(error.localizedDescription)")
            }
        }

        // Gaze provider (Python subprocess with OpenCV) — only if gesture not using camera
        if gazeProvider == nil {
            gazeProvider = MediaPipeGazeProvider()
            ConductorLog.component("input-orchestrator").info("Created gaze provider on demand")
            subscribeToGazePoints(gazeProvider!)
            if eyebrowEnabled {
                subscribeToEyebrowFrames(gazeProvider!)
            }
        }
        if let gazeProvider, !gazeProvider.isActive {
            if gestureProvider?.isActive == true {
                // Camera is held by gesture provider — gaze can't use it
                lastError = "Gaze: Camera in use by gesture provider. Disable gestures for gaze tracking."
                ConductorLog.component("input-orchestrator")
                    .info("Skipping gaze provider — camera held by gesture provider")
            } else {
                ConductorLog.component("input-orchestrator").info("Starting gaze provider...")
                do {
                    try await gazeProvider.start()
                } catch {
                    lastError = "Gaze: \(error.localizedDescription)"
                    ConductorLog.component("input-orchestrator").error("Gaze provider failed: \(error.localizedDescription)")
                }
            }
        }

        videoActive = (gazeProvider?.isActive ?? false) || (gestureProvider?.isActive ?? false)
    }

    /// Stop gaze and gesture providers.
    func stopVideoProviders() {
        gazeProvider?.stop()
        gestureProvider?.stop()
        videoActive = false
        ConductorLog.component("input-orchestrator").info("Video providers stopped")
    }

    /// Toggle video (gaze + gesture) on/off.
    func toggleVideo() async {
        if videoActive {
            stopVideoProviders()
        } else {
            await startVideoProviders()
        }
    }

    // MARK: - Voice Lifecycle

    /// Start the voice provider. Creates one on demand if none exists.
    func startVoiceProvider() async {
        if voiceProvider == nil {
            voiceProvider = WhisperVoiceProvider()
            ConductorLog.component("input-orchestrator").info("Created voice provider on demand")
            subscribeToTranscriptions(voiceProvider!)
        }
        guard let voiceProvider, !voiceProvider.isActive else { return }
        ConductorLog.component("input-orchestrator").info("Starting voice provider...")
        try? await voiceProvider.start()
        voiceActive = voiceProvider.isActive
    }

    /// Stop the voice provider.
    func stopVoiceProvider() {
        voiceProvider?.stop()
        voiceActive = false
        ConductorLog.component("input-orchestrator").info("Voice provider stopped")
    }

    /// Toggle voice on/off.
    func toggleVoice() async {
        if voiceActive {
            stopVoiceProvider()
        } else {
            await startVoiceProvider()
        }
    }

    // MARK: - Input Subscriptions

    private func subscribeToEyebrowEvents() {
        let task = Task { [weak self] in
            guard let self else { return }
            for await event in self.eyebrowDetector.eventStream {
                guard !Task.isCancelled else { break }
                if let action = self.eyebrowStateMachine.process(event) {
                    self.lastRecognizedGesture = RecognizedGesture(
                        source: "eyebrow",
                        name: Self.eyebrowEventName(event),
                        actionName: ActionRegistry.nameFromAction(action)
                    )
                    await self.executeAction(action)
                }
            }
        }
        inputTasks.append(task)
    }

    private static func eyebrowEventName(_ event: EyebrowEvent) -> String {
        switch event {
        case .leftRaise: return "Left Eyebrow Raise"
        case .leftLower: return "Left Eyebrow Lower"
        case .rightRaise: return "Right Eyebrow Raise"
        case .rightLower: return "Right Eyebrow Lower"
        }
    }

    private func subscribeToGestureActions(_ provider: VisionGestureProvider) {
        let task = Task { [weak self] in
            guard let self else { return }
            for await gestureAction in provider.gestureStream {
                guard !Task.isCancelled else { break }
                if let action = self.actionRegistry.actionForGesture(gestureAction) {
                    self.lastRecognizedGesture = RecognizedGesture(
                        source: "gesture",
                        name: Self.gestureName(gestureAction),
                        actionName: ActionRegistry.nameFromAction(action)
                    )
                    await self.executeAction(action)
                }
            }
        }
        inputTasks.append(task)
    }

    private static func gestureName(_ gesture: GestureAction) -> String {
        switch gesture {
        case .cursorLeft: return "Swipe Left"
        case .cursorRight: return "Swipe Right"
        case .deleteBackward: return "Pinch"
        case .undo: return "Fist"
        case .redo: return "Open Palm"
        case .send: return "Two-Finger Tap"
        case .none: return "None"
        }
    }

    private func subscribeToTranscriptions(_ provider: WhisperVoiceProvider) {
        let task = Task { [weak self] in
            guard let self else { return }
            for await result in provider.transcriptionStream {
                guard !Task.isCancelled else { break }

                // Update last transcription for status display
                self.lastTranscription = result.text

                // Check for voice commands in the transcription
                let matchResult = self.voiceCommandMatcher.match(
                    transcription: result.text,
                    commands: self.voiceCommandRegistry.commands
                )

                if let action = matchResult.action {
                    // Fire the matched command action
                    await self.executeAction(action)
                    ConductorLog.signal("voice-command-matched")
                        .info("Voice command matched: \(matchResult.matchedPhrase ?? "")")

                    // Append remaining text (if any) to buffer
                    if !matchResult.remainingText.isEmpty {
                        self.buffer.append(matchResult.remainingText)
                    }
                } else {
                    // No command found — append all text to buffer
                    self.buffer.append(result.text)
                }

                ConductorLog.flow("eyebrow-voice-control")
                    .info("Transcription processed: \(result.text.prefix(60))")
            }
        }
        inputTasks.append(task)
    }

    private func subscribeToCustomGestures(_ provider: VisionGestureProvider) {
        // Feed hand pose frames to custom gesture classifier
        let handPoseTask = Task { [weak self] in
            guard let self else { return }
            for await frame in provider.handPoseStream {
                guard !Task.isCancelled else { break }
                self.customGestureClassifier.processFrame(frame)
            }
        }
        inputTasks.append(handPoseTask)

        // Subscribe to custom gesture actions
        let actionTask = Task { [weak self] in
            guard let self else { return }
            for await action in self.customGestureClassifier.actionStream {
                guard !Task.isCancelled else { break }
                self.lastRecognizedGesture = RecognizedGesture(
                    source: "custom",
                    name: "Custom Gesture",
                    actionName: ActionRegistry.nameFromAction(action)
                )
                await self.executeAction(action)
            }
        }
        inputTasks.append(actionTask)
    }

    private func subscribeToEyebrowFrames(_ provider: MediaPipeGazeProvider) {
        let task = Task { [weak self] in
            guard let self else { return }
            for await frame in provider.eyebrowStream {
                guard !Task.isCancelled else { break }
                self.eyebrowDetector.process(frame)
            }
        }
        inputTasks.append(task)
    }

    private func subscribeToGazePoints(_ provider: MediaPipeGazeProvider) {
        let task = Task { [weak self] in
            guard let self else { return }
            for await point in provider.gazePointStream {
                guard !Task.isCancelled else { break }
                // Update both routers
                self.gazeRouter.updateGazePoint(point)
                self.gazeZoneRouter.updateGazePoint(point)
            }
        }
        inputTasks.append(task)
    }

    // MARK: - Action Execution

    /// Execute a unified ConductorAction.
    func executeAction(_ action: ConductorAction) async {
        ConductorLog.component("input-orchestrator")
            .info("Executing action: \(String(describing: action))")

        switch action {
        case .voiceArm:
            voiceCoordinator.arm()

        case .voiceStart:
            voiceCoordinator.startRecording()

        case .voiceStop:
            voiceCoordinator.stopRecording()

        case .send:
            await dispatchToTarget()

        case .undo:
            buffer.undo()

        case .redo:
            buffer.redo()

        case .cursorLeft(let granularity):
            let count = granularity == .word ? 5 : 1
            buffer.moveCursorLeft(by: count)

        case .cursorRight(let granularity):
            let count = granularity == .word ? 5 : 1
            buffer.moveCursorRight(by: count)

        case .deleteBackward(let granularity):
            let count = granularity == .word ? 5 : 1
            buffer.deleteBackward(count: count)

        case .switchToCell:
            // Handled by GazeZoneRouter (Sprint 10)
            break

        case .toggleVideo:
            await toggleVideo()

        case .toggleVoice:
            await toggleVoice()

        case .muteVideo:
            stopVideoProviders()

        case .muteVoice:
            stopVoiceProvider()

        case .unmuteVideo:
            await startVideoProviders()

        case .unmuteVoice:
            await startVoiceProvider()

        case .custom(let name):
            ConductorLog.component("input-orchestrator")
                .info("Custom action: \(name)")
        }
    }

    // MARK: - Dispatch

    private func dispatchToTarget() async {
        guard let target = gazeRouter.currentTarget else {
            ConductorLog.component("input-orchestrator").info("No target for dispatch")
            return
        }

        let text = buffer.flush()
        guard !text.isEmpty else { return }

        do {
            try await dispatchTarget.sendText(text, to: target, submit: true)
            ConductorLog.signal("buffer-dispatched")
                .info("Dispatched \(text.count) chars to \(target.title)")
        } catch {
            ConductorLog.component("input-orchestrator")
                .error("Dispatch failed: \(error.localizedDescription)")
            buffer.append(text)
        }
    }
}

// MARK: - Recognized Gesture

/// A gesture or input that was recognized and acted upon — for the confirmation overlay.
struct RecognizedGesture: Identifiable, Equatable {
    let id = UUID()
    let source: String        // "gesture", "custom", "voice", "eyebrow"
    let name: String           // e.g. "Fist", "Pinch", "Custom: Wave"
    let actionName: String     // e.g. "Undo", "Delete", "Send"
    let timestamp: Date = .now
}

// MARK: - EyebrowStateMachine Wrapper

/// @MainActor wrapper around the value-type EyebrowStateMachine.
@MainActor
final class EyebrowStateMachineWrapper: ObservableObject {
    @Published private(set) var state: EyebrowStateMachine.State = .idle
    private var machine = EyebrowStateMachine()

    func process(_ event: EyebrowEvent) -> ConductorAction? {
        let action = machine.process(event)
        state = machine.state
        return action
    }

    func reset() {
        machine.reset()
        state = .idle
    }
}
