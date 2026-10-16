# Scout: ruflo — outside view (2026-10-15)

gh API, npm metadata, web search; repo files not read. [unverified] = single secondary source. Neurons capture: s:web-c289dc3d99.

## Lineage
- Rename, not fork: `ruvnet/claude-flow` resolves to `ruvnet/ruflo` (created 2025-06-02, MIT). Renamed ~v3.5.0, Jan/Feb 2026, reportedly trademark [unverified]. Old name persists: `@claude-flow/*` scope, `.claude-flow/` dir.
- npm (all 3.56.10, one maintainer), weekly Oct 6–12: `@claude-flow/cli` 94.8k, `ruflo` 68.5k (thin wrapper over the cli), `claude-flow` 15.7k (overlapping).
- Extreme cadence: 866 versions in 16 months; ~20 GitHub releases Oct 2–14; alpha and latest tags on the same build.

## Adoption
75.2k stars, 8.9k forks, 1,055 open issues, pushed 2026-10-15. Effectively one author: ruvnet 8,359 commits vs #2 at 303, #3 the claude bot at 80. ~540 of ~2,015 issues by ruvnet, many automated "[verification]"/"Dream Cycle" bot reports. Users allege bought/bot stars (#958) [unverified, opinion].

## What users report
- Doesn't do real work: #958 "Still can't figure out how to get v3 to actually perform work" (open; "AI slop").
- Token burn: #1330 millions of tokens in 30 min; #2661 (maintainer P0) one autonomous daemon per worktree × 3 workers can exhaust Claude quota.
- Install/uninstall: #670, #710 "like a virus" — .swarm/ SQLite keeps updating after uninstall, .claude/settings.json modified, 45k lines injected; `ruflo cleanup` only since v3.5.40.
- Bugs: ONNX model download on every cold start (`--version` >60s, #2286/#2905); daemon dies on Windows Node 25 (#1478); receipt ledger grows until all MCP tools time out (#3164, open); signed-build "witness" verification failing (#3189, #2970, #2904).

## Independent reviews
- roman-rr audit of v3.5.51 (Apr 2026, source + ~11 tools hands-on) https://gist.github.com/roman-rr/ed603b676af019b8740423d2bb8e4bf6 : ~97% of 300+ MCP tools stubs/state records (agent_spawn, swarm_init, consensus, neural_train, workflow_execute); Raft verifySignature() returns true; "352x faster" vs literal sleep(352); token savings hardcoded += 100; router latency Math.random(). Real: memory/HNSW store, embeddings, terminal execution, session save/restore.
- Vendor self-audit (May 3) claims ~195/~240 tools real after fixes in 3.6.14–3.6.22 [unverified].
- SWE-bench "84.8%" only in vendor-leaning guides; issue #610 is a template with "Testing..." placeholders. No reproduction [unverified]. "~250% subscription capacity", "30–50% token reduction", "100k MAU" self-reported only.

## Security / trust
- CVE-2026-59726 / GHSA-c4hm-4h84-2cf3 (critical): unauthenticated RCE + API-key exposure in default docker-compose MCP bridge; fixed 3.16.3.
- Audit #1375: obfuscated preinstall (3.1.0-alpha.55 → 3.5.2) silently deleted claude-flow/ruflo entries from ~/.npm/_npx and _cacache; maintainer confirmed, removed in 3.5.40. SQL injection open ~2 months. npx in SafeExecutor allowlist. Community security PR #1292 closed and partly reimplemented; maintainer later apologised.
- Alleged hidden prompt injection in MCP tool descriptions telling Claude to add the owner as contributor (#1323, now 404); maintainer denies; a disclosure claims lines "still there" [unverified].
- `@claude-flow/cli@3.56.10` still has `postinstall: node ./scripts/postinstall.cjs`.
- Large dependency surface (nostr-tools, @napi-rs/keyring, @agntcy/slim-bindings alpha, agentic-flow alpha, four @metaharness/*, express/ws). Socket scan Aug 2026: 70 alerts on one skill module, no exfiltration evidence.

## Positioning
Heavier "meta-harness" over Claude Code + Codex: queen-led hierarchy, 100+ agent types, 4 topologies, consensus, "self-learning". Native subagents/Agent Teams seen as simpler and cheaper; Ruflo credited with more parallelism at higher spend. Conductor/Vibe Kanban seen as a different category (visible worktree isolation). Experienced users in #958 recommend plain Claude Code skills/agents or linear slash-command pipelines with quality gates.

## Read
- Durable: demand is real (~180k weekly installs, 75k stars) for a persistent multi-agent, memory-bearing layer over Claude Code/Codex. Its working core (vector memory, session save/restore, hook injection, skill packaging) is what Paradigm already does with more rigour.
- Hype: consensus, neural training, 352x, SWE-bench — theatre per independent audit. Opening for deterministic, measured claims.
- Warning: autonomous daemons, per-prompt context injection and silent fan-out cause the top user pain (token burn, quota exhaustion). Ambient automation without cost limits or visibility destroys trust.
- Trust is the weak point (out-of-package install effects, uninstall persistence, RCE CVE, single maintainer, alpha=latest). Installability, reversibility (clean uninstall) and a small permission surface are differentiators.
- Copy distribution: dual package names, one-command npx onboarding, marketplace presence, multi-host support. Skip release/agent-type volume.
