# Arky — architecture review of docs/specs/gnomon.md (2026-10-15)

Orchestrator verified: keys.ts:441 mintAgentKey "HUMAN-GATED at the CLI"; warplined verbs (protocol.ts:36-53) have no subscribe verb; protocol.ts:43 `admit` = admitNative | shadowAdmit; STAGE_ORDER defined core/pipeline-types.ts:67, imported pipeline/index.ts:16.

Citations: 19 checked, 16 accurate. Wrong: L438 STAGE_ORDER location; L213 FAMILY_META at families.ts:55; L149 "argv identical on both runners" false (flow lacks --mcp-config/--strict-mcp-config/--append-system-prompt; constellation's strict flag conditional, agents.ts:451); L211 keys.ts:329 minor.

## Boundary (critical)
- L412-413: kernel calling mintAgentKey/minting daemon tokens at spawn imports the Warpline engine (violates G-KRN-02), bypasses the human gate (keys.ts:441, tokens.ts:3-6) and silently pins Warpline's signed-from epoch (keys.ts:466-475). Fix: Warpline principal = stable roster agent (p:arky), key + token pre-minted once by the human; kernel selects the credential and links session→strand by causes[]. Restores I1 (one key = one notebook owner); per-session principals add a registry row per session forever.
- L383 contract.compile as a kernel verb, but compiler is userland. Fix: compile stays in `paradigm pipeline plan`; kernel verb becomes `contract.register{contract}` (schema, hash, non-empty oracles). Still 12 verbs.
- L452 admission oracle runs a real admit → code lands before the reviewer votes; p:kernel isn't a warplined principal. Fix: oracle uses shadowAdmit; real admit only after ^certified.
- §4.6 lifting Refusal verbatim drags AdmitStatus/KnotRule into kernel contracts or an import cycle.

## Schemas
- L246 (critical): hash covers prev/kind/seq/payload only; principal, causes, scope, at, id rewritable. Fix: hash canonical(envelope minus hash/sig).
- L118 AUTOINCREMENT vs hashed seq + rollback gaps. Assign seq in the write txn (flow sqlite.py:947-951).
- L244 payload XOR ref vs kinds needing both; three foreign-ref shapes (L129, L244, L243). One `ref:v1` string + optional hash, allowed alongside payload.
- Envelope `v:1` vs `schemaVersion` elsewhere; no connId or idempotency key (retries duplicate); repo id = sha(realpath) changes on move.
- hsid: derive from principalId not userKeyId (rotation forks sessions); add a `d` marker; hooks get session_id in stdin JSON (verify $CLAUDE_SESSION_ID).
- L317/322 circular: node ids embed contractId which hashes nodes; ordinals renumber on edit. Key nodes by ref (node:<ref>), hash ordinal-free.
- L276 manifest `trust:` is self-description (§12.6 says never trust it) → move to grant table. L270 closed hook enum → additive. L311 vs L309 contradiction → Warpline schema subset of Gnomon's, no re-export (OPEN 13). L361 refusal codes without JSON-RPC codes; STALE_BASE overloaded for lost CAS.

## ABI
12 verbs holds. Critical matrix hole L379: humans append any kind, sessions append session.* → forged oracle.result/permit.grant/session.exited. Kernel-owned namespaces appendable by no principal. Define principal→manifest grant binding. Interactive session.open{derived} needs no spawn permit (fuse usage-only for interactive turns). Card enum mismatch merge vs merge-conflict; verdict lacks approve. F4 next-verbs: budgetPaused→[status] loops; add rules for pending cards and session.open; add a read-token column.

## Per-user kernel as client of per-repo warplined
Agree, if: re-derived warplined:v1 NDJSON client (not the engine); kernel may activate warplined, never mint its credentials; "republishes selvage moves" (L415) has no source — ask Warpline for `refs.watch` or fs-watch refs/heads/selvage, no polling. Revisit at >3 concurrently active Warpline repos or RSS over budget.

## Migration
- L191 (critical): "broker unreachable ⇒ hook denies" would deny every 7.x plugin user without the daemon. Scope to kernel-spawned sessions.
- L646 deletes the Conductor runner in Move 1 but GnomonClient.swift is M3.6 → delete in M3.6.
- L403 one-line inject cap breaks constellation's system prompt (agents.ts:336, 452). Client-supplied injects allowed + logged; only kernel-added bytes capped.
- §13.1 step 4 collides with generate-hooks.mjs → subsume; generate JSON data, not TS.
- L621 gitignores all of .gnomon/ but project.yaml must be committed → ignore only .gnomon/worktrees/.

## Delivery
- Mod-socket spike M1.9 → M1.0, against a stub socket, day 1.
- Add M1.12: flow Python client + constellation socket client (needed by Move 1 pass + G-RUN-04).
- G-KRN-01 (M1.5) needs policy generation (M1.10) → reorder.
- G-LOG-05, G-FLD-01, G-SHU-01 are field metrics → §16 telemetry. G-RUN-04 as written can't exist (suites mock spawnImpl).
- G-HON-01 will fail as written: §7.1 scans code spans so L8, L432, L433, L806 become nodes; kernel symbols first appear in §2.1 not where Appendix A says; G-LAW-01b fails the id regex; `..` ranges unexpanded.

## OPEN answers
1 as above · 2 `.gnomon/project.yaml` (kernel never reads Paradigm config) · 4 adopt derived hsid keyed on principalId · 5 client activation only in 8.0 · 6 segment at 10^6 rows; keep inject bytes forever (90-day prune breaks byte-for-byte replay); prune turn.event bodies at 90 days · 7 file · 10 local command · 11 no · 12 Arky triages kernel, Aegis owns broker/identity · 13 superset schema, no re-export.
