# Changelog

All notable changes to Paradigm will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [3.1.2] — 2026-02-23

### Fixed

- **Stop hook: aspect anchor path resolution** — Check 4 (stale aspect anchors) incorrectly resolved anchor paths relative to the `.purpose` file's directory instead of the project root, causing false-positive "anchor does not exist" violations. Fixed in both Claude Code and Cursor stop hooks.

### Changed

- **Version sync** — `@a-company/paradigm-mcp` 3.1.0 → 3.1.2, `@a-company/university` 3.1.0 → 3.1.2, plugin 3.0.2 → 3.1.2.

## [3.1.1] — 2026-02-23

### Added

- **Lore UI: Session Browser** — New "Sessions" tab derives sessions by grouping lore entries within 4-hour windows by author. Sidebar lists sessions by date; detail view shows metadata, symbol tags, lore entries, and session breadcrumbs from `.paradigm/session-breadcrumbs.json` or `~/.paradigm/sessions/`. New `/api/sessions` endpoint.

- **Lore UI: Enhanced Timeline** — Column labels ("HUMAN" left, "AGENT" right) above the spine, color-coded spine dots (green for human, purple for agent), and on-spine date markers with per-side entry counts.

- **Lore UI: Enhanced Filtering** — Author type toggle pills (All / Human / Agent), symbol autocomplete dropdown with match counts, and explicit date range inputs (from/to) in the filter bar.

- **CLI Habits: `edit`, `remove`, `enable`, `disable`** — Full lifecycle management for habits. `habits edit <id>` supports all fields for custom habits; seed habits allow only `--severity` and `--enabled` (writes to overrides). `habits remove <id>` deletes custom habits with `--yes` confirmation; seed habits get a message to disable instead. `habits enable/disable <id>` toggles any habit. Internal `resolveHabitLocation()` helper detects whether a habit is seed, project, or global.

- **CLI Habits: `add` expanded** — New `--check-type` option (all 8 types: tool-called, file-exists, file-modified, lore-recorded, symbols-registered, gates-declared, tests-exist, git-clean) and `--patterns` option for file-based check types. Enum validation on all fields.

- **CLI Lore: `edit`, `delete`, `timeline`** — `lore edit <id>` merges provided fields (title, summary, type, symbols, tags, learnings) into existing entries. `lore delete <id>` with `--yes` confirmation and entry summary display. `lore timeline` groups entries by date, shows hot symbols and active authors, with `--json` for machine-readable output.

- **CLI Lore: `record` expanded** — New `--files-modified`, `--files-created`, `--commit`, `--learnings`, `--duration` options matching the full MCP schema.

- **CLI Lore: `list` expanded** — New `--from` and `--to` date range filtering.

- **MCP: `paradigm_lore_get`** — Fetch a single lore entry by ID with full fields (read-only).

- **MCP: `paradigm_lore_update`** — Merge provided fields into an existing entry.

- **MCP: `paradigm_lore_delete`** — Delete a lore entry with required `confirm: true` safety check (destructive hint).

- **Core: `updateLoreEntry`, `deleteLoreEntry`** — Shared storage functions in both `packages/paradigm/src/core/lore/storage.ts` and `packages/paradigm-mcp/src/utils/lore-loader.ts`. Update merges fields and rebuilds timeline; delete removes the YAML file, cleans empty date directories, and rebuilds timeline.

- **University: para-501 updates** — Habits-practice lesson updated: 8 check types (added `file-modified`, `git-clean`), CLI commands section, `platforms` field documentation. Lore-system lesson updated: CLI tools section, MCP tools expanded from 3 to 6.

- **University: para-401 updates** — MCP-tools-overview lesson: new "Practice Tools" subsection with all 10 habits + lore MCP tools.

### Fixed

- **MCP `paradigm_habits_check` trigger enum** — Added missing `on-commit` to the trigger enum, aligning with the list tool and the type definitions.

- **Lore API: route ordering bug** — `GET /api/lore/symbols`, `/timeline`, `/authors` were shadowed by `/:id` catch-all due to Express route registration order. Named routes now register before parameterized routes.

## [3.1.0] — 2026-02-22

### Added

- **Habits System — Behavioral Feedback Loop** — Agent discipline through observation, measurement, and feedback. Core engine with types, YAML loader (project + global + seed merge with overrides), and evaluator (6 check types: tool-called, file-exists, lore-recorded, symbols-registered, gates-declared, tests-exist). 10 seed habits across 6 categories (discovery, verification, testing, documentation, collaboration, security) and 4 trigger points (preflight, postflight, on-commit, on-stop). Three severity levels: advisory, warn, block. Sentinel extended with `practice_events` table for tracking compliance. Three MCP tools: `paradigm_habits_check`, `paradigm_habits_status`, `paradigm_practice_context`. CLI commands: `paradigm habits list|status|init|add`. PM integration: preflight surfaces habits + warnings, postflight evaluates compliance. Stop hook Check 8: blocking habits can prevent session completion. Lore integration: `habit_compliance` auto-attached to lore entries.

- **University: PARA-501 Advanced Systems** — New 6-lesson course covering v3 systems: The Lore System, Sentinel Deep Dive, Habits & Practice, Session Intelligence, Hook Enforcement & Automation, and The Complete Workflow (capstone). 29 quiz questions across the 6 lessons.

- **PLSAT v3.0 Expansion** — 8 new standalone question slots (slot-051 through slot-058) and 1 passage-based question group (passage-habits-review with 3 analytical questions) covering lore, sentinel, habits, sessions, and hooks.

- **University Reference Updates** — 7 new MCP tool reference cards (`paradigm_lore_record`, `paradigm_lore_search`, `paradigm_lore_timeline`, `paradigm_habits_check`, `paradigm_habits_status`, `paradigm_practice_context`, `paradigm_session_checkpoint`) and 2 CLI command cards (`paradigm habits`, `paradigm lore`).

### Fixed

- **Lore: auto-migrate legacy entries** — Legacy lore entries stored at the root of `.paradigm/lore/entries/` are now auto-migrated into date-partitioned subdirectories on load. Fixes timeline undercounting for projects created before date-partitioning was introduced.

### Changed

- **Version sync** — `@a-company/paradigm` 3.0.3 → 3.1.0, `@a-company/paradigm-mcp` 1.4.0 → 3.1.0, `@a-company/university` 0.1.0 → 3.1.0. University version now tracks the paradigm publish version.

## [3.0.3] — 2026-02-22

### Fixed

- **University/Sentinel blank page on `npm i -g` install** — `@a-company/university` and `@a-company/sentinel` were marked as `external` in tsup config, leaving them as runtime `import()` calls. Neither package is published to npm, so the imports failed for anyone outside the monorepo. Removed both from the `external` list so they are bundled into the paradigm CLI dist. Express v5 (paradigm's dependency) is now used consistently.

## [3.0.2] — 2026-02-22

### Fixed

- **CLI version banner hardcoded at 2.0.13** — The `VERSION` constant in `src/index.ts` was never updated across releases. Replaced with dynamic `require('../package.json').version` so it always matches the published version.
- **Plugin MCP server fails to connect** — The plugin `.mcp.json` ran `npx @a-company/paradigm mcp`, which is a configuration status helper, not the stdio MCP server. Changed to `npx --package=@a-company/paradigm -y paradigm-mcp .` to invoke the correct binary. Fixes `MCP error -32000: Connection closed` on plugin startup.
- **Plugin version bumped to 3.0.2** — `plugin.json` was stuck at 3.0.0.

## [3.0.1] — 2026-02-21

### Fixed

- **University "Cannot GET /" on fresh install** — The university server's static files (`ui/dist`, `src/content`) were not reachable when the code was bundled into the paradigm CLI. Added multi-strategy path resolution (`resolveAssetPaths`) and a build step that copies university assets into the paradigm dist. The CLI command now resolves and passes explicit paths to the server.
- **Express v5 wildcard route crash** — University and Sentinel servers used `app.get('*', ...)` which is invalid in Express v5. Updated to `app.get('{*path}', ...)`.

## [3.0.0] — 2026-02-21

### Added

- **Claude Code Plugin** — Full plugin at `plugins/paradigm/` with 8 skills (`/paradigm:init`, `scan`, `doctor`, `lore`, `shift`, `preflight`, `postflight`, `sentinel`), 5 specialized agents (architect, builder, tester, reviewer, security), 3 enforcement hooks (stop, precommit, postwrite), and MCP server auto-start. Validated with `claude plugin validate`. Marketplace manifest at `.claude-plugin/marketplace.json` enables `plugin marketplace add ascend42/a-paradigm` → `plugin install paradigm@a-paradigm`.

- **Plugin Migration Script** — `plugins/paradigm/scripts/migrate-to-plugin.sh` removes per-project Claude Code hooks and paradigm-mcp from `.mcp.json` while preserving CLAUDE.md, .paradigm/, portal.yaml, Cursor hooks, and git hooks. Run on all 7 existing projects.

- **Portable Cursor MCP Config** — All projects now use `npx --package=@a-company/paradigm -y paradigm-mcp .` in `.cursor/mcp.json` — no machine-specific paths, works for any developer with npm.

- **Author & Repo Attribution** — CLAUDE.md and Cursor rules now include author (Matt Canoy), repo link, npm link, and plugin reference at the top. IDE adapters updated so `paradigm shift` generates these for new projects.

### Changed

- **Version 3.0.0** — Major version bump for Sentinel SDK, Lore system, plugin system, and University platform.
- **Read-only agents use `permissionMode: plan`** — Reviewer and security agents now enforce read-only constraint via `permissionMode: plan`, matching architect agent.
- **npm publish ready** — `npm i -g @a-company/paradigm` installs both `paradigm` CLI and `paradigm-mcp` server. All `@a-company/*` workspace deps bundled via tsup `noExternal`. MCP server built as second entry point (`dist/mcp.js`). `@a-company/paradigm-mcp` marked private. Optional commands (`sentinel`, `university`) gracefully handle missing packages. CI fixed from stale `@horizon/cli` reference. Stale `@horizon/*` changeset deleted.

### Added

- **Lore System** — Unified project timeline that captures every agent session, human note, decision, review, incident, and milestone. YAML-based storage in `.paradigm/lore/entries/` (date-partitioned, one file per entry, human-editable). `LoreEntry` type with author tracking (human vs agent with model), symbol references (touched/created), file artifacts (created/modified with line counts), decisions with rationale, errors with resolutions, learnings, verification status (per-check breakdown), and human review scores (completeness + quality 1-5). `LoreTimeline` index in `.paradigm/lore/timeline.yaml` with author list and entry count. Storage layer: `recordLore()`, `loadLoreEntries()` with composable filters (author, type, symbol, date range, tags, review status), `addReview()`, `rebuildTimeline()`. Filter system supports AND-composed queries with limit/offset pagination.

- **Lore MCP Tools (3)** — `paradigm_lore_search` (query entries by symbol, author, date, tags), `paradigm_lore_record` (record new lore entries), `paradigm_lore_timeline` (timeline overview with recent entries, active authors, hot symbols). Registered in paradigm-mcp tool dispatch with `paradigm_lore_*` prefix routing. Lore loader utility (`lore-loader.ts`) bridges MCP context to lore storage.

- **Lore CLI Commands** — `paradigm lore` launches the Timeline UI (default). Subcommands: `paradigm lore list` (table output with color-coded types, verification icons, review stars; filters: `--author`, `--type`, `--symbol`, `--tags`, `--limit`, `--json`), `paradigm lore show <id>` (full detail view with all sections), `paradigm lore record` (create human-note/milestone/decision via CLI flags), `paradigm lore review <id>` (add completeness + quality scores with `--reviewer`, `--notes`).

- **Lore Timeline UI** — Thread-style web timeline launched via `paradigm lore` (port 3840). React 18 + Vite + Zustand SPA served by Express. Three views: **Thread** (vertical timeline spine — human entries left, agent entries right, date separators), **Symbol** (sidebar with symbol counts, filtered entries for selected symbol), **Author** (sidebar with author list + last active date, filtered entries). Components: `LoreCard` (type-colored, symbol pills, verification badge, review stars, file/line stats), `DetailPanel` (slide-in with decisions, errors, learnings, verification breakdown, review section), `FilterBar` (author/type dropdowns, symbol autocomplete, date range, tag multi-select, preset quick filters: Today/This Week/Needs Review/Decisions/Incidents), `DateSeparator`, `SymbolTag` (colored by symbol type), `ReviewStars`, `VerificationBadge`, `ViewSwitcher`. Color system: symbol-type spectral palette + entry-type colors (indigo/emerald/amber/purple/red/blue). API: `/api/lore` (list+filter), `/api/lore/:id` (detail), `/api/lore/:id/review` (PUT), `/api/lore/timeline`, `/api/lore/symbols`, `/api/lore/authors`, `/api/info`, `/api/health`.

- **Auto-scaffolding (`paradigm scan --init`)** — New `--init` flag on `paradigm scan auto` generates both `.purpose` files AND `portal.yaml` from codebase analysis. Detects auth middleware patterns (JWT, session, isAuthenticated, hasRole, etc.) to infer `^gates`, scans route files for HTTP endpoints (Express/Fastify/Hono/Next.js) to build route entries. Writes `portal.yaml` with detected gates and routes. Respects `--force` for overwriting existing files. Zero-friction onboarding for existing codebases.

- **MCP Safety Annotations** — Added `readOnlyHint` and `destructiveHint` annotations to 100 MCP tools across three packages. **paradigm-mcp**: 54 tools across 14 files (2 destructive: `paradigm_purpose_remove`, `paradigm_reindex`). **sentinel**: 8 tools in `mcp.ts` (5 read-only, 3 write). **atelier**: 37 tools across 11 files (3 destructive: `atelier_remove_layer`, `atelier_remove_state`, `atelier_remove_delta`). Conforms to `ToolAnnotationsSchema` from `@modelcontextprotocol/sdk`. Enables MCP clients to surface safety hints in tool directory listings.

- **Sentinel Phase 1: Standalone Local Tool** — `@a-company/sentinel` v0.2.0 is now a standalone package with SDK, CLI, framework adapters, and MCP server. New `Sentinel` class (`src/sdk.ts`) wraps the core engine with a developer-friendly API: `sentinel.capture()`, `sentinel.component()`, `sentinel.gate()`, `sentinel.flow()`. `FlowTracker` class tracks multi-step flows with `expect()`, `step()`, `gate()`, `signal()`, `fail()`. Framework adapters for Express (`@a-company/sentinel/express`), Fastify (`@a-company/sentinel/fastify`), and Hono (`@a-company/sentinel/hono`) auto-capture errors with route-derived symbolic context. `.sentinel.yaml` config loader/writer (`src/config.ts`) with simple YAML parser. Auto-symbol detector (`src/detector.ts`) infers `#components`, `^gates`, `!signals`, `$flows` from codebase directory structure and `.purpose` files. Standalone CLI (`sentinel` binary) with `init`, `dashboard`, and `triage` commands (list, show, resolve, stats) — formatting ported from paradigm triage. Standalone MCP server (`sentinel-mcp` binary) with 8 tools (`sentinel_triage`, `sentinel_show`, `sentinel_resolve`, `sentinel_patterns`, `sentinel_add_pattern`, `sentinel_record`, `sentinel_stats`, `sentinel_suggest_pattern`). Multi-config tsup build (lib+DTS, CLI+shebang, MCP+shebang). `SentinelStorage` now supports `SENTINEL_DATA_DIR` env var for standalone users. New SDK types: `SentinelConfig`, `ComponentContext`. Package exports updated for adapter subpaths.

- **Discipline System** — Auto-detection and per-discipline configuration. `detectDiscipline()` examines project files to infer project type from 14 disciplines (`web`, `backend`, `fullstack`, `api`, `cli`, `ml`, `mobile`, `game`, `embedded`, `devops`, `data`, `library`, `monorepo`, `custom`). Each discipline gets tailored symbol mappings, purpose-required patterns, and scan patterns. Wired into `paradigm init` (auto-populates config), `paradigm shift` (detects for existing projects), and `paradigm scan` (discipline-aware patterns). Template `disciplines.md` rewritten for v2. `context-builder.ts` cleaned of v1 symbol remnants.

- **University: Discipline System lesson updates** — PARA 201 disciplines lesson rewritten with auto-detection section, 14-discipline table, domain-specific disciplines (ML, Data, Game, Embedded). PLSAT v2.0/v3.0 discipline references updated (`fullstack-saas` → `fullstack`, `cli-tool` → `cli`). Reference.json CLI flags updated.

- **Session Checkpoints + Auto-Recovery** — Cognitive-transition checkpoints for crash recovery. New `paradigm_session_checkpoint` MCP tool saves lightweight snapshots (phase, context, modified files, symbols, decisions, last 10 breadcrumbs) at workflow transitions (planning → implementing → validating → complete). Dual-writes to both local (`.paradigm/session-checkpoint.json`) and global (`~/.paradigm/sessions/{hash}/checkpoint.json`). Checkpoints older than 7 days are automatically discarded. Auto-recovery on first tool call: the MCP server detects new sessions and prepends a `--- SESSION RECOVERY ---` preamble to the very first tool response with checkpoint data (phase, context, files, symbols, decisions) and pending handoffs — agents receive recovery context with zero protocol overhead, even after "clear context" or crash. Recovery fires once per session via `hasRecoveredThisSession()` gating. `paradigm_session_recover` enhanced to include checkpoint data (prioritized in suggestions over raw breadcrumbs). New `buildRecoveryPreamble()` shared helper. New `generateCheckpointProtocol()` in IDE adapter base — integrated into Claude adapter (CLAUDE.md) and Cursor adapter (paradigm-context.mdc). `paradigm_session_checkpoint` added to MCP tool reference table. `.gitignore` updated for `session-checkpoint.json` and `session-breadcrumbs.json`. All 16 paradigm projects updated via `paradigm shift` for parity.

- **Two-Stage Review Protocol** — Reviewer agent prompt restructured with a hard two-stage gate: Stage 1 (Spec Compliance) verifies `.purpose` registrations, `^gate` implementation, `$flow` step sequences, `!signal` emissions, and `~aspect` enforcement. If Stage 1 fails, the reviewer stops immediately and hands back to the builder — no code quality review of spec-noncompliant code. Stage 2 (Code Quality) covers OWASP security, conventions, test coverage, and error handling. Applied to both `packages/paradigm/src/core/agent-prompts.ts` and `packages/paradigm-mcp/src/tools/orchestration.ts`.

- **Adversarial Review (Minimum 3 Findings)** — Every reviewer output must produce at least 3 categorized findings: `blocking` (must fix), `improvement` (should fix), or `note` (informational). Only blocking findings prevent approval. Eliminates rubber-stamp "looks good" reviews with zero findings.

- **Fresh Context Principle** — Builder agent prompt now includes explicit isolation guidance: each builder task runs in a separate, clean context. Builders must re-read specs and handoff context for every invocation, never carrying assumptions from prior tasks. "Implement multiple unrelated tasks in the same context" added to builder DON'T list. Applied to both prompt locations.

- **Clarification Markers (`[NEEDS CLARIFICATION: ...]`)** — Convention for marking ambiguous requirements in `.purpose` file descriptions instead of guessing. `paradigm_purpose_validate` scans all description fields (components, features, gates, signals, aspects, flows) for the marker regex and reports matches as warnings. `paradigm doctor` counts total markers across all `.purpose` files and reports as a warning check. Documented in `CLAUDE.md` with format, placement rules, and resolution guidance.

- **University: Two-Stage Review Protocol lesson content** — PARA 401 Agent Roles lesson gains "Reviewer Protocol" subsection covering the two-stage review and minimum 3 findings rule, plus quiz question Q6 testing Stage 1 failure behavior.

- **University: Fresh Context Principle lesson content** — PARA 401 Multi-Agent Coordination lesson gains "Fresh Context Principle" subsection explaining builder isolation and added to keyConcepts.

- **University: Clarification Markers lesson content** — PARA 301 Doctor & Validation lesson gains "Clarification Markers" subsection explaining the format and how doctor/validate surface them, plus quiz question Q5 testing marker severity (warnings not errors).

- **PLSAT v3.0 new variants** — `plsat-042b` (two-stage review: Stage 1 spec compliance failure stops review, doesn't proceed to Stage 2) and `plsat-038b` (clarification markers are warnings, not errors).

- **Global Brain (`~/.paradigm/`)** — Cross-session and cross-project persistence layer for the MCP server. New `#GlobalStore` utility (`packages/paradigm-mcp/src/utils/global-store.ts`) manages `~/.paradigm/sessions/{hash}/` for session breadcrumbs and pending handoffs, and `~/.paradigm/wisdom/` for global antipatterns/decisions/preferences. `paradigm_handoff_prepare` now persists handoffs to global store — next session's `paradigm_session_recover` automatically loads and delivers them (no more manual `paradigm team accept`). `paradigm_wisdom_record` gains a `scope` parameter (`project` | `global`). New `paradigm_wisdom_promote` tool promotes project-local wisdom to global scope. `paradigm_wisdom_context` merges global + local wisdom transparently. Session tracker dual-writes breadcrumbs to both `.paradigm/session-breadcrumbs.json` (project) and `~/.paradigm/sessions/` (global). New `~global-persistence` aspect with anchors. New signals: `!handoff-persisted`, `!handoff-delivered`, `!wisdom-promoted`. New flows: `$handoff-roundtrip`, `$wisdom-promotion`.

- **Hook enforcement v2** — PostWrite and Stop hooks rewritten for stronger paradigm compliance. PostWrite hook now tracks every modified source file in `.paradigm/.pending-review` (deduplicated), outputs periodic compliance reminders (every 3rd edit) referencing all 5 symbol types (`#components`, `~aspects`, `!signals`, `$flows`, `^gates`), warns that the stop hook WILL BLOCK, and names the specific `.purpose` file to update. Stop hook lowers the blocking threshold from 3 to 2 source files, adds Check 5 (per-directory `.purpose` freshness — reads `.pending-review` and verifies each covering `.purpose` was also modified), adds Check 6 (aspect coverage advisory — detects `~aspect` definitions and warns about stale anchors/applies-to patterns), and outputs specific MCP tool remediation commands. Cleans up `.pending-review` on pass. All 4 hook variants updated (Claude Code + Cursor, postwrite + stop). Propagates to all projects via `paradigm hooks install --force`.

- **Test suite for Paradigm CLI** — 102 tests across 7 test files using Vitest. Covers config parser, IDE adapter generators, adapter registry/detection, adapter contract tests (parameterized across all 5 adapters), scan utilities, doctor command, and hooks system (Claude Code, Cursor, Git). Includes shared `createTempProject()` test helper for temp directory scaffolding. CI pipeline runs tests on Node 18/20/22 matrix.

- **Cursor hooks** (`.cursor/hooks.json`): Compliance enforcement hooks for Cursor IDE — stop hook (blocks on missing .purpose), post-write hook (advisory .purpose reminder), pre-commit hook (auto-rebuilds index). Install with `paradigm hooks install --cursor`. Automatically included in `paradigm shift`.

- **AGENTS.md generation**: Universal AI agent instruction file (cross-IDE standard). New `agents` adapter generates `AGENTS.md` at repo root with project overview, symbol system, MCP tool reference, workflow protocol, session recovery, commit conventions, and more. Run `paradigm sync agents` or let `paradigm shift` generate it automatically.

- **Cursor rule mode optimization**: 4 Cursor rules (`paradigm-orchestration`, `paradigm-context`, `paradigm-commits`, `paradigm-flows`) switched from `alwaysApply: true` to intelligent application via improved descriptions. Reduces context overhead — rules only load when relevant.

- **Session recovery in all adapters**: `paradigm_session_recover` is now surfaced in Cursor context rules and the Claude adapter template, ensuring all IDEs prompt agents to load previous session breadcrumbs.

- **Shared IDE generators**: New `generateMcpToolReference()`, `generateWorkflowProtocol()`, and `generateHandoffProtocol()` in `base.ts` — reusable across AGENTS.md and future adapters.

- **Session breadcrumb wiring**: `paradigm_session_recover` now returns real data. Every MCP tool call automatically records a breadcrumb (tool name, summary, symbol) via `addToolBreadcrumb()` in the dispatch layer. `setRootDir()` is called at server startup so breadcrumbs persist to `.paradigm/session-breadcrumbs.json`. New sessions can call `paradigm_session_recover` to see what the previous session was working on.

- **Dark/light mode toggle for University** — Theme toggle button in the header (right of version badge), persists preference in localStorage. Full dark theme with inverted parchment palette, brightened symbols/accents, readable button text, and visible quiz choice options. University Seal SVG uses CSS custom properties (`var(--burgundy)`, `var(--gold)`, `var(--sym-*)`) for all colors — natively theme-aware with no filter hacks.

- **University UX improvements** — Course catalog redesigned as single-column list with lesson topic tags, progress ring, and "Start course" CTA. Sidebar navigation no longer resets scroll position. Dark mode: improved active sidebar item contrast (gold bg), provider cascade section grouped by ecosystem (Anthropic/Claude, Cursor, Universal). PARA 401 multi-agent lesson updated with model configuration commands (`paradigm shift`, `paradigm team models`, `--refresh`) and new quiz question. Markdown renderer paragraph regex fixed to only skip block-level tags — inline tags (`<strong>`, `<code>`, `<em>`) now correctly get `<p>` wrappers, fixing bold-numbered lists (e.g. "The Operational Loop") rendering as a single blob. Inline `code` elements restyled with stronger gold background and subtle border for better contrast in both light and dark modes.

- **Markdown rendering in quiz/PLSAT questions** — Extracted `renderMarkdown` to shared utility (`utils/renderMarkdown.ts`). Scenarios, question text, choices, and explanations now render code blocks, inline code, bold, and other markdown. YAML gate definitions in PLSAT choices display as proper code blocks. Passage questions always show their full passage inline — removed "scroll up" backtracking message.

- **Framework-agnostic course content** — Replaced all React/Express/Zustand-specific references in courses (PARA 101, 201, 301) and PLSAT exams (v2.0, v3.0) with generic terms (UI component, frontend hook, server stack). Paradigm is framework-agnostic and the educational content now reflects that.

- **Portal.yaml for university routes** — All 5 university API routes (`/api/courses`, `/api/courses/:id`, `/api/courses/:id/lessons/:lessonId`, `/api/plsat`, `/api/plsat/:version`) documented with `^local-only` gate (localhost-only learning platform, no auth required).

### Security

- **npm audit: 0 vulnerabilities** — Fixed all 5 reported vulnerabilities (2 moderate, 3 high). Upgraded `vite` ^5 → ^6.4 in sentinel (fixes esbuild dev server exploit, CVE in esbuild ≤0.24.2). Upgraded `glob` ^10 → ^13 in paradigm, portal-core, and purpose-core (fixes minimatch ReDoS via glob transitive dep). Removed `@vscode/vsce` from paradigm-vscode devDependencies entirely — it was only used as a CLI for `vsce package`/`vsce publish`, replaced with `npx @vscode/vsce`. vsce v2 and v3 both carry a vulnerable `minimatch ^3.0.3` direct dependency with no upstream fix; since it's a CLI-only tool with no user-controlled glob input, the ReDoS has zero actual attack surface. Bumped root engine requirement from Node >=18 to >=20 (Node 18 EOL'd April 2025).

### Fixed

- **Markdown renderer: table and ordered list support** — `renderMarkdown()` now handles markdown tables (`| col | col |` with separator rows) and ordered lists (`1. item`). Tables render as proper `<table>` HTML with inline markdown in cells. Ordered lists render as `<ol><li>` instead of collapsing into a single paragraph.

- **Code block line spacing in University lessons** — `renderMarkdown()` paragraph regex was wrapping lines inside `<pre>` blocks with `<p>` tags, causing double line spacing. Fixed with placeholder extraction approach.

- **University TypeScript errors** — Fixed 5 TS7030 errors in route handlers (`courses.ts`, `plsat.ts`) where early-return paths caused "not all code paths return a value". Added missing `chalk` dependency to `packages/university/package.json`.

- **MCP tool routing**: `paradigm_session_recover` was registered and handled but never dispatched — the routing guard in `tools/index.ts` didn't match its name. Broadened condition to `paradigm_session_*` prefix matching.

- **Lore timeline undercounting legacy entries** — `rebuildTimeline()` and `loadLoreEntries()` only scanned date-partitioned directories (`entries/YYYY-MM-DD/`), silently skipping old-format YAML files placed directly in `entries/`. Added `migrateLegacyEntries()` that auto-converts old-format entries (no `id`, no `author` block, `date` string, `test_results`) to v2 schema and moves them into proper date directories on first access. Applied to both `packages/paradigm/src/core/lore/storage.ts` and `packages/paradigm-mcp/src/utils/lore-loader.ts`.

### Planned

- **Paradigm University content review** — 27 tracked items in `packages/university/CHANGES.md`:
  - Remove all v1 symbol references (9 items) — university teaches v2 only, no migration content
  - Rethink logger presentation (11 items) — present as philosophy/approach, not concrete API
  - Fix client-side routing (3 items) — lessons need URL segments, back button support, quiz→next-lesson flow
  - Replace `paradigm init` → `paradigm shift` (10 occurrences across 5 files)
  - Replace v1 quiz question in PARA-101 with pure v2 question
  - Fix header nav centering and Courses link behavior (2 items)

## [2.0.13] - 2026-02-09

### Added

- **Paradigm University**: New `packages/university/` — interactive academia-themed learning platform for the Paradigm framework. Express server + Vite React SPA (mirroring the Sentinel dual-build pattern). Launched via `paradigm university` CLI command on port 3839.

- **4 courses (PARA 101–401)**: 36 lessons covering foundations (symbols, purpose files, tags, logger), architecture (flows, gates, aspects, portal protocol), operations (history, fragility, wisdom, ripple, sentinel), and orchestration (MCP tools, multi-agent coordination, PM governance). Each lesson has markdown content and 3–5 ABCDE quiz questions (153 total).

- **PLSAT v2.0 certification exam**: 50-question, 45-minute timed assessment. Distribution: 101=20%, 201=30%, 301=26%, 401=24%. Includes scenario-based questions, code identification, ordering, and tricky distractors. 80% pass threshold generates a versioned certificate persisted to LocalStorage.

- **Reference library**: 41 quick-reference cards across 5 sections — symbols (5), MCP tools (14), CLI commands (9), tags (8), and workflow checklists (5).

- **Academia theme**: Crimson Pro serif + Inter sans-serif fonts, parchment (#F5F1E8) background, burgundy (#6B1C23) primary, gold (#C5A572) accents. SVG university seal with "Universitas Paradigmatica — Lux in Codice" motto, laurel wreath, and colored symbol dots.

- **Progress tracking**: Three Zustand stores with LocalStorage persistence — lesson completion, quiz scores, and PLSAT certificates with student name, score, version, and date.

- **Printable certificates**: CertificateView renders formal certificate with seal, name, score, PLSAT version, framework version, and date. Print-optimized CSS.

### Changed

- Root `.purpose`: Added `university-platform` feature with component refs, signals (`!plsat-completed`, `!quiz-completed`), and flow (`$plsat-exam-flow`).
- `packages/paradigm/.purpose`: Added `university-command` and `#university-launcher`.
- `packages/paradigm/src/index.ts`: Registered `paradigm university` CLI command.

## [2.0.12] - 2026-02-07

### Added

- **PM Governance Layer**: Automated compliance enforcement for AI-assisted development. Two new MCP tools (`paradigm_pm_preflight`, `paradigm_pm_postflight`) provide pre-task compliance planning and post-task violation detection — checking symbol registration, portal.yaml gate coverage, ripple analysis, and wisdom capture.

- **PM agent role for CLI orchestration**: New `pm` role (Sonnet-tier) in `paradigm team orchestrate --pm` decomposes tasks, injects compliance context into agent prompts, and validates results. Preflight runs before agent planning; postflight checks all modified files and symbols after execution.

- **Core compliance engine** (`pm-compliance.ts`): Shared module used by both MCP tools and CLI orchestrator. `runPreflight()` extracts symbols from task text, runs ripple analysis, checks portal.yaml, suggests agents. `runPostflight()` scans for route patterns (Express/Fastify/SvelteKit), cross-references against portal.yaml, checks .purpose coverage, flags unregistered symbols.

- **`paradigm mcp use-dev`**: Switches all detected AI client MCP configs to point at the local working directory's built `packages/paradigm-mcp/dist/index.js` for safe development and testing.

- **`paradigm mcp use-prod`**: Reverts MCP configs to use the global `paradigm-mcp` binary. Supports `--client` flag to target a specific client.

- **Enhanced `paradigm mcp status`**: Now shows `[DEV]` or `[PROD]` mode per client with server details and paths.

- **`paradigm promote`**: Copies local build to production (`~/.paradigm-cli/`). Builds packages, copies 6 dist/ directories (paradigm, paradigm-mcp, premise-core, portal-core, purpose-core, sentinel), switches MCP configs back to prod, and verifies with version check. Supports `--skip-build`, `--force`, `--json`.

- **IDE adapter PM governance table**: Generated CLAUDE.md files now include PM Governance section instructing agents to call `paradigm_pm_preflight` before tasks and `paradigm_pm_postflight` after.

### Changed

- **`mcp/setup.ts` exports**: `detectAllClients()`, `getServersFromConfig()`, `writeConfig()`, `getProjectName()`, `generateMCPConfig()`, `AIClient`, `ServerInfo` are now exported for reuse by `switch.ts`.

## [2.0.11] - 2026-02-07

### Added

- **10 aspects (~) with verified code anchors**: Added `~yaml-config-loading`, `~zod-validated`, `~symbol-typed-logging`, `~mcp-tool-handler`, `~ide-adapter-pattern`, `~provider-cascade`, `~express-server`, `~budget-enforced`, `~file-glob-discovery`, `~correlation-tracked` — each pointing to real `file:line-range` anchors in the source. This is Paradigm's most distinctive symbol type and was previously unrepresented in the project's own metadata.

- **7 new flows ($)**: `$install-flow`, `$symbol-aggregation`, `$purpose-parsing`, `$ide-sync-flow`, `$agent-orchestration-flow`, `$portal-validation-flow`, `$mcp-request-flow` — documenting multi-step processes end-to-end. Total flows: 12 (up from 6).

- **4 new sub-module .purpose files**: Granular coverage for `packages/paradigm/src/core/` (14 components), `packages/paradigm/src/core/ide-adapters/` (6 components), `packages/paradigm/src/core/providers/` (6 components + 2 signals), `packages/logger/` (6 components). Total .purpose files: 15 (up from 11).

- **Sentinel portal.yaml**: Authorization topology for Sentinel API with `^api-authenticated` and `^admin-only` gates across 6 routes.

- **Aspect/flow links on 6 existing .purpose files**: Root `.purpose`, `purpose/core`, `portal/core`, `premise/core`, `paradigm-mcp`, and `sentinel` enriched with cross-references to the new aspects and flows.

### Changed

- Total symbol count: **287** (up from ~244). 10 aspects, 12 flows, 6 gates, 31 signals, 228 components.

## [2.0.10] - 2026-02-07

### Fixed

- **MCP config generation uses `paradigm-mcp` instead of `npx`**: All MCP config generators (Cursor adapter, Claude adapter, `mcp setup` command) now emit `"command": "paradigm-mcp"` with `"args": ["."]` and `"cwd"` pointing to project root. The old `npx @a-company/paradigm-mcp` config never worked because the package isn't on npm. `paradigm shift` and `paradigm mcp setup` now produce working `.cursor/mcp.json` and `.mcp.json` out of the box.

## [2.0.9] - 2026-02-07

### Fixed

- **Install script: permanent source directory**: Rewrote `install.sh` to clone to `~/.paradigm-cli/` instead of `/tmp/`. `npm install -g .` creates symlinks back to source files — the old temp dir cleanup broke every install. Now installs both `paradigm` and `paradigm-mcp` CLIs, supports re-running for updates (git pull + rebuild), and warns users not to delete the source directory.

## [2.0.8] - 2026-02-07

### Fixed

- **Install script verification in piped shells**: `curl | bash` installs now verify correctly. Replaced `command -v` check (fails in piped shells where PATH hash isn't refreshed) with direct binary path lookup via `$(npm config get prefix)/bin/paradigm`. Shows a helpful PATH note instead of a false error.

## [2.0.7] - 2026-02-06

### Fixed

- **Clean TypeScript build — 171 errors → 0**: Full v1 debt elimination in `packages/paradigm/`. `tsc --noEmit` now exits 0.

- **Deleted dead `src/commands/dream/` directory**: Identical copy of `premise/`, leftover from v1 rename. Fixed `src/index.ts` imports to use `premiseAggregateCommand`/`premiseSnapshotCommand`.

- **Replaced all v1 symbol type references**: 8 command files (`status`, `constellation`, `aggregate`, `summary`, `beacon`, `probe/index`, `scan/index`, `ripple`) updated from 7-type system (`@feature`, `%state`, `?idea`) to v2 5-type (`#component`, `$flow`, `^gate`, `!signal`, `~aspect`). Display, interfaces, categorization, and JSON output all updated.

- **Fixed config owner types**: `paradigm-config.ts` and `legacy-config.ts` — replaced invalid `owner: 'gate'` → `'portal'`, removed dead `?` symbol entry, updated `SymbolSystem` interface to v2 5-symbol set with index signature for migration compat.

- **Fixed missing module/type errors**: `log.gate()` → `log.command()` in portal check, moved `createGate` import to correct package (`portal-sdk`), suppressed optional `portal-viewer` dynamic imports, fixed `chalk.Chalk` type → `typeof chalk.red`, `ora.Ora` → `ReturnType<typeof ora>`, `tracker.failure()` → `tracker.error()`.

- **Fixed remaining type mismatches**: Added `*-manifest` variants to `ModelDiscoveryResult.source` union, passed `model` arg to orchestrator callbacks, typed `adapters` Map explicitly, added `config.states` guard in setup wizard.

- **Cleaned ~95 unused variable warnings across ~40 files**: Removed dead imports, deleted unused functions (`groupByDirectory`, `isFeatureDirectory`, `formatBytes`, `GATE_REFERENCE_PATTERNS`), removed unused class properties (`rootDir` in 3 classes, `budgetTracker`), prefixed intentionally unused params with `_`.

## [2.0.6] - 2026-02-06

### Changed

- **v2 release cleanup across 84 files** (~11,800 lines removed, ~500 added): Comprehensive pass to make the entire codebase v2-consistent before release.

- **Deleted `examples/` directory**: Removed v1/Horizon-era shopflow example and pattern docs (will be replaced with links to real projects).

- **Moved planning docs to `.plans/`**: Relocated 5 internal planning docs (`CASE-STUDY.md`, `CASE-STUDY-RECOMMENDATIONS.md`, `paradigm-website-outline.md`, `paradigm-visualizer-sentinel.md`, `taskflow-split-test.md`) out of `docs/`.

- **Rewrote IDE rules for v2**: `.windsurfrules` and 8 `.cursor/rules/*.mdc` files fully rewritten — v1 9-symbol table → v2 5-symbol + tag bank, v1 logger calls → v2 API, "portals" → "gates".

- **Rewrote `packages/paradigm/README.md`**: Updated from v0.4.0/v1 symbols to current version with v2 symbol system, tag bank, and current command list.

- **Added `packages/logger/README.md`**: Documents the v2 logger API (`component()`, `gate()`, `signal()`, `flow()`, `aspect()`, `raw()`).

- **Updated docs**: `docs/commands/` (constellation, ripple, index, beacon) — "Portals" → "Gates", removed `%state` rows. `docs/tutorial-project.md` — all `@feature` → `#component` with `[feature]` tags, removed `%state` rows. `docs/content-guide.md` — "8 symbols" → "5 operational symbols". `docs/README.md` — fixed GitHub URLs to `ascend42/a-paradigm`.

- **Updated `CONTRIBUTING.md`**: Replaced stale `prism/` package reference with actual packages, added `Symbols:` trailer convention.

- **Updated `DISTRIBUTION.md`**: Version references updated throughout.

- **Resolved open questions in `symbols-v2.md`**: Marked 4 open items as decided/deferred.

### Fixed

- **Internal source renames (breaking API changes)**:
  - `premise-core` (0.1.0 → 0.2.0): `DreamFile` → `PremiseFile`, `DreamNode` → `PremiseNode`, all `Dream*` types → `Premise*`. `SourceType` enum `'gate' | 'dream'` → `'portal' | 'premise'`. `AggregationResult.gateFiles` → `.portalFiles`. `PremiseFile.sources.gate` → `.sources.portal`. Functions: `parseDreamFile` → `parsePremiseFile`, `aggregateFromDream` → `aggregateFromPremise`, etc.
  - `probe-core` (0.1.0 → 0.2.0): `HORIZON_VERSION` → `PARADIGM_VERSION`, `AggregationInput.gateFiles` → `.portalFiles`, `horizonVersion` → `paradigmVersion` in schema.
  - `paradigm` CLI (1.4.0 → 1.5.0): `dreamPath` → `premisePath` in init/setup/doctor, `paradigm dream aggregate` → `paradigm premise aggregate` in cursorrules generator, `'gate' | 'dream'` → `'portal' | 'premise'` in config types.
  - `sentinel`: `source: 'gate'` → `'portal'`, `result.gateFiles` → `result.portalFiles` in symbol loader.
  - `paradigm-vscode`: `'@feature-name'` → `'#component-name'` in snippets.

## [2.0.5] - 2026-02-06

### Added

- **Logger package (`@a-company/paradigm-logger`)**: Full v2 logger implementation in `packages/logger/src/` — previously an empty scaffold. Implements `ParadigmLogger` class with `.component()`, `.gate()`, `.signal()`, `.flow()`, `.aspect()`, `.raw()` methods, each returning a `SymbolLogger` with debug/info/warn/error/start. Includes duration tracking (`.start()` → `.success()`/`.error()`), pretty format (ANSI colors, dev) and JSON format (production), level filtering via `LOG_LEVEL`, symbol filtering via `PARADIGM_SYMBOLS`, and correlation ID support via `AsyncLocalStorage`. Builds as CJS + ESM + DTS.

### Fixed

- **MCP config path for Cursor**: `writeMcpConfig()` was writing both Cursor and Claude configs to `.mcp.json` at project root. Cursor only reads from `.cursor/mcp.json`. Now Cursor writes to `.cursor/mcp.json` and Claude Code writes to `.mcp.json`.

- **v1 symbol cleanup across 40+ files**: Replaced `@feature`/`@checkout`/`@login` → `#component` refs, `log.feature()`/`log.state()`/`log.integration()` → `log.component()`, `^portal` → `^gate`, `%state` → `#state-store [state]`, `&integration` → `#component [integration]` across:
  - `.paradigm/specs/` — purpose.md (full v2 rewrite), navigator.md, history.md, probe.md, context-tracking.md, wisdom.md
  - `.paradigm/docs/` — commands.md, troubleshooting.md, ai-maintenance-protocol.md, and 5 files in commands/
  - `docs/` — 12 files including guides, command refs, content-guide, website outline
  - `packages/paradigm/templates/` — all spec, doc, and prompt templates shipped to new projects
  - `.github/instructions/` — purpose, agent-hints, logging instruction files
  - `.github/copilot-instructions.md`, `packages/paradigm-mcp/README.md`, `packages/paradigm-vscode/README.md`, `packages/paradigm/README.md`
  - Root `README.md` symbol table rewritten from 6 v1 symbols to 5 v2 symbols + tag bank

- **Deleted 4 stale architect task files** from `.paradigm/tasks/`

## [2.0.4] - 2026-02-06

### Added

- **`Symbols:` trailer protocol for commits**: New commit convention where a `Symbols:` trailer line lists all affected symbols machine-readably. The post-commit hook now parses this trailer to capture symbols for history, supplementing the existing `.purpose`-based extraction. Symbols from both sources are deduplicated.

- **Shared `generateCommitConvention()` in base.ts**: All IDE adapters now use a single shared function for commit convention output, ensuring consistency across Claude, Cursor, Copilot, and Windsurf.

- **Commit conventions in all IDE adapters**: Previously only Claude had (v1) commit guidance. Now all adapters include the v2 commit convention with `Symbols:` trailer:
  - Cursor: new `paradigm-commits.mdc` (alwaysApply: true)
  - Copilot: new `paradigm-commits.instructions.md`
  - Windsurf: commit convention added to `.windsurfrules` output

### Fixed

- **v1 symbol remnants across all IDE adapters**:
  - `claude.ts`: `Paradigm v1.0` → `v2.0`, `@create-task` → `#create-task`, `@tasks` → `#tasks`, `feat(@feature)` → uses shared v2 convention, nested context `@%?` symbols → `#$^!~`
  - `cursor.ts`: frontmatter `@features, ^portals` → `#components, $flows, ^gates, !signals, ~aspects`, `.purpose` example rewritten from v1 to v2, agent hints `@symbol`/`@checkout` → `#`, `portals` → `gates`, flow steps `@validate-task-input`/`@create-task` → `#`, `@symbols` → `#symbols`
  - `copilot.ts`: `.purpose` example and agent hints — same v1→v2 fixes as Cursor
  - `base.ts`: navigator example `@checkout` → `#checkout`

- **Post-commit hook relaxed recording condition**: Previously required symbols from `.purpose` files AND history directory. Now records when symbols come from either `.purpose` extraction or commit message `Symbols:` trailer.

## [2.0.3] - 2026-02-06

### Added

- **Remote model manifest**: Model discovery now fetches `models.json` from GitHub before falling back to hardcoded presets. Update the manifest to push new models without a CLI release. Discovery priority: API keys (live) → remote manifest (7-day cache) → hardcoded fallback.

- **CLI commands as #components**: Migrated `packages/paradigm/.purpose` from v1 to v2 symbols. All 41 CLI commands now have `#component` entries with `path:`, `tags:`, and `used-by:` fields pointing to source files. Agents can now find any command via `paradigm_search` or `paradigm_navigate`.

### Changed

- **`paradigm shift` always prompts for model configuration**: The interactive model selection step now runs automatically during `paradigm shift` — no need for `--configure-models` flag. This makes the setup experience more engaging and ensures agents are configured with the right models from the start.

### Fixed

- **MCP config now writes to `.mcp.json` at project root**: Claude Code requires `.mcp.json` at the project root — `.claude/settings.json` doesn't work for MCP server declarations. Both `paradigm sync claude` and `paradigm mcp setup` now write to `.mcp.json`. If an existing `.mcp.json` is present, the paradigm server is merged in alongside other servers.
- **Added Claude Code to `paradigm mcp setup` detection**: The `mcp setup` command now detects Claude Code (via `.mcp.json` or `.claude/` directory) as a configurable client, alongside Cursor, Claude Desktop, Continue, and Cline.
- **Updated stale model presets**: All preset model lists were outdated (Claude 3.5, GPT-4o, Grok 2, Gemini 2.0, Llama 3.x). Updated across all environments (Cursor, Anthropic API, OpenAI API, Google API, xAI API, VSCode/Copilot):
  - Anthropic: Claude Opus 4.6, Claude Sonnet 4.5, Claude Haiku 4.5
  - OpenAI: GPT-4.1, GPT-4.1 Mini, GPT-4.1 Nano, o3, o4 Mini, o3 Mini
  - Google: Gemini 2.5 Pro, Gemini 2.5 Flash, Gemini 2.0 Flash
  - xAI: Grok 3, Grok 3 Mini
  - Meta: Llama 4 Scout, Llama 4 Maverick
  - DeepSeek: DeepSeek R1, DeepSeek V3
- **Updated model tiering logic**: Added `nano`, `scout` to low-tier patterns; added `gpt-4.1`, `o3`, `o4`, `grok-3`, `maverick`, `deepseek-r1` to high-tier patterns; updated family extraction for new model families
- **Fixed v1 logger examples in templates**: `log.feature('@login')` → `log.component('#login-handler')` in upgrade.ts and IDE adapter templates
- **Self-audit: migrated all Paradigm project files to v2 symbols**:
  - Root `.purpose`: replaced all `@feature` refs with `#component` + tags, removed `%state`/`states:` section, added `#team-orchestration` feature, updated relationships
  - `.paradigm/wisdom/antipatterns.yaml`: `@login` → `#login-handler`, `@register` → `#register-handler`
  - `.paradigm/agents.yaml`: architect focus/triggers changed from `@features`/`@*` to `#components`/`#*`
  - `.paradigm/docs/patterns.md`: full rewrite — all examples now use v2 logger methods, added `~aspect` pattern section, added v2 method reference table
  - `.paradigm/docs/error-patterns.md`: replaced `log.feature()`, `log.integration()` with `log.component()`
  - `base.ts` IDE adapter: `getLogMethodForSymbol()` now includes `~aspect`, v1 prefixes (`@`, `%`, `&`) map to `component()`

## Sentinel [0.1.1] - 2026-02-06

### Added

- **Project directory in header**: The Sentinel header now shows the project directory path next to the version badge, so you always know which project you're viewing. Long paths are truncated with ellipsis and show the full path on hover.

## [2.0.2] - 2026-02-05

### Fixed

- **YAML `!` signal quoting in docs**: All documentation examples now correctly quote `!` signals in YAML arrays (e.g., `["!success", "!failed"]` instead of `[!success, !failed]`). The `!` character is a YAML tag indicator and breaks parsing when unquoted in flow sequences. Fixed across 15 files including specs, templates, prompts, and examples.

- **Troubleshooting docs**: Added `!` quoting guidance to the "Common YAML issues" section alongside existing `@` quoting advice.

### Added

- **Top-level `aspects:` support in `.purpose` files**: The parser now recognizes `aspects:` as a top-level key in `.purpose` files, allowing projects to define aspect symbols (`~aspect-name`) with descriptions, tags, anchors, applies-to patterns, and enforcement rules.
  - Added `AspectDefinition` type to `purpose-core`
  - Added `AspectDefinitionSchema` (Zod) to parser
  - Added `extractAspects()` function to purpose-core aggregator
  - Wired aspect extraction into premise-core aggregator with anchor string parsing
  - Updated `schema.json` with `AspectDefinition`
  - Previously, top-level `aspects:` sections were silently stripped by Zod validation, causing aspect symbols to be missing from `paradigm scan` output

## [2.0.1] - 2026-02-05

### Fixed

- **Symbol false positives**: Fixed regex patterns that incorrectly matched prices (`$420`), variables (`$0`), and framework aliases (`$lib`, `$env`, `$app`) as flow symbols
  - Changed regex from `[\w-]+` to `[a-zA-Z][\w-]*` requiring letter after prefix
  - Added blocklist for common framework aliases (SvelteKit `$lib/$env/$app`, Vite `$virtual`, JSON `$schema/$ref`)
  - Fixed in: `premise-core`, `purpose-core`, and Sentinel fallback parser

- **Sentinel symbol loading**: Fixed Sentinel using its own fallback parser instead of premise-core
  - Sentinel now uses premise-core aggregator as primary source
  - Falls back to local scanner only if premise-core unavailable
  - Local scanner updated with same regex fixes

- **portal.yaml gate parsing**: Fixed gates not being extracted from portal.yaml
  - Updated fallback parser to properly extract gates from `gates:` section
  - Documented correct portal.yaml format (locks as array, prizes as objects)

### Added

- **Paradigm logging in Sentinel**: Added structured logging following paradigm patterns
  - Server startup logs: `#sentinel-server`
  - Symbol loading logs: `$load-symbols`, `#purpose-loader`, `#gate-loader`
  - API route logs: `^api-symbols`
  - Default log level: `info` (shows file loading, aggregation results)
  - Configurable via `SENTINEL_LOG_LEVEL` env var (`debug`, `info`, `warn`, `error`)

- **v2 migration prompt**: Added `.paradigm/prompts/update-to-v2.md` with comprehensive handoff prompt for updating projects to Symbol System v2

### Changed

- **Sentinel types updated to v2**: SymbolEntry type now uses v2 types (`component`, `flow`, `gate`, `signal`, `aspect`)
- **Logging on by default**: Sentinel now logs symbol loading and API access at `info` level by default

## [2.0.0] - 2026-02-05

### Breaking Changes

- **Symbol System v2**: Reduced from 9 symbols to 5 operational symbols
  - Removed: `@` (feature), `&` (integration), `%` (state), `?` (idea)
  - These are now tags: `[feature]`, `[integration]`, `[state]`, `[idea]`
  - `~` (aspect) now REQUIRES code anchors - unanchored aspects are invalid
  - Added: Tag bank system (`.paradigm/tags.yaml`)

### Added

- **Tag Bank System**: Classification via tags instead of symbol prefixes
  - Core tags: `feature`, `integration`, `state`, `critical`, `deprecated`, `idea`, `security`, `compliance`
  - Project-specific tags in `.paradigm/tags.yaml`
  - AI-suggested tags with human approval workflow
  - `suggested` section for AI to propose new tags

- **Anchors**: Line-based code references (`file.ts:15-20`)
  - Required for aspects (`~`)
  - Optional for other symbols
  - Format: single line (`file.ts:15`), range (`file.ts:15-20`), multiple (`file.ts:15,25,30`)

- **New Aspect Symbol (`~`)**: Cross-cutting rules with enforcement
  - Aspects MUST have code anchors pointing to enforcement code
  - `applies-to` patterns for automatic symbol matching
  - `enforcement` field for compliance instructions
  - Examples: `~audit-required`, `~rate-limited`, `~encrypted`

- **MCP Tools**:
  - `paradigm_tags()` - List, search, and manage tags
  - `paradigm_tags_suggest()` - AI proposes new tags for human review
  - `paradigm_aspect_check()` - Verify aspect anchors and coverage

- **Sentinel UI**:
  - Updated for v2 symbol types (#, $, ^, !, ~)
  - Tag display in all views (Grid, List, Canvas)
  - Properties Panel shows v2 symbol types

- **Migration Support**:
  - `parseLegacySymbol()` for parsing old @, %, ?, & symbols
  - `parseAnySymbol()` for handling both v1 and v2 formats
  - Legacy symbols auto-convert to #component with appropriate tags

### Changed

- **`#` Component is now universal**: All code units use `#` prefix
  - Features: `#checkout` with `tags: [feature]` (was `@checkout`)
  - Integrations: `#stripe-client` with `tags: [integration]` (was `&stripe`)
  - State: `#user-store` with `tags: [state]` (was `%user-store`)
  - Ideas: `#new-feature` with `tags: [idea]` (was `?new-feature`)

- **Logger methods updated**:
  - Removed: `log.feature()`, `log.integration()`, `log.state()`
  - Added: `log.aspect()`
  - All code units now use `log.component()`

- **`.purpose` file format updated**:
  - Version bumped to "2.0"
  - `tags` field for classification
  - `anchors` field for code references
  - Old `features:` sections should use `#` prefix with `[feature]` tag

- **config.yaml version bumped to "2.0"**:
  - `symbol-system` updated with 5 operational symbols
  - Added `tag-bank` configuration section
  - Updated `logging.symbol-mapping` for v2

- **CLAUDE.md updated for v2**:
  - New symbol table with 5 operational symbols
  - Tag bank explanation
  - Anchor format documentation
  - Updated logger examples

### Migration

Run `paradigm migrate v2 --dry-run` to preview changes, then `paradigm migrate v2` to execute.

**Manual steps required:**
1. Add anchors to all `~aspect` symbols
2. Review and approve AI-suggested tags
3. Update any custom tooling that parses symbols

### Files Changed

| File | Change |
|------|--------|
| `CLAUDE.md` | Updated symbol table, logger examples, conventions |
| `.paradigm/config.yaml` | v2 symbol system, tag bank config |
| `.paradigm/specs/symbols.md` | Complete rewrite for v2 |
| `.paradigm/specs/symbols-v2.md` | NEW - Full v2 specification |
| `.paradigm/specs/logger.md` | Updated methods and examples |
| `.paradigm/specs/disciplines.md` | Updated for v2 symbols + tags |
| `.paradigm/tags.yaml` | NEW - Tag bank definitions |
| `.paradigm/prompts/*.md` | Updated for v2 syntax |
| `examples/shopflow/**/.purpose` | Converted to v2 format |

---

## [1.9.0] - 2026-02-05

### Added

- **Sentinel UI Improvements** - Unified codebase intelligence visualizer enhancements
  - **Layout Modes** - Three view options for browsing symbols:
    - Canvas view: Free-form infinite canvas (default)
    - Grid view: Columns grouped by type (features, components, gates, etc.)
    - List view: Sortable table format
  - **Sorting Options** - Sort symbols by:
    - A-Z (alphabetical)
    - By Type (features → components → flows → gates → signals → states)
    - Recently Updated
    - Stale First (oldest modifications first)
  - **Live Editing** - Edit symbols and persist changes to `.purpose` files:
    - Description edits write back to source files
    - Tag additions/removals persist to files
    - Cached index (`.paradigm/index.json`) also updated
    - `PUT /api/symbols/:id` endpoint for programmatic updates
  - **GridView Component** - New column-based view grouped by symbol type
  - **ListView Component** - New table view with clickable sort headers

### Changed

- **Dark Mode Selection** - Fixed harsh selection styling in deep theme:
  - Type-specific selection glow (each type uses its own color)
  - Softer glow intensity for dark mode
  - Removed generic red border on selection
- **Node Dragging** - Disabled free-form dragging in browse mode
  - Nodes now use click-to-select (no drag)
  - Dragging will be re-enabled in future flow editor mode
- **Timeline Hidden** - Removed from default view
  - Will be shown when flow editing mode is implemented
  - Command input repositioned to bottom of screen
- **Toolbar** - Added layout toggle buttons and sort dropdown
  - Zoom controls only show in canvas mode

### Files Added

- `packages/sentinel/ui/src/components/Views/GridView.tsx`
- `packages/sentinel/ui/src/components/Views/ListView.tsx`

---

## [1.8.0] - 2026-02-05

### Added

- **Task Type Classification** - Intelligent agent selection based on task analysis
  - New `task-classifier.ts` detects: analysis, bugfix, feature, refactor, documentation
  - Analysis tasks use Architect only (0.4x cost)
  - Documentation tasks skip Builder/Tester (0.35x cost)
  - Keywords-based classification: "should", "what", "how" → analysis
  - Integrated into orchestrator for automatic agent right-sizing

- **Security Escalation Triggers** - Auto-involve Security agent for sensitive operations
  - Keywords: auth, permission, admin, delete, purge, password, credential, token
  - Gate symbols (^) in task description trigger escalation
  - Sensitive paths: `**/auth/**`, `**/middleware/**`, `**/security/**`
  - Security agent promoted to `required: true` with `opus` model

- **Cost Preview** - Estimated costs shown before agent spawn
  - New `cost-estimator.ts` calculates per-agent token estimates
  - Model pricing: opus ($15/$75), sonnet ($3/$15), haiku ($0.25/$1.25) per 1M tokens
  - Comparison to "full team" baseline in plan mode
  - `paradigm_orchestrate_inline` plan response includes `costPreview`

- **Portal Compliance Check** - Validate gates are used in codebase
  - New `paradigm portal check` command
  - Finds: declared but unused gates, used but undeclared gates
  - Language-agnostic grep-based detection
  - Integrated into `paradigm doctor` health checks

- **Auto-Ripple for Refactoring** - Automatic impact analysis
  - Detects refactoring tasks: rename, refactor, migrate, restructure
  - Runs `paradigm_ripple` before architect planning
  - Includes ripple results in architect context
  - Prevents breaking changes from missing dependencies

- **Purpose Tracker** - Post-task .purpose file prompts
  - Detects new directories without .purpose files
  - Generates .purpose templates for new features
  - Callback system for orchestrator integration

- **Flow Validation** - Define and validate multi-step flows
  - New `flow-schema.ts` with FlowStep, FlowDefinition types
  - New `flow-validator.ts` for validation logic
  - New MCP tool: `paradigm_flow_validate`
  - Checks: gates exist in portal.yaml, steps are complete
  - `.paradigm/flows.yaml` for flow definitions

- **Flow-First Development Guidance** - IDE adapters updated
  - Cursor: New `paradigm-flows.mdc` with flow-first protocol
  - Claude: Flow validation section in CLAUDE.md
  - Encourages defining flows before implementation

- **TaskFlow Split Test Updates** - Enhanced case study document
  - New pivots 6-9: Dangerous Operation, Documentation, Ripple, Flow-First
  - 30-point scoring system: Peace of Mind, Cost Efficiency, Scale Readiness
  - Paradigm-specific validation criteria per pivot

### Changed

- **Orchestrator** - Now uses task classification and security escalation
- **MCP Tools** - `paradigm_orchestrate_inline` returns classification and cost preview in plan mode
- **IDE Adapters** - Include flow-first development guidance

---

## [1.7.0] - 2026-02-05

### Added

- **Auto-Generated Orchestration Rules for Cursor** - Agents naturally use multi-agent workflows
  - `paradigm sync cursor` now generates `paradigm-orchestration.mdc`
  - MDC file includes: when to orchestrate, workflow steps, available agents, red flags
  - Agents list auto-populated from `.paradigm/agents.yaml`
  - `alwaysApply: true` ensures agents see orchestration guidance

- **Agent Suggestion CLI** - Preview which agents will handle a task
  - New command: `paradigm team agents suggest <task>`
  - Analyzes task against agent triggers (keywords, symbols)
  - Returns confidence levels (high/medium/low) with matched triggers
  - Suggests workflow order (architect → builder → tester, etc.)
  - `--json` flag for programmatic use

- **Enhanced MCP Orchestration** - Better planning with agent suggestions
  - `paradigm_orchestrate_inline` plan mode now returns `suggestedAgents` field
  - Agent suggestions ranked by confidence based on trigger matching
  - Updated tool description to be more directive about when to use orchestration

- **Dynamic Model Discovery** - Automatically discover available AI models based on environment
  - Detects Cursor, Claude Code, VSCode, and API provider environments
  - Fetches models from provider APIs when keys are available
  - 24-hour caching to avoid repeated API calls
  - Comprehensive presets for Cursor users (24+ models from 8 providers)

- **Interactive Model Selection** - Configure agent models during team init
  - `paradigm team init --configure-models` forces model selection prompts
  - `paradigm team init --no-configure-models` skips prompts (default in Claude Code)
  - Models grouped by tier (high/medium/low) with recommendations per agent role

- **Team Models Command** - View and configure agent model assignments
  - `paradigm team models` shows current configuration and available models
  - `paradigm team models --refresh` clears cache and re-discovers models
  - `paradigm team models --json` outputs machine-readable format

- **Shift Command Enhancement** - Now includes team initialization
  - `paradigm shift` now runs team init as Step 2/5
  - `paradigm shift --configure-models` enables model prompts during setup

- **Cursor CLI Agent Provider** - Native parallel agent support for Cursor IDE
  - New `cursor-cli` provider spawns agents via Cursor's `agent` CLI command
  - Supports parallel agent execution in Cursor environment
  - Auto-detected when running in Cursor (via environment variables)
  - Prioritized over `claude-cli` when Cursor environment is detected
  - `paradigm team providers` now shows `cursor-cli` availability

- **Model Visibility in Orchestration** - See which model runs each agent
  - Spinner and live output now shows `agent (model)` format (e.g., "builder (haiku)")
  - Orchestration MDC includes model assignments next to agent names
  - Helps understand cost and capability distribution across facets

- **OS-Aware Terminal Syntax Guidance** - Agents use correct commands for the OS
  - `paradigm_status` MCP tool returns OS platform and shell type
  - IDE instruction files include OS-specific terminal syntax tables
  - Windows users get PowerShell/CMD guidance
  - Mac/Linux users get bash/zsh guidance
  - Prevents agents from using `rm` on Windows or `del` on Unix

### Changed

- **Team Init** - Now auto-detects environment and prompts for models in Cursor/interactive terminals
- **Agent Types** - Added `ModelInfo`, `ModelConfig`, `ModelDiscoveryResult` types
- **Loader** - `generateDefaultManifest()` now accepts optional model overrides

---

## [1.6.0] - 2026-02-05

### Added

- **Parallel Builders** - Architect outputs file plans for parallel execution
  - Architect agent now produces structured `filePlan` with sub-phases
  - Files in the same sub-phase execute in parallel via multiple Task tool calls
  - Sub-phases execute sequentially (respects dependencies)
  - Each builder gets narrowed context: only assigned files + available files from earlier phases
  - ~80% token savings per builder through context narrowing
  - New types: `FilePlanGroup`, `BuilderStage`, `ParallelBuilderPlan`

- **Background Orchestration** - Run orchestrations asynchronously
  - `paradigm team orchestrate "task" --background` starts in background
  - Notifications when complete: `--notify bell,desktop,file`
  - New `BackgroundOrchestrator` class manages async orchestrations
  - Status tracking: pending → running → completed/failed → accepted/rejected

- **Orchestration Review Commands** - Review and accept/reject completed work
  - `paradigm team diff <id>` - Show file changes from orchestration
  - `paradigm team accept <id>` - Accept and merge changes
  - `paradigm team reject <id>` - Reject and optionally cleanup created files
  - `paradigm team status --running` - Show active background orchestrations
  - `paradigm team status --id <id>` - Show specific orchestration status

- **File Plan Protocol** - Structured architect output for builders
  ```yaml
  filePlan:
    - group: types
      subPhase: 0
      files:
        - path: src/types/index.ts
          description: "Core interfaces"
    - group: routes
      subPhase: 2
      files:
        - path: src/routes/api.ts
          description: "API endpoints"
  ```

### Changed

- **Orchestrator** - Now detects file plans and spawns parallel builders
  - `runParallelBuilders()` executes builders per sub-phase
  - `parallelBuilderStats` added to `OrchestrationResult`
  - Tracks: usedFilePlan, totalSubPhases, totalParallelBuilders, filesCreated

- **Agent Prompts** - Architect prompt updated with file plan instructions
  - Includes sub-phase ordering guidance (types → models → routes → app)
  - File plan parsing functions: `parseFilePlan()`, `parseRelayWithFilePlan()`

## [1.5.0] - 2026-02-04

### Validated

- **Portal Protocol Self-Test** - Built TaskFlow API to validate Portal Protocol effectiveness
  - Test location: `/tmp/taskflow-paradigm-test/`
  - Results documented in `SELF-TEST-RESULTS.md`
  - **Key finding:** Following Portal Protocol from the start prevented auth bug (Pivot 3) from ever being introduced
  - Called `paradigm_gates_for_route` 10 times during development
  - Created `portal.yaml` with 8 gates and 21 route mappings
  - Executed all 5 pivots from split test specification:
    - Pivot 1: Cross-cutting change (audit logging) ✅
    - Pivot 2: New feature + auth (task templates) ✅
    - Pivot 3: Auth bug fix (comment deletion) ✅ Bug never existed
    - Pivot 4: Multi-feature flow (Slack notifications) ✅
    - Pivot 5: Pattern question (soft vs hard delete) ✅
  - Validates that Portal Protocol guides AI to define gates before writing routes

### Changed

- **README Branding** - Added logo and case study
  - New centered logo (connected nodes representing knowledge graph)
  - Case study section: TaskFlow API comparison (42% faster, 8.5x less context, 88% cheaper)
  - "The Paradox" insight: more files but faster because structured context beats raw context

### Added

- **`paradigm shift` Command** - One command to fully initialize any project
  - Combines: init → scan → sync (all IDEs) → doctor
  - Generates CLAUDE.md, .cursor/rules/, .github/copilot-instructions.md, .windsurfrules
  - Options: `--quick` (skip scan), `--verify` (run health checks), `--ide <name>` (specific IDE)
  - One-liner install: `curl -fsSL https://raw.githubusercontent.com/ascend42/a-paradigm/main/install.sh | bash && paradigm shift`

- **Auto-Documenting Protocol** - AIs now know when to update Paradigm files
  - New "Maintaining Paradigm Files" section in generated CLAUDE.md
  - Decision table: change type → required action
  - Reference to `.paradigm/docs/ai-maintenance-protocol.md`

- **Graceful Degradation for MCP Tools** - Tools work even without full index
  - `paradigm_ripple` falls back to grep when symbol not indexed
  - Returns partial results with suggestion to run `paradigm scan`
  - `paradigm_search` includes fuzzy matching for typos (Levenshtein distance)

- **Session Continuity** - Breadcrumbs for cross-session context
  - Session breadcrumbs persisted to `.paradigm/session-breadcrumbs.json`
  - New `paradigm_session_recover` tool loads previous session context
  - Tracks symbols modified and files explored

- **Enhanced Gate Suggestions** - Learns from existing patterns
  - `paradigm_gates_for_route` now reads portal.yaml for similar routes
  - Route similarity scoring (exact, param, partial matches)
  - Infers ownership gates from `/api/{resource}/:id` patterns

- **Input Validation** - Zod schemas for all MCP tool inputs
  - New `validation.ts` with schemas for all tools
  - Better error messages for invalid inputs
  - Symbol format validation (must start with @#$%^!?~&)

- **Sentinel Auto-Initialization** - Zero-config incident tracking
  - Loads seed patterns on first use
  - Helpful empty state with recording instructions

- **New Documentation**
  - `.paradigm/docs/ai-maintenance-protocol.md` - When/how to update Paradigm files
  - `.paradigm/docs/agentic-efficiency-study.md` - Split test results (8.5x context reduction)
  - `.paradigm/docs/migration-prompt.md` - Guide for migrating existing codebases

### Changed

- **Auto-index on init** - `paradigm init` now runs scan automatically
  - Creates index for MCP tools to work immediately
  - Skipped with `--quick` flag for faster init
  - Graceful failure: warns but doesn't block init

- **Configurable ripple depth** - `paradigm_ripple` depth parameter
  - Default depth: 2, max: 5
  - Recursive analysis with cycle detection

- **Wisdom cache invalidation** - Fresh data after recording
  - Cache invalidated after `paradigm_wisdom_record`
  - 30-second TTL for automatic refresh

- **Lazy indexing in MCP** - Re-aggregates when index empty
  - 30-second cache TTL
  - Automatic refresh on stale data

- **Doctor command** - Now returns boolean and supports quiet mode
  - `doctorCommand({ quiet: true })` for programmatic use
  - Returns `true` if all checks pass

- **Sync command** - Supports quiet mode and target parameter
  - `syncCommand(ide, { quiet: true })` for programmatic use
  - Throws instead of process.exit in quiet mode

- **install.sh** - Updated to recommend `paradigm shift`
  - Simplified next steps
  - Shows all options for shift command

### Performance

- **8.5x average context reduction** vs traditional documentation
  - Cross-cutting changes: 12x less context needed
  - Flow understanding: 11x less context needed
  - Authorization features: 5.1x less context needed
  - See `.paradigm/docs/agentic-efficiency-study.md` for full results

---

## [1.4.0] - 2026-02-04

### Added

- **MCP-First Architecture** - Reference content served via MCP instead of copied to projects
  - New MCP resources: `paradigm://prompts`, `paradigm://prompts/{name}`, `paradigm://docs/{name}`, `paradigm://specs/{name}`
  - Prompts: 10 task templates (add-feature, refactor, debug-auth, etc.) available on-demand
  - Reference docs: commands.md, queries.md served via MCP
  - Reference specs: disciplines.md, scan.md, context-tracking.md served via MCP
  - Template size reduced from 260KB to ~60KB (76% reduction)
  - Token savings: ~37K tokens per project (~$0.11 per full read at Sonnet pricing)

- **Enhanced Session Cost Tracking** - Real-time token and cost monitoring
  - New utility: `session-tracker.ts` with detailed tracking
  - Multi-model pricing support: Claude Opus 4 ($15/M), Sonnet 4 ($3/M), Haiku 3.5 ($0.80/M)
  - Resource reads tracked by URI and type
  - Tool calls tracked by name with response size
  - Cost breakdown by category (resources vs tools)
  - `paradigm_session_stats` now returns detailed cost breakdown

- **MCP Resources Documentation** - CLAUDE.md now documents MCP resources
  - New section explaining on-demand content via MCP
  - Table of available resources and URIs
  - Usage instructions for reading prompts

### Changed

- **Template Copying** - `paradigm init` now skips MCP-served content
  - `prompts/` directory no longer copied to projects
  - `docs/commands.md`, `docs/queries.md` not copied
  - `specs/disciplines.md`, `specs/scan.md`, `specs/context-tracking.md` not copied
  - `echoes.yaml` not copied (redundant)
  - Projects still get: config.yaml, specs/ (logger, symbols, context, etc.), docs/ (patterns, troubleshooting)

- **Session Tracker Refactored** - Moved to dedicated utility module
  - `trackToolCall(size, name)` now accepts tool name for detailed tracking
  - `trackResourceRead(size, uri)` now accepts URI for categorization
  - All MCP handlers updated to pass tracking context

- **Display Updates** - Init command updated for MCP-first
  - Summary no longer mentions prompts/ directory
  - Notes that reference content is available via MCP
  - Dry-run mode reflects lean template structure

### Migration Guide

**For existing projects:**
```bash
# Optional cleanup (saves disk space)
rm -rf .paradigm/prompts
rm .paradigm/docs/commands.md .paradigm/docs/queries.md
rm .paradigm/specs/disciplines.md .paradigm/specs/scan.md .paradigm/specs/context-tracking.md
rm .paradigm/echoes.yaml

# Required for updated agent instructions
paradigm sync
```

**MCP resources work regardless of local files** - old projects continue to work, but won't benefit from lean templates until cleanup.

---

## [1.3.0] - 2026-02-04

### Added

- **MCP Agent Protocol Resource** - New `paradigm://context/agent-protocol` resource
  - Returns workflow instructions for agents in any MCP-compatible client
  - Enables Claude Desktop to receive the "query before modify" protocol
  - Listed first in resources to encourage discovery at session start

- **Enhanced CLAUDE.md Generation** - `paradigm sync claude` now includes MCP Workflow Protocol
  - Adds "query before modify" table with tool recommendations
  - Explains token efficiency benefits (~100 tokens vs ~2000)
  - Bridges instruction gap for Claude Code users

- **Claude Code Permissions** - `paradigm sync claude` now adds permissions to `.claude/settings.json`
  - Automatically adds `Bash(paradigm *)` permission
  - Allows Claude Code to run all paradigm commands without prompting

- **Quick Start Guide** - New comprehensive setup documentation
  - Added `docs/guides/quick-start.md` with complete setup instructions
  - Includes super command for one-line project setup
  - Key commands reference table

- **Installation Script** - Added `install.sh` for automated CLI installation
  - One-command installation: `curl -fsSL https://...raw.../install.sh | bash`
  - Downloads, builds, and installs Paradigm CLI globally
  - Includes verification and helpful next steps

- **MCP Troubleshooting Guide** - Comprehensive section for diagnosing MCP server connection issues
  - Symptoms: "DeleteClient action", command not found, immediate disconnect
  - Solutions: Broken npm link diagnosis, direct path workaround, shebang issues
  - Common causes table for quick reference
  - **nvm/PATH section**: Cursor doesn't inherit shell PATH, need absolute paths in mcp.json

- **Internal CLI Logger** - Paradigm CLI now uses its own logger specification
  - All commands use structured logging with `log.command()`, `log.operation()`, `log.component()`
  - Duration tracking for operations via `.start()` → `.success()`/`.error()`
  - Debug logs visible with `DEBUG=1` environment variable
  - Maintains visual polish with chalk while adding structure for debugging
  - "Eating our own dog food" - CLI follows Paradigm logger patterns

- **Comprehensive Command Documentation** - Detailed guides for all core commands
  - Created `.paradigm/docs/commands/` directory with 8 detailed command guides (internal framework)
  - Each guide includes: Overview, Usage, Integration, Workflows, Tips, Examples, Troubleshooting
  - Commands documented: `init`, `sync`, `index`, `beacon`, `constellation`, `mcp-setup`, `ripple`, `doctor`
  - Added navigation index (`.paradigm/docs/commands/.index.yaml`)
  - Updated main `commands.md` to link to detailed guides
  - Improved onboarding and reduces "what does this do?" confusion

- **GitHub Documentation Hub** - Public-facing documentation structure
  - Created `docs/README.md` as central documentation hub
  - Copied command guides to `docs/commands/` for GitHub visibility
  - Updated main `README.md` with prominent documentation links
  - Documentation section with quick access to most important guides
  - Professional documentation structure for better discoverability

- **Template Optimization** - Reduced `.paradigm/` token cost by 42%
  - Removed CLI command docs from templates (reference GitHub instead)
  - Moved optional patterns to `examples/patterns/` (not in every project)
  - Template size: 452KB → 260KB (~39,600 tokens saved per project)
  - Cost savings: $0.30 per AI session, $29.70 per 100 projects
  - What stays: Core specs, docs patterns, task prompts, config
  - What's optional: FTUX, sandbox mode, portal testing patterns

### Changed

- **MCP Tool Descriptions** - More prescriptive descriptions for key tools
  - `paradigm_ripple` now emphasizes "call BEFORE modifying"
  - `paradigm_status` recommends calling at session start for orientation
  - `paradigm_related` suggests calling before modifications to understand connections

- **Logger Method Consistency** - Fixed remaining `log.portal()` → `log.gate()` references
  - Updated `.paradigm/docs/patterns.md`, `.paradigm/docs/error-patterns.md`
  - Updated `.paradigm/prompts/add-gate.md`, `.paradigm/specs/portal-validation.md`

- **Package READMEs** - Updated all package READMEs to use `@a-company/*` package names
  - Updated 7 package READMEs (purpose-core, probe-core, prism, premise-core, portal-sdk, portal-manager, portal-core)
  - Fixed CLI command references from `horizon` to `paradigm`
  - Fixed config file references from `gate.yaml` to `portal.yaml`

- **Spec Naming** - Renamed `.paradigm/specs/scan.md` → `.paradigm/specs/probe.md` to match content

- **Documentation** - Added `.paradigm/docs/.index.yaml` for AI agent navigation

### Removed

- **Session Report** - Removed temporary `docs/session-report-2026-01-27.md`

### Fixed

- **Sync --all MCP Generation** - Fixed `paradigm sync --all` not generating MCP configs
  - Now properly creates `.claude/settings.json` when syncing all IDEs
  - MCP configs are generated for all supporting IDEs (Cursor, Claude)

- **Init Command** - Fixed misleading message suggesting non-existent `paradigm portal init` command
  - Now correctly advises to create portal.yaml manually if needed
  - Added link to portals documentation

### Changed

- **Documentation** - Renamed `docs/website-outline.md` → `docs/paradigm-website-outline.md`

---

## [1.2.1] - 2026-02-02

### Added

- **Context Tracking (MCP)** - Session-aware context monitoring for handoff recommendations
  - `paradigm_context_check` tool - Check if context handoff is recommended
  - `paradigm_handoff_prepare` tool - Prepare handoff summary with next steps
  - `paradigm_session_stats` tool - Get current session statistics
  - `paradigm://context/session` resource - Passive session monitoring
  - `paradigm://context/handoff-guide` resource - When/how to handoff guide
  - New spec: `.paradigm/specs/context-tracking.md`
  - Thresholds: <50% continue, 50-70% consider, 70-85% recommended, >85% urgent
  - Context Monitoring Protocol added to CLAUDE.md and Cursor rules

### Fixed

- **ASCII Art Banner** - Fixed 'GM' portion alignment in CLI banner
- **Legacy "Horizon" References** - Updated remaining references in scan/index.ts, legacy-config.ts, ide-adapters
- **Help Text** - Updated `paradigm portal test` help to use correct command names

- **Symbol `~` Definition** - Standardized on "Deprecated" (was inconsistently "Aspects" in some files)
  - Updated symbols.md, beacon.ts, constellation.ts, tutorial, and all templates
  - Symbol now consistently means "marked for removal" across all documentation

- **Logger Method Naming** - Standardized on `log.gate()` for portal/gate logging
  - Changed from `log.portal()` to `log.gate()` to match `^` gate symbol
  - Updated logger.md, symbols.md, patterns.md, and all template files

- **Broken Reference** - Removed reference to non-existent `specs/ftux-component-system.md`

### Changed

- **CLAUDE.md Optimization** - Reduced from 135 to 81 lines
  - Removed duplicated logger spec (now references spec file)
  - Added AI Agent Systems table (Navigator, Wisdom, History)
  - Streamlined symbol table and conventions

- **File Organization** - Cleaned up root directory
  - Moved 9 `paradigm-*.md` prompt files to `.plans/` (gitignored)
  - Deleted empty `paradigm-wisdom-history.md`
  - Deleted internal `A-COMPANY-WEBSITE-VISION.md`
  - Renamed `horizon-config.ts` → `legacy-config.ts`

- **Templates Updated** - `paradigm init` now generates correct files
  - Added navigator.md, wisdom.md, history.md to template specs
  - All templates use `log.gate()` consistently
  - All templates define `~` as "Deprecated"

- **Example Cleanup** - Migrated `examples/shopflow/.horizon/` → `.paradigm/`
  - Updated all internal references from .horizon to .paradigm

### Added

- **Minimal Setup Guide** - Added "Getting Started with Minimal Paradigm" section to README
- **.gitignore Entries** - Added `.plans/`, `.claude/settings.local.json`, `.cursor/plans/`, `*.prompt.md`, `.mcp.json`

### Removed

- **Legacy gate/ Commands** - Removed orphaned `commands/gate/` directory (use `commands/portal/` instead)

- **Phoenix Protocol** - Removed in favor of `paradigm team handoff`
  - Deleted `.paradigm/specs/phoenix.md` and template
  - Deleted `.paradigm/prompts/phoenix-handoff.md` and template
  - Removed `phoenix-threshold` and `phoenix-path` from config.yaml
  - Updated docs to reference `paradigm team handoff` for context continuity
  - The Team system's handoff command provides the same functionality with better structure

---

## [1.2.0] - 2026-02-02

### Added

- **Navigator System** - AI exploration optimization via pre-indexed project structure
  - Auto-generates `.paradigm/navigator.yaml` during `paradigm scan`
  - Structure mapping: code categories to directory locations
  - Key files index: config, entry points, type definitions
  - Skip patterns: inherits from .gitignore plus defaults
  - Symbol-to-path mapping for direct lookup
  - New MCP tool: `paradigm_navigate` with find/explore/context intents
  - New specification: `.paradigm/specs/navigator.md`

- **Navigation Sections in IDE Files**
  - CLAUDE.md includes "Paradigm Navigation" exploration protocol
  - Cursor rules include `paradigm-navigator.mdc` with navigation guidance
  - Task recipes for common operations (adding features, modifying components)

- **MCP Navigate Tool**
  - `paradigm_navigate({ intent: "find", target: "@checkout" })` - locate symbols
  - `paradigm_navigate({ intent: "explore", target: "authentication" })` - browse areas
  - `paradigm_navigate({ intent: "context", task: "add Apple Pay" })` - task context
  - Returns: paths, symbols, skip patterns, suggested reading order

### Changed

- `paradigm scan` now generates both scan-index.json and navigator.yaml
- MCP server version bumped to 1.2.0
- CLI version bumped to 1.2.0

---

## [1.1.0] - 2026-02-02

### Added

- **Wisdom System** - Team context MCP for preferences, antipatterns, decisions, expertise
  - New directory: `.paradigm/wisdom/` with preferences.yaml, antipatterns.yaml, expertise.yaml
  - Decision records in `.paradigm/wisdom/decisions/*.yaml` (ADR format)
  - MCP resources: `paradigm://wisdom/preferences`, `paradigm://wisdom/antipatterns`, `paradigm://wisdom/decisions`
  - MCP tools: `paradigm_wisdom_context`, `paradigm_wisdom_record`, `paradigm_wisdom_expert`
  - CLI commands: `paradigm wisdom show|init|add-antipattern|decide|expert`
  - Symbol-indexed for targeted, low-token queries

- **History System** - Implementation history MCP for tracking what worked/failed
  - New directory: `.paradigm/history/` with log.jsonl (append-only), index.yaml, validation.yaml
  - Tracks implementations, validations, rollbacks with fragility scoring
  - Co-change pattern detection (symbols that tend to change together)
  - MCP resources: `paradigm://history/symbol/{symbol}`, `paradigm://history/fragile`, `paradigm://history/cochanges`
  - MCP tools: `paradigm_history_context`, `paradigm_history_record`, `paradigm_history_validate`, `paradigm_history_fragility`
  - CLI commands: `paradigm history show|init|fragile|reindex|record|validate`

- **Git Hooks for History Capture** - Automatic history recording from commits
  - Post-commit hook extracts symbols from .purpose files in changed directories
  - Pre-push hook reindexes history
  - New CLI commands: `paradigm hooks install|uninstall|status`

- **Enhanced Sync** - Multi-platform improvements
  - MCP config generation for Claude (`.claude/settings.json`) and Cursor (`.cursor/mcp.json`)
  - Nested CLAUDE.md generation for directories with .purpose files (`--nested` flag)
  - New sync options: `--mcp`, `--no-mcp`, `--nested`

- **New Specifications**
  - `.paradigm/specs/wisdom.md` - Full wisdom system specification
  - `.paradigm/specs/history.md` - Full history system specification

### Changed

- Extended `ProjectContext` type with wisdom and history data
- MCP server version bumped to 1.1.0
- CLI version bumped to 1.1.0

### Deprecated
- **`paradigm visualize` command** - Removed in favor of AI-first workflows
  - The Prism visualizer is no longer bundled with the CLI
  - Use `paradigm constellation --format json` for graph data export
  - Use `paradigm beacon` for AI-readable project orientation
  - The `packages/prism/` source remains in the repo for potential future use

### Fixed
- Schema now accepts string format for relationships (e.g., `"@feature USES #component"`)
- Schema now accepts string format for flow steps (simple descriptions)
- Validator handles both string and object formats gracefully

---

## [0.7.0] - 2026-02-01

### Added
- **Multi-Agent Orchestration** (`paradigm team`) - Coordinate AI agents as a dev team
  - `paradigm team init` - Initialize with 5 default agent roles (architect, builder, reviewer, tester, security)
  - `paradigm team status` - Show current agent, pending handoffs, activity log
  - `paradigm team handoff --to <agent>` - Hand off task with context to another agent
  - `paradigm team accept [id]` - Accept a pending handoff and become active agent
  - `paradigm team check` - Health check for conflicts, stale handoffs, blocked agents
  - `paradigm team history` - Full activity timeline with handoffs
  - `paradigm team reset` - Clear state for fresh start (with `--force` for pending work)
  - Agent manifest: `.paradigm/agents.yaml` with roles, focus areas, permissions
  - Team state: `.paradigm/team-state.yaml` tracks current agent and activity
  - Handoff protocol: `.paradigm/handoffs/*.yaml` preserves context between agents
  - Each agent has defined read/write permissions and handoff targets

- **Lint Command** (`paradigm lint`) - Validate .purpose files for schema errors
  - Reports YAML syntax errors with line numbers
  - Validates against .purpose schema
  - Provides fix suggestions for common issues
  - `--fix` flag for auto-fixing:
    - Auto-converts markdown .purpose files to YAML template
    - Auto-quotes special YAML characters in arrays (#, @, $, ^, !, %)
    - Cleans formatting via re-serialization
  - `--strict` flag to fail on warnings
  - `--json` for CI integration
  - Exit code 1 on errors for pipelines

- **Cost Analysis** (`paradigm cost`) - Token cost analysis for AI context
  - Estimates token counts for all context files
  - Compares static vs dynamic (MCP) context loading
  - Shows potential savings percentage and cost estimate
  - `--detailed` flag for file-by-file breakdown
  - `--json` for programmatic access
  - Provides optimization recommendations

- **Auto-Scan** (`paradigm scan auto`) - Zero-config .purpose generation from code
  - Detects React/Vue/Angular components → #components
  - Detects route definitions (Express, Next.js, React Router) → $flows
  - Detects auth middleware patterns → ^gates (including RLS, ProtectedRoute)
  - Detects error/event patterns → !signals (toast, dispatch, analytics, emit)
  - Honors JSDoc @feature/@component tags for high confidence
  - `--dry-run` to preview without writing
  - `--force` to overwrite existing files
  - Groups symbols by directory for organized .purpose files

- **MCP Server** (`@a-company/paradigm-mcp`) - Model Context Protocol server for AI assistants
  - Exposes Paradigm symbols, gates, flows to Claude and other MCP-compatible AI
  - **Resources**: `paradigm://symbols`, `paradigm://symbol/{symbol}`, `paradigm://gates`, `paradigm://flows`
  - **Tools**: `paradigm_search`, `paradigm_ripple`, `paradigm_related`, `paradigm_status`, `paradigm_gates_for_route`
  - Technology agnostic: Works with any language/framework
  - Enables dynamic mid-conversation context fetching
  - Usage: `npx @a-company/paradigm-mcp` or add to Claude Desktop config

- **MCP Setup Command** (`paradigm mcp setup`) - Auto-configure MCP for AI clients
  - Detects installed clients: Cursor, Claude Desktop, Continue, Cline
  - Generates appropriate config files for each client
  - `paradigm mcp setup --client cursor` for specific client
  - `paradigm mcp setup --client all` for all detected clients
  - `paradigm mcp status` to check configuration
  - Auto-adds project-level configs to `.gitignore`

- **MCP List Command** (`paradigm mcp list`) - View all configured servers
  - Shows servers across all AI clients (not just current project)
  - Highlights current project in the output
  - Useful for managing multi-project Claude Desktop setups

- **MCP Remove Command** (`paradigm mcp remove`) - Clean up server configs
  - Remove by server name: `paradigm mcp remove project-name`
  - Remove current project: `paradigm mcp remove`
  - Target specific client: `--client claude-desktop`
  - Also matches by project path for Continue's unnamed servers

- **Enhanced Signals Schema** - Extended `SignalDefinition` for richer metadata
  - Added `severity` field: `'info' | 'warn' | 'error'`
  - Added `emitters` field: Array of files that emit this signal
  - Added `related` field: Array of related symbols (@, ^, $, etc.)
  - Enables categorized signal tracking and documentation

- **Symbol Indexer Improvements** - Comprehensive symbol extraction from `.purpose` files
  - Parse `flows:`, `gates:`, `states:`, `signals:` from feature/component definitions
  - Support both array format `[{id, description}]` and record format `{id: {description}}`
  - Extract symbol references from descriptions via regex (`$flow`, `^gate`, etc.)
  - Parse `portals:` key in `portal.yaml` as alias for `gates:`

- **Smart Init** - Enhanced `paradigm init` with intelligent onboarding
  - Auto-detects existing IDE instruction files (.cursorrules, copilot-instructions.md, etc.)
  - Detects project type (Next.js, Express, Python, etc.)
  - Shows detection results with line counts
  - New `--migrate` flag outputs AI-ready migration prompt
  - New `--quick` flag for non-interactive setup
  - New `--dry-run` flag to preview what would be created
  - Improved post-init summary with clear next steps

- **Migration Prompts** - AI-assisted migration from existing IDE files
  - Generates detailed prompts for converting to modern scoped format
  - Covers Cursor (.mdc) and Copilot (.instructions.md) formats
  - Includes file structure examples and frontmatter syntax

- **MCP Setup Guide** (`docs/guides/mcp-setup.md`) - Comprehensive guide for Claude Desktop integration
  - Step-by-step installation and configuration
  - Available resources and tools reference
  - Example conversations showing MCP in action
  - Troubleshooting section

- **Content Guide** (`docs/content-guide.md`) - Structure for YouTube and blog content
  - 7-video YouTube series with detailed scripts
  - 5-part blog post series outlines
  - Production notes and visual guidelines
  - Call-to-action templates

- **TaskFlow Tutorial** (`docs/tutorial-project.md`) - Build-along tutorial project
  - 6-episode guide building a task management app
  - Demonstrates all Paradigm features
  - AI interaction scripts for each episode
  - Starter repository structure
  - Teaching moments with intentional mistakes

- **Project `.purpose` Files** - Paradigm now documents itself
  - Root `.purpose` with 8 features, 20+ components
  - Package-level `.purpose` files for CLI, MCP, Portal, Prism, etc.
  - Full symbol coverage of the framework

### Changed
- **README.md** - Complete rewrite reflecting evolved project
  - Better value proposition and problem statement
  - Comprehensive command reference organized by category
  - Agent efficiency features prominently featured
  - IDE support and migration documentation
  - Cleaner structure with practical examples
  - Added MCP Server section with Claude Desktop config example

- **Website Outline** (`docs/website-outline.md`) - Updated with MCP documentation
  - Added MCP Server product page (Section 4.5)
  - Added Claude Desktop to IDE integration
  - Added MCP-specific use case
  - Updated navigation and SEO keywords
  - Added TaskFlow tutorial reference

### Fixed
- **Symbol Indexer** - Fixed parsing of flows, gates, states from `.purpose` files
- **Portal Parser** - Now accepts both `gates:` and `portals:` keys in `portal.yaml`

---

## [0.6.0] - 2026-01-27

### Added
- **Agent Efficiency Suite** - Tools to make AI agents faster and more context-aware

- **Beacon** (`.paradigm/beacon.md`) - Quick-start orientation for AI agents
  - Compact symbol map showing features, portals, and relationships
  - Key file landmarks for fast navigation
  - Links to available pathways (prompts)
  - New command: `paradigm beacon [--refresh] [--json]`

- **Constellation** (`.paradigm/constellation.json`) - Machine-readable symbol graph
  - Complete symbol relationship data in JSON/YAML format
  - Stars (symbols) with categorized references: portals, signals, components, etc.
  - Orbits (flows) with step sequences
  - Queryable by AI agents for impact analysis
  - New command: `paradigm constellation [--format json|yaml]`

- **Ripple** - Change impact analysis
  - Shows upstream dependencies (what a symbol requires)
  - Shows downstream effects (what would be affected by changes)
  - Flow membership tracking (which flows include this symbol)
  - Test command suggestions
  - New command: `paradigm ripple <symbol> [--json]`

- **Thread** (`.paradigm/thread.md`) - Session continuity between AI agents
  - Trail: Record what was done in a session
  - Loose ends: Track unfinished tasks
  - Breadcrumbs: Notes for the next agent
  - New commands: `paradigm thread [show|save|todo|note|clear] [--json]`

- **Echo** (`.paradigm/echoes.yaml`) - Error-to-symbol mapping
  - Map error codes to their source symbols
  - Include resolution hints and ripple effects
  - Template included in `paradigm init`
  - New commands: `paradigm echo [lookup|init|list] [--json]`

- **Enhanced Pathways** - Improved prompt templates
  - Added prerequisites section with file references
  - Added implementation steps with CLI commands
  - Added "After" sections for follow-up actions
  - Templates now reference beacon, constellation, thread, and echo

- **Agent CLI Integration** - Token-efficient querying for AI agents
  - Added `--json` flag to `beacon`, `thread`, and `echo` commands
  - All agent-facing commands now support machine-readable output
  - New `paradigm-agent-hints.mdc` generated for Cursor with query patterns
  - New `paradigm-agent-hints.instructions.md` for Copilot
  - New `queries.md` documentation with jq recipes for constellation queries
  - Portal Viewer: New Command Palette UI for copying CLI commands
  - AI agents can now query on-demand (~100 tokens) vs reading files (~2000 tokens)

- **Website Outline** - Comprehensive website design document
  - Brand positioning and taglines
  - Site architecture and navigation
  - Homepage sections and content
  - Product pages for Purpose, Portal, Premise, Prism
  - Documentation structure
  - Visual design notes

---

## [0.5.0] - 2026-01-27

### Added
- **Portal Viewer** - Real-time visualization dashboard for portal activations
  - New package: `@a-company/portal-viewer`
  - Constellation view: Interactive star map where portals "light up" on activation
  - Testing checklist: Auto-ticking gates for QA verification
  - Event timeline: Scrolling log with entity filtering
  - Session recording: Capture test runs for reporting
  - Flow visualization: Track progress through multi-gate flows
  - New CLI commands: `paradigm portal watch`, `paradigm portal report`

- **Webhook Integration** - Push session reports to external services
  - Slack Block Kit formatted messages
  - Discord embed formatted messages
  - Email HTML reports
  - Generic HTTP POST for custom endpoints
  - Configuration via `.paradigm/portal-webhooks.yaml`
  - Environment variable expansion for secrets

- **Session Reporting** - Structured test session exports
  - JSON export with full event details
  - Markdown reports for documentation
  - Pass/fail statistics and flow completion tracking
  - Entity journey tracking

- **Modern Cursor Rules Format** - `.cursor/rules/*.mdc` support
  - `paradigm sync cursor` now generates multiple focused `.mdc` files
  - YAML frontmatter with `globs` and `alwaysApply` for scoped rules
  - Rules only load when relevant files are open (better token efficiency)
  - Generated files: `paradigm-core.mdc`, `paradigm-symbols.mdc`, `paradigm-logging.mdc`, etc.
  - Automatic backup of legacy `.cursorrules` to `.cursorrules.bak`

- **Modern Copilot Instructions Format** - `.github/instructions/*.instructions.md` support
  - `paradigm sync copilot` now generates multiple focused `.instructions.md` files
  - YAML frontmatter with `applyTo` for glob-based scoping
  - Core instructions remain in `.github/copilot-instructions.md` (always applies)
  - Path-specific instructions in `.github/instructions/` directory
  - Generated files: `paradigm-symbols.instructions.md`, `paradigm-logging.instructions.md`, etc.

- **CLI Improvements**
  - Added `claude` as a valid IDE option for `paradigm init --ide claude`
  - Enhanced `--ide` option descriptions in help text to show output file paths
  - Improved error messages for invalid IDE options with full list of available options

### Fixed
- **Build System**
  - Fixed TypeScript module resolution for workspace dependencies during DTS generation
  - Added `tsup.config.ts` for `@a-company/portal-sdk` to properly handle workspace dependencies
  - Resolved build failures caused by missing workspace symlinks (requires `npm install`)

### Changed
- **Marathon Ports** - All Paradigm tools now use memorable port numbers
  - Portal Viewer UI: 42195 (marathon distance: 42.195km)
  - Portal Viewer WebSocket: 42196
  - Prism Visualizer: 42197
- **Build System**
  - Updated `portal-sdk` build script to use `tsup.config.ts` instead of CLI flags
  - Improved build reliability by ensuring workspace packages are properly linked
- **CLI**
  - Enhanced `paradigm init` command to better explain IDE option variables and their output files
  - Improved user experience when selecting IDE target with clearer descriptions

---

## [0.4.0] - 2026-01-24

### Added
- **Claude IDE Adapter** - Generate `CLAUDE.md` for Claude-native contexts
  - Claude Code, Claude API, and Claude Desktop support
  - Optimized format for Claude's context preferences
  - New command: `paradigm sync claude`

- **New Symbols for v1.0**
  - `~` (Deprecated) - Mark features/components for removal
  - `&` (Integration) - External services and third-party connections
  - Logger method: `log.integration('&stripe')`

- **Discipline Mappings** - Universal framework support
  - New spec: `specs/disciplines.md`
  - Symbol interpretations for: Web, Backend, ML, Mobile, Game, Embedded, DevOps
  - Custom discipline support in `config.yaml`
  - Generic directory patterns that work across project types

- **Error Patterns Template** - Standardized error handling
  - `docs/error-patterns.md` template (language-agnostic pseudocode)
  - API error response format
  - Error flow diagram

- **ADR Templates** - Architecture Decision Records
  - `docs/decisions/` directory structure
  - `000-template.md` for new ADRs
  - README with ADR index

- **Custom Symbol Support**
  - Projects can define additional symbols in `config.yaml`
  - Example: `§` for domain-specific concepts

### Changed
- Version bump to 0.4.0
- All code examples converted to language-agnostic pseudocode
- Directory patterns expanded to support all disciplines (ML, embedded, etc.)
- Symbol mappings now include `integrations/**`, `pipelines/**`, `drivers/**`
- README updated with new features and discipline support

---

## [0.3.2] - 2026-01-24

### Added
- **Context Cost Optimization** - Guidance for keeping `.cursorrules` slim
  - New troubleshooting section: "Context Bloat / Token Costs"
  - Updated `specs/context.md` with "Keeping .cursorrules Slim" section
  - Target: <100 lines, <1,000 tokens for `.cursorrules`
  - Slim template included in troubleshooting docs

- **Phoenix Protocol** - AI context continuity system
  - New spec: `.paradigm/specs/phoenix.md`
  - Enables AI agents to preserve work state when approaching context limits
  - Writes `.context/phoenix.yaml` with progress, memories, and next steps
  - New session reads ashes and continues seamlessly
  - Configurable threshold and model settings in `config.yaml`

- **Context & Documentation Index System** - Hierarchical doc navigation
  - New spec: `.paradigm/specs/context.md`
  - `.index.yaml` files for directory-level indexing
  - Document frontmatter schema with metadata
  - Section-level line ranges for targeted reading
  - Dependency tracking between documentation and code
  - Canonical markers to establish source of truth

- **AI Agent Configuration** in `config.yaml`
  - `ai-agent.model` - Current AI model identifier
  - `ai-agent.context-window` - Token limit
  - `ai-agent.phoenix-threshold` - When to trigger phoenix (default 80%)
  - `ai-agent.phoenix-path` - Where phoenix files are written

- **Context Settings** in `config.yaml`
  - `context.enabled` - Enable documentation indexing
  - `context.index-file` - Index file name (default `.index.yaml`)
  - `context.docs-path` - Root documentation directory

### Changed
- Updated `agent-guidelines.how-to-use` with documentation index and phoenix protocol tips

## [0.3.1] - 2026-01-20

### Added
- `--ide <ide>` flag for `paradigm init` to explicitly choose target IDE (cursor, copilot, windsurf)

### Fixed
- `paradigm init` now always generates `.cursorrules` by default when no IDE is detected
- Previously skipped IDE instruction file generation if no `.cursor`, `.vscode`, or `.windsurf` directory existed

## [0.3.0] - 2026-01-20

### Added
- **Framework Rebrand: Horizon → Paradigm**
  - New naming scheme reflecting AI-agent mindset philosophy
  - Modules renamed: Dream → Premise, Gate → Portal, Scan → Probe, Visualizer → Prism
  - All packages now under `@a-company` npm scope

- **Migration Tool**
  - `paradigm upgrade --from-horizon` to migrate existing Horizon projects
  - Automatically renames `.horizon/` to `.paradigm/`
  - Converts `gate.yaml` files to `portal.yaml`
  - Updates `.dream` files to `.premise`
  - Updates content references throughout project files

- **Prism Visual Identity** (formerly Dreamscape)
  - New triangular prism logo with spectral light rays
  - New spectral color themes: Spectrum 🌈, Focus 🔍, Deep 💎
  - Updated UI branding throughout visualizer

- **New Package Names**
  - `@a-company/paradigm` - Main CLI (was `@horizon/cli`)
  - `@a-company/premise-core` - Aggregation (was `@horizon/dream-core`)
  - `@a-company/portal-core` - Authorization (was `@horizon/gate-core`)
  - `@a-company/portal-sdk` - Runtime SDK (was `@horizon/gate-sdk`)
  - `@a-company/portal-manager` - Testing (was `@horizon/gate-manager`)
  - `@a-company/probe-core` - Visual discovery (was `@horizon/scan-core`)
  - `@a-company/prism` - Visualizer UI (was `@horizon/visualizer`)
  - `@a-company/purpose-core` - Context (was `@horizon/purpose-core`)

### Changed
- CLI command renamed from `horizon` to `paradigm`
- Subcommands renamed: `gate` → `portal`, `dream` → `premise`, `scan` → `probe`
- Config directory: `.horizon/` → `.paradigm/`
- Authorization files: `gate.yaml` → `portal.yaml`
- Idea files: `.dream` → `.premise`
- Index files: `scan-index.json` → `probe-index.json`
- Symbol `^` now called "Portal" (was "Gate")
- Logger method `log.gate()` renamed to `log.portal()`
- Environment variable `HORIZON_SYMBOLS` → `PARADIGM_SYMBOLS`
- All templates updated with new naming conventions
- Documentation fully updated (README, CONTRIBUTING, all specs and docs)

## [0.2.1] - 2026-01-19

### Added
- Comprehensive `.cursorrules` file with Horizon framework documentation
- Changelog and version management instructions in `.cursorrules`
- Semantic versioning workflow for automated changelog updates

### Changed
- Updated `.gitignore` with comprehensive Node.js, TypeScript, and monorepo patterns
- Improved gitignore coverage for build artifacts, cache directories, and IDE files

## [0.2.0] - 2026-01-14

### Added
- **IDE-Agnostic Architecture** - `.horizon/` directory as source of truth
  - `config.yaml` - Main configuration with symbol system and logging settings
  - `specs/` - Philosophy and specifications (logger, scan, symbols)
  - `docs/` - Reference documentation (commands, patterns, troubleshooting)
  - `prompts/` - Pre-written task prompts for common operations
  - `project.md` - Auto-generated project summary

- **Multi-IDE Support** - Generate instruction files for different IDEs
  - Cursor (`.cursorrules`)
  - GitHub Copilot (`.github/copilot-instructions.md`)
  - Windsurf (`.windsurfrules`)

- **Horizon Logger Specification** - Structured logging with symbol types
  - Symbol-typed methods: `log.feature()`, `log.component()`, `log.gate()`, etc.
  - Duration tracking with `.start()` / `.success()` / `.error()`
  - Directory-to-symbol mapping in config
  - Log level and symbol filtering

- **New CLI Commands**
  - `horizon sync [ide]` - Generate IDE instruction files (auto-detects IDE)
  - `horizon sync --all` - Sync all supported IDEs at once
  - `horizon doctor` - Health check and setup validation
  - `horizon watch` - Auto-sync on `.horizon/` file changes
  - `horizon summary` - Generate `.horizon/project.md` with project stats

- **Template System** - Templates for new project initialization
  - Full `.horizon/` directory structure
  - Pre-configured specs and docs
  - Ready-to-use prompts

### Changed
- `horizon init` now creates `.horizon/` directory structure (not a single file)
- `horizon upgrade` supports migration from legacy `.horizon` file to directory format
- `horizon upgrade` now supports `--features logger` and `--features migrate`

### Deprecated
- `horizon cursorrules` command - Use `horizon sync cursor` instead (alias kept with warning)

## [0.1.0] - 2026-01-11

### Added
- Project inception
- Architecture planning document
- Monorepo scaffolding
