# Review: `paradigm_portal_add_gate` silent no-op on v2 scaffold

**Date:** 2026-04-20
**Reviewer:** reviewer agent
**Status:** Bug confirmed, reproduced, root-caused. Fix NOT applied (triage only).
**Severity:** **BLOCKING** — silent data loss, breaks every freshly-init'd v2 project.

---

## Summary

`paradigm_portal_add_gate` returns `{"action":"portal_add_gate", ...}` success JSON while silently writing nothing when `portal.yaml` contains `gates: []` (the default v2 scaffold format emitted by `paradigm shift`). Downstream agents trust the success response, don't verify, and the gate vanishes. This is the "fake success" failure mode — the worst possible kind.

---

## Root Cause

**File:** `packages/paradigm-mcp/src/utils/portal-writer.ts`
**Function:** `addGateToPortal` (lines 92–133)
**Offending lines:** 108–113, 129

```ts
export function addGateToPortal(rootDir, params): string {
  const { data, filePath } = readPortalFile(rootDir);

  if (!data.gates) {          // (A) line 108 — guard only catches undefined/null
    data.gates = {};
  }

  const gateId = stripSymbolPrefix(params.id);
  const gate: RawPortalGate = data.gates[gateId] || {};  // (B) line 113

  // ... populate `gate` ...

  data.gates[gateId] = gate;  // (C) line 129 — named-property assignment on Array
  writePortalFile(filePath, data);  // (D) line 131 — writes back unchanged
  return filePath;             // (E) returns successfully, no verification
}
```

### The exact failure sequence

1. Input file: `version: '2.0'\ngates: []\nroutes: []` — this is a literal YAML **empty sequence**, which `js-yaml` parses as a JavaScript **Array** (`[]`), not an object.
2. `readPortalFile` returns `data.gates = []`.
3. Line 108 guard `if (!data.gates)` is **false** because `[]` is truthy. The guard fails to reset the shape.
4. Line 113: `data.gates[gateId]` on an Array with a string key returns `undefined`, so `gate = {}`.
5. Line 129: `data.gates['authenticated'] = gate` — this **does** set a named property on the Array object (legal JS), but named properties on arrays are NOT serialized by `js-yaml.dump`; it only emits numeric indices. The Array is serialized as the same `[]` it was read as.
6. `writePortalFile` writes the file — the content is byte-for-byte identical to the input.
7. `addGateToPortal` returns `filePath` with no error, no verification, no read-back.
8. The tool handler (`handlePortalAddGate`, `purpose-portal.ts:1179–1205`) has no verification layer and returns the pre-formatted success JSON.

### Why this hits *every* v2 project

`packages/paradigm/src/commands/shift-files.ts:111–116` writes exactly this scaffold at init:

```ts
{
  path: 'portal.yaml',
  defaultContent: [
    'version: "2.0"',
    'gates: []',
    'routes: []',
  ].join('\n') + '\n',
},
```

So **every project initialized by `paradigm shift`** lands in the vulnerable state until someone manually edits `portal.yaml` into `{}` shape. The 11-call reporter was not unlucky — they were the common case.

### Reproduction (verified)

Created `/tmp/portal-bug-test/portal.yaml` with the v2 scaffold and ran the exact handler logic. Trace output:

```
[trace] raw parse of gates: [] typeof: object isArray: true
[trace] about to assign data.gates[ authenticated ] = gate
[trace] data.gates after assignment: []     <-- named property gone from serializer's view
--- AFTER FILE ---
version: '2.0'
gates: []
routes: []
```

File contents **unchanged**, function returns success.

### `addRouteToPortal` has the identical bug

Same pattern at lines 143–168. `routes: []` in the v2 scaffold triggers the same no-op. This is a **two-tool** bug, not one.

---

## Why It Returned Fake Success

Two compounding patterns:

1. **No post-write verification.** `writePortalFile` calls `fs.writeFileSync` and returns `void`. It does not re-read or parse to confirm the mutation landed. `addGateToPortal` only checks that `writePortalFile` did not throw.
2. **Response built from *intent*, not *result*.** `handlePortalAddGate` in `purpose-portal.ts:1199–1204` constructs the response from the input `id` it was given, not from what's actually in the file after the write. The response would be identical whether the write happened or not.

This is the classic "respond-before-verify" anti-pattern. Combined with silent Array-vs-Object shape coercion in `js-yaml`, it produces undetectable failures.

---

## Proposed Fix (concrete, small, NOT APPLIED)

Three-part fix. All in `packages/paradigm-mcp/src/utils/portal-writer.ts`.

### Part 1 — Normalize Array to Object on read (core fix)

Replace the guard at line 108 with a shape-aware normalizer:

```ts
// BEFORE (line 108)
if (!data.gates) {
  data.gates = {};
}

// AFTER
if (!data.gates || Array.isArray(data.gates)) {
  // v2 scaffold writes `gates: []` (empty sequence), which parses as Array.
  // Preserve any map-shaped entries if somehow mixed; otherwise reset to {}.
  const prev = data.gates;
  data.gates = {};
  if (Array.isArray(prev) && prev.length > 0) {
    // Defensive: if an array-of-gate-objects format was used, migrate
    for (const item of prev) {
      if (item && typeof item === 'object' && 'id' in item) {
        const id = stripSymbolPrefix((item as { id: string }).id);
        data.gates[id] = item as RawPortalGate;
      }
    }
  }
}
```

Apply the same normalization to `data.routes` in `addRouteToPortal`:

```ts
if (!data.routes || Array.isArray(data.routes)) {
  data.routes = {};
}
```

### Part 2 — Verify the write landed (defense in depth)

After `writePortalFile`, re-read and assert the gate is present. Throw if not:

```ts
writePortalFile(filePath, data);

// Verify: re-read and confirm the gate persisted
const { data: verify } = readPortalFile(rootDir);
if (!verify.gates || !verify.gates[gateId]) {
  throw new Error(
    `portal_add_gate write verification failed: gate "${gateId}" ` +
    `not found in ${filePath} after write. ` +
    `Read-back gates shape: ${JSON.stringify(verify.gates)}`
  );
}
return filePath;
```

This is cheap (one extra file read) and converts silent failure into loud failure. Same verification should be added to `addRouteToPortal`.

### Part 3 — Fix `shift-files.ts` scaffold to use object shape

`packages/paradigm/src/commands/shift-files.ts:113–115` — emit `{}` instead of `[]`:

```ts
defaultContent: [
  'version: "2.0"',
  'gates: {}',
  'routes: {}',
].join('\n') + '\n',
```

This removes the trigger at the source for all new projects. Parts 1 & 2 are still needed for projects already on disk.

**Fix complexity:** small (three edits, ~15 lines total, no refactor).

---

## Test Case That Would Have Caught This

A unit test in `packages/paradigm-mcp/src/utils/portal-writer.test.ts` (file does not exist today — no tests cover this utility):

```ts
describe('addGateToPortal', () => {
  it('adds a gate when portal.yaml has v2 scaffold with empty array gates', () => {
    const tmp = mkdtempSync(path.join(tmpdir(), 'portal-'));
    writeFileSync(
      path.join(tmp, 'portal.yaml'),
      "version: '2.0'\ngates: []\nroutes: []\n",
    );

    addGateToPortal(tmp, { id: 'authenticated', description: 'user logged in' });

    // Read back and verify the gate is actually in the file
    const content = readFileSync(path.join(tmp, 'portal.yaml'), 'utf8');
    const parsed = yaml.load(content) as RawPortalData;

    expect(parsed.gates).toBeDefined();
    expect(Array.isArray(parsed.gates)).toBe(false);         // shape assertion
    expect(parsed.gates!['authenticated']).toBeDefined();     // presence
    expect(parsed.gates!['authenticated'].description).toBe('user logged in');
  });

  it('adds a gate when gates key is missing entirely', () => { /* ... */ });
  it('adds a gate when gates is already a populated map', () => { /* ... */ });
  it('preserves existing gates when adding a new one', () => { /* ... */ });
  it('throws if the write silently no-ops (verification layer)', () => { /* ... */ });
});
```

The critical assertion is `expect(Array.isArray(parsed.gates)).toBe(false)` — that's what distinguishes this bug from working behavior. Any test that *only* checks the handler's response JSON would have passed against the broken code.

Same test matrix needed for `addRouteToPortal`.

---

## Severity Justification

**BLOCKING.** Three reasons stacked:

1. **100% reproduction rate** on every freshly-initialized v2 project — not a rare edge case.
2. **Silent + plausible-success response** — downstream agents cannot detect it, cannot retry it, cannot work around it. Debugging requires an agent to independently read the file back, which they don't do.
3. **Data-corrupting by omission** — the security story for v2 (portal.yaml gates for auth/routes) silently has no gates. An agent that thinks it added `^authenticated` to `POST /api/admin` will proceed as if the route is gated when it isn't. This is a security-relevant silent failure.

Not "high": the bug isn't intermittent or hard to hit — it's the default state. This should be fixed before any further v2 portal work.

---

## Relevant Files

- `packages/paradigm-mcp/src/utils/portal-writer.ts` — root-cause site (lines 92–168, both gate and route functions)
- `packages/paradigm-mcp/src/tools/purpose-portal.ts` — handler layer, lines 1179–1227, builds response from intent not result
- `packages/paradigm/src/commands/shift-files.ts` — lines 111–116, emits the v2 scaffold that triggers the bug
- `packages/paradigm-mcp/src/utils/portal-writer.test.ts` — **does not exist**, needs to be created

---

```yaml
# Agent Relay
status: success
summary: |
  Root cause confirmed by direct reproduction: portal-writer.ts treats `gates: []`
  (parsed as JS Array) as truthy, then assigns a named property to the array, which
  js-yaml.dump silently drops on serialization. Result: byte-for-byte identical file
  written back, handler returns success built from input intent, not from verified
  write. Same bug affects addRouteToPortal. Triggers on every `paradigm shift`-init'd
  project because shift-files.ts writes `gates: []` as the v2 scaffold. Severity is
  BLOCKING — silent security-relevant data loss on the default init path.
artifacts:
  - reviews/2026-04-20-portal-add-gate-bug.md
decisions:
  - root cause identified: y
  - severity: blocking
  - fix complexity: small
handoff_to: builder
handoff_context: |
  Apply the three-part fix in the review:
  1. In packages/paradigm-mcp/src/utils/portal-writer.ts, change the `if (!data.gates)`
     guard in `addGateToPortal` (line 108) and the equivalent in `addRouteToPortal`
     (line 153) to ALSO normalize when the value is an Array. Reset to {} and migrate
     any array-of-objects entries defensively.
  2. Add post-write read-back verification in both functions — throw if the written
     gate/route is not present after reading the file back.
  3. In packages/paradigm/src/commands/shift-files.ts (lines 113-115), change the v2
     scaffold to emit `gates: {}` and `routes: {}` instead of `[]`, so new projects
     don't enter the vulnerable state.
  Then create packages/paradigm-mcp/src/utils/portal-writer.test.ts with the test
  matrix in the review — critically including `expect(Array.isArray(parsed.gates))
  .toBe(false)` and a read-back-after-write assertion. Response-level tests alone
  will not catch this class of bug.
  Bump @a-company/paradigm-mcp AND @a-company/paradigm (scaffold change) versions;
  update CHANGELOG with the blocking-bug fix entry; update plugin.json version.
```
