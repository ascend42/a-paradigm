# Boards architecture: Arky

2026-11-23. Options and trade-offs, no single pick. Paradigm MCP tools were unavailable to Arky, so task states were not checked.

Boards are Doodle (spec §12.7, `docs/specs/gnomon.md:1518-1531`) grown up. Built today: only placeholders (`kit.Canvas` text at `packages/gnomon-gui/src/core/render.ts:347-348`; sanitizer accepts `{ds, readOnly}` at `packages/gnomon/src/kernel/modhost/block.ts`; no doodle mod). Four Doodle rules clash with the vision: agents may not open sheets (1524); embeds and iframes off, CSP `frame-src 'none'` (1523, 1372); `audience: private` on every event (1527); no three-way merge (1525).

## 1. Where boards live
- A. Host-owned surface plus a first-party board mod (current §12.7). Keeps one origin, cards, log. Cost: each new node type needs host renderer work.
- B. Mod-rendered canvas. Impossible today (G-MOD-10); needs a sandboxed frame tier.
- C. Separate app (a-star Tauri, Constellation server). Loses signed log, cards, origin rules; two of everything.
- "Raised like artifacts" = an offer kind (§12.9): agent proposes, the human's accept is the required keystroke.
- Port from a-star: unit-kind vocabulary (`a-star/src/units/registry.ts:6-19`), connector meanings `data_flow/trigger/creates/reads` (`docs/canvas-unit-connections.md:15-20`), minimap, selection, palette. Leave: Rust/Tauri backend, PULSE, pipeline engine (loops replace it).
- Port from Constellation: op vocabulary incl. `propose_merge` (`SPEC.md:77-89`), low-confidence ops as pending (91), provenance tied to transcript chunks, the `wait/apply` agent loop (142-148), timeline scrubber. Leave: its server, SQLite, whisper.

## 2. Data model and format
- a. Kernel-log ops as truth, repo gets a derived export. Signed authorship and replay exist; but the log is private and kept forever, teammates can't merge.
- b. Plain JSON scene in the repo. Easy diff, whole-file conflicts.
- c. Lore pattern: `.paradigm/boards/<id>/board.yaml` with per-node or per-op files and a derived index, as lore does (`packages/paradigm-mcp/src/utils/lore-loader.ts:376-382, 413`). New nodes never conflict; agents read YAML.
- d. CRDT (Yjs/Automerge). Best for live team merge; binary, opaque to agents and git; overkill while one kernel orders ops.
- Hybrid a+c: live session in the log, compacted into the repo at save, each file carrying its `doodle:<ds>@<seq>`.
- Nodes carry `ref:v1` refs. Live nodes store only the binding; status is rendered, never saved. Repo gets only accepted, redacted images under `assets/<sha>`; webpages as URL plus capture.

## 3. How agents draw
- Extend `doodle.draw`/`doodle.view`: sticky, frame, connector, image (via tray), diagram (Mermaid drawn by host), live-node.
- `by` from host-stamped `relayedFor`; `agent-<n>` ink per session.
- One kernel orders all ops, so no CRDT locally. Policy: agents never move human marks; last-writer-wins with inverse-op undo; or Constellation-style pending proposals.
- Change: a ds is bound to one hsid; multi-session boards need multi-attach.
- Auto-placed context nodes come from a kernel-fed projector principal, not a model.

## 4. Renderer
- Excalidraw (MIT): P12 on the founder's Mac (`packages/gnomon/probes/results/p12-excalidraw-csp.darwin.json`, 2026-10-24) is "partial": WKWebView mounted 3/3 and exported, but 230 `font-src` calls to esm.sh, a blocked `eval` in the font-subset chunk, `data:` images and inline styles refused. Brings React, ~448 KB gzipped. Stock hand-drawn look.
- tldraw: ruled out by §12.7 (licence key or watermark, phones home).
- React Flow (MIT, used by Constellation): good for nodes and edges, weak for freehand.
- Custom SVG in the GUI's framework-free style, as `packages/gnomon-gui/src/core/loop-graph.ts` already does: crafted, no dependency, most work.
- Hybrid: custom nodes now, freehand ink layer later.
- VR/AR later: keep `doodle-shape:v1` as the model, the renderer as a projection.

## 5. Board mod API
- i. Data-only node types rendered through `kit:v1` blocks in a host-drawn frame. Reuses manifest, `view.render`, bridge tools; can't look like a card; static widgets only.
- ii. kit:v2 host-built widgets (chart, graph, timeline); moves `kitId`, `modAbiId`, `clientApiId`.
- iii. Sandboxed frame per mod node; breaks one-origin (rule 10), needs a `G-WEB-06` case.
- Stored as `{type: "mod:<name>/<kind>@<ver>", data, fallback: {title, text, imageSha}}`. Existing trust tiers.

## 6. Phasing (S0 and S1 are alternatives)
- S0, context board first: read-only board of sessions, loops, tasks in the loop-graph style. No React, no Excalidraw, no new security surface.
- S1, whiteboard first: §12.7 core; one board per session; sticky, text, rect, arrow, frame; `doodle.view`/`doodle.draw`; opened from "/" or an accepted offer; local save; lore export. On the Excalidraw path it needs the P12 export fixes (self-host fonts, drop the subset worker).
- S2: multi-session boards, live nodes, redacted images (OCR engine OPEN 12), diagrams.
- S3: `.paradigm/boards/` store plus Paradigm MCP read tools.
- S4: board mods (T-2026-10-20-012), embeds.
- S5: live team editing over kernel links (§3.9), CRDT question returns, voice commands, VR.

## Founder decisions
1. Where a board's truth lives: kernel log plus repo export, repo files, or both.
2. Renderer and look: Excalidraw, React Flow, or custom; this also picks S0 or S1.
3. Trust posture: agent-raised boards without a keystroke? live webpages or snapshots only? third-party mod code or data plus kit blocks only?
