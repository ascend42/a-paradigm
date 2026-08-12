# Warpline project setup (founder runbook)

One-time setup to put a project on Warpline — the meaning-merge **adjudication** layer
(`fork → propose → admit → KNOT → resolve`). This is the human's setup runbook; the
agent-facing behavior is seeded into the core notebooks (builder / architect / reviewer)
as `nb-warpline-onboarding-*`, so a Paradigm-driven agent is warm by construction
(TD-2026-08-11-351). This doc is what the notebook points to for the parts an agent cannot do.

All commands assume `@a-company/warpline` is built and the `warpline` bin is on PATH
(`npm run build && npm link` in `packages/warpline/`, or set `WARPLINE_BIN` to the built
`dist/cli.js`).

---

## 1. Bootstrap the fabric

One command sets everything up:

```sh
# In the project root:
warpline init                # seals genesis, writes .warpignore, git-ignores the fabric
warpline status              # confirm you can see the selvage (works with git absent)
```

`warpline init` seals a genesis strand via the native path, writes a starter `.warpignore`
(Warpline's own ignore file — its handler governs skips with git absent), and, when a `.git`
is present, appends `.warpline/` and `.warpline-judge/` to `.gitignore` so `git add -A` never
swallows the ledger. It is idempotent — re-running on an initialized project is safe. In a
pure-native (no git) project it skips the `.gitignore` step (nothing to defend the fabric from).

Ignores are governed by `.warpignore` (not `.gitignore`): gitignore-style globs, `!` negation,
and built-in un-negatable defaults (`.git`, `.warpline`, `.warpline-judge`, `node_modules`). A
legacy `.warplineignore` is still read as a deprecated alias when no `.warpignore` is present.

---

## 2. Start the daemon (native adjudication mode)

The daemon (`warplined`) is the network face of the fabric — NDJSON over a unix socket
(`.warpline/daemon.sock`, `0600`). Exactly one per fabric; the pidfile is the lock.

```sh
warpline daemon start        # detaches to background; --foreground stays attached
warpline daemon status       # running / stale / stopped
warpline daemon stop         # SIGTERM the holder, clean stale residue
```

---

## 3. Mint one token per agent

Identity is per-principal bearer tokens. **Minting is local-CLI-only** — the human's act,
gated by possession of the machine (anti-sockpuppet). The daemon derives `agentId` FROM the
token; client-supplied identity is ignored. `kind:agent` principals **cannot** resolve knots,
cut/recover stakes, or accept-breach/accept-risk — those are human-class only.

```sh
# One writer token per agent worktree. --mcp also writes the bare token to
# .warpline/daemon/mcp.token (0600) — the ONLY file source the MCP skin reads.
warpline daemon token mint builder  --kind agent --mcp
warpline daemon token mint reviewer --kind agent --mcp

# The read-only "console" class (status, refs.list, knot.show, grade.report, shadow.tail):
warpline daemon token mint console --kind human --scope read

warpline daemon token list   # redacted — tokens are never re-shown
```

The token **prints once**. Hand it to the agent worktree via env
(`WARPLINE_DAEMON_TOKEN` for the CLI transport, `WARPLINE_MCP_TOKEN` for the MCP skin),
**never commit it**. There is no revocation ceremony at stage 1 — rotating means minting anew;
old rows stay valid.

---

## 4. Register the Warpline MCP server (the agent's surface)

The MCP skin (`warpline mcp`) serves 8 agent-class tools over stdio from the canonical
descriptors, results are engine shapes verbatim, and every refusing verdict rides a
machine-readable `refusal`. It reads its token from `WARPLINE_MCP_TOKEN`, else from
`.warpline/daemon/mcp.token`.

Register it in your Claude Code settings. **This is an EXAMPLE for you to apply — the founder
owns their env registration; nothing here edits your settings for you.** Add a `warpline`
entry under `mcpServers` (adjust `cwd` to the project root):

```json
{
  "mcpServers": {
    "warpline": {
      "command": "warpline",
      "args": ["mcp"],
      "cwd": "/absolute/path/to/your/project"
    }
  }
}
```

Notes:
- The token comes from `.warpline/daemon/mcp.token` (written by `--mcp` in step 3), so no
  secret needs to live in `settings.json`. To override, add `"env": { "WARPLINE_MCP_TOKEN": "…" }`.
- `warpline mcp` auto-starts the daemon on connect failure (disable with `--no-auto-start`).
- Human-class tools are **omitted** from the surface unless you launch with `--operator` AND
  the discovered token verifies `kind:human`. Keep agents on agent-kind tokens.

Once registered, the agent tools appear as `warpline_status`, `warpline_fork`,
`warpline_propose`, `warpline_admit`, `warpline_abandon`, `warpline_knot_show`,
`warpline_grade_report`, `warpline_shadow_tail`. An agent calls `warpline_status` first and
reads `toolMap` from the result to translate any verb → its tool name mechanically.

---

## 5. Two agent postures — pick one

### (A) Git-native mirror mode (most git-like)
Git stays the source of truth; Warpline rides alongside as the **meaning lens**. Install the
auto-seal hook so meaning is sealed on commit:

```sh
warpline hook install        # requires WARPLINE_BIN set / warpline globally installed
```

Agents use git normally (branch / commit / merge); Warpline adds `status` / `log` / `lifeline`
/ `weave` / `oracle` as the meaning view. Lowest friction, but **git is still load-bearing** —
this is additive overhead, not a replacement.

### (B) Native adjudication (the product — for a swarm)
Daemon + per-agent tokens (steps 2-3) + MCP surface (step 4). Agents run
`fork → propose → admit` through the MCP tools; the human resolves KNOTs. This is where the
adjudication actually fires — **only under real concurrency**. Serial solo work produces zero
contention, so every admit is FAST_ADMIT/NOOP and Warpline is pure friction over the git it
cannot yet replace. Use posture B only when 2-4 agents write concurrently.

---

## Honest limits (tell the agents; do not paper over these)

- **`resolve` is HUMAN-ONLY.** An agent that hits a KNOT cannot clear it. `abandon` concedes
  the contest (withdraws the proposal); it does not resolve it. Re-admitting unchanged will not
  clear a KNOT. A KNOT **wedges the swarm** until the human resolves — there is no autonomous
  path through a conflict.
- **Known-blind classes auto-weave.** `.js`/`.env` configs (no lens), `config × code`
  (config-lens references are empty), lockfiles, and assets are decided by **bytes, not
  meaning**. ~10% false-CLEAN was measured in the independent stratum, and the trust floor is
  dead day one (no grading history). Treat **independent CLEANs on config × code as
  byte-decided**, not meaning-approved — the `status`/`admit` "clean" is advisory there.
- **`clean` ≠ "nothing changed".** A top-level scalar constant (e.g. `PORT 3000 → 9999`) is not
  lifted by any lens, so the change is invisible to meaning and reports clean. Never read
  "clean" as "no change."
- **No branching / feature isolation yet** — single linear selvage, one in-flight proposal per
  agent, no switch/checkout.
- **N≥3 concurrency degrades** — serializes to one-merge-per-generation; a 20s global lock
  throws past ~4 writers. It is sold for the 2-4 band and degrades exactly there.
- **Mirror mode keeps git load-bearing** — additive overhead plus a fail-closed cache-loss risk.

---

*Scope: this is the MINIMUM warm-start. The full LP-warpline university course
(T-2026-06-27-004) and the broader teaching refresh (T-2026-08-11-020) remain separate.*
