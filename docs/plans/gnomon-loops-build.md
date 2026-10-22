# Gnomon loops: build plan for 8.0

Branch `feat/gnomon-loops` (worktree `a-paradigm-loops`), cut from `feat/gnomon` at `030fa52d`. Spec: `docs/specs/gnomon-loops.md`. Decisions: TD-2026-10-22-213 (scope), TD-2026-10-22-129 (ship in 8.0, build the dependencies). Bar: works to a degree; 8.0 is the starting point.

## Founder scope for 8.0 (2026-10-22)

- **Local models only.** Claude escalation (subscription opt-in) lands in 8.1; the validator refuses `use: claude|any` and `escalate` with "lands in 8.1".
- **Kept in 8.0:** continuous trigger, `call` nodes (pinned `id@hash8`), personal loops (`~/.gnomon/loops`).
- **Deferred to 8.1** (refused with "lands in 8.1"): envelope grants (default is none anyway), the `sentinel.incident.opened` and `cron` triggers, `bash` tools and LAN endpoints in act nodes, strictness signal scoring, voice on `loop-choice`, the reviewer profile, launchd.
- **Windows:** registry, trust and validate work; runs refuse `sandbox-unavailable` until W5 adds a `loop-check` backend.

## Dependency status (Arky, at 030fa52d)

| Dependency | Status |
|---|---|
| Oracle/read-only profile (M2.3) | missing: build `loop-check` (own profile name) |
| Scratch worktrees and refs (M2.4/M2.5) | missing: new `kernel/git/` |
| Strictness levels (M2.11) | partial: run modes built; levels are a null seam (run-mode.ts:46-51, 248) |
| Local routing (M1.8) | partial: unattended runs deferred (local-session.ts:47-50); supervisor refuses unattended opens (supervisor.ts:693) |
| Scheduler triggers (M1.9) | partial: only at/every; `attended:false` refused (automation.ts:97-102); static list (scheduler.ts:143) |
| Card kinds and classes | missing; pattern exists (card.ts:23-47, classes.ts:25-52, standing-grant.ts:48) |
| `paradigm_loop` MCP family | missing (families.ts:79-91) |
| fs watch | missing; pattern in modhost/host.ts:361 |
| `loop.*` kinds | inconsistent: event.ts:230 registers loop.open/row/closed as userland; fold only kernel-signed rows |

## Steps (braces = can run in parallel)

| # | Step | Size | Review |
|---|---|---|---|
| {1} | LP1 schema: `loop:v2` types, validator and canonical compile (`gnomon/src/loops/schema.ts`, export `@a-company/gnomon/loops`); `paradigm loop new\|validate\|list`; `paradigm_loop` file ops; compile to `.paradigm/loops/<id>.loop.json` (the kernel reads only the JSON); the 8.0 subset enforced | M | Aegis |
| {2} | Contracts batch, the one clientApiId move: card kinds `loop-trust`, `loop-choice`; kernel kinds `loop.trusted untrusted closure.changed run.started node notified landed land.waiting run.ended trigger.fired deleted`; `request.loop.*`; class rows and NEVER_STANDING; reserve every later kind | S | Aegis |
| {3} | LP2 registry, hash (canonical JSON, argv0 realpath and sha, argv files, gate-class closure, node's realpath for shebang scripts), the `loop-trust` root card, trust folds, `gnomon loop list\|show\|trust\|untrust\|trust-status` | M | Aegis (heavy), Mika copy |
| {4} | `loop-check` profile and check executor (copy via `git ls-files`, read-only node_modules, scrubbed env, process-control kill, tap/junit/tsc/json parsers, kernel-pinned builtins) | M | Aegis escape suite |
| 5 | LP3 runner core plus manual run: graph walk, budgets, ledger, restart fold, concurrency, toasts, `gnomon loop run\|pause\|resume\|runs\|logs`; first end-to-end loop | L | |
| 6 | LP4a schedule (daily/weekly with timezone and DST), trust predicate, dynamic registration, runner hand-off, `loop` idle holder (uptime), kill switch | M | |
| {7} | LP4b events: file.changed (per-repo watch), commit.landed, session.exited, approval.decide, continuous; `loop.trigger.fired` rows | M | |
| {8} | LP5 local model nodes: `LocalLane.openLoop()` with `origin:'loop'`, verdict parse else `unsure`, `unavailable` retries, permit scope `loop`, thrash k=3 | L | Aegis |
| {9} | Strictness-lite: per-repo levels via `request.strictness.set`, effective autonomy per node, L3 and brake pause | M | Aegis |
| 10 | LP6a scratch worktree (`kernel/git/`), `loop-act` profile, act nodes via gnomon-local read/write tools, protected goal inputs, propose card | L | Aegis |
| 11 | LP6b land: lock, refusals, symbolic-ref check, CAS update-ref, index, byte compare, atomic rename, wait/park, identity and trailers, revert detection. **Cut line:** if short, ship without this (act stops at propose) | L | Aegis (heavy) |
| {12} | LP7 agent ops: pre-gate for `loop.request` (run, pause, reads), `authoredBy` | M | Aegis |
| {13} | LP8 GUI Loops view (`loops-panel.ts`): list, detail, Pause all, `LOOPS n running` and keep-alive lines | L | Luna and Mika |
| 14 | LP9 templates (Examples A, B local, D) and a one-week field run on this repo, from step 8 on | S | |

## Notes from the LP1 review (Aegis, 2026-10-22)

- **Step 3 (LP2 hash):** the content hash is sha256 over canonicalJson of the PARSED definition (`loopContentHash` in `@a-company/gnomon/loops`), never the YAML or JSON file bytes, plus the §3.1 inputs. Hash argv0's shebang interpreter too: the compiled JSON records it as `argv0Interpreter` per check node, so the trust card can show it. Add the config closure to the compiled `protected` set.
- **Steps 3 and 5 (registry and runner):** the kernel refuses a `call` whose `id@hash8` pin is not the callee's TRUSTED hash, at registration and again before the call node runs. The validator's pin check (which compares against the callee file on disk) is advisory only. Act nodes may not edit any path in the compiled `protected` list, which spans the whole call chain.
- **Step 12 (agent ops):** `loop.request`'s `hsid` and `principal` come from the connection, never from the payload. Label `repo` as sensitive in the request row.

## Notes from step 3 (LP2 registry, hash and trust card)

- **Helper rebuild needed at release.** The signed helper 1.8.0 validates the card kind of every `decision.sign` batch (`rowTableRefusal` default: "no row table for card kind"), so it refuses a `loop-trust` allow until it is rebuilt from the updated `Protocol.swift` (row table `loop-trust`: exactly one `loop.trusted` row; dialog line `trust loop <scope>/<id> <hash>`). The TS mirror (`decision-batch.ts`) and the shared vectors (5 new `loop-trust` cases, regenerated by `scripts/gen-decision-vectors.ts`) are updated; the Swift tests read the same vectors. Decide at release whether the rebuild bumps the helper version (1.9.0) so the kernel can say "update the helper" instead of failing the touch.
- **Steps 4 and 5 (runner):** exec argv0 through `resolveArgv0()` (`kernel/loops/hash.ts`), the same resolution the hash used (a path word against the repo root, a bare name in `<repo>/node_modules/.bin`, then the session PATH), and run a `#!/usr/bin/env node` script under the kernel's node (`process.execPath`). Before every run and node call `registry.canRun(key)` after `registry.verify(key)`; before a call node, `registry.resolveCall(callerKey, nodeId)`.
- **Call pins:** a pin names the callee's `compiled.sourceHash` (loopContentHash of its parsed YAML, now in the compiled form), checked against the callee's TRUSTED record. The caller's content hash folds the callee's current full hash, so any callee change pauses the caller too (G-LOOP-21).
- **Payload fields beyond the step-2 reservation** (payloads are opaque; document them at the next contract move): `request.loop.trust|untrust|delete` take `repoKey` as well as `repo`, and trust takes an optional `contentHash`; `loop.trusted` adds `coreHash`, `closureDigest`, `sourceHash` and `rootSig`; `loop.paused` adds `scope`, `repoKey`, `contentHash`, `trustedHash`; `loop.closure.changed` adds `scope`, `contentHash`, `coreHash`, `files`; `loop.untrusted`/`loop.deleted` carry `scope` and `repoKey`. Step 5's `loop.paused`/`loop.resumed` rows need `{loopId, scope, repoKey}` to fold.
- **Closure origin** is a git heuristic (`gitClosureOrigin`): uncommitted, `Gnomon-Session:` or `Loop-Authored-By:` = agent; `Gnomon-Loop:` or a `@gnomon.invalid` identity = loop; else human. Steps 10-11 must stamp those trailers on loop and agent commits.
- **Known repos** come from kernel-signed `session.open{cwd}` rows (folded at boot) and a human request naming a repo; there is no persistent repo registry yet. `status.loops` (human class) carries the list, the waiting-trust count and trust-status.

## Notes from the step 4 review (Aegis, 2026-10-22)

- Check copies live in the kernel-owned `<home>/loop-work/check-<runId>/`, never inside the repo. The copy refuses any path that resolves outside the repo: a symlinked parent, a swap during the copy, or a `node_modules` link that points out.
- `kernel/loops/shebang.ts` is the one shebang parser. The executor and the registry hash (step 3) both use it. A script argv0 with no interpreter pin is refused.
- Builtins pin a digest of the paradigm CLI's whole dist dir. A builtin judges only through its JSON verdict.
- **Residual (8.0):** the `node_modules` dependencies of checks are not pinned, beyond the lockfile in the config closure. 8.1 either pins them or ships the builtins inside Gnomon.
- `git.clean` cannot judge from a copy with no `.git`, so it returns `error` until it runs kernel-side.

## Notes from step 5 (LP3 runner core)

- **Payload fields beyond the reservation** (opaque; document at the next contract move): `loop.run.started` adds `scope`, `repoKey`, `budgets`, `autonomy`, `parentRunId`; `loop.node` adds `loopId`, `type`, `round`, `edge`, `next`, `durationMs`, `detail`, `choice`, `cardId`, `evidence`, `calleeRunId`, `calleeComputeMs`; `loop.run.ended` adds `scope`, `repoKey`, `terminal`, `detail`, `rounds`, `computeMs`; `loop.notified` adds `text`; `loop.paused` from the runner adds `runId`; `loop.resumed` adds `scope`, `repoKey`, `reason`. `edge` + `next` + `terminal` are what `gnomon replay` needs (G-LOOP-17).
- **`@pause` reasons** reuse LOOP_PAUSE_REASONS: a `timeout` edge pauses `timeout`, an `unavailable` verdict `unavailable`, any other `@pause` edge `node-exit`. All are kernel pauses: resuming raises a hand-only `loop-choice` card (Aegis M3); no new card kind.
- **Kill switch** pauses every TRUSTED loop (untrusted ones cannot run anyway) plus every running one.
- **Aegis review (approve-with-fixes, applied):** day counters independent of run-record eviction; callee compute charged to the root caller (`rootKey`); card `timeout` → `@pause` and `stop` → a terminal (validator `CARD_EDGE` + runner), a card that cannot be raised ends `@stop`; the kill switch flag is synchronous and holds every key until resumed; a run-budget stop pauses `budget` and drops the rerun; untrust/delete stop the run; the trust gate walks the caller chain; recover() skips live run ids.
- **Builtins:** the daemon pins the paradigm CLI once (`paradigmCliResolver`: Node resolution of `@a-company/paradigm` from Gnomon, its dist digest). The signed app alone has no paradigm install, so builtins fail closed there; pinning at trust (on the card) is still the better design.
- **Open:** the GUI has no handler for `loop.notified` yet (step 13; the kernel writes the row and calls an optional `toast` port that daemon.ts does not pass).

## Merge rules with the Windows work (feat/gnomon)

- Merge `feat/gnomon` into this branch regularly, never the other way until both are done.
- Contracts (card.ts, event.ts, client-api.ts): loop entries in their own commented tail blocks; regenerate clientApiId once per merge, never hand-merge the hash.
- Re-embed the GUI bundle (`npm run embed --workspace=@a-company/gnomon-gui` in this worktree's main checkout) and update `packages/gnomon/test/web-units.test.ts` after every merge.
- classes.ts and standing-grant.ts: loop rows in a separate block; Windows' Hello list includes `loop-trust`, `grant.loop-envelope` and loop resume.
- Sandbox: don't edit session.ts:95-98 (W5); loops get new files and a `LOOP_CHECK_BACKENDS = {darwin}` registry.
- daemon.ts: one `wireLoops()` call; everything else in `kernel/loops/wire.ts`. dispatch.ts: one block for loop requests.
- Use the process-control and env APIs (W3), never inline POSIX calls. Follow the Windows test traps in `docs/plans/gnomon-windows.md`.

## Risks

YAML in a zero-dep kernel (hash and show only the compiled JSON); shebang argv0 (hash node too); the unattended-open door (supervisor.ts:693, local-session.ts:47: use the voice-clamp pattern); `loop-act` can't allow LAN (SBPL localhost only); agents have no userland append path (log-append.ts:117, a new pre-gate); `loop.row` is userland-registered; scheduler change under G-SCH-01; DST fixtures; repo copy cost (cap size); merge friction; uptime vs the wrapper's window-close path; the one-week field run on the critical path.
