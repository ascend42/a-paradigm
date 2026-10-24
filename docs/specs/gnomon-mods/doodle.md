# Doodle — a shared, replayable scribble surface for a human and their agents

Note (2026-10-16): spec v3.2 supersedes parts of this concept. The shell is a localhost GUI (P8-D50), so the GUI hosts the canvas directly; there is no separate gnomon-doodle client or second listener. See docs/specs/gnomon.md §12.7.

Status: concept / ideation (not a build spec). Target: Gnomon 8.0 first-party mod + first-party surface. Companion to `gnome-persona.md` in this folder (the gnome is the hand; Doodle is the paper).
Parent spec: `docs/specs/gnomon.md` (§2 topology, §3.2 kernel log, §4.1 envelope, §4.4 refs, §4.5 display-block, §4.10 voice events, §9.1 taxonomy, §9.3 redaction, §10 laws, §11 TUI, §12 mods, §14 voice, §16 Windows parity, §A accepted risks).
Aesthetic decisions: `.atelier/sessions/2026-10-15-gnomon-aesthetic/session.yaml` (light = papercraft, dark = phosphor terminal; Workshop mod caps bob only while their session streams).
Prior canvas work in this repo: `docs/specs/canvas.md` + `docs/private/plans/canvas-plan.md` (2026-03, tldraw-based symbol canvas for the Platform; never built), a-constellation's `SkyView` (React Flow + WebGL starfield, `SPEC.md:42`).
Atelier: `a-atelier/docs/format-spec.md` (`.atelier` YAML: canvas, layers, shapes `rect | ellipse | path`, states, deltas), `a-atelier/docs/playbook/rules.yaml` (critique rules with stable ids).

Everything below is a proposal for the founder to accept, reshape or kill. Where it would touch the kernel, the doc says so and stops; the design goal is that Doodle v0 needs zero kernel changes.

---

## 0. The founder's idea, verbatim

```
a mod i will call doodle right now. it's a super low stakes (on initial version) canvas that
both the human and the ai agents can draw onto. make shapes while talking draw together to get
to whatever it is that calls for it as in animations, line edits on photos (photo display
support) so you can redline issues and have a live discussion. these interactions can be logged
and tied in lore and an and if we do this right can allow for time reversing of events to see
how an idea got there with transcription if desired etc the more these thins are connected i
think my hope is that it yields great positive boons on people's workflows
```

Two follow-ups from the same conversation, paraphrased as constraints:

- The unit is a **doodle session**: a first-class thing with a start, an end, participants, a record, a replay and a lore compaction, linked to the chat session and project it came from.
- Doodles are a **queryable knowledge source**: "check the doodles for XXX" must work for any agent or the human, the way lore does, with a ref that points at a moment.

---

## 1. Vision — why a scribble surface matters in a judging harness

Gnomon's pitch is adjudication: it decides, logs, replays. Almost every decision it brokers today arrives as text. But a large share of the thinking that leads to a decision is not textual — it is "no, the arrow goes here", "this part of the screenshot is wrong", "imagine the panel slides in from the left". Today that thinking either never reaches the agent (the human describes a picture badly in words), or arrives as a one-shot image the agent cannot answer in kind.

Doodle adds a **second channel** next to the transcript: a sheet of paper both parties can mark. Three things make it more than a whiteboard bolted onto a chat:

1. **Thinking together, visually.** Agents already see images; what they cannot do is point. A shape vocabulary plus a `point` op lets the model say "this" with a mark, and lets the human say "this" by circling. Talking (voice, §14) while both draw is the natural mode — the mouth carries intent, the pen carries reference.
2. **Redline as critique.** A redline on a screenshot that carries an Atelier rule id (`text-contrast-both-themes`, `decision-card-anatomy`) is a critique finding with coordinates. The `atelier design` crew already produces findings with rule ids; Doodle gives them a place to land on the pixel, and gives the human a way to answer "actually it's this bit" without prose.
3. **"How did we get here".** Every mark is a kernel log event with a time, a principal and causes. Replay is therefore free: scrub the sheet backwards and the transcript and voice turns scrub with it. The founder's time-reversal wish is not a feature to build; it falls out of the log discipline Gnomon already imposes (§3.2 L1–L4). The work is only to make the ops small and fold-able.

The bet: the compounding comes from connection, not from the canvas. A doodle that ends as a lore entry, a decision, a contract node, an Atelier critique or an `.atelier` animation is worth ten that end as a PNG.

Non-goals for v0: a design tool, pixel-perfect rendering, image editing beyond marks, multi-human presence (8.1 per §21), a symbol-graph canvas (that was the 2026-03 plan and may return as a Doodle *template*, not as Doodle's core).

---

## 2. The doodle session (`$doodle-session`)

A doodle session is to drawing what a voice session (§4.10, §14.3) is to speech: its own id, its own start/end events, attached to one chat session, compacted to lore at the end. It is deliberately modelled on `voice.session.*` so the kernel sees a familiar shape.

### 2.1 Identity and links

- Id: `ds:<ULID>`, minted by the Doodle client when the sheet opens. Never kernel-issued; the kernel only validates shape.
- **Attached to** one `hsid` (the chat session it grew out of). A doodle can be re-attached to a later session (`doodle.session.attach{hsid}`), and one chat session can own several doodles. The envelope's `scope.repo` is inherited from the attached session, so a doodle always knows which project it belongs to.
- **Links out** (via `ref:v1`): the images it holds (`blob:` sha refs), the turns that caused marks (`ev:` ids of `turn.*` and `voice.turn.*`), the symbols it mentions (`sym:` when a label or note resolves to one), its parent doodle if branched, its lore compaction (`l:`), any decision/task/contract it produced (`td:`, `t:`, `contract:`).
- **Links in**: the chat transcript gets a `display-block` line per doodle event of note (open, image placed, redline added, branch, end) so the transcript is navigable into the sheet; the lore entry links back with `doodle:` refs (§8).

### 2.2 Lifecycle

| Step | Who | What happens | Events (all `modns.doodle.*`, appended by `p:<ns>/mod-doodle`) |
|---|---|---|---|
| Open | human (`/doodle` in the TUI, drag an image onto the TUI, or the `Open in Doodle` command on an image block) or an agent (tool `doodle.open{title, why}` — opens *a proposal* the human accepts with one keystroke; no agent opens a sheet silently) | surface opens, sheet is blank or seeded with the dragged image | `doodle.session.start{ds, hsid, title, by, seed?: blob}` |
| Draw | human and agents | ops stream (§3); every op is one event | `doodle.op{…}` (one kind, discriminated by `op.type`) |
| Branch | either | a child sheet starting from a moment (§4.3) | `doodle.branch{ds, from: seq, child: ds}` |
| Export | human (agents may propose) | lore / decision / task / critique / animation / PNG (§4.4) | `doodle.export{ds, kind, ref}` |
| End | human closes, or idle 30 min with a visible countdown | compaction (§4.2) is written through the `paradigm` grant; the raw ops stay | `doodle.session.end{ds, ops, images, branches, compactedTo: "l:L-…"}` |

Participants in 8.0: the human (device key) and any number of agents (each a session principal, drawing through the per-session `gnomon-mods` MCP server, §12.3). Colleagues are 8.1: the `audience` field already exists on every event (§3.2 L6), so a shared doodle is a projection, not a redesign. v0 writes everything `audience: private`.

### 2.3 What a session records

- Every op with `by`, `at`, `seq`, `causes[]` (the turn or voice turn that was live when the mark was made; the client fills this from the attached session's latest `turn.*`/`voice.turn.*` id).
- Every image as a content-addressed blob (`sha256`) with a provenance tag (`screenshot | file | paste | agent-rendered`) and a sensitivity (§6).
- Periodic **keyframes**: a full sheet snapshot (JSON + PNG) every N ops or every 60 s of activity, so replay does not fold 10k ops from zero and so the knowledge index has thumbnails. Keyframes are derived, never authoritative; `gnomon doodle fsck` recomputes them from ops.
- Nothing else. No audio (voice keeps its own rules), no cursor telemetry beyond explicit `point` ops.

---

## 3. Core interactions v0 (low stakes)

### 3.1 The shape vocabulary (closed, small, versioned `doodle-shape:v1`)

| Kind | Fields | Notes |
|---|---|---|
| `stroke` | `points[] (x,y,pressure?)`, `color`, `width` | freehand; simplified client-side (Ramer–Douglas–Peucker) before logging so an op stays small |
| `rect`, `ellipse` | `x,y,w,h`, `stroke`, `fill?`, `label?` | the same primitives Atelier has (`format-spec.md` §3.6), so export is lossless |
| `arrow` | `from (point or shapeId)`, `to (point or shapeId)`, `label?` | binds to shapes so it survives moves |
| `text` | `x,y`, `text`, `size` | the only free text on the sheet; indexed (§8) |
| `image` | `blob`, `x,y,w,h`, `provenance`, `redacted: bool` | photos, screenshots, renders |
| `redline` | `anchor: {image, region: {x,y,w,h} in image space}`, `note`, `rules[]`, `severity` | the critique mark; `rules[]` are `rules.yaml` ids, free-form notes allowed |
| `point` | `x,y`, `target?: shapeId`, `ttl: ms` | "this" — ephemeral on screen, permanent in the log |
| `group` | `members[]`, `label` | for "these three" |

Every shape has `id` (ULID), `by` (principal), `z`. Colour is a role (`ink | accent | project | knot | agent-<n>`), not a hex, so papercraft light and phosphor dark both render it (session.yaml: sage project hue is fill-only; violet only for KNOT).

### 3.2 Ops

`add{shape}`, `update{id, patch}`, `delete{id}`, `move{ids[], dx, dy}`, `lock{id}`/`unlock{id}` (human only), `clear{scope: mine | agents | all}` (human only). Ops are the unit of logging, undo and replay. The kernel's `seq` is the total order — one kernel per user in 8.0 means there is no concurrent-writer problem to solve yet; the op shapes are chosen so an 8.1 CRDT layer (§7) can adopt them without a schema break (ids are client-minted ULIDs, updates are property-level patches, deletes are tombstones).

### 3.3 What agents can draw, and how

Agents reach Doodle through two mod tools on the per-session `gnomon-mods` MCP server (§12.3, so the kernel's ≤12 proxy tools are untouched):

- `doodle.view{ds?, bounds?}` → `{sheet: simplified JSON, snapshot: image, legend}` — effect `read`. The JSON is the shape list above with coordinates rounded and ids kept; the snapshot is a PNG the **mod** renders (headless, same renderer as the surface) with a faint coordinate grid and a legend of who drew what. The model therefore sees the sheet twice, structurally and visually — the pattern tldraw's agent kit uses (screenshot + simplified shapes; tldraw.dev/docs/ai, read 2026-10-16).
- `doodle.draw{ds, ops[]}` → `{applied, refused[]}` — effect `write`. Ops are validated against the vocabulary and the ownership rules before they are logged; a bad shape is refused by name, never silently fixed (`no-silent-substitution`, rules.yaml).

What agents may not do: delete or move a human's marks (refused `FORBIDDEN`-shaped by the mod, logged `doodle.op.refused`), open a sheet without a human keystroke, place an image the human has not seen (an agent-rendered image is placed in a "proposed" tray until accepted), draw more than a budgeted number of ops per turn (default 64; a wall of agent ink is noise).

### 3.4 Turn-taking and ownership

No hard turns. Both pens are live; the sheet shows a presence chip per participant (the gnome cap glyph for agents — `disclose-ai-involvement`; agent marks are tinted and carry the cap on hover, never indistinguishable from human ink). Ownership is per mark (`by`), visible on hover and in the replay rail. The human owns the sheet: lock, clear-agents, accept-proposed. Agents own only their own marks and can erase their own.

### 3.5 Live talk alongside

With voice on (§14), every `voice.turn.user`/`voice.turn.agent` id is attached as `causes[]` to the ops made while it was the latest turn, and the sheet shows a thin caption rail of the last two turns. Pointing while speaking is the whole point: "this one" + a `point` op is a reference the model can resolve. Without voice, chat turns play the same role.

---

## 4. Time-reversal, branching, compaction, export

### 4.1 Replay is native

Because every op is a kernel event (`§3.2` L1 append-only, L4 unique ids, `at` + `seq` + `causes[]` on the envelope), replay is a fold: pick a `seq`, apply ops with `seq ≤ t` from the nearest keyframe. The surface has a scrub rail with three aligned tracks — ops, chat turns, voice turns — all on the same `seq`/`at` axis. Scrubbing moves all three: the sheet redraws, the transcript highlights the turn that was live, and the voice caption shows `textSpoken` (the truth after a barge-in, §4.10). Transcription "if desired" is just the voice track being present or not.

CLI parity: `gnomon doodle replay ds:… --at <seq|iso>` prints the sheet as JSON and, where the terminal supports it, a thumbnail (§5). `gnomon replay` (§2.1 falsifier `G-KRN-01`) already reproduces kernel-controlled bytes; doodle snapshots sent to Claude are `session.inject{origin: client}` bytes and are therefore reproduced too.

### 4.2 Lore compaction

At `doodle.session.end` the client compacts the session into a `.lore` record through the `paradigm` grant, exactly as voice does (§14.3): title, participants, what was drawn (counts by kind, `{n, of}` per `G-HON-03`), every `text` and `redline.note`, rule ids cited, images (by sha, with the redaction state), decisions and tasks that were exported, `sym:` refs that resolved, and `doodle:` refs (§8.1) to the moments the compactor judged pivotal (a branch, an accepted proposal, the last redline before an export). Raw ops are retained like voice text: until the compaction exists + 90 days unless pinned, keyframes kept with the lore entry, image blobs kept per their sensitivity. The compaction is deterministic text first; an LLM summary paragraph is optional, labelled, and spends from the human's permit (law 5: nothing spends by default).

### 4.3 Branching — "what if from here"

`doodle.branch{from: seq}` creates a child session seeded with the fold at `from`; the child records `parent: {ds, seq}`. Both continue independently; the scrub rail shows the fork. Branches are how an agent proposes an alternative without touching the human's sheet ("here is the layout if the sidebar collapses"): it draws on a branch, the human looks, and `accept` merges the branch's ops onto the parent as new ops (a replay of the branch, re-logged with new seqs and `causes[]` pointing at the branch). No three-way merge in 8.0; merging a branch after the parent moved is a conflict card the human answers (`decision-card-anatomy`).

### 4.4 Exports (each a `doodle.export` event with the produced `ref`)

| Target | What goes | Via |
|---|---|---|
| Lore entry | the compaction (§4.2), early if the human asks | `paradigm` grant (already exists) |
| Decision | selected marks + the note become a `paradigm_decision` record with `doodle:` refs as evidence | existing decision store |
| Task / contract node | a redline or group becomes a task (`t:`) or, in a contract session, is attached as evidence on a node (`contract:…/nodeId`) | `paradigm_task`; contract evidence is a `ref` on the node, not a kernel change |
| Atelier critique | every `redline` with `rules[]` becomes a finding `{rule, where: {image sha, region}, note, severity, evidence: doodle:ref}` — the `critique-goal-anchored-and-independent` and `evidence-tagged-claims` rules want exactly this shape | `.atelier/sessions/<id>/findings.yaml` (format owned by `atelier design`) |
| Atelier animation | shapes map 1:1 to `.atelier` layers (`rect`, `ellipse`; `stroke`/`arrow` → `path`; `text` → text visual; `image` → asset); the **time axis of the ops** becomes deltas — a shape added at `t1` and moved at `t2` is a layer with a position delta over `[t1, t2]` — so "sketch the animation while talking" yields a draft `.atelier` document the engine can resolve and the crew can refine | `atelier_create` + `atelier_add_layer`/`add_delta` (MCP) or a direct YAML write |
| Image | PNG/SVG of a moment, with the agent-ink tint and caps preserved (never a clean "human" render of mixed authorship) | surface |

---

## 5. Where it runs

The TUI cannot host a canvas. pi-tui renders lines of text; the Kitty graphics protocol can show a raster inline in kitty/WezTerm/some iTerm2 builds, but `gnomon.md` §11 only commits to the Kitty *keyboard* protocol as optional and `G-TUI-03` forbids requiring either; Windows Terminal has no graphics protocol. So:

- **In the TUI (mod view, `mod-abi:v1`, zero ABI change):** `doodle.pane` in the `panel` slot renders the sheet as text from the existing kit — a `kit.List` of marks (who, kind, label/note, rule ids), the caption rail, a `kit.Button{command: doodle.open-surface}` and `doodle.branch`. Where the terminal advertises graphics, the pane may append a thumbnail; where not, the same list stands alone. Fixtures ship for both.
- **The canvas (first-party surface, `#doodle-surface`):** a small Node process, `gnomon-doodle`, modelled on `gnomon-voice` (§14.1): its own principal `p:<ns>/doodle` with its own device key, a `gnomon-rpc:v1` client over the unix socket / named pipe, and a loopback-only HTTP+WebSocket server for a local web page that is the actual sheet. The browser never sees the kernel socket or any key; the Node process is the relay and the renderer (it also renders the snapshots agents receive, so what the agent sees is byte-identical to a keyframe). Launch = `gnomon doodle open` or the TUI command; the page opens in the default browser, or inside Conductor (Swift) as a WKWebView later. This is the same shape §11 names as the 8.1 fallback for the TUI itself ("a web UI over the same socket"), so Doodle doubles as the spike for that fallback.
- **Why not a mod process serving the page?** Mods run default-deny with no network unless granted (§12.3, §15.5); a loopback listener in a mod is an egress grant and a profile exception for the lowest-trust ring. A first-party client principal (like voice) keeps the mod ring untouched and gives the surface a scope row in the verb matrix: `log.append` of `modns.doodle.*` only, `session.send` to the attached session (to send snapshots), `log.read` of its session, never `approve`, never `permit.reserve`.

**What `mod-abi:v1` needs:** nothing for v0. Two additive proposals for v1, both `display-block:v1`-additive (new block kinds, no bump): `kit.Image{blob sha, alt, w, h}` rendered where graphics exist and as `alt` elsewhere (rule `meaningful-alt-text` makes `alt` mandatory), and a `tool.view:doodle.draw` slot fixture so the transcript shows what the agent drew as a block, not as JSON.

**Windows parity (§16):** the Node client runs unchanged; endpoint = helper-created named pipe; the page runs in Edge; screenshots arrive via the clipboard or file; headless snapshot rendering uses a pure-JS rasteriser (no native canvas dependency) so the install carries no node-gyp. `G-WIN-*` sibling tests for the surface handshake and the ACL on `~/.gnomon/doodle/` (blobs, keyframes). FluidAudio and MLX remain the only Mac-only pieces in Gnomon; Doodle adds none.

---

## 6. Privacy and security

- **Images carry secrets.** A screenshot of a terminal or an `.env` tab is the most likely image on the sheet. On `image` placement the client runs a local pass: OCR (local, Tesseract-class WASM — unverified choice) plus the secret patterns the redaction matrix already knows (`§9.3`, `G-ABI-05`), and shows hits as proposed redaction boxes before the image is accepted. Redaction produces a **new** blob; the original is either pruned (`blob.pruned{sha}`) or kept with `sensitivity: secret`, which the read token and every non-human principal can never read. Default for screenshots: keep only the redacted blob.
- **What leaves the box.** Only what the human sends: a snapshot attached to a `session.send{content:[image]}` to a Claude session goes through `claude -p` on the subscription — law 7 holds unchanged, the budget fuse sees the turn, and §3.2 L2 ("model-visible ⟺ logged") means the exact bytes are `session.inject` rows, hash and all. Local sessions receive the snapshot via the same path to `gnomon-local`. The `doodle.view` tool returns the snapshot to the calling session's model, i.e. the same channel. Nothing in Doodle has egress of its own; the surface's listener is loopback-only, and `G-SUB-06`-style tests assert it.
- **Prompt injection via the canvas.** Text on the sheet and text inside images are data. The `doodle.view` JSON is fenced and labelled as sheet content; every string passes the §4.5 sanitizer before logging or rendering (a pasted image's OCR text too). The agent's only effectors are `doodle.draw` ops validated against the vocabulary — an instruction hidden in a screenshot can at most make an agent draw a rectangle. The persona layer (`gnome-persona.md`) should label relayed canvas text as "the sheet says", never as the human's words.
- **Trust posture (law 6).** The surface's web page is bundled with the npm package (no CDN fetch at runtime, exact pins, `npm pack` lists `dist` only); the renderer is deterministic so a snapshot's hash is reproducible from ops (`gnomon doodle fsck`).
- **Local-only by default.** Blobs, keyframes and the index live under `~/.gnomon/doodle/` (0700 / owner-only DACL); `audience: private` on every event; sharing is 8.1 and, as with voice, text and redacted images only, consent recorded.

---

## 7. Build vs adopt

Checked 2026-10-16 (web; the licence pages are authoritative, the rest is marked):

| Option | Licence | For | Against |
|---|---|---|---|
| **tldraw SDK** (v4+) | Source-available **tldraw SDK licence**, not open source ("would not be Open Source by any definition" — tldraw.dev/community/license). Production requires an active licence key; free 100-day trial pings tldraw's servers with a key hash; hobby licences are discretionary, non-commercial and must show the "made with tldraw" watermark; commercial pricing is by sales form. Redistribution inside an open-source project is allowed but downstream users need their own licence. | Best prior art for agents on a canvas: the Agent starter kit gives the model a viewport screenshot + simplified shapes, validates/sanitises actions, streams results, supports a `bounds` scope (tldraw.dev/docs/ai; starter kit features such as todo lists and scheduling are from a search summary, unverified). Mature undo, bindings, arrows, images. | Every Gnomon user would need a tldraw licence or a watermark; the trial phones home (an egress Gnomon would have to declare and justify); the 2026-03 canvas plan's "tldraw (MIT)" premise is **stale** (the relicensing landed with SDK 4.0, Sept 2025 per tldraw's own blog). A hobby watermark on a papercraft sheet is also simply ugly. |
| **Excalidraw** | **MIT** (verified: github.com/excalidraw/excalidraw LICENSE, "Copyright (c) 2020 Excalidraw"). | Hand-drawn aesthetic now *fits* the papercraft decision (the 2026-03 plan rejected it for the opposite reason). Element JSON is simple and stable; freedraw, arrows with bindings, text, images, frames; element-level `version`/`versionNonce` reconciliation is enough for one kernel. Text-to-diagram exists upstream (prompt → Mermaid, per reviews; unverified detail). | Its history/undo is its own and must be bypassed in favour of kernel ops; the package is React-heavy (bundle size unverified); phosphor dark mode needs theming work; no native coordinate-legend snapshot for agents (we render our own). |
| **Custom** (SVG/Canvas + `perfect-freehand` MIT + a CRDT) | MIT parts; Automerge (MIT) or Yjs (MIT) | Vocabulary is tiny (8 kinds); total control over ownership tint, caps, replay rail; no fight with a foreign history model. A CRDT is only *needed* for 8.1 colleagues; Automerge's git-like full history matches Doodle's replay story, Yjs is the faster/larger ecosystem (Ink & Switch, 2026 comparison guides — figures unverified). | Months on fundamentals (selection, handles, arrows that bind, touch) before anything is drawn; v0 would be a worse whiteboard than either library. |

**Recommendation.** v0 on **Excalidraw (MIT)** embedded in the first-party surface, with the kernel log as the only history: translate element changes to `doodle.op`s, disable its own undo in favour of replay-fold undo, render agent snapshots ourselves. Register the Excalidraw element shape → `doodle-shape:v1` mapping as a pure function with golden tests so the engine can be swapped. Hold tldraw as a reference, not a dependency (its licence conflicts with shipping inside `@a-company/paradigm`; revisit only if tldraw publishes an OSS-friendly tier). Plan the **custom** path for v1 only if the vocabulary stabilises and Excalidraw's history model keeps fighting the replay rail; add a CRDT (Automerge, for the history fit) when the first colleague appears, not before.

---

## 8. Doodles as knowledge — "check the doodles for X"

### 8.1 Ref scheme `doodle:` (userland, registered like `sym wl n s td l t spec`, §4.4/§3.7)

```
doodle:<ds>                 the whole session (resolves to its compaction if ended, else live)
doodle:<ds>@<seq>           the sheet at a kernel seq (a moment)
doodle:<ds>@<iso-time>      the sheet at a time (resolved to the last seq ≤ time)
doodle:<ds>#<shapeId>       one mark (resolves to its add op + current state)
doodle:<ds>#<shapeId>@<seq> one mark at a moment
doodle:<ds>/<childDs>       a branch, read "child of"
```

`ref.resolve` on a `doodle:` ref returns `{target: {ds, seq, hsid, repo, lore?}, hash: sha256(fold at seq)}`; the hash makes a cited moment tamper-evident the same way `wl:` picks carry `refHash`. The resolver is read-only and lives in the `gnomon-doodle` package.

### 8.2 What gets indexed (projection `doodle.index`, local SQLite FTS under `~/.gnomon/doodle/index.db`)

Per moment (a keyframe or an exported/branched seq) and per session:

- every `text` shape's text and every shape `label`;
- every `redline.note` with its `rules[]` ids and severity;
- the aligned transcript window: chat `turn.*` text and `voice.turn.*` `textSpoken` within the moment's `causes[]` ± one turn;
- OCR text of images **after redaction** (never of a `secret` blob);
- the compaction summary and its tags, `sym:` refs that resolved, decisions/tasks exported;
- participants, repo, attached hsid, parent/branch links, at.

Nothing is embedded or sent anywhere to index; FTS is local, deterministic and rebuildable from the log (`gnomon doodle reindex`).

### 8.3 Provider registration

The founder's phrase is `knowledge.query`; `gnomon.md` has no such verb and the kernel must not grow one (law 3). Today the nearest facility is Paradigm's retrieval tooling (`paradigm_retrieve`, userland). Proposal: a userland **knowledge provider interface** that lore, neurons, notebooks and doodles each implement, registered through the manifest (`provides.resolvers` already exists; add `provides.knowledge: [{ name: doodle, scheme: "doodle:", query: <command id> }]` — a manifest field, additive). Each provider answers `{q, scope?: {repo, hsid, since}, k}` with hits carrying:

- `ref` (a `doodle:` moment), `at`, `score`, `why` (the matched text, quoted),
- `provenance: observed` (a doodle is a record of what was drawn and said, not a certified learning),
- `trust: floor` (the same uncertified tier `forage` stages candidates at; a doodle fact is evidence for a decision, never a notebook truth until the class promotes it),
- `snapshot` (keyframe thumbnail blob sha), `replay` (the CLI line and the surface URL that opens the sheet scrubbed to that seq), `links` (`hsid`, `l:`, `td:`, `t:`, `sym:`).

Any agent, human or the TUI (`/doodles <q>`) queries it; the kernel is never involved beyond `ref.resolve`.

### 8.4 How an agent answers "check the doodles for the sidebar collapse"

1. Query the doodle provider with `q`, scoped to the current repo (and the current hsid's lineage first).
2. Rank hits; for the top few, `ref.resolve` each `doodle:` moment to confirm the hash and pull the keyframe.
3. Answer with moments, not files: "Three doodles mention it. 2026-10-12 (ds:…@1402, with Mika, voice on): you circled the left rail and wrote `collapse to 48px`; the redline cites `targets-sized-and-placed`. Replay: `gnomon doodle replay ds:…@1402`." Each line carries the `doodle:` ref, the thumbnail (surface or `kit.Image`), and who drew the cited mark (`disclose-ai-involvement`: an agent's mark is attributed to the agent).
4. If the question needs the picture, the agent calls `doodle.view` on that moment (read effect, snapshot through the normal session channel) and reads it; it never claims to have "seen" a doodle it did not open (`explain-by-sources-not-narration`).
5. Hits from other repos are listed, not expanded, unless the human widens the scope.

Privacy in the answer path: the provider returns thumbnails of redacted keyframes only; a `secret` blob yields a grey placeholder and the words "image redacted"; the query itself is logged as `modns.doodle.query{q hash, hits n}` so the honesty CI can count what was searched versus what was quoted.

---

## 9. Connections that compound

- **Atelier critique.** `atelier design` findings get coordinates and a replay; conversely the Doodle redline picker offers `rules.yaml` ids by `space` (visual, accessibility, ai-agent…) so a critique is machine-readable from the first mark. A doodle session opened from an Atelier session inherits its `session.yaml` id as a link.
- **Atelier animation.** Sketch-while-talking → draft `.atelier` (§4.4). The reverse also works: the engine resolves a frame and places it as an `image` on the sheet for redlining — the critique loop for motion.
- **Warpline / contracts.** A redline on a diff screenshot attaches as evidence on a contract node; a doodle made during a KNOT discussion links the `wl:pick` in `causes[]`, so the adjudication record can show the picture the humans argued over. Doodle never writes fabric bytes (TD-551: not the Warpline server).
- **Voice.** Same session shape, same compaction path, shared scrub axis. "Point and say" is the interaction the two were each missing alone.
- **Neurons.** A compacted doodle is a `source_ingest`-able artefact (text + redacted keyframes); a neuron that cites `doodle:<ds>@<seq>` has a picture as its source. Only on the human's say-so (the vault is theirs).
- **Workshop gnomes as the agent's hand.** When an agent streams `doodle.draw` ops, its cap in the Workshop view bobs (the existing override: motion only while the session streams) and on the sheet its cursor is the same cap glyph, leaving a tinted trail that settles into the mark. Idle agents are still. `reduced-motion-honored`: the trail can be off, the tint and cap remain (`color-never-sole-signal`).
- **Gnome persona lines.** The dialog filter in `gnome-persona.md` gets a few canvas verbs: "I circled the gap", "Branching here so your sheet stays put", "That screenshot has a key in it — redact?" — short, question-and-answer, and always paired with the mark they refer to.
- **Lore and decisions.** The doodle compaction is a lore entry; a decision taken on the sheet is a decision record with picture evidence; `paradigm_lore` and `paradigm_decision` grow nothing but a `doodle:` ref in their link lists.

---

## 10. Risks

- **A whiteboard nobody opens.** The TUI is the shell; a browser tab is a context switch. Mitigation: open from the transcript in one keystroke, show the sheet's ledger inside the TUI, and measure (`T-DDL-01`: doodles opened per week, ops per doodle, exports per doodle — if exports stay near zero the connection thesis is false).
- **Agent drawing is bad.** Models place shapes imprecisely; tldraw's kit spends real effort on correction. Mitigation: coarse grid, snap-to-shape for arrows, `point`/`redline` anchored to existing shapes or image regions rather than free coordinates; budget ops per turn.
- **Screenshot leaks.** The single largest risk; §6 is the answer and `G-DDL-SEC-01` (a screenshot with a known key pattern can never reach a `session.send` unredacted) is the falsifier.
- **Replay cost.** 10k-op sessions fold slowly; keyframes every N ops, `G-DDL-01`: scrub to any seq in < 100 ms on the founder's Mac.
- **Excalidraw's history fights ours.** Mitigated by the pure mapping layer; if it keeps fighting, the custom path (§7) is the exit.
- **Scope creep toward the 2026-03 symbol canvas.** Keep symbol cards as an optional template on a doodle, not as Doodle's model.
- **Law 3 pressure.** Someone will want a `doodle` kernel verb. The design needs none; keep it that way.

## 11. Open questions (≤ 8)

1. Is the surface a browser tab (default browser, loopback URL) or does the founder want it inside Conductor (WKWebView) from day one?
2. Does `doodle.open` from an agent card as a *proposal* (one keystroke) or is agent-opened sheets simply forbidden in 8.0?
3. OCR on by default for every placed image (privacy and cost of a local model) or only when the secret scan asks?
4. Where does the knowledge-provider interface live — `paradigm_retrieve` grows providers, or a new userland `knowledge` package that lore/neurons/doodle all plug into?
5. Should voice `textSpoken` be copied into the doodle index, or only referenced (retention rules differ: voice text is pruned after compaction + 90 days)?
6. Branch merge in 8.0: replay-as-new-ops only (proposed), or do we want a real three-way merge with a conflict card already?
7. `kit.Image` as an additive `display-block:v1` kind — acceptable to the TUI's "no raw strings, closed kit" posture, or does an image block need its own sanitiser story first?
8. Who owns the Atelier `findings.yaml` shape that redlines export into — Doodle, or Luna's `atelier design` skill?

## 12. A one-week prototype that proves the idea

Goal: one real design conversation, with voice, on a screenshot, replayed and found again — no kernel changes, no Windows, no persona.

- **Day 1.** `gnomon-doodle` Node client: principal + socket auth (copy the voice client's shape), loopback page with Excalidraw, `doodle.session.start/end` and `doodle.op` appended as `modns.doodle.*` through `log.append`. Element change → op mapping with golden tests.
- **Day 2.** Image placement with the secret scan + redaction boxes; blobs under `~/.gnomon/doodle/`. Keyframes. Headless snapshot renderer with grid + legend.
- **Day 3.** `doodle.view` and `doodle.draw` as mod tools on `gnomon-mods`; one Claude session draws an arrow and a `redline` with a `rules.yaml` id onto a screenshot the founder placed; agent ink tinted, cap on hover.
- **Day 4.** Scrub rail over ops + chat turns (+ voice turns if the voice client is far enough along; otherwise chat only). `gnomon doodle replay`. Branch = fork-and-seed.
- **Day 5.** Compaction to a `.lore` entry; `doodle:` resolver; FTS index; `/doodles <q>` in the TUI returning moments with thumbnails and the replay line.
- **Falsifier for the week:** the founder redlines a real Gnomon mock with Mika, closes the sheet, and three days later asks an agent "check the doodles for the key edge contrast". The agent returns the moment, the ref resolves, the replay shows the mark and the sentence spoken when it was made. If any link in that chain needs a human to go hunting, the idea is not yet proven.

---

Sources checked for §7 (2026-10-16): tldraw licence and key rules — tldraw.dev/community/license, tldraw.dev/legal/tldraw-license (404 at fetch time; the community page quotes it), tldraw.dev/sdk-features/license-key, tldraw.dev/pricing; tldraw agents — tldraw.dev/docs/ai, tldraw.dev/starter-kits/agent; Excalidraw licence — github.com/excalidraw/excalidraw/blob/master/LICENSE (MIT); CRDT history comparison — inkandswitch.com/automerge-rs/post/towards-production (dated benchmarks), pkgpulse 2026 Yjs/Automerge/Loro guide (figures unverified). FigJam AI and Miro AI claims come from third-party reviews only and are not relied on above.
