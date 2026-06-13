---
id: N-para-801-honest-routing-and-the-method
title: 'Lesson 6: Honest Routing & the Dogfood Method'
type: note
author: paradigm
created: '2026-06-13'
updated: '2026-06-13'
tags:
  - course
  - para-801
  - close-the-loop
  - classification
  - adversarial-review
symbols: []
difficulty: intermediate
estimatedMinutes: 7
prerequisites: []
category: paradigm-core
---

## The Front Door: Honest Classification

The Spine closes the *back* of the loop (work → learning). The "Front Door" fixes the *front*: getting any user's request to the right team without an expert driving the orchestrator by hand.

The keyword classifier was rebuilt in v7 as **confidence-scored with intent-verb anchoring**. Three concrete fixes:

- **The "bugfix poison-pill" is gone.** An audit of a *broken* system used to route to `[security, builder]` — i.e. the word "broken" silently summoned a fixer. New `audit` / `design` / `research` families map to **read-only analyst rosters that never route to a fixer.** Asking for an analysis no longer triggers an implementation.
- **Misroutes are now visible.** Every mode response surfaces `{ type, confidence, alternativeType, overrideHint }`. A wrong classification is no longer silent — the user sees the second-best guess and how to override it.
- **One authoritative classifier.** A second, divergent inline classifier is collapsed; `classification.type` is the single source of truth.

## Full-Roster Routability

The second front-door fix: the trigger-based `agent-matcher` becomes the primary roster/suggestion source, so specialists that were previously **unroutable by auto-orchestration** — `product` (North), `forge` (Loid), `researcher` (Scout), `dx` (Helix) — can now actually be assembled automatically, not only by a human naming them. The best agents being un-summonable was itself an audit finding: a team you cannot reach is a team you do not have.

## The Method: Dogfooding the Cross-Check

The most teachable thing about v7 is not any single feature — it is **how v7 was built.** Every claim above was caught, corrected, or confirmed *before it shipped* by Paradigm cross-checking itself. This is a Paradigm practice you should copy.

### Step 1 — The self-audit (file-and-line evidence)

v7 began with a two-slice self-audit: the task system, then the orchestration engine that runs every other audit. The discipline was **file-and-line evidence, not vibes.** "The learning loop is broken" is a vibe; "`task_done` at `task-loader.ts` feeds nothing — here is the dead joint" is a finding. Every claim was anchored to code you could open.

### Step 2 — The adversarial review

A designed spec is a *hypothesis*, not a fact. Before the learning wiring was built, an adversarial pass (the reviewer's job: try to *break* the design against the real code) caught **three keystone claims that were false or circular**:

1. The belief-delta gate ran on **hardcoded** confidence numbers — promoting on the difference of two constants (Lesson 3 covers the honest fix).
2. "Both worlds flow through `completeTask`" was **false** — the CLI orchestrator emits no tasks (scope was honestly narrowed to the MCP path).
3. The JPS metric was **circular** — clean work and a dead chain both read zero (replaced by the `chainLive` probe, Lesson 4).

Each finding flipped a "ship it" into a "revise first." The cost of catching them in review was a paragraph; the cost of shipping them would have been a framework that *claims* to self-improve on synthetic numbers — exactly the disease v7 set out to cure.

### The lesson

> A claim, even your own, is a hypothesis until something has tried to break it.

This is why Paradigm pairs a builder with a *reviewer*, and a designer with an *adversarial* pass. The self-audit found the holes; the adversarial review kept the *fixes* honest. v7 is the framework eating its own dog food — and the practice generalizes: anchor claims to evidence, then assign someone to falsify them before you build. The check is only worth running if it can fail.
