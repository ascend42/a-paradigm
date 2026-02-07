# paradigm init

Initialize Paradigm in your project with all necessary configuration files and IDE integrations.

## Overview

Sets up the `.paradigm/` directory structure, creates initial context files (`.premise`, `.purpose`), and generates IDE-specific instruction files for your detected or chosen IDE.

## What It Does

**Creates:**
- `.paradigm/` - Core directory with:
  - `config.yaml` - Project configuration
  - `specs/` - Logger, symbols, and probe specifications
  - `docs/` - Commands, patterns, and troubleshooting guides
  - `prompts/` - Reusable task templates for AI agents
- `.premise` - Project overview and vision statement
- `.purpose` - Root feature context file
- IDE instruction files (`.cursor/rules/`, `CLAUDE.md`, etc.)

**Optional:**
- `portal.yaml` - Authorization gate definitions (create manually if needed)

## Why You Need It

- **First step** for any Paradigm project
- Establishes the symbol system and conventions
- Provides AI agents with immediate context about your project structure
- Creates IDE-specific instructions so AI understands Paradigm patterns

## When to Run It

### ✅ Run once per project:
- **New projects** - Right after `git init` or project creation
- **Existing projects** - When adopting Paradigm

### ⚠️ Don't run multiple times:
- Use `paradigm sync` to regenerate IDE files
- Use `paradigm upgrade` to update Paradigm files to latest version

## Usage

```bash
# Quick initialization (recommended for new projects)
paradigm init --quick

# Interactive setup with prompts
paradigm init

# Force overwrite existing files
paradigm init --force

# Specify project name
paradigm init --name "my-project"

# Target specific IDE
paradigm init --ide cursor

# Dry run (see what would be created)
paradigm init --dry-run

# Migration mode (convert existing IDE files)
paradigm init --migrate
```

## Output

```
✨ Paradigm initialized!

Created:
─────────────────────────────────────────────────
📁 .paradigm/
   ├── config.yaml      Configuration
   ├── specs/           Logger, probe, symbols
   ├── docs/            Commands, patterns
   └── prompts/         Task templates
📄 .premise             Project overview
📄 .purpose             Feature context
📄 .cursor/rules/       IDE instructions

Next steps:
─────────────────────────────────────────────────
1. Review .paradigm/config.yaml
2. Edit .purpose to define your features
3. Run paradigm beacon to generate AI context
4. Run paradigm doctor to verify setup
5. Run paradigm visualize to see your project
```

## Integration with Other Commands

**Typical workflow after init:**
```bash
# 1. Initialize
paradigm init --quick

# 2. Generate AI context
paradigm beacon
paradigm constellation

# 3. Set up MCP for AI tools
paradigm mcp setup --client all

# 4. Verify everything
paradigm doctor
```

## Common Workflows

### New Project Setup
```bash
# Create project
mkdir my-app && cd my-app
git init

# Initialize Paradigm
paradigm init --quick

# Set up for all tools
paradigm sync --all
paradigm mcp setup --client all

# Generate AI context
paradigm beacon && paradigm constellation
```

### Migrating Existing Project
```bash
# Check what exists
paradigm init --dry-run

# Get migration prompt for AI
paradigm init --migrate

# Copy prompt to AI agent, then:
paradigm init --force
```

### Team Standardization
```bash
# Use same IDE across team
paradigm init --ide cursor --quick

# Or support multiple IDEs
paradigm init --quick
paradigm sync --all
```

## Tips & Gotchas

**Pro tips:**
- Use `--quick` for sensible defaults, skip it for customization
- Run `paradigm doctor` after init to catch any issues
- The `.paradigm/` directory should be committed to git
- MCP configs (`.cursor/mcp.json`, `.claude/settings.json`) go in `.gitignore`

**Watch out for:**
- Don't run `init` multiple times - use `sync` or `upgrade` instead
- If `.paradigm/` already exists, use `--force` or `--migrate`
- IDE detection might fail - specify with `--ide` if needed
- `portal.yaml` is optional - only create if you need authorization gates

## IDE Detection

Paradigm auto-detects your IDE by checking for:
- `.cursor/` directory → Cursor
- `.github/copilot-instructions.md` → GitHub Copilot
- `.windsurfrules` → Windsurf
- `CLAUDE.md` → Claude Code

Specify manually with `--ide cursor|copilot|windsurf|claude` if detection fails.

## What Gets Generated

### Cursor (multi-file)
```
.cursor/rules/
├── paradigm-core.mdc
├── paradigm-symbols.mdc
├── paradigm-logging.mdc
├── paradigm-context.mdc
├── paradigm-navigator.mdc
└── ... (10 files total)
```

### Claude (single file)
```
CLAUDE.md  (comprehensive context file)
```

### Copilot (multi-file)
```
.github/instructions/
├── paradigm-core.md
├── paradigm-symbols.md
└── ... (similar to Cursor)
```

### Windsurf (single file)
```
.windsurfrules  (combined instructions)
```

## Examples

**Example 1: React app setup**
```bash
npx create-react-app my-app
cd my-app
paradigm init --quick
# Edit .purpose to define #login, #dashboard, etc.
```

**Example 2: Existing Node.js API**
```bash
cd existing-api
paradigm init --migrate  # Get AI migration prompt
# AI converts existing .cursorrules to Paradigm
paradigm init --force
```

**Example 3: Multi-IDE team**
```bash
paradigm init --quick
paradigm sync --all  # Generate for cursor, copilot, windsurf, claude
git add .paradigm/ .cursor/ .github/ CLAUDE.md .windsurfrules
```

## Troubleshooting

**Problem: "⚠ .paradigm/ already exists"**
- Solution: Use `--force` to overwrite, or `paradigm upgrade` to update

**Problem: "Could not auto-detect IDE"**
- Solution: Specify with `--ide cursor` (or copilot/windsurf/claude)

**Problem: "Legacy .paradigm file found"**
- Solution: Run `paradigm upgrade --all` to migrate to directory structure

**Problem: IDE files not updating**
- Solution: Use `paradigm sync` not `init` for regeneration

## See Also

- [`paradigm sync`](./sync.md) - Regenerate IDE files after config changes
- [`paradigm upgrade`](./upgrade.md) - Update Paradigm to latest version
- [`paradigm doctor`](./doctor.md) - Verify setup health
- [`paradigm beacon`](./beacon.md) - Generate AI orientation file
- [Quick Start Guide](../guides/quick-start.md) - Complete setup walkthrough
