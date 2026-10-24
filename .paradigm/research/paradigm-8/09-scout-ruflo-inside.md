# Scout: ruflo — inside view (2026-10-15)

Shallow clone (HEAD 1882006a, 2026-10-14) read-only in scratchpad/untrusted/ruflo; nothing executed; repo agent instructions ignored. Orchestrator spot-checks: `coordination-tools.ts:324` "// Simulate sync" present; `services/global-ai-budget.ts` header confirms the #2661 cost fuse; `scripts/postinstall.cjs` rewrites a dependency's (agentdb) package.json `exports` map inside node_modules — not out-of-package; no contributor-instruction text found in current mcp-tools descriptions (grep).

## Identity
claude-flow renamed (root package.json still `claude-flow` 3.56.10; packages at v3/@claude-flow/*). MIT. ~75.2k stars, ~9,598 commits, 55 contributors, mostly rUv; real outside PRs (Rudy Celekli 231). 7.8k files, 265 MB, 276 ADRs, 33 CI workflows; CLI ~270k lines TS, 468 test files. Marketing: "the original agent harness", "agent meta-harness for Claude Code and Codex", "100+ agents, 314 MCP tools".

## Where it runs
Not its own loop. Three layers on Claude Code: an MCP server (~477 tools by grep); classic hooks written by `init` (settings-generator.ts:217-390: PreToolUse, PostToolUse, UserPromptSubmit "route", SessionStart restore, Stop, PreCompact, SubagentStop); and since 2026 Claude Code Mods (plugins/ruflo-mods, ruflo-console cockpit pane, ruflo-swarm pane; ADR-404). Plus a background daemon (services/worker-daemon.ts) scheduling map/audit/optimize/consolidate/testgaps/backup/harness workers that shell out to `claude --print --output-format json`.
- `agent_spawn` (agent-tools.ts:283-470) writes a JSON record and tells the model to use Task tool / `claude -p` / direct API. Real work = Claude Code's Task tool.
- Hive-mind queen/worker + "Raft/BFT/Quorum" (hive-mind-tools.ts:731+) = vote counting over a JSON state file. A textbook consensus library exists in v3/@claude-flow/swarm (2.5k lines) but the CLI doesn't depend on it. `.claude/agents/consensus/*.md` are prompts roleplaying protocols.

## Memory
Real: SQLite `.swarm/memory.db` (memory_entries, patterns, trajectories, sessions, vector_indexes, graph_edges), HNSW, FTS5, MMR rerank, consolidator (expiry sweep, hash + cosine-0.95 dedup, compaction; 34 tests). Embeddings: ONNX MiniLM → agentic-flow → "hash fallback" the code calls meaningless. Copy-on-write .rvf memory branches per agent.
Marketing vs code: "ReasoningBank" default = Map + array + patterns.json; "SONA self-learning / LoRA" = a signal ring buffer with LoRA config fields; no weight training seen (inferred). Federation (mTLS + ed25519, PII redaction; 15.6k lines, 27 tests) not verified end to end.

## Loops, specs, verification
SPARC = prompts; "gate checks" self-graded by the orchestrator LLM. Autopilot rides Claude Code `/loop` + ScheduleWakeup at 270 s (cache-aware). Goals = GOAP skills; missions rendered by the console. No truth score in code. Serious pieces: `v3/@claude-flow/guidance` compiles CLAUDE.md into a constitution + task-scoped ID'd rule shards, with a run ledger of objective evaluators (tests, lint, forbidden deps) and HMAC "truth anchors"; `verification/` signed witness manifest proves a fix is still present by sha256 or substring — presence, not behaviour.

## Extension
48 plugins in marketplace.json, mostly thin markdown (sparc 556 lines, autopilot 516) with a few thick (mods 6k, metaharness 8.8k, swarm 5.2k). 108 agents + 68 plugin agents, 165 skills, 168 commands. `ruflo-deepseek-harness` = DeepSeek API as skills, not a distro. Mod trust: `modTrust: observe | refuse-risky` + provenance allowlist project settings cannot set.

## Parallel work + merging
No semantic merge, no worktree-per-agent code orchestration. Worktree code only dedups daemons (workspace-lease.ts, repo-supervisor.ts elects one supervisor per repo, ai-job-dedup.ts). Isolation = in-memory COW branches; speculative exploration = best-of-N, winner promoted, losers discarded ("the memory-state analogue of git-worktree-per-agent"). `coordination_sync` is a stub (50 ms simulated sync; conflicts never incremented; "resolve" zeroes a counter). `claims` = issue claiming + work stealing; `ruflo-jujutsu` = diff risk scoring, not jj merging.

## Depth audit
- Real: MCP server + hooks installer; SQLite/HNSW memory + consolidation; Mods integration + console TUI (playwright specs); cost fuse (user-global ledger in ~/.claude-flow: ≤1 concurrent autonomous claude, 2/hour, 12/day, 429 breaker, O_EXCL lock, receipts); federation crypto (inferred); guidance compiler.
- Partial: consensus (real library, unwired); ReasoningBank/SONA (JSON pattern store); agent execution (delegated; agent_execute calls the API directly).
- Stub/marketing: "Intelligent routing (89% accuracy)" — keyword regex with hardcoded confidence 0.6 (.claude/helpers/router.cjs:72-91); coordination_sync conflict resolution; queen-led Raft/Byzantine/Gossip; SPARC quality gates.
- Honesty signal: v3/__tests__/honesty/tool-honesty.test.ts asserts no Math.random confidence, no "Simulated", no fake delays, no auto-completed steps — added because tools used to fabricate; it misses coordination_sync's simulated sleep.

## Steal
(a) user-global AI launch budget with O_EXCL lock + receipts — production evidence (#2661) that Heddle needs it day one; (b) repo-supervisor election + worktree leases so N daemons don't multiply crons; (c) mod trust tiers with a provenance allowlist project scope can't set; (d) CI honesty tests asserting tools don't fabricate; (e) guidance compiler (CLAUDE.md → ID'd rule shards + verifiers), a cousin of P8-R2; (f) /loop + ScheduleWakeup at 270 s; (g) tool descriptions phrased "Use when native Task is wrong because…" — cheap cold-agent legibility (F4).
## Avoid
Tool sprawl (477 tools); agents roleplaying distributed protocols; metrics without denominators; labels implying mechanisms that don't exist; daemons that spend money by default.
## Where Paradigm + Warpline is ahead
No semantic merge (sidesteps with winner-take-all); no spec compile with exists-AND-passes progress; no gated certification or calibration denominator; no symbol graph/ripple; identity per-swarm JSON, not one agent key.
## Impact on shapes
Ruflo's 2026 trajectory (Mod console pane + daemon + mods + metaharness) is Heddle + Shuttle shipped at breadth and shallow depth; evidence Mods can host persistent panes fed by a daemon (weakens the Shuttle falsifier; inferred: panes read daemon-written status files, not SSE). "Distro on ruflo" makes no sense: no stable kernel, daily releases, 270k-line CLI, MCP surface would drown F4. Posture: Heddle stays small (ledger, identity, scheduler, budget fuse) with at most a ruflo interop adapter (read .swarm/memory.db as external-tier knowledge). Line: "ruflo coordinates agents; Heddle adjudicates their work."

## Follow-up: the four leads, checked against today's code (scout's second report)
1. postinstall (cli/scripts/postinstall.cjs, 153 lines): copies agentdb's dist/src/* folders and adds 7 `exports` entries to agentdb's package.json. No home dir, settings or network — but it modifies a third-party dependency on install.
2. Stub audit today: agent_spawn still registration-only, but agent_execute now really calls api.anthropic.com (ADR-095 G1); workflow_execute dispatches to it and fails closed on unsupported steps. swarm_init/consensus still bookkeeping. Raft verifySignature gone; signing moved to a real ed25519 transport in the unwired swarm package. Token `+= 100` gone. Math.random only in benchmark data/ids, enforced by the honesty test. Self-audit "~195/240 real" plausible for "doesn't fabricate", not "does what the name says".
3. Hooks/daemons: UserPromptSubmit route hook console.logs recall + routing into context on every prompt (hook-handler.cjs:577-620). #2661 fixed by the budget fuse (1 concurrent, 2/hour, 12/day, 60-min 429 breaker, jsonl receipts). AI workers now opt-in (worker-daemon.ts:133-338); MCP autoStart:false (settings-generator.ts:135).
4. Model-aimed tool descriptions CONFIRMED: 235 descriptions carry steering text such as "Use when native Task is wrong because…" (agent-tools.ts:284, hive-mind-tools.ts:376, neural-tools.ts:414 "Claude Code has no learning loop") — persuasion to pull the model off native tools. (Correction: the orchestrator's earlier grep only looked for contributor-instruction text, which is absent; steering text is present.)
- Also: about 650k lines TS overall; @claude-flow/guidance ~42k lines, only optionally loaded by the CLI, so real use is unclear; copy-on-write memory branches worth stealing as cheap per-session knowledge forks.
- Positioning refined: ruflo owns "harness = breadth"; Paradigm 8 should own "harness = adjudication + contracts + falsifiers" and say plainly "we don't re-wrap Task". Budget fuse and opt-in AI workers become kernel invariants.
