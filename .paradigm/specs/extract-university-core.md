# Spec: Extract `@a-company/university-core`

> **Status:** Builder-ready · **Author:** Arky (architect) · **Date:** 2026-05-31
> **Decision to extract is MADE.** This spec is the HOW.
> **Design-only document — no implementation code here.**

---

## 0. Why (one paragraph, for the record)

Pack-loading + content-loading logic exists in **3 full copies + 1 partial probe (×2 sites)** that have already drifted. We fixed the same bug class three times across v6.6.2–6.6.5 (dual content-base probe, section propagation, pack_id stamping). The multi-tenant pack feature is evolving fast, so every fix must currently be hand-ported across copies — a compounding tax. We extract a **lean, dep-light** shared core that owns the content-loading contract once.

**Guiding principle (load-bearing): LEAN CORE.** `@a-company/university-core` must have **ZERO `@a-company` dependencies**. The `university` package today has zero `@a-company` deps and must keep that property (it is the standalone, lean serve surface). The firm line: **no `portal-core`, no `premise-core`** transitively reachable from `university-core`. See §1.4 for what this forces.

---

## 1. Package identity, placement, ownership

### 1.1 Identity

| Field | Value |
|---|---|
| **npm name** | `@a-company/university-core` |
| **Repo path** | `packages/university-core/` (NEW top-level package; NOT under `premise/`) |
| **Reason for top-level (not `premise/`)** | `premise/*` is the symbol/aspect tier. University content-loading is an orthogonal domain. Co-locating would imply a dependency relationship that does not exist. A sibling top-level package keeps the dependency DAG honest. |
| **`main` / module** | `./dist/index.js`, ESM (matches every other `*-core`) |
| **Initial version** | `0.1.0` (pre-1.0; internal `*` workspace consumers) |

### 1.2 Build-order placement

`university-core` has **zero `@a-company` deps**, so it sorts **first**, before `paradigm-mcp` and before `university`.

- Add to root `package.json` `workspaces` array: `packages/*` already globs it. **Verify** `packages/university-core` matches the existing `packages/*` glob (it does) — no workspaces edit needed beyond confirming.
- Edit root `build:core` to build it **first**:
  ```
  build:core = build university-core → purpose-core → portal-core → probe-core
  ```
  (university-core is independent of the others; first is simplest and safe.)
- `build:packages` (which builds `paradigm-mcp`) and the `university` build both now depend on `university-core` being built. Since `build:core` runs before `build:packages`, paradigm-mcp is covered. **`university` is NOT currently in `build:core`/`build:packages`/`build:cli`** (verified) — see §6.4 for the bundling consequence, which is a TOP-3 RISK.

### 1.3 What `university-core` OWNS

**Content loading / writing (the canonical contract — from `university-loader.ts`):**
`resolveDefaultPackRoot`, `loadOrFabricatePackManifest`, `discoverDisciplineSubPacks`, `loadUniversityConfig`, `loadPackConfig`, `packDeclaresSections`, `loadUniversityIndex`, `loadNote`, `saveNote`, `loadQuiz`, `saveQuiz`, `loadPath`, `savePath`, `loadDiplomas`, `saveDiploma`, `searchContent`, `searchContentWithMeta`, `resolveContentBase`, `rebuildUniversityIndex`, `loadPackIndex`, `validateUniversityContent`, `getAffectedUniversityContent`, `getOnboardingSequence`, plus the internal helpers (`scanPackEntries`, `resolveContentBaseLabel`, `contentBaseHasContent`, `parseFrontmatter`, `serializeFrontmatter`, `normalizeFrontmatter`, `normalizeQuiz`, symbol-coverage/staleness helpers).

**Types** (moved out of `paradigm-mcp/src/types/`): the full `university.ts` type module **and** `pack.ts` (the `PACK_MANIFEST_FILENAME`, `PACKAGE_JSON_POINTER_FIELD` consts + `PackManifest`/`PackLocation`/`Section`/`SectionStyle` types). Cycle check **PASSED**: `types/university.ts` and `types/pack.ts` have **zero imports** (verified) — clean to move.

**SLIM pack-discovery** (see §1.4 — reimplemented, NOT the full pack-loader): `discoverPacks`, `loadPackManifest`, `normalizeSections`, `resolveEntryAddress`, the cache, the npm-pointer scan.

### 1.4 CRITICAL DECISION — slim pack-discovery vs. depend on existing `pack-loader`

**Recommendation: REIMPLEMENT a slim pack-discovery inside `university-core`. Do NOT depend on the existing `pack-loader`.**

**Why depending on `pack-loader` fails the lean mandate:** `pack-loader.ts` imports `./yaml-validator.js` (→ `@a-company/portal-core` via `classifyYamlError`, + `./strict-mode.js`) and `./pack-schema.js` (→ `zod`). Pulling `pack-loader` into `university-core` drags **portal-core** into the core and transitively into `university` — violating "no `@a-company` deps." Unacceptable.

**What moves vs. what is reimplemented:**

| Concern | Decision |
|---|---|
| `loadPackManifest` | **Reimplement** with raw `js-yaml` + a required-field presence check (id/name/version/schema_version/tenant_kind + tenant_kind enum). DROP the `safeLoad`/`classifyYamlError` (portal-core) path. On parse failure, throw `PackLoadError('manifest-unparseable', <classifier-only>)` derived from the js-yaml error name only — never the manifest body. |
| `normalizeSections` (loader-strict variant) | **Reimplement** in core (see §1.5 sub-decision). This is the strict/throwing variant used by `loadPackManifest` + onboarding grouping. |
| `discoverPacks` + npm-pointer scan + cache | **Move** nearly verbatim (they only use `fs`/`path` + `loadPackManifest`). No portal-core, no zod. |
| `resolveEntryAddress` | **Move** verbatim (pure string logic). |
| `PackLoadError` class | **Move** verbatim. |
| `yaml-validator`, `pack-schema`, `strict-mode` | **DO NOT MOVE.** Stay in `paradigm-mcp`. They serve portal/strict-mode concerns beyond university. |

**Circular-dep watch:** `university-core` must NOT import anything from `paradigm-mcp`. The slim `loadPackManifest` is the only place the old code reached for `yaml-validator`; reimplementing it severs that edge. Confirm no residual import of `yaml-validator`/`pack-schema`/`strict-mode`/`mcp-logger` survives the move.

### 1.5 Sub-decision — core's `normalizeSections` validation strategy

Core needs its **own** strict `normalizeSections` (the onboarding/manifest path expects the pack-loader contract: synthesize `{id:'main', name:'Curriculum', order:1, style:'track', default:true}` on absent/empty, single-section auto-promote, duplicate-id reject, "at most one default" reject, stable sort by order-then-id, **throw** on schema violation). Two ways to get it; **both keep `university` free of `@a-company` deps** — choose at build time:

- **Option A (recommended for true lean): hand-roll without zod.** Reimplement the validation in plain TS (shape checks + the four invariants). Adds NO npm deps. **Risk:** hand-rolled validation on a de-dup task is itself drift risk. **Mitigation (mandatory):** pin it with a golden deep-equality matrix (§5.3) asserting byte-equality to today's pack-loader output across: `undefined`→Curriculum/1, `[]`→Curriculum/1, single-section-no-default→auto-promoted, duplicate-id→throw, two-defaults→throw, multi-section→sorted by order-then-id.
- **Option B: copy `pack-schema.ts` into core + take `zod`.** `zod` is a **leaf npm dep, not an `@a-company` drag** — it does NOT violate the lean mandate. Copy `pack-schema.ts` (zod schema only; it imports nothing else) into `university-core` and reuse the existing `normalizeSections` body verbatim. Lower drift risk; one small npm dep.

**Arky's call: Option B.** The lean mandate is about avoiding the `@a-company` chain (portal-core/premise-core), not about avoiding a leaf validator. Copying `pack-schema.ts` + taking `zod` gives byte-identical section behavior with near-zero reimplementation risk, which is the whole point of de-duping. Builder may fall back to Option A only if `zod` bundle weight in the `university` serve bundle proves problematic (§6.4); if so, the §5.3 golden matrix is the gate.

> **NOTE — the server's `sections.ts` `normalizeSections` is a DIFFERENT function and is OUT OF SCOPE.** See §4.3. Do not unify it into core's.

### 1.6 `package.json` deps for `university-core` (MINIMAL — the firm line)

```jsonc
{
  "name": "@a-company/university-core",
  "version": "0.1.0",
  "type": "module",
  "main": "./dist/index.js",
  "dependencies": {
    "js-yaml": "^4.1.0",
    "zod": "^3.23.0"          // Option B only; OMIT if Option A chosen
  }
}
```
**No `@a-company/*` dependency. No express. No chalk.** That is the contract.

---

## 2. The logger seam

The three callers log through different facilities: `mcp-logger` (`ParadigmLogger`), CLI `cli-output`, and the server's own chalk-based local `log`. The loader only ever calls **`log.component(name).warn(msg, data?)`** (verified — no info/error/gate usage on the warn path inside the loader).

**Design: inject a narrow logger interface with a no-op default.**

```ts
// university-core/src/logger.ts
export interface UniversityCoreLogger {
  warn(message: string, data?: Record<string, unknown>): void;
}

const NOOP_LOGGER: UniversityCoreLogger = { warn() {} };
```

**Mechanism:** module-level settable default + per-call override is overkill. Use a **module-level injectable singleton** with a setter, mirroring how the codebase already treats `mcp-logger`'s `log` as a module singleton:

```ts
let activeLogger: UniversityCoreLogger = NOOP_LOGGER;
export function setUniversityCoreLogger(logger: UniversityCoreLogger): void { activeLogger = logger; }
// internal call sites: activeLogger.warn(...)
```

**Adapter at each consumer (one line each):**
- **paradigm-mcp:** `setUniversityCoreLogger({ warn: (m, d) => log.component('#university-loader').warn(m, d) })` — wire once at MCP server startup (or lazily on first university tool call).
- **CLI:** `setUniversityCoreLogger({ warn: (m, d) => warn(/* cli-output */ formatLine(m, d)) })` — or simply leave the no-op default if the CLI surfaces warnings elsewhere; CLI loader paths today swallow most warnings, so **no-op default is acceptable** for the CLI.
- **server:** does not consume the loader (it gets only `resolveContentBase` from core — §4.3), so no logger wiring needed there.

Rationale for singleton over per-call param: zero signature churn across ~25 exported functions; the no-op default means a consumer that forgets to wire it stays silent rather than crashing — matching today's "warnings are advisory" behavior.

---

## 3. Write-path reconciliation (read + write into ONE contract)

Today the two write paths **diverge by design**, and that divergence is the riskiest convergence in this spec:

| | MCP `saveNote` (loader) | CLI `saveNote` (storage) |
|---|---|---|
| pack_id stamp | **always**, via `loadOrFabricatePackManifest(effectivePackRoot).id` (fabricates id from dir basename when no pack.yaml) | **only when `packRoot` explicit**, via `safeLoadPackId` (raw-YAML; null when no pack.yaml) |
| effectivePackRoot when no packRoot | `resolveDefaultPackRoot(rootDir)` — may resolve to a **discovered first-party pack** | always `<rootDir>/.paradigm/university` |

**These produce different files AND different target dirs for the same call.** Naively collapsing onto the MCP path would change CLI write behavior (start stamping pack_id on every write, possibly retarget the dir). That is a **user-visible delta** and must be enumerated, not hidden (§5.2, delta D2).

**The ONE contract (core owns it):**

```ts
export function saveNote(rootDir, frontmatter, body, opts?: {
  packRoot?: string;
  stampPackId?: boolean;          // default TRUE
  resolveDefaultPack?: boolean;   // default TRUE
}): string
```

- `effectivePackRoot = opts.packRoot ?? (opts.resolveDefaultPack ? resolveDefaultPackRoot(rootDir) : path.join(rootDir, UNIVERSITY_DIR))`
- pack_id stamping: when `opts.stampPackId !== false`, stamp via `loadOrFabricatePackManifest(effectivePackRoot)?.id` (the loader-strength path, which subsumes `safeLoadPackId`).

**Consumer call sites preserve today's behavior exactly (zero delta) by passing flags:**
- **MCP** calls `saveNote(root, fm, body, { packRoot })` → defaults give today's MCP behavior (always stamp, resolveDefault on). **Zero change.**
- **CLI** calls `saveNote(root, fm, body, { packRoot, stampPackId: !!packRoot, resolveDefaultPack: false })` → reproduces CLI's "stamp only when packRoot explicit; never resolve to first-party" behavior. **Zero change.**

This keeps the **read+write under one implementation** while letting each consumer keep byte-identical behavior via flags. The two divergent `safeLoadPackId` (raw-YAML) and `loadOrFabricatePackManifest` paths collapse into the single `loadOrFabricatePackManifest`-backed stamp; `safeLoadPackId` is **deleted** (the `stampPackId` flag covers the CLI's "only-when-explicit" rule). Apply the identical flag pattern to `saveQuiz` (and `saveDiploma` where the CLI variant lacks pack-scoping — pass `{ resolveDefaultPack: false }` to hold the CLI behavior, or simply do not change the CLI diploma path in this refactor; diplomas are project-level — see §6.6 follow-ups).

---

## 4. Consumer migration plan (per copy)

Pattern throughout = **the anchor-path shim precedent** (`paradigm-mcp/src/utils/anchor-path.ts` re-exports from `@a-company/premise-core` so its 4 importers never changed). Leave thin re-export shims so unrelated importers stay untouched.

### 4.1 COPY 1 — `paradigm-mcp/src/utils/university-loader.ts` (canonical)

- **Delete** the implementation. **Replace with a re-export shim** of every public symbol from `@a-company/university-core` (functions + the `OnboardingSequence`/`AffectedUniversityContent` interfaces).
- The 3 importers — `tools/reindex.ts` (`rebuildUniversityIndex`), `tools/ripple.ts` (`getAffectedUniversityContent`), `tools/university.ts` (many) — **untouched** (they import from `../utils/university-loader.js`, which now re-exports).
- Types: `paradigm-mcp/src/types/university.ts` and `types/pack.ts` → **delete bodies, re-export from `@a-company/university-core`** (so the ~6 type importers across paradigm-mcp stay untouched). Add `@a-company/university-core: "*"` to `paradigm-mcp` deps.
- Wire the logger seam (§2) at MCP startup.

### 4.2 COPY 2 — `paradigm/src/core/university/storage.ts` (CLI)

- **Delete** the implementation. **Re-export from `@a-company/university-core`** through the existing barrel `core/university/index.ts` (already the single import surface for **10 CLI command files** — verified: status/list/validate/show/add/serve/quiz + shift/doctor/config-schema). Those 10 importers stay **untouched**.
- Add `@a-company/university-core: "*"` to the **CLI** `package.json`. **This is allowed** — the CLI's `@a-company` deps were portal-core + registry-client; university-core is lean (no transitive `@a-company`), so adding it does NOT pull paradigm-mcp or any heavy chain into the CLI. (CLI still **cannot** import paradigm-mcp; this respects that — university-core is the shared substrate, not paradigm-mcp.)
- CLI `core/university/types.ts` → re-export from core (CLI types are a **strict subset** of core's; core is the superset — see §4.5).
- `safeLoadPackId` is **deleted**; `saveNote`/`saveQuiz` call core with the flags in §3.

### 4.3 COPY 3 — `packages/university/src/server/index.ts` (serve server)

**Scope is deliberately MINIMAL** — this is the lean package; touch it as little as possible.

- **Replace ONLY** the server-local `resolveContentBase` (index.ts:116) with `import { resolveContentBase } from '@a-company/university-core'`. The server's local version diverges (probes `['notes','quizzes','paths']` with `readdirSync().length>0`; core uses `['notes','policies','quizzes','paths']` with an extension filter) — adopting core's closes that divergence (§5.2, delta D3).
- Add `@a-company/university-core: "*"` to `university` deps. **Verify this does NOT regress the zero-`@a-company`-dep property in spirit:** university-core has no `@a-company` deps, so `university`'s transitive `@a-company` set stays empty-except-university-core. This is the one acceptable `@a-company` edge for `university`, and it exists precisely to kill duplication. Confirm the serve bundle still builds (§6.4).
- **`buildPackConfig` STAYS in the server** (it's UI-payload shaping, server-specific). Do not move it to core.
- **`sections.ts` STAYS in the server and is OUT OF SCOPE.** Its `normalizeSections` is a **different function with a deliberately different, test-locked contract**: drop-and-warn (never crash the UI) and a default of `{id:'main', name:'Main', order:0}` — hard-asserted at `packages/university/tests/sections.test.ts:45`. It is NOT one of the four content-loading copies. Unifying it would break a locked test and drag UI-resilience semantics into core. **Leave it alone.**

### 4.4 COPY 4 (partial, ×2) — the `countPackEntries` probes

- `paradigm-mcp/src/tools/university.ts:150` `countPackEntries` and `paradigm/src/commands/university/selectors.ts:158` `countPackEntries` are two copies of the same probe.
- **Unify both onto core.** Export a single canonical probe from core that uses the **same** `resolveContentBaseLabel` machinery as the loader. Recommended API: core exports `countPackEntries(packRoot): number` whose subdir set is `['notes','policies','quizzes','paths']` (the loader's set) and which returns the count from the **first base that contains content** (the C4 rule) — closing **T-2026-05-31-001 / the probe divergence**.
- Replace both local `countPackEntries` definitions with imports of core's. The MCP probe currently has the same `['notes','policies','quizzes','paths']` set; the CLI probe matches. Unifying guarantees they can never re-drift. **Delta note (§5.2 D4):** behavior is already aligned across both probes today, so unifying is expected to be byte-neutral — but the drift-guard test (§5.4) must assert it.

### 4.5 Type-shape merge (core = MCP superset)

Core exports the **MCP superset**:
- `UniversityIndexEntry`: includes `category?` + `author` (CLI lacked `category`).
- `UniversityFilter`: includes `author?`, `category?`, `track?` (CLI lacked these).
- `searchContentWithMeta` returns `{ entries, total, returned }` (MCP shape; CLI returned `{ entries, total }`).

CLI consumers **gain optional fields + a `returned` key — additive, safe.** Verified: the only `searchContentWithMeta` caller in the CLI is its own `storage.test.ts:198`, which destructures `{ entries, total }` — unaffected by the added `returned`. Confirm during build that no CLI code does exhaustive/exact-shape assertions on these types (none found).

---

## 5. Behavior-neutral guarantee + DRIFT-GUARD tests

> **The honest framing.** A blanket "ZERO user-facing change" claim is **self-contradictory** with deliverables #3/#4 and the server `resolveContentBase` swap, which are *divergence-CLOSING* by design. The named green-keepers (ai-literacy 5-section serve; 286/46/355 suites) will NOT catch the deltas, because the divergences only fire on inputs those suites don't exercise. So the guarantee is split into two sections.

### 5.1 Section A — READ-PATH BYTE-IDENTICAL (the true zero-change guarantee)

For the read/index/search/onboard/validate paths, output must be **byte-identical** before and after extraction.

**Golden test (new, lives in `university-core/src/__tests__/golden.test.ts`):** fixture packs covering BOTH layouts — a `content/`-layout project pack AND a `src/content/`-layout first-party pack — assert identical:
- `rebuildUniversityIndex` / `loadPackIndex` entry sets (id, type, file path, section, order, category).
- `getOnboardingSequence` output incl. the section-grouped branch (use a fixture pack that DECLARES sections + one that does not).
- `searchContent` / `searchContentWithMeta` results + totals.
- `validateUniversityContent` issue sets (dangling-section-ref, empty-section, broken-path-step).

Method: snapshot today's `university-loader.ts` output against the same fixtures, then assert core reproduces it.

### 5.2 Section B — ENUMERATED CONVERGENCE DELTAS (intentional, internal/edge)

Each delta below is **intentional**, names the consumer that changes, and the argument it is safe.

| ID | Delta | Consumer affected | Trigger (why named tests miss it) | Safety argument |
|---|---|---|---|---|
| **D1** | core `normalizeSections` (strict) now the single section-synthesis for the **loader/onboarding** path | paradigm-mcp + CLI loader | Only fires when a pack has NO `sections:` block AND onboarding/manifest path runs. ai-literacy DECLARES sections → live serve never synthesizes. | Output pinned byte-equal to today's pack-loader `normalizeSections` by the §5.3 golden matrix → **no actual delta**, just a new owner. |
| **D2** | CLI `saveNote`/`saveQuiz` write path now routes through core's unified `saveNote` (flags in §3) | CLI write commands | Only fires on `university add`/`quiz` writes; unit suites may not round-trip a write with/without `packRoot`. | Flags (`stampPackId: !!packRoot`, `resolveDefaultPack: false`) reproduce CLI behavior exactly → **no delta** when flags correct. The drift-guard (§5.4) asserts the round-trip. |
| **D3** | server `resolveContentBase` adopts core's (adds `policies/`, extension-filter, contains-content fallback) | `university` serve | Fires only for a **policies-only pack** or a pack with stray non-content files. ai-literacy is notes/quizzes/paths → unaffected. | Server's old probe was the **divergent/buggy** one (reviewer-flagged: omits `policies/`, no fallback). Adopting core FIXES it. The only "delta" is a policies-only pack now resolves correctly — a bugfix, documented as such. |
| **D4** | both `countPackEntries` probes unified onto core | pack_list (MCP + CLI) | T-2026-05-31-001 closure. | Both probes already agree today → expected byte-neutral; §5.4 asserts it. |

**The spec's position:** Section A is the contract. Section B deltas are internal/unsupported-edge-case convergences that a reviewer should accept *because they are enumerated*, not buried.

### 5.3 `normalizeSections` golden matrix (gates D1)

Deep-equality matrix asserting core's section synthesis === today's pack-loader output:
`undefined → [{main,Curriculum,1,track,default:true}]`; `[] → same`; single-section-no-default → auto-promoted `default:true`; duplicate-id → throws `PackLoadError('manifest-invalid')`; two-defaults → throws; `[{order:2},{order:0},{order:1}]` → sorted `[0,1,2]` then id. (If Option A chosen this is **mandatory**; if Option B, it's a cheap regression pin.)

### 5.4 DRIFT-GUARD tests (catch the stealth cases the named suites miss)

New fixtures + assertions that exercise exactly the inputs the 286/46/355 + live-serve don't:
1. **No-`sections` pack through `buildPackConfig`** (server) → asserts default-section path still renders (catches a D1-adjacent regression in the server's own `sections.ts`, which we did NOT change — pins that we didn't accidentally).
2. **Policies-only pack** through `resolveContentBase` (all consumers) → asserts the base resolves (catches D3).
3. **`saveNote` round-trip with AND without `packRoot`** (core) → asserts target dir + pack_id stamping match the per-consumer contract (catches D2).
4. **`countPackEntries` parity** — same fixture through MCP-path and CLI-path imports → identical count (catches D4 re-drift).

### 5.5 The "no copy reappears" guard

Add a repo-level guard (a small test or a `paradigm doctor`/lint check) that **fails CI if a second definition of the canonical symbols reappears** outside `university-core`. Concretely: grep-assert that `function scanPackEntries`, `function resolveContentBaseLabel`, `function countPackEntries`, and `function safeLoadPackId` exist in **exactly one** location (`packages/university-core/src/`). This is the structural lock that prevents the 4-copy situation from regrowing.

### 5.6 Existing suites that MUST stay green

- paradigm-mcp **286**, university **46**, CLI **355** — all green.
- Live smoke: `serve --pack ai-literacy` → `mode:'project'`, **5 sections**. (ai-literacy declares sections, so it exercises the section-aware path but NOT the synthesis default — that's why §5.4.1 adds the missing case.)

---

## 6. Phased plan, build order, blast radius, versioning

### 6.1 Phase 0 — Scaffold core (no consumer changes yet)
1. Create `packages/university-core/` (package.json §1.6, tsconfig matching sibling `*-core`).
2. **Move** types (`university.ts`, `pack.ts`) into core. (Cycle-check PASSED.)
3. **Move** content loader (from `university-loader.ts`) into core — superset implementation.
4. **Reimplement/move** slim pack-discovery (§1.4) + core `normalizeSections` (§1.5).
5. Add logger seam (§2). Add core's `saveNote`/`saveQuiz` unified contract (§3) + `countPackEntries` (§4.4).
6. Wire `build:core` to build it first.
7. Land §5.1 golden + §5.3 matrix + §5.4 drift-guards against fixtures. **Core is independently green before any consumer is touched.**

### 6.2 Phase 1 — Migrate `paradigm-mcp` (§4.1)
Shim `university-loader.ts`; re-export types; wire MCP logger; replace MCP `countPackEntries`. **Gate: paradigm-mcp 286 green.**

### 6.3 Phase 2 — Migrate `university` server (§4.3)
Swap ONLY server `resolveContentBase`. Add dep. **Gate: university 46 green + `serve --pack ai-literacy` → mode:project, 5 sections.** This phase carries the bundling risk (§6.4) — verify the bundle at this gate, not just unit tests.

### 6.4 Phase 3 — Migrate CLI (§4.2)
Shim `core/university/storage.ts` via the barrel; add dep; replace CLI `countPackEntries` (selectors.ts); apply §3 write flags. **Gate: CLI 355 green + a manual `university add` write round-trip.**

> **TOP-3 RISK — the serve bundle (Phase 2 + Phase 3).** The CLI **bundles** the university server and loads it via dynamic `import('@a-company/university/server')` (verified in `serve.ts:52`). `university` is NOT in the standard `build:*` chain. **Decision required & stated in this spec:** `university-core` must be **bundled INTO** `university`'s server build (and/or into the CLI's university-server bundle), not left as an unresolved external at serve time. If the bundler treats `@a-company/university-core` as external and it isn't present at runtime, **`serve` breaks while every unit test passes.** Builder MUST: (a) confirm the `university` build (tsup/esbuild/tsc config) bundles or vendors `university-core`; (b) confirm the CLI's `build-conductor`/serve-bundle step includes it; (c) add a post-build smoke that actually launches `serve` from the built CLI artifact, not just from source. This is the single most likely way to ship a green-tests-but-broken-serve regression.

### 6.5 Versioning / publish
- **`@a-company/university-core`** — NEW, `0.1.0`.
- **`@a-company/paradigm-mcp`** — bump (consumes new core, tools touched). Per MEMORY: bumps when MCP tools change.
- **`@a-company/paradigm`** (CLI) — bump (always bumps on release; consumes core; serve bundle changes).
- **`@a-company/university`** — bump (server `resolveContentBase` swap + new dep + bundle change). Per MEMORY: bumps only on university changes — this IS one.
- **Plugin** `plugins/paradigm/.claude-plugin/plugin.json` — bump alongside (MEMORY: missed repeatedly).
- CHANGELOG entry per MEMORY conventions (no `[Unreleased]` on main).

### 6.6 In-scope vs. follow-up
**In scope:** all 4 copies (loader, CLI storage, server `resolveContentBase`, both probes) + type/discovery move + write reconciliation + drift-guards.
**Follow-up (explicitly NOT this refactor):**
- Unifying the server's `sections.ts` `normalizeSections` (different contract, test-locked — §4.3). Revisit only if UI ever needs the strict default.
- Migrating `buildPackConfig` into core (UI-payload concern; leave server-local).
- CLI `saveDiploma` pack-scoping (CLI variant lacks it; diplomas are project-level — don't expand scope here).
- Deleting `yaml-validator`/`pack-schema`/`strict-mode` from paradigm-mcp (they have non-university uses; leave).

### 6.7 Riskiest steps (flagged)
1. **Serve bundle (§6.4)** — green tests, broken runtime. Highest.
2. **Write-path flags (§3, D2)** — wrong flag default silently changes where CLI writes files / whether pack_id is stamped. Mitigated by §5.4.3.
3. **`normalizeSections` reimplementation (D1)** — drift on a de-dup task. Mitigated by Option B + §5.3.
4. **Accidentally unifying the server's `sections.ts`** — breaks the locked `Main`/order-0 test. Mitigated by the explicit OUT-OF-SCOPE call (§4.3) + §5.4.1 guard.

---

## Agent Relay

```yaml
relay:
  from: architect
  to: builder
  status: complete
  summary: >
    Design for extracting @a-company/university-core — a lean, ZERO-@a-company-dep
    shared package owning the content loader, university+pack types, and a SLIM
    reimplemented pack-discovery (no pack-loader, so no portal-core/zod-chain drag
    into the lean university package). Reconciles the read+write contract (unified
    saveNote with stampPackId/resolveDefaultPack flags so each consumer keeps
    byte-identical behavior), an injected no-op-default logger seam, and unifies
    both countPackEntries probes (closes T-2026-05-31-001). All four copies become
    re-export shims (anchor-path precedent) so unrelated importers stay untouched.
    Behavior guarantee is split: READ-path byte-identical (golden) + four ENUMERATED
    intentional convergence deltas with drift-guard fixtures for the stealth cases
    the 286/46/355 suites and live serve don't exercise. Server sections.ts is
    explicitly OUT OF SCOPE (test-locked, different contract).
  artifacts:
    phase_0_scaffold_core:
      - packages/university-core/package.json        # new; deps: js-yaml [+ zod if Option B]; NO @a-company
      - packages/university-core/src/index.ts         # barrel (superset exports)
      - packages/university-core/src/types/university.ts  # moved from paradigm-mcp/src/types
      - packages/university-core/src/types/pack.ts        # moved (cycle-check PASSED)
      - packages/university-core/src/loader.ts        # moved from university-loader.ts (superset)
      - packages/university-core/src/pack-discovery.ts # slim reimpl: loadPackManifest/discoverPacks/normalizeSections/resolveEntryAddress
      - packages/university-core/src/logger.ts        # UniversityCoreLogger + setUniversityCoreLogger + NOOP
      - packages/university-core/src/__tests__/golden.test.ts        # §5.1
      - packages/university-core/src/__tests__/normalize-sections.test.ts  # §5.3
      - packages/university-core/src/__tests__/drift-guard.test.ts   # §5.4
      - "root package.json: build:core builds university-core FIRST"
    phase_1_paradigm_mcp:
      - packages/paradigm-mcp/src/utils/university-loader.ts  # → re-export shim
      - packages/paradigm-mcp/src/types/university.ts          # → re-export shim
      - packages/paradigm-mcp/src/types/pack.ts                # → re-export shim
      - packages/paradigm-mcp/src/tools/university.ts          # countPackEntries → import core; logger wire
      - packages/paradigm-mcp/package.json                     # + @a-company/university-core
    phase_2_university_server:
      - packages/university/src/server/index.ts   # ONLY resolveContentBase → core import
      - packages/university/package.json          # + @a-company/university-core
      - "VERIFY serve bundle includes university-core (TOP-3 RISK)"
    phase_3_cli:
      - packages/paradigm/src/core/university/storage.ts  # → re-export shim (delete safeLoadPackId)
      - packages/paradigm/src/core/university/types.ts     # → re-export shim
      - packages/paradigm/src/core/university/index.ts     # barrel re-exports core
      - packages/paradigm/src/commands/university/selectors.ts  # countPackEntries → import core
      - packages/paradigm/package.json            # + @a-company/university-core
      - "saveNote/saveQuiz call core with { stampPackId: !!packRoot, resolveDefaultPack: false }"
  decisions:
    - id: D-package-placement
      decision: "New top-level packages/university-core (NOT under premise/); first in build:core."
    - id: D-slim-discovery
      decision: "Reimplement slim pack-discovery in core; do NOT depend on pack-loader (it drags portal-core via yaml-validator). zod allowed (leaf, not @a-company)."
    - id: D-normalize-sections
      decision: "Option B — copy pack-schema.ts + take zod for byte-identical strict section synthesis. Option A (hand-roll, no zod) is the fallback, gated by the §5.3 golden matrix."
    - id: D-logger-seam
      decision: "Injected module-singleton UniversityCoreLogger { warn(msg,data?) } with no-op default; consumers wire their own logger once."
    - id: D-write-contract
      decision: "Unified saveNote(rootDir,fm,body,{packRoot,stampPackId,resolveDefaultPack}); flags reproduce each consumer's current behavior exactly. safeLoadPackId deleted."
    - id: D-sections-ts-out-of-scope
      decision: "Server sections.ts normalizeSections stays put — different, test-locked contract (Main/order-0, drop-and-warn). NOT unified."
    - id: D-behavior-guarantee-split
      decision: "READ-path byte-identical (Section A) + 4 enumerated convergence deltas (Section B), not a blanket zero-change claim."
  risks:
    - severity: high
      risk: "Serve bundle: university-core left external → serve breaks at runtime while all unit tests pass. CLI bundles the server via dynamic import. MUST add a built-artifact serve smoke."
    - severity: medium
      risk: "Write-path flag defaults wrong → CLI silently writes to a different dir or starts stamping pack_id. Guarded by §5.4.3 round-trip."
    - severity: medium
      risk: "normalizeSections reimplementation drift (D1). Guarded by Option B + §5.3 golden matrix."
    - severity: medium
      risk: "Accidentally unifying server sections.ts → breaks locked test sections.test.ts:45. Guarded by explicit out-of-scope + §5.4.1."
    - severity: low
      risk: "express version skew (university ^4, CLI ^5) — IRRELEVANT to core: core has no express dep. Noted to preempt confusion."
  handoff_to: builder
  handoff_context: >
    Build phases strictly in order (0→1→2→3); each phase has a green-gate that must
    pass before the next. Phase 0 lands a fully-green standalone core (golden +
    normalize-sections matrix + drift-guards) BEFORE touching any consumer. The
    single most dangerous step is Phase 2/3 bundling (§6.4): do not trust unit tests
    — launch `serve` from the BUILT CLI artifact and confirm mode:project + 5 sections
    on ai-literacy. Use the anchor-path shim at packages/paradigm-mcp/src/utils/anchor-path.ts
    as the exact re-export template. Pick normalizeSections Option B unless zod bloats
    the serve bundle, in which case Option A behind the §5.3 matrix. Per project habits:
    full build+link (conductor swift, paradigm-mcp, paradigm CLI) before declaring ready;
    bump paradigm-mcp + paradigm + university + plugin.json + CHANGELOG; do NOT publish
    (user runs npm publish). Record lore — this touches 4 packages.
```
