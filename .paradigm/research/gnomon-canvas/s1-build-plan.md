# Build plan: Gnomon boards S1 (whiteboard on Excalidraw, the §12.7 Doodle core)

Arky, 2026-11-23, for decision TD-2026-11-24-500. Spot-checked by the orchestrator: `modhost/host.ts:78-80` (MCP bridge and `/blob` not built), `mod-id.ts:39` (no `doodle` in FIRST_PARTY_MOD_NAMES), `bridge.ts:51,54` (16 KiB rows, 20 rows/s). Status: awaiting Aegis review and founder approval.

## Repo facts
- Doodle unbuilt: `kit.Canvas` placeholder (`packages/gnomon-gui/src/core/render.ts:347-348`); sanitizer accepts only `{ds, readOnly}` (`packages/gnomon/src/kernel/modhost/block.ts:46,140-142`).
- The per-session `gnomon-mods` MCP bridge and host `/blob` are "STILL NAMED, NOT BUILT" (`modhost/host.ts:78-80`). Agent tools need the bridge.
- No first-party mod uses `command.run`, `tool.call` or `log.append` yet; Doodle is first.
- Mod events are `modns.<publisher>.<name>.` (`gnomon-contracts/src/mod-id.ts:171-173`); `doodle` missing from `FIRST_PARTY_MOD_NAMES` (`mod-id.ts:39`).
- Mod append limits: 20 rows/s, 16 KiB/row (`modhost/bridge.ts:51,54`).
- No React in the GUI (`gnomon-gui/package.json`); the GUI is one IIFE embedded in the kernel as base64 (`scripts/build.mjs:40-86`), `legalComments: 'none'`.
- P12 on the Mac (`p12-excalidraw-csp.darwin.json`): 230 esm.sh font loads; `eval` blocked in font-subset chunk `c-5TFWZBK2` (plus 2 `new Function`, 4 WebAssembly instantiations); 4 `data:` images; 1 inline style. Mounts 3/3 in WKWebView. First board chunk 448 KB gzipped; non-font files 10.4 MB, fonts 13 MB.
- Offer slip design is `contested` (`.atelier/systems/gnomon/design-system.yaml:521-523`); offer `reach` values are in `clientApiId` (`gnomon-contracts/src/client-api.ts:211`).

## 1. Spec amendments (land with S1.2)
- §12.7 bullet 3 (`gnomon.md:1524`): agents raise a board only through a Desk offer (§12.9); the human's Open is the keystroke; no agent tool opens a surface. Close that OPEN 12 item (`:2269`).
- §12.7 bullet 1 (`:1522`), colour: drop colour-as-role; colour comes from `content-palette:v1` (named swatches with day and night values, plus `custom:#rrggbb` with a fixed night transform in contracts). Minerals and semantic colours are never content swatches. Authorship never by colour: agent marks are dashed with a seal derived from `by`, never stored; humans can't pick the dashed stroke.
- Rename `modns.doodle.*` to `modns.gnomon.doodle.*` (`:1522`, §9.1 table `:1265`); `op` rows carry a batch `ops[]` (≤64) to fit 20 rows/s.
- §12.7 bullet 2 (`:1523`), engine hygiene: GUI never exports SVG (font-subset stubbed; SVG is the reader's job); no Excalidraw fonts ship; engine theme fixed to light, host supplies night colours; stock UI hidden; Excalidraw and React in a lazy board chunk; build-time patches pinned to `@excalidraw/excalidraw@0.18.1`.
- §12.7 text secrets: text ops checked against redaction-matrix patterns before append; matches refused (op rows are permanent).
- §12.7/§12.2 images: refused with a hint in S1 until the redaction pass ships (S2); S1 does not claim G-DDL-02.
- §11.4: the board leaf covers the centre column only; stack, status strip and composer always visible; no board keys while a card is focused.
- §12.9/§12.8: `reach: 'canvas'` for offers; publish `content-palette:v1`.
- §19.3 M3.9 (`:2219`) and the P12 row (`:2171`): split M3.9 into S1 and S2; update P12.

## 2. Milestones (one PR each)

### S1.0 Engine under the unchanged CSP (risk first)
- Real board bundle loads and draws in WKWebView and Chrome with zero CSP refusals.
- `packages/gnomon-gui/src/board/**`, a second esbuild ESM entry to `dist/bundle/board/`, loaded by `import()` only when a board opens.
- react, react-dom, Excalidraw exact-pinned as devDependencies of the private gnomon-gui; isolation test fails if `core/` or `ui/` import react or board code.
- esbuild plugins: `EXCALIDRAW_ASSET_PATH` to the bundle; stub the font-subset module and worker; prune locales and all Excalidraw fonts; replace the 4 `data:` images and the inline style.
- Third-party `LICENSES.txt` (MIT notice); board size budget in `--check` (≤4 MB raw); P12 probe points at the shipped bundle.
- Oracles: G-WEB-06 Excalidraw fixture; new G-DDL-06 (no refusals in load, draw, PNG export on Chrome and WKWebView); P12 `pass`.
- Dogfood: `npm run preview` board fixture in the wrapper; `/diag` shows no CSP rows.

### S1.1 Reskin and content palette
- Atelier session first (Luna): board leaf, tool rail, content swatch, author seal, pin-and-shadow go into `.atelier/systems/gnomon/`.
- Build: roughness 0; one text family (JetBrains Mono aliased to Excalidraw's family path); stock toolbar, menus, welcome screen, library hidden; tools from a Gnomon rail via `setActiveTool`; engine kept light, host re-applies night colours.
- Oracle: new G-DDL-07 (no Excalifont/Virgil request, roughness 0, no stock toolbar node, day and night goldens). `atelier check` + Mika.

### S1.2 Contracts and spec
- `doodle-shape:v1`, `content-palette:v1`, a pure shared fold and validator in `gnomon-contracts`; `doodle` added to `FIRST_PARTY_MOD_NAMES`; amendments above with spec ids and `.purpose`.
- `clientApiId` additive move (minor gnomon-contracts bump, `client-api.ids.json` pin): **founder sign-off**. `kitId` and `modAbiId` unchanged.
- Oracle: G-DDL-04 (fold hash rebuildable from ops alone).

### S1.3 Doodle mod and live board, human only (first dogfood)
- `packages/gnomon-mods/doodle/` (manifest, `index.mjs`, `model.mjs`): commands `doodle.open`, `doodle.op`, `doodle.close`; events `modns.gnomon.doodle.*`; keyframes in state; pin in `FIRST_PARTY_PACKAGE_HASHES`.
- GUI board leaf via `mod.command` and a subscription: drags coalesced at pointer-up; optimistic render with rollback; undo as inverse op (Excalidraw history bypassed); keys yield to a focused card (`ui/card-focus.ts`); text-secret refusal.
- Opened by `/board` and the session header "more" menu. CLI `gnomon doodle replay`.
- Oracles: G-DDL-01 (10k-op scrub <100 ms on the Mac); new G-DDL-08 (no board key reaches a focused card; board never covers stack, status, composer); G-MOD-06/07 extended.
- Dogfood: draw on a live session's board, Reconnect, identical fold.

### S1.4 Agents draw
- Build the `gnomon-mods` MCP bridge (§3.8): userland child under the `session` profile, host-only; host stamps `relayedFor`.
- `doodle.view` returns JSON plus a legend (PNG in S2). `doodle.draw`: never move or delete human or other-agent marks; ≤64 ops per turn; refusals name the field.
- Real `inject.receipt` row (`gnomon-contracts/src/event.ts:244`). Agent marks dashed with seal.
- Oracles: G-DDL-03; new G-DDL-09 (`by` only from `relayedFor`).
- Dogfood: "sketch the auth handoff on the board" yields sealed dashed marks the agent can't move afterwards.

### S1.5 Boards raised by offer
- `reach: 'canvas'` in `OFFER_REACHES`: **second `clientApiId` move, founder sign-off**.
- Doodle manifest offer `sketch` with `handoffTool: doodle.draw`; Open = kernel creates `ds`, GUI opens leaf; Kept = a `doodle.draw` after open; slip shows "Arky added 3" while closed.
- Oracles: G-DSK-02/03/04 board cases. `atelier check` + Mika.

### S1.6 Lore export and kill metric
- At `session.end` the mod appends `export.requested`; the §8.8 reader writes the `.lore` record and appends `paradigm.doodle.exported` (`event.ts:245`), building only the doodle export kind if the reader isn't built.
- `gnomon doodle stats` reports T-DDL-01.

Critical path: S1.0 → S1.1 → S1.2 → S1.3 → S1.4; then S1.5 and S1.6 in parallel.

## 3. Dependencies
- T-2026-11-06-003 (P12 WKWebView CI) blocks S1.0 going green on CI; fix the report path inside S1.0, no CSP loosening. Also resolves T-2026-10-27-006.
- T-2026-10-27-001 ("/" menu) blocks nothing; S1.3 uses a palette command.
- Mod-invitations session (2026-10-20-gnomon-mod-invitations) blocks S1.5.
- T-2026-10-21-006 (dropped offers) appears already handled in `offer-router.ts`; verify and close before S1.5.

## 4. Builders and reviewers
| Milestone | Builder | Review |
|---|---|---|
| S1.0 | Kit | Aegis (CSP), Probe (P12, G-DDL-06), Judge |
| S1.1 | Kit | Luna, Mika, Judge |
| S1.2 | Arky drafts, Kit builds | Judge, founder (`clientApiId`) |
| S1.3 | Kit | Aegis, Mika, Probe, Judge |
| S1.4 | Kit, Helix on tool DX | Aegis, Loid, Probe, Judge |
| S1.5 | Kit | Luna, Mika, Aegis, Judge |
| S1.6 | Kit | Loid, Judge |

Every brief carries the Windows CI traps (asset alias path separators; LF in text, raw bytes for binaries, `build.mjs:18,32`).

## 5. Later slices
- S2: images with redaction, OCR (OPEN 12), host `/blob`, mod PNG rasterizer (G-DDL-02, G-DDL-05), scrub rail, branches.
- S3: `.paradigm/boards/<id>/` per-node store via a human export card with redaction and URL stripping; Paradigm MCP read tools.
- S4: Constellation merges in as a node kind or mod; `propose_merge` and low-confidence ops become pending agent ops; its app winds down. S1 leaves room: additive shape kinds with fallback rendering, a reserved `pending` op state, `refs[]` on nodes, multi-session `ds`.
- S5: declarative board mods (`provides.boardNodes`, T-2026-10-20-012).
- S6: live layer of kernel-fed nodes with the stale-lengthening shadow.
- S7: team editing over kernel links (§3.9).

## 6. Risks and kill checks
- Fragile Excalidraw patches: exact pin; a test per patch that fails on a version bump.
- Bundle size: base64-embedded in `gui-bundle.ts`; enforced budget and pruning.
- Op latency (GUI → mod → log): optimistic render, batching, G-DDL-01 timing.
- Keyboard overlap: keys yield at capture while a card is focused.
- Permanent secrets in text ops: refusal before append.
- Stock look creeping back: G-DDL-07 and Mika.
- Engine kill check: if S1.0 can't reach zero refusals without loosening the CSP, or the reskin needs a fork beyond build-time patches, switch to a custom SVG renderer (the mapping pair keeps the engine swappable).
- Product kill check (T-DDL-01): bar set before S1.4 ships, measured 4 weeks after: ≥3 boards opened a week and ≥1 export, or decision or task citing a `doodle:` ref, a week. Missed: stop at S1.

## 7. Aegis review (2026-11-23): approve with conditions

Full review: `aegis-s1-review.md`. Verified by the orchestrator: `RelayedFor` is `{principal, connId}` only (`gnomon-contracts/src/mod-abi.ts:95-98`); the GUI bundle hash covers only `app.js` plus `static/` (`gnomon-gui/scripts/build.mjs:55-58`).

Blockers:
- **Agent identity carrier (before S1.2).** `relayedFor` has no agent or hsid field, so "`by` only from `relayedFor`" can't hold for agents. Proposed fix: a host-stamped `agent` field on `RelayedFor`, which moves `modAbiId` (founder sign-off).
- **Lore export is repo egress (S1.6).** The exported `.lore` record carries only the `doodle:` ref, counts and metadata, never board text or URLs; a test proves a refused secret never reaches it.

Merge conditions added (Aegis required on S1.0, S1.2, S1.3, S1.4, S1.5, S1.6):
- S1.0: board files inside the tree hash (`--check` fails otherwise); no `.map` files; static scan finds no `eval(`, `new Function`, `WebAssembly.`, external hosts or non-loopback `fetch(`; `rules.ts:45-58` byte-unchanged by test; React built with `NODE_ENV=production`; fresh install audits at 0 vulnerabilities.
- S1.1: palette leaves room for a minimum-distance rule against reserved colours.
- S1.2: closed `doodle-shape:v1` (no `embeddable`, `iframe`, `image`, `link`, free `customData`); `custom:#rrggbb` snapped away from mineral, semantic and approval colours; secret check in the shared validator on NFKC text with zero-width and control characters stripped, every string field, and each element's full text after the op (catches split ops); dashed stroke derived from `by`, never an input.
- S1.3: the mod validates every op as hostile (GUI checks are UX only); `handleKeyboardGlobally: false`; G-DDL-08 covers `a`, `d`, Enter, Esc, Cmd+O/S/Shift+E while a card is focused; paste and drop accept plain text only; `loadFromBlob` and open-file disabled; replay output stripped of control characters.
- S1.4: bridge has its own per-session credential, never the GUI token; only manifest `doodle.*` tools, only its own session's boards; G-DDL-09 tests a forged `by`; `doodle.view` returns text fenced as T3 with each mark's `by` and provenance; human-set per-board write grants per hsid (default on for the session's agent, revocable); agents can't set `link`.
- S1.5: Open is a dedicated key that never collides with decision keys; slip text is kernel-rendered DOM, not canvas.
