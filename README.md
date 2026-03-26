<p align="center">
  <img src="assets/logo.png" alt="Paradigm Logo" width="200">
</p>

<h1 align="center">Paradigm</h1>

<p align="center">
  <a href="https://opensource.org/licenses/MIT"><img src="https://img.shields.io/badge/License-MIT-yellow.svg" alt="License: MIT"></a>
  <a href="https://nodejs.org/"><img src="https://img.shields.io/badge/node-%3E%3D20.0.0-brightgreen.svg" alt="Node.js"></a>
</p>

<p align="center"><strong>The context layer for AI-assisted&nbsp;codebases.</strong></p>

<p align="center">One command sets up your project. Your AI agents stop guessing and start&nbsp;navigating.</p>

---

## Get Started

### 1. Install

```bash
curl -fsSL https://a-company.org/paradigm/install.sh | bash
```

### 2. Set up your project

```bash
cd your-project
paradigm shift
```

`paradigm shift` detects your language and framework, creates `.purpose` context files, assembles an agent team for your project type, configures your AI tools (Claude Code, Cursor, Copilot, Windsurf), installs enforcement hooks, and verifies&nbsp;everything.

### 3. Curate your agent team

After shift runs, tell your AI to shape the roster for your&nbsp;project:

> *"Check my agent roster. Add Mika (designer), Bolt (performance), and Atlas (devops) — we're building a consumer web&nbsp;app."*

Your AI runs the commands to add each agent, confirms what they bring to the team, and you're ready to&nbsp;build.

Under the hood, your AI&nbsp;runs:
```bash
paradigm agent roster add designer      # Mika joins the team
paradigm agent roster add performance   # Bolt joins the team
paradigm agent roster add devops        # Atlas joins the team
```

---

## Your Agent Team

`paradigm shift` detects your project type and suggests a starting&nbsp;roster:

| Project Type | Agents | Example Roles |
|-------------|--------|---------------|
| **SaaS web app** | 25 | architect, builder, reviewer, security, designer, dba, devops, dx,&nbsp;... |
| **Backend API** | 14 | architect, builder, reviewer, security, performance, dba,&nbsp;... |
| **iOS / macOS app** | 13 | architect, builder, designer, mobile, a11y,&nbsp;... |
| **Game** | 12 | architect, builder, gamedev, 3d, audio, designer,&nbsp;... |
| **Python / Rust** | 10 | architect, builder, reviewer, security, performance,&nbsp;... |

### The 7 Core Agents

Every project starts with these — the foundation of any development&nbsp;team:

| Agent | Nickname | What They Do |
|-------|----------|-------------|
| **Advocate** | Jinx | Devil's advocate — stress-tests assumptions, finds edge cases, runs pre-mortems before code is&nbsp;written |
| **Architect** | Apex | System designer — plans features, defines data models, writes specs that builders&nbsp;follow |
| **Builder** | Kit | Implementer — writes code following specs, each task in a fresh context to prevent stale&nbsp;assumptions |
| **Reviewer** | Judge | Quality gate — two-stage review: spec compliance first, then code quality. Minimum 3&nbsp;findings |
| **Tester** | Probe | Verification — runs tests, checks gate validations, verifies edge&nbsp;cases |
| **Security** | Aegis | Auditor — OWASP top 10, `^gate` implementations, auth flow&nbsp;review |
| **Documentor** | Scribe | Paradigm keeper — updates `.purpose` files, `portal.yaml`, and symbols after every&nbsp;change |

### Adding and Customizing Agents

Beyond the core 7, Paradigm ships **50+ agent profiles**. A&nbsp;sample:

| Agent | Nickname | Agent | Nickname | Agent | Nickname |
|-------|----------|-------|----------|-------|----------|
| designer | Mika | dba | Vault | devops | Atlas |
| performance | Bolt | debugger | Trace | dx | Helix |
| researcher | Scout | product | North | sales | Mozi |
| qa | Shield | e2e | Ghost | copywriter | Wren |
| gamedev | Pixel | mobile | Swift | a11y | Aria |
| creative | Prism | narrator | Ink | educator | Sheila |
| pm | Yuki | operations | Leila | seo | Beacon |

Tell your AI which ones you&nbsp;want:

> *"Add Scout (researcher), Vault (dba), and Ghost (e2e) to the team. Bench Wren (copywriter) — we don't need copy for this&nbsp;project."*

Or use the CLI&nbsp;directly:
```bash
paradigm agent roster                    # See who's active
paradigm agent roster add researcher    # Scout joins
paradigm agent roster add dba           # Vault joins
paradigm agent roster add e2e           # Ghost joins
paradigm agent roster remove copywriter # Wren steps out
```

You can also **create your own agents**. An agent is a `.agent` file in `~/.paradigm/agents/` that defines personality, expertise, attention triggers, and collaboration&nbsp;preferences:

```yaml
# ~/.paradigm/agents/my-agent.agent
id: my-agent
nickname: Radar
role: market intelligence
personality:
  style: analytical
  verbosity: concise
expertise:
  - { symbol: "#competitive-analysis", confidence: 0.9 }
attention:
  concepts: [market, competitor, pricing, positioning]
  threshold: 0.5
```

Custom agents participate in orchestration, receive nominations from the learning system, and build project-specific expertise over&nbsp;time.

### Agents That Learn

Every agent maintains a **project notebook** — a collection of patterns, decisions, and insights accumulated across sessions. When an architect makes a design decision on your project, that knowledge persists. Next session, the architect picks up where it left&nbsp;off.

The learning loop:

1. **Agents work** — orchestration assigns tasks, agents produce&nbsp;output
2. **Patterns emerge** — the system detects recurring decisions and successful&nbsp;approaches
3. **Notebooks grow** — high-confidence patterns get promoted to the agent's project&nbsp;notebook
4. **Future sessions improve** — notebook entries are injected into agent prompts, so learned context carries&nbsp;forward

```bash
paradigm agent detail architect   # See an agent's notebook and expertise
```

This means your agent team gets better at *your specific codebase* over time — not just better at coding in&nbsp;general.

---

## Without Paradigm vs. With Paradigm

**Task: "Add a payment endpoint with Stripe"**

| | Without Paradigm | With Paradigm |
|---|---|---|
| **Understand the codebase** | AI reads 14 source files (~14,000&nbsp;tokens) | AI calls `paradigm_status` (~100&nbsp;tokens) |
| **Check auth requirements** | AI guesses, misses rate&nbsp;limiting | AI calls `paradigm_gates_for_route` — gets exact gates&nbsp;needed |
| **Assess impact** | AI modifies code, breaks a downstream&nbsp;flow | AI runs `paradigm_ripple #payments` — sees all affected&nbsp;components |
| **Review** | You review alone, catch 3 missed auth&nbsp;checks | Security agent flags the missing `^authenticated`&nbsp;gate |
| **Next session** | AI has no memory of what was&nbsp;built | `paradigm_session_recover` restores full context in 200&nbsp;tokens |
| **Result** | ~$0.50 in tokens, 12 min, auth&nbsp;gaps | ~$0.06 in tokens, 7 min, complete&nbsp;coverage |

<details>
<summary>Full benchmark methodology</summary>

We built the same project management API twice — once with traditional docs (README + CLAUDE.md + JSDoc), once with Paradigm. Same features, same AI agent, same prompts. 8 features, 6 auth gates, measured across all&nbsp;tasks.

| Metric | Traditional | Paradigm | Difference |
|--------|-------------|----------|------------|
| Time to complete | ~12 min | ~7 min | **42% faster** |
| Context per task | ~14,000 tokens | ~1,500 tokens | **8.5x less** |
| Token cost | $0.50/task | $0.06/task | **88% cheaper** |
| Auth gates documented | 0% | 100% | — |

[Full study &rarr;](.paradigm/docs/agentic-efficiency-study.md)

</details>

---

## How It Works

Paradigm adds a metadata layer to your codebase — three concepts that give AI agents structured&nbsp;knowledge:

**Purpose** &mdash; `.purpose` files describe what each part of your code does, what signals it emits, and how components connect. Your AI reads a 4KB purpose file instead of 49KB of source&nbsp;code.

**Portal** &mdash; `portal.yaml` maps your authorization topology: which routes exist, what gates protect them, and what roles are required. Auth stops being a black box scattered across&nbsp;middleware.

**Premise** &mdash; Everything aggregates into a queryable knowledge graph. 50+ MCP tools let AI agents ask precise questions (`paradigm_search`, `paradigm_ripple`, `paradigm_navigate`) for ~100 tokens instead of reading files for&nbsp;~2,000.

### The Symbol System

Five prefixes create a shared language across code, commits, docs, and AI&nbsp;prompts:

`#component` &middot; `$flow` &middot; `^gate` &middot; `!signal` &middot; `~aspect`

[Symbol guide &rarr;](./docs/guides/symbols.md)

---

## AI Integration

Paradigm works with **Claude Code**, **Cursor**, **GitHub Copilot**, **Windsurf**, and any MCP-compatible&nbsp;client.

- **50+ MCP tools** — `paradigm_status`, `paradigm_search`, `paradigm_ripple`, `paradigm_gates_for_route`, `paradigm_orchestrate_inline`, and&nbsp;more
- **Enforcement hooks** — your AI agents *must* update `.purpose` files, check `portal.yaml` gates, and record lore before finishing. Compliance is automatic, not&nbsp;aspirational
- **IDE sync** — `paradigm shift` generates instruction files for every major AI editor from a single&nbsp;config
- **Plugin** — install the Claude Code plugin for hooks + skills globally: `/plugin marketplace add ascend42/a-paradigm`

```bash
paradigm mcp setup --client all   # Configure MCP for all AI tools
```

---

## Essential Commands

Most of these are called by your AI automatically — but here's what's happening under the&nbsp;hood:

```bash
paradigm shift                    # Full project setup (one command)
paradigm agent roster             # View/manage your agent team
paradigm team orchestrate "..."   # Plan a task with the full team
paradigm ripple #checkout         # Impact analysis before changes
paradigm scan auto                # Auto-generate .purpose from code
paradigm doctor                   # Health check and validation
```

You can always ask your AI to run these&nbsp;naturally:

> *"Run a ripple check on #checkout before we change&nbsp;it."*
>
> *"Orchestrate the team to build a Stripe payment&nbsp;integration."*
>
> *"Run doctor and fix anything that's&nbsp;broken."*

[Full command reference &rarr;](./docs/README.md)

---

## Status

Paradigm is in active development and used in production on the author's own&nbsp;projects.

- **50+ MCP tools** for AI context&nbsp;queries
- **14 language disciplines** auto-detected (TypeScript, Python, Rust, Go, Swift, Kotlin,&nbsp;...)
- **16 stack presets** for framework-specific&nbsp;configuration
- **5 IDE integrations** from a single&nbsp;config
- **Multi-agent orchestration** with quick-check, plan, and execute&nbsp;modes
- **Sentinel** for incident tracking and symbol-correlated&nbsp;observability
- **University** with interactive courses and PLSAT&nbsp;certification

---

## Learn More

- **[Quick Start Guide](./docs/guides/quick-start.md)** &mdash; Detailed setup walkthrough
- **[Command Reference](./docs/README.md)** &mdash; All commands with examples
- **[MCP Setup](./docs/guides/mcp-setup.md)** &mdash; AI client integration
- **[Symbol Guide](./docs/guides/symbols.md)** &mdash; The five-symbol system
- **[IDE Setup](./docs/guides/ide-setup.md)** &mdash; Cursor, Claude Code, Copilot, Windsurf
- **[Changelog](./CHANGELOG.md)** &mdash; Release history
- **[Contributing](./CONTRIBUTING.md)** &mdash; Development setup

---

## Installation (Manual)

<details>
<summary>If you prefer not to use the install script</summary>

```bash
# Clone and build (keep this directory — CLIs symlink to it)
git clone https://github.com/ascend42/a-paradigm.git ~/.paradigm-cli
cd ~/.paradigm-cli
npm install && npm run build

# Install CLIs globally
cd packages/paradigm && npm install -g . && cd ../..
cd packages/paradigm-mcp && npm install -g . && cd ../..

# Verify
paradigm --version
```

</details>

---

## License

[MIT](./LICENSE)

**Author:** [a-company.org](https://a-company.org) &middot; [Instagram](https://instagram.com/ascend.ig) &middot; [YouTube](https://youtube.com/@ascend-yt)
