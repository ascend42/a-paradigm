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

The `paradigm-mcp` server is included in `@a-company/paradigm`. You do not install it separately.

**Set up a project:**

```bash
cd /path/to/your/project
paradigm shift
```

`paradigm shift` creates `.paradigm/`, a root `.purpose`, `portal.yaml`, the instruction files for Claude Code, Cursor, Copilot and Windsurf, plus `AGENTS.md`, and installs the hooks. Running it again keeps your existing `.paradigm/`, `.purpose` and `portal.yaml`, but it regenerates the instruction files every time. If you have hand-written instruction files (`CLAUDE.md`, `AGENTS.md`, `.cursor/rules/`, `.github/instructions/` or `.windsurfrules`), back them up before you run `paradigm shift`. An old `.cursorrules` file is renamed to `.cursorrules.bak`.

**If you use Claude Code, install the plugin.** It adds the hooks, skills, agents and the MCP server for every project. In Claude Code:

```
/plugin marketplace add ascend42/a-paradigm
/plugin install paradigm@a-paradigm
```

**If you use Cursor, Claude Desktop, Continue or Cline,** add the MCP server by naming the client:

```bash
paradigm mcp setup --client cursor    # or claude-desktop, continue, cline
```

`--client all` configures every client it detects. That includes Claude Code whenever the project has a `.claude/` folder or a `.mcp.json`, in which case it writes a Paradigm entry to `.mcp.json`. If you use the Claude Code plugin, name the client instead of using `all`, so the plugin's server is not duplicated. If `.mcp.json` already has a Paradigm entry, remove it.

See the [MCP Setup Guide](mcp-setup.md) for each client.

**Your first prompt.** Open your agent in the project and say:

```
Map this codebase with Paradigm: draft .purpose files for the main directories, then tell me what would be affected if I changed <a module you know>.
```

Replace `<a module you know>` with a part of your code you know well, so you can judge the answer.

### About enforcement

After `paradigm shift`, the enforcement level is **`none`**: every compliance check is off and the Stop hook does not block. `paradigm enforcement status` shows the current level and each check.

When you want checks, choose a level:

```bash
paradigm enforcement set minimal    # warnings only, nothing blocks
paradigm enforcement set balanced   # blocks on missing .purpose coverage and blocking habits; most other checks warn
paradigm enforcement set strict     # most checks block
```

Rune, the compliance agent, is on the roster `paradigm shift` writes for a new project. Being on the roster does not turn any check on: at level `none` everything stays off. Two aspect checks (the aspect advisory and aspect drift) report only when he is on the roster and the enforcement level enables them. On an older project without him, run:

```bash
paradigm agent roster add compliance
```

### Option 2: Install from Source

Use this if you want to build from source (e.g., for development or to get unreleased changes):

```bash
# 1. Clone to a permanent location (the global CLI symlinks to this directory)
git clone https://github.com/ascend42/a-paradigm.git ~/.paradigm-cli
cd ~/.paradigm-cli
npm install && npm run build

# 2. Install the CLI globally (it includes the paradigm-mcp server)
cd packages/paradigm && npm install -g . && cd ../..

# 3. Verify
paradigm --version
```

> **Important:** Keep the `~/.paradigm-cli/` directory. The global CLIs symlink to it — deleting it will break the install. To uninstall: `npm uninstall -g @a-company/paradigm && rm -rf ~/.paradigm-cli`

---

## What Gets Created

After setup, your project will have:

```
your-project/
├── .paradigm/
│   ├── config.yaml              # Project configuration
│   ├── navigator.yaml           # Symbol navigation map
│   ├── agents.yaml              # Team agent configuration
│   ├── roster.yaml              # Agent roster for this project
│   └── lore/                    # Project lore timeline
├── .purpose                     # Root feature definitions
├── portal.yaml                  # Authorization gates
├── CLAUDE.md                    # Instructions for Claude Code
├── AGENTS.md                    # Instructions for other AI agents
├── .cursor/rules/               # Cursor instructions
├── .claude/hooks/               # Claude Code enforcement hooks
└── .cursor/hooks/               # Cursor enforcement hooks
```

This is the list `paradigm shift` prints when it finishes. It also writes Copilot and Windsurf instruction files and more files under `.paradigm/`.

---

## Key Commands Reference

### Project Initialization

| Command | What It Does |
|---------|--------------|
| `paradigm shift` | Initialize and configure your project for AI-assisted development |
| `paradigm sync --all` | Generate IDE instruction files for all IDEs |
| `paradigm mcp setup --client <client>` | Configure MCP for `cursor`, `claude-desktop`, `continue` or `cline` (`all` configures every detected client, Claude Code included) |
| `paradigm doctor` | Verify setup is correct |

### Development Workflow

| Command | What It Does |
|---------|--------------|
| `paradigm status` | Show symbol counts and project health |
| `paradigm ripple #symbol` | Impact analysis before modifying a symbol |
| `paradigm thread save "message"` | Record session progress |
| `paradigm echo lookup ERROR_CODE` | Find symbols related to an error |

Symbol search has no CLI command. Ask your agent, which uses the `paradigm_search` MCP tool.

### Maintenance

| Command | What It Does |
|---------|--------------|
| `paradigm lint` | Validate .purpose files |
| `paradigm sync claude` | Regenerate Claude files (after updates) |
| `paradigm mcp status` | Check MCP configuration status |
| `paradigm watch` | Auto-sync IDE files on changes |

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
- (Plugin users: tools are available after restarting Claude Code. Manual config users: confirm the Paradigm entry exists in `.mcp.json` at the project root first.)

**Claude Desktop:**
- Restart the app after setup
- Ask: "List your MCP resources"
- Should see `paradigm://context/agent-protocol` and others

---

## Maintenance Cost

Each feature you add needs its `.purpose` file kept current. We have not measured how long that takes. Here's what you get for it:

- Every AI agent that touches your project starts with accurate context instead of guessing
- Change-impact analysis (`paradigm ripple`) knows which downstream code to warn about
- Once you turn enforcement on, the Stop hook catches undocumented changes before they become drift
- Lore entries make sessions recoverable — future agents pick up exactly where you left off

If keeping a description next to each feature sounds like overhead, Paradigm is probably not the right fit.

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
#   If using manual config, check .mcp.json at the project root for the paradigm-mcp entry.
#   Start a new conversation and ask: "What Paradigm tools do you have access to?"
```

### "Paradigm not initialized"

```bash
# Run setup in the project root
paradigm shift
```

---

*For detailed documentation, see [docs/guides/mcp-setup.md](mcp-setup.md)*
