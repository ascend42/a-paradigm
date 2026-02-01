# Paradigm

[![npm version](https://img.shields.io/npm/v/@a-company/paradigm.svg)](https://www.npmjs.com/package/@a-company/paradigm)
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

Plus **Prism** — an infinite canvas to visualize it all.

## Quick Start

```bash
# Install
npm install -g @a-company/paradigm

# Initialize (detects existing IDE files, offers migration)
paradigm init

# Generate AI context
paradigm beacon

# Open visualizer
paradigm visualize
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

### Setup & Sync

```bash
paradigm init              # Initialize Paradigm (smart detection)
paradigm init --migrate    # Output migration prompt for existing rules
paradigm init --dry-run    # Show what would be created
paradigm sync              # Regenerate IDE instructions
paradigm sync --all        # Sync all IDEs (Cursor, Copilot, etc.)
paradigm doctor            # Health check and validation
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

### Visualization

```bash
paradigm visualize         # Open Prism canvas
paradigm portal watch      # Real-time authorization viewer
paradigm portal report     # Export session report
```

## Agent Efficiency

Paradigm is designed to make AI agents faster and more context-aware:

| Feature | What It Does | Command |
|---------|--------------|---------|
| **Beacon** | Quick-start orientation file | `paradigm beacon` |
| **Constellation** | Machine-readable symbol graph | `paradigm constellation` |
| **Ripple** | Change impact analysis | `paradigm ripple @symbol` |
| **Thread** | Session continuity | `paradigm thread` |
| **Echo** | Error-to-symbol mapping | `paradigm echo ERROR_CODE` |
| **Agent Hints** | CLI query patterns in IDE rules | Auto-generated |

**Token efficiency**: Instead of loading large context files (~2000 tokens), AI can query on-demand (~100 tokens per query).

```bash
# AI runs this before modifying @checkout
paradigm ripple @checkout --json

# AI debugs an error
paradigm echo AUTH_REQUIRED --json

# AI queries constellation directly
jq '.stars["@checkout"]' .paradigm/constellation.json
```

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
| [`@a-company/paradigm`](./packages/paradigm) | Unified CLI |
| [`@a-company/purpose-core`](./packages/purpose/core) | `.purpose` file parsing |
| [`@a-company/portal-core`](./packages/portal/core) | `portal.yaml` parsing |
| [`@a-company/portal-sdk`](./packages/portal/sdk) | Runtime authorization SDK |
| [`@a-company/portal-viewer`](./packages/portal/viewer) | Real-time portal visualization |
| [`@a-company/premise-core`](./packages/premise/core) | Symbol aggregation |
| [`@a-company/probe-core`](./packages/probe/core) | Visual discovery layer |
| [`@a-company/prism`](./packages/prism) | Infinite canvas visualizer |

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
# Install dependencies
npm install

# Build all packages
npm run build

# Start Prism visualizer
npm run dev:prism

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
