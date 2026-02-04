<p align="center">
  <img src="assets/logo.png" alt="Paradigm Logo" width="200">
</p>

<h1 align="center">Paradigm</h1>

<p align="center">
  <a href="https://opensource.org/licenses/MIT"><img src="https://img.shields.io/badge/License-MIT-yellow.svg" alt="License: MIT"></a>
  <a href="https://nodejs.org/"><img src="https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen.svg" alt="Node.js"></a>
</p>

<p align="center"><strong>Structure for AI-Native Development</strong></p>

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

### Recommended: Clone and Build

```bash
# 1. Clone the repository
git clone https://github.com/ascend42/a-paradigm.git
cd a-paradigm

# 2. Install dependencies and build
npm install && npm run build

# 3. Install CLI globally
npm link @a-company/paradigm

# 4. Verify installation
paradigm --version
```

### Quick Install (One Command)

For public repositories, you can use the install script:

```bash
curl -fsSL https://raw.githubusercontent.com/ascend42/a-paradigm/main/install.sh | bash
```

Or download and inspect first:

```bash
curl -fsSL https://raw.githubusercontent.com/ascend42/a-paradigm/main/install.sh -o install.sh
chmod +x install.sh
./install.sh
```

### Alternative: Local Install Script

If you already cloned the repo:

```bash
cd a-paradigm
./install.sh
```

**What the install script does:**
- Installs dependencies
- Builds all packages
- Installs the `paradigm` CLI globally
- Verifies installation

```bash
# 1. Clone and build
git clone https://github.com/ascend42/a-paradigm.git
cd a-paradigm
npm install && npm run build

# 2. Install CLI globally
npm link @a-company/paradigm

# 3. Verify
paradigm --version
```

---

## 📖 Documentation

**[Complete Documentation Hub →](./docs/README.md)**

Quick access:
- **[Quick Start Guide](./docs/guides/quick-start.md)** - Step-by-step setup walkthrough
- **[Command Reference](./docs/README.md#command-reference)** - Detailed guides for all commands
- **[MCP Setup](./docs/guides/mcp-setup.md)** - AI client integration guide

Popular command guides:
- [`paradigm init`](./docs/commands/init.md) - Initialize your project
- [`paradigm sync`](./docs/commands/sync.md) - Update IDE files
- [`paradigm ripple`](./docs/commands/ripple.md) - Analyze change impact
- [`paradigm beacon`](./docs/commands/beacon.md) - Generate AI context

---

## Quick Start

### Super Command (Complete Setup)

Navigate to your project and run:

```bash
paradigm init --quick && paradigm sync --all && paradigm mcp setup --client all && paradigm constellation && paradigm beacon && paradigm doctor
```

**What this does:**
1. ✅ Initializes `.paradigm/` configuration
2. ✅ Generates IDE files for Cursor, Claude, Copilot, Windsurf
3. ✅ Configures MCP for all detected AI clients
4. ✅ Generates symbol graph and AI orientation
5. ✅ Verifies everything is set up correctly

### Step-by-Step Setup

```bash
# 1. Initialize configuration
paradigm init --quick

# 2. Generate IDE instruction files
paradigm sync --all

# 3. Configure MCP for AI tools
paradigm mcp setup --client all

# 4. Generate symbol graph and orientation
paradigm constellation
paradigm beacon

# 5. Verify setup
paradigm doctor
```

## What Gets Created

```
your-project/
├── .paradigm/              # Configuration & specs (~60KB, lean)
│   ├── config.yaml         # Main configuration
│   ├── specs/              # Logger, symbols, context specs
│   └── docs/               # Patterns, troubleshooting
├── .purpose                # Feature & component context
├── .premise                # Project overview & ideas
└── .cursor/rules/          # Generated IDE instructions
    ├── paradigm-core.mdc
    ├── paradigm-symbols.mdc
    └── ...
```

**Note:** Reference content (prompts, command docs, discipline mappings) is served via MCP resources instead of being copied to your project. This keeps templates lean while providing full content on-demand.

## Getting Started with Minimal Paradigm

You don't need to use everything. Start small:

```bash
# 1. Initialize with defaults
paradigm init

# 2. Add context to your main feature directory
# Edit src/features/.purpose (or wherever your features live)

# 3. Generate AI orientation
paradigm beacon
```

**That's it.** Your AI assistant can now read `beacon.md` for quick context.

Add more as needed:
- `portal.yaml` — when you need authorization topology
- `.paradigm/prompts/` — for reusable task templates
- MCP server — for dynamic, mid-conversation queries

**📖 For detailed explanations:** See the [documentation hub](./docs/README.md) for comprehensive guides on each command.

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

**📖 Deep dive:** See [detailed command guides](./docs/README.md#command-reference) for comprehensive usage patterns, examples, and troubleshooting.

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

### MCP-First Architecture

Paradigm uses an MCP-first approach where reference content is served on-demand rather than being copied to every project:

| Category | Local (`.paradigm/`) | MCP Resources |
|----------|---------------------|---------------|
| **Configuration** | `config.yaml`, `specs/logger.md`, `specs/symbols.md` | — |
| **Prompts** | — | `paradigm://prompts`, `paradigm://prompts/{name}` |
| **Reference Docs** | — | `paradigm://docs/commands`, `paradigm://docs/queries` |
| **Reference Specs** | — | `paradigm://specs/disciplines`, `paradigm://specs/scan` |

**Benefits:**
- **Lean templates**: ~60KB instead of ~260KB per project
- **Always current**: MCP serves latest version from package
- **Token efficient**: Load only what you need, when you need it
- **Session tracking**: Monitor token usage with `paradigm_session_stats`

### Available Resources & Tools

| Resource/Tool | Purpose |
|---------------|---------|
| `paradigm://symbols` | Query all project symbols |
| `paradigm://symbol/@checkout` | Get single symbol details |
| `paradigm://prompts` | List available prompt templates |
| `paradigm://prompts/add-feature` | Get specific prompt content |
| `paradigm://docs/commands` | CLI command reference |
| `paradigm://specs/disciplines` | Symbol mappings by domain |
| `paradigm_search` | Find symbols by query |
| `paradigm_ripple` | Impact analysis on-demand |
| `paradigm_related` | Get connected symbols |
| `paradigm_status` | Project overview |
| `paradigm_session_stats` | Session token usage and cost |
| `paradigm_context_check` | Handoff recommendations |

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

## Documentation

**[Complete Documentation Hub](./docs/README.md)** - Comprehensive guides for all Paradigm features

Key resources:
- [Quick Start Guide](./docs/guides/quick-start.md)
- [Command Reference](./docs/README.md#command-reference)
- [MCP Setup Guide](./docs/guides/mcp-setup.md)
- [Changelog](./CHANGELOG.md)

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for development setup and guidelines.

## License

[MIT](./LICENSE)

---

Built for developers who want their AI to actually understand their project.
