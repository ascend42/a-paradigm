# Bundle A Review — `LoreType.decision` hard-removal (v6.0)

**Reviewer:** reviewer (paradigm)
**Date:** 2026-04-22
**Scope:** Bundle A only — enum sweep, structured rejection envelope, v1→v2 migration shims, UI parity, new tests
**Lore-criticality posture:** extra rigor per `feedback_lore_is_critical.md`

---

## Stage 1 — Compliance

| Check | Result | Evidence |
|---|---|---|
| 4-site enum sweep | PASS with caveat | `LoreType` definitions in `packages/paradigm-mcp/src/utils/lore-loader.ts:48`, `packages/paradigm/src/core/lore/types.ts:30`, `packages/paradigm/lore-ui/src/store/loreStore.ts:5`, `packages/paradigm/platform-ui/src/sections/lore/store/loreStore.ts:5` — all four exclude `'decision'`. Tool-surface `enum` arrays in `lore.ts` (3 sites: lines 106, 167, 342) all sanitised. **Caveat:** `assessment.ts` lines 71 & 113 still list `'decision'` (see Finding F-1 below). |
| Bundle B (`loadPortalConfigLegacy`) untouched | PASS | grep returned no matches in modified working tree under `packages/paradigm/src/core/portal/` (no portal loader files modified at all). |
| Bundle C (PLSAT / `--delete-sources`) untouched | PASS | university-related files appear in PLSAT grep (existing references), but none are in the modified-files list. No `--delete-sources` invocation added. |
| Bundle D (server comments) untouched | PASS | no server-comment file modifications. |
| Bundle E (versions / CHANGELOG) untouched | PASS | `git diff -- '*package.json' '*plugin.json' '*CHANGELOG.md'` returned no diff content. |
| `.purpose` updates | PARTIAL — see Finding I-1 | `packages/paradigm-mcp/src/tools/.purpose` and `packages/paradigm/src/core/lore/.purpose` were NOT updated even though `tools/lore.ts` and `core/lore/types.ts` had material behavior changes (rejection envelope, type removal). |
| No `console.log` in modified library code | PASS | grep on `lore.ts` returned zero `console.*` matches; structured `log.component('#lore').warn(...)` used correctly. |
| No version bumps in working tree | PASS | confirmed no diff in any `package.json` / `plugin.json` / `CHANGELOG.md`. |

**Stage 1 verdict:** **pass with two non-blocking gaps** (F-1 missed `assessment.ts` enum; I-1 missing `.purpose` updates).

---

## Stage 2 — Quality + lore-criticality

### A. Structured rejection envelope correctness

**Envelope shape grid** (from `packages/paradigm-mcp/src/tools/lore.ts:556-571`):

| Field | Spec | Actual | Status |
|---|---|---|---|
| `code` | `'lore_type_decision_removed'` literal | `'lore_type_decision_removed'` | OK |
| `successor_tool` field | `'paradigm_decision_record'` literal | `'paradigm_decision_record'` | OK |
| `successor_tool` in `message` body | LLM should find via either parse strategy | message contains "Use paradigm_decision_record instead." + "paradigm_lore_record({type:'insight'..." | OK |
| `removed_in` | `'6.0.0'` literal | `'6.0.0'` | OK |
| `doc` field | points at real file | `'docs/private/plans/v6.0-decisions-locked.md'` — verified exists, 146 lines, contains "## D3" section at line 27 | OK |
| Returns envelope, no throws | no zod-bare error path | `return rejectionErr({...})` short-circuits before any IO; no `throw` on this path | OK |
| Handler signature matches sibling tools | `{ handled: true, text: JSON.stringify({error: env}) }` | matches `assessment.ts:265,277,285,296` and `personas.ts:455,503` convention exactly | OK |

The envelope is well-formed, structurally redundant (LLM agents can recover the successor tool from either field-name parse or substring match in `message`), and the `code` is a stable machine identifier. The `rejectionErr` helper (lines 41-46) is a clean abstraction that keeps the call site readable.

### B. Companion-lore pattern preserved (CRITICAL)

| Check | Status | Evidence |
|---|---|---|
| `writeCompanionLoreEntry` call in `streams.ts` unchanged | OK | `packages/paradigm-mcp/src/tools/streams.ts:329` still invokes `writeCompanionLoreEntry(ctx.rootDir, entry.id)` after `recordDecision`; the surrounding "v6.0 (D3 locked)" comment is intact. |
| `writeCompanionLoreEntry` writes `type: 'insight'` | OK | `packages/paradigm-mcp/src/utils/decision-loader.ts:151` hard-codes `type: 'insight'` — no change. |
| `references.decision_id` linkage | OK | `decision-loader.ts:157-159` sets `references.decision_id` correctly. |
| `decision-migration.test.ts` line ~210 test intact | OK | Test "writeCompanionLoreEntry writes a lore insight referencing the decision" present at line 210, asserts `body.type === 'insight'` (line 236) and `body.references.decision_id === decision.id` (237). |
| Test passing | OK | full `decision-migration.test.ts` run: **6/6 pass** (107ms). |

The companion-lore bridge (the load-bearing piece for lore-completeness post-removal) is **fully intact**. This is the highest-value preservation check and it cleared.

### C. Migration shim audit (lore-criticality)

Three shim sites inspected. Each remaps legacy on-disk `type:'decision'` → `'insight'` on read. Per-site analysis:

#### C-1. `packages/paradigm-mcp/src/utils/lore-loader.ts:530-541`

```ts
const oldType = String(raw.type || 'agent-session');
const v2Type = oldType === 'decision'
  ? 'insight'
  : (['agent-session', 'human-note', 'review', 'incident', 'milestone', 'insight'].includes(oldType)
    ? oldType
    : 'agent-session');
```

- **Trigger:** any v1 entry without `version: '2'` field; only fires inside `migrateLegacyEntries` (one-shot during lore migration, not on every load — context: this function is gated by the legacy-file presence check higher in the file, not part of the hot read path).
- **Preserves:** title, summary, symbols, dates, IDs.
- **Loses:** the original `type: 'decision'` is silently overwritten — **no audit trail** that the entry was once a decision. No tag like `v6-migrated:from-decision` is added; no log line is emitted; no field in the new entry records the prior type.
- **Forensic recovery:** none. After migration, a user looking for "what were my old decisions?" has no way to distinguish them from organic insights.

#### C-2. `packages/paradigm/src/core/lore/storage.ts:587-599`

Identical logic to C-1, identical preservation/loss profile. Same forensic-recovery gap.

#### C-3. `packages/paradigm/src/commands/lore/migrate-assessments.ts:71-75`

```ts
const remappedType: LoreType = (assessment.type as string) === 'decision'
  ? 'insight'
  : (assessment.type as LoreType);
```

- **Trigger:** runs only via the `paradigm migrate-assessments` CLI command (one-shot, user-initiated).
- **Preserves:** the comment claims "The original type is retained in the assessment:* tag" — and inspecting the surrounding code (line 65: `'assessment:' + assessment.type` is added to tags), this is **partially true**: a tag like `assessment:decision` is added. So forensic recovery here is possible via tag search.
- **Loses:** less than the other two sites because of the assessment tag.
- **Asymmetry:** This is the only site with forensic preservation. Sites C-1 and C-2 should adopt the same pattern (add a `migrated:from-decision` tag or equivalent).

**Failure-mode answer (50 v5.x decision entries on a v6.0 upgrade):** YES, all 50 will transparently load as `insight`. With current shims, the user cannot distinguish "originally a decision" from "organic insight" except for entries that flowed through `migrate-assessments` (which has the `assessment:decision` tag). This is the **largest lore-criticality concern** in the bundle. See Finding F-2.

### D. UI parity

| Surface | Status |
|---|---|
| `lore-ui/src/components/FilterBar.tsx` `ENTRY_TYPES` | drops `'decision'` — verified |
| `platform-ui/src/sections/lore/components/FilterBar.tsx` `ENTRY_TYPES` | drops `'decision'` — verified |
| `lore-ui/src/store/loreStore.ts` `LoreType` | drops `'decision'` — verified |
| `platform-ui/src/sections/lore/store/loreStore.ts` `LoreType` | drops `'decision'` — verified |
| Other UI surfaces (badges, dropdowns, type pills) | grep across `lore-ui/src/**` and `platform-ui/src/sections/lore/**` shows the only remaining `'decision'` references are: (a) `KnowledgeStream` type union with `'decision'` (different domain — stream classification, NOT LoreType) at `loreStore.ts:36` in both UIs. These are CORRECT and should NOT be touched. No badge/pill/dropdown surfaces missed. |

UI parity is **clean and complete**.

### E. Test coverage

`packages/paradigm-mcp/tests/lore.test.ts` — 3 new tests, all passing (186ms total):

| Test | What it asserts | Quality |
|---|---|---|
| "returns a structured rejection envelope (no throw)" | `result.handled === true`, `error.code`, literal `successor_tool`, message contains `paradigm_decision_record`, `removed_in: '6.0.0'` | strong — both field-parse and substring-parse paths covered |
| "does not write a lore entry on the rejection path" | `.paradigm/lore/entries` dir does NOT exist after rejection | strong — confirms no partial state |
| "rejection path is independent of decision_record's companion-lore writer" | `successor_tool` literal === `'paradigm_decision_record'` | wiring contract — catches future renames |

Pre-existing test failures spot-check:
- `paradigm-mcp` failure baseline: **10 failures, 208 passed** — matches handoff claim. Sample failure: `tool-registry.test.ts:270` ("dispatches to correct handler") — unrelated to lore (tool-registry dispatch infrastructure).
- `paradigm` CLI failure baseline: **7 failures, 245 passed** — matches handoff claim. Sample failure: `hooks/index.test.ts:223` (hook content assertion) — unrelated to lore.

Failure baseline is **unchanged and not lore-related**.

### F. Error message quality (LLM-UX)

Reading the rejection message body cold:

> "lore type 'decision' was removed in v6.0. Use paradigm_decision_record instead. The decision will be stored in .paradigm/decisions/ and a companion lore insight entry (type:'insight' with references.decision_id) will be written automatically so the timeline stays complete. For narrative-only references, use paradigm_lore_record({type:'insight', references:{decision_id}})."

| Question | Answer |
|---|---|
| WHAT happened? | Yes — "removed in v6.0" |
| WHAT to do? | Yes — "Use paradigm_decision_record" |
| WHAT happens if you do? | Yes — "stored in .paradigm/decisions/ and a companion lore insight entry … will be written" |
| Token budget < 200? | Yes — message body is ~85 tokens; full envelope JSON ≤ ~140 tokens. Well within budget. |
| Includes fallback for narrative-only case? | Yes — explicit `type:'insight', references:{decision_id}` snippet |

Message quality is **excellent**. This is migration UX done right.

### G. Risk: legacy-entry read storm

Audit: `migrateLegacyEntries` in both `lore-loader.ts` and `storage.ts` is invoked from a one-shot migration entry point, not from the per-session lore read path. The hot read path (`loadLoreEntries`) reads pre-migrated v2 entries directly. So the shim cost is **paid once at upgrade time**, not per session.

The shim itself is O(n) with cheap string comparison and array `.includes` over a tiny constant set. No observable per-load overhead.

**Risk: minimal.** Only concern would be if `migrateLegacyEntries` somehow gets re-invoked on already-migrated entries — current code structure does not appear to do that, but a defensive idempotency check (skip if `version === '2'`) is the standard safety belt and worth confirming.

---

## Findings (4)

### F-1. **blocking** — `assessment.ts` enum still lists `'decision'`

`packages/paradigm-mcp/src/tools/assessment.ts:71` and `:113` still have `enum: ['retro', 'insight', 'decision', 'milestone']` in the input schemas for `paradigm_assessment_record` and `paradigm_assessment_search`. The handler at line 173 forwards this directly into the lore entry as `type: entryType as LoreEntry['type']` — meaning a caller who passes `type: 'decision'` to the (deprecated) `paradigm_assessment_record` tool will:
1. Pass MCP zod validation (enum still allows it),
2. Construct a `LoreEntry` with `type: 'decision'`,
3. Get a TypeScript-cast bypass (`as LoreEntry['type']`),
4. Hit `recordLoreEntry` which writes to disk with the now-invalid type.

This is a **back-door past the rejection envelope** for the same payload Bundle A tries to block. Even though `paradigm_assessment_*` is `[DEPRECATED]`, deprecated tools are still callable and will be hit by older agents/scripts. Two minimal fixes:
- (preferred) drop `'decision'` from both enum arrays, and add the same rejection-envelope short-circuit at the top of `paradigm_assessment_record`'s handler (lines 160ish);
- (minimum) drop `'decision'` from the enums so MCP zod blocks it before it reaches the handler.

**Why blocking:** it directly defeats the bundle's stated purpose for one of the entry paths. Lore-criticality says "no surprise downstream paths" — this is a surprise downstream path.

### F-2. **improvement** — migration shims silently lose original `type: 'decision'`

Sites C-1 (`lore-loader.ts:530-541`) and C-2 (`storage.ts:587-599`) overwrite `type: 'decision'` → `'insight'` with no audit trail. Site C-3 (`migrate-assessments.ts`) preserves it via the `assessment:decision` tag. Recommend C-1 and C-2 add a tag like `v6-migrated:from-decision` (or set a small marker in the entry's tags array) so a user with 50+ legacy decisions can run `paradigm_lore_search({ tag: 'v6-migrated:from-decision' })` and recover the audit trail. This is the symmetry-with-C-3 fix and the lore-completeness defense the user feedback explicitly calls out. Not blocking because the companion-lore pattern means future decisions have full structure — only the historical batch loses fidelity.

### I-1. **improvement** — missing `.purpose` updates

`packages/paradigm-mcp/src/tools/.purpose` and `packages/paradigm/src/core/lore/.purpose` were not updated. The lore tools `.purpose` should mention the v6.0 hard-rejection at the `paradigm_lore_record` description, and the core lore `.purpose` should note the LoreType change. Stop hook may flag this on the next commit. Non-blocking but should be fixed before merge.

### N-1. **note** — `decisionDeprecationNotice` cleanup is clean

The v5.39.0 soft-deprecation flag (`loreDecisionDeprecationEmitted`) is fully removed and the `deprecation:` field is dropped from the success response (line 715 of the diff). No dead code left behind. Good hygiene.

---

## Verdict

**approved-with-changes**

Bundle A is structurally sound:
- the structured rejection envelope is the right shape, returns (not throws), points at a real doc, and is well-tested;
- the companion-lore pattern that makes this whole removal safe is preserved and verified;
- UI parity is complete;
- the failure baseline is unchanged and unrelated;
- error-message quality is excellent.

But **F-1 must be fixed** before this bundle ships — `assessment.ts` retains `'decision'` in two enum lists and the (deprecated) `paradigm_assessment_record` handler will still write a `type:'decision'` lore entry to disk, defeating the bundle's stated invariant. **F-2 should be fixed** as the lore-criticality defense for upgrade-path users; **I-1 should be fixed** before commit to avoid stop-hook block. Once F-1 is patched, Bundle A is greenlit. F-2 + I-1 can ship in the same patch without re-review.

```yaml
# Agent Relay
status: success
summary: |
  Bundle A's enum sweep, structured rejection envelope, companion-lore preservation,
  UI parity, and tests are all clean and well-executed. The structural rejection
  envelope is exemplary and the LLM-UX of the error message is excellent. However,
  one back-door enum site was missed in `assessment.ts` (lines 71 & 113) that lets
  a caller bypass the rejection envelope and write `type:'decision'` to disk via
  the deprecated assessment-record tool — this is blocking for a "hard-removal"
  bundle. Migration shims also silently lose the original `'decision'` type with
  no forensic tag, weakening the lore-criticality story for upgrade-path users.
  Fix both, plus add `.purpose` notes, and Bundle A ships.
artifacts:
  - reviews/2026-04-22-bundle-a-lore-removal-review.md
decisions:
  - approved-with-changes
  - blocking F-1 — drop 'decision' from assessment.ts enums (lines 71 & 113) and add rejection short-circuit to paradigm_assessment_record handler
  - improvement F-2 — add `v6-migrated:from-decision` tag in lore-loader.ts and storage.ts shims for forensic parity with migrate-assessments.ts
  - improvement I-1 — update packages/paradigm-mcp/src/tools/.purpose and packages/paradigm/src/core/lore/.purpose to reflect v6.0 LoreType change
handoff_to: builder
handoff_context: |
  Bundle A is approved-with-changes. Must-fix before ship: drop 'decision' from
  the enum arrays at packages/paradigm-mcp/src/tools/assessment.ts:71 and :113,
  and add the same rejection-envelope short-circuit at the top of the
  paradigm_assessment_record handler (around line 160) — otherwise the deprecated
  assessment-record tool is a back door past Bundle A's invariant. Should-fix
  same patch: add a `v6-migrated:from-decision` tag in the two lore migration
  shims (lore-loader.ts:530-541, storage.ts:587-599) so legacy decisions remain
  forensically discoverable post-upgrade — mirroring the assessment.ts:65 pattern
  that already preserves origin via the `assessment:decision` tag. Update the
  two `.purpose` files for completeness. After these three fixes, no re-review
  needed — proceed to Bundle B + C.
```
