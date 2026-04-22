---
id: N-para-601-event-stream
title: The Event Stream
type: note
author: paradigm
created: '2026-04-22'
updated: '2026-04-22'
tags:
  - course
  - para-601
  - streamevent-has-12
  - 12-event-types
  - 6-event-sources
symbols: []
difficulty: beginner
estimatedMinutes: 5
prerequisites: []
category: paradigm-core
origin: imported
source: courses/para-601.json
---

## How Events Are Produced

Every meaningful action in a Paradigm session produces an event. When an agent modifies a file, the post-write hook emits a `file-modified` event. When an MCP tool is called, a `symbol-queried` or `gate-checked` event fires depending on the tool. When compliance issues are detected, a `compliance-violation` event captures the details. These events flow into a shared stream that all agents can observe.

The event stream is the nervous system of ambient coordination. Without it, agents are blind to each other's actions. With it, a security agent can notice that a new route was created without a gate, a tester can see that a new component was added without test coverage, and a reviewer can observe that a complex flow was modified without documentation updates.

## StreamEvent Anatomy

Every event follows the `StreamEvent` interface with 12 fields:

```typescript
interface StreamEvent {
  id: string;          // Unique ID (e.g., "ev-1710937200000-4821")
  type: EventType;     // Classification (12 types)
  source: EventSource; // Origin (6 sources)
  timestamp: string;   // ISO 8601
  path?: string;       // File path (if applicable)
  symbols?: string[];  // Paradigm symbols referenced
  keywords?: string[]; // Semantic keywords extracted
  context?: string;    // Brief context snippet
  agent?: string;      // Agent that produced this event
  tool?: string;       // MCP tool name (if from tool call)
  severity?: string;   // info, warning, error, critical
  data?: Record<string, unknown>; // Structured metadata
}
```

**Event IDs** are generated from the current timestamp plus a random 4-digit suffix: `ev-{timestamp}-{rand}`. This ensures uniqueness without coordination.

**Event Sources** identify where the event originated:
- `post-write-hook` — File was written, hook detected the change
- `mcp-tool-call` — An MCP tool was invoked
- `stop-hook` — Session end triggered an event
- `conversation` — Event derived from conversation context
- `agent-action` — Agent explicitly emitted an event
- `error` — An error occurred during processing

**Event Types** classify what happened. Twelve types cover the full range of project activity:

| Type | When It Fires |
|---|---|
| `file-modified` | A source file was changed |
| `symbol-queried` | A symbol was looked up via search/navigate/ripple |
| `gate-checked` | A gate (^) was evaluated or referenced |
| `compliance-violation` | A habit, hook, or policy check failed |
| `concept-mentioned` | A semantic concept appeared in context |
| `work-completed` | A unit of work finished (pass/fail/partial) |
| `decision-made` | A team decision was recorded |
| `error-encountered` | An error was caught during processing |
| `route-created` | A new API route was added |
| `gate-added` | A new gate was added to portal.yaml |
| `flow-modified` | A flow definition was changed |
| `test-result` | A test suite reported results |

## JSONL Storage

Events are stored as append-only JSONL (one JSON object per line) at `.paradigm/events/stream.jsonl`. The append-only format is chosen for performance — writing one line is cheaper than reading, modifying, and rewriting a file.

The stream is bounded by `DEFAULT_MAX_EVENTS` (1000). When the file exceeds ~500KB (a rough proxy for 1000 events), the `pruneIfNeeded` function reads the file, keeps only the most recent 1000 lines, and rewrites it. This ensures the stream does not grow unbounded while preserving recent history.

Events are also held in a memory buffer (`memoryStream`) for fast access during the current session. The memory buffer is independently bounded to 1000 events. Even if file I/O fails, the memory stream continues to function — file write failure is non-fatal.

## emitEvent

The `emitEvent` function is the single entry point for producing events:

```typescript
emitEvent(rootDir, {
  type: 'file-modified',
  source: 'post-write-hook',
  path: 'src/auth/middleware.ts',
  symbols: ['#auth-middleware', '^authenticated'],
  keywords: ['authentication', 'JWT'],
  context: 'Modified JWT validation logic',
});
```

The function auto-generates the `id` and `timestamp`, appends to both the memory buffer and the JSONL file, and prunes if the file is oversized. It returns the complete `StreamEvent` with all fields populated.

## queryEvents

The `queryEvents` function reads events from disk (falling back to the memory buffer on read failure) and supports five filters:

- `type` — Filter by event type (e.g., `'file-modified'`)
- `source` — Filter by event source (e.g., `'mcp-tool-call'`)
- `symbol` — Filter by a specific symbol in the event's `symbols` array
- `agent` — Filter by the agent that produced the event
- `since` — Only events after this ISO timestamp
- `limit` — Maximum number of events to return

Results are sorted by timestamp descending (most recent first). This ordering is intentional — in ambient coordination, recent events are almost always more relevant than older ones.

## Event Stream Configuration

The `EventStreamConfig` interface allows fine-grained control:

- `enabled` — Master switch for ambient coordination (default: true in v5.0 projects)
- `max_events` — Maximum events retained (default: 1000)
- `event_ttl_seconds` — Time-to-live for events (default: 3600 = 1 hour)
- `emit` — Whitelist of event types to produce (if set, only these types fire)
- `suppress` — Blacklist of event types to silence (overrides emit)
- `storage` — `'memory'` (in-process only) or `'file'` (JSONL persistence)

For projects that do not need ambient coordination, setting `enabled: false` turns off event emission entirely. For projects that need it but want to reduce noise, the `suppress` list can silence high-frequency event types like `symbol-queried` while preserving important ones like `compliance-violation` and `gate-added`.
