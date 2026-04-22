---
id: N-para-601-nominations-debates
title: Nominations & Debates
type: note
author: paradigm
created: '2026-04-22'
updated: '2026-04-22'
tags:
  - course
  - para-601
  - nominations-are-structured
  - four-urgency-levels
  - five-nomination-types
symbols: []
difficulty: beginner
estimatedMinutes: 5
prerequisites: []
category: paradigm-core
origin: imported
source: courses/para-601.json
---

## Agents Self-Nominate Contributions

In the ambient model, agents do not push messages at each other. Instead, when an event exceeds an agent's attention threshold, the agent creates a **nomination** — a structured contribution that may or may not be surfaced to the human. Nominations are the bridge between passive observation and active participation.

The key insight is that not every observation deserves immediate attention. A nomination captures the agent's contribution in a structured format, and surfacing rules determine when and how to present it. This prevents the "every agent shouts at once" problem that plagues naive multi-agent systems.

## Nomination Anatomy

A nomination has 13 fields:

```typescript
interface Nomination {
  id: string;                    // Unique ID
  agent: string;                 // Nominating agent
  relevance: number;             // Attention score (0.0-1.0)
  urgency: NominationUrgencyLevel;  // critical, high, medium, low
  type: NominationType;          // warning, suggestion, question, offer, observation
  brief: string;                 // 1-line summary
  detail?: string;               // Full contribution (shown on engage)
  action_offered?: string;       // Action the agent offers to take
  evidence?: NominationEvidence[];  // Supporting evidence
  triggered_by: string[];        // Event ID(s) that triggered this
  timestamp: string;             // ISO 8601
  surfaced: boolean;             // Whether shown to human
  engaged?: boolean;             // Whether human interacted
  response?: string;             // accepted, dismissed, deferred
}
```

The `brief` field is critical — it is the first (and possibly only) thing the human sees. A good brief is actionable and specific: "New POST /api/payments route lacks ^payment-authorized gate" rather than "Security concern detected."

The `detail` field expands on the brief with full reasoning, code references, and recommendations. It is shown only if the human engages with the nomination, saving context window space when the human dismisses or defers.

## Urgency Levels

Four urgency levels determine how aggressively a nomination is surfaced:

| Level | Meaning | Surfacing Rule |
|---|---|---|
| `critical` | Immediate action required — security vulnerability, data loss risk | Always surfaced immediately, interrupts if necessary |
| `high` | Should be addressed before session ends — missing gate, broken flow | Surfaced in the current batch, highlighted |
| `medium` | Worth knowing but not blocking — code smell, missing test | Surfaced if the human has not dismissed similar nominations recently |
| `low` | FYI — style suggestion, minor optimization opportunity | Batched and shown only if the human asks or at session end |

The surfacing rules are configurable via `SurfacingConfig`. A user who finds security nominations too frequent can set the security agent's `min_urgency` to `high`, silencing `medium` and `low` nominations from that agent.

## Nomination Types

Five types classify the nature of the contribution:

- **warning** — Something is wrong or risky (e.g., "Route without gate", "Aspect anchor drift detected")
- **suggestion** — An improvement opportunity (e.g., "Consider extracting this into a shared utility")
- **question** — The agent needs clarification (e.g., "Should this endpoint be public or require authentication?")
- **offer** — The agent volunteers to do something (e.g., "I can write the test suite for this component")
- **observation** — A neutral factual note (e.g., "This is the third time this pattern has been refactored")

The `action_offered` field is used with `offer` type nominations. When the human accepts an offer, the agent can proceed to take the offered action.

## Evidence

Nominations can include evidence to support their claims. Each `NominationEvidence` item can reference a file, a symbol, a pattern from the agent's notebook, specific line numbers, or a textual description.

Evidence transforms a nomination from opinion to argument. "This route needs a gate" is a suggestion. "This route needs a gate — see portal.yaml line 42 where all /api/payments routes require ^payment-authorized, and `#payment-service` has a documented aspect ~pci-compliance-required" is a compelling argument backed by project facts.

## Storage

Nominations and debates are stored as JSONL files alongside the event stream:

- `.paradigm/events/nominations.jsonl` — All nominations, append-only
- `.paradigm/events/debates.jsonl` — Detected debates (conflicting/complementary nomination groups)

## Debate Detection

When multiple agents nominate on the same event or overlapping symbols, a **debate** may form. Paradigm detects debates by checking for overlapping `triggered_by` event IDs or overlapping symbols across nominations within a time window.

A `Debate` has two types:
- **conflicting** — The nominations disagree (e.g., architect says "use SQL" while builder says "use NoSQL")
- **complementary** — The nominations agree but add different perspectives (e.g., security says "add gate" and tester says "add test for gate")

Debates are surfaced as a group rather than individual nominations, so the human sees the full picture. A debate includes:
- `topic` — What the debate is about (derived from overlapping symbols/events)
- `nominations` — IDs of the participating nominations
- `overlap_symbols` — Symbols that triggered grouping
- `overlap_events` — Events that triggered grouping
- `resolution` — How it was resolved (chosen nomination, reason, resolved by human or consensus)

## MCP Tools

**`paradigm_ambient_nominations`** — View pending nominations. Supports filtering by agent, urgency, type, and whether nominations have been surfaced. Returns nominations sorted by urgency (critical first) then by relevance score.

**`paradigm_ambient_engage`** — Engage with a nomination. Pass the nomination ID and a response (`accepted`, `dismissed`, `deferred`). If accepted, the nomination's `detail` and `evidence` are returned for the agent to act on. If dismissed, the nomination is marked as seen but not acted upon. If deferred, it is re-queued for later surfacing.

The engage tool creates a feedback signal — over time, the pattern of accepted vs dismissed nominations helps calibrate attention thresholds. An agent whose nominations are consistently dismissed may need a higher threshold.
