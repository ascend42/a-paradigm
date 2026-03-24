# Changelog

All notable changes to Paradigm will be documented in this file.

## [5.8.0] — 2026-03-23

### Added

- **Canvas — Visual Design Editor (Sprint 0)** — New Platform section for creating UI layouts with real CSS output
  - Craft.js-powered design editor embedded as a `▦` Canvas section in `paradigm serve`
  - 5 draggable building blocks: Container (flexbox), Text (inline-editable), Button, Image, Spacer
  - Full CSS property panel: Layout (flex direction, justify, align, gap, wrap), Spacing (4-sided padding/margin), Size (width, height, min/max, overflow), Typography (font size, weight, family, color, align, line-height), Background (color picker, opacity), Border (width, style, color, radius)
  - Component palette (left panel) with drag-and-drop onto the design canvas
  - `*.canvas` files — first-class YAML project objects, discovered via glob, git-tracked by default
  - Backend CRUD API: `GET/PUT/DELETE /api/canvas/files/*` with path traversal protection
  - Zustand store with debounced auto-save (500ms), localStorage last-opened memory
  - Design/Preview mode toggle, Undo/Redo via Craft.js history
  - Custom node renderer with selection outlines, hover indicators, and inline delete
  - RenderNode toolbar showing component type labels on selection
  - 15 Paradigm components, 3 flows, 3 gates, 6 signals, 4 aspects registered
  - `.purpose` files for full symbolication coverage
  - **31.7KB gzipped** — lazy-loaded, zero impact on other sections

## [Unreleased]

### Added

- **Lore System** — Unified project timeline with queryable history
  - YAML storage with date-partitioned entries (`.paradigm/lore/entries/YYYY-MM-DD/`)
  - 3 MCP tools: `paradigm_lore_search`, `paradigm_lore_record`, `paradigm_lore_timeline`
  - 5 CLI commands: `lore`, `lore record`, `lore show`, `lore review`, `lore timeline`
  - Timeline UI (lore-ui) — single-page Preact app served via `paradigm lore --ui`
  - Auto-scaffolding: `paradigm shift` creates `.paradigm/lore/` directory
  - MCP safety annotations (`readOnlyHint`, `destructiveHint`) across 100+ tools
  - 39 new tests (storage: 19, filter: 20)
  - CLAUDE.md template updated with Lore section, MCP tool references, and recording guidance

- **Sentinel Phase 1** — Standalone incident tracking SDK
  - SDK, CLI, MCP server, and framework adapters (Express, Fastify, Hono)
  - Pattern-based failure detection with confidence scores
  - Incident recording, triage, and resolution workflows

### Changed

- **Distribution pipeline** — lore-ui/dist now included in `paradigm promote`
- **`paradigm shift`** — creates `.paradigm/lore/` directory, lists it in summary output
- **CLAUDE.md template** — added Lore section with MCP tools, CLI commands, and recording guidance; added lore rows to MCP Workflow Protocol and Maintaining Paradigm Files tables; added `.paradigm/lore/` to Quick Orientation

### Fixed

- **`minimatch` runtime resolution** — installed at root level to fix `ERR_MODULE_NOT_FOUND` when running promoted `paradigm` CLI (was externalized but not available outside pnpm workspace)

### Changed

- **npm publish ready** — Single `npm i -g @a-company/paradigm` installs both `paradigm` CLI and `paradigm-mcp` server as global commands
  - All internal `@a-company/*` workspace dependencies bundled via `noExternal` in tsup — zero runtime dependency on unpublished packages
  - MCP server built as second entry point (`dist/mcp.js`) alongside CLI (`dist/index.js`)
  - Added `@modelcontextprotocol/sdk` and `zod` as runtime deps (MCP server externals)
  - `@a-company/paradigm-mcp` marked private (now bundled, not published separately)
  - Optional commands (`sentinel`, `university`) gracefully detect missing packages with install instructions
  - CI workflow fixed: `@horizon/cli` → `@a-company/paradigm`
  - Deleted stale changeset referencing old `@horizon/*` package names

### Added

- **Discipline System** — Auto-detection and per-discipline configuration
  - New `detectDiscipline()` function examines project files (package.json, Cargo.toml, go.mod, pyproject.toml, etc.) to infer project type
  - 14 disciplines: `web`, `backend`, `fullstack`, `api`, `cli`, `ml`, `mobile`, `game`, `embedded`, `devops`, `data`, `library`, `monorepo`, `custom` (plus `auto`)
  - Per-discipline symbol mappings — each discipline gets tailored `logging.symbol-mapping` and `purpose-required` patterns (e.g., ML projects map `models/**`, `experiments/**`, `notebooks/**`; game projects map `entities/**`, `systems/**`, `gameplay/**`)
  - `paradigm init` auto-detects discipline and populates config.yaml with discipline-specific settings
  - `paradigm shift` detects discipline for existing projects with `discipline: auto` and updates config in place
  - `paradigm scan` loads discipline from config and merges discipline-specific scan patterns
  - `Discipline` type added to canonical `ParadigmConfig` interface
  - Template `disciplines.md` rewritten for v2 with all 14 disciplines documented

### Changed

- **context-builder.ts cleanup** — removed local `ParadigmConfig` interface (imports canonical type), removed v1 symbol prefixes (`@`, `%`, `&`, `?`) from `SYMBOL_PATTERN` regex, fixed `~` mapping from 'deprecated' to 'aspect'

- **Claude Code Agent Teams Provider** (`claude-code-teams`)
  - New provider for Claude Code's experimental Agent Teams feature
  - Native parallel teammate spawning via shared task lists
  - Role-specific constraints (design-only for architect/security)
  - Delegate mode support for team leads
  - Enable with `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`

### Changed

- **Orchestration Enforcement** — agents now call `paradigm_orchestrate_inline` for complex tasks
  - CLAUDE.md template: added "Before Implementing" pre-task checklist with orchestration triggers
  - CLAUDE.md template: added orchestration rows to MCP Workflow Protocol table
  - CLAUDE.md template: rewrote Multi-Agent Orchestration section from informational to prescriptive
  - Tool description updated from "IMPORTANT" to "REQUIRED before implementing features" with examples

- **Classification→Planning Disconnect Fix**
  - `planAgentSequence` now uses `classifyTaskLocal()` output for agent selection
  - Analysis tasks → architect only (was: architect+builder+tester)
  - Documentation tasks → architect only (was: architect+builder+tester)
  - Bug fixes → security+builder (was: architect+builder+tester)
  - Feature tasks → full team (unchanged)

- **IDE-Aware Execute Mode**
  - Execute mode now returns dual-format output for any IDE
  - `claudeCode`: Task tool instructions for Claude Code
  - `sequential`: Step-by-step role adoption for Cursor and other IDEs
  - `cli`: `paradigm team orchestrate` command for terminal-based parallelism
  - Removed Claude Code-specific `taskToolExample`

- **Cursor Orchestration Support**
  - `.mdc` template: replaced "Use Task tool" (unreachable in Cursor) with sequential self-orchestration
  - `.mdc` template: references `paradigm team orchestrate` for true parallel execution

- **Provider Cascade** — updated to 6 providers
  - New order: `claude → claude-code-teams → claude-code → cursor-cli → claude-cli → manual`

### Fixed

- **Cursor CLI Model Mapping** — updated from deprecated model IDs
  - `opus`: `claude-3.5-opus` → `claude-opus-4-6`
  - `sonnet`: `claude-3.5-sonnet` → `claude-sonnet-4-5-20250929`
  - `haiku`: `claude-3.5-haiku` → `claude-haiku-4-5-20251001`

---

## [1.4.0]

### Added

- **Multi-Agent Orchestration** (`paradigm team orchestrate`)
  - AI orchestrator (Claude) coordinates specialized agents
  - Solo mode: single Claude handles entire task
  - Faceted mode: multiple agents with specialized roles
  - A/B comparison mode (`--compare`) to empirically test approaches
  - Parallel agent execution support

- **Agent Spawning** (`paradigm team spawn`)
  - Spawn individual agents with specific tasks
  - Model selection per agent (opus, sonnet, haiku)
  - Streaming output with live progress
  - Checkpoint support for human approval

- **Provider Cascade System**
  - Trickle-down provider selection for maximum accessibility
  - Priority: `claude` (API) → `claude-code` (Max) → `claude-cli` → `manual`
  - User-configurable via env, config, or CLI flag
  - `paradigm team providers` command to view/set preference

- **Facet Configuration**
  - Role-specific context (only load relevant files per agent)
  - Per-facet token limits and budgets
  - Protocol definitions (relay format, handoff rules)
  - Default model assignments per role

- **Budget Controls**
  - Per-orchestration token and cost limits
  - Per-agent limits
  - Warning thresholds
  - Real-time cost tracking

- **Audit Logging**
  - Full orchestration logs in `.paradigm/orchestrations/`
  - Agent-level metrics (tokens, duration, artifacts)
  - Cost breakdown per agent and total

### Configuration

New settings in `.paradigm/config.yaml`:
```yaml
# Agent provider selection
agent-provider: auto  # auto, claude, claude-code, claude-cli, manual
```

New settings in `.paradigm/agents.yaml`:
```yaml
agents:
  architect:
    defaultModel: opus
    context:
      include: [specs/*.md, .purpose]
      exclude: [src/**, tests/**]
    limits:
      maxTokens: 100000
    protocol:
      relay: structured
```

### Commands

| Command | Description |
|---------|-------------|
| `paradigm team spawn <agent> --task "..."` | Spawn a single agent |
| `paradigm team orchestrate "task"` | Orchestrate multi-agent task |
| `paradigm team orchestrate "task" --solo` | Single Claude mode |
| `paradigm team orchestrate "task" --compare` | A/B test solo vs faceted |
| `paradigm team providers` | Show available providers |
| `paradigm team providers --set X` | Set preferred provider |
| `paradigm team cost` | View cost summary |
| `paradigm team export` | Export orchestration data |

### Environment Variables

| Variable | Description |
|----------|-------------|
| `ANTHROPIC_API_KEY` | Required for `claude` provider |
| `PARADIGM_AGENT_PROVIDER` | Override provider selection |
