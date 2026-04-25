# Conductor 16-Bug Triage

**Drafted:** 2026-04-25 by Trace (debugger agent) during v6.0+ planning pass.
**Source:** v6.0+ regroup memory + cross-checked against `packages/conductor/Sources/`.
**Status:** triage only — implementation lands in dedicated Conductor sprints.

User override of Jinx's "de-prioritize Conductor" recommendation: all 16 bugs to be planned properly. This is the canonical list; Symphony fixes in `docs/specs/conductor-symphony-fixes.md` are a separate spec and NOT folded in here.

---

## Severity tally

- **P0** (blocks usable): 2 — bugs 1, 2
- **P1** (significant degradation): 2 — bugs 3, 4
- **P2** (regular friction): 9 — bugs 5–13
- **P3** (cosmetic / edge): 3 — bugs 14–16

## Category distribution

| Category | Count | Bugs |
|----------|-------|------|
| bindings | 7 | 1, 5, 7, 11, 12, 15 |
| session-manager | 2 | 3, 6 |
| task-protocol | 1 | 2 |
| ui-state | 2 | 10, 14 |
| active-sentinel | 1 | 8 |
| other | 4 | 4, 9, 13, 16 |

---

## The 16 bugs

```yaml
- id: bug-1
  category: bindings
  severity: P0
  title: SharedCameraSession never calls start()
  symptom: Gaze input AND gesture input both completely non-functional; camera never activates
  suspected_cause: SharedCameraSession lifecycle wiring missing — start() never invoked from AppDelegate or input providers
  files:
    - packages/conductor/Sources/Conductor/Input/SharedCameraSession.swift
    - packages/conductor/Sources/Conductor/App/AppDelegate.swift
    - packages/conductor/Sources/Conductor/Input/GestureInput/VisionGestureProvider.swift
    - packages/conductor/Sources/Conductor/Input/GazeInput/VisionGazeProvider.swift
  confidence: high

- id: bug-2
  category: task-protocol
  severity: P0
  title: TaskRecord status<->timeline non-atomic
  symptom: Task status and timeline entries can desync after crash or rapid update; UI shows mismatched state
  suspected_cause: Two separate writes (status field + timeline append) without transactional boundary
  files: [packages/conductor/Sources/Conductor/Models/TaskRecord.swift]
  confidence: high

- id: bug-3
  category: session-manager
  severity: P1
  title: ProjectStore doesn't sync recents on checkpoint recovery
  symptom: After session recover, recent-projects list is stale or empty until manual project switch
  suspected_cause: paradigm_session_recover path bypasses ProjectStore.refreshRecents() / no observer wired
  files: [packages/conductor/Sources/Conductor/Models/ProjectStore.swift]
  confidence: medium

- id: bug-4
  category: other
  severity: P1
  title: ParadigmMCPClient lacks retry/backoff
  symptom: Transient MCP failure (server restart, timeout) leaves client in dead state; user must restart Conductor
  suspected_cause: Single-shot connect with no exponential backoff or reconnect loop
  files: [packages/conductor/Sources/Conductor/Integration/ParadigmMCPClient.swift]
  confidence: high

- id: bug-5
  category: bindings
  severity: P2
  title: Gaze calibration not persisted
  symptom: User must recalibrate gaze every Conductor launch
  suspected_cause: GazeCalibration computes offsets in-memory; no UserDefaults / file persistence on completion
  files:
    - packages/conductor/Sources/Conductor/Input/GazeInput/GazeCalibration.swift
    - packages/conductor/Sources/Conductor/UI/Views/GazeCalibrationView.swift
  confidence: high

- id: bug-6
  category: session-manager
  severity: P2
  title: Terminal sessions lost across restart
  symptom: Terminal cells disappear or fail to restore across Conductor restarts / window reflow
  suspected_cause: TerminalSessionManager state not persisted; session refs dropped on tile resize
  files:
    - packages/conductor/Sources/Conductor/Terminal/TerminalSessionManager.swift
    - packages/conductor/Sources/Conductor/Terminal/TerminalSession.swift
    - packages/conductor/Sources/Conductor/Terminal/TerminalSessionState.swift
  confidence: medium

- id: bug-7
  category: bindings
  severity: P2
  title: MediaPipe dependency check missing
  symptom: Silent failure when MediaPipe Python package not installed; no user-facing error
  suspected_cause: TODO at MediaPipeGazeProvider.swift:79 — never implemented
  files:
    - packages/conductor/Sources/Conductor/Input/GazeInput/MediaPipeGazeProvider.swift
    - packages/conductor/Sources/Conductor/Utils/DependencyChecker.swift
  confidence: high

- id: bug-8
  category: active-sentinel
  severity: P2
  title: Sentinel WS reconnect spam
  symptom: When Sentinel WS drops, client floods reconnect attempts; log noise + CPU
  suspected_cause: Reconnect loop without backoff or jitter; no max-attempt ceiling
  files: [packages/conductor/Sources/Conductor/Integration/SentinelWSClient.swift]
  confidence: high

- id: bug-9
  category: other
  severity: P2
  title: NoteRelay JSONL fragility
  symptom: Single malformed line in a Symphony JSONL breaks downstream relay reads
  suspected_cause: Whole-file parse rather than per-line tolerant decode; no skip-on-error
  files: [packages/conductor/Sources/Conductor/Symphony/NoteRelay.swift]
  confidence: medium

- id: bug-10
  category: ui-state
  severity: P2
  title: TilingEngine zero-area cells
  symptom: Layout produces 0-width or 0-height cells under certain split sequences; views vanish
  suspected_cause: Missing min-size clamp / division-by-near-zero on remainder distribution
  files: [packages/conductor/Sources/Conductor/Workspace/TilingEngine.swift]
  confidence: medium

- id: bug-11
  category: bindings
  severity: P2
  title: HotKeyBindingRegistry non-atomic save
  symptom: Crash during binding edit can corrupt bindings file; user loses all hotkeys
  suspected_cause: Direct in-place write rather than write-temp + atomic rename
  files: [packages/conductor/Sources/Conductor/Utils/HotKeyBindingRegistry.swift]
  confidence: high

- id: bug-12
  category: bindings
  severity: P2
  title: WhisperKit timeout
  symptom: Voice input hangs indefinitely if WhisperKit model load stalls
  suspected_cause: No timeout wrapper on async transcription / model-load Task
  files:
    - packages/conductor/Sources/Conductor/Input/VoiceInput/WhisperVoiceProvider.swift
    - packages/conductor/Sources/Conductor/Input/VoiceInput/AudioCapture.swift
  confidence: medium

- id: bug-13
  category: other
  severity: P2
  title: build-conductor entitlements stale-merge
  symptom: Built Conductor.app missing required entitlements (camera/mic/AX) post-install
  suspected_cause: build-conductor.sh skips or stale-merges Conductor.entitlements during codesign
  files:
    - packages/conductor/build-conductor.sh
    - packages/conductor/Conductor.entitlements
  confidence: medium

- id: bug-14
  category: ui-state
  severity: P3
  title: ContainerWindow deinit leak
  symptom: Memory grows over many open/close window cycles
  suspected_cause: Strong-ref retain cycle via observer/closure not torn down in deinit
  files: [packages/conductor/Sources/Conductor/App/ContainerWindow.swift]
  confidence: low

- id: bug-15
  category: bindings
  severity: P3
  title: EyebrowBindingRegistry race
  symptom: Concurrent register/unregister can drop a binding or double-fire
  suspected_cause: Mutable dict touched from multiple actors without serial queue / actor isolation
  files: [packages/conductor/Sources/Conductor/Input/EyebrowInput/EyebrowBindingRegistry.swift]
  confidence: low

- id: bug-16
  category: other
  severity: P3
  title: VERSION file validation
  symptom: Conductor can ship with malformed VERSION (whitespace/newline) breaking About panel
  suspected_cause: No trim/semver check on VERSION read at app start or build time
  files:
    - packages/conductor/VERSION
    - packages/conductor/build-conductor.sh
  confidence: low
```

---

## Recommended sprint plan

### Sprint A — P0 hotfix (target: 1-2 days)

Both P0s are blocking-class bugs and small-footprint. Ship as a Conductor patch immediately.

- **bug-1** SharedCameraSession.start() — Swift agent (concurrency/lifecycle expertise)
- **bug-2** TaskRecord atomicity — Swift + reviewer (transaction pattern)

### Sprint B — P1 + high-confidence P2 (target: 3-5 days)

Picks the bugs with `confidence: high` that aren't P3.

- **bug-3** ProjectStore checkpoint sync (P1)
- **bug-4** MCP retry/backoff (P1)
- **bug-5** Gaze calibration persistence (P2 high)
- **bug-7** MediaPipe dependency check (P2 high)
- **bug-8** Sentinel WS backoff (P2 high)
- **bug-11** HotKeyBindingRegistry atomic save (P2 high)

### Sprint C — Medium-confidence P2 (target: 1 week)

Need a code-read pass before sprint-sizing — confidence is `medium`.

- **bug-6** Terminal session persistence
- **bug-9** NoteRelay JSONL tolerance
- **bug-10** TilingEngine zero-area
- **bug-12** WhisperKit timeout
- **bug-13** build-conductor entitlements

### Sprint D — P3 cleanup (target: as time allows)

Low-confidence; bundle when convenient.

- **bug-14** ContainerWindow leak
- **bug-15** EyebrowBindingRegistry race
- **bug-16** VERSION validation

---

## Recommended team for Conductor sprints

Per project memory feedback (always-include-Loid for agent/team work, narrow-specialist principle):

- **Lead:** Swift (ecosystem agent, just added — owns Swift idiom + concurrency)
- **Debugger:** Trace (already produced this triage)
- **Reviewer:** Judge (code-quality, pair with Swift on Sprint A/B)
- **Loid (Forge):** session learning — pattern-extract from each sprint into Swift's notebook so cross-Conductor patterns compound

---

## Open questions before kicking off

1. **Symphony fixes overlap?** `docs/specs/conductor-symphony-fixes.md` has a separate fix list. Confirm: stay parallel, or fold Symphony fixes into one of these sprints?
2. **In-source markers?** Trace recommends writing `// FIXME(bug-N)` markers into the Swift sources so this triage survives outside lore. Approve?
3. **Sprint A timing?** P0s should ship as a hotfix release of Conductor (not bundled with paradigm CLI release cadence). Confirm?
4. **Confidence-low recheck?** P3s have low confidence on root cause; recommend cheap P3 read-through pass before Sprint D to confirm or downgrade scope.
