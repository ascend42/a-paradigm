---
id: N-para-901-expeditions-and-foraging
title: 'Lesson 5: Expeditions — Foraging the Wild'
type: note
author: paradigm
created: '2026-06-25'
updated: '2026-06-25'
tags:
  - course
  - para-901
  - classroom
  - expeditions
  - external-knowledge
symbols: []
difficulty: advanced
estimatedMinutes: 9
prerequisites: []
category: paradigm-core
---

## Raid the Web for Citations, Not Convictions

An Expedition is a sanctioned raid into the open web — Reddit, Medium, engineering blogs, official docs — for *citations to be examined*, never *convictions to be adopted*. It is a wider mouth on the funnel the Academy already built, running the existing deep-research machinery. The wild is the weakest tier and the longest road.

> Forage for citations, not convictions. Nothing certifies itself, and the wild is the weakest tier on the longest path.

## Five Gates, Not Four

Because foraged knowledge originates *outside* the project, it gets *more* scrutiny, not less. A homegrown learning clears four gates on its way to certified; a foraged one clears five. External knowledge is never blocked — it is simply the most-scrutinized path in the system. That asymmetry is deliberate: a stranger's claim has to earn more than a colleague's.

## Provenance Is Permanent — Only Trust Moves

A foraged candidate is born `source: 'external'`, `trust: 'external'`, with its `sourceSet` (the URLs) recorded permanently. As it survives the field its *trust* can climb — `external → provisional → certified` — but its *provenance never changes*.

> Provenance is permanent; only trust moves. A learning born in the wild always remembers it was — even after the field certifies it.

## trust:'external' Is the Context Floor (the Firewall, structural)

`trust: 'external'` is the floor of the trust ladder and the floor of the context-firewall: external candidates are excluded from any live prompt. As Lesson 3 established, that exclusion is enforced *structurally* — external candidates live in journals and Field Notes, and only the gate writes notebooks, so they have no pipe into a live session. The firewall holds because of the pipeline's shape, not because of a verified runtime trust-filter on the read path.

## Prestige Caps CONFIDENCE, Not TRUST

The subtle rule, and the most common misconception: source prestige sets a **confidence ceiling**, never a trust tier. Tier-A (official / maintainer docs) caps confidence at ≤ 0.6; tier-B (a named practitioner) at ≤ 0.45; tier-C (an anonymous forum post) at ≤ 0.3, and tier-C needs cross-tier corroboration or it is dropped. These caps are enforced in the runner, not left to convention.

> Prestige is a ceiling on confidence, never a shortcut on trust. The most official doc in the world still enters as external.

Prestige tells you how confident a candidate may *start*; it never lets a source skip the trust ladder.

## No Scenario, No Assessment — at Intake

The gate's signature rule applies to forages at *intake*. A foraged candidate that cannot be paired with a breaking scenario authored against **our** repo is unstageable: it lands in **Field Notes**, not the journal. You cannot certify — or even stage — what you cannot test against your own project, and a reputable source does not substitute for a local test.

## Ceiling: First Promotion Is Provisional

A foraged candidate's first promotion can only reach **provisional**, never straight to certified. The ladder `external → provisional → certified` is climbed in order, gated by field survival. (Per `TD-2026-06-25-044`, an exceptionally strong dossier *can* be certified at the gate by explicit human ruling — but that is bounded by a source-strength floor, tier-A or multi-source, never a lone tier-C, and it stays field-watched.)

## Conflicts → Challengers

When a forage collides with an existing learning, it does not silently overwrite it. It enters as a **CHALLENGER**, capturing `parentId` and `lineageType`, and is adjudicated head-to-head. A conflict with a *settled* learning requires the human's explicit consent to even put the incumbent on trial. Per `TD-2026-06-25-044`, conflicts **keep both** — the incumbent is refined ("X except <new context>") rather than replaced — and scheduled breadth-scouts are allowed in v1, but capped by a per-term external-candidate budget.

## Worked Example: Arky's Three Externals

In the first real expedition on this project, **Arky** (architect) ran a genuine vertical dive on organizing TypeScript projects — real searches across Nx, moonrepo, feature-sliced.design, and the webpack barrel debate. Three cited candidates came back at `trust: 'external'`. At THE STAND, **all three refined** — none was adopted as a universal, and none was rejected:

- *feature-sliced beats layered* → "feature-slice product code; cross-cutting shared-kernel / infra stays **layered**" (`SC-feature-slice-vs-shared-kernel`).
- *barrels are an anti-pattern* — foraged as a **CHALLENGER** against Arky's own use of `packages/paradigm/src/index.ts` → "anti-pattern in app code importing a **library's** barrel — **EXCEPT** a framework package's own bundled barrel (our 9 `packages/*/src/index.ts`, tree-shaken at bundle time by tsup)" (`SC-barrels-antipattern-vs-our-tooling`).
- *project references should replace path aliases* → "true for tsc-emit monorepos — **EXCEPT** bundler-built workspaces and Vite UIs" (`SC-project-refs-vs-tsup-bundling`).

The lesson of the example is the gate's whole value: **localization**. Three confident web generalizations became three project-true rules, each verified against the real tree before being asserted. Refine-as-localization is how the open web's opinions become knowledge that actually holds *here*.
