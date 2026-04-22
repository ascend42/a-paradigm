---
id: N-para-501-conductor-workspace
title: 'Conductor: Visual Mission Control'
type: note
author: paradigm
created: '2026-04-22'
updated: '2026-04-22'
tags:
  - course
  - para-501
  - conductor-is-a
  - workspace-mode-provides
  - symphony-integration-shows
symbols: []
difficulty: beginner
estimatedMinutes: 3
prerequisites: []
category: paradigm-core
origin: imported
source: courses/para-501.json
---

## What Is Conductor?

Conductor is a native macOS application that serves as the visual mission control for Paradigm. While the CLI and MCP tools handle the automation, Conductor gives you a real-time view of what your agent team is doing — and lets you interact with them visually.

Think of it as the difference between managing a team over email versus walking into a mission control room. Both work, but the room gives you instant awareness.

### Core Capabilities

**Workspace Mode** — A full-screen tiling window manager for Claude Code sessions. Launch multiple terminals side by side, split horizontally or vertically, drag dividers to resize. Six layout presets (single, split-h, split-v, quad, triple, grid) let you quickly arrange your workspace.

**Symphony Integration** — Conductor connects to Symphony, the inter-agent messaging system. When agents communicate during orchestration (handing off context, requesting approval, debating approaches), those messages appear in Conductor's thread view in real time. You can read the full conversation without switching to the CLI.

**Task Protocol** — A structured protocol for human-agent coordination with 7 intents:
- `task` — assign work to an agent
- `task-ack` — agent acknowledges receipt
- `progress` — agent reports progress
- `approval-request` — agent asks for human approval
- `approval-response` — human approves or rejects
- `task-complete` — agent reports success
- `task-failed` — agent reports failure

This protocol makes agent work visible and controllable. You see when agents are working, what they are asking, and whether they succeeded.

**Agent Health Dashboard** — Per-agent metrics: success rates, average time-per-task, acceptance rates for contributions. Sparklines show trends over time. When an agent's performance drops, you see it immediately.

**Live Sentinel** — Real-time event viewer with symbol filtering. When Sentinel detects an incident or pattern, it appears in Conductor's event feed with full detail and suggested resolution.

### Architecture

Conductor is built with Swift and SwiftUI — a native macOS application, not an Electron wrapper. Key design decisions:

- **Single-owner pattern** — AppDelegate owns the orchestrator, workspace, project store, and agent process manager. No shared mutable state.
- **Local-only ML** — Gaze tracking, gesture recognition, and voice commands all run locally via CoreML. Zero cloud, zero cost, zero latency.
- **SwiftTerm embedding** — Terminal sessions use SwiftTerm, a native Swift terminal emulator. Each session is a real PTY with full ANSI support.
- **7 platform protocols** — Abstraction layer for future portability (the same protocol set would power a Windows or Linux version).

### Getting Started

Build and install Conductor:

```bash
cd packages/conductor
./build-conductor.sh --install
```

This produces `Conductor.app` in `/Applications`. Launch it, and it connects to your Paradigm project automatically.

### When to Use Conductor

- **During orchestration** — watch agents work in real time, approve contributions, read debates
- **Multi-session development** — tile 2-4 Claude Code sessions side by side, each working on different parts of the codebase
- **Monitoring** — keep Conductor visible on a secondary display to catch Sentinel events and agent health changes
- **Team collaboration** — when multiple developers use Symphony, Conductor shows cross-session threads and file approval requests

Conductor is optional — everything it shows is also available via CLI and MCP tools. But for teams that want visual awareness of their agent team, it is the command center.
