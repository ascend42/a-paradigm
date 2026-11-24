# First-party mods across a modAbiId move

Arky, 2026-11-24, filed by the orchestrator. Found during dimensions S1.2 (PR #103). Aegis rules on the five questions at the end.

Orchestrator check: `git diff 5bede486..HEAD -- packages/gnomon-mods/` shows the three mod trees differ from their predecessors only in the manifest `version` line and the `MOD_ABI_ID` constant in `index.mjs`.


Read-only pass. I had no git or Paradigm tools, so history comes from `.purpose` files, decisions and lore, not from `git log`.

### Verified trace
- **Refusal:** `packages/gnomon/src/kernel/modhost/host.ts:592-594` stops the child (`abi-mismatch`) and throws `ABI` with "answered abi … / modAbiId …; the host speaks …".
- **Ids:** the source mods echo `cc5625da…` (`packages/gnomon-mods/{workshop,ledger,paradigm-context}/index.mjs:12-14`). The built app under `packages/gnomon/release/` still echoes `7aaf92f4…`.
- **Restart cap (was untraced):** mods start lazily through `admit()` (`host.ts:425-448`, called from `bridge.ts:160`). Each relay-triggered start pushes a restart stamp (`host.ts:440-445`), and the cap is 3 per 10 minutes (`host.ts:125`). So the user gets `ABI` on the first three view paints, then `DOWN … an operator start brings it back` (`host.ts:432-434`). That text is misleading, because a start cannot help.
- **What the panel shows:** `status()` reports the mod as plain `stopped` (`mods-admin.ts:280`; `gnomon-gui/src/core/mods.ts:231-235`). The row offers Pause, "Update to 1.1.1" and Uninstall (`mods-panel.ts:130-134`); there is no Start key for `stopped`. The view fence prints `<viewId> unavailable: <refusal>` (`core/mod-panels.ts:227`).
- **Update path:** `update` is set when the shipped hash differs from the pin and the source is `package` (`mods-admin.ts:308`). The key sends `request.mod.install`, then `stageInstall` raises one card per mod. A decided card restarts the mod and clears `DOWN` (`control.ts:435-437`).
- **Earlier move (was untraced):** `callId` moved the id `00ae702b → 7aaf92f4` at M1.11 slice 2 (`modhost/.purpose:84`). The Workshop is slice 3 (`install.ts:74`), so no installed first-party mod existed and there is no precedent. The current behaviour is written down as intended in `manifest/.purpose:162-165`.
- **How mods arrive:** there is no auto-install. The user installs from the panel's Available list or `gnomon mod install`, and the catalog is read only from the app's own `Resources/gnomon-mods` (`mods-admin.ts:74-82`).
- **Trust tier:** derived by hash only (`install.ts:102-108`); superseded pins keep first-party (`install.ts:79-97`).
- **What a card binds:** presence is bound to `{action, cardId, contentHash, decision}` (`install.ts:721-723`). The rows are root-signed with `grant.install` last (`install.ts:870-876`). "What loads is decided only from those rows" (`install.ts:12-14`).
- **Spec:** §12.1 says first-party is "the trust tier, not a wider ABI". §12.3 says init answers this `modAbiId`. §12.5 lets dev mode re-pin without a card (`mod.repinned`), unless the manifest widens.

### Options
| Option | What changes | User sees | Security | Failure / rollback | Effort |
|---|---|---|---|---|---|
| a. Legible state | GUI model only: `stopped` with `update` reads "needs update for this Gnomon"; one "Update all" key stages three cards | Three mods dark; three typed passwords | No new authority | None | 1-2 h |
| b. Batch card | New broker path: one `install` card, N mods, one presence over a combined contentHash. `CARD_KINDS` feeds `clientApiId`, so it must reuse kind `install` | One password | Root-signed as today; one card must show N surfaces honestly | Partial commit needs all-or-nothing rows | 2-3 days |
| c. Kernel auto-reinstall | Kernel repins when the new hash is pinned in the signed kernel | Notice only | The kernel cannot sign root rows, so this breaks the `install.ts:12-14` invariant unless a root-signed standing grant authorises it | Auto rollback to the prior snapshot | 3-5 days |
| d. Compat shim | Host accepts a prior id only for snapshots whose packageHash is in a kernel table | Nothing breaks; Update key stays | Grants nothing. The signed kernel asserts that these exact bytes speak the current ABI | Delete the table entry and the mod is refused `ABI` as today | 2-3 h |
| e. Run from bundle | First-party mods are not snapshots | Nothing | Removes install consent and rollback for first-party; contradicts §12.1 | App update is the rollback | 1-2 weeks |

### Tonight: (d), with (a)'s wording
The three new trees are "no behaviour change" (`gnomon-mods/.purpose:37,71,105`), and I found no `tools` or `commands` key in the three manifests. Old and new bytes should differ only in the constant and the version.

- **Files:** `manifest/install.ts` (turn `SUPERSEDED_FIRST_PARTY_PINS` into a map from pin to accepted prior `modAbiId`), `host.ts:592` (accept the prior id only when `loaded.packageHash` is in the map, the tier is first-party and the source is `package`; emit `mod.health{ok:true, compat:true}`), `gnomon-gui/src/core/mods.ts` (wording), the `.purpose` files, and §12.3.
- **Tests:** an old-id tree at a superseded hash starts. The same id at any other hash, or from a linked source, is refused `ABI`. A byte diff of the `release/` trees against source shows only the id and version lines.
- **Spec id:** one new falsifier, `G-MOD-14` (confirm it is free).
- **Contract ids:** none move. `MOD_ABI_ID` is untouched and `status` gains no field.
- **Must never:** accept a prior id by tier or publisher alone; cover a move that changes what a mod must do; re-tier or write a grant.
- **If Aegis refuses:** ship (a) and a known-limitation note in the changelog.

### Later: (c) under a standing grant
One root-signed "keep first-party mods current" grant, decided once. The kernel then repins on upgrade, following the dev-mode `mod.repinned` precedent, with a notice, a log row and one-press rollback.

- **Files:** `grants.ts`, `install.ts`, `control.ts`, a Settings toggle, §12.4-12.5.
- **Contract ids:** a new row kind probably moves `clientApiId`, so batch it with the next planned move.
- **Must never:** repin a widened manifest, a changed source, a downgrade or an unpinned hash; run without the grant; skip the log row.
- **Also fix:** `ABI` refusals should not count toward the `DOWN` cap.

### For Aegis (yes/no)
1. May the host accept a prior `modAbiId` for a snapshot whose exact packageHash the signed kernel lists?
2. Is a byte diff limited to the id and version lines sufficient evidence, or is a per-pin behavioural test required?
3. Must the shim expire (removed at the next move) rather than accumulate?
4. Is a pinned-hash tree inside the signed app already within the boundary the user accepted, so that a standing grant may authorise kernel-signed repins?
5. May one `install` card carry several mods under one presence?

### Not verified
- Git history of the pins and of the mods' `index.mjs`.
- Whether the 1.0.0 historical pins echo `7aaf92f4`.
- The actual byte diff between old and new trees.
- The exact GUI refusal string composition.
- Whether `G-MOD-14` is free.
- Whether `mod.health` payload keys are contract-hashed. If they are, drop `compat:true` tonight.
- No Paradigm ripple or wisdom calls were run.
