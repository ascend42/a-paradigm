# Hero pages: build brief

For the engineer who implements the pages, and for Mika, who reviews them. Read `DIRECTION.md` first, then `.atelier/systems/pages/design-system.yaml`, and keep `.atelier/systems/pages/specimen-hero.html` open: its class names and markup are the starting point.

The founder deferred the decision on this direction on 2026-11-23 (`TBD-FOUNDER: pages-direction` in `.paradigm/research/hero-pages/README.md`): build it as proposed, and the founder reviews at the morning merge. Nothing here is approved; every system entry stays `proposed`.

Mika reviewed the rendered specimen on 2026-11-23 and amended the specimen, the system and this brief. Build from the specimen as it is now. Her reasons are in `DIRECTION.md`, "Mika's review".

## Where the pages live

A new top-level folder, `pages/`, deployed by a GitHub Actions workflow.

```
pages/
  index.html                 hub
  paradigm/index.html
  gnomon/index.html
  warpline/index.html
  learn/index.html
  404.html
  assets/
    pages.css                one stylesheet for all pages
    pages.js                 one deferred script: theme key, Copy keys, path ticks
    fonts/                   Fraunces (variable), JetBrains Mono 400 and 600, woff2
  facts.json                 every number, standing row, excerpt reference and date
  build/stamp.mjs            Node, no dependencies; stamps facts into the HTML
  build/check.mjs            Node, no dependencies; the token, slot and overflow checks `atelier check` cannot do (see check 1)
  .nojekyll
  .purpose                   the repo requires one for a new feature folder
.github/workflows/pages.yml
```

Why this and not `docs/` on main:

- `docs/` holds specs, plans, competitive notes and the July Warpline pages. "Deploy from /docs" would publish all of it through Jekyll, at public URLs, including pages that call Google Fonts.
- A workflow can run the facts check before anything is published. A branch deploy cannot.
- `site/` was rejected as a name because `packages/site` is already useparadigm.dev.

Pages is not enabled on the repo today (`gh api repos/ascend42/a-paradigm/pages` returns 404). The founder turns it on once: Settings › Pages › Source: GitHub Actions. Until then the workflow's deploy job should be skipped, not failed.

The site will be served under `/a-paradigm/`, so every internal URL is relative (`../assets/pages.css`, `../gnomon/`). No root-relative paths.

The workflow: on push to main touching `pages/**` or `CHANGELOG.md`, run `node pages/build/stamp.mjs --check --release`, run the checks below, upload `pages/` without `build/` as the artifact, deploy. The published artifact contains no file from outside `pages/`.

## No build step to view

The committed HTML is complete. Opening `pages/index.html` from disk shows the finished page with its numbers. The stamp script is an authoring step that rewrites the committed HTML in place; CI only checks that it is up to date.

## How pages get their numbers

One file, `pages/facts.json`. Nothing numeric is typed into HTML by hand.

```json
{
  "as_of": "2026-11-12",
  "commit": "<sha the excerpts and links are pinned to>",
  "stale_after_days": 90,
  "facts": {
    "paradigm.tools-default": {
      "status": "measured",
      "value": 32,
      "unit": "MCP tools",
      "claim": "listed by default, at about 7,800 tokens on this repo.",
      "method": "test run; tokens estimated as length / 4",
      "source": { "path": "packages/paradigm-mcp/src/tools/tools-list-budget.test.ts", "lines": [18, 19], "command": null },
      "measured_on": "2026-11-23"
    },
    "paradigm.stop-hook-blocks": { "status": "slot", "needs": "the event log, the period, the query" }
  },
  "tbd_founder": {
    "warpline-tagline": { "default": "Warpline checks a merge by what the code means." }
  },
  "standing": {
    "warpline": [
      { "state": "untested", "what": "A full run with a server, end to end", "evidence": "not run yet", "source": "founder, 2026-11-23" },
      { "state": "did-not-hold", "what": "An advantage from calibrating to one codebase", "evidence": "gate K3 fired: 76.7% against 79.3% survival, p = 0.756", "source": ".paradigm/research/warpline-dogfood/run-results-full.md", "recorded_on": "2026-07-15" }
    ]
  },
  "excerpts": {
    "paradigm.init-command": { "path": "packages/paradigm/.purpose", "lines": [29, 40] }
  },
  "captures": {
    "paradigm.ripple-init-handler": { "command": "paradigm ripple '#init-handler'", "captured_on": "<date>", "lines": "<the lines shown>" }
  },
  "lately": { "source": "CHANGELOG.md", "rows": 4 }
}
```

A fact's `status` is `measured` (run on `measured_on`), `recorded` (written in the repo by an earlier run and not re-run; the page says "recorded <date>, not re-run") or `slot`. A standing row's `state` is one of `built`, `did-not-hold`, `in-progress`, `untested`.

In the HTML, a stamped region sits between comment markers, for example `<!-- fact:paradigm.tools-default -->` and `<!-- /fact -->`, likewise `standing:`, `excerpt:`, `capture:` and `lately:`. A capture is the output of a command, copied by the stamp script and never typed. `stamp.mjs` has three modes:

- no flag: rewrite the regions from `facts.json`, the named files and `CHANGELOG.md`;
- `--check`: exit non-zero if a rewrite would change anything;
- `--release`: also exit non-zero if any referenced fact is a slot, any fact lacks a source or a date, any standing row lacks evidence, any excerpt's lines no longer exist in the file at the pinned commit, or an excerpt begins or ends inside a YAML list or block without saying so (the specimen's first excerpt stopped one line short of its list).

The stamp script also writes every numeral that appears in prose ("32 tools", "8.1.3", "28 of 28") from `facts.json`, and `--check` fails on a digit in page text that is not inside a stamped region, a line number, a date or a version it stamped. That is how "nothing numeric is typed by hand" is enforced and not only intended.

The numbers come from `.paradigm/research/hero-pages/evidence-dossier.md`, which is the only source of numbers for the pages; `facts.json` is its machine-readable form. Founder decisions that are deferred (`TBD-FOUNDER: <id>` in `.paradigm/research/hero-pages/README.md`) live under `tbd_founder` with their working default. The page shows the default; the marker is an HTML comment, never visible text. `--release` lists them and does not fail on them.

A fact that a command can reproduce (`paradigm status`, `npm audit`) names the command, and the stamp script re-runs it when asked with `--remeasure`: the symbol count moved by one between the dossier's run and Luna's on the same day.

A fact older than `stale_after_days` is still shown, with "measured <date>" in primary ink. A section is written so that it still reads with fewer facts; a missing before and after or chart is simply not in the page.

Rejected: fetching `facts.json` at runtime. It fails from `file://`, shows nothing without script, and hides the numbers from search and from readers who save the page.

## What must be inline

- The theme bootstrap, in `<head>`, before the stylesheet: read the stored choice, set `data-theme` on `<html>`. Under 400 bytes. Without it the page follows `prefers-color-scheme`.
- Every plate, as inline SVG or HTML. No raster image in a first screen.
- A `<link rel="preload">` for Fraunces only.
- The `@font-face` rules with `font-display: swap` and fallback metric overrides (`size-adjust`, `ascent-override`) so the swap does not move the layout.

Not inline: the stylesheet. It is one cached file shared by five pages.

## Performance budget (per page, cold load)

| | Budget |
|---|---|
| Requests | 6 or fewer, all same-origin |
| HTML | 30 KB gzipped |
| CSS | 12 KB gzipped, one file |
| JS | 4 KB gzipped, one file, `defer`; the page is complete without it |
| Fonts | 90 KB: subset Fraunces to Latin (the repo's file is 67 KB unsubset; target 40 KB), JetBrains Mono 400 and 600 as they are (43 KB) |
| Total transferred | 150 KB |
| Largest contentful paint | the headline, as text, in the fallback face at first paint |
| Layout shift | under 0.02 |
| Lighthouse | performance 95 or more, accessibility 100, on mobile settings |

No third-party request of any kind: no font CDN, analytics, embeds or badges.

## Behaviour

- **Themes.** Light and dark by `prefers-color-scheme`; the theme key cycles Auto, Light, Dark and stores the choice. The Gnomon plate is papercraft in light and phosphor in dark. The Warpline plate is ink in both.
- **Motion.** Paradigm: hovering or focusing a graph node changes the weight of its edges and neighbours (120ms, no movement). Gnomon: the card is stamped once and its log row appears when the plate scrolls into view. Nothing else moves. Under `prefers-reduced-motion` both show their final state.
- **Without script.** No Copy keys, no ticks, no theme key (the key is added by script). Everything else is there, and every station opens.
- **Widths.** Four steps, as in the specimen: below 1280 the display size is 56; below 1100 the hub and each hero are one column, the plate is at most 560 wide, and from 861 to 1099 the lead fact sits beside the plate; below 860 rows stack and page padding is 16; below 620 the display size and the numeral are 44 and the graph plate is the list of the same symbols and edges (`.graph-list`). Readable at 320 with no sideways page scroll: the nav, a command and a `pre` scroll inside themselves; a path in a source line breaks inside its block. A label in a plate never sets under 13px. A symbol id over 24 characters is cut in the middle in the drawing and written whole in the node's title and in the list.
- **Keyboard and screen readers.** One `h1` per page, headings in order, a skip link as the first focusable thing (`.skip` in the specimen), `aria-current` on the nav. The hub's index is a `ul`. Graph nodes are focusable and the SVG has a title and a description that state the relationships. A focus ring inside a plate is drawn in the plate's own ink (the frame's light-theme ink is 1.09:1 on Warpline's ground). The theme tokens are declared twice, under `prefers-color-scheme` and under `data-theme`; the two sets must be identical. A paired table is a real `table` with a caption and row and column headers. Standing marks are `aria-hidden`; the word carries the state. Copy announces "Copied" in a polite live region. Charts carry their data as a visually hidden table.
- **Print.** The field card on Learn prints on one sheet, ink on white, with no masthead.

## What changed in the specimen after Luna's draft, which the pages follow

- **Every first screen carries one lead fact** (`.fact.lead`): on the hub under the command, on a product page under the plate. Paradigm's is the tool list (`paradigm.tools-default`). Gnomon's and Warpline's are chosen from the dossier's section 6 and its "safe to print large" list; if Warpline has none the founder accepts, its lead is the ledger alone.
- **Paradigm hero commands** are a run of two (`.cmds`): the install, then `paradigm shift` "in your project", then the prompt line. The teaching audit's shortest path also has two `/plugin` lines; they go in section 7 (Start), and the hero's run links to it.
- **Paradigm section 3** opens with the tool list before and after (`.pair`), then the fact lines, then the February study as a paired table (`.study`) in the Did not hold state, then the proof excerpt.
- **Warpline lead**: the ledger has a Did not hold row for the calibration gate, and one fact line follows it for the base-rate study. Both are the working default for the founder's open question.
- **Ledger rows the draft did not have and the dossier says we must say first** (its facts 9 and 10): Paradigm: "Purpose coverage on our own repo is 65% (186 of 288 directories)" and "The learning loop has recorded no journals here"; Warpline: "This repository is not a working Warpline example: dogfooding here stopped on 2026-11-09 and its ledger fails `warpline health`" (TD-2026-11-09-865). State and evidence from the dossier, section 5.
- **Evidence the specimen cites that is not in the dossier**: the Warpline rows for "F4 runs" and "the save cycle (fork, propose, admit)" are from `CHANGELOG.md` lines 13 and 20. Put them in `facts.json` with those lines as their source. "In progress" for the F4 row needs a run in progress to point at; if there is none, the row is Untested. The two Built rows for Warpline need a test run at the pinned commit as evidence (the dossier's pass counts are from 2026-10-14, before 0.3.0).

## Acceptance checks (Mika holds the build to these)

Mechanical:

1. `atelier system which pages/index.html` reports `pages`; `atelier check --product pages` reports 0 fail and 0 warn, or each warning is recorded in the system as a baseline with a reason. Three things about what that check covers, each tried on atelier 1.0.4:
   - `--product pages` walks `pages/` and not `.atelier/`. The specimen is checked by name: `atelier check .atelier/systems/pages/specimen-hero.html` (0 fail, 0 warn on 2026-11-23).
   - It reads CSS files, `<style>` blocks, `style` attributes and SVG presentation attributes. It treats a custom-property declaration as a token definition and does not test its value: `--ground: #FF00AA` passes, `color: #FF00AA` warns. The pages keep every colour in custom properties, so without more the palette rule sees almost nothing.
   - So `node pages/build/check.mjs` must pass too. It has no dependencies and fails when: a colour, font size, space or radius declared in any custom property in `pages/assets/pages.css` or in a page is not a value under `foundations` in `.atelier/systems/pages/design-system.yaml` (read the hex and px values out of that section with a regular expression; no YAML parser is needed); the light and dark token sets under `prefers-color-scheme` and under `data-theme` differ; a `var(--name)` is used that is never declared; or a symbol hue token is used in a rule whose selector is not a sigil, a graph prefix or an excerpt prefix. CI runs it beside the stamp check.
2. `node pages/build/stamp.mjs --check --release` passes.
3. A request log of each page shows same-origin requests only, within the budget table.
4. Each page passes an HTML validator and has no duplicate ids.
5. Axe (or Lighthouse accessibility) reports no violations in light and in dark.
6. Every internal link resolves; every repo link points at the pinned commit and returns 200.

Reviewed, rendered at 320, 390, 768, 1024, 1440 and 1920 wide, light and dark, and with reduced motion:

7. Never stock: no grid of identical bordered rounded cards, no uppercase tracked label over a block, no pill, no three equal columns, no component-kit default. Rows and rules carry the grouping. And not flat: at 1440 by 800 each first screen shows, without scrolling, what the thing is, one lead fact with its source, the standing line and the first thing to do; and the plate is the largest object on a product page's first screen.
8. Every number on every page has a visible source and a date, and matches `facts.json`, which matches the dossier. A recorded figure says "recorded <date>, not re-run". No slot is visible. No sentence states a fact the dossier or a cited repo line does not hold.
9. Each product page shows its standing line in the first screen and its ledger before the first step; every row has evidence; standing is never shown by colour alone. Checked on a grayscale capture and under deutan, protan and tritan simulation: the four marks, the strand's line styles and the sigils' glyphs still tell every state and symbol apart.
10. The first headline and first claim on each page are about structure, determinism or calibration. No page repeats a claim the dossier lists under "Claims in existing copy that I could NOT back up".
11. Colour stays home: no symbol hue without its glyph; no product colour outside its plate or device; no shadow outside Gnomon's.
12. Warpline is the shortest page. Its two recorded results appear as in the specimen until the founder says otherwise: the K3 gate as a Did not hold ledger row, the base-rate study as one fact line under the ledger.
13. Long content: a 60-character symbol id in the graph, the graph list and an excerpt, a 12-row ledger, a fact with a 7-digit value, a 30-word claim, nav and key labels a third longer. Empty content: a product with no Lately rows, a page with one fact. Nothing overflows or collapses. Measured, not eyeballed: at 320, 360, 390, 430, 620, 621, 768, 860, 861, 1099, 1100, 1279, 1280, 1440 and 1920 wide, `document.documentElement.scrollWidth` equals the viewport width and no text rectangle ends past it.
14. Keyboard only: the skip link is first; every link, key, graph node and station is reachable in reading order with a visible 2px focus ring, in the frame's ink on the frame and in the plate's ink inside a plate; nothing focused is hidden under the masthead. This is reported as "technically conformant", not as "accessible".
15. With script disabled and from `file://`: every page is complete.
16. Text contrast is 4.5:1 or better on its surface in both themes, including inside both Gnomon plates and the Warpline plate. The frame's tokens were computed on 2026-11-23 and pass on ground, raised and sunk in both themes (lowest text pair 5.31:1; lowest edge 3.93:1); the plates' insides are not built yet and are measured when they are.
17. Reduced motion: the specimen has no motion, so this is tested on the build. With `prefers-reduced-motion: reduce` the graph ripple changes weight with no transition and the Gnomon plate shows its stamped card and log row at once.
18. Not shown in the specimen and so reviewed rendered before the build is called done: the Gnomon page and its plate, the Warpline plate, the path and an open station, Lately, the footer, the 404, the field card in print, and hover and focus on a graph node.

What these checks cannot show is whether a developer from the repo understands the page. The cheapest check that can: give the hub to three developers who have not seen Paradigm, take it away after five seconds, and ask what it is, one number, where it stands and what they would do first.

The repo's own rules also apply: a `pages/.purpose`, the Paradigm commit format, and an `atelier-mika` review saved before the work is called done.

## Not in this build

- Changing `docs/warpline/*.html`, `docs/warpline-overview.html` or `packages/site`.
- A custom domain.
- Search, a blog, or any page beyond the five and the 404.
