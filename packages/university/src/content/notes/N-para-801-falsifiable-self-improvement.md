---
id: N-para-801-falsifiable-self-improvement
title: 'Lesson 4: Falsifiable Self-Improvement'
type: note
author: paradigm
created: '2026-06-13'
updated: '2026-06-13'
tags:
  - course
  - para-801
  - close-the-loop
  - falsifiability
  - chain-live
symbols: []
difficulty: intermediate
estimatedMinutes: 7
prerequisites: []
category: paradigm-core
---

## "Self-Improving" Is a Claim — Can You Break It?

A system that *asserts* it is self-improving and a system that *is* self-improving can look identical from the outside, right up until you need the improvement and it isn't there. The deepest finding of the v7 audit was that Paradigm's "self-improving" claim was **unfalsifiable**: there was no test you could run that would fail if the learning loop were dead.

A claim you cannot break is not a feature — it is marketing. v7's job in this lesson is to make "self-improving" *testable*: there must exist a deliberate action that turns the check red.

## The Metric That Did Not Work: JPS

The first attempt was **JPS** — journals-per-settlement: count journal entries written, divided by parent subtrees settled, over a trailing window. The intuition was that a healthy loop writes journals and a dead loop writes zero.

The adversarial review killed it as **circular**. A clean run that legitimately produced no new insight ("silence is signal") and a *severed chain* both produce `JPS = 0`. The metric could not distinguish healthy quiet from a corpse. Measuring the **volume of output** can't tell you whether the **pipe** is alive.

## The Probe That Works: `chainLive`

The fix is to instrument the *pipe*, not the *output*. Each settlement now appends one record to `.paradigm/events/settlement-liveness.jsonl`:

```jsonc
{
  "parentTaskId": "T-…",
  "stages": { "recordWorkLog": "ok", "postflight": "ok", "promote": "skipped" },
  "chainLive": true,         // every non-skipped stage returned ok
  "journalsWritten": 0,      // diagnostic only — NOT the alarm
  "promoted": 0
}
```

Each stage of the chain is wrapped in its own try/catch, and the record is written in a `finally` block — so even a mid-chain throw still records *which* stage died. `chainLive` is true only if every non-skipped stage returned ok. The two cases are now distinguishable:

- **Clean subtree:** `chainLive: true, journalsWritten: 0` — the pipe ran end-to-end and simply had nothing to promote. Healthy.
- **Severed chain:** `chainLive: false` — a stage threw. Broken.

## The `paradigm doctor` Check

A new learning-loop-liveness check in `paradigm doctor` (and `/paradigm:health`) reads these records and alarms on `chainLive: false`. The alarm is *falsifiable by construction*: comment out `runPostflightLearning`, run a single settlement, and the check flips red, naming the dead stage. A reviewer can sever the chain on purpose and watch it scream.

This is the v7 thesis in miniature. The old claim — "the framework improves itself" — was an assertion with no failing test behind it. The new claim is the same sentence, but now wired to a probe that *anyone* can break in thirty seconds and see fail. That is the difference between an asserted check and a true one.

## Why This Pattern Generalizes

The `chainLive` probe is a template for honest self-checking anywhere in Paradigm:

1. **Instrument the pipe, not the output.** Liveness of the mechanism is falsifiable; volume of results is not.
2. **Record per-stage in a `finally`.** A mid-pipe failure must still tell you *where* it died.
3. **Make the red state reachable by a deliberate act.** If you cannot describe the exact change that turns the check red, the check is not really checking anything.

A self-improving framework earns the adjective only if you can prove it *isn't* improving when it breaks. v7 makes that proof a one-line edit away.
