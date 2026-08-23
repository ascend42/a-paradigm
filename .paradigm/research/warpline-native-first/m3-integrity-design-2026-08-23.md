# M3 — INTEGRITY: minimal signed-strand design (2026-08-23)

Status: DESIGN (Arky, with Aegis's hat for §2). Satisfies TD-2026-08-11-913(3) / TD-2026-08-23-042 F1: "hash-chained + signed strands, real signed agent/human boundary." Task T-2026-07-01-014.

## 1. Current state — what tamper-evidence already exists

**The task text is stale.** T-014 says `computePickId` (strand.ts:102) "does NOT commit to the parent pickId." Verified false today: the v2 rule folds `parentPickId`, `seq`, `mergeParentPickId`, `authoredBy.agentId`, `bindingTreeId`, and `mergeAlgo` into the preimage (`strand.ts:327-336`); the v3 rule folds `parents[]` explicitly (`strand.ts:303-321`). The hash-chain half of M3 shipped with the v2/v3 epochs.

What chains today:
- **Linear chain (v2):** `parentPickId` = ledger tip, in the preimage; sealed with a C-4 dual-pointer writer guard (`seal.ts:129-135`) and verified symmetrically (`verify.ts:277-320`).
- **DAG (v3):** identity = H(parents + content); closure/causality/acyclicity/single-genesis walk (`verify.ts:375-433`).
- **Bytes:** `binding.treeId` in the preimage; every reachable object re-hashes on verify (`verify.ts:175-202`).
- **v1 prefix:** epoch anchor + grandfather manifest, git-corroborated (`verify.ts:558-690`); pinned body hashes (`strand.ts:361-365`).
- **Truncation:** stake-journal cross-check, HARD (`verify.ts:514-556`); refs CAS + selvage cross-checks (`refs.ts:97-117`, `verify.ts:459-512`).
- **Rewrite guard:** `rewriteFabric` refuses identity mutation (`fabric.ts:273-279`).

What does NOT exist: any signature, anywhere (grep confirms zero signing code in `src/`). Identity is **unkeyed**: `actor`/`authoredBy.agentId` are self-asserted strings (`cli.ts:480`, "unsigned self-assertion… M3"); `daemon/tokens.ts:19` explicitly defers per-strand signatures; the CLI human-class gate keys on the unsigned `$WARPLINE_AGENT_ID` env var (`agent-shell.ts:70-73`, honest-scope note :26-30).

## 2. Threat model (Aegis hat) — who can forge what today

Trust boundary today = the OS user (`tokens.ts:15-20`). Every swarm agent in the field test runs AS that user. Therefore, today:

- **T1 — actor forgery:** any process writes any `actor` string. Attribution — the substrate of the calibration moat (`strand.ts:8-11`) — is poisonable at zero cost.
- **T2 — human-class forgery (the field-test killer):** `resolve` is HUMAN_ONLY (`protocol.ts:115-120`), but the CLI gate is `$WARPLINE_AGENT_ID`; an agent that unsets one env var IS a human shell (`agent-shell.ts:116-118`; readiness doc §C). FG-1's completion criterion rests on resolve being forbidden; today it is forbidden by etiquette.
- **T3 — whole-fabric rewrite:** the chain is an unkeyed hash chain; an attacker with the box recomputes every pickId and every ref. Detection depends on the stake journal (valve usually off) and the anchor's git corroboration — porous.
- **T4 — ref/registry tamper:** refs are plaintext files; detected only against the fabric they point into.
- **T5 — cross-agent impersonation:** agent A asserts agent B's id. Corrupts per-agent calibration.

Residual (accepted, stated): same-OS-user code can read files, patch binaries, keylog. M3 is tamper-**evident**, not tamper-proof; the field test additionally denies agents Bash (readiness §C).

## 3. Design — minimal M3

**Key scheme — human-as-CA, not daemon-as-CA.** The daemon must hold no signing keys (an agent can read anything the daemon can; a daemon-CA is theater). Ed25519 (`node:crypto`, no new deps).

- **Human ROOT key** (`warpline key init`): passphrase-encrypted at rest (scrypt + AES-256-GCM) in `.warpline/keys/root.key`. The passphrase — which lives only in the human's head — is the **only** cryptographic material on the box an agent cannot read. This is the load-bearing boundary.
- **Agent keys** (`warpline key mint <principal>`, human-gated like token mint, tokens.ts:3-6): plaintext 0600 `.warpline/keys/agents/<principal>.key`. Raises T1/T5 from free to requires-that-agent's-key-file; honestly weak within the box, real across it.
- **Registry:** `.warpline/keys/registry.jsonl`, append-only rows `{keyId=sha256(pub), principal, kind: human|agent, pub, createdAt, rootSig}`. Every `kind:agent` row is **countersigned by root**; a `kind:human` row is valid only for the root key itself. An agent cannot mint itself a human key row (kills T2's registry variant). Root row records `signedFrom`: the tip pickId at init — the signing-epoch boundary (mirrors the v1-anchor grandfathering pattern, `verify.ts:558`).

**What gets signed: the pickId.** `sig = Ed25519(key, "warpline:strand-sig:v1\n" + pickId)`. The pickId already commits to parents, actor, delta, bytes, `resolves` — signing it inherits all of it; post-seal-mutable fields (confidence, binding backfill) stay correctly outside. Resolve actions need no separate signature: a resolution IS a strand carrying `resolves` (`strand.ts:51-83`), and the verifier enforces **class**: a `resolves`-bearing strand (and `stake recover`'s reversion strand) must verify under a `kind:human` registry key. Refs stay unsigned (recoverable/cross-checked; defer).

**Placement:** sign in `sealState` (seal.ts) — the one write path all of pick/admit/resolve share — immediately after `computePickId` (seal.ts:159). Signer resolution: agent key discovered per-instance (mirroring `mcpAgentToken`'s fail-closed order, tokens.ts:295-320) keyed by `$WARPLINE_AGENT_ID`; human path prompts for the passphrase (per-invocation; no unlocked session file — an agent-readable cache would void the boundary). Post-boundary seal with no resolvable key **refuses** (`refusal:v1`).

**Storage hazard (the one dangerous edit):** `sig` rides on the strand but must be EXCLUDED from the preimage. The v2 rule uses a `...rest` spread (`strand.ts:327-329`) — `sig` must be added to the destructure exclusion or it leaks into new pickIds. The v3 preimage is explicit (`strand.ts:304-319`) and safe by construction.

**Verification:** `verifyFabric` gains kinds `sig-missing | sig-invalid | sig-key-unknown | sig-kind-violation | registry-invalid`. Rules, post-boundary only: sig verifies; signer principal matches `authoredBy.agentId` (agent) / signer kind matches strand class; human-class strands require a human key. **`warpline fsck`** = umbrella verb: fabric verify + objects verify + refs + registry + signatures, one report, one exit code. Verify-on-read scope: seal-time (writer), fsck, daemon startup health. Not per-read on hot paths (perf; fsck is the audit).

**Grandfathering:** every strand at-or-before `signedFrom` is valid unsigned, permanently (same shape as v1-anchor + legacy manifest). No retro-signing.

**Deferred OUT of minimal M3:** gc ("nothing is ever deleted" is load-bearing — anti-goal); ref signing; daemon-side resolve (daemon answers resolve with a refusal directing to the CLI — signing is a possession-of-passphrase act); revocation ceremony (re-mint appends, like tokens); macOS Keychain/Secure Enclave; transparency log / off-box anchoring beyond stake journal; signing grades.jsonl; timestamp attestation.

## 4. Increment plan (~30h total — matches F1's estimate)

| # | Increment | hrs | Acceptance |
|---|---|---|---|
| I1 | `fabric/keys.ts`: Ed25519 gen, scrypt+GCM passphrase wrap, keyId, sign/verify over domain-separated pickId; registry read fail-closed (tokens.ts pattern) | 4 | Round-trip unit tests; wrong passphrase fails closed; garbled registry rows never resolve |
| I2 | `warpline key init/mint/list`; root countersigns agent rows; `signedFrom` pinned at init; `key init/mint` added to the agent-shell human-class set | 5 | Init on live fabric pins tip; agent shell refused FORBIDDEN; mint requires passphrase |
| I3 | Seal-time signing in `sealState`; `sig` excluded from v2 preimage; fail-closed refusal on unresolvable key | 6 | All 1158 existing tests green on keyless repos; post-init unsigned seal refused; sealed strand carries valid sig |
| I4 | `verifyFabric` signature + registry rules (5 new failure kinds); human-class enforcement on `resolves`/recover strands | 6 | Byte-flip, sig-swap, and agent-signed-resolve each exit 1 with the named kind |
| I5 | `warpline fsck` umbrella + daemon health + MCP/descriptor skin (read-only verb) | 4 | fsck exit 0 healthy; each tamper class exit 1 |
| I6 | **Adversary falsifier = the field-test precondition:** an agent context (agent key only, no passphrase) attempts resolve via (a) CLI, (b) hand-forged unsigned strand, (c) agent-key-signed resolve strand, (d) self-minted fake human registry row — all four end in seal-refusal or fsck HARD failure; then fsck proves the whole chain + signatures | 5 | The FG-1-adjacent criterion verbatim: an agent-token actor CANNOT produce a validly-signed human-class action, and fsck proves it |

Each increment ships independently with tests; I3 is the first behavior change and only on post-init repos.

## 5. Risks / open questions for the founder

1. **Passphrase friction:** per-resolve prompt is the honest boundary; any session cache readable by agents voids it. Accept friction, or pull Keychain/Touch ID forward?
2. **Root pinning off-box:** a box-owning attacker can re-init a new root and re-sign. Recommend committing the root **public** keyId to git (safe — public) so history rewrite is detectable off-box. Approve?
3. **Daemon resolve:** M3 makes resolve CLI-only (refusal on daemon). Acceptable for the field test (resolve legs are scripted human-token legs per FG-1)?
4. **T-014 scope:** the task's chain/meaning↔bytes/fail-closed items are already shipped by v2/v3 — proposal: narrow T-014 to signatures+fsck (this design), record the supersession as a TD.
5. **Cross-agent forgery (T5) stays possible within the box** at M3 — accepted residue, or does the field test's tool-permission deny need to cover `.warpline/keys/` reads explicitly?
