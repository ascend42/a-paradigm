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
| 6 | LP4a schedule (daily/weekly with timezone and DST), trust predicate, dynamic registration, runner hand-off, `loop` idle holder (uptime), kill switch | M | built (#loop-timers) |
| {7} | LP4b events: file.changed (per-repo watch), commit.landed, session.exited, approval.decide, continuous; `loop.trigger.fired` rows | M | built (#loop-events) |
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

## Notes from step 6 (LP4a schedule, uptime, kill switch wiring)

- **Time zone.** `loop:v2` states no tz, so daily/weekly loop times are read in the daemon's zone (the host's IANA zone, `wireLoops({tz})` seam). The automation record carries the tz explicitly (`{daily: {at, tz}}`), so the timer is still a pure function of the record and the due rows; a host zone change re-keys the timer. Adding an optional `tz` to the schema is a schema change for a later step.
- **DST** (`kernel/scheduler/zoned.ts`): one fire per local date; a time skipped by spring-forward fires at the end of the gap (02:30 → 03:00 local), a repeated one once at its first occurrence.
- **status.loops.uptime** `{enabled, running, waiting: {n, of}, keepingAlive, line, nextDueAt}` (nested, because `status.loops.running` is already the runner's list). The `loop` idle holder holds while any loop timer has a next due instant at all (not only inside the scheduler's 10 min horizon): with no launchd until 8.1, a daily loop would otherwise never fire once the daemon idle-exits (D1).
- **Wrapper:** closing the window already hides it and keeps the kernel (gnomon-wrapper `main.rs` `CloseRequested`); only Cmd-Q stops it. No wrapper change.
- **Continuous** next runs are in-memory one-shot timers (end + cooldown); after a restart a continuous loop starts cooldown after boot. A refused continuous start gets no next run until the next local day (or a resume).

## Notes from step 8 (LP5 local model nodes)

- **The one unattended open** is `supervisor.openLoop(ref, req)` → `LocalLane.openLoop`, only with a run reference `registry.runRef()` mints for a trusted, runnable loop (module-private WeakMap; forged or released ⇒ FORBIDDEN). `open()` keeps its blanket refusal.
- **Payload fields** (opaque; document at the next contract move): `session.open` uses the reserved `origin`/`loopRun` plus `principalClass:'kernel'`; `session.inject{channel:'loop', receipt[]}`; `session.refused{code:'model_unavailable', origin, loopRun, why}`; `loop.node` adds `role`, `class`, `confidence`, `model{asked, used, escalated, endpoint}`, `usage{tokens}`, `permitId`, `hsid`; `loop.paused{reason:'thrash', detail}`.
- **Profiles:** `model.profile` names a configured endpoint `id` (the root-signed local config has no profile field yet).
- **Loops opt-in:** endpoints serve loops only with `loops: true` in the root-signed local config (Aegis); existing configs must be re-signed to enable model loops.
- **Aegis review applied:** issued-once run-reference minter (runner vouches), live() checks kill hold and strictness, abort checks after spawn and before ask, the clamp wired into the supervisor permission path, budgeted prompts, no model text in `why`, thrash carried across runs via `loop.round{evidenceHash}`.
- **authoredBy** is `file` on every card line until step 12 stamps it from request rows.
- **Thrash** watches loops with model or write steps (check evidence hashed per round).
- **Step 10 (act):** extend `openLoop` (role act, tools, scratch worktree) and hook `loopClampAllows`/`withLoopOrigin` into the permission path; step 12's pre-gate can use `supervisor.isLoopSession(hsid)`.

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

## Notes from step 9 (strictness-lite, M2.11-lite)

- **Payloads** (opaque; document at the next contract move): `request.strictness.set{repo, to}` as the spec registry (`repo` a key or an absolute path, as `request.mode.set`); `approval.strictness.raised|lowered{repo, from, to, cause:'manual', by, presence}`; `loop.node` adds `capReason`; the loosening card is `strictness` with `detail.op: 'level.loosen'` (no standing tuple, hand-only).
- **Default L0**, not the D87 L1 floor (that waits on Move 3's calibration). Concurrency follows the spec's root-config defaults (`strictness.concurrency` L1 2, L2 1) until that config is read.
- **Brake:** a level raise, or a repo run-mode tightening, pauses the repo's running loops at once (`loop.paused{reason:'strictness'}`, a kernel pause: resume takes presence). A strictness pause does not lift by itself when the level drops.
- **Land:** `landDecision()` in `kernel/loops/strictness-cap.ts` is what step 11 calls at land, with the cap re-read.

## Notes from step 7 (LP4b event triggers)

- **Continuous** was built in step 6 (#loop-timers); step 7 adds `file.changed`, `commit.landed`, `session.ended` and `card.decided` in `kernel/loops/events.ts`. `sentinel.incident.opened` stays refused at validation.
- **Payload fields beyond the reservation** (opaque; document at the next contract move): `loop.trigger.fired` adds `scope`, `repoKey`; its `trigger` is `{type:'event', kind, fireId, count, path | sha+ref | hsid | cardId+loop+node}` and `eventId` is the source row's id (log-sourced kinds only). `loop.run.started.trigger` carries the same `fireId`; replay (`LOOP_REPLAY_KINDS`) joins them as `why`.
- **Step 11 must write `loop.landed{runId, sha, paths}` BEFORE it moves the ref** (Aegis step 7). A commit is a loop's own only when a kernel-signed `loop.landed{sha}` row names it, never because of a trailer or a `@gnomon.invalid` identity, which anyone can write. A row written after the ref moves races the 250 ms settle, and the loop would trigger itself (G-LOOP-15). While a run is active, changes in its `land.paths` count as its own, as do changes for 60 s after a `loop.landed{paths}` row.
- **Hand-off first (Aegis step 7):** a fire calls `runner.start` before writing anything. Only a run that starts or queues writes `loop.trigger.fired`. A coalesced fire (the rerun flag is already set) or a refused one (day caps, pause, strictness) writes no row; `dropped()` counts it per loop. Replay joins a run to its row by `fireId` over the whole history, because the row follows `loop.run.started`.
- **Model inputs:** the hand-off trigger carries kernel ids only (`sha`, `hsid`, `cardId`, `loop`, `node`). The path and ref stay in the row and never reach `trigger.payload` (model-node.ts `TRIGGER_FIELDS` still lists `path` for other trigger types).
- **Git dirs** are validated as git links them: the `.git` dir is not a symlink; a worktree's `gitdir` is a real `<common>/worktrees/<name>` that links back, and its `commondir` is that `<common>`. Anything else is refused. The watches cover HEAD and packed-refs (non-recursive) and the `refs/heads` tree, never the whole git dir.
- **card.decided** matches only cards a run raised through `loop.notified{cardId}` in the same repo; a loop's trigger on its OWN card never fires (the decision is in that run's causes chain).
- **session.ended** fires only for sessions whose `session.open{cwd}` is inside the loop's repo.
- **Linux:** recursive fs.watch is Node's userland walker there; the real-watch tests are skipped on Linux, the deterministic ones (handleFsEvent, checkRefs) run everywhere. A watch that cannot start is a `loops.watch-unavailable` diag, not an error.

## Notes from step 10 (LP6a: scratch worktree, act nodes, propose)

- **Scratch: plumbing reads plus a kernel-owned copy, not `git worktree add`** (`kernel/git/scratch.ts`, #loop-git). `worktree add` writes the human's `.git` (`worktrees/<name>`, an index) and runs a checkout that applies the repo's smudge/eol filters and a post-checkout hook. The step 3 review removed kernel git calls that act on repo config. Instead the kernel reads with hardened plumbing only (`rev-parse`, `ls-tree -r -z -l`, `cat-file --batch`: raw blobs, no filters, no checkout, no hooks; `HARDENED_GIT_FLAGS` and a clean `hardenedGitEnv` with no inherited `GIT_*`). It writes the HEAD tree into `<home>/loop-work/act-<runId>/tree` (0700, outside the repo, no `.git`). These reads write nothing to the repo, the same footing as step 4's `git ls-files`. They run in the kernel, not under a sandbox profile: plumbing with `core.fsmonitor` forced off starts no program from repo config. A `git` sandbox class is still owed (G:1557). G-GIT-01's test plants a smudge filter and a post-checkout hook: neither runs, and the checkout and `.git` stay byte-identical.
- **Park repo.** Parked commits live in a kernel-owned bare repo, `<home>/loop-work/park/<repoHash>.git`, at `refs/gnomon/loops/<id>/<runId>`. Its objects borrow the human's through `objects/info/alternates`. The human repo gets no ref and no object in step 10. **Step 11** must move the commit into the human repo under the land lock, or fetch it from the park repo with the hardened flags. If the human gc's away the base commit (a rewritten branch), a parked ref past retention can dangle; the sweep drops refs past `LOOP_RETENTION_DAYS` (14 until `loops.retentionDays` is read).
- **Checks in an act run copy the scratch** (`CheckExecInput.scratch`; the file list is walked by the kernel; node_modules links must still resolve inside the human repo). A called loop with act nodes is refused, and `effect: write` checks are still refused (not built in 8.0).
- **The clamp.** The supervisor's Claude auto-passes were already behind `mayAuto` → `loopClampAllows`. No 8.0 loop session is a Claude session (local only), so `loopOrigin` stays unset there until 8.1 escalation. The local act session has no per-tool approval: its tools are fixed at open by `loopActTools` → `loopClampAllows('loop-trust:<cardId>#tool-read|edit')`. No trust card means no tools, so the open is FORBIDDEN. The kernel line now reads "Raised by loop X (claimed by Y)" or "(from the loop file)". The GUI parser (`gnomon-gui/src/core/loops.ts` RAISED_RE) accepts both.
- **Protected inputs (Aegis H2)** are enforced in the gnomon-local child (`protect.ts`; the kernel's glob dialect, case-insensitive). The set is the registry's compiled `protected` list (goal.inputs, the config closure, argv-named paths, callees') plus `ACT_ALWAYS_PROTECTED` (node_modules, `.paradigm/loops/**`, `.gnomon/**`). A hit returns `protected-input:` with no card. The kernel collects it (`LoopTurn.protectedHits`) and the node fails, with `protectedHits` on `loop.node`.
- **Payload fields** (opaque; document at the next contract move): `loop.parked` adds `sha`, `baseSha`, and `reason` is `propose` or the stop reason; `loop.proposed` adds `hazards`, `ref`, and `why` is `land-hazard | autonomy | auto-land-later`; `loop.node` adds `protectedHits`; `session.routed` adds `allowTools`; `session.sandbox.profile` is `loop-act`. The propose card is `kind: 'verdict'` with `detail.op: 'loop.propose'`. Accept keeps the ref; reject drops it.
- **Helper rebuild:** `gnomon-local` changed (`tools`/`protect` in the session config), so the runner pin's tree hash changes and the root-signed local config must re-pin the runner at release.
- **Open:** (1) the `loop-act` profile has no darwin escape suite yet; the e2e uses the launch-plan seam, and Aegis should run one (connect to another port, write outside the scratch, read the repo, exec). (2) A daemon restart mid-run leaves the scratch unparked until the retention sweep; the spec says to park it at restart. (3) GUI: the verdict card renders with the generic verdict family and joins its loop through the kernel line. Mika may want a loop-propose variant with the diff as data. (4) The GUI bundle must be re-embedded in the main checkout (web-units hash) at the next merge.

## Notes from the step 10 Aegis review (merge after fixes, applied)

- **H1** (verified: link entries were created in tree order, so a link `x` came before `X/y`): trees whose paths or parent prefixes collide under `normalize('NFD').toLowerCase()` are refused. Parents are created one component at a time, each lstat'd. Before every file, link and node_modules link, `realpath(dirname(dst))` must equal `treeReal/relDir` exactly.
- **M1:** every scratch read is `O_RDONLY|O_NOFOLLOW|O_NONBLOCK` plus fstat (a regular file, `nlink === 1`, capped); links are read with readlink after lstat. A FIFO, socket or device in the scratch is refused. Park checks each blob against the oid `scratchChanges` hashed (L4), under `PARK_LIMITS` (32 MiB per file, 128 MiB in total, L5). The runner awaits `model.settled(runId)` (every act session of the run has exited) before it parks. The profile denies `process-fork`, so the child has no descendants.
- **M2:** an endpoint on a port the kernel denies to sessions is refused `sandbox-unavailable`, and those denies are appended again after the allow.
- **M3:** names with control, format or bidi characters, or a component over 255 bytes, are refused in `resolveWrite`, `listScratchFiles` and `createScratch`. Card lines escape them visibly (`\u{…}`). Hazard paths are always in the reasons.
- **M4:** `GIT_ALLOW_PROTOCOL=none`; git is resolved once to an absolute path and must be at least 2.39.4. There is no `safe.directory`: the repo and its common dir must belong to the kernel's uid instead. `commit-tree` runs with `-c commit.gpgSign=false --no-gpg-sign`.
- **M5:** the diff is parsed by structure (headers only between `diff --git` and the first `@@`).
- **L1:** an `objectsDir` containing a newline or starting with `"` is refused. Residual: writing an object the human store already has (`hash-object -w` through alternates) makes git freshen that object's mtime in the human's `.git/objects`. That is metadata only, never content, and G-GIT-01's byte snapshot covers only the case where the blobs are new.
- **L2:** the realpath of `--show-toplevel` must be the repo, and `GIT_CEILING_DIRECTORIES` is set. **L3:** node_modules grants are re-validated in `darwinLoopAct`.
- **L6:** the profile denies fork, signals to any process but itself, executable mapping of the scratch and tmp, deleting or renaming those two dirs, and reads of the git common dir and sibling worktrees. **L7:** a new `execution-surface` hazard class covers `.husky/`, `.github/workflows/`, `.vscode/{tasks,settings}.json`, `.envrc`, `.gitattributes`, `.gitmodules` and any `package.json`. **L8:** the spec is updated for the scratch location and for restart (the sweep removes the stale scratch).
- **Escape suite** (`test/loop-act-sandbox.test.ts`, real sandbox-exec): every case is denied, including hard links (`link()` is EPERM everywhere, so M1 stays medium), renames, deleting the tree, node_modules writes, every listed read, the other ports, the kernel port and socket, the mDNSResponder socket, DNS, every exec (sh, env, a shebang script, a node copy, node itself and a detached child, because fork is denied), SIGSTOP and dlopen from tmp and from the scratch. **Residual, measured:** SBPL's `localhost:<port>` matches the machine's own addresses, so the endpoint port on the host's LAN address reaches the same host's listener; the same port off-host is EPERM. Pasteboard and LaunchServices `mach-lookup` cannot be reached from node with exec denied (not separately probed).

