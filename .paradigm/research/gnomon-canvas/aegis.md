# Boards threat model: Aegis

2026-11-23. Analysis only. Most of what boards need exists as Doodle in the spec (`docs/specs/gnomon.md:1518-1531`), not in code: no `packages/gnomon-mods/doodle`, `kit.Canvas` is a placeholder (`packages/gnomon-gui/src/core/render.ts:347-348`), and `inject.receipt` is written by no kernel code.

## 1. Board content as untrusted input
- Exists in code: CSP `frame-src 'none'`, loopback-only `connect-src`, `img-src 'self' blob:` (`packages/gnomon/src/kernel/web/rules.ts:45-58`); strings render as DOM text (render.ts:9). In spec: no SVG from `/blob`, images re-encoded, Excalidraw embeds off, sheet/OCR text sanitized and fenced, Doodle hits return as T3.
- **Blocker:** live webpage embeds. A same-origin iframe could read the GUI token and use the authenticated socket. Webpages = kernel-fetched raster snapshot plus an external link. A live view only on a separate loopback origin, sandboxed without `allow-same-origin`, with a `G-WEB-06` case first.
- Must design in: provenance on everything read back into agents (author, `local | repo:<path>@<commit>`), repo boards below T3, a real `inject.receipt`.
- Must design in: P12 on WKWebView (T-2026-11-06-003).

## 2. Spoofing approval surfaces
- Exists: mod output fenced and labelled (`mod-panels.ts:224-225`), mods can't bind decision keys (`manifest.ts:84`), append-only card slots (G-MOD-07), Touch ID dialog can't be faked.
- Must design in: board text is canvas-drawn, so a sticky saying "Approve? [y]" bypasses the DOM fence. Boards never cover the stack, status bar or composer; full-screen and VR keep a reserved strip; cards carry a sign boards can't reproduce (§12.8 kernel-signed provenance).
- Must design in: Excalidraw single-letter shortcuts overlap reserved keys (`a`, `d`). While a card is focused the board gets no keys; a board keystroke never decides a card.

## 3. Agent write access and authorship
- Exists: `relayedFor` stamped from the authenticated connection (`dispatch.ts:905-919`, `host.ts:823-838`); spec caps (64 agent ops/turn, agents never touch human marks, 256 KiB / 2,000 nodes per block).
- Must design in: per-board write grants per hsid, set by the human; agents can't delete or restyle each other's marks.
- Must design in: authorship in a repo board is only a claim unless signed (kernel-signed export bundle or signed commits); show "claimed author".
- Later: per-board op and blob budgets.

## 4. Board mods
- Exists: out-of-process mods, `display-block:v1` closed kit, no executable content (G-MOD-10), kernel-proxied egress, hash-pinned trust tiers.
- **Blocker:** third-party JS live widgets in the GUI break G-MOD-10. Keep board mods declarative: kit blocks plus host primitives; "live" = host re-calls `view.render` on granted events; teammates without the mod see the stored snapshot or alt text. Anything more needs a separate-origin sandbox design first.
- Must design in: board-file node data is hostile input to mods; the host validates size and schema first.

## 5. Boards in repos
- Exists: privacy pass on images (G-DDL-02), `audience: private` in 8.0, kernel git refuses custom merge drivers and filters.
- **Blocker:** committing a board is egress. A human export card shows every image, embed URL and secret-pattern text match; redaction re-runs; URL queries/fragments stripped; unredacted images excluded by default.
- Must design in: op rows are kept forever, so a typed secret survives "redaction". Label text payloads or store text as prunable blob refs.
- Must design in: opening a teammate's board = closed-schema parse with caps, sandboxed image re-decode, read-only until accepted.
- Must design in: a format that merges without a custom driver (e.g. append-only per-author op files named by ULID).

## 6. Live status nodes
- Exists: sensitivity = strictest of kind default and label (`redaction.ts:86-98`), per-reader-class visibility (`redaction.ts:151-223`).
- Must design in: the board can launder data across reader classes. Live nodes store references, not values; every read and export re-projects under the reader's class; screenshots go through the privacy pass.
- Later: never show voice handles/challenges or `approval.request.tool_input` on any node.

## Priority
1. Blocker: no iframe or third-party JS on the GUI origin; raster webpages; declarative board mods.
2. Blocker: repo commit = human export card with redaction and URL stripping.
3. Reserved card/status strip; board loses key focus while a card is focused.
4. Per-hsid write grants, inter-agent ownership, "claimed" authorship unless signed.
5. Keep secret text out of permanent op rows.
6. Re-project reads and exports per reader class; real `inject.receipt`.
7. Strict repo-board import; driver-free merge format.
8. Close P12 on WKWebView.
