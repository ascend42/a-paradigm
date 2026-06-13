---
id: N-para-801-the-task-dag
title: 'Lesson 1: The Spine — A Claimant-Owned Task DAG'
type: note
author: paradigm
created: '2026-06-13'
updated: '2026-06-13'
tags:
  - course
  - para-801
  - close-the-loop
  - task-dag
  - claimant
symbols: []
difficulty: intermediate
estimatedMinutes: 8
prerequisites: []
category: paradigm-core
---

## Why v7 Exists: Recording vs. Verifying

Before v7, Paradigm *recorded that it was asked to do the right thing — but it did not verify that it did.* A two-slice self-audit (first the task system, then the orchestration engine) proved this with file-and-line evidence: the classifier misrouted silently, the best agents were not routable, the learning loop's broken state was byte-identical to its healthy state, enforcement checked invocation rather than work, and the Captain owned nothing.

v7 — "Close the Loop" — makes the framework's own value proposition **true instead of asserted**. It does this with one keystone primitive:

> A persisted, symbol-bound, **claimant-owned task DAG** that orchestration emits, whose completion feeds the learning loop, and which Cid the Captain manages.

One primitive closes four problems at once: the open learning loop, the orchestration-to-task disconnect, Cid's inertness, and the unfalsifiability of "self-improving." This lesson covers the keystone itself — the Spine. (Decision **TD-2026-06-13-718**; design in `docs/specs/v7-close-the-loop.md`.)

## The New Task Schema

The `Task` interface in `packages/paradigm-mcp/src/utils/task-loader.ts` gained four families of fields in v7:

```typescript
export type ClaimantKind = 'archetype' | 'human' | 'peer';
export interface Claimant { kind: ClaimantKind; ref: string; }

export type TaskStatus =
  | 'open' | 'in-progress' | 'done' | 'shelved';   // v7.0 ships 4 states

export interface Task {
  id: string; created: string;                 // immutable
  blurb: string; priority: 'high'|'medium'|'low'; status: TaskStatus; tags: string[];
  claimant?: Claimant;                          // typed claim — NOT a name string
  parentTaskId?: string; dependsOn?: string[]; stage?: number;   // DAG edges
  started_at?: string; completed?: string; settledAt?: string;   // lifecycle stamps
  external_ref?: ExternalRef;                   // renamed from orphan session_link
  related_lore?: string[];
}
```

## The Claimant: A Typed Claim, Not a Name Tag

The single most important design decision in the Spine is that ownership is a **tagged union**, not a flat assignee string:

```typescript
{ kind: 'archetype', ref: 'builder' }   // a role on the roster
{ kind: 'human',     ref: 'matt@…' }    // a git user / email
{ kind: 'peer',      ref: 'agent-7' }   // a Symphony peer agentId
```

A flat `assignee: "builder"` string cannot answer the questions the learning loop needs to ask. Is "builder" a role that any instance can fill, a specific human, or a remote peer? Those three carry completely different meaning:

- **Archetype-fit signal** (v7.x analytics): comparing the *predicted* owner (`kind: archetype`) against the *closing* owner tells you whether auto-routing picked the right specialist.
- **Reassignment-churn detection**: three claimant rewrites before a task settles flags a `spec-clarity` antipattern — the blurb was under-specified. But a *healthy* peer handoff (`kind: peer`) must be distinguished from churn, and only the typed `kind` lets you tell them apart.

A name tag throws away the very distinction the loop is built to learn from. The typed claim is the difference between "someone touched this" and "this kind of owner closed this kind of work."

## DAG Edges Without a Database

The DAG is stored as an **edge-list-in-node**: each task's own YAML carries its `parentTaskId`, `dependsOn`, and `stage`. The graph is reconstructed simply by loading the node set — **no separate edges file, no SQLite.** This survives the existing date-partitioned task loader with zero loader changes, and cross-date edges still work because every task id embeds its date.

- `parentTaskId` — points at the **epic** (the orchestration root) this stage child belongs to.
- `dependsOn` — the resolved handoff edges (this stage waits on those stages).
- `stage` — the ordinal position in the topologically-sorted handoff graph.

## The `in-progress` Status and the State Machine

v7.0 ships **four** states (`open | in-progress | done | shelved`); `claimed` and `blocked` are deferred to a fast-follow because they are justified only by Symphony peer-claims, which are themselves fast-follow. The transitions are enforced by a single `assertTransition` guard inside `updateTask`:

```
open        → in-progress | done | shelved
in-progress → done | open | shelved
shelved     → open
done        → (terminal)
```

`started_at` is stamped the moment a task enters `in-progress`. `settledAt` is stamped only by the learning loop (covered in Lesson 3) — never by live status writes. That single ownership rule, "live state is written by one owner; the settlement stamp by another," is what keeps the loop honest.

## Additive, Lazy-Healing Migration

Every v7 field is **optional**, so old task YAML loads unchanged. The orphaned `session_link` field is healed into the typed `external_ref` by a read-side `normalizeTask` shim at the load chokepoint — files migrate on their next write, with no bulk migration step. MCP tool enums *widen* (non-breaking). The task system also gained its **first tests ever** in v7 — the audit found zero, and the Spine ships with 23 unit tests.
