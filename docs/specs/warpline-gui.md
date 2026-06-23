# Warpline Web GUI — plan (team-converged: Arky · North · Mika)

> Status: PLAN (pre-build). Architecture Arky · MVP/roadmap North · visual language Mika.
> Companion to `warpline-engine.md` (the engine) + `warpline-flows.md` §2 (the cockpit
> surfaces). Builds on the SHIPPED render-by-projection substrate (`paradigm graph slice`
> + the `.graph` projector) and the Platform server's section pattern.

## Decision in one line
The Warpline GUI is a **new section in the existing Platform** (`paradigm serve`), and the
**MVP is the Oracle Divergence Viewer** — the one screen where "git sees bytes, Warpline sees
meaning" is the whole page: *git merges CLEAN, Warpline catches a real break*.

## 1. Architecture (Arky) — a Platform section, three data layers
A section (not a standalone app) — the renaissance exists to UNIFY surfaces; a separate
Warpline server contradicts it. The Platform chassis already has the right shape: per-section
`/api/<x>` routers, a WS broadcast bus, SPA section-gating, port retry. Warpline sits beside
Tasks/Graph/Lore/Git as a peer.

Three data layers, by latency/cost:
- **(A) Ledger reader (historical, ship first):** read the append-only `.warpline/oracle.jsonl`
  + `fs.watch` → emit `!oracle-record-appended` over the existing WS bus for live repaint.
  Zero compute, zero git contact. Version-guard on `OracleRecord.schemaVersion` (skip unknown
  rows, never crash).
- **(B) Live compute router (`/api/warpline`):** import the **already-exported** engine fns
  **in-process** (NOT shelling the CLI) — `forecast(A,B)` (fast, ephemeral, no ledger write),
  `oracle(A,B)` (full git-reality, appends ledger → fires WS), `semanticDiff(A,B)`,
  `absorb(ref)`. GET + compute-only POST. **No reachable write path** — the `weave` write verb
  exits 2; the router must never construct it. Read-only is therefore *structural*, not
  policed.
- **(C) Render-by-projection:** reuse `graphSliceFromRoot` for the Lightbox blast-radius and
  the Tapestry — a knot's blast radius IS a real `mode:'ripple'` graph slice, not improvised
  mermaid. The symbol-graph substrate arc already shipped this.

**Contract:** expose the engine's existing JSON shapes verbatim — `OracleRecord`, `Forecast`,
`SemDiffReport`, `WarpState` (serialize the in-mem Map via `serializeState`), `Knot`, `Dangle`.
The UI imports the types; it does not redefine them.

**Biggest risk:** temp-worktree contention under interactive fan-out (every `absorb` spins
`git worktree add` + a full parse). Mitigate: (1) an in-process concurrency semaphore (~2–3);
(2) a **per-`stateId` WarpState cache** — absorb is deterministic, so same ref+treeSha → cached
result (highest-leverage, aligns with the content-addressed design); (3) default the Bridge to
`forecast` (no git merge) not `oracle`.

## 2. MVP + roadmap (North) — acquisition → retention → team
**MVP: the Oracle Divergence Viewer.** It's the only candidate whose payload is a *scored
disagreement with git's own live output* — "we ran your tool and it shipped a break." A
correctness argument (a skeptic can't shrug it off), not the diff's comfort argument. Backed by
the already-passing divergence proof (code-level: `test/code-divergence-proof.test.ts`).

Roadmap (the cut-line between #3 and #4 is bright — render only real data):
1. **Oracle Divergence Viewer** — acquisition / the correctness proof. Real now.
2. **Semantic-diff viewer** — comfort: rename/move = the EMPTY delta (zero noise), code-body
   change = a real delta. Real now. The daily-driver hook.
3. **Weave forecast** — workflow: pre-merge clean-vs-knots. `oracle`-backed, real now.
4. **The Tapestry** (woven history) — retention. **Needs the write path + Classroom field
   outcomes** → defer (would be chrome over absent data today).
5. **The Bridge / Lightbox** (scrutiny-heat / knot decision cards) — team. **Needs the trust
   ledger + endorsement primitive** (SCRUTINY = fragility×(1−trust) is Classroom-gated) → defer;
   if built early, ship a clearly-LABELED proxy (knot/dangle density + blast-radius), never
   fake scrutiny.

**First user:** the founder dog-fooding THIS repo on the existing divergence fixture — which
*selects* the Oracle as MVP (it's the only surface this repo can show truthfully; no
write-path history or calibration actuals exist here yet for the Tapestry/Bridge).

**30-second demo:** two branches on one real `.ts` file (A renames `getUser`→`fetchUser`; B
adds a call to `getUser()`). Left = git: press merge → green CLEAN ✓ (live, real git). Right =
Warpline: DIVERGENT, the dangling call to the deleted symbol highlighted. Kicker: *git merged a
break; Warpline saw the meaning git can't.*

## 3. Visual language (Mika) — meaning vs bytes, on a split screen
Extends the EXISTING vision-page brand (`docs/loom/index.html`): Fraunces (display/meaning),
JetBrains Mono (bytes), warp-amber / weft-teal / seam-violet. (The page still says "Loom" — it
needs the Warpline retheme; the GUI inherits the rethemed tokens.)

- **The core opposition:** a hard vertical split. **Left = git/bytes** — monospace, muted, the
  *unreliable narrator*, with a confident green `CLEAN ✓` trap chip. **Right = Warpline/meaning**
  — serif headers, woven motifs, the `DIVERGENT` verdict + the break rendered. **The seam** is a
  1px violet thread down the middle that *pulses* on `divergeMeaningOnly`. The hero moment: two
  trusted oracles contradict, both visible at once.
- **The confusion matrix as a literal 2×2** (git clean/conflict × meaning clean/knot). The two
  agree diagonals are calm; `divergeGitOnly` = amber (git's false positive); **`divergeMeaningOnly`
  = seam-violet, the one cell allowed to glow** (git's false negative — the thesis). Cell counts
  are clickable → list the real symbols (falsifiable; per Loid). Score always sits next to the
  raw counts (no lone vanity 0.78).
- **The KNOT:** two intent-threads (amber A / teal B) cinching one symbol node; `conflictingSlots`
  are the taut strands. Motion: pulls tight ONCE, then a still tension-tremor (stuck, not busy).
- **The DANGLE:** a thread severed mid-span, fraying, drifting once under gravity into a
  violet-ringed void where the retired symbol was (`retiredBy` shown). The product's emotional core.
- **The EMPTY DELTA:** git churn (142 lines moved) vs intentional whitespace + `∅` + the SAME
  contentId both sides (`#a1f0 → #a1f0`) — restraint sells the "nothing changed" punchline.
- **Rejected (pretty-but-wrong):** the full WARP graph as home (a force-directed hairball whose
  non-deterministic layout *contradicts the determinism thesis* — graph is a slice-scoped
  drilldown only); animating matrix counts (implies an uncertain result); literal cloth/rope
  textures (keep the metaphor structural — 1.5px vector strokes); a git red/green diff as the
  primary meaning view (concedes the frame we're replacing).

## 4. Build plan (the thin vertical slice first)
- **Sub-phase 0:** register `'warpline'` in the Platform section sets; a `warpline-web-types.ts`
  re-exporting the engine types.
- **Sub-phase 1 (the slice):** `routes/warpline.ts` (read-only: `/ledger`, `/refs`, `/forecast`,
  `/oracle`, `/diff`, `/absorb/:ref`, `/slice`) + the ledger reader + the concurrency semaphore +
  the stateId cache. A trivial `/ledger` table UI proves the loop end-to-end with zero new visual
  code.
- **Sub-phase 2:** the Oracle Divergence Viewer UI (the meaning-vs-bytes split, the 2×2, the
  knot/dangle render, drill-down to the broken call) + WS live repaint.
- **Sub-phase 3:** the semantic-diff viewer + the weave-forecast panel.
- **Sub-phase 4:** router supertest coverage (each endpoint returns the engine shape; `/forecast`
  never writes a ledger row; no reachable write path; the semaphore caps concurrency).

## 5. Prerequisites / dependencies
- The engine lives on `warpline-ast-spike` (off main, unmerged) — the GUI targets that branch, or
  merge it to main first (recommended, as experimental — like the engine merge).
- The vision page + `loom-presentation` branch still say "Loom" → retheme to Warpline (the GUI's
  brand tokens come from there).
- The Tapestry/Bridge are gated on the write path + Classroom trust ledger (Loom arc fork B) — do
  not build them until that substrate exists.
- No portal gates in Phase 1 (read-only, localhost). A future weave/offer-over-HTTP phase needs
  `^weave-admissible` + `^trusted-author` (the WEAVE-LAW trust predicate) — flag it then.
