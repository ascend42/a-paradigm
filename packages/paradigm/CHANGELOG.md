# Changelog

All notable changes to Paradigm will be documented in this file.

## [Unreleased]

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
