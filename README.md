# Paradigm

[![CI](https://github.com/ascend42/a-horizon/actions/workflows/ci.yml/badge.svg)](https://github.com/ascend42/a-horizon/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/@a-company/paradigm.svg)](https://www.npmjs.com/package/@a-company/paradigm)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen.svg)](https://nodejs.org/)

> Unified developer tools ecosystem for structured planning, testing, and ideation.

Paradigm brings together three powerful developer tools into a single, visual experience:

| Tool | Metaphor | Domain | Question It Answers |
|------|----------|--------|---------------------|
| **Purpose** | Interior Designer | Structure & Context | "What is this? Why does it exist?" |
| **Portal** | Architect | Access & Authorization | "Who can access? Under what conditions?" |
| **Premise** | Thinker | Ideation & Aggregation | "What's the complete mental model?" |

## Prism - The Visual Canvas

Prism is an infinite canvas where all project knowledge flows together:

- **Features** (`@`) from Purpose files
- **Components** (`#`) from Purpose files
- **Portals** (`^`) from Portal files
- **Signals** (`!`) from Portal files
- **Free-form ideas** (`?`) created directly in Premise

All interconnected, taggable, and explorable.

## Quick Start

```bash
# Install the CLI
npm install -g @a-company/paradigm

# Initialize in your project
paradigm init

# Open Prism visualizer
paradigm visualize
```

## Packages

| Package | Description |
|---------|-------------|
| [`@a-company/paradigm`](./packages/paradigm) | Unified `paradigm` command |
| [`@a-company/purpose-core`](./packages/purpose/core) | `.purpose` file parsing, validation, aggregation |
| [`@a-company/portal-core`](./packages/portal/core) | `portal.yaml` parsing, validation |
| [`@a-company/portal-sdk`](./packages/portal/sdk) | Runtime SDK for checking portals in applications |
| [`@a-company/portal-manager`](./packages/portal/manager) | Portal testing and validation |
| [`@a-company/premise-core`](./packages/premise/core) | Aggregates Purpose + Portal, builds symbol index |
| [`@a-company/probe-core`](./packages/probe/core) | Visual discovery layer for AI agents |
| [`@a-company/prism`](./packages/prism) | The Prism infinite canvas UI |

## Symbol System

| Symbol | Name | Owner | Example |
|--------|------|-------|---------|
| `@` | Feature | Purpose | `@checkout`, `@user-login` |
| `#` | Component | Purpose | `#Button`, `#api-client` |
| `$` | Flow | Shared | `$purchase-flow`, `$auth-flow` |
| `%` | State | Purpose | `%user.authenticated` |
| `~` | Aspect | Purpose | `@login~validation` |
| `^` | Portal | Portal | `^checkout`, `^admin-panel` |
| `!` | Signal | Portal | `!checkout-started` |
| `?` | Idea | Premise | `?maybe-add-export` |

## Example Project

The `examples/shopflow` directory contains a complete example demonstrating all Paradigm features:

```
examples/shopflow/
├── .premise            # Project overview & idea board
├── .purpose            # Root project context
├── portal.yaml         # Authorization topology
├── auth/.purpose       # Authentication module
├── payments/.purpose   # Payment processing
├── features/.purpose   # Shopping features
└── components/.purpose # UI component library
```

Test it:

```bash
# Open Prism with the example
cd examples/shopflow
npx paradigm visualize

# Or run from root
npm run dev:prism
# Then load examples/shopflow in Prism
```

## Development

```bash
# Install dependencies
npm install

# Build all packages
npm run build

# Start Prism in dev mode
npm run dev:prism

# Format code
npm run format

# Create a changeset for publishing
npm run changeset
```

## Migrating from Horizon

If you have an existing Horizon project, you can migrate to Paradigm:

```bash
paradigm upgrade --from-horizon
```

This will:
- Rename `.horizon/` to `.paradigm/`
- Rename `gate.yaml` to `portal.yaml`
- Rename `.dream` files to `.premise`
- Update IDE instruction files

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for development setup and guidelines.

## License

[MIT](./LICENSE)
