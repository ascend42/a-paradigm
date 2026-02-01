# Paradigm MCP: Multi-Platform Configuration Guide Request

## Context

The Paradigm MCP server (`@a-company/paradigm-mcp`) has been built, but users need clarity on how to configure it across different environments. Currently, the documentation focuses on Claude Desktop, but many developers use Claude through other interfaces.

## The Problem

Users are confused about where MCP configuration goes depending on their setup:

| Environment | How Claude is accessed | MCP Support? | Config Location |
|-------------|----------------------|--------------|-----------------|
| Claude Desktop | Standalone Anthropic app | ✅ Yes | `~/Library/Application Support/Claude/config.json` |
| Cursor | Claude via Cursor's AI | ✅ Yes | `.cursor/mcp.json` or Cursor settings |
| VS Code + Continue | Claude via Continue extension | ✅ Yes | Continue config |
| VS Code + Cline | Claude via Cline extension | ✅ Yes | Cline settings |
| Claude.ai (web) | Browser | ❌ No | N/A |
| Claude API direct | Custom integration | ❌ No (manual) | N/A |

## Deliverables Needed

### 1. Multi-Platform Setup Guide

Create `docs/guides/mcp-setup-all-platforms.md` covering:

**Claude Desktop:**
```json
// ~/Library/Application Support/Claude/config.json (macOS)
// %APPDATA%\Claude\config.json (Windows)
{
  "mcpServers": {
    "paradigm": {
      "command": "npx",
      "args": ["@a-company/paradigm-mcp"],
      "cwd": "/path/to/project"
    }
  }
}
```

**Cursor:**
```json
// .cursor/mcp.json (project-level)
// Or via Cursor Settings > MCP
{
  "mcpServers": {
    "paradigm": {
      "command": "npx",
      "args": ["@a-company/paradigm-mcp"]
    }
  }
}
```

**VS Code + Continue:**
```json
// ~/.continue/config.json
{
  "experimental": {
    "modelContextProtocolServers": [
      {
        "transport": {
          "type": "stdio",
          "command": "npx",
          "args": ["@a-company/paradigm-mcp"]
        }
      }
    ]
  }
}
```

**VS Code + Cline:**
```json
// Cline settings or .cline/mcp.json
{
  "mcpServers": {
    "paradigm": { ... }
  }
}
```

### 2. Multi-Project Configuration

Users with multiple Paradigm projects need guidance:

**Option A: Multiple named servers**
```json
{
  "mcpServers": {
    "leadsync": { "cwd": "/path/to/leadsync-dash" },
    "project-two": { "cwd": "/path/to/project-two" },
    "project-three": { "cwd": "/path/to/project-three" }
  }
}
```

**Option B: Single server with project switching** (if supported)
```json
{
  "mcpServers": {
    "paradigm": {
      "command": "npx",
      "args": ["@a-company/paradigm-mcp", "--projects-dir", "/Users/me/GitHub"]
    }
  }
}
```
Then query: "paradigm_status for leadsync" or "search project-two for @auth"

**Question:** Does the MCP server currently support multi-project mode? If not, should it?

### 3. Project-Level vs User-Level Config

Clarify when to use each:

| Scope | Use Case | Config Location |
|-------|----------|-----------------|
| **Project-level** | Team shares config, committed to repo | `.cursor/mcp.json` |
| **User-level** | Personal projects, not in repo | Cursor/Claude settings |
| **Global** | All projects use same server | User settings |

### 4. Troubleshooting Section

Common issues:
- MCP server not starting (check npx path, node version)
- "Server not found" (restart IDE after config change)
- Wrong project context (check `cwd` path)
- Multiple servers conflicting (namespace with project names)

### 5. Quick Start for Each Platform

One-liner setup commands:

```bash
# Claude Desktop (macOS)
echo '{"mcpServers":{"paradigm":{"command":"npx","args":["@a-company/paradigm-mcp"],"cwd":"'$(pwd)'"}}}' > ~/Library/Application\ Support/Claude/config.json

# Cursor (project-level)
mkdir -p .cursor && echo '{"mcpServers":{"paradigm":{"command":"npx","args":["@a-company/paradigm-mcp"]}}}' > .cursor/mcp.json
```

## Questions for You

1. **Does the MCP server support `--projects-dir` for multi-project mode?** If not, is this worth adding?

2. **Should project-level `.cursor/mcp.json` be committed to repos?** Or added to `.gitignore`?

3. **Are there other IDEs with MCP support** we should document? (Windsurf, JetBrains, etc.)

4. **Should we auto-detect the IDE** and provide setup instructions accordingly?

## Success Criteria

After this documentation:
- Users can set up Paradigm MCP in any supported environment in <5 minutes
- Multi-project users have clear guidance
- Troubleshooting covers 90% of common issues

---

*Prompt for Paradigm framework development session*
*From: LeadSync project session, 2026-01-31*
