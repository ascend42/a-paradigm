# Agents Course — Phase A Design

**Drafted:** 2026-04-26 by Sheila (educator, lead) + Scholar (research-pair) + Loid (intelligence officer).
**Status:** design draft, pending Architect + user sign-off on §10 open calls.
**Companion:** [`agent-owned-enforcement-plan.md`](./agent-owned-enforcement-plan.md) — Phase B work this design intentionally avoids.
**Scope:** Phase A only — content stable across the v6.1 enforcement-model evolution.

---

## Premise correction up front

The task brief states "Paradigm University currently has 176 entries, ZERO on agents." That is **not quite right**. PARA 401 already contains six agent-adjacent entries:

| Existing entry | Status |
|----------------|--------|
| `N-para-401-agent-roles` | Stale — talks about Rune's "1:1 component-to-aspect ratio" enforcement, which the v6.1 enforcement-model pivot is walking back. |
| `N-para-401-agent-identity` | Pre-v6.0.3 framing; doesn't mention partners or the three-layer id/nickname/archetype model. |
| `N-para-401-agent-interop` | Pre-partners. |
| `N-para-401-multi-agent-coordination` | Mostly orchestration mechanics; partially reusable. |
| `N-para-401-orchestration-workflow` | Reusable. |
| `N-para-401-notebooks-permissions` | Pre-tier-split, will need an update at v6.1 but Phase-A-stable for the basics. |

So the real situation is: **the framework's most differentiated feature is taught in stale, pre-v6.0.3 entries inside an advanced (PARA 401) course**, where beginners never get to it. Phase A's job is to **introduce a dedicated, beginner-accessible agents course** and leave PARA 401 alone for now (its agent entries become retirement candidates at v6.1 once the new course covers the same ground in a forward-compatible way).

This drives the design decision below: Phase A is a **new course (PARA 451: Agents Foundations)** sitting alongside PARA 401 in the 400 band, with later relocation possible if the user wants a dedicated 050 or 150 track for early exposure.

---

## 1. Course structure

### Title and tagline

- **Title:** PARA 451: Agents Foundations
- **Tagline:** Meet the team. Learn what each agent does and when to call them.
- **Subtitle (long):** "The framework's most differentiated feature, taught from first principles."

### Difficulty

**Beginner**, with one intermediate sub-track entry (the partners primitive deep-dive). Targeted at a learner who has finished PARA 101 (Foundations) but does **not** require completion of 201/301/401. The agent system is conceptually approachable and learners benefit from understanding the team early — not after they've already fought the framework alone for three courses.

### Single course vs path?

**Single ordered path** (LP-para-451), not a multi-course track. Rationale:

- Phase A is ~18 entries — too small to justify multiple sub-courses.
- The roster + identity + partners + roster-management material reads as one coherent unit.
- A future Phase B (enforcement, authority modes, soft-blocks, tier-split notebooks) becomes **PARA 551: Agents in Practice**, structured as its own course that prerequisites 451. That's how we keep stable Phase A content separable from evolving Phase B content.

### Total entry count target

**18 entries**: 9 notes + 7 quizzes + 1 path + 1 roster reference (counted as a note). Within the 15-25 brief target.

### Estimated time-to-complete

- **Skim path:** 35 minutes (read notes, skip quizzes)
- **Full mastery path:** 75-90 minutes (notes + quizzes + revisit roster reference)

### Dependency graph

```
N-para-451-welcome              (entry point, no deps)
        │
        ├──> N-para-451-what-is-an-agent              (welcome)
        │           │
        │           ├──> N-para-451-identity-layers   (what-is-an-agent)
        │           │           │
        │           │           └──> Q-para-451-identity-layers
        │           │
        │           ├──> N-para-451-archetypes-vs-instances  (identity-layers)
        │           │           │
        │           │           └──> Q-para-451-archetypes-vs-instances
        │           │
        │           └──> N-para-451-tiers              (what-is-an-agent)
        │                       │
        │                       └──> Q-para-451-tiers
        │
        ├──> N-para-451-roster-reference              (tiers, identity-layers)
        │           │
        │           └──> Q-para-451-when-to-invoke
        │
        ├──> N-para-451-roster-management             (roster-reference)
        │           │
        │           └──> Q-para-451-roster-management
        │
        ├──> N-para-451-orchestration-modes           (what-is-an-agent)
        │           │
        │           └──> Q-para-451-orchestration-modes
        │
        ├──> N-para-451-partners-primitive            (roster-reference)  ← intermediate
        │           │
        │           └──> Q-para-451-partners
        │
        ├──> N-para-451-auto-rostering                (roster-management)
        │
        └──> N-para-451-mastery-review                (everything above)
```

---

## 2. Entry list

| # | id | type | summary | deps | tags |
|---|----|------|---------|------|------|
| 1 | `N-para-451-welcome` | note | Why agents matter — Paradigm's most differentiated feature. The team metaphor. What you'll learn in this course. Prereq: PARA 101. | — | course, para-451, agents, welcome |
| 2 | `N-para-451-what-is-an-agent` | note | An agent is a persistent identity, not a model invocation. Profile lives in `~/.paradigm/agents/<id>.agent`. Carries personality, expertise, notebook of learned patterns. Survives session boundaries; travels across projects. | 1 | agents, identity, profile |
| 3 | `N-para-451-identity-layers` | note | The three-layer identity model: **id** (machine-stable, e.g. `forge`), **nickname** (user-customizable display name, e.g. `Loid`), **archetype** (role pattern, e.g. compliance / educator / captain). Same archetype can host multiple instances under different nicknames. Why this matters for nevr.land registry. | 2 | identity, three-layer, archetype |
| 4 | `Q-para-451-identity-layers` | quiz | 3 questions covering id/nickname/archetype distinction and which layer is mutable. | 3 | quiz, identity |
| 5 | `N-para-451-archetypes-vs-instances` | note | Archetype = role pattern (compliance, educator, captain). Instance = a specific agent on your roster (Rune, Sheila, Cid). One archetype, many possible instances. The schema today exposes this conceptually; field-level surface lands later. | 3 | archetype, instance, taxonomy |
| 6 | `Q-para-451-archetypes-vs-instances` | quiz | 3 questions on whether two named agents can share an archetype, and whether benching one affects the other. | 5 | quiz, archetype |
| 7 | `N-para-451-tiers` | note | Tier-1 (core, always-on backbone) vs Tier-2 (ecosystem/specialty, activated on demand). Tier maps to default model (opus / sonnet / haiku) but is overridable. Current taxonomy only — does not cover the v6.1 notebook tier split. | 2 | tier-1, tier-2, taxonomy |
| 8 | `Q-para-451-tiers` | quiz | 3 questions on which tier the always-on agents live in, model implications, override mechanism. | 7 | quiz, tier |
| 9 | `N-para-451-roster-reference` | note | **The heart of the course.** Single consolidated reference for all 21 currently-active agents on the canonical roster. Table format. See §3 below for full design and content. | 7, 3 | roster, reference, canonical |
| 10 | `Q-para-451-when-to-invoke` | quiz | 5 questions: scenario → which agent picks it up. Covers routing across the full roster. | 9 | quiz, routing, when-to-invoke |
| 11 | `N-para-451-roster-management` | note | `paradigm shift` rosters core agents on first run. `paradigm agent roster` shows active vs benched. `paradigm agent bench <id>` / `activate <id>`. The `/paradigm:agents` skill as Claude Code wrapper. Profile vs roster — same identity, different scopes. | 9 | cli, roster, skill |
| 12 | `Q-para-451-roster-management` | quiz | 3 questions on bench/activate semantics, profile-vs-roster, when to use the skill vs CLI. | 11 | quiz, cli |
| 13 | `N-para-451-orchestration-modes` | note | Faceted (Claude Code, isolated Task contexts, true multi-agent) vs sequential roleplay (Cursor and IDEs without Task tool, single-context). Configured by `orchestration.default_mode` in agents.yaml. When each mode is the right tool. | 2 | orchestration, faceted, sequential |
| 14 | `Q-para-451-orchestration-modes` | quiz | 3 questions on which mode runs in Claude Code vs Cursor, what changes for context isolation, how to override the default. | 13 | quiz, orchestration |
| 15 | `N-para-451-partners-primitive` | note | **Intermediate sub-track.** The partners primitive shipped at v6.0.3. Scholar+Sheila as canonical example. Reciprocal vs pending. Pair notebook namespace `.paradigm/notebooks/_pairs/{a-b}/` reserved. `share_notebooks` field exists with values off / read / read-write — current shipped behavior, default will adjust at v6.1. See §4 below. | 9 | partners, v6.0.3, scholar-sheila, intermediate |
| 16 | `Q-para-451-partners` | quiz | 4 questions on what partners declares, reciprocal vs pending, share_notebooks values, what's reserved vs shipped. | 15 | quiz, partners |
| 17 | `N-para-451-auto-rostering` | note | `paradigm shift` detects language/platform (Swift, TypeScript, Python, etc.) and auto-rosters matching ecosystem agents. Swift is the canonical example today. Notebooks for ecosystem agents live globally and compound across every project where that ecosystem is detected. High-level only — runtime details of cross-project compounding live in PARA 551. | 11 | auto-roster, ecosystem, paradigm-shift |
| 18 | `N-para-451-mastery-review` | note | Course recap: identity model, tier taxonomy, the 21-agent roster, partners primitive, orchestration modes, roster management, auto-rostering. Pointer to PARA 551 for enforcement, authority modes, and notebook tiers (v6.1). | all prior | review, mastery, pointer |
| 19 | `LP-para-451` | path | The ordered learning path stitching all 18 entries above (notes + quizzes interleaved). | — | path, course, para-451 |

**Type discipline:** only `note | quiz | path` per `node_modules/@a-company/university/pack.yaml`. Hands-on exercises are encoded as "Try this" sections inside notes — the brief mentioned "runbook" but it isn't a registered type in the first-party pack and we don't invent one in Phase A.

---

## 3. The roster reference page — design

**Decision: ONE consolidated entry**, not 21 per-agent entries. 21 entries would (a) blow the budget, (b) repeat schema noise, (c) make discovery worse — learners want the team-at-a-glance more than they want individual agent encyclopedias. Where deeper treatment is warranted (Scholar + Sheila for partners), the partners entry serves that purpose.

### Format mockup for `N-para-451-roster-reference`

```markdown
# The Paradigm Roster

> **One row per active agent.** Names below are nicknames (the user-display
> layer); the archetype is the role pattern; the id is the machine-stable
> handle used in CLI/MCP calls. Same id may have a different nickname on
> your project — that's expected and supported.

## Always-on backbone (the seven you'll meet first)

| Nickname | id | Archetype | Tier | Specialty | When to invoke | Partners |
|----------|----|-----------|------|-----------|----------------|----------|
| Apex / "architect" | `architect` | architect | 1 (opus) | System design, specs, multi-file planning. No code. | "design X", "plan a feature", anything ≥3 files | — |
| Kit | `builder` | builder | 3 (haiku) | Implementation. Follows specs exactly. Pushes back when unclear. | "implement", "build", "wire up" | — |
| Judge | `reviewer` | reviewer | 2 (sonnet) | Two-stage review (spec compliance → code quality). Hands back; never fixes. | "review", "is this ready" | — |
| Aegis | `security` | security | 1 (opus) | Auth, gates, OWASP. Reads `portal.yaml`. Flags only. | new endpoint, auth change, "audit" | — |
| Probe | `tester` | tester | 3 (haiku) | Unit + integration tests. | "test", "verify", "edge cases" | qa (Shield) |
| Scribe | `documentor` | documentor | 2 (sonnet) | Final orchestration stage. Updates `.purpose` files, `portal.yaml`, lore. Never source. | always last; auto-runs | cid (Cid) |
| Cid | `cid` | captain | 1 (opus) | Session-level. Pre-task brief; post-task debrief. Maps blast radius. | first turn of a session, before anything else | forge (Loid) |

## First-time-user guard

| Nickname | id | Archetype | Tier | Specialty | When to invoke | Partners |
|----------|----|-----------|------|-----------|----------------|----------|
| Nora | `ftux` | ftux | 1 (opus) | Simulates a first-time user. Reads ONLY user-facing surfaces. Confusion IS data. | after Builder, when task touches a user-visible surface | — |

## Learning loop

| Nickname | id | Archetype | Tier | Specialty | When to invoke | Partners |
|----------|----|-----------|------|-----------|----------------|----------|
| Loid | `forge` | forge | 1 (opus) | Agent intelligence officer. Designs agents, processes Cid's debrief, promotes journal → notebook → wisdom. | end of session; when adding/redesigning agents | cid (Cid) |
| Scholar | `scholar` | scholar | 1 (opus) | Research, curation, citation discipline. Source material producer. | "research", "curate", university content | educator (Sheila) ✓ reciprocal |
| Sheila | `educator` | educator | 1 (opus) | Pedagogical sequencing — quizzes, paths, PLSAT modules. Source material shaper. | university content, course design, learning materials | scholar (Scholar) ✓ reciprocal |

## Specialty + ecosystem

| Nickname | id | Archetype | Tier | Specialty | When to invoke | Partners |
|----------|----|-----------|------|-----------|----------------|----------|
| Rune | `compliance` | compliance | 2 (sonnet) | Symbol planner / coverage owner. Pre-impl plan; post-impl report. Never source. | when symbol coverage matters; v6.1 will sharpen this role | — |
| Jinx | `advocate` | advocate | 2 (sonnet) | Devil's advocate. Stress-tests assumptions; finds edge cases. | "what could break", before high-risk decisions | — |
| Trace | `debugger` | debugger | 2 (sonnet) | Root-cause hunter. Hypothesis-driven, binary-search. | "this is broken", "why does X happen" | — |
| Shield | `qa` | qa | 2 (sonnet) | Test STRATEGY (not execution). Pyramid shape, coverage targets. | when designing the test plan, not writing tests | tester (Probe) |
| Helix | `dx` | dx | 2 (sonnet) | DX/SDK engineer. APIs, integration guides, webhook flows. | API surface design, SDK, integration docs | — |
| Mika | `designer` | designer | 2 (sonnet) | Design engineer. UI/UX, design systems, motion, a11y. | UI work, design system changes | — |
| Bolt | `performance` | performance | 2 (sonnet) | Core Web Vitals, bundles, query optimization. | perf concerns, "why is this slow" | — |
| Ship | `release` | release | 2 (sonnet) | Release manager. Versioning, changelogs, deployment coordination. | cutting a release, changelog work | — |
| Scout | `researcher` | researcher | 2 (sonnet) | Business research, competitive analysis, growth mechanics. | market/strategy questions | — |
| Swift | `swift` | swift | 2 (sonnet) | Swift/SwiftUI/Apple-platform specialist. Auto-rosters on Swift detection. Notebooks compound globally. | any Swift code, Conductor work | — |

> **Coming in v6.1:** Rune's three authority modes (Advise / Auto-author / Guard), the soft-block primitive, archetype-default authority claims, and the tier-1/tier-2 notebook split. See `agent-owned-enforcement-plan.md`.

## Reading this table

- A "✓ reciprocal" partner means both agents declare each other. A pending pairing (yellow ⚠ in `paradigm agent get`) is one-way and may be intentional.
- Tier maps to default model. Override per-project in `.paradigm/config.yaml` under `model-resolution`.
- "When to invoke" is heuristic — most invocation is automatic via `paradigm_orchestrate_inline` or natural keyword triggers in `agents.yaml`.

## Where these definitions live

- Profiles: `~/.paradigm/agents/<id>.agent`
- This project's roster: `.paradigm/roster.yaml`
- Adoption metadata: `.paradigm/adoptions.yaml`
- Prompts and tier mapping (source of truth): `packages/paradigm-mcp/src/tools/orchestration.ts`
```

That's the entire entry — single page, scannable, keeps every learner's first contact with the team to one screen of careful prose. The deep dives are CLI references in `roster-management`, the partners primitive in its own entry, and the rest is one click away in `docs/guides/agents.md`.

---

## 4. The partners primitive entry — design

`N-para-451-partners-primitive`. Intermediate sub-track. Walk-through:

### Section outline

1. **Why partners exists (v6.0.3 motivation).** Some agents do meaningfully better paired with another agent. Scholar produces source material; Sheila shapes it into learning experiences. Builder writes; Tester verifies. The framework needs a structural way to express "these two agents work as a unit" so tooling, marketplace, and notebook surfaces can reflect it.

2. **Field shape (the actual schema).** Quote from `packages/paradigm-mcp/src/types/agents.ts:89-93`:

   ```ts
   export interface PartnerRef {
     id: string;
     relation?: string;                              // free-form label
     share_notebooks?: 'off' | 'read' | 'read-write';
   }
   ```

   In an `.agent` file or `agents.yaml`:

   ```yaml
   partners:
     - id: educator
       relation: research-pair
       share_notebooks: read-write
   ```

3. **Scholar + Sheila as canonical example.** Show both halves of the reciprocal declaration (from `~/.paradigm/agents/scholar.agent` and `~/.paradigm/agents/educator.agent`). Note that this is the example referenced explicitly in project memory's `feedback_specialized_agent_responsibilities.md`.

4. **Reciprocal vs pending.** When A lists B *and* B lists A → reciprocal (✓). When A lists B but B doesn't reciprocate → pending (⚠). Both are legal. One-way is intentional in mentor/lead patterns, accidental in typos.

5. **The pair notebook namespace (reserved).** `.paradigm/notebooks/_pairs/{a-b}/` — alphabetical sort, regardless of declarer. Reserved at v6.0.3, no entries written yet. Pair-learning at v6.1+ will use it.

6. **What `share_notebooks` does today vs what it will do.**
   > **Coming in v6.1:** `share_notebooks: read-write` will activate live notebook bridging between paired agents. At v6.0.3 this field is **reserved** — declaring it is forward-compat-safe, but no runtime effect ships yet. The default value will likely shift at v6.1 (currently this is tracked as TD-2026-04-25-704). See `agent-owned-enforcement-plan.md` and the v6.1 roadmap.

7. **Marketplace primitives (contracts only).** Brief mention of `PartnerBundle`, `ReciprocalInstallMeta`, `PartnerCoverage` in `packages/paradigm/src/commands/agent/registry-types.ts` — defined for nevr.land but no live consumer wiring yet. Important for forward-compat; not load-bearing for the learner.

8. **Try this.** Run `paradigm agent get scholar`. Look for the Partners block. Then run `paradigm agent get educator`. Verify the ✓ reciprocal.

---

## 5. Quizzes (Sheila's pedagogical sequencing)

7 quizzes in total. Each has 3-5 questions, single-correct multiple-choice, with explanations. Pass threshold: 0.7 (matches existing first-party convention).

### Quiz prompts (representative — full questions authored when entries are written)

**Q-para-451-identity-layers** (3 questions)
1. Which layer is **machine-stable** (must not change once an agent is published)?
2. A user renames `forge` to "Lola" on their project. Which layer changed?
3. Two projects each have an agent with archetype `compliance`. Are they the same agent?

**Q-para-451-archetypes-vs-instances** (3 questions)
1. Can two agents share an archetype but have different ids?
2. If you bench Rune on Project A, does it affect Rune on Project B?
3. Which entity travels in the nevr.land registry — id, nickname, or archetype?

**Q-para-451-tiers** (3 questions)
1. Which tier does the documentor live in by default?
2. What's the relationship between tier and default model?
3. Where do you override the per-tier model for a project?

**Q-para-451-when-to-invoke** (5 questions — scenario routing, the highest-leverage quiz in the course)
1. You just added a new protected `/admin` route. Which agent picks this up first?
2. Your test suite is going green but you suspect a logic gap. Which agent designs the test strategy (vs which one writes the test)?
3. After Builder finishes a feature touching the README, which agent runs next?
4. You're cutting a 6.1 release. Which agent owns the changelog?
5. You want to add a new ecosystem agent for Rust. Which agent should you consult on the design?

**Q-para-451-roster-management** (3 questions)
1. `paradigm agent bench designer` on this project — does the global profile change?
2. Where does the `/paradigm:agents` skill get its Neverland health metrics?
3. You join an existing project with lore but no synced expertise. Which command bootstraps?

**Q-para-451-orchestration-modes** (3 questions)
1. In Claude Code, agents run as isolated Task tool contexts. What's the equivalent in Cursor?
2. What setting controls the default mode?
3. Which mode preserves separate memory per agent?

**Q-para-451-partners** (4 questions)
1. What does `share_notebooks: read-write` do at v6.0.3?
2. Scholar declares Sheila as a partner. Sheila does **not** reciprocate. What's the pairing called?
3. Where do pair notebooks live (path)?
4. Which file is the source of truth for the `PartnerRef` schema?

---

## 6. Pack location

**Recommendation: first-party `paradigm` pack** at `packages/university/src/content/`.

Rationale:

- These concepts are universal across every Paradigm install. Identity layers, the canonical roster, partners, orchestration modes — none of this is project-specific.
- Sheila's role explicitly includes authoring first-party University content (per her `.agent` profile and the educator-paradigm-university integration).
- First-party shipping means every install learns about agents from a stable, curated source — important because today the in-framework explanation is missing entirely.
- A project-scoped pack would orphan this content the moment a learner moves to a second project.

The design doc itself lives in `.paradigm/research/` (this file). The actual entries authored in Phase A ship to:

- `packages/university/src/content/notes/N-para-451-*.md`
- `packages/university/src/content/quizzes/Q-para-451-*.yaml`
- `packages/university/src/content/paths/LP-para-451.yaml`

After authoring, bump `node_modules/@a-company/university/pack.yaml` version (per the `@a-company/university` versioning rule in project memory: bumps only on university content changes).

---

## 7. Forward-compatibility callout pattern

Every entry that touches a v6.1-evolving concept uses this single, uniform blockquote pattern:

```markdown
> **Coming in v6.1:** <one-line description of the change>. See [agent-owned-enforcement-plan.md](../../research/agent-owned-enforcement-plan.md).
```

Defined once here in §7. Used in (at minimum):

- `N-para-451-roster-reference` — Rune's role evolves; authority modes land at v6.1.
- `N-para-451-partners-primitive` — `share_notebooks` runtime behavior + default value adjustment.
- `N-para-451-mastery-review` — pointer to PARA 551.
- `N-para-451-archetypes-vs-instances` — note that field-level archetype surface lands later.

**Consistency rule:** never use bare "todo" / "later" / "future" language elsewhere in Phase A entries. The blockquote pattern is the only place forward-looking content appears, so learners always know exactly what the visual signal means.

---

## 8. Calibration check (Loid perspective)

How we measure whether the course works:

1. **PLSAT-style assessment after content lands.** Add a single PLSAT module ("Agents Foundations") that selects 5-7 questions across the 7 quizzes. Pass = 0.7. Tracks aggregate mastery across the cohort. PLSAT infra already exists in University — no new measurement infrastructure to build.

2. **Track entry-visit telemetry.** University already records visit counts per entry (used today for the existing 176-entry corpus). After Phase A lands:
   - Most-visited entries → keep prominent in the path order.
   - Least-visited entries → review for discoverability or relevance.
   - High visits + low quiz pass rate → entry is unclear; Sheila revises.

3. **Roster-reference visit-count vs `paradigm agent list` invocation count.** If the roster reference is visited far less often than learners run the CLI, the doc isn't surfacing in the right places — adjust the welcome entry's pointers.

4. **Partners entry as a leading indicator.** If 50%+ of learners who reach the roster reference also complete the partners entry, the intermediate sub-track is well-placed. If under 25%, partners is too deep for the slot — relocate to PARA 551.

5. **Loid notebook entry on completion.** After a learner finishes LP-para-451, Loid records whether their next session shows changed agent-invocation patterns (more direct invocation of specialty agents, fewer redundant manual handoffs). That's the ultimate proof the course did its job.

No new measurement infra needed. Every signal above ships on existing University + Loid telemetry.

---

## 9. Production sequencing

### Recommended authoring order

1. **Foundation chunk (must ship together):** entries 1-2-3-5-7-9 (welcome, what-is-an-agent, identity-layers, archetypes-vs-instances, tiers, roster-reference). This is the minimum viable launch — without these six, nothing else makes sense.
2. **Quiz chunk for foundation:** Q-para-451-identity-layers, Q-para-451-archetypes-vs-instances, Q-para-451-tiers, Q-para-451-when-to-invoke.
3. **Operational chunk:** N-para-451-roster-management, N-para-451-orchestration-modes + their quizzes.
4. **Partners chunk:** N-para-451-partners-primitive + Q-para-451-partners.
5. **Auto-rostering + mastery:** N-para-451-auto-rostering, N-para-451-mastery-review.
6. **Path stitching:** LP-para-451.

### Minimum viable launch (v6.0.4 or v6.1.0)

Chunks 1 + 2 + 3 = 12 entries. Path published with placeholder for partners + auto-rostering. This is enough to give learners a working introduction to agents and the roster.

### Can wait for v6.1.1

Chunks 4 + 5. Partners primitive is intermediate content; auto-rostering becomes more important once ecosystem agents proliferate (Rust, Python ML, etc. join Swift). Mastery review is purely a recap and benefits from being authored last after we've seen which entries learners struggle with.

### What we explicitly do **not** ship in Phase A

- Anything tied to Rune's authority modes (Advise / Auto-author / Guard).
- The `paradigm_propose_block` primitive surface.
- Notebook tier-1 / tier-2 split semantics.
- Cross-project compounding *runtime* details (the high-level "agents learn over time" framing in `auto-rostering` is fine).
- Updates / retirements to existing PARA 401 stale entries — that's a v6.1 follow-up.

These become PARA 551: Agents in Practice.

---

## 10. Open calls for user / Architect

Decisions needed before authoring begins. **Ranked by blocking impact.**

1. **PARA 451 numbering vs PARA 401 collision.** Phase A introduces a new course in the 400 band. PARA 401 already covers (stale) agent material. Three resolutions:
   - **(A) Recommended:** Ship PARA 451 as a sibling to 401; mark 401's six agent entries as retirement candidates at v6.1; let learners discover 451 via the welcome entry's recommended-next pointer.
   - **(B)** Number the new course at PARA 050 or 150 to make agents an early-curriculum topic before architecture (changes the prerequisite chain).
   - **(C)** Replace PARA 401's agent entries in-place and call it done — risky because PARA 401 has its own learning path that would need restructuring.
   - **Need decision because:** the entry ids (`N-para-451-*` vs `N-para-150-*`) are baked into every file we author.

2. **Default authority claim model affects how we describe Rune** — but only at v6.1. For Phase A, we describe Rune at his v6.0.3 surface (advisory symbol planner / reporter, no authority claims yet). Confirm this is the agreed framing.

3. **Sheila + Scholar self-reference.** This course is Sheila's flagship work, authored in the canonical partners pattern. Should `N-para-451-partners-primitive` explicitly attribute itself ("This entry is itself a Scholar+Sheila collaboration — Scholar produced source material from `agents.ts` and the agent profiles; Sheila shaped it") or stay neutral? Recommendation: **attribute it**, because it teaches the partners pattern by being one. Confirm.

4. **Tier-2 notebook split warning in `N-para-451-tiers`.** The notebook tier split is Phase B work but the *concept* of "tier" is unavoidable in Phase A. Recommendation: keep `N-para-451-tiers` strictly about model-tier (opus/sonnet/haiku) and put a single forward-compat callout pointing at the v6.1 notebook-tier work. Confirm this scoping.

5. **Pack version bump cadence.** University version bumps only on content changes (per memory). Should Phase A ship as one version bump (entire chunk) or two (foundation chunk → minor; partners + auto-rostering → patch)? Defer to release manager (Ship).

6. **Identity model entry depth.** `N-para-451-identity-layers` teaches archetype as a concept even though there is no first-class `archetype` field in `AgentProfile` today. We flag this in a forward-compat callout. Is this OK, or does the user want the field to land first so the entry has something concrete to point at? (This is the call-out the advisor flagged.)

---

## Phase A → Phase B handoff

When Phase B is authored (PARA 551), the boundary is:

- **In Phase A (PARA 451), stable forever:** identity layers, archetypes vs instances, current 21-agent roster, partners primitive (declaration + reciprocal), orchestration modes, roster management, auto-rostering high-level.
- **In Phase B (PARA 551), evolves with v6.1:** Rune's authority modes, soft-block primitive, archetype-default authority claims, notebook tier-1/tier-2 split, cross-project compounding runtime mechanics, override-budget calibration patterns.

PARA 551 will treat PARA 451 as a hard prerequisite. The mastery-review entry already makes this pointer explicit.

---

*Source files referenced: `node_modules/@a-company/university/pack.yaml`, `node_modules/@a-company/university/src/content/{notes,quizzes,paths}/`, `packages/paradigm-mcp/src/types/agents.ts`, `~/.paradigm/agents/*.agent`, `.paradigm/agents.yaml`, `.paradigm/roster.yaml`, `.paradigm/adoptions.yaml`, `docs/guides/agents.md`, `.paradigm/research/agent-owned-enforcement-plan.md`.*
