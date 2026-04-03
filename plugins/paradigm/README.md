# Paradigm — Claude Code Plugin

AI-native project architecture for Claude Code. One install gives you structured
context, enforcement hooks, multi-agent orchestration, and 50+ MCP tools.

## Installation

```
/plugin marketplace add ascend42/a-paradigm
/plugin install paradigm@a-paradigm
```

Restart Claude Code after installing. The MCP server starts automatically.

## What You Get

### 50+ MCP Tools (automatic)

All tools are available immediately — no configuration needed:

| Category | Tools | Purpose |
|---|---|---|
| Core | `paradigm_status`, `paradigm_search`, `paradigm_ripple`, `paradigm_related` | Symbol discovery and impact analysis |
| Navigation | `paradigm_navigate` | Find, explore, and get context for symbols |
| Purpose Management | `paradigm_purpose_*` (13 tools) | Create and manage .purpose files |
| Portal / Auth | `paradigm_portal_*`, `paradigm_gates_for_route` | Authorization gate management |
| Wisdom | `paradigm_wisdom_*` (4 tools) | Team learning — antipatterns and decisions |
| History | `paradigm_history_*` (4 tools) | Implementation tracking and fragility scores |
| Flows | `paradigm_flows_affected`, `paradigm_flow_check` | Multi-step flow validation |
| Sentinel | `paradigm_sentinel_*` (8 tools) | Incident tracking and pattern detection |
| Lore | `paradigm_lore_*` (3 tools) | Project timeline and session recording |
| Orchestration | `paradigm_orchestrate_inline`, `paradigm_agent_prompt` | Multi-agent task coordination |
| Governance | `paradigm_pm_preflight`, `paradigm_pm_postflight` | Pre/post-task compliance |
| Tags | `paradigm_tags`, `paradigm_tags_suggest` | Symbol classification |
| Context | `paradigm_session_health`, `paradigm_session_*`, `paradigm_handoff_prepare` | Session management |
| Index | `paradigm_reindex` | Rebuild symbol index |

### Skills (user-invoked)

| Skill | Purpose |
|---|---|
| `/paradigm:init` | Initialize Paradigm in the current project |
| `/paradigm:shift` | Full one-command setup (init + scan + hooks + CLAUDE.md) |
| `/paradigm:scan` | Rebuild symbol index after file changes |
| `/paradigm:doctor` | Health check for Paradigm configuration |
| `/paradigm:lore` | Record a lore entry for the current session |
| `/paradigm:preflight` | Pre-task compliance check |
| `/paradigm:postflight` | Post-task compliance check |
| `/paradigm:sentinel` | Triage and manage incidents |

### Agents (specialized subagents)

| Agent | Model | Purpose |
|---|---|---|
| `architect` | inherit | System design, architecture planning, impact analysis |
| `builder` | inherit | Implementation, coding, file changes |
| `tester` | inherit | Test writing, test execution, coverage |
| `reviewer` | inherit | Code review, quality analysis (read-only) |
| `security` | inherit | Security analysis, auth review (read-only) |

### Hooks (automatic enforcement)

| Hook | Event | Behavior |
|---|---|---|
| Stop | Session end | **Blocks** if source files modified without .purpose updates, missing portal.yaml, no lore entry |
| PreToolUse | Before `git commit` | Auto-rebuilds symbol index before commits |
| PostToolUse | After file edits | Advisory reminder about .purpose coverage |

## Getting Started

After installing the plugin:

1. **New project**: Run `/paradigm:init` or `/paradigm:shift` for full setup
2. **Existing project**: If already using Paradigm, see [Migration](#migrating-from-per-project-setup)

## Migrating from Per-Project Setup

If your project already has Paradigm configured with per-project MCP and hooks,
remove the overlap to avoid duplication:

1. **Remove Claude Code hooks** (plugin provides these now):
   ```bash
   rm .claude/hooks/paradigm-stop.sh
   rm .claude/hooks/paradigm-precommit.sh
   rm .claude/hooks/paradigm-postwrite.sh
   ```

2. **Remove paradigm-mcp from .mcp.json** (plugin provides the MCP server):
   - Edit `.mcp.json` and remove the `paradigm-mcp` entry
   - Keep other entries (like `atelier-mcp`)

3. **Keep everything else** — CLAUDE.md, .paradigm/, portal.yaml, .cursor/hooks/,
   .git/hooks/ are all per-project and don't overlap with the plugin.

## Skill-to-Tool Mapping

For maintenance reference — which MCP tools each skill uses:

| Skill | MCP Tools Used |
|---|---|
| `/paradigm:init` | `paradigm_status`, Bash (`npx @a-company/paradigm init`, `scan`) |
| `/paradigm:scan` | `paradigm_reindex` |
| `/paradigm:doctor` | `paradigm_status`, `paradigm_purpose_validate`, `paradigm_navigate` |
| `/paradigm:lore` | `paradigm_lore_record`, Bash (`git diff --stat`) |
| `/paradigm:shift` | Bash (`npx @a-company/paradigm shift`) |
| `/paradigm:preflight` | `paradigm_pm_preflight` |
| `/paradigm:postflight` | `paradigm_pm_postflight` |
| `/paradigm:sentinel` | `paradigm_sentinel_triage`, `paradigm_sentinel_stats` |

## Recommended Agent Models

All agents default to `inherit` (your configured model). For optimal results:

| Agent | Recommended Model | Rationale |
|---|---|---|
| architect | Opus | Complex reasoning, architectural decisions |
| builder | Sonnet | Fast iteration, high volume code changes |
| tester | Sonnet | Test writing is pattern-heavy, speed matters |
| reviewer | Opus | Nuanced quality analysis |
| security | Opus | Security requires thoroughness over speed |

## Requirements

- Claude Code 1.0.33 or later
- Node.js >= 18
- `@a-company/paradigm` npm package (auto-installed via `npx`)

## Links

- [GitHub](https://github.com/ascend42/a-paradigm)
- [npm](https://www.npmjs.com/package/@a-company/paradigm)
- [Plugin Marketplace Plan](https://github.com/ascend42/a-paradigm/blob/main/docs/PLUGIN-MARKETPLACE-PLAN.md)
