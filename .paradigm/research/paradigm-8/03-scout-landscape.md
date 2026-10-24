# Scout: agentic-engineering landscape (2026-10-15)

15 web searches, mostly secondary sources. [pre-2026] = model knowledge; [unverified] = single secondary source.

## Harnesses
- Claude Code v2.1.296 (2026-10-09 [unverified]): failing hooks can halt, marketplace plugin install, per-subagent effort. v2.1.287 Mods: in-process JS/TS that rewrites events and draws panes, toasts, bands, status lines, message rows (https://code.claude.com/docs/en/plugins/mods/interface). Plus skills, subagents, output styles, statusline, `/loop` self-paced, cloud `/schedule`, `--worktree`, Agent SDK, Managed Agents.
- Codex CLI: subagents GA early 2026 (TOML custom agents), hooks GA ~May 2026, plugins bundle skills/apps/MCP with marketplace; Codex plugin for Claude Code.
- OpenCode ~165k stars [unverified], provider-agnostic client/server + TUI.
- Amp: commercial; "nearly any agent can get good results".
- Goose: donated to Linux Foundation AAIF; local models. arXiv 11-harness study https://arxiv.org/pdf/2609.00006.
- Aider: legacy; repo-map + commit-per-edit.
- Roo Code shut down 2026-05-15; Cline active.
- Cursor 3 (Apr 2026): agent-first IDE, cloud VM agents, local↔cloud handoff, self-host Enterprise, 8 parallel agents, Ralph plugin with "gutter" (stuck loop) detection.
- Pi (Mario Zechner → Earendil Works): 4 tools, typed TS extension API, self-writing hot-reloaded extensions, no sandbox — reference minimal harness.
- deepseek-harness: MIT, everything-is-a-plugin, ~200k stars in ~2 weeks [unverified], consumes Claude Code + Codex plugins.
- Odysseus (2026-05-31): self-hosted local-first AI workspace, ~66k stars by June 10, install friction.

## Loops
Ralph Wiggum loop (Huntley, Jul 2025): fixed prompt, while loop, fresh context per pass, next task from spec; Thoughtworks Radar Apr 2026 (token cost); official Claude Code plugin. Descendants: eval-gated loops ("check against something that can't lie"), stuck detection, self-pacing `/loop`, cloud cron. Still open: stopping criteria, per-loop budgets, progress vs thrash as first-class harness state.

## Interconnected sessions
- MCP 2026-07-28 spec: stateless core (no initialize, no protocol sessions); Tasks as formal extension for long-running work; MCP Apps (sandboxed iframe UI from servers); reverse-DNS extension ids; Roots/Sampling/Logging deprecating. Registry preview Sept 2025.
- A2A: 150+ orgs, signed domain-bound Agent Cards, multi-tenancy, JSON-RPC/gRPC, under AAIF.
- Worktree swarms: Conductor, Vibe Kanban, Claude Squad, Crystal, Emdash, Composio Orchestrator, Superset. Isolation solved, merging NOT: "most leave task alignment, conflict resolution, and merge decisions to the user" — Warpline's opening.
- No standard for live messaging between running sessions within one harness.

## Mods and displays
Claude Code Mods (strongest in-harness UI extension, admin allowlist); Pi and dsh typed self-modifying extensions; MCP Apps (UI-injection/exfil risk); AG-UI, A2UI [pre-2026]; Claude Artifacts with runtime capabilities (shared db, comments, self-saving pages).

## Memory
Consolidation: Claude Code Auto Dream (~Mar 2026, background dedupe/prune ~24h after 5+ sessions); Managed Agents "Dreaming" (API beta 2026-05-06); Letta sleep-time compute [pre-2026]. Skills as portable procedural memory (open spec). Cross-agent knowledge querying with provenance and trust tiers: no standard — bespoke (matches neurons + Paradigm notebooks).

## Gaps nobody does well
1. Deterministic merge/adjudication of parallel agent output.
2. Loop governance: progress vs thrash; budgets tied to goals.
3. Durable cross-harness agent identity + learnings.
4. Memory quality: no validation, contradiction detection, confidence decay.
5. Replay of recorded coding sessions against a new model/prompt (OTel GenAI conventions still "Development").
6. Plugin portability: demand, no shared manifest.

## Pieces of an ideal harness
Evals/replay; cost/budget governance with kill switches; OTel observability (content out of spans by default); permissions/trust (capability manifests, allowlists, signed agent cards, knowledge trust tiers); provenance/attestation; offline/local tier; sandboxes with egress policy and secret brokering; human↔agent handoff (checkpoints, explain-what-you-did, approval inboxes, local↔cloud teleport); prompt-injection defense; data lifecycle/privacy; multi-device presence (phone approvals, voice, notifications).

## Read for 8.0
Harnesses converge on plugins + skills + hooks + subagents + worktrees + MCP. Open: merging parallel work, loop governance, memory validation, cross-harness identity — which Warpline, neurons and calibration/learning loop already target.
