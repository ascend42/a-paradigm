# Performance audit of Paradigm and Gnomon

Bolt, 2026-11-24, filed by the orchestrator. Read-only; measurements taken on the founder's Mac while a builder was working, so absolute numbers may be slightly high.

[Bolt (performance)] Read-only audit finished. Nothing in the repo was written; `status`, `ripple`, `doctor` and an MCP start were checked with `find -newer` and wrote no project files.

The biggest daily cost is the Stop hook's compliance pass, which takes 3.3–3.9 s on every code-touching turn in this repo. About 2.1 s of that is one `find` run twice over 80,923 entries, mostly `.warpline` objects and Swift `.build` trees. CLI start-up, the per-edit and per-prompt hooks, and MCP tool handlers are already fast. The GUI embed is a size problem, not a speed problem.

Method: `hyperfine` is not installed, so timings use a scratch runner (`spawnSync`, one warm-up, median reported with n). The builder was working at the same time, so absolute numbers may be slightly high. All scripts and raw output are in `/private/tmp/claude-501/-Users-ascend-Documents-GitHub-a-paradigm/ed732f72-9885-4480-96cc-ff45d7d4e7ca/scratchpad/perf/`; every file named under "Prove" below lives there.

## Top ten

| # | Finding | Measured cost | Expected saving | Effort | Risk |
|---|---|---|---|---|---|
| 1 | Stop hook `compliance-check` runs a whole-tree `find` twice | 3.3–3.9 s per code-touching Stop (8 of 8 full passes tonight); `find` 1,084 ms median (n=5) x 2 | about 2.1 s per code-touching turn; also 2.1 s off `doctor` | S | Low |
| 2 | About 1 s of the same pass is unattributed on the real tree | 3.5 s recorded vs 0.33 s in a clean clone (n=3) plus 2.16 s of `find` | unknown until profiled | S to diagnose | Low |
| 3 | Stop hook spawns four more CLI processes before the compliance pass | medians 59 + 80–104 + 68–92 + 110–136 ms, about 0.3–0.4 s per full pass | about 0.2–0.25 s per code-touching turn | M | Medium |
| 4 | `paradigm_search` defaults to `detailed` | 64,915 chars for a two-word query vs 948 with `concise`; lore search 23,500 chars by default | about 15k tokens per broad search, about 4k per lore search | S | Medium |
| 5 | Two Paradigm MCP servers per Claude Code session (plugin and `.mcp.json`) | 3 node processes per session; the 32-tool list (31,169 chars) offered twice; two 270 ms starts | one server, one tool list | S | Low |
| 6 | MCP freshness check globs the tree on each tool call more than 500 ms after the last | 74 ms median warm (n=10); 83 ms per call under profile | about 55 ms per tool call | S–M | Low–medium |
| 7 | `paradigm doctor` has five separate tree walkers with thin skip lists | 5,185 ms median (n=5): 2.5 s in spawns, 2.3 s in `readdirSync` | about 4 s, and it stops reporting worktree copies | S–M | Low |
| 8 | GUI bundle embedded six times in a global install | gnomon: 3 copies, about 12 of 15.3 MB unpacked; paradigm: 3 copies of an older 1.87 MB bundle | about 4 MB off gnomon and 5.6 MB off paradigm unpacked now; more after the next embed | M | Medium |
| 9 | Install weight: 197 MB global install | `sql.js` 30 MB, `typescript` 23 MB, `@anthropic-ai/sdk` 11 MB, a 614 KB source map | up to about 60 MB | M–L | Medium |
| 10 | `foldDimRow` is quadratic | 8,000 rows: 959 ms row-by-row vs 3.05 ms with `foldDim`; 16,000 rows: 4,120 ms vs 3.97 ms | removes a 1–4 s stall when a scrubber is wired to it | S | Low |

## 1. CLI start-up and common commands

Leave these alone:

| Command | Median | n |
|---|---|---|
| `node -e 0` (baseline) | 41 ms | 10 |
| `paradigm --version` (installed 8.1.3) | 61 ms | 10 |
| `paradigm --help` | 64 ms | 10 |
| repo `dist/index.js --version` / `--help` | 69 / 62 ms | 10 |
| `paradigm status` | 319 ms | 7 |
| `paradigm ripple '#init-handler'` | 246 ms | 7 |
| `paradigm doctor` | 5,185 ms | 5 |

- **Start-up:** the CLI adds about 20 ms over bare Node. `packages/paradigm/src/index.ts` has 297 `await import` sites and the entry file is 105 KB, so commands are already lazy.
- **`status` and `ripple`:** most of the time is a `glob` walk (`getDirents` 105 ms and 64 ms inclusive in the profiles). Not worth touching.

**Finding 7: `doctor` (5.2 s).**
- **Cause, spawns:** 2,154 ms is `listGateFiles` called twice (`packages/paradigm/src/core/portal-compliance.ts:252`, callers at `:275` and `:310`). This is the same defect as finding 1.
- **Cause, walkers:** 2,299 ms is `readdirSync` in five recursive walkers, each with its own skip list and none skipping `.claude`, `.warpline` or `.build`:
  - `commands/doctor/index.ts:519` (1,074 ms)
  - `commands/doctor/hook-health.ts:186` (392 ms)
  - `commands/doctor/context-audit.ts:87`, `:614`, `:821` (about 770 ms together)
- **Wrong output too:** `doctor` reports "60 oversized .purpose files (largest: .claude/worktrees/agent-a36c…/packages/warpline/.purpose)". It is counting agent worktree copies.
- **Fix:** one shared file list per run (from `git ls-files -co --exclude-standard`, falling back to a pruned walk) used by all five.
- **Could break:** checks that currently see gitignored files will stop seeing them.
- **Prove:** `node bench.mjs 5 <repo> -- paradigm doctor`, plus the oversized-purpose count dropping to real files.

## 2. Hooks

Leave these alone (from `doctor`'s own timings today):

| Hook | p50 |
|---|---|
| PostToolUse-Write | 0.04 s |
| UserPromptSubmit | 0.02 s |
| PreToolUse-Bash | 0.01 s |
| PreToolUse-Write | 0.02 s |

`paradigm-navigate-remind.sh:64-68` runs `jq` four times over the 2 MB `scan-index.json` (17 ms each, n=10), but only once per session.

**Stop hook shape.** I aggregated this project's machine ring, `~/Library/Application Support/paradigm/state/h-a5f5b80ad3569804/events/stop-timing.jsonl` (146 runs).
- Overall: p50 76 ms, p95 4,013 ms, max 8,674 ms.
- 11 runs over 1 s account for 76% of all Stop wall time.
- The fast path exits after `git diff` when the session touched nothing.
- The slow path is the full pass. Across every project on this machine, 813 of 2,446 Stops (33%) take it.

**Finding 1: `compliance-check-cli` section.**
- **Measurement:** 3,302–3,911 ms on all 8 full passes tonight (p50 3,570 ms). Other projects on this machine sit at p50 432 ms, so it is specific to this tree.
- **Cause:** `plugins/paradigm/scripts/paradigm-common.sh:812` runs `paradigm compliance-check --json --auto-heal --learn --trigger on-stop`. Its portal check calls `listGateFiles` twice, and each call is a `find` from the root.
  - The `find` visits 80,923 entries: 52,079 under `.warpline/` (which is 2.4 GB, 1.9 GB of it `.warpline/states`), 14,746 under `packages/conductor/.build`, and 8,087 under `gnomon-voice/io-darwin` and `gnomon-helper/darwin`.
  - `SKIP_DIRECTORIES` (`portal-compliance.ts:86-98`) has none of those.
- **Fix:** call `listGateFiles` once per run and build the list from `git ls-files -co --exclude-standard`, keeping the `find` as the non-git fallback with `.warpline`, `.build` and `.loom` added to the prune list.
  - `git ls-files` measured 20 ms median (n=5) and returned the same 134 files.
  - The hook already made this choice for purpose discovery at `paradigm-common.sh:272`.
- **Could break:** a gitignored `.purpose` or nested `portal.yaml` stops counting as a gate source. The Cursor hooks share this code path.
- **Prove:** `node portal-scan.mjs <repo>`, then the `compliance-check-cli` section in `stop-timing.jsonl` on a real turn.
- **Not the cause:** the three `rg` scans in `runGrep` (`:217`) are 23 ms each.

**Finding 2: the unattributed second.**
- In a clean scratch clone (same `.paradigm` state, fake `HOME`) the whole command takes 0.33 s with or without `--learn`. Adding 2.16 s of `find` leaves about 1 s unexplained.
- Candidates: the learning pass reading the real `~/.paradigm` (12 MB of sessions), `git status --porcelain` on the real tree (0.14 s), and builder load.
- I could not run it on the real tree because it writes. The existing `_pm_mark` pattern, extended inside the command or as a `--timings` flag, would settle it in one turn.

**Finding 3: spawn count.**
- **Measurement:** a full pass starts the CLI five times. Before the compliance pass come `cli-resolve` (59 ms), `enforcement resolve` (`paradigm-common.sh:137`, 80–104 ms), `internal active-remediations` (`:229`, 68–92 ms) and `purpose coverage` (`:311`, 110–136 ms).
- **Fix:** have `compliance-check` return those three answers in its one JSON.
- **Could break:** the shell contract shared with the Cursor hooks, and the fail-closed ordering.
- **Prove:** the per-section sums in `stop-timing.jsonl`.

## 3. MCP server

Leave these alone:
- **Start to first `tools/list`:** 284 ms median (n=5: 268, 270, 284, 290, 476), installed build against the real repo, staged mode, fake `HOME`. `tools/list` itself is 2 ms.
- **Tool handlers** (scratch clone, n=7, back-to-back): `status` 1 ms (707 ms on the first call only), `ripple` 0 ms, `search` 1 ms, `navigate` 2 ms, `related` 0 ms, `decision search` 6 ms, `lore search` 39 ms, `lore timeline` 40 ms, `wisdom context` 38 ms.
- **Complexity:** nothing O(n²) showed at 1,798 symbols, 714 lore files and 138 decisions. Lore re-reads its files on each call and still costs 40 ms.
- **Caches:** the index is a live index with no TTL, checked by stamps, with a 500 ms debounce (`packages/paradigm-mcp/src/utils/index-loader.ts:158`). TTL caches exist for flows (30 s, `flow-loader.ts:16`), habits (30 s, `habits-loader.ts:299`), graduation (30 s, `graduation-store.ts:34`) and fixtures (60 s, `fixtures-loader.ts:16`).

**Tool list size.** 32 tools, 31,169 chars of JSON, about 7,792 tokens at 4 chars per token (my estimate, not the test's estimator). The test budget is 8,000 (`src/tools/tools-list-budget.test.ts`, `TOKEN_BUDGET`), so headroom is roughly 200 tokens. The largest are `paradigm_lore` (2,969 chars) and `paradigm_purpose` (2,910).

**Finding 4: response size.**
- **Measurement:** `paradigm_search {"query":"gnomon kernel"}` returns 64,915 chars; the same call with `response_format: "concise"` returns 948. `paradigm_lore` search returns 23,500 chars by default and 6,524 with `limit: 5`.
- **Cause:** `detailed` is the default (`packages/paradigm-mcp/src/tools/index.ts:497`, handler at `:823`).
- **Fix:** default to `concise`, or cap detailed output per result.
- **Could break:** agents and tests that read detailed fields without asking for them.
- **Prove:** `node mcp-client.mjs <mcp.js> <project> calls2.json` prints response sizes.

**Finding 5: two servers.**
- **Measurement:** `ps` shows, for this session, the plugin launcher (pid 32984) with its child `mcp.js` (33001), and a separate `paradigm-mcp .` (33004) from the project `.mcp.json`. The same pattern appears for four other projects, and this session lists both `mcp__paradigm__*` and `mcp__plugin_paradigm_paradigm__*`.
- **Cost:** two index loads and the tool list offered twice. Both servers can also run the background static rebuild (`src/index.ts:73-80`).
- **Fix:** have `paradigm sync` stop writing the `paradigm` entry to `.mcp.json` when the plugin is installed, or add a `doctor` check that names the duplicate.
- **Could break:** people who use the project entry without the plugin.

**Finding 6: freshness check.**
- **Measurement:** `getLiveIndex` on the real repo is 224 ms cold and 74 ms warm with nothing changed (n=10). In the clone, calls spaced 700 ms apart cost 42–54 ms against 0–2 ms back-to-back.
- **Cause:** `refresh` in `packages/premise/core/src/live-index.ts:155` re-globs `**/.purpose` (`packages/purpose/core/src/aggregator.ts:202`) and spawns a git ignore filter before it compares stamps.
- **Fix:** discover with `git ls-files` (20 ms) when in a git repo.
- **Could break:** non-git projects need the glob fallback kept; the discovery-order guarantee near `aggregator.ts:227` must hold.
- **Prove:** `node live-index.mjs <repo>/packages/premise/core/dist/index.js <repo>`.

**Side observation, not a perf finding.** My batch of read-style calls in the scratch clone (status, ripple, search, lore, navigate, related, decision, wisdom, session) rewrote `.paradigm/tasks/index.yaml` and five task entry files, and added a work-log file. I did not isolate which call does it. It is worth a triage because it creates git churn from reads.

## 4. Gnomon kernel and CLI

**The reviewer's first claim is confirmed.**
- `packages/gnomon/tsup.config.ts:74` sets `splitting: false`.
- The repo `dist` (built Nov 12) has exactly one `GUI_BUNDLE_FILES_B64` definition in each of `dist/agent.js` (4,506,502 bytes), `dist/cli/gnomon.js` (4,894,335) and `dist/cli/gnomond.js` (4,599,595).
- `dist/index.js` (708,760), `dist/loops.js` and `dist/transport/gnomon-web.js` do not carry it.

**The reviewer's second claim needs correcting: the decode is not a hot path.**
- `guiBundleFiles()` (`src/kernel/web/gui-pin.ts:18-19`) has one production caller, `materializeGuiBundle`, reached once per endpoint spawn at `src/kernel/web/endpoint.ts:542`.
- Decoding all 17 files (3,963,116 base64 chars to 2,972,318 bytes) takes 0.44 ms median (n=21).
- Memoising it saves nothing. Leave it alone.

**Load cost is small.**
- Importing a module holding only the embedded bundle takes 12.9–20.3 ms (median 17.5, n=7) against 0.2 ms for an empty module.
- Parse-only (`node --check`): `index.js` 44 ms, `agent.js` 69 ms, `gnomon.js` 73 ms, `gnomond.js` 72 ms, against a 36 ms baseline (n=7 each).

**Finding 8: the real problem is size and reach.**
- `src/agent/index.ts:19-20` imports `kernelPinOf` from `../cli/daemon-cli.js` and `homeTrust` from `../cli/mod-cli.js`. That drags the whole daemon, including `WebEndpoint` and the GUI bytes, into the agent client.
- The Paradigm CLI bundles that client, so its `dist` carries the GUI base64 three times:
  - `dist/agent-UBXLSKP2.js` (3.33 MB, imported by `dist/tools-LRM2QJJC.js`)
  - `dist/agent-UVTZAFO6.js` (3.33 MB, imported by `dist/mcp.js`)
  - `dist/mcp-bundle/paradigm-mcp.mjs` (5.35 MB)
- Each of those holds a 1.87 MB line from the older bundle. Today's bundle is 3.96 MB, so the next release grows each copy.
- **Fix:** move `kernelPinOf` and `homeTrust` into leaf modules that do not import the daemon, import those from the agent entry, and add a closure test in the style of `test/seams-fence.test.ts`.
- **Effect:** takes the GUI out of `dist/agent.js`, both Paradigm agent chunks and the MCP bundle. `gnomon.js` and `gnomond.js` stay as they are.
- **Could break:**
  - `distHash` in `dist/build-id.json` covers every dist file (`scripts/build-stamp.mjs`), so it changes, as it does on any build.
  - `GUI_BUNDLE_HASH` is unaffected.
  - `test/fence.test.ts` and `scripts/prepack.mjs` should be re-run.
  - The identity modules must be checked for a path back to `kernel/web`.
- **Not tonight:** setting `splitting: true` or moving the bundle to an asset file. `scripts/build-sea.mjs` bundles `dist/cli/gnomon.js` and `gnomond.js` into one SEA main with `useCodeCache: false`, and the pins assume single-file entries.
- **Prove:** `grep -c 'GUI_BUNDLE_FILES_B64 = ' dist/agent.js` returns 0, and `npm pack --dry-run --json --ignore-scripts` shows the drop.

## 5. Kernel hot paths (`packages/gnomon-contracts/src/dim.ts`)

**Finding 10: `foldDimRow`.**
- **Cause:** `foldDimRow` (`:398`) calls `draftOf` (`:273-275`), which copies the `nodes` Map and the `gone` Set for every row. `foldDim` (`:409`) copies once.
- **Measurement** (built `dist`, one `add` per row):

| Rows | `foldDim` | reduce over `foldDimRow` | Ratio |
|---|---|---|---|
| 500 | 0.30 ms | 3.4 ms | 11x |
| 2,000 | 0.68 ms | 53.8 ms | 79x |
| 8,000 | 3.05 ms | 959 ms | 315x |
| 16,000 | 3.97 ms | 4,120 ms | 1,038x |

- **Reach:** no caller of `foldDimRow`, `foldDim` or `validateDimOps` exists yet in `packages/gnomon/src`, `packages/gnomon-gui/src` or `packages/gnomon-mods` (committed tree), so this is latent.
- **Fix:** scrub with `foldDim(rows, upToSeq, from)` from a kept checkpoint, and say so in the `foldDimRow` doc comment; or give the state a persistent structure.
- **Could break:** `foldDimRow`'s purity contract if it is changed in place.
- **Prove:** `node dim-bench.mjs <repo>/packages/gnomon-contracts/dist/index.js`.

**Leave alone:**
- `validateDimOps` (`:801`) is linear in board size but cheap: 0.015 ms at 500 nodes, 0.243 ms at 8,000, 0.512 ms at 16,000 per call. A 64-op row against 8,000 nodes is 0.32 ms. The worst case, 64 failing ops (a `draftOf` per failing op at `:851`), is 15.4 ms.
- The secret check's pairwise scan (`:826`) costs 0.59 ms for a text node at the limits (4,000 chars plus 8 refs). The pair count is bounded by the node key list.
- The kernel log has its own asserted gate (G-LOG-04 in `test/kernel-log-posix.test.ts`: bulk p99 under 5 ms, critical p99 under 25 ms). I did not run it.
- The mod host (`src/kernel/modhost/host.ts`, `fold.ts`, `state.ts`) shows no per-call Map copy, hashing or file read by pattern search. I did not benchmark it, so no finding.

## 6. Install and package size

Measured with `npm pack --dry-run --json --ignore-scripts`. The flag matters: `prepack` in both paradigm and gnomon writes files.

| Package | Tarball | Unpacked | Files | Largest |
|---|---|---|---|---|
| `@a-company/paradigm` 8.1.3 | 6.51 MB | 20.02 MB | 523 | `dist/mcp-bundle/paradigm-mcp.mjs` 5.35 MB; two `dist/agent-*.js` at 3.33 MB each |
| `@a-company/gnomon` 8.1.0 | 4.68 MB | 15.30 MB | 14 | `cli/gnomon.js` 4.78 MB, `cli/gnomond.js` 4.49 MB, `agent.js` 4.40 MB |
| `@a-company/warpline` 0.3.1 | 0.39 MB | 1.36 MB | 8 | `dist/chunk-WV5XCLFZ.js` 0.57 MB |
| `@a-company/gnomon-darwin-arm64` 8.1.0 | 55.02 MB | 55.63 MB | 5 | `Gnomon.app.zip` 54.3 MB (the product; leave) |
| `@a-company/paradigm-mcp` | private | — | — | not published |
| `@a-company/gnomon-contracts` | private | — | — | not published |

No tests or fixtures ship in the published packages.

**Finding 9: installed weight.** The global install is 197 MB, 177 MB of it `node_modules`.
- **`sql.js`, 30 MB.** Its `dist` ships asm, debug, worker and zip variants. Only `sql-wasm.js` and `sql-wasm.wasm` are used, and `dist/mcp-bundle/` already carries `sql-wasm.wasm` (644 KB).
  - Fix: bundle the wasm build into the CLI the way the MCP bundle does, and drop the dependency.
  - Could break: `initSqlJs` wasm lookup (`commands/drift.ts:178`).
- **`typescript`, 23 MB.** It is a runtime dependency of `@a-company/warpline` (`packages/warpline/package.json:33`, used by `src/lens/ts-lens.ts:25` and `ts-essence.ts:19`) and of `purpose-core`.
  - Fix: make it an optional peer that is loaded lazily.
  - Could break: the lens with no TypeScript present.
- **`@anthropic-ai/sdk`, 11 MB.** Comes in through warpline.
- **Source map.** `dist/sentinel-ui/assets/index-Cd5qEGn7.js.map` (614 KB) ships; exclude it in the `build:sentinel-assets` copy.

## 7. Test and build time

Gnomon workflow, last 4 successful runs. Wall time is set by the macOS test job:

| Job | Median |
|---|---|
| test (macos-15) | 9.1 min |
| test (windows-latest) | 5.4 min |
| test (ubuntu-latest) | 5.3 min |
| probes (macos-15) | 5.0 min |
| native (macos-15) | 4.0 min |

The step "Test (contracts, kernel fence…)" is 7.1 min on macOS, 4.0 on Ubuntu and 3.2 on Windows. It runs `npm run test:gnomon`: five workspaces in series, 277 test files in `packages/gnomon/test`.

Cheap wins:
1. `test:gnomon` (root `package.json:43`) starts with `npm run build:gnomon`, although the workflow already has a build step (0.3 min). Use a CI variant that skips the rebuild.
2. Split the macOS vitest run in two with `--shard`. The 9.1 min job then falls to about the level of the other two, around 5.4 min. I have no per-file timings to say how evenly it splits.

Triggers are fine: push runs only on `main` and `feat/gnomon`, and concurrency cancels superseded runs.

**Warpline oracle.** `packages/warpline/test/oracle.test.ts:13` runs `oracle('HEAD~1', 'HEAD')` against this repo with a 60 s timeout (`vitest.config.ts`). Materialising one ref (`git archive | tar`) takes 0.8–1.1 s for 5,151 files and 73 MB, so the time goes in absorbing the full tree, not in git. A small fixture repo for that test would fix it. I did not run the test.

## Work packages

**WP1, tree walks (Paradigm CLI): findings 1, 2, 7.**
- Make `listGateFiles` a single `git ls-files` call per run, with a pruned fallback.
- Give `doctor` one shared file list.
- Add section timings inside `compliance-check` to find the missing second.
- Proof: `portal-scan.mjs`, the `doctor` median, and the `compliance-check-cli` section on a real turn dropping from about 3.5 s to under 1.5 s.
- Update the `.purpose` files for `core` and `commands/doctor`.

**WP2, MCP context and per-call cost: findings 4, 5, 6.**
- Make `concise` the default for `paradigm_search` and add a default limit for lore search.
- Add a `doctor` check and `sync` behaviour for the duplicate server.
- Use git-based discovery in `getLiveIndex`.
- Keep the tool list under its 8,000 budget while doing it; headroom is about 200 tokens.
- Proof: `mcp-client.mjs` with `calls2.json`, and `live-index.mjs`.

**WP3, Gnomon agent entry and package weight: findings 8, 10, and the source map from 9.**
- Sever `src/agent/index.ts` from the daemon CLI modules and add a closure fence test.
- Document or fix `foldDimRow`.
- Drop the sentinel source map.
- The `sql.js` and `typescript` dependencies need a decision first and belong in a later package.
- Proof: the `grep` count, `npm pack --dry-run --json --ignore-scripts`, and `dim-bench.mjs`.
- This touches `packages/gnomon`, where the builder is working now, so schedule it after that branch lands.

## What I could not measure

- **`gnomon --help` / `--version`.** `/opt/homebrew/bin/gnomon` is the Paradigm shim (`packages/paradigm/bin/gnomon.js`), which installs or upgrades and launches the signed app. I did not run it. Start-up of the installed app (bundled Node, SEA without code cache, two GUI copies in the SEA main) is unmeasured.
- **Evaluating `dist/agent.js` and the CLI entries.** I did not want kernel code touching `~/.gnomon`, so I used parse-only timings and an isolated copy of the embed module. The repo `dist` is from Nov 12.
- **`compliance-check` on the real tree.** It writes `.habits-blocking`, `aspect-graph.db`, sentinel rows and learning state. I used a scratch clone with a fake `HOME` (since deleted) plus the hook's own recorded timings. That is why about 1 s is unattributed.
- **MCP tool calls against the real repo.** They write breadcrumbs and markers. Call timings come from the scratch clone; only start-up and `tools/list` were measured on the real repo. Staged mode skips Conductor registration, so a normal start is slightly slower than 284 ms.
- **The tool-list budget by the test's own estimator.** I did not run vitest.
- **Mod host and log append.** No Gnomon tests were run, as instructed.
- **`ci.yml`.** Its recent listed runs are old failures with no usable timings.
- **The warpline oracle test itself.**
