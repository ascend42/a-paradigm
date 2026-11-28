# pages/

The public pages GitHub Pages serves: a hub, then Paradigm, Gnomon, Warpline and Learn. Plain static
files. Open `pages/index.html` from disk and you see the finished page, with its numbers, with or
without scripting. There is no build step to view them.

The design system is `.atelier/systems/pages/`. Copy is in `content/`. Every number is in `facts.json`.

## The one rule

Do not type a digit into a page. A number, date, version or line reference reaches the HTML only by
being stamped from `facts.json` between comment markers. `build/check.mjs` fails on any other digit.

## Edit a fact

1. Change the value in `facts.json` (with its `source` and `measured` date).
2. `node pages/build/stamp.mjs` rewrites every region that prints it.
3. `node pages/build/check.mjs` checks the result.
4. Commit `facts.json` and the changed HTML together.

## Check before a release

```
node pages/build/stamp.mjs --check --release
node pages/build/check.mjs --release
atelier check --product pages
```

CI (`.github/workflows/pages.yml`) runs the first two on every push to `main` that touches `pages/**`
or `CHANGELOG.md`, and deploys only if they pass. While a page in `build/pages.json` is still
`"built": false`, a strict release check fails on purpose; use `--allow-pending` while building.

The release stamp also fails when the first version heading in `CHANGELOG.md` is not the first row of
`lately.paradigm` in `facts.json`: update the lately rows at each release. `## [Unreleased]` is not a release.

## Stamped regions

A region is `<!-- kind:arg key=value -->...<!-- /kind -->`. Leave it empty; the stamp fills it.

| Marker | Prints |
|---|---|
| `fact:<id>` | a fact's value. `<id>.measured`, `.claim`, `.source`, or a key of an object value. `round=100` rounds a number. |
| `src:<id>` | the source line: how it is known, where (linked at the pinned commit), when. |
| `ref:<id>` | an entry of `facts.json` `refs`: a release, a level, a requirement that prose names. |
| `sec:<anchor>` | the number of the section with that id on this page. Section numerals are CSS counters. |
| `loc:<excerpt-id>` | a linked "path, lines a to b". |
| `standing:<product>.ledger` | the ledger rows, as `li` for a `ul class="ledger"`. `loom=1` adds the strand cell (Warpline, with `class="ledger loom"`). A row's `state` is `built`, `did-not-hold`, `in progress`, `untested` or `not built`. |
| `rows:<id>` | one `li` per item of a fact whose value is a list (the Gnomon requirements). |
| `pn:<practice-id>` | the number of that practice on the Learn page. Practice and station numbers are CSS counters. |
| `excerpt:<id> lines=a-b` | lines of a real file at the pinned commit, numbered, with its head. `wrap=1` shows a long line whole. |
| `capture:<name> lines=5\|15,17\|29-30` | lines of `captures/<name>.txt`; a bar is a blank line. `head=0` drops the head. |
| `lately:<product> rows=n` | changelog rows, each checked against the changelog line. |
| `bar:<id> of=<id>` | one bar of a before and after, to scale. |
| `graph:<excerpt-id> features=a,b agrees=<capture>` | the symbol graph and its list, read from the `.purpose` file. |
| `frame:head`, `frame:mast`, `frame:foot` | the shared head links, masthead and footer. |
| `frame:standing-key` | the five standing words with their marks, as `li` for a `ul class="ledger-key"` above a ledger. |

Deferred founder decisions are comments, `<!-- TBD-FOUNDER: id ... -->`; the release stamp lists them.

## Add a page

1. Copy `paradigm/index.html` to `<name>/index.html`. Keep the `frame:head`, `frame:mast` and
   `frame:foot` regions, the `.wrap`, and `<main id="main">`. Change the title, description and body.
2. In `build/pages.json`, set that page's `"built": true`.
3. Write the sections from `content/<name>.md`: each `{{fact-id}}` becomes `<!-- fact:fact-id --><!-- /fact -->`,
   each "Source:" line becomes a `src:` region, each `[[TBD-FOUNDER: id]]` becomes a comment, and a
   `[[slot: id]]` is left out (the fallback beside it in the Markdown is what the page says).
4. A numbered section is `<section class="section" id="..." aria-labelledby="...">` with an empty
   `<div class="section-n" aria-hidden="true"></div>` and a `.section-body`. The section that holds
   the ledger has `id="standing"`; the hub links to it.
5. Use the components that exist in `assets/pages.css`. A new pattern goes to the design system first.
6. Stamp, check, run `atelier check --product pages`, and look at it at 320 to 1920 wide in both themes.

## Numbers written as words

"Thirteen practices", "Four levels", "four commands" are typed, so `build/check.mjs` holds each to what it counts (`WORD_COUNTS`). Add a line there when you write a new one.

## Fonts

`assets/fonts/` holds a Latin subset of Fraunces (see `SUBSET.txt`) and JetBrains Mono 400 and 600,
with their OFL licence files. Nothing is loaded from another origin.

## The 404

`404.html` is served for any missing path at any depth, so it alone sets `<base href>` from
`base_path` in `build/pages.json`. It is styled only when served, not from `file://`.
