---
id: N-para-451-paradigm-shift
title: '`paradigm shift` — Auto-Rostering for a Fresh Project'
type: note
author: paradigm
created: '2026-04-26'
updated: '2026-04-26'
tags:
  - course
  - para-451
  - auto-roster
  - ecosystem
  - paradigm-shift
  - cli
symbols: []
difficulty: beginner
estimatedMinutes: 4
prerequisites:
  - N-para-451-roster-management
category: paradigm-core
origin: authored
source: agents-course-phase-a-design.md
---

## What `paradigm shift` does

`paradigm shift` is the framework's **auto-rosterer** — the one command that gets a fresh (or freshly-cloned) project from "no roster" to "a sensible default roster" without you picking agents by hand. The previous entry covered roster management once a roster exists; this one covers how the roster comes into being in the first place.

Three things happen when you run it:

1. **Project-type detection.** The command scans the working tree for signals of what kind of project this is — language extensions (`*.swift`, `*.ts`, `*.py`), framework markers (`Package.swift`, `package.json`, `pyproject.toml`), platform indicators (Xcode project files, Android manifests), and so on. The result is a coarse classification: "this is a Swift macOS project", "this is a TypeScript monorepo", "this is a Python ML project", and so on.

2. **Roster suggestion.** Based on the detection, the command picks an initial roster — always the **always-on backbone** (Architect, Builder, Reviewer, Aegis, Probe, Scribe, Cid) plus matching **ecosystem agents**. A Swift project gets the `swift` agent activated automatically. A TypeScript-heavy project gets whichever TypeScript-shaped agents are available. The selection is conservative — it favours adding agents you are likely to need over leaving relevant ones benched.

3. **Adoption ceremony.** The suggested roster is presented for review (in the CLI; or interactively through the `/paradigm:agents` skill in Claude Code), and on confirmation it is written to `.paradigm/roster.yaml`. From that moment on, every orchestration call on this project sees the new roster.

```
$ paradigm shift
Detected: Swift macOS project (Package.swift, *.swift sources)
Proposed roster:
  Always-on backbone:
    - architect, builder, reviewer, security, tester, documentor, cid
  Learning loop:
    - forge (Loid), scholar, educator (Sheila)
  First-time-user guard:
    - ftux (Nora)
  Ecosystem (auto-detected):
    - swift  ← matched on *.swift, Package.swift
Apply? [Y/n]
```

## Auto-rostering on language and platform detection

The "ecosystem agent" piece is the interesting half. A handful of agents in the canonical roster are not part of the always-on backbone — they only make sense on projects where their ecosystem is present. **Swift** is the canonical example today: a `swift`-archetype agent that knows Apple-platform idioms, Swift concurrency, SwiftUI patterns, and Conductor (the macOS native app in this monorepo). On a Python web service, the Swift agent would be dead weight; on a Swift project, it is invaluable.

`paradigm shift` reads the project signals and activates matching ecosystem agents automatically — `*.swift` triggers `swift`, and the same pattern extends as more ecosystem agents land (TypeScript, Python, Rust, and others). You can always bench an auto-rostered ecosystem agent later if your project drifts off that ecosystem, and you can always activate one by hand if you know you need it before the detection fires.

The mechanics of *how* an ecosystem agent's notebook compounds across every project where its ecosystem is detected — the cross-project learning that makes specialty agents so valuable over time — are covered in **PARA 551: Agents in Practice**, the v6.1 follow-up course. For PARA 451, what matters is the high-level shape: *the framework picks ecosystem agents based on what it sees in your tree, and it does it without you having to ask.*

## When to run it

Three common moments:

- **First time on a fresh project.** No `.paradigm/roster.yaml` exists yet. `paradigm shift` is the bootstrap.
- **After cloning a project for the first time.** The repo may already have a roster, but if it does not (or if it looks wrong for your stack), shifting again is safe and idempotent.
- **After a significant change in the project's tech stack.** You added a Swift package to a previously TypeScript-only repo; you migrated from one framework to another. Re-running `shift` reconsiders ecosystem agent selection against the new tree.

You do **not** need to run it on every session. Once `roster.yaml` exists and reflects the project, day-to-day work uses `paradigm agent list`, `bench`, and `activate` (covered in the previous entry). `shift` is the heavyweight bootstrap; the others are the lightweight everyday.

## What `shift` does **not** do

- It does not modify global agent profiles (`~/.paradigm/agents/<id>.agent`). Agents must already be installed globally for `shift` to roster them; if a recommended agent is missing, the command surfaces it as "would activate, but not installed — use `/paradigm:agents` to install".
- It does not pick *which model* each rostered agent runs on. That is governed by tier defaults and `model-resolution` overrides in `.paradigm/config.yaml` (see **N-para-451-tiers**).
- It does not pick partners for you. The `partners:` declarations in each agent's profile are independent of rostering — `shift` rosters the instance, the profile carries the partner pre-declarations from when the agent was published.

> **Coming in v6.1:** `paradigm shift` will additionally auto-populate **archetype-default authority claims** for archetypes that have them — most notably the compliance archetype, which gains a default authority claim on `.purpose` files and `portal.yaml` symbol declarations. At v6.0.3 the command rosters the instance without authority-claim wiring; the claims become operational once the v6.1 enforcement model lands. Existing rosters created today will pick up the defaults automatically when the new logic ships. See `agent-owned-enforcement-plan.md`.

## A quick recipe

Cloning a Paradigm project for the first time:

```
$ git clone <repo>
$ cd <repo>
$ paradigm agent list            # see what (if anything) the repo ships with
# ... if the roster looks empty or wrong for your stack:
$ paradigm shift                 # auto-roster
$ paradigm agent list            # confirm the result
```

Three commands and you are oriented.

## Up next

You now know how to bootstrap, list, bench, and activate the team. The next set of entries shifts focus from *managing* the roster to *invoking* the team well — **N-para-451-orchestration-modes** covers how the team actually runs at runtime, **N-para-451-partners-primitive** covers how the framework expresses pair relationships, and **N-para-451-agent-routing** later will give you a quick-reference decision tree for "which agent should I invoke?"
