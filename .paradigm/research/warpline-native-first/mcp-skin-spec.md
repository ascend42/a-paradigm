# Warpline MCP Skin — Build Specification (T-2026-07-21-004)

**Author:** Arky (architect) · 2026-07-21 · founder constraint TD-2026-07-21-766, falsifier F4
**Binding inputs:** `aegis-mcp-skin-ruling.md` (R1-R5, this directory), Loid's measurement/attribution requirements, Jinx's ranked trap list. All source claims in those reports were re-verified against `packages/warpline/src/daemon/{protocol,server,tokens,client,lifecycle}.ts` and `src/fabric/{refusal,native,admit,scratch,strand}.ts` before this spec was written. Where reports conflict, the reconciliation is stated inline and marked **RECONCILED**.
**Reading rule for builders:** this document is self-sufficient. Implement from it; do not re-derive from the three reports.

---

## 1. Decisions on the four open questions

### D1 — Package location: `warpline mcp` stdio subcommand inside `packages/warpline`. New file tree `src/mcp/`.

Warpline is moat-silent: `packages/paradigm-mcp` ships to npm, and registering Warpline tools there would publish the verb surface, the descriptors, and the refusal vocabulary to every install — the exact runtime self-description we are deliberately NOT putting in the world until the founder says so. A new package adds a workspace seam with zero consumers. `packages/warpline` already owns the `warpline` bin (`package.json` `bin: {warpline: dist/cli.js}`), the daemon client, and every type the skin projects — a `warpline mcp` subcommand reuses all of it with no cross-package dependency and inherits the package's unpublished posture. Dependency: add `@modelcontextprotocol/sdk` (align the version with `packages/paradigm-mcp`); a hand-rolled stdio JSON-RPC loop is rejected as unnecessary protocol risk.

### D2 — Principal mapping: one server process = one human-minted `kind:'agent'` unscoped token; the server is a credential pass-through, never a principal. (Aegis R1 + Loid 1, **RECONCILED** with Jinx trap 5.)

The token is read at startup from exactly two places, in order: `$WARPLINE_MCP_TOKEN` (shell/keychain-injected), else `.warpline/daemon/mcp.token` (0600, written at mint time). The server NEVER reads `.warpline/daemon-tokens.jsonl` (it holds human tokens; a "newest row" bug is a privilege escalation — Aegis R1) and NEVER accepts, forwards, or acts on any identity parameter in a tool call. The daemon needs zero identity changes: it already server-stamps (`server.ts:239,248-249,284-285`) and a shared-token deployment would bake the wrong agentId into signed pickId preimages (`strand.ts` v3 identity includes `authoredBy.agentId`) — irreparable post-seal, per Loid.

**Reconciliation with Jinx trap 5 (multiplexing):** under stdio, one MCP client instance = one spawned server process = one token = one principal. Subagents inside a single IDE session share that principal — this is an attribution-granularity limit, not a vulnerability, and the skin states it honestly rather than faking finer grain: the `warpline_status` description carries "attribution = this session's principal, authentic within the OS-user boundary." Teams needing per-subagent calibration streams mint per-agent tokens and run per-agent MCP config entries. Per-session sub-principals stamped server-side are REJECTED for v1 (they would require daemon identity changes Loid's requirement 1 explicitly avoids). The loud-failure half of Jinx 5 is accepted as pre-work PW-10: a fork over an existing unadmitted scratch ref refuses instead of silently clobbering.

### D3 — Transport: daemon socket only, including reads; auto-start permitted; daemon-down and token-missing are refusal-shaped, never prose, never a fallback. (Aegis R3 + Jinx 9.)

Every tool call goes through `DaemonClient` over the UDS. In-process engine imports are prohibited in `src/mcp/` — the entire stage-1 security layer (token resolution, verb×principal matrix, server-stamping, audit row) lives in the daemon request path and nowhere else; an in-process read is an unaudited read of trust data. On connect failure the skin MAY auto-start the daemon (same OS user; `lifecycle.ts` single-instance lock makes double-start safe); if the daemon still cannot be reached, the tool returns `isError:true` whose content is a skin-built `refuse({code:'UNSUPPORTED', gate:'transport', retriable:'retry-identical', next:[{verb:'daemon.start', params:{}, requires:[], principal:'human'}]})` — the structured replacement for the prose at `client.ts:111`. A missing/unresolvable token returns `refuse({code:'AUTH', next:[{verb:'daemon.token.mint', params:{name:'mcp', kind:'agent'}, requires:[], principal:'human'}]})`. The skin builds these two refusals itself because no daemon is present to build them; they are the ONLY refusals the skin ever constructs — everything else arrives from the wire verbatim.

### D4 — Description strategy: 1-2 sentence descriptions sourced from the canonical descriptors module; `status` is the load-bearing state-aware self-description carrier. (Jinx trap 3 + Aegis R4.3 + Loid 3.)

This repo defers ~380 MCP tools to names-only; assume descriptions can be truncated away by any host. Therefore: descriptions stay at 1-2 sentences (from `descriptors.ts`, §4 PW-5 — one source for MCP schemas and CLI help, content-addressed as `descriptorsId`), and the recovery carrier relocates into the RESULT channel, which no host truncates: `warpline_status` returns the cycle, the caller's position in it, and the next legal verbs (PW-6). The static untrusted-content sentence (Aegis R4.3) rides in the `warpline_knot_show`, `warpline_admit`, and `warpline_shadow_tail` descriptions; because descriptions may vanish, the SAME static sentence also appears once in `status`'s self-description output (PW-6) — legal there because the status result is daemon-authored structure, not an engine verdict, so G3 verbatim-shapes is not violated. Injecting it into knot_show/admit results themselves is rejected (that WOULD reshape engine shapes). A truncated-descriptions F4 arm is pre-registered (founder-gate FG-2).

---

## 2. Tool surface table

Server name: `warpline`. Tool naming law: `toolNameOf(verb) = 'warpline_' + verb.replace(/\./g, '_')` — exported from `descriptors.ts`, used by the totality test (PW-4). Dotted daemon verb names stay UNCHANGED on the wire and inside `refusal.next[]` (engine shapes are verbatim, G3); the mangling exists only at the MCP registration boundary, and `status`'s self-description output carries the verb→tool map so a cold agent can translate `next[].verb` mechanically.

Default (agent-mode) surface — 8 tools:

| MCP tool | Daemon verb | Params (typed) | Principal class | Description budget | Refusal carrier |
|---|---|---|---|---|---|
| `warpline_status` | `status` | — | agent | 1 sentence + honesty clause ("attribution = this session's principal") | transport errors only (skin-built, §1 D3) |
| `warpline_refs_list` | `refs.list` | — | agent | 1 sentence | transport errors only |
| `warpline_fork` | `fork` | `into?: string` | agent | 2 sentences (cycle step 1; where scratch lands) | transport + PW-10 clobber refusal |
| `warpline_propose` | `propose` | `intent: string` (required), `worktree?: string`, `claim?: {claimedSymbols: string[], intent?: string, …CreateClaimInput minus agentId}`, `sessionKey?: string` | agent | 2 sentences (cycle step 2; intent is mandatory) | transport `BAD_REQUEST` on missing intent |
| `warpline_admit` | `admit` | `worktree?: string`, `intent?: string`, `claim?: string`, `shadow?: boolean`, `noRestore?: boolean` — **no `acceptBreach`/`acceptRisk` in the schema** | agent | 2 sentences incl. static untrusted-content sentence + "resolution is human-class; escalate via refusal.next[]" | **primary carrier**: `AdmitNativeResult.refusal` (verdict-class) rides inside `ok` results; `isError` derived from it (§3) |
| `warpline_knot_show` | `knot.show` | `selector: string` (required), `summary?: boolean` (PW-7) | agent | 2 sentences incl. static untrusted-content sentence | transport `NOT_FOUND` |
| `warpline_grade_report` | `grade.report` | `window?: number` | agent | 1 sentence | transport errors only |
| `warpline_shadow_tail` | `shadow.tail` | `n?: number` (default 20) | agent | 2 sentences incl. static untrusted-content sentence | transport errors only |

Notes:
- `now` (injectable test clock) is deliberately absent from every MCP schema — determinism plumbing, not agent surface.
- OMITTED entirely (Aegis R2): `resolve`, `stake`, `stake.recover`, `backup`, and the `acceptBreach`/`acceptRisk` flags. The daemon matrix (`server.ts:190-191, 259-267`) remains the backstop, never the mechanism. The escalation signal is `refusal.next[]` entries with `principal:'human'`.
- Operator mode (OPTIONAL, Aegis R2 opt-in): `warpline mcp --operator` calls `status` at startup and registers the four human tools **iff** `status.kind === 'human'`; never speculatively. Ships in phase 2 behind the flag; not required for F4.

**Result contract:** every tool returns one `content` item, `type:'text'`, whose text is `JSON.stringify` of the engine shape VERBATIM — envelopes (`kind:'untrusted-prose'`, `contentAddress`) intact, nothing unwrapped, nothing promoted into titles or preambles (Aegis R4.1-R4.2). No MCP-layer template ever interpolates prose bodies.

---

## 3. The isError contract (Jinx trap 4 — the T-006 lesson, pinned)

```
isError :=
  transport/usage failure (DaemonRpcError, connect failure, missing token)  → true
  ok result                                                                → exitCodeForResult(result) !== 0
```

`exitCodeForResult` (`refusal.ts:240-242`) is the single source: an `ok:true` admit carrying a CLAIM-BREACH refusal is `isError:true` with the full result as content. A refusing verdict must never present as MCP success — that is the T-2026-07-21-006 silent-success bug and the third skin does not re-ship it. `f4Trace.resultClass` (§5) records the verdict class either way.

---

## 4. Pre-work list — lands BEFORE the MCP server, in this order

Engine-side fixes so all three skins inherit (G3). PW-1→PW-3 are strictly ordered; PW-4 depends on PW-3+PW-5; the rest may parallelize after PW-2.

**PW-1 — `retry-corrected` retriability value.** `src/fabric/refusal.ts`: add `'retry-corrected'` to `Retriability` ("a corrected or prerequisite call succeeds — follow `next[]`, then retry"); change `RETRIABLE_FOR` defaults for `BAD_REQUEST`, `UNKNOWN_VERB`, `NOT_FOUND` from `'never'` (false — Jinx 8) to `'retry-corrected'`. `AUTH`/`FORBIDDEN` stay `'never'` (true for the same principal; recovery is escalation, carried by `next[]`). One value covers both wrong-params and missing-prerequisite because the recovery axis is identical ("a different call first") and `next[]` disambiguates — no enum sprawl. Additive under G1. ~20 lines + table-totality test update.

**PW-2 — Engine-side sequencing refusals.** New `RefusedError` class (in `refusal.ts`; carries a `Refusal`), thrown at the `native.ts` prerequisite boundaries; `server.ts:197` catch-all detects it and emits `error.code = refusal.code` + the carried refusal instead of `ENGINE`/`retry-identical`/empty-`next`; `cli.ts` detects it likewise. Site table (verified line numbers; codes pinned):

| native.ts site | Condition | Code | Retriable | next[] |
|---|---|---|---|---|
| 158-160 | legacy fabric, no pickId refs | `UNSUPPORTED` | never | `[{verb:'refs.migrate', principal:'human'}]` |
| 267-270 | legacy stateId scratch at propose | `UNSUPPORTED` | retry-corrected | `[{verb:'fork', params:{}, requires:[], principal:'agent'}]` |
| 379-382 | admit with nothing proposed | `BAD_REQUEST` | retry-corrected | `[{verb:'fork'…}, {verb:'propose', params:{}, requires:['intent','worktree'], principal:'agent'}]` |
| 443-446 | disjoint DAG roots | `INTEGRITY_BROKEN` | never | `[]` (escalate) |
| 663 | resolve with no selvage | `NOT_FOUND` | never | `[]` |
| 668-671 | resolve with no scratch strand | `NOT_FOUND` | retry-corrected | `[{verb:'propose', requires:['intent','worktree'], principal:'agent'}]` |

The remaining `native.ts` throws (unloadable state, missing binding) are honest `ENGINE`/fail-closed and stay as-is. ~150-250 lines incl. tests.

**PW-3 — next[] vocabulary fixes (Jinx 7's three mismatches).** `src/fabric/admit.ts`: (a) `meaningNextSteps` resolve step becomes `{verb:'resolve', params:{agentId:<proposing agent>}, requires:['worktree','reason'], principal:'human'}` — matching what the daemon resolve verb actually accepts (`server.ts:301-314`; `decidedBy` is server-stamped and must not be advertised as a caller param); builder signatures gain `agentId`. (b) `claimNextSteps` propose step adds `'intent'` (and `'worktree'`) to `requires`. (c) `server.ts` AUTH refusal gains `next:[{verb:'daemon.token.mint', params:{}, requires:['name','kind'], principal:'human'}]`. STALE_BASE: zero emitters today; NOT wired here — if ever emitted its ladder is fork→propose, which exists on every skin; documented, not built. ~60 lines.

**PW-4 — Vocabulary totality test.** New `packages/warpline/test/refusal-vocabulary-totality.test.ts`: for every `RefusalNextStep` any engine/daemon site can emit (enumerate the builders), assert (1) `toolNameOf(verb)` exists in the descriptors surface OR the step is `principal:'human'`/CLI-only and listed in a pinned allowlist (`resolve`, `daemon.start`, `daemon.token.mint`, `refs.migrate`), and (2) `params ∪ requires` covers the target surface's required params. Runs against `descriptors.ts` so drift fails CI, not F4 runs. ~120 lines.

**PW-5 — Canonical descriptors module.** New `packages/warpline/src/daemon/descriptors.ts`: `export const VERB_DESCRIPTORS: Record<DaemonVerb, {verb, summary, paramsSchema, cycleStage: 'orient'|'fork'|'propose'|'admit'|'inspect'|'resolve'|'custody', principal: 'agent'|'human'}>` + `toolNameOf()` + `descriptorsId()` (sha256 of canonical serialization). Consumed by MCP tool registration AND `cli.ts` help so the two skins cannot drift (Loid 3). Frozen before the first scored F4 batch; any change resets the ≥10-run denominator (FG-3). ~200 lines.

**PW-6 — `status` state-awareness (the relocated carrier, Jinx 3).** `server.ts` status case gains additive fields computed for `who.principal`: `cycle` (ordered verb list with cycleStage), `position: {scratchPresent, scratchIsPickId, proposalSealed (scratch tip ≠ its base), behindSelvage}`, `nextLegalVerbs: string[]`, `toolMap` (verb→`toolNameOf`), and the static untrusted-content sentence as a fixed field. All additive under G1 (`DaemonStatus` widens). ~80-100 lines.

**PW-7 — `knot.show` paging (Jinx 10).** Additive `summary?: boolean` param: daemon returns the payload minus file bodies (structural index, both sides' metadata, `resolution.requires`, contentAddresses kept) so the recovery path's largest result is boundable. `server.ts` + `knot-payload.ts` helper. ~40 lines.

**PW-8 — daemonAudit/exit alignment (Loid 5).** `server.ts` audit row gains additive `resultCode?: RefusalCode` stamped from `result.refusal` when `ok:true` — so `audit(true)` no longer masks verdict-class refusals if anyone consumes the audit as truth. ~15 lines. (f4Trace, not daemonAudit, remains F4 ground truth — Loid 2.)

**PW-9 — MCP token file at mint.** `tokens.ts` + CLI: `warpline daemon token mint mcp --kind agent` (principal name `mcp`, or `mcp-<worktree>` per Aegis R5 naming) additionally writes the bare token to `.warpline/daemon/mcp.token`, 0600 (gitignored via `.warpline/*`, on the stake deny-list). Plus `mcpAgentToken(root)` in `tokens.ts` mirroring the `consoleReadToken` structural pattern (`tokens.ts:169-185`): reads ONLY the dedicated file — never `daemon-tokens.jsonl`. Mint help text states the no-revocation residual (Aegis R5). ~50 lines.

**PW-10 (RECOMMENDED) — fork clobber guard.** `forkNative` refuses (`RefusedError`, `BAD_REQUEST`, retry-corrected, `next` = admit-or-clear ladder) when a scratch ref already exists, is a pickId, and differs from the current selvage tip — a sealed-but-unadmitted proposal would be silently orphaned by re-fork (`scratch.ts:40-46` is an unconditional overwrite; same-principal concurrent sessions clobber silently today). `writeScratchRef` gains an optional CAS `expect` param. ~40 lines.

---

## 5. f4Trace — the skin's own measurement stream (Loid 2)

`daemonAudit:v1` is REJECTED as F4 ground truth (masks in-result refusals; no runId). New module `packages/warpline/src/daemon/f4-trace.ts`, shared by the MCP skin and the CLI, appending to `.warpline/f4/trace.jsonl`:

```
f4Trace:v1 {schemaVersion, ts, runId, seq, skin:'mcp'|'cli', principal, verb,
            target, ok, refusal?, resultClass?, descriptorsId}
```

- `runId` from `$WARPLINE_F4_RUN_ID` (set by the T-005 harness); `'unscored'` when absent — rows always emit.
- `refusal` is the `refusal:v1` object VERBATIM — legal in a log because refusal:v1 is prose-free by construction (`refusal.ts` binding rule); `target` follows the `targetOf` discipline (`server.ts:406-418`): selectors/flags only, never intent/reason bodies. No other field may carry prose.
- `resultClass` for `ok` rows = the structural verdict class (`sealed` | decision.status | `noop` | `read`), derived from the result shape, never from text.
- Wasted-turn taxonomy W1-W4 (identical-repeat, next-ignored, escalation-violation, surface-miss, + productive-hydration allowance) is the HARNESS's pure-code classifier over these rows — not this skin's concern beyond emitting them faithfully.

---

## 6. Founder-gate items — RATIFICATION language, not build language

These amend TD-2026-07-21-766 / T-2026-07-21-005. The founder ratifies; nothing below is a builder's call. The MCP server may BUILD before ratification, but no F4 run is SCORED until FG-1..FG-3 are signed.

**Status 2026-07-28: FG-1 RATIFIED (TD-2026-07-28-168). FG-2, FG-3, FG-4 remain UNRATIFIED — nothing is scored.**

**FG-1 — The resolve-leg redefinition of F4 completion (Jinx trap 1, fatal to the gate as written). ✅ RATIFIED 2026-07-28 — TD-2026-07-28-168, amends TD-2026-07-21-766.**

The contradiction: F4 as written demands the cold agent complete `resolve`, but `protocol.ts:112` lists `resolve` in HUMAN_ONLY_VERBS (an agent-class principal cannot invoke it at all), `admit.ts:336-353` (`meaningNextSteps`) makes the KNOT ladder's step 2 `resolve` with `principal:'human'` — escalate, do not attempt — and `classifier.ts` W3 scores an agent WASTED for attempting the human verb after a human-door refusal. The falsifier demanded the one act the security law forbids and the instrument penalizes.

Ratified in AMENDED form. The originally-pinned wording ended *"…and emits a structured escalation acknowledging the `principal:'human'` step"*, which is NOT OBSERVABLE in `f4Trace` — there is no `escalate` verb, so scoring it would need a human read per transcript, breaking the pure-code classifier discipline. The ratified criterion is restated over rows the rig already emits:

> Agent-class F4 completion = all three, computed from `f4Trace:v1` rows alone:
> 1. the agent reaches a KNOT verdict — an episode opens on a `GATE_REFUSED` refusal carrying `verdict:'KNOT'`;
> 2. it hydrates the work order named by `refusal.pointers.knotPayloadId` — a `knot.show` row matching that pointer;
> 3. it does not breach the human door — zero W3 marks in that episode.
>
> The resolve leg is executed by a scripted human-token actor as a SEPARATE harness leg: it proves the cycle closes and returns the fixture to a resolvable state, and contributes NOTHING to the agent's score.

**Recorded consequence** (so the amendment is never re-read as a goalpost-move): F4 no longer measures resolution parity with git, where an agent may resolve its own conflict. That asymmetry is a DELIBERATE PRODUCT PROPERTY — contested meaning is decided by a human, the accountability moat — not a legibility defect. F4 measures whether the escalation is LEGIBLE, not whether the agent can resolve.

**Deliberately not legislated:** an agent may sidestep a KNOT by rewriting its own change to stop contesting, then re-proposing and admitting clean. Under (1)-(3) that does not score as completion. It is arguably excellent cold behavior — WATCH for it in the first scored runs and rule with data, not blind.

**Deferred, not rejected:** a first-class `escalate` verb would make escalation a recorded, accountable act (and is arguably better design), but it is new surface that moves `descriptorsId` and resets the FG-3 denominator, and building a verb *so the falsifier can pass* is instrument-shaping. Gated on whether scored runs show agents flailing at the wall.

**FG-2 — Truncated-descriptions F4 arm.** Pre-register a harness arm running with tool descriptions stripped to names-only (the ~380-deferred-tools reality), scoring the same taxonomy. Ratification adds the arm to T-005's pre-registered design; running it later un-pre-registered would be the "the team believes" failure mode again.

**FG-3 — Descriptors freeze + denominator reset rule.** `descriptorsId` is pinned in the T-005 pre-registration before the first scored batch; ANY change (wording included) resets the ≥10-run denominator. Ratify the rule, then freeze.

**Review pass completed 2026-07-28 (pre-freeze, per the founder's instruction that the freeze is expensive to undo). Two findings, both FIXED before pinning — the id has MOVED as a result.**

*Finding 1 — the id did not cover the load-bearing carrier.* `descriptorsId()` hashed `VERB_DESCRIPTORS` alone, but PW-6 deliberately relocated the F4 teaching OUT of descriptions and INTO the `status` result ("hosts defer/truncate tool descriptions to names-only, but nothing truncates a RESULT"). Two teaching-bearing pieces sat outside the hash: the `nextLegalVerbs` rule (then an inline conditional in the daemon's status handler) and the `toolNameOf` mangling law. Consequence: edit the next-verb rule → what every cold agent is taught changes → `descriptorsId` unchanged → **the denominator does not reset**, and the trace's stated purpose ("pins WHICH teaching text served this call") is void. The freeze would have been nominal. FIXED: the rule is now a declarative table in `descriptors.ts` (`NEXT_LEGAL_VERBS` + `nextLegalVerbsFor`), and the id hashes the verb table + the rule + the DERIVED tool-name map. Two tests assert the id MOVES when either changes.

*Finding 2 — `status` misdirected a contested agent.* Probed live against the real skin: after a KNOT the carrier answered `nextLegalVerbs: ["admit"]`, while the refusal's own ladder said `[knot.show, resolve(principal:'human')]` — so re-orienting steered the agent straight into the identical re-admit the classifier scores **W1**. Expensive because the classifier grants exactly ONE orientation call per recovery episode, precisely on the assumption that cold agents re-orient. `behindSelvage` was already computed and then ignored by the rule. FIXED: the rule is KNOT-aware via a new `position.knotOpen` (a persisted work order naming this principal's CURRENT sealed proposal, keyed on `stateId` so re-proposing correctly clears it) and routes to `knot.show` with a `nextBecause` clause saying why retrying cannot work. Regression: `test/status-carrier.test.ts`.

**NEW pinned id, awaiting FG-3 signature:**

```
descriptors:v1:445e4eb767771108a039f21606fa51bfe96d1ddc2b70246f311423184bc77964
```

(was `descriptors:v1:a2ca0ab96554e90881b7bcb398559282e183fb5143aeae49df4dc948cd829bcc` — superseded by the two fixes above, pre-freeze, with zero scored runs in the denominator, so nothing was discarded.)

*Standing caveat carried into FG-2:* the CLI arm has NO `status` equivalent, so it has no orientation carrier at all. A CLI-arm F4 failure could be "no carrier" rather than "not legible", and the two would be indistinguishable.

**FG-4 — KNOT seeding contract (Jinx 6, T-005 dependency).** A single principal cannot produce a KNOT (fork re-mints at selvage). T-005 needs a scripted second principal and a PRE-REGISTERED stratified seed corpus: semantic KNOTs with payload / byte-downgrade KNOTs without payload / one payload-persist-failure case. Ratify the corpus composition as part of T-005's pre-registration.

---

## 7. File plan — sub-phases for parallel builder execution

**Phase 0 — types + descriptors (no behavior change; fully parallel):**
- `src/fabric/refusal.ts` — PW-1 (`retry-corrected`, `RefusedError` class shell)
- `src/daemon/descriptors.ts` — PW-5 (new)
- `src/daemon/f4-trace.ts` — §5 types + append helper (new)

**Phase 1 — engine/daemon pre-work (serial after phase 0; touches shared files):**
- `src/fabric/native.ts` — PW-2 site conversions, PW-10 fork guard
- `src/fabric/admit.ts` — PW-3 ladder fixes
- `src/daemon/server.ts` — PW-2 catch-all, PW-3 AUTH next[], PW-6 status, PW-7 knot.show summary, PW-8 audit resultCode
- `src/fabric/knot-payload.ts` — PW-7 summary projection
- `src/daemon/tokens.ts` + `src/cli.ts` — PW-9 mint file + `mcpAgentToken`; CLI help from descriptors

**Phase 2 — MCP server core (new files; parallel with phase-1 tail once server.ts lands):**
- `src/mcp/token.ts` — env→file discovery via `mcpAgentToken`; never `daemon-tokens.jsonl`
- `src/mcp/refusals.ts` — the two skin-built refusals (daemon-down, token-missing) — the ONLY `refuse()` call sites in `src/mcp/`
- `src/mcp/server.ts` — tool registration from `VERB_DESCRIPTORS` (agent surface only; `--operator` conditional registration after `status.kind === 'human'` check), DaemonClient lifecycle + optional auto-start, isError mapping (§3), f4Trace emission per call, verbatim JSON result content
- `src/cli.ts` — `warpline mcp [--operator] [--no-auto-start]` subcommand (stdio)
- `package.json` — `@modelcontextprotocol/sdk` dependency

**Phase 3 — tests:**
- `test/refusal-vocabulary-totality.test.ts` — PW-4
- `test/native-sequencing-refusals.test.ts` — PW-2 table, each site asserting code/retriable/next
- `test/mcp-skin.test.ts` — fixture daemon + stdio roundtrip: token discovery structural (agent-only; human token in a planted file must NOT be picked up), isError contract incl. refusing-verdict-inside-ok, envelope verbatim (untrusted-prose survives serialization unmodified), daemon-down refusal shape, no-identity-params (schema-level), f4Trace row shape + prose-free assertion
- `test/descriptors-frozen.test.ts` — descriptorsId snapshot (the freeze tripwire)

---

## 8. What this spec REJECTS (do not relitigate)

| Rejected | One-line reason |
|---|---|
| Per-call identity params (`agentId`/`actor`/`decidedBy` in any tool schema) | Recreates the Aegis §1.1 impersonation primitive stage 1 closed; daemon server-stamps. |
| Generic passthrough tool (`warpline_call(verb, params)`) | Re-exposes the entire human surface behind one string and defeats schema legibility (Aegis R2). |
| In-process engine fallback when the daemon is down | The unaudited, unattributed branch is the accident's and attacker's favorite; fail refusal-shaped instead (Aegis R3). |
| Fat descriptions / tutorials in tool schemas | Hosts truncate to names-only; the carrier is `status` + refusals, not prose budgets (Jinx 3). |
| Reading `daemon-tokens.jsonl` from the skin | Contains human tokens; one selection bug = human capability in an ambient process (Aegis R1). |
| Auto-minting a token at first run | Issuance is the human's act (anti-sockpuppet); first-run prints the mint line instead (Aegis R5). |
| Token literal in `.mcp.json` or any committable file | Committed config = durable credential in git history; 0600 file or shell-injected env only (Aegis R5). |
| Unwrapping `UntrustedProse` / promoting `body` into titles, summaries, or templates | Strips the provenance marker and hands unlabeled hostile text to the reading agent (Aegis R4). |
| Human verbs on the default surface (expose-then-refuse) | Only omission stays safe under token misconfiguration; and a listed always-fails tool teaches worse (Aegis R2). |
| daemonAudit as F4 ground truth | `ok:true` masks verdict-class refusals; no runId; f4Trace:v1 is the instrument (Loid 2). |
| A new `resolve`-capable "redefined" tool ahead of FG-1 | The resolve-leg redefinition is the founder's ratification, not the harness builder's (Jinx 1). |

---

```yaml
# Agent Relay
status: success
summary: |
  Build spec for the Warpline MCP skin (T-2026-07-21-004) written and grounded in
  re-verified source. Decisions: (D1) `warpline mcp` stdio subcommand inside
  packages/warpline — moat-silent, reuses bin/client/types; (D2) one process =
  one human-minted agent-class token via env or .warpline/daemon/mcp.token,
  pass-through only, multiplexing limit stated honestly + PW-10 fork clobber
  guard; (D3) socket-only with optional auto-start, daemon-down/token-missing
  are the only two skin-built refusals; (D4) descriptors-sourced 1-2 sentence
  descriptions with state-aware `status` as the real carrier. 8-tool agent
  surface (resolve/stake/stake.recover/backup + override flags omitted).
  isError := exitCodeForResult(result) !== 0 kills the T-006 bug class.
  Ten pre-work items ordered PW-1..PW-10 (retry-corrected enum, engine-side
  sequencing refusals with a pinned per-site code table, next[] vocabulary
  fixes, totality test, descriptors module, status state-awareness, knot.show
  summary, audit alignment, mint file, fork CAS). Four founder-gate items
  separated with ratification language (F4 resolve-leg redefinition, truncated-
  descriptions arm, descriptors freeze, KNOT seed corpus) — build may proceed,
  scoring may not, until they are signed.
artifacts:
  - .paradigm/research/warpline-native-first/mcp-skin-spec.md
decisions:
  - "D1: packages/warpline `warpline mcp` subcommand; @modelcontextprotocol/sdk added; paradigm-mcp rejected (npm leak of moat-silent surface)"
  - "D2: one token per server process, env→.warpline/daemon/mcp.token discovery, never daemon-tokens.jsonl, no identity params ever"
  - "D3: socket-only incl. reads; auto-start optional; two skin-built refusals (UNSUPPORTED/daemon-down, AUTH/token-missing) with principal:'human' next[]"
  - "D4: descriptions 1-2 sentences from descriptors.ts; carrier = state-aware status result; truncated-descriptions arm pre-registered (founder-gated)"
  - "isError contract: transport failure OR exitCodeForResult(result) !== 0"
  - "retriability: single additive 'retry-corrected' value covers wrong-params AND prerequisites; next[] disambiguates"
  - "f4Trace:v1 in .warpline/f4/trace.jsonl is F4 ground truth; daemonAudit gains resultCode but stays non-authoritative"
handoff_to: builder
handoff_context: |
  Implement from .paradigm/research/warpline-native-first/mcp-skin-spec.md §4-§7
  in phase order: Phase 0 (refusal.ts enum + RefusedError shell, descriptors.ts,
  f4-trace.ts) is parallel-safe; Phase 1 pre-work MUST land before the MCP
  server (PW-2's per-site table in §4 has pinned codes/retriability/next[] —
  do not improvise); Phase 2 is the server itself (src/mcp/, only two refuse()
  call sites allowed); Phase 3 tests include the descriptorsId freeze tripwire.
  Do NOT build any resolve-capable tool or score any F4 run — FG-1..FG-4 in §6
  await founder ratification. The §8 rejection table is closed; do not reopen.
```
