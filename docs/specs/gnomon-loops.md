# Gnomon loops: recurring checks and fix loops for Paradigm flows (`#loop-runner`, `$loop-run`, `^loop-trusted`)

Status: reviewed by Aegis (ready-with-edits, applied); founder decisions applied 2026-10-22. Next: Luna and Mika (visuals). Branch `feat/gnomon`. Builds on `docs/specs/gnomon.md` (cited as G:line).

## 1. Overview and laws

A **loop** is a graph of nodes that runs in the Gnomon kernel without a human present. Edges branch on each node's verdict (`pass | fail | unsure | unavailable | error`), and cycles are allowed. The v1 node types are check, model step, notify (or decide) and call. v1 covers four uses:
- flow health checks;
- fix-until-green rounds;
- watchers;
- routine chores.

Paradigm can define loops (`.paradigm/loops/*.yaml`). Only the Gnomon kernel runs them unattended, because only the kernel has the scheduler, the log, the meter, sandboxes and cards (G:683, G:671, G:1590).

Laws:
- **LL1. Nothing runs until trusted.** A definition runs only after a human trusts its exact content hash (§3.1). There is no envelope by default (§10, D2), so every agent-created or agent-changed loop takes one card. Law 5 holds: a fresh install has zero enabled loops (G:1177).
- **LL2. Data never steers the graph.** Branching and goals read only typed verdicts. Model text is data (§3.4).
- **LL3. The runner enforces every loop budget**, even though the fuse only meters (G:671). An absent budget is the global default, never unbounded (§3.5).
- **LL4. Human work is never clobbered.** Loops land on the working branch only by a path-disjoint fast-forward under the repo land lock (§3.2).
- **LL5. A loop cannot create or widen a loop.** Loop sessions get no loop write tool and no loop verb.
- **LL6. Everything is a log row.** State after a restart is a fold of kernel-signed rows (G:340).
- **LL7. Loops are local by default.** A loop uses the local model unless it opts into the founder's Claude subscription on its trust card. No API tokens: law 7 is unchanged (G:1179).

## 2. Schema `loop:v2`

`loop:v1` is named only as the ledger substrate (G:683). `loop:v2` is the definition.

```yaml
schema: loop:v2
id: kebab-id                    # ≤64, unique per scope; repo = .paradigm/loops/<id>.yaml, personal = ~/.gnomon/loops/<id>.yaml
title: string
repo: /abs/path                 # personal loops only; repo loops use their own repo
flows: [$flow-id]               # symbols served (GUI, ripple)
triggers:                       # any mix; manual is always implied
  - schedule: { every: 30m } | { daily: "07:30" } | { weekly: { day: mon, at: "09:00" } } | { cron: "0 */2 * * 1-5" }
    catchUp: skip | once        # a fire missed while the daemon was down (default skip)
  - event: { kind: file.changed, flow: $x } | { kind: commit.landed } | { kind: session.ended } | { kind: sentinel.incident.opened, severity: [high] } | { kind: card.decided, loop: id, node: id }
    debounce: 2m
  - continuous: { cooldown: 2m }  # ≥ 60 s; needs a goal or budgets.run.rounds, and budgets.day.runs or budgets.day.computeSec
autonomy: act | propose | observe   # default act; capped by §3.3, re-evaluated at every node and at land
notify: { on: [goal, stop, fail, landed], as: toast | quiet }
decide: none | before-land | on-stop  # require a choice (card)
claude:                             # optional; absent = local only (LL7)
  optIn: true                       # the founder's subscription, never an API token
  caps: { run: { claudeUsd: 3.00 }, day: { claudeUsd: 6.00 } }   # shown on the trust card
budgets:                            # any absent field = the global default in ~/.gnomon/config.yaml loops:
  run:  { rounds: 8, wallMin: 60, tokens: 400k, computeSec: 1800 }
  day:  { runs: 24, tokens: 2M, computeSec: 7200 }
  escalations: { perRun: 2, perDay: 6 }
goal:
  node: id                          # must name a check node (LL2)
  verdict: pass
  inputs: [glob]                    # required when the goal node is a `run` check; the kernel adds the config closure (§3.4)
land: { paths: [glob], message: "type(#sym): …", maxWaitMin: 120 }   # trailer-shaped lines in message are stripped (§3.2)
redact: on | off                    # default on; off shows this loop's check output unredacted (§4 "Environment"; on the trust card)
envFiles: [.env.loop, ~/secrets/app.env]    # ≤ 8; repo-relative, ~/… or absolute; read after ~/.gnomon/loop-env, in order
network: on | off                   # default off; on lets this loop's checks reach the network (act nodes stay loopback-only)
start: node-id
nodes:
  - id: x
    type: check                       # deterministic
    run: [argv]                       # literal, never templated; no shell; argv0 is a direct binary (§3.1)
                                      # or builtin: paradigm.flow-check | paradigm.flow-affected | paradigm.ripple | paradigm.purpose-validate | paradigm.drift | paradigm.reindex | git.clean
    effect: read | write              # read: oracle profile on a copy; write: scratch worktree, diff lands
    pass: { exit: 0 } | { parse: tap|junit|tsc, failed: 0 } | { json: "$.path", op: "==", value: 0 }
    timeoutSec: 600
    env: [STRIPE_KEY, DATABASE_URL]   # optional: variables this child gets, read from ~/.gnomon/loop-env then envFiles (§4 "Environment"); ≤ 32 names
    on: { pass: y, fail: z, error: '@stop' }
  - id: y
    type: model
    role: judge | summarize | act
    model: { use: local | claude | any, profile: name, escalate: never | on-unsure | on-unavailable | both, minConfidence: 0.7 }
                                      # use defaults to local, escalate to never; claude, any or any escalate needs claude.optIn
    prompt: template                  # inputs inserted only as fenced data blocks
    inputs: [x.evidence, trigger.payload]
    tools: none | [read, edit, { bash: [[exact argv], …] }, { paradigm: [ripple, flow.check] }]   # act only; judge/summarize get none
    limits: { turns: 20, tokens: 80k }
    env: [GITHUB_TOKEN]               # act only, like check nodes; judge/summarize run no tools and take none
    exit: { maxVisits: 8, maxFailStreak: 3 }
    on: { pass: …, fail: …, unsure: …, unavailable: … }
  - id: n
    type: notify
    as: toast | card                  # card = decide: choices become kernel-signed actions
    text: template                    # kernel fields only; model text attached as data
    choices: [continue, stop]
    on: { continue: …, stop: '@stop', timeout: '@pause' }
  - id: c
    type: call
    loop: other-id@hash8              # pinned; same scope, trusted; call depth ≤ 3; the cross-loop call graph is acyclic
    on: { pass: …, fail: … }          # callee goal → pass; stopped → fail; budget → unsure
```

Terminals are `@goal`, `@stop` and `@pause`. A missing edge goes to `@stop`. Per-node `exit` stops or pauses the run when it is reached. A run ends on:
- goal met;
- a budget;
- a node exit;
- `@stop`;
- a human or agent pause, or the kill switch (§3.3);
- a kernel pause (thrash, strictness, content or closure change);
- trust revoked.

### Example A: flow health check

```yaml
schema: loop:v2
id: flow-health-checkout
flows: [$checkout-flow]
triggers: [{ schedule: { daily: "07:30" } }, { event: { kind: file.changed, flow: $checkout-flow }, debounce: 5m }]
autonomy: observe
notify: { on: [fail], as: toast }
budgets: { run: { wallMin: 15, computeSec: 300 }, day: { runs: 12 } }
goal: { node: drift, verdict: pass }
start: defn
nodes:
  - { id: defn,  type: check, builtin: paradigm.flow-check, args: { flowId: $checkout-flow, checkImplementation: true }, on: { pass: gates, fail: why } }
  - { id: gates, type: check, builtin: paradigm.purpose-validate, on: { pass: tests, fail: why } }
  - { id: tests, type: check, run: [node_modules/.bin/vitest, run, test/checkout], pass: { parse: junit, failed: 0 }, on: { pass: drift, fail: why } }
  - { id: drift, type: check, builtin: paradigm.drift, args: { symbols: [$checkout-flow] }, on: { pass: '@goal', fail: why } }
  - { id: why,   type: model, role: summarize, model: { use: local }, inputs: [last.evidence], on: { pass: tell, fail: tell, unsure: tell, unavailable: tell } }
  - { id: tell,  type: notify, as: toast, text: "{{loop.id}} failed at {{failed.node}}", on: { any: '@stop' } }
```

### Example B: fix until green (RALPH-style rounds)

```yaml
schema: loop:v2
id: green-typecheck-gnomon
triggers: [{ schedule: { daily: "02:00" } }]
autonomy: act
claude: { optIn: true, caps: { run: { claudeUsd: 3 }, day: { claudeUsd: 6 } } }
budgets: { run: { rounds: 8, wallMin: 60, tokens: 400k }, escalations: { perRun: 2 } }
goal: { node: tsc, verdict: pass, inputs: ["packages/gnomon/tsconfig*.json", "tsconfig.base.json"] }
land: { paths: ["packages/gnomon/src/**"], message: "fix(#gnomon): typecheck green, loop round {{round}}" }
start: tsc
nodes:
  - { id: tsc, type: check, run: [node_modules/.bin/tsc, -p, packages/gnomon, --noEmit], pass: { parse: tsc, failed: 0 }, on: { pass: '@goal', fail: fix } }
  - id: fix
    type: model
    role: act
    model: { use: local, profile: coder, escalate: on-unsure }
    tools: [read, edit, { bash: [[node_modules/.bin/tsc, -p, packages/gnomon, --noEmit]] }]
    inputs: [tsc.evidence]
    exit: { maxVisits: 8, maxFailStreak: 3 }
    on: { pass: tsc, fail: tsc, unsure: ask, unavailable: ask }
  - { id: ask, type: notify, as: card, choices: [continue, stop], on: { continue: fix, stop: '@stop', timeout: '@pause' } }
```

Examples A and B name direct binaries, never `npx`. The scratch worktree and the oracle copy reuse the trusted `node_modules` (no network install), so the hashed argv0 is the one that runs (§3.1).

### Example C: watcher

```yaml
schema: loop:v2
id: sentinel-triage
triggers: [{ event: { kind: sentinel.incident.opened, severity: [high, critical] }, debounce: 1m }]
autonomy: act
claude: { optIn: true, caps: { run: { claudeUsd: 1 }, day: { claudeUsd: 4 } } }
budgets: { run: { wallMin: 20 }, day: { runs: 20 }, escalations: { perDay: 4 } }
start: triage
nodes:
  - { id: triage, type: model, role: judge, model: { use: local, escalate: on-unsure }, inputs: [trigger.payload], verdict: { classes: [typecheck-regression, other] }, on: { pass: fix, fail: tell, unsure: tell, unavailable: tell } }
  - { id: fix,  type: call, loop: green-typecheck-gnomon@3f9a1c02, on: { pass: tell, fail: tell } }
  - { id: tell, type: notify, as: toast, text: "incident {{trigger.id}}: {{triage.class}} → {{last.outcome}}", on: { any: '@stop' } }
```

For a judge, `pass` means "the first class matched". The class names are closed in the definition, so they are verdicts, not prose. The `call` pins the callee's hash, so a change to the callee changes the caller's hash too.

### Example D: routine chore

```yaml
schema: loop:v2
id: evening-tidy
triggers: [{ schedule: { daily: "18:30" }, catchUp: once }]
autonomy: act
budgets: { run: { wallMin: 20, computeSec: 900 }, day: { runs: 1 } }
land: { paths: [".paradigm/lore/**", ".paradigm/**/index*"], message: "chore(#paradigm): evening tidy" }
start: reindex
nodes:
  - { id: reindex, type: check, effect: write, builtin: paradigm.reindex, on: { pass: digest, fail: digest } }   # 8.1: write checks; 8.0 refuses effect: write at validate (LANDS_IN_8_1)
  - { id: digest,  type: model, role: summarize, model: { use: local }, inputs: [day.lore, day.commits, day.loopRuns], on: { any: tell } }
  - { id: tell,    type: notify, as: toast, text: "daily digest ready", attach: [digest.text], on: { any: '@stop' } }
```

`.paradigm/**` is gate-class (G:635). So example D lands only after its trust card names those paths (§3.3).

## 3. The six tensions, resolved

### 3.1 Supply chain (`^loop-trusted`)

- **argv rules.** A `run` argv is literal and never templated. argv0 must not be a runner (`npx`, `pnpx`, `bunx`), a shell or an interpreter, per `INTERPRETER_DENYLIST` and the `python*` rule (prefix-policy.ts:60, prefix-policy.ts:125). On win32, argv0 may not be a `.cmd` or `.bat`. A definition that breaks these rules is refused at validation.
- **Content hash.** The hash is sha256 over:
  - the canonical JSON of the definition;
  - argv0's realpath and sha256;
  - the sha256 of every file a `run` argv names, inside the repo or outside it;
  - the **config closure**: a digest of the gate-class files (G:635) a check reads (test config, `tsconfig*`, `package.json` and lockfiles, lint configs);
  - each `call` target's pinned `id@hash8`.

  The kernel recomputes it before every run and every node. A mismatch writes `loop.paused{reason:'content-changed' | 'closure-changed'}` and nothing runs.
- **Closure changes by origin.** A config-closure change landed by a loop or an agent session pauses the loop until re-trust. A human commit that changes it is recorded (`loop.closure.changed{by:human, digest}`) and the loop keeps running.
- **Trust card.** A repo loop, or any changed version of one, is inert until a human decides a new card kind, `loop-trust`, with fresh presence and the **root key**, like `install` (G:597, G:1546). It is never `always`, never standing (add it to `NEVER_STANDING_KINDS`, standing-grant.ts:48) and never by voice. The card renders every node, argv (with realpaths and hashes), tool, model, Claude opt-in and caps, escalation, budget, trigger, goal input and land path. It says plainly which of your variables the loop uses, by name and never by value ("uses your env: STRIPE_KEY, DATABASE_URL", and under each node that names any). It lists where it reads them, in lookup order, with each file's real path and place ("reads env from: ~/.gnomon/loop-env (read first), then .env.loop (repo, tracked by git) → /…/.env.loop, then ~/secrets/app.env (outside this repo) → /Users/…/secrets/app.env"). One line per name gives the source that holds it now ("STRIPE_KEY ← ~/.gnomon/loop-env", "API_BASE_URL ← .env.loop (repo)"), or its candidates when none does yet. It adds "shows check output unredacted" when `redact: off`, "checks can reach the network" when `network: on`, and, with both env and network, "this loop runs this repo's code with <names> and network access: anyone who can change the repo's code can read and send them." Under a call node it shows what the callee hands out ("callee uses your env", "callee reads env from", "callee checks can reach the network"). All of these live in the compiled definition, so they are in the content hash: adding, removing or renaming a variable or an env file, or switching redaction or network, pauses the loop until a new trust (TD-2026-10-23-268, TD-2026-10-23-448). Values are never hashed: editing a value needs no re-trust, and a repo env file the loop links is left out of its config closure. On a change it also shows the diff against the trusted hash.
- **Trust record.** The broker writes `loop.trusted{loopId, scope, repoKey, contentHash, cardId}`. Revoking writes `loop.untrusted{loopId, contentHash, by}`. A hash change writes `loop.paused`. The registry shows "1 change waiting for trust" and raises no card until the human opens it ("cards only when needed").
- **Cloning a repo** therefore executes nothing.
- **Agent-authored loops.** Every loop an agent creates or changes takes one `loop-trust` card (§10, D2). The founder may later grant an **envelope** (opt-in, none by default): a `grant` card (root class, like other grants, G:607) that mints `grant.loop-envelope{envelopeId, repo, autonomyMax, checks:[argv or builtin], tools, models:{local, claude:bool}, budgetsMax, landPaths, maxLoops, expiresAt}`.
  - It matches only a kernel `loop.request` from an agent principal. A change with `authoredBy: file` (a git pull, an MCP file op, a postinstall script) always takes a card, even when it fits.
  - It expires in 30 days at most.
  - `budgetsMax` is aggregate across all loops running under the envelope, and `maxLoops` caps their count.
  - `landPaths` never includes gate-class paths.
  - A loop that fits runs at once, and the founder gets a toast: "Arky created loop X (inside your envelope)". Its rows carry `envelopeId`. Anything outside the envelope takes one card.
  - Revoking writes `grant.loop-envelope.revoked{envelopeId, by}` and pauses its loops.
- **Attribution.** The kernel stamps `authoredBy{principal, hsid}` from the request row. It never takes it from the YAML. A file that changed with no request row is `authoredBy: file`.
- **Session writes.** Repo writes are already gate-class for sessions (`.paradigm`, G:635). Sessions cannot write `~/.gnomon/**` (G:1599), so personal loops arrive only through the kernel request.
- **Windows.** `loop-trust`, `grant.loop-envelope` and loop resume are Windows Hello classes in the hybrid design (docs/plans/gnomon-windows.md, TD-2026-10-22-278).

### 3.2 Working-branch collisions (`#repo-lease`, `$loop-land`)

- **Where loops work.** Write steps and act nodes work in a scratch worktree detached at the branch head, in the kernel-owned run dir `<home>/loop-work/act-<runId>/tree`, outside the repo (build plan step 10; git hardening, G:1557). It is the HEAD tree read with hardened git plumbing, never `git worktree add`, and has no `.git`. Its work parks at `refs/gnomon/loops/<id>/<runId>` in a kernel-owned park repo. It reuses the trusted `node_modules` read-only; there is no network install.
- **Landing**, under a per-repo land lock held for seconds:
  1. If HEAD moved, rebase the loop commit in scratch and re-run the goal check.
  2. Refuse if:
     - any touched path is dirty in the human's index or worktree, or another loop holds it;
     - the diff renames a path, or a touched path is untracked or ignored in the human's checkout;
     - a touched path is a gitlink, has a `.gitattributes` entry or a clean/smudge filter;
     - a touched path collides with another under case-folding;
     - a merge, rebase, cherry-pick, revert or bisect is in progress, or `index.lock` exists.
  3. Refuse if a human attended session in that repo has a turn in flight.
  4. Land only if HEAD is still the symbolic ref the run started on. Then update the branch ref, update the index entries for the touched paths, and for each touched file compare its bytes with the HEAD blob just before an atomic rename into place. That makes it a fast-forward that never touches the human's other edits.
- **Conflicts.** If landing is refused it waits (`loop.land.waiting{reason}`), retrying on every `turn.result` or file event. After `maxWaitMin` the commit is parked at `refs/gnomon/loops/<id>/<runId>` and the founder is notified. Loops never stash, reset or force-push.
- **No pause.** The run itself is not paused while the founder works: the founder did not pick that option. Only the land step serializes.
- **Commits** (§10, D3). Author and committer are both `Gnomon Loop <loop+<id>@gnomon.invalid>`. The kernel strips trailer-shaped lines from `land.message` and appends its own trailers last:
  - `On-Behalf-Of: <human>`
  - `Trusted-By: <cardId>`
  - `Gnomon-Loop: <id>@<hash8>`
  - `Gnomon-Run: <runId>`
  - `Loop-Authored-By: <principal>`
  - `Symbols:`
- **Revert signals.** `loop.landed{loopId, runId, sha, paths}` is kernel-signed, so `merge.reverted` counts loop commits as strictness signals (G:638). A loop that gets reverted tightens its repo.
- **Gate-class paths** (G:635, G:1623) never land without a card, even when listed in `land.paths`. The trust card states this.

### 3.3 Law 5 and strictness

- **Defaults.** `act` is the definition default, but nothing runs or spends until the first enable. The trust card (or an opted-in envelope grant) is law 5's human mark: `attended:false` plus `model` (G:1177). It is also the opt-in for that loop's Claude use (§3.5). Fresh install: zero grants (`G-LAW-05`).
- **8.0 is approve-to-land** (founder decision, 2026-10-22, build plan step 11). At every level, an act change raises the propose card and lands only when the human accepts it (hand-only, fresh presence). The trust card of a loop with act nodes and a land block says so: "Proposes changes to your current branch; nothing lands until you accept the card." The auto-landing rules below (L0/L1) are built and tested behind one seam and take effect in 8.1.
- **Effective autonomy** = min(the loop's autonomy, the repo cap), re-evaluated at every node and again at land:
  - L3 or `manual`: nothing runs (`FORBIDDEN{strictness-paused}`, G:616).
  - L2: auto-landing is off, and the `ask` mode ceiling (G:615) wins over the loop's `auto-edits`. Act nodes become `propose`; their diffs are batched into the repo's verdict card.
  - L1: concurrency is capped, and gate-class or kernel-high-risk lands take the second reviewer and a fresh-presence verdict (G:614).
  - L0: as declared.
- **Repo brake.** Tightening a repo (G:615, the emergency brake) pauses that repo's running loops at once, with no presence.
- **Kill switch.** `request.loop.pause{all:true}` from the GUI, the palette or the CLI (`gnomon loop pause --all`) is a tightening with no presence. It kills every in-flight check and session process group, parks scratch work at refs and writes one `loop.paused{reason:'kill-switch', by}` per loop.
- **Resume classes.** Resuming after a kernel pause (thrash, closure change, budget, kill switch) is resume-class: fresh presence (G:597). On the `loop-choice` card, `continue` is hand-only fresh presence and `stop` is voice-eligible (deny-direction).
- **Exec rules.** The trust card also serves as the loosening of loop sessions to `auto-edits` inside their scratch worktree (G:623), subject to the ceiling above, and as exact, loop-scoped exec rules for the listed `bash` argv. Prefix rules never apply (G:601). Any other exec in a loop session is denied with no card and counts as the node's `fail`, because an unattended card would only wait (G:597, B6).
- **Uptime** (§10, D1). Gnomon keeps the daemon running while any loop is enabled, so scheduled loops fire with the app window closed. A kernel-owned status line says so ("Loops are keeping Gnomon running", §6). Background start at login stays launchd, in 8.1.

### 3.4 Prompt injection and protected goals (`^loop-origin-clamp`)

- **What may steer** an edge: check exit codes, deterministic parsers (tap, junit, tsc counts, JSONPath against a literal) and a model's constrained verdict from a closed enum plus confidence (grammar or JSON schema; a parse failure after repair is `unsure`). Nothing else.
- **What is data:** free text, tool output, trigger payloads, incident bodies and repo text. Each passes on only as fenced, receipted data (`inject.receipt`, G:1548). Notify cards show it dashed as `agent-claimed` (DESIGN.md:26).
- **Goals.** A goal and a land must rest on a check node: a model verdict alone never reaches `@goal` or `land`. Progress is measured on something that cannot lie (G:1061).
- **Protected goal inputs.** Every goal on a `run` check declares `goal.inputs` (globs), and the kernel adds the config closure (§3.1).
  - Act nodes are denied edits to those paths, with no card.
  - A land diff that touches them, deletes a tracked file or adds a suppression marker (`@ts-nocheck`, `@ts-ignore`, `eslint-disable`, `.skip`, `.only`, `xit`) drops to `propose`: it goes to a card and never lands alone.
- **Tools.** Judge and summarize nodes get no tools, like the reviewer (G:1548). Act nodes get only the declared tools.
- **Event triggers** match only kernel-stamped fields (kind, path, severity), never payload text.
- **The clamp** follows the voice-origin clamp (G:1511). Every loop session carries `origin:'loop'`. In those sessions, standing grants and human `always` rules do not apply; only the loop's own trust rules do. Their cards carry `detail.origin:'loop'` and the kernel line "Raised by loop X (authored by Y)". Loop sessions never see `paradigm_loop` write ops (LL5).
- **Residual: coerced judge.** Injected text can still bend a judge's closed verdict. Judge-driven edges, including `call`, are therefore funded from the caller's budget, so a coerced judge can spend only what the caller already had.

### 3.5 Runaway cost

- **Who enforces.** The runner, not the fuse. Before each model step it reserves a permit with `limits` (G:852). It then checks its own fold of `budget.usage` rows attributed by permitId (day windows from chain time, as G:671) against the limits per node, run, loop-day, repo-day and global-day. An attended local session preempts loop compute permits.
- **Absent fields.** A budget field the definition leaves out is the global default, never unbounded. A `continuous` loop must also set `day.runs` or `day.computeSec`, or validation refuses it.
- **Claude** (§10, D4). Loops are local only by default: `model.use` defaults to `local` and `escalate` to `never`. A loop opts into the founder's Claude subscription with `claude.optIn` and its own caps, shown on its trust card. `use: claude`, `use: any` and any escalation each count as Claude use and need that opt-in. There are no API tokens (law 7, G:1179). The global default for loop Claude spend is 0 until a loop opts in.
- **Global caps** live in root-signed `~/.gnomon/config.yaml` `loops:`. They include `claudeWindowCeiling` (default 70 %), which applies to opted-in loops and is checked before every turn, not only at session start: no loop starts or continues a Claude step above it, so loops cannot lock the founder out (threat 3, G:1547). The runner kills a loop session that exceeds its limits. Raising a cap is a root-signed loosening, as with strictness (G:665).
- **Calls.** A callee draws min(the caller's remaining budget, its own).
- **How this squares with P8-D92.** The fuse still grants and meters. The loop simply does not ask for its next step; that is the founder's "budget cap" stop.
- **Continuous loops** need a `cooldown` of at least 60 s (matching `MIN_AUTOMATION_PERIOD_MS`, automation.ts:32), a goal or `rounds`, and a day cap. Without them the definition is refused at validation.
- **Thrash pause.** The thrash detector (k=3, G:1061) pauses any loop with act or write steps. This is a kernel safety pause, not the "no-progress" stop the founder declined. Only a human resumes it (resume-class, §3.3).
- **Escalation caps.** Escalations are capped per run and per day. Past the cap, `unsure` takes its edge.

### 3.6 Local model availability

- **Routing** reuses `capability`/`routeModel` (routing.ts:26, routing.ts:35) and the local lane (local-session.ts:278-287).
- **Endpoint down or incapable:** the node's verdict is `unavailable`. With `escalate: on-unavailable` and `claude.optIn`, both approved on the trust card, the runner opens Claude, logged `session.routed{reason, by:'loop-trust:<cardId>'}`. That card was the prior fresh-presence decision, so D21's "never auto-fall back" (G:1359) holds. Otherwise the `unavailable` edge runs. The default edge retries 3 times with backoff, then goes to `@pause` with a toast.
- **Unsure:** a local `unsure`, low confidence or a schema failure re-runs the same node on Claude with the same data, if `on-unsure` and the opt-in are set and budget allows. Otherwise the `unsure` edge runs.
- **Learning:** every failure feeds `detector.event{local-model-failed}` (G:1057).

## 4. Kernel components

- **`#loop-registry`.** Watches `.paradigm/loops/` in known repos and `~/.gnomon/loops/` (0700). It validates `loop:v2` as a closed shape (as automation.ts:69), applies the argv rules, hashes (definition, argv files, config closure, call pins), folds `loop.trusted|untrusted|paused|deleted`, and registers timers.
- **Scheduler integration.** Loops register `automation:v1 {id:'loop:<id>', trigger, model, attended:false}`. The `attended:false` refusal (automation.ts:97-102) lifts only for records whose `loop.trusted` row matches. `AutomationTrigger` (automation.ts:36) gains `daily|weekly|cron` in a stated tz, still a pure function of the record and the due rows. A late fire stays attended (scheduler.ts:238-239) unless `catchUp: once`. The hard-wired refusal (scheduler.ts:249-253) is replaced by a hand-off to `#loop-runner`.
- **`#loop-events`.** Trigger matching is a subscription to the kernel log, so it replays:

  | Trigger | Log source |
  |---|---|
  | `file.changed` | kernel fs watch; flow to paths through the flow index, as `paradigm_flows_affected` (flows.ts:32-54) |
  | `commit.landed` | refs watch (M2.4) |
  | `session.ended` | `session.exited` |
  | `sentinel.incident.opened` | a `paradigm.sentinel.*` row from the paradigm grant |
  | `card.decided` | `approval.decide` |

  An event whose `causes` chain includes a run of loop L never triggers L.
- **`#loop-runner`** writes these kernel-owned rows:
  - `loop.run.started{runId, loopId, contentHash, trigger, envelopeId?}`
  - `loop.node{runId, nodeId, visit, verdict, confidence?, model{asked, used, escalated}, permitId?, usage, evidenceRef, effectiveAutonomy}`
  - `loop.row` per round (G:1061), extended additively with `{runId, nodeVisits, escalations, landedSha?}` and trusted only from the kernel principal (as scheduler.ts:20-22)
  - `loop.landed`, `loop.land.waiting`
  - `loop.run.ended{reason}`
- **Restart.** A started run with no end is closed `loop.run.ended{reason:'daemon-restart'}` and its node is never resumed mid-step (like drain-interrupted, G:348). Its scratch is not parked: the retention sweep removes the stale run dir. Continuous loops restart after the cooldown.
- **Uptime hold.** While any loop is enabled, the daemon does not idle-exit and survives the app window closing (§3.3). Live runs and timers due inside the horizon also hold idle exit (scheduler.ts:260).
- **Concurrency:**
  - one run per loop (triggers during a run coalesce into one rerun flag);
  - per-repo runs capped at `loops.concurrency.repo` (default 2), and at the strictness cap if lower;
  - a global cap;
  - local concurrency through compute permits (G:1359, `G-LCL-04`), which an attended local session preempts;
  - one land lock per repo.
- **Sandboxes:**

  | Step | Profile | Network |
  |---|---|---|
  | Read checks | `gnomon-oracle` on a copy (G:1596) | none |
  | Write checks and act nodes | `session` profile in the scratch worktree (G:1599) | none, except the model endpoint for act sessions |
  | Local child | its own profile (G:1351) | the local endpoint only |

  Check children get the scrubbed environment (`G-SEC-02`, G:1584).
- **Environment (TD-2026-10-23-268, TD-2026-10-23-448).** A check or act node may name variables (`env: [STRIPE_KEY, DATABASE_URL]`). The kernel passes exactly those into that node's child, on top of the scrubbed environment; nothing else is added. The loop is trusted with them on its card.
  - **Where values come from.** Not the daemon's environment: the daemon re-execs with a clean one (S-H3, lifecycle/env.ts), and that stays. The kernel reads values at resolve time from env files: the home file `~/.gnomon/loop-env` FIRST (a repo file can never shadow a value you keep there), then the loop's `envFiles` in order (repo-relative, `~/…` or absolute, at most 8). Only names declared in `env:` are taken; nothing else in the files is used. Files are opened by the kernel with O_NOFOLLOW, never by the child. Format: dotenv (`KEY=value`, an `export ` prefix, single and double quotes, `#` comments, CRLF), with no variable expansion and no command substitution.
  - **Failures name the file.** A linked file that is missing, unreadable, a symlink, not a regular file (a FIFO is refused at once: O_NONBLOCK) or over 1 MiB fails the node (`env-file`). A file outside the repo says only "the env file cannot be used: <path>". A repo-relative file must resolve inside the repo, its parent realpath'd, so a directory link cannot escape. No file may resolve inside the Gnomon home, but `loop-env` itself. A file named like a config tools run (`package.json`, `tsconfig.json`, `vitest.config.ts` …) is refused at validation (`ENV_FILE_CONFIG`) and in the kernel; a `.env*` dotenv is fine. Credential-store paths are not refused (no gatekeeping): the card shows every real path. The home file is refused unless it is owner-only (0600 or 0400), owned by you and not a symlink. A declared name found in no file is `env-missing` ("env STRIPE_KEY was not found in ~/.gnomon/loop-env, .env.loop"). All of it happens before anything is copied or spawned, and a variable is never passed empty.
  - **Values are never hashed, stored, logged or put in rows.** Editing a value needs no re-trust. A repo env file the loop links is not part of its config closure, is never copied into the check copy (a tool cannot auto-load the rest of it) and is in the loop's protected set, so an act node never edits it (G-LOOP-22). The kernel's own spawns (git, the copy) never get the values. A run keeps the values it handed out in memory only, for its own redaction.
  - **The split** (runner/env.ts `loopEnvHazard`). Allowed when named: every secret and tool setting is yours to hand your loop, `STRIPE_KEY`, `DATABASE_URL`, `GITHUB_TOKEN`, `AWS_*`, `ANTHROPIC_API_KEY`, and settings such as `BASH_ENV`, `PYTHON*`, `GIT_CONFIG*`, `GIT_SSH_COMMAND`, `CLAUDE_CODE_USE_*`, `CLAUDE_CONFIG_DIR` or `*_BASE_URL`. The scrub's names stay scrubbed from every child unless a trusted loop names them. Naming `ANTHROPIC_API_KEY` never routes a loop model step: Gnomon's own model use is unchanged (law 7). Refused at validation (`ENV_REFUSED`) and again in the kernel (`env-refused`), whatever the loop says: `GNOMON_*` (a child that talks to the kernel), `NODE_OPTIONS`, `NODE_PATH`, `DYLD_*` and `LD_*` (code loaded before anything the card pinned), and the names the kernel sets itself (`HOME`, `PATH`, `TMPDIR`, `USER`, the rest of the allowlist and the Windows names, `NO_COLOR`).
  - **Act steps** get exactly the names their trusted node declares: the run reference carries the node's `env` at the run's content hash, and the local lane refuses any other name (Aegis F4).
  - Names follow `^[A-Z_][A-Z0-9_]*$`, at most 32 per node, no duplicates. Judge and summarize nodes run no tools and take none. Rows and cards carry names only (`envKeys`), never values.
- **Network (TD-2026-10-23-448).** `network: on` at the loop level lets that loop's checks make outbound IP connections and DNS lookups (darwin: `remote ip "*:*"` and the mDNSResponder socket, nothing else: no `system-socket`, no mach-lookup). Every kernel listener port is denied again on every address (`remote ip "*:PORT"`: 127.0.0.1, 0.0.0.0, ::ffff:127.0.0.1, the LAN IP): the web endpoint, every mod egress proxy and every configured local-model endpoint, read when the check starts. Every unix socket but DNS stays denied. Residual: a mod egress proxy started while a check is already running is not in that check's profile; a per-mod proxy token is 8.1. Off is the default. Act nodes stay loopback-only (their model endpoint). Windows and Linux have no loop-check backend yet and refuse every check, so `network` changes nothing there.
- **Literal redaction (Aegis F2, F3, F5, L4).** With redaction on, every value a node was handed (6 characters or more, and its URL-encoded form) is replaced by `[REDACTED:env:NAME]` in check evidence, a json value, a builtin's error and the sandbox-refused detail, and in model replies and summaries. Whatever `redact` says: a node's `detail` in `loop.node` is always scanned, and a parked change whose added lines contain a handed-out value is a land hazard ("the change contains the value of STRIPE_KEY in src/config.ts") whose card diff shows the value redacted. The values redacted are those the run handed out (kept in memory for the run) plus a fresh read, so a value edited mid-run is still caught. Nothing is written.
- **Evidence.** Evidence is secret-scanned and labelled `private` before any escalation or any `log.read`, and never egresses over a link. A loop with `redact: off` (on its trust card) keeps its check output raw: stdout and stderr tails, a json rule's value and a builtin's error. Model replies stay scanned. The default stays on. Evidence blobs and parked refs have a retention window (`loops.retentionDays`) and are removed on uninstall (law 4).

## 5. MCP and CLI

There are no new kernel verbs (law 3, G:1175).
- **Family.** `paradigm_loop` is an on-demand family in `FAMILY_META` (families.ts:78-91), key `loops`, detector `loops` (`.paradigm/loops/` present or a kernel reachable).
- **Ops without a kernel:** `create`, `update`, `validate`, `list`, `get` (repo files).
- **Ops through the kernel:** `run`, `pause`, `resume`, `delete`, `runs`, `logs`, `trust-status`. They go through `#gnomon-ts-client` as the agent principal: `log.append` of a new userland kind `loop.request{op, loopId, …}` bound in the paradigm grant (G:938), and redacted `log.read`. `trust-status` lists who trusted which hash and when, and any envelope in force.

What an agent may do:

| Op | Agent may |
|---|---|
| create, update | always; waits for one `loop-trust` card, or runs at once inside an opted-in envelope (§3.1) |
| run | trusted loops only (manual trigger, budgets apply) |
| pause | any loop (narrowing) |
| resume | only loops it paused itself; never after a kernel pause |
| delete | only untrusted loops it authored; otherwise it becomes pause plus a toast to the founder |

- **Human ops.** Humans use `request.loop.trust|untrust|pause|resume|delete|run|envelope`, added to the named `request.*` exception list (G:938). `request.loop.pause{all:true}` is the kill switch (§3.3).
- **API batching.** The new card kinds (`loop-trust`, plus the decide card `loop-choice`) and the new kinds move `clientApiId` once, batched per P8-D89.
- **CLI:** `gnomon loop list|show|run|pause [--all]|resume|trust|untrust|trust-status|delete|runs|logs|envelope` and `paradigm loop new|validate|list`.

## 6. GUI Loops view (`#gui-loops`)

- **Entry.** From the palette (`loops.open`) and the wordmark menu (G:1234).
- **List**, grouped by project and scope. Each row shows:
  - state: running, idle, paused (with reason), waiting-trust, waiting-land or parked;
  - next due;
  - last outcome mark;
  - today's spend against caps, with "local only" or the Claude opt-in;
  - effective autonomy, with the cap reason when one applies;
  - `authoredBy`, and `envelopeId` when one applies.
- **Detail.** The graph with each node's last verdict. Colour follows the design system's rule: vermilion fail, amber unsure, ink otherwise (DESIGN.md:20). Below it, the rounds ledger and a run timeline: node visits, evidence, model used, escalations, landed sha with a revert key, and the definition diff against the trusted version.
- **Keys:** Run now, Pause, Resume, Delete, Trust (raises the card), Untrust, and budgets. Tightening a budget applies at once; loosening means re-trust. **Pause all** (the kill switch) is in the list header and the palette (`loops.pause-all`).
- **Indicator.** A kernel-owned `LOOPS n running` line in the Shuttle view, unhideable (G:1242, DESIGN.md:25). While any loop is enabled, a status line also reads "Loops are keeping Gnomon running".
- **Notifications.** Notify nodes become toasts (G:1234). Decide nodes become cards in the stack (G:1240).

## 7. Security model

New threat rows after G:1576:

| # | Threat | Mitigations |
|---|---|---|
| 33 | Hostile repo loop | hash-pinned `loop-trust` (root key, fresh presence); argv0 rules; argv files in and out of the repo, config closure and call pins in the hash |
| 34 | Agent-authored loop escalation | one card per agent loop by default; opt-in envelope bounded (agent `loop.request` only, 30 days, aggregate budgets, loop cap, no gate-class land paths); attribution; LL5 |
| 35 | Injection steering, goal gaming | §3.4: typed verdicts only, protected goal inputs, suppression and deletion drop to propose |
| 36 | Runaway spend or quota lock-out | §3.5: local by default, absent budget = default, per-turn window ceiling, kill switch |
| 37 | Clobbered human work | §3.2: extended refusals, symbolic-ref check, byte compare before atomic rename |

Further rules:
- Peers and voice cannot request, trust or resume loops (B10, G:677). Voice may only `stop` on a `loop-choice` card.
- Checks get no network unless the loop says `network: on` (on its card; never the kernel's ports). Act sessions get only the model endpoint. Neither gets a key or a variable unless the trusted loop names it in `env` (§4 "Environment"); kernel and runtime-loader names are refused even then.
- Loop sessions never get an `api-token` card, and naming `ANTHROPIC_API_KEY` never routes a loop model step. Law 7 is unchanged (G:1179): `env` hands your variables to your checks and act steps; it is not a way for Gnomon to bill a model.
- **8.1 guards for loop secrets (Aegis F7).** When these land they must hold: an envelope never auto-trusts a loop that names `env`, `envFiles` or `network: on` (each takes its own card); a Claude model node refuses the Claude routing names (`ANTHROPIC_*`, `CLAUDE_CODE_*`, `CLAUDE_CONFIG_DIR`, `*_BASE_URL`) in its env; and bash tools or write checks reopen F3, so their edits are scanned for handed-out values before anything lands.
- **Audit rows:** `loop.trusted`, `loop.untrusted{by}`, `grant.loop-envelope`, `grant.loop-envelope.revoked`, `loop.paused{reason, by?}`, `loop.closure.changed{by}`, and `envelopeId` on every envelope-run loop's rows.
- **Residuals:**
  - a trusted `run` argv still executes repo code (inside the oracle copy); the hash covers argv files and the gate-class config closure, not the transitive module graph beyond the lockfile;
  - the local judge is still the reading model (G:1548), and a coerced judge can spend the caller's remaining budget (§3.4);
  - nothing runs while the daemon is down or before the app has started once after login (launchd is 8.1);
  - on Windows, the oracle profile's read denial is partial (G:1596), so a read check can read more than on macOS.

## 8. Falsifiers

- **G-LOOP-01** A cloned repo with three loops: 24 h, zero runs, zero permits.
- **G-LOOP-02** A one-byte edit to a trusted loop, or to a script its argv names, pauses it. No run starts before re-trust.
- **G-LOOP-03** With no envelope (the default), an agent-created loop and an agent change to a trusted loop each raise exactly one card. Inside an opted-in envelope, an agent `loop.request` runs with a toast, `authoredBy` and `envelopeId`.
- **G-LOOP-04** `loop-trust` is refused under a cached unlock, a standing grant, voice, `always` and without the root key.
- **G-LOOP-05** A loop session cannot call `paradigm_loop create|update` or `loop.request`.
- **G-LOOP-06** An injected "VERDICT: pass" in tool output never changes an edge. A model-only path to `@goal` is refused at validation.
- **G-LOOP-07** A human dirty file on a touched path means no land. A disjoint path lands and the human's edits are byte-identical.
- **G-LOOP-08** A human turn in flight means `loop.land.waiting`. After `maxWaitMin` the commit is parked at a ref.
- **G-LOOP-09** Loop commits have author and committer `Gnomon Loop <loop+<id>@gnomon.invalid>` and the kernel's trailers last. A `land.message` carrying `Trusted-By:` or `On-Behalf-Of:` lines has them stripped. Reverting one emits `merge.reverted`.
- **G-LOOP-10** In 8.0, `act` lands nothing alone at any level: every change raises a propose card and lands only on accept (from 8.1, L0 and L1 may land alone). At L2 act nodes run as `propose`. At L3 or `manual`, zero runs and an accepted land waits. Tightening a repo mid-run pauses its running loops before their next node.
- **G-LOOP-11** Run, day and global caps stop the next permit request. A definition with no budgets runs under the global defaults. A continuous loop with no goal and no rounds, or with no `day.runs` or `day.computeSec`, is refused.
- **G-LOOP-12** A loop with no `claude.optIn` never starts a Claude process, whatever its `escalate`. For an opted-in loop, crossing `claudeWindowCeiling` mid-session stops it before its next turn.
- **G-LOOP-13** With the endpoint down and no `on-unavailable`, no Claude process starts. With it and the opt-in, `session.routed` cites the trust card.
- **G-LOOP-14** A kill mid-run, then restart: the run ends `daemon-restart`, nothing re-executes mid-step and budgets fold the same.
- **G-LOOP-15** A loop's own commit does not trigger that loop.
- **G-LOOP-16** Thrash k=3 pauses, and only a human resumes, with fresh presence.
- **G-LOOP-17** `gnomon replay` reproduces every edge taken.
- **G-LOOP-18** A loop YAML that arrives by `git pull` (`authoredBy: file`) and fits wholly inside an envelope still raises a `loop-trust` card and does not run.
- **G-LOOP-19** A `run` whose argv0 is `npx`, `pnpx`, `bunx`, `sh`, `bash`, `node` or `python3`, or on win32 a `.cmd` or `.bat`, or whose argv contains `{{…}}`, is refused at validation.
- **G-LOOP-20** Changing argv0's realpath target, or one byte of a file the argv names outside the repo, pauses the loop before its next run.
- **G-LOOP-21** A change to a gate-class file a check reads (say `vitest.config.ts`) landed by a loop or an agent session pauses the loop. The same change in a human commit writes `loop.closure.changed{by:human}` and the loop runs. Re-trusting a callee changes the caller's hash and pauses the caller.
- **G-LOOP-22** An act node's edit to a `goal.inputs` path is denied with no card and counts as `fail`.
- **G-LOOP-23** A land diff that deletes a tracked file, touches a goal input or adds `@ts-ignore`, `eslint-disable`, `.skip`, `.only` or `xit` lands nothing alone and raises a card.
- **G-LOOP-24** Each refusal lands nothing: a rename, an untracked or ignored touched path, a gitlink, a `.gitattributes` filter, a case-fold collision, a rebase in progress, an `index.lock`.
- **G-LOOP-25** The human switches branch during a run: nothing lands on either branch. A touched file whose bytes change between the check and the rename: nothing lands and the human's bytes stay.
- **G-LOOP-26** `request.loop.pause{all:true}` with no presence: every loop process group is killed, scratch work is parked at refs and every loop shows paused; resuming any of them takes fresh presence.
- **G-LOOP-27** Evidence carrying a planted secret is redacted before an escalation prompt and before `log.read`, and evidence blobs and parked refs are gone after uninstall.
- **G-LOOP-28** (TD-2026-10-23-268, TD-2026-10-23-448) A variable a check or act node names reaches its child, read from the loop's env files, and an unnamed one does not, even in the same file. A hazard name (`GNOMON_*`, `NODE_OPTIONS`, `LD_PRELOAD` …) is refused at validation and in the kernel. A declared name in no file, a missing linked file or a loose `~/.gnomon/loop-env` fails the node. Changing `env`, `envFiles`, `redact` or `network` moves the content hash; editing a value does not. `redact: off` leaves check output raw while the default redacts it, a handed-out value by literal too. A parked change carrying a value raises a hazard. `network: off` denies a loopback connect and `on` reaches it, never the kernel's port.

## 9. Milestones (build order)

| # | Scope | Size | Depends on |
|---|---|---|---|
| LP1 | `loop:v2` schema, validator (argv rules, budget defaults, goal inputs), `paradigm loop` CLI, `paradigm_loop` file ops | M | none |
| LP2 | `#loop-registry`, hashing (argv files, config closure, call pins), `loop-trust` card, opt-in envelope grant, `clientApiId` reservation | M | M1.6 |
| LP3 | Runner core: read checks, notify, call, ledger rows, restart fold, kill switch, uptime hold | L | M2.3 oracle profile |
| LP4 | Scheduler trigger forms, `#loop-events`, continuous | M | M1.9 |
| LP5 | Model nodes, local-first routing, Claude opt-in, escalation, budgets | L | M1.8 |
| LP6 | Act and write nodes, scratch worktree, protected goal inputs, land lock and refusals, commit identity, revert link | L | M2.5, M2.11 |
| LP7 | Kernel ops through MCP and CLI, attribution, `trust-status` | M | none listed |
| LP8 | GUI Loops view | L | Luna and Mika |
| LP9 | Examples A–D as templates; a one-week field run | S | none listed |

## 10. Founder decisions (2026-10-22)

Decided:
1. **D1. Uptime.** Gnomon keeps the daemon running while any loop is enabled, so scheduled loops fire with the app window closed. A visible status line says loops are keeping it up. Background start at login stays launchd, in 8.1 (§3.3, §4, §6).
2. **D2. Envelope default: none.** Every agent-created or agent-changed loop takes one `loop-trust` card. The envelope stays as an opt-in the founder can grant later (§3.1).
3. **D3. Commit identity.** Author and committer `Gnomon Loop <loop+<id>@gnomon.invalid>`, with trailers `On-Behalf-Of: <human>`, `Trusted-By: <cardId>`, `Gnomon-Loop: <id>@<hash8>`, `Gnomon-Run: <runId>` and `Loop-Authored-By: <principal>`. The kernel strips trailer-shaped lines from `land.message` and appends its own last (§3.2).
4. **D4. Claude.** Loops are local only by default (`model.use` defaults to local; escalation off). A loop may opt into the founder's Claude subscription with its own caps, shown on its trust card. No API tokens: law 7 is unchanged (G:1179). Loops' global Claude spend is 0 until a loop opts in, and `claudeWindowCeiling` (70 %) still applies to opted-in loops (§3.5).

Open:
1. **Sandbox before Move 2.** Until M2.3 ships the oracle profile, should read checks run under the `session` profile with that residual stated, or wait?
