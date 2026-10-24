# Paradigm

Paradigm gives AI coding agents structure, deterministic checks and calibrated memory for your codebase.

- **Structure.** Each part of your code is described in plain YAML next to the code: `.purpose` files for components, flows and signals, and `portal.yaml` for authorization gates. Agents get answers from this map through MCP tools instead of reading the whole repository.
- **Determinism.** Shell hooks run at fixed points in a Claude Code or Cursor session. The Stop hook blocks the session when code changed but its `.purpose` file, gate or lore entry did not. The hooks are scripts, not instructions an agent can ignore.
- **Calibration.** Agents keep notebooks, lore and decisions. A new learning is proposed, tested against scenarios and signed off by you before it reaches a notebook. Token estimates are rebuilt from measured usage (`paradigm calibrate`).

8.0 adds **Gnomon**, a local console for your Claude Code sessions on Apple silicon Macs.

## Why use it

- **Agents stop rediscovering your codebase.** They ask the map for the right files instead of reading everything, so sessions start faster and use fewer tokens.
- **Changes don't silently skip the paperwork.** If an agent changes code without updating its description, gates or history, the session is blocked until it does.
- **Auth rules are written down.** Protected routes and their gates live in `portal.yaml`, so agents check them before adding an endpoint.
- **Your project remembers why.** Decisions, lore and agent notebooks survive between sessions, so the next agent knows what was tried and why.
- **A team of specialised agents.** An architect, builder, reviewer, security agent and more, each with its own notebook, which improves as you approve what it learns.
- **One place to steer many sessions (Gnomon).** Every permission, question and plan from your Claude Code sessions lands on one decision stack. You answer by click or keyboard, confirmed with Touch ID or your password, or by voice if you turn it on.

Good fits: a codebase that has outgrown one person's head, several agents working in parallel, auth-sensitive apps, and long-running projects where context gets lost between sessions.

## Install

```bash
npm install -g @a-company/paradigm
cd your-project
paradigm shift
```

You need Node 24 or later. `paradigm shift` creates `.paradigm/`, a root `.purpose`, `portal.yaml`, instruction files for Claude Code, Cursor, Copilot and Windsurf, plus `AGENTS.md`, and the enforcement hooks. Running it again is safe: it never overwrites existing content.

If you use Claude Code, also install the plugin. It adds the hooks, skills, agents and the MCP server for every project:

```
/plugin marketplace add ascend42/a-paradigm
/plugin install paradigm@a-paradigm
```

## Gnomon (new in 8.0)

Gnomon runs your Claude Code sessions on your Mac and asks you before anything that matters happens.

```bash
gnomon
```

The first run installs a signed and notarized `Gnomon.app` into `/Applications`, or into `~/Applications` if you can't write to `/Applications`. It then opens setup. Setup asks for Touch ID or your password twice, then opens the desk. After an upgrade, quit and reopen Gnomon.

What you get:

- **The desk.** One window for your sessions. When a session needs a decision (a permission, a question, a plan), it puts a card on the decision stack. You decide it there, and your answer is signed with a Secure Enclave key after Touch ID or your password. The unlock lasts until the screen locks.
- **Sandboxed sessions.** Claude Code runs headless inside a macOS sandbox profile.
- **A hash-chained log.** Every session event is chained, so later edits to the log show up.
- **A budget fuse.** A spending limit that applies across all your sessions.
- **Mods.** Panels that run as separate, sandboxed processes. The first-party set:
  - **Workshop:** what needs you and what is running.
  - **Ledger:** tokens, cache share, cost and budget.
  - **Paradigm Context:** open tasks, decisions and lore for the focused project.
  - **Neurons and Constellation:** optional, if you run those tools.
- **Voice.** Speak to a session and hear short replies. Speech is processed on the Mac, and the audio never leaves it.

Requirements:

- An Apple silicon Mac with macOS 15 or later and System Integrity Protection on. Intel Macs, Windows and Linux are not supported in 8.0.
- Node 24 or later. Gnomon itself runs on its own pinned Node inside the app.
- Claude Code from the native installer, signed in with your Claude subscription. Gnomon refuses API-key billing.
- Touch ID or your login password.

Known limitation: the Mac helper doesn't yet check which program is calling it. Another program running as you could start it and ask it to sign, but every signature it makes still needs your Touch ID or password.

Design: [docs/specs/gnomon.md](https://github.com/ascend42/a-paradigm/blob/main/docs/specs/gnomon.md).

## The CLI and the MCP server

| Command | What it does |
|---|---|
| `paradigm shift` | Set up or update a project |
| `paradigm doctor` | Health check, including hook timings |
| `paradigm status` | Project overview and symbol counts |
| `paradigm ripple <symbol>` | What a change to a symbol affects |
| `paradigm integrity` | Broken references, duplicates, orphans |
| `paradigm sync <ide>` | Regenerate instruction files (`claude`, `cursor`, `copilot`, `windsurf`, `agents`) |
| `paradigm scan auto` | Draft `.purpose` files from existing code |
| `paradigm lint` | Validate `.purpose` files |
| `paradigm hooks install` | Reinstall the enforcement hooks |
| `paradigm serve` | Open Platform, the local web UI (lore, graph, Academy, Brain) |
| `paradigm mcp setup` | Add the MCP server to Cursor, Claude Desktop, Continue or Cline |

`paradigm --help` lists every command. Read-only commands such as `status`, `doctor` and `ripple` make no writes and no network calls.

The package includes the MCP server as `paradigm-mcp`. It lists **32 tools** by default (11 core tools and 21 grouped families such as `paradigm_lore` and `paradigm_task`). 13 more (Sentinel, Symphony, University and others) are switched on with `paradigm_tool_activate` or in `.paradigm/config.yaml`.

Five symbols name things across code, docs and commits: `#` component, `$` flow, `^` gate, `!` signal, `~` aspect.

## Agents and skills

Paradigm bundles 68 agent profiles: architect, builder, reviewer, tester, security, designer and more. `paradigm shift` puts a default roster on your project. Manage it with `paradigm agent roster`, `bench` and `activate`.

- **Notebooks** hold what each agent has learned (`paradigm notebook`).
- **Skills** carry each agent's repeatable procedures, and they are what agents read at runtime (`paradigm skill list`). Agent behaviours in the profiles are not read at runtime.
- For example, the designer agent ships its UI review and design-options protocols as skills, so they work in any project.

## Maintained alongside Paradigm

- **Sentinel**: incident tracking tied to your symbols (`paradigm sentinel`, `sentinel-mcp`).
- **University**: content packs, quizzes and the PLSAT, shown in Platform's Academy (`paradigm university`).
- **Symphony**: messages between Claude Code sessions (`paradigm symphony`).
- **Warpline** (experimental): merge prediction from the symbol graph ([@a-company/warpline](https://www.npmjs.com/package/@a-company/warpline)).
- **Workspaces**: shared symbols across related repos (`paradigm workspace`).
- **Brain**: structure for a personal notes folder, private by default (`paradigm brain`).
- **Atelier**, a separate product, works with Paradigm's designer agent.

## Parked

These still exist in the repository but get no active work:

- Conductor, the SwiftUI session overlay. It builds only from a repository clone.
- The VS Code extension.
- `sentinel-rs`, `sentinel-web`, `paradigm-runtime` and the Warpline GitHub Action.
- The standalone `portal-*`, `purpose-core`, `premise-core` and `probe-core` npm packages. Paradigm bundles its own copies, and the npm versions are out of date.

## Links

- Repository: [github.com/ascend42/a-paradigm](https://github.com/ascend42/a-paradigm)
- Docs: [docs/README.md](https://github.com/ascend42/a-paradigm/blob/main/docs/README.md) · [Quick start](https://github.com/ascend42/a-paradigm/blob/main/docs/guides/quick-start.md) · [MCP setup](https://github.com/ascend42/a-paradigm/blob/main/docs/guides/mcp-setup.md) · [Agents](https://github.com/ascend42/a-paradigm/blob/main/docs/guides/agents.md)
- [Changelog](https://github.com/ascend42/a-paradigm/blob/main/CHANGELOG.md)
- License: MIT
