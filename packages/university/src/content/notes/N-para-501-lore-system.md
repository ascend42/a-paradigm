---
id: N-para-501-lore-system
title: The Lore System
type: note
author: paradigm
created: '2026-04-22'
updated: '2026-04-18'
tags:
  - course
  - para-501
  - lore-entries-record
  - seven-entry-types
  - date-partitioned-yaml-storage
symbols: []
difficulty: beginner
estimatedMinutes: 5
prerequisites: []
category: paradigm-core
origin: imported
source: courses/para-501.json
---

## Why Projects Forget

Every software project accumulates institutional knowledge — why a migration was attempted then rolled back, which approach was chosen for caching and why, what the team learned when the billing system went down at 2 AM. Without a system for capturing this knowledge, it lives only in the heads of the people who were there. When they leave, context-switch, or simply forget, the project loses its memory.

Paradigm's Lore system is a structured project timeline. It records sessions, milestones, incidents, retros, reviews, and insights as date-partitioned YAML entries that both humans and AI agents can search, filter, and learn from.

> **v6.0 change:** the `decision` lore type was removed. Architectural decisions now have their own dedicated store — see "Decisions Have Their Own Store" below.

## Anatomy of a Lore Entry

Every lore entry follows a consistent structure:

```yaml
id: L-2026-02-21-ascend-143025-001
type: agent-session
timestamp: "2026-02-21T14:30:25Z"
duration_minutes: 45
author: ascend
agent:
  provider: anthropic
  model: claude-opus-4-6
title: "Add JWT authentication to user routes"
summary: "Implemented RS256 JWT auth middleware, added ^authenticated and ^project-admin gates to portal.yaml, created refresh token rotation."
symbols_touched: ["#auth-middleware", "^authenticated", "^project-admin"]
symbols_created: ["#refresh-token-handler"]
files_modified: ["src/middleware/auth.ts", "portal.yaml"]
files_created: ["src/handlers/refresh-token.ts"]
lines_added: 247
lines_removed: 12
commit: "a1b2c3d"
decisions:
  - id: jwt-signing
    decision: "Use RS256 over HS256"
    rationale: "Allows public key verification without sharing the signing secret"
learnings:
  - "Express v5 requires explicit async error wrapping for middleware"
verification:
  status: pass
  details: { "unit-tests": pass, "integration": pass }
tags: [security, auth]
```

The `id` field is auto-generated as `L-{date}-{author}-{hhmmss}-{seq}` — date partitions the storage, author and timestamp disambiguate within a day, and the sequence handles burst writes. Note that `author` is the human user (a string), and AI assistance is recorded separately in the optional `agent` object. The `decisions` field on an agent-session entry remains valid — it captures decisions made *during* a work session. Standalone architectural decisions go through `paradigm_decision_record` (see below).

## Entry Types

Lore recognizes seven entry types, each capturing a different kind of project event:

| Type | When to Use |
|---|---|
| `agent-session` | An AI agent completed a work session (most common) |
| `human-note` | A human records context, rationale, or tribal knowledge |
| `review` | A code review, PR review, or post-mortem |
| `incident` | A production incident or significant failure |
| `milestone` | A release, launch, migration completion, or major achievement |
| `retro` | A retrospective on a sprint, project, or incident response |
| `insight` | A learned pattern or observation worth preserving |

The type drives how the entry appears in timeline views and which filters surface it.

## Decisions Have Their Own Store

In v6.0 the `decision` lore type was removed. Decisions are first-class enough to deserve their own store, separate from the time-partitioned narrative of lore. Decisions live in `.paradigm/decisions/` as `TD-*` entries, recorded via `paradigm_decision_record`. When you record a decision, Paradigm auto-writes a companion lore `insight` entry pointing at it (with `references.decision_id`) — so the timeline still surfaces the moment the decision was made, while the canonical decision record stays addressable by topic rather than by date.

If you have a v1/v2 project with old `type: decision` lore entries, the storage layer migrates them to type `insight` on read and tags them `v6-migrated:from-decision` for forensic recovery. New entries with `type: 'decision'` are rejected at the storage layer with an error pointing you at the decision-record path. The rejection envelope (`code: 'lore_type_decision_removed'`, `successor_tool: 'paradigm_decision_record'`) is structured so calling agents can auto-retry without human intervention.

Search hierarchy:
- Use `paradigm_lore_search` for narrative ("what happened on 2026-02-21?").
- Use `paradigm_decision_search` for canonical choices ("what did we decide about caching?").

## Storage: Date-Partitioned YAML

Lore entries live in `.paradigm/lore/entries/` organized by date. Filenames mirror the entry id (`L-{date}-{author}-{hhmmss}-{seq}.yaml`), so you can identify the author and burst order from the filename alone:

```
.paradigm/lore/
  timeline.yaml          # Index metadata
  entries/
    2026-02-19/
      L-2026-02-19-ascend-091203-001.yaml
      L-2026-02-19-matt-143812-001.yaml
    2026-02-20/
      L-2026-02-20-ascend-101545-001.yaml
    2026-02-21/
      L-2026-02-21-ascend-143025-001.yaml
```

The `timeline.yaml` index tracks total entry count, last updated timestamp, and known authors. Date partitioning keeps directories small and makes time-range queries efficient — to find entries from last week, you only read 7 directories.

## CLI Tools

The CLI provides full lore management:

- `paradigm lore list` — List entries with filters (author, type, symbol, date range, tags)
- `paradigm lore show <id>` — Full detail view of a single entry
- `paradigm lore record` — Record a new entry with expanded fields (files-modified, files-created, commit, learnings, duration)
- `paradigm lore edit <id>` — Edit entry fields (title, summary, type, symbols, tags, learnings)
- `paradigm lore delete <id>` — Delete an entry (with --yes to skip confirmation)
- `paradigm lore timeline` — Timeline view grouped by date with hot symbols
- `paradigm lore review <id>` — Add review scores to an entry
- `paradigm lore` — Launch the web timeline UI

## MCP Tools

The Lore system exposes the following MCP tools:

**`paradigm_lore_record`** — Create a new entry. Requires `type`, `title`, `summary`, and `symbols_touched`. Optional fields include files, decisions, learnings, and verification status. The entry is written to the correct date directory with an auto-incremented ID. When `validateSymbols: true` is passed, the tool checks each symbol in `symbols_touched` against registered symbols in `.purpose` files, `flows.yaml`, and `portal.yaml`. Unregistered symbols produce advisory warnings (the entry is always recorded regardless). Calling with `type: 'decision'` returns a structured rejection envelope pointing at `paradigm_decision_record`.

**`paradigm_lore_search`** — Query entries with filters: by symbol, author, type, date range, tags, review status, and minimum completeness score. Returns matching entries sorted by recency.

**`paradigm_lore_timeline`** — Get a high-level view: recent entries, active authors, hot symbols (most-referenced in recent entries), and timeline metadata. Use this for orientation — it tells you what has been happening in the project.

**`paradigm_lore_get`** — Fetch a single entry by ID. Returns the full entry with all fields, including decisions, learnings, and review data.

**`paradigm_lore_update`** — Update an existing entry. Pass the entry ID and the fields to change (title, summary, type, symbols, tags, learnings). Only specified fields are modified.

**`paradigm_lore_delete`** — Delete an entry by ID. Requires `confirm: true` to prevent accidental deletion.

**`paradigm_lore_assess`** — Score an entry's quality and completeness (1-5 each), with optional notes. The assessment is stored alongside the entry and feeds the calibration and review filters.

**`paradigm_lore_calibration`** — Surface calibration drift: entries where the recorded confidence diverges from later-observed reality. Use this to find sessions where an agent over- or under-estimated its certainty.

## Lore Reviews

Entries can be reviewed by humans after the fact. A review adds a `completeness` score (1-5), a `quality` score (1-5), and optional notes. This creates a feedback loop: agents learn which sessions produced high-quality entries and can adjust their recording behavior. You can filter entries by `hasReview` and `minCompleteness` to surface only verified project history.

## When to Record

The general rule: **record lore when a session modifies 3 or more source files**. This threshold captures significant work sessions while ignoring trivial edits. The stop hook enforces this — if you modified 3+ files without recording a lore entry, it will block your session from completing.

Beyond the threshold, always record lore for: production incidents, milestone completions, retros, and any session where you learned something the next developer should know. For standalone architectural decisions, use `paradigm_decision_record` instead — the decision store handles them, and a companion lore `insight` is auto-written for timeline coverage.

> **Going deeper:** PARA 601 covers knowledge streams (work-log, journal, decisions) and how `paradigm_decision_record` writes to the decisions stream while emitting a companion lore `insight` for timeline coverage. PARA 301 covers the new dedicated decision store in detail (`N-para-301-decisions`).
