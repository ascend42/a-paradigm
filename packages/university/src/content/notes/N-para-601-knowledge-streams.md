---
id: N-para-601-knowledge-streams
title: Knowledge Streams
type: note
author: paradigm
created: '2026-04-22'
updated: '2026-04-22'
tags:
  - course
  - para-601
  - three-knowledge-streams
  - work-log-paradigmwork-logdate
  - learning-journal-paradigmagentsidjournal
symbols: []
difficulty: beginner
estimatedMinutes: 6
prerequisites: []
category: paradigm-core
origin: imported
source: courses/para-601.json
---

## The Lore Split

Paradigm's original lore system stored everything — sessions, decisions, incidents, milestones — in a single stream of date-partitioned YAML entries. This worked well for small projects, but as projects grew, the single stream created problems. A standup bot pulling "what got done this week" had to filter through architectural decisions and incident postmortems. An agent looking for "what did I learn about JWT handling" had to parse session summaries. A new team member searching for "why did we choose Redis" had to wade through hundreds of entries.

v5.0 splits lore into three knowledge streams, each with a distinct audience, lifecycle, and storage location.

## Stream 1: Work Log — "What Got Done"

The work log is the team-facing record of completed work. It answers the question every standup asks: what did you do, what is left, what is blocking you?

**Storage:** `.paradigm/work-log/{date}/` — project-scoped, date-partitioned YAML files, one entry per work unit.

**Audience:** The team. Standup bots, sprint boards, and project managers consume work log entries.

**Lifecycle:** Ephemeral. Work log entries are relevant for days to weeks. After a sprint ends, they are historical context rather than active reference.

**Entry structure (`WorkLogEntry`):**

| Field | Required | Description |
|---|---|---|
| `id` | yes | Unique ID (e.g., `WL-security-001`) |
| `agent` | yes | Agent that performed the work |
| `timestamp` | yes | ISO 8601 timestamp |
| `summary` | yes | What was done |
| `outcome` | yes | pass, fail, partial, or blocked |
| `task_ref` | no | Ticket or issue reference (e.g., `ENG-142`) |
| `files_modified` | no | List of modified files |
| `symbols_touched` | no | Paradigm symbols touched |
| `next_steps` | no | What remains to be done |
| `blockers` | no | What is blocking progress |
| `duration_minutes` | no | How long the work took |
| `commit` | no | Git commit hash |

**MCP Tools:**
- `paradigm_work_log_record` — Record a work log entry. Requires `agent`, `summary`, and `outcome`. Supports optional `task_ref`, `files_modified`, `symbols_touched`, `next_steps`, `blockers`, `duration_minutes`, and `commit`.
- `paradigm_work_log_search` — Search work log entries by `agent`, `outcome`, `task_ref`, `symbol`, `dateFrom`, `dateTo`. Pass `summary: true` to get an aggregate summary instead of individual entries.

## Stream 2: Learning Journal — "What I Learned"

The learning journal is the agent-private record of insights, corrections, and patterns discovered during work. It answers the question: what should I remember for next time?

**Storage:** `~/.paradigm/agents/{id}/journal/` — user-scoped, agent-specific. The journal travels with the agent across projects because learning is not project-specific.

**Audience:** The agent itself (and optionally other agents if the insight is marked `transferable`).

**Lifecycle:** Durable. A pattern discovered today about JWT ordering is relevant months from now. Journal entries persist until explicitly archived.

**Entry structure (`JournalEntry`):**

| Field | Required | Description |
|---|---|---|
| `id` | yes | Unique ID (e.g., `LJ-2026-03-20-001`) |
| `agent` | yes | Agent who learned this |
| `timestamp` | yes | ISO 8601 timestamp |
| `trigger` | yes | What prompted the learning (7 trigger types) |
| `insight` | yes | The insight itself |
| `project` | yes | Project where this happened |
| `transferable` | yes | Whether this applies to other projects |
| `confidence_before` | no | Agent's confidence before (0.0-1.0) |
| `confidence_after` | no | Adjusted confidence after (0.0-1.0) |
| `pattern` | no | Extracted `LearningPattern` (id, applies_when, correct_approach) |
| `linked_work_log` | no | Work log entry that prompted this learning |
| `tags` | no | Tags for categorization |

Seven journal triggers capture distinct learning moments: `correction_received` (human corrected the approach), `confidence_miss` (agent was confident but wrong), `pattern_discovered` (new reusable pattern found), `debate_loss` (another agent's approach was chosen), `failure_analysis` (something broke and was analyzed), `human_feedback` (direct human assessment), and `self_reflection` (agent proactively recorded an insight).

**MCP Tools:**
- `paradigm_journal_record` — Record a journal entry. Requires `agent`, `trigger`, `insight`, `project`, and `transferable`. Supports optional `confidence_before`, `confidence_after`, `pattern`, `linked_work_log`, and `tags`.
- `paradigm_journal_search` — Search journal entries by `agent`, `trigger`, `project`, `transferable`, `tag`, `dateFrom`, `dateTo`. Pass `stats: true` (with `agent`) to get aggregate statistics.

## Stream 3: Team Decisions — "What We Decided"

Team decisions are the institutional record of choices made, rationale given, and alternatives rejected. They answer the question: why did we do it this way?

**Storage:** `.paradigm/decisions/` — project-scoped, not date-partitioned (decisions are referenced by topic, not by when they were made).

**Audience:** The entire team — current and future. New team members benefit most from decision records.

**Lifecycle:** Institutional. Decisions persist until explicitly superseded or deprecated. A decision made in month one remains authoritative until a newer decision replaces it.

**Entry structure (`TeamDecision`):**

| Field | Required | Description |
|---|---|---|
| `id` | yes | Unique ID (e.g., `TD-2026-03-20-001`) |
| `title` | yes | Decision title |
| `timestamp` | yes | ISO 8601 timestamp |
| `participants` | yes | Who participated (id, role, stance) |
| `decision` | yes | The decision itself |
| `rationale` | yes | Why this was chosen |
| `alternatives_considered` | no | What else was considered and why it was rejected |
| `symbols_affected` | no | Paradigm symbols affected |
| `status` | yes | active, proposed, superseded, deprecated, rejected |
| `tags` | no | Tags for categorization |

Participant stances capture the human dynamics: `proposed`, `supported`, `dissented`, `abstained`, `neutral`. Recording dissent is especially important — when a decision is revisited later, knowing who dissented and why saves time.

**MCP Tools:**
- `paradigm_decision_record` — Record a decision. Requires `title`, `decision`, `rationale`, and `participants`. Supports optional `alternatives_considered`, `symbols_affected`, `status`, and `tags`.
- `paradigm_decision_search` — Search decisions by `status`, `participant`, `symbol`, `tag`, `dateFrom`, `dateTo`. Pass `summary: true` for an aggregate view.

## Auto-Classification and the Companion-Lore Pattern

When recording via `paradigm_lore_record`, the `stream` parameter routes the entry to the correct knowledge stream. Setting `stream: 'auto'` triggers auto-classification based on the entry type. The `LORE_TYPE_TO_STREAM` mapping (defined in `packages/paradigm-mcp/src/types/knowledge-streams.ts`) defines how lore types map to streams:

- `agent-session` splits into work-log (what was done) and journal (what was learned)
- `incident` splits across work-log (what happened), journal (what we learned), and decisions (prevention strategy)
- `review` splits into work-log and journal
- `human-note` routes to the decisions stream (institutional context)
- `retro` and `insight` route to journal and decisions (learnings worth preserving)
- `milestone` routes to the decisions stream

Note that the `decision` lore *type* was removed in v6.0 — see PARA 501 — but the `decision` *stream* persists. The stream is fed by `paradigm_decision_record`, not by typed lore entries. The `LORE_TYPE_TO_STREAM` table still contains a residual `'decision': ['decision']` mapping for backward-compat with v1/v2 entries that get migrated to type `insight` on read; new writes never reach that branch.

### The Companion-Lore Pattern (v6.0)

When you call `paradigm_decision_record`, two things happen:

1. The canonical decision is written to `.paradigm/decisions/TD-*.yaml` (decisions stream).
2. A companion lore entry of type `insight` is auto-written to the lore timeline (journal stream), with a back-reference (`references.decision_id`) to the TD- ID.

This split lets the decision stay topic-addressable (search by symbol, status, participant) while the timeline still shows the moment it was made. Project newcomers can follow the timeline forward and see the major calls; researchers can query the decisions stream directly. The companion write is best-effort — a failure to write the companion lore never blocks the decision record.
