# Horizon

> Unified developer tools ecosystem for structured planning, testing, and ideation.

Horizon brings together three powerful developer tools into a single, visual experience:

| Tool | Metaphor | Domain | Question It Answers |
|------|----------|--------|---------------------|
| **Purpose** | Interior Designer | Structure & Context | "What is this? Why does it exist?" |
| **Gate** | Architect | Access & Authorization | "Who can access? Under what conditions?" |
| **Dream** | Thinker | Ideation & Aggregation | "What's the complete mental model?" |

## The Dreamscape

The Dreamscape is an infinite canvas where all project knowledge flows together:

- **Features** (`@`) from Purpose files
- **Components** (`#`) from Purpose files
- **Gates** (`^`) from Gate files
- **Signals** (`!`) from Gate files
- **Free-form ideas** (`?`) created directly in Dream

All interconnected, taggable, and explorable.

## Quick Start

```bash
# Install the CLI
npm install -g @horizon/cli

# Initialize in your project
horizon init

# Open the Dreamscape
horizon visualize
```

## Packages

| Package | Description |
|---------|-------------|
| `@horizon/purpose-core` | `.purpose` file parsing, validation, aggregation |
| `@horizon/gate-core` | `gate.yaml` parsing, validation |
| `@horizon/gate-sdk` | Runtime SDK for checking gates in applications |
| `@horizon/dream-core` | Aggregates Purpose + Gate, builds symbol index |
| `@horizon/visualizer` | The Dreamscape infinite canvas UI |
| `@horizon/cli` | Unified `horizon` command |

## Symbol System

| Symbol | Name | Owner | Example |
|--------|------|-------|---------|
| `@` | Feature | Purpose | `@checkout`, `@user-login` |
| `#` | Component | Purpose | `#Button`, `#api-client` |
| `$` | Flow | Shared | `$purchase-flow`, `$auth-flow` |
| `%` | State | Purpose | `%user.authenticated` |
| `~` | Aspect | Purpose | `@login~validation` |
| `^` | Gate | Gate | `^checkout`, `^admin-panel` |
| `!` | Signal | Gate | `!checkout-started` |
| `?` | Idea | Dream | `?maybe-add-export` |

## Example Project

The `examples/shopflow` directory contains a complete example demonstrating all Horizon features:

```
examples/shopflow/
├── .dream              # Project overview & idea board
├── .purpose            # Root project context
├── gate.yaml           # Authorization topology
├── auth/.purpose       # Authentication module
├── payments/.purpose   # Payment processing
├── features/.purpose   # Shopping features
└── components/.purpose # UI component library
```

Test it:

```bash
# Open the Dreamscape with the example
cd examples/shopflow
npx horizon visualize

# Or run from root
npm run dev:visualizer
# Then load examples/shopflow in the Dreamscape
```

## Development

```bash
# Install dependencies
npm install

# Build all packages
npm run build

# Start visualizer in dev mode
npm run dev:visualizer
```

## License

MIT
