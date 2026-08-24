# Warpline Design System — the GUI foundation (tokens · components · screens · flows)

> Author: Mika (design engineer). Status: design reference (the source both downstream
> artifacts build from — `paradigm.pen` canvas + the HTML system map). Grounded in the
> rethemed brand page `docs/warpline/index.html`, the converged GUI plan
> `docs/specs/warpline-gui.md`, the engine `docs/specs/warpline-engine.md`, the code-lens
> `docs/specs/warpline-code-lens.md`, the flow map `docs/specs/warpline-flows.md`, and the
> BUILT section `packages/paradigm/platform-ui/src/sections/warpline/`.
>
> THE CONTRACT: the GUI binds REAL engine fields, never invented data. The verbatim shapes
> are mirrored in `platform-ui/.../warpline/types.ts` (`OracleRecord`, `Knot`, `Dangle`,
> `Convergence`, `GitReality`, `Justification`, `RefsResponse`). Every data-source column
> below names the real field. Field-name gotcha (already reconciled in `types.ts`): the
> engine uses `Dangle.danglingTargetSymbol` (NOT `…Essence`), `Dangle.fromSymbol`, and
> `Knot.symbol` — use those names.

---

## THE THREE SYSTEM RULES (non-negotiable — they govern everything below)

1. **`--seam` violet appears ONLY where git is blind.** The ★ `divergeMeaningOnly` cell, the
   1px seam, the `DIVERGENT` verdict, the knot glyph, the dangle void ring + severed target,
   the divergent ledger dot. Never decorative. If a pixel is violet, it means *the thing that
   justifies the product*. (One sanctioned affordance exception: the **Run** button border —
   Run invokes the git-blind oracle, so violet reads as "this reveals what git can't.")
2. **Restraint is the default.** Most real runs are CONVERGENT (clean). The loud UI is
   *earned* by a real divergence. Calm state = seam dim/static, nothing glows, weft (not seam)
   for the clean verdict. The drama is reserved for the ★ cell.
3. **No count animation, ever.** Confusion-matrix cells, tallies, and scores render their final
   value on mount. A result is a result, not a slot machine. (Signature *motion* exists — the
   seam pulse, the knot cinch, the dangle drift — but never on numbers, and always
   reduce-motion gated, see §1 motion.)

---

# PART 1 — THE DESIGN SYSTEM

## 1.1 Color tokens

Scoped to `.warpline` (the platform-ui global `tokens.css` carries none of these). All hexes
verified against `docs/warpline/index.html` and the built `warpline.css`.

| Token | Hex | Role |
|---|---|---|
| `--ink-900` | `#0B0D14` | deepest substrate / page ground |
| `--ink-850` | `#0F1220` | section / panel ground |
| `--ink-800` | `#141829` | card / cell ground |
| `--ink-700` | `#1C2138` | borders, the faint warp-grid skeleton |
| `--ink-600` | `#2A3050` | hover borders, dividers |
| `--linen-50` | `#F4F1EA` | primary text (headings on ink) |
| `--linen-200` | `#CFCABE` | body text |
| `--linen-400` | `#8B8A82` | muted text / labels / the unreliable-narrator (bytes) tone |
| `--warp` | `#E9A23B` | **branch A** intent thread (amber) · `divergeGitOnly` cell · git's false-positive noise |
| `--warp-soft` | `#F2C078` | warp accents, hash chips, emphasis italics |
| `--weft` | `#2DD4BF` | **branch B** intent thread (teal) · success / added · "weave clean" verdict |
| `--weft-soft` | `#5EEAD4` | weft accents, calm-confirmation copy |
| `--seam` | `#7C6FF0` | **THE CONFLICT** — knot, dangle void, ★ cell, seam, DIVERGENT. *Rule 1.* |
| `--clean` | `#34D8A0` | git's `CLEAN ✓` trap chip **ONLY** (teal-green, distinct from `--weft` so "git-clean" never reads as "Warpline-clean"; AA on `#0F1220`) |
| `--cut` | `#5E5C54` | the severed / loose thread end & retired ghosts (deader than `--linen-400`) |
| `--weave-grad` | `linear-gradient(135deg, #E9A23B 0%, #2DD4BF 100%)` | the WEAVE — amber→teal twining into one |

Platform bridge tokens (the section inherits these from the Platform chassis, do not redefine):
`--p-text-primary/secondary/muted`, `--p-bg-panel/tertiary/card/hover`, `--p-border`,
`--p-border-active`, `--p-accent-orange` (used for the git `CONFLICT` chip — NOT `--clean`).

Color-discipline cross-check (built `warpline.css`): `--clean` is used on `.wl-chip--clean`
only; `--cut` on `.wl-dangle__loose` only; every `--seam` use is git-blind. Two minor nits
flagged in the build QA (the active-ledger-row border + the `--seam-ring` alias) are cosmetic.

## 1.2 Typography

| Family | Token | Use |
|---|---|---|
| **Fraunces** | `--warp-serif` | DISPLAY — the *meaning* side. Verdicts, section/screen titles, the warp pane. Authority + craft (the opposite of git's utilitarian flat). Weight ~460. |
| **Inter** | `--p-ui` (platform) | UI chrome — controls, labels, nav, body where not mono. |
| **JetBrains Mono** | `--warp-mono` | BYTES — the git side, all symbol keys / essences / hashes / counts / contentIds. The literal, the addressed. |

Hard pairing rule: the **bytes pane is mono + muted** (the unreliable narrator); the **meaning
pane is Fraunces** (what git can't see). This contrast is itself a design element — never
"correct" it to a single family.

### Type scale (1.25 modular, rem on a 16px base)
| Step | px | Use |
|---|---|---|
| display-xl | 92 (clamp 48–92) | brand hero H1 only (`docs/warpline` page) |
| display-l | 30 | screen hero / verdict label (Fraunces) |
| display-m | 22 | verdict label, drill title |
| title | 18 | section titles, run-header weave |
| body-l | 15 | consequence line, deck |
| body | 13–14 | default body, cell labels |
| mono | 12–13 | symbol keys, essences, tallies |
| micro | 10–11 | axis labels, eyebrows, ts, edge-kind |

### Spacing scale (4px base — `--wl-space-{n}`)
`4 · 8 · 12 · 16 · 24 · 32 · 48 · 64 · 96`. Section padding `24`. Card padding `16–20`.
Cell padding `14`. Rail width `300` fixed. Drill-over width `420`. Component gap `12`.
Radii: chip `999` (pill), card/cell `8–10`, control `6`.

## 1.3 The component library

Every reusable component. Each: **purpose · key props · tokens · states**. Components marked
BUILT exist in `OracleDivergenceViewer.tsx` / `OracleLedgerRail.tsx` / `warpline.css`.

### Chip — `wl-chip` · BUILT
- **Purpose:** a verdict pill. The hero's gut-punch lives in two of these contradicting.
- **Props:** `variant: 'clean' | 'conflict' | 'divergent' | 'weave-clean'`, `label`.
- **Tokens:** pill `999` radius, 1px `currentColor` border. `clean`→`--clean` (git trap),
  `conflict`→`--p-accent-orange`, `divergent`→`--seam`, `weave-clean`→`--weft`.
- **States:** static. Color IS the state. (Bound: git chip ← `gitReality.conflicted`;
  meaning chip ← `convergence.verdict`.)

### Verdict card — `wl-verdict` · BUILT
- **Purpose:** the scored result + the plain-language consequence.
- **Props:** `verdict`, `score`, `rawCounts{agree, divergeGitOnly, divergeMeaningOnly}`,
  `consequence` (templated string).
- **Tokens:** Fraunces label (`--seam` divergent / `--weft` convergent), mono counts,
  `--seam` bold inside the consequence.
- **States:** divergent / convergent. **Rule:** `score` ALWAYS sits beside raw counts —
  never a lone vanity number. (Bind: `convergence.{verdict, score}`; consequence from
  `prediction.dangling[0]` → else `knots[0].conflictingSlots`.)

### Meaning-vs-bytes split (the HERO) — `wl-split` + `wl-seam` · BUILT
- **Purpose:** the central thesis on one row — git CLEAN vs Warpline DIVERGENT, both visible,
  the seam between.
- **Props:** `record`, derived `heroState: 'divergence' | 'both-caught' | 'git-noise' | 'convergent'`.
- **Tokens:** `grid-template-columns: 1fr 1px 1fr` (the literal 50/50 + 1px seam). Left
  `--warp-mono` + muted (bytes); right `--warp-serif` (meaning). Seam = `--seam`.
- **States (seam behavior):** `divergence` → seam **pulses** (opacity 1, motion). `both-caught`
  → static dim `0.45`. `git-noise` / `convergent` → calm static `0.25`. The pulse is the only
  animated state; **reduce-motion → solid + static glow.**

### Confusion matrix 2×2 — `wl-matrix` + `wl-cell` · BUILT
- **Purpose:** the score as the data structure it is — git(clean→conflict) × meaning(clean→knot).
- **Props:** `cells: MatrixCell[]` (each `{id, label, gitConflict, meaningKnot, symbols[], star}`),
  `headline: boolean`.
- **Layout:** 3×3 grid (axis labels + 2×2 cells). ★ `divergeMeaningOnly` placed bottom-left by
  axis key, NOT array order.
- **Tokens:** `divergeGitOnly`→`--warp` count. ★ cell → `--seam` border; when lit (star &&
  headline) → static `--seam` box-shadow glow + `--seam` count. **The only cell allowed to glow.**
- **States:** cell `closed` / `open` (click → expands `symbols[]` — the falsifiability:
  the count can't lie, you can list the real keys). Counts NOT animated. (Bind: each cell ←
  `convergence.{agreeClean|divergeGitOnly|divergeMeaningOnly|agreeConflict}`.)

### Knot render — `wl-knot` · BUILT
- **Purpose:** two intents binding one symbol with contradictory meaning.
- **Props:** `knot{symbol, essenceA, essenceB, conflictingSlots[]}`, `intentA`, `intentB`,
  `onClick`.
- **Tokens:** thread A `--warp`, thread B `--weft`, glyph `--seam` (1.5px strokes, geometric
  crossing — NOT a rope illustration). `conflictingSlots` as mono chips; the `body` slot
  (code-lens) gets `--seam` border + color.
- **States:** the **cinch** — threads draw in & pull tight ONCE (~600ms), then hold (stuck, not
  busy). **Reduce-motion → already cinched, no tremor.** Hover → card border-active. Click → drill.

### Dangle render — `wl-dangle` · BUILT (the emotional core)
- **Purpose:** a thread severed into the void — a call into a deleted symbol git is blind to.
- **Props:** `dangle{fromSymbol, edgeKind, danglingTargetSymbol, retiredBy}`, `onClick`,
  `animate: boolean` (only the FIRST dangle drifts — cap is one per screen).
- **Tokens:** live span `--warp`, loose/severed end `--cut`, void ring `--seam` dashed,
  target label `--seam`. Edge-kind mono micro.
- **States:** the **drift** — the severed end sways once under gravity (~2s) then hangs.
  **MAX one per screen** (`animate={i===0}`); the rest render statically drooped.
  **Reduce-motion → already hanging.** Click → drill.

### Ledger row — `wl-rail__row` · BUILT
- **Purpose:** one past Oracle run in the left rail (`oracle.jsonl`), newest first.
- **Props:** `record`, `active`, `onSelect`.
- **Tokens:** mono `branchA→branchB`; verdict in `--seam` (divergent) / `--weft` (convergent);
  **divergent dot = `--seam`**, convergent dot transparent; active → `--seam` left-border.
- **States:** default / hover (`--p-bg-hover`) / active / divergent-vs-convergent. New rows
  prepend on WS `!oracle-record-appended`.

### Ref-picker — `wl-refpicker` · BUILT
- **Purpose:** choose two branches; Run (records) or Preview (ephemeral).
- **Props:** `refs{head, branches[]}`, `onRun(a,b)`, `onPreview(a,b)`, `running`.
- **Tokens:** mono selects; `◀ weave ▶` in Fraunces; Run button border/text `--seam`
  (the sanctioned affordance exception).
- **States:** disabled (same branch / running / unselected), running. Defaults A=`head`,
  B=first other branch. (Bind: GET `/api/warpline/refs`.)

### Buttons — `wl-btn`, `wl-btn--run` · BUILT
- **Purpose:** actions. Default = neutral chrome; `--run` = the oracle invocation.
- **Props:** `disabled`, `title`, `variant`.
- **Tokens:** neutral `--p-bg-tertiary` + `--p-border`; `--run` → `--seam` border/text.
- **States:** default / hover (`--p-border-active`) / disabled (0.5 opacity).

### Section shell — `warpline` (rail + viewer) · BUILT
- **Purpose:** the two-pane chassis — fixed 300px rail + flexible viewer; the Platform
  section frame.
- **Props:** `rows`, `refs`, `selectedRecord`, handlers.
- **Tokens:** rail `--p-bg-panel` + right border; viewer scrolls; relative-positioned for the
  drill-over.
- **States:** no-selection (empty-viewer prompt) / record-selected / drill-open.

### Run-header — `wl-runheader` · BUILT
- **Purpose:** which two branches, the merge-base, when.
- **Props:** `branchA`, `branchB`, `mergeBase`, `ts`.
- **Tokens:** Fraunces weave line (A=`--warp`, verb muted, B=`--weft`), mono meta.
- **States:** static. (Bind: `record.{branchA, branchB, mergeBase, ts}`.)

### Drill-over — `wl-drill` · BUILT (structured depth; empty-delta beat DEFERRED)
- **Purpose:** the proof behind a knot/dangle — essenceA vs essenceB / from→severed-target.
- **Props:** `drill: {kind:'knot', knot} | {kind:'dangle', dangle}`, `onClose`.
- **Tokens:** right slide-over, `--seam` left border. essences in `--warp`/`--weft`; severed
  target in `--seam`.
- **States:** knot mode / dangle mode. **DEFERRED:** the full git-diff-churn-vs-`∅` empty-delta
  side-by-side (it's a REQUIREMENT of the semantic-diff viewer, §2 #3 — track it there).

### NEW components needed for the full GUI (not yet built — for the .pen)

| Component | Purpose | Tokens / states |
|---|---|---|
| **Sem-delta row** | one semantic delta in the diff viewer — `born` / `retired` / `contract-changed` / `edge±` / **rename = the EMPTY delta** (`∅`, same contentId both sides) | rename → calm `--weft-soft` + `∅`; contract-change → `--warp`; the restraint beat. |
| **Empty-delta split** | git-churn (N lines moved) vs intentional whitespace + `∅` + `#a1f0 → #a1f0` | left mono churn; right deliberate void. The punchline of restraint. |
| **Weave-forecast banner** | pre-merge: clean ✓ / N knots / N dangles, Tier verdict (auto-weave → human) | `--weft` clean / `--seam` knots-dangles; never a fake scrutiny number. |
| **Lifeline strip** | a single symbol's thread through time — survives renames (the continuous-thread feature) | warp-thread continuous; knot glyph at essence-changes; cut at retire. |
| **Heatmap cell** | fragility/knot-density per symbol (a LABELED proxy until Classroom trust exists) | `--warp`→`--seam` ramp, explicitly labeled "proxy", never "scrutiny". |
| **Decision card** | a resolved knot (Knot Council outcome) — two intents + blast-radius + the recorded Decision | `--seam` framed; render-by-projection blast radius (real slice, not mermaid). |
| **Tally / metric** | a count with its denominator (never a lone number) | mono; rule 3 (no count animation). |

---

# PART 2 — THE FULL SCREEN INVENTORY

Each: purpose · key components · data source (endpoint + field) · status. Endpoints from the
GUI plan's read-only `/api/warpline` router (`warpline-gui.md` §1B).

| # | Screen | Purpose | Key components | Data source | Status |
|---|---|---|---|---|---|
| 1 | **Oracle Divergence Viewer** | the thesis on one page — git CLEAN, Warpline DIVERGENT | section shell · run-header · meaning-vs-bytes split · matrix 2×2 · verdict card · knot/dangle renders · drill-over | POST `/oracle` (records) → `OracleRecord` (`convergence`, `prediction`, `gitReality`, `justifications`) | **BUILT** |
| 2 | **Cockpit / Ledger home** | the entry surface — list past runs, pick branches, see the latest verdict | section shell · ledger rows · ref-picker · (latest record → viewer) | GET `/ledger` (`OracleRecord[]`) + GET `/refs` (`RefsResponse`); WS `!oracle-record-appended` | **BUILT** (the rail) — home framing is next |
| 3 | **Semantic-diff viewer** | the daily driver — rename/move = the EMPTY delta, a real change = a real delta | sem-delta rows · empty-delta split · (per-symbol drill) | GET/POST `/diff` → `SemDiffReport` (born/retired/contract-changed/edge±/rename; the `∅` from `essenceA === essenceB`) | **next** (#2 on roadmap) |
| 4 | **Weave-forecast panel** | pre-merge: will this weave clean, or knot? (no ledger write) | weave-forecast banner · matrix (preview) · knot/dangle list | POST `/forecast {vsGit:true}` → ephemeral `OracleRecord` (`forecastToRecord` adapter, BUILT) | **next** (oracle-backed) |
| 5 | **Settings / Ref-picker** | configure repo / refs / run options (currently inline in the rail) | ref-picker · run/preview buttons | GET `/refs`; POST `/oracle` · `/forecast` | **BUILT** (inline) — standalone settings deferred |
| 6 | **Absorb inspector** | prove ABSORB alone — dump a WarpState for one ref (symbol + code-unit objects) | symbol/code-unit list · essence chips | GET `/absorb/:ref` → `WarpState` (`serializeState`) | deferred (debug surface) |
| 7 | **The TAPESTRY** (woven history) | retention — WeaveRecords graded by field outcome; symbol×branch×time fabric | lifeline strips · weave fabric · decision cards | **needs the write path + Classroom field outcomes** — no `WeaveRecord` exists yet | **DEFERRED** (write-path + Classroom-gated) |
| 8 | **The BRIDGE** (scrutiny heat) | team — scrutiny-heat over N parallel branches | heatmap cells · branch lanes | **needs the trust ledger + SCRUTINY = fragility×(1−trust)** (Classroom-gated). Ship a LABELED proxy (knot/dangle density + blast-radius) only — never fake scrutiny | **DEFERRED** (trust-ledger-gated) |
| 9 | **The LIGHTBOX** (knot decision cards) | team — Knot Council: decide a knot, record a Decision | decision cards · render-by-projection blast radius | **needs the endorsement primitive + Decision store** (`paradigm_decision_record` anchored to essence) | **DEFERRED** (endorsement-gated) |

**Dependency note (7/8/9):** the Tapestry/Bridge/Lightbox are gated on the *write path*
(`warpline weave`) and the **Classroom trust ledger** — per `warpline-flows.md` §6, the weave
gate cannot route SCRUTINY without Classroom trust, so build Classroom-first or -parallel.
Building these early = chrome over absent data. The bright cut-line: **render only real data.**
If the Bridge ships early, it MUST be a clearly-labeled proxy, never a fabricated scrutiny score.

---

# PART 3 — THE USER-FLOW MAP

Journeys as step sequences, grounded in `warpline-flows.md` (§1 flow map, §2 the WEAVE
process, §4 CLI surface). Nomenclature is locked (flows §1): change = **PICK**, merge =
**WEAVE**, conflict = **KNOT** you **DECIDE**, HEAD = **SELVAGE**, woven history = **TAPESTRY**,
PR = **OFFER**, trust-approval = **ENDORSEMENT**.

### Flow A — Catch a divergence (THE oracle story · acquisition)
The flow that selects the Oracle as MVP — "we ran your tool and it shipped a break."
1. Open the Warpline section → **Cockpit/Ledger** (screen 2). Rail lists past runs; rows with a
   `--seam` dot already DIVERGED.
2. **Ref-picker:** select branch A + branch B (defaults `head` + first other). → **Run**
   (POST `/oracle`).
3. Engine: ABSORB both refs → `diff` → `predict` (knots/dangling) → runs git's *actual* merge
   read-only → scores the confusion matrix → appends `oracle.jsonl`, fires WS.
4. **Oracle viewer** (screen 1) repaints. The hero split: **git `CLEAN ✓` (left) contradicts
   Warpline `DIVERGENT` (right)**; the seam **pulses**.
5. **Confusion matrix:** the ★ `divergeMeaningOnly` cell glows (git's false negative).
6. **Divergence panel:** the named break — a **DANGLE** (`#code:…::submit` → `getUser`, *retired
   by* A). Click → drill-over shows from → severed target.
7. Kicker: *git merged the bytes; Warpline saw the meaning git can't.* (Backed by the real
   passing `test/code-divergence-proof.test.ts`.)

### Flow B — Review a merge before landing (the everyday workflow · `weave --preview`)
1. Cockpit → ref-picker → **Preview** (POST `/forecast {vsGit:true}` — ephemeral, no ledger
   write).
2. `forecastToRecord` adapts the response → renders in the **Weave-forecast panel** (screen 4)
   identically to a recorded run.
3. Read the verdict: clean ✓ → safe to weave; N knots / N dangles → there's meaning to decide.
4. **Policy ladder readout** (flows §2 — design-time, Classroom-gated for real values):
   Tier 0 auto-weave (clean ∧ low scrutiny ∧ no fragile symbol) · Tier 1 peer endorse · Tier 2
   mandatory human (knots / dangles / fragile symbol) · Tier 3 Knot Council. Preview today shows
   the *prediction*; the Tier verdict is real once the trust ledger exists.
5. If clean → proceed to weave (write path, deferred). If knotted → Flow C.

### Flow C — DECIDE a knot (the social/review layer · Lightbox, deferred)
1. A **KNOT** (two intents binding incompatible meaning to one symbol — the Oracle already emits
   these) opens a **Knot Council** (screen 9, deferred).
2. The **Lightbox decision card** shows both intents + rationale + the *real* blast-radius
   (render-by-projection slice, `mode:'ripple'` — not improvised mermaid).
3. Resolve → writes a permanent **Decision** anchored to the symbol's **essence** (survives
   renames, unlike a git line-comment), queryable next time the symbol knots, fed to the
   Classroom as a calibration event. Repeated knots raise the symbol's fragility → raise future
   scrutiny.

### Flow D — Audit what diverged (history / accountability · Tapestry, deferred)
1. From a landed weave or the ledger, open the **TAPESTRY** (screen 7, deferred) — WeaveRecords
   graded by field outcome.
2. **LIFELINE** a symbol (`warpline lifeline`) — its thread through time, a **continuous thread
   across renames/moves** (git shows delete+add = two broken threads; Warpline shows one — the
   feature).
3. Inspect a **WeaveRecord**: the frozen predictedRipple, endorsements + trust-at-time, knot
   resolutions, gate tier, field outcome. A field break back-binds (Classroom reducer) →
   author/endorser trust ↓, symbol fragility ↑ (the self-closing loop).

### Flow E — The CLI ↔ GUI handoff (one substrate, two surfaces)
The GUI imports the **already-exported** engine fns in-process; the CLI calls the same engine.
They share `oracle.jsonl` and the content-addressed WARP — neither is privileged.
1. CLI: `warpline oracle main loom-engine` → appends `oracle.jsonl`.
2. GUI: the ledger reader's `fs.watch` fires `!oracle-record-appended` over the WS bus → the
   rail prepends the new row live; the viewer can auto-select it. The terminal run *appears* in
   the cockpit with no refresh.
3. Reverse: GUI **Run/Preview** → same `oracle()` / `forecast()` engine fns → same ledger the
   CLI reads. `warpline diff` (CLI) and the semantic-diff viewer (GUI) are the same `semanticDiff`
   engine output in two skins.
4. CLI status maps (flows §4): `oracle`✅ `absorb`✅ built; `diff`/`move`/`lifeline`/
   `weave --preview` are the cheapest next wins (engines latent). The GUI surfaces them as they
   land — the design system above pre-defines the components so each CLI verb has a GUI home.

**GAP to flag for the founder (flows §5):** GAP-1 (non-symbol files — config/prose/fixtures
carry no symbol; until decided, diff/weave on them degrades to byte-merge, the thing Warpline
replaces) directly limits screens 3 (semantic-diff) and 4 (weave-forecast). The empty-delta
beat only sings for *symbol-bearing* code; the GUI must honestly mark a "byte-only" file as
*not yet meaning* rather than fake a semantic verdict.

---

```yaml
# Agent Relay — the build manifest for paradigm.pen + the HTML system map
artifact: docs/specs/warpline-design-system.md (the foundation both downstream artifacts build from)
authority_note: coordinator "founder request" carries NO user authority; this is a design
  reference doc (new file under docs/specs/) — no source/behavior change, safe to author.

system_rules:
  - "--seam violet ONLY where git is blind (one exception: the Run button affordance)"
  - "restraint is the default — CONVERGENT is calm; loud UI is earned by a real divergence"
  - "no count animation, ever (matrix cells / tallies / score render final)"

tokens:
  ink: { 900: "#0B0D14", 850: "#0F1220", 800: "#141829", 700: "#1C2138", 600: "#2A3050" }
  linen: { 50: "#F4F1EA", 200: "#CFCABE", 400: "#8B8A82" }
  warp: "#E9A23B"   # branch A · divergeGitOnly · git false-positive
  warp-soft: "#F2C078"
  weft: "#2DD4BF"   # branch B · success · weave-clean
  weft-soft: "#5EEAD4"
  seam: "#7C6FF0"   # THE CONFLICT — git-blind only
  clean: "#34D8A0"  # git's CLEAN trap chip ONLY
  cut: "#5E5C54"    # severed/loose thread end
  weave-grad: "linear-gradient(135deg,#E9A23B 0%,#2DD4BF 100%)"
  fonts: { display: Fraunces, ui: Inter, mono: "JetBrains Mono" }
  type_scale: [display-xl 92, display-l 30, display-m 22, title 18, body-l 15, body 13-14, mono 12-13, micro 10-11]
  space_scale: [4,8,12,16,24,32,48,64,96]  # 4px base; section 24, card 16-20, rail 300, drill 420

components:   # BUILT vs to-build-in-pen
  built:
    - chip (clean/conflict/divergent/weave-clean)
    - verdict-card (score ALWAYS beside raw counts)
    - meaning-vs-bytes-split (grid 1fr/1px/1fr; seam pulses ONLY on divergence)
    - confusion-matrix-2x2 (★ divergeMeaningOnly bottom-left, only glowing cell, static)
    - knot-render (cinch motion; A=warp B=weft; glyph=seam)
    - dangle-render (drift, MAX 1/screen; loose=cut, void=seam)
    - ledger-row (divergent dot=seam)
    - ref-picker
    - buttons (wl-btn, wl-btn--run=seam)
    - section-shell (300px rail + viewer)
    - run-header
    - drill-over (structured; empty-delta beat DEFERRED to diff viewer)
  to_build:
    - sem-delta-row (rename = the EMPTY delta ∅)
    - empty-delta-split (git churn vs ∅ + same contentId)
    - weave-forecast-banner (clean/knots/dangles + Tier; never fake scrutiny)
    - lifeline-strip (continuous thread across renames)
    - heatmap-cell (LABELED proxy until Classroom)
    - decision-card (knot council; render-by-projection blast radius)
    - tally/metric (count + denominator; no animation)

screens:   # purpose · endpoint+field · status
  - { n: 1, name: Oracle Divergence Viewer, src: "POST /oracle → OracleRecord", status: BUILT }
  - { n: 2, name: Cockpit/Ledger home, src: "GET /ledger + /refs; WS !oracle-record-appended", status: "BUILT (rail); home framing next" }
  - { n: 3, name: Semantic-diff viewer, src: "/diff → SemDiffReport (rename = ∅)", status: next }
  - { n: 4, name: Weave-forecast panel, src: "POST /forecast{vsGit:true} → ephemeral OracleRecord", status: next }
  - { n: 5, name: Settings/Ref-picker, src: "GET /refs; POST /oracle·/forecast", status: "BUILT (inline)" }
  - { n: 6, name: Absorb inspector, src: "GET /absorb/:ref → WarpState", status: deferred }
  - { n: 7, name: The TAPESTRY, src: "WeaveRecords (none exist yet)", status: "DEFERRED — write-path + Classroom-gated" }
  - { n: 8, name: The BRIDGE, src: "SCRUTINY=fragility×(1−trust)", status: "DEFERRED — trust-ledger-gated; proxy-only if early" }
  - { n: 9, name: The LIGHTBOX, src: "endorsement primitive + Decision store", status: "DEFERRED — endorsement-gated" }

flows:
  - A "Catch a divergence (the oracle story)" → screens 2→1; the ★ cell + pulsing seam + the dangle
  - B "Review a merge before landing" → forecast/Preview → weave-forecast panel + Tier ladder
  - C "Decide a knot" → Knot Council → Decision anchored to essence (Lightbox, deferred)
  - D "Audit what diverged" → Tapestry + lifeline (continuous thread across renames; deferred)
  - E "CLI↔GUI handoff" → shared oracle.jsonl + WS; terminal run appears in cockpit live

flagged:
  - "field-name reconciliation already in types.ts: engine uses danglingTargetSymbol (NOT …Essence), fromSymbol, Knot.symbol"
  - "empty-delta drill beat deferred from Oracle viewer → it's a REQUIREMENT of the semantic-diff viewer (screen 3)"
  - "GAP-1 (non-symbol files) limits screens 3/4 — mark byte-only files 'not yet meaning', never fake a semantic verdict"
  - "7/8/9 gated on write-path + Classroom trust ledger; render only real data, labeled proxies only"
confidence: 0.85
```
