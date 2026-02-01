# Setting Up Paradigm MCP

This guide walks you through setting up Paradigm's MCP (Model Context Protocol) server to give AI assistants dynamic access to your project's symbols, gates, and flows.

---

## Quick Start

```bash
# Auto-detect and configure MCP for your AI client
paradigm mcp setup

# Or specify a client
paradigm mcp setup --client cursor
paradigm mcp setup --client claude-desktop
paradigm mcp setup --client all
```

**For Cursor users:** After setup, you must enable the server in Cursor Settings → Tools → Installed MCP Servers (toggle ON).

---

## Table of Contents

1. [What is MCP?](#what-is-mcp)
2. [Quick Setup (Recommended)](#quick-setup-recommended)
3. [Manual Setup](#manual-setup)
4. [Supported Clients](#supported-clients)
5. [Using Paradigm MCP](#using-paradigm-mcp)
6. [Advanced Configuration](#advanced-configuration)
7. [Troubleshooting](#troubleshooting)

---

## What is MCP?

**Model Context Protocol (MCP)** is Anthropic's open standard for connecting AI assistants to external data sources and tools. Instead of loading all context upfront (like `.cursorrules`), MCP allows Claude to query information dynamically during a conversation.

### Static vs Dynamic Context

| Approach | How It Works | Token Usage |
|----------|--------------|-------------|
| **Static (IDE Rules)** | Load everything at conversation start | ~2000 tokens upfront |
| **Dynamic (MCP)** | Query only what's needed, when needed | ~100 tokens per query |

```
Static:  [Load all context] → [Work on task]
         (Even irrelevant symbols consume tokens)

Dynamic: [Minimal context] → [Need @checkout info?] → [Query MCP] → [Continue]
         (Only fetch what's actually needed)
```

### Why Use MCP with Paradigm?

- **Token efficient** — Don't pay for context you don't use
- **Always current** — Reads live project state, not cached files
- **Targeted answers** — Claude can ask "what depends on X?" and get precise data
- **Technology agnostic** — Works with any language/framework

---

## Prerequisites

Before setting up MCP, ensure you have:

1. **A Paradigm project** — Run `paradigm init` if you haven't already
2. **Node.js 18+** — Required for the MCP server
3. **A supported AI client** — Cursor, Claude Desktop, Continue, or Cline

Verify your project is set up:

```bash
paradigm status
```

---

## Quick Setup (Recommended)

The easiest way to set up MCP is using the `paradigm mcp` command:

```bash
# Auto-detect installed clients and show options
paradigm mcp setup

# Configure a specific client
paradigm mcp setup --client cursor
paradigm mcp setup --client claude-desktop

# Configure all detected clients
paradigm mcp setup --client all

# Check current MCP configuration
paradigm mcp status
```

The command will:
1. Detect which AI clients are installed
2. Generate the appropriate config file
3. Add it to `.gitignore` (for project-level configs)
4. Show next steps

### Managing Multiple Projects

For user-level clients like Claude Desktop, each project you set up is **merged** into the shared config. To manage your servers:

```bash
# List all configured servers across all clients
paradigm mcp list

# Output:
# 🔌 Configured MCP Servers
#
# Claude Desktop (user-level):
#   ○ project-one     → /Users/me/projects/project-one
#   ● project-two     → (current)
#   ○ leadsync        → /Users/me/projects/leadsync-dash
#
# Cursor (this project):
#   ● a-paradigm       → (current)
```

### Removing Servers

```bash
# Remove current project from all clients
paradigm mcp remove

# Remove a specific server by name
paradigm mcp remove project-one --client claude-desktop

# Remove from all clients
paradigm mcp remove old-project --client all
```

---

## Supported Clients

| Client | Config Type | Config Location |
|--------|-------------|-----------------|
| **Cursor** | Project-level | `.cursor/mcp.json` |
| **Claude Desktop** | User-level | `~/Library/Application Support/Claude/claude_desktop_config.json` |
| **Continue (VS Code)** | User-level | `~/.continue/config.json` |
| **Cline (VS Code)** | Project-level | `.cline/mcp.json` |

**Project-level** configs are specific to a project and can be shared with your team.
**User-level** configs apply to all projects and are stored in your home directory.

---

## Manual Setup

If you prefer manual configuration, here are the config formats for each client:

### Cursor

Create `.cursor/mcp.json` in your project:

```json
{
  "mcpServers": {
    "your-project": {
      "command": "npx",
      "args": ["@a-company/paradigm-mcp"],
      "cwd": "/path/to/your/project"
    }
  }
}
```

**Important: Enable the server in Cursor**

After creating the config, you must manually enable the MCP server:

1. Open Cursor Settings (Cmd+, on macOS, Ctrl+, on Windows)
2. Navigate to **Tools** section (or search for "MCP")
3. Find **"Installed MCP Servers"**
4. Locate your server (e.g., `your-project`)
5. **Toggle the switch to ON** (new servers are disabled by default)

### Claude Desktop

Edit `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "your-project": {
      "command": "npx",
      "args": ["@a-company/paradigm-mcp"],
      "cwd": "/path/to/your/project"
    }
  }
}
```

### Continue (VS Code)

Edit `~/.continue/config.json`:

```json
{
  "experimental": {
    "modelContextProtocolServers": [
      {
        "transport": {
          "type": "stdio",
          "command": "npx",
          "args": ["@a-company/paradigm-mcp"],
          "cwd": "/path/to/your/project"
        }
      }
    ]
  }
}
```

### Multiple Projects

For user-level configs (Claude Desktop, Continue), add multiple servers:

```json
{
  "mcpServers": {
    "project-one": {
      "command": "npx",
      "args": ["@a-company/paradigm-mcp"],
      "cwd": "/Users/me/projects/project-one"
    },
    "project-two": {
      "command": "npx",
      "args": ["@a-company/paradigm-mcp"],
      "cwd": "/Users/me/projects/project-two"
    }
  }
}
```

---

## Verifying the Setup

After configuration, restart your AI client and verify:

```bash
# Check configuration status
paradigm mcp status
```

Then in your AI client, ask: "What Paradigm tools do you have access to?"

The AI should respond with:
- `paradigm_search` — Find symbols by query
- `paradigm_ripple` — Analyze impact of changes
- `paradigm_related` — Get connected symbols
- `paradigm_status` — Project overview
- `paradigm_gates_for_route` — Suggest gates for routes

---

## Using Paradigm MCP

### Available Resources

Resources are read-only data Claude can fetch:

| Resource URI | Description |
|--------------|-------------|
| `paradigm://symbols` | All symbols with counts |
| `paradigm://symbol/@checkout` | Single symbol details (URL-encoded) |
| `paradigm://symbols/type/feature` | All features |
| `paradigm://symbols/type/gate` | All gates |
| `paradigm://symbols/type/flow` | All flows |
| `paradigm://gates` | Detailed gate definitions from portal.yaml |
| `paradigm://flows` | All flow definitions with steps |

### Available Tools

Tools are actions Claude can invoke:

| Tool | Parameters | Description |
|------|------------|-------------|
| `paradigm_search` | `query`, `type?`, `limit?` | Find symbols matching a query |
| `paradigm_ripple` | `symbol` | Analyze what would be affected by changing a symbol |
| `paradigm_related` | `symbol` | Get symbols connected to a given symbol |
| `paradigm_status` | (none) | Get project overview with symbol counts |
| `paradigm_gates_for_route` | `route`, `method?` | Suggest which gates should protect a route |

### Example Conversations

**Impact Analysis:**
> **You:** "What would break if I removed the ^authenticated gate?"
>
> **Claude:** *[calls paradigm_ripple with symbol="^authenticated"]* 
> "Removing ^authenticated would affect 12 features directly: @checkout, @profile, @settings, @dashboard... and 8 more features indirectly through ^admin-only which requires it."

**Finding Related Code:**
> **You:** "What components are used by the checkout feature?"
>
> **Claude:** *[calls paradigm_related with symbol="@checkout"]*
> "The @checkout feature uses these components: #CheckoutForm, #PaymentProcessor, #CartSummary, and #AddressSelector."

**Route Protection:**
> **You:** "What gates should I add to POST /api/admin/users?"
>
> **Claude:** *[calls paradigm_gates_for_route with route="/api/admin/users", method="POST"]*
> "Based on your project's patterns, I'd suggest: ^authenticated (required for all API routes) and ^admin-only (route is in /admin/ path)."

**Project Overview:**
> **You:** "Give me an overview of this project's structure."
>
> **Claude:** *[calls paradigm_status]*
> "This project has 45 features, 89 components, 12 gates, 8 flows, and 23 signals. The main feature areas are @user-management, @billing, and @reporting..."

---

## Advanced Configuration

### Environment Variables

Pass environment variables to the MCP server:

```json
{
  "mcpServers": {
    "paradigm": {
      "command": "npx",
      "args": ["@a-company/paradigm-mcp"],
      "cwd": "/path/to/project",
      "env": {
        "DEBUG": "paradigm:*"
      }
    }
  }
}
```

### Using a Specific Version

Pin to a specific version:

```json
{
  "mcpServers": {
    "paradigm": {
      "command": "npx",
      "args": ["@a-company/paradigm-mcp@0.1.0"],
      "cwd": "/path/to/project"
    }
  }
}
```

### Using a Local Build

For development, point to your local build:

```json
{
  "mcpServers": {
    "paradigm": {
      "command": "node",
      "args": ["/path/to/paradigm/packages/paradigm-mcp/dist/index.js"],
      "cwd": "/path/to/project"
    }
  }
}
```

---

## Troubleshooting

### Cursor: MCP server not working after setup

New MCP servers are **disabled by default** in Cursor. You must manually enable them:

1. Open Cursor Settings (Cmd+, or Ctrl+,)
2. Go to **Tools** → **Installed MCP Servers**
3. Find your server and **toggle the switch to ON**

### "MCP server not found" or tools not appearing

1. **Run `paradigm mcp status`** — Check if config exists
2. **Verify JSON syntax** — Use a JSON validator to check for syntax errors
3. **Check the project path** — Ensure `cwd` points to a valid Paradigm project
4. **Restart the AI client completely** — Quit and relaunch, don't just close the window
5. **For Cursor:** Ensure the server is enabled in Settings → Tools

### "npx command not found"

1. **Check Node.js installation** — Run `node --version` in terminal
2. **Use full path to npx** — Try `/usr/local/bin/npx` (macOS) or the full path on Windows

### "Symbol not found" errors

1. **Run `paradigm status`** — Ensure your project has symbols indexed
2. **Check .purpose files** — Verify your features/components are defined
3. **Refresh the index** — Run `paradigm constellation` to rebuild

### Server crashes or errors

Check the server logs:

```bash
# Run the MCP server directly to see output
cd /path/to/your/project
npx @a-company/paradigm-mcp
```

Look for error messages about missing files or parsing issues.

### AI says it can't access tools

1. **Check MCP tools icon** — Ensure it appears in your AI client's interface
2. **Try a fresh conversation** — Start a new chat
3. **Verify permissions** — Ensure the AI client has file system access

### Configuration conflicts

If you have multiple projects configured:

```bash
# Check status across all clients
paradigm mcp status

# Reconfigure with force flag
paradigm mcp setup --client cursor --force
```

---

## Next Steps

- **Try the TaskFlow Tutorial** — Build a project step-by-step with MCP integration
- **Explore CLI Commands** — Use `paradigm beacon`, `paradigm ripple` for more context
- **Join the Community** — Share your MCP workflows and get help

---

*Last Updated: 2026-01-27*
