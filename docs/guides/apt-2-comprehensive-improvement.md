# APT-2: Comprehensive Improvement — Historical Reference

> **Branch:** `APT-2` | **Date:** February 2026 | **Commit:** `86072cb`
> **Scope:** 77 files changed, +5,176 / -342 lines, 13 new files created

An internal audit identified 29 functional improvements across the CLI, MCP tools, lore, habits, sentinel, hooks, and build pipeline. External research surfaced innovations from AGENTS.md standard, llms.txt, Mermaid flow visualization, auto-lore, and context engineering. The work was organized into 6 phases executed across ~5 sessions.

---

## Phase 1: Type Safety & Quick Wins

**Problem:** Scattered `any` types weakened type checking. The symbol parser still accepted deprecated v1 prefixes (`@`, `%`, `?`, `&`). Sentinel errors were generic and unhelpful.

**What changed:**

| File | Change |
|------|--------|
| `portal/watch.ts` | Replaced `any` at lines ~38, 115 with typed interfaces |
| `mcp/switch.ts` | Replaced `any` at line ~77 |
| `mcp/setup.ts` | Replaced `any` at lines ~417, 480, 620 |
| `tutorial/index.ts` | Replaced `any` at 7 locations with `Curriculum` interface |
| `flow-schema.ts` | Removed v1 prefixes from `parseSymbol` regex; v2-only validation |
| `sentinel.ts` | Generic catch at line ~48 replaced with actionable error messages |

**Why it matters:** These are the kind of small erosions that compound — each `any` is a place where the compiler can't help you, and each generic error message is a developer reaching for `--verbose` instead of knowing what went wrong.

---

## Phase 2: Validation & Safety Hardening

**Problem:** Flows could have circular dependencies with no warning. Lore entries could reference nonexistent symbols. Destructive commands had no preview mode. `symbolExistsInCode` only grepped source — missing symbols declared in `.purpose` files.

**What changed:**

- **Circular dependency detection** — DFS-based cycle detection in `flow-validator.ts`. When a flow's steps reference other flows that eventually loop back, the validator reports the exact cycle path. Added `circularDependencies` field to `AllFlowsValidationResult`.

- **Lore symbol validation** — `recordLore()` gained an optional `validateSymbols` parameter. When enabled, it warns on any `symbols_touched` entry that doesn't exist in the registered .purpose, flow, or portal index.

- **`--dry-run` everywhere** — `hooks install`, `hooks uninstall`, `lore delete`, and `upgrade` now accept `--dry-run` to preview what they would do without side effects.

- **Hook syntax validation** — Generated hook scripts are validated with `bash -n` before being written to disk. Catches syntax errors at generation time instead of at runtime.

- **`.purpose` declaration checking** — `symbolExistsInCode` now checks `.purpose` file declarations in addition to grep-in-source. A symbol declared in `.purpose` but not yet implemented still "exists" in the project.

**Why it matters:** Safety nets. Every one of these catches a real failure mode that previously required manual debugging.

---

## Phase 3: Habits, Sentinel & Doctor Expansion

**Problem:** The habits system only covered basic checks. Sentinel's incident grouper used a fixed similarity threshold with no time awareness. The suggester always recommended `fix-code`. Doctor checked a limited set of project health signals.

**What changed:**

### New Habit Check Types

| Check Type | What It Enforces |
|------------|------------------|
| `commit-message-format` | Commits follow the `type(#symbol): description` pattern |
| `flow-coverage` | Modified flows have all steps implemented in code |
| `context-checked` | Agent called `paradigm_wisdom_context` before modifying symbols |
| `aspect-anchored` | All `~aspect` symbols have valid code anchors |

Each has an evaluator function in `evaluator.ts` and seed definition in `seed-habits.json`.

### Sentinel Improvements

- **Configurable grouping** — `SIMILARITY_THRESHOLD` is now tunable. Time-decay weighting reduces similarity scores for temporally distant incidents. Stack trace fingerprinting groups by call site rather than just message text.

- **Escalation strategy inference** — Instead of always suggesting `fix-code`, the suggester now analyzes incident patterns and infers one of: `fix-code`, `rollback`, `config-change`, `scale-up`, `investigate`. Added `EscalationStrategy` enum to `types.ts`.

### Doctor Expansion

6 new checks: portal.yaml structural validity, flows.yaml validation (including circular deps), lore health (orphaned entries, stale references), hook freshness (do installed hooks match current templates?), habits config validity, AGENTS.md staleness (is it older than the last `paradigm scan`?).

**Why it matters:** This is the layer that turns Paradigm from a documentation tool into an enforcement system. Habits catch process violations automatically. Sentinel groups and triages intelligently. Doctor validates holistically.

---

## Phase 4: Portal, Lint & Pre-Publish

**Problem:** Gate test fixtures were hand-written boilerplate. Portal data was locked inside YAML with no export path. Undocumented components accumulated silently. Publishing had no pre-flight validation.

**What changed:**

- **Portal test auto-generation** — `portal test` now introspects gate `check` expressions (e.g., `req.user != null`, `project.admins.includes(req.user.id)`) and auto-generates test fixtures with passing and failing cases. The TODO at line ~119 in `portal/test.ts` is resolved.

- **Portal export** — New `paradigm portal export` subcommand outputs all gates and routes in csv, json, or markdown format. Useful for security audits, documentation generation, and CI pipelines.

- **`lint --auto-populate`** — Scans source directories for files without `.purpose` coverage. Suggests component names and descriptions based on file paths and exports. With `--fix`, writes draft `.purpose` entries automatically.

- **Pre-publish check** — `scripts/pre-publish-check.mjs` runs before `npm publish`: verifies all packages build, checks version consistency across the monorepo, validates CHANGELOG entries exist, runs `paradigm doctor`, and validates plugin `hooks.json`.

**Why it matters:** Automation for the parts of Paradigm maintenance that are tedious but critical. Auto-populating `.purpose` files lowers the barrier to adoption. Pre-publish checks prevent shipping broken releases.

---

## Phase 5: Documentation Standards & AI Interop

**Problem:** Paradigm projects were well-structured for Paradigm-aware agents but opaque to general-purpose LLMs. MCP tool descriptions lacked return type information and cost guidance. Documentation patterns hadn't kept pace with the system's growth.

**What changed:**

### New Commands

- **`paradigm sync-llms`** — Generates `llms.txt` at the repo root. This is a machine-readable project summary following the emerging `llms.txt` standard: lists all symbols, key files, flows, gates, and project conventions. Any LLM can read this file to orient itself — no Paradigm tooling required.

- **`paradigm flow diagram <flowId>`** — Renders a flow definition as a Mermaid flowchart. Gates become diamonds (yellow), actions become rectangles (blue), signals become rounded boxes (green). Gate deny paths are shown when `failResponse` or `errorSignal` is defined. Output can be piped to a file or displayed inline.

### AGENTS.md Expansion

The generated AGENTS.md now includes 4 new sections via `base.ts` generators:
- **Session Checkpoints** — When to save phase transitions, what to capture
- **Habits Compliance** — Trigger table (preflight/postflight/on-stop), category descriptions
- **Lore Recording** — Entry type table, when to record, example entries
- **llms.txt Reference** — What it is, how to regenerate

### MCP Tool Descriptions

All 52 tool descriptions across 14 modules were enhanced with:
- What the tool returns (data shape)
- When to use it vs alternatives
- Approximate token cost (~100-300 tokens per call)

### Documentation Expansion

- **patterns.md** gained 4 new patterns: multi-agent handoff, lore recording, habit compliance, flow-first development
- **ai-maintenance-protocol.md** gained 3 decision trees: "Should I record lore?", "Should I create a flow?", and a new feature compliance checklist

**Why it matters:** This is about making Paradigm projects legible at every level. `llms.txt` works for any LLM. AGENTS.md works for Claude-family agents. MCP tool descriptions work for connected agents. The patterns and decision trees work for the agents that are actually writing code.

---

## Phase 6: Advanced Intelligence

**Problem:** MCP tools re-scanned the index on every call. Plugin version mismatches caused silent failures. Lore entries didn't track AI collaboration. Session context was lost when agents didn't manually record lore. Operational parameters were hardcoded.

**What changed:**

### ToolCache

New `tool-cache.ts` in `paradigm-mcp/src/utils/` provides an in-memory TTL cache (default 30 seconds) wrapping `paradigm_search`, `paradigm_status`, and `paradigm_navigate`. The `getOrCompute()` method returns cached results for identical arguments within the TTL window. Cache is cleared automatically when `paradigm_reindex` completes, ensuring freshness after structural changes.

### Plugin Version Compatibility

`hooks install` now reads a `compatibleVersions` field from the plugin's `hooks.json`:
```json
{ "compatibleVersions": { "min": "3.0.0", "max": "4.0.0" } }
```
If the installed Paradigm CLI version falls outside this range, a warning is displayed. This prevents plugins from silently breaking when the CLI introduces breaking changes.

### Co-authorship Tracking

New `assistedBy` field on `LoreEntry`:
```typescript
assistedBy?: {
  type: 'agent' | 'tool' | 'human';
  id: string;
  role?: string;
}
```
Captures who (or what) helped with a recorded session — enabling teams to analyze AI collaboration patterns across their project history.

### Auto-Lore Drafting

`draftLoreFromBreadcrumbs()` in `lore/storage.ts` generates partial lore entries from session data when 3+ files are modified. It extracts tool usage statistics from breadcrumbs (edit count, write count, read count), includes symbols touched and files modified, and tags the draft with `auto-draft` for human review. The 3-file threshold prevents noise from trivial edits.

### Configurable Limits

New `LimitsConfig` interface in `paradigm-config.ts`:

| Field | Default | Controls |
|-------|---------|----------|
| `habitsCacheTtlMs` | 30000 | How long parsed habit definitions are cached |
| `toolCacheTtlMs` | 30000 | TTL for MCP tool result cache |
| `threadTrailMax` | 10 | Max breadcrumbs shown in thread trail |
| `breadcrumbsMax` | (unlimited) | Max breadcrumbs stored per session |
| `checkpointMaxAgeMs` | 604800000 (7d) | Session checkpoint expiration |

All fields are optional with sensible defaults. Configure in `.paradigm/config.yaml` under `limits:`.

### Global Brain Rotation

New `paradigm global clean` command scans `~/.paradigm/` directories (wisdom, lore, history, cache) for files older than a specified duration:
```
paradigm global clean --older-than 90d --dry-run  # preview
paradigm global clean --older-than 90d            # execute
```
Cleans up empty directories after file removal.

### Integration Tests

4 new test files with 13 tests:
- `integration-build.test.ts` — TypeScript compilation and npm build verification
- `integration-hooks.test.ts` — Plugin hooks.json structure validation
- `integration-tool-cache.test.ts` — Cache behavior, TTL expiration, invalidation
- `integration-lore-draft.test.ts` — Auto-lore drafting triggers and output

**Why it matters:** Phase 6 is about the system getting smarter about itself. Caching reduces waste. Version checks prevent breakage. Auto-lore captures history that agents would otherwise forget. Configurable limits let projects tune behavior instead of forking code.

---

## University Updates

All 5 courses (PARA 101-501) were reviewed for accuracy against all 6 phases — no inaccuracies found.

### New Content

| Course | Addition |
|--------|----------|
| PARA 101 | `llms.txt` key concept in project structure |
| PARA 201 | Mermaid flow visualization + circular dependency detection |
| PARA 301 | Sentinel escalation strategies, 6 doctor checks, `lint --auto-populate` |
| PARA 401 | Enhanced MCP tools overview + new `agent-interop` lesson (AGENTS.md, llms.txt) |
| PARA 501 | 4 new habit check types, lore symbol validation, co-authorship tracking |

### PLSAT v3.0 Expansion

16 new exam slots (slots 062-077) with 28 question variants:

| Slots | Phase | Topics |
|-------|-------|--------|
| 062-063 | 4 | Portal test introspection, portal export, lint auto-populate |
| 064 | 5 | AGENTS.md vs llms.txt distinction, token-efficient orientation |
| 065 | 5 | Mermaid diagram shapes and color coding |
| 066 | 6 | ToolCache behavior, cache invalidation on reindex |
| 067 | 6 | Auto-lore drafting triggers, `auto-draft` tag |
| 068 | 6 | Configurable limits, `toolCacheTtlMs` |
| 069 | 6 | Global Brain rotation with `paradigm global clean` |
| 070 | 6 | Plugin version compatibility checking |
| 071 | 6 | Co-authorship tracking with `assistedBy` |
| 072 | 6 | Default values when limits unconfigured |
| 073 | 6 | Cache invalidation sequence (reindex clears ToolCache) |
| 074 | 6 | Auto-lore breadcrumb analysis, 3-file threshold |
| 075 | 6 | Safe `--dry-run` workflow for global clean |
| 076 | 6 | Why ToolCache and habits cache are separate |
| 077 | 6 | Configuring limits for large monorepos |

### Reference Card

New cards: `sync-llms`, `flow diagram`, `portal export`, `lint --auto-populate`, `global clean`, and full configurable limits section (6 cards).

---

## Files Changed

### New Files (13)

| File | Purpose |
|------|---------|
| `packages/paradigm/src/commands/sync-llms.ts` | `paradigm sync-llms` CLI command |
| `packages/paradigm/src/commands/flow.ts` | `paradigm flow diagram` CLI command |
| `packages/paradigm/src/commands/global.ts` | `paradigm global clean` CLI command |
| `packages/paradigm-mcp/src/utils/tool-cache.ts` | ToolCache class with TTL |
| `packages/paradigm/src/core/flow-validator.test.ts` | Mermaid diagram tests |
| `packages/paradigm/src/__tests__/integration-build.test.ts` | Build verification tests |
| `packages/paradigm/src/__tests__/integration-hooks.test.ts` | Hook validation tests |
| `packages/paradigm/src/__tests__/integration-tool-cache.test.ts` | ToolCache tests |
| `packages/paradigm/src/__tests__/integration-lore-draft.test.ts` | Auto-lore tests |
| `scripts/pre-publish-check.mjs` | Pre-publish validation script |
| `.paradigm/specs/caching.md` | MCP caching strategy spec |
| `.paradigm/specs/habits.md` | Habit check types spec |
| `.paradigm/docs/publishing.md` | Pre-publish process doc |

### Modified Files by Package

**paradigm (26 files):** `index.ts`, `doctor.ts`, `hooks/index.ts`, `lint.ts`, `lore/delete.ts`, `mcp/setup.ts`, `mcp/switch.ts`, `portal/test.ts`, `portal/watch.ts`, `sentinel.ts`, `thread.ts`, `tutorial/index.ts`, `flow-schema.ts`, `flow-validator.ts`, `habits/evaluator.ts`, `habits/loader.ts`, `habits/seed-habits.json`, `habits/types.ts`, `ide-adapters/agents.ts`, `ide-adapters/base.ts`, `ide-adapters/base.test.ts`, `lore/storage.ts`, `lore/types.ts`, `paradigm-config.ts`, `.purpose` (x2)

**paradigm-mcp (16 files):** All 14 tool modules (`context.ts`, `fixtures.ts`, `flows.ts`, `habits.ts`, `history.ts`, `index.ts`, `lore.ts`, `navigate.ts`, `pm.ts`, `purpose-portal.ts`, `reindex.ts`, `sentinel.ts`, `tags.ts`, `wisdom.ts`), `session-tracker.ts`, `.purpose`

**sentinel (3 files):** `grouper.ts`, `suggester.ts`, `types.ts`

**university (8 files):** All 5 course files (`para-101.json` through `para-501.json`), `plsat/v3.0.json`, `reference.json`

**root/docs (10 files):** `CLAUDE.md`, `CHANGELOG.md`, `package.json`, plus 7 files in `.paradigm/docs/` and `.paradigm/specs/`

---

## Verification

| Check | Result |
|-------|--------|
| `npx tsc --noEmit` (paradigm) | Clean |
| `npm run build` (monorepo) | Success |
| Tests | 163 pass / 5 pre-existing failures |
| PLSAT JSON validation | Valid (74 items, 77 slots) |
| Reference JSON validation | Valid |
| All course files | Reviewed, no inaccuracies |
