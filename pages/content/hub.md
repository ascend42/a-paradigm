# Hub — `pages/index.html`

Copy by Wren. Numbers and sources by Sage. Section order follows `DIRECTION.md`.

How to read this file (the same rules hold for all five content files):

- `{{some.fact-id}}` is a value stamped from `pages/facts.json`. No number is typed into prose. Counting words for structure ("five kinds of symbol", "three products") are plain words.
- Every section lists the fact ids it **prints**. The source line under a fact comes from the fact's `source` and `measured` fields.
- `[[TBD-FOUNDER: id]]` marks a deferred founder decision. The page shows the working default; the marker is a comment for the build, never visible text.
- `[[slot: id]]` marks evidence we do not have. The slot is listed in `facts.json` under `placeholders`. A page does not ship with a visible slot; the fallback is written beside each one.
- Text in a code block is either a command that exists in the current CLI or real captured output from `pages/captures/`.

---

## 1. First screen

**Headline**

A map of your code that agents can be held to.

**Lede**

Paradigm describes each part of a codebase in plain YAML, next to the code. Agents read that map through MCP tools, and hooks can block a session that changes code and leaves the description behind. The checks are off until you turn them on.

[[TBD-FOUNDER: default-enforcement]]

**Install**

```
npm install -g @a-company/paradigm
```

Key: Copy. Link beside it: Start the path.

**The three products, as an index (not three equal cards)**

Paradigm
: The map and the rules. It describes the code and can check that the description stays true.
: Standing line: Built — {{paradigm.version}} on npm; a fresh install audits at {{paradigm.audit-vulns}} vulnerabilities. Untested — whether what agents learn improves their work.
: As of {{paradigm.audit-vulns.measured}}. Source: `npm audit`; `paradigm doctor`.

Gnomon
: A Mac app for your Claude Code sessions. Every permission, question and plan lands on one stack, and your answer is signed.
: Standing line: Built — signed and notarized app, Apple silicon Macs only. In progress — boards, first slice on a branch. Untested — on any Mac but the one it was built on.
: As of {{gnomon.notarized.measured}}. Source: `spctl` on the npm package; `git log`.

Warpline
: Checks a merge by what the code means, before the merge. Experimental.
: Standing line: In progress — {{warpline.version}} on npm, experimental. Untested — not yet run end to end with a server, or at scale.
: As of {{warpline.version.measured}}. Source: `npm view`; the founder.

[[TBD-FOUNDER: warpline-tagline]] The Warpline line above is a plain description, not a tagline.

Learn
: Four levels. One exercise each, on your own repo. The first takes {{learn.level0-time}} by our estimate; nobody has timed it.

**Proof excerpt** (real file, copied by the build): `packages/paradigm/.purpose`, lines 32 to 39.

Caption: The whole idea is a file like this one, next to the code it describes.

**Prints:** `paradigm.version`, `paradigm.audit-vulns`, `gnomon.notarized`, `gnomon.platform`, `gnomon.boards`, `gnomon.one-machine`, `warpline.version`, `warpline.server-run`, `learn.level0-time`. Excerpt: `paradigm.init-command`.

---

## 2. How the three fit

**Headline**

One line, from your code to your merge.

**Body** (one line drawn across the page; each stop is a link)

Your code
: Where everything starts. Nothing here changes how you write it.

The map — Paradigm
: A `.purpose` file beside the code names its components, flows, gates, signals and aspects. Agents ask the map what a change touches before they make it.

Sessions and decisions — Gnomon
: Gnomon runs the sessions that use the map. It puts each request in front of you and signs what you answered. Mac only.

Merges — Warpline (experimental)
: Warpline asks a different question of the same kind of map: do these two changes mean things that conflict? It is not proven yet.

**Under the line**

`npm install -g @a-company/paradigm` adds the `paradigm` and `gnomon` commands. Warpline's own command is a separate install, `npm i -g @a-company/warpline`. In practice most people will use Paradigm alone, because Gnomon needs an Apple silicon Mac and Warpline is experimental.

**Prints:** none (no numbers). Sources for the build's provenance line: dossier section 7; `CHANGELOG.md:209` and `:231`; `teaching-audit.md:81`.

---

## 3. Lately

**Headline**

The last three releases.

**Body** (dated rows, newest first; each row is the release's own lead sentence, stamped from `CHANGELOG.md`)

- {{lately.paradigm[0].date}} · Paradigm {{lately.paradigm[0].version}}, with Warpline 0.3.1 — "{{lately.paradigm[0].lead}}"
- {{lately.paradigm[1].date}} · Paradigm {{lately.paradigm[1].version}}, with Warpline 0.3.0 — "{{lately.paradigm[1].lead}}"
- {{lately.paradigm[2].date}} · Paradigm {{lately.paradigm[2].version}} — "{{lately.paradigm[2].lead}}" Standing mark: gated learning moved from design to in progress.

**Closing line**

All three are Paradigm releases. Gnomon's latest is {{gnomon.version}}, from {{lately.gnomon[0].date}}; its page has the rows. Releases are not tagged in git yet.

**Prints:** `lately.paradigm[0..2]`, `lately.gnomon[0]`, `gnomon.version`, `paradigm.git-tags`. Capture: `pages/captures/lately.txt`.

Note for the build: DIRECTION asks for the three most recent releases "across the products". The three most recent changelog entries are all Paradigm's, and two of them carried a Warpline release. We print that as it is and do not reach back to make the row set look balanced.

---

## 4. Where everything stands

**Headline**

What works, what is being built, and what nobody has run yet.

**Body** (one standing line per product, each linked to that page's ledger)

Paradigm
: Built: the map, the MCP server, the hooks, a clean install audit.
: In progress: route-to-gate lookup, gated learning, coverage of our own repo ({{paradigm.purpose-coverage}}).
: Untested: whether it saves tokens or improves results in use. The one study we have found the same results with more tool calls.
: Link: the full ledger, with evidence on every row.

Gnomon
: Built: the signed app, the decision stack, the chained log, sandboxed sessions.
: In progress: boards; Windows; {{gnomon.ci-latest}} CI jobs passing on the latest run.
: Untested or not built: a spending cap, loops in the released app, any machine but the founder's.
: Link: the full ledger.

Warpline
: Built: the command line, the forecast, the record on its own git branch.
: In progress: measuring what its flags are worth. On three open-source repos, {{warpline.base-rate}} clean merges were flagged; {{warpline.ground-truth.fixed_by_a_human_within_a_day}} of the {{warpline.ground-truth.hits}} flags were real defects.
: Untested: the field test we wrote down in advance, a run with a server, anything at scale.
: Link: the full ledger.

**Closing line**

We are building all three in the open, and this page is stamped from the same facts file the product pages use. Facts last stamped {{as_of}}.

**Prints:** `paradigm.purpose-coverage`, `paradigm.study-outcomes`, `paradigm.study-tool-calls`, `gnomon.ci-latest`, `warpline.base-rate`, `warpline.ground-truth`, `as_of`. Standing rows: `standing.paradigm.line`, `standing.gnomon.line`, `standing.warpline.line`.

---

## Masthead and footer (shared by all five pages)

Masthead: Overview · Paradigm · Gnomon · Warpline · Learn · Repository ↗ · theme key (Auto, Light, Dark).

Footer: Repository · Changelog · MIT licence · Facts last stamped {{as_of}}.

End of every product page: the next page in the order above, then "Start the path".

404 page: headline "This page is not on the map." Body: "The link may be old. Start from the overview." Link: Overview.
