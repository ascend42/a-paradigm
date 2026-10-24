# Gnomon orchestration and token economy (revision 3)

Author: Arky (architect). Learning side: Loid, `.paradigm/research/paradigm-8/gnomon-orchestration-learning.md` ("Loid §n"). Decision: TD-2026-10-24-341. Lore: L-2026-10-24-ascend-041208-001.
Revision 3 folds together revision 1 (architecture, context lifecycle, Cid pack), revision 2 (Loid's learning model) and the founder's direction: the session model is the conductor, and the roster sets the workers.
Source: the code on `feat/gnomon` as of 2026-10-23; all anchors refer to it. Claude Code behaviour comes from code.claude.com/docs/en/sub-agents. Anything marked "probe" must be measured before a builder relies on it.

## 0. The idea in one paragraph
The model the human picks for a session is the **conductor**. It holds the conversation, reads Cid's brief and decides how to delegate; Gnomon never swaps it. The **roster** says which Paradigm agents the conductor delegates to, and on which model each runs. Defaults travel with Paradigm, and the human can override them per repo in Gnomon Settings. Before each turn, **Cid's lane** works out, deterministically and with no model call, what is being acted on (symbols, files, gates, decisions). It composes a budgeted brief and a route, which is advice to the conductor filled in with roster models (e.g. `builder (sonnet) + aegis (opus)`). There are two cost dials: the conductor model and the roster map, and the human's choice wins. Context stays small over time through a recover slip on open and a checkpoint, fresh session and recover handoff before compaction. Everything is visible, every decision is a kernel row, and Loid's loop settles routes against outcomes the kernel observes.

## 1. What the code says, and what it forces
| Fact | Anchor | Consequence |
|---|---|---|
| Only the human switches a session's model | supervisor.ts:1787 | The conductor is the human's |
| argv is fixed per session; per-turn guidance is one extra block | supervisor.ts:1968-1979; desk-guidance.ts:12-16,57; adapter.ts:275 | Brief and route ride that block; the cached prefix is untouched |
| The appended system prompt is stable | host-guidance.ts:26; supervisor.ts:1099 | Nothing that changes per turn goes into it |
| mcp.json is written once at spawn (strict) | supervisor.ts:1027-1041 | Tool sets change per session, not per turn |
| Law 7: no Anthropic API from the kernel | local/endpoint.ts:17-31 | No Haiku router; cheaper models run as subagents; gnomon-local is the only tiebreak |
| The kernel has zero dependencies (G-SEC-01) | gnomon.md:1608 | Cid runs as a supervised userland child |
| Supervised-child pattern exists | voice/voice-child.ts:1-20 | gnomon-cid copies it |
| Staged repo-context plugin (`--plugin-dir`, read-only for the session, agent frontmatter incl. `model`) | repo-context.ts:20-30,55,544-565 | **The roster map is staged here** |
| `--agents`/`--tools` are kernel-owned; `--plugin-dir` is at most once | adapter.ts:161-187 | No argv grammar change |
| `.claude/**` and `CLAUDE*.md` are steering-denied | permission.ts:169-199; policy.ts:89 | The kernel provides agent files; the session can't |
| Context meter exists | supervisor.ts:416,1366; event.ts:677 | The handoff trigger is already measured |
| Claude Code compaction isn't detected for claude sessions | adapter.ts; local-session.ts:915 | Probe P1 (`compact_boundary`) |
| Offer-slip decide discipline | offer-router.ts:23-36,75,595-663 | Kernel slips and route slips copy it |
| Classifier confidence is a keyword share | orchestration.ts:2356-2417 | Calibrate any fallback band |
| Paradigm model resolution chain | orchestration.ts:233-324 | The roster default; AGENT_TIERS puts builder on haiku (decision R1) |
| Stale pricing table | orchestration.ts:2483-2487 | Never used for savings |
| Learning kinds are registered but nothing emits them | event.ts:236-252 | Turn them on (not a contract move) |
| Checkpoint stores; loading prefers the global copy | session-tracker.ts:76-88,148,401-449,471-492 | Take the newer copy; probe P2 |

## 2. Claude Code subagent model selection (headless)
**Precedence:** the per-call `model` parameter on the Agent tool, then the agent definition's `model` frontmatter, then `CLAUDE_CODE_SUBAGENT_MODEL`, then the main model. `CLAUDE_CODE_SUBAGENT_MODEL_FORCE=1` overrides all of them.
**Where definitions come from, highest first:** managed settings, then `--agents`, then `.claude/agents/`, then `~/.claude/agents/`, then a plugin's `agents/`.

What Gnomon does with that:
- **Staged agents.** The kernel stages roster agents into `<session dir>/context/agents/` with a `model:` line, so they appear as `project:<name>`. It reports any shadowing by same-named user agents (layers.ts:179).
- **Per-call model.** The conductor passes `model` on each Agent call, as the roster line in guidance tells it to. This is the live path: chip changes apply on the next turn.
- **General worker.** `CLAUDE_CODE_SUBAGENT_MODEL` is set in the session env to the roster's general-worker model.
- **No force by default.** `_FORCE` is offered only as a per-repo "strict roster" setting (R3).
- **Ground truth.** Subagent messages carry `parent_tool_use_id` and `message.model` (supervisor.ts:1349-1368), so the kernel logs which model actually ran.
- **Roster changes** apply to new sessions through frontmatter, and to the current session through the per-call parameter (probe P4 checks whether plugin agents reload).

## 3. Architecture
```
GUI/voice ─ request.session.send ─► dispatcher ─► SessionSupervisor.send (supervisor.ts:1926)
                     #turnGuidance(hsid) ─► composeGuidance(voice, desk, cid)  (ONE block; guidanceHash on turn.sent)
                                              ▲
                     CidLane.briefFor ─ fd-3 RPC cid-brief:v1 ─► gnomon-cid (userland child: navigator, premise-core,
                                              │                    classifyTaskLocal, roster resolver; read-only;
                                              │                    loopback to gnomon-local for the tiebreak)
session.open ─► RosterStager ─► <session dir>/context/agents/*.md + env CLAUDE_CODE_SUBAGENT_MODEL
turn.event ─► ContextMeter ─► KernelSlips ─► slip.shown ─► GUI/voice ─► request.slip.decide (human)
           ─► DelegationObserver ─► delegation.ran        ─► route-stats fold (like desk-stats.ts:48)
session.open ─► CheckpointReader ─► recover slip       HandoffOrchestrator ─► checkpoint turn → verify → open(continues) → recovery turn → retire old
#learning-loop (userland, Loid) ─► route.settled / route.audit / detector.event ─► .paradigm/learned/routing.json
```
**Where each piece runs:**
- **Kernel:** meters, slips, checkpoint reading, the handoff, roster staging, delegation observation, CidLane supervision, guidance, every row.
- **gnomon-cid:** the pack, floors, policy, roster resolution, the local tiebreak.
- **Session:** the conductor.
- **#learning-loop:** settlement and audits.
- **GUI:** slips, chips, dials, Settings → Roster, the digest.

## 4. The conductor and the roster

### 4.1 The conductor
- It's the session model, chosen at open or switched by the human; Gnomon never changes it.
- The new-session sheet shows two dials: `Conductor: <model>` and `Roster: repo default (n agents)`.

### 4.2 The roster map
`roster-map:v1`: `{agent → {model, source: paradigm|repo-override|session-chip}}` plus `generalWorker`.
- **Defaults** come from Paradigm's chain: config `model-resolution`, then the agent's `defaultModel`/`modelTier`, then AGENT_TIERS.
- **Proposed shipped defaults (R1):** explorer/search haiku; builder sonnet; tester sonnet; aegis, mika and arky opus; reviewer sonnet; documentor and mechanical work haiku; generalWorker sonnet.
- **Per-repo override:** Gnomon Settings → Roster, kept in Gnomon local state (never the repo). It wins over Paradigm; `.paradigm/config.yaml` `model-resolution` is the committed layer underneath it.
- **Validation:** models go through `claudeModelProblem` and agent names through the repo-context staging rules. Anything invalid is shown in Settings and never silently falls back.
- **Staging at open:**
  - one `.md` per agent;
  - the body is the Paradigm role prompt (`PLUGIN_AGENT_ROLES`) or a kernel template;
  - frontmatter is limited to the AGENT_KEYS allow-list (name, description, tools, model, effort);
  - the env var is set;
  - `roster.staged{hsid, mapHash, agents, generalWorker}` is logged.
- **Guidance:** one roster line in `<gnomon-cid>`, sent only when the map changes. Example: `Roster: delegate with the Agent tool. explorer→haiku, builder→sonnet, aegis→opus…; pass model explicitly.`

### 4.3 The route as advice
- **Shape:** an arm (direct → single → single+review → team) filled with roster roles.
- **Guidance line:** `Route: builder (sonnet) for the edit, then aegis (opus) reviews before you finish. Reason: touches ^portal-auth.`
- **Chip:** shows the roles and models, one reason, and the saving as relative conductor-equivalent tokens (R2). It's hidden for the direct arm.
- **Tap to change:** change the arm or a role's model. That writes `route.decided{override}` and a kernel-templated steer on the next turn. It never blocks sending.
- **Ran-state after the turn:** `ran: builder (sonnet) ✓, aegis (opus) ✓`, from the delegation rows. A mismatch is shown as information.

### 4.4 How Cid builds a route
1. `classifyTaskLocal` gives the type and score.
2. The pack gives the area, gates, ripple and aspects.
3. Floors:
   - ^gate or portal touched → at least single+review with aegis;
   - ripple across 3 or more components → team offered;
   - an enforced ~aspect with its owner on the roster → that owner reviews.
4. gnomon-local tiebreak, only inside the calibrated band (starts at [0.4, 0.6], 400 ms budget). It's removed if it doesn't beat deterministic routing after 100 settled calls.
5. Thompson sampling with hierarchical shrinkage. Never below a floor; exploration only goes up.
6. Roles are filled from the roster, and `route{arm, roles, propensity, pClean, floor?, areaIds, featureHash, reason}` is emitted.

There are two models in v1: risk and per-human preference. The model each role runs on is a human dial, recorded per role (R5).

## 5. Feature 1A: the recover slip on session open
- **Trigger:** a new Claude session (not a resume, not a handoff target, not a loop).
- **Reading:** CheckpointReader reads both copies under the paradigm-slice discipline (bounded, O_NOFOLLOW, realpath inside `.paradigm`, 64 KB) and **takes the newer**.
- **Recent (D1, decided):** ≤ 72 h, **any branch**, `phase ≠ complete`, not already decided, and not written by a live session in this repo. Checkpoints from 72 h to 30 days appear as a passive sidebar line only.
- **Provenance:** `from Gnomon` / `from a terminal session` / `found in the repo` (untrusted, Aegis A3).
- **Slip copy:**
  - title: `Recover where you left off: <context ≤ 90>`;
  - meta: `<age> ago · <branch><, you're on <current> when different> · <n> files · <provenance>`;
  - buttons: `Recover` | `Dismiss`;
  - voice, once: "There's a checkpoint from two hours ago. Say recover, or just carry on."
- **Recover:** a kernel-templated turn (`Continue where the last session left off. The recovery brief is attached.`) with the recovery brief in guidance. If the human types first, the slip retires as superseded.

## 6. Feature 1B: the pre-compaction handoff
- **Meter:** `s.contextTokens`. The window is 1M for `[1m]` models, else 200k. Unknown until the first message after a resume.
- **Thresholds (R6):**

  | Window | Advise | Strong |
  |---|---|---|
  | 200k | 140k | 160k (or the measured trigger − 15k) |
  | 1M | 250k | 400k |

  Each level shows once; dismissing it mutes that level.
- **Slip copy:**
  - Advise: `Context is 72% full. Checkpoint and continue in a fresh session?` → `Continue fresh` | `Not now`
  - Strong: `Context is nearly full: Claude will compact soon and may drop detail. Checkpoint and continue fresh so nothing is lost.` → `Continue fresh` | `Let it compact`
  - Armed: `Continuing fresh after this reply` → `Cancel`
  - Progress: `Saving checkpoint…` → `Opening a fresh session…` → `Recovered. The earlier session is in the sidebar.`
  - Failure: `The checkpoint wasn't saved, so nothing changed.` → `Retry` | `Let it compact`
  - Voice: "Context is nearly full. Say continue fresh to checkpoint and start a clean session."
- **Flow ($context-handoff):**
  1. **Boundary gate:** no permits outstanding, reply done, no pending card, no model switch in flight, no queued turns. Until then the slip shows Armed.
  2. **Checkpoint turn,** kernel-templated, calling `paradigm_session` (op checkpoint).
  3. **Verify:** a non-error tool result in this hsid plus a reread timestamp ≥ press time, within 90 s. Otherwise show Failure, change nothing, and log `handoff.failed{why}`.
  4. **Open the successor:** same cwd, worktree, **conductor model**, owner and mode, plus `continues`. Law 7 runs again; the roster is restaged; voice moves with it.
  5. **Recovery turn** with the brief, and `inject.receipt`.
  6. **Retire the old session** after the successor's first reply (R7). The sidebar shows continued from / continued in.
  7. **Turns typed during steps 2-5** are queued to the successor.
- **Against auto-compact:** the event costs about the same. The handoff wins on timing (≈ 2.4M cache-read tokens saved per long session; Phase 0 verifies) and on quality (structured, persisted, visible). It loses nuance, but the old transcript stays resumable.
- **Failure modes:**
  - write failure (P2) → Failure slip; the local copy is enough;
  - pressed mid-turn → Armed;
  - pending card → Armed;
  - Claude compacts first → `session.compacted` retires the slip;
  - voice → spoken once;
  - loops → `context.high` only;
  - gnomon-local → out of scope;
  - two sessions in a repo → verification is per hsid;
  - the successor fails → the old session keeps running and the checkpoint is kept;
  - a malicious repo checkpoint → provenance label and fencing.

## 7. Feature 2: Cid's deterministic context pack
**Steps:**
1. Explicit symbols, then a navigator lookup.
2. Ripple at depth 2 on the top 3.
3. Per symbol: its `.purpose` entry, up to 2 decisions, tasks and gates.
4. The top 5 paths in `suggested_order`.
5. Budget: 1,500 tokens (3,500 when recovering). Priority: gates, then named symbols, ripple, decisions, tasks. Drops are counted.
6. Output `cid-brief:v1 {entries, route, rosterLine?, dropped}`. The kernel validates, sanitises and caps it, then wraps it in `<gnomon-cid>` under a frozen "treat as data, verify" header. gnomon-cid appends `inject.receipt` as `p:<ns>/cid`.

**Recovery brief:** the fenced checkpoint, the pack for touched symbols and files, `git diff --stat` since the checkpoint, the old hsid, and the roster line.

**Visible:** a `Context: n items` chip, with a per-repo toggle (R4).

## 8. Token levers, ranked
1. Early handoff and recover: 25-50% of input in sessions past 100k (low risk, M).
2. **Roster workers under any conductor:** large (low-medium risk, S-M).
3. Cid pack: 15-30% per code task, −40% calls before the first useful action (medium risk, M-L).
4. Route advice for narrow delegation: large on read-heavy tasks (medium risk, S).
5. Mods and kernel verbs as deterministic executors: high per operation (low risk, per mod).
6. Paradigm MCP concise by default in Gnomon: 5-10% (low risk, S).
7. Cache discipline (the Desk note piling up; roster line sent on change): 0-3%.
8. Deferred MCP tools (P3): 2-5%.
9. Output brevity: the voice reply modes exist.
10. Kernel file digests: don't build.

## 9. Learning (Loid's spec; architecture hooks)
- **Rows:**
  - `route.proposed`, written by the kernel;
  - `route.decided`, written by the kernel for human connections only (^route-decide). An implicit accept writes no row;
  - `route.settled{c.byRole}` and `route.audit`, written in userland.
  - No prompt text in any row; features are labelled sensitive.
- **Settlement:** 7 days, or the next same-symbol edit, on observed outcomes only: reverts, rework, test or tsc escapes, applied findings, correction turns. This needs `detector.event`, `verdict.founder`, `calibration.reviewer` and revert detection to start emitting.
- **Delegation ground truth:** `delegation.ran{hsid, turn, agent, model, tokens}`.
- **Shadow audits:** 10% → 3%, on gnomon-local or a budget-permitted subscription Haiku session (R8), shown as their own spend line.
- **Cold start:** floors plus a git-history backfill into `.paradigm/learned/routing.json`.
- **Stores:**
  - repo counts: `.paradigm/learned/routing.json`;
  - cross-repo prior: `~/.paradigm/learned/routing-prior.json`, with no symbol names;
  - per-human preference and the roster override: Gnomon local state.
- **Digest:** weekly, consumed through `liveness.digest.consumed`.
- **Ownership:** Cid proposes and enforces floors; Loid settles; Aegis and Rune certify floors; Sensei distils.

## 10. Symbols
- **Modified:**
  - #supervisor
  - #desk-guidance
  - #claude-adapter
  - #session-tracker
  - repo-context staging
- **New:**
  - kernel: #kernel-slips, #context-meter, #checkpoint-reader, #context-handoff, #roster-stager, #delegation-observer, #route-stats, #cid-lane
  - userland: #gnomon-cid
  - GUI: #roster-settings
- **Flows:** $context-handoff, $checkpoint-recover, $turn-brief, $roster-staging, $route-settlement.
- **Gates:** ^slip-decide, ^route-decide.
- **Signals:** !slip-shown, !slip-decided, !handoff-completed, !handoff-failed, !route-proposed, !route-decided, !route-settled, !roster-staged, !delegation-ran, !session-compacted.

## 11. Contract changes (one batch, R9)
- **Kernel:**
  - `slip.shown|decided|retired`, `request.slip.decide`
  - `route.proposed|decided`, `request.route.decide`
  - `session.open{continues?, checkpointHash?}`
  - `handoff.started|completed|failed`
  - `session.compacted`
  - `context.high`
  - `roster.staged`
  - `delegation.ran`
- **Userland:** `route.settled`, `route.audit`.
- **Schemas:** `cid-brief:v1`, `roster-map:v1`.
- **Emitted, already registered:** `inject.receipt`, `detector.event`, `verdict.founder`, `calibration.reviewer`, `liveness.digest.consumed`.
- **Paradigm:**
  - calibration groupBy gains `route|area|classifierSource`;
  - `.agent` gains `defaultModel` (or reuses `modelTier`).

## 12. Phased plan

### Phase 0: measure, probe, backfill (about 1 week; no behaviour change)
- The `turn.economy` fold:
  - model calls per turn;
  - Read/Grep/Glob before the first edit;
  - context at turn start;
  - cache-read share;
  - subagent tokens by model.
- Probes:
  - P1: compact_boundary;
  - P2: the sandbox and the global checkpoint write;
  - P3: deferred tools;
  - P4: plugin-agent `model`, the per-call `model`, mid-session reload, and the env var in the sandbox.
- The routing backfill; `detector.event` and revert detection start emitting.
- **Exit:** baselines and probes recorded, and the backfill present.

### Phase 1: context lifecycle and roster
- Ship the recover slip, the handoff, the roster map, Settings → Roster, RosterStager, the env worker, DelegationObserver, and the conductor and roster dials.
- **Metrics:**
  - handoff verified ≥ 95%, with zero lost turns;
  - median context per call −35% after 140k;
  - ≥ 50% of subagent tokens off the conductor model on Opus-conductor sessions;
  - roster mismatch rate tracked.

### Phase 2: the Cid pack
- Ship gnomon-cid, `<gnomon-cid>`, receipts, the context chip, Paradigm concise by default, and the roster line sent on change.
- **Metrics:**
  - tokens per clean outcome (primary);
  - −40% calls before the first useful action;
  - no rise in rework.

### Phase 3: route advice and learning
- Ship floors, route rows, the role chip with its saving, tap-to-change, route-stats, the settler, shadow audits, the digest, the preference model (after 30 decisions) and the scenario bank.
- **Metrics:** Loid's week-6 falsifiers:
  - Brier beats a constant baseline on ≥ 150 settled routes;
  - the shadow under-route rate is ≤ cold start;
  - overrides trend down;
  - the local tiebreak beats rules, or it's removed.

### Phase 4: small levers
- Deferred tools, send-on-change notes, mod operation hints, and strict roster.

## 13. File plan
- **Types:**
  - contracts `event.ts`
  - `kernel/desk/slip-copy.ts`
  - `kernel/roster/roster-map.ts`
- **Core:**
  - `kernel/desk/{kernel-slips,checkpoint-read,context-handoff,route-decide,route-stats}.ts`
  - `kernel/supervisor/{context-meter,delegation-observer}.ts`
  - `kernel/roster/roster-stager.ts`
  - `adapters/claude-code/adapter.ts` (compact_boundary)
  - `packages/gnomon-cid/`
  - `kernel/cid/cid-child.ts`
  - paradigm-mcp `session-tracker.ts` (newer copy wins)
  - the routing backfill command
  - lore.ts groupBy
  - the #learning-loop settler and shadow audit
- **Integration:**
  - `daemon.ts:1249` wiring
  - `socket/methods.ts`
  - the supervisor open path (staging, env, `continues`)
  - GUI slips, chips, dials, Settings → Roster, session links and digest (Atelier gate)
  - `.purpose` files
- **Tests:**
  - decide refusals
  - every handoff failure row
  - checkpoint traversal and any-branch recency
  - meter windows
  - roster staging validation, allow-list, env and shadowing
  - delegation `message.model`
  - floors and upward-only exploration
  - no prompt text in rows
  - the settler window
  - brief budget
  - Windows CI traps

## 14. Reviews
- **Aegis:**
  - A1: the gnomon-cid profile
  - A2: ^slip-decide and ^route-decide, including voice
  - A3: checkpoints as untrusted input
  - A4: only kernel-templated turn bodies
  - A5: the successor runs law 7 again
  - A6: brief redaction
  - A7: the Haiku shadow-audit profile
  - A8: staged agent frontmatter and bodies (no hooks, permissionMode or mcpServers; tools no broader than the role)
  - A9: the ^gate floor
  - A10: no prompt text or per-human data in stores
- **Rune:** the ~aspect floor.
- **Loid:** Phase 3, the correction-phrase list, the reviewer discount, and R5.
- **Mika:** slip copy and states, the route chip, the dials, Settings → Roster, the context chip, session links, the passive checkpoint line, and the digest.

## 15. Risks
- **A wrong brief** → "verify" framing, receipts, credit and the toggle.
- **Cheap workers degrade quality** → shadow audits, per-role settlement and gate floors.
- **The conductor ignores the advice** → ran-state is shown; strict roster is opt-in.
- **A user agent shadows a roster agent** → detected and shown.
- **The handoff loses nuance** → the old transcript stays resumable.
- **Recovery reads a stale global checkpoint** (session-tracker.ts:407-413 vs :487) → confirm with P2, then file it under the framework-bug protocol (Cid).
- **The contract batch is heavy** → one move.

## 16. Founder decisions
Decided:
- D1: any branch, 72 h.
- The conductor-plus-roster shape (TD-2026-10-24-341).

**Ruled 2026-10-24** (see the decision following TD-2026-10-24-341):
- R1: balanced roster defaults.
- R7: stop the old session, keep it resumable.
- **R4: the Cid brief is opt-in per repo.**
- **R6 and R11: the handoff thresholds and the handoff steps are customizable in Settings** (defaults 70% and 80% of the window, all steps on).
- All others as recommended.

Original list, kept for reference:
- **R1.** Shipped roster defaults. Builder on sonnet means changing Paradigm AGENT_TIERS (builder, tester and documentor are on haiku today).
- **R2.** The chip's saving unit: relative conductor-equivalent tokens (recommended), raw tokens, or dollars.
- **R3.** A per-repo "strict roster" (`_FORCE`): available, off by default (recommended).
- **R4.** Cid pack on by default with a per-repo toggle (recommended), or opt-in.
- **R5.** Should a role's model become a learned dimension later, or stay a human dial?
- **R6.** Handoff thresholds: 140k and 160k for 200k windows; 250k and 400k for 1M.
- **R7.** After a handoff, stop the old session (recommended) or leave it idle.
- **R8.** Shadow audit model: gnomon-local only, or also a budget-permitted Haiku session.
- **R9.** One contract batch for the slip, route, roster, handoff and delegation kinds.
- **R10.** Allow a human down-override below a floor, logged (recommended).
- **R11.** An opt-in per-repo "Always continue fresh". Never for loops in v1.
- **R12.** Fix or retire the stale MODEL_PRICING (orchestration.ts:2483).
- **R13.** Pre-register the moat numbers (Loid §5.3), and publish failures.
