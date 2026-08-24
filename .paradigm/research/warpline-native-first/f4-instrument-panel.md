# F4 instrument panel — the D-3 widening, ruled

**Date:** 2026-07-31 · **Panel:** Arky (architect), Jinx (advocate), Aegis (security), Shield (qa), North (product), Loid (forge) · **Question:** pre-freeze item 2 — widen the FG-3 freeze from `descriptorsId` to an `instrumentId`.

Successor to [`f4-prefreeze-panel.md`](./f4-prefreeze-panel.md) (2026-07-28), which produced D-1..D-9 and the six-item pre-freeze sequence. This panel was convened on item 2 of that sequence and returned a verdict against it.

**Provenance discipline:** every panelist was required to cite `file:line` and to pre-register a falsifier per answer. Findings below are marked either **[verified-by-Claude]** — independently re-checked against the code in the main session before being recorded here — or **[panel]** — asserted by a panelist with file:line evidence but not independently re-run. `source:external ≠ trust:external`; the firewall is structural.

---

## The verdict in one line

**Item 2 as scoped is rejected — unanimously, by a panel that includes R-1's own author.** The refusal ladders genuinely are outside the hash (D-3 stands), but the prescribed fix conflates objects with different invalidation semantics, names a component that does not exist, and — decisively — widens a freeze that **nothing has ever enforced**.

Arky, amending himself:

```
My own R-1 as recorded at panel line 128 is wrong on two of five components.
The classifier rule-set must NOT be in the frozen id (it makes a scoring
bugfix void a batch) and the corpus hash CANNOT be (seed.ts:11-15 — it does
not exist).
```

---

## The finding that reframes the item

### D-11 — FG-3 is enforced nowhere in the scoring path **[verified-by-Claude]**

Found independently by Shield, Jinx and Loid; re-verified in the main session.

`classifier.ts:266` computes `descriptorsIds: [...new Set(sorted.map(r => r.descriptorsId))]`, and `classifier.ts:80-81` documents it as *"a valid run has EXACTLY one — FG-3."* **Nothing asserts it.** `summarizeBatch` (`completion.ts:159-169`) takes `readonly F4CompletionReport[]` and never sees an id at all; it pools whatever it is handed and divides (`:163`). The only assertions live in two rig-fixture tests (`f4-rig.test.ts:127`, `f4-cli-arm.test.ts:129`).

Jinx's framing: *"The FG-3 pre-registration anchor is a field, not a gate. Widening a field nobody reads buys exactly nothing."*

The entire item-2 debate has been conducted one level above a hash that no code path checks. **Making scoring refuse a mixed-id batch is ~10 lines, is unanimous across the panel, and is independent of every scope question below.** It is the cheapest item on the list and the only one with teeth today.

---

## Programme blockers (outrank every pre-freeze item)

### B-1 — no CI runs Warpline's tests **[verified-by-Claude]**

Root `npm test` is `npm run test --workspace=@a-company/paradigm`; that package's `vitest.config.ts` includes only `src/**`, `tests/**`, and `platform-ui/src/sections/warpline/**`. `packages/warpline/test/` (657 `it(` blocks) is absent. `.github/workflows/ci.yml:34` runs that command. The only workflow touching Warpline is `warpline-guard.yml`, which is `continue-on-error: true` and runs the Guard action, not vitest.

**Consequence:** `test/descriptors-frozen.test.ts` — the FG-3 freeze tripwire — is wired to nothing, and *every* exit criterion this panel and its predecessor have written ("a green CI extension of PW-4") is currently unsatisfiable. North's item 0, ~5 lines, is a hard prerequisite for items 2, 3 and 5.

Upgrades theater flag #1 from "measures the wrong thing" to "measures the wrong thing and is itself unmeasured."

### B-2 — non-Claude MCP client reachability has never been established **[panel]**

`TD-2026-07-21-766` requires ≥2 model families, at least one non-Claude; both amendments (`TD-2026-07-28-168`, `TD-2026-07-29-259`) leave that clause UNCHANGED. North searched: the string "non-Claude" appears in exactly two files (`roadmap-native-first.md:263` and the prior panel doc), there is no pre-registration document anywhere, and nothing in the record names *how* a second family gets driven.

If the answer is no, **F4 as ratified is unrunnable**, and no number of pre-freeze items repairs that. A ~20-minute check with the highest information density available in the arc. *(Probe dispatched 2026-07-31; see Status below.)*

---

## New verified defects

### D-10 — `pick.ts:110` advertises phantom `resolve` params **[verified-by-Claude]**

```ts
steps.push({ verb: 'resolve', params: {}, requires: ['resolvedRef','reason','decidedBy'], principal: 'human' });
```

`resolve`'s actual schema (`descriptors.ts:138-147`) requires `['agentId','reason']`. So the step **omits a required param and advertises two phantoms** — the exact defect PW-3a already fixed in `admit.ts:344-348`, unfixed one file over. PW-4 misses it twice: `pick.ts` is not in `emittedRefusals()` (`refusal-vocabulary-totality.test.ts:48-78`), and the params-coverage check skips non-agent verbs (`:105`), so even inclusion would not have caught it.

### D-12 — the CLI arm cannot observe cross-image instrument divergence **[panel]**

`f4-cli-arm.test.ts:36` drives `dist/cli.js` in a child process while classification reads `src/`. Every row in that arm comes from one process image, so `descriptorsIds.length === 1` holds **trivially** even when `dist` is stale relative to `src`. The precondition passes by construction rather than by verification.

### D-13 — the instrument punishes compliance with its own ladder **[panel]**

`CLAIM_BREACH` defaults to `retriable: 'retry-with-override'` (`refusal.ts:306`; `claimRefusal` at `admit.ts:429-442` does not override it). The classifier's W1 ladder-progress exemption fires **only** on `'retry-corrected'` (`classifier.ts:187`). So an agent that walks the CLAIM_BREACH ladder correctly and re-admits against the advertised `claimId` **is scored W1**.

This biases every run before a single one is scored, and it is not a teaching defect — it is a ruler defect.

### D-14 — an FG-2 truncated arm would stamp the SAME id as the control **[panel]**

`mcp/server.ts:179` registers `description: VERB_DESCRIPTORS[verb].summary`. If the FG-2 names-only arm is implemented the obvious way — omit the description at registration — then `VERB_DESCRIPTORS` is untouched, `descriptorsId()` returns the identical string, and **two different treatments carry one attestation**. Precisely the failure FG-3 exists to prevent, reappearing inside the gate meant to prevent it. Loid: this makes his own ≤10pp delta framing uncomputable, and the fix (an `descriptionsStripped` discriminator inside the hashed surface) belongs in item 2, not in FG-2's implementation.

### D-3 undercounts the carrier **[panel]**

Not four ladder-bearing files — **six**, with 18 `refuse(` sites: `admit.ts` 3, `native.ts` 7, `pick.ts` 3, `mcp/refusals.ts` 2, `mcp/server.ts` 1, `daemon/server.ts` 2. PW-4 covers **10 of 18**, and its `native.ts` entries are *pinned literal mirrors* (`refusal-vocabulary-totality.test.ts:56-73`), not the real ladders — hashing that inventory would hash a proxy of a proxy. D-3's defect at a third level.

Arky's honest restatement of D-3's "roughly two-thirds": **the unhashed portion is 19 of ~34 discrete teaching units, and 100% of the field W3 reads.**

---

## Corrections to the prior panel record

1. **D-2 is CLOSED.** `mcp/server.ts:196-211` now emits a trace row *before* the throw, coding `FORBIDDEN` for omitted human verbs; `:221-222` records `HUMAN_ONLY_ADMIT_FLAGS` into `target`, so `/accept(Breach|Risk)/` at `classifier.ts:198` can match. Both W3 forms are observable on MCP. Fixed by `93af1d99`. *(Arky and Aegis verified independently.)*
2. **D-4 is HALF closed.** Its parenthetical "(verified — no `resolve` entry in `CLI_VERB_MAP`)" is now **false**: `cli-trace.ts:65` has it. The *measurement* half is fixed; the *enforcement* half stands — native CLI `resolve` still has no principal gate.
3. **D-1 falls OUT of the pre-pin set.** `completion.ts:99-103` made predicate (2) conditional on `payloadAdvertised`, so the byte-downgrade stratum no longer caps at 0%. Plumbing the payload through `admit.ts:830,867` is a *teaching change* — post-pin, version-bumped.
4. **D-5's line citation has drifted.** `classifier.ts:254` no longer points at the median; the locus is `classifier.ts:93-98` + `:261` + `:269`. More importantly the **pooled** form D-5 says to pre-register does not exist in code — the median is per-run — so pre-registering it today would pre-register a statistic nothing computes.
5. **D-3's principal-surface worry is already answered.** `principal` is a hashed field of `VERB_DESCRIPTORS` (`descriptors.ts:43`, hashed at `:291`), so agent-surface membership cannot change without moving the id. The real gap is the three *unhashed enforcement* tables (`protocol.ts:111,134,144`) plus a fourth hardcoded copy at `classifier.ts:198`.

---

## Q1 — is a hash even possible?

**Source-text hashing (option b) is rejected on verified grounds. [verified-by-Claude]**

`package.json` declares `files: ["dist"]`, `bin: dist/cli.js`, `main: ./dist/index.js`; tsup bundles every module into one content-named chunk. **No `src/` ships.** So a runtime source hash is ENOENT when installed, a different value under `npm link` (how this repo runs), a third value in CI (where the literal would be pinned), and under a bundled `dist` with a stale checkout it **certifies an artifact that never served a call** — the FG-3 defect class reintroduced one level up, in a form that is harder to detect because the one-distinct-id precondition catches *drift, not wrongness*: a uniformly wrong id passes silently.

Secondary and independently fatal (Arky): the ladder-bearing modules total ~4,500 lines of which the ladders are ~40, so a comment edit, a rename, Prettier, or any merge-engine bugfix voids a 40-run batch. *"A tripwire that fails on every unrelated commit gets its literal bumped reflexively — which is precisely how the original FG-3 defect arose."*

**Full ladder relocation (option a) is rejected as a pre-freeze item.** Jinx's falsifier F-A3 trips: the ladders are runtime-parameterized templates, not table cells — `meaningNextSteps(agentId, knotPayloadId)` has *conditional step presence* (`admit.ts:338`), `claimNextSteps` interpolates `admitParams` which differ per skin, `pickNextSteps` takes `ref`. A declarative table needs a placeholder-substitution language and a binder: a new mechanism, i.e. a rewrite, landing on top of an un-audited dense defect class. And the laundering hazard is concrete — `admit.ts:368`'s wrong `requires` would be transcribed verbatim and then *frozen*.

**What survives is output hashing.** Arky's option (d) and Jinx's constructive re-scope converge: every carrier of interest is a **total function over a closed domain** — `exitCodeFor`/`retriabilityFor`/`gateFor` over the 12 `RefusalCode`s, the ladder builders over (site × fixture input), `nextLegalVerbsFor` over the 2⁴ `CyclePosition` product, `targetOfParams` over a fixture param set. Hash the canonical serialization of the **products**, not the source locations. This covers the ladders *without moving a line of source*, and it is insensitive to comments and refactors by construction.

Arky's census, counted rather than estimated: **19 ladder templates; `verb`, `requires` and `principal` are 100% static across all 19 — not one runtime value touches either field the classifier reads (W2 at `classifier.ts:175`, W3 at `:151-156`).** Only six *param values* are runtime ids. That is what makes output hashing viable.

**Unresolved, and it gates the whole ruling:** Arky pre-registered **Falsifier B** against himself — *"the coverage test may be unwritable without degenerating into source-text hashing; if so, (d) collapses to (b), my Q1 answer is wrong, and (a) is the only path."* He flagged it as **unrun** and asked that it be run **before** any code is written. *(Probe dispatched 2026-07-31; see Status.)*

---

## Q2 — the self-reference hazard: split it. Four proposed shapes.

Unanimous on the principle, divergent on the partition:

| | rows | reports | frozen (resets denominator) | mutable |
|---|---|---|---|---|
| **Arky** | `teachingId` | `scoringId` | teaching = descriptors ‖ NEXT_LEGAL_VERBS ‖ toolNames ‖ `ladderCases()` ‖ `CLI_VERB_MAP` ‖ status field schema | classifier + completion predicate; `corpusId` deferred to FG-4, per-run |
| **Aegis** | `teachingId` ‖ `boundaryId` ‖ `instrumentId` | — | teaching + boundary (`HUMAN_ONLY_VERBS`, `HUMAN_ONLY_ADMIT_FLAGS`, `READ_ONLY_VERBS`) | instrument. Pool on (teaching, boundary) |
| **Shield** | `instrumentId` (products) ‖ `corpusId` | `scorerId` | instrument + corpus | scorer. Plus a **`carrierCensus`** that hashes *sites* and gates CI review only, never the denominator |
| **Loid** | `teachingId` ‖ `corpusId` | `instrumentId` | teaching + corpus | instrument, split **mechanically by FILE** with a pre-registered tie-break: a change moving both ⇒ stricter rule wins |
| **North** | narrow `descriptorsId` + `instrumentSha`/`instrumentDirty` | — | — | build no tuple at all |

**The convergent principle, stated five different ways:** *teaching change ⇒ re-run; instrument change ⇒ re-score.* `classifyRun` is pure (`classifier.ts:48`) and `evaluateCompletion` likewise (`completion.ts:35`), and rows are durable JSONL — so a scorer fix costs **zero runs**, you re-score the archive. Folding the scorer into the denominator id converts a free operation into an expensive one and **creates a standing incentive to leave the scorer broken.** Given D-13 and the missing pooled statistic, the probability the ruler changes before run 40 is ~1.

**Loid's anti-litigation device** answers the strongest objection to any tuple — that a category boundary is something to argue at, mid-batch, by someone who wants to keep 30 runs. Split by *file*, not by judgment, and pre-register the tie-break. That converts a judgment surface into a lookup.

**Disagreement worth preserving:** Loid puts `CLI_VERB_MAP` on the **instrument** leg, against Arky's teaching leg, with evidence — commit `93af1d99` added `resolve` to that map, which changed nothing a CLI subject perceives and changed only what the ruler can see. Filing it under teaching would have reset a denominator for a pure measurement fix.

---

## Q3 — Jinx's seven survivors: the enumeration *shape* is wrong

Jinx was asked to find the next carrier the way the last probe found D-3. He found seven that the **proposed** instrumentId still misses. Two are decisive:

- **C2 — `RETRIABLE_FOR` (`refusal.ts:304-322`) [verified-by-Claude].** `retriable` is documented as *"the single PRIMARY recovery axis"* (`refusal.ts:93`), and the file carries a **recorded historical instance** of exactly the behaviour-changing edit the new hash would still miss: PW-1 flipped `BAD_REQUEST` from `'never'` to `'retry-corrected'` because `'never'` *"taught cold agents to abandon exactly when they should fix one param and retry."* It is also a classifier input (`classifier.ts:156,185,187`) — one unhashed table moving the teaching **and** the measurement simultaneously.
- **C10 — `src/f4/completion.ts`, the PRIMARY metric.** Landed `8cf4cc27` on 2026-07-29, i.e. **after** the panel enumerated the instrumentId's five terms. Not descriptors, not ladder text, not the classifier rule-set, not `CLI_VERB_MAP`, not the corpus. *The enumeration was stale within 24 hours of being written, and the omission was the primary metric.*

Also outside: `EXIT_FOR` (`refusal.ts:213`, the shell-legible `$?` carrier the module itself calls *"the shell-legible half of F4"*), `GATE_FOR`, thrown `Error.message` prose (`daemon/server.ts:192` literally enumerates the verb surface in prose), the CLI arm's 46 `.description()` + 74 `.option()` strings (~100% of that arm's carrier, since `cli-trace.ts:22-26` records that the load-bearing `status` carrier **has no CLI equivalent**), the status *position-derivation* that feeds the hashed rule (`daemon/server.ts:259-279`), and the `target` constructors that build the classifier's only structural input.

Jinx's conclusion, which Shield reached independently from the test side: **this is not a gap you patch by adding a sixth term.** Hand-enumeration is the failure mode that produced D-3; a hand-enumerated fix will miss a fifth carrier. The mechanism must be a **census that fails the build** for any unregistered carrier — coverage enforced by conjunction, not by memory.

Shield's decidability ruling: full carrier-totality is **undecidable** (Rice — ladder content is a function of runtime data, with branch points at `pick.ts:112` and `admit.ts:338`). The strongest decidable approximation is a three-part conjunction — AST census of *sites* + product hash of *outputs* + a coverage cross-check that a census site is unexercised by the frozen matrix — with the residue named explicitly rather than papered over.

---

## Q4 — migration is near-free

**[panel, high confidence]** Zero live trace rows exist: `.warpline/f4/` is not present in this repo. The 33 shadow verdicts are a different stream carrying no `descriptorsId`. No consumer outside `packages/warpline` reads the id — the monorepo grep hits only spec prose. Code touch is ~6 lines plus five test fixture literals.

Arky: the schema tag should go `descriptors:v1` → **`teaching:v1`**, not `instrument:v1` — once Q2 splits the tuple, "instrument" names the *measuring* side, and calling the teaching surface the instrument re-conflates exactly what the split separates. **The prefix change IS the migration**: any row bearing `descriptors:v1:*` self-identifies as pre-freeze with no lookup table. And `descriptorsId()` should be **deleted, not deprecated** — an unused alias is precisely how a second carrier survives.

---

## Q5 — sequencing: three live proposals

- **Arky:** `3a → 2 → 3b → FG-4 → sign → runner`. Items 2 and 3 are not sequential — they are one item whose halves have opposite dependencies. **3a** (fix D-6a + D-6b) must precede 2, because you freeze *corrected* text. **3b** (the exhaustive P1/P2 audit) must follow 2, because `ladderCases()` *is* the enumeration the audit iterates — written first, the audit hand-rolls a second unhashed census, which is a fresh instance of the D-3 defect class. He notes the panel's *stated* reason for 3-before-2 dies with option (d) (the ladder text no longer moves), but the ordering survives on stronger grounds.
- **North:** `item 0 (CI) → 5 → 3 → 2 (degenerate SHA) → sign`, with an **n=5 unscored kill-only non-Claude pilot** in parallel with 3. Item 5 first, not last: D-7 is the only item whose omission is *irreversible* — it stages strands into the live `.warpline/fabric.jsonl`, contaminating the organic K3 record this arc exists to fill.
- **Jinx:** cut items 2 and 3 from pre-freeze entirely; keep 5 and FG-4; run the **n=12 kill-only screen** now, which settles the sequencing argument in a day and produces the denominator's first rows either way.

**North's asymmetry argument, which the panel should not lose:** item 4's justification — *"a predicate written after runs exist is void"* — is sound and irreversible; you cannot un-see transcripts. **That argument does not transfer to the freeze.** An instrumentId is computable *retroactively* over the commit that served run #1, because rows are timestamped and the repo is versioned. Freezing before is convenient; it is not epistemically required the way the predicate was. Item 2 has been granted item 4's justification without earning it.

**North's corollary, load-bearing for the whole queue:** *pre-registration protects PASSES, not FAILS.* A freeze exists to stop a claimant tuning the instrument until a favourable number appears. A kill-only screen can only produce an unfavourable finding, and an unfrozen surface cannot inflate a zero. FG-2/3/4 are prerequisites for **claiming F4 passed**; they are not prerequisites for **discovering F4 fails**. The queue treats them as prerequisites for both — and that is why the denominator has been zero for the entire arc.

---

## The one security item

**Aegis M-1 — gate CLI human verbs on `$WARPLINE_AGENT_ID`.** D-4's enforcement half: `cli.ts:731-819` takes `<agentId>` as the *target*, never the caller; no kind check anywhere; `--accept-breach`/`--accept-risk` pass straight through (`cli.ts:563-564,600-601,630-631`) with the daemon's gate (`daemon/server.ts:347-355`) bypassed.

The naive fix is incoherent — possession of the shell *is* the human credential under the stage-1 model (`tokens.ts:5-6`). But the mechanism already exists and is the product's own precedent: `pick.ts:185,197,208-219` already refuses an agent-attributed CLI write under `gate.agentWrites:'real'`. ~10 lines, breaks no human workflow, and **the F4 runner must export `WARPLINE_AGENT_ID` anyway** — so one env var discharges D-4's enforcement half *and* makes D-9's never-fired gate fire for the first time.

Aegis names the coherent alternative rather than hiding it: exclude `boundaryId` from the tuple, record "CLI arm ungated" as a stated limitation, ship the gate later at zero denominator cost. He does not recommend it — *"it means signing a pre-registration that says the CLI arm measures escalation discipline in a world where escalation is optional"* — but it is cheaper and it is the founder's call.

---

## Self-falsification (recorded because it is the panel's highest-value output)

- **Arky** amended his own R-1 on 2 of 5 components, and flagged Falsifier B as unrun and load-bearing against his own Q1 ruling.
- **Jinx** ran four attacks and reported **F-A2-c as FAILED** — his argument that a tree hash over-triggers does not survive, because a false reset is conservative while a false *non*-reset corrupts data.
- **Aegis** withdrew his own S4 recommendation: `UNTRUSTED_CONTENT_SENTENCE` already contains the literal `'untrusted-prose'` tag, so the tag is hashed transitively and freezing `envelope.ts` adds nothing.
- **Shield** found her own first component list omitted `EXIT_FOR` — *"the D-3 defect recurring a fourth time"* — and corrected it rather than shipping it.
- **North** argued against his own prior #1 ranking for the second time, and flagged item 2 as a **seventh theater item**: *"D-3 was a missed enumeration, and the proposed fix enumerates again."*
- **Loid** recorded that his own FG-2 delta framing is **not currently computable** because of D-14, a fix he had not previously specified.

---

## Theater re-audit (North)

Of the six flags in the prior panel, **zero are fully cleared**. Flag #1 got *worse* (B-1). Flag #6 is partially cleared — the synthetic-KNOT caveat exists in prose but **there is no pre-registration document** for it to live in. Genuinely cleared: FG-1's structural defects (D-1, D-2, and D-4's measurement half), verified live at 42/42 green across the six relevant suites.

Loid drafted the verbatim honesty clause for the pre-registration when one exists — see his ruling; it is pasteable as-is and is the only thing that stops the number being over-read later.

---

## Probe results — 2026-07-31

Both probes were pre-registered by the panel as the checks that must precede implementation. Both have now run. Working tree verified clean after each; 675/675 tests pass.

### Falsifier B — **(A) SURVIVES.** Option (d) stands on evidence.

Arky's falsifier against his own Q1 ruling did **not** trip. A throwaway AST-census prototype was built and run over eight arms:

| arm | change | result | wanted |
|---|---|---|---|
| 0 | baseline | GREEN | GREEN ✓ |
| 1 | new `refuse()` + ladder in `native.ts` | **RED** | RED ✓ |
| 2 | cosmetic — jsdoc + reflow + local rename (27/7 lines, `tsc` clean) | GREEN | GREEN ✓ |
| 3 | relocate ladder builder to a new file | RED, **totals md5-identical** | expected ✓ |
| 4 | reorder two `refuse(` sites (14/14 lines) | GREEN | GREEN ✓ |
| 6 | **substantive** unrelated edit — loop rewrite + new 14-line exported function | GREEN | GREEN ✓ |
| 1b | ladder added to an *existing* site | RED | bonus ✓ |
| 5a/5b | `principal` agent→human; `requires[]` narrowed | RED *(after tightening)* | bonus ✓ |

**Why this is provably not a source hash in disguise.** ARM 6 is the decisive one: a substantive *logic* edit — not merely cosmetic — leaves the census green, which no source hash can do. ARM 3 corroborates: relocating a builder to a new file moves counts between files while the package-level total stays **byte-identical** (`f0ddf3c8…` both sides), and a source hash cannot be invariant under a file move.

The census reproduced the D-3 table exactly (six files, 18 sites), and correctly *excludes* `refusal.ts:366` — the `export function refuse` declaration, which a grep counts and an AST does not.

Cost is a non-issue: 32 ms warm scan, 123 ms as a vitest test.

### ⚠️ The load-bearing finding: a verb-only census is blind to FG-1's own foundation

The prototype's first cut keyed each step on the **verb alone**, and it was **silently blind to two real teaching changes** — flipping a step's `principal` from `agent` to `human`, and narrowing `requires[]`. Both went GREEN.

The `principal` blind spot is serious: it is exactly the agent-vs-human distinction FG-1 rests on. Someone could flip `admit` to human-only and **the frozen denominator would not move**. That is D-3's defect class reproduced *inside its own fix*, which is what Arky predicted as the hazard of naive option (c).

Keying on the **full tuple** (`verb | principal | requires | params-key-set`) closed it, and — this is the direct refutation of Arky's worry — **tightening cost nothing**: arms 5a/5b went RED while arms 2, 4 and 6 all stayed GREEN. Completeness did not force collapse into source-text hashing.

### Three constraints the probe adds to the (d) spec

1. **Key steps on the full 4-tuple**, never the verb alone (above).
2. **The registry must key on ladder BUILDERS, not `refuse()` call sites.** All three `admit.ts` ladders and one in `pick.ts` are *computed* (`meaningNextSteps`, `claimNextSteps`, `trustNextSteps`, `pickNextSteps`). A call-site-keyed registry freezes the call and misses **10 of the steps**. A second scan — functions whose declared return type is `RefusalNextStep[]` — was required to see them.
3. **Freeze on package-level totals; report per-file as a locality hint.** Totals are relocation-invariant, which turns ARM 3 green and removes the one accepted-but-annoying red.

Also confirmed as real-but-designable-around: a loose `{verb, principal}` shape match **over-matched f4Trace rows in `cli.ts`** — 8 false positives, precisely the failure mode Arky pre-registered. Requiring all four properties dropped `cli.ts`, `descriptors.ts` and `f4-trace.ts` cleanly back out.

**Residual holes, none fatal:** `params` is captured by key set, not values (a `'true'`→`'false'` flip would not trip; untested, easy to add). Non-literal verbs degrade to `<computed>` — currently **zero** occurrences; a companion lint requiring literal ladder verbs would close it.

### B-2 reachability — **REACHABLE WITH PROCUREMENT.** F4 as ratified is not unrunnable.

The mechanism is complete except for tool-capable non-Claude weights.

- **Present:** `@modelcontextprotocol/sdk` 1.26.0 including `client/stdio.js` **[verified-by-Claude]**; outbound HTTPS; Warpline's stdio server via `warpline mcp` (`cli.ts:1140`), authenticating from `WARPLINE_MCP_TOKEN` — no network surface to stand up.
- **Absent:** every non-Anthropic API credential (env, repo — no `.env` files exist at all — and all shell rc files). No code anywhere in the monorepo drives a non-Claude model; `src/f4/` is pure measurement with zero model-facing code.
- **The Ollama trap:** installed at 0.32.5 with `llama3.1:8b` and `qwen3:14b` **manifests present but weight blobs missing** (`~/.ollama` totals 536K). They would list as available and then fail.
- **The one real local model is disqualified on evidence, not assumption:** a cached 5.04 GB LiquidAI LFM2-8B-A1B GGUF was loaded and probed — `chat_template_caps.supports_tool_calls: false`, and `tool_choice:"required"` still returned prose with `tool_calls: null`. The Unsloth GGUF's jinja template has no assistant `tool_calls` branch, so llama.cpp disables its own LFM2 parser.

**Smallest working harness: ~6–8 hours.** `StdioClientTransport` spawn → `listTools()` + MCP-schema-to-provider-tool conversion → agent loop dispatching `tool_calls` through `callTool` → `WARPLINE_AGENT_ID`, the D-7 scratch-root assertion, transcript capture.

### 🔴 New founder decision surfaced by B-2 — the both-skins ambiguity

The CLI arm does **not** substitute for MCP. `roadmap-native-first.md:265` is explicit **[verified-by-Claude]**: *"Runs on the MCP skin AND the CLI skin; a pass on one is not a pass."*

But the bar **never says whether the non-Claude family must appear on both skins**, or whether family-spanning is a property of the run set as a whole:

- Reading (a) — each skin needs its own family-spanning set → the ~6–8h MCP-client harness plus procurement is on the critical path.
- Reading (b) — non-Claude covers the CLI arm, Claude covers MCP → the MCP-client harness **leaves the critical path entirely**.

One line of clarification, large cost delta. Flagged, not resolved.

### 🔴 The F4 bar text is STALE against the decision record **[verified-by-Claude]**

`roadmap-native-first.md:259-262` still reads *"completes propose → admit → KNOT → **resolve**"*. FG-1 as ratified (`TD-2026-07-28-168`) and amended (`TD-2026-07-29-259`) removed the resolve leg — `resolve` is HUMAN_ONLY, and the falsifier as originally worded demanded the one act the security law forbids. The roadmap has not caught up with the decisions that amend it.

### The procurement caveat

A local 8–14B model is unlikely to clear ≥80%, and a failure would **confound** *"the surface is illegible"* with *"the model was too small"* — which is exactly the distinction F4 exists to make (the moat-silence test). `ollama pull qwen3:14b` is free and ~20 minutes; $5–20 of frontier non-Claude API credit buys an *interpretable* answer. The free path buys a number you cannot read.

---

## Status after the probes

**Settled by evidence:** item 2's *mechanism* — option (d), output hashing plus an AST carrier census, keyed on ladder builders and the full step tuple, frozen on package totals.

**Still open:** item 2's *partition* (which tuple — the probe does not touch this), and the whole sequencing question. North's asymmetry argument is untouched by either probe: the freeze remains retroactively computable, so it is convenient rather than epistemically required, and it need not block the denominator.

## Open founder decisions

1. **Item 2's shape** — tuple (which partition?), North's SHA, or sign narrow today. *Hold pending Falsifier B.*
2. **Aegis M-1** — gate CLI human verbs pre-freeze, or exclude the boundary and carry the caveat.
3. **Sequencing** — Arky's `3a→2→3b`, North's `0→5→3→2`, or Jinx's cut-and-screen.
4. **The stopping rule and n** — unratified. Shield: n=40 × 2 arms × 4 models = 320 runs; the fallback is confirmatory on MCP only with CLI as a pre-registered delta. Without a stopping rule, optional stopping voids the number however well the instrument is frozen.

Carried forward from the prior panel: FG-2 framing, FG-3 signature, FG-4 counts.

## Cleared to proceed without a founder decision

- **The enforcement gate** (~10 lines) — make scoring refuse a mixed-id or off-pin batch. Unanimous; independent of every scope question.
- **Item 0** — Warpline's suite into root CI (~5 lines). May come up red on first wire-in; that is information, not a setback.
- **3a** — the two D-6 ladder fixes (`admit.ts:368`, `native.ts:202`), which precede any pin under *every* proposed sequencing.
- **D-10** — `pick.ts:110`.
