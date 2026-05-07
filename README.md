<p align="center">
  <img src="assets/logo.png" alt="Paradigm Logo" width="200">
</p>

<h1 align="center">Paradigm</h1>

<p align="center"><strong>One command to make your codebase AI-ready.</strong></p>

<p align="center">
  <a href="https://opensource.org/licenses/MIT"><img src="https://img.shields.io/badge/License-MIT-yellow.svg" alt="License: MIT"></a>
  <a href="https://nodejs.org/"><img src="https://img.shields.io/badge/node-%3E%3D20.0.0-brightgreen.svg" alt="Node.js"></a>
  <a href="https://www.npmjs.com/package/@a-company/paradigm"><img src="https://img.shields.io/npm/v/@a-company/paradigm.svg" alt="npm"></a>
</p>

## Install

```bash
npm install -g @a-company/paradigm
```

## Run it

```bash
cd your-project
paradigm shift
```

That's it. `paradigm shift` scaffolds everything your AI assistant needs to understand your codebase — a project map, access rules, IDE instruction files, and enforcement hooks — in one command. Safe to re-run. Works with TypeScript, Python, Rust, Go, Swift, and more.

### What you'll see

```
┌─────────────────────────────────────────────────┐
│  paradigm shift                                 │
│  Full project setup in one command              │
└─────────────────────────────────────────────────┘

  📁 Project: your-project
  📍 Status: New project

  ✓ Step 1/6: Initializing Paradigm...
  ✓ Step 2/6: Initializing team configuration...
  ✓ Step 3/6: Scanning and indexing symbols...
  ✓ Step 4/6: Syncing IDE configurations...
  ✓ Step 5/6: Installing hooks...
  ✓ Step 6/6: Skipped verify (use --verify to check health)

┌─────────────────────────────────────────────────┐
│  ✨ Paradigm shift complete!                    │
└─────────────────────────────────────────────────┘

  Created/Updated:
  ─────────────────────────────────────────────────
  ✓ .paradigm/config.yaml        Project configuration
  ✓ .paradigm/navigator.yaml     Symbol navigation map
  ✓ .paradigm/agents.yaml        Team agent configuration
  ✓ .purpose                     Root feature definitions
  ✓ portal.yaml                  Authorization gates
  ✓ CLAUDE.md                    Claude Code AI instructions
  ✓ AGENTS.md                    Universal AI agent instructions
  ✓ .cursor/rules/               Cursor AI instructions
  ✓ .claude/hooks/               Claude Code enforcement hooks
```

[Skip to what you just got →](#what-you-just-got) · [Skip to the why →](#why-this-works)

---

## Other ways to install

<details>
<summary><strong>Install script (one-liner)</strong></summary>

```bash
curl -fsSL https://a-company.org/paradigm/install.sh | bash
```

Or download and inspect first:

```bash
curl -fsSL https://a-company.org/paradigm/install.sh -o install.sh
chmod +x install.sh
./install.sh
```

This clones the repo to `~/.paradigm-cli/`, builds both `paradigm` and `paradigm-mcp`, and installs them globally. Re-running updates to the latest version.

> **Note:** The source directory at `~/.paradigm-cli/` must be kept — the global CLIs symlink to it. To uninstall: `npm uninstall -g @a-company/paradigm @a-company/paradigm-mcp && rm -rf ~/.paradigm-cli`

</details>

<details>
<summary><strong>Manual install from source</strong></summary>

```bash
# 1. Clone and build (keep this directory — CLIs symlink to it)
git clone https://github.com/ascend42/a-paradigm.git ~/.paradigm-cli
cd ~/.paradigm-cli
npm install && npm run build

# 2. Install CLI globally
cd packages/paradigm && npm install -g . && cd ../..

# 3. Install MCP server globally
cd packages/paradigm-mcp && npm install -g . && cd ../..

# 4. Verify
paradigm --version
```

</details>

<details>
<summary><strong>Claude Code plugin (one-step setup for Claude Code users)</strong></summary>

If you use Claude Code, the plugin bundles enforcement hooks and MCP configuration in a single install:

```
/plugin marketplace add ascend42/a-paradigm
```

You still run `paradigm shift` inside each project to create the per-project files (`.paradigm/`, `.purpose`, `portal.yaml`, etc.) — the plugin handles the global pieces so you don't need to run `paradigm mcp setup` separately.

</details>

---

## `paradigm shift` — the one command

### What it does

Run it on a fresh project or an existing one. It detects which case it's in and does the right thing. In plain English:

1. Creates `.paradigm/` with project config, agent team, and IDE detection
2. Scaffolds `.purpose` (what your code does) and `portal.yaml` (who can access what) as empty skeletons you fill in
3. Scans your code to seed the symbol graph (or skips with `--quick`)
4. Generates IDE instruction files (`CLAUDE.md`, `AGENTS.md`, `.cursor/rules/`, Windsurf, Copilot)
5. Installs enforcement hooks (git + Claude Code + Cursor) so compliance is automatic
6. Optionally runs `paradigm doctor` to verify everything is healthy (`--verify`)

Re-running is safe. 36 core files and directories are guaranteed to exist after completion, and existing content is never overwritten.

### Invocation forms

Bare invocation covers the common case. Flags adjust behavior for specific situations.

| Command | What it does |
|---------|--------------|
| `paradigm shift` | Full project setup. Idempotent. Safe to re-run. |
| `paradigm shift --force` | Reinitialize even if already set up. After a botched setup or when upgrading a stale project. |
| `paradigm shift --quick` | Skips the scan/index step (the slow one). Good for CI or iteration. |
| `paradigm shift --verify` | Runs `paradigm doctor` as the final step. Good before committing. |
| `paradigm shift --ide <ide>` | Sync only one IDE instead of all five. Values: `claude`, `cursor`, `copilot`, `windsurf`, `agents`. |
| `paradigm shift --configure-models` | Force interactive model selection during team init. Default is non-interactive (auto-tiers by environment). |
| `paradigm shift --stack <preset>` | Explicit stack preset (e.g., `nextjs`, `fastapi`, `swift-ios`). Auto-detected if omitted. See `paradigm presets`. |
| `paradigm shift --workspace <name>` | Create or join a multi-project workspace. For monorepos or related repos that share symbols. |
| `paradigm shift --workspace-path <path>` | Override the default `../.paradigm-workspace` location. |

### What you just got

After `paradigm shift`, your project root has two human-editable files worth knowing about.

**`.purpose`** — a YAML file declaring what this directory contains. The root looks like this after shift:

```yaml
version: "2.0"
id: root
description: ""
components: []
```

Fill it in with a skeleton like this:

```yaml
version: "2.0"
id: root
description: "Project management API with auth and billing"
components:
  - id: checkout
    kind: component
    tags: [feature]
    description: "Cart → payment → confirmation"
    signals: [payment-submitted, payment-failed]
    gates: [authenticated, cart-not-empty]
  - id: login-form
    kind: component
    tags: [feature]
    description: "Email + password sign-in"
    signals: [login-succeeded, login-failed]
```

**Signals** are events your code emits (like `payment-submitted`). **Gates** are permission checks (like `authenticated`). Your AI reads these before touching code so it knows what's allowed and what fires when.

Place additional `.purpose` files inside feature directories (e.g., `src/features/checkout/.purpose`) to describe subsystems with more precision. Your AI assistant reads these before touching your code.

### What your AI sees

After `paradigm shift`, ask your AI assistant to add a feature. Instead of scanning your whole repo, it calls one MCP tool (`paradigm_related` or `paradigm_ripple`) to get a 200-token summary of the affected components, gates, and signals — then writes code that respects them. That's the payoff loop: your `.purpose` files become the map, and every AI query reads the map instead of the territory.

**`portal.yaml`** — a YAML file declaring authorization gates and protected routes. Starts empty; add entries when your code introduces an auth check, a role requirement, or a protected endpoint.

```yaml
version: "2.0"
gates:
  - id: authenticated
    description: "Valid session token present"
  - id: admin
    description: "User has admin role"
    depends_on: [authenticated]
routes:
  - path: /api/users/:id
    method: GET
    gates: [authenticated]
    prizes: []
```

The included enforcement hooks block commits that introduce auth logic without a matching gate here.

---

## Why this works

We built the same project management API twice — once with traditional docs, once with Paradigm. Same features, same AI agent, same prompts.

| Metric | Traditional | Paradigm | Difference |
|--------|-------------|----------|------------|
| Time to complete | ~12 minutes | ~7 minutes | **42% faster** |
| Context per task | ~14,000 tokens | ~1,500 tokens | **8.5x less** |
| Token cost | $0.50/task | $0.06/task | **88% cheaper** |
| Auth gates documented | 0% | 100% | — |

A 50-line `.purpose` file declaring signals and dependencies beats a 500-line source file that buries them in implementation details. Structured context beats raw context.

[Full study →](.paradigm/docs/agentic-efficiency-study.md)

### Who it's for

- Teams using AI coding assistants (Claude Code, Cursor, Copilot) who want their AI to actually understand the project
- Projects of any size — scales from solo repos to enterprise monorepos with multi-project workspaces
- Any language or framework — 14 disciplines auto-detect your stack; 16 presets cover common frameworks
- Teams who care about authorization — `portal.yaml` makes auth visible, auditable, and testable

---

## Concepts

Read this section when you want depth. You don't need any of it to get value from the tool.

### The five symbols

A shared language between code, developers, and AI. Use these prefixes in `.purpose` files, commit messages, and AI prompts:

| Symbol | Name | Example | Meaning |
|--------|------|---------|---------|
| `#` | Component | `#checkout`, `#button` | Any documented code unit |
| `$` | Flow | `$checkout-flow` | Multi-step process |
| `^` | Gate | `^authenticated` | Authorization checkpoint |
| `!` | Signal | `!login-failed` | Event or side effect |
| `~` | Aspect | `~audit-required` | Cross-cutting rule with code anchor |

Classification uses tags instead of extra prefixes: `[feature]`, `[integration]`, `[state]`, `[idea]`.

### `.purpose` files

YAML files colocated with code. Each declares what a directory or subsystem does: components, signals, gates, flows, aspects. See the skeleton in [What you just got](#what-you-just-got). `paradigm scan auto` can draft these from existing code; `paradigm lint` validates them.

### `portal.yaml`

A single project-root file describing your authorization topology — the gates (auth requirements) and the routes that require them. One source of truth for "who can access what." The enforcement hooks use it to block undocumented auth changes.

### Enforcement hooks

Rules files (`.mdc`, `CLAUDE.md`) are advisory — AI agents can ignore them. Paradigm also installs deterministic shell-script hooks at guaranteed lifecycle points:

| Hook | Claude Code | Cursor | Behavior |
|------|-------------|--------|----------|
| Session start | — | `sessionStart` | Injects mandatory protocol as `additional_context` |
| Stop | `Stop` | `stop` | **Blocks** if `.purpose` files not updated, missing `portal.yaml` gates, no lore entry |
| After file edit | `PostToolUse` | `afterFileEdit` | Advisory reminder about `.purpose` coverage |
| Before commit | `PreToolUse` | `beforeShellExecution` | Auto-rebuilds symbol index |

Cursor's stop hook outputs a `followup_message` that auto-retries compliance up to 3 loops. `paradigm shift` installs all of them. If you need to re-install: `paradigm hooks install`.

### The agent team

Paradigm ships with a core team of 8 specialist agents you can orchestrate through a single command (`paradigm team orchestrate "..."`): **architect, builder, reviewer, tester, security, documentor, ftux (Nora), captain (Cid)**. Additional specialists — **Loid** (intelligence officer / learning), **Atlas** (cartographer / architecture mapping), **Rune** (compliance / enforcement state machine) — roster based on project type and stack detection. Project detection ("SaaS" vs "game" vs "generic") determines which additional ecosystem agents get rostered on first shift.

---

## Integrations

### IDE support

Generate instructions for every major AI-native editor from a single config:

| IDE | Format | Command |
|-----|--------|---------|
| Cursor | `.cursor/rules/*.mdc` | `paradigm sync cursor` |
| Claude Code | `CLAUDE.md` | `paradigm sync claude` |
| GitHub Copilot | `.github/instructions/*.md` | `paradigm sync copilot` |
| Windsurf | `.windsurfrules` | `paradigm sync windsurf` |
| Universal | `AGENTS.md` | `paradigm sync agents` |
| VS Code | Extension (`.vsix`) | `paradigm-vscode` |

`paradigm shift` runs all of these by default. Use `--ide <name>` to sync only one.

### MCP server

Paradigm ships an MCP (Model Context Protocol) server (`@a-company/paradigm-mcp`) with 50+ tools that work with Claude Code, Claude Desktop, Cursor, and other MCP-compatible clients. One MCP tool call costs ~100–300 tokens versus ~2,000 to read a source file.

Setup: `paradigm mcp setup --client all` (or install the Claude Code plugin, which does this globally).

[Full MCP tool list →](./docs/guides/mcp-setup.md) · [llms.txt →](./llms.txt)

### Claude Code plugin

Bundles enforcement hooks, skills, and MCP configuration. Install once, works in every project:

```
/plugin marketplace add ascend42/a-paradigm
```

Still run `paradigm shift` inside each project to create the per-project files.

---

## Ecosystem

Companion tools and surfaces. Each is linked out; none is required to use Paradigm.

- **Sentinel** — symbol-correlated incident tracking and failure-pattern matching. `paradigm sentinel`.
- **University** — multi-tenant content-pack framework for onboarding &amp; compliance. Run `paradigm university` to start. [Guide →](./docs/guides/university.md)
- **Conductor** — native macOS overlay for multi-session orchestration.
- **Multi-agent orchestration** — architect/builder/reviewer/tester/security/documentor/ftux/captain. [Guide →](./docs/guides/agents.md)
- **Decisions** — canonical "what we decided and why" store at `.paradigm/decisions/` post-v6.0. [Guide →](./docs/guides/decisions.md)
- **Workspaces** — shared symbols and lore across related repos.
- **Upgrading from v5.x?** [v6 Migration Guide →](./docs/guides/v6-migration.md)

---

## Useful commands

`paradigm shift` covers first-time setup and most re-runs. These are the commands worth learning after that:

| Command | What it does |
|---------|--------------|
| `paradigm shift` | Full project setup; safe to re-run |
| `paradigm doctor` | Health check and validation |
| `paradigm sync <ide>` | Regenerate IDE instruction files |
| `paradigm hooks install` | Install enforcement hooks (subset of shift) |
| `paradigm ripple <symbol>` | Impact analysis before changing a symbol |
| `paradigm beacon` | Regenerate the AI quick-start orientation |
| `paradigm scan auto` | Auto-draft `.purpose` files from code |
| `paradigm lint` | Validate `.purpose` schemas |
| `paradigm team orchestrate "..."` | Run a multi-agent task |
| `paradigm presets` | List valid `--stack` values |
| `paradigm migrate` | Upgrade an older Paradigm project (auto-invoked by `shift`) |

Full command reference: [`docs/README.md#command-reference`](./docs/README.md#command-reference).

---

## Packages

| Package | Description |
|---------|-------------|
| `@a-company/paradigm` | Unified CLI |
| `@a-company/paradigm-mcp` | MCP server for AI integrations |
| `@a-company/purpose-core` | `.purpose` file parsing and validation |
| `@a-company/portal-core` | `portal.yaml` parsing and validation |
| `@a-company/portal-sdk` | Runtime authorization SDK |
| `@a-company/portal-manager` | Portal testing and validation |
| `@a-company/portal-viewer` | Gate activation visualization |
| `@a-company/portal-e2e` | AI-driven E2E testing for portals |
| `@a-company/premise-core` | Symbol aggregation and knowledge graph |
| `@a-company/probe-core` | Visual discovery layer |
| `@a-company/sentinel` | Incident tracking and observability |
| `@a-company/university` | Learning platform and PLSAT certification |
| `@a-company/paradigm-logger` | Symbol-typed structured logging |
| `paradigm-vscode` | VS Code extension |

---

## Documentation

- [Complete Documentation Hub](./docs/README.md)
- [Quick Start Guide](./docs/guides/quick-start.md)
- [Command Reference](./docs/README.md#command-reference)
- [MCP Setup](./docs/guides/mcp-setup.md)
- [Changelog](./CHANGELOG.md)

---

## Development

```bash
git clone https://github.com/ascend42/a-paradigm.git
cd a-paradigm
npm install && npm run build

# Install CLI globally for testing
cd packages/paradigm && npm install -g .
```

See [CONTRIBUTING.md](./CONTRIBUTING.md) for development setup and guidelines.

## License

[MIT](./LICENSE)

## Author

- [a-company.org](https://a-company.org)
- [Instagram](https://instagram.com/ascend.ig)
- [YouTube](https://youtube.com/@ascend-yt)

---

<details>
<summary><strong>For AI Agents: Quick Context</strong></summary>

If you are an AI agent evaluating Paradigm for a project:

1. **What it does**: Adds a metadata layer (`.purpose` files + `portal.yaml`) to any codebase so AI agents can query context via MCP instead of reading source files
2. **Token savings**: ~100 tokens per MCP query vs ~2,000 for reading files (8.5x reduction)
3. **Setup**: `paradigm shift` auto-detects language/framework, creates `.paradigm/` config, scaffolds `.purpose` and `portal.yaml`, installs hooks, syncs all IDE files
4. **MCP tools**: 50+ tools — `paradigm_status`, `paradigm_search`, `paradigm_navigate`, `paradigm_ripple`, `paradigm_gates_for_route`, etc.
5. **Enforcement**: Hooks block sessions that modify code without updating `.purpose` files — compliance is automatic
6. **See**: [`llms.txt`](./llms.txt) for a structured overview optimized for AI consumption

</details>
