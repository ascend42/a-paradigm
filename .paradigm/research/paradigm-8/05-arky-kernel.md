# Arky — harness kernel, structural counterweight (2026-10-15)

Read-only file evidence. Key claims spot-checked by the orchestrator (Conductor `--dangerously-skip-permissions` at ClaudeStreamSession.swift:183; flow `ENV_ALLOW` at headless.py:97 has no WARPLINE_AGENT_ID; stream.jsonl ids `ev-<ms>-<rand>`, 1,211 rows). (inf) = inference.

## Findings that change the picture
- **The three Claude runners already drifted.** flow `headless.py` is strictest (forbids `--dangerously-skip-permissions`, pinned `--session-id`/`--resume`, subscription-only preflight, process-group kill, min CC 2.1.259). constellation `claudeCli.ts` ports it (min 2.1.288). Conductor `ClaudeStreamSession.swift:178-188` passes `--dangerously-skip-permissions`, no session id, full login-shell env — a weaker safety model, not a copy.
- **Paradigm event ids can collide**: `ev-<ms>-<rand>`, no seq, principal or hash chain — fails TD-2026-10-14-735 collision-free ids.
- **flow's ledger is the best log design**: `chain(seq, kind, record_id, at, payload, prev_hash, hash)`, trigger-enforced append-only, rebuildable projections.
- **Warpline gap**: `agent-shell.ts` treats any shell without `WARPLINE_AGENT_ID` as human; flow's env allowlist drops it, so (inf) a flow-spawned session today passes human-only Warpline checks.

## 1. Kernel candidates
1. **Principals + keys** — seed `packages/warpline/src/fabric/keys.ts` (Ed25519, `wlkey:v1`, append-only registry, fail closed) + `daemon/tokens.ts`; generalize to human/agent/session principals, per-user registry + per-repo pins. S1 precondition.
2. **Append-only event log** — flow chain semantics + shared `{seq, at, event}` spool shape; one envelope; foreign ledgers send refs, not migrated. "Model-visible ⟺ logged" is the basis for replay/evals/provenance.
3. **Process/session supervisor** — flow `headless.py` ported to TS (constellation halfway); one backend adapter interface, Claude Code first.
4. **Capability + approval broker** — flow PermissionRequest hook + approvals + per-session `--settings` policy; Warpline HUMAN_ONLY_VERBS, `refusal:v1`, grants. One closed fail-closed approval set.
5. **Manifest + loader** — flow `plugins/registry.py` (kind, name, capabilities, egress) + `families.ts` FAMILY_META tiers. Kernel loads + checks capabilities; contents are userland.
6. **Ref resolver** — kernel owns grammar + resolver registry; resolvers (neurons, symbols, Warpline) are userland.
- Thin scheduler: log-derived timers only; loop policies (Ralph, goals) are userland.
- **Deliberately NOT kernel**: symbol graph, notebooks, lore, calibration, Warpline engine, display UIs. The moat lives in userland packages; that keeps the kernel trustworthy.

## 2. Hard contracts (drafts)
1. Event envelope: `{v:1, id:<ulid>, log, seq, at, principal:<keyId>, session?:<hsid>, kind:"ns.verb", causes:[id], payload|ref, prev:<hash>, sig?}`; foreign ledgers emit `ref.foreign {store, nativeId, hash}`.
2. Session id: kernel-issued `hsid` survives respawns; Claude uuid is an attribute `backend:{kind:"claude-code", uuid, binarySha, version}`.
3. Manifest: `{kind, name, version, compat:{kernel, claudeCode?}, provides:{mcp[], skills[], agents[], hooks[], panels[], steps[], resolvers[], blocks[]}, requires:{capabilities[], egress[]}, config_schema}`; generates plugin.json, .mcp.json, tool families — nothing hand-synced.
4. Ref grammar: `<scheme>:<id>[@rev]`; `# $ ^ ! ~` become aliases of `sym:`; `n:`, `s:`, `TD-`, `L-`, `wl:pick/…`, `wlkey:` registered schemes.
5. Display blocks + refusal: `{block:"ns.type", v, data, actions:[{id, verb, capability}]}` rendered by host; actions are broker events, never direct calls; `refusal:v1` is the kernel's single error shape.

## 3. Claude Code relationship
Both directions, kernel-runs-CC primary: kernel spawns `claude -p` stream-json (supervision, replay, multi-session); the CC plugin becomes a thin client in interactive sessions (hooks + MCP to the kernel daemon). Mods for display only (in-process, admin allowlist). Coupling risk: stream-json is not a published contract — one adapter + conformance tests replayed from recorded transcripts.

## 4. Runtime
TypeScript on Node 24. 4 of 5 repos TS; node:crypto Ed25519, node:sqlite, MCP SDK. JSON-RPC over unix socket; Python/Swift/Rust become clients. Rust rejected for 8.0 (iteration speed). Revisit if idle daemon >150 MB RSS or append p99 >5 ms (inf).

## 5. Migration
Moves: (1) envelope + identity as adapters dual-writing existing ledgers; (2) TS session runner adopted by constellation + Conductor (removes `--dangerously-skip-permissions`); (3) approval broker; (4) manifest-generated plugin files; (5) ref resolver + cross-index.
Never moves: `.purpose`/portal.yaml/symbols, neurons vault, Warpline fabric bytes, flow chain, `~/.claude/projects` transcripts. Kernel indexes, doesn't own. All 7.x CLI/MCP keeps working.

## Warpline-native sessions (founder ask P8-R1)
Userland boot package in the founder's default profile + four kernel duties at spawn:
1. Mint a session principal + key via keys.ts.
2. Set `WARPLINE_AGENT_ID` + key path in the env allowlist.
3. Deny `resolve`, `stake`, `stake.recover`, `backup`, `acceptBreach`, `acceptRisk` in the session `--settings` policy (human boundary procedural, TD-2026-08-23-136).
4. Attach to fabric: worktree, `fork` scratch ref, agent-class daemon token.
Selvage read-only to agents; kernel republishes selvage moves as events so siblings re-predict. PICK/WEAVE/KNOT → daemon `propose`/`admit`/`merge`/`knot.show`; OFFER is spec-only, not yet a daemon verb.
F4 (TD-2026-07-21-766): kernel must NOT inject Warpline teaching; legibility carrier is the `status` result with hash-frozen descriptors (`daemon/descriptors.ts`). At most one pointer line ("run `warpline status`"), else F4 measures the harness, not Warpline.

## 6. Risks + falsifiers
1. Kernel grows into userland (Odysseus 38k-line loop). Falsifier: kernel boots with zero packages and runs one CC session end-to-end with exact replay; any kernel import of symbol graph/notebooks/Warpline engine = violation.
2. stream-json drift breaks the runner. Falsifier: nightly replay of recorded transcripts per `claude` version; >1 breaking change/month ⇒ shift primary integration to plugin side.
3. Log becomes a sixth ledger instead of the only index. Falsifier: after 30 days, any fabric pick or flow chain row without a `ref.foreign` envelope ⇒ bridge failed.
