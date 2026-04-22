---
id: N-para-701-symphony-visibility
title: 'Lesson 8: Live Visibility via Symphony'
type: note
author: paradigm
created: '2026-04-22'
updated: '2026-04-22'
tags:
  - course
  - para-701
  - orchestrator-auto-emits-thr-orch-id
  - noterelay-polls-paradigmscorethreads
  - symphonythreadwatcher-filters-orchestration
symbols: []
difficulty: beginner
estimatedMinutes: 6
prerequisites: []
category: paradigm-core
origin: imported
source: courses/para-701.json
---

## The Visibility Gap

Orchestration runs inside an MCP tool call. The human sees: "Calling paradigm_orchestrate_inline..." followed by a wall of text when it completes. There is no live visibility into what is happening during orchestration — which agents are active, what they are producing, whether they agree or disagree, how far along the plan is.

Symphony closes this gap by providing a real-time communication channel between the orchestrator, agents, and the Conductor UI. The orchestrator emits progress into Symphony threads. The Conductor watches these threads and renders live updates.

## How Orchestration Emits to Symphony

When `paradigm_orchestrate_inline` runs in execute mode, it auto-emits a Symphony thread with a `thr-orch-` prefix:

```typescript
const orchestrationThread = `thr-orch-${orchestrationId}`;
```

The orchestrator creates this thread via the Symphony loader and posts an initial note from the "maestro" identity:

```typescript
const maestroId = `${projectName}/maestro`;
symphony.createNote(orchestrationThread, {
  from: maestroId,
  content: `Orchestration started: ${taskDescription}`,
  type: 'agent',
  project: projectName,
  role: 'orchestrator',
});
```

As each agent completes its work, the orchestrator posts their contributions to the thread. If security finds a gate coverage issue, that appears as a note from the security agent. If the builder completes implementation, that appears as a note from the builder. The thread becomes a chronological record of the orchestration.

The `thr-orch-` prefix is critical — it is the identifier that allows the Conductor to distinguish orchestration threads from regular Symphony threads (like team chat or general discussion).

## NoteRelay: The Polling Bridge

Symphony threads are stored as JSON files in `~/.paradigm/score/threads/`. The Conductor is a native macOS application that cannot directly watch the filesystem for MCP-created files (different process, different sandbox). NoteRelay bridges this gap.

NoteRelay is a Conductor service that polls the Symphony thread directory on a 5-second interval:

```
~/.paradigm/score/threads/*.json → NoteRelay (5s poll) → Conductor state
```

Every 5 seconds, NoteRelay scans for new or modified thread files. When it finds changes, it parses the JSON, extracts the notes, and updates the Conductor's in-memory state. This creates a near-real-time bridge between the MCP server (which writes threads) and the Conductor UI (which displays them).

The 5-second poll interval is a deliberate balance. A 1-second poll would provide faster updates but consume more CPU on the macOS overlay app. A 30-second poll would be too slow for live orchestration visibility. Five seconds means the Conductor is at most 5 seconds behind the actual orchestration state.

## SymphonyThreadWatcher: Filtering Orchestration Threads

NoteRelay delivers all Symphony threads to the Conductor. But the Team view in Conductor only wants orchestration threads — not general discussion or personal notes. SymphonyThreadWatcher handles this filtering.

SymphonyThreadWatcher polls at a 3-second interval (faster than NoteRelay's 5-second scan) and filters threads by the `thr-orch-` prefix:

```
All Symphony threads → SymphonyThreadWatcher (3s poll) → 
Filter: thr-orch-* → TeamThreadView
```

The watcher also tracks thread state: is the orchestration in progress, completed, or failed? It determines this by checking the latest note in the thread — a "completed" or "failed" status note indicates the orchestration has finished.

## TeamThreadView: Rendering in Conductor

TeamThreadView is the SwiftUI view that renders orchestration threads in the Conductor overlay. Each note in the thread is displayed with:

1. **Colored role badge** — Each agent role has a distinct color. The architect gets one color, the security agent another, the builder another. This makes it immediately visible who said what without reading names.

2. **Intent indicator** — The orchestration plan specifies an intent for each agent (e.g., "review gate coverage", "implement webhook handler"). The intent appears next to the agent's badge, providing context for why the agent was included.

3. **Agent nickname** — If the agent has a nickname (Mika, Atlas, Jinx), it is displayed alongside the role. This makes attributed responses feel like team communication rather than tool output.

4. **Note content** — The actual contribution from the agent. This could be a review finding, a code suggestion, a security flag, or a completion confirmation.

The visual layout mimics a team chat interface: chronological notes from identified agents, each with their role badge and intent. The human can watch the orchestration unfold in real time rather than waiting for a monolithic output.

## Agent-Side Emission

Agents are instructed (via their orchestration prompts) to emit progress and completion notes to Symphony during execution. The orchestrator includes this instruction:

```markdown
## Symphony Communication
During your work, emit progress notes to the active Symphony thread.
Use these note types:
- progress: "Reviewing file X of Y..."
- finding: "Found gate coverage gap on POST /api/payments"
- completion: "Review complete. 2 findings, 0 blockers."
```

Not all agents emit notes equally. The architect tends to emit planning updates. The security agent emits findings. The builder emits completion summaries. The documentor emits what it updated. This diversity creates a natural team-communication feel in the thread.

## The Full Pipeline

Putting it all together, the live visibility pipeline is:

```
pardigm_orchestrate_inline execute
  ↓
Orchestrator creates thr-orch-{id} thread
  ↓
Each agent contributes → notes posted to thread
  ↓
Thread file written to ~/.paradigm/score/threads/
  ↓
NoteRelay polls (5s) → detects new/changed thread
  ↓
SymphonyThreadWatcher filters (3s) → thr-orch-* threads
  ↓
TeamThreadView renders with colored badges and intents
  ↓
Human sees live orchestration progress in Conductor overlay
```

The latency from agent contribution to visual display is at most ~8 seconds (5s NoteRelay + 3s ThreadWatcher in the worst case). In practice, it is usually 3-5 seconds because the polls are offset.

## Why This Architecture

The polling-based architecture was chosen over alternatives for pragmatic reasons:

- **Filesystem watching** (FSEvents on macOS) is brittle across sandboxed processes and does not work reliably when the MCP server writes files from a different process tree.
- **WebSocket/TCP connection** between MCP server and Conductor would require connection management, reconnection logic, and port conflicts. Polling a directory is simpler.
- **Shared memory** would require both processes to link against the same framework, creating tight coupling.

Polling JSON files from a well-known directory is the simplest architecture that provides near-real-time visibility without process-coupling complexity. The tradeoff is a 3-8 second display latency, which is acceptable for human observation of orchestration progress.
