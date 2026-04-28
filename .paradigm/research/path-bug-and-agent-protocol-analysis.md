# Path-Bug and Agent-Protocol Analysis

**Target file:** `.paradigm/research/path-bug-and-agent-protocol-analysis.md`
**Date:** 2026-04-28
**Author:** Architect (with team perspectives: Loid, Jinx, Helix, Rune, Builder/Kit, Documentor)
**Trigger:** v6.0.4 ships with a writer/reader path-resolution mismatch in `paradigm_purpose_add_aspect` ↔ `paradigm_aspect_check`; quaki-web agent diagnosed locally but did not surface upstream.

---

## Section 1 — Architect: Tool bug fix paths

**Verified mismatch:**
- Writer (`packages/paradigm-mcp/src/tools/purpose-portal.ts:832-851`) resolves anchors against `purposeDir = path.dirname(filePath)`. If a project-root-relative input doesn't resolve there, it auto-rewrites to `.purpose-dir-relative` and stores that string.
- Reader (`packages/paradigm-mcp/src/tools/tags.ts:484-489`) resolves identical strings against `ctx.rootDir`. No fallback.
- Outcome: every aspect with anchors crossing directories (e.g., `../proxy-fetch.ts`) reads as "missing." Symmetric writer/reader self-verification at writer:870-875 doesn't catch it because it only re-reads the YAML, not the anchor target.

### Option A — Change writer to store project-root-relative
- **Touch:** purpose-portal.ts:832-851 (invert the conversion: rewrite purpose-dir-relative → root-relative before storage).
- **Migration risk:** HIGH. Every `.purpose` file shipped under v6.0.0–v6.0.4 with `..`-prefixed anchors becomes wrong on read until migrated. Affects every adopting project.
- **Rollback:** Revert + re-migrate. Painful.
- **Schema impact:** None to `@a-company/agent-format` schema; semantic change only.
- **Test scope:** Writer-direction tests + a `paradigm migrate anchors` codemod that walks every `.purpose` file in the workspace, resolves each anchor against the historical (purpose-dir) base, rewrites to root-relative.
- **Not recommended for a patch.** Migration scope is incompatible with v6.0.5 cadence.

### Option B — Reader tries both bases (RECOMMENDED)
- **Touch:** tags.ts:484-489. Replace single resolution with: try `path.join(ctx.rootDir, anchor.path)`, fall back to `path.resolve(purposeDir, anchor.path)` where `purposeDir` is the directory of the `.purpose` file the aspect lives in. ~5 lines including the `purposeDir` derivation.
- **Migration risk:** ZERO. Existing data on disk works under both bases. New writes (still purpose-dir-relative) read correctly. Future writes (whatever convention) read correctly.
- **Rollback:** Single-file revert. No data on disk has changed.
- **Schema impact:** None. No agent-format PR needed.
- **Test scope:** Two unit tests (root-relative anchor resolves; purpose-dir-relative anchor resolves) + one roundtrip integration test (call writer, then call reader, assert anchor found). Roundtrip test is the architecture fix — see "Test gap framing" below.
- **Caveat:** Symmetric ambiguity exists if the same relative path resolves to *different* real files under each base. In practice, anchor strings starting with `../` only resolve under purpose-dir; strings starting with package paths only resolve under project-root. Order resolution by "exists check," not by base preference, to make the asymmetry explicit.

### Option C — Explicit `base:` field per anchor
- **Touch:** Schema change in `@a-company/agent-format` (`Anchor` type), writer (always set `base: 'purpose-dir'` or `base: 'project-root'`), reader (read `base` field; fall back to legacy heuristic for old data).
- **Migration risk:** MEDIUM. Old data lacks `base`; reader needs the same fallback as Option B anyway, so C is "B + future-cleaner schema."
- **Rollback:** Revert schema PR + revert writer/reader. Multi-package coordination.
- **Schema impact:** Cross-package PR to `@a-company/agent-format`. Real coordination cost during a patch window.
- **Test scope:** Schema validator tests + reader fallback tests + writer field-population tests.
- **Not recommended for v6.0.5.** This is a v6.1+ "schema cleanup" follow-up after B stabilizes.

### Recommendation
**Ship B as v6.0.5 patch.** Pair with a structural follow-up (not part of the patch): extract `resolveAnchorPath(anchor, purposeDir, rootDir)` to a shared module imported by both writer and reader, so future tools can't drift. File the schema-explicit `base:` field (Option C) as a v6.1+ idea, not blocked on the patch.

The writer already does the both-bases dance for *input* (lines 838-846). The asymmetry is that the writer rewrote inputs to one canonical form, but the reader assumed the *other* canonical form. Symmetrizing the reader closes the loop with the lowest blast radius.

---

## Section 2 — Jinx: What ELSE is broken?

I sampled five high-traffic writer/reader pairs.

| Pair | Convention agreement? | Notes |
|---|---|---|
| `paradigm_purpose_add_aspect` ↔ `paradigm_aspect_check` | **MISMATCH (the reported bug)** | Writer normalizes to purpose-dir-relative; reader resolves project-root-relative. |
| `paradigm_purpose_add_component` ↔ `paradigm_search` / `paradigm_ripple` | Likely consistent | Component anchors store via the same `purpose-portal.ts` path-resolution logic (`resolvePurposeFilePath`); readers via index. Worth a roundtrip test, but no obvious mismatch in current code paths. |
| `paradigm_portal_add_gate` ↔ `paradigm_gates_for_route` | Likely consistent (different vector) | Gates live in `portal.yaml` at project root; both tools resolve relative to `ctx.rootDir`. No purpose-dir vs root-dir axis. **However:** see [feedback_verify_mcp_writes.md](feedback_verify_mcp_writes.md) — the 2026-04-20 silent-no-op finding was on this same tool. Different bug class (write didn't persist), same trust-erosion signal. |
| `paradigm_notebook_add` ↔ `paradigm_notebook_search` | Likely consistent | Notebook paths are content-addressed within `.paradigm/notebooks/<archetype>/`; no project-relative path stored. Cross-refs work in v6.1 Sprint 2 may reintroduce path semantics — flag for review when that lands. |
| `paradigm_aspect_check` ↔ `paradigm_aspect_drift` | **At-risk** | Aspect drift presumably reads the same anchor strings; if it shares the reader path-resolution logic with `aspect_check`, it inherits the same bug. **Verify during the v6.0.5 fix.** |

### Test gap that let this ship

**Both** an architecture failure and a process failure:

- **Architecture failure:** Writer and reader implement the same path-resolution convention twice, independently. Drift was inevitable. The fix is a shared `resolveAnchorPath()` helper that both tools import — without it, B (reader fallback) closes today's bug but the next path-handling tool can drift again.
- **Process failure:** No writer-then-reader roundtrip integration test exists for the aspect tool pair. The writer has self-verification at lines 870-875, but it only re-reads the YAML to confirm the string was written — it never asks "can the reader actually use this?" A 10-line integration test (`add_aspect → aspect_check → assert exists: true`) would have caught this on day one.

Roundtrip tests should become a category requirement: every writer/reader MCP pair gets at least one. Add to Builder's review checklist.

---

## Section 3 — Loid: Agent protocol gap

The quaki-web agent did the local-correct thing and stopped one step short. Quote-equivalent of its lore: "this is present in the existing project too." That framing kills upstream signal — it converts a framework defect into a project-state acknowledgment. The agent's blast radius is one project; the bug's blast radius is every adopter. Telemetry mismatch.

### Option α — `paradigm_task_create` with `framework-bug` tag
- **Fires when:** Agent detects MCP tool gives wrong/unexpected output AND can show evidence that the cause is in framework code (not project state).
- **User sees:** A task in their local task list, tagged `framework-bug`. Agent continues session.
- **Telemetry:** Local-only. Framework maintainers see nothing unless the user surfaces it.
- **Feedback loop:** Closes only if the user reads their tasks and reports upstream. **Open-loop in practice.**
- **Cost:** Zero. Existing primitive.

### Option β — New tool `paradigm_framework_issue(summary, evidence, severity)`
- **Fires when:** Same trigger as α, but the report is structurally distinct.
- **User sees:** A file in `.paradigm/framework-issues/`, plus optionally an outbound nomination if telemetry consent is granted.
- **Telemetry:** Routable to framework CI / telemetry endpoint when user opts in.
- **Feedback loop:** Closes when framework maintainers ship a fix and agents see the issue marked resolved.
- **Cost:** New MCP tool surface, new directory, new schema, opt-in telemetry policy. Real surface-area expansion.

### Option γ — Soft-block via `paradigm_propose_block(claimant: 'framework')`
- **Fires when:** Agent believes a framework defect is blocking session correctness, not just inconvenient.
- **User sees:** Session enters a soft-block state inherited across resumes until upstream fixes (or the block is overridden).
- **Telemetry:** Block events flow through the v6.1 Sprint 1 block primitive's existing channels.
- **Feedback loop:** Closes when block is resolved upstream OR overridden locally.
- **Cost:** Already in-flight (v6.1 Sprint 1). Marginal cost is just adding `claimant: 'framework'` as a recognized variant.

### Option δ — Combination
α (now) for local tracking + γ (v6.1) for cross-session inheritance. β only if α+γ generate visible noise vs. signal after one quarter of field data.

### Recommendation
**δ with phasing.**
- **v6.0.5 (this patch):** Use α — `paradigm_task_create` with tag `framework-bug` is a zero-surface primitive available today. No new tool needed.
- **v6.1 Sprint 1:** When the block primitive ships, recognize `claimant: 'framework'` as a first-class variant. Agent's protocol becomes: file the framework-bug task (α) AND propose a soft-block (γ) if the bug actively misleads its current decisions.
- **β deferred:** Don't add `paradigm_framework_issue` until α+γ field data shows the existing primitives are insufficient. The dedicated tool is justified by evidence, not prophylaxis.

### Calibration gate against over-fire

Signal-to-noise collapses if every agent surprise becomes a framework-bug report. The gate: **the agent must attach code-location evidence** — at minimum a writer file:line and a reader file:line that demonstrate the divergence. Without two locations naming the divergent contract, the report is downgraded to a project-state task (no `framework-bug` tag). This is the same evidentiary bar a human bug report would clear.

The quaki-web agent had this evidence (it diagnosed correctly) but had no protocol-bound place to put it. We're closing the protocol gap, not lowering the bar.

---

## Section 4 — Helix: How does the agent experience THIS specific bug today?

Walk-through:

1. Agent: `paradigm_purpose_add_aspect(...)` with anchor `src/middleware/audit.ts:15`. Writer succeeds. Returns `ok`.
2. Agent (later, same or next session): `paradigm_aspect_check({ id: 'audit-required' })`. Sees anchor with `exists: false`.
3. Agent's mental model: *"I just registered this. The writer said success. Reader says missing. Either the writer lied or the file moved."*
4. Agent debugs — opens the `.purpose` file directly to read the stored string. Finds `src/middleware/audit.ts:15`. Goes to that path, file is there. Confused.
5. Eventually realizes the reader is using a different base. (In quaki-web's case, the agent figured this out via the path containing `..` after writer rewrite.)
6. **Decision point:** hand-edit (antipattern), abandon session, or surface upstream? Currently the agent has no protocol-bound third option, so the temptation toward hand-edit is real. quaki-web resisted; another agent might not.

### Where the wrong signal lives

**Step 2 is the broken signal.** `paradigm_aspect_check` says `exists: false` with no disambiguation. The agent's only recovery hint is "look at the anchor and figure it out yourself." The implicit message is "this is your problem to fix in your file." That's the message that nudges toward hand-editing.

### Where a better signal goes

`paradigm_aspect_check` should, when an anchor reports `exists: false`, attempt the second base **silently as a diagnostic only** and include a `note` in the response:

> If the anchor exists under one base but is reported via the other, return `exists: false` plus a structured hint: `{ resolution_hint: "Anchor resolves under .purpose-dir base but not project-root base. This indicates a framework path-resolution bug; do NOT hand-edit. See protocol: framework-bug surfacing." }`

This is non-load-bearing for the bug fix itself (Option B fixes the underlying behavior), but it's the **DX scaffolding** that catches *future* writer/reader drifts of the same class. It tells the agent: this is not your bug to hand-fix; here's the protocol entry point.

Ship the diagnostic hint together with B in v6.0.5. ~10 lines.

---

## Section 5 — Rune: Who owns "framework bugs detected by agents"?

Under the agent-owned enforcement model (TD-2026-04-25-417, finalized 2026-04-26 per TD-2026-04-26-284), archetypes own their domains. Compliance is mine. Aegis owns security. Scholar/Sheila own learning. The question: is "framework bug detection" *one* archetype's domain, or does it cross all of them?

### Recommendation: Ownership follows the broken tool's domain.

- A bug in a compliance tool (`paradigm_aspect_check`, `paradigm_drift_*`) → Rune triages, because Rune already owns the tool's domain semantics and can distinguish "tool says missing because tool is wrong" from "tool says missing because project is non-compliant."
- A bug in a security tool (`paradigm_portal_*`, gate verification) → Aegis triages.
- A bug in a learning tool (`paradigm_notebook_*`, nomination) → Scholar/Loid pair triages.
- A bug in a navigation / coverage tool (`paradigm_status`, `paradigm_navigate`) → Cid triages.

**Reject** the meta-archetype (`#framework-watcher`) idea. A meta-archetype dilutes domain expertise and creates a "not my problem" gap. Every archetype already knows the semantics of its own tools well enough to spot a framework defect; the protocol just needs to give them a place to file it.

### Cross-cutting case

When a bug crosses domains (e.g., the path-resolution bug touches both compliance via `aspect_check` AND would touch portal tools if they shared the same helper), the framework-bug task gets co-owned. The first archetype to surface it owns triage; the second is added as reviewer. This piggybacks on the existing partner schema (Scholar+Sheila being canonical per [feedback_specialized_agent_responsibilities.md](feedback_specialized_agent_responsibilities.md)).

### Concrete mapping for THIS bug

`paradigm_aspect_check` is in Rune's domain (compliance / aspect verification). Rune owns the v6.0.5 framework-bug task. Architect (me) reviews the schema-level question of whether to ship Option C in a future release. Builder/Kit owns implementation of B.

---

## Section 6 — Builder/Kit: Implementation cost ranking

### Architect fix options

| Option | LoC | Test surface | Time to ship |
|---|---|---|---|
| **A** (writer rewrites to root-relative) | ~15 in writer + ~150 for migration codemod + tests | Migration codemod tests across fixture `.purpose` files; writer roundtrip tests | 2-3 days (migration validation dominates) |
| **B** (reader fallback) — RECOMMENDED | ~5 in reader + ~30 for shared helper extraction (follow-up) | 2 unit tests + 1 roundtrip integration test + audit `aspect_drift` for same bug | **Half a day for the patch; 1 day with the shared helper follow-up** |
| **C** (explicit `base:` field) | ~40 across writer/reader + cross-package PR to `@a-company/agent-format` (~20 LoC + version bump) | Schema validation tests + reader legacy-fallback tests + writer field-population tests + cross-package release coordination | 3-5 days incl. cross-package release |

### Loid agent-protocol options

| Option | LoC | Schema impact | Migration impact | Time |
|---|---|---|---|---|
| **α** (existing `paradigm_task_create` + tag) | 0 (use existing) | None | None | **0** — ships now |
| **β** (`paradigm_framework_issue` tool) | ~80 tool + ~40 schema + ~50 storage | New schema, new directory `.paradigm/framework-issues/` | None (new feature) | 2 days |
| **γ** (soft-block `claimant: 'framework'`) | ~10-20 (recognize new claimant variant in v6.1 Sprint 1's in-flight code) | Soft additive | None | Folds into Sprint 1 with negligible marginal cost |
| **δ** (α + γ phased) | α now (0) + γ at Sprint 1 (~15) | None now; minor at Sprint 1 | None | **Now + Sprint 1** |

### Builder's vote
B + δ. Patch ships in half a day. Sprint 1 absorbs γ at marginal cost. β stays parked.

---

## Section 7 — Documentor: Downstream surfaces that need updating

When B + δ-α land in v6.0.5:

| Surface | Update |
|---|---|
| `CLAUDE.md` | Add: "If an MCP tool gives unexpected output and you can identify the framework cause (writer file:line + reader file:line), file `paradigm_task_create` with tag `framework-bug`. Do NOT hand-edit." |
| `docs/guides/agents.md` | New section: "Framework-bug protocol" — when to file, what evidence, what NOT to do (hand-edit). |
| `~/.paradigm/agents/<id>.agent` (per-archetype prompts) | For Rune, Aegis, Scholar, Cid: "If a tool in your domain misbehaves and the cause is framework code, you own triage. File the framework-bug task." |
| **PARA 451** especially `N-para-451-tiers` | Update path-resolution discussion to reflect post-fix behavior. Note that anchors are now resolved by reader with both-bases fallback. |
| **v6.0.4 migration notice** | Add follow-up note: "Aspect anchors written under v6.0.0–v6.0.4 may have appeared missing on read. v6.0.5 fixes the reader; no data migration required." |
| `.paradigm/protocols/` | New protocol: `framework-bug-surface.protocol` — captures the agent's decision tree (evidence → file task → tag → continue session). |
| `feedback_verify_mcp_writes.md` (memory) | Append: writer self-verification only confirms YAML write; doesn't confirm reader can resolve. Roundtrip tests are the missing layer. |

When γ lands in v6.1 Sprint 1, append: how `claimant: 'framework'` differs from project-claimant blocks; expected resolution path.

---

## Section 8 — Synthesis (Architect): Recommended path forward

**Tool bug fix:**
- **Option B** (reader tries both bases) ships as **v6.0.5 patch**.
- Pair with extraction of a shared `resolveAnchorPath(anchor, purposeDir, rootDir)` helper (used by both `add_aspect` writer and `aspect_check` reader). This is the architectural insurance against future drift; it's <1 day extra and folds into the same release.
- Add the Helix DX hint (Section 4): `aspect_check` returns a `resolution_hint` when a base mismatch is detected.
- Add roundtrip integration test as a category requirement for writer/reader pairs going forward.
- Audit `paradigm_aspect_drift` for the same bug class during the patch.
- **Do NOT** fold into v6.1 Sprint 1. Sprint 1 is about the block primitive; mixing concerns delays both. Patch B in v6.0.5 cleanly, then Sprint 1 ships γ on top of a stable base.

**Agent protocol:**
- **Option δ phased.** v6.0.5 documents Option α (existing `paradigm_task_create` + `framework-bug` tag) as the framework-bug protocol. v6.1 Sprint 1 layers Option γ (soft-block `claimant: 'framework'`) on top. Option β stays deferred until evidence shows α+γ are insufficient.
- The calibration gate: agent must attach writer file:line + reader file:line evidence before tagging `framework-bug`. Without that, downgrade to plain task.

**Right now (this session):**
1. Persist this analysis at `.paradigm/research/path-bug-and-agent-protocol-analysis.md`.
2. File the framework-bug task itself, dogfooding Option α: `paradigm_task_create` for the path-mismatch bug, tagged `framework-bug`, evidence pointing at purpose-portal.ts:832-851 and tags.ts:484-489.
3. Decide ship vehicle (v6.0.5 vs Sprint 1 fold) — see Section 9 user call.

**Deferred:**
- Option C (`base:` field schema) → v6.1+ schema cleanup, post-stabilization.
- Option β (`paradigm_framework_issue` tool) → only if α+γ produce noise/signal problems in field.
- Cross-tool path-resolution audit beyond aspect tools → tracked as a follow-up after the shared helper lands.

**Ownership map (per Rune, Section 5):**
- Rune triages the framework-bug task (compliance domain).
- Architect (me) signs off on Option B vs C trade-off.
- Builder/Kit implements.
- Documentor updates the seven surfaces in Section 7.
- Loid records the meta-pattern (Section 10).

**What the team CANNOT decide** — see Section 9.

---

## Section 9 — Open calls for user

Per constraint: maximum 2 user-judgment calls.

1. **Ship vehicle: v6.0.5 patch vs. fold into v6.1 Sprint 1?** Team strongly prefers a clean v6.0.5 patch (Sprint 1 is about the block primitive, mixing concerns dilutes both releases and slows verification). But the user owns the release calendar and may have reasons to consolidate. **Team default if no answer: ship v6.0.5 patch.**

2. **Is Option β (`paradigm_framework_issue` tool) justified now, or deferred until α+γ field data?** Team recommends defer — α exists, γ ships in Sprint 1, β duplicates surface area without proven need. But if the user wants framework-bug telemetry visible to maintainers from v6.0.5 onward (rather than waiting for adopter reports), β earns its place now. **Team default if no answer: defer β; use α now, γ at Sprint 1.**

Everything else — Option B, the shared helper, the DX hint, the roundtrip test category requirement, ownership mapping, documentation surfaces, the framework-bug protocol document — the team has resolved.

---

## Section 10 — Loid (meta-observation)

Two meta-protocol failures in one session, same root cause.

1. **First failure:** Claude hand-edited a `.purpose` file despite the MCP-only norm. The instinct: "I see the broken state, I can fix it directly, that's faster than the right tool." Speed-as-permission-slip.
2. **Second failure:** Claude proposed solutions before invoking team analysis. The instinct: "the answer is obvious, why slow down for ceremony." Same shape — speed-as-permission-slip.

Both are urgency reframed as authority. Memory entries (`feedback_always_use_team.md`, `feedback_always_team_analysis.md`) catch these *after* the failure occurs. Reactive. By the time the entry exists, the cost has already been paid (in the v5.21.x case, three patches for a one-patch problem; in this session, a near-miss before the user intervened).

### The proactive signal

Memory writes catch the pattern. They do not catch the *next* instance because the failure mode isn't "I forgot what the memory says" — it's "I felt the answer was urgent enough to skip the protocol." The discriminator the model uses internally is wrong: it's *task urgency*, when it should be *task shape*.

The proactive trigger is a **pre-output checklist keyed on task shape, not urgency**:

> **Before producing substantive output (writes, recommendations, commits), check:**
> - Does this task involve multiple stakeholders or perspectives? → mandatory team pass.
> - Does this task touch shared infrastructure (paradigm files, portal.yaml, schema)? → mandatory advisor or team pass.
> - Does this task feel "obvious"? → that's a *negative* signal; obviousness is correlated with the failure mode.

This isn't "another memory entry." It's a structural check the model runs *before* the substantive work begins. The right time to invoke it is the moment the task description names multiple roles or surfaces — exactly what the user did in this prompt by enumerating Loid, Jinx, Helix, Rune, Builder, Documentor.

When the task explicitly enumerates a team, that's the prompt-level signal that team analysis is non-optional. When the task is implicit but multi-stakeholder, the model has to spot the shape itself. The latter is harder; that's where the failure lives.

### Concrete next-instance behavior

The model's first turn on any prompt that names ≥2 archetypes, or touches infrastructure files, should be:
- (a) orient briefly (read load-bearing files only),
- (b) call advisor before any substantive output,
- (c) explicitly enumerate the perspectives that will be represented,
- (d) only THEN produce.

The user-facing artifact of this protocol working is that the model's first substantive paragraph either says "I called the advisor and here's the team output" OR says "this is a one-shape task and I'm proceeding directly." Never silently chooses the second when the first applies.
