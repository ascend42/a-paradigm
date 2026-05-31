# Spec: Fix `pack` selector ignored by University read tools

**Author:** Arky (architect) · **Date:** 2026-05-31 · **Handoff:** builder
**Scope:** `packages/paradigm-mcp` only. CLI parallel (`packages/paradigm/src/core/university/storage.ts`) is OUT OF SCOPE — CLI commands do not accept a `pack` arg.

---

## 1. Problem

The documented v6.0 `pack` selector ("target a specific content pack") is accepted by the READ
tools (`paradigm_university_search` / `_onboard` / `_validate`) but ignored when loading entries.
The handlers correctly resolve `{packId, packRoot}` via `resolveActivePack(...)`, then call into
loaders that hardcode the **project** index/content path and drop `packRoot` on the floor.

**Confirmed repro:** with `.paradigm/university/ai-literacy/` (43 entries),
`paradigm_university_search pack=ai-literacy` → 0 results. `pack=paradigm` (first-party, 201 files
under `node_modules/@a-company/university/src/content/`) → 0 results.

**Root cause — two independent hardcodes, BOTH must be fixed for the full repro:**

1. **Index path** — `loadUniversityIndex(rootDir)` (`university-loader.ts:256-266`) always reads
   `<rootDir>/.paradigm/university/index.yaml`. `searchContent` (446), `getOnboardingSequence`
   (943), `validateUniversityContent` (650) all flow through it. Non-project packs have **no**
   `index.yaml`.
2. **Content base** — the scanner inside `rebuildUniversityIndex` (505-617), `resolveContentFile`
   (995-1006), `validateSectionIntegrity` (849), and `getOnboardingSequence`'s `loadPath` call
   (968) all assume content lives under `content/`. The first-party pack ships content under
   `src/content/`. Fixing only #1 still returns 0 for `pack=paradigm`.

**Portable enumeration mechanism (already exists):** `countPackEntries` (`university.ts:135-153`)
probes `['content', 'src/content']` in order and counts `.md`/`.yaml` files. That is the *only*
portable enumeration both layouts share. Verified: ai-literacy=43 under `content/`, first-party=201
under `src/content/`. Neither non-project pack ships an `index.yaml` and the first-party `dist/`
contains no prebuilt index. The fix REUSES this dual-probe; it does NOT invent a new scanner.

---

## 2. Chosen approach: Option A (in-memory pack index with scan fallback)

Add `loadPackIndex(packRoot, rootDir)` that:
- reads `<packRoot>/index.yaml` if present (project pack → byte-identical to today), ELSE
- builds `UniversityIndexEntry[]` in-memory by scanning the pack's content dirs, reusing the same
  dual content-base probe and the same frontmatter→entry mapping `rebuildUniversityIndex` uses.

**Why not B or C:**
- **B (make `loadUniversityIndex` packRoot-aware):** necessary but insufficient — non-project packs
  have no `index.yaml`, so "read `<packRoot>/index.yaml`" returns null → still 0. B only works if it
  carries A's scan fallback, at which point it *is* A.
- **C (write `index.yaml` into every discovered pack at reindex):** fails portability. First-party
  and npm packs live in `node_modules/`; writes there are wiped by `npm install` and mutate a
  dependency. The existing `packs.json` cache keys off `node_modules` mtime *precisely because* that
  tree is not ours to write. Rejected.

---

## 3. The unifying seam — shared content-base resolver

Extract ONE helper and use it everywhere a pack's content root is computed:

```ts
// returns the absolute content dir for a pack, probing both layouts in the
// SAME order countPackEntries uses. null when neither exists.
function resolveContentBase(packRoot: string): string | null {
  for (const sub of ['content', 'src/content']) {
    const dir = path.join(packRoot, sub);
    if (fs.existsSync(dir)) return dir;
  }
  return null;
}
```

Apply it in:
- the new `loadPackIndex` scan fallback (notes/policies/quizzes/paths),
- `resolveContentFile` (995-1006) — replace the hardcoded `path.join(effectivePackRoot, CONTENT_DIR)`
  with `resolveContentBase(effectivePackRoot) ?? path.join(effectivePackRoot, CONTENT_DIR)`,
- (optionally) refactor `rebuildUniversityIndex` to call the shared scanner forced to `content/`
  + writing, so the section/order propagation logic (537-538, 573-574, 607-608) never diverges from
  the in-memory path. **Recommended but not required;** if not refactored, the in-memory scanner
  MUST replicate that propagation exactly (see §5).

`countPackEntries` (university.ts:135) may also be refactored to delegate to `resolveContentBase`
for consistency, but this is cosmetic — leave it if it adds churn.

---

## 4. Signature changes (minimal — no external callers exist)

Repo-wide grep confirms the only callers of the 4 affected functions live in
`packages/paradigm-mcp/src/tools/university.ts` (+ `reindex.ts` calls `rebuildUniversityIndex`,
unchanged signature). The CLI package has its OWN copies (out of scope). So all signatures below add
an OPTIONAL trailing `packRoot?` — every existing call without it behaves exactly as today.

| Function | Old | New | Behavior when `packRoot` omitted |
|---|---|---|---|
| `searchContent` (446) | `(rootDir, filter)` | `(rootDir, filter, packRoot?)` | `loadUniversityIndex(rootDir)` (unchanged) |
| `getOnboardingSequence` (943) | `(rootDir, student?)` | `(rootDir, student?, packRoot?)` | unchanged |
| `validateUniversityContent` (650) | `(rootDir, options?)` | `(rootDir, options?, packRoot?)` | unchanged |
| `loadPackIndex` (NEW) | — | `(packRoot, rootDir)` | n/a |

Internal index resolution rule, applied in all three:
```ts
const index = packRoot ? loadPackIndex(packRoot, rootDir) : loadUniversityIndex(rootDir);
```
`loadUniversityIndex` itself is UNCHANGED (keeps its single-arg project-only contract; do not touch
its other callers in `docs-loader.ts` / `getAffectedUniversityContent`).

### Handler wiring (`tools/university.ts`)
- **search ~472/480:** already destructures `packRoot`. Pass it:
  `searchContent(ctx.rootDir, {...}, packRoot)`.
- **onboard ~746:** change `const { packId } = ...` → `const { packId, packRoot } = ...`; pass:
  `getOnboardingSequence(ctx.rootDir, student, packRoot)`.
- **validate ~765:** change `const { packId } = ...` → `const { packId, packRoot } = ...`; pass:
  `validateUniversityContent(ctx.rootDir, { id, deep }, packRoot)`.

### Threading packRoot to per-entry body loads (the second-half fix)
- `getOnboardingSequence` line **968**: `loadPath(rootDir, pe.id)` → `loadPath(rootDir, pe.id, packRoot)`.
- `validateUniversityContent`: thread `packRoot` into `validateQuizContent` and `validatePathContent`
  so their `loadQuiz(rootDir, id)` (753) / `loadPath(rootDir, id)` (803) become
  `loadQuiz(rootDir, id, packRoot)` / `loadPath(rootDir, id, packRoot)`. Add `packRoot?` params to
  both helpers (internal, no external callers).
- `validateSectionIntegrity` line **849**: `path.join(rootDir, UNIVERSITY_DIR)` →
  `packRoot ?? path.join(rootDir, UNIVERSITY_DIR)` (so section integrity checks the SELECTED pack's
  manifest). Add `packRoot?` param.

### What stays `rootDir`-relative (do NOT pack-scope these — project-owned)
The deep-validate symbol checks read the **host project's** symbol graph, not the pack:
- `loadKnownSymbols(rootDir)` (665) — `.paradigm/scan-index.json`
- `checkContentStaleness` / `isContentStale` — compare against project `.purpose` mtimes
- `computeSymbolCoverage(rootDir, index)` (741)
These remain `rootDir`. A pack's content references project symbols; the symbol authority is the
project. Document this split so the builder does not over-thread `packRoot`.

---

## 5. The no-index scan path — exact entry construction

`loadPackIndex(packRoot, rootDir)` when `<packRoot>/index.yaml` is absent:

1. `const base = resolveContentBase(packRoot)`. If `null` → return an empty index
   (`{ version:'1.0', generatedAt, totalContent:0, entries:[], diplomaCount:0 }`).
2. Scan three content subdirs under `base`, mapping each file to a `UniversityIndexEntry` IDENTICALLY
   to `rebuildUniversityIndex` (505-617). Reuse `parseFrontmatter` and the existing yaml load:
   - **`notes/` + `policies/`** (`*.md`): parse frontmatter →
     `{ id: fm.id||file-stem, title, type: fm.type || (policies?'policy':'note'), author||'unknown',
       created||'', updated||'', tags:[], symbols:[], difficulty||'beginner',
       file:'<contentSub>/<subdir>/<file>', category?, section?, order? }`.
     `section` included only when non-empty string; `order` only when finite number (mirrors
     537-538). NOTE: `file` must use the actual content base subdir that was probed
     (`content` vs `src/content`) so the path stays valid for any later body load.
   - **`quizzes/`** (`*.yaml`): yaml load; skip if no `id`. Map per 559-575 (top-level `section`,
     not per-question PLSAT slot).
   - **`paths/`** (`*.yaml`): yaml load; skip if no `id`. Map per 595-609 (`symbols: []`).
3. `diplomaCount`: 0 for the scan path (diplomas are a project artifact, not pack content) — or
   count `<packRoot>/diplomas/*.yaml` if present, to mirror `rebuildUniversityIndex` 619-628.
   Prefer 0 unless a test needs otherwise; diplomas are not part of the repro.
4. Return `{ version:'1.0', generatedAt: now, totalContent: entries.length, entries, diplomaCount }`.

**Single source of truth:** extract the per-file mapping into a shared
`scanPackEntries(contentBase): UniversityIndexEntry[]` and have BOTH `rebuildUniversityIndex` (forced
`content/`, then writes) and `loadPackIndex` (probed base, no write) call it. This guarantees
537-538 / 573-574 / 607-608 section/order propagation can never diverge. This is the recommended
factoring; the builder may inline-duplicate only if the refactor proves too invasive, in which case
add a test asserting the two paths produce identical entries for the same fixture.

---

## 6. Caching & writes

- **In-memory memo** keyed by `packRoot` + content-base directory mtime (cheapest staleness signal).
  Scan is a cold path — search is not hot, and pack content rarely changes mid-session — so even no
  memo is acceptable for a first cut. If adding a memo, invalidate on mtime change; keep it module-local.
- **Do NOT write `index.yaml` for non-project packs.** They live in `node_modules/` (first-party,
  npm) or are read-only discipline packs; writes are wiped by `npm install` and the project's
  on-write rebuild only ever targets the project index. The project pack keeps its existing on-write
  `rebuildUniversityIndex` behavior unchanged.

---

## 7. Back-compat guarantees & one accepted delta

- **Project pack (default, no `pack` arg):** every call omits `packRoot` → identical code path
  (`loadUniversityIndex(rootDir)`, `loadQuiz/loadPath` with no packRoot, `validateSectionIntegrity`
  on project root). Byte-for-byte unchanged.
- **`loadUniversityIndex` unchanged** → `docs-loader.ts` and `getAffectedUniversityContent`
  unaffected.
- **Accepted delta (state explicitly):** `searchContent` today returns `[]` when `index.yaml` is
  missing; with a `packRoot` passed it now scans instead. In practice the project `index.yaml` is
  always present (rebuilt on every write + every `paradigm_reindex`), so the default path never hits
  this. The new scan-on-missing behavior applies only to the `packRoot` branch (non-project packs,
  which never had an index). Net: no observable change for the project pack; new correct behavior for
  selected packs. Record as a decision so it is not a silent change.

---

## 8. File plan & sub-phase ordering

**Phase 1 — shared seam (`utils/university-loader.ts`):**
1. Add `resolveContentBase(packRoot): string | null`.
2. Extract `scanPackEntries(contentBase, contentSubLabel): UniversityIndexEntry[]` from
   `rebuildUniversityIndex` (505-617); refactor `rebuildUniversityIndex` to call it with the project
   `content/` base, then write (unchanged output).
3. Add `loadPackIndex(packRoot, rootDir): UniversityIndex` (read `<packRoot>/index.yaml` else
   `scanPackEntries(resolveContentBase(packRoot))`).
4. Update `resolveContentFile` (995) to use `resolveContentBase`.

**Phase 2 — thread `packRoot` (`utils/university-loader.ts`):**
5. `searchContent` (446): add `packRoot?`; `packRoot ? loadPackIndex(...) : loadUniversityIndex(...)`.
6. `getOnboardingSequence` (943): add `packRoot?`; same index switch; `loadPath` at 968 gets `packRoot`.
7. `validateUniversityContent` (650): add `packRoot?`; same index switch; thread into
   `validateQuizContent`/`validatePathContent`/`validateSectionIntegrity`.

**Phase 3 — handler wiring (`tools/university.ts`):**
8. search ~480: pass `packRoot`. onboard ~746/749: destructure + pass. validate ~765/778: destructure + pass.

**Phase 4 — tests + docs:**
9. New test file (below). 10. Update `utils/.purpose` if it enumerates these functions.

### Blast radius (every touched call site)
- `utils/university-loader.ts`: `loadUniversityIndex` (256, READ-only review — keep unchanged),
  `searchContent` (446-448), `rebuildUniversityIndex` (505-617 refactor), `validateUniversityContent`
  (650-749), `validateQuizContent` (752), `validatePathContent` (797), `validateSectionIntegrity`
  (844-849), `getOnboardingSequence` (943-989, esp. 944 + 968), `resolveContentFile` (995).
- `tools/university.ts`: search ~480, onboard ~746/749, validate ~765/778.
- UNCHANGED / out of scope: `reindex.ts:304`, `docs-loader.ts` local `loadUniversityIndex`,
  `getAffectedUniversityContent` (911), the entire `packages/paradigm/src/core/university/storage.ts`
  CLI copy.

---

## 9. Test plan

New file `packages/paradigm-mcp/tests/university-pack-selector.test.ts`:

1. **Disk-pack `content/` layout, 2 sections:** build a temp pack dir
   `<tmp>/.paradigm/university/<packid>/` with `pack.yaml` (2 sections) + `content/notes/*.md` etc.
   Assert `searchContent(rootDir, {}, packRoot)` returns all authored entries (count match) and that
   `section` filtering works.
2. **First-party `src/content/` layout:** build a temp pack with content under `src/content/notes`
   etc. Assert `searchContent(..., packRoot)` returns the entries — locks the dual-probe. Without the
   fix this returns 0.
3. **Invariant:** for each fixture, `countPackEntries(packRoot)` (or the new `pack_list` entry_count)
   == unfiltered `searchContent(..., packRoot).length` (with `limit` high enough). Catches the
   "pack_list says 43, search says 0" divergence directly.
4. **Project-pack regression:** with a project `index.yaml` present, `searchContent(rootDir, {})`
   (no packRoot) returns exactly the index entries — assert path unchanged.
5. **Onboard + validate selected pack:** `getOnboardingSequence(rootDir, undefined, packRoot)` yields
   the pack's paths/suggested content; `validateUniversityContent(rootDir, {}, packRoot)` reports
   `checked == entry count` and does NOT crash on `src/content/` packs (exercises the
   `validatePathContent`/`loadPath` packRoot threading).
6. (If `scanPackEntries` shared) assert `loadPackIndex` scan output == `rebuildUniversityIndex` output
   for an identical `content/` fixture.

**Keep green:** `tests/university-multi-tenant.test.ts`, `tests/pack-sections.test.ts`,
`tests/pack-loader.test.ts`, `tests/university-metrics.test.ts`.

---

## 10. Verification (manual, on this repo)

After build: `paradigm_university_search pack=ai-literacy` → 43-ish results;
`pack=paradigm` → ~200 results; `paradigm_university_search` (no pack) → unchanged project results.
`paradigm_university_pack_list` entry_count must equal the unfiltered search count per pack.
