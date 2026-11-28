# Symbol hygiene audit of this repo

Rune and Cid, 2026-11-24, filed by the orchestrator. Read-only; raw outputs were in the session scratchpad and are not kept.

Read-only audit of /Users/ascend/Documents/GitHub/a-paradigm. Nothing was written to the project.

- **Run state:** installed CLI 8.1.3 (global build of Nov 13, not the working tree), scan-index generated 2026-11-24T09:12Z, branch feat/gnomon-dims-s1.1. The builder committed a294d6ef mid-audit.
- **Commands run:** `paradigm status`, `doctor`, `doctor --explain`, `lint --json`, `integrity --json`. Git state was checked after each; none of them wrote.
- **Evidence labels:** "Verified" means I ran the command or read the file:line. "Inferred" is marked.
- **Raw outputs:** /private/tmp/claude-501/-Users-ascend-Documents-GitHub-a-paradigm/ed732f72-9885-4480-96cc-ff45d7d4e7ca/scratchpad/audit-rc/ holds doctor.txt, status.txt, integrity.json, lint.json, cov.txt (all 101 uncovered directories) and iso-rows2.json (all 591 isolated symbols, classified).

## Top ten, ranked by value

1. **Five `.purpose` files fail YAML parsing and are dropped from the index.** `paradigm lint` exits 1; about 78 symbol entries are invisible. Repo fix, mechanical.
2. **`status` counts 232 phantom symbols** (13% of 1,798): reference stubs scraped from prose, including env vars as flows (`$HOME`, `$CLAUDE_PROJECT_DIR`) and DOM ids as components (`#rename-btn`). CLI fix.
3. **AGENTS.md line 2 links `github.com/anthropics/paradigm`.** The generator was already fixed (CHANGELOG.md:15); the file was never regenerated. Public and wrong.
4. **`portal.yaml` has 11 routes with no handler; doctor reports 4.** One of doctor's four (`WS /ws`) is a false positive, and it misses 8 real ones.
5. **Flows carry no edges in scan-index.json**, so doctor says 591 isolated where `integrity` says 435. Framework bug with writer and reader evidence.
6. **"Lore entries: 1 lore file"** is a checker bug: doctor counts `*.yaml` at the top of `.paradigm/lore/`; the 714 entries are `.lore` files under `entries/`.
7. **Purpose coverage is really 65% (189 of 290).** 44 of the 101 gaps are `packages/paradigm/platform-ui` subdirectories. No config key exists to exclude vendored or test directories.
8. **68 duplicate definitions, 28 PascalCase/kebab twin pairs, 262 real non-kebab ids.** 26 duplicates come from one pair of files.
9. **Gnomon spec drift.** The R6 row still says `#doodle-mod` / `$doodle-session`, the Appendix A note sums to 142 where the table has 143 rows, 43 anchors use the wrong base path, and 9 spec flows have no `.purpose` definition.
10. **Decision supersession: 0 of 138 files use the structured fields** the schema already has. Eight pairs can be backfilled with confidence.

The `.mcp.json` absolute path and the 77 legacy tool names are local only. `.mcp.json`, `.cursor/mcp.json` and `.claude/settings.local.json` are gitignored (verified with `git check-ignore`), so a visitor never sees them.

## Per category

### [Rune (compliance)] Unparsable `.purpose` files
Verified: `lint --json` reports 5 files with errors, and all five are absent from scan-index source paths.

| File | Line | Cause |
|---|---|---|
| `packages/paradigm/platform-ui/.purpose` | 112 | unquoted `: ` inside a long plain scalar ("null-safe: 0 resolved") |
| `packages/paradigm/src/platform-server/.purpose` | 29 | same ("ownOrigin/isOwnOrigin: loopback") |
| `packages/paradigm-mcp/src/utils/brain/.purpose` | 28 | same ("ReDoS-hardened: secret-assignment") |
| `packages/conductor/Sources/Conductor/Services/.purpose` | 38 | same, in `#atrium-shells` description |
| `packages/paradigm/src/commands/agent/.purpose` | 50 | key `!scopes-approved:` unquoted, read as a YAML tag |

- **Fix:** turn the three long descriptions into `>-` block scalars, quote the fourth, quote the key `'!scopes-approved':`.
- **Knock-on:** flows `$claude-turn-exchange`, `$fleet-spawn` and `$fleet-switch` point at `#claude-stream-session`, `#atrium-thread`, `#stream-event`, `#conversation-model` and `#fleet-store`. All five are prefixed in `integrity`'s `undeclaredReferences`; `#claude-stream-session` and `#atrium-shells` are confirmed as keys in the unparsed Services file, the other three are inferred to be there.
- **Who and size:** builder, mechanical, under an hour.

### [Cid (navigator)] `status` versus `doctor` counts

| Number | status | doctor | Right answer | Where computed |
|---|---|---|---|---|
| Gates | 42 | 20 | 35 distinct declared | `status.ts:60-75` via `getSymbolCounts` (`packages/premise/core/src/symbol-index.ts:443`); `doctor/index.ts:573` counts root `portal.yaml` keys only |
| `.purpose` files | 130 | 132 (hook trait) | 132 tracked | `status.ts:44` `findPurposeFiles` (`packages/purpose/core/src/aggregator.ts:202`); `doctor/hook-health.ts:209` uses `git ls-files` |
| Symbols | 1,798 | 1273:238 components:aspects | 1,566 declared | `getSymbolCounts` counts `declared: false` stubs |
| Isolated | n/a | 591 (`integrity`: 435) | 435 is closer | `doctor/context-audit.ts:477-560` reads `related` from scan-index; `integrity.ts:195` uses live edges |
| Lore | n/a | 1 | 714 | `doctor/index.ts:721` |

- **Gates, verified breakdown of 42:** 20 in root `portal.yaml`; 2 more from `packages/sentinel/portal.yaml` (`^api-authenticated`, `^rate-limited`; it also redeclares three root gates); 13 declared in `.purpose` (10 conductor, 2 gnomon, `^file-trust`); 7 stubs (`^peer-paired.`, `^read-only.`, `^write-capable.`, `^unprovisioned-only.`, `^brain-default-deny.`, `^block-id`, `^claude`).
- **Purpose files:** the glob has no `dot: true`, so 4 tracked files are invisible to every command: `.github/actions/.purpose`, `.github/workflows/.purpose`, `.paradigm/agents/.purpose`, `.paradigm/research/warpline-llm-judge-falsifier/.purpose`.
- **Build output counted:** `status` and `lint` also read 2 untracked files, `docs/private/.purpose` and `packages/gnomon/release/Gnomon.app/Contents/Resources/gnomon-mods/.purpose`.
- **`doctor --explain`:** output is identical to plain `doctor` (verified by diff). `doctor/index.ts:1491-1512` narrates only four check names and none of them fail here.
- **Exit code:** `doctor` exits 0 with 3 errors.
- **Worktrees scanned:** the "60 oversized .purpose files" check walks `.claude/worktrees` (skip list at `context-audit.ts:~822` lacks `.claude`). Tracked files over 300 lines: 21; largest is `packages/warpline/.purpose` at 4,570.
- **All CLI fixes.** Builder with review, about half a day with tests.

### [Rune] Phantom stubs
- **Evidence (verified):** 232 index entries have the description "Referenced from …": 150 components, 31 flows, 32 signals, 12 aspects, 7 gates. Created at `packages/premise/core/src/aggregator.ts:199-215`.
- **Examples:** `$XDG_RUNTIME_DIR`, `$USER`, `$ARGUMENTS`, `#LOCALAPPDATA`, `#TEMP`, `#N`, `~N`, `~tokens`, `#rrggbb`, `#session.active`, and trailing-dot copies such as `#fabric-lock.`.
- **Fix:** exclude `declared: false` from counts; tighten the stub regex (no trailing dot, no all-caps env names).
- **Decision needed:** whether stubs should exist at all. Architect.

### [Rune] Isolated symbols
All 591 classified by script, not sampled. About 75 were inspected by hand across packages.

| Class | Count | Share | Examples |
|---|---|---|---|
| No prefixed mention anywhere in the repo | 241 | 41% | `#pages-stamp`, `#conductor-log`, `#duration-tracker`, `#quickfix-provider`, `#calibrate-command`, `#TimelineBuilder`, `#CodeBlock`, `#portal-writer-tests` |
| Mentioned only outside `.purpose` (85 code only, 165 with docs) | 257 | 43% | `#gui-slash-menu` (29 code mentions), `#gui-rules-view`, `#contract-project-hue`, `#gnomon-helper-build`, `#local-retrieval-tools`, `#test-shell-utils` |
| Mentioned only in lore or decisions | 21 | 4% | `#AmbientTools`, `#paradigm-runtime`, `#info-status` |
| A `.purpose` mentions it but the index has no edge | 52 | 9% | `#window-detector`, `#dispatch-target` (flow steps at `packages/conductor/.purpose:851-955`), `#spill`, `#sync-provider`, `#skill-projector` |
| Own entry points only at undefined symbols | 11 | 2% | `#learn-path-command` → `#InternalCommands`, `!agent-turn-complete` → `#claude-stream-session` |
| Defined twice | 6 | 1% | `#DocsSidebar`, `#symphony-send`, `$ide-sync-flow` |
| Portal gates with no `.purpose` link | 2 | | `^rate-limited`, `^authenticated-session` |
| Referenced without a prefix | 1 | | `!symphony-status-flowback` |

- **Different-name twins:** 24 of the 241 exist under another casing, for example `#hero-section` / `#HeroSection`, `#InitCommand` / `#init-command`, `#CanvasStore` / `#canvas-store`.
- **Concentration:** five files hold 227 of the 591: `packages/conductor/.purpose` (97), `packages/paradigm-mcp/src/utils/.purpose` (43), `packages/paradigm/src/commands/symphony/.purpose` (35), `packages/site/.purpose` (26), `packages/site/src/.purpose` (26).
- **Largest single change, checker side:** point doctor's orphan check at the same edges `integrity` uses. That removes 156 (26%).
  - Writer: `packages/probe/core/src/generator.ts:236-266`; `addFlow` emits no `related` and reduces steps to "Step N". Verified: 0 of 108 flow entries have `related`.
  - Reader: `packages/paradigm/src/commands/doctor/context-audit.ts:510-530`.
  - My partial simulation of flow edges alone clears 50.
- **Largest single change, repo side:** 519 (88%) are leaf entries nothing references. Adding a `components:` child list to each package's root entry in the five files above clears up to 227. Whether containment should count as an edge is an architect decision.

### [Rune] Undefined references and duplicate definitions
- **Verified totals from `integrity --json`:** 3 broken, 223 undeclared (168 distinct targets), 68 duplicates.
- **Broken:** `parent: '#InternalCommands'` at `packages/paradigm/src/commands/internal/.purpose:10,19,28`; no such symbol exists.
- **Undeclared:** most are prose artifacts (`$HOME` ×7, `#code` ×6). The real ones include `#dimension-mod`, `$dimension-session`, `#cache-aligner` ×3, `!skill-used` ×3, `!team-funnel` ×3, `$shift-flow`, `$init-flow`, `#upgrade-handler`. Top files: warpline (48), gnomon-gui (25), paradigm (18).
- **Duplicates by file pair:**
  - 26: `packages/conductor/.purpose` and `packages/conductor/Sources/Conductor/Symphony/.purpose` (root repeats the sub-file).
  - 11: `packages/paradigm/.purpose` and `packages/paradigm/src/core/.purpose`.
  - 6: `packages/portal/core` and `packages/purpose/core` (`#yaml-parser`, `#validator`, four signals). These are different things sharing a name; an architect has to pick the names.
  - 1: `pack-discovery` defined twice inside `packages/university-core/.purpose` (lines 18 and 34).
  - 24 more are listed in integrity.json.
- **Checker bug:** legacy-format keys print double-prefixed (`^^symphony-enabled`, `$$symphony-relay`, `!!note-relayed`).
- **Who and size:** conductor and paradigm pairs are mechanical deletions, about two hours.

### [Rune] Stale file references and uncovered code
Window: packages most changed since 2026-09-24 are gnomon (5,478 file changes), gnomon-gui (1,637), gnomon-contracts (907), paradigm (837), paradigm-mcp (608).

- **Dead structured `file:` fields, verified, only 2 across parsed files:**
  - `packages/paradigm/.purpose:624` `src/commands/university.ts` (now the directory `src/commands/university/`).
  - `packages/paradigm-mcp/src/tools/.purpose:308` `…/tools/tool-registry.ts` (the file is at `packages/paradigm-mcp/src/utils/tool-registry.ts`).
- **Missing anchors, 43, all in three files:** `packages/gnomon/src/kernel/{broker,git,loops}/.purpose`. The paths are written relative to `packages/gnomon` and the files exist; `integrity.ts:203-212` tries only the `.purpose` directory and the repo root. Repo fix: rewrite the 43 lines relative to the `.purpose` directory.
- **Line ranges past end of file, 11.** Worst: `#UniversityLoader` anchors `university-loader.ts:1-1442` on a 61-line file.
- **Source no `.purpose` names (basename match, inferred as uncovered):**
  - paradigm: 247 of 416 non-test files, for example `src/core/discipline.ts` (1,493 lines), `src/commands/init.ts` (1,026).
  - paradigm-mcp: 53 of 197, for example `utils/agent-loader.ts` (1,123), `tools/ambient.ts` (885).
  - gnomon-voice: 36 of 47, for example `voice-client.ts` (1,523).
  - gnomon-helper: 23 of 35.
  - gnomon: 7 of 301, largest `src/transport/web-child.ts` (360).
  - gnomon-gui: 6 of 95.

### [Cid] Directories without `.purpose`
Verified by reproducing the check: 290 source directories, 189 covered, 101 uncovered. By area: platform-ui 44, site 14, paradigm commands 13, portal 12, sentinel 5, others 13.

Top 20 by lines of code:

| Lines | Directory | Note |
|---|---|---|
| 3,672 | `packages/paradigm/src/commands/team` | real gap |
| 3,406 | `packages/conductor/Sources/Conductor/Resources` | vendored `mermaid.min.js`; exclude |
| 2,238 | `packages/warpline/src/judge` | real gap |
| 2,027 | `packages/paradigm/platform-ui/src/sections/tasks/components` | real gap |
| 1,745 | `packages/paradigm/src/commands/scan` | real gap |
| 1,487 | `packages/paradigm/platform-ui/src/sections/sentinel/components` | real gap |
| 1,409 | `packages/site/src/components/NodeGraph` | real gap |
| 861 | `packages/paradigm/src/commands/habits` | real gap |
| 855 | `packages/paradigm/src/commands/tutorial` | real gap |
| 812 | `packages/paradigm/src/commands/portal` | real gap |
| 804 | `packages/portal/manager/src` | real gap |
| 768 | `packages/site/src/lib` | real gap |
| 727 | `packages/paradigm/platform-ui/src/sections/graph/components` | real gap |
| 683 | `packages/paradigm/src/commands/triage` | real gap |
| 671 | `packages/paradigm/platform-ui/src/sections/tasks/store` | real gap |
| 661 | `packages/paradigm/src/lore-server/routes` | real gap |
| 648 | `packages/paradigm/platform-ui/src/sections/sentinel/store` | real gap |
| 645 | `packages/portal/e2e/src` | test only; exclude |
| 624 | `packages/paradigm/platform-ui/src/sections/classroom` | real gap |
| 602 | `packages/paradigm/src/__tests__` | test only; exclude |

- **Also excludable:** `packages/paradigm-mcp/src/utils/brain/__fixtures__`, `packages/warpline/test/fixtures`, `packages/gnomon/test/type-fixtures`, `packages/gnomon-mod-sdk/test`, `packages/gnomon/probes/p09-ed25519-matrix`.
- **No exclusion mechanism:** the skip list is hard-coded at `context-audit.ts:89`. A `coverage.exclude` config key is a CLI change and an architect decision.
- **platform-ui:** one ancestor `.purpose` that names its `sections/*` paths would cover most of the 44. That file currently fails to parse and names no section path.
- **Size:** 81 more directories in cov.txt. Documentor work, one to two sittings for the top 20.

### [Rune] Naming drift
- **Non-kebab ids:** 367 in the index. 105 are stub junk, leaving 262 real: 230 PascalCase, 21 lowercase without hyphens, 11 with underscores. Top files: paradigm-mcp root (42), site (26), sentinel (23), sentinel/ui (21), platform-server/routes (21).
- **`lint` under-reports:** it warns on exactly one, `##docs-scaffold` in `packages/paradigm/src/commands/docs/.purpose`.
- **Twin pairs, 28.** Six command pairs between `packages/paradigm/.purpose` and `packages/paradigm/src/commands/.purpose`; eleven between `packages/paradigm-mcp/.purpose` and its `src/tools` or `src/utils` files; six between `packages/site/.purpose` and `packages/site/src/.purpose`. Which casing wins needs a human or architect call; the edits are then mechanical.
- **Doodle to dimension:**
  - `docs/specs/gnomon.md:235` (R6 row) still says `#doodle-mod`, flow `$doodle-session`.
  - `docs/specs/gnomon-mods/doodle.md` keeps the old names at lines 52 and 158, under a superseding note at line 3.
  - TD-2026-11-24-053 lists `symbols_affected: '#doodle-mod'`.
  - `#dimension-mod` and `$dimension-session` are defined in no `.purpose`. `packages/gnomon-contracts/.purpose:321-322` says "spec symbols; no code yet", which the board commits have made stale (inferred).
- **`#budget-fuse` versus "meter":** no drift. The id is `#budget-fuse` everywhere and "meter" appears only as prose (`packages/gnomon/src/kernel/budget/.purpose:15`).
- **Agent nicknames:**
  - `.paradigm/agents/cartographer.agent:2` says Atlas; the template `cartographer.agent:2` says Topo and `devops.agent:2` is Atlas.
  - Atlas is used for the cartographer at `packages/paradigm-mcp/src/tools/arch.ts:2`, `utils/arch-loader.ts:5`, `.paradigm/agents/.purpose:5` and `packages/university/src/content/notes/N-para-701-arch-yaml-format.md:32,111,117`.
  - `educator.agent:21-23` says "Sage-II"; the nickname is Sheila.
  - captain versus cid is one agent with two names (id `cid`, tool family `paradigm_captain`). Needs a human decision.

### [Cid] Gates and routes
- **Routes with no handler, verified by grep for the path literals; only `llms.txt` mentions them:**
  - `/api/courses` ×3 (`portal.yaml:431-437`)
  - `/api/plsat` ×3 (440-446)
  - `/api/canvas/files` ×4 (191-201)
  - `/api/reference` ×1 (450)
- **False positive:** `WS /ws` is implemented at `packages/paradigm/src/platform-server/ws/index.ts:52`. The method regex at `context-audit.ts:~661` does not strip `WS`.
- **Fix:** delete the 11 entries after a human confirms none is planned.
- **Declared but unattached:** 14 of the 20 root gates are attached to no route. All are referenced in code (kernel-level gates), so this is not a defect.
- **Declared with no code mention:** `^model-downloaded`, `^gaze-calibrated`, `^mcp-available`, `^conductor-launched`, `^symphony-enabled`, `^file-request-allowed` (conductor) and `^file-trust`.
- **Used but undeclared:** none real. `^voice-origin-clamp` is retired at `portal.yaml:45`.

### [Rune] Flows
- **`.paradigm/flows.yaml`:** 10 flows, 14 references to undefined symbols.
  - `$plsat-exam-flow` → `#plsat-router`, `#plsat-store`, `#progress-store`, `!plsat-completed`, `^authenticated`
  - `$probe-flow` → `#probe-engine`, `#symbol-parser`, `!probe-match`
  - `$handoff-roundtrip` → `#session-manager`, `!handoff-ready`
  - `$wisdom-promotion` → `#wisdom-store`
  - `$init-flow` and `$sync-flow` → `!command-success`
  - `$authorization-flow` → `^authenticated`
- **`.purpose` flows:** 5 flows have dangling steps. Three clear with the YAML fix; the other two are `$daemon-lifecycle` → `#raising` and `$skill-certification` → `#classroom-certifications`.
- **Junk flow ids in `packages/site/src/.purpose`:** `$(marketing)-philosophy-page`, `$docs-[...slug]-page`.
- **Spec flows with no `.purpose` definition:** Appendix A lists 17; 8 are defined. Missing: `$spawn`, `$kernel-pairing`, `$handoff-brief`, `$move-1` to `$move-4`, plus stub-only `$dimension-session` and `$voice-approval`.
- **Three clearest candidates (inferred that code spans three or more components):**
  - `$voice-approval` (§14.7: gnomon-voice, kernel voice, supervisor voice-clamp, approval broker)
  - `$dimension-session` (§12.7: `#contract-dim-shape`, `#gui-board`, `#mod-host`)
  - `$spawn` (§6: `#session-runner`, `#supervisor`, `#budget-fuse`)
- **Who:** Rune drafts, architect confirms.

### [Rune] Aspects
- Healthy. Of 226 declared aspects, 3 have no anchors: `~zod-validated-sections`, `~content-base-dual-layout`, `~classifier-only-errors`, all in `packages/university-core/.purpose`.
- No aspect anchor points at a missing file.
- 12 further "aspects" in the index are stubs.

### [Cid] Always-on budget
Verified: `CLAUDE.md` 12,483 characters plus 19 plugin skill descriptions 4,123 gives 16,606. `AGENTS.md` is 12,713.

Cuts that lose no rule agents need:

| Cut | Lines | Characters |
|---|---|---|
| Framework-Bug Protocol, moved to `paradigm://guidance/troubleshooting` | 138-166 | 1,700 |
| Agent-Owned Soft-Blocks, moved to on-demand guidance (only archetype agents use it) | 167-205 | 2,109 |
| User-facing guides table | 225-236 | 859 |
| Orchestration modes and Adoption contracts paragraphs | 98-100 | about 800 |

- **Result:** about 11,400 after three one-line pointers.
- **Alternative:** the two longest skill descriptions are `forage` (524) and `study-hall` (479).
- **Open question:** these sections are not in the generator source, so whether `paradigm sync` keeps hand edits needs a human answer before anyone edits.

### [Cid] The 15 dead path references
All reproduced. None is a dead target: 12 are bare filenames the check resolves against the repo root, 3 are illustrative examples.

| File:line | Reference | Right target |
|---|---|---|
| `CLAUDE.md:46` | `cli-output.ts` | `packages/paradigm/src/utils/cli-output.ts` |
| `CLAUDE.md:50` | `design-system.yaml`, `DESIGN.md` | `.atelier/systems/gnomon/…` |
| `CLAUDE.md:98` | `agents.yaml` | `.paradigm/agents.yaml` |
| `CLAUDE.md:229-236` | seven link labels (`quick-start.md`, `mcp-setup.md`, `decisions.md`, `v6-migration.md`, `university.md`, `sentinel-upgrade.md`, `symphony-quickstart.md`) | `docs/guides/<name>`; all exist |
| `CLAUDE.md:193` | `packages/web/src/components/payment-form/.purpose` | example text |
| `AGENTS.md:241` | `src/middleware/auth.ts`, `src/routes/projects.ts` | example text |
| `AGENTS.md:127,132` | `navigator.yaml` | `.paradigm/navigator.yaml` |

- `agents.md` on line 231 escapes only because macOS matches `AGENTS.md` case-insensitively. Linux would report 16.
- **Fix:** write full paths (clears 12), or have the checker skip fenced blocks and link labels.

### [Rune] Decision supersession
Verified: 0 of 138 files use `supersedes` or `superseded_by`. The schema has both (`packages/paradigm-mcp/src/types/knowledge-streams.ts:206,232`).

Pairs the text states outright:
- TD-2026-08-23-136 supersedes TD-2026-08-11-913, item 3 (title, line 8, and a tag).
- TD-2026-10-23-939 supersedes TD-2026-10-21-514 (line 9; confirmed at `portal.yaml:45`).
- TD-2026-11-12-064 supersedes TD-2026-08-11-351 (title).
- TD-2026-10-20-125 supersedes TD-2026-10-20-262 and TD-2026-10-20-294, the ambient auto-send part (lines 7-8).
- TD-2026-10-20-514 supersedes TD-2026-10-19-063, the "costs two" budget (line 9).
- TD-2026-10-14-735 supersedes TD-2026-08-23-042, for shared fabrics only (line 23).
- TD-2026-06-23-398 corrects TD-2026-06-22-013, companion to replacement (line 5, "CLARIFY/SHARPEN"); medium confidence.

Not backfillable as written:
- TD-2026-10-21-306 has `status: superseded` but names a task (T-2026-10-21-023), not a decision.
- TD-2026-07-17-151, TD-2026-10-23-496, TD-2026-10-28-956 and TD-2026-11-24-053 supersede spec text, not a decision id.

Five of the eight are partial, so the schema needs a way to say so, or a note field. Architect decision, then a mechanical backfill of about 14 files.

### [Rune] Appendix A
- Verified by counting rows: 142 `sym:` rows plus 1 `doc:` row is 143.
- `docs/specs/gnomon.md:2504` reads "142 … + 1 doc node = 142". The wrong sum dates from commit 96184e63 (2026-10-30, the TD-2026-10-29-746 slice).
- The drift test compares only the 142, so it passes.
- **Fix:** change "= 142" to "= 143".

## Repo files versus CLI

- **Repo, mechanical:** the 5 YAML errors, 43 anchors, 2 `file:` fields, 3 `#InternalCommands` parents, 11 line ranges, the conductor and paradigm duplicate blocks, full paths in `CLAUDE.md`, regenerating `AGENTS.md`, `gnomon.md:235` and `:2504`.
- **Repo, needs a decision:** the 11 portal routes, which casing wins for 28 twins and 262 ids, the Atlas/Topo and captain/cid names, the `CLAUDE.md` cuts, spec flows to define, partial supersession.
- **CLI, mechanical with tests:** the stub filter in counts, `addFlow` edges, the lore count, the `WS` method, the `.claude` skip, `dot: true` and gitignore in `findPurposeFiles`, double-prefix printing, `--explain` coverage.
- **CLI, needs an architect:** whether stubs exist, whether containment is an edge, a coverage exclude key, the doctor exit code.
- **Framework-bug protocol:** items 2, 5 and 6 of the top ten meet the writer-plus-reader bar. I filed nothing.

## Three work packages

1. **Make the index whole** (repo only).
   - Files: the five unparsable `.purpose` files; `packages/gnomon/src/kernel/{broker,git,loops}/.purpose`; `packages/paradigm/.purpose`; `packages/paradigm-mcp/src/tools/.purpose`; `packages/paradigm/src/commands/internal/.purpose`; `packages/university-core/.purpose`; `packages/conductor/.purpose` (remove the 26 Symphony duplicates).
   - Done when `paradigm lint` exits 0 and `integrity` shows 0 broken and 0 missing anchors.
2. **Make the counts honest** (CLI).
   - Files: `packages/premise/core/src/symbol-index.ts`, `packages/premise/core/src/aggregator.ts`, `packages/probe/core/src/generator.ts`, `packages/purpose/core/src/aggregator.ts`, `packages/paradigm/src/commands/status.ts`, `doctor/index.ts`, `doctor/context-audit.ts`, `integrity.ts`, with tests.
   - Done when `status` and `doctor` agree on gates, files and isolated symbols.
3. **Public-facing text.**
   - Files: `CLAUDE.md` (full paths, the four cuts), `AGENTS.md` (regenerate), `portal.yaml` (11 routes, after confirmation), `docs/specs/gnomon.md:235,2504`, and the decision files for the eight pairs.

## Not determined

- How many symbols the five unparsed files add once fixed; about 78 is a key-line count, not a parse.
- Whether `paradigm sync` preserves the hand-written `CLAUDE.md` sections.
- `paradigm sweep --dry`, `drift check` and `portal check` were not run, because I could not confirm they are write-free. The Appendix A checker was not run either.
- The four legacy-format files (`packages/sentinel`, `packages/sentinel-rs`, `packages/sentinel/ui`, conductor `Symphony`) were analysed by text only, so their share of the isolated classes is approximate.
- The "uncovered code" counts match by basename and overstate gaps where a `.purpose` describes a file without naming it.
- Whether the four "unrecognized config keys" (`sync`, `drift`, `ambient`, `learning`) are a schema lag; I saw the first three in `config.yaml` and did not trace the schema.
- The installed CLI predates the working tree, so a rebuilt CLI may print slightly different lines.
