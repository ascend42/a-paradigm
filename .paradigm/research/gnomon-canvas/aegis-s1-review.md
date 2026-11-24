# Aegis review of the S1 build plan

2026-11-23. Verdict: **approve with conditions**. Blockers: the agent identity carrier (2a) before S1.2, and lore export as unreviewed repo egress (S1.6). Conditions are folded into `s1-build-plan.md` §7.

## Priorities vs plan
| # | Priority | Status |
|---|---|---|
| 1 | No iframe / third-party JS | Partly: Excalidraw `embeddable`/`iframe` elements and URL-to-embed paste not explicitly refused; hiding UI doesn't remove them; `frame-src 'none'` (`rules.ts:54`) is only a backstop |
| 2 | Repo commit via export card | Partly: S3 is fine, but S1.6 writes `.lore` (committed) with no card, redaction or URL stripping |
| 3 | Reserved strip, keys yield | Covered (S1.3, G-DDL-08); weakened by `custom:#rrggbb` |
| 4 | Grants, ownership, claimed authorship | Partly: human-set per-board write grants missing |
| 5 | Secret text out of op rows | Partly: refusal must be in the mod validator on both paths |
| 6 | Re-project reads, `inject.receipt` | Partly: `doodle.view` doesn't fence text as T3 with provenance |
| 7 | Strict import, driver-free merge | Deferred to S3, acceptable |
| 8 | P12 on WKWebView | Covered (S1.0) |

## New risks
- a. `RelayedFor` is `{principal, connId}` (`mod-abi.ts:95-98`, stamped at `host.ts:823-838`): no agent or hsid, so G-DDL-09 can't hold for agents without a contract change, contradicting "`modAbiId` unchanged".
- b. `custom:#rrggbb` can mimic mineral, semantic and approval colours. Dashed strokes enforced in the mod.
- c. Secret check bypasses: split ops, in-place edits, NFKC lookalikes, zero-width characters, other fields (`link`, `customData`, frame names, `originalText`).
- d. `build.mjs:57-58` hashes only `app.js` plus `static/`; a separate board tree would be served unpinned; `.map` files would leak source (`rules.ts:103`).
- e. Stubbed `eval`/`new Function`/WebAssembly code can remain in the bundle; never add `wasm-unsafe-eval`; React in production mode.
- f. Third-party library JS on the token origin; Excalidraw's hardcoded hosts (esm.sh, excalidraw.com, json/collab backends).
- g. The MCP bridge is a new privileged child; its tool list, scoping and credential are unspecified.
- h. Excalidraw input surfaces: global keyboard handling, Cmd+O / `loadFromBlob`, `text/html` and clipboard JSON paste, drag-and-drop.
- i. Element `link` makes text clickable ("Approve here" to any URL).
- j. Board text read back to agents is cross-agent prompt injection.
- k. `gnomon doodle replay`/`stats` print board text; strip terminal control characters.
