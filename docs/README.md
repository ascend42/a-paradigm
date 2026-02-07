# Paradigm Documentation

Complete guides and references for using Paradigm - the AI-native project structure framework.

## 📚 Documentation Hub

### Getting Started
- [Quick Start Guide](./guides/quick-start.md) - Complete setup walkthrough
- [MCP Setup Guide](./guides/mcp-setup.md) - Configure AI client integration

### Command Reference

**Setup & Configuration:**
- [`paradigm init`](./commands/init.md) - Initialize Paradigm in your project
- [`paradigm sync`](./commands/sync.md) - Regenerate IDE instruction files
- [`paradigm mcp setup`](./commands/mcp-setup.md) - Configure MCP for AI clients

**AI Context Generation:**
- [`paradigm beacon`](./commands/beacon.md) - Generate quick-start orientation for AI
- [`paradigm constellation`](./commands/constellation.md) - Build complete symbol relationship graph
- [`paradigm index`](./commands/index.md) - Generate visual discovery index

**Analysis & Safety:**
- [`paradigm ripple`](./commands/ripple.md) - Analyze symbol impact before changes
- [`paradigm doctor`](./commands/doctor.md) - Run health checks on Paradigm setup

### Concepts & Patterns
- [Symbol System](../CLAUDE.md#symbol-system-v2) - Understanding #, $, ^, !, ~ symbols
- [Paradigm Logger](../.paradigm/specs/logger.md) - Structured logging specification
- [Purpose Files](../CONTRIBUTING.md#purpose-files) - Feature and component context files

### Guides
- [Content Guide](./content-guide.md) - Writing effective Paradigm content
- [Tutorial Project](./tutorial-project.md) - Learn by building

## 📖 Reading Order

**For new users:**
1. Start with [Quick Start Guide](./guides/quick-start.md)
2. Run the setup, then read [`paradigm init`](./commands/init.md)
3. Understand [`paradigm sync`](./commands/sync.md) for keeping IDE files fresh
4. Learn [`paradigm beacon`](./commands/beacon.md) and [`paradigm constellation`](./commands/constellation.md) for AI context

**For daily development:**
1. Use [`paradigm ripple`](./commands/ripple.md) before every significant change
2. Run [`paradigm doctor`](./commands/doctor.md) when troubleshooting
3. Keep AI context fresh with [`paradigm beacon`](./commands/beacon.md)

**For advanced usage:**
1. [`paradigm index`](./commands/index.md) - Visual discovery with screenshots
2. [`paradigm mcp setup`](./commands/mcp-setup.md) - Dynamic AI tool integration
3. [Symbol System](../CLAUDE.md#symbol-system) - Deep dive into Paradigm's structure

## 🔍 Quick Command Lookup

| Command | Use Case | Frequency |
|---------|----------|-----------|
| `paradigm init` | Initialize new project | Once per project |
| `paradigm sync` | Update IDE files | After config changes |
| `paradigm beacon` | Generate AI orientation | Weekly or after features |
| `paradigm constellation` | Build symbol graph | With beacon |
| `paradigm ripple #symbol` | Check change impact | Before every modification |
| `paradigm doctor` | Health check | When troubleshooting |
| `paradigm index` | Visual discovery | Optional, for screenshots |
| `paradigm mcp setup` | Configure AI tools | Once per machine |

## 💡 Common Workflows

### New Project Setup
```bash
paradigm init --quick
paradigm sync --all
paradigm mcp setup --client all
paradigm beacon && paradigm constellation
paradigm doctor
```

### Before Refactoring
```bash
paradigm ripple #feature-to-change
# Review impact, then make changes
paradigm beacon --refresh
```

### Weekly Maintenance
```bash
paradigm beacon --refresh
paradigm constellation
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
