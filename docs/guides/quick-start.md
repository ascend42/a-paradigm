# Quick Start Guide

Get Paradigm up and running in your project in minutes.

---

## Installation

### Option 1: Install from Source (Until npm Package Available)

**Super Quick Install & Setup (One Command):**

```bash
git clone https://github.com/ascend42/a-paradigm.git /tmp/paradigm-temp && cd /tmp/paradigm-temp && npm install && npm run build && npm link @a-company/paradigm && cd - && paradigm init --quick && paradigm sync --all && paradigm mcp setup --client all && paradigm constellation && paradigm beacon && paradigm doctor && echo "✅ Paradigm setup complete! Clean up: rm -rf /tmp/paradigm-temp"
```

**Or step-by-step:**

```bash
# 1. Clone and build
git clone https://github.com/ascend42/a-paradigm.git
cd a-paradigm
npm install
npm run build

# 2. Install CLI globally
npm link @a-company/paradigm

# 3. Navigate to your project
cd /path/to/your/project

# 4. Run setup
paradigm init --quick && paradigm sync --all && paradigm mcp setup --client all && paradigm constellation && paradigm beacon && paradigm doctor
```

### Option 2: Install from npm (When Available)

```bash
npm install -g @a-company/paradigm
cd /path/to/your/project
paradigm init --quick && paradigm sync --all && paradigm mcp setup --client all && paradigm constellation && paradigm beacon
```

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
| `paradigm init --quick` | Initialize .paradigm/ directory (non-interactive) |
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

## One-Liner Setup (After CLI is Installed)

```bash
paradigm init --quick && paradigm sync --all && paradigm mcp setup --client all && paradigm constellation && paradigm beacon && paradigm doctor
```

**What this does:**
1. ✅ Initializes `.paradigm/` directory
2. ✅ Generates IDE instruction files for Cursor, Claude, Copilot, Windsurf
3. ✅ Configures MCP for all detected AI clients
4. ✅ Generates symbol graph and AI orientation guide
5. ✅ Verifies everything is set up correctly

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

**Claude Desktop:**
- Restart the app after setup
- Ask: "List your MCP resources"
- Should see `paradigm://context/agent-protocol` and others

---

## Next Steps

After setup, you can:

1. **Add features** - Create `.purpose` files in your directories
2. **Define gates** - Create `portal.yaml` for authorization
3. **Use the logger** - Follow patterns in `.paradigm/specs/logger.md`
4. **Get AI help** - Use prompts in `.paradigm/prompts/`

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
```

### "Paradigm not initialized"

```bash
# Re-run init
paradigm init --quick --force
```

---

*For detailed documentation, see [docs/guides/mcp-setup.md](mcp-setup.md)*
