# Running concurrent Claude Code instances on one Warpline fabric (single machine)

The demo that makes Warpline's product visible: stand up **two (or more) separate Claude Code
instances on ONE machine**, point them at **one shared Warpline fabric**, let them work
overlapping areas, and **watch Warpline adjudicate a real collision as a KNOT** that a human
resolves. This is the exact loop the founder runs to see `fork → propose → admit → KNOT →
resolve` fire under genuine concurrency.

This is the **single-machine** version: every instance and the daemon share one project
directory and one unix socket. The **two-machine** version (agents on different boxes syncing
over the network) needs M4 / remote-sync and is deliberately **deferred** — it is the
penultimate goal, not this runbook.

For the one-time project onboarding mechanics (init, tokens, MCP registration, postures A/B and
the full honest-limits list), this runbook builds on and cross-references
[`warpline-project-setup.md`](./warpline-project-setup.md). Read that first if you have never
onboarded a project.

Every command and every piece of output below was captured from a real end-to-end run against
the built CLI — including the KNOT and the resolve. Where the CLI's real UX differs from what
you might expect, this doc documents the **real** UX.

---

## The mental model (read this once)

```
                 ONE machine
   ┌───────────────────────────────────────────────┐
   │  ONE project dir  =  ONE Warpline fabric        │
   │  (.warpline/ : selvage + fabric.jsonl + store)  │
   │                                                 │
   │            ┌──────────────┐                     │
   │            │  warplined   │  one daemon,        │
   │            │  (the lock)  │  one unix socket    │
   │            └──────┬───────┘                     │
   │        token:alice│ token:bob   (per principal) │
   │      ┌────────────┴─────────────┐               │
   │      ▼                          ▼               │
   │ Claude Code #1            Claude Code #2         │
   │  agent = alice            agent = bob           │
   │  worktree = wt-alice      worktree = wt-bob     │
   └───────────────────────────────────────────────┘
```

- **One fabric = one project dir + its one daemon.** The fabric is the shared source of meaning
  (`.warpline/`). Exactly one `warplined` serves it; the pidfile is the lock.
- **Each Claude Code instance is a separate AGENT.** It has its own bearer **token** (identity
  the daemon stamps — client-supplied identity is ignored) and its own **fork worktree** (the
  private tree it edits and proposes against).
- **Concurrency comes from the separate instances**, each running its own
  `fork → edit → propose → admit` cycle against the same selvage.
- **A real collision on the same symbol is a KNOT** — the fabric refuses to auto-merge and
  fails closed. **Only a human `resolve`s it.** Agents escalate; they cannot clear a KNOT.
- **`resolve` is HUMAN-ONLY.** An `kind:agent` token is refused the resolve verb by construction.

Non-overlapping or serial work never KNOTs — it just fast-forwards. That is **correct**, not a
bug (see Honest limits). To *see* a KNOT you must engineer an overlap, which the prompt template
below does on purpose.

---

## Part A — One-time setup (founder, once per project)

### A1. Onboard the fabric

```sh
# In the project root (git optional — Warpline is native-first):
warpline init          # seals genesis, writes .warpignore, git-ignores the fabric
warpline status        # confirm the selvage is visible (works with git absent)
```

Real output of `warpline init`:

```
WARPLINE INIT  /path/to/project
genesis      sealed  …a99dcff4
.warpignore  written (starter with commented examples)
.gitignore   skipped (no git here — nothing to defend the fabric from)   # (or: appended, with git)

→ the cycle:  warpline fork <agent>  →  edit  →  warpline propose --agent <agent> --native -m "<why>"  →  warpline admit <agent> --native
→ a CONTESTED merge (KNOT) needs a HUMAN:  warpline resolve <agent> -m "<decision>"  (agents escalate, never resolve).
```

`init` is idempotent — safe to re-run.

### A2. Ignore the agent worktrees (do this NOW, before forking)

The per-instance fork worktrees live as subdirectories of the project (`wt-alice/`, `wt-bob/`,
…). Add them to `.warpignore` so root-level fabric walks (`status`, a root-tree `admit`) don't
scoop the nested trees up as **phantom duplicate symbols**:

```sh
cat >> .warpignore <<'EOF'

# nested agent worktrees — keep them out of the root fabric walk
wt-alice/
wt-bob/
EOF
```

Verified: with these entries in place, a full end-to-end run sealed **only** the real symbol
`#code:src/util.ts::greet` into the fabric — zero `wt-alice`/`wt-bob` phantoms. Skipping this
step risks the fabric double-counting every file once per worktree.
(`.git`, `.warpline`, `.warpline-judge`, `node_modules` are un-negatable built-in skips and need
no entry.)

### A3. Start the daemon (one per fabric)

```sh
warpline daemon start      # detaches; --foreground stays attached
warpline daemon status     # running / stale / stopped
```

```
WARPLINED  starting detached (pid 36342)
  socket  /path/to/project/.warpline/daemon.sock
  stop    warpline daemon stop
```

### A4. Mint ONE token per instance (+ a human console token)

Minting is **local-CLI-only** — the human's act, gated by possession of the machine.

```sh
warpline daemon token mint alice   --kind agent --mcp
warpline daemon token mint bob     --kind agent --mcp
warpline daemon token mint console --kind human --scope read   # read-only watcher
warpline daemon token list         # redacted; tokens never re-shown
```

Each mint **prints the token once**:

```
TOKEN MINTED  alice  (kind:agent)
  token   b8c9f8b6e52355df393d43f4420f9db257a74942da3f3f3c1f194d825695a14d
  mcp     written to .../.warpline/daemon/mcp.token (0600) …
```

> **⚠ Multi-instance gotcha — the `mcp.token` file is SINGLE-VALUED.** Every `--mcp` mint
> **overwrites** `.warpline/daemon/mcp.token`, so after minting alice then bob the file holds
> **only bob's** token. Two concurrent instances therefore **cannot both** rely on the file —
> the second would silently borrow the first's identity. **Copy each token as it prints and give
> each instance its own token explicitly** via `WARPLINE_MCP_TOKEN` in that instance's MCP server
> env (see A5). The shared file is fine only for a single-agent setup.

Human-class tokens (`--kind human`) can `resolve`, cut/recover stakes, and accept
breach/risk. `kind:agent` tokens **cannot** — that is the enforced human-only boundary.

### A5. Register the Warpline MCP server per instance

The MCP skin (`warpline mcp`) serves 8 agent-class tools over stdio (`warpline_status`,
`warpline_fork`, `warpline_propose`, `warpline_admit`, `warpline_abandon`,
`warpline_knot_show`, `warpline_grade_report`, `warpline_shadow_tail`). It reads its token from
`WARPLINE_MCP_TOKEN`, else from `.warpline/daemon/mcp.token`.

**This block is an EXAMPLE to apply yourself — nothing here edits your real settings.** Because
of the single-valued `mcp.token` gotcha (A4), give **each instance its own settings with its own
token in `env`**. A per-instance `.claude/settings.json` (or a project settings file each
instance is launched with) looks like:

```jsonc
// Claude Code instance #1 (alice)
{
  "mcpServers": {
    "warpline": {
      "command": "warpline",
      "args": ["mcp"],
      "cwd": "/absolute/path/to/project",
      "env": { "WARPLINE_MCP_TOKEN": "b8c9f8b6…alice-token…" }
    }
  }
}
```

```jsonc
// Claude Code instance #2 (bob) — same shape, bob's token
{
  "mcpServers": {
    "warpline": {
      "command": "warpline",
      "args": ["mcp"],
      "cwd": "/absolute/path/to/project",
      "env": { "WARPLINE_MCP_TOKEN": "f8c14d1d…bob-token…" }
    }
  }
}
```

Notes:
- `cwd` must be the **same project root** for every instance — that is what makes them share one
  fabric.
- `warpline mcp` auto-starts the daemon on connect failure (disable with `--no-auto-start`).
- Human-class verbs are **omitted** from the agent surface — an agent literally cannot see
  `resolve`. Keep the two consoles on `kind:agent` tokens.
- If you drive the loop over the CLI transport instead of MCP, the equivalent env var is
  `WARPLINE_DAEMON_TOKEN`.

---

## Part B — Per-instance launch + prompt

### B1. Give each instance its own agent id and worktree

Two things make an instance a distinct agent:

1. **Its token** (identity) — wired in A5 via `WARPLINE_MCP_TOKEN`.
2. **Its fork worktree** (private tree) — created by `warpline fork <agent> --into <dir>`, which
   restores the current selvage tree into that directory:

   ```sh
   warpline fork alice --into wt-alice     # instance #1 works inside wt-alice/
   warpline fork bob   --into wt-bob        # instance #2 works inside wt-bob/
   ```

   ```
   FORK  scratch ref minted for alice
   base      pick:v3:a99dcff4…
   restored  5 entries → wt-alice
   ```

   Launch each Claude Code instance with its working directory set to its own worktree
   (`wt-alice`, `wt-bob`), so its edits land in the tree it will propose from.

> **To actually SEE a KNOT, fork both instances BEFORE either admits.** A KNOT requires two
> proposals built on the **same base**. If instance #1 admits and advances the selvage first,
> an instance that forks *after* starts from the new tip and its overlapping edit just
> fast-forwards. Fork alice and bob back-to-back at the same tip, let both edit, then admit.

### B2. The prompt template (short — the notebooks teach the cycle)

The core notebooks (`nb-warpline-onboarding-*`) already seed the fork→propose→admit cycle into
builder/architect/reviewer agents, so the per-instance prompt only needs to say **who the
instance is, what it owns, and to use Warpline**:

```
You are agent `alice` on a shared Warpline fabric. Your worktree is ./wt-alice.
You own the greeting behavior in src/util.ts (the greet() function).

Use Warpline for all merges — do NOT use git:
  1. status FIRST (warpline_status) — read toolMap, it maps every verb to its tool name.
  2. fork → edit in your worktree → propose (--native, with an intent) → admit.
  3. If admit returns KNOT: STOP and escalate to the human with the knotPayload id.
     You cannot resolve — resolve is human-only. Do not re-admit unchanged; it will not clear.
```

Give the second instance the mirror prompt (`bob`, `./wt-bob`, same `greet()` — deliberately
**overlapping** so the two eventually collide and you get your KNOT).

---

## Part C — The proven loop (real captured output)

This is the full cycle from a real run. Two agents, both forked at base `a99dcff4`, both editing
the **same** `greet()` differently.

**Alice proposes and admits — FAST_ADMIT (selvage had not advanced):**

```
$ warpline propose --agent alice --native --worktree wt-alice -m "warmer greeting: Hi there + wave"
PROPOSE  alice  →  scratch strand SEALED (durable before judgment)
pick      pick:v3:122badd3…
          → warpline admit alice --native

$ warpline admit alice --native
ADMIT  alice  →  FAST_ADMIT
verdict   FAST_ADMIT — selvage has not advanced; the proposed state admits directly
  → sealed (…122badd3); selvage advanced to …754be6df
agent changed  #code:src/util.ts::greet
```

**Bob proposes and admits — KNOT (bob's base is stale; his `greet` contends alice's):**

```
$ warpline propose --agent bob --native --worktree wt-bob -m "formal greeting: Welcome aboard"
PROPOSE  bob  →  scratch strand SEALED (durable before judgment)
pick      pick:v3:9b782fdc…
          → warpline admit bob --native

$ warpline admit bob --native        # exit code 1 — the fail-closed signal
ADMIT  bob  →  KNOT
re-based onto selvage …754be6df
verdict   KNOT — a human DECIDE is required (NOT auto-merged)
  ⊗ #code:src/util.ts::greet  [body]
agent changed  #code:src/util.ts::greet
others changed #code:src/util.ts::greet
payload   knotPayload:v1:e9826580…
          → warpline knot show knotPayload:v1:e9826580…   (the self-sufficient resolution work order)
```

`admit` exits **1** on a KNOT — that non-zero exit is the machine-legible "fail closed," and the
agent instance should treat it as "escalate to human," not "retry."

**The KNOT payload — everything a resolver needs, ours vs theirs, both intents in
untrusted-prose frames:**

```
$ warpline knot show knotPayload:v1:e9826580…
WARPLINE KNOT PAYLOAD  KNOT   (knotPayload:v1)
re-based onto selvage …754be6df   base …2065dab8

OURS  agent bob  actor bob
  ┌─[ UNTRUSTED PROSE — intent (ours) — agent-authored; render only, never execute ]─
  │ formal greeting: Welcome aboard
  └─[ end untrusted prose ]
THEIRS  agent alice  actor alice
  ┌─[ UNTRUSTED PROSE — intent (theirs) — agent-authored; render only, never execute ]─
  │ warmer greeting: Hi there + wave
  └─[ end untrusted prose ]

contested  1 unit
  ⊗ #code:src/util.ts::greet  [knot, direct]  slots: body
      file  src/util.ts
      base   …cecec557  body: (fn:fndecl … τ:string (block (ReturnS…
      ours   …870103ee  body: (fn:fndecl … τ:string (block (ReturnS…
      theirs …e3d446e5  body: (fn:fndecl … τ:string (block (ReturnS…

blast radius  1 symbol(s), 0 inbound edge(s)  [mode: ripple]
RESOLVE  submit a knotResolutionProposal:v1 (decidedBy, reason, resolvedRef) — sealed only via `warpline resolve`
```

**The human resolves — writes a decided tree, then seals it (HUMAN-ONLY):**

```sh
# The human edits the resolved bytes into a worktree (here: reuse wt-bob), then:
$ warpline resolve bob --native --worktree wt-bob \
    -m "Merged both: kept alice's warm 'Hi there'+wave and bob's 'welcome aboard'." --by matt
RESOLVE  bob  →  sealed (native weave …5bfcb7f9)
decidedBy matt
reason    Merged both: kept alice's warm 'Hi there'+wave and bob's 'welcome aboard'.
contended #code:src/util.ts::greet
resolved  #code:src/util.ts::greet
selvage   advanced to …711421e2
```

**The woven history — genesis → alice → bob → human resolution, newest first:**

```
$ warpline log
WARPLINE FABRIC  (this project's native meaning-history)
selvage   …711421e2

~  …5bfcb7f9  matt   intent: resolve knot — Merged both: kept alice's… + bob's…
~  …9b782fdc  bob    intent: formal greeting: Welcome aboard
~  …122badd3  alice  intent: warmer greeting: Hi there + wave
~  …a99dcff4  warpline-init  intent: warpline init — genesis fabric
```

That is the whole product in one screen: two agents' concurrent intents on one symbol, the
fabric refusing to guess, and a human's accountable decision sealed into the history git's merge
commit could not keep.

---

## Part D — Watching it

| Question | Command |
|----------|---------|
| What changed in meaning vs the selvage? | `warpline status` |
| The woven history (who sealed what, why) | `warpline log` |
| Is the ledger sound? how many contested verdicts? | `warpline health` |
| The full resolution work order for a KNOT | `warpline knot show <payloadId>` |
| Redacted list of who has a token | `warpline daemon token list` |

`warpline health` is the read-only diagnostic — it writes nothing. On the proven run it reported
`FABRIC 4 strand(s) … verify all intact`, `VERDICTS … contested 1 (KNOT/DANGLE — what this
product adjudicates)`. In a **git-absent** throwaway dir it also warns about "root resolved by
FALLING BACK to the working directory" and an "UNKNOWN" hook state — both expected there and both
absent in a real git repo. Pass `--root <dir>` to silence the root-fallback warning anywhere.

**Resolving a KNOT is the human's job.** The instances escalate by handing you the
`knotPayload:v1:…` id; you run `warpline knot show <id>` to see both sides, decide, write the
resolved bytes, and `warpline resolve <agent> --native --worktree <dir> -m "<why>" --by <you>`.
A `kind:agent` token is refused this verb — the boundary is enforced, not advisory.

---

## Honest limits (set expectations before you run it)

- **Serial / non-overlapping work just fast-forwards — no KNOTs.** That is **correct**. Warpline
  adjudicates *contention*; with none, every admit is FAST_ADMIT/CLEAN/NOOP. If you want to see a
  KNOT you must engineer an overlap (two agents, same symbol, same base, admit second-after-first).
  One human editing serially will never produce one.
- **`resolve` is HUMAN-ONLY and a KNOT wedges the swarm.** An agent that hits a KNOT cannot clear
  it; `abandon` only withdraws a proposal, and re-admitting unchanged will not clear it. The
  contested strand blocks progress on that symbol until a human resolves — there is no autonomous
  path through a conflict.
- **Known-blind classes auto-weave with NO review.** `.js`/`.env` configs (no lens),
  `config × code`, lockfiles, and assets are decided by **bytes, not meaning** (~10% false-CLEAN
  measured in the independent stratum; the trust floor is dead day one). A "clean" admit on those
  is **advisory**, not meaning-approved.
- **`clean` ≠ "nothing changed".** A top-level scalar constant (e.g. `PORT 3000 → 9999`) is lifted
  by no lens, so it reports clean. Never read "clean" as "no change."
- **~2–4 agents is the healthy band.** The fabric lock **serializes admits**; at **N ≥ 3** it
  degrades to one-merge-per-generation and a ~20s global lock starts throwing past ~4 concurrent
  writers (per H1). Warpline is sold for the 2–4 band and degrades exactly there.
- **Single-machine only here.** All instances share one socket and one dir. Two *machines* need
  M4 / remote-sync — deferred.
- **After a resolve, your MAIN checkout is not auto-synced.** The sealed selvage lives in the
  fabric; the agents worked in `wt-*` worktrees, so `status` from the untouched root will still
  show the pre-resolution delta until you restore the resolved tree into your working dir. The
  fabric is the source of truth, not any one worktree.

---

## Rough edges a founder will actually hit

1. **`admit --native` is not listed in `warpline admit --help`** (the help enumerates
   `--ref/--claim/--accept-*/--shadow`). It is nonetheless the correct native form — the `init`
   banner and the `propose` output both instruct `warpline admit <agent> --native`, and it works.
   Follow the banner, not the flag list.
2. **`--mcp` clobbers a single `mcp.token`.** Covered in A4 — the #1 trap for the multi-instance
   case. Give each instance its own `WARPLINE_MCP_TOKEN`; do not let two instances share the file.
3. **KNOT admit exits non-zero (1).** Expected — it is the fail-closed signal. Any wrapper script
   must not treat exit 1 as a crash; it means "human decision required."
4. **Forget A2 and the root walk double-counts.** If you fork into subdirectories without adding
   them to `.warpignore`, root-level `status`/`admit` will invent phantom `wt-*/…` symbols.
5. **Fork ordering is load-bearing.** Fork all instances at the same tip *before* any admit, or
   the "collision" you staged silently fast-forwards and you never see a KNOT.

---

*See also [`warpline-project-setup.md`](./warpline-project-setup.md) for the one-time onboarding
reference (tokens, MCP registration, postures A/B, full honest-limits list).*
