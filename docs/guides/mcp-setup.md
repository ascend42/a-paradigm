# Setting Up Paradigm MCP with Claude Desktop

This guide walks you through setting up Paradigm's MCP (Model Context Protocol) server to give Claude Desktop dynamic access to your project's symbols, gates, and flows.

---

## Table of Contents

1. [What is MCP?](#what-is-mcp)
2. [Prerequisites](#prerequisites)
3. [Installing Claude Desktop](#installing-claude-desktop)
4. [Configuring the MCP Server](#configuring-the-mcp-server)
5. [Verifying the Setup](#verifying-the-setup)
6. [Using Paradigm MCP](#using-paradigm-mcp)
7. [Advanced Configuration](#advanced-configuration)
8. [Troubleshooting](#troubleshooting)

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
3. **npm** — To run `npx @a-company/paradigm-mcp`

Verify your project is set up:

```bash
paradigm status
```

You should see your features, components, and other symbols listed.

---

## Installing Claude Desktop

### macOS

1. Download Claude Desktop from [claude.ai/download](https://claude.ai/download)
2. Open the `.dmg` file and drag Claude to Applications
3. Launch Claude from Applications

### Windows

1. Download the Windows installer from [claude.ai/download](https://claude.ai/download)
2. Run the installer
3. Launch Claude from the Start menu

### Linux

Claude Desktop is not officially available for Linux yet. You can use the web version at [claude.ai](https://claude.ai) (MCP is not supported in the web version).

---

## Configuring the MCP Server

### Step 1: Locate the Config File

The Claude Desktop configuration file is located at:

| OS | Path |
|----|------|
| **macOS** | `~/Library/Application Support/Claude/claude_desktop_config.json` |
| **Windows** | `%APPDATA%\Claude\claude_desktop_config.json` |

If the file doesn't exist, create it.

### Step 2: Add the Paradigm MCP Server

Open or create `claude_desktop_config.json` and add:

```json
{
  "mcpServers": {
    "paradigm": {
      "command": "npx",
      "args": ["@a-company/paradigm-mcp"],
      "cwd": "/path/to/your/project"
    }
  }
}
```

**Important:** Replace `/path/to/your/project` with the actual path to your Paradigm project.

### Step 3: Restart Claude Desktop

Completely quit Claude Desktop (not just close the window) and relaunch it.

### Multiple Projects

To configure multiple projects, add multiple entries:

```json
{
  "mcpServers": {
    "myapp": {
      "command": "npx",
      "args": ["@a-company/paradigm-mcp"],
      "cwd": "/Users/me/projects/myapp"
    },
    "api": {
      "command": "npx",
      "args": ["@a-company/paradigm-mcp"],
      "cwd": "/Users/me/projects/api-backend"
    }
  }
}
```

---

## Verifying the Setup

After restarting Claude Desktop, verify the MCP server is connected:

1. Open a new conversation in Claude Desktop
2. Look for the MCP tools icon (hammer/wrench) in the interface
3. Ask Claude: "What Paradigm tools do you have access to?"

Claude should respond with something like:

> I have access to the following Paradigm tools:
> - `paradigm_search` — Find symbols by query
> - `paradigm_ripple` — Analyze impact of changes
> - `paradigm_related` — Get connected symbols
> - `paradigm_status` — Project overview
> - `paradigm_gates_for_route` — Suggest gates for routes

If you don't see these, check [Troubleshooting](#troubleshooting).

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

### "MCP server not found" or tools not appearing

1. **Check the config file path** — Ensure it's in the correct location for your OS
2. **Verify JSON syntax** — Use a JSON validator to check for syntax errors
3. **Check the project path** — Ensure `cwd` points to a valid Paradigm project
4. **Restart Claude Desktop completely** — Quit and relaunch, don't just close the window

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

### Claude says it can't access tools

1. **Check MCP icon** — Ensure the tools icon appears in Claude Desktop
2. **Try a fresh conversation** — Start a new chat
3. **Verify permissions** — Ensure Claude Desktop has file system access

---

## Next Steps

- **Try the TaskFlow Tutorial** — Build a project step-by-step with MCP integration
- **Explore CLI Commands** — Use `paradigm beacon`, `paradigm ripple` for more context
- **Join the Community** — Share your MCP workflows and get help

---

*Last Updated: 2026-01-27*
