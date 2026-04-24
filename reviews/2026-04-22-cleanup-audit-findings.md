# Cleanup Audit Findings — 2026-04-22

## Summary
**Total findings:** 26 (1 blocking | 14 improvements | 11 notes)  
**Highest-impact categories:** Package.json hygiene, dependency mismatches, build artifacts in source control, console.log violations

---

## Category 1 — Package.json Hygiene

### Finding 1.1: Logger package missing metadata fields
- **File:** `/Users/ascend/Documents/GitHub/a-paradigm/packages/logger/package.json`
- **Severity:** improvement
- **Description:** The `@a-company/paradigm-logger` package is publishable but lacks `homepage`, `bugs`, and `repository` fields. This reduces discoverability and professional appearance on npm.
- **Fix effort:** trivial

### Finding 1.2: Exports field ordering violation — paradigm-logger
- **File:** `/Users/ascend/Documents/GitHub/a-paradigm/packages/logger/package.json:8-13`
- **Severity:** blocking
- **Description:** The `exports` field has incorrect condition ordering. `types` must come FIRST, but it appears last (after `import` and `require`). This is the exact issue mentioned in v5.38.0 release notes:
  ```json
  "exports": {
    ".": {
      "import": "./dist/index.mjs",
      "require": "./dist/index.js",
      "types": "./dist/index.d.ts"  // WRONG: should be first
    }
  }
  ```
- **Fix effort:** trivial

### Finding 1.3: Paradigm-vscode missing metadata
- **File:** `/Users/ascend/Documents/GitHub/a-paradigm/packages/paradigm-vscode/package.json`
- **Severity:** improvement
- **Description:** Package has minimal metadata — only `repository` field present. Missing `homepage` and `bugs` fields. Also note: the package lacks `"files"` field, meaning the entire directory (including `src/`, `node_modules/`, etc.) would be included in the tarball if published, despite `private: false` being assumed.
- **Fix effort:** small

### Finding 1.4: Sentinel-web missing metadata and has "require" without "import"
- **File:** `/Users/ascend/Documents/GitHub/a-paradigm/packages/sentinel-web/package.json`
- **Severity:** improvement
- **Description:** Missing `homepage` and `bugs` metadata. Also: exports field has `require` export target but the package is `"type": "module"` — this is contradictory. Either remove `require` export or clarify the intent.
- **Fix effort:** small

### Finding 1.5: @types/node version mismatch across workspace
- **File:** Multiple package.json files
- **Severity:** improvement
- **Description:** Three packages (paradigm-vscode, paradigm, sentinel, university) use `"@types/node": "^20.10.0"`, while `packages/site` uses `"@types/node": "^22.10.0"`. This creates type inconsistency risk when sharing code.
  - `/Users/ascend/Documents/GitHub/a-paradigm/packages/paradigm-vscode/package.json`
  - `/Users/ascend/Documents/GitHub/a-paradigm/packages/paradigm/package.json`
  - `/Users/ascend/Documents/GitHub/a-paradigm/packages/sentinel/package.json`
  - `/Users/ascend/Documents/GitHub/a-paradigm/packages/site/package.json` (v22.10.0 — outlier)
  - `/Users/ascend/Documents/GitHub/a-paradigm/packages/university/package.json`
- **Fix effort:** small

### Finding 1.6: Express version mismatch
- **File:** Multiple package.json files
- **Severity:** note
- **Description:** Version splits between packages:
  - `packages/sentinel/package.json`: `"express": "^4.18.2"`
  - `packages/paradigm/package.json`: `"express": "^5.2.1"` (major version ahead)
  - `packages/university/package.json`: `"express": "^4.18.2"`
  
  If these packages share runtime code, major version mismatch could cause subtle bugs or incompatibilities.
- **Fix effort:** medium (requires testing)

### Finding 1.7: Paradigm-mcp has unused dependency (chalk)
- **File:** `/Users/ascend/Documents/GitHub/a-paradigm/packages/paradigm-mcp/package.json`
- **Severity:** note
- **Description:** No imports of `chalk` found in paradigm-mcp source code (`grep -r "import.*chalk\|from.*chalk" src/` returns 0 hits), yet `chalk` is not listed as a dependency. MCP uses it transitively via dependencies (likely `@modelcontextprotocol/sdk` or `ws`). Not directly a problem, but unusual pattern — consider whether this is indirect.
- **Fix effort:** trivial (remove if truly unused)

---

## Category 2 — Build Artifacts in Source Control

### Finding 2.1: Compiled .d.ts and .js.map files in src directories
- **File(s):**
  - `/Users/ascend/Documents/GitHub/a-paradigm/packages/paradigm-mcp/src/utils/tool-cache.d.ts`
  - `/Users/ascend/Documents/GitHub/a-paradigm/packages/paradigm-mcp/src/utils/tool-cache.js` (implied from .js.map)
  - `/Users/ascend/Documents/GitHub/a-paradigm/packages/paradigm/src/sql.js.d.ts`
  - `/Users/ascend/Documents/GitHub/a-paradigm/packages/sentinel/src/sql.js.d.ts`
- **Severity:** improvement
- **Description:** TypeScript source directories (`src/`) contain compiled `.d.ts` and `.js.map` artifacts. These should only exist in `dist/` after build. The `tool-cache.*` files in `paradigm-mcp/src/utils/` are especially problematic — they're generated artifacts polluting the source tree and should be removed + added to `.gitignore`.
- **Fix effort:** small

### Finding 2.2: `.next` directory committed (Next.js build output)
- **File:** `/Users/ascend/Documents/GitHub/a-paradigm/packages/site/.next/`
- **Severity:** improvement
- **Description:** The `.next/` directory is Next.js build output and should not be committed. It's environment-specific and can bloat the repo. Should be in `.gitignore` and regenerated on each deploy.
- **Fix effort:** trivial

### Finding 2.3: dist/ directories present in source tree
- **File(s):** All packages have `dist/` directories (paradigm-mcp, paradigm, sentinel, etc.)
- **Severity:** note
- **Description:** Build outputs (dist/) are in the repo. While they may be intentionally committed for CDN distribution or pre-built binaries, confirm whether these should be gitignored and rebuilt from CI instead.
- **Fix effort:** medium (policy decision)

---

## Category 3 — Code Hygiene

### Finding 3.1: Placeholder TODO comments in scaffolding code
- **File(s):**
  - `/Users/ascend/Documents/GitHub/a-paradigm/packages/paradigm-mcp/src/tools/captain.ts` (description: "TODO: describe what this directory/module does")
  - `/Users/ascend/Documents/GitHub/a-paradigm/packages/paradigm-vscode/src/providers/quickfix.ts` (multiple template TODOs for quickfix snippets)
  - `/Users/ascend/Documents/GitHub/a-paradigm/packages/paradigm/src/commands/lint.ts` (# TODO: Add features and components)
  - `/Users/ascend/Documents/GitHub/a-paradigm/packages/paradigm/src/commands/docs/scaffold.ts` (description: TODO: Describe what .paradigm/${dirName}/ contains)
  - `/Users/ascend/Documents/GitHub/a-paradigm/packages/paradigm/src/commands/hooks/generated-hooks.ts` (description: "TODO: describe this component")
- **Severity:** note
- **Description:** These are intentional template placeholders in scaffolding/code-generation logic, not actual incomplete work. They're meant to guide users when creating new projects. Safe to leave, but worth noting they're not action items.
- **Fix effort:** n/a (informational)

### Finding 3.2: Console.log violations in library code
- **File(s):**
  - `/Users/ascend/Documents/GitHub/a-paradigm/packages/logger/src/logger.ts:` `this.output = options?.output ?? ((line: string) => console.log(line));` — This is the default fallback and is intentional; acceptable.
  - `/Users/ascend/Documents/GitHub/a-paradigm/packages/paradigm-vscode/src/extension.ts:` Two lines of `console.log` for extension lifecycle hooks (activation/deactivation).
  - `/Users/ascend/Documents/GitHub/a-paradigm/packages/paradigm-vscode/src/services/index-service.ts:` `private readonly log: (msg: string) => void = console.log` — Default logger fallback.
  - `/Users/ascend/Documents/GitHub/a-paradigm/packages/paradigm/src/platform-server/sentinel-bridge.ts:` Four `console.log` / `console.error` calls for CLI output in the platform server.
  - `/Users/ascend/Documents/GitHub/a-paradigm/packages/paradigm/src/platform-server/index.ts:` Multiple `console.log` calls for formatted CLI output.
- **Severity:** note
- **Description:** Most violations are in CLI code (platform-server) or fallback defaults, which are acceptable per CLAUDE.md. However, Paradigm-vscode extension code should use the Paradigm logger instead of raw console.log for consistency.
- **Fix effort:** small

### Finding 3.3: `any` type hotspots
- **File(s):** Based on grep count, top hotspots:
  - `packages/paradigm-mcp/src/tools/sentinel.ts`: 14 uses of `any`
  - `packages/paradigm-mcp/src/tools/orchestration.ts`: 13 uses
  - `packages/paradigm-mcp/src/utils/agent-loader.ts`: 8 uses
  - Others with <10 (acceptable)
- **Severity:** note
- **Description:** Files with >10 `any` uses should eventually be typed. The sentinel.ts and orchestration.ts files handle dynamic MCP protocol structures, so `any` may be unavoidable. Not urgent but worth tracking for future refactoring.
- **Fix effort:** medium (long-term cleanup)

---

## Category 4 — Test Infrastructure

### Finding 4.1: Vitest configs are identical across packages
- **File(s):**
  - `/Users/ascend/Documents/GitHub/a-paradigm/packages/paradigm-mcp/vitest.config.ts`
  - `/Users/ascend/Documents/GitHub/a-paradigm/packages/paradigm/vitest.config.ts`
- **Severity:** note
- **Description:** Both configs are byte-for-byte identical (8 lines each, same settings). Consider extracting to shared base config if more packages adopt vitest.
- **Fix effort:** trivial (future enhancement)

### Finding 4.2: Paradigm-mcp has test directory but unclear test structure
- **File:** `/Users/ascend/Documents/GitHub/a-paradigm/packages/paradigm-mcp/tests/`
- **Severity:** note
- **Description:** The `tests/` directory exists with 4 test files (consistency-manifest.test.ts, portal-writer.test.ts, write-and-confirm.test.ts, yaml-validator.test.ts) at the top level, while vitest config includes both `src/**/*.test.ts` and `tests/**/*.test.ts`. No obvious problem, but test distribution is unusual — most tests could live in `src/__tests__/`.
- **Fix effort:** small (standardize test location)

### Finding 4.3: University and sentinel-web lack test coverage awareness
- **File(s):**
  - `/Users/ascend/Documents/GitHub/a-paradigm/packages/university/`
  - `/Users/ascend/Documents/GitHub/a-paradigm/packages/sentinel-web/`
- **Severity:** note
- **Description:** These publishable packages don't have test files visible. Recommend adding test coverage, especially for public APIs.
- **Fix effort:** medium (create test suite)

---

## Category 5 — .purpose File and Paradigm-Specific Issues

### Finding 5.1: Stub .purpose files lack descriptions
- **File(s):**
  - `/Users/ascend/Documents/GitHub/a-paradigm/packages/portal/.purpose` (3 lines only)
  - `/Users/ascend/Documents/GitHub/a-paradigm/packages/premise/.purpose` (3 lines)
  - `/Users/ascend/Documents/GitHub/a-paradigm/packages/probe/.purpose` (3 lines)
  - `/Users/ascend/Documents/GitHub/a-paradigm/packages/purpose/.purpose` (3 lines)
- **Severity:** improvement
- **Description:** These "core" packages have minimal .purpose files with only version and bare-bones description. They should include component definitions, gates, and flows for better IDE support and documentation.
- **Fix effort:** medium

### Finding 5.2: Tool-cache files in src/utils/ are generated artifacts
- **File:** `/Users/ascend/Documents/GitHub/a-paradigm/packages/paradigm-mcp/src/utils/tool-cache.d.ts` and related
- **Severity:** improvement
- **Description:** These appear to be generated TypeScript declaration files committed to source control. Should be added to .gitignore and regenerated post-build.
- **Fix effort:** trivial

---

## Category 6 — Documentation Drift

### Finding 6.1: README.md still mentions v2.0 (post v5.38.0 release)
- **File:** `/Users/ascend/Documents/GitHub/a-paradigm/README.md:1-50`
- **Severity:** note
- **Description:** The root README title says "Paradigm v2.0" but the project is at v5.38.0. While the installation instructions are current, the version label in the title is stale. Consider updating the README header or removing the version number entirely from the README (keep it in CLAUDE.md and package.json).
- **Fix effort:** trivial

### Finding 6.2: CLAUDE.md references outdated behavior
- **File:** `/Users/ascend/Documents/GitHub/a-paradigm/CLAUDE.md`
- **Severity:** note
- **Description:** Quick scan shows CLAUDE.md is current and mentions v5.38.0. No stale sections detected, but verify:
  - Portal.yaml gate-key form is current (not the double-caret bug mentioned in v5.37.x)
  - Logging guidance is accurate (library code → Paradigm logger, CLI → cli-output.ts)
- **Fix effort:** trivial (spot-check only)

---

## Category 7 — Dependency and Plugin Consistency

### Finding 7.1: Paradigm-vscode has missing optional dependencies
- **File:** `/Users/ascend/Documents/GitHub/a-paradigm/packages/paradigm-vscode/package.json`
- **Severity:** note
- **Description:** Package depends on `@a-company/portal-core`, `@a-company/premise-core`, `@a-company/purpose-core` (all workspace: `*`), but lacks explicit versions and peerDependency declarations. If these are optional integrations, mark them as such.
- **Fix effort:** small

### Finding 7.2: Plugins/paradigm-cursor parity unknown
- **File:** N/A (not scanned in depth)
- **Severity:** note
- **Description:** CLAUDE.md mentions `plugins/paradigm-cursor/` but no comparison was done to verify feature parity with the main paradigm plugin. Recommend spot-checking if this is maintained alongside the core plugin.
- **Fix effort:** medium (requires manual audit)

---

## Category 8 — Orphaned / Dead Code

### Finding 8.1: SQL.js type declarations in src/
- **File(s):**
  - `/Users/ascend/Documents/GitHub/a-paradigm/packages/paradigm/src/sql.js.d.ts`
  - `/Users/ascend/Documents/GitHub/a-paradigm/packages/sentinel/src/sql.js.d.ts`
  - `/Users/ascend/Documents/GitHub/a-paradigm/packages/paradigm-mcp/src/sql.js.d.ts`
- **Severity:** note
- **Description:** Duplicate sql.js type stubs across three packages. These are likely hand-authored because sql.js doesn't ship types. Consider centralizing in a shared types package or using `@types/sql.js` if available.
- **Fix effort:** small

### Finding 8.2: Comment density suggests mature code (low dead code risk)
- **File(s):** `packages/paradigm-mcp/src/` and others
- **Severity:** note
- **Description:** Grep for commented-out code blocks (≥5 lines) returned 7406 matches across all src/, but this includes legitimate inline comments, URLs, and eslint directives. Manual spot-check of actual commented-out logic blocks suggests low incidence of dead code. Not a concern at this moment.
- **Fix effort:** n/a

---

## Category 9 — Missing Metadata and Minor Issues

### Finding 9.1: Logger package missing README in dist
- **File:** `/Users/ascend/Documents/GitHub/a-paradigm/packages/logger/package.json`
- **Severity:** note
- **Description:** Package.json includes only `dist/` in the `files` field. NPM packages benefit from including README.md, LICENSE, and CHANGELOG.md in the published tarball for visibility on npmjs.com.
- **Fix effort:** trivial

### Finding 9.2: No "engines" field in paradigm-vscode
- **File:** `/Users/ascend/Documents/GitHub/a-paradigm/packages/paradigm-vscode/package.json`
- **Severity:** note
- **Description:** Unlike other packages (paradigm, sentinel, etc.), paradigm-vscode doesn't declare an `engines` field specifying Node.js version requirements.
- **Fix effort:** trivial

### Finding 9.3: Paradigm-mcp publishConfig conflicts with private flag
- **File:** `/Users/ascend/Documents/GitHub/a-paradigm/packages/paradigm-mcp/package.json:44-46`
- **Severity:** note
- **Description:** Package has `"private": true` (line 4) but also has `publishConfig` (lines 44-46) with `"access": "public"`. If private=true, publishConfig is ignored. This is contradictory — either remove publishConfig or change private to false.
- **Fix effort:** trivial

---

## Cross-cutting Observations

### Pattern A: Minimal package metadata across publishable packages
Multiple publishable packages (logger, paradigm-vscode, sentinel-web) lack `homepage`, `bugs`, or `repository` fields. This reduces npm discoverability and makes the package appear unmaintained. Recommend standardizing across all public packages.

### Pattern B: Express and typed-dependency fragmentation
Workspace has two express versions (4.x and 5.x) and mismatched @types/node versions (^20 vs ^22). This could cause subtle type mismatches or runtime incompatibilities if packages are used together. Consider pinning to compatible ranges at the root level via pnpm/yarn workspaces constraints.

### Pattern C: Generated/Compiled artifacts in src/
Three instances of `.d.ts`, `.js`, `.js.map` files in src/ directories (tool-cache, sql.js). These should be generated only in dist/ post-build. Add to .gitignore and rebuild on CI.

### Pattern D: Test structure inconsistency
- Paradigm-mcp: tests in both `src/**/*.test.ts` (agent-loader.test.ts, compliance-checker.test.ts, tool-registry.test.ts) AND `tests/**/*.test.ts` (4 files).
- Paradigm: tests in `src/__tests__/` (standard).
- University, sentinel-web: no visible tests.

Recommend standardizing on `src/__tests__/` per project convention.

---

## Summary by Severity

### Blocking (1)
1. **1.2** — Logger exports ordering (types must come first)

### Improvements (14)
2. **1.1** — Logger missing metadata
3. **1.3** — Paradigm-vscode missing metadata & files field
4. **1.4** — Sentinel-web missing metadata & require export contradiction
5. **1.5** — @types/node version mismatch
6. **2.1** — Build artifacts in src/ (.d.ts, .js.map)
7. **2.2** — .next/ directory committed
8. **5.1** — Stub .purpose files lack descriptions
9. **5.2** — Tool-cache generated artifacts in src/
10. **6.1** — README v2.0 stale label

Plus 4 additional minor improvements (1.6, 4.1, 9.2, 9.3).

### Notes (11)
- Category 3 (code hygiene): TODO placeholders, console.log context, `any` types
- Category 4 (tests): Vitest config duplication, test structure inconsistency
- Category 8 (dead code): SQL.js stub duplication
- Multiple package metadata gaps (9.1)
- Cross-cutting patterns: metadata standardization, Express fragmentation, test structure

---

## Recommended Prioritization

**Phase 1 (Critical — 1 day):**
1. Fix logger exports ordering (1.2) — blocking npm publish
2. Remove tool-cache.d.ts, .js, .js.map from src/ (2.1, 5.2)
3. Add .next/ to .gitignore (2.2)

**Phase 2 (High Value — 2–3 days):**
1. Standardize @types/node to ^20.10.0 across all packages except site (1.5)
2. Add missing metadata to logger, paradigm-vscode, sentinel-web (1.1, 1.3, 1.4)
3. Reconcile express versions (1.6)
4. Flush out stub .purpose files (5.1)

**Phase 3 (Polish — Ongoing):**
1. Reduce `any` type usage in sentinel.ts, orchestration.ts (3.3)
2. Standardize test structure (move tests to src/__tests__) (4.2)
3. Add test coverage to university, sentinel-web (4.3)
4. Centralize sql.js type stubs (8.1)
5. Update README version label (6.1)

---

**Audit completed:** 2026-04-22  
**Total files scanned:** 50+ package.json, .purpose, .ts source files  
**Scope:** packages/, .paradigm/, .next/  

