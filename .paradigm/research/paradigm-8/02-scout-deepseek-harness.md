# Scout: deepseek-harness / dsh (2026-10-15)

Repo `~/Documents/GitHub/deepseek-harness`. Docs and package READMEs read, not source. Inferences marked.

## Thesis
TS monorepo, developer preview, MIT. Web UI, Electron, headless CLI, JSON-RPC SDK (TS, Python), ACP server. "Everything is a plugin" on vendored Cordis (services, typed events, reversible effects). No privileged core: loop, session log, tool registry, model adapter are all replaceable plugins. House rules: "Plugins, not loop changes" and "Model-visible ⟺ logged".
Positioning vs Claude Code/Codex is interop: bridges Claude Code mods and hooks, runs Claude Code and Codex as subagent backends, workflow `meta` block matches Claude Code dynamic workflows, loads AGENTS.md/CLAUDE.md.

## Architecture
- Profiles (web, headless, sdk, sdk-minimal, acp) stack bundles: dsh-base → app bundle → `cordis.patch.yml` → home patch → `--patch`. `dsh --dump-config` prints the plugin tree.
- Agent loop: turn = steps; waterfall events with `next()`: `agent/pre-step`, `agent/request`, `llm/stream`, `tools/pre-execute`, `tools/execute`, `tools/post-execute`; serial `agent/turn-stopping`; `agent.inject()` must be logged.
- PTC code mode: model writes a program calling tools as host bindings in sandboxed Node.
- Sessions: append-only JSONL, versioned migration-chained formats, projections as folds, fail-closed checkpoint before every side effect, cross-process write lease.
- Compaction as optional plugin; spill-to-file.
- Permissions: read-only / workspace-write / danger-full-access; bwrap/Landlock, Seatbelt, Windows ACL, SSH backends each report `full` or `partial` enforcement. Closed fail-closed approval set. Experimental model-judged auto review.
- Providers via `ctx.llm` adapter seam.

## Extension points
- `dsh` field in package.json (profile, bundle, client); plugins mounted as `cordis.yml` rows; JSON market index `{format:1, plugins:[…]}`; Plugin Manager installs from npm/git/local; `dsh-plugin` GitHub topic.
- Skills `<name>/SKILL.md`, layered catalogs. Reuses Claude Code/Codex `hooks.json` (command hooks only). MCP as `mcp__server__tool`.
- Typed UI Slots and Component Factories; `ConversationNodeDefinition` for new chat nodes; lazy client modules.
- Self-modification: agent writes and runs new plugins. Agent presets = plugin set + persona.

## Multi-agent
- One subagent activation API over fork/spawn in-process, SDK subprocess, ACP, Claude Code, Codex. `send_message`, `interrupt_agent`, `list_agents`.
- Agent Teams (experimental): Lead + teammates, inbox messaging that can cold-resume a stopped teammate, durable CAS task graph with `blockedBy`. `writeScopes` advisory, explicitly not locks; decision note rejects auto worktrees: "False mutual exclusion is more dangerous than an explicit warning".
- Worktrees: `create_worktree` at `.agents/worktrees/<name>`; no auto merge or cleanup.
- Git log: 504 merged `worktree/*` branches, 231 `codex/*` — the repo is mostly agent-built in worktrees.
- Model-written JS workflow scripts; webhooks start sessions (e.g. PR review).

## Memory
No first-party memory or learning. Third-party memory MCP; opt-in read-only session search scoped to same cwd. Agent Notes (`.agents/notes/{proposed|implemented|rejected}/…`) are developer decision records the runtime never reads; 19 dev skills.

## Loops
Goals: durable objective, phases active/paused/blocked/complete, CAS revisions, 256-round cap. Ralph tool: fresh agents per round passing a bounded report; "the workspace is the long-term memory". Repeat-tool guard at 3/5/8 identical calls. Schedule after/at/every/daily/weekly/cron back to origin session. Background jobs. Benchmarks are perf gates only (RSS, fold, open) — no task-quality eval.

## Steal
1. Model-visible ⟺ logged + fail-closed checkpoints → exact fork/resume/replay. Paradigm-injected context (notebooks, lore, decisions) should be logged events.
2. Capability seams + profile/bundle/patch layering + market index + `--dump-config`.
3. Interop as strategy: span every harness rather than compete. Also advisory writeScopes with overlap warnings, CAS task graph, goal round caps.

## Where Paradigm is ahead
Codebase understanding (symbol graph, ripple, purpose index vs LSP+grep); native memory/learning (notebooks, journals, calibration, lore vs third-party MCP); merge adjudication (dsh explicitly refuses — Warpline fills the gap its note leaves); quality loops (calibration vs perf-only benchmarks).
