# Teaching-path audit: Paradigm, Gnomon, Warpline

Read-only audit of `/Users/ascend/Documents/GitHub/a-paradigm` at CLI 8.1.3 (`paradigm --version`), Warpline 0.3.1, Gnomon 8.1.0. No files written in the checkout. One empty scratch directory was used to observe `status`, `doctor` and `init --dry-run` on an uninitialised project; nothing was created there.

**Headline:** the docs teach five different first-run recipes, several name commands that no longer exist, and the product's central promise ("the Stop hook blocks") is false on a fresh project because enforcement defaults to `none`. The fix is one path, one first prompt, and an honest statement of what is on by default.

Coverage limits:
- `docs/site/index.html` does not exist. `docs/site/` holds only an empty `INFO.md` template and a README, both untracked.
- `docs/commands/*.md` and the Warpline HTML pages were skimmed (headings and command references), not read line by line.
- Gnomon spec: §1 was read in full; §0 and §2 were skimmed.
- University: all path manifests and the three PARA 001 lessons were read; the other ~100 lessons were not.
- "Verified" means I ran the command or read the cited line. "Inferred" is marked.

---

## [Nora (ftux)] The first hour

Nora reads user-facing surfaces only. Where a claim needed source to settle, Helix did the reading and it is cited in his section.

### The walk

| # | Step | What the docs say | What happens | Friction |
|---|---|---|---|---|
| 1 | Find the repo | `README.md:3` gives a clear one-liner and three pillars. | Good opening. | `README.md:9` puts Gnomon before install. A reader can't tell whether Gnomon is the product or an add-on. |
| 2 | Read `llms.txt` | Titled "a-paradigm", 158 lines. | Lines 45-140 are 96 internal Platform API routes. Flows print as `$$init-flow` (`llms.txt:25`) and cite `paradigm init`. | **buried_info**: this is the repo's own generated project summary, not a product description for an LLM. |
| 3 | Install | `README.md:25` uses npm. `install.sh` clones and builds. `DISTRIBUTION.md:5-12` says primary distribution is `npm install -g github:ascend42/a-paradigm`. | npm works. | **contradictory**: three install stories. `install.sh:74` prints the root package version, which is 7.8.0, then verifies 8.1.3 (inferred from reading; not run). |
| 4 | Set up a project | See "five recipes" below. | `paradigm shift` runs 6 steps with sub-steps 1b, 2c, 2e, 2f, 3b. | **contradictory**, the worst stall in the hour. |
| 5 | Enforcement prompt | Not mentioned in README. | Shift may ask "Add Rune to roster? [Y/n]". The text says "paradigm 6.0.4 no longer enforces aspect coverage" (`shift.ts:195`). | **undefined_term**: Rune, claimant, aspects, authority.yaml, on minute three. The version in the prompt is two majors old. |
| 6 | Shift finishes | n/a | "Next steps: 1. Edit `.purpose` to define your features. 2. Run `paradigm shift --verify`." | **broken_flow**: no "open Claude Code and say this". The user is told to hand-edit YAML they have never seen. One recommendation is `paradigm doctor --verify`, which fails: `error: unknown option '--verify'` (verified). |
| 7 | Connect Claude Code | See "plugin" below. | Plugin install works with the README syntax. | **contradictory** on syntax and on order. |
| 8 | Verify | `quick-start.md:191`: ask "What paradigm tools do you have access to?" | Works. `plugins/paradigm/README.md:134` says "and 50+ others"; the same file says 32 at line 4. | Listing tools is not a value moment. |
| 9 | First useful result | Nothing in README or quick-start names one. | The user has 31 new files or directories (TD-2026-03-31-129) and no task. | **missing_coverage**: the hour ends here for most people. |
| 10 | Run `doctor` | "Health check". | On a fresh directory it prints "Survival: no exercise events recorded yet (spec sub-phase 1): no cert can survive" and "the loop cannot be shown to be alive". It then points to `.paradigm/docs/troubleshooting.md`, which does not exist there (verified in scratch). | **undefined_term**: internal Classroom jargon shown to a new user. |

### The five setup recipes (step 4)

1. `README.md:25-27`: `paradigm shift`.
2. `quick-start.md:28`: `paradigm shift && paradigm mcp setup --client all && paradigm constellation && paradigm beacon`.
3. `quick-start.md:38-50`: six steps starting `paradigm shift --quick`.
4. `docs/README.md:71-75`: a different five-step list.
5. `docs/commands/init.md`: `paradigm init --quick` throughout.

`paradigm doctor` in an uninitialised directory says "Fix: paradigm init" (verified), which disagrees with every doc except the fifth. The README recipe is the right one: `shift --help` describes it as "init + team init + scan + sync all IDEs + doctor".

### Plugin instructions (step 7)

- `README.md:35-36` and `plugins/paradigm/README.md:10-11`: `/plugin marketplace add ascend42/a-paradigm`, then `/plugin install paradigm@a-paradigm`. These agree and are current.
- `packages/site/src/content/docs/getting-started.md:41`: `/install-plugin ascend42/a-paradigm`. This is the outlier.
- Order also disagrees: README says npm then plugin; `mcp-setup.md:160` calls the plugin "the recommended install path"; quick-start never mentions the plugin in its steps.

### Other conflicts a newcomer meets

- **Does it block or not?** `README.md:6` and `:14` say the Stop hook blocks the session. `quick-start.md:57` says the enforcement default is `none` and all checks are off. Quick-start is right (source, see Helix H1). The generated `CLAUDE.md` also says "The stop hook **BLOCKS**", so the user's own agent repeats the wrong claim.
- **How to add Rune.** `quick-start.md:62` says `paradigm agent add rune`; that command does not exist (verified: `paradigm agent --help` has no `add`). `plugins/paradigm/README.md:24` says `paradigm presets`, which lists stack presets, not enforcement. The working commands are `paradigm agent roster add compliance` and `paradigm enforcement set <level>`.
- **Commands that fail.** `paradigm search` (`quick-start.md:135`), `paradigm visualize` (`docs/commands/init.md:90`, `CONTRIBUTING.md:138`), bare `paradigm scan` (site docs; it only prints usage), `paradigm agent search/install/publish` (`docs/guides/agents.md:141-165`, `:300-304`). All verified against `--help`.
- **Broken links.** `docs/README.md:33-34` links the Content Guide and Tutorial Project into `docs/private/`, which is gitignored (`git ls-files docs/private` returns nothing).
- **Rerun safety.** `README.md:30` says shift "never overwrites existing content". The shift skill says a re-run "will overwrite CLAUDE.md". PARA 001 says re-running shift regenerates it. See Helix H3.

### Names met in the first hour with no explanation

Rune, Maestro, Neverland, Cid, Loid, Jinx, `.premise` (the first line of `paradigm status` output), beacon, constellation (also the name of a separate product, `README.md:59`), probe, portal, aspects, claimant, authority, lore vs wisdom vs journal vs notebook vs history vs habits vs protocols vs decisions, Platform, Academy, Brain, PLSAT, Symphony, Sentinel, Conductor.

### Shortest honest path to "worth it"

**Paradigm, about 10 minutes, on an existing repo:**
1. `npm install -g @a-company/paradigm`, then the two `/plugin` lines.
2. `cd` into a real project, run `paradigm shift`.
3. In Claude Code, say: "Map this codebase with Paradigm: draft .purpose files for the main directories, then tell me what would be affected if I changed <a module I know>."
4. The moment is the ripple answer naming files the user recognises, at a fraction of the reading. Proof must be on their own code, not a toy.

This path is not documented anywhere today. The mapping prompt exists only in the site's `getting-started.md:75-87`, and it ends with the broken `paradigm scan`.

**Gnomon, about 5 minutes if prerequisites hold:**
1. Type `gnomon` in a repo; setup runs; two Touch ID prompts.
2. Start a session; let it request a permission.
3. The moment is the first card on the decision stack, approved with Touch ID.

Blocking friction: `packages/gnomon/README.md:25-32` still says to install from a clone on the `feat/gnomon` branch, while root `README.md:44` says just run `gnomon`. Root README is right (the npm package ships a `gnomon` bin). Prerequisites that silently refuse (native-installer Claude Code, no API key env, no `NODE_OPTIONS`) are in the README list but need a one-line preflight on the hero page. `README.md:47` says first run installs Gnomon.app; `gnomon --help` says it opens your default browser. I could not tell which a new user sees.

**Warpline, about 3 minutes, no setup:**
1. `npm i -g @a-company/warpline`.
2. In any git repo with two branches: `warpline oracle <A> <B>`.
3. The moment is Warpline predicting a merge from meaning and scoring itself against git's real merge, read-only, no `.purpose` files needed.

I did not run `oracle` (a builder is in this checkout); `warpline orient` ran fine. Friction: `packages/warpline/README.md` says "Workspace package, not yet published", while root README links the npm package and `warpline-project-setup.md` says `npm i -g`. Three taglines compete: "version control for meaning" (package README), "merge prediction from the symbol graph" (root README), "meaning-merge adjudication layer" (setup guide).

---

## [Sheila (educator)] The learning path

### What the evidence says about how people learn Paradigm today

- **University is not reaching anyone.** TD-2026-09-26-846 records "0 University usage in 30d" and "367/378 notebook entries appliedCount 0", and concludes that "knowledge is authored but never reaches a session". Any plan that puts the main path in University repeats that failure.
- **University is ordered by release history, not by learner outcome.** PARA 001 to 901 follows what shipped when: 601 "Ambient", 801 "Closing the Loop (v7)", 901 "The Classroom". There are 12 paths and about 110 lessons.
- **Its facts have drifted.** PARA 701 teaches a "54-agent roster" and the nevr.land marketplace (`LP-para-701.yaml:3`, `:60`); the roster is 68 and nevr.land was removed in 8.0.1. The pack reports three versions: 6.0.0 (`packages/university/pack.yaml`, which also says "PARA 001-701"), 6.6.0 (`src/content/pack.yaml`), 7.0.0 (`package.json`).
- **PARA 001's exercise teaches the wrong actor.** `N-para-001-build-something.md` has the learner type `paradigm_orchestrate_inline({task: ..., mode: "quick"})`. A person never types an MCP call; they prompt the agent. The exercise should be a sentence said to Claude.
- **A built-in tutorial exists and nobody is sent to it.** `paradigm tutorial` (5 steps, "ShopFlow Example") is referenced in no doc, and its last step is "Visualize in Dreamscape", a dead name.
- **My own profile is stale.** `educator.agent:21-23` calls me "Sage-II". My two notebook entries describe a 101-701 catalogue stored as `courses/*.json`, which v6.0 deleted.

### What a person should be able to do

| When | Can do | Proof |
|---|---|---|
| 10 minutes | Install, shift, have the agent map one area, ask one impact question | A ripple answer on their own code |
| 1 day | Finish one real change where the agent kept `.purpose` current; read a `.purpose` and a `portal.yaml`; say what is and isn't enforced | One merged change with a `Symbols:` trailer |
| 1 week | Turn enforcement on deliberately; record a decision and lore; run a 3+ file task through the team; bench agents they don't need | `paradigm enforcement status` shows a chosen level; one TD file; one orchestrated task |
| 1 month | Teach an agent and gate the learning; write a protocol; calibrate; run parallel sessions (Gnomon) or adjudicate a merge (Warpline) | One notebook entry they approved; one protocol reused |

### The structure

Four levels. Each has one exercise, done on the learner's own repo.

| Level | Teaches | One exercise | Lives in |
|---|---|---|---|
| 0. See it (10 min) | The promise; install; the first prompt | "Map this area, then tell me what changes if I touch X" | Hero page above the fold; README Install section; the plugin's shift skill ends by offering this prompt |
| 1. Work with it (day 1) | The five symbols by reading, not memorising; `.purpose` and `portal.yaml`; what the agent maintains for you; enforcement is off by default | Ship one small change; read the diff to `.purpose`; commit with the trailer | One guide, the rewritten quick-start; the generated `CLAUDE.md` carries the same rules for the agent |
| 2. Trust it (week 1) | Enforcement levels and Rune; ripple before change; gates before endpoints; lore and decisions; the team and when to go solo | Set enforcement to `minimal` or `balanced`, trigger a block on purpose, clear it | One "Daily practice" guide; in-tool skills (`/paradigm:preflight`, `postflight`, `ripple`, `lore`) |
| 3. Compound it (month 1) | Teaching agents; the Classroom gate; protocols; calibration; where learning lives; then Gnomon and Warpline as separate tracks | Teach one agent one rule, run one class term, see it applied | Guides for agents, learning scopes, decisions; University as optional self-check quizzes |

Placement rules:
- Anything the agent must do goes in the generated `CLAUDE.md` and skills.
- Anything the human must decide goes in a guide.
- The hero page carries only Level 0.
- University becomes the assessment layer (quizzes per level, PLSAT at the end), not the path.

### Existing documents: keep, merge, rewrite, retire

| Document | Level | Action |
|---|---|---|
| `README.md` | 0 | Keep. Fix the blocking claim, add the first prompt, move Gnomon below "CLI and MCP". |
| `docs/guides/quick-start.md` | 0-1 | Rewrite. One path. Delete beacon/constellation, `search`, `agent add rune`, `~/.claude/claude.json`. |
| `docs/README.md` | index | Rewrite as an index by level. Today it centres beacon, constellation and index, and links into gitignored `docs/private/`. |
| `docs/commands/*.md` (8 files, 2,761 lines) | reference | Retire `beacon`, `constellation`, `index`, `init`; these now sit under `paradigm util` or behind shift. Keep `doctor`, `ripple`, `sync`. Merge `commands/mcp-setup.md` into the guide. |
| `docs/guides/mcp-setup.md` | 1 (non-Claude-Code clients) | Trim to Cursor, Desktop, Continue, Cline. Fix the Claude Code config path. |
| `docs/guides/agents.md` | 2-3 | Rewrite. Remove §"Registry (nevr.land)" and the marketplace primitives. Fix names: the cartographer is Topo, not Atlas; Loid's id is `forge`. Split human use (§1-3, §9) from internals (§10-12). |
| `docs/guides/decisions.md` | 2 | Keep §1-5. Move §6-8 (v5 migration, forensics) into the migration guide. |
| `docs/guides/learning-scopes.md` | 3 | Keep. |
| `docs/guides/university.md` | 3, pack authors | Keep as an authoring reference. Strip v5.39/v6.0 framing. |
| `docs/guides/v6-migration.md` | upgraders | Keep, link only from the changelog. Its §11 enforcement flip is the best explanation of the default and should be lifted into Level 2. |
| `docs/guides/sentinel-upgrade.md` | none | Retire or move to private. It is per-project instructions for the founder's own repos (a-star, a-kamiki, leadsync-dash). |
| `docs/guides/symphony-quickstart.md`, `table-talk.md`, `gnomon-loops-field-run.md`, `warpline-field-test-runbook.md`, `warpline-multi-instance-demo.md` | specialist | Keep, off the main path. |
| `docs/guides/gnomon-dogfood.md` | contributors | Keep, labelled developer-only. |
| `packages/gnomon/README.md` | Gnomon 0 | Rewrite install and first run to match the root README. |
| `packages/warpline/README.md` | Warpline 0 | Fix "not yet published". Lead with `oracle`. |
| `docs/guides/warpline-project-setup.md` | Warpline 2 | Keep; it is accurate and candid about limits. |
| `packages/site/src/content/docs/*` | 0-1 | Regenerate from the rewritten guides or retire. It currently teaches `/install-plugin` and bare `paradigm scan`. |
| `plugins/paradigm/README.md` | 0 | Fix the tool table (legacy `paradigm_purpose_*` names), the skills table (18 listed, 21 on disk), the agents table (8 listed, 5 shipped), and `paradigm presets`. |
| `DISTRIBUTION.md` | none | Retire. It describes a v2.0.0 GitHub-direct strategy. |
| `CONTRIBUTING.md` | contributors | Fix `paradigm visualize`. |
| `llms.txt` | none | Either write a real product `llms.txt` by hand or stop shipping the generated project summary at the repo root. |
| University PARA 001 | 0-1 | Rewrite the exercise as prompts. |
| University PARA 101-901 | 1-3 | Regroup into the four levels; retire nevr.land lessons; fix counts. |
| `paradigm tutorial` | 1 | Either revive as the Level 1 exercise or remove (product decision). |

Missing entirely:
- A "first prompt" anywhere a newcomer looks.
- A one-page map of the memory stores (which of the dozen to use when).
- A glossary of agent nicknames and house terms.
- A "what is on by default" page.
- A Gnomon first-session guide for users (only the developer one exists).
- A Warpline "try it on your repo in three minutes" page.

### Best practices, with evidence

1. **Have the agent map the code before asking it to change the code.** Evidence: `README.md:13`; token table in `packages/paradigm-mcp/src/resources/guidance.ts:178-192` (about 300 tokens for ripple against 2,000+ for a large file read).
2. **Ask "what does this affect" before every non-trivial change.** Evidence: generated CLAUDE.md "Before each task" (`ide-adapters/claude.ts:110`); the `/paradigm:ripple` skill; task-size tiers in `plugins/paradigm/README.md:104-110`.
3. **Turn enforcement on deliberately; it is off by default.** Evidence: `packages/paradigm/src/core/enforcement/loader.ts:21` (`DEFAULT_LEVEL = 'none'`); `v6-migration.md:337-341` calls it "the largest silent behavioral change in v6.x"; TD-2026-04-25-417.
4. **Let the agent keep `.purpose` current in the same change, never afterwards.** Evidence: `purpose-coverage` is the one check that blocks at `balanced` (`paradigm enforcement status`, verified); `quick-start.md:204-211` sets the cost at about five minutes per feature.
5. **Declare gates in `portal.yaml` before adding an endpoint.** Evidence: generated CLAUDE.md "Auth requires portal.yaml"; the fail-closed contract described in `v6-migration.md:113-120` (an unparseable portal was "a documented auth-bypass").
6. **Record the why as a decision, and what happened as lore, as you go.** Evidence: `decisions.md` §3 companion-lore pattern; `lore-required` check; 138 decisions and 710 lore records in this repo (`paradigm doctor`, verified).
7. **Keep the roster small: three or four agents per task.** Evidence: `agents.md:79` ("beyond 5+ the marginal value ... doesn't beat the cost"); `warpline-multi-instance-demo.md:396` ("~2-4 agents is the healthy band").
8. **Use the team for 3+ file work and say so when you go solo.** Evidence: `orchestration-required` check; `paradigm solo <reason>`; the team funnel line in `paradigm doctor`; TD-2026-10-24-893.
9. **Treat what agents learn as provisional until you sign it off.** Evidence: TD-2026-06-19-007; the class skill; `paradigm doctor` here reports "Learning liveness FLATLINE: 0 journals / 20 completions", which shows the automatic loop cannot be relied on alone.
10. **Check for a protocol before repeating a pattern; record one after.** Evidence: step 0 of "Before Implementing" in the generated CLAUDE.md (`claude.ts:118`); 41 files in `.paradigm/protocols/`.
11. **Regenerate instruction files with `paradigm sync`; do not hand-edit them.** Evidence: `paradigm://guidance/docgen` (`guidance.ts:697-724`); `ide-adapters/index.ts:308-322` regenerates on force.
12. **Put durable facts in the typed store, not in native memory.** Evidence: "Native Memory Hygiene" in the generated CLAUDE.md (`claude.ts:157-169`); TD-2026-09-19-110; `paradigm memory review`.
13. **Run `paradigm doctor` after every upgrade.** Evidence: on this repo doctor found 77 legacy tool names in permission allowlists, 2 machine-specific MCP paths and a stale project-scope plugin pin (verified output).

Practices 1-5 belong to Levels 0-2 and should be on the page a newcomer reads. 6-13 belong to Levels 2-3.

---

## [Helix (dx)] Where the product makes teaching hard

Ranked by how many newcomers each hits.

**H1. The headline claim is false by default (everyone).**
- `README.md:6`, `README.md:14`, the generated CLAUDE.md (`packages/paradigm/src/core/ide-adapters/claude.ts:127`, `:131`) and the shift skill ("the stop hook will enforce compliance") all say the Stop hook blocks.
- The default level is `none`: `core/enforcement/loader.ts:21`, `writer.ts:53`, and shift prints "Enforcement: none" (`shift.ts:670`). Verified in source.
- `paradigm enforcement set --help` lists only "strict, balanced, minimal" and omits `none`.
- Cheapest fix, docs: say "off until you turn it on" in README and plugin README. Product, small: make `claude.ts:127` read the resolved level and print the true statement.

**H2. Shift ends without a first action (everyone).**
- `shift.ts` closing block: "Edit .purpose to define your features" and "Run paradigm shift --verify".
- `shift-recommendations.ts:474` recommends `paradigm doctor --verify`, which errors (verified).
- Fix, product, small: end with one copyable prompt for the user's agent, and correct the doctor command.

**H3. Shift regenerates an existing CLAUDE.md (most Claude Code users).**
- `shift.ts:750` calls `syncCommand(ide, { quiet: true, force: true })`.
- `ide-adapters/index.ts:308-322` then writes the generated file, preserving only the Warpline block.
- `README.md:30` says it "never overwrites existing content". `init.ts:545` says existing IDE files "were preserved".
- Verified by reading the code path; not executed. Init may do more than I saw.
- Fix, product, medium: back up or merge an existing hand-written file and say so in the output. Until then, correct `README.md:30`.

**H4. Four ways to do setup, and they disagree (everyone).**
- CLI: `init`, `shift`, `setup` (a third wizard, `paradigm setup`). Skills: `/paradigm:init`, `/paradigm:shift`. `doctor` recommends `init`.
- Fix, product, small: doctor says `paradigm shift`. Docs: teach only shift. Consider hiding `init` and `setup` from top-level help.

**H5. No CLI command rebuilds the symbol index (anyone not on the plugin).**
- Site docs teach bare `paradigm scan` (`getting-started.md:86`, `purpose-files.md:78`, `cli-reference.md:19`, `HowItWorksSection.tsx:17`). It only prints usage (`packages/paradigm/src/index.ts:492-499`).
- `doctor` says "run paradigm scan first" for a missing `scan-index.json`, and elsewhere "Fix: paradigm index".
- The real rebuild is the MCP tool `paradigm_reindex` or the pre-commit hook.
- Fix, product, small: add `paradigm reindex`, or make bare `scan` do it. Then fix the four site lines.

**H6. Removed or renamed commands still documented (anyone following a guide).** All verified against `--help`.

| Documented | Where | Reality |
|---|---|---|
| `paradigm agent add rune` | `quick-start.md:62` | `paradigm agent roster add compliance` |
| `paradigm presets` to activate checks | `plugins/paradigm/README.md:24`, `:136` | `paradigm enforcement set <level>` |
| `paradigm search` | `quick-start.md:135` | MCP only |
| `paradigm visualize` | `docs/commands/init.md:90`, `CONTRIBUTING.md:138` | gone |
| `paradigm agent search/install/publish` | `agents.md:141-165`, `:300-304` | gone with nevr.land |
| `/install-plugin` | site `getting-started.md:41` | `/plugin marketplace add` then `/plugin install` |
| `paradigm doctor --verify` | `shift-recommendations.ts:474` | unknown option |
| `paradigm aspect stub-create`, `paradigm_optout_register` | repo `CLAUDE.md:193`, `:204` | no match anywhere in `packages/*/src` |
| "Visualize in Dreamscape" | `commands/tutorial/index.ts:175` | dead name |

The `paradigm:agents` skill description still offers "install from GitHub or nevr.land".

**H7. Claude Code MCP config path is wrong in the docs (manual-config users).**
- Docs say `~/.claude/claude.json`: `quick-start.md:193`, `:247`; `mcp-setup.md:149`, `:176`, `:199`.
- Source writes `.mcp.json` at the project root (`commands/mcp/setup.ts:102-103`). Source is right.
- Docs fix, small.

**H8. Counts and versions disagree.**

| Thing | Values | Right one |
|---|---|---|
| MCP tools | 32 (README, plugin.json); "50+ others" (`plugins/paradigm/README.md:134`); "(13 tools)", "(18 tools)", "(8 tools)" legacy families (same file, `:36-42`) | 32 by default; I counted 32 in the live tool list |
| Agents | 68 bundled (README; 68 template files, verified); "54-agent roster" (PARA 701); "27 of 74" (`paradigm agent roster` here, which counts local extras) | 68 bundled |
| Plugin skills | 18 in plugin README; 21 directories; doctor counts 19 | 21 on disk |
| Plugin agents | 8 in the README table (`:76-83`); 5 at `:121`; 5 files | 5 |
| Repo version | root `package.json` 7.8.0; packages 8.1.3 | 8.1.3 |
| University pack | 6.0.0, 6.6.0, 7.0.0 | undetermined |
| Generated header | `AGENTS.md:2` "Generated by [Paradigm](https://github.com/anthropics/paradigm) v2.0" (`ide-adapters/agents.ts:49`) | wrong org and wrong version, shipped to every project |
| Shift prompt | "paradigm 6.0.4" (`shift.ts:195`) | 8.x |
| Node for Gnomon | "Node 24 or later" (root README); "22.14+ ... also work" (`packages/gnomon/README.md:19`) | undetermined |

Fix, product, small: derive counts and version at build or sync time. The `agents.ts:49` URL is a one-line fix that reaches every user project.

**H9. Names that disagree.**
- Cartographer is "Atlas" in `agents.md` and `v6-migration.md`, "Topo" in `cartographer.agent:2` and the roster.
- Loid is "intelligence officer" in `agents.md`; his id is `forge`.
- Plugin README lists agent `captain`; the id is `cid`.
- Educator is "Sheila" by nickname and "Sage-II" in her own file. "Sage-II" and "Atlas" together appear 40 times across the agent templates.
- `constellation` is both a CLI command and a separate product named in `README.md:59`.
- "Neverland" (learning health) sits one letter from the removed "nevr.land".
- Platform's "Academy" is University.
- Fix: docs glossary now; product rename pass later.

**H10. Two learning stories.**
- Automatic: `guidance.ts:346-368` says postflight "auto-promotes high-confidence journal entries" and "No configuration needed". `agents.md` §7 agrees.
- Gated: `README.md:7` says a learning is "signed off by you before it reaches a notebook". The class skill is marked "STATUS: DRAFT", and `paradigm_classroom` is not in the default tool list.
- I could not determine from user-facing text which governs at 8.1.3. Doctor's FLATLINE suggests the automatic loop is producing nothing here.
- Fix: founder ruling, then one paragraph in each place.

**H11. Concept load before anything works.**
- `paradigm --help` lists about 70 top-level commands, including deprecated ones (`cursorrules`, `upgrade`) and a `util` group that duplicates top-level `beacon`, `constellation`, `echo`, `thread`, `probe`.
- `paradigm doctor` registers 30 learning stores.
- Fix, product, medium: group help into "start here" (shift, status, doctor, ripple, sync) and "everything else". Hide deprecated commands.

**H12. Doctor is not readable by a newcomer.**
- Fresh directory: Classroom jargon and a pointer to a file that doesn't exist (see Nora step 10).
- Mature project: about 75 lines, 20 of them "Learning census".
- It reports "Lore entries: 1 lore file" while the same run reports `lore[ledger]=710`.
- It says "Claude Code hooks: No hooks installed. Fix: paradigm hooks install" while also reporting the plugin installed at 8.1.3. The plugin README tells users to delete per-project hooks to avoid duplication. Following doctor would double them (inferred from the two outputs; not tested).
- User output carries logger lines such as `ℹ [status] Getting project status` and JSON payloads.
- Fix, product, medium: a default view of five to ten lines, with `--all` for the rest; detect plugin hooks; drop logger lines from CLI output.

**H13. `paradigm agent create` scope.**
- Help says `-g, --global ... (default)`; `agents.md:124` agrees.
- Your memory index records it as project-local.
- I did not find `create.ts` to settle it (the directory has no such file). Needs a one-minute check by someone who knows where the command lives.

**H14. `warpline orient` says "AGENTS.md missing, CLAUDE.md missing" in a repo that has both.**
- It means the Warpline block is missing.
- Fix, product, one string.

**H15. Stale agent definition tools.**
- `educator.agent` tells Sheila to use `paradigm_university_create`, `_update`, `_quiz`, `_validate`.
- The guidance resource says University has two read-only tools (`guidance.ts:445`).
- A registration for `paradigm_university_create` exists at `tools/university.ts:44`; I did not check whether it is reachable. Low newcomer impact.

---

## (a) The learning path

| Level | Time | Outcome | Exercise | Home | Built from |
|---|---|---|---|---|---|
| 0 See it | 10 min | Impact answer on own code | First prompt: map an area, ask what a change affects | Hero page; README; end of shift | README, site getting-started Scenario B |
| 1 Work with it | Day 1 | One change shipped with `.purpose` kept current | Small change, read the `.purpose` diff, commit with trailer | Rewritten quick-start; generated CLAUDE.md | quick-start, PARA 001/101, site concept pages |
| 2 Trust it | Week 1 | Enforcement chosen; lore, decision, team task | Turn on a level, trigger and clear a block | "Daily practice" guide; plugin skills | v6-migration §11, decisions §1-5, agents §1-3 and §9, PARA 301 |
| 3 Compound it | Month 1 | Agent taught and gated; protocol; calibrate | Teach one rule, run one class term | agents, learning-scopes, decisions guides; University quizzes | agents §7, class/teach skills, PARA 901 |
| Gnomon track | 5 min, then ongoing | Sessions steered from one stack | First card approved | Gnomon hero page; rewritten package README; `gnomon guide` | root README Gnomon section |
| Warpline track | 3 min, then ongoing | Merge forecast, then adjudication | `warpline oracle A B` | Warpline hero page; package README; project-setup guide | package README, project-setup |

## (b) Best practices

The thirteen in Sheila's section, in that order. The first five are the newcomer set: map first, ripple before change, enforcement is a choice, `.purpose` in the same change, gates before endpoints.

## (c) Docs changes, ranked

1. **README:** correct the blocking claim, add the first prompt, fix or soften "never overwrites" (`:6`, `:14`, `:30`). Small.
2. **quick-start.md:** rewrite to one path; remove five dead references. Medium.
3. **plugins/paradigm/README.md:** fix `paradigm presets`, tool, skill and agent tables, "50+". Small.
4. **Site docs:** fix `/install-plugin` and four `paradigm scan` lines, or retire the content. Small.
5. **docs/README.md:** rewrite as a by-level index; drop `docs/private` links. Small.
6. **agents.md:** remove nevr.land sections, fix names, split human from internals. Medium.
7. **packages/gnomon/README.md and packages/warpline/README.md:** align install with root README. Small each.
8. **mcp-setup.md and quick-start:** fix the Claude Code config path. Small.
9. **New pages:** memory-store map, glossary, "what is on by default". Small each.
10. **Retire:** `DISTRIBUTION.md`, `sentinel-upgrade.md`, `docs/commands/{beacon,constellation,index,init}.md`. Small.
11. **University:** rewrite PARA 001 exercise; regroup to four levels; remove nevr.land; fix "54". Large.
12. **CONTRIBUTING.md `:138`, llms.txt.** Small.

## (d) Product changes that fell out, ranked

1. Generated CLAUDE.md states the real enforcement level (`claude.ts:127-133`). Small.
2. Shift ends with a first prompt; fix `doctor --verify` (`shift-recommendations.ts:474`). Small.
3. Shift protects an existing CLAUDE.md, by backup or merge, and reports it (`shift.ts:750`, `ide-adapters/index.ts:308`). Medium. Needs a run to confirm the behaviour first.
4. A CLI reindex command, or bare `scan` rebuilds. Small.
5. `doctor`: say `shift` not `init`; short default view; detect plugin hooks; no Classroom jargon on fresh projects; fix the lore count and the missing troubleshooting path. Medium.
6. `AGENTS.md` header URL and version (`agents.ts:49`); shift prompt version (`shift.ts:195`). One line each.
7. `paradigm --help` grouped; deprecated and duplicate commands hidden. Medium.
8. Counts and versions derived, not typed (root `package.json`, plugin README, University pack). Small to medium.
9. Name pass: Atlas/Topo, Sage-II/Sheila, captain/cid, constellation collision. Medium.
10. Decide the learning story (automatic vs gated) and make README, guidance and skills agree. Founder ruling, then small.
11. `paradigm tutorial`: revive as Level 1 or remove. Decision, then small or medium.
12. `paradigm enforcement set --help` lists `none`; `warpline orient` wording; `paradigm:agents` skill description. One line each.
13. Strip logger lines from CLI output (`status`, `ripple`, `doctor`). Small.

## (e) Hero pages: above the fold versus guide

**Paradigm**
- Above the fold: the one-line promise from `README.md:3`; the three install lines (npm, `shift`, plugin); the first prompt; one real ripple answer shown as output; one honest line that checks are off until you turn them on.
- Leave to guides: the five symbols in depth, agents and roster, enforcement levels, the memory stores, MCP tool list, other IDEs, Sentinel, Symphony, University, Workspaces, Brain.

**Gnomon**
- Above the fold: "one place to approve what your Claude Code sessions do"; a picture of a card on the decision stack; `gnomon`; the four hard requirements as a preflight (Apple silicon and macOS 15, native-installer Claude Code on a subscription, Touch ID or password, Node 24); the known limitation from `README.md:69` stated plainly.
- Leave to guides: kernel and mods architecture, the hash-chained log, budget fuse, voice, local models, loops, linking, the dev path.

**Warpline**
- Above the fold: one tagline (the founder must pick among the three in use); `npm i -g @a-company/warpline`; `warpline oracle <A> <B>` with real output; "experimental, read-only instruments work on any git repo today".
- Leave to guides: the fabric, fork/propose/admit/resolve, daemon and tokens, MCP surface, the replacement roadmap and the limits list from `warpline-project-setup.md:149`.

Decisions for the founder before writing starts:
- Which Warpline tagline.
- Which learning story is current (H10).
- Whether `paradigm tutorial` lives.
- Whether shift should default to something above `none` once the first prompt exists.

---
Filed by the orchestrator 2026-11-23 from the Sheila/Nora/Helix audit. Claims re-checked by the orchestrator are listed in `README.md` in this folder.
