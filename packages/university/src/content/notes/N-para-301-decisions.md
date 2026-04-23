---
id: N-para-301-decisions
title: The Decision Store
type: note
author: paradigm
created: '2026-04-18'
updated: '2026-04-18'
tags:
  - course
  - para-301
  - decision-store
  - paradigmdecisionrecord
  - companion-lore-pattern
symbols: []
difficulty: beginner
estimatedMinutes: 4
prerequisites: []
category: paradigm-core
origin: authored
source: v6.0-content-fix
---

## Why Decisions Got Their Own Store

Through Paradigm v5.x, architectural decisions lived in two places at once: as a `decision` lore type (date-partitioned, narrative-shaped) and as a `decision` wisdom entry (symbol-keyed, ADR-shaped). Both stores carried roughly the same content, neither was canonical, and the inconsistency caused predictable problems — agents recorded the same choice in both places, search returned conflicting versions, and "what did we decide about X?" was answered by reading two stores and reconciling.

In v6.0 the decision (D3 in the locked v6 synthesis) was to give decisions a single dedicated home. Lore stays the time-partitioned narrative timeline. Wisdom stays the symbol-keyed playbook (preferences and antipatterns). Decisions move to `.paradigm/decisions/` as `TD-*` entries with the full ADR shape — and the `decision` lore type is hard-removed.

## The New Tools

The decision store is reached through two MCP tools (CLI: `paradigm decision record` / `paradigm decision search`):

- **`paradigm_decision_record`** — Records a new decision. Required: `title`, `decision`, `rationale`, `participants`. Optional: `alternatives_considered`, `symbols_affected`, `status`, `tags`, `context`, `consequences`, `superseded_by`, `supersedes`. Returns the canonical `TD-*` id and the companion lore id.
- **`paradigm_decision_search`** — Filters the store by `status`, `participant`, `symbol`, `tag`, `dateFrom`, `dateTo`. Pass `summary: true` for an aggregate view.

A recorded decision looks like:

```yaml
id: TD-2026-04-18-001
title: "Adopt RS256 over HS256 for JWT signing"
timestamp: "2026-04-18T15:30:00Z"
participants:
  - { id: "human/matt", role: human, stance: proposed }
  - { id: "a-paradigm/security", role: agent, stance: supported }
  - { id: "a-paradigm/architect", role: agent, stance: supported }
  - { id: "a-paradigm/builder", role: agent, stance: dissented }
decision: "Sign all JWTs with RS256 (RSA)"
rationale: "Public-key verification lets downstream services validate without sharing the signing secret. Builder dissented over rotation overhead — accepted as a known cost."
alternatives_considered:
  - option: "HS256 (shared secret)"
    rejected_because: "Every verifier needs the secret; rotation is invasive across services."
symbols_affected: ["#auth-middleware", "^authenticated"]
status: active
tags: [security, auth]
```

## The Companion-Lore Pattern

Every successful `paradigm_decision_record` call writes two artifacts:

1. The canonical decision in `.paradigm/decisions/TD-*.yaml`.
2. A companion lore entry of `type: 'insight'` in `.paradigm/lore/entries/{date}/L-*.yaml`, with `references.decision_id` pointing back at the TD- id, and the `companion-lore` + `decision-reference` tags applied.

This split solves the problem the v5.x dual-store approach created. The decision is *topic-addressable* — search by symbol, status, or participant and you get one canonical answer. The companion lore is *time-addressable* — scrolling the project timeline forward, the moment the decision was made still surfaces with a one-line summary and a back-reference to the full record.

The companion write is best-effort. If it fails (filesystem error, permission issue), the decision still records — the timeline coverage is a nice-to-have, not a correctness requirement. The decision record is the source of truth.

## How It Differs from `paradigm_wisdom_record({type:'decision'})`

The v5.x path is soft-deprecated and increasingly hard-removed:

| Concern | `wisdom_record({type:'decision'})` (v5) | `paradigm_decision_record` (v6) |
|---|---|---|
| Storage | `.paradigm/wisdom/decisions.yaml` (single file) | `.paradigm/decisions/TD-*.yaml` (one file per decision) |
| ID shape | `dec-001`, freeform | `TD-{date}-{seq}`, structured |
| Participants | Optional, freeform string | Structured array with stance enum |
| Alternatives | Optional, prose | Structured array with `rejected_because` |
| Status lifecycle | None | `active` / `proposed` / `superseded` / `deprecated` / `rejected` |
| Bidirectional supersede | One-way (`superseded_by`) | Two-way (`superseded_by` + `supersedes`) |
| Companion timeline coverage | Manual | Automatic |
| v6.0 acceptance | `paradigm_wisdom_record` rejects `type:'decision'` | First-class |

If you call `paradigm_wisdom_record({type:'decision'})` against a v6 install, you get a structured rejection envelope (`code: 'wisdom_decision_removed'`) pointing you at `paradigm_decision_record`. Same shape as the lore-record rejection envelope, so a calling agent can auto-retry without human intervention.

## Migrating v1/v2 Lore Decisions

Projects that recorded `type: decision` lore entries through v5 are not stranded. On read, the storage layer remaps `type: decision` to `type: insight` and applies the `v6-migrated:from-decision` tag for forensic recovery. Search for the old type still works via the tag (`paradigm_lore_search({ tag: 'v6-migrated:from-decision' })`).

If you want the old entries promoted to canonical decisions in the new store, do it deliberately — read each migrated entry, decide whether it still represents an active decision, and call `paradigm_decision_record` with the structured shape. There is no automatic backfill because the v1/v2 entries lack the structured participant/alternative data the new shape requires.

## When to Use Which Tool

- **Standalone architectural decision** (no implementation code): `paradigm_decision_record`. The companion lore covers the timeline.
- **Decision made *during* a work session** (alongside implementation): record an `agent-session` lore entry and put the decision in the entry's `decisions` field. If the choice deserves canonical status (search by symbol, supersede tracking, status lifecycle), *also* call `paradigm_decision_record` — the two are not mutually exclusive.
- **Team convention or coding standard**: `paradigm_wisdom_record({type:'preference', ...})`.
- **"Don't do X, do Y instead"**: `paradigm_wisdom_record({type:'antipattern', ...})`.
- **Tracking what changed and when**: `paradigm_history_record` (implementation events).

> **Going deeper:** PARA 501 covers the lore system in detail (including the v6 entry types and the decisions-have-their-own-store callout). PARA 601 covers the three knowledge streams (work-log, journal, decisions) and how the companion-lore pattern fits into the broader stream architecture.
