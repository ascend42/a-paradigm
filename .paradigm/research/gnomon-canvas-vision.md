# Gnomon next level: the shared context canvas

Captured 2026-11-23 from the founder, choosing "Paradigm-native desk" as Gnomon's next direction.

## The founder's words

"i want to take some notes on the a-star was aiming to be because it was trying to do the whole separate loops and infinite canvas style display and i think in the grand scheme of how i see me using AI in the future it is that. a way where i can speak / gesture (eventually with a VR / AR setup) see a canvas and nodes appear on screen like an active context display that you and i are aligned on. seeing the status of things as they are going. see webpages / assets etc and more in the seamless interface. that is my dream"

## What the dream is made of

1. **An active context display.** A canvas where nodes appear as the work happens. Human and agent look at the same picture and agree on it. It is the shared state of the work, not a log.
2. **Live status.** Each node shows how its piece of work is doing right now: sessions, loops, tasks, agents, CI.
3. **Everything in one surface.** Webpages, assets, documents and more sit on the canvas next to the work, with no window switching.
4. **Speak and gesture as input.** Voice now (Gnomon already has voice). Gesture later. VR/AR is the long horizon, so the canvas model must not be tied to a flat browser page.
5. **Loops as first-class.** Separate loops run on their own and show up on the canvas as living nodes.

## Boards: collaborative canvases (founder, 2026-11-23, second note)

"somewhat like how with things like figjam from the figma team. i want to have possible canvases appear akin to like with artifacts where me and my agent's can all draw nd write and show images / etc on it like we are collaborating over ideas / diagrams etc. meant to be this tool that allows for that exploration and discussion. saving and sharing of these. and in the future the ability to share these session boards like how paradigm has lore, these boards can be shared documents in repos for other teammembers etc"

What this adds:
6. **FigJam-style boards.** A canvas is a whiteboard, not only a status view. The founder and the agents all draw, write, place images and build diagrams on it together, to explore and discuss ideas.
7. **Boards appear like artifacts.** An agent can bring up a board when a conversation needs one, the way Claude brings up an artifact. Several boards can exist, one per topic or session.
8. **Every participant is an author.** The founder and each agent (Arky, Luna, and the rest) add to the same board, and it shows who made what.
9. **Saved and shared.** Boards persist, can be reopened, and can be shared.
10. **Boards in the repo, like lore (future).** Session boards become a Paradigm store: files committed in the repo (for example `.paradigm/boards/`), so teammates open the same board, it carries history, and it links to lore, tasks, decisions and symbols.

11. **Board mods (founder, third note).** "this canvas could have mods on it as well for developers to build on top of it". The board is a platform: developers write mods that add node types, tools and live widgets to it, the way Gnomon mods add to the desk today. Examples: a Paradigm symbol graph node, a live CI or session node, a webpage embed, a Constellation map, an Atelier board. This extends the existing mod system (manifest, trust tiers, `gnomon-mod-sdk`, the mod authoring skills in T-2026-10-20-012) instead of starting a second one.

Design questions this raises:
- the board file format: diffable and mergeable in git, readable by agents as structured nodes, not only as pixels;
- how an agent "draws": structured primitives (sticky, shape, connector, frame, image, embed, diagram) through kernel or MCP calls;
- live co-editing between the human and several agent sessions, and how board edits relate to the signed kernel log;
- what goes in the repo and what stays private (images, webpage captures, secrets in embeds);
- the board mod API: what a mod may render and read, how its nodes are saved in the board file, and what a teammate without the mod sees (a fallback rendering);
- trust: third-party board mods run untrusted code next to approval surfaces, so they need the same sandboxing and trust tiers as desk mods, and must never look like a card or an approval key.

Prior art in this ecosystem: the Excalidraw CSP probe P12 (`packages/gnomon/probes/p12-excalidraw-csp`; Gnomon spec §19.1 P12, §11.2 rule 6, §12.7, OPEN 12). It already tests whether a self-hosted Excalidraw loads under the GUI's strict CSP and can export PNG/SVG. Chrome, Edge and Firefox pass; WKWebView on macOS-15 CI fails to report (T-2026-11-06-003), which now matters directly for boards in Gnomon.app, a-star's units and connections, and Constellation's map.

## Prior art to mine: a-star (`~/Documents/GitHub/a-star`)

STAR (last commit 2026-03-08, v2.42.2, 259 commits) built a Tauri infinite canvas with:
- canvas: viewport, grid, connection layer, minimap, selection, command palette (`src/canvas/`);
- units (node types): agent, chat, note, checklist, metric, feed, calendar, embed, assets, sensor, pipeline, keychain (`src/units/`);
- a pipeline engine with node links and data flow (`docs/PIPELINE-*.md`);
- the Hive with live UI updates on Constellation writes (v2.39.0), an agent task queue (v2.40.0), and the PULSE protocol;
- docs: `docs/GRAND-PLAN.md`, `docs/EVOLUTION.md`, `docs/PERSONAL-NORTH-STAR.md`, `docs/canvas-unit-connections.md`.

Related: Constellation (`~/Documents/GitHub/a-constellation`), the voice-driven map of Spaces, sessions and stars, which overlaps the "nodes appear as we talk" part.

## How it meets today's Gnomon

Gnomon already has the trusted parts STAR lacked: a signed kernel log, cards and presence for approvals, a session sandbox, voice, mods with a desk and offers, and the local lane. The open question is how the canvas becomes Gnomon's main surface (or a first-party mod), fed from the kernel log and the Paradigm stores (lore, tasks, decisions, symbols), without giving up those guarantees.

Open backlog that folds into this: T-2026-10-27-001 ("/" menu and capability browser), T-2026-10-21-011 (Agents workbench), T-2026-10-21-010 (memory manager), T-2026-10-18-014 (session relay), T-2026-10-20-012 (mod authoring), loops in 8.1.

## Status

Notes only. Next step: team analysis (Arky, Loid, Jinx, Helix, Aegis, Luna) of a-star's canvas plus Constellation against the Gnomon desk, then options for the founder.
