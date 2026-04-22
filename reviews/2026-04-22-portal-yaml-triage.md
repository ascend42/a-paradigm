# Reviewer Triage — Portal.yaml Gate Parsing, Stop-Hook Messaging, Duplicate-Key Swallowing

**Date:** 2026-04-22
**Agent:** Reviewer
**Source report:** `docs/private/diagnosis-2026-04-21-portal-yaml-gate-parsing.md`
**Reporting project:** Quakeee-web (Quaki) — field repro on 2026-04-21

---

## TL;DR severity ranking

| Bug | Severity | Blast radius | Fix effort |
|-----|---------:|-------------:|-----------:|
| **1. Gate id retains `^` through the parse pipeline** | **blocking** | wide — everything downstream of `parseGateConfig` (scan-index, compliance checkers, agent symbol lookups, portal-compliance regex heuristics) | small (~2 lines in `portal/core/src/parser.ts`, 1 line in `premise-core/src/aggregator.ts`) |
| **2. Stop-hook message blames "not declared" when cause is "malformed id"** | **medium** | narrow — one violation-message template in `portal-compliance.ts` + `compliance.ts`, mirrored in `pm-compliance.ts` | small (conditional branch + new suggestion string) |
| **3. Duplicate YAML keys silently disappear (and not in the way the reporter described)** | **high** | wide — every `loadPortalConfig` call in compliance, doctor, flows, persona, sweep, orchestration paths. YAML throws, we `catch {}`, portal becomes `null` invisibly | small (surface the error at read time; add a doctor check) |

**Recommended order of fix:** Bug 1 first (it is the root cause of the field repro; removing `^` from portal.yaml is a workaround, not a fix). Bug 3 second (same "data silently lost" family as v5.37.11 — ship it as part of that hardening track). Bug 2 last — depends on how Bug 1 gets fixed, because the message branch only needs to exist if we keep tolerating the prefixed-key form.

**Bundle recommendation:** Bugs 1 + 2 should ship together. If we adopt the lenient parser fix for Bug 1 (strip `^`), Bug 2's remediation message can include a one-time migration note for projects whose portal.yaml still carries the prefixed form. Bug 3 can ship independently or bundled with the v5.37.11 silent-no-op follow-up in `docs/private/plans/silent-no-op-prevention.md`.

---

## Bug 1 — Gate id retains `^` prefix through the parse pipeline

### Root cause

**Primary location:** `packages/portal/core/src/parser.ts:52-54`

```ts
for (const [id, gateDef] of Object.entries(gatesSource)) {
  gates.push(normalizeGate(id, gateDef));
}
```

`normalizeGate(id, def)` at `parser.ts:118-141` takes the raw YAML key as-is and assigns it to `Gate.id`. If the key is `^authenticated`, `gate.id === '^authenticated'` — the `^` is the Paradigm symbol-class marker, not part of the identifier, but nothing strips it.

**Verified repro** (ran in triage, see transcript):

```js
const config = await parseGateConfig('/tmp/pdgm-test/portal.yaml');
// config.gates === [{ id: '^authenticated', ... }, { id: '^org-admin', ... }]
```

**Amplification site:** `packages/premise/core/src/aggregator.ts:331`

```ts
function createGateSymbol(gate: Gate, filePath: string): SymbolEntry {
  return createSymbolEntry({
    id: `gate-${gate.id}`,
    symbol: `^${gate.id}`,        // <-- prepends ^ unconditionally
    ...
  });
}
```

Because `gate.id` is already `^authenticated`, `symbol` becomes `^^authenticated` — exactly matching the evidence in the field scan-index (`id: "^authenticated"`, `symbol: "^^authenticated"`). Confirmed.

**Tertiary effect:** `packages/probe/core/src/generator.ts:385` `extractId(symbol)` does `symbol.slice(1)` — designed to strip one prefix character. With `^^authenticated` as input, it outputs `^authenticated` (one caret remaining). That is what ends up in `scan-index.json.gates[id]`.

### Why the field workaround worked

Removing `^` from portal.yaml keys (e.g. `authenticated:` instead of `^authenticated:`) makes `gate.id === 'authenticated'` → `symbol === '^authenticated'` → `extractId` strips the single `^` → `scan-index.gates[id] === 'authenticated'`. Everything downstream matches the bare "used in code" set. The field report's assertion "index gate-count jumped 4 → 12" confirms the gates were previously being registered under malformed ids.

### Why the Stop hook still fires (root-cause path)

The stop hook runs `paradigm compliance-check --json` → `runPortalCheck` → `checkPortalCompliance(rootDir)` in `packages/paradigm/src/core/portal-compliance.ts`. That module:

1. **Loads portal.yaml via its own parser** (`loadPortalConfig`, line 83-96) — does NOT go through `portal-core.parseGateConfig`. It strips `^` correctly in `extractDeclaredGates` (line 108).
2. Scans `.purpose` files + `portal.yaml` itself for `^gate-name` references (line 242 regex `/\^([a-z][a-z0-9-]+)/g`).

So `portal-compliance.ts` alone should NOT mis-flag the Quakeee-web portal. That means **the actual Stop-hook failure was caused by Bug 3 (duplicate keys throwing, swallowed by `try { ... } catch { return null }` in `loadPortalConfig` at line 93-95) — not by Bug 1**. With `gateConfig === null`, `extractDeclaredGates` is never called, and the fallback path at line 312-344 treats the regex-harvested references as "undeclared." That explains why removing duplicate+prefixed content both "fixed" compliance AND made the scan-index numbers jump.

**Bug 1 is real and blocking** because it corrupts every downstream consumer of `scan-index.json` (agent search, ripple, aspect graph, `getSymbolsByType('gate')`, orchestration prompts that serialize gate symbols). The stop-hook message happens to have been collateral damage from Bug 3, but Bug 1 is the one that silently breaks agent workflows every time a project follows CLAUDE.md / site-docs conventions.

### Severity — **blocking**

- Every project that follows the documented `^authenticated:` portal.yaml form ends up with a corrupted scan-index.
- Bug is data-path, not message-path — it invalidates the primary paradigm lookup table.
- Fix is small. Not fixing it means all documented examples are wrong.

### Proposed fix

**Option A — lenient parser (recommended).** Strip a leading `^` from gate keys in the one normalization point, so both authoring forms round-trip cleanly.

`packages/portal/core/src/parser.ts` around line 52:

```ts
for (const [rawId, gateDef] of Object.entries(gatesSource)) {
  const id = rawId.startsWith('^') ? rawId.slice(1) : rawId;
  gates.push(normalizeGate(id, gateDef));
}
```

Mirror in `parseGateFile` (line 106) and `parseGateFile` single-file branch (line 99-101: if `data.id` starts with `^`, strip).

Also in routes parsing (grep for `config.routes` gate-list handling — should ideally normalize there too, although `extractDeclaredGates` in `portal-compliance.ts` already strips `^` on route gate references).

**Option B — strict docs + migration.** Change all docs/templates to emit bare keys and error noisily when a `^`-prefixed key is found. Heavier lift, breaks deployed portal.yaml files.

Recommendation: Option A. The prefixed form is in the wild (site docs, migration-prompt, personas spec); lenient parsing is lower-risk and aligns with how `paradigm_portal_add_gate` already behaves (`stripSymbolPrefix` in `portal-writer.ts:126`).

Follow-up hygiene (ship with the fix): update the docs listed below (see Documentation/scaffold audit) so new users don't land in the ambiguous authoring form.

### Blast radius

Other parsers that suffer the same pattern:

- `packages/paradigm-mcp/src/utils/compliance-checker.ts:131-135` — also calls `Object.keys(ctx.gateConfig.gates)` treating it as a `Record`, but `ctx.gateConfig` is a **`ParsedGateConfig` whose `gates` is a `Gate[]` array** (confirmed in `portal-core/src/types.ts:115-117`). `Object.keys([])` returns stringified indices. Even without Bug 1, this checker is broken — it would flag every gate as undeclared whenever invoked.
- `packages/paradigm-mcp/src/tools/pm.ts:397-399` — same bug, same `Object.keys(ctx.gateConfig.gates)` call on an array.

These two call sites were not surfaced in the original diagnosis but are related hazards: the `ComplianceContext.gateConfig` type annotation (`Record<string, unknown> | null`) at `compliance-checker.ts:52` is a lie vs. the actual runtime shape coming from `index-loader.ts:60` which produces `ParsedGateConfig | null`. Either fix the consumers to iterate the `Gate[]` array or change `ComplianceContext.gateConfig` to the true type.

`packages/paradigm/src/core/portal-compliance.ts` does NOT share this bug — it loads portal.yaml with raw `yaml.load` and treats `gates` as a record (which it IS, at that layer).

### Test that would have caught it

A single round-trip integration test in `packages/portal/core`:

```ts
test('parseGateConfig strips ^ symbol prefix from gate keys', async () => {
  const yamlText = `
version: "2.0"
gates:
  ^authenticated:
    description: Test
    locks: []
    prizes: []
`;
  const cfg = await parseGateConfigFromString(yamlText); // helper
  expect(cfg.gates[0].id).toBe('authenticated');
});
```

And a second one in `packages/premise/core` asserting `createGateSymbol({ id: 'authenticated' }).symbol === '^authenticated'` (single caret, not double).

---

## Bug 2 — Stop-hook error message blames "not declared" when cause is "malformed / unparseable"

### Root cause

**Emitting path (visible to user):** `plugins/paradigm/scripts/paradigm-common.sh:566` and the generated copy in `packages/paradigm/src/commands/hooks/generated-hooks.ts:572`:

```sh
$UNDECLARED gate(s) used in code but not declared in portal.yaml:
  $UNDECLARED_LIST
```

`UNDECLARED` comes from `'"usedButUndeclaredCount":[0-9]*'` in the JSON produced by `paradigm compliance-check`, whose producer is `packages/paradigm/src/commands/compliance.ts:384`.

**Source of the wrong narrative:** `packages/paradigm/src/core/portal-compliance.ts:308-344`. When `loadPortalConfig` returns `null` (either because the file doesn't exist OR — critically for this bug — because `yaml.load` threw and was swallowed at line 93-95), the code at line 312-344 takes the "no portal.yaml" branch. If there are ANY gate references in code, it reports them all as `usedButUndeclared` with status `violations`.

So the user sees "8 gates used but not declared" when the actual state is "portal.yaml failed to parse silently" or (in the prefixed-key case, via the MCP compliance path) "portal.yaml parsed but mutation/lookup mapped to indices instead of names."

### Severity — **medium**

- Not data-corrupting, but it burns user time (report says reporter went hunting for missing declarations that were all present).
- Every `loadPortalConfig` read error is mis-classified as "no portal.yaml."
- Simple to fix: separate the three states (missing / unparseable / present) and emit distinct messages.

### Proposed fix

Split `loadPortalConfig` into three return states and surface them upstream:

`packages/paradigm/src/core/portal-compliance.ts:83-96`:

```ts
export type PortalLoadResult =
  | { status: 'missing' }
  | { status: 'unparseable'; error: string }
  | { status: 'ok'; config: PortalConfig };

export function loadPortalConfig(rootDir: string): PortalLoadResult {
  const portalPath = path.join(rootDir, 'portal.yaml');
  if (!fs.existsSync(portalPath)) return { status: 'missing' };
  try {
    const content = fs.readFileSync(portalPath, 'utf-8');
    return { status: 'ok', config: yaml.load(content) as PortalConfig };
  } catch (e) {
    return { status: 'unparseable', error: (e as Error).message };
  }
}
```

Add a new `ComplianceReport.status` value `'portal-unparseable'` and a new suggestion:

```
portal.yaml exists but cannot be parsed. Error:
  duplicated mapping key (line 78)

Fix: resolve the YAML error above. If gate keys are prefixed with `^`
(e.g. `^authenticated:`), either remove the prefix or upgrade to
paradigm >= 5.37.12 which accepts both forms.
```

Sibling emission in the stop hook (`plugins/paradigm/scripts/paradigm-common.sh:558-580`) should check for the new status before the `usedButUndeclaredCount` branch.

Keep all non-`loadPortalConfig` read sites in sync — `pm-compliance.ts:238`, `workspace-loader.ts:187`, `doctor/context-audit.ts:564`, etc. Most of these have `try { ... } catch {}` patterns that should bubble the parse error at least once.

### Blast radius

The "quietly returns null on parse error" pattern appears in:

- `packages/paradigm/src/core/portal-compliance.ts:93-95` (primary)
- `packages/paradigm-mcp/src/utils/index-loader.ts:65-68` (logs a warning, at least — one of the few well-behaved sites)
- `packages/paradigm-mcp/src/utils/workspace-loader.ts:187` (bare cast, will throw uncaught on bad YAML)
- `packages/paradigm/src/commands/persona/index.ts:230`
- `packages/paradigm/src/commands/sweep/index.ts:376` (cast to nullable)
- `packages/paradigm-mcp/src/tools/flows.ts:223`

Each of these treats "YAML parse failure" as "file absent." Fixing the message without fixing all the swallowing sites would still leave quiet failures on other code paths.

### Test that would have caught it

Unit test against `loadPortalConfig`:

```ts
test('loadPortalConfig distinguishes missing from unparseable', () => {
  withTempDir((dir) => {
    fs.writeFileSync(path.join(dir, 'portal.yaml'), 'gates:\n  a: {}\n  a: {}\n');
    expect(loadPortalConfig(dir).status).toBe('unparseable');
  });
});
```

And an end-to-end test that runs the stop-hook shell path against a corrupted portal and asserts the violation message names the parse error, not "not declared."

---

## Bug 3 — Duplicate YAML keys are silently swallowed

### Root cause

The reporter described this as "parser took one and dropped the other." **The actual behavior is worse:** `js-yaml` in strict mode (Paradigm's default) **throws** `YAMLException: duplicated mapping key`. That exception is caught and discarded in multiple read sites.

**Verified repro** (ran in triage):

```
YAMLException: duplicated mapping key (5:3)
 4 | routes:
 5 |   "GET /api/foo":
 6 | ...
```

**Swallowing sites:**

- `packages/paradigm/src/core/portal-compliance.ts:90-95` — `try { yaml.load(...) } catch { return null }`. This is the primary failure: silent `null` cascades into the "no portal.yaml" branch (see Bug 2).
- `packages/premise/core/src/aggregator.ts:238-244` — catches per-file and appends to `errors[]` (which is technically better — the errors array is populated — but no caller checks the `errors` field at the stop-hook layer).
- `packages/paradigm-mcp/src/utils/index-loader.ts:64-68` — does log a warning (`log.component('#index-loader').warn(...)`) but logs go to mcp-logger, which the user running the stop hook does not see.

So when Quakeee-web's portal.yaml accumulated duplicate route keys, the entire file became unparseable. The compliance check branched into "no portal.yaml exists" mode, rolled up all gate references in `.purpose` files as `usedButUndeclared`, and emitted the misleading message from Bug 2. Removing the duplicates AND removing the `^` prefix (Bug 1) got the user back to a parseable, correct-symbol state — which is why "the workaround worked" even though each of these three bugs is independently present.

### Severity — **high**

- Silent data-integrity failure.
- Second instance of this failure class shipped in three days (v5.37.11 was the first — `paradigm_portal_add_gate` silent no-op).
- Reporter's guidance ("Rune playbook: treat MCP round-trip failures as paradigm bugs and escalate") is a workaround for this class; the real fix is to make the system never round-trip silently.

### Proposed fix

**Part A — surface the error at read time.** Change `loadPortalConfig` per Bug 2's proposed fix (`{ status: 'unparseable', error }`). This gives every consumer a chance to distinguish missing from broken.

**Part B — add an explicit duplicate-key check in `paradigm doctor`.** `packages/paradigm/src/commands/doctor/index.ts` should include a portal.yaml health check:

```ts
async function checkPortalYaml(rootDir: string): Promise<DoctorFinding[]> {
  const portalPath = path.join(rootDir, 'portal.yaml');
  if (!fs.existsSync(portalPath)) return [];
  try {
    yaml.load(fs.readFileSync(portalPath, 'utf-8'));
    return [];
  } catch (e) {
    const err = e as yaml.YAMLException;
    return [{
      severity: 'error',
      category: 'portal',
      message: `portal.yaml parse error: ${err.reason}`,
      file: 'portal.yaml',
      line: err.mark?.line,
      suggestion: err.reason === 'duplicated mapping key'
        ? 'Duplicate route or gate key — consolidate the entries into one.'
        : 'Fix the YAML syntax error above.',
    }];
  }
}
```

**Part C — promote to warning in the stop hook.** The stop hook already runs `paradigm compliance-check`. Add a portal-parseable precheck that emits a distinct violation when portal.yaml fails to parse (regardless of `usedButUndeclaredCount`).

**Part D (nice-to-have) — `--strict` flag.** Future: add a doctor flag that promotes YAML warnings (duplicate keys, missing required fields) to errors.

### Blast radius

Same as Bug 2 — every `yaml.load`-with-swallow site for portal.yaml. Specifically the 6+ sites listed in Bug 2's blast radius section. Consolidating to a single `loadPortalConfig` entry point and removing per-site `try/catch` is the cleanest longer-term fix.

### Test that would have caught it

```ts
test('duplicate route keys surface as a parseable doctor error', async () => {
  const yamlText = `
version: "2.0"
gates: {}
routes:
  "GET /api/foo":
    - ^auth
  "GET /api/foo":
    - ^admin
`;
  withTempPortal(yamlText, async (rootDir) => {
    const result = await doctorPortalCheck(rootDir);
    expect(result.findings[0].message).toMatch(/duplicated mapping key/);
  });
});
```

---

## Documentation / scaffold audit

### CLAUDE.md

`/Users/ascend/Documents/GitHub/a-paradigm/CLAUDE.md`:

- Line 32: `| \`^\` | Gate | \`^authenticated\` |` — symbol-in-prose (fine, describing the symbol class).
- Line 76: "Gate: ^authenticated required" — symbol-in-prose (fine).
- **No `^authenticated:` YAML example in CLAUDE.md itself.** The reporter's claim that CLAUDE.md emits the prefixed form is partly inaccurate — it's not in CLAUDE.md, it's in the site docs and migration prompt.

### Shift scaffold

`packages/paradigm/src/commands/shift-files.ts:111-116` emits:

```
version: "2.0"
gates: {}
routes: {}
```

This is **correct** and was updated as part of v5.37.11 (per CHANGELOG line 16: "shift-files.ts — v2 scaffold now emits `gates: {}` / `routes: {}`"). The scaffold is not the origin of the prefixed-key form.

**Confirmed:** v5.37.11's shift-files.ts fix addressed the Array→{} issue but did NOT touch gate-key form (there were no example keys to touch).

### Doc sources that DO emit the prefixed form

Grep for `  \^[a-z][a-z-]+:` (YAML key under a gates:/routes: block):

- `packages/site/src/content/docs/portal-and-gates.md:14,17` — `^authenticated:`, `^project-admin:` as YAML keys. **Ships on the public docs site.**
- `packages/site/src/content/docs/concepts.md:59,63` — same pattern.
- `packages/site/src/content/docs/purpose-files.md:39` — `^user-owner:`.
- `.paradigm/docs/migration-prompt.md:174,179,269,273` — `^authenticated:`, `^admin-only:`.
- `docs/specs/personas.md:780-787` — keys under `^public: [...]` form (slightly different — personas mapping, not portal.yaml).
- `.paradigm/prompts/add-gate.md:78` — `^premium-only:`.

**Documentation bug confirmed.** The public docs site is the primary source of truth for new users (it's what Nora, the ftux agent, would read). Every example shown to a new user leads them into the bugged form. This compounds Bug 1: even a fresh project using only the scaffold is fine, but the moment the user reads the docs and edits by hand, they corrupt their portal.yaml.

**Recommended doc changes (ship with Bug 1 fix):**

- `packages/site/src/content/docs/portal-and-gates.md` — switch all gate YAML keys to bare form, keep `^` prefix in prose references ("reference as `^authenticated` in flow steps").
- `packages/site/src/content/docs/concepts.md` — same.
- `packages/site/src/content/docs/purpose-files.md` — same.
- `.paradigm/docs/migration-prompt.md` — same.
- `.paradigm/prompts/add-gate.md` — same. Bonus: reinforce "call `paradigm_portal_add_gate`, never hand-edit."

If Option A (lenient parser) is adopted, the doc bug becomes ergonomic rather than functional — projects still work, they just render an unidiomatic form. Either way, the docs should be fixed for clarity.

---

## Pattern reflection — Bug 3 vs. v5.37.11

**Same family: silent data-integrity failure across the write/read barrier.**

| Axis | v5.37.11 (`paradigm_portal_add_gate` no-op) | Bug 3 (duplicate-key swallow) |
|------|---------------------------------------------|--------------------------------|
| Layer | Mutation (writer) | Parse (reader) |
| Root cause | `data.gates = []` + named-property assign on Array dropped by `yaml.dump` | `yaml.load` throws on dupe; callers `catch {}` and return `null` |
| Visible symptom | Successful return, file unchanged | Successful return with wrong/empty state |
| Recovery signal | None — handler built response from input, didn't read back | None — `loadPortalConfig` returns `null`, indistinguishable from "file missing" |
| Blast radius | portal-writer + mirrored handlers | every `loadPortalConfig`/`yaml.load` + swallow call site |

**Shared root-pattern:** **operations that should be total become partial, and the partiality is not surfaced.** v5.37.11's fix was layered:

1. Normalize input shape (`Array → {}`).
2. Post-write read-back verification (throws on silent no-op).
3. Scaffold the vulnerable shape out of existence.

Bug 3 needs the parse-layer analogue:

1. Distinguish parse-failure from file-absence at the boundary (`PortalLoadResult` discriminated union).
2. Surface the parse error to the user (message, not just a null return).
3. Add a doctor check that catches the shape before it reaches compliance.

The residual-risk list in v5.37.11's CHANGELOG notes (`handleAddComponent`, `handleLink`, `handleRemove`, `handleRename`) is the write-side equivalent of this same family. A single hardening pass covering both directions — write verification + read-error surfacing — is probably the right follow-up to both v5.37.11 and this triage. `docs/private/plans/silent-no-op-prevention.md` is the right home for it.

**Specific addition to that plan:** a read-side `loadWithIntegrity()` wrapper for YAML reads that returns a discriminated result union (`ok | missing | unparseable | malformed`) and forces every caller to handle each arm. Mirror of the proposed `writeAndConfirm` wrapper.

---

# Agent Relay
status: success
summary: |
  Three confirmed bugs from Quakeee-web triage. Bug 1 (gate id retains `^` prefix through `portal-core/parser.ts:52` and gets double-prefixed in `premise-core/aggregator.ts:331`) is BLOCKING — corrupts scan-index for every project that uses the documented `^authenticated:` portal.yaml form. Bug 3 (duplicate YAML keys trigger exceptions that are silently swallowed in `portal-compliance.ts:93-95` and 5+ other read sites) is HIGH and is the true cause of the Quakeee-web stop-hook fire; same failure family as v5.37.11 silent no-op, read-side analogue. Bug 2 (stop-hook message blames "not declared" when cause is "unparseable" or "malformed id") is MEDIUM — downstream messaging symptom of Bugs 1 and 3. Fix Bug 1 first (2-line parser change + aggregator adjustment), then Bug 3 (new `PortalLoadResult` discriminated union + doctor check), then Bug 2 (depends on Bug 3's status enum). Doc bug confirmed — site docs (`portal-and-gates.md`, `concepts.md`, `purpose-files.md`), migration-prompt, and add-gate prompt all show `^gate-name:` as YAML keys; bundle doc fixes with Bug 1.
artifacts:
  - reviews/2026-04-22-portal-yaml-triage.md
decisions:
  - Bug 1 severity: blocking
  - Bug 2 severity: medium
  - Bug 3 severity: high
  - Fix order: 1 → 3 → 2
  - Bundle: Bug 1 + doc fixes together; Bug 3 bundles with v5.37.11 silent-no-op follow-up track
  - Recommended parser strategy for Bug 1: lenient (strip `^`) rather than strict (reject prefixed keys) — prefixed form is in the wild via site docs
  - Also found: `packages/paradigm-mcp/src/utils/compliance-checker.ts:131-135` and `packages/paradigm-mcp/src/tools/pm.ts:397-399` call `Object.keys` on a `Gate[]` array (not a record) — independent related bug; flag for fixer
handoff_to: user
handoff_context: |
  Before builder starts, the user should decide:
    1. Parser strategy for Bug 1 — lenient (accept both forms, recommended) or strict (reject `^`-prefixed keys and force migration). Recommended: lenient, because the prefixed form is shipped in public site docs and in deployed user portal.yaml files.
    2. Whether Bug 3's fix ships as a standalone patch or as part of the broader `docs/private/plans/silent-no-op-prevention.md` hardening pass (the read-side analogue of v5.37.11's write-side fix).
    3. Whether to fold the two incidental bugs surfaced during this triage — `compliance-checker.ts:131-135` and `pm.ts:397-399` calling `Object.keys` on `ParsedGateConfig.gates` (a `Gate[]`, not a record) — into Bug 1's fix or track separately. They would flag every gate as undeclared whenever their code path runs, but the known consumer paths route through `portal-compliance.ts` so they may be dormant. Worth a grep pass.
    4. Whether Nora (ftux) should audit the site docs after Bug 1 ships to verify the prefixed-key form no longer appears in any new-user-facing surface.
