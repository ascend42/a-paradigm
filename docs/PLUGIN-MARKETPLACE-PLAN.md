# Paradigm Plugin & Marketplace Plan

> **Goal**: Ship Paradigm as a first-class Claude Code plugin so any developer can
> `/plugin install paradigm` and get the full system — MCP tools, enforcement hooks,
> workflow skills, and specialized agents — with zero manual setup.

---

## Table of Contents

1. [Distribution Channels](#1-distribution-channels)
2. [Plugin Architecture](#2-plugin-architecture)
3. [Component Inventory](#3-component-inventory)
4. [Skills Design](#4-skills-design)
5. [Agents Design](#5-agents-design)
6. [Hooks Design](#6-hooks-design)
7. [MCP Server Bundling](#7-mcp-server-bundling)
8. [Marketplace Setup](#8-marketplace-setup)
9. [MCP Registry Listing](#9-mcp-registry-listing)
10. [Phased Rollout](#10-phased-rollout)
11. [Decisions (Finalized)](#11-decisions-finalized)
12. [Existing Project Migration](#12-existing-project-migration)

---

## 1. Distribution Channels

### Primary: Claude Code Plugin Marketplace

Users install via:
```
/plugin marketplace add ascend42/a-paradigm
/plugin install paradigm@a-paradigm
```

This gives them everything — MCP server, hooks, skills, agents — in one step.

### Secondary: Official MCP Registry

List `@a-company/paradigm` at `registry.modelcontextprotocol.io` so non-Claude-Code
clients (Cursor, Windsurf, Zed, VS Code Copilot) can discover the MCP server.

### Tertiary: npm (existing)

`npx @a-company/paradigm` already works for CLI usage. The plugin references this
same package for its MCP server, so npm remains the underlying distribution.

---

## 2. Plugin Architecture

### Directory Structure

```
plugins/paradigm/
├── .claude-plugin/
│   └── plugin.json              # Plugin manifest
├── skills/
│   ├── init/SKILL.md            # /paradigm:init — project setup
│   ├── scan/SKILL.md            # /paradigm:scan — reindex symbols
│   ├── doctor/SKILL.md          # /paradigm:doctor — health check
│   ├── lore/SKILL.md            # /paradigm:lore — record session lore
│   ├── shift/SKILL.md           # /paradigm:shift — full setup wizard
│   ├── preflight/SKILL.md       # /paradigm:preflight — pre-task compliance
│   ├── postflight/SKILL.md      # /paradigm:postflight — post-task compliance
│   └── sentinel/SKILL.md        # /paradigm:sentinel — triage incidents
├── agents/
│   ├── architect.md             # System design & planning
│   ├── builder.md               # Implementation & coding
│   ├── tester.md                # Testing & validation
│   ├── reviewer.md              # Code review & quality
│   └── security.md              # Security analysis
├── hooks/
│   └── hooks.json               # Hook definitions
├── scripts/
│   ├── paradigm-stop.sh         # Stop hook (7 compliance checks)
│   ├── paradigm-precommit.sh    # Pre-commit reindex
│   └── paradigm-postwrite.sh    # Post-write .purpose reminder
├── .mcp.json                    # MCP server config
├── settings.json                # Default settings (optional)
└── README.md                    # Plugin documentation
```

### plugin.json

```json
{
  "name": "paradigm",
  "description": "AI-native project architecture — structured context, enforcement hooks, multi-agent orchestration, and 50+ MCP tools for symbol-driven development",
  "version": "1.5.0",
  "author": {
    "name": "ascend42",
    "email": "ascend42@users.noreply.github.com"
  },
  "homepage": "https://github.com/ascend42/a-paradigm",
  "repository": "https://github.com/ascend42/a-paradigm",
  "license": "MIT",
  "keywords": [
    "paradigm",
    "architecture",
    "mcp",
    "ai-context",
    "developer-tools",
    "multi-agent",
    "enforcement"
  ]
}
```

---

## 3. Component Inventory

What exists today and how it maps to plugin components:

| Existing Asset | Plugin Component | Status |
|---|---|---|
| 50+ MCP tools (paradigm-mcp) | `.mcp.json` → `npx @a-company/paradigm mcp` | Ready — needs .mcp.json wrapper |
| 7 MCP resource categories | Bundled with MCP server | Ready — comes with server |
| Stop hook (7 checks) | `hooks/hooks.json` + `scripts/paradigm-stop.sh` | Needs extraction |
| Pre-commit reindex hook | `hooks/hooks.json` + `scripts/paradigm-precommit.sh` | Needs extraction |
| Post-write advisory hook | `hooks/hooks.json` + `scripts/paradigm-postwrite.sh` | Needs extraction |
| 21 CLI commands | Skills (selected subset) | Needs SKILL.md authoring |
| 5 agent roles (architect etc.) | `agents/*.md` | Needs markdown authoring |
| 12 prompt templates | MCP resources (already served) | Ready |
| CLAUDE.md generator | Part of `paradigm init` / `paradigm shift` | Referenced by skills |
| IDE adapters (4 IDEs) | Not in plugin (IDE-specific) | Out of scope |
| Lore UI | Not in plugin (served by CLI) | Out of scope |

---

## 4. Skills Design

Skills are the user-facing workflows. Each wraps one or more MCP tools or CLI
operations into a coherent recipe.

### Tier 1: Core Workflow Skills (ship in v1)

#### `/paradigm:init`
**Purpose**: Initialize Paradigm in the current project.
**Triggers**: User says "set up paradigm", "initialize paradigm", "add paradigm to this project"
**Actions**:
1. Call `paradigm_status` to check if already initialized
2. Run `npx @a-company/paradigm init` via Bash
3. Run `npx @a-company/paradigm scan` to build index
4. Report symbols found and next steps

#### `/paradigm:scan`
**Purpose**: Rebuild symbol index after file changes.
**Triggers**: "rescan", "reindex", "symbols out of date"
**Actions**:
1. Call `paradigm_reindex` MCP tool
2. Report updated symbol counts

#### `/paradigm:doctor`
**Purpose**: Health check for Paradigm configuration.
**Triggers**: "check paradigm health", "paradigm doctor", "something seems wrong with paradigm"
**Actions**:
1. Call `paradigm_status` for overview
2. Call `paradigm_purpose_validate` for .purpose file issues
3. Check portal.yaml exists if routes are defined
4. Report findings with fix suggestions

#### `/paradigm:lore`
**Purpose**: Record a lore entry for the current session.
**Triggers**: "record lore", "log what we did", "save session history"
**Actions**:
1. Gather context: git diff --stat, symbols touched, files modified
2. Call `paradigm_lore_record` with structured entry
3. Confirm recording

#### `/paradigm:shift`
**Purpose**: Full one-command setup (init + scan + hooks + CLAUDE.md).
**Triggers**: "set up everything", "full paradigm setup", "paradigm shift"
**Actions**:
1. Run `npx @a-company/paradigm shift` via Bash
2. Report what was created

#### `/paradigm:preflight`
**Purpose**: Pre-task compliance check before starting work.
**Triggers**: "before I start", "what should I check", "preflight"
**Actions**:
1. Call `paradigm_pm_preflight` with task description
2. Report required checks, affected symbols, suggested agents

#### `/paradigm:postflight`
**Purpose**: Post-task compliance check after finishing work.
**Triggers**: "am I done", "check my work", "postflight"
**Actions**:
1. Call `paradigm_pm_postflight` with modified files and symbols
2. Report any violations (missing .purpose, missing gates, etc.)

#### `/paradigm:sentinel`
**Purpose**: Triage and manage incidents.
**Triggers**: "check incidents", "triage errors", "sentinel status"
**Actions**:
1. Call `paradigm_sentinel_triage` for open incidents
2. Show summary with pattern matches and resolution suggestions

### Tier 2: Power User Skills (ship in v1 if time allows)

#### `/paradigm:ripple`
**Purpose**: Analyze blast radius before modifying a symbol.
**Wraps**: `paradigm_ripple` + `paradigm_flows_affected`

#### `/paradigm:wisdom`
**Purpose**: Record team learning (antipattern or decision).
**Wraps**: `paradigm_wisdom_record`

#### `/paradigm:handoff`
**Purpose**: Prepare context handoff for session continuity.
**Wraps**: `paradigm_handoff_prepare`

### Tier 3: Future Skills (v2+)

- `/paradigm:flow` — Define and validate multi-step flows
- `/paradigm:portal` — Manage authorization gates
- `/paradigm:cost` — Estimate token costs for tasks
- `/paradigm:orchestrate` — Launch multi-agent task

---

## 5. Agents Design

These are the 5 specialized agents that `paradigm team` already supports. In plugin
form, they become available as subagents that Claude can delegate to.

### Agent: architect

```yaml
---
name: architect
description: >
  System design and architecture planning. Use when tasks require
  architectural decisions, multi-file changes, or choosing between
  approaches. Analyzes codebase structure and proposes implementation plans.
tools: Read, Grep, Glob, WebSearch, WebFetch
disallowedTools: Write, Edit, Bash
model: opus
permissionMode: plan
maxTurns: 30
---
```

**System prompt covers**: reading .purpose files, checking portal.yaml, analyzing
symbol dependencies via MCP, producing structured implementation plans.

### Agent: builder

```yaml
---
name: builder
description: >
  Implementation and coding. Use for writing code, creating files,
  and making changes. Follows existing patterns and conventions.
  Checks paradigm compliance during implementation.
tools: Read, Grep, Glob, Edit, Write, Bash
model: sonnet
permissionMode: default
maxTurns: 50
---
```

**System prompt covers**: reading existing code before modifying, following project
conventions, updating .purpose files alongside code changes, running builds/tests.

### Agent: tester

```yaml
---
name: tester
description: >
  Testing and validation. Use after implementation to write and run tests,
  verify edge cases, and ensure code quality.
tools: Read, Grep, Glob, Edit, Write, Bash
model: sonnet
permissionMode: default
maxTurns: 30
---
```

**System prompt covers**: reading existing test patterns, writing tests in the
project's framework, running test suites, reporting coverage.

### Agent: reviewer

```yaml
---
name: reviewer
description: >
  Code review and quality analysis. Use to review changes for bugs,
  code smells, and adherence to project conventions. Read-only.
tools: Read, Grep, Glob
disallowedTools: Write, Edit, Bash
model: opus
permissionMode: default
maxTurns: 20
---
```

**System prompt covers**: checking paradigm compliance, reviewing .purpose coverage,
portal.yaml completeness, code quality, and convention adherence.

### Agent: security

```yaml
---
name: security
description: >
  Security analysis for authorization, authentication, and input validation.
  Use when tasks involve auth, user data, or API endpoints. Read-only.
tools: Read, Grep, Glob
disallowedTools: Write, Edit, Bash
model: opus
permissionMode: default
maxTurns: 20
---
```

**System prompt covers**: checking portal.yaml gates, analyzing auth flows,
reviewing input validation, checking for OWASP top 10 vulnerabilities.

---

## 6. Hooks Design

### Current State

Today, hooks are bash scripts embedded as TypeScript template literals in
`packages/paradigm/src/commands/hooks/index.ts`. The `paradigm hooks install`
command writes them to `.claude/hooks/` or `.cursor/hooks/`.

### Plugin Approach

For the plugin, hooks are defined in `hooks/hooks.json` and reference shell scripts
in `scripts/`. Claude Code loads these automatically when the plugin is enabled.

**Key difference**: Plugin hooks apply globally when the plugin is enabled, vs
per-project hooks that `paradigm hooks install` writes. Users can choose either.

### hooks.json

```json
{
  "hooks": {
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "${CLAUDE_PLUGIN_ROOT}/scripts/paradigm-stop.sh",
            "timeout": 30
          }
        ]
      }
    ],
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "${CLAUDE_PLUGIN_ROOT}/scripts/paradigm-precommit.sh",
            "timeout": 15
          }
        ]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "Write|Edit",
        "hooks": [
          {
            "type": "command",
            "command": "${CLAUDE_PLUGIN_ROOT}/scripts/paradigm-postwrite.sh",
            "timeout": 10
          }
        ]
      }
    ]
  }
}
```

### Script Extraction

The 3 bash scripts need to be extracted from the TypeScript template literals
in `index.ts` into standalone `.sh` files under `scripts/`.

**Consideration**: The current stop hook uses `$MODIFIED` from `git diff`. The
plugin hook receives JSON input on stdin. We need to adapt the scripts to:
1. Read JSON from stdin (tool input context)
2. Compute git state independently (the stop hook already does this)
3. Output correctly (exit code 0 = pass, exit code 2 = block)

### Migration Path

- **Plugin hooks** = automatic, apply when plugin is enabled, no per-project install
- **`paradigm hooks install`** = still works for users who want per-project hooks
  without the full plugin, or for non-Claude-Code IDEs (Cursor)

Both paths should coexist. The plugin hooks replace the need for `paradigm hooks install`
in Claude Code specifically.

---

## 7. MCP Server Bundling

### .mcp.json

```json
{
  "mcpServers": {
    "paradigm": {
      "type": "stdio",
      "command": "npx",
      "args": ["@a-company/paradigm", "mcp"],
      "env": {}
    }
  }
}
```

**How it works**:
- When the plugin is enabled, Claude Code auto-starts the MCP server
- The server runs `npx @a-company/paradigm mcp` which launches paradigm-mcp
- All 50+ tools and 7 resource categories become available
- No manual MCP configuration needed

**Prerequisites**:
- Node.js >= 18 must be installed
- `@a-company/paradigm` must be published to npm (already is)

**Alternative for offline/faster startup**:
```json
{
  "mcpServers": {
    "paradigm": {
      "type": "stdio",
      "command": "paradigm-mcp",
      "args": []
    }
  }
}
```
This requires `npm install -g @a-company/paradigm` for the global binary.
The `npx` approach is more convenient (auto-installs), the global binary is faster.

We should document both options and default to `npx`.

---

## 8. Marketplace Setup

### Option A: In-repo marketplace (recommended)

Add the marketplace to the existing `a-paradigm` repo:

```
a-paradigm/
├── .claude-plugin/
│   └── marketplace.json          # Marketplace catalog
├── plugins/
│   └── paradigm/                 # The plugin itself
│       ├── .claude-plugin/
│       │   └── plugin.json
│       ├── skills/
│       ├── agents/
│       ├── hooks/
│       ├── scripts/
│       ├── .mcp.json
│       └── README.md
├── packages/                     # Existing monorepo packages
│   ├── paradigm/
│   ├── paradigm-mcp/
│   └── ...
└── ...
```

**marketplace.json**:
```json
{
  "name": "a-paradigm",
  "owner": {
    "name": "ascend42"
  },
  "metadata": {
    "description": "Paradigm developer tools for AI-native project architecture"
  },
  "plugins": [
    {
      "name": "paradigm",
      "source": "./plugins/paradigm",
      "description": "AI-native project architecture — structured context, enforcement hooks, multi-agent orchestration, and 50+ MCP tools",
      "version": "1.5.0",
      "category": "development",
      "tags": ["architecture", "mcp", "ai-context", "enforcement", "multi-agent"],
      "author": {
        "name": "ascend42"
      }
    }
  ]
}
```

**User installation**:
```
/plugin marketplace add ascend42/a-paradigm
/plugin install paradigm@a-paradigm
```

### Option B: Separate marketplace repo

A dedicated `ascend42/paradigm-plugins` repo. Cleaner separation but more repos
to maintain. Only worth it if we plan multiple plugins.

**Recommendation**: Option A (in-repo). Single repo, single source of truth. The
marketplace.json points to `./plugins/paradigm` within the same repo.

### Future: Multiple Plugins

If we later split Paradigm into smaller plugins (e.g., `paradigm-core`,
`paradigm-sentinel`, `paradigm-lore`), they'd each be a directory under `plugins/`
and listed in the same marketplace.json.

---

## 9. MCP Registry Listing

### What

Submit a PR to `github.com/modelcontextprotocol/registry` with server metadata.

### Server Metadata (server.json)

```json
{
  "name": "@a-company/paradigm",
  "description": "AI-native project architecture with 50+ tools for symbol-driven development, enforcement hooks, multi-agent orchestration, incident tracking, and project timeline",
  "repository": {
    "url": "https://github.com/ascend42/a-paradigm",
    "source": "github",
    "id": "ascend42/a-paradigm"
  },
  "version_detail": {
    "version": "1.5.0",
    "release_date": "2026-02-21",
    "is_latest": true
  },
  "packages": [
    {
      "registry_name": "npm",
      "name": "@a-company/paradigm",
      "version": "1.5.0",
      "runtime": "node",
      "license": "MIT",
      "environment_variables": []
    }
  ],
  "remotes": []
}
```

### Process

1. Fork `modelcontextprotocol/registry`
2. Add `servers/@a-company/paradigm.json`
3. Open PR with description of what the server provides
4. Wait for review/merge

### Timing

Do this after the plugin is stable and published. The registry listing is a
nice-to-have for discoverability, not a blocker for the plugin.

---

## 10. Phased Rollout

### Phase 1: Plugin Scaffold (Day 1)

**Deliverables**:
- [ ] `plugins/paradigm/.claude-plugin/plugin.json`
- [ ] `plugins/paradigm/.mcp.json`
- [ ] `plugins/paradigm/README.md`

**Validation**:
```bash
claude --plugin-dir ./plugins/paradigm
# Verify MCP tools load, run paradigm_status
```

This is the MVP — just the MCP server in a plugin wrapper. Already provides
massive value (all 50+ tools, zero config).

### Phase 2: Hook Extraction (Day 1-2)

**Deliverables**:
- [ ] `plugins/paradigm/scripts/paradigm-stop.sh`
- [ ] `plugins/paradigm/scripts/paradigm-precommit.sh`
- [ ] `plugins/paradigm/scripts/paradigm-postwrite.sh`
- [ ] `plugins/paradigm/hooks/hooks.json`

**Work**:
- Extract bash scripts from TypeScript template literals
- Adapt stdin handling (plugin hooks receive JSON on stdin)
- Test each hook type independently
- Verify stop hook blocks correctly

**Validation**:
```bash
claude --plugin-dir ./plugins/paradigm
# Modify 3+ files without .purpose → stop hook should block
# Run git commit → precommit should reindex
# Edit a .ts file → postwrite should show advisory
```

### Phase 3: Skills Authoring (Day 2-3)

**Deliverables**:
- [ ] 8 Tier 1 skills (init, scan, doctor, lore, shift, preflight, postflight, sentinel)
- [ ] Each skill tested via `/paradigm:{name}`

**Work**:
- Write SKILL.md for each skill with frontmatter + instructions
- Skills invoke MCP tools and/or Bash commands
- Test each skill in a real project

### Phase 4: Agent Authoring (Day 3-4)

**Deliverables**:
- [ ] 5 agents (architect, builder, tester, reviewer, security)
- [ ] Each agent tested via `/agents`

**Work**:
- Write agent markdown with frontmatter (tools, model, permissionMode)
- System prompts should reference Paradigm conventions
- Include MCP tool usage instructions in agent prompts
- Agents should read .purpose files, check portal.yaml, use paradigm symbols

### Phase 5: Marketplace & Distribution (Day 4)

**Deliverables**:
- [ ] `.claude-plugin/marketplace.json` at repo root
- [ ] Plugin README with installation instructions
- [ ] Test: `/plugin marketplace add ascend42/a-paradigm`
- [ ] Test: `/plugin install paradigm@a-paradigm`

**Work**:
- Create marketplace.json
- Push to main branch
- Test full installation flow from GitHub
- Verify all components load correctly

### Phase 6: MCP Registry (Day 5+)

**Deliverables**:
- [ ] PR to `modelcontextprotocol/registry`
- [ ] Server metadata JSON
- [ ] Listed on registry.modelcontextprotocol.io

### Phase 7: Polish & Iterate (Ongoing)

- Gather feedback from a-star case study
- Add Tier 2 skills based on usage
- Tune agent prompts based on real-world performance
- Version bumps coordinated with npm publishes

---

## 11. Decisions (Finalized)

| # | Question | Decision | Rationale |
|---|---|---|---|
| Q1 | Plugin name | **`paradigm`** | Clean, short. `/paradigm:init` > `/a-paradigm:init` |
| Q2 | Hook defaults | **Active by default** | Enforcement is a core value prop. Users can disable via settings. |
| Q3 | Agent models | **`inherit`** | User controls cost. Recommended assignments documented in README. |
| Q4 | Skill depth | **Rich workflows** | Premium UX. Heavily documented maintenance framework to keep skills in sync with MCP tool changes. |
| Q5 | Version alignment | **Synced with npm** | Single version number (`1.5.0`). Plugin version = npm package version. Bump together. |
| Q6 | Repo strategy | **In-repo** | `plugins/paradigm/` inside a-paradigm. Single source of truth. |
| Q7 | Precommit hook | **Keep it** | 10ms overhead negligible. Ensures index is fresh before every commit. Script parses stdin JSON to check for `git commit`. |
| Q8 | Sentinel scope | **Part of main plugin** | One install gets everything. Sentinel tools come with MCP server anyway. Split later if needed. |

### Maintenance Protocol for Rich Workflows (Q4)

Since skills contain substantial workflow logic, they must stay in sync with MCP
tool changes. To prevent drift:

1. **Skills reference MCP tools by name** — If a tool is renamed or removed, skill
   instructions break visibly (Claude can't find the tool).

2. **CHANGELOG.md in plugin root** — Every MCP tool change that affects a skill must
   be noted with the affected skill name.

3. **Skill test protocol** — After any MCP tool change:
   - Load plugin locally: `claude --plugin-dir ./plugins/paradigm`
   - Run each affected skill in a test project
   - Verify the workflow completes without errors

4. **Version gate** — Plugin version is synced with npm. When the npm package bumps,
   the plugin version bumps, and all skills are re-validated.

5. **Skill-to-tool mapping table** — Maintained in the plugin README:

   | Skill | MCP Tools Used |
   |---|---|
   | `/paradigm:init` | `paradigm_status`, Bash (`npx paradigm init/scan`) |
   | `/paradigm:scan` | `paradigm_reindex` |
   | `/paradigm:doctor` | `paradigm_status`, `paradigm_purpose_validate` |
   | `/paradigm:lore` | `paradigm_lore_record`, Bash (`git diff --stat`) |
   | `/paradigm:shift` | Bash (`npx paradigm shift`) |
   | `/paradigm:preflight` | `paradigm_pm_preflight` |
   | `/paradigm:postflight` | `paradigm_pm_postflight` |
   | `/paradigm:sentinel` | `paradigm_sentinel_triage`, `paradigm_sentinel_stats` |

---

## 12. Existing Project Migration

### The Problem: Double Registration

Projects already using Paradigm have per-project MCP config and Claude Code hooks.
Installing the plugin without cleanup causes **duplication** — two MCP server
instances and hooks firing twice.

| Per-project (current) | Plugin provides | Conflict? |
|---|---|---|
| `.mcp.json` → `paradigm-mcp .` | `.mcp.json` → `npx @a-company/paradigm mcp` | **YES — two MCP servers** |
| `.claude/hooks/paradigm-*.sh` (3) | `hooks/hooks.json` (3 hooks) | **YES — hooks fire twice** |
| `.cursor/hooks/paradigm-*.sh` (3) | N/A (plugin is Claude Code only) | No conflict |
| `CLAUDE.md` | Not in plugin | No conflict |
| `.git/hooks/post-commit, pre-push` | Not in plugin | No conflict |
| `.paradigm/`, `portal.yaml`, `.purpose` | Not in plugin | No conflict |

### Current State (7 Integrated Projects)

| Project | .paradigm | CLAUDE.md | Claude Hooks | Cursor Hooks | .mcp.json | Git Hooks |
|---|---|---|---|---|---|---|
| a-paradigm | YES | YES | 3 scripts | 3 scripts | paradigm + atelier | post-commit, pre-push |
| a-company | YES | YES | 3 scripts | 3 scripts | paradigm + atelier | post-commit, pre-push |
| a-pretend | YES | YES | 3 scripts | 3 scripts | paradigm + atelier | post-commit, pre-push |
| a-star | YES | YES | 3 scripts | 3 scripts | paradigm + atelier | post-commit, pre-push |
| a-kamiki | YES | YES | 3 scripts | 3 scripts | paradigm + atelier | post-commit, pre-push |
| a-trace | YES | YES | 3 scripts | 3 scripts | paradigm + atelier | post-commit, pre-push |
| a-atelier | YES | YES | 3 scripts | 3 scripts | paradigm only | post-commit, pre-push |
| a-maker | NO | NO | none | none | none | none |

### Migration Script

After installing the plugin, run this once across all projects:

```bash
#!/bin/bash
# migrate-to-plugin.sh — Remove per-project Claude Code overlap
# Safe: keeps Cursor hooks, git hooks, CLAUDE.md, .paradigm/, portal.yaml

PROJECTS=(
  "$HOME/Documents/GitHub/a-paradigm"
  "$HOME/Documents/GitHub/a-company"
  "$HOME/Documents/GitHub/a-pretend"
  "$HOME/Documents/GitHub/a-star"
  "$HOME/Documents/GitHub/a-kamiki"
  "$HOME/Documents/GitHub/a-trace"
  "$HOME/Documents/GitHub/a-atelier"
)

for dir in "${PROJECTS[@]}"; do
  name=$(basename "$dir")
  echo "=== $name ==="

  # 1. Remove Claude Code hooks (plugin provides these now)
  if [ -d "$dir/.claude/hooks" ]; then
    rm -f "$dir/.claude/hooks/paradigm-stop.sh"
    rm -f "$dir/.claude/hooks/paradigm-precommit.sh"
    rm -f "$dir/.claude/hooks/paradigm-postwrite.sh"
    echo "  Removed .claude/hooks/paradigm-*.sh"

    # Clean up hooks.json references if they exist
    if [ -f "$dir/.claude/hooks/hooks.json" ]; then
      echo "  NOTE: Check .claude/hooks/hooks.json for paradigm references"
    fi
  fi

  # 2. Remove paradigm-mcp from .mcp.json (keep atelier-mcp and others)
  if [ -f "$dir/.mcp.json" ]; then
    # Use node to safely remove just the paradigm-mcp key
    node -e "
      const fs = require('fs');
      const cfg = JSON.parse(fs.readFileSync('$dir/.mcp.json', 'utf8'));
      if (cfg.mcpServers && cfg.mcpServers['paradigm-mcp']) {
        delete cfg.mcpServers['paradigm-mcp'];
        if (Object.keys(cfg.mcpServers).length === 0) {
          fs.unlinkSync('$dir/.mcp.json');
          console.log('  Removed .mcp.json (was paradigm-only)');
        } else {
          fs.writeFileSync('$dir/.mcp.json', JSON.stringify(cfg, null, 2) + '\n');
          console.log('  Removed paradigm-mcp from .mcp.json (kept others)');
        }
      } else {
        console.log('  No paradigm-mcp in .mcp.json');
      }
    "
  fi

  # 3. Keep everything else untouched
  # .cursor/hooks — Cursor has no plugin system, keep per-project hooks
  # .git/hooks — git hooks are separate from Claude Code
  # CLAUDE.md — per-project context, not provided by plugin
  # .paradigm/ — project data, not provided by plugin
  # portal.yaml — project config, not provided by plugin

  echo ""
done

echo "Migration complete. Restart Claude Code to use plugin hooks + MCP server."
```

### What Stays Per-Project (Plugin Does NOT Replace)

| Asset | Why it stays |
|---|---|
| `CLAUDE.md` | Per-project AI context, generated by `paradigm init/shift` |
| `.paradigm/` | Project-specific symbols, purpose files, wisdom, history, lore |
| `portal.yaml` | Project-specific authorization gates |
| `.purpose` files | Project-specific component definitions |
| `.cursor/hooks/` | Cursor has no plugin system — needs per-project hooks |
| `.git/hooks/` | Git hooks are separate from Claude Code hooks |
| `.sentinel.yaml` | Project-specific incident tracking config |

### What About Non-Paradigm Projects?

The plugin is global (active for all projects when enabled). For projects without
`.paradigm/` (like a-maker):
- MCP server starts → `paradigm_status` returns "not initialized"
- Stop hook checks for `.paradigm/` → skips all checks if missing
- Precommit hook checks for `.paradigm/` → skips reindex if missing
- Skills work — `/paradigm:init` initializes the project

**Safe for non-Paradigm projects** — the plugin does nothing until initialized.

### Updating `paradigm hooks install`

The `paradigm hooks install` command should detect plugin mode and adjust:

```
paradigm hooks install
  → Detects plugin enabled? Skip Claude Code hooks, install only:
    - Cursor hooks (.cursor/hooks/)
    - Git hooks (.git/hooks/)
  → Plugin not detected? Install all hooks (current behavior)
```

This prevents re-introducing the duplication after migration.

### Two Coexisting Modes

| Mode | MCP Server | Claude Hooks | Cursor Hooks | Git Hooks | For |
|---|---|---|---|---|---|
| **Plugin** | Plugin `.mcp.json` | Plugin `hooks.json` | `paradigm hooks install` | `paradigm hooks install` | Claude Code users |
| **Manual** | Project `.mcp.json` | `.claude/hooks/` | `.cursor/hooks/` | `.git/hooks/` | Cursor, Windsurf, non-plugin |

Both modes produce identical behavior. The plugin mode just centralizes the
Claude Code pieces (MCP + hooks) so they don't need per-project installation.

---

## Appendix A: File Size Estimates

| Component | Estimated Files | Estimated Size |
|---|---|---|
| plugin.json | 1 | ~0.5 KB |
| .mcp.json | 1 | ~0.3 KB |
| Skills (8 SKILL.md) | 8 | ~1 KB each = 8 KB |
| Agents (5 .md) | 5 | ~2 KB each = 10 KB |
| hooks.json | 1 | ~1 KB |
| Scripts (3 .sh) | 3 | ~3 KB each = 9 KB |
| README.md | 1 | ~5 KB |
| **Total** | **20 files** | **~35 KB** |

Lightweight. No build step needed for the plugin itself.

## Appendix B: Comparison with Official Plugins

| Aspect | Anthropic `feature-dev` | Anthropic `code-review` | **Paradigm** |
|---|---|---|---|
| Skills | 0 | 0 | 8 |
| Agents | 3 | 0 | 5 |
| Commands | 1 | 1 | 0 (skills instead) |
| Hooks | 0 | 0 | 3 |
| MCP Servers | 0 | 0 | 1 (50+ tools) |
| Scope | Feature workflow | PR review | Full project architecture |

Paradigm would be one of the most comprehensive plugins in the ecosystem.

## Appendix C: User Experience Flow

```
Developer installs plugin:
  /plugin marketplace add ascend42/a-paradigm
  /plugin install paradigm@a-paradigm

Claude Code restarts → MCP server starts → 50+ tools available

Developer starts a project:
  /paradigm:init
  → Initializes .paradigm/, generates CLAUDE.md, scans symbols

Developer works on a feature:
  Claude auto-uses paradigm_ripple, paradigm_navigate, paradigm_wisdom_context
  → All MCP tools available seamlessly in conversation

Developer finishes session:
  Stop hook fires → checks .purpose coverage, portal.yaml, lore entry
  → Blocks if compliance violations found
  → Developer fixes violations, session ends cleanly

Developer checks health:
  /paradigm:doctor
  → Reports symbol counts, missing .purpose files, stale aspects
```
