# Gnomon — Paradigm 8.0 build spec (the kernel beneath Claude Code)

Status: BUILD SPEC v2, ratified inputs + two reviews applied, not yet built. Decision TD-2026-10-16-950 (the ten rulings) · founder rulings P8-D12..D15 (lore L-2026-10-16) · Atelier session `.atelier/sessions/2026-10-15-paradigm-8-spec/session.yaml` · Research `.paradigm/research/paradigm-8/00–15` (14 = Aegis security review, 15 = Arky architecture review).
Package: `packages/gnomon` (`@a-company/gnomon`) + `packages/gnomon-contracts` (`@a-company/gnomon-contracts`). Branch `ideate/paradigm-8` → `feat/gnomon`.
Reads with: `warpline-v3-identity.md` (DAG identity, refs CAS), `warpline-fabric-schema-v2.md` (pickId preimage), `warpline-engine.md` (verdict semantics), `warpline-forge.md` G1–G5.
Audience: 8.0 is for the founder (dog-fooded on real repos, iterated live); 8.1 is for the world (P8-D1). Every "8.1" is deliberately out of this build.

This document is itself a contract source (§7, P8-R2 dog-food): every component, flow, gate, signal and aspect named here as a whole code span with its symbol prefix is a node the compiler (§7.1) must extract, and every node carries an oracle (a test id in §15, or an explicit `exists` declaration). A node without an oracle is a compile refusal — if this spec does not compile, the spec is wrong, not the compiler. Appendix A is the hand-written expectation; honesty test `G-HON-01` is that the compiler reproduces it.

Vocabulary rule (TD-950 §1, 11-fable-after-ruflo.md "Names"): no swarm, hive, queen, consensus or neural in code, docs, tool names or events. Collective noun **armada**; a running session is a **session**; a spawned set is a **fleet**. Labels never imply a mechanism the code lacks (law 2, §10).

---

## 0. Changes in v2 (compile: skip)

Finding ids: `A-` = Arky (15-arky-spec-review.md), `S-` = Aegis (14-aegis-spec-review.md), `D` = founder ruling.

| Id | What changed |
|---|---|
| A-boundary-1 / D14 | Kernel never mints Warpline keys or daemon tokens. Warpline principal = a stable roster agent whose key + token the founder mints once; sessions borrow the credential; session→strand link is `causes[]` (§3.1 I1, §6.2 duty 1). Restores I1 and keeps the registry finite. |
| A-boundary-2 | `contract.compile` is gone from the ABI; compile stays in `paradigm pipeline plan`; the kernel verb is `contract.register{contract}` (schema, hash, non-empty oracles). Still 12 verbs (§5). |
| A-boundary-3 | Admission oracle runs `admit {shadow:true}` (`protocol.ts:43` admitNative \| shadowAdmit); the real admit runs only after `^certified` (§7.3). |
| A-boundary-4 / A-OPEN-13 | `refusal:v1` in gnomon-contracts is a superset schema with `verdict` and `contested[].rule` as opaque strings; Warpline's is the subset; no re-export, no engine types in kernel contracts (§4.6). |
| A-schema-hash | Envelope hash = sha256(canonical(envelope minus `hash`,`sig`)); `seq` assigned inside the write transaction, never AUTOINCREMENT (§3.2, §4.1). |
| A-schema-ref | One `ref:v1` string + optional `refHash`, allowed alongside `payload`; the three foreign-ref shapes collapsed (§4.1). |
| A-schema-env | `schemaVersion:'event:v1'`; `connId`; `idem` idempotency key; `repo` id from the root commit, not the realpath (§4.1). |
| A-hsid / S-M1 | Derived hsid keyed on principalId, distinct `hsid:v1d:` form, accepted only from that principal's key, first registration wins; hooks read `session_id` from stdin JSON (§4.2). |
| A-contract-ids | Nodes keyed by ref (`node:<ref>`), contract hash ordinal-free; no ordinals (§4.7). |
| A-manifest | `trust:` removed from the manifest (grant table only); hook events additive; JSON-RPC codes for every refusal code; `CAS_LOST` replaces the overloaded STALE_BASE for lost claims (§4.3, §4.6, §4.9, §7.4). |
| A-ABI-matrix / S-M2 / S-M3 | Kernel-owned namespaces appendable by no principal; `log.append` kinds bound by signed grants; interactive `session.open{derived}` needs no spawn permit; card/decision enums fixed; next-verb rules extended; read-token column + one total redaction matrix (§5, §9.3). |
| A-warplined | Kernel is a re-derived `warplined:v1` NDJSON client; may activate warplined, never mint; selvage moves by `fs.watch` on `refs/heads/selvage` (no polling), `refs.watch` requested from Warpline; revisit trigger stated (§6.2). |
| A-migration-1 | "Broker unreachable ⇒ deny" scoped to kernel-spawned sessions; 7.x interactive sessions unchanged (§3.4). |
| A-migration-2 | Conductor runner deletion moved to M3.6 alongside `GnomonClient.swift` (§13.4, §15). |
| A-migration-3 | Client-supplied injects allowed and logged; only kernel-added bytes are capped at one line (§3.3, §6.2). |
| A-migration-4 | Hook generation subsumes `packages/paradigm/scripts/generate-hooks.mjs`; manifests generate JSON data, not TS (§13.1). |
| A-migration-5 / S-C4 | `.gnomon/project.yaml` is committed and read from the base revision; only `.gnomon/worktrees/` and `.gnomon/sessions/` are ignored; gate-class diffs → human card (§6.3, §12.7). |
| A-delivery | Mod-socket spike is M1.0 against a stub socket on day 1; new M1.12 clients; policy generation (M1.5) precedes the runner (M1.6); field metrics moved to §16 telemetry; `G-RUN-04` restated as transcript-replay parity (§15). |
| A-G-HON-01 | Compile rules tightened (whole code spans only, fences and `(compile: skip)` sections excluded, test-id regex with suffix, `..` ranges expanded); prose that used generic prefixed spans rewritten; Appendix A regenerated with first-appearance sections and ref-keyed nodes (§7.1, Appendix A). |
| A-citations | Fixed: `STAGE_ORDER` is `core/pipeline-types.ts:67` (imported `pipeline/index.ts:16`); `FAMILY_META` is `families.ts:55-92`; the two runners share a core argv but differ in extras (`agents.ts:447-452`); `validRegistryRow` is `keys.ts:309-330`. |
| A-OPEN-2,4,5,6,7,10,11,12 | Answered in place; removed from §17. |
| S-C1 / D12 | Human signing stays key file + CLI for founder-only 8.0 — ACCEPTED RISK (§A.1) with every zero-UX-cost mitigation: root-signed registry/grants, kernel-owned namespaces, mandatory signatures, per-approval signature, anchored chain head, missing-db rule, advisory deny rules, agent-shell refusal on human CLI verbs. Guard tests restated to claim only what they test (§10, §12). |
| S-C2 | Human root key signs every registry and grants row; unsigned rows refused; "latest row wins" only among root-signed rows (§3.1). |
| S-C3 / D13 | Oracles (and the reviewer) run under a macOS `sandbox-exec` profile first, rootless containers later — ACCEPTED RISK (§A.2); new task M1.11 before the fan-out test (§7.3, §12.5, §15). |
| S-H1 | Mandatory signatures on `approval.*`, `oracle.result`, `budget.*`, permits; chain head anchored outside the db; missing db with keys present = INTEGRITY_BROKEN; `log verify` checks signatures (§3.2). |
| S-H2 | Per-message usage metering from stream-json, pgid kill on breach, respawns charged as launches, signed `config.yaml`, `GNOMON_HOME` ignored by the production binary; unmetered paths stated honestly (§3.4). |
| S-H3 | Daemon re-execs with a fixed clean env on activation; `claude` path from signed config (§2.4). |
| S-H4 | Mutual auth: client signs nonce‖serverKeyId‖principalId‖socket realpath, server proves its key; `~/.gnomon` 0700; Linux fallback under `$XDG_RUNTIME_DIR`, never `/tmp` (§4.9). |
| S-H5 | Deny list adds the Warpline token files; CLI `env -u` bypass stated; `G-SPN-06`/"zero W3" restated as skin-scoped; Warpline asked to serve `resolve` to keyed principals only (§6.2, §17). |
| S-H6 / D15 | Reviewer: subscription `claude -p`, one turn, no tools, diff enveloped untrusted, strict verdict schema, spec section from base revision, sandboxed, roster-agent credential (§7.3). |
| S-H7 | Settings layers limited and hashed into `session.spawned.layersHash`; worktree `.claude/` changes are gate-class; `G-KRN-01` restated (§3.3). |
| S-M4 | Hosts build actions only from broker-authored, kernel-signed cards (§4.5). |
| S-M5 | Mod trust tiers stated as unenforced in 8.0; the Shuttle band never holds the human key; decisions happen in the CLI (§11, §12.6). |
| S-M6 | Install card + pinned manifest hash for anything agent-written (skills, hooks, manifests, teacher drafts) (§3.6, §8.4). |
| S-M7 | Exploration slot restricted to T0/T1 or human-reviewed entries; MCP notebook injection logged as `inject.receipt` under a grant (§8.2). |
| S-L1..L4 | Exact `always` patterns logged; day windows immune to clock jumps; forbidden-flag check is a throw (not `headless.py:153`'s `assert`); session-key custody stated honestly (§3.3, §3.4, §12.2). |

---

## 1. Thesis, positioning, non-goals

**Thesis.** Claude Code is the shell and the gold standard; Gnomon is the kernel it never had: one hash-chained log, one identity, one approval broker with the budget fuse inside, one scheduler, one manifest grammar — and, in Warpline projects, every session Warpline-native from birth. The founder's tools already form a harness in pieces (04-scout-own-family.md: three drifted `claude -p` runners, three approval UIs, six schedulers, five append-only ledgers); 8.0 is a deletion project before it is a build project (07-fable-vision.md "Epiphanies"). The positioning line the name carries (13-fable-names.md: *gnomon* = "one who knows; indicator; judge"; the sundial's shadow-caster): **"ruflo coordinates agents; Gnomon adjudicates their work"** — one ledger, one identity, one budget, and every merge judged by tests and meaning, fail-closed. The market converges on plugins/skills/hooks/worktrees and nobody adjudicates merges (03-scout-landscape.md "Gaps"; dsh explicitly refuses, 02); that empty layer is the one Gnomon occupies.

**Non-goals (8.0).**
- NOT the Loom lane (TD-950 alternatives): no breadth-first meta-harness, no hundreds of tools, no roleplayed distributed protocols, no agent-type catalog. ruflo owns "harness = breadth"; Gnomon owns "harness = adjudication + contracts + falsifiers" (09-scout-ruflo-inside.md "Positioning refined").
- **We don't re-wrap Task.** Gnomon never offers a tool whose description steers the model off Claude Code's native Task/Agent tools (09 §4). Spawning through Gnomon is for sessions that need a permit, a credential, a worktree and a ledger — supervised processes, not in-context subagents.
- Not a distro on deepseek-harness (Bolt): dsh is one implementation of the backend adapter interface and nothing more.
- Not a shell, not a UI framework: Conductor, constellation, Platform, Atelier Studio, flow's GUI stay as window managers; the Shuttle band is the only new display and it is a Claude Code Mod.
- Not a new knowledge store: neurons vault, notebooks, lore, decisions, `.purpose`, Warpline fabric bytes are never migrated into the kernel (§13.2). The kernel indexes; it does not own.
- Not the Warpline server (TD-2026-10-14-551): Gnomon consumes `warplined`'s socket.
- Not Rust, not Swift (05-arky-kernel.md §4): TypeScript on Node 24; revisit only if idle daemon RSS > 150 MB or log-append p99 > 5 ms (§16).
- Not a cryptographic human boundary (P8-D12, §A.1) and not container isolation (P8-D13, §A.2) — both are accepted risks for founder-only 8.0 with a named revisit trigger.
- No 8.1 items: a second human, shared fabrics, cross-machine teleport, ruflo interop provider, local-model adapters beyond the interface, public marketplace.

---

## 2. Architecture

### 2.1 Kernel vs userland (TD-950 §2)

| Ring | Owns | Never contains |
|---|---|---|
| **Kernel** (`#gnomon-kernel`) | `#identity` (principals, keys), `#kernel-log` (hash chain), `#session-runner` + `#supervisor`, `#approval-broker` with `#budget-fuse` inside, `#scheduler`, `#manifest-loader`, `#ref-resolver`, `#socket` (the ABI, §5), `#oracle-sandbox` (§12.5) | the symbol graph, notebooks, calibration, the contracts compiler (`#contracts-compiler`), the Warpline engine (`warplined`), neurons, lore, the Shuttle Mod (`#shuttle`), the learning loop (`#learning-loop`), any LLM call of its own |
| **Userland** | symbol graph + `.purpose` (premise-core), notebooks + credit, the compiler, `warplined`, neurons, lore, Shuttle, every client, the backend adapter implementations behind `#backend-adapter` | kernel state (it may only append granted event kinds and read the log) |

Arky's boundary falsifier is the test (05 §6.1, `G-KRN-01`): the kernel boots with zero userland packages and runs one Claude Code session end to end, and `gnomon replay` reproduces every kernel-controlled input (argv, env key set, policy bytes, mcp bytes, kernel-injected bytes, ordered turns) byte-for-byte while recording the hashes of host layers it does not control (§3.3 "settings layers"). Any kernel import of `@a-company/premise-core`, any `@a-company/warpline` module, or `paradigm-mcp` is a build failure (ESLint `no-restricted-imports` fence on `packages/gnomon/kernel`, `G-KRN-02`).

### 2.2 Clients, distros, backend adapter

- **Clients** speak the socket protocol (§4.9): the Claude Code plugin (hooks + a thin MCP proxy of ≤ 12 tools), the Shuttle Mod (read-scoped), constellation (in-process TS client replacing the runner inside `server/agents.ts`), Conductor (Swift NDJSON client, M3.6), flow (Python client replacing `flowmation_harness/headless.py`), Platform, Atelier.
- **Distros** are manifests (§4.3) bundling skills, agents, hooks, resolvers, blocks, oracles: `paradigm` (default), `atelier`, `flow`, `constellation`. A distro never changes kernel behavior; it declares capabilities the human grants or refuses.
- **Backend adapter** (`#backend-adapter`): one interface, Claude Code first. `start(spec) → handle`, `send(handle, turn)`, `stop(handle, {interrupt})`, typed events `init | turn.start | message{usage?} | tool.use | permission.request | result{usage,total_cost_usd} | exited | quota.error`. Usage is read from the adapter's `message` and `result` events, never parsed from model text (10-arky-after-ruflo.md §1). Conformance: recorded stream-json transcripts replayed per `claude` version nightly (`G-ADP-01`). dsh, Codex and local models implement the same interface in 8.1; in 8.0 the interface exists and only the Claude Code adapter is built. stream-json is not a published contract; the adapter is the single place that knows its shape.

### 2.3 ASCII

```
                         ┌──────────────────────────── userland ─────────────────────────────┐
  Claude Code (shell)    │  Shuttle Mod   constellation   Conductor   flow(py)   Platform     │
  ┌──────────────────┐   │   (band, read)    (map)         (macOS)     (hub)      (web)       │
  │ interactive sess │   │       │              │             │           │          │        │
  │  hooks ──┐       │   │       └──────────────┴──────┬──────┴───────────┴──────────┘        │
  │  MCP proxy│      │   │                             │  JSON-RPC / NDJSON, 0600 unix socket │
  └──────────┼───────┘   │   contracts-compiler  learning-loop  warplined(per repo)  neurons   │
             │           └─────────────┬───────────────┬──────────────┬─────────────┬─────────┘
             ▼                         ▼               ▼              ▼             ▼
  ┌──────────────────────────────── ~/.gnomon/gnomon.sock ──────────────────────────────────┐
  │  socket   mutual auth(key|read-token) · subscribe · 12 verbs · status (F4 self-description)│
  ├──────────────────────────────────────────────────────────────────────────────────────────┤
  │  approval-broker ── budget-fuse (permits, ladder, breaker)        scheduler (log-derived)│
  │  session-runner ─── supervisor (preflight, env allowlist, pgid, staged stop)             │
  │  identity (gkey:v1 Ed25519, root-signed registry, hsid + cc: alias)   manifest-loader    │
  │  ref-resolver (grammar + registry; resolvers are userland)    oracle-sandbox (sandbox-exec)│
  │  kernel-log  ~/.gnomon/kernel.db  chain(seq,kind,…,prev,hash,sig) + anchored head        │
  └──────────────────────────────────────────────────────────────────────────────────────────┘
             │ spawns                                   │ ref:v1 → .warpline/fabric.jsonl
             ▼                                          ▼ (never migrated, linked by causes[])
  claude -p --input-format stream-json … (one process group per session, policy via --settings)
```

### 2.4 Daemon lifecycle (`$daemon-lifecycle`)

1. **One per user.** `~/.gnomon/gnomon.pid` is the lock, created `O_EXCL` with `{schemaVersion:'daemonPid:v1', pid, startedAt, socketPath}`; on `EEXIST` probe the holder (`kill(pid, 0)`); a live holder refuses the start, a dead one is cleaned and the create re-raced — lifted from `packages/warpline/src/daemon/lifecycle.ts:1-14`. `~/.gnomon` is 0700. Socket `~/.gnomon/gnomon.sock` 0600; if the path exceeds `sun_path` (`lifecycle.ts:33-50`) fall back to `$XDG_RUNTIME_DIR/gnomon-<sha256(home)[0..16]>.sock` on Linux (0700 dir) and refuse to start if neither fits — never `/tmp` (S-H4).
2. **Socket-activated by clients.** A client that gets `ENOENT`/`ECONNREFUSED` runs `gnomon daemon --detach` and reconnects (5 × 200 ms); the lock makes concurrent activators harmless. The daemon **re-execs itself** with a fixed clean env (`PATH` from signed config, `HOME`, `LANG`, nothing else; `NODE_OPTIONS` and `GNOMON_*` dropped) so the activating client's environment never reaches the key-holding process (S-H3); the `claude` binary path comes from `~/.gnomon/config.yaml` (root-signed), never from the caller's `PATH`. Client activation is the only mode in 8.0 (A-OPEN-5 answered); launchd `Sockets` activation is 8.1.
3. **Idle exit.** No live sessions ∧ no subscribers ∧ no due timers inside 10 min ⇒ `daemon.exit{reason:'idle'}` and exit. Timers are log-derived (§3.5); a timer due while the daemon is down fires on the next activation as an attended event — never spontaneously.
4. **Crash posture.** Every chain write commits before any side effect that depends on it. A child that outlives a daemon crash is found on restart by `session.spawned` without `session.exited`, its pgid probed and stopped with `session.orphaned` — never left unowned (`G-DMN-04`).
5. **Degrade path (documented, not built):** daemonless kernel = same contracts as a library, `gnomon spawn` supervises for its own lifetime. Promotable without ABI change; the fallback if `G-DMN-*` or falsifier §16.1 trips.

---

## 3. Kernel primitives

Each primitive: responsibilities · data model · invariants · failure modes (all fail closed) · seed code (lift = copy with licence notice; re-derive = reimplement from the design).

### 3.1 `#identity` — principals, keys, hsid

**Responsibilities.** Mint and resolve principals (`human | agent | session | kernel`); hold Ed25519 keys; issue `hsid`; map aliases (`cc:<uuid>`); authenticate socket clients; stamp every event's `principal` server-side (client-supplied identity is advisory and ignored — `packages/warpline/src/daemon/tokens.ts:15-19`); verify that every registry and grants row is signed by the human root key (S-C2).

**Data model.**
```
principal:v1 { principalId:"p:<kebab>", kind: human|agent|session|kernel, keyId:"gkey:v1:<sha256 of normalized spki PEM>",
               parent?: principalId, createdAt, scope:{ repos?:[], readOnly?:bool } }
~/.gnomon/keys/root.key              the human ROOT key (0600): signs registry rows, grants rows, config.yaml, and approvals
~/.gnomon/keys/registry.jsonl        append-only rows { row, rootSig }  — PUBLIC material only; latest ROOT-SIGNED row wins per principal
~/.gnomon/keys/<principalId>.key     0600 agentKey-shaped file (private material), dirs 0700
~/.gnomon/grants.jsonl               append-only { grant, rootSig }: capability grants, principal→manifest bindings, trust tiers (§12.4)
~/.gnomon/sessions/<hsid>/key        ephemeral session key, 0600, deleted on session.exited
hsid:v1 / hsid:v1d — §4.2
```
Generalizes `packages/warpline/src/fabric/keys.ts`: key identity rule `keys.ts:15-18,126-129` (hash over normalized PEM bytes, the same bytes stored); principal grammar `keys.ts:73-77`; fail-closed loaders `keys.ts:223-239`; registry reader that skips AND surfaces malformed rows `keys.ts:338-360` with the closed-kind posture of `validRegistryRow` (`keys.ts:309-330`). Domain-separated signatures: `'gnomon:event-sig:v1\n' + hash`, `'gnomon:row-sig:v1\n' + canonical(row)`, `'gnomon:approve:v1\n' + cardId + '\n' + decision + '\n' + cardContentHash`, `'gnomon:auth:v1\n' + …` (pattern `keys.ts:65,143-146`).

**Invariants.**
- I1 One agent key = one notebook owner = one Warpline signer = one nevr.land profile later (07 "Forgotten pieces 5"). **The kernel never mints a Warpline key or daemon token** (P8-D14; `keys.ts:441-443` "HUMAN-GATED at the CLI", `tokens.ts:3-6`). Warpline principals are the stable roster agents (`p:arky`, `p:builder`, `p:reviewer`, …) whose Warpline key file and agent-class daemon token the founder mints once with `warpline key mint` / `warpline daemon token mint`; a session **borrows** the credential of the roster agent it runs as (`session.open{as:'p:builder'}`), and the strand it seals links back to the session through `causes[]` on the `warpline.pick` event — not through a per-session Warpline key. Session principals exist only on the Gnomon side (ephemeral `gkey`), so Warpline's registry does not grow by one row per session.
- I2 Principal comes from a key or token, never from an env var (S1, TD-735 §4). `WARPLINE_AGENT_ID` (`agent-shell.ts:42,70-73`) stays Warpline's unsigned CLI marker; the kernel sets it for Warpline-native sessions but never trusts it for its own authorization.
- I3 `human`-kind principals and the root key are minted only by the local CLI (`gnomon init`, `gnomon key mint <name> --kind human`); no daemon verb mints identity. The CLI refuses these verbs from an agent shell: `GNOMON_HSID` set, or the caller's pgid is a live session's pgid (checked over the socket) ⇒ `refusal:v1 {code:'FORBIDDEN'}`. This is the `agent-shell.ts:116-137` shape and shares its honest limit: `env -u` and `setsid` defeat it (§A.1).
- I4 Session principals are children: `scope ⊆ parent.scope`, `kind:'session'` can never call `approve`, never widen a permit scope, never bind to a manifest grant (grants bind to roster agents and humans).
- I5 Every registry and grants row carries `rootSig`; a row without a valid root signature is skipped, surfaced, and never resolves (S-C2). The root key's own registry row is self-signed and pinned first (`signed-from` pattern `keys.ts:28-32,397-402`: the FIRST row is authoritative forever).

**Failure modes.** Unknown key/token ⇒ `refusal:v1 {code:'AUTH', retriable:'never', next:[]}`; malformed or unsigned rows never resolve; key file whose `principal` differs from its filename never resolves; a signature that fails verifies to `false`, never a throw (`keys.ts:153-161`).

**Seed.** Lift `keys.ts` (own code) into `packages/gnomon/kernel/identity/`; re-derive `tokens.ts:72-154` (mint/resolve with `timingSafeEqual`) for read-scoped tokens; constellation's HMAC token derivation (`agents.ts:165-173`) is not reused for kernel authority.

### 3.2 `#kernel-log` — the one hash-chained index

**Responsibilities.** Append events (§4.1) in total local order; maintain rebuildable projections; verify (chain + signatures + anchor); segment; serve `log.read` with follow. Every kernel-injected byte is logged (dsh "Model-visible ⟺ logged", 02 "Steal 1"); every foreign ledger row that matters is referenced, never copied (TD-950 §3).

**Data model.** SQLite via `node:sqlite` at `~/.gnomon/kernel.db`, lifted from a-flow (`a-flow/packages/flowmation-core/src/flowmation_core/repository/sqlite.py:1-16,185-193`):
```sql
CREATE TABLE chain (seq INTEGER PRIMARY KEY, id TEXT NOT NULL UNIQUE, kind TEXT NOT NULL, at TEXT NOT NULL,
                    principal TEXT NOT NULL, envelope TEXT NOT NULL, prev_hash TEXT NOT NULL, hash TEXT NOT NULL, sig TEXT);
-- seq = (SELECT MAX(seq)+1) inside the write transaction (sqlite.py:943-951 pattern) — never AUTOINCREMENT, so a rolled-back write leaves no gap
-- projections (sessions, permits, cards, contracts, nodes, credits, timers …): seq INTEGER NOT NULL UNIQUE REFERENCES chain(seq)
-- BEFORE UPDATE / BEFORE DELETE triggers RAISE(ABORT,'append-only: <table>') on chain and every projection (sqlite.py:9-11, 535-537)
```
`hash = sha256(canonical(envelope minus hash, sig))` where the envelope already contains `prev` (`prev_hash`) and `seq` — so principal, causes, scope, at, id and payload are all under the hash (A-schema-hash; flow hashes `prev + kind + seq + payload` only, `chain.py:3-4,59-69`, which left headers rewritable). `prev(seq=1) = sha256("gnomon-log-genesis:" + logId)`. Canonical serialization = Warpline's codepoint-sorted, NFC serializer (`warpline-fabric-schema-v2.md` §1.2). Decision-feeding reads join `chain` on `seq` AND `kind` (`sqlite.py:13-16,542-544`).

**Signatures and anchoring (S-H1, D12 mitigations).** `sig` is MANDATORY on `approval.*`, `oracle.result`, `budget.*`, `permit.*`, `key.*`, `manifest.*`, `config.*` (kernel key or root key as the matrix in §5 says) and on every event appended by a keyed principal; kernel-internal diagnostics (`daemon.*`, `socket.*`, `schedule.*`) may be unsigned. The chain head `{seq, hash, at}` is written after every commit to `~/.gnomon/head` (0600) AND to a macOS Keychain generic-password item `gnomon-head` (no user-presence prompt; Linux: `$XDG_RUNTIME_DIR/gnomon-head` plus the file) — an attacker who rewrites the db must also rewrite both anchors. On start: missing db with keys present ⇒ `INTEGRITY_BROKEN`, refuse to start (deleting the db cannot reset the budget); db head ≠ anchor ⇒ `INTEGRITY_BROKEN`; `gnomon log verify` walks the chain, recomputes hashes, verifies every signature against the registry, and checks the anchors. Honest scope: a same-user attacker who can also rewrite the anchors and re-sign with keys read from disk defeats this (§A.1).

**Invariants.**
- L1 Append-only in the strong sense (triggers + verify).
- L2 Model-visible ⟺ logged for kernel-added bytes: every byte the kernel adds to a session's context is `session.inject{origin:'kernel', hash, bytes}` BEFORE the child reads it (`G-LOG-03`). Client-supplied system prompts (constellation's `systemPrompt`, `agents.ts:336,452`) are allowed and logged as `session.inject{origin:'client', principal, hash, bytes}` (A-migration-3). Userland injections into interactive sessions (notebook enrichment) are logged by userland as `inject.receipt` under a grant (§8.1), not by the kernel.
- L3 Fabric stays separate (TD-950 §3): `warpline.pick | admit | knot | resolve | selvage.moved` events carry `ref:"wl:pick/<pickId>"` + `refHash`, and `causes[]` names the kernel events (turn, permit, claim) that produced them. Telemetry `T-LOG-05` (§16): after 30 days any strand sealed by a Gnomon session without a `warpline.*` envelope ⇒ bridge failed.
- L4 Ids never collide: `id` is a ULID; 7.x `ev-<ms>-<rand>` ids (05 "Findings") are wrapped as `paradigm.event` with `ref:"pev:<id>"`.
- L5 Growth bounded by segmentation, never truncation (ruflo #3164 vs its 200-line truncation, 10 §1): at 10⁶ rows `gnomon log segment` seals a segment (epoch-anchor pattern, `warpline-v3-identity.md` §5) into `~/.gnomon/segments/<n>.db`; the live db keeps the anchor. Blobs: `session.inject` bytes are kept forever (byte-for-byte replay needs them); `turn.event` bodies and oracle evidence are pruned at 90 days with `blob.pruned{sha}` (A-OPEN-6 answered).

**Failure modes.** Corrupt chain on open ⇒ refuse to start with the first break (never "start fresh" — ruflo `global-ai-budget.ts:419-422`, 10 §1); projection mismatch ⇒ rebuild projections from chain, never the reverse; a failed write ⇒ the side effect does not happen.

**Seed.** Re-derive from `sqlite.py` + `chain.py` in TS; re-derive the `{seq, at, event}` spool framing of `a-constellation/shared/agent.ts:83-91` for `log.read` follow frames.

### 3.3 `#session-runner` + `#supervisor` — the one `claude -p` driver

**Responsibilities.** Preflight; mint the session principal + hsid; obtain a permit; select the roster credential (Warpline mode); build policy/env/argv; spawn in its own process group; parse stream-json lines into events; meter usage per message; staged stop; respawn with `--resume`; orphan sweep. Replaces three runners (04 "Overlaps"): `a-flow/.../headless.py`, `a-constellation/server/agents.ts`, `packages/conductor/Sources/Conductor/Services/ClaudeStreamSession.swift` (deleted in M3.6).

**Data model.**
```
session:v1 { hsid, principalId, as?: rosterPrincipalId, backend:{kind:'claude-code', uuid, binarySha256, version}, cwd, worktree?, mode: warpline|git|none,
             policyHash, mcpHash, layersHash, permitId, parent?: hsid, state: starting|idle|busy|stopping|exited, startedAt, lastActiveAt }
events: session.open · session.spawned{pid,pgid,argv,envKeys[],policyHash,mcpHash,layersHash,permitId} · session.inject{origin,hash,bytes}
        · turn.sent · turn.event · turn.usage{tokens} · turn.result{usage,cost,permission_denials} · session.idle · session.respawn · session.exited · session.orphaned
```

**Argv.** The shared core, present in both existing runners (`headless.py:133-154`, `agents.ts:433-446`):
```
claude -p --input-format stream-json --output-format stream-json --verbose --replay-user-messages
       --permission-mode default --permission-prompts none (--session-id <uuid> | --resume <uuid>) --settings <policy.json>
```
Gnomon adds constellation's extras (`agents.ts:447-452`, absent in flow): `--mcp-config <mcp.json> --strict-mcp-config` always (constellation makes strict conditional, `agents.ts:451`; Gnomon does not), `--append-system-prompt <bytes>` when a client supplied one or the Warpline pointer applies (§6.2), `--model <m>` when set. `FORBIDDEN_FLAGS = {--dangerously-skip-permissions, --allowedTools, --allowed-tools, --bare}` checked at argv build with a **throw** (`agents.ts:40,453`; `headless.py:114-116` uses a Python `assert` at `:153`, stripped under `-O` — not copied, S-L3). Conductor's `ClaudeStreamSession.swift:178-188` passes `--dangerously-skip-permissions` at `:183` with no session id and a full login-shell env — the model that is deleted.

**Preflight** (lift `headless.py:612-618` + `claudeCli.ts:21-97`), authoritative before every spawn and respawn: (1) realpath of the configured binary now (`headless.py:528-531`, `claudeCli.ts:21-25`), hash it; refuse a respawn whose binary changed (`headless.py:16-18`); (2) `--version ≥ 2.1.288` (`claudeCli.ts:13`); (3) managed settings, `~/.claude/settings.json`, the session policy and project `.claude/settings*.json` must not set `apiKeyHelper` or `env.ANTHROPIC_*`/`CLAUDE_CODE_USE_*` (`headless.py:550-584`, `claudeCli.ts:63-76`); (4) `claude auth status` with the session env/cwd says `authMethod:"claude.ai"`, `apiProvider:"firstParty"` (`headless.py:586-610`, `claudeCli.ts:79-97`); (5) `init.apiKeySource ≠ "none"` kills the group (`headless.py:33-37`). Subscription-only is the posture for every session including the reviewer (P8-D15).

**Settings layers (S-H7).** Claude Code reads more than `--settings`: managed, user, project `.claude/settings.json`, `.claude/settings.local.json`, the worktree's own `.claude/`, user plugins/hooks, `CLAUDE.md`, skills. The kernel cannot forbid them, so it (a) generates the session policy with `permissions.defaultMode:'default'` and explicit denies, (b) hashes every layer it can see into `layersHash` (file list + sha256 each) at spawn and respawn, (c) treats a worktree `.claude/**`, `CLAUDE.md`, test config, package scripts or pipeline-file diff as gate-class (§12.7) — a respawn after such a change requires a human card, (d) records the plugin/skills directory listing hash. `G-KRN-01` claims exact replay of kernel-controlled inputs and recorded `layersHash`, not of the host's context.

**Environment** = allowlist then scrub then kernel additions: `HOME USER LOGNAME LANG LC_ALL LC_CTYPE TMPDIR` + `PATH SHELL` (`headless.py:97`, `claudeCli.ts:15`), scrub `ANTHROPIC_* CLAUDE_CODE_USE_* CLAUDE_CODE_OAUTH* CLAUDE_CONFIG_DIR NODE_OPTIONS GNOMON_HOME` (`headless.py:98-99`, `claudeCli.ts:16`), add `GNOMON_HSID GNOMON_SOCK GNOMON_SESSION_KEY` and, in Warpline mode, `WARPLINE_AGENT_ID=<roster principal>` + `WARPLINE_MCP_TOKEN` (`tokens.ts:295-297` order 1). Arky's gap (flow's allowlist drops `WARPLINE_AGENT_ID`, 05) is closed by construction. `envKeys[]` (names only) is logged. Session-key custody, honestly: the key path is in the env and readable by the session's tool subprocesses (same user); its blast radius is the session's own scope (I4) — the C1 class, accepted (§A.1); fd-passing is not available to Claude Code's hooks (S-L4 noted).

**Process.** `spawn(bin, args, {cwd, env, detached:true, stdio:pipe})` — own process group (`headless.py:339-351`, `agents.ts:460`); stderr capped 64 KiB; stdout lines capped 4 MiB with `dropped` events (`agents.ts:36,506-513`, `headless.py:360-374`); staged stop SIGINT → close stdin → SIGTERM → SIGKILL on the group, then sweep (`headless.py:483-507`, `agents.ts:38`); leader-exit grace 2 s (`headless.py:389-403`); idle respawn with `--resume` (`headless.py:10-11`, `agents.ts:445`; `IDLE_MS` `agents.ts:34`), **charged as a launch** (S-H2); crash cap 3/10 min (`agents.ts:37-39`); busy-elsewhere check on transcript mtime before resuming an interactive uuid (`claudeCli.ts:113-117`).

**Invariants.** S1 No process creation without `permit.grant` earlier in the same transaction (law 1). S2 Every stdout line is a `turn.event` before anything acts on it. S3 `turn.usage` from stream-json assistant `message.usage` and `turn.result` are the only sources of `budget.usage`; a breach mid-turn kills the pgid (S-H2). S4 A session's tool children die with it. S5 Replay as defined in §2.1. S6 `session.*` events are appended only by the supervisor (kernel-owned namespace, S-M2).

**Failure modes.** Preflight failure ⇒ `session.refused{code}` with flow's closed codes preserved verbatim (`claude_version | not_subscription_auth | spawn_failed | claude_binary_changed | bad_message | session_busy`) inside `refusal:v1 {code:'UNSUPPORTED'|'BAD_REQUEST', gate:'usage'}`; no `init` ⇒ `exited before starting` (`agents.ts:567`).

**Seed.** Lift `agents.ts` as the base: spool `agents.ts:269-300`, spawn `agents.ts:425-470`, exit `agents.ts:563-575`; lift `claudeCli.ts` whole; port from `headless.py` the binary-sha pin, leader-exit watch, long-line discard. Delete nothing until `G-RUN-04` passes.

### 3.4 `#approval-broker` + `#budget-fuse` — one closed, fail-closed approval set

**Responsibilities.** Decide every `permission.request` from a kernel-spawned session (Claude Code `PermissionRequest` hook → `gnomon hook permission` → `permit.reserve{kind:'tool.permission'}`, which blocks until policy, card decision or timeout); hold the human boundary (`approve`); issue and account budget permits; raise **cards** into the one inbox; verify the per-approval signature. constellation cards, flow approvals/step-up and Symphony file-requests (04) render the same `display-block:v1` card and answer through the same verb.

**Data model.**
```
card:v1   { cardId:"card:v1:<ulid>", kind: permission|budget|knot|tend|verdict|merge-conflict|gate-class|install, hsid?, contractId?, nodeId?,
            block: display-block:v1, contentHash, actions:[…kernel-signed], state: pending|allowed|denied|always|accepted|rejected|resumed|resolved|installed|expired,
            decidedBy?, decidedAt?, decisionSig?, timeoutAt }
policy    per-session --settings JSON generated from the manifest + mode (§6); `always` decisions append approval.rule.learned{tool, matchExact} (S-L1)
          and regenerate the next policy — never hand-edited.
permit:v1 — §4.8.  ladder: user → repo → loop → session (10 §1).
events: approval.request · approval.decide{decision, by, decisionSig} · approval.expire · approval.rule.learned · budget.reserve · budget.deny · budget.usage
        · budget.pause · budget.resume · budget.ladder{rung} · breaker.open · breaker.close · config.loaded{hash, signed} · config.unsigned
```

**The fuse (laws 1 and 5).** `permit.reserve({kind, scope, model})` is checked BEFORE process creation and before every turn (10 §1): limits per scope — concurrent sessions (default 3/user), launches/hour (6) and /day (24) with respawns counted, tokens per session/loop/day, notional USD. Rungs 50/75/90/100 % announced once per scope per day; 100 % ⇒ `budget.pause` + a `budget` card; resume is a human `approve{decision:'resume'}`. Breaker opens on the adapter's `quota.error`, closes after 60 min or human resume. Day windows are computed from the chain's last event time, never a wall clock that may jump backward (S-L2). Defaults ON; tunable only in root-signed `~/.gnomon/config.yaml` (an unsigned or tampered config ⇒ defaults + `config.unsigned`); **no env var or project file can change them**; `GNOMON_HOME` is honored only by the test build (`NODE_ENV=test`), never by the production binary (S-H2). ruflo's `RUFLO_AI_BUDGET_DISABLE` (10 §1) has no analogue. Every denial is `budget.deny` and counts as learning signal (12-loid-direct.md §4).

**Honest coverage of the fuse (S-H2).** Metered: kernel-spawned sessions (spawn, turns, per-message usage, respawns) and interactive sessions registered through hooks (usage only — an interactive `session.open{derived}` needs no spawn permit, A-ABI). Not metered: a `claude -p` an agent launches from Bash outside the kernel (the session policy denies `Bash(claude *)` as an advisory string rule; a determined agent bypasses it); Task fan-out inside a turn is caught by per-message usage, not pre-authorized. The band shows every kernel-known child; unknown `claude` processes of the user are counted by `status.unknownClaudeProcesses{n}` from `ps` so the gap is visible, not hidden.

**Invariants.** B1 Nothing spends by default. B2 Permit ids are ULIDs (never `Math.random`). B3 Only the broker appends `approval.*`/`budget.*`/`permit.*`, all signed by the kernel key; `approval.decide` additionally carries the human's `decisionSig` over `(cardId, decision, contentHash)` (D12). B4 An agent- or session-kind principal can never decide a card, accept its own breach (`protocol.ts:148-151`), confirm a meaning-blind merge (`protocol.ts:175-177`), or re-draw what is protected (`protocol.ts:161-164`). B5 Corrupt budget state ⇒ deny, never "start fresh".

**Failure modes.** No decision by `timeoutAt` ⇒ deny + `approval.expire` (`agents.ts:721`, flow). Broker unreachable ⇒ **for kernel-spawned sessions** the hook denies (non-zero exit under `--permission-prompts none`, `headless.py:54-58`); 7.x interactive sessions without the daemon are unaffected because their hooks are not wired to the broker (A-migration-1).

**Seed.** Re-derive constellation's card lifecycle (`agents.ts:677-731`) and flow's step-up as card kinds; lift Warpline's matrix constants verbatim (`protocol.ts:115-177`); design-lift #2661 invariants without ruflo code (10 §1-2).

### 3.5 `#scheduler` — log-derived timers only

**Responsibilities.** Turn events into due times; fire `schedule.due`; dedupe by key; never call an LLM.

**Data model.** `timer:v1 { key, dueAt, derivedFrom:[eventIds], kind: tend|liveness|loop-round|retry|idle-exit, opt: attended|opt-in }` — a projection of the chain, recomputed on start (flow `timers` is "a cache of the chain … rebuildable", `sqlite.py:21-22`).

**Invariants.** T1 One daemon ⇒ one timer per key; no supervisor election (10 §1). T2 A timer fires an event; whatever acts on it needs a permit if it spends. T3 Loop policies (Ralph rounds, goals, `/loop`, `/schedule`, automations, routines) are userland over `loop:v1 {loopId, goal_ref, roundCap, budget, freshContext, oracle, stuckDetector}` (07 "Loops"); the kernel emits `loop.round.due` and records `loop.row` (§8.5).

**Failure modes.** A timer whose derivation events are missing is dropped with `schedule.dropped`.

**Seed.** Re-derive from constellation automations' trigger grammar and flow routines' quiet gate (06 §2; Odysseus interactive gate, 01).

### 3.6 `#manifest-loader` — one grammar, nothing hand-synced

**Responsibilities.** Validate `manifest:v1` (§4.3); check `requires.capabilities` against the root-signed grant table and `requires.egress` against the egress rule; GENERATE `plugin.json`, `.mcp.json`, `hooks.json`, tool-family listings and per-session `--settings` from the manifest; refuse the unjudgeable; raise an `install` card for anything agent-written.

**Invariants.** M1 Project scope cannot set trust or budget policy (ruflo mod trust, 09 "Extension"; 10 §2). M2 Egress-capable provides are admitted only when declared AND first-party or human-opted-in; closed refusals `egress_undeclared | egress_third_party | egress_shadowed` lifted from `a-flow/.../plugins/registry.py:9-24`. M3 Unknown `kind` or unknown provides-key fails closed. M4 Generated files carry `generatedBy: gnomon <version> <manifestHash>` and `gnomon uninstall` removes exactly those (law 4); `generate-hooks.mjs` is subsumed — manifests generate JSON, never TS (A-migration-4). M5 No `postinstall` scripts anywhere (law 6; ruflo 09 "Follow-up 1"). M6 **Package manager = audit queue** (S-M6): a manifest, skill, hook or teacher draft authored by an agent is staged, hashed, and loaded only after an `install` card is approved; the grant row pins the manifest hash, so a later edit un-installs it.

**Seed.** Re-derive from flow's `PluginManifest` (`manifest.py:40-50`: kind, name, version, capabilities, config_schema, egress) + Paradigm's `FamilyMeta` tiers (`families.ts:28-53`) and `FAMILY_META` (`families.ts:55-92`) + the plugin's `hooks.json`/`plugin.json`.

### 3.7 `#ref-resolver` — grammar in the kernel, resolvers in userland

**Responsibilities.** Parse `ref:v1` (§4.4); dispatch to a manifest-registered resolver; answer `ref.resolve`. Built-in schemes: `ev hsid cc gkey permit card contract node pev`. Userland: `sym` (premise-core), `wl` (Warpline), `n s` (neurons), `td l t` (Paradigm), `spec`.

**Invariants.** R1 Total grammar: parse failure ⇒ `BAD_REQUEST`, no resolver ⇒ `UNSUPPORTED`, nothing found ⇒ `NOT_FOUND` — never a guess. R2 Resolvers are read-only (capability `resolver:<scheme>` is read-class). R3 `cc:<uuid>` → hsid resolves through the alias table only.

**Seed.** Re-derive; `#`/`$`/`^`/`!`/`~` → `sym:` aliasing is Paradigm's v2 prefix table (CLAUDE.md "Symbol System").

---

## 4. Hard contracts (versioned; additive or a version bump — Warpline G1)

All objects carry `schemaVersion`. Ids are content addresses, ULIDs or names — never ledger positions outside the envelope's own `seq` (G2, `refusal.ts:26-27`). No human sentences in a verdict (`refusal.ts:15-22`).

### 4.1 Event envelope (`event:v1`)

```jsonc
{ "schemaVersion": "event:v1",
  "id": "ev:01J9Z6…",                       // ULID
  "log": "kernel", "seq": 48213,            // seq assigned in the write txn; a local arrival fact
  "at": "2026-10-16T05:04:54.770Z",
  "principal": "p:ascend", "keyId": "gkey:v1:…",   // server-stamped from the authenticated connection
  "connId": "conn:…",                        // the connection that carried it (null for kernel-internal)
  "idem": "sha256:…",                        // optional caller idempotency key; a duplicate (same principal, idem) is answered with the first event, not appended
  "session": "hsid:v1:…",
  "scope": { "repo": "repo:<sha256(root-commit sha)[0..16]>", "loop": "loop:…", "contract": "contract:v1:…" },   // repo id survives moves; non-git roots use .gnomon/project.yaml repoId
  "kind": "session.spawned",                 // "<ns>.<verb>", closed per namespace (§9.1)
  "causes": ["ev:…", "wl:pick/pick:v3:…"],   // kernel ids and/or ref:v1 strings
  "payload": { … },                          // ≤ 64 KiB; larger bodies → ~/.gnomon/blobs/<sha256> with {blob, bytes}
  "ref": "wl:pick/pick:v3:…", "refHash": "sha256:…",   // ONE foreign reference, optional, allowed beside payload
  "prev": "sha256:…",
  "hash": "sha256:…",                        // sha256(canonical(this object minus hash, sig))
  "sig": "base64…" }                         // Ed25519 'gnomon:event-sig:v1\n'+hash; mandatory per §3.2
```

### 4.2 hsid + aliases (`hsid:v1`, `hsid:v1d`)

- Kernel-issued (spawned): `hsid:v1:<26-char Crockford base32 ULID>`.
- Derived (interactive hooks): `hsid:v1d:<base32(sha256("gnomon:hsid:v1d\n" + principalId + "\n" + "cc:" + uuid))[0..26]>` — keyed on the **principalId**, not the key (rotation must not fork sessions, A-hsid); the `d` form is visibly distinct (S-M1). The hook reads `session_id` from the hook's stdin JSON (Claude Code hook input; falls back to `$CLAUDE_SESSION_ID` — OPEN to verify both on 2.1.288+), connects with the human's key, and sends `session.open{alias:"cc:<uuid>", derived:true}`. Accepted only from the principal the hsid was derived for; first registration wins; a second registration of the same alias by another principal is `FORBIDDEN` and logged `session.alias.rejected` (alias squatting). Without the daemon the hook writes nothing.
- Aliases: `cc:<uuid>`, `wl:session/<sessionKey>`, `const:<agentId>`, `flow:<sid>`. Respawns keep the hsid; `backend.uuid` is an attribute (Arky §2.2). Derived hsids are adopted as-is (A-OPEN-4 answered).

### 4.3 Manifest (`manifest:v1`)

```yaml
manifest: 1
kind: distro | mod | provider | adapter | skill-pack
name: paradigm
version: 8.0.0
compat: { kernel: ">=8.0.0 <9", claudeCode: ">=2.1.288" }
provides:
  mcp: [{ name: paradigm, command: paradigm-mcp, args: ["."], tier: default|on-demand, keys: [] }]
  skills: [ path ]      agents: [ path ]
  hooks: [{ event: <string — known: PreToolUse PostToolUse Stop SessionStart UserPromptSubmit PermissionRequest; unknown values are kept and warned, never refused>, command }]
  bands: [{ id: shuttle, entry: mods/shuttle/index.ts }]
  steps: [ kind ]       resolvers: [{ scheme: sym, command }]       blocks: [ "ns.type" ]       oracles: [{ type, command }]
requires:
  capabilities: [ "log.append:paradigm.*", "log.append:inject.*", "log.read", "ref.resolve", "permit.reserve:tend.llm" ]
  egress: none | [ { host, purpose } ]
config_schema: { type: object, … }
```
No `trust:` field — trust is a grant-table fact the human writes (`gnomon trust <manifestHash> --tier first-party|signed|local`), never self-description (A-manifest, §12.6). `manifestHash = sha256(canonical(manifest))` stamps every generated file and `manifest.load`.

### 4.4 Ref grammar (`ref:v1`)

```
ref      = scheme ":" id [ "@" rev ]
scheme   = 1*( ALPHA / DIGIT / "-" )      ; registered: ev hsid cc gkey permit card contract node pev spec sym wl n s td l t knot
id       = 1*( VCHAR except "@" SP )
rev      = 1*( ALPHA / DIGIT / "." / "-" / ":" )
aliases  = "#" name → "sym:#" name ; "$" → "sym:$" ; "^" → "sym:^" ; "!" → "sym:!" ; "~" → "sym:~" ; "TD-…" → "td:" ; "L-…" → "l:" ; "T-…" → "t:"
examples spec:docs/specs/gnomon.md@<blobsha>   sym:#approval-broker   wl:pick/pick:v3:ab12…   contract:v1:9f…   node:9f…/sym:#socket
```
Result: `{ ref, scheme, target:{kind,…}, hash?, resolvedBy, at }` or `refusal:v1`.

### 4.5 display-block (`display-block:v1`)

```jsonc
{ "schemaVersion": "display-block:v1",
  "block": "inbox.card" | "session.live" | "contract.progress" | "budget.meter" | "knot.split" | "text",
  "data": { … },                                 // host-rendered; no HTML, no ANSI; agent text is DATA
  "refs": ["hsid:v1:…", "node:…"],
  "causes": ["ev:…"], "at": "…" }
```
A block carries **no actions** (S-M4). Actions come only from a broker-authored `card:v1.actions[]`, each `{id, verb:'approve', params:{cardId, decision}, principal:'human'}`, signed by the kernel key; a host renders a decision control only for a signed card and sends it as the human via the CLI or a full-scope client. Unifies constellation Admin blocks, Conductor's `conductor-visual` envelope and `paradigm_platform` navigate/highlight (04 "Seams"). Untrusted-content rule: `descriptors.ts:73-74`.

### 4.6 refusal (`refusal:v1`, Gnomon superset)

Shape and semantics lifted from `packages/warpline/src/fabric/refusal.ts:47-197` (schema id, `MAX_CONTESTED` 32, `RefusalGate`, `Retriability`, `RefusalNextStep{verb,params,requires,principal}`, `Refusal`), the single constructor `refuse()` (`:418-434`) and accessor `refusalOf()` (`:291-301`), with two schema differences so no engine type enters kernel contracts (A-boundary-4): `verdict` is `string | null` (Warpline's `AdmitStatus` values are legal strings) and `contested[].rule` is `string | null` (Warpline's `KnotRule`). Gnomon's `RefusalCode` is Warpline's twelve (`refusal.ts:76-88`) plus `BUDGET_DENIED` (gate `budget`, `retry-with-override`, `next:[{verb:'approve', principal:'human'}]`), `PERMIT_REQUIRED` (gate `budget`, `retry-corrected`, `next:[{verb:'permit.reserve', principal:'agent'}]`) and `CAS_LOST` (gate `claim`, `retry-corrected`, `next:[{verb:'status'}]`); gates add `budget` and `claim`. Warpline's schema is a strict subset; Warpline keeps its own file, no re-export (A-OPEN-13 answered); `G-CON-02` asserts subset-compatibility (every Warpline refusal validates against Gnomon's schema). Exit codes: Warpline's table (`refusal.ts:213-226`) + `BUDGET_DENIED` 6, `PERMIT_REQUIRED` 2, `CAS_LOST` 5.

### 4.7 contract (`contract:v1`)

```jsonc
{ "schemaVersion": "contract:v1",
  "contractId": "contract:v1:<sha256(canonical({specRef, mode, nodes sorted by ref}))>",   // ordinal-free; stable under reordering
  "specRef": "spec:docs/specs/gnomon.md@<git blob sha>", "repo": "repo:…", "mode": "warpline" | "git",
  "compiler": { "name": "paradigm-contracts", "version": "8.0.0", "deterministic": true },
  "nodes": [
    { "id": "node:<contractId[0..12]>/sym:#approval-broker",   // keyed by ref — unique within a contract, stable across edits (A-contract-ids)
      "kind": "symbol" | "gate" | "flow" | "signal" | "aspect" | "test" | "doc",
      "ref": "sym:#approval-broker", "section": "2.1",            // first appearance
      "oracles": [ {"type":"exists"}, {"type":"test","arg":"G-BRK-01"}, {"type":"admission"}, {"type":"reviewer"} ],
      "deps": [] } ],                                              // only from explicit `Depends on:` lines (§7.1 rule 5)
  "orphanTests": { "node": "node:…/doc:release-gate", "ids": ["G-CON-01", …] },
  "certification": { "required": ["test", "admission" | "merge-ci", "reviewer"] },
  "compiledAt": "…" }     // not in the hash
```
Claims and status are log events (§7.4). A node with zero oracles ⇒ compile refusal `BAD_REQUEST gate:usage` naming the node.

### 4.8 Budget permit (`permit:v1`)

```jsonc
{ "schemaVersion": "permit:v1", "permitId": "permit:v1:<ulid>", "principal": "p:…", "hsid": "hsid:v1:…",
  "scope": { "user": "p:ascend", "repo": "repo:…", "loop": "loop:…", "session": "hsid:v1:…" },
  "kind": "session.spawn" | "turn" | "tool.permission" | "tend.llm" | "oracle.reviewer" | "teacher.draft",
  "model": "claude-opus-4-8", "limits": { "tokens": 400000, "usd": 4.0 },
  "issuedAt": "…", "expiresAt": "…",                 // ≤ 60 min; a spawn permit is consumed by exactly one spawn or respawn
  "ladder": { "user": 0.41, "repo": 0.12, "loop": null, "session": 0 },
  "decision": "allow" | "deny",                      // tool.permission permits carry the broker's answer
  "sig": "…" }                                       // kernel key, mandatory
```

### 4.9 Socket protocol (`gnomon-rpc:v1`)

JSON-RPC 2.0, newline-delimited, over the 0600 socket (`server.ts:627-629` posture; transport rationale `protocol.ts:6-16`). Every frame carries `"rpc":"gnomon-rpc:v1"`.

**Mutual auth handshake (first two frames; nothing else is served before it; S-H4):**
```
→ {"jsonrpc":"2.0","rpc":"gnomon-rpc:v1","id":1,"method":"hello","params":{"client":"shuttle/8.0.0","principal":"p:ascend"}}
← {"…","id":1,"result":{"nonce":"<32B b64>","serverKeyId":"gkey:v1:…","serverSig":"<Ed25519 'gnomon:auth-server:v1\n'+nonce+'\n'+socketRealpath>","kernel":"8.0.0"}}
→ {"…","id":2,"method":"auth","params":{"principal":"p:ascend","sig":"<Ed25519 'gnomon:auth:v1\n'+nonce+'\n'+serverKeyId+'\n'+principalId+'\n'+socketRealpath>"}}
   — or — "params":{"token":"<read-scoped token>"}        (read tokens: tokens.ts:137-154 constant-time resolve)
← {"…","id":2,"result":{"principal":{"principalId":"p:ascend","kind":"human","scope":"full"},"connId":"conn:…"}}
```
The client verifies `serverSig` against the registry's kernel key before sending `auth` (a relay that cannot sign as the kernel is detected); the nonce is valid 30 s and single-use; a failed `auth` closes the socket after one `refusal:v1 {code:'AUTH'}`. Identity is bound per connection (`connId` on every event). Node has no peer-credential API, so socket mode + mutual signatures are the whole boundary (stated, S-H4).

**Calls:** `{"method": <verb>, "params": {...}}` → `{"result": <shape verbatim, G3>}` or `{"error": {"code": <int>, "message": <prose>, "data": <refusal:v1>}}`. Total code map: AUTH -32001, FORBIDDEN -32002, NOT_FOUND -32004, UNSUPPORTED -32005, BAD_REQUEST -32600, UNKNOWN_VERB -32601, ENGINE -32000, BUDGET_DENIED -32010, PERMIT_REQUIRED -32011, CAS_LOST -32012, INTEGRITY_BROKEN -32013, GATE_REFUSED -32020, CLAIM_BREACH -32021, TRUST_HELD -32022, STALE_BASE -32023 (verdict-class codes normally ride inside results).

**Subscription:** `log.read {since?, kinds?, scope?, follow:true}` returns the backlog then streams `{"method":"event","params": <event:v1>}`. Backpressure: > 10 000 undelivered frames ⇒ drop + `socket.subscription.dropped{connId, lag}`; client re-subscribes with `since`. Redaction per the matrix in §9.3.

**Limits:** 4 MiB/frame; a longer line is discarded to its newline and answered `BAD_REQUEST`.

---

## 5. Kernel ABI — twelve verbs (law 3)

Everything else is CLI-only (human, possession of the box with the limits of §A.1: `gnomon init|key mint|trust|install|uninstall|approve <cardId>|log verify|segment|export|daemon start|stop|replay|learn`) or userland. `status` is the man page (F4, TD-2026-07-21-766): principal, legal next verbs for the caller's position, verb→tool map, and `abiId` (descriptor table + next-verb rules + tool-name law hashed exactly as `descriptors.ts:383-393`). The MCP proxy registers ≤ 12 tools named by the `descriptors.ts:269-271` law.

| # | Verb | Params | Result | Refusals | Human | Agent (roster) | Session | Read token |
|---|---|---|---|---|---|---|---|---|
| 1 | `status` | `{}` | `{principal, kernel, daemon, sessions[], budget{ladder}, inbox{pending by kind}, unknownClaudeProcesses{n}, next{verbs,because}, toolMap, abiId, untrusted}` | AUTH | ✓ | ✓ | ✓ | ✓ |
| 2 | `session.open` | `{backend, cwd, mode?, as?: rosterPrincipal, goal?, contract?, alias?, derived?, permitId?, model?, systemPrompt?}` | `{hsid, principalId, state}` | PERMIT_REQUIRED (spawn only), BUDGET_DENIED, UNSUPPORTED(preflight), FORBIDDEN(scope/alias) | ✓ | ✓ permit; child scope ⊆ own | ✓ permit | ✗ |
| 3 | `session.send` | `{hsid, content[], permitId}` | `{turn}` | PERMIT_REQUIRED, BUDGET_DENIED, NOT_FOUND, BAD_REQUEST | ✓ | own subtree | own subtree | ✗ |
| 4 | `session.stop` | `{hsid, interrupt?}` | `{signals[], exited}` | NOT_FOUND, FORBIDDEN | ✓ | own subtree | own subtree | ✗ |
| 5 | `log.append` | `{kind, payload?, ref?, causes?, scope?, idem?}` | `{id, seq, hash}` | FORBIDDEN(kind not granted / kernel-owned), BAD_REQUEST | granted kinds | granted kinds | **none** | ✗ |
| 6 | `log.read` | `{since?, kinds?, scope?, follow?}` | backlog + stream | AUTH, BAD_REQUEST | full | redacted sensitive | own scope, redacted | redacted (§9.3) |
| 7 | `permit.reserve` | `{kind, scope, model?, limits?, tool?, input?}` | `permit:v1` | BUDGET_DENIED, FORBIDDEN(scope escalation) | ✓ | ✓ | ✓ (own scope; `tool.permission`) | ✗ |
| 8 | `approve` | `{cardId, decision: allow\|always\|deny\|resume\|resolve\|accept\|reject\|install, note?, decisionSig}` | `card:v1` | FORBIDDEN, NOT_FOUND, AUTH(bad decisionSig) | ✓ | ✗ | ✗ | ✗ |
| 9 | `contract.register` | `{contract: contract:v1}` | `{contractId, nodes}` | BAD_REQUEST(schema, hash mismatch, node without oracle), FORBIDDEN(repo scope) | ✓ | ✓ | ✓ | ✗ |
| 10 | `contract.claim` | `{contractId, nodeId, expect:{status, seq}}` | `{claimed, nodeId, by, seq}` | CAS_LOST, NOT_FOUND | ✓ | ✓ | ✓ | ✗ |
| 11 | `oracle.run` | `{contractId, nodeId, oracle}` | `oracle:v1 {pass, evidence, ranBy:'p:kernel', reviewer?}` | PERMIT_REQUIRED(reviewer), UNSUPPORTED, ENGINE | ✓ | ✓ (requests) | ✓ (requests) | ✗ |
| 12 | `ref.resolve` | `{ref}` | `{target, hash?}` | BAD_REQUEST, UNSUPPORTED, NOT_FOUND | ✓ | ✓ | ✓ | ✓ |

**Namespace ownership (A-ABI-matrix, S-M2).** Kernel-owned namespaces — `daemon socket key session turn permit budget approval manifest schedule contract.registered|claimed|released|knot|progress oracle warpline merge liveness config` — are appendable by **no** principal through `log.append`; only kernel modules write them. Userland namespaces — `paradigm inject credit broke detector loop tend decay calibration verdict.note flow neurons` — are appendable only by a principal bound to a manifest whose grant row lists the kind (`grant.bind{principal, manifestHash, kinds[]}`, root-signed, §12.4). Session principals have no `log.append` at all; what a session does is observed by the supervisor and recorded by it.

**Matrix invariants (`G-ABI-02`).** `approve` is the only HUMAN_ONLY verb; `approve` requires `decisionSig` by the deciding human's key over `(cardId, decision, contentHash)` (D12). Read tokens may call only `status`, `log.read`, `ref.resolve` (`READ_ONLY_VERBS` pattern `protocol.ts:138-144`, checked before dispatch `server.ts:206-212`). A session never widens scope. `status` answers in < 50 ms with no engine work (`G-ABI-03`).

**Next-legal-verbs** (data, hashed into `abiId`, first match wins, `descriptors.ts:304-347` pattern): `{budgetPaused:true} → [status, log.read] "a budget card awaits a human; watch log.read for approval.decide"` · `{cardsPendingForYou>0, kind:'human'} → [approve]` · `{noSession:true} → [session.open]` · `{noPermit:true} → [permit.reserve]` · `{hasContract:true, unclaimed>0} → [contract.claim]` · `{claimed:true, built:true} → [oracle.run]` · `{} → [status]`.

---

## 6. Spawn (`$spawn`)

### 6.1 Generic path

1. `permit.reserve{kind:'session.spawn'}` — refused ⇒ nothing else happens (law 1). Interactive registration (`derived:true`) skips this step; its turns are metered usage-only.
2. `#identity` mints `p:s-<hsid-short>` with an ephemeral key under `~/.gnomon/sessions/<hsid>/` (0700/0600), parent = caller; in Warpline mode the session is bound to `as:<roster principal>` whose Warpline credential it borrows (D14).
3. `session.open` appended; hsid issued.
4. Preflight (§3.3) — failure ⇒ `session.refused` + `budget.release`.
5. `#manifest-loader` writes `policy.json` (permissions from distro + mode; `hooks.PermissionRequest` → `gnomon hook permission`; `SessionStart|Stop|PostToolUse` → `gnomon hook <event>`) and `mcp.json`; `layersHash` computed; a worktree `.claude/**` that differs from the base revision ⇒ `gate-class` card before spawn (§12.7).
6. `session.inject` for every byte added to the model's context: `origin:'client'` for a client-supplied system prompt (constellation, `agents.ts:336,452`), `origin:'kernel'` for the one Warpline pointer line — logged BEFORE spawn with hash and bytes.
7. Spawn (§3.3); `session.spawned`.
8. Turns: each `session.send` needs a `turn` permit; `turn.event` per line; `turn.usage` per assistant message; `turn.result` → `budget.usage`.
9. Exit/stop: staged stop, `session.exited`, session key deleted, worktree left in place.

### 6.2 Warpline-native path (projects whose base revision declares `mode: warpline`)

Preconditions: `.gnomon/project.yaml` at the base revision says `mode: warpline` (§12.7); the roster principal named by `as` has a Warpline key file and agent-class daemon token minted by the human (`warpline key mint`, `warpline daemon token mint … --kind agent`); `warplined` is reachable or activatable for the root (`lifecycle.ts:44-50`). The kernel is a **re-derived `warplined:v1` NDJSON client** (`protocol.ts:31,60-110` frames; the engine is never imported); it may start `warplined` for a root (`warpline daemon start`), never mint its credentials (A-warplined). Four kernel duties (05; TD-950 §3; amended by D14):

1. **Select** the roster credential: `WARPLINE_AGENT_ID=<as>`, `WARPLINE_MCP_TOKEN=<that agent's token>` from `.warpline/daemon/mcp-tokens.json` via the keyed-store rule (`tokens.ts:205-232,295-320`); refuse spawn if the roster agent has no credential (`UNSUPPORTED`, never a kernel mint).
2. **Env**: the two variables above in the allowlisted env (§3.3).
3. **Deny** in `policy.json`: Warpline human-class verbs on every skin — `resolve`, `stake`, `stake.recover`, `backup` (`protocol.ts:115-120`), `--accept-breach/--accept-risk` (`:148-151`), `branch --protect/--unprotect` (`:161-164`), `merge --confirm` (`:175-177`) — plus `Read`/`Bash` denies on `.warpline/keys/**`, `.warpline/daemon-tokens.jsonl`, `.warpline/daemon/mcp-tokens.json`, `.warpline/daemon/mcp.token` and `~/.gnomon/keys/**` (TD-2026-08-23-136 M3-Q5; S-H5). These denies are **advisory string matches** (bypassable by `python -c`, scripts on disk, `env -u WARPLINE_AGENT_ID`); the enforced boundary is `warplined`'s verb × principal matrix for keyed callers (`server.ts:215-233`). Warpline is asked to serve `resolve` only to keyed principals so the CLI's unmarked-shell hole closes (§17).
4. **Attach**: `git worktree add .gnomon/worktrees/<hsid-short>`; `fork` the scratch ref through the daemon (`forkNative`, `native.ts:260`); per-session line `refs/heads/gnomon/<hsid-short>`. Selvage is read-only to agents; the kernel watches `.warpline/refs/heads/selvage` with `fs.watch` (no polling) and appends `warpline.selvage.moved{ref}` so sibling sessions re-predict; a `refs.watch` verb is requested from Warpline to replace the fs watch (§17).

**The one logged pointer line (F4).** `--append-system-prompt "Warpline project. Run \`warpline status\` (or the warpline_status tool) before your first write."` — exactly one kernel-added line, `session.inject{origin:'kernel', kind:'warpline.pointer'}`. The skill is installed and discoverable, never pushed into turn one (10 §5.2); teaching is carried by Warpline's `status` result and `refusal:v1.next[]` (`descriptors.ts:383-393`). `G-SPN-05`: kernel-origin injected bytes for a Warpline-native spawn equal that line, byte-for-byte; client-origin bytes are logged separately and uncapped.

**Sealing and KNOTs.** `PostToolUse` does not seal on every edit (41 s absorb, `hook.ts:30-34`); the session calls `propose` when it claims a node built; admission runs as the **shadow** oracle (§7.3); a shadow KNOT ⇒ `warpline.knot{payloadId}` + `knot` card; the human resolves via `approve{decision:'resolve'}` and then `warpline resolve` on the CLI (HUMAN_ONLY, FG-1) — the kernel never calls `resolve`. `G-SPN-06` (restated, S-H5): an agent-class `resolve` through the daemon or MCP skin is `FORBIDDEN` and logged as a W3 attempt; unmarked CLI shells are outside this measurement and said so in the result (`skinScoped:true`).

**Revisit trigger** for the per-user-kernel/per-repo-warplined split: > 3 concurrently active Warpline repos or daemon RSS over budget (A-warplined).

### 6.3 Git-mode path

Same generic steps; attach = `git worktree add .gnomon/worktrees/<hsid-short> -b gnomon/<hsid-short> <base>`. Landing = the `merge-ci` oracle (§7.3): `git merge-tree --write-tree base head` read-only; conflicts ⇒ `merge.conflict` + a `merge-conflict` card (an inbox item **without semantic judgment**); clean ⇒ fast-forward onto `gnomon/integration` only after the `ci` command from the **base revision's** `.gnomon/project.yaml` (A-OPEN-10 answered: local command) is green inside the sandbox (§12.5). Protected branches (`main`) are never written by the kernel. Git conflicts are logged as contested/uncontested counts per repo (12 §6).

---

## 7. Spec-as-contract (P8-R2, TD-950 §6)

### 7.1 The compiler (`#contracts-compiler`, userland, deterministic, no LLM)

Lives in `packages/paradigm/src/core/contracts/` as the `plan` stage of `paradigm pipeline` (today `pipelineAdvanceCommand` only flips statuses, `pipeline/index.ts:131-162`; `STAGE_ORDER` specify→plan→task→implement→validate at `core/pipeline-types.ts:67`, imported `pipeline/index.ts:16`). Output is handed to the kernel with `contract.register`. Rules (A-G-HON-01):
1. Parse Markdown into sections and blocks. A **section** is opened by a NUMBERED ATX heading (`## 3.`, `### 3.2`, `## A.`, `### A.1`); an unnumbered heading does not change the current section. Fenced code blocks are never scanned. Sections whose heading ends with `(compile: skip)` are never scanned, nor are their subsections. Text before the first numbered heading is the `preamble` section.
2. A **node candidate** is a whole inline code span whose entire content matches `^[#$^!~][a-z][a-z0-9-]*$` (prefix + kebab name), appearing in headings, prose or table cells. Prefixed words outside code spans, and code spans with any other content (`sym:#x`, `node:…/sym:#x`, `#` alone), are not candidates.
3. Node identity = the ref (`sym:` + span text); kind from prefix; `section` = the number of the section where it first appears; one node per ref.
4. A **test id** is a token matching `\bG-[A-Z]{2,4}-\d{2}[a-z]?\b` inside or outside code spans; a range written as the id's prefix followed by `NN..MM` expands to each ordinal. A test id **binds to the nodes mentioned (as candidate spans) in its own table row, when it sits in a table row, plus the nodes mentioned in the section's heading; a test id outside a table binds to every node mentioned anywhere in the same section**; a test id whose row and section mention no node binds to the nodes mentioned in the nearest ancestor section; if no ancestor mentions one, it binds to the `doc` node declared by a line beginning `Deliverable: <kebab-name>` (exactly one such line in the spec, else refusal) and is listed under `orphanTests`.
5. `deps`: only from an explicit line `Depends on: <span>, <span>` inside a section that mentions exactly one node (deterministic; prose phrasing is never parsed for dependencies). This spec declares none.
6. Oracles: every node gets `exists`; `test` per bound id; gate nodes (prefix `^`) get `gate-check`; flow nodes (prefix `$`) get `ripple-clean`; every node gets the mode's admission oracle and `reviewer`. A node with no bound test and no explicit `Oracle: exists` line in its first-appearance section ⇒ refusal.
7. Canonicalize (nodes sorted by ref), hash, emit. Byte-identical output for identical input (`G-CTR-01`); no clock in the hash.

### 7.2 Node kinds

`symbol` · `gate` · `flow` · `signal` · `aspect` · `test` (an id with no section node and no doc node — a refusal unless a `Deliverable:` exists) · `doc` (the `Deliverable:` line).

### 7.3 Oracles and the three-oracle certification

| Oracle | Runs | Evidence | Deterministic |
|---|---|---|---|
| `exists` | `ref.resolve(sym:…)` via the premise-core resolver | symbol entry hash | yes |
| `test` | the repo's test command filtered to the id, in the worktree, inside `#oracle-sandbox` (§12.5) under `p:kernel` | exit code + stdout hash | yes |
| `gate-check` | portal.yaml has the gate; routes citing it resolve | portal hash | yes |
| `ripple-clean` | `paradigm ripple` reports no dangling refs | report hash | yes |
| `admission` (Warpline) | `warplined admit {shadow:true}` (`protocol.ts:43` shadowAdmit) of the session's proposal onto selvage returns `CLEAN\|FAST_ADMIT`; the **real** `admit` runs only after `^certified` (A-boundary-3) | shadow row id; later `wl:pick/<pickId>` | yes |
| `merge-ci` (git) | `git merge-tree` clean onto base AND the base revision's `ci` command green in the sandbox | tree sha + CI exit | yes |
| `reviewer` | one `claude -p` turn on the **subscription** under an `oracle.reviewer` permit (P8-D15), as roster principal `p:reviewer` (D14) ≠ the claimant's principal and ≠ any ancestor; **no tools** (policy denies every tool; `--permission-prompts none`), ≤ 1 turn, the diff enveloped as untrusted content, the spec section read from the base revision, strict output schema `{pass, reasons[], riskyUnits[]}` (anything else = fail), run inside the sandbox (S-H6) | verdict hash + reviewer principal | no |

**Certification** (`^certified`): `exists ∧ test ∧ (admission | merge-ci) ∧ reviewer`, each logged as `oracle.result{nodeId, oracle, pass, evidence, ranBy:'p:kernel', reviewer?}` signed by the kernel key (10 §4: an agent claims, only the kernel certifies). The gate's own tests are `G-CTR-04`, `G-CTR-05`, `G-CTR-06`, `G-CTR-08` and `G-CTR-09` (§15.2). TD-950 §6 ratifies the reviewer for 8.0 over Arky's deferral (10 §4); the cost is accepted and the reviewer MUST be calibrated (§8.6) or it is theatre (12 §3).

**Disagreement → KNOT.** Any pairwise disagreement ⇒ `contract.knot{nodeId, oracles, causes}` + `knot` card; in Warpline mode the card also points at the `knotPayload:v1` (`knot-payload.ts:56`) when the shadow admission knotted. Resolution is human (`approve{decision:'resolve'}`), logged as `verdict.founder`.

### 7.4 CAS claims

`contract.claim{contractId, nodeId, expect:{status:'open', seq}}` — appended as `contract.claimed` iff the node is `open` and no newer claim exists; otherwise `refusal:v1 {code:'CAS_LOST', gate:'claim', retriable:'retry-corrected', next:[{verb:'status'}]}` (A-manifest). Claims expire at permit `expiresAt` + 2 h without `contract.built` (dsh CAS task graph, 02 "Steal 3"); release = `contract.released`.

### 7.5 Progress = exists ∧ passes

`contract.progress` projection per node `{exists, passes:{oracle:bool}, certified, claimedBy}`; the aggregate is `{certified, total}` — always with its denominator. Rendered as the `contract.progress` block whose nodes light as `oracle.result` events arrive; the diagram moves only on events (Move 2 pass).

### 7.6 Git-mode variant and KNOT routing

Identical compile; `certification.required` swaps `admission` for `merge-ci`. Merge conflicts → `merge-conflict` card, no KNOT. Oracle disagreement → `knot` card in both modes (KNOT = "oracles disagree"; a Warpline KNOT is the meaning-level special case). Calibration keyed `(repo, mode)` keeps them apart (§8.6).

---

## 8. Learning loop (TD-950 §8; session.yaml `learning-loop.rules`)

The loop reads only the kernel log — never the Shuttle display, never notebook YAML counters (12 §1). `#learning-loop` is userland, bound to the `paradigm` manifest's grants for `inject.* credit.* broke.* detector.* loop.* tend.* decay.* calibration.*`.

### 8.1 Credit, defined

**Credit** = an entry that was *injected* into a turn whose *outcome was accepted*. Three counts, each with its denominator:
- `injected` — `inject.receipt{hsid, turn, entries:[{ref, tier, source_hash}], frozenSliceHash}` logged for the turn by the injecting userland (orchestration path that today calls `recordNotebookReference`, `orchestration.ts:866-876`; the `orchestrationId` becomes `turn`). MCP notebook enrichment is thereby logged (S-M7).
- `credited` — `credit{turn, outcome:'accepted'}`: the turn's node certified, its PICK admitted, or `verdict.founder{accepted}` — never "the turn finished".
- `broke` — `detector.event{turn, class}` (§8.4) or later overturn (`grade.report` survival, `descriptors.ts:243-249`).
Today's `appliedCount` increments on INJECTION (`orchestration.ts:878-885` → `incrementApplied`, `notebook-loader.ts:426-442`) and the loader ranks by it (`notebook-loader.ts:148`) — a popularity loop (06 §1). 8.0 freezes `appliedCount` as a deprecated display field and ranks by `credited − broke`.

### 8.2 Re-enabling injection with credited ranking

`gnomon learn export` writes `.paradigm/learned/credit.jsonl` (a projection; A-OPEN-7 answered: file) with `{ref, injected, credited, broke, lastCredited, decayed, tier}`; `notebook-loader.ts` sorts by `credited − broke`, tie-break recency. One exploration slot in five is reserved for never-injected entries **restricted to T0/T1 or human-reviewed entries** (S-M7) so ranking cannot ossify on the seeded 28 (06 §6) without guaranteeing exposure to unreviewed material.

### 8.3 Decay write-back

60-day half-life after a 7-day grace, reset on credit; `confidence < 0.3 ⇒ query-only` (06 §5.2). Computed by `tend`, logged `decay.writeback{ref, from, to}`, and written to the entry's YAML `confidence` through the latest-wins path `reviseDown` uses (`notebook-loader.ts:465-515`).

### 8.4 Detectors

`detector.event{turn, class, evidence}` classes: `tests-fail-after-edit`, `tsc-fail-after-edit`, `warpline-knot`, `warpline-refusal`, `reviewer-dismissed`, `loop-thrash` (same files/symbols rewritten k=3 rounds with flat score, or a hunk reverted and re-applied — 06 §4), `repeat-symbol-failure`. The LLM contradiction judge and teacher drafting take `tend.llm`/`teacher.draft` permits; a teacher draft lands only through an `install` card (S-M6); denials are learning signal.

### 8.5 Loops and the loop ledger

Per round `loop.row{loopId, repo, iter, goal_ref, tests_passing, tsc_errors, diff_lines, files_touched, symbols_touched, tokens, verdict}` (06 §4). Progress = monotone improvement on something that cannot lie; past the thrash threshold the kernel pauses (`loop.paused`) and emits a detector event. Ship k=3 + budget cap.

### 8.6 Reviewer calibration, keyed by (repo, mode) — never pooled

For each `oracle.result{oracle:'reviewer', pass:true}` the loop checks survival (overturned PICK, detector on its symbols, founder reversal) and appends `calibration.reviewer{repo, mode, passes, laterBroke, window}` weekly; passes are weighted `1 − laterBroke/passes` when ranking contested nodes. ≥ 20 passes with 0 later-broke alongside a known field break ⇒ `uncalibrated` flag in the band (12 §3). Git-mode and Warpline-mode rows are never pooled (12 §6).

### 8.7 `tend` passes (law 5)

Trigger: ≥ 5 new learning events AND ≥ 10 min quiet, cancelled if the founder is active, ≤ once per hour (06 §2). Deterministic passes need no permit: dedupe (≥ 0.9 → propose merge), source-hash validation (drift ⇒ `stale` + ripple re-check), decay, calibration aggregate, nomination surfacing. LLM passes (contradiction judge, pairs sharing a symbol at ≥ 0.75) only under `tend.llm`. Output: `tend.digest{proposals}` + one `tend` card per proposal needing a human; T0/T1 never mutated without a card.

### 8.8 Liveness gates and the reader

`≥ 1 verdict.founder per working day`, `≥ 1 tend.digest per week`; violations append `liveness.violation` and light the band, never block. **The reader** (`gnomon learn read`, scheduler-triggered) auto-applies deterministic proposals, turns the rest into cards, and logs `digest.consumed{digestId, applied, carded, dropped}`; a digest unconsumed for 7 days is a liveness violation — "nobody consumes the outputs" (12 §7) becomes measurable.

### 8.9 Week-4 falsifiers

Credited reuse of loop-born entries ≥ 25 % of credited injections by week 4 and rising; repeat-failure rate per (symbol, class) halves after certification; certifications stop surviving at 100 % (06 §6; §16).

---

## 9. Observability (`~ample-internal-logs`)

### 9.1 Event taxonomy (closed per namespace; new kinds additive; owner column = who may append)

| Namespace | Kinds | Join keys | Owner | Sensitive |
|---|---|---|---|---|
| `daemon` | start, exit{reason}, lock.refused, segment, reexec | — | kernel | no |
| `socket` | connect, auth.ok, auth.fail, subscription.dropped{lag}, frame.dropped | connId | kernel | no |
| `key` | mint, rotate, registry.malformed{line}, registry.unsigned{line} | keyId | kernel (CLI) | no |
| `config` | loaded{hash,signed}, unsigned | — | kernel | no |
| `session` | open, alias, alias.rejected, refused{code}, spawned{…}, inject{origin,hash,bytes}, idle, respawn, exited, orphaned | hsid, cc alias | supervisor | inject bytes yes |
| `turn` | sent{permitId,contentHash}, event{type,seq}, usage{tokens}, result{usage,cost,permission_denials} | hsid, turn | supervisor | event bodies yes |
| `permit`/`budget` | reserve, grant, deny, release, usage, ladder, pause, resume{by}, breaker.open/close | permitId, hsid | broker (signed) | no |
| `approval` | request{card}, decide{decision,by,decisionSig}, expire, rule.learned{tool,matchExact} | cardId, hsid | broker (signed) | tool_input yes |
| `manifest` | load{hash}, refuse{code}, generate{files[]}, staged{hash}, installed{hash,cardId}, uninstall{diff} | manifestHash | loader | no |
| `schedule` | due{key}, dropped, tend.start/end | key | scheduler | no |
| `contract` | registered{contractId}, claim, claimed, released, built, knot{nodeId,oracles}, progress | contractId, nodeId, hsid | kernel | no |
| `oracle` | run{oracle}, result{pass,evidence,ranBy,reviewer?} (signed) | nodeId, hsid | kernel | evidence yes |
| `warpline` | pick, admit{status,shadow}, knot{payloadId}, resolve, selvage.moved — `ref:` wl | pickId, hsid, turn, nodeId | kernel | no |
| `merge` | tree{clean}, conflict{paths}, ci{exit}, landed | hsid, nodeId | kernel | no |
| `gate-class` | detected{paths}, decided | hsid, cardId | kernel | no |
| `inject`/`credit`/`broke` | receipt{entries,tier,source_hash,frozenSliceHash}, credit{outcome}, broke{class} | hsid, turn, contractId, entry ref | paradigm grant | no |
| `detector` | event{class,evidence} | hsid, turn, symbols | paradigm grant | no |
| `loop` | open, row{…}, paused{reason}, closed | loopId, hsid | paradigm grant | no |
| `tend`/`decay`/`calibration` | digest, proposal.fate, writeback, contested, reviewer{repo,mode,passes,laterBroke} | digestId, entry ref, repo+mode | paradigm grant | no |
| `verdict` | founder{cardId,accepted,note?} | cardId, nodeId, turn | broker (signed) | no |
| `liveness` | violation{gate,lastSeenAt}, digest.consumed | digestId | scheduler | no |
| `paradigm`/`flow`/`neurons` | event (bridged, `ref:`) | nativeId | their grants | no |

Every learning number ships as `{n, of}`; a bare count in a result or block fails CI (`G-HON-03`).

### 9.2 Join keys

`hsid` · `turn` (`turn:<hsid>/<n>`) · `contractId` · `nodeId` · `permitId` · `cardId` · `keyId` · `connId` · entry `ref` · `pickId` · `digestId` · `loopId`. Day-one learning rows are joinable on `hsid + turn + contractId + entry ref` (session.yaml rule 2).

### 9.3 Redaction matrix (one, total, tested — S-M3)

| Principal class | `session.inject.bytes` | `turn.event` bodies | `approval.request.tool_input` | `oracle.result.evidence` | everything else |
|---|---|---|---|---|---|
| human (full) | full | full | full | full | full |
| agent (roster) | own subtree | own subtree | own subtree | own nodes | full |
| session | own hsid | own hsid | own hsid | own nodes | own scope |
| read token | `{kind, hsid, at, hash}` | same | same | same | full |

`G-ABI-05` enumerates every (class, kind) pair.

### 9.4 Retention

Chain forever, segmented at 10⁶ rows; `session.inject` bytes forever; `turn.event` bodies and oracle evidence pruned at 90 days with `blob.pruned{sha}` (A-OPEN-6). Transcripts stay in `~/.claude/projects/<cwd>/<uuid>.jsonl`, referenced by `cc:`.

### 9.5 Library logging

All library code uses the Paradigm logger (`packages/paradigm-mcp/src/utils/mcp-logger.ts:3` `export const log = new ParadigmLogger(...)`; flow's Python port `headless.py:84`), never `console.log`. Operational logs (`~/.gnomon/logs/`) are diagnostic, not the kernel log.

### 9.6 Metrics in `status`

`appendP99Ms`, `rssBytes`, `openSockets`, `liveSessions`, `unknownClaudeProcesses`, `permitsOpen`, `cardsPending`, `chainSeq`, `headAnchorOk`, `lastSegmentAt`, `subscriptionDrops{n, of}`.

### 9.7 Honesty CI (law 2)

- `G-HON-01` the compiler reproduces Appendix A from this file byte-for-byte.
- `G-HON-02` grep-tests over `packages/gnomon` and the compiler: no `Math.random` outside tests/ids, no `simulated`/`Simulate`, no fake-latency `sleep(`, no hardcoded gains, no `consensus|neural|swarm|hive|queen` labels (ruflo `tool-honesty.test.ts` pattern, 09).
- `G-HON-03` every numeric field in `status`, blocks and `calibration.*` has a sibling `of`.
- `G-HON-04` manifest generation is a fixed point and `install → uninstall` leaves `~/.claude` and the repo byte-identical (law 4).
- `G-HON-05` no MCP proxy description contains "instead of"/"rather than" aimed at native tools.
- `G-HON-06` every guard test's name and assertion message states its scope (e.g. "no kernel path lets a session principal decide a card" — never "no agent can approve"), reviewed against §A.1.

---

## 10. The six laws as testable invariants (TD-950 §5)

| # | Law | Invariant | Falsifier test (scope stated per law 2) |
|---|---|---|---|
| 1 | No spawn without a permit | Every `session.spawned`/`session.respawn`/`turn.sent` has an earlier unconsumed `permit.grant`; the spawn function takes `permit:v1` as a required argument. | `G-LAW-01`: 5-session fan-out with user limit 3 ⇒ 2 `budget.deny`, 3 `session.spawned`, band shows 3 with spend. `G-LAW-01b`: no env var, config file edit, project file or CLI flag disables the fuse for kernel-spawned sessions (fuzz env names, unsigned config, project.yaml). Scope: kernel-spawned sessions; direct `claude -p` from Bash is outside the fuse (§3.4). |
| 2 | Honesty is CI | §9.7 in `npm test` and the release gate. | `G-HON-01..06`. |
| 3 | Tiny ABI | ≤ 12 verbs; ≤ 12 proxy tools; `abiId` frozen per release. | `G-ABI-01`, `G-ABI-04`. |
| 4 | Reversible by construction | One repo dir (`.gnomon/`, with `project.yaml` committed and only `worktrees/`, `sessions/` ignored) + one home dir; manifest-generated edits carry markers; uninstall removes exactly those; learned state exported or left intact. | `G-LAW-04`: install → one session → uninstall ⇒ repo `git status` clean except the committed `project.yaml`, `~/.claude` byte-identical, `~/.gnomon` removed or export path printed. |
| 5 | Nothing spends by default | Fresh install, no interactive session, 24 h ⇒ zero `permit.grant`; every spending scheduler job is manifest `opt-in`. | `G-LAW-05` (clock-advanced soak), `G-LAW-05b` (N worktrees ⇒ 1 timer per key). |
| 6 | Trust posture | No install scripts in `@a-company/gnomon*`; exact pins; `npm pack` lists only `dist`; signatures verified; `alpha` never `latest`. | `G-LAW-06`. |

---

## 11. Shuttle band (TD-950 §1,§4; socket-only)

**Shows.** One line above the prompt from a Claude Code Mod (`#shuttle`): live children `{n, of: limit}` with state and spend, inbox pending by kind, this session's hsid short + mode, budget rung, and in a contract session `certified/total` + selvage tip short. A keystroke opens the inbox pane (cards as `display-block:v1`).

**Feed.** Socket only, read-scoped token (`gnomon key mint shuttle --kind human --scope read`; `tokens.ts:178-185` structural pattern), `log.read{follow:true, kinds:[session.*, budget.*, approval.*, contract.progress, liveness.*]}` under the §9.3 read-token row. Never status files (10 §3). **The band never decides.** It holds no human key and renders no decision control that acts (S-M5): a card's "decide" affordance prints `gnomon approve <cardId> <decision>` for the terminal; the CLI signs with the human key (D12). Mod JS runs with the user's privileges; "trust tiers" for mods are a grant-table label with no runtime enforcement in 8.0 (§12.6, stated honestly).

**Mod-socket spike (M1.0, day 1, against a stub socket).** Prove a Claude Code Mod can hold an outside unix-socket connection for the session's life: connect, complete the handshake, receive ≥ 1 streamed event, reconnect after a daemon restart. `T-SHU-01` (telemetry/manual, §16) on Claude Code ≥ 2.1.288. If Mods cannot open a socket, fallbacks: (a) `UserPromptSubmit`-hook injection of the band text, logged as `session.inject{origin:'kernel'}`; (b) Mod-side `fetch` to a loopback HTTP skin of the same socket (opt-in; `protocol.ts:15-16` left that door). Neither is built unless the spike fails. OPEN: the Mod API surface for bands and external connections is undocumented in this repo (§17).

**Motion-on-events.** The band repaints only on event frames; no timers, no polling, no causeless animation; a `budget.ladder`/`contract.knot` may use one transient emphasis ≤ 1 s. `G-SHU-02`: socket silent 60 s ⇒ zero reads, zero repaints. `G-SHU-03`: the band never issues a write verb.

---

## 12. Security model

### 12.1 Threats (Aegis stage-1 boundary: the OS user) and what holds

The core correction (S-C1): every spawned agent runs as the same OS user with Bash, so files and CLI commands are not a human/agent boundary; what the kernel provides in 8.0 is **attribution integrity + deliberate-cost + loud evidence**, not prevention (§A.1).

| # | Threat | Mitigation in 8.0 | Residual |
|---|---|---|---|
| 1 | Forged identity via env (`WARPLINE_AGENT_ID`, `CONSTELLATION_AGENT`) | kernel identity is key/token-stamped at the socket (I2) | Warpline CLI unmarked shells (H5) |
| 2 | A session approves its own card / resumes budget / resolves a KNOT | `approve` HUMAN_ONLY; `decisionSig` by the human key; session kind cannot authenticate as human | an agent that reads `~/.gnomon/keys/root.key` can sign as the human — accepted risk (D12); the attempt leaves a signature only the root key could make, so it is attributable to "someone with the key", not deniable |
| 3 | Runaway fan-out / quota drain (ruflo #2661) | fuse before process creation, per-message metering, pgid kill, breaker, band | out-of-kernel `claude -p` (stated) |
| 4 | Prompt injection via tool results, KNOT payloads (`descriptors.ts:52-61`), notebooks, neurons | untrusted-content sentence; T3 injected as untrusted; `inject.receipt`; reviewer has no tools | the reading model |
| 5 | Env/config bypass | no `*_DISABLE`; root-signed config; `GNOMON_HOME` ignored in production; project scope cannot set policy | — |
| 6 | Credential leakage into children | allowlist + scrub; settings scan; API-key sessions refused | — |
| 7 | Socket hijack / relay | 0600 socket, 0700 home, mutual auth bound to socket realpath, single-use nonce | no peer credentials in Node |
| 8 | Supply chain (ruflo postinstall, CVE-2026-59726) | law 6; kernel has zero runtime deps (`G-SEC-01`) | — |
| 9 | Malicious Mod | read-scoped tokens only; no `approve` from a band | Mod JS has user privileges (stated) |
| 10 | Log rewrite / db deletion | mandatory signatures, external anchors, missing-db = INTEGRITY_BROKEN | same-user attacker rewriting anchors + re-signing with disk keys (D12) |
| 11 | Project files set policy (`mode: none`, `ci: "true"`) | base-revision read; gate-class diffs → card (§12.7) | — |
| 12 | Oracle runs agent code on the key box | sandbox-exec profile (D13) | not a container (§A.2) |

### 12.2 Key custody

`~/.gnomon` 0700; `keys/` 0700, files 0600; registry public-only and root-signed; session keys ephemeral per hsid and deleted on exit; keys never under a repo, never in git (`.gnomon/worktrees/`, `.gnomon/sessions/` ignored; `.warpline/` already ignored, `tokens.ts:8-13`). Human boundary procedural (TD-136) with D12's mitigations; S4 custodian separation deferred with the revisit trigger (§A.1).

### 12.3 Socket auth, env allowlist, no bypasses

§4.9 mutual handshake; §3.3 allowlist + scrub + kernel additions; `G-SEC-02` asserts `session.spawned.envKeys ⊆ allowlist ∪ kernelAdditions` on every spawn. The production binary reads no `GNOMON_*` variable about itself; `GNOMON_HOME` exists only under `NODE_ENV=test`.

### 12.4 Capability grammar and grants

Capabilities: `log.append:<ns>.*` · `log.read` · `log.read:sensitive` · `ref.resolve` · `resolver:<scheme>` · `permit.reserve:<kind>` · `oracle:<type>` · `band:read` · `hook:<event>`. Grant rows (`~/.gnomon/grants.jsonl`, root-signed): `grant.capability{manifestHash, capabilities[]}`, `grant.bind{principal, manifestHash, kinds[]}`, `grant.trust{manifestHash, tier}`, `grant.install{manifestHash, cardId}`. Project manifests may request, never grant.

### 12.5 Sandbox / egress posture (P8-D13)

Every oracle run (`test`, `merge-ci`, `reviewer`) executes under `#oracle-sandbox`: a macOS `sandbox-exec` profile that denies reads of `~/.gnomon`, `~/.ssh`, the Keychain and `.warpline/keys`, denies all network, mounts the worktree read-only (a copy for `test`, so the oracle cannot edit what it judges), uses a scrubbed env with a throwaway `HOME`, and runs as a separate process group killed on timeout. The reviewer's `claude -p` runs inside the same profile with network allowed only to the subscription endpoint (OPEN: the exact host allowlist). Rootless containers (TD-735 §7) are the 8.1 target; Aegis's dissent (jobs never on the key-holding box) is recorded (§A.2). Sessions themselves run with Claude Code's `--permission-mode default` + the broker; no container in 8.0. Egress for manifests is declared and first-party/opted-in only (M2).

### 12.6 Mod trust tiers

`first-party` (ships in `plugins/paradigm`, hash in the release) · `signed:<gkey>` · `local`. Recorded as `grant.trust` rows; judged on provenance + hash, never self-description (10 §2). **Not enforced at runtime in 8.0**: Claude Code loads Mod JS with the user's privileges and the kernel cannot interpose; the tier gates only which read token the loader mints for the band (S-M5).

### 12.7 Project policy from the base revision (S-C4)

`.gnomon/project.yaml` (`mode`, `ci`, `repoId`) is **committed** and read by the kernel from the base revision — `git show <base>:.gnomon/project.yaml` (git mode) or the selvage tip's materialized tree (Warpline mode) — never from the worktree. Any diff a session produces that touches `.gnomon/**`, `.claude/**`, `CLAUDE.md`, test configuration (`vitest.config.*`, `jest.config.*`, `pytest.ini`, …), `package.json` scripts, lockfiles' `scripts`, or pipeline files (`.github/workflows/**`, `.warpline/pipeline*`) is **gate-class**: `gate-class.detected{paths}` + a `gate-class` card; oracles do not run and respawns are refused until a human decides. A worktree whose `mode` differs from the base revision's is refused `FORBIDDEN`.

---

## 13. Migration from 7.x

### 13.1 Order (each step lands green; 7.x CLI/MCP keep working)

1. **Envelope + identity as adapters** (Move 1): kernel log live; `.paradigm/events/stream.jsonl` rows mirrored as `paradigm.event` with `ref:"pev:<id>"` (dual-write); root key + roster agents' gkeys minted by the founder.
2. **One runner**: constellation's runner replaced by a socket client; flow's `headless.py` replaced by a Python client (flow keeps its chain; `log.read` streams the `{seq,at,event}` shape).
3. **Approval broker**: constellation cards and flow approvals/step-up render `card:v1`; Symphony file-requests become cards.
4. **Manifest-generated plugin files**: `plugin.json`, `.mcp.json`, `hooks.json`, the `FAMILY_META` listing become outputs of `manifest:v1`; `packages/paradigm/scripts/generate-hooks.mjs` is subsumed (JSON data generated, hook scripts stay in `src/commands/hooks/scripts/`); `G-HON-04` guards the fixed point.
5. **Ref resolver + cross-index**: `sym n td l t wl` resolvers registered by their packages.
6. **Learning**: `inject.receipt` + `credit` emitted under the `paradigm` grant; `appliedCount` frozen; loader reads the credit projection.
7. **Contracts**: `paradigm pipeline plan` compiles and calls `contract.register`; the `paradigm_pipeline` MCP family gains `compile|claim|progress` ops that proxy the kernel.

### 13.2 What never moves

`.purpose`, `portal.yaml`, symbols and the premise-core index · the neurons vault · Warpline fabric bytes, objects, refs, keys, tokens · flow's chain · constellation's op log · `~/.claude/projects/**` transcripts · notebook YAML bodies · lore and decision YAML. The kernel indexes by `ref:v1` and resolves by scheme — "the only index, not the sixth ledger" (05 §6.3).

### 13.3 Keeping 7.x CLI/MCP working

7.x verbs and MCP families are untouched in behavior; new ops are additive. The 7.x stop/pre-commit/post-write hooks keep running and, when the daemon is up, also emit `paradigm.event`. Their PermissionRequest behavior is unchanged (they are not wired to the broker). A machine without Gnomon sees no difference (`G-MIG-01`: the 7.x suite passes with `~/.gnomon` absent).

### 13.4 Deleting Conductor's Swift runner (M3.6)

`packages/conductor/Sources/Conductor/Services/ClaudeStreamSession.swift` (`--dangerously-skip-permissions` at `:183`, `:178-188`) is deleted in the same change that adds `GnomonClient.swift` (NDJSON over the unix socket; `session.open/send/stop`, `log.read`; mutual auth with the founder's key via the CLI-minted client credential) and makes Atrium render `display-block:v1` (A-migration-2). `G-MIG-02`: no `--dangerously-skip-permissions` string under `packages/conductor`; `swift build -c release` green.

### 13.5 flow and constellation adoption

constellation: `createAgents(deps)` (`agents.ts:121`) keeps its API; internals become socket calls; `tokenFor` (`agents.ts:165`) stays for constellation's own MCP tool-server auth only; its `systemPrompt` continues as a client-origin inject. flow: `HeadlessRunner`/`HeadlessProcess` (`headless.py:313,510`) retired after `G-RUN-04`; its closed error codes preserved inside `UNSUPPORTED` refusals; its PermissionRequest hook becomes a `card:v1` renderer. Move 1 pass: flow and constellation on one code path AND a 5-session fan-out stopped by the fuse with receipts (11 "Moves 1").

---

## 14. Package layout, naming, versioning

```
packages/gnomon-contracts/      @a-company/gnomon-contracts 1.0.0  zero deps; TS types + JSON Schemas for every §4 contract (schemas generated from TS, checked in)
packages/gnomon/                @a-company/gnomon 8.0.0            bin: gnomon, gnomond
  kernel/{identity,log,runner,supervisor,broker,budget,scheduler,manifest,refs,socket,sandbox}/   node: built-ins only; ESLint import fence
  adapters/claude-code/         stream-json driver + recorded-transcript conformance fixtures
  clients/{ts,python}/          thin socket clients (constellation imports ts; flow vendors python)
  cli/                          gnomon init|daemon|key|trust|install|uninstall|spawn|status|approve|log|learn|replay   (cli-output helpers)
  hooks/                        gnomon hook permission|session-start|stop|post-tool-use
  sandbox/                      the sandbox-exec profile(s), versioned and hashed into oracle.result.evidence
  test/                         G-* suites; honesty CI; falsifier harnesses
plugins/paradigm/mods/shuttle/  the Shuttle Mod (read-scoped client; built from gnomon-contracts)
packages/paradigm/src/core/contracts/        the compiler (userland; premise-core + gnomon-contracts)
packages/paradigm-mcp/src/tools/gnomon-proxy.ts   ≤ 12 tools generated from the ABI descriptor table
```
Deliverable: release-gate — the package-level checks `G-CON-01`, `G-CON-02`, `G-SEC-01`, `G-SEC-02`, `G-MIG-01`, `G-LAW-06` bind here.

Relations: `@a-company/paradigm` 8.0.0 depends on `@a-company/gnomon` (only `@a-company/paradigm` publishes; CLI bundles workspace deps) and declares the `paradigm` distro manifest; `@a-company/warpline` stays 0.x and is untouched by Gnomon's build (no re-export, no new dependency); `warplined` remains per-repo and the kernel is its NDJSON client. Plugin version `plugins/paradigm/.claude-plugin/plugin.json` bumps to 8.0.0 in lockstep. `abiId` and `gnomon-contracts` semver move together.

---

## 15. Delivery — three moves, proper-first

Each task: acceptance oracles (test ids) and a falsifier. Field metrics that cannot run in CI are `T-` telemetry gates (§16).

### 15.1 Move 1 — spike, log, identity, fuse, one runner, clients (`$move-1`)

| Task | Scope | Acceptance oracles | Falsifier |
|---|---|---|---|
| M1.0 Mod-socket spike | `#shuttle` skeleton connecting to a STUB socket from inside a Claude Code Mod, day 1 | `T-SHU-01` (manual: handshake + 1 event + reconnect on ≥ 2.1.288) | Mods cannot hold the connection ⇒ fallback chosen now, Move 3 re-planned |
| M1.1 `gnomon-contracts` | all §4 schemas; superset refusal | `G-CON-01` schemas validate their examples; `G-CON-02` every Warpline refusal validates against Gnomon's schema | a client needs a field not in the schema |
| M1.2 `#kernel-log` | chain (seq in txn, full-envelope hash), signatures, anchors, triggers, projections, verify, segment, blobs | `G-LOG-01` flipped byte detected; `G-LOG-02` UPDATE/DELETE abort; `G-LOG-03` inject-before-spawn; `G-LOG-04` 10⁶ appends p99 < 5 ms; `G-LOG-06` head ≠ anchor ⇒ INTEGRITY_BROKEN; `G-LOG-07` missing db + keys ⇒ refuse start; `G-LOG-08` unsigned mandatory kind refused | p99 > 5 ms or RSS > 150 MB at 10⁶ rows |
| M1.3 `#identity` | root key, root-signed registry/grants, gkey, principals, hsid issue + `v1d` derive, alias rules, read tokens | `G-ID-01` derived hsid deterministic across two hooks; `G-ID-02` unsigned/malformed rows surfaced, never resolve; `G-ID-03` swapped key file refused; `G-ID-04` alias squat ⇒ FORBIDDEN | a human principal mintable over the socket |
| M1.4 `#socket` + ABI | mutual handshake, 12 verbs, namespaces, subscribe, backpressure, `status`, `abiId` | `G-ABI-01` ≤ 12; `G-ABI-02` matrix total; `G-ABI-03` status < 50 ms; `G-ABI-04` frozen tripwire; `G-ABI-05` redaction matrix; `G-SOCK-01` unauthenticated ⇒ AUTH + close; `G-SOCK-02` relay without serverSig rejected by client; `G-SOCK-03` lag drop logged; `G-SOCK-04` `log.append` of a kernel-owned kind ⇒ FORBIDDEN for every class | a verb is added to serve a client |
| M1.5 `#manifest-loader` + policy generation | validate, grants, egress refusals, generate plugin files + per-session policy/mcp, layersHash, install card, uninstall | `G-MAN-01` egress refusals; `G-MAN-02` agent-written manifest needs a card; `G-HON-04`; `G-LAW-04` | install→uninstall diff non-empty |
| M1.6 `#session-runner` + `#supervisor` | lift agents.ts/claudeCli.ts, port headless.py extras, adapter + fixtures, per-message metering, gate-class check | `G-RUN-01` forbidden flags throw; `G-RUN-02` envKeys ⊆ allowlist; `G-RUN-03` staged stop kills the group; `G-RUN-04` recorded constellation + flow transcripts replayed through the adapter yield identical spool projections AND both client suites pass against the kernel in-process; `G-ADP-01`; `G-KRN-01`; `G-KRN-02`; `G-RUN-05` respawn charged as a launch | > 1 stream-json breaking change/month |
| M1.7 `#approval-broker` + `#budget-fuse` | permits incl. `tool.permission`, ladder, breaker, cards, `approve` with `decisionSig`, signed config, rule.learned | `G-BRK-01` deny on silence; `G-BRK-02` no kernel path lets a session/agent principal decide a card; `G-BRK-03` bad decisionSig ⇒ AUTH; `G-LAW-01`, `G-LAW-01b`; `G-BUD-01` usage only from stream events; `G-BUD-02` corrupt state ⇒ deny; `G-BUD-03` mid-turn breach kills pgid | fuse bypassed by any setting for kernel-spawned sessions |
| M1.8 `#scheduler` | log-derived timers, idle-exit, dedupe | `G-SCH-01` timers rebuild after restart; `G-LAW-05`, `G-LAW-05b` | a timer no event derives |
| M1.9 `$daemon-lifecycle` | lock, client activation + clean re-exec, idle exit, orphan sweep | `G-DMN-01` second daemon refused; `G-DMN-02` stale pidfile recovered; `G-DMN-03` client activation; `G-DMN-04` orphan stopped; `G-DMN-05` activator env never reaches the daemon | daemon exits with a live child |
| M1.10 Observability | closed kind registry, Paradigm logger, metrics, honesty CI | `G-HON-02`, `G-HON-03`, `G-HON-06`, `G-OBS-01` unknown kind refused | a kind lands without a schema |
| M1.11 `#oracle-sandbox` | sandbox-exec profile, read-only worktree copy, scrubbed env, timeout | `G-SBX-01` oracle cannot read `~/.gnomon`/`~/.ssh`; `G-SBX-02` no network; `G-SBX-03` worktree writes fail | an oracle reads a key |
| M1.12 Clients | TS client (constellation) + Python client (flow); card renderers | `G-CLI-01` same card decided from any client once; `G-RUN-04` (client half) | two UIs disagree on card state |

Guards before the fan-out test (S "Guards before Move 1" as ruled): M1.2 signatures/anchors (H1), M1.3 root-signed rows (C2), M1.5 base-revision policy + gate-class (C4), M1.9 clean re-exec (H3), M1.4 mutual auth (H4), M1.11 sandbox (C3 as ruled by D13), and D12's C1 mitigations in M1.3/M1.7. Pass (Move 1): flow and constellation on the kernel path AND a 5-session fan-out stopped by the fuse with receipts; the spike green or its fallback chosen.

### 15.2 Move 2 — `spawn 4` against one registered contract (`$move-2`)

| Task | Scope | Acceptance oracles | Falsifier |
|---|---|---|---|
| M2.1 `#contracts-compiler` | §7.1 in `paradigm pipeline plan`; `contract.register`; Appendix A reproduction | `G-CTR-01` determinism; `G-HON-01`; `G-CTR-02` node without oracle refused; `G-CTR-07` register rejects hash mismatch | compiler needs an LLM |
| M2.2 Claims + progress | CAS claims, expiry, progress projection + block | `G-CTR-03` two claimants ⇒ one `claimed`, one `CAS_LOST` | a claim lost or duplicated |
| M2.3 Oracles | exists/test/gate-check/ripple-clean/shadow-admission/merge-ci/reviewer in the sandbox; reviewer no-tools one-turn on subscription | `G-CTR-04` reviewer principal ≠ claimant and ancestors; `G-CTR-05` `oracle.result` always kernel-signed `ranBy:'p:kernel'`; `G-CTR-06` disagreement ⇒ knot card; `G-CTR-08` admission oracle is shadow, real admit only after certification; `G-CTR-09` reviewer output outside schema = fail | an agent certifies its own node |
| M2.4 Warpline-native spawn | credential selection, env, denies, attach, pointer line, fs.watch selvage | `G-SPN-01..04` duties observable; `G-SPN-05` kernel-origin inject = one line; `G-SPN-06` skin-scoped W3 logging; `G-SPN-07` kernel never calls mint | the pointer line grows |
| M2.5 Git-mode spawn | worktree/branch, merge-tree, base-revision ci, conflict card, contested counts | `G-GIT-01` conflict ⇒ card, no KNOT; `G-GIT-02` `main` never written; `G-GIT-03` `ci` read from base, not worktree | kernel writes `main` |
| M2.6 Field run | `gnomon spawn 4 --contract <this spec>` on a real repo | `T-FLD-01`, `T-FLD-02` (§16) | zero KNOTs ⇒ concurrency not produced; re-plan the subject |

Pass (Move 2): the first KNOT in Warpline's history, hydrated, zero W3 (skin-scoped); a progress diagram that moves without a human editing it.

### 15.3 Move 3 — Shuttle band + learning loop live (`$move-3`)

| Task | Scope | Acceptance oracles | Falsifier |
|---|---|---|---|
| M3.1 `#shuttle` band | blocks, read-scoped subscription, inbox pane, CLI hand-off for decisions, motion-on-events | `G-SHU-02`, `G-SHU-03` | band reads a file or holds a key |
| M3.2 `#learning-loop` credit | `inject.receipt`, `credit`, `broke`, projection, ranking, restricted exploration slot | `G-LRN-01` appliedCount frozen; `G-LRN-02` ranking changes for a replayable reason; `G-LRN-03` slot only T0/T1 | seeded 28 hold ≥ 75 % of credit at week 4 |
| M3.3 Detectors + loop ledger | deterministic detectors; `loop.row`; thrash pause k=3 | `G-LRN-04` thrash fixture pauses at round 3 | a loop runs past cap |
| M3.4 `tend` + reader + liveness | deterministic passes, LLM under permit, digest, reader, violations | `G-LRN-05` no LLM call without permit; `G-LRN-06` unconsumed digest ⇒ violation day 7; `G-LRN-07` decay written back | tend mutates T0/T1 without a card |
| M3.5 Reviewer calibration | `(repo, mode)` rows; `uncalibrated` flag | `G-LRN-08` never pooled; `G-LRN-09` flag fires | calibration pooled |
| M3.6 Conductor + clients render | `GnomonClient.swift` + delete `ClaudeStreamSession.swift`; Atrium blocks; Symphony onto the log | `G-MIG-02`; `G-CLI-01` | two UIs disagree |

Pass (Move 3): `gnomon replay` reproduces kernel-controlled inputs byte-for-byte with recorded layer hashes; `install → uninstall` diff empty; the 384/396 number changes for a replayable reason.

---

## 16. Falsifiers, telemetry gates, kill criteria

Telemetry gates (field metrics, read from the kernel log, not CI): `T-SHU-01` Mod holds the socket in a real session · `T-LOG-05` 30 days without an un-enveloped Gnomon-sealed strand · `T-FLD-01` ≥ 1 KNOT hydrated (`knotPayloadId` resolvable), zero skin-scoped W3 · `T-FLD-02` progress diagram advances with no human edit.

Falsifiers (pre-registered; the team tries to trip them, the founder decides):
1. Daemon adoption (07 Shape A): two weeks of dog-food with > 50 % of real sessions never `session.open` ⇒ promote the daemonless path.
2. Kernel creep (05 §6.1): `G-KRN-02` violation.
3. stream-json drift (05 §6.2): > 1 breaking adapter change/month ⇒ plugin-side primary integration.
4. Sixth ledger (05 §6.3): `T-LOG-05` fails.
5. Empty denominator (12 §6): `T-FLD-01` zero KNOTs ⇒ the thesis is untested, not refuted.
6. Learning (06 §6): week-4 credited reuse < 25 %, or 100 % certification survival, or both liveness gates at zero in a week.
7. Band (12 §2): `T-SHU-01` fails and no fallback ships in Move 3.
8. Performance: idle RSS > 150 MB or append p99 > 5 ms.
9. Accepted-risk tripwire (§A): any evidence of a session using the human key (an `approval.decide` the founder did not make) ends founder-only mode and pulls the Keychain/custodian work forward.

Kill criteria: (a) falsifier 1 trips twice running; (b) falsifier 3 trips and plugin-side integration cannot enforce permits; (c) the founder's honest read after Move 2 is that Claude Code alone with native Task and worktrees did the work better (the Bolt falsifier generalized, 07 Shape B).

---

## 17. OPEN questions

1. OPEN: Claude Code hook stdin — confirm `session_id` is present in `PermissionRequest`/`SessionStart` hook input on 2.1.288+ and whether `$CLAUDE_SESSION_ID` is also set (the hsid derivation reads one of them).
2. OPEN: The Mod API surface for bands and outbound connections is undocumented here; M1.0 answers it empirically.
3. OPEN (Warpline asks): a `refs.watch` daemon verb (replacing the kernel's `fs.watch` on `refs/heads/selvage`), and serving `resolve` only to keyed principals so the unmarked-CLI hole (S-H5) closes at the engine.
4. OPEN: The exact network allowlist for the reviewer's sandbox profile (subscription endpoint hosts).
5. OPEN: Linux anchor location when `$XDG_RUNTIME_DIR` is unset.
6. OPEN: Sequencing of the Atelier aesthetic session and the local HTML pitch (session.yaml `follow_ups`) — after Move 1 or Move 3.

Answered since v1 (removed): per-user kernel vs per-repo warplined (client, revisit trigger) · mode declaration (`.gnomon/project.yaml`, base revision) · S4 (accepted risk D12) · derived hsid (adopt) · activation (client only) · segment/blob policy · credit projection (file) · reviewer lane (D15) · CI source (local command from base) · strands for `warpline.*` events (no) · kernel triage owner (Arky triages kernel; Aegis owns broker/identity) · refusal schema (superset, no re-export).

---

## A. Accepted risks (founder-only 8.0; each has a revisit trigger)

### A.1 Human signing by key file + CLI (P8-D12; amends TD-2026-10-14-735 §4 for solo use)

Aegis rated this **critical** (S-C1): every spawned agent runs as the same OS user with Bash, so it can read `~/.gnomon/keys/root.key`, run `gnomon key mint --kind human`, `gnomon trust`, `gnomon install`, `gnomon daemon stop`, or sign an `approve` as the founder; string-matched deny rules are bypassable; the hole TD-136 accepted for Warpline now also covers the budget, KNOT, verdict and install cards. The founder accepts this for 8.0 because the only user is the founder and the alternative (Keychain/Secure Enclave with user presence per signature) costs UX on every decision.

Mandatory mitigations (all zero-UX-cost, all in Move 1): human-root-signed registry and grants rows (I5); kernel-owned log namespaces no principal may append (§5); mandatory signatures on `approval.*`, `oracle.result`, `budget.*`, `permit.*` (§3.2); per-approval `decisionSig` over `(cardId, decision, contentHash)` (§3.4); chain head anchored outside the db (§3.2); missing db with keys present = INTEGRITY_BROKEN (§3.2); deny rules on key paths, labeled advisory (§6.2); agent-shell refusal of human CLI verbs (I3). What they buy: an abuse leaves a root-key signature on a specific event, the daemon cannot be silently reset, and every forgery path requires reading a 0600 file rather than flipping a flag. What they do not buy: prevention. Guard tests state this scope (`G-HON-06`); `G-BRK-02` reads "no kernel path lets a session or agent principal decide a card", never "no agent can approve".

Revisit trigger: before any second human, any shared fabric, or 8.1 — whichever comes first — and immediately on falsifier §16.9.

### A.2 Oracles under sandbox-exec, not containers (P8-D13; amends TD-2026-10-14-735 §7 for solo use)

Aegis rated running agent-written code as `p:kernel` on the key-holding box **critical** (S-C3) and dissented on home-box runners in TD-735. The founder accepts a macOS `sandbox-exec` profile (deny `~/.gnomon`, `~/.ssh`, Keychain, `.warpline/keys`, all egress except the reviewer's subscription endpoint; scrubbed env; read-only worktree copy; separate pgid with timeout) as the 8.0 isolation, with rootless containers on a separate host as the 8.1 target. `sandbox-exec` is deprecated by Apple but functional; a profile escape or an unsandboxed oracle path is a release blocker (`G-SBX-01..03`).

Revisit trigger: same as A.1, plus any public repo or untrusted contributor.

---

## Appendix A — expected compile of this spec (compile: skip)

`specRef: spec:docs/specs/gnomon.md@<blobsha>` · `mode: warpline` · `certification.required: [test, admission, reviewer]` · `Deliverable: release-gate` declared in §14 · `deps: []` on every node (no `Depends on:` lines). Nodes keyed by ref, sorted by ref; `section` = first appearance (§7.1 rule 3); test oracles bound by rule 4 (row-level in tables, plus the section heading's nodes; section-level elsewhere). `exists`, `admission` and `reviewer` are implicit on every node; `gate-check` on the gate; `ripple-clean` on flows. 23 symbol/flow/gate/aspect nodes + 1 doc node = 24.

| ref | kind | section | test oracles |
|---|---|---|---|
| `sym:#approval-broker` | symbol | 2.1 | G-BRK-01, G-BRK-02, G-BRK-03, G-BUD-01, G-BUD-02, G-BUD-03, G-KRN-01, G-KRN-02, G-LAW-01, G-LAW-01b |
| `sym:#backend-adapter` | symbol | 2.1 | G-ADP-01, G-KRN-01, G-KRN-02 |
| `sym:#budget-fuse` | symbol | 2.1 | G-BRK-01, G-BRK-02, G-BRK-03, G-BUD-01, G-BUD-02, G-BUD-03, G-KRN-01, G-KRN-02, G-LAW-01, G-LAW-01b |
| `sym:#contracts-compiler` | symbol | 2.1 | G-CTR-01, G-CTR-02, G-CTR-07, G-HON-01, G-KRN-01, G-KRN-02 |
| `sym:#gnomon-kernel` | symbol | 2.1 | G-KRN-01, G-KRN-02 |
| `sym:#identity` | symbol | 2.1 | G-ID-01, G-ID-02, G-ID-03, G-ID-04, G-KRN-01, G-KRN-02 |
| `sym:#kernel-log` | symbol | 2.1 | G-KRN-01, G-KRN-02, G-LOG-01, G-LOG-02, G-LOG-03, G-LOG-04, G-LOG-06, G-LOG-07, G-LOG-08 |
| `sym:#learning-loop` | symbol | 2.1 | G-KRN-01, G-KRN-02, G-LRN-01, G-LRN-02, G-LRN-03 |
| `sym:#manifest-loader` | symbol | 2.1 | G-HON-04, G-KRN-01, G-KRN-02, G-LAW-04, G-MAN-01, G-MAN-02 |
| `sym:#oracle-sandbox` | symbol | 2.1 | G-CTR-04, G-CTR-05, G-CTR-06, G-CTR-08, G-CTR-09, G-KRN-01, G-KRN-02, G-SBX-01, G-SBX-02, G-SBX-03 |
| `sym:#ref-resolver` | symbol | 2.1 | G-KRN-01, G-KRN-02 |
| `sym:#scheduler` | symbol | 2.1 | G-KRN-01, G-KRN-02, G-LAW-05, G-LAW-05b, G-SCH-01 |
| `sym:#session-runner` | symbol | 2.1 | G-ADP-01, G-KRN-01, G-KRN-02, G-RUN-01, G-RUN-02, G-RUN-03, G-RUN-04, G-RUN-05 |
| `sym:#shuttle` | symbol | 2.1 | G-KRN-01, G-KRN-02, G-SHU-02, G-SHU-03 |
| `sym:#socket` | symbol | 2.1 | G-ABI-01, G-ABI-02, G-ABI-03, G-ABI-04, G-ABI-05, G-KRN-01, G-KRN-02, G-SOCK-01, G-SOCK-02, G-SOCK-03, G-SOCK-04 |
| `sym:#supervisor` | symbol | 2.1 | G-ADP-01, G-KRN-01, G-KRN-02, G-RUN-01, G-RUN-02, G-RUN-03, G-RUN-04, G-RUN-05 |
| `sym:$daemon-lifecycle` | flow | 2.4 | G-DMN-01, G-DMN-02, G-DMN-03, G-DMN-04, G-DMN-05 |
| `sym:$move-1` | flow | 15.1 | every `G-` id in the §15.1 table (58 ids: G-ABI-01..05, G-ADP-01, G-BRK-01..03, G-BUD-01..03, G-CLI-01, G-CON-01..02, G-DMN-01..05, G-HON-02..04, G-HON-06, G-ID-01..04, G-KRN-01..02, G-LAW-01, G-LAW-01b, G-LAW-04, G-LAW-05, G-LAW-05b, G-LOG-01..04, G-LOG-06..08, G-MAN-01..02, G-OBS-01, G-RUN-01..05, G-SBX-01..03, G-SCH-01, G-SOCK-01..04) |
| `sym:$move-2` | flow | 15.2 | G-CTR-01..09, G-GIT-01..03, G-HON-01, G-SPN-01..07 |
| `sym:$move-3` | flow | 15.3 | G-CLI-01, G-LRN-01..09, G-MIG-02, G-SHU-02, G-SHU-03 |
| `sym:$spawn` | flow | 6 | G-SPN-05, G-SPN-06 |
| `sym:^certified` | gate | 7.3 | G-CTR-04, G-CTR-05, G-CTR-06, G-CTR-08, G-CTR-09 |
| `sym:~ample-internal-logs` | aspect | 9 | G-ABI-05, G-HON-01, G-HON-02, G-HON-03, G-HON-04, G-HON-05, G-HON-06 |
| `doc:release-gate` | doc | 14 | `orphanTests` (28, from the preamble, §4, §5, §10, §12, §13, §14 and §A): G-ABI-01..04, G-BRK-02, G-CON-01..02, G-HON-01..06, G-KRN-02, G-LAW-01, G-LAW-01b, G-LAW-04, G-LAW-05, G-LAW-05b, G-LAW-06, G-MIG-01, G-MIG-02, G-RUN-04, G-SBX-01..03, G-SEC-01..02 |

Notes for the compiler author: §2.1's table is the first appearance of every symbol node, and `G-KRN-01`/`G-KRN-02` sit in §2.1 prose, so they bind to all sixteen symbols by the section-level rule. §15.1–15.3 tables bind row-by-row (Scope column spans) plus the `$move-N` heading node; a `T-` id is telemetry and never an oracle. §7.3's gate sentence binds the five certification ids to `^certified` and to `#oracle-sandbox` (mentioned in the same section). Sections with ids but no node mention (and no ancestor mention) feed `orphanTests`; §9.7 is NOT orphan because §9's heading mentions the aspect. Appendix A itself and §0 are skipped, so none of their spans create nodes.
