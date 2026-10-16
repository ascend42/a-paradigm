# Scout: the founder's own tool family (2026-10-15)

Read-only map of a-neurons, a-constellation, a-atelier, a-flow, a-paradigm under ~/Documents/GitHub/. Inferences marked.

## Per tool
- **a-neurons** — personal knowledge brain. TS/Node 22. CLI + stdio MCP (neuron_search/get/write/related, source_ingest/get/frames, recipe_run, audit_*, review_*, course_create, skill_install, ripple, tend, inbox_list, vault_status, artifact_write). No UI (Obsidian viewer). Markdown vault `~/neurons` git-synced to private repo; throwaway SQLite+embeddings index. Nouns: neuron n:, source s:, region r:, artifact a:, audit au-, recipe, course, inbox, tend.
- **a-constellation** — local voice-driven map: calls become stars/beams; Spaces, automations, connections, vaults, headless agents. TS/Node 24, Hono + node:sqlite, React+canvas, Electron. Web 127.0.0.1:4747, CLI, ~40-tool MCP, skill, desktop. `data/constellation.db` with append-only op/event log as truth; per-agent `spool.ndjson`; vault sealed AES-GCM, key in Keychain. Nouns: Space, call/session, star, beam, task, op, automation, connection, tool server, vault, agent, Claude Admin, permission card.
- **a-atelier** — AI-native animation engine (`.atelier` YAML) + design/production crew (Luna, Mika; Patrick, Quill, Lux, Iris). TS pnpm/turbo, 13 packages + 2 apps. `atelier` CLI, `atelier-mcp` (52 tools; not on PATH this session), Studio/Playground/Showcase, skills atelier-design/produce. Per repo `.atelier/design-system.yaml`, DESIGN.md, sessions; home brand cascade `~/.atelier/config.yaml`; crew agents/notebooks live in `~/.paradigm/`.
- **a-flow** (packages `flowmation-*`) — self-hosted automation hub: watches work sources, triages with a fast local engine, proposes actions, owner approves. Python hub/nodes/CLI/sandbox/outbound guard/harness; React/Vite GUI at :8787; read+propose-only MCP over unix-socket JSON-RPC; `flowmation-harness` LaunchAgent owning private tmux + headless Claude sessions. Hash-chained SQLite `chain` + rebuildable projections; separate authstore.db; blueprints, instance.yaml, proposals. Nouns: routine, blueprint, instance, item, answer, outcome, verdict, action, proposal, node, capability, step-up, permission window, ledger, hand-off, session step.
- **a-paradigm** — framework: symbol graph, .purpose, portal.yaml, lore, decisions, 68 agents + notebooks, hooks, MCP (11 anchor + 21 default families + 13 on-demand), Platform :3850, Claude Code plugin (hooks.json, 21 skills, 5 agents), Conductor (Swift), VS Code ext, Warpline, Sentinel (Rust), University. Per-repo `.paradigm/`; global `~/.paradigm/` (101 agents, notebooks, score/, sessions/, conductor/atrium, brains/); `.warpline/fabric.jsonl`.

## Overlaps / duplication
- **Claude runner implemented three times**: flow `flowmation_harness/headless.py`, constellation `server/agents.ts`+`claudeCli.ts` (ports flow's pattern), Conductor `ClaudeStreamSession.swift`. All drive `claude -p` stream-json with `--session-id`/`--resume` and a `{seq,at,event}` spool.
- **Approval UIs ×3**: constellation Allow/Deny cards, flow approvals + step-up, Symphony file-requests.
- **Owner auth ×2**: constellation PIN+TOTP, flow TOTP step-up.
- **Secrets ×2**: constellation vaults, flow authstore. "vault" also = neurons knowledge vault.
- **Scheduling ×3+**: constellation automations, flow routines, paradigm pipelines/study-hall schedule; Discord/Slack/GitHub/HTTP connectors in both constellation and flow.
- **Personal knowledge ×2**: a-neurons vs Paradigm Brain (`~/.paradigm/brains`); plus habits, lore, Steward memory.
- **"Session" has four meanings**: constellation calls, paradigm_session recover/handoff, atelier design sessions, flow headless sessions.
- **Five append-only ledgers**: constellation op log, flow chain + SSE outbox, Paradigm events/stream.jsonl, Warpline fabric, Neurons git.
- **Graph UIs**: constellation sky, Paradigm Graph/Canvas, Atrium graph, `paradigm constellation` (symbol-graph json — name collision).
- **UI shells ×5 on separate ports**: constellation, flow, Platform, Conductor, Atelier Studio.
- **Agents ×4 notions**: Paradigm roster, Atelier crew (inside Paradigm roster), constellation per-Space agents, flow MCP clients.

## Existing integration
- Every repo is Paradigm-instrumented (CLAUDE.md, .paradigm/, portal.yaml); flow ports the Paradigm logger to Python and cites TD-/L- ids; neurons keeps `n:` prefixes distinct.
- `atelier setup` installs its crew into `~/.paradigm/agents` + notebooks.
- Atelier sessions shaped constellation's and flow's UIs.
- constellation borrows flow patterns; its tool servers come from `~/.claude.json`/`.mcp.json`, so automations can call neurons (inferred).
- Conductor talks to paradigm-mcp and Sentinel.
- Shared install targets: `~/.claude/skills`, user-scope MCP, `~/.claude/CLAUDE.md`.
- Shared id (inferred): the Claude Code session uuid + `~/.claude/projects/<cwd>/<uuid>.jsonl`.

## Seams for one Paradigm Harness
- **One session runner + identity** keyed by Claude session uuid; reuse HMAC per-agent tokens.
- **One event bus**: `{seq, at, event}` NDJSON spool + SSE (constellation and flow already share it), bridging Paradigm stream.jsonl and Symphony Score.
- **One manifest**: flow plugin manifest (`kind, name, version, capabilities, config_schema`) + blueprint manifests + Claude Code plugin.json + constellation tool-server registry → one manifest declaring MCP server, skills, agents, UI panel, step kinds.
- **Storage**: keep each source of truth; add a shared ref grammar (`n:`, `#sym`, `TD-`, `s:`, star ids) and a cross-index.
- **One display contract** from three block protocols: constellation Admin blocks, Conductor `conductor-visual` envelope, `paradigm_platform` navigate/highlight/annotate.
- **One approvals + step-up service**.
- **One loop definition**: constellation trigger grammar or flow routine schema.

## Already-existing pieces of the asked-for parts
- Harness: `flowmation-harness`, constellation agent server, Conductor workspace/Atrium.
- Loops: constellation wait→apply/done, flow routines + weekly tuning, `paradigm pipeline`, constellation automations, `/loop` `/schedule`.
- Mods: neurons user recipes, flow plugins/blueprints, Paradigm on-demand tool families, habits + hook graduation, plugin hooks.json.
- Displays: Conductor Atrium (decision cards, LIGHTBOX, chorus rail), constellation Admin blocks, Platform sections, Atelier Studio.
- Cross-session messaging: Symphony / The Score (`paradigm symphony join/send/inbox/threads/watch`, discoverClaudeCodeSessions, `~/.paradigm/score/`), Conductor ScoreIO/NoteRelay, constellation Admin thread over every Space.
- Notebook querying/consolidation: paradigm_notebook, ambient nominations + promotion, class/study-hall/forage/teach skills, `paradigm memory review/sync` (Steward), neurons tend/ripple/audits, Brain suggest→confirm.
