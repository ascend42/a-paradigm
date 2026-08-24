# Paradigm Decisions Guide

> The canonical "what we decided and why" store. Post-v6.0.
> Replaces and consolidates the legacy `wisdom/decisions/*.yaml` and `lore.type='decision'` paths.

## 1. What a "decision" is in Paradigm

A decision is a recorded team or solo conclusion — _what_ was decided, _why_, _who_ participated, and _what symbols_ it affects. Where lore captures the narrative timeline and wisdom captures preferences and antipatterns, decisions capture choice points: "we picked X over Y because Z."

A `TeamDecision` carries:

- `id` — `TD-YYYY-MM-DD-NNN` (auto-generated)
- `title` and `decision` (the decision text)
- `rationale` — why this was chosen
- `participants[]` — `{ id, role: human|agent, stance: proposed|supported|dissented|abstained|neutral }`
- `symbols_affected[]`
- `status` — `active | superseded | deprecated | proposed | rejected`
- `alternatives_considered[]` — `{ option, rejected_because }`
- `tags[]`
- v6.0 additive fields: `context`, `consequences: { positive, negative, mitigations }`, `date`, `migrated_from`, `supersedes[]`, `superseded_by`

Full type definition lives at `packages/paradigm-mcp/src/types/knowledge-streams.ts`.

## 2. Where decisions live

Canonical store post-v6.0:

```
.paradigm/decisions/
  TD-2026-04-18-001.yaml
  TD-2026-04-18-002.yaml
  TD-2026-04-22-001.yaml
  ...
```

One file per decision. YAML, human-readable, git-tracked. Loader at `packages/paradigm-mcp/src/utils/decision-loader.ts`.

This is the **only** canonical decision store as of v6.0. Two legacy locations were either consolidated here or removed:

- `.paradigm/wisdom/decisions/*.yaml` — legacy ADR-style; consolidated into `.paradigm/decisions/` via `paradigm migrate decisions`
- `lore.type='decision'` entries — hard-removed in v6.0; auto-remapped to `lore.type='insight'` on read with the `v6-migrated:from-decision` tag for forensic discoverability

See [v6 Migration Guide](./v6-migration.md) §2 and §6 for the consolidation walkthrough.

## 3. The companion-lore pattern (D3 synthesis)

Every `paradigm_decision_record` call writes _two_ files:

1. The structured decision at `.paradigm/decisions/TD-*.yaml` (the canonical record)
2. A companion lore insight entry at `.paradigm/lore/entries/YYYY-MM-DD/L-*.lore` with `type: 'insight'` and `references.decision_id` pointing at the canonical record

```yaml
# .paradigm/decisions/TD-2026-04-18-001.yaml
id: TD-2026-04-18-001
timestamp: '2026-04-18T14:22:10Z'
title: Adopt structured decision store
decision: All decisions go in .paradigm/decisions/; lore.type='decision' is removed.
rationale: Three-way fracture — same payload landing in lore, wisdom, and ad-hoc YAML. Hard pick one canonical store.
participants:
  - { id: architect, role: agent, stance: proposed }
  - { id: matt,      role: human, stance: supported }
symbols_affected: ['#lore', '#decision-loader']
status: active
```

```yaml
# .paradigm/lore/entries/2026-04-18/L-2026-04-18-matt-142210-001.lore
id: L-2026-04-18-matt-142210-001
type: insight
timestamp: '2026-04-18T14:22:10Z'
author: matt
title: Decision TD-2026-04-18-001 recorded
summary: Companion lore entry for decision record TD-2026-04-18-001. See .paradigm/decisions/TD-2026-04-18-001.yaml.
symbols_touched: ['#lore', '#decision-loader']
references:
  decision_id: TD-2026-04-18-001
tags: [companion-lore, decision-reference]
```

**Why both stores:**

- The decision in `.paradigm/decisions/` is the structured record — searchable by status, participant, symbol, and tag, with rationale and alternatives in known fields.
- The lore insight is the immutable narrative timeline — when you replay the project's history, the decision shows up at the right point chronologically without forcing lore to be a knowledge store too.

This is the D3 synthesis from the v6.0 ship — locked in `docs/private/plans/v6.0-decisions-locked.md`. Lore stays a timeline, decisions live in their own store, and the companion entry is how the timeline stays complete.

The companion write is best-effort: a failure does not block decision recording. See `writeCompanionLoreEntry` at `packages/paradigm-mcp/src/utils/decision-loader.ts:138`.

## 4. The MCP tools

Two tools, defined in `packages/paradigm-mcp/src/tools/streams.ts`. ~100–200 token responses.

### `paradigm_decision_record`

Records a new decision and writes the companion lore entry.

```typescript
paradigm_decision_record({
  title: "Adopt structured decision store",
  decision: "All decisions go in .paradigm/decisions/; lore.type='decision' is removed.",
  rationale: "Three-way fracture — same payload landing in lore, wisdom, and ad-hoc YAML.",
  participants: [
    { id: "architect", role: "agent", stance: "proposed" },
    { id: "matt",      role: "human", stance: "supported" },
  ],
  alternatives_considered: [
    { option: "Keep lore.type='decision'", rejected_because: "Three-way fracture — same payload in three stores" },
    { option: "Use wisdom only",           rejected_because: "Wisdom semantics are preferences, not choice points" },
  ],
  symbols_affected: ["#lore", "#decision-loader"],
  status: "active",                                   // or "proposed"
  tags: ["v6.0", "knowledge-streams"],
})
```

Required fields: `title`, `decision`, `rationale`, `participants`. Returns `{ recorded, id, title, timestamp, companion_lore_id? }`.

### `paradigm_decision_search`

Find decisions by status, participant, symbol, tag, or date range.

```typescript
paradigm_decision_search({
  status: "active",                   // active | superseded | deprecated | proposed | rejected
  participant: "architect",           // by participant id
  symbol: "#lore",                    // by affected symbol
  tag: "v6.0",                        // tag-prefix match
  dateFrom: "2026-04-01",
  dateTo: "2026-04-30",
  limit: 20,
})

// or — aggregate summary
paradigm_decision_search({ summary: true })
```

Returns `{ count, entries[] }` with id, title, status, decision (truncated 200 chars), participants (formatted as `id (stance)`), symbols, timestamp. The `summary: true` form returns counts by status, recent decisions, and the union of symbols covered.

## 5. CLI surface

There is no `paradigm decision record` or `paradigm decision search` CLI today. Decision recording is MCP-only at v6.0; the CLI surface for decisions is exactly the migration command:

```bash
paradigm migrate decisions             # consolidate legacy → .paradigm/decisions/
paradigm migrate decisions --dry-run   # preview without writes
paradigm migrate decisions --json      # JSON summary
```

There is also a legacy `paradigm wisdom decide` ADR command — this writes to the wisdom store (`.paradigm/wisdom/decisions/`), which is **soft-deprecated as of v6.0** and slated for hard-removal in a future minor. New decisions should use `paradigm_decision_record` (MCP). Existing wisdom decisions are picked up by `paradigm migrate decisions`.

Possible future CLI additions: `paradigm decision record` and `paradigm decision search`.

## 6. Migrating from v5.x

`paradigm migrate decisions` is idempotent. Run it once after upgrading to v6.0:

```bash
paradigm migrate decisions
```

Output:

```
paradigm migrate decisions
  target: .paradigm/decisions/

  no .paradigm/wisdom/decisions/ dir — skipping wisdom migration

Migration summary
  wisdom decisions converted: 0
  lore decisions converted:   3
  lore entries rewritten → insight: 3

✓ migrate decisions complete
```

What it does:

1. **Wisdom decisions** (`.paradigm/wisdom/decisions/*.yaml`):
   - Converted to `TD-*` entries with `migrated_from: 'wisdom-decision'` and a `wisdom-decision:<id>` tag for re-discoverability
   - Source files **deleted** after successful write
   - The empty `wisdom/decisions/` directory is removed

2. **Lore `type='decision'` entries** (`.paradigm/lore/entries/**/*.{yaml,lore}`):
   - Converted to `TD-*` entries with `migrated_from: 'lore-decision'`, `linked_lore: <original-lore-id>`, and a `lore-decision:<id>` tag
   - Original lore entry is **rewritten in place** to `type: 'insight'` with `references.decision_id` pointing at the new TD-* — the narrative timeline stays complete
   - A note is appended to the lore entry's body: `"Original type was 'decision'; migrated to TD-* on YYYY-MM-DD."`

Idempotence: re-running checks for existing `wisdom-decision:<id>` and `lore-decision:<id>` tags on TD-* files and skips already-migrated entries. Safe to run as many times as needed during a staged migration.

Source: `packages/paradigm/src/commands/migrate-decisions.ts`.

## 7. Why `type='decision'` was removed from lore

Three storage tiers existed pre-v6.0 for decision-shaped content:

1. `lore.type='decision'`
2. `wisdom_record({type:'decision'})` (writes to `.paradigm/wisdom/decisions/`)
3. Ad-hoc YAML the user dropped in `.paradigm/decisions/`

This was the **three-way fracture**: identical payloads landing in three stores, with no canonical truth and no consolidated search. v6.0 hard-picked store (3) as the canonical home and made the corrections asymmetric:

- **Lore was hard-removed.** `paradigm_lore_record({type:'decision'})` and `paradigm_assessment_record({type:'decision'})` now return a structured rejection envelope: `code: 'lore_type_decision_removed'`, `successor_tool: 'paradigm_decision_record'`, `removed_in: '6.0.0'`. CLI side: storage-layer guard at `recordLore()` throws the same migration message. Both surfaces point at the canonical successor in the same words.

- **Wisdom was soft-deprecated.** `paradigm_wisdom_record({type:'decision'})` still writes to disk in v6.0 with a deprecation warning. Per the D3 lock: lore was the documented three-way fracture offender (hard-remove justified); wisdom was the documented ADR path that earned a longer grace. Hard-error ships in a later minor.

What to use instead:

| You used to write | Use now |
|---|---|
| `paradigm_lore_record({type:'decision'})` | `paradigm_decision_record(...)` |
| `paradigm_assessment_record({type:'decision'})` | `paradigm_decision_record(...)` |
| `paradigm_wisdom_record({type:'decision'})` | `paradigm_decision_record(...)` (still writes; slated to hard-error in a future minor) |
| Manual `.paradigm/decisions/TD-*.yaml` write | `paradigm_decision_record(...)` (gives you the companion lore for free) |
| Narrative-only reference to a decision | `paradigm_lore_record({type:'insight', references:{decision_id:'TD-...'}})` |

Rejection envelope source: `packages/paradigm-mcp/src/utils/lore-rejection.ts`. Storage guard: `packages/paradigm/src/core/lore/storage.ts:158-166`.

## 8. Forensic recovery via the migration tag

Pre-v6.0 lore entries with `type='decision'` are auto-remapped to `type='insight'` on read by the `lore-loader` v1→v2 migration shim, with a `v6-migrated:from-decision` tag preserved on the entry. To find them:

```typescript
paradigm_lore_search({ tag: "v6-migrated:from-decision" })
```

Or via CLI:

```bash
paradigm lore list --tag v6-migrated:from-decision
```

Once `paradigm migrate decisions` runs, those entries also get `references.decision_id` populated so you can jump straight to the canonical TD-* record.

## 9. Supersession

Decisions can supersede earlier decisions; v5.39.0 added bidirectional fields so the graph can be walked either direction without a separate index.

```typescript
// supersede via direct record + manual update, or via the supersedeDecision helper
import { supersedeDecision } from './utils/decision-loader';

supersedeDecision(rootDir, 'TD-2026-04-01-002', {
  title: 'Move companion lore to type:insight',
  decision: 'Use type:insight instead of a new type:decision-reference.',
  rationale: 'Avoids re-introducing a new type that would face the same fracture pressure.',
  participants: [{ id: 'architect', role: 'agent', stance: 'proposed' }],
  symbols_affected: ['#lore'],
  status: 'active',
});
```

Old decision is marked `status: 'superseded'` with `superseded_by: 'TD-...'`. New decision carries `supersedes: ['TD-2026-04-01-002']` automatically (D2 Loid addendum — graph walk in either direction).

## 10. Decisions in the wider streams architecture

Three knowledge streams ship in v6.0 alongside lore and wisdom:

| Stream | Tool | Purpose | Lifecycle |
|---|---|---|---|
| **Work log** | `paradigm_work_log_record / _search` | What got done. | Operational — sprint horizon. |
| **Journal** | `paradigm_journal_record / _search` | What an agent learned. Per-agent, travels across projects. | Agent-private. |
| **Decisions** | `paradigm_decision_record / _search` | What was decided and why. | Institutional — lasts as long as the decision is relevant. |

Lore continues as the immutable narrative timeline; wisdom continues as preferences/antipatterns/expertise. Decisions completed the picture by giving choice points a home. See `paradigm://guidance/knowledge-streams` (loadable MCP resource) for the full streams overview.

---

## Audience track map

- **Recording your first decision:** §1, §3, §4 (`paradigm_decision_record`)
- **Migrating a v5 project to v6:** §6, §7, §8
- **Searching past decisions:** §4 (`paradigm_decision_search`), §8
- **Understanding why this changed in v6.0:** §7, [v6 Migration Guide](./v6-migration.md)

---

*Source of truth for the shipped surface: `packages/paradigm-mcp/src/tools/streams.ts`, `packages/paradigm-mcp/src/utils/decision-loader.ts`, `packages/paradigm-mcp/src/utils/lore-rejection.ts`, `packages/paradigm/src/commands/migrate-decisions.ts`, `packages/paradigm/src/core/lore/storage.ts`. v6.0 D3 lock: `docs/private/plans/v6.0-decisions-locked.md`.*
