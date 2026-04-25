# Agent-Owned Symbol/Aspect Enforcement — Plan

**Drafted:** 2026-04-25 by main session synthesis (Rune + Loid + Architect parallel design pass).
**Status:** design locked; user-pending sign-off on tier defaults + authority-claim model.
**Trigger:** user reframe — *"Paradigm itself shouldn't enforce symbols. When Rune is on the project, HE owns the entire eco space."* + observation that 0.31:1 component-to-aspect ratio + 316 missing anchors prove descriptive enforcement fails.

---

## Thesis

**Framework provides enabling primitives. Active agent roster determines policy.**

Paradigm currently conflates "the framework cares about symbols" with "this project's team cares about symbols." Those are different claims. Users have the right to opt out of symbol discipline; the framework's value is agent handling + features, not symbol-coercion. When a compliance-archetype agent (Rune) is on the roster, **the agent owns enforcement**. The framework's job is to be powerful enough that agent ownership is real, not rhetoric.

Loid's framing: *"The deepest point: the user's reframe is a contract that Rune must be powerful enough to honor. If the framework stops enforcing and Rune can't pick up the slack, drift wins by default."*

---

## Where the team converged

- **Severity gradient with agent-controlled threshold.** Rune's 3-tier (advise / auto-author / guard); Architect's 4-level (silent / advisory / remediation / block); Loid's "owning the loop, not the gate."
- **Soft-block primitive is the missing piece.** Architect's `paradigm_block_until_remediated`, Loid's `paradigm_agent_propose_block` — same idea: agent-initiated, framework-honored, user-overridable with one keystroke. Without this, "agent owns domain" is rhetoric.
- **Framework metrics, no opinions.** When Rune is benched, framework computes coverage data (visible via `paradigm doctor`) but emits no warnings. Drop hook-level enforcement entirely when no claimant.
- **Cross-project compounding via notebooks.** Rune's notebook needs tier-1 (transferable rules) vs tier-2 (project-local exceptions) split — currently it's all tier-2, which is why he's ineffective on new-project onboarding.
- **Auto-roster via nomination, not auto-impose.** `paradigm shift` detects `.purpose` files + no compliance agent → emits nomination suggesting Rune. User accepts → Rune rostered + default authority claims written.
- **Session-start ambient pass.** Rune wakes on session-start (currently absent), runs coverage delta vs last session.
- **Override tracking for calibration.** Every soft-block override recorded → Loid uses for Rune's calibration loop (target: acceptance rate >60%, coverage trajectory monotonic toward project's declared target).

---

## Phased rollout

### v6.0.4 — Emergency Patch (1-2 weeks)

**Goal:** stop the cross-project bleeding. Framework stops enforcing in absentia; Rune's onboarding becomes a real pathway.

1. **Drop aspect-coverage block** in Stop hook when no compliance-archetype agent rostered. Keep anchor-*syntax-validity* check (broken `~aspect` references — that's a syntax issue, not policy).
2. **`paradigm doctor`** adds line item: `aspect coverage: X:Y (no claimant active)` — surfaces the data without acting on it.
3. **`paradigm shift`** detects `.purpose` files + missing compliance archetype → nominates Rune (user-confirmation required). Default authority claims auto-populate when Rune accepted.
4. **Stop hook** keeps lore-recording reminder + .purpose-coverage advisory; drops the block path that was firing without a claimant.
5. **Documentation**: CLAUDE.md updated to reflect "Rune owns symbol enforcement when rostered" rather than implying the framework does.

### v6.1 — Authority + Soft-Block Primitives (3-4 weeks)

**Goal:** give Rune the tools to actually own the domain.

6. **`.paradigm/authority.yaml`** — agent authority claims registry. Format:
   ```yaml
   claims:
     aspect-coverage:
       claimant: rune
       severity: advise   # advise | auto-author | guard
       since: 2026-04-25T...
   ```
7. **`paradigm_authority_claim` / `paradigm_authority_release`** MCP tools — agent registers/releases ownership.
8. **`paradigm_propose_block` primitive** — agent-initiated, user-keystroke-overridable. Writes a remediation record under `.paradigm/remediations/<id>.yaml` with reason, severity, unblock predicate. Stop hook is a thin executor that honors active records.
9. **Hook orchestrator** — TS module `paradigm_hook_dispatch` replacing bash logic. Bash hooks become thin shims that invoke the dispatcher. Centralizes roster-aware enforcement logic; testable.
10. **Rename `compliance-check` → `aspect-report`** (data-only). Alias kept for one minor. Removes the implication that the framework owns compliance.
11. **New MCP tools Rune needs:**
    - `paradigm_aspect_stub_create` — auto-generate aspect from component metadata + anchors
    - `paradigm_anchor_rewrite` — programmatic anchor patch on rename/move
    - `paradigm_coverage_metrics(scope)` — opinion-free metric read
    - `paradigm_compliance_digest` — structured end-of-session report channel
12. **Session-start ambient pass** for Rune — wakes on session-start, runs coverage delta vs last session, surfaces digest only if findings.
13. **Notebook tier-1/tier-2 split** — explicit `tier: transferable` vs `tier: project-local` field. Tier-1 entries travel cross-project; tier-2 stay home. This is the missing primitive Loid identified.

### v6.2+ — Polish and Calibration (later)

14. **Archetype-default authority claims** — rostering any `compliance` archetype auto-writes the default claims so Rune-on-Project-A behaves like Rune-on-Project-B without configuration.
15. **`paradigm_optout_register`** — durable opt-out registry the framework respects globally. `paradigm_optout_register --scope tests/ --reason "no-symbols-here"`.
16. **`paradigm_severity_emit`** — unified severity channel; deprecate ad-hoc warn paths in hooks/CLI.
17. **JSONLogic unblock predicates** — soft-blocks self-clear when conditions met (e.g., `unblock_when: ratio >= 0.6`).
18. **Override-cluster auto-coaching** — Loid notices 3+ same-pattern overrides → coaches Rune to write a notebook exception instead of asking again.
19. **Always-on metric snapshot at session-end → lore** — so when Rune is benched and later rostered, he has historical baseline.

---

## Rune's six transferable notebook patterns (Loid-designed, ship at v6.1)

These compound across every project where Rune is rostered:

1. **`coverage-ratio-by-component-type`** — different component types have different aspect needs (data models often don't need aspects; integration components almost always do). Rune learns the meta-rule, not project-specific ratios.
2. **`anchor-staleness-half-life`** — empirical decay constant for anchor freshness (~30 commits touching anchored file = 70%+ stale rate).
3. **`orphan-component-grace-period`** — defer alerts on session-start +1, not on PostToolUse. Avoids the nomination-spam pattern that bit ambient v5.
4. **`directory-exception-patterns`** — `tests/`, `scripts/`, `examples/` typically don't need aspect coverage. Pattern travels.
5. **`aspect-suggestion-from-imports`** — generative drift-fix proposals. Auth imports → `~auth-required`. DB imports → `~persistent`.
6. **`override-budget-per-session`** — 5+ overrides → Rune goes silent for the rest of the session, writes `noise-self-correction` entry. Calibration baked in.

---

## Authority gradient — three modes

Per Rune's self-design (default = Advise; user must promote):

| Mode | Behavior | When to use |
|------|----------|-------------|
| **Advise** | Surface findings via review pipeline + nominations. Never block. User accepts/rejects. | Default. Respects opt-out. |
| **Auto-author** | Rune writes stub aspects/anchors directly for new components. Stubs marked `~draft-rune` so user can refine. | Opt-in. Aggressive coverage repair without user toil. |
| **Guard** | Emit blocking review verdicts in orchestration. Builder/Documentor cannot close until coverage restored. Still NOT framework-level Write refusal — that's framework coercion. | Explicit opt-in only. For projects with strict coverage SLAs. |

---

## The Rune-absent case (locked)

When no compliance archetype agent rostered:
- `paradigm_status` shows coverage as raw data: `components: 704, aspects: 219, ratio: 0.31`
- No warnings, no suggestions, no nominations
- Neutral note: *"Rune (compliance) is benched — drift unmonitored"*
- Lore captures metric snapshot at session-end so Rune has historical baseline if rostered later
- Stop hook drops the aspect-coverage check entirely; keeps anchor-syntax check (that's syntactic, not policy)

This is what user agency looks like when honored.

---

## The 316-anchor drift on this project — concrete remediation

Owned by Rune, runnable tonight (post-v6.0.4 emergency patch ships):

1. Run `paradigm_aspect_drift` → categorize 316 by failure mode (renamed file / deleted symbol / moved dir / typo).
2. Auto-fixable bucket (rename/move): batch-rewrite anchors via direct YAML edit, one commit per category. Expected ~60-70% catch rate.
3. Deleted-symbol bucket: propose aspect deletion or re-anchor to new owner; nominate top 20 to user for decision.
4. Ambiguous bucket: park in `.paradigm/compliance/triage.yaml` with Rune's best guess + confidence score.
5. New-component coverage gap (485 uncovered): generate draft aspects in batches of 25, marked `~draft-rune`, commit per batch so user can revert cleanly.
6. Final commit: drift count delta + new ratio in commit body. Hand back to user with digest.

---

## Open calls for user

1. **Default authority mode** — `Advise` is recommended default. User can promote to Auto-author or Guard. Confirm?
2. **Authority claim model** — explicit (Rune calls `paradigm_authority_claim`) vs implicit (rostering Rune = default claims auto-populate)? Architect leans toward archetype-default; cleaner UX. Confirm?
3. **v6.0.4 vs v6.1 split** — soft-block primitive is the load-bearing piece. Pull it forward into v6.0.4, or hold for v6.1 with the rest of the authority work? Pulling forward = Rune effective sooner; harder release. Holding = clean release boundaries.
4. **Tier-1/Tier-2 notebook split scope** — needed for Rune's cross-project effectiveness. Ships at v6.1 per the plan, but applies to ALL agents (not just Rune) — does it warrant its own design pass with Loid?

---

## Recommended team for implementation

- **Lead:** Rune (compliance owner, designed his own role)
- **Framework primitives:** Architect + Builder
- **Notebook tier system:** Loid (forge) — owns notebook architecture
- **MCP tool implementations:** Builder (Kit)
- **Stress-test gates:** Jinx (advocate) — confirm v6.0.4 emergency cuts don't break the projects that DO want enforcement
- **Discovery UX:** Helix (DX) — `paradigm doctor` data-only surface, `paradigm shift` Rune nomination flow
- **Tests:** Probe + Shield
- **Docs:** Scribe + Scholar (Scholar drafts updated `agents.md` framing; Scribe owns structural integration)

Per always-include-Loid memory: Loid present in v6.1 phases 6-8 (`authority.yaml`, soft-block, hook-orchestrator) AND v6.1 phase 13 (notebook tier split). Per always-team memory: kickoff with full team analysis before v6.0.4 phase 1.
