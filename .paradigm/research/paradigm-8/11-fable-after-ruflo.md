# Fable — ruflo re-read of the shapes (2026-10-15)

Read 05, 06, 08, 09; spot-checked the clone read-only (Mods feed path, cost fuse, honesty test, mod trust).

## Shapes
ruflo IS Heddle + Shuttle at breadth, shallow depth, and proves Shuttle can't stand alone: every pane reads a daemon-written status file (`.claude-flow/protector-mod/status.json`, `console/attention.json`, `mods/session.json`). C is A's display layer — merge it. Bolt weakened, not killed: dsh belongs behind the backend-adapter interface.
Revised Board 1 (Fable):
- A Heddle (recommended): kernel daemon = ledger + identity + scheduler + budget fuse; the Claude Code Mod band ("Shuttle") is its display seam, fed first by daemon-written status files (ruflo's proven path), SSE later.
- A0 Shuttle-first staging: hooks + status files + Mod band week one, daemon week two (sequencing, not a separate option).
- B Bolt demoted: dsh is one backend adapter inside A.
- D Loom, named to be rejected: breadth-first meta-harness (300+ tools, 100 agents, consensus prompts) — ruflo's lane; users report it doesn't do work (#958).

## Laws Heddle adopts (production-evidenced by ruflo)
1. No spawn without a permit: user-global launch budget (O_EXCL lock, receipts, 429 breaker) + per-session USD cap, both ON by default; the band shows every live child and its spend; fan-out never silent.
2. Honesty is CI: every number ships with a denominator or doesn't ship; tests grep for Math.random, "simulated", hardcoded gains; no label implies a mechanism the code lacks (no "consensus", no "neural").
3. Tiny ABI: at most ~12 kernel verbs; everything else via `status` self-description (F4). Tool count is a legibility budget.
4. Reversible by construction: one repo dir + one home dir, manifest-generated settings edits, `heddle uninstall` leaves `~/.claude` and the repo byte-identical; daemon exits when its last client leaves. Falsifier: non-empty diff after install→uninstall.
5. Nothing spends by default: scheduler jobs are log-derived timers gated on attended events or explicit opt-in; N worktrees never equal N crons.
6. Trust posture: no postinstall scripts, pinned deps, releases that verify, alpha never latest.
Paradigm already has one ruflo disease: the notebook popularity loop (384/396 at appliedCount 0). Loid's injected/credited split must ship in 8.0.

## Positioning + interop
"ruflo coordinates agents and counts their votes; Heddle adjudicates their work: one ledger, one identity, one budget, and every merge judged by tests and meaning, fail-closed."
Interop: yes, cheap and read-only, after `knowledge.query` exists — a provider reading `.swarm/memory.db` as T3 external knowledge, pinned to a schema hash, fail-closed on drift. "Bring your memory, we audit it" is the migration story.

## Moves (revised)
1. One runner WITH the fuse: extract constellation's driver into `packages/heddle`; every `claude -p` needs a budget permit; receipts in the ledger. Pass: flow + constellation on one path AND a deliberate 5-session fan-out stopped by the fuse with receipts.
2. Unchanged: `spawn 4` against one compiled contract; first KNOT, hydrated, zero W3.
3. Mod band fed by daemon-written status files + logged injections. Pass: replay reproduces context AND install→uninstall diff is empty.
Names: Heddle stays; Shuttle = the Mod band's name. Strike swarm/hive/queen vocabulary — it now signals theatre.

## Tensions with Arky
1. Kernel log: CONCEDE (ruflo's receipt ledger grew until every MCP tool timed out, #3164). One envelope + `ref.foreign`; fabric stays judgment-only.
2. Warpline teaching at spawn: CONCEDE with amendment — the one pointer line is itself a logged strand.
3. Session id: CONCEDE — kernel `hsid`, Claude uuid as attribute; `hsid` derivable from env in a hook so interactive sessions register without the daemon.
4. Conductor runner: HOLD on delete (Arky has since conceded the same): Conductor becomes a socket client; no Swift runner.

## Net result
All four Fable–Arky tensions are now converged. One new micro-tension: display feed — Fable says daemon-written status files first (ruflo's proven path), Arky says authenticated socket events, not files (ruflo's own README calls its files unauthenticated).
