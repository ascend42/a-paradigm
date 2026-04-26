---
id: N-para-451-agent-routing
title: Agent Routing — A Decision Tree for "Which Agent Should I Invoke?"
type: note
author: paradigm
created: '2026-04-26'
updated: '2026-04-26'
tags:
  - course
  - para-451
  - routing
  - decision-tree
  - reference
  - when-to-invoke
symbols: []
difficulty: beginner
estimatedMinutes: 6
prerequisites:
  - N-para-451-roster-reference
  - N-para-451-roster-management
category: paradigm-core
origin: authored
source: agents-course-phase-a-design.md
---

## How to use this entry

This is a **reference card**, not a narrative. Bookmark it. The earlier entries in PARA 451 taught you the team — what an agent is, the three identity layers, the model tiers, the canonical roster, partners, orchestration modes, and roster management. This entry compresses all of that into a single quick-reference: *given a situation in front of me, which agent should I invoke first?*

You will not need this on day one — most invocation is automatic via `paradigm_orchestrate_inline`, agent.yaml keyword routing, and partner declarations. You will reach for it on day thirty, when something does not auto-route the way you expected and you want to know who you should explicitly call.

## The decision tree

Read top-to-bottom. Stop at the first branch that matches.

### Are you starting a new session?

- **Yes** → Invoke **Cid** (`cid`) first. Cid runs the pre-task brief, maps blast radius, and surfaces relevant lore. The first turn of every session belongs to Cid.

### Are you about to design something that spans 3+ files or introduces a new pattern?

- **Yes** → Invoke **Architect** (`architect`). System design, specs, multi-file planning. No code. Architect produces the spec; Builder follows it.
- **Adding a protected route, auth surface, or anything OWASP-touching at the same time?** → Invoke **Aegis** (`security`) in parallel. Aegis flags; it does not fix. Both can run before Builder.

### Do you have a spec and need code written?

- **Yes** → Invoke **Builder** (`builder`). Builder follows the spec exactly and pushes back if it is unclear. If no spec exists, route through Architect first.
- **Is the work also explicit visual / UI / design-system work?** → Invoke **Mika** (`designer`) instead of (or in parallel with) Builder for the visual surface. Builder still owns wiring; Mika owns the surface.
- **Is the work an API surface, SDK, or integration guide?** → Pair **Builder** with **Helix** (`dx`). Helix shapes the developer-facing surface; Builder ships the implementation.

### Has Builder just finished and you need to verify?

- **Code review pass first** → Invoke **Reviewer** (`reviewer`). Two stages: spec compliance, then code quality. Reviewer hands back; never fixes.
- **Then, did the change touch a user-visible surface (README, --help, error messages, docs, install flow)?** → Invoke **Nora** (`ftux`). Nora simulates a first-time user and reads ONLY user-facing surfaces. Confusion **is** data. Skip Nora when the change is purely internal.
- **Then, always, as the final orchestration stage** → Invoke **Scribe** (`documentor`). Scribe updates `.purpose` files, `portal.yaml`, and lore. Never source. Documentor is **always last**.

### Is something broken or behaving strangely?

- **You need to understand why** → Invoke **Trace** (`debugger`). Hypothesis-driven, binary-search root-cause hunter.
- **You need to design tests that would have caught this** → Invoke **Shield** (`qa`) for test *strategy*, then **Probe** (`tester`) to write the tests. Shield designs the pyramid; Probe ships individual tests.

### Is the question "what could break?" or "is this risky?"

- **Yes** → Invoke **Jinx** (`advocate`). Devil's advocate. Stress-tests assumptions; finds edge cases you have not considered. Best invoked *before* irreversible decisions, not after.

### Is the work pedagogical or research-shaped?

- **Authoring or revising University content (notes, paths, quizzes, PLSAT modules)?** → Invoke **Sheila** (`educator`) and **Scholar** (`scholar`) as a pair. Reciprocal partnership: Scholar produces source material; Sheila shapes it into learning experiences. This is the canonical use of the partners primitive — and the pattern that authored this very course.
- **Pure research / curation / citation discipline (no pedagogical shaping yet)?** → Invoke **Scholar** alone.
- **Pure pedagogical sequencing (you already have the source material)?** → Invoke **Sheila** alone.
- **Business research, competitive analysis, market sizing?** → Invoke **Scout** (`researcher`) instead. Different archetype: Scout does *market* research, Scholar does *technical* research.

### Are you adding, redesigning, or training an agent?

- **Yes** → Invoke **Loid** (`forge`). Intelligence officer. Designs agents, processes session debriefs, runs the journal → notebook → wisdom learning loop. Always include Loid when designing agents, team changes, or training systems — she owns the learning loop.

### Is the work performance-shaped?

- **Yes** → Invoke **Bolt** (`performance`). Core Web Vitals, bundles, query optimisation. "Why is this slow?" is Bolt's question.

### Cutting a release?

- **Yes** → Invoke **Ship** (`release`). Versioning, changelog, deployment coordination.

### Working in a Swift / Apple-platform codebase?

- **Yes** → **Swift** (`swift`) is auto-rostered by `paradigm shift` on Swift detection. For any Swift code, Conductor work, or SwiftUI patterns, route through Swift. Notebooks compound globally — every Swift project on your machine sharpens the same agent.

### Does symbol coverage matter on this change?

- **Yes** → Invoke **Rune** (`compliance`). Pre-implementation plan; post-implementation report. Never source. Rune's role sharpens at v6.1 (authority modes, soft-blocks); for now, treat it as a planner / reporter.

### Closing the session?

- **Yes** → Invoke **Cid** (`cid`) again for the post-task debrief, then **Loid** (`forge`) to process the debrief and promote learnings. Cid frames the session; Loid stores what should compound.

## The compressed mental model

If the decision tree is too much, hold three rules in your head:

1. **Cid bookends every session.** Pre-task brief at the start, post-task debrief at the end.
2. **Architect → Builder → Reviewer → (Nora if user-facing) → Scribe** is the canonical implementation pipeline. Every other agent slots in *around* this spine.
3. **Specialists slot in by signal, not by schedule.** Aegis on auth; Mika on UI; Trace on bugs; Jinx on risk; Scholar+Sheila on learning content; Loid on agent work; Swift on Swift; Bolt on perf; Ship on releases. Match the signal to the agent and most routing decisions answer themselves.

## When the framework routes for you

Most of the time you will not be reading this entry — you will be writing prompts, and `paradigm_orchestrate_inline` will pick the right agent automatically. Three layers of routing run before you have to think about it:

- **`paradigm_orchestrate_inline`** picks agents based on task keywords, file paths, and orchestration mode.
- **Keyword triggers in `agents.yaml`** route common phrases ("review", "audit", "implement", "design") to the right agent.
- **Partner declarations** mean invoking one half of a pair (Scholar) often triggers the other (Sheila) for joint work.

You read this entry when automatic routing missed, or when you want to bypass it for a deliberate reason — a second opinion, a forced specialty pass, a debugging dive that needs a specific archetype.

## Up next

The next entry — **N-para-451-the-team-pattern** — closes the conceptual arc of PARA 451 by zooming all the way back out: *why* does Paradigm have many agents instead of one mega-agent? What does the team pattern actually buy you? After that, the **Q-para-451-when-to-invoke** quiz tests the routing decisions you just learned.
