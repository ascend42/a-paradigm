# Changelog

All notable changes to Paradigm will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [4.15.0] — 2026-03-17

### Added

- **Completion confirmation** — Agent spawner now validates relay output before accepting `success` status. Builders that wrote no files are downgraded to `partial`; any agent with no artifacts, decisions, handoff, or file writes is flagged. Adds `completionVerified` field to `AgentRelay` for observability. Inspired by Open SWE's anti-premature-termination pattern.
- **External ID on session checkpoints** — `SessionCheckpoint` and `paradigm_session_checkpoint` MCP tool now accept optional `externalId` field for deterministic session recovery from external sources (e.g. `"linear:PROJ-123"`, `"github:owner/repo#42"`).
- **Stop hook auto-fix mode** — Set `PARADIGM_AUTO_FIX=1` to auto-fix trivial violations: creates stub `.purpose` files (checks 2 & 9) and stub lore entries (check 7). Reports all auto-fixes taken; real violations still block. All 3 stop hooks (Claude Code, Cursor, `.cursor/hooks/`) updated.

Symbols: #agent-spawner, #agent-provider, #session-tracker, #paradigm-hooks, #paradigm-session-checkpoint

## [4.14.2] — 2026-03-17

### Fixed

- **YAML parser consolidation** — Switched portal/watch.ts from `yaml` package to `js-yaml`. Paradigm CLI now uses js-yaml exclusively.
- **Grep shell quoting** — Portal compliance used `execSync` with regex patterns that broke shell parsing (`syntax error near unexpected token '('`). Switched to `execFileSync` to avoid shell; prefers ripgrep (rg) when available for speed.
- **Instruction vagueness** — Generators (claude.ts, base.ts, cursor.ts): "Avoid if possible" → "Prefer MCP; use sparingly"; "Plan a stopping point" → "Plan handoff; prepare summary when ready". Context-audit: exclude `consider-handoff` from vague-phrase check.

### Changed

- **Portal compliance messaging** — Split "declared but unused" into route-attached (documented on routes, no code) vs orphan (gates section only). Clearer suggestions for each.
- **Instruction files** — CLAUDE.md and AGENTS.md updated with non-vague wording.

Symbols: #doctor, #portal-compliance, #config-schema, #context-audit, #portal-watch

## [4.14.1] — 2026-03-17

### Fixed

- **Doctor: YAML parsing** — Switched doctor from `yaml` package to `js-yaml` (matches rest of codebase). Resolves "Dynamic require of process" errors when validating portal.yaml, flows.yaml, and habits.yaml.
- **Doctor: config schema** — Added `docs` and `features` to KNOWN_TOP_LEVEL_KEYS in config-schema.ts.
- **Doctor: stale-reference heuristic** — Tightened context-audit to skip parameter lists (e.g. `type/tag/symbol`, `approve/deny`) — require file extension, leading dot, or common path prefix.

### Changed

- **Instruction files** — Fixed 41 stale path references in CLAUDE.md and AGENTS.md (example paths, missing .paradigm/ prefix).
- **Fixtures** — Created `.paradigm/fixtures.yaml` from standard template.

### Added

- **Lore** — Recorded agent-session entry (Composer 1.5) with cleanup summary and Paradigm framework reflection.

Symbols: #doctor, #config-schema, #context-audit

## [4.14.0] — 2026-03-17

### Added

- **Conductor Sprint 20: Polish + Cell Footer + Tiling Tests (v1.0.0)** — 2 new Swift files, 2 modified.
  - `CellFooterView.swift` — Per-cell status footer: symbol tags (purple, max 3), file modification count, agent status dot.
  - `TilingEngineTests.swift` — 16 tests: cell count (single/split/nested), frame computation (fills area, horizontal/vertical split totals), preset generation (focused/grid/triple/padding), cell operations (split/remove/swap), ratio update/clamping, divider count.
  - `CellChromeView` gains footer integration, border pulse animation for processing cells (easeInOut 1.2s repeat), dynamic border width for blocked/gaze states.
  - Conductor bumped to **v1.0.0** — workspace container feature-complete.

### Changed

- Test count: 160 → 176 (16 new TilingEngine tests).

Symbols: #cell-footer, #tiling-engine

## [4.13.0] — 2026-03-17

### Added

- **Conductor Sprint 19: Control Panel + Status Bar** — 2 new Swift files, 3 modified.
  - `ControlPanelContainer.swift` — Collapsible 320px overlay panel with 4 tabs: Workspace (session manager + project launch), Orchestrate (task dashboard + agent groups), Monitor (Sentinel live + agent health), Settings (workspace config + Sentinel status).
  - `StatusBarView.swift` — Bottom bar with clickable sections (tasks, Sentinel, health) that open the corresponding control panel tab. Keyboard shortcut hints.
  - `ContainerView` integrates both: control panel as ZStack overlay, status bar replaces inline implementation. Clicking status bar sections opens panel to relevant tab.
  - `AppDelegate` passes full dependency set (projectStore, agentProcessManager, agentGroupStore, symphonyMonitor) to ContainerView.

Symbols: #control-panel-container, #status-bar

## [4.12.0] — 2026-03-17

### Added

- **Conductor Sprint 18: Drag-to-Resize + Presets + Cell Interactions** — 3 new Swift files, 2 modified.
  - `DividerHandle.swift` — Draggable resize handles between cells. Snap at 25/33/50/67/75% with visual feedback. Cursor changes (↔/↕) on hover. Smooth drag with 2px minimum distance.
  - `LayoutPresetsView.swift` — Horizontal preset strip with mini layout diagram icons for each of 6 presets. Active state highlighting with ⌘ shortcut labels.
  - `CellActionMenu.swift` — Context menu for cells: split horizontal/vertical, maximize/restore, close. `EmptyCellView` placeholder with launch button for empty cells.
  - `ContainerView` enhanced: divider drag wiring with ratio-to-pixel conversion, maximize/restore toggle (saves/restores layout tree), animated layout transitions (`easeInOut 0.2-0.25s`), preset strip in header.

Symbols: #divider-handle, #layout-presets, #cell-action-menu

## [4.11.0] — 2026-03-17

### Added

- **Conductor Sprint 17: Container Window + Tiling Engine** — 4 new Swift files, 3 modified.
  - `TilingEngine.swift` — Binary split tree layout engine (`TileNode`, `SplitState`, `CellState`). Recursive frame computation, 6 layout presets (Focused/Split/Main+Side/Grid/Triple/Columns), cell split/remove/swap/ratio operations.
  - `ContainerWindow.swift` — `NSWindow` subclass replacing `NSPanel` for container mode. Full-screen capable, `.fullSizeContentView` style, 800×600 minimum.
  - `ContainerView.swift` — Root SwiftUI view: header bar with preset menu, tiling area with cell chrome overlays, status bar with task/sentinel/health indicators.
  - `CellChromeView.swift` — Per-cell overlay: project label, status badge (idle/implementing/blocked/processing), split/maximize/close action buttons, gaze-targeted border.
  - `AppDelegate` gains `useContainerMode` flag, `launchContainer()`, menu bar "Switch to Container/Sidebar Mode" items.
  - Conductor bumped to v0.16.0.

Symbols: #tiling-engine, #container-window, #container-view, #cell-chrome, $workspace-layout

## [4.10.0] — 2026-03-17

### Added

- **Smart Drift Detection Phase 3: Content Fingerprint Search** — 1 new file, 2 modified.
  - `aspect-fingerprint.ts` (~320 lines) — Levenshtein distance, sliding window search, structural hashing, cross-file rename detection, sibling file search.
  - 4-signal scoring: first/last line match (0.4), structural hash (0.3), Levenshtein similarity ≥0.8 (0.2), line count ±20% (0.1).
  - Thresholds: ≥0.85 auto-relocate, 0.7-0.85 suggest, <0.7 real drift.
  - Cross-file search: `git log --follow --diff-filter=R` for renames, sibling directory scan (max 10 files).
  - Schema migration: `original_content` column on anchors table, `anchor_history` table for audit trail.
  - `materializeAspects()` now stores normalized content snapshot for each anchor at materialization time.
  - `checkDrift()` Layer 3: after Layers 1-2 fail, searches for relocated content via fingerprint, auto-heals ≥0.85 matches, records history.

### Changed

- `computeAnchorHash()` now returns `normalizedContent` alongside hashes for Phase 3 storage.
- `AnchorRow` type gains `original_content: string | null` field.
- `DriftResult` type gains `suggestedPath` field for cross-file relocations.

Symbols: #aspect-fingerprint, $content-search-flow

## [4.9.0] — 2026-03-17

### Added

- **Site Content & Polish** — docs guides, course pages, PLSAT landing, and docs UX improvements.

  **Docs Content Depth** — 4 new handwritten guide pages:
  - Portal & Gates — portal.yaml structure, gate patterns, route mapping
  - Flows — flow definition, step types, validation, visualization
  - CLI Reference — complete command reference organized by category
  - MCP Tools Reference — all 50+ tools with token budget estimates

  **Docs Polish** — 3 UX improvements:
  - Breadcrumbs on all docs pages (Docs > Components > PaymentService)
  - Client-side search input in sidebar with instant filtering
  - Code block language badges (yaml, bash, typescript labels)

  **Learn Section — Dynamic Course Pages**:
  - `/learn/course/[courseId]` — course detail with numbered syllabus
  - `/learn/course/[courseId]/lesson/[lessonId]` — full lesson content with markdown, key concepts, quiz questions, and prev/next navigation
  - `course-data.ts` — server-side loader reading from university + site content packages
  - 68 lesson pages pre-rendered at build time across 7 courses

  **PLSAT Landing Page** (`/learn/plsat`):
  - Exam overview: 99 questions, 90 minutes, 80% pass threshold
  - Coverage grid showing 5 PARA course domains
  - Preparation guide and CLI launch instructions
  - Updated learn page: v3.0 stats (99 questions, 80% pass)

  **Project Health** — all doctor recommendations resolved:
  - 330 untyped components → 0 untyped (types added across 16 .purpose files)
  - 10 stale protocols → 0 stale (all 37 refreshed)
  - 2 YAML errors in conductor .purpose files fixed (unquoted colons + !signals)
  - .purpose files added for all new docs directories
  - Scan index rebuilt: 942 symbols, 0 untyped

  **1276 static pages** generated at site build time (up from 983).

Symbols: #DocsSidebar, #SymbolPage, #FlowPage, #PortalPage, #ContentPage, #course-data

## [4.8.0] — 2026-03-17

### Added

- **Personas CLI** — 7 commands closing the CLI gap (11 MCP tools existed, 0 CLI).
  - `paradigm persona list` — List all personas with `--tag`, `--trigger`, `--gate` filters.
  - `paradigm persona show <id>` — Full detail: traits, fixtures, journey steps with gates/routes/produces/spawns.
  - `paradigm persona validate [<id>]` — Schema validation + cross-refs (gates vs portal.yaml, spawn targets).
  - `paradigm persona coverage` — Coverage report from persona index (gate/route coverage, uncovered routes).
  - `paradigm persona run <id> --base-url <url>` — Execute journey against running server with template interpolation. `--dry-run` mode.
  - `paradigm persona affected <symbol>` — Which personas reference a gate, flow, or signal.
  - `paradigm persona delete <id>` — Delete with spawn-chain warnings.

Symbols: #persona-cli

## [4.7.0] — 2026-03-17

### Added

- **Paradigm Docs — Auto-Generated Documentation from the Symbol Graph** — 40+ new files across 7 phases.

  **Phase 0: University Extracurricular System**
  - `track`, `excludeFromOnboarding`, `validationStrictness` fields on `UniversityContentCategory`
  - `category` field on `UniversityFrontmatter`, `UniversityQuiz`, `LearningPath`, `UniversityIndexEntry`, `UniversityFilter`
  - `paradigm_university_search` gains `category` and `track` filter params
  - `paradigm_university_create` and `update` gain `category` param
  - `paradigm_university_onboard` response includes `extracurricular` suggestions array
  - `.paradigm/university/config.yaml` seeded with 4 categories (paradigm-core, paradigm-advanced, extracurricular, paradigm-docs)
  - Site `/learn` page migrated from `nonCredit` to `category: 'extracurricular'` with visual grouping

  **Phase 1: Docs Data Layer**
  - `docs-loader.ts` — reads scan-index, flow-index, portal.yaml, university, and custom markdown pages
  - `types/docs.ts` — `DocsManifest`, `SymbolPageData`, `FlowPageData`, `PortalPageData`, `CustomPageData`, `SearchResult`
  - Sidebar manifest with auto-grouped components by type, flows, gates, signals, aspects, portal
  - Full-text search with relevance scoring across symbols, descriptions, tags, and custom pages
  - `docs` config section in `.paradigm/config.yaml` (enabled, title, theme, exclude, sidebar, output)

  **Phase 2: MCP Tools + Platform API**
  - 3 new MCP tools: `paradigm_docs_manifest`, `paradigm_docs_page`, `paradigm_docs_search`
  - 6 REST endpoints: `/api/docs/manifest`, `/api/docs/symbol/:id`, `/api/docs/flow/:id`, `/api/docs/portal`, `/api/docs/page/:slug`, `/api/docs/search`

  **Phase 3: Platform UI Docs Section**
  - New "docs" section in Platform with `☰` sidebar icon
  - Two-pane layout: 260px collapsible sidebar + scrollable content area
  - 10 components: `DocsSidebar`, `DocsSymbolPage`, `DocsFlowPage`, `DocsPortalPage`, `DocsCustomPage`, `DocsSearch`, `SymbolLink`, `PropertyTable`, `FlowSteps`, `GateChain`
  - Zustand store with manifest, page selection, search, and sidebar collapse state
  - Symbol-colored prefixes (#, $, ^, !, ~) and cross-reference navigation

  **Phase 4: CLI Commands**
  - `paradigm docs serve` — launches Platform with docs section (port 3850, opens browser)
  - `paradigm docs build` — static export with pre-fetched JSON data for all pages

  **Phase 5: Site Integration (useparadigm.dev)**
  - `docs-data.ts` — server-side data layer reading scan-index at Next.js build time
  - Dynamic `[[...slug]]` route with `generateStaticParams` pre-rendering 975+ pages
  - 6 site components: `DocsSidebar`, `SymbolPage`, `FlowPage`, `PortalPage`, `CategoryListPage`, `ContentPage`
  - 3 handwritten guides: Getting Started, The Five Symbols, Purpose Files

  **Phase 6: University Content**
  - `N-paradigm-docs-overview` — note covering data sources, CLI, MCP tools, configuration
  - `Q-paradigm-docs-basics` — 5-question quiz on docs system fundamentals
  - `LP-paradigm-docs` — learning path: overview note → basics quiz

Symbols: #DocsLoader, #DocsTools, #DocsCommands, #DocsSection, $docs-generation, !docs-generated

## [4.6.0] — 2026-03-17

### Added

- **Automation Tier Graduation — Phase 1+2: Engine, MCP Tools, CLI** — 7 new files, 7 modified.
  - Full spec at `docs/specs/automation-graduation.md` covering the 3-tier system (MCP → Habits → Hooks), graduation engine, demotion, and token savings projections.
  - `graduation-types.ts` — `GraduationState`, `GraduationConfig`, `GraduationTier`, `GraduationCheckResult`, `NON_GRADUATABLE_CHECK_TYPES` (tool-called, context-checked can never graduate).
  - `graduation-store.ts` — YAML read/write for `.paradigm/graduation.yaml`, state accessors, mutations, 30s cache.
  - `.paradigm/graduation.yaml` — Seed with 5 retroactively graduated habits and 7 never-graduate habits.
  - `paradigm graduate status` CLI — Shows habits by tier (hook/habit/mcp) with graduation dates, locks, savings.
  - `habits-loader.ts` skips graduated habits during evaluation, reports skip count.
  - `habits.ts` MCP response includes `graduatedToHooks` count when habits are skipped.
  - Post-write hook gains pseudo-session-start and context budget heuristic (warns at 30+ edits).
  - Stop hook cleans `.paradigm/.session-started` marker.
  - `graduation-engine.ts` — Core eligibility logic: queries practice events, checks compliance rate (90%+, 20+ events, 30d window, 5 consecutive sessions, 7d recency), `NON_GRADUATABLE_CHECK_TYPES` enforcement.
  - `graduation.ts` MCP tools — `paradigm_graduate_check` (eligibility with compliance data), `paradigm_graduate_status` (tier map + savings).
  - `paradigm graduate promote <id>` / `paradigm graduate demote <id>` CLI — Force-graduate or demote with configurable cooldown.
  - Hook source files (`src/commands/hooks/scripts/*.sh`) updated with session-start marker and context heuristic; propagated via `generate-hooks.mjs`.
  - `paradigm-common.sh` Check 12: Graduation failure tracking — maps stop-hook violations to graduated habits, writes failure timestamps, emits advisory near demotion threshold.
  - `claude-code-stop.sh`: Auto-demotion loop — after compliance checks, scans `.graduation-failures/`, calls `paradigm graduate demote` on habits with 3+ failures.
  - `CLAUDE.md` updated: removed redundant `paradigm_pm_postflight` guidance (stop hook handles it), added graduation tools to MCP workflow table, Check 13 in enforcement table, context monitoring now hook-driven.

### Changed

- 5 of 13 seed habits now enforced by hooks only — MCP evaluation skipped. ~750 tokens/session saved.
- `paradigm_pm_postflight` no longer recommended for Claude Code sessions (stop hook covers same checks).
- Context monitoring: post-write hook warns at 30+ edits (replaces manual `paradigm_context_check` polling).
- Stop hook compliance checks expanded from 11 to 13 (Check 12: graduation failures, Check 13: agent permissions).

Symbols: #graduation-types, #graduation-store, #graduation-engine, #graduation-tools, #graduation-cli, $graduation-flow, !habit-graduated, !habit-demoted

## [4.5.0] — 2026-03-17

### Added

- **Conductor Sprint 14: Task Lifecycle Completion + Cleanup** — 2 new Swift files, 5 modified.
  - `TaskArchive.swift` — `TaskArchiveEntry` struct + `TaskArchiveIO` enum: archive/load/count to `~/.paradigm/conductor/tasks-archive.jsonl` JSONL.
  - `TaskStore` gains `cancelTask(id:)`, `reassignTask(id:to:sendNote:)`, `archiveCompleted(olderThan:)`, `pruneCompleted()`, `archivedCount`.
  - `TaskDetailView` gains Cancel Task (with `.confirmationDialog`), Re-assign (agent picker sheet), and View Thread action buttons.
  - `TaskDashboardView` gains archive badge in header, Menu with "Archive Older than 7d" and "Archive All Completed" actions, and `onSendNote` callback.
  - `MainOverlayView` wires note-sending closure to TaskDashboardView using ScoreIO.appendJsonl.
  - New timeline icon/color for "cancelled" (xmark.circle, orange) and "reassigned" (arrow.triangle.swap, cyan).

- **Conductor Sprint 15: Active Sentinel + Event Correlation** — 3 new Swift files, 4 modified.
  - `SentinelEventDetailView` — Popover for single event: full timestamp, level/type badges, copyable symbol, metadata key-value pairs, related tasks with status pills.
  - `SentinelSymbolFilterView` — Horizontal ScrollView of clickable symbol chips. "All" chip + top 10 symbols by frequency. Purple capsule style with toggle selection.
  - `SentinelWSClient` gains `metadata: [String: String]?` on events, `@Published activeSymbols`, `symbolCounts` tracking, `events(forSymbol:)` filter, `clearBuffer()`, and `Hashable` conformance on `SentinelEvent`.
  - `SentinelLiveView` enhanced: symbol filter bar, clickable symbol text in event rows, `.popover` with event detail + related tasks, "Clear" button, filtered/total count.
  - `MainOverlayView` passes `taskStore` to SentinelLiveView for related task lookup.

- **Conductor Sprint 16: View Decomposition + Polish** — 7 new Swift files, 2 modified.
  - `Bindings/` subdirectory with 6 extracted views: `CustomGestureBindingsView`, `VoiceCommandBindingsView`, `BuiltInGestureBindingsView`, `EyebrowBindingsView`, `HotkeyBindingsView`, `ActionPickerViews` (shared free functions).
  - `BindingsManagerView` slimmed from 302 lines to ~44 lines — composes 5 sub-views via Form.
  - `MainOverlayView.mainContent` decomposed into 12 named computed properties: `calibrationSection`, `inputSection`, `bufferSection`, `sessionSection`, `workspaceSection`, `symphonyNotificationsSection`, `taskSection`, `agentNetworkSection`, `agentHealthSection`, `sentinelSection`.

- **18 new tests** across 4 test files:
  - `TaskStoreTests` +6: cancelTask, cancelCompletedIsNoOp, reassignTask, archiveCompleted, pruneCompleted, archivedCount.
  - `TaskArchiveTests` (3): archiveAndLoad, archiveAppends, archiveCountMatchesLoad.
  - `SentinelWSClientTests` +5: activeSymbolsTracking, clearBuffer, eventsForSymbol, metadataFieldParsed, symbolFrequencyOrder.
  - `SentinelFilterTests` (3): symbolFilterReturnsMatching, symbolFilterEmptyForUnknown, clearResetsEverything.
  - `BindingsDecompositionTests` (1): compile-check verifying all sub-views instantiate.

- **University Extracurricular System (Phase 0)** — category-based content organization with core/extracurricular tracks.
  - `UniversityContentCategory` gains `track`, `excludeFromOnboarding`, and `validationStrictness` fields.
  - `UniversityFrontmatter`, `UniversityQuiz`, `LearningPath`, and `UniversityIndexEntry` gain optional `category` field.
  - `UniversityFilter` gains `category` and `track` filter params.
  - `UniversityConfig.content` gains `defaultCategory` field.
  - `searchContent()` filters by `category` (direct match) and `track` (resolved via config category definitions).
  - `getOnboardingSequence()` excludes categories with `excludeFromOnboarding: true` from core suggestions; populates new `extracurricular` array in response.
  - `rebuildUniversityIndex()` includes `category` from frontmatter/quiz/path in index entries.
  - `validateUniversityContent()` is category-aware for validation strictness.
  - MCP tools `paradigm_university_search`, `paradigm_university_create`, and `paradigm_university_update` accept `category` param. Search tool accepts `track` param.
  - Onboarding response now includes `extracurricular` content array.
  - Site learn page migrated from `nonCredit` to `category: 'extracurricular'` with separate "Core Curriculum" and "Extracurricular" sections.
  - Default university config seeded at `.paradigm/university/config.yaml` with 4 categories.

### Changed

- Conductor bumped to 0.15.0 (from 0.12.0).
- `SentinelWSClient.handleMessage` changed from private to internal for testability.
- `SentinelEvent` now conforms to `Hashable` (needed for `.popover(item:)`).

Symbols: #task-archive, #sentinel-event-detail, #sentinel-symbol-filter, #custom-gesture-bindings, #voice-command-bindings, #builtin-gesture-bindings, #eyebrow-bindings-view, #hotkey-bindings-view, #action-picker-views, #UniversityTools, #UniversityLoader, $task-archive, $sentinel-investigation, $university-flow, !task-cancelled, !task-reassigned, !tasks-archived

## [4.4.0] — 2026-03-16

### Added

- **Conductor Sprint 11: Task Dashboard + Progress Tracking** — 3 new Swift files, 5 modified.
  - `TaskRecord.swift` — `TaskStatus` enum (7 states), `TaskTimelineEvent`, `TaskRecord` struct, `TaskStore` (@MainActor ObservableObject) with persistence to `~/.paradigm/conductor/tasks.json`.
  - `TaskDashboardView` — Kanban-style sidebar dashboard with 4 columns (Active, Blocked, Awaiting Approval, Complete). Priority filter, task cards with progress bars and assignee badges.
  - `TaskDetailView` — Full task detail sheet: scope, acceptance criteria, timeline with SF Symbol icons, files modified, symbols touched, blockers, external references. Includes custom `FlowLayout` for symbol tags.
  - `SymphonyMonitor` now routes task-intent notes (`taskAck`, `progress`, `approvalRequest`, `taskComplete`, `taskFailed`) to `TaskStore.handleNote()` with dedup tracking.
  - `TaskComposerView` calls `taskStore.addTask()` after writing notes to inboxes.
  - `AgentNetworkView` shows active task count per agent in agent rows.

- **Conductor Sprint 12: Sentinel Live View + Agent Health** — 3 new Swift files, 5 modified.
  - `AgentHealthMonitor` — Computes per-agent `AgentMetrics` (tasksCompleted, tasksFailed, successRate, avgCompletionTimeMs, recentOutcomes) from TaskStore via Combine subscription. Health thresholds: healthy (>80%), degraded (50-80%), unhealthy (<50%).
  - `SentinelLiveView` — Collapsible real-time event viewer: connection indicator + reconnect button, text search + level filter (All/Info/Warn/Error), auto-scroll toggle, event count footer.
  - `AgentHealthView` — Aggregate header (total tasks, overall success rate, best performer) + per-agent cards with health status dot, success rate circle, sparkline (recent outcomes).
  - `SentinelWSClient` gains `@Published recentEvents: [SentinelEvent]` (200-event buffer), `level` field on `SentinelEvent`, and `Identifiable` conformance.
  - `SettingsPanelView` gains "Monitoring" tab: Sentinel URL field, auto-connect toggle, event buffer display.
  - `AgentNetworkView` uses agent health status for dot colors (green/yellow/red).

- **Conductor Sprint 13: User-Customizable Bindings** — 3 new Swift files, 5 modified.
  - `EyebrowBindingRegistry` — `EyebrowEventKind` enum (4 cases, CaseIterable), user-customizable eyebrow event→action bindings, `useStateMachine` toggle (default true), CRUD + UserDefaults persistence.
  - `HotKeyBindingRegistry` — User-customizable `HotKeyBinding→ConductorAction` bindings with defaults matching existing hardcoded mappings. Serialization via `"keyCode:modifiers.rawValue"` keys.
  - `HotKeyRecorder` — NSView-based key combination capture (becomeFirstResponder, keyDown) with SwiftUI `NSViewRepresentable` wrapper.
  - `BindingsManagerView` — Fully wired with 5 sections: Custom Gestures, Voice Commands, Built-in Gesture Overrides (per-gesture Picker), Eyebrow Bindings (state machine toggle + event→action pickers), Hotkey Bindings (list + HotKeyRecorder + add/remove).
  - `HotKeyManager` gains `registerFromRegistry()` + `observeRegistry()` for live Combine-based binding updates.
  - `InputOrchestrator` checks `eyebrowBindingRegistry` before falling through to state machine.
  - `AppDelegate` refactored: `setupHotKeys()` uses `hotKeyManager.observeRegistry()` instead of hardcoded registrations.

- **35 new tests** across 5 test files:
  - `TaskStoreTests` (10): addTask, handleAck/progress/approval/complete/failed, timeline accumulation, filesModified union, computed properties, unknown taskId ignored.
  - `AgentHealthMonitorTests` (11): empty metrics, single completed, mixed outcomes, healthy/degraded/unhealthy thresholds, multi-agent task, recentOutcomes cap, bestPerformer, avgTime, unknown status.
  - `SentinelWSClientTests` (4): initial state, buffer limit, event identifiable, event level field.
  - `EyebrowBindingRegistryTests` (6): defaults empty, set/remove/reset, all event kinds, stateMachine flag.
  - `HotKeyBindingRegistryTests` (5): default bindings, set/remove/reset, binding count.

### Changed

- `ActionRegistry.gestureBindings` is now publicly settable (was `private(set)`) to support BindingsManagerView overrides.
- Conductor bumped to 0.12.0.

Symbols: #task-record, #task-store, #task-dashboard-view, #task-detail-view, $task-tracking, !task-status-changed, #agent-health-monitor, #sentinel-live-view, #agent-health-view, $agent-health-tracking, !agent-health-changed, #eyebrow-binding-registry, #hotkey-binding-registry, #hotkey-recorder, ~user-configurable

## [4.3.0] — 2026-03-16

### Added

- **Conductor Sprint 10: Task Protocol + Maestro Delegation** — 3 new Swift files, 1 new TS file, 5 modified.
  - **Task Protocol** — 7 new Symphony message intents: `task`, `task-ack`, `progress`, `approval-request`, `approval-response`, `task-complete`, `task-failed`. Wire-compatible payload types in both TypeScript (`symphony-loader.ts`) and Swift (`SymphonyTypes.swift`).
  - `TaskComposerView` — Structured task assignment UI: scope, acceptance criteria, priority, external ref. Writes task intent notes to target agent Symphony inboxes.
  - `ApprovalView` — Notification UI for agent approval requests. Shows summary, modified files, diff preview. Maestro responds with approve/reject/redirect + feedback.
  - `ApprovalNotificationBanner` — Scans monitor for pending approval-request notes and surfaces them in the overlay.
  - `task-protocol.ts` — Agent-side protocol prompt generator. Prepended to agent context when a task is received, instructing ack → work → progress → approval → complete workflow.

### Changed

- `paradigm_symphony_send` enum now includes all 7 task protocol intents.
- `MessageMetadata` gains `task`, `progress`, `approvalRequest`, `approvalResponse` payload fields (TS + Swift).
- `AgentNetworkView` gains "Send Task" action on group menus.
- `MainOverlayView` shows `ApprovalNotificationBanner` for pending approval requests.
- `ThreadView` intent color switch handles all task protocol intents.
- Conductor bumped to 0.9.0.

Symbols: #task-composer-view, #approval-view, $task-lifecycle

## [4.2.0] — 2026-03-16

### Added

- **Conductor Sprint 9: Agent Groups + Network View** — 4 new Swift files, 3 modified.
  - `AgentGroup` + `AgentGroupStore` — Named cross-project agent groups persisted to `~/.paradigm/conductor/groups.json`. CRUD, color-coding, drag-between-groups.
  - `SymphonyMonitor` — Polls Symphony inboxes/outboxes for grouped agents at 5s interval. Tracks unread counts, last activity, active thread IDs, and indexes thread messages.
  - `AgentNetworkView` — Primary orchestration dashboard: group panels with agent status badges (running/linked/offline), unread counts, thread access, add/remove agents, stop-group.
  - `ThreadView` — Chat-like Symphony thread viewer with message compose. Conductor sends messages as "Maestro" (human participant) directly into agent inboxes.

### Changed

- `MainOverlayView` shows `AgentNetworkView` when groups or registered agents exist, falls back to `ThreadListView` otherwise.
- `AppDelegate` owns `AgentGroupStore` + `SymphonyMonitor` (single-owner pattern).
- Symphony monitor starts polling grouped agents on app launch.
- Conductor bumped to 0.8.0.

Symbols: #agent-group, #agent-group-store, #symphony-monitor, #agent-network-view, #thread-view, $group-link

## [4.1.0] — 2026-03-16

### Added

- **Conductor Sprint 8: Session Manager + Agent Launcher** — 5 new Swift files, 3 modified.
  - `ProjectStore` — Recent project persistence at `~/.paradigm/conductor/recent-projects.json` with pin/sort, survives reinstall.
  - `CheckpointReader` — Reads `.paradigm/session-checkpoint.json` and pending handoff files (wire-compatible with paradigm-mcp `SessionCheckpoint`).
  - `AgentProcessManager` — Spawns headless `claude` child processes via `Process` API with stdin/stdout/stderr piping and lifecycle control.
  - `SessionManagerView` — Dashboard showing project cards with checkpoint phase/context, running agent list with log viewer.
  - `SessionsSettingsView` — Settings tab for default agent role, auto-launch toggle, agent management.

### Changed

- Conductor `AppDelegate` now owns `ProjectStore` + `AgentProcessManager` (single-owner pattern).
- `MainOverlayView` embeds `SessionManagerView` between buffer and workspace sections.
- `SettingsPanelView` gains a "Sessions" tab for agent configuration.
- Conductor bumped to 0.7.0.

Symbols: #project-store, #checkpoint-reader, #agent-process-manager, #session-manager-view, #sessions-settings, $session-launch

## [4.0.0] — 2026-03-16

### Added

- **Response Format Parameter** — Optional `response_format: 'concise' | 'detailed'` on high-traffic tools (`paradigm_search`, `paradigm_ripple`, `paradigm_status`, `paradigm_gates_for_route`, `paradigm_navigate`, `paradigm_agent_expertise`). Concise mode strips secondary data to save tokens. Default `'detailed'` preserves backward compatibility.
- **Dynamic Tool Loading** — `tool-registry.ts` with tiered system (core/feature/advanced). Feature-tier tools auto-detect from filesystem (e.g., `.paradigm/lore/` enables lore tools). `paradigm_tool_activate` enables on-demand advanced tools.
- **Agent Notebooks** — Curated snippet libraries distilled from lore. Storage at `~/.paradigm/notebooks/{agent-id}/` (global) and `.paradigm/notebooks/{agent-id}/` (project). 3 MCP tools: `paradigm_notebook_search`, `paradigm_notebook_add`, `paradigm_notebook_promote`. CLI: `paradigm notebook list|show|export`. Notebook entries enriched into orchestration prompts via `buildProfileEnrichment`.
- **Agent Permission Scoping** — `AgentPermissions` interface on `.agent` profiles with `paths` (read/write/deny globs), `tools` (allow/deny patterns), `dangerous_actions`. SHA-256 integrity hashing (`integrityHash`) with tamper detection via `verifyIntegrity()`. Permissions surfaced in orchestration prompts as constraints. `paradigm agent create --deny-paths` CLI option. Stop hook Check 12 (advisory).
- **Automated Review Pipeline** — `paradigm review` CLI with two-stage protocol. Stage 1: spec compliance (purpose coverage, portal gates, aspect anchors, broken refs). Stage 2 (`--deep`): code quality (eval, hardcoded secrets, console.log). Supports `--pr <number>`, `--ci` (exit 1 on blocking), `--json`. Shared logic extracted into `compliance-checker.ts`.

### Changed

- Rebranded from "Structured AI Context" to "The Context Engineering Framework".
- `buildProfileEnrichment()` now accepts optional `notebookEntries` parameter for orchestration enrichment.
- Orchestration prompts include permission constraints when agent has `permissions` set.
- `paradigm_agent_get` now returns `permissions` and `integrity` status in response.
- `paradigm agent show` displays permissions section.
- `paradigm-common.sh` now includes Check 12 (agent permission compliance advisory).
- Both packages bumped to 4.0.0 (`@a-company/paradigm`, `@a-company/paradigm-mcp`).

### Breaking

- Major version bump: 3.47.0 → 4.0.0. No breaking API changes — all new features are additive with backward-compatible defaults. The major bump signals the strategic rebranding to Context Engineering Framework.

Symbols: #tool-registry, #agent-notebooks, #agent-permissions, #compliance-checker, #review-pipeline, $review-flow

## [3.47.0] — 2026-03-16

### Added

- **Agent Identity Files (Phase 0)** — Persistent `.agent` YAML profiles that track expertise, personality, and cross-project patterns. Stored globally (`~/.paradigm/agents/`) or per-project (`.paradigm/agents/`), with project overriding global.
- **3 MCP Tools** — `paradigm_agent_list` (~150 tokens), `paradigm_agent_expertise` (~100 tokens), `paradigm_agent_get` (~200 tokens) for querying agent profiles and symbol-to-agent routing.
- **4 CLI Commands** — `paradigm agent list`, `paradigm agent show <id>`, `paradigm agent create <id>`, `paradigm agent sync <id>` for managing .agent identity files.
- **Expertise Auto-Update** — When lore is recorded, the relevant agent's per-symbol expertise scores update via exponential moving average (70/30 weight). Assessment verdicts also feed into expertise.
- **Orchestration Enrichment** — `paradigm_orchestrate_inline` and `paradigm_agent_prompt` now prepend personality preferences and relevant expertise to agent prompts when `.agent` profiles exist.

### Changed

- **Lore recording** — After `paradigm_lore_record`, auto-updates agent expertise if `PARADIGM_AGENT_ID` is set in the environment.
- **Lore assessment** — After `paradigm_lore_assess`, nudges agent expertise confidence toward the verdict score.
- **Orchestration prompts** — `buildAgentPromptInternal` accepts optional `profileEnrichment` text prepended before role prompt.

Symbols: #agent-loader, #agent-tools, #agent-types, #AgentCommands, !agent-created, !agent-synced, !expertise-updated, $agent-expertise-flow

## [3.46.0] — 2026-03-15

### Added

- **Symphony Phase 1: Cross-Machine Networking** — WebSocket relay for multi-machine agent communication. Hub-and-spoke topology: `paradigm symphony serve` runs the hub, `paradigm symphony join --remote <ip>` connects spokes. Messages bridge transparently between local JSONL mailboxes.
- **Pairing Security** — 6-digit pairing codes with HMAC-SHA256 challenge-response authentication. Codes rotate every 5 minutes. 3 failed auth attempts from same IP triggers 60s cooldown. Peer secrets stored in `~/.paradigm/score/peers.json` (mode 0600).
- **`paradigm symphony peers`** — Peer trust management CLI: `peers list`, `peers revoke <id>`, `peers forget --force`.
- **Auto-reconnect** — Client mode reconnects with exponential backoff (1s → 30s max) when the hub drops.
- **Internet Direct Connect** — `paradigm symphony serve --public` displays a connection string with embedded pairing code. `paradigm symphony join --remote <ip>:3939#847291` skips interactive prompt.
- **Remote agent visibility** — `paradigm symphony list` shows remote agents with `(remote: peer-name)` tag. `paradigm symphony status` shows peer count and remote agent count.
- **MCP `paradigm_symphony_status`** — Now includes `peers` array with id, address, agent count, and lastSeen for each connected peer.
- **Platform REST `GET /api/symphony/peers`** — Returns trusted peer list for the Platform UI network tab.
- **Outbox watcher** — Relay polls local outboxes every 2s, forwarding new messages to all connected peers. Dedup via bounded message ID set (max 10,000).
- **Keepalive** — Ping/pong every 30s with 10s timeout. Dead connections auto-terminated.

### Changed

- **`symphonyServeCommand`** — Upgraded from Phase 0 TCP stub to full WebSocket relay server with pairing code display, code rotation, and peer event logging.
- **`symphonyJoinCommand`** — Remote path now connects via WebSocket relay with HMAC authentication (previously logged "not yet implemented").
- **`symphonyListCommand`** — Shows remote agents from trusted peers below local agents section.
- **`symphonyStatusCommand`** — Includes peer connection info (count, addresses, agent totals).
- **`SymphonyMessage`** — Added optional `origin?: string` field for relay provenance tracking.
- **`SCORE_DIR`** — Now exported from `symphony-loader.ts` for use by relay and peers modules.

Symbols: #symphony-relay, #symphony-peers, #symphony-serve, #symphony-peers-revoke, #symphony-peers-forget, !peer-connected, !peer-disconnected

## [3.45.0] — 2026-03-15

### Added

- **Symphony Platform Section** — Live agent-to-agent communication dashboard replacing the "Coming Soon" placeholder, with 3 sub-tabs: Threads, Network, and Files.
- **Symphony REST routes** — `createSymphonyRouter()` factory at `/api/symphony/*` with 9 endpoints: agents (list + me), threads (list + detail + resolve), messages (send + inbox), file requests (list + action), and aggregated status.
- **Thread-first UX** — Two-panel Threads tab with sidebar (status filter, thread cards with participant avatars) and conversation view (chronological messages, auto-scroll, intent color-coding by category).
- **Human compose box** — Input at the bottom of every thread with intent selector dropdown and Enter-to-send, allowing humans to participate directly in agent conversations from the browser.
- **Network tab** — Agent grid with awake/asleep status indicators (green pulse animation), last-poll timestamps, and 5 aggregate stat cards.
- **Files tab** — File request list with Approve / Approve (redacted) / Deny action buttons, deny-reason input, urgency badges, and status filtering.
- **Real-time WS forwarding** — `symphony:message` and `symphony:thread_resolved` events broadcast from server and forwarded via CustomEvent to the symphony store for live updates.
- **Polling** — 3s poll for active thread, 10s poll for thread list + network + status, 10s poll for file requests when files tab active.
- **Intent color map** — 6 color categories matching the Symphony spec: dialogue (blue), action (component), outcome (orange), system (red), lifecycle (aspect), transfer (green).
- **SymphonyStore** — Zustand store managing agents, threads, messages, file requests, network status, and WS message handling.
- **Agent status blurb** — Agents can now broadcast a short description of their current work (e.g., "Implementing auth middleware — 3 files modified") via the `status` param on `paradigm_symphony_poll`. Visible in Platform UI Network tab (blue-accented card), CLI `symphony list/status/whoami`, and `paradigm_symphony_status` MCP tool response.
- **`updateAgentStatus()`** — Standalone loader function to update an agent's status blurb without a full poll cycle.
- **`paradigm symphony watch`** — Zero-token real-time inbox monitor. Pure file-system polling (2s default) with intent color-coding, thread filtering, and new-thread detection. No AI tokens consumed — replaces `/loop paradigm_symphony_poll` for passive monitoring. Options: `--interval <ms>`, `--thread <id>`, `--quiet`.
- **`paradigm_symphony_peek`** — Ultra-cheap MCP tool for near-free agent monitoring. File stat only — no JSONL parsing, no message reading. Returns `{ hasNew: true/false }`. Use with `/loop 10s paradigm_symphony_peek` (~$0.04/hr). When `hasNew` is true, agent calls full `paradigm_symphony_poll` to read and respond. Includes heartbeat + status blurb support.

### Changed

- **Platform server** — Symphony routes mounted after sentinel bridge when symphony section is enabled.
- **WS message forwarding** — `useAgentEffects` now dispatches `symphony-ws` CustomEvents alongside existing `sentinel-ws`.
- **App.tsx** — `SymphonySection` lazy-loaded, replacing `ComingSoonSection` for symphony.
- **`markAgentPollTime()`** — Now accepts optional `statusBlurb` parameter, written alongside the heartbeat timestamp.

Symbols: #SymphonyRouter, #SymphonySection, #SymphonyStore, #ThreadsTab, #NetworkTab, #FilesTab

## [3.43.0] — 2026-03-15

### Added

- **Sentinel Platform Section** — Sentinel observability is now embedded as a native Platform section with 4 sub-tabs (Logs, Incidents, Events, Flows), eliminating the need to run a separate sentinel server for observability.
- **Sentinel Bridge** — `sentinel-bridge.ts` dynamically imports `@a-company/sentinel/server`, initializes storage + builtin schemas, and mounts all 12 route factories under `/api/sentinel/*` with auth + rate limiting.
- **Real-time WS forwarding** — Platform WS now forwards `sentinel:log`, `sentinel:flow_event`, and `sentinel:event` messages to the browser via CustomEvent, enabling live log streaming and flow activity visualization without a separate WebSocket connection.
- **4 Zustand stores** — `sentinelLogsStore`, `sentinelIncidentsStore`, `sentinelEventsStore`, `sentinelSchemasStore` ported from Sentinel UI with `/api/sentinel/` prefix and WS message handlers replacing direct WebSocket connections.
- **4 tab components** — `LogsTab` (resizable columns, context menu exclusions, live streaming), `IncidentsTab` (status filter, detail panel, resolve action), `EventsTab` (schema selector, scope navigator, category filters), `FlowsTab` (flow cards with live activity dots, flow diagram, flow composer).
- **Sentinel CSS** — ~1000 lines of sentinel styles mapped to Platform design tokens (`--p-*`), scoped under `.sentinel-section` to prevent collisions.

### Changed

- **Sentinel package exports** — Added re-exports for all route factories, middleware, storage, config, builtin schemas, and option types from `@a-company/sentinel/server`.
- **Platform server** — Sentinel routes mounted before `httpServer.listen()` when sentinel section is enabled. Server initialization restructured to support async sentinel bridge setup.

Symbols: #SentinelBridge, #SentinelSection, #SentinelLogsStore, #SentinelIncidentsStore, #SentinelEventsStore, #SentinelSchemasStore, #LogsTab, #IncidentsTab, #EventsTab, #FlowsTab

## [3.42.0] — 2026-03-15

### Added

- **Overview Dashboard** — `GET /api/platform/overview` aggregates project info, symbol counts (by type), lore stats, calibration score, task counts, 5 health metrics, and a merged recent-activity feed (git commits + lore entries). Overview section upgraded with 6 stat cards, 5 health progress bars, and scrollable activity feed. Stat cards navigate to relevant sections on click.
- **Git Management Section** — Full git workflow from the browser via 8 new endpoints (`/api/git/status`, `branches`, `log`, `diff`, `stage`, `unstage`, `commit`, `push`). Browser UI includes branch bar with ahead/behind badges, file list with stage/unstage buttons, CSS-only colored diff viewer with line numbers, commit composer with symbol autocomplete on `#$^!~` triggers, and paginated commit log with symbol badges.
- **Git section in sidebar** — `git` added to always-on sections, accessible via `⎇` icon in sidebar nav.

### Changed

- **Overview section** — Rewritten from minimal 2-card layout to full health dashboard backed by dedicated `/api/platform/overview` API.
- **Shell CSS** — Overview styles moved to dedicated `overview.css` for code-split loading.

Symbols: #OverviewHandler, #OverviewStore, #OverviewSection, #GitRouter, #GitSection, #GitStore

## [3.41.0] — 2026-03-15

### Added

- **Agent-Driven UI** — AI agents can now drive the Platform browser UI in real-time via 5 new MCP tools, turning the interaction model from "agent responds to text" into "agent and human share a workspace."
- **MCP tools** — `paradigm_platform_navigate` (switch sections, select symbols), `paradigm_platform_highlight` (pulsing glow on symbols), `paradigm_platform_annotate` (toasts, callouts, badges), `paradigm_platform_observe` (read current UI state), `paradigm_platform_clear` (remove agent effects).
- **WebSocket infrastructure** — Platform server now supports WebSocket on `/ws` for real-time agent→browser communication. Uses same pattern as Sentinel WS server.
- **Agent command route** — `POST /api/platform/agent-command` receives MCP commands and broadcasts to all connected browsers.
- **AgentPresenceManager** — Tracks connected agents by ID, auto-prunes stale agents after 2min idle, deterministic color from agent ID hash.
- **UserStateTracker** — Accumulates user activity (section, symbol, theme) for the `observe` tool.
- **Platform bridge** — HTTP helper in paradigm-mcp for MCP→Platform server communication. Resolves port from config.yaml, resolves agent identity from Symphony pattern.
- **Browser agent store** — Zustand store (`agentStore.ts`) managing agent presence, highlights, annotations, toasts, mute state, and pending navigation.
- **Agent effect hooks** — `useAgentEffects` (WebSocket→store bridge with auto-reconnect), `useActivityReporter` (reports user section/theme changes to server).
- **Visual components** — `AgentToast` (severity-colored toasts with robot icon), `AgentCallout` (floating callouts for graph nodes), `AgentNavigationPrompt` (conflict resolution when user is active).
- **Conflict resolution** — User always wins: idle user → agent navigates immediately; active user → shows "Go there / Dismiss" prompt; muted → all agent effects silently discarded.
- **Agent CSS** — Highlight pulse animations, dashed selection rings, toast slide-in, callout/nav-prompt animations, presence dots, mute button styles.
- **Spec update** — Section 21 "Agent-Driven UI" added to `docs/specs/platform.md` with full architecture, tool specs, WS messages, and visual treatment reference.
- **Expanded SectionId type** — Platform UI now supports `sentinel`, `university`, and `symphony` sections with placeholder pages ("Coming in Platform Phase 2").
- **University content** — New PARA 501 lesson "Platform & Agent-Driven UI" (5 quiz questions) + 4 PLSAT slots (109-112, 7 question variants) covering the MCP→HTTP→WS pipeline, conflict resolution, observe, highlights, presence pruning.
- **CLAUDE.md** — Added 5 platform tools to MCP workflow table and token budget reference.

### Fixed

- **Lore section crash** — `tags` field on some lore entries was a string instead of array, causing `.some()` TypeError. Added `Array.isArray()` guard.

Symbols: #PlatformWebSocket, #AgentPresenceManager, #UserStateTracker, #AgentCommandRoute, #PlatformTools, #AgentStore, #AgentToast, #AgentCallout

## [3.40.0] — 2026-03-15

### Added

- **Paradigm Platform Phase 0** — `paradigm serve` launches a unified development management platform in a single browser tab on port 3850.
- **Unified Express server** — Mounts existing lore routes (`/api/lore`, `/api/info`, `/api/sessions`) and graph routes (`/api/symbols`, `/api/graphs`) under one server process.
- **Platform-specific endpoints** — `/api/platform/health` (server status + enabled sections), `/api/platform/sections` (available sections list).
- **Platform UI shell** — React 18 + Zustand SPA with sidebar navigation, header bar, theme toggle (dark/light), and section routing.
- **Absorbed lore-ui** — Lore section with all 4 views (timeline, session, symbol, author) running inside the Platform shell.
- **Absorbed graph-ui** — Graph section with full React Flow canvas, symbol panel, toolbar, export/load dialogs running inside the Platform shell.
- **Overview dashboard** — Landing section with symbol counts and lore entry totals.
- **Lazy-loaded sections** — Lore and Graph sections code-split for fast initial load.
- **Section auto-detection** — Sentinel and University sections detected automatically based on installed packages.
- **Backwards compatible** — `paradigm lore serve` (port 3840) and `paradigm graph serve` (port 3841) continue working unchanged.
- **Platform spec** — Comprehensive 8-phase spec at `docs/specs/platform.md` (2,334 lines) covering governance, meetings, methodology, and more.

Symbols: #PlatformServer, #PlatformShell, #ServeCommand, #LoreSection, #GraphSection, #OverviewSection

## [3.39.0] — 2026-03-15

### Added

- **Per-Project University** — Every project can maintain its own university at `.paradigm/university/` with structured notes, policies, quizzes, learning paths, and diplomas.
- **University content types** — Notes (`N-`), Policies (`P-`), Quizzes (`Q-`), Learning Paths (`LP-`), Diplomas (`D-`) with YAML/Markdown schemas.
- **University config** — `.paradigm/university/config.yaml` with branding (name, tagline, institution), theme (colors, font), content categories, and diploma settings.
- **9 MCP tools** — `paradigm_university_search`, `paradigm_university_get`, `paradigm_university_create`, `paradigm_university_update`, `paradigm_university_quiz`, `paradigm_university_submit`, `paradigm_university_onboard`, `paradigm_university_diplomas`, `paradigm_university_validate`.
- **7 CLI commands** — `paradigm university serve|list|add|show|quiz|status|validate`. Bare `paradigm university` defaults to serve (backward compat).
- **Symbol linking** — `symbols` field on university content is load-bearing: validated against scan-index, surfaced in ripple (`university_content_affected`), and staleness-checked against `.purpose` file modification dates.
- **Reindex integration** — `paradigm_reindex` rebuilds university index (`.paradigm/university/index.yaml`) alongside scan-index, navigator, flows, etc. Reports `universityStats` in result.
- **Doctor integration** — `paradigm doctor` checks university content health: validates quiz answers, learning path step references, and reports content count.
- **2 seed habits** — `university-content-valid` (advisory on-stop, validates content), `university-onboarded` (advisory preflight, opt-in, reminds to call onboard).
- **PLSAT diploma auto-save** — `POST /api/plsat/diploma` endpoint writes diplomas to `.paradigm/university/diplomas/` when university directory exists. Server accepts `projectDir` option.
- **Shift template** — `paradigm shift` creates `.paradigm/university/` directory structure with default `config.yaml` using project name as institution.
- **CLAUDE.md updates** — Project University section, MCP Workflow Protocol entries, token budget entries for university tools.
- **`quality` habit category** — Added to HabitCategory type for university content validation habits.

Symbols: #UniversityTools, #UniversityStorage, #UniversityCommands, #university-loader, #UniversityTypes

## [3.38.0] — 2026-03-15

### Added

- **Lore Confidence Calibration** — Agents can attach confidence scores (0.0-1.0) to lore entries, and humans can record assessment verdicts (correct/partial/incorrect). The system computes calibration deltas and builds domain-specific reliability maps.
- **`confidence` field on LoreEntry** — Optional 0.0-1.0 score expressing agent's predicted confidence in correctness. Also available on `LoreDecision`.
- **`assessment` field on LoreEntry** — Human verdict (`correct`/`partial`/`incorrect`) with assessor, timestamp, and optional notes.
- **`assessment_delta` field on LoreEntry** — Auto-computed difference between implied outcome score and confidence (positive = under-confident, negative = over-confident).
- **`paradigm_lore_assess` MCP tool** — Record assessment verdict on a lore entry. Auto-computes delta if confidence was recorded. ~100 tokens.
- **`paradigm_lore_calibration` MCP tool** — Query calibration statistics across assessed entries. Returns accuracy rate, avg confidence, calibration score, verdict breakdown, groupBy support (symbol/tag/type), and natural-language insights with low-N caveats. ~200 tokens.
- **`paradigm lore assess <id> <verdict>` CLI** — Record assessment with `--assessor` and `--notes` options. Shows delta and calibration interpretation.
- **`paradigm lore calibration` CLI** — Show calibration report with `--symbol`, `--tag`, `--author`, `--group-by`, and `--json` options.
- **`--confidence` flag on `paradigm lore record`** — Attach confidence score when recording entries via CLI.
- **`confidence` param on `paradigm_lore_record` and `paradigm_lore_update`** — Attach/update confidence via MCP.
- **`hasConfidence`/`hasAssessment` filters** — New filter fields on LoreFilter, supported in MCP search, core filter, lore-loader, and lore-server query params.
- **Lore UI: confidence badge** — LoreCard shows purple percentage badge when confidence is set.
- **Lore UI: assessment indicator** — LoreCard shows colored verdict badge (green/yellow/red) when assessed.
- **Lore UI: Confidence & Assessment section** — DetailPanel shows full confidence, verdict, assessor, delta with calibration interpretation.
- **Lore server: `PUT /:id/assess` route** — HTTP endpoint for assessment in lore-ui server.
- **Lore server: `GET /calibration` route** — HTTP endpoint for calibration stats in lore-ui server.
- **Wisdom integration** — `paradigm_wisdom_context` now includes `calibration` and `calibration_warnings` for assessed symbols. Low-accuracy symbols (< 60% across 3+ entries) surface warnings like "Low historical accuracy for #X: 40% across 5 entries."
- **`confidence-on-decisions` seed habit** — Advisory-only reminder on stop to include confidence scores when recording lore. Category: documentation, severity: advisory, never blocks.
- **CLAUDE.md: Confidence Calibration section** — Documents the record-assess-calibrate workflow, key distinctions between review/assessment/confidence.
- **CLAUDE.md: MCP Workflow Protocol + Token Budget tables** — Added `paradigm_lore_assess` and `paradigm_lore_calibration` entries.

Symbols: #lore-assess, #lore-calibration, #LoreCard, #DetailPanel, #LoreTools, #WisdomTools

## [3.37.0] — 2026-03-13

### Added

- **Integrity hardening** — New `integrity-checker.ts` utility in paradigm-mcp with 7 checks: broken references, duplicate symbols, orphaned symbols, missing anchor files, anchor out-of-bounds, component anchor validation, purpose file health (oversized/stale detection with health score).
- **`paradigm integrity` CLI command** — Reports broken refs, duplicates, orphans, missing anchors. Supports `--json` for machine-readable output (used by stop hook Check 12).
- **Reindex steps 8-11** — Reindex now runs integrity checks (step 8), component anchor validation (step 9), purpose health scoring (step 10), and cross-file .purpose validation (step 11). All non-fatal; results included in reindex output.
- **Postflight check 6** — Validates `parentSymbol` references for touched symbols during postflight (advisory, severity: warning).
- **Stop hook Check 12** — Advisory-only symbol integrity check (broken refs + duplicates + missing anchors). Non-blocking.
- **Config schema validation** — Zod schema for `.paradigm/config.yaml` covering all known fields. `paradigm doctor` Check 8 validates config schema. Index-loader warns on missing required fields.
- **Cross-file .purpose validation** — `validateCrossFile()` in purpose-core checks parent references, symbol list references, and flow step references across all .purpose files. Wired into reindex step 11.
- **Doctor checks 8-9** — Check 8: config.yaml schema validation. Check 9: purpose file health (oversized >500 lines, split suggestions).
- **Duplicate detection in aggregator** — premise-core aggregator now detects symbols defined in 2+ files, reports via `AggregationResult.duplicateSymbols`.
- **Purpose health score in status** — `paradigm_status` MCP tool now includes `purposeHealthScore` (0-100).
- **LoreEntry consolidation** — `lore.ts` and `sessions.ts` route files now import `LoreEntry` from `core/lore/types.ts` instead of inline interfaces.

### Changed

- Doctor command upgraded from 7 to 9 quality checks.
- Postflight upgraded from 6 to 7 checks (totalChecks).
- Reindex pipeline upgraded from 7 to 11 steps.
- Stop hook upgraded from 11 to 12 checks.

### Fixed

- **Anchor resolution** — Anchors now resolve relative to their `.purpose` file's directory first, falling back to rootDir. Eliminates false positives from sub-package `.purpose` files (355 → 0 missing anchors).
- **Duplicate detection** — Skips `.purpose` + `portal.yaml` overlap for gate symbols (by design, not a conflict).
- **Orphan definition** — Now reports true isolates (zero refs in AND out) instead of all unreferenced symbols. Tree roots (features with outgoing refs) are structural, not defects (440 → 135 reported).
- **10 out-of-bounds anchors** — Updated stale line ranges across sentinel, paradigm-mcp, and sentinel-ui `.purpose` files.
- **Symphony anchor paths** — Fixed malformed relative paths (`../../` → `../../../../../`) in `packages/paradigm/src/commands/symphony/.purpose`.
- **Root .purpose cleanup** — Removed duplicate `#probe-protocol` (authoritative copy in `packages/probe/core/.purpose`).

Symbols: #IntegrityChecker, #integrity-command, #config-schema-validator, #doctor-command, #validator, #aggregator, ~advisory-first, ~anchor-resolution

## [3.36.0] — 2026-03-13

### Added

- **Symphony Phases 1 & 2** — Conductor auto-link + Sentinel conversation view for multi-agent orchestration.
- **Naming rename: "A-Mail" → "The Score"**: Protocol directory `~/.paradigm/mail/` → `~/.paradigm/score/`, CLI `paradigm mail` → `paradigm symphony`, subcommand `link` → `join`, `unlink` → `leave`. Backward-compat migration auto-renames legacy directory on first access.
- **Conductor auto-link** (Phase 1, Swift): 9 new Swift files — `SymphonyTypes.swift` (wire-compatible Codable types), `ScoreIO.swift` (JSONL I/O), `AgentPartManager.swift` (agent registration), `NoteRelay.swift` (5s polling relay with dedup), `FileApprovalManager.swift` (approve/deny/redact with SHA-256 + path safety), `AutoLinkCoordinator.swift` (auto-detect CC sessions).
- **Conductor Symphony UI** (Phase 1, SwiftUI): `ThreadListView`, `FileRequestNotificationView`, `SymphonySettingsView` (6th settings tab). Voice commands: "approve", "deny", "approve redacted" for hands-free file approval.
- **Sentinel ConversationView** (Phase 2, React): Interactive tree view of Symphony agent conversations — `ThreadList` sidebar + `ConversationPanel` with `NoteBubble`, `IntentBadge`, `ParticipantBadge`, `DecisionSummary`. WebSocket real-time updates with slide-in animation.
- **`paradigm-symphony` event schema**: 19 event types across 6 categories (dialogue, action, outcome, system, lifecycle, transfer). Auto-registered on Sentinel startup alongside `paradigm-logger`.
- **Symphony event bridge** (`#SymphonyEventBridge`): MCP symphony tools emit events to Sentinel via fire-and-forget POST. Maps all 16 message intents to event types. Emits thread lifecycle events on auto-thread creation.
- **Zustand conversation store** (`#ConversationStore`): Threads from `/api/events/scopes`, notes from `/api/events`, decision extraction, WebSocket real-time updates.
- **StatusTracker enhancement**: Now scans `~/.paradigm/score/agents/` for registered agent counts alongside project task files.
- **NotificationBubbleView enhancement**: Thread count badge showing active Symphony conversations per instance.

### Changed

- **CLI command group rename**: `paradigm mail` → `paradigm symphony` with 16 subcommands renamed (join, leave, whoami, list, send, read, inbox, threads, thread, resolve, status, serve, request, requests, approve, deny).
- **symphony-loader.ts**: `MAIL_DIR` → `SCORE_DIR`, `ensureMailDirs()` → `ensureScoreDirs()` (deprecated alias kept), user-facing strings updated ("mailbox" → "inbox", "message" → "note").
- **ConductorAction**: +3 cases (`.approveFileRequest`, `.denyFileRequest`, `.approveFileRequestRedacted`).
- **InputOrchestrator**: Handles Symphony file approval actions via `fileApprovalManager`.
- **VoiceCommandRegistry**: Default commands for file approval ("approve", "deny", "approve redacted").
- **ActionRegistry**: Serialization for new Symphony action cases.
- **AppDelegate**: Owns Symphony components (agentPartManager, noteRelay, fileApprovalManager, autoLinkCoordinator), lifecycle management.
- **MainOverlayView**: File request notifications + thread list sections.
- **SettingsPanelView**: Symphony tab added.

Symbols: #symphony-types, #score-io, #agent-part-manager, #note-relay, #file-approval-manager, #auto-link-coordinator, #thread-list-view, #file-request-notification, #symphony-settings, #SymphonySchema, #ConversationView, #ConversationStore, #SymphonyEventBridge, #symphony-join, #symphony-leave, $symphony-auto-link, $symphony-relay, $symphony-file-approval, $symphony-voice-approve, $symphony-startup, $symphony-conversation, ^symphony-enabled, ^file-request-allowed, !agent-part-created, !agent-auto-linked, !note-relayed, !file-request-received, !file-request-approved, !note-received-live, ~jsonl-compatible, ~file-safety

## [3.35.0] — 2026-03-12

### Added

- **Symphony Phase 0: A-Mail** — file-based agent-to-agent messaging for multi-session collaboration. No server dependency; uses JSONL mailboxes at `~/.paradigm/mail/` polled via `/loop`.
- **6 new MCP tools**: `paradigm_symphony_poll` (inbox heartbeat), `paradigm_symphony_send` (message routing with 16 intents), `paradigm_symphony_status` (network overview with sleep detection), `paradigm_symphony_thread` (full thread context), `paradigm_symphony_request_file` (human-gated file pipeline), `paradigm_symphony_approve_file` (approve/deny/redact file transfers).
- **`paradigm mail` CLI command group**: 16 subcommands — `link`, `unlink`, `whoami`, `list`, `send`, `read`, `inbox`, `threads`, `thread`, `resolve`, `status`, `serve`, `request`, `requests`, `approve`, `deny`.
- **Agent identity system**: Deterministic `{project}/{role}` IDs derived from `config.yaml`, surviving session restarts. Auto-discovery of Conductor sessions.
- **Thread management**: Auto-created on first message, with participant tracking, message counting, and resolution to Lore entries.
- **File transfer pipeline**: Trust config (`trust.yaml`), hard-deny list (`.env*`, `*.key`, `*.pem`, `**/credentials*`, `**/secrets/**`), auto-approve globs, SHA-256 integrity hashes, secret redaction mode.
- **TCP serve stub** (`paradigm mail serve`): Phase 0 placeholder for remote agent linking on port 3939.
- **University**: New para-501 lesson "Symphony: Multi-Agent Messaging with A-Mail" with 5 quiz questions. 6 new PLSAT question slots (12 variants) covering A-Mail architecture, identity, intents, security, threading, and heartbeat. Reference cards for all 6 MCP tools and `paradigm mail` CLI commands.
- **Quick start guide**: `docs/guides/symphony-quickstart.md` with step-by-step multi-agent setup.
- **Troubleshooting**: Symphony/A-Mail entries in `.paradigm/docs/troubleshooting.md`.

Symbols: #symphony-loader, #symphony-poll, #symphony-send, #symphony-status, #symphony-thread, #symphony-request-file, #symphony-approve-file, #mail-link, #mail-unlink, #mail-whoami, #mail-list, #mail-send, #mail-read, #mail-threads, #mail-thread, #mail-resolve, #mail-status, #mail-serve, #mail-request, #mail-approve, #mail-deny, $mail-send-flow, $mail-poll-flow, $file-request-flow, ^file-trust, !message-sent, !message-received, !thread-created, !thread-resolved, !file-requested, !file-approved, !file-denied, !file-delivered, ~human-gated-transfer, ~hard-deny-list

## [3.34.0] — 2026-03-12

### Added

- **`paradigm migrate` command**: Version-aware project migration system that detects what version a project is effectively at and applies pending migrations automatically. Subsumes the old `paradigm upgrade` command.
- **Migration registry**: 19 ordered migrations covering legacy format conversion, directory creation, config field additions, template sync, and hook refresh. Each migration is self-contained with `check()` and `apply()`.
- **`.paradigm/migrate.yaml` state tracking**: Records which migrations have been applied, when, and by which CLI version. First-run bootstrap auto-marks existing structures as applied to prevent false positives.
- **Auto vs manual migration classification**: Directory, config, template, and hook migrations apply automatically; schema/format migrations that change user content (e.g., assessment-to-lore) are flagged for manual review with guidance.
- **`paradigm shift` step 1b integration**: Re-running `paradigm shift` on existing projects now silently applies pending migrations, making shift a full upgrade path.
- **Evergreen migrations**: `sync-templates` and `refresh-hooks` re-check every run to keep templates and hooks current regardless of when they were last applied.
- **CLI flags**: `--dry-run`, `--apply`, `--force`, `--only <ids>`, `--category <cat>`, `--list`, `--verbose` for full control over migration behavior.

### Fixed

- **Assessment migration check false positive**: `migrate-assessments-to-lore` no longer reports as pending after entries have been migrated (now checks for unmigrated YAML files rather than directory existence).

### Changed

- **`paradigm upgrade` deprecated**: Now shows deprecation notice directing users to `paradigm migrate`. Existing functionality preserved for `--from-horizon` migration path.
- **Version sync**: `@a-company/paradigm-mcp` 3.21.0 → 3.34.0, `@a-company/university` 3.10.6 → 3.34.0, plugin 3.24.1 → 3.34.0.

## [3.33.0] — 2026-03-12

### Added

- **Component types (`type` field on PurposeItem)**: Optional open-string `type` field on components describes structural role (view, service, tool, router, filter, etc.). Added to `PurposeItem` interface and Zod schema (`@a-company/purpose-core`).
- **Component hierarchy (`parent` field on PurposeItem)**: Optional `parent` field establishes component hierarchy, declared on child components with `#` symbol reference.
- **`componentType` and `parentSymbol` on SymbolEntry**: Propagated through aggregation from .purpose items to the unified symbol index (`@a-company/premise-core`).
- **Component type query functions (`@a-company/premise-core`)**: `getComponentsByType()`, `getAllComponentTypes()`, `getChildComponents()` — filter and query components by structural type.
- **`componentType` filter on `paradigm_search`**: New optional parameter filters search results by component type.
- **Component type breakdown in `paradigm_status`**: Status response now includes `componentTypes` section showing count per type.
- **`componentType` on ScanElement, `componentTypes` on ScanIndexMeta (`@a-company/probe-core`)**: Scan index elements carry their component type; `$meta` aggregates type counts.
- **`componentTypeBreakdown` in reindex result**: `paradigm_reindex` reports typed component counts in rebuild output.
- **`symbolsByComponentType` in navigator.yaml**: Navigator groups symbols by their component type for quick lookup.
- **`type` and `parent` parameters on `paradigm_purpose_add_component`**: MCP tool accepts structural type and parent component when creating/updating components.
- **`component_types` glossary in `.paradigm/config.yaml`**: 17 type definitions (command, tool, utility, engine, loader, writer, service, model, view, provider, manager, detector, router, filter, store, handler, config).
- **University lesson: "Component Types & Hierarchy" (para-101)**: Covers type vs tag distinction, parent field, config glossary, MCP integration, with 3 quiz questions.
- **PLSAT questions (slots 100–102)**: 3 new assessment slots covering type vs tag usage, open-string types, parent declarations, and componentType search.
- **Migrated 208 components across 5 .purpose files**: Added `type` (and `parent` where applicable) to `packages/conductor/.purpose`, `packages/paradigm-mcp/.purpose`, `packages/paradigm/.purpose`, and `packages/paradigm/src/core/.purpose`.
- **CLAUDE.md documentation**: New "Component Types" section documenting type/parent fields, type vs tag distinction, MCP usage, and updated conventions.

## [3.32.4] — 2026-03-11

### Fixed

- **Gaze calibration collected wrong data (`#gaze-calibration`)**: Calibration view was receiving the already-calibrated screen-pixel stream instead of raw iris positions (0–1 normalized). The affine transform trained on screen→screen instead of iris→screen, producing a tiny, mis-scaled, Y-inverted mapping. Now passes a dedicated `rawIrisStream` for sample collection.
- **Calibration feedback dot off-screen (`#gaze-calibration`)**: Yellow gaze dot during calibration multiplied screen-pixel values by screen dimensions (treating ~960 as normalized 0–1), pushing it millions of pixels off-screen. Now correctly converts raw iris to screen coordinates.
- **Only 3 of 5 calibration points used (`#gaze-calibration`)**: `affineMap` used only the first 3 points for a basic affine, discarding points 4 and 5. Replaced with least-squares affine fitting over all collected points for more robust mapping.
- **Kalman filter stale after recalibration (`#vision-gaze-provider`)**: Kalman filter state wasn't reset after calibration, so the old mapping's velocity/position estimates corrupted the new calibration. Now resets on calibration completion.

### Added

- **Raw iris stream (`#vision-gaze-provider`)**: New `rawIrisStream` publishes pre-calibration iris positions (0–1 normalized) alongside the existing calibrated `gazePointStream`. Used by calibration and debug overlay.
- **Calibration quality diagnostics (`#gaze-calibration`)**: `calibrationQuality()` returns average residual in pixels; `residuals()` returns per-point error breakdown. Logged after calibration.
- **Enhanced gaze debug overlay (`#gaze-cursor`)**: Cyan dot (calibrated position) + yellow dot (raw iris estimate) + monospace coordinate label. Shows both pre- and post-calibration gaze positions for diagnosing mapping issues.

## [3.32.3] — 2026-03-11

### Fixed

- **Send button disabled with zone router target (`#buffer-view`)**: Send button was checking only `gazeRouter.currentTarget` and ignoring `gazeZoneRouter.targetedInstance`, leaving it disabled even when a workspace cell was targeted. Now enables when either target source has a target.
- **Dispatch uses zone router target (`#input-orchestrator`)**: `dispatchToTarget()` now prefers `gazeZoneRouter.targetedInstance.instance` over `gazeRouter.currentTarget`, so Send works correctly with workspace-managed instances.
- **All bracketed tokens stripped (`#whisper-voice-provider`)**: `cleanTranscription()` now removes any `[...]` token (e.g. `[inaudible]`, `[NOISE]`, `[BLANK_AUDIO]`) using generic bracket stripping instead of a hardcoded list. Fixes lowercase/mixed-case tokens leaking through.

## [3.32.2] — 2026-03-11

### Fixed

- **`[BLANK_AUDIO]` spam filtered (`#whisper-voice-provider`)**: WhisperKit special tokens (`[BLANK_AUDIO]`, `[SILENCE]`, `[NO_SPEECH]`, etc.) are now stripped from transcription output before yielding results. Fixes repeated `[BLANK_AUDIO]` appearing in the buffer after toggling voice off.
- **Continuous voice flush on stop (`#whisper-voice-provider`)**: `stopContinuous()` now flushes remaining buffered audio for transcription instead of silently discarding it. Ensures speech captured before toggling off still gets transcribed.
- **Minimum sample threshold reduced (`#whisper-voice-provider`)**: Lowered from 24000 (0.5s) to 12000 (0.25s) samples so shorter utterances are not silently dropped.

## [3.32.1] — 2026-03-11

### Fixed

- **Gaze status display (`#input-status`)**: Input Status panel now shows gaze coordinates even when not calibrated (e.g. "Uncalibrated (960, 540)") instead of short-circuiting to "Active — not calibrated". This lets users verify gaze data is flowing before running calibration.

### Added

- **Continuous voice recording (`#whisper-voice-provider`)**: When voice is toggled on, recording now starts immediately in continuous mode — 4-second chunks auto-transcribed via WhisperKit. No longer requires eyebrow trigger or push-to-talk. Transcription text flows directly to the buffer. Input Status shows "Listening..." in continuous mode vs "Recording..." in push-to-talk mode.

## [3.32.0] — 2026-03-11

### Changed

- **Shared camera architecture (`#shared-camera`)**: Replaced dual-camera conflict (Python/OpenCV vs AVCaptureSession) with a single `SharedCameraSession` that distributes frames to all Vision-based providers simultaneously. Both gaze and gesture providers now run their own Vision requests on the same camera frames — no mutual exclusion, no camera conflict.

- **Native Vision gaze provider (`#vision-gaze-provider`)**: Replaced `MediaPipeGazeProvider` (Python subprocess + OpenCV + MediaPipe) with `VisionGazeProvider` using Apple Vision framework `VNDetectFaceLandmarksRequest`. Extracts pupil positions for gaze estimation and eyebrow distances for raise detection — all natively, no Python dependency. Reuses existing `GazeCalibration` and `KalmanFilter2D` pipeline.

- **VisionGestureProvider shared camera**: Gesture provider no longer creates its own `AVCaptureSession`. Receives frames from `SharedCameraSession` via `CameraFrameConsumer` protocol. `setSharedCamera()` must be called before `start()`.

- **InputOrchestrator simplified**: Removed camera conflict logic and mutual exclusion between gaze/gesture. Both providers start independently via shared camera. `startVideoProviders()` creates and starts both without priority ordering. `sharedCamera` is owned by the orchestrator.

### Removed

- **Python gaze dependency**: No longer requires Python 3, OpenCV, or MediaPipe installed. `MediaPipeGazeProvider.swift` retained in codebase as fallback reference but is no longer used by the orchestrator or AppDelegate.

## [3.31.2] — 2026-03-11

### Fixed

- **Camera conflict handling (`#input-orchestrator`)**: macOS only allows one process to hold the camera — gesture provider (native AVCaptureSession + Vision) now gets priority over gaze provider (Python/OpenCV subprocess). Gaze provider skips startup when gesture is active instead of silently failing. Clear error messaging: "Blocked — camera in use by gestures" shown in Input Status panel.

- **Provider error surfacing (`#input-orchestrator`)**: Added `lastError` published property. Provider start failures now display in an orange warning banner in the Input Status panel instead of being silently swallowed.

- **Gaze status detail**: Input Status now shows "Blocked — camera in use by gestures" when gaze can't start due to camera conflict, instead of misleading "Active — not calibrated".

## [3.31.1] — 2026-03-11

### Added

- **Input Status monitor (`#input-status`)**: Live sidebar panel showing real-time status of all four input modalities — gaze (eye tracking coordinates), eyebrows (smoothed L/R values), voice (model state, recording state, last transcription), and gestures (hand detection state). Color-coded dots: gray = off, yellow = active but no data, green = receiving, red = recording.

- **`lastTranscription` on InputOrchestrator**: Published property showing the most recent voice transcription text, displayed in the Input Status panel for immediate speech feedback.

## [3.31.0] — 2026-03-11

### Added

- **Conductor 0.4.0 — Video/Voice Toggles + Terminal Close Fix**

  - **Video/voice toggle icons**: Header bar now shows camera (video.fill/video.slash.fill) and mic (mic.fill/mic.slash.fill) toggle buttons with live green/gray state indicators. Click to toggle gaze+gesture camera or voice mic on/off.

  - **Global hotkeys**: `Cmd+Shift+V` toggles video (gaze+gesture), `Cmd+Shift+M` toggles voice. Registered via CGEvent tap in `#hotkey-manager`, wired through `#conductor-app` to `#input-orchestrator`.

  - **New ConductorAction cases**: `toggleVideo`, `toggleVoice`, `muteVideo`, `muteVoice`, `unmuteVideo`, `unmuteVoice` — all bindable via voice commands and custom gestures in the Bindings tab.

  - **InputOrchestrator provider lifecycle**: `videoActive`/`voiceActive` published state. `startVideoProviders()`/`stopVideoProviders()`/`toggleVideo()` and matching voice methods. Gaze and gesture providers now actually call `.start()` during orchestrator startup (previously only voice was started — **this was a bug**).

  - **`LaunchedTerminal` struct**: `TerminalLauncher.launch()` now returns `LaunchedTerminal` with `processID`, `windowIdentifier`, and `terminalApp`. Terminal.app returns the AppleScript window ID, iTerm2 returns the session ID.

  - **`TerminalLauncher.closeWindow()`**: Static method for targeted close — AppleScript `close window N` for Terminal.app, session-targeted close for iTerm2, SIGTERM fallback for per-window terminals (Ghostty, Kitty, etc.).

  - **Gesture confirmation overlay (`#gesture-confirmation`)**: Top-center toast showing recognized gesture name and bound action, auto-fades after 1.5s. Toggle via Settings > Input > Gestures > "Show gesture confirmation overlay". Covers built-in gestures, custom DTW gestures, eyebrow events, and voice commands. Great for practice.

  - **Buffer listening state**: When voice is active, the text buffer shows a red "Listening" badge, red border glow, and subtle shadow — clear visual feedback that the mic is receiving.

  - **On-demand provider creation**: Video/voice toggles now create providers on the fly if they weren't enabled at startup. No need to toggle settings first — just hit the header icon or hotkey.

  - **Live gaze dot during calibration**: `GazeCalibrationView` now renders a yellow dot tracking the user's estimated gaze position in real time, so you can see whether you're actually looking at the target.

### Fixed

- **Terminal close kills all windows**: `WorkspaceManager.closeInstance()` was calling `kill(pid, SIGTERM)` on Terminal.app's application PID, which killed the entire app and all windows. Now uses AppleScript targeted close via window identifier — only the Conductor-launched window is closed.

- **Terminal.app AppleScript error ("Can't get window of tab")**: `do script` returns a tab reference, not a window. Changed to `id of front window` after script execution.

- **Gaze/gesture providers never started**: `InputOrchestrator.start()` subscribed to gaze/gesture streams but never called `.start()` on the providers. Camera was never activated except during calibration (which had its own explicit `.start()` call). Now fixed — all enabled providers are started during orchestrator startup.

- **Provider cleanup on stop**: `InputOrchestrator.stop()` now properly calls `.stop()` on all active providers and resets `videoActive`/`voiceActive` state.

- **Eyebrow calibration not tracking**: Calibration started without ensuring the gaze provider was active. Now creates and starts the provider before opening the calibration overlay.

- **Can't select workspace windows**: Tapping a managed instance was a no-op when the AX link hadn't been established (common for Terminal.app). Now falls back to `NSRunningApplication.activate()` to bring the terminal window to front.

### Changed

- **Conductor version**: 0.3.1 → 0.4.0
- **`ManagedInstance`**: New `windowIdentifier: String?` field for AppleScript-targeted close
- **`WorkspaceManager.cleanup()`**: Uses `TerminalLauncher.closeWindow()` instead of raw `kill()`
- **`SettingsPanelView` hotkeys section**: Now lists Toggle Video (Cmd+Shift+V) and Toggle Voice (Cmd+Shift+M), refactored to `hotkeyBadge()` helper
- **`BindingsManagerView` voice command picker**: Includes toggleVideo, toggleVoice, muteVideo, muteVoice options
- **`ActionRegistry` serialization**: Handles all 6 new action cases in `actionFromName`/`nameFromAction`
- **`InputOrchestrator`**: Publishes `lastRecognizedGesture` for the confirmation overlay to consume
- **`BufferView`**: Accepts `orchestrator` param, shows listening state visuals when `voiceActive`

## [3.30.0] — 2026-03-11

### Added

- **Conductor 0.3.1 — Wiring Fixes + UX Improvements**: Resolves 7 runtime wiring gaps in the 0.3.0 sprint output. The S8–S13 components compiled and tested individually but were structurally assembled without being wired at runtime. This release fixes the ownership inversion that left the InputOrchestrator inert.

  - **Single-owner architecture (`~single-owner`)**: AppDelegate is now the sole lifecycle owner of `InputOrchestrator`, `BufferEngine`, and `WorkspaceManager`. MainOverlayView switches from `@StateObject` to `@ObservedObject` — it observes, never owns. Eliminates the duplicate `WorkspaceManager` and `BufferEngine` that existed in the view layer.

  - **`$orchestrator-startup` flow**: `applicationDidFinishLaunching` → read `UserDefaults` → create providers conditionally (gaze/gesture/voice only when enabled) → wire workspace → `orchestrator.start()` → UI ready. Providers are created/destroyed mid-session when the user toggles preferences.

  - **Settings tabs fully wired**: `ConductorApp.Settings` now passes `workspaceManager`, `actionRegistry`, `voiceCommandRegistry`, and `customGestureClassifier` from `appDelegate.orchestrator`. Workspace and Bindings tabs render for the first time.

  - **Real gaze calibration**: `handleRecalibrate()` feeds `orchestrator.gazeProvider.gazePointStream` to the calibration overlay when a gaze provider exists. Falls back to simulated data only when gaze is disabled.

  - **`.voiceArm` action**: New `ConductorAction.voiceArm` emitted by `EyebrowStateMachine` on idle→armed and stopped→re-armed transitions. `InputOrchestrator` calls `voiceCoordinator.arm()`. VoiceControlHUD now correctly shows the full state progression: gray (idle) → yellow (armed) → red (recording) → spinner (transcribing) → green (ready).

  - **SetupWizard expansion**: Two new steps — workspace configuration (sidebar position + width) and eyebrow calibration (when eyebrow control enabled). Step routing updated for all combinations of enabled features.

  - **`EyebrowCalibrationWindowController`**: Fullscreen NSWindow for eyebrow calibration, mirrors `CalibrationWindowController` pattern. Feeds real eyebrow frames from gaze provider to `EyebrowCalibration`, applies computed thresholds to `EyebrowDetector` on completion.

- **New Conductor symbols**: `$orchestrator-startup` flow, `^providers-ready` + `^conductor-launched` gates, `~single-owner` + `~zone-deterministic` + `~user-configurable` aspects, `#eyebrow-calibration-controller` component, `!eyebrow-calibration-complete` signal.

### Changed

- **Conductor version**: 0.3.0 → 0.3.1
- **`AppDelegate`**: Owns orchestrator lifecycle, creates/destroys providers on preference change, handles eyebrow calibration notifications, clean shutdown sequence (`orchestrator.stop()` → `workspaceManager.cleanup()`)
- **`MainOverlayView`**: No longer owns any stateful components. Accepts `orchestrator` and `workspaceManager` as init params. `dispatchBuffer()` delegates to `orchestrator.executeAction(.send)` instead of maintaining its own `AXDispatchTarget`.
- **`EyebrowStateMachine`**: Armed transitions now emit `.voiceArm` instead of `nil` — 2 test assertions updated accordingly
- **`ActionRegistry`**: `voiceArm` added to serialization helpers (`actionFromName`/`nameFromAction`)

### Fixed

- InputOrchestrator was never started — `orchestrator.start()` now called from `AppDelegate.setupOrchestrator()`
- Input providers were always nil — created from `UserDefaults` preferences during setup
- Two `WorkspaceManager` instances existed (AppDelegate + MainOverlayView) — now single instance passed through
- Settings Workspace and Bindings tabs showed empty content — dependencies now injected from app delegate
- Gaze calibration used simulated data even when a real provider was available
- VoiceControlHUD skipped the armed (yellow) state — `.voiceArm` action now fires `coordinator.arm()`
- SetupWizard had no workspace configuration or eyebrow calibration steps

## [3.29.0] — 2026-03-10

### Added

- **Conductor 0.3.0 — Workspace Manager + Eyebrow Voice Control + Custom Bindings**: Six-sprint implementation (S8–S13) transforming Conductor from a passive overlay into a full workspace manager and extensible multimodal input system. 29 new source files, 6 new test files, 26 modifications to existing files.

  - **S8 — Eyebrow Detection + InputOrchestrator**: Extended MediaPipe FaceMesh Python script to extract eyebrow landmark distances (LEFT_BROW_TOP [223,222,221], RIGHT_BROW_TOP [443,442,441]) alongside existing gaze data. New `#eyebrow-detector` with KalmanFilter1D smoothing and raise/lower hysteresis thresholds (0.035/0.025). `#eyebrow-state-machine` maps eyebrow gestures to voice control: left raise → arm, left lower → start recording, left raise → stop, right raise → send. `#input-orchestrator` wires all input streams (eyebrow, voice, gesture, gaze) through a unified `#action-registry` → `ConductorAction` enum pipeline. `EyebrowStateMachineWrapper` provides @MainActor-safe access.

  - **S9 — Workspace Manager + Terminal Launching**: `#workspace-manager` launches and owns Claude Code terminal instances, arranges them in a deterministic grid. `#terminal-launcher` supports 6 terminal apps (Terminal.app, iTerm2, Ghostty, Warp, Kitty, Alacritty) via AppleScript/NSWorkspace. `#workspace-grid` computes cell frames for 1–6 instances with configurable sidebar position/width. `ConductorPanel` now supports sidebar mode (full-height, edge-snapped) alongside legacy floating overlay. `WorkspaceView` replaces `InstanceListView` as primary UI with grid minimap and instance management.

  - **S10 — Gaze-to-Grid Zone Targeting**: `#gaze-zone-router` maps gaze points to grid cells deterministically using `WorkspaceGrid.cellIndex(for:)`. Dwell timer (0.5s) locks target before dispatch. `GazeZoneOverlay` shows grid boundaries and active zone highlight. BufferView shows "Will send to: [Cell N] label" when zone router has a target.

  - **S11 — Full Voice Pipeline Wiring**: `#voice-control-coordinator` manages the complete voice lifecycle: idle → armed → recording → transcribing → readyToSend → error. Auto-recovery from errors after 3 seconds. Duration counter for recording feedback. `#voice-control-hud` shows visual states (gray mic, yellow pulse, red pulse+waveform, spinner, green check). WhisperKit pre-loaded at orchestrator startup.

  - **S12 — Polish + Settings + Calibration**: `#eyebrow-calibration` 4-step flow (restLeft → raiseLeft → restRight → raiseRight) collecting 30 samples per step, computing personalized raise/lower thresholds. `EyebrowCalibrationView` fullscreen overlay with real-time distance bars. `WorkspaceSettingsView` adds Settings tab for default terminal, sidebar position/width, max instances, auto-arrange toggle.

  - **S13 — Custom Gesture Recording + Voice Command Binding**: Full user-configurable input system. `#gesture-recorder` captures hand pose time-series (5 samples), normalizes and averages into `GestureTemplate` stored at `~/.conductor/gestures/`. `#dtw-matcher` (Dynamic Time Warping) matches incoming hand poses against templates with configurable thresholds. `#custom-gesture-classifier` uses 30-frame sliding window, matching every 5 frames, max 20 templates. `#voice-command-matcher` scans transcription start/end for registered phrases with fuzzy matching (Levenshtein distance). `#voice-command-registry` manages phrase→action bindings with defaults (send, undo, redo, cancel). `BindingsManagerView` provides three-section Settings tab for custom gestures, voice commands, and built-in gesture info. `GestureRecorderView` full-screen recording UI with progress circles and action picker.

- **Conductor test coverage expansion**: 66 new tests across 6 test suites — `EyebrowStateMachineTests` (12), `WorkspaceGridTests` (10), `GazeZoneRouterTests` (8), `VoiceControlCoordinatorTests` (9 with 1 existing modified), `DTWMatcherTests` (8), `VoiceCommandMatcherTests` (8). Total: 102 tests (up from 45).

- **New Conductor symbols**: ~20 new components (#eyebrow-detector, #eyebrow-state-machine, #input-orchestrator, #action-registry, #workspace-manager, #terminal-launcher, #workspace-grid, #gaze-zone-router, #voice-control-coordinator, #voice-control-hud, #eyebrow-calibration, #workspace-settings, #gesture-recorder, #gesture-template, #dtw-matcher, #custom-gesture-classifier, #voice-command-matcher, #voice-command-registry, #bindings-manager, #gesture-recorder-view). 9 new flows. 11 new signals.

### Changed

- **Conductor version**: 0.2.1 → 0.3.0
- **`ConductorPanel`**: Now supports both sidebar mode (full-height, edge-snapped, non-draggable) and legacy floating overlay mode. Configurable width (280–500px) and screen edge.
- **`AppDelegate`**: Made `@MainActor` for proper Swift 6 concurrency. Initializes `WorkspaceManager`, cleans up on quit.
- **`MainOverlayView`**: Restructured as sidebar layout with `InputOrchestrator`, `WorkspaceManager`, `VoiceControlHUD`, `WorkspaceView`, and `AddInstanceSheet`.
- **`SettingsPanelView`**: Five tabs (General, Input, Context, Workspace, Bindings). New eyebrow control section with sensitivity slider and calibration button. Voice mode picker includes "Eyebrow Trigger". Gaze cursor toggle.
- **`MediaPipeGazeProvider`**: Python script extended to output 4 values (gaze_x, gaze_y, left_raise, right_raise). Swift parser handles both 2-value and 4-value output for backward compatibility. New `eyebrowStream` AsyncStream.
- **`VisionGestureProvider`**: Exposes raw `handPoseStream` alongside existing `gestureStream` for custom gesture recording/matching. Extracts 10-joint `HandPoseFrame` from VNHumanHandPoseObservation.

## [3.28.0] — 2026-03-10

### Added

- **WhisperKit integration**: `#whisper-voice-provider` now uses real WhisperKit 0.16.0 (CoreML, Apple Silicon) for local speech-to-text. Fully lazy — model downloads and CoreML compilation happen on first voice use, not during setup. Uses pre-downloaded model folder when available, with 90-second timeout to prevent indefinite hangs. CMSampleBuffer→Float conversion, confidence scoring from segment data.

- **Setup wizard** (`#setup-wizard`, `#dependency-checker`): Multi-step onboarding flow — feature selection (voice/gestures/gaze toggles), WhisperKit model picker (tiny.en/base.en/small.en), dependency verification (Python 3, MediaPipe/OpenCV), retry for failed checks, gaze calibration step (no longer auto-skips), ready summary. Inserted between permissions onboarding and main content. Re-runnable from Settings.

- **Conductor version display**: Header bar shows "v0.2.0" next to the Conductor title.

- **Gaze calibration UI**: Fullscreen 5-point calibration overlay (`GazeCalibrationView`, `CalibrationWindowController`). Pulsating cyan targets with clockwise dwell-fill animation, 2-second dwell per point, ESC to cancel, iris sample averaging from live gaze stream. Wired to `MediaPipeGazeProvider.calibrate()` and the Settings "Recalibrate..." button via NotificationCenter.

- **MCP auto-registration with Conductor**: `paradigm-mcp` now auto-registers the session with Conductor on startup — writes `~/.conductor/sessions/{pid}.json` automatically. Process exit cleanup via `SIGTERM`/`exit` handlers. No user action required; `/conduct` still works for adding labels or re-registering.

- **Toggleable gaze cursor debug overlay** (`#gaze-cursor`): Click-through transparent window showing gaze position dot. Toggle from Settings panel. Includes `GazeCursorView` (SwiftUI pulsating dot) and `GazeCursorWindowController` (NSPanel click-through management).

- **Conductor test coverage**: 36 new unit tests across 5 test files — `GestureStateMachineTests` (12), `KalmanFilter2DTests` (6), `GazeCalibrationTests` (6), `EnrichedPayloadTests` (6), `ClaudeCodeInstanceTests` (6). Total: 45 tests.

### Fixed

- **WhisperKit loading hang**: `WhisperKit.download()` and `WhisperKit()` init hung indefinitely during CoreML compilation. Fixed by deferring all model work to first voice use, pointing directly at pre-downloaded model folder (`~/Documents/huggingface/`), and adding a 90-second timeout via task group race.

- **Setup wizard gaze calibration auto-skip**: "Start Calibration" immediately advanced to the ready step without waiting. Now stays on the calibration step so users see the result and click Continue manually.

- **`paradigm conductor` CLI path resolution**: Command now works when run from inside `packages/conductor/` or any subdirectory of the monorepo, not just the root. Added cwd-is-conductor detection and upward walk from cwd.

### Changed

- **Conductor tools refactored**: `detectTerminalBundleId()` and `detectGitBranch()` moved from `conductor.ts` to `conductor-loader.ts` as shared helpers for both manual registration and auto-registration.

## [3.27.0] — 2026-03-10

### Added

- **`/conduct` skill**: Register any Claude Code session with Paradigm Conductor from within the terminal. Writes a registration file to `~/.conductor/sessions/{pid}.json` that Conductor picks up instantly. Includes project dir, branch, terminal app, and optional label.

- **Conductor MCP tools** (`paradigm_conductor_register`, `paradigm_conductor_unregister`, `paradigm_conductor_list`): Programmatic session registration for Conductor. Auto-detects terminal bundle ID, git branch, and parent PID. Stale session cleanup (dead PIDs) built in.

- **Conductor `#session-file-watcher`**: Swift `SessionFileWatcher` watches `~/.conductor/sessions/` via dispatch source + 5s poll fallback. Merges file-registered sessions with AX-detected instances in the overlay, with deduplication by PID and project directory. Auto-cleans stale registrations.

- **`$session-registration` flow**: New flow covering `/conduct` → JSON file → `SessionFileWatcher` → merged instance list. Signals: `!session-registered`, `!session-unregistered`.

### Changed

- **`InstanceListView`**: Now accepts a merged instance array (AX + file-registered) instead of reading directly from `ClaudeCodeDetector`. Empty state suggests `/conduct` instead of generic "open Claude Code" message.

- **Conductor `.purpose` file**: Rewritten from YAML list format (`id:` fields) to standard Paradigm key format (`#Name:`) for proper indexing. All 30 components, 6 flows, 6 gates, 12 signals, and 4 aspects now index correctly.

## [3.26.0] — 2026-03-10

### Added

- **Paradigm Conductor** — Native macOS Swift/SwiftUI multimodal mission control for Claude Code sessions. Voice-to-buffer, hand gesture editing, gaze-targeted dispatch with Paradigm context enrichment. Launched via `paradigm conductor`.
  - **S0 — Foundation**: `#conductor-app` NSPanel floating overlay, `#conductor-panel` always-on-top window, `#permissions-onboarding` Camera/Mic/Accessibility flow, menu bar icon, 7 platform abstraction protocols (`VoiceInputProvider`, `GestureInputProvider`, `GazeTrackingProvider`, `ClaudeCodeDetectorProtocol`, `WindowArrangerProtocol`, `DispatchTargetProtocol`, `ContextEnricherProtocol`)
  - **S1 — Buffer + Window Detection**: `#text-buffer` BufferEngine with undo/redo/cursor, `#window-detector` AXUIElement + CGWindowListCopyWindowInfo polling, `#dispatch-target` AX text injection with clipboard fallback, `#buffer-view` and `#instance-list-view` SwiftUI views
  - **S2 — Voice Input**: `#whisper-voice-provider` WhisperKit speech-to-text (CoreML, Apple Silicon), `#audio-capture` AVCaptureSession microphone pipeline, push-to-talk mode
  - **S3 — Hand Gestures**: `#vision-gesture-provider` Apple Vision VNDetectHumanHandPoseRequest at 15fps, `#gesture-classifier` joint positions → actions (swipe, pinch, fist, open palm, two-finger tap), `#gesture-state-machine` debounce/cooldowns, `#gesture-hud` visual feedback
  - **S4 — Gaze Tracking**: `#mediapipe-gaze-provider` MediaPipe FaceMesh via Python subprocess, `#gaze-calibration` 5-point affine mapping, `#kalman-filter` 2D coordinate smoothing, `#gaze-router` dwell selection targeting
  - **S5 — Context Enrichment**: `#paradigm-mcp-client` stdio JSON-RPC to paradigm-mcp, `#git-monitor` polling git diff, `#context-enricher` assembles Paradigm + git context, `#sentinel-ws-client` WebSocket for real-time events
  - **S6 — Window Management**: `#window-arranger` 4 tiling layouts (focused, side-by-side, 3-up, grid), `#status-tracker` idle/processing/finished detection, `#notification-bubble` per-instance status overlay, `#agent-count-badge`
  - **S7 — Polish**: `#settings-panel` preferences (hotkeys, gestures, enrichment, camera), `#hotkey-manager` global CGEvent tap registration
  - 27 components, 5 flows, 6 gates, 10 signals, 4 aspects (~local-only, ~zero-cost, ~platform-abstracted, ~resource-conscious)
  - 51 Swift source files, 753KB arm64 release binary, macOS 14+
  - 9 unit tests for BufferEngine

- **`paradigm conductor` CLI command**: Build-and-launch command for the Conductor native binary from `packages/conductor/`

## [3.25.2] — 2026-03-10

### Added

- **`llms.txt`**: AI discoverability file at repo root following the [llmstxt.org](https://llmstxt.org/) spec — structured overview of Paradigm optimized for AI agent consumption, with curated links to docs, packages, and getting-started guides.

- **README AI discoverability**: Added language-agnostic/framework-agnostic messaging, "Who Is This For?" section, collapsed "For AI Agents: Quick Context" section, and updated University/PLSAT descriptions to reflect current state (99 questions, PARA 501, stack presets).

- **PARA 201 — Stack Presets section**: Disciplines lesson now covers the 16 stack presets with a full table, auto-detection, `--stack` flag, `paradigm presets` command, and cold-start explanation. New quiz question (q5) tests discipline vs preset understanding.

- **PARA 101 — Cold start context**: First Steps lesson now mentions discipline + stack auto-detection during `paradigm init` and the `--stack` explicit flag.

- **PLSAT v3.0 slots 097-099** (6 question variants): Stack presets vs disciplines (slot-097), `paradigm scan auto` mechanics and confidence levels (slot-098), incremental adoption and cold-start approach for existing projects (slot-099).

## [3.25.1] — 2026-03-10

### Fixed

- **Zero TypeScript errors**: Resolved all 9 pre-existing TS compilation errors in lore commands (`timeline.ts`, `list.ts`, `retag.ts`) — `entry.type` now defaults to `'note'` when undefined, removed unused imports.

- **v1 symbols in fallback config**: `createMinimalStructure` (used when templates are missing) was still generating v1 symbol system (`@feature`, `%state`, `^portal`) instead of v2 (`#component`, `$flow`, `^gate`, `!signal`, `~aspect`).

- **Dead `assessments/` directory**: Init no longer creates `.paradigm/assessments/` — assessments were consolidated into lore in 3.19.0. Now creates `.paradigm/lore/` instead.

- **React Native discipline detection**: Moved React Native/Expo check before the generic UI deps check in `detectDiscipline()`. Previously, a React Native project with `react` in deps would be incorrectly detected as `web` instead of `mobile`.

- **Silent error swallowing**: Replaced ~8 empty `catch {}` blocks in `shift.ts` and `index-loader.ts` with debug-level log statements. The workspace loading path in `index-loader.ts` now emits a visible warning on YAML parse failure (the root cause of the workspace bug fixed in 3.24.1).

- **Duplicate `detectProjectType`**: Replaced the parallel detection function in `init.ts` with one that uses stack presets, eliminating a duplicated detection path.

## [3.25.0] — 2026-03-10

### Added

- **Stack presets**: 16 framework-specific presets layered on top of disciplines for precise cold-start configuration. `paradigm init --stack nextjs` or auto-detected from project files. Each preset provides tailored `symbol-mapping`, `purpose-required`, and `scanHints` for the framework.
  - **Fullstack**: nextjs, remix, nuxt, sveltekit, astro
  - **Web**: react-spa, vue-spa
  - **API**: express, fastify, fastapi, django, gin, axum
  - **Mobile**: swift-ios, kotlin-android, flutter

- **`paradigm presets` command**: List all available stack presets, optionally filtered by discipline (`--discipline mobile`).

- **`--stack` flag** on `paradigm init` and `paradigm shift`: Explicitly set a stack preset, or omit for auto-detection.

- **`stack:` field** in `.paradigm/config.yaml`: Records the detected/chosen stack preset alongside the discipline.

## [3.24.1] — 2026-03-08

### Fixed

- **Config template duplicate YAML keys**: `paradigm init` / `paradigm shift` generated `config.yaml` files with duplicate mapping keys in `symbol-mapping` when applying discipline-specific settings. The regex replacing the template section stopped at blank lines between category groups, leaving leftover template entries that duplicated the discipline entries. This caused `js-yaml` to throw a `duplicated mapping key` error, which silently broke workspace loading (the `workspace:` field was never read).

## [3.24.0] — 2026-03-08

### Added

- **Auto-graph on scan** (1.3): `paradigm scan` now auto-generates `.paradigm/graphs/auto.graph.json` after every index rebuild. Configurable via `graph.auto-generate` in config.yaml (default: true). Symbol graph UI always shows current data with zero manual effort.

- **Doctor context audit** (1.2): `paradigm doctor --context` runs 7 new AI instruction file quality checks:
  - `stale-references` — dead file/dir paths in CLAUDE.md, .cursorrules, AGENTS.md (Error)
  - `convention-contradictions` — conflicting naming/style directives (Warning)
  - `undocumented-stack` — major deps not mentioned in instruction files (Advisory)
  - `purpose-coverage` — percentage of source dirs with .purpose coverage (Warning <80%)
  - `orphaned-symbols` — symbols with zero cross-references (Advisory)
  - `stale-portal` — portal routes with no matching implementation file (Error)
  - `instruction-vagueness` — vague language like "try to", "maybe", "if possible" (Advisory)

- **Garbage collection sweeps** (2.2): `paradigm sweep` with 9 entropy checks and auto-fix:
  - Orphaned symbols, stale purpose, phantom gates, dead signals, broken flows, lore rot, tag orphans, aspect semantic drift, coverage decay
  - Fix ON by default (`--dry` for report only)
  - Auto-records lore entry tagged `arc:sweep` after every run
  - Strict thresholds: 14-day staleness, 90% coverage minimum

- **Adaptive heat map** (2.3): Query-to-symbol relevance learning with 3 new MCP tools:
  - `paradigm_heatmap_query` — find historically relevant symbols for keywords
  - `paradigm_heatmap_record` — record/correct keyword-symbol associations (positive/negative signals)
  - `paradigm_heatmap_stats` — view heat map statistics and top associations
  - Confidence decay (5% per 30 days without reinforcement)
  - Static tier classification (hot/warm/cold) added to scan index entries

- **Spec pipeline** (3.2): Gated 5-stage workflow with 7 new MCP tools + CLI:
  - Stages: specify → plan → task → implement → validate
  - 3 gate modes: auto (pass-through), manual (human approval), sentinel (automated checks)
  - 4 built-in templates: add-feature, bug-fix, security-change, refactor
  - CLI: `paradigm pipeline start|status|advance|configure|abort|list`
  - MCP: `paradigm_pipeline_start|status|advance|configure|escalate|abort|list`
  - Pipeline state persisted as YAML in `.paradigm/pipeline/`
  - Completed pipelines archived to `.paradigm/pipeline/completed/`

### Changed

- `@a-company/paradigm` 3.23.4 → 3.24.0
- `@a-company/paradigm-mcp` 3.18.1 → 3.19.0 (10 new MCP tools)
- Doctor command refactored from single file to `commands/doctor/` directory

## [3.23.4] — 2026-03-08

### Added

- **Cross-study and expansion planning lore** (`@a-company/paradigm` 3.23.3 → 3.23.4): Recorded strategic planning sessions as lore entries
  - `L-2026-03-07-ascend-222941-001`: Deep landscape scan of 15 paradigm-adjacent frameworks across 5 competitive tiers (Packmind, Kiro, Spec Kit, Harness Engineering, Codified Context, AAIF, Augment Code, Sourcegraph, and more)
  - `L-2026-03-08-ascend-054731-001`: Item-by-item audit of 9 expansion plan initiatives — 2 struck (already shipped), 2 deferred, 5 active with expanded scope
  - Personas index auto-generated during reindex
  - History index updated with recent implementation events

## [3.23.3] — 2026-03-07

### Fixed

- **Skill shell injection compatibility** (`@a-company/paradigm` 3.23.2 → 3.23.3, plugin 3.24.0 → 3.24.1): Shell injections (`!` commands) in 3 skills used `&&`/`||` chaining and pipe operators which Claude Code's permission checker rejects as multi-operation commands
  - `doctor`: 4 injections using `test -f && echo || echo` and subshells → simplified to `ls` commands
  - `preflight`: 1 injection using `test -f && echo || echo` → `ls`, 1 using `git status | head` → removed pipe
  - `ripple`: 1 injection using `test -f && echo || echo` → `ls`
  - `handoff`: 1 injection using `git status | head` → removed pipe

## [3.23.2] — 2026-03-07

### Fixed

- **Purpose file validation cleanup** (`@a-company/paradigm` 3.23.1 → 3.23.2): Fixed 6 validation issues across 3 `.purpose` files
  - `packages/paradigm/src/core/.purpose`: Aspects `habits-loader` and `habits-types` missing `~` prefix and required anchors — replaced with proper `~habits-loader` and `~habits-types` aspects with code anchors
  - `packages/sentinel-web/.purpose`: Converted from non-standard array-style format to map-style; added missing `name` field on `$event-ingestion` flow
  - `packages/premise/core/.purpose`: Flow `$symbol-aggregation` referenced undefined `#symbol-extractor` — changed to `#aggregator` which contains the extraction logic

## [3.24.0] — 2026-03-05

### Added

- **Skills v2 upgrade** (plugin 3.23.1 → 3.24.0): All 13 plugin skills upgraded to Claude Code Skills v2 format with full YAML frontmatter
  - **Forked context** (`context: fork`) on 8 skills — preflight, postflight, sentinel, doctor, observe, ripple, review, handoff run in isolated subagents, keeping the main conversation clean
  - **Agent routing** — analysis skills route to `paradigm:architect`, compliance skills to `paradigm:reviewer`, data-fetching to `Explore`
  - **Shell injection** (`!`command``) on 5 skills — git status, diffs, config checks pre-loaded before the prompt starts, saving 2-4 MCP round-trips per invocation
  - **Tool restrictions** (`allowed-tools`) on all 13 skills — read-only analysis skills can't accidentally write files
  - **Manual-only** (`disable-model-invocation`) on init, shift, scan — prevents unintended auto-triggering
  - **Argument hints** (`argument-hint`) on 5 skills for autocomplete UX
- **3 new skills**: `/paradigm:ripple` (forked impact analysis), `/paradigm:review` (forked compliance review), `/paradigm:handoff` (forked session handoff)
- **Skills v2 design spec** at `docs/specs/skills-v2-upgrade.md` — full migration plan, token savings analysis, risk matrix, and long-term vision

## [3.23.1] — 2026-03-05

### Fixed

- **Plugin version detection uses semver sort** (`@a-company/paradigm` 3.23.0 → 3.23.1, `@a-company/paradigm-mcp` 3.18.0 → 3.18.1): Plugin update checker used alphabetical `.sort()` on cache directory names, causing `3.9.0` to rank above `3.23.0` (since `"9" > "2"` in string comparison). Every project reported stale 3.9.0 as the installed version. Replaced with numeric semver comparator in both `plugin-update-checker.ts` (MCP) and `plugin/check.ts` (CLI)

## [3.23.0] — 2026-03-04

### Changed

- **Graph Generate writes to named files** (`@a-company/paradigm` 3.22.0 → 3.23.0, `@a-company/paradigm-mcp` 3.17.0 → 3.18.0): `paradigm_graph_generate` MCP tool now requires a `name` parameter and always writes to `.paradigm/graphs/{name}.graph.json`, returning a lightweight summary instead of the full JSON. Fixes token overflow on large projects (192K+ chars). CLI `paradigm graph generate` takes name as a required positional arg
- **Graph server serves saved graphs**: New `/api/graphs` and `/api/graphs/:slug` endpoints list and serve saved `.graph.json` files from `.paradigm/graphs/`
- **Load Dialog shows saved graphs**: Graph UI Load Dialog now fetches and displays saved graphs with metadata (name, node/edge counts, size, date) for one-click loading

## [3.22.0] — 2026-03-04

### Added

- **Habits CRUD MCP tools** (`@a-company/paradigm-mcp` 3.16.0 → 3.17.0): Three new MCP tools — `paradigm_habits_add`, `paradigm_habits_edit`, `paradigm_habits_remove` — for programmatic habit management with full validation. Agents can now create, update, and delete custom habits without raw-editing YAML
- **Individual `.habit` file format**: Custom habits can now live as individual `.paradigm/habits/{id}.habit` YAML files (or global `~/.paradigm/habits/`), following the same pattern as `.protocol`, `.lore`, and `.persona` files. Coexists with existing `habits.yaml` — no migration needed
- **Habit validation**: `validateHabitDefinition()` validates required fields, kebab-case IDs, enum values, and check type/param consistency
- **5-step habit merge order**: Both MCP and CLI loaders now load habits from: seeds → global yaml → global .habit files → project yaml → project .habit files
- **Release version-bump habit**: New blocking on-stop habit (`release-version-bump.habit`) enforces package version bumps before session ends, with per-package versioning rules
- **Symbol Graph UI** (`paradigm graph`): Interactive React + xyflow canvas for visualizing symbol relationships. Includes drag-and-drop nodes, grouping, save/load, PNG/JSON export, and real-time symbol data from a local Express server
- **Graph Generate MCP tool** (`paradigm_graph_generate`): Produces GraphState JSON for the Symbol Graph UI from scan-index data with auto-positioned nodes and group layout

## [3.20.2] — 2026-03-04

### Fixed

- **Lore viewer crashes on old author format** (`@a-company/paradigm` 3.20.1 → 3.20.2): Fix 500 errors on `/api/lore/symbols` and `/api/sessions` when lore entries have the old `{type, id, model}` author object format. Fix React error #31 in LoreCard and DetailPanel by rendering author defensively. Normalize non-array `symbols_touched`/`symbols_created` fields to arrays

## [3.20.1] — 2026-03-03

### Fixed

- **Plugin version sync** (`@a-company/paradigm` 3.20.0 → 3.20.1): Sync Claude Code plugin version to match paradigm CLI version (3.13.0 → 3.20.0)

## [3.20.0] — 2026-03-03

### Added

<!-- impact: runtime -->
- **New package: `@a-company/paradigm-runtime` v0.1.0** — Runtime contracts for Paradigm Studio. Graph schema types, runtime API operation types (query/write/traverse/computed), forward-only migration engine with diff generator and history tracking, version fingerprinting for cross-component compatibility checking. Sub-path exports: `/schema`, `/migration`, `/logger`, `/telemetry`

<!-- impact: logger -->
- **Logger API stability annotations** (`@a-company/paradigm-logger` 3.5.0 → 3.5.1): Added `@public @stable` JSDoc annotations to all exported types in `packages/logger/src/types.ts`. Created `packages/logger/API.md` documenting the public contract

<!-- impact: dev-only -->
- **Changelog impact tags**: Established convention for `<!-- impact: runtime|logger|schema|sentinel|dev-only|migration -->` HTML comments on changelog entries for programmatic parsing by Studio platform

### Changed

<!-- impact: dev-only -->
- **Root monorepo scripts** (`@a-company/paradigm` 3.19.4 → 3.20.0): Added `@a-company/paradigm-runtime` to `build:packages` (after sentinel) and `publish:all` scripts

## [3.19.4] — 2026-03-02

### Fixed

- **PLSAT scroll bounce and code block clipping** (`@a-company/paradigm` 3.19.3 → 3.19.4, `@a-company/university` 3.10.3 → 3.10.4): Remove nested scroll containers (no more bounce); remove `overflow: hidden` from choice buttons so code blocks scroll horizontally; widen answer column to `1.5fr`

## [3.19.3] — 2026-03-02

### Fixed

- **PLSAT container still too narrow** (`@a-company/paradigm` 3.19.2 → 3.19.3, `@a-company/university` 3.10.2 → 3.10.3): Widen PLSAT container to 1400px unconditionally (was 1200px via `:has()`); add `min-width: 0` on grid columns to prevent code block overflow

## [3.19.2] — 2026-03-02

### Fixed

- **PLSAT split layout too narrow** (`@a-company/paradigm` 3.19.1 → 3.19.2, `@a-company/university` 3.10.1 → 3.10.2): Widen PLSAT container to 1200px when split-layout questions are active; add horizontal scrolling to code blocks inside answer choices to prevent clipping

## [3.19.1] — 2026-03-02

### Fixed

- **Version bump for publish** (`@a-company/paradigm` 3.19.0 → 3.19.1, `@a-company/university` 3.10.0 → 3.10.1): Rebuild university UI assets so version badge reflects correct version

## [3.19.0] — 2026-03-02

### Changed

#### Assessment Consolidation into Lore (`@a-company/paradigm` 3.18.0 → 3.19.0, `@a-company/paradigm-mcp` 3.14.0 → 3.15.0)

Assessments are now part of the lore system. Arcs become `arc:{name}` tags, assessment types (`retro`, `insight`, `decision`, `milestone`) become regular lore entry types. Six assessment MCP tools are deprecated as thin wrappers forwarding to lore.

- **Schema**: `LoreEntry` gains `body`, `linked_lore`, `linked_tasks`, `linked_commits` fields; `type` is now optional (defaults to `agent-session`); new types `retro` and `insight`
- **Filters**: `tag` prefix filter and `hasBody` boolean filter on lore search (MCP, CLI, viewer)
- **Deprecated tools**: `paradigm_assessment_record/list/get/search/arc_create/arc_close` — all forward to lore with `arc:*` tags; descriptions prefixed `[DEPRECATED]`
- **Session recovery**: `paradigm_context_check` breadcrumbs and recovery now search lore for `arc:*` tags instead of loading assessment directories
- **Task hints**: `paradigm_task_done` references lore instead of assessments

### Added

- **`paradigm lore migrate-assessments`** CLI command: converts `.paradigm/assessments/` entries to lore with `arc:{arc_id}` and `assessment:{type}` tags; renames originals to `.migrated`; supports `--dry-run`
- **`paradigm lore retag`** CLI command: bulk add/remove tags on matching lore entries with `--add`, `--remove`, and standard filter options (`--type`, `--symbol`, `--author`, `--from`, `--to`, `--tags`)
- **CLI enhancements**: `paradigm lore record` gains `--body`, `--link-lore`, `--link-commits` options; `paradigm lore show` displays body, linked entries, and new type colors
- **Lore Viewer**: body display (preformatted), linked entries (clickable IDs), arc tag badges (blue styling), tag dropdown filter populated from `/api/lore/tags`, `retro`/`insight` in type filter
- **Server**: `GET /api/lore/tags` endpoint returns unique tags with counts; existing list endpoint accepts `tag` and `hasBody` query params

#### University Content & PLSAT Layout (`@a-company/university` 3.10.0 → 3.10.1)

- **PARA-501 rewrite**: "Assessment Loops" lesson → "Lore as Unified Project Memory" — teaches tag-driven classification, arc tags, body field, and linking between entries
- **PLSAT v3.0**: Questions plsat-091/092/093 updated from assessment model to unified lore model
- **PLSAT two-column layout**: `QuestionCard` gains `splitLayout` prop — CSS Grid with question on left, choices on right; responsive stacking at 768px

## [3.18.0] — 2026-03-02

### Changed

#### Lore Schema Refactor: Author/Agent Split (`@a-company/paradigm` 3.17.2 → 3.18.0, `@a-company/paradigm-mcp` 3.13.0 → 3.14.0)

Separates the human author from AI agent metadata across the entire lore system. Previously `author` was an object with a `type` discriminator — now it's always a string identifying the human user, with a separate optional `agent` field for AI info.

- **Schema**: `author` is now a plain string (the human user); `agent?: { provider, model }` is a new optional field; `assistedBy` removed
- **File naming**: New entries use `.lore` extension with author+time IDs (`L-2026-03-02-ascend-143025-001.lore`) to prevent multi-user conflicts
- **Backward compatible**: Old `.yaml` entries with `author: { type, id, model }` are normalized transparently on read via `normalizeLoreEntry()`
- **Author resolution**: `resolveAuthor()` chain: `PARADIGM_AUTHOR` env → `git config user.name` → `os.userInfo().username` → `'unknown'`
- **Provider inference**: `inferProvider()` maps model names to providers (claude→anthropic, gpt→openai, gemini→google, etc.)
- **Filter changes**: `hasAgent` boolean replaces `authorType` enum; deprecated `authorType` still accepted for backward compat
- **MCP tools**: `paradigm_lore_search` gains `hasAgent` param; `paradigm_lore_record` auto-resolves human author and sets agent metadata
- **Lore Viewer**: Author shown as human user everywhere; agent displayed separately when present; filter pills updated to "All / Human Only / AI-Assisted"
- **CLI**: All lore commands (`list`, `show`, `timeline`, `delete`, `record`) updated for new schema
- **New files**: `normalize.ts` (entry normalization + provider inference), `resolve-author.ts` (human author detection)
- **Tests**: 59 tests passing across `normalize.test.ts`, `filter.test.ts`, `storage.test.ts`

### Added

- **Git context on lore entries**: Every lore entry now auto-captures `git_context: { ref, branch, dirty }` at write time — answers "what did the codebase look like when this was recorded?"
- **Custom metadata field**: `meta: Record<string, unknown>` on lore entries for project-defined key-value pairs (sprint numbers, meeting types, experiment IDs, etc.)
- **`--meta` CLI flag**: `paradigm lore record --meta '{"sprint": 12}'` attaches project metadata via CLI
- **`meta` MCP param**: `paradigm_lore_record` accepts `meta` for agent-driven metadata attachment
- **Viewer display**: DetailPanel shows git context (commit, branch, dirty status) and metadata key-value pairs

## [3.17.2] — 2026-03-02

### Fixed

- **Full null-safety pass for `symbols_touched` across all lore code** (`@a-company/paradigm` 3.17.1 → 3.17.2): YAML-loaded lore entries may omit `symbols_touched` despite the TypeScript type marking it required — added defensive null checks across 10 files:
  - **Server routes**: `lore.ts` symbol filter and `/symbols` aggregation
  - **Frontend**: `DetailPanel.tsx`, `LoreCard.tsx`, `SessionView.tsx`, `loreStore.ts` search
  - **CLI commands**: `lore list`, `lore show`, `lore timeline`, `lore delete`
  - **Core**: `filter.ts` symbol filter and full-text search

## [3.17.1] — 2026-03-02

### Fixed

- **Lore Viewer crash on projects with incomplete entries** (`@a-company/paradigm` 3.17.0 → 3.17.1): Sessions API returned 500 when lore entries were missing `symbols_touched` field — added null checks in server route and defensive optional chaining in LoreCard component

## [3.17.0] — 2026-03-02

### Added

#### Lore Viewer UX (`@a-company/paradigm` 3.16.1 → 3.17.0)

- **Light mode toggle**: Sun/moon button to the right of the view switcher segmented control. Theme persists to localStorage.
- **Author-based column layout**: Timeline entries now appear on the right by default. Click an author pill to move their entries to the left column, creating a side-by-side conversation view. Click `×` to remove them. When no authors are selected for the left, entries display in a single-column layout. Selection persists to localStorage.
- Replaced hardcoded human-left/agent-right split — any author (human or agent) can be placed on either side

## [3.16.1] — 2026-03-01

### Fixed

- **University UI version badge** (`@a-company/university` 3.9.0 → 3.9.1): Rebuild UI dist so the `vite.config.ts` fix from 3.16.0 is included in the published package — version badge now shows `v3.9.1` instead of `v0.1.0`

## [3.16.0] — 2026-03-01

### Added

#### Protocols University Content (`@a-company/university` 3.7.1 → 3.9.0)

- **PARA 301 lesson**: "Protocols — Repeatable Patterns" — covers protocol storage, step types, searching, recording, freshness tracking, and the protocol workflow
- **3 PLSAT questions** (slots 094-096): protocol search workflow, recording patterns, freshness/staleness/broken status
- **Updated operational loop**: PARA 301 "Operational Excellence" capstone now includes protocol search in the Discover phase and protocol recording in the Capture Knowledge phase
- **New protocol**: `update-university-content.protocol` — general protocol for adding lessons, quizzes, and PLSAT questions
- PLSAT totalSlots updated to 99 (correctly counts passage sub-questions), description updated to match

### Fixed

- **University UI version badge**: Showed "v0.1.0" instead of the actual package version — `vite.config.ts` now reads from parent `package.json` instead of falling back to the UI sub-package's hardcoded version
- **PLSAT question count mismatch**: Exam rules showed 96 questions but metadata said 90 — `totalSlots` and description now reflect the actual resolved count (99) including passage sub-questions

#### Protocols — Repeatable Implementation Patterns (`@a-company/paradigm-mcp` 3.11.0 → 3.13.0, `@a-company/paradigm` 3.14.1 → 3.16.0)

Protocols capture step-by-step implementation patterns with exact file references, learned from completed work. Agents search protocols before exploring — saving 100-200k tokens per task when a matching pattern exists.

- **5 new MCP tools**: `paradigm_protocol_search` (fuzzy match by task description), `paradigm_protocol_get`, `paradigm_protocol_record`, `paradigm_protocol_update`, `paradigm_protocol_validate`
- **Fuzzy search**: Tokenizes task descriptions, scores against trigger phrases (weight 3), tags (weight 2), name/description (weight 1), step notes (weight 0.5)
- **Freshness tracking**: Protocols auto-validated during `paradigm_reindex` — missing files → broken, modified exemplar → stale, all valid → current
- **Status integration**: `paradigm_status` includes protocol health (total/current/stale/broken)
- **Lore integration**: `paradigm_lore_record` detects "protocol-worthy" sessions (2+ new files following existing patterns) and returns a `protocol_suggestion` draft
- **`/protocol` skill**: Search or record protocols via slash command
- **36 seed protocols** covering all paradigm patterns:
  - MCP/Tools (5): add-mcp-tool, add-mcp-tool-with-status, add-tool-with-reindex-integration, add-tool-with-workspace-support, add-tool-with-sentinel-schema
  - CLI (6): add-cli-command, add-command-with-subcommands, add-command-with-prompts, add-command-with-file-output, add-workspace-subcommand, add-team-subcommand
  - Sentinel (4): add-sentinel-event-schema, add-sentinel-server-route, add-sentinel-adapter, add-sentinel-mcp-integration
  - Auth (2): add-portal-gate, add-portal-route-with-gates
  - University (3): add-university-course, add-university-quiz, add-plsat-question
  - IDE/Agents (2): add-ide-adapter, add-agent-provider
  - Data (4): add-paradigm-type, add-aspect-with-anchors, add-wisdom-entry, add-spec
  - Testing (2): add-unit-test, add-integration-test
  - Docs (2): add-upgrade-guide, add-case-study
  - Infra (6): add-skill, add-mcp-resource, add-hook-script, record-lore, update-changelog, update-university-content
- Storage: `.paradigm/protocols/` with `.protocol` extension per file and auto-generated `index.yaml`
- Spec: `docs/specs/protocols.md`

## [3.14.1] — 2026-03-01

### Fixed

- **PLSAT 500 error** (`@a-company/university` 3.7.0 → 3.7.1): `resolveV3()` didn't handle `variant-group` item type in v3.0 exam JSON — 6 items fell into the passage branch, crashing on undefined `item.questions`. Now treats `variant-group` identically to `standalone`.
- Added try-catch around PLSAT version route handler for proper error responses instead of bare 500s

## [3.14.0] — 2026-03-01

### Changed

#### Sentinel Dashboard UX Improvements (`@a-company/sentinel`)

Overhauled the Logs and Events views in the Sentinel dashboard for better usability.

- **Full timestamps**: Both views now show `YYYY-MM-DD HH:MM:SS` (locale-independent manual formatting)
- **Expand All / Collapse All**: Toolbar toggle to bulk-expand all rows — expanded rows unwrap truncated message text and show data payloads
- **Resizable columns**: Drag column header borders to resize Time, Level, Symbol, Service, Type columns
- **Merged Level + Category** (EventsView): Removed redundant Category column; category now appears as a colored `[category]` badge inline in the Type cell (hidden when "unknown")
- **Exclusion filters**: Right-click any row to exclude by symbol, symbol type, message, or service — active exclusions appear as dismissible chips below the toolbar with a "Clear all" link
- Both views switched to CSS grid layout with shared column widths between header and rows
- Auto-scroll now stays at top (newest entries) instead of jumping to bottom
- EventsView grid reduced from 6 columns to 5

### Added

#### Bundle Sentinel Binaries into Paradigm (`@a-company/paradigm` 3.13.0 → 3.14.0, `@a-company/sentinel` 3.6.0 → 3.7.0)

`npm i -g @a-company/paradigm` now provides `sentinel` and `sentinel-mcp` binaries — no separate `@a-company/sentinel` install needed.

- Added `sentinel` and `sentinel-mcp` tsup build entries (same cross-compile pattern as `paradigm-mcp`)
- Added `sentinel` and `sentinel-mcp` bin entries to package.json
- Added runtime dependencies: `simple-git`, `ws`, `uuid`
- Fixed sentinel CLI hardcoded version (`0.2.0` → dynamic from package.json via `createRequire`)
- Renamed `dashboard` command to `defend` (`sentinel defend`, `paradigm sentinel defend`)
- Copied sentinel UI assets into paradigm dist during build (same pattern as university-assets)

## [3.12.0] — 2026-02-28

### Added

#### Workspace DX — `--workspace` Flag + CLAUDE.md Injection (`@a-company/paradigm` 3.11.0 → 3.12.0)

Simplified workspace setup from 4 commands across 3 directories to a single `paradigm shift --workspace "name"` from any member project.

**`paradigm shift --workspace` Flag:**
- `--workspace <name>`: Creates `../.paradigm-workspace` with the current project as first member, or joins an existing workspace
- `--workspace-path <path>`: Override the default workspace file location
- Automatically detects project role (api, client, shared, etc.) from directory name and dependencies
- Updates local `.paradigm/config.yaml` with workspace link
- Runs workspace reindex after scan (Step 3b) when workspace is configured
- Shows workspace-specific next steps in summary (join sibling projects)
- Idempotent: re-running from an already-joined project is a no-op

**CLAUDE.md Workspace Section Injection:**
- `ParadigmFiles` interface now includes optional `workspace` field
- `loadParadigmFiles()` reads workspace config and populates member info
- New `generateWorkspaceSection()` in base adapter renders: member table, cross-project tools reference, symbol prefix guidance
- Claude adapter calls it after Multi-Agent Orchestration section — only emitted when workspace has sibling projects

**Testing Document:**
- Created `docs/testing/workspace-deus-test-plan.md` — structured test plan for Opus agents validating the end-to-end flow in deus-backend/deus-frontend

## [3.11.0] — 2026-02-28

### Added

#### Enforcement Gaps — Hook Unification + New Checks (`@a-company/paradigm` 3.10.0 → 3.11.0, `@a-company/paradigm-mcp` 3.10.0 → 3.11.0)

Unified the duplicated Claude Code and Cursor stop hooks into a shared `paradigm-common.sh` library, and wired up three enforcement gaps that were configured but never checked.

**Hook Unification:**
- Extracted checks 1–8 (plus new 9–11) into `paradigm-common.sh` — single source of truth
- Claude Code and Cursor stop hooks are now thin wrappers that source the common library
- Platform-specific logic (CWD extraction, loop guard, followup JSON) stays in wrappers
- `generate-hooks.mjs` copies `paradigm-common.sh` to both plugin directories
- `paradigm hooks install` deploys `paradigm-common.sh` alongside stop scripts

**Check 9 — Purpose-Required Enforcement:**
- Validates `purpose-required` patterns from `.paradigm/config.yaml`
- Directories matching configured globs (e.g., `src/*`, `packages/*`) must have `.purpose` files
- `paradigm doctor` now reports purpose-required compliance

**Check 10 — Smart Aspect Drift with Auto-Heal:**
- New CLI command: `paradigm drift check [--json] [--auto-heal]`
- Reads `.paradigm/aspect-graph.db` directly to detect drifted anchors
- 3-layer detection: exact hash → normalized hash → git-aware line mapping
- Auto-heals shifted anchors (updates both DB and `.purpose` files)
- Stop hook calls `paradigm drift check` and reports genuinely drifted content as blocking

**Check 11 — Portal Gate Implementation Compliance:**
- New CLI command: `paradigm portal check [--json]`
- Wraps existing `checkPortalCompliance()` for CLI access
- Detects gates used in code but not declared in `portal.yaml` (blocking violation)
- Detects gates declared but never referenced (warning in doctor)
- `paradigm doctor` now reports portal gate compliance status

**Exported Helpers (paradigm-mcp):**
- `computeLineShift()`, `healAnchorInPurposeFile()`, `parseUnifiedDiffHunks()` now exported from `aspect-graph.ts`
- `DiffHunk` and `LineMapping` interfaces now exported

## [3.10.0] — 2026-02-28

### Added

#### Workspaces — Multi-Project Symbol Awareness (`@a-company/paradigm` 3.9.0 → 3.10.0, `@a-company/paradigm-mcp` 3.9.0 → 3.10.0)

Cross-project symbol sharing via `.paradigm-workspace` files. Sibling projects can now see each other's symbols for ripple analysis, search, navigation, and gate awareness.

**Phase 1 — File Format + Discovery:**
- `.paradigm-workspace` YAML schema with version, name, and members (name, path, role, exports)
- `workspace` field in `.paradigm/config.yaml` pointing to workspace file
- Workspace loader reads sibling `scan-index.json` files (read-only)
- Export filtering: members control visibility via glob patterns
- Graceful degradation: missing files warn and continue

**Phase 2 — Cross-Project Search + Ripple:**
- `paradigm_search` gains `includeWorkspace` parameter — searches sibling indices with `{member}/` namespace prefix
- `paradigm_ripple` gains `includeWorkspace` parameter — adds `workspaceImpact` section with cross-project references
- Impact level auto-upgrades when cross-project references exist

**Phase 3 — Navigation + Portal Awareness:**
- `paradigm_navigate` with `find` intent falls back to workspace siblings when symbol not found locally
- `paradigm_navigate` with `context` intent includes relevant sibling symbols
- `paradigm_gates_for_route` learns gate patterns from sibling `portal.yaml` files

**Phase 4 — CLI + Reindex:**
- `paradigm workspace init` — discovers sibling projects, auto-detects roles, creates `.paradigm-workspace`
- `paradigm workspace status` — shows member status, symbol counts, last indexed time
- `paradigm workspace reindex` — runs `paradigm scan` in all member directories
- `paradigm_workspace_reindex` MCP tool — reindex all members from AI assistant
- `paradigm shift` auto-detects `.paradigm-workspace` in parent directories

**Backward Compatibility:**
- No `workspace` in config.yaml → all behavior identical to 3.9.0
- `includeWorkspace` defaults to `false` — workspace search is opt-in per query
- Missing workspace file, missing sibling index → warn and continue

## [3.9.0] — 2026-02-26

### Added

#### Personas — Actor-Driven Journey Testing (`@a-company/paradigm-mcp` 3.8.0 → 3.9.0)

Named test actors with traits, journeys, and spawn chains — turning portal/flow topology into executable, validated test specifications.

**Phase 1 — Schema + CRUD + Validation:**
- `.persona` file format with traits, trigger, fixtures, and ordered journey steps
- 10 MCP tools: `persona_create`, `persona_get`, `persona_list`, `persona_update`, `persona_delete`, `persona_add_step`, `persona_remove_step`, `persona_validate`, `persona_coverage`, `persona_affected`
- Full cross-reference validation: gates vs portal.yaml, routes vs portal.yaml, flows vs flow-index, spawn cycle detection
- Coverage analysis: routes/gates/flows with and without persona coverage
- Persona index auto-generated during `paradigm_reindex`

**Phase 2 — Ripple Integration:**
- `paradigm_ripple` now includes `personas_affected` showing which personas traverse a changed gate/flow/route
- Spawn chain blocking: shows downstream personas that would break if a step fails

**Phase 3 — Execution Engine:**
- `paradigm_persona_run` executes journeys against a running server
- Template interpolation: `{{fixtures.X}}`, `{{produces.X}}`, `{{context.X}}`, `{{env.X}}`
- Step-by-step HTTP execution with expect assertions (status, body.has, body.match)
- Produces extraction and carry-forward between steps
- Spawn chain orchestration with topological ordering
- Dry-run mode for validation without requests
- Chain execution with permutation overrides

**Phase 4 — Sentinel Integration:**
- Schema `paradigm-personas` auto-registers on first run
- Events emitted: `persona.run.start`, `persona.step.pass/fail/skip`, `persona.run.complete`, `persona.chain.complete`
- Query with: `paradigm_sentinel_events({ schema: "paradigm-personas" })`

## [3.8.0] — 2026-02-26

### Added

#### Smart Drift Detection (`@a-company/paradigm-mcp` 3.7.0 → 3.8.0)

Upgrades `paradigm_aspect_drift` from a brittle hash-only tripwire to a layered, self-healing anchor system.

**Phase 1 — Normalized Hashing:**
- `normalizeForHash()` strips trailing whitespace, blank lines, and collapses internal spaces before hashing
- Two hashes stored per anchor: `content_hash` (exact) and `normalized_hash` (format-tolerant)
- Formatter runs (`prettier`, `eslint --fix`) no longer trigger false drift
- Cosmetic-only changes auto-heal by updating the exact hash in-place

**Phase 2 — Git-Aware Line Mapping:**
- `materialized_at_commit` records git HEAD at reindex time
- `parseUnifiedDiffHunks()` parses `@@ -old,count +new,count @@` format
- `computeLineShift()` translates anchor line ranges through accumulated diff offsets
- When code shifts position without changing, anchors auto-update in both the SQLite DB and `.purpose` files
- Handles shift + cosmetic combo (lines moved AND reformatted)
- Falls back gracefully when git is unavailable

**DriftResult v2:**
- `status`: `clean` | `cosmetic` | `shifted` | `relocated` | `modified` | `missing`
- `resolvedBy`: `exact-hash` | `normalized-hash` | `git-line-mapping` | `content-search` | `none`
- `suggestedStart`/`suggestedEnd` for shifted anchors
- `autoHealed` flag indicates whether fixes were applied
- Backwards-compatible `drifted` boolean retained

**Tool updates:**
- `paradigm_aspect_drift` gains `autoHeal` parameter (default: `true`)
- Response reports cosmetic, shifted, and modified counts separately
- Auto-healed anchors report which `.purpose` files were patched

## [3.7.0] — 2026-02-26

### Added

#### Task Management (`@a-company/paradigm-mcp` 3.6.0 → 3.7.0)

Persistent personal task tracking that survives context windows. Minimal structure, maximum linkability.

- **`paradigm_task_create`** — create a task with blurb, priority (high/medium/low), tags, and optional lore links
- **`paradigm_task_list`** — list/filter tasks by status (open/done/shelved), priority, tags; sorted by priority then date
- **`paradigm_task_update`** — update blurb, priority, status, tags, or linked assessments/lore
- **`paradigm_task_done`** — mark task complete (shorthand)
- **`paradigm_task_shelve`** — shelve a task for later (shorthand)
- Storage: `.paradigm/tasks/entries/{YYYY-MM-DD}/T-*.yaml` with auto-generated sequential IDs
- Session recovery surfaces top 5 open tasks by priority

#### Assessment Loops (`@a-company/paradigm-mcp` 3.6.0 → 3.7.0)

Threaded narrative arcs for sprint-retro-style reflection. AI-generated with human review.

- **`paradigm_assessment_record`** — add a reflection entry to an arc (auto-creates arc if new)
- **`paradigm_assessment_list`** — list arcs, or entries within an arc
- **`paradigm_assessment_get`** — get full entry or arc detail (pass `A-*` for entry, `arc-*` for arc)
- **`paradigm_assessment_search`** — cross-arc search by symbol, tag, type, or date range
- **`paradigm_assessment_arc_create`** — explicitly create an arc
- **`paradigm_assessment_arc_close`** — mark an arc complete or archived
- Entry types: `retro`, `insight`, `decision`, `milestone`
- Cross-references: linked lore entries, task IDs, and commit hashes per entry
- Globally unique entry IDs (`A-YYYY-MM-DD-NNN`) across all arcs
- Storage: `.paradigm/assessments/arcs/{arc-id}/arc.yaml` + `entries/A-*.yaml`
- Session recovery surfaces active arcs related to recovered symbols

#### Session Integration

- Recovery preamble now includes open tasks and active assessment arcs
- Breadcrumb extraction for all 11 new tools

#### Documentation & Onboarding (`@a-company/paradigm` 3.6.0 → 3.7.0, `@a-company/university` 3.5.0 → 3.7.0)

- **CLAUDE.md** — Task/assessment tools added to MCP Workflow Protocol, Token Budget, and update rules
- **README.md** — Tool count updated to 50+, key tools table and directory tree extended
- **commands.md** — Full documentation for all 11 new MCP tools with examples
- **ai-maintenance-protocol.md** — Task tracking and assessment recording workflow sections
- **init.ts** — `paradigm init` now scaffolds `tasks/` and `assessments/` directories
- **.gitignore** — `.paradigm/assessments/` added to runtime data exclusions
- **PARA 501** — Two new lessons: Task Management and Assessment Loops
- **PLSAT v3.0** — 4 new exam questions (86 → 90 slots)

## [3.6.0] — 2026-02-25

### Added

#### Schema-Driven Sentinel — Application-Agnostic Observability (`@a-company/sentinel` 3.5.0 → 3.6.0)

Sentinel is now a **schema-driven, application-agnostic observability platform**. Applications register their own event schemas (event types, temporal scopes, causal hierarchy), and Sentinel ingests, stores, queries, and visualizes any structured event data — zero knowledge of Paradigm symbols, game engines, or any domain required.

- **Schema Registry** — `EventSchemaDeclaration` with scope declarations, event type definitions, causality tracking, and visualization hints
- **SQLite v5 migration** — New `schemas` and `events` tables with 7 indexes (schema, type, scope, scope ordinal, session, timestamp, service)
- **Storage methods** — `registerSchema()`, `getSchema()`, `listSchemas()`, `insertEventBatch()`, `queryEvents()`, `queryEventsByScope()`, `getEventScopes()`, `getEventCount()`, `pruneEvents()`
- **Built-in Paradigm schema** — Existing log/metric/trace types registered as informational schema (`PARADIGM_SCHEMA`)

#### Server API Routes (`@a-company/sentinel` 3.5.0 → 3.6.0)
- `POST /api/schemas` — Register/update event schema (upsert by id)
- `GET /api/schemas` — List all registered schemas
- `GET /api/schemas/:id` — Get specific schema
- `POST /api/events` — Batch event ingestion with schema validation
- `GET /api/events` — Query events with filters (schema, type, category, scope, severity, time range, full-text search)
- `GET /api/events/scopes` — Scope summaries with category breakdowns
- `GET /api/events/scope/:value` — All events within a single scope value
- **WebSocket broadcast** — `type: 'event'` messages for real-time streaming
- **JSON-RPC handlers** — `query_events` and `query_scopes` over WebSocket

#### Browser Transport — `@a-company/sentinel-web` 0.1.0 (NEW)
- **Zero-dependency browser client** for schema-driven event ingestion
- `SentinelWebClient` — sync `emit()`, ring buffer batching, periodic `fetch()` flush, `sendBeacon()` on `beforeunload`
- `RingBuffer` — O(1) push/drain with configurable `drop-oldest`/`drop-newest` backpressure
- `registerSchema()` for client-side schema registration
- `crypto.randomUUID()` for ID generation (no uuid dependency)
- Single retry on 5xx, `onDrop`/`onError` callbacks
- ESM + CJS builds, <2KB target

#### MCP Tools (`@a-company/paradigm-mcp` 3.5.0 → 3.6.0)
- `paradigm_sentinel_schemas` — List/get registered event schemas
- `paradigm_sentinel_events` — Query generic events by schema, type, scope, time, severity
- `paradigm_sentinel_scopes` — Scope summaries with event counts and category breakdown

#### Sentinel UI — Events View (`@a-company/sentinel` 3.5.0 → 3.6.0)
- **Events tab** in Sentinel dashboard
- Schema selector dropdown
- Scope navigator (chip bar for sequential/independent scopes)
- Event table with columns adapted from schema field declarations
- Category filter chips with colors from `visualization.categoryColors`
- High-frequency types hidden by default via `visualization.defaultExcluded`
- Expandable event data rows
- Real-time WebSocket updates (subscribes to `type: 'event'` messages)

### Changed
- `@a-company/sentinel`: 3.5.0 → 3.6.0
- `@a-company/paradigm-mcp`: 3.5.0 → 3.6.0
- `@a-company/paradigm`: 3.5.0 → 3.6.0
- `@a-company/sentinel-web`: 0.1.0 (new package)

---

## [3.5.1] — 2026-02-25

### Fixed

#### ESM Bundling — Aspect Graph Tools (`@a-company/paradigm-mcp`)
- **Externalized `sql.js`** in tsup.config.ts — aspect tools (`aspect_search`, `aspect_get`, `aspect_graph`, `aspect_heatmap`, `aspect_drift`, `aspect_confirm`, `aspect_suggest_scan`) were failing with "Dynamic require of `fs` is not supported" because sql.js's Node.js loader was inlined into ESM bundle
- After fix: all 7 aspect graph MCP tools functional

#### `paradigm_related` Grep Fallback (`@a-company/paradigm-mcp`)
- **Added grep fallback** when symbol is not in index — mirrors `paradigm_ripple`'s fallback pattern
- Returns approximate `usedBy` with file locations and reference counts instead of hard "Symbol not found" error
- Clearly labeled as `status: "not-indexed"` with suggestion to run `paradigm scan`

#### Flow Index — `symbolToFlows` Empty (`@a-company/paradigm`, `@a-company/paradigm-mcp`)
- **`parseFlowSteps` now reads `component:` field** as fallback for `symbol:` — .purpose flow steps use `component: '#name'` format but indexer only checked `symbol:` field
- Fixed in both CLI (`scan/index.ts`) and MCP (`reindex.ts`) code paths
- **`paradigm index` now generates flow-index.json** — previously only `paradigm shift` and `paradigm init` generated it; added `generateFlowIndex` + `generateNavigator` to `probe/index.ts`
- Exported `generateFlowIndex` from `scan/index.ts` for reuse
- Result: 29 symbol-to-flow mappings now populated, `paradigm_flows_affected` returns real data

#### Aspects Missing from Scan Index (`@a-company/probe-core`)
- **Added `aspect` type** to `ScanCategory` union and `ScanIndex` interface
- **Added `addAspect()` handler** in `processSymbol` — aspects were extracted by premise-core but silently dropped by probe-core's generator (`default: break`)
- Result: 201 aspects now in scan-index.json alongside components, flows, gates, signals

### Added

#### Project-Level "Paragon" Fixes
- **`#purpose-parser`** declared in `packages/purpose/core/.purpose` — was referenced in lore/case studies but never indexed
- **`#sentinel-sdk`** declared as feature aggregator in `packages/sentinel/.purpose` — umbrella for `#SentinelClient` (TS) and `#SentinelRustClient` (Rust)
- **`~audit-required`** declared with code anchors in `packages/paradigm/.purpose` — anchored to `audit-logger.ts` and `agent-spawner.ts:274-288`
- **`.paradigm/flows.yaml`** — 10 formal flow definitions with symbol-typed steps: `$init-flow`, `$sync-flow`, `$probe-flow`, `$authorization-flow`, `$orchestration-flow`, `$purpose-parsing`, `$incident-triage`, `$plsat-exam-flow`, `$handoff-roundtrip`, `$wisdom-promotion`
- **Wisdom entries** — 2 antipatterns (`mcp-001`: don't bundle native modules, `mcp-002`: always add grep fallback) + 1 decision (`001`: a-paradigm must maintain 100% stress test pass rate)
- **Case studies** — `docs/case-studies/002-ripple-stress-test-post-restart.md`

### Changed
- Symbol count: 616 → 636 (CLI) / 619 (MCP)
- Scan index now includes `aspects` section (201 entries)
- Flow index `symbolToFlows` now contains 29 mappings across 6 flows

## [3.5.0] — 2026-02-25

### Added

#### Aspect Graph System (`@a-company/paradigm-mcp` 3.4.0 → 3.5.0)
- **SQLite graph engine** — `.paradigm/aspect-graph.db` stores aspects, code anchors, weighted edges, lore links, search weights, and access heatmap; rebuilt from `.purpose` files on every `paradigm_reindex`
- **Three-tier search** — learned mappings (Tier 1) → FTS5 full-text (Tier 2) → Levenshtein fuzzy (Tier 3); search quality improves over time via `paradigm_aspect_confirm` learning loop
- **Recursive ripple** — weighted BFS through aspect graph edges + symbol-index references with multiplicative decay, maxDepth/minWeight pruning, and queue limit
- **Lore bridge** — materializes links between aspects and lore decision records; infers `related-to` edges between aspects that share lore entries
- **Auto-suggest engine** — 8 regex heuristic detectors (magic numbers, hardcoded strings, rate limits, time values, env checks, feature flags, regex patterns, conditional logic) scan source files for undocumented aspects
- **Drift detection** — SHA-256 content hashing of code at anchor line ranges; `paradigm_aspect_drift` reports stale anchors
- **AspectDefinition v3.5 fields** — `value`, `category`, `severity`, `edges`, `lore` (all optional, backwards-compatible)
- **7 new MCP tools** — `paradigm_aspect_search`, `paradigm_aspect_get`, `paradigm_aspect_graph`, `paradigm_aspect_heatmap`, `paradigm_aspect_suggest_scan`, `paradigm_aspect_drift`, `paradigm_aspect_confirm`
- **Materialization in reindex** — `paradigm_reindex` now builds aspect-graph.db alongside scan-index.json, navigator.yaml, and flow-index.json

#### Logger Transport Layer (`@a-company/paradigm-logger` 1.0.0 → 1.1.0)
- **`LogTransport` interface** — pluggable transport for forwarding structured log entries to external sinks
- **`addTransport()` / `removeTransport()`** — runtime transport management on `ParadigmLogger`
- **Transport dispatch** — `SymbolLoggerImpl.emit()` forwards entries (level, symbol, symbolType, message, data, correlationId, timestamp) to all registered transports after console output

#### SentinelTransport Bridge (`@a-company/sentinel` 0.3.0 → 0.4.0)
- **`SentinelTransport`** — bridges `LogTransport` to `SentinelClient` using structural typing (no hard dependency on logger package)
- **`createSentinelTransport()`** — factory accepting `SentinelClient` or `SentinelClientOptions`
- **`enableSentinel()`** — one-liner: `enableSentinel(log, { service: 'my-app' })` attaches transport to logger
- **`./transport` sub-path export** — `import { enableSentinel } from '@a-company/sentinel/transport'`
- **Optional peer dependency** — `@a-company/paradigm-logger >=1.1.0` (optional)

#### Rust Tracing Layer (`sentinel-client` 0.1.0 → 0.2.0)
- **`SentinelLayer`** — `tracing-subscriber::Layer` implementation that forwards tracing events to Sentinel
- **Level mapping** — TRACE/DEBUG → debug, INFO → info, WARN → warn, ERROR → error
- **Symbol extraction** — uses `symbol` field from events, falls back to module path conversion (`my_app::checkout::handler` → `#checkout-handler`)
- **`tracing` feature flag** — opt-in via `sentinel-client = { features = ["tracing"] }`

#### Plugin Updates (paradigm 3.3.0 → 3.4.0)
- **`/paradigm:observe` skill** — view live logs, metrics, and traces from Sentinel; integration setup examples for TS and Rust
- **Sentinel skill** — expanded with observability cross-referencing (correlationId tracing, metrics anomaly checks)

#### Session Recovery
- **User-prompt on recovery** — `paradigm_session_recover` and auto-recovery now instruct agents to ask users whether to continue, discard, or describe a new task before proceeding

#### Full Aspect Audit — 200 aspects documented
- **19 `.purpose` files** updated with cross-cutting rules, decisions, constraints, configurations, and invariants
- **paradigm-mcp** — 54 aspects (tool cache TTLs, session tracking, aspect graph config, search config, orchestration, dispatch, reindex pipeline, MCP server config)
- **sentinel** — 58 aspects (storage schema, matcher, grouper, suggester, server config, auth, rate limiting, client SDK)
- **sentinel-rs** — 8 aspects (new `.purpose` file for Rust client SDK)
- **CLI core** — 21 aspects across 5 files (orchestration, budget, cost estimation, hook compliance, provider requirements)
- **logger** — 5 aspects (log level env resolution, format auto-detection, symbol normalization, correlation, symbol filter)
- **portal** — 18 aspects across 3 packages (core, SDK, viewer)
- **premise/purpose/probe** — 8 aspects (aggregation, parsing, scan generation)
- **university** — 4 aspects (PLSAT threshold, Fisher-Yates shuffle, variant resolution, CORS)
- **paradigm-vscode** — 6 aspects (new `.purpose` file for VS Code extension)

#### University Content Updates (`@a-company/university` 3.2.0 → 3.5.0)
- **PARA-201** — "The Aspect Graph" lesson added to intermediate course
- **PARA-501** — Expanded Sentinel Deep Dive + new "Aspect Graph at Scale" lesson
- **Reference cards** — 7 new MCP tools, Aspect Categories, Edge Relations sections
- **PLSAT v3.0** — 12 new question slots (slot-078 through slot-089) covering aspect graph, drift detection, search tiers, and lore bridge

### Fixed

#### Purpose Parser — Symbol-Prefixed YAML Keys (`@a-company/purpose-core`)
- **Regex pre-processing** — `#Foo:` → `"#Foo":` and `- !signal` → `- "!signal"` before YAML parse, fixing files using `#Component:` shorthand format
- **Normalization before validation** — top-level `#MCPServer` → `components.MCPServer` before Zod strips unknown keys
- **Result** — indexable symbols jumped from 333 → 504, aspects from 11 → 200

### Changed
- Coordinated version bumps: `@a-company/paradigm` 3.5.0, `@a-company/paradigm-mcp` 3.5.0, `@a-company/sentinel` 0.4.0, `@a-company/paradigm-logger` 1.1.0, `sentinel-client` 0.2.0, plugin 3.5.0
- `paradigm_reindex` now returns `aspectGraphStats` with aspect/anchor/edge/loreLink counts
- Premise-core aggregator passes aspect `tags` and `enforcement` through to `SymbolEntry`

#### Sentinel Observability Server (`@a-company/sentinel`)
- **Structured logging API** — `POST/GET /api/logs` with level, symbol, service, session, correlation ID filtering
- **Metrics API** — `POST/GET /api/metrics` with counter, gauge, histogram types; `GET /api/metrics/aggregate/:name` for aggregation (count, sum, min, max, avg)
- **Distributed tracing API** — `POST/GET /api/traces` with span trees, parent-child relationships, cross-service correlation
- **Service registry** — `POST/GET /api/services` with version, PID, environment, last-seen tracking
- **Live state tracking** — `POST/GET /api/state` for real-time app state snapshots with active flows and gates
- **WebSocket streaming** — Real-time broadcast of log entries, flow events, and symbol validation warnings via `ws://`
- **Auto-promote errors to incidents** — Error-level logs automatically create incidents with Sentinel's existing pattern matching
- **Symbol validation on ingestion** — Cross-references log symbols against `.purpose` index, suggests fixes for typos

#### Security & Rate Limiting
- **Bearer token auth middleware** — Permission levels (read/write/admin), token expiry, configurable per-server
- **Per-service rate limiting** — Sliding window counters (1-minute windows), sampling rate support, batch size enforcement
- **Server configuration** — `sentinel.yaml` server section with port, maxLogs, maxBatchSize, auth, rateLimit, TLS settings
- **Environment variable overrides** — `SENTINEL_PORT`, `SENTINEL_MAX_LOGS`, etc.

#### Dashboard UI
- **Logs tab** — Real-time log viewer with WebSocket streaming, level/service/search filters, auto-scroll, expandable JSON data payloads
- **Flows tab** — Live flow visualization (nodes light up as signals/gates fire) plus flow composer for creating new `$flows` from existing symbols via drag-and-drop
- **4-tab navigation** — Design, Logs, Incidents, Flows (was 2 tabs)

#### Client SDKs
- **JS/TS client** (`SentinelClient` in `@a-company/sentinel`) — Batching with ring buffer, auto-retry with exponential backoff + jitter, graceful degradation when server is down, log/metric/trace/state push APIs, `createSentinelClient()` factory
- **Rust client** (`sentinel-rs/`) — Async batching via reqwest/tokio, builder pattern, `debug`/`info`/`warn`/`error` convenience methods, counter/gauge metrics, 10 unit tests

#### MCP Tools (both `@a-company/paradigm-mcp` and standalone `sentinel-mcp`)
- `paradigm_sentinel_logs` — Query structured logs with filters
- `paradigm_sentinel_services` — List registered services
- `paradigm_sentinel_app_state` — Get live app state snapshots
- `paradigm_sentinel_validate_symbol` — Check symbol existence with typo suggestions
- `paradigm_sentinel_flow_activity` — Get recent flow events by symbol type
- `paradigm_sentinel_metrics` — Query and aggregate metrics
- `paradigm_sentinel_traces` — Query distributed traces with span trees

#### Storage
- **Schema v3 migration** — `logs`, `services`, `app_state` tables with 5 indexes
- **Schema v4 migration** — `metrics`, `traces` tables with 6 indexes
- **15+ new storage methods** — insertLog, insertLogBatch, queryLogs, getLogCount, pruneLogs, registerService, updateServiceLastSeen, getServices, upsertAppState, getAppState, getAllAppStates, insertMetric, insertMetricBatch, queryMetrics, getMetricCount, aggregateMetric, pruneMetrics, insertSpan, getTrace, queryTraces

### Changed
- `packages/sentinel/src/server/index.ts` — Rewrote to support WebSocket, shared storage instance, auth + rate-limit middleware on all observability routes
- `packages/sentinel/src/types.ts` — Extended with LogEntry, MetricEntry, TraceSpan, AuthConfig, RateLimitConfig, SentinelServerConfig (158 new lines)
- `packages/paradigm-mcp/src/tools/sentinel.ts` — Added 7 new MCP tool definitions and handlers (121 new lines)
- `packages/sentinel/src/mcp.ts` — Added matching 7 standalone MCP tools (80 new lines)

---

## [3.3.1] — 2026-02-24

### Added
- **Cursor `preToolUse` hook** — New `cursor-pretooluse.sh` fires before Edit/Write with graduated enforcement: silent for 1-2 uncovered edits, warns at 3-4, blocks (exit 2) at 5+. Unlike `afterFileEdit`, `preToolUse` can actually block the agent.
- **Cursor `postToolUse` hook** — New `cursor-posttooluse.sh` fires after Edit/Write with advisory feedback. Unlike `afterFileEdit`, `postToolUse` output is visible to the Cursor agent.

### Fixed
- **Stop hook infinite loop guard** — `cursor-stop.sh` now tracks retry count in `.paradigm/.stop-hook-active`. After 3 retries, allows session to end instead of looping forever.
- **Invisible `afterFileEdit` output** — Cursor ignores all stderr/stdout from `afterFileEdit` hooks. Moved advisory messages to `postToolUse` hook; `cursor-postwrite.sh` now only does background file tracking.

### Changed
- **`paradigm hooks install --cursor`** — Now installs 6 hooks (was 4): added `preToolUse` and `postToolUse` with `Edit|Write` matcher
- **`paradigm hooks uninstall --cursor`** — Cleans up `preToolUse` and `postToolUse` entries alongside existing hooks
- **`paradigm hooks status`** — Shows `preToolUse` and `postToolUse` hook status for Cursor
- **Cursor plugin `hooks.json`** — Added `preToolUse` and `postToolUse` entries
- **Version sync** — `@a-company/paradigm` 3.3.0 → 3.3.1, `@a-company/paradigm-mcp` 3.3.0 → 3.3.1

## [3.3.0] — 2026-02-24

### Added
- **Cursor `sessionStart` hook** — New `cursor-session-start.sh` fires before the agent does anything, injecting `additional_context` with 3 non-negotiable rules (session bookends, .purpose updates, ripple before modify), essential MCP tool signatures, and task-size tiers. Deterministic — not subject to context compaction.
- **Cursor `followup_message` compliance loop** — Stop hook now outputs `followup_message` JSON to stdout when violations are found. Cursor auto-submits this as the next user message, creating a retry loop (up to `loop_limit: 3`).
- **Cursor plugin** (`plugins/paradigm-cursor/`) — Full `.cursor-plugin/` format plugin with hooks, skills (preflight, postflight, lore, scan), MCP server config, and README. Mirrors the existing Claude Code plugin for Cursor's plugin system.
- **Dual-plugin hook generation** — `generate-hooks.mjs` now copies scripts to both `plugins/paradigm/scripts/` (Claude Code) and `plugins/paradigm-cursor/scripts/` (Cursor) as the single source of truth.

### Changed
- **`paradigm hooks install --cursor`** — Now installs 4 hooks (was 3): added `sessionStart` with `paradigm-session-start.sh`; stop hook entry includes `loop_limit: 3`
- **`paradigm hooks uninstall --cursor`** — Cleans up `sessionStart` entries alongside existing hooks
- **`paradigm hooks status`** — Shows `sessionStart` hook status for Cursor
- **Version sync** — `@a-company/paradigm` 3.2.1 → 3.3.0, `@a-company/paradigm-mcp` 3.2.1 → 3.3.0

## [3.2.1] — 2026-02-24

### Added
- **`paradigm-workflow.mdc`** — New Cursor rule file (`alwaysApply: true`) with session bookends, graduated task-size compliance guide, essential MCP tools table, and non-negotiable `.purpose` update rule
- **`paradigm-practices.mdc`** — New Cursor rule file consolidating Phase 5/6 content (habits compliance, lore recording, llms.txt) — closes parity gap with AGENTS.md

### Changed
- **`paradigm-agent-hints.mdc`** — Rewritten to be MCP-first: all CLI command references (`paradigm ripple --json`, `paradigm echo --json`, `jq` queries) replaced with MCP tool calls (`paradigm_ripple()`, `paradigm_search()`, `paradigm_navigate()`)
- **`paradigm-core.mdc`** — Added "CRITICAL RULES (Non-Negotiable)" section with 3 MUST-follow bullets and reference to workflow file
- **Cursor adapter** generates 15 rule files (was 13)

## [3.2.0] — 2026-02-24

### Added

#### Phase 1: Type Safety & Quick Wins
- **Typed interfaces** — Replaced `any` types across `portal/watch.ts`, `mcp/switch.ts`, `mcp/setup.ts`, and `tutorial/index.ts` with proper typed interfaces
- **Actionable sentinel errors** — Generic catch in `sentinel.ts` now provides specific error messages with remediation steps
- **v2-only symbol validation** — `parseSymbol` in `flow-schema.ts` now rejects deprecated v1 prefixes (`@`, `%`, `?`, `&`)

#### Phase 2: Validation & Safety Hardening
- **Circular dependency detection** — DFS-based cycle detection in `flow-validator.ts`; reports cycles in `AllFlowsValidationResult`
- **Lore symbol validation** — `recordLore()` optionally validates `symbols_touched` against registered .purpose, flow, and portal symbols
- **`--dry-run` flag** — Added to `hooks install`, `hooks uninstall`, `lore delete`, and `upgrade` commands
- **`.purpose` file checking** — `symbolExistsInCode` now checks .purpose declarations in addition to source code grep
- **Hook syntax validation** — `bash -n` check on generated hook scripts before writing

#### Phase 3: Habits, Sentinel & Doctor Expansion
- **4 new habit check types** — `commit-message-format`, `flow-coverage`, `context-checked`, `aspect-anchored` with evaluators and seed definitions
- **Configurable sentinel grouping** — `SIMILARITY_THRESHOLD`, time-decay weighting, stack trace fingerprinting in `grouper.ts`
- **Escalation strategy inference** — `suggester.ts` infers strategy (`fix-code`, `rollback`, `config-change`, `scale-up`, `investigate`) instead of hardcoded `fix-code`
- **6 new doctor checks** — Portal.yaml validity, flows.yaml validation, lore health, hook freshness, habits config validity, AGENTS.md staleness

#### Phase 4: Portal, Lint & Pre-Publish
- **Portal test auto-generation** — `portal test` introspects gate `check` expressions to auto-generate test fixtures
- **Portal export** — `paradigm portal export` subcommand outputs gates/routes in csv, json, or markdown format
- **`lint --auto-populate`** — Scans source directories for undocumented components, suggests `.purpose` entries, writes drafts with `--fix`
- **Pre-publish check script** — `scripts/pre-publish-check.mjs` validates builds, version consistency, changelogs, doctor, and plugin hooks.json

#### Phase 5: Documentation Standards & AI Interop
- **`paradigm sync-llms`** — Generates `llms.txt` at repo root with symbols, key files, flows, gates, and conventions
- **AGENTS.md expansion** — Generated AGENTS.md now includes habits compliance, lore recording, session checkpoints, and llms.txt sections
- **`paradigm flow diagram`** — CLI command generates Mermaid flowchart from flow definitions (diamonds for gates, rectangles for actions, rounded boxes for signals)
- **Enhanced MCP tool descriptions** — 52 tools across 14 modules updated with return data shape, usage guidance, and token cost estimates
- **Expanded patterns.md** — 4 new patterns: multi-agent handoff, lore recording, habit compliance, flow-first development
- **Expanded ai-maintenance-protocol.md** — Decision trees for lore recording, flow creation, and new feature compliance checklist

#### Phase 6: Advanced Intelligence
- **ToolCache** — In-memory TTL cache (30s default) for `paradigm_search`, `paradigm_status`, and `paradigm_navigate` MCP tools; cleared on `paradigm_reindex`
- **Plugin version compatibility** — `hooks install` checks `compatibleVersions` field in plugin `hooks.json` and warns if Paradigm version is outside the min/max range
- **Co-authorship tracking** — `assistedBy` field on `LoreEntry` with type (`agent`/`tool`/`human`), id, and optional role
- **Auto-lore drafting** — `draftLoreFromBreadcrumbs()` generates partial lore entries from session data when 3+ files are modified; tagged with `auto-draft`
- **Configurable limits** — `LimitsConfig` in `.paradigm/config.yaml` for `habitsCacheTtlMs`, `breadcrumbsMax`, `threadTrailMax`, `toolCacheTtlMs`, `checkpointMaxAgeMs`
- **`paradigm global clean`** — Cleans old files from `~/.paradigm/` Global Brain directories with `--older-than` duration and `--dry-run` preview
- **Integration tests** — 4 new test files (13 tests) for build verification, hook validation, ToolCache, and auto-lore drafting

### Changed

- **MCP tool caching** — `paradigm_search`, `paradigm_status`, and `paradigm_navigate` now return cached results within TTL window for repeated calls
- **Habits cache** — TTL now configurable via `limits.habitsCacheTtlMs` (default 30000ms) instead of hardcoded
- **Thread trail depth** — Configurable via `limits.threadTrailMax` (default 10) instead of hardcoded `.slice(-10)`
- **Version sync** — `@a-company/paradigm` 3.1.6 → 3.2.0, `@a-company/paradigm-mcp` 3.1.6 → 3.2.0, `@a-company/sentinel` 0.2.0 → 0.3.0, `@a-company/university` 3.1.2 → 3.2.0

### Documentation

- **New specs** — `caching.md` (MCP tool caching strategy), `habits.md` (all check types and semantics), `publishing.md` (pre-publish validation)
- **Updated specs** — `symbols-v2.md` (v2-only prefixes), `history.md` (auto-lore + co-authorship), `portal-validation.md` (test generator + webhook config)
- **Updated docs** — `commands.md` (new commands), `troubleshooting.md` (new error messages), `error-patterns.md` (actionable error patterns)
- **CLAUDE.md** — Added MCP Tool Caching and Plugin Version Compatibility sections

### University

- **PARA 101** — Added `llms.txt` key concept to project structure lesson
- **PARA 201** — Added Mermaid flow visualization key concept; circular dependency detection content
- **PARA 301** — Added sentinel escalation strategies, doctor checks, `lint --auto-populate` content
- **PARA 401** — Enhanced MCP tools overview; new `agent-interop` lesson covering AGENTS.md and llms.txt
- **PARA 501** — Added 4 new habit check types, lore symbol validation, co-authorship content
- **PLSAT v3.0** — 16 new exam slots (slots 062-077) with 28 question variants covering all 6 phases
- **Reference card** — Added cards for `sync-llms`, `flow diagram`, `portal export`, `lint --auto-populate`, `global clean`, and configurable limits

## [3.1.6] — 2026-02-24

### Added

- **Plugin auto-update checker** — On the first MCP tool call of each session, reads stored check results from `~/.paradigm/plugin-update-check.json` and prepends an update notice to the response if installed plugins are behind their remote. Fires a background check (throttled to 6h) for next session. New `paradigm_plugin_check` MCP tool for manual checks. New `paradigm plugin check` CLI command with `--update` flag to pull latest for stale marketplace clones.

### Fixed

- **Stale project hooks no longer shadow plugin hooks** — When the Paradigm plugin is active in Claude Code, `paradigm hooks install` now detects this and skips project-level hook installation. Any existing stale `.claude/hooks/` scripts and `settings.json` hook entries are cleaned up automatically. This fixes the root cause where project-level hook copies (from a previous `paradigm hooks install`) would run outdated logic instead of the plugin's always-current `${CLAUDE_PLUGIN_ROOT}/scripts/` hooks.
- **Stop hook: lore check now finds MCP-written entries** — Check 7 (lore entry required for 3+ source file sessions) previously only looked in `git diff` output for lore files. MCP-written lore entries go to disk but aren't staged, so the check always failed. Now also checks for lore entries on disk with today's date. Fixes the loop where agents record lore but the hook keeps blocking.

### Changed

- **`paradigm hooks status` shows plugin state** — When the plugin is active, displays the cached version and warns about any stale project hooks. When the plugin is not active, shows the traditional project-level hooks status.
- **Version sync** — `@a-company/paradigm` 3.1.4 → 3.1.6, `@a-company/paradigm-mcp` 3.1.3 → 3.1.6, plugin 3.1.4 → 3.1.6.

## [3.1.4] — 2026-02-23

### Changed

- **Hook scripts: single source of truth** — Extracted 6 inline hook constants (~900 lines) from `index.ts` into standalone `.sh` files in `src/commands/hooks/scripts/`. New `generate-hooks.mjs` codegen script reads canonical `.sh` files, generates `generated-hooks.ts` for the TypeScript build, and copies Claude Code scripts to `plugins/paradigm/scripts/`. Eliminates drift between CLI-installed hooks and plugin-shipped hooks.
- **Version sync** — `@a-company/paradigm` 3.1.3 → 3.1.4, `@a-company/paradigm-mcp` 3.1.2 → 3.1.3.

### Fixed

- **Stop hook: dual anchor path resolution** — Check 4 (stale aspect anchors) now tries both `.purpose`-dir-relative AND project-root-relative resolution. Handles both conventions: monorepo packages use `src/file.ts` (relative to package `.purpose`), while some projects write `src/lib/stores/file.ts` (root-relative) in sub-directory `.purpose` files. Only reports a violation if neither resolves.
- **MCP: `paradigm_purpose_add_aspect` validates and auto-corrects anchor paths** — If an anchor is written project-root-relative but the `.purpose` file is in a subdirectory, the tool auto-converts to the correct `.purpose`-dir-relative path. If the file doesn't exist at all, it errors at write time instead of silently writing a broken anchor.

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
