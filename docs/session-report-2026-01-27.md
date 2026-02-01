# Paradigm Session Report - 2026-01-27

**For:** LeadSync Project AI Assistant  
**From:** Paradigm Framework Development Session  
**Purpose:** Summary of changes that affect your project

---

## TL;DR

Paradigm now has an **MCP Server** that lets Claude Desktop query your project's symbols dynamically. No migration needed for existing Paradigm projects - just configure Claude Desktop.

---

## What Was Built

### 1. MCP Server (`@a-company/paradigm-mcp`)

A Model Context Protocol server that exposes Paradigm symbols to AI assistants.

**Resources (read-only data):**
| URI | Returns |
|-----|---------|
| `paradigm://symbols` | All symbols with counts |
| `paradigm://symbol/@feature-name` | Single symbol details |
| `paradigm://symbols/type/gate` | All gates |
| `paradigm://gates` | Detailed gate definitions |
| `paradigm://flows` | All flows |

**Tools (actions AI can invoke):**
| Tool | Purpose |
|------|---------|
| `paradigm_search` | Find symbols by query |
| `paradigm_ripple` | Impact analysis |
| `paradigm_related` | Connected symbols |
| `paradigm_status` | Project overview |
| `paradigm_gates_for_route` | Suggest gates for routes |

### 2. Documentation

- `docs/guides/mcp-setup.md` - Claude Desktop setup guide
- `docs/content-guide.md` - YouTube/blog content structure
- `docs/tutorial-project.md` - TaskFlow build-along tutorial

---

## Impact on LeadSync

### No Migration Required

The MCP server reads existing `.purpose` and `portal.yaml` files. If `paradigm status` works in LeadSync, MCP will work.

### To Enable MCP in LeadSync

Add to Claude Desktop config (`~/Library/Application Support/Claude/claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "leadsync": {
      "command": "npx",
      "args": ["@a-company/paradigm-mcp"],
      "cwd": "/Users/ascend/Documents/GitHub/leadsync-dash"
    }
  }
}
```

Restart Claude Desktop. Then you can ask Claude:
- "What features depend on ^authenticated?"
- "What would break if I changed @lead-management?"
- "Find all components related to billing"

---

## Symbol Indexer Fixes (Already in Your Project)

These fixes from earlier in the session should already be working:

1. **Array format support** - `features:` can be array or record
2. **Symbol extraction** - Parses `flows:`, `gates:`, `signals:` from feature definitions
3. **Portal alias** - `portals:` accepted as alias for `gates:` in portal.yaml
4. **Signals schema** - Enhanced with `severity`, `emitters`, `related` fields

Run `paradigm status` to verify symbol counts are correct.

---

## Commits to Pull

If you need the latest Paradigm:

```bash
cd /path/to/a-paradigm
git pull origin main
npm run build
```

Key commits:
- `feat(mcp): add Paradigm MCP server for AI assistants`
- `docs: add MCP documentation, content guide, and TaskFlow tutorial`

---

## Quick Validation

Run these in LeadSync to verify everything works:

```bash
# Should show features, components, gates, flows, signals
paradigm status

# Should return JSON with symbol data
paradigm constellation --format json | head -20

# Should show impact analysis
paradigm ripple @lead-management
```

---

## Questions?

The MCP server uses the same `premise-core` library as the CLI. If the CLI commands work, MCP will work.

*Report generated: 2026-01-27*
