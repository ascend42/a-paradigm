---
id: N-para-501-assessment-loops
title: Lore as Unified Project Memory
type: note
author: paradigm
created: '2026-04-22'
updated: '2026-04-22'
tags:
  - course
  - para-501
  - lore-is-the
  - eight-entry-types
  - arc-tags-arc
symbols: []
difficulty: beginner
estimatedMinutes: 4
prerequisites: []
category: paradigm-core
origin: imported
source: courses/para-501.json
---

## Lore: The Single Source of Project Memory

Paradigm uses lore as its unified project memory system. Every piece of project knowledge — session records, retrospectives, insights, decisions, milestones — lives in lore entries, differentiated by `type` and classified by tags.

The model is simple: **one system, tags drive classification.**

| Entry Type | When to Use |
|---|---|
| `agent-session` | Automated record of an AI-assisted work session |
| `human-note` | Manual note from a human developer |
| `decision` | Strategic or architectural decision with rationale |
| `review` | Quality review of a previous entry |
| `incident` | Production issue or bug report |
| `milestone` | Significant project achievement |
| `retro` | Retrospective — looking back at completed work |
| `insight` | A realization or pattern discovered across sessions |

Lore entries are stored as YAML files in `.paradigm/lore/entries/{date}/` with the `.lore` extension. Each entry has a unique ID: `L-{date}-{author}-{HHMMSS}-{NNN}`.

## Tags Drive Classification

Tags are the primary classification mechanism in lore. Any string can be a tag, but certain prefixes carry special meaning:

| Tag Prefix | Meaning | Example |
|---|---|---|
| `arc:` | Groups entries into a thematic arc | `arc:auth-hardening`, `arc:v2-migration` |
| `assessment:` | Marks the reflection type | `assessment:retro`, `assessment:insight` |
| `arc-closed` | Arc is no longer active | Added when an arc is complete |
| `arc-status:` | Arc status metadata | `arc-status:complete`, `arc-status:archived` |

Arcs are simply tag prefixes — no separate storage or management needed. To create an arc, just start tagging lore entries with `arc:my-arc-name`. To close an arc, add `arc-closed` and `arc-status:complete` tags to its entries.

## The Body Field

For entries that need more than a 2-3 sentence summary, lore entries support a `body` field for long-form content. This is where retrospective narratives, detailed decision rationale, and multi-paragraph reflections live:

```yaml
id: L-2026-03-02-ascend-164500-001
type: retro
title: "JWT refresh token rotation — what we learned"
summary: Completed refresh token rotation with httpOnly cookie storage.
body: |
  After three sessions implementing refresh token rotation,
  the key insight is that storing refresh tokens in httpOnly
  cookies eliminates an entire class of XSS vulnerabilities.
symbols_touched: ["#refresh-token-handler", "^authenticated"]
linked_lore: [L-2026-02-10-003, L-2026-02-12-001]
linked_commits: [a1b2c3d, e4f5g6h]
tags: [arc:auth-hardening, assessment:retro, security, auth, jwt]
```

## Cross-Referencing

Lore entries can link to other project artifacts:

- **`linked_lore`** — References to other lore entry IDs, creating a web of related records
- **`linked_tasks`** — References to paradigm task IDs
- **`linked_commits`** — Git commit SHAs related to this entry

These links create traceability. A retrospective entry can point to the three session records that produced it and the five commits that implemented it.

## Working with Lore

**Recording:** Use `paradigm_lore_record` with `type`, `title`, `summary`, and `symbols_touched`. Add `body` for long-form content, `tags` with `arc:*` prefixes for arc grouping, and `linked_lore`/`linked_commits` for cross-references.

**Searching:** Use `paradigm_lore_search` with filters:
- `tag: "arc:auth-hardening"` — Find all entries in an arc
- `type: "retro"` — Find all retrospectives
- `hasBody: true` — Find entries with detailed content
- `symbol: "#payment-service"` — Find entries touching a symbol

## The Reflection Loop

Lore supports a natural reflection cycle:

1. **Session records** — Automatically captured during work sessions (type: `agent-session`)
2. **Reflection entries** — Manually recorded at natural pause points (type: `retro`, `insight`, `decision`, `milestone`)
3. **Arc grouping** — Related reflections tagged with `arc:*` for thematic organization
4. **Cross-referencing** — Reflection entries link back to the sessions that produced them

When a task is marked complete via `paradigm_task_done`, the system suggests recording a lore entry as a natural reflection point.

## When to Record Reflective Entries

- **After completing a multi-session feature** — What did we learn? (`retro` with `arc:feature-name`)
- **When a pattern emerges** — "Every time we touch auth, we find token edge cases" (`insight`)
- **When making a strategic choice** — "Switching from REST to GraphQL" (`decision`)
- **When reaching a milestone** — "v2.0 shipped to production" (`milestone`)

The general rule: if the knowledge would be valuable in 3 months, record it as a reflective lore entry with appropriate tags.

## Migration from Assessments

Projects that used the older separate assessment system can migrate with `paradigm lore migrate-assessments`. This converts assessment entries to lore entries with `arc:{arc_id}` and `assessment:{type}` tags, preserving all data.
