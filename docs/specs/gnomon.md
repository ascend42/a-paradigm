# Gnomon — Paradigm 8.0 build spec (the kernel and shell beneath the armada)

Status: BUILD SPEC v3, not yet built. Decision TD-2026-10-16-950 (the ten rulings) · founder rulings P8-D12..D35, requirements P8-R1..R4 (lore L-2026-10-16, tag `paradigm-8`) · Atelier session `.atelier/sessions/2026-10-15-paradigm-8-spec/session.yaml` · Research `.paradigm/research/paradigm-8/00–21` (14/16 Aegis, 15/17 Arky, 18 QM, 19/20 voice, 21 TUI + mods).
Packages: `packages/gnomon` (`@a-company/gnomon`: kernel, adapters, CLI), `packages/gnomon-contracts`, `packages/gnomon-tui`, `packages/gnomon-mod-sdk`, `packages/gnomon-voice`. Branch `ideate/paradigm-8` → `feat/gnomon`.
Reads with: `warpline-v3-identity.md`, `warpline-fabric-schema-v2.md`, `warpline-engine.md`, `warpline-forge.md` G1–G5.
Audience: 8.0 is for the founder (dog-fooded on real repos, on macOS AND Windows, iterated live); 8.1 is for the world (P8-D1). "8.1" marks what is deliberately out of this build; §21 holds the team roadmap.

This document is itself a contract source (§7, P8-R2 dog-food): every component, flow, gate, signal and aspect named here as a whole code span with its symbol prefix is a node the compiler (§7.1) must extract, and every node carries an oracle (a test id, or an explicit `exists` declaration). A node without an oracle is a compile refusal. Appendix A is the hand-written expectation; honesty test `G-HON-01` is that the compiler reproduces it.

Vocabulary rule (TD-950 §1): no swarm, hive, queen, consensus or neural anywhere. Collective noun **armada**; a running session is a **session**; a spawned set is a **fleet**. Labels never imply a mechanism the code lacks (law 2).

Platform rule (P8-R4): everything in this spec runs on macOS and Windows (Linux follows macOS where POSIX suffices). Every platform-specific mechanism names its Windows counterpart in §16, and every `G-` test that touches process, file, socket, key or sandbox behaviour runs on both OS matrices (`~windows-parity`, §16).

---

## 0. Changes in v3 (compile: skip)

v2's change table is in git history (commit on `ideate/paradigm-8`). Ids: `D` founder rulings, `R` requirements, `A17-` Arky v2 confirmation (17-arky-v2-confirm.md), `S16-` Aegis v2 confirmation (16-aegis-v2-confirm.md), `Q` QM scout (18), `V` voice scouts (19, 20), `T` TUI/mods scout (21).

| Id | What changed |
|---|---|
| D26, D27 | PIVOT. Gnomon's own TUI (`#tui`) is the primary shell for local AND Claude sessions; Claude Code is a headless backend driven by `claude -p` on the subscription. "Claude Code is the shell" reversed in §1, §2, §11, §19; "do not write a shell" removed from non-goals. Modding is day one and agent-maintainable (§12). |
| D20–D23 | Local lane in Move 1: two backend adapters from day one (`#claude-adapter`, `#local-runner` on pi-agent-core + pi-ai with the llama.cpp compat preset, tool-capability probe, argument repair, text-tool fallback); every task/automation declares `model: local \| claude \| any`; local-marked work falls back to cloud only via an approval card, unattended work waits; the fuse gains a compute dimension (concurrency + time per machine); teacher→skill flywheel in 8.0 (§13, §8.4). |
| D24 / Q1–Q7 | Seven team-readiness schema changes: device keys under one principal; namespaced principal ids (`p:<ns>/<name>`) and `log` = genesis logId; `signer` on registry rows; `org`/`team` reserved (null) in event + permit scope; cards carry `requestedBy`, `approverPolicy`, `attended`, approver in the `gnomon:approve:v1` preimage; `audience`/`sensitivity` on events; `hsid:v1d` keyed on the namespaced principalId (§3.1, §4). New §21 "8.1 for teams". |
| D25 / S16-1 | Key split: root key in Keychain (macOS) / Credential Manager + Windows Hello with user presence for registry, grant and config writes; approvals on a key file; kernel-spawned sessions (every mode) run under a sandbox profile denying `~/.gnomon/keys` and the Warpline token files. §A.1 rewritten honestly. |
| D32 / T | TUI renderer `@earendil-works/pi-tui` with panes, virtualization and width-keyed line caches (deepseek-harness's long-session lesson); OpenCode topology — the TUI is a client of `gnomon-rpc:v1`, the kernel owns sessions; Shuttle becomes a TUI view; the Claude Code Mod band is optional and its spike is demoted (§11). |
| D33 / T §5 / S-M6 | Mods out of process (one child per mod, stdio JSON-RPC), `manifest:v1` extended (`abi`, `tools` with declared effects, `views` with slots + fixtures, `commands`, `keybindings`), closed view kit, effects enforced at the boundary by `#mod-host`, approvals only from kernel-signed cards, `gnomon mod types\|test\|inspect`, agent install → audit card + rollback (§12). |
| D34 | `claude -p` driver adds `--include-partial-messages` (`agents.ts:447-454` + `:454 --model` cited); `AskUserQuestion` and `ExitPlanMode` are card kinds (§3.3, §4.5). |
| D35 | Law 7 SUBSCRIPTION-ONLY (`^subscription-only`): preflight refuses any session whose env/settings would bill API credits; API-token use only via a dedicated human-only card per use, persistent band indicator + `billing.api.*` events; the fuse tracks subscription usage windows (§3.4, §10). OPEN 7: Anthropic terms for distributing subscription-driven headless sessions in 8.1. |
| R3, D28–D31 / V | Voice (`#gnomon-voice`, `$voice-turn`): sherpa-onnx core (Silero VAD, Parakeet, diarization, Kokoro) cross-platform, FluidAudio optional Mac backend; push-to-talk default + conversation mode with barge-in; local-only in 8.0; `voice.*` events with `text_planned`/`text_spoken`/`interrupted_at_ms`; speak only speakable summaries; local-model acknowledgement bridges Claude latency; session-end compaction to a lore record linked to raw turns; text-only redacted sharing with per-speaker consent; audio not kept by default; lifts named with file:line (§14). Voice is Move 4. |
| R4 | Windows everywhere: §16 maps every platform-specific piece (unix socket → named pipe; sandbox-exec → restricted-token/ACL backend citing deepseek-harness `packages/sandbox/sandbox-windows-acl`; Keychain → Credential Manager + Windows Hello; launchd → client activation now, Task Scheduler/service 8.1; MLX/CoreML → cross-platform engines with Mac boost; 0700/0600 → ACLs; pgid kill → job objects); both OS in every relevant test (`~windows-parity`). |
| A17-a | The kernel presents a human-minted agent-class Warpline token for principal `gnomon-kernel` when it runs the shadow admission oracle; it still never mints (§6.2). |
| A17-b | Node ids no longer embed the contractId: `nodeId` = the ref, scoped by `contractId` in every event; `contractId` hashes `{specRef, mode, nodes[ref, kind, oracles]}` only (§4.7). |
| A17-c | Fuse (M1.6) precedes the runner (M1.7); `G-KRN-01` and `G-RUN-04` sit in M1.12 clients (§19). |
| A17-1 | `contract.built` has a producer: `contract.claim{op: claim \| built \| release}`; `contract.*` lifecycle kinds are kernel-owned (§5, §7.4). |
| A17-2 | `(compile: skip)` applies to ANY heading, numbered or not, until the next heading of equal or higher level (§7.1 rule 1). |
| A17-3 | Namespace ownership has a default: anything not listed as a userland grant is kernel-owned; `verdict.founder`, `gate-class.*`, `blob.pruned`, `digest.consumed`, `loop.paused` listed (§5, §9.1). |
| A17-4 | Repo id = sha256(root-commit sha + `:` + `project.yaml` `repoId`), defined for shallow/multi-root repos by the committed `repoId` (§4.1). |
| A17-5 | `CAS_LOST` exit code 7; the `paradigm_pipeline` family compiles locally and calls `contract.register` (no kernel compile); Session column: no `contract.register`; `permit.release` (§4.6, §5, §13). |
| S16-2 | Kernel git hardening: every kernel git invocation runs `-c core.hooksPath=<empty dir> -c core.fsmonitor=false -c core.sshCommand=false -c protocol.allow=never`; `.git/config`, `.git/hooks/**`, `.git/info/**` hashed into `layersHash`; change = gate-class (§3.3, §6.3). |
| S16-3 | Sandbox profiles are default-deny (reads, writes, mach-lookup, process-exec) with explicit allow rules; "mount read-only" replaced by write rules on a copy; escape tests `G-SBX-04..06` (osascript, launchctl, open; Windows: PowerShell, `explorer`, scheduled tasks) (§15.5). |
| S16-4 | Named reviewer profile `gnomon-reviewer` (Keychain item for Claude's OAuth reachable, Anthropic hosts only per P8-D17, `~/.gnomon`/`~/.ssh` denied) — stated as weaker than the test profile (§7.3, §15.5). |
| S16-5 | Overclaims removed; `approval.decide` records `cli:{pid, ppid, pgid, tty}`; approvals with no TTY or a live session pgid in ancestry are flagged `approval.suspect` and shown in the TUI; §20 tripwire now has a detector (§3.4, §A.1). |
| S16-6 | `GNOMON_HOME` is a build-time constant of a separate test artifact; no production code path reads it (§3.4, §15.3). |
| S16-7 | Gate-class detection compares `layersHash` (including gitignored layers: `.claude/settings.local.json`, `CLAUDE.local.md`, user-scope skills) at every spawn/respawn, not only diffs; `--setting-sources` passed explicitly (verify flag in Move 1) (§3.3, §15.7). |
| S16-8 | Human-only CLI verbs enumerated: `init`, `key mint`, `key device`, `trust`, `install`, `uninstall`, `approve`, `billing api-token`, `daemon stop`, `log segment` (§3.1 I3). |
| S16-9 | Threat rows carry residuals; row 12 says sessions are sandboxed for key access only and the oracle sandbox protects oracle integrity (§15.1). |
| S16 gap | Shared `.git` write by a session (hooks, config) covered by S16-2; user-scope `~/.claude` edits by an agent covered by `layersHash` + gate-class (S16-7). |

---

## 1. Thesis, positioning, non-goals

**Thesis.** Gnomon is the kernel and the shell beneath the armada: one hash-chained log, one identity, one approval broker with the budget fuse inside, one scheduler, one manifest grammar, a TUI that drives local models and Claude alike, and — in Warpline projects — every session Warpline-native from birth. Claude Code is the gold-standard coding agent and becomes a **headless backend** driven on the founder's subscription (`claude -p` stream-json, P8-D26/D34/D35); local models are first-class backends for automations (P8-D20: "that's why I wanted my own harness"). The owned kernel is justified by three things Claude Code alone cannot give (lore L-2026-10-16-ascend-065405-001): local-model automations, a cross-session budget and log, and merge adjudication. The founder's tools already form a harness in pieces (04-scout-own-family.md); 8.0 is a deletion project before a build project (07). Positioning (13-fable-names.md): **"ruflo coordinates agents; Gnomon adjudicates their work"** — and now owns the seat they are driven from. The market converges on plugins/skills/hooks/worktrees and nobody adjudicates merges (03; dsh refuses, 02); nobody ships local two-way voice with a durable team transcript (20); nobody sandboxes mods (21). Those are Gnomon's slots.

**Non-goals (8.0).**
- NOT the Loom lane: no breadth-first meta-harness, no tool sprawl, no roleplayed distributed protocols, no agent-type catalog (09).
- **We don't re-wrap Task.** No Gnomon tool description steers a model off Claude Code's native Task/Agent tools (09 §4). Gnomon spawns supervised processes with permits, credentials, worktrees and a ledger.
- Not a web app, not Electron: the shell is a TUI (`#tui`); Conductor, constellation, Platform, Atelier Studio and flow's GUI stay as peers and clients.
- Not a new knowledge store: neurons vault, notebooks, lore, decisions, `.purpose`, Warpline fabric bytes are never migrated (§17.2).
- Not the Warpline server (TD-2026-10-14-551).
- Not cloud voice: only text goes to Claude; raw audio never leaves the box (P8-D29).
- Not a cryptographic human boundary for approvals (P8-D25 leaves approvals on a key file; §A.1), not containers (sandbox profiles; §A.2).
- Not a second human, shared fabrics, teleport, ruflo interop, public marketplace (§21).
- Not Rust, not Swift for the kernel (05 §4): TypeScript on Node 24; FluidAudio (Swift) is an optional Mac voice backend behind a Node interface.

---

## 2. Architecture

### 2.1 Kernel vs userland (TD-950 §2, amended by D26/D27/D33)

| Ring | Owns | Never contains |
|---|---|---|
| **Kernel** (`#gnomon-kernel`, one daemon per user) | `#identity`, `#kernel-log`, `#session-runner` + `#supervisor` over two adapters (`#claude-adapter`, `#local-runner`), `#approval-broker` with `#budget-fuse` inside, `#scheduler`, `#manifest-loader`, `#ref-resolver`, `#socket` (the ABI, §5), `#oracle-sandbox` (§15.5), `#mod-host` (out-of-process mod children + effect enforcement, §12) | the symbol graph, notebooks, calibration, `#contracts-compiler`, the Warpline engine (`warplined`), neurons, lore, the TUI, voice, any LLM call of its own |
| **Userland** | `#tui` (pi-tui client of the socket), mods (manifest packages), `#gnomon-voice` (client/mod), `#learning-loop`, the compiler, `warplined`, neurons, lore, constellation/flow/Conductor/Platform clients, the optional Claude Code Mod band | kernel state (it appends granted event kinds and reads the log) |

Boundary falsifier (05 §6.1, `G-KRN-01`): the kernel boots with zero userland packages and runs one Claude session and one local session end to end; `gnomon replay` reproduces every kernel-controlled input byte-for-byte while recording the hashes of host layers it does not control (§3.3). Any kernel import of `@a-company/premise-core`, any `@a-company/warpline` module, `paradigm-mcp`, `@a-company/gnomon-tui` or pi-tui is a build failure (`G-KRN-02`). The local runner's model loop (pi-agent-core) IS inside the kernel's adapter ring — it is a process driver, not a userland LLM call: the kernel never composes prompts of its own beyond the one pointer line (§6.2) and the adapter's system envelope.

### 2.2 Topology: TUI as client, kernel owns sessions (OpenCode's split, 21)

- **Clients** speak `gnomon-rpc:v1` (§4.9): `#tui` (primary shell), `#gnomon-voice`, the Claude Code plugin (hooks + ≤12-tool MCP proxy, for interactive Claude Code sessions the founder still opens by hand), the optional Mod band, constellation, Conductor (Swift, M3.6), flow (Python), Platform, Atelier. A client never owns a session; `session.open` is always a kernel act, so a TUI crash leaves sessions running and re-attachable (`G-TUI-05`).
- **Distros** are manifests (§4.3): `paradigm` (default), `atelier`, `flow`, `constellation`.
- **Backend adapters** (`#backend-adapter` interface): `start(spec) → handle`, `send(handle, turn)`, `steer(handle, text)` (mid-turn queue, QM MessageQueue idea), `stop(handle, {interrupt})`, typed events `init | turn.start | partial{delta} | message{usage?} | tool.use | tool.result | permission.request | ask.user{question} | plan.exit{plan} | result{usage,total_cost_usd} | exited | quota.error | model.capabilities`. Two implementations in 8.0: `#claude-adapter` (§3.3) and `#local-runner` (§13). Usage comes only from adapter events, never model text (10 §1). Conformance: recorded transcripts replayed per backend version nightly (`G-ADP-01`, `G-ADP-02`).

### 2.3 ASCII

```
            ┌──────────────────────────────── userland ──────────────────────────────────┐
            │  #tui (pi-tui, panes, virtualized)   gnomon-voice   constellation  Conductor │
            │   views ← mods (out-of-process, closed kit)        flow(py)  Platform  CC Mod│
            │       │                   │                │           │        │      band  │
            │       └───────────────────┴────────────────┴─────┬─────┴────────┴────────┘   │
            │  contracts-compiler  learning-loop  warplined(per repo)  neurons              │
            └──────────────────────────────────────────────────┬────────────────────────────┘
                                                               │ gnomon-rpc:v1 (unix socket | named pipe)
  ┌────────────────────────────────────────────────────────────▼───────────────────────────┐
  │ socket  mutual auth(device key | read token) · subscribe · 12 verbs · status (F4)        │
  ├────────────────────────────────────────────────────────────────────────────────────────┤
  │ approval-broker ── budget-fuse (tokens · USD · compute · subscription windows)          │
  │ session-runner ── supervisor ── #claude-adapter (claude -p) │ #local-runner (pi-ai)    │
  │ identity (root key in OS keystore · device keys · approvals key file)   scheduler       │
  │ manifest-loader · mod-host (child per mod, effects enforced) · ref-resolver            │
  │ oracle-sandbox (sandbox-exec | restricted-token+ACL)   kernel-log (~/.gnomon/kernel.db) │
  └────────────────┬──────────────────────────────┬────────────────────────────────────────┘
                   ▼                              ▼
   claude -p --output-format stream-json …    llama.cpp / Ollama / LM Studio / vLLM / mlx_lm.server
   (subscription only, law 7)                 (OpenAI-compatible transport + compat profile)
```

### 2.4 Daemon lifecycle (`$daemon-lifecycle`)

1. **One per user.** Lock file `~/.gnomon/gnomon.pid` created `O_EXCL` (`daemonPid:v1 {pid, startedAt, socketPath}`); live holder refuses, dead holder cleaned and re-raced — lifted from `packages/warpline/src/daemon/lifecycle.ts:1-14`. Endpoint: unix socket `~/.gnomon/gnomon.sock` (0600; `$XDG_RUNTIME_DIR` fallback on Linux when `sun_path` overflows, `lifecycle.ts:33-50`; never `/tmp`) or, on Windows, named pipe `\\.\pipe\gnomon-<sha256(userSid)[0..16]>` with a DACL granting only the current user (§16).
2. **Client activation.** A client that cannot connect runs `gnomon daemon --detach` and reconnects (5 × 200 ms); the daemon re-execs itself with a fixed clean env (`PATH` from signed config, `HOME`/`USERPROFILE`, locale; `NODE_OPTIONS` and all `GNOMON_*` dropped) so the activator's environment never reaches the key-holding process (S-H3). Backend binaries (`claude`, llama.cpp, Ollama) come from signed config paths. launchd/Task Scheduler/service activation is 8.1.
3. **Idle exit.** No live sessions ∧ no subscribers ∧ no mod children ∧ no due timers inside 10 min ⇒ `daemon.exit{reason:'idle'}`. Timers are log-derived; a timer due while down fires on the next activation as an attended event.
4. **Crash posture.** Chain write before side effect. On restart, `session.spawned` without `session.exited` ⇒ pgid/job probed and stopped with `session.orphaned`; mod children likewise (`G-DMN-04`).
5. **Degrade path (documented, not built):** daemonless library mode; promotable without ABI change.

---

## 3. Kernel primitives

### 3.1 `#identity` — principals, device keys, hsid

**Data model (D24/Q1–Q3, D25).**
```
ns            = base32(sha256(rootPublicKeyPem))[0..8]                 — the namespace of this trust set (8.0: one human)
principal:v1  { principalId:"p:<ns>/<name>", kind: human|agent|session|kernel, keys:[keyId…] (device keys), parent?, createdAt, scope }
device:v1     { deviceId:"dev:<ns>/<host>", principalId, keyId:"gkey:v1:<sha256 of normalized spki PEM>", createdAt }   — several devices, one principal
~/.gnomon/keys/registry.jsonl   append-only { row, signer:<rootKeyId>, sig }  — PUBLIC material; a row without a valid signature from a signer in the trust set never resolves
~/.gnomon/keys/approve.key      the APPROVALS key (0600 / owner-only ACL): signs approval.decide and auth handshakes for the human's CLI/TUI
~/.gnomon/keys/<principal>.key  agent keys (roster agents' Gnomon keys), 0600
~/.gnomon/sessions/<hsid>/key   ephemeral session key, deleted on exit
root key                        in the OS keystore (macOS Keychain, access-control with user presence; Windows Credential Manager + Windows Hello UserConsentVerifier) — never on disk as a file
~/.gnomon/grants.jsonl          append-only { grant, signer:<rootKeyId>, sig }
```
Generalizes `packages/warpline/src/fabric/keys.ts`: key identity `keys.ts:15-18,126-129`; principal grammar `keys.ts:73-77`; fail-closed loaders `keys.ts:223-239`; registry reader that skips AND surfaces malformed rows `keys.ts:338-360`, closed-kind posture `keys.ts:309-330`. Signature domains: `gnomon:event-sig:v1`, `gnomon:row-sig:v1`, `gnomon:approve:v1\n<cardId>\n<decision>\n<cardContentHash>\n<approverPrincipalId>` (approver in the preimage, Q5), `gnomon:auth:v1` (pattern `keys.ts:65,143-146`).

**Invariants.**
- I1 One agent key = one notebook owner = one Warpline signer. **The kernel never mints a Warpline key or daemon token** (P8-D14; `keys.ts:441-443`, `tokens.ts:3-6`). Warpline principals are stable roster agents whose Warpline credentials the founder mints once; sessions borrow them (`session.open{as}`); strand ↔ session link is `causes[]`. The kernel's own Warpline credential (for shadow admissions) is a human-minted agent-class token for `gnomon-kernel` (A17-a).
- I2 Principal from a key or token, never an env var (TD-735 S1). `WARPLINE_AGENT_ID` stays Warpline's unsigned CLI marker.
- I3 Human-only CLI verbs — `gnomon init`, `key mint`, `key device add|revoke`, `trust`, `install`, `uninstall`, `approve`, `billing api-token`, `daemon stop`, `log segment` (S16-8) — fall in two classes: **root-signed** (`init`, `key *`, `trust`, `install`, `uninstall`, `billing api-token`) require the OS keystore's user-presence prompt (Touch ID / Windows Hello) for the root key; **approval-signed** (`approve`, `daemon stop`, `log segment`) use `approve.key`. The CLI refuses either class from an agent shell (`GNOMON_HSID` set, or caller pgid/job = a live session's) with `refusal:v1 {code:'FORBIDDEN'}`; it records `cli:{pid, ppid, pgid, tty}` in the resulting event (S16-5). Honest limit: `env -u` + `setsid` defeat the shell check; only the user-presence prompt is a real boundary, and only for the root-signed class (§A.1).
- I4 Session principals are children: `scope ⊆ parent.scope`; kind `session` never calls `approve`, never widens a permit, never binds to a manifest grant.
- I5 Every registry and grants row names its `signer` and carries its signature; the trust set is the root key (8.0) and, in 8.1, cross-signed roots (§21). The first root row is pinned forever (`keys.ts:28-32,397-402` pattern).

**Failure modes.** Unknown key/token ⇒ `AUTH`; unsigned/malformed rows never resolve and are surfaced; keystore unavailable ⇒ root-signed verbs refuse (`UNSUPPORTED` with the keystore error), never fall back to a file.

### 3.2 `#kernel-log` — the one hash-chained index

**Data model.** SQLite via `node:sqlite` at `~/.gnomon/kernel.db` (a-flow design `sqlite.py:1-16,185-193`):
```sql
CREATE TABLE chain (seq INTEGER PRIMARY KEY, id TEXT NOT NULL UNIQUE, kind TEXT NOT NULL, at TEXT NOT NULL, principal TEXT NOT NULL,
                    audience TEXT NOT NULL, sensitivity TEXT NOT NULL, envelope TEXT NOT NULL, prev_hash TEXT NOT NULL, hash TEXT NOT NULL, sig TEXT);
-- seq = MAX(seq)+1 inside the write transaction (sqlite.py:943-951) — never AUTOINCREMENT
-- projections reference chain(seq); BEFORE UPDATE/DELETE triggers RAISE(ABORT) on chain and every projection (sqlite.py:9-11,535-537)
```
`hash = sha256(canonical(envelope minus hash, sig))`, `prev(seq=1) = sha256("gnomon-log-genesis:" + logId)` where `logId` is the genesis ULID (Q2) and `envelope.log = logId`. Canonical = Warpline's serializer (`warpline-fabric-schema-v2.md` §1.2). Decision reads join `chain` on `seq` AND `kind` (`sqlite.py:13-16,542-544`).

**Signatures and anchors (S-H1, D12).** `sig` mandatory on `approval.*`, `oracle.result`, `budget.*`, `permit.*`, `key.*`, `manifest.*`, `config.*`, `billing.*`, `verdict.*` and on every event appended by a keyed principal; diagnostics (`daemon.*`, `socket.*`, `schedule.*`) may be unsigned. Chain head `{seq, hash, at}` written after every commit to `~/.gnomon/head` and to the OS keystore item `gnomon-head` (Keychain generic password / Credential Manager generic credential; no user presence). On start: missing db with keys present ⇒ `INTEGRITY_BROKEN`; head ≠ anchor ⇒ `INTEGRITY_BROKEN`; `gnomon log verify` recomputes hashes, verifies signatures against the registry and checks both anchors. Scope stated: a same-user attacker who rewrites both anchors and re-signs with keys read from disk defeats this (§A.1); the root key is not on disk, so root-signed rows cannot be forged without the user-presence prompt.

**Invariants.** L1 Append-only. L2 Model-visible ⟺ logged for kernel-added bytes (`session.inject{origin:'kernel'}` before the child reads them, `G-LOG-03`); client-origin injects logged uncapped; userland injections logged by userland as `inject.receipt`. L3 Fabric separate; `warpline.*` events carry `ref:"wl:pick/<pickId>"` + `refHash` and `causes[]`; telemetry `T-LOG-05`. L4 Ids never collide (ULIDs; `pev:` wraps 7.x ids). L5 Segment at 10⁶ rows (epoch-anchor pattern, `warpline-v3-identity.md` §5); `session.inject` bytes and `voice.turn.*` text kept forever; `turn.event` bodies, oracle evidence and any opt-in audio pruned at their TTL with `blob.pruned{sha}`. L6 `audience` (`private | team | org`, default `private`) and `sensitivity` (`normal | sensitive | secret`) are set at append and never relaxed in place; sharing (8.1) is a projection filtered by them (Q6).

### 3.3 `#session-runner` + `#supervisor` — one driver, two backends

**Responsibilities.** Preflight; mint session principal + hsid; obtain a permit (tokens/USD for Claude, compute for local); route by `model` (§13.3); select the roster credential (Warpline mode); build policy/env/argv; spawn in its own process group (job object on Windows); parse events; meter usage; staged stop; respawn; orphan sweep. Replaces three runners (04): `a-flow/.../headless.py`, `a-constellation/server/agents.ts`, `ClaudeStreamSession.swift` (deleted M3.6).

**Session model.**
```
session:v1 { hsid, principalId, as?, backend:{kind:'claude-code'|'local', uuid?, binarySha256?, version?, endpoint?, model, compatProfile?}, cwd, worktree?,
             mode: warpline|git|none, declaredModel: local|claude|any, attended: bool, policyHash, mcpHash, layersHash, gitHash, permitId, parent?, state, startedAt, lastActiveAt }
```

**`#claude-adapter` argv** (shared core `headless.py:133-154` + `agents.ts:433-446`; constellation's extras `agents.ts:447-454`):
```
claude -p --input-format stream-json --output-format stream-json --verbose --replay-user-messages --include-partial-messages
       --permission-mode default --permission-prompts none (--session-id <uuid> | --resume <uuid>) --settings <policy.json>
       --setting-sources <explicit list, verified in M1>  --mcp-config <mcp.json> --strict-mcp-config
       [--append-system-prompt <bytes>] [--model <m>]
```
`--include-partial-messages` feeds the TUI's live stream (D34; 21 "Headless loses"). `FORBIDDEN_FLAGS = {--dangerously-skip-permissions, --allowedTools, --allowed-tools, --bare}` checked with a **throw** (`agents.ts:40,453`; not `headless.py:153`'s `assert`). `AskUserQuestion` ⇒ `ask-user` card; `ExitPlanMode` ⇒ `plan` card; Esc in the TUI ⇒ `session.stop{interrupt:true}` (SIGINT / `GenerateConsoleCtrlEvent`).

**Preflight** (lift `headless.py:612-618`, `claudeCli.ts:21-97`) — authoritative before every spawn and respawn: binary realpath + sha (`headless.py:528-531`, `claudeCli.ts:21-25`; refuse changed binary on respawn); version ≥ 2.1.288 (`claudeCli.ts:13`); **law 7 scan** (§3.4): managed settings (`/Library/Application Support/ClaudeCode/managed-settings.json`, `/etc/claude-code/managed-settings.json`, `C:\ProgramData\ClaudeCode\managed-settings.json`), `~/.claude/settings.json`, the session policy, project `.claude/settings*.json` must not set `apiKeyHelper`, `env.ANTHROPIC_*`, `env.CLAUDE_CODE_USE_*`, or a billing base URL (`headless.py:550-584`, `claudeCli.ts:63-76`); the session env must not carry `ANTHROPIC_API_KEY`/`ANTHROPIC_AUTH_TOKEN`; `claude auth status` says `authMethod:"claude.ai"`, `apiProvider:"firstParty"` (`headless.py:586-610`, `claudeCli.ts:79-97`); `init.apiKeySource ≠ "none"` kills the group (`headless.py:33-37`). Any failure ⇒ `session.refused{code}` with flow's closed codes preserved (`claude_version | not_subscription_auth | spawn_failed | claude_binary_changed | bad_message | session_busy`) plus `api_billing_refused`.

**Settings layers (S-H7, S16-7).** The kernel hashes every layer it can see — managed, user, project, local, worktree `.claude/**`, `CLAUDE.md`, `CLAUDE.local.md`, user-scope skills/plugins listing, AND `.git/config`, `.git/hooks/**`, `.git/info/**` (S16-2) — into `layersHash`/`gitHash` at every spawn AND respawn; a change against the previous value or against the base revision is **gate-class** (§15.7) regardless of whether the file is gitignored or appears in a diff. `--setting-sources` is passed explicitly to limit layers (flag verified in M1; QM uses `settingSources:[]`, 21). `G-KRN-01` claims replay of kernel-controlled inputs plus recorded hashes, not of host context.

**Git hardening (S16-2).** Every kernel git invocation (`worktree add`, `merge-tree`, `show <base>:…`, fast-forward) runs with `-c core.hooksPath=<empty dir> -c core.fsmonitor=false -c core.sshCommand=false -c protocol.allow=never -c safe.directory=<root>` and, where the platform sandbox allows a shell-less exec, inside the oracle sandbox profile; `gitHash` drift refuses the operation until a human decides.

**Environment.** Allowlist `HOME USER LOGNAME LANG LC_ALL LC_CTYPE TMPDIR` + `PATH SHELL` (`headless.py:97`, `claudeCli.ts:15`; Windows adds `USERPROFILE SYSTEMROOT COMSPEC APPDATA LOCALAPPDATA TEMP`), scrub `ANTHROPIC_* CLAUDE_CODE_USE_* CLAUDE_CODE_OAUTH* CLAUDE_CONFIG_DIR NODE_OPTIONS GNOMON_*` (`headless.py:98-99`, `claudeCli.ts:16`), add `GNOMON_HSID GNOMON_SOCK GNOMON_SESSION_KEY` and, in Warpline mode, `WARPLINE_AGENT_ID` + `WARPLINE_MCP_TOKEN` (`tokens.ts:295-297`). `envKeys[]` logged. Session-key custody stated honestly: path in env, readable by the session's tool children; blast radius = the session's scope (I4); the session sandbox denies `~/.gnomon/keys` so it cannot read the approvals key (D25).

**Process.** macOS/Linux: `detached:true`, own pgid, staged stop SIGINT → close stdin → SIGTERM → SIGKILL on the group + sweep (`headless.py:339-351,483-507`, `agents.ts:38,460`). Windows: spawn inside a job object with `KILL_ON_JOB_CLOSE` via the bundled helper (§16); staged stop = `GenerateConsoleCtrlEvent` → close stdin → `TerminateJobObject`. stderr cap 64 KiB; stdout lines cap 4 MiB with `dropped` events (`agents.ts:36,506-513`); leader-exit grace 2 s (`headless.py:389-403`); idle respawn `--resume` charged as a launch (`agents.ts:34,445`); crash cap 3/10 min (`agents.ts:37-39`); busy-elsewhere check (`claudeCli.ts:113-117`).

**Invariants.** S1 No process creation without `permit.grant` (law 1). S2 Every backend event is a `turn.event` before anything acts on it. S3 `turn.usage` (partial/assistant messages) and `turn.result` are the only `budget.usage` sources; mid-turn breach kills the group/job. S4 Children die with the session. S5 Replay per §2.1. S6 `session.*` appended only by the supervisor. S7 A `model: local` session never spawns `claude` without a `fallback` card decision (§13.3).

### 3.4 `#approval-broker` + `#budget-fuse`

**Cards (`card:v1`, Q5).**
```
card:v1 { cardId, kind: permission|budget|knot|tend|verdict|merge-conflict|gate-class|install|fallback|ask-user|plan|api-token|voice-share,
          requestedBy: principalId, hsid?, contractId?, nodeId?, attended: bool,          // attended = a human client is subscribed to this session
          approverPolicy: { kind:'self' },                                                // roles/quorum reserved for 8.1 (Q5)
          block: display-block:v1, contentHash, actions:[kernel-signed], state, decidedBy?, decidedAt?, decisionSig?, cli?:{pid,ppid,pgid,tty}, timeoutAt }
```
Decisions: `allow | always | deny | resume | resolve | accept | reject | install | answer{text} | approve-plan | fallback-cloud | use-api-token`. `always` appends `approval.rule.learned{tool, matchExact}` (S-L1). `approval.decide` carries `decisionSig` (approver in the preimage) and `cli` provenance; a decision with no TTY or with a live session pgid/job in its ancestry is logged `approval.suspect` and surfaced in the TUI inbox (S16-5). Unattended sessions (`attended:false`) **wait** on cards; the TUI shows the wait; nothing is auto-decided (D21; QM attended/unattended, 18).

**The fuse — four dimensions.** (1) tokens per session/loop/day; (2) notional USD; (3) **compute** (D22): concurrent local sessions per machine, GPU/CPU seconds per hour, wall-time per local turn; (4) **subscription windows** (D35): the fuse models the subscription's rolling usage windows from `turn.usage`/`turn.result` and the adapter's rate-limit headers/`quota.error`, reserves a founder-interactive share (default 30 % of the window) that armada sessions cannot consume, and pauses the armada at the threshold with a `budget` card. Ladder user → repo → loop → session, rungs 50/75/90/100 % announced once per scope per day; breaker on `quota.error` (60 min or human resume). Day windows computed from the chain's last event time (S-L2). Defaults ON, tunable only in root-signed `~/.gnomon/config.yaml`; **no env var, project file or CLI flag changes them**; `GNOMON_HOME` is a build-time constant of the test artifact, absent from production code (S16-6).

**Law 7 inside the broker (D35).** `permit.reserve{kind:'session.spawn'|'turn'}` for a Claude backend is refused `BILLING_REFUSED` when preflight found an API-billing path. The only lawful API-token path is a `billing api-token` card: human-only, root-signed decision, **per use** (one session or one named automation run), carrying the reason, never a default, never a fallback target, never agent-requestable; while active the TUI status line shows a persistent `API CREDITS ACTIVE` indicator and `billing.api.active{hsid, until}` is logged every turn; expiry logs `billing.api.ended`.

**Honest fuse coverage.** Metered: kernel-spawned sessions (Claude + local), interactive Claude Code sessions registered by hooks (usage only). Not metered: a `claude -p` an agent runs from Bash outside the kernel (advisory policy deny; `status.unknownClaudeProcesses{n}` from `ps`/`tasklist` makes it visible). Task fan-out inside a turn is caught by per-message usage.

**Invariants.** B1 Nothing spends by default. B2 ULID permit ids. B3 Only the broker appends `approval.*`/`budget.*`/`permit.*`/`billing.*`, kernel-signed. B4 Agent/session kinds never decide cards or Warpline overrides (`protocol.ts:148-177`). B5 Corrupt state ⇒ deny. B6 An unattended card never expires into `allow`; `tool.permission` cards expire into `deny` (`agents.ts:721`); `fallback` and `api-token` cards never expire — they wait.

**Failure modes.** Broker unreachable ⇒ kernel-spawned sessions deny (`headless.py:54-58`); 7.x interactive sessions unaffected.

### 3.5 `#scheduler`

Log-derived timers only (`timer:v1`), recomputed on start (flow `timers` cache, `sqlite.py:21-22`); one daemon ⇒ one timer per key; a timer fires an event; whatever spends needs a permit; loop policies are userland over `loop:v1`; `loop.paused` is kernel-written (A17-3). Automations (constellation/flow routines) register `automation:v1 {id, trigger, model: local|claude|any, attended:false}`; the scheduler fires `automation.due` and the runner routes per §13.3.

### 3.6 `#manifest-loader`

Validates `manifest:v1` (§4.3) including the mod ABI fields; checks capabilities/egress against signed grants (`registry.py:9-24` refusals); generates `plugin.json`, `.mcp.json`, `hooks.json`, tool-family listing (`families.ts:28-53` tiers, `:55-92` table), per-session policy; hot-reloads mods by `manifestHash`; `install` card for anything agent-written with pinned hash and one-command rollback (`gnomon mod rollback <name>`); no `postinstall` anywhere; generated files carry markers; `gnomon uninstall` removes exactly those (law 4). `generate-hooks.mjs` subsumed (JSON out, scripts stay in `src/commands/hooks/scripts/`).

### 3.7 `#ref-resolver`

Grammar in the kernel (§4.4); resolvers userland and read-only; built-in schemes `ev hsid cc gkey dev permit card contract node pev voice`; `sym wl n s td l t spec` registered by their packages.

### 3.8 `#mod-host` (new, D33)

Spawns one child per installed mod (`node <entry>` with the allowlisted env, no network unless `requires.egress`, inside the session sandbox profile class `mod`), speaks `mod-abi:v1` over stdio JSON-RPC (§12.3), enforces declared effects at the RPC boundary (a `tool.call` whose declared effects are `read` cannot open a write verb; `network` cannot be used without an egress grant; `spend` requires a permit the mod cannot obtain itself), supervises health (`mod.health`), restarts on crash (cap 3/10 min), and forwards `view.render` results to clients as `display-block:v1` built from the closed kit. Mods never receive the socket credential; the host proxies on their behalf under the mod's own principal `p:<ns>/mod-<name>`.

---

## 4. Hard contracts (versioned; additive or a version bump)

### 4.1 Event envelope (`event:v1`)

```jsonc
{ "schemaVersion": "event:v1", "id": "ev:01J9Z6…",
  "log": "log:01J9…",                          // genesis ULID logId (Q2)
  "seq": 48213, "at": "…",
  "principal": "p:a1b2c3d4/ascend", "keyId": "gkey:v1:…", "deviceId": "dev:a1b2c3d4/macbook",   // server-stamped
  "connId": "conn:…", "idem": "sha256:…",
  "session": "hsid:v1:…",
  "scope": { "org": null, "team": null,        // reserved (Q4)
             "repo": "repo:<sha256(rootCommit + ':' + project.yaml.repoId)[0..16]>", "loop": "loop:…", "contract": "contract:v1:…" },
  "audience": "private", "sensitivity": "normal",   // Q6
  "kind": "session.spawned", "causes": ["ev:…", "wl:pick/pick:v3:…"],
  "payload": { … }, "ref": "wl:pick/…", "refHash": "sha256:…",
  "prev": "sha256:…", "hash": "sha256:…", "sig": "…" }
```

### 4.2 hsid + aliases

`hsid:v1:<ULID>` kernel-issued; `hsid:v1d:<base32(sha256("gnomon:hsid:v1d\n" + principalId + "\n" + "cc:" + uuid))[0..26]>` derived for interactive Claude Code sessions, keyed on the **namespaced** principalId (Q7), accepted only from that principal's device key, first registration wins (`session.alias.rejected` on squat). Hooks read `session_id` from stdin JSON (fallback `$CLAUDE_SESSION_ID`; probe in M1, P8-D18). Aliases `cc: wl:session const: flow: voice:`.

### 4.3 Manifest (`manifest:v1`, extended per 21 §5 / D33)

```yaml
manifest: 1
kind: distro | mod | provider | adapter | skill-pack
name: diff-lens                  version: 1.2.0
abi: "mod-abi:v1"                # required for kind: mod; the kernel refuses an unknown abi
compat: { kernel: ">=8.0.0 <9", claudeCode: ">=2.1.288" }
provides:
  mcp: [...]   skills: [...]   agents: [...]   hooks: [{ event: <string>, command }]   bands: [...]   steps: [...]   resolvers: [...]   blocks: [...]   oracles: [...]
  tools:   [{ name: lens.diff, schema: {...}, effects: [read] }]                       # effects ⊆ read | write | network | spend ; enforced by #mod-host
  views:   [{ id: diff.pane, slot: panel, placement: append, fixtures: [fixtures/diff-pane.json] }]
           # slots: sidebar | panel | status | composer.footer | tool.view:<tool> | card.detail:<kind> | shuttle ; placement: append | replace
  commands: [{ id: lens.toggle, title: "Toggle diff lens", args: {...} }]
  keybindings: [{ key: "ctrl+shift+d", command: lens.toggle }]                           # bind to command ids only, never to code
requires: { capabilities: [...], egress: none | [{host, purpose}] }
config_schema: {...}
```
No `trust:` field (grant table only). `manifestHash = sha256(canonical(manifest))` pins installs, hot reloads and `grant.install` rows.

### 4.4 Ref grammar (`ref:v1`)

`ref = scheme ":" id ["@" rev]`; registered schemes `ev hsid cc gkey dev permit card contract node pev spec sym wl n s td l t knot voice`; aliases `# $ ^ ! ~ → sym:`, `TD- → td:`, `L- → l:`, `T- → t:`.

### 4.5 display-block (`display-block:v1`) and the closed view kit

```jsonc
{ "schemaVersion": "display-block:v1",
  "block": "kit.Box" | "kit.Text" | "kit.List" | "kit.Table" | "kit.Markdown" | "kit.Diff" | "kit.Progress" | "kit.Button" | "inbox.card" | "session.live" | "contract.progress" | "budget.meter" | "knot.split" | "ask-user" | "plan" | "voice.turn",
  "data": { … }, "children": [ … ], "refs": [...], "causes": [...], "at": "…" }
```
`kit.Button` carries only `{command}` (a command id from a manifest); a block carries **no actions**. Decision controls exist only on broker-authored `card:v1.actions[]` signed by the kernel (S-M4). Agent-authored text is data (`descriptors.ts:73-74`). The same kit renders in the TUI, the optional Claude Code Mod band (mirroring its Pane kit shape, 21), constellation and Conductor.

### 4.6 refusal (`refusal:v1`, Gnomon superset)

As v2 (lifted from `refusal.ts:47-197,418-434,291-301` with `verdict`/`rule` as opaque strings) plus codes `BUDGET_DENIED` (exit 6), `PERMIT_REQUIRED` (2), `CAS_LOST` (gate `claim`, exit **7**, A17-5), `BILLING_REFUSED` (gate `billing`, retriable `never`, `next:[{verb:'approve', principal:'human'}]` pointing at an `api-token` card, exit 8), `MODEL_UNAVAILABLE` (gate `model`, retriable `retry-with-override`, `next:[{verb:'approve', principal:'human'}]` pointing at a `fallback` card, exit 9). Warpline's schema is a strict subset (`G-CON-02`).

### 4.7 contract (`contract:v1`)

```jsonc
{ "schemaVersion": "contract:v1",
  "contractId": "contract:v1:<sha256(canonical({specRef, mode, nodes:[{ref, kind, oracles}] sorted by ref}))>",   // ordinal-free, id-free (A17-b)
  "specRef": "spec:docs/specs/gnomon.md@<blobsha>", "repo": "repo:…", "mode": "warpline" | "git",
  "compiler": { "name": "paradigm-contracts", "version": "8.0.0", "deterministic": true },
  "nodes": [ { "ref": "sym:#approval-broker", "kind": "symbol", "section": "2.1", "oracles": [...], "deps": [] } ],
  "orphanTests": { "ref": "doc:release-gate", "ids": [...] },
  "certification": { "required": ["test", "admission" | "merge-ci", "reviewer"] }, "compiledAt": "…" }
```
`nodeId` in events = the node's `ref`, always paired with `contractId` (`{contractId, nodeId:"sym:#socket"}`).

### 4.8 Budget permit (`permit:v1`)

```jsonc
{ "schemaVersion": "permit:v1", "permitId": "permit:v1:<ulid>", "principal": "p:…", "hsid": "…",
  "scope": { "org": null, "team": null, "user": "p:…", "repo": "repo:…", "loop": "loop:…", "session": "hsid:v1:…", "machine": "dev:…" },
  "kind": "session.spawn" | "turn" | "tool.permission" | "tend.llm" | "oracle.reviewer" | "teacher.draft" | "mod.spend",
  "backend": "claude-code" | "local", "model": "…", "billing": "subscription" | "api-token:<cardId>" | "local",
  "limits": { "tokens": 400000, "usd": 4.0, "computeSeconds": 600, "concurrent": 2 },
  "issuedAt": "…", "expiresAt": "…", "ladder": { "user": 0.41, "repo": 0.12, "loop": null, "session": 0, "machine": 0.5, "subscriptionWindow": 0.62 },
  "decision": "allow" | "deny", "sig": "…" }
```

### 4.9 Socket protocol (`gnomon-rpc:v1`)

JSON-RPC 2.0, newline-delimited, over the unix socket or named pipe; every frame carries `"rpc":"gnomon-rpc:v1"`. **Mutual auth** (S-H4): `hello` → `{nonce, serverKeyId, serverSig over 'gnomon:auth-server:v1\n'+nonce+'\n'+endpointPath}` → `auth {principal, deviceId, sig over 'gnomon:auth:v1\n'+nonce+'\n'+serverKeyId+'\n'+principalId+'\n'+deviceId+'\n'+endpointPath}` or `{token}` (read-scoped, `tokens.ts:137-154` constant-time resolve) → `{principal, connId}`. Nonce single-use, 30 s; failed auth closes after one `AUTH` refusal. Identity bound per connection. Calls → `{result}` or `{error:{code, message, data: refusal:v1}}`; total code map as v2 plus `BILLING_REFUSED -32030`, `MODEL_UNAVAILABLE -32031`. Subscription `log.read{follow:true}` streams `event` notifications; backpressure > 10 000 frames ⇒ drop + `socket.subscription.dropped`. Redaction per §9.3. Node has no peer-credential API; endpoint ACL + mutual signatures are the boundary.

### 4.10 Voice events (`voice:v1`, D30/V)

```
voice.session.start { voiceSessionId, hsid, mode: ptt|conversation, engines:{vad, stt, tts, diarization}, device:{mic, aec:bool}, audioRetention: none|ttl:<s> }
voice.turn.user     { turnId, speakerId: "spk:<ns>/<name>"|"spk:unknown-2", t0, t1, text, asrModel, confidence, audioRef? }
voice.turn.agent    { turnId, hsid, textPlanned, textSpoken, interruptedAtMs|null, ttsVoice, source: local-ack|claude|local }
voice.bargein       { turnId, atMs, heardText }
voice.session.end   { voiceSessionId, turns, compactedTo: "l:L-…" }
voice.share         { loreId, audience: team, redactions:[…], consent:[speakerId…] }
```
`textSpoken` is the truth after a barge-in; `textPlanned` is what the model intended (20).

---

## 5. Kernel ABI — twelve verbs (law 3)

`status` is the man page (F4, TD-2026-07-21-766): principal, legal next verbs, verb→tool map, `abiId` (hashed as `descriptors.ts:383-393`), backends and their health, subscription window, billing mode, inbox by kind, unknown Claude processes. The MCP proxy registers ≤ 12 tools (`descriptors.ts:269-271` naming law). Everything else is CLI-only (§3.1 I3) or a mod command (§12).

| # | Verb | Params | Result | Refusals | Human | Agent (roster) | Session | Read token |
|---|---|---|---|---|---|---|---|---|
| 1 | `status` | `{}` | self-description | AUTH | ✓ | ✓ | ✓ | ✓ |
| 2 | `session.open` | `{backend?: claude-code\|local, model: local\|claude\|any, cwd, mode?, as?, goal?, contract?, alias?, derived?, permitId?, systemPrompt?, attended}` | `{hsid, principalId, backend, state}` | PERMIT_REQUIRED, BUDGET_DENIED, BILLING_REFUSED, MODEL_UNAVAILABLE, UNSUPPORTED, FORBIDDEN | ✓ | ✓ permit | ✓ permit | ✗ |
| 3 | `session.send` | `{hsid, content[], permitId, steer?: bool}` | `{turn}` | PERMIT_REQUIRED, BUDGET_DENIED, NOT_FOUND, BAD_REQUEST | ✓ | own subtree | own subtree | ✗ |
| 4 | `session.stop` | `{hsid, interrupt?}` | `{signals[], exited}` | NOT_FOUND, FORBIDDEN | ✓ | own subtree | own subtree | ✗ |
| 5 | `log.append` | `{kind, payload?, ref?, causes?, scope?, idem?, audience?, sensitivity?}` | `{id, seq, hash}` | FORBIDDEN (kernel-owned or ungranted kind), BAD_REQUEST | granted kinds | granted kinds | **none** | ✗ |
| 6 | `log.read` | `{since?, kinds?, scope?, follow?}` | backlog + stream | AUTH, BAD_REQUEST | full | redacted | own scope | redacted |
| 7 | `permit.reserve` | `{kind, scope, backend?, model?, limits?, tool?, input?}` / `{op:'release', permitId}` | `permit:v1` | BUDGET_DENIED, BILLING_REFUSED, FORBIDDEN | ✓ | ✓ | ✓ own scope | ✗ |
| 8 | `approve` | `{cardId, decision, note?, decisionSig}` | `card:v1` | FORBIDDEN, NOT_FOUND, AUTH | ✓ (root-signed for `use-api-token`, `install`) | ✗ | ✗ | ✗ |
| 9 | `contract.register` | `{contract}` | `{contractId, nodes}` | BAD_REQUEST, FORBIDDEN | ✓ | ✓ | ✗ (A17-5) | ✗ |
| 10 | `contract.claim` | `{contractId, nodeId, op: claim\|built\|release, expect?:{status, seq}}` | `{nodeId, status, by, seq}` | CAS_LOST, NOT_FOUND | ✓ | ✓ | ✓ | ✗ |
| 11 | `oracle.run` | `{contractId, nodeId, oracle}` | `oracle:v1 {pass, evidence, ranBy:'p:<ns>/kernel', reviewer?}` | PERMIT_REQUIRED, UNSUPPORTED, ENGINE | ✓ | ✓ requests | ✓ requests | ✗ |
| 12 | `ref.resolve` | `{ref}` | `{target, hash?}` | BAD_REQUEST, UNSUPPORTED, NOT_FOUND | ✓ | ✓ | ✓ | ✓ |

**Namespace ownership (A17-3).** Default: **every kind not listed below is kernel-owned** and appendable by no principal through `log.append`. Userland namespaces, appendable only by a principal bound to a manifest grant listing the kind (`grant.bind`): `paradigm.* inject.* credit.* broke.* detector.* loop.row loop.open loop.closed tend.* decay.* calibration.* flow.* neurons.* mod.<name>.*`. Explicitly kernel-owned (named because reviewers asked): `verdict.*`, `gate-class.*`, `blob.pruned`, `digest.consumed`, `loop.paused`, `contract.*`, `billing.*`, `voice.*` (written by the kernel on behalf of the voice client's verified events, see §14.4), `mod.health`, `mod.installed`.

**Matrix invariants (`G-ABI-02`).** `approve` is the only HUMAN_ONLY verb; `decisionSig` by the approver's key over `(cardId, decision, contentHash, approverPrincipalId)`; `use-api-token` and `install` decisions additionally require the root key (user presence). Read tokens: `status`, `log.read`, `ref.resolve` only (`protocol.ts:138-144`, `server.ts:206-212` pattern). `status` < 50 ms (`G-ABI-03`). Next-legal-verbs table hashed into `abiId` (`descriptors.ts:304-347` pattern): `{budgetPaused} → [status, log.read]` · `{cardsPendingForYou>0, human} → [approve]` · `{noSession} → [session.open]` · `{noPermit} → [permit.reserve]` · `{hasContract, unclaimed>0} → [contract.claim]` · `{claimed, built:false} → [contract.claim op:built]` · `{built} → [oracle.run]` · `{} → [status]`.

---

## 6. Spawn (`$spawn`)

### 6.1 Generic path

1. `permit.reserve{kind:'session.spawn', backend, model}` — refused ⇒ nothing else happens (law 1); interactive `derived:true` registrations skip this.
2. Route by `model` (§13.3): `local` ⇒ `#local-runner` or a `fallback` card; `claude` ⇒ `#claude-adapter` under law 7; `any` ⇒ local if a capable local model is up, else Claude.
3. `#identity` mints `p:<ns>/s-<hsid-short>` with an ephemeral key; Warpline mode binds `as`.
4. `session.open`; hsid issued.
5. Preflight (§3.3) incl. law-7 scan and `layersHash`/`gitHash`; a gate-class difference ⇒ card before spawn.
6. `#manifest-loader` writes `policy.json` (permissions, hooks → `gnomon hook …`, denies on `~/.gnomon/keys/**`, `.warpline/keys/**`, `.warpline/daemon-tokens.jsonl`, `.warpline/daemon/mcp-tokens.json`, `.warpline/daemon/mcp.token` — on EVERY mode, S16-1) and `mcp.json`.
7. `session.inject` for every added byte (`origin: kernel | client`).
8. Spawn inside the **session sandbox profile** (class `session`, §15.5) — the profile denies reads of `~/.gnomon/keys`, the Warpline token files and the OS keystore; it does not confine the worktree, tools or network (sessions need them).
9. Turns with `turn` permits; `turn.usage`/`turn.result` → `budget.usage`; `ask.user`/`plan.exit` → cards.
10. Stop/exit; worktree left in place.

### 6.2 Warpline-native path (base revision declares `mode: warpline`)

Preconditions as v2; the kernel is a re-derived `warplined:v1` NDJSON client (`protocol.ts:31,60-110`), may start `warplined`, never mints. Four kernel duties (05; TD-950 §3; D14/A17-a): (1) **select** the roster credential (`WARPLINE_AGENT_ID=<as>`, `WARPLINE_MCP_TOKEN` from the keyed store, `tokens.ts:205-232,295-320`; refuse if absent); (2) **env** as §3.3; (3) **deny** Warpline human-class verbs and override flags on every skin (`protocol.ts:115-120,148-151,161-164,175-177`) plus the key/token paths — advisory string matches; the enforced boundary is `warplined`'s matrix for keyed callers (`server.ts:215-233`) and, once P8-D16 ships, `resolve` served only to keyed principals; (4) **attach** worktree + `fork` (`native.ts:260`) + per-session line, selvage read-only, moves observed via `fs.watch` until `refs.watch` (P8-D16). **The one kernel pointer line** (F4): `--append-system-prompt "Warpline project. Run \`warpline status\` (or the warpline_status tool) before your first write."` logged as `session.inject{origin:'kernel', kind:'warpline.pointer'}`; `G-SPN-05` asserts kernel-origin bytes equal that line. The shadow admission oracle (§7.3) is presented by the kernel with its own human-minted agent-class token `gnomon-kernel` (A17-a). KNOTs → `knot` card → human `approve{resolve}` → human runs `warpline resolve` (HUMAN_ONLY, FG-1); `G-SPN-06` is skin-scoped.

### 6.3 Git-mode path

`git worktree add .gnomon/worktrees/<hsid-short> -b gnomon/<hsid-short> <base>` with the hardening flags (§3.3); landing = `merge-ci` oracle; conflicts ⇒ `merge-conflict` card without semantic judgment; clean ⇒ fast-forward onto `gnomon/integration` after the base revision's `ci` command is green inside the sandbox; `main` never written by the kernel. On Windows worktrees live under the same path (long-path aware, `core.longpaths=true` in the hardening set).

---

## 7. Spec-as-contract (P8-R2)

### 7.1 The compiler (`#contracts-compiler`, userland, deterministic)

Lives in `packages/paradigm/src/core/contracts/` as the `plan` stage of `paradigm pipeline` (`pipeline/index.ts:131-162`; `STAGE_ORDER` at `core/pipeline-types.ts:67`, imported `pipeline/index.ts:16`); the `paradigm_pipeline` MCP family runs the compiler locally and calls `contract.register` (A17-5). Rules:
1. Sections open at NUMBERED ATX headings (`## 3.`, `### 3.2`, `## A.`, `### A.1`); unnumbered headings do not change the section; text before the first numbered heading is `preamble`. Fenced code blocks are never scanned. A heading of ANY kind ending `(compile: skip)` skips everything until the next heading of equal or higher level (A17-2).
2. A **node candidate** is a whole inline code span matching `^[#$^!~][a-z][a-z0-9-]*$` in headings, prose or table cells.
3. Node identity = `sym:` + span; kind from prefix; `section` = first appearance; one node per ref.
4. A **test id** matches `\bG-[A-Z]{2,4}-\d{2}[a-z]?\b`; a range `NN..MM` after the prefix expands. An id in a table row binds to the nodes mentioned in that row plus the section heading's nodes; a table row that mentions no node under a heading that mentions none skips its own section and takes the ancestor path below. An id outside a table binds to every node mentioned in the section; otherwise to the nearest ancestor section's nodes; otherwise to the `doc` node declared by the single `Deliverable: <kebab>` line (`orphanTests`).
5. `deps` only from an explicit `Depends on:` line in a single-node section. This spec declares none.
6. Oracles: `exists` on every node; `test` per bound id; gates get `gate-check`; flows get `ripple-clean`; every node gets the mode's admission oracle and `reviewer`; no bound test and no `Oracle: exists` line ⇒ refusal.
7. Canonicalize (nodes sorted by ref), hash, emit; byte-identical for identical input (`G-CTR-01`).

### 7.2 Node kinds

`symbol · gate · flow · signal · aspect · test · doc`.

### 7.3 Oracles and certification

| Oracle | Runs | Deterministic |
|---|---|---|
| `exists` | `ref.resolve(sym:…)` via premise-core resolver | yes |
| `test` | repo test command filtered to the id, on a worktree COPY, inside `#oracle-sandbox` profile `gnomon-oracle` (default-deny, §15.5), under `p:<ns>/kernel` | yes |
| `gate-check` / `ripple-clean` | portal.yaml / `paradigm ripple` | yes |
| `admission` (Warpline) | `warplined admit {shadow:true}` (`protocol.ts:43`) presented with the `gnomon-kernel` token; real admit only after `^certified` | yes |
| `merge-ci` (git) | `git merge-tree` clean onto base AND the base revision's `ci` green in the sandbox | yes |
| `reviewer` | one `claude -p` turn on the **subscription** (D15, law 7) under an `oracle.reviewer` permit, as roster principal `p:<ns>/reviewer` ≠ claimant and ancestors, **no tools**, ≤ 1 turn, diff enveloped untrusted, spec section from the base revision, strict `{pass, reasons[], riskyUnits[]}` schema, inside profile `gnomon-reviewer` (S16-4: Keychain/Credential Manager item for Claude's OAuth reachable, network = Anthropic hosts only per P8-D17, `~/.gnomon`/`~/.ssh` denied; weaker than `gnomon-oracle`, stated) | no |

**Certification** (`^certified`): `exists ∧ test ∧ (admission | merge-ci) ∧ reviewer`, each `oracle.result` kernel-signed (an agent claims, only the kernel certifies, 10 §4). The gate's own tests are `G-CTR-04`, `G-CTR-05`, `G-CTR-06`, `G-CTR-08`, `G-CTR-09` (§19.2). Disagreement ⇒ `contract.knot` + `knot` card (Warpline KNOT payload `knot-payload.ts:56` attached when the shadow admission knotted); resolution human, logged `verdict.founder`. Reviewer calibration is mandatory (§8.6).

### 7.4 CAS claims and the node lifecycle (A17-1)

`contract.claim{op:'claim', expect:{status:'open', seq}}` ⇒ `contract.claimed` or `CAS_LOST`; `{op:'built'}` by the claimant ⇒ `contract.built` (the oracle trigger); `{op:'release'}` ⇒ `contract.released`. Claims expire at permit `expiresAt` + 2 h without `built`. All `contract.*` kinds are kernel-owned and written by the verb handlers.

### 7.5 Progress = exists ∧ passes

`contract.progress` projection `{exists, passes:{oracle}, certified, claimedBy}`; aggregate `{certified, total}`; rendered as the `contract.progress` block in the TUI; moves only on events.

### 7.6 Git-mode variant and KNOT routing

As v2: `merge-ci` replaces `admission`; merge conflicts → `merge-conflict` card; oracle disagreement → `knot` card in both modes; calibration keyed `(repo, mode)`.

---

## 8. Learning loop (TD-950 §8; `#learning-loop`, userland)

The loop reads only the kernel log. §8.1–8.3, 8.5–8.9 as v2 (credit = injected in a turn whose outcome was accepted; `appliedCount` frozen — `orchestration.ts:878-885`, `notebook-loader.ts:148,426-442`; credit projection `.paradigm/learned/credit.jsonl`; exploration slot T0/T1 only; decay write-back via `notebook-loader.ts:465-515`; loop ledger; reviewer calibration keyed `(repo, mode)`; `tend` under law 5; liveness gates + reader). Changes in v3:

### 8.4 Detectors and the teacher→skill flywheel (D23)

Detector classes (deterministic): `tests-fail-after-edit`, `tsc-fail-after-edit`, `warpline-knot`, `warpline-refusal`, `reviewer-dismissed`, `loop-thrash`, `repeat-symbol-failure`, and new `local-model-failed` (a `model: local` session hit tool-call parse failure after repair, exceeded the compute permit, produced a non-passing oracle, or triggered `fallback`). **Flywheel**: `detector.event{class:'local-model-failed'}` ⇒ a `teacher.draft` permit (Claude on the subscription, law 7, under the fuse) ⇒ the teacher writes the fix AND a candidate `SKILL.md` scoped to symbol/ecosystem (01 "Steal 1"; 06 §3) ⇒ staged at T3 ⇒ Classroom certifies (replay the saved `.scenario`, nearest-scenario regression, peer refutation, founder sign-off; first field break auto-overturns) ⇒ lands as notebook knowledge or `.claude/skills/<name>` through an `install` card (S-M6). Counts: `{drafted, certified, broke}` per class, with denominators. Failure to certify is itself logged (`tend.proposal.fate{dropped}`), so "5/5 survived" cannot hide (06 §3).

---

## 9. Observability (`~ample-internal-logs`)

### 9.1 Event taxonomy (closed per namespace; default owner = kernel)

| Namespace | Kinds | Join keys | Owner | Sensitive |
|---|---|---|---|---|
| `daemon`/`socket`/`key`/`config` | as v2 + `key.device.added`, `key.device.revoked`, `key.keystore.unavailable` | — | kernel | no |
| `session`/`turn` | as v2 + `session.routed{declared, chosen, reason}`, `turn.partial{bytes}`, `turn.steer`, `turn.ask-user`, `turn.plan` | hsid, turn | supervisor | bodies yes |
| `permit`/`budget` | as v2 + `budget.compute{machine, seconds}`, `budget.window{used, of, reservedForHuman}` | permitId | broker (signed) | no |
| `billing` | `api.card.requested`, `api.active{hsid, until}`, `api.ended`, `api.refused{where}` | cardId, hsid | broker (signed) | no |
| `approval` | as v2 + `decide.cli{pid,ppid,pgid,tty}`, `suspect{reason}` | cardId | broker (signed) | tool_input yes |
| `model` | `capabilities{backend, model, tools, ctx}`, `probe{endpoint, ok}`, `repair{argument}`, `fallback.requested`, `fallback.decided` | hsid | runner | no |
| `mod` | `installed{hash,cardId}`, `rolled-back`, `health{name, ok}`, `effect.refused{name, effect}`, `view.rendered{name, slot, ms}` | manifestHash | mod-host | no |
| `voice` | §4.10 | voiceSessionId, hsid, turnId | kernel (verified from the voice client) | text no; audioRef yes |
| `contract`/`oracle`/`warpline`/`merge`/`gate-class` | as v2 + `contract.built` | contractId, nodeId | kernel (signed oracle.result) | evidence yes |
| `inject`/`credit`/`broke`/`detector`/`loop`/`tend`/`decay`/`calibration` | as v2 + `detector.event{class:'local-model-failed'}`, `tend.teacher.drafted` | hsid, turn, entry ref | paradigm grant (except `loop.paused`: kernel) | no |
| `verdict`/`liveness` | as v2 | cardId, digestId | broker / scheduler | no |

Every number ships as `{n, of}` (`G-HON-03`).

### 9.2 Join keys

`hsid · turn · contractId · nodeId · permitId · cardId · keyId · deviceId · connId · entry ref · pickId · digestId · loopId · voiceSessionId · turnId · manifestHash`.

### 9.3 Redaction matrix (one, total, tested — `G-ABI-05`)

As v2, plus: `audience`/`sensitivity` restrict reads further (a `secret` event is never streamed to a read token; `team`/`org` audiences are 8.1 projections); `voice.turn.*.audioRef` is visible only to the human; mod principals read only their own `mod.<name>.*` and the kinds their grant lists.

### 9.4 Retention

Chain forever, segmented at 10⁶ rows; `session.inject` bytes and voice text forever; `turn.event` bodies and oracle evidence 90 days; opt-in audio at its TTL only.

### 9.5 Library logging

Paradigm logger everywhere (`mcp-logger.ts:3`; flow's port `headless.py:84`), never `console.log`. TUI diagnostics go to `~/.gnomon/logs/tui.log`, never to the terminal.

### 9.6 Metrics in `status`

As v2 plus `renderP99Ms` (TUI, reported by the client), `localTtftMs`, `voiceToVoiceMs{p50, p95}`, `subscriptionWindow{used, of}`, `apiCreditsActive`, `modChildren{n}`.

### 9.7 Honesty CI (law 2)

`G-HON-01` compiler reproduces Appendix A · `G-HON-02` no fabricated mechanisms (grep for `Math.random` outside ids/tests, `simulated`, fake `sleep(`, hardcoded gains, forbidden vocabulary) · `G-HON-03` denominators · `G-HON-04` manifest fixed point + reversible install · `G-HON-05` no Task-steering descriptions · `G-HON-06` guard names state scope · `G-HON-07` every latency number in docs or `status` names its measurement method and machine.

---

## 10. The seven laws as testable invariants

| # | Law | Invariant | Falsifier test (scope stated) |
|---|---|---|---|
| 1 | No spawn without a permit | every `session.spawned`/`respawn`/`turn.sent` has an earlier unconsumed `permit.grant`; spawn takes `permit:v1` as a required argument; local sessions consume compute permits | `G-LAW-01` (5-session fan-out, limit 3 ⇒ 2 denies), `G-LAW-01b` (no env/config/project/CLI bypass for kernel-spawned sessions), `G-LAW-01c` (6 local sessions, machine concurrency 2 ⇒ 4 wait) |
| 2 | Honesty is CI | §9.7 in `npm test` and the release gate | `G-HON-01..07` |
| 3 | Tiny ABI | ≤ 12 kernel verbs; ≤ 12 proxy tools; mod ABI ≤ 8 RPCs; `abiId` frozen per release | `G-ABI-01`, `G-ABI-04`, `G-MOD-01` |
| 4 | Reversible by construction | one repo dir (`.gnomon/`, `project.yaml` committed, `worktrees/` + `sessions/` ignored) + one home dir; markers; uninstall exact; learned state exported or intact | `G-LAW-04` on macOS and Windows |
| 5 | Nothing spends by default | fresh install, 24 h, zero `permit.grant`; spending scheduler jobs are manifest `opt-in`; local automations spend compute only after a human marks them `attended:false` + `model` | `G-LAW-05`, `G-LAW-05b` |
| 6 | Trust posture | no install scripts in `@a-company/gnomon*`; exact pins; `npm pack` lists only `dist`; signatures verified; `alpha` never `latest`; mods never load without a grant row | `G-LAW-06` |
| 7 | **Subscription only** (`^subscription-only`, D35) | no Claude process starts if any env/settings layer would bill API credits; the only API path is a per-use root-signed `api-token` card with a persistent indicator and `billing.api.active` events; the fuse reserves a human share of the subscription window | `G-SUB-01` (each of `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, `apiKeyHelper`, `ANTHROPIC_BASE_URL`, `CLAUDE_CODE_USE_BEDROCK/VERTEX/FOUNDRY` in each layer ⇒ `api_billing_refused`), `G-SUB-02` (agent cannot request an `api-token` card), `G-SUB-03` (indicator + events present for the card's whole validity), `G-SUB-04` (armada paused at window threshold while an interactive session still gets a permit) |

---

## 11. The TUI (`#tui`) — Gnomon's shell (D26, D32)

**Role.** The primary shell for local and Claude sessions, a pure client of `gnomon-rpc:v1` (OpenCode's topology, 21): the kernel owns sessions; the TUI renders, composes, decides (via the CLI-signed `approve` path it embeds) and never spawns a process itself. Multiple TUIs (or a TUI and constellation) attach to the same session concurrently; `turn.partial` streams to all.

**Renderer.** `@earendil-works/pi-tui` (MIT; retained components `render(width): string[]`, line-diff rendering, synchronized output, 16 ms throttle, Kitty keyboard protocol, named-action keybindings — 21), extended with: **panes** (resizable splits: transcript, inbox, sessions, contract progress, Shuttle view, mod panels), **virtualized transcript** (only visible rows render; budgeted mount), **width-keyed line caches** per block (deepseek-harness dropped its pi-tui TUI at 12 s/196k events and 800 ms/keystroke until width-keyed caches brought it to 17 ms — commit `10bb9cbf4a`, 21), streaming Markdown and per-hunk diffs (`kit.Diff`), the editor with kill ring/undo/paste collapse. Terminal matrix: iTerm2/Terminal.app/kitty/WezTerm on macOS; Windows Terminal (ConPTY) on Windows — Kitty protocol optional, never required (`G-TUI-03`).

**Views.** Everything the TUI draws beyond the transcript is a `display-block:v1` tree: kernel cards (`inbox.card`, `ask-user`, `plan`, `knot.split`, `budget.meter`, `contract.progress`, `session.live`) and mod views placed by slot (§12). The **Shuttle view** (status slot) shows live children `{n, of}` with spend, inbox pending by kind, hsid + mode + backend, budget rung, subscription window, `API CREDITS ACTIVE` when law 7's card is in force, mic state when voice is on, and `certified/total` in a contract session. Motion-on-events: the TUI repaints only on events or input; no timers; `G-TUI-02` (socket + keyboard silent 60 s ⇒ zero renders).

**Composer.** Local or Claude per session; `/model local|claude|any` per turn is refused unless the session's `declaredModel` is `any`; mid-turn steering (`session.send{steer:true}`) queues text the backend reads at its next step (QM MessageQueue, 21); Esc interrupts.

**Decisions.** The TUI shows cards and takes the decision keystroke, then signs through the CLI path with `approve.key` (and the OS keystore prompt for root-signed decisions); it never holds the root key; a decision made from the TUI records `cli.tty` so §3.4's `approval.suspect` rule can see it.

**Optional Claude Code Mod band.** For interactive Claude Code sessions the founder still opens by hand, a read-scoped Mod band may render the Shuttle view from the same blocks; it is optional, read-only, never decides, and its socket-from-a-Mod spike is `T-SHU-01` (telemetry, demoted from the critical path — D26).

**Falsifiers.** `G-TUI-01` 200k-event session renders a keystroke in < 50 ms and attaches in < 2 s (both OS) · `G-TUI-04` TUI never calls a write verb without a user keystroke · `G-TUI-05` kill the TUI mid-turn, reattach, no event lost.

---

## 12. Mods — day one, out of process, agent-maintainable (D27, D33)

### 12.1 Model

A mod is a `manifest:v1 {kind: mod, abi: "mod-abi:v1"}` package: tools (with declared effects), views (slot + placement + fixtures), commands, keybindings, optional MCP/skills/hooks. `#mod-host` runs each installed mod as one child process over stdio JSON-RPC; the mod never touches the TUI process, the kernel process, the socket credential or another mod. Hot reload by `manifestHash` (sha fingerprint, OpenCode pattern, 21).

### 12.2 Closed view kit

Views are pure `render(input) → display-block:v1` over the kit `Box Text List Table Markdown Diff Progress Button`; `Button` carries only a command id; no raw strings reach the terminal; a block exceeding 256 KiB or 2 000 nodes is refused `BAD_REQUEST`. Fixtures ship with every view; `gnomon mod test` renders fixtures to golden blocks on both OS.

### 12.3 `mod-abi:v1` (≤ 8 RPCs, law 3)

| RPC | Direction | Purpose |
|---|---|---|
| `health` | host → mod | liveness + abi echo |
| `view.render{viewId, input, width}` | host → mod | pure render |
| `command.run{commandId, args}` | host → mod | user command |
| `tool.call{name, input}` | host → mod | agent tool; effects enforced by the host |
| `event{event:v1}` | host → mod | filtered feed (grant-bound kinds) |
| `state.get{key}` / `state.set{key, value}` | mod → host | per-mod KV, `~/.gnomon/mods/<name>/state.db`, size-capped |
| `kernel.call{verb, params}` | mod → host | proxied kernel verb under the mod's principal; `approve` is never proxied |

Effects: `read` (kernel reads, state.get, view inputs) · `write` (state.set, `log.append` of `mod.<name>.*`) · `network` (only with an egress grant) · `spend` (`permit.reserve` of `mod.spend`, which the broker grants only if the human's grant row allows that mod to spend). A call outside the declared set ⇒ `FORBIDDEN` + `mod.effect.refused`.

### 12.4 Tooling for agents (`gnomon mod …`)

`types` (generated `.d.ts` + JSON Schema for the ABI, `abiId`-stamped), `test` (fixtures → golden renders + contract tests, both OS), `inspect <name>` (manifest, grants, health, last renders), `install <path|url>` (validate → test → `install` card with pinned hash; agent-initiated installs always card), `rollback <name>`. The example mod and docs are referenced from `status` so an agent can write a mod from the man page (F4 for mods: `G-MOD-04`, a cold agent builds and installs a passing view with the docs only).

**Trust.** Tiers in the grant table (`first-party | signed:<gkey> | local`), judged on provenance + hash, never self-description; a mod's manifest cannot request `approve`, `band:write`, or kernel-owned kinds. Falsifiers: `G-MOD-02` a mod declaring `read` cannot `state.set`/`log.append`; `G-MOD-03` a crashing mod never takes the TUI or kernel down; `G-MOD-05` an edited installed mod stops loading until re-carded.

---

## 13. The local lane (`#local-runner`, D20–D23)

### 13.1 Runner

`pi-agent-core` + `pi-ai` (MIT, `@earendil-works/pi-*`, 21) behind `#backend-adapter`: agent loop with parallel tools, steering/follow-up queues, JSONL session tree, compaction (reserve 16 384, keep ~20k, fixed headings Goal/Constraints/Progress/Decisions/Next/Critical, one compact-and-retry). Transport: OpenAI-compatible completions to llama.cpp server, Ollama, LM Studio, vLLM, or `mlx_lm.server` (Mac boost), seeded with pi-ai's **llama.cpp compat preset** (no developer role, no `store`, `max_tokens`, qwen chat-template thinking). Per-backend **compat profile** + **tool-capability probe** at `model.capabilities` (tools off unless detected; `n_ctx` from llama.cpp `/slots`), **argument repair** (OpenCode tool-input-repair idea, re-derived), **text-tool fallback** and per-model tool surface `none | compact | full` (Odysseus ideas, re-derived — AGPL, no code), ~8k context targets for coding. Windows: llama.cpp (CUDA/Vulkan) and Ollama are first-class; MLX is Mac-only and optional (§16).

### 13.2 Probe (Move 1)

`gnomon probe local` records `model.probe` + `model.capabilities` for each configured endpoint and, separately, probes whether Claude Code can be pointed at a local OpenAI-compatible endpoint (D20 "probed path") — if it can without touching API-billing settings it is a third routing target; if it requires `ANTHROPIC_BASE_URL`-style settings, law 7's scan refuses it and the probe records why (`G-LCL-05`).

### 13.3 Routing and fallback

Every task/automation/session declares `model: local | claude | any` (`automation:v1`, `session.open`, contract nodes may declare per node). `local` ⇒ a capable local model (probe says tools ok, ctx ≥ task floor) or a **`fallback` card** (`MODEL_UNAVAILABLE` to the caller; the card names the task, the reason, the estimated Claude cost; unattended work **waits**; never auto-falls back — D21). `claude` ⇒ Claude under law 7. `any` ⇒ local if capable, else Claude, logged `session.routed{reason}`. Falsifiers: `G-LCL-01` a `model: local` automation completes end to end on llama.cpp with no Claude process started; `G-LCL-02` an incapable local endpoint yields a `fallback` card and no spawn; `G-LCL-03` the card's `fallback-cloud` decision spawns Claude under the subscription; `G-LCL-04` compute permits cap concurrent local sessions per machine.

### 13.4 Flywheel

§8.4: local failures are supply for the teacher→skill loop; `{drafted, certified, broke}` denominators; teacher drafts land only via Classroom + `install` card.

---

## 14. Voice (`#gnomon-voice`, P8-R3, D28–D31)

### 14.1 Shape

A client/mod of the kernel (`gnomon-voice`, Node + sherpa-onnx bindings), never part of the kernel; the kernel stays text-native. Engines via sherpa-onnx (ONNX, cross-platform): Silero VAD; Parakeet TDT 0.6B (English default; Whisper via sherpa for multilingual); speaker segmentation + embeddings for live clustering; Kokoro-82M TTS streamed per sentence; optional Smart Turn v3 end-of-turn model. **FluidAudio** (Swift, CoreML/ANE) is an optional macOS backend behind the same `VoiceEngine` interface (`vad | stt | diarize | tts`), selected by capability probe, never required (D31). Audio I/O through a cross-platform capture library (CoreAudio / WASAPI; pick in M4.1, OPEN 4) with the platform AEC on or headphones recommended.

### 14.2 Interaction (`$voice-turn`)

Push-to-talk by default; **conversation mode** opt-in per session: VAD-gated listening while the agent speaks; **barge-in** = ≥ 250–400 ms of speech while TTS plays ⇒ stop playback, cancel pending TTS and the LLM continuation, truncate the agent turn to what was heard, log `voice.bargein` and `voice.turn.agent{textSpoken, interruptedAtMs}` (20; `G-VOX-02`). Mic state always visible in the TUI status slot (D28). Latency budget end-of-speech → first audio < 800 ms local (VAD 30 ms, end-of-turn ~200 ms, Parakeet 100–200 ms, local TTFT 150–300 ms, Kokoro first chunk 100–150 ms); Claude's TTFT (400–900 ms) is bridged by a **local-model acknowledgement** (a one-line spoken ack generated by `#local-runner` or a cached filler) logged as `voice.turn.agent{source:'local-ack'}`. Every figure is measured on the founder's machines and reported with method (`G-HON-07`). The agent speaks only **speakable content**: the TTS channel carries a spoken summary distinct from the full text answer (diffs/tool output summarized); `textPlanned` vs `textSpoken` keeps context honest.

### 14.3 Team chat log (D30)

Every turn is a kernel event (§4.10). At `voice.session.end` the client compacts turns into a `.lore`-style record (speakers, decisions, tasks, symbol refs, links to raw `voice.turn.*` ids) written through the `paradigm` grant and linked by `compactedTo`. Speaker labels: live clusters → enrolled local voiceprints confirmed in the TUI; unknown = "Speaker 2". Sharing (8.1 transport, 8.0 export): text-only, redacted, **per-speaker consent** recorded in `voice.share.consent[]`; raw audio, voiceprints and wake-word buffers never leave the box; audio not kept by default (opt-in TTL).

### 14.4 Trust

The voice client authenticates as the human's device key with scope `voice`; the kernel validates each `voice.*` event (speakerId known or `unknown-N`, turn ids monotone, text ≤ 16 KiB) and appends it kernel-owned so a compromised client cannot forge another speaker's enrolled id (`G-VOX-04`). Only text ever reaches Claude (D29); a cloud STT/TTS or speech-to-speech path is 8.1 and would require a per-session visible flag + logged event (20).

### 14.5 Lift (file:line)

constellation: `ui/src/audio/capture.ts:1-8` (AudioWorklet 16 kHz downsample, energy segmenter with adaptive floor, Me/Them capture), `server/audio.ts:1-8` + `server/hear.ts:1-8` (hallucination filter, normalise, WAV parse), `server/voice.ts:1-2` (engine process manager pattern; whisper-server replaced by sherpa-onnx), `server/commands.ts:1-8` (addressing grammar incl. mishearings), `server/bridge.ts:15-25,211-215` (gap/cap batcher 1 500/8 000 ms + wait contract), `shared/types.ts:177-191` (`TranscriptChunk` chunkId/speaker/startMs/endMs/revisionOf/command) and `shared/graph.ts:319-321`, `shared/api.ts:28` (`source.chunkIds` provenance from lines to ops). a-aloud: `packages/core/src/types/tts.ts:2,11-37,57` (`VoiceQualityTier`, `TTSVoice`, `TTSBoundaryEvent`, `TTSProvider`), the broker's `/page` + `/await_reply` speak-and-listen loop (`packages/broker`, `portal.yaml:12`). Re-derive, not lift: Conductor's WhisperKit push-to-talk state machine (Swift).

### 14.6 Falsifiers

`G-VOX-01` PTT turn round-trips text to a local session on macOS and Windows · `G-VOX-02` barge-in truncates `textSpoken` and cancels TTS within 300 ms · `G-VOX-03` session end produces a lore record whose links resolve to every raw turn · `G-VOX-05` no audio file exists after a default session · `T-VOX-01` voice-to-voice p95 < 800 ms local on the founder's Mac, reported with method (telemetry).

---

## 15. Security model

### 15.1 Threats and what holds (Aegis stage-1: the OS user)

| # | Threat | Mitigation | Residual |
|---|---|---|---|
| 1 | Forged env identity | key/device-stamped socket identity (I2) | Warpline unmarked CLI shells until P8-D16 |
| 2 | Session approves/resumes/resolves/installs for itself | `approve` HUMAN_ONLY; `decisionSig` with approver in preimage; `use-api-token`/`install` need the root key (user presence); session sandbox denies `~/.gnomon/keys`; `approval.suspect` flags no-TTY or session-ancestry decisions | a session that escapes its sandbox and reads `approve.key` can sign ordinary approvals; the event records `cli` provenance for review, it does not prevent (D25, §A.1) |
| 3 | Runaway fan-out / quota drain / founder lock-out | fuse (tokens, USD, compute, subscription window reserve), per-message metering, group/job kill, breaker, TUI | out-of-kernel `claude -p` (visible count) |
| 4 | Prompt injection (tool results, KNOT payloads `descriptors.ts:52-61`, notebooks, neurons, voice transcripts) | untrusted-content sentence; T3 as untrusted; `inject.receipt`; reviewer has no tools; voice text is data | the reading model |
| 5 | Env/config bypass | no `*_DISABLE`; root-signed config (keystore presence); build-time test constant; project scope cannot set policy | an attacker with the user-presence prompt (i.e. the human) |
| 6 | API-credit billing by accident or by an agent | law 7 preflight on env + every settings layer + base URLs; per-use root-signed card; indicator + events | a layer the scan does not know (new Claude Code setting) — the scan list is versioned per `claude` version in `G-SUB-01` |
| 7 | Socket/pipe hijack or relay | 0600 socket / user-only pipe DACL, 0700 home / owner-only ACL, mutual auth bound to endpoint path, single-use nonce | no peer credentials in Node |
| 8 | Supply chain | law 6; kernel zero runtime deps (`G-SEC-01`); pi-tui/pi-ai pinned exact in userland packages only | — |
| 9 | Malicious or buggy mod | out of process, declared effects enforced, closed kit, no credential, `install` card + rollback | a mod's `tool.call` output is model-visible text (threat 4) |
| 10 | Log rewrite / db deletion | mandatory signatures, two anchors (file + keystore), missing-db rule | same-user rewrite of both anchors + re-sign with disk keys (root-signed rows excluded) |
| 11 | Project files set policy | base-revision read; gate-class on `.gnomon/**`, `.claude/**`, `CLAUDE*.md`, test/package/pipeline files, AND `.git/config`/`hooks`/`info` via `gitHash` | a hook path the hardening flags do not neutralize (D12 class) |
| 12 | Oracle runs agent code on the key box | default-deny `gnomon-oracle` profile (copy of worktree, no network, no keystore/mach-lookup, escape tests) | sandbox-exec deprecated / Windows restricted-token fidelity (§A.2); sessions themselves are sandboxed for key access only — the oracle sandbox protects oracle integrity, not keys |
| 13 | Shared `.git` write by a session (hooks, fsmonitor, filters) | hardening flags on every kernel git call; `gitHash` gate-class | git features outside the flag set |
| 14 | Voice spoofing / audio exfiltration | kernel-verified `voice.*`, enrolled voiceprints local, audio not kept, text-only to Claude | microphone access is the OS's permission, not Gnomon's |

### 15.2 Key custody (D25)

Root key: OS keystore with user presence (Keychain access control `userPresence`; Windows Credential Manager + `UserConsentVerifier`), used for registry/grant/config/install/api-token writes only — rare, prompted. Approvals key `approve.key` on disk (0600 / owner-only ACL), used for `approve` and client auth; sessions and oracles cannot read it (sandbox profiles); mods cannot read it (own user-less child + profile). Device keys per machine under one principal (Q1). Session keys ephemeral. Keys never under a repo, never in git. Revisit trigger per §A.1.

### 15.3 Socket auth, env, no bypasses

§4.9; §3.3 allowlist/scrub; `G-SEC-02` envKeys ⊆ allowlist ∪ additions; production reads no `GNOMON_*` about itself.

### 15.4 Capabilities and grants

As v2 plus `mod:<effect>`, `voice`, `band:read`; grant rows `grant.capability`, `grant.bind`, `grant.trust`, `grant.install{manifestHash, cardId}`, `grant.device{deviceId}`.

### 15.5 Sandbox profiles (D13, D25, S16-3/4)

Three named profiles per platform, versioned and hashed into the events they protect:

| Profile | Used for | macOS (`sandbox-exec`, default-deny) | Windows (restricted token + ACL, after deepseek-harness `packages/sandbox/sandbox-windows-acl`, design note `.agents/notes/implemented/feature/2026-08-08-windows-acl-restricted-token-sandbox.md`) |
|---|---|---|---|
| `gnomon-oracle` | `test`, `merge-ci`, kernel git | deny-default file read/write, mach-lookup, process-exec, network; allow read: the worktree copy, toolchain dirs (node, git, `/usr`, `/System`, `/Library/Developer`), `/dev/null`; allow write: the copy dir + a private `TMPDIR`; allow exec: node, git, the project's test binaries by path; escape tests `G-SBX-04` (`osascript`), `G-SBX-05` (`launchctl`), `G-SBX-06` (`open`) | `WRITE_RESTRICTED` token (`CreateRestrictedToken` + `DISABLE_MAX_PRIVILEGE` + `LUA_TOKEN`) with the copy dir and `%TEMP%` granted write, `~/.gnomon` and the user profile's credential stores denied by ACE, job object with no network via WFP filter (helper), escape tests `G-SBX-04w` (PowerShell `Start-Process` elevation), `G-SBX-05w` (`schtasks`), `G-SBX-06w` (`explorer`/`rundll32`); reports `full | partial` honestly like dsh |
| `gnomon-reviewer` | the reviewer `claude -p` | as oracle but: real `HOME` with `~/.gnomon`, `~/.ssh`, `~/.aws`, `~/.npmrc`, `~/.config/gh` denied; mach-lookup to `securityd` allowed (Claude's OAuth item); network = Anthropic hosts only (P8-D17); **weaker than oracle, stated** | same denies by ACE; Credential Manager reachable; outbound filter = Anthropic hosts |
| `session` | every kernel-spawned Claude/local session and every mod child | allow-most profile that denies reads of `~/.gnomon/keys/**`, the Warpline token files, `~/.gnomon/head`, and `securityd` lookups for Gnomon's keystore items; does not confine tools, worktree or network | ACEs denying the same paths; Credential Manager items for Gnomon ACL'd to the interactive token only |

Rule: a profile that cannot be applied (API missing, platform `partial`) ⇒ the oracle refuses to run (`UNSUPPORTED`) and the session refuses to spawn unless the human approves a `gate-class` card naming the degraded protection — never a silent downgrade (Odysseus containment posture, 01).

### 15.6 Mod trust tiers

Grant-table labels; runtime enforcement = out-of-process host + declared effects (D33), a genuine first among the reference harnesses (21).

### 15.7 Project policy and gate-class (S-C4, S16-7)

`.gnomon/project.yaml` (`mode`, `ci`, `repoId`, `model` default) committed, read from the base revision. Gate-class = any change to `.gnomon/**`, `.claude/**`, `CLAUDE.md`, `CLAUDE.local.md`, test config, `package.json` scripts, lockfile scripts, pipeline files, `.git/config|hooks|info`, user-scope `~/.claude/**` observed by `layersHash`/`gitHash` at any spawn/respawn — detected by **hash comparison**, not diffs, so gitignored and user-scope layers count.

---

## 16. Windows parity (`~windows-parity`, P8-R4)

| Piece | macOS / Linux | Windows | Tests |
|---|---|---|---|
| Kernel endpoint | unix socket 0600 (`$XDG_RUNTIME_DIR` fallback) | named pipe `\\.\pipe\gnomon-<sha>` with a DACL for the current user SID only (`net.createServer` on a pipe path) | `G-WIN-01` both transports pass the §4.9 handshake and `G-SOCK-*` |
| Home dir + modes | `~/.gnomon` 0700, files 0600 | `%USERPROFILE%\.gnomon` with an owner-only DACL applied via the helper (`icacls` fallback), inheritance removed, verified by reading back the ACL | `G-WIN-02` ACL read-back = expected |
| Root key store | Keychain item with `userPresence` (Touch ID / password) | Credential Manager generic credential + `UserConsentVerifier` (Windows Hello) before each root-signed write | `G-WIN-03` root-signed write prompts; absent verifier ⇒ refuse |
| Chain anchor | file + Keychain generic password | file + Credential Manager generic credential | `G-LOG-06` both |
| Process isolation + kill | `detached`, own pgid, staged SIGINT/SIGTERM/SIGKILL | job object `KILL_ON_JOB_CLOSE` via the bundled helper (`gnomon-helper.exe`, N-API/.NET, signed); `GenerateConsoleCtrlEvent` → stdin close → `TerminateJobObject`; fallback `taskkill /T /F` logged as `partial` | `G-RUN-03` both |
| Sandbox | `sandbox-exec` profiles (deprecated but functional) | restricted token + ACL + job object backend (deepseek-harness design), `full|partial` reported | `G-SBX-*` both |
| Daemon activation | client activation; launchd 8.1 | client activation; Task Scheduler / service 8.1 | `G-DMN-03` both |
| Claude Code preflight paths | `~/.claude`, `/Library/Application Support/ClaudeCode/managed-settings.json` | `%USERPROFILE%\.claude`, `C:\ProgramData\ClaudeCode\managed-settings.json`; Git for Windows required by Claude Code | `G-SUB-01` both |
| Local engines | llama.cpp (Metal), Ollama, LM Studio, vLLM, `mlx_lm.server` (Mac boost) | llama.cpp (CUDA/Vulkan), Ollama, LM Studio; no MLX | `G-LCL-01` both |
| Voice engines | sherpa-onnx (CPU/CoreML EP) + optional FluidAudio | sherpa-onnx (CPU/DirectML EP); WASAPI capture | `G-VOX-01` both |
| TUI | iTerm2/Terminal.app/kitty; Kitty keyboard optional | Windows Terminal (ConPTY); VT sequences; synchronized output where supported | `G-TUI-03` both |
| Paths | POSIX | long paths (`\\?\`), `core.longpaths=true`, case-insensitive FS handled in ref/alias tables | `G-WIN-04` |
| Env allowlist | `HOME USER …` | + `USERPROFILE SYSTEMROOT COMSPEC APPDATA LOCALAPPDATA TEMP` | `G-SEC-02` both |

Rule: CI runs the `G-` matrix on macOS and Windows runners; a test marked platform-specific must have a sibling or an explicit `n/a` row with a reason (`G-WIN-05` enforces). FluidAudio and MLX are the only Mac-only components and both are optional.

---

## 17. Migration from 7.x

1. Envelope + identity adapters (`paradigm.event` mirror; root + device keys; roster gkeys).
2. One runner, two backends: constellation and flow become socket clients; the TUI replaces the founder's day-to-day interactive Claude Code use for Gnomon-managed sessions; the Claude Code plugin keeps working for sessions opened by hand.
3. Approval broker: constellation cards, flow approvals/step-up, Symphony file-requests → `card:v1` renderers.
4. Manifest-generated plugin files (`plugin.json`, `.mcp.json`, `hooks.json`, `FAMILY_META`; `generate-hooks.mjs` subsumed).
5. Ref resolvers.
6. Learning: `inject.receipt` + `credit`; `appliedCount` frozen; teacher flywheel.
7. Contracts: `paradigm pipeline plan` compiles + `contract.register`; `paradigm_pipeline` gains `compile|claim|progress`.

**Never moves:** `.purpose`, `portal.yaml`, symbol index · neurons vault · Warpline fabric/objects/refs/keys/tokens · flow chain · constellation op log · `~/.claude/projects/**` · notebook YAML · lore/decision YAML. **7.x keeps working:** `G-MIG-01` (suite passes with `~/.gnomon` absent). **Conductor:** `ClaudeStreamSession.swift` (`:183 --dangerously-skip-permissions`) deleted in M3.6 with `GnomonClient.swift`; `G-MIG-02`. **flow/constellation:** `HeadlessRunner` (`headless.py:313,510`) retired after `G-RUN-04`; `createAgents` (`agents.ts:121`) keeps its API; `tokenFor` (`agents.ts:165`) stays for constellation's own MCP auth.

---

## 18. Package layout, naming, versioning

```
packages/gnomon-contracts/   @a-company/gnomon-contracts 1.0.0   zero deps; TS + JSON Schemas for §4 (incl. mod-abi:v1, voice:v1)
packages/gnomon/             @a-company/gnomon 8.0.0             bin: gnomon, gnomond
  kernel/{identity,log,runner,supervisor,broker,budget,scheduler,manifest,refs,socket,sandbox,modhost}/   node: built-ins only; import fence
  adapters/{claude-code,local}/          claude -p driver + fixtures; pi-agent-core + pi-ai wrapper, compat profiles, probes, repair, fallback
  platform/{darwin,win32,linux}/         keystore, endpoint, acl, jobobject, sandbox backends; gnomon-helper (win32, signed)
  clients/{ts,python}/                   thin socket clients (constellation, flow)
  cli/ hooks/ sandbox/ test/
packages/gnomon-tui/         @a-company/gnomon-tui 8.0.0         pi-tui + panes/virtualization/caches; views; composer; decision path via CLI
packages/gnomon-mod-sdk/     @a-company/gnomon-mod-sdk 1.0.0     mod-abi:v1 types, kit, test harness, example mod
packages/gnomon-voice/       @a-company/gnomon-voice 8.0.0       sherpa-onnx engines, VoiceEngine interface, FluidAudio optional backend (darwin)
plugins/paradigm/mods/shuttle/   optional Claude Code Mod band (read-scoped)
packages/paradigm/src/core/contracts/   the compiler
packages/paradigm-mcp/src/tools/gnomon-proxy.ts   ≤ 12 tools
```
Deliverable: release-gate — the package-level checks `G-CON-01`, `G-CON-02`, `G-SEC-01`, `G-SEC-02`, `G-MIG-01`, `G-LAW-06`, `G-WIN-05` bind here.

Relations: `@a-company/paradigm` 8.0.0 depends on `@a-company/gnomon` and `@a-company/gnomon-tui` (only `@a-company/paradigm` publishes); `@a-company/warpline` stays 0.x, untouched by Gnomon's build (P8-D16's `refs.watch` + keyed-only `resolve` are Warpline's own changes); plugin version bumps in lockstep; `abiId`, `modAbiId` and `gnomon-contracts` semver move together; pi-tui/pi-ai pinned exact with their MIT notices in `THIRD_PARTY.md`.

---

## 19. Delivery — four moves, proper-first

Each task: acceptance oracles (test ids; every one runs on macOS + Windows unless `n/a` with a reason) and a falsifier. Field metrics are `T-` telemetry (§20).

### 19.1 Move 1 — kernel, two backends, TUI, mods, fuse, clients (`$move-1`)

| Task | Scope | Acceptance oracles | Falsifier |
|---|---|---|---|
| M1.0 Probes (day 1) | local endpoints + Claude-to-local probe; hook `session_id`; `--setting-sources`; keystore + Hello availability; pipe/socket; optional Mod-socket spike | `G-LCL-05`, `G-WIN-03`, `T-SHU-01` | a probe shows a decision cannot hold ⇒ re-plan before building |
| M1.1 `gnomon-contracts` | all §4 schemas incl. `mod-abi:v1`, `voice:v1`, Q1–Q7 fields | `G-CON-01`, `G-CON-02` | a client needs an undeclared field |
| M1.2 `#kernel-log` | chain, full-envelope hash, signatures, two anchors (keystore on both OS), triggers, projections, verify, segment, audience/sensitivity | `G-LOG-01..04`, `G-LOG-06..08` | p99 > 5 ms or RSS > 150 MB at 10⁶ rows |
| M1.3 `#identity` | root key in keystore + user presence, approvals key, device keys, namespaced principals, signed registry/grants, hsid issue + `v1d`, read tokens | `G-ID-01..04`, `G-ID-05` (root-signed write prompts; keystore absent ⇒ refuse) | a human principal mintable over the socket or without presence |
| M1.4 `#socket` + ABI | mutual auth on socket + pipe, 12 verbs, ownership default, subscribe, backpressure, `status`, `abiId` | `G-ABI-01..05`, `G-SOCK-01..04`, `G-WIN-01` | a verb added to serve a client |
| M1.5 `#manifest-loader` + policy | validate incl. mod fields, grants, egress, generated files, per-session policy with key denies in every mode, `layersHash`/`gitHash`, install card, rollback, uninstall | `G-MAN-01`, `G-MAN-02`, `G-MAN-03` (rollback restores previous hash), `G-HON-04`, `G-LAW-04` | install→uninstall diff non-empty |
| M1.6 `#approval-broker` + `#budget-fuse` | cards (all kinds incl. `fallback`, `api-token`, `ask-user`, `plan`), four fuse dimensions, subscription windows, law 7, `decisionSig` + `cli` provenance + `suspect`, signed config | `G-BRK-01..03`, `G-BRK-04` (suspect flag fires), `G-LAW-01`, `G-LAW-01b`, `G-LAW-01c`, `G-BUD-01..03`, `G-SUB-01..04` | fuse or law 7 bypassed by any setting for kernel-spawned sessions |
| M1.7 `#session-runner` + `#supervisor` + `#claude-adapter` | lift agents.ts/claudeCli.ts; headless.py extras; `--include-partial-messages`; ask-user/plan cards; git hardening; layers hashing; session sandbox; job objects | `G-RUN-01..03`, `G-RUN-05`, `G-RUN-06` (git hooks in a poisoned repo never execute), `G-ADP-01` | > 1 stream-json breaking change/month |
| M1.8 `#local-runner` | pi-agent-core + pi-ai wrapper, compat profiles, probe, repair, text-tool fallback, routing + `fallback` card, compute permits | `G-LCL-01..04`, `G-ADP-02` | no local model completes an automation end to end |
| M1.9 `#scheduler` + `$daemon-lifecycle` | timers, automations with `model`, idle exit, clean re-exec, orphan sweep, both endpoints | `G-SCH-01`, `G-LAW-05`, `G-LAW-05b`, `G-DMN-01..05` | daemon exits with a live child |
| M1.10 `#oracle-sandbox` + session profiles | three profiles × two platforms, default-deny, escape tests, `full|partial` reporting | `G-SBX-01..06`, `G-SBX-04w..06w` | an oracle or session reads a key |
| M1.11 `#tui` + `#mod-host` + `gnomon-mod-sdk` | pi-tui with panes/virtualization/caches; transcript, inbox, sessions, Shuttle view; decision path; mod-host, closed kit, effects, `gnomon mod types\|test\|inspect\|install\|rollback`, example mod | `G-TUI-01..05`, `G-MOD-01..05` | a 200k-event session renders > 50 ms/keystroke |
| M1.12 Clients + observability + replay | TS/Python clients; constellation + flow on the kernel; kind registry; Paradigm logger; metrics; honesty CI; `gnomon replay` | `G-CLI-01`, `G-RUN-04`, `G-KRN-01`, `G-KRN-02`, `G-OBS-01`, `G-HON-02..07` | two UIs disagree on a card; replay diverges |

Pass (Move 1): the founder drives a Claude session and a local session from the TUI on macOS and Windows; a `model: local` automation runs unattended on llama.cpp and an incapable one waits on a `fallback` card; a 5-session fan-out is stopped by the fuse with receipts; law 7 refuses an API-key environment; flow and constellation run on the kernel path; one agent-written mod is installed through a card and renders in the TUI.

### 19.2 Move 2 — contracts, spawn, armada (`$move-2`)

| Task | Scope | Acceptance oracles | Falsifier |
|---|---|---|---|
| M2.1 `#contracts-compiler` | §7.1 compiler in `paradigm pipeline plan`; `contract.register`; Appendix A | `G-CTR-01`, `G-CTR-02`, `G-CTR-07`, `G-HON-01` | compiler needs an LLM |
| M2.2 Claims + lifecycle + progress | `claim|built|release`, expiry, progress block | `G-CTR-03` | a claim lost or duplicated |
| M2.3 Oracles | exists/test/gate-check/ripple-clean/shadow-admission (kernel token)/merge-ci/reviewer (profile `gnomon-reviewer`) | `G-CTR-04..06`, `G-CTR-08`, `G-CTR-09` | an agent certifies its own node |
| M2.4 Warpline-native spawn | credential selection, env, denies, attach, pointer line, selvage watch → `refs.watch` | `G-SPN-01..07` | pointer line grows |
| M2.5 Git-mode spawn | hardened worktree/branch, merge-tree, base-revision ci, conflict card | `G-GIT-01..03` | kernel writes `main` |
| M2.6 Teacher flywheel | `local-model-failed` detector → `teacher.draft` permit → Classroom staging → `install` card | `G-LRN-10` (a detector event yields a staged draft with `{drafted, certified, broke}` counts) | drafts certify at 100 % |
| M2.7 Field run | `gnomon spawn 4 --contract <this spec>` on a real repo, mixed `model: any` | `T-FLD-01`, `T-FLD-02` | zero KNOTs ⇒ concurrency not produced |

Pass: first KNOT in Warpline's history, hydrated, zero skin-scoped W3; progress diagram moves with no human edit; at least one node built by a local model.

### 19.3 Move 3 — learning loop live, Shuttle view, Conductor (`$move-3`)

| Task | Scope | Acceptance oracles | Falsifier |
|---|---|---|---|
| M3.1 `#learning-loop` credit | `inject.receipt`, `credit`, `broke`, projection, ranking, restricted exploration slot | `G-LRN-01..03` | seeded entries hold ≥ 75 % of credit at week 4 |
| M3.2 Detectors + loop ledger | deterministic detectors; `loop.row`; thrash pause k=3 | `G-LRN-04` | a loop runs past cap |
| M3.3 `tend` + reader + liveness | deterministic passes; LLM under permit; digest; reader; violations in the Shuttle view | `G-LRN-05..07` | tend mutates T0/T1 without a card |
| M3.4 Reviewer calibration | `(repo, mode)` rows; `uncalibrated` flag | `G-LRN-08`, `G-LRN-09` | pooled |
| M3.5 Shuttle view polish + optional Mod band | TUI status slot complete; Mod band if `T-SHU-01` passed | `G-SHU-02`, `G-SHU-03` | band reads a file or decides |
| M3.6 Conductor + clients render | `GnomonClient.swift`; delete `ClaudeStreamSession.swift`; Atrium blocks; Symphony onto the log | `G-MIG-02`, `G-CLI-01` | two UIs disagree |

Pass: `gnomon replay` reproduces kernel-controlled inputs; `install → uninstall` diff empty; the 384/396 number changes for a replayable reason.

### 19.4 Move 4 — voice (`$move-4`)

Argued as its own move: it depends only on Move 1 (kernel, TUI, local runner) and can start in parallel with Move 2, but its hardware work (AEC, latency, Windows capture) should not gate the armada or the loop, and its lore records are consumed by Move 3's reader.

| Task | Scope | Acceptance oracles | Falsifier |
|---|---|---|---|
| M4.1 Engines | sherpa-onnx VAD/STT/TTS/diarization on both OS; capture library chosen; FluidAudio optional backend; `VoiceEngine` probe | `G-VOX-01` | engines fail the probe on Windows |
| M4.2 PTT + conversation mode | barge-in, truncation, local-ack bridge, speakable summaries, mic indicator | `G-VOX-02`, `T-VOX-01` | p95 > 800 ms local after tuning |
| M4.3 Events + log | `voice.*` kernel-verified; speaker enrolment; retention | `G-VOX-04`, `G-VOX-05` | audio kept by default |
| M4.4 Lore compaction + export | session-end record linked to raw turns; text-only redacted export with consent | `G-VOX-03` | links do not resolve |

Pass: a spoken conversation with a local agent and with Claude (text-bridged), on both OS, producing a lore record the TUI can open.

---

## 20. Falsifiers, telemetry gates, kill criteria

Telemetry gates: `T-SHU-01` Mod holds a socket (optional) · `T-LOG-05` 30 days without an un-enveloped Gnomon-sealed strand · `T-FLD-01` ≥ 1 KNOT hydrated, zero skin-scoped W3 · `T-FLD-02` progress moves with no human edit · `T-VOX-01` voice-to-voice p95 < 800 ms local · `T-TUI-01` founder's daily driver is the TUI after two weeks (≥ 70 % of Gnomon-managed sessions opened from it) · `T-LCL-01` ≥ 1 real automation per day runs `model: local` without fallback.

Falsifiers: 1 daemon adoption (two weeks, > 50 % of real sessions outside the kernel) · 2 kernel creep (`G-KRN-02`) · 3 stream-json drift (> 1 breaking change/month) · 4 sixth ledger (`T-LOG-05`) · 5 empty denominator (`T-FLD-01` zero) · 6 learning (week-4 credited reuse < 25 %, 100 % certification survival, or both liveness gates at zero) · 7 TUI (`T-TUI-01` fails: the founder keeps opening Claude Code interactively for Gnomon work) · 8 local lane (`T-LCL-01` fails for a month after the probe said capable) · 9 performance (idle RSS > 150 MB, append p99 > 5 ms, TUI keystroke > 50 ms at 200k events) · 10 accepted-risk tripwire: any `approval.suspect` the founder did not make, or any `billing.api.active` without a card the founder signed (both now detectable, S16-5) ⇒ founder-only mode ends and §A revisit work is pulled forward · 11 Windows parity (`G-WIN-05` reports an `n/a` row without a reason, or a Move pass fails on Windows only).

Kill criteria: (a) falsifier 1 or 7 trips twice running; (b) falsifier 3 trips and plugin-side integration cannot enforce permits or law 7; (c) the founder's honest read after Move 2 is that Claude Code alone with native Task and worktrees did the work better; (d) no local model can complete a real automation after Move 1 on either machine (the owned-harness justification fails).

---

## 21. 8.1 for teams (from 18)

Team trust set (cross-signed roots; `signer` already on rows) · signed log-segment exchange between colleagues' kernels, merged by causal order (`logId` + `audience` already in the envelope) · shared Warpline fabric as the team's verifiable state of record · approver roles + quorum (`approverPolicy` already on cards) · unattended grants (QM: never inherited; delegated messages are data) · credential broker + egress proxy · per-person/team cost rollups from metered permits (`org`/`team` already in scope) · read-only share snapshots with revocable links · voice transcripts shared text-only with consent · Gnomon as a QM decision provider and merge gate; neurons as a QM memory provider ("QM swarms admit they cannot merge") · launchd/Task Scheduler/service activation · containers on a separate host for oracles · Keychain/Hello-backed approvals if §A.1's trigger fires.

---

## 22. OPEN questions

1. OPEN (settled in M1.0, P8-D18): hook stdin `session_id` on 2.1.288+; `--setting-sources` flag semantics; Mod outbound sockets (optional band).
2. OPEN: whether Claude Code can be pointed at a local OpenAI-compatible endpoint without API-billing settings (D20 probe; if not, the "probed path" is dropped and law 7 wins).
3. OPEN: the Windows helper's shape — N-API addon vs small signed .NET exe — for job objects, ACLs, Credential Manager and `UserConsentVerifier`.
4. OPEN: cross-platform audio capture library for Node (CoreAudio/WASAPI) and whether platform AEC is reachable from it; otherwise headphones are the documented requirement for conversation mode.
5. OPEN: `sandbox-exec` deprecation path on macOS — Endpoint Security / App Sandbox alternatives if a macOS release removes it.
6. OPEN: Linux anchor and endpoint when `$XDG_RUNTIME_DIR` is unset (Linux follows macOS otherwise).
7. OPEN (8.1 blocker, lore L-2026-10-16-ascend-070808-001): confirm Anthropic's terms permit distributing a harness that drives users' subscription Claude Code headless; 8.0 is the founder's own subscription on his own machines.
8. OPEN: how the fuse learns the subscription window shape (rate-limit headers vs `quota.error` observation only) — measured in Move 1; until known, the human reserve is a fixed 30 %.
9. OPEN: Atelier aesthetic session + pitch sequencing (P8-D19 says now; the TUI pivot makes the aesthetic session also the TUI's design session).

---

## A. Accepted risks (founder-only 8.0; each with a revisit trigger)

### A.1 Approvals signed by a key file (P8-D12 as amended by P8-D25)

Aegis rated same-user key access **critical** (S-C1) and the v2 claim "every zero-UX-cost mitigation" **high** for missing two (S16-1). v3 takes both: the **root key** lives in the OS keystore and every registry, grant, config, install and api-token write needs user presence (Touch ID / Windows Hello) — an agent cannot mint principals, change trust, alter the fuse, install a mod or enable API credits without the founder's finger; and **kernel-spawned sessions and mod children run under a profile denying `~/.gnomon/keys`**. What remains accepted: ordinary approvals (`allow/deny/resume/resolve/accept/reject/fallback-cloud`) are signed by `approve.key` on disk, so a process that is not kernel-spawned (the founder's own shell tools, a Claude Code session opened by hand, a sandbox escape) and runs as the same user can sign them. Mitigations in force: approver in the preimage; `cli` provenance on every decision; `approval.suspect` for no-TTY or session-ancestry decisions, shown in the TUI; mandatory signatures and two anchors on the log; kernel-owned namespaces. Honest scope: these make abuse detectable and attributable to "a process with the approvals key", not impossible (`G-HON-06` enforces the wording in every guard test). Revisit trigger: before any second human, shared fabric, or 8.1 — and immediately on falsifier §20.10 — move approvals to the keystore with presence.

### A.2 Sandbox profiles, not containers (P8-D13; Windows per P8-R4)

Oracles and reviewer run under default-deny `sandbox-exec` profiles on macOS (deprecated by Apple, functional, escape-tested) and under a restricted-token + ACL + job-object backend on Windows modeled on deepseek-harness's rung (which itself reports `full|partial` and documents why AppContainer and mxc were rejected). Neither is a container; a profile that cannot be applied refuses rather than degrades. The reviewer profile is weaker than the oracle profile (Keychain/Credential Manager reachable for Claude's OAuth; Anthropic egress). Sessions are sandboxed only for key access. Aegis's dissent (jobs never on the key-holding box) stands recorded. Revisit trigger: as A.1, plus any public repo or untrusted contributor; target = rootless containers on a separate host (TD-735 §7).

### A.3 Windows fidelity

Windows protections depend on a bundled helper for job objects, ACLs, Credential Manager and Windows Hello; until the helper is signed and its tests green on a Windows runner, Windows runs report `partial` in `status` and every oracle refuses (§15.5 rule). Accepted for the founder's own Windows machine; 8.1 requires `full`.

---

## Appendix A — expected compile of this spec (compile: skip)

Regenerated by the checker that implements §7.1; see the table below. `deps: []` everywhere; `Deliverable: release-gate` in §18; `exists`, `admission`, `reviewer` implicit on every node; `gate-check` on gates; `ripple-clean` on flows.

| ref | kind | section | test oracles |
|---|---|---|---|
| `sym:#approval-broker` | symbol | 2.1 | G-BRK-01, G-BRK-02, G-BRK-03, G-BRK-04, G-BUD-01, G-BUD-02, G-BUD-03, G-KRN-01, G-KRN-02, G-LAW-01, G-LAW-01b, G-LAW-01c, G-SUB-01, G-SUB-02, G-SUB-03, G-SUB-04 |
| `sym:#backend-adapter` | symbol | 2.2 | G-ADP-01, G-ADP-02, G-TUI-05 |
| `sym:#budget-fuse` | symbol | 2.1 | G-BRK-01, G-BRK-02, G-BRK-03, G-BRK-04, G-BUD-01, G-BUD-02, G-BUD-03, G-KRN-01, G-KRN-02, G-LAW-01, G-LAW-01b, G-LAW-01c, G-SUB-01, G-SUB-02, G-SUB-03, G-SUB-04 |
| `sym:#claude-adapter` | symbol | 2.1 | G-ADP-01, G-ADP-02, G-KRN-01, G-KRN-02, G-RUN-01, G-RUN-02, G-RUN-03, G-RUN-05, G-RUN-06, G-TUI-05 |
| `sym:#contracts-compiler` | symbol | 2.1 | G-CTR-01, G-CTR-02, G-CTR-07, G-HON-01, G-KRN-01, G-KRN-02 |
| `sym:#gnomon-kernel` | symbol | 2.1 | G-KRN-01, G-KRN-02 |
| `sym:#gnomon-voice` | symbol | 2.1 | G-ADP-01, G-ADP-02, G-KRN-01, G-KRN-02, G-TUI-05, G-VOX-01, G-VOX-02, G-VOX-03, G-VOX-04, G-VOX-05 |
| `sym:#identity` | symbol | 2.1 | G-ID-01, G-ID-02, G-ID-03, G-ID-04, G-ID-05, G-KRN-01, G-KRN-02 |
| `sym:#kernel-log` | symbol | 2.1 | G-KRN-01, G-KRN-02, G-LOG-01, G-LOG-02, G-LOG-03, G-LOG-04, G-LOG-06, G-LOG-07, G-LOG-08 |
| `sym:#learning-loop` | symbol | 2.1 | G-KRN-01, G-KRN-02, G-LRN-01, G-LRN-02, G-LRN-03 |
| `sym:#local-runner` | symbol | 2.1 | G-ADP-01, G-ADP-02, G-HON-07, G-KRN-01, G-KRN-02, G-LCL-01, G-LCL-02, G-LCL-03, G-LCL-04, G-LCL-05, G-TUI-05, G-VOX-02 |
| `sym:#manifest-loader` | symbol | 2.1 | G-HON-04, G-KRN-01, G-KRN-02, G-LAW-04, G-MAN-01, G-MAN-02, G-MAN-03 |
| `sym:#mod-host` | symbol | 2.1 | G-KRN-01, G-KRN-02, G-MOD-01, G-MOD-02, G-MOD-03, G-MOD-04, G-MOD-05, G-TUI-01, G-TUI-02, G-TUI-03, G-TUI-04, G-TUI-05 |
| `sym:#oracle-sandbox` | symbol | 2.1 | G-CTR-04, G-CTR-05, G-CTR-06, G-CTR-08, G-CTR-09, G-KRN-01, G-KRN-02, G-SBX-01, G-SBX-02, G-SBX-03, G-SBX-04, G-SBX-04w, G-SBX-05, G-SBX-06 |
| `sym:#ref-resolver` | symbol | 2.1 | G-KRN-01, G-KRN-02 |
| `sym:#scheduler` | symbol | 2.1 | G-DMN-01, G-DMN-02, G-DMN-03, G-DMN-04, G-DMN-05, G-KRN-01, G-KRN-02, G-LAW-05, G-LAW-05b, G-SCH-01 |
| `sym:#session-runner` | symbol | 2.1 | G-ADP-01, G-KRN-01, G-KRN-02, G-RUN-01, G-RUN-02, G-RUN-03, G-RUN-05, G-RUN-06 |
| `sym:#socket` | symbol | 2.1 | G-ABI-01, G-ABI-02, G-ABI-03, G-ABI-04, G-ABI-05, G-KRN-01, G-KRN-02, G-SOCK-01, G-SOCK-02, G-SOCK-03, G-SOCK-04, G-WIN-01 |
| `sym:#supervisor` | symbol | 2.1 | G-ADP-01, G-KRN-01, G-KRN-02, G-RUN-01, G-RUN-02, G-RUN-03, G-RUN-05, G-RUN-06 |
| `sym:#tui` | symbol | 1 | G-ADP-01, G-ADP-02, G-KRN-01, G-KRN-02, G-MOD-01, G-MOD-02, G-MOD-03, G-MOD-04, G-MOD-05, G-TUI-01, G-TUI-02, G-TUI-03, G-TUI-04, G-TUI-05 |
| `sym:$daemon-lifecycle` | flow | 2.4 | G-DMN-01, G-DMN-02, G-DMN-03, G-DMN-04, G-DMN-05, G-LAW-05, G-LAW-05b, G-SCH-01 |
| `sym:$move-1` | flow | 19.1 | G-ABI-01, G-ABI-02, G-ABI-03, G-ABI-04, G-ABI-05, G-ADP-01, G-ADP-02, G-BRK-01, G-BRK-02, G-BRK-03, G-BRK-04, G-BUD-01, G-BUD-02, G-BUD-03, G-CLI-01, G-CON-01, G-CON-02, G-DMN-01, G-DMN-02, G-DMN-03, G-DMN-04, G-DMN-05, G-HON-02, G-HON-03, G-HON-04, G-HON-05, G-HON-06, G-HON-07, G-ID-01, G-ID-02, G-ID-03, G-ID-04, G-ID-05, G-KRN-01, G-KRN-02, G-LAW-01, G-LAW-01b, G-LAW-01c, G-LAW-04, G-LAW-05, G-LAW-05b, G-LCL-01, G-LCL-02, G-LCL-03, G-LCL-04, G-LCL-05, G-LOG-01, G-LOG-02, G-LOG-03, G-LOG-04, G-LOG-06, G-LOG-07, G-LOG-08, G-MAN-01, G-MAN-02, G-MAN-03, G-MOD-01, G-MOD-02, G-MOD-03, G-MOD-04, G-MOD-05, G-OBS-01, G-RUN-01, G-RUN-02, G-RUN-03, G-RUN-04, G-RUN-05, G-RUN-06, G-SBX-01, G-SBX-02, G-SBX-03, G-SBX-04, G-SBX-04w, G-SBX-05, G-SBX-06, G-SCH-01, G-SOCK-01, G-SOCK-02, G-SOCK-03, G-SOCK-04, G-SUB-01, G-SUB-02, G-SUB-03, G-SUB-04, G-TUI-01, G-TUI-02, G-TUI-03, G-TUI-04, G-TUI-05, G-WIN-01, G-WIN-03 |
| `sym:$move-2` | flow | 19.2 | G-CTR-01, G-CTR-02, G-CTR-03, G-CTR-04, G-CTR-05, G-CTR-06, G-CTR-07, G-CTR-08, G-CTR-09, G-GIT-01, G-GIT-02, G-GIT-03, G-HON-01, G-LRN-10, G-SPN-01, G-SPN-02, G-SPN-03, G-SPN-04, G-SPN-05, G-SPN-06, G-SPN-07 |
| `sym:$move-3` | flow | 19.3 | G-CLI-01, G-LRN-01, G-LRN-02, G-LRN-03, G-LRN-04, G-LRN-05, G-LRN-06, G-LRN-07, G-LRN-08, G-LRN-09, G-MIG-02, G-SHU-02, G-SHU-03 |
| `sym:$move-4` | flow | 19.4 | G-VOX-01, G-VOX-02, G-VOX-03, G-VOX-04, G-VOX-05 |
| `sym:$spawn` | flow | 6 | G-SPN-05, G-SPN-06 |
| `sym:$voice-turn` | flow | 14.2 | G-HON-07, G-VOX-02 |
| `sym:^certified` | gate | 7.3 | G-CTR-04, G-CTR-05, G-CTR-06, G-CTR-08, G-CTR-09 |
| `sym:^subscription-only` | gate | 10 | G-SUB-01, G-SUB-02, G-SUB-03, G-SUB-04 |
| `sym:~ample-internal-logs` | aspect | 9 | G-ABI-05, G-HON-01, G-HON-02, G-HON-03, G-HON-04, G-HON-05, G-HON-06, G-HON-07 |
| `sym:~windows-parity` | aspect | preamble | G-DMN-03, G-HON-01, G-LCL-01, G-LOG-06, G-RUN-03, G-SEC-02, G-SUB-01, G-TUI-03, G-VOX-01, G-WIN-01, G-WIN-02, G-WIN-03, G-WIN-04, G-WIN-05 |
| `doc:release-gate` | doc | 18 | `orphanTests` (39): G-ABI-01, G-ABI-02, G-ABI-03, G-ABI-04, G-CON-01, G-CON-02, G-HON-01, G-HON-02, G-HON-03, G-HON-04, G-HON-05, G-HON-06, G-HON-07, G-KRN-02, G-LAW-01, G-LAW-01b, G-LAW-01c, G-LAW-04, G-LAW-05, G-LAW-05b, G-LAW-06, G-MIG-01, G-MIG-02, G-MOD-01, G-MOD-02, G-MOD-03, G-MOD-04, G-MOD-05, G-RUN-04, G-SBX-04, G-SBX-04w, G-SBX-05, G-SBX-05w, G-SBX-06, G-SBX-06w, G-SEC-01, G-SEC-02, G-SUB-01, G-WIN-05 |

Notes for the compiler author: 31 symbol/flow/gate/aspect nodes + 1 doc node = 32. §2.1's table is the first appearance of most symbols and `G-KRN-01`/`G-KRN-02` sit in §2.1 prose, so they bind to every node mentioned there by the section-level rule; `#tui` first appears in §1 (non-goals) and `#backend-adapter` in §2.2; `~windows-parity` first appears in the preamble's platform rule. §19.x tables bind row-by-row (Scope spans) plus the `$move-N` heading node, which is why primitives mentioned together in one row (e.g. `#tui` + `#mod-host`, `#scheduler` + `$daemon-lifecycle`) share that row's ids. §10's law table has no heading node, so rows without a node span (laws 1–6) take the ancestor path to `orphanTests`, while the law-7 row binds its `G-SUB-*` ids to `^subscription-only`. §16's table binds through its `~windows-parity` heading. §14.6's list binds to `#gnomon-voice` via the §14 heading; `$voice-turn` binds the ids mentioned in §14.2 itself. `T-` ids are telemetry, never oracles. §0, this appendix and nothing else are skipped.

