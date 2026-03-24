# Paradigm Canvas

> AI-driven infinite canvas for visualizing and organizing Paradigm symbols
>
> **Codename:** Canvas | **Status:** Spec Draft | **Author:** ascend + opus
> **Date:** 2026-03-23

---

## 1. Vision

Paradigm Canvas gives every project a **visual workspace** where symbols come alive.
Components become cards, flows become connected paths, gates become checkpoints,
signals become event markers, aspects become overlays. The entire symbol graph —
currently understood only through YAML files and terminal output — becomes something
you can see, arrange, and reason about spatially.

**The metaphor extends the recording studio.** If Lore is the tape archive and Graph
is the live session room, Canvas is the **whiteboard wall** — the place where the
band pins up the setlist, sketches the album art, maps out the tour schedule. It's
not the mixing board (that's the IDE). It's where you step back and see the whole
picture.

**What makes it different from the existing Graph section:**

| Graph (existing) | Canvas (new) |
|-------------------|--------------|
| Auto-laid-out node graph | Freeform infinite canvas |
| Shows relationships only | Shows visual representations of components |
| Read-only topology view | Arrange, annotate, group, sketch |
| Symbol nodes are dots with labels | Symbol cards with rich content (state, gates, signals) |
| One layout algorithm | Multiple views: flow diagrams, component boards, architecture maps |
| No persistence | Persists layouts to `.paradigm/canvas/` |

### What it looks like

A Wednesday morning on Canvas:

1. Dev opens Platform → clicks Canvas in the sidebar
2. The canvas loads their saved layout — `#payment-service` and its related symbols
   are grouped in the top-left, the `$checkout-flow` is laid out as a path across
   the center, `^authenticated` gate is shown at the entry point
3. Dev drags `#inventory-service` near `#payment-service` — a dotted connector
   appears showing their shared `$order-flow`
4. Dev's AI agent highlights `#payment-service` (Sentinel alert) — the card pulses
   red, a badge shows "3 errors in last hour"
5. Dev right-clicks → "Auto-layout this group" → the cluster reorganizes
6. Dev types in the CLI: `paradigm canvas snapshot checkout-redesign` — the current
   layout is saved as a named snapshot
7. Later, the agent uses MCP to place a new component card on the canvas after
   scaffolding `#refund-service`

### What Canvas is NOT

| It is NOT | It IS |
|-----------|-------|
| Figma (full design tool with vector editing) | A structured canvas for symbol visualization |
| A replacement for the Graph section | A complement — Graph shows topology, Canvas shows architecture |
| A code editor | A visual companion to your codebase |
| A drawing app | A symbol-aware workspace where every shape maps to real code |
| Collaborative/multiplayer | A local-first tool for individual developers |

---

## 2. Architecture Overview

### Canvas in the Platform

```
paradigm serve → localhost:3850

Platform UI (Vite SPA)
┌────────────────────────────────────────────────────────┐
│  Sidebar  │  Content Area                              │
│           │                                            │
│  Overview │  ┌──────────────────────────────────────┐  │
│  Lore     │  │                                      │  │
│  Graph    │  │         Canvas Section                │  │
│  Canvas ← │  │         (tldraw + custom shapes)      │  │
│  Git      │  │                                      │  │
│  Sentinel │  │  ┌─────┐  ┌─────┐  ───→  ┌─────┐   │  │
│  Symphony │  │  │ #svc │  │ #api │       │ #db  │   │  │
│  Docs     │  │  └─────┘  └─────┘  ───→  └─────┘   │  │
│  Ambient  │  │                                      │  │
│  Team     │  │  $checkout-flow ═══════════════►     │  │
│           │  │                                      │  │
│           │  └──────────────────────────────────────┘  │
└────────────────────────────────────────────────────────┘
```

### Data Flow

```
.paradigm/index.yaml ──→ /api/canvas/symbols ──→ Canvas UI
.paradigm/canvas/    ←──→ /api/canvas/layouts ──→ Canvas UI
                                                      ↑
MCP Tool ──→ POST /api/platform/agent-command ──→ WebSocket
CLI      ──→ POST /api/canvas/* ──────────────────────┘
```

### Tech Stack Decision: tldraw

**Why tldraw over React Flow / Excalidraw / custom:**

| Option | Pros | Cons |
|--------|------|------|
| **tldraw** (chosen) | MIT license, infinite canvas built-in, custom shapes API, excellent perf, active maintenance, built for exactly this use case | Additional dependency (~200KB) |
| React Flow | Already in the project | Optimized for node graphs, not freeform canvas. Would fight the tool. |
| Excalidraw | Hand-drawn aesthetic | Less extensible custom shapes, heavier bundle, different visual language |
| Custom (raw Canvas/WebGL) | Full control | Months of work on pan/zoom/selection/undo alone |

tldraw provides: infinite canvas, pan/zoom, selection, undo/redo, layers, grouping,
custom shape rendering, keyboard shortcuts, touch support — all for free. We build
the Paradigm-specific shapes and data binding on top.

**tldraw version:** `@tldraw/tldraw@3.x` (MIT licensed, React-native)

---

## 3. Data Model

### 3.1 Canvas Persistence

Canvas layouts persist to `.paradigm/canvas/` — one YAML file per named layout.

```
.paradigm/canvas/
├── default.yaml        # Auto-saved current layout
├── checkout-redesign.yaml  # Named snapshot
├── api-architecture.yaml   # Named snapshot
└── onboarding-flow.yaml    # Named snapshot
```

### 3.2 Layout Schema

```yaml
# .paradigm/canvas/default.yaml
version: 1
name: default
created: 2026-03-23T10:00:00Z
updated: 2026-03-23T14:30:00Z
viewport:
  x: -200
  y: -150
  zoom: 0.8

shapes:
  - id: shape_abc123
    type: symbol-card        # Custom shape type
    symbol: "#payment-service"
    x: 100
    y: 200
    width: 280
    height: 180
    collapsed: false
    style:
      color: component       # Uses symbol color from design tokens

  - id: shape_def456
    type: symbol-card
    symbol: "$checkout-flow"
    x: 500
    y: 200
    width: 320
    height: 140
    collapsed: false
    style:
      color: flow

  - id: shape_ghi789
    type: gate-marker
    symbol: "^authenticated"
    x: 400
    y: 250
    style:
      color: gate

  - id: shape_note1
    type: annotation
    x: 100
    y: 50
    width: 400
    content: "This cluster handles all payment processing"
    style:
      color: neutral

connections:
  - from: shape_abc123
    to: shape_def456
    type: flow-path          # Visual connector type
    label: "initiates"

  - from: shape_def456
    to: shape_ghi789
    type: gate-check
    label: "requires"

groups:
  - id: group_payments
    name: "Payment Cluster"
    shapes: [shape_abc123, shape_def456, shape_ghi789]
    color: "#58a6ff22"       # Translucent component blue
```

### 3.3 Custom Shape Types

| Shape Type | Maps To | Visual |
|------------|---------|--------|
| `symbol-card` | `#component` | Card with name, description, tags, state indicators |
| `flow-path` | `$flow` | Directed path with steps, animated when active |
| `gate-marker` | `^gate` | Shield/checkpoint icon with pass/fail state |
| `signal-marker` | `!signal` | Lightning bolt with emission count |
| `aspect-overlay` | `~aspect` | Translucent overlay spanning multiple shapes |
| `annotation` | (freeform) | Text note, not tied to a symbol |
| `group-frame` | (freeform) | Named frame grouping related shapes |
| `connector` | (relationship) | Line/arrow connecting any two shapes |

### 3.4 Symbol Card Content

A symbol card renders real data from the Paradigm index:

```
┌─────────────────────────────────┐
│ #  payment-service              │
│    tags: [feature, critical]    │
├─────────────────────────────────┤
│ Handles Stripe integration,    │
│ subscription management, and   │
│ refund processing.             │
├─────────────────────────────────┤
│ Gates: ^authenticated, ^admin  │
│ Signals: !payment-success,     │
│          !payment-failed       │
│ Flows: $checkout-flow (3 steps)│
├─────────────────────────────────┤
│ ● Sentinel: 3 errors (1h)     │
│ ● Calibration: 0.85           │
│ ● Last commit: 2h ago         │
└─────────────────────────────────┘
```

When collapsed:
```
┌──────────────────────┐
│ #  payment-service   │
│    ● 3 errors  0.85  │
└──────────────────────┘
```

---

## 4. Frontend Architecture

### 4.1 Section Structure

```
platform-ui/src/sections/canvas/
├── CanvasSection.tsx            # Main section (lazy-loaded in App.tsx)
├── components/
│   ├── ParadigmCanvas.tsx       # tldraw wrapper with custom config
│   ├── CanvasToolbar.tsx        # Top toolbar (layout, snapshot, import)
│   ├── CanvasContextPanel.tsx   # Right panel (symbol details on select)
│   ├── shapes/
│   │   ├── SymbolCardShape.tsx  # #component card shape
│   │   ├── FlowPathShape.tsx    # $flow path shape
│   │   ├── GateMarkerShape.tsx  # ^gate marker shape
│   │   ├── SignalMarkerShape.tsx # !signal marker shape
│   │   ├── AspectOverlayShape.tsx # ~aspect overlay shape
│   │   ├── AnnotationShape.tsx  # Freeform text annotation
│   │   └── GroupFrameShape.tsx  # Named grouping frame
│   ├── connectors/
│   │   ├── FlowConnector.tsx    # Flow relationship line
│   │   └── GateConnector.tsx    # Gate check line
│   └── panels/
│       ├── SymbolPalette.tsx    # Draggable symbol list (left drawer)
│       ├── SnapshotManager.tsx  # Save/load named layouts
│       └── LayoutEngine.tsx     # Auto-layout controls
├── store/
│   └── canvasStore.ts           # Zustand store
├── hooks/
│   ├── useCanvasData.ts         # Fetch symbols + layout from API
│   ├── useCanvasSync.ts         # Auto-save layout on changes
│   └── useCanvasAgent.ts        # Handle agent commands via WS
├── utils/
│   ├── layout-algorithms.ts     # Auto-layout (force-directed, hierarchical, grid)
│   ├── symbol-to-shape.ts      # Convert Paradigm symbols → tldraw shapes
│   └── canvas-serializer.ts    # tldraw state ↔ YAML layout
└── styles/
    └── canvas.css               # Canvas-specific styles
```

### 4.2 tldraw Integration

```tsx
// ParadigmCanvas.tsx — conceptual structure
import { Tldraw, TLShapeUtil, createShapeId } from '@tldraw/tldraw'

// Register custom shape utils
const customShapeUtils = [
  SymbolCardShapeUtil,
  FlowPathShapeUtil,
  GateMarkerShapeUtil,
  SignalMarkerShapeUtil,
  AspectOverlayShapeUtil,
  AnnotationShapeUtil,
  GroupFrameShapeUtil,
]

// Register custom tools (optional)
const customTools = [
  SymbolPlaceTool,    // Click to place a symbol from palette
  ConnectorDrawTool,  // Draw connections between shapes
]

export function ParadigmCanvas() {
  return (
    <Tldraw
      shapeUtils={customShapeUtils}
      tools={customTools}
      onMount={handleMount}       // Load saved layout
      onChange={handleChange}      // Auto-save debounced
    />
  )
}
```

### 4.3 Zustand Store

```typescript
// canvasStore.ts
interface CanvasState {
  // Layout management
  currentLayout: string           // 'default' or named snapshot
  availableLayouts: string[]
  isDirty: boolean

  // Symbol data (from API)
  symbols: SymbolIndex
  sentinelStatus: Record<string, SentinelAlert[]>

  // UI state
  selectedShapeId: string | null
  selectedSymbol: string | null   // Paradigm symbol ID
  contextPanelOpen: boolean
  palettePanelOpen: boolean

  // Actions
  loadLayout: (name: string) => Promise<void>
  saveLayout: (name?: string) => Promise<void>
  deleteLayout: (name: string) => Promise<void>
  importSymbols: (filter?: SymbolFilter) => Promise<void>
  autoLayout: (algorithm: LayoutAlgorithm, scope?: string[]) => void
  placeSymbol: (symbolId: string, x: number, y: number) => void
}
```

### 4.4 Auto-Layout Algorithms

Three layout modes, all client-side:

| Algorithm | Best For | How |
|-----------|----------|-----|
| **Force-directed** | Relationship clusters | D3-force simulation on symbol connections |
| **Hierarchical** | Flow visualization | Top-to-bottom or left-to-right DAG layout |
| **Grid** | Component inventory | Even grid, grouped by tag or directory |

Users can apply layout to the full canvas or a selected group.

---

## 5. Backend Architecture

### 5.1 Express Routes

```
/api/canvas/
├── GET    /symbols          # All symbols with metadata (from index)
├── GET    /symbols/:id      # Single symbol detail
├── GET    /layouts          # List saved layouts
├── GET    /layouts/:name    # Load a specific layout
├── PUT    /layouts/:name    # Save/update a layout
├── DELETE /layouts/:name    # Delete a layout
├── POST   /layouts/:name/snapshot  # Clone current → named snapshot
├── POST   /auto-layout      # Server-side layout computation (optional)
└── GET    /enrichments/:id  # Live data for a symbol (sentinel, git, calibration)
```

### 5.2 Route Implementation

```
packages/paradigm/src/platform-server/routes/canvas.ts
```

The canvas router:
- Reads symbols from the existing index loader (shared with Graph section)
- Reads/writes layout YAML files from `.paradigm/canvas/`
- Enriches symbols with Sentinel alerts, git recency, calibration scores
- No new database — just YAML files on disk

### 5.3 WebSocket Agent Commands

New agent command types for Canvas (extend existing `agent:*` protocol):

```typescript
// Agent navigates canvas to a symbol
{ type: 'agent:canvas:focus', symbol: '#payment-service', zoom: 1.2 }

// Agent places a new symbol on canvas
{ type: 'agent:canvas:place', symbol: '#refund-service', x: 600, y: 300 }

// Agent highlights a region
{ type: 'agent:canvas:highlight', shapes: ['shape_abc123'], color: 'red', duration: 5000 }

// Agent adds an annotation
{ type: 'agent:canvas:annotate', x: 100, y: 50, text: 'New service added here' }

// Agent triggers auto-layout
{ type: 'agent:canvas:layout', algorithm: 'hierarchical', scope: ['#payment-*'] }
```

These reuse the existing WebSocket broadcast infrastructure — no new server needed.

---

## 6. MCP Tools

### 6.1 New MCP Tools

| Tool | Purpose | Parameters |
|------|---------|------------|
| `paradigm_canvas_place` | Place a symbol on the canvas | `symbol`, `x?`, `y?`, `layout?` |
| `paradigm_canvas_arrange` | Auto-layout symbols | `algorithm`, `scope?`, `layout?` |
| `paradigm_canvas_snapshot` | Save current canvas as named snapshot | `name`, `description?` |
| `paradigm_canvas_load` | Load a named layout | `name` |
| `paradigm_canvas_list` | List saved layouts | — |
| `paradigm_canvas_focus` | Pan/zoom to a symbol | `symbol`, `zoom?` |
| `paradigm_canvas_annotate` | Add a text annotation | `text`, `x?`, `y?`, `near_symbol?` |
| `paradigm_canvas_export` | Export canvas as SVG/PNG | `format`, `layout?` |
| `paradigm_canvas_generate` | Auto-generate a canvas from symbols | `filter?`, `algorithm?`, `scope?` |
| `paradigm_canvas_remove` | Remove a shape from canvas | `symbol` or `shape_id` |

### 6.2 Tool Implementation Location

```
packages/paradigm-mcp/src/tools/canvas.ts
```

Tools interact with canvas in two ways:
1. **File-based**: Read/write `.paradigm/canvas/*.yaml` directly (works without Platform running)
2. **Live-push**: If Platform is running, also POST to `/api/platform/agent-command` to update the UI in real-time

### 6.3 Canvas Generate — The Power Tool

`paradigm_canvas_generate` is the headline tool. Given a filter, it:

1. Reads the symbol index
2. Selects matching symbols
3. Computes a layout (force-directed by default)
4. Writes shapes + connections to a layout file
5. If Platform is open, pushes to the canvas live

```
Agent: "Show me the architecture of the checkout system"
→ paradigm_canvas_generate filter="$checkout-*,#payment-*,#cart-*" algorithm="hierarchical"
→ Canvas fills with a top-to-bottom flow diagram of the checkout system
```

---

## 7. CLI Commands

```bash
# Open canvas in Platform (launches paradigm serve if needed)
paradigm canvas

# Generate a canvas from symbols
paradigm canvas generate --filter "#payment-*" --algorithm hierarchical

# List saved layouts
paradigm canvas list

# Save current as named snapshot
paradigm canvas snapshot checkout-redesign

# Load a named layout
paradigm canvas load checkout-redesign

# Export canvas to file
paradigm canvas export --format svg --output architecture.svg
paradigm canvas export --format png --output architecture.png

# Delete a layout
paradigm canvas delete old-layout
```

### CLI Implementation

```
packages/paradigm/src/commands/canvas.ts
```

---

## 8. Integration Points

### 8.1 Platform Integration

| Section | Integration |
|---------|-------------|
| **Graph** | "Open in Canvas" button on any node → places symbol on canvas |
| **Sentinel** | Live error badges on symbol cards (WebSocket-driven) |
| **Lore** | Symbol card shows recent lore entries count |
| **Overview** | Canvas thumbnail/preview widget |
| **Symphony** | Agent messages can reference canvas positions |

### 8.2 Agent Integration

Canvas participates in the existing agent command protocol:

- **`paradigm_platform_navigate`** already supports navigating to sections — add `canvas` target
- **`paradigm_platform_highlight`** extends to highlight shapes on canvas
- **`paradigm_platform_annotate`** extends to annotate canvas

New canvas-specific commands layer on top via the `agent:canvas:*` message types.

### 8.3 Conductor Integration

Conductor can observe the canvas viewport and:
- Show a minimap of the current canvas in the overlay
- Allow voice commands: "Show me the payment architecture" → triggers canvas generate
- Surface canvas snapshots in the task dashboard

### 8.4 VS Code Integration

paradigm-vscode can:
- "Reveal in Canvas" command on any symbol in code
- Symbol hover shows canvas position if placed
- Canvas selection syncs to file in editor (future)

---

## 9. Sprint Plan

### Sprint 0: Foundation (3-4 days)
- [ ] Add tldraw dependency to platform-ui
- [ ] Create `CanvasSection.tsx` scaffold (lazy-loaded)
- [ ] Register `canvas` in SidebarNav, platformStore, App.tsx
- [ ] Create `.paradigm/canvas/` directory management
- [ ] Create `canvasStore.ts` with layout load/save
- [ ] Backend: `/api/canvas/layouts` CRUD routes
- [ ] Backend: `/api/canvas/symbols` route (reuse index loader)
- **Deliverable:** Empty canvas section accessible in Platform, can save/load blank layouts

### Sprint 1: Symbol Shapes (3-4 days)
- [ ] Implement `SymbolCardShapeUtil` (component cards with rich content)
- [ ] Implement `GateMarkerShapeUtil` (gate checkpoints)
- [ ] Implement `SignalMarkerShapeUtil` (signal indicators)
- [ ] Implement `FlowConnector` (directed path connectors)
- [ ] Symbol palette panel (draggable symbol list)
- [ ] Style shapes using Platform design tokens (symbol colors)
- **Deliverable:** Can drag symbols from palette onto canvas, cards show real data

### Sprint 2: Layout & Persistence (2-3 days)
- [ ] Force-directed auto-layout algorithm
- [ ] Hierarchical (DAG) auto-layout algorithm
- [ ] Grid auto-layout algorithm
- [ ] Auto-save debounced to `/api/canvas/layouts/default`
- [ ] Snapshot manager panel (save/load/delete named layouts)
- [ ] Canvas serializer: tldraw state ↔ YAML
- **Deliverable:** Symbols auto-arrange, layouts persist across sessions

### Sprint 3: MCP & CLI (2-3 days)
- [ ] MCP tools: `paradigm_canvas_place`, `paradigm_canvas_arrange`, `paradigm_canvas_focus`
- [ ] MCP tools: `paradigm_canvas_snapshot`, `paradigm_canvas_load`, `paradigm_canvas_list`
- [ ] MCP tool: `paradigm_canvas_generate` (the power tool)
- [ ] CLI commands: `paradigm canvas [generate|list|snapshot|load|export|delete]`
- [ ] WebSocket agent commands: `agent:canvas:*`
- **Deliverable:** AI agents can create and manipulate canvases programmatically

### Sprint 4: Enrichment & Polish (2-3 days)
- [ ] Live Sentinel badges on symbol cards
- [ ] Git recency indicator on cards
- [ ] Calibration score on cards
- [ ] Context panel (right side) on shape selection
- [ ] "Open in Canvas" from Graph section
- [ ] SVG/PNG export
- [ ] Keyboard shortcuts (Cmd+S save, Cmd+Shift+S snapshot, etc.)
- **Deliverable:** Canvas shows live project health, integrates with other sections

### Sprint 5: Advanced Shapes & Views (2-3 days)
- [ ] `FlowPathShapeUtil` (multi-step flow visualization)
- [ ] `AspectOverlayShapeUtil` (translucent overlays)
- [ ] `AnnotationShapeUtil` and `GroupFrameShapeUtil`
- [ ] MCP tools: `paradigm_canvas_annotate`, `paradigm_canvas_remove`, `paradigm_canvas_export`
- [ ] Minimap component
- [ ] Canvas search (find symbol on canvas)
- **Deliverable:** Full shape vocabulary, production-ready canvas

---

## 10. Dependencies & Bundle Impact

### New Dependencies

| Package | Size | Purpose |
|---------|------|---------|
| `@tldraw/tldraw` | ~200KB gzip | Infinite canvas engine |
| `d3-force` | ~15KB gzip | Force-directed layout algorithm |
| `dagre` | ~30KB gzip | Hierarchical DAG layout |

**Total addition: ~245KB gzip** — acceptable for a platform UI that already loads
React Flow, Zustand, React, etc.

### Build Impact

tldraw is a client-side dependency only — added to `platform-ui/package.json`.
No impact on the CLI, MCP server, or any other package.

---

## 11. File Manifest

### New Files

```
# Frontend (platform-ui)
platform-ui/src/sections/canvas/CanvasSection.tsx
platform-ui/src/sections/canvas/components/ParadigmCanvas.tsx
platform-ui/src/sections/canvas/components/CanvasToolbar.tsx
platform-ui/src/sections/canvas/components/CanvasContextPanel.tsx
platform-ui/src/sections/canvas/components/shapes/SymbolCardShape.tsx
platform-ui/src/sections/canvas/components/shapes/FlowPathShape.tsx
platform-ui/src/sections/canvas/components/shapes/GateMarkerShape.tsx
platform-ui/src/sections/canvas/components/shapes/SignalMarkerShape.tsx
platform-ui/src/sections/canvas/components/shapes/AspectOverlayShape.tsx
platform-ui/src/sections/canvas/components/shapes/AnnotationShape.tsx
platform-ui/src/sections/canvas/components/shapes/GroupFrameShape.tsx
platform-ui/src/sections/canvas/components/connectors/FlowConnector.tsx
platform-ui/src/sections/canvas/components/connectors/GateConnector.tsx
platform-ui/src/sections/canvas/components/panels/SymbolPalette.tsx
platform-ui/src/sections/canvas/components/panels/SnapshotManager.tsx
platform-ui/src/sections/canvas/components/panels/LayoutEngine.tsx
platform-ui/src/sections/canvas/store/canvasStore.ts
platform-ui/src/sections/canvas/hooks/useCanvasData.ts
platform-ui/src/sections/canvas/hooks/useCanvasSync.ts
platform-ui/src/sections/canvas/hooks/useCanvasAgent.ts
platform-ui/src/sections/canvas/utils/layout-algorithms.ts
platform-ui/src/sections/canvas/utils/symbol-to-shape.ts
platform-ui/src/sections/canvas/utils/canvas-serializer.ts
platform-ui/src/sections/canvas/styles/canvas.css

# Backend
packages/paradigm/src/platform-server/routes/canvas.ts

# MCP
packages/paradigm-mcp/src/tools/canvas.ts

# CLI
packages/paradigm/src/commands/canvas.ts
```

### Modified Files

```
# Platform UI registration
platform-ui/src/App.tsx                    # Add lazy Canvas import + route
platform-ui/src/store/platformStore.ts     # Add 'canvas' to SectionId
platform-ui/src/components/SidebarNav.tsx  # Add canvas icon
platform-ui/package.json                   # Add tldraw, d3-force, dagre

# Platform server
packages/paradigm/src/platform-server/index.ts  # Mount canvas routes

# MCP registration
packages/paradigm-mcp/src/tools/index.ts   # Register canvas tools

# CLI registration
packages/paradigm/src/index.ts             # Register canvas command
```

---

## 12. Future Considerations (Not in MVP)

These are explicitly **out of scope** for the initial build but worth noting:

- **Component preview rendering**: Render actual React/HTML components on the canvas (requires sandboxed iframe)
- **Multiplayer**: Real-time collaboration via CRDT (tldraw supports Yjs)
- **Canvas-as-documentation**: Export canvas as interactive HTML docs
- **Template canvases**: Pre-built layouts for common architectures (REST API, microservices, monolith)
- **Conductor voice control**: "Zoom into the payment cluster" via Conductor audio
- **Symbol creation from canvas**: Draw a card, it scaffolds the component in code
- **Timeline scrubbing**: Replay canvas state over time using lore entries
- **Probe integration**: Overlay real UI screenshots onto symbol cards via probe-core

---

## 13. Success Criteria

### MVP (end of Sprint 2)
- [ ] Canvas section loads in Platform with no errors
- [ ] All 5 symbol types render as custom shapes
- [ ] Symbols can be dragged from palette and arranged freely
- [ ] Auto-layout produces reasonable arrangements
- [ ] Layouts persist and reload across browser sessions
- [ ] Canvas YAML files are human-readable and git-friendly

### Full v1 (end of Sprint 5)
- [ ] AI agents can generate canvases from natural language
- [ ] Live Sentinel/git/calibration data on symbol cards
- [ ] SVG/PNG export works
- [ ] "Open in Canvas" from Graph section
- [ ] CLI commands functional
- [ ] All MCP tools registered and working
- [ ] Canvas section feels native alongside Sentinel, Lore, Graph

---

*See `.paradigm/specs/` for related specifications. Run `paradigm sync` to regenerate.*
