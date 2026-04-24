# Cleanup Audit Triage — 2026-04-22

Reviewer: triage of Explore's 26 findings. Spot-checked by reading the cited files directly. Several severity calls are off and two findings are false positives.

## Validated findings

### Category 1 — Package.json hygiene
- **1.1** Logger missing metadata — **confirmed `improvement`**. No `homepage`/`bugs`/`repository` in `packages/logger/package.json`. Low-risk, cosmetic.
- **1.2** Logger exports ordering — **confirmed `blocking` only for TS consumers on `node16`/`nodenext` moduleResolution.** Verified at `packages/logger/package.json:8-13`: `types` is last. TypeScript handbook requires `types` first so it's matched before `import`/`require`. Impact: downstream users on modern module resolution silently lose types. Keep `blocking`, but note the user-impact wording is "types may not resolve for some consumers", not "npm publish will fail."
- **1.3** paradigm-vscode metadata — **downgrade to `note`**. VSCode extensions aren't published to npm; `homepage`/`bugs` matter less. Missing `files` field is real but low-impact since `vsce package` uses `.vscodeignore`. Still worth fixing for consistency.
- **1.4** sentinel-web exports "contradiction" — **FALSE POSITIVE**. Read `packages/sentinel-web/package.json:9-15`: exports has `types` FIRST (correct), plus `import` + `require`. The `dist/` contains both `index.js` (ESM) and `index.cjs` (CJS). This is a valid dual-package pattern. Missing `homepage`/`bugs` is real (downgrade to `note`).
- **1.5** @types/node mismatch — **confirmed `improvement`**. 4 packages on `^20.10.0`, site on `^22.10.0`. Real type drift risk if types cross package boundaries.
- **1.6** Express mismatch — **confirmed `note`**, but upgrade rationale: paradigm runs express 5, sentinel/university on 4. These are isolated server processes, not shared runtime. Low actual risk.
- **1.7** chalk "unused dep" — **confirmed `note`**. Verified via Grep: `chalk` only appears in `pnpm-lock.yaml` (transitive from `@modelcontextprotocol/sdk`). No direct usage in paradigm-mcp source. Nothing to remove since it's NOT listed as a direct dep — finding mislabels the situation ("chalk is not listed as a dependency" contradicts itself). Safe to ignore.

### Category 2 — Build artifacts
- **2.1** Compiled artifacts in `src/` — **confirmed `improvement`**. Verified: `packages/paradigm-mcp/src/utils/tool-cache.{d.ts,d.ts.map,js,js.map}` all exist alongside `tool-cache.ts`. These are currently untracked (see git status). Real issue. Also `sql.js.d.ts` in 3 packages is hand-authored stub for sql.js, not generated — see 8.1 for correct framing.
- **2.2** `.next/` committed — **PARTIAL FALSE POSITIVE**. Verified: `git ls-files packages/site/.next` returns empty (already gitignored via `packages/site/.gitignore`). The real issue is **root-level `/Users/ascend/Documents/GitHub/a-paradigm/.next/`** (currently showing `??` in git status) — it isn't covered by root `.gitignore`. Upgrade to `improvement`, rescope to root `.next`, add `.next/` pattern to root gitignore.
- **2.3** `dist/` directories — **confirmed `note`**. Package.json files have `"files": ["dist"]` for npm publish; committed dist is intentional for some packages. Policy call, not a bug.

### Category 3 — Code hygiene
- **3.1** TODO placeholders — **confirmed `note` / informational**. These are scaffolding templates.
- **3.2** console.log violations — **confirmed `note`**. Verified the paradigm-vscode ones are lifecycle hooks (activation); CLAUDE.md permits raw console in extension entry points. Platform-server is CLI-adjacent, also acceptable. Only actual fix candidates: 2 lines in `paradigm-vscode/src/extension.ts`.
- **3.3** `any` hotspots — **confirmed `note`**. sentinel.ts/orchestration.ts handle dynamic MCP protocol shapes where `any` is pragmatic.

### Category 4 — Tests
- **4.1** Vitest config duplication — **confirmed `note`**. Premature abstraction not warranted for 2 files.
- **4.2** Test structure inconsistency — **confirmed `note`**.
- **4.3** Missing tests for university/sentinel-web — **confirmed `note`**. Tracked as long-term work.

### Category 5 — Paradigm-specific
- **5.1** Stub `.purpose` files — **FALSE POSITIVE / misclassified**. Verified: `packages/{portal,premise,probe,purpose}/` are UMBRELLA directories with sub-packages (portal has core/e2e/manager/sdk/viewer). The real `.purpose` richness lives in sub-package directories. 2-line parent stubs are correct by design. Demote to `note` at most, or drop.
- **5.2** Tool-cache generated artifacts — duplicate of 2.1, merge.

### Category 6 — Docs
- **6.1** README "v2.0" stale — **FALSE POSITIVE**. Read `README.md` lines 1-10 and grepped entire file: no `v2.0`, no `v2`, no `version 2` anywhere. Explore hallucinated this. Drop the finding.
- **6.2** CLAUDE.md — confirmed `note`; no concrete drift identified.

### Category 7 — Dependencies
- **7.1** paradigm-vscode optional deps — **confirmed `note`**. Cosmetic.
- **7.2** Cursor plugin parity — **confirmed `note`**. Requires manual audit.

### Category 8 — Dead code
- **8.1** sql.js type stubs duplicated across 3 packages — **confirmed `note`**. Ideal fix: one shared types package.
- **8.2** Comment density — **confirmed `note` / n/a**.

### Category 9 — Minor
- **9.1** Logger missing README in published tarball — **confirmed `note`**.
- **9.2** paradigm-vscode no node `engines` — **borderline false positive**. Package DOES have `engines.vscode`; VSCode extensions don't need `engines.node` (VSCode bundles Electron runtime). Drop or keep as informational.
- **9.3** paradigm-mcp `private: true` + `publishConfig` — **confirmed `note`**. Verified: paradigm-mcp returns 404 on npm (not published). MEMORY.md says it should bump when MCP tools change, but today it's re-exported through `@a-company/paradigm`'s `bin`. Contradiction between intent and reality — either unpublish plans or drop publishConfig. Recommend dropping `publishConfig` to reflect current reality (it's embedded, not standalone).

## False positives
1. **Finding 1.4** — sentinel-web exports are fine; dual-package ESM+CJS is valid.
2. **Finding 6.1** — README does not say "v2.0".
3. **Finding 5.1** — Umbrella package `.purpose` files are intentionally thin.
4. **Finding 9.2** — vscode extensions don't need `engines.node`.
5. **Finding 2.2 (partial)** — `packages/site/.next` is already gitignored; real issue is root `.next`.

## Missed categories
Explore did not cover:

1. **Root `.next/` directory currently untracked and not in root `.gitignore`.** Create new finding (severity `improvement`): add `/.next/` to root gitignore and rm the directory.
2. **Back-compat: `loadPortalConfig` return type change in v5.38.0** — Explore didn't scan CHANGELOG for breaking changes. If this exists, deprecation shim needs a doc note. (Not verified — suggest architect scan CHANGELOG.)
3. **`paradigm-mcp` private/publish contradiction is deeper than 9.3 suggests** — since it's NOT published, all dependencies on `workspace:*` specifiers for `@a-company/paradigm-mcp` would fail outside the monorepo. Not blocking for shipping within monorepo, but documents the coupling.
4. **Logger `exports` uses `.mjs` + `.js` convention inconsistently with sentinel-web** (`.js` ESM + `.cjs` CJS). Not bug-level, but monorepo convention is drifting — pick one.
5. **Security hygiene pass:** scanned for stray `.env*` files — none found. Scanned git status — no secrets. Clean.
6. **paradigm-mcp build artifacts in git status** — `tool-cache.{js,d.ts,js.map,d.ts.map}` and their `.d.ts` sibling are UNTRACKED but sitting in `src/`. Either add to a tsup output-clean step or add `src/**/*.{js,d.ts,js.map,d.ts.map}` exception-ignore in the mcp package's .gitignore.

## Revised severity counts
Original: 1 / 14 / 11
After triage: **1 / 8 / 14** (+2 new) = **1 blocking, 8 improvements, 16 notes/informational**

Reclassifications:
- 1.2 stays blocking (scoped more precisely — types resolution for nodenext consumers).
- 1.3 → note (VSCode-specific metadata irrelevant to npm).
- 1.4 → note (was false claim; metadata gap remains as note).
- 2.2 stays improvement, rescoped to root `.next/`.
- 5.1 → note (umbrella pattern, not a bug).
- 5.2 merged into 2.1.
- 6.1 → DROPPED (false positive).
- 9.2 → DROPPED (vscode convention).
- 9.3 stays note (but recommend dropping `publishConfig`, not `private: true`).
- 1.7 stays note.
- New: root `.next` → improvement.
- New: tsup/gitignore polish for mcp-package artifacts → improvement.

## Recommended fix order
User-impact × fix-effort priority for the fix bundle:

**Tier 1 — Ship in next patch (v5.38.1):**
1. **1.2** Reorder logger `exports` so `types` comes first. 1-line change, unblocks typed consumers on `nodenext`.
2. **2.1 / 5.2 merged** Remove `packages/paradigm-mcp/src/utils/tool-cache.{d.ts,d.ts.map,js,js.map}`. Update tsup config to output to `dist/` only. Add pattern to package-local `.gitignore`.
3. **2.2 (rescoped)** Add `/.next/` to root `.gitignore` and remove the untracked root `.next/` directory.
4. **1.5** Bump all `@types/node` to `^22.10.0` (unify upward), OR pin site down to `^20.10.0`. Pick one consistent floor.

**Tier 2 — Polish round (v5.38.x):**
5. **1.1** Add `homepage`/`bugs`/`repository` to `packages/logger/package.json`.
6. **1.4** Add same metadata to sentinel-web (drop the "require contradiction" claim).
7. **1.3** Add `files` field to paradigm-vscode for publish hygiene.
8. **9.3** Drop `publishConfig` block from paradigm-mcp (reflects unpublished reality).

**Tier 3 — Background / long-running:**
9. **8.1** Centralize sql.js type stubs into shared internal package.
10. **5.1** Expand umbrella `.purpose` files ONLY if user wants IDE tooltip coverage on umbrella dirs — otherwise skip.
11. **4.2 / 4.3** Standardize test location, add sentinel-web/university tests.
12. **1.6** Align express major version when convenient.
13. **3.3** Reduce `any` in sentinel.ts/orchestration.ts when protocol types mature.

**Skip:**
- **6.1** (doesn't reproduce)
- **9.2** (not applicable to vscode)
- **3.1** (intentional templates)
- **1.7** (chalk is transitive, nothing to act on)

---

```yaml
# Agent Relay
status: success
summary: |
  Triaged all 26 findings. Validated the 1 blocking finding (logger exports
  ordering) against packages/logger/package.json:8-13 — it IS real but its
  impact is scoped to TypeScript consumers on node16/nodenext module resolution,
  not a hard npm-publish blocker. Caught 5 false positives (1.4 sentinel-web
  exports, 6.1 README v2.0, 5.1 umbrella .purpose files, 9.2 vscode engines,
  partial 2.2 site/.next already gitignored). Surfaced 2 new findings (root
  .next not in gitignore, paradigm-mcp tsup output polluting src/). Revised
  counts: 1 / 8 / 16 after reclassification. Prioritized a 4-item Tier-1 fix
  bundle for next patch.
artifacts:
  - reviews/2026-04-22-cleanup-audit-triage.md
decisions:
  - 1.4 sentinel-web "require contradiction" → FALSE POSITIVE (valid dual-package)
  - 6.1 README v2.0 → FALSE POSITIVE (does not appear in README)
  - 5.1 umbrella .purpose stubs → demoted to note (umbrella dirs are thin by design)
  - 9.2 paradigm-vscode engines.node → DROPPED (vscode extensions don't need it)
  - 2.2 rescoped from packages/site/.next to root .next
  - New finding: root-level .next untracked, add to root gitignore
  - New finding: paradigm-mcp tsup emits into src/utils/ (tool-cache.*)
handoff_to: architect (in parallel) + user
handoff_context: |
  Architect: Tier-1 fix bundle is 4 items (1.2 logger exports, 2.1+5.2 merged
  tool-cache cleanup, rescoped 2.2 root .next gitignore, 1.5 @types/node
  alignment). All trivial-to-small effort, safe for v5.38.1 patch. Tier-2 is
  7 more cosmetic improvements; Tier-3 is longer-horizon. Skip 6.1, 9.2, 3.1,
  1.7 — they're false positives or non-actionable. Recommend architect also
  scan v5.38.0 CHANGELOG for undocumented breaking changes in loadPortalConfig
  (flagged as possible miss but unverified by reviewer).
```
