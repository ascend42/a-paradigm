# Paradigm MCP Documentation Update: Cursor Enable Step

## Missing Documentation

The current MCP setup docs are missing a critical step for Cursor users. After configuring `.cursor/mcp.json`, users must **manually enable** the MCP server in Cursor's UI.

## Add to `docs/guides/mcp-setup.md`

Under the Cursor section, add this step:

---

### Step 3: Enable the MCP Server in Cursor

After configuring `.cursor/mcp.json`, you must enable the server in Cursor's settings:

1. **Open Cursor Settings** (Cmd+, on macOS, Ctrl+, on Windows)
2. Navigate to **Tools** section (or search for "MCP")
3. Find **"Installed MCP Servers"** section
4. Locate your server (e.g., `leadsync-dash`)
5. **Toggle the switch to ON** (it starts as Disabled by default)

![MCP Server Toggle](./images/cursor-mcp-toggle.png)

> **Note:** New MCP servers are disabled by default in Cursor. You must manually enable each server after adding it to the config.

---

## Also Update

### Quick Start Section

Change from:
```
1. Run `paradigm mcp setup --client cursor`
2. Restart Cursor
3. Start using MCP tools
```

To:
```
1. Run `paradigm mcp setup --client cursor`
2. Restart Cursor
3. Open Settings → Tools → Enable your MCP server
4. Start using MCP tools
```

### Troubleshooting Section

Add:
```
**MCP server not working after setup?**

Check that the server is enabled:
1. Cursor Settings → Tools → Installed MCP Servers
2. Ensure the toggle is ON (not Disabled)

New servers are disabled by default and must be manually enabled.
```

---

*Documentation update request from LeadSync MCP setup session, 2026-02-01*
