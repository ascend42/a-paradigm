# Security Audit — Portal.yaml Silent-Failure Auth-Bypass Vectors

**Date:** 2026-04-22
**Agent:** Security
**Scope:** Bugs 1, 2, 3 + Bonus from `reviews/2026-04-22-portal-yaml-triage.md`
**Classification:** Confidential (pre-patch) — do not surface in public release notes until fix lands
**Mode:** Read-only

---

## 1. Stop Hook Security Contract (as implemented)

The stop hook is invoked by Claude Code at session end, runs `paradigm compliance-check --json --auto-heal --learn --trigger on-stop`, and BLOCKS session completion if the output JSON contains `usedButUndeclaredCount > 0`. Concretely (`plugins/paradigm/scripts/paradigm-common.sh:510-574`):

```sh
COMPLIANCE_RESULT=$(paradigm compliance-check --json ... 2>/dev/null) || true
...
if [ -n "$COMPLIANCE_RESULT" ]; then
  UNDECLARED=$(echo "$COMPLIANCE_RESULT" | grep -o '"usedButUndeclaredCount":[0-9]*' | sed 's/.*://')
  if [ "$_SEV" != "off" ] && [ -n "$UNDECLARED" ] && [ "$UNDECLARED" -gt 0 ] 2>/dev/null; then
    VIOLATIONS="$VIOLATIONS ..."
  fi
fi
```

**Stated contract (implicit from `portal-compliance.ts`):**
1. Every gate symbol `^x` referenced in `.purpose` / `portal.yaml` MUST have a declaration keyed by `x` in `portal.yaml.gates` OR attached to a route in `portal.yaml.routes`.
2. If not, the session is blocked.

**What the contract does NOT cover (observed from code):**
- Nothing verifies that every PROTECTED ROUTE in source code has a matching gate in portal.yaml. `portal-compliance.ts` scans only `.purpose` / `portal.yaml` for `^gate` symbols (`GATE_REFERENCE_GLOBS` at line 188-193). Routes defined in source code (Express, Next.js handlers) are not cross-checked against portal.yaml by this module — that cross-check lives in `compliance-checker.ts:90-128` (`route-coverage`), which is invoked through a separate path (`pm.ts` postflight) — not through the stop hook's `paradigm compliance-check` command by default.
- Nothing verifies that the declared gate actually enforces anything. `check:` field is free-form text; no runtime validation.
- Nothing verifies that routes DROPPED in portal.yaml (e.g. via duplicate-key overwrite) still have middleware protection.

**Bottom line:** The stop hook is a **shape-compliance gate**, not a **security gate**. It prevents "undocumented gate symbols" but does not assert "every protected route has a documented gate." Any failure in the shape-compliance path degrades to "no portal.yaml" semantics, not to "block by default."

**FAIL-OPEN is the documented default behavior**, not an accident of bug surface. See `portal-compliance.ts:316-327`: when `config` is null AND no gate references are found, status is `compliant`. The branch AT LINE 312-344 reports `violations` ONLY if references exist. When the portal is silently lost (Bug 3), if code happens to have zero `.purpose` gate symbols at that moment — e.g. a fresh session touching non-Paradigm files — the check returns `compliant` with a polite "create a portal.yaml" suggestion. A bypassed auth config on the filesystem produces a green checkmark.

Stop-hook subprocess invocation also **masks exit codes** (`2>/dev/null) || true` at line 515). If `paradigm compliance-check` crashes, segfaults, or throws on a bad portal.yaml, `COMPLIANCE_RESULT` becomes empty, the `if [ -n "$COMPLIANCE_RESULT" ]` branch is skipped entirely, and the session completes uncontested. **This is the widest auth-bypass vector in the system.**

---

## 2. Concrete Auth-Bypass Scenarios

### Scenario A — Bug 1 (^-prefix parsing), consumer = MCP compliance-checker

Plausible, MEDIUM likelihood — depends on which compliance path runs.

- User follows public site docs (`portal-and-gates.md`), writes `^authenticated:` as the YAML key.
- `parseGateConfig` at `portal/core/src/parser.ts:52` preserves `^` in `gate.id`.
- `premise/core/src/aggregator.ts:331` prepends another `^` → stored symbol `^^authenticated`.
- `scan-index.json` entries carry id `^authenticated`, which never matches `.purpose` symbol references (`^authenticated`).
- MCP `compliance-checker.ts:131-135` + `pm.ts:397-399` treat declared gates as `['0','1','2', ...]` (see Scenario C) — flagged ALL gates undeclared.
- However, the stop-hook path uses `portal-compliance.ts` which loads portal.yaml DIRECTLY with `yaml.load` and strips `^` in `extractDeclaredGates` at line 108. So the documented-form file DOES match in the stop-hook path, and the user sees "compliant" in CLI but "everything undeclared" in MCP tools. **Divergent views of the same file.**
- Escalation path to bypass: developer sees MCP compliance error ("all gates undeclared"), follows the fix message literally: "Add ^authenticated to portal.yaml with description" — which they already did. After frustration cycles, a plausible remediation is to REMOVE the gate references from `.purpose` files to "silence" the error. Gate declarations remain in portal.yaml, but middleware enforcement in source code may also be removed in the same swing if the developer believes gates are "not real."

**Severity: MEDIUM.** The divergent-view problem amplifies the likelihood of the "remove the code, not fix the parser" pattern.

### Scenario B — Bug 3 (duplicate keys, silent swallow)

Plausible, HIGH likelihood — trivially reproduced by the field report.

- User adds a duplicate route with narrower gates (e.g. drops `admin` from `[authenticated, admin]`). js-yaml throws `YAMLException: duplicated mapping key`.
- `portal-compliance.ts:93-95` catches the exception and returns `null`.
- Downstream: `loadPortalConfig` returns null → `checkPortalCompliance` enters the "no portal.yaml" branch at line 312. With zero `.purpose` gate references in the scanned fileset (very common — most sessions don't touch `.purpose` files), status becomes `compliant` (line 317-327). **Complete fail-open.**
- With gate references present (field repro): status becomes `violations`, lists "undeclared" gates. Developer's reasonable next step: remove the gate reference from the `.purpose` file (since "it isn't declared"), thinking they're cleaning up orphan symbols. Protected route is now unprotected in the symbol graph — middleware MAY still fire, but the security contract is gone from the documented surface, and any middleware that reads portal.yaml at runtime (grep patterns show several such libraries exist) will treat the endpoint as open.
- **Worst-case chain:** duplicate key → silent null → MCP compliance shows "everything undeclared" → developer bulk-removes gate references → commits → stop hook now sees zero references, `status: compliant`, session completes → PR merges with auth stripped from documentation AND code.

**Severity: CRITICAL.** Duplicate keys are common in any project whose portal.yaml grows over time. Exactly one instance of this happened in Quakeee-web; the field report describes it.

### Scenario C — Bonus bug (`Object.keys` on Array)

Plausible, LOW-to-MEDIUM likelihood — this code path runs in MCP postflight and `pm.ts`, not in stop hook.

- `ComplianceContext.gateConfig` is declared as `Record<string, unknown> | null` (`compliance-checker.ts:52`) but real shape from `index-loader.ts:60` is `ParsedGateConfig` whose `.gates` is a `Gate[]` array (`portal/core/src/types.ts:115-117`).
- `Object.keys([...])` returns `['0', '1', '2']` — these are the "declared gate names" the check compares against.
- Any `^authenticated`, `^admin`, etc. reference fails `declaredGateNames.includes('authenticated')` because the set contains only index strings.
- **Result:** MCP-side compliance flags EVERY gate as `missing-portal-gate` every time the code path runs.
- The reason the field did not notice: `portal-compliance.ts` (the stop-hook path) doesn't share this bug, so blocking behavior remains intact unless a user relies on `paradigm_pm_postflight` or `paradigm review`.
- Bypass vector identical to A and B: developer "fixes" the false-positive spam by removing gate references.

**Severity: MEDIUM.** Lower blast radius than B because the stop hook is unaffected, but agents that call `paradigm_pm_postflight` will surface storms of false positives, normalizing "ignore portal-compliance errors" as a team habit.

### Scenario D — Stop-hook exit-code masking (newly identified)

HIGH likelihood, CRITICAL impact — not in the original scope but surfaced by reading the bash.

- `COMPLIANCE_RESULT=$(paradigm compliance-check --json ... 2>/dev/null) || true` at `paradigm-common.sh:515`.
- If the `paradigm` binary is missing, hangs past shell timeout, exits non-zero for ANY reason (node version mismatch, corrupt scan-index, OOM, unhandled rejection), `COMPLIANCE_RESULT=""`.
- The outer `if [ -n "$COMPLIANCE_RESULT" ]` branch at line 520 silently falls through to the habits-only fallback. Portal compliance check is skipped ENTIRELY.
- Any failure-mode in the compliance-check Node process — including a thrown uncaught error from Bug 3's duplicate-key path (`yaml.load` throwing from a NEW location the try/catch doesn't cover) — degrades to fail-open.
- **This is categorical:** a malformed portal.yaml that kills the checker process = free session completion, zero output visible to the user beyond the missing-output absence they won't notice.

**Severity: CRITICAL.** This ONE bash idiom defeats every protection the Node layer provides.

### Scenario E — yaml.load at portal-writer silently returns null (newly identified)

- `portal-writer.ts:64` casts `yaml.load(content)` to `RawPortalData`. If the file is malformed, `yaml.load` throws — but the function itself has no try/catch. `readPortalFile` will raise. Probably acceptable (loud).
- However, `data || { version: '1.0.0', gates: {} }` at line 67 silently swaps a YAML result of `null` (e.g. empty file) for a default empty structure. A user who empties portal.yaml by accident will have `paradigm_portal_add_gate` "succeed" against a freshly initialized default — effectively nuking declared gates on the next write. Not a direct bypass but a silent-overwrite vector.

**Severity: MEDIUM.**

---

## 3. Is Silent-Drop of Auth Config the Worst Failure Mode? — Yes.

All five scenarios converge on the same endgame: **auth configuration vanishes silently, compliance fails open, humans remove the gate rather than fix the pipeline.** The common cause is three overlapping shortcuts:

1. `try { yaml.load } catch { return null }` with no distinction between "missing", "malformed", "empty".
2. `|| true` on the subprocess boundary, which swallows exit codes.
3. `Object.keys` on arrays without runtime type assertion.

### Required Fail-Closed Contract

Concretely, a fix that ships before the parser changes MUST establish:

**Contract 1 — Parse failures are errors, not absences.**
- `loadPortalConfig` returns a discriminated union: `{ ok } | { missing } | { unparseable, error } | { malformed, details }`. Every caller switches exhaustively.
- `compliance-check --json` output has a top-level `portal.status` field with explicit `unparseable` value.

**Contract 2 — Unparseable portal = BLOCK, not compliant.**
- `checkPortalCompliance` MUST NOT return `status: 'compliant'` when portal.yaml exists but cannot be parsed. It returns `status: 'violations'` with a new violation type `portal-unparseable`.
- `paradigm-common.sh` MUST treat an empty or error `COMPLIANCE_RESULT` as block-by-default. Replace `... || true` with an explicit exit-code check; on non-zero, emit a BLOCK with message "compliance check failed to run, refusing to complete session." Do NOT fall through to the habits-only branch.

**Contract 3 — Any project with a portal.yaml has portal compliance checked.**
- Currently, if `paradigm` binary is missing, the stop hook skips portal compliance silently. Existence of `portal.yaml` in the repo should make compliance check MANDATORY — missing binary = BLOCK with install instructions.

**Contract 4 — Type assertions on gate config consumers.**
- `compliance-checker.ts:131` and `pm.ts:397` must verify `gateConfig.gates` is not an Array before `Object.keys`. Better: fix `ComplianceContext.gateConfig` type to `ParsedGateConfig | null` and iterate `.gates` as the `Gate[]` it is.

**Contract 5 — Strict mode is the default, not a flag.**
- Triage recommends a `--strict` flag for duplicate-key promotion. Security position: duplicate keys in an auth-config file are ALWAYS an error. No tolerant default.

---

## 4. Data-Exposure Risk in the Fix Itself

### 4a. `validateYamlKeys()` / parse-error messages

js-yaml's default `YAMLException.toString()` includes 2-3 lines of YAML context around the error mark. For a portal.yaml containing gate names and route paths, that context will include strings like:

```
duplicated mapping key (78:3)
 77 |   "GET /api/admin/users":
 78 |     - ^authenticated
 79 |     - ^admin
```

**Risks:**
- Stop-hook output goes to terminal AND the Claude Code session transcript AND (via Paradigm's ambient/telemetry events) potentially to `.paradigm/events/*.jsonl`, and from there to any agent notebook / relay.
- Gate names and internal route paths leak into: LLM context windows (future sessions and cross-agent handoffs), any crash reporter, any log aggregation, the `paradigm_lore_record` event stream if this error triggers a lore entry.

**Guardrails:**
- Strip context lines from user-visible error messages. Keep line-number + error kind only: "portal.yaml line 78: duplicated mapping key". Route/gate content never rendered.
- If full context is needed for debugging, write it to `.paradigm/debug/portal-parse-error.log` with restrictive permissions, never to stdout.
- Sanitize before any telemetry emission. Sentinel should not see portal.yaml content.

### 4b. `writeAndConfirm` content_hash

Hash of a small YAML file IS pre-image attackable if an attacker knows (a) the rough shape and (b) the namespace of gate names used at the target org.

**Recommendation:**
- Use HMAC-SHA256 with a per-project secret derived from `.paradigm/config.yaml` or from a platform-issued project key.
- If the hash is advisory (detecting tampering by the Paradigm tool chain itself, not an adversary), truncate to first 8 hex chars — enough for change detection, far too short for brute-force reverse.
- NEVER publish content_hash in a public surface (README, git tag, paradigm_status public output).

### 4c. Round-trip manifest / lossy-transformation listing

A manifest that lists "gate `foo` has type `admin-role`, location `/api/internal`, check `req.user.role === 'admin'`" describes the exact shape of auth logic. Publishing it via `paradigm_reindex` output is a disclosure vector.

**Guardrails:**
- Manifest should list TRANSFORMATION CLASS (e.g. "gate normalized: ^-prefix stripped", "route normalized: method/path canonicalized"), not the gate/route content.
- If individual symbols must be named in the manifest, use opaque ids from the scan-index (already opaque-ish) — never include `check:` expressions, never include route paths, never include descriptions.
- Manifest access-controlled: `.paradigm/reindex/manifest.yaml` with local-only write, never bundled into published artifacts.

---

## 5. Severity & Blast Radius

| Scenario | Severity | Likelihood | Blast radius (current projects exposed) |
|---|---|---|---|
| A — ^-prefix parse, divergent views | MEDIUM | medium — needs MCP compliance path AND docs-form portal.yaml | every project that followed public site docs (`portal-and-gates.md`) — plausibly every project initialized before the parser fix |
| B — duplicate keys, silent null | **CRITICAL** | high — any portal.yaml that grew over time | every project with a maintained portal.yaml; field-reproduced in Quakeee-web on 2026-04-21 |
| C — `Object.keys(Gate[])` | MEDIUM | low-medium — only MCP postflight / review paths | every project that runs `paradigm review` or `paradigm_pm_postflight` via an agent (growing share as orchestration adoption grows) |
| D — stop-hook exit-code mask (`|| true`) | **CRITICAL** | 100% when upstream fails | every Paradigm user — this is the shell default |
| E — `yaml.load` null coercion in writer | MEDIUM | low — requires empty portal.yaml | projects that run `paradigm_portal_add_gate` after accidental truncation |

**Aggregate blast radius:** every project currently using Paradigm with a portal.yaml is one of:
- Already in Scenario A (docs-prefixed form) — latent divergent-view.
- One duplicate-key commit away from Scenario B.
- Dependent on Scenario D holding, which it does not.

Field evidence (Quakeee-web): Scenarios A + B + D all fired simultaneously. Only the noisiness of "8 gates undeclared" triggered investigation; if the `.purpose` references had been fewer or absent, Scenario D would have silently completed the session with auth dropped.

---

## 6. Practical Exploit Chain (for disclosure drafting)

1. Attacker (or innocent refactor) adds a duplicate route key to `portal.yaml` with narrower gates.
2. Stop hook runs compliance-check. Either:
   - The Node process throws uncaught → `COMPLIANCE_RESULT=""` → fall-through, no block.
   - Or the process catches → returns `compliant` (no `.purpose` refs at that moment).
3. Session completes. Commit lands.
4. CI — if any — runs the same compliance-check, same failure mode.
5. PR merges. Admin endpoint now lists only `[authenticated]`. Middleware that reads portal.yaml at runtime (several libraries do) drops the admin role check.
6. Endpoint is open to authenticated non-admin users.

This is a plausible, un-targeted supply-chain-style bypass: the bug does the attacker's work for them.

---

## Agent Relay

```yaml
status: success
summary: |
  Every one of the four bug families is an auth-bypass vector in the sense that it causes the stop hook — designed to block shipping misconfigured gates — to fail open. Bug 3 (duplicate-key silent swallow) is confirmed critical and field-reproduced; Bug 1 (^-prefix parse) is medium but creates divergent views between CLI and MCP that train developers to distrust the compliance system; the Bonus bug (Object.keys on Gate[]) is a dormant but loaded footgun on the MCP postflight path; and a fifth scenario — the bash `|| true` on the `paradigm compliance-check` subprocess at paradigm-common.sh:515 — is the single widest hole in the system because any upstream failure silently skips the entire portal check. This MUST be treated as a security patch. Accelerated release (hotfix branch, coordinated bump across paradigm / paradigm-mcp / plugin), CVE-style disclosure statement (brief, non-sensational — "compliance check could fail open on malformed portal.yaml"), and strict-mode fail-closed semantics shipped ON BY DEFAULT. Do not gate any of these fixes behind a flag.
artifacts:
  - reviews/2026-04-22-portal-yaml-security-audit.md
decisions:
  - security severity: critical
  - disclosure needed: y
  - fail-closed required before any fix ships: y
handoff_to: architect (for plan adjustments) + user (for release decision)
handoff_context: |
  Release-shape changes required:
  1. Strict mode is DEFAULT, not flag. `loadPortalConfig` returns a discriminated union; `checkPortalCompliance` returns `status: 'violations'` on any portal-unparseable state; stop hook treats that as block.
  2. Fix the bash, not just the Node. `paradigm-common.sh:515` `|| true` must go. Non-zero exit from compliance-check = BLOCK with explicit "compliance check failed to run" message.
  3. Existence of portal.yaml makes compliance mandatory. Missing paradigm binary with portal.yaml present = BLOCK + install-instructions message, never skip.
  4. Fix `Object.keys(ctx.gateConfig.gates)` at compliance-checker.ts:131-135 and pm.ts:397-399 in the SAME patch. Correct the ComplianceContext.gateConfig type from Record<string,unknown>|null to ParsedGateConfig|null (single source of truth).
  5. Error-message guardrails: strip YAML context lines (which contain gate names and route paths) from any user-visible error or telemetry output. Full context only to local .paradigm/debug/ with restrictive permissions.
  6. content_hash in writeAndConfirm: use HMAC or truncate to first 8 hex. Never publish.
  7. Round-trip manifest: list transformation CLASSES, never gate/route content.
  8. Disclosure draft should name Quakeee-web as the discovery site (with Matt's consent) and credit the field report. Coordinate with any other downstream projects that pinned pre-fix versions — backport the fix to the current minor line, not just main.
  Bundle order is non-negotiable for security reasons: (a) fail-closed semantics + bash fix + Object.keys fix ship TOGETHER in one release; (b) the lenient ^-prefix parser fix (Bug 1) can follow in a subsequent patch; (c) doc changes ride with (b). Shipping (b) before (a) leaves the fail-open paths intact.
```
