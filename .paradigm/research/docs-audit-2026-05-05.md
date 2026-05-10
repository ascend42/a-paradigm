# Docs Quality Audit — 2026-05-05

**Agent:** SCHOLAR | **Mode:** Diagnosis only — no file edits
**Scope:** All user-facing Paradigm documentation
**Paradigm version audited against:** v6.3.0 (released 2026-05-04)

---

## Executive Summary

The documentation surface has accumulated significant drift across two dimensions:

1. **The `paradigm init` → `paradigm shift` rename** was fixed in quick-start.md and mcp-setup.md (F-03, v6.2.1) but left unpatched in at least 6 other files: `docs/README.md`, `docs/commands/index.md`, `docs/commands/sync.md`, `docs/commands/doctor.md`, `docs/commands/beacon.md`, and `docs/commands/constellation.md`.

2. **The plugin README** carries a materially false claim about Stop hook behavior (says it "Blocks" on missing .purpose; the v6.3.0 enforcement default is `none` — all checks off). The plugin README is the primary onboarding surface for Claude Code users, making this the highest-priority correction.

Secondary gaps: tool counts are wrong in the plugin README (sentinel, lore), 10 skills are absent from the plugin README skills table, and the agents roster is stale in both the plugin README and mcp-setup.md (missing documentor, ftux/Nora, Cid; missing Atlas and North entirely from most surfaces).

---

## Per-Document Findings

### 1. `README.md` (root)

**File:** `/Users/ascend/Documents/GitHub/a-paradigm/README.md`

| Issue | Location | Severity |
|-------|----------|----------|
| "8 specialist agents" listed but Loid (forge/intelligence-officer) is absent from the list at line 286. Only architect, builder, reviewer, tester, security, documentor, ftux, captain/Cid are enumerated. | Line 286 | P1 |
| Atlas and North (added v6.2.0–v6.2.1) absent from the agents section entirely. | Lines 283–292 | P1 |
| `paradigm shift` is the canonical setup command and is correctly used in examples (line 353 area) — the F-03 fix did reach this file's primary workflow. | — | OK |
| `paradigm presets`, `paradigm scan auto`, `paradigm migrate` all referenced at lines 353–357 — verified real commands. | Lines 353–357 | OK |

**Overall:** Accurate except for stale/incomplete agent roster. No blocking inaccuracies.

---

### 2. `docs/README.md`

**File:** `/Users/ascend/Documents/GitHub/a-paradigm/docs/README.md`

| Issue | Location | Severity |
|-------|----------|----------|
| `paradigm init` listed as the primary setup command in the command reference table. | Line 58 | P0 |
| Workflow example uses `paradigm init --quick` for "New Project Setup". | Line 71 | P0 |
| "Run the setup, then read `paradigm init`" — `paradigm init` as discovery entry point. | Line 40 | P0 |
| `paradigm init` listed first in the intro paragraph. | Line 14 | P0 |

**Overall:** Four locations still carrying the legacy command name. This is the gap the F-03 fix (v6.2.1) explicitly left unpatched — the changelog entry confirms it only updated `docs/guides/quick-start.md` and `docs/guides/mcp-setup.md`.

**Fix needed:** Replace all four `paradigm init` / `paradigm init --quick` occurrences with `paradigm shift` / `paradigm shift --quick`.

---

### 3. `docs/guides/quick-start.md`

**File:** `/Users/ascend/Documents/GitHub/a-paradigm/docs/guides/quick-start.md`

| Issue | Location | Severity |
|-------|----------|----------|
| Step-by-step section runs `paradigm shift --quick` at step 2 (which subsumes sync), then `paradigm sync --all` again at step 3. The redundancy is confusing even if technically harmless. | Lines 39–41 | P2 |
| `paradigm thread save` in key commands table — verified real command. | Line 124 | OK |
| `paradigm echo ERROR_CODE` in key commands table — verified real command. | Line 125 | OK |
| `paradigm watch` in maintenance table — verified real command. | Line 134 | OK |
| F-03 fix applied correctly — `paradigm shift` used throughout. | — | OK |

**Overall:** Minor copy issue (redundant sync step). Factually accurate.

---

### 4. `docs/guides/mcp-setup.md`

**File:** `/Users/ascend/Documents/GitHub/a-paradigm/docs/guides/mcp-setup.md`

| Issue | Location | Severity |
|-------|----------|----------|
| "Last Updated: 2026-04-07" predates the entire v6.0 surface (v6.0 released significantly later). The date is misleading but the content was partially patched (F-03). | Line 555 | P2 |
| Available Tools table lists only 5 tools: `paradigm_search`, `paradigm_ripple`, `paradigm_related`, `paradigm_status`, `paradigm_gates_for_route`. Does not reflect the 181-tool MCP surface — arch, compliance_promote, authority_claim/release, propose_block, notebook, lore, journal, history, and many others are absent. | Lines 349–353 | P1 |
| "Agent Workflow Protocol" table mentions `paradigm_navigate` and `paradigm_session_health` — these are accurate MCP tools but not in the "Available Tools" table above it (creates internal inconsistency). | Lines 358–365 | P1 |
| Plugin agents table lists only 5 agents: architect, builder, reviewer, tester, security. Documentor, ftux/Nora, and captain/Cid are absent. | Line 176 | P1 |
| F-03 fix applied — `paradigm shift` used in all examples. | — | OK |

**Overall:** Tools inventory section is a frozen snapshot from an early v5 era. Not blocking (users won't be misled into unsafe behavior), but the gap between "5 tools listed" and the 181-tool reality is substantial.

---

### 5. `docs/guides/agents.md`

**File:** `/Users/ascend/Documents/GitHub/a-paradigm/docs/guides/agents.md`

| Issue | Location | Severity |
|-------|----------|----------|
| "six core agents...plus three specialty" framing — inconsistent with README's "8 specialist agents" and the shipped roster (8 core + multiple specialty). | Line 27 | P1 |
| Loid correctly identified as "intelligence officer (Loid)" — accurate. | Line 46 | OK |
| Atlas (cartographer) added in v6.2.0, North added in v6.2.1 — neither appears anywhere in the guide. | Full doc | P1 |
| Rune's promotion state machine (v6.3.0) not mentioned. | Full doc | P1 |
| `paradigm_agent_prompt` enum values match source (advocate, architect, builder, compliance, ftux, tester, reviewer, security, documentor). | Line 219 | OK |
| Framework-bug protocol section (§12) accurate for v6.0.5+. | §12 | OK |
| Partners section (§11) accurately reflects v6.0.3 shipped state. | §11 | OK |
| Agent lifecycle commands (`paradigm agent create`, `paradigm agent bench`, `paradigm agent activate`) — need to verify against shipped surface. | Various | Flagged |

**Overall:** Core content accurate; agent roster section stale by 2–3 releases. No blocking inaccuracies.

---

### 6. `docs/guides/v6-migration.md`

**File:** `/Users/ascend/Documents/GitHub/a-paradigm/docs/guides/v6-migration.md`

| Issue | Location | Severity |
|-------|----------|----------|
| Covers only v5.x → v6.0 breaking changes (6 items). No coverage of post-v6.0 changes. | Full doc | P1 |
| v6.0.5 path-bug fix not mentioned (was a significant behavioral correction). | — | P1 |
| v6.1 soft-blocks / `paradigm override` not mentioned — new user-visible behavior introduced. | — | P1 |
| v6.2 Atlas/arch.yaml — new agent and new artifact type, no mention. | — | P2 |
| v6.3 enforcement default change `minimal` → `none` not mentioned — this is a breaking behavior change for anyone who relied on the previous default enforcement level. | — | P0 |
| The 6 items that ARE covered (for v6.0) appear accurate and well-explained. | — | OK |

**Overall:** The v6.3 default enforcement change is a P0 gap here — a user upgrading from v6.2 to v6.3 has no migration note explaining that enforcement behavior changed.

---

### 7. `docs/guides/decisions.md`

**File:** `/Users/ascend/Documents/GitHub/a-paradigm/docs/guides/decisions.md`

| Issue | Location | Severity |
|-------|----------|----------|
| §5 notes correctly that `paradigm decision record` CLI doesn't exist yet and flags it as a likely v6.x addition. | §5 | OK |
| Decision store format accurate for v6.0. | — | OK |
| No significant inaccuracies found. | — | OK |

**Overall:** Clean. No action needed.

---

### 8. `docs/guides/university.md`

**File:** `/Users/ascend/Documents/GitHub/a-paradigm/docs/guides/university.md`

| Issue | Location | Severity |
|-------|----------|----------|
| §9.2 references "v6.3 (~Q3 2026) sunset contract" — v6.3.0 has now shipped (2026-05-04), so "~Q3 2026" is past-tense. The sunset decision contract logic is still valid, but the phrasing implies it hasn't happened yet. | §9.2 | P2 |
| §10.3 contains a portal/loadPortalConfigLegacy removal note that is explicitly acknowledged as "unrelated to University content." This section creates confusion about what guide this is. | §10.3 | P2 |
| Tool list (§8) matches the 7 university MCP tools registered. | §8 | OK |
| Multi-tenant framework documentation is accurate. | — | OK |

**Overall:** Minor staleness on the v6.3 reference. No blocking inaccuracies.

---

### 9. `docs/guides/symphony-quickstart.md`

**File:** `/Users/ascend/Documents/GitHub/a-paradigm/docs/guides/symphony-quickstart.md`

| Issue | Location | Severity |
|-------|----------|----------|
| "Paradigm CLI v3.35.0+" — dramatically stale. Current version is 6.3.0; Symphony Phase 1 shipped in v3.46.0, which itself predates v4, v5, and v6 entirely. The minimum version claim is confusingly ancient. | Line 5 | P1 |
| "Coming Soon: nevr.land Relay" section still present — this is a planned future feature; the wording "Coming Soon" may mislead users on what's available today. | Dedicated section | P1 |
| Symphony command examples and tool descriptions appear to reflect the shipped Phase 1 surface accurately. | — | OK |

**Overall:** Version reference is stale; "Coming Soon" section needs a caveat or removal. No blocking inaccuracies for shipped functionality.

---

### 10. `docs/guides/sentinel-upgrade.md`

**File:** `/Users/ascend/Documents/GitHub/a-paradigm/docs/guides/sentinel-upgrade.md`

| Issue | Location | Severity |
|-------|----------|----------|
| The guide covers upgrade procedures for specific named projects: a-star, a-kamiki, a-badgermole, a-pretend, leadsync-dash. This is an internal migration runbook, not a general user guide. | Full doc | P1 |
| Placed in `docs/guides/` alongside quick-start.md and agents.md — suggests it is a general user guide when it is not. | File placement | P1 |
| Content within its scope (per-project migration instructions) appears accurate for those specific projects at the time of writing. | — | — |

**Overall:** Miscategorized content. Should be moved to `docs/private/` or given a clear "internal runbook" header to avoid misleading new users browsing the guides directory.

---

### 11. `docs/commands/index.md`

**File:** `/Users/ascend/Documents/GitHub/a-paradigm/docs/commands/index.md`

| Issue | Location | Severity |
|-------|----------|----------|
| Workflow example uses `paradigm init --quick` in the "Getting Started" flow. | Line 127 | P0 |
| Second workflow example also uses `paradigm init --quick`. | Line 146 | P0 |
| `paradigm probe` commands referenced — verified `probe` is a real command (directory exists in src/commands/). | Bottom of doc | OK |

**Overall:** Two P0 legacy command references. Otherwise accurate.

---

### 12. `docs/commands/sync.md`

**File:** `/Users/ascend/Documents/GitHub/a-paradigm/docs/commands/sync.md`

| Issue | Location | Severity |
|-------|----------|----------|
| Troubleshooting entry for "No .paradigm/ directory found" says "Run `paradigm init` first." | Line 265 | P0 |

**Overall:** Single P0 fix needed in troubleshooting section.

---

### 13. `docs/commands/doctor.md`

**File:** `/Users/ascend/Documents/GitHub/a-paradigm/docs/commands/doctor.md`

| Issue | Location | Severity |
|-------|----------|----------|
| Lines 165–166 use `paradigm init --quick` in example workflows. | Lines 165–166 | P0 |
| Troubleshooting entry says "Run `paradigm init`" — should be `paradigm shift`. | Line 325 | P0 |

**Overall:** Two P0 legacy command references.

---

### 14. `docs/commands/beacon.md`

**File:** `/Users/ascend/Documents/GitHub/a-paradigm/docs/commands/beacon.md`

| Issue | Location | Severity |
|-------|----------|----------|
| References `paradigm init --quick` in examples/workflows. | Lines 172, 264, 300, 321 | P0 |

**Overall:** Four P0 legacy command references.

---

### 15. `docs/commands/constellation.md`

**File:** `/Users/ascend/Documents/GitHub/a-paradigm/docs/commands/constellation.md`

| Issue | Location | Severity |
|-------|----------|----------|
| Uses legacy `paradigm init` pattern in workflow examples. | First 50 lines confirmed | P0 |

**Overall:** Legacy command references present (exact line count not fully audited, but pattern confirmed).

---

### 16. `docs/commands/ripple.md`

**File:** `/Users/ascend/Documents/GitHub/a-paradigm/docs/commands/ripple.md`

No significant inaccuracies found. Ripple command documentation appears accurate for the shipped surface.

---

### 17. `plugins/paradigm/README.md`

**File:** `/Users/ascend/Documents/GitHub/a-paradigm/plugins/paradigm/README.md`

This is the **primary onboarding surface** for Claude Code plugin users. Inaccuracies here have the highest impact.

| Issue | Location | Severity |
|-------|----------|----------|
| Stop hook description: "**Blocks** if source files modified without .purpose updates, missing portal.yaml, no lore entry." — **THIS IS FALSE** for v6.3.0 where the enforcement default is `none` (all 13 checks off). A new user will be confused when the hook does not block as advertised. | Line 21 | **P0** |
| Sentinel tool count: "Sentinel `(8 tools)`" — actual: 15 tools registered in `packages/paradigm-mcp/src/tools/sentinel.ts`. | Line 35 | P1 |
| Lore tool count: "Lore `(3 tools)`" — actual: 8 tools registered in `packages/paradigm-mcp/src/tools/lore.ts` (`paradigm_lore_search`, `paradigm_lore_record`, `paradigm_lore_timeline`, `paradigm_lore_get`, `paradigm_lore_update`, `paradigm_lore_assess`, `paradigm_lore_calibration`, `paradigm_lore_delete`). | Line 39 | P1 |
| Skills table lists 8 skills — actual: 18 skills in `plugins/paradigm/skills/`. Missing: agents, conduct, handoff, health, observe, protocol, review, ripple, teach, team. | Lines 49–56 | P1 |
| Agents table lists 5 agents (architect, builder, tester, reviewer, security) — missing from core roster: documentor, ftux/Nora, captain/Cid. | Lines 60–66 | P1 |
| Lines 73 and 103: "`/paradigm:init` or `/paradigm:shift`" — both presented as equal-weight alternatives, but `paradigm:init` (the old command) should not be promoted alongside `paradigm:shift`. | Lines 73, 103 | P1 |
| Purpose+portal tools listed as "13 tools" — verified: 13 tools in `purpose-portal.ts` (11 purpose_* + 2 portal_*). This count is accurate. | Lines 42–43 | OK |

**Overall:** The Stop hook claim is a blocking inaccuracy for any new user trying to understand enforcement behavior. The tool counts and skills table are materially incomplete.

---

## Prioritized Triage

### P0 — Blocking Inaccuracies (fix before next release)

| ID | File | Location | Issue |
|----|------|----------|-------|
| P0-01 | `plugins/paradigm/README.md` | Line 21 | Stop hook described as blocking by default; v6.3.0 enforcement default is `none` (all checks off). Misrepresents core feature behavior to plugin users. |
| P0-02 | `docs/README.md` | Lines 14, 40, 58, 71 | Four occurrences of `paradigm init` / `paradigm init --quick` as the setup command. Left unpatched by F-03 fix. |
| P0-03 | `docs/commands/index.md` | Lines 127, 146 | `paradigm init --quick` in workflow examples. |
| P0-04 | `docs/commands/sync.md` | Line 265 | Troubleshooting says "Run `paradigm init` first". |
| P0-05 | `docs/commands/doctor.md` | Lines 165–166, 325 | `paradigm init --quick` in examples; "Run `paradigm init`" in troubleshooting. |
| P0-06 | `docs/commands/beacon.md` | Lines 172, 264, 300, 321 | Four occurrences of `paradigm init --quick`. |
| P0-07 | `docs/commands/constellation.md` | Multiple | `paradigm init` pattern in workflow examples. |
| P0-08 | `docs/guides/v6-migration.md` | Full doc | v6.3 enforcement default change (`minimal` → `none`) is a behavioral breaking change with no migration note. Users upgrading from v6.2 are not informed. |

### P1 — Medium Gaps (fix in next maintenance pass)

| ID | File | Location | Issue |
|----|------|----------|-------|
| P1-01 | `plugins/paradigm/README.md` | Line 35 | Sentinel tools count: says 8, actual 15. |
| P1-02 | `plugins/paradigm/README.md` | Line 39 | Lore tools count: says 3, actual 8. |
| P1-03 | `plugins/paradigm/README.md` | Lines 49–56 | Skills table missing 10 of 18 skills. |
| P1-04 | `plugins/paradigm/README.md` | Lines 60–66 | Agents table missing documentor, ftux/Nora, captain/Cid. |
| P1-05 | `plugins/paradigm/README.md` | Lines 73, 103 | `/paradigm:init` promoted alongside `/paradigm:shift` — should de-emphasize or remove init alias. |
| P1-06 | `docs/guides/mcp-setup.md` | Lines 349–353 | Tools table lists 5 tools from a much earlier MCP surface; 180+ tools in current MCP server. |
| P1-07 | `docs/guides/mcp-setup.md` | Line 176 | Plugin agents table missing documentor, ftux, Cid. |
| P1-08 | `docs/guides/agents.md` | Line 27 | "Six core agents...plus three specialty" framing inconsistent with shipped roster and other docs. |
| P1-09 | `docs/guides/agents.md` | Full doc | Atlas (v6.2.0) and North (v6.2.1) not mentioned anywhere in the agents guide. |
| P1-10 | `docs/guides/agents.md` | Full doc | Rune promotion state machine (v6.3.0) not mentioned. |
| P1-11 | `README.md` | Lines 283–292 | Loid absent from "8 specialist agents" enumeration; Atlas and North absent entirely. |
| P1-12 | `docs/guides/v6-migration.md` | Full doc | No coverage of v6.0.5, v6.1, v6.2, v6.3 changes in a file titled v6-migration. |
| P1-13 | `docs/guides/symphony-quickstart.md` | Line 5 | "Paradigm CLI v3.35.0+" — dramatically stale version floor (current: 6.3.0). |
| P1-14 | `docs/guides/symphony-quickstart.md` | Dedicated section | "Coming Soon: nevr.land Relay" — should indicate roadmap status clearly. |
| P1-15 | `docs/guides/sentinel-upgrade.md` | Full doc | Internal project-specific runbook misplaced in general user guides directory. |

### P2 — Minor Polish

| ID | File | Location | Issue |
|----|------|----------|-------|
| P2-01 | `docs/guides/quick-start.md` | Lines 39–41 | Step 3 (`paradigm sync --all`) is redundant when step 2 (`paradigm shift --quick`) already runs sync. |
| P2-02 | `docs/guides/mcp-setup.md` | Line 555 | "Last Updated: 2026-04-07" — predates significant surface changes. Date should reflect last meaningful content update. |
| P2-03 | `docs/guides/university.md` | §9.2 | "v6.3 (~Q3 2026)" phrasing — v6.3.0 has shipped; the parenthetical is now past-tense. |
| P2-04 | `docs/guides/university.md` | §10.3 | Portal/loadPortalConfigLegacy removal note in the University guide creates context confusion (explicitly acknowledged in text, but still disorienting). |

---

## Source Verification Notes

All tool counts were verified against source files directly:

- `packages/paradigm-mcp/src/tools/sentinel.ts` — 15 tools (triage, show, resolve, patterns, add_pattern, record, stats, suggest_pattern, logs, services, app_state, validate_symbol, flow_activity, metrics, traces)
- `packages/paradigm-mcp/src/tools/lore.ts` — 8 tools (search, record, timeline, get, update, assess, calibration, delete)
- `packages/paradigm-mcp/src/tools/purpose-portal.ts` — 13 tools (11 purpose_* + 2 portal_*)
- `plugins/paradigm/skills/` — 18 skills (init, shift, scan, status, ripple, search, observe + agents, conduct, handoff, health, protocol, review, teach, team, and others)
- `packages/paradigm/src/index.ts` — confirms `presets`, `probe`, `migrate`, `scan` (with subcommands) are real registered commands

F-03 fix scope confirmed via `CHANGELOG.md` entry for v6.2.1: only `docs/guides/quick-start.md` (6 locations) and `docs/guides/mcp-setup.md` (1 location) were patched. All other `paradigm init` occurrences are genuine gaps.

---

## Scope Not Audited

The following were not in scope for this pass:

- `docs/commands/` files beyond index, sync, doctor, beacon, ripple, constellation (shift, lore, university, etc.)
- `docs/private/` (internal plans — not user-facing)
- Inline CLAUDE.md / `.paradigm/specs/` content (agent-facing, not user-facing in the same way)
- `packages/*/README.md` internal package docs

A follow-up shallow pass on remaining `docs/commands/*.md` files would likely surface additional P0 `paradigm init` occurrences given the pattern is widespread.

---

```yaml
# Agent Relay
status: success
summary: >
  Docs audit complete. 8 P0 blocking inaccuracies identified across 7 files.
  Highest priority: plugin README Stop hook claim is materially false under
  v6.3.0 none enforcement default (P0-01). Second cluster: `paradigm init`
  legacy command persists in docs/README.md and 5 commands docs pages despite
  F-03 fix targeting only quick-start.md and mcp-setup.md. v6-migration.md
  has no coverage of v6.3 enforcement behavior change (P0-08). 15 P1 gaps
  and 4 P2 polish items. Diagnosis only — no file edits made.
decisions:
  - P0-01 is the single highest-impact fix: plugin README line 21 Stop hook
    description. One sentence change, high reach (every Claude Code onboarder
    reads this).
  - P0-02 through P0-07 are mechanical find-replace: `paradigm init --quick`
    → `paradigm shift` / `paradigm shift --quick`. Six files, ~12 occurrences
    total. Low risk, high correctness gain.
  - P0-08 (v6-migration.md) requires a new section, not just a line replacement.
    Scope: one new h2 covering v6.1–v6.3 behavioral changes.
  - P1 items (plugin README tool counts, skills table, agents table) require
    fresh inventory; counts should be auto-generated or linked-to-source if
    possible to prevent future drift.
  - sentinel-upgrade.md (P1-15) should be relocated from docs/guides/ to
    docs/private/ to avoid confusing new users.
handoff_to: reviewer
handoff_context: >
  Research brief covers all user-facing docs. Findings are diagnosis only.
  Reviewer should decide: (a) which P0 items to fix in the next commit,
  (b) whether to delegate the plugin README update to the plugin maintainer
  or handle inline, (c) whether the v6-migration.md P0-08 gap warrants an
  emergency patch or can wait for a v6.3.1 docs release.
  All citations include file:line. No edits have been made to any source file.
```
