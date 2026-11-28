# Aegis rulings on the board medium design (S1.1 proposal)

2026-11-23. Filed by the orchestrator from Aegis's report. These bind as merge conditions on the milestone each names and override `s1.2-draft.md` where they differ.


Files read: `/Users/ascend/Documents/GitHub/a-paradigm/.atelier/systems/gnomon/design-system.yaml` (1153-1402, 1724-1807), `DESIGN.md` 71-87, `s1-build-plan.md` §7, `s1-scale-amendments.md` §9, `s1.2-draft.md` §1-2 and Rulings.

**1. Approval by shape: accept with condition (S1.2).** The reading is sound: `foundations.color` has no approval hue (status is ink, line 126; the old stamp equals sea-grey.ink). Shape alone has one hole: neutrals are exempt (line 1359), so `custom:#16150f` as a fill passes, and `text_on_fill` (1333) then flips the label to on-ink. That is the primary key (ink fill, on-ink text), and an ink dashed edge on an ink fill is invisible.
- Condition: "The neutral exemption applies to the line role only. A fill is tested against `text.primary` and `line.key-edge` of its theme with no exemption. An agent mark's dashed edge has at least 3:1 against its own fill."
- Test: for every element `dimToElements` emits for an agent `by`, the stroke style is dashed and the edge differs from the fill; no fill resolves within the minimum of ink or key-edge; a golden of an agent rect labelled "Allow" shows gaps on all four sides.

**2. Night `warn-bg` omitted: accept with condition (S1.2).** "The reserved-equals-foundations test names this one token as the only exception and computes its composites instead of hardcoding them."

**3. Refuse versus snap: one behaviour per layer (S1.2; picker S1.3).**
- Shared validator (the mod, for GUI and agent ops alike): refuse with `colour-bad`; a failing value is never stored. `fix` may name a swatch from the closed list.
- GUI picker: calls the same function, refuses, offers the swatch, never substitutes.
- Renderer: total and never trusts the row. A stored token failing the current check resolves to ink (line) or none (fill). No stepping snap, and the token is never rewritten.
- Reason: the fold is tolerant and the O7 ruling lets reserved values change after rows exist. Arky's "stored as written, snapped" is rejected at the write layer and replaced at resolve.

**4. Metric: accept OKLab with condition (S1.2).** Safety does not need integer exactness, because the renderer re-checks where it paints; engines disagreeing at the edge is cosmetic. Pin:
- one implementation in `gnomon-contracts/src/content-palette.ts`, with a test that no second copy of the matrices exists;
- sRGB linearisation from a literal 256-entry table;
- Lab quantised to integers before an integer compare;
- Luna's vectors, including 0.059 fail and 0.066 pass, and the swatch night table, run in Node, Chrome and WKWebView.
- The draft's `ContentSwatch {day, night}`, integer HSL `nightOf` and lowercase-only pattern must be reshaped to Luna's per-role values.

**5. Author seal: accept with condition (S1.2, S1.4).** A non-cryptographic hash is fine only because the seal is a recognition aid: 5 cuts by 8 beads is 40 shapes, so a matching name can be found by trial with any hash.
- "The seal input is the host-stamped `principal` plus `agent`, length-prefixed, never a nickname and never tool input. The hover line's name is a bidi-isolated, length-capped text node and is the authority."
- "A claimed seal hashes under a separate domain that includes the parent's `agent`, and is always drawn attached to the parent's solid seal." Otherwise a sub-agent claiming "arky" gets Arky's exact cut, bead and letter, told apart only by a 1.25px dash at 18px.
- The draft has no field for a self-claimed name, and C2 forbids reading one from input. Claimed seals are not buildable until that carrier is ruled.
- Reject the draft's fold line 226: a row with no well-formed `relayedFor` folds as human, so it draws solid ("host vouches"). It must draw as an unvouched third state: dashed, no seal, "unknown hand". Luna needs to design that state (S1.1).

**6. Fallback node: accept with condition (S1.2).** Consistent with C4. `DIM_KIND_PATTERN` still admits `allow:approved-by-you` or `gnomon:run-this-now`.
- "The stub prefixes the kind with a fixed lead word ('kind'). `dim_view` fences kind names as T3. When non-core writes open (S5), the namespace must equal the writing mod's id and the reserved names are refused. The A13 fixture includes an approval-worded kind."

**7. `⌥B` and yielded: accept with condition (S1.3, S1.5).**
- "`⌥B` is handled by the desk, not the board bundle. It matches `code === 'KeyB'` with Alt only and calls preventDefault (macOS otherwise types ∫ into the composer)."
- "It never moves focus off a focused card, and desk-wide it only reopens or folds an existing dimension. A live offer is accepted only from the focused slip or by pointer." Otherwise an agent can time an offer to catch the habitual key.
- "The waking pointer press requires `isTrusted`, only moves focus and draws nothing."
- "No programmatic `focusCard` runs while a board text edit is active."
- G-DDL-08 adds these cases. No existing binding uses Alt alone (`app.ts` grep).

**8. G-DDL-07 (S1.1).** Do not assert one hex. The pinned `index.css` carries a violet family: `#6965db`, `#5b57d1`, `#5753d0`, `#4a47b1`, and dark `#a8a5ff` beside night knot `#A79CFF`.
- Assert the shipped bundle has no colour literal within the minimum of a reserved colour outside a per-patch allowlist.
- Assert day and night goldens with selection, multi-select, caret, guides and binding highlight contain no chromatic pixel within the minimum of a reserved colour.

**9. Other.**
- Line 1256, "the engine's own dashed style is acceptable": only if derived in `dim-map`, never an element input (S1.2).
- Line 1259, dashes close up under 50% zoom: agent text and drawn marks then show a seal only on hover. Require an always-on cue at low zoom (S1.4).
- Night keys are text brackets (1205), so agent text "[ Allow ]" in the same mono font imitates one. The dashed box and seal on agent text must be always-on (S1.4).
- The shadow override: no objection, it is unused in S1.

**Not verified:**
- Any OKLab figure; I had no way to compute them.
- `specimen-board.html` as rendered.
- Selection colours in Excalidraw's JS (I checked the CSS only).
- Whether every `focusCard` call (`app.ts:1815, 3581`) starts from a human press.
- Whether a `cli`-surface row can come from an agent's shell and so draw solid.
