# @horizon/cli

> Unified CLI for Horizon developer tools

The `horizon` command brings together Purpose, Gate, and Dream into a single, powerful developer experience.

## Installation

```bash
npm install -g @horizon/cli
```

## Quick Start

```bash
# Initialize Horizon in your project
horizon init

# Open the Dreamscape visualizer
horizon visualize

# Check project status
horizon status

# Run the interactive tutorial
horizon tutorial
```

## Commands

| Command | Description |
|---------|-------------|
| `horizon init` | Initialize Horizon in current project |
| `horizon visualize` | Open the Dreamscape infinite canvas |
| `horizon status` | Show project overview |
| `horizon tutorial` | Interactive learning experience |
| `horizon sync` | Regenerate IDE instruction files |
| `horizon doctor` | Health check and diagnostics |

### Purpose Commands

```bash
horizon purpose validate    # Validate .purpose files
horizon purpose remember    # Show context for a path
```

### Gate Commands

```bash
horizon gate validate      # Validate gate.yaml
horizon gate test          # Run gateway tests
```

### Dream Commands

```bash
horizon dream aggregate    # Aggregate all symbols
horizon dream snapshot     # Save current state
```

## Documentation

See the [main repository](https://github.com/ascend42/a-horizon) for full documentation.

## License

MIT
