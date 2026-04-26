---
id: N-para-451-roster-reference
title: The Paradigm Roster — Canonical Reference
type: note
author: paradigm
created: '2026-04-26'
updated: '2026-04-26'
tags:
  - course
  - para-451
  - roster
  - reference
  - canonical
  - agents
symbols: []
difficulty: beginner
estimatedMinutes: 8
prerequisites:
  - N-para-451-identity-layers
  - N-para-451-tiers
category: paradigm-core
origin: authored
source: agents-course-phase-a-design.md
---

## How to read this page

> **One row per active agent.** Names in the **Nickname** column are the user-display layer; the **id** is the machine-stable handle used in CLI and MCP calls; the **archetype** is the role pattern the agent fills; the **tier** is the default model (see **N-para-451-tiers**). Same id may have a different nickname on your project — that is expected and supported.

This page is the **most-referenced entry in the course**. Bookmark it. You will come back to it every time you wonder "who picks this up?" or "which agent handles X?". The roster shown here is the canonical first-party roster as of v6.0.3 — twenty-one active agents grouped by role family. Your project's actual roster may differ; run `paradigm agent list` to see what is active locally.

## Always-on backbone (the seven you will meet first)

These agents ship in every project's roster by default. They are the backbone of orchestration — almost every task touches at least one of them.

| Nickname | id | Archetype | Tier | Specialty | When to invoke | Partners |
|----------|----|-----------|------|-----------|----------------|----------|
| Architect | `architect` | architect | 1 (opus) | System design, specs, multi-file planning. No code. | "design X", "plan a feature", anything spanning 3+ files | — |
| Builder | `builder` | builder | 3 (haiku) | Implementation. Follows specs exactly. Pushes back when unclear. | "implement", "build", "wire up" | — |
| Reviewer | `reviewer` | reviewer | 2 (sonnet) | Two-stage review (spec compliance, then code quality). Hands back; never fixes. | "review", "is this ready" | — |
| Aegis | `security` | security | 1 (opus) | Auth, gates, OWASP. Reads `portal.yaml`. Flags only. | new endpoint, auth change, "audit" | — |
| Probe | `tester` | tester | 3 (haiku) | Unit and integration tests. | "test", "verify", "edge cases" | qa (Shield) |
| Scribe | `documentor` | documentor | 2 (sonnet) | Final orchestration stage. Updates `.purpose` files, `portal.yaml`, lore. Never source. | always last; auto-runs | cid (Cid) |
| Cid | `cid` | captain | 1 (opus) | Session-level. Pre-task brief; post-task debrief. Maps blast radius. | first turn of a session, before anything else | forge (Loid) |

## First-time-user guard

| Nickname | id | Archetype | Tier | Specialty | When to invoke | Partners |
|----------|----|-----------|------|-----------|----------------|----------|
| Nora | `ftux` | ftux | 1 (opus) | Simulates a first-time user. Reads ONLY user-facing surfaces (README, --help, docs). Confusion **is** data. | after Builder, when the task touches a user-visible surface | — |

## Learning loop

These three agents power the framework's learning machinery — Loid runs the intelligence operation, Scholar produces source material, Sheila shapes it into learning experiences.

| Nickname | id | Archetype | Tier | Specialty | When to invoke | Partners |
|----------|----|-----------|------|-----------|----------------|----------|
| Loid | `forge` | intelligence-officer | 1 (opus) | Agent intelligence officer. Designs agents, processes Cid's debrief, promotes journal → notebook → wisdom. | end of session; when adding or redesigning agents | cid (Cid) |
| Scholar | `scholar` | scholar | 1 (opus) | Research, curation, citation discipline. Source-material producer. | "research", "curate", university content | educator (Sheila) — reciprocal |
| Sheila | `educator` | educator | 1 (opus) | Pedagogical sequencing — quizzes, paths, PLSAT modules. Source-material shaper. | university content, course design, learning materials | scholar (Scholar) — reciprocal |

## Specialty and ecosystem

| Nickname | id | Archetype | Tier | Specialty | When to invoke | Partners |
|----------|----|-----------|------|-----------|----------------|----------|
| Rune | `compliance` | compliance | 2 (sonnet) | Symbol planner and coverage owner. Pre-impl plan; post-impl report. Never source. | when symbol coverage matters | — |
| Jinx | `advocate` | advocate | 2 (sonnet) | Devil's advocate. Stress-tests assumptions; finds edge cases. | "what could break", before high-risk decisions | — |
| Trace | `debugger` | debugger | 2 (sonnet) | Root-cause hunter. Hypothesis-driven, binary-search. | "this is broken", "why does X happen" | — |
| Shield | `qa` | qa | 2 (sonnet) | Test **strategy** (not execution). Pyramid shape, coverage targets. | when designing the test plan, not writing tests | tester (Probe) |
| Helix | `dx` | dx | 2 (sonnet) | DX/SDK engineer. APIs, integration guides, webhook flows. | API surface design, SDK, integration docs | — |
| Mika | `designer` | designer | 2 (sonnet) | Design engineer. UI/UX, design systems, motion, accessibility. | UI work, design system changes | — |
| Bolt | `performance` | performance | 2 (sonnet) | Core Web Vitals, bundles, query optimisation. | perf concerns, "why is this slow" | — |
| Ship | `release` | release | 2 (sonnet) | Release manager. Versioning, changelogs, deployment coordination. | cutting a release, changelog work | — |
| Scout | `researcher` | researcher | 2 (sonnet) | Business research, competitive analysis, growth mechanics. | market or strategy questions | — |
| Swift | `swift` | swift | 2 (sonnet) | Swift / SwiftUI / Apple-platform specialist. Auto-rosters on Swift detection. Notebooks compound globally. | any Swift code, Conductor work | — |

> **Coming in v6.1:** Rune's role sharpens substantially — three authority modes (Advise / Auto-author / Guard), a soft-block primitive, archetype-default authority claims, and the tier-1/tier-2 notebook split all land together. PARA 551: Agents in Practice covers the new surfaces. The roster row shown for Rune above is accurate at v6.0.3. See `agent-owned-enforcement-plan.md`.

## Reading the partner column

- A **reciprocal** pairing means both agents declare each other in their `partners:` block. The CLI shows a checkmark.
- A **pending** pairing (the CLI shows a yellow warning) is one-way — A declares B, but B does not declare A. Both are legal. One-way is intentional in mentor / lead patterns and accidental in typos.
- A blank in the **Partners** column means the agent has no current declared partners — this is fine; partners are an enrichment, not a requirement. Most agents on the roster work fine alone.

The partners primitive is covered end-to-end in **N-para-451-partners-primitive** later in the course.

## "When to invoke" is heuristic

The **When to invoke** column is a heuristic — most invocation is automatic. Three things drive routing in practice:

1. `paradigm_orchestrate_inline` — picks the right agent for the task based on keywords, file paths, and the orchestration mode.
2. Natural keyword triggers in `agents.yaml` — e.g. "review" routes to Reviewer, "audit" routes to Aegis.
3. Explicit invocation — when you call out an agent by id or nickname in a prompt, the orchestrator honours it.

You should rarely need to invoke an agent by hand. When you do, it is usually because you want to bypass automatic routing for a specific reason (a second opinion, a forced specialty pass, a debugging dive).

## Where these definitions live

- **Profiles (per-id):** `~/.paradigm/agents/<id>.agent`
- **This project's roster:** `.paradigm/roster.yaml`
- **Adoption metadata:** `.paradigm/adoptions.yaml`
- **Prompts and tier mapping (source of truth):** `packages/paradigm-mcp/src/tools/orchestration.ts`

## Snapshot disclaimer

This roster is a **snapshot** of the canonical first-party agent set. Your project's actual roster varies — `paradigm shift` selects an initial roster based on detected language and platform; you may bench, activate, or install agents at any time. Run `paradigm agent list` to see your local roster. The roster-management entry later in the course (**N-para-451-roster-management**) covers how to customise.
