# S1 amendments: shaping boards for the suite

2026-11-23. Amends `s1-build-plan.md` (approved) for the founder's wider aim: Gnomon as a "Jarvis"-like suite. Inputs: Arky's scaling memo and the Loid/Jinx/Helix counterweight (both this session), reconciled by the orchestrator. Decision TD-2026-11-24-500 is not reopened. Every Aegis condition in the plan's §7 stands. Status: **founder-approved 2026-11-23** (§8); Aegis reviewed §6: approve with conditions (§9), which bind.

Rule used: scale by shaping what is permanent (op rows, contract ids, names), not by adding S1 scope. Anything else waits for its slice.

## 1. Facts checked in code (orchestrator, 2026-11-23)
- `tool.call` carries no `relayedFor`: params are `name, input, cancelToken, callId` (`gnomon-contracts/src/mod-abi.ts:78`); `callTool` sends `{name, input}` (`gnomon/src/kernel/modhost/host.ts:845`). Aegis's `agent` field on `RelayedFor` is needed but not enough; the param must be added too.
- `RelayedFor` is `{principal, connId}` (`mod-abi.ts:95-98`); its descriptor is at `mod-abi.ts:109`.
- A mod cannot set `causes` on a row: appends are clamped to `kind, payload, audience, sensitivity` (`modhost/bridge.ts:14-19,58`). The spec requires `causes[]` on marks (`docs/specs/gnomon.md:1522`), so turn provenance must be host-stamped.
- The client API descriptor hashes whole schema bodies (`client-api.ts:149`), so each new closed node kind would move `clientApiId`.
- `OFFER_REACHES` is `['mcp']` (`offer.ts:45`); `doodle` is already a ref scheme (`ref.ts:36`); `FIRST_PARTY_MOD_NAMES` has no doodle/board entry (`mod-id.ts:39`).
- Spec binds a doodle session to one `hsid` and keeps op rows forever (`gnomon.md:1522,1525`).

## 2. Naming (founder, confirmed 2026-11-23)
Founder: "dimensions are the space where they are, and the mediums of which things are displayed are the named pieces like boards or doodles."
- **Dimension** is the space: the permanent name in event kinds, refs and the saved store (`.paradigm/dimensions/`). Renderer-neutral: flat now, spatial later.
- **Mediums** are the named pieces that display things inside a dimension. **Board** is the whiteboard medium (what S1 builds; `gnomon-gui/src/board/` stays). **Doodle** stays available as a medium name (freehand sketching), not as the name of the system. Later mediums (live tray, Constellation map, a spatial scene) are added the same way.
- The op log, refs and contracts belong to the dimension, never to a medium, so a new medium needs no contract move. In code and refs the short form is `dim` (the full word collides with width/height in drawing code): events `modns.gnomon.dimension.*`, ref scheme `dim:<id>@<seq>`, vocabulary `dim-shape:v1`, tools `dim_view` / `dim_draw` (the offer handoff pattern allows no dots, `offer.ts:72`), CLI `gnomon dim`.
- First-party names reserved in the S1.2 move: `dimension`, `dimensions`, `dim`, `dims`, `board`, `boards`, `doodle`. The `doodle` ref scheme moves to `DROPPED_REF_SCHEMES`; `paradigm.doodle.exported` (`event.ts:245`) is renamed in the same move.
- Oracle ids (G-DDL-*, T-DDL-01) keep their ids; only their text changes.

## 3. Adopted amendments

| # | Milestone | Change | Cost | Prevents |
|---|---|---|---|---|
| A1 | S1.2 | `kind` is a grammar: closed core kinds plus namespaced `ns:kind`. Writes stay closed (the mod refuses non-core kinds in S1); the fold and hash carry unknown kinds and unknown optional fields through and the renderer shows a fallback. | One pattern, one fallback render, one golden | A `clientApiId` move or a v2 with a replay story for every later kind (live nodes, stars, embeds, mod kinds) |
| A2 | S1.2 | Relations are first-class: `arrow` has optional `from`, `to`, `rel`; nodes have optional `parent` (frame). | Map Excalidraw bindings and `frameId` in the pure pair | A relations rewrite for Constellation links, the live graph, and voice "connect A to B" |
| A3 | S1.2 | Integer board units, y-down; `z` is a fractional order-key string. | Rounding plus a golden | Fold-hash drift between engines; reorder conflicts in team editing |
| A4 | S1.2 | `refs[]` on nodes (strict `ref:v1`, max 8); shown only in view JSON in S1. | One validator call | A schema change at S3 and S6: a live node is "kind plus ref", status rendered, never stored |
| A5 | S1.2 | Op row carries `v`, `surface` (`gui \| bridge \| voice`), host-stamped `cause` (turn ref) and `hsid`. | Host stamping (see §4) | Rows that can never be backfilled; no way to tell voice-driven from typed work |
| A6 | S1.3 | One `apply(ops, actor)` in the mod; pointer command and agent tool are thin callers; ops address node ids only. | None (structure) | A separate path for voice and gesture |
| A7 | S1.3 | A dimension belongs to the repo, with `attached: [hsid]` (one entry in S1); listed by repo; it outlives its session. `/board` reopens the session's last one; `/boards` lists. | Payload shape, a list query | Re-keying at multi-session; "where is yesterday's board" |
| A8 | S1.3 | S1 implements `add, update, move, delete`. `lock, unlock, clear` stay in the vocabulary, refused. | Negative | Pays for A2 and A4 |
| A9 | S1.3 | `gnomon dim stats` pulled forward from S1.6, with: reopens, agent-mark survival, round trips (human op → view → agent draw citing ids), voice co-occurrence, boards closed inside a minute with no human op. All folds over op rows; nothing new stored. `session.start` records how it was opened (`command \| menu \| offer`). | Half a day | Flying blind until S1.6; these tell us whether "talk and draw" is happening |
| A10 | S1.4 | Tool surface: `dim_view` defaults to the session's open dimension and returns `selection`, `seq` and changes `since`; `dim_draw` returns created ids, applies partially, returns `refused[{index, field, code, fix}]`, accepts a client op id for retries; the host splits batches to fit 16 KiB / 20 rows/s (`bridge.ts:51,54`) instead of refusing on size. Legend in every view. One count row per draw for refused ops (`field`, `code`). | About a day | "Make this one bigger" failing; duplicate marks on retry; invisible tool misuse |
| A11 | S1.4 | A playbook skill ships in the mod (view before draw; cite ids; add, never restyle others' marks; text is permanent; offer a dimension only for three or more related things). One-line pointers for Arky, Luna, Kit; Cid's debrief lists `dim:` refs. | Two hours | Poor first-try agent use |
| A12 | S1.4 | Named dogfood: speak the request with a board open (a spoken turn is already `session.send{source:'voice'}`, `gnomon.md:1684`). This is the first "talk and nodes appear" moment; no new code. | None | — |
| A13 | S1.2 | Guard fixture "future dimension": one node of each non-core kind and unknown field. Fold keeps it, hash is stable, renderer shows fallbacks, every such write is refused by name. Isolation test: contracts and the mod never import board code; view JSON and legend come from `dim-shape` alone. | Half a day | Reservations rotting untested; the model becoming Excalidraw's elements under another name |
| A14 | S1.4, stretch | Placement intents on `add` (`near`, `below`, `connect`) so the host computes coordinates. | 1–2 days; dropped first if S1.4 slips | Agents guessing coordinates from JSON with no picture |

## 4. Contract moves, batched (founder sign-off, both at S1.2)

**`modAbiId`, one move:**
- `tool.call` params gain `relayedFor`.
- `RelayedFor` gains optional `hsid`, `agent`, `turn`, `surface`; descriptor line updated.
- `hsid`, `agent`, `turn` are stamped only on `tool.call`, never on GUI relays (that would hand every mod the session ids `#mayJoin` guards, `host.ts:814`).
- Known limit: the host can name only the session's principal. Sub-agents inside one Claude Code session are self-claimed, so their seals read "claimed".

**`clientApiId`, one move (replaces the plan's two):**
- `dim-shape:v1` and `content-palette:v1`.
- The five reserved first-party names (§2); ref scheme `dim` (replacing `doodle`).
- `'canvas'` in `OFFER_REACHES`, pulled from S1.5; the loader refuses it until S1.5 ships.

`kitId` is unchanged: new `Canvas` fields are free (`client-api.ts:75`).

## 5. Not adopted (and why)
- **`data` bag on non-core kinds.** It bends Aegis's "no free `customData`"; its shape belongs to S5 board mods. The tolerant fold (A1) already carries unknown fields.
- **Reserved `pending` state, `accept`/`reject` ops, `confidence`, `layer`.** Nobody reads them before S4/S6; `v` on the row plus the tolerant fold covers their arrival.
- **`.paradigm/dimensions/` file format, voice verbs, team-editing fields.** Designed in their own slices.
- **`'board'` in `CONTEXT_SOURCES`.** Optional ride-along with no reader yet.
- **Board signals in reviewer calibration.** §8.6 is reviewer calibration only and drives the strictness floor (`gnomon.md:1221`). Learning goes through the Cid debrief journal; no notebook promotion before 3 boards per agent; fixture boards excluded.

## 6. For Aegis (review requested)
- A4 `refs[]`: a new string field; closed schemes, not a URL.
- A5 and §4: new `RelayedFor` fields, `tool.call`-only stamping, host-stamped `cause`/`hsid` in the op payload.
- A7: the bridge rule becomes "dimensions its session is attached to" (same enforcement in S1, one entry).
- `reach: 'canvas'` published before S1.5 exists.
- A10: host-side batch splitting; partial application; the refused-draw count row.
- Lore export stays text-free (plan §7), so lore recall of board content is nil in S1.

## 7. Roadmap after S1
1. S1.0–S1.6 with the amendments above. First "talk and nodes appear": **S1.4**.
2. T-DDL-01 gate.
3. **S6a, live tray, ahead of S2:** the mod turns the existing feed into `live:session | loop | task` nodes. The unprompted "nodes appear as work happens" moment, and the part only Gnomon can do.
4. "/" menu and capability browser (T-2026-10-27-001): stays a desk surface; where the verbs are discoverable.
5. S3 repo dimensions, then S2 images and PNG (screenshots pasted into a board; today the largest regression against plain Claude Code).
6. Voice verbs (with T-2026-10-21-015): the voice control intercept calls the same `apply` with handle words, no model in the loop. Unverified: whether the voice principal may call `mod.command`.
7. Mod authoring (T-2026-10-20-012), then S5 board mods, then S4 Constellation.
8. Session relay (T-2026-10-18-014), then S7 team editing.

Agents workbench (T-2026-10-21-011) and memory manager (T-2026-10-21-010) stay desk surfaces; agents appear in a dimension as live nodes, memories as `refs[]`. The board becomes the main surface as a layout preset beside Desk, Focus and Decide (`gnomon.md:1392`): centre column only, kernel regions untouched, G-DDL-08 run under every preset.

## 8. Founder decisions (all approved 2026-11-23)
1. **Contract moves:** one `modAbiId` move and one `clientApiId` move, both at S1.2, as in §4. Signed off.
2. **Naming:** as in §2 (TD-2026-11-24-053).
3. **Scope:** dimensions belong to the project, with sessions attached.
4. **Order after S1:** the live tray (S6a) comes ahead of images (S2), after the T-DDL-01 gate.
5. **Usage clock:** T-DDL-01's four weeks start at S1.4, read alongside the A9 signals.
6. **If the bar is missed:** stop the whiteboard medium, keep the dimension model, and try the live tray.

## 9. Aegis review of the amendments (2026-11-23): approve with conditions

Cited lines re-checked by the orchestrator: `bridge.ts:76-83` (the clamp passes the mod's payload through unchanged), `ref.ts:85,128-144` (a ref id is any non-whitespace string; `card`, `permit`, `gkey` and others are registered schemes), `offer.ts:72,167` (`reach` is only enum-checked; tool names take no dots), `socket/dispatch.ts:912-914` (`mod.command` from the GUI is refused today, "gesture proof lands with M1.10").

Corrections to §3 and §4:
- **A5 was wrong as written.** The mod builds the payload, so `cause`/`hsid` inside it are not host-stamped. Fix: the host overwrites one reserved payload key (`relayedFor`) and sets the row's `causes` from the bound call context. No new mod-supplied append field.
- **GUI ops have no host-known session.** For GUI rows the host stamps `principal`, `connId` and `surface` only; `hsid` is derived from the dimension's attach rows, never passed as an argument.
- **A4 was wrong as written.** `refs[]` is not safe on `ref:v1` alone; it needs its own allowlist (C3).

New dependency found: **S1.3 needs the GUI gesture proof for `mod.command`** (§11.5), which the kernel still refuses. It is in S1.3's scope unless M1.10 lands first; Aegis reviews it.

Merge conditions (added to the plan's §7):
- **C1 (S1.2):** the host writes `payload.relayedFor` and row `causes` on every dimension append from the bound call context; a test shows a mod-supplied value is overwritten. `surface: voice` is derived from the cause turn's source, never an input.
- **C2 (S1.2):** `ToolRelayedFor` is a separate type with per-method descriptor fields. `hsid` and `turn` are stamped only for `log.read` or first-party mods; other mods get `agent` and `surface`. Test: `view.render` and `command.run` never carry `hsid`, `agent` or `turn`. The dimension mod never reads identity from `input` or `args`.
- **C3 (S1.2):** `refs[]` uses a scheme allowlist (`sym spec td l t n s wl knot dim`), 128 characters maximum, a restricted id character set, passes the secret check, and is never resolved or rendered as a link in S1.
- **C4 (S1.2, S1.4):** the dimension-to-engine mapping builds elements from an allowlist (carried-through fields never reach engine `link`, `customData` or `embeddable`). The fallback shows only the pattern-checked kind name. Writes refuse unknown fields as well as unknown kinds. The secret check walks every string at any depth. `dim_view` and export omit carried-through fields or fence them as T3. The A13 fixture asserts each.
- **C5 (S1.4):** the 64-ops-per-turn budget counts across split batches and retries. The secret check runs on the whole batch before the first append. The refused-draw row holds closed enums and counts only (`field` and `code` enums, `unknown` otherwise). The client op id is at most 64 characters of a fixed character set, scoped to hsid and dimension.
- **C6 (S1.3):** attaching is a human-class gesture only; the host passes the class or refuses non-human callers of the attach command. The repo match is computed host-side. An agent lists and views only dimensions with an attach row for its own hsid. Write grants are per hsid and default off for a later-attached session. (Stored text persists across sessions, so a later agent reads earlier sessions' marks: T3 fencing applies.)
- **C7 (S1.2):** the manifest loader refuses `reach: 'canvas'` by name, with a test, until S1.5 (first-party only then). Reserved names and the ref-scheme and export-kind renames as in §2.

Not verified by Aegis: the MCP bridge (unbuilt, so the source of `hsid`, `agent` and `turn` is unreviewed until S1.4); the mod SDK's handling of `relayedFor`; whether any existing log holds `doodle:` refs (check before dropping the scheme).

## 10. Findings from the S1.0 reviews that bind later milestones (2026-11-23)

Sources: Aegis, Judge and Probe on PR #99. Fixed inside S1.0: audit overrides, pinned HTML-sink counts, the Firefox probe drive, marks lost right after mount, post-mount crash reporting, measured patch counts.

**S1.1 (reskin):**
- No image tool; the Gnomon rail does not offer it.
- The dead stock entry points go with the stock UI (menu links, Help links, "Browse libraries", Web Embed, Mermaid).
- Harness phases added to the probe: the command palette, a library-file drop, the image tool.
- G-DDL-07 asserts no colour literal within the minimum distance of a reserved colour outside a per-patch allowlist (the engine carries a violet family, not one hex).

**S1.2 (contracts):**
- The validator refuses `embeddable`, `iframe` and `image` types and `link` (already a §7 condition; Probe showed why).

**S1.3 (leaf), new condition C8:** the leaf intercepts paste and drop BEFORE the engine. "Plain text only" is not enough on its own: Probe showed, on the shipped chunk in Chrome and WKWebView, that
- pasting plain text that is SVG source creates an image element and raises `img-src` refusals;
- pasting engine clipboard JSON with an `iframe` element adds an `<iframe srcdoc>` to the DOM;
- pasting clipboard JSON with an `image` element and a `dataURL` raises `img-src` refusals, and a later PNG export raises more;
- dropping a `.excalidraw` file replaces the whole scene although `loadScene` is off;
- pasting a frame whose `name` is an object crashes the engine (React error #31): the leaf must show the failed state and offer a reload from the log.
So: pasted text becomes a text node through the dimension validator and never reaches the engine's paste parser; engine clipboard JSON, files and HTML are refused; a test replays each of Probe's seven repros (V1-V7 in his report) and expects zero CSP rows and zero new elements of a refused type.

**S1.4:** a test that marked-up text stays text; the Library components stubbed out of the bytes, not only unmounted.

**Backlog:** the GUI embed is inlined three times in the kernel dist (T-2026-11-24-005); `pack-roundtrip` and `sec-01` tests fail under npm 12 (`npm pack --json` shape); Firefox and Edge are listed as supported in §11.2 but were not on the founder's Mac for the local run (CI covers them).
