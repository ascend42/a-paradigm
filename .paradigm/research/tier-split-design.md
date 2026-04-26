# Notebook Tier-1 / Tier-2 Split — Design Pass

**Author:** Loid (Intelligence Officer) | **Date:** 2026-04-26 | **Status:** Design draft, open calls for Architect + user
**Linked decisions:** TD-2026-04-26-284 (open-calls resolution), TD-2026-04-25-704 (sovereign notebooks), TD-2026-04-25-417 (agent-owned enforcement)

---

## Reframing — most of this already ships

Walking the code surfaced that the storage and schema substrate already exists; this design is mostly *wiring, naming, behavior, and enforcement* — not new fields.

What's already on disk and in code:

- **Two storage roots** in `packages/paradigm-mcp/src/utils/notebook-loader.ts`:
  - `~/.paradigm/notebooks/<agent>/` (global, agent-scoped, travels across projects)
  - `<project>/.paradigm/notebooks/<agent>/` (project-scoped)
- **Merge-on-read** in `loadNotebookEntries(agentId, rootDir)`: loads global first, then overlays project (project wins on id collision). When Rune is rostered on Project B, *if his global notebook has entries, he already sees them.* The "Project B can't see Project A entries" gap is therefore not a load gap — it's an **authoring gap** (entries default to project-scope) and a **discovery/calibration gap** (no promotion path, no audit).
- **Three-value `scope` enum** in `packages/paradigm-mcp/src/types/notebooks.ts`: `generalizable | project-specific | platform-specific`. Co-owned with `@a-company/agent-format` (publish contract source-of-truth).
- **`publishable: boolean`** kill switch independent of scope.
- **`classifyNotebookScope()`** auto-classifier: scans for symbol IDs, absolute paths, platform terms.
- **`paradigm_notebook_add` already accepts `scope: 'global' | 'project'`** (storage path) AND the entry carries `scope: 'generalizable' | 'project-specific' | 'platform-specific'` (publish scope). **These are two different concepts colliding on one parameter name** — first hazard to fix.

Reframing: the "tier-1 / tier-2" split is a *user-facing model layered onto existing primitives* — not a fresh schema. Work is (a) reconcile naming collision, (b) write promotion/demotion behavior, (c) add discovery surfaces (digest, audit, search-by-tier), (d) decide what happens with `platform-specific` (the third bucket the plan didn't acknowledge).

---

## 1. Schema design

### Decision: alias `tier` over the existing `scope` field — no new disk schema

| User-facing tier | Disk `scope` value | Storage location |
|---|---|---|
| **tier-1 (transferable)** | `generalizable` | `~/.paradigm/notebooks/<agent>/` |
| **tier-1-platform** (transferable, publish-restricted) | `platform-specific` | `~/.paradigm/notebooks/<agent>/` (publishes only to `@a-company`) |
| **tier-2 (project-local)** | `project-specific` | `<project>/.paradigm/notebooks/<agent>/` |

`platform-specific` is a **subtype of tier-1**, not a third tier — preserves publish-contract semantics already shipped with `@a-company/agent-format` without new value.

**Field placement:** keep `scope` at top level. Do NOT add a separate `tier:` field to disk — two sources of truth will drift. Instead:
- TS derived getter: `tierOf(entry: NotebookEntry): 'tier-1' | 'tier-1-platform' | 'tier-2'`
- MCP tools accept `tier:` as input vocabulary, translate to `scope:` on write
- YAML on disk continues `scope:` (no migration needed)

**Backward compatibility:** missing `scope:` → default to `project-specific` (tier-2). Safer than promoting silently.

**Tier-2 example:**
```yaml
id: nb-architect-monorepo-build-order
context: When planning architecture for the Paradigm monorepo
snippet: Build order: core → packages → CLI. Conductor builds independently.
scope: project-specific
publishable: false
provenance: { source: manual, createdBy: architect, originProject: a-paradigm }
confidence: 0.95
concepts: [monorepo, build-order]
```

**Tier-1 example:**
```yaml
id: nb-rune-anchor-staleness-half-life
context: When auditing aspect anchors in any project with >30 commits since last refresh
snippet: ~30 commits touching anchored files yields 70%+ stale anchors. Run weekly, not per-PR.
scope: generalizable
publishable: true
provenance: { source: manual, createdBy: rune, originProject: a-paradigm }
confidence: 0.7   # seeded; promotes to 0.85 after second-project confirmation
concepts: [anchor-staleness, half-life]
tags: [rune, transferable, calibration]
```

The meaningful difference: tier-2 names the project and is `publishable: false`; tier-1 is a meta-rule with `originProject` only as provenance.

---

## 2. Storage location

### Recommendation: Option A (already implemented) — `~/.paradigm/notebooks/<agent>/`

Loader already merges global + project on every read. Tier-1 lives global; tier-2 lives project. Project entries override global on id collision (correct precedence — local context wins).

- **Why not Option B (project-only with sync registry)?** Sync is harder than FS overlay, requires a service, reintroduces cross-machine consistency. FS overlay is durable, transparent, already works.
- **Why not Option C?** No motivating benefit; fragments storage further.

**How agent on Project B "sees" Project A's tier-1:** Already wired. Search in Project B reads `~/.paradigm/notebooks/<agent>/` (Project A's tier-1 from prior session) merged with empty Project B dir. The actual gap is (1) `paradigm_notebook_add` defaults to project-scope so candidates never escape, (2) no session-start digest surfacing inherited tier-1 entries, (3) no calibration loop recommending promotion.

---

## 3. Promotion criteria

### Recommendation: Hybrid (auto-suggest, manual confirm), with Loid as the suggestion engine

Manual-only is too slow (agents hoard local rules). Fully automatic is too dangerous (confirmation count gameable — one project, many sessions = N confirmations of a project-specific rule).

**Mechanism:**
1. **Loid calibration pass** at session-end and at `paradigm shift`. For each tier-2 entry, score:
   - `cross-project-confirmation`: distinct `originProject` values (≥2 = strong)
   - `applied-count-velocity`: applied ≥3 times across ≥2 sessions
   - `content-generality`: passes `classifyNotebookScope()` as `generalizable`
   - `confidence`: ≥0.75
2. **Promotion candidate digest** at `.paradigm/notebooks/_loid-digest.yaml`. Surfaced via `paradigm doctor` and session-start ambient pass.
3. **Manual confirm:** `paradigm_notebook_promote(entry_id, target_tier="tier-1")` (new tool — see §9 for naming hazard) or `paradigm notebook audit`.
4. **Promotion = file move + scope rewrite:** entry moves project→global, `scope` rewritten to `generalizable`, confidence recomputed (start 0.7 + corroboration boost).

**Calibration:**
- Target false-positive rate ≤15% (promoted entries reverted within 30 days)
- One-project trap: confirmed five times in one project ≠ generalizable. Require ≥2 distinct `originProject` OR explicit user-promote.
- Loid surfaces, never auto-promotes at v6.1. Auto-promote plausible at v6.2 with ≥3 projects of data.

---

## 4. Demotion / revocation

### Recommendation: anyone with write access can demote; Loid surfaces candidates; revoke is user-only

Demotion is strictly safer than promotion (silencing tier-1 is fail-closed). Lower bar.

**Triggers:**
- Owning agent: same `paradigm_notebook_promote` tool, opposite direction
- User: `paradigm notebook audit` interactive flow
- Loid auto-suggests when:
  - Override-cluster: ≥3 user-overrides on same tier-1 rule within 14 days
  - Cross-project disagreement: opposite verdicts on Projects A vs B
  - Confidence decay: not applied in 90 days AND not corroborated by cross-refs

**Mechanism:** demoted entry is *moved*, not deleted, from `~/.paradigm/notebooks/<agent>/` back to project where it last fired. Add `demotedFrom: tier-1` and `demotionReason` for audit. Re-promotion recoverable.

**Hard revocation** (malicious or wrong-by-design): `paradigm notebook revoke <id>` — user-only — appends to `~/.paradigm/notebooks/<agent>/.revoked.yaml`, filtered on load.

---

## 5. Interaction with archetype-default authority claims (TD-2026-04-26-284)

When Rune rostered on new project via archetype-default, **yes — auto-pull tier-1 notebook**. That's the entire point.

**Trust model:**
- Tier-1 lives at `~/.paradigm/notebooks/<agent>/` — user's home, under user's control. Not pulled from remote registry.
- Entries written on Project A by Rune (under user's session) carry user's implicit trust. Same trust boundary as anything else in user's home.

**Threat model:** hostile project cannot poison Rune-on-clean-project unless that hostile project ran Rune *and* user accepted writes there.
- `originProject` is informational; promotion still requires Loid's content-generality pass.
- Hostile single-project rule could try to escape via auto-classification → mitigations: (a) ≥2 distinct `originProject` confirmations required, (b) `~/.paradigm/notebooks/<agent>/.audit.log` records every promotion with timestamp/project/content-hash, (c) `paradigm notebook audit` surfaces tier-1 entries from any single project for review.
- **Residual risk:** sophisticated multi-session attacker could fake cross-project corroboration. Acceptable at v6.1; revisit if attack surface ever monetizes.

**Onboarding flow:** `paradigm shift` → nominate Rune → user accepts → `paradigm_authority_claim` writes default claims → session-start ambient pass reads `~/.paradigm/notebooks/rune/` → digest: *"Rune brought 6 transferable rules from prior projects. Review: paradigm notebook audit --tier=1"*. Effective day 1.

---

## 6. Interaction with sovereign notebooks + cross-references (TD-2026-04-25-704)

**Tier interacts orthogonally with sovereignty.** Each notebook is sovereign per agent; tier is a per-entry property within a sovereign notebook.

**Can a tier-1 entry cross-ref a tier-2 entry on a different agent's notebook?** Yes — refs are pointers, not content imports. The 5-kind taxonomy doesn't care about tier.

**But:** a tier-1 entry that depends on a tier-2 referent is a smell. Loid calibration should flag: `tier-1 entry has refs to tier-2 entry on different agent → demotion candidate OR refactor candidate`.

**When referenced entry is local-only and partner agent isn't rostered on this project — recommendation: hidden ref with sentinel** (not broken link, not silently dropped):
- Ref resolution attempts to load. If absent, surface as: `refs: [{target: nb-architect-foo, kind: builds_on, status: unresolved-this-project}]`
- Prompt-time: ref appears as `(builds_on Architect:foo — referent not in scope this project)` rather than full content
- Loid digest: counts unresolved-cross-refs per session; ≥5 unresolved on same target = nominate cross-ref refactor

Honors sovereignty (no content leak) and discoverability (ref not silently dropped). Gives Loid a learning signal — frequently-unresolved refs indicate a pattern that should be re-authored as tier-1 standalone.

---

## 7. Migration plan for existing notebooks

Walked the 6 active notebook files (4 architect + 2 reviewer) at this repo. Total entries: 6 (one per file). All carry no `scope:` field on disk; all are de-facto tier-2 by current default.

**Phase A — at v6.1 ship (zero risk):** No migration script. Loader defaults missing-`scope:` to project-specific. Documentation update only.

**Phase B — within first week post-v6.1 (Loid-driven):** `paradigm notebook audit --suggest-promotions` scans all agent notebooks across all known projects (uses `paradigm_workspace_reindex` registry). For each entry scoring high on content-generality + corroboration in ≥2 projects, surface as candidate. User reviews via interactive flow; one keystroke per entry. **Estimated yield on this repo's 6 entries: 0 promotions** — all 6 reference Paradigm internals (paradigm-mcp, monorepo build order, MCP tool budgets), which `classifyNotebookScope` correctly tags as `platform-specific`.

**Phase C — ongoing:** Loid's session-end calibration runs same logic, surfaces new candidates as corroboration accumulates.

---

## 8. Per-agent storage patterns Rune needs at v6.1 launch

### Recommendation: pre-seed all six as `confidence: 0.5–0.7` tier-1 entries with `provenance.source: 'manual'` and `provenance.createdBy: 'loid-seed'`

Pre-seeding at high confidence (≥0.85) violates trust model. Pre-seeding at zero makes them invisible. Mid-confidence is "available for use, surfaceable in search, but flagged as seed not corroborated." First wild confirmation bumps to 0.75. `loid-seed` provenance makes them auditable and revocable in bulk.

| Pattern | Pre-seed? | Confidence |
|---|---|---|
| `coverage-ratio-by-component-type` | Yes | 0.6 |
| `anchor-staleness-half-life` | Yes | 0.5 (may vary by codebase velocity) |
| `orphan-component-grace-period` | Yes | 0.7 (battle-tested in v5 ambient) |
| `directory-exception-patterns` | Yes | 0.7 (`tests/`, `scripts/` universal) |
| `aspect-suggestion-from-imports` | Yes | 0.6 |
| `override-budget-per-session` | Yes | 0.65 (self-calibration baked in) |

All six ship at `~/.paradigm/notebooks/rune/` so available across every project where Rune is rostered. Pre-installed when Rune agent installed (via `nevr.land` or `paradigm agent install`).

---

## 9. MCP tool changes

**Modify `paradigm_notebook_add`:**
- *Hazard to fix first:* existing `scope` parameter conflates storage-location (`global | project`) with publish-scope (`generalizable | project-specific | platform-specific`). Rename storage parameter to `tier: 'tier-1' | 'tier-2'`. Keep `scope` for publish-scope only.
- New optional `tier:`; when omitted, derived from auto-classification (existing behavior).
- Behavior: `tier: 'tier-1'` → write to global path AND set `scope: 'generalizable'` (or `platform-specific` if classifier flags). `tier: 'tier-2'` → project path AND `scope: 'project-specific'`.

**New `paradigm_notebook_promote(entry_id, target_tier)`:**
- **Distinct from existing `paradigm_notebook_promote`** (which promotes lore→notebook). **Rename existing to `paradigm_notebook_promote_lore`** OR name the new tool `paradigm_notebook_set_tier`. See open call #5.
- Args: `agentId`, `entryId`, `targetTier` (`tier-1 | tier-2`), optional `reason`.
- Move file + rewrite scope + audit-log append.

**Modify `paradigm_notebook_search`:** add optional `tier:` filter (`'tier-1' | 'tier-2' | 'any'`, default `any`). Surface `tier` in returned entry.

**New `paradigm_notebook_audit`:** Loid's calibration surface. Lists promotion candidates, demotion candidates, unresolved cross-refs, revoke-list. Args: `agentId?` (default all), `mode: 'promote-candidates' | 'demote-candidates' | 'unresolved-refs' | 'all'`. Read-only.

**New `paradigm_notebook_revoke(entry_id)`:** Hard-removes from active set; appends to `.revoked.yaml`. User-only (gate via authority/permission).

**Schema sync obligation:** `@a-company/agent-format` is publish-contract source-of-truth. Adding `tier` as derived (no new disk field) means **no agent-format change needed**. If we later add `demotedFrom:` and `demotionReason:`, those *are* schema additions and must PR to agent-format in lockstep with v6.1.

---

## 10. Open calls for Architect + user

1. **Naming reconciliation — Architect.** Recommend `tier-1`/`tier-2` user-facing, `scope` (generalizable/project-specific/platform-specific) preserved as publish-contract. Confirm we don't deprecate `scope` from agent-format. Alternative: one vocabulary throughout = bigger migration surface.
2. **`platform-specific` as tier-1 subtype — Architect.** Treats it as "tier-1 with publish-restriction" rather than third tier. Confirm or surface `tier-1-platform` as own tier in CLI/MCP responses.
3. **Promotion threshold — user.** Recommend ≥2 distinct `originProject` + content-generality + applied ≥3 + confidence ≥0.75. Stricter is safer; looser is faster. Which side of the dial?
4. **Pre-seeding Rune's six patterns — user.** Recommend confidence 0.5–0.7, `provenance.createdBy: 'loid-seed'`. Confirm before v6.1 ship.
5. **Tool-name collision — Architect + user.** `paradigm_notebook_promote` is already taken (lore→notebook). Rename existing to `_promote_lore` (breaking MCP change) OR name new tool `_set_tier` (loses promote/demote symmetry). I lean `_set_tier`.
6. **Hidden-ref policy — Architect.** §6 recommends hidden-ref-with-sentinel for unresolved cross-refs. Confirm matches v6.1 cross-refs primitive's existing resolution model.
7. **Revocation gate — user.** Recommend `paradigm notebook revoke` user-only, not agent-callable. A miscalibrated agent shouldn't silence its own evidence trail.
8. **Audit log location — user.** Recommend `~/.paradigm/notebooks/<agent>/.audit.log` (per-agent) over `~/.paradigm/audit.log` (global).

---

## Summary

- **Schema:** No new disk field. Reuse existing `scope` enum; add derived `tier` getter mapping `generalizable + platform-specific → tier-1`, `project-specific → tier-2`. MCP tools accept `tier:` as input vocabulary.
- **Storage:** Already implemented. `~/.paradigm/notebooks/<agent>/` for tier-1, `<project>/.paradigm/notebooks/<agent>/` for tier-2. Loader merges on read (project overrides global on id collision). **No new sync infrastructure needed.**
- **Promotion:** Hybrid — Loid auto-suggests via cross-project confirmation (≥2 distinct projects), content-generality, applied-count, confidence. Owning agent or user manually confirms. No silent auto-promote at v6.1.
- **Biggest open question:** tool-name collision — `paradigm_notebook_promote` is taken by the lore→notebook tool. Rename existing (breaking MCP change) or use a different verb (`set_tier`, loses symmetry). Architect + user call before implementation.

**Surprise to flag up:** most of the substrate already shipped — v6.1 work is wiring + naming + behavior + Loid's calibration loop, not "build a new tier system." Likely fits in a single sprint rather than a phase.
