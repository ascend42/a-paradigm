---
id: N-para-901-study-hall-vs-class
title: 'Lesson 3: Study Hall vs Class'
type: note
author: paradigm
created: '2026-06-25'
updated: '2026-06-25'
tags:
  - course
  - para-901
  - classroom
  - study-hall
  - context-firewall
symbols: []
difficulty: intermediate
estimatedMinutes: 8
prerequisites: []
category: paradigm-core
---

## Two Rooms, One Door to Trust

Study hall and class are different rooms with different jobs. Study hall is where agents *practice* — drilling their curriculum, trying things, writing down what they think they learned. Class is where they are *examined*. Only one of those rooms has a door that opens onto a notebook, and keeping them separate is what makes the whole system safe to run.

## Study Hall Stages — It Never Certifies

The `/study-hall` skill lets each active agent follow its approved curriculum, drill against the scenario bank, and **stage** candidate learnings — written as journal entries via `paradigm_journal_record`. That is the whole of its authority. It never writes a notebook, never promotes, never certifies. Because it cannot mint trust, it is safe to run unattended on a schedule: the worst a runaway study-hall can do is fill a journal with candidates that still have to face the gate.

## The Structural Guard (the Context-Firewall, enforced by structure)

This single rule — *staging writes only to journals* — is what makes the Academy's context-firewall a structural guarantee rather than a hopeful promise.

> The firewall is structural: staging writes only to journals, and only the gate writes notebooks. An untrusted candidate has no path to a live session — not because a filter rejects it, but because no pipe connects it.

A live session loads *notebooks*. Study hall and expeditions write *journals*. The only bridge from a journal to a notebook is the gated `/class` promotion. So a staged candidate — or a foraged external one — physically cannot reach a live prompt: there is no pipe that carries it there. The guarantee comes from the *shape of the pipeline*, not from a runtime "is this external?" check on the read path. (Teach it that way precisely: the firewall holds because staging never writes notebooks, not because a verified trust-filter screens the loader.)

## The Syllabus Is Gate-Zero

Before an agent studies anything, its syllabus is screened. An entry whose status is `stale`, `broken`, or `expired` is **skipped** — study hall will not drill on knowledge that is already known-bad. (Hand-authored syllabus entries are exempt from the staleness screen; a human approving the sources is itself the gate there.) This is gate-zero: the first filter, applied before a single learning is even attempted, so the journal does not fill with candidates derived from rotten source material.

## The Scenario Bank: Survive vs Poison-Pill

A learning that only ever agrees is not discriminating — it is credulous. The scenario bank tests both directions. Scenarios are typed `authored` or `poison-pill`, each carrying an `expected` verdict of `must: survive` or `must: reject`. A sound learning **survives** the authored scenarios (it holds where it should) *and* correctly **rejects** the poison-pills (it refuses where it should). Drilling against the bank — passing both directions — is how a staged candidate earns its place in the journal before it ever reaches the gate.

## /class Is the Only Certifier

Study hall can run all night and certify nothing. Trust is minted in exactly one place.

> Study hall can run all night and certify nothing. /class is the only room with a door to a notebook.

This is the structural guard restated as a rule of governance: autonomy is made *safe* by making it *powerless to certify*. The more study hall an agent does, the fuller its journal — and not one entry becomes trusted knowledge until a human convenes the gated term and rules on it.
