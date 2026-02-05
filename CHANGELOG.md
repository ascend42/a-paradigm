# Changelog

All notable changes to Paradigm will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
