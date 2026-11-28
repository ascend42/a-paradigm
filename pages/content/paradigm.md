# Paradigm — `pages/paradigm/index.html`

Copy by Wren. Numbers and sources by Sage. Reading rules are at the top of `hub.md`.

---

## 1. Hero

**Headline**

Your code, written down where agents answer to it.

Alternate, if the founder wants the number first: "{{paradigm.tools-default}} tools. A test fails the build past {{paradigm.tools-budget.tools}}."

**What it is, in two sentences**

Paradigm keeps a typed map of your codebase in plain YAML files next to the code, and agents read it through MCP tools instead of guessing. Hooks can stop a session that changed code and left the map behind.

**The one plain line**

Those checks are off until you turn them on. The default level is `{{paradigm.enforcement-default}}`.

[[TBD-FOUNDER: default-enforcement]]

**Standing line**

- Built — the symbol map, the hooks, the MCP server. {{paradigm.version}} on npm.
- Untested — whether what agents learn improves their work. No outcome data yet.
- As of {{paradigm.learning-liveness.measured}}. Source: `paradigm doctor` on this repo.

**Install**

```
npm install -g @a-company/paradigm
```

**Then say to your agent**

```
Map this codebase with Paradigm: draft .purpose files for the main directories, then tell me what would be affected if I changed <a module you know>.
```

Link: Start the path.

**Plate** (a real slice of this repo's symbol graph, from `packages/paradigm/.purpose`)

Caption: `#init-handler` sits in two features. That is the question `paradigm ripple '#init-handler'` answers: {{paradigm.ripple-example}} direct dependents, `#shift-command` and `#init-command`. The edges are the file's. The layout is drawn.

**Prints:** `paradigm.tools-default`, `paradigm.tools-budget`, `paradigm.enforcement-default`, `paradigm.version`, `paradigm.learning-liveness`, `paradigm.ripple-example`. Excerpt: `paradigm.init-command`.

---

## 2. Three things it holds an agent to

**Headline**

Three things it holds an agent to.

**The problem it removes** (one paragraph above the rows)

An agent changes the code. The description of that code, its auth gate and the record of why all stay as they were. The next session starts from a picture that is no longer true, and nothing tells it so.

**Rows** (each ends in a link to its proof)

Structure
: Each part of your code is described in a `.purpose` file beside it: its components, flows and signals. Authorization gates live in `portal.yaml`. The agent asks the map what exists and what a change touches. On our own repo that map holds {{paradigm.symbols-total}} symbols.
: Proof: `paradigm status`, section 3.

Determinism
: Hooks are shell scripts that run at fixed points in a session. They are not instructions an agent can skip. With enforcement on, the Stop hook blocks a session when code changed and its `.purpose` file did not. It is off by default, and you choose the level: {{paradigm.enforcement-levels}}.
: Proof: `packages/paradigm/src/core/enforcement/loader.ts`, line 21.

Calibration
: A new learning is designed to be proposed, tested against scenarios and signed off before it reaches an agent's notebook. Since 8.1.1 it counts as survived only after {{paradigm.learning-gate}}. That is the design. We have no outcome data: on our own repo, `paradigm doctor` reads "{{paradigm.learning-liveness}}".
: Proof: `paradigm doctor`, {{paradigm.learning-liveness.measured}}.

[[TBD-FOUNDER: learning-story]] The Calibration row describes the gate as the design and takes no side on automatic promotion.

**Prints:** `paradigm.symbols-total`, `paradigm.enforcement-levels`, `paradigm.learning-gate`, `paradigm.learning-liveness`.

---

## 3. What has been measured, and what hasn't

**Headline**

What has been measured, and what hasn't.

**The strongest proof** (leads the section)

Sub-headline: The tool list has a budget, and a test holds it.

Every MCP tool costs the agent context before it does any work. Paradigm lists {{paradigm.tools-default}} tools by default, about {{paradigm.tools-tokens}} tokens on this repo. Before 7.13.0 it listed about {{paradigm.tools-before.tools}}, at about {{paradigm.tools-before.tokens}} tokens. A test fails the build above {{paradigm.tools-budget.tools}} tools or {{paradigm.tools-budget.tokens}} tokens, so the list cannot quietly grow back. You can run it in a couple of seconds:

```
cd packages/paradigm-mcp && npx vitest run src/tools/tools-list-budget.test.ts --reporter=verbose
```

```
[tools-list-budget] repo default: 32 tools, ~7793 tokens
 Test Files  1 passed (1)
      Tests  15 passed (15)
```

Source line: real output, `pages/captures/mcp-budget-test.txt`, run {{paradigm.budget-test.measured}}. Tokens are estimated as length divided by four, not counted by a tokenizer. The "before" figure is the changelog's ({{paradigm.tools-before.measured}}), not re-measured.

**Fact lines** (three; a fourth is a slot)

{{paradigm.symbols-total}} symbols
: indexed in Paradigm's own repository, from {{paradigm.purpose-files}} `.purpose` files: {{paradigm.symbols-breakdown.components}} components, {{paradigm.symbols-breakdown.flows}} flows, {{paradigm.symbols-breakdown.gates}} gates, {{paradigm.symbols-breakdown.signals}} signals and {{paradigm.symbols-breakdown.aspects}} aspects.
: Source: `paradigm status`, run {{paradigm.symbols-total.measured}}. The count moves with every change, so the build stamps it.

{{paradigm.tools-default}} MCP tools
: listed by default. {{paradigm.tools-on-demand}} more load only when a project turns them on.
: Source: `tools-list-budget.test.ts`, lines 18 to 19; `families.ts`, line 5.

{{paradigm.audit-vulns}} known vulnerabilities
: in a fresh lockfile install of {{paradigm.version}}.
: Source: `npm audit`, run {{paradigm.audit-vulns.measured}}. A new advisory can change this on any day, which is why the date is printed.

[[slot: paradigm-stop-hook-blocks]] How often the Stop hook blocked a session that left its description behind. We have no count. The section runs with three lines.

**Before and after** (the one paired study in the repo)

Sub-headline: Our only A/B study found no difference in results, and more tool calls with Paradigm.

- Without Paradigm: {{paradigm.study-tool-calls.without}} tool calls.
- With Paradigm: about {{paradigm.study-tool-calls.with}} tool calls.

Caption: Same task, both variants passed {{paradigm.study-outcomes}} tests. File reads went the other way: {{paradigm.study-file-reads.without}} without, {{paradigm.study-file-reads.with}} with. The study is from {{paradigm.study-tool-calls.measured}}, on Paradigm v2, a 15-file project, one run each. It calls itself underpowered, and we have not run a larger one. So we make no claim that Paradigm saves tokens or time. We claim the map and the checks, which you can inspect.

Source: `case-study/compare.md`, lines 12 and 40.

**Proof excerpt:** `packages/paradigm/.purpose`, lines 29 to 39 (real file, copied by the build).

**No chart.** [[slot: step-chart]] The repo holds no series of five or more dated measurements taken the same way.

**Prints:** `paradigm.tools-default`, `paradigm.tools-tokens`, `paradigm.tools-before`, `paradigm.tools-budget`, `paradigm.budget-test`, `paradigm.tools-on-demand`, `paradigm.symbols-total`, `paradigm.symbols-breakdown`, `paradigm.purpose-files`, `paradigm.audit-vulns`, `paradigm.version`, `paradigm.study-tool-calls`, `paradigm.study-outcomes`, `paradigm.study-file-reads`. Excerpts: `paradigm.budget-test`, `paradigm.init-command`, `paradigm.study`.

---

## 4. One session, start to finish

**Headline**

One session, start to finish.

**Rows** (four, numbered; each with a short proof excerpt)

1. Ask the map
: Before the change, the agent asks what it touches. This is a real answer from this repo.

```
$ paradigm ripple '#init-handler'

  Type:        component
  Description: Handles paradigm init command logic

  Components:  #shift-command, #init-command

  Direct dependents: 2
  Impact level:      Medium
```

: Source: `pages/captures/paradigm-ripple.txt`, run {{paradigm.ripple-example.measured}}; the build copies the capture, shortened to these lines. We also print what it got wrong: until 7.15.0, ripple could report {{paradigm.ripple-false-safe}} for a gate that was in use (`CHANGELOG.md:347`).

2. Change the code
: The agent makes the change and updates the `.purpose` file in the same edit. The index picks it up on commit, or on demand:

```
paradigm reindex
```

: [[depends: paradigm-reindex]] This command arrives with a companion branch. It is not in {{paradigm.version}}.

3. The hook checks
: When the session tries to stop, the Stop hook compares what changed with what was described. With enforcement on and a `.purpose` file left behind, the session is blocked until the agent fixes it. With the default level, nothing is checked. The hook takes {{paradigm.stop-hook-fix}}.
: Excerpt: `packages/paradigm/src/core/enforcement/loader.ts`, line 21 (`const DEFAULT_LEVEL: EnforcementLevel = 'none';`).
: [[slot: paradigm-session-block-output]] We have not captured a real block message for this page. Until we do, the row describes it in words.

4. The record is written
: The reason for a choice goes into a decision file. What happened goes into a lore entry. Both live in the repo, so the next session can read them. This repo holds {{paradigm.decisions}} decisions and {{paradigm.lore}} lore entries.
: [[slot: paradigm-supersession-example]] The decision format has fields for one decision replacing another. {{paradigm.supersession}} files in this repo use them, so we show no example of it.

**Prints:** `paradigm.ripple-example`, `paradigm.ripple-false-safe`, `paradigm.version`, `paradigm.stop-hook-fix`, `paradigm.decisions`, `paradigm.lore`, `paradigm.supersession`. Excerpts: `paradigm.ripple-answer`, `paradigm.enforcement-default`.

---

## 5. Lately

**Headline**

What changed lately.

**Lead fact line**

{{paradigm.npm-versions}} versions published on npm. Source: `npm view @a-company/paradigm versions`, {{paradigm.npm-versions.measured}}.

**Rows** (the release's own lead sentence, stamped from `CHANGELOG.md`; a standing mark where a release moved something)

- {{lately.paradigm[0].date}} · {{lately.paradigm[0].version}} — "{{lately.paradigm[0].lead}}"
- {{lately.paradigm[1].date}} · {{lately.paradigm[1].version}} — "{{lately.paradigm[1].lead}}"
- {{lately.paradigm[2].date}} · {{lately.paradigm[2].version}} — "{{lately.paradigm[2].lead}}" Mark: gated learning, design to in progress.
- {{lately.paradigm[3].date}} · {{lately.paradigm[3].version}} — "{{lately.paradigm[3].lead}}" Mark: clean audit, in progress to built.
- {{lately.paradigm[4].date}} · {{lately.paradigm[4].version}} — "{{lately.paradigm[4].lead}}" Mark: hooks, in progress to built.

**Closing line**

Most of these releases made Paradigm more honest about itself: hooks that finish, read-only commands that write nothing, learning that needs evidence. One of them, {{paradigm.security-fixes}}, {{paradigm.security-fixes.claim}}

**Prints:** `paradigm.npm-versions`, `lately.paradigm[0..4]`, `paradigm.security-fixes`. Capture: `pages/captures/lately.txt`.

---

## 6. Where it stands

**Headline**

Where it stands.

**Intro line**

Every row has its evidence. Built rows and untested rows sit in one list on purpose.

**Ledger** (stamped from `standing.paradigm.ledger` in `facts.json`; the build prints `what` and `evidence` for each row)

Built
- The map: `.purpose` files and `portal.yaml`, indexed into five kinds of symbol. — `paradigm status`: {{paradigm.symbols-total}} symbols.
- The MCP server, with a tool list held under a tested budget. — {{paradigm.budget-test}} tests pass, run {{paradigm.budget-test.measured}}.
- Impact analysis: `paradigm ripple` and its MCP tool. — real answer above; a false "safe" was fixed in 7.15.0.
- Hooks and enforcement levels. Off by default. — `loader.ts:21`; `CHANGELOG.md:311`.
- Decisions and lore kept in the repo. — {{paradigm.decisions}} decisions, {{paradigm.lore}} lore entries.
- A clean dependency audit on install. — `npm audit`, {{paradigm.audit-vulns.measured}}.

In progress
- Looking up the gates for a route. The tool returns an {{paradigm.gates-for-route}} today. — `CHANGELOG.md:301`; the task is open.
- Gated learning. The rules are built; nothing has passed through them on this repo. — `CHANGELOG.md:51`; `paradigm doctor`.
- Paradigm on its own repo: {{paradigm.purpose-coverage}}. `paradigm doctor` also finds {{paradigm.own-repo-findings.dead_path_references}} dead path references and {{paradigm.own-repo-findings.isolated_symbols}} isolated symbols here. — `paradigm doctor`, {{paradigm.purpose-coverage.measured}}.
- CI for the CLI and MCP test suites. The general workflows are disabled on GitHub. — `gh workflow list --all`.
- A CLI command to rebuild the index. — [[depends: paradigm-reindex]]

Untested or not built
- Whether Paradigm saves tokens or improves results in use. — the one paired study, section 3.
- Whether what agents learn improves their work. — `paradigm doctor`: "{{paradigm.learning-liveness}}".
- Token estimates rebuilt from measured use. `paradigm calibrate` exists; this repo has no data for it. — the evidence dossier.
- Decisions that replace earlier ones, as structured records. — {{paradigm.supersession}} files use the fields.
- Releases you can rebuild from a git tag. — {{paradigm.git-tags}} tags.

**Limits**

- Checks are off until you set a level.
- The hooks run in Claude Code and Cursor sessions.
- Keeping `.purpose` files current is work the agent does on every change. We have not measured what it costs.
- Almost every commit so far is by one person.

**Requirements**

- Node 24 or later.
- Claude Code or Cursor for the hooks. The plugin is for Claude Code.

**Prints:** `paradigm.symbols-total`, `paradigm.budget-test`, `paradigm.decisions`, `paradigm.lore`, `paradigm.audit-vulns`, `paradigm.gates-for-route`, `paradigm.purpose-coverage`, `paradigm.own-repo-findings`, `paradigm.ci`, `paradigm.learning-liveness`, `paradigm.calibration-data`, `paradigm.supersession`, `paradigm.git-tags`. Standing rows: `standing.paradigm.ledger`.

---

## 7. Start

**Headline**

The first thing to do.

**Steps**

1. Install the CLI.

```
npm install -g @a-company/paradigm
```

2. In a real project of yours, set it up. One command.

```
paradigm shift
```

3. In Claude Code, add the plugin.

```
/plugin marketplace add ascend42/a-paradigm
/plugin install paradigm@a-paradigm
```

4. Say this to your agent, naming a module you know well.

```
Map this codebase with Paradigm: draft .purpose files for the main directories, then tell me what would be affected if I changed <a module you know>.
```

**What you should see**

An answer that names files you recognise. If it does, the map is working, and level 1 of the path is next. If it does not, run `paradigm doctor` and read what it says.

**One caution, said now**

Run `paradigm shift` on a branch the first time. It writes new files into your repo and regenerates instruction files such as `CLAUDE.md`. Read the diff before you commit.

**Closing line**

When you want the checks, turn them on: `paradigm enforcement set balanced`. Level 2 of the path walks through it.

Links: Next — Gnomon. Start the path.

**Prints:** none.

Note for the build: the caution about `CLAUDE.md` rests on a code reading in the teaching audit (H3: `shift.ts:750`, `ide-adapters/index.ts:308-322`), not on a run. The wording is kept to what the code path shows: shift regenerates the file. We do not say what is preserved.
