# Orca audit: what Gnomon should take from it (2026-10-19)

Source: stablyai/orca at commit 3ef5a460, a shallow clone read as untrusted data. Task: T-2026-10-19-007.
Three readers worked in parallel: Arky (process lifecycle), Aegis (trust boundaries) and an IPC/protocol reader.
Paths prefixed `orca:` are in the Orca repo; the rest are Gnomon.

## What Orca is, in one paragraph
Orca is an Electron desktop app that drives about 35 coding agents. The structured ones run with no terminal:
- Claude through the Agent SDK;
- Codex through `app-server` JSON-RPC;
- ACP agents;
- pi through RPC.

About 30 more run as terminal (TUI) apps inside PTYs, and their status comes from hooks, OSC 7501 messages and screen scraping. The PTYs live in a separate daemon that survives app restarts and updates through launchd or systemd. The daemon's wire protocol is at v49, and every older version can still attach.

Processes talk over four kinds of channel:
- about 865 string-named Electron IPC handlers;
- a runtime RPC over a unix socket, a named pipe, or end-to-end-encrypted WebSocket;
- a phone relay through cloud "cells" that pass ciphertext through without decrypting it;
- a SQLite mailbox that lets agents orchestrate each other.

## Ranked takeaways

### Adopt (small, high value)
1. **Kill the whole process tree on stop.** Tool children that `setsid` or daemonize escape a process-group kill. Snapshot the descendants, check each against its start-time witness, and SIGKILL the survivors. Record the tree verdict as `exited | alive | unverifiable`, and never fold "unverifiable" into either of the others. (orca: `session-termination-controller.ts:10-107`, `claude-stream-json-connection.ts:88-98`. Gnomon: `kernel/lifecycle/children.ts:34-35`, process-control.)
2. **Socket ownership: never treat "can't tell" as "dead".** Bind a private name, then link it, then prove the old holder dead by connecting, then rename. Never unlink the socket on close, because Node's `server.close()` unlinks silently. A timeout or EPERM means "decline". Orca retired 23 defects of this one T/T+1 race. (orca: `src/main/daemon/AGENTS.md:13-46`. Gnomon: `pidfile.ts:106` `unlinkStaleSocket`, §2.4 rule 1.) Also create the socket inside a 0700 directory so there is no bind-then-chmod window, and check the peer uid (Aegis).
3. **A readiness handshake plus classified exit codes.** The detached kernel sends `ready{identity}` on an inherited pipe, and the launcher keeps a bounded tail of its stderr. Today the launcher polls 5 × 200 ms. A launcher that loses the race attaches to the winner and does not report an error. Exit codes separate configuration faults from transient ones, so that launchd and Gnomon.app don't restart in a loop. (orca: `daemon-launched-child.ts:117-222`, `orcad/main.ts:36-42`.) Bundle this with the launchd activation work (8.1).
4. **Every RPC method declares a permission tier; deny by default.** Orca's registry refuses a method without a tier, but its caller-scope check still fails open on `permission === undefined` (orca: `rpc-caller-scope.ts:54`). Gnomon should enforce this at registration time and test it.
5. **Deny-safe permission semantics, with an explicit test for each.** An undecodable request is denied. A cancel settles to null and never to allow. A late answer finds no prompt. Gnomon's broker already behaves this way; the work is to pin it with falsifiers. (orca: `claude-structured-inbound-control.ts:15-83`.)
6. **Backpressure watermarks and "delivery unknown" errors** on the GUI WebSocket and the transcript stream (orca: `daemon-stream-backpressure.ts`, `mobile/src/transport/rpc-delivery-ambiguity.ts`).

### Adapt (needs a spec decision or more work)
7. **Sessions that survive a kernel update.** Do not split session ownership out of the law-7 kernel. Instead, drain and hand over: a new kernel adopts live sessions whose `session.spawned` row matches the boot and start-time witnesses. Add per-peer feature gates to `gnomon-rpc:v1` hello. Today a kernel update kills every session. This is the biggest gap in Gnomon's spec.
8. **Journal cursor catch-up** (`{epoch, seq}` paging from the subscriber's cursor to the head), so the GUI can rehydrate quickly after a reconnect instead of replaying the whole log (orca: `agent-session-journal/journal-cursor.ts`).
9. **ACP as a third `#backend-adapter`**, run in its own sandboxed child. Generate its types from the ACP schema and check them with a checksum in CI (orca: `src/main/acp/generated`, `verify:acp-protocol`). That opens Gnomon to grok, opencode and other agents with law 7 and per-backend permits intact.
10. **A guide served by the binary itself** (`gnomon guide <topic>`), so an agent never reads stale docs. This fits F4, legibility for a cold agent (orca: `skills/orchestration/SKILL.md`).
11. **Fenced armada dispatch**: a consumer generation plus typed settlement refusals (`stale_dispatch` and similar), written as kernel-log rows (orca: `runtime/orchestration/types.ts`).
12. **Transcript-bound device proofs with exact-key auth frames** (orca: `mobile-e2ee-auth-validation.ts`) for `#peer-link` and any future phone client.
13. **Open question: approving from a phone vs. Secure Enclave presence.** Orca lets a phone token act as approval authority, with no biometric. Gnomon must decide how a phone could approve, if ever, without weakening presence.

### Avoid
- **Building on the Claude Agent SDK.** It breaks the zero-dependency kernel and byte replay, the SDK takes over the permission channel, and it mutates `process.env` on import (Orca shipped an ANTHROPIC_* env leak). Gnomon's raw stream-json driver is the right choice.
- **A one-click "yolo" bypass and no OS sandbox around agents** (orca: `src/shared/tui-agent-permissions.ts`). If Gnomon ever adds a bypass, it must be per session, Touch-ID-signed and logged.
- **Running agent binaries unpinned, gated only by a `--version` probe.** Keep Gnomon's sha pin plus `repin-claude`.
- **A static owner bearer token, or a full-scope token in agent children's env.** Keep mutual auth and narrow per-launch capabilities.
- **A WebSocket or loopback HTTP endpoint with no Origin/Host check**, and a legacy v1 auth path left next to v2 (a downgrade surface).
- **Agent status from screen scraping sitting on the permission path**, or scraping rules that can be updated remotely.
- **String-named IPC with no runtime validation, and sender checks on only some handlers.**
- **Comparing secrets with `===`.** Gnomon already uses `timingSafeEqual` in `kernel/web/launch.ts` and `kernel/setup/setup-endpoint.ts`; audit the rest of the code for the same.

## What Gnomon already does better
- Signed, attended approvals (Touch ID through the Secure Enclave helper).
- A sandboxed session profile.
- Origin, Host and Sec-Fetch-Site locks.
- A pinned claude binary.
- A hash-chained kernel log.
- A closed setup protocol.
- A zero-dependency kernel.
