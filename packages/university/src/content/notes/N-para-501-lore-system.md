---
id: N-para-501-lore-system
title: The Lore System
type: note
author: paradigm
created: '2026-04-22'
updated: '2026-04-22'
tags:
  - course
  - para-501
  - lore-entries-record
  - six-entry-types
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

Paradigm's Lore system is a structured project timeline. It records sessions, decisions, milestones, incidents, and reviews as date-partitioned YAML entries that both humans and AI agents can search, filter, and learn from.

## Anatomy of a Lore Entry

Every lore entry follows a consistent structure:

```yaml
id: L-2026-02-21-001
type: agent-session
timestamp: "2026-02-21T14:30:00Z"
duration_minutes: 45
author:
  type: agent
  id: claude-opus-4
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

The `id` field is auto-generated: `L-{date}-{sequence}`, where the sequence resets daily. This creates a natural chronological index.

## Entry Types

Lore recognizes six entry types, each capturing a different kind of project event:

| Type | When to Use |
|---|---|
| `agent-session` | An AI agent completed a work session (most common) |
| `human-note` | A human records context, rationale, or tribal knowledge |
| `decision` | An architectural or design decision with rationale |
| `review` | A code review, PR review, or post-mortem |
| `incident` | A production incident or significant failure |
| `milestone` | A release, launch, migration completion, or major achievement |

The type drives how the entry appears in timeline views and which filters surface it.

## Storage: Date-Partitioned YAML

Lore entries live in `.paradigm/lore/entries/` organized by date:

```
.paradigm/lore/
  timeline.yaml          # Index metadata
  entries/
    2026-02-19/
      L-2026-02-19-001.yaml
      L-2026-02-19-002.yaml
    2026-02-20/
      L-2026-02-20-001.yaml
    2026-02-21/
      L-2026-02-21-001.yaml
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

Six MCP tools power the Lore system:

**`paradigm_lore_record`** — Create a new entry. Requires `type`, `title`, `summary`, and `symbols_touched`. Optional fields include files, decisions, learnings, and verification status. The entry is written to the correct date directory with an auto-incremented ID. When `validateSymbols: true` is passed, the tool checks each symbol in `symbols_touched` against registered symbols in `.purpose` files, `flows.yaml`, and `portal.yaml`. Unregistered symbols produce advisory warnings (the entry is always recorded regardless).

**`paradigm_lore_search`** — Query entries with filters: by symbol, author, type, date range, tags, review status, and minimum completeness score. Returns matching entries sorted by recency.

**`paradigm_lore_timeline`** — Get a high-level view: recent entries, active authors, hot symbols (most-referenced in recent entries), and timeline metadata. Use this for orientation — it tells you what has been happening in the project.

**`paradigm_lore_get`** — Fetch a single entry by ID. Returns the full entry with all fields, including decisions, learnings, and review data.

**`paradigm_lore_update`** — Update an existing entry. Pass the entry ID and the fields to change (title, summary, type, symbols, tags, learnings). Only specified fields are modified.

**`paradigm_lore_delete`** — Delete an entry by ID. Requires `confirm: true` to prevent accidental deletion.

## Lore Reviews

Entries can be reviewed by humans after the fact. A review adds a `completeness` score (1-5), a `quality` score (1-5), and optional notes. This creates a feedback loop: agents learn which sessions produced high-quality entries and can adjust their recording behavior. You can filter entries by `hasReview` and `minCompleteness` to surface only verified project history.

## When to Record

The general rule: **record lore when a session modifies 3 or more source files**. This threshold captures significant work sessions while ignoring trivial edits. The stop hook enforces this — if you modified 3+ files without recording a lore entry, it will block your session from completing.

Beyond the threshold, always record lore for: architectural decisions (even if only 1 file changed), production incidents, milestone completions, and any session where you learned something the next developer should know.
