# Changelog

All notable changes to Paradigm will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
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

### Changed
- **README.md** - Complete rewrite reflecting evolved project
  - Better value proposition and problem statement
  - Comprehensive command reference organized by category
  - Agent efficiency features prominently featured
  - IDE support and migration documentation
  - Cleaner structure with practical examples

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
