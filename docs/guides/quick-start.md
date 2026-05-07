# Quick Start Guide

Get Paradigm up and running in your project in minutes.

---

## Installation

### Option 1: Install from npm (Recommended)

`@a-company/paradigm` is published on npm. Install globally and you're ready:

```bash
npm install -g @a-company/paradigm
```

Verify the install:

```bash
paradigm --version
```

> **MCP server:** The `paradigm-mcp` binary is included in `@a-company/paradigm` — you do not need to install it separately. Running `paradigm mcp setup --client all` (below) wires it up for your AI client automatically.

**Super Quick Setup (one command, after install):**

```bash
paradigm shift && paradigm mcp setup --client all && paradigm constellation && paradigm beacon
```

**Or step-by-step:**

```bash
# 1. Navigate to your project
cd /path/to/your/project

# 2. Initialize Paradigm (non-interactive, uses auto-detected defaults)
paradigm shift --quick

# 3. Generate IDE instruction files (already done by `paradigm shift` without --quick; safe to re-run)
paradigm sync --all

# 4. Configure MCP for your AI client
paradigm mcp setup --client all

# 5. Generate symbol graph and orientation
paradigm constellation && paradigm beacon

# 6. Verify everything
paradigm doctor
```

> **`--quick` vs interactive:** `paradigm shift --quick` skips slow operations (scan). Run `paradigm shift` without `--quick` for the full setup pass — it also runs `sync --all` automatically.

### About enforcement

After `paradigm shift`, Paradigm's enforcement default is **`none`** — all compliance checks are off. This is intentional: you get a clean, unobstructed workspace to start.

When you're ready for compliance checks to kick in, add Rune to your roster:

```bash
paradigm agent add rune
```

Rune enables compliance gradually through his promotion state machine (`candidate` → `active` → `enforcing` → `blocking`), so checks turn on as they're validated — not all at once. Run `paradigm doctor` at any time to see current enforcement posture.

### Option 2: Install from Source

Use this if you want to build from source (e.g., for development or to get unreleased changes):

```bash
# 1. Clone to a permanent location (the global CLI symlinks to this directory)
git clone https://github.com/ascend42/a-paradigm.git ~/.paradigm-cli
cd ~/.paradigm-cli
npm install && npm run build

# 2. Install CLI and MCP server globally
cd packages/paradigm && npm install -g . && cd ../..
cd packages/paradigm-mcp && npm install -g . && cd ../..

# 3. Verify
paradigm --version
```

> **Important:** Keep the `~/.paradigm-cli/` directory. The global CLIs symlink to it — deleting it will break the install. To uninstall: `npm uninstall -g @a-company/paradigm @a-company/paradigm-mcp && rm -rf ~/.paradigm-cli`

---

## What Gets Created

After setup, your project will have:

```
your-project/
├── .paradigm/
│   ├── config.yaml              # Project configuration
│   ├── specs/                   # Symbol system, logger specs
│   ├── docs/                    # Command reference, patterns
│   ├── prompts/                 # AI task templates
│   ├── constellation.json       # Symbol relationship graph
│   └── beacon.md                # AI orientation guide
├── .cursor/
│   ├── mcp.json                 # MCP server config
│   └── rules/                   # Scoped Cursor rules
├── .claude/
│   └── settings.json            # MCP + permissions for Claude Code
├── CLAUDE.md                    # Context for Claude Code
├── .github/
│   ├── copilot-instructions.md  # Copilot main instructions
│   └── instructions/            # Scoped Copilot rules
└── .windsurfrules               # Windsurf instructions
```

---

## Key Commands Reference

### Project Initialization

| Command | What It Does |
|---------|--------------|
| `paradigm shift` | Initialize and configure your project for AI-assisted development |
| `paradigm sync --all` | Generate IDE instruction files for all IDEs |
| `paradigm mcp setup --client all` | Configure MCP for all detected AI clients |
| `paradigm constellation` | Generate symbol relationship graph |
| `paradigm beacon` | Generate AI orientation guide |
| `paradigm doctor` | Verify setup is correct |

### Development Workflow

| Command | What It Does |
|---------|--------------|
| `paradigm status` | Show symbol counts and project health |
| `paradigm ripple #symbol` | Impact analysis before modifying a symbol |
| `paradigm search "query"` | Find symbols by name/description |
| `paradigm thread save "message"` | Record session progress |
| `paradigm echo ERROR_CODE` | Find symbols related to an error |

### Maintenance

| Command | What It Does |
|---------|--------------|
| `paradigm lint` | Validate .purpose files |
| `paradigm sync claude` | Regenerate Claude files (after updates) |
| `paradigm mcp status` | Check MCP configuration status |
| `paradigm watch` | Auto-sync IDE files on changes |

---

## Full Setup (After CLI is Installed)

```bash
paradigm shift && paradigm mcp setup --client all && paradigm constellation && paradigm beacon
```

**What this does:**
1. Initializes `.paradigm/` directory (non-interactive, auto-detected defaults)
2. Generates IDE instruction files for Cursor, Claude Code, Copilot, Windsurf
3. Configures MCP for all detected AI clients
4. Generates symbol graph and AI orientation guide
5. Verifies everything is set up correctly

---

## Verify Setup

After running setup, verify everything works:

### 1. Check Project Status
```bash
paradigm status
```

Should show symbol counts and configuration info.

### 2. Check MCP Configuration
```bash
paradigm mcp status
```

Should show which AI clients have MCP configured.

### 3. In Your AI Client

**Cursor:**
- Check Settings → Tools → Installed MCP Servers
- Toggle your project's MCP server to ON

**Claude Code:**
- Start a chat
- Try: "What paradigm tools do you have access to?"
- Should list `paradigm_status`, `paradigm_ripple`, `paradigm_navigate`, etc.
- (Plugin users: tools are available immediately after restarting Claude Code. Manual config users: confirm the `paradigm` entry exists in `~/.claude/claude.json` first.)

**Claude Desktop:**
- Restart the app after setup
- Ask: "List your MCP resources"
- Should see `paradigm://context/agent-protocol` and others

---

## Maintenance Cost

Adding a feature to Paradigm takes about 5 minutes of `.purpose` file maintenance. Here's what you get for that:

- Every AI agent that touches your project starts with accurate context instead of guessing
- Change-impact analysis (`paradigm ripple`) knows which downstream code to warn about
- The stop hook catches undocumented changes before they become drift
- Lore entries make sessions recoverable — future agents pick up exactly where you left off

If 5 minutes per feature sounds like overhead, Paradigm is probably not the right fit. If you've lost hours to AI agents that didn't understand your project, it likely is.

---

## Next Steps

After setup, you can:

1. **Add features** - Create `.purpose` files in your directories
2. **Define gates** - Create `portal.yaml` for authorization
3. **Use the logger** - After setup, `.paradigm/specs/logger.md` in your project has logging conventions for your stack
4. **Get AI help** - After setup, `.paradigm/prompts/` contains reusable task templates for common AI workflows

---

## Troubleshooting

### CLI Not Found After Install

```bash
# Check if npm global bin is in PATH
npm config get prefix

# Add to PATH (add to ~/.zshrc or ~/.bashrc)
export PATH="$PATH:$(npm config get prefix)/bin"
```

### MCP Server Not Working

```bash
# Check status
paradigm mcp status

# For Cursor: Must enable in Settings → Tools
# For Claude Desktop: Restart app after setup
# For Claude Code: If using the plugin, MCP is configured automatically.
#   If using manual config, check ~/.claude/claude.json for the paradigm-mcp entry.
#   Start a new conversation and ask: "What Paradigm tools do you have access to?"
```

### "Paradigm not initialized"

```bash
# Re-run init
paradigm shift --quick --force
```

---

*For detailed documentation, see [docs/guides/mcp-setup.md](mcp-setup.md)*
