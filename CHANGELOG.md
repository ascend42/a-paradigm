# Changelog

All notable changes to Paradigm will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [7.1.0] — Unreleased

**The v7.x fast-follows** — completing the loop-closure work v7.0 deliberately scoped down. *In-progress branch work; sections accumulate per round.*

### Added

- **The CLI orchestrator joins the loop** (`#task-bridge`): v7.0 closed the learning loop only for the MCP path; the standalone `paradigm` CLI orchestrator emitted no tasks and completed via an in-memory marker. A new `core/task-bridge.ts` adapter mints an epic + per-stage task DAG at run start and calls `completeTask` as stages finish — which triggers settlement and the `chainLive` learning chain exactly as the MCP path does. Wired into both the solo and multi-stage orchestration paths; every bridge call is best-effort, so a task-write failure never alters the CLI run. Reuses the low-level `task-loader` primitives via the established relative-import precedent (not the MCP-coupled `emitTaskDag`).

## [7.0.0] — 2026-06-13

**Close the loop.** A two-slice self-audit (the task system, then the orchestration engine that runs every other audit) proved with file:line evidence that Paradigm *records that it was asked to do the right thing but does not verify it did* — the classifier misroutes silently, the best agents aren't routable, the learning loop's broken state is byte-identical to its healthy state, enforcement checks invocation not work, and the Captain owns nothing. v7 makes the framework's own value proposition **true instead of asserted**, via one keystone: a persisted, symbol-bound, claimant-owned task DAG that orchestration emits, completion feeds back as learning, and Cid captains. It is **not** a project-management product (decision **TD-2026-06-13-718**; design in `docs/specs/v7-close-the-loop.md`).

v7.0 scopes loop-closure to the MCP path; deferred to v7.x: the CLI orchestrator `task-bridge`, a real pre-task confidence prior + belief-delta promotion, the Symphony peer status-flow-back watcher, multi-machine/multi-human teams, and the calibration learned-table.

### Added

- **The Spine — claimant-owned task DAG** (`#task-loader`): the `Task` schema gains a `claimant: { kind: 'archetype'|'human'|'peer', ref }` tagged union (not a flat assignee string), an `in-progress` status (v7.0 ships 4 states; `claimed`/`blocked` are fast-follow), DAG edges (`parentTaskId`/`dependsOn`/`stage`), `started_at`/`settledAt`, and a typed `external_ref` (the orphan `session_link` is lazily healed into it). Storage stays git-native YAML — no SQLite — via edge-list-in-node. A one-function `assertTransition` state machine, a `normalizeTask` load-shim, NaN-guarded sort, an `'active'` meta-filter, and a roots-aware index round it out. **The task system gains its first tests** (the audit found zero) — 23 unit tests.
- **Typed agent handoff** (`#agent-relay`): a new `AgentRelay` contract (`artifacts`/`decisions`/`handoffTo`/`filePlan`) + `parseAgentRelay`, replacing the free-text prose handoff between orchestration stages. The legacy hand-rolled regex parsers (`parseFilePlan`/`parseFilePlanFromResponse`) are **deleted** — `planBuilderStages` now consumes the typed `filePlan` field.
- **Orchestration emits the DAG** (`#orchestrator`): in `execute` mode, orchestration stops discarding the topo-sorted handoff graph it computes and **persists it as real tasks** — one epic task (`claimant: orchestrator`, `external_ref: {orchestration}`) plus one child per stage-agent with `parentTaskId`/`stage`/`dependsOn`/`claimant`. Each agent's prompt carries its `taskId` with instructions to flip `in-progress`/`done`, so status flows back and the loop has a durable spine to settle on. Emission is execute-only (plan/quick emit nothing) and degrades gracefully if a task-write fails. The Symphony (Cursor/peer) status-flow-back watcher is deferred to fast-follow — v7.0 scopes loop-closure to the MCP path.
- **The loop closes — task settlement feeds learning** (`#task-settlement`): when every sibling under a parent task reaches a terminal state, the parent *settles* exactly once and runs the wired learning chain `recordWorkLog → runPostflightLearning → autoPromoteJournalEntries` — the joint the audit found dead (`task_done` used to feed nothing). Settlement is triggered from inside `updateTask` (so `done`/`shelved`/direct sets all fire it, no drift), is idempotent (`settledAt`), self-settles orphans, and a **reaper** crashes abandoned `in-progress` tasks (stale past a time window) so a dead run can't wedge the subtree. Settlement only ever writes `settledAt`/crash markers — never live status — holding the Cid↔Loid boundary.
- **"Self-improving" is now falsifiable** (`#task-settlement`): each settlement appends a `chainLive` record to `.paradigm/events/settlement-liveness.jsonl` (per-stage `ok|threw|skipped`, written in a `finally` so a mid-chain throw still records *which* stage died). A new **`paradigm doctor` learning-loop-liveness check** screams when the chain is severed — comment out postflight, settle once, and the check flips red. This replaces the circular JPS metric (which couldn't tell a clean run from a dead chain).
- **Cid becomes a real Captain** (`#captain-board`): a new `paradigm_captain_board` tool gives the Captain a durable owned artifact — the live run-DAG (epic tasks + their stage children ordered by `dependsOn`, plus ripple-ranked `unclaimed`). At **session-open**, Cid now runs the reaper, reads the board, and **proposes claimants by writing them back** (a real per-session mutation, replacing the old anonymous task dump) — falling back safely to the plain list if the board read fails. At **session-close**, the debrief reads the liveness probe to check the learning chain actually ran; if it didn't, Cid **self-heals** (runs postflight himself) rather than blocking, and only ever proposes an `advise` block — never `guard`, so a learning-loop gap can't deadlock a human. Resolves the audit's "the Captain owns nothing / never does anything" finding; holds the Cid↔Loid boundary (Cid writes `claimant`/live state, never `settledAt`).
- **The framework teaches the new model** (`#university-content`): a new Paradigm University course, **PARA 801 "Closing the Loop (v7)"** — 6 notes + 6 quizzes + a learning path (24 assessment items) covering the claimant-owned task DAG, orchestration emission, settlement, the falsifiable `chainLive` probe, Cid's Captain board, and the self-audit/adversarial-review method that produced v7. The framework eats its own dog food. v7 symbols (`#task-settlement`, `#captain-board`) registered via `paradigm_purpose_*`.

### Changed

- **Notebook promotion gates on a real `confidence_after`** (`#nomination-engine`): the absolute `≥0.8` promotion gate stays, but its input is no longer a branch literal — agents emit an optional `confidence` that `runPostflightLearning` prefers (falling back to the old literal only when absent). `confidence_before` remains a literal, now explicitly marked *not gated on*; the belief-delta gate is deferred to v7.x (a real pre-task prior needs unbuilt elicitation + corpus migration — designed honestly rather than shipped on synthetic numbers).
- **Honest classification** (`#orchestrator`): the keyword classifier is rebuilt as confidence-scored with intent-verb anchoring. The "bugfix poison-pill" is gone (an audit of a *broken* system no longer routes to `[security, builder]`); new `audit`/`design`/`research` families map to **read-only analyst rosters that never route to a fixer**; every mode response now surfaces `{type, confidence, alternativeType, overrideHint}` so a misroute is visible and correctable. The second divergent inline classifier is collapsed — `classification.type` is authoritative.
- **Full-roster routability** (`#orchestrator`): the trigger-based `agent-matcher` becomes the primary roster/suggestion source so previously-unroutable specialists (`product`/North, `forge`/Loid, `researcher`/Scout, `dx`/Helix) can actually be assembled by auto-orchestration, not only by hand.

### Fixed

- **Notebook retrieval could never match its own writes** (`#notebook-loader`, `#nomination-engine`): promoted entries stored concepts like `symbol:payment-form` while queries arrived as bare slugs (`payment-form`), so `relevantEntries` was structurally always 0 — the entire notebook-grounding layer silently returned nothing. A shared `normalizeConcept` (strips `symbol:` prefix + Paradigm sigils, lowercases) now normalizes on **both** store and query sides. (Framework-bug T-2026-06-13-001.)

## [6.8.0] — 2026-06-10

**Pillar 0: invocation reliability.** The most common field failure isn't that the agent team works badly — it's that the main agent never invokes it. CLAUDE.md mandates and memory notes are instructions, and instructions leak; hooks are deterministic. This release graduates team-invocation from the instruction tier to the hook tier, advisory-first: measure the funnel before gating it (team-ratified: Arky's mechanism ladder, Loid's telemetry + anti-distortion amendments).

### Added

- **Prompt gate** (`UserPromptSubmit` hook) — classifies each incoming prompt; orchestration-eligible tasks get a decision-time directive injected into model context ("standing opt-in exists — orchestrate or declare solo"), at most once per TTL window. Telemetry fires on **every** match so the classifier's false-positive rate is measurable from day one.
- **Team edit-gate** (`PreToolUse` Write|Edit hook) — one-time advisory before source edits in sessions that have neither orchestrated nor declared solo. Never blocks at this tier.
- **`paradigm solo <reason> [note]`** — declare a deliberate no-team session with an *enumerated* reason (`trivial` | `hotfix` | `user-directed` | `exploratory`). Satisfies all orchestration gates for the work window and records a structured `solo-declared` event — bypass becomes a legible choice instead of silent drift ("enums give distributions, strings give vibes" — Loid).
- **Team-funnel telemetry** (`.paradigm/events/team-funnel.jsonl`) — `eligible` / `edit-advisory` / `orchestrated` / `solo-declared` / `bypass` events; the stop hook's orchestration check (Check 13) now records **deduped** bypass events even at warn severity, and `paradigm_orchestrate_inline` records `orchestrated`. New `#team-funnel` core module computes the **team-invocation rate** and **legible-resolution rate**, surfaced in `paradigm doctor` (warns when bypasses outnumber team runs).
- **TTL-based gate markers** — `.solo-declared` / `.team-prompted` / `.team-reminded` expire by age (`PARADIGM_GATE_TTL_HOURS`, default 4h) instead of being stop-cleared. Review-caught: the Stop hook fires per assistant *turn*, so clearing there would erase solo declarations mid-session, re-nag every turn, and double-count bypasses — corrupting the very telemetry the gates are calibrated from. Kill switch: `PARADIGM_TEAM_GATE=off`.

### Notes

- **Advisory-everywhere first, ~4 weeks** (Loid): no gate graduates to blocking until baseline data exists — graduation criteria live in the funnel metrics, not vibes. Planned follow-ups: hollow-invocation detector (quarantine compliance-theater sessions from expertise updates), Cursor-side gate parity, `team-funnel.jsonl` rotation, and the TEP compiler (strategy decision recorded in lore).

## [6.7.1] — 2026-06-09

### Fixed

- **`paradigm_wisdom_record` (antipattern) crash** — recording an antipattern threw `Cannot read properties of undefined (reading 'push')` when an existing `antipatterns.yaml` parsed to an object without an `antipatterns` array (an empty file, or one hand-edited down to just `version:`). `recordAntipattern` overwrote its safe default with `yaml.load(...)` and never re-normalized before `.push`. Now both the project writer (`recordAntipattern`) and the global writer (`recordGlobalAntipattern`) normalize the loaded data — coercing a missing/`null` `antipatterns` to `[]` and falling back to a fresh store on malformed YAML — so the write never crashes. (Field-reported by the dealoracle agent team; the root cause was the defensive-load gap, **not** an unregistered symbol as first suspected.) Regression-tested for the empty-file, no-key, fresh, and append cases.

## [6.7.0] — 2026-06-09

A new orchestration primitive, born from a team debate about persistent subagents. The not-chat project asked whether Paradigm should adopt Claude Code's experimental warm/`SendMessage` subagents so multi-round work with the same specialist resumes a warm instance instead of re-contexting each round. The team (Architect, Builder, Loid) reframed it: the re-context tax only bites in *intra-specialist iteration loops*, and we don't even have an iteration-loop primitive — so build that first, statelessly, with no dependency on the experimental flag (decision **TD-2026-06-09-522**).

### Added

- **Stateless iteration-loop primitive** (`Orchestrator.runIterationLoop`) — runs the SAME specialist across multiple rounds (re-review / iterate-with-same-role) without warm/persistent subagents. Each round is a fresh spawn; continuity is carried by a typed `IterationDelta` threaded into the next round's task. Three guardrails are baked in:
  - **Typed convergence** — the verdict is read from a typed `` ```iteration-verdict `` block the agent emits (`approved` / `changes-requested`), never inferred from free-text. In ping-pong mode only the **reviewer's** approval is authoritative (a fixer can't self-approve the loop closed).
  - **Required `maxRounds`** — no implicit infinite path. Exhausting the cap without convergence returns a structured `unresolved` result (`max-rounds` / `unparseable-verdict` / `spawn-failed`); the last attempt is never returned as a pass.
  - **Belief-revision promotion** — at each round boundary, genuine belief revisions (not mere progress) are externalized to the learning loop, so insight isn't trapped in a discarded round.
- **Agent self-revision learning channel** — `.paradigm/events/iteration-revisions.jsonl`, written by the orchestrator and consumed by the postflight learning pass into `self_reflection` journal entries. Kept strictly separate from the human-verdict channel (`verdicts.jsonl`) so agent self-revisions never pollute human-feedback provenance or nudge expertise scores. Defaults to project-scoped (`transferable: false`).
- **`orchestration.iteration` config** in `agents.yaml` (`enabled`, `defaultMaxRounds`, `defaultMode`) — convenience defaults for callers; `runIterationLoop` still requires `maxRounds` explicitly.
- **Live wiring into the faceted pipeline** — when `orchestration.iteration.enabled` and the plan has both builder + reviewer, the reviewer is asked for a typed verdict; a `changes-requested` verdict escalates into a bounded builder↔reviewer re-review loop (`maxRounds` forced even so it ends on a reviewer round). The loop's rounds fold into the orchestration result (per-round cost + tokens, honoring `agentBudgets`); an unconverged loop is surfaced as `iterationOutcome` and is **non-blocking** (the reviewer stage is itself non-required). The tester re-runs once against the converged code. Off by default — no behavior change unless a project opts in.
- **Relay text surfacing** — the spawner now keeps a bounded (32KB) rolling tail of the agent's final text on `AgentRelay.rawResponse`, so `parseIterationVerdict` reaches the trailing `iteration-verdict` block on real providers. The parser matches the **last** block (an agent often echoes the instruction's placeholder template first).

### Notes

- **Scope:** ships the primitive + faceted-pipeline escalation + 14 unit tests. Still tracked as follow-ups: an interactive MCP→Task iteration protocol, and single-role auto-use. Warm/`SendMessage` resume remains a documented future accelerator only — addable to this seam later, behind our own config, never the experimental flag.

## [6.6.6] — 2026-06-01

A structural refactor, not a behavior change: the pack/content-loading logic that we fixed *the same way three times* across v6.6.2–6.6.5 (because it was copy-pasted into the MCP tools, the CLI, and the serve server) is now extracted into **one shared package**, `@a-company/university-core`. Future pack-loading fixes land once, for all three surfaces. Read-path behavior is byte-identical; the only user-visible delta is a tiny search improvement (D5 below).

### Added

- **`@a-company/university-core`** — a lean, dependency-light package (only `js-yaml` + `zod`, **zero `@a-company` deps**) that now owns the content loader, pack discovery, content-base resolution, the university types, a unified write path, and a logger seam. The MCP loader, CLI storage, and serve server all import it; their old copies are thin re-export shims (the `anchor-path.ts` precedent). The probe behind `T-2026-05-31-001` and the duplication behind `T-2026-06-01-001` are unified away.

### Changed

- **Pack-loading is now single-source.** `packages/paradigm-mcp/.../university-loader.ts`, `packages/paradigm/.../core/university/storage.ts`, and the serve server's `resolveContentBase` are now shims/imports over `university-core`. The serve server's previously-divergent content-base probe (it omitted `policies/` and had no fallback) is replaced by the canonical one. The lean core is **bundled** into both the server and CLI outputs (verified inlined — no external resolution at runtime).
- **`paradigm university` search now matches tags** in addition to title and id (D5). Previously the CLI search matched only title+id; it now also matches tags, bringing it in line with the MCP search (which already did). Strictly more results — additive.

### Tests

- `university-core`: 28 new (golden read-path over `content/` + `src/content/` fixtures, `normalizeSections` golden matrix, drift-guards incl. probe parity). Suites hold: paradigm-mcp 286, CLI 360, university 46 (+1 pre-existing, unrelated). End-to-end **built-CLI serve smoke** verified: `serve --pack ai-literacy` → `mode:project`, 5 sections.

### Versions

- `@a-company/university-core`: **0.1.0** (NEW — must be published *first*; the others depend on it)
- `@a-company/paradigm`: 6.6.5 → **6.6.6**
- `@a-company/paradigm-mcp`: 6.6.5 → **6.6.6**
- `@a-company/university`: 6.5.1 → **6.5.2**
- Plugin `plugin.json`: 6.6.5 → **6.6.6**

---

## [6.6.5] — 2026-05-31

A thorough sweep of the University `pack` selector across **all three surfaces** — the v6.6.4 fix only covered the MCP read tools, but the CLI commands and the `serve` server had the same bug class (the logic was duplicated and only one copy was fixed). Triaged into ~14 findings across three packages; fixed, reviewed, and live-verified (`serve --pack ai-literacy` now mounts the pack's 5 sections; `serve --port` is honored).

### Fixed

- **`paradigm university serve --pack <id>` now mounts the selected pack.** The CLI resolved the pack context but never forwarded it to the HTTP server, which hardcoded first-party detection — so `/api/pack-config` always returned "Paradigm University" regardless of `--pack`. The server's `ServerOptions` now carries `packRoot`/`packId`, and a new exported `buildPackConfig()` resolves the selected pack's manifest (mode, branding, version, sections) with a dual-base content probe. (`packages/university`, `commands/university/serve.ts`)
- **`paradigm university serve --port <n>` is now honored.** `--port` was declared on both the parent `university` command and the `serve` subcommand, so commander applied the parent default (3839). Fixed with `enablePositionalOptions()` so the subcommand wins. (`packages/paradigm/src/index.ts`)
- **All CLI university subcommands now honor `--pack`/`--discipline`.** `list`, `search`, `status`, `validate`, `show`, `quiz`, and `add` resolved the pack but passed the project root to a separate `core/university/storage.ts` that had no `packRoot` awareness (hardcoded `.paradigm/university/` + `content/`-only). Ported the v6.6.4 loader contract into `storage.ts` (pack-root threading, `content/`↔`src/content/` dual-base probe, scan-fallback `loadPackIndex`), so discipline and first-party packs are now visible/editable from the CLI.
- **`paradigm_university_onboard` now works for sections-only packs.** Onboarding loaded categories from the *project* config and partitioned by category; a pack that uses **sections** (no categories), like a fresh discipline pack, produced an empty/wrong sequence. It now loads pack-scoped config and, when the pack declares `sections:`, partitions and orders by section. Diplomas are also pack-scoped. (`packages/paradigm-mcp`)

### Changed

- **`paradigm_university_search` now reports truncation.** Results include `total`/`returned` so callers know when the default page (20) cut the list. The dead `discipline` filter (declared but never applied) was removed from the search schema. Index rebuilds are now guarded to the project pack only. (`packages/paradigm-mcp`)

### Tests

- +12 MCP (286 total), +10 university pack-config (headline: `buildPackConfig({packRoot})` → the pack's sections without launching a server), +21 CLI storage/wiring (355 total). Every no-selector path is asserted byte-identical across all three surfaces.

### Known follow-ups

- `T-2026-06-01-001` — extract a shared `@a-company/university-core` so the pack-loading logic (now ported into MCP loader, CLI storage, and serve server) stops being duplicated; folds in the latent dual-base predicate divergence and the `reference.json` packRoot inconsistency.
- `T-2026-05-31-001` — re-scoped onto the same extraction (probe rule now aligned on "first base that contains content").

### Versions

- `@a-company/paradigm`: 6.6.4 → **6.6.5**
- `@a-company/paradigm-mcp`: 6.6.4 → **6.6.5** (onboard section-aware; search truncation meta)
- `@a-company/university`: 6.5.0 → **6.5.1** (serve server pack resolution — bundled into the CLI, so it ships with the `@a-company/paradigm` publish)
- Plugin `plugin.json`: 6.6.4 → **6.6.5**

---

## [6.6.4] — 2026-05-31

Fixes the University `pack` selector being silently ignored by the read tools — discovered while authoring a multi-section discipline pack. The v6.0 `pack` argument is documented to "target a specific content pack," but `search`, `onboard`, and `validate` resolved the right pack root and then discarded it.

### Fixed

- **`paradigm_university_search` / `_onboard` / `_validate` now honor the `pack` selector.** All three resolved the correct `packRoot` via `resolveActivePack` and then called a loader hardcoded to `<rootDir>/.paradigm/university/index.yaml` — so selecting any non-default pack returned the project pack's content (or nothing). `search pack=<discipline>` and `search pack=paradigm` (first-party) both returned `0`. There were two root causes: the index path was hardcoded to the project pack, **and** the content base was hardcoded to `content/` while the first-party pack ships under `src/content/`. (`utils/university-loader.ts`, `tools/university.ts`)

### Changed

- **Pack entry loading is now pack-root-aware with a scan fallback.** New `resolveContentBase()` probes `content/` then `src/content/` (matching `countPackEntries`), `loadPackIndex()` reads a pack's `index.yaml` when present and otherwise builds entries in-memory by scanning the pack's content dirs (non-project packs ship no `index.yaml`), and `scanPackEntries()` is now the single source the on-disk index rebuild also uses. The default (no `pack` argument) path is byte-identical to before — it still reads the project `index.yaml` and keeps the rebuild-on-missing fallback. The CLI's separate University storage is unaffected.

### Tests

- `paradigm-mcp/tests/university-pack-selector.test.ts` (8) — `content/` and `src/content/` layouts both resolve; section filter works; `pack_list` count equals unfiltered search count; onboard/validate over a selected pack load bodies correctly; project-pack path unchanged; scan output equals the index-rebuild output. Suite: 274 passing.

### Versions

- `@a-company/paradigm`: 6.6.3 → **6.6.4**
- `@a-company/paradigm-mcp`: 6.6.3 → **6.6.4** (`university_search`/`_onboard`/`_validate` now honor `pack`)
- `@a-company/university`: 6.5.0 (unchanged)
- Plugin `plugin.json`: 6.6.3 → **6.6.4**

> Note: a follow-up (`T-2026-05-31-001`) tracks unifying `countPackEntries` onto `resolveContentBase` so the two content-base probes can't drift — latent, no shipped pack triggers it.

---

## [6.6.3] — 2026-05-29

Follow-up to v6.6.2's aspect-anchor fix, prompted by a second field report (`not-chat`). Fixes a duplication bug in `pm_postflight`, and — more importantly — discovers and fixes the **same false positive still live in `paradigm review`**: the aspect-anchor existence check was triplicated across three code paths, and v6.6.2 had only fixed one. All three now share a single helper.

### Fixed

- **`paradigm_pm_postflight` no longer emits duplicate stale-aspect warnings.** The anchor-existence check was nested inside `for (applies-to pattern) → for (touched symbol)`, so an aspect matching multiple touched symbols had each missing anchor reported once *per matching symbol* — N copies of the same warning. Findings are now deduped per `(aspect, anchor)`.
- **`paradigm review` (CLI) no longer reports false-positive aspect drift.** This surface still carried the pre-v6.6.2 bug — it resolved anchors with `path.join(cwd, anchor.path)` + `existsSync`, missing purpose-dir-relative and `../`-relative anchors and flagging valid anchors as "points to missing file." It now uses the correct shared resolver. (`commands/review/index.ts`)

### Changed

- **Consolidated the triplicated aspect-anchor check into one shared helper.** Extracted `checkAspectAnchors()` into `@a-company/premise-core` (the only package all three callers can import) — encapsulating applies-to matching, per-aspect dedup, purpose-dir anchor resolution via `resolveAnchorPath`, and emitting a neutral result each caller maps to its own output shape. `pm_postflight`, `paradigm review`, and the (dormant) `compliance-checker` now delegate to it, so this logic can't fork and drift again. `resolveAnchorPath` moved to premise-core with a back-compat re-export shim left in `paradigm-mcp/src/utils/anchor-path.ts`. premise-core gained test infra (vitest); its source is bundled into the published packages, so no separate publish.

### Tests

- `premise-core/src/aspect-anchors.test.ts` (6) — the consolidated helper: purpose-dir + `../`-relative resolution (no false positive), per-aspect and multi-aspect dedup, no-anchors. Plus `paradigm-mcp/tests/postflight-aspect-dedup.test.ts` (3) as the integration guard. Suites: premise-core 16, paradigm-mcp 276.

### Versions

- `@a-company/paradigm`: 6.6.2 → **6.6.3**
- `@a-company/paradigm-mcp`: 6.6.2 → **6.6.3** (`pm_postflight` dedup; bundles the relocated premise-core helper)
- `@a-company/premise-core`: 3.6.0 (source changed — `checkAspectAnchors` + `anchor-path` moved here — but bundled into consumers, not published separately)
- `@a-company/university`: 6.5.0 (unchanged)
- Plugin `plugin.json`: 6.6.2 → **6.6.3**

---

## [6.6.2] — 2026-05-29

Three framework-bug fixes surfaced from a field report in a downstream project (`dealoracle`). All three were confirmed against framework code with writer/reader evidence before fixing, reviewed (261/261 tests pass, no blocking findings), and are MCP-tool behavior changes.

### Fixed

- **`paradigm_pm_postflight` no longer false-flags every aspect anchor as a missing file** (was: high-impact). The stale-aspect check reimplemented anchor path resolution inline (`path.join(ctx.rootDir, anchor.path)`), which ignored purpose-dir-relative and `../`-relative anchors — so it reported anchors that `paradigm_aspect_check` resolves as `exists: true` as "points to missing file." It now uses the shared `resolveAnchorPath()` helper, the same resolver `aspect_check` uses, deriving `purposeDir` identically. This makes `aspect-anchors` enforcement safe to set to `block`. (`tools/pm.ts`)
- **`paradigm_flow_check` now sees flows defined in `.purpose` files** (was: silent blind spot). `flow_check` read only `.paradigm/flows.yaml`, while `purpose_add_flow` writes flows into `.purpose` files that `reindex` indexes into `flow-index.json`. Flows created via `purpose_add_flow` appeared in `search`/`reindex`/`flows_affected` but returned "Flow not found" from `flow_check`. It now merges both sources (flows.yaml wins on id collision) so `.purpose`-defined flows validate. (`tools/flows.ts`)
- **`paradigm_purpose_add_flow` no longer writes a junk `undefined: {}` key** into the `flows:` block (was: cosmetic / parse noise). `normalizeFlowsToRecord` keyed array-form flow entries by `flow.name`; a nameless entry coerced to the literal string key `"undefined"`. Both the array and record-passthrough branches now guard against missing/`"undefined"` keys. (`utils/purpose-writer.ts`)

### Tests

- Added regression coverage for the `flow_check` two-source merge (`tests/flow-check-merge.test.ts`) and the `normalizeFlowsToRecord` undefined-key guards (`tests/purpose-writer-flows.test.ts`) — 12 new tests, suite now at 273.

### Versions

- `@a-company/paradigm`: 6.6.1 → **6.6.2**
- `@a-company/paradigm-mcp`: 6.6.1 → **6.6.2** (`pm_postflight`, `flow_check`, `purpose_add_flow` behavior changed)
- `@a-company/university`: 6.5.0 (unchanged)
- Plugin `plugin.json`: 6.6.1 → **6.6.2**

---

## [6.6.1] — 2026-05-26

Follow-up polish on the v6.6.0 agent roster. Closes two naming loose ends (architect had no real nickname; cartographer was tier-1-known but unbundled and shared "Atlas" with devops) and advertises the now-68-agent roster in the README so its scope is visible from the front door.

### Added

- **`cartographer.agent` (Topo)** — bundled tier-1 architecture-cartographer profile. Maintains `.paradigm/arch.yaml`, computes drift between declared architecture and live symbols, renders Mermaid diagrams, advisory-only. Previously referenced in `AGENT_TIERS` and orchestration prompts but had no `.agent` file in the bundle — so it never appeared in `paradigm agent list` and never synced.
- **README agent roster** — replaces the prior "core team of 8 + 3 specialists" paragraph with the full 68-agent roster grouped by model tier, plus the `paradigm agent sync-global` CTA.

### Changed

- **architect nickname: `architect` → Arky** — every other tier-1 agent had a real handle; architect's placeholder nickname is fixed in both `architect.agent` and `CORE_AGENT_META` (fallback path, previously "Apex").
- **cartographer prompt identity: ATLAS → TOPO** in `orchestration.ts`. Devops keeps "Atlas" (it owned the name in the bundled v6.6.0 set); cartographer is now Topo, resolving the long-standing collision.

### Versions

- `@a-company/paradigm`: 6.6.0 → **6.6.1**
- `@a-company/paradigm-mcp`: 6.6.0 → **6.6.1** (orchestration.ts cartographer prompt updated)
- `@a-company/university`: 6.5.0 (unchanged — no university changes)
- Plugin `plugin.json`: 6.6.0 → **6.6.1**

---

## [6.6.0] — 2026-05-22

The full agent roster now ships with the package. All 67 canonical archetypes are bundled, every one has a behavior-shaping persona, and a new `paradigm agent sync-global` command materializes them into your global dir — fixing the long-standing "frozen roster" problem where a global update could never expand the agents available to you.

### Added

- **Bundled agent roster** — all 67 canonical archetypes ship as `.agent` profiles in the package (`packages/paradigm/templates/agents/`, distributed via the `files` field, no build step). Previously there was no shipped set; agents only existed ad-hoc in users' home dirs.
- **`paradigm agent sync-global`** — materializes the bundled agents into `~/.paradigm/agents/`. Default **skip-if-exists** (never destroys customizations); `--force` overwrites; `--dry-run` previews. This is how an update now actually delivers new agents to you.
- **8 new/promoted archetypes** — `agent-evaluator` (Crucible, generalized from a project-specific evaluator), `data-model` (Lattice), `domain` (Lexicon), `regulatory` (Codex), `geo` (Carto), `offline` (Tide), `forms` (Quill), `report-gen` (Press) — all brought from thin stubs to full canonical personas.

### Changed

- **Prompt assembler uses rich personas** (`agent-prompts.ts`) — resolution is now `ROLE_PROMPTS[name] → agent.description → agent.role → builder`. The 5 battle-tested hardcoded prompts (architect, builder, reviewer, security, tester) still win; the other ~62 agents now render with their rich multi-paragraph `description` instead of a thin one-line role or a generic builder fallback. Most agents behaved like "builder" before this fix.
- **`AGENT_TIERS` + `DEFAULT_MODELS` cover all 67** (`orchestration.ts`) — explicit tier assignments for every archetype plus a deterministic `tier-2`/`sonnet` fallback so unmapped agents resolve predictably instead of undefined.
- **Nickname collision resolved** — `mobile` (was "Swift") renamed to "Dash"; `swift` keeps "Swift". All 67 bundled agents now have unique nicknames.

### Fixed

- **Frozen-roster problem** — a global `npm update` never touched `~/.paradigm/agents/`, so users were stuck at whatever count they first onboarded (e.g. 26) regardless of framework growth. Bundling + `sync-global` closes this: `npm update` then `paradigm agent sync-global` gets you the full team.

### Migration

Existing users: run `paradigm agent sync-global` after updating to pull in any agents you're missing. Your customized profiles are preserved (skip-if-exists); use `--force` only if you want to reset to the bundled versions.

**Behavior change:** custom `role:` overrides in `agents.yaml` for the 5 hardcoded archetypes (architect, builder, reviewer, security, tester) no longer take precedence over the bundled prompts — the battle-tested constants now win for those 5. If you relied on overriding a core agent's persona, move the override into that agent's `description:` field in its `.agent` profile instead. All other archetypes are unaffected and now render from their `.agent` description.

### Versions

- `@a-company/paradigm`: 6.5.0 → **6.6.0**
- `@a-company/paradigm-mcp`: 6.5.0 → **6.6.0**
- `@a-company/university`: 6.5.0 (unchanged — no university changes)
- Plugin `plugin.json`: 6.5.0 → **6.6.0**

---

## [6.5.0] — 2026-05-18

University Sections — packs can group entries into named tracks, indexes, chronological streams, or featured shelves. The first-party Paradigm pack now ships a Core / Courses track plus a Field Notes index for nuanced explainers. Existing packs render unchanged via implicit-default back-compat.

### Added

- **`sections: Section[]`** field on `pack.yaml` (Zod-validated `Section = { id, name, order, style, description?, default? }`). The `style` enum is `track | index | chronological | featured`.
- **Optional `section?` and `order?`** frontmatter on note, quiz, policy, and path entries. Entries without `section:` land in the section marked `default: true`.
- **First-party pack manifest** declares two sections — Courses (track, default) + Field Notes (index). First Field Notes entry: `N-fieldnotes-pack-authoring.md` teaching project-pack authoring end-to-end.
- **`LP-fieldnotes-authoring.yaml`** — one-step learning path scaffolding the Field Notes section (Field Notes is index-style; a one-step path is acceptable until more entries land).
- **`docs/guides/university.md` §4.5** — new "Sections" section covering the four styles, the implicit-default back-compat rule, the `section` field disambiguation (pack-level vs question-level), and a worked example matching the first-party layout.
- **CLI flags**: `paradigm university add --section <id> --order <n>` for scoping new entries; `paradigm university list --section <id>` filter; sections-count annotation on pack rows.
- **FTUX advisories**: `paradigm university init` prints a one-line sections tip; `paradigm university serve` emits a one-shot advisory when running a pack without sections so authors know the primitive exists.
- **Section integrity checks** in `paradigm university validate`: duplicate id, two defaults, unknown section ref on entry, invalid style value, dangling section warning.
- **MCP**: `paradigm_university_search` accepts `section: <id>` filter; `paradigm_university_pack_list` returns `sections[]` per pack so agents can route queries appropriately.
- **UI**: `SectionNav` tab strip (collapsed for single-section packs to preserve v6.4 visuals) + `SectionView` style dispatcher. Track-only renderer at v6.5 — `index`, `chronological`, `featured` fall back to track with a dev-console warning until content demand justifies dedicated renderers.

### Changed

- **`packages/university/src/content/pack.yaml`** — declares two sections (Courses, Field Notes). Two sections triggers `SectionView` rendering end-to-end.
- **`/api/pack-config` payload** — includes `sections` so the UI can render the tab strip without a second round trip.
- **`/api/courses` summary items** — include `section` so the courses route can be filtered client-side.

### Migration

Packs authored without `sections:` continue to work unchanged. The server synthesizes an implicit default `main` section and the UI collapses SectionNav for single-section packs — pixel-identical to v6.4 for those packs. Declaring `sections:` is opt-in for packs that want the tab strip.

### Versions

- `@a-company/paradigm`: 6.4.0 → **6.5.0**
- `@a-company/paradigm-mcp`: 6.3.1 → **6.5.0**
- `@a-company/university`: 6.1.0 → **6.5.0**
- Plugin `plugin.json`: 6.4.0 → **6.5.0**

---

## [6.4.0] — 2026-05-10

University white-label support — any project with `.paradigm/university/pack.yaml` now gets its own branded experience: custom name, tagline, logo, favicon, tab set, and library. First-party Paradigm content is hidden in project mode.

### Added

- **`/api/pack-config` endpoint** — new server route returning `{ mode, branding, theme, version, hasProjectLibrary }`. The UI fetches this on mount to configure itself. No more hardcoded "Paradigm University" strings baked into the bundle.
- **`packConfigStore` (UI)** — Zustand store that loads `/api/pack-config` once on mount and provides `config` to all components. Falls back to Paradigm defaults on fetch error.
- **`BrandLogo` component (UI)** — renders a custom `<img>` when `branding.logo` is set, falls back to the Paradigm `<Seal>` SVG otherwise. Used in Header, HomeView hero, and CertificateView.
- **`UniversityBranding.tabs` + `startCourse` fields** (`packages/paradigm-mcp/src/types/university.ts`) — pack authors can now specify which tabs appear and which course the "Start Learning" button links to.

### Changed

- **`packages/university/src/server/index.ts`** — mode detection at startup (`paradigm` vs `project`); loads `pack.yaml`; merges branding with defaults; builds `packConfig` with `hasProjectLibrary` flag; serves `/api/pack-config`; project-mode `/api/reference` returns the project's `reference.json` or a clean 404 with `{ error: 'No reference library configured for this project.' }`
- **`packages/university/src/server/routes/courses.ts`** — `collectContentDirs()` skips the first-party `contentDir` entirely in project mode so Paradigm courses never appear in a white-labeled instance
- **`Header.tsx`** — branding name/tagline from store; tabs rendered from `config.branding.tabs` array (dynamic, not hardcoded); version badge reads from pack config
- **`HomeView.tsx`** — hero uses `BrandLogo`; name/tagline/motto from store; Paradigm-only description hidden in project mode; course cards no longer mangle IDs with `para-` string surgery; Quick Links section respects active tab set; "Start Learning" link uses `branding.startCourse` if set
- **`CoursesView.tsx`** — removed `para-` ID formatting; shows full `course.title` as-is
- **`CertificateView.tsx`** — heading and sub-title from pack config branding; `BrandLogo` replaces hardcoded `Seal`
- **`ReferenceView.tsx`** — detects non-OK HTTP response; surfaces the API's error message in the empty state (project mode without a reference.json shows "No reference library configured for this project." instead of a generic error)

### Versions

- `@a-company/paradigm`: 6.3.4 → **6.4.0**
- `@a-company/paradigm-mcp`: 6.3.0 → **6.3.1**
- `@a-company/university`: 6.0.5 → **6.1.0**
- Plugin `plugin.json`: 6.3.4 → **6.4.0**

---

## [6.3.4] — 2026-05-10

Fix: `paradigm university serve` now shows project packs — dealoracle, agency-intelligence, and any other `.paradigm/university/` pack created by an agent team.

### Fixed

- **Project packs invisible in the UI** — `universityCommand` never passed `projectDir` to `startServer`, so the server had no idea where the user's project was. Even if it had, `createCoursesRouter` had a hardcoded `.filter(p => p.id.startsWith('LP-para-'))` that silently dropped every non-Paradigm course. Three files changed:
  - `packages/paradigm/src/commands/university.ts` — pass `projectDir: process.cwd()` to `startServer`
  - `packages/university/src/server/index.ts` — forward `projectDir` to `createCoursesRouter`
  - `packages/university/src/server/routes/courses.ts` — add `collectContentDirs()` helper that discovers `.paradigm/university/` and its discipline sub-packs; update router to scan all content dirs and drop the `LP-para-` prefix filter

### How it works now

`paradigm university serve` run from `~/projects/dealoracle/` will serve:
1. First-party Paradigm courses (bundled in the CLI)
2. All courses in `~/projects/dealoracle/.paradigm/university/` (root pack + discipline sub-packs)

First-party wins on course id collision. Project packs appear alongside Paradigm courses on the home page.

### Versions

- `@a-company/paradigm`: 6.3.3 → **6.3.4**
- `@a-company/university`: 6.0.4 → **6.0.5**
- Plugin `plugin.json`: 6.3.3 → **6.3.4**

---

## [6.3.3] — 2026-05-07

Agent roster corrections and docs accuracy pass — Loid, Atlas, Rune now appear on all relevant surfaces.

### Changed

- **`README.md`** — "The agent team" paragraph: added Loid, Atlas, Rune as named additional specialists; they were absent from the only agent-roster sentence users see before clicking into the agents guide
- **`docs/guides/agents.md`** — "six core + three specialty" framing replaced with non-numbered section headers; Rune (compliance, promotion state machine) added to core table; Atlas (cartographer, `arch.yaml`) added to specialty table; roster shift comment updated
- **`plugins/paradigm/README.md`** — Getting Started step 1: removed `/paradigm:init` as an equal-weight alternative to `/paradigm:shift` — init is available in the skills table for reference but should not be presented as the recommended first-run path
- **`docs/guides/university.md`** — §9.2: "v6.3 (~Q3 2026) will review" updated to reflect that v6.3 shipped May 2026 and the first review has been triggered
- **`docs/guides/mcp-setup.md`** — "Last Updated" date corrected from 2026-04-07 to 2026-05-07

### Versions

- `@a-company/paradigm`: 6.3.2 → **6.3.3**
- Plugin `plugin.json`: 6.3.2 → **6.3.3**

---

## [6.3.2] — 2026-05-07

Docs polish pass for public launch — migration guide extended through v6.3, enforcement default explained, agent roster corrected.

### Changed

- **`docs/guides/v6-migration.md`** — renamed to "v6 Migration Guide"; TL;DR flags the enforcement default change; new §11 covers v6.1–v6.3 behavioral changes (enforcement default `minimal` → `none`, Rune promotion state machine, Atlas + `arch.yaml`, soft-block + `paradigm override`); audience track map updated with v6.x-upgrader paths
- **`docs/guides/quick-start.md`** — `paradigm sync --all` step annotated as already done by `paradigm shift` (without `--quick`); new "About enforcement" section explains the `none` default and Rune onboarding
- **`docs/guides/symphony-quickstart.md`** — version floor corrected from v3.35.0+ to v6.0.0+; "Coming Soon" nevr.land relay header updated to "Roadmap"
- **`docs/guides/mcp-setup.md`** — plugin agents table updated: added documentor, ftux (Nora), captain (Cid) to the previously incomplete 5-agent list

### Versions

- `@a-company/paradigm`: 6.3.1 → **6.3.2**
- Plugin `plugin.json`: 6.3.1 → **6.3.2**

---

## [6.3.1] — 2026-05-06

University bug fix release — crash on course load, PLSAT inaccessible, five broken quiz files.

### Fixed

- **`CourseView.tsx` crash on course load** — `activeLesson.keyConcepts` and `activeLesson.quiz` were both accessed without null guards. Any lesson without quiz data threw `TypeError: Cannot read properties of undefined (reading 'length')`. Both guarded with optional chaining.
- **Server never set `keyConcepts` or `quiz` on lessons** — `courses.ts` now initializes both fields to `[]` on every lesson, consistent with the `ClientLesson` type.
- **PLSAT completely inaccessible** — `PLSATView.tsx` hardcoded `fetch('/api/plsat/3.0')`. PLSAT v3 YAML had a parse error, causing the server to return 500 and the UI to silently dead-end on "PLSAT Unavailable". Fixed by dynamically fetching available versions via `/api/plsat` and loading the highest available.
- **PLSAT v3 YAML parse errors** (`Q-plsat-v3.yaml`) — two unquoted YAML scalars containing `: ` caused `js-yaml` to throw on load. Both quoted.
- **PARA 701 quiz YAML parse errors** — `Q-para-701-arch-mcp-tools.yaml` had three unquoted colon-space patterns; `Q-para-701-arch-yaml-format.yaml` had one. All four fixed.
- **Wrong quiz schema** — `Q-para-401-notebooks-permissions.yaml` and `Q-para-501-review-compliance.yaml` used `options: []` + integer `correct` (legacy format) instead of `choices: {A:…}` + letter `correct`. Both rewritten to current schema; UI was silently rendering blank choice lists.

### Versions

- `@a-company/paradigm`: 6.3.0 → **6.3.1**
- `@a-company/university`: 6.0.3 → **6.0.4**
- Plugin `plugin.json`: 6.3.0 → **6.3.1**

---

## [6.3.0] — 2026-05-02

`none` enforcement preset — the new global default. Adds Rune's promotion state machine so teams that want symbol tracking can opt in when they're ready, not before.

### Added

- **`none` enforcement preset** — fourth preset level, all 13 checks set to `off`. Fresh `paradigm shift` now produces `enforcement.level: none`. Teams adopting Paradigm for agents, Sentinel, or Conductor are never interrupted by compliance warnings they didn't ask for.
- **Rune promotion state machine** (`packages/paradigm-mcp/src/utils/rune-promotion.ts`) — detects readiness signals (symbol syntax usage, auth/dependency questions, 3+ file sessions) and invites users to enable symbol tracking via `minimal` or `balanced`. State persisted in `rune.promotion` section of `.paradigm/config.yaml`. Snooze defers 7 days; `never` suppresses permanently.
- **`paradigm_compliance_promote` MCP tool** — records user's response to Rune's promotion offer. `minimal`/`balanced` both write the enforcement level and promotion state; `snooze` and `never` record preference without changing enforcement. Used by Rune and callable directly.
- **Rune Promotion Protocol in orchestration ROLE_PROMPTS** — Rune (compliance agent) now checks for the `none` default and presents the symbol-tracking invitation when readiness signals appear. Self-regulates to one invitation per session.
- **`paradigm shift` awareness line** — `paradigm shift` success output now surfaces `Enforcement: none — symbol tracking available when you're ready. Rune will guide you.`
- **University: N-para-301-rune-promotion.md** — new note covering Rune's promotion model, readiness signals, and the "enforcement you earn, not endure" philosophy.
- **University: Q-para-301-enforcement-levels.yaml q4–q5** — two new quiz questions covering `none` as default and Rune's promotion flow.
- **University: Q-para-701-orchestration-enforcement.yaml q6** — new question covering `none` enforcement gating off the `orchestration-required` check.

### Changed

- **Global default enforcement level**: `minimal` → `none`. Existing projects with an explicit `level:` in their config are unaffected.
- **University N-para-301-enforcement-levels.md** — updated to "Four Enforcement Levels", `none` section added, progression strategy rewritten to opt-in model, `minimal` description corrected (no longer described as the default).
- **University N-para-001-shift-setup.md** — updated "Hooks Are Installed" paragraph to reflect `none` default.
- **University N-para-501-hook-enforcement.md** — clarifying paragraph added: stop hook checks are gated by enforcement level; at `none` they are all off.
- **University N-para-301-paradigm-shift.md** — `config.yaml` entry annotated with `enforcement.level: none by default`.
- **University N-para-701-orchestration-enforcement.md** — clarifying note added under `orchestration-required`: off at `none`, can be overridden individually.

### Versions

- `@a-company/paradigm`: 6.2.1 → **6.3.0**
- `@a-company/paradigm-mcp`: 6.2.1 → **6.3.0**
- Plugin `plugin.json`: 6.2.1 → **6.3.0**

---

## [6.2.1] — 2026-05-02

Capability discovery and orientation — new users asking "what can Paradigm do?" in an active Claude session now get a purpose-built answer. Adds North (product strategist, agent #68) to the agent roster.

### Added

- **Capability preamble in `paradigm://context/agent-protocol`** — "What Paradigm Is" section prepended to the agent-protocol resource: what it does, 50+ tool surface organized by category, setup command. Replaces the previous 7-tool stub table.
- **`capabilities` pointer in `paradigm_status` output** — every status call now includes `"capabilities": "paradigm://context/agent-protocol"` so agents route to the capability guide without needing to enumerate resources separately.
- **Atlas auto-activation signal** — `paradigm_status` includes `"arch": { "present": true, "tiers": N, "links": N }` when `.paradigm/arch.yaml` is detected. Atlas (cartographer) reads this at session start and activates automatically to explain and diagram the project architecture.
- **North (`product`, agent #68)** — product strategist agent. Evaluates features and direction against the core value proposition. Tier-1/opus, advisory-only. Added to roster and `.paradigm/agents/product.agent`.

### Fixed

- **`paradigm_status` description drift** — removed false "available features" claim from tool description.
- **F-03 doc drift** — `docs/guides/quick-start.md` (6 locations) and `docs/guides/mcp-setup.md` (1 location) updated to use `paradigm shift` instead of the legacy `paradigm init --quick` sequence. First-session path now matches README and installs enforcement hooks correctly.

### Versions

- `@a-company/paradigm`: 6.2.0 → **6.2.1**
- `@a-company/paradigm-mcp`: 6.2.0 → **6.2.1**
- Plugin `plugin.json`: 6.2.0 → **6.2.1**

---

## [6.2.0] — 2026-04-28

Atlas the Cartographer — Agent #67, architecture map agent. Introduces `.paradigm/arch.yaml` as the canonical project architecture manifest (tiers, stacks, links), two new MCP tools for status and Mermaid diagram generation, a `paradigm arch` CLI, and the `cartographer` archetype registered in the orchestration tier system.

### Added

- **Atlas (`#atlas-agent`, archetype: `cartographer`, tier-1/opus)** — Agent #67. Fires during orchestration after Builder to detect architectural changes and keep `.paradigm/arch.yaml` current. Advisory-only: reads arch.yaml, .purpose files, and symbols; no write permissions beyond the arch manifest itself.
- **`.paradigm/arch.yaml` artifact** — canonical architecture manifest. Fields: `tiers` (list of named tiers each with `label`, `tech`, `components`), `links` (directed tier relationships with `type`). Supports any project structure (monolith, monorepo, microservices).
- **`paradigm_arch_status` MCP tool** — returns tier summary + drift report (unassigned symbols, components missing .purpose). Read-only.
- **`paradigm_arch_diagram` MCP tool** — generates a Mermaid `graph TD` flowchart from arch.yaml. Optional `format` param (`mermaid` default, `json`).
- **`paradigm arch` CLI command** with two subcommands:
  - `paradigm arch status` (default) — prints tier table + drift summary
  - `paradigm arch diagram` — prints Mermaid flowchart to stdout
- **`arch-loader.ts` utility** (`packages/paradigm-mcp/src/utils/arch-loader.ts`) — shared `loadArchMap`, `saveArchMap`, `getArchDrift`, `generateMermaid` helpers.
- **Feature-tier registration** for `arch` — activates only when `.paradigm/arch.yaml` exists (no-op on projects that haven't adopted it).
- **`archMap?` on `ContextBrief`** — captain brief includes arch map when present so orchestration agents have architectural context.
- **University PARA 701, Lessons 11–13** — three new notes + three paired quizzes covering arch.yaml schema, Atlas agent behavior, and MCP tool usage.
- **PLSAT slots 129–133** — five new exam items for arch/cartographer concepts.

### Changed

- `AGENT_TIERS` — `cartographer: 'tier-1'` registered alongside all other archetypes.
- `AGENT_TOKEN_ESTIMATES` — `cartographer: { min: 1000, max: 5000 }`.
- `LP-para-701.yaml` learning path extended with 6 steps (lessons 11–13).

### Versions

- `@a-company/paradigm`: 6.1.0 → **6.2.0**
- `@a-company/paradigm-mcp`: 6.1.0 → **6.2.0**
- `@a-company/university`: 6.0.2 → **6.0.3**
- Plugin `plugin.json`: 6.1.0 → **6.2.0**

---

## [6.1.0] — 2026-04-28

Sprint 1 of v6.1 closes the agent-owned soft-block primitive arc. Building on v6.0.5 (which shipped Sprint 1 Waves 1-2 + path-bug fix), this release adds the user-facing CLI (`paradigm override`), full regression test coverage, and agent-prompt teaching docs.

### Added

- **`paradigm override` CLI command** (Wave 3). Three subcommands:
  - `paradigm override <id>` — clears single remediation, archives YAML to `.paradigm/remediations/.archived/<id>.yaml` with `archived_at` stamp, appends override event to `.paradigm/events/overrides.jsonl` with `mechanism: cli`
  - `paradigm override list` — table of active remediations (or JSON in non-TTY)
  - `paradigm override clear-all --force` — bulk clear, one event row per cleared remediation
- **CLAUDE.md "Agent-Owned Soft-Blocks (v6.1)" section** teaching agents when to call `paradigm_propose_block`, severity guidance, override mechanics, and v6.2 forward-compat notes.
- **Regression test suite** (Wave 5) covering all 10 spec §9 cases (cohorts A-J).

### Internal

- Refactored `packages/paradigm/src/commands/internal/active-remediations.ts` to expose pure `getActiveRemediations()` helper + `RemediationOutput` type — direct-imported by `paradigm override list` (no subprocess), Stop hook still uses the helper command output unchanged.
- Atomic `fs.rename` for archive moves (crash-safe).

---

## [6.0.5] — 2026-04-28

Path-bug fix + early v6.1 Sprint 1 work. Headline: writer/reader path-resolution mismatch in `paradigm_purpose_add_aspect` ↔ `paradigm_aspect_check` is fixed. Anchors with `..` prefix (crossing directories) now resolve correctly. Includes Sprint 1 Waves 1-2 of v6.1's agent-owned soft-block primitive — additive, no breaking changes.

### Fixed

- **`paradigm_aspect_check` and `paradigm_aspect_drift` path-resolution.** Writer (`paradigm_purpose_add_aspect`) stores anchors as `.purpose-dir-relative` (e.g., `../component.ts`); both readers previously resolved as project-root-relative, marking valid anchors as "missing." Affects v6.0.0–v6.0.4. Fix: shared `resolveAnchorPath()` helper at `packages/paradigm-mcp/src/utils/anchor-path.ts` tries absolute → project-root → purpose-dir; first to `fs.existsSync` wins. No data migration required. Both `aspect_check` and `aspect_drift` (Jinx audit caught the second tool had identical bug) now share the helper. Roundtrip integration test (`aspect-roundtrip.test.ts`) is the first writer→reader test in the codebase — now a category requirement going forward. See `.paradigm/research/path-bug-and-agent-protocol-analysis.md` for full team analysis.
- **`paradigm_aspect_check` returns `resolution_hint`** when a base mismatch is detected (Helix DX scaffolding) — surfaces the framework-bug protocol entry point so future writer/reader drifts of this class don't nudge agents toward hand-editing.

### Added

- **`paradigm_propose_block` MCP tool** (v6.1 Sprint 1 Wave 1). Agent-initiated remediation: writes `.paradigm/remediations/<id>.yaml` with `severity: advise | auto-author | guard`. Stop hook honors at next run. User overrides via `paradigm override <id>` (CLI coming in Sprint 1 Wave 3) or `PARADIGM_OVERRIDE=<id>` env var.
- **`paradigm_authority_claim` / `paradigm_authority_release` MCP tools** (v6.1 Sprint 1 Wave 1). Read/write `.paradigm/authority.yaml` schema shipped at v6.0.4. Idempotent on `scope` key — single-claimant-per-scope at v6.1.
- **Stop hook Check 14 — remediation gate** (v6.1 Sprint 1 Wave 2). Reads `.paradigm/remediations/` via new `paradigm internal active-remediations --json` helper (avoids YAML parsing in bash). Honors `PARADIGM_OVERRIDE` env var with comma-separated id list. Override events written to `.paradigm/events/overrides.jsonl` for Loid calibration.
- **Framework-bug protocol** (`.paradigm/protocols/framework-bug-surface.protocol`). Decision tree for agents: when an MCP tool gives unexpected output and the cause is in framework code (writer file:line + reader file:line evidence), file `paradigm_task_create` with tag `framework-bug`. Domain ownership follows the broken tool (Rune for compliance tools, Aegis for security, Scholar/Loid for learning, Cid for navigation). v6.1 will add soft-block escalation via `paradigm_propose_block(claimant: 'framework')`. CLAUDE.md and `docs/guides/agents.md` updated with the protocol.
- **Migration notice append** for projects with `~aspects` defined: notes that v6.0.5+ fixes the reader path-resolution bug, no data migration required. Folded into existing v6.0.4 cohort-C notice text — no new marker file.

### Changed

- **`packages/paradigm/src/core/authority.ts`** extended with reader/mutator API (`readAuthority`, `getActiveClaims`, `upsertClaim`, `removeClaim`) consumed by the new authority MCP tools. v6.0.4 shipped only the writer.
- **PARA 451 `N-para-451-tiers`** appended "Updated in v6.0.5" callout pointing at the shared `resolveAnchorPath()` helper for learners curious about path-resolution semantics.

### Internal

- New `paradigm internal active-remediations --json` hidden CLI command (mirrors `migrate decisions` pattern). Backs Stop hook Check 14 — bash never parses YAML directly.
- 12 new tests in paradigm-mcp (10 anchor-path unit tests + 2 aspect-roundtrip integration tests). 233 paradigm-mcp tests pass.
- 320 paradigm tests pass / 1 skip (no regression from v6.0.4).
- `paradigm-mcp` package version bumped 6.0.3 → 6.0.5 (was held at 6.0.4 release per TD-2026-04-26-546; bumped now because new MCP tools shipped).

---

## [6.0.4] — 2026-04-26

Agent-owned enforcement pivot. Symbol/aspect enforcement (aspect drift, aspect coverage) is now claimed by the `compliance` archetype agent (Rune); when no compliance archetype is on the roster, the Stop hook no longer blocks on aspect drift / aspect coverage. The framework continues to surface metrics via `paradigm doctor` and writes `compliance-history.jsonl` unconditionally so observability/learning loops stay intact. Anchor existence (Check 4) and lore-required (Check 7) remain framework-level — they are syntax/hygiene, not policy.

### Changed

- **Stop hook no longer blocks aspect drift when no compliance archetype is rostered.** Check 6 (aspect coverage advisory) and Check 10 (aspect drift block) emissions are guarded by `HAS_COMPLIANCE_CLAIMANT`. Drift is still computed and flows to `compliance-history.jsonl` for data continuity. v5.37.12 fail-closed audit fix (`paradigm-common.sh:533-547`) preserved — guard wraps emission, not invocation.
- **`CLAUDE.md`** updated to reflect agent-owned enforcement: aspect drift removed from Stop-hook block list; new paragraph clarifying that Rune (compliance archetype) owns symbol/aspect enforcement when rostered.

### Added

- **`paradigm doctor`** — new `Aspect coverage` line item in the coverage/compliance cluster (slotted between Portal compliance and `.paradigm/flows.yaml`). Renders `components:aspects` ratio with claimant indicator: `(no claimant active)` when compliance is benched, `(claimant: rune)` when rostered. New `'info'` status enum value with gray `⠂` icon for the no-claimant case (per TD-2026-04-25-417 — surface state without implying action required).
- **`paradigm shift` — Step 2c-nominate-compliance prompt** for cohort-C upgraders (existing project defines `~aspects` but no compliance archetype on roster). On Y: appends `compliance` to `roster.active` and writes `.paradigm/authority.yaml` archetype-defaults. On N: writes `.paradigm/.compliance-nomination-skipped` marker so the prompt never re-fires without `--force`. Non-TTY and `--no-prompt` skip silently and write the marker — never auto-Y in CI.
- **`.paradigm/authority.yaml` schema** (writers only, no readers in v6.0.4). New module `packages/paradigm/src/core/authority.ts` exposes `writeArchetypeDefaults()` — writes `aspect-coverage` / `aspect-drift` / `anchor-staleness` claims for the compliance archetype at severity `advise` (per TD-2026-04-26-284 default). Schema locked at `v0-experimental` so v6.1's `paradigm_authority_claim` MCP tool ships without migration. Idempotent: never overwrites an existing file. Three triggers write at v6.0.4: shift Step 2c-nominate-compliance (on Y), shift default-adoption (when fresh project's roster includes `compliance`), and existing-project upgrade where roster already includes `compliance` but `authority.yaml` does not yet exist.
- **One-time migration notice** for cohort C — `packages/paradigm/src/core/migration-notices.ts` exposes `checkAndEmitMigrationNotices()`, wired via `program.hook('preAction', ...)` in `src/index.ts` so `--version` / `--help` short-circuit before emission. Writes `.paradigm/.v6-0-4-migration-acknowledged` marker after first emission so the message never repeats. Failures are silent — never blocks CLI startup.

### Migration

Cohort-C upgraders (projects with `~aspects` defined but no compliance archetype on the roster) see a one-time notice on first paradigm CLI invocation and silently lose Stop-hook aspect-drift blocking. Run `paradigm shift` to nominate Rune (compliance) and restore aspect enforcement, or ignore the notice to opt out for this project.

---

## [6.0.3] — 2026-04-25

Partners primitive — Full B (a) contracts-only. Agents can declare reciprocal pairings (e.g., scholar↔sheila); marketplace SKU shapes are typed for forward-compat with nevr.land but have no live consumer at v6.0.3. Design pass orchestrated with architect / Jinx (advocate) / Helix (DX) / Loid (intelligence officer) per always-use-team protocol; user picked Full B over team-recommended B-lite synthesis after weighing the migration-risk trade-off.

### Added

- **`partners: PartnerRef[]`** field on `AgentDefinition` (`packages/paradigm/src/commands/team/types.ts`) and `AgentProfile` (`packages/paradigm-mcp/src/types/agents.ts`). Object-array shape (not `string[]`) per Loid — `{ id, relation?, share_notebooks?: 'off'|'read'|'read-write' }` — durable for v6.1+ pair-learning knob without forcing a string→object migration. **Excluded from `AgentProfile.integrityHash`** (existing `computeIntegrityHash` only stringifies `{id, role, permissions}` so existing `.agent` files are not invalidated).
- **`packages/paradigm/src/commands/agent/registry-types.ts`** — new file with three typed marketplace primitives: `PartnerBundle` (groups partnered agents into single SKU), `ReciprocalInstallMeta` (typed install-prompt metadata), `PartnerCoverage` (registry-index indicator marking paired agents). Contracts only — no live wiring at v6.0.3.
- **`packages/paradigm/src/commands/agent/partners.ts`** — new pure-helpers module: `validateReciprocity()`, `findMissingPartners()`, `pairLabel()` (alphabetically canonical), `pairNotebookPath()` (returns `_pairs/{a-b}/`), `getPartnerStatus()` returning `'reciprocal' | 'pending' | 'not-installed'`. Pair notebook namespace is reserved for v6.1+ pair-learning; nothing writes there at v6.0.3.
- **`loadAgentsManifestWithReciprocity()`** in `packages/paradigm/src/commands/team/loader.ts` — wraps `loadAgentsManifest` and runs `O(n)` Map-based reciprocity detection over the full roster. Returns `{ manifest, pending: [{ id, pendingPartners[] }] }`. Single-agent flows (`loadAgentsManifest`, `getAgent`) intentionally do NOT run the check — avoids false-positive storms when partial roster is loaded.
- **`Nomination.partner_id?: string`** annotation in `packages/paradigm-mcp/src/types/ambient.ts` — written-but-unused at v6.0.3. Loid uses it in v6.1+ for cross-pair analytics; reserving the field now means nomination event consumers don't break when emission begins.
- **CLI rendering** in `packages/paradigm/src/commands/agent/index.ts`:
  - `paradigm agent get <id>` — Partners block (only when `partners.length > 0`) with three variants per partner: `✓ reciprocal` (green), `⚠ pending (X does not list Y)` (yellow), `(not installed) — paradigm agent install <id>` (yellow + dim command). Loads all profiles to compute reciprocity status.
  - `paradigm agent list` — `Partners: a, b*` line per agent (only when partners non-empty); yellow `*` suffix for partners not installed locally; single dim footer `* not installed — run: paradigm agent install <id>` after the loop only if any agent had a `*`.
- **`paradigm agent search`** registry rendering surfaces `PartnerCoverage` from registry response when present (`paired: ↔ name1, name2` line; green ↔ for fully reciprocal, yellow for partial). Type-cast on registry response — no `@a-company/registry-client` dependency bump.
- **`saveAgentsManifest` partners-hygiene** — strips empty/undefined `partners` arrays before YAML emit. Never writes `partners: null` (would corrupt older clients).
- **20 unit tests** added across `partners.test.ts` (13 — reciprocity, missing partners, pair label canonicalization, pair notebook path, partner status) and `loader.test.ts` (7 — reciprocity wrapper, partners YAML round-trip, hygiene).
- **`docs/guides/agents.md` §11 — Partners** — field shape, reciprocal vs pending semantics, pair notebook namespace, marketplace primitives note.

### Activated / new agents

- **Scholar (tier-1, core)** — research-and-curation specialist, paired with Sheila (educator) via reciprocal `partners` field with `relation: 'research-pair'` and `share_notebooks: 'read-write'`. Owns research briefs + curated University content + docs/guides accuracy + citations; never writes code. First test of the partners primitive in production. Registered in `AGENT_TIERS`, `ROLE_PROMPTS`, `paradigm_agent_prompt` enum, `roster.yaml`, `agents.yaml`, `adoptions.yaml`, and `~/.paradigm/agents/scholar.agent`.
- **Swift (tier-2, ecosystem)** — Swift/SwiftUI/Apple-platform specialist with global cross-project notebook compounding. Auto-rosters on `*.swift` / `Package.swift` / `*.xcodeproj` detection. No partners (ecosystem agents stay decoupled from project-local agents per Loid's design input). Initial transferable patterns: `mainactor-on-protocols` (from Conductor v6 work) + `read-platform-version-first`. Same registration sites as Scholar.
- **Loid (forge)** activated on the project roster — paired with Captain (Cid) as the intelligence officer in core team. Was benched; brought forward for the partners-design orchestration since the partners primitive shapes the v6.1+ learning loop she owns.
- **Nora (ftux)** activated — was registered in agents.yaml/adoptions/roster but missing global `~/.paradigm/agents/ftux.agent` profile (registration was incomplete at v5.37.4 publish). Created the profile from the existing agents.yaml entry; activate now succeeds. Filed under "investigate Nora missing-from-roster" task during this session.
- **Sheila (educator)** updated globally with reciprocal `partners: [{id: 'scholar', relation: 'research-pair', share_notebooks: 'read-write'}]`. Version bumped 1.0.0 → 1.1.0.

### Notes

- **Marketplace primitives are contracts only.** `PartnerBundle`/`ReciprocalInstallMeta`/`PartnerCoverage` exist as typed shapes; no install behavior, no bundle resolution, no registry-side enforcement. nevr.land MVP will plug in as the live consumer; the local code surface is graceful-default when registry response lacks the field. User-acknowledged trade-off: chose "completeness" framing over team-recommended "B-lite + Loid enrichment" cut. Migration risk noted and accepted.
- **Failure Ledger primitive PUNTED to v6.1.** Was on the v6.0.3 candidate list as Sage's expansion idea #1; user opted to ship lore-rejection telemetry first and design the ledger from real data.
- **Nora/ftux activation deferred.** `paradigm_agent_activate ftux` returned "not found" despite memory note indicating publish at v5.37.4. Surface flagged; not blocking v6.0.3.
- **Conductor full 16-bug triage planning** still pending — separate session.
- **Partners-graph `paradigm doctor` integration** noted as v6.0.4 follow-up — not in this scope.

### Verification

- paradigm-mcp build clean; paradigm CLI build clean.
- Test suite: paradigm CLI 277 passed (was 257 + 20 new); paradigm-mcp 221 passed (unchanged).

---

## [6.0.2] — 2026-04-18

Launch-readiness patch. Three streams of work landed in one coherent ship: pre-existing test failures triaged + fixed, missing user-facing guides authored, and two same-class schema-drift bugs the test work surfaced (which then chained into a third — the cross-cutting `specs/scan.md` → `specs/probe.md` rename that had been left half-done). Per user direction "no rush, just proper fixes" — each fix is at the source, not patched at call sites; regression tests added for every config-shape change so future drift fails CI.

### Fixed

- **17 pre-existing test failures resolved.** Test-scaffold drift only — zero production code touched in the test-fix pass. paradigm-mcp `tool-registry.test.ts` (10 failures) had a module-level cache that leaked across tests; added `invalidateFeatureCache()` to `beforeEach`. paradigm-mcp `notebook-loader.test.ts` (2 ID-format expectations) — production removed random suffixes from notebook IDs deliberately for nevr.land merge-by-id; tests updated to match. paradigm CLI `hooks/index.test.ts` (3 failures + 2 Check-7) — tests were reading the developer's real `~/.claude/settings.json` and seeing the paradigm plugin enabled, which made `installClaudeCodeHooks` early-return; fixed via per-test `process.env.HOME` to a temp dir. paradigm CLI `Check 7 — Lore enforcement` — assertions updated to read `paradigm-common.sh` (where the lore check lives after the hook script split). paradigm CLI `__tests__/integration-build.test.ts` `tsc --noEmit` — now intentionally skipped (paradigm CLI imports paradigm-mcp source files via relative paths in many places; tsup/esbuild bundles fine, vitest runs fine, but `tsc --noEmit` rightly rejects this; documented for v6.1 architectural cleanup).
- **`getDefaultParadigmConfig()` produced configs that failed their own schema.** Two same-class bugs at the source:
  - `project` field was missing from default factory output — the `projectName` argument was passed in but never assigned. Fresh `paradigm init` produced a config that failed `ParadigmConfigSchema` validation.
  - `scan: { enabled, autoInclude }` block was emitted by the factory but `KNOWN_TOP_LEVEL_KEYS` lists `probe` (the canonical post-rename key) — every fresh init triggered "Unrecognized config key: scan" warning. The factory was the lone stale emitter.
  - Both fixes at `packages/paradigm/src/core/paradigm-config.ts`. Added 2 regression tests in `paradigm-config.test.ts` that round-trip the factory output through `validateConfig()` and assert zero errors AND zero warnings — future drift between factory and schema fails CI immediately.
- **Windsurf adapter probe-protocol section was silently dead.** `core/ide-adapters/base.ts:137` `generateScanProtocol()` was reading `config.scan?.enabled` — but the canonical config key is `probe`. The whole rendered "Paradigm Scan" section never appeared in `.windsurfrules` for any post-rename project. Renamed function `generateScanProtocol` → `generateProbeProtocol` (single caller in monorepo: `windsurf.ts`), switched read to `config.probe?.enabled`, updated the rendered section to canonical "Paradigm Probe / `paradigm probe` / `probe-index.json` / `specs/probe.md`" naming so users aren't told to invoke a nonexistent command. Added 4 new tests in `base.test.ts` including a legacy-revert guard.
- **`metrics` config field triggered "Unrecognized config key" warning** on every fresh project. The field was added for v6.0 D7 (local-snapshots opt-in seed), wired into the TypeScript interface, emitted into the template — but never added to `KNOWN_TOP_LEVEL_KEYS` in `config-schema.ts`. Added a proper `metricsSchema` (zod enum guard on `remote_consent`, boolean `local_snapshots_enabled`) and added `'metrics'` to `KNOWN_TOP_LEVEL_KEYS`. Added 2 happy-path + invalid-enum tests in `paradigm-config.test.ts`.
- **`specs/scan.md` → `specs/probe.md` cross-cutting rename completed across 9 sites.** The doc file was supposed to be renamed (CHANGELOG line 4200 documents the intent; `commands/upgrade.ts:711-715` migrates the legacy name; `paradigm-config.ts` Bug 2 above already used `probe`) but several call sites still expected the legacy name. Visible symptom: `paradigm doctor` on fresh projects reported `○ .paradigm/specs/scan.md  Spec file not found`. Fixed:
  - `templates/paradigm/specs/scan.md` → `probe.md` (git rename preserved history)
  - `commands/init.ts` `MCP_SERVED_CONTENT` skip list — was listing `specs/scan.md`, meaning the file was deliberately NOT copied during init (it was meant to be served via MCP). Removed `specs/probe.md` from the skip list so init now copies it. This was the actual root cause of the missing-spec warning.
  - 8 caller sites updated: `commands/{upgrade,summary,doctor/index}.ts`, `core/ide-adapters/{index,copilot,types,base}.ts`, `test-utils.ts`. `SpecFiles.scan?` field renamed to `probe?` cleanly (no readers needed back-compat, all consumers in the same package updated in the same commit).
  - One additional caller found beyond the previous builder's grep: `core/ide-adapters/base.ts:660` `generateFooter()` was listing "specs/scan.md - Scan protocol" in every synced IDE-rules footer. Without this fix, every `paradigm sync`-generated `CLAUDE.md` / cursor rule would silently tell agents to read a nonexistent file.
  - Added doctor regression test asserting `probe.md` is present on a fresh project and zero spec-file warnings appear.
- **`docs/guides/university.md:3` outdated header.** Was "v5.39.0 — first release of the multi-tenant content-pack framework"; now reflects v6.0.1 content refresh + v6.x patch path.

### Added

- **Three user-facing guides** (architect's launch-readiness Tier 3 finding):
  - `docs/guides/agents.md` (~336 lines) — roster vs. activation model, full CLI surface, MCP tools, advisory adoption contracts, learning loop (lore→journal→notebook), `.agent` file format, common workflows
  - `docs/guides/decisions.md` (~278 lines) — the canonical post-v6 decisions reference: `TeamDecision` shape, the `.paradigm/decisions/TD-*.yaml` store, the D3 companion-lore pattern, `paradigm_decision_record` examples, `paradigm migrate decisions` walkthrough, why type='decision' was removed from lore (asymmetric: hard on lore, soft on wisdom), forensic recovery via the `v6-migrated:from-decision` tag, supersession semantics
  - `docs/guides/v6-migration.md` (~339 lines) — TL;DR of all 6 v6.0 breaking changes, per-change before/after with replacement code, skip-upgrade safety contract (v5.37.11 → v6.0 still fail-closes), per-step upgrade checklist with code-search items
- **README + CLAUDE.md** updated with links to the 3 new guides. CLAUDE.md gained a new "User-facing guides" subtable under On-Demand Guidance covering all 8 `docs/guides/` files.

### Verification

- All baselines green: paradigm-mcp 221 passed (was 211 + 10 fixed), paradigm CLI 257 passed + 1 intentionally skipped (was 242 passed + 7 fixed + 6 new regression tests + 1 new doctor test; the skipped test is the cross-package `tsc --noEmit` debt documented above), university 11 passed / 20 skipped / 0 failed (graceful-skip mode unchanged)
- Build clean across `paradigm`, `paradigm-mcp`, `university`
- Manual smoke on a fresh `/tmp` project: `paradigm shift --quick && paradigm doctor` shows `✓ .paradigm/specs/probe.md  Present` with zero "Unrecognized config key" warnings AND zero "Spec file not found" warnings
- `install.sh` URL verified live (HTTP 307 → 200, content correct)

### Notes — production debt surfaced (not in this ship)

Three real production bugs surfaced during the test-fix work and **deliberately not patched here** to keep the v6.0.2 scope coherent:

- **Cross-package relative imports break `tsc --noEmit`.** paradigm CLI imports paradigm-mcp source files via relative paths in many places (`symphony`, `habits/evaluator`, `platform-server` routes, `ambient.ts`, etc.). tsup/esbuild bundle fine; vitest runs fine; `tsc --noEmit` rightly rejects as outside `rootDir`. Right fix is project references / composite builds OR publish-as-workspace-package OR shared-utility extraction. Architectural debt; v6.1 work.
- **Runtime `scan-index.json` filename still legacy across ~12 reader sites.** `commands/upgrade.ts:711-715` already expects to migrate `scan-index.json → probe-index.json`, meaning the rename was planned but never executed. Visible symptom: `paradigm doctor --quick` reports `○ .paradigm/scan-index.json Not generated`. Coherent same-class follow-up to v6.0.2's specs rename; ships as v6.0.3 or v6.1.
- **A test that was previously failing on `assessment.ts:71,113` enum lists ('decision') was already addressed in v6.0.0 Bundle A patch** (back-door closed); confirming as resolved here, not a new bug.

### Process recommendation

The fact that v6.0.2 surfaced 3 same-class drift bugs (factory→schema, adapter→config, type-rename half-done) suggests a CI drift detector for v6.x: when `KNOWN_TOP_LEVEL_KEYS` or `LoreType` enum changes, fail the build if removed values appear in `getDefaultParadigmConfig()` factory output, in templates, or in University content. Would prevent the next compounding drift cycle. Tracking as v6.x candidate.

Versions: `@a-company/paradigm` 6.0.1 → 6.0.2 (always-bumps rule); `plugins/paradigm` 6.0.1 → 6.0.2; `@a-company/paradigm-mcp` stays at 6.0.0 (no MCP/CLI tool surface changes — only test/utility fixes); `@a-company/university` stays at 6.0.1 (no content changes).

Symbols: #paradigm-config, #ide-adapters, #config-schema, #specs-probe, #docs-guides, #test-fixes, #docs-readiness

## [6.0.1] — 2026-04-23

University content patch. v6.0.0 shipped the multi-tenant framework + breaking removals (LoreType.decision, loadPortalConfigLegacy, legacy PLSAT JSON paths) but the course content itself wasn't refreshed in the same cut — Sheila (educator) audit + Jinx (advocate) pre-mortem caught material staleness across PARA 001/301/501/601/401 + the PLSAT v2/v3 certification exams. **PLSAT exam integrity was broken** (multiple slots marked `decision` as a valid lore type, which v6.0.0 hard-removed). Fixing in place is safe — no v3 PLSAT diplomas exist anywhere, so the silent answer-key swap doesn't invalidate any past credentials.

### Fixed (content)

- **PLSAT v3 + v2 exam integrity restored.**
  - `Q-plsat-v3.yaml` slot-051 fully replaced (not key-swap — would have been pedagogically degenerate per Jinx's pre-mortem; replacement tests the actual decision-recording workflow).
  - `Q-plsat-v3.yaml` slot-033 + slot-044 + slot-115 distractor refresh; slot-027 + slot-033 explanation prose updated to reflect v6 hard-removal of `wisdom_record(type:decision)`.
  - `Q-plsat-v2.yaml` mirror fixes at lines 541, 611, 776 (line 870 was a false positive in the original audit — "unresolved decisions" there is colloquial English, not the lore type).
- **N-para-501-lore-system structurally rewritten.** Was teaching "six lore types" with `decision` as one of them; v6 has 7 types (`agent-session, human-note, review, incident, milestone, retro, insight`). Also fixed: pre-v6 entry ID format (line 34), nested-object `author` shape (lines 38-50; v6 uses string author + separate `agent: { provider, model }`).
- **N-para-301-wisdom-system structurally rewritten.** Was structured around "three wisdom types" with decision as ~40% of body content; v6 wisdom has two types and decisions live in `.paradigm/decisions/`. New "Where Decisions Went" section with full `paradigm_decision_record` example + companion-lore pattern explanation.
- **N-para-001-meet-the-team team rewrite.** Was listing "8 Core Agents" with stale names (Sage, Jinx, Sentinel, Vigil, Doc, Rune as personal names) — current canonical roles are 6+1 (architect, builder, reviewer, security, tester, documentor + ftux/Nora). Cleaned to canonical role names; ftux/Nora introduction added.
- **N-para-401-mcp-tools-overview lore tools section expanded.** Was listing ~15 tool modules (significant understatement) and missing 6+ lore-adjacent tools. Now includes `paradigm_decision_record`, `paradigm_decision_search`, `paradigm_journal_*`, `paradigm_work_log_*`, `paradigm_lore_assess`, `paradigm_lore_calibration`. New "Knowledge Streams Tools" subsection.
- **N-para-601-knowledge-streams Auto-Classification section rewritten.** Reframed `LORE_TYPE_TO_STREAM` reference (which DOES exist at `knowledge-streams.ts:205` with a residual `'decision': ['decision']` mapping for backward compat with v1/v2 migrated entries) to explain the v6 stream/type distinction and the companion-lore pattern.
- **8 sibling quizzes corrected** for stale agent-name and lore-type references — `Q-para-001-meet-the-team`, `Q-para-001-shift-setup`, `Q-para-301-history-system`, `Q-para-301-ripple-analysis`, `Q-para-401-agent-roles`, `Q-para-401-mastery-review`, `Q-para-401-quick-check`, `Q-para-501-lore-system`.
- **`reference.json`** — `paradigm_lore_record` description in `tools.lore-tools[2].usage` was still listing `'decision'` as a valid type; updated to v6 reality. Lore-search example also updated.
- **`N-para-301-operations-review`, `N-para-401-agent-roles`, `N-para-401-mastery-review`, `N-para-401-quick-check`** — surgical edits to remove residual stale agent-name (Sentinel/Vigil/Rune) and `decision`-type references.

### Added (content)

- **New note `N-para-301-decisions.md`** — canonical "what changed and why" lesson explaining the D3 synthesis (lore hard-remove + companion-lore pattern + asymmetric wisdom soft-deprecation). Full `paradigm_decision_record` example. Migration discoverability via the `v6-migrated:from-decision` tag covered.
- **New paired quiz `Q-para-301-decisions.yaml`** — 6 questions on the v6 decision-store consolidation. Wired into `LP-para-301` learning path.

### Notes

- **No PLSAT version bump.** User confirmed no v3 PLSAT diplomas exist anywhere — silent answer-key swap is safe; no retroactive credential invalidation. If PLSAT diplomas existed, this would have been v3.1 with v3 frozen as archived (per Jinx pre-mortem). Recorded as a pattern for future content patches.
- **Two Jinx pre-mortem claims verified WRONG by builder during fix:** `LORE_TYPE_TO_STREAM` does exist (in knowledge-streams.ts); slot-053's "0.6 similarity threshold" is fact-correct (matches `sentinel/src/grouper.ts:15`). Both kept as-is. Honesty in the content fix process — pre-mortems are pressure tests, not gospels.
- **Builder caught additional stale agent-name references** in `Q-para-401-quick-check`, `Q-para-401-agent-roles`, `Q-para-001-shift-setup`, `Q-para-001-meet-the-team`, `N-para-401-quick-check`, `reference.json` beyond what either Sheila's audit or Jinx's pre-mortem listed. Sibling sweep widened to 25 files.
- **PARA 801 (multi-tenant University framework course)** deferred to v6.1 per Sheila's tier C — not stale-fact-removal, requires new curriculum work.
- **Process learning: release-time content review should become a habit.** Several v5.x→v6.0 stale facts compounded silently because no release gate prompted "did you update University?" Considering a CI drift detector for v6.x: when `LoreType` enum or `paradigm_*` tool signatures change, fail build if removed values appear in `packages/university/src/content/`.
- Audit trail: `docs/private/plans/v6.0-university-content-audit.md`, `docs/private/plans/v6.0-content-fix-plan.md`, `docs/private/plans/v6.0-content-fix-premortem.md`.

### Baselines preserved
University tests: 11 passed / 20 skipped / 0 failed (graceful-skip mode unchanged). `paradigm university validate`: all checks pass. Grep audit: `type: 'decision'` only appears in explanatory prose contexts (the new decision-store note + distractor explanations). Zero teaching content presents `type:'decision'` as a valid path.

Versions: `@a-company/paradigm` → 6.0.1 (always-bumps rule), `@a-company/university` → 6.0.1 (content changes), `plugins/paradigm` → 6.0.1. `@a-company/paradigm-mcp` stays at 6.0.0 (no MCP/CLI tool changes).

Symbols: #university-content, #plsat-exam, #lore-system, #wisdom-system, #meet-the-team, #mcp-tools-overview, #decision-store-note, #knowledge-streams

## [6.0.0] — 2026-04-22

**The breaking final.** v5.39.0 shipped the multi-tenant University framework as the additive bridge; v6.0 ships the legacy removals it deferred. Single-day major-version cut following the bridge release earlier today. All v5.39.0 deferred breaking items now landed.

Team triage: architect (final builder spec at `docs/private/plans/v6.0-final-builder-spec.md`), Jinx (pre-mortem at `docs/private/plans/v6.0-final-premortem.md` with 2 must-fix mitigations), security (audit at `reviews/2026-04-22-v6.0-security-audit.md` clearing the `loadPortalConfigLegacy` clean delete; verifying v5.37.11 → v6.0 skip-upgrade still fail-closes correctly). Builder ran four bundles (A/B/C/D) with reviewer pass on Bundle A given lore-criticality.

### BREAKING

- **`LoreType.decision` removed across 4 sites.** `paradigm_lore_record({type:'decision'})` and `paradigm_assessment_record({type:'decision'})` now return a structured rejection envelope: `code: 'lore_type_decision_removed'`, `successor_tool: 'paradigm_decision_record'`, `removed_in: '6.0.0'`, with the migration target named both as a structured field and in the human-readable message body. Storage-layer guard at `recordLore()` rejects from the CLI side too — single point of enforcement defends against runtime-cast back-doors. Per D3 locked: lore is the three-way fracture offender that needed hard removal; wisdom `type='decision'` stays as a soft-deprecation route for one more release per the asymmetric justification.
- **`loadPortalConfigLegacy` deleted.** The one-minor back-compat shim from v5.37.12 is gone. Callers must use `loadPortalConfig` and switch on `status` (`'missing' | 'unparseable' | 'ok'`). Security audit verified: symbol was never on the public npm surface (`packages/paradigm` has no `exports` map), so external silent breakage is impossible — at worst, a runtime dynamic-import caller would hit a loud `ERR_MODULE_NOT_FOUND`.
- **Legacy PLSAT/courses JSON content removed** from `@a-company/university`. `packages/university/src/content/courses/*.json` (8 files), `packages/university/src/content/plsat/*.json` (2 files), and the now-empty `courses/`/`plsat/` directories all gone. Server routes (`courses.ts`, `plsat.ts`) read exclusively from the v6 pack layout (`content/notes/`, `content/quizzes/`, `content/paths/`). PLSAT regression harness (31 tests) was load-bearing for this deletion; ran green at v5.39.0 ship.
- **`@a-company/paradigm-logger@3.5.2`** stays at 3.5.2 — independent cadence; no logger changes in v6.0. CLI / MCP / university / plugin all bump to **6.0.0**.

### Added

- **Shared `lore-rejection.ts` utility** at `packages/paradigm-mcp/src/utils/`. Holds `RejectionEnvelope`, `rejectionErr`, and the `DECISION_REMOVED_ENVELOPE` constant — single source of truth so the lore + assessment rejection surfaces can never drift on the literal code/message/successor_tool/doc/removed_in fields.
- **Forensic discovery tag for migrated lore.** v1→v2 migration shims at `lore-loader.ts` + `storage.ts` remap any pre-v6 entries with `type='decision'` → `type='insight'` on read AND tag them with `v6-migrated:from-decision`. Users with legacy decisions can find them later via `paradigm_lore_search` filtered on that tag (Jinx mitigation flagged in the v6.0 pre-mortem).
- **Orphan `.purpose` cleanup in `migrate-plsat --delete-sources`.** `deleteSources()` now also removes `.purpose` files in source directories so the empty-dir cleanup actually empties them — `rmdirSync` was previously silent-on-non-empty, leaving orphans (Jinx mitigation). Both `courses/.purpose` (20029 bytes) and `plsat/.purpose` (6098 bytes) cleaned at finalization.
- **Graceful-skip mode in PLSAT regression harness.** `packages/university/tests/plsat-migration.test.ts` now skips byte-equivalence assertions when source JSONs are absent (post-v6.0 state). Forward-compatible — downstream adopters running the harness on a clean v6 install get the structural assertions; the source-vs-pack equivalence checks gracefully no-op. Pre-deletion: 31/31 passed. Post-deletion: 11 passed / 20 skipped / 0 failed.
- **CLI parity rejection tests** (`packages/paradigm-mcp/tests/{lore,assessment}.test.ts`) — 6 new tests verifying both rejection paths return the structured envelope, name `paradigm_decision_record` literally, and write nothing to disk on rejection.

### Changed

- **UI parity for lore type narrowing.** Both `lore-ui` and `platform-ui` `FilterBar` `ENTRY_TYPES` arrays drop `'decision'` so dropdown surfaces match the type narrowing. No surprise dead options.
- **`.purpose` files updated** at `packages/paradigm-mcp/src/tools/`, `packages/paradigm/src/core/lore/`, and `packages/paradigm/src/commands/university/` to reflect v6.0 rejection and orphan-cleanup behavior.
- **Server route headers** in `courses.ts` + `plsat.ts` updated from "old JSON files retained on disk (bridge)" to "old JSON layout removed in v6.0."

### Migration paths (each breaking change)

| Removed | Migration |
|---|---|
| `paradigm_lore_record({type:'decision'})` | Use `paradigm_decision_record`. Companion lore insight entry with `references.decision_id` written automatically (preserves timeline). |
| `paradigm_assessment_record({type:'decision'})` | Same — assessment was a back-door to the same code path. |
| Legacy lore entries with `type:'decision'` | Auto-migrated on read to `type:'insight'` with `v6-migrated:from-decision` tag. Searchable for forensic recovery. |
| `loadPortalConfigLegacy(rootDir)` returning `null` | Replace with `loadPortalConfig(rootDir)` and switch on `result.status`. The `'unparseable'` branch is fail-closed (returns violations, not compliant). |
| Direct import of `@a-company/university/src/content/courses/*.json` | Use the pack-loader API (new in v5.39.0). Content layout is now `notes/`, `quizzes/`, `paths/`. |
| Direct import of `@a-company/university/src/content/plsat/*.json` | Use `quizzes/Q-plsat-v{2,3}.yaml`. Same content, YAML format with `exam: { kind: proctored }` + `timeLimit` + `totalSlots`. |
| Lore UI filtering on `type: 'decision'` | Filter on the `v6-migrated:from-decision` tag instead. Decisions themselves live in `.paradigm/decisions/TD-*.yaml`. |

### Notes

- **Wisdom `type='decision'` stays soft this release.** Per D3 locked + Jinx + architect agreement: symmetry-for-its-own-sake undoes the asymmetric justification (lore was the three-way-fracture offender; wisdom was the documented ADR path that earned a longer grace). Remove or hard-error in a later release once adopters have migrated.
- **Skip-upgrade safety verified.** A consumer pinning v5.37.11 and jumping to v6.0 still fail-closes correctly. The contract lives in the v6.0 binary they install, not their TypeScript: parse error → `loadPortalConfig` returns `{status:'unparseable'}` → compliance returns `violations` with `__portal_unparseable__` sentinel → stop hook blocks. They inherit v5.37.12's contract automatically.
- **Companion-lore pattern unchanged.** `paradigm_decision_record` continues to write a companion lore insight entry with `references.decision_id`. This is how the lore timeline stays complete after `type='decision'` is gone — load-bearing per user feedback that lore is paramount.
- Audit trail: `docs/private/plans/v6.0-final-builder-spec.md` (architect), `docs/private/plans/v6.0-final-premortem.md` (Jinx), `reviews/2026-04-22-v6.0-security-audit.md` (security), `reviews/2026-04-22-bundle-a-lore-removal-review.md` (reviewer Bundle A pass).

### Baseline test counts
- paradigm-mcp: 10 failed / 211 passed (baseline + Bundle A's +6 lore/assessment tests)
- paradigm CLI: 7 failed / 242 passed (baseline; -3 from Bundle B's deleted shim tests)
- university: 0 failed / 11 passed / 20 skipped (PLSAT harness in graceful-skip mode post-deletion)

Symbols: #lore, #lore-loader, #lore-storage, #lore-rejection-util, #paradigm-lore-record, #paradigm-assessment-record, #portal-compliance, #migrate-plsat, #university-content, #university-server-routes

## [5.39.0] — 2026-04-22

Multi-tenant University framework lands. This is the **additive bridge** release that sets up v6.0's breaking removal of the legacy content layout. Per the D5 locked decision (`docs/private/plans/v6.0-decisions-locked.md`), `@a-company/university` had 805 downloads/month on npm, so a one-release bridge is required: both old and new content layouts coexist here; v6.0 removes the old paths.

### Added

- **`pack.yaml` multi-tenant content-pack contract.** New manifest format at each pack's root. First-party pack (`@a-company/university`), per-project pack (`.paradigm/university/`), and discipline sub-packs (`.paradigm/university/<discipline>/`) all carry a `pack.yaml` with identity (id, name, version, schema_version), classification (tenant_kind: `first-party | project | external`), content declaration, optional branding/theme/categories, optional compliance fields, and cross-pack dependencies. Full schema in `docs/guides/university.md` §7.
- **Three-source pack discovery** — `packages/paradigm-mcp/src/utils/pack-loader.ts`. Scans (1) well-known first-party `node_modules/@a-company/university/`, (2) direct-deps with a `paradigm.universityPack` pointer in their package.json, (3) local `.paradigm/university/` + discipline sub-dirs. Precedence: later wins on id collision. Cached at `.paradigm/cache/packs.json` keyed by `node_modules` + local-university mtimes. v5 layouts without `pack.yaml` still work (implicit default project pack fabricated by the loader).
- **Cross-pack entry addressing** — canonical form `<pack-id>:<entry-id>`. Bare ids resolve to the active pack; ambiguous bare ids (same id in multiple active packs) throw with a candidate list. `paradigm_university_search` results now return ids in this form.
- **New MCP tool `paradigm_university_pack_list`** — lists discovered packs with manifest metadata. Input filter: optional `tenant_kind`. Output: pack id, name, version, tenant_kind, discipline, entry_count, path. ~200-token response budget.
- **Pack arg on all six existing `paradigm_university_*` tools** — search, get, create, update, onboard, validate now accept optional `pack?: string`. Defaults preserve current behavior. `create` also accepts optional `origin: 'authored' | 'promoted' | 'imported'`.
- **New CLI selectors `--pack`, `--project`, `--discipline`** on `paradigm university` subcommands (list, show, quiz, status, validate, serve, add). Selectors live on subcommands only — bare `paradigm university` still launches the Paradigm teaching app unchanged.
- **New `paradigm university init` subcommand** — scaffolds `.paradigm/university/pack.yaml` with a project-kind manifest (id derived from `.paradigm/config.yaml` project name). With `--discipline <name>`, scaffolds `.paradigm/university/<name>/pack.yaml` as a discipline sub-pack. Idempotent; does not overwrite existing manifests.
- **New hidden `paradigm university migrate-plsat` subcommand** — one-shot migration from the hand-rolled JSON content layout to the new pack-conformant layout. Idempotent (`--force` to overwrite). `--delete-sources` flag exists but is not used in v5.39.0 — old JSON stays on disk per the bridge contract; v6.0 invokes `--delete-sources` to finalize.
- **New `paradigm migrate decisions` subcommand** — converts `.paradigm/wisdom/decisions/*.yaml` and `lore.type='decision'` entries to the canonical `.paradigm/decisions/TD-*.yaml` streams store with `migrated_from` provenance. User-invoked, idempotent.
- **Privacy-preserving University metrics** — `packages/paradigm-mcp/src/utils/university-metrics.ts` + CLI-side mirror at `packages/paradigm/src/core/university/metrics.ts`. Captures snapshots to `.paradigm/university/.metrics/snapshot-YYYY-MM-DD.json` on lifecycle boundaries (`paradigm shift`, `paradigm doctor`). Snapshots contain ONLY counts, fixed classifiers, and a hashed project salt — no content bodies, no entry titles, no gate names, no file paths. 90-day local retention (`pruneOldSnapshots`). **Local-only at v5.39.0** — no remote send. `.paradigm/config.yaml` gains `metrics.remote_consent: pending` seed so v6.1 can add an opt-in prompt without a schema migration.
- **Compliance schema fields** (all optional) on University entries:
  - Policies: `policy_version` (semver), `policy_hash` (sha256), `compliance: { retention_years, revoke_on_change, severity: advisory | required | enforced }`
  - Diplomas: `status: active | expired | revoked`, `revoked_reason`, `policy_versions: Record<address, version>`, `content_hashes: Record<address, sha256>`, `pack_id`
  - Enforcement tooling (retention workers, revocation workers, policy-version drift invalidation) is **not** shipping at v5.39/v6.0 — schema ships now so v6.x tooling can add without another breaking change.
- **Sub-pack origin field** on entries: `origin: 'authored' | 'promoted' | 'imported'`. Defaults to `authored`. Stamps automatically on create; for imports, the migration script stamps `'imported'` with `source` provenance.
- **LoreEntry `references` field** — new optional `{ decision_id?, wisdom_id?, notebook_id?, protocol_id? }`. Lore keeps its role as the immutable narrative timeline; canonical structured storage lives in the referenced store. `paradigm_decision_record` now automatically writes a companion lore insight entry with `references.decision_id` populated (D3 synthesis — preserves lore-as-timeline without re-introducing the three-way fracture).
- **`TeamDecision.supersedes: string[]`** — new field, inverse of existing `superseded_by`. Enables bidirectional graph traversal without a separate index (D2 Loid addendum).
- **ADR-style fields on `TeamDecision`** — `context`, `consequences: { positive, negative, mitigations }`, `date`, `migrated_from` (absorbed from the legacy wisdom-decisions schema).
- **First tests in `packages/university/`** — `packages/university/tests/plsat-migration.test.ts` + `vitest.config.ts`. The PLSAT regression harness (31 tests) is load-bearing: it gates v6.0's `--delete-sources` by asserting byte-normalized equivalence between the old JSON layout and the new pack layout across all 8 courses + 2 PLSAT exam banks + server-route smoke.
- **48 new tests in `packages/paradigm-mcp/`** across `pack-loader`, `university-multi-tenant`, `decision-migration`, `university-metrics`. Includes SECURITY assertions that pack-loader errors and metrics snapshots never contain sentinel strings planted as entry titles / gate names / route paths.
- **`docs/guides/university.md`** — the guide the v5.38.1 cleanup cited but couldn't yet link to. 11 sections, 3 audience tracks (project owner adding compliance, first-party pack author, discipline sub-pack creator). Fixes the broken link on README line 332.
- **Rewrote the `paradigm://guidance/university` MCP resource** to match the new multi-tenant shape and link out to the full guide.

### Changed

- **`paradigm_university_search` result `id` format is now `<pack-id>:<entry-id>`.** Minor-breaking for consumers that parse ids: strip the pack prefix for display if needed. Spec-documented, CLI and MCP examples updated.
- **`@a-company/university` content layout** — the PLSAT migration ran once and produced the new pack-conformant layout at `packages/university/src/content/{notes,quizzes,paths}/` (82 notes + 82 course quizzes + 2 PLSAT exam quizzes + 8 learning paths) alongside `pack.yaml` at the package root. Server routes (`courses.ts`, `plsat.ts`) now read from the new layout — API response shape preserved. **Old `src/content/{courses,plsat}/*.json` files are retained** for the bridge release; v6.0 removes them.
- **`wisdom-loader`** emits a one-time-per-path deprecation warning via Paradigm logger when `.paradigm/wisdom/decisions/` contains entries. Content is still read; migration ships in v6.0.
- **`paradigm_wisdom_record({type:'decision'})`** at project scope now routes to `recordDecision` with a one-time-per-session deprecation warning. Global-scope wisdom decisions still write to the wisdom store (out of scope at v5.39.0).
- **`paradigm_lore_record({type:'decision'})`** emits a deprecation warning pointing at `paradigm_decision_record`. **Still writes the lore entry at v5.39.0** — hard error ships in v6.0 per D3 asymmetric (lore hard-removes; wisdom soft-deprecates one more release out of respect for doc-followers).
- **`paradigm shift`** gains two additional steps at the end: `captureSnapshot` (University metrics) + `seedMetricsConsent` (idempotent `metrics.remote_consent: pending` seed in `.paradigm/config.yaml`).
- **`paradigm doctor`** calls `captureSnapshot` after health checks.

### Fixed

- **`migrate-plsat` dropped answer banks for alternate-schema lessons** (regression caught by the new PLSAT harness). Two course lessons used `options: string[]` + `correct: number` instead of the canonical `choices: {A..E}` + letter-correct shape: `para-401/notebooks-permissions` (5 questions) and `para-501/review-compliance` (5 questions). Migration now handles both shapes via discriminated union with explicit type guards; migrated YAMLs regenerated.
- **`university-loader.normalizeFrontmatter` dropped v6 additive fields on read** (`origin`, `source`, `pack_id`, `discipline`). Fields stamped correctly on save but didn't round-trip through load. Now preserved via presence-gated pass-through.

### Notes

- **D5 bridge sequencing.** v5.39.0 is additive — both old and new content layouts coexist. v6.0 ships the breaking removals: `loadPortalConfigLegacy` deletion, `LoreType.decision` removal (hard error on `paradigm_lore_record({type:'decision'})`), and deletion of legacy `@a-company/university/src/content/{courses,plsat}/*.json`.
- **Claude Learning site is NOT a tenant** of Paradigm's University. Per memory `project_claude_learning_site.md`, the user plans a separate free site for Claude/Claude-Code learning materials, independent of Paradigm. Paradigm's University at v5.39.0/v6.0 has exactly two tenants: Paradigm University (first-party content pack) + per-project user content.
- **v6.3 sunset-review contract (docs-only commitment).** The per-project University primitive is a candidate for consolidation if ALL FOUR hold simultaneously at the review: median project-pack entries < 3; median `last_modified_days_ago` > 45; median `quiz_completions_last_30d` < 1; `adopters_with_project_pack / total_adopters < 0.2`. Thresholds locked via Loid's calibration (D8).
- **`@a-company/paradigm-mcp`** follows CLI versioning this release (5.38.1 → 5.39.0) because MCP tools changed (new pack arg on 6 tools + new `paradigm_university_pack_list`).
- **`@a-company/university`** bumps from 5.31.0 to 5.39.0 (University content shipped) — re-aligning this package's version with the main release after a period of independent cadence.
- Audit trail: `docs/private/plans/v6.0-decisions-locked.md`, `docs/private/plans/v6.0-university-builder-spec.md`, sub-phase WIP commits `d60b319f`, `efe2cb9f`, `94511e0d`, `6696e169`, `c985782c`.

### Baseline test counts
paradigm-mcp: 10 failed / 205 passed (+48 new tests since v5.38.1). paradigm CLI: 7 failed / 245 passed (unchanged). university: 0 failed / 31 passed (new test suite; PLSAT harness fully green after migration fix).

Symbols: #university, #pack-loader, #university-metrics, #decision-loader, #wisdom-loader, #lore-loader, #university-cli, #paradigm-decision-record, #plsat-migration, #decision-migration, ^*

## [5.38.1] — 2026-04-22

### Fixed

- **`@a-company/paradigm-logger` exports condition ordering** — `package.json` had `types` last in the exports map; esbuild (and any tool that respects conditional exports ordering) warned that `types` was unreachable because `import` and `require` came first. Reordered so `types` is first. Noticed during v5.38.0 publish warnings.
- **Stray tsup build artifacts in `packages/paradigm-mcp/src/utils/`** — four files (`tool-cache.{js,d.ts,js.map,d.ts.map}`) had been committed into the `src/` tree alongside the `.ts` sources. Deleted them; confirmed tsup config already outputs to `dist/` (stray artifacts were historical). Added a scoped root `.gitignore` pattern (`packages/**/src/**/*.{js,js.map,d.ts,d.ts.map,mjs,mjs.map}`) with explicit negation for the three intentional hand-authored `sql.js.d.ts` stubs in paradigm, sentinel, and paradigm-mcp so future tsup leakage is caught automatically.
- **Root `.next/` now gitignored.** `packages/site/.next/` was already scoped-ignored, but a root-level `.next/` appeared in `git status`. Added `/.next/` to the root `.gitignore`.
- **`@types/node` version aligned to `^22.10.0` across all packages.** Prior mix of `^20` and `^22` caused subtle type-resolution differences. LTS baseline.
- **5 broken internal doc links removed from README.** The `./docs/guides/{orchestration,sentinel,university,conductor,workspaces}.md` link trailers pointed at files that don't exist yet — stripped the trailers, kept the bullet prose. The University guide ships in v6.0 per the University spec; others ship alongside their respective v6.x bundles.

### Notes

- Logger gets its own patch bump (`3.5.1 → 3.5.2`) because it has an independent cadence from the main CLI. Paradigm CLI and plugin.json follow the standard bump to `5.38.1`.
- No feature changes. No test changes beyond baseline hygiene.
- Full audit trail: `reviews/2026-04-22-cleanup-audit-findings.md`, `reviews/2026-04-22-cleanup-audit-triage.md`, `docs/private/plans/cleanup-release-plan.md`.

Symbols: #logger, #paradigm-mcp, #paradigm-cli

## [5.38.0] — 2026-04-22

### Added

- **`writeAndConfirm()` — atomic-write + verify envelope for schema-mutating tools.** New `packages/paradigm-mcp/src/utils/write-and-confirm.ts`. Writes content atomically (`.tmp` sibling + `fs.renameSync`), reads back, runs a caller-supplied `verify()` callback, and returns an envelope `{ written, path, hashHint, bytes }`. `hashHint` is a truncated HMAC-SHA256 (12 hex chars) keyed with a per-install secret at `~/.paradigm-install-key` (0o600, 32 random bytes) — advisory, not cryptographic, but immune to pre-image attack on tiny YAML files (security concern flagged in the 2026-04-22 audit). `WriteVerificationError` messages are classifier-only — no file paths, gate names, or route paths leak to logs or telemetry. Applied to 5 mutation handlers: `portal_add_gate`, `portal_add_route`, `purpose_add_component`, `purpose_link`, `purpose_remove`. Response envelopes gain `hashHint` + `bytes` additively; existing consumers continue to work.
- **Round-trip consistency manifest.** New `packages/paradigm-mcp/src/utils/consistency-tracker.ts`. Every `paradigm_reindex` now tracks lossy transformations applied during indexing and emits both a `consistency` field on the response envelope and a durable `.paradigm/manifest.consistency.json` artifact. Shape: transformation **classes** (`prefix-stripped`, `array-coerced`, `default-applied`, `duplicate-key-detected`, `case-normalized`) + fixed **surface** classifiers (`portal.yaml`, `purpose.yaml`) + counts. Never gate names, route paths, or file contents — redaction verified by an integration test that feeds a portal.yaml with distinctive secret names and asserts those strings are absent from the serialized manifest.
- **`PARADIGM_STRICT=1` environment flag.** New `packages/paradigm-mcp/src/utils/strict-mode.ts`. When set: `safeLoad` throws on any non-`ok`/non-`missing` result (including `other` error classes previously non-fatal); `paradigm_reindex` aborts with a classifier-only error when lossy transformations land; duplicate YAML keys, Array→Object coercions, and prefix-stripping all become hard errors. Default **OFF** in v5.38.0 — intended as opt-in for projects wanting fail-fast CI semantics. Field observation in v5.38.x informs whether to flip default `ON` in v5.39.0 or v6.0.
- **Near-match suggestion engine in compliance errors.** New `packages/paradigm/src/core/near-match.ts`. When `compliance-check` reports gates used in code but undeclared in portal.yaml (the legitimate case, not the `__portal_unparseable__` sentinel), a Levenshtein-based suggestion appears: `Did you mean: ^authenticated? (declared in portal.yaml)`. Threshold: distance ≤ 2 OR distance/longer ≤ 0.3. Bidirectional — also suggests corrections when a declared gate never appears in code (possible typo on either side). Closes Jinx's "diagnosis failed" complaint from the 2026-04-22 pattern reflection. Output surfaces locally only (CLI stdout, JSON envelope); never flows to telemetry.
- **4 new regression suites + extended coverage.**
  - `packages/paradigm-mcp/tests/write-and-confirm.test.ts` — 8 tests (envelope shape, atomic write, verify callback failure, truncated-HMAC uniqueness, SECURITY assertion that thrown errors don't leak paths/content)
  - `packages/paradigm-mcp/tests/consistency-manifest.test.ts` — 8 tests (reindex with crafted secret gate names asserts manifest redaction)
  - `packages/paradigm/tests/near-match.test.ts` — 18 tests (threshold behavior, false-positive resistance, bidirectional suggestions)
  - Extended `packages/paradigm/tests/portal-compliance.test.ts` and `packages/paradigm-mcp/tests/portal-writer.test.ts` for Bug 1 lenient parsing + strict-mode behavior + envelope additions.

### Fixed

- **Bug 1 — Scanner treats `^` prefix as part of gate id.** Field-reported 2026-04-21 (Quakeee-web). `packages/portal/core/src/parser.ts` `normalizeGate` was taking the raw YAML key (`^authenticated`) as `Gate.id`, then `packages/premise/core/src/aggregator.ts:createGateSymbol` produced `symbol: '^^authenticated'` (double caret). Compliance check normalized the "used in code" set to bare ids and every declared gate was reported as undeclared, training developers to *delete gate references* instead of fixing the key form. **Parser now strips leading `^` at every gate-key site; aggregator adds defensive double-strip.** Back-compat: projects still on prefixed form work unchanged; canonical form is bare keys going forward.

### Changed

- **`classifyYamlError` single-source-of-truth.** Extracted to `@a-company/portal-core` at `packages/portal/core/src/classify-yaml-error.ts`. `paradigm-mcp`'s `yaml-validator.ts` and `paradigm` CLI's `portal-compliance.ts` both import from there — the duplicated copies introduced in v5.37.12 (deliberately, to avoid a build-dep direction change during a security patch) are now collapsed. Resolves Finding 4 of the v5.37.12 review. `packages/paradigm/package.json` gains explicit `@a-company/portal-core` dep.
- **Site docs + MCP guidance resource + landing-page example now teach bare gate-key form.** 8 markdown files updated (portal-and-gates, concepts, purpose-files, migration-prompt, add-gate, symbols × 3) plus 2 TS-string surfaces (MCP `paradigm://guidance/portal` resource teaching example; landing page step-2 code snippet). Key vs reference distinction documented with inline notes: gate **keys** are bare (`authenticated:`), gate **references** are prefixed (`^authenticated` in routes, flow steps, `requires:`/`blocks:` arrays, prose).

### Notes

- **Deferred to v5.38.x or v5.39.0** (per reviewer's 5 non-blocking findings): wiring the remaining purpose handlers (`add_aspect`, `add_signal`, `add_flow`, `add_gate`, `add_state`, `rename`, `init`) to `writeAndConfirm` — they currently use inline verification from v5.37.11 which is sound but not envelope-uniform; adding a portal-core test harness so Bug 1 gets covered in portal-core directly (currently tested via the CLI package); expanding `PARADIGM_STRICT` to additionally escalate `case-normalized` and `default-applied` transformations.
- **Three live in-repo `.purpose` files** still use `^`-prefixed gate keys (`packages/conductor/.purpose`, `packages/conductor/Sources/Conductor/Symphony/.purpose`, `packages/sentinel/.purpose`). These auto-heal on next `paradigm scan` because Bug 1 is fixed; no urgent action, but a one-shot cleanup pass would demonstrate canonical shape in the monorepo.

Symbols: #portal-core, #paradigm-mcp, #paradigm-cli, #write-and-confirm, #consistency-tracker, #strict-mode, #near-match, ^*

## [5.37.12] — 2026-04-22

### Security

- **Fail-closed portal compliance — closes multiple auth-bypass vectors.** Field report from a downstream project (2026-04-21) plus a dedicated security audit surfaced five scenarios where Paradigm's portal compliance pipeline could silently fail open, letting authorization config vanish without the stop hook blocking. Scenarios resolved in this release:
  - **Bash wrapper silently masked compliance failures.** `plugins/paradigm/scripts/paradigm-common.sh` wrapped the `paradigm compliance-check` subprocess in `2>/dev/null) || true` — any non-zero exit (including an uncaught `YAMLException` from downstream) silently emptied `COMPLIANCE_RESULT` and let the stop hook pass. Removed the `|| true` mask so non-zero exit propagates and the hook blocks with a clear "compliance-check failed to run" message.
  - **Duplicate YAML mapping keys silently accepted across all read sites.** js-yaml throws `YAMLException: duplicated mapping key`, but every portal-adjacent read site swallowed the throw with `try { yaml.load(...) } catch { return null }`. With `loadPortalConfig` returning `null` on failure, the compliance check treated the file as "no portal declared" and flagged every gate reference as undeclared, training developers to delete gate references rather than fix duplicates. Real-world impact: a project's second `GET /api/admin` entry with looser gates would silently override the stricter earlier declaration.
  - **`loadPortalConfig` now returns a discriminated union** — `{ status: 'missing' } | { status: 'unparseable', errorClass, detail } | { status: 'ok', data }`. The `unparseable` state produces a **violations** result (not "compliant"), so any parse error fail-closes. A one-minor deprecation shim `loadPortalConfigLegacy` preserves the old `null`-on-failure signature for downstream consumers.
  - **`Object.keys(Gate[])` silently produced numeric-index gate names.** `compliance-checker.ts` and `pm.ts` called `Object.keys()` on `ctx.gateConfig.gates`, which is a `Gate[]` Array (not a Record) per `portal/core/src/types.ts`. `Object.keys` on Arrays returns `['0', '1', '2']` — none of which match live gate identifiers, so compliance flagged every gate as undeclared. New `extractDeclaredGateNames` helper handles both `Gate[]` and raw-Record shapes, and **throws loudly** on unrecognized shapes rather than silently degrading. Type annotation at `compliance-checker.ts:52` updated to match runtime shape so TypeScript catches future regressions.
  - **Error-message redaction.** Every user-visible surface that now reports unparseable-portal errors (stop hook, `paradigm portal check`, structured violations, MCP error envelopes) emits only a short classifier (`"duplicate mapping key"`, `"YAML syntax error"`) — never raw file contents, line excerpts, gate names, or route paths. Gate names could previously reach telemetry and LLM context via `YAMLException.toString()` / `mark.buffer`. The `yaml-validator.ts` test suite includes an explicit security assertion that feeds a portal containing a sentinel gate name and asserts the error `detail` does not contain that string.

### Added

- **`safeLoad<T>()`** — `packages/paradigm-mcp/src/utils/yaml-validator.ts`. Discriminated-union YAML loader (`ok` | `missing` | `unparseable` with `errorClass: 'duplicate-key' | 'syntax' | 'other'`). Applied to portal-adjacent read sites: `portal-writer.ts` (read leg), `index-loader.ts`, and via a duplicated classifier in `portal-compliance.ts` (CLI-side, kept self-contained to avoid cross-package build deps — extraction to `portal-core` deferred to v5.38.0). Broader migration of the ~250 `yaml.load` call sites across 101 files is explicitly deferred; this release covers the security-critical portal paths.
- **Two new regression suites.**
  - `packages/paradigm-mcp/tests/yaml-validator.test.ts` — 11 tests covering each `LoadResult` variant, each `errorClass` branch, and the **security assertion** that `detail` strings never contain file contents.
  - `packages/paradigm/tests/portal-compliance.test.ts` — first test file in the `paradigm` CLI package; 14 tests covering scenarios A–E from the security audit, including a bash-level regression that reads `paradigm-common.sh` and greps for `|| true` near the compliance-check invocation so future edits re-introducing the mask fail CI.

### Changed

- **`paradigm portal check` output now splits "Portal Unparseable" from "Undeclared Gates".** The internal `__portal_unparseable__` sentinel used by the stop hook is filtered from both formatted and JSON output so consumers never see it as a gate name; when present, the JSON output surfaces a `portalError` field instead.

### Notes

- **Scope deliberately narrow per security's bundle order.** Shipping the lenient `^`-prefix parser fix (Bug 1 from the triage doc) before the fail-closed contract would leave fail-open paths live in the wild. Bug 1, the `writeAndConfirm` wrapper, round-trip consistency manifest, `PARADIGM_STRICT` flag, site-doc fixes, and near-match suggestion engine all ship in v5.38.0.
- `loadPortalConfigLegacy` is deprecated; removal in v5.39.0 or v6.0.
- Duplicated `classifyYamlError` across paradigm-mcp and paradigm CLI is intentional for this release (avoids a new build dep direction from CLI → MCP) — extraction to `portal-core` tracked for v5.38.0.

Symbols: #portal-compliance, #yaml-validator, #compliance-checker, ^*, #hooks

## [5.37.11] — 2026-04-20

### Fixed

- **`paradigm_portal_add_gate` + sibling mutation tools silently no-op'd on v2 scaffold** — Root cause in `packages/paradigm-mcp/src/utils/portal-writer.ts`: the guard `if (!data.gates) data.gates = {}` failed when `gates` parsed as `[]` (truthy Array). Subsequent `data.gates[id] = gate` set a named property on the Array, which `js-yaml.dump` silently dropped — rewriting the file byte-for-byte identical. The handler then built its success response from the input `id` without reading back, returning perfect-looking fake success. Compounded by `packages/paradigm/src/commands/shift-files.ts` emitting `gates: []` / `routes: []` as the v2 init scaffold, so every newly-shifted project was in the vulnerable state by default. Field-reported by an agent running 11 `portal_add_gate` calls that all returned success while `gates: []` stayed empty.
- **Fix applied (three parts):**
  - `portal-writer.ts` — `addGateToPortal` and `addRouteToPortal` now normalize Array-shaped `gates`/`routes` to `{}` before mutation, and read back the file after write to assert the mutation landed (throws descriptive error on silent no-op).
  - `purpose-portal.ts` — same Array→{} normalization + post-write read-back added defensively to `handleAddGate`, `handleAddSignal`, `handleAddState`, `handleAddAspect`, `handleAddFlow`. Returns `err()` envelope on verification failure instead of fake success.
  - `shift-files.ts` — v2 scaffold now emits `gates: {}` / `routes: {}` so newly-shifted projects never enter the vulnerable state. Existing projects self-heal on first mutation because the writer normalizes on read.
- **First `tests/` directory in `paradigm-mcp`** — `packages/paradigm-mcp/tests/portal-writer.test.ts` with 8 regression tests covering Array scaffold, Object scaffold, preservation of existing gates, symbol-prefix stripping, route variants, and verification failure (via `/dev/null` symlink on POSIX). `vitest.config.ts` include glob updated to cover `tests/**/*.test.ts`.

### Notes

- Scope deliberately narrow — this is a hotfix. The `writeAndConfirm` wrapper, response envelope extensions (`content_hash`, `bytes_written`), and broader test suite are tracked as follow-up work in `docs/private/plans/silent-no-op-prevention.md`.
- Residual silent-no-op risk in `handleAddComponent` / `handleLink` / `handleRemove` / `handleRename` tracked as follow-up — not in the blast radius of this specific bug but share the family pattern.

Symbols: #portal-writer, #purpose-portal, #shift-files, ^authenticated

## [5.37.10] — 2026-04-18

### Changed

- **README rewrite — `paradigm shift` as the single entry point** — Team audit (Nora FTUX + architect + reviewer) found the previous README buried `paradigm shift` at line 218, pushed a 6-command Quick Start chain, dead-ended readers at an undefined `.purpose` step, and threw ~20+ undefined jargon terms (`beacon`, `constellation`, `symbol graph`, `auth topology`, etc.) before the first runnable command. New structure: hero → npm install → `paradigm shift` (with realistic CLI output snippet) → what you just got (`.purpose` and `portal.yaml` skeletons) → why this works (efficiency study) → Concepts (symbols, hooks, agent team, below the fold) → Integrations → Ecosystem → commands reference. All 8 `shift` flag overloads in a single table. `.purpose` skeleton and filled example now appear in-line. Re-audit by Nora: all 4 critical original findings fixed, verdict "ship-it" after 3 copy polishes.

Symbols: #readme, #paradigm-shift

## [5.37.9] — 2026-04-18

### Fixed

- **`paradigm-navigate-remind.sh` execute bit — actually committed this time** — v5.37.8 claimed to fix the missing execute bit but only touched CHANGELOG and version strings; the file's mode in the git tree remained `100644`, so the plugin cache installed via Claude Code still produced `Permission denied` when the PreToolUse hook fired. Applied `git update-index --chmod=+x` so the executable bit is recorded in the tree itself. Verified via `git ls-files --stage` before commit.

Symbols: #hooks, #navigate

## [5.37.8] — 2026-04-10

### Fixed

- **`paradigm-navigate-remind.sh` missing execute bit** — Script was created in v5.37.7 without `chmod +x`, causing `Permission denied` when Claude Code tried to run it as a hook. Set execute bit on the source file in `plugins/paradigm/scripts/`.

Symbols: #hooks, #navigate

## [5.37.7] — 2026-04-09

### Added

- **PreToolUse navigation-remind hook** — New `paradigm-navigate-remind.sh` hook fires once per session before `Glob`/`Grep` tool calls. Reads scan-index stats and emits an advisory message: "Context available — use `paradigm_navigate` before searching." Non-blocking (exit 0). Fires only once per session via `.paradigm/.nav-reminded` marker. Writes `.paradigm/.nav-called` sentinel in `paradigm_navigate` so the hook stays silent after navigation is used. Installed by `paradigm hooks install --claude-code`; also included in the Claude Code plugin (`hooks.json`).
- **`init-report.md` first-run artifact** — `paradigm init` now writes `.paradigm/init-report.md` after completing. The report summarises what was created (files, MCP tools available, next steps, maintenance contract). Provides an immediately shareable, human-readable artifact from the first run instead of just YAML.
- **`inferred: true` on auto-suggested aspects** — `paradigm_aspect_suggest_scan` response now includes `inferred: true` on every suggestion entry. `paradigm_aspect_graph` BFS traversal edges now include `origin` and `inferred: boolean` fields. Agents and developers can now distinguish auto-inferred relationships from explicitly authored ones.

### Changed

- **Stop hooks surface troubleshooting doc** — `claude-code-stop.sh` and `cursor-stop.sh` now append `Help: See .paradigm/docs/troubleshooting.md | paradigm doctor` when blocking. Reduces first-run abandonment.
- **`paradigm init` terminal output includes maintenance contract** — `displaySummary()` appends a three-line maintenance contract note.
- **Quick-start guide adds Maintenance Cost section** — `docs/guides/quick-start.md` gains a `## Maintenance Cost` section with honest cost/benefit framing.

Symbols: #paradigm-mcp, #hooks, #init, #aspect-graph, #navigate

## [5.37.6] — 2026-04-06

### Added

- **`scope` + `publishable` on `NotebookEntry`** — New fields required by the nevr.land notebook publishing pipeline. `scope: 'generalizable' | 'project-specific' | 'platform-specific'` (default: `generalizable`) controls which audiences receive the entry when the agent is published. `publishable: boolean` (default: `true`) is the owner's binary kill switch. Both fields are optional with defaults — existing YAML files load without changes.
- **`NotebookScope` exported type** — Matches `@a-company/agent-format`; Paradigm is the local source until full cross-package import is wired.
- **`classifyNotebookScope()` auto-classifier** — Detects platform-specific (Paradigm/nevr.land internals: MCP tool names, `.paradigm/` paths, lore/aspect/gate terminology) and project-specific (absolute paths, Paradigm symbol IDs like `#x-y`) signals. Defaults to `generalizable`. Applied at `addNotebookEntry` time. Owner confirms/overrides via `nevr notebook audit`.
- **`paradigm_notebook_promote` shows auto-classified scope** — Output includes `publishScope`, `publishable`, and a note when scope is non-generalizable prompting `nevr notebook audit` review.
- **`paradigm_notebook_add` accepts `scope` + `publishable` args** — Explicit override of auto-classification.

### Fixed

- **`autoPromoteJournalEntries` provenance schema** — Was writing `source: 'journal-auto-promote'` with a non-existent `sourceId` field. Changed to `source: 'lore'` + `loreEntryId` per the `NotebookProvenance` type.
- **`prepareForPublish` updated** — Now uses `scope` + `publishable` instead of old `shareability` logic. `project-specific` entries never publish; `publishable: false` is an absolute kill switch; everything else passes through.

Symbols: #paradigm-mcp, #notebook-entry, $notebook-publish-flow

## [5.37.5] — 2026-04-06

### Fixed

- **Null crash in `paradigm_ambient_nominations`** — `scoreEventForAgent` in `event-stream.ts` crashed with `Cannot read properties of null (reading 'toLowerCase')` when an agent's `attention.concepts` array contained a null entry. Added null guard: `if (concept && ...)`. Also guarded `event.type` to avoid the string `"null"` appearing in keyword matching.
- **Ambient learning loop never closing** — Verdicts recorded via `paradigm_ambient_engage` were written only to `session-log.jsonl`, which is cleared at every session start. If postflight didn't run in the same session as the engagement, verdicts were silently lost and `runPostflightLearning` returned `journalsWritten: 0` every time. Fixed by introducing a durable `.paradigm/events/verdicts.jsonl` that is NOT cleared on session start. `paradigm_ambient_engage` now writes to both files. Postflight reads from the durable file and marks entries consumed after processing. The cold-start path can now close across multiple sessions.
- **Deterministic notebook IDs** — `addNotebookEntry` was generating IDs as `nb-{concept}-{randomTimestamp}`, making them non-stable across republishes. Changed to `nb-{agentId}-{conceptSlug}` — deterministic, human-readable, required for the nevr.land merge-by-id algorithm.

### Added

- **`paradigm ambient postflight` CLI command** — Thin wrapper around `runPostflightLearning`. Reports pending verdict count, journals written, and entries promoted to notebooks. Accepts `--dry-run` and `--project`.
- **Stop hook auto-runs postflight** — `paradigm-stop.sh` now fires `paradigm ambient postflight` in the background (non-blocking) when `.paradigm/events/verdicts.jsonl` exists. The learning loop now closes automatically at session end without manual intervention.

Symbols: #paradigm-mcp, #orchestration

## [5.37.4] — 2026-04-05

### Added

- **Nora (ftux) — First-Time User Experience agent** — New core tier-1 agent that simulates a first-time user actively trying to use any feature or documentation surface. Nora reads only user-facing content (README, --help, docs, changelogs, error strings) — never source code or internal specs; her confusion is the data. She walks step-by-step through tasks, classifies every friction point by type (`missing_coverage`, `assumed_context`, `undefined_term`, `broken_flow`, `buried_info`, `contradictory`) and severity (critical / high / medium / low), and stores structured reports at `.paradigm/ftux/reports/YYYY-MM-DD.md`. Position in orchestration: after Builder (when task touches user-visible surface), before Documentor. Registered in `AGENT_TIERS` as tier-1 (opus), added to `ROLE_PROMPTS` with full simulation integrity rules, added to `paradigm_agent_prompt` enum, `.paradigm/roster.yaml`, `.paradigm/agents.yaml`, `.paradigm/adoptions.yaml`. Reports directory bootstrapped at `.paradigm/ftux/`.

Symbols: #paradigm-mcp, #orchestration

## [5.37.3] — 2026-04-05

### Fixed

- **Conductor "Show Container" not working** — `switchToContainer()` never called `NSApp.setActivationPolicy(.regular)`, which only ran at launch. Container window was opening while the app remained in `.accessory` mode, so macOS treated it as a background app and wouldn't bring the window forward. Fixed by calling `setActivationPolicy(.regular)` + `NSApp.activate()` in `switchToContainer()`, and `setActivationPolicy(.accessory)` in `switchToSidebar()` for symmetry.
- **Conductor crash on "Show Sidebar"** — `ContainerView.onAppear` registered an `NSEvent.addLocalMonitorForEvents` monitor but never stored the token or removed it. When the container window closed, the monitor remained live and fired into the torn-down view, causing a crash. Fixed by storing the monitor token in `@State var keyEventMonitor` and removing it in `.onDisappear`.
- Conductor VERSION bumped to 0.5.1.

Symbols: #conductor-app, #container-view

## [5.37.2] — 2026-04-05

### Changed

- **`paradigm conductor` — smart auto-install flow** — Command now detects OS (macOS-only, exits clearly on Linux/Windows), checks if the binary is already installed, and auto-installs on first run without requiring an explicit `--install` flag. Install priority: (1) build from monorepo source if the a-paradigm repo is found anywhere up the directory tree, (2) download pre-compiled binary from GitHub releases for the detected arch (arm64 / x86_64). After install, launches automatically. Future calls detect the installed binary and launch instantly. `--install` now forces a reinstall. `--build` forces a source rebuild (requires monorepo + Swift toolchain, now with a clear Xcode install prompt on failure). Removed the cryptic "Cannot install — not in the Paradigm monorepo" dead-end; replaced with clear clone instructions and a releases link.

Symbols: #conductor-app, #paradigm-cli

## [5.37.1] — 2026-04-05

### Fixed

- **paradigm-mcp crash on startup** — `paradigm-mcp` was crashing with `Error: Dynamic require of "async_hooks" is not supported` on every launch, taking down the entire MCP server. Root cause: `@a-company/paradigm-logger` lacked an `exports` field in its `package.json`, so tsup (via esbuild) resolved the CJS build (`dist/index.js`) when bundling inline into the ESM output. The CJS build uses `require("async_hooks")` which hits esbuild's dynamic-require shim and crashes in ESM context. Added `exports` + `module` fields to `packages/logger/package.json` so esbuild now correctly picks `dist/index.mjs` (ESM) when bundling, which uses proper `import` statements.

Symbols: #paradigm-mcp, #paradigm-logger

## [5.37.0] — 2026-04-03

### Fixed

- **B2 — Drift thresholds now read from config** — `paradigm_aspect_drift` was using hardcoded `0.7` (suggest) and `0.85` (auto-heal) thresholds even though `.paradigm/config.yaml` supports `drift.suggest-threshold` and `drift.auto-heal-threshold`. `checkDrift` now accepts threshold parameters with those defaults; `handleAspectDrift` reads config.yaml and passes the configured values through. Configuring `drift` in config.yaml now actually takes effect.
- **B4 — Notebook appliedCount incremented on inject** — When orchestration execute mode injects notebook entries into agent prompts, `incrementApplied` was never called. Entries were injected but their `appliedCount` stayed at 0 permanently, breaking popularity-based sorting. Added `incrementApplied` call for each injected entry after `recordNotebookReference`.

### Not reproduced

- **B3 — purpose-tracker.ts v1 symbols** — No `purpose-tracker.ts` exists. `captain.ts` `buildPurposeStub` already uses v2 format (`components:` with `tags:`). No v1 symbol generation (`@feature`, `&integration`) found in any stub-generating code path. Bug does not exist in current codebase.
- **B5 — team/orchestrate.ts cross-package import** — `packages/paradigm/src/commands/team/orchestrate.ts` imports only from `../../core/` (within package). No `paradigm-mcp/src` imports present. Other files (`commands/symphony/`, `platform-server/`) do import from paradigm-mcp/src but are intentional monorepo patterns with documented rationale.

Symbols: #aspect-fingerprint, #orchestration, #notebook-loader

## [5.36.9] — 2026-04-03

### Changed

- **U2 — Conductor section reorder** — Main overlay sections now ordered by usage priority: Input & Buffer → Team → Sessions & Workspace → Monitoring. Team (agents, tasks, approvals, Symphony threads) was previously buried behind Sessions. Sessions & Workspace now collapses by default (`showSessions = false`).
- **U4 — Approval flow: Approve with notes** — Added `.approvedWithNotes` to `ApprovalDecision` enum. Approval UI gains an "Approve with notes" checkbox toggle; when checked, button label updates and feedback is attached to the approval response with distinct decision semantics. Plain Approve still sends no feedback. Redirect + Feedback behavior unchanged.

Symbols: #conductor-app, #approval-view

## [5.36.8] — 2026-04-03

### Changed

- **E3 — Gate enforcement framing** — `paradigm_portal_add_gate` input field `location` description updated from "Where the gate is enforced" to "Where the gate is checked in your code". Portal guidance resource (`paradigm://guidance/portal`) now explicitly states that portal.yaml is a documentation contract, not a runtime enforcement layer — the compliance checker validates declarations, not code execution.
- **A1 — Orchestration mode clarity** — `paradigm_orchestrate_inline` tool description now documents both execution models: faceted (default, Claude Code Task tool, true multi-agent with isolated context windows per agent) vs. sequential/solo (same session context, works in Cursor and IDEs without Task tool support). CLAUDE.md updated with a one-paragraph explanation.
- **A3 — Adoption contracts framing** — CLAUDE.md and `docs/specs/agent-adoption.md` now state that scoped permissions in `.agent` files are advisory text instructions injected into agent prompts, not wired to Claude Code's tool permission system. A "denied" scope is a recommendation, not a hard block.
- **U1 — Eyebrow detection marked experimental** — `EyebrowCalibrationView`, `EyebrowCalibrationWindowController`, and `EyebrowDetector` header comments updated with `[EXPERIMENTAL]`. Calibration UI title updated to "Eyebrow Calibration (Experimental)". Conductor help screen expanded to explicitly name eyebrow detection in the experimental notice. Feature is maintained at fixes-only priority; use voice + hotkeys for reliable input.

Symbols: #portal-gate, #orchestration, #agent-adoption, #eyebrow-calibration

## [5.36.7] — 2026-04-03

### Removed

- **Heatmap system** (`paradigm_heatmap_record`, `paradigm_heatmap_query`, `paradigm_heatmap_stats`) — required AI to manually record keyword→symbol associations into a data store that was never populated. `paradigm_navigate` and `paradigm_search` cover the use case without the overhead. ~3 tools, ~350 lines removed from schema.
- **Assessment deprecated tools** (`paradigm_assessment_record`, `paradigm_assessment_list`, `paradigm_assessment_get`, `paradigm_assessment_search`, `paradigm_assessment_arc_create`, `paradigm_assessment_arc_close`) — source file opened with `[DEPRECATED]` and all 6 were thin wrappers forwarding to lore tools. Removed from active MCP schema. `assessment.ts` and `assessment-loader.ts` retained as dead files pending migration audit. Use `paradigm_lore_record`, `paradigm_lore_search`, `paradigm_lore_get` directly. Docs updated.
- **University quiz/diploma MCP tools** (`paradigm_university_quiz`, `paradigm_university_submit`, `paradigm_university_diplomas`) — diplomas were YAML files consulted by nothing; quizzes had no behavioral consequence for agents. The quiz/diploma experience continues in the standalone university UI and platform server API. MCP layer kept to: `search`, `get`, `create`, `update`, `validate`, `onboard`.

### Changed

- **`paradigm_flow_validate` renamed to `paradigm_flow_check`** — the old name implied code-level execution path tracing. The tool only checks that gates referenced in `flows.yaml` exist in `portal.yaml` and required fields are present. Updated description is honest about scope. Backward-compat alias retained.
- **`paradigm_ambient_neverland` renamed to `paradigm_ambient_health`** — "Neverland" is the nevr.land product codename; using it for a local learning health check conflated two distinct things. New name matches what the tool returns: agent learning health metrics (cold-start → accumulating → calibrating → mature). Backward-compat alias retained. 3 skill files, guidance resource, and university course para-601 updated.
- **Canvas and University checklist entries corrected** — both `docs/polish-checklist.md` entries were stale. Canvas: base Craft.js editor is wired, Paradigm symbol integration (symbol cards, `.canvas` files, MCP tools) is not built — corrected to `[~]`. University Platform UI: component, store, and server routes are all complete — corrected to `[x]`.

Symbols: #heatmap, #assessment, #university, #flow-loader, #ambient-learning, #context-tools

## [5.36.6] — 2026-04-03

### Added

- **`paradigm docs scaffold`** — new command that generates `.index.yaml` stubs for docs-class `.paradigm/` subdirectories (`specs/`, `implementation-guides/`, `prompts/`, `decisions/`). Supports `--dry-run` and `--quiet`. Only writes to directories that exist and are missing an index; silently skips system-written runtime dirs (`events/`, `agent-state/`, `tasks/`, etc.).
- **Doctor check: docs-class indexes** — `paradigm doctor` now warns when any of the four docs-class directories exists but is missing `.index.yaml`. Status: `warn` (not error). Fix suggestion: `paradigm docs scaffold`.

### Changed

- **`paradigm docs` subcommand group** — `scaffold` joins the existing `serve` and `build` subcommands under `paradigm docs`.

Symbols: #doctor, #docs-scaffold

## [5.36.5] — 2026-04-03

### Changed

- **`paradigm_context_check` renamed to `paradigm_session_health`** — All four session continuity tools now share the `paradigm_session_*` prefix: `session_health`, `session_checkpoint`, `session_recover`, `handoff_prepare`. The old name is preserved as a deprecated alias (routes to the same handler) and will be removed in a future version.
- **`handoff_prepare` silent data loss fixed** — `persisted: true` was hardcoded regardless of whether the disk write succeeded. Now accurately reflects actual write result.
- **Duplicate `session_checkpoint` registration removed** — Tool was registered twice in `getContextToolsList()`, with the second incomplete entry (missing `annotations`) silently overwriting the first. Second registration removed.
- **`loadRecoveryData` extracted** — `buildRecoveryPreamble` (auto-fires on first tool call) and the `session_recover` handler shared near-identical checkpoint/handoff loading logic in two separate copies. Consolidated into one private function to eliminate drift risk.
- **`session_recover` description updated** — Now documents that auto-recovery fires on the first tool call of every session, making explicit calls redundant in most cases (retained for direct inspection or forcing a second recovery pass).

Symbols: #context-tools, #session-tracker, #habits-loader, #ide-adapters, #university

## [5.36.4] — 2026-04-03

### Changed

- **`console.*` eliminated from `packages/paradigm-mcp/`** — Library code must never use `console.*` (stdout = JSON-RPC wire in stdio MCP servers). All 51 violations replaced with Paradigm logger calls across 12 files.
- **`mcp-logger.ts` singleton** — New module at `packages/paradigm-mcp/src/utils/mcp-logger.ts`. Pre-configured `ParadigmLogger` that writes to stderr (not stdout), safe for stdio MCP context. All files in `paradigm-mcp` import from this singleton rather than `@a-company/paradigm-logger` directly.
- **`symphony-loader.ts` migrated** — Was importing `log` directly from `@a-company/paradigm-logger` (bypassing the stderr override). Now uses `mcp-logger.ts`.
- **ESLint config added to paradigm CLI** — `packages/paradigm/eslint.config.js` with `no-console: warn` scoped to `src/commands/**`. Flags future violations in CLI command files without breaking CI. `paradigm lint` script added.
- **Commands refactor queued** — The 2,676 `console.*` violations in `packages/paradigm/src/commands/` are logged as a separate team task. Convention enforcement is now: ESLint warns on new violations; existing ones addressed in waves.

Symbols: #paradigm-mcp, #mcp-logger, #symphony-loader, #cli-surface

## [5.36.3] — 2026-04-03

### Changed

- **`paradigm util` namespace** — Six standalone CLI commands (`beacon`, `constellation`, `echo`, `sync-llms`, `thread`, `probe`) are now grouped under `paradigm util <subcommand>`. The top-level aliases are preserved as deprecated shims that print a migration notice to stderr on use (not on `--help`). Reduces default help surface from ~70+ commands; the util group is a single entry.
- **`#util-namespace` component** — New component registered at `packages/paradigm/src/commands/util/`. Uses Paradigm logger for activity tracking. All 6 subcommands use dynamic imports to avoid startup cost for non-invoked commands.

Symbols: #util-namespace, #cli-surface

## [5.36.2] — 2026-04-03

### Changed

- **Ring 1 content filtering moved to the loader layer** — `RING1_CONTENT_CATEGORIES` filtering is no longer embedded in the Symphony relay transport. The relay is now a pure forwarder with no content policy knowledge. Two unsafe `as unknown as Record` casts eliminated.
- **`isRing1Content(message)`** — new exported predicate in `symphony-loader.ts`. Authoritative Ring 1 classifier, operates on properly-typed `SymphonyMessage.contentType?: ContentCategory`. Single source of truth for all filtering decisions.
- **`recordRing1Interception(agentId, message, boundary)`** — new exported function. Writes a structured `AuditEntry` to `~/.paradigm/events/audit-ring1.jsonl` on every Ring 1 interception at the relay boundary. Previously silent drops now produce an auditable record. Uses Paradigm logger for write failures; non-fatal.
- **`readOutbox` is now filtered by default** — returns only non-Ring-1 messages. Raw access available via `readOutboxRaw` (exported, `@internal`, used by relay for accurate position tracking).
- **`getThreadMessages` filtered** — `paradigm_symphony_thread` MCP tool and Platform UI thread view no longer return Ring 1 content.
- **Outbox watcher position tracking fixed** — `startOutboxWatcher` now tracks raw JSONL line count (not filtered array length) to prevent cursor drift when Ring 1 messages exist at arbitrary positions in the outbox file.
- **`SymphonyMessage` interface** — added `contentType?: ContentCategory` field, typed against the `ContentCategory` union rather than `string`.
- **Audit entries use `destination_ring: 'network-public'`** — relay peers are arbitrary network machines; `'user-scoped'` (Ring 2) was incorrect for a cross-machine relay boundary.

Symbols: #symphony-loader, #symphony-relay, ~ring1-filtering

## [5.36.1] — 2026-04-02

### Changed

- **Loid (Forge) consolidated as Agent Intelligence Officer** — Loid now owns the full agent lifecycle: strategic (designs agents, roster analysis, team composition) AND reactive (session learning after every orchestrated session). She is no longer a meta-agent who only activates on demand — she is Cid's partner in closing every session with learning, not just navigation.
- **Loid's `session-learning` behavior** — After Cid's debrief, Loid receives `sessionInsights` and processes per-agent: what was accomplished, what patterns are notebook-worthy, what nominations are targeted enough to be actionable. Journal entry quality standard enforced: no file-path templates, only grounded insights that a future agent would actually use.
- **Cid debrief produces `sessionInsights`** — `paradigm_captain_debrief` now parses `.paradigm/events/session-log.jsonl` to build per-agent contribution data, emits a `learningHandoff` block in its output, and passes `sessionInsights` to Loid's learning pass.
- **Orchestration final step is now a three-step sequence** — (1) `paradigm_captain_debrief`, (2) `paradigm_ambient_learn_postflight` with `sessionInsights` (Loid's learning pass), (3) session complete. The session is not done until both Cid and Loid have run.
- **Cid and Loid cross-reference each other** — Both agent files updated with explicit `pairs_well_with` entries describing the handoff: Cid closes navigation, Loid closes learning.

Symbols: #cid, #forge, #orchestration, #session-learning, #ambient-learning

## [5.36.0] — 2026-04-02

### Added

- **Cid — The Captain Agent** — New protected core agent who runs as the mandatory first and last stage of every orchestration. Named after Final Fantasy's recurring engineer-captain archetype. Cid cannot be benched via normal roster operations — requires `PARADIGM_SKIP_CAPTAIN=1` to disable.
- **`paradigm_captain_brief`** — Pre-task context discovery tool. Takes the task description, extracts keyword clusters, runs symbol search + navigate + ripple on top symbols, checks gates for any route patterns, surfaces wisdom antipatterns, finds matching protocols, queries recent lore, computes a coverage confidence score, and returns a structured Context Brief. The brief is injected into every agent's prompt in the orchestration chain.
- **`paradigm_captain_debrief`** — Post-task maintenance tool. Audits `.purpose` coverage for every touched directory, creates stubs for uncovered areas, queues rich-doc gaps to `.pending-review` for Documentor, records the session to lore, updates coverage scores, and writes the `.cid-briefed` marker that signals the stop hook to run a lightweight check instead of the full suite.
- **Context Brief injection** — Every agent in execute mode now receives Cid's Context Brief in their prompt: territory, symbols, blast radius, gates, matched protocol, warnings, and coverage confidence. Agents start from a map, not from scratch.
- **Coverage confidence score** — Cid computes a `0.0–1.0` coverage score for the affected area on every brief (`sparse → partial → reliable → comprehensive`). Makes the value of `.purpose` investment legible in real time.
- **Stop hook integration** — If `.cid-briefed` marker exists, the stop hook runs only the route-without-portal check and exits. Full 13-check compliance suite runs only when Cid was not invoked. Enforcement is cooperative rather than adversarial.
- **ADR-CID-001** — Architecture decision recorded at `.paradigm/decisions/ADR-CID-001.yaml`.
- **Cid added to project roster** — `cid` is now the first agent in `.paradigm/roster.yaml`.

### Changed

- **Orchestration quick mode** — Cid brief (quick depth) now runs before the Advocate stress-test, giving Jinx a map to challenge rather than working blind.
- **Orchestration execute mode** — Final step instructs the orchestrating session to call `paradigm_captain_debrief` after all agents complete.

Symbols: #cid, #orchestration, #paradigm-mcp, #purpose-files, #stop-hook

## [5.35.1] — 2026-04-01

### Fixed

- **Agent benching is now per-project, not global** — Previously `paradigm_agent_bench` set `benched: true` on the global `~/.paradigm/agents/*.agent` file, disabling the agent across ALL projects. Now bench/activate modify the project's `.paradigm/roster.yaml` instead. Agents not on the roster are skipped by orchestration and nomination for that project only. Other projects are unaffected.
- **Orchestration uses roster for agent filtering** — `orchestration.ts` no longer checks `profile.benched`. Uses `loadProjectRoster()` to determine which agents are active per project. If no roster exists, all agents are available (backward compatible).
- **Nomination engine uses roster for agent filtering** — `nomination-engine.ts` now calls `isAgentActive(id, rootDir)` instead of checking `profile.benched`.
- **`paradigm_agent_activate` uses roster** — Previously wrote `benched: false` to the global `.agent` file. Now adds the agent to the project roster.
- **Stripped `benched: true` from all global .agent files** — The `benched` field on global profiles is now deprecated. Activation is controlled entirely by per-project rosters.

Symbols: #agent-roster, #orchestration, #nomination-engine, #agent-loader

## [5.35.0] — 2026-04-01

### Changed

- **Analyst agent (Sage) reworked to general-purpose data savant** — Broadened from product-metrics specialist to a number-crunching generalist that handles any dataset: financial, operational, market, product, and client reporting. New behaviors: `financial-analysis` (P&L, unit economics, cash flow, forecasting), `operational-reporting` (throughput, SLA, bottleneck identification, capacity planning), `report-generation` (structured reports adapted to audience depth), `anomaly-detection` (statistical outliers, trend breaks, correlation shifts). All existing depth retained (SQL, A/B testing, dashboards, cohorts, tracking plans). Unbenched.
- **Analyst added to roster suggestions** — Now auto-rostered for `saas-web-app`, `backend-api`, and `python-project` project types.

Symbols: #analyst, #agent-roster

## [5.34.0] — 2026-03-31

### Added

- **Agent Adoption Contracts** — New `.paradigm/adoptions.yaml` as single source of truth for adopted agents. Records adoption date, source (core/ecosystem/marketplace), defaults accepted, user overrides, and scope approval status. Unified model for core roster agents and future Neverland marketplace agents.
- **Scoped Permissions (PAN-2)** — Agents declare capabilities as typed scopes (`read:`, `write:`, `tool:`, `net:`, `exec:`) in `.agent` profiles. 5 coarse categories with human-readable descriptions. `dangerous` scopes list for runtime confirmation. All 55 agent profiles updated with role-appropriate scopes.
- **Agent Configurable Behaviors (PAN-1)** — `configurable` section in `.agent` profiles declares per-agent behavioral options with types, defaults, and descriptions. Users override via adoption records. All 55 agent profiles updated with 1-3 configurable options each (e.g., builder: `run-tests-before-handoff`, documentor: `write-university-notes`, security: `vulnerability-threshold`).
- **Shift Guaranteed Files** — `paradigm shift` now ensures 36 core files/directories exist after completion. Skeletal YAML and empty JSONL files created idempotently via `GUARANTEED_FILES` manifest. Includes event streams, history, lore, wisdom, notebooks, university, and protocol indexes.
- **Post-Shift Recommendations** — Replaces hardcoded "Next steps" with a conditional recommendation engine. 9 checks against actual project state (empty .purpose, missing sub-purposes, empty portal, pending scope reviews, etc.). Max 4 action items + informational items. Each with copy-paste command.
- **Scope Approval Flow** — `paradigm agent review [id]`, `paradigm agent approve <id>`, `paradigm agent deny <id>`, `paradigm agent scopes <id>` CLI commands. Diff-style scope display showing `[new]`, `[kept]`, `[removed]`, `[expanded]`. Auto-approve when scope IDs unchanged. Non-interactive fallback writes to `.pending-scope-reviews`.
- **Adoption Ceremony in Shift** — `paradigm shift` now includes an adoption step after roster setup. Migrates existing rosters to adoption records. Shows batch summary of core + detected ecosystem agents. Auto-accepts defaults in non-interactive mode.
- **`scopes` and `configurable` on AgentProfile** — MCP `AgentProfile` type extended with optional `scopes` (permissions array + dangerous list) and `configurable` (typed option declarations) fields.
- **Agent Adoption Spec** — Full specification at `docs/specs/agent-adoption.md` covering scoped permissions, adoption ceremony UX, PAN v1.0 standard (7 requirements), shift guarantees, and post-shift recommendations.

Symbols: #agent-adoption, #agent-scopes, #shift, #shift-recommendations, $agent-adoption-flow, $agent-update-flow, #agent-identity

## [5.33.0] — 2026-03-30

### Added

- **Outcome Reference Tracking (P4)** — Records which notebook entries are loaded into agent prompts during orchestration. `NotebookReferenceEntry` type in session work log, `recordNotebookReference()` function called at both orchestration prompt-building sites. Pure data collection — no scoring (per team verdict: Goodhart's Law concern, collect data first). Count surfaced in `paradigm_status`.
- **Change-Based Health (P5)** — Tracks stop hook violation frequency over time via `compliance-history.jsonl`. `getComplianceTrend()` computes `improving | stable | degrading` from split-window violation rate comparison. `getHealthDot()` maps trend to `green | yellow | orange | red` for Conductor. Stop hook now writes compliance snapshots (non-fatal).
- **Tool Aliases (P6)** — `aliases` field on `ToolDefinition` for better LLM tool matching. 10 tools aliased: search, status, ripple, navigate, orchestrate, lore_search, aspect_check, gates_for_route, session_recover, reindex. Simple string arrays — NOT semantic embeddings (per team verdict: domain vocabulary blindness).

### Fixed

- **Health dot `rootDir` passthrough** — `getHealthDot()` in `paradigm_status` now receives `ctx.rootDir` so it can read actual violation history. Previously always resolved `green` for stable trends.

Symbols: #outcome-reference-tracking, #compliance-health, #tool-aliases, #session-work-log, #orchestration, #tool-registry, #enforcement-hooks

## [5.32.0] — 2026-03-30

### Added

- **Gap Narration Engine (P1)** — `gap-narrator.ts` with 13 human-readable narration templates, one per enforcement check type. Each template explains WHY a gap matters and HOW to fix it. Integrated into `paradigm doctor --explain` and postflight reports. NOT in stop hook (per team verdict: stop hook value is terseness).
- **Activity Metrics (P2)** — `SessionActivitySummary` tracking tool call count, response payload size, and session duration per agent. Stored in session work log. No dollar figures, no token counts — proxy metrics only (per team verdict: MCP cannot see token counts, showing costs creates behavioral distortion).
- **Soft Provenance (P3)** — Optional `parentId` and `lineageType` fields on `NotebookEntry` for tracking derivation chains (`fix`, `derive`, `capture`, `promote`). No DAG validation, no migration. `paradigm_notebook_add` accepts both fields.
- **`prepareForPublish()` function** — Strips `parentId` and `lineageType` before external sharing. Only `public` shareability entries can be published; `team` and `private` return null.
- **4 new `ContentCategory` values** — `gap_narrations`, `cost_data`, `health_status`, `execution_metrics` with `RING1_CONTENT_CATEGORIES` constant for project-locked enforcement.
- **`notebook-publish` enforcement boundary** — Deny-by-default boundary for notebook content crossing trust rings. `enforce()` now has explicit handlers for both `notebook-promotion` and `notebook-publish` (previously fell through to allow-by-default).
- **`shareability` field on `NotebookEntry`** — `'public' | 'team' | 'private'` controlling what publish boundaries an entry can cross. Defaults to `'team'`.

### Fixed

- **Symphony relay content filtering** — Ring 1 content categories now blocked on BOTH incoming messages AND outbox watcher (previously only incoming was filtered, outbound could leak project-locked data).
- **`enforce()` allow-by-default for notebook boundaries** — `notebook-promotion` and `notebook-publish` now use deny-by-default with explicit ring checks instead of falling through to `allowed: true`.
- **Incomplete `deny_content` lists** — Added all 4 new content categories to `learning_journal` and `team_decisions` stream deny lists in `DEFAULT_DATA_POLICY`.

Symbols: #gap-narrator, #activity-metrics, #soft-provenance, #data-policy, #symphony, #notebook-loader, #session-work-log, #compliance-checker, #enforcement-hooks

## [5.31.0] — 2026-03-28

### Added

- **PARA 001: Quick Start** — New 3-lesson course (~15 min). Hands-on from minute one: `paradigm shift` setup, meet the agent team, build a feature with orchestration. All HOW-first quizzes.
- **Enforcement Levels lesson (PARA 301)** — Covers minimal/balanced/strict, all 13 checks, per-check overrides, and progression strategy.
- **paradigm shift lesson (PARA 301)** — The 6-step onboarding command: init, migrate, scan, sync IDEs, install hooks, roster + tiers. Flags and when to re-run.
- **Quick-Check lesson (PARA 401)** — Lightweight pre-implementation risk assessment with Jinx + reviewer. GREENLIGHT vs ESCALATE verdicts. When to use quick-check vs full orchestration.
- **Conductor Workspace lesson (PARA 501)** — Visual mission control: workspace tiling, Symphony integration, task protocol (7 intents), agent health dashboard, local-only ML.

### Changed

- **PARA 101 reordered** — "Your First Steps" moved from lesson 8 to lesson 2. Students do before they theorize. Content updated with forward references.
- **PARA 201 Aspect Graph condensed** — 10,688 → 3,376 chars. Now an introduction covering categories, fields, and 7 MCP tools. Points to PARA 501 for SQLite internals, learning loop, and edge origins.
- **PARA 401 Agent Roles rewritten** — Bridges the 5→54 agent disconnect. Three-tier hierarchy (8 core, ~20 specialized, ~26+ ecosystem), all 8 core agents named, Rune compliance coverage, paradigm shift auto-rostering.
- **Quiz upgrades WHAT→HOW** — Converted pure-recall questions to scenario-based in PARA 101 (welcome, five-symbols) and PARA 301 (history-system). All new lessons written HOW-first.
- **University totals** — 7→8 courses, 75→82 lessons, 361 quiz questions across all courses.

Symbols: #university, #enforcement-hooks, #shift-command, #orchestration, #conductor

## [5.30.0] — 2026-03-28

### Added

- **Rune (compliance) — 8th core agent** — Paradigm symbol compliance specialist. Plans symbols before implementation (Symbol Plan), validates coverage after (Compliance Report). Enforces 1:1 component-to-aspect ratio, flow coverage for 3+ component changes, signal registration for events, aspect anchor integrity. Uses only MCP tools. Added to all project type rosters, DEFAULT_MODELS (sonnet), AGENT_TIERS (tier-2), ROLE_PROMPTS, and paradigm_agent_prompt enum.
- **Conductor: drag-and-drop file support** — Drag files from Finder into terminal panes. POSIX single-quote escaping (immune to shell injection). Written via `send(txt:)` — no auto-execute, user confirms. Transparent overlay NSView with `hitTest` returning nil (passes all mouse events through to SwiftTerm).
- **Conductor: Cmd+=/- font sizing** — Window-level `performKeyEquivalent` override intercepts before SwiftTerm. Font size 9-28pt range, applied to all terminal panes.
- **Conductor: application main menu** — View menu (font sizing), Session menu (new/close), App menu (about/quit) with keyboard equivalents.

## [5.29.0] — 2026-03-27

### Added

- **Conductor embedded terminal (Sprint 0)** — SwiftTerm integration proven. Claude Code runs inside Conductor's container grid cells with full Ink TUI rendering (colors, ASCII art, interactive prompt, status bar). SwiftTerm added as Swift package dependency. New files: `TerminalSession`, `TerminalSessionState`, `TerminalViewRepresentable`, `TerminalCellView`. Launch button opens a folder picker to select the project directory.
- **Conductor workspace spec** — Full spec at `docs/specs/conductor-workspace.md` covering 4 sprints: SwiftTerm spike (done), session manager + multi-pane, Symphony auto-link, polish + window management.
- **Conductor Sprint 1: Session Manager + Multi-Pane** — `TerminalSessionManager` with session CRUD, max 8 sessions, active session tracking, cell assignment. `NewSessionSheet` with recent projects + folder picker. Every empty grid cell shows "New Session" button. Multiple Claude Code sessions run side by side with independent project directories. Focus ring updates on click between panes via `@ObservedObject` on the session manager.
- **Conductor Sprint 2: Symphony Auto-Link** — Sessions auto-register with Symphony via `AgentPartManager.registerAgent()` on creation. Thread watcher rescans after registration. Sidebar shows active session project context (name, session count). Symphony link icon on cell toolbar. Session cleanup unregisters from Symphony.
- **Conductor Sprint 3: Keyboard Shortcuts + Workspace Mode** — `Cmd+T` (new session in first empty cell), `Cmd+W` (close active session), `Cmd+\` (toggle sidebar), `Cmd+1-8` (focus cell by number). Workspace mode uses `.regular` activation policy (Dock icon, Cmd+Tab visible).

## [5.28.0] — 2026-03-27

### Added

- **Conductor standalone `.app` bundle** — `build-conductor.sh` produces a proper macOS application at `build/Conductor.app`. No Xcode required. Ad-hoc signed with entitlements for accessibility. Update flow: `git pull && ./build-conductor.sh --install`. Includes `--enable-autolaunch` for login start via LaunchAgent.
- **Conductor `Resources/Info.plist` template** — Version placeholders (`__VERSION__`, `__BUILD_NUMBER__`) filled by build script from `VERSION` file + git rev count. Includes `NSAccessibilityUsageDescription`, `CFBundleIconFile`, `NSHighResolutionCapable`.
- **Conductor entitlements file** — No sandbox (required for AX API), apple-events automation.
- **Conductor `VERSION` file** — Single source of truth for Conductor version (0.2.0).

### Changed

- **Conductor product name capitalized** — `Package.swift` product renamed from `conductor` to `Conductor` for macOS conventions. Binary is now `.build/release/Conductor`.

## [5.27.1] — 2026-03-27

### Fixed

- **`paradigm shift` runs non-interactively by default** — Previously forced interactive model selection prompts (`configureModels: true`), which blocked `! paradigm shift` in Claude Code and broke the "one command setup" promise. Now auto-defaults model tiers based on environment detection (opus/sonnet/haiku for Claude Code, sonnet/sonnet/haiku for Cursor). Use `paradigm shift --configure-models` for interactive selection.
- **Default enforcement level changed from `balanced` to `minimal`** — New projects no longer block on missing `.purpose` files or habits violations. `minimal` warns on `purpose-coverage` and `habits-blocking` but never blocks. Users upgrade to `balanced` or `strict` once they understand the system. Changed in: writer.ts (seed default), loader.ts (fallback default), enforcement.ts (MCP fallback).

## [5.27.0] — 2026-03-27

### Added

- **Conductor: Multi-workspace Symphony threads** — Thread watcher now discovers agents across ALL projects in `~/.paradigm/score/agents/`, not just the current workspace. Cross-session messages are visible in Conductor.
- **Conductor: All-thread visibility** — Removed `thr-orch-*` hard filter. All Symphony threads now appear in Conductor with a 2-hour staleness cutoff (configurable via "show all threads" toggle).
- **Conductor: General message notifications** — New `SymphonyNotificationManager` with priority-based notifications: banner (alerts, tasks, pan-invoke), toast (questions, proposals, decisions), silent (clarifications, progress).
- **Conductor: Bidirectional messaging** — Messages sent from Conductor appear in the thread view immediately via `appendLocalMessage()`, no more 5-second poll delay.
- **Conductor: Project context badges** — Thread headers show color-coded project origin badges for cross-project threads.
- **Conductor: PAN intent support** — `pan-invoke` and `pan-result` intents added to `MessageIntent` enum with colors in both ThreadView and TeamThreadView.
- **Conductor: Agent re-scan** — `rescanAgents()` on SymphonyThreadWatcher discovers agents that linked after Conductor launched.

## [5.26.0] — 2026-03-27

### Fixed

- **Compact reindex response** — `paradigm_reindex` returned the full 80KB+ RebuildResult (every orphaned symbol, component type breakdown, integrity report). Now returns a ~500 byte summary: success, symbolCount, breakdown, flowCount, filesWritten count, and issue count. Prevents context window destruction on large projects.

## [5.25.0] — 2026-03-27

### Added

- **PAN network fields on `AgentPromptResult`** — `tools` (tool names/groups), `mode` ('single' | 'react'), `maxIters` (iteration budget). Lets Paradigm orchestration target ReAct-capable PAN agents without itself becoming a ReAct loop.
- **`pan-invoke` / `pan-result` Symphony intents** — Typed channel for PAN agent invocation over Symphony. `PanInvokePayload` carries agentId, offering, params, callStackDepth. `PanResultPayload` returns result with token usage and iteration count.
- **`network` section on `AgentProfile`** — Links Paradigm agent identity to PAN agent ID, declares available offerings, invocation permissions, and concurrency limits.
- **`pan` feature tier in tool registry** — Auto-detects `.pan` or `nevr.yaml` in project root. When present, PAN-specific tools become available alongside existing Paradigm tools.

## [5.24.0] — 2026-03-25

### Added

- **University section in Platform UI** — Course listings, PLSAT certification exams, earned diplomas, and reference content. Platform server routes at `/api/university/`. Replaces "Coming Soon" placeholder.

### Fixed

- **Consolidated duplicate habits evaluator** — CLI evaluator (`paradigm/core/habits/evaluator.ts`) now re-exports from the canonical MCP evaluator (`paradigm-mcp/utils/habits-loader.ts`). Added 4 missing check types to MCP: `commit-message-format`, `flow-coverage`, `context-checked`, `aspect-anchored`.
- **Duplicate `symphony` key in orchestration execute result** — Two `symphony` keys in the execute mode result object caused the first (Conductor thread info) to be silently overwritten. Merged into a single key.

## [5.23.0] — 2026-03-25

### Added

- **Orchestrator quick-check mode** (`mode="quick"`) — Lightweight pre-implementation sanity check. Jinx (advocate) stress-tests assumptions, reviewer checks feasibility. Returns greenlight or escalates to full orchestration. ~3-4k tokens. Satisfies orchestration-required enforcement.
- **Jinx (advocate) promoted to core agent** — Added to all project type roster suggestions, `DEFAULT_MODELS`, `AGENT_TIERS`, `paradigm_agent_prompt` enum, and `ROLE_PROMPTS`. Unbenched globally. Every new project now gets advocate alongside architect, builder, reviewer, tester, security, and documentor.
- **Magnitude-based orchestration triggers** — Stop hook Check 13 now computes a magnitude score from multiple signals instead of raw file count: source files (1pt each), cross-package changes (+2pts), security-adjacent files (+2pts each), and multi-symbol file changes (+1pt). Score compared against configurable threshold (default 3).

### Changed

- **Orchestration tool description** updated to lead with `mode="quick"` as the default starting point.
- **Stop hook violation message** now shows magnitude breakdown and recommends `mode="quick"` for fast pre-check.

## [5.22.0] — 2026-03-25

### Added

- **Enforcement configuration system** — New `enforcement` section in `.paradigm/config.yaml` with 3 preset levels: `strict` (all checks block), `balanced` (security blocks, docs warn), `minimal` (everything advisory). 13 check IDs with per-check severity overrides. Users control what blocks them.
- **`paradigm enforcement` CLI** — `status` (show table), `set <level>` (change preset), `override <check> <severity>` (per-check), `reset` (clear overrides), `resolve --json` (for stop hook). Full user control over enforcement.
- **`paradigm_enforcement_configure` MCP tool** — Agents can view/change enforcement settings on behalf of users. Actions: status, set-level, override, reset.
- **Orchestration enforcement** — New Check 13: when enforcement is `strict` or `balanced`, tasks modifying 3+ source files without `paradigm_orchestrate_inline` produce a warning or block. `.paradigm/.orchestrated` marker written when orchestration is used, cleaned up on pass.
- **paradigm shift writes enforcement defaults** — Step 2e seeds `balanced` enforcement config during project setup.
- **Every stop hook check is now severity-gated** — All 13 checks read from enforcement config. `off` = skipped entirely, `warn` = advisory only, `block` = violation. No more all-or-nothing enforcement.

## [5.21.4] — 2026-03-25

### Fixed

- **Lore check doesn't recognize .lore files** — Stop hook Check 7 only looked for `*.yaml` lore entries but the MCP tool writes `*.lore` files. Now matches both `*.yaml` and `*.lore` in both git diff check and disk check. This caused "no lore entry recorded" violations even after lore was recorded.

## [5.21.3] — 2026-03-25

### Fixed

- **Fix habits false blocks in CLI evaluator (the REAL fix)** — v5.21.2 fixed `paradigm-mcp/src/utils/habits-loader.ts` but the stop hook uses a SEPARATE copy at `paradigm/src/core/habits/evaluator.ts`. Both copies now have the same fix: `git-clean` auto-passes on `on-stop`, `file-modified` with `severity:block` downgrades to advisory on `on-stop`.

## [5.21.2] — 2026-03-25

### Fixed

- **Stop hook false blocks from git-clean and file-modified habits** — `git-clean` check now auto-passes on `on-stop` trigger since uncommitted changes are expected before the user commits. `file-modified` with `severity: block` on `on-stop` downgrades to advisory (`partial`) since files may exist but not yet appear in `git diff`. Both checks work normally on `on-commit` trigger where staged files are reliable. Fixes blocking "Update Changelog" and "Commit Changes" violations on every session end.

## [5.21.1] — 2026-03-25

### Fixed

- **Gate detection false positives** — Portal compliance checker was grepping ALL source files for `^word` patterns, matching React components (SuperAdminRoute), CSS hex colors, regex character classes, URL fragments, and documentation examples. Now scans ONLY `.purpose` files and `portal.yaml` for `^gate` symbol references. Function-based checks (checkGate, requireGate, @Gate) still scan all code since they're unambiguous. Also restricted gate name regex to kebab-case only (`^[a-z][a-z0-9-]+`), filtering out PascalCase, UPPER_CASE, and mixed patterns. Field-tested fix from dealoracle where 73 false "undeclared gates" were blocking every session.

## [5.21.0] — 2026-03-25

### Added

- **Overview stats auto-refresh** — Polls every 15 seconds, skips when document hidden.
- **12 new CSS accent tokens** — Extended palette (`--p-accent-cyan`, `-amber`, `-yellow`, `-emerald`, `-pink`, `-lime`, `-slate`) + 5 graph node tokens for both dark/light themes.

### Fixed

- **Light mode color sweep** — Replaced 60+ hardcoded hex colors across Team (17), Sentinel (3 tabs, 16 colors), Graph (9), Canvas (6), Lore (13), agent store with CSS variable tokens. Light mode now works correctly across all sections.
- **DetailPanel decomposed** — 358-line monolith split into 5 focused sub-components (DetailMeta, DetailBody, DetailDecisions, DetailReview, DetailFiles). Parent reduced to 52 lines.
- **AbortController on all fetches** — 23 controllers across 7 stores. Stale requests cancelled on re-fetch or unmount. Mutation endpoints intentionally excluded.
- **Section-visibility polling** — Team and Ambient sections skip polling when not the active section. SSE connections maintained regardless.

## [5.20.0] — 2026-03-25

### Added

- **Overlay panel grouping** — MainOverlayView's 11 flat sections grouped into 4 collapsible DisclosureGroup regions: Input & Buffer, Sessions & Workspace, Team, Monitoring. Clean visual hierarchy.
- **ContainerView environment migration** — ContainerView now uses `@EnvironmentObject` like MainOverlayView (was 10 separate @ObservedObject). AppDelegate injects the shared environment.
- **Grid preset persistence** — `@AppStorage("conductorGridPreset")` preserves selected grid layout across launches. GridPreset gains RawRepresentable conformance.
- **ConductorTheme full adoption** — 25 view files migrated from raw `.green`/`.red`/`.blue` to semantic tokens (`ConductorTheme.healthy`/`.critical`/`.active`). ~100% coverage for status colors.
- **Agent color stability** — TeamThreadView uses deterministic Unicode scalar sum instead of Swift's randomized `hashValue`. Same agent gets same color every session.
- **Accessibility completion** — 17 additional status dot labels across 14 views. 84 font size occurrences standardized: all `size: 7` → `fontXS` (8pt), `size: 8` → `fontXS`, `size: 9` → `fontSM`. Zero sub-8pt fonts remain.

## [5.19.0] — 2026-03-25

### Fixed

- **Stop hook route detection false positives** — Check 3 now skips test/spec/fixture files and filters out comment lines, documentation strings, and metadata patterns. No more blocking on `// POST /api/...` in comments.
- **Stop hook source file counting** — Check 1 now directory-aware: finds covering .purpose per file, only flags directories where source changed but the covering .purpose was NOT updated. Multi-file refactors in one .purpose directory no longer falsely block.
- **Stop hook .purpose freshness** — Check 5 adds git-based fallback: compares source file mtime vs .purpose mtime when .pending-review tracking is out of sync.
- **Legacy afterFileEdit hook removed** — Gutted to no-op (exit 0). All tracking now handled by postToolUse hook which has visible output. Reduces hook execution overhead.
- **Structured violation locations** — Compliance check now returns `structuredViolations` with `file`, `source`, and `severity` fields alongside existing string violations. Agents can programmatically find which files to fix.

## [5.18.0] — 2026-03-25

### Added

- **Automated postflight learning pass** — New `paradigm_ambient_learn_postflight` MCP tool converts session verdicts into journal entries automatically. Verdict mapping: accepted → `human_feedback`, dismissed → `confidence_miss`, revised → `correction_received`. Rich insight strings include contribution context, user reasons, and session accept rate. Auto-promotes eligible journals to notebooks.
- **`--learn` flag on compliance-check** — Stop hook now passes `--learn` to run the postflight learning pass after compliance checks. Fire-and-forget, non-blocking.
- **Stale JSONL pruning** — Nominations and debates files now auto-prune entries older than TTL when file exceeds 100 entries. Prevents unbounded file growth.
- **Configurable ambient TTL** — New `ambient` config section in config.yaml: `nomination-ttl-days` (default 7) and `debate-ttl-days` (default 14). Replaces all hardcoded 7-day thresholds.

### Changed

- **Auto-promotion triggers** — `human_feedback` journal entries now eligible for notebook promotion alongside `pattern_discovered`. Corrective entries (`correction_received`, `confidence_miss`) remain journal-only.

## [5.17.0] — 2026-03-25

### Added

- **Feature detection caching** — `detectActiveFeatures()` results cached with 5-minute TTL. Was called 3x per operation doing 19 filesystem checks each time. `paradigm_reindex` invalidates the cache.
- **Collaboration graph wired into planning** — `handoff_to` edges now influence stage ordering via Kahn's algorithm topological sort. Collaboration boost in agent suggestion: agents that work well with already-selected agents get priority. Plan output includes `collaborationGraph` field showing team dynamics.
- **Smart documentor skipping** — Documentor stage skipped for analysis-only tasks and when no code-writing agents are in the plan. Saves 2-8k tokens on non-code tasks.
- **Orchestration mode from config** — `default_mode` from agents.yaml `orchestration` block is now respected (was hardcoded to "faceted"). Falls back to faceted if not configured.

### Fixed

- **Tier ambiguity** — graph and heatmap moved from advanced to feature tier (auto-detect when aspect-graph.db exists). conductor/platform/pipeline remain advanced-only.

## [5.16.0] — 2026-03-25

### Added

- **Notebooks wired into orchestration** — `paradigm_orchestrate_inline` execute mode now loads top 5 relevant notebook entries per agent, filtered by task symbol concepts. Plan mode shows notebook knowledge counts per agent. The `paradigm_agent_prompt` tool also loads notebooks. This closes the loop — 272 global + 29 project-scoped entries are now actually surfaced to agents during execution.
- **Confidence decay** — Agent expertise confidence now decays over time with 60-day half-life (7-day grace period). Stale expertise from a month ago ranks lower than recent work. Entries with >20% decay show "(aging)" tag. Applied in all expertise consumers: queryExpertise, mergeAgentProfileWithManifest, buildProfileEnrichment.
- **`paradigm agents roster` CLI** — New subcommand group: `roster` (show table), `roster init` (create from project type), `roster add <ids>`, `roster remove <ids>`. All support `--json` output. Uses cli-output helpers.
- **Complete AGENT_TIERS table** — All 54 agents now have explicit tier assignments (was 21/54, rest silently defaulted to sonnet). 9 tier-1 (opus), 23 tier-2 (sonnet), 22 tier-3 (haiku).
- **Agent nicknames** — All 54 agents now have nicknames for attributed responses. Added: Apex (architect), Kit (builder), Judge (reviewer), Aegis (security), Probe (tester), Scribe (documentor).
- **Builder agent enrichment** — Grew from 36-line stub to 115-line profile with 5 concrete behaviors, attention patterns, 3 transferable patterns, and collaboration relationships.

## [5.15.0] — 2026-03-24

### Added

- **`paradigm_ripple` standalone MCP tool** — Extracted from preflight checker into dedicated `ripple.ts` module. BFS traversal with configurable depth (default 3, max 5), cycle detection, affected flows/gates analysis, impact severity scoring, and suggested review scope. Registered as core-tier tool in ToolRegistry. Removed 270-line inline handler from tools/index.ts.
- **Portal eat-our-own-cooking** — Expanded from 1 gate / 6 routes to 4 gates / 94 routes across 3 portal.yaml files. New gates: `^authenticated-session`, `^read-only`, `^write-capable`. Full route coverage for Platform server (60+ routes), University server (8 routes), and Sentinel server (29 routes).
- **Drift auto-heal documentation** — Documented three-layer resolution (exact hash → normalized hash → content fingerprint) with threshold table (≥0.85 auto-heal, 0.7-0.85 suggest, <0.7 real drift). Added configurable `drift` section to config.yaml.
- **Purpose migration docs** — New `.paradigm/docs/purpose-migration.md` covering v1→v2 symbol prefix changes and migration steps.

### Fixed

- **Purpose file versions** — Standardized all 57 .purpose files to v2.0.0 (was mix of v1.0.0, v0.2.0, comment-style versions, and missing version fields).

## [5.14.0] — 2026-03-24

### Added

- **Command palette** — `Cmd+K` opens a searchable command palette in Platform UI. Filter sections by name, navigate with arrow keys, press Enter to select. Number keys `1-9` switch sections directly when not typing. `Escape` closes overlays.
- **`paradigm explain-files`** — New CLI command (alias: `paradigm files`) that prints a categorized, color-coded guide to all Paradigm config files. Shows which files exist in the current project, grouped by: required, optional, auto-generated, and IDE integration.
- **`cli-output.ts` helpers** — Structured CLI output utilities (`out()`, `success()`, `warn()`, `error()`, `dim()`, `header()`, `kv()`, `json()`) replacing raw console.log in CLI commands. Convention documented in CLAUDE.md: library code uses Paradigm logger, CLI commands use these helpers.

### Changed

- **CLI output convention** — CLAUDE.md updated to distinguish library logging (Paradigm logger) from CLI output (cli-output helpers). Three commands converted as examples: `watch.ts`, `graph.ts`, `promote.ts`.

## [5.13.0] — 2026-03-24

### Added

- **ToolRegistry wired into MCP dispatch** — The existing but unused `ToolRegistry` is now the actual tool registration and dispatch path. Tools organized into 3 tiers: core (7 modules, always loaded), feature (18, project-dependent), advanced (7, on-demand via `paradigm_tool_activate`). Replaces O(n) if-chain with Map-based dispatch. Net ~150 lines removed from tools/index.ts.
- **Tool definition helpers** — New `utils/tool-helpers.ts` with `defineTool()`, `formatToolResult()`, and `loadYamlFile()` factories for future tool module cleanup.
- **`paradigm compliance-check` command** — Single CLI command replacing 3 separate subprocess calls in stop hook. Runs habits, drift, and portal checks in one Node.js process with combined JSON output.
- **ConductorTheme design token system** — Expanded `ConductorColors` into `ConductorTheme` with 8 semantic color tokens (brand, symphony, healthy, degraded, critical, warning, active, muted), 4 font size constants, and card style constants. Backward-compatible typealias preserved.
- **ConductorEnvironment** — New `@MainActor ObservableObject` replacing MainOverlayView's 15 `@ObservedObject` properties with a single `@EnvironmentObject`.
- **Accessibility labels** — Added `.accessibilityLabel()` to all status dots and icon-only buttons across 5 Conductor views (MainOverlayView, AgentHealthView, AgentRosterView, AgentNetworkView, ContainerView).
- **Shared Platform UI components** — Extracted `StatCard`, `EmptyState`, and `Badge` into `components/shared/`. Overview and Ambient sections now share the same StatCard.
- **Unified CSS token system** — Migrated Lore and Graph sections from standalone `:root` variables to Platform's `--p-*` prefix system. Removed conflicting global resets. Replaced 20+ hardcoded hex colors with CSS variables.

### Fixed

- **Stop hook performance** — Reduced from 5 Node.js subprocess spawns + 2 `find` scans to 1 subprocess + cached `.purpose` paths. Estimated 1-2 second saving per session end.
- **Centralized post-dispatch events** — Extracted event emission from 10+ individual tool handlers into single `emitPostDispatchEvents()` function.

## [5.12.0] — 2026-03-24

### Added

- **Project agent roster** — 14-agent team registered for the Paradigm repo: architect, builder, reviewer, tester, security, documentor + dx, release, debugger, qa, educator, researcher, performance, designer. Orchestrator only considers rostered agents.
- **29 project-scoped notebook entries** — Every rostered agent bootstrapped with Paradigm-specific knowledge: architecture, build chain, test infrastructure, security posture, DX surfaces, release process, debug paths, course content, research domains, performance targets, and UI surfaces.
- **ErrorBoundary for Platform UI** — Each lazy-loaded section wrapped in error boundary with reload button. Uncaught exceptions no longer crash the entire app.

### Fixed

- **Platform UI URL routing** — Added missing sections (team, canvas, sentinel, ambient, docs) to `validSections` in `App.tsx` and `useAgentEffects.ts`. Direct URL navigation now works for all 11 sections.
- **Duplicate theme toggle** — Removed Lore's standalone theme toggle from `ViewSwitcher.tsx` when embedded in Platform (Platform shell handles theming).
- **Conductor duplicate color functions** — Extracted `statusColor`, `priorityColor`, `healthColor`, `levelColor` into shared `ConductorColors.swift`. Four views now delegate to the shared enum.
- **Hardcoded Conductor version** — `MainOverlayView` now reads `CFBundleShortVersionString` from bundle instead of hardcoded "v0.16.0".
- **String Identifiable hazard** — Moved global `String: @retroactive Identifiable` from `AgentNetworkView` to shared file, added `ThreadSelection` wrapper type.
- **Window mode not persisted** — `AppDelegate.useContainerMode` now uses `@AppStorage` so sidebar/container preference survives restarts.
- **CLI startup performance** — `initCommand` and `statusCommand` now lazy-loaded like all other commands, eliminating eager import of premise-core, purpose-core, portal-core, and ora.
- **Bundle sizes** — Added `treeshake: true` and `minify: true` to 5 tsup configs (paradigm-mcp, paradigm, university, sentinel, runtime).
- **Stale SKILL.md flags** — Fixed `--discipline` → `--stack` and `paradigm scan` → `paradigm scan auto` in init skill.
- **Stale university .purpose files** — Updated course count 5→7 (75 lessons), added PARA 701 entries, fixed PLSAT from 86→99 questions, 86→90 minutes, 80%→90% pass threshold across 3 .purpose files.

## [5.11.0] — 2026-03-24

### Added

- **Orchestration enforcement habits** — 3 new seed habits: `orchestration-required` (preflight, warn — suggests orchestration for complex tasks), `agent-coverage-validated` (postflight, advisory — verify agents with relevant expertise were consulted), `hot-mode-incident` (on-stop, advisory — incident response mode requires lore entry).
- **PARA 701: Agent Mastery** — New 10-lesson university course covering the full modern agent system: 54-agent roster, profiles, notebooks, state, rosters, model tiers, enforcement, Symphony visibility, learning loop, and pods/nevr.land.
- **Symbol debt cleanup** — Registered all new components from v5.6.3–5.10.1: #agent-state, #project-type, #roster, #model-resolution, #grid-preset, #help-view, #conductor-install, #nomination-surfacing, plus flows $orchestration-visibility, $agent-learning-loop, $roster-setup.

## [5.10.1] — 2026-03-24

### Fixed

- **System-level nomination surfacing** — Replaced hardcoded documentor-specific guidance in post-write hook with framework-level nomination awareness. Orchestrator now processes pending events and surfaces high-urgency nominations in both plan and execute responses. Any agent with matching attention patterns gets nominated — no agent names hardcoded in system code. Post-write hook points to `paradigm_ambient_nominations` instead of recommending a specific agent.

## [5.10.0] — 2026-03-24

### Added

- **Agent state system** — Per-project state at `.paradigm/agent-state/{id}.yaml` tracks last session summary, pending work, decisions, patterns learned, and session count. Global state at `~/.paradigm/agents/{id}/state.yaml` tracks career stats across all projects. State is injected into agent prompts so agents remember what they did last session.
- **Proactive documentor** — Post-write hook now recommends documentor at 5+ uncovered files. Documentor agent profile updated with `compliance-violation` signal attention and proactive coverage behavior.
- **Auto learning feedback** — Session work log verdicts (accepted/dismissed/revised) auto-adjust agent expertise confidence (+0.03 on accept, -0.02 on dismiss, -0.01 on revise). Expertise evolves through real usage, not just manual curation.
- **State-aware agent list** — `paradigm_agent_list` now includes last session summary, age, pending work count, and sessions-on-project from agent state.
- **Orchestration writes agent state** — Each agent that participates in orchestration gets their project state updated with session summary and touched symbols.

## [5.9.1] — 2026-03-24

### Added

- **Model tier resolution** — Agents now use capability tiers (`tier-1`, `tier-2`, `tier-3`) instead of hardcoded model names. Tiers resolve to actual models via `model-resolution` block in `.paradigm/config.yaml`. Claude Code auto-configures (opus/sonnet/haiku), Cursor defaults to sonnet/sonnet/haiku, other environments get sensible defaults.
- **Tier config in paradigm shift** — Step 2d auto-detects environment and configures model-resolution. Edit config.yaml to change all agent models in one place (e.g., all tier-2 to haiku for budget mode).
- **`resolveModelForAgent()`** — Orchestrator resolves agent → tier → config → model at runtime. Backward compatible with `defaultModel` field in agents.yaml.

## [5.9.0] — 2026-03-24

### Added

- **Live orchestration visibility via Symphony** — `paradigm_orchestrate_inline` execute mode now automatically writes Symphony messages to an orchestration thread (`thr-orch-*`). Maestro registers as a Symphony agent and emits "task assigned" notes for each agent stage. Agents are instructed to emit progress and completion notes. The full agent conversation is visible in Conductor's TeamThreadView in real-time.
- **Conductor TeamThreadView in container mode** — The monitor tab in the container sidebar now shows live orchestration threads when agents are working. Colored role badges, intent indicators, and symbol references render as agents communicate.

## [5.8.2] — 2026-03-24

### Added

- **Per-project agent roster** — New `.paradigm/roster.yaml` file controls which agents are active on each project. No roster = all agents available (backward compatible). Orchestrator only considers roster agents when planning. Bench/activate now modify the project roster instead of global `.agent` files.
- **Project type detection** — `paradigm shift` auto-detects project type (SaaS web app, web app, backend API, iOS app, game, etc.) from file signatures and suggests an appropriate agent roster.
- **Roster setup in paradigm shift** — Shift now creates `.paradigm/roster.yaml` with a suggested roster based on detected project type (e.g., 24 agents for SaaS, 11 for game, 8 for generic).
- **Agent list shows roster status** — `paradigm_agent_list` now shows active count, total available, and whether a roster is active.
- **Project-scoped notebook writes** — `paradigm_notebook_add` now defaults to project scope (`.paradigm/notebooks/`) instead of global when inside a project. Agent learning stays project-local.

## [5.8.1] — 2026-03-23

### Fixed

- **Checkpoint `modifiedFiles` crash** — `paradigm_agent_list`, `paradigm_ambient_neverland`, and other MCP tools crashed with `checkpoint.modifiedFiles.join is not a function` when a checkpoint file stored array fields as JSON strings instead of actual arrays. `loadCheckpoint()` now sanitizes `modifiedFiles`, `symbolsTouched`, and `decisions` on read, parsing JSON strings back to arrays.

## [5.7.0] — 2026-03-23

### Added

- **Conductor global install** — `paradigm conductor --install` builds and copies the native binary to `~/.paradigm/conductor/bin/`. Three-tier resolution: installed binary → monorepo dev binary → error with install instructions. `paradigm conductor` now works from any directory on the machine.
- **Auto-discover projects on launch** — Conductor scans `~/.paradigm/sessions/` on startup and populates the project list from `_project-meta.json` files. All projects with Paradigm session history appear automatically.
- **Resume/Open UX** — "Resume" button (when checkpoint exists) and "Open" button (when no checkpoint) launch an interactive Terminal.app session in the project directory. Claude auto-recovers context via `paradigm_session_recover`. "Headless" remains available for power users.
- **Instance linking UI** — Link mode in Sessions section: tap the link icon, select 2+ projects, confirm to create a Symphony agent group. Linked instances can message each other via Symphony relay.
- **In-app help system** — `?` button in both sidebar and container mode headers opens a 9-section guide: Overview, Sessions, Workspace, Linking, Symphony, Sentinel, Input, Shortcuts, and What's Rough. Documents capabilities, menus, keyboard shortcuts, and known limitations.
- **Sidebar + composable NxM grid layout** — ContainerView rewritten with collapsible left sidebar (Sessions/Monitor/Sentinel/Settings tabs) and explicit grid presets (1x1, 1x2, 2x1, 2x2, 3x1, 3x2) with mini visual icons in header. Replaces the TilingEngine binary-tree model with a simpler, user-controlled grid.
- **GridPreset system** — `WorkspaceGrid` now accepts explicit `GridPreset` with column/row counts alongside legacy auto-calculated mode. Presets are selectable from the container header bar.

## [5.6.3] — 2026-03-22

### Fixed

- **`paradigm shift` now creates default `portal.yaml`** — Doctor always failed on first run after project init because portal.yaml didn't exist. Shift now creates an empty-but-valid `portal.yaml` (version 1.0.0, empty gates/routes) alongside lore and university setup.

## [5.6.2] — 2026-03-21

### Fixed

- **BUG-1/2 actual fix: partial agent definitions in agents.yaml** — The 5.6.1 fix only handled missing agents (fallback via `||`). The real issue: agents.yaml in projects defines agents with `role` and `defaultModel` but no `focus` field. The `||` fallback doesn't fire because the agent object exists (it's truthy). Fix: always merge manifest fields with defaults instead of all-or-nothing fallback. Both `handleOrchestrateInline` execute mode and `handleAgentPrompt` now construct `AgentDefinition` by merging each field individually.

## [5.6.1] — 2026-03-21

### Fixed

- **BUG-1/2: orchestrate_inline execute mode + agent_prompt crash** — `Cannot read properties of undefined (reading 'reads')` when agent definition missing `focus` field. Now provides fallback `{ reads: ['**/*'], writes: ['**/*'] }` for agents not in manifest (e.g., documentor). Null-safe access in `buildAgentPromptInternal` and return value.
- **BUG-3: security misclassification** — Task classifier missed security-sensitive operations like "ownership transfer." Added 12 keywords: ownership, transfer, privilege, escalation, impersonation, takeover, rbac, acl, role, guard, session, csrf, xss, injection, sanitize.
- **BUG-4: gates_for_route empty suggestions for tRPC routes** — `calculateRouteSimilarity` only split on `/`, failing for dot-notation routes (`servers.transferOwnership`). Now splits on `.` for tRPC routes and does prefix matching — `servers.transferOwnership` correctly matches `servers.update` gates.
- **BUG-5: gates_for_route defaults to GET** — Now auto-detects tRPC routes (dot notation) and defaults to POST instead of GET.

## [5.6.0] — 2026-03-21

### Added

- **`/paradigm:agents` skill** — unified agent management: roster display, onboard missing agents (create + sync), bench/activate, show detail, install from `github:user/repo` or `@namespace/agent` (nevr.land).
- **`/paradigm:team` skill** — session team summary: who contributed, what was accepted/dismissed, learning results from session work log, health snapshot, recommendations.
- **`/paradigm:teach` skill** — teach an agent a new behavior by writing a high-confidence journal entry with pattern extraction, auto-promotes to notebook immediately.
- **`/paradigm:health` skill** — Neverland health dashboard: per-agent acceptance rates, thresholds, expertise, notebooks, progress visualization, actionable recommendations.
- **Plugin content hash cache invalidation** — `computePluginContentHash()` hashes plugin directory contents (skills, scripts, configs). Detects changes even when semver hasn't been bumped. `hasCacheStale` now triggers on content drift, not just version mismatch. Update notice shows hash diff.

## [5.5.0] — 2026-03-21

### Added

- **Maestro Teacher Model** — Top-down learning from full session context. Maestro observes agent contributions and user verdicts, then writes targeted journal entries with specific patterns. Replaces bottom-up mechanical threshold-only learning.
- **Session Work Log** — JSONL append log at `.paradigm/events/session-log.jsonl` captures agent contributions and user verdicts (accepted/dismissed/revised with reason) during each session. Maestro reads this at postflight.
- **Documentor Agent** — 6th core agent dedicated to Paradigm file maintenance. Always runs as final orchestration stage. Updates .purpose, portal.yaml, symbol registrations via MCP tools only. Other agents relieved of Paradigm compliance.
- **Maestro Learning Pass** — Postflight Step 8b rewritten: reads session work log, writes targeted journal entries per agent (human_feedback for accepted, correction_received for dismissed/revised). Extracts patterns for notebook promotion.
- **Nomination reason storage** — `Nomination.reason` field stored on engage, not just debate resolution. Enables learning from dismiss reasons.
- **Stale nomination expiry** — Pending nominations >7 days excluded from `getNominationStats` and `adjustAttentionFromFeedback`. Unblocks learning for agents with old stale nominations.
- **Journal auto-promote expanded** — `autoPromoteJournalEntries` now promotes both `pattern_discovered` and `human_feedback` journal entries to notebooks.
- **Orchestration guidance rewrite** — `paradigm://guidance/orchestration` fully documents Maestro model: attributed responses, ambient context, learning loop, bench/activate, documentor, Neverland test.
- **University** — PARA 601 lesson extended with Teacher Model, session work log, documentor sections + 2 new quiz questions (11 concepts, 7 questions total).

## [5.4.0] — 2026-03-21

### Added

- **Maestro Phase 1: Visible Team Orchestration** — `paradigm_orchestrate_inline` and `paradigm_agent_prompt` inject full ambient context (decisions, journal insights, nominations) into agent profiles before spawning. Attribution prefix (`[nickname (role)]`) on every response. Symphony team thread recording (`thr-orch-*`) for Conductor visibility.
- **Maestro Phase 2: Conductor Views** — `TeamThreadView.swift` (chat-style orchestration thread with colored role prefixes, intent badges, code diffs, decision highlights), `AgentRosterView.swift` (active/benched sections with acceptance rates and bench toggles), `SymphonyThreadWatcher.swift` (3s poll for thr-orch-* threads).
- **Maestro Phase 3: Agent Roster + Bench** — `AgentProfile.benched` field; orchestration and nomination engine skip benched agents. MCP: `paradigm_agent_bench` / `paradigm_agent_activate`. CLI: `paradigm agent roster/bench/activate`. Agent list now returns nickname, bench status, threshold.
- **Maestro Phase 4: Platform Team Dashboard** — New Team section in `paradigm serve` web dashboard. `TeamSection.tsx` with agent roster grid + thread viewer. `teamStore.ts` (Zustand). REST API: `/api/team/roster`, `/api/team/threads`, `/api/team/agents/:id/bench`. Always-on section.
- **Maestro Phase 5: Neverland Validation** — `getNeverlandMetrics()` aggregates acceptance rates, threshold drift, expertise growth, notebook counts, cross-project transfer. Health classifier: cold-start → accumulating → calibrating → mature. `paradigm_ambient_neverland` MCP tool.
- **Agent nickname support** — `AgentProfile.nickname` optional field for personalized attribution.
- **Postflight learning loop** — Step 8b: `paradigm_ambient_learn` + `paradigm_ambient_promote` for each contributing agent.
- **Handoff agent summary** — Step 3b: agent contributions, threshold adjustments, promotions.
- **University** — PARA 601 lesson: "Maestro: Visible Team Orchestration" with 8 key concepts, 5 quiz questions.

### Changed

- **Orchestration context injection** — `buildProfileEnrichment()` `ambientContext` parameter now populated in both orchestration paths. Previously existed but was always empty.
- **Execution instructions** — Emphasize attributed presentation and stage reconciliation over synthesized summaries.

## [5.3.2] — 2026-03-20

### Fixed

- **Post-write hook cwd** — Hook was silently exiting because `$(pwd)` wasn't the project root in plugin context. Now extracts `cwd` from JSON input (same pattern as stop hook). File edits via Edit/Write tools now emit `file-modified` events.
- **Weighted attention scoring** — Replaced max-based scoring (always 1.0) with weighted dimensions: primary 0.5, secondary 0.2, tertiary+quaternary 0.15 each. Creates actual relevance gradient.
- **Nomination deduplication** — Same agent + identical brief within 30-second window is now skipped. Prevents nomination spam from rapid sequential tool calls.
- **Agent creation defaults** — `createAgentProfile` now populates `attention`, `collaboration` from `DEFAULT_ATTENTION` and `DEFAULT_COLLABORATION`. New agents are ambient-capable from creation.
- **Signal coverage gaps** — All 5 default agents now have appropriate signal subscriptions. Previously architect/builder/reviewer had zero signals — compliance-violation, file-modified, error-encountered events went unnoticed.
- **Plugin version** — Bumped from 3.45.0 to 5.3.0 to invalidate stale caches missing event emission hooks.

### Changed

- **DEFAULT_ATTENTION expanded** — architect: +flow-modified, +compliance-violation. builder: +file-modified, +error-encountered. reviewer: +compliance-violation. tester: +test-result. security: +gate-checked, +compliance-violation.

## [5.3.0] — 2026-03-20

### Added

- **Symphony nomination relay** — Nominations now forward to remote machines via Symphony outbox files. Relay handles `nomination_forward` frame type with dedup, local storage, and peer relay in server mode.
- **Graduation ambient candidates** — `checkAmbientGraduationCandidates` identifies agents with >80% accept rate over 10+ nominations as candidates for graduating nomination patterns to automated hooks.
- **Journal-to-notebook auto-promotion** — `autoPromoteJournalEntries` scans journal for `pattern_discovered` entries with confidence >= 0.8, promotes to notebook, marks journal entries as promoted. Exposed via `paradigm_ambient_promote` MCP tool.
- **Surfacing config** — `.paradigm/surfacing.yaml` controls per-agent nomination surfacing: `min_urgency`, `always_show`, `mute_unless`, `batch`, `enable_debates`. `applySurfacingRules` filters nominations before returning from `paradigm_ambient_nominations`.
- **Platform SSE hook** — Ambient store `connectSSE()` establishes `EventSource` connection to `/api/ambient/stream` for real-time event updates. Component uses SSE for events, polls only for nominations.
- **Expanded event emission** — 4 new emission points: `paradigm_reindex` (work-completed), `paradigm_persona_run` (work-completed), `paradigm_protocol_record` (work-completed), `paradigm_sentinel_record` (error-encountered with severity). Total: 9 emission points.

### Changed

- **Ambient nominations filtered by surfacing config** — `paradigm_ambient_nominations` loads surfacing rules and applies per-agent preferences before returning results.
- **Ambient tools count** — 5 → 7 MCP tools (added `paradigm_ambient_promote`, `paradigm_ambient_learn`).

## [5.2.0] — 2026-03-20

### Added

- **Platform Ambient section** — Full browser UI for ambient coordination: event stream (live list with type badges, relative timestamps, symbol pills), nominations panel (urgency-sorted with accept/dismiss), debates grouping, 3 stat cards, 10-second auto-refresh. CSS uses platform theme variables with responsive breakpoints.
- **Platform ambient API routes** — 5 REST endpoints: `GET /api/ambient/events` (filtered query), `GET /api/ambient/nominations` (pending with debates), `POST /api/ambient/nominations/:id/engage` (accept/dismiss/defer with WebSocket broadcast), `GET /api/ambient/stream` (SSE with incremental byte reads), `GET /api/ambient/policy` (data-policy.yaml or defaults).
- **Cross-session nomination surfacing** — Recovery preamble now includes critical/high pending nominations from the ambient system, surfaced automatically on first tool call of a new session.
- **Learning feedback loop** — `adjustAttentionFromFeedback` analyzes nomination engagement history: >60% dismissed → raise threshold (less noise), >80% accepted → lower threshold (contribute more). `getNominationStats` provides per-agent engagement metrics.
- **`paradigm_ambient_learn` MCP tool** — Analyze and adjust an agent's attention threshold from nomination feedback. Supports dry-run mode for preview without modification.
- **Substantive nomination briefs** — `generateBrief` now produces role-aware, event-contextual summaries instead of mechanical match descriptions (e.g., "Security agent: New route needs gate assignment" vs "symbol match on ^auth").

### Changed

- **Ambient section always enabled** — Added to the `always` array in platform server section resolver alongside overview, lore, graph, git.
- **Recovery preamble** — Extended with ambient nominations section (critical/high urgency, max 5).

## [5.1.0] — 2026-03-20

### Added

- **Nomination Engine** — `nomination-engine.ts`: processes events into agent nominations and debates. Core loop: event → attention scoring → nomination generation → debate detection → surfacing. Storage in `.paradigm/events/nominations.jsonl` (bounded at 500) and `debates.jsonl` (bounded at 200).
- **`emitAndProcess` unified emitter** — Replaces bare `emitEvent` calls with policy check → event emission → nomination processing in one shot. All 5 existing emission points in `tools/index.ts` now use this.
- **4 ambient MCP tools** — `paradigm_ambient_nominations` (get pending nominations, marks as surfaced), `paradigm_ambient_events` (query event stream with relative time filters like "1h"), `paradigm_ambient_engage` (accept/dismiss/defer nominations, resolve debates), `paradigm_context_compose` (compose full agent session context with profile + decisions + journal + nominations).
- **Data policy enforcement on knowledge streams** — Work log summaries, journal insights, and decision content are now filtered through `filterContent()` with stream-specific redaction before recording. Secrets matching `data-policy.yaml` patterns are redacted.
- **`paradigm event emit` CLI command** — Fire-and-forget event emission for hook integration (~100ms). Writes directly to `stream.jsonl` with no nomination processing (deferred to next MCP tool call).
- **Hook event integration** — Stop hook emits `compliance-violation` events with severity on failure. Post-write hook emits `file-modified` events. Both fire-and-forget with `&`.
- **Agent contributions in CLAUDE.md** — `generate()` now includes an "Agent Contributions" section with high-priority context contributions from loaded `.agent` profiles.
- **`agents` field on `ParadigmFiles`** — IDE adapter types extended with agent profile data. `loadParadigmFiles()` loads `.paradigm/agents/*.agent` profiles.
- **Extended `buildProfileEnrichment`** — Accepts optional `ambientContext` param with recent decisions, journal insights, and pending nominations. Appends 3 new sections to enrichment output.
- **PARA 601: Paradigm Ambient** — 8-lesson university course covering learning loop, knowledge streams, event stream, attention scoring, nominations/debates, data sovereignty, agent manifest renaissance, and context composition.
- **16 PLSAT slots (113-128)** — New assessment items for PARA 601 covering knowledge stream classification, attention scoring, trust rings, CLAUDE.md content audit, nomination urgency, data policy enforcement, event anatomy, context composition, and the learning loop.
- **Ambient reference cards** — 6 new reference cards (event stream, attention scoring, nominations, knowledge streams, trust rings, data policy) plus 7 new tool cards for ambient and stream tools.

### Changed

- **Event emission → nomination processing** — All `emitEvent` calls in tool dispatch replaced with `emitAndProcess` from nomination engine, activating the full ambient pipeline.
- **Knowledge stream recording** — `paradigm_work_log_record`, `paradigm_journal_record`, `paradigm_decision_record` now apply data policy content filtering before persisting.

## [5.0.0] — 2026-03-19

### Added

- **Agent Learning Loop architecture** — Closes the observation→adaptation gap. Paradigm now has types and infrastructure for agents to learn from experience and adapt behavior across sessions.
- **Slim CLAUDE.md** — Generator rewritten to produce ~150 lines (down from ~856). Core identity, session lifecycle, hooks enforcement, and authoring rules stay inline. Everything else moves to on-demand MCP resources.
- **`paradigm://guidance/{topic}` MCP resources** — 12 on-demand guidance topics (logging, portal, mcp-workflow, flows, orchestration, workspaces, university, calibration, checkpoints, navigation, component-types, troubleshooting) served via MCP instead of baked into CLAUDE.md.
- **Agent manifest renaissance** — `AgentProfile` extended with 6 new dimensions: `attention` (ambient relevance filtering), `learning` (dual-layer intrinsic + platform), `context` (composed contributions), `reporting` (work log + learning journal), `collaboration` (inter-agent stances), `nomination` (self-selection in ambient mode). Includes `DEFAULT_ATTENTION` and `DEFAULT_COLLABORATION` for all 5 standard agents.
- **Knowledge streams types** — Lore split into three streams: `WorkLogEntry` (project-scoped, ephemeral), `JournalEntry` (agent-private, durable), `TeamDecision` (project-scoped, institutional). Includes `KnowledgeStream` type, stream classification, lore-to-stream migration mapping, and per-stream filters.
- **`stream` field on LoreEntry** — All 4 duplicated `LoreEntry` interfaces gain `stream?: KnowledgeStream` for forward-compatible classification. `LoreFilter` gains `stream` filter.
- **Ambient coordination types** — `StreamEvent`, `AttentionScore`, `Nomination`, `Debate`, `SurfacingConfig`, `EventStreamConfig` — the primitives for agents to observe a shared event stream and self-nominate contributions.
- **Data sovereignty types** — `DataPolicy`, `TrustRing` (4 concentric rings), `ObservationRules`, `StreamContentRules`, `UpstreamRules`, `EnforcementResult`, `AuditEntry` — framework for controlling what data agents can observe, record, and transmit. `DEFAULT_DATA_POLICY` provides secure defaults (project-locked, upstream denied code/paths/identity).
- **Knowledge stream loaders** — Full CRUD for all three streams: `work-log-loader.ts` (date-partitioned YAML in `.paradigm/work-log/{date}/`), `journal-loader.ts` (agent-private YAML in `~/.paradigm/agents/{id}/journal/`), `decision-loader.ts` (institutional YAML in `.paradigm/decisions/`). Each provides record, search, and summary functions.
- **6 knowledge stream MCP tools** — `paradigm_work_log_record`, `paradigm_work_log_search`, `paradigm_journal_record`, `paradigm_journal_search`, `paradigm_decision_record`, `paradigm_decision_search`. Full filter support, summary mode, and cross-agent journal search.
- **Event stream engine** — `event-stream.ts` with `emitEvent`, `queryEvents`, `scoreEventForAgent`. JSONL append-only storage in `.paradigm/events/stream.jsonl` with automatic pruning at 1000 events. Attention scoring evaluates 4 dimensions (symbol, path, concept, signal match) against `AgentAttention` patterns.
- **Data policy loader** — `data-policy-loader.ts` reads `.paradigm/data-policy.yaml`, merges user policy over `DEFAULT_DATA_POLICY` (deny lists are additive), provides `canObservePath`, `filterContent`, `isRingAllowed`, and `enforce` functions across 4 enforcement boundaries.
- **Stream auto-classification on `paradigm_lore_record`** — New `stream` parameter (`work-log | journal | decision | auto`). When specified, the lore entry is recorded as before AND automatically routed to the appropriate knowledge stream. `auto` classifies based on content heuristics (task_ref → work-log, learnings → journal, decisions → decision).
- **Ambient event emission** — 5 tool dispatch points now emit events to the stream: `paradigm_gates_for_route` (gate-checked), purpose/portal add tools (file-modified), `paradigm_lore_record` (work-completed), stream record tools (work-completed/decision-made). All wrapped in try/catch for non-fatal emission.
- **Agent enrichment with renaissance fields** — `buildProfileEnrichment` now includes attention patterns, collaboration stance, and nomination preferences in agent prompt enrichment for orchestration.

### Changed

- **CLAUDE.md output** — 82% reduction in base context tokens. Portal protocol, logging tables, MCP workflow tables, token budgets, flow development, orchestration, workspaces, university, calibration, checkpoints, troubleshooting, and navigation recipes all moved to `paradigm://guidance/` resources.
- **claude.ts imports** — Trimmed from 8 base.ts imports to 2 (`generateConventions`, `generateCommitConvention`).

Symbols: #claude-adapter, #GuidanceResources, #AgentTypes, #AmbientTypes, #KnowledgeStreamTypes, #DataPolicyTypes, #lore-types, #event-stream, #data-policy-loader, #work-log-loader, #journal-loader, #decision-loader, #StreamsTools

## [4.16.5] — 2026-03-19

### Changed

- **PLSAT pass threshold** — Raised from 80% to 90% across all exam data (v2.0, v3.0), site pages (learn, PLSAT), and README.
- **University seal** — Site learn and PLSAT pages now use the full university seal (laurel wreath, open book, Latin text arcs) matching the served platform, via shared `UniversitySeal` component.
- **PLSAT coverage cards** — Stacked single-column layout instead of 4-column grid.

### Fixed

- **`paradigm university serve`** — Fixed broken path resolution for bundled UI and content assets. The serve command used `../university-ui` (parent of dist) instead of `./university-ui` (inside dist), causing 404 on all pages.

Symbols: #UniversitySeal, #PLSATPage, #LearnPage, #university-server

## [4.16.4] — 2026-03-19

### Changed

- **Site polish pass** — Widened hero content (860px), symbols subheading (680px), and CTA section (860px) so headlines and subtitles fit on fewer lines.
- **Animated gradient** — Hero gradient text drifts through all 5 symbol colors on a 10s ease-in-out cycle.
- **Symbol cards** — 5-column single-row layout with equal-height cards, simplified descriptions.
- **Copy tweaks** — Setup time `<2min` → `<1min`, removed "for individual developers" from CTA, updated install time to "under one minute".
- **Footer "Built by"** — A Company logo (18px) links to a-company.org, replaces plain text.
- **Getting started scenarios** — Replaced manual `.purpose` tutorial with two agent-driven scenarios: "Starting a New Project" (plan with symbols) and "Mapping an Existing Codebase" (retroactive discovery), each with copy-pasteable prompts.

Symbols: #HeroSection, #SymbolsSection, #CTASection, #SiteFooter, #MetricsSection

## [4.16.3] — 2026-03-19

### Changed

- **Hero terminal scripts → Claude Code agentic loops** — Replaced 4 generic paradigm-command scenarios with 3 realistic Claude Code sessions: "New App" (user prompt → plan → scaffold), "Resume Session" (checkpoint recovery → drift detection → auto-heal), "Symphony Collab" (two agents on related Linear tickets messaging via Symphony).
- **Dual terminal pane** — Symphony scenario renders two stacked terminal panes with independent typewriter states, thin divider, and "symphony" chrome label.
- **`input` line style** — 6th terminal line style for user-typed prompts (bright white, font-weight 500). User prompts now start with `>` and visually stand out as the human voice.

Symbols: #LiveGraph, #FauxTerminal, #HeroSection

## [4.16.2] — 2026-03-18

### Added

- **Hero scenario rotation** — 4 project scenarios (E-Commerce, SaaS Platform, API Backend, Mobile App) cycle every ~19.5s with distinct node labels, types, and terminal scripts.
- **Growth animation** — Nodes spring in one-by-one from a seed following a `growthOrder` array with back-ease-out overshoot. Edges draw as both endpoints appear. ~4s growth phase per scenario.
- **Dissolve transition** — Nodes and edges shrink/fade with ease-in quadratic over 1.5s before the next scenario grows.
- **Faux terminal overlay** — macOS-style window chrome with typewriter effect, synced to growth progress via shared ref. 5 line styles (command, output, thought, success, dimmed). Hidden on mobile (<768px). Backdrop blur with semi-transparent background.
- **Phase state machine** — `growing (4s) → active (14s) → dissolving (1.5s) → next scenario` loop in LiveGraph canvas, with `onPhaseChange` callback for external sync.

Symbols: #LiveGraph, #FauxTerminal, #HeroSection

## [4.16.1] — 2026-03-18

### Added

- **Light/dark mode toggle** — Sun/moon icon in the site header. Persists to localStorage with a blocking script to prevent flash of wrong theme on load. Dark mode remains the default.
- **Light theme tokens** — Full inverted palette in `obsidian.css` with adjusted symbol colors for contrast on white backgrounds.

### Fixed

- **Academia dark mode** — University section was applying light-mode palette (dark brown text on dark background) because the CSS required `data-theme="auto"` which was never set. Reworked `academia.css` to default to dark with light gated behind `data-theme="light"`.
- **Header in light mode** — Hardcoded `rgba(17, 17, 19, 0.8)` background replaced with `color-mix(in srgb, var(--surface-1) 85%, transparent)` so the translucent glass effect adapts to theme.
- **CTA button text** — "Get Started" button text now uses `#fff` instead of `--surface-void` which inverts in light mode.

Symbols: #ThemeToggle, #SiteHeader, #ObsidianTheme, #AcademiaTheme

## [4.16.0] — 2026-03-18

### Added

- **Docs breadcrumb navigation** — Breadcrumb trail above all docs content pages, auto-built from URL slug segments.
- **Docs sidebar filter** — Text input in DocsSidebar for live filtering sidebar items by label match. Sections with no matches are hidden; active filter disables collapse.
- **4 new documentation pages** — CLI Reference, Flows, MCP Tools Reference, and Portal & Gates handwritten markdown guides at `/docs/cli-reference`, `/docs/flows`, `/docs/mcp-tools`, `/docs/portal-and-gates`.
- **Course system** — `CourseDataLoader` reads university + extracurricular course JSON at build time. Dynamic course overview pages with syllabus at `/learn/course/[courseId]`. Lesson pages with markdown rendering, key concepts, inline quiz display, and prev/next navigation at `/learn/course/[courseId]/lesson/[lessonId]`.
- **PLSAT certification page** — Landing page at `/learn/plsat` with exam details, coverage grid, preparation guide, and CLI launch instructions.
- **2 extracurricular courses** — Git Fundamentals (6 lessons) and Agile Development (6 lessons) with quizzes, served from `packages/site/src/content/courses/`.
- **Learn page updates** — Course catalog split into Core Curriculum and Extracurricular sections.

### Changed

- **ContentPage code blocks** — Code blocks with a language specifier now render a header bar showing the language label. Plain code blocks remain unstyled.
- **Learn page** — Updated lesson counts and added PLSAT section with direct link.

### Fixed

- **Platform server SPA fallback** — API routes (`/api/*`) now pass through to `next()` instead of being caught by the SPA fallback and served `index.html`.
- **Docs content accuracy** — flows.md: corrected non-existent `paradigm flow validate` CLI to `paradigm flow diagram`; noted flows can live in `.paradigm/flows.yaml` or `.purpose` files. mcp-tools.md: corrected tool count from 50+ to 90+. portal-and-gates.md: documented optional gate fields (`type`, `location`, `prizes`).

Symbols: #DocsBreadcrumbs, #DocsSidebarFilter, #CourseDataLoader, #CoursePage, #LessonPage, #PlsatPage, #DocsContentPage, #DocsSidebar, #platform-server

## [4.15.1] — 2026-03-17

### Fixed

- **Conductor .purpose YAML error** — Quoted context line containing embedded `overlay: Workspace` colon that broke YAML parsing (line 57). All 53 .purpose files now validate clean.
- **3 stale protocols refreshed** — `P-add-hook-script`, `P-add-ide-adapter`, `P-update-changelog` re-verified after exemplar modifications.

Symbols: #conductor-app

## [4.15.0] — 2026-03-17

### Added

- **Completion confirmation** — Agent spawner now validates relay output before accepting `success` status. Builders that wrote no files are downgraded to `partial`; any agent with no artifacts, decisions, handoff, or file writes is flagged. Adds `completionVerified` field to `AgentRelay` for observability. Inspired by Open SWE's anti-premature-termination pattern.
- **External ID on session checkpoints** — `SessionCheckpoint` and `paradigm_session_checkpoint` MCP tool now accept optional `externalId` field for deterministic session recovery from external sources (e.g. `"linear:PROJ-123"`, `"github:owner/repo#42"`).
- **Stop hook auto-fix mode** — Set `PARADIGM_AUTO_FIX=1` to auto-fix trivial violations: creates stub `.purpose` files (checks 2 & 9) and stub lore entries (check 7). Reports all auto-fixes taken; real violations still block. All 3 stop hooks (Claude Code, Cursor, `.cursor/hooks/`) updated.

Symbols: #agent-spawner, #agent-provider, #session-tracker, #paradigm-hooks, #paradigm-session-checkpoint

## [4.14.2] — 2026-03-17

### Fixed

- **YAML parser consolidation** — Switched portal/watch.ts from `yaml` package to `js-yaml`. Paradigm CLI now uses js-yaml exclusively.
- **Grep shell quoting** — Portal compliance used `execSync` with regex patterns that broke shell parsing (`syntax error near unexpected token '('`). Switched to `execFileSync` to avoid shell; prefers ripgrep (rg) when available for speed.
- **Instruction vagueness** — Generators (claude.ts, base.ts, cursor.ts): "Avoid if possible" → "Prefer MCP; use sparingly"; "Plan a stopping point" → "Plan handoff; prepare summary when ready". Context-audit: exclude `consider-handoff` from vague-phrase check.

### Changed

- **Portal compliance messaging** — Split "declared but unused" into route-attached (documented on routes, no code) vs orphan (gates section only). Clearer suggestions for each.
- **Instruction files** — CLAUDE.md and AGENTS.md updated with non-vague wording.

Symbols: #doctor, #portal-compliance, #config-schema, #context-audit, #portal-watch

## [4.14.1] — 2026-03-17

### Fixed

- **Doctor: YAML parsing** — Switched doctor from `yaml` package to `js-yaml` (matches rest of codebase). Resolves "Dynamic require of process" errors when validating portal.yaml, flows.yaml, and habits.yaml.
- **Doctor: config schema** — Added `docs` and `features` to KNOWN_TOP_LEVEL_KEYS in config-schema.ts.
- **Doctor: stale-reference heuristic** — Tightened context-audit to skip parameter lists (e.g. `type/tag/symbol`, `approve/deny`) — require file extension, leading dot, or common path prefix.

### Changed

- **Instruction files** — Fixed 41 stale path references in CLAUDE.md and AGENTS.md (example paths, missing .paradigm/ prefix).
- **Fixtures** — Created `.paradigm/fixtures.yaml` from standard template.

### Added

- **Lore** — Recorded agent-session entry (Composer 1.5) with cleanup summary and Paradigm framework reflection.

Symbols: #doctor, #config-schema, #context-audit

## [4.14.0] — 2026-03-17

### Added

- **Conductor Sprint 20: Polish + Cell Footer + Tiling Tests (v1.0.0)** — 2 new Swift files, 2 modified.
  - `CellFooterView.swift` — Per-cell status footer: symbol tags (purple, max 3), file modification count, agent status dot.
  - `TilingEngineTests.swift` — 16 tests: cell count (single/split/nested), frame computation (fills area, horizontal/vertical split totals), preset generation (focused/grid/triple/padding), cell operations (split/remove/swap), ratio update/clamping, divider count.
  - `CellChromeView` gains footer integration, border pulse animation for processing cells (easeInOut 1.2s repeat), dynamic border width for blocked/gaze states.
  - Conductor bumped to **v1.0.0** — workspace container feature-complete.

### Changed

- Test count: 160 → 176 (16 new TilingEngine tests).

Symbols: #cell-footer, #tiling-engine

## [4.13.0] — 2026-03-17

### Added

- **Conductor Sprint 19: Control Panel + Status Bar** — 2 new Swift files, 3 modified.
  - `ControlPanelContainer.swift` — Collapsible 320px overlay panel with 4 tabs: Workspace (session manager + project launch), Orchestrate (task dashboard + agent groups), Monitor (Sentinel live + agent health), Settings (workspace config + Sentinel status).
  - `StatusBarView.swift` — Bottom bar with clickable sections (tasks, Sentinel, health) that open the corresponding control panel tab. Keyboard shortcut hints.
  - `ContainerView` integrates both: control panel as ZStack overlay, status bar replaces inline implementation. Clicking status bar sections opens panel to relevant tab.
  - `AppDelegate` passes full dependency set (projectStore, agentProcessManager, agentGroupStore, symphonyMonitor) to ContainerView.

Symbols: #control-panel-container, #status-bar

## [4.12.0] — 2026-03-17

### Added

- **Conductor Sprint 18: Drag-to-Resize + Presets + Cell Interactions** — 3 new Swift files, 2 modified.
  - `DividerHandle.swift` — Draggable resize handles between cells. Snap at 25/33/50/67/75% with visual feedback. Cursor changes (↔/↕) on hover. Smooth drag with 2px minimum distance.
  - `LayoutPresetsView.swift` — Horizontal preset strip with mini layout diagram icons for each of 6 presets. Active state highlighting with ⌘ shortcut labels.
  - `CellActionMenu.swift` — Context menu for cells: split horizontal/vertical, maximize/restore, close. `EmptyCellView` placeholder with launch button for empty cells.
  - `ContainerView` enhanced: divider drag wiring with ratio-to-pixel conversion, maximize/restore toggle (saves/restores layout tree), animated layout transitions (`easeInOut 0.2-0.25s`), preset strip in header.

Symbols: #divider-handle, #layout-presets, #cell-action-menu

## [4.11.0] — 2026-03-17

### Added

- **Conductor Sprint 17: Container Window + Tiling Engine** — 4 new Swift files, 3 modified.
  - `TilingEngine.swift` — Binary split tree layout engine (`TileNode`, `SplitState`, `CellState`). Recursive frame computation, 6 layout presets (Focused/Split/Main+Side/Grid/Triple/Columns), cell split/remove/swap/ratio operations.
  - `ContainerWindow.swift` — `NSWindow` subclass replacing `NSPanel` for container mode. Full-screen capable, `.fullSizeContentView` style, 800×600 minimum.
  - `ContainerView.swift` — Root SwiftUI view: header bar with preset menu, tiling area with cell chrome overlays, status bar with task/sentinel/health indicators.
  - `CellChromeView.swift` — Per-cell overlay: project label, status badge (idle/implementing/blocked/processing), split/maximize/close action buttons, gaze-targeted border.
  - `AppDelegate` gains `useContainerMode` flag, `launchContainer()`, menu bar "Switch to Container/Sidebar Mode" items.
  - Conductor bumped to v0.16.0.

Symbols: #tiling-engine, #container-window, #container-view, #cell-chrome, $workspace-layout

## [4.10.0] — 2026-03-17

### Added

- **Smart Drift Detection Phase 3: Content Fingerprint Search** — 1 new file, 2 modified.
  - `aspect-fingerprint.ts` (~320 lines) — Levenshtein distance, sliding window search, structural hashing, cross-file rename detection, sibling file search.
  - 4-signal scoring: first/last line match (0.4), structural hash (0.3), Levenshtein similarity ≥0.8 (0.2), line count ±20% (0.1).
  - Thresholds: ≥0.85 auto-relocate, 0.7-0.85 suggest, <0.7 real drift.
  - Cross-file search: `git log --follow --diff-filter=R` for renames, sibling directory scan (max 10 files).
  - Schema migration: `original_content` column on anchors table, `anchor_history` table for audit trail.
  - `materializeAspects()` now stores normalized content snapshot for each anchor at materialization time.
  - `checkDrift()` Layer 3: after Layers 1-2 fail, searches for relocated content via fingerprint, auto-heals ≥0.85 matches, records history.

### Changed

- `computeAnchorHash()` now returns `normalizedContent` alongside hashes for Phase 3 storage.
- `AnchorRow` type gains `original_content: string | null` field.
- `DriftResult` type gains `suggestedPath` field for cross-file relocations.

Symbols: #aspect-fingerprint, $content-search-flow

## [4.9.0] — 2026-03-17

### Added

- **Site Content & Polish** — docs guides, course pages, PLSAT landing, and docs UX improvements.

  **Docs Content Depth** — 4 new handwritten guide pages:
  - Portal & Gates — portal.yaml structure, gate patterns, route mapping
  - Flows — flow definition, step types, validation, visualization
  - CLI Reference — complete command reference organized by category
  - MCP Tools Reference — all 50+ tools with token budget estimates

  **Docs Polish** — 3 UX improvements:
  - Breadcrumbs on all docs pages (Docs > Components > PaymentService)
  - Client-side search input in sidebar with instant filtering
  - Code block language badges (yaml, bash, typescript labels)

  **Learn Section — Dynamic Course Pages**:
  - `/learn/course/[courseId]` — course detail with numbered syllabus
  - `/learn/course/[courseId]/lesson/[lessonId]` — full lesson content with markdown, key concepts, quiz questions, and prev/next navigation
  - `course-data.ts` — server-side loader reading from university + site content packages
  - 68 lesson pages pre-rendered at build time across 7 courses

  **PLSAT Landing Page** (`/learn/plsat`):
  - Exam overview: 99 questions, 90 minutes, 80% pass threshold
  - Coverage grid showing 5 PARA course domains
  - Preparation guide and CLI launch instructions
  - Updated learn page: v3.0 stats (99 questions, 80% pass)

  **Project Health** — all doctor recommendations resolved:
  - 330 untyped components → 0 untyped (types added across 16 .purpose files)
  - 10 stale protocols → 0 stale (all 37 refreshed)
  - 2 YAML errors in conductor .purpose files fixed (unquoted colons + !signals)
  - .purpose files added for all new docs directories
  - Scan index rebuilt: 942 symbols, 0 untyped

  **1276 static pages** generated at site build time (up from 983).

Symbols: #DocsSidebar, #SymbolPage, #FlowPage, #PortalPage, #ContentPage, #course-data

## [4.8.0] — 2026-03-17

### Added

- **Personas CLI** — 7 commands closing the CLI gap (11 MCP tools existed, 0 CLI).
  - `paradigm persona list` — List all personas with `--tag`, `--trigger`, `--gate` filters.
  - `paradigm persona show <id>` — Full detail: traits, fixtures, journey steps with gates/routes/produces/spawns.
  - `paradigm persona validate [<id>]` — Schema validation + cross-refs (gates vs portal.yaml, spawn targets).
  - `paradigm persona coverage` — Coverage report from persona index (gate/route coverage, uncovered routes).
  - `paradigm persona run <id> --base-url <url>` — Execute journey against running server with template interpolation. `--dry-run` mode.
  - `paradigm persona affected <symbol>` — Which personas reference a gate, flow, or signal.
  - `paradigm persona delete <id>` — Delete with spawn-chain warnings.

Symbols: #persona-cli

## [4.7.0] — 2026-03-17

### Added

- **Paradigm Docs — Auto-Generated Documentation from the Symbol Graph** — 40+ new files across 7 phases.

  **Phase 0: University Extracurricular System**
  - `track`, `excludeFromOnboarding`, `validationStrictness` fields on `UniversityContentCategory`
  - `category` field on `UniversityFrontmatter`, `UniversityQuiz`, `LearningPath`, `UniversityIndexEntry`, `UniversityFilter`
  - `paradigm_university_search` gains `category` and `track` filter params
  - `paradigm_university_create` and `update` gain `category` param
  - `paradigm_university_onboard` response includes `extracurricular` suggestions array
  - `.paradigm/university/config.yaml` seeded with 4 categories (paradigm-core, paradigm-advanced, extracurricular, paradigm-docs)
  - Site `/learn` page migrated from `nonCredit` to `category: 'extracurricular'` with visual grouping

  **Phase 1: Docs Data Layer**
  - `docs-loader.ts` — reads scan-index, flow-index, portal.yaml, university, and custom markdown pages
  - `types/docs.ts` — `DocsManifest`, `SymbolPageData`, `FlowPageData`, `PortalPageData`, `CustomPageData`, `SearchResult`
  - Sidebar manifest with auto-grouped components by type, flows, gates, signals, aspects, portal
  - Full-text search with relevance scoring across symbols, descriptions, tags, and custom pages
  - `docs` config section in `.paradigm/config.yaml` (enabled, title, theme, exclude, sidebar, output)

  **Phase 2: MCP Tools + Platform API**
  - 3 new MCP tools: `paradigm_docs_manifest`, `paradigm_docs_page`, `paradigm_docs_search`
  - 6 REST endpoints: `/api/docs/manifest`, `/api/docs/symbol/:id`, `/api/docs/flow/:id`, `/api/docs/portal`, `/api/docs/page/:slug`, `/api/docs/search`

  **Phase 3: Platform UI Docs Section**
  - New "docs" section in Platform with `☰` sidebar icon
  - Two-pane layout: 260px collapsible sidebar + scrollable content area
  - 10 components: `DocsSidebar`, `DocsSymbolPage`, `DocsFlowPage`, `DocsPortalPage`, `DocsCustomPage`, `DocsSearch`, `SymbolLink`, `PropertyTable`, `FlowSteps`, `GateChain`
  - Zustand store with manifest, page selection, search, and sidebar collapse state
  - Symbol-colored prefixes (#, $, ^, !, ~) and cross-reference navigation

  **Phase 4: CLI Commands**
  - `paradigm docs serve` — launches Platform with docs section (port 3850, opens browser)
  - `paradigm docs build` — static export with pre-fetched JSON data for all pages

  **Phase 5: Site Integration (useparadigm.dev)**
  - `docs-data.ts` — server-side data layer reading scan-index at Next.js build time
  - Dynamic `[[...slug]]` route with `generateStaticParams` pre-rendering 975+ pages
  - 6 site components: `DocsSidebar`, `SymbolPage`, `FlowPage`, `PortalPage`, `CategoryListPage`, `ContentPage`
  - 3 handwritten guides: Getting Started, The Five Symbols, Purpose Files

  **Phase 6: University Content**
  - `N-paradigm-docs-overview` — note covering data sources, CLI, MCP tools, configuration
  - `Q-paradigm-docs-basics` — 5-question quiz on docs system fundamentals
  - `LP-paradigm-docs` — learning path: overview note → basics quiz

Symbols: #DocsLoader, #DocsTools, #DocsCommands, #DocsSection, $docs-generation, !docs-generated

## [4.6.0] — 2026-03-17

### Added

- **Automation Tier Graduation — Phase 1+2: Engine, MCP Tools, CLI** — 7 new files, 7 modified.
  - Full spec at `docs/specs/automation-graduation.md` covering the 3-tier system (MCP → Habits → Hooks), graduation engine, demotion, and token savings projections.
  - `graduation-types.ts` — `GraduationState`, `GraduationConfig`, `GraduationTier`, `GraduationCheckResult`, `NON_GRADUATABLE_CHECK_TYPES` (tool-called, context-checked can never graduate).
  - `graduation-store.ts` — YAML read/write for `.paradigm/graduation.yaml`, state accessors, mutations, 30s cache.
  - `.paradigm/graduation.yaml` — Seed with 5 retroactively graduated habits and 7 never-graduate habits.
  - `paradigm graduate status` CLI — Shows habits by tier (hook/habit/mcp) with graduation dates, locks, savings.
  - `habits-loader.ts` skips graduated habits during evaluation, reports skip count.
  - `habits.ts` MCP response includes `graduatedToHooks` count when habits are skipped.
  - Post-write hook gains pseudo-session-start and context budget heuristic (warns at 30+ edits).
  - Stop hook cleans `.paradigm/.session-started` marker.
  - `graduation-engine.ts` — Core eligibility logic: queries practice events, checks compliance rate (90%+, 20+ events, 30d window, 5 consecutive sessions, 7d recency), `NON_GRADUATABLE_CHECK_TYPES` enforcement.
  - `graduation.ts` MCP tools — `paradigm_graduate_check` (eligibility with compliance data), `paradigm_graduate_status` (tier map + savings).
  - `paradigm graduate promote <id>` / `paradigm graduate demote <id>` CLI — Force-graduate or demote with configurable cooldown.
  - Hook source files (`src/commands/hooks/scripts/*.sh`) updated with session-start marker and context heuristic; propagated via `generate-hooks.mjs`.
  - `paradigm-common.sh` Check 12: Graduation failure tracking — maps stop-hook violations to graduated habits, writes failure timestamps, emits advisory near demotion threshold.
  - `claude-code-stop.sh`: Auto-demotion loop — after compliance checks, scans `.graduation-failures/`, calls `paradigm graduate demote` on habits with 3+ failures.
  - `CLAUDE.md` updated: removed redundant `paradigm_pm_postflight` guidance (stop hook handles it), added graduation tools to MCP workflow table, Check 13 in enforcement table, context monitoring now hook-driven.

### Changed

- 5 of 13 seed habits now enforced by hooks only — MCP evaluation skipped. ~750 tokens/session saved.
- `paradigm_pm_postflight` no longer recommended for Claude Code sessions (stop hook covers same checks).
- Context monitoring: post-write hook warns at 30+ edits (replaces manual `paradigm_context_check` polling).
- Stop hook compliance checks expanded from 11 to 13 (Check 12: graduation failures, Check 13: agent permissions).

Symbols: #graduation-types, #graduation-store, #graduation-engine, #graduation-tools, #graduation-cli, $graduation-flow, !habit-graduated, !habit-demoted

## [4.5.0] — 2026-03-17

### Added

- **Conductor Sprint 14: Task Lifecycle Completion + Cleanup** — 2 new Swift files, 5 modified.
  - `TaskArchive.swift` — `TaskArchiveEntry` struct + `TaskArchiveIO` enum: archive/load/count to `~/.paradigm/conductor/tasks-archive.jsonl` JSONL.
  - `TaskStore` gains `cancelTask(id:)`, `reassignTask(id:to:sendNote:)`, `archiveCompleted(olderThan:)`, `pruneCompleted()`, `archivedCount`.
  - `TaskDetailView` gains Cancel Task (with `.confirmationDialog`), Re-assign (agent picker sheet), and View Thread action buttons.
  - `TaskDashboardView` gains archive badge in header, Menu with "Archive Older than 7d" and "Archive All Completed" actions, and `onSendNote` callback.
  - `MainOverlayView` wires note-sending closure to TaskDashboardView using ScoreIO.appendJsonl.
  - New timeline icon/color for "cancelled" (xmark.circle, orange) and "reassigned" (arrow.triangle.swap, cyan).

- **Conductor Sprint 15: Active Sentinel + Event Correlation** — 3 new Swift files, 4 modified.
  - `SentinelEventDetailView` — Popover for single event: full timestamp, level/type badges, copyable symbol, metadata key-value pairs, related tasks with status pills.
  - `SentinelSymbolFilterView` — Horizontal ScrollView of clickable symbol chips. "All" chip + top 10 symbols by frequency. Purple capsule style with toggle selection.
  - `SentinelWSClient` gains `metadata: [String: String]?` on events, `@Published activeSymbols`, `symbolCounts` tracking, `events(forSymbol:)` filter, `clearBuffer()`, and `Hashable` conformance on `SentinelEvent`.
  - `SentinelLiveView` enhanced: symbol filter bar, clickable symbol text in event rows, `.popover` with event detail + related tasks, "Clear" button, filtered/total count.
  - `MainOverlayView` passes `taskStore` to SentinelLiveView for related task lookup.

- **Conductor Sprint 16: View Decomposition + Polish** — 7 new Swift files, 2 modified.
  - `Bindings/` subdirectory with 6 extracted views: `CustomGestureBindingsView`, `VoiceCommandBindingsView`, `BuiltInGestureBindingsView`, `EyebrowBindingsView`, `HotkeyBindingsView`, `ActionPickerViews` (shared free functions).
  - `BindingsManagerView` slimmed from 302 lines to ~44 lines — composes 5 sub-views via Form.
  - `MainOverlayView.mainContent` decomposed into 12 named computed properties: `calibrationSection`, `inputSection`, `bufferSection`, `sessionSection`, `workspaceSection`, `symphonyNotificationsSection`, `taskSection`, `agentNetworkSection`, `agentHealthSection`, `sentinelSection`.

- **18 new tests** across 4 test files:
  - `TaskStoreTests` +6: cancelTask, cancelCompletedIsNoOp, reassignTask, archiveCompleted, pruneCompleted, archivedCount.
  - `TaskArchiveTests` (3): archiveAndLoad, archiveAppends, archiveCountMatchesLoad.
  - `SentinelWSClientTests` +5: activeSymbolsTracking, clearBuffer, eventsForSymbol, metadataFieldParsed, symbolFrequencyOrder.
  - `SentinelFilterTests` (3): symbolFilterReturnsMatching, symbolFilterEmptyForUnknown, clearResetsEverything.
  - `BindingsDecompositionTests` (1): compile-check verifying all sub-views instantiate.

- **University Extracurricular System (Phase 0)** — category-based content organization with core/extracurricular tracks.
  - `UniversityContentCategory` gains `track`, `excludeFromOnboarding`, and `validationStrictness` fields.
  - `UniversityFrontmatter`, `UniversityQuiz`, `LearningPath`, and `UniversityIndexEntry` gain optional `category` field.
  - `UniversityFilter` gains `category` and `track` filter params.
  - `UniversityConfig.content` gains `defaultCategory` field.
  - `searchContent()` filters by `category` (direct match) and `track` (resolved via config category definitions).
  - `getOnboardingSequence()` excludes categories with `excludeFromOnboarding: true` from core suggestions; populates new `extracurricular` array in response.
  - `rebuildUniversityIndex()` includes `category` from frontmatter/quiz/path in index entries.
  - `validateUniversityContent()` is category-aware for validation strictness.
  - MCP tools `paradigm_university_search`, `paradigm_university_create`, and `paradigm_university_update` accept `category` param. Search tool accepts `track` param.
  - Onboarding response now includes `extracurricular` content array.
  - Site learn page migrated from `nonCredit` to `category: 'extracurricular'` with separate "Core Curriculum" and "Extracurricular" sections.
  - Default university config seeded at `.paradigm/university/config.yaml` with 4 categories.

### Changed

- Conductor bumped to 0.15.0 (from 0.12.0).
- `SentinelWSClient.handleMessage` changed from private to internal for testability.
- `SentinelEvent` now conforms to `Hashable` (needed for `.popover(item:)`).

Symbols: #task-archive, #sentinel-event-detail, #sentinel-symbol-filter, #custom-gesture-bindings, #voice-command-bindings, #builtin-gesture-bindings, #eyebrow-bindings-view, #hotkey-bindings-view, #action-picker-views, #UniversityTools, #UniversityLoader, $task-archive, $sentinel-investigation, $university-flow, !task-cancelled, !task-reassigned, !tasks-archived

## [4.4.0] — 2026-03-16

### Added

- **Conductor Sprint 11: Task Dashboard + Progress Tracking** — 3 new Swift files, 5 modified.
  - `TaskRecord.swift` — `TaskStatus` enum (7 states), `TaskTimelineEvent`, `TaskRecord` struct, `TaskStore` (@MainActor ObservableObject) with persistence to `~/.paradigm/conductor/tasks.json`.
  - `TaskDashboardView` — Kanban-style sidebar dashboard with 4 columns (Active, Blocked, Awaiting Approval, Complete). Priority filter, task cards with progress bars and assignee badges.
  - `TaskDetailView` — Full task detail sheet: scope, acceptance criteria, timeline with SF Symbol icons, files modified, symbols touched, blockers, external references. Includes custom `FlowLayout` for symbol tags.
  - `SymphonyMonitor` now routes task-intent notes (`taskAck`, `progress`, `approvalRequest`, `taskComplete`, `taskFailed`) to `TaskStore.handleNote()` with dedup tracking.
  - `TaskComposerView` calls `taskStore.addTask()` after writing notes to inboxes.
  - `AgentNetworkView` shows active task count per agent in agent rows.

- **Conductor Sprint 12: Sentinel Live View + Agent Health** — 3 new Swift files, 5 modified.
  - `AgentHealthMonitor` — Computes per-agent `AgentMetrics` (tasksCompleted, tasksFailed, successRate, avgCompletionTimeMs, recentOutcomes) from TaskStore via Combine subscription. Health thresholds: healthy (>80%), degraded (50-80%), unhealthy (<50%).
  - `SentinelLiveView` — Collapsible real-time event viewer: connection indicator + reconnect button, text search + level filter (All/Info/Warn/Error), auto-scroll toggle, event count footer.
  - `AgentHealthView` — Aggregate header (total tasks, overall success rate, best performer) + per-agent cards with health status dot, success rate circle, sparkline (recent outcomes).
  - `SentinelWSClient` gains `@Published recentEvents: [SentinelEvent]` (200-event buffer), `level` field on `SentinelEvent`, and `Identifiable` conformance.
  - `SettingsPanelView` gains "Monitoring" tab: Sentinel URL field, auto-connect toggle, event buffer display.
  - `AgentNetworkView` uses agent health status for dot colors (green/yellow/red).

- **Conductor Sprint 13: User-Customizable Bindings** — 3 new Swift files, 5 modified.
  - `EyebrowBindingRegistry` — `EyebrowEventKind` enum (4 cases, CaseIterable), user-customizable eyebrow event→action bindings, `useStateMachine` toggle (default true), CRUD + UserDefaults persistence.
  - `HotKeyBindingRegistry` — User-customizable `HotKeyBinding→ConductorAction` bindings with defaults matching existing hardcoded mappings. Serialization via `"keyCode:modifiers.rawValue"` keys.
  - `HotKeyRecorder` — NSView-based key combination capture (becomeFirstResponder, keyDown) with SwiftUI `NSViewRepresentable` wrapper.
  - `BindingsManagerView` — Fully wired with 5 sections: Custom Gestures, Voice Commands, Built-in Gesture Overrides (per-gesture Picker), Eyebrow Bindings (state machine toggle + event→action pickers), Hotkey Bindings (list + HotKeyRecorder + add/remove).
  - `HotKeyManager` gains `registerFromRegistry()` + `observeRegistry()` for live Combine-based binding updates.
  - `InputOrchestrator` checks `eyebrowBindingRegistry` before falling through to state machine.
  - `AppDelegate` refactored: `setupHotKeys()` uses `hotKeyManager.observeRegistry()` instead of hardcoded registrations.

- **35 new tests** across 5 test files:
  - `TaskStoreTests` (10): addTask, handleAck/progress/approval/complete/failed, timeline accumulation, filesModified union, computed properties, unknown taskId ignored.
  - `AgentHealthMonitorTests` (11): empty metrics, single completed, mixed outcomes, healthy/degraded/unhealthy thresholds, multi-agent task, recentOutcomes cap, bestPerformer, avgTime, unknown status.
  - `SentinelWSClientTests` (4): initial state, buffer limit, event identifiable, event level field.
  - `EyebrowBindingRegistryTests` (6): defaults empty, set/remove/reset, all event kinds, stateMachine flag.
  - `HotKeyBindingRegistryTests` (5): default bindings, set/remove/reset, binding count.

### Changed

- `ActionRegistry.gestureBindings` is now publicly settable (was `private(set)`) to support BindingsManagerView overrides.
- Conductor bumped to 0.12.0.

Symbols: #task-record, #task-store, #task-dashboard-view, #task-detail-view, $task-tracking, !task-status-changed, #agent-health-monitor, #sentinel-live-view, #agent-health-view, $agent-health-tracking, !agent-health-changed, #eyebrow-binding-registry, #hotkey-binding-registry, #hotkey-recorder, ~user-configurable

## [4.3.0] — 2026-03-16

### Added

- **Conductor Sprint 10: Task Protocol + Maestro Delegation** — 3 new Swift files, 1 new TS file, 5 modified.
  - **Task Protocol** — 7 new Symphony message intents: `task`, `task-ack`, `progress`, `approval-request`, `approval-response`, `task-complete`, `task-failed`. Wire-compatible payload types in both TypeScript (`symphony-loader.ts`) and Swift (`SymphonyTypes.swift`).
  - `TaskComposerView` — Structured task assignment UI: scope, acceptance criteria, priority, external ref. Writes task intent notes to target agent Symphony inboxes.
  - `ApprovalView` — Notification UI for agent approval requests. Shows summary, modified files, diff preview. Maestro responds with approve/reject/redirect + feedback.
  - `ApprovalNotificationBanner` — Scans monitor for pending approval-request notes and surfaces them in the overlay.
  - `task-protocol.ts` — Agent-side protocol prompt generator. Prepended to agent context when a task is received, instructing ack → work → progress → approval → complete workflow.

### Changed

- `paradigm_symphony_send` enum now includes all 7 task protocol intents.
- `MessageMetadata` gains `task`, `progress`, `approvalRequest`, `approvalResponse` payload fields (TS + Swift).
- `AgentNetworkView` gains "Send Task" action on group menus.
- `MainOverlayView` shows `ApprovalNotificationBanner` for pending approval requests.
- `ThreadView` intent color switch handles all task protocol intents.
- Conductor bumped to 0.9.0.

Symbols: #task-composer-view, #approval-view, $task-lifecycle

## [4.2.0] — 2026-03-16

### Added

- **Conductor Sprint 9: Agent Groups + Network View** — 4 new Swift files, 3 modified.
  - `AgentGroup` + `AgentGroupStore` — Named cross-project agent groups persisted to `~/.paradigm/conductor/groups.json`. CRUD, color-coding, drag-between-groups.
  - `SymphonyMonitor` — Polls Symphony inboxes/outboxes for grouped agents at 5s interval. Tracks unread counts, last activity, active thread IDs, and indexes thread messages.
  - `AgentNetworkView` — Primary orchestration dashboard: group panels with agent status badges (running/linked/offline), unread counts, thread access, add/remove agents, stop-group.
  - `ThreadView` — Chat-like Symphony thread viewer with message compose. Conductor sends messages as "Maestro" (human participant) directly into agent inboxes.

### Changed

- `MainOverlayView` shows `AgentNetworkView` when groups or registered agents exist, falls back to `ThreadListView` otherwise.
- `AppDelegate` owns `AgentGroupStore` + `SymphonyMonitor` (single-owner pattern).
- Symphony monitor starts polling grouped agents on app launch.
- Conductor bumped to 0.8.0.

Symbols: #agent-group, #agent-group-store, #symphony-monitor, #agent-network-view, #thread-view, $group-link

## [4.1.0] — 2026-03-16

### Added

- **Conductor Sprint 8: Session Manager + Agent Launcher** — 5 new Swift files, 3 modified.
  - `ProjectStore` — Recent project persistence at `~/.paradigm/conductor/recent-projects.json` with pin/sort, survives reinstall.
  - `CheckpointReader` — Reads `.paradigm/session-checkpoint.json` and pending handoff files (wire-compatible with paradigm-mcp `SessionCheckpoint`).
  - `AgentProcessManager` — Spawns headless `claude` child processes via `Process` API with stdin/stdout/stderr piping and lifecycle control.
  - `SessionManagerView` — Dashboard showing project cards with checkpoint phase/context, running agent list with log viewer.
  - `SessionsSettingsView` — Settings tab for default agent role, auto-launch toggle, agent management.

### Changed

- Conductor `AppDelegate` now owns `ProjectStore` + `AgentProcessManager` (single-owner pattern).
- `MainOverlayView` embeds `SessionManagerView` between buffer and workspace sections.
- `SettingsPanelView` gains a "Sessions" tab for agent configuration.
- Conductor bumped to 0.7.0.

Symbols: #project-store, #checkpoint-reader, #agent-process-manager, #session-manager-view, #sessions-settings, $session-launch

## [4.0.0] — 2026-03-16

### Added

- **Response Format Parameter** — Optional `response_format: 'concise' | 'detailed'` on high-traffic tools (`paradigm_search`, `paradigm_ripple`, `paradigm_status`, `paradigm_gates_for_route`, `paradigm_navigate`, `paradigm_agent_expertise`). Concise mode strips secondary data to save tokens. Default `'detailed'` preserves backward compatibility.
- **Dynamic Tool Loading** — `tool-registry.ts` with tiered system (core/feature/advanced). Feature-tier tools auto-detect from filesystem (e.g., `.paradigm/lore/` enables lore tools). `paradigm_tool_activate` enables on-demand advanced tools.
- **Agent Notebooks** — Curated snippet libraries distilled from lore. Storage at `~/.paradigm/notebooks/{agent-id}/` (global) and `.paradigm/notebooks/{agent-id}/` (project). 3 MCP tools: `paradigm_notebook_search`, `paradigm_notebook_add`, `paradigm_notebook_promote`. CLI: `paradigm notebook list|show|export`. Notebook entries enriched into orchestration prompts via `buildProfileEnrichment`.
- **Agent Permission Scoping** — `AgentPermissions` interface on `.agent` profiles with `paths` (read/write/deny globs), `tools` (allow/deny patterns), `dangerous_actions`. SHA-256 integrity hashing (`integrityHash`) with tamper detection via `verifyIntegrity()`. Permissions surfaced in orchestration prompts as constraints. `paradigm agent create --deny-paths` CLI option. Stop hook Check 12 (advisory).
- **Automated Review Pipeline** — `paradigm review` CLI with two-stage protocol. Stage 1: spec compliance (purpose coverage, portal gates, aspect anchors, broken refs). Stage 2 (`--deep`): code quality (eval, hardcoded secrets, console.log). Supports `--pr <number>`, `--ci` (exit 1 on blocking), `--json`. Shared logic extracted into `compliance-checker.ts`.

### Changed

- Rebranded from "Structured AI Context" to "The Context Engineering Framework".
- `buildProfileEnrichment()` now accepts optional `notebookEntries` parameter for orchestration enrichment.
- Orchestration prompts include permission constraints when agent has `permissions` set.
- `paradigm_agent_get` now returns `permissions` and `integrity` status in response.
- `paradigm agent show` displays permissions section.
- `paradigm-common.sh` now includes Check 12 (agent permission compliance advisory).
- Both packages bumped to 4.0.0 (`@a-company/paradigm`, `@a-company/paradigm-mcp`).

### Breaking

- Major version bump: 3.47.0 → 4.0.0. No breaking API changes — all new features are additive with backward-compatible defaults. The major bump signals the strategic rebranding to Context Engineering Framework.

Symbols: #tool-registry, #agent-notebooks, #agent-permissions, #compliance-checker, #review-pipeline, $review-flow

## [3.47.0] — 2026-03-16

### Added

- **Agent Identity Files (Phase 0)** — Persistent `.agent` YAML profiles that track expertise, personality, and cross-project patterns. Stored globally (`~/.paradigm/agents/`) or per-project (`.paradigm/agents/`), with project overriding global.
- **3 MCP Tools** — `paradigm_agent_list` (~150 tokens), `paradigm_agent_expertise` (~100 tokens), `paradigm_agent_get` (~200 tokens) for querying agent profiles and symbol-to-agent routing.
- **4 CLI Commands** — `paradigm agent list`, `paradigm agent show <id>`, `paradigm agent create <id>`, `paradigm agent sync <id>` for managing .agent identity files.
- **Expertise Auto-Update** — When lore is recorded, the relevant agent's per-symbol expertise scores update via exponential moving average (70/30 weight). Assessment verdicts also feed into expertise.
- **Orchestration Enrichment** — `paradigm_orchestrate_inline` and `paradigm_agent_prompt` now prepend personality preferences and relevant expertise to agent prompts when `.agent` profiles exist.

### Changed

- **Lore recording** — After `paradigm_lore_record`, auto-updates agent expertise if `PARADIGM_AGENT_ID` is set in the environment.
- **Lore assessment** — After `paradigm_lore_assess`, nudges agent expertise confidence toward the verdict score.
- **Orchestration prompts** — `buildAgentPromptInternal` accepts optional `profileEnrichment` text prepended before role prompt.

Symbols: #agent-loader, #agent-tools, #agent-types, #AgentCommands, !agent-created, !agent-synced, !expertise-updated, $agent-expertise-flow

## [3.46.0] — 2026-03-15

### Added

- **Symphony Phase 1: Cross-Machine Networking** — WebSocket relay for multi-machine agent communication. Hub-and-spoke topology: `paradigm symphony serve` runs the hub, `paradigm symphony join --remote <ip>` connects spokes. Messages bridge transparently between local JSONL mailboxes.
- **Pairing Security** — 6-digit pairing codes with HMAC-SHA256 challenge-response authentication. Codes rotate every 5 minutes. 3 failed auth attempts from same IP triggers 60s cooldown. Peer secrets stored in `~/.paradigm/score/peers.json` (mode 0600).
- **`paradigm symphony peers`** — Peer trust management CLI: `peers list`, `peers revoke <id>`, `peers forget --force`.
- **Auto-reconnect** — Client mode reconnects with exponential backoff (1s → 30s max) when the hub drops.
- **Internet Direct Connect** — `paradigm symphony serve --public` displays a connection string with embedded pairing code. `paradigm symphony join --remote <ip>:3939#847291` skips interactive prompt.
- **Remote agent visibility** — `paradigm symphony list` shows remote agents with `(remote: peer-name)` tag. `paradigm symphony status` shows peer count and remote agent count.
- **MCP `paradigm_symphony_status`** — Now includes `peers` array with id, address, agent count, and lastSeen for each connected peer.
- **Platform REST `GET /api/symphony/peers`** — Returns trusted peer list for the Platform UI network tab.
- **Outbox watcher** — Relay polls local outboxes every 2s, forwarding new messages to all connected peers. Dedup via bounded message ID set (max 10,000).
- **Keepalive** — Ping/pong every 30s with 10s timeout. Dead connections auto-terminated.

### Changed

- **`symphonyServeCommand`** — Upgraded from Phase 0 TCP stub to full WebSocket relay server with pairing code display, code rotation, and peer event logging.
- **`symphonyJoinCommand`** — Remote path now connects via WebSocket relay with HMAC authentication (previously logged "not yet implemented").
- **`symphonyListCommand`** — Shows remote agents from trusted peers below local agents section.
- **`symphonyStatusCommand`** — Includes peer connection info (count, addresses, agent totals).
- **`SymphonyMessage`** — Added optional `origin?: string` field for relay provenance tracking.
- **`SCORE_DIR`** — Now exported from `symphony-loader.ts` for use by relay and peers modules.

Symbols: #symphony-relay, #symphony-peers, #symphony-serve, #symphony-peers-revoke, #symphony-peers-forget, !peer-connected, !peer-disconnected

## [3.45.0] — 2026-03-15

### Added

- **Symphony Platform Section** — Live agent-to-agent communication dashboard replacing the "Coming Soon" placeholder, with 3 sub-tabs: Threads, Network, and Files.
- **Symphony REST routes** — `createSymphonyRouter()` factory at `/api/symphony/*` with 9 endpoints: agents (list + me), threads (list + detail + resolve), messages (send + inbox), file requests (list + action), and aggregated status.
- **Thread-first UX** — Two-panel Threads tab with sidebar (status filter, thread cards with participant avatars) and conversation view (chronological messages, auto-scroll, intent color-coding by category).
- **Human compose box** — Input at the bottom of every thread with intent selector dropdown and Enter-to-send, allowing humans to participate directly in agent conversations from the browser.
- **Network tab** — Agent grid with awake/asleep status indicators (green pulse animation), last-poll timestamps, and 5 aggregate stat cards.
- **Files tab** — File request list with Approve / Approve (redacted) / Deny action buttons, deny-reason input, urgency badges, and status filtering.
- **Real-time WS forwarding** — `symphony:message` and `symphony:thread_resolved` events broadcast from server and forwarded via CustomEvent to the symphony store for live updates.
- **Polling** — 3s poll for active thread, 10s poll for thread list + network + status, 10s poll for file requests when files tab active.
- **Intent color map** — 6 color categories matching the Symphony spec: dialogue (blue), action (component), outcome (orange), system (red), lifecycle (aspect), transfer (green).
- **SymphonyStore** — Zustand store managing agents, threads, messages, file requests, network status, and WS message handling.
- **Agent status blurb** — Agents can now broadcast a short description of their current work (e.g., "Implementing auth middleware — 3 files modified") via the `status` param on `paradigm_symphony_poll`. Visible in Platform UI Network tab (blue-accented card), CLI `symphony list/status/whoami`, and `paradigm_symphony_status` MCP tool response.
- **`updateAgentStatus()`** — Standalone loader function to update an agent's status blurb without a full poll cycle.
- **`paradigm symphony watch`** — Zero-token real-time inbox monitor. Pure file-system polling (2s default) with intent color-coding, thread filtering, and new-thread detection. No AI tokens consumed — replaces `/loop paradigm_symphony_poll` for passive monitoring. Options: `--interval <ms>`, `--thread <id>`, `--quiet`.
- **`paradigm_symphony_peek`** — Ultra-cheap MCP tool for near-free agent monitoring. File stat only — no JSONL parsing, no message reading. Returns `{ hasNew: true/false }`. Use with `/loop 10s paradigm_symphony_peek` (~$0.04/hr). When `hasNew` is true, agent calls full `paradigm_symphony_poll` to read and respond. Includes heartbeat + status blurb support.

### Changed

- **Platform server** — Symphony routes mounted after sentinel bridge when symphony section is enabled.
- **WS message forwarding** — `useAgentEffects` now dispatches `symphony-ws` CustomEvents alongside existing `sentinel-ws`.
- **App.tsx** — `SymphonySection` lazy-loaded, replacing `ComingSoonSection` for symphony.
- **`markAgentPollTime()`** — Now accepts optional `statusBlurb` parameter, written alongside the heartbeat timestamp.

Symbols: #SymphonyRouter, #SymphonySection, #SymphonyStore, #ThreadsTab, #NetworkTab, #FilesTab

## [3.43.0] — 2026-03-15

### Added

- **Sentinel Platform Section** — Sentinel observability is now embedded as a native Platform section with 4 sub-tabs (Logs, Incidents, Events, Flows), eliminating the need to run a separate sentinel server for observability.
- **Sentinel Bridge** — `sentinel-bridge.ts` dynamically imports `@a-company/sentinel/server`, initializes storage + builtin schemas, and mounts all 12 route factories under `/api/sentinel/*` with auth + rate limiting.
- **Real-time WS forwarding** — Platform WS now forwards `sentinel:log`, `sentinel:flow_event`, and `sentinel:event` messages to the browser via CustomEvent, enabling live log streaming and flow activity visualization without a separate WebSocket connection.
- **4 Zustand stores** — `sentinelLogsStore`, `sentinelIncidentsStore`, `sentinelEventsStore`, `sentinelSchemasStore` ported from Sentinel UI with `/api/sentinel/` prefix and WS message handlers replacing direct WebSocket connections.
- **4 tab components** — `LogsTab` (resizable columns, context menu exclusions, live streaming), `IncidentsTab` (status filter, detail panel, resolve action), `EventsTab` (schema selector, scope navigator, category filters), `FlowsTab` (flow cards with live activity dots, flow diagram, flow composer).
- **Sentinel CSS** — ~1000 lines of sentinel styles mapped to Platform design tokens (`--p-*`), scoped under `.sentinel-section` to prevent collisions.

### Changed

- **Sentinel package exports** — Added re-exports for all route factories, middleware, storage, config, builtin schemas, and option types from `@a-company/sentinel/server`.
- **Platform server** — Sentinel routes mounted before `httpServer.listen()` when sentinel section is enabled. Server initialization restructured to support async sentinel bridge setup.

Symbols: #SentinelBridge, #SentinelSection, #SentinelLogsStore, #SentinelIncidentsStore, #SentinelEventsStore, #SentinelSchemasStore, #LogsTab, #IncidentsTab, #EventsTab, #FlowsTab

## [3.42.0] — 2026-03-15

### Added

- **Overview Dashboard** — `GET /api/platform/overview` aggregates project info, symbol counts (by type), lore stats, calibration score, task counts, 5 health metrics, and a merged recent-activity feed (git commits + lore entries). Overview section upgraded with 6 stat cards, 5 health progress bars, and scrollable activity feed. Stat cards navigate to relevant sections on click.
- **Git Management Section** — Full git workflow from the browser via 8 new endpoints (`/api/git/status`, `branches`, `log`, `diff`, `stage`, `unstage`, `commit`, `push`). Browser UI includes branch bar with ahead/behind badges, file list with stage/unstage buttons, CSS-only colored diff viewer with line numbers, commit composer with symbol autocomplete on `#$^!~` triggers, and paginated commit log with symbol badges.
- **Git section in sidebar** — `git` added to always-on sections, accessible via `⎇` icon in sidebar nav.

### Changed

- **Overview section** — Rewritten from minimal 2-card layout to full health dashboard backed by dedicated `/api/platform/overview` API.
- **Shell CSS** — Overview styles moved to dedicated `overview.css` for code-split loading.

Symbols: #OverviewHandler, #OverviewStore, #OverviewSection, #GitRouter, #GitSection, #GitStore

## [3.41.0] — 2026-03-15

### Added

- **Agent-Driven UI** — AI agents can now drive the Platform browser UI in real-time via 5 new MCP tools, turning the interaction model from "agent responds to text" into "agent and human share a workspace."
- **MCP tools** — `paradigm_platform_navigate` (switch sections, select symbols), `paradigm_platform_highlight` (pulsing glow on symbols), `paradigm_platform_annotate` (toasts, callouts, badges), `paradigm_platform_observe` (read current UI state), `paradigm_platform_clear` (remove agent effects).
- **WebSocket infrastructure** — Platform server now supports WebSocket on `/ws` for real-time agent→browser communication. Uses same pattern as Sentinel WS server.
- **Agent command route** — `POST /api/platform/agent-command` receives MCP commands and broadcasts to all connected browsers.
- **AgentPresenceManager** — Tracks connected agents by ID, auto-prunes stale agents after 2min idle, deterministic color from agent ID hash.
- **UserStateTracker** — Accumulates user activity (section, symbol, theme) for the `observe` tool.
- **Platform bridge** — HTTP helper in paradigm-mcp for MCP→Platform server communication. Resolves port from config.yaml, resolves agent identity from Symphony pattern.
- **Browser agent store** — Zustand store (`agentStore.ts`) managing agent presence, highlights, annotations, toasts, mute state, and pending navigation.
- **Agent effect hooks** — `useAgentEffects` (WebSocket→store bridge with auto-reconnect), `useActivityReporter` (reports user section/theme changes to server).
- **Visual components** — `AgentToast` (severity-colored toasts with robot icon), `AgentCallout` (floating callouts for graph nodes), `AgentNavigationPrompt` (conflict resolution when user is active).
- **Conflict resolution** — User always wins: idle user → agent navigates immediately; active user → shows "Go there / Dismiss" prompt; muted → all agent effects silently discarded.
- **Agent CSS** — Highlight pulse animations, dashed selection rings, toast slide-in, callout/nav-prompt animations, presence dots, mute button styles.
- **Spec update** — Section 21 "Agent-Driven UI" added to `docs/specs/platform.md` with full architecture, tool specs, WS messages, and visual treatment reference.
- **Expanded SectionId type** — Platform UI now supports `sentinel`, `university`, and `symphony` sections with placeholder pages ("Coming in Platform Phase 2").
- **University content** — New PARA 501 lesson "Platform & Agent-Driven UI" (5 quiz questions) + 4 PLSAT slots (109-112, 7 question variants) covering the MCP→HTTP→WS pipeline, conflict resolution, observe, highlights, presence pruning.
- **CLAUDE.md** — Added 5 platform tools to MCP workflow table and token budget reference.

### Fixed

- **Lore section crash** — `tags` field on some lore entries was a string instead of array, causing `.some()` TypeError. Added `Array.isArray()` guard.

Symbols: #PlatformWebSocket, #AgentPresenceManager, #UserStateTracker, #AgentCommandRoute, #PlatformTools, #AgentStore, #AgentToast, #AgentCallout

## [3.40.0] — 2026-03-15

### Added

- **Paradigm Platform Phase 0** — `paradigm serve` launches a unified development management platform in a single browser tab on port 3850.
- **Unified Express server** — Mounts existing lore routes (`/api/lore`, `/api/info`, `/api/sessions`) and graph routes (`/api/symbols`, `/api/graphs`) under one server process.
- **Platform-specific endpoints** — `/api/platform/health` (server status + enabled sections), `/api/platform/sections` (available sections list).
- **Platform UI shell** — React 18 + Zustand SPA with sidebar navigation, header bar, theme toggle (dark/light), and section routing.
- **Absorbed lore-ui** — Lore section with all 4 views (timeline, session, symbol, author) running inside the Platform shell.
- **Absorbed graph-ui** — Graph section with full React Flow canvas, symbol panel, toolbar, export/load dialogs running inside the Platform shell.
- **Overview dashboard** — Landing section with symbol counts and lore entry totals.
- **Lazy-loaded sections** — Lore and Graph sections code-split for fast initial load.
- **Section auto-detection** — Sentinel and University sections detected automatically based on installed packages.
- **Backwards compatible** — `paradigm lore serve` (port 3840) and `paradigm graph serve` (port 3841) continue working unchanged.
- **Platform spec** — Comprehensive 8-phase spec at `docs/specs/platform.md` (2,334 lines) covering governance, meetings, methodology, and more.

Symbols: #PlatformServer, #PlatformShell, #ServeCommand, #LoreSection, #GraphSection, #OverviewSection

## [3.39.0] — 2026-03-15

### Added

- **Per-Project University** — Every project can maintain its own university at `.paradigm/university/` with structured notes, policies, quizzes, learning paths, and diplomas.
- **University content types** — Notes (`N-`), Policies (`P-`), Quizzes (`Q-`), Learning Paths (`LP-`), Diplomas (`D-`) with YAML/Markdown schemas.
- **University config** — `.paradigm/university/config.yaml` with branding (name, tagline, institution), theme (colors, font), content categories, and diploma settings.
- **9 MCP tools** — `paradigm_university_search`, `paradigm_university_get`, `paradigm_university_create`, `paradigm_university_update`, `paradigm_university_quiz`, `paradigm_university_submit`, `paradigm_university_onboard`, `paradigm_university_diplomas`, `paradigm_university_validate`.
- **7 CLI commands** — `paradigm university serve|list|add|show|quiz|status|validate`. Bare `paradigm university` defaults to serve (backward compat).
- **Symbol linking** — `symbols` field on university content is load-bearing: validated against scan-index, surfaced in ripple (`university_content_affected`), and staleness-checked against `.purpose` file modification dates.
- **Reindex integration** — `paradigm_reindex` rebuilds university index (`.paradigm/university/index.yaml`) alongside scan-index, navigator, flows, etc. Reports `universityStats` in result.
- **Doctor integration** — `paradigm doctor` checks university content health: validates quiz answers, learning path step references, and reports content count.
- **2 seed habits** — `university-content-valid` (advisory on-stop, validates content), `university-onboarded` (advisory preflight, opt-in, reminds to call onboard).
- **PLSAT diploma auto-save** — `POST /api/plsat/diploma` endpoint writes diplomas to `.paradigm/university/diplomas/` when university directory exists. Server accepts `projectDir` option.
- **Shift template** — `paradigm shift` creates `.paradigm/university/` directory structure with default `config.yaml` using project name as institution.
- **CLAUDE.md updates** — Project University section, MCP Workflow Protocol entries, token budget entries for university tools.
- **`quality` habit category** — Added to HabitCategory type for university content validation habits.

Symbols: #UniversityTools, #UniversityStorage, #UniversityCommands, #university-loader, #UniversityTypes

## [3.38.0] — 2026-03-15

### Added

- **Lore Confidence Calibration** — Agents can attach confidence scores (0.0-1.0) to lore entries, and humans can record assessment verdicts (correct/partial/incorrect). The system computes calibration deltas and builds domain-specific reliability maps.
- **`confidence` field on LoreEntry** — Optional 0.0-1.0 score expressing agent's predicted confidence in correctness. Also available on `LoreDecision`.
- **`assessment` field on LoreEntry** — Human verdict (`correct`/`partial`/`incorrect`) with assessor, timestamp, and optional notes.
- **`assessment_delta` field on LoreEntry** — Auto-computed difference between implied outcome score and confidence (positive = under-confident, negative = over-confident).
- **`paradigm_lore_assess` MCP tool** — Record assessment verdict on a lore entry. Auto-computes delta if confidence was recorded. ~100 tokens.
- **`paradigm_lore_calibration` MCP tool** — Query calibration statistics across assessed entries. Returns accuracy rate, avg confidence, calibration score, verdict breakdown, groupBy support (symbol/tag/type), and natural-language insights with low-N caveats. ~200 tokens.
- **`paradigm lore assess <id> <verdict>` CLI** — Record assessment with `--assessor` and `--notes` options. Shows delta and calibration interpretation.
- **`paradigm lore calibration` CLI** — Show calibration report with `--symbol`, `--tag`, `--author`, `--group-by`, and `--json` options.
- **`--confidence` flag on `paradigm lore record`** — Attach confidence score when recording entries via CLI.
- **`confidence` param on `paradigm_lore_record` and `paradigm_lore_update`** — Attach/update confidence via MCP.
- **`hasConfidence`/`hasAssessment` filters** — New filter fields on LoreFilter, supported in MCP search, core filter, lore-loader, and lore-server query params.
- **Lore UI: confidence badge** — LoreCard shows purple percentage badge when confidence is set.
- **Lore UI: assessment indicator** — LoreCard shows colored verdict badge (green/yellow/red) when assessed.
- **Lore UI: Confidence & Assessment section** — DetailPanel shows full confidence, verdict, assessor, delta with calibration interpretation.
- **Lore server: `PUT /:id/assess` route** — HTTP endpoint for assessment in lore-ui server.
- **Lore server: `GET /calibration` route** — HTTP endpoint for calibration stats in lore-ui server.
- **Wisdom integration** — `paradigm_wisdom_context` now includes `calibration` and `calibration_warnings` for assessed symbols. Low-accuracy symbols (< 60% across 3+ entries) surface warnings like "Low historical accuracy for #X: 40% across 5 entries."
- **`confidence-on-decisions` seed habit** — Advisory-only reminder on stop to include confidence scores when recording lore. Category: documentation, severity: advisory, never blocks.
- **CLAUDE.md: Confidence Calibration section** — Documents the record-assess-calibrate workflow, key distinctions between review/assessment/confidence.
- **CLAUDE.md: MCP Workflow Protocol + Token Budget tables** — Added `paradigm_lore_assess` and `paradigm_lore_calibration` entries.

Symbols: #lore-assess, #lore-calibration, #LoreCard, #DetailPanel, #LoreTools, #WisdomTools

## [3.37.0] — 2026-03-13

### Added

- **Integrity hardening** — New `integrity-checker.ts` utility in paradigm-mcp with 7 checks: broken references, duplicate symbols, orphaned symbols, missing anchor files, anchor out-of-bounds, component anchor validation, purpose file health (oversized/stale detection with health score).
- **`paradigm integrity` CLI command** — Reports broken refs, duplicates, orphans, missing anchors. Supports `--json` for machine-readable output (used by stop hook Check 12).
- **Reindex steps 8-11** — Reindex now runs integrity checks (step 8), component anchor validation (step 9), purpose health scoring (step 10), and cross-file .purpose validation (step 11). All non-fatal; results included in reindex output.
- **Postflight check 6** — Validates `parentSymbol` references for touched symbols during postflight (advisory, severity: warning).
- **Stop hook Check 12** — Advisory-only symbol integrity check (broken refs + duplicates + missing anchors). Non-blocking.
- **Config schema validation** — Zod schema for `.paradigm/config.yaml` covering all known fields. `paradigm doctor` Check 8 validates config schema. Index-loader warns on missing required fields.
- **Cross-file .purpose validation** — `validateCrossFile()` in purpose-core checks parent references, symbol list references, and flow step references across all .purpose files. Wired into reindex step 11.
- **Doctor checks 8-9** — Check 8: config.yaml schema validation. Check 9: purpose file health (oversized >500 lines, split suggestions).
- **Duplicate detection in aggregator** — premise-core aggregator now detects symbols defined in 2+ files, reports via `AggregationResult.duplicateSymbols`.
- **Purpose health score in status** — `paradigm_status` MCP tool now includes `purposeHealthScore` (0-100).
- **LoreEntry consolidation** — `lore.ts` and `sessions.ts` route files now import `LoreEntry` from `core/lore/types.ts` instead of inline interfaces.

### Changed

- Doctor command upgraded from 7 to 9 quality checks.
- Postflight upgraded from 6 to 7 checks (totalChecks).
- Reindex pipeline upgraded from 7 to 11 steps.
- Stop hook upgraded from 11 to 12 checks.

### Fixed

- **Anchor resolution** — Anchors now resolve relative to their `.purpose` file's directory first, falling back to rootDir. Eliminates false positives from sub-package `.purpose` files (355 → 0 missing anchors).
- **Duplicate detection** — Skips `.purpose` + `portal.yaml` overlap for gate symbols (by design, not a conflict).
- **Orphan definition** — Now reports true isolates (zero refs in AND out) instead of all unreferenced symbols. Tree roots (features with outgoing refs) are structural, not defects (440 → 135 reported).
- **10 out-of-bounds anchors** — Updated stale line ranges across sentinel, paradigm-mcp, and sentinel-ui `.purpose` files.
- **Symphony anchor paths** — Fixed malformed relative paths (`../../` → `../../../../../`) in `packages/paradigm/src/commands/symphony/.purpose`.
- **Root .purpose cleanup** — Removed duplicate `#probe-protocol` (authoritative copy in `packages/probe/core/.purpose`).

Symbols: #IntegrityChecker, #integrity-command, #config-schema-validator, #doctor-command, #validator, #aggregator, ~advisory-first, ~anchor-resolution

## [3.36.0] — 2026-03-13

### Added

- **Symphony Phases 1 & 2** — Conductor auto-link + Sentinel conversation view for multi-agent orchestration.
- **Naming rename: "A-Mail" → "The Score"**: Protocol directory `~/.paradigm/mail/` → `~/.paradigm/score/`, CLI `paradigm mail` → `paradigm symphony`, subcommand `link` → `join`, `unlink` → `leave`. Backward-compat migration auto-renames legacy directory on first access.
- **Conductor auto-link** (Phase 1, Swift): 9 new Swift files — `SymphonyTypes.swift` (wire-compatible Codable types), `ScoreIO.swift` (JSONL I/O), `AgentPartManager.swift` (agent registration), `NoteRelay.swift` (5s polling relay with dedup), `FileApprovalManager.swift` (approve/deny/redact with SHA-256 + path safety), `AutoLinkCoordinator.swift` (auto-detect CC sessions).
- **Conductor Symphony UI** (Phase 1, SwiftUI): `ThreadListView`, `FileRequestNotificationView`, `SymphonySettingsView` (6th settings tab). Voice commands: "approve", "deny", "approve redacted" for hands-free file approval.
- **Sentinel ConversationView** (Phase 2, React): Interactive tree view of Symphony agent conversations — `ThreadList` sidebar + `ConversationPanel` with `NoteBubble`, `IntentBadge`, `ParticipantBadge`, `DecisionSummary`. WebSocket real-time updates with slide-in animation.
- **`paradigm-symphony` event schema**: 19 event types across 6 categories (dialogue, action, outcome, system, lifecycle, transfer). Auto-registered on Sentinel startup alongside `paradigm-logger`.
- **Symphony event bridge** (`#SymphonyEventBridge`): MCP symphony tools emit events to Sentinel via fire-and-forget POST. Maps all 16 message intents to event types. Emits thread lifecycle events on auto-thread creation.
- **Zustand conversation store** (`#ConversationStore`): Threads from `/api/events/scopes`, notes from `/api/events`, decision extraction, WebSocket real-time updates.
- **StatusTracker enhancement**: Now scans `~/.paradigm/score/agents/` for registered agent counts alongside project task files.
- **NotificationBubbleView enhancement**: Thread count badge showing active Symphony conversations per instance.

### Changed

- **CLI command group rename**: `paradigm mail` → `paradigm symphony` with 16 subcommands renamed (join, leave, whoami, list, send, read, inbox, threads, thread, resolve, status, serve, request, requests, approve, deny).
- **symphony-loader.ts**: `MAIL_DIR` → `SCORE_DIR`, `ensureMailDirs()` → `ensureScoreDirs()` (deprecated alias kept), user-facing strings updated ("mailbox" → "inbox", "message" → "note").
- **ConductorAction**: +3 cases (`.approveFileRequest`, `.denyFileRequest`, `.approveFileRequestRedacted`).
- **InputOrchestrator**: Handles Symphony file approval actions via `fileApprovalManager`.
- **VoiceCommandRegistry**: Default commands for file approval ("approve", "deny", "approve redacted").
- **ActionRegistry**: Serialization for new Symphony action cases.
- **AppDelegate**: Owns Symphony components (agentPartManager, noteRelay, fileApprovalManager, autoLinkCoordinator), lifecycle management.
- **MainOverlayView**: File request notifications + thread list sections.
- **SettingsPanelView**: Symphony tab added.

Symbols: #symphony-types, #score-io, #agent-part-manager, #note-relay, #file-approval-manager, #auto-link-coordinator, #thread-list-view, #file-request-notification, #symphony-settings, #SymphonySchema, #ConversationView, #ConversationStore, #SymphonyEventBridge, #symphony-join, #symphony-leave, $symphony-auto-link, $symphony-relay, $symphony-file-approval, $symphony-voice-approve, $symphony-startup, $symphony-conversation, ^symphony-enabled, ^file-request-allowed, !agent-part-created, !agent-auto-linked, !note-relayed, !file-request-received, !file-request-approved, !note-received-live, ~jsonl-compatible, ~file-safety

## [3.35.0] — 2026-03-12

### Added

- **Symphony Phase 0: A-Mail** — file-based agent-to-agent messaging for multi-session collaboration. No server dependency; uses JSONL mailboxes at `~/.paradigm/mail/` polled via `/loop`.
- **6 new MCP tools**: `paradigm_symphony_poll` (inbox heartbeat), `paradigm_symphony_send` (message routing with 16 intents), `paradigm_symphony_status` (network overview with sleep detection), `paradigm_symphony_thread` (full thread context), `paradigm_symphony_request_file` (human-gated file pipeline), `paradigm_symphony_approve_file` (approve/deny/redact file transfers).
- **`paradigm mail` CLI command group**: 16 subcommands — `link`, `unlink`, `whoami`, `list`, `send`, `read`, `inbox`, `threads`, `thread`, `resolve`, `status`, `serve`, `request`, `requests`, `approve`, `deny`.
- **Agent identity system**: Deterministic `{project}/{role}` IDs derived from `config.yaml`, surviving session restarts. Auto-discovery of Conductor sessions.
- **Thread management**: Auto-created on first message, with participant tracking, message counting, and resolution to Lore entries.
- **File transfer pipeline**: Trust config (`trust.yaml`), hard-deny list (`.env*`, `*.key`, `*.pem`, `**/credentials*`, `**/secrets/**`), auto-approve globs, SHA-256 integrity hashes, secret redaction mode.
- **TCP serve stub** (`paradigm mail serve`): Phase 0 placeholder for remote agent linking on port 3939.
- **University**: New para-501 lesson "Symphony: Multi-Agent Messaging with A-Mail" with 5 quiz questions. 6 new PLSAT question slots (12 variants) covering A-Mail architecture, identity, intents, security, threading, and heartbeat. Reference cards for all 6 MCP tools and `paradigm mail` CLI commands.
- **Quick start guide**: `docs/guides/symphony-quickstart.md` with step-by-step multi-agent setup.
- **Troubleshooting**: Symphony/A-Mail entries in `.paradigm/docs/troubleshooting.md`.

Symbols: #symphony-loader, #symphony-poll, #symphony-send, #symphony-status, #symphony-thread, #symphony-request-file, #symphony-approve-file, #mail-link, #mail-unlink, #mail-whoami, #mail-list, #mail-send, #mail-read, #mail-threads, #mail-thread, #mail-resolve, #mail-status, #mail-serve, #mail-request, #mail-approve, #mail-deny, $mail-send-flow, $mail-poll-flow, $file-request-flow, ^file-trust, !message-sent, !message-received, !thread-created, !thread-resolved, !file-requested, !file-approved, !file-denied, !file-delivered, ~human-gated-transfer, ~hard-deny-list

## [3.34.0] — 2026-03-12

### Added

- **`paradigm migrate` command**: Version-aware project migration system that detects what version a project is effectively at and applies pending migrations automatically. Subsumes the old `paradigm upgrade` command.
- **Migration registry**: 19 ordered migrations covering legacy format conversion, directory creation, config field additions, template sync, and hook refresh. Each migration is self-contained with `check()` and `apply()`.
- **`.paradigm/migrate.yaml` state tracking**: Records which migrations have been applied, when, and by which CLI version. First-run bootstrap auto-marks existing structures as applied to prevent false positives.
- **Auto vs manual migration classification**: Directory, config, template, and hook migrations apply automatically; schema/format migrations that change user content (e.g., assessment-to-lore) are flagged for manual review with guidance.
- **`paradigm shift` step 1b integration**: Re-running `paradigm shift` on existing projects now silently applies pending migrations, making shift a full upgrade path.
- **Evergreen migrations**: `sync-templates` and `refresh-hooks` re-check every run to keep templates and hooks current regardless of when they were last applied.
- **CLI flags**: `--dry-run`, `--apply`, `--force`, `--only <ids>`, `--category <cat>`, `--list`, `--verbose` for full control over migration behavior.

### Fixed

- **Assessment migration check false positive**: `migrate-assessments-to-lore` no longer reports as pending after entries have been migrated (now checks for unmigrated YAML files rather than directory existence).

### Changed

- **`paradigm upgrade` deprecated**: Now shows deprecation notice directing users to `paradigm migrate`. Existing functionality preserved for `--from-horizon` migration path.
- **Version sync**: `@a-company/paradigm-mcp` 3.21.0 → 3.34.0, `@a-company/university` 3.10.6 → 3.34.0, plugin 3.24.1 → 3.34.0.

## [3.33.0] — 2026-03-12

### Added

- **Component types (`type` field on PurposeItem)**: Optional open-string `type` field on components describes structural role (view, service, tool, router, filter, etc.). Added to `PurposeItem` interface and Zod schema (`@a-company/purpose-core`).
- **Component hierarchy (`parent` field on PurposeItem)**: Optional `parent` field establishes component hierarchy, declared on child components with `#` symbol reference.
- **`componentType` and `parentSymbol` on SymbolEntry**: Propagated through aggregation from .purpose items to the unified symbol index (`@a-company/premise-core`).
- **Component type query functions (`@a-company/premise-core`)**: `getComponentsByType()`, `getAllComponentTypes()`, `getChildComponents()` — filter and query components by structural type.
- **`componentType` filter on `paradigm_search`**: New optional parameter filters search results by component type.
- **Component type breakdown in `paradigm_status`**: Status response now includes `componentTypes` section showing count per type.
- **`componentType` on ScanElement, `componentTypes` on ScanIndexMeta (`@a-company/probe-core`)**: Scan index elements carry their component type; `$meta` aggregates type counts.
- **`componentTypeBreakdown` in reindex result**: `paradigm_reindex` reports typed component counts in rebuild output.
- **`symbolsByComponentType` in navigator.yaml**: Navigator groups symbols by their component type for quick lookup.
- **`type` and `parent` parameters on `paradigm_purpose_add_component`**: MCP tool accepts structural type and parent component when creating/updating components.
- **`component_types` glossary in `.paradigm/config.yaml`**: 17 type definitions (command, tool, utility, engine, loader, writer, service, model, view, provider, manager, detector, router, filter, store, handler, config).
- **University lesson: "Component Types & Hierarchy" (para-101)**: Covers type vs tag distinction, parent field, config glossary, MCP integration, with 3 quiz questions.
- **PLSAT questions (slots 100–102)**: 3 new assessment slots covering type vs tag usage, open-string types, parent declarations, and componentType search.
- **Migrated 208 components across 5 .purpose files**: Added `type` (and `parent` where applicable) to `packages/conductor/.purpose`, `packages/paradigm-mcp/.purpose`, `packages/paradigm/.purpose`, and `packages/paradigm/src/core/.purpose`.
- **CLAUDE.md documentation**: New "Component Types" section documenting type/parent fields, type vs tag distinction, MCP usage, and updated conventions.

## [3.32.4] — 2026-03-11

### Fixed

- **Gaze calibration collected wrong data (`#gaze-calibration`)**: Calibration view was receiving the already-calibrated screen-pixel stream instead of raw iris positions (0–1 normalized). The affine transform trained on screen→screen instead of iris→screen, producing a tiny, mis-scaled, Y-inverted mapping. Now passes a dedicated `rawIrisStream` for sample collection.
- **Calibration feedback dot off-screen (`#gaze-calibration`)**: Yellow gaze dot during calibration multiplied screen-pixel values by screen dimensions (treating ~960 as normalized 0–1), pushing it millions of pixels off-screen. Now correctly converts raw iris to screen coordinates.
- **Only 3 of 5 calibration points used (`#gaze-calibration`)**: `affineMap` used only the first 3 points for a basic affine, discarding points 4 and 5. Replaced with least-squares affine fitting over all collected points for more robust mapping.
- **Kalman filter stale after recalibration (`#vision-gaze-provider`)**: Kalman filter state wasn't reset after calibration, so the old mapping's velocity/position estimates corrupted the new calibration. Now resets on calibration completion.

### Added

- **Raw iris stream (`#vision-gaze-provider`)**: New `rawIrisStream` publishes pre-calibration iris positions (0–1 normalized) alongside the existing calibrated `gazePointStream`. Used by calibration and debug overlay.
- **Calibration quality diagnostics (`#gaze-calibration`)**: `calibrationQuality()` returns average residual in pixels; `residuals()` returns per-point error breakdown. Logged after calibration.
- **Enhanced gaze debug overlay (`#gaze-cursor`)**: Cyan dot (calibrated position) + yellow dot (raw iris estimate) + monospace coordinate label. Shows both pre- and post-calibration gaze positions for diagnosing mapping issues.

## [3.32.3] — 2026-03-11

### Fixed

- **Send button disabled with zone router target (`#buffer-view`)**: Send button was checking only `gazeRouter.currentTarget` and ignoring `gazeZoneRouter.targetedInstance`, leaving it disabled even when a workspace cell was targeted. Now enables when either target source has a target.
- **Dispatch uses zone router target (`#input-orchestrator`)**: `dispatchToTarget()` now prefers `gazeZoneRouter.targetedInstance.instance` over `gazeRouter.currentTarget`, so Send works correctly with workspace-managed instances.
- **All bracketed tokens stripped (`#whisper-voice-provider`)**: `cleanTranscription()` now removes any `[...]` token (e.g. `[inaudible]`, `[NOISE]`, `[BLANK_AUDIO]`) using generic bracket stripping instead of a hardcoded list. Fixes lowercase/mixed-case tokens leaking through.

## [3.32.2] — 2026-03-11

### Fixed

- **`[BLANK_AUDIO]` spam filtered (`#whisper-voice-provider`)**: WhisperKit special tokens (`[BLANK_AUDIO]`, `[SILENCE]`, `[NO_SPEECH]`, etc.) are now stripped from transcription output before yielding results. Fixes repeated `[BLANK_AUDIO]` appearing in the buffer after toggling voice off.
- **Continuous voice flush on stop (`#whisper-voice-provider`)**: `stopContinuous()` now flushes remaining buffered audio for transcription instead of silently discarding it. Ensures speech captured before toggling off still gets transcribed.
- **Minimum sample threshold reduced (`#whisper-voice-provider`)**: Lowered from 24000 (0.5s) to 12000 (0.25s) samples so shorter utterances are not silently dropped.

## [3.32.1] — 2026-03-11

### Fixed

- **Gaze status display (`#input-status`)**: Input Status panel now shows gaze coordinates even when not calibrated (e.g. "Uncalibrated (960, 540)") instead of short-circuiting to "Active — not calibrated". This lets users verify gaze data is flowing before running calibration.

### Added

- **Continuous voice recording (`#whisper-voice-provider`)**: When voice is toggled on, recording now starts immediately in continuous mode — 4-second chunks auto-transcribed via WhisperKit. No longer requires eyebrow trigger or push-to-talk. Transcription text flows directly to the buffer. Input Status shows "Listening..." in continuous mode vs "Recording..." in push-to-talk mode.

## [3.32.0] — 2026-03-11

### Changed

- **Shared camera architecture (`#shared-camera`)**: Replaced dual-camera conflict (Python/OpenCV vs AVCaptureSession) with a single `SharedCameraSession` that distributes frames to all Vision-based providers simultaneously. Both gaze and gesture providers now run their own Vision requests on the same camera frames — no mutual exclusion, no camera conflict.

- **Native Vision gaze provider (`#vision-gaze-provider`)**: Replaced `MediaPipeGazeProvider` (Python subprocess + OpenCV + MediaPipe) with `VisionGazeProvider` using Apple Vision framework `VNDetectFaceLandmarksRequest`. Extracts pupil positions for gaze estimation and eyebrow distances for raise detection — all natively, no Python dependency. Reuses existing `GazeCalibration` and `KalmanFilter2D` pipeline.

- **VisionGestureProvider shared camera**: Gesture provider no longer creates its own `AVCaptureSession`. Receives frames from `SharedCameraSession` via `CameraFrameConsumer` protocol. `setSharedCamera()` must be called before `start()`.

- **InputOrchestrator simplified**: Removed camera conflict logic and mutual exclusion between gaze/gesture. Both providers start independently via shared camera. `startVideoProviders()` creates and starts both without priority ordering. `sharedCamera` is owned by the orchestrator.

### Removed

- **Python gaze dependency**: No longer requires Python 3, OpenCV, or MediaPipe installed. `MediaPipeGazeProvider.swift` retained in codebase as fallback reference but is no longer used by the orchestrator or AppDelegate.

## [3.31.2] — 2026-03-11

### Fixed

- **Camera conflict handling (`#input-orchestrator`)**: macOS only allows one process to hold the camera — gesture provider (native AVCaptureSession + Vision) now gets priority over gaze provider (Python/OpenCV subprocess). Gaze provider skips startup when gesture is active instead of silently failing. Clear error messaging: "Blocked — camera in use by gestures" shown in Input Status panel.

- **Provider error surfacing (`#input-orchestrator`)**: Added `lastError` published property. Provider start failures now display in an orange warning banner in the Input Status panel instead of being silently swallowed.

- **Gaze status detail**: Input Status now shows "Blocked — camera in use by gestures" when gaze can't start due to camera conflict, instead of misleading "Active — not calibrated".

## [3.31.1] — 2026-03-11

### Added

- **Input Status monitor (`#input-status`)**: Live sidebar panel showing real-time status of all four input modalities — gaze (eye tracking coordinates), eyebrows (smoothed L/R values), voice (model state, recording state, last transcription), and gestures (hand detection state). Color-coded dots: gray = off, yellow = active but no data, green = receiving, red = recording.

- **`lastTranscription` on InputOrchestrator**: Published property showing the most recent voice transcription text, displayed in the Input Status panel for immediate speech feedback.

## [3.31.0] — 2026-03-11

### Added

- **Conductor 0.4.0 — Video/Voice Toggles + Terminal Close Fix**

  - **Video/voice toggle icons**: Header bar now shows camera (video.fill/video.slash.fill) and mic (mic.fill/mic.slash.fill) toggle buttons with live green/gray state indicators. Click to toggle gaze+gesture camera or voice mic on/off.

  - **Global hotkeys**: `Cmd+Shift+V` toggles video (gaze+gesture), `Cmd+Shift+M` toggles voice. Registered via CGEvent tap in `#hotkey-manager`, wired through `#conductor-app` to `#input-orchestrator`.

  - **New ConductorAction cases**: `toggleVideo`, `toggleVoice`, `muteVideo`, `muteVoice`, `unmuteVideo`, `unmuteVoice` — all bindable via voice commands and custom gestures in the Bindings tab.

  - **InputOrchestrator provider lifecycle**: `videoActive`/`voiceActive` published state. `startVideoProviders()`/`stopVideoProviders()`/`toggleVideo()` and matching voice methods. Gaze and gesture providers now actually call `.start()` during orchestrator startup (previously only voice was started — **this was a bug**).

  - **`LaunchedTerminal` struct**: `TerminalLauncher.launch()` now returns `LaunchedTerminal` with `processID`, `windowIdentifier`, and `terminalApp`. Terminal.app returns the AppleScript window ID, iTerm2 returns the session ID.

  - **`TerminalLauncher.closeWindow()`**: Static method for targeted close — AppleScript `close window N` for Terminal.app, session-targeted close for iTerm2, SIGTERM fallback for per-window terminals (Ghostty, Kitty, etc.).

  - **Gesture confirmation overlay (`#gesture-confirmation`)**: Top-center toast showing recognized gesture name and bound action, auto-fades after 1.5s. Toggle via Settings > Input > Gestures > "Show gesture confirmation overlay". Covers built-in gestures, custom DTW gestures, eyebrow events, and voice commands. Great for practice.

  - **Buffer listening state**: When voice is active, the text buffer shows a red "Listening" badge, red border glow, and subtle shadow — clear visual feedback that the mic is receiving.

  - **On-demand provider creation**: Video/voice toggles now create providers on the fly if they weren't enabled at startup. No need to toggle settings first — just hit the header icon or hotkey.

  - **Live gaze dot during calibration**: `GazeCalibrationView` now renders a yellow dot tracking the user's estimated gaze position in real time, so you can see whether you're actually looking at the target.

### Fixed

- **Terminal close kills all windows**: `WorkspaceManager.closeInstance()` was calling `kill(pid, SIGTERM)` on Terminal.app's application PID, which killed the entire app and all windows. Now uses AppleScript targeted close via window identifier — only the Conductor-launched window is closed.

- **Terminal.app AppleScript error ("Can't get window of tab")**: `do script` returns a tab reference, not a window. Changed to `id of front window` after script execution.

- **Gaze/gesture providers never started**: `InputOrchestrator.start()` subscribed to gaze/gesture streams but never called `.start()` on the providers. Camera was never activated except during calibration (which had its own explicit `.start()` call). Now fixed — all enabled providers are started during orchestrator startup.

- **Provider cleanup on stop**: `InputOrchestrator.stop()` now properly calls `.stop()` on all active providers and resets `videoActive`/`voiceActive` state.

- **Eyebrow calibration not tracking**: Calibration started without ensuring the gaze provider was active. Now creates and starts the provider before opening the calibration overlay.

- **Can't select workspace windows**: Tapping a managed instance was a no-op when the AX link hadn't been established (common for Terminal.app). Now falls back to `NSRunningApplication.activate()` to bring the terminal window to front.

### Changed

- **Conductor version**: 0.3.1 → 0.4.0
- **`ManagedInstance`**: New `windowIdentifier: String?` field for AppleScript-targeted close
- **`WorkspaceManager.cleanup()`**: Uses `TerminalLauncher.closeWindow()` instead of raw `kill()`
- **`SettingsPanelView` hotkeys section**: Now lists Toggle Video (Cmd+Shift+V) and Toggle Voice (Cmd+Shift+M), refactored to `hotkeyBadge()` helper
- **`BindingsManagerView` voice command picker**: Includes toggleVideo, toggleVoice, muteVideo, muteVoice options
- **`ActionRegistry` serialization**: Handles all 6 new action cases in `actionFromName`/`nameFromAction`
- **`InputOrchestrator`**: Publishes `lastRecognizedGesture` for the confirmation overlay to consume
- **`BufferView`**: Accepts `orchestrator` param, shows listening state visuals when `voiceActive`

## [3.30.0] — 2026-03-11

### Added

- **Conductor 0.3.1 — Wiring Fixes + UX Improvements**: Resolves 7 runtime wiring gaps in the 0.3.0 sprint output. The S8–S13 components compiled and tested individually but were structurally assembled without being wired at runtime. This release fixes the ownership inversion that left the InputOrchestrator inert.

  - **Single-owner architecture (`~single-owner`)**: AppDelegate is now the sole lifecycle owner of `InputOrchestrator`, `BufferEngine`, and `WorkspaceManager`. MainOverlayView switches from `@StateObject` to `@ObservedObject` — it observes, never owns. Eliminates the duplicate `WorkspaceManager` and `BufferEngine` that existed in the view layer.

  - **`$orchestrator-startup` flow**: `applicationDidFinishLaunching` → read `UserDefaults` → create providers conditionally (gaze/gesture/voice only when enabled) → wire workspace → `orchestrator.start()` → UI ready. Providers are created/destroyed mid-session when the user toggles preferences.

  - **Settings tabs fully wired**: `ConductorApp.Settings` now passes `workspaceManager`, `actionRegistry`, `voiceCommandRegistry`, and `customGestureClassifier` from `appDelegate.orchestrator`. Workspace and Bindings tabs render for the first time.

  - **Real gaze calibration**: `handleRecalibrate()` feeds `orchestrator.gazeProvider.gazePointStream` to the calibration overlay when a gaze provider exists. Falls back to simulated data only when gaze is disabled.

  - **`.voiceArm` action**: New `ConductorAction.voiceArm` emitted by `EyebrowStateMachine` on idle→armed and stopped→re-armed transitions. `InputOrchestrator` calls `voiceCoordinator.arm()`. VoiceControlHUD now correctly shows the full state progression: gray (idle) → yellow (armed) → red (recording) → spinner (transcribing) → green (ready).

  - **SetupWizard expansion**: Two new steps — workspace configuration (sidebar position + width) and eyebrow calibration (when eyebrow control enabled). Step routing updated for all combinations of enabled features.

  - **`EyebrowCalibrationWindowController`**: Fullscreen NSWindow for eyebrow calibration, mirrors `CalibrationWindowController` pattern. Feeds real eyebrow frames from gaze provider to `EyebrowCalibration`, applies computed thresholds to `EyebrowDetector` on completion.

- **New Conductor symbols**: `$orchestrator-startup` flow, `^providers-ready` + `^conductor-launched` gates, `~single-owner` + `~zone-deterministic` + `~user-configurable` aspects, `#eyebrow-calibration-controller` component, `!eyebrow-calibration-complete` signal.

### Changed

- **Conductor version**: 0.3.0 → 0.3.1
- **`AppDelegate`**: Owns orchestrator lifecycle, creates/destroys providers on preference change, handles eyebrow calibration notifications, clean shutdown sequence (`orchestrator.stop()` → `workspaceManager.cleanup()`)
- **`MainOverlayView`**: No longer owns any stateful components. Accepts `orchestrator` and `workspaceManager` as init params. `dispatchBuffer()` delegates to `orchestrator.executeAction(.send)` instead of maintaining its own `AXDispatchTarget`.
- **`EyebrowStateMachine`**: Armed transitions now emit `.voiceArm` instead of `nil` — 2 test assertions updated accordingly
- **`ActionRegistry`**: `voiceArm` added to serialization helpers (`actionFromName`/`nameFromAction`)

### Fixed

- InputOrchestrator was never started — `orchestrator.start()` now called from `AppDelegate.setupOrchestrator()`
- Input providers were always nil — created from `UserDefaults` preferences during setup
- Two `WorkspaceManager` instances existed (AppDelegate + MainOverlayView) — now single instance passed through
- Settings Workspace and Bindings tabs showed empty content — dependencies now injected from app delegate
- Gaze calibration used simulated data even when a real provider was available
- VoiceControlHUD skipped the armed (yellow) state — `.voiceArm` action now fires `coordinator.arm()`
- SetupWizard had no workspace configuration or eyebrow calibration steps

## [3.29.0] — 2026-03-10

### Added

- **Conductor 0.3.0 — Workspace Manager + Eyebrow Voice Control + Custom Bindings**: Six-sprint implementation (S8–S13) transforming Conductor from a passive overlay into a full workspace manager and extensible multimodal input system. 29 new source files, 6 new test files, 26 modifications to existing files.

  - **S8 — Eyebrow Detection + InputOrchestrator**: Extended MediaPipe FaceMesh Python script to extract eyebrow landmark distances (LEFT_BROW_TOP [223,222,221], RIGHT_BROW_TOP [443,442,441]) alongside existing gaze data. New `#eyebrow-detector` with KalmanFilter1D smoothing and raise/lower hysteresis thresholds (0.035/0.025). `#eyebrow-state-machine` maps eyebrow gestures to voice control: left raise → arm, left lower → start recording, left raise → stop, right raise → send. `#input-orchestrator` wires all input streams (eyebrow, voice, gesture, gaze) through a unified `#action-registry` → `ConductorAction` enum pipeline. `EyebrowStateMachineWrapper` provides @MainActor-safe access.

  - **S9 — Workspace Manager + Terminal Launching**: `#workspace-manager` launches and owns Claude Code terminal instances, arranges them in a deterministic grid. `#terminal-launcher` supports 6 terminal apps (Terminal.app, iTerm2, Ghostty, Warp, Kitty, Alacritty) via AppleScript/NSWorkspace. `#workspace-grid` computes cell frames for 1–6 instances with configurable sidebar position/width. `ConductorPanel` now supports sidebar mode (full-height, edge-snapped) alongside legacy floating overlay. `WorkspaceView` replaces `InstanceListView` as primary UI with grid minimap and instance management.

  - **S10 — Gaze-to-Grid Zone Targeting**: `#gaze-zone-router` maps gaze points to grid cells deterministically using `WorkspaceGrid.cellIndex(for:)`. Dwell timer (0.5s) locks target before dispatch. `GazeZoneOverlay` shows grid boundaries and active zone highlight. BufferView shows "Will send to: [Cell N] label" when zone router has a target.

  - **S11 — Full Voice Pipeline Wiring**: `#voice-control-coordinator` manages the complete voice lifecycle: idle → armed → recording → transcribing → readyToSend → error. Auto-recovery from errors after 3 seconds. Duration counter for recording feedback. `#voice-control-hud` shows visual states (gray mic, yellow pulse, red pulse+waveform, spinner, green check). WhisperKit pre-loaded at orchestrator startup.

  - **S12 — Polish + Settings + Calibration**: `#eyebrow-calibration` 4-step flow (restLeft → raiseLeft → restRight → raiseRight) collecting 30 samples per step, computing personalized raise/lower thresholds. `EyebrowCalibrationView` fullscreen overlay with real-time distance bars. `WorkspaceSettingsView` adds Settings tab for default terminal, sidebar position/width, max instances, auto-arrange toggle.

  - **S13 — Custom Gesture Recording + Voice Command Binding**: Full user-configurable input system. `#gesture-recorder` captures hand pose time-series (5 samples), normalizes and averages into `GestureTemplate` stored at `~/.conductor/gestures/`. `#dtw-matcher` (Dynamic Time Warping) matches incoming hand poses against templates with configurable thresholds. `#custom-gesture-classifier` uses 30-frame sliding window, matching every 5 frames, max 20 templates. `#voice-command-matcher` scans transcription start/end for registered phrases with fuzzy matching (Levenshtein distance). `#voice-command-registry` manages phrase→action bindings with defaults (send, undo, redo, cancel). `BindingsManagerView` provides three-section Settings tab for custom gestures, voice commands, and built-in gesture info. `GestureRecorderView` full-screen recording UI with progress circles and action picker.

- **Conductor test coverage expansion**: 66 new tests across 6 test suites — `EyebrowStateMachineTests` (12), `WorkspaceGridTests` (10), `GazeZoneRouterTests` (8), `VoiceControlCoordinatorTests` (9 with 1 existing modified), `DTWMatcherTests` (8), `VoiceCommandMatcherTests` (8). Total: 102 tests (up from 45).

- **New Conductor symbols**: ~20 new components (#eyebrow-detector, #eyebrow-state-machine, #input-orchestrator, #action-registry, #workspace-manager, #terminal-launcher, #workspace-grid, #gaze-zone-router, #voice-control-coordinator, #voice-control-hud, #eyebrow-calibration, #workspace-settings, #gesture-recorder, #gesture-template, #dtw-matcher, #custom-gesture-classifier, #voice-command-matcher, #voice-command-registry, #bindings-manager, #gesture-recorder-view). 9 new flows. 11 new signals.

### Changed

- **Conductor version**: 0.2.1 → 0.3.0
- **`ConductorPanel`**: Now supports both sidebar mode (full-height, edge-snapped, non-draggable) and legacy floating overlay mode. Configurable width (280–500px) and screen edge.
- **`AppDelegate`**: Made `@MainActor` for proper Swift 6 concurrency. Initializes `WorkspaceManager`, cleans up on quit.
- **`MainOverlayView`**: Restructured as sidebar layout with `InputOrchestrator`, `WorkspaceManager`, `VoiceControlHUD`, `WorkspaceView`, and `AddInstanceSheet`.
- **`SettingsPanelView`**: Five tabs (General, Input, Context, Workspace, Bindings). New eyebrow control section with sensitivity slider and calibration button. Voice mode picker includes "Eyebrow Trigger". Gaze cursor toggle.
- **`MediaPipeGazeProvider`**: Python script extended to output 4 values (gaze_x, gaze_y, left_raise, right_raise). Swift parser handles both 2-value and 4-value output for backward compatibility. New `eyebrowStream` AsyncStream.
- **`VisionGestureProvider`**: Exposes raw `handPoseStream` alongside existing `gestureStream` for custom gesture recording/matching. Extracts 10-joint `HandPoseFrame` from VNHumanHandPoseObservation.

## [3.28.0] — 2026-03-10

### Added

- **WhisperKit integration**: `#whisper-voice-provider` now uses real WhisperKit 0.16.0 (CoreML, Apple Silicon) for local speech-to-text. Fully lazy — model downloads and CoreML compilation happen on first voice use, not during setup. Uses pre-downloaded model folder when available, with 90-second timeout to prevent indefinite hangs. CMSampleBuffer→Float conversion, confidence scoring from segment data.

- **Setup wizard** (`#setup-wizard`, `#dependency-checker`): Multi-step onboarding flow — feature selection (voice/gestures/gaze toggles), WhisperKit model picker (tiny.en/base.en/small.en), dependency verification (Python 3, MediaPipe/OpenCV), retry for failed checks, gaze calibration step (no longer auto-skips), ready summary. Inserted between permissions onboarding and main content. Re-runnable from Settings.

- **Conductor version display**: Header bar shows "v0.2.0" next to the Conductor title.

- **Gaze calibration UI**: Fullscreen 5-point calibration overlay (`GazeCalibrationView`, `CalibrationWindowController`). Pulsating cyan targets with clockwise dwell-fill animation, 2-second dwell per point, ESC to cancel, iris sample averaging from live gaze stream. Wired to `MediaPipeGazeProvider.calibrate()` and the Settings "Recalibrate..." button via NotificationCenter.

- **MCP auto-registration with Conductor**: `paradigm-mcp` now auto-registers the session with Conductor on startup — writes `~/.conductor/sessions/{pid}.json` automatically. Process exit cleanup via `SIGTERM`/`exit` handlers. No user action required; `/conduct` still works for adding labels or re-registering.

- **Toggleable gaze cursor debug overlay** (`#gaze-cursor`): Click-through transparent window showing gaze position dot. Toggle from Settings panel. Includes `GazeCursorView` (SwiftUI pulsating dot) and `GazeCursorWindowController` (NSPanel click-through management).

- **Conductor test coverage**: 36 new unit tests across 5 test files — `GestureStateMachineTests` (12), `KalmanFilter2DTests` (6), `GazeCalibrationTests` (6), `EnrichedPayloadTests` (6), `ClaudeCodeInstanceTests` (6). Total: 45 tests.

### Fixed

- **WhisperKit loading hang**: `WhisperKit.download()` and `WhisperKit()` init hung indefinitely during CoreML compilation. Fixed by deferring all model work to first voice use, pointing directly at pre-downloaded model folder (`~/Documents/huggingface/`), and adding a 90-second timeout via task group race.

- **Setup wizard gaze calibration auto-skip**: "Start Calibration" immediately advanced to the ready step without waiting. Now stays on the calibration step so users see the result and click Continue manually.

- **`paradigm conductor` CLI path resolution**: Command now works when run from inside `packages/conductor/` or any subdirectory of the monorepo, not just the root. Added cwd-is-conductor detection and upward walk from cwd.

### Changed

- **Conductor tools refactored**: `detectTerminalBundleId()` and `detectGitBranch()` moved from `conductor.ts` to `conductor-loader.ts` as shared helpers for both manual registration and auto-registration.

## [3.27.0] — 2026-03-10

### Added

- **`/conduct` skill**: Register any Claude Code session with Paradigm Conductor from within the terminal. Writes a registration file to `~/.conductor/sessions/{pid}.json` that Conductor picks up instantly. Includes project dir, branch, terminal app, and optional label.

- **Conductor MCP tools** (`paradigm_conductor_register`, `paradigm_conductor_unregister`, `paradigm_conductor_list`): Programmatic session registration for Conductor. Auto-detects terminal bundle ID, git branch, and parent PID. Stale session cleanup (dead PIDs) built in.

- **Conductor `#session-file-watcher`**: Swift `SessionFileWatcher` watches `~/.conductor/sessions/` via dispatch source + 5s poll fallback. Merges file-registered sessions with AX-detected instances in the overlay, with deduplication by PID and project directory. Auto-cleans stale registrations.

- **`$session-registration` flow**: New flow covering `/conduct` → JSON file → `SessionFileWatcher` → merged instance list. Signals: `!session-registered`, `!session-unregistered`.

### Changed

- **`InstanceListView`**: Now accepts a merged instance array (AX + file-registered) instead of reading directly from `ClaudeCodeDetector`. Empty state suggests `/conduct` instead of generic "open Claude Code" message.

- **Conductor `.purpose` file**: Rewritten from YAML list format (`id:` fields) to standard Paradigm key format (`#Name:`) for proper indexing. All 30 components, 6 flows, 6 gates, 12 signals, and 4 aspects now index correctly.

## [3.26.0] — 2026-03-10

### Added

- **Paradigm Conductor** — Native macOS Swift/SwiftUI multimodal mission control for Claude Code sessions. Voice-to-buffer, hand gesture editing, gaze-targeted dispatch with Paradigm context enrichment. Launched via `paradigm conductor`.
  - **S0 — Foundation**: `#conductor-app` NSPanel floating overlay, `#conductor-panel` always-on-top window, `#permissions-onboarding` Camera/Mic/Accessibility flow, menu bar icon, 7 platform abstraction protocols (`VoiceInputProvider`, `GestureInputProvider`, `GazeTrackingProvider`, `ClaudeCodeDetectorProtocol`, `WindowArrangerProtocol`, `DispatchTargetProtocol`, `ContextEnricherProtocol`)
  - **S1 — Buffer + Window Detection**: `#text-buffer` BufferEngine with undo/redo/cursor, `#window-detector` AXUIElement + CGWindowListCopyWindowInfo polling, `#dispatch-target` AX text injection with clipboard fallback, `#buffer-view` and `#instance-list-view` SwiftUI views
  - **S2 — Voice Input**: `#whisper-voice-provider` WhisperKit speech-to-text (CoreML, Apple Silicon), `#audio-capture` AVCaptureSession microphone pipeline, push-to-talk mode
  - **S3 — Hand Gestures**: `#vision-gesture-provider` Apple Vision VNDetectHumanHandPoseRequest at 15fps, `#gesture-classifier` joint positions → actions (swipe, pinch, fist, open palm, two-finger tap), `#gesture-state-machine` debounce/cooldowns, `#gesture-hud` visual feedback
  - **S4 — Gaze Tracking**: `#mediapipe-gaze-provider` MediaPipe FaceMesh via Python subprocess, `#gaze-calibration` 5-point affine mapping, `#kalman-filter` 2D coordinate smoothing, `#gaze-router` dwell selection targeting
  - **S5 — Context Enrichment**: `#paradigm-mcp-client` stdio JSON-RPC to paradigm-mcp, `#git-monitor` polling git diff, `#context-enricher` assembles Paradigm + git context, `#sentinel-ws-client` WebSocket for real-time events
  - **S6 — Window Management**: `#window-arranger` 4 tiling layouts (focused, side-by-side, 3-up, grid), `#status-tracker` idle/processing/finished detection, `#notification-bubble` per-instance status overlay, `#agent-count-badge`
  - **S7 — Polish**: `#settings-panel` preferences (hotkeys, gestures, enrichment, camera), `#hotkey-manager` global CGEvent tap registration
  - 27 components, 5 flows, 6 gates, 10 signals, 4 aspects (~local-only, ~zero-cost, ~platform-abstracted, ~resource-conscious)
  - 51 Swift source files, 753KB arm64 release binary, macOS 14+
  - 9 unit tests for BufferEngine

- **`paradigm conductor` CLI command**: Build-and-launch command for the Conductor native binary from `packages/conductor/`

## [3.25.2] — 2026-03-10

### Added

- **`llms.txt`**: AI discoverability file at repo root following the [llmstxt.org](https://llmstxt.org/) spec — structured overview of Paradigm optimized for AI agent consumption, with curated links to docs, packages, and getting-started guides.

- **README AI discoverability**: Added language-agnostic/framework-agnostic messaging, "Who Is This For?" section, collapsed "For AI Agents: Quick Context" section, and updated University/PLSAT descriptions to reflect current state (99 questions, PARA 501, stack presets).

- **PARA 201 — Stack Presets section**: Disciplines lesson now covers the 16 stack presets with a full table, auto-detection, `--stack` flag, `paradigm presets` command, and cold-start explanation. New quiz question (q5) tests discipline vs preset understanding.

- **PARA 101 — Cold start context**: First Steps lesson now mentions discipline + stack auto-detection during `paradigm init` and the `--stack` explicit flag.

- **PLSAT v3.0 slots 097-099** (6 question variants): Stack presets vs disciplines (slot-097), `paradigm scan auto` mechanics and confidence levels (slot-098), incremental adoption and cold-start approach for existing projects (slot-099).

## [3.25.1] — 2026-03-10

### Fixed

- **Zero TypeScript errors**: Resolved all 9 pre-existing TS compilation errors in lore commands (`timeline.ts`, `list.ts`, `retag.ts`) — `entry.type` now defaults to `'note'` when undefined, removed unused imports.

- **v1 symbols in fallback config**: `createMinimalStructure` (used when templates are missing) was still generating v1 symbol system (`@feature`, `%state`, `^portal`) instead of v2 (`#component`, `$flow`, `^gate`, `!signal`, `~aspect`).

- **Dead `assessments/` directory**: Init no longer creates `.paradigm/assessments/` — assessments were consolidated into lore in 3.19.0. Now creates `.paradigm/lore/` instead.

- **React Native discipline detection**: Moved React Native/Expo check before the generic UI deps check in `detectDiscipline()`. Previously, a React Native project with `react` in deps would be incorrectly detected as `web` instead of `mobile`.

- **Silent error swallowing**: Replaced ~8 empty `catch {}` blocks in `shift.ts` and `index-loader.ts` with debug-level log statements. The workspace loading path in `index-loader.ts` now emits a visible warning on YAML parse failure (the root cause of the workspace bug fixed in 3.24.1).

- **Duplicate `detectProjectType`**: Replaced the parallel detection function in `init.ts` with one that uses stack presets, eliminating a duplicated detection path.

## [3.25.0] — 2026-03-10

### Added

- **Stack presets**: 16 framework-specific presets layered on top of disciplines for precise cold-start configuration. `paradigm init --stack nextjs` or auto-detected from project files. Each preset provides tailored `symbol-mapping`, `purpose-required`, and `scanHints` for the framework.
  - **Fullstack**: nextjs, remix, nuxt, sveltekit, astro
  - **Web**: react-spa, vue-spa
  - **API**: express, fastify, fastapi, django, gin, axum
  - **Mobile**: swift-ios, kotlin-android, flutter

- **`paradigm presets` command**: List all available stack presets, optionally filtered by discipline (`--discipline mobile`).

- **`--stack` flag** on `paradigm init` and `paradigm shift`: Explicitly set a stack preset, or omit for auto-detection.

- **`stack:` field** in `.paradigm/config.yaml`: Records the detected/chosen stack preset alongside the discipline.

## [3.24.1] — 2026-03-08

### Fixed

- **Config template duplicate YAML keys**: `paradigm init` / `paradigm shift` generated `config.yaml` files with duplicate mapping keys in `symbol-mapping` when applying discipline-specific settings. The regex replacing the template section stopped at blank lines between category groups, leaving leftover template entries that duplicated the discipline entries. This caused `js-yaml` to throw a `duplicated mapping key` error, which silently broke workspace loading (the `workspace:` field was never read).

## [3.24.0] — 2026-03-08

### Added

- **Auto-graph on scan** (1.3): `paradigm scan` now auto-generates `.paradigm/graphs/auto.graph.json` after every index rebuild. Configurable via `graph.auto-generate` in config.yaml (default: true). Symbol graph UI always shows current data with zero manual effort.

- **Doctor context audit** (1.2): `paradigm doctor --context` runs 7 new AI instruction file quality checks:
  - `stale-references` — dead file/dir paths in CLAUDE.md, .cursorrules, AGENTS.md (Error)
  - `convention-contradictions` — conflicting naming/style directives (Warning)
  - `undocumented-stack` — major deps not mentioned in instruction files (Advisory)
  - `purpose-coverage` — percentage of source dirs with .purpose coverage (Warning <80%)
  - `orphaned-symbols` — symbols with zero cross-references (Advisory)
  - `stale-portal` — portal routes with no matching implementation file (Error)
  - `instruction-vagueness` — vague language like "try to", "maybe", "if possible" (Advisory)

- **Garbage collection sweeps** (2.2): `paradigm sweep` with 9 entropy checks and auto-fix:
  - Orphaned symbols, stale purpose, phantom gates, dead signals, broken flows, lore rot, tag orphans, aspect semantic drift, coverage decay
  - Fix ON by default (`--dry` for report only)
  - Auto-records lore entry tagged `arc:sweep` after every run
  - Strict thresholds: 14-day staleness, 90% coverage minimum

- **Adaptive heat map** (2.3): Query-to-symbol relevance learning with 3 new MCP tools:
  - `paradigm_heatmap_query` — find historically relevant symbols for keywords
  - `paradigm_heatmap_record` — record/correct keyword-symbol associations (positive/negative signals)
  - `paradigm_heatmap_stats` — view heat map statistics and top associations
  - Confidence decay (5% per 30 days without reinforcement)
  - Static tier classification (hot/warm/cold) added to scan index entries

- **Spec pipeline** (3.2): Gated 5-stage workflow with 7 new MCP tools + CLI:
  - Stages: specify → plan → task → implement → validate
  - 3 gate modes: auto (pass-through), manual (human approval), sentinel (automated checks)
  - 4 built-in templates: add-feature, bug-fix, security-change, refactor
  - CLI: `paradigm pipeline start|status|advance|configure|abort|list`
  - MCP: `paradigm_pipeline_start|status|advance|configure|escalate|abort|list`
  - Pipeline state persisted as YAML in `.paradigm/pipeline/`
  - Completed pipelines archived to `.paradigm/pipeline/completed/`

### Changed

- `@a-company/paradigm` 3.23.4 → 3.24.0
- `@a-company/paradigm-mcp` 3.18.1 → 3.19.0 (10 new MCP tools)
- Doctor command refactored from single file to `commands/doctor/` directory

## [3.23.4] — 2026-03-08

### Added

- **Cross-study and expansion planning lore** (`@a-company/paradigm` 3.23.3 → 3.23.4): Recorded strategic planning sessions as lore entries
  - `L-2026-03-07-ascend-222941-001`: Deep landscape scan of 15 paradigm-adjacent frameworks across 5 competitive tiers (Packmind, Kiro, Spec Kit, Harness Engineering, Codified Context, AAIF, Augment Code, Sourcegraph, and more)
  - `L-2026-03-08-ascend-054731-001`: Item-by-item audit of 9 expansion plan initiatives — 2 struck (already shipped), 2 deferred, 5 active with expanded scope
  - Personas index auto-generated during reindex
  - History index updated with recent implementation events

## [3.23.3] — 2026-03-07

### Fixed

- **Skill shell injection compatibility** (`@a-company/paradigm` 3.23.2 → 3.23.3, plugin 3.24.0 → 3.24.1): Shell injections (`!` commands) in 3 skills used `&&`/`||` chaining and pipe operators which Claude Code's permission checker rejects as multi-operation commands
  - `doctor`: 4 injections using `test -f && echo || echo` and subshells → simplified to `ls` commands
  - `preflight`: 1 injection using `test -f && echo || echo` → `ls`, 1 using `git status | head` → removed pipe
  - `ripple`: 1 injection using `test -f && echo || echo` → `ls`
  - `handoff`: 1 injection using `git status | head` → removed pipe

## [3.23.2] — 2026-03-07

### Fixed

- **Purpose file validation cleanup** (`@a-company/paradigm` 3.23.1 → 3.23.2): Fixed 6 validation issues across 3 `.purpose` files
  - `packages/paradigm/src/core/.purpose`: Aspects `habits-loader` and `habits-types` missing `~` prefix and required anchors — replaced with proper `~habits-loader` and `~habits-types` aspects with code anchors
  - `packages/sentinel-web/.purpose`: Converted from non-standard array-style format to map-style; added missing `name` field on `$event-ingestion` flow
  - `packages/premise/core/.purpose`: Flow `$symbol-aggregation` referenced undefined `#symbol-extractor` — changed to `#aggregator` which contains the extraction logic

## [3.24.0] — 2026-03-05

### Added

- **Skills v2 upgrade** (plugin 3.23.1 → 3.24.0): All 13 plugin skills upgraded to Claude Code Skills v2 format with full YAML frontmatter
  - **Forked context** (`context: fork`) on 8 skills — preflight, postflight, sentinel, doctor, observe, ripple, review, handoff run in isolated subagents, keeping the main conversation clean
  - **Agent routing** — analysis skills route to `paradigm:architect`, compliance skills to `paradigm:reviewer`, data-fetching to `Explore`
  - **Shell injection** (`!`command``) on 5 skills — git status, diffs, config checks pre-loaded before the prompt starts, saving 2-4 MCP round-trips per invocation
  - **Tool restrictions** (`allowed-tools`) on all 13 skills — read-only analysis skills can't accidentally write files
  - **Manual-only** (`disable-model-invocation`) on init, shift, scan — prevents unintended auto-triggering
  - **Argument hints** (`argument-hint`) on 5 skills for autocomplete UX
- **3 new skills**: `/paradigm:ripple` (forked impact analysis), `/paradigm:review` (forked compliance review), `/paradigm:handoff` (forked session handoff)
- **Skills v2 design spec** at `docs/specs/skills-v2-upgrade.md` — full migration plan, token savings analysis, risk matrix, and long-term vision

## [3.23.1] — 2026-03-05

### Fixed

- **Plugin version detection uses semver sort** (`@a-company/paradigm` 3.23.0 → 3.23.1, `@a-company/paradigm-mcp` 3.18.0 → 3.18.1): Plugin update checker used alphabetical `.sort()` on cache directory names, causing `3.9.0` to rank above `3.23.0` (since `"9" > "2"` in string comparison). Every project reported stale 3.9.0 as the installed version. Replaced with numeric semver comparator in both `plugin-update-checker.ts` (MCP) and `plugin/check.ts` (CLI)

## [3.23.0] — 2026-03-04

### Changed

- **Graph Generate writes to named files** (`@a-company/paradigm` 3.22.0 → 3.23.0, `@a-company/paradigm-mcp` 3.17.0 → 3.18.0): `paradigm_graph_generate` MCP tool now requires a `name` parameter and always writes to `.paradigm/graphs/{name}.graph.json`, returning a lightweight summary instead of the full JSON. Fixes token overflow on large projects (192K+ chars). CLI `paradigm graph generate` takes name as a required positional arg
- **Graph server serves saved graphs**: New `/api/graphs` and `/api/graphs/:slug` endpoints list and serve saved `.graph.json` files from `.paradigm/graphs/`
- **Load Dialog shows saved graphs**: Graph UI Load Dialog now fetches and displays saved graphs with metadata (name, node/edge counts, size, date) for one-click loading

## [3.22.0] — 2026-03-04

### Added

- **Habits CRUD MCP tools** (`@a-company/paradigm-mcp` 3.16.0 → 3.17.0): Three new MCP tools — `paradigm_habits_add`, `paradigm_habits_edit`, `paradigm_habits_remove` — for programmatic habit management with full validation. Agents can now create, update, and delete custom habits without raw-editing YAML
- **Individual `.habit` file format**: Custom habits can now live as individual `.paradigm/habits/{id}.habit` YAML files (or global `~/.paradigm/habits/`), following the same pattern as `.protocol`, `.lore`, and `.persona` files. Coexists with existing `habits.yaml` — no migration needed
- **Habit validation**: `validateHabitDefinition()` validates required fields, kebab-case IDs, enum values, and check type/param consistency
- **5-step habit merge order**: Both MCP and CLI loaders now load habits from: seeds → global yaml → global .habit files → project yaml → project .habit files
- **Release version-bump habit**: New blocking on-stop habit (`release-version-bump.habit`) enforces package version bumps before session ends, with per-package versioning rules
- **Symbol Graph UI** (`paradigm graph`): Interactive React + xyflow canvas for visualizing symbol relationships. Includes drag-and-drop nodes, grouping, save/load, PNG/JSON export, and real-time symbol data from a local Express server
- **Graph Generate MCP tool** (`paradigm_graph_generate`): Produces GraphState JSON for the Symbol Graph UI from scan-index data with auto-positioned nodes and group layout

## [3.20.2] — 2026-03-04

### Fixed

- **Lore viewer crashes on old author format** (`@a-company/paradigm` 3.20.1 → 3.20.2): Fix 500 errors on `/api/lore/symbols` and `/api/sessions` when lore entries have the old `{type, id, model}` author object format. Fix React error #31 in LoreCard and DetailPanel by rendering author defensively. Normalize non-array `symbols_touched`/`symbols_created` fields to arrays

## [3.20.1] — 2026-03-03

### Fixed

- **Plugin version sync** (`@a-company/paradigm` 3.20.0 → 3.20.1): Sync Claude Code plugin version to match paradigm CLI version (3.13.0 → 3.20.0)

## [3.20.0] — 2026-03-03

### Added

<!-- impact: runtime -->
- **New package: `@a-company/paradigm-runtime` v0.1.0** — Runtime contracts for Paradigm Studio. Graph schema types, runtime API operation types (query/write/traverse/computed), forward-only migration engine with diff generator and history tracking, version fingerprinting for cross-component compatibility checking. Sub-path exports: `/schema`, `/migration`, `/logger`, `/telemetry`

<!-- impact: logger -->
- **Logger API stability annotations** (`@a-company/paradigm-logger` 3.5.0 → 3.5.1): Added `@public @stable` JSDoc annotations to all exported types in `packages/logger/src/types.ts`. Created `packages/logger/API.md` documenting the public contract

<!-- impact: dev-only -->
- **Changelog impact tags**: Established convention for `<!-- impact: runtime|logger|schema|sentinel|dev-only|migration -->` HTML comments on changelog entries for programmatic parsing by Studio platform

### Changed

<!-- impact: dev-only -->
- **Root monorepo scripts** (`@a-company/paradigm` 3.19.4 → 3.20.0): Added `@a-company/paradigm-runtime` to `build:packages` (after sentinel) and `publish:all` scripts

## [3.19.4] — 2026-03-02

### Fixed

- **PLSAT scroll bounce and code block clipping** (`@a-company/paradigm` 3.19.3 → 3.19.4, `@a-company/university` 3.10.3 → 3.10.4): Remove nested scroll containers (no more bounce); remove `overflow: hidden` from choice buttons so code blocks scroll horizontally; widen answer column to `1.5fr`

## [3.19.3] — 2026-03-02

### Fixed

- **PLSAT container still too narrow** (`@a-company/paradigm` 3.19.2 → 3.19.3, `@a-company/university` 3.10.2 → 3.10.3): Widen PLSAT container to 1400px unconditionally (was 1200px via `:has()`); add `min-width: 0` on grid columns to prevent code block overflow

## [3.19.2] — 2026-03-02

### Fixed

- **PLSAT split layout too narrow** (`@a-company/paradigm` 3.19.1 → 3.19.2, `@a-company/university` 3.10.1 → 3.10.2): Widen PLSAT container to 1200px when split-layout questions are active; add horizontal scrolling to code blocks inside answer choices to prevent clipping

## [3.19.1] — 2026-03-02

### Fixed

- **Version bump for publish** (`@a-company/paradigm` 3.19.0 → 3.19.1, `@a-company/university` 3.10.0 → 3.10.1): Rebuild university UI assets so version badge reflects correct version

## [3.19.0] — 2026-03-02

### Changed

#### Assessment Consolidation into Lore (`@a-company/paradigm` 3.18.0 → 3.19.0, `@a-company/paradigm-mcp` 3.14.0 → 3.15.0)

Assessments are now part of the lore system. Arcs become `arc:{name}` tags, assessment types (`retro`, `insight`, `decision`, `milestone`) become regular lore entry types. Six assessment MCP tools are deprecated as thin wrappers forwarding to lore.

- **Schema**: `LoreEntry` gains `body`, `linked_lore`, `linked_tasks`, `linked_commits` fields; `type` is now optional (defaults to `agent-session`); new types `retro` and `insight`
- **Filters**: `tag` prefix filter and `hasBody` boolean filter on lore search (MCP, CLI, viewer)
- **Deprecated tools**: `paradigm_assessment_record/list/get/search/arc_create/arc_close` — all forward to lore with `arc:*` tags; descriptions prefixed `[DEPRECATED]`
- **Session recovery**: `paradigm_context_check` breadcrumbs and recovery now search lore for `arc:*` tags instead of loading assessment directories
- **Task hints**: `paradigm_task_done` references lore instead of assessments

### Added

- **`paradigm lore migrate-assessments`** CLI command: converts `.paradigm/assessments/` entries to lore with `arc:{arc_id}` and `assessment:{type}` tags; renames originals to `.migrated`; supports `--dry-run`
- **`paradigm lore retag`** CLI command: bulk add/remove tags on matching lore entries with `--add`, `--remove`, and standard filter options (`--type`, `--symbol`, `--author`, `--from`, `--to`, `--tags`)
- **CLI enhancements**: `paradigm lore record` gains `--body`, `--link-lore`, `--link-commits` options; `paradigm lore show` displays body, linked entries, and new type colors
- **Lore Viewer**: body display (preformatted), linked entries (clickable IDs), arc tag badges (blue styling), tag dropdown filter populated from `/api/lore/tags`, `retro`/`insight` in type filter
- **Server**: `GET /api/lore/tags` endpoint returns unique tags with counts; existing list endpoint accepts `tag` and `hasBody` query params

#### University Content & PLSAT Layout (`@a-company/university` 3.10.0 → 3.10.1)

- **PARA-501 rewrite**: "Assessment Loops" lesson → "Lore as Unified Project Memory" — teaches tag-driven classification, arc tags, body field, and linking between entries
- **PLSAT v3.0**: Questions plsat-091/092/093 updated from assessment model to unified lore model
- **PLSAT two-column layout**: `QuestionCard` gains `splitLayout` prop — CSS Grid with question on left, choices on right; responsive stacking at 768px

## [3.18.0] — 2026-03-02

### Changed

#### Lore Schema Refactor: Author/Agent Split (`@a-company/paradigm` 3.17.2 → 3.18.0, `@a-company/paradigm-mcp` 3.13.0 → 3.14.0)

Separates the human author from AI agent metadata across the entire lore system. Previously `author` was an object with a `type` discriminator — now it's always a string identifying the human user, with a separate optional `agent` field for AI info.

- **Schema**: `author` is now a plain string (the human user); `agent?: { provider, model }` is a new optional field; `assistedBy` removed
- **File naming**: New entries use `.lore` extension with author+time IDs (`L-2026-03-02-ascend-143025-001.lore`) to prevent multi-user conflicts
- **Backward compatible**: Old `.yaml` entries with `author: { type, id, model }` are normalized transparently on read via `normalizeLoreEntry()`
- **Author resolution**: `resolveAuthor()` chain: `PARADIGM_AUTHOR` env → `git config user.name` → `os.userInfo().username` → `'unknown'`
- **Provider inference**: `inferProvider()` maps model names to providers (claude→anthropic, gpt→openai, gemini→google, etc.)
- **Filter changes**: `hasAgent` boolean replaces `authorType` enum; deprecated `authorType` still accepted for backward compat
- **MCP tools**: `paradigm_lore_search` gains `hasAgent` param; `paradigm_lore_record` auto-resolves human author and sets agent metadata
- **Lore Viewer**: Author shown as human user everywhere; agent displayed separately when present; filter pills updated to "All / Human Only / AI-Assisted"
- **CLI**: All lore commands (`list`, `show`, `timeline`, `delete`, `record`) updated for new schema
- **New files**: `normalize.ts` (entry normalization + provider inference), `resolve-author.ts` (human author detection)
- **Tests**: 59 tests passing across `normalize.test.ts`, `filter.test.ts`, `storage.test.ts`

### Added

- **Git context on lore entries**: Every lore entry now auto-captures `git_context: { ref, branch, dirty }` at write time — answers "what did the codebase look like when this was recorded?"
- **Custom metadata field**: `meta: Record<string, unknown>` on lore entries for project-defined key-value pairs (sprint numbers, meeting types, experiment IDs, etc.)
- **`--meta` CLI flag**: `paradigm lore record --meta '{"sprint": 12}'` attaches project metadata via CLI
- **`meta` MCP param**: `paradigm_lore_record` accepts `meta` for agent-driven metadata attachment
- **Viewer display**: DetailPanel shows git context (commit, branch, dirty status) and metadata key-value pairs

## [3.17.2] — 2026-03-02

### Fixed

- **Full null-safety pass for `symbols_touched` across all lore code** (`@a-company/paradigm` 3.17.1 → 3.17.2): YAML-loaded lore entries may omit `symbols_touched` despite the TypeScript type marking it required — added defensive null checks across 10 files:
  - **Server routes**: `lore.ts` symbol filter and `/symbols` aggregation
  - **Frontend**: `DetailPanel.tsx`, `LoreCard.tsx`, `SessionView.tsx`, `loreStore.ts` search
  - **CLI commands**: `lore list`, `lore show`, `lore timeline`, `lore delete`
  - **Core**: `filter.ts` symbol filter and full-text search

## [3.17.1] — 2026-03-02

### Fixed

- **Lore Viewer crash on projects with incomplete entries** (`@a-company/paradigm` 3.17.0 → 3.17.1): Sessions API returned 500 when lore entries were missing `symbols_touched` field — added null checks in server route and defensive optional chaining in LoreCard component

## [3.17.0] — 2026-03-02

### Added

#### Lore Viewer UX (`@a-company/paradigm` 3.16.1 → 3.17.0)

- **Light mode toggle**: Sun/moon button to the right of the view switcher segmented control. Theme persists to localStorage.
- **Author-based column layout**: Timeline entries now appear on the right by default. Click an author pill to move their entries to the left column, creating a side-by-side conversation view. Click `×` to remove them. When no authors are selected for the left, entries display in a single-column layout. Selection persists to localStorage.
- Replaced hardcoded human-left/agent-right split — any author (human or agent) can be placed on either side

## [3.16.1] — 2026-03-01

### Fixed

- **University UI version badge** (`@a-company/university` 3.9.0 → 3.9.1): Rebuild UI dist so the `vite.config.ts` fix from 3.16.0 is included in the published package — version badge now shows `v3.9.1` instead of `v0.1.0`

## [3.16.0] — 2026-03-01

### Added

#### Protocols University Content (`@a-company/university` 3.7.1 → 3.9.0)

- **PARA 301 lesson**: "Protocols — Repeatable Patterns" — covers protocol storage, step types, searching, recording, freshness tracking, and the protocol workflow
- **3 PLSAT questions** (slots 094-096): protocol search workflow, recording patterns, freshness/staleness/broken status
- **Updated operational loop**: PARA 301 "Operational Excellence" capstone now includes protocol search in the Discover phase and protocol recording in the Capture Knowledge phase
- **New protocol**: `update-university-content.protocol` — general protocol for adding lessons, quizzes, and PLSAT questions
- PLSAT totalSlots updated to 99 (correctly counts passage sub-questions), description updated to match

### Fixed

- **University UI version badge**: Showed "v0.1.0" instead of the actual package version — `vite.config.ts` now reads from parent `package.json` instead of falling back to the UI sub-package's hardcoded version
- **PLSAT question count mismatch**: Exam rules showed 96 questions but metadata said 90 — `totalSlots` and description now reflect the actual resolved count (99) including passage sub-questions

#### Protocols — Repeatable Implementation Patterns (`@a-company/paradigm-mcp` 3.11.0 → 3.13.0, `@a-company/paradigm` 3.14.1 → 3.16.0)

Protocols capture step-by-step implementation patterns with exact file references, learned from completed work. Agents search protocols before exploring — saving 100-200k tokens per task when a matching pattern exists.

- **5 new MCP tools**: `paradigm_protocol_search` (fuzzy match by task description), `paradigm_protocol_get`, `paradigm_protocol_record`, `paradigm_protocol_update`, `paradigm_protocol_validate`
- **Fuzzy search**: Tokenizes task descriptions, scores against trigger phrases (weight 3), tags (weight 2), name/description (weight 1), step notes (weight 0.5)
- **Freshness tracking**: Protocols auto-validated during `paradigm_reindex` — missing files → broken, modified exemplar → stale, all valid → current
- **Status integration**: `paradigm_status` includes protocol health (total/current/stale/broken)
- **Lore integration**: `paradigm_lore_record` detects "protocol-worthy" sessions (2+ new files following existing patterns) and returns a `protocol_suggestion` draft
- **`/protocol` skill**: Search or record protocols via slash command
- **36 seed protocols** covering all paradigm patterns:
  - MCP/Tools (5): add-mcp-tool, add-mcp-tool-with-status, add-tool-with-reindex-integration, add-tool-with-workspace-support, add-tool-with-sentinel-schema
  - CLI (6): add-cli-command, add-command-with-subcommands, add-command-with-prompts, add-command-with-file-output, add-workspace-subcommand, add-team-subcommand
  - Sentinel (4): add-sentinel-event-schema, add-sentinel-server-route, add-sentinel-adapter, add-sentinel-mcp-integration
  - Auth (2): add-portal-gate, add-portal-route-with-gates
  - University (3): add-university-course, add-university-quiz, add-plsat-question
  - IDE/Agents (2): add-ide-adapter, add-agent-provider
  - Data (4): add-paradigm-type, add-aspect-with-anchors, add-wisdom-entry, add-spec
  - Testing (2): add-unit-test, add-integration-test
  - Docs (2): add-upgrade-guide, add-case-study
  - Infra (6): add-skill, add-mcp-resource, add-hook-script, record-lore, update-changelog, update-university-content
- Storage: `.paradigm/protocols/` with `.protocol` extension per file and auto-generated `index.yaml`
- Spec: `docs/specs/protocols.md`

## [3.14.1] — 2026-03-01

### Fixed

- **PLSAT 500 error** (`@a-company/university` 3.7.0 → 3.7.1): `resolveV3()` didn't handle `variant-group` item type in v3.0 exam JSON — 6 items fell into the passage branch, crashing on undefined `item.questions`. Now treats `variant-group` identically to `standalone`.
- Added try-catch around PLSAT version route handler for proper error responses instead of bare 500s

## [3.14.0] — 2026-03-01

### Changed

#### Sentinel Dashboard UX Improvements (`@a-company/sentinel`)

Overhauled the Logs and Events views in the Sentinel dashboard for better usability.

- **Full timestamps**: Both views now show `YYYY-MM-DD HH:MM:SS` (locale-independent manual formatting)
- **Expand All / Collapse All**: Toolbar toggle to bulk-expand all rows — expanded rows unwrap truncated message text and show data payloads
- **Resizable columns**: Drag column header borders to resize Time, Level, Symbol, Service, Type columns
- **Merged Level + Category** (EventsView): Removed redundant Category column; category now appears as a colored `[category]` badge inline in the Type cell (hidden when "unknown")
- **Exclusion filters**: Right-click any row to exclude by symbol, symbol type, message, or service — active exclusions appear as dismissible chips below the toolbar with a "Clear all" link
- Both views switched to CSS grid layout with shared column widths between header and rows
- Auto-scroll now stays at top (newest entries) instead of jumping to bottom
- EventsView grid reduced from 6 columns to 5

### Added

#### Bundle Sentinel Binaries into Paradigm (`@a-company/paradigm` 3.13.0 → 3.14.0, `@a-company/sentinel` 3.6.0 → 3.7.0)

`npm i -g @a-company/paradigm` now provides `sentinel` and `sentinel-mcp` binaries — no separate `@a-company/sentinel` install needed.

- Added `sentinel` and `sentinel-mcp` tsup build entries (same cross-compile pattern as `paradigm-mcp`)
- Added `sentinel` and `sentinel-mcp` bin entries to package.json
- Added runtime dependencies: `simple-git`, `ws`, `uuid`
- Fixed sentinel CLI hardcoded version (`0.2.0` → dynamic from package.json via `createRequire`)
- Renamed `dashboard` command to `defend` (`sentinel defend`, `paradigm sentinel defend`)
- Copied sentinel UI assets into paradigm dist during build (same pattern as university-assets)

## [3.12.0] — 2026-02-28

### Added

#### Workspace DX — `--workspace` Flag + CLAUDE.md Injection (`@a-company/paradigm` 3.11.0 → 3.12.0)

Simplified workspace setup from 4 commands across 3 directories to a single `paradigm shift --workspace "name"` from any member project.

**`paradigm shift --workspace` Flag:**
- `--workspace <name>`: Creates `../.paradigm-workspace` with the current project as first member, or joins an existing workspace
- `--workspace-path <path>`: Override the default workspace file location
- Automatically detects project role (api, client, shared, etc.) from directory name and dependencies
- Updates local `.paradigm/config.yaml` with workspace link
- Runs workspace reindex after scan (Step 3b) when workspace is configured
- Shows workspace-specific next steps in summary (join sibling projects)
- Idempotent: re-running from an already-joined project is a no-op

**CLAUDE.md Workspace Section Injection:**
- `ParadigmFiles` interface now includes optional `workspace` field
- `loadParadigmFiles()` reads workspace config and populates member info
- New `generateWorkspaceSection()` in base adapter renders: member table, cross-project tools reference, symbol prefix guidance
- Claude adapter calls it after Multi-Agent Orchestration section — only emitted when workspace has sibling projects

**Testing Document:**
- Created `docs/testing/workspace-deus-test-plan.md` — structured test plan for Opus agents validating the end-to-end flow in deus-backend/deus-frontend

## [3.11.0] — 2026-02-28

### Added

#### Enforcement Gaps — Hook Unification + New Checks (`@a-company/paradigm` 3.10.0 → 3.11.0, `@a-company/paradigm-mcp` 3.10.0 → 3.11.0)

Unified the duplicated Claude Code and Cursor stop hooks into a shared `paradigm-common.sh` library, and wired up three enforcement gaps that were configured but never checked.

**Hook Unification:**
- Extracted checks 1–8 (plus new 9–11) into `paradigm-common.sh` — single source of truth
- Claude Code and Cursor stop hooks are now thin wrappers that source the common library
- Platform-specific logic (CWD extraction, loop guard, followup JSON) stays in wrappers
- `generate-hooks.mjs` copies `paradigm-common.sh` to both plugin directories
- `paradigm hooks install` deploys `paradigm-common.sh` alongside stop scripts

**Check 9 — Purpose-Required Enforcement:**
- Validates `purpose-required` patterns from `.paradigm/config.yaml`
- Directories matching configured globs (e.g., `src/*`, `packages/*`) must have `.purpose` files
- `paradigm doctor` now reports purpose-required compliance

**Check 10 — Smart Aspect Drift with Auto-Heal:**
- New CLI command: `paradigm drift check [--json] [--auto-heal]`
- Reads `.paradigm/aspect-graph.db` directly to detect drifted anchors
- 3-layer detection: exact hash → normalized hash → git-aware line mapping
- Auto-heals shifted anchors (updates both DB and `.purpose` files)
- Stop hook calls `paradigm drift check` and reports genuinely drifted content as blocking

**Check 11 — Portal Gate Implementation Compliance:**
- New CLI command: `paradigm portal check [--json]`
- Wraps existing `checkPortalCompliance()` for CLI access
- Detects gates used in code but not declared in `portal.yaml` (blocking violation)
- Detects gates declared but never referenced (warning in doctor)
- `paradigm doctor` now reports portal gate compliance status

**Exported Helpers (paradigm-mcp):**
- `computeLineShift()`, `healAnchorInPurposeFile()`, `parseUnifiedDiffHunks()` now exported from `aspect-graph.ts`
- `DiffHunk` and `LineMapping` interfaces now exported

## [3.10.0] — 2026-02-28

### Added

#### Workspaces — Multi-Project Symbol Awareness (`@a-company/paradigm` 3.9.0 → 3.10.0, `@a-company/paradigm-mcp` 3.9.0 → 3.10.0)

Cross-project symbol sharing via `.paradigm-workspace` files. Sibling projects can now see each other's symbols for ripple analysis, search, navigation, and gate awareness.

**Phase 1 — File Format + Discovery:**
- `.paradigm-workspace` YAML schema with version, name, and members (name, path, role, exports)
- `workspace` field in `.paradigm/config.yaml` pointing to workspace file
- Workspace loader reads sibling `scan-index.json` files (read-only)
- Export filtering: members control visibility via glob patterns
- Graceful degradation: missing files warn and continue

**Phase 2 — Cross-Project Search + Ripple:**
- `paradigm_search` gains `includeWorkspace` parameter — searches sibling indices with `{member}/` namespace prefix
- `paradigm_ripple` gains `includeWorkspace` parameter — adds `workspaceImpact` section with cross-project references
- Impact level auto-upgrades when cross-project references exist

**Phase 3 — Navigation + Portal Awareness:**
- `paradigm_navigate` with `find` intent falls back to workspace siblings when symbol not found locally
- `paradigm_navigate` with `context` intent includes relevant sibling symbols
- `paradigm_gates_for_route` learns gate patterns from sibling `portal.yaml` files

**Phase 4 — CLI + Reindex:**
- `paradigm workspace init` — discovers sibling projects, auto-detects roles, creates `.paradigm-workspace`
- `paradigm workspace status` — shows member status, symbol counts, last indexed time
- `paradigm workspace reindex` — runs `paradigm scan` in all member directories
- `paradigm_workspace_reindex` MCP tool — reindex all members from AI assistant
- `paradigm shift` auto-detects `.paradigm-workspace` in parent directories

**Backward Compatibility:**
- No `workspace` in config.yaml → all behavior identical to 3.9.0
- `includeWorkspace` defaults to `false` — workspace search is opt-in per query
- Missing workspace file, missing sibling index → warn and continue

## [3.9.0] — 2026-02-26

### Added

#### Personas — Actor-Driven Journey Testing (`@a-company/paradigm-mcp` 3.8.0 → 3.9.0)

Named test actors with traits, journeys, and spawn chains — turning portal/flow topology into executable, validated test specifications.

**Phase 1 — Schema + CRUD + Validation:**
- `.persona` file format with traits, trigger, fixtures, and ordered journey steps
- 10 MCP tools: `persona_create`, `persona_get`, `persona_list`, `persona_update`, `persona_delete`, `persona_add_step`, `persona_remove_step`, `persona_validate`, `persona_coverage`, `persona_affected`
- Full cross-reference validation: gates vs portal.yaml, routes vs portal.yaml, flows vs flow-index, spawn cycle detection
- Coverage analysis: routes/gates/flows with and without persona coverage
- Persona index auto-generated during `paradigm_reindex`

**Phase 2 — Ripple Integration:**
- `paradigm_ripple` now includes `personas_affected` showing which personas traverse a changed gate/flow/route
- Spawn chain blocking: shows downstream personas that would break if a step fails

**Phase 3 — Execution Engine:**
- `paradigm_persona_run` executes journeys against a running server
- Template interpolation: `{{fixtures.X}}`, `{{produces.X}}`, `{{context.X}}`, `{{env.X}}`
- Step-by-step HTTP execution with expect assertions (status, body.has, body.match)
- Produces extraction and carry-forward between steps
- Spawn chain orchestration with topological ordering
- Dry-run mode for validation without requests
- Chain execution with permutation overrides

**Phase 4 — Sentinel Integration:**
- Schema `paradigm-personas` auto-registers on first run
- Events emitted: `persona.run.start`, `persona.step.pass/fail/skip`, `persona.run.complete`, `persona.chain.complete`
- Query with: `paradigm_sentinel_events({ schema: "paradigm-personas" })`

## [3.8.0] — 2026-02-26

### Added

#### Smart Drift Detection (`@a-company/paradigm-mcp` 3.7.0 → 3.8.0)

Upgrades `paradigm_aspect_drift` from a brittle hash-only tripwire to a layered, self-healing anchor system.

**Phase 1 — Normalized Hashing:**
- `normalizeForHash()` strips trailing whitespace, blank lines, and collapses internal spaces before hashing
- Two hashes stored per anchor: `content_hash` (exact) and `normalized_hash` (format-tolerant)
- Formatter runs (`prettier`, `eslint --fix`) no longer trigger false drift
- Cosmetic-only changes auto-heal by updating the exact hash in-place

**Phase 2 — Git-Aware Line Mapping:**
- `materialized_at_commit` records git HEAD at reindex time
- `parseUnifiedDiffHunks()` parses `@@ -old,count +new,count @@` format
- `computeLineShift()` translates anchor line ranges through accumulated diff offsets
- When code shifts position without changing, anchors auto-update in both the SQLite DB and `.purpose` files
- Handles shift + cosmetic combo (lines moved AND reformatted)
- Falls back gracefully when git is unavailable

**DriftResult v2:**
- `status`: `clean` | `cosmetic` | `shifted` | `relocated` | `modified` | `missing`
- `resolvedBy`: `exact-hash` | `normalized-hash` | `git-line-mapping` | `content-search` | `none`
- `suggestedStart`/`suggestedEnd` for shifted anchors
- `autoHealed` flag indicates whether fixes were applied
- Backwards-compatible `drifted` boolean retained

**Tool updates:**
- `paradigm_aspect_drift` gains `autoHeal` parameter (default: `true`)
- Response reports cosmetic, shifted, and modified counts separately
- Auto-healed anchors report which `.purpose` files were patched

## [3.7.0] — 2026-02-26

### Added

#### Task Management (`@a-company/paradigm-mcp` 3.6.0 → 3.7.0)

Persistent personal task tracking that survives context windows. Minimal structure, maximum linkability.

- **`paradigm_task_create`** — create a task with blurb, priority (high/medium/low), tags, and optional lore links
- **`paradigm_task_list`** — list/filter tasks by status (open/done/shelved), priority, tags; sorted by priority then date
- **`paradigm_task_update`** — update blurb, priority, status, tags, or linked assessments/lore
- **`paradigm_task_done`** — mark task complete (shorthand)
- **`paradigm_task_shelve`** — shelve a task for later (shorthand)
- Storage: `.paradigm/tasks/entries/{YYYY-MM-DD}/T-*.yaml` with auto-generated sequential IDs
- Session recovery surfaces top 5 open tasks by priority

#### Assessment Loops (`@a-company/paradigm-mcp` 3.6.0 → 3.7.0)

Threaded narrative arcs for sprint-retro-style reflection. AI-generated with human review.

- **`paradigm_assessment_record`** — add a reflection entry to an arc (auto-creates arc if new)
- **`paradigm_assessment_list`** — list arcs, or entries within an arc
- **`paradigm_assessment_get`** — get full entry or arc detail (pass `A-*` for entry, `arc-*` for arc)
- **`paradigm_assessment_search`** — cross-arc search by symbol, tag, type, or date range
- **`paradigm_assessment_arc_create`** — explicitly create an arc
- **`paradigm_assessment_arc_close`** — mark an arc complete or archived
- Entry types: `retro`, `insight`, `decision`, `milestone`
- Cross-references: linked lore entries, task IDs, and commit hashes per entry
- Globally unique entry IDs (`A-YYYY-MM-DD-NNN`) across all arcs
- Storage: `.paradigm/assessments/arcs/{arc-id}/arc.yaml` + `entries/A-*.yaml`
- Session recovery surfaces active arcs related to recovered symbols

#### Session Integration

- Recovery preamble now includes open tasks and active assessment arcs
- Breadcrumb extraction for all 11 new tools

#### Documentation & Onboarding (`@a-company/paradigm` 3.6.0 → 3.7.0, `@a-company/university` 3.5.0 → 3.7.0)

- **CLAUDE.md** — Task/assessment tools added to MCP Workflow Protocol, Token Budget, and update rules
- **README.md** — Tool count updated to 50+, key tools table and directory tree extended
- **commands.md** — Full documentation for all 11 new MCP tools with examples
- **ai-maintenance-protocol.md** — Task tracking and assessment recording workflow sections
- **init.ts** — `paradigm init` now scaffolds `tasks/` and `assessments/` directories
- **.gitignore** — `.paradigm/assessments/` added to runtime data exclusions
- **PARA 501** — Two new lessons: Task Management and Assessment Loops
- **PLSAT v3.0** — 4 new exam questions (86 → 90 slots)

## [3.6.0] — 2026-02-25

### Added

#### Schema-Driven Sentinel — Application-Agnostic Observability (`@a-company/sentinel` 3.5.0 → 3.6.0)

Sentinel is now a **schema-driven, application-agnostic observability platform**. Applications register their own event schemas (event types, temporal scopes, causal hierarchy), and Sentinel ingests, stores, queries, and visualizes any structured event data — zero knowledge of Paradigm symbols, game engines, or any domain required.

- **Schema Registry** — `EventSchemaDeclaration` with scope declarations, event type definitions, causality tracking, and visualization hints
- **SQLite v5 migration** — New `schemas` and `events` tables with 7 indexes (schema, type, scope, scope ordinal, session, timestamp, service)
- **Storage methods** — `registerSchema()`, `getSchema()`, `listSchemas()`, `insertEventBatch()`, `queryEvents()`, `queryEventsByScope()`, `getEventScopes()`, `getEventCount()`, `pruneEvents()`
- **Built-in Paradigm schema** — Existing log/metric/trace types registered as informational schema (`PARADIGM_SCHEMA`)

#### Server API Routes (`@a-company/sentinel` 3.5.0 → 3.6.0)
- `POST /api/schemas` — Register/update event schema (upsert by id)
- `GET /api/schemas` — List all registered schemas
- `GET /api/schemas/:id` — Get specific schema
- `POST /api/events` — Batch event ingestion with schema validation
- `GET /api/events` — Query events with filters (schema, type, category, scope, severity, time range, full-text search)
- `GET /api/events/scopes` — Scope summaries with category breakdowns
- `GET /api/events/scope/:value` — All events within a single scope value
- **WebSocket broadcast** — `type: 'event'` messages for real-time streaming
- **JSON-RPC handlers** — `query_events` and `query_scopes` over WebSocket

#### Browser Transport — `@a-company/sentinel-web` 0.1.0 (NEW)
- **Zero-dependency browser client** for schema-driven event ingestion
- `SentinelWebClient` — sync `emit()`, ring buffer batching, periodic `fetch()` flush, `sendBeacon()` on `beforeunload`
- `RingBuffer` — O(1) push/drain with configurable `drop-oldest`/`drop-newest` backpressure
- `registerSchema()` for client-side schema registration
- `crypto.randomUUID()` for ID generation (no uuid dependency)
- Single retry on 5xx, `onDrop`/`onError` callbacks
- ESM + CJS builds, <2KB target

#### MCP Tools (`@a-company/paradigm-mcp` 3.5.0 → 3.6.0)
- `paradigm_sentinel_schemas` — List/get registered event schemas
- `paradigm_sentinel_events` — Query generic events by schema, type, scope, time, severity
- `paradigm_sentinel_scopes` — Scope summaries with event counts and category breakdown

#### Sentinel UI — Events View (`@a-company/sentinel` 3.5.0 → 3.6.0)
- **Events tab** in Sentinel dashboard
- Schema selector dropdown
- Scope navigator (chip bar for sequential/independent scopes)
- Event table with columns adapted from schema field declarations
- Category filter chips with colors from `visualization.categoryColors`
- High-frequency types hidden by default via `visualization.defaultExcluded`
- Expandable event data rows
- Real-time WebSocket updates (subscribes to `type: 'event'` messages)

### Changed
- `@a-company/sentinel`: 3.5.0 → 3.6.0
- `@a-company/paradigm-mcp`: 3.5.0 → 3.6.0
- `@a-company/paradigm`: 3.5.0 → 3.6.0
- `@a-company/sentinel-web`: 0.1.0 (new package)

---

## [3.5.1] — 2026-02-25

### Fixed

#### ESM Bundling — Aspect Graph Tools (`@a-company/paradigm-mcp`)
- **Externalized `sql.js`** in tsup.config.ts — aspect tools (`aspect_search`, `aspect_get`, `aspect_graph`, `aspect_heatmap`, `aspect_drift`, `aspect_confirm`, `aspect_suggest_scan`) were failing with "Dynamic require of `fs` is not supported" because sql.js's Node.js loader was inlined into ESM bundle
- After fix: all 7 aspect graph MCP tools functional

#### `paradigm_related` Grep Fallback (`@a-company/paradigm-mcp`)
- **Added grep fallback** when symbol is not in index — mirrors `paradigm_ripple`'s fallback pattern
- Returns approximate `usedBy` with file locations and reference counts instead of hard "Symbol not found" error
- Clearly labeled as `status: "not-indexed"` with suggestion to run `paradigm scan`

#### Flow Index — `symbolToFlows` Empty (`@a-company/paradigm`, `@a-company/paradigm-mcp`)
- **`parseFlowSteps` now reads `component:` field** as fallback for `symbol:` — .purpose flow steps use `component: '#name'` format but indexer only checked `symbol:` field
- Fixed in both CLI (`scan/index.ts`) and MCP (`reindex.ts`) code paths
- **`paradigm index` now generates flow-index.json** — previously only `paradigm shift` and `paradigm init` generated it; added `generateFlowIndex` + `generateNavigator` to `probe/index.ts`
- Exported `generateFlowIndex` from `scan/index.ts` for reuse
- Result: 29 symbol-to-flow mappings now populated, `paradigm_flows_affected` returns real data

#### Aspects Missing from Scan Index (`@a-company/probe-core`)
- **Added `aspect` type** to `ScanCategory` union and `ScanIndex` interface
- **Added `addAspect()` handler** in `processSymbol` — aspects were extracted by premise-core but silently dropped by probe-core's generator (`default: break`)
- Result: 201 aspects now in scan-index.json alongside components, flows, gates, signals

### Added

#### Project-Level "Paragon" Fixes
- **`#purpose-parser`** declared in `packages/purpose/core/.purpose` — was referenced in lore/case studies but never indexed
- **`#sentinel-sdk`** declared as feature aggregator in `packages/sentinel/.purpose` — umbrella for `#SentinelClient` (TS) and `#SentinelRustClient` (Rust)
- **`~audit-required`** declared with code anchors in `packages/paradigm/.purpose` — anchored to `audit-logger.ts` and `agent-spawner.ts:274-288`
- **`.paradigm/flows.yaml`** — 10 formal flow definitions with symbol-typed steps: `$init-flow`, `$sync-flow`, `$probe-flow`, `$authorization-flow`, `$orchestration-flow`, `$purpose-parsing`, `$incident-triage`, `$plsat-exam-flow`, `$handoff-roundtrip`, `$wisdom-promotion`
- **Wisdom entries** — 2 antipatterns (`mcp-001`: don't bundle native modules, `mcp-002`: always add grep fallback) + 1 decision (`001`: a-paradigm must maintain 100% stress test pass rate)
- **Case studies** — `docs/case-studies/002-ripple-stress-test-post-restart.md`

### Changed
- Symbol count: 616 → 636 (CLI) / 619 (MCP)
- Scan index now includes `aspects` section (201 entries)
- Flow index `symbolToFlows` now contains 29 mappings across 6 flows

## [3.5.0] — 2026-02-25

### Added

#### Aspect Graph System (`@a-company/paradigm-mcp` 3.4.0 → 3.5.0)
- **SQLite graph engine** — `.paradigm/aspect-graph.db` stores aspects, code anchors, weighted edges, lore links, search weights, and access heatmap; rebuilt from `.purpose` files on every `paradigm_reindex`
- **Three-tier search** — learned mappings (Tier 1) → FTS5 full-text (Tier 2) → Levenshtein fuzzy (Tier 3); search quality improves over time via `paradigm_aspect_confirm` learning loop
- **Recursive ripple** — weighted BFS through aspect graph edges + symbol-index references with multiplicative decay, maxDepth/minWeight pruning, and queue limit
- **Lore bridge** — materializes links between aspects and lore decision records; infers `related-to` edges between aspects that share lore entries
- **Auto-suggest engine** — 8 regex heuristic detectors (magic numbers, hardcoded strings, rate limits, time values, env checks, feature flags, regex patterns, conditional logic) scan source files for undocumented aspects
- **Drift detection** — SHA-256 content hashing of code at anchor line ranges; `paradigm_aspect_drift` reports stale anchors
- **AspectDefinition v3.5 fields** — `value`, `category`, `severity`, `edges`, `lore` (all optional, backwards-compatible)
- **7 new MCP tools** — `paradigm_aspect_search`, `paradigm_aspect_get`, `paradigm_aspect_graph`, `paradigm_aspect_heatmap`, `paradigm_aspect_suggest_scan`, `paradigm_aspect_drift`, `paradigm_aspect_confirm`
- **Materialization in reindex** — `paradigm_reindex` now builds aspect-graph.db alongside scan-index.json, navigator.yaml, and flow-index.json

#### Logger Transport Layer (`@a-company/paradigm-logger` 1.0.0 → 1.1.0)
- **`LogTransport` interface** — pluggable transport for forwarding structured log entries to external sinks
- **`addTransport()` / `removeTransport()`** — runtime transport management on `ParadigmLogger`
- **Transport dispatch** — `SymbolLoggerImpl.emit()` forwards entries (level, symbol, symbolType, message, data, correlationId, timestamp) to all registered transports after console output

#### SentinelTransport Bridge (`@a-company/sentinel` 0.3.0 → 0.4.0)
- **`SentinelTransport`** — bridges `LogTransport` to `SentinelClient` using structural typing (no hard dependency on logger package)
- **`createSentinelTransport()`** — factory accepting `SentinelClient` or `SentinelClientOptions`
- **`enableSentinel()`** — one-liner: `enableSentinel(log, { service: 'my-app' })` attaches transport to logger
- **`./transport` sub-path export** — `import { enableSentinel } from '@a-company/sentinel/transport'`
- **Optional peer dependency** — `@a-company/paradigm-logger >=1.1.0` (optional)

#### Rust Tracing Layer (`sentinel-client` 0.1.0 → 0.2.0)
- **`SentinelLayer`** — `tracing-subscriber::Layer` implementation that forwards tracing events to Sentinel
- **Level mapping** — TRACE/DEBUG → debug, INFO → info, WARN → warn, ERROR → error
- **Symbol extraction** — uses `symbol` field from events, falls back to module path conversion (`my_app::checkout::handler` → `#checkout-handler`)
- **`tracing` feature flag** — opt-in via `sentinel-client = { features = ["tracing"] }`

#### Plugin Updates (paradigm 3.3.0 → 3.4.0)
- **`/paradigm:observe` skill** — view live logs, metrics, and traces from Sentinel; integration setup examples for TS and Rust
- **Sentinel skill** — expanded with observability cross-referencing (correlationId tracing, metrics anomaly checks)

#### Session Recovery
- **User-prompt on recovery** — `paradigm_session_recover` and auto-recovery now instruct agents to ask users whether to continue, discard, or describe a new task before proceeding

#### Full Aspect Audit — 200 aspects documented
- **19 `.purpose` files** updated with cross-cutting rules, decisions, constraints, configurations, and invariants
- **paradigm-mcp** — 54 aspects (tool cache TTLs, session tracking, aspect graph config, search config, orchestration, dispatch, reindex pipeline, MCP server config)
- **sentinel** — 58 aspects (storage schema, matcher, grouper, suggester, server config, auth, rate limiting, client SDK)
- **sentinel-rs** — 8 aspects (new `.purpose` file for Rust client SDK)
- **CLI core** — 21 aspects across 5 files (orchestration, budget, cost estimation, hook compliance, provider requirements)
- **logger** — 5 aspects (log level env resolution, format auto-detection, symbol normalization, correlation, symbol filter)
- **portal** — 18 aspects across 3 packages (core, SDK, viewer)
- **premise/purpose/probe** — 8 aspects (aggregation, parsing, scan generation)
- **university** — 4 aspects (PLSAT threshold, Fisher-Yates shuffle, variant resolution, CORS)
- **paradigm-vscode** — 6 aspects (new `.purpose` file for VS Code extension)

#### University Content Updates (`@a-company/university` 3.2.0 → 3.5.0)
- **PARA-201** — "The Aspect Graph" lesson added to intermediate course
- **PARA-501** — Expanded Sentinel Deep Dive + new "Aspect Graph at Scale" lesson
- **Reference cards** — 7 new MCP tools, Aspect Categories, Edge Relations sections
- **PLSAT v3.0** — 12 new question slots (slot-078 through slot-089) covering aspect graph, drift detection, search tiers, and lore bridge

### Fixed

#### Purpose Parser — Symbol-Prefixed YAML Keys (`@a-company/purpose-core`)
- **Regex pre-processing** — `#Foo:` → `"#Foo":` and `- !signal` → `- "!signal"` before YAML parse, fixing files using `#Component:` shorthand format
- **Normalization before validation** — top-level `#MCPServer` → `components.MCPServer` before Zod strips unknown keys
- **Result** — indexable symbols jumped from 333 → 504, aspects from 11 → 200

### Changed
- Coordinated version bumps: `@a-company/paradigm` 3.5.0, `@a-company/paradigm-mcp` 3.5.0, `@a-company/sentinel` 0.4.0, `@a-company/paradigm-logger` 1.1.0, `sentinel-client` 0.2.0, plugin 3.5.0
- `paradigm_reindex` now returns `aspectGraphStats` with aspect/anchor/edge/loreLink counts
- Premise-core aggregator passes aspect `tags` and `enforcement` through to `SymbolEntry`

#### Sentinel Observability Server (`@a-company/sentinel`)
- **Structured logging API** — `POST/GET /api/logs` with level, symbol, service, session, correlation ID filtering
- **Metrics API** — `POST/GET /api/metrics` with counter, gauge, histogram types; `GET /api/metrics/aggregate/:name` for aggregation (count, sum, min, max, avg)
- **Distributed tracing API** — `POST/GET /api/traces` with span trees, parent-child relationships, cross-service correlation
- **Service registry** — `POST/GET /api/services` with version, PID, environment, last-seen tracking
- **Live state tracking** — `POST/GET /api/state` for real-time app state snapshots with active flows and gates
- **WebSocket streaming** — Real-time broadcast of log entries, flow events, and symbol validation warnings via `ws://`
- **Auto-promote errors to incidents** — Error-level logs automatically create incidents with Sentinel's existing pattern matching
- **Symbol validation on ingestion** — Cross-references log symbols against `.purpose` index, suggests fixes for typos

#### Security & Rate Limiting
- **Bearer token auth middleware** — Permission levels (read/write/admin), token expiry, configurable per-server
- **Per-service rate limiting** — Sliding window counters (1-minute windows), sampling rate support, batch size enforcement
- **Server configuration** — `sentinel.yaml` server section with port, maxLogs, maxBatchSize, auth, rateLimit, TLS settings
- **Environment variable overrides** — `SENTINEL_PORT`, `SENTINEL_MAX_LOGS`, etc.

#### Dashboard UI
- **Logs tab** — Real-time log viewer with WebSocket streaming, level/service/search filters, auto-scroll, expandable JSON data payloads
- **Flows tab** — Live flow visualization (nodes light up as signals/gates fire) plus flow composer for creating new `$flows` from existing symbols via drag-and-drop
- **4-tab navigation** — Design, Logs, Incidents, Flows (was 2 tabs)

#### Client SDKs
- **JS/TS client** (`SentinelClient` in `@a-company/sentinel`) — Batching with ring buffer, auto-retry with exponential backoff + jitter, graceful degradation when server is down, log/metric/trace/state push APIs, `createSentinelClient()` factory
- **Rust client** (`sentinel-rs/`) — Async batching via reqwest/tokio, builder pattern, `debug`/`info`/`warn`/`error` convenience methods, counter/gauge metrics, 10 unit tests

#### MCP Tools (both `@a-company/paradigm-mcp` and standalone `sentinel-mcp`)
- `paradigm_sentinel_logs` — Query structured logs with filters
- `paradigm_sentinel_services` — List registered services
- `paradigm_sentinel_app_state` — Get live app state snapshots
- `paradigm_sentinel_validate_symbol` — Check symbol existence with typo suggestions
- `paradigm_sentinel_flow_activity` — Get recent flow events by symbol type
- `paradigm_sentinel_metrics` — Query and aggregate metrics
- `paradigm_sentinel_traces` — Query distributed traces with span trees

#### Storage
- **Schema v3 migration** — `logs`, `services`, `app_state` tables with 5 indexes
- **Schema v4 migration** — `metrics`, `traces` tables with 6 indexes
- **15+ new storage methods** — insertLog, insertLogBatch, queryLogs, getLogCount, pruneLogs, registerService, updateServiceLastSeen, getServices, upsertAppState, getAppState, getAllAppStates, insertMetric, insertMetricBatch, queryMetrics, getMetricCount, aggregateMetric, pruneMetrics, insertSpan, getTrace, queryTraces

### Changed
- `packages/sentinel/src/server/index.ts` — Rewrote to support WebSocket, shared storage instance, auth + rate-limit middleware on all observability routes
- `packages/sentinel/src/types.ts` — Extended with LogEntry, MetricEntry, TraceSpan, AuthConfig, RateLimitConfig, SentinelServerConfig (158 new lines)
- `packages/paradigm-mcp/src/tools/sentinel.ts` — Added 7 new MCP tool definitions and handlers (121 new lines)
- `packages/sentinel/src/mcp.ts` — Added matching 7 standalone MCP tools (80 new lines)

---

## [3.3.1] — 2026-02-24

### Added
- **Cursor `preToolUse` hook** — New `cursor-pretooluse.sh` fires before Edit/Write with graduated enforcement: silent for 1-2 uncovered edits, warns at 3-4, blocks (exit 2) at 5+. Unlike `afterFileEdit`, `preToolUse` can actually block the agent.
- **Cursor `postToolUse` hook** — New `cursor-posttooluse.sh` fires after Edit/Write with advisory feedback. Unlike `afterFileEdit`, `postToolUse` output is visible to the Cursor agent.

### Fixed
- **Stop hook infinite loop guard** — `cursor-stop.sh` now tracks retry count in `.paradigm/.stop-hook-active`. After 3 retries, allows session to end instead of looping forever.
- **Invisible `afterFileEdit` output** — Cursor ignores all stderr/stdout from `afterFileEdit` hooks. Moved advisory messages to `postToolUse` hook; `cursor-postwrite.sh` now only does background file tracking.

### Changed
- **`paradigm hooks install --cursor`** — Now installs 6 hooks (was 4): added `preToolUse` and `postToolUse` with `Edit|Write` matcher
- **`paradigm hooks uninstall --cursor`** — Cleans up `preToolUse` and `postToolUse` entries alongside existing hooks
- **`paradigm hooks status`** — Shows `preToolUse` and `postToolUse` hook status for Cursor
- **Cursor plugin `hooks.json`** — Added `preToolUse` and `postToolUse` entries
- **Version sync** — `@a-company/paradigm` 3.3.0 → 3.3.1, `@a-company/paradigm-mcp` 3.3.0 → 3.3.1

## [3.3.0] — 2026-02-24

### Added
- **Cursor `sessionStart` hook** — New `cursor-session-start.sh` fires before the agent does anything, injecting `additional_context` with 3 non-negotiable rules (session bookends, .purpose updates, ripple before modify), essential MCP tool signatures, and task-size tiers. Deterministic — not subject to context compaction.
- **Cursor `followup_message` compliance loop** — Stop hook now outputs `followup_message` JSON to stdout when violations are found. Cursor auto-submits this as the next user message, creating a retry loop (up to `loop_limit: 3`).
- **Cursor plugin** (`plugins/paradigm-cursor/`) — Full `.cursor-plugin/` format plugin with hooks, skills (preflight, postflight, lore, scan), MCP server config, and README. Mirrors the existing Claude Code plugin for Cursor's plugin system.
- **Dual-plugin hook generation** — `generate-hooks.mjs` now copies scripts to both `plugins/paradigm/scripts/` (Claude Code) and `plugins/paradigm-cursor/scripts/` (Cursor) as the single source of truth.

### Changed
- **`paradigm hooks install --cursor`** — Now installs 4 hooks (was 3): added `sessionStart` with `paradigm-session-start.sh`; stop hook entry includes `loop_limit: 3`
- **`paradigm hooks uninstall --cursor`** — Cleans up `sessionStart` entries alongside existing hooks
- **`paradigm hooks status`** — Shows `sessionStart` hook status for Cursor
- **Version sync** — `@a-company/paradigm` 3.2.1 → 3.3.0, `@a-company/paradigm-mcp` 3.2.1 → 3.3.0

## [3.2.1] — 2026-02-24

### Added
- **`paradigm-workflow.mdc`** — New Cursor rule file (`alwaysApply: true`) with session bookends, graduated task-size compliance guide, essential MCP tools table, and non-negotiable `.purpose` update rule
- **`paradigm-practices.mdc`** — New Cursor rule file consolidating Phase 5/6 content (habits compliance, lore recording, llms.txt) — closes parity gap with AGENTS.md

### Changed
- **`paradigm-agent-hints.mdc`** — Rewritten to be MCP-first: all CLI command references (`paradigm ripple --json`, `paradigm echo --json`, `jq` queries) replaced with MCP tool calls (`paradigm_ripple()`, `paradigm_search()`, `paradigm_navigate()`)
- **`paradigm-core.mdc`** — Added "CRITICAL RULES (Non-Negotiable)" section with 3 MUST-follow bullets and reference to workflow file
- **Cursor adapter** generates 15 rule files (was 13)

## [3.2.0] — 2026-02-24

### Added

#### Phase 1: Type Safety & Quick Wins
- **Typed interfaces** — Replaced `any` types across `portal/watch.ts`, `mcp/switch.ts`, `mcp/setup.ts`, and `tutorial/index.ts` with proper typed interfaces
- **Actionable sentinel errors** — Generic catch in `sentinel.ts` now provides specific error messages with remediation steps
- **v2-only symbol validation** — `parseSymbol` in `flow-schema.ts` now rejects deprecated v1 prefixes (`@`, `%`, `?`, `&`)

#### Phase 2: Validation & Safety Hardening
- **Circular dependency detection** — DFS-based cycle detection in `flow-validator.ts`; reports cycles in `AllFlowsValidationResult`
- **Lore symbol validation** — `recordLore()` optionally validates `symbols_touched` against registered .purpose, flow, and portal symbols
- **`--dry-run` flag** — Added to `hooks install`, `hooks uninstall`, `lore delete`, and `upgrade` commands
- **`.purpose` file checking** — `symbolExistsInCode` now checks .purpose declarations in addition to source code grep
- **Hook syntax validation** — `bash -n` check on generated hook scripts before writing

#### Phase 3: Habits, Sentinel & Doctor Expansion
- **4 new habit check types** — `commit-message-format`, `flow-coverage`, `context-checked`, `aspect-anchored` with evaluators and seed definitions
- **Configurable sentinel grouping** — `SIMILARITY_THRESHOLD`, time-decay weighting, stack trace fingerprinting in `grouper.ts`
- **Escalation strategy inference** — `suggester.ts` infers strategy (`fix-code`, `rollback`, `config-change`, `scale-up`, `investigate`) instead of hardcoded `fix-code`
- **6 new doctor checks** — Portal.yaml validity, flows.yaml validation, lore health, hook freshness, habits config validity, AGENTS.md staleness

#### Phase 4: Portal, Lint & Pre-Publish
- **Portal test auto-generation** — `portal test` introspects gate `check` expressions to auto-generate test fixtures
- **Portal export** — `paradigm portal export` subcommand outputs gates/routes in csv, json, or markdown format
- **`lint --auto-populate`** — Scans source directories for undocumented components, suggests `.purpose` entries, writes drafts with `--fix`
- **Pre-publish check script** — `scripts/pre-publish-check.mjs` validates builds, version consistency, changelogs, doctor, and plugin hooks.json

#### Phase 5: Documentation Standards & AI Interop
- **`paradigm sync-llms`** — Generates `llms.txt` at repo root with symbols, key files, flows, gates, and conventions
- **AGENTS.md expansion** — Generated AGENTS.md now includes habits compliance, lore recording, session checkpoints, and llms.txt sections
- **`paradigm flow diagram`** — CLI command generates Mermaid flowchart from flow definitions (diamonds for gates, rectangles for actions, rounded boxes for signals)
- **Enhanced MCP tool descriptions** — 52 tools across 14 modules updated with return data shape, usage guidance, and token cost estimates
- **Expanded patterns.md** — 4 new patterns: multi-agent handoff, lore recording, habit compliance, flow-first development
- **Expanded ai-maintenance-protocol.md** — Decision trees for lore recording, flow creation, and new feature compliance checklist

#### Phase 6: Advanced Intelligence
- **ToolCache** — In-memory TTL cache (30s default) for `paradigm_search`, `paradigm_status`, and `paradigm_navigate` MCP tools; cleared on `paradigm_reindex`
- **Plugin version compatibility** — `hooks install` checks `compatibleVersions` field in plugin `hooks.json` and warns if Paradigm version is outside the min/max range
- **Co-authorship tracking** — `assistedBy` field on `LoreEntry` with type (`agent`/`tool`/`human`), id, and optional role
- **Auto-lore drafting** — `draftLoreFromBreadcrumbs()` generates partial lore entries from session data when 3+ files are modified; tagged with `auto-draft`
- **Configurable limits** — `LimitsConfig` in `.paradigm/config.yaml` for `habitsCacheTtlMs`, `breadcrumbsMax`, `threadTrailMax`, `toolCacheTtlMs`, `checkpointMaxAgeMs`
- **`paradigm global clean`** — Cleans old files from `~/.paradigm/` Global Brain directories with `--older-than` duration and `--dry-run` preview
- **Integration tests** — 4 new test files (13 tests) for build verification, hook validation, ToolCache, and auto-lore drafting

### Changed

- **MCP tool caching** — `paradigm_search`, `paradigm_status`, and `paradigm_navigate` now return cached results within TTL window for repeated calls
- **Habits cache** — TTL now configurable via `limits.habitsCacheTtlMs` (default 30000ms) instead of hardcoded
- **Thread trail depth** — Configurable via `limits.threadTrailMax` (default 10) instead of hardcoded `.slice(-10)`
- **Version sync** — `@a-company/paradigm` 3.1.6 → 3.2.0, `@a-company/paradigm-mcp` 3.1.6 → 3.2.0, `@a-company/sentinel` 0.2.0 → 0.3.0, `@a-company/university` 3.1.2 → 3.2.0

### Documentation

- **New specs** — `caching.md` (MCP tool caching strategy), `habits.md` (all check types and semantics), `publishing.md` (pre-publish validation)
- **Updated specs** — `symbols-v2.md` (v2-only prefixes), `history.md` (auto-lore + co-authorship), `portal-validation.md` (test generator + webhook config)
- **Updated docs** — `commands.md` (new commands), `troubleshooting.md` (new error messages), `error-patterns.md` (actionable error patterns)
- **CLAUDE.md** — Added MCP Tool Caching and Plugin Version Compatibility sections

### University

- **PARA 101** — Added `llms.txt` key concept to project structure lesson
- **PARA 201** — Added Mermaid flow visualization key concept; circular dependency detection content
- **PARA 301** — Added sentinel escalation strategies, doctor checks, `lint --auto-populate` content
- **PARA 401** — Enhanced MCP tools overview; new `agent-interop` lesson covering AGENTS.md and llms.txt
- **PARA 501** — Added 4 new habit check types, lore symbol validation, co-authorship content
- **PLSAT v3.0** — 16 new exam slots (slots 062-077) with 28 question variants covering all 6 phases
- **Reference card** — Added cards for `sync-llms`, `flow diagram`, `portal export`, `lint --auto-populate`, `global clean`, and configurable limits

## [3.1.6] — 2026-02-24

### Added

- **Plugin auto-update checker** — On the first MCP tool call of each session, reads stored check results from `~/.paradigm/plugin-update-check.json` and prepends an update notice to the response if installed plugins are behind their remote. Fires a background check (throttled to 6h) for next session. New `paradigm_plugin_check` MCP tool for manual checks. New `paradigm plugin check` CLI command with `--update` flag to pull latest for stale marketplace clones.

### Fixed

- **Stale project hooks no longer shadow plugin hooks** — When the Paradigm plugin is active in Claude Code, `paradigm hooks install` now detects this and skips project-level hook installation. Any existing stale `.claude/hooks/` scripts and `settings.json` hook entries are cleaned up automatically. This fixes the root cause where project-level hook copies (from a previous `paradigm hooks install`) would run outdated logic instead of the plugin's always-current `${CLAUDE_PLUGIN_ROOT}/scripts/` hooks.
- **Stop hook: lore check now finds MCP-written entries** — Check 7 (lore entry required for 3+ source file sessions) previously only looked in `git diff` output for lore files. MCP-written lore entries go to disk but aren't staged, so the check always failed. Now also checks for lore entries on disk with today's date. Fixes the loop where agents record lore but the hook keeps blocking.

### Changed

- **`paradigm hooks status` shows plugin state** — When the plugin is active, displays the cached version and warns about any stale project hooks. When the plugin is not active, shows the traditional project-level hooks status.
- **Version sync** — `@a-company/paradigm` 3.1.4 → 3.1.6, `@a-company/paradigm-mcp` 3.1.3 → 3.1.6, plugin 3.1.4 → 3.1.6.

## [3.1.4] — 2026-02-23

### Changed

- **Hook scripts: single source of truth** — Extracted 6 inline hook constants (~900 lines) from `index.ts` into standalone `.sh` files in `src/commands/hooks/scripts/`. New `generate-hooks.mjs` codegen script reads canonical `.sh` files, generates `generated-hooks.ts` for the TypeScript build, and copies Claude Code scripts to `plugins/paradigm/scripts/`. Eliminates drift between CLI-installed hooks and plugin-shipped hooks.
- **Version sync** — `@a-company/paradigm` 3.1.3 → 3.1.4, `@a-company/paradigm-mcp` 3.1.2 → 3.1.3.

### Fixed

- **Stop hook: dual anchor path resolution** — Check 4 (stale aspect anchors) now tries both `.purpose`-dir-relative AND project-root-relative resolution. Handles both conventions: monorepo packages use `src/file.ts` (relative to package `.purpose`), while some projects write `src/lib/stores/file.ts` (root-relative) in sub-directory `.purpose` files. Only reports a violation if neither resolves.
- **MCP: `paradigm_purpose_add_aspect` validates and auto-corrects anchor paths** — If an anchor is written project-root-relative but the `.purpose` file is in a subdirectory, the tool auto-converts to the correct `.purpose`-dir-relative path. If the file doesn't exist at all, it errors at write time instead of silently writing a broken anchor.

## [3.1.2] — 2026-02-23

### Fixed

- **Stop hook: aspect anchor path resolution** — Check 4 (stale aspect anchors) incorrectly resolved anchor paths relative to the `.purpose` file's directory instead of the project root, causing false-positive "anchor does not exist" violations. Fixed in both Claude Code and Cursor stop hooks.

### Changed

- **Version sync** — `@a-company/paradigm-mcp` 3.1.0 → 3.1.2, `@a-company/university` 3.1.0 → 3.1.2, plugin 3.0.2 → 3.1.2.

## [3.1.1] — 2026-02-23

### Added

- **Lore UI: Session Browser** — New "Sessions" tab derives sessions by grouping lore entries within 4-hour windows by author. Sidebar lists sessions by date; detail view shows metadata, symbol tags, lore entries, and session breadcrumbs from `.paradigm/session-breadcrumbs.json` or `~/.paradigm/sessions/`. New `/api/sessions` endpoint.

- **Lore UI: Enhanced Timeline** — Column labels ("HUMAN" left, "AGENT" right) above the spine, color-coded spine dots (green for human, purple for agent), and on-spine date markers with per-side entry counts.

- **Lore UI: Enhanced Filtering** — Author type toggle pills (All / Human / Agent), symbol autocomplete dropdown with match counts, and explicit date range inputs (from/to) in the filter bar.

- **CLI Habits: `edit`, `remove`, `enable`, `disable`** — Full lifecycle management for habits. `habits edit <id>` supports all fields for custom habits; seed habits allow only `--severity` and `--enabled` (writes to overrides). `habits remove <id>` deletes custom habits with `--yes` confirmation; seed habits get a message to disable instead. `habits enable/disable <id>` toggles any habit. Internal `resolveHabitLocation()` helper detects whether a habit is seed, project, or global.

- **CLI Habits: `add` expanded** — New `--check-type` option (all 8 types: tool-called, file-exists, file-modified, lore-recorded, symbols-registered, gates-declared, tests-exist, git-clean) and `--patterns` option for file-based check types. Enum validation on all fields.

- **CLI Lore: `edit`, `delete`, `timeline`** — `lore edit <id>` merges provided fields (title, summary, type, symbols, tags, learnings) into existing entries. `lore delete <id>` with `--yes` confirmation and entry summary display. `lore timeline` groups entries by date, shows hot symbols and active authors, with `--json` for machine-readable output.

- **CLI Lore: `record` expanded** — New `--files-modified`, `--files-created`, `--commit`, `--learnings`, `--duration` options matching the full MCP schema.

- **CLI Lore: `list` expanded** — New `--from` and `--to` date range filtering.

- **MCP: `paradigm_lore_get`** — Fetch a single lore entry by ID with full fields (read-only).

- **MCP: `paradigm_lore_update`** — Merge provided fields into an existing entry.

- **MCP: `paradigm_lore_delete`** — Delete a lore entry with required `confirm: true` safety check (destructive hint).

- **Core: `updateLoreEntry`, `deleteLoreEntry`** — Shared storage functions in both `packages/paradigm/src/core/lore/storage.ts` and `packages/paradigm-mcp/src/utils/lore-loader.ts`. Update merges fields and rebuilds timeline; delete removes the YAML file, cleans empty date directories, and rebuilds timeline.

- **University: para-501 updates** — Habits-practice lesson updated: 8 check types (added `file-modified`, `git-clean`), CLI commands section, `platforms` field documentation. Lore-system lesson updated: CLI tools section, MCP tools expanded from 3 to 6.

- **University: para-401 updates** — MCP-tools-overview lesson: new "Practice Tools" subsection with all 10 habits + lore MCP tools.

### Fixed

- **MCP `paradigm_habits_check` trigger enum** — Added missing `on-commit` to the trigger enum, aligning with the list tool and the type definitions.

- **Lore API: route ordering bug** — `GET /api/lore/symbols`, `/timeline`, `/authors` were shadowed by `/:id` catch-all due to Express route registration order. Named routes now register before parameterized routes.

## [3.1.0] — 2026-02-22

### Added

- **Habits System — Behavioral Feedback Loop** — Agent discipline through observation, measurement, and feedback. Core engine with types, YAML loader (project + global + seed merge with overrides), and evaluator (6 check types: tool-called, file-exists, lore-recorded, symbols-registered, gates-declared, tests-exist). 10 seed habits across 6 categories (discovery, verification, testing, documentation, collaboration, security) and 4 trigger points (preflight, postflight, on-commit, on-stop). Three severity levels: advisory, warn, block. Sentinel extended with `practice_events` table for tracking compliance. Three MCP tools: `paradigm_habits_check`, `paradigm_habits_status`, `paradigm_practice_context`. CLI commands: `paradigm habits list|status|init|add`. PM integration: preflight surfaces habits + warnings, postflight evaluates compliance. Stop hook Check 8: blocking habits can prevent session completion. Lore integration: `habit_compliance` auto-attached to lore entries.

- **University: PARA-501 Advanced Systems** — New 6-lesson course covering v3 systems: The Lore System, Sentinel Deep Dive, Habits & Practice, Session Intelligence, Hook Enforcement & Automation, and The Complete Workflow (capstone). 29 quiz questions across the 6 lessons.

- **PLSAT v3.0 Expansion** — 8 new standalone question slots (slot-051 through slot-058) and 1 passage-based question group (passage-habits-review with 3 analytical questions) covering lore, sentinel, habits, sessions, and hooks.

- **University Reference Updates** — 7 new MCP tool reference cards (`paradigm_lore_record`, `paradigm_lore_search`, `paradigm_lore_timeline`, `paradigm_habits_check`, `paradigm_habits_status`, `paradigm_practice_context`, `paradigm_session_checkpoint`) and 2 CLI command cards (`paradigm habits`, `paradigm lore`).

### Fixed

- **Lore: auto-migrate legacy entries** — Legacy lore entries stored at the root of `.paradigm/lore/entries/` are now auto-migrated into date-partitioned subdirectories on load. Fixes timeline undercounting for projects created before date-partitioning was introduced.

### Changed

- **Version sync** — `@a-company/paradigm` 3.0.3 → 3.1.0, `@a-company/paradigm-mcp` 1.4.0 → 3.1.0, `@a-company/university` 0.1.0 → 3.1.0. University version now tracks the paradigm publish version.

## [3.0.3] — 2026-02-22

### Fixed

- **University/Sentinel blank page on `npm i -g` install** — `@a-company/university` and `@a-company/sentinel` were marked as `external` in tsup config, leaving them as runtime `import()` calls. Neither package is published to npm, so the imports failed for anyone outside the monorepo. Removed both from the `external` list so they are bundled into the paradigm CLI dist. Express v5 (paradigm's dependency) is now used consistently.

## [3.0.2] — 2026-02-22

### Fixed

- **CLI version banner hardcoded at 2.0.13** — The `VERSION` constant in `src/index.ts` was never updated across releases. Replaced with dynamic `require('../package.json').version` so it always matches the published version.
- **Plugin MCP server fails to connect** — The plugin `.mcp.json` ran `npx @a-company/paradigm mcp`, which is a configuration status helper, not the stdio MCP server. Changed to `npx --package=@a-company/paradigm -y paradigm-mcp .` to invoke the correct binary. Fixes `MCP error -32000: Connection closed` on plugin startup.
- **Plugin version bumped to 3.0.2** — `plugin.json` was stuck at 3.0.0.

## [3.0.1] — 2026-02-21

### Fixed

- **University "Cannot GET /" on fresh install** — The university server's static files (`ui/dist`, `src/content`) were not reachable when the code was bundled into the paradigm CLI. Added multi-strategy path resolution (`resolveAssetPaths`) and a build step that copies university assets into the paradigm dist. The CLI command now resolves and passes explicit paths to the server.
- **Express v5 wildcard route crash** — University and Sentinel servers used `app.get('*', ...)` which is invalid in Express v5. Updated to `app.get('{*path}', ...)`.

## [3.0.0] — 2026-02-21

### Added

- **Claude Code Plugin** — Full plugin at `plugins/paradigm/` with 8 skills (`/paradigm:init`, `scan`, `doctor`, `lore`, `shift`, `preflight`, `postflight`, `sentinel`), 5 specialized agents (architect, builder, tester, reviewer, security), 3 enforcement hooks (stop, precommit, postwrite), and MCP server auto-start. Validated with `claude plugin validate`. Marketplace manifest at `.claude-plugin/marketplace.json` enables `plugin marketplace add ascend42/a-paradigm` → `plugin install paradigm@a-paradigm`.

- **Plugin Migration Script** — `plugins/paradigm/scripts/migrate-to-plugin.sh` removes per-project Claude Code hooks and paradigm-mcp from `.mcp.json` while preserving CLAUDE.md, .paradigm/, portal.yaml, Cursor hooks, and git hooks. Run on all 7 existing projects.

- **Portable Cursor MCP Config** — All projects now use `npx --package=@a-company/paradigm -y paradigm-mcp .` in `.cursor/mcp.json` — no machine-specific paths, works for any developer with npm.

- **Author & Repo Attribution** — CLAUDE.md and Cursor rules now include author (Matt Canoy), repo link, npm link, and plugin reference at the top. IDE adapters updated so `paradigm shift` generates these for new projects.

### Changed

- **Version 3.0.0** — Major version bump for Sentinel SDK, Lore system, plugin system, and University platform.
- **Read-only agents use `permissionMode: plan`** — Reviewer and security agents now enforce read-only constraint via `permissionMode: plan`, matching architect agent.
- **npm publish ready** — `npm i -g @a-company/paradigm` installs both `paradigm` CLI and `paradigm-mcp` server. All `@a-company/*` workspace deps bundled via tsup `noExternal`. MCP server built as second entry point (`dist/mcp.js`). `@a-company/paradigm-mcp` marked private. Optional commands (`sentinel`, `university`) gracefully handle missing packages. CI fixed from stale `@horizon/cli` reference. Stale `@horizon/*` changeset deleted.

### Added

- **Lore System** — Unified project timeline that captures every agent session, human note, decision, review, incident, and milestone. YAML-based storage in `.paradigm/lore/entries/` (date-partitioned, one file per entry, human-editable). `LoreEntry` type with author tracking (human vs agent with model), symbol references (touched/created), file artifacts (created/modified with line counts), decisions with rationale, errors with resolutions, learnings, verification status (per-check breakdown), and human review scores (completeness + quality 1-5). `LoreTimeline` index in `.paradigm/lore/timeline.yaml` with author list and entry count. Storage layer: `recordLore()`, `loadLoreEntries()` with composable filters (author, type, symbol, date range, tags, review status), `addReview()`, `rebuildTimeline()`. Filter system supports AND-composed queries with limit/offset pagination.

- **Lore MCP Tools (3)** — `paradigm_lore_search` (query entries by symbol, author, date, tags), `paradigm_lore_record` (record new lore entries), `paradigm_lore_timeline` (timeline overview with recent entries, active authors, hot symbols). Registered in paradigm-mcp tool dispatch with `paradigm_lore_*` prefix routing. Lore loader utility (`lore-loader.ts`) bridges MCP context to lore storage.

- **Lore CLI Commands** — `paradigm lore` launches the Timeline UI (default). Subcommands: `paradigm lore list` (table output with color-coded types, verification icons, review stars; filters: `--author`, `--type`, `--symbol`, `--tags`, `--limit`, `--json`), `paradigm lore show <id>` (full detail view with all sections), `paradigm lore record` (create human-note/milestone/decision via CLI flags), `paradigm lore review <id>` (add completeness + quality scores with `--reviewer`, `--notes`).

- **Lore Timeline UI** — Thread-style web timeline launched via `paradigm lore` (port 3840). React 18 + Vite + Zustand SPA served by Express. Three views: **Thread** (vertical timeline spine — human entries left, agent entries right, date separators), **Symbol** (sidebar with symbol counts, filtered entries for selected symbol), **Author** (sidebar with author list + last active date, filtered entries). Components: `LoreCard` (type-colored, symbol pills, verification badge, review stars, file/line stats), `DetailPanel` (slide-in with decisions, errors, learnings, verification breakdown, review section), `FilterBar` (author/type dropdowns, symbol autocomplete, date range, tag multi-select, preset quick filters: Today/This Week/Needs Review/Decisions/Incidents), `DateSeparator`, `SymbolTag` (colored by symbol type), `ReviewStars`, `VerificationBadge`, `ViewSwitcher`. Color system: symbol-type spectral palette + entry-type colors (indigo/emerald/amber/purple/red/blue). API: `/api/lore` (list+filter), `/api/lore/:id` (detail), `/api/lore/:id/review` (PUT), `/api/lore/timeline`, `/api/lore/symbols`, `/api/lore/authors`, `/api/info`, `/api/health`.

- **Auto-scaffolding (`paradigm scan --init`)** — New `--init` flag on `paradigm scan auto` generates both `.purpose` files AND `portal.yaml` from codebase analysis. Detects auth middleware patterns (JWT, session, isAuthenticated, hasRole, etc.) to infer `^gates`, scans route files for HTTP endpoints (Express/Fastify/Hono/Next.js) to build route entries. Writes `portal.yaml` with detected gates and routes. Respects `--force` for overwriting existing files. Zero-friction onboarding for existing codebases.

- **MCP Safety Annotations** — Added `readOnlyHint` and `destructiveHint` annotations to 100 MCP tools across three packages. **paradigm-mcp**: 54 tools across 14 files (2 destructive: `paradigm_purpose_remove`, `paradigm_reindex`). **sentinel**: 8 tools in `mcp.ts` (5 read-only, 3 write). **atelier**: 37 tools across 11 files (3 destructive: `atelier_remove_layer`, `atelier_remove_state`, `atelier_remove_delta`). Conforms to `ToolAnnotationsSchema` from `@modelcontextprotocol/sdk`. Enables MCP clients to surface safety hints in tool directory listings.

- **Sentinel Phase 1: Standalone Local Tool** — `@a-company/sentinel` v0.2.0 is now a standalone package with SDK, CLI, framework adapters, and MCP server. New `Sentinel` class (`src/sdk.ts`) wraps the core engine with a developer-friendly API: `sentinel.capture()`, `sentinel.component()`, `sentinel.gate()`, `sentinel.flow()`. `FlowTracker` class tracks multi-step flows with `expect()`, `step()`, `gate()`, `signal()`, `fail()`. Framework adapters for Express (`@a-company/sentinel/express`), Fastify (`@a-company/sentinel/fastify`), and Hono (`@a-company/sentinel/hono`) auto-capture errors with route-derived symbolic context. `.sentinel.yaml` config loader/writer (`src/config.ts`) with simple YAML parser. Auto-symbol detector (`src/detector.ts`) infers `#components`, `^gates`, `!signals`, `$flows` from codebase directory structure and `.purpose` files. Standalone CLI (`sentinel` binary) with `init`, `dashboard`, and `triage` commands (list, show, resolve, stats) — formatting ported from paradigm triage. Standalone MCP server (`sentinel-mcp` binary) with 8 tools (`sentinel_triage`, `sentinel_show`, `sentinel_resolve`, `sentinel_patterns`, `sentinel_add_pattern`, `sentinel_record`, `sentinel_stats`, `sentinel_suggest_pattern`). Multi-config tsup build (lib+DTS, CLI+shebang, MCP+shebang). `SentinelStorage` now supports `SENTINEL_DATA_DIR` env var for standalone users. New SDK types: `SentinelConfig`, `ComponentContext`. Package exports updated for adapter subpaths.

- **Discipline System** — Auto-detection and per-discipline configuration. `detectDiscipline()` examines project files to infer project type from 14 disciplines (`web`, `backend`, `fullstack`, `api`, `cli`, `ml`, `mobile`, `game`, `embedded`, `devops`, `data`, `library`, `monorepo`, `custom`). Each discipline gets tailored symbol mappings, purpose-required patterns, and scan patterns. Wired into `paradigm init` (auto-populates config), `paradigm shift` (detects for existing projects), and `paradigm scan` (discipline-aware patterns). Template `disciplines.md` rewritten for v2. `context-builder.ts` cleaned of v1 symbol remnants.

- **University: Discipline System lesson updates** — PARA 201 disciplines lesson rewritten with auto-detection section, 14-discipline table, domain-specific disciplines (ML, Data, Game, Embedded). PLSAT v2.0/v3.0 discipline references updated (`fullstack-saas` → `fullstack`, `cli-tool` → `cli`). Reference.json CLI flags updated.

- **Session Checkpoints + Auto-Recovery** — Cognitive-transition checkpoints for crash recovery. New `paradigm_session_checkpoint` MCP tool saves lightweight snapshots (phase, context, modified files, symbols, decisions, last 10 breadcrumbs) at workflow transitions (planning → implementing → validating → complete). Dual-writes to both local (`.paradigm/session-checkpoint.json`) and global (`~/.paradigm/sessions/{hash}/checkpoint.json`). Checkpoints older than 7 days are automatically discarded. Auto-recovery on first tool call: the MCP server detects new sessions and prepends a `--- SESSION RECOVERY ---` preamble to the very first tool response with checkpoint data (phase, context, files, symbols, decisions) and pending handoffs — agents receive recovery context with zero protocol overhead, even after "clear context" or crash. Recovery fires once per session via `hasRecoveredThisSession()` gating. `paradigm_session_recover` enhanced to include checkpoint data (prioritized in suggestions over raw breadcrumbs). New `buildRecoveryPreamble()` shared helper. New `generateCheckpointProtocol()` in IDE adapter base — integrated into Claude adapter (CLAUDE.md) and Cursor adapter (paradigm-context.mdc). `paradigm_session_checkpoint` added to MCP tool reference table. `.gitignore` updated for `session-checkpoint.json` and `session-breadcrumbs.json`. All 16 paradigm projects updated via `paradigm shift` for parity.

- **Two-Stage Review Protocol** — Reviewer agent prompt restructured with a hard two-stage gate: Stage 1 (Spec Compliance) verifies `.purpose` registrations, `^gate` implementation, `$flow` step sequences, `!signal` emissions, and `~aspect` enforcement. If Stage 1 fails, the reviewer stops immediately and hands back to the builder — no code quality review of spec-noncompliant code. Stage 2 (Code Quality) covers OWASP security, conventions, test coverage, and error handling. Applied to both `packages/paradigm/src/core/agent-prompts.ts` and `packages/paradigm-mcp/src/tools/orchestration.ts`.

- **Adversarial Review (Minimum 3 Findings)** — Every reviewer output must produce at least 3 categorized findings: `blocking` (must fix), `improvement` (should fix), or `note` (informational). Only blocking findings prevent approval. Eliminates rubber-stamp "looks good" reviews with zero findings.

- **Fresh Context Principle** — Builder agent prompt now includes explicit isolation guidance: each builder task runs in a separate, clean context. Builders must re-read specs and handoff context for every invocation, never carrying assumptions from prior tasks. "Implement multiple unrelated tasks in the same context" added to builder DON'T list. Applied to both prompt locations.

- **Clarification Markers (`[NEEDS CLARIFICATION: ...]`)** — Convention for marking ambiguous requirements in `.purpose` file descriptions instead of guessing. `paradigm_purpose_validate` scans all description fields (components, features, gates, signals, aspects, flows) for the marker regex and reports matches as warnings. `paradigm doctor` counts total markers across all `.purpose` files and reports as a warning check. Documented in `CLAUDE.md` with format, placement rules, and resolution guidance.

- **University: Two-Stage Review Protocol lesson content** — PARA 401 Agent Roles lesson gains "Reviewer Protocol" subsection covering the two-stage review and minimum 3 findings rule, plus quiz question Q6 testing Stage 1 failure behavior.

- **University: Fresh Context Principle lesson content** — PARA 401 Multi-Agent Coordination lesson gains "Fresh Context Principle" subsection explaining builder isolation and added to keyConcepts.

- **University: Clarification Markers lesson content** — PARA 301 Doctor & Validation lesson gains "Clarification Markers" subsection explaining the format and how doctor/validate surface them, plus quiz question Q5 testing marker severity (warnings not errors).

- **PLSAT v3.0 new variants** — `plsat-042b` (two-stage review: Stage 1 spec compliance failure stops review, doesn't proceed to Stage 2) and `plsat-038b` (clarification markers are warnings, not errors).

- **Global Brain (`~/.paradigm/`)** — Cross-session and cross-project persistence layer for the MCP server. New `#GlobalStore` utility (`packages/paradigm-mcp/src/utils/global-store.ts`) manages `~/.paradigm/sessions/{hash}/` for session breadcrumbs and pending handoffs, and `~/.paradigm/wisdom/` for global antipatterns/decisions/preferences. `paradigm_handoff_prepare` now persists handoffs to global store — next session's `paradigm_session_recover` automatically loads and delivers them (no more manual `paradigm team accept`). `paradigm_wisdom_record` gains a `scope` parameter (`project` | `global`). New `paradigm_wisdom_promote` tool promotes project-local wisdom to global scope. `paradigm_wisdom_context` merges global + local wisdom transparently. Session tracker dual-writes breadcrumbs to both `.paradigm/session-breadcrumbs.json` (project) and `~/.paradigm/sessions/` (global). New `~global-persistence` aspect with anchors. New signals: `!handoff-persisted`, `!handoff-delivered`, `!wisdom-promoted`. New flows: `$handoff-roundtrip`, `$wisdom-promotion`.

- **Hook enforcement v2** — PostWrite and Stop hooks rewritten for stronger paradigm compliance. PostWrite hook now tracks every modified source file in `.paradigm/.pending-review` (deduplicated), outputs periodic compliance reminders (every 3rd edit) referencing all 5 symbol types (`#components`, `~aspects`, `!signals`, `$flows`, `^gates`), warns that the stop hook WILL BLOCK, and names the specific `.purpose` file to update. Stop hook lowers the blocking threshold from 3 to 2 source files, adds Check 5 (per-directory `.purpose` freshness — reads `.pending-review` and verifies each covering `.purpose` was also modified), adds Check 6 (aspect coverage advisory — detects `~aspect` definitions and warns about stale anchors/applies-to patterns), and outputs specific MCP tool remediation commands. Cleans up `.pending-review` on pass. All 4 hook variants updated (Claude Code + Cursor, postwrite + stop). Propagates to all projects via `paradigm hooks install --force`.

- **Test suite for Paradigm CLI** — 102 tests across 7 test files using Vitest. Covers config parser, IDE adapter generators, adapter registry/detection, adapter contract tests (parameterized across all 5 adapters), scan utilities, doctor command, and hooks system (Claude Code, Cursor, Git). Includes shared `createTempProject()` test helper for temp directory scaffolding. CI pipeline runs tests on Node 18/20/22 matrix.

- **Cursor hooks** (`.cursor/hooks.json`): Compliance enforcement hooks for Cursor IDE — stop hook (blocks on missing .purpose), post-write hook (advisory .purpose reminder), pre-commit hook (auto-rebuilds index). Install with `paradigm hooks install --cursor`. Automatically included in `paradigm shift`.

- **AGENTS.md generation**: Universal AI agent instruction file (cross-IDE standard). New `agents` adapter generates `AGENTS.md` at repo root with project overview, symbol system, MCP tool reference, workflow protocol, session recovery, commit conventions, and more. Run `paradigm sync agents` or let `paradigm shift` generate it automatically.

- **Cursor rule mode optimization**: 4 Cursor rules (`paradigm-orchestration`, `paradigm-context`, `paradigm-commits`, `paradigm-flows`) switched from `alwaysApply: true` to intelligent application via improved descriptions. Reduces context overhead — rules only load when relevant.

- **Session recovery in all adapters**: `paradigm_session_recover` is now surfaced in Cursor context rules and the Claude adapter template, ensuring all IDEs prompt agents to load previous session breadcrumbs.

- **Shared IDE generators**: New `generateMcpToolReference()`, `generateWorkflowProtocol()`, and `generateHandoffProtocol()` in `base.ts` — reusable across AGENTS.md and future adapters.

- **Session breadcrumb wiring**: `paradigm_session_recover` now returns real data. Every MCP tool call automatically records a breadcrumb (tool name, summary, symbol) via `addToolBreadcrumb()` in the dispatch layer. `setRootDir()` is called at server startup so breadcrumbs persist to `.paradigm/session-breadcrumbs.json`. New sessions can call `paradigm_session_recover` to see what the previous session was working on.

- **Dark/light mode toggle for University** — Theme toggle button in the header (right of version badge), persists preference in localStorage. Full dark theme with inverted parchment palette, brightened symbols/accents, readable button text, and visible quiz choice options. University Seal SVG uses CSS custom properties (`var(--burgundy)`, `var(--gold)`, `var(--sym-*)`) for all colors — natively theme-aware with no filter hacks.

- **University UX improvements** — Course catalog redesigned as single-column list with lesson topic tags, progress ring, and "Start course" CTA. Sidebar navigation no longer resets scroll position. Dark mode: improved active sidebar item contrast (gold bg), provider cascade section grouped by ecosystem (Anthropic/Claude, Cursor, Universal). PARA 401 multi-agent lesson updated with model configuration commands (`paradigm shift`, `paradigm team models`, `--refresh`) and new quiz question. Markdown renderer paragraph regex fixed to only skip block-level tags — inline tags (`<strong>`, `<code>`, `<em>`) now correctly get `<p>` wrappers, fixing bold-numbered lists (e.g. "The Operational Loop") rendering as a single blob. Inline `code` elements restyled with stronger gold background and subtle border for better contrast in both light and dark modes.

- **Markdown rendering in quiz/PLSAT questions** — Extracted `renderMarkdown` to shared utility (`utils/renderMarkdown.ts`). Scenarios, question text, choices, and explanations now render code blocks, inline code, bold, and other markdown. YAML gate definitions in PLSAT choices display as proper code blocks. Passage questions always show their full passage inline — removed "scroll up" backtracking message.

- **Framework-agnostic course content** — Replaced all React/Express/Zustand-specific references in courses (PARA 101, 201, 301) and PLSAT exams (v2.0, v3.0) with generic terms (UI component, frontend hook, server stack). Paradigm is framework-agnostic and the educational content now reflects that.

- **Portal.yaml for university routes** — All 5 university API routes (`/api/courses`, `/api/courses/:id`, `/api/courses/:id/lessons/:lessonId`, `/api/plsat`, `/api/plsat/:version`) documented with `^local-only` gate (localhost-only learning platform, no auth required).

### Security

- **npm audit: 0 vulnerabilities** — Fixed all 5 reported vulnerabilities (2 moderate, 3 high). Upgraded `vite` ^5 → ^6.4 in sentinel (fixes esbuild dev server exploit, CVE in esbuild ≤0.24.2). Upgraded `glob` ^10 → ^13 in paradigm, portal-core, and purpose-core (fixes minimatch ReDoS via glob transitive dep). Removed `@vscode/vsce` from paradigm-vscode devDependencies entirely — it was only used as a CLI for `vsce package`/`vsce publish`, replaced with `npx @vscode/vsce`. vsce v2 and v3 both carry a vulnerable `minimatch ^3.0.3` direct dependency with no upstream fix; since it's a CLI-only tool with no user-controlled glob input, the ReDoS has zero actual attack surface. Bumped root engine requirement from Node >=18 to >=20 (Node 18 EOL'd April 2025).

### Fixed

- **Markdown renderer: table and ordered list support** — `renderMarkdown()` now handles markdown tables (`| col | col |` with separator rows) and ordered lists (`1. item`). Tables render as proper `<table>` HTML with inline markdown in cells. Ordered lists render as `<ol><li>` instead of collapsing into a single paragraph.

- **Code block line spacing in University lessons** — `renderMarkdown()` paragraph regex was wrapping lines inside `<pre>` blocks with `<p>` tags, causing double line spacing. Fixed with placeholder extraction approach.

- **University TypeScript errors** — Fixed 5 TS7030 errors in route handlers (`courses.ts`, `plsat.ts`) where early-return paths caused "not all code paths return a value". Added missing `chalk` dependency to `packages/university/package.json`.

- **MCP tool routing**: `paradigm_session_recover` was registered and handled but never dispatched — the routing guard in `tools/index.ts` didn't match its name. Broadened condition to `paradigm_session_*` prefix matching.

- **Lore timeline undercounting legacy entries** — `rebuildTimeline()` and `loadLoreEntries()` only scanned date-partitioned directories (`entries/YYYY-MM-DD/`), silently skipping old-format YAML files placed directly in `entries/`. Added `migrateLegacyEntries()` that auto-converts old-format entries (no `id`, no `author` block, `date` string, `test_results`) to v2 schema and moves them into proper date directories on first access. Applied to both `packages/paradigm/src/core/lore/storage.ts` and `packages/paradigm-mcp/src/utils/lore-loader.ts`.

### Planned

- **Paradigm University content review** — 27 tracked items in `packages/university/CHANGES.md`:
  - Remove all v1 symbol references (9 items) — university teaches v2 only, no migration content
  - Rethink logger presentation (11 items) — present as philosophy/approach, not concrete API
  - Fix client-side routing (3 items) — lessons need URL segments, back button support, quiz→next-lesson flow
  - Replace `paradigm init` → `paradigm shift` (10 occurrences across 5 files)
  - Replace v1 quiz question in PARA-101 with pure v2 question
  - Fix header nav centering and Courses link behavior (2 items)

## [2.0.13] - 2026-02-09

### Added

- **Paradigm University**: New `packages/university/` — interactive academia-themed learning platform for the Paradigm framework. Express server + Vite React SPA (mirroring the Sentinel dual-build pattern). Launched via `paradigm university` CLI command on port 3839.

- **4 courses (PARA 101–401)**: 36 lessons covering foundations (symbols, purpose files, tags, logger), architecture (flows, gates, aspects, portal protocol), operations (history, fragility, wisdom, ripple, sentinel), and orchestration (MCP tools, multi-agent coordination, PM governance). Each lesson has markdown content and 3–5 ABCDE quiz questions (153 total).

- **PLSAT v2.0 certification exam**: 50-question, 45-minute timed assessment. Distribution: 101=20%, 201=30%, 301=26%, 401=24%. Includes scenario-based questions, code identification, ordering, and tricky distractors. 80% pass threshold generates a versioned certificate persisted to LocalStorage.

- **Reference library**: 41 quick-reference cards across 5 sections — symbols (5), MCP tools (14), CLI commands (9), tags (8), and workflow checklists (5).

- **Academia theme**: Crimson Pro serif + Inter sans-serif fonts, parchment (#F5F1E8) background, burgundy (#6B1C23) primary, gold (#C5A572) accents. SVG university seal with "Universitas Paradigmatica — Lux in Codice" motto, laurel wreath, and colored symbol dots.

- **Progress tracking**: Three Zustand stores with LocalStorage persistence — lesson completion, quiz scores, and PLSAT certificates with student name, score, version, and date.

- **Printable certificates**: CertificateView renders formal certificate with seal, name, score, PLSAT version, framework version, and date. Print-optimized CSS.

### Changed

- Root `.purpose`: Added `university-platform` feature with component refs, signals (`!plsat-completed`, `!quiz-completed`), and flow (`$plsat-exam-flow`).
- `packages/paradigm/.purpose`: Added `university-command` and `#university-launcher`.
- `packages/paradigm/src/index.ts`: Registered `paradigm university` CLI command.

## [2.0.12] - 2026-02-07

### Added

- **PM Governance Layer**: Automated compliance enforcement for AI-assisted development. Two new MCP tools (`paradigm_pm_preflight`, `paradigm_pm_postflight`) provide pre-task compliance planning and post-task violation detection — checking symbol registration, portal.yaml gate coverage, ripple analysis, and wisdom capture.

- **PM agent role for CLI orchestration**: New `pm` role (Sonnet-tier) in `paradigm team orchestrate --pm` decomposes tasks, injects compliance context into agent prompts, and validates results. Preflight runs before agent planning; postflight checks all modified files and symbols after execution.

- **Core compliance engine** (`pm-compliance.ts`): Shared module used by both MCP tools and CLI orchestrator. `runPreflight()` extracts symbols from task text, runs ripple analysis, checks portal.yaml, suggests agents. `runPostflight()` scans for route patterns (Express/Fastify/SvelteKit), cross-references against portal.yaml, checks .purpose coverage, flags unregistered symbols.

- **`paradigm mcp use-dev`**: Switches all detected AI client MCP configs to point at the local working directory's built `packages/paradigm-mcp/dist/index.js` for safe development and testing.

- **`paradigm mcp use-prod`**: Reverts MCP configs to use the global `paradigm-mcp` binary. Supports `--client` flag to target a specific client.

- **Enhanced `paradigm mcp status`**: Now shows `[DEV]` or `[PROD]` mode per client with server details and paths.

- **`paradigm promote`**: Copies local build to production (`~/.paradigm-cli/`). Builds packages, copies 6 dist/ directories (paradigm, paradigm-mcp, premise-core, portal-core, purpose-core, sentinel), switches MCP configs back to prod, and verifies with version check. Supports `--skip-build`, `--force`, `--json`.

- **IDE adapter PM governance table**: Generated CLAUDE.md files now include PM Governance section instructing agents to call `paradigm_pm_preflight` before tasks and `paradigm_pm_postflight` after.

### Changed

- **`mcp/setup.ts` exports**: `detectAllClients()`, `getServersFromConfig()`, `writeConfig()`, `getProjectName()`, `generateMCPConfig()`, `AIClient`, `ServerInfo` are now exported for reuse by `switch.ts`.

## [2.0.11] - 2026-02-07

### Added

- **10 aspects (~) with verified code anchors**: Added `~yaml-config-loading`, `~zod-validated`, `~symbol-typed-logging`, `~mcp-tool-handler`, `~ide-adapter-pattern`, `~provider-cascade`, `~express-server`, `~budget-enforced`, `~file-glob-discovery`, `~correlation-tracked` — each pointing to real `file:line-range` anchors in the source. This is Paradigm's most distinctive symbol type and was previously unrepresented in the project's own metadata.

- **7 new flows ($)**: `$install-flow`, `$symbol-aggregation`, `$purpose-parsing`, `$ide-sync-flow`, `$agent-orchestration-flow`, `$portal-validation-flow`, `$mcp-request-flow` — documenting multi-step processes end-to-end. Total flows: 12 (up from 6).

- **4 new sub-module .purpose files**: Granular coverage for `packages/paradigm/src/core/` (14 components), `packages/paradigm/src/core/ide-adapters/` (6 components), `packages/paradigm/src/core/providers/` (6 components + 2 signals), `packages/logger/` (6 components). Total .purpose files: 15 (up from 11).

- **Sentinel portal.yaml**: Authorization topology for Sentinel API with `^api-authenticated` and `^admin-only` gates across 6 routes.

- **Aspect/flow links on 6 existing .purpose files**: Root `.purpose`, `purpose/core`, `portal/core`, `premise/core`, `paradigm-mcp`, and `sentinel` enriched with cross-references to the new aspects and flows.

### Changed

- Total symbol count: **287** (up from ~244). 10 aspects, 12 flows, 6 gates, 31 signals, 228 components.

## [2.0.10] - 2026-02-07

### Fixed

- **MCP config generation uses `paradigm-mcp` instead of `npx`**: All MCP config generators (Cursor adapter, Claude adapter, `mcp setup` command) now emit `"command": "paradigm-mcp"` with `"args": ["."]` and `"cwd"` pointing to project root. The old `npx @a-company/paradigm-mcp` config never worked because the package isn't on npm. `paradigm shift` and `paradigm mcp setup` now produce working `.cursor/mcp.json` and `.mcp.json` out of the box.

## [2.0.9] - 2026-02-07

### Fixed

- **Install script: permanent source directory**: Rewrote `install.sh` to clone to `~/.paradigm-cli/` instead of `/tmp/`. `npm install -g .` creates symlinks back to source files — the old temp dir cleanup broke every install. Now installs both `paradigm` and `paradigm-mcp` CLIs, supports re-running for updates (git pull + rebuild), and warns users not to delete the source directory.

## [2.0.8] - 2026-02-07

### Fixed

- **Install script verification in piped shells**: `curl | bash` installs now verify correctly. Replaced `command -v` check (fails in piped shells where PATH hash isn't refreshed) with direct binary path lookup via `$(npm config get prefix)/bin/paradigm`. Shows a helpful PATH note instead of a false error.

## [2.0.7] - 2026-02-06

### Fixed

- **Clean TypeScript build — 171 errors → 0**: Full v1 debt elimination in `packages/paradigm/`. `tsc --noEmit` now exits 0.

- **Deleted dead `src/commands/dream/` directory**: Identical copy of `premise/`, leftover from v1 rename. Fixed `src/index.ts` imports to use `premiseAggregateCommand`/`premiseSnapshotCommand`.

- **Replaced all v1 symbol type references**: 8 command files (`status`, `constellation`, `aggregate`, `summary`, `beacon`, `probe/index`, `scan/index`, `ripple`) updated from 7-type system (`@feature`, `%state`, `?idea`) to v2 5-type (`#component`, `$flow`, `^gate`, `!signal`, `~aspect`). Display, interfaces, categorization, and JSON output all updated.

- **Fixed config owner types**: `paradigm-config.ts` and `legacy-config.ts` — replaced invalid `owner: 'gate'` → `'portal'`, removed dead `?` symbol entry, updated `SymbolSystem` interface to v2 5-symbol set with index signature for migration compat.

- **Fixed missing module/type errors**: `log.gate()` → `log.command()` in portal check, moved `createGate` import to correct package (`portal-sdk`), suppressed optional `portal-viewer` dynamic imports, fixed `chalk.Chalk` type → `typeof chalk.red`, `ora.Ora` → `ReturnType<typeof ora>`, `tracker.failure()` → `tracker.error()`.

- **Fixed remaining type mismatches**: Added `*-manifest` variants to `ModelDiscoveryResult.source` union, passed `model` arg to orchestrator callbacks, typed `adapters` Map explicitly, added `config.states` guard in setup wizard.

- **Cleaned ~95 unused variable warnings across ~40 files**: Removed dead imports, deleted unused functions (`groupByDirectory`, `isFeatureDirectory`, `formatBytes`, `GATE_REFERENCE_PATTERNS`), removed unused class properties (`rootDir` in 3 classes, `budgetTracker`), prefixed intentionally unused params with `_`.

## [2.0.6] - 2026-02-06

### Changed

- **v2 release cleanup across 84 files** (~11,800 lines removed, ~500 added): Comprehensive pass to make the entire codebase v2-consistent before release.

- **Deleted `examples/` directory**: Removed v1/Horizon-era shopflow example and pattern docs (will be replaced with links to real projects).

- **Moved planning docs to `.plans/`**: Relocated 5 internal planning docs (`CASE-STUDY.md`, `CASE-STUDY-RECOMMENDATIONS.md`, `paradigm-website-outline.md`, `paradigm-visualizer-sentinel.md`, `taskflow-split-test.md`) out of `docs/`.

- **Rewrote IDE rules for v2**: `.windsurfrules` and 8 `.cursor/rules/*.mdc` files fully rewritten — v1 9-symbol table → v2 5-symbol + tag bank, v1 logger calls → v2 API, "portals" → "gates".

- **Rewrote `packages/paradigm/README.md`**: Updated from v0.4.0/v1 symbols to current version with v2 symbol system, tag bank, and current command list.

- **Added `packages/logger/README.md`**: Documents the v2 logger API (`component()`, `gate()`, `signal()`, `flow()`, `aspect()`, `raw()`).

- **Updated docs**: `docs/commands/` (constellation, ripple, index, beacon) — "Portals" → "Gates", removed `%state` rows. `docs/tutorial-project.md` — all `@feature` → `#component` with `[feature]` tags, removed `%state` rows. `docs/content-guide.md` — "8 symbols" → "5 operational symbols". `docs/README.md` — fixed GitHub URLs to `ascend42/a-paradigm`.

- **Updated `CONTRIBUTING.md`**: Replaced stale `prism/` package reference with actual packages, added `Symbols:` trailer convention.

- **Updated `DISTRIBUTION.md`**: Version references updated throughout.

- **Resolved open questions in `symbols-v2.md`**: Marked 4 open items as decided/deferred.

### Fixed

- **Internal source renames (breaking API changes)**:
  - `premise-core` (0.1.0 → 0.2.0): `DreamFile` → `PremiseFile`, `DreamNode` → `PremiseNode`, all `Dream*` types → `Premise*`. `SourceType` enum `'gate' | 'dream'` → `'portal' | 'premise'`. `AggregationResult.gateFiles` → `.portalFiles`. `PremiseFile.sources.gate` → `.sources.portal`. Functions: `parseDreamFile` → `parsePremiseFile`, `aggregateFromDream` → `aggregateFromPremise`, etc.
  - `probe-core` (0.1.0 → 0.2.0): `HORIZON_VERSION` → `PARADIGM_VERSION`, `AggregationInput.gateFiles` → `.portalFiles`, `horizonVersion` → `paradigmVersion` in schema.
  - `paradigm` CLI (1.4.0 → 1.5.0): `dreamPath` → `premisePath` in init/setup/doctor, `paradigm dream aggregate` → `paradigm premise aggregate` in cursorrules generator, `'gate' | 'dream'` → `'portal' | 'premise'` in config types.
  - `sentinel`: `source: 'gate'` → `'portal'`, `result.gateFiles` → `result.portalFiles` in symbol loader.
  - `paradigm-vscode`: `'@feature-name'` → `'#component-name'` in snippets.

## [2.0.5] - 2026-02-06

### Added

- **Logger package (`@a-company/paradigm-logger`)**: Full v2 logger implementation in `packages/logger/src/` — previously an empty scaffold. Implements `ParadigmLogger` class with `.component()`, `.gate()`, `.signal()`, `.flow()`, `.aspect()`, `.raw()` methods, each returning a `SymbolLogger` with debug/info/warn/error/start. Includes duration tracking (`.start()` → `.success()`/`.error()`), pretty format (ANSI colors, dev) and JSON format (production), level filtering via `LOG_LEVEL`, symbol filtering via `PARADIGM_SYMBOLS`, and correlation ID support via `AsyncLocalStorage`. Builds as CJS + ESM + DTS.

### Fixed

- **MCP config path for Cursor**: `writeMcpConfig()` was writing both Cursor and Claude configs to `.mcp.json` at project root. Cursor only reads from `.cursor/mcp.json`. Now Cursor writes to `.cursor/mcp.json` and Claude Code writes to `.mcp.json`.

- **v1 symbol cleanup across 40+ files**: Replaced `@feature`/`@checkout`/`@login` → `#component` refs, `log.feature()`/`log.state()`/`log.integration()` → `log.component()`, `^portal` → `^gate`, `%state` → `#state-store [state]`, `&integration` → `#component [integration]` across:
  - `.paradigm/specs/` — purpose.md (full v2 rewrite), navigator.md, history.md, probe.md, context-tracking.md, wisdom.md
  - `.paradigm/docs/` — commands.md, troubleshooting.md, ai-maintenance-protocol.md, and 5 files in commands/
  - `docs/` — 12 files including guides, command refs, content-guide, website outline
  - `packages/paradigm/templates/` — all spec, doc, and prompt templates shipped to new projects
  - `.github/instructions/` — purpose, agent-hints, logging instruction files
  - `.github/copilot-instructions.md`, `packages/paradigm-mcp/README.md`, `packages/paradigm-vscode/README.md`, `packages/paradigm/README.md`
  - Root `README.md` symbol table rewritten from 6 v1 symbols to 5 v2 symbols + tag bank

- **Deleted 4 stale architect task files** from `.paradigm/tasks/`

## [2.0.4] - 2026-02-06

### Added

- **`Symbols:` trailer protocol for commits**: New commit convention where a `Symbols:` trailer line lists all affected symbols machine-readably. The post-commit hook now parses this trailer to capture symbols for history, supplementing the existing `.purpose`-based extraction. Symbols from both sources are deduplicated.

- **Shared `generateCommitConvention()` in base.ts**: All IDE adapters now use a single shared function for commit convention output, ensuring consistency across Claude, Cursor, Copilot, and Windsurf.

- **Commit conventions in all IDE adapters**: Previously only Claude had (v1) commit guidance. Now all adapters include the v2 commit convention with `Symbols:` trailer:
  - Cursor: new `paradigm-commits.mdc` (alwaysApply: true)
  - Copilot: new `paradigm-commits.instructions.md`
  - Windsurf: commit convention added to `.windsurfrules` output

### Fixed

- **v1 symbol remnants across all IDE adapters**:
  - `claude.ts`: `Paradigm v1.0` → `v2.0`, `@create-task` → `#create-task`, `@tasks` → `#tasks`, `feat(@feature)` → uses shared v2 convention, nested context `@%?` symbols → `#$^!~`
  - `cursor.ts`: frontmatter `@features, ^portals` → `#components, $flows, ^gates, !signals, ~aspects`, `.purpose` example rewritten from v1 to v2, agent hints `@symbol`/`@checkout` → `#`, `portals` → `gates`, flow steps `@validate-task-input`/`@create-task` → `#`, `@symbols` → `#symbols`
  - `copilot.ts`: `.purpose` example and agent hints — same v1→v2 fixes as Cursor
  - `base.ts`: navigator example `@checkout` → `#checkout`

- **Post-commit hook relaxed recording condition**: Previously required symbols from `.purpose` files AND history directory. Now records when symbols come from either `.purpose` extraction or commit message `Symbols:` trailer.

## [2.0.3] - 2026-02-06

### Added

- **Remote model manifest**: Model discovery now fetches `models.json` from GitHub before falling back to hardcoded presets. Update the manifest to push new models without a CLI release. Discovery priority: API keys (live) → remote manifest (7-day cache) → hardcoded fallback.

- **CLI commands as #components**: Migrated `packages/paradigm/.purpose` from v1 to v2 symbols. All 41 CLI commands now have `#component` entries with `path:`, `tags:`, and `used-by:` fields pointing to source files. Agents can now find any command via `paradigm_search` or `paradigm_navigate`.

### Changed

- **`paradigm shift` always prompts for model configuration**: The interactive model selection step now runs automatically during `paradigm shift` — no need for `--configure-models` flag. This makes the setup experience more engaging and ensures agents are configured with the right models from the start.

### Fixed

- **MCP config now writes to `.mcp.json` at project root**: Claude Code requires `.mcp.json` at the project root — `.claude/settings.json` doesn't work for MCP server declarations. Both `paradigm sync claude` and `paradigm mcp setup` now write to `.mcp.json`. If an existing `.mcp.json` is present, the paradigm server is merged in alongside other servers.
- **Added Claude Code to `paradigm mcp setup` detection**: The `mcp setup` command now detects Claude Code (via `.mcp.json` or `.claude/` directory) as a configurable client, alongside Cursor, Claude Desktop, Continue, and Cline.
- **Updated stale model presets**: All preset model lists were outdated (Claude 3.5, GPT-4o, Grok 2, Gemini 2.0, Llama 3.x). Updated across all environments (Cursor, Anthropic API, OpenAI API, Google API, xAI API, VSCode/Copilot):
  - Anthropic: Claude Opus 4.6, Claude Sonnet 4.5, Claude Haiku 4.5
  - OpenAI: GPT-4.1, GPT-4.1 Mini, GPT-4.1 Nano, o3, o4 Mini, o3 Mini
  - Google: Gemini 2.5 Pro, Gemini 2.5 Flash, Gemini 2.0 Flash
  - xAI: Grok 3, Grok 3 Mini
  - Meta: Llama 4 Scout, Llama 4 Maverick
  - DeepSeek: DeepSeek R1, DeepSeek V3
- **Updated model tiering logic**: Added `nano`, `scout` to low-tier patterns; added `gpt-4.1`, `o3`, `o4`, `grok-3`, `maverick`, `deepseek-r1` to high-tier patterns; updated family extraction for new model families
- **Fixed v1 logger examples in templates**: `log.feature('@login')` → `log.component('#login-handler')` in upgrade.ts and IDE adapter templates
- **Self-audit: migrated all Paradigm project files to v2 symbols**:
  - Root `.purpose`: replaced all `@feature` refs with `#component` + tags, removed `%state`/`states:` section, added `#team-orchestration` feature, updated relationships
  - `.paradigm/wisdom/antipatterns.yaml`: `@login` → `#login-handler`, `@register` → `#register-handler`
  - `.paradigm/agents.yaml`: architect focus/triggers changed from `@features`/`@*` to `#components`/`#*`
  - `.paradigm/docs/patterns.md`: full rewrite — all examples now use v2 logger methods, added `~aspect` pattern section, added v2 method reference table
  - `.paradigm/docs/error-patterns.md`: replaced `log.feature()`, `log.integration()` with `log.component()`
  - `base.ts` IDE adapter: `getLogMethodForSymbol()` now includes `~aspect`, v1 prefixes (`@`, `%`, `&`) map to `component()`

## Sentinel [0.1.1] - 2026-02-06

### Added

- **Project directory in header**: The Sentinel header now shows the project directory path next to the version badge, so you always know which project you're viewing. Long paths are truncated with ellipsis and show the full path on hover.

## [2.0.2] - 2026-02-05

### Fixed

- **YAML `!` signal quoting in docs**: All documentation examples now correctly quote `!` signals in YAML arrays (e.g., `["!success", "!failed"]` instead of `[!success, !failed]`). The `!` character is a YAML tag indicator and breaks parsing when unquoted in flow sequences. Fixed across 15 files including specs, templates, prompts, and examples.

- **Troubleshooting docs**: Added `!` quoting guidance to the "Common YAML issues" section alongside existing `@` quoting advice.

### Added

- **Top-level `aspects:` support in `.purpose` files**: The parser now recognizes `aspects:` as a top-level key in `.purpose` files, allowing projects to define aspect symbols (`~aspect-name`) with descriptions, tags, anchors, applies-to patterns, and enforcement rules.
  - Added `AspectDefinition` type to `purpose-core`
  - Added `AspectDefinitionSchema` (Zod) to parser
  - Added `extractAspects()` function to purpose-core aggregator
  - Wired aspect extraction into premise-core aggregator with anchor string parsing
  - Updated `schema.json` with `AspectDefinition`
  - Previously, top-level `aspects:` sections were silently stripped by Zod validation, causing aspect symbols to be missing from `paradigm scan` output

## [2.0.1] - 2026-02-05

### Fixed

- **Symbol false positives**: Fixed regex patterns that incorrectly matched prices (`$420`), variables (`$0`), and framework aliases (`$lib`, `$env`, `$app`) as flow symbols
  - Changed regex from `[\w-]+` to `[a-zA-Z][\w-]*` requiring letter after prefix
  - Added blocklist for common framework aliases (SvelteKit `$lib/$env/$app`, Vite `$virtual`, JSON `$schema/$ref`)
  - Fixed in: `premise-core`, `purpose-core`, and Sentinel fallback parser

- **Sentinel symbol loading**: Fixed Sentinel using its own fallback parser instead of premise-core
  - Sentinel now uses premise-core aggregator as primary source
  - Falls back to local scanner only if premise-core unavailable
  - Local scanner updated with same regex fixes

- **portal.yaml gate parsing**: Fixed gates not being extracted from portal.yaml
  - Updated fallback parser to properly extract gates from `gates:` section
  - Documented correct portal.yaml format (locks as array, prizes as objects)

### Added

- **Paradigm logging in Sentinel**: Added structured logging following paradigm patterns
  - Server startup logs: `#sentinel-server`
  - Symbol loading logs: `$load-symbols`, `#purpose-loader`, `#gate-loader`
  - API route logs: `^api-symbols`
  - Default log level: `info` (shows file loading, aggregation results)
  - Configurable via `SENTINEL_LOG_LEVEL` env var (`debug`, `info`, `warn`, `error`)

- **v2 migration prompt**: Added `.paradigm/prompts/update-to-v2.md` with comprehensive handoff prompt for updating projects to Symbol System v2

### Changed

- **Sentinel types updated to v2**: SymbolEntry type now uses v2 types (`component`, `flow`, `gate`, `signal`, `aspect`)
- **Logging on by default**: Sentinel now logs symbol loading and API access at `info` level by default

## [2.0.0] - 2026-02-05

### Breaking Changes

- **Symbol System v2**: Reduced from 9 symbols to 5 operational symbols
  - Removed: `@` (feature), `&` (integration), `%` (state), `?` (idea)
  - These are now tags: `[feature]`, `[integration]`, `[state]`, `[idea]`
  - `~` (aspect) now REQUIRES code anchors - unanchored aspects are invalid
  - Added: Tag bank system (`.paradigm/tags.yaml`)

### Added

- **Tag Bank System**: Classification via tags instead of symbol prefixes
  - Core tags: `feature`, `integration`, `state`, `critical`, `deprecated`, `idea`, `security`, `compliance`
  - Project-specific tags in `.paradigm/tags.yaml`
  - AI-suggested tags with human approval workflow
  - `suggested` section for AI to propose new tags

- **Anchors**: Line-based code references (`file.ts:15-20`)
  - Required for aspects (`~`)
  - Optional for other symbols
  - Format: single line (`file.ts:15`), range (`file.ts:15-20`), multiple (`file.ts:15,25,30`)

- **New Aspect Symbol (`~`)**: Cross-cutting rules with enforcement
  - Aspects MUST have code anchors pointing to enforcement code
  - `applies-to` patterns for automatic symbol matching
  - `enforcement` field for compliance instructions
  - Examples: `~audit-required`, `~rate-limited`, `~encrypted`

- **MCP Tools**:
  - `paradigm_tags()` - List, search, and manage tags
  - `paradigm_tags_suggest()` - AI proposes new tags for human review
  - `paradigm_aspect_check()` - Verify aspect anchors and coverage

- **Sentinel UI**:
  - Updated for v2 symbol types (#, $, ^, !, ~)
  - Tag display in all views (Grid, List, Canvas)
  - Properties Panel shows v2 symbol types

- **Migration Support**:
  - `parseLegacySymbol()` for parsing old @, %, ?, & symbols
  - `parseAnySymbol()` for handling both v1 and v2 formats
  - Legacy symbols auto-convert to #component with appropriate tags

### Changed

- **`#` Component is now universal**: All code units use `#` prefix
  - Features: `#checkout` with `tags: [feature]` (was `@checkout`)
  - Integrations: `#stripe-client` with `tags: [integration]` (was `&stripe`)
  - State: `#user-store` with `tags: [state]` (was `%user-store`)
  - Ideas: `#new-feature` with `tags: [idea]` (was `?new-feature`)

- **Logger methods updated**:
  - Removed: `log.feature()`, `log.integration()`, `log.state()`
  - Added: `log.aspect()`
  - All code units now use `log.component()`

- **`.purpose` file format updated**:
  - Version bumped to "2.0"
  - `tags` field for classification
  - `anchors` field for code references
  - Old `features:` sections should use `#` prefix with `[feature]` tag

- **config.yaml version bumped to "2.0"**:
  - `symbol-system` updated with 5 operational symbols
  - Added `tag-bank` configuration section
  - Updated `logging.symbol-mapping` for v2

- **CLAUDE.md updated for v2**:
  - New symbol table with 5 operational symbols
  - Tag bank explanation
  - Anchor format documentation
  - Updated logger examples

### Migration

Run `paradigm migrate v2 --dry-run` to preview changes, then `paradigm migrate v2` to execute.

**Manual steps required:**
1. Add anchors to all `~aspect` symbols
2. Review and approve AI-suggested tags
3. Update any custom tooling that parses symbols

### Files Changed

| File | Change |
|------|--------|
| `CLAUDE.md` | Updated symbol table, logger examples, conventions |
| `.paradigm/config.yaml` | v2 symbol system, tag bank config |
| `.paradigm/specs/symbols.md` | Complete rewrite for v2 |
| `.paradigm/specs/symbols-v2.md` | NEW - Full v2 specification |
| `.paradigm/specs/logger.md` | Updated methods and examples |
| `.paradigm/specs/disciplines.md` | Updated for v2 symbols + tags |
| `.paradigm/tags.yaml` | NEW - Tag bank definitions |
| `.paradigm/prompts/*.md` | Updated for v2 syntax |
| `examples/shopflow/**/.purpose` | Converted to v2 format |

---

## [1.9.0] - 2026-02-05

### Added

- **Sentinel UI Improvements** - Unified codebase intelligence visualizer enhancements
  - **Layout Modes** - Three view options for browsing symbols:
    - Canvas view: Free-form infinite canvas (default)
    - Grid view: Columns grouped by type (features, components, gates, etc.)
    - List view: Sortable table format
  - **Sorting Options** - Sort symbols by:
    - A-Z (alphabetical)
    - By Type (features → components → flows → gates → signals → states)
    - Recently Updated
    - Stale First (oldest modifications first)
  - **Live Editing** - Edit symbols and persist changes to `.purpose` files:
    - Description edits write back to source files
    - Tag additions/removals persist to files
    - Cached index (`.paradigm/index.json`) also updated
    - `PUT /api/symbols/:id` endpoint for programmatic updates
  - **GridView Component** - New column-based view grouped by symbol type
  - **ListView Component** - New table view with clickable sort headers

### Changed

- **Dark Mode Selection** - Fixed harsh selection styling in deep theme:
  - Type-specific selection glow (each type uses its own color)
  - Softer glow intensity for dark mode
  - Removed generic red border on selection
- **Node Dragging** - Disabled free-form dragging in browse mode
  - Nodes now use click-to-select (no drag)
  - Dragging will be re-enabled in future flow editor mode
- **Timeline Hidden** - Removed from default view
  - Will be shown when flow editing mode is implemented
  - Command input repositioned to bottom of screen
- **Toolbar** - Added layout toggle buttons and sort dropdown
  - Zoom controls only show in canvas mode

### Files Added

- `packages/sentinel/ui/src/components/Views/GridView.tsx`
- `packages/sentinel/ui/src/components/Views/ListView.tsx`

---

## [1.8.0] - 2026-02-05

### Added

- **Task Type Classification** - Intelligent agent selection based on task analysis
  - New `task-classifier.ts` detects: analysis, bugfix, feature, refactor, documentation
  - Analysis tasks use Architect only (0.4x cost)
  - Documentation tasks skip Builder/Tester (0.35x cost)
  - Keywords-based classification: "should", "what", "how" → analysis
  - Integrated into orchestrator for automatic agent right-sizing

- **Security Escalation Triggers** - Auto-involve Security agent for sensitive operations
  - Keywords: auth, permission, admin, delete, purge, password, credential, token
  - Gate symbols (^) in task description trigger escalation
  - Sensitive paths: `**/auth/**`, `**/middleware/**`, `**/security/**`
  - Security agent promoted to `required: true` with `opus` model

- **Cost Preview** - Estimated costs shown before agent spawn
  - New `cost-estimator.ts` calculates per-agent token estimates
  - Model pricing: opus ($15/$75), sonnet ($3/$15), haiku ($0.25/$1.25) per 1M tokens
  - Comparison to "full team" baseline in plan mode
  - `paradigm_orchestrate_inline` plan response includes `costPreview`

- **Portal Compliance Check** - Validate gates are used in codebase
  - New `paradigm portal check` command
  - Finds: declared but unused gates, used but undeclared gates
  - Language-agnostic grep-based detection
  - Integrated into `paradigm doctor` health checks

- **Auto-Ripple for Refactoring** - Automatic impact analysis
  - Detects refactoring tasks: rename, refactor, migrate, restructure
  - Runs `paradigm_ripple` before architect planning
  - Includes ripple results in architect context
  - Prevents breaking changes from missing dependencies

- **Purpose Tracker** - Post-task .purpose file prompts
  - Detects new directories without .purpose files
  - Generates .purpose templates for new features
  - Callback system for orchestrator integration

- **Flow Validation** - Define and validate multi-step flows
  - New `flow-schema.ts` with FlowStep, FlowDefinition types
  - New `flow-validator.ts` for validation logic
  - New MCP tool: `paradigm_flow_validate`
  - Checks: gates exist in portal.yaml, steps are complete
  - `.paradigm/flows.yaml` for flow definitions

- **Flow-First Development Guidance** - IDE adapters updated
  - Cursor: New `paradigm-flows.mdc` with flow-first protocol
  - Claude: Flow validation section in CLAUDE.md
  - Encourages defining flows before implementation

- **TaskFlow Split Test Updates** - Enhanced case study document
  - New pivots 6-9: Dangerous Operation, Documentation, Ripple, Flow-First
  - 30-point scoring system: Peace of Mind, Cost Efficiency, Scale Readiness
  - Paradigm-specific validation criteria per pivot

### Changed

- **Orchestrator** - Now uses task classification and security escalation
- **MCP Tools** - `paradigm_orchestrate_inline` returns classification and cost preview in plan mode
- **IDE Adapters** - Include flow-first development guidance

---

## [1.7.0] - 2026-02-05

### Added

- **Auto-Generated Orchestration Rules for Cursor** - Agents naturally use multi-agent workflows
  - `paradigm sync cursor` now generates `paradigm-orchestration.mdc`
  - MDC file includes: when to orchestrate, workflow steps, available agents, red flags
  - Agents list auto-populated from `.paradigm/agents.yaml`
  - `alwaysApply: true` ensures agents see orchestration guidance

- **Agent Suggestion CLI** - Preview which agents will handle a task
  - New command: `paradigm team agents suggest <task>`
  - Analyzes task against agent triggers (keywords, symbols)
  - Returns confidence levels (high/medium/low) with matched triggers
  - Suggests workflow order (architect → builder → tester, etc.)
  - `--json` flag for programmatic use

- **Enhanced MCP Orchestration** - Better planning with agent suggestions
  - `paradigm_orchestrate_inline` plan mode now returns `suggestedAgents` field
  - Agent suggestions ranked by confidence based on trigger matching
  - Updated tool description to be more directive about when to use orchestration

- **Dynamic Model Discovery** - Automatically discover available AI models based on environment
  - Detects Cursor, Claude Code, VSCode, and API provider environments
  - Fetches models from provider APIs when keys are available
  - 24-hour caching to avoid repeated API calls
  - Comprehensive presets for Cursor users (24+ models from 8 providers)

- **Interactive Model Selection** - Configure agent models during team init
  - `paradigm team init --configure-models` forces model selection prompts
  - `paradigm team init --no-configure-models` skips prompts (default in Claude Code)
  - Models grouped by tier (high/medium/low) with recommendations per agent role

- **Team Models Command** - View and configure agent model assignments
  - `paradigm team models` shows current configuration and available models
  - `paradigm team models --refresh` clears cache and re-discovers models
  - `paradigm team models --json` outputs machine-readable format

- **Shift Command Enhancement** - Now includes team initialization
  - `paradigm shift` now runs team init as Step 2/5
  - `paradigm shift --configure-models` enables model prompts during setup

- **Cursor CLI Agent Provider** - Native parallel agent support for Cursor IDE
  - New `cursor-cli` provider spawns agents via Cursor's `agent` CLI command
  - Supports parallel agent execution in Cursor environment
  - Auto-detected when running in Cursor (via environment variables)
  - Prioritized over `claude-cli` when Cursor environment is detected
  - `paradigm team providers` now shows `cursor-cli` availability

- **Model Visibility in Orchestration** - See which model runs each agent
  - Spinner and live output now shows `agent (model)` format (e.g., "builder (haiku)")
  - Orchestration MDC includes model assignments next to agent names
  - Helps understand cost and capability distribution across facets

- **OS-Aware Terminal Syntax Guidance** - Agents use correct commands for the OS
  - `paradigm_status` MCP tool returns OS platform and shell type
  - IDE instruction files include OS-specific terminal syntax tables
  - Windows users get PowerShell/CMD guidance
  - Mac/Linux users get bash/zsh guidance
  - Prevents agents from using `rm` on Windows or `del` on Unix

### Changed

- **Team Init** - Now auto-detects environment and prompts for models in Cursor/interactive terminals
- **Agent Types** - Added `ModelInfo`, `ModelConfig`, `ModelDiscoveryResult` types
- **Loader** - `generateDefaultManifest()` now accepts optional model overrides

---

## [1.6.0] - 2026-02-05

### Added

- **Parallel Builders** - Architect outputs file plans for parallel execution
  - Architect agent now produces structured `filePlan` with sub-phases
  - Files in the same sub-phase execute in parallel via multiple Task tool calls
  - Sub-phases execute sequentially (respects dependencies)
  - Each builder gets narrowed context: only assigned files + available files from earlier phases
  - ~80% token savings per builder through context narrowing
  - New types: `FilePlanGroup`, `BuilderStage`, `ParallelBuilderPlan`

- **Background Orchestration** - Run orchestrations asynchronously
  - `paradigm team orchestrate "task" --background` starts in background
  - Notifications when complete: `--notify bell,desktop,file`
  - New `BackgroundOrchestrator` class manages async orchestrations
  - Status tracking: pending → running → completed/failed → accepted/rejected

- **Orchestration Review Commands** - Review and accept/reject completed work
  - `paradigm team diff <id>` - Show file changes from orchestration
  - `paradigm team accept <id>` - Accept and merge changes
  - `paradigm team reject <id>` - Reject and optionally cleanup created files
  - `paradigm team status --running` - Show active background orchestrations
  - `paradigm team status --id <id>` - Show specific orchestration status

- **File Plan Protocol** - Structured architect output for builders
  ```yaml
  filePlan:
    - group: types
      subPhase: 0
      files:
        - path: src/types/index.ts
          description: "Core interfaces"
    - group: routes
      subPhase: 2
      files:
        - path: src/routes/api.ts
          description: "API endpoints"
  ```

### Changed

- **Orchestrator** - Now detects file plans and spawns parallel builders
  - `runParallelBuilders()` executes builders per sub-phase
  - `parallelBuilderStats` added to `OrchestrationResult`
  - Tracks: usedFilePlan, totalSubPhases, totalParallelBuilders, filesCreated

- **Agent Prompts** - Architect prompt updated with file plan instructions
  - Includes sub-phase ordering guidance (types → models → routes → app)
  - File plan parsing functions: `parseFilePlan()`, `parseRelayWithFilePlan()`

## [1.5.0] - 2026-02-04

### Validated

- **Portal Protocol Self-Test** - Built TaskFlow API to validate Portal Protocol effectiveness
  - Test location: `/tmp/taskflow-paradigm-test/`
  - Results documented in `SELF-TEST-RESULTS.md`
  - **Key finding:** Following Portal Protocol from the start prevented auth bug (Pivot 3) from ever being introduced
  - Called `paradigm_gates_for_route` 10 times during development
  - Created `portal.yaml` with 8 gates and 21 route mappings
  - Executed all 5 pivots from split test specification:
    - Pivot 1: Cross-cutting change (audit logging) ✅
    - Pivot 2: New feature + auth (task templates) ✅
    - Pivot 3: Auth bug fix (comment deletion) ✅ Bug never existed
    - Pivot 4: Multi-feature flow (Slack notifications) ✅
    - Pivot 5: Pattern question (soft vs hard delete) ✅
  - Validates that Portal Protocol guides AI to define gates before writing routes

### Changed

- **README Branding** - Added logo and case study
  - New centered logo (connected nodes representing knowledge graph)
  - Case study section: TaskFlow API comparison (42% faster, 8.5x less context, 88% cheaper)
  - "The Paradox" insight: more files but faster because structured context beats raw context

### Added

- **`paradigm shift` Command** - One command to fully initialize any project
  - Combines: init → scan → sync (all IDEs) → doctor
  - Generates CLAUDE.md, .cursor/rules/, .github/copilot-instructions.md, .windsurfrules
  - Options: `--quick` (skip scan), `--verify` (run health checks), `--ide <name>` (specific IDE)
  - One-liner install: `curl -fsSL https://raw.githubusercontent.com/ascend42/a-paradigm/main/install.sh | bash && paradigm shift`

- **Auto-Documenting Protocol** - AIs now know when to update Paradigm files
  - New "Maintaining Paradigm Files" section in generated CLAUDE.md
  - Decision table: change type → required action
  - Reference to `.paradigm/docs/ai-maintenance-protocol.md`

- **Graceful Degradation for MCP Tools** - Tools work even without full index
  - `paradigm_ripple` falls back to grep when symbol not indexed
  - Returns partial results with suggestion to run `paradigm scan`
  - `paradigm_search` includes fuzzy matching for typos (Levenshtein distance)

- **Session Continuity** - Breadcrumbs for cross-session context
  - Session breadcrumbs persisted to `.paradigm/session-breadcrumbs.json`
  - New `paradigm_session_recover` tool loads previous session context
  - Tracks symbols modified and files explored

- **Enhanced Gate Suggestions** - Learns from existing patterns
  - `paradigm_gates_for_route` now reads portal.yaml for similar routes
  - Route similarity scoring (exact, param, partial matches)
  - Infers ownership gates from `/api/{resource}/:id` patterns

- **Input Validation** - Zod schemas for all MCP tool inputs
  - New `validation.ts` with schemas for all tools
  - Better error messages for invalid inputs
  - Symbol format validation (must start with @#$%^!?~&)

- **Sentinel Auto-Initialization** - Zero-config incident tracking
  - Loads seed patterns on first use
  - Helpful empty state with recording instructions

- **New Documentation**
  - `.paradigm/docs/ai-maintenance-protocol.md` - When/how to update Paradigm files
  - `.paradigm/docs/agentic-efficiency-study.md` - Split test results (8.5x context reduction)
  - `.paradigm/docs/migration-prompt.md` - Guide for migrating existing codebases

### Changed

- **Auto-index on init** - `paradigm init` now runs scan automatically
  - Creates index for MCP tools to work immediately
  - Skipped with `--quick` flag for faster init
  - Graceful failure: warns but doesn't block init

- **Configurable ripple depth** - `paradigm_ripple` depth parameter
  - Default depth: 2, max: 5
  - Recursive analysis with cycle detection

- **Wisdom cache invalidation** - Fresh data after recording
  - Cache invalidated after `paradigm_wisdom_record`
  - 30-second TTL for automatic refresh

- **Lazy indexing in MCP** - Re-aggregates when index empty
  - 30-second cache TTL
  - Automatic refresh on stale data

- **Doctor command** - Now returns boolean and supports quiet mode
  - `doctorCommand({ quiet: true })` for programmatic use
  - Returns `true` if all checks pass

- **Sync command** - Supports quiet mode and target parameter
  - `syncCommand(ide, { quiet: true })` for programmatic use
  - Throws instead of process.exit in quiet mode

- **install.sh** - Updated to recommend `paradigm shift`
  - Simplified next steps
  - Shows all options for shift command

### Performance

- **8.5x average context reduction** vs traditional documentation
  - Cross-cutting changes: 12x less context needed
  - Flow understanding: 11x less context needed
  - Authorization features: 5.1x less context needed
  - See `.paradigm/docs/agentic-efficiency-study.md` for full results

---

## [1.4.0] - 2026-02-04

### Added

- **MCP-First Architecture** - Reference content served via MCP instead of copied to projects
  - New MCP resources: `paradigm://prompts`, `paradigm://prompts/{name}`, `paradigm://docs/{name}`, `paradigm://specs/{name}`
  - Prompts: 10 task templates (add-feature, refactor, debug-auth, etc.) available on-demand
  - Reference docs: commands.md, queries.md served via MCP
  - Reference specs: disciplines.md, scan.md, context-tracking.md served via MCP
  - Template size reduced from 260KB to ~60KB (76% reduction)
  - Token savings: ~37K tokens per project (~$0.11 per full read at Sonnet pricing)

- **Enhanced Session Cost Tracking** - Real-time token and cost monitoring
  - New utility: `session-tracker.ts` with detailed tracking
  - Multi-model pricing support: Claude Opus 4 ($15/M), Sonnet 4 ($3/M), Haiku 3.5 ($0.80/M)
  - Resource reads tracked by URI and type
  - Tool calls tracked by name with response size
  - Cost breakdown by category (resources vs tools)
  - `paradigm_session_stats` now returns detailed cost breakdown

- **MCP Resources Documentation** - CLAUDE.md now documents MCP resources
  - New section explaining on-demand content via MCP
  - Table of available resources and URIs
  - Usage instructions for reading prompts

### Changed

- **Template Copying** - `paradigm init` now skips MCP-served content
  - `prompts/` directory no longer copied to projects
  - `docs/commands.md`, `docs/queries.md` not copied
  - `specs/disciplines.md`, `specs/scan.md`, `specs/context-tracking.md` not copied
  - `echoes.yaml` not copied (redundant)
  - Projects still get: config.yaml, specs/ (logger, symbols, context, etc.), docs/ (patterns, troubleshooting)

- **Session Tracker Refactored** - Moved to dedicated utility module
  - `trackToolCall(size, name)` now accepts tool name for detailed tracking
  - `trackResourceRead(size, uri)` now accepts URI for categorization
  - All MCP handlers updated to pass tracking context

- **Display Updates** - Init command updated for MCP-first
  - Summary no longer mentions prompts/ directory
  - Notes that reference content is available via MCP
  - Dry-run mode reflects lean template structure

### Migration Guide

**For existing projects:**
```bash
# Optional cleanup (saves disk space)
rm -rf .paradigm/prompts
rm .paradigm/docs/commands.md .paradigm/docs/queries.md
rm .paradigm/specs/disciplines.md .paradigm/specs/scan.md .paradigm/specs/context-tracking.md
rm .paradigm/echoes.yaml

# Required for updated agent instructions
paradigm sync
```

**MCP resources work regardless of local files** - old projects continue to work, but won't benefit from lean templates until cleanup.

---

## [1.3.0] - 2026-02-04

### Added

- **MCP Agent Protocol Resource** - New `paradigm://context/agent-protocol` resource
  - Returns workflow instructions for agents in any MCP-compatible client
  - Enables Claude Desktop to receive the "query before modify" protocol
  - Listed first in resources to encourage discovery at session start

- **Enhanced CLAUDE.md Generation** - `paradigm sync claude` now includes MCP Workflow Protocol
  - Adds "query before modify" table with tool recommendations
  - Explains token efficiency benefits (~100 tokens vs ~2000)
  - Bridges instruction gap for Claude Code users

- **Claude Code Permissions** - `paradigm sync claude` now adds permissions to `.claude/settings.json`
  - Automatically adds `Bash(paradigm *)` permission
  - Allows Claude Code to run all paradigm commands without prompting

- **Quick Start Guide** - New comprehensive setup documentation
  - Added `docs/guides/quick-start.md` with complete setup instructions
  - Includes super command for one-line project setup
  - Key commands reference table

- **Installation Script** - Added `install.sh` for automated CLI installation
  - One-command installation: `curl -fsSL https://...raw.../install.sh | bash`
  - Downloads, builds, and installs Paradigm CLI globally
  - Includes verification and helpful next steps

- **MCP Troubleshooting Guide** - Comprehensive section for diagnosing MCP server connection issues
  - Symptoms: "DeleteClient action", command not found, immediate disconnect
  - Solutions: Broken npm link diagnosis, direct path workaround, shebang issues
  - Common causes table for quick reference
  - **nvm/PATH section**: Cursor doesn't inherit shell PATH, need absolute paths in mcp.json

- **Internal CLI Logger** - Paradigm CLI now uses its own logger specification
  - All commands use structured logging with `log.command()`, `log.operation()`, `log.component()`
  - Duration tracking for operations via `.start()` → `.success()`/`.error()`
  - Debug logs visible with `DEBUG=1` environment variable
  - Maintains visual polish with chalk while adding structure for debugging
  - "Eating our own dog food" - CLI follows Paradigm logger patterns

- **Comprehensive Command Documentation** - Detailed guides for all core commands
  - Created `.paradigm/docs/commands/` directory with 8 detailed command guides (internal framework)
  - Each guide includes: Overview, Usage, Integration, Workflows, Tips, Examples, Troubleshooting
  - Commands documented: `init`, `sync`, `index`, `beacon`, `constellation`, `mcp-setup`, `ripple`, `doctor`
  - Added navigation index (`.paradigm/docs/commands/.index.yaml`)
  - Updated main `commands.md` to link to detailed guides
  - Improved onboarding and reduces "what does this do?" confusion

- **GitHub Documentation Hub** - Public-facing documentation structure
  - Created `docs/README.md` as central documentation hub
  - Copied command guides to `docs/commands/` for GitHub visibility
  - Updated main `README.md` with prominent documentation links
  - Documentation section with quick access to most important guides
  - Professional documentation structure for better discoverability

- **Template Optimization** - Reduced `.paradigm/` token cost by 42%
  - Removed CLI command docs from templates (reference GitHub instead)
  - Moved optional patterns to `examples/patterns/` (not in every project)
  - Template size: 452KB → 260KB (~39,600 tokens saved per project)
  - Cost savings: $0.30 per AI session, $29.70 per 100 projects
  - What stays: Core specs, docs patterns, task prompts, config
  - What's optional: FTUX, sandbox mode, portal testing patterns

### Changed

- **MCP Tool Descriptions** - More prescriptive descriptions for key tools
  - `paradigm_ripple` now emphasizes "call BEFORE modifying"
  - `paradigm_status` recommends calling at session start for orientation
  - `paradigm_related` suggests calling before modifications to understand connections

- **Logger Method Consistency** - Fixed remaining `log.portal()` → `log.gate()` references
  - Updated `.paradigm/docs/patterns.md`, `.paradigm/docs/error-patterns.md`
  - Updated `.paradigm/prompts/add-gate.md`, `.paradigm/specs/portal-validation.md`

- **Package READMEs** - Updated all package READMEs to use `@a-company/*` package names
  - Updated 7 package READMEs (purpose-core, probe-core, prism, premise-core, portal-sdk, portal-manager, portal-core)
  - Fixed CLI command references from `horizon` to `paradigm`
  - Fixed config file references from `gate.yaml` to `portal.yaml`

- **Spec Naming** - Renamed `.paradigm/specs/scan.md` → `.paradigm/specs/probe.md` to match content

- **Documentation** - Added `.paradigm/docs/.index.yaml` for AI agent navigation

### Removed

- **Session Report** - Removed temporary `docs/session-report-2026-01-27.md`

### Fixed

- **Sync --all MCP Generation** - Fixed `paradigm sync --all` not generating MCP configs
  - Now properly creates `.claude/settings.json` when syncing all IDEs
  - MCP configs are generated for all supporting IDEs (Cursor, Claude)

- **Init Command** - Fixed misleading message suggesting non-existent `paradigm portal init` command
  - Now correctly advises to create portal.yaml manually if needed
  - Added link to portals documentation

### Changed

- **Documentation** - Renamed `docs/website-outline.md` → `docs/paradigm-website-outline.md`

---

## [1.2.1] - 2026-02-02

### Added

- **Context Tracking (MCP)** - Session-aware context monitoring for handoff recommendations
  - `paradigm_context_check` tool - Check if context handoff is recommended
  - `paradigm_handoff_prepare` tool - Prepare handoff summary with next steps
  - `paradigm_session_stats` tool - Get current session statistics
  - `paradigm://context/session` resource - Passive session monitoring
  - `paradigm://context/handoff-guide` resource - When/how to handoff guide
  - New spec: `.paradigm/specs/context-tracking.md`
  - Thresholds: <50% continue, 50-70% consider, 70-85% recommended, >85% urgent
  - Context Monitoring Protocol added to CLAUDE.md and Cursor rules

### Fixed

- **ASCII Art Banner** - Fixed 'GM' portion alignment in CLI banner
- **Legacy "Horizon" References** - Updated remaining references in scan/index.ts, legacy-config.ts, ide-adapters
- **Help Text** - Updated `paradigm portal test` help to use correct command names

- **Symbol `~` Definition** - Standardized on "Deprecated" (was inconsistently "Aspects" in some files)
  - Updated symbols.md, beacon.ts, constellation.ts, tutorial, and all templates
  - Symbol now consistently means "marked for removal" across all documentation

- **Logger Method Naming** - Standardized on `log.gate()` for portal/gate logging
  - Changed from `log.portal()` to `log.gate()` to match `^` gate symbol
  - Updated logger.md, symbols.md, patterns.md, and all template files

- **Broken Reference** - Removed reference to non-existent `specs/ftux-component-system.md`

### Changed

- **CLAUDE.md Optimization** - Reduced from 135 to 81 lines
  - Removed duplicated logger spec (now references spec file)
  - Added AI Agent Systems table (Navigator, Wisdom, History)
  - Streamlined symbol table and conventions

- **File Organization** - Cleaned up root directory
  - Moved 9 `paradigm-*.md` prompt files to `.plans/` (gitignored)
  - Deleted empty `paradigm-wisdom-history.md`
  - Deleted internal `A-COMPANY-WEBSITE-VISION.md`
  - Renamed `horizon-config.ts` → `legacy-config.ts`

- **Templates Updated** - `paradigm init` now generates correct files
  - Added navigator.md, wisdom.md, history.md to template specs
  - All templates use `log.gate()` consistently
  - All templates define `~` as "Deprecated"

- **Example Cleanup** - Migrated `examples/shopflow/.horizon/` → `.paradigm/`
  - Updated all internal references from .horizon to .paradigm

### Added

- **Minimal Setup Guide** - Added "Getting Started with Minimal Paradigm" section to README
- **.gitignore Entries** - Added `.plans/`, `.claude/settings.local.json`, `.cursor/plans/`, `*.prompt.md`, `.mcp.json`

### Removed

- **Legacy gate/ Commands** - Removed orphaned `commands/gate/` directory (use `commands/portal/` instead)

- **Phoenix Protocol** - Removed in favor of `paradigm team handoff`
  - Deleted `.paradigm/specs/phoenix.md` and template
  - Deleted `.paradigm/prompts/phoenix-handoff.md` and template
  - Removed `phoenix-threshold` and `phoenix-path` from config.yaml
  - Updated docs to reference `paradigm team handoff` for context continuity
  - The Team system's handoff command provides the same functionality with better structure

---

## [1.2.0] - 2026-02-02

### Added

- **Navigator System** - AI exploration optimization via pre-indexed project structure
  - Auto-generates `.paradigm/navigator.yaml` during `paradigm scan`
  - Structure mapping: code categories to directory locations
  - Key files index: config, entry points, type definitions
  - Skip patterns: inherits from .gitignore plus defaults
  - Symbol-to-path mapping for direct lookup
  - New MCP tool: `paradigm_navigate` with find/explore/context intents
  - New specification: `.paradigm/specs/navigator.md`

- **Navigation Sections in IDE Files**
  - CLAUDE.md includes "Paradigm Navigation" exploration protocol
  - Cursor rules include `paradigm-navigator.mdc` with navigation guidance
  - Task recipes for common operations (adding features, modifying components)

- **MCP Navigate Tool**
  - `paradigm_navigate({ intent: "find", target: "@checkout" })` - locate symbols
  - `paradigm_navigate({ intent: "explore", target: "authentication" })` - browse areas
  - `paradigm_navigate({ intent: "context", task: "add Apple Pay" })` - task context
  - Returns: paths, symbols, skip patterns, suggested reading order

### Changed

- `paradigm scan` now generates both scan-index.json and navigator.yaml
- MCP server version bumped to 1.2.0
- CLI version bumped to 1.2.0

---

## [1.1.0] - 2026-02-02

### Added

- **Wisdom System** - Team context MCP for preferences, antipatterns, decisions, expertise
  - New directory: `.paradigm/wisdom/` with preferences.yaml, antipatterns.yaml, expertise.yaml
  - Decision records in `.paradigm/wisdom/decisions/*.yaml` (ADR format)
  - MCP resources: `paradigm://wisdom/preferences`, `paradigm://wisdom/antipatterns`, `paradigm://wisdom/decisions`
  - MCP tools: `paradigm_wisdom_context`, `paradigm_wisdom_record`, `paradigm_wisdom_expert`
  - CLI commands: `paradigm wisdom show|init|add-antipattern|decide|expert`
  - Symbol-indexed for targeted, low-token queries

- **History System** - Implementation history MCP for tracking what worked/failed
  - New directory: `.paradigm/history/` with log.jsonl (append-only), index.yaml, validation.yaml
  - Tracks implementations, validations, rollbacks with fragility scoring
  - Co-change pattern detection (symbols that tend to change together)
  - MCP resources: `paradigm://history/symbol/{symbol}`, `paradigm://history/fragile`, `paradigm://history/cochanges`
  - MCP tools: `paradigm_history_context`, `paradigm_history_record`, `paradigm_history_validate`, `paradigm_history_fragility`
  - CLI commands: `paradigm history show|init|fragile|reindex|record|validate`

- **Git Hooks for History Capture** - Automatic history recording from commits
  - Post-commit hook extracts symbols from .purpose files in changed directories
  - Pre-push hook reindexes history
  - New CLI commands: `paradigm hooks install|uninstall|status`

- **Enhanced Sync** - Multi-platform improvements
  - MCP config generation for Claude (`.claude/settings.json`) and Cursor (`.cursor/mcp.json`)
  - Nested CLAUDE.md generation for directories with .purpose files (`--nested` flag)
  - New sync options: `--mcp`, `--no-mcp`, `--nested`

- **New Specifications**
  - `.paradigm/specs/wisdom.md` - Full wisdom system specification
  - `.paradigm/specs/history.md` - Full history system specification

### Changed

- Extended `ProjectContext` type with wisdom and history data
- MCP server version bumped to 1.1.0
- CLI version bumped to 1.1.0

### Deprecated
- **`paradigm visualize` command** - Removed in favor of AI-first workflows
  - The Prism visualizer is no longer bundled with the CLI
  - Use `paradigm constellation --format json` for graph data export
  - Use `paradigm beacon` for AI-readable project orientation
  - The `packages/prism/` source remains in the repo for potential future use

### Fixed
- Schema now accepts string format for relationships (e.g., `"@feature USES #component"`)
- Schema now accepts string format for flow steps (simple descriptions)
- Validator handles both string and object formats gracefully

---

## [0.7.0] - 2026-02-01

### Added
- **Multi-Agent Orchestration** (`paradigm team`) - Coordinate AI agents as a dev team
  - `paradigm team init` - Initialize with 5 default agent roles (architect, builder, reviewer, tester, security)
  - `paradigm team status` - Show current agent, pending handoffs, activity log
  - `paradigm team handoff --to <agent>` - Hand off task with context to another agent
  - `paradigm team accept [id]` - Accept a pending handoff and become active agent
  - `paradigm team check` - Health check for conflicts, stale handoffs, blocked agents
  - `paradigm team history` - Full activity timeline with handoffs
  - `paradigm team reset` - Clear state for fresh start (with `--force` for pending work)
  - Agent manifest: `.paradigm/agents.yaml` with roles, focus areas, permissions
  - Team state: `.paradigm/team-state.yaml` tracks current agent and activity
  - Handoff protocol: `.paradigm/handoffs/*.yaml` preserves context between agents
  - Each agent has defined read/write permissions and handoff targets

- **Lint Command** (`paradigm lint`) - Validate .purpose files for schema errors
  - Reports YAML syntax errors with line numbers
  - Validates against .purpose schema
  - Provides fix suggestions for common issues
  - `--fix` flag for auto-fixing:
    - Auto-converts markdown .purpose files to YAML template
    - Auto-quotes special YAML characters in arrays (#, @, $, ^, !, %)
    - Cleans formatting via re-serialization
  - `--strict` flag to fail on warnings
  - `--json` for CI integration
  - Exit code 1 on errors for pipelines

- **Cost Analysis** (`paradigm cost`) - Token cost analysis for AI context
  - Estimates token counts for all context files
  - Compares static vs dynamic (MCP) context loading
  - Shows potential savings percentage and cost estimate
  - `--detailed` flag for file-by-file breakdown
  - `--json` for programmatic access
  - Provides optimization recommendations

- **Auto-Scan** (`paradigm scan auto`) - Zero-config .purpose generation from code
  - Detects React/Vue/Angular components → #components
  - Detects route definitions (Express, Next.js, React Router) → $flows
  - Detects auth middleware patterns → ^gates (including RLS, ProtectedRoute)
  - Detects error/event patterns → !signals (toast, dispatch, analytics, emit)
  - Honors JSDoc @feature/@component tags for high confidence
  - `--dry-run` to preview without writing
  - `--force` to overwrite existing files
  - Groups symbols by directory for organized .purpose files

- **MCP Server** (`@a-company/paradigm-mcp`) - Model Context Protocol server for AI assistants
  - Exposes Paradigm symbols, gates, flows to Claude and other MCP-compatible AI
  - **Resources**: `paradigm://symbols`, `paradigm://symbol/{symbol}`, `paradigm://gates`, `paradigm://flows`
  - **Tools**: `paradigm_search`, `paradigm_ripple`, `paradigm_related`, `paradigm_status`, `paradigm_gates_for_route`
  - Technology agnostic: Works with any language/framework
  - Enables dynamic mid-conversation context fetching
  - Usage: `npx @a-company/paradigm-mcp` or add to Claude Desktop config

- **MCP Setup Command** (`paradigm mcp setup`) - Auto-configure MCP for AI clients
  - Detects installed clients: Cursor, Claude Desktop, Continue, Cline
  - Generates appropriate config files for each client
  - `paradigm mcp setup --client cursor` for specific client
  - `paradigm mcp setup --client all` for all detected clients
  - `paradigm mcp status` to check configuration
  - Auto-adds project-level configs to `.gitignore`

- **MCP List Command** (`paradigm mcp list`) - View all configured servers
  - Shows servers across all AI clients (not just current project)
  - Highlights current project in the output
  - Useful for managing multi-project Claude Desktop setups

- **MCP Remove Command** (`paradigm mcp remove`) - Clean up server configs
  - Remove by server name: `paradigm mcp remove project-name`
  - Remove current project: `paradigm mcp remove`
  - Target specific client: `--client claude-desktop`
  - Also matches by project path for Continue's unnamed servers

- **Enhanced Signals Schema** - Extended `SignalDefinition` for richer metadata
  - Added `severity` field: `'info' | 'warn' | 'error'`
  - Added `emitters` field: Array of files that emit this signal
  - Added `related` field: Array of related symbols (@, ^, $, etc.)
  - Enables categorized signal tracking and documentation

- **Symbol Indexer Improvements** - Comprehensive symbol extraction from `.purpose` files
  - Parse `flows:`, `gates:`, `states:`, `signals:` from feature/component definitions
  - Support both array format `[{id, description}]` and record format `{id: {description}}`
  - Extract symbol references from descriptions via regex (`$flow`, `^gate`, etc.)
  - Parse `portals:` key in `portal.yaml` as alias for `gates:`

- **Smart Init** - Enhanced `paradigm init` with intelligent onboarding
  - Auto-detects existing IDE instruction files (.cursorrules, copilot-instructions.md, etc.)
  - Detects project type (Next.js, Express, Python, etc.)
  - Shows detection results with line counts
  - New `--migrate` flag outputs AI-ready migration prompt
  - New `--quick` flag for non-interactive setup
  - New `--dry-run` flag to preview what would be created
  - Improved post-init summary with clear next steps

- **Migration Prompts** - AI-assisted migration from existing IDE files
  - Generates detailed prompts for converting to modern scoped format
  - Covers Cursor (.mdc) and Copilot (.instructions.md) formats
  - Includes file structure examples and frontmatter syntax

- **MCP Setup Guide** (`docs/guides/mcp-setup.md`) - Comprehensive guide for Claude Desktop integration
  - Step-by-step installation and configuration
  - Available resources and tools reference
  - Example conversations showing MCP in action
  - Troubleshooting section

- **Content Guide** (`docs/content-guide.md`) - Structure for YouTube and blog content
  - 7-video YouTube series with detailed scripts
  - 5-part blog post series outlines
  - Production notes and visual guidelines
  - Call-to-action templates

- **TaskFlow Tutorial** (`docs/tutorial-project.md`) - Build-along tutorial project
  - 6-episode guide building a task management app
  - Demonstrates all Paradigm features
  - AI interaction scripts for each episode
  - Starter repository structure
  - Teaching moments with intentional mistakes

- **Project `.purpose` Files** - Paradigm now documents itself
  - Root `.purpose` with 8 features, 20+ components
  - Package-level `.purpose` files for CLI, MCP, Portal, Prism, etc.
  - Full symbol coverage of the framework

### Changed
- **README.md** - Complete rewrite reflecting evolved project
  - Better value proposition and problem statement
  - Comprehensive command reference organized by category
  - Agent efficiency features prominently featured
  - IDE support and migration documentation
  - Cleaner structure with practical examples
  - Added MCP Server section with Claude Desktop config example

- **Website Outline** (`docs/website-outline.md`) - Updated with MCP documentation
  - Added MCP Server product page (Section 4.5)
  - Added Claude Desktop to IDE integration
  - Added MCP-specific use case
  - Updated navigation and SEO keywords
  - Added TaskFlow tutorial reference

### Fixed
- **Symbol Indexer** - Fixed parsing of flows, gates, states from `.purpose` files
- **Portal Parser** - Now accepts both `gates:` and `portals:` keys in `portal.yaml`

---

## [0.6.0] - 2026-01-27

### Added
- **Agent Efficiency Suite** - Tools to make AI agents faster and more context-aware

- **Beacon** (`.paradigm/beacon.md`) - Quick-start orientation for AI agents
  - Compact symbol map showing features, portals, and relationships
  - Key file landmarks for fast navigation
  - Links to available pathways (prompts)
  - New command: `paradigm beacon [--refresh] [--json]`

- **Constellation** (`.paradigm/constellation.json`) - Machine-readable symbol graph
  - Complete symbol relationship data in JSON/YAML format
  - Stars (symbols) with categorized references: portals, signals, components, etc.
  - Orbits (flows) with step sequences
  - Queryable by AI agents for impact analysis
  - New command: `paradigm constellation [--format json|yaml]`

- **Ripple** - Change impact analysis
  - Shows upstream dependencies (what a symbol requires)
  - Shows downstream effects (what would be affected by changes)
  - Flow membership tracking (which flows include this symbol)
  - Test command suggestions
  - New command: `paradigm ripple <symbol> [--json]`

- **Thread** (`.paradigm/thread.md`) - Session continuity between AI agents
  - Trail: Record what was done in a session
  - Loose ends: Track unfinished tasks
  - Breadcrumbs: Notes for the next agent
  - New commands: `paradigm thread [show|save|todo|note|clear] [--json]`

- **Echo** (`.paradigm/echoes.yaml`) - Error-to-symbol mapping
  - Map error codes to their source symbols
  - Include resolution hints and ripple effects
  - Template included in `paradigm init`
  - New commands: `paradigm echo [lookup|init|list] [--json]`

- **Enhanced Pathways** - Improved prompt templates
  - Added prerequisites section with file references
  - Added implementation steps with CLI commands
  - Added "After" sections for follow-up actions
  - Templates now reference beacon, constellation, thread, and echo

- **Agent CLI Integration** - Token-efficient querying for AI agents
  - Added `--json` flag to `beacon`, `thread`, and `echo` commands
  - All agent-facing commands now support machine-readable output
  - New `paradigm-agent-hints.mdc` generated for Cursor with query patterns
  - New `paradigm-agent-hints.instructions.md` for Copilot
  - New `queries.md` documentation with jq recipes for constellation queries
  - Portal Viewer: New Command Palette UI for copying CLI commands
  - AI agents can now query on-demand (~100 tokens) vs reading files (~2000 tokens)

- **Website Outline** - Comprehensive website design document
  - Brand positioning and taglines
  - Site architecture and navigation
  - Homepage sections and content
  - Product pages for Purpose, Portal, Premise, Prism
  - Documentation structure
  - Visual design notes

---

## [0.5.0] - 2026-01-27

### Added
- **Portal Viewer** - Real-time visualization dashboard for portal activations
  - New package: `@a-company/portal-viewer`
  - Constellation view: Interactive star map where portals "light up" on activation
  - Testing checklist: Auto-ticking gates for QA verification
  - Event timeline: Scrolling log with entity filtering
  - Session recording: Capture test runs for reporting
  - Flow visualization: Track progress through multi-gate flows
  - New CLI commands: `paradigm portal watch`, `paradigm portal report`

- **Webhook Integration** - Push session reports to external services
  - Slack Block Kit formatted messages
  - Discord embed formatted messages
  - Email HTML reports
  - Generic HTTP POST for custom endpoints
  - Configuration via `.paradigm/portal-webhooks.yaml`
  - Environment variable expansion for secrets

- **Session Reporting** - Structured test session exports
  - JSON export with full event details
  - Markdown reports for documentation
  - Pass/fail statistics and flow completion tracking
  - Entity journey tracking

- **Modern Cursor Rules Format** - `.cursor/rules/*.mdc` support
  - `paradigm sync cursor` now generates multiple focused `.mdc` files
  - YAML frontmatter with `globs` and `alwaysApply` for scoped rules
  - Rules only load when relevant files are open (better token efficiency)
  - Generated files: `paradigm-core.mdc`, `paradigm-symbols.mdc`, `paradigm-logging.mdc`, etc.
  - Automatic backup of legacy `.cursorrules` to `.cursorrules.bak`

- **Modern Copilot Instructions Format** - `.github/instructions/*.instructions.md` support
  - `paradigm sync copilot` now generates multiple focused `.instructions.md` files
  - YAML frontmatter with `applyTo` for glob-based scoping
  - Core instructions remain in `.github/copilot-instructions.md` (always applies)
  - Path-specific instructions in `.github/instructions/` directory
  - Generated files: `paradigm-symbols.instructions.md`, `paradigm-logging.instructions.md`, etc.

- **CLI Improvements**
  - Added `claude` as a valid IDE option for `paradigm init --ide claude`
  - Enhanced `--ide` option descriptions in help text to show output file paths
  - Improved error messages for invalid IDE options with full list of available options

### Fixed
- **Build System**
  - Fixed TypeScript module resolution for workspace dependencies during DTS generation
  - Added `tsup.config.ts` for `@a-company/portal-sdk` to properly handle workspace dependencies
  - Resolved build failures caused by missing workspace symlinks (requires `npm install`)

### Changed
- **Marathon Ports** - All Paradigm tools now use memorable port numbers
  - Portal Viewer UI: 42195 (marathon distance: 42.195km)
  - Portal Viewer WebSocket: 42196
  - Prism Visualizer: 42197
- **Build System**
  - Updated `portal-sdk` build script to use `tsup.config.ts` instead of CLI flags
  - Improved build reliability by ensuring workspace packages are properly linked
- **CLI**
  - Enhanced `paradigm init` command to better explain IDE option variables and their output files
  - Improved user experience when selecting IDE target with clearer descriptions

---

## [0.4.0] - 2026-01-24

### Added
- **Claude IDE Adapter** - Generate `CLAUDE.md` for Claude-native contexts
  - Claude Code, Claude API, and Claude Desktop support
  - Optimized format for Claude's context preferences
  - New command: `paradigm sync claude`

- **New Symbols for v1.0**
  - `~` (Deprecated) - Mark features/components for removal
  - `&` (Integration) - External services and third-party connections
  - Logger method: `log.integration('&stripe')`

- **Discipline Mappings** - Universal framework support
  - New spec: `specs/disciplines.md`
  - Symbol interpretations for: Web, Backend, ML, Mobile, Game, Embedded, DevOps
  - Custom discipline support in `config.yaml`
  - Generic directory patterns that work across project types

- **Error Patterns Template** - Standardized error handling
  - `docs/error-patterns.md` template (language-agnostic pseudocode)
  - API error response format
  - Error flow diagram

- **ADR Templates** - Architecture Decision Records
  - `docs/decisions/` directory structure
  - `000-template.md` for new ADRs
  - README with ADR index

- **Custom Symbol Support**
  - Projects can define additional symbols in `config.yaml`
  - Example: `§` for domain-specific concepts

### Changed
- Version bump to 0.4.0
- All code examples converted to language-agnostic pseudocode
- Directory patterns expanded to support all disciplines (ML, embedded, etc.)
- Symbol mappings now include `integrations/**`, `pipelines/**`, `drivers/**`
- README updated with new features and discipline support

---

## [0.3.2] - 2026-01-24

### Added
- **Context Cost Optimization** - Guidance for keeping `.cursorrules` slim
  - New troubleshooting section: "Context Bloat / Token Costs"
  - Updated `specs/context.md` with "Keeping .cursorrules Slim" section
  - Target: <100 lines, <1,000 tokens for `.cursorrules`
  - Slim template included in troubleshooting docs

- **Phoenix Protocol** - AI context continuity system
  - New spec: `.paradigm/specs/phoenix.md`
  - Enables AI agents to preserve work state when approaching context limits
  - Writes `.context/phoenix.yaml` with progress, memories, and next steps
  - New session reads ashes and continues seamlessly
  - Configurable threshold and model settings in `config.yaml`

- **Context & Documentation Index System** - Hierarchical doc navigation
  - New spec: `.paradigm/specs/context.md`
  - `.index.yaml` files for directory-level indexing
  - Document frontmatter schema with metadata
  - Section-level line ranges for targeted reading
  - Dependency tracking between documentation and code
  - Canonical markers to establish source of truth

- **AI Agent Configuration** in `config.yaml`
  - `ai-agent.model` - Current AI model identifier
  - `ai-agent.context-window` - Token limit
  - `ai-agent.phoenix-threshold` - When to trigger phoenix (default 80%)
  - `ai-agent.phoenix-path` - Where phoenix files are written

- **Context Settings** in `config.yaml`
  - `context.enabled` - Enable documentation indexing
  - `context.index-file` - Index file name (default `.index.yaml`)
  - `context.docs-path` - Root documentation directory

### Changed
- Updated `agent-guidelines.how-to-use` with documentation index and phoenix protocol tips

## [0.3.1] - 2026-01-20

### Added
- `--ide <ide>` flag for `paradigm init` to explicitly choose target IDE (cursor, copilot, windsurf)

### Fixed
- `paradigm init` now always generates `.cursorrules` by default when no IDE is detected
- Previously skipped IDE instruction file generation if no `.cursor`, `.vscode`, or `.windsurf` directory existed

## [0.3.0] - 2026-01-20

### Added
- **Framework Rebrand: Horizon → Paradigm**
  - New naming scheme reflecting AI-agent mindset philosophy
  - Modules renamed: Dream → Premise, Gate → Portal, Scan → Probe, Visualizer → Prism
  - All packages now under `@a-company` npm scope

- **Migration Tool**
  - `paradigm upgrade --from-horizon` to migrate existing Horizon projects
  - Automatically renames `.horizon/` to `.paradigm/`
  - Converts `gate.yaml` files to `portal.yaml`
  - Updates `.dream` files to `.premise`
  - Updates content references throughout project files

- **Prism Visual Identity** (formerly Dreamscape)
  - New triangular prism logo with spectral light rays
  - New spectral color themes: Spectrum 🌈, Focus 🔍, Deep 💎
  - Updated UI branding throughout visualizer

- **New Package Names**
  - `@a-company/paradigm` - Main CLI (was `@horizon/cli`)
  - `@a-company/premise-core` - Aggregation (was `@horizon/dream-core`)
  - `@a-company/portal-core` - Authorization (was `@horizon/gate-core`)
  - `@a-company/portal-sdk` - Runtime SDK (was `@horizon/gate-sdk`)
  - `@a-company/portal-manager` - Testing (was `@horizon/gate-manager`)
  - `@a-company/probe-core` - Visual discovery (was `@horizon/scan-core`)
  - `@a-company/prism` - Visualizer UI (was `@horizon/visualizer`)
  - `@a-company/purpose-core` - Context (was `@horizon/purpose-core`)

### Changed
- CLI command renamed from `horizon` to `paradigm`
- Subcommands renamed: `gate` → `portal`, `dream` → `premise`, `scan` → `probe`
- Config directory: `.horizon/` → `.paradigm/`
- Authorization files: `gate.yaml` → `portal.yaml`
- Idea files: `.dream` → `.premise`
- Index files: `scan-index.json` → `probe-index.json`
- Symbol `^` now called "Portal" (was "Gate")
- Logger method `log.gate()` renamed to `log.portal()`
- Environment variable `HORIZON_SYMBOLS` → `PARADIGM_SYMBOLS`
- All templates updated with new naming conventions
- Documentation fully updated (README, CONTRIBUTING, all specs and docs)

## [0.2.1] - 2026-01-19

### Added
- Comprehensive `.cursorrules` file with Horizon framework documentation
- Changelog and version management instructions in `.cursorrules`
- Semantic versioning workflow for automated changelog updates

### Changed
- Updated `.gitignore` with comprehensive Node.js, TypeScript, and monorepo patterns
- Improved gitignore coverage for build artifacts, cache directories, and IDE files

## [0.2.0] - 2026-01-14

### Added
- **IDE-Agnostic Architecture** - `.horizon/` directory as source of truth
  - `config.yaml` - Main configuration with symbol system and logging settings
  - `specs/` - Philosophy and specifications (logger, scan, symbols)
  - `docs/` - Reference documentation (commands, patterns, troubleshooting)
  - `prompts/` - Pre-written task prompts for common operations
  - `project.md` - Auto-generated project summary

- **Multi-IDE Support** - Generate instruction files for different IDEs
  - Cursor (`.cursorrules`)
  - GitHub Copilot (`.github/copilot-instructions.md`)
  - Windsurf (`.windsurfrules`)

- **Horizon Logger Specification** - Structured logging with symbol types
  - Symbol-typed methods: `log.feature()`, `log.component()`, `log.gate()`, etc.
  - Duration tracking with `.start()` / `.success()` / `.error()`
  - Directory-to-symbol mapping in config
  - Log level and symbol filtering

- **New CLI Commands**
  - `horizon sync [ide]` - Generate IDE instruction files (auto-detects IDE)
  - `horizon sync --all` - Sync all supported IDEs at once
  - `horizon doctor` - Health check and setup validation
  - `horizon watch` - Auto-sync on `.horizon/` file changes
  - `horizon summary` - Generate `.horizon/project.md` with project stats

- **Template System** - Templates for new project initialization
  - Full `.horizon/` directory structure
  - Pre-configured specs and docs
  - Ready-to-use prompts

### Changed
- `horizon init` now creates `.horizon/` directory structure (not a single file)
- `horizon upgrade` supports migration from legacy `.horizon` file to directory format
- `horizon upgrade` now supports `--features logger` and `--features migrate`

### Deprecated
- `horizon cursorrules` command - Use `horizon sync cursor` instead (alias kept with warning)

## [0.1.0] - 2026-01-11

### Added
- Project inception
- Architecture planning document
- Monorepo scaffolding
