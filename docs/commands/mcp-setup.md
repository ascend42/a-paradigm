# paradigm mcp setup

Configure Model Context Protocol (MCP) servers for AI clients to enable dynamic Paradigm integration.

## Overview

Generates MCP configuration files for AI clients (Cursor, Claude Desktop, Continue, Cline), allowing them to query Paradigm data dynamically through tools like `paradigm_ripple`, `paradigm_status`, `paradigm_navigate`.

## What It Does

**Configures MCP for:**
- **Cursor** - Project-level `.cursor/mcp.json`
- **Claude Desktop** - User-level `claude_desktop_config.json` 
- **Continue (VS Code)** - User-level `.continue/config.json`
- **Cline (VS Code)** - Project-level `.cline/mcp.json`

**Adds permissions (Claude):**
- `Bash(paradigm *)` - Allows running all paradigm commands without prompts

**Provides AI tools:**
- `paradigm_status` - Project overview
- `paradigm_ripple` - Impact analysis
- `paradigm_search` - Find symbols
- `paradigm_related` - Dependency graph
- `paradigm_navigate` - Codebase exploration
- `paradigm_session_health` - Session health monitoring

## Why You Need It

**For AI agents:**
- **Live data access** - Query fresh Paradigm data, not stale files
- **Dynamic workflows** - Call paradigm commands during conversation
- **Impact analysis** - Check ripple effects before changes
- **Context efficiency** - ~100 tokens per query vs ~2000 for reading files

**For developers:**
- **Better AI assistance** - Agents understand your codebase structure
- **Automated workflows** - AI can run paradigm commands
- **Real-time insights** - Fresh data every time

## When to Run It

### ✅ Run once per:
- **New project** - After `paradigm shift`
- **New machine** - Fresh dev environment setup
- **AI client install** - Just installed Cursor/Claude/etc.

### 🔄 Re-run after:
- **Paradigm updates** - New MCP features
- **Config corruption** - MCP not working
- **Adding new AI client** - Installed another tool

### ⚠️ NOT needed after:
- Paradigm content changes (`.purpose` files, etc.)
- Project code changes
- Normal development

## Usage

```bash
# Auto-detect and configure all found clients
paradigm mcp setup

# Configure specific client
paradigm mcp setup --client cursor
paradigm mcp setup --client claude-desktop
paradigm mcp setup --client continue
paradigm mcp setup --client cline

# Configure all detected clients
paradigm mcp setup --client all

# Force overwrite existing config
paradigm mcp setup --force

# Skip .gitignore update
paradigm mcp setup --no-gitignore

# JSON output (for scripts)
paradigm mcp setup --json
```

## Output

```
🔌 Paradigm MCP Setup

Detected AI clients:

  ✓ Cursor (project-level)
  ✓ Claude Desktop (user-level)
  ✓ Continue (VS Code) (user-level)
  ○ Cline (VS Code) (not found)

✔ Cursor configured
   → /Users/you/project/.cursor/mcp.json
   → Added to .gitignore
✔ Claude Desktop configured
   → /Users/you/Library/Application Support/Claude/claude_desktop_config.json
✔ Continue (VS Code) configured
   → /Users/you/.continue/config.json

✓ MCP setup complete!

Next steps:
  • Restart Cursor to activate MCP
  • Restart Claude Desktop to activate MCP
  • Restart VS Code to activate MCP

Then try asking your AI:
  "What features are in the my-project project?"
  "What would break if I changed #feature-name?"
```

## Configuration Files

### Cursor (`.cursor/mcp.json`)
```json
{
  "mcpServers": {
    "my-project": {
      "command": "npx",
      "args": ["@a-company/paradigm-mcp"],
      "cwd": "/absolute/path/to/project"
    }
  }
}
```

### Claude Desktop (`claude_desktop_config.json`)
```json
{
  "mcpServers": {
    "my-project": {
      "command": "npx",
      "args": ["@a-company/paradigm-mcp"],
      "cwd": "/absolute/path/to/project"
    }
  },
  "permissions": {
    "allow": ["Bash(paradigm *)"]
  }
}
```

### Continue (`.continue/config.json`)
```json
{
  "experimental": {
    "modelContextProtocolServers": [
      {
        "transport": {
          "type": "stdio",
          "command": "npx",
          "args": ["@a-company/paradigm-mcp"],
          "cwd": "/absolute/path/to/project"
        }
      }
    ]
  }
}
```

## Integration with Other Commands

**Standard setup workflow:**
```bash
# 1. Initialize project
paradigm shift --quick

# 2. Generate AI context
paradigm beacon
paradigm constellation

# 3. Configure MCP
paradigm mcp setup --client all

# 4. Restart AI clients

# 5. Test MCP
# Ask AI: "What features are in this project?"
```

## Common Workflows

### Fresh Project Setup
```bash
paradigm shift --quick
paradigm sync --all
paradigm mcp setup --client all
# Restart IDEs
```

### Single IDE User
```bash
# Just configure your IDE
paradigm mcp setup --client cursor
# Restart Cursor
```

### Team with Multiple Tools
```bash
# Configure everything
paradigm mcp setup --client all
# Team members restart their preferred IDE
```

### Troubleshooting MCP
```bash
# Check status
paradigm mcp status

# Reconfigure
paradigm mcp setup --force

# Remove and reconfigure
paradigm mcp remove
paradigm mcp setup
```

## Tips & Gotchas

**Pro tips:**
- **Restart required** - MCP only loads on IDE startup
- **Test immediately** - Ask AI "What features exist?" to verify
- **User vs project** - Claude/Continue are user-level, Cursor/Cline are project-level
- **Permissions** - Claude automatically gets `Bash(paradigm *)` permission
- **Multiple projects** - Each project gets its own MCP server entry

**Watch out for:**
- MCP configs use **absolute paths** - don't commit them
- `.gitignore` is auto-updated (unless `--no-gitignore`)
- **npm link required** - If developing Paradigm, run `npm link` in CLI
- **Network issues** - MCP uses stdio, not HTTP
- **PATH problems** - Cursor doesn't inherit shell PATH (use absolute paths)

## MCP Tools Available

Once configured, AI agents can call:

### Status & Overview
- `paradigm_status` - Project health, symbol counts
- `paradigm_search` - Find symbols by name/description

### Impact Analysis
- `paradigm_ripple` - What breaks if I change X?
- `paradigm_related` - Dependencies and dependents

### Navigation
- `paradigm_navigate` - Explore codebase by intent
  - `find` - Locate specific symbols
  - `explore` - Discover areas
  - `context` - Get context for task

### Session Management
- `paradigm_session_health` - Monitor token usage
- `paradigm_handoff_prepare` - Prepare context handoff

## Checking MCP Status

```bash
# See which clients are configured
paradigm mcp status

# Output:
#   ✓ Cursor: configured
#      Servers: my-project
#   ✓ Claude Desktop: configured  
#      Servers: my-project, other-project
#   ○ Continue: not configured
```

## Removing MCP Configuration

```bash
# Remove from current project
paradigm mcp remove

# Remove specific client
paradigm mcp remove --client cursor

# List all configured servers
paradigm mcp list
```

## Examples

**Example 1: First-time setup**
```bash
# New machine, fresh project
paradigm shift --quick
paradigm mcp setup --client all
# Restart all IDEs

# Test in Cursor/Claude:
# "What features are in this project?"
```

**Example 2: Just Cursor**
```bash
# Cursor user only
paradigm mcp setup --client cursor
# Restart Cursor

# Test: "paradigm_status"
```

**Example 3: Team setup script**
```bash
#!/bin/bash
# setup-paradigm.sh
paradigm shift --quick
paradigm sync --all
paradigm mcp setup --client all
paradigm beacon && paradigm constellation

echo "✓ Paradigm configured"
echo "Next: Restart your IDE"
```

**Example 4: Fixing broken MCP**
```bash
# MCP not working
paradigm mcp status  # Check configuration

# Reconfigure
paradigm mcp setup --force --client all

# Restart IDE and test
```

## Troubleshooting

**Problem: "No MCP tools showing in AI"**
- Solution: Restart IDE completely, check `paradigm mcp status`

**Problem: "DeleteClient action" or immediate disconnect**
- Solution: Check npm link, use absolute path in mcp.json
- See: [MCP Troubleshooting Guide](../guides/mcp-setup.md#troubleshooting)

**Problem: "paradigm command not found" in Claude**
- Solution: Add `Bash(paradigm *)` permission to claude_desktop_config.json
- Run: `paradigm mcp setup --client claude-desktop --force`

**Problem: "MCP working for one project, not another"**
- Solution: Run `paradigm mcp setup` in each project directory

**Problem: "Changes to .purpose not reflected"**
- Solution: MCP reads live files - no action needed (data is always fresh)

## Performance

MCP queries are fast:
- `paradigm_status`: ~50-100ms
- `paradigm_ripple`: ~100-200ms
- `paradigm_search`: ~50-100ms

Token-efficient:
- Status query: ~100 tokens
- vs reading files: ~2000 tokens

## Security

**What's safe:**
- Project-level MCP configs (Cursor, Cline)
- User-level MCP configs (Claude, Continue)

**Don't commit:**
- `.cursor/mcp.json` - Contains local paths
- `.cline/mcp.json` - Contains local paths

**Do commit:**
- `.gitignore` entries - Auto-added by setup

## See Also

- [MCP Setup Guide](../guides/mcp-setup.md) - Detailed setup walkthrough
- [MCP Troubleshooting](../guides/mcp-setup.md#troubleshooting) - Common issues
- [`paradigm mcp status`](./mcp-setup.md#checking-mcp-status) - Check configuration
- [`paradigm init`](./init.md) - Project initialization
- [Model Context Protocol](https://modelcontextprotocol.io) - MCP specification
