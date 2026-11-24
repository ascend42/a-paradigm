# DOSSIER: Paradigm, Gnomon, Warpline — facts for the public hero pages

Measured 2026-11-23 (local time) on /Users/ascend/Documents/GitHub/a-paradigm, branch feat/gnomon-boards-s1.0, HEAD 53b5a636. Read-only: no project files written, no branch switch. Scratch work (npm audit lockfile, downloaded Gnomon package) was done in the session scratchpad; the downloaded package was deleted after checking.

Labels: VERIFIED = I ran the command or read the file:line today. INFERRED = my reading, not directly measured. RECORDED = a result written in the repo by an earlier run that I did not re-run.

Voices: [North (product)] decides what to lead with and what to leave out. [Sage (analyst)] owns the numbers and their confidence.

---

## Top ten facts

1. VERIFIED. Paradigm's own repo indexes 1,769 symbols (1,246 components, 106 flows, 42 gates, 137 signals, 238 aspects) from 129 `.purpose` files. Command: `paradigm status`.
2. VERIFIED. The MCP server lists 32 tools by default at about 7,793 tokens for `tools/list` on this repo; 7.13.0 cut it from about 134 tools and about 30k tokens. A test enforces at most 40 tools and under 8,000 tokens. `packages/paradigm-mcp/src/tools/tools-list-budget.test.ts:18-19`, run today: 15/15 pass.
3. VERIFIED. The published Gnomon app (`@a-company/gnomon-darwin-arm64@8.1.0` from npm) is Developer ID signed, notarized and stapled, and its zip matches its published sha256. `spctl` says "accepted, source=Notarized Developer ID".
4. VERIFIED. A fresh lockfile install of `@a-company/paradigm@8.1.3` audits at 0 vulnerabilities today (`npm audit`).
5. VERIFIED. The Gnomon build spec (`docs/specs/gnomon.md`, 2,486 lines) names 339 unique falsifier/test ids (`G-XXX-NN`); across the three Gnomon specs 367, of which 223 appear in a tracked test file and 144 do not. It carries a 32-row threat table where every row states its residual risk (`docs/specs/gnomon.md:1887-1923`).
6. VERIFIED. Gnomon went from first package commit (2026-10-17) to first npm release (8.0.2, 2026-10-24) in 7 days, with 1,168 commits touching `packages/gnomon*`. Its CI matrix is macOS 15, Windows and Ubuntu; the latest run on main (2026-11-12) passed 7 of 8 jobs, with `probes (macos-15)` failing.
7. RECORDED. Warpline's base-rate study on zod, nest and xstate: 17 of 275 git-clean merges (6.2%) were flagged as meaning-divergent. Ground truth on the 18 hits: 0 real breaks at merge, 3 defects fixed within a day, 15 benign; the TypeScript compiler caught 0 of 18.
8. RECORDED. Warpline's seeded 144-admission run: 32 meaning-decisive outcomes (22.2%), 3 false knots (all pre-declared), and the pre-registered "moat" gate K3 FIRED (survival gap −2.7 points, p = 0.756). The live field test has never been run.
9. VERIFIED. The only A/B study of Paradigm in the repo found identical outcomes (28/28 tests both variants) and about 34% MORE tool calls with Paradigm (about 95 vs 71) on a 15-file project. The site's "90% less context" figure has no source.
10. VERIFIED. On its own repo today, `paradigm doctor` reports the learning loop as "FLATLINE: 0 journals / 20 completions", no classroom survival evidence, 65% purpose coverage, and `warpline health` reports the repo's Warpline ledger as UNSOUND (63 verify failures; dogfooding here was stopped by decision TD-2026-11-09-865).

[North (product)] Facts 3, 4, 5 and 2 are safe to print large. Facts 9 and 10 are the ones that will hurt us if a reader finds them before we say them. Put them on the page in our own words.

---

## 1. What it is, and who it is for

### Paradigm
Paradigm is an npm CLI, an MCP server and a Claude Code plugin that keeps a typed map of a codebase in plain YAML files next to the code (`.purpose` files, `portal.yaml`) and runs shell hooks that block an AI coding session when code changed but the map did not. It also stores decisions, session history and per-agent notebooks in the repo so the next session can read them.
For: developers who use Claude Code or Cursor on a codebase too large to re-read each session, especially with auth rules or several agents. (Source: `README.md:3-20`. VERIFIED as description; "who it is for" is the README's own list at `README.md:20`.)

### Gnomon
Gnomon is a signed Mac app, installed through npm, that runs your Claude Code sessions inside a macOS sandbox and puts every permission request, question and plan on one decision stack that you answer with Touch ID or your password. It records sessions, approvals and grants in one hash-chained local log.
For: one person on an Apple silicon Mac (macOS 15+) running several Claude Code sessions on a Claude subscription. (Source: `README.md:39-69`, `packages/gnomon/README.md:1-9`, `CHANGELOG.md:231-245`.)

### Warpline
Warpline is an experimental command-line tool that records what code means (symbols and their contracts, lifted from TypeScript by the compiler) alongside the bytes, and decides whether two agents' changes can be combined by comparing meanings instead of lines. When two changes contradict the same symbol it stops and asks a human; when it cannot read a change it holds it instead of merging.
For: people running several coding agents on one TypeScript codebase who want a merge check that runs before the merge. It is 0.3.1 and labelled experimental. (Source: `packages/warpline/README.md:3-37`, `warpline --help`, `CHANGELOG.md:676,686`.)

---

## 2. The problem each removes

- Paradigm: an agent changes code and the description of that code, its auth gate, or the record of why silently goes stale, so the next session works from a wrong picture. The Stop hook blocks the session until the `.purpose` file, gate or lore entry is updated (`README.md:6,14`; hook scripts in `plugins/paradigm/scripts/paradigm-stop.sh`; 14 tracked hook test files). VERIFIED that the mechanism exists and is tested; NOT VERIFIED that it reduces defects (no measurement in the repo).
- Gnomon: several Claude Code sessions each ask for permissions in their own terminal, each can read your credentials, and nothing records who approved what. Gnomon puts the requests in one place, denies sessions access to `~/.ssh`, `~/.aws`, `~/.gnomon` and other credential stores, and signs each answer (`CHANGELOG.md:237-238`, `docs/specs/gnomon.md:1936-1946`).
- Warpline: git merges two branches cleanly because they touch different lines, and the result is broken because one side changed what a function means. RECORDED evidence that this happens: 17 of 275 git-clean merges flagged in three open-source repos, 3 of them repaired by a human within 24 hours (`.paradigm/research/warpline-guard-base-rate/results.md:43-47`, `ground-truth.md:13-21`).

---

## 3. Value claims with evidence

### 3A. Paradigm

**P1. Size of the symbol graph on its own repo: 1,769 symbols.** VERIFIED 2026-11-23.
```
$ paradigm status
  Purpose files:  129
  Gate files:     2
  # Components   1246
  $ Flows        106
  ^ Gates        42
  ! Signals      137
  ~ Aspects      238
  Total:          1769
```
Confidence: high for this repo. Disagreements: `paradigm doctor` says 131 `.purpose` files and "portal.yaml Valid (20 gates, 140 routes)" where status says 42 gates (status counts gates declared in `.purpose` files too; INFERRED). The figure 12,584 that appears in `/Users/ascend/Documents/GitHub/CLAUDE.md` belongs to the parent folder's workspace, not this repo; do not use it for Paradigm.

**P2. MCP tool surface: 32 default tools, about 7.8k tokens.** VERIFIED 2026-11-23.
```
$ cd packages/paradigm-mcp && npx vitest run src/tools/tools-list-budget.test.ts --reporter=verbose
[tools-list-budget] repo default: 32 tools, ~7793 tokens
 Test Files  1 passed (1)
      Tests  15 passed (15)
```
Before/after: "from ~134 per-op tools (~30k tokens) to 32 tools (~7.7k tokens on this repo)", `CHANGELOG.md:441` (7.13.0, 2026-09-29). RECORDED for the "before" number; the "after" is re-measured. Token count is `JSON length / 4` (`tools-list-budget.test.ts:78`), an estimate, not a tokenizer count. Composition: 11 anchors + 21 families (`packages/paradigm-mcp/src/tools/families.ts:4`). On-demand tools: code says 14 (`families.ts:5,78`); README says 13 (`README.md:91`); the 7.13.0 changelog said 12 (`CHANGELOG.md:445`). The code is right: 14.

**P3. CLI: 75 top-level commands.** VERIFIED: `paradigm --help | awk '/^Commands:/{f=1;next} f && /^  [a-z]/{print $1}' | wc -l` gives 75 (includes `help`, and two marked deprecated: `cursorrules`, `upgrade`). Confidence high. [North] This is a count I would not headline; see section 10.

**P4. Bundled agent profiles: 68.** VERIFIED: `ls packages/paradigm/templates/agents/*.agent | wc -l` gives 68. Matches `README.md:97`.

**P5. Bundled skills.** VERIFIED: 21 plugin skills (`ls plugins/paradigm/skills | wc -l` = 21; doctor counts 19 with descriptions in the always-on budget), 5 agent skill templates (`packages/paradigm/templates/skills`: a11y-audit, design-options-protocol, design-system-extract, ui-build-protocol, ui-critique-loop), 5 plugin agent definitions (`plugins/paradigm/agents`). Note `paradigm skill list` in this repo prints "No skills found".

**P6. Tests.** Static counts of tracked `*.test.*` files and `it(`/`test(` call sites (a lower bound; `it.each` expands at run time):

| Package | Test files | Static cases |
|---|---|---|
| paradigm | 107 | 1,098 |
| paradigm-mcp | 102 | 1,045 |
| premise | 12 | 135 |
| purpose | 2 | 24 |
| university-core | 7 | 82 |
| sentinel | 2 | 6 |

Command: `git ls-files packages/<p> | grep -E '\.(test|spec)\.(ts|tsx|mjs|js|cjs)$'` then grep for `^\s*(it|test)(`. RECORDED pass counts from 7.15.0 (2026-10-14): "premise-core 127, paradigm-mcp 774, paradigm 725 and purpose-core 11 pass" (`CHANGELOG.md:371`). I did not re-run these suites. Confidence: medium; use the recorded pass counts with their date, or re-run before printing.

**P7. Project memory recorded in the repo.** VERIFIED.
- Decisions: 138 files in `.paradigm/decisions` (134 tracked by git). By month: Feb 1, Mar 9, Apr 7, Jun 19, Jul 12, Aug 18, Sep 5, Oct 59, Nov 7.
- Lore: 707 entry files (697 tracked) in 114 day-folders from 2026-02-21; 325 of them in October 2026.
- Commit history rows: 1,043 (`.paradigm/history/log.jsonl`); notebooks: 40 in repo, 409 in the user home (doctor census).
Commands: `ls .paradigm/decisions | wc -l`; `find .paradigm/lore/entries -type f | wc -l`; `paradigm doctor`.

**P8. Releases and cadence.** VERIFIED.
- `CHANGELOG.md` has 271 version headings, 0.1.0 (2026-01-11) to 8.1.3 (2026-11-12). npm lists 123 published versions of `@a-company/paradigm` (`npm view @a-company/paradigm versions`). These disagree because the changelog also covers versions that were not published under this name or at all; print the npm number for "published".
- Git tags: 0 (`git tag | wc -l`). Releases cannot be reproduced from tags.
- Last two months (2026-09-26 to 2026-11-12): 17 changelog entries, 7.9.1 through 8.1.3; 8.0.0 and 8.0.1 skipped, 8.0.5 marked "not published" (`CHANGELOG.md:140,214`).
- Commits: 2,406 on this branch; 1,444 in October 2026 alone (`git log --format=%ad --date=format:%Y-%m | sort | uniq -c`).

**P9. Dependency security.** VERIFIED 2026-11-23:
```
$ npm install --package-lock-only --ignore-scripts @a-company/paradigm@8.1.3 && npm audit
found 0 vulnerabilities
```
A test guards the cause of an earlier regression (`packages/paradigm/tests/runtime-deps.test.ts`; `CHANGELOG.md:206-210`). The changelog cites 7 distinct GHSA advisories fixed in the 8.x line (`grep -oE "GHSA-[a-z0-9-]+" CHANGELOG.md | sort -u | wc -l`). Confidence: high for today; an audit result changes whenever a new advisory is published, so the page must show the date and the command.

**P10. Security fixes found by the project's own review.** VERIFIED in `CHANGELOG.md:155-181` (8.0.4, 2026-10-28): command injection through file names in aspect drift, `flow validate`, `tutorial`, Conductor AppleScript, all moved to argument lists; and `CHANGELOG.md:125,140-153` (8.0.5/8.1.0): API-provider agents now ask before running shell commands and are confined to the project. Three entries are credited "found by Aegis" (the project's security agent). [Sage] This is evidence of review discipline, and also evidence that versions up to 8.0.4 had remote-content command execution. State both.

**P11. Hook speed.** RECORDED: "The Stop hook finishes in about 1 s instead of hitting its 30 s timeout" (`CHANGELOG.md:271`). VERIFIED on this machine by doctor today: "Hook Stop p50 0.09s, p95 4.72s, max 4.72s over 14 run(s)". One machine, 14 runs.

**P12. Measured token or outcome benefit: none that supports a headline.** VERIFIED absence.
- `case-study/compare.md:12,40` (written 2026-02-06, Paradigm v2, one run per variant): 28/28 both; tool calls 71 without Paradigm vs about 95 with; file reads 31 vs 25. Its own conclusion: "The study is underpowered" (`compare.md`, Key Findings 5).
- `paradigm cost` prints "MCP vs Static: 100% reduction … Est. savings per conversation: ~$10.33", but the "150 tokens per query" is a hard-coded constant (`packages/paradigm/src/commands/cost.ts:144`) and the baseline assumes every `.purpose` file plus `scan-index.json` (1,033.7k tokens) is "loaded every conversation" (`cost.ts:220`), which does not happen. Do not quote this output.
- Calibration data: `.paradigm/learned/` does not exist in this repo and no `estimate-actuals` file was found under `~/.paradigm`; `paradigm calibrate` has nothing recorded to rebuild from here.

### 3B. Gnomon

**G1. The published app is signed, notarized, stapled and hash-matched.** VERIFIED 2026-11-23 on the npm artifact:
```
$ npm pack @a-company/gnomon-darwin-arm64@8.1.0 ; tar -xzf … ; ditto -x -k Gnomon.app.zip app
$ cat Gnomon.app.zip.sha256 ; shasum -a 256 Gnomon.app.zip
45eb7ad6d3b627776537b93b3c167a0b266c2a16cd19c7bb2d32b3f583d693c6  (both)
$ codesign --verify --deep --strict Gnomon.app
Gnomon.app: valid on disk / satisfies its Designated Requirement
$ spctl -a -vv Gnomon.app
Gnomon.app: accepted
source=Notarized Developer ID
origin=Developer ID Application: Matthew Canoy (SW4BMQ8PNL)
$ xcrun stapler validate Gnomon.app
The validate action worked!
```
Confidence: high. Caveat: the copy in `/Applications` on the founder's Mac is a local build that `spctl` rejects as "Unnotarized Developer ID"; that is the dev build, not the release. Second caveat: the bundle's `CFBundleShortVersionString` reads 8.0.0 inside the 8.1.0 package.

**G2. Spec with falsifiers.** VERIFIED.
- `wc -l docs/specs/gnomon.md` = 2,486. `grep -oE "\bG-[A-Z]+-[0-9]+[a-z]?\b" docs/specs/gnomon.md | sort -u | wc -l` = 339 unique ids; 367 across `gnomon.md`, `gnomon-loops.md`, `gnomon-client-api.md`.
- 225 distinct ids appear in tracked Gnomon test files; 223 of the 367 spec ids are among them; 144 spec ids have no test mention. The largest untested groups are for unbuilt features: voice 14, kernel linking 14, learning 10, local 10, contracts 9. Ranges such as `G-HON-01..07` are undercounted by the regex.
- Seven "laws" are written as invariants with named falsifier tests (`docs/specs/gnomon.md:1327-1338`), including "Honesty is CI" (`G-HON-01..07`), which runs as its own CI step (`.github/workflows/gnomon.yml:89`; `packages/gnomon/test/honesty.test.ts:48-60`).
Confidence: high on the counts; "id appears in a test file" is weaker than "the test passes", say "referenced by tests".

**G3. Tests.** VERIFIED static counts: gnomon 273 test files / 3,138 static cases; gnomon-gui 65 / 1,180; gnomon-contracts 27 / 314; gnomon-local 10 / 171; gnomon-voice 16 / 175. Line counts: `packages/gnomon` 91,094 source lines and 66,020 test lines; gnomon-gui 30,551 / 16,272. One suite run today:
```
$ cd packages/gnomon-contracts && npx vitest run
 Test Files  27 passed (27)
      Tests  634 passed (634)
```
(634 real vs 314 static shows the static figures understate.) I did not run the kernel suite.

**G4. Probes (measurements taken before building).** VERIFIED: 33 probe directories, 35 result files in `packages/gnomon/probes/results`. Verdicts: 22 pass, 7 partial, 2 fail, 3 with no verdict field or a prose verdict; 33 from one Apple M4 Mac on macOS 15.7.3, 2 from Windows. The two fails (`p10m-sbx-deny-mac`, `p14-link-outbound`, 2026-10-17/18) are recorded negative findings that changed the design (the P14 failure, "host must be * or localhost", led to the kernel handing sockets to the child, probe P14b, pass). Example measured result: 1,000,000 log appends, p99 0.055 ms, 57 over 5 ms (`p-log-fsync-armG-1e6.darwin.json`, arm A, RECORDED 2026-10-17).

**G5. CI legs.** VERIFIED in `.github/workflows/gnomon.yml:45,109,154,168`: test on macos-15, windows-latest, ubuntu-latest (Node 24); probes on macOS and Windows; a Swift test job; native builds on macOS and Windows: 8 jobs. Latest run on main, 2026-11-12 (run 43286257168): 7 success, 1 failure (`probes (macos-15)`). Last fully green Gnomon run on main: 2026-11-04 (run 41773257886). Command: `gh run view 43286257168 --json jobs`.

**G6. Security posture: where specified, where tested.**

| Fact | Specified | Tested |
|---|---|---|
| Hash-chained, signed kernel log; a flipped byte, an UPDATE/DELETE, or a truncation is detected | `docs/specs/gnomon.md` §3.2 (line 506) and threat 10 (line ~1900) | `packages/gnomon/test/kernel-log.test.ts:2-12` (G-LOG-01..03, 06..10) plus 7 more `kernel-log-*.test.ts` files |
| Sessions run under a macOS `sandbox-exec` profile that denies key and credential paths, the GUI port and other processes' info | §15.5 (`gnomon.md:1936-1946`) | `packages/gnomon/test/session-sandbox.test.ts:215,269` (G-SBX-04/05/06/08; skipped unless macOS 15+ with SIP) |
| Approval cards: deny on silence; only a human decides; decisions signed; presence classes | §3.4 (line 650) | `packages/gnomon/test/approval-broker.test.ts:187,213,240,266` (G-BRK-01/02/03/05) |
| Localhost GUI: 127.0.0.1 only, origin lock, DNS-rebinding refusal, no cookies, single-use launch token | §11.2 rules 1-12 (`gnomon.md:1355-1380`) | `packages/gnomon/test/web-endpoint.test.ts:95,110,168,252,301` (G-WEB-01..07) |
| CSP `default-src 'none'; script-src 'self'; …`, pinned byte-for-byte | §11.2 rule 6 | `packages/gnomon/test/web-csp-pin.test.ts:23` (G-WEB-06) |
| Subscription only: refuses to start a Claude process that would bill API credits | law 7, `gnomon.md:1338` | `packages/gnomon/test/session-preflight.test.ts` (G-SUB-01) |
| Every binary pinned to the release build's sha256; publish refuses unsigned or un-notarized apps | `CHANGELOG.md:278,280` | `packages/gnomon/test/release-pins.test.ts`; G1 above verifies the outcome |
| Keys in the Secure Enclave, Touch ID or password per signature | §3.1, `CHANGELOG.md:236` | hardware probes p04, p16, p17 (pass/partial, founder's Mac); not checkable in CI |
| 0-vulnerability install | `CHANGELOG.md:70` | P9 above, re-run today |

All VERIFIED as "the spec says it and a test file names it". I did not run these tests.

**G7. Threat model with stated residuals.** VERIFIED: 32 numbered threats at `docs/specs/gnomon.md:1887-1923`, each with a "Residual" column. Row 3 states that runaway spend is "visible, not prevented" (`gnomon.md:1893`).

**G8. Build pace.** VERIFIED: spec first committed 2026-10-15; first `packages/gnomon` commit 2026-10-17; 8.0.2 on npm 2026-10-24; 1,168 commits on `packages/gnomon*`; 59 decisions recorded in October. [Sage] Pace is a fact; it is not a quality claim.

**G9. Type errors to zero.** RECORDED: "from 335 to 0 in paradigm and from 150 to 0 in paradigm-mcp", which exposed five live bugs (`CHANGELOG.md:265-270`).

### 3C. Warpline

**W1. Base rate of git-clean, meaning-flagged merges: 6.2% (17/275).** RECORDED 2026-07-01, `.paradigm/research/warpline-guard-base-rate/results.md:38-47`: 360 oracle runs, 0 errors, 0 timeouts; zod 14/107 (13.1%), xstate 3/84 (3.6%), nest 0/84, nest TS-stratum 1/39. Method and scripts are in the same folder (`driver.mjs`, `aggregate.mjs`). Re-run with a fixed lens on 2026-07-02/03: 0 hits gained, 0 lost (`v1.1-rerun/rerun-comparison.md`). Confidence: medium. Three repos, most hits from zod's 2021-2022 history.

**W2. What the flags were worth.** RECORDED 2026-07-02, `ground-truth.md:13-27`: of 18 hits, 0 real break at merge, 3 "caught later" (fixed by a human within a day), 15 benign overlap. tsc would have caught 0 of 18 (51 commit typechecks). Also stated there: "no hit was a cross-branch interaction defect". Precision on this set is 3/18 if "caught later" counts as a true positive.

**W3. Against a blind LLM reviewer.** RECORDED 2026-07-15, `.paradigm/research/warpline-llm-judge-falsifier/results.md:4-43`: 36 blind Claude Sonnet judges, one per case; the judge caught 1 of the 3 caught-later defects. The same run found one real merge-created defect in a control that Warpline had classified CONVERGENT (`results.md:45-64`): a cross-symbol interaction Warpline "cannot represent" by design.

**W4. Seeded multi-agent run.** RECORDED 2026-07-15+, `.paradigm/research/warpline-dogfood/run-results-full.md` §0-§4: 192 admissions, 144 scored, 4 agents, 12 sessions; meaning-decisive 22.2% (32/144: 20 auto-resolves where git conflicted, 12 catches where git merged clean but the result failed tsc); false knots 3 (pre-declared trap seeds); 0 admit errors; pre-registered thresholds restated before scoring. K3 (the calibration "moat" gate) FIRED: linked 76.7% vs independent 79.3% survival, p = 0.756. 8 raw false-cleans, attributed to seed authoring and quarantined. Every row was seeded: "explicitly NOT base-rate-in-the-wild claims".

**W5. Task-pair census.** RECORDED 2026-07-15, `.paradigm/research/warpline-partition-census/first-pass-numbers.md`: 150 task pairs (80 a-paradigm, 70 zod); 11.3% overlap on the same symbol, 20.7% adjacent, 68.0% disjoint. Marked PRELIMINARY in its own first line.

**W6. Tests and commands.** VERIFIED: 156 test files, 1,332 static cases, 43,926 source lines, 36,252 test lines in `packages/warpline`; 40 top-level commands (`warpline --help`). RECORDED: "Warpline passes 1328–1330 of 1333", the failures being 60 s timeouts under load (`CHANGELOG.md:372`, 2026-10-14). Not re-run.

**W7. Published.** VERIFIED: `npm view @a-company/warpline versions` gives 0.2.1, 0.2.2, 0.3.0, 0.3.1. CI: "Warpline Guard" and a scheduled "Warpline fabric audit" workflow are active and green on recent runs (`gh run list`).

---

## 4. What changed in the last two months, and why it matters

Source: `CHANGELOG.md:8-630`, decisions in `.paradigm/decisions/TD-2026-10-*` and `TD-2026-11-*`.

Paradigm
- 7.9.1-7.14.0 (2026-09-26 to 09-29): skills as a primitive agents read at run time; the roster becomes the authority for which agents can be dispatched; learning stores consolidated with a real promotion gate; MCP surface cut from about 134 to 32 tools; Brain MVP. Why it matters: less tool text in every session, and agent procedures that are actually loaded.
- 7.15.0 (10-14): symbol integrity fixes. The changelog states the worst case plainly: `paradigm_ripple` had reported "0 dependents and safe to proceed" for a gate in use (`CHANGELOG.md:347`). Matters because impact analysis is the core promise.
- 7.15.2 / 8.0.2 (10-22/24): Stop hook finishes in about 1 s instead of timing out at 30 s (so its checks now enforce); read-only commands write nothing; Node 24 required; nevr.land registry removed.
- 8.0.3-8.0.4 (10-24/28): clean `npm audit`; command-injection fixes; plugin works in pnpm repos; a Windows/Linux workflow for hooks.
- 8.1.0 (10-29): every learning record has a home (repo, user or machine) with a commit guard that refuses personal rows; calibration rates name their population; the Stop hook judges only the session's own edits.
- 8.1.1 (11-04): a certified learning now "survives" only after two confirmed scenario runs by a different agent, not by ageing (`CHANGELOG.md:51-64`); unattributable failures are recorded as confounded; an always-on context budget check.
- 8.1.2 (11-06): commit history derived from git, so commits no longer leave the tree dirty.
- 8.1.3 (11-12): agents are told when a project uses Warpline.

Gnomon
- 8.0.2 (10-24): first public release: zero-build install of a signed app, kernel, Secure Enclave identity, decision stack, sandboxed sessions, localhost GUI, on-device voice, out-of-process mods.
- 8.1.0 (10-29): local models can use tools and MCP servers, with per-model tool tiers, server trust bound to Touch ID, "Always" rules, extra safeguards for destructive tools, and Paradigm's MCP server running in a mode where its read tools write nothing.
- In progress on this branch (not released): "boards" on Excalidraw (`TD-2026-11-24-500`, commit 53b5a636).

Warpline
- 0.3.0 (11-06): the ledger's record moves to a protected git branch `warpline/fabric`, with one writer per worktree, verified adoption on fresh clones, and a scheduled audit that the branch is append-only (`CHANGELOG.md:33-47`). Matters because the old layout dirtied the tree after every commit and conflicted across branches.
- 0.3.1 (11-12): `warpline init` writes an agent guide into AGENTS.md/CLAUDE.md, and `warpline orient` tells an agent where it is and what it may do. Reason recorded in `TD-2026-11-12-064`: agents in another project had no idea what Warpline was.
- 11-09: dogfooding in this repo stopped; testing moves to a separate server (`TD-2026-11-09-865`).

[North] The honest story of "value has grown lately" is: Paradigm became more truthful about itself (survival needs evidence, read-only commands are read-only, hooks that actually enforce, zero audit findings), and Gnomon went from nothing to a notarized app in a fortnight. That is a story about rigour, not about a growing user base. The repo has 0 GitHub stars and 1 fork (`gh api repos/ascend42/a-paradigm`, today).

---

## 5. Honest limits

### Not built, platform-bound, experimental, parked
- Gnomon runs on Apple silicon Macs with macOS 15+ only; Intel, Windows and Linux are refused (`CHANGELOG.md:132,295`; `README.md:64`). Windows work exists in CI and probes but is not shipped.
- Gnomon loops are off in release builds (`CHANGELOG.md:130,217`). The one-week loops field run in `docs/guides/gnomon-loops-field-run.md` is a plan; I found no recorded results.
- Gnomon does not cap spending. "it measures and does not enforce" (`CHANGELOG.md:235`); "visible, not prevented" (`docs/specs/gnomon.md:1893`).
- The Mac helper does not check which program calls it (`README.md:69`, `CHANGELOG.md:298`).
- Speaker verification "is a convenience filter, not a security boundary" (`CHANGELOG.md:297`).
- Specified but not built: spawning from contracts (the "armada"), kernel linking, the Doodle and gnome-persona mods, CI signing (`CHANGELOG.md:302`). 144 of 367 spec test ids have no test.
- `sandbox-exec` is a deprecated Apple mechanism; the spec lists this as a residual (`docs/specs/gnomon.md` threat 12).
- Gnomon evidence is from one machine: 33 of 35 probe results are from one Apple M4 Mac; the audience line in the spec is "8.0 is for the founder" (`docs/specs/gnomon.md:7`); the release note says "for testers" (`CHANGELOG.md:214`). No external user reports are in the repo.
- Warpline: experimental 0.x; TypeScript lens only for meaning; one merge generation; no remote sync; the pre-registered field test "has not been run" (`CHANGELOG.md:686`; `docs/guides/warpline-field-test-runbook.md:3`). The moat claim (per-codebase calibration) failed its only test as designed (K3 fired). Precision on real merges is 3/18 at best, and the one real merge-created defect in the corpus was missed.
- Warpline on this repo today: `warpline health` exits "UNSOUND … 63 FAILURE(S) of 374", "0 contested" verdicts, ledger 16 commits behind, 2.27 GB on disk (6.2 MB per strand). Expected after `TD-2026-11-09-865`, but it means this repo cannot be shown as a working Warpline example.
- Paradigm: parked parts listed at `README.md:113-120` (Conductor, VS Code extension, sentinel-rs, sentinel-web, runtime, Warpline GitHub Action, standalone core packages).
- Paradigm on its own repo (doctor, today): "Learning liveness FLATLINE: 0 journals / 20 completions"; "Survival: no exercise events recorded yet … no cert can survive"; purpose coverage 65% (186/288 directories); 579 isolated symbols; always-on text 16,606 chars against its own 12,000 cap; 15 dead path references in instruction files; 4 portal routes with no implementation.
- `paradigm_gates_for_route` never sees `portal.yaml` routes (`CHANGELOG.md:301`; task T-2026-10-22-002 still `open`).
- CI: the general "CI" and "Release" workflows are disabled on GitHub (`gh workflow list --all`: `disabled_manually`; last runs 2026-02-04, failed). Active workflows cover Gnomon packages, plugin hooks on Windows/Linux, Warpline Guard and the fabric audit. Paradigm's own CLI and MCP test suites are not run by an active workflow (INFERRED from the workflow list and `gnomon.yml:83-98`).
- One author: `git shortlog -sn` shows four identities of the founder plus one commit from another person.
- No git tags; GitHub Pages is not enabled yet (`has_pages: false`).

### Claims in existing copy that I could NOT back up

| Where | Claim | Finding |
|---|---|---|
| `packages/site/src/app/sections/MetricsSection.tsx:9` | "90% Less context / Tokens saved vs file reads" | No measurement anywhere in the repo. The only A/B study shows more tool calls with Paradigm. Remove. |
| `packages/site/src/app/sections/MetricsSection.tsx:10`, `CTASection.tsx:10` | "<1min setup", "Install Paradigm in under one minute" | Not measured. |
| `packages/site/src/app/sections/CTASection.tsx:10` | "Free forever" | A promise, not a fact. Licence is MIT (`LICENSE`). |
| `packages/site/src/content/docs/mcp-tools.md:78`, `research/competitive-analysis.md` table | "~100-300 tokens vs ~2000+ for files" | An estimate with no source. |
| `packages/site/src/app/sections/HowItWorksSection.tsx:12-17,47-51` | Sample terminal output for `paradigm shift` and `paradigm_gates_for_route` suggestions | Illustrative, not real output; the route suggestion contradicts `CHANGELOG.md:301`. |
| `README.md:13` | "sessions start faster and use fewer tokens" | Unmeasured; contradicted at small scale by `case-study/compare.md:40`. |
| `README.md:15` | "agents check them before adding an endpoint" | The route lookup returns an empty list today (`CHANGELOG.md:301`). |
| `README.md:7` | "Token estimates are rebuilt from measured usage" | The mechanism exists (`paradigm calibrate`); no recorded data in this repo. |
| `README.md:17` | each agent's notebook "improves as you approve what it learns" | No outcome data; this repo's loop reads FLATLINE. |
| `README.md:54` | "A budget fuse. A spending limit that applies across all your sessions." | Contradicted by `CHANGELOG.md:235` and `docs/specs/gnomon.md:1893`: metering only. |
| `README.md:91` | "13 more" on-demand tools | Code has 14 (`families.ts:5,78`). |
| `docs/warpline-overview.html:479` | "The calibration moat … can't be copied" | The only test of it failed as designed (K3). |
| `docs/warpline-overview.html:576-577` | "Today the agent/human boundary rests on an unsigned convention" (M3 "planned") | Stale: Ed25519 agent-signed strands shipped in 7.8.0 (`CHANGELOG.md:681`). |
| `docs/warpline-overview.html:314` | "Milestone: M2.5" | Stale against 0.3.x. |
| `docs/warpline-overview.html:611` | "≈ 3–6 mo focused work to a credible v1 that replaces git" | An estimate; and "replaces git" conflicts with the ratified thesis in the roadmap (adjudication at admit time). |
| `docs/warpline-overview.html:411,463` | "quietly beats git"; "git silently ships this" | Supported only by seeded constructions (W4), not by field data. |
| `packages/warpline/README.md:34,41` | "Not signed"; "Workspace package, not yet published" | Both stale (signed strands exist; 0.3.1 is on npm). |
| `CLAUDE-ASSESSMENT.md:18` | "a 200-token query replaces a 2000-token file read" | Opinion from 2026-02-18 about v2.0, written by the model that built it. Not evidence. |

Files named in the brief that do not hold what was expected:
- `docs/site/index.html` does not exist. `docs/site/INFO.md:3-18` is an unfilled template (every field empty).
- `llms.txt` makes no product claims: it is a generated summary of this repo's own Paradigm config (symbols, gates, routes) and never mentions Gnomon or Warpline. Flow ids print with a doubled prefix, e.g. `$$init-flow` (`llms.txt:25-34`).
- `ai-literacy-review.md` is an "AI & LLM Literacy" course pack, not a review of Paradigm.
- `reviews/` holds internal code and security reviews from April 2026 (v5.37-v6.0), not user reviews.

---

## 6. The single strongest proof for each

- Paradigm: the MCP budget test. "32 tools, about 7,793 tokens, down from about 134 and about 30k, and a test fails the build if it grows past 40 tools or 8,000 tokens." It is small, re-runnable in two seconds, and it shows determinism rather than asserting it. [North] Pair it with the Stop hook ("scripts, not instructions an agent can ignore", `README.md:6`). Do not lead with token savings in use; we have no number for that.
- Gnomon: anyone can check the app themselves. Four commands (`npm pack`, `shasum`, `spctl -a -vv`, `stapler validate`) return "accepted, source=Notarized Developer ID" and a matching hash, and the spec publishes 32 threats with what is still exposed for each. [Sage] It is the only proof here that a stranger can reproduce without trusting us.
- Warpline: the pre-registered experiments, including the ones that went against it. "We looked at 275 clean merges in zod, nest and xstate; 17 were flagged; 3 were real defects fixed within a day; the type checker caught none; a blind LLM reviewer caught 1 of the 3; and Warpline missed one real defect that the LLM found." [North] The proof is the method (thresholds written before the run, kill criteria reported when they fire), not a win rate.

---

## 7. How they fit together

[North] Paradigm is the map and the rules: a deterministic symbol graph built from `.purpose` files, with hooks, decisions and gated learning on top. Warpline reuses that kind of graph for a different question: given two changes, do their meanings conflict. Gnomon is the seat the human sits in: it runs the sessions that use Paradigm and (in Warpline projects) Warpline, and it signs what the human approved. They are sold as one install (`npm install -g @a-company/paradigm`), but Gnomon is Mac-only and Warpline is experimental, so in practice most users get Paradigm alone.

Relationships (VERIFIED unless marked):
- `@a-company/paradigm` depends at run time on `@a-company/gnomon` (the `gnomon` command) and `@a-company/warpline` (`CHANGELOG.md:209`).
- Warpline depends on `@a-company/premise-core`, which depends on purpose-core and portal-core, Paradigm's symbol libraries (`CHANGELOG.md:210`).
- Gnomon stages a pinned copy of Paradigm's MCP server for local-model sessions, in a mode where read tools write nothing (`CHANGELOG.md:81`).
- Gnomon ships a first-party "Paradigm Context" mod showing open tasks, decisions and lore (`README.md:58`; `packages/gnomon-mods/paradigm-context`).
- `paradigm loop` compiles loop definitions that the Gnomon kernel runs (off in release builds).
- `paradigm sync` writes Warpline's agent guide into generated instruction files when a project uses Warpline; `paradigm doctor` and `paradigm_status` report on it (`CHANGELOG.md:15-16`).
- Gnomon's spec plans Warpline-native sessions and merge adjudication (`docs/specs/gnomon.md:270,1083`). SPECIFIED, not built.
- The Gnomon spec is itself meant to be compiled by Paradigm's contracts compiler (`docs/specs/gnomon.md:9`). SPECIFIED; the compiler is Move 2, not built.

---

## 8. Positioning check: structure, determinism, calibration

Where the evidence supports it
- Structure: strong. 1,769 symbols, five typed symbol kinds, 140 routes mapped to gates in `portal.yaml`, 131 `.purpose` files, 138 decision files, 707 lore entries. All counted today.
- Determinism: strong for mechanisms. Hooks are shell scripts with tests; the tool surface has a test-enforced budget; read-only commands are specified as read-only (`CHANGELOG.md:259`); 7.15.0 fixed and documented a case where the graph gave a wrong answer. Gnomon adds a signed log and "Honesty is CI". Warpline's verdicts are deterministic and were measured against git.
- README already leads this way (`README.md:3-7`).

Where it is thin
- Calibration: weak in evidence. The gating rules are real and recent (8.1.1), but this repo shows 5 legacy classroom certifications, 6 legacy verdicts, no probe runs, no token-estimate table, and doctor reports FLATLINE. Warpline's calibration gate failed. We can say "the rules for calibrated learning are built and strict"; we cannot say "agents measurably improve".
- "Supersession decisions": weak structurally. The schema has `supersedes[]` and `superseded_by` (`docs/guides/decisions.md`), but `grep -l "^supersedes:\|^superseded_by:" .paradigm/decisions/*.yaml` finds 0 files and only 1 of 138 decisions has `status: superseded`. Supersession lives in prose and tags (16 files mention it). If the page claims a supersession graph, a reader will not find one.
- Determinism has gaps we must own: route-to-gate lookup is empty today; ripple gave a false "safe" until 7.15.0; own-repo coverage is 65%.
- The site still leads with the competitor words: eyebrow "The Context Engineering Framework" (`packages/site/src/app/sections/HeroSection.tsx:37`), "Structured context" (`:56`), "90% Less context" (`MetricsSection.tsx:9`), "real context" (`CTASection.tsx:8`). This is the opposite of the standing position.

[North] Recommendation for the pages: lead Paradigm with structure and determinism, with numbers. Present calibration as a design with strict rules and say the outcome data is not in yet. Do not use "context-efficient", "learning" or any savings percentage as a headline.

---

## 9. Comparisons the repo already holds

- Warpline vs git merge: measured (W1, W4). Usable with the caveats in W2-W4.
- Warpline vs the TypeScript compiler: measured, 0 of 18 hits caught by tsc (`ground-truth.md:15-21`).
- Warpline vs a blind LLM reviewer: measured, 36 judges (`warpline-llm-judge-falsifier/results.md`). Usable; it cuts both ways.
- Paradigm vs no Paradigm: `case-study/` (2026-02-06, v2, n=1 per variant). Usable only as "our first study found no outcome difference and more tool calls; it was too small".
- Paradigm vs GSD, BMAD, Spec Kit, Superpowers, Claude Flow, OpenSpec: `research/competitive-analysis.md`, dated 2026-02-18, with a source list of links. It is nine months old, the star counts are stale, and the file's own header says "Private research doc — not committed to git" although it is tracked in this public repo. Not fit for a public comparison without a refresh.
- Paradigm vs AgentScope: `docs/competitive/agentscope-analysis.md` (2026-03-27). Its conclusion is that they are not competitors. No comparison table to publish.
- Gnomon vs ruflo, Orca, deepseek-harness, OpenCode: scouting notes in `.paradigm/research/paradigm-8/` and `gnomon-orca-audit-2026-10-19.md`; the spec's line is "ruflo coordinates agents; Gnomon adjudicates their work" (`docs/specs/gnomon.md:270`). These are internal readings of other projects' code, with no measured comparison. The spec's "nobody adjudicates merges … nobody sandboxes mods" statements are unverified market claims.
- Anything else: none.

---

## 10. Product changes this research suggests

Numbers that disagree
1. On-demand MCP tools: 13 (`README.md:91`, `packages/paradigm/README.md:91`), 12 (`CHANGELOG.md:445`), 14 (`packages/paradigm-mcp/src/tools/families.ts:5,78`).
2. Gates: 42 (`paradigm status`) vs 20 (`paradigm doctor`, portal.yaml). `.purpose` files: 129 vs 131. One command should define each count.
3. Releases: 271 changelog headings vs 123 npm versions vs 0 git tags. Tag releases.
4. Versions: `@a-company/paradigm` 8.1.3, `@a-company/gnomon` 8.1.0, the app bundle says 8.0.0 (`packages/gnomon-wrapper/package.json:3`), gnomon-gui and gnomon-local 8.0.0, Gnomon helper 1.10.0, sentinel 3.9.1, university 7.0.0, logger 3.5.2, warpline 0.3.1. "Which version of Gnomon do I have" has three answers.
5. `paradigm cost` prints a savings figure from a hard-coded constant and a false baseline (`packages/paradigm/src/commands/cost.ts:144,220`). Either measure or remove; it is the likely origin of the "90%" claim.

Features documented but removed or changed
6. nevr.land registry (removed in 8.0, `CHANGELOG.md:291`) is still documented: `docs/guides/agents.md:141-165,422-428`; `plugins/paradigm/skills/agents/SKILL.md:3,107-108` (the skill description shown to every Claude Code user); `docs/guides/symphony-quickstart.md:211-219`; `docs/guides/university.md:423`.
7. `plugins/paradigm/README.md:36-42` lists pre-7.13 per-op tool names and counts ("paradigm_purpose_* (13 tools)").
8. `packages/gnomon/README.md:27` tells users to clone the repo and check out `feat/gnomon`; `README.md:47` says `gnomon` installs a signed app. `docs/guides/gnomon-dogfood.md:1,60` is titled "DEV ONLY, unsigned, until M1.3" and is linked from the user README.
9. `packages/warpline/README.md:34,41` ("Not signed", "not yet published") and `docs/warpline-overview.html:314,576-577` are stale against 0.3.x.
10. `docs/specs/gnomon.md:4` lists packages and mods that do not exist (`packages/gnomon-relay`; mods `gnome-persona`, `doodle`, `knowledge`, `cowork`); the shipped mods are workshop, ledger, paradigm-context, neurons, constellation (`ls packages/gnomon-mods`).
11. `README.md:54` "budget fuse … spending limit" vs metering only (`CHANGELOG.md:235`). The symbol is still named `#budget-fuse` in the spec (`docs/specs/gnomon.md:650`).
12. `CHANGELOG.md:262,280` describe CI typechecks and CI publish gates; the "CI" and "Release" workflows are disabled on GitHub. Either re-enable them or stop citing them.
13. `README.md:15` and CLAUDE.md tell agents to call `paradigm_gates_for_route`; it cannot see routes (T-2026-10-22-002, open).

Naming drift and overlap
14. The marketing site (`packages/site`) describes Paradigm v2-era: "Context Engineering Framework", University and PLSAT, no Gnomon, no Warpline (`HeroSection.tsx:37`, `CTASection.tsx:16`).
15. "Budget fuse", "budget meter" and "Ledger" name the same thing in different places (`README.md:54,57`; `CHANGELOG.md:235,250`).
16. Learning has many overlapping nouns in the CLI: `wisdom`, `lore`, `history`, `notebook`, `habits`, `teach`, `learn`, `memory`, `brain`, `university`, plus Classroom/Academy and decisions/journals in MCP (`paradigm --help`). INFERRED: a new reader cannot tell which one to use; the README names only notebooks, lore and decisions.
17. 75 top-level CLI commands, with at least two deprecated ones still listed (`cursorrules`, `upgrade`) and three setup entry points (`init`, `setup`, `shift`).
18. Supersession is the stated moat but is not recorded in the structured fields (0 of 138 files). Either backfill `supersedes`/`superseded_by` or stop naming it.
19. `docs/site/INFO.md` is an empty template though its README says it is "the single source of truth for how this project appears in the ecosystem" (`docs/site/README.md:4`).
20. `llms.txt:25-34` prints flow ids as `$$name`; the file has no product description.
21. `research/competitive-analysis.md:3` says it is private and uncommitted; it is public. `ai-literacy-review.md` at the repo root is a course pack with a misleading name. `CLAUDE-ASSESSMENT.md` is a v2.0 opinion piece by the building model; a reader could take it for an independent review.
22. The repo fails several of its own checks (doctor: coverage 65%, always-on budget exceeded, 15 dead references, `.mcp.json` with an absolute path that 8.1.1 fixed for users, 77 legacy tool names in permission allowlists; Warpline health UNSOUND). A public "see it on our own repo" link will show these. Fix or explain before the pages go live.
23. Gnomon's latest CI run on main is red (`probes (macos-15)`, 2026-11-12), while the spec's status line cites an older all-green run (`docs/specs/gnomon.md:3`).

---

## Reproduction commands (all run 2026-11-23)

```
paradigm status
paradigm doctor
paradigm --help
paradigm cost
warpline health
warpline --help
cd packages/paradigm-mcp && npx vitest run src/tools/tools-list-budget.test.ts --reporter=verbose
cd packages/gnomon-contracts && npx vitest run
ls packages/paradigm/templates/agents/*.agent | wc -l
ls .paradigm/decisions | wc -l ; find .paradigm/lore/entries -type f | wc -l
grep -cE '^## \[[0-9]' CHANGELOG.md ; git tag | wc -l ; git rev-list --count HEAD
grep -oE "\bG-[A-Z]+-[0-9]+[a-z]?\b" docs/specs/gnomon.md | sort -u | wc -l
npm view @a-company/paradigm versions ; npm view @a-company/warpline versions
npm install --package-lock-only --ignore-scripts @a-company/paradigm@8.1.3 && npm audit   (in an empty folder)
npm pack @a-company/gnomon-darwin-arm64@8.1.0 ; shasum -a 256 ; codesign --verify --deep --strict ; spctl -a -vv ; xcrun stapler validate
gh workflow list --all ; gh run view 43286257168 --json jobs ; gh api repos/ascend42/a-paradigm
```

Not done, and why: I did not run the full paradigm, paradigm-mcp, gnomon kernel or warpline test suites (monorepo-scale; the brief limited test runs), so pass counts for those are RECORDED from the changelog or static. I did not re-run any Warpline experiment. I did not launch Gnomon or exercise the sandbox, the log or Touch ID; the security table is "specified and has a named test", not "observed working". The `atelier` MCP server failed to connect this session; nothing here depended on it.

Key files for the page writers
- /Users/ascend/Documents/GitHub/a-paradigm/README.md
- /Users/ascend/Documents/GitHub/a-paradigm/CHANGELOG.md
- /Users/ascend/Documents/GitHub/a-paradigm/docs/specs/gnomon.md
- /Users/ascend/Documents/GitHub/a-paradigm/packages/gnomon/probes/results/
- /Users/ascend/Documents/GitHub/a-paradigm/packages/paradigm-mcp/src/tools/tools-list-budget.test.ts
- /Users/ascend/Documents/GitHub/a-paradigm/case-study/compare.md
- /Users/ascend/Documents/GitHub/a-paradigm/.paradigm/research/warpline-guard-base-rate/results.md and ground-truth.md
- /Users/ascend/Documents/GitHub/a-paradigm/.paradigm/research/warpline-llm-judge-falsifier/results.md
- /Users/ascend/Documents/GitHub/a-paradigm/.paradigm/research/warpline-dogfood/run-results-full.md
- /Users/ascend/Documents/GitHub/a-paradigm/.paradigm/decisions/TD-2026-11-09-865.yaml
- /Users/ascend/Documents/GitHub/a-paradigm/packages/site/src/app/sections/MetricsSection.tsx
- /Users/ascend/Documents/GitHub/a-paradigm/docs/warpline-overview.html
- /Users/ascend/Documents/GitHub/a-paradigm/packages/warpline/README.md
- /Users/ascend/Documents/GitHub/a-paradigm/packages/paradigm/src/commands/cost.ts

---
Filed by the orchestrator 2026-11-23 from the North/Sage dossier. This is the only source of facts for the hero pages: a number not in here does not go on a page.
