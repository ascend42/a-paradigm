---
id: N-para-801-cid-becomes-real
title: 'Lesson 5: Cid the Captain Becomes Real'
type: note
author: paradigm
created: '2026-06-13'
updated: '2026-06-13'
tags:
  - course
  - para-801
  - close-the-loop
  - captain-board
  - cid
symbols: []
difficulty: intermediate
estimatedMinutes: 7
prerequisites: []
category: paradigm-core
---

## "The Captain Owns Nothing"

Cid is the Captain archetype — responsible for navigation and coverage. But the audit's blunt finding was that *the Captain owned nothing and never did anything.* Session-open showed an anonymous static task dump (`context.ts:723-738`); session-close wrote a `.cid-briefed` marker unconditionally (`captain.ts:645`) regardless of what actually happened. Cid had a role with no artifact and no mutation — a job title with no job.

The Spine (Lessons 1-3) gives Cid the thing he was missing: a durable, owned, writable artifact. v7 makes the Captain *real*.

## `paradigm_captain_board` — Cid's Owned Surface

A new MCP tool, `paradigm_captain_board`, gives Cid a read+write artifact with three actions (`read | claim | advance`):

- **`read`** assembles the **live run-DAG** — epic tasks with their stage children ordered by `dependsOn` — plus a ripple-ranked list of `unclaimed` tasks and a summary. This is exactly what the Conductor task-dashboard renders.
- **`claim`** and **`advance`** are **Cid's and only Cid's** write path for `claimant`, live status transitions, and run-record `runStatus`.

For the first time, the Captain has a board to read and a board to write.

## Session-Open: Propose Claimants

At session-open, the anonymous task dump is replaced by a **Cid-attributed board read**. Cid runs the reaper, reads the board, ranks unclaimed tasks by ripple-risk (reusing the brief's ripple machinery), surfaces the top few, and **proposes claimants** — writing `claimant` and advancing `open → claimed` on the proposals.

That write is the point. It is the durable proof the Captain did something this session. (Human or peer claims always override an archetype proposal — Cid proposes; people decide.) If the board read fails, Cid falls back safely to the plain task list — instrumentation never blocks the session.

## Session-Close: Check the Loop, Self-Heal, Never Deadlock

At session-close, the debrief gains real checks before it clears the Stop hook: did the run-record advance off `pending`? did claimed tasks change status (else release stale claims)? and — reading the `chainLive` liveness probe from Lesson 4 — **did postflight actually run?**

Here v7 made a sharp correction. An early design had Cid *refuse to finish the session* if the learning chain hadn't run. The adversarial review flagged this as a **user-facing deadlock**: blocking a human from finishing their work because a *learning* step didn't fire inverts the priorities entirely. The fix:

- If the chain didn't run, Cid **self-heals** — he runs postflight *himself* — rather than blocking.
- If self-heal itself throws, Cid proposes only an **`advise`** block (`paradigm_propose_block({ claimant: 'navigation', severity: 'advise' })`) — **never `guard`.**

A learning-loop gap must not deadlock a human. Hard refuse stays reserved for *correctness* gates (a missing `.purpose`), never learning-loop liveness.

## The Cid ↔ Loid Boundary, in Tense

The cleanest way to remember who writes what is **tense**:

- **Cid writes the present tense** — `status` (live, up to but not including the work-completer's `done`), `claimant`, the DAG edges at emission, run-record `runStatus`. Cid is *what is happening now.*
- **Loid writes the past tense** — `settledAt` and the learning stores. Loid is *what we learned from what already happened.*

They never co-write a field, and the dependency points one way: `status → settlement → learning`. The old fake "→ Loid" prose handoff at session-close becomes a real, enforced boundary that Cid owns the front of and Loid owns the back of.
