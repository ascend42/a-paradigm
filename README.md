# Paradigm

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen.svg)](https://nodejs.org/)

> **Structure for AI-Native Development**

Paradigm is a developer tools ecosystem that brings **structure**, **authorization**, and **shared context** to modern software projects — designed for both human developers and AI agents.

## The Problem

Modern development has a context problem:

- **Context evaporates** — What does this feature do? What auth does it need? AI doesn't know. New team members don't know. Sometimes YOU don't know.
- **Authorization is a black box** — Who can access what? It's buried in middleware, scattered across files, impossible to visualize.
- **AI agents work blind** — Your AI assistant reads thousands of tokens but misses the forest for the trees.

## The Solution

Three pillars, one ecosystem:

| Pillar | Metaphor | What It Does |
|--------|----------|--------------|
| **Purpose** | Interior Designer | Define what things are and why they exist |
| **Portal** | Architect | Define who can access what, under what conditions |
| **Premise** | Thinker | Aggregate everything into a queryable knowledge graph |

## Installation

### Recommended: Install the CLI

Installing globally gives you the full Paradigm experience with both the `paradigm` CLI and `paradigm-mcp` server:

```bash
# Using npm
npm install -g github:ascend42/a-paradigm

# Using bun (faster)
bun add -g github:ascend42/a-paradigm
```

**What you get:**
- `paradigm` — Full CLI with all commands
- `paradigm-mcp` — MCP server for AI integrations (Cursor, Claude, etc.)
- Faster execution (no download on each run)
- Tab completion support

### Alternative: Quick Try (No Install)

Want to try it first? Run directly without installing:

```bash
npx github:ascend42/a-paradigm init
bunx github:ascend42/a-paradigm init
```

> **Note:** This downloads on each run. For regular use, install the CLI globally.

---

## Quick Start

```bash
# 1. Initialize (detects existing IDE files, offers migration)
paradigm init

# 2. Generate AI context beacon
paradigm beacon

# 3. Check project status
paradigm status

# 4. (Optional) Set up MCP for your AI tools
paradigm mcp setup
```

## What Gets Created

```
your-project/
├── .paradigm/              # Configuration & specs
│   ├── config.yaml         # Main configuration
│   ├── specs/              # Logger, scan, symbols
│   ├── docs/               # Commands, patterns
│   └── prompts/            # Task templates (pathways)
├── .purpose                # Feature & component context
├── .premise                # Project overview & ideas
└── .cursor/rules/          # Generated IDE instructions
    ├── paradigm-core.mdc
    ├── paradigm-symbols.mdc
    └── ...
```

## Symbol System

Paradigm uses symbols to create a shared language between code, developers, and AI:

| Symbol | Name | Example | Meaning |
|--------|------|---------|---------|
| `@` | Feature | `@checkout` | User-facing capability |
| `#` | Component | `#Button` | Reusable code unit |
| `^` | Portal | `^authenticated` | Authorization gate |
| `!` | Signal | `!login-failed` | Event or side effect |
| `$` | Flow | `$purchase-flow` | Multi-step process |
| `%` | State | `%user.authenticated` | Data condition |

These symbols work everywhere — in code comments, documentation, AI prompts, and visual tools.

## Key Commands

### Setup & Validation

```bash
paradigm init              # Initialize Paradigm (smart detection)
paradigm init --migrate    # Output migration prompt for existing rules
paradigm init --dry-run    # Show what would be created
paradigm sync              # Regenerate IDE instructions
paradigm sync --all        # Sync all IDEs (Cursor, Copilot, etc.)
paradigm doctor            # Health check and validation
paradigm lint              # Validate .purpose files for schema errors
paradigm lint --fix        # Auto-fix where possible
paradigm cost              # Analyze token costs (static vs MCP)
paradigm scan auto         # Auto-generate .purpose from code analysis
```

### AI Context (Agent Efficiency)

```bash
paradigm beacon            # Quick-start orientation for AI
paradigm beacon --json     # Machine-readable output
paradigm constellation     # Generate symbol relationship graph
paradigm ripple @checkout  # Impact analysis before changes
paradigm ripple @checkout --json
```

### Session Continuity

```bash
paradigm thread            # Show current session context
paradigm thread save "Added login validation"
paradigm thread todo "Write unit tests"
paradigm thread note "User prefers Zod"
paradigm echo AUTH_001     # Look up error-to-symbol mapping
```

### Multi-Agent Orchestration

```bash
paradigm team init         # Initialize team with 5 agent roles
paradigm team status       # Show current agent, pending handoffs
paradigm team handoff --to builder    # Hand off to another agent
paradigm team accept       # Accept a pending handoff
paradigm team check        # Health check for conflicts
paradigm team history      # Full activity timeline
paradigm team reset        # Clear state for fresh start
```

Default agents: `architect` → `builder` → `reviewer` → `tester` (plus `security`)

## Agent Efficiency

Paradigm is designed to make AI agents faster and more context-aware:

| Feature | What It Does | Command |
|---------|--------------|---------|
| **Beacon** | Quick-start orientation file | `paradigm beacon` |
| **Constellation** | Machine-readable symbol graph | `paradigm constellation` |
| **Ripple** | Change impact analysis | `paradigm ripple @symbol` |
| **Thread** | Session continuity | `paradigm thread` |
| **Echo** | Error-to-symbol mapping | `paradigm echo ERROR_CODE` |
| **Cost** | Token usage analysis | `paradigm cost` |
| **Team** | Multi-agent orchestration | `paradigm team` |
| **Agent Hints** | CLI query patterns in IDE rules | Auto-generated |

**Token efficiency**: Instead of loading large context files (~2000 tokens), AI can query on-demand (~100 tokens per query).

**Cost analysis** shows the savings: `paradigm cost` compares static context vs MCP, typically showing 80-90% token reduction.

```bash
# AI runs this before modifying @checkout
paradigm ripple @checkout --json

# AI debugs an error
paradigm echo AUTH_REQUIRED --json

# AI queries constellation directly
jq '.stars["@checkout"]' .paradigm/constellation.json
```

## MCP Server (AI Integration)

For dynamic, mid-conversation context, Paradigm provides an MCP server that works with Claude Desktop, Cursor, and other MCP-compatible AI tools.

> **Requires CLI Installation** — The MCP server (`paradigm-mcp`) is included when you install the CLI globally. See [Installation](#installation).

| Resource/Tool | Purpose |
|---------------|---------|
| `paradigm://symbols` | Query all project symbols |
| `paradigm://symbol/@checkout` | Get single symbol details |
| `paradigm_search` | Find symbols by query |
| `paradigm_ripple` | Impact analysis on-demand |
| `paradigm_related` | Get connected symbols |
| `paradigm_status` | Project overview |

### Quick Setup (Recommended)

With the CLI installed, run:

```bash
# Auto-configure MCP for your AI client
paradigm mcp setup

# Or specify client
paradigm mcp setup --client cursor
paradigm mcp setup --client claude
paradigm mcp setup --client all
```

### Manual Configuration

**Cursor** (`.cursor/mcp.json` in your project):
```json
{
  "mcpServers": {
    "paradigm": {
      "command": "paradigm-mcp",
      "args": ["."],
      "cwd": "/path/to/your/project"
    }
  }
}
```

**Claude Desktop** (`~/Library/Application Support/Claude/claude_desktop_config.json`):
```json
{
  "mcpServers": {
    "paradigm": {
      "command": "paradigm-mcp",
      "args": ["."],
      "cwd": "/path/to/your/project"
    }
  }
}
```

**Example conversation:**
> **You:** "What would break if I removed ^authenticated?"
> 
> **Claude:** *[calls paradigm_ripple]* "Removing ^authenticated would affect 12 features..."

## IDE Support

Paradigm generates instructions for multiple IDEs from a single source:

| IDE | Format | Command |
|-----|--------|---------|
| **Cursor** | `.cursor/rules/*.mdc` | `paradigm sync cursor` |
| **GitHub Copilot** | `.github/instructions/*.md` | `paradigm sync copilot` |
| **Windsurf** | `.windsurfrules` | `paradigm sync windsurf` |
| **Claude** | `CLAUDE.md` | `paradigm sync claude` |

All generated from `.paradigm/config.yaml` — one source of truth.

### Migrating Existing Rules

Have existing `.cursorrules` or other IDE files? Paradigm can help migrate them:

```bash
# Output a migration prompt for AI to help convert
paradigm init --migrate
```

This generates a detailed prompt that guides AI through splitting your existing rules into the modern scoped format.

## Packages

| Package | Description |
|---------|-------------|
| `@a-company/paradigm` | Unified CLI |
| `@a-company/paradigm-mcp` | MCP server for AI integrations |
| `@a-company/purpose-core` | `.purpose` file parsing |
| `@a-company/portal-core` | `portal.yaml` parsing |
| `@a-company/portal-sdk` | Runtime authorization SDK |
| `@a-company/premise-core` | Symbol aggregation |
| `@a-company/probe-core` | Visual discovery layer |

## Example Project

See [`examples/shopflow`](./examples/shopflow) for a complete example:

```
examples/shopflow/
├── .paradigm/          # Full configuration
├── .purpose            # Project context
├── .premise            # Ideas & overview
├── portal.yaml         # Authorization topology
├── auth/.purpose       # Auth module context
├── payments/.purpose   # Payment context
└── features/.purpose   # Feature definitions
```

## Development

```bash
# Clone
git clone https://github.com/ascend42/a-paradigm.git
cd a-paradigm

# Install dependencies
npm install

# Build all packages
npm run build

# Link CLI globally for testing
cd packages/paradigm && npm link
```

## Migrating from Horizon

If you have an existing Horizon project:

```bash
paradigm upgrade --from-horizon
```

This renames `.horizon/` to `.paradigm/`, `gate.yaml` to `portal.yaml`, etc.

## Philosophy

Paradigm believes that:

1. **Context should be structured** — Not buried in comments or tribal knowledge
2. **Authorization deserves visualization** — Topology over scattered middleware
3. **AI needs better context** — On-demand queries beat static files
4. **One source of truth** — Generate IDE-specific files from shared config

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for development setup and guidelines.

## License

[MIT](./LICENSE)

---

Built for developers who want their AI to actually understand their project.
