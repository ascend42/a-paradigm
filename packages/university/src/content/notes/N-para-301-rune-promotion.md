---
id: N-para-301-rune-promotion
title: "Rune's Promotion Model"
type: note
author: paradigm
created: '2026-05-04'
updated: '2026-05-04'
tags:
  - course
  - para-301
  - rune-promotion
  - none-enforcement
  - readiness-signals
symbols: []
difficulty: beginner
estimatedMinutes: 3
prerequisites:
  - N-para-301-enforcement-levels
category: paradigm-core
origin: authored
---

## Enforcement You Earn, Not Enforcement You Endure

New Paradigm projects start at `none` enforcement — all 13 compliance checks off. This is deliberate. Teams using Paradigm for agent orchestration, Sentinel, or Conductor should not be interrupted by symbol-coverage warnings they never asked for.

But compliance tracking has real value once you are writing `.purpose` files and referencing symbols. The challenge is knowing when a team has crossed that threshold.

Rune — the compliance archetype agent — solves this with a promotion model. Instead of waiting for developers to read documentation and manually edit `config.yaml`, Rune watches for behavioral signals that indicate readiness and extends an invitation.

## Readiness Signals

Rune monitors the active session for signals that suggest the developer is already thinking in Paradigm terms:

- **Symbol syntax usage** — The developer references `#component`, `$flow`, `^gate`, `!signal`, or `~aspect` in prompts or commit messages
- **Auth and dependency questions** — The developer asks about protecting routes, declaring gates, or understanding component dependencies
- **Multi-file reach** — The session touches 3 or more source files, which is the threshold where `.purpose` coverage starts to matter

Any one of these signals suggests the developer is past the "I'm just exploring" stage. Two or more Tier B signals (or any Tier A signal) trigger Rune's invitation.

## The Invitation

When readiness signals accumulate, Rune surfaces a single, non-blocking message:

> Paradigm's symbol system (#components, $flows, ^gates, !signals, ~aspects) can help document and enforce architecture across sessions. Enforcement is currently **none** — all checks are off. Would you like to enable symbol tracking?
>
> Options: `minimal` (warn-only), `balanced` (blocks on missing purpose files), `snooze` (ask in 7 days), or `never` (don't ask again).

Rune does not repeat the invitation more than once per session.

## Why This Approach

Starting at `none` and inviting up avoids the "turned off warnings I found annoying" decay pattern. A developer who has never been interrupted by a compliance warning has no reason to resent Rune's invitation. The invitation arrives as helpful context — not friction.

Teams that never reference symbols, never ask about gates, and never touch 3+ files in a session will never see Rune's invitation. This is correct behavior — they do not need compliance tracking.

## After Accepting

When a developer accepts, Paradigm updates `enforcement.level` in `.paradigm/config.yaml` immediately. The developer can always return to `none` at any time.

## The Progression Path

```
none  →  minimal  →  balanced  →  strict
         (Rune      (team       (regulated
          invites)   ready)      domains)
```

There is no mandatory progression. Many teams run at `balanced` indefinitely. Strict is reserved for regulated domains where compliance is not optional.
