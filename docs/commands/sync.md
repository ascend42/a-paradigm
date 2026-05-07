# paradigm sync

Regenerate IDE instruction files from your `.paradigm/` configuration after making changes.

## Overview

Reads your `.paradigm/config.yaml` and specification files, then generates fresh IDE-specific instruction files. Think of it as "compile `.paradigm/` → IDE files".

## What It Does

**Generates:**
- IDE instruction files (`.cursor/rules/*.mdc`, `CLAUDE.md`, etc.)
- MCP configuration files (`.cursor/mcp.json`, `.claude/settings.json`)
- Nested context files (for Claude Code, if requested)

**Uses as input:**
- `.paradigm/config.yaml` - Your project configuration
- `.paradigm/specs/*.md` - Logger, symbols, probe specifications
- `.paradigm/docs/*.md` - Commands, patterns, troubleshooting
- `.premise` - Project overview
- `.purpose` - Feature definitions
- `portal.yaml` - Authorization gates (if exists)

## Why You Need It

- **Keep IDE instructions in sync** with your Paradigm configuration
- **Apply changes** after modifying `.paradigm/config.yaml`
- **Regenerate after updates** when Paradigm releases new features
- **Support multiple IDEs** on the same project

## When to Run It

### ✅ Run after:
- **Modifying `.paradigm/config.yaml`** - Settings like symbols, conventions
- **Updating Paradigm** - Get latest instruction templates
- **Switching IDEs** - Generate for different editor
- **Team onboarding** - Fresh instructions for new team members

### 🔄 Periodic:
- **After major feature additions** - Keep context fresh
- **Weekly/monthly** - Ensure latest templates

### ⚠️ NOT needed after:
- Editing `.purpose` files - these are read directly
- Editing `portal.yaml` - also read directly
- Running other Paradigm commands

## Usage

```bash
# Sync to auto-detected IDE
paradigm sync

# Sync to all supported IDEs
paradigm sync --all

# Sync to specific IDE
paradigm sync cursor
paradigm sync claude
paradigm sync copilot
paradigm sync windsurf

# Force overwrite (skip exists checks)
paradigm sync --force

# Include MCP configuration
paradigm sync --mcp

# Skip MCP configuration
paradigm sync --no-mcp

# Generate nested contexts (Claude only)
paradigm sync claude --nested
```

## Output

```
🔄 Paradigm Sync

✔ Loaded configuration for my-project

Syncing to all IDEs...

  ✓ cursor → .cursor/rules
  ✓ copilot → .github/instructions
  ✓ windsurf → .windsurfrules
  ✓ claude → CLAUDE.md

  ✓ MCP config for cursor
  ✓ MCP config for claude

4/4 IDE files generated.
```

## Integration with Other Commands

**Common workflows:**

```bash
# After config change
vim .paradigm/config.yaml
paradigm sync

# Full regeneration
paradigm sync --all --force

# Update everything
paradigm migrate
paradigm sync --all
paradigm beacon && paradigm constellation
```

## Common Workflows

### After Config Changes
```bash
# Edit conventions or symbols
vim .paradigm/config.yaml
paradigm sync
# Restart your IDE to pick up changes
```

### Multi-IDE Team Support
```bash
# Generate for everyone
paradigm sync --all

# Commit IDE files
git add .cursor/ .github/ CLAUDE.md .windsurfrules
git commit -m "Update IDE instructions"
```

### After Paradigm Update
```bash
# Update Paradigm CLI
npm install -g @a-company/paradigm@latest

# Regenerate with latest templates
paradigm sync --all --force
```

### MCP Configuration
```bash
# Sync with MCP config generation
paradigm sync claude --mcp

# Or use dedicated command
paradigm mcp setup --client all
```

## Tips & Gotchas

**Pro tips:**
- Run `--all` to support team members using different IDEs
- Use `--force` if files seem out of date
- Check `paradigm doctor` if sync seems broken
- MCP configs go in `.gitignore` (local paths)
- IDE instruction files should be committed

**Watch out for:**
- Need to restart IDE after sync for changes to take effect
- `--all` generates for all IDEs, even if you don't use them (harmless)
- Nested contexts (`--nested`) are experimental for Claude
- MCP config includes local paths, don't commit them

## What Gets Synced

### Cursor
```
.cursor/rules/
├── paradigm-core.mdc          # Core concepts
├── paradigm-symbols.mdc       # Symbol system
├── paradigm-logging.mdc       # Logger spec
├── paradigm-context.mdc       # Context monitoring
├── paradigm-navigator.mdc     # Codebase navigation
├── paradigm-portal.mdc        # Authorization gates
├── paradigm-commands.mdc      # CLI reference
├── paradigm-conventions.mdc   # Project conventions
├── paradigm-agent-hints.mdc   # AI workflow tips
└── paradigm-purpose.mdc       # Purpose file spec
```

### Claude
```
CLAUDE.md  (single comprehensive file with all above)
```

### MCP Configs
```
.cursor/mcp.json           # Cursor MCP server config
.claude/settings.json      # Claude Desktop config (with permissions)
```

## IDE-Specific Features

### Cursor
- **Multi-file rules** - Separate files for better rule matching
- **Scoped contexts** - Rules apply to specific file types
- **MCP integration** - Project-level MCP server

### Claude
- **Single file** - All context in `CLAUDE.md`
- **MCP workflow** - Includes tool usage instructions
- **Permissions** - Auto-adds `Bash(paradigm *)` permission
- **Nested contexts** - Experimental per-directory context

### Copilot
- **GitHub integration** - Uses `.github/instructions/`
- **Multi-file** - Similar structure to Cursor

### Windsurf
- **Single file** - All rules in `.windsurfrules`
- **Markdown format** - Simple, readable format

## Auto-Detection

If you don't specify an IDE, Paradigm checks for:

1. `.cursor/` directory → Cursor
2. `.github/copilot-instructions.md` → Copilot  
3. `.windsurfrules` → Windsurf
4. `CLAUDE.md` → Claude

Falls back to Cursor if nothing detected.

## Examples

**Example 1: Single IDE user**
```bash
# Just sync your IDE
paradigm sync
# Restart Cursor/Claude/etc.
```

**Example 2: Team with mixed IDEs**
```bash
# Generate for everyone
paradigm sync --all

# Commit
git add .cursor/ .github/ CLAUDE.md .windsurfrules
git commit -m "feat: update Paradigm instructions"
```

**Example 3: After config change**
```bash
# Changed symbol definitions
vim .paradigm/config.yaml
paradigm sync --force
code .  # Reopen VS Code to reload
```

**Example 4: Debug stale instructions**
```bash
# Force fresh generation
paradigm sync --all --force --mcp

# Verify
paradigm doctor
```

## Troubleshooting

**Problem: "No .paradigm/ directory found"**
- Solution: Run `paradigm shift` first

**Problem: "IDE instructions not updating"**
- Solution: Use `--force` flag, then restart IDE

**Problem: "MCP not working after sync"**
- Solution: Run `paradigm mcp setup --client all`, restart IDE

**Problem: "Changes not showing in IDE"**
- Solution: Restart your IDE completely (not just reload window)

## Performance

Sync is fast:
- Single IDE: ~50-200ms
- All IDEs: ~200-500ms
- Force regeneration: Similar (overwrites existing files)

Safe to run frequently.

## See Also

- [`paradigm init`](./init.md) - Initial setup
- [`paradigm mcp setup`](./mcp-setup.md) - Configure MCP separately
- [`paradigm upgrade`](./upgrade.md) - Update Paradigm version
- [`paradigm doctor`](./doctor.md) - Verify sync worked
- [IDE Adapters spec](../specs/ide-adapters.md) - Technical details
