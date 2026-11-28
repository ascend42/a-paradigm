# Learn — `pages/learn/index.html`

Copy by Wren. Numbers and sources by Sage. Reading rules are at the top of `hub.md`. The levels are the teaching audit's, unchanged. Practice numbers (P1 to P13) are the audit's order.

---

## Lead

**Headline**

Four levels. One exercise each, on your own repo.

**Lede**

This is a path, not a course. Every level ends with something you can see in your own code. Most exercises are a sentence you say to your agent, because that is how Paradigm is used: you ask, the agent does the bookkeeping, and the checks hold it to that.

**Line under the lede**

The times are our estimates. Nobody has timed them yet. [[slot: level-times]]

**Why it is not a course**

We built a course first. It recorded {{learn.university-usage}}. So the path lives here, in the open, and the quizzes are optional.

**Prints:** `learn.university-usage`.

---

## Station 0 — See it

**Closed state:** 0 · See it · {{learn.level0-time}} (estimate) · You get an impact answer on your own code, from the first prompt.

**After this,** you have asked "what does this change touch?" about a module you know, and judged the answer yourself.

**The exercise**

Install, set up a real project of yours, and add the plugin in Claude Code:

```
npm install -g @a-company/paradigm
paradigm shift
```

```
/plugin marketplace add ascend42/a-paradigm
/plugin install paradigm@a-paradigm
```

Then say to your agent:

```
Map this codebase with Paradigm: draft .purpose files for the main directories, then tell me what would be affected if I changed <a module you know>.
```

**You should see**

An answer that names files and components you recognise. This is the same question asked of Paradigm's own repo, from the command line (real output):

```
$ paradigm ripple '#init-handler'

  Components:  #shift-command, #init-command

  Direct dependents: 2
  Impact level:      Medium
```

If the answer on your code is wrong or empty, that is worth knowing after ten minutes and not after a week. Run `paradigm doctor` and read what it says.

**The practice that belongs here: P1**

- Do: have the agent map the code before you ask it to change the code.
- Instead of: asking for a change and letting the agent find its own way through the files.
- Why: the agent can only ask the map what a change touches once the map exists.

**Good to know before you start**

Run `paradigm shift` on a branch. It writes new files and regenerates instruction files such as `CLAUDE.md`. Read the diff before you commit.

**Full guide:** `docs/guides/quick-start.md`

**Prints:** `learn.level0-time`, `paradigm.ripple-example`. Excerpt: `paradigm.ripple-answer`.

---

## Station 1 — Work with it

**Closed state:** 1 · Work with it · day 1 · You ship one small change with its `.purpose` kept current and a `Symbols:` trailer.

**After this,** you can read a `.purpose` file and a `portal.yaml`, and you know what the agent maintains for you and what is not enforced yet.

**The exercise**

Pick a small, real change. Say to your agent:

```
Make this change: <your change>. Update the .purpose file for the code you touch in the same change. Then show me the .purpose diff and commit with a Symbols: trailer.
```

Read the `.purpose` diff yourself. It is short. That is the point of this level: you learn the five kinds of symbol by reading them, not by memorising them.

**You should see**

A commit whose subject names its main symbol and whose last line lists every symbol it touched. A real one from this repo:

```
feat(#fabric-mirror): Warpline 0.3.0 records the ledger on a protected branch; release 8.1.2 (#96)

Symbols: #fabric-mirror, #fabric-mirror-sync, #fabric-writer, #fabric-adopt, #mirror-audit, #git-run, #fabric-lock, #fabric-verify, #hook, #release
```

Source: `pages/captures/commit-trailer.txt`. That commit also changed two `.purpose` files.

If the map looks out of date afterwards, rebuild the index: `paradigm reindex`. [[depends: paradigm-reindex]]

**The practice that belongs here: P4**

- Do: let the agent update `.purpose` in the same change as the code.
- Instead of: a tidy-up pass afterwards.
- Why: once you turn the checks on at `balanced`, a `.purpose` file left behind is what blocks the session.

**What is not enforced yet**

Nothing. At this level every check is still off. You are relying on the agent following its instructions. Level 2 changes that.

[[TBD-FOUNDER: tutorial]] The built-in `paradigm tutorial` is not part of this station.

**Full guide:** `docs/guides/quick-start.md`

**Prints:** none. Excerpt: `pages/captures/commit-trailer.txt`.

---

## Station 2 — Trust it

**Closed state:** 2 · Trust it · week 1 · You choose an enforcement level, trigger a block on purpose, and clear it.

**After this,** the checks are on because you turned them on, and you have seen one stop a session.

**The exercise**

Turn the checks on, and look at what you chose:

```
paradigm enforcement set balanced
paradigm enforcement status
```

Then trigger a block on purpose. Say to your agent:

```
Change one source file in <a directory with a .purpose file>, and do not update the .purpose file. Then stop.
```

**You should see**

The session refuses to stop, and says which description was left behind. Now say "update the .purpose file", and it stops cleanly. [[slot: paradigm-session-block-output]] We have not captured a real block message for this page, so there is no excerpt here yet.

`paradigm enforcement status` prints a table of checks. At `balanced`, `{{paradigm.enforcement-balanced-blocks}}` is set to block and most others warn.

**The practice that belongs here: P3**

- Do: turn enforcement on deliberately, and pick the level.
- Instead of: assuming the hooks are already checking.
- Why: the default level is `{{paradigm.enforcement-default}}`.

[[TBD-FOUNDER: default-enforcement]]

**Also at this level:** P2 (ask what a change affects), P5 (gates before endpoints), P6 (decisions and lore as you go), P8 (the team for larger work). All are below.

**Full guides:** `docs/guides/v6-migration.md`, section 11, explains the default. `docs/guides/decisions.md`, sections 1 to 5.

**Prints:** `paradigm.enforcement-balanced-blocks`, `paradigm.enforcement-default`.

---

## Station 3 — Compound it

**Closed state:** 3 · Compound it · month 1 · You teach one agent one rule, gate it, and see it applied.

**After this,** one thing you know about your codebase is written where an agent will read it next time, and you signed it off.

**Read this first**

This is the least proven level. The rules for gated learning are built. We have no evidence yet that what agents learn improves their work: on our own repo the loop reads "{{paradigm.learning-liveness}}". The class skill is still marked as a draft. Treat this level as a way to write down rules you already trust, with a gate in front of them.

[[TBD-FOUNDER: learning-story]]

**The exercise**

Pick one rule you keep repeating to your agent. In Claude Code, say:

```
/paradigm:teach
```

and give it the rule and the agent it is for. Then hold a class term, where the rule is tested before it is kept:

```
/paradigm:class
```

**You should see**

A notebook entry for that agent, carrying your rule, that you approved. In a later session, the agent applies it without being told. [[slot: learn-you-should-see]]

**The practice that belongs here: P9**

- Do: treat what an agent learned as provisional until you sign it off.
- Instead of: trusting a learning because it was recorded.
- Why: since 8.1.1 a learning counts as survived only after {{paradigm.learning-gate}}.

**Also at this level:** P7 (a small roster), P10 (protocols), P11 (regenerate, don't hand-edit), P12 (typed stores), P13 (doctor after upgrades).

**Full guides:** `docs/guides/agents.md`, `docs/guides/learning-scopes.md`

**Prints:** `paradigm.learning-liveness`, `paradigm.learning-gate`.

---

## Track G — Gnomon (a spur after station 0)

**Closed state:** G · Gnomon · {{learn.gnomon-time}} (estimate), then ongoing · You approve your first card on the stack.

**After this,** your sessions ask in one place and your answers are signed.

**Before you start**

All four must hold, or Gnomon refuses: {{gnomon.requirements}}.

**The exercise**

In a repo:

```
gnomon
```

The first run sets up your Mac and asks for Touch ID or your password {{gnomon.setup-prompts}} times. Start a session and ask it to do something that needs permission.

**You should see**

A card on the decision stack. Approve it with Touch ID or your password. [[slot: learn-you-should-see]]

**Practice for this track** (not one of the thirteen)

- Do: read each card before you approve it.
- Instead of: making "Always allow" rules early to quiet the stack.
- Why: Gnomon shows spending and does not cap it, so the cards are the control you have.

**Full guide:** the Gnomon page; `packages/gnomon/README.md`

**Prints:** `learn.gnomon-time`, `gnomon.requirements`, `gnomon.setup-prompts`, `gnomon.spend`.

---

## Track W — Warpline (a spur after station 0)

**Closed state:** W · Warpline · {{learn.warpline-time}} (estimate), then ongoing · You run a merge forecast on two of your own branches.

**After this,** you have seen what Warpline says about a real merge of yours, and you know it is experimental.

**The exercise**

In a TypeScript repo with two branches:

```
npm i -g @a-company/warpline
warpline oracle <branchA> <branchB>
```

**You should see**

A prediction, git's real result, and a verdict on whether they agree. On two branches of this repo (real output):

```
PREDICTION (from meaning):
  autoClean 107
  knots     0
  dangling  0

GIT REALITY: clean  (0 path(s), 0 symbol(s))

  VERDICT             CONVERGENT
```

That run took {{warpline.oracle-example.wall_time}}. The oracle does not change your branches or files. It does leave a `{{warpline.oracle-writes}}` folder in the repo.

**Practice for this track** (not one of the thirteen)

- Do: treat a flag as a reason to look.
- Instead of: treating it as a verdict.
- Why: in our study, {{warpline.ground-truth.fixed_by_a_human_within_a_day}} of {{warpline.ground-truth.hits}} flags were real defects and {{warpline.ground-truth.benign}} were harmless.

**Full guide:** the Warpline page; `docs/guides/warpline-project-setup.md`

**Prints:** `learn.warpline-time`, `warpline.oracle-example`, `warpline.oracle-writes`, `warpline.ground-truth`. Excerpt: `warpline.oracle`.

---

## The thirteen practices

**Headline**

Thirteen practices, each with its reason.

**Intro line**

Do, instead of, and why. Where the reason is measured, the measurement is named. Where it is our guidance and nothing more, we say that.

**P1. Map first.** (Level 0)
- Do: have the agent map the code before you ask it to change the code.
- Instead of: asking for a change and letting the agent read its way in.
- Why: impact questions only work on mapped code. On our repo, `paradigm ripple '#init-handler'` names its {{paradigm.ripple-example}} dependents at once.
- Evidence: `pages/captures/paradigm-ripple.txt`. Not measured: any saving in tokens or time. Our one study found fewer file reads and more tool calls with Paradigm.

**P2. Ask what it affects before a change that is not trivial.** (Level 2)
- Do: say "what does this affect?" before the change.
- Instead of: finding out from a failing test.
- Why: the instructions Paradigm generates for your agent ask for it before each task, and there is a skill for it, `/paradigm:ripple`.
- Evidence: `packages/paradigm/src/core/ide-adapters/claude.ts:110`. A caution we owe you: until 7.15.0, ripple could report {{paradigm.ripple-false-safe}} for a gate in use. Update before you rely on it.

**P3. Turn enforcement on deliberately.** (Level 2)
- Do: choose a level with `paradigm enforcement set`.
- Instead of: assuming the Stop hook already blocks.
- Why: the default is `{{paradigm.enforcement-default}}`. Our own migration guide calls that default the "largest silent behavioral change in v6.x".
- Evidence: `packages/paradigm/src/core/enforcement/loader.ts:21`; `docs/guides/v6-migration.md:337-341`.

**P4. Keep `.purpose` current in the same change.** (Level 1)
- Do: have the agent update `.purpose` with the code.
- Instead of: a catch-up pass later.
- Why: at `balanced`, `{{paradigm.enforcement-balanced-blocks}}` is the check that blocks.
- Evidence: `paradigm enforcement status`, run {{paradigm.enforcement-balanced-blocks.measured}}.

**P5. Declare gates in `portal.yaml` before adding an endpoint.** (Level 2)
- Do: write the gate, then the route.
- Instead of: adding auth checks in code and documenting them afterwards.
- Why: the gate file is the record of who may do what. A `portal.yaml` that cannot be parsed now fails closed; before that fix, our migration guide calls it "a documented auth-bypass".
- Evidence: `docs/guides/v6-migration.md:113-120`. A limit we owe you: the tool that looks up the gates for a route returns an {{paradigm.gates-for-route}} today, so have the agent read `portal.yaml` itself.

**P6. Record the why as a decision and what happened as lore, as you go.** (Level 2)
- Do: ask the agent to record a decision when a choice is made, and lore when the work is done.
- Instead of: reconstructing it at the end of the week.
- Why: the next session reads these. This repo holds {{paradigm.decisions}} decisions and {{paradigm.lore}} lore entries.
- Evidence: `docs/guides/decisions.md`, section 3; the `lore-required` check.

**P7. Keep the roster small: three or four agents for a task.** (Level 3)
- Do: bench the agents you do not need, with `paradigm agent bench <id>`.
- Instead of: keeping all {{paradigm.agents-bundled}} bundled profiles active.
- Why: our guidance is that past five the cost outweighs the value.
- Evidence: `docs/guides/agents.md:79`. This is guidance from our own use. It has not been measured.

**P8. Use the team for work across three or more files, and say so when you go solo.** (Level 2)
- Do: let the agent plan larger work with the team, or declare a solo session with `paradigm solo <reason>`.
- Instead of: skipping the team without a record.
- Why: there is a check for it, `orchestration-required`, with a threshold of three files.
- Evidence: `paradigm enforcement status` on this repo ("Orchestration threshold: 3 files").

**P9. Treat what agents learn as provisional until you sign it off.** (Level 3)
- Do: review learnings in a class term.
- Instead of: trusting the automatic loop alone.
- Why: on our own repo the loop reads "{{paradigm.learning-liveness}}". It cannot be relied on by itself.
- Evidence: `paradigm doctor`, {{paradigm.learning-liveness.measured}}.

**P10. Check for a protocol before repeating a pattern, and record one after.** (Level 3)
- Do: ask "is there a protocol for this?" first. There is a skill, `/paradigm:protocol`.
- Instead of: solving the same pattern a second way.
- Why: it is step zero in the instructions Paradigm generates for your agent. This repo has {{paradigm.protocols}} recorded.
- Evidence: `packages/paradigm/src/core/ide-adapters/claude.ts:118`; `ls .paradigm/protocols`.

**P11. Regenerate instruction files with `paradigm sync`. Do not hand-edit them.** (Level 3)
- Do: change the source, then run `paradigm sync`.
- Instead of: editing the generated `CLAUDE.md` directly.
- Why: the next sync rewrites the file, and your edit is gone.
- Evidence: `packages/paradigm/src/core/ide-adapters/index.ts:308-322`.

**P12. Put durable facts in the typed store, not in the agent's native memory.** (Level 3)
- Do: what happened goes to lore, a rule to habits, a reason to a decision.
- Instead of: letting everything pile up in one memory file.
- Why: typed records can be found and checked. `paradigm memory review` flags what has piled up.
- Evidence: `packages/paradigm/src/core/ide-adapters/claude.ts:157-169`.

**P13. Run `paradigm doctor` after every upgrade.** (Level 3)
- Do: upgrade, then `paradigm doctor`.
- Instead of: assuming an upgrade migrated everything.
- Why: on our own repo, doctor found {{paradigm.own-repo-findings.dead_path_references}} dead path references and a list of tool names in permission files that no longer match a tool.
- Evidence: `paradigm doctor`, {{paradigm.own-repo-findings.measured}}; `pages/captures/paradigm-doctor.txt`.

**Prints:** `paradigm.ripple-example`, `paradigm.ripple-false-safe`, `paradigm.enforcement-default`, `paradigm.enforcement-balanced-blocks`, `paradigm.gates-for-route`, `paradigm.decisions`, `paradigm.lore`, `paradigm.agents-bundled`, `paradigm.learning-liveness`, `paradigm.protocols`, `paradigm.own-repo-findings`, `paradigm.study-file-reads`, `paradigm.study-tool-calls`.

---

## Field card (prints on one sheet)

**Title:** Paradigm, on one page.

**The first prompt**

```
Map this codebase with Paradigm: draft .purpose files for the main directories, then tell me what would be affected if I changed <a module you know>.
```

**Commands**

```
npm install -g @a-company/paradigm
paradigm shift
paradigm status
paradigm ripple '#<symbol>'
paradigm enforcement set balanced
paradigm enforcement status
paradigm sync
paradigm doctor
paradigm solo <reason>
gnomon
warpline oracle <branchA> <branchB>
```

**The thirteen, as pairs**

1. Map first, then change.
2. Ask what it affects, before the change.
3. Turn enforcement on. It starts off.
4. `.purpose` in the same change.
5. Gate first, then the endpoint.
6. Decision for the why, lore for what happened.
7. Three or four agents, not all of them.
8. Team for three files or more. Say so when solo.
9. A learning is provisional until you sign it.
10. Look for a protocol first. Record one after.
11. `paradigm sync`. Do not hand-edit generated files.
12. Typed stores, not one memory file.
13. `paradigm doctor` after every upgrade.

**Foot of the card:** Checks are off until you turn them on. Facts last stamped {{as_of}}.

**Prints:** `as_of`.
