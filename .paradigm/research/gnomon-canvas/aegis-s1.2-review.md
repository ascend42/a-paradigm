# Aegis review of dimensions S1.2 (PR #103) and the first-party mod refresh

2026-11-24, filed by the orchestrator. The conditions for S1.3 and S1.4 at the end bind those milestones. The rulings on `first-party-mod-refresh.md` are under "Point 9".

Orchestrator check of finding 1: `packages/gnomon/src/kernel/socket/dispatch.ts:918` derives `surface` from the credential alone (`gui` or `cli`) and ignores the caller class it passes alongside.


**Verdict: approve with conditions.** Three cheap fixes before merge. Compat option (d) is approved for the morning, with conditions.

I had no shell, so no tests were run; everything below is from reading. Paradigm MCP tools were not available to me either.

### Findings

**Important 1. An agent can fold as human through `mod.command`.**
- `socket/methods.ts:114-119` lets the agent, session, mod and voice classes call the relays.
- `socket/dispatch.ts:918` stamps `surface: 'cli'` for every credential that is not `gui`, ignoring `cls`.
- `dim.ts:284` folds `cli` with no `agent` as `cls: 'human'`, and `owns()` (`dim.ts:606`) lets a human edit every node.
- This answers my open question from the design rulings: yes, as written.
- Fix: stamp `surface` only when `cls === 'human'`. Otherwise omit it, so `pickRelayedFor` drops it and the row folds unknown. Add a test per class.

**Important 2. Prototype keys survive the clamp.**
- `bridge.ts:91-92` spreads the mod's payload and deletes only the own `relayedFor`.
- An own `__proto__` key (from `JSON.parse`) is kept, and `canonicalJson` (`internal.ts:255`) stores it.
- The fold is safe today because it reads parsed JSON. Any reader that copies by assignment or `Object.assign` turns it into the prototype, and `payload.relayedFor` then reads the mod's forged stamp.
- No test covers it (`mod-stamp.test.ts` forges top-level keys only).
- Fix: refuse `__proto__`, `constructor` and `prototype` as top-level keys in `clampModAppend`, and read the stamp with `Object.hasOwn` in `byOf` and `hsidOf` (`dim.ts:280-292`).

**Important 3. An unentitled mod receives the session `principal`.**
- My C2 condition said such mods get `agent` and `surface`. The code and `mod-stamp.test.ts:149` also send `principal`.
- If a session principal is unique per session, that is `hsid` under another name. I could not confirm the principal format.
- Decide before merge, because a later fix costs a second `modAbiId` move. Either add `principal` to `RELAYED_FOR_IDENTITY.fields` (`mod-abi.ts:127`) or record that principals are not session-unique.

**Nit 4. Unstated secret-check residuals** (`dim.ts:525-526`, `710-747`):
- Variation selectors, the combining grapheme joiner and other combining marks are not stripped, and Hangul fillers are invisible letters; either splits a credential invisibly. Fix: also strip `\p{Mn}\p{Me}\p{Default_Ignorable_Code_Point}`.
- A split over three or more strings in non-sorted key order is missed (for example three refs).
- Base64, hex or URL-encoded secrets and format-less secrets are missed.
- `points` integers can carry bytes.
- The dimension `title` on the start row is outside `validateDimOps`.

**Nit 5. `dimViewOf` trusts core nodes** (`dim.ts:839-844`). Refs, colours and lengths of stored core nodes are emitted unchecked. Fix: re-run `validateDimRef` and the length caps there.

**Nit 6. Line colours have no contrast floor against the sheet.** `content-palette.ts:323` exempts neutral lines, so `custom:#F8F5EE` text is invisible by day but present in the view JSON.

**Pre-existing 7.** `host.ts:594` echoes the mod's own `init.abi` and `modAbiId` strings, unclipped, into a refusal the GUI prints. Clip and pattern-check them.

### Rulings on the ten points

1. **C1 holds, apart from finding 2.**
   - A top-level forged `relayedFor` or `causes` is replaced, and the cap is measured after stamping (`bridge.ts:94`).
   - Appends from a view or outside any call are refused `EFFECT` (`effects.ts:50`). An unstamped command or tool row has no `relayedFor` key.
   - Calls are serialised and the stamp is captured at bind (`host.ts:960`, `981`); a stale `callId` is refused.
   - "`surface: voice` from the cause turn" is not built, because `callTool` has no caller yet. It binds S1.4.
2. **C2 holds, apart from finding 3.**
   - `publisher gnomon` is tied to the first-party tier both ways (`manifest.ts:370-371`), and the tier comes from the hash (`install.ts:102-108`).
   - A partial tool stamp is dropped whole in the one caller (`host.ts:868`).
   - The untested `gnomon` branch is acceptable now; S1.3 must test it with `gnomon.dimension`.
3. **No forged-human shape exists except finding 1.** S1.3 must guarantee:
   - attach and write commands refuse non-human classes host-side;
   - the device credential is unreachable from a session sandbox (not verified).
4. **C3 and C4 hold.** Unknown fields and kinds, `by`, `relayedFor`, prototype keys, non-integers, 65 ops and non-owned edits are all refused by name. The lead word appears in the legend only; the renderer must call `dimFallbackLabel` (S1.4).
5. **See finding 4.** Refusals never echo input (`dim.ts:721-728`).
6. **A failing colour is refused at write and resolves to ink or no fill at paint.**
   - There is one OKLab copy (grep confirms).
   - The 3:1 edge-on-fill rule is a constant only; enforcement binds S1.4. Ink on a dark custom fill can fail it.
   - The two builder notes do not affect safety. Tighten the composite test to `>= CONTENT_MIN_DISTANCE`, and correct the 0.02 claim in the record.
7. **Correct: the loader refuses anything but `mcp`** (`manifest.ts:611-613`), at stage and at load, with no echo. I did not trace the offer router's manifest source.
8. **Names are reserved in `mod-id.ts:42`; `doodle` is dropped in `ref.ts:43`.** The prefix rule and an already-installed squatter are not verified.
9. **See the next section.**
10. **§12.7.1 matches the code.** It lacks a falsifier for "unstamped or non-human folds unknown"; add one. I could not read §12.7 or §3.8 in full (the lines were too long for my search output).

### Point 9: superseded pins and Arky's memo

**(a) Superseded pins.** Safe while they cannot run and cannot be freshly installed. Conditions:
- Refuse a new stage of a superseded hash (rollback protection). I did not confirm `stageInstall` does this.
- Remove them at the next ABI move.

**(d) Compat acceptance: yes for the morning.**
1. **Yes.** Conditions:
   - an exact pin maps to exactly one prior id;
   - the tier is first-party by hash, the source is `package`, and the root-signed grant and snapshot rehash stand as today;
   - no grant, tier or identity change, and one log row;
   - the manifest at each compat pin declares no tools, since `tool.call` is the only changed method; hold this in a test;
   - format-1 historical pins are excluded.
2. **The diff is sufficient only as a CI test, not a one-time look.** Add one behavioural test per pin, asserting:
   - the old tree starts and is healthy;
   - a relayed render passes the sanitiser;
   - a relayed render with `fixtureEvents` does not replay (`workshop/index.mjs:31` and `ledger/index.mjs:33` rely on `relayedFor` being present);
   - the same id at another hash, from a linked source or from a third party is refused `ABI`.
3. **Yes, it must expire.** A test must fail when `MOD_ABI_ID` moves while the table is non-empty. No chains.
4. **Yes in principle, default off.** Conditions:
   - a root-signed standing grant, decided once with presence and revocable;
   - `package` source only, same id, target hash compiled into a verified signed kernel;
   - no widening of capabilities, egress, effects, tools, commands, events, MCP, offers or keys;
   - no downgrade, and a user pause is kept;
   - a log row, a notice and one-press rollback.
   - Never: the kernel holding or simulating the root key, cached presence, dev builds, or carrying egress grants to a changed host list.
   - I review the design before it is built.
5. **Yes.** Conditions:
   - first-party `package` mods only;
   - one content hash over the ordered per-mod surfaces;
   - every member re-derived at decide, and all-or-nothing rows;
   - each mod's surface shown, widening ones first, never collapsed;
   - per-mod exclusion before presence.

**DOWN cap and wording.** Yes to both. An `ABI` refusal should become a sticky in-memory `needs-update` state after one attempt, so paints do not respawn the child; do not make spawning unbounded. There is no security objection to the wording, provided it is host-composed (see finding 7).

**Where notify-and-proceed stops being safe:** any widening, any non-bundled source, an unverified kernel, or anything that replaces a root signature.

### Conditions
- **Before merge:** findings 1, 2 and 3; the (d) conditions if it ships in this PR.
- **S1.3:**
  - human-only attach and write;
  - the first-party identity test;
  - a secret and control-character check on the dimension title;
  - the GUI gesture proof.
- **S1.4:**
  - the source of `agent`, `hsid` and `turn`, with a closed charset for `agent` enforced host-side;
  - the voice surface derivation;
  - 3:1 edge-on-fill and a line contrast floor;
  - T3 fencing of the view;
  - findings 4 and 5.

### Not verified
- Any test run.
- OKLab figures.
- Session principal format.
- `stageInstall` handling of superseded pins.
- The offer router and GUI paths for `reach`.
- The reserved-name prefix rule.
- The three mods' manifests (my search for them matched nothing).
- The byte diff of the mod trees.
- Sandbox reach of the device credential.
