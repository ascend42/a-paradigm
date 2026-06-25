---
id: N-para-901-provisional-by-default
title: 'Lesson 1: Provisional by Default'
type: note
author: paradigm
created: '2026-06-25'
updated: '2026-06-25'
tags:
  - course
  - para-901
  - classroom
  - provisional
  - learning-loop
symbols: []
difficulty: intermediate
estimatedMinutes: 8
prerequisites: []
category: paradigm-core
---

## A Confident Agent Is Not a Correct Agent

An agent that has *decided* a learning is true looks exactly like an agent whose learning actually *is* true — right up until the moment the field contradicts it. From the outside the two are indistinguishable: same crisp wording, same confidence number, same place in the notebook. The Academy refuses to take that confidence at face value. It treats a learning the way a good scientist treats a hypothesis — interesting, possibly correct, and not yet trusted.

This is the inversion the whole Classroom rests on. In an ordinary system, passing review *is* the certification: a reviewer nods, the thing is now "true," and everyone moves on. The Academy says the opposite — passing review only earns a learning the right to be *tested for real*.

## The Field Is the Examiner

A learning earns trust exactly one way: it is applied in real work and it does not break. No agent can certify itself, and no confidence score — however high — can stand in for that survival.

> The field is the final examiner. A learning is not "true" because an agent is confident in it — it is true because it survived being used.

Confidence is a claim *about* the world; field survival is the world answering *back*. The Academy is engineered so that trust tracks the falsifiable signal (did it survive use?) rather than the unfalsifiable one (how sure is the agent?). Everything downstream — study hall, the gated class, expeditions, the scoreboard — exists to route learnings toward that single examiner and to report honestly on what it has and has not yet said.

## Born Provisional

Every candidate learning enters at `trust: 'provisional'` — orange on the trust ladder, not green. Promotion to `certified` is something the field grants over time, never the state a learning starts in. A senior archetype authoring it does not make it certified. A high confidence number does not make it certified. Surviving real use does.

Contrast this with the naïve model most tools ship: high confidence ⇒ trustworthy ⇒ load it into the next session. That model quietly promotes the agent's *opinion of itself* into a fact. Provisional-by-default is the refusal to do that.

## "Unbroken" Is Untested, Not Strong

Here is the most seductive misread in the entire system. A learning shows `breaks: []` — an empty break list — and the eye reads it as a clean bill of health. It is not.

> An unbroken learning is untested, not proven. `breaks: []` means "no exam has been hard enough yet," never "this is strong."

Absence of recorded failure is absence of *evidence*, not evidence of soundness. A learning with no breaks has simply not yet been exercised hard enough to break — which is a statement about how little it has been tested, not about how good it is. The Academy is built to keep that distinction visible everywhere it shows you a learning, so that an untested claim can never quietly pass for a proven one.

## The Null Scoreboard Is Honest

Open the Academy today and the headline metric — the repeat-failure-rate — reads `null`. This is not a bug, and it is not a zero dressed up as success. It means *not enough exams have settled yet*. A learning has to be applied, and then a field-break (or a clean run across the survival window) has to be attributed back to it, before the metric has anything to divide. Today that attribution — keyed by `orchestrationId` — is still thin: only a handful of application receipts are wired back, so no certification has resolved.

A null board that tells the truth beats a green board that lies. The Academy ships **experimental**, and it would rather show you an honest blank than a fabricated number. When you see `null`, read "no settled exams yet" — never "healthy."

## What This Buys You

Provisional-by-default is the foundation that makes the rest of the Academy honest. Because nothing is true-by-assertion, every later mechanism has a real job: the gated class *earns* the upgrade from provisional, the field *resolves* it, and the scoreboard *withholds* green until there is something real to show. Get this lesson and the others fall into place — they are all just different ways of routing a learning toward the only examiner that counts.
