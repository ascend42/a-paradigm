---
id: N-para-801-settlement-closes-the-loop
title: 'Lesson 3: Settlement Closes the Loop'
type: note
author: paradigm
created: '2026-06-13'
updated: '2026-06-13'
tags:
  - course
  - para-801
  - close-the-loop
  - task-settlement
  - learning-loop
symbols: []
difficulty: intermediate
estimatedMinutes: 8
prerequisites: []
category: paradigm-core
---

## The Dead Joint

The learning loop was, in principle, a chain: a task finishes, the work is logged, a postflight pass extracts insights, and good insights are promoted into agent notebooks. In practice the audit found the very first link severed — `task_done` fed *nothing*. A task could complete and the learning chain would simply never run. Worse, the broken state looked exactly like the healthy state: no error, no missing file, just silence.

v7 closes this with a new module, `packages/paradigm-mcp/src/utils/task-settlement.ts`, and one function: `settleParentIfComplete(rootDir, parentTaskId)`.

## The Trigger: All Siblings Terminal

The original design fired settlement only on `done`. An adversarial review (Lesson 6) caught that this re-creates the open-loop bug: one `shelved` sibling, a `blocked` sibling, or a crashed run would leave the parent unsettled *forever*. The corrected trigger is **all-siblings-terminal**:

> When every task sharing a `parentTaskId` reaches a terminal state, the parent settles — exactly once.

The terminal set is a forward-compatible predicate (`{ done, shelved, crashed }` in v7.0). The settlement hook is placed **inside `updateTask`** — the real chokepoint — gated on `isTerminal(status) && parentTaskId`. Putting it there means `completeTask`, `shelveTask`, and any direct status set all fire settlement; none can drift. Idempotency is guaranteed by stamping `settledAt` once.

Two safety valves round it out:
- **A reaper** crashes abandoned `in-progress` tasks that are stale past a time window (default 30 minutes) whose run is no longer live — so a dead run cannot wedge a subtree open, and the liveness probe (Lesson 4) still sees it.
- **Orphan policy** — a child whose parent is missing self-settles and emits a `warn`.

## The Wired Chain

When a parent settles, it runs the learning chain — replacing every advisory-prose joint with a real call, in order:

```
recordWorkLog → runPostflightLearning → autoPromoteJournalEntries
```

(In the MCP world this also threads Cid's debrief and `sessionInsights`.) This is the moment the loop *actually closes*: completed work becomes a work-log entry, the postflight pass turns verdict patterns into journal entries, and proven journal entries are promoted into notebooks the agents read next session.

## The Cid ↔ Loid Boundary

Settlement only ever writes `settledAt` and crash markers — **never live status**. This is the load-bearing ownership rule of v7:

> **Cid writes the present tense; Loid writes the past tense; they never co-write a field.**

- **Cid** (the Captain) writes `status` live-transitions, `claimant`, and the DAG edges at emission.
- **Loid** (intelligence officer) writes only `settledAt` — the retrospective trigger — plus everything in the learning stores (journals, notebooks, calibration). Loid is read-only on every other Task field.

The dependency arrow points one way: `status → settlement → learning`. Settlement never calls back to change status. That one-way arrow is why the loop can close without two owners fighting over the same field — and it is the boundary the whole self-improving claim rests on.

## Honest Confidence, Not Synthetic Belief-Deltas

The settlement chain feeds notebook promotion, which gates on confidence. v7 made one honest cut here. The original plan promoted on a **belief-delta** (`confidence_after − confidence_before ≥ 0.15`), but the adversarial review proved both numbers were branch literals — promoting on the *difference of two constants* is numerology.

v7.0's fix: keep the existing absolute `≥ 0.8` promotion gate, but make `confidence_after` **real** — agents emit an optional `confidence` value that `runPostflightLearning` prefers, falling back to the old literal only when absent. `confidence_before` stays in the type, now explicitly marked *not gated on*. The belief-delta gate is honestly deferred to v7.x (a real pre-task prior needs unbuilt elicitation infrastructure). Honest absolute-confidence learning now; belief-movement learning later — designed honestly rather than shipped on synthetic numbers.
