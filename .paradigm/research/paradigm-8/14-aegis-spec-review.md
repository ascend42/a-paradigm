# Aegis — security review of docs/specs/gnomon.md (2026-10-15)

Orchestrator spot-checked: gnomon.md:95 "latest row wins per principal"; :105 human mint gated by "possession of the box"; :449 test oracle runs "under its own principal" in the worktree; :609 "session principals structurally cannot authenticate as human"; agent-shell.ts:26-29 admits WARPLINE_AGENT_ID is unsigned and unsettable.

Core finding: the spec treats files and CLI commands as the human/agent boundary, but every spawned agent runs as the same OS user with Bash. gnomon.md:609 is false as written.

## Critical
- C1 Bash = "possession of the box" (105, 371, 621): agents can run `gnomon key mint --kind human`, `trust`, `install`, `daemon stop`, or read `~/.gnomon/keys/p-ascend.key` and approve their own budget/KNOT/verdict cards. String-matched Read/Bash deny rules are bypassable (python -c, script on disk, env -u). Fix: S4 before Move 1 — human key in macOS Keychain/Secure Enclave with user presence per signature; human signs each approve over (cardId, decision, cardContentHash). Move 1's 5-session fan-out is a multi-instance run, so TD-735 §4 (S1+S4 first) applies.
- C2 Registry "latest row wins" (95): an agent appends a row binding p:ascend to its own key. Fix: TD-735 §5 — human root key signs every registry and grants row; unsigned rows refused.
- C3 Oracles run repo code on the key-holding box (449, 633): test oracle runs agent-written code as p:kernel with daemon env/fs/network. Contradicts TD-735 §7 (rootless containers, no network, no secrets). Fix: rootless container (minimum sandbox-exec denying ~/.gnomon, ~/.ssh, keychain, egress), scrubbed env, worktree read-only.
- C4 Project files set security policy (410, 423): `.gnomon/project.yaml` `mode` and `ci` are agent-writable (`ci: "true"`, `mode: none`). Fix: read from the base revision (selvage/main); diffs touching .gnomon/, test config, package scripts or pipeline files are gate-class → human card.

## High
- H1 Kernel log detects accidents, not forgery (120-127, 247): sqlite3 DROP TRIGGER + rewrite + re-chain; signatures optional; deleting kernel.db likely resets budget. Fix: mandatory signatures on approval.*, oracle.result, budget.*, permits; anchor chain head outside the db; missing db with keys present = INTEGRITY_BROKEN.
- H2 Fuse misses spend paths (187, 405, 581): Bash `claude -p` directly; Task fan-out within a turn unmetered until turn.result; respawns not charged; agent-writable ~/.gnomon/config.yaml; GNOMON_HOME second daemon. Fix: meter per-message usage from stream-json, kill the process group on breach, charge respawns, sign config, fuzz files in G-LAW-01b.
- H3 Socket activation inherits the activating client's env (76): NODE_OPTIONS/PATH/GNOMON_HOME poisoning of the key-holding process. Fix: re-exec with fixed clean env; resolve claude from a configured path.
- H4 Per-connection auth binding only the nonce (353-359): socket relay/MITM; predictable /tmp fallback on Linux (75); Node has no peer-credential API; ~/.gnomon perms unspecified. Fix: mutual auth, client signs nonce‖serverKeyId‖principal‖socket realpath; ~/.gnomon 0700; per-approval signatures.
- H5 Warpline deny list incomplete/advisory (414): `.warpline/daemon-tokens.jsonl` and `.warpline/daemon/mcp-tokens.json` not denied; `env -u WARPLINE_AGENT_ID warpline resolve` works. G-SPN-06 / "zero W3" count only self-marked attempts (law-2 overclaim). Fix: warplined serves resolve to keyed principals only; state the CLI limit in the falsifier.
- H6 Reviewer key proves nothing (454-456): session keys readable by every session; reviewer gets attacker diff while holding tools. Fix: reviewer keys kernel-memory only; reviewer has no tools, ≤1 turn, diff wrapped as untrusted, strict verdict schema, spec section from base revision.
- H7 Other settings layers widen spawned sessions (155-160): worktree .claude/settings.json (defaultMode, allow, hooks), user plugins/hooks; agent can write the first before --resume. Exact-replay claim (G-KRN-01) and L2 too strong. Fix: limit setting sources; refuse or hash every layer incl. CLAUDE.md and skills.

## Medium
- M1 Derived hsid from public inputs (256, 258) → alias squatting/attribution poisoning. Accept only from the keyId's principal, first registration wins, distinct `hsid:v1d:` form.
- M2 `log.append` of own session.* (379) can forge session.exited (frees slots) or session.inject. Restrict session.* to the supervisor; specify the PermissionRequest hook path (402).
- M3 Subscription redaction inconsistent (363 vs 380). One total matrix, tested.
- M4 Display-block actions (301) from block params. Hosts build actions only from broker-authored cards.
- M5 Mod trust tiers (637) unenforced; Mod JS runs with full user privileges; Shuttle holding human signing (594) while rendering agent text is risky. Move signing to CLI/Keychain prompt.
- M6 Package-manager-as-audit-queue (07:16) missing: agent-written skills/hooks/manifests/teacher.draft need an install card + pinned manifest hash.
- M7 Cold-entry exploration slot (488) guarantees exposure for possibly poisoned new entries; restrict to T0/T1 or human-reviewed. MCP notebook injection never logged as session.inject.

## Low
L1 show exact `always` patterns; L2 day windows immune to wall-clock jumps; L3 headless.py:153 FORBIDDEN_FLAGS via Python assert (stripped by -O) — use a throw; L4 GNOMON_SESSION_KEY in env visible to tool subprocesses — pass by fd or bind to pgid.

## Guards before Move 1
C1–C4, H1, H3, H4, and TD-735 S1/S4 satisfied before the fan-out test.
