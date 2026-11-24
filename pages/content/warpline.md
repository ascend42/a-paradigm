# Warpline — `pages/warpline/index.html`

Copy by Wren. Numbers and sources by Sage. Reading rules are at the top of `hub.md`. This is the shortest page on purpose.

---

## 1. The lead: what it is, and what has and hasn't been tested

**Headline**

Warpline checks a merge by what the code means. It is not yet proven.

[[TBD-FOUNDER: warpline-tagline]] The headline stands in for a tagline the founder has not chosen. It is a plain description.

**What it is, in two sentences**

Warpline is an experimental command-line tool that records what TypeScript code means, symbol by symbol, and compares two changes by meaning instead of by line. When two changes contradict each other on the same symbol it stops and asks a person.

**The problem it is aimed at**

Git merges two branches cleanly because they touch different lines. The result can still be broken, because one side changed what a function means.

**Standing line**

- In progress — {{warpline.version}} on npm, experimental.
- Untested — not yet run end to end with a server, or at scale.
- As of {{warpline.version.measured}}.

**Ledger: what has and hasn't been tested** (stamped from `standing.warpline.ledger`; the first cell of each row carries the strand)

Built
- The command line: init, orient, and the save cycle (fork, propose, admit). — `CHANGELOG.md:10`; `warpline --help`.
- The forecast: `warpline oracle` on two branches of a git repo. — we ran it on this repo on {{warpline.oracle-example.measured}}; the output is in section 3.
- The record, kept on its own protected git branch, with verified adoption on a fresh clone. — `CHANGELOG.md:26` (Warpline 0.3.0).

In progress
- What its flags are worth. Measured on three open-source repos; the numbers are below. — the base-rate study, {{warpline.base-rate.measured}}.
- Languages. {{warpline.lens}}. — the setup guide.
- Whether an agent with no prior knowledge can use it from the shipped guide alone. — the guide shipped in 0.3.1; no result is recorded. [[slot: warpline-cold-agent-result]]

Untested or not built
- Per-codebase calibration. The one test of it failed. — the seeded run, below.
- Defects that cross two symbols. It missed the one in the study. — the reviewer comparison, below.
- The field test we wrote down in advance. — not run; `CHANGELOG.md:686`.
- A full run with a server, end to end. — not run.
- What it looks like at large: many agents, large repositories. — not run.
- A working example on this repo. Our own ledger reads "{{warpline.own-repo}}" since we stopped using Warpline here on 2026-11-09 and moved testing to a separate server. — `warpline health`; commit `96e234ef`.

**What we measured, including what went against it** (fact lines under the ledger)

[[session: warpline-measured-results-form]] These sit as fact lines under a three-state ledger until the founder chooses the form.

{{warpline.base-rate}}
: clean merges in zod, nest and xstate were flagged as changing what the code means.
: Source: `.paradigm/research/warpline-guard-base-rate/results.md`, lines 38 to 47, {{warpline.base-rate.measured}}.

{{warpline.ground-truth.fixed_by_a_human_within_a_day}} of {{warpline.ground-truth.hits}}
: flags were real defects, each fixed by a person within a day. {{warpline.ground-truth.benign}} were harmless. {{warpline.ground-truth.real_break_at_merge}} broke at the merge itself. The TypeScript compiler caught {{warpline.tsc}}.
: Source: `ground-truth.md`, lines 13 to 27, {{warpline.ground-truth.measured}}.

{{warpline.llm-judge}}
: of those defects was caught by a blind LLM reviewer given the same cases. The same reviewer found {{warpline.missed}} real defect that Warpline had passed as clean.
: Source: `.paradigm/research/warpline-llm-judge-falsifier/results.md`, {{warpline.llm-judge.measured}}.

K3: {{warpline.k3}}
: We wrote down in advance a test for the idea that Warpline gets better as it learns one codebase. It failed. In the same seeded run, meaning decided {{warpline.seeded-run}} cases; every one of those cases was planted by us, so that is not a rate you should expect in the wild.
: Source: `.paradigm/research/warpline-dogfood/run-results-full.md`, {{warpline.k3.measured}}.

**Closing line of the lead**

The thresholds were written before each run, and the results are printed here whichever way they went. That method is the proof we have. A win rate is not.

**Prints:** `warpline.version`, `warpline.oracle-example`, `warpline.base-rate`, `warpline.lens`, `warpline.own-repo`, `warpline.ground-truth`, `warpline.tsc`, `warpline.llm-judge`, `warpline.missed`, `warpline.k3`, `warpline.seeded-run`, `warpline.field-test`, `warpline.server-run`. Standing rows: `standing.warpline.line`, `standing.warpline.ledger`.

---

## 2. The idea in one plate

**Headline**

Two branches, and one place git cannot see.

**Three sentences** (beside the plate: two threads, amber and teal, and one violet knot)

Each branch is a thread. Git compares the threads line by line, so two changes on different lines pass. Warpline compares what each symbol means on both threads, and where the two meanings contradict it ties a knot and waits for a person.

**Prints:** none.

---

## 3. Try the forecast, knowing the above

**Headline**

Try the forecast on your own branches.

**Body**

The oracle predicts a merge from meaning, runs git's real merge, and scores where the two agree. It does not change your branches, your files or your git history. It does create a `{{warpline.oracle-writes}}` folder in the repo to keep its record, so expect one new untracked folder.

```
npm i -g @a-company/warpline
warpline oracle <branchA> <branchB>
```

**Real output** (two branches of this repo; copied by the build from `pages/captures/warpline-oracle.txt`)

```
ORACLE  origin/fix/onboarding-truth  vs  origin/feat/gnomon-boards-s1.0

MERGE   CLEAN ✓   (no knots, no dangling, git merges clean)

PREDICTION (from meaning):
  autoClean 107
  knots     0
  dangling  0

GIT REALITY: clean  (0 path(s), 0 symbol(s))

  agreeClean          107
  score               1
  VERDICT             CONVERGENT
```

Caption: An agreement, not a catch. Warpline predicted a clean merge across {{warpline.oracle-example.autoClean}} symbols and git agreed. It took {{warpline.oracle-example.wall_time}} on this repo, on one Mac. We show it so you know the shape of the answer. [[slot: warpline-catch-example]]

**What to expect**

It reads TypeScript only. On most pairs of branches it will agree with git. In our study it disagreed on {{warpline.base-rate}} clean merges, and most of those disagreements were harmless.

**Prints:** `warpline.oracle-writes`, `warpline.oracle-example`, `warpline.base-rate`, `warpline.ground-truth`. Excerpt: `warpline.oracle`.

---

## 4. The way back

**Headline**

Read the rest in the repository.

**Links** (each with one line)

- The repository — the package and its tests.
- The setup guide, `docs/guides/warpline-project-setup.md` — how to put a project on Warpline, and its limits in full.
- The changelog — what each release changed.
- The studies, `.paradigm/research/warpline-guard-base-rate/` — the method, the scripts and the raw results.

Links: Next — Learn. Start the path.

**Prints:** none.
