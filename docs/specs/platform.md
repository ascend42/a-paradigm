# Paradigm Platform

> Unified development management platform — every Paradigm tool in one browser tab
>
> **Codename:** Platform | **Status:** Spec Draft | **Author:** ascend + opus
> **Date:** 2026-03-14

---

## 1. Vision

Paradigm Platform unifies every Paradigm tool — Lore, Graph, Sentinel, University,
Symphony — into a **single `paradigm serve` command** that launches a complete
development management platform in one browser tab. No more four ports, four UIs,
four mental models. One URL, one shell, one place where everything connects.

**The metaphor is a recording studio.** Each tool is a channel on the mixing board:
Lore is the tape archive, Graph is the live session room, Sentinel is the monitoring
rack, University is the practice room, Symphony is the talkback system. The Platform
is the studio itself — the building where all the rooms connect, where the mixing
board lives, where bands walk in and make records. You don't build a studio by
scattering equipment across five buildings. You put it all under one roof and wire
it together.

This extends Symphony's "live band" metaphor. Symphony gave agents and humans a way
to talk. Platform gives them a place to *be*.

### What it looks like

A Tuesday afternoon on the Platform:

1. Dev A opens `localhost:3850` — the Platform overview shows 3 open tasks,
   calibration at 0.82, a Sentinel alert on `#payment-service`
2. Dev A clicks into Graph — the symbol map fills the screen, `#payment-service`
   is glowing red (Sentinel alert)
3. Dev A clicks the node → the Context Panel slides in from the right: last 5 lore
   entries, recent commits, calibration trend, ripple impact, 2 active Symphony threads
4. Dev B joins from their machine — their avatar appears on the Graph canvas,
   cursor moving between `#payment-service` and `#api-gateway`
5. Dev A clicks "Start Meeting" with `#payment-service` on the agenda
6. Both devs' AI agents auto-surface context: the last commit touching the component,
   the Sentinel error trace, the relevant University policy on error handling
7. Dev A speaks a decision: "Let's add a circuit breaker"
8. Dev A's agent opens a Vote — Dev B approves → a governance lore entry is created,
   a task auto-created with the deadline
9. The meeting ends → a comprehensive lore entry captures the full discussion,
   decisions, and action items

The whole thing is one tab. One URL. No terminal juggling.

---

### What Paradigm Platform is NOT

| It is NOT | It IS |
|-----------|-------|
| A cloud service | A local-first server you run on your machine |
| A replacement for your IDE | A companion that lives in a browser tab alongside your editor |
| Jira/Linear/Notion | A methodology tool that understands your codebase symbols |
| A chat app | A governance-aware collaboration surface built on Symphony |
| Generic project management | A system where every action (vote, promise, deny) becomes structured lore |

---

## 2. Architecture Overview

### Unified Server

```
                        ┌──────────────────────────────────────────┐
                        │            paradigm serve                 │
                        │          localhost:3850                   │
                        │                                          │
                        │   Express Server (single process)        │
                        │   ┌────────────────────────────────┐     │
                        │   │         Route Mounts            │     │
                        │   │                                 │     │
                        │   │  /api/lore/*    ← LoreRouter    │     │
                        │   │  /api/info/*    ← InfoRouter    │     │
                        │   │  /api/sessions/* ← SessionsRouter│    │
                        │   │  /api/symbols/* ← SymbolsRouter │     │
                        │   │  /api/graphs/*  ← GraphsRouter  │     │
                        │   │  /api/platform/* ← PlatformRouter│    │
                        │   │  /api/git/*     ← GitRouter     │     │
                        │   │  /ws            ← WebSocket     │     │
                        │   │                                 │     │
                        │   │  Optional (auto-detect):        │     │
                        │   │  /api/events/*  ← SentinelRouter│     │
                        │   │  /api/logs/*    ← SentinelRouter│     │
                        │   │  /api/courses/* ← UniversityRouter│   │
                        │   │  /api/plsat/*   ← PlsatRouter   │     │
                        │   └────────────────────────────────┘     │
                        │                                          │
                        │   Vite SPA (platform-ui/)                │
                        │   ┌────────────────────────────────┐     │
                        │   │  Shell (sidebar + header)       │     │
                        │   │  ┌──────────────────────────┐   │     │
                        │   │  │  Overview | Lore | Graph  │   │     │
                        │   │  │  Git | Sentinel | Uni     │   │     │
                        │   │  │  Symphony | Meetings      │   │     │
                        │   │  └──────────────────────────┘   │     │
                        │   └────────────────────────────────┘     │
                        └──────────────────────────────────────────┘
```

### How it composes with existing tools

```
TODAY (4 ports, 4 processes):

    paradigm lore serve    → localhost:3840  (Express + lore-ui)
    paradigm graph serve   → localhost:3841  (Express + graph-ui)
    sentinel serve         → localhost:3838  (Express + sentinel-ui)
    university serve       → localhost:3839  (Express + university-ui)


PLATFORM (1 port, 1 process):

    paradigm serve         → localhost:3850  (Express + platform-ui)
                              ├── /api/lore/*      (same handlers)
                              ├── /api/symbols/*   (same handlers)
                              ├── /api/graphs/*    (same handlers)
                              ├── /api/platform/*  (new: overview, git, ws)
                              ├── /api/git/*       (new: git operations)
                              ├── /api/events/*    (sentinel, if installed)
                              ├── /api/courses/*   (university, if installed)
                              ├── /ws              (new: WebSocket)
                              └── /*               (SPA shell)

    # Standalone still works:
    paradigm lore serve    → localhost:3840  (unchanged)
    paradigm graph serve   → localhost:3841  (unchanged)
```

### Key Principles

1. **Absorb, don't rewrite** — existing route handlers mount as-is into the unified server
2. **Single port, single tab** — no port juggling, no context switching
3. **Optional sections** — Sentinel and University only appear if their packages are installed
4. **Standalone preserved** — `paradigm lore serve` and `paradigm graph serve` continue working
5. **WebSocket for liveness** — presence, live updates, and meetings all flow through `/ws`
6. **Graph is the center** — the symbol map is the primary workspace, everything radiates from it
7. **Governance is native** — Vote, Promise, Deny are first-class operations, not afterthoughts

---

## 3. CLI Command — `paradigm serve`

### 3.1 Launch

```bash
# Start the platform
paradigm serve
# Output: Paradigm Platform running at http://localhost:3850
#         Sections: overview, lore, graph, git
#         Optional: sentinel (detected), university (detected)
#         WebSocket: ws://localhost:3850/ws

# Custom port
paradigm serve --port 4000

# Skip auto-open
paradigm serve --no-open

# Specify sections
paradigm serve --sections lore,graph,git

# Production mode (pre-built assets)
paradigm serve --production
```

### 3.2 Configuration

```yaml
# .paradigm/config.yaml (new section)
platform:
  port: 3850                           # Default port
  sections:                            # Toggle-able sections
    overview: true
    lore: true
    graph: true
    git: true
    sentinel: auto                     # "auto" = detect if @a-company/sentinel installed
    university: auto                   # "auto" = detect if @a-company/university installed
    symphony: auto                     # "auto" = detect if Symphony mailbox exists
    meetings: true                     # Requires graph + symphony
  theme: dark                          # "dark" | "light" | "system"
  git:
    defaultBranch: main
    showRemotes: true
    autoStage: false                   # Don't auto-stage on file save
  meetings:
    autoRecord: true                   # Auto-create lore entry on meeting end
    agentContext: true                  # Agents auto-surface context per symbol
    templates:                         # Meeting templates
      - standup
      - review
      - planning
  governance:
    voteDuration: 24h                  # Default vote open duration
    requireQuorum: false               # Require all participants to vote
    promiseDefaultDays: 7              # Default promise deadline (days)
```

---

## 4. Platform Shell (SPA)

### 4.1 Layout

```
┌─────────────────────────────────────────────────────────────────────┐
│  ● Paradigm Platform          a-paradigm (main)      ascend  ◑  ⚙  │
├──────┬──────────────────────────────────────────────────────────────┤
│      │                                                              │
│  ◉   │                     SECTION CONTENT                          │
│ Over │                                                              │
│      │     (Overview / Lore / Graph / Git / Sentinel /              │
│  📖  │      University / Symphony / Meetings)                       │
│ Lore │                                                              │
│      │                                                              │
│  ◎   │                                                              │
│ Graph│                                                              │
│      │                                                              │
│  ⎇   │                                                              │
│ Git  │                                                              │
│      │                                                              │
│  ◈   │                                                              │
│ Sent.│                                                              │
│      │                                                              │
│  🎓  │                                                              │
│ Uni  │                                                              │
│      │                                                              │
│  ♪   │                                                              │
│ Sym. │                                                              │
│      │                                                              │
│  ●   │                                                              │
│ Meet │                                                              │
│      │                                                              │
├──────┤                                                              │
│  ?   │                                                              │
│ Help │                                                              │
└──────┴──────────────────────────────────────────────────────────────┘

Header: project name, branch, user identity, theme toggle, settings
Sidebar: section icons with labels, collapsible, active indicator
Content: full-width section panel, swaps on navigation
```

### 4.2 Shell Components

```typescript
// platform-ui/src/App.tsx
interface PlatformShell {
  // Layout
  sidebar: SidebarNav              // Section navigation
  header: PlatformHeader           // Project info, user, settings
  content: SectionRouter           // Active section

  // State
  activeSection: SectionId
  availableSections: SectionId[]   // Based on config + detected packages
  presence: PresenceState          // Who's connected
  notifications: Notification[]    // Cross-section alerts
  theme: 'dark' | 'light'
}

type SectionId =
  | 'overview'
  | 'lore'
  | 'graph'
  | 'git'
  | 'sentinel'
  | 'university'
  | 'symphony'
  | 'meetings'
```

### 4.3 Routing

```
/                     → redirect to /overview
/overview             → Overview dashboard
/lore                 → Lore viewer (absorb lore-ui)
/lore/:id             → Lore entry detail
/graph                → Graph canvas (absorb graph-ui)
/graph/:symbolId      → Graph focused on symbol
/git                  → Git management
/git/branch/:name     → Branch detail
/git/commit/:sha      → Commit detail
/sentinel             → Sentinel dashboard (embedded)
/sentinel/:view       → Sentinel sub-view
/university           → University home (embedded)
/university/:path     → University sub-path
/symphony             → Symphony threads
/symphony/:threadId   → Thread detail
/meetings             → Meeting list
/meetings/:id         → Active/recorded meeting
/settings             → Platform settings
```

### 4.4 Shared Design System

All sections share a common design language. The Platform consolidates the CSS
custom properties already used across the four UIs.

```css
/* platform-ui/src/styles/tokens.css */
:root {
  /* Surface */
  --p-bg-primary: #0d1117;
  --p-bg-secondary: #161b22;
  --p-bg-tertiary: #21262d;
  --p-bg-hover: #30363d;

  /* Text */
  --p-text-primary: #e6edf3;
  --p-text-secondary: #8b949e;
  --p-text-muted: #484f58;

  /* Accent */
  --p-accent-blue: #58a6ff;
  --p-accent-green: #3fb950;
  --p-accent-red: #f85149;
  --p-accent-orange: #d29922;
  --p-accent-purple: #bc8cff;

  /* Symbols */
  --p-symbol-component: #58a6ff;    /* # */
  --p-symbol-flow: #3fb950;         /* $ */
  --p-symbol-gate: #f85149;         /* ^ */
  --p-symbol-signal: #d29922;       /* ! */
  --p-symbol-aspect: #bc8cff;       /* ~ */

  /* Governance */
  --p-vote-open: #58a6ff;
  --p-vote-approved: #3fb950;
  --p-vote-denied: #f85149;
  --p-promise-active: #d29922;
  --p-promise-fulfilled: #3fb950;
  --p-promise-broken: #f85149;

  /* Layout */
  --p-sidebar-width: 64px;
  --p-sidebar-expanded: 200px;
  --p-header-height: 48px;
  --p-panel-width: 380px;
  --p-radius: 6px;
  --p-transition: 150ms ease;
}

[data-theme="light"] {
  --p-bg-primary: #ffffff;
  --p-bg-secondary: #f6f8fa;
  --p-bg-tertiary: #eaeef2;
  --p-bg-hover: #d0d7de;
  --p-text-primary: #1f2328;
  --p-text-secondary: #656d76;
  --p-text-muted: #8b949e;
}
```

---

## 5. Section Specifications

### 5.1 Overview Dashboard

The landing page. Shows project health at a glance.

```
┌──────────────────────────────────────────────────────────────────┐
│  Overview                                           a-paradigm   │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐          │
│  │  27 symbols  │  │  143 lore    │  │  0.82 cal    │          │
│  │  #19 $3 ^5   │  │  12 this wk  │  │  ▲ from 0.78 │          │
│  └──────────────┘  └──────────────┘  └──────────────┘          │
│                                                                  │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐          │
│  │  4 tasks     │  │  1 alert     │  │  2 threads   │          │
│  │  2 in prog   │  │  #pay-svc ⚠  │  │  1 unread    │          │
│  └──────────────┘  └──────────────┘  └──────────────┘          │
│                                                                  │
│  ── Recent Activity ──────────────────────────────────────────  │
│                                                                  │
│  14:32  ascend committed "fix(#payment): serialize currency"    │
│  14:28  Lore: "Payment serializer regression" (0.85 confidence) │
│  14:15  Sentinel: 500 errors on #payment-service (resolved)     │
│  14:01  Symphony: thread "API contract update" resolved          │
│  13:45  Task "Add circuit breaker" created from governance vote  │
│                                                                  │
│  ── Health Score ─────────────────────────────────────────────  │
│                                                                  │
│  Purpose coverage:  94%  ████████████████████░░  (32/34 dirs)   │
│  Aspect anchors:   100%  █████████████████████  (no drift)      │
│  Gate compliance:   88%  ██████████████████░░░  (7/8 routes)    │
│  Calibration:      0.82  ████████████████░░░░  (good)           │
│  Lore freshness:    3d   ████████████████████░  (last entry)    │
│                                                                  │
│  ── Governance ───────────────────────────────────────────────  │
│                                                                  │
│  1 open vote: "Add circuit breaker to #payment-service"         │
│  2 active promises (1 due this week)                            │
│  0 denials blocking work                                        │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

#### API Endpoints

```typescript
// GET /api/platform/overview
interface OverviewResponse {
  project: {
    name: string
    branch: string
    discipline: string
  }
  symbols: {
    total: number
    byType: Record<string, number>    // component: 19, flow: 3, gate: 5...
  }
  lore: {
    total: number
    thisWeek: number
    lastEntry: string                 // ISO timestamp
  }
  calibration: {
    score: number                     // 0.0-1.0
    trend: number                     // delta from last period
    assessed: number                  // number of assessed entries
  }
  tasks: {
    total: number
    inProgress: number
    completed: number
  }
  alerts: {                           // from Sentinel, if available
    active: number
    symbols: string[]
  }
  threads: {                          // from Symphony, if available
    active: number
    unread: number
  }
  health: {
    purposeCoverage: number           // 0.0-1.0
    aspectAnchors: number             // 0.0-1.0
    gateCompliance: number            // 0.0-1.0
    calibration: number               // 0.0-1.0
    loreFreshnessDays: number
  }
  governance: {
    openVotes: number
    activePromises: number
    promisesDueThisWeek: number
    activeBlocks: number
  }
  recentActivity: ActivityItem[]
}

interface ActivityItem {
  timestamp: string
  type: 'commit' | 'lore' | 'sentinel' | 'symphony' | 'task' | 'governance'
  summary: string
  symbol?: string
  link?: string                       // Internal route to navigate to
}
```

### 5.2 Lore Section

Absorbs the existing `lore-ui/` — same 4 views (timeline, session, symbol, author),
same components, same Zustand store. The key change is that it runs inside the
Platform shell instead of as a standalone SPA.

**What changes:**
- `LoreApp` becomes a section component, not a root `<App />`
- API calls change from `localhost:3840/api/lore` to `/api/lore` (relative)
- Theme state delegates to the Platform shell store
- Deep links: `/lore/:id` replaces query param navigation
- New: cross-links to Graph (click a symbol → navigate to `/graph/#symbol`)
- New: cross-links to Sentinel events (click an incident ref → `/sentinel/incidents/:id`)

**What stays the same:**
- `LoreCard`, `DetailPanel`, `FilterBar`, `ViewSwitcher`, `SymbolTag`, `ReviewStars`
- `DateSeparator`, `VerificationBadge`
- `ThreadView`, `SessionView`, `SymbolView`, `AuthorView`
- `useLoreStore` (fetchers change base URL, state shape identical)

### 5.3 Graph Section

Absorbs the existing `graph-ui/` — same React Flow canvas, same node types, same
store. The Graph becomes the **centerpiece** of the Platform.

**What changes:**
- `GraphApp` becomes a section component
- API calls become relative
- New: **Symbol Context Panel** (right sidebar, Phase 3)
- New: **Collaborative cursors** (Phase 3)
- New: **Governance indicators** on nodes (votes, promises, denials)
- New: **Meeting mode** overlay (Phase 6)
- New: cross-links to all other sections via the Context Panel

**What stays the same:**
- `Canvas`, `SymbolNode`, `GroupNode`, `Toolbar`
- `ExportDialog`, `LoadDialog`, `SymbolPanel`
- `useGraphStore` with React Flow node/edge management
- LocalStorage persistence, drag-drop, group/ungroup

### 5.4 Git Section

**New.** A visual Git management interface for teams that want to manage branches,
commits, and PRs without leaving the Platform.

```
┌──────────────────────────────────────────────────────────────────┐
│  Git                                            main ⎇ 3 ahead  │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ── Branches ─────────────────────────────────────────────────  │
│                                                                  │
│  ● main              3 ahead     "fix(#payment): serialize..."  │
│    feature/auth       2 behind   "feat(#auth): add JWT..."      │
│    fix/sentinel-ui    up to date "fix(#sentinel): layout..."    │
│                                                                  │
│  ── Working Changes ──────────────────────────────────────────  │
│                                                                  │
│  Staged (3):                                                     │
│    M  src/core/payment.ts                                       │
│    M  src/core/payment.test.ts                                  │
│    A  src/core/.purpose                                          │
│                                                                  │
│  Unstaged (1):                                                   │
│    M  CHANGELOG.md                                               │
│                                                                  │
│  ── Diff ──────────────────────── src/core/payment.ts ────────  │
│                                                                  │
│  @@ -42,6 +42,9 @@                                              │
│    export function serialize(payment: Payment) {                 │
│  +   if (!payment.currency) {                                   │
│  +     payment.currency = 'USD';                                │
│  +   }                                                          │
│      return JSON.stringify(payment);                             │
│    }                                                             │
│                                                                  │
│  ── Commit ───────────────────────────────────────────────────  │
│                                                                  │
│  fix(#payment-service): [                                  ▼ ]  │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ default currency to USD when missing                     │   │
│  │                                                          │   │
│  │ Symbols: #payment-service, #serializer                   │   │
│  └──────────────────────────────────────────────────────────┘   │
│  [  Stage All  ]  [  Commit  ]  [  Push  ]                      │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

#### Features

- **Branch list**: name, ahead/behind count, last commit message, switch branch
- **Working changes**: staged/unstaged files, click to view diff
- **Diff viewer**: unified or split diff with syntax highlighting
- **Commit composer**: message editor with symbol autocomplete (`#`, `$`, `^`, `!`, `~`)
- **Symbol autocomplete**: type `#` and get suggestions from `scan-index.json`
- **PR creation**: title, body, base branch — calls `gh pr create` under the hood
- **Commit history**: paginated log with symbol extraction from commit messages

#### API Endpoints

```typescript
// GET /api/git/status
interface GitStatus {
  branch: string
  ahead: number
  behind: number
  staged: FileChange[]
  unstaged: FileChange[]
  untracked: string[]
}

// GET /api/git/branches
interface BranchInfo {
  name: string
  current: boolean
  ahead: number
  behind: number
  lastCommit: { sha: string; message: string; date: string }
}

// GET /api/git/log?limit=50&offset=0
interface CommitEntry {
  sha: string
  message: string
  author: string
  date: string
  symbols: string[]              // Extracted from commit message
  files: string[]
}

// GET /api/git/diff?path=src/core/payment.ts&staged=true
interface DiffResponse {
  path: string
  hunks: DiffHunk[]
}

// POST /api/git/stage
{ paths: string[] }

// POST /api/git/unstage
{ paths: string[] }

// POST /api/git/commit
{ message: string }

// POST /api/git/push
{ force?: boolean }              // Force requires explicit flag

// POST /api/git/checkout
{ branch: string; create?: boolean }

// POST /api/git/pr
{ title: string; body: string; base?: string }

// GET /api/git/symbols — autocomplete data from scan-index.json
interface SymbolAutocomplete {
  symbols: { id: string; type: string; path: string }[]
}
```

**Implementation note:** Uses `simple-git` (already a dependency in `packages/paradigm/`)
for all Git operations. No shell exec.

### 5.5 Sentinel Section (Optional)

Auto-detected when `@a-company/sentinel` is installed. Two strategies for embedding:

**Strategy A (preferred): Re-export as components**

Since Sentinel UI uses the same stack (React 18, Zustand, Vite), its view components
can be imported directly into Platform.

```typescript
// Import Sentinel views as components
import { LogsView, IncidentsView, FlowsView, EventsView } from '@a-company/sentinel/ui'

// Mount in Platform shell
<SentinelSection>
  <SentinelNav active={subView} />
  {subView === 'logs' && <LogsView />}
  {subView === 'incidents' && <IncidentsView />}
  {subView === 'flows' && <FlowsView />}
  {subView === 'events' && <EventsView />}
</SentinelSection>
```

This requires Sentinel to export its views as a sub-path:
```json
// @a-company/sentinel package.json
{
  "exports": {
    ".": "./dist/index.js",
    "./ui": "./ui/dist/components.js"
  }
}
```

**Strategy B (fallback): iframe**

If the React version diverges or component extraction isn't feasible:

```html
<iframe src="http://localhost:3838" style="width: 100%; height: 100%; border: none;" />
```

The Platform shell hides the sidebar and header when Sentinel is in iframe mode,
letting Sentinel's own UI fill the section.

**Cross-section integration:**
- Sentinel alerts → Platform notification bell
- Sentinel events on a symbol → shown in Graph Context Panel
- Sentinel incidents → linkable from Lore entries

### 5.6 University Section (Optional)

Auto-detected when `@a-company/university` is installed. Same embedding strategy
as Sentinel.

**Views absorbed:**
- `HomeView` → University landing
- `CoursesView` / `CourseView` → Course browser
- `PLSATView` / `QuizView` → Quiz system
- `CertificateView` → Diploma display
- `ReferenceView` → Reference cards

**Cross-section integration:**
- University content linked to symbols → shown in Graph Context Panel
- PLSAT scores feed into Overview health metrics
- University policies → referenced in Governance decisions

### 5.7 Symphony Section

Provides a UI for Symphony messaging. Replaces terminal-based `paradigm mail`
commands with a visual interface.

```
┌──────────────────────────────────────────────────────────────────┐
│  Symphony                                    3 agents online     │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ── Threads ──────────────────────── ── Thread Detail ────────  │
│                                      │                          │
│  ● Payment service 500s     (4)      │  thr-abc "Payment..."   │
│    API contract update      (2)      │                          │
│    Auth middleware refactor  (7)      │  14:32 Backend Opus      │
│                                      │  > Seeing 500s on POST   │
│  ── Network ──────────────────────   │  > /api/payments since   │
│                                      │  > the currency commit   │
│  ascend's MacBook (this)             │                          │
│    core  ● awake                     │  14:33 Frontend Opus     │
│    be    ● awake                     │  > Yes, I added the      │
│    fe    ○ asleep                    │  > currency field in     │
│                                      │  > commit abc123         │
│  jordan's MacBook (LAN)              │                          │
│    core  ● awake                     │  14:34 jordan/backend    │
│    be    ● awake                     │  > That breaks the       │
│                                      │  > migration — saw this  │
│                                      │  > last week             │
│                                      │                          │
│                                      │  14:35 ascend (human)    │
│                                      │  > Skip migration.       │
│                                      │  > Hotfix serializer.    │
│                                      │                          │
│                                      │  ┌──────────────────┐   │
│                                      │  │ Type a message... │   │
│                                      │  └──────────────────┘   │
│                                      │                          │
└──────────────────────────────────────┴──────────────────────────┘
```

**Features:**
- Thread list with unread counts
- Thread detail with full message history
- Compose box for human messages (sent via Symphony mailbox)
- Agent network status (who's awake, asleep, on which machine)
- File request/approval UI (replaces CLI `paradigm mail approve`)
- Thread resolution → triggers Lore entry creation

### 5.8 Meetings Section

Covered in detail in Phase 6. This is the "live session room" where structured
collaborative discussions happen around symbols.

---

## 6. WebSocket Protocol

### 6.1 Connection

```typescript
// Client connects
const ws = new WebSocket('ws://localhost:3850/ws')

// Identify on connect
ws.send(JSON.stringify({
  type: 'identify',
  payload: {
    userId: string,                    // Human identity
    name: string,                      // Display name
    section: SectionId,                // Current section
    agentId?: string                   // If this is an agent connection
  }
}))
```

### 6.2 Message Types

```typescript
type WSMessage =
  // Presence
  | { type: 'identify'; payload: IdentifyPayload }
  | { type: 'presence:update'; payload: PresenceUpdate }
  | { type: 'presence:list'; payload: PresenceState }

  // Section navigation
  | { type: 'navigate'; payload: { section: SectionId; path?: string } }

  // Live data updates
  | { type: 'lore:new'; payload: LoreEntry }
  | { type: 'lore:updated'; payload: LoreEntry }
  | { type: 'git:status'; payload: GitStatus }
  | { type: 'git:commit'; payload: CommitEntry }
  | { type: 'sentinel:alert'; payload: SentinelAlert }
  | { type: 'symphony:message'; payload: SymphonyMessage }
  | { type: 'overview:stats'; payload: OverviewResponse }

  // Graph collaboration
  | { type: 'graph:cursor'; payload: { userId: string; x: number; y: number } }
  | { type: 'graph:select'; payload: { userId: string; symbolId: string } }
  | { type: 'graph:follow'; payload: { targetUserId: string } }

  // Governance
  | { type: 'governance:vote:open'; payload: VoteRecord }
  | { type: 'governance:vote:cast'; payload: VoteCast }
  | { type: 'governance:vote:close'; payload: VoteResult }
  | { type: 'governance:promise'; payload: PromiseRecord }
  | { type: 'governance:deny'; payload: DenyRecord }

  // Meetings
  | { type: 'meeting:start'; payload: Meeting }
  | { type: 'meeting:join'; payload: { meetingId: string; userId: string } }
  | { type: 'meeting:agenda:next'; payload: { meetingId: string; symbolId: string } }
  | { type: 'meeting:end'; payload: { meetingId: string } }
  | { type: 'meeting:context'; payload: { meetingId: string; symbolId: string; context: SymbolContext } }

interface PresenceUpdate {
  userId: string
  name: string
  section: SectionId
  cursor?: { x: number; y: number }    // Graph canvas position
  selectedSymbol?: string
  status: 'active' | 'idle' | 'away'
  lastActivity: string
}

interface PresenceState {
  users: PresenceUpdate[]
}
```

### 6.3 Server-Side Watchers

The WebSocket server watches filesystem events and pushes updates:

```typescript
// File watchers → WebSocket broadcasts
interface PlatformWatchers {
  // Lore: watch .paradigm/lore/ for new/modified YAML files
  loreWatcher: FSWatcher

  // Git: poll git status every 2 seconds when changes detected
  gitPoller: NodeJS.Timer

  // Symphony: watch ~/.paradigm/score/*/inbox.jsonl for new messages
  symphonyWatcher: FSWatcher

  // Index: watch scan-index.json for symbol changes after reindex
  indexWatcher: FSWatcher

  // Sentinel: connect to Sentinel WS if available
  sentinelClient?: WebSocket
}
```

---

## 7. Governance System

### 7.1 Overview

Governance actions are first-class operations in the Platform. Every governance
action creates a lore entry, making decisions auditable and traceable.

Three governance primitives:

| Action | What it does | Creates |
|--------|-------------|---------|
| **Vote** | Collect team opinions on a decision | Lore entry (type: governance, subtype: vote) |
| **Promise** | Commit to doing something by a deadline | Lore entry + Task |
| **Deny** | Block something from happening with a reason | Lore entry + blocking record |

### 7.2 Vote

```typescript
interface VoteRecord {
  id: string                           // vote-{timestamp}-{hash}
  title: string                        // "Add circuit breaker to #payment-service"
  description?: string                 // Detailed proposal
  symbols: string[]                    // Affected symbols
  proposer: string                     // Who opened the vote
  options: VoteOption[]                // What to vote on
  status: 'open' | 'closed'
  deadline: string                     // ISO timestamp
  quorumRequired: boolean
  participants: string[]               // Expected voters
  votes: VoteCast[]
  result?: VoteResult
  loreEntryId?: string                 // Created when vote closes
  createdAt: string
  closedAt?: string
}

interface VoteOption {
  id: string
  label: string                        // "Yes", "No", "Defer"
  description?: string
}

interface VoteCast {
  voterId: string
  voterName: string
  optionId: string
  reason?: string
  timestamp: string
}

interface VoteResult {
  winning: string                      // Option ID
  tally: Record<string, number>        // optionId → count
  unanimous: boolean
  quorumMet: boolean
}
```

**Vote lifecycle:**

```
Open → Collect → Close → Record

1. Proposer opens vote with title, symbols, options, deadline
2. Vote appears in Overview governance section + Graph node badges
3. Participants cast votes (via Platform UI or Symphony message)
4. Vote closes (deadline or all voted) → result computed
5. Lore entry created with full vote record
6. If approved, optionally auto-creates task or updates symbol
```

**Default options (configurable):**
- `approve` — "Yes, do it"
- `deny` — "No, don't do it"
- `defer` — "Not now, revisit later"
- `abstain` — "No opinion"

### 7.3 Promise

```typescript
interface PromiseRecord {
  id: string                           // promise-{timestamp}-{hash}
  title: string                        // "Implement circuit breaker by Friday"
  description?: string
  symbols: string[]                    // What it affects
  promiser: string                     // Who's committing
  deadline: string                     // ISO timestamp
  status: 'active' | 'fulfilled' | 'broken' | 'withdrawn'
  taskId?: string                      // Auto-created task
  loreEntryId: string                  // Created on promise
  fulfilledAt?: string
  evidence?: string                    // Commit SHA, lore entry, etc.
}
```

**Promise lifecycle:**

```
Made → Active → Fulfilled | Broken | Withdrawn

1. Developer makes a promise with title, symbols, deadline
2. Task auto-created with same deadline
3. Promise badge appears on affected Graph nodes
4. On fulfillment: developer marks done with evidence (commit, PR, etc.)
5. On deadline pass without fulfillment: status → broken, visible in Overview
6. Lore entry updated with outcome
```

### 7.4 Deny

```typescript
interface DenyRecord {
  id: string                           // deny-{timestamp}-{hash}
  title: string                        // "Do NOT add Redis cache to #auth"
  reason: string                       // Why this is blocked
  symbols: string[]                    // What's blocked
  denier: string                       // Who blocked it
  status: 'active' | 'lifted'
  scope: 'symbol' | 'approach' | 'dependency'
  loreEntryId: string                  // Created on deny
  liftedAt?: string
  liftedBy?: string
  liftReason?: string
}
```

**Deny lifecycle:**

```
Declared → Active → Lifted

1. Developer or vote outcome creates a deny
2. Deny badge (red) appears on affected Graph nodes
3. Platform shows warning when navigating to denied symbols
4. Deny can be lifted by the denier or by a vote
5. Lore entry updated with lift record
```

### 7.5 Governance API Endpoints

```typescript
// POST /api/platform/governance/vote
{ title, description?, symbols, options?, deadline, participants? }

// POST /api/platform/governance/vote/:id/cast
{ optionId, reason? }

// POST /api/platform/governance/vote/:id/close
{}

// GET /api/platform/governance/votes?status=open
VoteRecord[]

// POST /api/platform/governance/promise
{ title, description?, symbols, deadline }

// POST /api/platform/governance/promise/:id/fulfill
{ evidence? }

// POST /api/platform/governance/promise/:id/withdraw
{ reason }

// GET /api/platform/governance/promises?status=active
PromiseRecord[]

// POST /api/platform/governance/deny
{ title, reason, symbols, scope }

// POST /api/platform/governance/deny/:id/lift
{ reason }

// GET /api/platform/governance/denies?status=active
DenyRecord[]

// GET /api/platform/governance/history?symbol=#payment-service
GovernanceEvent[]  // All votes, promises, denies affecting a symbol
```

### 7.6 Governance Storage

Governance records are stored as YAML files alongside lore:

```
.paradigm/governance/
  votes/
    vote-2026-03-14-abc123.yaml
  promises/
    promise-2026-03-14-def456.yaml
  denies/
    deny-2026-03-14-ghi789.yaml
```

Each governance action also creates a lore entry via `paradigm_lore_record` with:
- `type: governance`
- `tags: [governance, vote|promise|deny, arc:governance]`
- `symbols_touched` from the governance record
- `body` containing the full governance context

---

## 8. Graph Symbol Context Panel

### 8.1 Layout

When a symbol is selected on the Graph canvas, the Context Panel slides in from
the right edge:

```
┌─────────────────────────────────── Graph ─────┬─── Context ──────┐
│                                                │                  │
│                                                │ #payment-service │
│         ┌──────────────┐                       │ type: service    │
│         │ #api-gateway │                       │ tags: critical   │
│         └──────┬───────┘                       │                  │
│                │                               │ ── Lore ──────  │
│         ┌──────┴────────┐                      │ 5 entries        │
│         │ #payment-svc  │ ◄── selected         │ Latest: 2h ago  │
│         │   ⚠ alert     │                      │ Cal: 0.82       │
│         │   🗳 1 vote   │                      │                  │
│         └──────┬────────┘                      │ ── Tasks ─────  │
│                │                               │ 1 in progress    │
│         ┌──────┴────────┐                      │ "Add circuit     │
│         │ #serializer   │                      │  breaker"        │
│         └───────────────┘                      │                  │
│                                                │ ── Governance ─ │
│                                                │ 1 open vote      │
│                                                │ 1 active promise │
│                                                │                  │
│                                                │ ── Ripple ─────  │
│                                                │ 3 components     │
│                                                │ 1 flow affected  │
│                                                │                  │
│                                                │ ── Commits ────  │
│                                                │ abc1234 2h ago   │
│                                                │ def5678 1d ago   │
│                                                │                  │
└────────────────────────────────────────────────┴──────────────────┘
```

### 8.2 Context Panel Sections

```typescript
interface SymbolContext {
  // Identity
  symbol: string                       // #payment-service
  type?: string                        // service
  description: string
  path: string                         // File path
  tags: string[]
  parent?: string                      // Parent symbol

  // Lore
  lore: {
    total: number
    recent: LoreEntry[]                // Last 5
    calibration: number                // Average confidence accuracy
  }

  // Tasks
  tasks: {
    total: number
    inProgress: TaskItem[]
    recent: TaskItem[]
  }

  // Governance
  governance: {
    openVotes: VoteRecord[]
    activePromises: PromiseRecord[]
    activeDenies: DenyRecord[]
  }

  // Ripple
  ripple: {
    directDependents: string[]         // Symbols that reference this
    flowsAffected: string[]            // Flows containing this symbol
    gatesApplied: string[]             // Gates on routes involving this
  }

  // Git
  commits: {
    recent: CommitEntry[]              // Last 10 commits touching this symbol's files
  }

  // Sentinel (if available)
  sentinel?: {
    recentEvents: number
    activeAlerts: number
    lastError?: string
  }

  // University (if available)
  university?: {
    relatedContent: { id: string; title: string; type: string }[]
  }

  // Symphony (if available)
  symphony?: {
    activeThreads: { id: string; topic: string }[]
  }
}
```

### 8.3 Context Panel API

```typescript
// GET /api/platform/context/:symbolId
// Returns full SymbolContext, aggregated from all available sources

// Implementation: parallel queries to
//   - scan-index.json (identity)
//   - /api/lore?symbol=X (lore)
//   - .paradigm/tasks/ (tasks)
//   - .paradigm/governance/ (governance)
//   - paradigm_ripple result (ripple)
//   - simple-git log (commits)
//   - Sentinel API if available (sentinel)
//   - University API if available (university)
//   - Symphony mailbox if available (symphony)
```

---

## 9. Meeting System

### 9.1 Overview

Meetings are structured collaborative sessions centered on symbols. They combine
the Graph (as the visual workspace), Symphony (as the communication layer), and
Governance (as the decision-making framework) into a focused experience.

### 9.2 Meeting Structure

```typescript
interface Meeting {
  id: string                           // meeting-{timestamp}-{hash}
  title: string
  template?: MeetingTemplate           // standup, review, planning
  agenda: AgendaItem[]                 // Symbols to discuss
  participants: MeetingParticipant[]
  status: 'scheduled' | 'active' | 'ended'
  startedAt?: string
  endedAt?: string
  decisions: string[]                  // Accumulated decisions
  actions: string[]                    // Accumulated action items
  loreEntryId?: string                // Created on meeting end
}

interface AgendaItem {
  symbolId: string                     // The symbol to discuss
  topic?: string                       // Optional topic override
  duration?: number                    // Minutes
  status: 'pending' | 'active' | 'done'
  notes: string[]                      // Accumulated during discussion
  decisions: string[]
  votes: string[]                      // Vote IDs created during this item
}

interface MeetingParticipant {
  userId: string
  name: string
  type: 'human' | 'agent'
  joined: boolean
  role?: string                        // facilitator, observer, etc.
}

type MeetingTemplate = 'standup' | 'review' | 'planning' | 'retro' | 'custom'
```

### 9.3 Meeting Templates

```yaml
# Built-in templates

standup:
  title: "Daily Standup"
  duration: 15
  agenda: auto                         # Auto-populate from open tasks + recent lore
  sections:
    - "What did you do?"               # Shows recent commits + lore
    - "What will you do?"              # Shows task list
    - "Any blockers?"                  # Shows active denies + Sentinel alerts

review:
  title: "Code Review"
  duration: 30
  agenda: manual                       # User selects symbols
  sections:
    - "Changes overview"               # Shows diffs for agenda symbols
    - "Discussion"                     # Free-form per symbol
    - "Decisions"                      # Governance votes

planning:
  title: "Sprint Planning"
  duration: 60
  agenda: manual
  sections:
    - "Scope"                          # Select symbols to work on
    - "Dependencies"                   # Ripple analysis per symbol
    - "Assignments"                    # Promise creation
    - "Timeline"                       # Deadline setting

retro:
  title: "Retrospective"
  duration: 45
  agenda: auto                         # Auto-populate from recent lore + calibration
  sections:
    - "What went well?"                # High-confidence lore, fulfilled promises
    - "What didn't?"                   # Low-confidence, broken promises, incidents
    - "What to change?"                # Governance votes on process changes
```

### 9.4 Meeting Flow

```
1. Start Meeting
   └─ Select template or custom
   └─ Add symbols to agenda (or auto-populate)
   └─ Invite participants (humans + agents)

2. Meeting Active
   └─ Graph centers on first agenda symbol
   └─ Context Panel shows full symbol context
   └─ Agents auto-surface relevant info:
      ├─ Recent changes to this symbol
      ├─ Open Sentinel alerts
      ├─ Calibration trends
      ├─ Related University content
      └─ Active Symphony threads
   └─ Participants discuss (Symphony messages + voice via Conductor)
   └─ Facilitator can:
      ├─ Open a Vote on the current symbol
      ├─ Create a Promise
      ├─ Declare a Deny
      └─ Advance to next agenda item

3. Meeting Ends
   └─ Platform auto-generates comprehensive lore entry:
      ├─ All decisions made
      ├─ All votes and their outcomes
      ├─ All promises created
      ├─ All denies declared
      ├─ Participants list
      ├─ Duration
      └─ Per-symbol discussion notes
   └─ Tasks auto-created from promises
   └─ Meeting recording saved to .paradigm/meetings/
```

### 9.5 N-Party Participation

Meetings support any number of participants — humans and AI agents — limited only
by what the network and machines can handle:

```
Meeting: "Sprint Planning for v4"

Participants:
  Humans:
    ascend (facilitator) — this machine
    jordan — LAN peer
    morgan — LAN peer

  Agents:
    ascend/core — auto-joined (working on #core symbols)
    ascend/backend — auto-joined (working on #api symbols)
    jordan/frontend — auto-joined (working on #ui symbols)
    morgan/infra — auto-joined (working on #deploy symbols)
```

**Agent auto-context:** When the meeting advances to a new agenda symbol, all agents
with affinity for that symbol (they've recently touched it, or it's in their project)
automatically surface context via Symphony. The facilitator sees AI-provided summaries
appear in the Context Panel without asking.

### 9.6 Meeting Storage

```yaml
# .paradigm/meetings/meeting-2026-03-14-sprint-planning.yaml
id: meeting-2026-03-14-abc123
title: "Sprint Planning for v4"
template: planning
startedAt: "2026-03-14T14:00:00Z"
endedAt: "2026-03-14T14:58:00Z"
participants:
  - { userId: ascend, name: ascend, type: human, role: facilitator }
  - { userId: jordan, name: jordan, type: human }
  - { userId: ascend/core, name: "Core Opus", type: agent }
  - { userId: jordan/frontend, name: "Frontend Opus", type: agent }
agenda:
  - symbolId: "#payment-service"
    status: done
    notes:
      - "Needs circuit breaker (agreed)"
      - "Jordan's team will handle the retry logic"
    decisions:
      - "Add circuit breaker before v4 release"
    votes: ["vote-2026-03-14-abc"]
  - symbolId: "#auth-middleware"
    status: done
    notes:
      - "JWT rotation needs review"
    decisions:
      - "Defer JWT rotation to v4.1"
decisions:
  - "Add circuit breaker to #payment-service before v4"
  - "Defer JWT rotation to v4.1"
actions:
  - "ascend: implement circuit breaker (promise: 7 days)"
  - "jordan: review auth middleware test coverage"
loreEntryId: "L-2026-03-14-sprint-planning"
```

### 9.7 Meeting API Endpoints

```typescript
// POST /api/platform/meetings
{ title, template?, agenda: string[], participants?: string[] }

// GET /api/platform/meetings?status=active
Meeting[]

// GET /api/platform/meetings/:id
Meeting

// POST /api/platform/meetings/:id/join
{ userId }

// POST /api/platform/meetings/:id/agenda/next
{}  // Advance to next agenda item

// POST /api/platform/meetings/:id/note
{ text }

// POST /api/platform/meetings/:id/decision
{ text }

// POST /api/platform/meetings/:id/end
{}  // Triggers lore entry creation

// GET /api/platform/meetings/:id/context/:symbolId
SymbolContext  // Full context for agenda symbol
```

---

## 10. Presence System

### 10.1 How Presence Works

Every connected browser tab identifies on WebSocket connect. The server maintains
a presence map and broadcasts updates.

```typescript
interface PresenceManager {
  users: Map<string, PresenceState>
  connections: Map<string, WebSocket>

  // On WS connect → add to map, broadcast
  onConnect(ws: WebSocket, identity: IdentifyPayload): void

  // On WS disconnect → remove, broadcast
  onDisconnect(ws: WebSocket): void

  // On section change → update, broadcast
  onNavigate(userId: string, section: SectionId): void

  // On graph cursor move → throttled broadcast (60fps → 10fps)
  onCursorMove(userId: string, x: number, y: number): void

  // On symbol select → broadcast
  onSymbolSelect(userId: string, symbolId: string): void
}
```

### 10.2 Presence Indicators

```
Header:  [●ascend (Graph)]  [●jordan (Lore)]  [○morgan (away)]

Graph canvas: colored cursor dots with name labels
              selection halos on nodes (shared selection)

Context Panel: "jordan is also viewing this symbol"

Meeting: participant list with join status
```

### 10.3 Follow Mode

Any user can "follow" another user on the Graph canvas:

```typescript
// Click on a user's presence indicator → "Follow jordan"
ws.send({ type: 'graph:follow', payload: { targetUserId: 'jordan' } })

// Your viewport automatically mirrors their pan/zoom/selection
// Breaks when you interact with the canvas yourself
```

---

## 11. Implementation Phases

### Phase 0: Unified Shell + Absorb Existing UIs
> **Goal:** Single `paradigm serve` command, one browser tab, existing functionality preserved

**Server:**
- [ ] `packages/paradigm/src/platform-server/index.ts` — unified Express server
- [ ] Mount `LoreRouter`, `InfoRouter`, `SessionsRouter` at `/api/lore`, `/api/info`, `/api/sessions`
- [ ] Mount `SymbolsRouter`, `GraphsRouter` at `/api/symbols`, `/api/graphs`
- [ ] New `PlatformRouter` at `/api/platform` (overview endpoint)
- [ ] Serve `platform-ui/dist/` as SPA with catch-all route
- [ ] Auto-detect and mount Sentinel routes if `@a-company/sentinel` importable
- [ ] Auto-detect and mount University routes if `@a-company/university` importable
- [ ] Config: `platform` section in `.paradigm/config.yaml`

**CLI:**
- [ ] `paradigm serve` command in `packages/paradigm/src/commands/serve.ts`
- [ ] Port config (default 3850, flag `--port`)
- [ ] Auto-open browser (flag `--no-open` to disable)
- [ ] `--sections` flag for section filtering
- [ ] `paradigm lore serve` and `paradigm graph serve` continue working unchanged

**UI Shell:**
- [ ] `packages/paradigm/platform-ui/` — Vite + React 18 + Zustand
- [ ] `App.tsx` — shell layout with sidebar, header, content area
- [ ] `SidebarNav` — section icons, active indicator, collapsed/expanded
- [ ] `PlatformHeader` — project name, branch, theme toggle, settings link
- [ ] `SectionRouter` — lazy-loaded section components
- [ ] Shared design tokens (`tokens.css`)
- [ ] Theme support (dark/light/system)

**Absorb Lore UI:**
- [ ] Copy lore-ui components into `platform-ui/src/sections/lore/`
- [ ] Adapt `useLoreStore` to use relative API paths
- [ ] Replace standalone `<App />` with `<LoreSection />`
- [ ] Theme delegation to shell store
- [ ] Deep link routes: `/lore`, `/lore/:id`

**Absorb Graph UI:**
- [ ] Copy graph-ui components into `platform-ui/src/sections/graph/`
- [ ] Adapt `useGraphStore` to use relative API paths
- [ ] Replace standalone `<App />` with `<GraphSection />`
- [ ] Deep link routes: `/graph`, `/graph/:symbolId`

**Validation:**
- [ ] `paradigm serve` starts, opens browser, shows shell with sidebar
- [ ] Lore section shows all 4 views with full functionality
- [ ] Graph section shows canvas with full React Flow functionality
- [ ] Standalone `paradigm lore serve` and `paradigm graph serve` still work
- [ ] Sentinel/University sections appear if packages are installed
- [ ] Theme toggle works across all sections
- [ ] URL routing works (refresh on `/lore/L-2026-03-14-abc` loads the right view)

---

### Phase 1: Overview Dashboard + Git Management
> **Goal:** Project health at a glance + visual Git management without CLI

**Overview:**
- [ ] `OverviewSection` component
- [ ] `GET /api/platform/overview` endpoint (aggregates from index, lore, tasks, governance)
- [ ] Stat cards: symbols, lore, calibration, tasks, alerts, threads
- [ ] Health score bars: purpose coverage, aspect anchors, gate compliance, calibration, lore freshness
- [ ] Recent activity feed (merged timeline from commits, lore, Sentinel, Symphony)
- [ ] Governance summary: open votes, active promises, active blocks
- [ ] Auto-refresh via polling (every 30s) until WebSocket is added in Phase 2

**Git Section:**
- [ ] `GitSection` component
- [ ] `GitRouter` Express router at `/api/git/*`
- [ ] `simple-git` integration (already a dependency)
- [ ] Branch list: name, ahead/behind, last commit, switch button
- [ ] Working changes: staged/unstaged file lists with click-to-diff
- [ ] Diff viewer: unified diff with syntax highlighting (use `diff2html` or similar)
- [ ] Commit composer: textarea with symbol autocomplete
- [ ] Symbol autocomplete: type `#` → dropdown from `scan-index.json`
- [ ] Stage/unstage individual files or all
- [ ] Commit button (calls `simple-git.commit()`)
- [ ] Push button with ahead/behind indicator
- [ ] Commit history: paginated log with symbol extraction from messages
- [ ] PR creation form: title, body, base branch → calls `gh` CLI

**Validation:**
- [ ] Overview shows accurate symbol counts (matches `paradigm_status`)
- [ ] Overview health scores match `paradigm doctor` output
- [ ] Git section shows correct branch, staged/unstaged files
- [ ] Can stage, commit, and push from the browser
- [ ] Symbol autocomplete works in commit message composer
- [ ] Diff viewer shows correct hunks for selected file
- [ ] PR creation works (creates real PR via `gh`)
- [ ] Commit history shows symbols extracted from messages

---

### Phase 2: WebSocket + Presence + Live Updates
> **Goal:** Real-time — no more polling, collaborative awareness

**WebSocket Server:**
- [ ] `/ws` endpoint on the same Express server (upgrade handler)
- [ ] `PresenceManager` — tracks connected users, sections, cursors
- [ ] `identify` message on connect
- [ ] Broadcast `presence:list` on connect/disconnect/navigate
- [ ] Connection heartbeat (30s ping/pong)
- [ ] Graceful reconnection on client side (exponential backoff)

**File Watchers:**
- [ ] Watch `.paradigm/lore/` → broadcast `lore:new` / `lore:updated`
- [ ] Watch `scan-index.json` → broadcast `overview:stats`
- [ ] Watch `.paradigm/tasks/` → broadcast task updates
- [ ] Poll `git status` every 2s when git section active → broadcast `git:status`
- [ ] Poll `git log` on new commits → broadcast `git:commit`
- [ ] Watch `~/.paradigm/score/*/inbox.jsonl` → broadcast `symphony:message`

**Sentinel Bridge:**
- [ ] If Sentinel is running, connect Platform WS to Sentinel WS
- [ ] Forward Sentinel alerts as `sentinel:alert` messages
- [ ] Show Sentinel alerts as Platform notifications (toast)

**Client Integration:**
- [ ] `usePlatformStore` — WebSocket connection, presence state, notifications
- [ ] `usePresence()` hook — current users, their sections
- [ ] `useLiveData()` hook — subscribe to data updates by type
- [ ] Replace polling in Overview with WebSocket updates
- [ ] Replace polling in Git with WebSocket updates
- [ ] Notification toast system (Sentinel alerts, new lore, Symphony messages)
- [ ] Presence indicators in header bar

**Validation:**
- [ ] Two browser tabs show each other's presence in header
- [ ] New lore entry (from CLI) appears in Lore section without refresh
- [ ] Git status updates live when files change on disk
- [ ] Sentinel alert appears as a notification toast
- [ ] Symphony message notification appears in real-time
- [ ] Reconnection works after network interruption

---

### Phase 3: Interactive Graph + Symbol Context Panel
> **Goal:** Graph as the centerpiece — click a symbol, see everything about it

**Context Panel:**
- [ ] `ContextPanel` component — slides in from right on symbol selection
- [ ] Sections: Lore, Tasks, Governance, Ripple, Commits, Sentinel, University, Symphony
- [ ] `GET /api/platform/context/:symbolId` — aggregated context endpoint
- [ ] Each section is collapsible, lazy-loaded
- [ ] Cross-links: click a lore entry → navigate to `/lore/:id`
- [ ] Cross-links: click a commit → navigate to `/git/commit/:sha`
- [ ] Cross-links: click a Symphony thread → navigate to `/symphony/:threadId`

**Collaborative Cursors:**
- [ ] Graph cursor position broadcast via WebSocket (throttled to 10fps)
- [ ] Colored cursor dots with name labels on canvas
- [ ] Selection halos — when another user selects a node, you see a colored ring
- [ ] "Following jordan..." indicator when in follow mode

**Symbol Selection Sync:**
- [ ] Click a node → broadcast `graph:select` to all users
- [ ] Context Panel shows "jordan is also viewing this" when multiple users select same node
- [ ] Follow mode: click another user → your viewport tracks theirs

**Graph Enhancements:**
- [ ] Governance badges on nodes: vote indicator, promise indicator, deny indicator
- [ ] Sentinel alert badge on nodes (red glow/icon for active alerts)
- [ ] Lore freshness indicator (dim nodes with stale lore)
- [ ] Discussion thread count on nodes (from Symphony)

**Validation:**
- [ ] Click symbol on Graph → Context Panel appears with full context
- [ ] Context Panel shows lore, tasks, governance, ripple, commits
- [ ] Two users see each other's cursors on the Graph
- [ ] Follow mode works (viewport tracks followed user)
- [ ] Governance badges appear on affected nodes
- [ ] Cross-section links work (click lore entry → navigates to Lore section)

---

### Phase 4: Governance Actions
> **Goal:** Vote, Promise, Deny as first-class operations

**Governance Backend:**
- [ ] `GovernanceRouter` at `/api/platform/governance/*`
- [ ] YAML storage in `.paradigm/governance/` (votes, promises, denies)
- [ ] Vote lifecycle: open → collect → close → record
- [ ] Promise lifecycle: made → active → fulfilled/broken/withdrawn
- [ ] Deny lifecycle: declared → active → lifted
- [ ] Auto-create lore entry for every governance action
- [ ] Auto-create task for promises
- [ ] WebSocket broadcasts for all governance events

**Governance UI:**
- [ ] "Open Vote" dialog — title, description, symbols, options, deadline
- [ ] Vote view — see proposals, cast vote, see results
- [ ] "Make Promise" dialog — title, symbols, deadline
- [ ] Promise tracker — active promises, due dates, status
- [ ] "Declare Deny" dialog — title, reason, symbols, scope
- [ ] Deny indicators — red badges on Graph nodes, warnings in Context Panel

**Overview Integration:**
- [ ] Governance section in Overview: open votes, active promises, due dates, blocks
- [ ] Quick actions from Overview: vote, fulfill promise, lift deny

**Graph Integration:**
- [ ] Governance badges on symbol nodes
- [ ] Right-click symbol → "Open Vote", "Make Promise", "Deny"
- [ ] Context Panel governance section with full history

**Validation:**
- [ ] Can open a vote, cast votes, close vote → lore entry created
- [ ] Can make a promise → task auto-created with deadline
- [ ] Can declare a deny → red badge on Graph node
- [ ] Governance events broadcast via WebSocket (all users see updates)
- [ ] Governance history visible in Context Panel for affected symbols
- [ ] Promise deadline passing → status changes to broken

---

### Phase 5: Sentinel + University + Symphony Deep Integration
> **Goal:** Optional sections fully wired — not just embedded, connected

**Sentinel Integration:**
- [ ] Component re-export strategy (preferred) or iframe fallback
- [ ] Sentinel views mounted at `/sentinel/*` routes
- [ ] Sentinel events → Platform notification system
- [ ] Sentinel alerts → red badges on Graph nodes
- [ ] Sentinel event count in Context Panel per symbol
- [ ] Sentinel incident links from Lore entries

**University Integration:**
- [ ] Component re-export or iframe fallback
- [ ] University views mounted at `/university/*` routes
- [ ] Related University content in Context Panel per symbol
- [ ] PLSAT scores in Overview health metrics
- [ ] University policies referenced in Governance decisions

**Symphony Integration:**
- [ ] `SymphonySection` component — thread list, thread detail, compose
- [ ] Thread list with unread indicators
- [ ] Thread detail with full message history and participant avatars
- [ ] Compose box for human messages
- [ ] File request/approval UI (approve/deny with preview)
- [ ] Agent network status panel
- [ ] Symphony threads in Context Panel per symbol
- [ ] New Symphony messages → Platform notification

**Cross-Section Linking:**
- [ ] Symbol click in any section → option to "View in Graph"
- [ ] Lore entry mentions `#symbol` → clickable link to Graph
- [ ] Sentinel event on `#symbol` → clickable link to Graph
- [ ] University content for `#symbol` → clickable link to Graph
- [ ] Symphony thread about `#symbol` → clickable link to Graph
- [ ] Graph Context Panel links to every other section

**Validation:**
- [ ] Sentinel section loads with all 6 views
- [ ] University section loads with all 7 views
- [ ] Symphony section shows threads, messages, network status
- [ ] Can compose and send a Symphony message from the browser
- [ ] Can approve/deny file requests from the browser
- [ ] Cross-section links work in all directions
- [ ] Sentinel alert on `#X` → red badge on Graph node `#X`
- [ ] University content for `#X` → shows in Context Panel for `#X`

---

### Phase 6: Live Collaborative Meetings
> **Goal:** Structured discussions around symbols with automatic recording

**Meeting Backend:**
- [ ] `MeetingRouter` at `/api/platform/meetings/*`
- [ ] Meeting storage in `.paradigm/meetings/`
- [ ] Meeting lifecycle: scheduled → active → ended
- [ ] Auto-generate lore entry on meeting end
- [ ] Auto-create tasks from promises made during meeting
- [ ] WebSocket broadcasts for all meeting events

**Meeting UI:**
- [ ] "Start Meeting" button in Graph toolbar
- [ ] Meeting creation dialog: template, agenda symbols, participants
- [ ] Meeting mode overlay on Graph: agenda sidebar, current symbol focus
- [ ] Timer per agenda item
- [ ] Notes, decisions, and actions capture per item
- [ ] Quick governance actions: "Open Vote", "Make Promise" in meeting context
- [ ] "End Meeting" → summary preview → lore entry creation

**Agent Auto-Context:**
- [ ] When meeting advances to a symbol, broadcast to Symphony
- [ ] Agents with affinity for the symbol auto-surface context
- [ ] Context appears in Meeting Context Panel (same as Graph Context Panel, meeting-scoped)
- [ ] Agent suggestions formatted as meeting-friendly summaries

**Meeting Templates:**
- [ ] Built-in: standup, review, planning, retro
- [ ] Custom templates via config
- [ ] Auto-populate agenda from recent activity (standup), tasks (planning), calibration (retro)

**N-Party Support:**
- [ ] Any number of humans via browser
- [ ] Any number of agents via Symphony
- [ ] Participant list with join/leave tracking
- [ ] Role assignment: facilitator, observer
- [ ] Human messages via Platform text input + Conductor voice
- [ ] Agent messages via Symphony (rendered in meeting thread)

**Validation:**
- [ ] Can start a meeting with 3 symbols on the agenda
- [ ] Meeting advances through agenda items, Graph follows
- [ ] Agent auto-surfaces context when symbol changes
- [ ] Can open vote, make promise during meeting
- [ ] Meeting end creates comprehensive lore entry
- [ ] Lore entry includes all decisions, votes, promises, participants
- [ ] Multiple humans + agents participate simultaneously
- [ ] Meeting recording saved to `.paradigm/meetings/`

---

### Phase 7: Methodology + Manifesto + Certification
> **Goal:** Paradigm as a methodology — measurable, learnable, certifiable

**Manifesto Page:**
- [ ] `ManifestoSection` — renders `docs/MANIFESTO.md` (created separately)
- [ ] Core values and principles
- [ ] The Paradigm philosophy: symbols as the shared language of software
- [ ] Links to external docs, talks, posts

**Adoption Ladder:**
- [ ] Four levels: Individual → Team → Organization → Industry
- [ ] Each level has measurable criteria:

```
Individual:
  - Purpose coverage > 80%
  - Regular lore entries (weekly)
  - Calibration score tracked
  - Symbol-aware commits

Team:
  - All team members on Platform
  - Governance actions used (votes, promises)
  - Meetings conducted via Platform
  - Symphony threads for cross-cutting decisions

Organization:
  - Workspaces configured across projects
  - University content maintained
  - Certification tracked per team member
  - Health reports reviewed monthly

Industry:
  - Paradigm methodology published
  - Conference talks / blog posts
  - Contributing to paradigm open source
  - Mentoring other adopters
```

**Certification:**
- [ ] Based on real usage metrics, not just quizzes
- [ ] Metrics tracked:
  - Purpose coverage history
  - Calibration accuracy over time
  - Governance participation rate
  - Lore contribution frequency
  - Meeting attendance
  - PLSAT scores (from University)
- [ ] Certification levels: Practitioner, Contributor, Architect, Master
- [ ] Certification page shows progress per team member

**Team Health Reports:**
- [ ] Weekly/monthly auto-generated reports
- [ ] Metrics: symbol growth, lore volume, calibration trend, governance activity
- [ ] Adoption trend: are we using more Platform features over time?
- [ ] Comparison across team members (anonymous option)
- [ ] Exportable as Markdown or PDF

**Validation:**
- [ ] Manifesto page renders beautifully
- [ ] Adoption ladder shows current level with progress indicators
- [ ] Certification criteria are measurable from Platform data
- [ ] Team health report generates with accurate metrics
- [ ] Report shows meaningful trends over time

---

## 12. Package Structure

### 12.1 New Files

```
packages/paradigm/
  platform-ui/                         # New SPA
    src/
      App.tsx                          # Shell layout
      main.tsx                         # Entry point
      styles/
        tokens.css                     # Design tokens
        shell.css                      # Shell layout styles
      components/
        SidebarNav.tsx
        PlatformHeader.tsx
        SectionRouter.tsx
        NotificationToast.tsx
        PresenceIndicators.tsx
      sections/
        overview/
          OverviewSection.tsx
          StatCard.tsx
          HealthBars.tsx
          ActivityFeed.tsx
          GovernanceSummary.tsx
        lore/                          # Absorbed from lore-ui/
          LoreSection.tsx
          ... (existing components)
        graph/                         # Absorbed from graph-ui/
          GraphSection.tsx
          ContextPanel.tsx             # New (Phase 3)
          GovernanceBadges.tsx         # New (Phase 4)
          MeetingOverlay.tsx           # New (Phase 6)
          CollaborativeCursors.tsx     # New (Phase 3)
          ... (existing components)
        git/                           # New (Phase 1)
          GitSection.tsx
          BranchList.tsx
          WorkingChanges.tsx
          DiffViewer.tsx
          CommitComposer.tsx
          SymbolAutocomplete.tsx
          CommitHistory.tsx
          PrCreator.tsx
        sentinel/                      # Wrapper (Phase 5)
          SentinelSection.tsx
        university/                    # Wrapper (Phase 5)
          UniversitySection.tsx
        symphony/                      # New (Phase 5)
          SymphonySection.tsx
          ThreadList.tsx
          ThreadDetail.tsx
          ComposeBox.tsx
          NetworkStatus.tsx
          FileApproval.tsx
        meetings/                      # New (Phase 6)
          MeetingsSection.tsx
          MeetingCreator.tsx
          MeetingOverlay.tsx
          AgendaSidebar.tsx
          MeetingRecording.tsx
        methodology/                   # New (Phase 7)
          ManifestoSection.tsx
          AdoptionLadder.tsx
          CertificationPage.tsx
          HealthReport.tsx
      store/
        platformStore.ts               # Shell state, theme, navigation
        presenceStore.ts               # WebSocket presence
        governanceStore.ts             # Votes, promises, denies
        meetingStore.ts                # Meeting state
      hooks/
        useWebSocket.ts                # WS connection + reconnection
        usePresence.ts                 # Presence data
        useLiveData.ts                 # Subscribe to live updates
    vite.config.ts
    index.html

  src/
    platform-server/                   # New unified server
      index.ts                         # createPlatformApp, startPlatformServer
      routes/
        platform.ts                    # /api/platform/overview, /api/platform/context
        git.ts                         # /api/git/*
        governance.ts                  # /api/platform/governance/*
        meetings.ts                    # /api/platform/meetings/*
      ws/
        index.ts                       # WebSocket upgrade handler
        presence.ts                    # PresenceManager
        watchers.ts                    # File watchers → WS broadcasts
      utils/
        detect-packages.ts             # Auto-detect Sentinel, University
        health-score.ts                # Calculate project health metrics
    commands/
      serve.ts                         # `paradigm serve` CLI command

.paradigm/
  governance/                          # New governance storage
    votes/
    promises/
    denies/
  meetings/                            # New meeting recordings
```

### 12.2 Existing Files Modified

```
packages/paradigm/
  package.json                         # Add dependencies: diff2html, ws types
  src/index.ts                         # Register `serve` command
  lore-ui/                             # Unchanged (standalone still works)
  graph-ui/                            # Unchanged (standalone still works)

packages/sentinel/
  package.json                         # Add "exports": { "./ui": "..." }

packages/university/
  package.json                         # Add "exports": { "./ui": "..." }

.paradigm/config.yaml                  # Add `platform:` section
```

### 12.3 Dependencies

```json
{
  "new-dependencies": {
    "ws": "^8.19.0",              // Already in sentinel, add to paradigm
    "diff2html": "^3.4.0",       // Diff rendering for Git section
    "chokidar": "^4.0.0",        // File watching (may already be transitive)
    "simple-git": "^3.0.0"       // Already a dependency
  },
  "existing-shared": {
    "express": "^5.2.1",
    "react": "^18",
    "react-dom": "^18",
    "zustand": "^5",
    "@xyflow/react": "^12",
    "vite": "^6"
  }
}
```

---

## 13. Security Considerations

### 13.1 Local-First

The Platform server binds to `localhost` by default. No remote access unless
explicitly configured:

```yaml
# .paradigm/config.yaml
platform:
  host: "127.0.0.1"               # Default: localhost only
  # host: "0.0.0.0"               # Uncomment for LAN access
```

### 13.2 Git Operations

All Git operations go through `simple-git` — no shell exec, no command injection.
Destructive operations require explicit confirmation:

- **Force push**: requires `force: true` in request body + confirmation dialog in UI
- **Branch delete**: confirmation dialog with branch name input
- **Reset**: not exposed via Platform API (use terminal)
- **Rebase**: not exposed via Platform API (use terminal)

The Git API is intentionally limited to safe operations. Complex Git workflows
stay in the terminal.

### 13.3 WebSocket Authentication

For localhost mode, no auth is needed (same machine). For LAN mode:

```yaml
platform:
  auth:
    enabled: true                  # Required when host != localhost
    secret: "..."                  # Shared secret for WS handshake
```

WebSocket connections present the secret in the initial `identify` message.
Connections without valid auth are rejected.

### 13.4 Governance Integrity

Governance records are YAML files in the repo. They're committed alongside code,
making them:
- **Auditable** — full git history of every vote, promise, deny
- **Tamper-evident** — modifying a closed vote shows in git blame
- **Portable** — clone the repo, get the full governance history

### 13.5 Meeting Privacy

Meeting recordings are stored locally in `.paradigm/meetings/`. They include:
- Discussion notes (what participants typed/said)
- Decisions made
- Votes and their outcomes
- Participant list

They do NOT include:
- Raw audio (Conductor voice is not recorded, only transcribed decisions)
- Screen content
- File contents (only references)

Meeting recordings can be excluded from git via `.gitignore` if privacy is a concern.

---

## 14. Existing Infrastructure Leverage

### What we already have → What it becomes in Platform

| Existing | Platform Role |
|----------|--------------|
| **Lore UI** (15 components, 4 views) | Absorbed into Lore section as-is |
| **Graph UI** (11 components, React Flow) | Absorbed into Graph section + extended |
| **Sentinel UI** (31 components, 6 views) | Mounted as optional section |
| **University UI** (18 components, 7 views) | Mounted as optional section |
| **Lore Express server** (3 routers) | Route handlers mounted at same paths |
| **Graph Express server** (2 routers) | Route handlers mounted at same paths |
| **Sentinel Express server** (11 routers + WS) | Optional mount + WS bridge |
| **University Express server** (2 routers) | Optional mount |
| **Zustand stores** (all UIs) | Same stores, adapted for Platform shell |
| **CSS custom properties** (all UIs) | Consolidated into shared design tokens |
| **Vite build** (all UIs) | Single Vite config for platform-ui |
| **`simple-git`** (CLI dependency) | Powers Git section API |
| **`scan-index.json`** | Symbol autocomplete in Git + Overview stats |
| **Symphony mailboxes** (JSONL) | Powers Symphony section + notifications |
| **Lore YAML** (`.paradigm/lore/`) | Powers Overview + Context Panel |
| **Tasks YAML** (`.paradigm/tasks/`) | Powers Overview + Context Panel |
| **`paradigm_ripple`** | Powers Context Panel ripple section |

### What's genuinely new

| New Component | Package | Effort |
|---------------|---------|--------|
| `platform-server/` | paradigm (TS) | Medium — server scaffold, route mounting |
| `PlatformRouter` | paradigm (TS) | Small — overview + context aggregation |
| `GitRouter` | paradigm (TS) | Medium — simple-git wrapper endpoints |
| `GovernanceRouter` | paradigm (TS) | Medium — vote/promise/deny lifecycle |
| `MeetingRouter` | paradigm (TS) | Medium — meeting lifecycle + lore creation |
| WebSocket server | paradigm (TS) | Medium — presence, watchers, broadcasts |
| `platform-ui/` shell | paradigm (React) | Medium — sidebar, header, routing |
| Git section | paradigm (React) | Large — branches, diff, commit, PR |
| Context Panel | paradigm (React) | Medium — aggregated symbol context |
| Collaborative cursors | paradigm (React) | Small — WS position broadcast |
| Governance UI | paradigm (React) | Medium — vote/promise/deny dialogs |
| Meeting UI | paradigm (React) | Large — overlay, agenda, recording |
| Symphony UI | paradigm (React) | Medium — threads, compose, network |
| Methodology pages | paradigm (React) | Small — manifesto, adoption, cert |

---

## 15. Configuration Reference

### Full Platform Config

```yaml
# .paradigm/config.yaml — platform section
platform:
  # Server
  port: 3850
  host: "127.0.0.1"                   # "0.0.0.0" for LAN

  # Sections
  sections:
    overview: true
    lore: true
    graph: true
    git: true
    sentinel: auto                     # auto | true | false
    university: auto
    symphony: auto
    meetings: true
    methodology: true

  # Theme
  theme: dark                          # dark | light | system

  # Git
  git:
    defaultBranch: main
    showRemotes: true
    autoStage: false
    dangerousOperations: false         # Enable force push, branch delete

  # Governance
  governance:
    voteDuration: 24h
    requireQuorum: false
    promiseDefaultDays: 7
    voteOptions:                       # Default options for all votes
      - { id: approve, label: "Approve" }
      - { id: deny, label: "Deny" }
      - { id: defer, label: "Defer" }
      - { id: abstain, label: "Abstain" }

  # Meetings
  meetings:
    autoRecord: true                   # Auto-create lore on meeting end
    agentContext: true                  # Agents auto-surface context
    templates:
      - standup
      - review
      - planning
      - retro

  # WebSocket
  ws:
    heartbeatInterval: 30000           # ms
    cursorThrottle: 100                # ms (10fps)

  # Auth (for LAN mode)
  auth:
    enabled: false
    secret: ""
```

---

## 16. Metrics & Observability

Platform emits its own metrics. If Sentinel is available, they're forwarded
automatically. Otherwise, logged to console.

| Metric | Type | Description |
|--------|------|-------------|
| `platform.connections` | gauge | Active WebSocket connections |
| `platform.presence.users` | gauge | Users currently online |
| `platform.sections.active` | gauge | Sections currently being viewed |
| `platform.git.commits` | counter | Commits made via Platform |
| `platform.git.prs` | counter | PRs created via Platform |
| `platform.governance.votes` | counter | Votes opened |
| `platform.governance.promises` | counter | Promises made |
| `platform.governance.denies` | counter | Denies declared |
| `platform.meetings.started` | counter | Meetings started |
| `platform.meetings.duration` | histogram | Meeting duration (minutes) |
| `platform.meetings.decisions` | counter | Decisions made in meetings |
| `platform.context.queries` | counter | Context Panel queries |
| `platform.ws.messages` | counter | WebSocket messages sent |
| `platform.ws.reconnections` | counter | Client reconnections |

---

## 17. Open Questions

1. **Port allocation** — Should Platform subsume all existing ports (3838-3841)
   or coexist? If a user runs both `paradigm serve` and `paradigm lore serve`,
   do they share data cleanly?
   *Recommendation:* Coexist. Platform reads from the same files — no data
   conflict. Users choose which interface they prefer per situation.

2. **Build strategy** — Should platform-ui bundle sentinel-ui and university-ui
   components at build time, or load them dynamically?
   *Recommendation:* Dynamic import with fallback. `import('@a-company/sentinel/ui')`
   catches if not installed and shows "Install @a-company/sentinel to enable" message.

3. **Governance quorum** — What happens when a vote closes without all participants
   voting? Is the result valid?
   *Recommendation:* Configurable. Default: result is valid based on who voted.
   Optional: require quorum (all must vote). Abstentions count as participation.

4. **Meeting recording granularity** — Should meetings record every Symphony
   message or just decisions/notes?
   *Recommendation:* Full thread is stored (it's in Symphony JSONL anyway).
   The lore entry summarizes decisions/actions. The meeting YAML stores the
   complete record.

5. **Graph as homepage** — Should `/` redirect to `/overview` or `/graph`?
   *Recommendation:* `/overview` as default. Graph is the centerpiece when you're
   working, but Overview is the right first screen. Configurable via `platform.defaultSection`.

6. **Offline agents** — When an agent goes offline during a meeting, how do we
   handle its unfinished context?
   *Recommendation:* Mark as "disconnected" in participant list. Don't block
   the meeting. Agent can catch up via Symphony thread when it comes back online.

7. **Governance retroactivity** — Can governance actions reference past work
   (deny something that was already merged)?
   *Recommendation:* Yes. A Deny is a record of "we decided not to do this."
   It can be applied retroactively to document regret or future avoidance.
   It doesn't undo code — it records intent.

---

## 18. Success Criteria

### Phase 0 (Unified Shell)
- `paradigm serve` starts a single server on port 3850
- All Lore functionality works in the Platform (4 views, filters, detail panel)
- All Graph functionality works (canvas, drag-drop, export, save)
- Sidebar navigation works, URL routing works
- Theme toggle works across all sections
- Standalone `paradigm lore serve` and `paradigm graph serve` still work

### Phase 1 (Overview + Git)
- Overview shows accurate project health metrics
- Can view branches, stage files, write commits, push — all from browser
- Symbol autocomplete works in commit messages
- PR creation produces a real GitHub PR

### Phase 2 (WebSocket + Presence)
- Two tabs show each other in real-time
- File changes on disk appear in UI without refresh
- Sentinel alerts appear as notifications
- Reconnection is seamless after network blip

### Phase 3 (Interactive Graph)
- Click symbol → Context Panel with lore, tasks, governance, ripple, commits
- Two users see each other's cursors on Graph
- Follow mode tracks another user's viewport
- Governance badges visible on affected nodes

### Phase 4 (Governance)
- Vote lifecycle: open → cast → close → lore entry
- Promise lifecycle: make → active → fulfill/break → lore + task
- Deny lifecycle: declare → active → lift → lore
- All governance actions visible on Graph nodes and in Overview

### Phase 5 (Integration)
- Sentinel/University sections load when packages are installed
- Symphony section shows threads and supports compose
- Cross-section links work (any symbol reference → clickable)
- File requests can be approved/denied from browser

### Phase 6 (Meetings)
- Start meeting → agenda → discussion → decisions → lore entry
- N-party: multiple humans and agents participate
- Agent auto-context surfaces on agenda item change
- Meeting templates populate intelligently

### Phase 7 (Methodology)
- Manifesto page renders
- Adoption ladder shows measurable progress
- Certification criteria backed by Platform data
- Health reports generate with accurate trends

---

## 19. Relationship to Other Specs

| Spec | Relationship |
|------|-------------|
| **Symphony** (`symphony.md`) | Platform provides the UI for Symphony threads. Symphony provides the communication layer for meetings. |
| **Personas** (`personas.md`) | Personas can be run from Platform — results feed into Context Panel and meetings. |
| **Workspaces** (`workspaces.md`) | Platform's Overview can show workspace-wide health. Cross-project symbols appear in Graph. |
| **Smart Drift** (`smart-drift-detection.md`) | Drift status feeds into Overview health score and Context Panel warnings. |
| **University** (`university-revamp.md`) | University is an optional Platform section. Certification uses University quiz data. |
| **MANIFESTO** (`docs/MANIFESTO.md`) | Referenced from the Methodology section. Not created in this spec — stands alone. |

---

## 20. Future Considerations

### Cloud Hosting (Separate Proposal)

Running the Platform on a cloud server instead of localhost would enable:
- Remote team members without LAN access
- Persistent presence (server always on)
- Centralized governance records
- Mobile access

This is a separate proposal document. The Platform spec deliberately avoids
cloud assumptions — everything works local-first.

### P2P / WebRTC (Separate Proposal)

Direct browser-to-browser connections for:
- Cursor sync without a central server
- Voice/video in meetings
- Peer-to-peer governance (no single point of failure)

This is a separate proposal. The current spec uses a single WebSocket server
on one machine. P2P is an enhancement, not a replacement.

### Mobile Companion App

A read-only mobile view of the Overview dashboard:
- Health metrics on your phone
- Governance notifications (vote needed, promise due)
- Meeting join from mobile

Not specced here — future consideration after the desktop Platform stabilizes.

---

## 21. Agent-Driven UI

The AI agent can drive the Platform UI in real-time — navigating sections, selecting
symbols, highlighting elements, placing annotations, and sending toasts. The Platform
becomes the agent's "body" in the collaboration space. The user watches the agent
point at things, walk through code, and present decisions visually.

### 21.1 Architecture: MCP → HTTP → WebSocket → Browser

```
Agent (Claude Code)              Platform Server              Browser
      │                                  │                        │
      │  paradigm_platform_navigate      │                        │
      │  POST /api/platform/agent-cmd    │                        │
      │ ─────────────────────────────────►│                        │
      │     ◄── { ok: true } ────────────│                        │
      │                                  │  ws: agent:navigate    │
      │                                  │───────────────────────►│
      │                                  │                        │ UI updates
```

The bridge is HTTP POST (MCP tool → Platform server) + WebSocket broadcast
(server → browser). ~25ms total latency.

Why HTTP not file-based: the <500ms requirement rules out file-watching.
Why not direct WS from MCP: MCP is stdio-based, no event loop for WS connection management.

### 21.2 MCP Tools

Five tools give the agent full control over the browser:

#### `paradigm_platform_navigate`

Navigate to sections, select symbols, open lore entries.

```
{ section?: SectionId, symbol?: string, loreId?: string }
→ { navigated: true, section, symbol } | { navigated: false, reason }
```

#### `paradigm_platform_highlight`

Temporary visual emphasis on symbol nodes. Auto-expires.

```
{ symbols: string[], color?: string, duration?: number, pulse?: boolean, label?: string }
→ { highlighted: true, count: N }
```

#### `paradigm_platform_annotate`

Toasts, callouts (floating notes on graph nodes), badges.

```
{ type: 'toast'|'callout'|'badge', message: string, symbol?: string, severity?: string, duration?: number }
→ { annotated: true }
```

#### `paradigm_platform_observe`

Read current UI state (what user is viewing, what's selected).

```
{ detail?: 'summary'|'full' }
→ { connected, users, state: { section, selectedSymbol, theme, ... } }
```

#### `paradigm_platform_clear`

Remove all agent highlights/annotations.

```
{ target?: 'highlights'|'annotations'|'all' }
→ { cleared: true }
```

### 21.3 WebSocket Messages

**Agent → Browser (via server broadcast):**

| Message | Description |
|---------|-------------|
| `agent:join` | Agent presence registered |
| `agent:leave` | Agent disconnected |
| `agent:navigate` | Switch section / select symbol |
| `agent:highlight` | Pulse symbols with color + label |
| `agent:annotate` | Toast / callout / badge |
| `agent:clear` | Remove agent effects |

**Browser → Server (user activity reporting):**

| Message | Description |
|---------|-------------|
| `user:navigate` | User switched sections |
| `user:select` | User selected a symbol |
| `user:theme` | User changed theme |
| `user:mute` | User toggled agent mute |

### 21.4 Conflict Resolution

User always wins. Agent actions are contextual:

- **User idle (>5s):** Agent navigation executes immediately
- **User active (<5s):** Toast appears: "Agent wants to show you #X [Go there] [Dismiss]"
- **User muted:** All agent effects silently discarded; `observe` returns `{ muted: true }`

### 21.5 Visual Treatment

| Element | Human | Agent |
|---------|-------|-------|
| Selection ring | Solid 2px blue | Dashed 2px agent-color |
| Highlight | N/A | Pulsing glow |
| Toast | N/A | Left border + robot icon |
| Navigation | Instant | 300ms ease + "Agent navigated to..." toast |

### 21.6 Agent Identity

From Symphony identity: `{project}/{role}` (e.g., `a-paradigm/core`). Deterministic
color from hash of agentId. Presence shown in header next to section label with
robot icon.

### 21.7 Server Components

- `POST /api/platform/agent-command` — receives MCP commands, broadcasts to WS clients
- `WebSocketServer({ server: httpServer, path: '/ws' })` — same pattern as Sentinel
- `AgentPresenceManager` — tracks agent join/leave, auto-prunes stale agents (2min idle)
- `UserStateTracker` — accumulates user activity from WS messages, served to `observe`

### 21.8 Browser Components

- `agentStore.ts` — Zustand store for agent presence, highlights, annotations, toasts
- `useAgentEffects` — Hook connecting WebSocket messages to agentStore actions
- `useActivityReporter` — Hook reporting user section/symbol/theme changes to server
- `AgentToast` — Toast notification component with severity colors
- `AgentCallout` — Floating callout component for graph node annotations
- `AgentNavigationPrompt` — Conflict resolution prompt when user is active

---

*One tab. One URL. Everything connected.* ✦
