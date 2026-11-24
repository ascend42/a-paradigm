# Paradigm — Claude Code Plugin

AI-native project architecture for Claude Code. One install gives you structured
context, enforcement hooks, multi-agent orchestration, and 32 grouped MCP tools (more on demand) — in
every project, automatically.

## Installation

```
/plugin marketplace add ascend42/a-paradigm
/plugin install paradigm@a-paradigm
/reload-plugins
```

The `/reload-plugins` step is only needed if Claude Code prompts for it. The MCP
server wires automatically on install, and the enforcement hooks start automatically.

## What You Get

### Enforcement Hooks (deterministic)

| Hook | Event | Behavior |
|---|---|---|
| Stop | Session end | Validates compliance at session end. A new project starts at enforcement level `none`, where every check is off and nothing blocks. Turn checks on with `paradigm enforcement set <level>` (`minimal`, `balanced` or `strict`). Symbol and aspect checks belong to Rune, the compliance agent: `paradigm agent roster add compliance`. |
| PreToolUse | Before `git commit` | Auto-rebuilds symbol index before commits |
| PostToolUse | After file edits | Advisory reminder about .purpose coverage |

### 32 grouped MCP tools, more on demand (automatic)

The server lists 32 tools by default: 11 single tools and 21 grouped families. A family takes an `op` argument, for example `paradigm_lore` with `op: "record"`. Older names of the form `paradigm_<family>_<op>` refer to the same operations.

| Tool | Purpose |
|---|---|
| `paradigm_status` | Project overview and symbol counts |
| `paradigm_search` | Find symbols by name, description or tag |
| `paradigm_navigate` | Find a symbol, explore an area, or get the files for a task |
| `paradigm_related` | What a symbol uses and what uses it |
| `paradigm_ripple` | What a change to a symbol affects |
| `paradigm_gates_for_route` | Suggest gates for a route |
| `paradigm_reindex` | Rebuild the symbol index from `.purpose` files |
| `paradigm_retrieve` | Read back a large result a tool saved to disk |
| `paradigm_orchestrate_inline` | Plan and coordinate a multi-agent task |
| `paradigm_propose_block` | Record a soft-block for the Stop hook |
| `paradigm_tool_activate` | Switch on an on-demand tool for the session |

| Family | Purpose |
|---|---|
| `paradigm_purpose` | Edit `.purpose` files and `portal.yaml` gates and routes |
| `paradigm_lore` | Session records, timeline, assessments, calibration |
| `paradigm_decision` | Decision stream |
| `paradigm_wisdom` | Antipatterns and decisions per symbol, experts |
| `paradigm_history` | Symbol change history and fragility |
| `paradigm_journal` | Agent journal and work log |
| `paradigm_notebook` | Agent notebooks |
| `paradigm_session` | Session health, recovery, checkpoints, handoff |
| `paradigm_task` | Tasks |
| `paradigm_agent` | Agent roster, profiles, expertise, prompts |
| `paradigm_protocol` | Repeatable protocols |
| `paradigm_aspect` | Aspects: anchors, graph, drift |
| `paradigm_tags` | Tag bank |
| `paradigm_flow` | Flows |
| `paradigm_graph` | Symbol graph slices and architecture |
| `paradigm_captain` | Captain (Cid): brief, debrief, board |
| `paradigm_pm` | Preflight before and postflight after implementation |
| `paradigm_docs` | Generated docs |
| `paradigm_ambient` | Ambient learning: nominations, events, context, promotion |
| `paradigm_compliance` | Compliance findings and enforcement |
| `paradigm_authority` | Claim or release a scope |

Other families, such as `paradigm_sentinel`, `paradigm_symphony` and `paradigm_university`, are off by default. Switch one on with `paradigm_tool_activate`, or list it under `mcp.tools.enable` in `.paradigm/config.yaml`.

### Skills (user-invoked)

| Skill | Purpose |
|---|---|
| `/paradigm:shift` | Full one-command setup (init, scan, hooks, CLAUDE.md, doctor) |
| `/paradigm:init` | Initialize the Paradigm structure only |
| `/paradigm:scan` | Rebuild the symbol index after file changes |
| `/paradigm:doctor` | Health check for the Paradigm setup |
| `/paradigm:lore` | Record a lore entry for the current session |
| `/paradigm:preflight` | Pre-task compliance check |
| `/paradigm:postflight` | Post-task compliance check |
| `/paradigm:review` | Review recent changes for Paradigm compliance and quality |
| `/paradigm:ripple` | Impact analysis before modifying a symbol |
| `/paradigm:protocol` | Search for or record a repeatable implementation protocol |
| `/paradigm:handoff` | Prepare a context handoff for the next session |
| `/paradigm:agents` | Manage your agent team: roster, onboard, bench and activate |
| `/paradigm:teach` | Teach an agent a new behavior or pattern |
| `/paradigm:team` | Show what your agent team did this session |
| `/paradigm:health` | Agent learning health dashboard |
| `/paradigm:class` | Convene the Classroom: agents propose learnings, peers test them, you sign off |
| `/paradigm:study-hall` | Agents drill their curriculum and stage candidate learnings for the next class |
| `/paradigm:forage` | Send an agent to research a topic on the web and return cited candidate learnings |
| `/paradigm:sentinel` | Triage and manage incidents |
| `/paradigm:observe` | View live logs, metrics and traces from Sentinel |
| `/paradigm:conduct` | Register this session with Conductor |

### Agents (specialized subagents)

| Agent | Model | Purpose |
|---|---|---|
| `architect` | inherit | System design, architecture planning, impact analysis |
| `builder` | inherit | Implementation, coding, file changes |
| `tester` | inherit | Test writing, test execution, coverage |
| `reviewer` | inherit | Code review, quality analysis (read-only) |
| `security` | inherit | Security analysis, auth review (read-only) |

## Getting Started

After installing the plugin:

1. **New project**: Run `/paradigm:shift` for full setup
2. **Existing project**: If already using Paradigm, see [Migrating from Per-Project Setup](#migrating-from-per-project-setup)

## How Enforcement Works

CLAUDE.md is **advisory** — agents can and do ignore it. Paradigm's hooks are
**deterministic** — they execute as shell scripts at guaranteed lifecycle points.

### The Compliance Loop

1. **PostToolUse** tracks every source file modification after an edit
2. **Stop** validates compliance at session end
3. If violations are found and enforcement is active, the session is blocked with a list of what needs fixing (at the default level `none`, every check is off and nothing blocks until you run `paradigm enforcement set <level>`)
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
| **MCP** | Configured globally via plugin | `.mcp.json` at the project root |
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

Claude should list `paradigm_status`, `paradigm_ripple`, `paradigm_navigate` and the rest of the 32 default tools.

Compliance checks are off until you turn them on. `paradigm enforcement status` shows the current level; `paradigm enforcement set <level>` changes it.

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
| `/paradigm:doctor` | `paradigm_status`, `paradigm_purpose` (op `validate`), `paradigm_navigate` |
| `/paradigm:lore` | `paradigm_lore` (op `record`), Bash (`git diff --stat`) |
| `/paradigm:shift` | Bash (`npx @a-company/paradigm shift`) |
| `/paradigm:preflight` | `paradigm_pm` (op `preflight`) |
| `/paradigm:postflight` | `paradigm_pm` (op `postflight`) |
| `/paradigm:sentinel` | `paradigm_sentinel` (op `triage`), `paradigm_sentinel` (op `stats`) |

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
- Node.js >= 24 (the hooks and the MCP server run on your Node; Paradigm 8.0 requires 24 or newer)
- `@a-company/paradigm` npm package — the MCP server uses your installed copy (the project's own `node_modules` first, then a global install on `PATH`) and otherwise fetches the plugin's version with `npx`. For skills like `/paradigm:shift`, also install the CLI globally: `npm install -g @a-company/paradigm`

## Links

- [GitHub](https://github.com/ascend42/a-paradigm)
- [npm](https://www.npmjs.com/package/@a-company/paradigm)
- [MCP Setup Guide](../../docs/guides/mcp-setup.md)
- [Quick Start Guide](../../docs/guides/quick-start.md)
