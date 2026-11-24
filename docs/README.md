# Paradigm Documentation

Complete guides and references for using Paradigm - the AI-native project structure framework.

## 📚 Documentation Hub

### Getting Started
- [Quick Start Guide](./guides/quick-start.md) - Complete setup walkthrough
- [MCP Setup Guide](./guides/mcp-setup.md) - Configure AI client integration

### Command Reference

**Setup & Configuration:**
- [`paradigm shift`](./guides/quick-start.md) - Initialize and configure Paradigm in your project
- [`paradigm sync`](./commands/sync.md) - Regenerate IDE instruction files
- [`paradigm mcp setup`](./commands/mcp-setup.md) - Configure MCP for AI clients

**Analysis & Safety:**
- [`paradigm ripple`](./commands/ripple.md) - Analyze symbol impact before changes
- [`paradigm doctor`](./commands/doctor.md) - Run health checks on Paradigm setup

### Concepts & Patterns
- [Symbol System](../CLAUDE.md#symbol-system) - Understanding #, $, ^, !, ~ symbols
- [Paradigm Logger](../.paradigm/specs/logger.md) - Structured logging specification
- [Purpose Files](./guides/quick-start.md) - Feature and component context files

## 📖 Reading Order

**For new users:**
1. Start with [Quick Start Guide](./guides/quick-start.md)
2. Run `paradigm shift` to set up your project, then explore the command docs below
3. Understand [`paradigm sync`](./commands/sync.md) for keeping IDE files fresh

**For daily development:**
1. Use [`paradigm ripple`](./commands/ripple.md) before every significant change
2. Run [`paradigm doctor`](./commands/doctor.md) when troubleshooting

**For advanced usage:**
1. [`paradigm mcp setup`](./commands/mcp-setup.md) - MCP for Cursor, Claude Desktop, Continue and Cline
2. [Symbol System](../CLAUDE.md#symbol-system) - Deep dive into Paradigm's structure

## 🔍 Quick Command Lookup

| Command | Use Case | Frequency |
|---------|----------|-----------|
| `paradigm shift` | Initialize and configure new project | Once per project |
| `paradigm sync` | Update IDE files | After config changes |
| `paradigm ripple #symbol` | Check change impact | Before every modification |
| `paradigm doctor` | Health check | When troubleshooting |
| `paradigm mcp setup` | Add the MCP server to Cursor, Claude Desktop, Continue or Cline | Once per project or machine, depending on the client |

## 💡 Common Workflows

### New Project Setup
```bash
npm install -g @a-company/paradigm
cd your-project
paradigm shift
```

If you use Claude Code, also install the plugin. In Claude Code:

```
/plugin marketplace add ascend42/a-paradigm
/plugin install paradigm@a-paradigm
```

For Cursor, Claude Desktop, Continue or Cline, run `paradigm mcp setup --client all` instead. Compliance checks are off until you run `paradigm enforcement set <level>`.

### Before Refactoring
```bash
paradigm ripple "#feature-to-change"
# Review impact, then make changes
```

### After an Upgrade
```bash
paradigm doctor
```

## 🔗 External Resources

- [Paradigm GitHub Repository](https://github.com/ascend42/a-paradigm)
- [Model Context Protocol](https://modelcontextprotocol.io)
- [Contributing Guide](../CONTRIBUTING.md)
- [Changelog](../CHANGELOG.md)

## 📝 Contributing to Docs

See [CONTRIBUTING.md](../CONTRIBUTING.md) for guidelines on improving documentation.

---

**Need help?** Open an issue on [GitHub](https://github.com/ascend42/a-paradigm/issues) or check the troubleshooting section in each command guide.
