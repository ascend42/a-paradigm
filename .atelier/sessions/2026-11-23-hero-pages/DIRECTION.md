# Hero pages: design direction (proposal)

Session `2026-11-23-hero-pages`. Luna wrote this on 2026-11-23 while the founder was away, so every choice here is a recommendation the founder can accept or change. The alternatives are in `session.yaml` beside this file. The system is proposed in `.atelier/systems/pages/design-system.yaml`, the thing to look at is `.atelier/systems/pages/specimen-hero.html`, and the engineer's brief is `BUILD-BRIEF.md`. Mika has not vetted any of it yet.

The evidence dossier and the teaching audit (`.paradigm/research/hero-pages/`) were committed while this was being written. The specimen's numbers, the path's levels and the first-screen contents below follow them. Where the README says something the dossier could not back up (the Stop hook blocking by default, learning that improves agents, a budget fuse that caps spending), the pages say what the dossier found instead.

The founder's words this serves: "a set of hero pages that explain paradigm, gnomon, and warpline that will be linked on the github as pages. these should be 'sexy' and very informative to quantify the value prop". Then: "lets just be clear and upfront about things. we're building it and it's time to take it all to the next level in quality and function." And on Warpline: "it's fine if warpline is the most sparse as we haven't even really run a full test of it and how it works with a server and what that even looks like at large."

## The read

A developer arrives from the GitHub repo. They use Claude Code or something like it and are deciding whether this is worth an hour. They should leave knowing what each thing is, what it does for them in numbers, where it honestly stands, and what to do first.

The pages are a printed technical folio: ink on a quiet ground, rules instead of boxes, the real artefact on the page. The appeal comes from three things, in this order: the real thing shown at full fidelity (a slice of the symbol graph, a `.purpose` block, a signed log row, a strand), numbers that each carry their source, and a status the reader can trust.

## What was there, and what is kept

| Existing | Verdict |
|---|---|
| `docs/warpline/index.html`, `system.html`, `pov.html` (July) | Not served and not linked from the new pages. They load Google Fonts, and their claims ("Git is bulletproof. So is Warpline") are ahead of what has been tested. What is kept from them: the two-thread drawing and the rule that violet means only "git is blind here". |
| `docs/warpline-overview.html` (October) | The better source. It is self-contained, and its "Roughly how far is left" section is already in the upfront voice. Its git-to-Warpline mapping can come back later as a section when the page grows. |
| `packages/site` (useparadigm.dev) | Kept as its own product. The pages borrow its one good idea: each of the five symbols owns a hue. They do not borrow its components, which are the pill chips, eyebrow labels and bordered cards the house rule forbids. |
| `.atelier/systems/gnomon` | Gnomon's papercraft and phosphor are used verbatim, inside the Gnomon plate only. |
| `README.md` | The source of the draft copy. Its structure, determinism, calibration order is already the standing position. |

## 1. Page set and information architecture

Five pages and a 404, all static, in `pages/`:

| Page | Path | Length |
|---|---|---|
| Overview (hub) | `pages/index.html` | 4 sections |
| Paradigm | `pages/paradigm/index.html` | 7 sections, the longest |
| Gnomon | `pages/gnomon/index.html` | 7 sections |
| Warpline | `pages/warpline/index.html` | 4 short sections, the shortest |
| Learn | `pages/learn/index.html` | the path |

### What each first screen must establish

- **Hub:** what Paradigm is in one sentence about structure and checks, including that the checks are off until turned on; the three products and how each stands, as an index and not as three equal cards; the install command; one real `.purpose` excerpt, so the idea is seen and not only described.
- **Paradigm:** the map is written next to the code and agents can be held to it; one plain line that checks are off until you turn them on; where it stands; the install command and the first prompt to say to the agent; a real slice of this repo's symbol graph.
- **Gnomon:** every decision from every session lands on one stack and the answer is signed; where it stands, including "Apple silicon Macs only"; the `gnomon` command; the four requirements as a preflight (Apple silicon and macOS 15, native-installer Claude Code on a subscription, Touch ID or password, Node 24); one card and the signed log row it produced.
- **Warpline:** what it is in one sentence, and at once what has and has not been tested, as the ledger. No install command above the ledger.
- **Learn:** four levels and two product tracks, with the first station already open.

### Section order

**Hub**
1. First screen (above).
2. How the three fit: one line drawn across the page, code → the map (Paradigm) → sessions and decisions (Gnomon) → merges (Warpline, experimental), each stop linked.
3. Lately: the three most recent releases across the products.
4. Where everything stands: one standing line per product, each linked to that page's ledger.

**Paradigm**
1. Hero.
2. Three things it holds an agent to: structure, determinism, calibration, as rows. Each row ends in a link to its proof.
3. What has been measured, and what hasn't: up to four fact lines, the one paired study as a before and after (it shows more tool calls with Paradigm, and the page says so), one proof excerpt, and the step chart only if a series ever exists.
4. One session, start to finish: four numbered rows (ask the map, change the code, the hook checks, the record is written), each with a short proof excerpt. This is where a decision that supersedes another is shown.
5. Lately.
6. Where it stands: the standing ledger, limits and requirements.
7. Start: install, `paradigm shift`, the plugin; then the path.

**Gnomon**
1. Hero.
2. What it holds: one stack, signed and chained, spending measured (not capped: the dossier found it meters and does not enforce), as rows.
3. Measured: fact lines; the proof excerpt is a real log row with its hash link and the command that verifies the chain.
4. The desk, drawn: the plate at full width with its four regions named. An illustration built from the real GUI's markup and CSS, said to be drawn.
5. Lately.
6. Where it stands: the ledger and limits (the helper does not yet check its caller; Apple silicon only; loops are off in release builds; the evidence so far is from one machine; needs a Claude subscription, refuses API-key billing).
7. Start: `gnomon`.

**Warpline**
1. Headline, lede and the standing ledger (the whole lead; see the specimen, part 4).
2. The idea in one plate: two branches as threads and one place git cannot see, with three sentences.
3. Try the read-only part, knowing the above: install, then `warpline oracle <A> <B>` on any git repo with two branches, with real captured output.
4. The way back: the repository, the setup guide, the changelog.

**Learn:** see part 3.

### How a reader moves

- The masthead is on every page: Overview, Paradigm, Gnomon, Warpline, Learn, then `Repository ↗` and the theme key. The masthead's rule thickens under the current page.
- Every product page ends with the same two things: the next page in the order above, and the path.
- Every proof excerpt, fact source and standing row links into the repository at a pinned commit. That is the main way back to the repo, and it lands on the file that proves the sentence.
- The footer repeats the repository, the changelog and the licence, and prints the date the facts were last stamped.
- The README gets one line linking to the hub once Pages is live (the builder's change, not part of this session).

## 2. The product pages

### Shared: one frame, three plates

The frame (type, grid, masthead, rows, fact lines, standing) is the same on all five pages and has no accent colour. Each product keeps its identity in two places only: its **plate**, the hero exhibit drawn in the product's own material, and its **device**, one small mark reused wherever that product appears.

| | Device | Plate |
|---|---|---|
| Paradigm | **The sigil.** A symbol's prefix (`#` `$` `^` `!` `~`) in mono, in its hue, on a 4px socket of the same hue. | On the frame's own surface: a real slice of this repo's symbol graph. Nodes are symbol ids, not circles. `#init-handler` sits in two flows, which is the question `paradigm ripple` answers. |
| Gnomon | **The sheet.** A cut-paper sheet with one hard cast shadow by day; outlined, no shadow, at night. It is the only shadow on any page. | Gnomon's own ground, papercraft in light and phosphor in dark: one decision card and the signed, hash-chained log row it produced. |
| Warpline | **The strand.** Two threads, amber and teal, on an ink strip: solid where woven, dashed or cut where not. | Warpline's ink ground in both themes: two branches and one violet knot. Kept small. |

### How quantified value is shown

Four components, in order of preference.

1. **Fact line.** A mono numeral with its unit, one sentence that finishes it, and a source line (how it was measured, where, when). No source, no line. At most four in a run, as rows.
2. **Before and after.** The same task measured twice. Two rows, one unit, one scale from zero, values printed. Shown only when both runs exist and the run record is linked; otherwise the block is left out.
3. **Proof excerpt.** The real file with its path and line numbers, copied by the build and never retyped. This is the component that makes the pages attractive, so each product page has at least two.
4. **Step chart.** The only chart type, and only for one series with five or more dated measurements taken the same way. At most one per page, none on the hub or on Warpline. Until such a series exists there is no chart; nothing is drawn from made-up data.

In the specimen these appear with three real facts from the dossier, the one real paired study, a real excerpt, and one hatched slot that says what evidence would fill it. Slots are an authoring state; the release build refuses to publish a page that still has one.

### How "what's new lately" is shown

A section called Lately: three to five dated rows on a vertical rule, newest first, each the release's own lead sentence from `CHANGELOG.md`, stamped by the build. A row carries a standing mark when that release moved something from one state to another, which is how growth is shown without adjectives. If the dossier supplies a "since" number (for example releases since 8.0), it leads the section as a fact line.

### How honest limits are shown

By the **standing** component, which is new and is the answer to the founder's tone direction.

- Three states: **Built**, **In progress**, **Untested**. Each is a 12px square (filled, split on the diagonal, hollow and dashed) and its word. It reads by shape and word, never by colour, and it is not a pill.
- **Standing line**, product level: in the hero under the lede, one row per state that applies, then an as-of date and the source.
- **Standing ledger**, feature level: one row per feature with its state, what it is and its evidence, ordered built, in progress, untested. It sits after the proof and before the first step, at the same type size as the features.
- On Warpline the ledger is the lead, and its first cell carries the strand, so the device itself shows what is woven and what is loose.

This does not undermine the page because it uses the page's strongest voice (ink, the 4px rule, evidence on every row) rather than small grey print, and because built rows sit in the same list as the untested ones. A reader who sees an untested row with evidence believes the built rows.

## 3. The learning path

It is one vertical line with numbered stations, not a docs index.

- A **station** is one level. Closed, it shows its number, what you will be able to do, and how long it takes. Open, it shows four things and no more: the outcome ("After this, ..."), one exercise (a command to run in your own repo and a "you should see" excerpt), the one practice that belongs to that level as a Do / Instead of pair with its reason, and a link to the full guide in the repo.
- An open station fits one screen. Anything longer belongs in `docs/guides/` and is linked.
- Every station ends in something the reader sees in their own repo. That is what makes it a path.
- Stations are native `details` elements, each with its own anchor. A reader can tick "I saw it"; the tick is kept on their device only, and without script it is simply absent.
- The path ends in a **field card**: every practice pair and every command on one printable sheet.

The levels are the teaching audit's (Sheila's structure), unchanged:

| # | Level | When | The reader ends with |
|---|---|---|---|
| 0 | See it | about 10 minutes (the audit's estimate, not timed) | an impact answer on their own code, from the first prompt |
| 1 | Work with it | day 1 | one small change shipped with its `.purpose` kept current and a `Symbols:` trailer |
| 2 | Trust it | week 1 | an enforcement level chosen, a block triggered on purpose and cleared |
| 3 | Compound it | month 1 | one agent taught one rule, gated, and seen applied |
| G | Gnomon track | 5 minutes, then ongoing | the first card approved on the stack |
| W | Warpline track | 3 minutes, then ongoing | `warpline oracle A B` on their own branches |

The two tracks branch off the line after level 0 and are drawn as short spurs, so the main path stays four stations long. The audit's thirteen best practices are distributed to the station each belongs to; the first five (map first, ripple before change, enforcement is a choice, `.purpose` in the same change, gates before endpoints) sit in levels 0 to 2. An exercise is a sentence said to the agent wherever the audit says so, shown with the prompt line, not a command the person types.

## 4. The shared system

Proposed in `.atelier/systems/pages/design-system.yaml`. In short:

- **Type.** Fraunces for headlines, the reader's system sans for prose, JetBrains Mono for anything real (symbols, commands, numbers, paths, sources, standing). Eight sizes: 13, 15, 17, 21, 32, 44, 56, 68.
- **Colour.** Ink on ground in light and dark, no accent. The five symbol hues appear only with their glyphs. Product colours stay inside plates.
- **Space.** A 4px base; sections 64 apart; rows 24.
- **Shape.** Square, with radius 2 on keys. One shadow, Gnomon's.
- **Components.** Masthead, key, command line, link, standing (line, ledger, mark), fact line, before and after, step chart, proof excerpt, provenance, slot, plate, sigil, sheet, strand, contents entry, claim rows, lately, limits, path and station, practice pair, field card, footer.
- **Deliberately absent.** Cards in a grid, pills and tags, eyebrow labels, an accent hue, gradients and glow, icon sets, testimonials and counters, carousels, tabs, modals, entrance animation, pie and area charts, raster screenshots in the first screen.

## 5. The specimen

`.atelier/systems/pages/specimen-hero.html`. Open it in a browser; it makes no network requests. It shows, in light and then in dark: the hub's first screen; the Paradigm page's hero and its first two sections; and the Warpline lead with the standing ledger. Every exhibit says whether it is real, an illustration, or a slot. Headlines and ledes are draft copy.

## Open, for the founder

See `session.yaml`, `needs_founder`.
