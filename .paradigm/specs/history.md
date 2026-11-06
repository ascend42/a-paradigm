# History System Specification

> **Paradigm v1.2** | Implementation history derived from git, validation, fragility tracking

## Overview

The History system captures the **temporal and empirical dimension** of development - what was implemented, what worked, what was rolled back, and how stable different areas are over time. It's the project's memory, indexed by Paradigm symbols.

## Purpose

- **Track what changed** - every commit carrying symbols, plus authored implementations, validations, rollbacks
- **Identify fragile areas** - symbols with frequent failures or rollbacks need extra care
- **Detect co-change patterns** - symbols that often change together
- **Guide AI agents** - check stability before modifying risky areas
- **Enable post-mortems** - full history for any symbol

## Sources and Storage

History has three sources, merged on read:

| Source | Where | Id |
|--------|-------|----|
| `git` | Derived from each commit reachable from HEAD that carries symbols. Cached per SHA in the machine home (`<state dir>/<repoId>/history/commits.jsonl`), never in the repository | `h-<sha12>` |
| `authored` | `paradigm history record / validate` and the MCP `paradigm_history_record / _validate` tools append to `log.jsonl` | `h-<base36 ms><4 random>` |
| `legacy` | Rows the pre-v4 post-commit hook appended to `log.jsonl` (frozen, still read) | `h0001`, or `h0001@<sha7>` when two branches minted the same one |

```
.paradigm/history/
├── log.jsonl           # Tracked: authored rows (+ frozen legacy rows); merge=union
├── index.yaml          # GENERATED and git-ignored: rebuilt on read when stale
└── validation.yaml     # Validation config + summary
```

A commit row is a pure function of (SHA, message, changed files, `.purpose` at that SHA):

- **Symbols** come from every `Symbols:` line of the message (a GitHub squash merge concatenates several). A commit with none falls back to the nearest `.purpose` (not the root one) of each changed file, read at that commit, narrowed to the symbols that cover that file: a component whose declared `path` / `file` / `files` names it (or a folder holding it), or a path-less one whose id equals the file's name stem (`login-form.ts` tags `#login-form`). A shallow clone's boundary commit is derived from its trailers only and never cached. A git failure or timeout leaves the result incomplete: nothing is cached as "no symbols" and the index is not written. No match, no symbols: a commit never inherits every component of a `.purpose`.
- **Author** is the commit author; `type: agent` when a `Co-Authored-By:` trailer names an AI agent or bot.
- **Intent** comes from the subject prefix (feat/fix/refactor).
- Amended or rebased-away commits drop out (only reachable SHAs count); a cherry-pick is a new SHA and a new row.
- A log row that names a commit wins over the derived row for it, so legacy ids keep resolving.
- Legacy rows are not reachability-filtered: a legacy row for a pre-squash branch commit still counts alongside the derived row of the squash commit that replaced it.

No hook writes history: a commit leaves the working tree clean. In a shallow clone the index is marked `shallow: true` and fragility checks warn that older history is missing.

## Schema: log.jsonl

Append-only, one JSON object per line. Never edit - only append. `.gitattributes` carries `.paradigm/history/log.jsonl merge=union` (written by `paradigm init` / `paradigm sync`), so rows authored on two branches merge without a conflict; ids are random, so they never collide.

```jsonl
{"id":"h-mhx2k3a01b2c","ts":"2026-02-02T10:30:00Z","source":"authored","type":"validate","ref":"h-3f9c2a1b7d4e","symbols":[],"author":{"type":"agent","id":"tester"},"result":"pass","tests":{"passed":15,"failed":0}}
{"id":"h-mhx2m0q9zz01","ts":"2026-02-03T09:00:00Z","source":"authored","type":"rollback","ref":"h-3f9c2a1b7d4e","symbols":["#checkout"],"author":{"type":"human","id":"alice"},"reason":"Performance regression on mobile"}
```

A derived row (not stored in the repository) looks like:

```json
{"id":"h-3f9c2a1b7d4e","ts":"2026-02-02T10:00:00Z","source":"git","type":"implement","symbols":["#checkout"],"author":{"type":"human","id":"Ada"},"commit":"3f9c2a1b7d4e…","intent":"feature","files":["src/checkout/page.tsx"],"description":"feat(#checkout): Apple Pay support"}
```

### Entry Types

| Type | Description |
|------|-------------|
| `implement` | New feature, bug fix, or change |
| `validate` | Test results for an implementation |
| `rollback` | Reverting a previous change |
| `refactor` | Code restructuring without behavior change |

### Fields

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Unique ID (`h-<sha12>` derived, `h-<ms36><rand4>` authored, `h0001` legacy) |
| `source` | string? | `git` / `authored` / `legacy` (readers fill it in; on disk only authored rows carry it) |
| `ts` | string | ISO timestamp |
| `type` | string | Entry type (implement/validate/rollback/refactor) |
| `symbols` | string[] | Affected Paradigm symbols |
| `author` | object | `{type: "human"|"agent", id: string}` |
| `commit` | string? | Git commit hash |
| `intent` | string? | feature/fix/refactor/experimental/confirmed |
| `files` | string[]? | Affected files |
| `description` | string? | What was done |
| `ref` | string? | Reference to related entry (for validate/rollback) |
| `result` | string? | pass/fail/partial (for validate) |
| `tests` | object? | `{passed, failed, skipped}` (for validate) |
| `reason` | string? | Reason for rollback |

## Schema: index.yaml

Generated from log.jsonl merged with the derived rows, and git-ignored. Every reader (`paradigm history`, the MCP tools and resources) checks its `stamp` and rebuilds it when HEAD, log.jsonl or the commit cache changed, so a fresh clone has an index on first read. It is only written when git ignores it (after `paradigm sync`); in an unmigrated repository it is computed in memory and the tracked file is left alone. `paradigm history reindex` forces a rebuild.

```yaml
version: "1.0"
generated: "2026-02-02T12:00:00Z"
stamp: { v: 1, head: "3f9c2a1b…", logSize: 1024, logMtimeMs: 1738497600000, cacheCount: 52311 }

by_symbol:
  "#checkout":
    symbol: "#checkout"
    total_changes: 45
    last_modified: "2026-02-02T10:00:00Z"
    stability_score: 0.87    # 0.0-1.0, higher is better
    fragility: low           # low | medium | high | critical
    recent:
      - id: h0045
        type: implement
        description: "Added Apple Pay"
        ts: "2026-02-02T10:00:00Z"
      # ... last 5 entries
    contributors:
      human: ["alice", "bob"]
      agent: ["builder", "fixer"]

  "#search":
    symbol: "#search"
    total_changes: 23
    last_modified: "2026-01-28T15:00:00Z"
    stability_score: 0.62
    fragility: high
    recent: [...]
    contributors:
      human: ["carol"]
      agent: ["builder"]

co_changes:
  - symbols: ["#checkout", "#payment-form"]
    frequency: 15        # Changed together 15 times
    correlation: 0.89    # 89% of #checkout changes include #payment-form

  - symbols: ["#search", "#search-index"]
    frequency: 12
    correlation: 0.78

fragile_symbols:
  - symbol: "#search"
    fragility: high
    reason: "3 rollbacks in last 10 changes"

  - symbol: "#legacy-api"
    fragility: critical
    reason: "Stability score 0.41, 5 failures in last month"
```

## Schema: validation.yaml

```yaml
version: "1.0"
last_run: "2026-02-02T11:00:00Z"
total_validations: 156
pass_rate: 0.92

by_symbol:
  "#checkout":
    symbol: "#checkout"
    last_validated: "2026-02-02T10:30:00Z"
    last_result: pass
    pass_count: 45
    fail_count: 3
    coverage: 0.87

  "#search":
    symbol: "#search"
    last_validated: "2026-01-28T16:00:00Z"
    last_result: fail
    pass_count: 18
    fail_count: 5
    coverage: 0.72
```

## Fragility Scoring

Stability score is calculated from:

```
base = 1.0
penalty_per_rollback = 0.20
penalty_per_failure = 0.10
normalized_changes = total_changes / 10

stability = max(0, base - (rollbacks * 0.20 + failures * 0.10) / max(1, normalized_changes))
```

Fragility levels:

| Score | Level | Meaning |
|-------|-------|---------|
| 0.85+ | low | Safe to modify |
| 0.70-0.85 | medium | Moderate care needed |
| 0.50-0.70 | high | Extra testing recommended |
| <0.50 | critical | Consider deferring or extensive review |

## MCP Resources

| URI | Description |
|-----|-------------|
| `paradigm://history/symbol/{symbol}` | Full history for a symbol |
| `paradigm://history/symbol/{symbol}/recent` | Last 5 changes only |
| `paradigm://history/fragile` | List of fragile symbols |
| `paradigm://history/cochanges/{symbol}` | Co-change patterns |
| `paradigm://history/validation/summary` | Validation statistics |

## MCP Tools

### paradigm_history_context

Get history before modifying symbols.

```json
{
  "name": "paradigm_history_context",
  "arguments": {
    "symbols": ["#checkout", "#payment-form"]
  }
}
```

**Returns:** Summary, recent changes, contributors, co-change patterns for each symbol.

### paradigm_history_record

Record an implementation event.

```json
{
  "name": "paradigm_history_record",
  "arguments": {
    "type": "implement",
    "symbols": ["#checkout"],
    "intent": "feature",
    "description": "Added Apple Pay support",
    "commit": "abc123",
    "files": ["src/checkout/page.tsx"]
  }
}
```

### paradigm_history_validate

Record test results.

```json
{
  "name": "paradigm_history_validate",
  "arguments": {
    "implementation_id": "h-3f9c2a1b7d4e",
    "result": "pass",
    "tests": {"passed": 15, "failed": 0}
  }
}
```

### paradigm_history_fragility

Check fragility before modifying.

```json
{
  "name": "paradigm_history_fragility",
  "arguments": {
    "symbols": ["#search", "#checkout"]
  }
}
```

**Returns:** Fragility levels, warnings, recommendations.

## CLI Commands

```bash
# Show history overview
paradigm history

# Show history for a symbol
paradigm history show #checkout

# Initialize history directory
paradigm history init

# Show fragile symbols
paradigm history fragile

# Rebuild the generated index now (reads do it automatically when stale)
paradigm history reindex

# Record an implementation
paradigm history record \
  --type implement \
  --symbols "#checkout" \
  --description "Added Apple Pay" \
  --intent feature

# Record validation result
paradigm history validate \
  --result pass \
  --ref h-3f9c2a1b7d4e \
  --passed 15 \
  --failed 0
```

## Git Hooks

History needs no hook. `paradigm hooks install` (hook version 4) writes:

- post-commit: passes the commit's `Symbols:` to `paradigm task sync-commit` (linked external items); writes no history
- pre-push: a no-op (it used to reindex the tracked index)
- pre-commit: the scoped learning guard

### Migrating from pre-v4 history

Before v4 the post-commit hook appended to the tracked log.jsonl (with `wc -l + 1` ids that collided across branches) and pre-push rewrote the tracked index.yaml, so every commit left the tree dirty.

```bash
paradigm sync            # ignore + git rm --cached history/index.yaml; .gitattributes merge=union
git commit -am "chore: history derived from git"
paradigm hooks install   # v1-v3 → v4, old hook kept as .paradigm-v<N>.bak, Warpline block preserved
```

A branch that still changes index.yaml hits one modify/delete conflict on it when merged or rebased: resolve it as a delete (`git rm .paradigm/history/index.yaml`). There is no backfill: legacy rows stay as they are and keep resolving. `paradigm doctor` warns while a repository has not migrated.

## Agent Workflow

Before modifying code, AI agents should:

1. **Check fragility** for symbols they're modifying
2. **Review recent history** - what changed, what broke
3. **Note co-change patterns** - related symbols may need updates
4. **After implementing**, record the change

Example:

```
Agent: "I need to modify #search to add filters"

1. Call paradigm_history_fragility(symbols: ["#search"])
   → fragility: "high"
   → reason: "3 rollbacks in last 10 changes"
   → recommendation: "Add extra test coverage"

2. Call paradigm_history_context(symbols: ["#search"])
   → Recent: 2 rollbacks, 1 performance issue
   → Co-changes: often changes with #search-index
   → Contributors: carol (human), builder (agent)

3. Implement with extra care, add comprehensive tests

4. Commit with a `Symbols: #search` trailer (the commit becomes a history row)

5. After tests pass, call paradigm_history_validate(...)
```

## Best Practices

1. **Use `Symbols:` trailers** - they are what attributes a commit; record rollbacks and failed attempts too
2. **Check fragility first** - before modifying unknown areas
3. **Respect co-change patterns** - if A often changes with B, check B
4. **Keep squash bodies** - a squash merge that drops the commit trailers falls back to `.purpose` symbols (GitHub: default the squash message to the PR title and commit details)
5. **Review fragile symbols** - in sprint planning

## Token Cost Optimization

- Fragility check: ~50-80 tokens
- Symbol history (recent only): ~100-150 tokens
- Full history: ~200-400 tokens
- Co-change patterns: ~50-100 tokens

The generated index.yaml (and the per-SHA commit cache) avoid re-reading git history on every call; only commits not yet cached are read.
