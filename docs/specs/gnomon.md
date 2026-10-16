# Gnomon — Paradigm 8.0 build spec (the kernel and shell beneath the armada)

Status: BUILD SPEC v3.2, not yet built. Decision TD-2026-10-16-950 (the ten rulings) · founder rulings P8-D12..D53, requirements P8-R1..R7 (lore L-2026-10-16, tag `paradigm-8`) · Atelier sessions `.atelier/sessions/2026-10-15-paradigm-8-spec/session.yaml` and `.atelier/sessions/2026-10-15-gnomon-aesthetic/session.yaml` (renders in its `refs/`: `walkthrough.html`, `papercraft.html`, `styles.html`, `workshop-mod.html`) · Research `.paradigm/research/paradigm-8/00–23` (06/12 Loid, 14/16/22 Aegis, 15/17/23 Arky, 18 QM, 19/20 voice, 21 shell + mods) · First-party mod concept docs `docs/specs/gnomon-mods/gnome-persona.md`, `docs/specs/gnomon-mods/doodle.md` (proposals; where they differ from this spec, this spec wins).
Packages: `packages/gnomon` (`@a-company/gnomon`: kernel, adapters, CLI), `packages/gnomon-contracts` (the published client API), `packages/gnomon-gui` (the localhost GUI shell), `packages/gnomon-mod-sdk`, `packages/gnomon-mods` (first-party mods: `workshop`, `gnome-persona`, `doodle`), `packages/gnomon-local`, `packages/gnomon-voice`, `packages/gnomon-helper` (signed native helpers). Branch `ideate/paradigm-8` → `feat/gnomon`.

Reads with: `warpline-v3-identity.md`, `warpline-fabric-schema-v2.md`, `warpline-engine.md`, `warpline-forge.md` G1–G5.
Audience: 8.0 is for the founder (dog-fooded on real repos, on macOS AND Windows, iterated live); 8.1 is for the world (P8-D1). "8.1" marks what is deliberately out of this build; §21 holds the team roadmap.

This document is itself a contract source (§7, P8-R2 dog-food): every component, flow, gate, signal and aspect named here as a whole code span with its symbol prefix is a node the compiler (§7.1) must extract, and every node carries an oracle (a test id, or an explicit `exists` declaration). A node without an oracle is a compile refusal. Appendix A is the hand-written expectation; honesty test `G-HON-01` is that the compiler reproduces it.

Vocabulary rule (TD-950 §1): no swarm, hive, queen, consensus or neural anywhere. Collective noun **armada**; a running session is a **session**; a spawned set is a **fleet**. Labels never imply a mechanism the code lacks (law 2).

Platform rule (P8-R4): everything runs on macOS and Windows (Linux follows macOS where POSIX suffices). Every platform-specific mechanism names its Windows counterpart in §16; every `G-` test touching process, file, endpoint, key or sandbox behaviour runs on both OS matrices, and platform-independent tests run on Windows CI from day one (`~windows-parity`).

---

## 0. Changes in v3.2 (compile: skip)

v2's and v3's change tables are in git history (commits `3b352368` and `93957274` on `ideate/paradigm-8`); v3.1's is kept as §0.1 below as history, and this table wins where they differ. Ids: `D` founder rulings (D40–D53 new), `R` requirements (R5–R7 new), `L06`/`L12` Loid's research (06-loid-learning.md §2, 12-loid-direct.md), `AES` the aesthetic session (`.atelier/sessions/2026-10-15-gnomon-aesthetic/session.yaml`).

| Id | What changed |
|---|---|
| D50 (corrects the shell reading of D26/D32) | Gnomon's shell is a **terminal-like GUI served by the local kernel on localhost and opened in the browser** — not an in-terminal TUI. `#tui` becomes `#gui` (`packages/gnomon-gui`, a browser page that is a pure client of `gnomon-rpc:v1` over a loopback WebSocket); pi-tui is gone from every package, section and test; the kernel gains `#web-endpoint` (loopback HTTP for the static bundle + the WebSocket transport of the ABI, built on `node:http`, zero dependencies). The keyboard-first, prompt-centred, command-palette feel is kept. `G-TUI-01..06` become `G-GUI-01..06` with the same claims measured in a browser; `G-GUI-07..10` are new; `T-TUI-01` becomes `T-GUI-01` (§1, §2, §4.5, §4.9, §11, §16, §18, §19, §20). |
| D50 (localhost security) | New §11.2: bind `127.0.0.1` only; a single-use **launch token** handed to the page by the CLI over the already-authenticated socket, exchanged for a GUI session token held in page memory; **origin lock** (only Gnomon's own page); **DNS-rebinding defence** (`Host` allowlist); **CSRF** closed by having no cookies and checking `Sec-Fetch-Site`; **no CORS header ever**; strict CSP; **WebSocket auth deadline**; rate and path limits; Windows parity. Tests `G-WEB-01..06`; threat rows 16–18 (§15.1). The browser is a client of the same API as every other client. |
| D50 (wrapper) | An optional desktop wrapper (Tauri recommended, macOS + Windows) loads the same page from the same endpoint with the same token; its WebView origin is allowlisted only while it is the launcher. Not in the Move 1 pass; OPEN 10. |
| D51 | The terminal gets the **CLI only** (`gnomon spawn|status|approve|replay|open|mod …`); no in-terminal UI. `gnomon open` is the launcher (device-authenticated, refused from kernel-spawned shells); CLI output is a text projection of the same blocks (§3.1 I3, §9.5, §11.1). |
| D40 / AES | Look: light mode = **papercraft**, dark mode = **phosphor terminal**, optional automatic day/night swap; key edges ≥ 3:1; project hues are fills, never text (`G-GUI-10`, §11.3). |
| D41 / AES | **Workshop** is a first-party, optional mod view (`#workshop-mod`): a needs-you queue of caps and a working zone whose caps bob only while their session streams — an informed override of motion-on-events scoped to that mod; hat shape = work type, filled = Claude, outlined = local, soft hue = project, violet only for KNOT, every attribute from kernel events (`G-WSP-01`, §11.6). |
| D42 / AES | Chrome principle: header, footer, sidebars and mod slots show only what is necessary; everything is reachable from the command palette; layout presets; the Workshop and the Shuttle view can be moved or hidden (`G-GUI-08`, §11.4). |
| D43 / AES | Decisions arrive as a **paper stack** (paper in light, chips in dark) that can be fanned or browsed so a more important decision can be taken first; inside a session only that project's decisions show (`G-GUI-09`, §11.4). |
| D44 / AES | Left sidebar of active and past sessions grouped by project, with new-session creation (§11.4). |
| R5 / D45–D49 / D52 | **Gnome persona** is a first-party mod (`#gnome-persona-mod`, §12.6; concept doc `docs/specs/gnomon-mods/gnome-persona.md`): a dialog voice whose rules follow Simplified Technical English (ASD-STE100) with a length budget; **no restyling pass** — brevity by instruction, so the local-model paraphrase tier of the concept doc is dropped; the relay never rephrases cards, refusals, billing, security or certification text; raw output is always one key away and logged; emotes are driven by kernel events first, phrases second; token claims stay honest; a `persona:v1` manifest is editable live by any agent through the mod ABI. Tests `G-GNM-01..03`, telemetry `T-GNM-01`. |
| R6 | **Doodle** is a first-party mod (`#doodle-mod`, flow `$doodle-session`, §12.7; concept doc `docs/specs/gnomon-mods/doodle.md`): a shared, replayable sheet for the human and the agents. Simpler than the concept doc because the GUI hosts the canvas directly through the new `kit.Canvas` block — there is no separate canvas client, no second loopback listener. Engine: **Excalidraw (MIT)**; tldraw's SDK licence blocks bundling. Doodle sessions, replay by fold, branching, lore compaction, the `doodle:` ref scheme. Tests `G-DDL-01..04`, telemetry `T-DDL-01`. |
| L06 §2 / L12 | **Shared knowledge search**: `#knowledge-query` (§8.10), a userland federated read verb over manifest-registered providers — notebooks, neurons, lore, decisions, Steward memory, doodles — with provenance and trust tiers on every hit, receipts for cross-agent reads, and the scoped phrasing "check the doodles for X". Never a kernel verb (law 3). Manifest field `provides.knowledge`; capability `knowledge:provide`. Tests `G-KNW-01..03`. |
| R7 / D53 | **Linked mods**: `gnomon mod link <folder>` raises an install card listing declared effects, then pins the folder's `packageHash`; any change (an edit or `git pull`) pauses the mod and raises a re-approve card listing the changed files; dev mode re-pins on save and shows a visible `dev` badge (§12.5). Events `mod.linked | paused | repinned | unlinked`; tests `G-MOD-08`, `G-MOD-09`. |
| R7 (community clients) | The **client API is published and versioned**: `gnomon-rpc:v1`, `display-block:v1` (with the kit), `card:v1`, `refusal:v1`, `event:v1` in `@a-company/gnomon-contracts`, hashed as `clientApiId` (reported by `status`, frozen per release) with a conformance suite (`gnomon client conform`), so community GUIs and tools are interchangeable peers of the first-party GUI under the same auth and unspoofable-card rules; the presence prompt text comes from the kernel's card record, never from the client (§12.8). Tests `G-CLI-02`, `G-CLI-03`; threat row 17. |
| Kit (R6, D50) | The mod view kit gains `kit.Image{blob, alt, w, h}` (alt mandatory) and `kit.Canvas{ds}` (a surface the host owns; a mod references it and never ships code to a client); `modAbiId` covers both (`G-MOD-10`, §12.2). The client↔mod relay that v3.1 left implicit is made explicit: `mod.view` and `mod.command` ride the socket, are served by `#mod-host`, are counted in `modAbiId` and are not kernel verbs (§12.3, §5). |
| D36 (one Move 1) | Moves re-planned proper-first: Move 1 gains `#web-endpoint` (M1.4), the GUI (M1.10), the Workshop mod, kit additions, linked mods and the client relays (M1.11), the client API + conformance suite (M1.12); Move 3 gains `#knowledge-query` (M3.7), `#gnome-persona-mod` (M3.8) and `#doodle-mod` (M3.9), which depend only on Move 1 and may start in parallel with Move 2; Move 4 speaks the gnome line (§19). |
| OPEN | OPEN 9 rewritten (aesthetic session paused; open boards); OPEN 10–13 added (wrapper, gnome persona, Doodle, knowledge-provider home) (§22). |

### 0.1 Changes in v3.1 (compile: skip)

History. Ids: `D` founder rulings (D36–D39), `S22-` Aegis v3 review (22-aegis-v3-review.md), `A23-` Arky v3 review (23-arky-v3-review.md). Rows that v3.2 later superseded (pi-tui as the shell renderer, `#tui`, `G-TUI-*`) stand here as history; §0 wins.

| Id | What changed |
|---|---|
| S22-C1 / A23-2 / D37 | The local runner leaves the kernel: `gnomon-local` is a child executable over stdio (pi's rpc mode, `rpc-entry.ts`), one per local session, under the `session` sandbox profile; pi-ai and pi-agent-core never load in the kernel (kernel keeps zero runtime deps); `#local-runner` is now the kernel's stdio driver for that child, in the same shape as `claude -p` (§3.3, §13). `G-LCL-06`: a local session cannot read the kernel's key material. |
| D37 / A23-6 | The Claude-Code-to-local-endpoint probe is dropped; `G-LCL-05` becomes a `G-SUB-01` loopback-override refusal case; recorded for 8.1 (§13.2, OPEN 2 closed). |
| S22-C2 / A23-4 / D39 | Root key = non-exportable hardware P-256 (Secure Enclave on macOS; TPM via Windows Hello `KeyCredentialManager` or NCrypt platform provider on Windows) through small signed native helpers (`packages/gnomon-helper`); registry accepts `gkey-p256:v1` root rows; agent/device keys stay Ed25519 (§3.1). macOS Developer ID signing identity → OPEN 1. |
| D38 / A23-7 | Approvals key = hardware-backed, presence-unlocked once on TUI attach, held in memory, dropped after 15 min idle; fresh prompt always for gate-class, install, KNOT resolve, verdict, cloud fallback, budget resume; cached unlock covers `tool.permission`, `ask-user`, `plan`; `gnomon approve` from the CLI without a TUI prompts every time. The device-auth key (Ed25519, file) is split from the approvals key. No approval key on disk. §A.1 rewritten (§3.1, §3.4, §11, §A). |
| S22-C3 / A23-2 / A23-3 | Default-deny `mod` sandbox profile (writes only `~/.gnomon/mods/<name>/`, egress only through the kernel's host-allowlist proxy to granted hosts, no process exec); `packageHash` over the whole mod tree; mod kinds under `modns.<name>.*` (cannot collide with kernel `mod.*`); `kernel.call` carries the caller hsid and intersects scopes, spend comes from the session's permit; mod tools reach agents as a per-session MCP server run by the host (the ≤12 kernel proxy is untouched); `init`/`shutdown`/`cancel`/feature negotiation; `modAbiId`; `gnomon mod new`, stderr in `inspect`; mod children stop on idle exit (§12). |
| S22-H1 / S22-H8 | `session` profile denies AppleEvents, LaunchServices (`open`), `launchctl`, mic/camera, writes under `~/.gnomon` and to every Claude settings layer; `G-SBX-04..06` run against the session profile; Windows reports `partial` where reads cannot be denied (`WRITE_RESTRICTED` restricts writes only) (§15.5, §A.3). |
| S22-H2 / S22-H3 | Law 7 watches every settings layer mid-session (deny writes via profile + `fs.watch`; change ⇒ kill + `billing.api.refused{where}` + gate-class card); scans any non-default `*_BASE_URL`, `mcp.json` env blocks, and current managed-policy sources (`C:\Program Files\ClaudeCode\managed-settings.json`, `managed-settings.d/`, HKLM/HKCU policy; macOS managed preferences; `C:\ProgramData\ClaudeCode` retired at v2.1.75); only `#claude-adapter` consumes Claude permits (`permit.backend` binding); `gnomon-local` endpoints loopback/LAN only in root-signed config; mod/MCP egress grants refuse Anthropic API hosts; the api-token secret lives in the keystore and is injected into exactly one process; residual (out-of-kernel `claude` + repo `.env`) stated as visibility only (§3.4, §10, §13.2). |
| S22-H4 | Git: `GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1 GIT_ATTR_NOSYSTEM=1`; refuse a `.git/config`/`.gitattributes` declaring `filter.*`, `merge.*.driver`, `diff.*.textconv`, `include*`; kernel git always inside the `git` sandbox class (§3.3). |
| S22-H5 | `card.*` slots append-only; kernel card bodies and status indicators unreplaceable; mod content fenced and labelled `mod:<name>`; decision keys reserved; C0/C1/OSC (incl. OSC 52, OSC 8) stripped from every block string and transcript line (§4.5, §11, §12.2). |
| S22-H7 / D39 | Windows named pipe created by the signed helper with a DACL + `FIRST_PIPE_INSTANCE`; clients verify the server PID via `GetNamedPipeServerProcessId` against the pidfile (also peer credentials on Windows) (§2.4, §16). |
| S22-M1..M3 / A23-2 | Voice gets its own principal `p:<ns>/voice` with its own device key (scope `voice`: never `approve`, never root verbs, never a decision by speech); speaker id is not authentication; `voice.*` becomes a userland grant namespace; enrolment = root-signed rows; only the founder's enrolled turns are forwarded by default; voiceprints under `~/.gnomon/voice/prints/` labelled `secret`, deletable (`gnomon voice forget`); voice text as prunable blobs; AEC or headphones required for conversation mode; turns tagged `source: voice`; the `voice` ref scheme dropped (§14). |
| S22-M4 | Reviewer egress through a kernel-run loopback proxy with a hostname allowlist (sandbox allows network only to that port) — hostnames are not enforceable inside `sandbox-exec` (§7.3, §15.5). |
| S22-M5 / S22-L1 / S22-L2 | Mod-principal column in the ABI matrix; `gnomon mod rollback`, `voice enrol|forget` in the human-only verb list; "user-less child" removed (§5, §3.1). |
| A23-1 | `G-LAW-01c` → M1.8, `G-SUB-01` → M1.7; claim expiry defined (`ttl` param, default 2 h, kernel timer); `repo` id = `project.yaml.repoId` when present, else root commit (§4.1, §7.4, §19). |
| A23-2 | Manifest `kind: adapter` is first-party only (§4.3). |
| A23-4 | Interrupt on both OS via the stream-json control message (`control_request interrupt`), not SIGINT/CTRL_C; env allowlist adds `PATHEXT WINDIR SystemDrive ProgramFiles CLAUDE_CODE_GIT_BASH_PATH`; `layersHash` normalizes CRLF and path case (§3.3). |
| A23-5 / D36 | ONE Move 1 kept (founder); inside it: M1.0 probes the Windows root-key type, pipe helper and local capability; Windows CI on platform-independent tests from day one; each test attached to the task that can pass it; `gnomon-oracle` profile moves to M2.3 (§19). |
| A23-7 | Compaction re-derived (not lifted from pi-coding-agent `compaction.ts:129` / `branch-summarization.ts:305`) with an ~8k target; Gnomon departs from `lifecycle.ts:44-50`'s `os.tmpdir()` fallback (stated); suffixed test ranges defined (`G-SBX-04w..06w`); `gnomon-kernel` Warpline token stored at `~/.gnomon/warpline/<repoId>.token` 0600, denied to sessions (§3.2, §6.2, §7.1, §13.1). |
| A23 citations | `agents.ts:456` for the forbidden-flag throw; deepseek-harness paths now cite the implementation (`packages/sandbox/sandbox-windows-acl/src/{index.ts:4,28, ffi.ts:253, runner.ts:4}` @ `86a402200d`); noted that dsh moved to React/Electron even after the cache fix (§11). |

---

## 1. Thesis, positioning, non-goals

**Thesis.** Gnomon is the kernel and the shell beneath the armada: one hash-chained log, one identity, one approval broker with the budget fuse inside, one scheduler, one manifest grammar, a terminal-like GUI served on localhost that drives local models and Claude alike, and — in Warpline projects — every session Warpline-native from birth. Claude Code is the gold-standard coding agent and becomes a **headless backend** driven on the founder's subscription (`claude -p` stream-json, P8-D26/D34/D35); local models are first-class backends for automations (P8-D20: "that's why I wanted my own harness"). The owned kernel is justified by three things Claude Code alone cannot give (lore L-2026-10-16-ascend-065405-001): local-model automations, a cross-session budget and log, and merge adjudication. The founder's tools already form a harness in pieces (04-scout-own-family.md); 8.0 is a deletion project before a build project (07). Positioning (13-fable-names.md): **"ruflo coordinates agents; Gnomon adjudicates their work"** — and owns the seat they are driven from. The market converges on plugins/skills/hooks/worktrees and nobody adjudicates merges (03; dsh refuses, 02); nobody ships local two-way voice with a durable team transcript (20); nobody sandboxes mods (21); nobody gives a human and their agents a shared, replayable sheet whose every mark is a log event (§12.7). Those are Gnomon's slots.

**Non-goals (8.0).**
- NOT the Loom lane: no breadth-first meta-harness, no tool sprawl, no roleplayed distributed protocols, no agent-type catalog (09).
- **We don't re-wrap Task.** No Gnomon tool description steers a model off Claude Code's native Task/Agent tools (09 §4). Gnomon spawns supervised processes with permits, credentials, worktrees and a ledger.
- Not a hosted web app, not Electron, not an in-terminal UI: the shell (`#gui`) is a local web page served by the kernel on `127.0.0.1` and opened in the user's browser (P8-D50), with an optional thin desktop wrapper later (Tauri, macOS + Windows, §11.1); nothing ever listens beyond loopback; the terminal gets the CLI only (P8-D51). Conductor, constellation, Platform, Atelier Studio, flow's GUI and any community GUI stay as peers and clients of the same published API (§4.9, §12.8). deepseek-harness's move from a terminal renderer to React/Electron (23) is read as "the shell wants a DOM", which the browser already provides without Electron's footprint.
- Not a new knowledge store: neurons vault, notebooks, lore, decisions, `.purpose`, Warpline fabric bytes are never migrated (§17); shared knowledge search (§8.10) reads them in place.
- Not the Warpline server (TD-2026-10-14-551).
- Not cloud voice: only text goes to Claude; raw audio never leaves the box (P8-D29).
- Not containers (sandbox profiles; §A.2).
- Not a second human, shared fabrics, teleport, ruflo interop, public marketplace (§21).
- Not Rust, not Swift for the kernel (05 §4): TypeScript on Node 24; FluidAudio (Swift) is an optional Mac voice backend behind a Node interface; native helpers (`packages/gnomon-helper`) are small, signed and do one thing each (§3.1, §16); the optional desktop wrapper is a shell around the page, never a second implementation of it.

---

## 2. Architecture

### 2.1 Kernel vs userland (TD-950 §2, amended by D26/D27/D33/D37/D50)

| Ring | Owns | Never contains |
|---|---|---|
| **Kernel** (`#gnomon-kernel`, one daemon per user, zero runtime npm deps) | `#identity`, `#kernel-log`, `#session-runner` + `#supervisor` over two stdio drivers (`#claude-adapter` → `claude -p`; `#local-runner` → the `gnomon-local` child), `#approval-broker` with `#budget-fuse` inside, `#scheduler`, `#manifest-loader`, `#ref-resolver`, `#socket` (the ABI, §5, over the unix socket / named pipe) and `#web-endpoint` (the same ABI over a loopback WebSocket plus the static GUI bundle served as opaque bytes, §11.2), `#oracle-sandbox` (§15.5), `#mod-host` (child per mod, sandboxed, effects enforced, linked folders watched, §12) | the symbol graph, notebooks, calibration, `#contracts-compiler`, the Warpline engine (`warplined`), neurons, lore, the GUI's code, voice, pi-ai/pi-agent-core, React, Excalidraw, any model loop or LLM call of its own |
| **Userland** | `#gui` (the localhost GUI, a browser page that is a WebSocket client of the ABI), mods (manifest packages, including the first-party `#workshop-mod`, `#gnome-persona-mod`, `#doodle-mod`), `#knowledge-query` (federated knowledge search over manifest-registered providers), `gnomon-local` (pi-agent-core + pi-ai, a separate executable), `#gnomon-voice` (its own principal), `#learning-loop`, the compiler, `warplined`, neurons, lore, constellation/flow/Conductor/Platform clients, community GUIs and tools built on the published client API, the optional Claude Code Mod band | kernel state (it appends granted event kinds and reads the log) |

Boundary falsifier (05 §6.1, `G-KRN-01`): the kernel boots with zero userland packages and runs one Claude session and one local session end to end; `gnomon replay` reproduces every kernel-controlled input byte-for-byte while recording the hashes of host layers it does not control (§3.3). Any kernel import of `@a-company/premise-core`, any `@a-company/warpline` module, `paradigm-mcp`, `@a-company/gnomon-gui`, `@a-company/gnomon-mods`, `@a-company/gnomon-local`, pi-ai, pi-agent-core, React or Excalidraw is a build failure (`G-KRN-02`); `G-SEC-01` asserts the kernel's `package.json` has no runtime dependencies (pi-ai bundles Anthropic/Bedrock/Google/OpenAI SDKs — verified `packages/ai/package.json`, 23 — which is exactly why it cannot live in the law-7 process). The kernel serves the GUI bundle as static files from a root-signed path with `node:http` and speaks RFC 6455 WebSocket server framing implemented in the kernel over the `node:http` upgrade event (no dependency; Node 24 ships a WebSocket client, not a server); it never evaluates, imports or inspects GUI code. The kernel never composes prompts of its own beyond the one pointer line (§6.2) and the adapters' system envelope; the local model loop lives in the `gnomon-local` child (§13), outside the kernel.

### 2.2 Topology: the GUI is a client, the kernel owns sessions (OpenCode's split, 21)

- **Clients** speak `gnomon-rpc:v1` (§4.9): `#gui` (primary shell, a browser page over the loopback WebSocket), `#gnomon-voice` (its own principal, §14.4), the Claude Code plugin (hooks + ≤12-tool MCP proxy, for interactive Claude Code sessions the founder still opens by hand), the optional Mod band, constellation, Conductor (Swift, M3.6), flow (Python), Platform, Atelier, and any community GUI or tool built from the published client API (§12.8) — all peers under the same auth and the same unspoofable-card rules. A client never owns a session; `session.open` is always a kernel act, so a closed browser tab or a crashed client leaves sessions running and re-attachable (`G-GUI-05`).
- **Distros** are manifests (§4.3): `paradigm` (default), `atelier`, `flow`, `constellation`.
- **Backend drivers** (`#backend-adapter` interface): `start(spec) → handle`, `send(handle, turn)`, `steer(handle, text)` (mid-turn queue, QM MessageQueue idea), `stop(handle, {interrupt})` (interrupt = the backend's control message, never a signal), typed events `init | turn.start | partial{delta} | message{usage?} | tool.use | tool.result | permission.request | ask.user{question} | plan.exit{plan} | result{usage,total_cost_usd} | exited | quota.error | model.capabilities`. Two implementations in 8.0, both **stdio children**: `#claude-adapter` (`claude -p`, §3.3) and `#local-runner` (`gnomon-local --mode rpc`, §13). Usage comes only from driver events, never model text (10 §1). Conformance: recorded transcripts replayed per backend version nightly (`G-ADP-01`, `G-ADP-02`).

### 2.3 ASCII

```
            ┌──────────────────────────────── userland ──────────────────────────────────┐
            │  browser tab: #gui (papercraft | phosphor)      gnomon-voice (p:voice)      │
            │    transcript · decision stack · sessions · Shuttle view · command palette   │
            │    views ← mods (children, default-deny profile): workshop · gnome · doodle  │
            │  knowledge-query  contracts-compiler  learning-loop  warplined  neurons       │
            │  constellation  flow(py)  Conductor  community GUIs/tools  optional band      │
            └──────────┬──────────────────────────────────────────┬───────────────────────┘
       ws://127.0.0.1:<port>/rpc (launch token → GUI token)        │ gnomon-rpc:v1 (unix socket | helper-created named pipe)
  ┌──────────────────▼──────────────────────────────────────────────▼─────────────────────┐
  │ web-endpoint (127.0.0.1 only · origin lock · Host allowlist · no cookies · CSP)  socket │
  │ mutual auth(device key | GUI token | read token) · subscribe · 12 verbs · status (F4)   │
  │ approval-broker ── budget-fuse (tokens · USD · compute · subscription windows · law 7)   │
  │ session-runner ── supervisor ── #claude-adapter (claude -p) │ #local-runner (stdio)     │
  │ identity (root P-256 in SE/TPM · approvals key HW-backed · device keys Ed25519)         │
  │ manifest-loader · mod-host (child per mod, linked folders watched) · ref-resolver        │
  │ scheduler · oracle-sandbox (profiles: oracle · reviewer · session · mod · git) · log     │
  └────────────────┬──────────────────────────────┬────────────────────────────────────────┘
                   ▼ (session profile)             ▼ (session profile)
   claude -p --output-format stream-json …    gnomon-local --mode rpc  →  llama.cpp / Ollama / LM Studio / vLLM / mlx_lm.server (loopback/LAN only)
   (subscription only, law 7)                 (pi-agent-core + pi-ai, outside the kernel)
```

### 2.4 Daemon lifecycle (`$daemon-lifecycle`)

1. **One per user.** Lock file `~/.gnomon/gnomon.pid` created `O_EXCL` (`daemonPid:v1 {pid, startedAt, socketPath}`); live holder refuses, dead holder cleaned and re-raced — lifted from `packages/warpline/src/daemon/lifecycle.ts:1-14`. Endpoint: unix socket `~/.gnomon/gnomon.sock` (0600; `$XDG_RUNTIME_DIR` fallback on Linux when `sun_path` overflows, `lifecycle.ts:33-50`; Gnomon deliberately departs from `lifecycle.ts:44-50`'s `os.tmpdir()` fallback — never `/tmp` — and refuses to start if neither fits) or, on Windows, a named pipe `\\.\pipe\gnomon-<sha256(userSid)[0..16]>` created **by the signed helper** with an owner-only DACL (current user SID only) and `FIRST_PIPE_INSTANCE`; clients verify the server PID (`GetNamedPipeServerProcessId`) against the pidfile before `hello` (S22-H7; §16). The loopback web endpoint (`127.0.0.1`, ephemeral port, §11.2) listens only while a GUI session is wanted — started by the first `gnomon open`, stopped at idle exit.
2. **Client activation.** A client that cannot connect runs `gnomon daemon --detach` and reconnects (5 × 200 ms); the daemon re-execs itself with a fixed clean env (`PATH` from root-signed config, `HOME`/`USERPROFILE`, locale; `NODE_OPTIONS` and all `GNOMON_*` dropped) so the activator's environment never reaches the key-holding process (S-H3). Backend binaries (`claude`, `gnomon-local`, llama.cpp, Ollama) and the GUI bundle directory come from root-signed config paths. launchd/Task Scheduler/service activation is 8.1.
3. **Idle exit.** No live sessions ∧ no subscribers (an attached GUI session counts as a subscriber until its reconnect grace lapses, §11.2) ∧ no due timers inside 10 min ⇒ mod children are stopped (`mod.stopped{reason:'idle'}`), then `daemon.exit{reason:'idle'}` (A23-2: resident mods never hold the daemon open). Timers are log-derived; a timer due while down fires on the next activation as an attended event.
4. **Crash posture.** Chain write before side effect. On restart, orphans (sessions, local runners, mods) are found by `*.spawned` without `*.exited`; pgid/job probed and stopped with `session.orphaned` (`G-DMN-04`).
5. **Degrade path (documented, not built):** daemonless library mode; promotable without ABI change.

---

## 3. Kernel primitives

### 3.1 `#identity` — principals, three key classes, hsid

**Key classes (D38, D39, A23-7).**
```
root key       non-exportable hardware P-256: Secure Enclave (macOS) via the signed helper; Windows Hello KeyCredentialManager or NCrypt platform provider (TPM).
               Presence per signature. Signs registry rows, grants, config, install, api-token decisions. keyId "gkey-p256:v1:<sha256(spki)>".
approvals key  hardware-backed P-256 (same providers), unlocked by presence ONCE when a GUI session attaches (§11.2), held in kernel memory, dropped after 15 min idle or when the GUI session ends.
               Fresh presence ALWAYS for: gate-class, install, knot resolve, verdict, fallback-cloud, budget resume. Cached unlock covers tool.permission, ask-user, plan.
               `gnomon approve` from a CLI without an attached GUI session prompts every time. Never on disk.
device key     Ed25519, file 0600 (`~/.gnomon/keys/device.key`), authenticates this device's clients on the socket; several devices under one principal (Q1). Cannot approve.
agent keys     Ed25519 files for roster agents; session keys ephemeral; voice principal has its own device key (§14.4).
```

**Data model (D24/Q1–Q3, D38/D39).**
```
ns            = base32(sha256(rootPublicKey))[0..8]                     — the namespace of this trust set (8.0: one human)
principal:v1  { principalId:"p:<ns>/<name>", kind: human|agent|session|kernel|mod|voice, keys:[keyId…] (device keys), parent?, createdAt, scope }
device:v1     { deviceId:"dev:<ns>/<host>", principalId, keyId:"gkey:v1:<sha256 of normalized spki PEM>", createdAt }   — several devices, one principal
~/.gnomon/keys/registry.jsonl   append-only { row, signer:<rootKeyId>, sig } — PUBLIC material; accepts gkey:v1 (Ed25519) and gkey-p256:v1 rows;
                                a row without a valid signature from a signer in the trust set never resolves; unsigned/malformed rows surfaced (keys.ts:338-360,309-330)
~/.gnomon/keys/device.key       this device's Ed25519 key (0600 / owner-only ACL): authenticates CLI clients (including the GUI launcher `gnomon open`) on the socket; cannot approve
~/.gnomon/keys/<principal>.key  agent keys (roster agents' Gnomon keys), 0600
~/.gnomon/sessions/<hsid>/key   ephemeral session key, deleted on exit
root key / approvals key        hardware (Secure Enclave / TPM) behind `packages/gnomon-helper` — never files, never exportable
~/.gnomon/grants.jsonl          append-only { grant, signer:<rootKeyId>, sig }
```
Generalizes `packages/warpline/src/fabric/keys.ts`: key identity `keys.ts:15-18,126-129`; principal grammar `keys.ts:73-77`; fail-closed loaders `keys.ts:223-239`; registry reader that skips AND surfaces malformed rows `keys.ts:338-360`, closed-kind posture `keys.ts:309-330`; first-row pin `keys.ts:28-32,397-402`. Signature domains: `gnomon:event-sig:v1`, `gnomon:row-sig:v1`, `gnomon:approve:v1\n<cardId>\n<decision>\n<cardContentHash>\n<approverPrincipalId>` (approver in the preimage, Q5), `gnomon:auth:v1` (pattern `keys.ts:65,143-146`).

**Invariants.**
- I1 One agent key = one notebook owner = one Warpline signer. **The kernel never mints a Warpline key or daemon token** (P8-D14; `keys.ts:441-443`, `tokens.ts:3-6`). Warpline principals are stable roster agents whose Warpline credentials the founder mints once; sessions borrow them (`session.open{as}`); strand ↔ session link is `causes[]`. The kernel's own Warpline credential (for shadow admissions) is a human-minted agent-class token for `gnomon-kernel` (A17-a), stored at `~/.gnomon/warpline/<repoId>.token` (0600, denied to every sandbox class, A23-7).
- I2 Principal from a key or token, never an env var (TD-735 S1). `WARPLINE_AGENT_ID` stays Warpline's unsigned CLI marker.
- I3 The terminal gets the CLI only (P8-D51): `gnomon spawn | status | approve | replay | open | mod | knowledge | doodle | log …`; there is no in-terminal UI. Human-only CLI verbs fall in two classes: **root-signed** (`gnomon init`, `key mint`, `key device add|revoke`, `trust`, `install`, `uninstall`, `mod link|unlink|dev|rollback`, `billing api-token`, `voice enrol|forget`) require hardware presence (Touch ID / Windows Hello) for the root key per signature; **approval-signed** (`approve`, `daemon stop`, `log segment`) use the approvals key with the presence class of §3.4. The CLI refuses either class from a kernel-spawned shell (`GNOMON_HSID` set, or caller pgid/job = a live session's) with `refusal:v1 {code:'FORBIDDEN'}` and records `cli:{pid, ppid, pgid, tty}` in the resulting event (S16-5). `gnomon open` (the GUI launcher, §11.2) is device-authenticated rather than human-only and is refused from a kernel-spawned shell by the same check. Honest limit: `env -u` + `setsid`/a Terminal TTY defeat the shell check — the presence prompt is the boundary (§A.1).
- I4 Session, mod and voice principals are children: `scope ⊆ parent.scope`; they never widen a permit, never call `approve`, never bind to a manifest grant (mods bind only to their own `modns.<name>.*`).
- I5 Every registry and grants row names its `signer` and carries its signature; the trust set is the root key (8.0) and, in 8.1, cross-signed roots (§21). The first root row is pinned forever (`keys.ts:28-32,397-402` pattern).

**Failure modes.** Unknown key/token ⇒ `AUTH`; unsigned/malformed rows never resolve and are surfaced; helper or hardware key unavailable ⇒ root-signed and approval verbs refuse `UNSUPPORTED` (with the helper's error; never a software fallback, never a file); presence denied ⇒ `FORBIDDEN` logged `approval.presence.denied`.

### 3.2 `#kernel-log` — the one hash-chained index

**Data model.** SQLite via `node:sqlite` at `~/.gnomon/kernel.db` (a-flow design `sqlite.py:1-16,185-193`):
```sql
CREATE TABLE chain (seq INTEGER PRIMARY KEY, id TEXT NOT NULL UNIQUE, kind TEXT NOT NULL, at TEXT NOT NULL, principal TEXT NOT NULL,
                    audience TEXT NOT NULL, sensitivity TEXT NOT NULL, envelope TEXT NOT NULL, prev_hash TEXT NOT NULL, hash TEXT NOT NULL, sig TEXT);
-- seq = MAX(seq)+1 inside the write transaction (sqlite.py:943-951) — never AUTOINCREMENT
-- projections reference chain(seq); BEFORE UPDATE/DELETE triggers RAISE(ABORT) on chain and every projection (sqlite.py:9-11,535-537)
```
`hash = sha256(canonical(envelope minus hash, sig))`, `prev(seq=1) = sha256("gnomon-log-genesis:" + logId)` where `logId` is the genesis ULID (Q2) and `envelope.log = logId`. Canonical = Warpline's serializer (`warpline-fabric-schema-v2.md` §1.2). Decision reads join `chain` on `seq` AND `kind` (`sqlite.py:13-16,542-544`). Chain discipline from a-flow `chain.py:3-4,55-69`.

**Signatures and anchors (S-H1, D12).** `sig` mandatory on `approval.*`, `oracle.result`, `budget.*`, `permit.*`, `key.*`, `manifest.*`, `config.*`, `billing.*`, `verdict.*` and on every event appended by a keyed principal; diagnostics (`daemon.*`, `socket.*`, `schedule.*`) may be unsigned. Chain head `{seq, hash, at}` written after every commit to `~/.gnomon/head` and to the OS keystore item `gnomon-head` (Keychain generic password / Credential Manager generic credential; written by the signed helper; no user presence). On start: missing db with keys present ⇒ `INTEGRITY_BROKEN`; head ≠ anchor ⇒ `INTEGRITY_BROKEN`; `gnomon log verify` recomputes hashes, verifies signatures against the registry and checks both anchors. Scope stated: a same-user attacker who rewrites both anchors and re-signs with the Ed25519 keys read from disk (device, agent) defeats this for events those keys sign (§A.1); root-signed and approval-signed rows cannot be forged without hardware presence, because neither key exists on disk (D38/D39).

**Invariants.** L1 Append-only. L2 Model-visible ⟺ logged for kernel-added bytes (`session.inject{origin:'kernel'}` before the child reads them, `G-LOG-03`); client-origin injects logged uncapped; userland injections logged by userland as `inject.receipt`. L3 Fabric separate; `warpline.*` events carry `ref:"wl:pick/<pickId>"` + `refHash` and `causes[]`; telemetry `T-LOG-05`. L4 Ids never collide (ULIDs; `pev:` wraps 7.x ids). L5 Segment at 10⁶ rows (epoch-anchor pattern, `warpline-v3-identity.md` §5); retention (S22-M2): `session.inject` bytes kept forever; `voice.turn.*` text is stored as blobs retained until the session's lore compaction exists + 90 days unless pinned by the human; `turn.event` bodies, oracle evidence and any opt-in audio pruned at their TTL with `blob.pruned{sha}`. L6 `audience` (`private | team | org`, default `private`) and `sensitivity` (`normal | sensitive | secret`) are set at append and never relaxed in place; sharing (8.1) is a projection filtered by them (Q6). L7 A kind in a userland namespace is never written by the kernel and vice versa (ownership table §5).

### 3.3 `#session-runner` + `#supervisor` — one supervisor, two stdio drivers

**Responsibilities.** Preflight; mint session principal + hsid; obtain a permit (tokens/USD for Claude, compute for local); route by `model` (§13.3); select the roster credential (Warpline mode); build policy/env/argv; spawn the driver child in its own process group (job object on Windows) under the `session` profile; parse events; meter usage; staged stop; respawn; orphan sweep. Replaces three runners (04): `a-flow/.../headless.py`, `a-constellation/server/agents.ts`, `ClaudeStreamSession.swift` (deleted M3.6).

**Session model.**
```
session:v1 { hsid, principalId, as?, backend:{kind:'claude-code'|'local', uuid?, binarySha256, version, endpoint?, model, compatProfile?}, cwd, worktree?,
             mode: warpline|git|none, declaredModel: local|claude|any, attended: bool, policyHash, mcpHash, layersHash, gitHash, permitId, parent?, state, startedAt, lastActiveAt }
```

**`#claude-adapter` argv** (shared core `headless.py:133-154` + `agents.ts:433-446`; constellation's extras `agents.ts:447-454`):
```
claude -p --input-format stream-json --output-format stream-json --verbose --replay-user-messages --include-partial-messages
       --permission-mode default --permission-prompts none (--session-id <uuid> | --resume <uuid>) --settings <policy.json>
       --setting-sources <explicit list, verified in M1.0>  --mcp-config <mcp.json> --strict-mcp-config
       [--append-system-prompt <bytes>] [--model <m>]
```
`--include-partial-messages` feeds the GUI's live stream (D34; 21 "Headless loses"). `FORBIDDEN_FLAGS = {--dangerously-skip-permissions, --allowedTools, --allowed-tools, --bare}` checked with a **throw** (`agents.ts:40,456`; not `headless.py:153`'s `assert`). Interrupt = the stream-json control message `control_request{subtype:'interrupt'}` on both OS (A23-4), never SIGINT/`GenerateConsoleCtrlEvent`; Esc in the GUI ⇒ `session.stop{interrupt:true}`. `AskUserQuestion` ⇒ `ask-user` card; `ExitPlanMode` ⇒ `plan` card.

**`#local-runner` argv:** `gnomon-local --mode rpc --config <root-signed local.yaml> --session <hsid>` — a separate executable (`packages/gnomon-local`, pi's `rpc-entry.ts` JSONL protocol shape, 23) spawned under the `session` profile exactly like `claude -p`; it owns the model loop and the tools; the kernel sees only its JSONL events (§13).

**Preflight** (lift `headless.py:612-618`, `claudeCli.ts:21-97`) — authoritative before every spawn and respawn: binary realpath + sha (`headless.py:528-531`, `claudeCli.ts:21-25`; refuse changed binary on respawn); version ≥ 2.1.288 (`claudeCli.ts:13`); **law 7 scan** (§3.4) over the session env, every settings layer, `mcp.json` env blocks and the current managed-policy sources — macOS `/Library/Application Support/ClaudeCode/managed-settings.json` + managed preferences; Windows `C:\Program Files\ClaudeCode\managed-settings.json`, `managed-settings.d/*.json`, HKLM/HKCU policy keys (`C:\ProgramData\ClaudeCode` retired at v2.1.75); Linux `/etc/claude-code/managed-settings.json` — plus `~/.claude/settings.json`, the session policy and project `.claude/settings*.json`, none of which may set `apiKeyHelper`, `env.ANTHROPIC_*`, `env.CLAUDE_CODE_USE_*` or any non-default `*_BASE_URL` (`headless.py:550-584`, `claudeCli.ts:63-76`); the session env must not carry `ANTHROPIC_API_KEY`/`ANTHROPIC_AUTH_TOKEN`; `claude auth status` says `authMethod:"claude.ai"`, `apiProvider:"firstParty"` (`headless.py:586-610`, `claudeCli.ts:79-97`); `init.apiKeySource ≠ "none"` kills the group (`headless.py:33-37`). For local sessions: endpoint ∈ loopback/RFC1918 per root-signed `local.yaml`, else `BILLING_REFUSED`. Any failure ⇒ `session.refused{code}` with flow's closed codes preserved (`claude_version | not_subscription_auth | spawn_failed | claude_binary_changed | bad_message | session_busy`) plus `api_billing_refused`.

**Settings layers (S-H7, S16-7, S22-H2).** The kernel hashes every layer it can see — managed, user, project, local, worktree `.claude/**`, `CLAUDE.md`, `CLAUDE.local.md`, user-scope skills/plugins listing — into `layersHash`, and `.git/config`, `.git/hooks/**`, `.git/info/**`, `.gitattributes` into `gitHash` (S16-2), both normalized for CRLF and path case (A23-4), at every spawn AND respawn; a change against the previous value or against the base revision is **gate-class** (§15.7) regardless of whether the file is gitignored or appears in a diff. The same layers are **watched mid-session** (`fs.watch`/`ReadDirectoryChangesW`): a change ⇒ `session.stop{interrupt}` + `billing.api.refused{where}` when law-7-relevant, otherwise a `gate-class` card; `session.layers.changed{which}` is logged either way. `--setting-sources` is passed explicitly to limit layers (flag verified in M1.0; QM uses `settingSources:[]`, 21). `G-KRN-01` claims replay of kernel-controlled inputs plus recorded hashes, not of host context.

**Git hardening (S16-2, S22-H4).** Every kernel git invocation (`worktree add`, `merge-tree`, `show <base>:…`, fast-forward) runs with env `GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1 GIT_ATTR_NOSYSTEM=1` and flags `-c core.hooksPath=<empty dir> -c core.fsmonitor=false -c core.sshCommand=false -c protocol.allow=never -c safe.directory=<root> -c core.longpaths=true`; a repo whose `.git/config` or `.gitattributes` declares `filter.*`, `merge.*.driver`, `diff.*.textconv`, `include`/`includeIf` is refused until a human decides (`gate-class`); git runs inside the `git` sandbox class (§15.5), never in the daemon process's own context; `gitHash` drift refuses the operation until a human decides.

**Environment.** Allowlist `HOME USER LOGNAME LANG LC_ALL LC_CTYPE TMPDIR` + `PATH SHELL` (`headless.py:97`, `claudeCli.ts:15`; Windows adds `USERPROFILE SYSTEMROOT WINDIR SystemDrive ProgramFiles COMSPEC PATHEXT APPDATA LOCALAPPDATA TEMP CLAUDE_CODE_GIT_BASH_PATH`), scrub `ANTHROPIC_* CLAUDE_CODE_USE_* CLAUDE_CODE_OAUTH* CLAUDE_CONFIG_DIR NODE_OPTIONS GNOMON_* *_BASE_URL` (`headless.py:98-99`, `claudeCli.ts:16`), add `GNOMON_HSID GNOMON_SOCK GNOMON_SESSION_KEY` and, in Warpline mode, `WARPLINE_AGENT_ID` + `WARPLINE_MCP_TOKEN` (`tokens.ts:295-297`). `envKeys[]` logged. Session-key custody stated honestly: path in env, readable by the session's tool children; blast radius = the session's scope (I4; the key cannot approve); the `session` sandbox denies `~/.gnomon/keys/**`, so it cannot read the device or agent keys, and the approvals key is a hardware handle the kernel alone holds (D38).

**Process.** macOS/Linux: `detached:true`, own pgid, staged stop control message → close stdin → SIGTERM → SIGKILL on the group + sweep (`headless.py:339-351,483-507`, `agents.ts:38,460`). Windows: spawn inside a job object with `KILL_ON_JOB_CLOSE` via the signed helper (§16); staged stop = control message → close stdin → `TerminateJobObject`; `taskkill /T /F` fallback logged `partial`. stderr cap 64 KiB; stdout lines cap 4 MiB with `dropped` events (`agents.ts:36,506-513`); leader-exit grace 2 s (`headless.py:389-403`); idle respawn `--resume` charged as a launch (`agents.ts:34,445`); crash cap 3/10 min (`agents.ts:37-39`); busy-elsewhere check (`claudeCli.ts:113-117`).

**Invariants.** S1 No process creation without `permit.grant` (law 1). S2 Every driver event is a `turn.event` before anything acts on it. S3 `turn.usage` (partial/assistant messages) and `turn.result` are the only `budget.usage` sources; mid-turn breach kills the group/job. S4 Children die with the session. S5 Replay per §2.1. S6 `session.*` appended only by the supervisor. S7 A `model: local` session never spawns `claude` without a `fallback-cloud` card decision (§13.3). S8 Only `#claude-adapter` consumes a permit with `backend:'claude-code'` (`permit.backend` binding, S22-H3).

### 3.4 `#approval-broker` + `#budget-fuse`

**Cards (`card:v1`, Q5).**
```
card:v1 { cardId, kind: permission|budget|knot|tend|verdict|merge-conflict|gate-class|install|fallback|ask-user|plan|api-token|voice-share,
          requestedBy: principalId, hsid?, contractId?, nodeId?, attended: bool,          // attended = a human client is subscribed to this session
          approverPolicy: { kind:'self' },                                                // roles/quorum reserved for 8.1 (Q5)
          block: display-block:v1, contentHash, actions:[kernel-signed], state, decidedBy?, decidedAt?, decisionSig?, presence?: fresh|cached|cli, cli?:{pid,ppid,pgid,tty} | {client:'gui', connId}, timeoutAt }
```
Decisions: `allow | always | deny | resume | resolve | accept | reject | install | answer{text} | approve-plan | fallback-cloud | use-api-token`. `always` appends `approval.rule.learned{tool, matchExact}` (S-L1). **Decision classes (D38):** **fresh-presence** `gate-class`, `install`, `resolve`, `accept|reject` (verdict), `fallback-cloud`, `resume`, `use-api-token` (root key); **cached-unlock** `allow|always|deny` on `tool.permission`, `answer` on `ask-user`, `approve-plan` on `plan`. `approval.decide` carries `decisionSig` (approver in the preimage), `presence: fresh|cached|cli` and `cli:{pid,ppid,pgid,tty}` provenance; `approval.suspect` flags decisions with no TTY, decisions whose `cli` ancestry contains a live session pgid/job, or decisions whose unlock was cached beyond its class, and surfaces them in the GUI inbox (S16-5) — honest scope: a process with its own TTY evades the ancestry check (S22 partial 5). Unattended sessions (`attended:false`) **wait** on cards; the GUI shows the wait; nothing is auto-decided (D21; QM attended/unattended, 18).

**The fuse — four dimensions.** (1) tokens per session/loop/day; (2) notional USD; (3) **compute** (D22): concurrent local sessions per machine, GPU/CPU seconds per hour, wall-time per local turn; (4) **subscription windows** (D35): the fuse models the subscription's rolling usage windows from `turn.usage`/`turn.result` and the adapter's rate-limit headers/`quota.error`, reserves a founder-interactive share (default 30 % of the window until the window shape is learned, OPEN 6) that armada sessions cannot consume, and pauses the armada at the threshold with a `budget` card. Ladder user → repo → loop → session, rungs 50/75/90/100 % announced once per scope per day; breaker on `quota.error` (60 min or human resume). Day windows computed from the chain's last event time (S-L2). Defaults ON, tunable only in root-signed `~/.gnomon/config.yaml`; **no env var, project file or CLI flag changes them**; `GNOMON_HOME` is a build-time constant of the test artifact, absent from production code (S16-6).

**Law 7 inside the broker (D35, S22-H2/H3).** `permit.reserve{kind:'session.spawn'|'turn'}` for `backend:'claude-code'` is refused `BILLING_REFUSED` when the scan finds an API-billing path in env, any settings layer, `mcp.json` env blocks, or any non-default `*_BASE_URL`; the scan list is versioned per `claude` version (`G-SUB-01` fixtures) and covers managed sources: macOS `/Library/Application Support/ClaudeCode/managed-settings.json` + managed preferences; Windows `C:\Program Files\ClaudeCode\managed-settings.json`, `managed-settings.d/*.json`, HKLM/HKCU policy keys (`C:\ProgramData\ClaudeCode` retired at v2.1.75); Linux `/etc/claude-code/`. A `gnomon-local` endpoint outside loopback/RFC1918 ⇒ `BILLING_REFUSED` (pi-ai's cloud providers are compiled out of `gnomon-local`'s compat allowlist, §13.1). Egress grants for mods/MCP servers refuse Anthropic API hosts. The only lawful API path is the `billing api-token` card: human-only, root-signed decision, **per use** (one session or one named automation run), carrying the reason, never a default, never a fallback target, never agent-requestable; the token is held in the keystore and injected into exactly one child's env; while active the GUI's Shuttle view shows a persistent `API CREDITS ACTIVE` indicator and `billing.api.active{hsid, until}` is logged every turn; expiry logs `billing.api.ended`. Residual stated: an out-of-kernel `claude` or a repo `.env` is visibility only (`status.unknownClaudeProcesses`).

**Honest fuse coverage.** Metered: kernel-spawned sessions (Claude + local), interactive Claude Code sessions registered by hooks (usage only). Not metered: a `claude -p` an agent runs from Bash outside the kernel (advisory policy deny; `status.unknownClaudeProcesses{n}` from `ps`/`tasklist` makes it visible). Task fan-out inside a turn is caught by per-message usage.

**Invariants.** B1 Nothing spends by default. B2 ULID permit ids. B3 Only the broker appends `approval.*`/`budget.*`/`permit.*`/`billing.*`, kernel-signed. B4 Agent/session/mod/voice kinds never decide cards or Warpline overrides (`protocol.ts:148-177`). B5 Corrupt state ⇒ deny. B6 An unattended card never expires into `allow`; `tool.permission` cards expire into `deny` (`agents.ts:721`); `fallback` and `api-token` cards never expire — they wait. B7 No decision is ever signed by a key on disk.

**Failure modes.** Broker unreachable ⇒ kernel-spawned sessions deny (`headless.py:54-58`); 7.x interactive sessions unaffected.

### 3.5 `#scheduler`

Log-derived timers only (`timer:v1`), recomputed on start (flow `timers` cache, `sqlite.py:21-22`); one daemon ⇒ one timer per key; a timer fires an event; whatever spends needs a permit; loop policies are userland over `loop:v1`; `loop.paused` is kernel-written (A17-3); claim expiry timers (§7.4) are scheduler timers. Automations (constellation/flow routines) register `automation:v1 {id, trigger, model: local|claude|any, attended:false}`; the scheduler fires `automation.due` and the runner routes per §13.3.

### 3.6 `#manifest-loader`

Validates `manifest:v1` (§4.3) including the mod ABI fields and `packageHash` over the whole mod tree (S22-H6); accepts `kind: adapter` only from the first-party trust tier (A23-2); refuses a mod whose `name` collides with a kernel namespace token; checks capabilities/egress against signed grants (`registry.py:9-24` refusals; egress grants naming Anthropic API hosts refused); generates `plugin.json`, `.mcp.json`, `hooks.json`, tool-family listing (`families.ts:28-53` tiers, `:55-92` table), per-session policy; hot-reloads mods by `packageHash`; accepts linked-folder sources (`gnomon mod link`, §12.5) and pauses them on any change until re-carded; validates `provides.knowledge` (§8.10); `install` card for anything agent-written or linked with pinned hash and one-command rollback (`gnomon mod rollback <name>`, human-only); no `postinstall` anywhere; generated files carry markers; `gnomon uninstall` removes exactly those (law 4). `generate-hooks.mjs` subsumed (JSON out, scripts stay in `src/commands/hooks/scripts/`).

### 3.7 `#ref-resolver`

Grammar in the kernel (§4.4); resolvers userland and read-only; built-in schemes `ev hsid cc gkey dev permit card contract node pev`; `sym wl n s td l t spec doodle` registered by their packages (`doodle` by the Doodle mod, §12.7; the `voice` scheme is dropped, A23-2).

### 3.8 `#mod-host` (D33, S22-C3, A23-3)

Spawns one child per installed mod (`node <entry>` with the allowlisted env) under the **`mod` sandbox profile** (default-deny: reads of the kit SDK + its own package + `~/.gnomon/mods/<name>/`, writes only `~/.gnomon/mods/<name>/`, network only to the kernel's loopback egress proxy for hosts in the mod's grant, no process exec), speaks `mod-abi:v1` over stdio JSON-RPC (§12.3), enforces declared effects at the RPC boundary AND by profile (a `tool.call` whose declared effects are `read` cannot open a write verb; `network` cannot be used without an egress grant; `spend` is drawn from the calling session's permit, never a mod's own), supervises health (`mod.health`), restarts on crash (cap 3/10 min), stops all children at idle exit (`mod.stopped`), forwards `view.render` results to clients as `display-block:v1` built from the closed kit through the block sanitizer (§4.5), serves the two client relays `mod.view`/`mod.command` (§12.3), and watches every linked mod folder — any change pauses that child and raises the re-approve card (§12.5). Mods never receive the socket credential; the host proxies `kernel.call` on their behalf under the mod's own principal `p:<ns>/mod-<name>` with the **caller's hsid attached and scopes intersected** (confused-deputy guard, A23-3).

---

## 4. Hard contracts (versioned; additive or a version bump)

### 4.1 Event envelope (`event:v1`)

```jsonc
{ "schemaVersion": "event:v1", "id": "ev:01J9Z6…",
  "log": "log:01J9…",                          // genesis ULID logId (Q2)
  "seq": 48213, "at": "…",
  "principal": "p:a1b2c3d4/ascend", "keyId": "gkey:v1:…", "deviceId": "dev:a1b2c3d4/macbook",   // server-stamped; principal.kind ∈ human|agent|session|kernel|mod|voice
  "connId": "conn:…", "idem": "sha256:…",
  "session": "hsid:v1:…",
  "scope": { "org": null, "team": null,        // reserved (Q4)
             "repo": "repo:<sha256(project.yaml.repoId)[0..16]>",   // repoId committed at `gnomon init`; else the root-commit sha (A23-1)
             "loop": "loop:…", "contract": "contract:v1:…" },
  "audience": "private", "sensitivity": "normal",   // Q6
  "kind": "session.spawned", "causes": ["ev:…", "wl:pick/pick:v3:…"],
  "payload": { … }, "ref": "wl:pick/…", "refHash": "sha256:…",
  "prev": "sha256:…", "hash": "sha256:…", "sig": "…" }
```

### 4.2 hsid + aliases

`hsid:v1:<ULID>` kernel-issued; `hsid:v1d:<base32(sha256("gnomon:hsid:v1d\n" + principalId + "\n" + "cc:" + uuid))[0..26]>` derived for interactive Claude Code sessions, keyed on the **namespaced** principalId (Q7), accepted only from that principal's device key, first registration wins (`session.alias.rejected` on squat). Hooks read `session_id` from stdin JSON (fallback `$CLAUDE_SESSION_ID`; probe in M1.0, P8-D18). Aliases `cc: wl:session const: flow:` (the `voice:` alias went with the dropped scheme, A23-2).

### 4.3 Manifest (`manifest:v1`, extended per 21 §5 / D33, S22-H5/H6, A23-2)

```yaml
manifest: 1
kind: distro | mod | provider | adapter | skill-pack     # adapter: accepted from the first-party trust tier only (A23-2)
name: diff-lens                  version: 1.2.0
abi: "mod-abi:v1"                # required for kind: mod; the kernel refuses an unknown abi
compat: { kernel: ">=8.0.0 <9", claudeCode: ">=2.1.288" }
provides:
  mcp: [...]   skills: [...]   agents: [...]   hooks: [{ event: <string>, command }]   bands: [...]   steps: [...]   resolvers: [...]   blocks: [...]   oracles: [...]
  tools:   [{ name: lens.diff, schema: {...}, effects: [read] }]                       # effects ⊆ read | write | network | spend ; enforced by #mod-host
  views:   [{ id: diff.pane, slot: panel, placement: append, fixtures: [fixtures/diff-pane.json] }]
           # slots: sidebar | panel | status.mod | composer.footer | tool.view:<tool> | card.detail:<kind>
           # placement: append | replace for sidebar/panel/composer.footer/tool.view; card.* and status.mod accept append ONLY (never replace, S22-H5)
  events:  [modns.diff-lens.*]                                                         # mod event kinds live under modns.<name>.* (A23-1)
  commands: [{ id: lens.toggle, title: "Toggle diff lens", args: {...} }]
  keybindings: [{ key: "ctrl+shift+d", command: lens.toggle }]                           # bind to command ids only, never to code; reserved decision keys refused (§12.2)
  knowledge: [{ name: diff-lens, scheme: "lens:", query: lens.search }]                  # knowledge provider (§8.10); needs capability knowledge:provide
requires: { capabilities: [...], egress: none | [{host, purpose}] }                     # Anthropic API hosts are refused in egress
config_schema: {...}
```
No `trust:` field (grant table only); no `source:` field either — package vs linked folder is an install-time fact recorded on the `grant.install` row (§12.5). `manifestHash = sha256(canonical(manifest))`; `packageHash = sha256(sorted file tree of the whole mod package)` sits beside it and pins installs, hot reloads and `grant.install` rows (S22-H6).

### 4.4 Ref grammar (`ref:v1`)

`ref = scheme ":" id ["@" rev]`; registered schemes `ev hsid cc gkey dev permit card contract node pev spec sym wl n s td l t knot doodle` (`doodle` per §12.7); aliases `# $ ^ ! ~ → sym:`, `TD- → td:`, `L- → l:`, `T- → t:`. The `voice` scheme is dropped (A23-2).

### 4.5 display-block (`display-block:v1`), the closed kit, and the sanitizer

```jsonc
{ "schemaVersion": "display-block:v1",
  "block": "kit.Box" | "kit.Text" | "kit.List" | "kit.Table" | "kit.Markdown" | "kit.Diff" | "kit.Progress" | "kit.Button" | "kit.Image" | "kit.Canvas" | "inbox.card" | "decision.stack" | "session.live" | "contract.progress" | "budget.meter" | "knot.split" | "ask-user" | "plan" | "voice.turn",
  "data": { … }, "children": [ … ], "refs": [...], "causes": [...], "at": "…" }
```
Kit `Box Text List Table Markdown Diff Progress Button Image Canvas`; `kit.Button` carries only `{command}` (a command id from a manifest); `kit.Image` requires `alt`; `kit.Canvas` names a doodle session and is rendered only by a host-owned surface (§12.2); a block carries **no actions**. Decision controls exist only on broker-authored `card:v1.actions[]` signed by the kernel (S-M4). Agent-authored text is data (`descriptors.ts:73-74`). **Sanitizer** (S22-H5): every string in a block, card or transcript line is stripped of C0/C1 controls (except `\n`, `\t`), all OSC sequences (including OSC 52 clipboard and OSC 8 hyperlinks), CSI/DCS/APC/PM sequences, before rendering or logging; in the GUI every string becomes a DOM text node and Markdown renders with raw HTML disabled, so markup inside a string is text, never code (§11.1). **Kernel-owned regions**: card bodies (`inbox.card`, `ask-user`, `plan`, `knot.split`, `budget.meter`), the status indicators (`API CREDITS ACTIVE`, mic state, budget rung) and the `contentHash` summary line are rendered by the GUI core (and by every conformant client, §12.8) and cannot be replaced or overlaid; mod content in `card.detail:<kind>` is appended below, fenced and labelled `mod:<name>`. The same kit renders in the GUI, in the CLI as a text projection (`kit.Image` → its `alt`, `kit.Canvas` → the mark list), in the optional Claude Code Mod band (mirroring its Pane kit shape, 21), in constellation, Conductor and any conformant community client (§12.8).

### 4.6 refusal (`refusal:v1`, Gnomon superset)

Shape and semantics lifted from `packages/warpline/src/fabric/refusal.ts:47-197` (schema id, `MAX_CONTESTED` 32, `RefusalGate`, `Retriability`, `RefusalNextStep{verb,params,requires,principal}`, `Refusal`), the single constructor `refuse()` (`:418-434`) and accessor `refusalOf()` (`:291-301`), with two schema differences so no engine type enters kernel contracts (A-boundary-4): `verdict` is `string | null` (Warpline's `AdmitStatus` values are legal strings) and `contested[].rule` is `string | null` (Warpline's `KnotRule`). Gnomon's `RefusalCode` is Warpline's twelve (`refusal.ts:76-88`) plus `BUDGET_DENIED` (gate `budget`, `retry-with-override`, `next:[{verb:'approve', principal:'human'}]`, exit 6), `PERMIT_REQUIRED` (gate `budget`, `retry-corrected`, `next:[{verb:'permit.reserve', principal:'agent'}]`, exit 2), `CAS_LOST` (gate `claim`, `retry-corrected`, `next:[{verb:'status'}]`, exit **7**, A17-5), `BILLING_REFUSED` (gate `billing`, retriable `never`, `next:[{verb:'approve', principal:'human'}]` pointing at an `api-token` card, exit 8), `MODEL_UNAVAILABLE` (gate `model`, retriable `retry-with-override`, `next:[{verb:'approve', principal:'human'}]` pointing at a `fallback` card, exit 9); gates add `budget`, `claim`, `billing`, `model`. Exit codes otherwise follow Warpline's table (`refusal.ts:213-226`). Warpline's schema is a strict subset; Warpline keeps its own file, no re-export (A-OPEN-13 answered); `G-CON-02` asserts subset-compatibility (every Warpline refusal validates against Gnomon's schema).

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
`nodeId` in events = the node's `ref`, always paired with `contractId` (`{contractId, nodeId:"sym:#socket"}`). A node with zero oracles ⇒ compile refusal `BAD_REQUEST gate:usage` naming the node.

### 4.8 Budget permit (`permit:v1`)

```jsonc
{ "schemaVersion": "permit:v1", "permitId": "permit:v1:<ulid>", "principal": "p:…", "hsid": "…",
  "scope": { "org": null, "team": null, "user": "p:…", "repo": "repo:…", "loop": "loop:…", "session": "hsid:v1:…", "machine": "dev:…" },
  "kind": "session.spawn" | "turn" | "tool.permission" | "tend.llm" | "oracle.reviewer" | "teacher.draft" | "mod.spend",
  "backend": "claude-code" | "local", "model": "…", "billing": "subscription" | "api-token:<cardId>" | "local",   // backend is BINDING: only #claude-adapter may consume claude-code (S8)
  "limits": { "tokens": 400000, "usd": 4.0, "computeSeconds": 600, "concurrent": 2 },
  "issuedAt": "…", "expiresAt": "…", "ladder": { "user": 0.41, "repo": 0.12, "loop": null, "session": 0, "machine": 0.5, "subscriptionWindow": 0.62 },
  "decision": "allow" | "deny", "sig": "…" }
```

### 4.9 Socket protocol (`gnomon-rpc:v1`)

JSON-RPC 2.0, newline-delimited, over the unix socket or named pipe; every frame carries `"rpc":"gnomon-rpc:v1"`. **Mutual auth** (S-H4): `hello` → `{nonce, serverKeyId, serverSig over 'gnomon:auth-server:v1\n'+nonce+'\n'+endpointPath}` → `auth {principal, deviceId, sig over 'gnomon:auth:v1\n'+nonce+'\n'+serverKeyId+'\n'+principalId+'\n'+deviceId+'\n'+endpointPath}` or `{token}` (read-scoped, `tokens.ts:137-154` constant-time resolve) → `{principal, connId}`. The client verifies `serverSig` against the registry's kernel key before sending `auth` (a relay that cannot sign as the kernel is detected); on Windows the client additionally checks the pipe server's PID against the pidfile before `hello` (§2.4). Nonce single-use, 30 s; failed auth closes after one `AUTH` refusal. Identity bound per connection (`connId` on every event). Calls → `{result}` or `{error:{code, message, data: refusal:v1}}`; total code map: AUTH -32001, FORBIDDEN -32002, NOT_FOUND -32004, UNSUPPORTED -32005, BAD_REQUEST -32600, UNKNOWN_VERB -32601, ENGINE -32000, BUDGET_DENIED -32010, PERMIT_REQUIRED -32011, CAS_LOST -32012, INTEGRITY_BROKEN -32013, GATE_REFUSED -32020, CLAIM_BREACH -32021, TRUST_HELD -32022, STALE_BASE -32023, BILLING_REFUSED -32030, MODEL_UNAVAILABLE -32031 (verdict-class codes normally ride inside results). Subscription `log.read{follow:true}` returns the backlog then streams `event` notifications; backpressure > 10 000 undelivered frames ⇒ drop + `socket.subscription.dropped{connId, lag}`; the client re-subscribes with `since`. Limits: 4 MiB/frame; a longer line is discarded to its newline and answered `BAD_REQUEST`. Redaction per §9.3. Node has no peer-credential API on unix sockets; endpoint ACL + mutual signatures (+ the PID check on Windows) are the boundary.

**Loopback WebSocket transport (`#web-endpoint`, §11.2).** The same frames ride RFC 6455 text frames (one JSON-RPC message per frame) on `ws://127.0.0.1:<port>/rpc`; `hello` is unchanged; `auth` accepts a third form — `{launchToken}` on first use, answered `{guiToken, principal, connId}`, or `{guiToken}` on reconnect within the grace — and the connection then acts as the launching device's human principal with `client:'gui'` stamped on every event it causes. The browser does not verify `serverSig`; its anchor is that the port and the token were delivered by the kernel over the already-authenticated socket. Every other rule of this section (nonce, code map, subscription, backpressure, limits, redaction) applies unchanged to the WebSocket transport.

### 4.10 Voice events (`voice:v1`, D30/V, S22-M1/M2)

```
voice.session.start { voiceSessionId, hsid, mode: ptt|conversation, engines:{vad, stt, tts, diarization}, device:{mic, aec:bool}, audioRetention: none|ttl:<s> }
voice.turn.user     { turnId, speakerId: "spk:<ns>/<name>"|"spk:unknown-2", speakerEnrolled: bool, forwarded: bool, t0, t1, text, asrModel, confidence, audioRef? }
voice.turn.agent    { turnId, hsid, textPlanned, textSpoken, interruptedAtMs|null, ttsVoice, source: local-ack|claude|local }
voice.bargein       { turnId, atMs, heardText }
voice.session.end   { voiceSessionId, turns, compactedTo: "l:L-…" }
voice.share         { loreId, audience: team, redactions:[…], consent:[speakerId…] }
voice.enrol         { speakerId, consent, printRef }        — root-signed row (CLI `gnomon voice enrol`)
voice.forget        { speakerId }                           — root-signed row (CLI `gnomon voice forget`)
```
`textSpoken` is the truth after a barge-in; `textPlanned` is what the model intended (20). Every `turn.sent` that originated from speech carries `source: voice`. The namespace `voice.*` is a **userland grant** to `p:<ns>/voice` (A23-2); the kernel validates shape only (speakerId known or `unknown-N`, turn ids monotone, text ≤ 16 KiB).

---

## 5. Kernel ABI — twelve verbs (law 3)

`status` is the man page (F4, TD-2026-07-21-766): principal, legal next verbs, verb→tool map, `abiId` (hashed as `descriptors.ts:383-393`), `modAbiId` and `clientApiId` (§12.8), the web endpoint (`listening`, `port`, `guiSessions{n}`), connected clients with their conformance badge, linked and dev mods, backends and their health, subscription window, billing mode, sandbox fidelity per profile, inbox by kind, unknown Claude processes. The MCP proxy registers ≤ 12 tools (`descriptors.ts:269-271` naming law). Everything else is CLI-only (§3.1 I3) or a mod command (§12).

| # | Verb | Params | Result | Refusals | Human | Agent (roster) | Session | Mod (`p:<ns>/mod-*`) | Voice (`p:<ns>/voice`) | Read token |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `status` | `{}` | self-description | AUTH | ✓ | ✓ | ✓ | ✓ (own view) | ✓ | ✓ |
| 2 | `session.open` | `{backend?: claude-code\|local, model: local\|claude\|any, cwd, mode?, as?, goal?, contract?, alias?, derived?, permitId?, systemPrompt?, attended}` | `{hsid, principalId, backend, state}` | PERMIT_REQUIRED, BUDGET_DENIED, BILLING_REFUSED, MODEL_UNAVAILABLE, UNSUPPORTED, FORBIDDEN | ✓ | ✓ permit | ✓ permit | ✗ | ✗ | ✗ |
| 3 | `session.send` (incl. `steer`, `source: voice`) | `{hsid, content[], permitId, steer?: bool, source?: voice}` | `{turn}` | PERMIT_REQUIRED, BUDGET_DENIED, NOT_FOUND, BAD_REQUEST | ✓ | own subtree | own subtree | via `kernel.call` with caller hsid, same scope | ✓ attached session, `source: voice` forced | ✗ |
| 4 | `session.stop` | `{hsid, interrupt?}` | `{signals[], exited}` | NOT_FOUND, FORBIDDEN | ✓ | own subtree | own subtree | ✗ | interrupt only | ✗ |
| 5 | `log.append` | `{kind, payload?, ref?, causes?, scope?, idem?, audience?, sensitivity?}` | `{id, seq, hash}` | FORBIDDEN (kernel-owned or ungranted kind), BAD_REQUEST | granted kinds | granted kinds | **none** | `modns.<name>.*` only | `voice.*` only | ✗ |
| 6 | `log.read` | `{since?, kinds?, scope?, follow?}` | backlog + stream | AUTH, BAD_REQUEST | full | redacted | own scope | granted kinds, own `modns` | own session + `voice.*` | redacted |
| 7 | `permit.reserve` / `release` | `{kind, scope, backend?, model?, limits?, tool?, input?}` / `{op:'release', permitId}` | `permit:v1` | BUDGET_DENIED, BILLING_REFUSED, FORBIDDEN | ✓ | ✓ | ✓ own scope | ✗ (spend comes from the caller's permit) | ✗ | ✗ |
| 8 | `approve` | `{cardId, decision, note?, decisionSig}` | `card:v1` | FORBIDDEN, NOT_FOUND, AUTH | ✓ (presence per class; root key for `use-api-token`, `install`) | ✗ | ✗ | ✗ | **✗** | ✗ |
| 9 | `contract.register` | `{contract}` | `{contractId, nodes}` | BAD_REQUEST, FORBIDDEN | ✓ | ✓ | ✗ (A17-5) | ✗ | ✗ | ✗ |
| 10 | `contract.claim` (`claim\|built\|release`, `ttl`) | `{contractId, nodeId, op: claim\|built\|release, ttl?, expect?:{status, seq}}` | `{nodeId, status, by, seq, expiresAt?}` | CAS_LOST, NOT_FOUND | ✓ | ✓ | ✓ | ✗ | ✗ | ✗ |
| 11 | `oracle.run` | `{contractId, nodeId, oracle}` | `oracle:v1 {pass, evidence, ranBy:'p:<ns>/kernel', reviewer?}` | PERMIT_REQUIRED, UNSUPPORTED, ENGINE | ✓ | ✓ requests | ✓ requests | ✗ | ✗ | ✗ |
| 12 | `ref.resolve` | `{ref}` | `{target, hash?}` | BAD_REQUEST, UNSUPPORTED, NOT_FOUND | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |

**Client relays.** `mod.view` and `mod.command` (§12.3) ride the same socket but are served by the mod host (§3.8) under the caller's principal and counted in `modAbiId`; they are not among the twelve, and `status` lists them separately.

**Namespace ownership (A17-3, A23-1).** Default: **every kind not listed below is kernel-owned** and appendable by no principal through `log.append`. Userland namespaces, appendable only by a principal bound to a manifest grant listing the kind (`grant.bind`): `paradigm.* inject.* credit.* broke.* detector.* loop.row loop.open loop.closed tend.* decay.* calibration.* flow.* neurons.* voice.* modns.<name>.*`. Explicitly kernel-owned (named because reviewers asked): `verdict.* gate-class.* blob.pruned digest.consumed loop.paused contract.* billing.* mod.* approval.* permit.* budget.* session.* turn.* key.* config.* manifest.* oracle.* warpline.* merge.* liveness.*` — `mod.*` (kernel: `installed | rolled-back | health | effect.refused | view.rendered | stopped | sandbox | linked | paused | repinned | unlinked`) and `modns.*` (mods) cannot collide.

**Matrix invariants (`G-ABI-02`).** `approve` is the only HUMAN_ONLY verb; `decisionSig` by the approvals key (hardware, presence class per §3.4) over `(cardId, decision, contentHash, approverPrincipalId)`; `use-api-token` and `install` decisions additionally require the root key (presence). Read tokens: `status`, `log.read`, `ref.resolve` only (`protocol.ts:138-144`, `server.ts:206-212` pattern). `G-ABI-02` enumerates every principal class above (human, agent, session, mod, voice, read token) against every verb. `status` < 50 ms (`G-ABI-03`). Next-legal-verbs table hashed into `abiId` (`descriptors.ts:304-347` pattern): `{budgetPaused} → [status, log.read]` · `{cardsPendingForYou>0, human} → [approve]` · `{noSession} → [session.open]` · `{noPermit} → [permit.reserve]` · `{hasContract, unclaimed>0} → [contract.claim]` · `{claimed, built:false} → [contract.claim op:built]` · `{built} → [oracle.run]` · `{} → [status]`.

---

## 6. Spawn (`$spawn`)

### 6.1 Generic path

1. `permit.reserve{kind:'session.spawn', backend, model}` — refused ⇒ nothing else happens (law 1); interactive `derived:true` registrations skip this.
2. Route by `model` (§13.3): `local` ⇒ `#local-runner` or a `fallback` card; `claude` ⇒ `#claude-adapter` under law 7; `any` ⇒ local if a capable local model is up, else Claude. Routing never considers Claude Code against a local endpoint (D37).
3. `#identity` mints `p:<ns>/s-<hsid-short>` with an ephemeral key; Warpline mode binds `as`.
4. `session.open`; hsid issued.
5. Preflight (§3.3) incl. law-7 scan and `layersHash`/`gitHash`; a gate-class difference ⇒ card before spawn.
6. `#manifest-loader` writes `policy.json` (permissions, hooks → `gnomon hook …`, denies on `~/.gnomon/keys/**`, `~/.gnomon/warpline/**`, `.warpline/keys/**`, `.warpline/daemon-tokens.jsonl`, `.warpline/daemon/mcp-tokens.json`, `.warpline/daemon/mcp.token`, and writes to every Claude settings layer — on EVERY mode, S16-1/S22-H2) and `mcp.json` (including the per-session `gnomon-mods` server when mod tools are granted, §12.3).
7. `session.inject` for every added byte (`origin: kernel | client`).
8. Spawn the driver child (`claude -p` or `gnomon-local --mode rpc`) inside the **`session` sandbox profile** (§15.5) — the profile denies reads of `~/.gnomon/keys`, the Warpline token store and the OS keystore items, writes under `~/.gnomon/**` and to every settings layer, and launcher escapes; it does not confine the worktree, tools or network (sessions need them).
9. Turns with `turn` permits; `turn.usage`/`turn.result` → `budget.usage`; `ask.user`/`plan.exit` → cards.
10. Stop/exit; worktree left in place.

### 6.2 Warpline-native path (base revision declares `mode: warpline`)

Preconditions: `.gnomon/project.yaml` at the base revision says `mode: warpline` (§15.7); the roster principal named by `as` has a Warpline key file and an agent-class daemon token minted by the human (`warpline key mint`, `warpline daemon token mint … --kind agent`); `warplined` is reachable or activatable for the root (`lifecycle.ts:44-50`). The kernel is a **re-derived `warplined:v1` NDJSON client** (`protocol.ts:31,60-110`; the engine is never imported), may start `warplined` for a root (`warpline daemon start`), never mints. Four kernel duties (05; TD-950 §3; D14/A17-a): (1) **select** the roster credential (`WARPLINE_AGENT_ID=<as>`, `WARPLINE_MCP_TOKEN` from the keyed store, `tokens.ts:205-232,295-320`; refuse `UNSUPPORTED` if absent, never a kernel mint); (2) **env** as §3.3; (3) **deny** Warpline human-class verbs and override flags on every skin — `resolve`, `stake`, `stake.recover`, `backup` (`protocol.ts:115-120`), `--accept-breach/--accept-risk` (`:148-151`), `branch --protect/--unprotect` (`:161-164`), `merge --confirm` (`:175-177`) — plus the key/token paths (TD-2026-08-23-136 M3-Q5; S-H5); these denies are **advisory string matches** (bypassable by `python -c`, scripts on disk, `env -u WARPLINE_AGENT_ID`); the enforced boundary is `warplined`'s verb × principal matrix for keyed callers (`server.ts:215-233`) and, once P8-D16 ships, `resolve` served only to keyed principals; (4) **attach** worktree + `fork` the scratch ref through the daemon (`forkNative`, `native.ts:260`) + per-session line `refs/heads/gnomon/<hsid-short>`; selvage read-only to agents; the kernel watches `.warpline/refs/heads/selvage` with `fs.watch` (no polling) and appends `warpline.selvage.moved{ref}` so sibling sessions re-predict, until Warpline's `refs.watch` replaces the fs watch (P8-D16). **The one kernel pointer line** (F4): `--append-system-prompt "Warpline project. Run \`warpline status\` (or the warpline_status tool) before your first write."` — exactly one kernel-added line, logged as `session.inject{origin:'kernel', kind:'warpline.pointer'}`; the skill is installed and discoverable, never pushed into turn one (10 §5.2); teaching is carried by Warpline's `status` result and `refusal:v1.next[]` (`descriptors.ts:383-393`). `G-SPN-05` asserts kernel-origin injected bytes equal that line byte-for-byte; client-origin bytes are logged separately and uncapped. **Sealing and KNOTs.** `PostToolUse` does not seal on every edit (41 s absorb, `hook.ts:30-34`); the session calls `propose` when it claims a node built; admission runs as the **shadow** oracle (§7.3), presented by the kernel with its own human-minted agent-class token `gnomon-kernel` from `~/.gnomon/warpline/<repoId>.token` (A17-a, A23-7); a shadow KNOT ⇒ `warpline.knot{payloadId}` + `knot` card → human `approve{resolve}` (fresh presence) → human runs `warpline resolve` on the CLI (HUMAN_ONLY, FG-1) — the kernel never calls `resolve`. `G-SPN-06` (restated, S-H5): an agent-class `resolve` through the daemon or MCP skin is `FORBIDDEN` and logged as a W3 attempt; unmarked CLI shells are outside this measurement and said so in the result (`skinScoped:true`). Revisit trigger for the per-user-kernel/per-repo-warplined split: > 3 concurrently active Warpline repos or daemon RSS over budget (A-warplined).

### 6.3 Git-mode path

`git worktree add .gnomon/worktrees/<hsid-short> -b gnomon/<hsid-short> <base>` with the hardening env + flags and inside the `git` sandbox class (§3.3); landing = `merge-ci` oracle; conflicts ⇒ `merge-conflict` card without semantic judgment; clean ⇒ fast-forward onto `gnomon/integration` after the base revision's `ci` command is green inside the sandbox; `main` never written by the kernel. On Windows worktrees live under the same path (long-path aware, `core.longpaths=true` in the hardening set).

---

## 7. Spec-as-contract (P8-R2)

### 7.1 The compiler (`#contracts-compiler`, userland, deterministic)

Lives in `packages/paradigm/src/core/contracts/` as the `plan` stage of `paradigm pipeline` (`pipeline/index.ts:131-162`; `STAGE_ORDER` at `core/pipeline-types.ts:67`, imported `pipeline/index.ts:16`); the `paradigm_pipeline` MCP family runs the compiler locally and calls `contract.register` (A17-5). Rules:
1. Sections open at NUMBERED ATX headings (`## 3.`, `### 3.2`, `## A.`, `### A.1`); unnumbered headings do not change the section; text before the first numbered heading is `preamble`. Fenced code blocks are never scanned. A heading of ANY kind ending `(compile: skip)` skips everything until the next heading of equal or higher level (A17-2).
2. A **node candidate** is a whole inline code span matching `^[#$^!~][a-z][a-z0-9-]*$` in headings, prose or table cells.
3. Node identity = `sym:` + span; kind from prefix; `section` = first appearance; one node per ref.
4. A **test id** matches `\bG-[A-Z]{2,4}-\d{2}[a-z]?\b`; a range is written `<prefix>-NN<sfx>..MM<sfx>` where `<sfx>` is an optional single lowercase letter that must be identical on both ends, and it expands with its suffix (a range written with the suffix `w` on both ends expands to the ordinals `04w 05w 06w`; a mismatched suffix is a compile refusal, A23-7). An id in a table row binds to the nodes mentioned in that row plus the section heading's nodes; a table row that mentions no node under a heading that mentions none skips its own section and takes the ancestor path below. An id outside a table binds to every node mentioned in the section; otherwise to the nearest ancestor section's nodes; otherwise to the `doc` node declared by the single `Deliverable: <kebab>` line (`orphanTests`).
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
| `reviewer` | one `claude -p` turn on the **subscription** (D15, law 7) under an `oracle.reviewer` permit, as roster principal `p:<ns>/reviewer` ≠ claimant and ancestors, **no tools**, ≤ 1 turn, diff enveloped untrusted, spec section from the base revision, strict `{pass, reasons[], riskyUnits[]}` schema, inside profile `gnomon-reviewer` (S16-4: Keychain/Credential Manager item for Claude's OAuth reachable, `~/.gnomon`/`~/.ssh` denied; weaker than `gnomon-oracle`, stated) whose egress is a **kernel-run loopback proxy** carrying the Anthropic-hosts allowlist (P8-D17) — the profile allows network only to that loopback port, since hostnames are not expressible in `sandbox-exec` (S22-M4) | no |

**Certification** (`^certified`): `exists ∧ test ∧ (admission | merge-ci) ∧ reviewer`, each `oracle.result` kernel-signed (an agent claims, only the kernel certifies, 10 §4). The gate's own tests are `G-CTR-04`, `G-CTR-05`, `G-CTR-06`, `G-CTR-08`, `G-CTR-09` (§19.2). Disagreement ⇒ `contract.knot` + `knot` card (Warpline KNOT payload `knot-payload.ts:56` attached when the shadow admission knotted); resolution human with fresh presence, logged `verdict.founder`. Reviewer calibration is mandatory (§8.6).

### 7.4 CAS claims and the node lifecycle (A17-1, A23-1)

`contract.claim{op:'claim', ttl?, expect:{status:'open', seq}}` ⇒ `contract.claimed{expiresAt}` or `CAS_LOST`, where `expiresAt = now + ttl` (default 2 h) and a kernel timer (§3.5) releases the claim at expiry with `contract.released{reason:'expired'}` unless `built` arrived; `{op:'built'}` by the claimant ⇒ `contract.built` (the oracle trigger); `{op:'release'}` ⇒ `contract.released`. All `contract.*` kinds are kernel-owned and written by the verb handlers.

### 7.5 Progress = exists ∧ passes

`contract.progress` projection `{exists, passes:{oracle}, certified, claimedBy}`; aggregate `{certified, total}`; rendered as the `contract.progress` block in the GUI; moves only on events.

### 7.6 Git-mode variant and KNOT routing

Identical compile; `certification.required` swaps `admission` for `merge-ci`. Merge conflicts → `merge-conflict` card, no KNOT. Oracle disagreement → `knot` card in both modes (KNOT = "oracles disagree"; a Warpline KNOT is the meaning-level special case). Calibration keyed `(repo, mode)` keeps them apart (§8.6).

---

## 8. Learning loop (TD-950 §8; `#learning-loop`, userland)

The loop reads only the kernel log — never the Shuttle view, never notebook YAML counters (12 §1). `#learning-loop` is userland, bound to the `paradigm` manifest's grants for `inject.* credit.* broke.* detector.* loop.row|open|closed tend.* decay.* calibration.*` (`loop.paused` is kernel-written, A17-3).

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

### 8.4 Detectors and the teacher→skill flywheel (D23)

Detector classes (deterministic): `tests-fail-after-edit`, `tsc-fail-after-edit`, `warpline-knot`, `warpline-refusal`, `reviewer-dismissed`, `loop-thrash` (same files/symbols rewritten k=3 rounds with flat score, or a hunk reverted and re-applied — 06 §4), `repeat-symbol-failure`, and `local-model-failed` (a `model: local` session hit tool-call parse failure after repair, exceeded the compute permit, produced a non-passing oracle, or triggered `fallback`). The LLM contradiction judge and teacher drafting take `tend.llm`/`teacher.draft` permits; denials are learning signal. **Flywheel**: `detector.event{class:'local-model-failed'}` ⇒ a `teacher.draft` permit (Claude on the subscription, law 7, under the fuse) ⇒ the teacher writes the fix AND a candidate `SKILL.md` scoped to symbol/ecosystem (01 "Steal 1"; 06 §3) ⇒ staged at T3 ⇒ Classroom certifies (replay the saved `.scenario`, nearest-scenario regression, peer refutation, founder sign-off; first field break auto-overturns) ⇒ lands as notebook knowledge or `.claude/skills/<name>` through an `install` card (S-M6). Counts: `{drafted, certified, broke}` per class, with denominators. Failure to certify is itself logged (`tend.proposal.fate{dropped}`), so "5/5 survived" cannot hide (06 §3).

### 8.5 Loops and the loop ledger

Per round `loop.row{loopId, repo, iter, goal_ref, tests_passing, tsc_errors, diff_lines, files_touched, symbols_touched, tokens, verdict}` (06 §4). Progress = monotone improvement on something that cannot lie; past the thrash threshold the kernel pauses (`loop.paused`) and emits a detector event. Ship k=3 + budget cap.

### 8.6 Reviewer calibration, keyed by (repo, mode) — never pooled

For each `oracle.result{oracle:'reviewer', pass:true}` the loop checks survival (overturned PICK, detector on its symbols, founder reversal) and appends `calibration.reviewer{repo, mode, passes, laterBroke, window}` weekly; passes are weighted `1 − laterBroke/passes` when ranking contested nodes. ≥ 20 passes with 0 later-broke alongside a known field break ⇒ `uncalibrated` flag in the Shuttle view (12 §3). Git-mode and Warpline-mode rows are never pooled (12 §6).

### 8.7 `tend` passes (law 5)

Trigger: ≥ 5 new learning events AND ≥ 10 min quiet, cancelled if the founder is active, ≤ once per hour (06 §2). Deterministic passes need no permit: dedupe (≥ 0.9 → propose merge), source-hash validation (drift ⇒ `stale` + ripple re-check), decay, calibration aggregate, nomination surfacing. LLM passes (contradiction judge, pairs sharing a symbol at ≥ 0.75) only under `tend.llm`. Output: `tend.digest{proposals}` + one `tend` card per proposal needing a human; T0/T1 never mutated without a card.

### 8.8 Liveness gates and the reader

`≥ 1 verdict.founder per working day`, `≥ 1 tend.digest per week`; violations append `liveness.violation` and light the Shuttle view, never block. **The reader** (`gnomon learn read`, scheduler-triggered) auto-applies deterministic proposals, turns the rest into cards, and logs `digest.consumed{digestId, applied, carded, dropped}`; a digest unconsumed for 7 days is a liveness violation — "nobody consumes the outputs" (12 §7) becomes measurable.

### 8.9 Week-4 falsifiers

Credited reuse of loop-born entries ≥ 25 % of credited injections by week 4 and rising; repeat-failure rate per (symbol, class) halves after certification; certifications stop surviving at 100 % (06 §6; §20).

### 8.10 Shared knowledge search (`#knowledge-query`, userland; Loid 06 §2, 12)

One **userland** read verb — never a kernel verb (law 3) — `knowledge.query({q, scope?: {repo, hsid, since}, minTier?, k?, providers?, requester})` federates **providers** that manifests register (`provides.knowledge: [{name, scheme, query: <command id>}]`, §4.3; capability `knowledge:provide`, §15.4): notebooks, neurons (`n:`), lore (`l:`), decisions (`td:`), Steward memory, doodles (`doodle:`, §12.7). Each provider answers with hits in one envelope: `{ref, owner, provenance: {source: authored | certified | observed | external, by}, trust: T0 | T1 | T2 | T3, confidence_live, last_validated, applied, broke, source_hash, why (the matched text, quoted), snapshot?, replay?, links[]}`. Trust tiers: T0 founder-confirmed or gate-certified; T1 peer-certified; T2 pipeline auto-promote; T3 external, forage or observed — always injected as untrusted; a doodle fact is `observed`/T3 evidence until a class promotes it; Steward memory enters at T2 at most. A hit missing provenance, tier or `source_hash` is dropped and counted `{dropped, of}` (`G-KNW-01`). Cross-agent reads log `inject.receipt{requester, owner, refs[]}` so a later failure attributes across agents (`G-KNW-02`); subagents get a frozen slice at spawn; model-visible ⟺ logged (§3.2 L2). The scoped phrasing **"check the doodles for X"** is `providers: ['doodle']`, and the answer is moments — `doodle:` refs whose `ref.resolve` hash matches the fold, with the mark's author named (`G-KNW-03`). Surfaces: the per-session `gnomon-mods` MCP server exposes `knowledge.query` as a tool (so the kernel's ≤ 12 proxy tools are untouched), `paradigm_retrieve` is extended with the provider registry (its final home is OPEN 13), the GUI palette has `/knowledge <q>` and `/doodles <q>`, the CLI has `gnomon knowledge <q>`. The query never writes to any store; ranking inside the learning loop stays `credited − broke` (§8.2); `tend` (§8.7) runs its deterministic passes over every provider; the `tend` digest names the provider of every proposal.

---

## 9. Observability (`~ample-internal-logs`)

### 9.1 Event taxonomy (closed per namespace; new kinds additive; default owner = kernel)

| Namespace | Kinds | Join keys | Owner | Sensitive |
|---|---|---|---|---|
| `daemon` | start, exit{reason}, lock.refused, segment, reexec | — | kernel | no |
| `socket` | connect, auth.ok, auth.fail{reason: key\|token\|origin\|host\|deadline}, web.listen{port}, web.stop, gui.token.issued{connId}, gui.session.ended{reason}, subscription.dropped{lag}, frame.dropped | connId | kernel | no |
| `key` | mint, rotate, registry.malformed{line}, registry.unsigned{line}, device.added, device.revoked, keystore.unavailable | keyId | kernel (CLI) | no |
| `config` | loaded{hash,signed}, unsigned, prefs{device, theme, layout} | — | kernel | no |
| `session` | open, alias, alias.rejected, refused{code}, spawned{…}, inject{origin,hash,bytes}, idle, respawn, exited, orphaned, routed{declared, chosen, reason}, sandbox{full\|partial}, layers.changed{which} | hsid, cc alias | supervisor | inject bytes yes |
| `turn` | sent{permitId,contentHash,source?}, event{type,seq}, usage{tokens}, result{usage,cost,permission_denials}, partial{bytes}, steer, ask-user, plan | hsid, turn | supervisor | event bodies yes |
| `permit`/`budget` | reserve, grant, deny, release, usage, ladder, pause, resume{by}, breaker.open/close, compute{machine, seconds}, window{used, of, reservedForHuman} | permitId, hsid | broker (signed) | no |
| `billing` | api.card.requested, api.active{hsid, until}, api.ended, api.refused{where} | cardId, hsid | broker (signed) | no |
| `approval` | request{card}, decide{decision,by,decisionSig,presence:fresh\|cached\|cli,cli{pid,ppid,pgid,tty}}, presence.denied, expire, rule.learned{tool,matchExact}, suspect{reason} | cardId, hsid | broker (signed) | tool_input yes |
| `manifest` | load{hash,packageHash}, refuse{code}, generate{files[]}, staged{hash}, installed{hash,cardId}, uninstall{diff} | manifestHash | loader | no |
| `schedule` | due{key}, dropped, tend.start/end, automation.due | key | scheduler | no |
| `model` | capabilities{backend, model, tools, ctx}, probe{endpoint, ok}, repair{argument}, fallback.requested, fallback.decided | hsid | runner | no |
| `mod` | installed{hash,cardId}, rolled-back, health{name, ok}, effect.refused{name, effect}, view.rendered{name, slot, ms}, stopped{reason}, sandbox{profile, full\|partial}, linked{name,path,packageHash}, paused{name,reason,files[]}, repinned{name,packageHash,dev}, unlinked{name} | manifestHash, packageHash | mod-host | no |
| `modns.<name>` | the kinds a mod declares in its manifest (first-party: `modns.workshop.*`, `modns.gnome.*`, `modns.doodle.*`) | per mod | that mod's grant | no |
| `voice` | §4.10 (incl. enrol, forget as root-signed rows) | voiceSessionId, hsid, turnId | `p:<ns>/voice` grant (kernel validates shape only) | text no; audioRef yes |
| `contract` | registered{contractId}, claim, claimed{expiresAt}, released{reason?}, built, knot{nodeId,oracles}, progress | contractId, nodeId, hsid | kernel | no |
| `oracle` | run{oracle}, result{pass,evidence,ranBy,reviewer?} (signed) | nodeId, hsid | kernel | evidence yes |
| `warpline` | pick, admit{status,shadow}, knot{payloadId}, resolve, selvage.moved — `ref:` wl | pickId, hsid, turn, nodeId | kernel | no |
| `merge` | tree{clean}, conflict{paths}, ci{exit}, landed | hsid, nodeId | kernel | no |
| `gate-class` | detected{paths}, decided | hsid, cardId | kernel | no |
| `inject`/`credit`/`broke` | receipt{entries,tier,source_hash,frozenSliceHash}, credit{outcome}, broke{class} | hsid, turn, contractId, entry ref | paradigm grant | no |
| `detector` | event{class,evidence} incl. class `local-model-failed` | hsid, turn, symbols | paradigm grant | no |
| `loop` | open, row{…}, closed (grant); paused{reason} (kernel) | loopId, hsid | paradigm grant (except `loop.paused`: kernel) | no |
| `tend`/`decay`/`calibration` | digest, proposal.fate, teacher.drafted, writeback, contested, reviewer{repo,mode,passes,laterBroke} | digestId, entry ref, repo+mode | paradigm grant | no |
| `verdict` | founder{cardId,accepted,note?} | cardId, nodeId, turn | broker (signed) | no |
| `liveness` | violation{gate,lastSeenAt}, digest.consumed | digestId | scheduler | no |
| `paradigm`/`flow`/`neurons` | event (bridged, `ref:`) | nativeId | their grants | no |

Every number ships as `{n, of}`; a bare count in a result or block fails CI (`G-HON-03`).

### 9.2 Join keys

`hsid · turn (turn:<hsid>/<n>) · contractId · nodeId · permitId · cardId · keyId · deviceId · connId · entry ref · pickId · digestId · loopId · voiceSessionId · turnId · manifestHash · packageHash · ds (doodle session)`. Day-one learning rows are joinable on `hsid + turn + contractId + entry ref` (session.yaml rule 2).

### 9.3 Redaction matrix (one, total, tested — `G-ABI-05`)

| Principal class | `session.inject.bytes` | `turn.event` bodies | `approval.request.tool_input` | `oracle.result.evidence` | `voice.turn.*.audioRef` | everything else |
|---|---|---|---|---|---|---|
| human (full) | full | full | full | full | full | full |
| agent (roster) | own subtree | own subtree | own subtree | own nodes | never | full |
| session | own hsid | own hsid | own hsid | own nodes | never | own scope |
| mod (`p:<ns>/mod-*`) | never | never | never | never | never | own `modns.<name>.*` + the kinds its grant lists |
| voice (`p:<ns>/voice`) | never | attached session only | never | never | own | attached session's events + `voice.*` |
| read token | `{kind, hsid, at, hash}` | same | same | same | never | full minus `secret` |

`audience`/`sensitivity` restrict reads further (a `secret` event is never streamed to a read token; `team`/`org` audiences are 8.1 projections). `G-ABI-05` enumerates every (class, kind) pair.

### 9.4 Retention

Chain forever, segmented at 10⁶ rows; `session.inject` bytes forever; `voice.turn.*` text as blobs until the session's lore compaction exists + 90 days unless pinned by the human (S22-M2); `turn.event` bodies and oracle evidence 90 days, pruned with `blob.pruned{sha}` (A-OPEN-6); opt-in audio at its TTL only. Transcripts stay in `~/.claude/projects/<cwd>/<uuid>.jsonl`, referenced by `cc:`.

### 9.5 Library logging

Paradigm logger everywhere (`packages/paradigm-mcp/src/utils/mcp-logger.ts:3` `export const log = new ParadigmLogger(...)`; flow's Python port `headless.py:84`), never `console.log`. Operational logs (`~/.gnomon/logs/`) are diagnostic, not the kernel log; GUI diagnostics reach `~/.gnomon/logs/gui.log` through the web endpoint's size-capped `/diag` route and are never left to the browser console alone; CLI output is plain text through the `cli-output` helpers.

### 9.6 Metrics in `status`

`appendP99Ms`, `rssBytes`, `openSockets`, `liveSessions`, `unknownClaudeProcesses`, `permitsOpen`, `cardsPending`, `chainSeq`, `headAnchorOk`, `lastSegmentAt`, `subscriptionDrops{n, of}`, `renderP99Ms` (GUI keystroke-to-paint, reported by the client), `guiSessions{n}`, `linkedMods{n, dev}`, `webEndpoint{listening, port}`, `clients{n, conformant}`, `localTtftMs`, `voiceToVoiceMs{p50, p95}`, `subscriptionWindow{used, of}`, `apiCreditsActive`, `modChildren{n}`, `sandbox{profile: full|partial}`.

### 9.7 Honesty CI (law 2)

`G-HON-01` compiler reproduces Appendix A · `G-HON-02` no fabricated mechanisms (grep for `Math.random` outside ids/tests, `simulated`, fake `sleep(`, hardcoded gains, forbidden vocabulary) · `G-HON-03` denominators · `G-HON-04` manifest fixed point + reversible install · `G-HON-05` no Task-steering descriptions · `G-HON-06` guard names state scope · `G-HON-07` every latency number in docs or `status` names its measurement method and machine.

---

## 10. The seven laws as testable invariants

| # | Law | Invariant | Falsifier test (scope stated) |
|---|---|---|---|
| 1 | No spawn without a permit | every `session.spawned`/`respawn`/`turn.sent` has an earlier unconsumed `permit.grant`; spawn takes `permit:v1` as a required argument; local sessions consume compute permits | `G-LAW-01` (5-session fan-out, limit 3 ⇒ 2 denies), `G-LAW-01b` (no env/config/project/CLI bypass for kernel-spawned sessions), `G-LAW-01c` (6 local sessions, machine concurrency 2 ⇒ 4 wait) |
| 2 | Honesty is CI | §9.7 in `npm test` and the release gate | `G-HON-01..07` |
| 3 | Tiny ABI | ≤ 12 kernel verbs; ≤ 12 proxy tools; mod ABI ≤ 8 RPCs + lifecycle + 2 client relays; `abiId`, `modAbiId` and `clientApiId` frozen per release and published | `G-ABI-01`, `G-ABI-04`, `G-MOD-01`, `G-CLI-02` |
| 4 | Reversible by construction | one repo dir (`.gnomon/`, `project.yaml` committed, `worktrees/` + `sessions/` ignored) + one home dir; markers; uninstall exact; learned state exported or intact | `G-LAW-04` on macOS and Windows |
| 5 | Nothing spends by default | fresh install, 24 h, zero `permit.grant`; spending scheduler jobs are manifest `opt-in`; local automations spend compute only after a human marks them `attended:false` + `model` | `G-LAW-05`, `G-LAW-05b` |
| 6 | Trust posture | no install scripts in `@a-company/gnomon*`; exact pins; `npm pack` lists only `dist`; signatures verified (helpers by checksum + code signature); `alpha` never `latest`; mods never load without a grant row; the GUI bundle fetches nothing at runtime | `G-LAW-06` |
| 7 | **Subscription only** (`^subscription-only`, D35) | no Claude process starts if any env/settings layer would bill API credits; the only API path is a per-use root-signed `api-token` card with a persistent indicator and `billing.api.active` events; the fuse reserves a human share of the subscription window; settings layers are watched mid-session; `gnomon-local` endpoints are loopback/LAN only | `G-SUB-01` (each of `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, `apiKeyHelper`, `ANTHROPIC_BASE_URL`, any `*_BASE_URL`, `CLAUDE_CODE_USE_BEDROCK\|VERTEX\|FOUNDRY`, an `mcp.json` env block, a managed-policy source, AND a loopback base-URL override — the former local-endpoint probe case (D37) — in each layer ⇒ `api_billing_refused`), `G-SUB-02` (agent/mod/voice cannot request an `api-token` card), `G-SUB-03` (indicator + events present for the card's whole validity), `G-SUB-04` (armada paused at the window threshold while an interactive session still gets a permit), `G-SUB-05` (a settings layer written mid-session ⇒ the session is stopped within 2 s and `billing.api.refused` logged), `G-SUB-06` (`gnomon-local` configured with a non-loopback/LAN endpoint ⇒ `BILLING_REFUSED`) |

---

## 11. The GUI (`#gui`) — Gnomon's shell on localhost (P8-D50, D40–D44, D51)

### 11.1 Role and topology

**Role.** The primary shell for local and Claude sessions: a terminal-like web page — keyboard-first, prompt-centred, a command palette that reaches everything — served by the kernel's web endpoint (§11.2) on `127.0.0.1` and opened in the user's default browser by `gnomon open`. It is a pure client of `gnomon-rpc:v1` over a loopback WebSocket: the kernel owns sessions; the GUI renders, composes, decides (through the broker, §3.4) and never spawns a process itself. Several GUI tabs (or a tab and constellation) attach to the same session concurrently; `turn.partial` streams to all; closing the tab leaves every session running and re-attachable (`G-GUI-05`). The terminal keeps the CLI only (`gnomon spawn | status | approve | replay | open | mod | knowledge | doodle …`, P8-D51): there is no in-terminal UI, and CLI output is plain text projected from the same blocks (`kit.Image` prints its `alt`, `kit.Canvas` prints the mark list).

**Desktop wrapper (optional, after the Move 1 pass).** A thin native wrapper — Tauri recommended (Rust shell over the system WebView, macOS + Windows, small footprint) — loads the same page from the same endpoint with the same launch token; it adds a dock/taskbar presence and native notifications and nothing else; the page never knows which host it runs in; the wrapper's WebView origin is allowlisted only while the wrapper is the launcher (§11.2 rule 10). Electron is not used (law 6 footprint; the browser already gives the DOM the shell wants). Signing reuses OPEN 1's identity; timing is OPEN 10.

**Renderer.** A single-page app in `packages/gnomon-gui` (`@a-company/gnomon-gui`; React, because the Doodle canvas engine requires it, §12.7; every dependency pinned exact, law 6; nothing fetched from any CDN at runtime — fonts, icons and the canvas engine are bundled), with: a **virtualized transcript** (only visible rows mount; row heights cached per width — deepseek-harness's long-session lesson, commit `10bb9cbf4a`, 21, carried into the DOM), streaming Markdown through a sanitizing renderer with raw HTML disabled, per-hunk diffs (`kit.Diff`), the composer with history, kill ring, undo and paste collapse. Every string reaches the DOM as a text node, never as markup (`G-GUI-07`). Browser matrix: Safari, Chrome and Firefox on macOS; Edge, Chrome and Firefox on Windows — no feature requires a particular browser (`G-GUI-03`). Diagnostics are posted to the endpoint's size-capped `/diag` route and land in `~/.gnomon/logs/gui.log`; the browser console is never the only record.

### 11.2 Localhost web security model (`#web-endpoint`)

Threat: a page in another tab of the same browser, or a same-user process using the browser, tries to reach the kernel through the GUI's endpoint. Every rule below is a kernel rule enforced in `#web-endpoint`; every one has a test that runs on both OS.

1. **Bind.** `127.0.0.1` only, IPv4 literal, ephemeral port chosen by the OS at listen time; the root-signed config has no field for an address or interface, so no setting, env var or flag can widen it; IPv6 loopback is not bound and the page is always opened by IP literal, never by the name `localhost` (`G-WEB-01`).
2. **Launch token.** `gnomon open` (device-key-authenticated on the unix socket / named pipe) asks the kernel for `{port, launchToken}`; the kernel starts the endpoint if it is not listening, mints a 32-byte random **single-use** token with a 60 s TTL bound to the asking connection's `deviceId`, and the CLI opens `http://127.0.0.1:<port>/#launch=<token>` — URL fragment, never query string, so the token appears in no server log and no `Referer`. The page exchanges it in the WebSocket `auth` frame for a **GUI session token** (32 bytes, kept in page memory only — never a cookie, never `localStorage`); the exchange consumes the launch token; a replayed launch token is refused `AUTH` and logged `socket.auth.fail{reason:'token'}` (`G-WEB-05`). The GUI session authenticates as the human principal on the launching device with `client:'gui'` stamped on every event it causes; it ends when the page closes and a 10-minute reconnect grace passes, on `gnomon open --revoke-all`, on daemon exit, or after 12 h; `status.guiSessions{n}` lists them. The browser cannot verify `serverSig` against a registry it does not hold; its trust anchor is that the port and the token come from the kernel itself over the already-authenticated socket, so a same-user listener squatting a loopback port before the kernel never receives the token. Stated residual: a same-user process that reads the launching CLI's memory or terminal scrollback within 60 s can take the token — that actor already owns the device key (§A.1).
3. **Origin lock.** Every WebSocket upgrade and every non-static HTTP request must carry `Origin: http://127.0.0.1:<port>` exactly (or the registered wrapper origin while a wrapper is the launcher, rule 10); a missing or different `Origin` ⇒ `403` with no body and `socket.auth.fail{reason:'origin'}` (`G-WEB-02`). Static files are public bytes of a public npm package and are served without an Origin check, with the headers of rule 6.
4. **DNS rebinding.** `Host` must equal `127.0.0.1:<port>`; anything else — `attacker.example:<port>` resolved to 127.0.0.1, `localhost:<port>`, a bare IP — ⇒ `421 Misdirected Request` and `socket.auth.fail{reason:'host'}` before any routing (`G-WEB-03`).
5. **CSRF.** The endpoint sets no cookie and reads none; the only credential is the GUI token carried in the WebSocket `auth` frame and, on the two non-static HTTP routes (`/diag`, `/blob/<sha>` for canvas images), in the `X-Gnomon-Token` header — so an ambient-credential request from another origin carries nothing; additionally `Sec-Fetch-Site` must be `same-origin` or `none` on every non-static request. A cross-site form POST, `fetch` or WebSocket from another page performs no state change and is logged (`G-WEB-04`). Every kernel verb travels on the authenticated WebSocket only; there is no HTTP RPC.
6. **Headers and CORS.** No `Access-Control-Allow-Origin` on any response, ever (there is no cross-origin consumer); `Content-Security-Policy: default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' blob:; font-src 'self'; connect-src ws://127.0.0.1:<port> http://127.0.0.1:<port>; frame-ancestors 'none'; base-uri 'none'; form-action 'none'`; `Cross-Origin-Opener-Policy: same-origin`, `Cross-Origin-Resource-Policy: same-origin`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `Cache-Control: no-store` on non-static routes; the page has no inline script and no `eval`; the static route path-normalizes and confines to the bundle directory (`G-WEB-06`, including a traversal case and a script-in-block-string case shared with `G-GUI-07`).
7. **WebSocket auth deadline.** After the upgrade the first frame must be `hello` and the second `auth`, both within 5 s, or the socket closes; frames before `auth` succeeds are discarded; the `gnomon-rpc:v1` frame rules apply unchanged (4 MiB, one JSON-RPC message per text frame, backpressure, redaction by principal class — the GUI is the human class, §9.3). Approvals from the GUI go through the broker: `approve` is signed by the hardware approvals key the kernel holds (presence per class, §3.4); the browser holds no key, ever.
8. **Rate and size.** Token exchange ≤ 5 attempts per minute per endpoint; 4 MiB frame cap; `/blob/<sha>` serves only blobs the GUI session's principal may read (§9.3) and only by content hash.
9. **Windows parity.** Identical code path (`node:http` on `127.0.0.1`); browsers Edge/Chrome/Firefox; `gnomon open` launches the URL through the signed helper (`ShellExecute`) — the CLI is not sandboxed, and the `session` profile's `open`/`ShellExecute` deny stays for sessions; `G-WEB-01..06` run on both OS.
10. **Wrapper origin.** When the desktop wrapper launches, it registers its WebView origin (`tauri://localhost` on macOS, `http://tauri.localhost` on Windows WebView2) for that GUI session only; rule 3 then accepts exactly that origin for that token's lifetime; `status` shows `guiSessions[].origin`.

The browser is a client of the same API as every other client; nothing in the GUI's path is a privilege the Python or Swift clients lack.

### 11.3 Look: papercraft by day, phosphor by night (D40)

Light mode = **papercraft** (Paper atelier: cut-paper sheets with grain, ink lines, folded paper caps, pressable ink keys); dark mode = **phosphor terminal** (mono, glow, bracketed keys, glyph caps); optional **automatic day/night swap** following the OS `prefers-color-scheme` or a schedule. The user's choice is stored by the kernel per device (`config`, root-signed is not required for preferences — they are `config.prefs` rows signed by the device key), not in the browser, so every tab and the wrapper agree. Rules measured in the aesthetic session: every key edge ≥ 3:1 (the Shadow-instrument candidate's edges measured under 3:1 and was superseded); project hues are fills only, never text (sage measured 3.96:1 on paper) — `G-GUI-10` is a fixture contrast test on both themes. Colour is never the sole signal; `prefers-reduced-motion` freezes every decorative motion (breeze, paper fly-in) and makes emotes instant pose changes. Fonts are bundled (law 6). The session's open boards — colour (soft project hues + a failure colour), type (papercraft serif vs all-mono), motion specs including the paper fly-in, CLI voice, and the decision-stack + sidebar render — are OPEN 9. Reference renders: `.atelier/sessions/2026-10-15-gnomon-aesthetic/refs/papercraft.html`, `styles.html`, `workshop-mod.html`, `walkthrough.html`.

### 11.4 Chrome, navigation, decisions (D42, D43, D44)

**Chrome principle (D42).** Header, footer, sidebars and mod slots show only what is necessary; everything is reachable from the **command palette** (`⌘K` / `Ctrl+K`), which lists every kernel verb the principal may call, every GUI command and every mod command by id, with its keybinding (`G-GUI-08`); **layout presets** (named arrangements of panes and slots) are saved per device through the kernel and round-trip; the user can move or hide the Workshop (§11.6), the Shuttle view and any mod view; nothing a mod places can pin itself visible (§12.2).

**Left sidebar (D44).** Active and past sessions grouped by project (repo scope), each row with its backend glyph (filled = Claude, outlined = local), state and pending-card count `{n, of}`; a **new session** control opens `session.open` with the project's defaults (`model`, `mode`, `cwd`); search across sessions; a row is the entry to its transcript.

**Decision stack (D43).** Pending cards arrive as pieces of paper (papercraft) or chips (phosphor) that fly in and pile into a **stack**; the stack can be fanned or browsed so a more important decision can be taken first — deciding a later card leaves earlier ones pending and untouched (`G-GUI-09`); inside a session the stack shows only cards whose `scope.repo` is that session's project, and the global inbox in the header shows all. The card body is kernel-owned and verbatim (§4.5): the stack moves the paper, never the words. A card's fly-in is motion on an event (`approval.request`) — the one decorative motion outside the Workshop.

**Panes.** Transcript, inbox/stack, sessions, contract progress, Shuttle view and mod panels in resizable splits; everything the GUI draws beyond the transcript is a `display-block:v1` tree: kernel cards (`inbox.card`, `ask-user`, `plan`, `knot.split`, `budget.meter`, `contract.progress`, `session.live`, `decision.stack`) and mod views placed by slot (§12.2); kernel-owned regions and the sanitizer (§4.5) apply to every pane. The **Shuttle view** (status slot) shows live children `{n, of}` with spend, inbox pending by kind, hsid + mode + backend, budget rung, subscription window, `API CREDITS ACTIVE` when law 7's card is in force, mic state when voice is on, sandbox fidelity, linked and `dev` mods, and `certified/total` in a contract session. Motion-on-events: the GUI repaints only on events or input — no timers, no polling; socket and input silent for 60 s ⇒ zero DOM mutations and zero running animations (`G-GUI-02`); the Workshop's bob is the one scoped override (§11.6).

### 11.5 Composer and decisions (D38)

**Composer.** Local or Claude per session; `/model local|claude|any` per turn is refused unless the session's `declaredModel` is `any`; mid-turn steering (`session.send{steer:true}`) queues text the backend reads at its next step (QM MessageQueue, 21); `Esc` interrupts (control message, §3.3); slash commands are palette commands; dropping or pasting an image into the composer offers "attach to turn" and "open in Doodle" (§12.7).

**Decisions.** The GUI shows cards and takes the decision keystroke or click; the decision goes through the broker with the hardware approvals key — one presence prompt when the GUI session attaches, cached for `tool.permission`/`ask-user`/`plan`, fresh presence for gate-class, install (including a linked mod's re-approve), KNOT resolve, verdict, cloud fallback, budget resume (root key for `use-api-token`/`install`), dropped after 15 min idle or when the GUI session ends (`G-GUI-06`). The GUI never holds any key — the kernel holds the unlocked handle; a decision made from the GUI records `presence` and `cli:{client:'gui', connId}` so §3.4's `approval.suspect` rule can see it; the GUI never calls a write verb without a user gesture (`G-GUI-04`). Reserved decision keys (`y n a d Enter Esc` and digits while a card is focused) belong to the GUI core, never to a mod (§12.2).

### 11.6 Workshop (`#workshop-mod`, first-party, D41)

A minimal optional mod view (vertical sidebar or horizontal footer, movable and hideable per D42) with two zones: **needs you** — caps lined up with their question kind, one per pending card, equal to the inbox's `{n, of}`; **working** — caps that bob only while their session streams (`turn.partial` events) and stand still otherwise. Hat shape = work type (builder, reviewer, teacher, tender), filled = Claude, outlined = local, soft hue = project (never text), violet only for KNOT; every attribute derives from kernel events (`session.*`, `turn.*`, `approval.*`, `warpline.knot`), never from model text (`G-WSP-01`). The bob is an **informed override** of motion-on-events, scoped to this mod and to sessions actively streaming (recorded in the aesthetic session's `overrides`); reduced motion makes it a static "working" pose with a text label. Ships in `packages/gnomon-mods/workshop` on `mod-abi:v1` with fixtures and golden renders on both OS; events `modns.workshop.*`; declared effects `read` only; trust tier `first-party`.

### 11.7 Falsifiers

`G-GUI-01` a 200k-event session: keystroke-to-paint < 50 ms and attach < 2 s, measured in Chromium and in Safari/Edge on the founder's machines with method stated (`G-HON-07`) · `G-GUI-02` 60 s of socket and input silence ⇒ zero DOM mutations and no running animation · `G-GUI-03` the browser matrix renders every fixture; no feature requires a particular browser · `G-GUI-04` no write verb without a user gesture · `G-GUI-05` close the tab mid-turn, reopen, no event lost · `G-GUI-06` cached unlock expires after 15 idle minutes · `G-GUI-07` a block string containing HTML or script markup renders as text and never executes · `G-GUI-08` every command id is reachable from the palette; presets round-trip; Workshop and Shuttle view movable and hideable · `G-GUI-09` decision stack: order independence and per-project filtering · `G-GUI-10` theme contrast fixtures (key edges ≥ 3:1; project hue never as text) · `G-WEB-01..06` per §11.2, both OS · `T-GUI-01` the founder's daily driver is the GUI after two weeks (≥ 70 % of Gnomon-managed sessions opened from it).

---

## 12. Mods — day one, out of process, agent-maintainable, linkable (D27, D33, R7, D53)

### 12.1 Model

A mod is a `manifest:v1 {kind: mod, abi: "mod-abi:v1"}` package: tools (with declared effects), views (slot + placement + fixtures), commands, keybindings, event kinds under `modns.<name>.*`, optional knowledge providers (§8.10), optional MCP/skills/hooks. Its source is either an installed package (`gnomon mod install <path|url>`) or a **linked folder on disk** (`gnomon mod link <folder>`, §12.5) — a cloned repo is the sharing unit. `#mod-host` runs each installed or linked mod as one child process over stdio JSON-RPC under the `mod` profile; the mod never touches the GUI process, the kernel process, the socket credential or another mod. Hot reload by `packageHash` (sha fingerprint over the whole tree, OpenCode pattern, 21). First-party mods ship in `packages/gnomon-mods` under the same ABI and the same sandbox as any other mod: `workshop` (§11.6), `gnome-persona` (§12.6), `doodle` (§12.7); first-party means the trust tier, not a wider ABI.

### 12.2 Closed view kit and slots

Views are pure `render(input) → display-block:v1` over the kit `Box Text List Table Markdown Diff Progress Button Image Canvas`; `Button` carries only a command id; `Image{blob, alt, w, h}` requires `alt` and is served to the GUI only through the endpoint's `/blob/<sha>` route under the viewer's redaction class (§9.3, §11.2) and to the CLI as its `alt`; `Canvas{ds, readOnly?}` names a doodle session and is a **surface the host owns** — the GUI's first-party canvas component binds to it, a mod only references it and can never ship executable content into any client (`G-MOD-10`). No raw strings reach any client: every string passes the sanitizer (§4.5) and the GUI renders strings as DOM text nodes (`G-GUI-07`); a block exceeding 256 KiB or 2 000 nodes is refused `BAD_REQUEST`. `card.*` and `status.mod` slots are **append-only**; kernel card bodies, status indicators and the `contentHash` summary are unreplaceable; mod output is fenced + labelled `mod:<name>` and shows a `dev` badge when the mod is dev-linked (§12.5); a mod view can be moved or hidden by the user and can never pin itself visible. Reserved decision keys (`y n a d Enter Esc` and the digits while a card is focused) are never bindable by a mod (`G-MOD-06`). Fixtures ship with every view; `gnomon mod test` renders fixtures to golden blocks on both OS, including the CLI text projection.

### 12.3 `mod-abi:v1` (≤ 8 RPCs + lifecycle + 2 client relays, law 3)

| RPC | Direction | Purpose |
|---|---|---|
| `init{abi, features}` → `{abi, features, modAbiId}` · `shutdown` | host → mod | lifecycle + feature negotiation |
| `health` | host → mod | liveness + abi echo |
| `view.render{viewId, input, width, prefs:{motion, theme}, cancelToken}` | host → mod | pure render |
| `command.run{commandId, args}` | host → mod | user command |
| `tool.call{name, input, cancelToken}` | host → mod | agent tool; effects enforced by the host |
| `event{event:v1}` | host → mod | filtered feed (grant-bound kinds) |
| `state.get{key}` / `state.set{key, value}` | mod → host | per-mod KV, `~/.gnomon/mods/<name>/state.db`, size-capped |
| `kernel.call{verb, params}` | mod → host | proxied kernel verb under the mod's principal with the caller's hsid attached and scopes intersected; `approve` is never proxied; `spend` from the caller's permit |
| `mod.view{name, viewId, input}` · `mod.command{name, commandId, args}` | client → host (→ mod) | the **client relays**: a client asks the host to render a mod view or run a mod command; the host forwards as `view.render` / `command.run` under the client's principal, returns the sanitized block or the command result; `mod.command` from a GUI requires a user gesture (§11.5); both ride `gnomon-rpc:v1`, are served by the mod host, are hashed into `modAbiId`, and are **not** kernel verbs — the twelve-verb count (§5) excludes them, the mod-ABI count (§10 law 3) includes them |

Every host→mod call carries a timeout; `cancel` is honoured or the child is restarted. `modAbiId` = sha256 of the ABI schema (including the two client relays) + the kit schema (including `Image` and `Canvas`); `status` reports it. Effects: `read` (kernel reads, state.get, view inputs) · `write` (state.set, `log.append` of `modns.<name>.*`) · `network` (only with an egress grant, through the kernel's loopback proxy) · `spend` (drawn from the calling session's permit; the broker grants only if the human's grant row allows that mod to spend). A call outside the declared set ⇒ `FORBIDDEN` + `mod.effect.refused`. **Mod tools reach agents** as a per-session MCP server the host runs (`gnomon-mods` in the session's `mcp.json`), so the kernel's ≤12 proxy tools are untouched (A23-3); knowledge providers (§8.10) and the Doodle tools (§12.7) travel the same way.

### 12.4 Tooling for agents (`gnomon mod …`)

`new <name>` (scaffold with fixtures), `types` (generated `.d.ts` + JSON Schema for the ABI, `modAbiId`-stamped), `test` (fixtures → golden renders + contract tests, both OS), `inspect <name>` (manifest, grants, health, source `package | linked:<path>`, `packageHash`, last renders, **stderr tail**), `install <path|url>` (validate → test → `install` card with pinned `packageHash`; agent-initiated installs always card), `link <folder>` / `unlink <name>` / `dev <name> on|off` / `diff <name>` (§12.5), `rollback <name>` (human-only). The example mod and docs are referenced from `status` so an agent can write a mod from the man page (F4 for mods: `G-MOD-04`, a cold agent builds and installs a passing view with the docs only).

**Trust.** Tiers in the grant table (`first-party | signed:<gkey> | local`), judged on provenance + hash, never self-description; a linked folder is `local` unless its manifest is signed by a trusted key; a mod's manifest cannot request `approve`, `band:write`, or kernel-owned kinds. Falsifiers: `G-MOD-02` a mod declaring `read` cannot `state.set`/`log.append`/write outside its dir/reach an ungranted host (profile + boundary); `G-MOD-03` a crashing mod never takes the GUI or kernel down; `G-MOD-05` any edited file in an installed or linked mod stops it loading until re-carded (`packageHash`); `G-MOD-07` a mod view cannot overlay a card body or the status indicators.

### 12.5 Linked folders — pin, pause, re-approve (R7, D53)

Sharing a mod is cloning its repo and linking the folder. `gnomon mod link <folder>` validates and tests the manifest, then raises an **install card** (fresh presence, root key) that shows the mod's name, source path, trust tier, declared effects, egress hosts, event kinds, tools and views; on `install` the kernel appends `grant.install{manifestHash, packageHash, cardId, source:'linked:<path>'}` and `mod.linked{name, path, packageHash}`, where `packageHash` covers every file in the folder except `.git/**`. `#mod-host` then **watches the folder** (`fs.watch` on macOS, `ReadDirectoryChangesW` on Windows, 500 ms debounce, with a full rehash on every start and on every `gnomon mod inspect`): any change — an edit, a `git pull`, a dependency install — pauses the child before its next load (`mod.paused{name, reason:'changed', files[]}`), marks every view of that mod paused in the GUI, and raises a short **re-approve card** (kind `install`, fresh presence) listing exactly the added, changed and removed paths with old and new hashes (`gnomon mod diff <name>` prints the same list); `install` re-pins (`grant.install` with the new `packageHash`), `deny` keeps the mod paused, `rollback` unlinks. Nothing from the changed tree is loaded before the decision (`G-MOD-08`). **Dev mode** is for mods the user is authoring: `gnomon mod dev <name> on` is itself a card decision (fresh presence, root key) available only for tier `local`; while on, every save re-pins without a card (`mod.repinned{name, packageHash, dev:true}`), every view of that mod carries a visible `dev` badge, the Shuttle view lists `linkedMods{n, dev}`, and `status` names the folder; `gnomon mod dev <name> off` returns the mod to the pin-and-card rule (`G-MOD-09`). A mod that was dev-linked never silently becomes trusted: the badge and the `dev:true` rows are the record. Agents may call `link` (through `kernel.call`, always carded); only a human decides the card.

### 12.6 Gnome persona (`#gnome-persona-mod`, first-party, R5, D45–D49, D52)

Concept doc: `docs/specs/gnomon-mods/gnome-persona.md`. What this spec commits to for 8.0:

- **A dialog voice over the transcript, never instead of it.** Each session may wear a persona; its line is a short game-dialog box above the composer — a `say` sentence or two plus up to four choices — derived from kernel events and from the model's own closing words. The raw completion, every tool call and every kernel event stay where they are (the hash-chained log, the transcript pane), **one key away** (`r` opens the source turn, `R` the log slice); every line is appended as `modns.gnome.line{turn, mode: status | quote, spanRefs[], personaHash}` so the dialog itself is in the log (model-visible ⟺ logged, §3.2 L2).
- **Two tiers, no restyling pass (D52).** Tier 0: deterministic status templates whose slots are kernel fields only (`approval.request{kind}` → "A {kind} card is waiting."; `permit.deny` → "Blocked: {dimension} at {n} of {of}."; `oracle.result{pass:true}` → "Certified {nodeId} ({n} of {of})."). Tier 2: the session model writes the line itself, instructed by a mod-shipped skill to end each turn with a fenced `<gnome say="…" choices="…" />` tail and to keep its closing prose brief — **brevity by instruction**. There is no second model call that paraphrases a completion: the concept doc's local-model restyle tier is dropped; a turn without a tail shows the raw's first sentence as a `quote`.
- **Voice rules = Simplified Technical English (ASD-STE100, D52)** with a length budget: one topic per sentence, ≤ 20 words per sentence, ≤ 2 sentences per line, active voice, present or simple past, one approved word per meaning (no synonyms for the same thing), numbers as digits, no idiom; the forbidden-vocabulary defaults (`understand think feel know believe sure confident realize happy-to obviously`) cannot be removed by any persona. `understood` means acknowledged receipt ("Noted."), never "I understand" (D47); `sorry` pairs courtesy with the fact and the limit ("Sorry — stopped: tsc exit 1.").
- **Never rephrased (D46).** Card bodies, `refusal:v1` text, billing (`API CREDITS ACTIVE`, `api-token`), security and approval text, certification results: the relay may announce their existence by kind and `{n, of}` and must step aside while a card is focused; no choice is ever an approval and no card is read back in the gnome's words.
- **Emotes from kernel events first (D48).** `turn.partial` → walk; `turn.sent` → acknowledged; `approval.decide{allow | always | approve-plan | answer}` → yes; `approval.decide{deny | reject}` and `oracle.result{pass:false}` → no; `permit.deny`, `session.refused`, `refusal` → sorry; `oracle.result{pass:true}` → certified. Phrase triggers from the model's own prose (never tool results, never card text) may fire only the expressive subset (`wave tilt bow blink bounce`), never `yes`, `no` or `certified`.
- **`persona:v1` (D49)** — a small YAML document per gnome (binds by role/backend; voice register, length, vocabulary, status templates; emote phrases; body shape/height/hue/texture; hat style within the Workshop's semantics — hat shape, fill and violet are facts, the body is yours; TTS voice; motion) — stored in the mod's state, not its package tree, so `persona.get | persona.set | persona.preview` on the per-session `gnomon-mods` MCP server hot-apply ("make my reviewer gnome terse and blue" is a tool call, not a reinstall); every change logs `modns.gnome.persona.changed{id, hash, by}` and rollback is `persona.set` with the previous hash.
- **Rendering** follows §11.3: papercraft bodies with the breeze skew, a top-left → bottom-right shadow and a grain layer in light mode; glyph gnomes with glow in dark mode; reduced motion freezes the breeze and makes emotes instant; every emote has a text label.
- **Honest token claims (D45).** Restyling never cuts generation tokens; what saves is brevity by instruction, choices that avoid clarifying turns, and Tier 0 costing nothing; every budget sentence in the UI follows `G-HON-*` wording and the mod measures before it claims (`T-GNM-01`: choice-picked vs typed follow-ups, `raw` open rate, closing-prose token delta with and without the skill, reported with method).
- **Falsifiers.** `G-GNM-01` no `modns.gnome.line` contains a number, path or identifier absent from its source turn or kernel event · `G-GNM-02` on a fixture set the rate of omitted "but/however/except" clauses between the raw closing prose and the `say` line is reported with method, never claimed · `G-GNM-03` the relay never alters a kernel-owned region and `yes`/`no`/`certified` fire only on kernel events, never on phrases.

Effects declared: `read` (event feed incl. message text of attached sessions — a grant row the install card names), `write` (personas, `modns.gnome.*`), `spend` (choices that send a turn draw on the attached session's permit). No `network`. Default posture, one mod or two with the Workshop, and the Tier 2 skill route versus an envelope-contribution RPC in 8.1 are OPEN 11. The voice client speaks the gnome line as `textPlanned` when the persona is on (§14.2).

### 12.7 Doodle (`#doodle-mod`, `$doodle-session`, first-party, R6)

Concept doc: `docs/specs/gnomon-mods/doodle.md`. What this spec commits to for 8.0:

- **A shared, replayable sheet.** A doodle session (`ds:<ULID>`, client-minted; the kernel validates shape only) is attached to one `hsid`, inherits its `scope.repo`, and records every mark as a kernel event appended by `p:<ns>/mod-doodle`: `modns.doodle.session.start{ds, hsid, title, by, seed?}`, `doodle.op{…}` (one kind, discriminated by `op.type`: `add | update | delete | move | lock | unlock | clear`), `doodle.branch{ds, from: seq, child}`, `doodle.export{ds, kind, ref}`, `doodle.session.end{ds, ops, images, branches, compactedTo: "l:L-…"}`, with `causes[]` naming the chat or voice turn live when the mark was made. Shape vocabulary `doodle-shape:v1` (closed, small): `stroke rect ellipse arrow text image redline point group`, each with `id`, `by`, `z`; colour is a role (`ink | accent | project | knot | agent-<n>`) so both themes render it; human marks and agent marks are never indistinguishable (agent ink tinted, cap on hover).
- **The GUI hosts the canvas directly.** The sheet is a `kit.Canvas{ds}` block rendered by the GUI's first-party canvas component (§12.2) — no separate canvas client, no second loopback listener, nothing beyond the web endpoint's rules (§11.2); the canvas engine is **Excalidraw (MIT; LICENSE verified 2026-10-16)**, bundled, with its own history disabled in favour of the log: element changes become `doodle.op`s through `mod.command{name:'doodle', commandId:'doodle.op'}` (§12.3), the fold of ops is the only truth. tldraw is held as a reference, never a dependency: its SDK licence is source-available, requires a licence key or a watermark and phones home on trial, which conflicts with shipping inside `@a-company/paradigm` under law 6. The Excalidraw-element → `doodle-shape:v1` mapping is a pure function with golden tests so the engine can be swapped. Images are content-addressed blobs under `~/.gnomon/mods/doodle/blobs/` (the mod's own dir) served to the GUI through `/blob/<sha>` (§11.2).
- **Agents draw through two tools** on the per-session `gnomon-mods` MCP server: `doodle.view{ds?, bounds?}` → `{sheet: simplified JSON, snapshot: PNG rendered headless by the mod with a coordinate grid and legend}` (effect `read`) and `doodle.draw{ds, ops[]}` → `{applied, refused[]}` (effect `write`; validated against the vocabulary and ownership, a bad shape refused by name). Agents never delete or move a human's marks, never open a sheet without a human keystroke (an agent's `doodle.open` is a proposal the human accepts), never place an image the human has not seen (a "proposed" tray), and are budgeted to 64 ops per turn (`G-DDL-03`).
- **Time-reversal is replay.** Pick a `seq`; apply ops `≤ seq` from the nearest keyframe (a snapshot every N ops or 60 s of activity, derived, recomputable by `gnomon doodle fsck`); the GUI's scrub rail aligns three tracks — ops, chat turns, voice turns (`textSpoken`) — on the same `seq`/`at` axis; `gnomon doodle replay ds:…@<seq|iso>` prints the sheet as JSON (`G-DDL-01`: scrub to any seq of a 10k-op session in < 100 ms on the founder's Mac, method stated; `G-DDL-04`: the fold's hash is reproducible from ops alone). Branching (`doodle.branch`) seeds a child from a moment; `accept` replays the branch's ops onto the parent as new ops; no three-way merge in 8.0.
- **Lore compaction and exports.** At `doodle.session.end` the mod compacts the session into a `.lore` record through the `paradigm` grant (title, participants, counts by kind `{n, of}`, every `text` and `redline.note`, rule ids cited, images by sha with redaction state, decisions and tasks exported, `sym:` refs that resolved, `doodle:` refs to pivotal moments), linked by `compactedTo`; raw ops are retained until the compaction exists + 90 days unless pinned (§3.2 L5). Exports: lore entry, decision (`doodle:` refs as evidence), task or contract-node evidence, Atelier critique finding (`redline` with `rules[]` → `{rule, where, note, severity, evidence}`), Atelier animation (ops' time axis → layer deltas), PNG/SVG of a moment with agent tint preserved.
- **Privacy.** A screenshot is the most likely image and the most likely leak: on placement the GUI runs a local pass (secret patterns from the redaction matrix plus local OCR — engine OPEN 12) and shows proposed redaction boxes before the image is accepted; redaction produces a new blob and the original is pruned or kept `sensitivity: secret`; a known key pattern can never reach `session.send` unredacted (`G-DDL-02`). Only what the human sends leaves the box (a snapshot in `session.send{content:[image]}` is a logged `session.inject` under law 7 and the fuse); sheet text and OCR text are data, fenced and labelled, through the sanitizer; the mod has no `network`; `audience: private` on every event in 8.0.
- **Refs and knowledge.** The mod registers the `doodle:` scheme (§4.4): `doodle:<ds>`, `doodle:<ds>@<seq|iso>`, `doodle:<ds>#<shapeId>[@<seq>]`, `doodle:<ds>/<childDs>`; `ref.resolve` returns `{target: {ds, seq, hsid, repo, lore?}, hash: sha256(fold at seq)}`. A local FTS index (`~/.gnomon/mods/doodle/index.db`, rebuildable by `gnomon doodle reindex`) over text shapes, redline notes with rule ids, the aligned transcript window, OCR text after redaction and the compaction makes Doodle a knowledge provider (`provides.knowledge: [{name: doodle, scheme: "doodle:"}]`, §8.10) with `provenance: observed`, `trust: T3`, a redacted thumbnail and a replay line per hit.
- **Telemetry.** `T-DDL-01` doodles opened per week, ops per doodle, exports per doodle — if exports stay near zero the connection thesis is false.

Effects declared: `read`, `write`, `spend` (an agent-proposed export that drafts text spends from the human's permit, never by default — law 5). Windows parity: identical mod and GUI code; blobs under the owner-only ACL'd home. Open items (OCR engine and default, Excalidraw's bundle cost in the GUI, branch merge, the Atelier `findings.yaml` owner, agent-opened sheets as proposals) are OPEN 12.

### 12.8 Published client API — community GUIs and tools (R7)

`@a-company/gnomon-contracts` publishes the whole client surface as versioned schemas with TypeScript types: `gnomon-rpc:v1` (verbs, params, results, refusal codes, auth forms including the GUI token, the client relays), `display-block:v1` with the kit, `card:v1`, `refusal:v1`, `event:v1` and the kind registry; `clientApiId = sha256(canonical(those schemas))` is reported by `status`, frozen per release and moves with `gnomon-contracts` semver; `docs/specs/gnomon-client-api.md` is generated from the schemas (never hand-maintained, `G-HON-04`'s fixed-point rule). A **conformance suite** (`gnomon client conform <ws-url | socket>` against recorded fixtures) is the definition of a conformant client: authenticates (device key, GUI token or read token) and verifies `serverSig` where it can; subscribes with `since` and survives a `subscription.dropped`; renders card bodies **verbatim from kernel-signed `approval.request` events** and never renders a client- or mod-authored block as a card; sends `approve` only on a user gesture; passes every string through the sanitizer; shows every number as `{n, of}`; renders `kit.Image` with its `alt` and `kit.Canvas` either as a surface or as the mark list. A third-party client built from the published package alone must pass it (`G-CLI-02`), and a forged `approval.request` without a valid kernel signature must not appear as a card (`G-CLI-03`). Community GUIs and tools are therefore interchangeable peers of the first-party GUI: the same auth, the same redaction class, the same unspoofable cards — `card.actions[]` are kernel-signed, `approve` is signed by the hardware approvals key after presence, and the **presence prompt text is composed by the kernel from its own card record** (kind, requester, the `contentHash` summary line), never from the client, so a misleading client cannot hide what a fresh-presence decision approves. Honest limit (threat row 17): the kernel cannot force a client to draw honestly; a non-conformant client can mislead its own user within the cached-unlock window (§A.1); the conformance badge in `status.clients[]` reports which connected clients passed the suite and which did not.

---

## 13. The local lane (`#local-runner`, D20–D23, D37)

### 13.1 `gnomon-local` — the child

`packages/gnomon-local` is a **separate executable** (userland dependency of `@a-company/paradigm`, never of the kernel) built on `pi-agent-core` + `pi-ai` (MIT, `@earendil-works/pi-*`, 21) with pi's `--mode rpc` JSONL shape (`rpc-entry.ts`, 23) as its stdio protocol. The kernel's `#local-runner` is a stdio driver for it, symmetric with `#claude-adapter`. Inside the child: agent loop with parallel tools, steering/follow-up queues, JSONL session tree; **compaction re-derived** (not lifted from pi-coding-agent `compaction.ts:129` / `branch-summarization.ts:305`, 23) with an ~8k-token working target, fixed headings Goal/Constraints/Progress/Decisions/Next/Critical and one compact-and-retry; transport = OpenAI-compatible completions to llama.cpp server, Ollama, LM Studio, vLLM or `mlx_lm.server` (Mac boost), seeded with pi-ai's **llama.cpp compat preset** (no developer role, no `store`, `max_tokens`, qwen chat-template thinking); **pi-ai's cloud providers are excluded from the build** (the compat allowlist contains only OpenAI-compatible local transports); endpoints must be loopback or RFC1918 per root-signed `local.yaml` (law 7, `G-SUB-06`). Per-backend **compat profile** + **tool-capability probe** at `model.capabilities` (tools off unless detected; `n_ctx` from llama.cpp `/slots`), **argument repair** (OpenCode tool-input-repair idea, re-derived), **text-tool fallback** and per-model tool surface `none | compact | full` (Odysseus ideas, re-derived — AGPL, no code), ~8k context targets for coding. Windows: llama.cpp (CUDA/Vulkan) and Ollama are first-class; MLX is Mac-only and optional (§16). The child runs under the `session` profile; `G-LCL-06` asserts it cannot read `~/.gnomon/keys`, the Warpline token store or the approvals handle.

### 13.2 Probe (M1.0)

`gnomon probe local` records `model.probe` + `model.capabilities` for each configured endpoint on both OS. The Claude-Code-to-local-endpoint probe is **dropped** (D37; A23-6: it needs `ANTHROPIC_BASE_URL`, exposes the OAuth token to whatever listens, and Claude Code's prompt + tools overflow ~8k contexts); its loopback override is a `G-SUB-01` refusal case; revisit in 8.1 only if Claude Code gains a first-party local-model mode.

### 13.3 Routing and fallback

Every task/automation/session declares `model: local | claude | any` (`automation:v1`, `session.open`, contract nodes may declare per node). `local` ⇒ a capable local model (probe says tools ok, ctx ≥ task floor) or a **`fallback` card** (`MODEL_UNAVAILABLE` to the caller; the card names the task, the reason, the estimated Claude cost; unattended work **waits**; never auto-falls back — D21). `claude` ⇒ Claude under law 7. `any` ⇒ local if capable, else Claude, logged `session.routed{reason}`. Falsifiers: `G-LCL-01` a `model: local` automation completes end to end on llama.cpp with no Claude process started; `G-LCL-02` an incapable local endpoint yields a `fallback` card and no spawn; `G-LCL-03` the card's `fallback-cloud` decision (fresh presence) spawns Claude under the subscription; `G-LCL-04` compute permits cap concurrent local sessions per machine.

### 13.4 Flywheel

§8.4: local failures are supply for the teacher→skill loop; `{drafted, certified, broke}` denominators; teacher drafts land only via Classroom + `install` card.

---

## 14. Voice (`#gnomon-voice`, P8-R3, D28–D31)

### 14.1 Shape

A client of the kernel (`gnomon-voice`, Node + sherpa-onnx bindings) running as its own principal (§14.4), never part of the kernel; the kernel stays text-native. Engines via sherpa-onnx (ONNX, cross-platform): Silero VAD; Parakeet TDT 0.6B (English default; Whisper via sherpa for multilingual); speaker segmentation + embeddings for live clustering; Kokoro-82M TTS streamed per sentence; optional Smart Turn v3 end-of-turn model. **FluidAudio** (Swift, CoreML/ANE) is an optional macOS backend behind the same `VoiceEngine` interface (`vad | stt | diarize | tts`), selected by capability probe, never required (D31). Audio I/O through a cross-platform capture library (CoreAudio / WASAPI; pick in M4.1, OPEN 4) with the platform AEC on, or headphones.

### 14.2 Interaction (`$voice-turn`)

Push-to-talk by default; **conversation mode** opt-in per session and **only with platform AEC or headphones** — the client refuses to enter it otherwise and says why (S22-M3): VAD-gated listening while the agent speaks; **barge-in** = ≥ 250–400 ms of speech while TTS plays ⇒ stop playback, cancel pending TTS and the LLM continuation, truncate the agent turn to what was heard, log `voice.bargein` and `voice.turn.agent{textSpoken, interruptedAtMs}` (20; `G-VOX-02`). Mic state always visible in the GUI's Shuttle view (D28). Every spoken turn enters the session as `session.send{source:'voice'}` and the model sees the `source: voice` tag. Latency budget end-of-speech → first audio < 800 ms local (VAD 30 ms, end-of-turn ~200 ms, Parakeet 100–200 ms, local TTFT 150–300 ms, Kokoro first chunk 100–150 ms); Claude's TTFT (400–900 ms) is bridged by a **local-model acknowledgement** (a one-line spoken ack generated by `#local-runner` or a cached filler) logged as `voice.turn.agent{source:'local-ack'}`. Every figure is measured on the founder's machines and reported with method (`G-HON-07`). The agent speaks only **speakable content**: the TTS channel carries a spoken summary distinct from the full text answer (diffs/tool output summarized) — when the gnome persona mod is on, its dialog line is that summary (§12.6); `textPlanned` vs `textSpoken` keeps context honest.

### 14.3 Team chat log (D30)

Every turn is a kernel event (§4.10). At `voice.session.end` the client compacts turns into a `.lore`-style record (speakers, decisions, tasks, symbol refs, links to raw `voice.turn.*` ids) written through the `paradigm` grant and linked by `compactedTo`; voice text blobs are retained until that compaction exists + 90 days unless pinned (§3.2 L5). Speaker labels: live clusters → enrolled local voiceprints confirmed in the GUI; unknown = "Speaker 2". Sharing (8.1 transport, 8.0 export): text-only, redacted, **per-speaker consent** recorded in `voice.share.consent[]`; raw audio, voiceprints and wake-word buffers never leave the box; audio not kept by default (opt-in TTL).

### 14.4 Trust (S22-M1/M2, A23-2)

The voice client runs as its own principal `p:<ns>/voice` with its own Ed25519 device key: scope `voice` can `session.send{source:'voice'}` to the session it is attached to, `session.stop{interrupt}`, append `voice.*`, read its session — and can **never** `approve`, run root verbs, request cards, or decide anything by speech. **Speaker id is not authentication**: diarization and labelling happen in the client; the kernel validates shape only (speakerId known or `unknown-N`, turn ids monotone, text ≤ 16 KiB); enrolment (`voice.enrol`) and deletion (`voice.forget`) are root-signed CLI acts with recorded consent; voiceprints live under `~/.gnomon/voice/prints/` with `sensitivity: secret`, never leave the box, and are deleted by `forget`. **By default only the founder's enrolled turns are forwarded** to the session; other speakers are logged (`speakerEnrolled:false`) and shown in the GUI but not sent unless the human toggles it per session. Only text ever reaches Claude (D29); a cloud STT/TTS or speech-to-speech path is 8.1 and would require a per-session visible flag + logged event (20). Falsifiers: `G-VOX-04` the voice principal's `approve`/root/`permit.reserve` attempts are `FORBIDDEN`; `G-VOX-06` unenrolled speech is logged but not forwarded by default; `G-VOX-07` conversation mode refuses without AEC/headphones.

### 14.5 Lift (file:line)

constellation: `ui/src/audio/capture.ts:1-8` (AudioWorklet 16 kHz downsample, energy segmenter with adaptive floor, Me/Them capture), `server/audio.ts:1-8` + `server/hear.ts:1-8` (hallucination filter, normalise, WAV parse), `server/voice.ts:1-2` (engine process manager pattern; whisper-server replaced by sherpa-onnx), `server/commands.ts:1-8` (addressing grammar incl. mishearings), `server/bridge.ts:15-25,211-215` (gap/cap batcher 1 500/8 000 ms + wait contract), `shared/types.ts:177-191` (`TranscriptChunk` chunkId/speaker/startMs/endMs/revisionOf/command) and `shared/graph.ts:319-321`, `shared/api.ts:28` (`source.chunkIds` provenance from lines to ops). a-aloud: `packages/core/src/types/tts.ts:2,11-37,57` (`VoiceQualityTier`, `TTSVoice`, `TTSBoundaryEvent`, `TTSProvider`), the broker's `/page` + `/await_reply` speak-and-listen loop (`packages/broker`, `portal.yaml:12`). Re-derive, not lift: Conductor's WhisperKit push-to-talk state machine (Swift).

### 14.6 Falsifiers

`G-VOX-01` PTT turn round-trips text to a local session on macOS and Windows · `G-VOX-02` barge-in truncates `textSpoken` and cancels TTS within 300 ms · `G-VOX-03` session end produces a lore record whose links resolve to every raw turn · `G-VOX-04` voice principal cannot approve, run root verbs or reserve permits · `G-VOX-05` no audio file exists after a default session · `G-VOX-06` unenrolled speech logged, not forwarded · `G-VOX-07` conversation mode refused without AEC/headphones · `T-VOX-01` voice-to-voice p95 < 800 ms local on the founder's Mac, reported with method (telemetry).

---

## 15. Security model

### 15.1 Threats and what holds (Aegis stage-1: the OS user)

| # | Threat | Mitigation | Residual |
|---|---|---|---|
| 1 | Forged env identity | key/device-stamped socket identity (I2) | Warpline unmarked CLI shells until P8-D16 |
| 2 | Session approves/resumes/resolves/installs for itself | `approve` HUMAN_ONLY; `decisionSig` with approver in preimage by a hardware approvals key with presence (fresh, or cached ≤ 15 min for `tool.permission`/`ask-user`/`plan`); `use-api-token`/`install` need the root key (presence); session sandbox denies `~/.gnomon/keys`; `approval.suspect` flags no-TTY, session-ancestry or wrong-presence decisions | a sandbox-escaped process issuing a **cached-class** decision within the unlock window on the attached GUI session's behalf — detectable by `approval.presence{cached}` + `cli` ancestry, not prevented (D38, §A.1) |
| 3 | Runaway fan-out / quota drain / founder lock-out | fuse (tokens, USD, compute, subscription window reserve), per-message metering, group/job kill, breaker, GUI | out-of-kernel `claude -p` (visible count) |
| 4 | Prompt injection (tool results, KNOT payloads `descriptors.ts:52-61`, notebooks, neurons, voice transcripts, mod output) | untrusted-content sentence; T3 as untrusted; `inject.receipt`; reviewer has no tools; voice text is data; `source: voice` tag | the reading model |
| 5 | Env/config bypass | no `*_DISABLE`; root-signed config (hardware presence); build-time test constant; project scope cannot set policy | an attacker with the presence prompt (i.e. the human) |
| 6 | API-credit billing by accident or by an agent | law 7 preflight on env + every settings layer + `mcp.json` env blocks + base URLs; mid-session layer writes stopped (`G-SUB-05`); per-use root-signed card; token injected into one process; indicator + events | a layer the scan does not know (new Claude Code setting) — the scan list is versioned per `claude` version in `G-SUB-01` |
| 7 | Socket/pipe hijack or relay | 0600 socket / helper-created pipe with owner-only DACL + `FIRST_PIPE_INSTANCE` + server-PID check, 0700 home / owner-only ACL, mutual auth bound to endpoint path, single-use nonce | no peer credentials in Node on unix sockets |
| 8 | Supply chain | law 6; kernel zero runtime deps (`G-SEC-01`); pi-ai, React and Excalidraw pinned exact in userland packages only; the GUI bundle fetches nothing at runtime; signed helpers verified by checksum at start | — |
| 9 | Malicious or buggy mod | out of process under the default-deny `mod` profile, declared effects enforced at the boundary and by profile, closed kit + sanitizer, append-only card slots, no credential, caller-hsid proxying, `install` card + rollback | a mod's `tool.call` output is model-visible text (threat 4) |
| 10 | Log rewrite / db deletion | mandatory signatures, two anchors (file + keystore via helper), missing-db rule | same-user rewrite of both anchors + re-sign with on-disk Ed25519 keys (root- and approval-signed rows excluded) |
| 11 | Project files set policy | base-revision read; gate-class on `.gnomon/**`, `.claude/**`, `CLAUDE*.md`, test/package/pipeline files, AND `.git/config`/`hooks`/`info`/`.gitattributes` via `gitHash` | a hook path the hardening flags do not neutralize (D12 class) |
| 12 | Oracle runs agent code on the key box | default-deny `gnomon-oracle` profile (copy of worktree, no network, no keystore/mach-lookup, escape tests) | sandbox-exec deprecated / Windows restricted-token fidelity (§A.2); sessions are sandboxed for key access and settings writes — the oracle sandbox protects oracle integrity, not keys |
| 13 | Shared `.git` write by a session (hooks, fsmonitor, filters, includes) | hardening env + flags on every kernel git call; `filter.*`/`merge.*.driver`/`diff.*.textconv`/`include*` refused; `git` sandbox class; `gitHash` gate-class | git features outside the list |
| 14 | Voice spoofing / audio exfiltration | voice as its own low-scope principal; speaker id is not authentication; enrolled voiceprints local and `secret`; unenrolled speech not forwarded by default; audio not kept; text-only to Claude | microphone access is the OS's permission, not Gnomon's |
| 15 | Windows read-denial fidelity | `WRITE_RESTRICTED` restricts writes only; helper ACL/AppContainer work for read denial; `partial` reported honestly in `status` | on Windows key-read denial inside sandboxes is `partial` until proven (§A.3) |
| 16 | Browser-borne attack on the loopback endpoint (another tab, DNS rebinding, CSRF, token theft, markup in block strings) | `#web-endpoint`: `127.0.0.1` only, single-use launch token in the URL fragment, GUI token in page memory, origin lock, `Host` allowlist, no cookies + `Sec-Fetch-Site`, no CORS header, strict CSP, auth deadline, DOM-text rendering (`G-WEB-01..06`, `G-GUI-07`) | a same-user process reading the launching CLI's memory within 60 s; a stolen GUI token inside the cached-unlock window (§A.1) |
| 17 | A non-conformant community client misleads its user (draws a fake card, hides a real one) | kernel-signed cards and `actions[]`; presence prompt text composed from the kernel's card record; conformance suite + badge in `status.clients[]` (`G-CLI-02`, `G-CLI-03`) | cached-class decisions on a misleading client (§A.1); the user's choice of client |
| 18 | A linked mod folder changes under the user (edit, `git pull`, dependency install) | folder watch + rehash; pause before the next load; re-approve card listing the changed files; dev mode only for tier `local`, with a visible badge (`G-MOD-08`, `G-MOD-09`) | a change between two watch events on a filesystem without change notification (full rehash on every start and `inspect`) |

### 15.2 Key custody (D38/D39)

Root and approvals keys in hardware (Secure Enclave / TPM) via `packages/gnomon-helper` (macOS: a Developer-ID-signed, entitled helper — OPEN 1; Windows: a signed helper using `KeyCredentialManager`/NCrypt); the root key is used for registry/grant/config/install/api-token writes only — rare, prompted per signature; the approvals key signs `approve` with the presence classes of §3.4 and is never on disk. Device keys Ed25519 files 0600 (owner-only ACL on Windows), one per machine under one principal (Q1), used for client auth only; agent keys files; session/mod/voice keys ephemeral or scoped; sessions, oracles and mods cannot read any key file (sandbox profiles). Keys never under a repo, never in git. No key that can approve is ever on disk. Revisit trigger per §A.1.

### 15.3 Socket auth, env, no bypasses

§4.9; §3.3 allowlist/scrub; `G-SEC-02` envKeys ⊆ allowlist ∪ additions; production reads no `GNOMON_*` about itself.

### 15.4 Capabilities and grants

Capabilities: `log.append:<ns>.*` · `log.read` · `log.read:sensitive` · `ref.resolve` · `resolver:<scheme>` · `permit.reserve:<kind>` · `oracle:<type>` · `band:read` · `hook:<event>` · `mod:<effect>` · `voice` · `knowledge:provide`. Grant rows (`~/.gnomon/grants.jsonl`, root-signed): `grant.capability{manifestHash, capabilities[]}`, `grant.bind{principal, manifestHash, kinds[]}`, `grant.trust{manifestHash, tier}`, `grant.install{manifestHash, packageHash, cardId, source: package | linked:<path>, dev?}`, `grant.device{deviceId}`, `grant.voice{speakerId}`, `grant.egress{manifestHash, hosts[]}` (Anthropic API hosts refused). Project manifests may request, never grant.

### 15.5 Sandbox profiles (D13, D25, S16-3/4, S22-C3/H1/H8, A23)

Five named profiles per platform, versioned and hashed into the events they protect:

| Profile | Used for | macOS `sandbox-exec` (default-deny) | Windows (restricted token + ACL + job object; dsh `packages/sandbox/sandbox-windows-acl/src/index.ts:4,28`, `ffi.ts:253`, `runner.ts:4` @ `86a402200d`, design note `.agents/notes/implemented/feature/2026-08-08-windows-acl-restricted-token-sandbox.md`) |
|---|---|---|---|
| `gnomon-oracle` (Move 2) | `test`, `merge-ci` | deny-default file read/write, mach-lookup, process-exec, network; allow read: the worktree copy, toolchain dirs (node, git, `/usr`, `/System`, `/Library/Developer`), `/dev/null`; allow write: the copy dir + a private `TMPDIR`; allow exec: node, git, the project's test binaries by path; escape tests `G-SBX-04` (`osascript`), `G-SBX-05` (`launchctl`), `G-SBX-06` (`open`) | `WRITE_RESTRICTED` token (`CreateRestrictedToken` + `DISABLE_MAX_PRIVILEGE` + `LUA_TOKEN`) with the copy dir and `%TEMP%` granted write, `~/.gnomon` and the user profile's credential stores denied by ACE, job object with no network via WFP filter (helper), escape tests `G-SBX-04w..06w` (PowerShell `Start-Process` elevation; `schtasks`; `explorer`/`rundll32`); reports `full | partial` honestly like dsh — `partial` where reads cannot be denied |
| `gnomon-reviewer` | the reviewer `claude -p` | as oracle but: real `HOME` with `~/.gnomon`, `~/.ssh`, `~/.aws`, `~/.npmrc`, `~/.config/gh` denied; mach-lookup to `securityd` allowed (Claude's OAuth item); network only to the kernel's loopback proxy carrying the Anthropic allowlist (P8-D17, S22-M4); **weaker than oracle, stated** | same denies by ACE; Credential Manager reachable; outbound only to the loopback proxy |
| `git` | every kernel git call | oracle profile + read of the repo; writes only the worktree target | same |
| `session` | `claude -p`, `gnomon-local`, their tool children | allow-most profile that denies: reads of `~/.gnomon/keys/**`, `~/.gnomon/warpline/**`, `~/.gnomon/head`, the Warpline token files and `securityd` lookups for Gnomon's keystore items; **writes** under `~/.gnomon/**` and to every Claude settings layer (`~/.claude/settings*.json`, managed files, project `.claude/**`, `CLAUDE*.md`); AppleEvents, LaunchServices (`open`), `launchctl`, mic/camera (TCC); does not confine tools, worktree or network; `G-SBX-04..06` run against this profile too | ACEs denying the same paths and writes; Credential Manager items for Gnomon ACL'd to the interactive token only; `schtasks`, WMI, `Start-Process -Verb RunAs` denied via job limits + helper; `partial` on read denial |
| `mod` | every mod child | default-deny: reads of the SDK + own package + own dir; writes only `~/.gnomon/mods/<name>/`; network only to the kernel egress proxy port; no exec | same via ACL + job object; `partial` on read denial |

Rule: a profile that cannot be applied (API missing, platform `partial`) ⇒ the oracle refuses to run (`UNSUPPORTED`) and the session or mod refuses to spawn unless the human approves a `gate-class` card naming the degraded protection — never a silent downgrade (Odysseus containment posture, 01); `mod.sandbox{full|partial}` and `session.sandbox{full|partial}` are logged and shown in `status`.

### 15.6 Mod trust tiers

Grant-table labels; runtime enforcement = out-of-process host + declared effects + the default-deny `mod` profile (D33, S22-C3), a genuine first among the reference harnesses (21).

### 15.7 Project policy and gate-class (S-C4, S16-7)

`.gnomon/project.yaml` (`mode`, `ci`, `repoId`, `model` default) committed, read from the base revision. Gate-class = any change to `.gnomon/**`, `.claude/**`, `CLAUDE.md`, `CLAUDE.local.md`, test config, `package.json` scripts, lockfile scripts, pipeline files, `.git/config|hooks|info`, `.gitattributes`, user-scope `~/.claude/**` observed by `layersHash`/`gitHash` at any spawn/respawn or mid-session — detected by **hash comparison**, not diffs, so gitignored and user-scope layers count.

---

## 16. Windows parity (`~windows-parity`, P8-R4)

| Piece | macOS / Linux | Windows | Tests |
|---|---|---|---|
| Kernel endpoint | unix socket 0600 (`$XDG_RUNTIME_DIR` fallback) | named pipe `\\.\pipe\gnomon-<sha>` created by the signed helper with a DACL for the current user SID only + `FIRST_PIPE_INSTANCE`; clients verify the server PID against the pidfile (S22-H7) | `G-WIN-01` both transports pass the §4.9 handshake, the PID check and `G-SOCK-*` |
| Home dir + modes | `~/.gnomon` 0700, files 0600 | `%USERPROFILE%\.gnomon` with an owner-only DACL applied via the helper (`icacls` fallback), inheritance removed, verified by reading back the ACL | `G-WIN-02` ACL read-back = expected |
| Root + approvals keys | Secure Enclave P-256 with presence via the signed helper | Windows Hello `KeyCredentialManager` / NCrypt platform-provider (TPM) P-256 with presence; `CredRead`-style stores are not used for keys | `G-WIN-03` root-signed write and fresh-class decision prompt; a decision without presence is refused; absent helper ⇒ refuse |
| Chain anchor | file + Keychain generic password (helper) | file + Credential Manager generic credential (helper) | `G-LOG-06` both |
| Process isolation + kill | `detached`, own pgid, staged control message → SIGTERM → SIGKILL | job object `KILL_ON_JOB_CLOSE` via the signed helper (`gnomon-helper.exe`); control message → stdin close → `TerminateJobObject`; fallback `taskkill /T /F` logged as `partial` | `G-RUN-03` both |
| Interrupt | stream-json `control_request{subtype:'interrupt'}` | same (never `GenerateConsoleCtrlEvent`) | covered by `G-RUN-03` both (the staged stop begins with the control message) |
| Sandbox | `sandbox-exec` profiles (deprecated but functional) | restricted token + ACL + job object backend (deepseek-harness design), `full|partial` reported; `partial` for read denial until the helper's AppContainer/LowBox or dedicated-SID path is proven | `G-SBX-*` both; `G-WIN-06` `status` shows `partial` on a stock Windows box and every oracle refuses to run |
| Daemon activation | client activation; launchd 8.1 | client activation; Task Scheduler / service 8.1 | `G-DMN-03` both |
| Claude Code preflight paths | `~/.claude`, `/Library/Application Support/ClaudeCode/managed-settings.json`, managed preferences | `%USERPROFILE%\.claude`, `C:\Program Files\ClaudeCode\managed-settings.json`, `managed-settings.d/`, HKLM/HKCU policy keys (`C:\ProgramData\ClaudeCode` retired at v2.1.75); Git for Windows required by Claude Code | `G-SUB-01` both |
| Local engines | llama.cpp (Metal), Ollama, LM Studio, vLLM, `mlx_lm.server` (Mac boost) | llama.cpp (CUDA/Vulkan), Ollama, LM Studio; no MLX | `G-LCL-01` both |
| Voice engines | sherpa-onnx (CPU/CoreML EP) + optional FluidAudio | sherpa-onnx (CPU/DirectML EP); WASAPI capture | `G-VOX-01` both |
| GUI shell | default browser via `open` (Safari/Chrome/Firefox); optional Tauri wrapper (WKWebView) | default browser via `ShellExecute` through the signed helper (Edge/Chrome/Firefox); optional Tauri wrapper (WebView2) | `G-GUI-03` both |
| Web endpoint | `node:http` on `127.0.0.1`, ephemeral port | same code path | `G-WEB-01..06` both |
| Linked mod watch | `fs.watch` (FSEvents), 500 ms debounce, rehash on start | `ReadDirectoryChangesW`, same debounce and rehash | `G-MOD-08` both |
| Paths + hashes | POSIX | long paths (`\\?\`), `core.longpaths=true`, case-insensitive FS handled in ref/alias tables; `layersHash`/`gitHash` normalize CRLF and path case | `G-WIN-04` |
| Env allowlist | `HOME USER …` | + `USERPROFILE SYSTEMROOT WINDIR SystemDrive ProgramFiles COMSPEC PATHEXT APPDATA LOCALAPPDATA TEMP CLAUDE_CODE_GIT_BASH_PATH` | `G-SEC-02` both |

Rule: CI runs the `G-` matrix on macOS and Windows runners, and platform-independent tests run on Windows CI from day one (A23-5); a test marked platform-specific must have a sibling or an explicit `n/a` row with a reason (`G-WIN-05` enforces). FluidAudio and MLX are the only Mac-only components and both are optional.

---

## 17. Migration from 7.x

1. Envelope + identity adapters (`paradigm.event` mirror; root + device keys; roster gkeys).
2. One runner, two backends: constellation and flow become socket clients; the GUI replaces the founder's day-to-day interactive Claude Code use for Gnomon-managed sessions; the Claude Code plugin keeps working for sessions opened by hand.
3. Approval broker: constellation cards, flow approvals/step-up, Symphony file-requests → `card:v1` renderers.
4. Manifest-generated plugin files (`plugin.json`, `.mcp.json`, `hooks.json`, `FAMILY_META`; `generate-hooks.mjs` subsumed).
5. Ref resolvers.
6. Learning: `inject.receipt` + `credit`; `appliedCount` frozen; teacher flywheel.
7. Contracts: `paradigm pipeline plan` compiles + `contract.register`; `paradigm_pipeline` gains `compile|claim|progress`.

**Never moves:** `.purpose`, `portal.yaml`, symbol index · neurons vault · Warpline fabric/objects/refs/keys/tokens · flow chain · constellation op log · `~/.claude/projects/**` · notebook YAML · lore/decision YAML. **7.x keeps working:** `G-MIG-01` (suite passes with `~/.gnomon` absent). **Conductor:** `ClaudeStreamSession.swift` (`:183 --dangerously-skip-permissions`) deleted in M3.6 with `GnomonClient.swift`; `G-MIG-02`. **flow/constellation:** `HeadlessRunner` (`headless.py:313,510`) retired after `G-RUN-04`; `createAgents` (`agents.ts:121`) keeps its API; `tokenFor` (`agents.ts:165`) stays for constellation's own MCP auth.

---

## 18. Package layout, naming, versioning

```
packages/gnomon-contracts/   @a-company/gnomon-contracts 1.0.0   zero deps; TS + JSON Schemas for §4 (incl. mod-abi:v1, voice:v1, kit incl. Image/Canvas); the published client API + conformance fixtures; clientApiId
packages/gnomon/             @a-company/gnomon 8.0.0             bin: gnomon, gnomond — ZERO runtime deps (G-SEC-01)
  kernel/{identity,log,runner,supervisor,broker,budget,scheduler,manifest,refs,socket,web,sandbox,modhost}/   node: built-ins only; import fence; web = loopback HTTP + RFC 6455 server framing over node:http
  adapters/{claude-code,local}/          claude -p stdio driver + fixtures; gnomon-local stdio driver (JSONL) + fixtures — no model loop here
  platform/{darwin,win32,linux}/         endpoint, acl, jobobject, sandbox backends, folder watch; talks to gnomon-helper for keys, presence, pipe, anchors, ShellExecute
  clients/{ts,python}/                   thin socket clients (constellation, flow); the conformance runner
  cli/ hooks/ sandbox/ test/
packages/gnomon-helper/      @a-company/gnomon-helper 1.0.0      darwin: Developer-ID-signed, entitled helper (Secure Enclave keys, presence, Keychain anchors)
                                                                 win32: signed helper (TPM keys via KeyCredentialManager/NCrypt, Windows Hello presence, pipe DACL/first-instance, job objects, ACLs, anchors, ShellExecute)
                                                                 prebuilt binaries with checksums in the release gate; verified at start (G-HLP-01)
packages/gnomon-local/       @a-company/gnomon-local 8.0.0       userland; pi-agent-core + pi-ai pinned exact; --mode rpc child; cloud providers excluded at build
packages/gnomon-gui/         @a-company/gnomon-gui 8.0.0         the localhost GUI: React SPA, virtualized transcript, decision stack, sessions sidebar, Shuttle view, palette, themes, canvas surface (Excalidraw); served by the kernel as static bytes from a root-signed path; no runtime fetch
packages/gnomon-mod-sdk/     @a-company/gnomon-mod-sdk 1.0.0     mod-abi:v1 types, kit, test harness, example mod, link/dev tooling
packages/gnomon-mods/        @a-company/gnomon-mods 8.0.0        first-party mods on mod-abi:v1: workshop/, gnome-persona/, doodle/ (each with fixtures, golden renders, a knowledge provider where it applies)
packages/gnomon-voice/       @a-company/gnomon-voice 8.0.0       sherpa-onnx engines, VoiceEngine interface, FluidAudio optional backend (darwin); own principal
plugins/paradigm/mods/shuttle/   optional Claude Code Mod band (read-scoped)
packages/paradigm/src/core/contracts/   the compiler
packages/paradigm/src/core/knowledge/   the knowledge-provider registry behind paradigm_retrieve (home is OPEN 13)
packages/paradigm-mcp/src/tools/gnomon-proxy.ts   ≤ 12 tools
```
Deliverable: release-gate — the package-level checks `G-CON-01`, `G-CON-02`, `G-SEC-01`, `G-SEC-02`, `G-MIG-01`, `G-LAW-06`, `G-WIN-05`, `G-CLI-02` bind here.

Relations: `@a-company/paradigm` 8.0.0 depends on `@a-company/gnomon`, `@a-company/gnomon-gui`, `@a-company/gnomon-mods` and `@a-company/gnomon-local` (only `@a-company/paradigm` publishes); the kernel depends on none of them and reads the GUI bundle only as a static directory named in root-signed config; `@a-company/warpline` stays 0.x, untouched by Gnomon's build (P8-D16's `refs.watch` + keyed-only `resolve` are Warpline's own changes); plugin version bumps in lockstep; `abiId`, `modAbiId`, `clientApiId` and `gnomon-contracts` semver move together; pi-ai, React and Excalidraw pinned exact with their MIT notices in `THIRD_PARTY.md`; a community GUI depends on `@a-company/gnomon-contracts` only.

---

## 19. Delivery — four moves, ONE Move 1 (D36), proper-first

Each task: acceptance oracles (test ids; every one runs on macOS + Windows unless `n/a` with a reason) and a falsifier. Field metrics are `T-` telemetry (§20). Proper-first means the foundation lands before anything that decorates it: kernel, endpoints and their security model, the GUI shell and the mod host in Move 1; contracts and the armada in Move 2; the learning loop, knowledge search and the two expressive first-party mods in Move 3; voice in Move 4.

### 19.1 Move 1 — kernel, two stdio backends, web endpoint, GUI, mods, fuse, clients (`$move-1`)

Ordering (A23-5 inside one move): probes first; Windows CI on platform-independent tests from day one; each test lives with the task that can pass it; the `gnomon-oracle` profile moves to M2.3.

| Task | Scope | Acceptance oracles | Falsifier |
|---|---|---|---|
| M1.0 Probes | hook `session_id`; `--setting-sources`; **Windows root/approvals key type** (KeyCredentialManager vs NCrypt), **pipe helper** (DACL + first instance + PID check), macOS Secure Enclave helper signing; local endpoint capabilities both OS; default-browser launch on both OS (`open`, `ShellExecute` via helper); RFC 6455 framing over `node:http` upgrade (throughput at 4 MiB frames); Excalidraw bundle cost (OPEN 12); optional Mod-socket spike | `G-WIN-03` (probe form), `T-SHU-01` | a probe shows a ruling cannot hold ⇒ re-plan before building |
| M1.1 `gnomon-contracts` + `gnomon-helper` | §4 schemas incl. the kit with `Image`/`Canvas`, the client relays, the published client API and `clientApiId`; signed helpers for both OS (keys, presence, pipe, job objects, ACLs, anchors, ShellExecute) | `G-CON-01`, `G-CON-02`, `G-HLP-01` (helper signature + checksum verified at start), `G-WIN-01` | helper cannot be signed ⇒ OPEN 1 blocks Windows/macOS key work |
| M1.2 `#kernel-log` | chain, signatures, anchors via helper, segments, audience/sensitivity | `G-LOG-01..04`, `G-LOG-06..08` | p99 > 5 ms / RSS > 150 MB |
| M1.3 `#identity` | P-256 root + approvals in hardware with presence classes; device keys; namespaced principals; signed registry/grants; hsid; GUI session principal stamping (`client:'gui'`) | `G-ID-01..05`, `G-ID-06` (approvals unlock drops after 15 idle min), `G-ID-07` (no approval-capable key file exists) | a human principal mintable without presence |
| M1.4 `#socket` + `#web-endpoint` + ABI | mutual auth on socket + pipe, 12 verbs, ownership default + `modns`, subscribe, `status` (incl. `clientApiId`, `guiSessions`), `abiId`, sanitizer; loopback HTTP + WebSocket transport: bind rule, launch token → GUI token, origin lock, Host allowlist, no cookies + `Sec-Fetch-Site`, headers/CSP, auth deadline, rate/path limits, wrapper-origin registration | `G-ABI-01..05`, `G-SOCK-01..04`, `G-WEB-01..06` | a verb added to serve a client; any request from a non-Gnomon origin reaches a verb |
| M1.5 `#manifest-loader` + policy | validate incl. mod fields, `packageHash`, `provides.knowledge`, linked-folder source; grants, egress (Anthropic hosts refused), generated files, per-session policy with key/settings denies, `layersHash`/`gitHash`, install card, rollback | `G-MAN-01..03`, `G-HON-04`, `G-LAW-04` | install→uninstall diff non-empty |
| M1.6 `#approval-broker` + `#budget-fuse` | cards + presence classes + `suspect` (incl. `client:'gui'` provenance); four fuse dimensions; subscription windows; law 7 inside the broker; `api-token` card with keystore injection; presence prompt text composed from the kernel's card record | `G-BRK-01..04`, `G-LAW-01`, `G-LAW-01b`, `G-BUD-01..03`, `G-SUB-02..04` | fuse or law 7 bypassed by any setting for kernel-spawned sessions |
| M1.7 `#session-runner` + `#supervisor` + `#claude-adapter` | lift agents.ts/claudeCli.ts; headless.py extras; partial messages; ask-user/plan cards; law-7 preflight + mid-session watch; git hardening; `session` profile; job objects; control-message interrupt | `G-RUN-01..03`, `G-RUN-05`, `G-RUN-06`, `G-ADP-01`, `G-SUB-01`, `G-SUB-05`, `G-SBX-01..06` (session profile) | > 1 stream-json breaking change/month |
| M1.8 `#local-runner` + `gnomon-local` | child executable (pi rpc shape), compat allowlist without cloud providers, loopback/LAN rule, probe, repair, text-tool fallback, routing + `fallback` card, compute permits | `G-LCL-01..04`, `G-LCL-06`, `G-LAW-01c`, `G-SUB-06`, `G-ADP-02` | no local model completes an automation end to end |
| M1.9 `#scheduler` + `$daemon-lifecycle` | timers, automations with `model`, idle exit incl. mod stop and GUI sessions as subscribers, clean re-exec, orphan sweep, both endpoints + the web endpoint's lifecycle | `G-SCH-01`, `G-LAW-05`, `G-LAW-05b`, `G-DMN-01..05` | daemon exits with a live child |
| M1.10 `#gui` | the SPA: virtualized transcript, composer, decision path with presence classes, sanitizer + DOM-text rendering, kernel-owned regions; themes (papercraft / phosphor / auto) with contrast fixtures; chrome principle, command palette, layout presets; left sessions sidebar with new-session; decision stack with per-project filtering; Shuttle view; `/diag`; browser matrix | `G-GUI-01..10` | 200k-event session > 50 ms keystroke-to-paint in any matrix browser |
| M1.11 `#mod-host` + `gnomon-mod-sdk` + `#workshop-mod` | `mod` profile (default-deny), egress proxy, `mod-abi:v1` with lifecycle/cancel and the two client relays, kit `Image`/`Canvas` (host-owned surface), per-session MCP for mod tools, `gnomon mod new\|types\|test\|inspect\|install\|link\|unlink\|dev\|diff\|rollback`, folder watch + pause + re-approve card + dev badge, example mod; the Workshop as the first first-party mod | `G-MOD-01..10`, `G-WSP-01` | a mod exceeds its declared effects; a changed linked folder loads without a card |
| M1.12 Clients + observability + replay + conformance | TS/Python clients; constellation + flow on the kernel; the conformance suite and generated client-API doc; kind registry; Paradigm logger; metrics; honesty CI; `gnomon replay` | `G-CLI-01..03`, `G-RUN-04`, `G-KRN-01`, `G-KRN-02`, `G-SEC-01`, `G-SEC-02`, `G-OBS-01`, `G-HON-02..07` | two UIs disagree on a card; replay diverges; a client built from the published package fails conformance |

Pass (Move 1): the founder drives a Claude session and a local session from the GUI in a browser on macOS and Windows, in both themes, deciding cards from the stack; a `model: local` automation runs unattended on llama.cpp and an incapable one waits on a `fallback` card; a 5-session fan-out is stopped by the fuse with receipts; law 7 refuses an API-key environment and a loopback override; a page on another origin cannot reach a verb; flow and constellation run on the kernel path and the Python client passes conformance; one agent-written mod is installed through a card, runs default-deny, and renders in the GUI; a mod cloned from a repo is linked through a card, edited, pauses, and is re-approved from the list of changed files; the Workshop shows the fleet with caps that move only while streaming; Windows shows `partial` honestly where it is.

### 19.2 Move 2 — contracts, spawn, armada (`$move-2`)

| Task | Scope | Acceptance oracles | Falsifier |
|---|---|---|---|
| M2.1 `#contracts-compiler` | §7.1 compiler in `paradigm pipeline plan` (incl. the suffixed-range rule); `contract.register`; Appendix A | `G-CTR-01`, `G-CTR-02`, `G-CTR-07`, `G-HON-01` | compiler needs an LLM |
| M2.2 Claims + lifecycle + progress | `claim\|built\|release`, `ttl` expiry via kernel timer, progress block in the GUI | `G-CTR-03` | a claim lost, duplicated or never expiring |
| M2.3 Oracles + `#oracle-sandbox` | exists/test/gate-check/ripple-clean/shadow-admission (kernel token)/merge-ci/reviewer; the `gnomon-oracle` + `gnomon-reviewer` profiles on both OS and the reviewer egress proxy (moved here from Move 1, A23-5) | `G-CTR-04..06`, `G-CTR-08`, `G-CTR-09`, `G-SBX-07` (oracle profile escape suite both OS) | an agent certifies its own node |
| M2.4 Warpline-native spawn | credential selection, env, denies, attach, pointer line, stored `gnomon-kernel` token, selvage watch → `refs.watch` | `G-SPN-01..07` | pointer line grows |
| M2.5 Git-mode spawn | hardened + sandboxed worktree/branch, merge-tree, base-revision ci, conflict card | `G-GIT-01..03` | kernel writes `main` |
| M2.6 Teacher flywheel | `local-model-failed` detector → `teacher.draft` permit → Classroom staging → `install` card | `G-LRN-10` (a detector event yields a staged draft with `{drafted, certified, broke}` counts) | drafts certify at 100 % |
| M2.7 Field run | `gnomon spawn 4 --contract <this spec>` on a real repo, mixed `model: any`, driven and decided from the GUI | `T-FLD-01`, `T-FLD-02` | zero KNOTs ⇒ concurrency not produced |

Pass: first KNOT in Warpline's history, hydrated, zero skin-scoped W3; progress diagram moves with no human edit; at least one node built by a local model.

### 19.3 Move 3 — learning loop live, knowledge search, first-party mods, Conductor (`$move-3`)

M3.7–M3.9 depend only on Move 1 (GUI, mod host, kit) and may start in parallel with Move 2; they are placed here so the foundation is proven before the expressive layer lands on it.

| Task | Scope | Acceptance oracles | Falsifier |
|---|---|---|---|
| M3.1 `#learning-loop` credit | `inject.receipt`, `credit`, `broke`, projection, ranking, restricted exploration slot | `G-LRN-01..03` | seeded entries hold ≥ 75 % of credit at week 4 |
| M3.2 Detectors + loop ledger | deterministic detectors; `loop.row`; thrash pause k=3 | `G-LRN-04` | a loop runs past cap |
| M3.3 `tend` + reader + liveness | deterministic passes over every knowledge provider; LLM under permit; digest; reader; violations in the Shuttle view | `G-LRN-05..07` | tend mutates T0/T1 without a card |
| M3.4 Reviewer calibration | `(repo, mode)` rows; `uncalibrated` flag | `G-LRN-08`, `G-LRN-09` | pooled |
| M3.5 Shuttle view polish + optional Mod band | GUI status slot complete; Mod band if `T-SHU-01` passed | `G-SHU-02`, `G-SHU-03` | band reads a file or decides |
| M3.6 Conductor + clients render | `GnomonClient.swift`; delete `ClaudeStreamSession.swift`; Atrium blocks; Symphony onto the log; Conductor passes conformance | `G-MIG-02`, `G-CLI-01` | two UIs disagree |
| M3.7 `#knowledge-query` | provider interface + registry; providers for notebooks, neurons, lore, decisions, Steward memory, doodles; envelope with provenance/tier/`source_hash`; receipts; `gnomon-mods` tool, `paradigm_retrieve` extension, palette `/knowledge` + `/doodles`, CLI | `G-KNW-01..03` | a hit without provenance reaches a model |
| M3.8 `#gnome-persona-mod` | Tier 0 templates; Tier 2 tail skill; STE voice rules + forbidden defaults; kernel-event emotes; `persona:v1` with live `persona.get\|set\|preview`; papercraft/phosphor bodies; honesty copy; measurements | `G-GNM-01..03`, `T-GNM-01` | a line invents a number, or a card is read back in the gnome's words |
| M3.9 `#doodle-mod` + `$doodle-session` | `kit.Canvas` surface in the GUI on Excalidraw with the pure element→shape mapping; session events, ops, keyframes, branch, scrub rail over ops/chat/voice, `gnomon doodle replay\|fsck\|reindex`; `doodle.view`/`doodle.draw` tools with ownership + budget; screenshot secret scan + redaction; lore compaction + exports; `doodle:` resolver + FTS provider | `G-DDL-01..04`, `T-DDL-01` | a known key pattern reaches `session.send` unredacted; a fold hash is not reproducible |

Pass: `gnomon replay` reproduces kernel-controlled inputs; `install → uninstall` diff empty; the 384/396 number changes for a replayable reason; "check the doodles for X" returns a moment whose ref resolves and whose replay shows the mark and the sentence spoken when it was made.

### 19.4 Move 4 — voice (`$move-4`)

Argued as its own move: it depends only on Move 1 (kernel, GUI, local runner) and can start in parallel with Move 2, but its hardware work (AEC, latency, Windows capture) should not gate the armada or the loop, and its lore records are consumed by Move 3's reader.

| Task | Scope | Acceptance oracles | Falsifier |
|---|---|---|---|
| M4.1 Engines | sherpa-onnx VAD/STT/TTS/diarization on both OS; capture library chosen; FluidAudio optional backend; `VoiceEngine` probe | `G-VOX-01` | engines fail the probe on Windows |
| M4.2 PTT + conversation mode | barge-in, truncation, AEC/headphones gate, local-ack bridge, speakable summaries (the gnome line as `textPlanned` when the persona mod is on), mic indicator in the Shuttle view | `G-VOX-02`, `G-VOX-07`, `T-VOX-01` | p95 > 800 ms local after tuning |
| M4.3 Events, principal + log | `voice.*` as a userland grant to `p:<ns>/voice`; voice device key; enrolment/forget rows; forwarding default; retention | `G-VOX-04..06` | audio kept by default, or a decision made by speech |
| M4.4 Lore compaction + export | session-end record linked to raw turns; text-only redacted export with consent; voice turns on the Doodle scrub rail | `G-VOX-03` | links do not resolve |

Pass: a spoken conversation with a local agent and with Claude (text-bridged), on both OS, producing a lore record the GUI can open.

---

## 20. Falsifiers, telemetry gates, kill criteria

Telemetry gates: `T-SHU-01` Mod holds a socket (optional) · `T-LOG-05` 30 days without an un-enveloped Gnomon-sealed strand · `T-FLD-01` ≥ 1 KNOT hydrated, zero skin-scoped W3 · `T-FLD-02` progress moves with no human edit · `T-VOX-01` voice-to-voice p95 < 800 ms local · `T-GUI-01` founder's daily driver is the GUI after two weeks (≥ 70 % of Gnomon-managed sessions opened from it) · `T-LCL-01` ≥ 1 real automation per day runs `model: local` without fallback · `T-GNM-01` choice-picked vs typed follow-ups, `raw` open rate and closing-prose delta, reported with method · `T-DDL-01` doodles opened per week, ops and exports per doodle.

Falsifiers: 1 daemon adoption (two weeks, > 50 % of real sessions outside the kernel) · 2 kernel creep (`G-KRN-02`) · 3 stream-json drift (> 1 breaking change/month) · 4 sixth ledger (`T-LOG-05`) · 5 empty denominator (`T-FLD-01` zero) · 6 learning (week-4 credited reuse < 25 %, 100 % certification survival, or both liveness gates at zero) · 7 shell (`T-GUI-01` fails: the founder keeps opening Claude Code interactively for Gnomon work) · 8 local lane (`T-LCL-01` fails for a month after the probe said capable) · 9 performance (idle RSS > 150 MB, append p99 > 5 ms, GUI keystroke-to-paint > 50 ms at 200k events) · 10 accepted-risk tripwire, stated honestly: the detector catches `approval.decide` events whose `presence` class is wrong for their kind, whose `cli` ancestry contains a session, or `billing.api.active` without a root-signed card the founder signed — it cannot catch a decision made from a TTY'd process, or from a stolen GUI token, inside a cached unlock window (§A.1's accepted residual); any detection ⇒ founder-only mode ends and §A revisit work is pulled forward · 11 Windows parity (`G-WIN-05` reports an `n/a` row without a reason, or a Move pass fails on Windows only) · 12 client-API churn (`clientApiId` changes more than once per release, or a community client breaks on a patch release) · 13 expressive layer over instrument (the Workshop or the gnome stage becomes what the founder watches instead of the transcript and stack: `raw` open rate falls while lines shown rise — both default to off-able and the measurement is `T-GNM-01`).

Kill criteria: (a) falsifier 1 or 7 trips twice running; (b) falsifier 3 trips and plugin-side integration cannot enforce permits or law 7; (c) the founder's honest read after Move 2 is that Claude Code alone with native Task and worktrees did the work better; (d) no local model can complete a real automation after Move 1 on either machine (the owned-harness justification fails); (e) the localhost web model cannot pass `G-WEB-01..06` on both OS — then the GUI ships only inside the desktop wrapper and the browser path is removed, not weakened.

---

## 21. 8.1 for teams (from 18)

Team trust set (cross-signed roots; `signer` already on rows) · signed log-segment exchange between colleagues' kernels, merged by causal order (`logId` + `audience` already in the envelope) · shared Warpline fabric as the team's verifiable state of record · approver roles + quorum (`approverPolicy` already on cards) · unattended grants (QM: never inherited; delegated messages are data) · credential broker + egress proxy · per-person/team cost rollups from metered permits (`org`/`team` already in scope) · read-only share snapshots with revocable links · voice transcripts shared text-only with consent · shared doodles as an `audience` projection with a CRDT layer (Automerge for its history fit) when the first colleague appears, and multi-human presence on the sheet · Gnomon as a QM decision provider and merge gate; neurons as a QM memory provider ("QM swarms admit they cannot merge") · launchd/Task Scheduler/service activation · containers on a separate host for oracles · Claude-Code-to-local-endpoint if Claude Code gains a first-party local mode (D37) · desktop wrapper distributed through the stores (notarized, signed) · a community mod registry with the `signed:<gkey>` tier and a conformance badge for community GUIs (nevr.land) · an envelope-contribution RPC for persona instructions if the skill route proves unreliable · Windows `full` sandbox via AppContainer/LowBox · a shorter or GUI-session-bound approvals unlock window if §A.1's trigger fires.

---

## 22. OPEN questions

1. OPEN: the founder's macOS Developer ID signing identity (and notarization) for `gnomon-helper` — Secure Enclave access and the data-protection keychain need an entitled, signed binary; without it the macOS key work in M1.1 cannot ship; the same identity signs the optional desktop wrapper.
2. CLOSED (D37): Claude-Code-to-local-endpoint probe — dropped; loopback override is a `G-SUB-01` case.
3. OPEN: Windows helper shape — N-API addon vs small signed .NET exe — now also covering `KeyCredentialManager`/NCrypt, pipe creation, job objects, ACLs, anchors, `ShellExecute` for the browser launch; and whether AppContainer/LowBox read-denial is reachable for the `session`/`mod` profiles in 8.0 (else `partial` stands).
4. OPEN: cross-platform audio capture library for Node (CoreAudio/WASAPI) and whether platform AEC is reachable from it; headphones are the documented requirement for conversation mode otherwise.
5. OPEN: `sandbox-exec` deprecation path on macOS — Endpoint Security / App Sandbox alternatives if a macOS release removes it.
6. OPEN: how the fuse learns the subscription window shape (rate-limit headers vs `quota.error` observation only) — measured in Move 1; until known, the human reserve is a fixed 30 %.
7. OPEN (8.1 blocker, lore L-2026-10-16-ascend-070808-001): confirm Anthropic's terms permit distributing a harness that drives users' subscription Claude Code headless; 8.0 is the founder's own subscription on his own machines.
8. OPEN (settled in M1.0, P8-D18): hook stdin `session_id` on 2.1.288+; `--setting-sources` flag semantics; Mod outbound sockets (optional band); Linux anchor and endpoint when `$XDG_RUNTIME_DIR` is unset (Linux follows macOS otherwise); default-browser launch on both OS.
9. OPEN: the aesthetic session (`.atelier/sessions/2026-10-15-gnomon-aesthetic`) is paused for deep UX-design research feeding the Atelier playbook; its open boards are the GUI's remaining design questions — colour (soft project hues + a failure colour), type (papercraft serif vs all-mono), motion specs (including the paper fly-in for decisions), CLI voice, and the rendered decision-stack + left-sidebar; the pitch page follows the resumed session (P8-D19).
10. OPEN: the desktop wrapper — Tauri is recommended (macOS + Windows); undecided whether it ships in 8.0 after the Move 1 pass or in 8.1; WebView origin strings per platform (`tauri://localhost`, `http://tauri.localhost`) to be confirmed against the Tauri version pinned; store distribution is 8.1.
11. OPEN (gnome persona): default posture (dialog line on, stage off is proposed); one mod or two — whether the gnome stage is the Workshop view grown a body or a sibling sharing `persona:v1`; whether the Tier 2 tail-as-skill route is reliable enough for 8.0 or an envelope-contribution RPC is worth an ABI bump in 8.1; names for the default personas, or none.
12. OPEN (Doodle): the local OCR engine for the screenshot secret scan (a WASM Tesseract-class engine is unverified) and whether OCR runs on every placed image or only when the pattern scan asks; Excalidraw's bundle and React cost inside the GUI (measured in M1.0); branch merge (replay-as-new-ops is proposed; a three-way merge with a conflict card is not); who owns the Atelier `findings.yaml` shape that redlines export into; whether agent-opened sheets are proposals or forbidden in 8.0.
13. OPEN (knowledge search): the provider registry's home — `paradigm_retrieve` grows providers (proposed) or a new userland `knowledge` package that notebooks, neurons, lore, decisions and doodles all plug into; the Steward-memory provider's tier and consent model; whether voice `textSpoken` is copied into the doodle index or only referenced (retention rules differ).

---

## A. Accepted risks (founder-only 8.0; each with a revisit trigger)

### A.1 Approvals and the cached unlock (P8-D38 supersedes the key-file part of P8-D12)

No approval-capable key is on disk any more: root and approvals keys are non-exportable hardware keys with presence (D39), which closes the C1/H1 escape class Aegis rated critical ("read `approve.key`"). What remains accepted: (a) the approvals key stays unlocked in kernel memory for up to 15 idle minutes after a GUI session attaches, so a same-user process that reaches the socket with a valid device key — or the loopback endpoint with a stolen GUI token — during that window can obtain a **cached-class** decision (`tool.permission`, `ask-user`, `plan`) — never a fresh-presence class (gate-class, install, KNOT resolve, verdict, cloud fallback, budget resume, api-token); (b) the shell-ancestry check that flags such decisions is evaded by a process with its own TTY; (c) on Windows, read-denial inside sandboxes is `partial` until the helper's AppContainer path is proven, so a sandboxed session could read the device key (not an approval key) and reach the socket as the device; (d) the launch token lives for 60 s in the launching CLI's memory and in the browser's URL fragment, and the GUI token in page memory for the GUI session's life (§11.2). Mitigations: `presence` class and `cli` provenance on every decision; `approval.suspect`; mandatory signatures and two anchors; kernel-owned namespaces. Honest scope: detectable and attributable to "a process on this device during an unlock window", not prevented (`G-HON-06` enforces wording). Revisit trigger: before any second human, shared fabric, or 8.1 — and immediately on falsifier §20.10 — shorten or remove the cached window, or bind cached decisions to the GUI session's connection only.

### A.2 Sandbox profiles, not containers (P8-D13; Windows per P8-R4)

Oracles and reviewer run under default-deny `sandbox-exec` profiles on macOS (deprecated by Apple, functional, escape-tested) and under a restricted-token + ACL + job-object backend on Windows modeled on deepseek-harness's rung (which itself reports `full|partial` and documents why AppContainer and mxc were rejected). Neither is a container; a profile that cannot be applied refuses rather than degrades. The reviewer profile is weaker than the oracle profile (Keychain/Credential Manager reachable for Claude's OAuth; Anthropic egress through the kernel's loopback proxy). Sessions are sandboxed for key access, settings writes and launcher escapes; mods run default-deny. Aegis's dissent (jobs never on the key-holding box) stands recorded. Revisit trigger: as A.1, plus any public repo or untrusted contributor; target = rootless containers on a separate host (TD-735 §7).

### A.3 Windows fidelity

`WRITE_RESTRICTED` tokens restrict writes, not reads (S22-H8): until the signed helper proves an AppContainer/LowBox or dedicated-SID read-denial path and its tests are green on a Windows runner, Windows `session`/`mod`/`oracle` profiles report `partial` in `status`, every oracle refuses to run (§15.5 rule), and the key split's "sessions cannot read keys" holds on Windows only for the hardware-backed root/approvals keys (unreadable by construction), not for the Ed25519 device/agent key files. Accepted for the founder's own Windows machine; 8.1 requires `full`.

---

## Appendix A — expected compile of this spec (compile: skip)

Regenerated by the checker that implements §7.1 (including the suffixed-range rule). `deps: []` everywhere; `Deliverable: release-gate` in §18; `exists`, `admission`, `reviewer` implicit on every node; `gate-check` on gates; `ripple-clean` on flows.

| ref | kind | section | test oracles |
|---|---|---|---|
| `sym:#approval-broker` | symbol | 2.1 | G-BRK-01, G-BRK-02, G-BRK-03, G-BRK-04, G-BUD-01, G-BUD-02, G-BUD-03, G-KRN-01, G-KRN-02, G-LAW-01, G-LAW-01b, G-SEC-01, G-SUB-01, G-SUB-02, G-SUB-03, G-SUB-04 |
| `sym:#backend-adapter` | symbol | 2.2 | G-ADP-01, G-ADP-02, G-GUI-05 |
| `sym:#budget-fuse` | symbol | 2.1 | G-BRK-01, G-BRK-02, G-BRK-03, G-BRK-04, G-BUD-01, G-BUD-02, G-BUD-03, G-KRN-01, G-KRN-02, G-LAW-01, G-LAW-01b, G-SEC-01, G-SUB-01, G-SUB-02, G-SUB-03, G-SUB-04 |
| `sym:#claude-adapter` | symbol | 2.1 | G-ADP-01, G-ADP-02, G-GUI-05, G-KRN-01, G-KRN-02, G-LCL-06, G-RUN-01, G-RUN-02, G-RUN-03, G-RUN-05, G-RUN-06, G-SBX-01, G-SBX-02, G-SBX-03, G-SBX-04, G-SBX-05, G-SBX-06, G-SEC-01, G-SUB-01, G-SUB-05, G-SUB-06 |
| `sym:#contracts-compiler` | symbol | 2.1 | G-CTR-01, G-CTR-02, G-CTR-07, G-HON-01, G-KRN-01, G-KRN-02, G-SEC-01 |
| `sym:#doodle-mod` | symbol | 2.1 | G-DDL-01, G-DDL-02, G-DDL-03, G-DDL-04, G-KRN-01, G-KRN-02, G-SEC-01 |
| `sym:#gnome-persona-mod` | symbol | 2.1 | G-GNM-01, G-GNM-02, G-GNM-03, G-KRN-01, G-KRN-02, G-SEC-01 |
| `sym:#gnomon-kernel` | symbol | 2.1 | G-KRN-01, G-KRN-02, G-SEC-01 |
| `sym:#gnomon-voice` | symbol | 2.1 | G-ADP-01, G-ADP-02, G-GUI-05, G-KRN-01, G-KRN-02, G-SEC-01, G-VOX-01, G-VOX-02, G-VOX-03, G-VOX-04, G-VOX-05, G-VOX-06, G-VOX-07 |
| `sym:#gui` | symbol | 1 | G-ADP-01, G-ADP-02, G-GUI-01, G-GUI-02, G-GUI-03, G-GUI-04, G-GUI-05, G-GUI-06, G-GUI-07, G-GUI-08, G-GUI-09, G-GUI-10, G-HON-07, G-KRN-01, G-KRN-02, G-SEC-01, G-WEB-01, G-WEB-02, G-WEB-03, G-WEB-04, G-WEB-05, G-WEB-06 |
| `sym:#identity` | symbol | 2.1 | G-ID-01, G-ID-02, G-ID-03, G-ID-04, G-ID-05, G-ID-06, G-ID-07, G-KRN-01, G-KRN-02, G-SEC-01 |
| `sym:#kernel-log` | symbol | 2.1 | G-KRN-01, G-KRN-02, G-LOG-01, G-LOG-02, G-LOG-03, G-LOG-04, G-LOG-06, G-LOG-07, G-LOG-08, G-SEC-01 |
| `sym:#knowledge-query` | symbol | 2.1 | G-KNW-01, G-KNW-02, G-KNW-03, G-KRN-01, G-KRN-02, G-SEC-01 |
| `sym:#learning-loop` | symbol | 2.1 | G-KRN-01, G-KRN-02, G-LRN-01, G-LRN-02, G-LRN-03, G-SEC-01 |
| `sym:#local-runner` | symbol | 2.1 | G-ADP-01, G-ADP-02, G-GUI-05, G-HON-07, G-KRN-01, G-KRN-02, G-LAW-01c, G-LCL-01, G-LCL-02, G-LCL-03, G-LCL-04, G-LCL-06, G-SEC-01, G-SUB-01, G-SUB-06, G-VOX-02 |
| `sym:#manifest-loader` | symbol | 2.1 | G-HON-04, G-KRN-01, G-KRN-02, G-LAW-04, G-MAN-01, G-MAN-02, G-MAN-03, G-SEC-01 |
| `sym:#mod-host` | symbol | 2.1 | G-KRN-01, G-KRN-02, G-MOD-01, G-MOD-02, G-MOD-03, G-MOD-04, G-MOD-05, G-MOD-06, G-MOD-07, G-MOD-08, G-MOD-09, G-MOD-10, G-SEC-01, G-WSP-01 |
| `sym:#oracle-sandbox` | symbol | 2.1 | G-CTR-04, G-CTR-05, G-CTR-06, G-CTR-08, G-CTR-09, G-KRN-01, G-KRN-02, G-SBX-07, G-SEC-01 |
| `sym:#ref-resolver` | symbol | 2.1 | G-KRN-01, G-KRN-02, G-SEC-01 |
| `sym:#scheduler` | symbol | 2.1 | G-DMN-01, G-DMN-02, G-DMN-03, G-DMN-04, G-DMN-05, G-KRN-01, G-KRN-02, G-LAW-05, G-LAW-05b, G-SCH-01, G-SEC-01 |
| `sym:#session-runner` | symbol | 2.1 | G-ADP-01, G-KRN-01, G-KRN-02, G-RUN-01, G-RUN-02, G-RUN-03, G-RUN-05, G-RUN-06, G-SBX-01, G-SBX-02, G-SBX-03, G-SBX-04, G-SBX-05, G-SBX-06, G-SEC-01, G-SUB-01, G-SUB-05 |
| `sym:#socket` | symbol | 2.1 | G-ABI-01, G-ABI-02, G-ABI-03, G-ABI-04, G-ABI-05, G-KRN-01, G-KRN-02, G-SEC-01, G-SOCK-01, G-SOCK-02, G-SOCK-03, G-SOCK-04, G-WEB-01, G-WEB-02, G-WEB-03, G-WEB-04, G-WEB-05, G-WEB-06 |
| `sym:#supervisor` | symbol | 2.1 | G-ADP-01, G-KRN-01, G-KRN-02, G-RUN-01, G-RUN-02, G-RUN-03, G-RUN-05, G-RUN-06, G-SBX-01, G-SBX-02, G-SBX-03, G-SBX-04, G-SBX-05, G-SBX-06, G-SEC-01, G-SUB-01, G-SUB-05 |
| `sym:#web-endpoint` | symbol | 2.1 | G-ABI-01, G-ABI-02, G-ABI-03, G-ABI-04, G-ABI-05, G-GUI-07, G-KRN-01, G-KRN-02, G-SEC-01, G-SOCK-01, G-SOCK-02, G-SOCK-03, G-SOCK-04, G-WEB-01, G-WEB-02, G-WEB-03, G-WEB-04, G-WEB-05, G-WEB-06 |
| `sym:#workshop-mod` | symbol | 2.1 | G-KRN-01, G-KRN-02, G-MOD-01, G-MOD-02, G-MOD-03, G-MOD-04, G-MOD-05, G-MOD-06, G-MOD-07, G-MOD-08, G-MOD-09, G-MOD-10, G-SEC-01, G-WSP-01 |
| `sym:$daemon-lifecycle` | flow | 2.4 | G-DMN-01, G-DMN-02, G-DMN-03, G-DMN-04, G-DMN-05, G-LAW-05, G-LAW-05b, G-SCH-01 |
| `sym:$doodle-session` | flow | 12.7 | G-DDL-01, G-DDL-02, G-DDL-03, G-DDL-04 |
| `sym:$move-1` | flow | 19.1 | G-ABI-01, G-ABI-02, G-ABI-03, G-ABI-04, G-ABI-05, G-ADP-01, G-ADP-02, G-BRK-01, G-BRK-02, G-BRK-03, G-BRK-04, G-BUD-01, G-BUD-02, G-BUD-03, G-CLI-01, G-CLI-02, G-CLI-03, G-CON-01, G-CON-02, G-DMN-01, G-DMN-02, G-DMN-03, G-DMN-04, G-DMN-05, G-GUI-01, G-GUI-02, G-GUI-03, G-GUI-04, G-GUI-05, G-GUI-06, G-GUI-07, G-GUI-08, G-GUI-09, G-GUI-10, G-HLP-01, G-HON-02, G-HON-03, G-HON-04, G-HON-05, G-HON-06, G-HON-07, G-ID-01, G-ID-02, G-ID-03, G-ID-04, G-ID-05, G-ID-06, G-ID-07, G-KRN-01, G-KRN-02, G-LAW-01, G-LAW-01b, G-LAW-01c, G-LAW-04, G-LAW-05, G-LAW-05b, G-LCL-01, G-LCL-02, G-LCL-03, G-LCL-04, G-LCL-06, G-LOG-01, G-LOG-02, G-LOG-03, G-LOG-04, G-LOG-06, G-LOG-07, G-LOG-08, G-MAN-01, G-MAN-02, G-MAN-03, G-MOD-01, G-MOD-02, G-MOD-03, G-MOD-04, G-MOD-05, G-MOD-06, G-MOD-07, G-MOD-08, G-MOD-09, G-MOD-10, G-OBS-01, G-RUN-01, G-RUN-02, G-RUN-03, G-RUN-04, G-RUN-05, G-RUN-06, G-SBX-01, G-SBX-02, G-SBX-03, G-SBX-04, G-SBX-05, G-SBX-06, G-SCH-01, G-SEC-01, G-SEC-02, G-SOCK-01, G-SOCK-02, G-SOCK-03, G-SOCK-04, G-SUB-01, G-SUB-02, G-SUB-03, G-SUB-04, G-SUB-05, G-SUB-06, G-WEB-01, G-WEB-02, G-WEB-03, G-WEB-04, G-WEB-05, G-WEB-06, G-WIN-01, G-WIN-03, G-WSP-01 |
| `sym:$move-2` | flow | 19.2 | G-CTR-01, G-CTR-02, G-CTR-03, G-CTR-04, G-CTR-05, G-CTR-06, G-CTR-07, G-CTR-08, G-CTR-09, G-GIT-01, G-GIT-02, G-GIT-03, G-HON-01, G-LRN-10, G-SBX-07, G-SPN-01, G-SPN-02, G-SPN-03, G-SPN-04, G-SPN-05, G-SPN-06, G-SPN-07 |
| `sym:$move-3` | flow | 19.3 | G-CLI-01, G-DDL-01, G-DDL-02, G-DDL-03, G-DDL-04, G-GNM-01, G-GNM-02, G-GNM-03, G-KNW-01, G-KNW-02, G-KNW-03, G-LRN-01, G-LRN-02, G-LRN-03, G-LRN-04, G-LRN-05, G-LRN-06, G-LRN-07, G-LRN-08, G-LRN-09, G-MIG-02, G-SHU-02, G-SHU-03 |
| `sym:$move-4` | flow | 19.4 | G-VOX-01, G-VOX-02, G-VOX-03, G-VOX-04, G-VOX-05, G-VOX-06, G-VOX-07 |
| `sym:$spawn` | flow | 6 | G-SPN-05, G-SPN-06 |
| `sym:$voice-turn` | flow | 14.2 | G-HON-07, G-VOX-02 |
| `sym:^certified` | gate | 7.3 | G-CTR-04, G-CTR-05, G-CTR-06, G-CTR-08, G-CTR-09 |
| `sym:^subscription-only` | gate | 10 | G-SUB-01, G-SUB-02, G-SUB-03, G-SUB-04, G-SUB-05, G-SUB-06 |
| `sym:~ample-internal-logs` | aspect | 9 | G-ABI-05, G-HON-01, G-HON-02, G-HON-03, G-HON-04, G-HON-05, G-HON-06, G-HON-07 |
| `sym:~windows-parity` | aspect | preamble | G-DMN-03, G-GUI-03, G-HON-01, G-LCL-01, G-LOG-06, G-MOD-08, G-RUN-03, G-SEC-02, G-SUB-01, G-VOX-01, G-WEB-01, G-WEB-02, G-WEB-03, G-WEB-04, G-WEB-05, G-WEB-06, G-WIN-01, G-WIN-02, G-WIN-03, G-WIN-04, G-WIN-05, G-WIN-06 |
| `doc:release-gate` | doc | 18 | `orphanTests` (54): G-ABI-01, G-ABI-02, G-ABI-03, G-ABI-04, G-CLI-02, G-CLI-03, G-CON-01, G-CON-02, G-GUI-07, G-HON-01, G-HON-02, G-HON-03, G-HON-04, G-HON-05, G-HON-06, G-HON-07, G-KRN-02, G-LAW-01, G-LAW-01b, G-LAW-01c, G-LAW-04, G-LAW-05, G-LAW-05b, G-LAW-06, G-MIG-01, G-MIG-02, G-MOD-01, G-MOD-02, G-MOD-03, G-MOD-04, G-MOD-05, G-MOD-06, G-MOD-07, G-MOD-08, G-MOD-09, G-MOD-10, G-RUN-04, G-SBX-04, G-SBX-04w, G-SBX-05, G-SBX-05w, G-SBX-06, G-SBX-06w, G-SEC-01, G-SEC-02, G-SUB-01, G-SUB-05, G-WEB-01, G-WEB-02, G-WEB-03, G-WEB-04, G-WEB-05, G-WEB-06, G-WIN-05 |

Notes for the compiler author: 37 symbol/flow/gate/aspect nodes + 1 doc node = 38; no signals are declared. §2.1's table is the first appearance of most symbols — including `#web-endpoint`, `#workshop-mod`, `#gnome-persona-mod`, `#doodle-mod` and `#knowledge-query` — and `G-KRN-01`, `G-KRN-02` and `G-SEC-01` sit in §2.1 prose, so they bind to every node mentioned there (section-level rule). `#gui` first appears in §1 (non-goals); `#backend-adapter` in §2.2, whose bullets also name `#gui`, `#gnomon-voice`, `#claude-adapter` and `#local-runner`, so `G-ADP-01`, `G-ADP-02` and `G-GUI-05` land on all five; `~windows-parity` in the preamble's platform rule (which is why it carries `G-HON-01`); `$voice-turn` in the §14.2 heading, whose ids (`G-VOX-02`, `G-HON-07`) also land on `#local-runner`, named in that section; `$doodle-session` in the §12.7 heading beside `#doodle-mod`, so both carry `G-DDL-01..04`. §7.3's certification paragraph is prose, so its ids bind to every node mentioned in §7.3 — `^certified` and `#oracle-sandbox` (named in the `test` row). §8.10's heading names `#knowledge-query`, so `G-KNW-01..03` bind there alone. Inside §11, only §11.2 (`#web-endpoint`) and §11.6 (`#workshop-mod`) name a node; every other §11 subsection takes the ancestor path to §11's heading node `#gui`, which is why `#gui` carries `G-WEB-01..06` and `G-HON-07` (from the §11.7 falsifier list) and `#web-endpoint` carries `G-GUI-07` (from rule 6). §12.5's prose names `#mod-host` (`G-MOD-08`, `G-MOD-09`); §12.6 names `#gnome-persona-mod` (`G-GNM-01..03`); §12.2, §12.3, §12.4 and §12.8 name no node and have no noded ancestor, so their ids are orphans. §19.x tables bind row-by-row (Scope spans) plus the `$move-N` heading node, which is why `#socket` and `#web-endpoint` share M1.4's ids (incl. `G-WEB-*`), `#mod-host` and `#workshop-mod` share M1.11's (`G-MOD-01..10`, `G-WSP-01`), `#oracle-sandbox` carries M2.3's, `#learning-loop` M3.1's, `#knowledge-query`, `#gnome-persona-mod` and `#doodle-mod` M3.7–M3.9's, `#scheduler` and `$daemon-lifecycle` share M1.9's, and `#session-runner`, `#supervisor` and `#claude-adapter` share M1.7's. §13.2's `G-SUB-01` and §9.7's `G-HON-*` reach `#local-runner` and `~ample-internal-logs` through their parent headings (ancestor rule). §10's law table has no heading node, so rows without a node span (laws 1–6) take the ancestor path to `orphanTests`, while the law-7 row binds its `G-SUB-*` ids to `^subscription-only`; §16's table binds through its `~windows-parity` heading (now also `G-GUI-03`, `G-WEB-01..06`, `G-MOD-08`); §15.1's row 16 names `#web-endpoint` and binds `G-WEB-01..06` + `G-GUI-07` to it, while its other rows are orphans. §4.9's WebSocket paragraph names `#web-endpoint` but carries no id. §5, §12.2–12.4, §12.8, §15.1 (rows without a span), §15.5, §17, §18's `Deliverable:` line, §22 and §A.1 mention ids in sections with no node and no noded ancestor, so those ids are orphans. The suffixed range `G-SBX-04w..06w` appears only in §15.5 (and in §0, which is skipped) and expands with its suffix; §7.1 rule 4 names the ordinals rather than an id on purpose, so the rule's example does not bind to `#contracts-compiler`. `T-` ids are telemetry, never oracles. §0 (with §0.1 inside it) and this appendix are skipped; the `Deliverable:` line is in §18.
