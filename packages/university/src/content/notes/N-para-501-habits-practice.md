---
id: N-para-501-habits-practice
title: Habits & Practice
type: note
author: paradigm
created: '2026-04-22'
updated: '2026-04-22'
tags:
  - course
  - para-501
  - six-categories-discovery
  - four-triggers-preflight
  - three-severity-levels
symbols: []
difficulty: beginner
estimatedMinutes: 6
prerequisites: []
category: paradigm-core
origin: imported
source: courses/para-501.json
---

## Instinct vs Habit

When you first learn to drive, you consciously think about every action — check mirrors, signal, check blind spot, change lanes. After thousands of miles, these become habits: automatic behaviors you execute without conscious effort. The Habits system brings this concept to AI-assisted development.

Without habits, an agent must be told every time: "check ripple before modifying," "validate flows after changing gates," "record lore for significant sessions." With habits, these checks become automatic behavioral triggers — the system evaluates them at defined points and reports compliance. Over time, agents internalize the patterns, and the habit checks become confirmation rather than correction.

## Habit Definitions

Each habit is a structured rule with six fields:

```yaml
id: ripple-before-modify
name: Check Ripple Before Modifying
description: Always call paradigm_ripple before modifying any symbol
category: discovery
trigger: preflight
severity: advisory
check:
  type: tool-called
  params:
    tools: [paradigm_ripple]
enabled: true
```

**Categories** classify what kind of discipline the habit enforces. There are six:
- `discovery` — Exploring before acting (ripple, navigate, search)
- `verification` — Validating after implementing (postflight, reindex)
- `testing` — Ensuring test coverage for new code
- `documentation` — Keeping .purpose files and lore entries current
- `collaboration` — Checking team wisdom and expert knowledge
- `security` — Validating gates and portal.yaml compliance

**Triggers** define when the habit is evaluated. There are four:
- `preflight` — Before starting implementation
- `postflight` — After completing implementation
- `on-commit` — Before committing changes
- `on-stop` — Before the session ends (stop hook)

**Severity** determines what happens when a habit is violated:
- `advisory` — Log a note, don't block anything
- `warn` — Show a warning to the agent/user
- `block` — Prevent session completion until resolved (enforced by stop hook)

## Check Types

Habits verify compliance through twelve check types:

| Check Type | What It Verifies |
|---|---|
| `tool-called` | Specified MCP tools were invoked during the session |
| `file-exists` | Files matching glob patterns exist (e.g., test files) |
| `file-modified` | Files matching patterns were modified during session |
| `lore-recorded` | A lore entry was created (for 3+ file sessions) |
| `symbols-registered` | New code is registered in .purpose files |
| `gates-declared` | Routes have corresponding gates in portal.yaml |
| `tests-exist` | Test files exist for modified components |
| `git-clean` | Git working tree is clean — all changes committed |
| `commit-message-format` | Commit messages match regex patterns (default: conventional commit prefix + Symbols: trailer) |
| `flow-coverage` | Changes spanning 3+ components have a documented $flow |
| `context-checked` | Session context/recovery tools (paradigm_session_health, paradigm_session_recover) were called |
| `aspect-anchored` | Touched aspects (~) have valid code anchors verified via paradigm_aspect_check |

## The 14 Seed Habits

Paradigm ships with 14 built-in habits that establish baseline discipline:

1. **explore-before-implement** (preflight/advisory/discovery) — Called paradigm_ripple, paradigm_navigate, paradigm_search, or paradigm_related before coding
2. **ripple-before-modify** (preflight/advisory/discovery) — Called paradigm_ripple specifically before modifying symbols
3. **check-fragility** (preflight/advisory/discovery) — Called paradigm_history_fragility before touching symbols
4. **wisdom-before-implement** (preflight/advisory/collaboration) — Checked paradigm_wisdom_context or paradigm_wisdom_expert
5. **verify-before-done** (on-stop/warn/verification) — Called paradigm_pm_postflight before finishing
6. **postflight-compliance** (on-stop/advisory/verification) — Ran postflight and reindex
7. **test-new-components** (postflight/advisory/testing) — Test files exist for new components
8. **purpose-coverage** (postflight/warn/documentation) — .purpose files cover modified directories
9. **record-lore-for-significant** (on-stop/warn/documentation) — Lore recorded for 3+ file sessions
10. **gates-for-routes** (postflight/warn/security) — Routes have portal.yaml gate coverage
11. **commit-message-symbols** (on-commit/advisory/documentation) — Commit messages follow type(#symbol): format with Symbols: trailer
12. **flow-coverage-for-multi-component** (postflight/advisory/documentation) — Changes spanning 3+ components have a documented $flow
13. **context-session-awareness** (preflight/advisory/discovery) — Session recovery or context check tools were called for continuity
14. **aspect-anchors-valid** (postflight/advisory/verification) — Aspects touched during the session have valid code anchors

## Habit Loading and Overrides

Habits load from three sources, merged in order (later wins):

1. **Seed habits** — The 10 built-in habits (always present)
2. **Global habits** — `~/.paradigm/habits.yaml` (optional, applies to all projects)
3. **Project habits** — `.paradigm/habits.yaml` (optional, project-specific)

Overrides let you adjust severity or disable habits without redefining them:

```yaml
# .paradigm/habits.yaml
overrides:
  ripple-before-modify:
    severity: block    # Upgrade from advisory to blocking
  test-new-components:
    enabled: false     # Disable for this project
custom:
  - id: check-migrations
    name: Verify DB Migrations
    category: verification
    trigger: on-commit
    severity: warn
    check:
      type: file-exists
      params:
        patterns: ["migrations/*.sql"]
```

## Practice Profiles

Every habit evaluation is recorded as a practice event with a result: `followed`, `skipped`, or `partial`. These events accumulate into practice profiles that show compliance rates over time.

`paradigm_habits_status` returns a practice profile with: overall compliance rate, strongest and weakest categories, per-category breakdowns, trend analysis (improving/declining/stable), and incident correlations — habits whose skipped evaluations correlate with higher incident rates.

The incident correlation is powerful: if skipping `ripple-before-modify` correlates with a 3x higher incident rate for the modified symbols, that is concrete evidence for upgrading the habit's severity.

## MCP Tools

**`paradigm_habits_check`** — Evaluate habits for a trigger point. Pass the trigger (`preflight`, `postflight`, `on-stop`), optionally with `filesModified` and `symbolsTouched` for context. Returns evaluations with follow/skip/partial results and whether any blocking violations exist.

**`paradigm_habits_status`** — Get the practice profile for an engineer over a time period (7d, 30d, 90d, or all). Shows compliance rates, category breakdowns, trends, and incident correlations.

**`paradigm_practice_context`** — Before modifying symbols, get habit-aware warnings. Pass the symbols you are about to touch, and it returns relevant habits, recent compliance rates, and suggestions based on your weak areas.

## CLI Commands

The CLI provides full habit management:

- `paradigm habits list` — List all habits with trigger, severity, and enabled status
- `paradigm habits add` — Add a custom habit with check type, patterns, and tools
- `paradigm habits edit <id>` — Edit habit fields (for seed habits: severity and enabled only)
- `paradigm habits remove <id>` — Remove a custom habit
- `paradigm habits enable/disable <id>` — Toggle a habit on or off
- `paradigm habits check --trigger <trigger>` — Evaluate compliance for a specific trigger
- `paradigm habits status` — Practice profile with compliance rates and trends
- `paradigm habits init` — Initialize a habits.yaml file for the project

## Platform Targeting

Habits support a `platforms` field to restrict evaluation to specific platforms. For example, a habit with `platforms: ['claude', 'cursor']` will only be evaluated when running in those environments. A habit with `platforms: ['cli']` will only fire during CLI-driven workflows. When `platforms` is omitted, the habit applies everywhere.
