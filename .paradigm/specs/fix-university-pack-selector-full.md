# Spec: University Pack-Selector Full Fix (3 surfaces)

> **Status:** builder-ready · **Author:** Arky (architect) · **Date:** 2026-05-31
> **Handoff:** → builder · **Target:** one release (v6.6.5 or v6.7.0 — versioner's call)
> **Scope:** CLI `serve` + HTTP server, CLI commands + storage, remaining MCP gaps.

---

## 0. Problem in one paragraph

Pack-loading logic was duplicated and only the **MCP loader**
(`packages/paradigm-mcp/src/utils/university-loader.ts`) was fixed in v6.6.4 to honor
the pack selector (`packRoot` threading + dual-base probe + scan-fallback). Two other
surfaces still ignore the selector: the **CLI storage layer**
(`packages/paradigm/src/core/university/storage.ts`, a near-exact stale fork of the
loader) and the **serve HTTP server** (`packages/university/src/server/index.ts`, which
hardcodes project-pack manifest resolution). A separate Commander wiring bug makes
`serve --port` a no-op. This spec fixes all three surfaces plus three MCP gaps, with
the **default / no-selector path byte-identical everywhere** as the hard acceptance gate.

---

## 1. Consolidation decision — **Option C (hybrid-lean): port now, extract later**

### 1.1 Package-boundary evidence (verified)

| Package | Internal deps (package.json) | Can import the MCP loader? |
|---|---|---|
| `packages/paradigm` (CLI) | `@a-company/portal-core`, `@a-company/registry-client` only | **No** — does not depend on `paradigm-mcp` |
| `packages/paradigm-mcp` (MCP) | portal-core, premise-core, probe-core, purpose-core, paradigm-logger, sentinel | n/a (owns the loader) |
| `packages/university` (serve server) | `chalk`, `express`, `js-yaml`, `open` — **no internal deps** | **No** — pure leaf, deliberately dependency-light |

So full unification (Option A) requires moving the shared loader **down** into a new
low package both the CLI and MCP can import.

### 1.2 Why NOT Option A in this release

The MCP loader's pack machinery does not stand alone. `university-loader.ts` imports
from `pack-loader.ts`, whose own import tree is:

```
pack-loader.ts
 ├─ ../types/pack.ts            (zod-ish types, clean)
 ├─ ./pack-schema.ts           → zod (clean)
 ├─ ./yaml-validator.ts        → js-yaml, zod, @a-company/portal-core, ./strict-mode.ts
 └─ ./mcp-logger.ts            → @a-company/paradigm-logger   ← CLI does NOT depend on this
```

Extracting a shared `@a-company/university-core` leaf therefore drags `pack-loader`,
`pack-schema`, `yaml-validator`, `strict-mode`, `types/pack`, and a logger seam across a
**new published package** with version bumps in two consumers — against the user's
versioning discipline and the "ship thoroughly in ONE release" goal. The duplication is
only **2-way** (MCP + CLI; see §1.4), so the blast radius of A exceeds its payoff for
this release.

### 1.3 Decision

**Option C — hybrid-lean:**
1. **Now:** port the v6.6.4 loader fixes into `storage.ts` (mechanical, no new package,
   no cross-package version churn), fix the server's manifest resolution, fix the MCP
   onboard gaps. Every changed surface keeps its default path byte-identical.
2. **Follow-up (tracked):** extract `@a-company/university-core` so the loader can't
   re-fork. Fold **T-2026-05-31-001** (probe divergence) into that extraction task —
   the divergence disappears when there is a single `resolveContentBase`.

Rationale: C fixes 100% of the user-visible bugs this release at low risk; A is the
right *eventual* shape but is a package-creation project, not a bugfix. We pay a small
known debt (storage.ts stays a fork until the follow-up) and we make that debt **loud**
(see §6, the drift-guard test).

### 1.4 Reframe: the loader dup is 2-way, the server is a DIFFERENT bug

The content-**loader** is duplicated in exactly two files: `university-loader.ts` and
`storage.ts`. The **serve server does not duplicate the content loader** — it never
reads `notes/`/`quizzes/` to build an index. Its bug is **pack manifest/mode
resolution**: `createApp` (server/index.ts:151-229) hardcodes
`<projectDir>/.paradigm/university/pack.yaml` for mode detection and otherwise defaults
to first-party `mode:'paradigm'`. So "a shared loader imported by all three" is the
wrong mental model — extraction (A) serves MCP+CLI only; the server needs its own fix
regardless of A vs C. This spec treats the server as a standalone surface.

---

## 2. Per-surface fix design

### SURFACE 1 — CLI `serve` + HTTP server

#### Bug A1 (HIGH) — `serve --pack` mounts the wrong pack

**Root cause:** `serve.ts` computes `contentDir` from the resolved pack but forwards only
`{port, open, contentDir, uiDistPath, projectDir}` to `startServer()`. The server
(server/index.ts:155-160) detects mode from `<projectDir>/.paradigm/university/pack.yaml`
— never the selected pack — so `/api/pack-config` returns project/first-party defaults
regardless of `--pack`.

**Fix — thread the pack root + id into the server, and make pack-config a pure,
testable function:**

1. **`ServerOptions` / `createApp` options** (server/index.ts:62-68, 136) — add two
   optional fields, fully back-compat:
   ```ts
   export interface ServerOptions {
     port: number; open?: boolean; contentDir?: string; uiDistPath?: string;
     projectDir?: string;
     packRoot?: string;   // NEW: absolute path to the selected pack root
     packId?: string;     // NEW: resolved pack id (display + logging)
   }
   ```
2. **Extract `buildPackConfig(options): PackConfig`** — lift the inline mode/branding/
   sections block (server/index.ts:151-229) verbatim into a pure exported function. This
   is BOTH where the bug lives AND the no-server test seam (§5). New resolution rule
   inside it:
   - **manifest path** = `packRoot ? path.join(packRoot, 'pack.yaml') : <projectDir>/.paradigm/university/pack.yaml` (current behavior when `packRoot` absent).
   - When `packRoot` is set and its `pack.yaml` exists → `mode:'project'`, load that
     manifest's branding/theme/version/sections.
   - When `packRoot` is set but the manifest is first-party (`tenant_kind: first-party`)
     → keep `mode:'paradigm'` branding but still surface the manifest's `sections` (so a
     first-party pack served by id renders its own sections).
   - When `packRoot` absent → **identical** to today (project-dir probe, else paradigm
     defaults).
3. **`createApp`** calls `buildPackConfig(options)` instead of the inline block; passes
   `options.packRoot ?? options.projectDir`-derived `contentDir` unchanged.
4. **`serve.ts`** (serve.ts:73-79) — forward the new fields:
   ```ts
   await startServer({
     port, open: shouldOpen, contentDir, uiDistPath,
     projectDir: process.cwd(),
     packRoot: ctx ? (ctx.subPackRoot ?? ctx.packRoot) : undefined,
     packId:   ctx ? (ctx.subPackId   ?? ctx.packId)   : undefined,
   });
   ```

#### Bug A1b (MED, found while designing) — serve.ts:59 hardcodes `content/`

`serve.ts:59` does `path.join(ctx.subPackRoot ?? ctx.packRoot, 'content')`. A
first-party / `src/content/`-layout pack mounts an **empty** dir. **Fix:** apply the
same dual-base probe used by the loader — prefer `content/`, else `src/content/`, else
fall back to bundled content. Reuse `resolveContentBase` (CLI copy, §SURFACE 2) so serve
and storage share one probe. (ai-literacy uses `content/`, so it works today; the probe
is needed for correctness on `src/content/` packs and matches the loader.)

#### Bug A2 (HIGH) — `serve --port` ignored

**Root cause (reproduced):** `--port` is declared on BOTH the parent `university`
command (index.ts:2125, default `'3839'`) and the `serve` subcommand (index.ts:1999,
default `'3839'`). Commander resolves the parent's default ahead of the subcommand's
parsed value:

```
$ paradigm university serve --port 4000   →   options.port === '3839'   (BUG)
```

**Fix — `enablePositionalOptions()` (preferred):** call `.enablePositionalOptions()` on
the top-level `program` AND on `universityCmd`. Verified: this makes the subcommand's
`--port` win (`→ 4000`) while the parent keeps its own `--port` for the bare
`paradigm university --port N` backward-compat path. No option is removed, so the
backward-compat default action (index.ts:2124-2130) is preserved.

> **Scoped fallback (escape hatch):** if the global change regresses anything, drop
> `--port` from the parent `universityCmd` only (index.ts:2125) and route bare
> `paradigm university` through a `port`-less default action that defaults the port inside
> `universityServeCommand`. Verified working; scoped to the university subtree only;
> removes the bare `--port` affordance (acceptable). Prefer `enablePositionalOptions()`
> first because it's additive, but keep this named as the fallback.

> **Regression risk — PROGRAM-GLOBAL, not university-only.** `program.enablePositionalOptions()`
> changes parser mode for the **entire CLI**, not just the university subtree. Several other
> top-level commands share the `-p/--port` parent+sub pattern: `portal watch`, `lore serve`,
> the unified `serve`, `docs serve`, `symphony serve`. **Required test (extend #11):** assert
> those top-level commands still parse their own options after the change — at minimum
> `portal watch --port N`, `lore serve --port N`, `serve --port N`, `docs serve --port N`,
> `symphony serve --port N`. If ANY regress, switch to the scoped fallback above (drop the
> parent `--port`), which carries no program-global blast radius.

---

### SURFACE 2 — CLI commands + `storage.ts`

#### Bugs B1–B10 — storage ignores the selected pack

**Root cause:** `list/search/validate/add/show/quiz/status` resolve a `ResolvedPackContext`
via `resolvePackContext()` but the storage functions they call
(`loadUniversityIndex/searchContent/loadNote/loadQuiz/loadPath/saveNote/saveQuiz/
rebuildUniversityIndex`) have **no `packRoot` param** and hardcode
`UNIVERSITY_DIR='.paradigm/university'` + `CONTENT_DIR='content'` (storage.ts:31-32).
`storage.ts` is a stale fork of the pre-6.6.4 loader. It also lacks the dual-base probe
and the `loadPackIndex` scan-fallback.

**Fix — port the v6.6.4 loader contract into `storage.ts` (additive `packRoot?`):**
Bring `storage.ts`'s signatures to parity with `university-loader.ts`. Specifically:

1. **Add `resolveContentBase(packRoot): string | null`** and a private
   `resolveContentBaseLabel(packRoot): string | null` — exact ports of
   university-loader.ts:520-538. **Correct probe rule** (resolves C4, see §4): return the
   **first base that actually contains content**, not merely the first that exists —
   i.e. probe `content/` then `src/content/`, skipping a base whose content subdirs are
   all empty. (This is the unified rule; storage adopts it now even though no shipped
   pack triggers the divergence.)
2. **Add `scanPackEntries(contentBase, contentSubLabel): UniversityIndexEntry[]`** — port
   of university-loader.ts:551-664, including v6.5 `section`/`order` propagation. Refactor
   the existing `rebuildUniversityIndex` body to call it (forced `content/` label, so the
   project index stays byte-identical).
3. **Add `loadPackIndex(packRoot): UniversityIndex`** — port of
   university-loader.ts:719-745: read `<packRoot>/index.yaml` if present, else in-memory
   scan via the probe; never write an index for non-project packs.
4. **Thread `packRoot?` through** `loadNote/loadQuiz/loadPath/saveNote/saveQuiz/
   searchContent` (+ a `resolveContentFile(rootDir, id, ext, packRoot?)` helper porting
   university-loader.ts:1116-1129). `searchContent` switches to
   `packRoot ? loadPackIndex(packRoot) : loadUniversityIndex(rootDir)` (loader:453).

   > **CRITICAL — the READ ports are clean; the WRITE ports are NOT a line-for-line copy.**
   > `resolveContentBase` / `scanPackEntries` / `loadPackIndex` / `resolveContentFile` touch
   > only fs/yaml/types → port verbatim. But the loader's `saveNote`/`saveQuiz`
   > (university-loader.ts:309-327, 347-361) call `loadOrFabricatePackManifest` +
   > `stampFrontmatterPackContext`, and `loadOrFabricatePackManifest` calls **pack-loader's
   > `loadPackManifest`** — the dependency the CLI cannot import (§1.2). **Do NOT copy those.**
   > CLI write path: thread `packRoot` only for **directory targeting** (write under
   > `<effectivePackRoot>/content/<subdir>/`), and if pack-id stamping is wanted, derive
   > `pack_id` via selectors.ts's existing `safeLoadManifest(packRoot)?.id` (raw-YAML read,
   > already in the CLI) — NOT via the MCP loader. `effectivePackRoot` defaults to
   > `<rootDir>/.paradigm/university` when `packRoot` omitted, so the no-packRoot write path
   > stays byte-identical (write to `<rootDir>/.paradigm/university/content/...`).
5. **Update the 8 command files** to pass `ctx.subPackRoot ?? ctx.packRoot` as `packRoot`
   into the storage calls they already make. The resolution (`resolvePackContext`) is
   already wired in each command; only the **pass-through** of `packRoot` is missing.
   - **Default-path guard:** when no selector is present, commands must pass `undefined`
     (NOT a computed project root) so storage takes the unchanged `loadUniversityIndex`
     branch. Pattern: `const packRoot = hasSelector(options) ? (ctx.subPackRoot ?? ctx.packRoot) : undefined;`

> **Note on `discipline` filter (storage.ts:273 `searchContent`):** storage's
> `searchContent` does not implement an `author` filter that the loader has; bring it to
> parity only if a command passes it (list/status do not today — leave out to avoid
> scope creep, but the ported `loadPackIndex` is the real fix).

**Decision: port, do NOT reuse.** Reuse is impossible this release (CLI can't import the
MCP loader, §1.1). The ports above are line-for-line transcriptions of already-tested
loader code, which keeps risk low and sets up the follow-up extraction (the two copies
become trivially diffable → mechanical to collapse).

---

### SURFACE 3 — remaining MCP gaps

#### Bug C1 (HIGH) — onboard broken for sections-only packs

**Root cause:** `getOnboardingSequence` (university-loader.ts:1060-1110):
- loads config via `loadUniversityConfig(ctx.rootDir)` — the **PROJECT** config, not the
  pack's — and partitions entries by **category** (`excludeFromOnboarding`), line 1071-1081.
- A sections-only pack (ai-literacy: 5 sections, no `category` fields, no pack-scoped
  `config.yaml`) gets the project's category rules → all entries fall into "core" with no
  section structure, or the project's exclusions misfire. `loadDiplomas(rootDir)`
  (line 1085) is also project-scoped.
- The onboard tool (tools/university.ts:751) additionally takes `university.branding.name`
  from the **project** config, so the pack's identity is lost in the response.

**Fix (loader layer — flows to MCP, the only onboard surface):**

1. **Pack-scope the config source.** Add an internal
   `loadPackConfig(packRoot): UniversityConfig | null` that reads
   `<packRoot>/config.yaml` if present, else returns `null`. In `getOnboardingSequence`:
   ```ts
   const config = (packRoot && loadPackConfig(packRoot)) || loadUniversityConfig(rootDir);
   ```
   (No-packRoot path unchanged → project config, byte-identical.)
2. **Section-aware partitioning, gated on "raw pack.yaml DECLARES a `sections:` key".**
   - **CRITICAL — do NOT detect via `manifest.sections.length`.**
     `loadOrFabricatePackManifest` → `normalizeSections` **always** populates
     `manifest.sections` (a no-`pack.yaml` legacy project fabricates `[{id:'main',
     default:true}]`). So `manifest.sections.length > 0` is ALWAYS true and `> 1` wrongly
     excludes a real single-section pack — either flips legacy projects off the
     category-partition path → **breaks the byte-identical gate.**
   - **Correct mechanism:** detect declared sections from the **raw `pack.yaml`** — mirror
     the CLI `readPackSections` rule on the MCP side: read `<packRoot>/pack.yaml`, and treat
     the pack as section-structured **only if the file exists AND contains a non-empty
     `sections:` array**. A fabricated/synthesized default (no `pack.yaml`, or `pack.yaml`
     without a `sections:` key) counts as **"no declared sections."** Add a small
     `packDeclaresSections(packRoot): boolean` helper (raw-YAML read, like
     selectors.ts `readPackSections`) rather than going through the normalizing loader.
   - **If declared sections:** group `index.entries` by `entry.section` (untagged → the
     `default:true` section), ordered by section `order` then entry `order`. Return the
     section-grouped sequence (paths still surfaced; suggestedContent drawn across
     sections).
   - **Else** (no declared sections — today's projects, incl. no-`pack.yaml` legacy):
     keep the current category-based partition **byte-identical** (lines 1071-1101
     unchanged).
3. **Pack-scope diplomas:** `loadDiplomas(packRoot ? packRoot-derived : rootDir, …)`.
   Minor — mirror `saveDiploma`'s `effectivePackRoot ?? <rootDir>/.paradigm/university`.
   Flag, don't agonize: diplomas remain a project artifact by default.
4. **Onboard tool (tools/university.ts:751):** when a pack is requested, source the
   display name from the pack manifest (`manifest.name`) rather than project config.
   Keep project name on the no-pack path.

> **Shape note:** `OnboardingSequence` currently has no `sections` field. Add an optional
> `sections?: Array<{ id; name; entries: UniversityIndexEntry[] }>` so section-grouped
> output is additive and the existing `paths/suggestedContent/extracurricular` fields stay
> populated for back-compat consumers (UI/CLI). When no declared sections → omit
> `sections`, response identical to today.

#### Bug C2 (MED) — search truncates silently at 20

`searchContent` defaults `limit` to 20 (university-loader.ts:503) with no total in the
response. **Fix:** have the MCP search tool include `total` (pre-slice count) and
`returned` (post-slice count) in its JSON so pack browsing isn't silently truncated.
Keep the default `limit=20` (back-compat); only add the counts. Mirror the same
`total`/`returned` in the CLI `list` output (storage `searchContent` returns the sliced
array today — add a sibling that also returns the pre-slice count, or have the command
compute `index.entries` length for the active pack). **Lowest-risk:** add an optional
`searchContentWithMeta()` that returns `{ entries, total }`; leave `searchContent`
signature untouched so nothing else breaks.

#### Bug C3 (MED/LOW) — index-rebuild scope + dead `discipline` filter

- **rebuildUniversityIndex(rootDir)** in create/update writes only the PROJECT index;
  non-project packs scan-on-read so this is mostly cosmetic. **Fix (in-scope, cheap):**
  in the MCP create/update tools, **skip the project-index rebuild when a non-project
  pack was the write target** (or rebuild the correct pack only if it ships an
  `index.yaml`). Guard: `if (!requestedPack || isProjectPack) rebuildUniversityIndex(...)`.
  Prevents a misleading project-index churn on pack writes.
- **`discipline` filter** declared in the search schema but never applied (LOW, cosmetic).
  **Fix:** either apply it (`results.filter(e => e.discipline === filter.discipline)` if
  the field exists on entries) or remove it from the schema. **Recommend remove from
  schema** this release (entries don't carry `discipline` reliably) and file a follow-up
  if real discipline-filtering is wanted. Keep it deterministic, not half-wired.

#### Bug C4 (verify) — probe divergence T-2026-05-31-001

**Re-confirmed by reading both:**
- `countPackEntries` (selectors.ts:158-178): probes `['content','src/content']`, returns
  the **first base whose summed entry count > 0** (skips an empty base).
- `resolveContentBase` (university-loader.ts:520-526): returns the **first base that
  EXISTS**, regardless of whether it contains content.

→ **The divergence is REAL** (the "no divergence" triage take was wrong on mechanism):
a pack with an empty `content/` beside a populated `src/content/` makes `pack_list`
count N while pack-scoped reads resolve the empty `content/` → 0 (the v6.6.4 bug class).
**No shipped pack triggers it** (ai-literacy has populated `content/`), so it is correctly
**latent / low**.

**Disposition:** the **correct unified rule is "first base that CONTAINS content."** Adopt
that rule in the CLI `resolveContentBase` port (§SURFACE 2.1) and in `countPackEntries`
so both agree now. **Keep T-2026-05-31-001 OPEN**, re-scoped to the Option-A extraction
(it fully closes when there is a single shared `resolveContentBase`). Update its blurb to
note the CLI/MCP probes were aligned on the "contains-content" rule in this release.

---

## 3. Phased file plan, build order, blast radius, back-compat

Build order: `core/leaf → paradigm-mcp → university → paradigm(CLI)`. Phases ordered so
each can build+test green before the next.

### Phase 0 — MCP loader gaps (onboard + search meta + index scope)
*Package: `paradigm-mcp`. The currently-working surface — fix in isolation first.*
- `packages/paradigm-mcp/src/utils/university-loader.ts`
  - `getOnboardingSequence`: pack-scoped config + section-aware partitioning (C1);
    pack-scoped diplomas (C1.3); add optional `sections` to `OnboardingSequence`.
  - add `loadPackConfig(packRoot)` helper (C1.1).
  - add `searchContentWithMeta()` returning `{entries,total}` (C2).
  - align `resolveContentBase` to "contains-content" rule (C4).
- `packages/paradigm-mcp/src/tools/university.ts`
  - onboard: pack display name from manifest (C1.4); pass section-aware sequence through.
  - search: include `total`/`returned` (C2).
  - create/update: guard `rebuildUniversityIndex` to project/index-bearing packs (C3a).
  - search schema: drop dead `discipline` filter (C3b).
- **Blast radius:** MCP only. **Back-compat:** no-pack onboard/search byte-identical
  (tests in §5 assert this). `OnboardingSequence.sections` additive.

### Phase 1 — serve server pack resolution
*Package: `university`. No internal deps → safe, isolated.*
- `packages/university/src/server/index.ts`
  - add `packRoot`/`packId` to `ServerOptions` + `createApp` options.
  - extract `buildPackConfig(options): PackConfig` (export it for tests) from lines 151-229.
  - resolve manifest path from `packRoot` when present (A1).
- **Blast radius:** serve only. **Back-compat:** `buildPackConfig` with no `packRoot`
  returns today's `PackConfig` exactly (test asserts byte-equality on the default path).

### Phase 2 — CLI storage parity
*Package: `paradigm`. Depends on nothing above (storage is self-contained).*
- `packages/paradigm/src/core/university/storage.ts`
  - add `resolveContentBase` (+ label) with the contains-content rule (B, C4).
  - add `scanPackEntries`; refactor `rebuildUniversityIndex` to use it.
  - add `loadPackIndex(packRoot)`.
  - add `resolveContentFile(rootDir,id,ext,packRoot?)`.
  - thread `packRoot?` through `loadNote/loadQuiz/loadPath/saveNote/saveQuiz/searchContent`.
  - add `searchContentWithMeta()` (C2 parity on CLI).
- **Blast radius:** CLI storage. **Back-compat:** all functions called with no `packRoot`
  hit the unchanged project-pack branch.

### Phase 3 — CLI command wiring (serve + 8 subcommands)
*Package: `paradigm`. Last — depends on Phase 1 (server fields) + Phase 2 (storage).*
- `packages/paradigm/src/index.ts`
  - `program.enablePositionalOptions()` + `universityCmd.enablePositionalOptions()` (A2).
- `packages/paradigm/src/commands/university/serve.ts`
  - forward `packRoot`/`packId` to `startServer` (A1).
  - dual-base probe for `contentDir` via the new `resolveContentBase` (A1b).
- `packages/paradigm/src/commands/university/{list,add,show,quiz,status,validate}.ts`
  - pass `hasSelector(options) ? (ctx.subPackRoot ?? ctx.packRoot) : undefined` into the
    storage calls each already makes (B). (`add` writes → packRoot for saveNote/saveQuiz.)
- **Blast radius:** CLI command layer. **Back-compat:** no-selector invocations pass
  `undefined` → unchanged behavior; `enablePositionalOptions` covered by the §5 regression
  matrix.

### Cross-cutting back-compat guarantee (acceptance gate — state explicitly)
> **The default / no-selector path must be byte-identical on every surface.** Asserted in
> CLI storage tests, MCP onboard/search tests, AND the server `buildPackConfig` test — not
> only at the loader layer.

---

## 4. C4 disposition (summary)

Divergence real, latent, low. Align CLI `resolveContentBase` + `countPackEntries` on
"first base that contains content." **Keep T-2026-05-31-001 open**, re-scoped to the
follow-up extraction.

---

## 5. Test plan

### Unit — MCP (Phase 0)
1. **onboard, sections-only pack** (ai-literacy fixture): assert returned `sections` has
   5 groups in `order` (foundations…glossary), entries grouped by `entry.section`,
   untagged → default `foundations`. Assert `pack === 'ai-literacy'` and display name =
   manifest name.
2. **onboard, no-selector (project)**: assert response **byte-identical** to pre-change
   (category partition path untouched). Snapshot test.
3. **search meta**: assert `total` (pre-slice) and `returned` present; with >20 entries,
   `returned===20`, `total>20`.
4. **create/update on non-project pack**: assert project `index.yaml` is NOT rewritten.

### Unit — serve `buildPackConfig` (Phase 1, no server launch)
5. **`buildPackConfig({ packRoot: <ai-literacy abs path> })`** → `mode:'project'`,
   `branding.name` from ai-literacy manifest, `sections.length===5`. *This is the
   integration assertion for `serve --pack ai-literacy` without binding a port.*
6. **`buildPackConfig({ projectDir, packRoot: undefined })`** → byte-identical to current
   output for both project-mode and paradigm-mode fixtures (snapshot).

### Unit — CLI storage (Phase 2)
7. **`loadPackIndex(aiLiteracyRoot)`** (no index.yaml) → scans content, returns entries
   with `section` propagated.
8. **`searchContent(rootDir, filter, aiLiteracyRoot)`** → returns ai-literacy entries, not
   project entries.
9. **`searchContent(rootDir, filter)` (no packRoot)** → byte-identical to current
   project-pack result (snapshot).
10. **dual-base probe**: fixture with empty `content/` + populated `src/content/` →
    `resolveContentBase` returns the populated base (C4 regression).

### Unit — CLI command parse regression (Phase 3, A2)
11. After `enablePositionalOptions()`: parse-only assertions that each university
    subcommand reads its own options:
    - `university serve --port 4000` → `4000` (the headline repro).
    - `university list --pack ai-literacy --type note --limit 5` → all three parsed.
    - `university add note --title T --pack ai-literacy` → parsed.
    - `university validate --deep`, `university quiz Q1 --pack p`, `university status --json`.
    - `university --port 4001` (bare backward-compat) → `4001`.
    - **Program-global regression (enablePositionalOptions blast radius):** assert other
      top-level `--port` commands still parse: `portal watch --port N`, `lore serve --port N`,
      `serve --port N`, `docs serve --port N`, `symphony serve --port N`. Any regression →
      switch to the scoped fallback (drop parent `--port`).

### Integration smoke (verify phase, not CI-blocking)
12. `paradigm university serve --pack ai-literacy --no-open` then
    `curl localhost:PORT/api/pack-config` → `mode:'project'`, ai-literacy branding,
    5 sections. (Manual / verify-skill; the unit test #5 is the deterministic gate.)

---

## 6. Follow-ups vs in-scope

**In scope now (this release):** A1, A1b, A2, B1–B10, C1, C2, C3 (both halves), C4 probe
alignment. The user explicitly asked for `serve --pack`/`--port`, CLI honoring `--pack`,
and onboard for sections-only packs — all covered.

**Follow-up tasks (file, don't do now):**
- **T-extract-university-core (NEW, Option A):** extract a shared `@a-company/university-core`
  leaf so the loader can't re-fork; migrate `storage.ts` + `university-loader.ts` to import
  it. **Scope-narrowing note:** the functions that actually need sharing —
  `scanPackEntries` / `resolveContentBase` / `loadPackIndex` / `resolveContentFile` — have
  **zero** pack-loader dependency (fs/yaml/types only). Only the manifest/stamp write path
  drags in `pack-loader → yaml-validator → portal-core` + the logger seam. So
  `university-core` can be **just the content-scan leaf** (clean, CLI-importable) — do NOT
  over-scope it into "move all of pack-loader." **Fold T-2026-05-31-001 into this** (probe
  divergence vanishes with a single `resolveContentBase`). Priority: medium. This is the
  durable fix for the duplication the user flagged.
- **Drift-guard test (NEW, cheap — consider in-scope if time):** a test that diffs the
  ported function bodies (`scanPackEntries`, `resolveContentBase`, `loadPackIndex`)
  between `storage.ts` and `university-loader.ts` and FAILS on divergence, so the two
  forks stay in lockstep until the extraction lands. Makes the C-debt loud.
- **`discipline` real filtering** (if C3b removal proves wanted by users): re-add with
  entry-level `discipline` support end-to-end.

---

## 7. Agent Relay

```yaml
relay:
  agent: architect
  nickname: Arky
  status: complete
  summary: >-
    Designed a builder-ready phased fix for the University pack-selector bugs across
    three surfaces. Central call: Option C (hybrid-lean) — port the v6.6.4 loader fixes
    into CLI storage now + fix the serve server's manifest resolution + fix MCP onboard,
    and file the @a-company/university-core extraction (Option A) as a tracked follow-up.
    Evidence-locked: the CLI cannot import the MCP loader (paradigm depends only on
    portal-core + registry-client), the serve server is dependency-light by design, and
    pack-loader's import tree (yaml-validator → portal-core, mcp-logger → paradigm-logger,
    pack-schema → zod) makes a clean leaf-extraction a package-creation project, not a
    one-release bugfix. Reframe captured: the content-loader dup is 2-way (MCP + CLI),
    NOT 3-way — the server has a distinct manifest/mode-resolution bug. --port bug
    reproduced and both candidate fixes verified; enablePositionalOptions() chosen to
    preserve the bare-command backward-compat path. C4 probe divergence re-confirmed REAL
    but latent/low; unified rule = "first base that contains content"; T-2026-05-31-001
    kept open, re-scoped to the extraction.
  decisions:
    - "Consolidation = Option C (port now, extract later). A deferred: extraction drags pack-loader+yaml-validator+pack-schema+paradigm-logger into a new published package — too large for a thorough single release; payoff low because dup is only 2-way."
    - "serve: thread packRoot/packId into ServerOptions; extract buildPackConfig() as the pure, no-server test seam; dual-base probe in serve.ts:59."
    - "--port: enablePositionalOptions() on program + universityCmd (verified) — subcommand --port wins, parent keeps --port for bare backward-compat. Requires full subcommand parse-regression test."
    - "CLI storage: port (not reuse) resolveContentBase+scanPackEntries+loadPackIndex+resolveContentFile and thread packRoot? — line-for-line from the tested loader; commands pass undefined on the no-selector path to keep default byte-identical."
    - "onboard C1: pack-scoped config (loadPackConfig) + section-aware partitioning gated on declared sections (else category path byte-identical) + pack-scoped diplomas + manifest display name. Add optional OnboardingSequence.sections."
    - "C2: add total/returned via searchContentWithMeta() (signatures untouched). C3: guard rebuildUniversityIndex to project/index-bearing packs; drop dead discipline filter from search schema. C4: align probes on contains-content; keep T-2026-05-31-001 open re-scoped to extraction."
    - "Hard acceptance gate: default/no-selector path byte-identical on ALL three surfaces, asserted in CLI + MCP + server tests."
  artifacts:
    phase_0_mcp:
      - packages/paradigm-mcp/src/utils/university-loader.ts
      - packages/paradigm-mcp/src/tools/university.ts
    phase_1_server:
      - packages/university/src/server/index.ts
    phase_2_cli_storage:
      - packages/paradigm/src/core/university/storage.ts
    phase_3_cli_wiring:
      - packages/paradigm/src/index.ts
      - packages/paradigm/src/commands/university/serve.ts
      - packages/paradigm/src/commands/university/list.ts
      - packages/paradigm/src/commands/university/add.ts
      - packages/paradigm/src/commands/university/show.ts
      - packages/paradigm/src/commands/university/quiz.ts
      - packages/paradigm/src/commands/university/status.ts
      - packages/paradigm/src/commands/university/validate.ts
    spec:
      - .paradigm/specs/fix-university-pack-selector-full.md
  follow_ups:
    - "NEW task: extract @a-company/university-core (Option A); migrate storage.ts + university-loader.ts to it; fold in T-2026-05-31-001. Priority: medium."
    - "Consider in-scope: drift-guard test diffing ported fn bodies between storage.ts and university-loader.ts."
    - "T-2026-05-31-001: keep open, re-scope to the extraction; note CLI/MCP probes aligned on contains-content this release."
  handoff_to: builder
  handoff_context: >-
    Build in phase order 0→1→2→3 (each green before the next): paradigm-mcp, then
    university, then paradigm storage, then paradigm CLI wiring. Per project memory: after
    code changes, build paradigm-mcp (npm run build) and the CLI (npm run build && npm
    link); the serve server lives in packages/university (npm run build there). The
    headline acceptance is unit test #5 (buildPackConfig({packRoot: ai-literacy}) → 5
    sections + project mode) standing in for `serve --pack ai-literacy` without launching
    a server, plus the --port repro (#11) and the no-selector byte-identical snapshots on
    all three surfaces. ai-literacy fixture lives at .paradigm/university/ai-literacy/
    (content/ layout, 5 sections, tenant_kind: project, no config.yaml). Do NOT remove any
    existing option/flag — all changes additive. Update .purpose files for the touched
    packages and add the new follow-up tasks before handing to review.
```
