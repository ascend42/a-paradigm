# Gnomon GUI fidelity critique: comp vs shipped

Session `2026-10-20-gnomon-gui-fidelity` · verb `critique` · Luna · 2026-10-20

- **Comp:** `.atelier/sessions/2026-10-15-gnomon-aesthetic/refs/direction.html`, with `motion`, `workshop-placement` and `papercraft`. Approved 2026-10-17.
- **Shipped:** `packages/gnomon-gui/static/{index.html,styles.css}`, `src/ui/app.ts` and `src/core/render.ts`.
- **Screens:** `scratchpad/live-desk-dark.jpg` (night, no sessions) and `scratchpad/comp-direction-day.jpg`.

Note: `refs/` is gitignored, so a builder on another checkout has no comps. Every value a builder needs is copied into this file.

## The read in one line

The tokens are right, but the object is missing. `styles.css` already carries every pigment and surface token from `design-system.yaml` (G-GUI-10 holds). Almost none of the **material** is drawn, though: no fonts, grain, sheets, ink keys, pile, caps or motion. The empty state is a raw kernel log, so the screen reads as a dev console in a dark theme rather than a papercraft or phosphor instrument.

## 1. Ranked fidelity gaps

Rank is visual and identity impact, most damaging first. "Comp" quotes direction.html CSS unless noted.

| # | Region | Comp does | Ships today | Slice |
|---|---|---|---|---|
| 1 | **Type** | JetBrains Mono 400/500/600 everywhere. Fraunces 460/600 for day wordmark, `.chead h2` (600 18px), `.pilehead h3` (600 15px). | `--mono: "JetBrains Mono", ui-monospace, …` names the family, but no font file ships (styles.css header: "bundled font files … M1.10 slice 2"). Every machine without JBM installed gets SF Mono/Menlo, and day titles get Iowan/Georgia. This is the single biggest "not ours" cue. | S1 |
| 2 | **Centre, empty state** | There is always a chat: a sheet-bubble user message, an activity line and the agent reply. | No focused session ⇒ `kernel feed`: wrapped raw event rows (`daemon.start · idleMs …`, key ids, hashes) fill the whole centre. The screenshot is mostly this. | S2 |
| 3 | **Grain / ground** | Day: `.shell:before` feTurbulence noise, `opacity:.3; mix-blend-mode:multiply`, baseFrequency .9, matrix `0 0 0 0 .45 / .4 / .32 / alpha .22`. Night: flat `#0F1116`. | None. Day is a flat `#EDE8DC`. Note: CSP `img-src 'self' blob:` blocks the comp's `data:` URL, so the grain must be a bundled file. | S1 |
| 4 | **Ink keys** | `border:1px solid var(--ink2); border-radius:3px; box-shadow:2px 2px 0 var(--ink2)`, with a primary `.pri{background:var(--ink);color:var(--sheet)}` and `min-height:28px`. Night: no shadow, `[ ]` brackets. | `.key`: radius 4px, `box-shadow: 2px 3px 0 rgba(22,21,15,.18)` (a soft translucent smear, not a hard ink offset), `padding:1px 8px` (about 20px tall) and no primary key. Night brackets are correct. | S1 |
| 5 | **Stack pile** | `.pile .card+.card{margin-top:-64px}`, rotations `1.2 / -1 / .8deg` on children 2–4, z-index descending, and `.pile.fan` → `margin-top:10px; --r:0` on hover. The head reads `Stack` (Fraunces 15) with `4 · hover to fan`. Rail width 340px. | A flat vertical list of boxed cards (`margin:0 0 10px`), with no overlap, rotation or fan. The head is a lowercase mono "decisions" plus an `[all projects]` key. | S3 |
| 6 | **Cards** | Sheet with a **4px left edge** in the state colour (`--edge`: knot/fail/warn/rule) and folded shadow `0 1px 0 rgba(0,0,0,.06), 3px 4px 0 -1px var(--fold), 4px 6px 10px rgba(60,48,30,.14)`. Anatomy: `■ project` (project **ink** pair) `· kind · [mic/hand-only]`, an `h4` title (500 13px), meta `raised 14:06 · waiting 1m`, then keys. A hidden `APPROVED` stamp lives on every card. Night: `border:1px var(--rule); border-left:3px var(--edge)`, no shadow. | 1px key-edge box all round (knot/fail recolour the whole box), `box-shadow: var(--shadow), var(--glow)`. Anatomy: `kind requestedBy · hsid · repo`, the block body, keys, then a `contentHash sha256:…` line. No project line, title, raised/waiting meta, stamp or countdown bar. | S3 |
| 7 | **Footer / Workshop** | 64px footer: `NEEDS YOU` caps zone (dashed right rule) and `WORKING` caps zone. Each cap is a 22×28 SVG hat (tall/wide/floppy) filled in the project hue with an `--ink2` 1.1px stroke and a soft shadow ellipse. Night: outline only with `drop-shadow(0 0 3px hue)`. The cap bobs only while its session streams. Placement presets: footer (default), right or left 76px column. | `#pane-shuttle` is a debug readout: `sessions 0 live · 0 seen  inbox clear  log head 17 · 17 rows  api gnomon-rpc:v1`. The GUI never calls `mod.view`, so the Workshop mod is not mounted anywhere. The mod renders glyph text (`▲ builder filled bob`) with `tone: hue-N`, and `renderBlock` drops `tone`. | S5 |
| 8 | **Sessions rail** | `+ New session ⌘N` as a full-width ink key (hard shadow). `ACTIVE 5` small-caps head. Rows: 12px swatch (1px `--ink2` edge, hue fill), human name, right-aligned state note (`1 card` / `KNOT` in warn-ink, `failed` in fail, `streaming`, `idle` in sec). Selected row gets a sheet bg. `▸ PAST 12` collapsed, past rows at .75 opacity. | Head `SESSIONS [+ new]`, a search field, and a `kernel feed` row pinned first. Group heads carry 10px swatches. Rows read `● <hsid tail> · <state> · N need you`, with no names, no coloured state notes and no Active/Past split; ended sessions sit inline as grey. | S2 |
| 9 | **Chat** | Header: `h2` session name (Fraunces 18) and `■ project · claude · started 13:58 · 9m`. Messages max 80ch, gap 14px. The user message is a right-aligned sheet bubble. A `<details class="act">` summarises `13:58–14:06 · read 6 files · ran 2 commands · 41s of work`, with a 2px rule on its left. Agent meta reads `14:06 · agent · took 41s`. Inline code sits on a `rule` 50% tint. | Rows are virtualized at max 96ch. The user bubble is left-aligned with a 4px radius. Every tool call is its own `↳` row and every auto-allow its own `✓` row, with no folding. There is no `took Ns`. The header is the hsid in mono plus a count. | S2 |
| 10 | **Pending in session** | `.pinned`: `PENDING IN THIS SESSION` label (10.5px, .08em, uppercase, sec), cards flat at 0deg, 20px side padding, sitting above the composer. | `#pinned` exists and is correctly wired (same `mk()` as the stack), but it has no label and uses the boxed card. | S2 |
| 11 | **Header** | Wordmark (Fraunces 600 17px day; mono 13px uppercase .1em with `text-shadow:0 0 6px rgba(200,255,235,.35)` at night), then a **palette field** (`Search, run, jump… ⌘K`, sheet, min-width 240px), spacer, armed indicator, `⊞ Layout`. Height 44px. | Wordmark has no night glow. Next come the `conn` readout, the risk badge, the voice pill, `0 pending`, a `[⌘K]` key and no Layout button (presets are reachable only via the palette). `chrome` is a sheet strip; the comp header sits on the ground. | S2 |
| 12 | **Voice indicator** | `.armed`: `background:var(--warnbg); color:var(--warnink); border:1px solid var(--warn); radius 3px`, a 7px amber dot, uppercase `VOICE ARMED · REVERSIBLE · 41:10` and an inline `Disarm` key. Static. | `voice-pill` uses `border-radius:999px`. Ambient = warn-bg plus a **2px vermilion** edge, a pulsing red dot and an infinite `voice-ring` animation. PTT = **slate** (a project hue used as state). Off = dashed. | S1 |
| 13 | **Pigment hues** | Project name text uses the **ink pair** (`--i1..6`, e.g. `#8E4E38`), fills use `--h1..6`, and every fill has a 1px `--ink2` edge. | Fill tokens exist (`--p-*-fill`), but the **ink pairs are missing**, so project names cannot be coloured. The GUI hue is a `x*31+c % 6` string hash of the repo, while the kernel feed to the Workshop uses `sha256(cwd)[0] % 8` (`modhost/feed.ts:55`). The same project gets **different hues** in the rail and the Workshop, and hue indices 6 and 7 have no pigment. | S1 + S5 |
| 14 | **Day vs night** | Night: cards lose their shadow and get `1px var(--rule)` with a 3px edge. Glow only on the wordmark and the caps. Keys are bracketed. | `--glow: 0 0 6px rgba(232,244,240,.18)` is applied to **every card and sheet** at night (a fuzzy halo the comp does not have). Brackets are right. Theme auto-switch works. | S1 |
| 15 | **⌘K palette** | A visible field in the header (above). | Overlay at `padding-top:14vh` with `.sheet-card` and plain rows. It works, but nothing in the chrome shows it. The fix is the header field, plus rows with a right-aligned `kbd` hint. | S2 |
| 16 | **Motion** | flyin 550ms `cubic-bezier(.3,.7,.3,1)`: `120% 12deg → -5% -3deg → 2% 1.5deg → 0 var(--r)`. stamp 400ms `cubic-bezier(.3,1.4,.5,1)` scale `1.9 → .92 → 1` at -8deg. flyout 450ms ease-in: `scale .97` then `translate(-30px,-60px) rotate(-14deg)`, opacity 0. droop 500ms ease-out `rotate(2.2deg) translateY(3px)`. 3s held countdown bar `scaleX 1→0`. Cap bob 1.1s. Cap walk 900ms. Reflow `margin/top .22s`. | Only `card-in` ships, with an extra opacity fade and no 75% step; it settles at `none`, not at its pile rotation. No stamp, fly-off, droop, countdown bar, bob or walk. Reduced motion is correct (global kill). | S4 |

### Already right (keep)
- Every `gnomon.colour` surface and semantic token, verbatim, test-pinned (`test/gui.test.ts:468`).
- The night `[ ]` key brackets, the day/night/auto theme and reduced-motion handling (`[data-motion]` plus the media query).
- The desk grid order, the drawers under 900px, and cards appearing in both the stack and pinned with one decide removing both.
- The kernel-owned marking (`.kernel-owned`) on conn, risk, voice, mode, repin, voice-dev, dictation and card bodies.

## 2. Implementation brief

Global law for every slice:

- **CSP:** `style-src 'self'`, `img-src 'self' blob:`, `font-src 'self'`. No inline `style=` (test `gui.test.ts` asserts it on index.html; do not set it from app.ts either: use classes). No `data:` URLs. No `innerHTML` (asserted).
- **Bundle:** after any `static/` or `src/` change run `npm run embed --workspace=@a-company/gnomon-gui`, which regenerates `packages/gnomon/src/kernel/web/gui-bundle.ts` and `GUI_BUNDLE_HASH`. `npm test` there runs `--check` (G-WEB-08 pin). Commit both.
- **Must not regress:**
  - **Kernel-owned regions** can never be hidden by a layout preset or by `.no-*` classes: `#conn`, `#risk`, `#voice-pill`/`#voice-stop`/`#voice-action`, `#mode-btn`, `#repin`, `#voice-dev`, `#dictation`, handle words, the held countdown, `.card-body`. The Workshop footer *can* hide; the voice indicator cannot.
  - **Contrast:** key, cap and state edges must be ≥ 3:1 (use `--key-edge`, `--warn-edge`, `--fail-edge`, `--knot-edge`; never `--rule` for a key edge). All text must be AA ≥ 4.5:1 (only text tokens in `color:`, which the test enforces). Project hue fills never carry text. **Sage `#9DAF8C` is 3.96:1 → fills only.** Every fill keeps a 1px `--key-edge` ring.
  - **Hue meaning:** vermilion = failed only, amber = warning / held / armed, violet = KNOT only, project hue = identity only.
  - The `contentHash …` line on cards stays (GUI-core security summary). Restyle it; do not remove it.
  - The 900px drawer behaviour and its test.

### S1: tokens, themes, fonts, grain, ink keys (CSS-heavy)
**Files:** `static/styles.css`, new `static/fonts/*`, new `static/grain.svg`, `scripts/build.mjs`, `test/gui.test.ts`, `docs/specs/gnomon-fixtures/contrast.json` (no value changes; the ink pairs are already listed under `text`), and `.gitattributes`.

1. **Fonts.** Vendor latin-subset woff2:
   - `JetBrainsMono-{Regular,Medium,SemiBold}.woff2` (400/500/600);
   - `Fraunces-{SemiBold}.woff2` plus a 460 cut, or one variable `Fraunces[opsz,wght].woff2` limited to opsz 9–144 and wght 460–600.

   Ship `static/fonts/OFL-JetBrainsMono.txt` and `static/fonts/OFL-Fraunces.txt` (OFL 1.1 requires the licence to travel with the fonts; MIT on the package does not cover them). Before subsetting, read each upstream OFL header for a *Reserved Font Name*; if one is declared, ship the upstream woff2 unmodified instead of a subset. Neither font is vendored anywhere in this repo today. Upstream: `github.com/JetBrains/JetBrainsMono`, `github.com/undercasetype/Fraunces`.
   - Add `@font-face` with `font-display: swap`, `src: url("fonts/….woff2") format("woff2")`.
   - Wire `--title-font: "Fraunces", Georgia, serif` (day) and `--display-wght: 600`.
   - **Trap:** `build.mjs` reads every static file as utf8 and strips `\r\n`, which corrupts woff2. Change `buildFiles()` to walk `static/` recursively: text (`.html`, `.css`, `.js`, `.svg`, `.txt`) gets the LF normalisation, everything else is read as a raw Buffer. Add `*.woff2 binary` to `.gitattributes` (Windows CI trap). The kernel MIME map already serves `woff2` (`rules.ts:95`).
2. **Tokens** to add (day / night):
   - `--p-terracotta-ink` #8E4E38 / #E6A88F, `--p-sage-ink` #56663F / #B7CCA3, `--p-slate-ink` #44577C / #A9B9DB, `--p-ochre-ink` #7A5A1C / #E8C88C, `--p-rose-clay-ink` #874B54 / #E4AEB4, `--p-sea-grey-ink` #3F6664 / #A8CFCB. Extend the test's `TEXT` set and `MAP` to these six (they are already `text` entries in contrast.json, so this is a test change, not a fixture change).
   - `--key-shadow`: `2px 2px 0 var(--key-edge)` / `none`.
   - `--sheet-shadow`: `0 1px 0 rgba(0,0,0,.06), 3px 4px 0 -1px var(--fold), 4px 6px 10px rgba(60,48,30,.14)` / `none`.
   - `--edge-w`: `4px` / `3px`.
   - `--grain`: `url("grain.svg")` / `none`; `--grain-opacity`: `.3`.
   - `--wm-glow`: `none` / `0 0 6px rgba(200,255,235,.35)`.
   - `--cap-shadow`: `rgba(40,30,15,.22)` / `transparent`; `--cap-glow`: `none` / `0 0 8px 1px rgba(160,255,220,.22)`.
   - `--stamp`: #3F6664 / #A8CFCB (comp value; see re-open 2).
   - `--radius`: `3px`.
   - Motion (both themes): `--t-stamp: 400ms cubic-bezier(.3,1.4,.5,1)`, `--t-flyout: 450ms ease-in`, `--t-droop: 500ms ease-out`, `--t-walk: 900ms ease-in-out`, `--t-bob: 1.1s ease-in-out`, `--t-hold: 3s linear` (keep `--fly` and `--reflow`).
   - **Remove** `--glow` from `.card` and `.sheet-card` (the comp has none). Keep the glow only on `.wordmark` (night `text-shadow: var(--wm-glow)`) and on caps.
3. **Grain.** `static/grain.svg`: 160×160, `feTurbulence baseFrequency=.9 numOctaves=2` and `feColorMatrix values="0 0 0 0 .45 0 0 0 0 .4 0 0 0 0 .32 0 0 0 .22 0"`. Draw it on `.shell::before{content:"";position:fixed;inset:0;pointer-events:none;background:var(--grain);opacity:var(--grain-opacity);mix-blend-mode:multiply;z-index:0}` with the shell children at `position:relative; z-index:1`. Grain stays under text: verify contrast is unchanged by sampling `--sec` on ground in a screenshot.
4. **Ink keys.** `.key{border-radius:var(--radius);box-shadow:var(--key-shadow);padding:3px 9px;min-height:28px;font-weight:500;font-size:11.5px}` and `.key:active{transform:translate(2px,2px);box-shadow:none}`. Add `.key.pri{background:var(--ink);color:var(--sheet)}`. `--sheet` is not a text token, so add `--on-ink` = `--sheet` value to the contrast fixture `pairs` (`fg sheet` on `bg ink`, 17:1) and to `TEXT`. In `render.ts` mark the first non-deny decision key `pri`, unless the card is `claim-mismatch` (Deny stays default focus, and is not filled).
5. **Voice indicator.** Restyle without changing states or logic: radius `var(--radius)`, uppercase, 11.5px/500.
   - **Ambient (armed):** `background:var(--warn-bg); color:var(--warn-ink); border:1px solid var(--warn-edge)` with an amber 7px dot. Drop `voice-ring` and `voice-pulse` (no idling). The live meter may keep moving, because it is driven by audio events. This matches the comp and the macOS orange mic dot.
   - **PTT:** neutral: `color:var(--ink2); border-color:var(--key-edge)`, filled `--ink2` dot (slate is a project hue).
   - **Off:** `--sec` text, dashed `--key-edge`.
   - **Crashed:** keeps vermilion (a failure).
6. **Header ground.** `.chrome{background:transparent;height:44px}` so the grain shows. The wordmark is Fraunces 600 17px with -.01em tracking by day, and mono 13px uppercase .1em plus glow at night.

**Screenshot check:** the fixture desk (see §3) in day and night. Key edges must read hard, the grain must be visible at 100% zoom, and a `font-family` probe must show "JetBrains Mono" in DevTools Computed › Rendered Fonts.

### S2: desk structure (sessions, chat, pinned, header)
**Files:** `static/index.html`, `static/styles.css`, `src/ui/app.ts`, `src/core/store.ts` (pure helpers), `src/core/commands.ts`, plus tests in `test/gui.test.ts`.

1. **One hue function.** `hueOf` must equal the kernel's projection or the rail and the Workshop disagree. Export `projectHue(cwd: string): 0..5` from `@a-company/gnomon-contracts` as `sha256(cwd)[0] % 6`. Use it in `modhost/feed.ts` (change `FEED_HUES` 8→6; the Workshop's `HUES` 8→6, which needs a mod re-pin and so falls in S5) and in the GUI. The GUI holds the repo, not the cwd: add `hue` to `SessionRow` from the `session.open` payload if the kernel can project it, otherwise hash the same `repo` string on both sides. Arky to pick the key; the rule is that **one function produces both values**.
2. **Sessions rail** (`paintSessions`):
   - `#new-session` becomes `.key.newb` full-width: `+ New session` on the left, `⌘N` right in `--sec`.
   - Drop the `.pane-head` title; keep the search field below New, quieter (no key-edge, a `--rule` border).
   - Section heads `ACTIVE n` and `▸ PAST n` (10.5px/500, .08em, uppercase, `--sec`); Past is collapsed by default and the toggle persists in the layout store. Live states go to Active, `ended|refused|orphaned|seen` go to Past.
   - Within Active, group by project: group head = 12px swatch `.swatch.hN` plus the project name in `--p-<hue>-ink`.
   - Row grid `12px 1fr auto`, padding 6px 8px, radius 3px.
   - Name = `sessionTitle(s)` (new pure helper in store.ts): first user message trimmed to 28ch, else `<repo basename> · <hsid tail 4>`. The full hsid goes in `title=`.
   - State note, right-aligned: `N card(s)` and `KNOT` in `--warn-ink`, `failed` in `--fail`, `streaming` and `idle` in `--sec`. The selected row gets `background:var(--sheet)` and drops the left-border style.
   - The `● / ○` backend glyph moves into the note (`claude` / `local`) or is dropped; filled vs outlined is the Workshop's job.
   - The **kernel feed** leaves the session list. It becomes a palette command `view.kernel-feed` and a footer readout link.
3. **Empty centre.** With no focused session, render a quiet sheet: `No session open` (title font), `n live · m need you`, and an ink key `+ New session ⌘N`. Do not render the raw feed by default. `#raw-toggle` stays for focused sessions.
4. **Chat header.** `#transcript-title` = `sessionTitle` (title font, 18px day). Add `.chead-meta`: `■` swatch-ink project · backend · `started HH:MM` · elapsed. Mode button and count stay in `.head-right`.
5. **Chat rows** (pure fold in store.ts, `foldActivity(items)`):
   - Consecutive `tool`, `auto` and `result` items between a user and an assistant item collapse into one `role:'activity'` item: `HH:MM–HH:MM · read N files · ran N commands · Ns of work`. It is collapsed by default, and expanding it remounts and remeasures through the existing `HeightIndex` (key = first child key).
   - The assistant `.who` gains `took Ns` (from the user item `at` to the assistant item `at`).
   - The user body aligns right (`.trow.role-user{display:flex;flex-direction:column;align-items:flex-end}`), radius 3px.
   - Measure `max-width:80ch`, row gap 14px, inline code on `color-mix(in srgb,var(--rule) 50%,transparent)`.
   - `raw` mode keeps the unfolded rows.
6. **Pinned.** Prepend `<span class="lbl">Pending in this session</span>` (only when it has cards). Padding is 10px 20px 0; cards are flat (`--r:0`).
7. **Composer.** Sheet box with a `--key-edge` 1px border and radius 3px, margin 10px 20px 14px. The placeholder becomes `Reply to <sessionTitle>…`; the long Enter/⇧Tab hint moves to a `title=` attribute and a `kbd ⌘↵`. `send` becomes `.key.pri`.
8. **Header.**
   - Order: wordmark, palette field, `#risk`, spacer, `#conn` (as a dim readout), voice wrap, `⊞ Layout`.
   - Replace `#palette-btn` with `<button id="palette-btn" class="palfield">Search, run, jump… <kbd>⌘K</kbd></button>` (sheet, `--rule` border, min-width 240px, `--sec` text). The ⌘K shortcut is unchanged.
   - `#inbox` (`0 pending`) moves to the stack head.
   - New `#layout-btn` (`⊞ Layout`) opens a menu of `PRESETS` plus pane toggles plus Workshop placement (S5). Kernel-owned elements are never listed as toggles.
   - Narrow mode keeps `toggle-sessions` and `toggle-stack`.
9. **Palette rows.** `.pal-row` 6px 10px, radius 3px, title on the left, right-aligned `kbd` hint in `--sec`, selected row `background:var(--fold)`.

**Screenshot check:** fixtures `desk-busy` and `desk-empty`, day and night, at 1440×800 and at 860×800 (drawers).

### S3: the card sheet and the stack pile
**Files:** `src/core/render.ts` (`renderCard`), `src/ui/app.ts` (`paintStack`), `static/styles.css`, and tests.

1. **Card anatomy** (`renderCard`, data only from kernel fields):
   - `header.k`: `■ <repo basename>` in `--p-<hue>-ink` (weight 500), `· <kind>`, then the voice tag: `🎙 reversible · card N` from the kernel's voice handle, or `hand-only`, or `🎙 gate` plus the `.handle` word (kernel-owned).
   - `h4.card-title`: the first line of the block's Text, else `<kind>`; 500 13px/1.45.
   - `.card-body`: the rest (kernel-owned, unchanged).
   - `.meta`: `raised HH:MM · waiting Nm` from the `approval.request` row `at`. For a failed session card: `started · ran · failed`.
   - `requestedBy` moves into `title=` on the head. `contentHash` stays as the last line, 10px `--sec`, `opacity:.8`.
   - Keys, then `<div class="bar"><i></i></div>` and `<span class="stamp" aria-hidden="true">APPROVED</span>` (S4 animates them).
2. **Card CSS:** `background:var(--sheet); border:0; border-left:var(--edge-w) solid var(--edge, var(--key-edge)); border-radius:var(--radius); padding:10px 12px 10px 14px; box-shadow:var(--sheet-shadow); transform:rotate(var(--r,0deg))`.
   - Edges: `.kind-knot{--edge:var(--knot-edge)}`, `.failed{--edge:var(--fail-edge)}`, `.kind-gate-class,.held{--edge:var(--warn-edge)}`, `.claim-mismatch{--edge:var(--fail-edge)}`.
   - Night: `border:1px solid var(--rule); border-left:var(--edge-w) solid var(--edge)`.
   - A neutral card's left edge uses `--key-edge` (≥ 3:1), **not** `--rule` as the comp does. The comp's neutral `#D9D5CB` edge is decorative, the 1px fold shadow is the boundary, and the keys carry the 3:1 edges. Mika to vet; either is AA-safe because a neutral edge carries no state.
3. **Pile** (`#stack`, sorted by urgency as today):
   - `.pile .card + .card{margin-top:-64px}`.
   - Rotation by class, since inline style is banned: `.pile .card:nth-child(2){--r:1.2deg} :nth-child(3){--r:-1deg} :nth-child(4){--r:.8deg} :nth-child(n+5){--r:0}`, with z-index 4…1 and `:nth-child(n+5){z-index:0}`.
   - Fan: `.pile:hover, .pile:focus-within` → `margin-top:10px; --r:0`. **focus-within is required** so keyboard users can reach buried keys.
   - Transition `margin var(--reflow) cubic-bezier(.2,.8,.2,1), transform var(--reflow)`.
   - Pane head: `Stack` (title font 15px) on the left; right side `n · hover to fan` (sec 10.5px) and the `#stack-scope` key.
   - Rail width `minmax(300px,340px)`.
   - More than 6 cards: show 6 piled plus `+n more` (it opens the fanned pile).
4. Pinned cards reuse the same element with `--r:0` and no negative margin (`.pinned .card{--r:0;margin:0}`).

**Screenshot check:** `stack-4-mixed` at rest (pile visible, 4 rotations, the top card's keys clickable) and with `:hover` forced (`?fan=1` in the preview) to show all four flat. Repeat at night.

### S4: motion
**Files:** `static/styles.css` and `src/ui/app.ts` (`decide`, `paintStack` diffing, the failure transition and the voice hold).

1. **flyin:** replace `@keyframes card-in` with the comp's 4-step version, no opacity: `0%{transform:translateX(120%) rotate(12deg)} 55%{…(-5%) rotate(-3deg)} 75%{…(2%) rotate(1.5deg)} 100%{translateX(0) rotate(var(--r,0deg))}`, run as `animation: card-in var(--fly)`. A random settle of ±1.5deg needs inline style, which is banned; use 4 preset classes `.r-a … .r-d`, chosen by `cardId` hash, for pinned cards only. The pile keeps its nth-child rotations.
2. **Stamp, then fly off.** On a *successful* `approve` (never on a refusal), add `.stamp.on`: `@keyframes stamp{0%{opacity:0;transform:rotate(-8deg) scale(1.9)}60%{opacity:1;…scale(.92)}100%{opacity:1;…scale(1)}}` over `var(--t-stamp)`. After 550ms add `.out`: `@keyframes flyout{30%{transform:scale(.97) rotate(var(--r,0deg))}100%{transform:translate(-30px,-60px) rotate(-14deg);opacity:0}}` over `var(--t-flyout) forwards`. Remove the element on `animationend`, then repaint. The removal must not wait on the animation when motion is reduced (the `animationend` never fires because `animation:none`; check `document.documentElement.dataset.motion` and the media query and remove immediately). The stamp text uses `color:var(--stamp)` (add `stamp` to `TEXT`; 5.6:1 day).
3. **Held voice countdown.** When the kernel reports a held voice decision for a card, add `.held` (edge amber), show `.bar` with `i{animation:count var(--t-hold) forwards}` (`scaleX(1→0)`, transform-origin left), and set the meta to `Allowing in 3 · say "<undo phrase>"` in `--warn-ink`. The stamp plays only after the kernel commits the hold, never during it. The countdown is kernel-owned and cannot be hidden.
4. **Droop.** When a session card or row flips to failed: `.failed.fx{animation:droop var(--t-droop) forwards}`, `@keyframes droop{to{transform:rotate(2.2deg) translateY(3px)}}`. The edge turns vermilion via `--edge`. No shake, ever.
5. **Reflow:** the pile closes up through the `margin` transition (S3).
6. **Reduced motion.** The existing global kill stays. Add `[data-motion="reduced"] .stamp.on{opacity:1;transform:rotate(-8deg)}` so the stamp still *shows*, and the held bar renders as text seconds (as the dictation ring already does).

**Screenshot check:** preview `?play=arrive|approve|voice-hold|fail` with frame captures at 0 / 300 / 600 ms, plus `?motion=reduced` showing the final states instantly.

### S5: the Workshop mod footer
**Files:** `static/index.html`, `static/styles.css`, `src/ui/app.ts` (new `paintWorkshop`), `src/core/render.ts`, `src/core/commands.ts`, `packages/gnomon-mods/workshop/{model.mjs,fixtures/*}`, `packages/gnomon/src/kernel/modhost/feed.ts`, and the kernel first-party pin list.

1. **Mount.** Rename `#pane-shuttle` to `#pane-workshop` (`footer.workshop`, 64px). Call the existing `mod.view` relay for `workshop.strip` on load, and re-render on the feed kinds already projected (`session.open`, `turn.partial`, `turn.result`, `approval.*`, `warpline.knot`): events only, no polling. If the mod is not installed or is paused, show one quiet line, `workshop not installed · gnomon mod install …`, in `--sec`.
2. **Slot.** The manifest says `slot:"sidebar"`, and `FIXED_SLOTS` has no footer. **Keep the manifest** (no ABI change). The GUI's Layout decides where the sidebar-slot Workshop mounts: `workshop: 'footer' | 'right' | 'left' | 'hidden'`, persisted in `serializeLayout`, default `footer`. `right` and `left` are the comp's 76px column with stacked zones (`workshop-placement.html` CSS: `grid-template-columns: … 76px`, zones `flex-direction:column; gap:14px`, the need zone gets `border-bottom:1px dashed var(--rule)`).
3. **Caps as structured data.** In `model.mjs`, keep `text` (the accessible and reduced-motion form) and add `cap:{work:'builder'|'reviewer'|'teacher'|'tender', fill:'filled'|'outlined', pose:'still'|'bob', hue:0..5, knot:bool, q:'3'|'✕'|'◆'|'!'|null}`. Set `HUES = 6`. The needs-you cards carry their session's hue.
   - In `render.ts`, a `Text` node with a valid `cap` object (every field whitelisted, anything else ignored) renders `.cap` as an SVG `path`. Shapes come from the comp: `tall:'M11 1 L19 26 H3 Z'`, `wide:'M11 6 L21 26 H1 Z'`, `floppy:'M11 2 C15 8 21 10 20 26 H2 C3 14 9 12 11 2 Z'`, mapped builder → tall, reviewer → wide, teacher → floppy, tender → wide.
   - Fill and stroke come from CSS classes only: `.cap.hN path{fill:var(--p-*-fill);stroke:var(--key-edge)}`, `.cap.outlined path{fill:none}`, `.cap.knot path{fill:var(--knot);stroke:var(--knot-edge)}`. Night: `fill:none; stroke:var(--p-*-fill); filter:drop-shadow(0 0 3px …)` through a per-hue class. The shadow is `.sh` (16×4 ellipse, `--cap-shadow` / `--cap-glow`), with `aria-label` = text.
   - `tone` is whitelisted to `cap | quiet | paused | violet | hue-0..5` → classes. Generic, no mod-name special case.
   - Editing the mod changes its packageHash: re-pin it in the kernel first-party list and regenerate `strip.golden.json` and `strip-reduced.golden.json`. Aegis reviews the `cap` whitelist, because it is new mod-authored data that the GUI interprets.
4. **Layout.** `NEEDS YOU` (10px .08em uppercase `--sec`) with the need zone (caps plus `.q` labels above, dashed right rule), then `WORKING` with its zone. The old readout (`sessions · log head · api`) moves to the right end of the footer as one `--sec` 10.5px line, which links to `view.kernel-feed`.
5. **Motion** (lands here, not in S4, because the caps arrive here): `.cap.bob svg{animation:bob var(--t-bob) infinite}` with `@keyframes bob{50%{transform:translateY(-4px) rotate(-3deg)}}`, only while `pose:'bob'`. Cap walk from Working to Needs you (900ms FLIP via `element.animate` along the comp's 5-keyframe path). In reduced motion the pose prints `working` and nothing walks.
6. **Feed hue.** Change `modhost/feed.ts` `FEED_HUES` to 6 together with the shared `projectHue` (S2 item 1). Any golden in `packages/gnomon` tests that pins a hue index moves with it.

**Screenshot check:** `workshop-caps` in footer, right and left, day and night; `?motion=reduced`; and a not-installed state.

## 3. Preview harness fixture states

No fixture preview exists today; the scratchpad `preview.py` boots a real dev kernel. Add one that **never enters the pinned bundle**:

- `packages/gnomon-gui/preview/fixture-transport.ts` implements the client transport. It answers `hello`, `status` and `log.read` from canned rows and accepts `approve` (then emits `approval.decide` after 50ms), which drives the real `GuiStore.apply()` and the unmodified `app.ts`.
- `preview/fixtures/*.json` holds the scenes.
- `scripts/preview.mjs` builds `dist/preview/` and serves it on 127.0.0.1 with `node:http`.
- Card decision keys must verify, so `preview.mjs` makes an ephemeral key pair and signs fixture card actions at build time.
- A test asserts that `gui-bundle.ts` contains no `fixture-transport`.
- Query: `?scene=<name>&theme=day|night&motion=full|reduced&fan=1&play=arrive|approve|voice-hold|fail|cap-walk&workshop=footer|right|left|hidden`.

Scenes:

1. `desk-empty`: no sessions (the S2 empty centre, not the kernel feed).
2. `desk-busy`: 5 active sessions across 5 projects, one per state:
   - **streaming / working** (`turn.partial`, no result) → note `streaming`, cap bobbing;
   - **needs-you** (one pending permission) → `1 card` in warn-ink;
   - **failed** (`session.exited` with an error, plus a failed-session card) → `failed` in vermilion, droop;
   - **idle** (`turn.result`) → `idle`;
   - **KNOT** (`warpline.knot` plus a knot card) → `KNOT`, violet cap and edge.

   Plus 4 past sessions (ended, refused, orphaned, seen). Focused on the needs-you session with a full chat: user message, 6 tool rows (they fold into one activity line), an assistant reply with `took 41s`, and inline code.
3. `pending-permission`: the focused session's permission card pinned above the composer, `🎙 reversible · card 3`, with Allow (primary) and Deny.
4. `stack-4-mixed`: knot (hand-only), failed session (Open session / Retry), permission (voice handle), and gate-class (`🎙 gate` plus a handle word, warn edge). `&fan=1` shows them fanned.
5. `stack-claim-mismatch`: one claim-mismatch card. The red first line stays, Deny is focused, and Deny is not filled.
6. `voice-armed`: ambient armed `VOICE ARMED · REVERSIBLE · 41:10 [Disarm]`, plus `voice-ptt`, `voice-off` and `voice-crashed`, plus `voice-hold` (card 3 in its 3s held countdown).
7. `workshop-caps`: needs-you caps (permission `3`, failed `✕`, KNOT `◆`, gate `!`) and working caps (2 streaming, 1 still, 1 local outlined); plus `workshop-paused` (`⏸ mod hello paused`) and `workshop-absent`.
8. `narrow`: `desk-busy` at 860px with each drawer open.
9. `kernel-owned-hidden-attempt`: the layout preset `focus` with every pane hidden. The voice indicator, risk badge, conn readout, mode button and a held countdown must still be visible (assert this in a test as well as on screen).

## 4. Re-open with the founder (default = approved direction; builders proceed on the default)

1. **Live-mic colour.** Shipped ambient voice uses a vermilion edge, a pulsing dot and a ring. The direction says amber = armed and vermilion = failure only, and "nothing idles". **Default: amber, static** (it also matches the macOS orange mic dot). If you want red for "the mic is live", it becomes a second meaning for vermilion and needs a rule change.
2. **Approval stamp ink.** The comp stamps `APPROVED` in sea-grey ink `#3F6664`, which is a project hue ink used as a state. That conflicts with "a project hue is identity, never state". **Default: the comp value** (`--stamp`). The alternative is the neutral `--ink2` stamp.
3. **Session names.** The comp shows human names (`billing-form`); the kernel has none. **Default: the first user message, 28ch**, falling back to `repo · hsid4`. The alternative is an optional name field in `+ New session` (it is a kernel field, so it needs a spec change).
