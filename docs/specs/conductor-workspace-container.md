# Conductor Workspace Container — Specification

> **Status:** Draft
> **Author:** Claude (Opus 4.6) + Matt Canoy
> **Date:** 2026-03-17
> **Conductor Version:** 0.15.0 → target 1.0.0
> **Symbols:** #workspace-container, #tiling-engine, #instance-cell, $workspace-layout

## Vision

Transform Conductor from a sidebar overlay into a **full-screen workspace container** — a tiling window manager purpose-built for orchestrating multiple Claude Code instances across related projects. Think of it as a native macOS equivalent of tmux/i3 but specifically designed for AI agent orchestration, with live status, gaze targeting, and drag-to-resize.

The container is the primary workspace surface. Claude instances render *inside* it as managed cells that can be snapped, resized, split, and merged. The Conductor sidebar becomes a collapsible control panel within the container, not a separate floating panel.

## Problem

The current sidebar + grid minimap model has limitations:

1. **Indirect control** — The sidebar shows a *minimap* of the grid, but actual windows are positioned independently via AX APIs. Users see two representations: the minimap and the actual windows.
2. **Fixed grid** — 2-column layout only. No custom splits, no vertical stacking, no asymmetric layouts.
3. **No resize** — Cells are computed from a deterministic formula. Users can't drag to resize one instance vs another.
4. **Disconnected instances** — Claude Code runs in Terminal.app/iTerm windows. Conductor positions them but doesn't "own" the visual container.
5. **Small surface area** — 280-500px sidebar means all orchestration controls (tasks, agents, sentinel, health) compete for vertical space.

## Design

### Container Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│ [≡] Conductor v1.0              ⬤ 3 agents    ◉ ⚡ 🔇  [⚙]  │ ← Header bar
├────────┬────────────────────────────┬───────────────────────────┤
│        │                            │                           │
│  C     │   Instance Cell 1          │   Instance Cell 2         │
│  O     │   [project-a]              │   [project-b]             │
│  N     │                            │                           │
│  T     │   ┌──────────────────┐     │   ┌──────────────────┐    │
│  R     │   │ Terminal Content  │     │   │ Terminal Content  │    │
│  O     │   │ (AX positioned)  │     │   │ (AX positioned)  │    │
│  L     │   │                  │     │   │                  │    │
│        │   └──────────────────┘     │   └──────────────────┘    │
│  P     │   Status: ⚡ implementing │   Status: 💤 idle         │
│  A     ├────────────────────────────┼───────────────────────────┤
│  N     │                            │                           │
│  E     │   Instance Cell 3          │   + Add Instance          │
│  L     │   [project-c]              │                           │
│        │                            │   Drop project here       │
│  280px │   Terminal Content          │   or click +              │
│        │                            │                           │
├────────┴────────────────────────────┴───────────────────────────┤
│ Tasks: 3 active  │  Sentinel: 12 events  │  Health: 95%         │ ← Status bar
└─────────────────────────────────────────────────────────────────┘
```

### Key Concepts

**1. Workspace Container (NSWindow, not NSPanel)**
- Full-screen-capable `NSWindow` replaces the floating `NSPanel`
- Can enter native macOS full-screen mode (green button)
- Title bar integrates with header controls
- Background: `.ultraThickMaterial` with subtle grid lines showing cell boundaries

**2. Instance Cells**
- Each cell is a bounded region where a terminal window gets positioned
- Cells have: project name label, status indicator, health dot, progress bar
- Cells are NOT SwiftUI webviews — they're transparent regions where real Terminal.app windows sit behind the container
- Container draws chrome (borders, labels, status) while terminal windows show through

**3. Tiling Engine**
- Replaces the fixed 2-column `WorkspaceGrid` with a flexible tree-based layout
- Binary split tree: each node is either a leaf (instance cell) or a split (horizontal/vertical)
- Supports: equal splits, custom ratios, nested splits (left half split vertically, right half as one tall cell)
- Drag handles between cells for resize (minimum cell size: 400×300)

**4. Control Panel**
- The sidebar content (tasks, agents, sentinel, health, buffer, session manager) moves into a collapsible panel
- Toggle via hamburger menu or keyboard shortcut
- Panel slides in from the left, overlaying cells (not pushing them)
- Alternatively: bottom drawer for status-heavy views (sentinel, health)

---

## Tiling Engine Design

### Data Model

```swift
/// A node in the tiling layout tree.
indirect enum TileNode: Codable, Identifiable {
    /// A leaf cell containing an instance (or empty placeholder)
    case cell(CellState)
    /// A split into two children with a configurable ratio
    case split(SplitState)

    var id: String { ... }
}

struct CellState: Codable, Identifiable {
    let id: String               // UUID
    var instanceId: String?      // ManagedInstance.id (nil = empty cell)
    var projectPath: String?
    var label: String?
}

struct SplitState: Codable, Identifiable {
    let id: String
    var axis: SplitAxis          // .horizontal or .vertical
    var ratio: CGFloat           // 0.0-1.0, default 0.5
    var first: TileNode
    var second: TileNode
}

enum SplitAxis: String, Codable {
    case horizontal  // left | right
    case vertical    // top / bottom
}
```

### Layout Examples

**2 instances, side by side:**
```
split(.horizontal, 0.5,
    cell("project-a"),
    cell("project-b")
)
```

**3 instances, main + 2 stacked:**
```
split(.horizontal, 0.6,
    cell("project-a"),           // 60% width, full height
    split(.vertical, 0.5,
        cell("project-b"),       // 40% width, top half
        cell("project-c")        // 40% width, bottom half
    )
)
```

**4 instances, 2x2 grid:**
```
split(.vertical, 0.5,
    split(.horizontal, 0.5,
        cell("project-a"),
        cell("project-b")
    ),
    split(.horizontal, 0.5,
        cell("project-c"),
        cell("project-d")
    )
)
```

### Layout Presets

| Name | Layout | Shortcut |
|------|--------|----------|
| Focused | Single cell, full area | ⌘1 |
| Split | 50/50 horizontal | ⌘2 |
| Main + Side | 60/40 horizontal | ⌘3 |
| Grid | 2x2 equal | ⌘4 |
| Triple | Main + 2 stacked | ⌘5 |
| Columns | 3 equal columns | ⌘6 |

### Drag-to-Resize

- Divider handles appear between cells (4px hit target, 2px visual line)
- Drag updates `split.ratio` in real-time
- Snapping at 25%, 33%, 50%, 67%, 75% (with 8px snap zone)
- Double-click divider → reset to 50%
- Minimum cell dimension: 400px wide, 300px tall

### Cell Actions

Each cell has a title bar overlay with:
- Project name (truncated)
- Status badge (idle/processing/implementing/blocked)
- Close button (×) — closes terminal, removes from layout
- Split button (⊞) — splits this cell into two (horizontal or vertical menu)
- Maximize button (⤢) — temporarily makes this cell take 100% (toggle back)
- Drag handle — drag cell to swap positions with another cell

---

## Control Panel Redesign

### Current Sidebar Sections → Panels

The existing 12 content sections reorganize into 4 panel tabs:

| Tab | Icon | Contents |
|-----|------|----------|
| **Workspace** | ⊞ | Session manager (recent projects), instance list, add instance |
| **Orchestrate** | 🎯 | Task dashboard, task composer, agent network, approval banner |
| **Monitor** | 📊 | Sentinel live view, agent health, input status |
| **Settings** | ⚙️ | Bindings, workspace settings, symphony settings, monitoring config |

### Panel Behavior
- **Default:** Collapsed (0px) — container cells fill the full area
- **Open:** 320px overlay from left with `.ultraThinMaterial` background
- **Toggle:** Hamburger button in header or `⌘\` shortcut
- **Auto-collapse:** Panel collapses when user interacts with a cell (optional setting)
- **Persistent tab:** Remembers which tab was last active

---

## Instance Cell Chrome

Each cell draws an overlay frame around the terminal window:

```
┌─ project-name ──── ⚡ implementing ── 45% ── [⊞] [⤢] [×] ─┐
│                                                              │
│                    ┌──────────────────────┐                   │
│                    │                      │                   │
│                    │   Terminal Window     │                   │
│                    │   (real window,       │                   │
│                    │    AX-positioned)     │                   │
│                    │                      │                   │
│                    └──────────────────────┘                   │
│                                                              │
│  Symbols: #auth, #db  │  Files: 3 modified  │  Agent: active │
└──────────────────────────────────────────────────────────────┘
```

### Cell Header (top bar, 28px)
- Project name (bold, left-aligned)
- Status badge (color-coded capsule)
- Progress percentage (if implementing)
- Action buttons (right-aligned): Split, Maximize, Close

### Cell Footer (bottom bar, 20px, optional)
- Symbols touched (from task store)
- File modification count
- Agent status (from Symphony monitor)
- Sentinel event count for this project's symbols

### Cell Border
- Default: 1px `Color.secondary.opacity(0.2)`
- Gaze-targeted: 2px `Color.green` glow
- Processing: subtle pulsing border animation
- Blocked: 1px `Color.red`

---

## Status Bar

Bottom of container, always visible:

```
┌────────────────────────────────────────────────────────────────┐
│  Tasks: 3 active, 1 blocked  │  Sentinel: ⬤ 12 events  │  ⚡ │
│  Health: 95% (3 agents)      │  Context: ~45% used      │  🔇 │
└────────────────────────────────────────────────────────────────┘
```

- Clicking a section opens the corresponding control panel tab
- Task count links to Orchestrate tab
- Sentinel dot shows connection status (green/red)
- Context shows session context usage estimate
- Video/voice toggle icons (right side)

---

## Window Positioning Strategy

### The Container Transparency Trick

The container window is **not** an embedded terminal emulator. Instead:

1. Container draws cell chrome (borders, labels, buttons) as SwiftUI overlays
2. Terminal windows are **positioned behind** the container using AX APIs
3. Container regions where terminal content should show are **transparent** (clear background per cell)
4. Container window is at a higher level than terminal windows but has click-through regions

This preserves:
- Native terminal rendering (no emulation overhead)
- Terminal keyboard shortcuts
- Terminal scrollback
- Terminal-specific features (iTerm2 profiles, Ghostty GPU rendering)

### Alternative: Embedded PTY

For a more integrated experience (future):
- Each cell embeds a `NSTextView` or terminal emulator view
- Spawn `claude` via PTY (pseudo-terminal) instead of terminal app
- Full ownership of the rendering — no window positioning needed
- Drawback: lose terminal app features, significant engineering

**Recommendation:** Start with transparency trick (Sprint 17-18), consider embedded PTY later.

---

## Implementation Plan

### Sprint 17 — Container Window + Tiling Engine

**New Files (4):**
1. `TilingEngine.swift` — `TileNode`, `SplitState`, `CellState`, layout computation
2. `ContainerWindow.swift` — `NSWindow` subclass replacing `ConductorPanel`
3. `ContainerView.swift` — Root SwiftUI view for the container
4. `CellChromeView.swift` — Per-cell overlay with header, footer, border

**Modified Files (3):**
5. `AppDelegate.swift` — Launch `ContainerWindow` instead of `ConductorPanel`
6. `WorkspaceManager.swift` — Adopt `TilingEngine` for cell computation
7. `MainOverlayView.swift` → rename to `ControlPanelView.swift` (panel content only)

### Sprint 18 — Drag-to-Resize + Presets

**New Files (3):**
1. `DividerHandle.swift` — Draggable split handle with snapping
2. `LayoutPresetsView.swift` — Preset selector UI (⌘1-6)
3. `CellActionMenu.swift` — Split/maximize/close actions per cell

**Modified Files (2):**
4. `TilingEngine.swift` — Add preset application, ratio clamping, swap
5. `ContainerView.swift` — Wire drag handles, presets, cell actions

### Sprint 19 — Control Panel + Status Bar

**New Files (3):**
1. `ControlPanelContainer.swift` — Tabbed overlay panel (Workspace/Orchestrate/Monitor/Settings)
2. `StatusBarView.swift` — Bottom status bar with section links
3. `WorkspaceTabView.swift` — Session manager + instance list (extracted from old overlay)

**Modified Files (2):**
4. `ContainerView.swift` — Integrate panel + status bar
5. `AppDelegate.swift` — Wire panel toggle shortcut

### Sprint 20 — Polish + Cell Interactions

**New Files (2):**
1. `CellSwapGesture.swift` — Drag cell to swap positions
2. `CellFooterView.swift` — Per-cell status footer (symbols, files, agent)

**Modified Files (3):**
3. `CellChromeView.swift` — Add footer, border animations
4. `GazeRouter.swift` — Adapt to tiling engine cells (non-grid)
5. `HotKeyManager.swift` — Register preset shortcuts (⌘1-6)

---

## Migration Path

The transition from sidebar to container should be **opt-in** initially:

1. **Sprint 17:** Container window exists alongside ConductorPanel
2. **Sprint 18:** `paradigm conductor --container` flag to launch in container mode
3. **Sprint 19:** Container becomes default, sidebar mode available via `--sidebar`
4. **Sprint 20:** Polish, sidebar mode deprecated

---

## Interaction Patterns

### Adding an Instance
1. Click `+` in an empty cell → project picker (recent projects)
2. Drag a project from control panel's session manager → drop onto empty cell
3. `⌘N` → new cell auto-splits the largest existing cell

### Removing an Instance
1. Click `×` on cell → confirmation if agent is active
2. Cell closes, adjacent cell expands to fill the space
3. Tree node removed, parent becomes a leaf

### Resizing
1. Hover between cells → divider handle appears
2. Drag → ratio updates in real-time
3. Snap to 25/33/50/67/75% increments
4. Double-click → reset to 50%

### Swapping
1. Click and hold cell header → cell lifts (shadow increases)
2. Drag over another cell → that cell highlights
3. Drop → cells swap positions in the tree

### Layout Presets
1. `⌘1` through `⌘6` → apply preset
2. Presets preserve existing instances, rearrange tree structure
3. Extra instances beyond preset capacity go to a "staging area"

---

## Persistence

```yaml
# ~/.paradigm/conductor/workspace.yaml
version: "1.0"
layout:
  type: split
  axis: horizontal
  ratio: 0.5
  first:
    type: cell
    project: /Users/matt/projects/api
    label: "API"
  second:
    type: split
    axis: vertical
    ratio: 0.5
    first:
      type: cell
      project: /Users/matt/projects/frontend
      label: "Frontend"
    second:
      type: cell
      project: null
      label: null
controlPanel:
  collapsed: true
  activeTab: orchestrate
statusBar:
  visible: true
```

---

## Success Criteria

1. **Instances render correctly** within cell boundaries (AX positioning matches cell frames)
2. **Drag-to-resize** feels native (60fps, no jank, snap feedback)
3. **Presets apply instantly** with smooth animation
4. **Control panel** doesn't occlude cells when collapsed
5. **Gaze targeting** works with arbitrary cell shapes (not just grid)
6. **Zero performance regression** — container chrome adds <5ms per frame
7. **Backwards compatible** — `--sidebar` mode still works for users who prefer it
