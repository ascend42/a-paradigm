---
id: N-para-901-the-honest-scoreboard
title: 'Lesson 6: The Honest Scoreboard — Reading the Academy'
type: note
author: paradigm
created: '2026-06-25'
updated: '2026-06-25'
tags:
  - course
  - para-901
  - classroom
  - scoreboard
  - academy-gui
symbols: []
difficulty: intermediate
estimatedMinutes: 8
prerequisites: []
category: paradigm-core
---

## A Scoreboard That Can Lie Is Worse Than None

A learning dashboard is only worth anything if its green means something. The Academy is built to *withhold* green rather than fake it — so reading it correctly means knowing which numbers are real signals and which are traps.

## repeat-failure-rate: The Real Metric

The headline metric is the **repeat-failure-rate**: `overturned / (survived + overturned)`. The denominator is *resolved* certs — survived plus overturned. A cert that is still pending counts toward neither side, so until at least one cert resolves, the rate is **null**: "no settled exams yet," never a default green. This is Lesson 1's null scoreboard made precise. (The same formula backs `paradigm doctor`.)

## peer-pass-rate Is a SUSPECT Metric

It is tempting to measure "how often learnings pass the gate" and call a high number success. Resist it.

> Passing the gate is not surviving the field. peer-pass-rate is a suspect metric — never read it as success.

A high peer-pass-rate can mean the learnings are good — or it can mean the gate is too soft. The two are indistinguishable from the pass-rate alone. The real success signal is field survival (the repeat-failure-rate), measured *outside* the loop, not agreement *inside* it. Treat a glowing peer-pass-rate as a yellow flag, not a trophy.

## The Four Tabs

The Academy section renders four tabs:

- **Term Board** — the lifecycle, left to right: **Staged** (study-hall journal candidates) → **On Trial** (pending certs awaiting the field's veto) → **Settled** (resolved certs: survived in green, overturned in red).
- **Roster** — per-enrolled-agent curriculum traffic-lights: `current` = green, `stale` = amber, `broken` = red, none = grey, each with the agent's certified and on-trial counts.
- **Rap Sheet** — the lineage of each learning: `born` (the cert) → `applied` (notebook-reference receipts joined by `entryId`) → `broke` (field-failures joined by `entryId`). An empty `breaks: []` is rendered as **"untested, not proven"** — the Lesson 1 principle surfaced in the GUI, never a clean bill of health.
- **Agent Locker** — each agent's notebook split into **Vetted** (`trust: 'certified'`) and **Backlog** (everything else: `provisional`, `external`, and legacy-untiered entries, which fall through to provisional and sit in the backlog).

## The Trust Ladder

The color legend you will read everywhere: **certified** = green ▸ **provisional** = orange ▸ **external** = cyan, dashed (the foraged, context-excluded floor). That is the full rendered ladder. A "human-taught" tier exists as a *designed* third tier in the spec, but the GUI does not render it — unknown tiers fall through to provisional, the documented live default. Do not read a green "human-taught" badge into the interface; it is not there.

## The Bootstrap Doorway

When a project is not yet bootstrapped — the curriculum directory has no `*.syllabus` files — the Academy shows the **Bootstrap Doorway** instead of the board, and **nothing is green**. A blank-but-honest board is the expected first state, not a defect. It is the same honesty principle as the null scoreboard: an un-bootstrapped Academy refuses to show a green it has not earned.

## Running It: /class, /study-hall, /forage

Three skills drive the loop, and you read the result against the four tabs:

- `/study-hall` — stage candidates (safe, unattended); they appear in the **Staged** column.
- `/class` — convene the gated term, the only certifier; rulings move learnings to **On Trial** and (eventually) **Settled**.
- `/forage` — run an expedition to bring back external candidates; they enter at `trust: 'external'` (cyan, dashed) and take the longest path.

Expect `null` and orange early — that is the system being honest about a young, experimental loop, not a sign that anything is broken. A green you have to wait for is the entire point.
