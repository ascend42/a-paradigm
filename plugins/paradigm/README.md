# Paradigm — Claude Code Plugin

AI-native project architecture for Claude Code. One install gives you structured
context, enforcement hooks, multi-agent orchestration, and 50+ MCP tools — in
every project, automatically.

## Installation

```
/plugin marketplace add ascend42/a-paradigm
```

Restart Claude Code after installing. The MCP server and enforcement hooks start automatically.

## What You Get

### Enforcement Hooks (deterministic)

| Hook | Event | Behavior |
|---|---|---|
| Stop | Session end | Validates compliance at session end. With the default `none` enforcement preset, runs advisory-only. Activate checks via `paradigm presets` or by rostering Rune (`paradigm shift`). |
| PreToolUse | Before `git commit` | Auto-rebuilds symbol index before commits |
| PostToolUse | After file edits | Advisory reminder about .purpose coverage |

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
| Sentinel | `paradigm_sentinel_*` (18 tools) | Incident tracking and pattern detection |
| Lore | `paradigm_lore_*` (8 tools) | Project timeline and session recording |
| Orchestration | `paradigm_orchestrate_inline`, `paradigm_agent_prompt` | Multi-agent task coordination |
| Governance | `paradigm_pm_preflight`, `paradigm_pm_postflight` | Pre/post-task compliance |
| Tags | `paradigm_tags`, `paradigm_tags_suggest` | Symbol classification |
| Context | `paradigm_session_health`, `paradigm_session_*`, `paradigm_handoff_prepare` | Session management |
| Index | `paradigm_reindex` | Rebuild symbol index |

### Skills (user-invoked)

| Skill | Purpose |
|---|---|
| `/paradigm:shift` | Full one-command setup (init + scan + hooks + CLAUDE.md) |
| `/paradigm:init` | Minimal init — initialize Paradigm structure only |
| `/paradigm:scan` | Rebuild symbol index after file changes |
| `/paradigm:doctor` | Health check for Paradigm configuration |
| `/paradigm:lore` | Record a lore entry for the current session |
| `/paradigm:preflight` | Pre-task compliance check |
| `/paradigm:postflight` | Post-task compliance check |
| `/paradigm:review` | Review recent changes for Paradigm compliance and quality |
| `/paradigm:sentinel` | Triage and manage incidents |
| `/paradigm:observe` | View live logs, metrics, and traces from Sentinel |
| `/paradigm:agents` | Manage your agent team — roster, onboard, bench/activate |
| `/paradigm:teach` | Teach an agent a new behavior or pattern |
| `/paradigm:team` | Show what your agent team did this session |
| `/paradigm:health` | Agent learning health dashboard |
| `/paradigm:ripple` | Impact analysis before modifying a symbol |
| `/paradigm:protocol` | Search for or record a repeatable implementation protocol |
| `/paradigm:handoff` | Prepare a context handoff for the next session |
| `/paradigm:conduct` | Register this session with Conductor |

### Agents (specialized subagents)

| Agent | Model | Purpose |
|---|---|---|
| `architect` | inherit | System design, architecture planning, impact analysis |
| `builder` | inherit | Implementation, coding, file changes |
| `tester` | inherit | Test writing, test execution, coverage |
| `reviewer` | inherit | Code review, quality analysis (read-only) |
| `security` | inherit | Security analysis, auth review (read-only) |
| `documentor` | inherit | Updates .purpose files and portal.yaml after implementation (always runs last) |
| `ftux` | inherit | First-time user experience simulation — surfaces onboarding friction |
| `captain` | inherit | Navigation, coverage tracking, session recovery |

## Getting Started

After installing the plugin:

1. **New project**: Run `/paradigm:shift` for full setup (or `/paradigm:init` for a minimal init only)
2. **Existing project**: If already using Paradigm, see [Migrating from Per-Project Setup](#migrating-from-per-project-setup)

## How Enforcement Works

CLAUDE.md is **advisory** — agents can and do ignore it. Paradigm's hooks are
**deterministic** — they execute as shell scripts at guaranteed lifecycle points.

### The Compliance Loop

1. **PostToolUse** tracks every source file modification after an edit
2. **Stop** validates compliance at session end
3. If violations are found, the session is blocked with a list of what needs fixing
4. The agent fixes violations and completes the session

### Task-Size Tiers

| Files Modified | Required Actions |
|---|---|
| 1 file | Session bookends (recover + postflight) |
| 2-3 files | + ripple before modify + update .purpose files |
| 3+ files | + full workflow (ripple, .purpose, lore entry, portal.yaml for routes) |

## Plugin vs Per-Project Setup

| | Plugin | `paradigm shift` (per-project) |
|---|---|---|
| **Scope** | Every project automatically | One project at a time |
| **Hooks** | Bundled in plugin, active for all projects | Copied to `.claude/hooks/` in the project |
| **MCP** | Configured globally via plugin | `.mcp.json` or `~/.claude/claude.json` per project |
| **Skills** | `/paradigm:init`, `/paradigm:shift`, etc. | None (skills are plugin-only) |
| **Rules** | CLAUDE.md protocol injected globally | `CLAUDE.md` generated per-project by `paradigm sync claude` |
| **Agents** | architect, builder, reviewer, tester, security | None (agents are plugin-only) |
| **Updates** | Update plugin once, all projects get it | Re-run `paradigm shift` or `paradigm hooks install --claude-code` |

Most teams use both: the plugin for global enforcement, `paradigm shift` for project-specific context (`.paradigm/`, `portal.yaml`, `.purpose` files).

## Verifying Installation

After restarting Claude Code, open a new conversation and ask:

```
What Paradigm tools do you have access to?
```

Claude should list `paradigm_status`, `paradigm_ripple`, `paradigm_navigate`, and 50+ others.

To verify hooks are active, start a new conversation and confirm Claude lists `paradigm_status` and related tools. With the default `none` enforcement preset, compliance checks are advisory — run `paradigm presets` to activate them.

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
- `@a-company/paradigm` npm package — MCP server runs automatically via `npx`. For skills like `/paradigm:shift`, also install the CLI globally: `npm install -g @a-company/paradigm`

## Links

- [GitHub](https://github.com/ascend42/a-paradigm)
- [npm](https://www.npmjs.com/package/@a-company/paradigm)
- [MCP Setup Guide](../../docs/guides/mcp-setup.md)
- [Quick Start Guide](../../docs/guides/quick-start.md)
