# @a-company/paradigm

> Universal Agentic Development Protocol - Language & Discipline Agnostic

**Version 0.4.0** - Now with Claude adapter, discipline mappings, and enhanced templates.

Paradigm is the **blueprint for AI-assisted development** that works across any tech stack, language, or discipline. Whether you're building a web app, training an ML model, writing firmware, or deploying infrastructure - Paradigm provides the same consistent context protocol.

## Installation

```bash
npm install -g @a-company/paradigm
```

## Quick Start

```bash
# Initialize Paradigm in your project
paradigm init

# Open the Dreamscape visualizer
paradigm visualize

# Check project status
paradigm status

# Run the interactive tutorial
paradigm tutorial
```

## Commands

| Command | Description |
|---------|-------------|
| `paradigm init` | Initialize Paradigm in current project |
| `paradigm visualize` | Open the Dreamscape infinite canvas |
| `paradigm status` | Show project overview |
| `paradigm tutorial` | Interactive learning experience |
| `paradigm sync` | Regenerate IDE instruction files |
| `paradigm doctor` | Health check and diagnostics |
| `paradigm cursorrules` | Generate .cursorrules file |

### IDE Sync

Sync to specific IDEs:

```bash
paradigm sync cursor      # Generate .cursorrules
paradigm sync copilot     # Generate .github/copilot-instructions.md
paradigm sync windsurf    # Generate .windsurfrules
paradigm sync claude      # Generate CLAUDE.md (NEW in 0.4.0)
paradigm sync --all       # Generate all IDE files
```

### Purpose Commands

```bash
paradigm purpose validate    # Validate .purpose files
paradigm purpose remember    # Show context for a path
```

### Gate Commands

```bash
paradigm gate validate      # Validate gate.yaml
paradigm gate test          # Run gateway tests
```

### Dream Commands

```bash
paradigm dream aggregate    # Aggregate all symbols
paradigm dream snapshot     # Save current state
```

## Symbol System

| Symbol | Name | Description |
|--------|------|-------------|
| `@` | Feature | User-facing capabilities |
| `#` | Component | Reusable code units |
| `$` | Flow | Multi-step processes |
| `%` | State | Global/user state |
| `^` | Portal | Access control |
| `!` | Signal | Events and side effects |
| `?` | Idea | Future possibilities |
| `~` | Deprecated | Marked for removal (NEW) |
| `&` | Integration | External services (NEW) |

## What's New in 0.4.0

- **Claude Adapter**: Generate `CLAUDE.md` files for Claude-native contexts
- **New Symbols**: `~` (Deprecated) and `&` (Integration)
- **Discipline Mappings**: Universal support for Web, Backend, ML, Mobile, Game, Embedded, DevOps
- **Language Agnostic**: All examples in pseudocode, no language lock-in
- **Error Patterns**: Template for standardized error handling
- **ADR Templates**: Architecture Decision Record templates
- **Custom Symbols**: Extend the symbol set for domain-specific concepts

## Supported Disciplines

Paradigm's symbol system is universal. The same symbols work across:

| Discipline | Example `@` | Example `#` | Example `&` |
|------------|-------------|-------------|-------------|
| Web | `@checkout` | `#Button` | `&stripe` |
| Backend | `@users.create` | `#database` | `&postgres` |
| ML | `@classifier-v2` | `#dataloader` | `&wandb` |
| Mobile | `@home-screen` | `#card` | `&firebase` |
| Game | `@attack` | `#enemy-ai` | `&steamworks` |
| Embedded | `@read-sensor` | `#spi-driver` | `&mqtt` |
| DevOps | `@deploy` | `#vpc-module` | `&kubernetes` |

See `specs/disciplines.md` for complete mappings.

## Project Structure

When initialized, Paradigm creates:

```
.paradigm/
├── config.yaml          # Main configuration + discipline setting
├── specs/
│   ├── symbols.md       # Symbol system reference
│   ├── disciplines.md   # Discipline-specific mappings (NEW)
│   ├── logger.md        # Logging specification
│   └── scan.md          # Visual discovery protocol
├── docs/
│   ├── commands.md      # CLI reference
│   ├── patterns.md      # Coding patterns
│   ├── error-patterns.md # Error handling
│   ├── troubleshooting.md
│   └── decisions/       # ADR folder
│       ├── README.md
│       └── 000-template.md
└── prompts/             # Pre-written AI prompts
```

## Documentation

See the [main repository](https://github.com/ascend42/a-paradigm) for full documentation.

## License

MIT
