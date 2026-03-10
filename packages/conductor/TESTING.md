# Paradigm Conductor — Testing & Status Guide

> Living document. Updated as features mature from stubbed → functional → polished.

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                     PARADIGM CONDUCTOR                          │
│                                                                 │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────────────────┐  │
│  │ INPUT LAYER  │  │ BUFFER       │  │ DISPATCH              │  │
│  │              │  │              │  │                       │  │
│  │ Voice ───────┼─>│ TextBuffer   │  │ GazeRouter            │  │
│  │ (WhisperKit) │  │ (staged text │  │ (gaze → window map)   │  │
│  │              │  │  + undo/redo)│  │         │              │  │
│  │ Gestures ────┼─>│              │──>│ ContextEnricher       │  │
│  │ (Apple Vis.) │  │              │  │ (paradigm-mcp + git)  │  │
│  │              │  │              │  │         │              │  │
│  │ Keyboard ────┼─>│              │  │ WindowTarget          │  │
│  │ (NSTextField)│  │              │  │ (AX text injection)   │  │
│  └──────────────┘  └──────────────┘  └───────────────────────┘  │
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ WINDOW MANAGER                                           │   │
│  │                                                          │   │
│  │ InstanceDetector ─── WindowArranger ─── StatusTracker    │   │
│  │ (find CC windows)   (tile/snap)        (idle/busy/done)  │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ OVERLAY UI (SwiftUI)                                     │   │
│  │                                                          │   │
│  │ BufferView ── InstanceList ── GestureHUD ── NotifBubbles │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ INTEGRATION BRIDGE                                       │   │
│  │                                                          │   │
│  │ ParadigmMCPClient ── SentinelWSClient ── GitMonitor      │   │
│  └──────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

## Feature Status

| Feature | Sprint | Status | Blocker / Notes |
|---------|--------|--------|-----------------|
| NSPanel floating overlay | S0 | **Functional** | — |
| Menu bar icon + quit/prefs | S0 | **Functional** | — |
| Permissions onboarding UI | S0 | **Functional** | — |
| 7 platform abstraction protocols | S0 | **Functional** | Signatures only; macOS implementations below |
| BufferEngine (undo/redo/cursor) | S1 | **Functional** | 9 unit tests passing |
| Keyboard input (NSTextField) | S1 | **Functional** | — |
| Window detection (AX + CG) | S1 | **Functional** | Requires Accessibility permission |
| Session file watcher | S1 | **Functional** | Watches `~/.conductor/sessions/` for `/conduct` registrations |
| AX text dispatch | S1 | **Functional** | Requires Accessibility permission; clipboard fallback wired |
| Instance list UI | S1 | **Functional** | — |
| Buffer view UI | S1 | **Functional** | — |
| WhisperKit voice transcription | S2 | **Stubbed** | Dependency commented out in `Package.swift`; transcription method is a placeholder |
| Audio capture (AVCaptureSession) | S2 | **Functional** | Requires Microphone permission |
| Push-to-talk mode | S2 | **Stubbed** | Hotkey wired, recording start/stop wired, but no transcription backend |
| Apple Vision gesture detection | S3 | **Functional** | 15fps VNDetectHumanHandPoseRequest; requires Camera permission |
| Gesture classifier | S3 | **Functional** | Swipe, pinch, fist, open palm, two-finger tap |
| Gesture state machine | S3 | **Functional** | Debounce, cooldowns, sustained-pinch word delete |
| Gesture HUD | S3 | **Functional** | Shows detected hand state + action label |
| MediaPipe gaze provider | S4 | **Functional** | Python subprocess; requires `mediapipe` + `opencv-python` |
| 5-point gaze calibration | S4 | **Stubbed** | Affine math done; calibration UI overlay not built |
| Kalman filter smoothing | S4 | **Functional** | 2D position + velocity state |
| Gaze dwell targeting | S4 | **Functional** | 500ms default dwell; manual fallback via click |
| paradigm-mcp client (stdio) | S5 | **Functional** | Requires `paradigm-mcp` on PATH |
| Git diff monitor | S5 | **Functional** | 10s polling with 10s cache TTL |
| Context enrichment assembly | S5 | **Functional** | Assembles status + symbols + git diff; 30s cache |
| Sentinel WebSocket client | S5 | **Functional** | Connects to `ws://localhost:3838/ws` |
| Window tiling (4 layouts) | S6 | **Functional** | Focused, side-by-side, 3-up, grid; requires Accessibility |
| Status tracker | S6 | **Functional** | Heuristic: title-change detection |
| Notification bubbles | S6 | **Functional** | Per-instance status icon + agent count badge |
| Agent count badge | S6 | **Functional** | Reads `.paradigm/tasks/*.yaml` |
| Global hotkeys (CGEvent tap) | S7 | **Functional** | Requires Accessibility permission |
| Settings panel | S7 | **Functional** | 3 tabs: General, Input, Context |

### Status Legend

- **Functional** — Code compiles and is wired end-to-end. May need permissions or external deps to actually run.
- **Stubbed** — Structure and interfaces exist, but the core logic is a placeholder awaiting a dependency or further work.

## Prerequisites

### System Requirements

- macOS 14+ (Sonoma or later)
- Xcode Command Line Tools (`xcode-select --install`)
- A webcam + microphone (built into every Mac)

### Optional Dependencies

| Dependency | Required For | Install |
|------------|-------------|---------|
| Python 3 | Gaze tracking | Pre-installed on macOS or `brew install python3` |
| `mediapipe` | Gaze tracking | `pip3 install mediapipe opencv-python` |
| `paradigm-mcp` | Context enrichment | `npm install -g @a-company/paradigm` |
| Sentinel server | Real-time events | `paradigm sentinel` (port 3838) |

## Build & Launch

### Quick build (from package directory)

```bash
cd packages/conductor

# Debug build (faster, larger binary)
swift build

# Release build (optimized, 753KB arm64)
swift build -c release

# Launch directly
.build/release/conductor
```

### Via CLI (requires paradigm CLI rebuild)

```bash
# Rebuild the paradigm CLI to pick up the new conductor command
cd packages/paradigm && npm run build

# Then from any directory:
paradigm conductor

# Force rebuild the native binary:
paradigm conductor --build

# Verbose build output:
paradigm conductor --build --verbose
```

### Run tests

```bash
cd packages/conductor
swift test
```

Currently: 9 tests in `BufferEngineTests` (append, delete, undo, redo, flush, cursor movement, cursor bounds, delete-at-beginning, insert-at-cursor).

## Permissions Setup

Conductor requires three macOS permissions. The app shows an onboarding flow on first launch, but you can also configure them manually.

### Accessibility (required for core functionality)

This is the most important permission. Without it, window detection and text dispatch won't work.

1. Open **System Settings > Privacy & Security > Accessibility**
2. Click the `+` button
3. Navigate to the conductor binary:
   - If running from terminal: add **Terminal.app** (or your terminal emulator)
   - If running the binary directly: add `packages/conductor/.build/release/conductor`
4. Toggle it **on**
5. Restart Conductor

### Camera (required for gestures + gaze)

macOS prompts automatically on first camera access. Click **Allow** when prompted.

To reset if denied: **System Settings > Privacy & Security > Camera** > toggle Conductor on.

### Microphone (required for voice)

macOS prompts automatically on first mic access. Click **Allow** when prompted.

To reset if denied: **System Settings > Privacy & Security > Microphone** > toggle Conductor on.

## Manual Testing Scenarios

### 1. Overlay and Permissions (S0)

**Steps:**
1. Build and launch Conductor
2. Verify the floating panel appears on the right side of the screen
3. Verify the menu bar icon (waveform) appears
4. If permissions are missing, verify the onboarding flow shows
5. Grant Accessibility permission, restart Conductor
6. Verify the status indicator shows "Ready" or "No targets"

**Expected:** Panel floats above all windows, stays visible when other apps are focused, draggable by background.

### 2. Session Registration via `/conduct` (S1)

**Steps:**
1. Launch Conductor (`paradigm conductor`)
2. In a Claude Code terminal, run `/conduct` (or call `paradigm_conductor_register`)
3. Conductor should instantly detect the session (within 1-2 seconds)
4. The instance appears in the list with its project directory and branch

**Expected:** Registration file written to `~/.conductor/sessions/{pid}.json`. Conductor's `SessionFileWatcher` picks it up via dispatch source + poll fallback.

**Verifying manually:**
```bash
# Check registration files
ls ~/.conductor/sessions/

# Read a session file
cat ~/.conductor/sessions/*.json

# Clean up stale sessions (dead PIDs)
# This happens automatically, but you can check:
paradigm_conductor_list --clean
```

**Troubleshooting:**
- Session not showing → Check `~/.conductor/sessions/` exists and contains a `.json` file
- Stale sessions lingering → Call `paradigm_conductor_list` with `clean: true`
- Unregister → Call `paradigm_conductor_unregister` from the session

### 3. Buffer + Window Detection + Manual Send (S1)

**Steps:**
1. Open 2+ terminal windows running `claude` (Claude Code)
2. Launch Conductor
3. Register sessions via `/conduct` in each terminal, or wait 2 seconds for AX detection
4. Click an instance to target it (green target icon appears)
5. Type text in the buffer area
6. Press **Cmd+Return** or click **Send**
7. Verify the text appears in the targeted Claude Code terminal

**Expected:** Text is injected into the correct terminal. If AX injection fails, clipboard fallback fires (briefly replaces clipboard contents, pastes, then restores).

**Detection sources:** Conductor merges two detection methods:
- **AX detection** — scans terminal windows for "claude" in titles (passive, every 2s)
- **File registration** — reads `~/.conductor/sessions/*.json` from `/conduct` (active, near-instant)

**Troubleshooting:**
- No instances detected → Run `/conduct` in each Claude Code session, or check Accessibility permission for AX detection
- Send does nothing → Check Accessibility permission; try the clipboard fallback path
- Wrong window targeted → Click the correct instance in the list
- Duplicate instances → Both sources detected the same session; deduplication works by PID and project dir

### 4. Hand Gestures (S3)

**Prerequisites:** Camera permission granted.

**Steps:**
1. Launch Conductor with camera permission
2. Type some text in the buffer
3. Hold your hand up in front of the webcam
4. Try each gesture:
   - **Swipe left/right** → cursor moves
   - **Pinch (thumb + index)** → deletes character; hold for word delete
   - **Fist** → undo
   - **Open palm** (after fist) → redo
   - **Two-finger tap** (index + middle, ring + pinky curled) → send

**Expected:** Gesture HUD updates with the detected hand state. Buffer responds to gesture actions.

**Troubleshooting:**
- No detection → Check Camera permission; ensure good lighting; face palm toward camera
- Jittery recognition → Adjust `detectionFPS` in settings (lower = more stable)

### 4. Gaze Tracking (S4)

**Prerequisites:** Camera permission, Python 3, `pip3 install mediapipe opencv-python`.

**Steps:**
1. Enable gaze in Conductor settings
2. Open 2+ Claude Code windows side by side
3. Look at one window for 500ms → it should auto-target
4. Look at another window → target switches

**Expected:** Gaze point is smoothed by Kalman filter. Dwell selection switches target after configurable duration (default 500ms).

**Troubleshooting:**
- Gaze not starting → Check `python3` is on PATH; check `mediapipe` installed
- Inaccurate → Calibration UI is stubbed; currently uses simple linear mapping. Adjust `measurementNoise` in KalmanFilter for more/less smoothing.

### 5. Context Enrichment (S5)

**Prerequisites:** `paradigm-mcp` on PATH, project with `.paradigm/` setup.

**Steps:**
1. Open a Claude Code window in a Paradigm-enabled project
2. Target that instance in Conductor
3. Type a message in the buffer
4. Send it
5. Check the Claude Code terminal — the dispatched text should include a `<!-- Paradigm Context -->` block with project status, relevant symbols, and git diff summary

**Expected:** Context block appended after the user's text. Toggle enrichment off in settings to send raw text.

### 6. Window Tiling (S6)

**Prerequisites:** Accessibility permission, 2+ Claude Code windows.

**Steps:**
1. Open 2-4 Claude Code windows
2. Use hotkeys:
   - **Cmd+1** → Focused (one window fills screen minus Conductor panel)
   - **Cmd+2** → Side by side
   - **Cmd+3** → 3-up (large left, two stacked right)
   - **Cmd+4** → Grid
3. Verify windows snap to the layout

**Expected:** Windows tile with 4px gaps, leaving 340px on the right for the Conductor panel.

## Known Limitations

| Area | Limitation | Planned Fix |
|------|-----------|-------------|
| Voice | WhisperKit not integrated — dependency commented out | Uncomment in `Package.swift`, wire `WhisperKit.transcribe()` in `WhisperVoiceProvider.transcribeBufferedAudio()` |
| Gaze calibration | Calibration UI overlay not built — uses simple linear mapping | Build SwiftUI overlay showing 5 target dots; collect samples per point |
| Window detection | Only detects windows with "claude" in the title | Add configurable title patterns in settings; detect by process name |
| Status tracking | Heuristic (title-change) is unreliable | Use AX tree diffing or read terminal output buffer |
| Agent count | Reads `.paradigm/tasks/` file count — rough proxy | Parse YAML for actual active/in-progress status |
| Text injection | AX setValue doesn't work on all terminals | Test per-terminal strategies; robust clipboard fallback already wired |
| Binary distribution | Builds from source; not bundled in npm package | Universal binary (arm64 + x86_64) in `paradigm promote` pipeline |
| Hotkeys | Key codes are hardcoded | Make configurable in settings with a key recorder |

## File Map

```
packages/conductor/
├── Package.swift                          # Swift Package manifest
├── .purpose                               # Paradigm symbol registry (27 components, 5 flows, etc.)
├── .gitignore
├── TESTING.md                             # This file
│
├── Sources/Conductor/
│   ├── App/
│   │   ├── ConductorApp.swift             # @main entry point
│   │   ├── AppDelegate.swift              # Menu bar, panel lifecycle
│   │   ├── ConductorPanel.swift           # NSPanel configuration
│   │   └── PermissionsManager.swift       # Camera/Mic/Accessibility checks
│   │
│   ├── Input/
│   │   ├── InputProvider.swift            # Base protocol (@MainActor)
│   │   ├── VoiceInput/
│   │   │   ├── VoiceInputProvider.swift   # Protocol
│   │   │   ├── WhisperVoiceProvider.swift # WhisperKit implementation (stubbed)
│   │   │   └── AudioCapture.swift         # AVCaptureSession mic pipeline
│   │   ├── GestureInput/
│   │   │   ├── GestureInputProvider.swift # Protocol
│   │   │   ├── VisionGestureProvider.swift# Apple Vision hand detection
│   │   │   ├── GestureClassifier.swift    # Joint positions → actions
│   │   │   └── GestureStateMachine.swift  # Debounce, cooldowns
│   │   ├── GazeInput/
│   │   │   ├── GazeTrackingProvider.swift # Protocol
│   │   │   ├── MediaPipeGazeProvider.swift# Python subprocess + embedded script
│   │   │   ├── GazeCalibration.swift      # 5-point affine mapping
│   │   │   └── KalmanFilter.swift         # 2D coordinate smoothing
│   │   └── KeyboardInput/
│   │       └── KeyboardInputHandler.swift # NSTextField delegate
│   │
│   ├── Buffer/
│   │   └── BufferEngine.swift             # Text buffer + undo/redo + cursor
│   │
│   ├── WindowManager/
│   │   ├── ClaudeCodeDetectorProtocol.swift # Protocol
│   │   ├── ClaudeCodeDetector.swift       # AX + CGWindowList implementation
│   │   ├── WindowArrangerProtocol.swift   # Protocol
│   │   ├── WindowArranger.swift           # AX setFrame, 4 layouts
│   │   └── StatusTracker.swift            # Idle/processing/finished heuristic
│   │
│   ├── Dispatch/
│   │   ├── DispatchTargetProtocol.swift   # Protocol
│   │   ├── AXDispatchTarget.swift         # AX setValue + clipboard fallback
│   │   ├── ContextEnricherProtocol.swift  # Protocol
│   │   ├── ContextEnricher.swift          # MCP + git context assembly
│   │   └── GazeRouter.swift               # Gaze → target mapping
│   │
│   ├── Integration/
│   │   ├── ParadigmMCPClient.swift        # stdio JSON-RPC to paradigm-mcp
│   │   ├── GitMonitor.swift               # Poll git diff --stat
│   │   └── SentinelWSClient.swift         # WebSocket client
│   │
│   ├── UI/Views/
│   │   ├── MainOverlayView.swift          # Root view (composes all sub-views)
│   │   ├── BufferView.swift               # Text editor + send button
│   │   ├── InstanceListView.swift         # Detected CC instances
│   │   ├── GestureHUDView.swift           # Hand state feedback
│   │   ├── NotificationBubbleView.swift   # Per-instance status bubbles
│   │   ├── PermissionsOnboardingView.swift# Permission request flow
│   │   └── SettingsPanelView.swift        # Preferences (3 tabs)
│   │
│   ├── Models/
│   │   ├── ClaudeCodeInstance.swift        # Window ID, PID, frame, status
│   │   ├── GestureAction.swift            # Cursor, delete, undo, redo, send
│   │   ├── TranscriptionResult.swift      # Text, isFinal, confidence
│   │   ├── EnrichedPayload.swift          # Text + context for dispatch
│   │   ├── WindowLayout.swift             # focused, sideBySide, threeUp, grid
│   │   └── VoiceMode.swift                # pushToTalk, continuous
│   │
│   ├── Utils/
│   │   ├── ConductorLog.swift             # os.Logger with Paradigm symbols
│   │   ├── HotKeyManager.swift            # CGEvent tap global hotkeys
│   │   └── Permissions.swift              # PermissionRequirement enum
│   │
│   └── Info.plist                         # Bundle config, usage descriptions
│
└── Tests/ConductorTests/
    └── BufferEngineTests.swift            # 9 tests: append, delete, undo, redo, etc.
```

## Paradigm Symbols

Full registry in `.purpose`. Summary:

- **27 components** (`#conductor-app`, `#text-buffer`, `#window-detector`, `#whisper-voice-provider`, `#vision-gesture-provider`, `#mediapipe-gaze-provider`, `#paradigm-mcp-client`, `#window-arranger`, `#hotkey-manager`, etc.)
- **5 flows** (`$voice-to-dispatch`, `$gesture-edit`, `$gaze-target`, `$context-enrichment`, `$window-tiling`)
- **6 gates** (`^camera-permission`, `^microphone-permission`, `^accessibility-permission`, `^model-downloaded`, `^gaze-calibrated`, `^mcp-available`)
- **10 signals** (`!buffer-dispatched`, `!instance-detected`, `!instance-lost`, `!transcription-ready`, `!gesture-recognized`, `!gaze-target-changed`, `!context-enriched`, `!status-changed`, `!agent-count-changed`, `!layout-applied`)
- **4 aspects** (`~local-only`, `~zero-cost`, `~platform-abstracted`, `~resource-conscious`)
