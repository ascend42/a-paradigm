# Gnomon boards: team synthesis and options

2026-11-23. Inputs: `arky.md`, `aegis.md`, `luna.md`, `loid-jinx-helix.md` in this folder; vision in `../gnomon-canvas-vision.md`.

## Where the team agrees
- **Boards are Doodle grown up.** Spec §12.7 already designs most of it (signed ops, host-stamped authorship, `doodle.view`/`doodle.draw`, refs, lore compaction, redaction, kill metric T-DDL-01). Nothing is built. Build on it; don't start a second system.
- **Agents propose, the founder opens.** "Raised like artifacts" is an offer slip under the reply (Luna, Arky, §12.7), not an agent popping a board open.
- **Truth: hybrid.** Live ops in the kernel log; at save, compacted into the repo as lore-style per-node files under `.paradigm/boards/<id>/` (Arky a+c, Loid, Aegis's driver-free merge). Committing is a human export card with redaction (Aegis blocker).
- **Mods stay declarative.** Node types are data plus kit blocks in a host-drawn frame, with a required fallback (Helix, Arky i, Aegis blocker). No third-party JS, no live iframes; webpages are snapshots plus a link.
- **Model first, renderer second.** Structured nodes with relations, handle words and named verbs keep voice, gesture and VR open (Luna, Arky).
- **Approval surfaces stay sacred.** A board never covers the card stack or status strip and gets no keys while a card is focused (Aegis, Luna principle 6).
- **Look.** Solid human marks, dashed agent marks with per-agent seals; the pin and the stale-lengthening shadow as the crafted device (Luna). Excalidraw's hand-drawn look counts as stock.

## Where it splits
- **First slice.** S0 live context board (read-only, custom renderer, no new security surface) vs S1 co-authored whiteboard (Doodle core). Jinx: only S0 is unique to Gnomon; FigJam/Excalidraw cover ~80% of S1.
- **Renderer.** Excalidraw (fast, React, P12 "partial" on the Mac: fonts fetched from esm.sh, an `eval` blocked, a stock look) vs custom SVG in the loop-graph style (crafted, no dependency, most work) vs React Flow.
- **Build or test first.** Jinx's two-week falsifier with no new UI, vs starting a slice now.

## Options
1. **Context board first (S0), custom renderer.** The active-context display: live nodes for sessions, loops, tasks, agents, CI, on the Gnomon look. Lays the board model, store and offer path the whiteboard reuses. Lowest risk; nothing to draw yet.
2. **Whiteboard first (S1), Excalidraw reskinned as engine.** Fastest path to drawing with agents. Needs the P12 export fixes and a full reskin; brings React; more security design up front.
3. **Whiteboard first (S1), custom renderer.** The crafted look from day one; slower to freehand drawing (shapes, stickies, connectors first, ink later).
4. **Falsifier first.** Two weeks of agents writing `.excalidraw` files and a hook-generated static context page; pass bar 3 reopened boards a week and 1 decision or task citing one a week. Then pick 1, 2 or 3.

Recommendation: option 1, with option 4's whiteboard arm run alongside at near-zero cost (agents write `.excalidraw` files during normal work) so the whiteboard decision gets real evidence while S0 is built.

## Other founder decisions
- Content colour: paper stocks only (Luna's recommendation) or free hues.
- Constellation: merge into boards (as a node kind or mod) or stay separate.
- Gate: which open Gnomon tasks must close before boards start (security conditions, dogfood bugs, P12 WKWebView CI).
- Third-party board mods in the first release, or first-party only.
