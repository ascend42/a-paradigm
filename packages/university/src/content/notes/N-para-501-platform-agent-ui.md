---
id: N-para-501-platform-agent-ui
title: Platform & Agent-Driven UI
type: note
author: paradigm
created: '2026-04-22'
updated: '2026-04-22'
tags:
  - course
  - para-501
  - paradigm-serve-unifies
  - agent-driven-ui-5
  - pipeline-mcp-
symbols: []
difficulty: beginner
estimatedMinutes: 3
prerequisites: []
category: paradigm-core
origin: imported
source: courses/para-501.json
---

## The Unified Platform

`paradigm serve` launches the Paradigm Platform — a unified development management interface on port 3850 that absorbs every Paradigm tool (Lore, Graph, Sentinel, University, Symphony) into one browser tab.

The Platform is built on Express + WebSocket on the server, React 18 + Zustand on the client. Sections are lazy-loaded. A shared design system provides consistent theming and symbol colors.

### Architecture

```
localhost:3850 (Express + WebSocket)
├── /api/lore/*        ← LoreRouter
├── /api/symbols/*     ← SymbolsRouter
├── /api/graphs/*      ← GraphsRouter
├── /api/platform/*    ← PlatformRouter (health, sections, agent-command)
├── /ws                ← WebSocket (agent commands + user activity)
└── /                  ← Platform UI SPA
```

## Agent-Driven UI

The breakthrough: **the AI agent can drive the browser in real-time.** Five MCP tools let the agent navigate, highlight, annotate, observe, and clear — turning the Platform from a passive viewer into a shared workspace.

### The Pipeline: MCP → HTTP → WebSocket → Browser

```
Agent (Claude Code)       Platform Server          Browser
      │                          │                    │
      │ paradigm_platform_*      │                    │
      │ POST /api/platform/cmd   │                    │
      │ ─────────────────────────►│                    │
      │   ◄── { ok: true } ──────│                    │
      │                          │  ws: agent:*       │
      │                          │──────────────────►│
      │                          │                    │ UI updates
```

Why HTTP not file-based: the <500ms latency requirement rules out file-watching. Why not direct WebSocket from MCP: MCP tools are stdio-based with no event loop for persistent WS connections.

### The Five Tools

| Tool | Purpose |
|------|---------|
| `paradigm_platform_navigate` | Switch sections, select symbols, open lore entries |
| `paradigm_platform_highlight` | Pulsing glow on symbols with color + label, auto-expires |
| `paradigm_platform_annotate` | Toasts (notifications), callouts (on graph nodes), badges |
| `paradigm_platform_observe` | Read user's current section, selected symbol, theme, mute state |
| `paradigm_platform_clear` | Remove all agent highlights and annotations |

### Conflict Resolution: User Always Wins

The agent must never hijack the user's attention:

- **User idle (>5s):** Agent navigation executes immediately
- **User active (<5s):** A prompt appears: "Agent wants to show you #X — [Go there] [Dismiss]"
- **User muted:** All agent effects are silently discarded; `observe` returns `{ muted: true }`

### Agent Presence

The `#AgentPresenceManager` tracks connected agents by their Symphony identity (`{project}/{role}`). Each agent gets a deterministic color from its ID hash. Presence dots appear in the Platform header with a mute toggle.

Stale agents are auto-pruned after 2 minutes of inactivity.

### User State Tracking

The `#UserStateTracker` accumulates user activity — what section they're viewing, what symbol is selected, theme preference. This state is served to `paradigm_platform_observe` so the agent can reason about what the user is looking at.

Browser clients report activity via WebSocket messages: `user:navigate`, `user:select`, `user:theme`, `user:mute`.

### Visual Treatment

| Element | Human | Agent |
|---------|-------|-------|
| Selection ring | Solid 2px blue | Dashed 2px agent-color |
| Highlight | N/A | Pulsing glow animation |
| Toast | N/A | Left border + robot icon |
| Navigation | Instant | 300ms ease + toast notification |

### Browser Architecture

The agent UI layer sits alongside existing stores:

- `agentStore.ts` — Zustand store managing presence, highlights, annotations, toasts, mute, pending navigation
- `useAgentEffects` — Hook connecting WebSocket `agent:*` messages to store actions, with auto-reconnect
- `useActivityReporter` — Hook reporting section/theme changes back to server
- `AgentToast` — Severity-colored toast component
- `AgentCallout` — Floating callout overlay + navigation conflict prompt
