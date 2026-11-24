# Hero pages: build brief

For the engineer who implements the pages, and for Mika, who reviews them. Read `DIRECTION.md` first, then `.atelier/systems/pages/design-system.yaml`, and keep `.atelier/systems/pages/specimen-hero.html` open: its class names and markup are the starting point.

Do not start until the founder has accepted the direction. Nothing here is approved yet.

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
      { "state": "untested", "what": "A full run with a server, end to end", "evidence": "not run yet", "source": "founder, 2026-11-23" }
    ]
  },
  "excerpts": {
    "paradigm.init-command": { "path": "packages/paradigm/.purpose", "lines": [29, 39] }
  },
  "lately": { "source": "CHANGELOG.md", "rows": 4 }
}
```

In the HTML, a stamped region sits between comment markers, for example `<!-- fact:paradigm.tools-default -->` and `<!-- /fact -->`, likewise `standing:`, `excerpt:` and `lately:`. `stamp.mjs` has three modes:

- no flag: rewrite the regions from `facts.json`, the named files and `CHANGELOG.md`;
- `--check`: exit non-zero if a rewrite would change anything;
- `--release`: also exit non-zero if any referenced fact is a slot, any fact lacks a source or a date, any standing row lacks evidence, or any excerpt's lines no longer exist in the file at the pinned commit.

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
- **Narrow.** One column below 860px; readable at 320px with no sideways page scroll. The nav row scrolls inside itself. Graph labels must stay at 12px or more: below 560px the graph plate switches to a stacked list of the same symbols and edges.
- **Keyboard and screen readers.** One `h1` per page, headings in order, a skip link, `aria-current` on the nav. Graph nodes are focusable and the SVG has a title and a description that state the relationships. Standing marks are `aria-hidden`; the word carries the state. Copy announces "Copied" in a polite live region. Charts carry their data as a visually hidden table.
- **Print.** The field card on Learn prints on one sheet, ink on white, with no masthead.

## Acceptance checks (Mika holds the build to these)

Mechanical:

1. `atelier system which pages/index.html` reports `pages`; `atelier check --product pages` reports 0 fail and 0 warn, or each warning is recorded in the system as a baseline with a reason.
2. `node pages/build/stamp.mjs --check --release` passes.
3. A request log of each page shows same-origin requests only, within the budget table.
4. Each page passes an HTML validator and has no duplicate ids.
5. Axe (or Lighthouse accessibility) reports no violations in light and in dark.
6. Every internal link resolves; every repo link points at the pinned commit and returns 200.

Reviewed, rendered at 320, 390, 768, 1024, 1440 and 1920 wide, light and dark, and with reduced motion:

7. Never stock: no grid of identical bordered rounded cards, no uppercase tracked label over a block, no pill, no three equal columns, no component-kit default. Rows and rules carry the grouping.
8. Every number on every page has a visible source and a date, and matches `facts.json`. No slot is visible.
9. Each product page shows its standing line in the first screen and its ledger before the first step; every row has evidence; standing is never shown by colour alone.
10. The first headline and first claim on each page are about structure, determinism or calibration. No page repeats a claim the dossier lists under "Claims in existing copy that I could NOT back up".
11. Colour stays home: no symbol hue without its glyph; no product colour outside its plate or device; no shadow outside Gnomon's.
12. Warpline is the shortest page. Its two recorded results (the base-rate study and the K3 gate) appear only in the form the founder chooses; see the session's open questions.
13. Long content: a 60-character symbol id in the graph and in an excerpt, a 12-row ledger, a fact with a 7-digit value, a 30-word claim. Empty content: a product with no Lately rows, a page with one fact. Nothing overflows or collapses.
14. Keyboard only: every link, key, graph node and station is reachable in reading order with a visible 2px ink focus ring.
15. With script disabled and from `file://`: every page is complete.
16. Text contrast is 4.5:1 or better on its surface in both themes, including inside both Gnomon plates and the Warpline plate.

The repo's own rules also apply: a `pages/.purpose`, the Paradigm commit format, and an `atelier-mika` review saved before the work is called done.

## Not in this build

- Changing `docs/warpline/*.html`, `docs/warpline-overview.html` or `packages/site`.
- A custom domain.
- Search, a blog, or any page beyond the five and the 404.
