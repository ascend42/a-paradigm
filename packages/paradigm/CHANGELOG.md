# Changelog

All notable changes to Paradigm will be documented in this file.

## [Unreleased]

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
