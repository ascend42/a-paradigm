# Paradigm — Cursor Plugin

AI-native project architecture for Cursor. Deterministic enforcement hooks,
50+ MCP tools, and compliance skills for symbol-driven development.

## Installation

Copy or symlink this directory into your project as `.cursor-plugin/paradigm/`,
or install via `paradigm hooks install --cursor` for per-project hook injection.

## What You Get

### Enforcement Hooks (deterministic)

| Hook | Event | Behavior |
|---|---|---|
| sessionStart | Before agent acts | Injects mandatory Paradigm protocol as `additional_context` |
| stop | Session end | **Blocks** if source files modified without .purpose updates, missing portal.yaml, no lore entry. Outputs `followup_message` for auto-retry (up to 3 loops). |
| afterFileEdit | After file edits | Advisory reminder about .purpose coverage |
| beforeShellExecution | Before `git commit` | Auto-rebuilds symbol index before commits |

### 50+ MCP Tools (automatic)

All tools are available via the MCP server — no configuration needed:

| Category | Tools | Purpose |
|---|---|---|
| Core | `paradigm_status`, `paradigm_search`, `paradigm_ripple`, `paradigm_related` | Symbol discovery and impact analysis |
| Navigation | `paradigm_navigate` | Find, explore, and get context for symbols |
| Purpose Management | `paradigm_purpose_*` (13 tools) | Create and manage .purpose files |
| Portal / Auth | `paradigm_portal_*`, `paradigm_gates_for_route` | Authorization gate management |
| Wisdom | `paradigm_wisdom_*` (4 tools) | Team learning — antipatterns and decisions |
| History | `paradigm_history_*` (4 tools) | Implementation tracking and fragility scores |
| Flows | `paradigm_flows_affected`, `paradigm_flow_validate` | Multi-step flow validation |
| Sentinel | `paradigm_sentinel_*` (8 tools) | Incident tracking and pattern detection |
| Lore | `paradigm_lore_*` (3 tools) | Project timeline and session recording |
| Orchestration | `paradigm_orchestrate_inline`, `paradigm_agent_prompt` | Multi-agent task coordination |
| Governance | `paradigm_pm_preflight`, `paradigm_pm_postflight` | Pre/post-task compliance |
| Tags | `paradigm_tags`, `paradigm_tags_suggest` | Symbol classification |
| Context | `paradigm_context_check`, `paradigm_session_*`, `paradigm_handoff_prepare` | Session management |
| Index | `paradigm_reindex` | Rebuild symbol index |

### Skills

| Skill | Purpose |
|---|---|
| `preflight` | Pre-task compliance check |
| `postflight` | Post-task compliance check |
| `lore` | Record a lore entry for the current session |
| `scan` | Rebuild symbol index after file changes |

## How Enforcement Works

Cursor's `.mdc` rules are **probabilistic** — agents can and do ignore them.
Paradigm's hooks are **deterministic** — they execute as shell scripts at
guaranteed lifecycle points.

### The Compliance Loop

1. **sessionStart** injects `additional_context` with the 3 non-negotiable rules
2. **afterFileEdit** tracks every source file modification
3. **stop** validates compliance and outputs `followup_message` if violations found
4. Cursor auto-submits the `followup_message` as the next user message
5. The agent fixes violations and tries to finish again
6. After 3 failed loops (`loop_limit`), the session ends with violations listed

### Task-Size Tiers

| Files Modified | Required Actions |
|---|---|
| 1 file | Session bookends (recover + postflight) |
| 2-3 files | + ripple before modify + update .purpose files |
| 3+ files | + full workflow (ripple, .purpose, lore entry, portal.yaml for routes) |

## Per-Project Installation

For projects that want hooks without the plugin:

```bash
npx @a-company/paradigm hooks install --cursor
```

This copies hook scripts to `.cursor/hooks/` and creates `.cursor/hooks.json`.

## Requirements

- Cursor 2.5 or later (for plugin + hook support)
- Node.js >= 18
- `@a-company/paradigm` npm package (auto-installed via `npx`)

## Links

- [GitHub](https://github.com/ascend42/a-paradigm)
- [npm](https://www.npmjs.com/package/@a-company/paradigm)
