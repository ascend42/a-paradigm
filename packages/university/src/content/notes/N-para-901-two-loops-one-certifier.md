---
id: N-para-901-two-loops-one-certifier
title: 'Lesson 2: The Two Loops → One Certifier'
type: note
author: paradigm
created: '2026-06-25'
updated: '2026-06-25'
tags:
  - course
  - para-901
  - classroom
  - two-loops
  - certification
symbols: []
difficulty: intermediate
estimatedMinutes: 8
prerequisites: []
category: paradigm-core
---

## Two Ways a Learning Can Reach a Notebook

Historically, two write-paths fed agent notebooks, and they disagreed about what "certified" means. One was automatic and silent; one is deliberate and adversarial. The Academy's job was not to delete the old path overnight — it was to collapse the two down to a *single legitimate certifier* without quietly losing the history of which learnings arrived by which road.

## The Legacy Loop: Auto-Promote

The older path is `autoPromoteJournalEntries`. When a journal entry's `confidence_after` crosses a hardcoded floor (`>= 0.8`), it is promoted to the notebook and stamped `certifiedBy: 'gate'` — with no one ever having tried to break it. A *number* did the certifying. This is the journal-flood trap: an agent confident in its own output can manufacture "certified" knowledge at scale, and nothing in the loop pushed back.

This path still runs today. Learnings minted this way now carry the **LEGACY** badge, so you can always see that a number — not a ruling — let them in.

## The Gated Loop: /class

The real certifier is the gated `/class` term, implemented by `gatedPromoteJournalEntry` and the `paradigm_classroom_promote` tool. It stamps `certifiedBy: 'peer'` (a single human sign-off) or `'quorum'` (two or more assessors who each brought a breaking scenario). The decisive difference is what it does *not* have:

> On the gated path there is no confidence floor. The human ruling is the gate — a number never stands in for a verdict.

There is no `0.8` threshold here, because the human's judgment replaces it. A learning does not buy its way in with a high score; it earns its way in by surviving a stand (Lesson 4) and a sign-off.

## Reading the Badge

The two-loop distinction is made *visible* rather than argued about. The Academy derives a learning's provenance straight from `certifiedBy`:

- `certifiedBy: 'gate'` → **LEGACY** (auto-promoted, never interrogated — quarantine)
- `certifiedBy: 'peer'` or `'quorum'` → **GATED** (a ruling stood behind it)

Read provenance off the badge, not off the trust color alone. Two learnings can both be `provisional` orange while one was gated and one was a legacy auto-promote — the badge is how you tell an earned claim from firehose chatter.

## Visible-Quarantine: Today's Resolution

The shipped resolution (decision `TD-2026-06-25-044`) is **visible-quarantine**. Legacy auto-promoted learnings are *not* deleted and not hidden — they are *badged*, so a human can see at a glance that they were certified by a number rather than a ruling.

> The shipped fix is not deletion — it is daylight. A legacy cert keeps its place but wears a badge that says "a number certified me, not a ruling."

This matters because deletion would destroy real history, and silence would hide the problem. Daylight does neither: the firehose is still visible, just unmistakably labeled as un-gated.

## The Intended Next Step: Hard-Demote

Be precise about what is *not yet built*. The intended next step is to **hard-demote** the legacy path — to stop writing the `certifiedBy: 'gate'` cert at all, so auto-promote can stage a candidate but can no longer mint trust. That is *designed intent, not current behavior*: today the legacy path still writes its `'gate'` cert, and visible-quarantine (the badge) is what holds the line. The plan is to demote it once the gate has proven itself in practice. Today: badge it. Tomorrow: stop minting it.
