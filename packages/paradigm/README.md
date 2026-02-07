# @a-company/paradigm

> Universal Agentic Development Protocol - Language & Discipline Agnostic

Paradigm is the **blueprint for AI-assisted development** that works across any tech stack, language, or discipline. Whether you're building a web app, training an ML model, writing firmware, or deploying infrastructure - Paradigm provides the same consistent context protocol.

## Installation

```bash
npm install -g @a-company/paradigm
```

## Quick Start

```bash
# Initialize Paradigm in your project
paradigm init

# Full setup: init + team + scan + sync all IDEs
paradigm shift

# Check project status
paradigm status

# Health check
paradigm doctor
```

## Commands

| Command | Description |
|---------|-------------|
| `paradigm init` | Initialize Paradigm in current project |
| `paradigm shift` | Full setup: init + team + scan + sync all IDEs |
| `paradigm sync` | Regenerate IDE instruction files |
| `paradigm scan` | Rebuild scan index |
| `paradigm status` | Show project overview |
| `paradigm doctor` | Health check and diagnostics |
| `paradigm team init` | Initialize multi-agent configuration |
| `paradigm team agents suggest` | Suggest agents for a task |
| `paradigm team orchestrate` | Run multi-agent orchestration |

### IDE Sync

Sync to specific IDEs:

```bash
paradigm sync cursor      # Generate .cursor/rules/*.mdc
paradigm sync copilot     # Generate .github/copilot-instructions.md
paradigm sync windsurf    # Generate .windsurfrules
paradigm sync claude      # Generate CLAUDE.md
paradigm sync --all       # Generate all IDE files
```

### Purpose Commands

```bash
paradigm purpose validate    # Validate .purpose files
paradigm purpose remember    # Show context for a path
```

### Portal Commands

```bash
paradigm portal validate     # Validate portal.yaml
paradigm portal test         # Run gate tests
```

### Premise Commands

```bash
paradigm premise aggregate   # Aggregate all symbols
paradigm premise snapshot    # Save current state
```

## Symbol System (v2)

5 operational symbols for code structure + a tag bank for classification:

| Symbol | Name | Description |
|--------|------|-------------|
| `#` | Component | Any documented code unit (features, services, UI, utils) |
| `$` | Flow | Multi-step processes or user journeys |
| `^` | Gate | Access control points and authorization rules |
| `!` | Signal | Events, errors, and side effects |
| `~` | Aspect | Cross-cutting rules with required code anchors |

### Tag Bank

Instead of dedicated symbol prefixes, classify with tags:

| Tag | Purpose | Example |
|-----|---------|---------|
| `[feature]` | User-facing capability | `#checkout` with `tags: [feature]` |
| `[integration]` | External service | `#stripe-service` with `tags: [integration, stripe]` |
| `[state]` | State management | `#user-store` with `tags: [state]` |
| `[idea]` | Future possibility | Any symbol with `tags: [idea]` |
| `[deprecated]` | Marked for removal | Any symbol with `tags: [deprecated]` |

## Supported Disciplines

Paradigm's symbol system is universal. The same symbols work across:

| Discipline | Component `#` | Gate `^` | Signal `!` |
|------------|---------------|----------|------------|
| Web | `#checkout` | `^authenticated` | `!payment-completed` |
| Backend | `#user-service` | `^admin` | `!user-created` |
| ML | `#classifier-v2` | `^model-validated` | `!training-complete` |
| Mobile | `#home-screen` | `^biometric-auth` | `!push-received` |
| Game | `#attack-system` | `^level-unlocked` | `!enemy-defeated` |
| Embedded | `#spi-driver` | `^calibrated` | `!sensor-read` |
| DevOps | `#vpc-module` | `^deploy-approved` | `!deploy-complete` |

See `specs/disciplines.md` for complete mappings.

## Project Structure

When initialized, Paradigm creates:

```
.paradigm/
├── config.yaml          # Main configuration + discipline setting
├── tags.yaml            # Tag bank definitions
├── specs/
│   ├── symbols-v2.md    # Symbol system reference
│   ├── disciplines.md   # Discipline-specific mappings
│   ├── logger.md        # Logging specification
│   └── scan.md          # Visual discovery protocol
├── docs/
│   ├── commands.md      # CLI reference
│   ├── patterns.md      # Coding patterns
│   └── troubleshooting.md
└── agents.yaml          # Multi-agent configuration
```

## Documentation

See the [main repository](https://github.com/ascend42/a-paradigm) for full documentation.

## License

MIT
