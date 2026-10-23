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


## Notes from step 11 (LP6b land)

- **Policy (founder decision, step 11 follow-up): 8.0 is approve-to-land.** Nothing lands without the human accepting the propose card, at any level. `#autoLandBlockers` (runner.ts) returns `auto-land lands in 8.1` while `LOOP_AUTO_LAND` is false; the auto path it guards (effective autonomy `act` at land, `@goal` on a check, a `land` block covering every path, no `decide: before-land`, no gate-class path, not held, no land hazard) stays built and tested behind that seam (the runner's `autoLand` test option, the lander's `how: 'auto'` re-gate, a landDecision unit test). The card is hand-only; accept (fresh presence) lands. The trust card of a loop with act nodes and a land block says "Proposes changes to your current branch; nothing lands until you accept the card." (Aegis M6, adapted).
- **Mechanics** (`kernel/git/land.ts`, #loop-land): the per-repo in-process lock AND the human's own `index.lock` (O_EXCL, released by renaming the new index over `index`, or unlinked only if still our inode). No checkout, filter or hook ever runs; every call is hardenedGit with GIT_CEILING_DIRECTORIES and GIT_LITERAL_PATHSPECS (check-ignore refuses literal pathspecs and runs without it). Objects are read from the park repo, re-hashed in the kernel and written with `hash-object -w` (no fetch, so GIT_ALLOW_PROTOCOL=none stays), then `rev-list --objects --missing=error`. The commit is re-made at land with the D3 identity and trailers (`On-Behalf-Of` = the trust record's `by`, `Trusted-By` = the loop-trust card, `Loop-Authored-By` = authoredBy; a `Symbols:` line keeps only symbol tokens).
- **Order**: refusals under the lock → objects → private index copy → `loop.landed{phase:'intent'}` (beforeLand, G-LOOP-15) → files → index written and verified into the held lock → CAS `update-ref <ref> <new> <base>` → HEAD re-checked → index renamed → `loop.landed{phase:'done'}` (Aegis H1, M4). Files are placed BEFORE the ref, so "nothing lands" holds for a byte change or a CAS failure: every placed file is put back from its moved-aside original. Placement never replaces: the original is renamed aside and re-compared to the base blob, the new bytes are a temp file (old permission bits kept, exec only per blob mode) **linked** in with `link()` (a symlink with `symlink()`), so a file the human recreates in between is never overwritten. Temps are created at placement, so a parent swap caught at the first verify leaves nothing behind.
- **Contract reuse**: no new land-wait reasons (that would move clientApiId). Detached HEAD, another branch and a moved branch are `branch-moved`; strictness, trust and the kill switch are `held`; a swapped parent is `bytes-changed`; a `.git` component is `gate-class`; core.autocrlf/eol/splitIndex/sparseCheckout are `attributes`. Each row carries a `detail`. Name `detached`, `strictness`, `escape` at the next contract move.
- **Payload fields** (opaque; document at the next contract move): `loop.landed` adds `scope`, `repoKey`, `parkedSha`, `baseSha`, `ref`, `how` (`auto|approved`), `cardId`; `loop.land.waiting` adds `detail`, and `undone`+`sha` when a written row was put back; `loop.parked` adds `detail` and reason `land` (handed to the lander) and the land reasons; `loop.proposed.why` is `land-blocked` (was `auto-land-later`) with `blockers`; `merge.reverted` adds `revertSha`, `loopId`, `runId`, `scope`, `repoKey` (`trailer` and `nodeId` unused).
- **Self-trigger**: landed paths now match exactly (a path holding `*` was a glob), and a `loop.landed` row names its loop by its own `scope/repoKey/loopId`, so an approval days later still suppresses the loop's own commit and file events.
- **Revert detection**: `findRevert` (read-only git) per landed sha inside the 14-day window, at boot and every 60 s: a later commit on the landed ref that restores every landed path's blob (content) or says `This reverts commit <sha>` (message). One `merge.reverted` per sha. A reset that drops the commit is not a revert. Strictness scoring of the signal is 8.1: nothing tightens yet.
- **Wait/park**: waitable refusals (dirty, untracked add, human turn, index.lock, in-progress, L3/manual) write one `loop.land.waiting` per reason and retry every 30 s and on every `turn.result`/`session.exited`, until `land.maxWaitMin` (default 120), then `loop.parked{max-wait}` and a toast. The human-turn check is the supervisor's own streaming state for live Claude and local attended sessions whose cwd is inside the repo. An approved land is not stopped by L2 (it is the human's decision). The kill switch parks every waiting land, approved or not (Aegis M3). L3/manual makes it wait; a trust change parks it.
- **Residuals**: (1) Node has no `*at()` calls: each step re-verifies the parent chain and the held dir inode before and after, and no step replaces a file, but a same-uid process swapping a parent between a verify and the next syscall can still leave a kernel temp or a moved-aside original in the moved dir. (2) A daemon restart drops waiting lands from memory; the boot reconcile parks them (`restart`, a toast) and their commits stay parked until retention. (3) Objects written before a late refusal stay unreachable in the human store until git gc. (4) No rebase when HEAD moved (spec §3.2 step 1): it parks `branch-moved`. (5) A delete plus an add under the same name as a directory (D/F swap) is refused `dirty`. (6) `.gitattributes` refusal is any attribute at all on a touched path, so a repo with `* text=auto` never lands (spec reading). (7) The registry's TODO for exempting human-attended closure commits is untouched.
- **GUI**: `status.loops.landing` lists waiting lands; the Loops view does not map it to its `waiting-land` state yet, and `merge.reverted`/`loop.land.waiting` have no timeline lines (step 13 follow-up, with an atelier check).
- **Tests**: `test/loop-land-git.test.ts` (darwin, linux; real git: the happy path where the checkout ends with exactly the proposed bytes, refusals, a concurrent edit, a CAS failure, a parent swapped for a symlink, reverts), `test/loop-land.test.ts` (every platform: gate, wait, max-wait, park, undone, fold, trailers), `test/loop-act-e2e.test.ts` (an act run that lands alone, one parked by a filter attribute, approve-to-land after a dirty wait), `test/loop-events.test.ts` (the quiet window, exact paths, direct loop ids).

## Notes from the step 11 Aegis review (merge after fixes, applied)

- **H1:** the new index is written into the held `index.lock` with a full write loop, fsync'd, fstat'd for its size, read back and its trailer checksum verified (zeros under `index.skipHash`), all BEFORE the CAS. After the CAS only the rename is left; a failed rename swaps the ref back, puts the files back and reports `undone`. There is no "landed with a stale index" result any more. Tests: short writes, ENOSPC, a failing rename.
- **H2 (racy git):** the private index copy gets the original index's mtime, rounded down to the second, before `update-index` (macOS `copyFileSync` does NOT keep it: measured). A racily clean entry the human changed stays modified after the land. The test fails without the fix.
- **M1:** `handleFsEvent` ignores `.gnomon-land-<16 hex>.(tmp|bak|undo)`, and the landed-paths window covers the landed paths' ancestor dirs.
- **M2:** a split index (`rev-parse --shared-index-path`) is refused; booleans are read with `--type=bool` (`autocrlf=input` separately). The read-only queries (config, check-attr, check-ignore) run with the human's HOME and XDG_CONFIG_HOME and the system config, so global `core.attributesFile`, XDG attributes and global autocrlf count. An unreadable config refuses: git only warns about one and goes on, so the warning and each user file's readability are checked. Index v4 and the untracked cache survive. **Disputed: FSMN.** `update-index` under the forced `core.fsmonitor=false` drops the fsmonitor extension (measured). Keeping it would mean running the repo's fsmonitor program, which the hardening forbids. Dropping it is safe: git rebuilds it on the next status. The test asserts it is dropped and `git status` stays right.
- **M3:** the kill switch calls `lander.parkAll()`: every waiting land, approved ones too, parks (`loop.parked{kill-switch}`). An attempt in flight finishes and never waits again. A fresh approval after the switch may land.
- **M4, adapted:** completion is a second `loop.landed` row with `phase: 'done'`, and the first now carries `phase: 'intent'`. A new `loop.land.done` kind would move clientApiId (event kinds ride the event schema, a kitId input); name it at the next contract move. The GUI toasts "landed" only on `phase: 'done'`. At boot, `reconcile()` treats an intent with neither done nor undone as interrupted:
  - it removes the leftover `gnomon-land-*.index`;
  - it removes a stale `index.lock` (only if at least 10 s old and no newer than the row);
  - it moves `.gnomon-land-*` files beside the landed paths to `<home>/loop-work/recovered/<runId>/`;
  - it closes the row as done (the ref moved) or undone, with a toast to check `git status`.

  Lands waiting at the restart become `loop.parked{restart}` with a toast. Lander-written park rows carry `land: true`.
- **M5, an 8.1 residual (accepted for 8.0 under approve-to-land):** Node has no `openat`/`renameat`. Move file placement into the helper with `*at()` calls on the held directory fds.
- **Lows:**
  - **L1:** the in-progress markers are re-checked after the lock.
  - **L2:** the undo CAS is checked; if it fails, the files stay as placed and a `conflict` is reported.
  - **L3:** each moved-aside original is compared with the base again before deletion; one that changed is kept in `recovered/<runId>/` with a toast.
  - **L4:** a `symlink` land hazard.
  - **L5:** a branch also checked out in another worktree refuses.
  - **L6:** `isKernelKey` reaches the lander. The revert scan is one `log -z --raw --no-renames` read. **Message-only reverts (`This reverts commit` with no content match) must not drive 8.1 strictness scoring:** anyone can write that line.
  - **L7:** local attended sessions count in the human-turn check (`supervisor.humanTurns()`).
  - **L8:** `portal.yaml` is a gate-class file.
  - **L9:** accepted.
- **GUI:** `gnomon-gui/src/core/loops.ts` changed (the landed toast), so the bundle must be re-embedded at the next merge. `atelier` is not installed in this environment, so no atelier check was run (a logic change, no visual change).


## Notes from step 14 (LP9 templates and the field-run kit)

- **Templates** moved out of #loop-files into `#loop-templates` (`packages/paradigm-mcp/src/utils/loop-templates.ts`). `paradigm loop new <id> --template flow-health|green|watch|tidy [--flow $id] [--dir <path>]` and `paradigm_loop({op:'create', template, flow?, dir?})`; `--example`/`example` stay as the older name. `flow` and `dir` are checked against closed patterns before they reach YAML.
- **Approve-to-land wording** (TD-2026-10-22-369): the act template (green) says its change comes as a propose card and nothing lands until the human accepts; a test refuses any template text or summary that promises to land on its own. The old tidy comment ("lands only after the trust card names it") is gone.
- **Example D in its 8.0 form reports only.** The spec's D uses `effect: write` on `paradigm.reindex`, which the validator accepts but the runner refuses at start (`ACT_NODES_LATER`), and its `day.lore|commits|loopRuns` inputs resolve to "(no data recorded)" in 8.0 (model-node.ts). The tidy template is now observe-only: reindex and purpose-validate on the check copy, then a local digest of their evidence. **Open for Arky/Aegis:** should the validator refuse `effect: write` with "lands in 8.1", so a definition the runner cannot run fails at validate?
- **Example B trap, fixed in the template:** `tsc -p packages/gnomon` makes `packages/gnomon` a protected path (argv path words join `protected`), and a wildcard-free protected glob covers everything beneath it (protect.ts), so the act node could never edit its own land paths. The template names the file (`-p <dir>/tsconfig.json`); a test asserts no protected path covers the land paths. The spec's Example B still shows the directory form. The land message no longer carries `{{round}}` (land.ts does not render templates; the Gnomon-Run trailer names the run).
- **Flow index from Windows:** `.paradigm/flow-index.json` in this repo was written with backslash paths, so on macOS every flow resolved to `**` (a file.changed trigger on any file). `loadFlowIndex` now normalizes separators; another machine's drive path resolves to nothing.
- **Tests:** `loop-templates.test.ts` (per template: validates, compiles to `.paradigm/loops/<id>.loop.json`, passes `validateCompiledLoop`, stays in the runnable 8.0 subset, compiled `sourceHash` and `.loop.json` sha256 pinned, no auto-land promise; parameter refusals).
- **`gnomon dev local --loops`** signs `loops: true` on the endpoint (the step 8 opt-in had no writer).
- **Field-run blocker (macOS):** model steps need an endpoint signed with `loops: true`. Only `gnomon dev local` writes `local.signed.json`, and a dev home on macOS cannot approve cards (loop-trust needs the root key), while the real home has no local-config signer at all. Until one exists, model steps there are `unavailable`: A and D toast without a summary and B stops at its card. The field-run guide states this. A real-home `request.local.config` (root-signed, presence) is owed.
- **Field-run kit:** `docs/guides/gnomon-loops-field-run.md` (flow-health on `$symbol-aggregation`, evening-tidy, green on packages/gnomon). Nothing was enabled.

## Notes from the real-home local model (TD-2026-10-22-769)

- **Real homes get a local model.** `request.local.config` raises a root `grant` card (`local.config`); its allow writes the root-signed `local.signed.json` and the daemon applies it hot. Remove is notify-and-proceed. `request.local.probe` checks a loopback server before any card (Mika C1). CLI raw form `gnomon local set|status|remove`; the Settings → Local model form is the next step (Mika's session 2026-10-22-gnomon-local-model).
- **Loopback only in 8.0**, dev homes included (one validator, `validateLocalConfigInput`). LAN endpoints land in 8.1.
- **gnomon-local ships inside the release** (`dist/gnomon-local/cli.js`, tree hash compiled in, verified at load). `build:gnomon` now builds gnomon-local before the kernel; prepack refuses a dist without it.
- **Helper 1.9.0** (unsigned until the founder's release): the `local.config` row table, and `requestedBy` in the `loop-trust` field set (an agent-raised trust card could not be allowed on a real 1.8.0 helper). A card whose row table is newer than the running helper is refused when it is raised ("update the Gnomon app"), which also closes the latent loop-trust path where a 1.8.0 helper's decision.sign error never fell back (Aegis C6 is kept: no fallback; the refusal moves to raise).
- **Example D's write check lands in 8.1**: the validator now refuses `effect: write` with `LANDS_IN_8_1`, so a definition the runner cannot run fails at validate; the runner keeps its backstop (`ACT_NODES_LATER`, milestone 8.1). This answers the step-14 open question.
- **A refused start is not silent**: a schedule/event/continuous fire refused `no-local-model` writes `loop.trigger.fired{refused:{code, why}}` (why ∈ none | sessions-only | no-runner | no-profile) and one `startRefused` entry per loop in `status.loops`; the GUI shows one stack alert per loop ("■ <id> didn't start", ×n since), cleared when a config that serves it applies.

## Notes from loop secrets (TD-2026-10-23-268)

- **`env: [NAME, …]` on check and act nodes.** The kernel passes exactly those variables into that node's child (values from env files since TD-2026-10-23-448, below), on top of the scrubbed env (`buildCheckEnv{named}`; an act session through `applyLoopEnv` after the loop drops). Judge and summarize take none (`ENV_NOT_ALLOWED`).
- **The split** lives in `runner/env.ts` `loopEnvHazard` (shrunk after review, below). A name found nowhere is `env-missing`, before any copy or spawn.
- **`redact: off`** at the loop level keeps check output raw (tails, json value, builtin error); model replies stay scanned.
- **Hash and card.** Both compile only when used (`env` when non-empty, `redact: 'off'`), so existing loops hash as before. The card shows "uses your env: …" (names only) and "shows check output unredacted". The `loop.trusted` row is unchanged: its `contentHash` binds both, so the helper row table (decision-batch.ts, Protocol.swift, render.ts) needed no new field and no helper bump.

## Notes from the loop secrets review (Aegis "merge after fixes", TD-2026-10-23-448)

- **F1: values come from env files, not the daemon env.** The daemon re-execs through `cleanReexecEnv` (S-H3), so named vars never reached it; that stays. `envFiles` (≤ 8, loop level) then `~/.gnomon/loop-env` (owner-only, never a symlink) are read by the kernel with O_NOFOLLOW at resolve time (`kernel/loops/loop-env.ts`). Linked repo env files leave the config closure and the check copy, so editing a value needs no re-trust and a tool cannot auto-load the rest of the file.
- **`network: on`** opens outbound IP and DNS for that loop's checks (darwin SBPL); the kernel's web port (daemon `kernelPorts`) stays denied, unix sockets too. Act nodes stay loopback-only.
- **Refusal list shrunk** to GNOMON_*, NODE_OPTIONS, NODE_PATH, DYLD_*, LD_* and kernel-set names.
- **F2–F6 applied:** literal redaction (`[REDACTED:env:NAME]`, URL-encoded too), the parked-diff `env-value` hazard, act env bounded by the trusted node (`LoopRunRefInfo.nodeEnv`), `loop.node.detail` always scanned, "callee uses your env" under call nodes.
- **F7, 8.1 guards (open):** envelope auto-trust excludes loops with env, envFiles or network; Claude nodes refuse the Claude routing names; bash tools and write checks reopen F3 (scan their edits for handed-out values).

## Notes from the loop secrets re-check (Aegis round 3, "merge after fixes")

- **M1:** a `network: on` check is denied every kernel listener on every address (`remote ip "*:PORT"`): the web endpoint, every mod egress proxy (`kernelPorts`, now defined above `wireLoops` in daemon.ts) and every configured local-model endpoint. The darwin test proves 127.0.0.1, 0.0.0.0, ::ffff:127.0.0.1 and the LAN IP. **Residual:** a mod proxy started mid-check is not in that check's profile; a per-mod proxy token is 8.1.
- **M2–M4, L1–L4:**
  - env files open with O_NONBLOCK (a FIFO is refused at once);
  - a repo file must realpath inside the repo, and nothing inside the Gnomon home but `loop-env`;
  - credential paths are allowed, and the card shows real paths, "(outside this repo)" and "(tracked by git)", one `NAME ← source` line per name and the network warning;
  - `~/.gnomon/loop-env` is read first;
  - repo env files join the protected set;
  - config-named env files are refused (`.env*` allowed: see the L1 note in the report);
  - DNS needs only the mDNSResponder socket and `/var` metadata (tested; no `system-socket`);
  - outside-repo reasons say only "cannot be used";
  - a run keeps its handed-out values in memory for redaction.
- **F6 gap:** a caller's card also shows the callee's env files and network.
