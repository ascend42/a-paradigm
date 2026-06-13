# v7 — "Close the Loop"

> **Status:** Design (keystone designed; pre-build)
> **Decision:** [[TD-2026-06-13-718]] — "Close the loop: make Paradigm's checks true, not build a PM tool"
> **Lore:** L-2026-06-13-ascend-183238-001 (orchestration + task-system self-audit)
> **Tracked tasks:** T-2026-06-13-001 … 006
> **Authored by:** Arky (architect), Loid (intelligence officer), Cid (captain) — design panel, 2026-06-13

## Thesis

Paradigm today *records that it was asked to do the right thing; it does not verify that it did.* A two-slice self-audit (task system, then the orchestration engine) proved this with file:line evidence. v7 makes the framework's own value proposition **true** instead of asserted — it is **not** a project-management product.

The task-system audit and the orchestration audit found the same hole from two sides. The fix is **one keystone primitive**:

> **A persisted, symbol-bound, claimant-owned task DAG that orchestration emits, Cid captains, and whose completion feeds the learning loop.**

One primitive closes four problems: the open learning loop, the orchestration↔task disconnect, Cid's inertness, and the unfalsifiability of "self-improving."

## Three pillars

| Pillar | What it fixes | Maps to |
|---|---|---|
| **The Spine** — persisted claimant-owned task DAG (§1) | learning loop, orchestration↔tasks, Cid's artifact | "complete teams & task tracking" |
| **The Front Door** — honest classification + all agents routable + fail-visible (T-002, T-003) | any user gets the right team without expert driving | "any user can benefit" |
| **The Teeth** — enforcement verifies completion not invocation + falsifiable liveness metric (T-004, T-005) | checks actually prove true | "self-cross-check and self-improve" |

Stays **free and in-framework**. The cloud-SaaS `@a-company/pm` + billing + two-way GitHub sync tier is parked behind a real-external-demand gate. Generic PM chrome (due dates, sprints, SLAs, time tracking, notifications, recurring tasks) is **RESIST/bloat**.

---

## 1. The Spine — Task DAG (Arky)

### Locked schema (`packages/paradigm-mcp/src/utils/task-loader.ts`)

```typescript
export type ClaimantKind = 'archetype' | 'human' | 'peer';
export interface Claimant { kind: ClaimantKind; ref: string; }
// archetype: role id ("builder"); human: git user/email; peer: Symphony agentId

export type TaskStatus =
  | 'open' | 'in-progress' | 'done' | 'shelved';   // v7.0 ships 4 states; `claimed`/`blocked` are fast-follow

export type ExternalRefKind = 'github' | 'session' | 'symphony' | 'orchestration' | 'url';
export interface ExternalRef { kind: ExternalRefKind; ref: string; }

export interface Task {
  id: string; created: string;                 // immutable
  blurb: string; priority: 'high'|'medium'|'low'; status: TaskStatus; tags: string[];
  claimant?: Claimant;                          // { kind: archetype|human|peer, ref }
  parentTaskId?: string; dependsOn?: string[]; stage?: number;   // DAG
  started_at?: string; completed?: string; shelved?: string;     // started_at stamped on → in-progress
  settledAt?: string;                           // §2 idempotency stamp (field present; write-logic is §2)
  external_ref?: ExternalRef;                   // renamed from orphan session_link
  related_lore?: string[];
  /** @deprecated alias-shimmed to external_ref on load */ session_link?: string;
}
```

**Resolved (post-adversarial cut):** v7.0 ships **4 states** — `claimed`/`blocked` deferred to fast-follow (they're justified only by Symphony peer-claims, which are also fast-follow). The `claimant` union field still ships in v7.0 (cheap, forward-compatible). `settledAt` field ships now; its write-logic is §2.

**Status state-machine** (enforced in one `assertTransition` inside `updateTask`; `started_at` stamped on entering `in-progress`):
```
open        → in-progress | done | shelved
in-progress → done | open | shelved
shelved     → open
done        → (terminal)
```

### DAG storage & emission
- **Edge-list-in-node:** each task YAML carries its own `dependsOn`/`parentTaskId`/`stage`. The graph is reconstructed by loading the node set — **no separate edges file, no SQLite.** Survives the existing date-partitioned loader with zero loader changes. Cross-date edges work (the task-id embeds its date).
- Orchestration `mode=execute` calls a new `emitTaskDag()` at the point it builds `stagePrompts`: creates one **epic task** (the orchestration root, `external_ref:{kind:'orchestration'}`) + one child task per stage-agent (`parentTaskId`=epic, `stage`, `dependsOn`=resolved handoff edges, `claimant:{kind:'archetype'}`, `status:'claimed'`). Today this DAG is computed (`orchestration.ts:1780-1830`) then **discarded**; the frozen `logOrchestration` `status:'pending'` blob is replaced by the live epic task.
- **Status flows back** via two existing channels: the spawned agent calls `paradigm_task_update` on start/finish (Claude Code), or the Symphony `task-complete`/`progress`/`task-failed` watcher maps `metadata.task.taskId → updateTask` (Cursor/peer).

### Typed handoff — `AgentRelay` (new `utils/agent-relay.ts`)
Replaces free-text prose + the dead `parseFilePlan*` regex (`orchestration.ts:2671-2776`). One typed structure each agent emits: `{taskId?, agent, status, artifacts[], decisions[], handoffTo?, handoffContext?, filePlan?, blockedOn?}`. Symphony `TaskPayload` (assignment) and `AgentRelay` (completion) are the **request/response halves** — kept separate, bounded by an explicit map (`relay.taskId+status → updateTask`). `filePlan` becomes a typed field (kills the regex parsers); `planBuilderStages` consumes it directly.

### Migration — additive, lazy-healing
Every v7 field is optional → old YAML loads as-is. `session_link → external_ref` is a **read-side `normalizeTask` shim** at the load chokepoint; files heal on next write, no bulk migration. MCP tool enums **widen** (non-breaking). **One soft-breaking change to gate carefully:** default `paradigm_task_list` semantics move from `open` to `active` (= open ∪ claimed ∪ in-progress ∪ blocked) so a DAG full of `claimed` tasks isn't invisible by default — land atomically with the consumers (Cid/CLI/hook).

---

## 2. The Learning Wiring (Loid) — ⚠️ SUPERSEDED by §2 rev.2 (below); kept for history

### The completion→learning state machine — one function, both worlds
New `utils/task-settlement.ts` → `settleParentIfComplete(rootDir, parentTaskId)`. **Trigger = "last sibling done":** when every task sharing a `parentTaskId` reaches terminal, the parent *settles* (once — idempotent via `settledAt`). `completeTask` (`task-loader.ts:201`, the dead joint) calls it, so **both `paradigm_task_done` (MCP) and the CLI done-path flow through it for free** — the loop can't be live in one world and dead in the other.

Settlement fires the wired chain, replacing every advisory-prose joint with a real call:
```
recordWorkLog → (captain debrief → sessionInsights) → runPostflightLearning → autoPromoteJournalEntries
```

### Belief-delta promotion (`nomination-engine.ts:942`)
Swap the absolute `confidence_after >= 0.8` gate for **movement**: promote when `confidence_after - confidence_before ≥ 0.15` (floor); swings `> 0.6` route to journal-only with a `belief-flip` tag for review. `confidence_before` is already recorded and ignored today. **"Silence is signal" is structural:** a clean stage writes no journal entry → no delta → no promotion. The absence is the correct record.

### Calibration capture
New append-only `.paradigm/events/estimate-actuals.jsonl`: `{archetype, taskType, estTokens, actualTokens, parentTaskId, ts}` per agent-step. MCP-world actuals return via a new `sessionInsights.agentActuals` field on debrief; CLI-world taps per-agent `tokens_used` before it's summed away (`orchestrator.ts:653`). A `paradigm calibrate` pass rewrites `AGENT_TOKEN_ESTIMATES` (`orchestration.ts:289`) from a hardcoded constant into a **learned table** (constant becomes cold-start fallback at `n<8` samples). This is the literal "self-improving": the estimate shown was computed from what the crew actually spent.

### The falsifiable metric — JPS (journals-per-settlement)
`JPS = journal entries written / parent subtrees settled` over a trailing window. Every audit break collapses it to 0. **Flatline alarm:** `JPS == 0 across last 5 settlements (settlements > 0)` — five clean subtrees in a row is implausible enough to flag a dead chain (vs healthy "silence is signal" which only drops JPS toward a floor). Surfaced in `paradigm doctor` + `/paradigm:health`. A reviewer can break the chain on purpose and watch it flatline → "self-improving" is now falsifiable.

### What `claimant` enables
- **Archetype-fit signal:** predicted owner vs closing owner, aggregated per taskType → learned routing correction.
- **Reassignment-churn:** ≥3 claimant rewrites before settlement = `spec-clarity` antipattern (the blurb was under-specified). Distinguished from healthy peer handoff via `claimant.kind`.

---

## 2-rev2. The Learning Wiring (Loid) — post-adversarial (AUTHORITATIVE)

> Jinx's three findings were correct against the real code. This rev. replaces the fabricated belief-delta gate with a measured `confidence_after`, scopes loop-closure to the MCP world honestly, and replaces the circular JPS metric with a falsifiable pipeline-liveness probe. Each piece carries an explicit v7.0-vs-fast-follow line.

### 2.0 The confidence-prior decision (the crux) — DROP the delta gate for v7.0
The promotion gate (`nomination-engine.ts:942`, `confidence_after < 0.8`) runs on manufactured inputs: `confidence_after` is a branch literal (`ambient.ts:633-635` = 0.85/0.6/0.4) and `confidence_before` likewise (`:651,:697`). A delta gate over these is numerology.

**v7.0 takes option (b): drop the delta, keep the existing absolute `≥0.8` gate, make `confidence_after` REAL.** Add one optional `confidence?: number` (0–1) field to the agent's completion structure (`RelayOutput`, `agent-prompts.ts:55`, and the MCP verdict block). Thread it in `runPostflightLearning`: `const confidenceAfter = verdict.confidence ?? (verdict==='accepted'?0.85:verdict==='revised'?0.6:0.4)` — prefer the real number, fall back to the literal. **Zero corpus migration.** `confidence_before` stays in the type, marked not-gated (`// fabricated; not gated on — see v7.x`).

Option (a) — a real pre-task *prior* + belief-delta + swing-to-journal routing — needs a pre-spawn elicitation step and a journal-corpus migration (unbuilt infra). **Deferred to v7.x.** Honest cost: v7.0 gets *honest absolute-confidence* learning, not *belief-movement* learning.

### 2.1 Settlement scope — MCP-world only for v7.0 (CLI orchestrator is fast-follow)
`task-loader` is imported only by `tools/tasks.ts` + `tools/context.ts:725` (MCP). The CLI orchestrator (`core/orchestrator.ts`, `core/background-orchestrator.ts`) emits no tasks and completes via in-memory `markComplete` (`background-orchestrator.ts:265`). **v7.0 loop-closure is MCP-driven only** — the loop closes when agents/Cid drive the DAG through `paradigm_task_*`. Cost stated plainly: runs launched via the standalone CLI `orchestrate` binary don't feed the loop in v7.0; the dominant Claude-Code-agent path (MCP) does. **Fast-follow:** a thin `core/task-bridge.ts` adapter (run-start → `createTask`/`emitTaskDag`; per-result → `updateTask`; `markComplete` → `completeTask` → settlement). One new file + ~3 call sites.

### 2.2 Settlement state machine — corrected trigger (all-siblings-terminal)
New `utils/task-settlement.ts` → `settleParentIfComplete(rootDir, parentTaskId)`, idempotent via `settledAt`. Terminal set as a forward-compatible predicate: v7.0 = `{done, shelved, crashed}` (add `blocked-permanent` when `blocked` lands). **Trigger = every sibling terminal.** Hook placed **inside `updateTask`** (the real chokepoint, `:185`), gated on `isTerminal(updated.status) && updated.parentTaskId` — so `completeTask`, `shelveTask`, and direct status sets can't drift. **Reaper:** abandoned `in-progress` tasks past a staleness window (default 30 min) whose run is no longer live → transition to terminal `crashed` (so the subtree settles AND the liveness probe still fires). **Orphan policy:** missing parent ⟹ child self-settles + `warn`. *(v7.0 uses time-window liveness; PID/heartbeat is fast-follow.)*

### 2.3 The settlement chain + falsifiable liveness probe (replaces JPS)
Chain, in order: `recordWorkLog → (captain debrief → sessionInsights) → runPostflightLearning → autoPromoteJournalEntries`. **JPS replaced** (it can't distinguish clean-work-silence from a dead chain). Instead, each settlement writes one record to `.paradigm/events/settlement-liveness.jsonl`: per-stage `ok|threw|skipped` + `chainLive` (every non-skipped stage ok) + diagnostic-only `journalsWritten`/`promoted`. Each stage wrapped try/catch, record written in `finally` (a mid-chain throw still records *which* stage died). **Now distinguishable:** clean subtree = `chainLive:true, journalsWritten:0`; severed chain = `chainLive:false`. **Alarm (falsifiable):** any `chainLive:false` in trailing window (N=20) → WARN naming the stage; `chainLive:false` in ≥3 of last 5 → loud dead-chain alarm. A reviewer can comment out `runPostflightLearning`, run one settlement, watch it scream. Surfaced in `paradigm doctor` + `/paradigm:health`. *(Scheduled known-dirty canary = v7.x.)*

### 2.4 Calibration capture — write-only, gated on cheapness (v7.0)
`paradigm calibrate` learned-table rewrite is **cut from v7.0**. Capture-only: append `.paradigm/events/estimate-actuals.jsonl` `{archetype, taskType, estTokens, actualTokens, parentTaskId, settledAs, ts}` from the MCP settlement path **iff `agentActuals` is a pure projection of data Cid's debrief already assembles** (`captain.ts:651+`); if it needs new measurement plumbing, **defer wholesale to v7.x**. `AGENT_TOKEN_ESTIMATES` stays a hardcoded constant in v7.0.

### 2.5 Cid Stop-hook: advise, not guard
Session-close debrief checks "did postflight run?" (reads the liveness record). On a gap, Cid **self-heals** (runs postflight itself) then clears `.cid-briefed` normally; if self-heal throws, `paradigm_propose_block({claimant:'navigation', severity:'advise'})` — **never `guard`.** A learning-loop gap must not deadlock a human. Hard refuse stays reserved for correctness gates (missing `.purpose`).

### What `claimant` enables (v7.x analytics, reads the settled DAG)
Archetype-fit signal (predicted vs closing owner per taskType) and reassignment-churn antipattern detection — built on top of the settled DAG, write no new gates, not on the v7.0 critical path.

## 3. The Captain Surface (Cid)

### `paradigm_captain_board` — Cid's owned read+write artifact
`action: 'read' | 'claim' | 'advance'`. `read` assembles the live run-DAG (tasks by parentTaskId, ordered by dependsOn) + ripple-ranked `unclaimed` + summary — this is what the Conductor task-dashboard renders. **Cid's and only Cid's** write path for `claimant`, the live status transitions, and run-record `runStatus`.

### Session-open: trigger → action → artifact
Replace the anonymous static task dump (`context.ts:723-738`) with a **Cid-attributed** board read: rank unclaimed by ripple-risk (reuses brief's ripple machinery, `captain.ts:256-310`), surface top-5, and **propose claimants** (write `claimant` + `open→claimed`). That write is the durable proof the Captain did something. Human/peer claims override archetype proposals.

### Session-close: trigger → action → artifact
Debrief gains real checks before clearing the Stop hook: (1) did the run-record advance off `pending`? (2) did claimed tasks change status (else release stale claims)? (3) **did postflight actually run?** If not, debrief **refuses to write `.cid-briefed`** (today it writes it unconditionally, `captain.ts:645`) and returns a structured refusal — optionally `paradigm_propose_block({claimant:'navigation', severity:'guard'})`. The fake "→ Loid" handoff becomes enforcement Cid owns. On success, debrief **un-freezes** the run-record (`pending → done`) — the write `logOrchestration` never does.

### Ownership boundary (Cid ↔ Loid — both designers agree)
**Cid writes the present tense; Loid writes the past tense; they never co-write a field.**
- **Cid writes:** `status` (live transitions up to but not including the work-completer's `done`), `claimant`, `blocked_on`, `stage`/`parentTaskId`/`dependsOn` (at emission), run-record `runStatus`.
- **Loid writes:** `settledAt` only (the retrospective trigger), and everything in the learning stores (journals, notebooks, calibration). Loid is **read-only on all other Task fields.**
- Dependency arrow points one way: `status → settlement → learning`. Settlement never calls back to change status.

### Honest cuts (Cid self-policed)
`coverageGaps` stays in debrief (not re-rendered on the board); `inFlightSymbols` merges inline onto DAG nodes; `action:'advance'` narrows to `→blocked` only (orchestration owns in-progress/done). Test applied: *if removing it leaves a session where Cid mutates nothing, keep it; if it only re-displays what another owner writes, cut it.*

---

## Build sequence

1. **Sub-phase 0 — types & contracts** (no deps): new `Task`/`Claimant`/`TaskStatus`/`ExternalRef` interfaces; `AgentRelay` interface. Behavior unchanged.
2. **Sub-phase 1 — loader behavior** (deps 0): `normalizeTask` shim, `assertTransition`, 6-status `applyFilter`+`'active'` meta, 6-status index + `roots`, `parseAgentRelay`.
3. **Sub-phase 2 — emission & wiring** (deps 0,1): `emitTaskDag` + epic task; stamp task-id into the Symphony note loop; Symphony watcher → `updateTask`; widen MCP enums; delete dead `parseFilePlan*`.
4. **Sub-phase 3 — learning + captain** (deps 2): `settleParentIfComplete` chain; belief-delta gate; calibration capture + `paradigm calibrate`; JPS in `doctor`; `paradigm_captain_board`; Cid session-open/close rewrites.
5. **Front Door (parallel track, independent):** T-002 classifier fix, T-003 agent routability, T-001 notebook concept-key bug — these are quick wins that improve *this session's own tooling* and don't depend on the spine.

**Keystone-first:** sub-phases 0+1 make the DAG representable and legal; they unblock both the loop (2) and Cid (3) without either landing first.

## Scope boundary — v7.0 vs fast-follow

- **v7.0:** single-machine loop closure. `claimant.kind:'archetype'` (orchestration) + the full learning/Cid wiring. Schema supports `human`/`peer` from day one.
- **v7.x fast-follow — multi-human/multi-machine teams:** `generateTaskId` is per-machine-local-max → **collision/merge-heal risk on concurrent multi-machine DAG emission.** The Symphony transport + claimant union are ready; the gnarly concurrent-emit ID/merge machinery is the only piece deferred. This also matches the audit's discipline (don't build teams infra ahead of real multi-human demand) — the *schema* is teams-complete now; the *concurrent-write hardening* is the fast-follow.

## Adversarial review — required revisions before building §2 (Jinx, 2026-06-13)

The adversarial pass caught three keystone *wiring* claims that are **false or circular against the real code**. The Spine (§1) and `AgentRelay` cleanup are sound and may start now; **the learning wiring (§2) must NOT be built against the current spec.** Required corrections:

1. **`confidence_before` is not measured — it's hardcoded by branch** (`ambient.ts:651` = `accepted?0.7:0.8`; `ambient.ts:697-698` = literal `0.6/0.75`). The belief-delta gate would run on synthetic inputs (every self_reflection sits *exactly* on the 0.15 floor → deterministic promotion). **Fix:** agents must emit a *real* pre-task confidence prior in the `AgentRelay` payload, threaded into `recordJournalEntry` — or drop the delta gate and make `confidence_after` a real agent output, not a constant. No delta gate until a true prior exists.

2. **"Both worlds flow through `completeTask`" is false.** `task-loader` is imported only by `tools/tasks.ts` and `tools/context.ts` (both MCP). The CLI orchestrator (`core/orchestrator.ts`, `background-orchestrator.ts`) emits no tasks and uses an in-memory `markComplete` (`background-orchestrator.ts:265`) disconnected from the DAG. **Fix:** scope v7.0 loop-closure to **MCP-world explicitly** (CLI emission is fast-follow) OR wire task emit+done into the CLI spawn path. Do not claim coverage the code doesn't have — that's the audit's "consensus recorded as rigor" reproduced one layer down.

3. **JPS is circular, not falsifiable.** Clean work (silence-is-signal) and a severed chain both produce `JPS=0`. **Fix:** instrument the *pipe*, not the *output* — assert the chain `recordWorkLog→debrief→postflight→promote` executed end-to-end without throwing on each settlement (liveness of the pipe is falsifiable); volume of promotions is not. Optionally add a scheduled known-dirty canary settlement.

4. **Settlement only fires on `done`** — one `shelved` sibling, a `blocked` sibling, or a crashed run leaves the parent unsettled forever (the open-loop bug reborn). **Fix:** trigger settlement on *all-siblings-terminal* (done ∪ shelved ∪ permanently-blocked) from `completeTask` AND `shelveTask` AND `updateTask→blocked`; add a reaper for `in-progress` tasks abandoned by a dead run (settle-as-`crashed` so JPS sees it); define orphan policy (missing parent ⟹ self-settle child + warn).

5. **Cid's Stop-hook refusal is a user-facing deadlock.** Blocking the human from finishing because a *learning* step didn't fire inverts priorities. **Fix:** severity `advise`, not `guard`; Cid self-heals by *running postflight itself* before clearing. Reserve hard refuse for correctness gates (missing `.purpose`), never learning-loop liveness.

**Default-list bug is inverted from the spec's worry.** The two `loadTasks` consumers (`context.ts:726`, `tasks.ts`) pass *explicit* `status:'open'`, so changing the default touches neither — the real bug is they'll **keep hiding `claimed` DAG tasks** (session-open shows an empty board on a live DAG). Fix the call sites, not the default. Also: `related_assessments` is consumed at `tasks.ts:53,135` — keep it as a deprecated alias, don't silently drop it from the interface.

### Leaner v7.0 scope (adversarial cuts)
- **Ship 4 states** (`open|in-progress|done|shelved`), not 6. `claimed`/`blocked` justified only by Symphony peer-claims, which are fast-follow — add them when peer claims actually exist.
- **Cut `paradigm calibrate` + the learned token table from v7.0** — it depends on two unbuilt actuals pipelines; the hardcoded constant is fine until the loop first proves it can capture one real actual.
- **Keep `AgentRelay`** (load-bearing cleanup) and the Spine schema/DAG.

**Verdict:** Spine (sub-phases 0–1) is GO now. Learning wiring (§2) is REVISE-FIRST. Build sequence updated accordingly.

## Post-build self-documentation (required)

Once v7 lands, the framework must eat its own dog food:
- **Paradigm symbols** — register the new symbols via the `paradigm_purpose_*` MCP tools: `#task-settlement`, `#agent-relay`, `#captain-board`, the DAG-emission flow, the settlement `$flow`, any new `^gate`/`!signal`/`~aspect`. Run `paradigm_reindex`.
- **University content** — update the Paradigm University tenant pack to teach the new model (claimant-owned task DAG, the closed loop, Cid's board, belief-delta learning). New sections/entries for the v7 concepts.

Tracked as a task; owned jointly by Scribe (documentor, symbols) + Scholar/Sheila (University content), with Loid reviewing the learning-loop framing.

## Open questions for the team / Matt
1. **Default-list semantics** (`open` → `active`) — recommended yes (a claimed-task-invisible default defeats the keystone); changes every no-arg `task_list` consumer. Needs sign-off.
2. **Index race under parallel agents** — N parallel `updateTask` = N full index rebuilds racing; files stay truth. Recommend eventual-consistency (rebuild once at stage-reconcile).
3. **Epic claimant kind** — overload `archetype:orchestrator` vs add a 4th `kind:'orchestrator'`? Recommend overload (keep union at 3).
4. **Teams now vs fast-follow** (the one that's genuinely Matt's call) — see scope boundary above.
