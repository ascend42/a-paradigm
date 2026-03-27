# Conductor Workspace: Embedded Terminal Sessions

> From floating overlay to unified AI development workspace.
> Spec authored March 27, 2026. Team: Apex (architect), Jinx (devil's advocate), DX (developer experience).

---

## Vision

Conductor becomes a full macOS workspace application: left sidebar for agent orchestration panels, main area for embedded terminal sessions running Claude Code. Sessions auto-link to Symphony on spawn. The sidebar shows real-time thread activity from the focused session. Users manage their entire multi-agent, multi-project workflow from one window.

---

## Team Positions (Recorded for Lore)

**Apex (architect):** SwiftTerm native embedding. 4 sprints, ~8-12 days. Full PTY support, NSViewRepresentable wrapper, session manager, Symphony auto-link. "This is the endgame architecture."

**Jinx (devil's advocate):** "You are building an IDE when the product is an orchestrator." SwiftTerm is not battle-tested for workspace-class use. OSC 133 support is incomplete. Performance risk with 4+ terminals alongside gaze/audio/Symphony. Counter-proposals: (A) Window capture mode via CGWindowListCreateImage, (B) AX buffer bridge, (C) WKWebView + xterm.js (battle-tested by 50M VS Code users).

**DX (developer experience):** The killer feature is the team thread sidebar, not the terminal grid. Keep overlay mode permanently. Keyboard-first with Cmd+ shortcuts. MVP sidebar = Sessions + Team Thread + Task Dashboard. "Conductor is not a better terminal. It is a better way to work with AI agents across projects."

**Decision:** Start with Apex's Sprint 0 as an empirical spike (1-2 days). If SwiftTerm handles Claude Code without issues, proceed. If edge cases surface, pivot to xterm.js (Jinx Option C).

---

## Architecture

### Window Modes (Three Tiers)

| Mode | Window | Use Case |
|------|--------|----------|
| **Overlay** | ConductorPanel (floating) | Lightweight monitoring alongside external terminals |
| **Workspace** | ContainerWindow (evolved) | Embedded terminals — the new default |
| Legacy Container | ContainerWindow (info cards) | Deprecated, kept for fallback |

### View Hierarchy (Workspace Mode)

```
ContainerWindow (NSWindow, .regular activation policy)
  NSHostingView
    ContainerView (SwiftUI)
      HStack
        sidebarPanel (320pt, collapsible, resizable 240-500pt)
          Tab: Sessions — session list, new session, recent projects
          Tab: Team — Symphony threads filtered to active session, agent roster, approvals
          Tab: Monitor — Sentinel live feed, agent health, context usage
          Tab: Settings — appearance, hotkeys, Symphony config
        Divider (drag handle)
        tiledTerminalArea
          TilingEngine layout → ForEach CellFrame
            TerminalCellView
              SessionToolbarView (project, status dot, split/close)
              TerminalViewRepresentable (SwiftTerm LocalProcessTerminalView)
      StatusBarView (active session name, Claude Code status)
```

### Session Model

```swift
struct TerminalSession: Identifiable {
    let id: String
    let projectPath: String
    var label: String
    var status: SessionStatus        // .starting, .running, .idle, .exited(code)
    var shellPID: pid_t?
    var claudePID: pid_t?
    var symphonyAgentId: String?
    let createdAt: Date
    var cellId: String?              // TilingEngine cell reference
}
```

### Symphony Auto-Link (Embedded Sessions)

No AX detection needed — Conductor owns the process:

1. `TerminalSessionManager.createSession()` spawns shell via SwiftTerm PTY
2. Background task polls for `claude` child process (~1-2s after shell init)
3. Once found, calls `AgentPartManager.registerAgent()` directly
4. `threadWatcher.rescanAgents()` picks up the new agent's mailbox
5. Sidebar filters to active session's threads on focus change

Environment injected: `PARADIGM_SESSION_ID`, `PARADIGM_CONDUCTOR=1`, `TERM=xterm-256color`

### Keyboard Shortcuts

| Action | Shortcut | Note |
|--------|----------|------|
| Toggle sidebar | Cmd+\ | VS Code convention |
| New session | Cmd+T | |
| Close active cell | Cmd+W | |
| Focus cell 1/2/3/4 | Cmd+1/2/3/4 | Direct access |
| Next cell | Cmd+Shift+] | |
| Previous cell | Cmd+Shift+[ | |
| Split horizontal | Cmd+D | iTerm2 convention |
| Split vertical | Cmd+Shift+D | iTerm2 convention |
| Quick-launch | Cmd+K | Fuzzy project search |
| Command palette | Cmd+Shift+P | |

All Cmd+ based — terminals pass Cmd to the OS. No Ctrl+ conflicts with Claude Code.

---

## Sprint Plan

### Sprint 0: SwiftTerm Spike (1-2 days)

**Goal:** Prove SwiftTerm works with Claude Code in a single embedded pane.

**Deliverables:**
- Add SwiftTerm to Package.swift
- `TerminalSession.swift` + `TerminalSessionState.swift` (models)
- `TerminalViewRepresentable.swift` (NSViewRepresentable → LocalProcessTerminalView)
- `TerminalCellView.swift` (minimal chrome — terminal + project label)
- Hard-code one session in ContainerView's first grid cell
- Spawns `/bin/zsh -l -c claude` in user's home directory

**Validation checklist:**
- [ ] Terminal renders with correct colors (256 + true color)
- [ ] Claude Code's interactive prompt works (Ink TUI)
- [ ] Keyboard input flows correctly (typing, Ctrl+C, arrow keys)
- [ ] Streaming output renders smoothly (tool results, file reads)
- [ ] Window resize propagates (SIGWINCH → Claude Code reflows)
- [ ] Copy/paste works (Cmd+C/V)
- [ ] Mouse events work if Claude Code uses them
- [ ] No visual glitches in the SwiftUI layout

**If all pass → proceed to Sprint 1.**
**If critical failures → pivot to xterm.js (WKWebView approach).**

### Sprint 1: Session Manager + Multi-Pane (2-3 days)

**Goal:** Multiple embedded sessions with tiling layout.

- `TerminalSessionManager.swift` — full session CRUD, max 8 sessions
- `SessionToolbarView.swift` — per-pane toolbar (project, status, split/close)
- `NewSessionSheet.swift` — project picker (recent projects from ProjectStore)
- Wire TilingEngine cells to sessions (`CellState.sessionId`)
- Active session tracking: click-to-focus updates `activeSessionId`
- Empty cells show "+" button
- Session cleanup on process exit
- Add to ConductorEnvironment + AppDelegate

### Sprint 2: Symphony Auto-Link + Sidebar Integration (2-3 days)

**Goal:** Sessions auto-participate in Symphony. Sidebar shows focused session's context.

- PID child-process scanner (find `claude` within shell)
- Direct Symphony registration (bypass AX detection)
- Sidebar Team tab filters threads to active session
- Environment variable injection
- Signal emissions: `!session-started`, `!session-terminated`, `!session-focused`
- Thread count badge on cell toolbar

### Sprint 3: Polish + Window Management (2-3 days)

**Goal:** Production-quality workspace experience.

- NSToolbar with New Session + Layout preset buttons
- Terminal appearance settings (font, colors, font size)
- Resizable sidebar with drag handle
- Workspace mode activation policy (.regular → Dock icon, Cmd+Tab)
- Menu bar: "Switch to Workspace" / "Switch to Overlay"
- Keyboard shortcuts (Cmd+T, Cmd+W, Cmd+1-4, Cmd+D splits)
- Session persistence (save/restore layout on quit/relaunch)
- Status bar showing active session + Claude Code status

### Sprint 4: Hardening (Deferred)

- Terminal search (Cmd+F via SwiftTerm MacFindBarView)
- URL click handling
- Process restart button on exit
- Drag-and-drop sessions between cells
- Metal GPU rendering toggle
- Accessibility/VoiceOver audit
- Performance profiling with 4+ concurrent sessions

---

## Fallback Plan (If SwiftTerm Fails Sprint 0)

### Option C: WKWebView + xterm.js

Replace SwiftTerm with a `WKWebView` running xterm.js. This is what VS Code uses for its terminal — battle-tested by 50M users, WebGL-accelerated, full ANSI compatibility.

**Trade-off:** Loses native Swift purity. Gains guaranteed compatibility.

**Implementation:** Same architecture (TerminalSessionManager, TerminalCellView, Symphony auto-link) but `TerminalViewRepresentable` wraps a `WKWebView` instead of `LocalProcessTerminalView`. The WKWebView loads a local HTML page that initializes xterm.js and connects to a PTY via a WebSocket bridge (a small Node.js process that pipes PTY I/O to the WebView).

**Effort:** +2-3 days over SwiftTerm due to the WebSocket bridge layer.

---

## What This Does NOT Do

- Replace the user's preferred terminal for non-Claude work
- Provide an editor or file browser (this is not an IDE)
- Run on platforms other than macOS
- Support tmux or screen multiplexing (Conductor IS the multiplexer)
- Auto-update (still `git pull && ./build-conductor.sh --install`)

---

## Success Criteria

The workspace succeeds if:

1. **Users can spawn 2+ Claude Code sessions and see their agent threads side by side** without window management gymnastics
2. **Symphony messages from one session are visible in Conductor's sidebar within 3 seconds** without manual polling
3. **Switching focus between cells updates the sidebar context** seamlessly
4. **The terminal rendering is indistinguishable from Terminal.app** for Claude Code's output
5. **The workspace replaces the user's current workflow** of "Terminal.app + Conductor overlay tiled manually"

---

*Spec authored by Apex (architect) with challenges from Jinx (devil's advocate) and UX evaluation from DX agent. March 27, 2026.*
