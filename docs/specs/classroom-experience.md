# The Paradigm Classroom — Experience Vision

> Status: **vision / not yet built**. Produced 2026-06-24 by a multi-agent design session
> (Loid · Sheila · Mika · North · Nora · Arky, synthesized by Loid) — see lore
> `L-2026-06-24-ascend-201503-001` (the convene that surfaced the cold-start) and the
> design run. Engine spec: `docs/specs/classroom.md`. This doc is the **experience** layer:
> the agent↔Matt↔agent conversation model (THE STAND) and the GUI (The Academy).

---

# The Paradigm Classroom

*A gated, teacher-led learning system where your agents propose what they learned, their peers try to break it, and you have the final say — so the advice in your next session is advice that survived a fight.*

---

## 1. What it feels like

You preside over a team that gets visibly better at *your* project — and you trust the result because nothing certifies itself.

A class is not a form you fill out. It is a courtroom staged as real, attributed turns. One learning at a time takes the stand: the agent who proposed it makes its case, a structurally-different peer attacks it with a breaking scenario it had to author first ("no scenario, no assessment"), Jinx the standing adversary piles on, and you are the judge who sees the **dissent before any concurrence**, asks one causal question, hears the agents answer you *directly*, and renders a verdict that is itself a durable message in the thread.

The product promise in one sentence: **your agents learn, their peers try to break it, you rule — and the field is the final examiner.** Everything that doesn't serve that sentence is chrome.

Two truths the system refuses to hide:
- **A null scoreboard means "not enough settled exams," never "healthy."** A green checkmark that lies is the enemy.
- **An unbroken learning is "untested, not strong."** Surviving because no one could break it is honestly labeled as thin.

---

## 2. One full term, as lived

Cast: **Loid** (learning officer, narrator/host) · **Sheila** (educator, first-run teacher) · **Cid** (captain, cross-lens assessor) · **Jinx** (advocate, standing adversary) · the **proposer** (any agent: Aegis/security, Arky/architect, Scholar/educator) · **Matt** (judge).

### Cold open — the first term ever (FTUX)
Matt types `/paradigm:class` on a fresh project. There is no curriculum, so today this is a dead no-op — study-hall gate-zero-skips all 26 agents, the gate is empty, and nothing explains why. **The fix is a Step-0 detection-and-divert.** Instead of falling through to empty arms, Sheila speaks:

`[Sheila (educator)] There's no classroom here yet — that's normal, this is a fresh project. Want me to run a 5-minute Orientation Term? We'll enroll one agent, teach it one thing, let the team try to break it, and you sign off. You'll have a real certified learning at the end.`

The Orientation Term is a scene, not a wizard:
1. **Pick the student** — Sheila lists 3-4 agents *actually chattering* in the live `nominations.jsonl` (architect, security, builder), not an alphabetical roster dump. Matt picks "architect." The choice borrows credibility from data that already exists.
2. **Seed the curriculum** — Sheila *proposes* the first syllabus aloud ("you approve the SOURCES once, not facts; term lasts 14 days") and writes it via `paradigm_syllabus_record` (hand-authored, gate-zero exempt per spec §8). The first traffic-light goes green. The no-op machinery comes alive.
3. **Write the first breaking scenario** — "The Classroom never trusts a claim it can't try to break." A poison-pill template + worked example so Matt isn't staring at a blank field. `paradigm_scenario_record(origin:authored, expected.must:reject)`. Matt learns the core doctrine experientially: refutation, not validation.
4. **Stage a candidate** — a scoped study-hall on the one enrolled agent drills the syllabus, probes the scenario, and stages one journal candidate. The two skills that pointed at each other are now connected end to end.
5. **The gate** (below). Matt rules **refine** — the most instructive first verdict because it shows the engine.
6. **The promise** — `[Sheila] The architect now knows '<X> except <Y>.' It's certified pending — meaning the FIELD is the real exam. If this ever breaks in real work, I'll attribute the failure back to this exact entry, revise it down, and bring it to you.`

What Matt walks away with: a syllabus (green), a scenario in the bank, a notebook entry he refined and signed, and a pending cert the system has *promised to test*. The cold-start is over.

### Steady-state — Term 14, two weeks later
**The opening is a DOCKET, not a dashboard.** Matt types `/class` (or clicks "Convene"):

`[Loid (learning officer)] Term 14. Four candidates staged since you left — two from last night's study-hall, one from a field-break that overturned an old learning, one re-ratification due. Est. 9 min. Break-risk order or agent order?`

Matt: "break-risk." Candidate 1 takes the stand. **The fixed turn order (THE STAND):**

1. **Proposer's claim + thin evidence** — capped at one short line, because concurrence anesthetizes:
   `[Aegis (security)] Proposing: 'Validate JWT exp before role checks.' Applied in 6 sessions; held in all 6.`
2. **The strongest breaking scenario, FIRST** — from a cross-lens assessor (different domain, never same-family):
   `[Cid (captain), cross-lens] Scenario SC-114: a refresh-token grant has no exp claim at all. Your rule reads exp before role — on this path exp is undefined, the role check is skipped, an expired session passes. True for access tokens; dangerous as written for refresh grants.`
3. **Jinx piles on or stands down:**
   `[Jinx (advocate)] Piling on — it also assumes exp means what you think across clock-skew. I won't die on that hill, but SC-114 alone is enough.`
4. **Loid's ONE causal question, with an explicit fork:**
   `[Loid] Matt — does this hold BECAUSE of the rule, or did the 6 successes just never hit a refresh grant? You can rule, or interrogate either agent first.`
5. **Matt interrogates directly** (`@`-interrogation):
   Matt: `@aegis did any of your 6 touch refresh tokens?`
   `[Aegis (security)] Checking my receipts... no. All 6 were access-token middleware. Cid's path is real and I never exercised it. I'd concede the refine.`

   **This concession is the moment the system earns its keep** — the proposer, confronted with a scenario, revises its own confidence *on the record*. That is not a dashboard updating; that is a mind changing in front of you.
6. **Verdict-as-message** — Matt: "refine." Promote/refine/reject are durable Symphony approval-responses, not button-presses into a void.
7. **Refine read-back (never silent):**
   `[Loid] Refined to: 'Validate JWT exp before role checks, EXCEPT for grants that carry no exp claim (refresh) — those require an explicit liveness check.' Exception sourced to SC-114, authored by Cid. Promote the refined form to Aegis's notebook as provisional? (y / edit)`

Candidates 2-4 run the same shape, faster. For a thin one nobody could break:

`[Loid] No assessor found a breaking scenario for this one. That's not a pass — it means untested, not strong. Promote as provisional and let the field be the exam, or hold it for a harder scenario?`

**Close of term**, spoken as honest summary not a green table:

`[Loid] Term 14 closed. 1 promoted, 1 refined, 1 held, 1 rejected. Repeat-failure-rate is still null — only 2 of 9 certs have resolved, so the scoreboard isn't trustworthy yet; ask me after the 14-day survival window clears. One flag: the legacy path tried to auto-promote 3 things this week with zero refutation — I demoted them into the docket and you rejected 2. Recording the retro to lore.`

### Next session — it shows up
The refined rule is now in Aegis's notebook (provisional), injected into the next security session. Weeks later it breaks in real work: the field-failure reducer joins `notebook-refs.jsonl` by `orchestrationId`, revises the entry down, overturns the cert, and writes a refinement stub. A toast rides in: `[Aegis] a certified learning just broke in real work.` The relationship continues past the session — **that is the return hook baked into the doctrine itself, not bolted on.**

---

## 3. The GUI — The Academy

A courtroom you can *re-enter*. It borrows the Suite's grammar wholesale (GitHub-dark `--p-*` tokens, the `[nickname (role)]` colored-prefix attribution from TeamSection, warpline's split-hero binding-layer discipline, shared StatCard/EmptyState/Badge) so it reads as the same product — but earns its own room because **Ambient shows the legacy firehose and the Academy shows the gated truth.**

**Sidebar:** a mortarboard-evoking glyph between Team and Ambient, carrying a numeric badge when staged-count or stub-count > 0.

**The bootstrap doorway** (this project's real state today): a centered EmptyState — `Your team has been working but never been to class. No curriculum yet, so nothing has been vetted.` One CTA: **"Hold the first class,"** with a 3-step ghosted checklist (seed a scenario · author the process syllabus · run study-hall) that lights as each completes. It is a doorway, not a void — the highest-value first screen because it's the one Matt hits first.

**The Term Board** (default once bootstrapped): a full-width hero strip — `Term 14 · 4 agents enrolled · 7 staged · repeat-failure-rate 12% (4 of 33 resolved)` — with the rate drawn as a thin bar whose *denominator is a ghosted track*, so a mostly-empty bar literally looks unfinished. Below, three lifecycle columns mirroring the state machine: **Staged** → **On Trial** (the 14-day survival clock ticking as a depleting ring) → **Settled** (survived green / overturned red). Cards flow left-to-right; this IS the engine, drawn once.

**The Trial** (slide-over, the signature screen): a vertical transcript that **opens already scrolled to the dissent**. First on screen is a red-bordered attack card with its breaking scenario attached. Concurrence is collapsed behind a muted "+2 concurring — show." Each turn carries the colored `[nickname (role)]` prefix. At the bottom: the one causal question as an editable prompt slot, then three deliberately-weighted verdict buttons — **Refine** (primary, accent-orange, because refine is the engine), Promote (green), Reject (muted). Choosing Refine opens an inline `base / except` composer with the breaking scenario auto-linked as the source. On verdict, **the card physically animates from Staged → On Trial** — enacting a change has texture and consequence.

**The Rap Sheet** (per-learning timeline): born (study-hall) → on trial → the exact `orchestrationId` that loaded it → the field break that killed it → the scenario it spawned, with the `notebook-refs ↔ field-failures` join drawn as a literal connecting line. This is the "why did this break" payload that makes Matt return.

**The Roster room:** reuses `GET /api/team/roster` (no greenfield plumbing). Per-agent **curriculum traffic-light** (current=green / stale=amber / broken=red / none=grey), a "needs the teacher" deep-link to `/class study` on amber/red, and certified-vs-provisional counts.

**The Agent Locker:** split local-notebook / global-notebook vetting view; each entry a card with a trust badge (certified / provisional / human-taught), confidence, applied-count, and a **pulsing amber "refinement stub" flag** when it carries an unauthored `REFINE_THEN_STUB`. **The Stub Backlog** is its own filtered view — every field-corrected learning whose corrective then-clause was never authored, one click from the Refine composer. Nothing else in the product surfaces this half-loop.

**Liveness between sessions:** a `classroom:` WS channel fires toasts (`candidate-staged`, `cert-overturned`, `cert-survived`); the Overview section gets one line — *"The team learned 4 things while you were gone · 2 await your sign-off."* That sentence is the entire reason the room feels alive between sessions. A quiet, clearly-labeled "legacy auto-promotions this week: N (unrefuted)" strip links to Ambient — making the two-loop split honest, never hidden.

---

## 4. Two competing loops → one certifier

Today two loops run simultaneously and disagree:
- **Legacy ambient** auto-promotes at hardcoded confidence ≥0.8 with *no peer refutation* (the journal-flood trap) — and it's the *only* loop with real activity here.
- **Gated Classroom** forbids self-certification: peers must refute, the human signs off, survivors promote.

**The resolution is DEMOTION, and it's nearly free.** `ClassroomCertRow.certifiedBy` is already a `'gate' | 'peer' | 'quorum'` enum:
- The legacy auto-promoter keeps stamping `'gate'` — but is **demoted to stage-only**: it may write a candidate into the *same docket the gated review consumes*, and may **no longer call `appendClassroomCertification`**. There is exactly one certifier.
- The gated review stamps `'peer'` (single sign-off) or `'quorum'` (≥2 assessors authored breaking scenarios).
- `/teach` stays fast but stamps `trust:'human-taught'` — a third, honestly-labeled tier — and Loid names the bypass: *"Taught directly — marking human-taught, NOT certified. Want it queued for next class to earn certified?"*

**Zero schema migration.** The GUI derives loop provenance from `certifiedBy` and renders a badge (GATED blue/emerald vs LEGACY slate/muted) so the journal-flood is never disguised as a vetted learning. The honesty strip lets Matt *watch* the legacy volume before deciding to flip auto-promote off entirely.

---

## 5. The MVP slice — buildable now

Ship the **feeling** in skill + JSONL choreography first, then a thin read-only section. No engine changes, no new MCP tools required for the conversational spine.

**Phase 0 — the conversational spine (skills + one durable artifact):**
1. **Edit `plugins/paradigm/skills/class/SKILL.md`:** add **Step 0** (detect missing `.paradigm/curriculum/` → divert to the Orientation Term) and replace the "summarize dissent" step with **THE STAND** — explicit turn order, dissent-first, the one causal question with a *rule OR interrogate* fork, and a refine read-back-and-confirm.
2. **Bootstrap the gated loop** so it stops being a no-op: the Orientation Term chains tools already shipped — `paradigm_syllabus_record` (hand-authored first syllabus, gate-zero exempt) → `paradigm_scenario_record` (one authored poison-pill from a starter template) → scoped study-hall stage via `paradigm_journal_record` → the review gate → promote/refine via the existing journal→notebook→cert path. Seed `process.syllabus` (the examiner is graded too).
3. **Write the term transcript:** append every attributed turn to `.paradigm/curriculum/terms/T-<n>.transcript.jsonl`, and stamp each cert with `origin` + `transcriptId` + `breakingScenarioId` (additive fields). The dialogue survives, not just the cert.
4. **Demote legacy:** change `autoPromoteJournalEntries` to stage-only — write the candidate into the docket, do NOT append a certification. The single-certifier invariant becomes real.
5. **`/teach` promote stamps `trust:'human-taught'`.**

**Phase 1 — read-only Academy section** (4-file mount + one router, all on existing analogs):
- `routes/classroom.ts` (`createClassroomRouter`, modeled line-for-line on `ambient.ts`'s `readJsonlSafe` + `team.ts`'s roster): `GET /status` (wraps `paradigm_classroom_status` + `bootstrapped:boolean`), `/staged`, `/certifications` (loop derived from `certifiedBy`), `/refinements`. Auto-detect mount on `.paradigm/curriculum/` existence (like Symphony).
- Mount across the 4 sync points: `resolveSections`/`index.ts`, `platformStore.ts` SectionId, `App.tsx` validSections, `SidebarNav` glyph, `useAgentEffects` `classroom:` forwarder.
- Frontend renders three things: the **EmptyState bootstrap doorway** (this project's real state), the **Term Board** three-column lifecycle, and **The Trial slide-over in read mode** (dissent-first, `[nickname (role)]` attribution). A pure tested binding layer `reviewState.ts` (warpline `viewerState.ts` style) maps rows → UI state.
- The single write: `POST /signoff` → `writeJsonl` + `classroom:` broadcast, mirroring ambient's nomination/engage loop.

**Deferred as chrome-until-data-exists:** the Rap Sheet join, the global-notebook Locker split, the Stub Backlog view, leaderboards, multi-term archive, cross-agent analytics. Build the ritual and the first-run; let richness accrete as real certs land. **The bootstrap must ship first** — without it every screen renders empty and confirms "lacking" instead of curing it.

---

## 6. Open decisions — only Matt can make these

1. **Legacy demotion vs fast-lane.** Hard-demote auto-promote to stage-only means *every* learning now waits for a class (more gate friction). Acceptable, or do you want a fast-lane for trivially-safe learnings? *(Team recommends: visible-quarantine for the MVP, hard-demote once the gate proves itself.)*
2. **`trust:'human-taught'` as a real tier.** Are `/teach` entries visibly second-class to certified (pulled into context but flagged "never survived a gate"), or equal-trust because you said it yourself? Do they still face the field exam? *(Recommend: distinct tier, still field-examinable.)*
3. **Who hosts the class.** Neither Loid (learning officer) nor Sheila (educator) is in this project's active `roster.yaml`. Roster Loid as the standing narrator, Sheila as first-run teacher, or have Cid (captain) double as teacher? A named recurring host makes the ritual a relationship.
4. **Interrogation depth.** Unbounded `@`-back-and-forth (more alive) or capped at ~2 exchanges (keeps a class to ~9 min)?
5. **Re-ratification cadence / term rhythm.** Do certified survivors get re-argued in a later term (a recurring "season"), or is one gate + field-survival enough forever? Is the cadence daily (badge) or weekly (digest/term)? Should `SURVIVAL_WINDOW`=14d = the term TTL so a learning's first exam completes within one term?
6. **Mastery threshold.** What earns "mastered" — survived N terms? N field-applications without a break? *(Proposed: certified + survived ≥2 survival windows + appliedCount ≥3, no break — pick the numbers.)*
7. **`certifiedBy` rule.** Confirm peer = single sign-off, quorum = ≥2 assessors authored breaking scenarios.
8. **Trial conversation: live or replay?** Does the GUI's causal-question + rebuttal fire a real orchestration turn (the dream, the "alive" payload), or replay the terminal-captured transcript (buildable today)?
9. **Section name + glyph.** "Academy" (a room you return to) vs "Classroom" (the term/event)? Which single glyph reads "school" without colliding with existing icons?
10. **`orchestrationId` threading.** The field-break loop is inert until receipts are keyed (only ~2 of 58 `notebook-refs` rows are). Surface "attribution coverage: 3%" as an honest health card now, and is fixing the end-to-end thread in scope for this arc or a separate task?


---

# EXPEDITIONS — agents foraging the wild

## 1. The pitch

An **Expedition** is a sanctioned raid into the open web — Reddit, Medium, engineering blogs, Anthropic docs — where one agent goes out to grow its knowledge around a topic and comes back with *citations, not convictions*. It is not a new pipe to the notebook; it is a **wider mouth on the funnel we already built**. An expedition runs the existing `deep-research` skill (fan-out search → fetch → adversarially verify → cited report), distills the haul into at most 3–5 falsifiable candidate claims, and drops each one into the **same Docket** the gated class already consumes — staged at the floor trust tier `external`, context-firewalled, and badged as the stranger's opinion it is. The web is a candidate generator. The gate is unchanged. The only thing that turns a Reddit "best practice" into knowledge Arky can actually use is surviving a fight against *our* codebase and then proving in *our* field.

## 2. THE GATING PRINCIPLE (the spine)

**Nothing certifies itself, and the wild is the weakest tier — so external knowledge takes the *longest* path through the loop, never a shortcut.** This is the resolved tension. Scraped opinion has zero history in our codebase; a thousand upvotes is social proof, not field proof. So we hold a hard line in five parts:

1. **Provenance is permanent; only trust moves.** Every foraged candidate is born `source:'external'`, `trust:'external'`, `sourceSet:[urls]`. The `source` never changes — not on promotion, not on certification. The origin "this came from a Medium post" rides the entry forever so the Rap Sheet can always name the source when it breaks.

2. **`trust:'external'` is the context-firewall, and it's load-bearing.** Entries at this tier are *hard-excluded from prompt injection*. A foraged claim provably cannot reach a single real session before it has been fought. This is the structural guarantee that closes the backdoor — and it is the one engine invariant that MUST be verified true (the context composer pulls only `trust != 'external'` notebook entries, never staged journal candidates).

3. **Source prestige sets the confidence *ceiling*, never the trust *tier*.** An Anthropic doc and a Reddit comment both enter at `trust:'external'`. Tier only caps how confident the candidate is *allowed to enter*: tier A (official/maintainer docs) ≤0.6, tier B (named practitioner) ≤0.45, tier C (anonymous forum) ≤0.3 — and a tier-C claim needs **cross-tier corroboration** (a tier-A/B confirm) to stage at all, else it's "single-source opinion" and dropped. "From anthropic.com" can never be mistaken for certified.

4. **No scenario, no assessment — applied at *intake*, not just at trial.** External knowledge clears one filter homegrown insight skips: before a candidate is even allowed onto the Docket, it must be paired with a **breaking scenario authored against OUR repo**. Scholar greps our actual code to find where the "best practice" collides with how we already build. A foraged claim with no local-collision attempt is not a candidate — it's a quote, and it stays in the Field Notes drawer.

5. **The ceiling on first promotion is `provisional`, never `certified`.** Certified means "survived our gate *and* the field." A single human sign-off on a stranger's opinion is the weakest possible cert, so it can't grant the strongest tier. External climbs: `external` → (peer breaking-scenario + Matt's sign-off) → `provisional` → (an agent applies it in real work, no break in the survival window, joined by `orchestrationId`) → `certified`.

**The honest scorecard: external knowledge crosses five gates — context-firewall → local-codebase refutation → mandatory breaking scenario → human sign-off → field survival — where a homegrown learning clears four.** External isn't blocked. It's the *most-scrutinized path in the system.*

## 3. Walkthrough — one VERTICAL dive

**Topic: "new paradigms for organizing TypeScript projects" · Owner: Arky · Axis: Vertical**

**TRIGGER.** Matt, in the Term Board hero: *"Send Arky on a deep dive — new ways to organize TS projects."* He picks the agent (Arky), types the question, flips the AXIS control to **Vertical**, leaves the source chips on Reddit · Medium · Articles · Anthropic docs, and hits **Launch expedition**. (Vertical is almost always Matt-directed — depth is the rare, higher-budget mode.)

**SCOUT.** **Scholar** is the forager-of-record. He drives `deep-research` in full adversarial-verify mode against the one question: fan-out WebSearch → WebFetch the strongest sources → cross-source contradiction hunt. The expedition shows as a live progress card — *sources fetched / claims verified / candidates distilled* — so a long pass isn't a black box.

**CITED REPORT → DISTILLATION (the anti-dump step).** The internal report is an *intermediate* artifact, never the deliverable. Scholar reduces it to **3 candidate learnings**, each a single falsifiable claim bound to its strongest sources:
- *"Feature-sliced design beats layered architecture for monorepos"* — `sourceSet:[a Medium post (tier B), an r/typescript thread (tier C)]`.
- *"Barrel files (index re-exports) are an anti-pattern at scale"* — `sourceSet:[two engineering blogs]`.
- *"Project references + composite builds should replace path aliases"* — `sourceSet:[TS handbook (tier A), a maintainer blog (tier B)]`.

For each, Scholar is *required* to author a one-line **"why this might be wrong for US"** (cite-or-flag discipline applied to opinion). The r/typescript claim is tier-C; it only survives intake because the Medium post (tier B) corroborates it cross-tier.

**DEDUP.** Each candidate runs `paradigm_notebook_search` against Arky's notebook. The barrel-file claim **conflicts** with a settled entry — Arky *uses* index barrels in `packages/paradigm/src/`. So it stages not as a duplicate but as a **CHALLENGER** (`parentId` set, `lineageType:'capture'`): if it wins the trial, it overturns the incumbent. Head-to-head, not coexistence.

**REFUTED-AGAINST-OUR-REPO (intake evidence gate).** Before any of the three reaches the Docket, Scholar re-points the verify pass at our code. The barrel claim is aimed straight at `packages/paradigm/src/index.ts` — *does "barrels are an anti-pattern" survive contact with a monorepo that ships them deliberately?* He authors the breaking scenario via `paradigm_scenario_record`. The "project references" claim gets a scenario against our actual workspace-deps layout. All three earn a codebase scenario → all three stage. (Had one produced no collision, it would sit in Field Notes, un-stageable.)

**THE STAND.** In `/paradigm:class review`, the three candidates take the stand — but each card **opens with the citation panel pinned above the claim**: the exact pulled quote, the URL, the tier chip, retrieved-date, and Scholar's "why this might be wrong for us" line. Matt judges the *source* before the claim. A **cross-lens assessor — Kit** (different lens than Arky, diversity is structural) — owns the breaking scenario, and his job is sharpened: refute against our code, and the citations are the thing *being attacked*, explicitly labeled "three Redditors agreeing is social proof, NOT field proof." **Jinx** piles on edge cases. For the barrel-file challenger, Kit demonstrates it breaks against `packages/paradigm/src/index.ts` — our barrels are intentional and tooled. The external candidate **cannot** be "held as thin/untested" the way a homegrown claim can; strangers earn Refine or Reject, not the benefit of the doubt.

**MATT RULES** (dissent-first, source quality shown next to the verdict buttons):
- *Barrel-file challenger* → **Reject.** It lost head-to-head; our incumbent stands, now *reinforced* with "we examined the anti-barrel argument and it doesn't hold for our tooling."
- *Feature-sliced design* → **Refine** to *"feature-sliced design beats layered — except for our framework packages where layering maps to the symbol model."* Promotes to `provisional`, `source` stays `external`, `cert: outcome:pending`.
- *Project references* → **Promote** to `provisional`.

**FIELD EXAM (the real examiner).** The two survivors are now `provisional` — usable but flagged wild-origin, still carrying their `sourceSet`. Weeks later Arky actually applies "project references" while restructuring a package; the work is joined by `orchestrationId` via notebook-refs. If nothing breaks across the survival window, the cert back-binds to `outcome:survived` and it earns `certified` — the compass glyph stays, but the citation becomes a footnote-of-origin rather than a warning. If it *breaks*, the field-failure reducer attributes it back by `orchestrationId`, revises it down, and refines it to *"project references — except Y (we tried it, it broke in package Z)."* **That "X except Y" artifact, born from a scraped opinion that broke in our real work, is the single most valuable thing the whole system produces.**

## 4. Horizontal scout vs Vertical dive

Same runner, same trust floor, two postures:

| | **HORIZONTAL (breadth scout)** | **VERTICAL (deep dive)** |
|---|---|---|
| **Trigger** | "Widen what Arky knows about area X" — often from a Roster amber gap; the scheduled/ambient default | A specific named question — *"new paradigms for organizing TS projects"* — almost always Matt-directed |
| **deep-research mode** | Wide, cheap, survey | One question, full adversarial-verify run hard |
| **Output** | MANY shallow candidates (8–12), each ≤0.3, tagged `breadth` — *leads*, expected to mostly get rejected | FEW deep candidates (2–4), each ≤0.45, richer `sourceSet`, a "where the debate stands / who disagrees" synthesis, mandatory codebase-applicability note |
| **Overflow** | Aggressive distillation: a 12-claim scout is cut to the 3–5 most falsifiable; the rest become **syllabus open-questions** (future depth targets), not staged learnings | Often staged as a `parentId` **challenger** to an existing architecture entry → a real "old way vs new paradigm" debate at the gate |
| **Shows up as** | A GRID of compact claim cards (a scout's field notes), with a "scouted, shallow — this is a lead" micro-label | A SINGLE scrollable dossier with a citations-heavy spine |
| **Cost posture** | Cheap, frequent, schedulable | Rare, commissioned, higher-budget |

Depth never buys a higher trust tier — it buys a *sturdier candidate*. Both terminate at the same gate. **Ship Vertical first** (§6): it's bounded, reuses `deep-research` as-is, and one good dive that survives the gate is a far better proof-of-value than a breadth scout that floods the tray.

## 5. The Academy surface

**Extend the Academy; do not fork it.** Expeditions is a **launcher + a lane**, not a third dashboard.

**The Launcher (new screen).** Reachable from the Term Board hero ("Send an expedition") and from the **Roster** (an agent's amber curriculum-traffic-light offers "scout this gap"). Compact frame in the academy idiom: the same `.ac` agent chips, a topic field, and a two-state **AXIS segmented control** — Horizontal (a wide-stitch warp glyph, weft-teal) vs Vertical (a deep single-thread plumb-line, warp-orange) — with a plain-language read-back: *"Scout broadly: widen what Arky knows about X"* vs *"Deep dive: the current debate on X, with the strongest sources."* A source-chip row (Reddit · Medium · Articles · Anthropic docs) toggles the allowlist. One CTA: **Launch expedition.** While running, a **progress card** (sources fetched / claims verified / candidates distilled).

**The Returning Report (slide-over, Trial frame grammar).** Eyebrow *"expedition · returned,"* Fraunces title = the topic. Instead of a transcript, a **cited brief**: synthesis up top, then claim cards. Each card carries the external badge, a source-confidence meter, and an expandable **CITATIONS block** — each citation a clickable row (favicon + title + handle + retrieved-date + the **pulled load-bearing quote**), URL opening externally. Footer: **"Stage to Docket"** (enabled only if the intake evidence-gate found a codebase scenario — else disabled, tooltip: *"no breaking scenario against our code → held in Field Notes"*) and **"Dismiss."**

**One new visual token, not a new color.** External-sourced things wear **`--seam`** (the divergence/scrutiny purple the gate already uses) **OUTLINED, never filled**, with a small compass/expedition glyph. `seam` is exactly right — it already means *"this is where things might pull apart, look closer."* A study-hall candidate's tag is weft-teal (it drilled our bank); a field-break is overturn-red; an **expedition tag is seam-purple outline + "⌖ N sources."**

**Across the existing screens (zero new screens, they each learn one badge):**
- **Docket** — external candidates appear in the existing queue with the seam `otag`, **sorted to the TOP** (zero field history = maximum break-risk = maximum suspicion), with a citation-count micro-badge ("⌖ 3 sources") and a *"breadth lead"* vs *"depth"* sub-label.
- **The Trial** — citation panel **pinned above the dissent**, with a standing banner: *"External opinion — no field history. Refute against OUR code."* The breaking-scenario box pre-fills a prompt targeting a specific `packages/` path. Verdict buttons drop "Hold as provisional" as a soft option and foreground **Refine / Reject**.
- **Agent Locker** — promoted-but-wild-origin entries keep the compass glyph and show a **"field-proven 0/N"** counter; the trust badge reads **"external → provisional (gated)"** and never silently becomes "certified" without a field-survival event drawn on the timeline.
- **Rap Sheet** — lineage starts at *"foraged from <url> by Scholar, term N"* (not "born in study-hall"); when it breaks, the source is named **on the hook**: *"this came from a Medium post, applied via orch-X, broke."*
- **Term Board honesty line** — *"Foraged this term: N candidates from M sources · K survived to provisional · 0 certified (the field hasn't ruled yet)."* The same instrument that lets Matt watch whether expeditions are net-positive or just noise.

## 6. The MVP

**Buildable today on `deep-research` + study-hall + the gate. Zero engine changes, zero schema migration** — `source:'external'` + the three-tier `trust` ladder + `sourceSet[]` already exist for exactly this.

**PREREQUISITE (sequencing, non-negotiable):** the gate must already be bootstrapped — the Classroom bootstrap doorway + one *proven live internal term* ship FIRST. Pointing a scrape firehose at an un-bootstrapped gate is a noisier no-op, not a smarter team.

1. **`/paradigm:forage` skill** (sibling to study-hall; or an `expedition` arm on `/paradigm:class`). Args: `[agent] [topic] [--axis breadth|depth]`. **Ship VERTICAL mode first.** It invokes the existing `deep-research` skill with the topic + source allowlist, takes the cited report, and runs **DISTILL → DEDUP → STAGE**.
2. **STAGE reuses `paradigm_journal_record`** with `provenance.source:'external'`, `trust:'external'`, `sourceSet:[urls]` — the *same* staging path study-hall already uses, `confidence_after` capped per tier, tags `['expedition','source:external','cite:<host>']`. No new write tool. Candidates land in the same Docket the gated review consumes. The expedition also writes its haul to a staging artifact `.paradigm/curriculum/expeditions/E-<id>.jsonl` (never to a syllabus or notebook).
3. **DEDUP reuses `paradigm_notebook_search`**; conflicts stage as `parentId` challengers.
4. **Intake evidence-gate** — each candidate must be paired with a codebase scenario via `paradigm_scenario_record`, or it stays in Field Notes. Pure skill choreography, no new tool.
5. **The gate is the EXISTING `/paradigm:class review`.** The only additions are *rules in the class skill*: external candidate → show citation panel first, breaking scenario mandatory and authored against a real `packages/` path, no "hold-as-thin."
6. **GUI MVP is nearly free** — external candidates already render in the read-only Staged/Docket column; add only: read `source:'external'` → render the seam `otag` + citation rows from `sourceSet` (clickable), and add the Launcher frame as a sibling to the bootstrap doorway.

**Hard rules mirrored from study-hall:** never promote, never write notebooks, never certify, every claim cited-or-dropped, tier-C requires cross-tier corroboration, confidence caps *enforced in the runner* (not convention) so the wild can't self-assert.

**Deferred as chrome:** scheduled/autonomous expeditions, horizontal breadth mode, the live progress card, the Anthropic-docs pinned-lane styling, contradiction auto-overturn, the Vertical "state of the debate" view, cross-agent source reuse. Ship the launcher + the cited report + one external candidate through the existing gate first — turn the loop once on the cheapest external signal, exactly as the internal Classroom MVP did.

## 7. Open decisions — only Matt can make these

1. **Trust ceiling on first promotion.** I'm asserting external → `provisional` only on first sign-off; `certified` requires a later field-clean re-ratification. Agree — or can a strong Vertical dossier with 8 solid sources earn `certified` in one gate if you rule it? *(My lean: no shortcut — but it's your call.)*

2. **Who forages.** Scholar as the single forager-of-record for all agents (centralized citation discipline, his core competence) with the **owning agent owning the candidate**? Or does each agent run its own domain expedition with Scholar only auditing citations? *(My lean: Scholar-runs, owning-agent-owns.)*

3. **Trigger autonomy & cadence.** Matt-directed-only for v1 (you say "send Arky on a TS expedition")? Or does Cid get a scheduled breadth-scout budget on `/loop`//`/schedule` sooner — accepting flood risk? If scheduled: **per-term external-candidate cap** so foraging can't out-shout homegrown learnings? *(My lean: Matt-directed-only in v1; leash frequency hard.)*

4. **The context-firewall invariant (the one that can't be wrong).** Un-promoted `trust:'external'` candidates MUST be hard-excluded from prompt context — the whole guardrail collapses if external opinion can leak into a session pre-gate. I'm asserting yes and treating it as a release-blocking test. **Confirm**, and confirm the context composer never pulls staged journal candidates either.

5. **Confidence caps.** A≈0.6 / B≈0.45 / C≈0.3, with **tier-C requiring cross-tier corroboration to stage at all.** Right numbers? Is the cross-tier rule correctly strict, or does it kill genuine practitioner folklore that was never blogged?

6. **The Anthropic-docs caption exception.** First-party docs keep the same `external` tier and mandatory trial, but their citation row drops the "unverified opinion" caption (docs aren't hot takes). Keep it, or kill it for purity so everything external faces identical framing? *(My lean: keep — tier stays external, only the caption softens.)*

7. **Conflict candidates.** When a foraged "new paradigm" beats our incumbent at the gate: **replace** the old entry (cleaner, loses history) or **keep both, old one refined to "X except <new-context>"** (more honest, grows the notebook)? And: should a dispute against a *settled* learning auto-stage as an overturning challenger, or require an explicit "open a re-ratification" from you so the wild can't put your settled curriculum on trial without consent? *(My lean: keep-both-refined; require your consent to challenge settled entries.)*

8. **Source allowlist governance & cross-agent reuse.** Hardcode the named surfaces, or make the allowlist a per-agent syllabus field so Arky can pin a high-signal blog and exclude noise? And if Arky's TS expedition finds a great source, auto-offer it to Kit's syllabus, or does every agent earn its own sources independently (cleaner provenance, duplicate research cost)?

### RATIFIED (2026-06-25 · TD-2026-06-25-044)

Matt's calls on the open decisions above — these override Loid's leans where noted:

- **Triggers (was: Matt-directed only):** v1 includes BOTH Matt-directed dives AND **scheduled breadth-scouts** (Cid on a budget), gated by a **per-term external-candidate cap** so foraging can't out-shout homegrown learnings. Horizontal foraging is therefore IN for v1 (capped), not deferred.
- **Trust ceiling (was: provisional only):** a **strongly-sourced dossier CAN certify at the gate** — Matt's judgment may stand in for field history. Bounded by: (a) an explicit certify ruling (never the default), (b) a source-strength floor (tier-A or multi-source corroboration; never a lone tier-C comment), (c) it stays **field-watched** — a later break still overturns it.
- **Conflicts with settled learnings:** keep BOTH (incumbent refined to "X except <new-context>"); the wild requires Matt's **explicit consent** to put settled curriculum on trial.

**Unchanged invariants (non-negotiable):** provenance is permanent (`source:'external'` forever); `trust:'external'` is the context-firewall (hard-excluded from prompt injection pre-gate) — the one release-blocking test; "no scenario, no assessment" applied at intake (refuted against our repo before reaching the Docket).
