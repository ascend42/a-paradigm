# @a-company/gnomon-helper

The signed platform helper for the Gnomon kernel (`docs/specs/gnomon.md` §16, §18).
The kernel never holds approval-capable key material; the helper does: hardware
keys with presence, Keychain / Credential Manager anchors and the kernel-key item,
the Windows named pipe with its owner-only DACL, job objects, the WFP port filter,
and the private launch-token URL hand-off.

**Status: helper 1.10.0 (source; the last signed build is 1.9.0, see `checksums.json`), protocol `gnomon-helper:v2`.** The darwin helper holds the root and approvals keys in the Secure Enclave, the per-connId cached unlocks and (1.6.0) the voice arms per armId (spec §14.7, S29-K5). It speaks NDJSON over stdin/stdout (`serve` / `once`); v2 adds the arm ops, `conn.close` and an unsolicited session push. The kernel's floor is 1.6.0, so a 1.5.0 helper is refused until this one is rebuilt and signed. Private, not published, outside the root build.

| Path | What |
|---|---|
| `darwin/` | SwiftPM package (swift-tools 5.9, macOS 14), executable `gnomon-helper`: `--version`, `serve` (reader thread + main run loop with the session observer) and `once` (one request), speaking `gnomon-helper:v2`: key.list/create/public/delete, sign, unlock.drop(-all), arm.open/sign/close/close-all, conn.close, push `session`. `swift test` runs the unit tests in `darwin/Tests/`. CI builds it unsigned; signing (Developer ID) runs only on the founder's Mac. |
| `win32/` | Rust helper (P8-D71). Placeholder only. |
| `bin/` | Build output (gitignored): `bin/darwin/GnomonHelper.app` from `scripts/build-darwin.mjs`. |
| `checksums.json` | sha256 of each built binary in `bin/`. **Advisory**: the kernel never reads this file. The checksum of spec `G-HLP-01` is wired through the release manifest instead (T-2026-10-21-028): `packages/gnomon/scripts/write-release-manifest.mjs` (`npm run build:release -w @a-company/gnomon`) records the signed helper's sha256, the release build compiles it into the kernel bundle, and a release kernel refuses any other bytes (`checksum`) on top of the code-signing requirement and the version floor (`packages/gnomon/src/kernel/identity/helper.ts`, `lifecycle/release-pins.ts`). A dev build (no manifest) pins the signature and the version floor only. |

Build (macOS):

```sh
node packages/gnomon-helper/scripts/build-darwin.mjs              # signed: Developer ID identity from the keychain, profile from ~/.config/gnomon-signing
node packages/gnomon-helper/scripts/build-darwin.mjs --unsigned   # bundle only (CI)
node packages/gnomon-helper/scripts/notarize-darwin.mjs           # optional: notarytool --keychain-profile gnomon-notary, staple
```

Output: `bin/darwin/GnomonHelper.app` (gitignored) and its sha256 in `checksums.json`.

## Founder flow (macOS, from the repo root)

Every root or approvals signature shows a Touch ID / password prompt: the
caller's text, then the helper's own line `Gnomon Helper: <key> key signs <n>:
<digest>…`. Where the CLI prints "the prompt must end with <digest>", check
that the helper line ends with the same value; press Cancel if it does not.

1. Build the kernel and the signed helper (no Touch ID; macOS may ask once to
   let codesign use the Developer ID key — enter your login password, Always
   Allow):

   ```sh
   npm run build:gnomon
   node packages/gnomon-helper/scripts/build-darwin.mjs
   ```

2. Hardware test — run it BEFORE `identity init` (the helper refuses a new key
   generation while another exists). Three prompts: approve 1/3, approve the
   root prompt, CANCEL 3/3; there must be no prompt between the first two.

   ```sh
   cd packages/gnomon && GNOMON_HW_TESTS=1 npx vitest run test/identity-hw.test.ts && cd ../..
   ```

3. Provision the root (two prompts: the approvals key, then this device):

   ```sh
   node packages/gnomon/dist/cli/gnomon.js identity init --name matt
   node packages/gnomon/dist/cli/gnomon.js identity status
   ```

4. Remove a leftover or retired generation (one prompt per key; never the live one):

   ```sh
   node packages/gnomon/dist/cli/gnomon.js identity purge-keys --gen <gen>
   ```

5. Rotate (the old root signs the change; type `rotate`; three prompts, then it
   offers to purge the old generation) or recover a LOST root (type `recover`;
   a new namespace, logged as not signed by the lost root):

   ```sh
   node packages/gnomon/dist/cli/gnomon.js identity init --rotate
   node packages/gnomon/dist/cli/gnomon.js identity init --recover
   ```

Optional, no prompt: `node packages/gnomon-helper/scripts/notarize-darwin.mjs`.

## Keychain separation (Aegis H1, M1.3 round 2)

| Binary | Code identifier | Keychain access group | Passes the kernel pin? |
|---|---|---|---|
| production helper (`GnomonHelper.app`) | `gnomon.helper` | `SW4BMQ8PNL.gnomon.prod` only | yes (requirement + `info` version floor) |
| probe helper (`GnomonHelperProbe.app`, P00/P04/P05) | `gnomon.probe` | `SW4BMQ8PNL.gnomon.probe` only | no (identifier), and it refuses production tags and services |

What code can and cannot do: both binaries embed the one Developer ID
provisioning profile (App ID `SW4BMQ8PNL.gnomon.helper`). That profile grants
`keychain-access-groups = SW4BMQ8PNL.*` (the team wildcard), so ANY binary the
team signs with it may claim ANY team group in its entitlements, `.prod`
included. The groups above separate the binaries we build; they do not stop a
future team-signed binary from claiming `.prod`. Real separation needs the
production helper on its own App ID with its own profile, and no other team
binary signed with that profile. `build-darwin.mjs` signs with exactly
`SW4BMQ8PNL.gnomon.prod`, refuses any other signed group list, and records
`groupGrant: explicit | team-wildcard` in `checksums.json`.

## Helper 1.10.0: the `permission` row table (founder, TD-2026-10-28-969, G-HLP-02)

1.11.0 (TD-2026-10-29-746, S1; spec G-HLP-03, G-HLP-04) adds the caller check and the ops it guards, none of which takes presence: `kernel.cert` (the Secure Enclave `kernel-cert` key certifies the kernel's ephemeral Ed25519 key per boot), `anchor.read` / `anchor.write` (the log head item `gnomon-head`), `presence.mode` / `presence.mode.on` (the helper's own copy of the Touch ID switch) and `click.open` / `click.sign` (the non-permanent click key, approve:v1 only), plus the `presence.mode` and `kernel-custody` row tables. Same protocol `gnomon-helper:v2`; the kernel selects them from `info.version` (`HELPER_OP_MIN`, `ROW_TABLE_MIN_HELPER`). Only a Developer-ID-signed `gnomon.kernel` SEA passes the caller check. A DEV helper that also accepts `gnomon.kernel.dev` is a separate identity (Aegis S1 H1): `build-darwin.mjs --dev-kernel` signs `gnomon.helper.dev` (identifier and bundle id) with its own keychain group `SW4BMQ8PNL.gnomon.dev` and profile `~/.config/gnomon-signing/gnomon-helper-dev.provisionprofile`, into `bin/darwin-dev` (never `bin/darwin`, never `checksums.json`). Only a dev SEA kernel accepts it; `release-darwin.mjs` refuses any helper whose bundle id is not `gnomon.helper` or whose `info.devKernel` is not false. One-time setup for the dev profile: in the Apple Developer portal register the App ID `SW4BMQ8PNL.gnomon.helper.dev` with the Keychain Sharing capability and the group `SW4BMQ8PNL.gnomon.dev`, create a Developer ID provisioning profile for it, and save it at that path. Moving the log anchor to another log needs a genesis row naming the anchored head or a `log.quarantine` root decision (H2); a click key signs only `gnomon:approve:v2`, whose preimage names the card kind and class (M1). Rebuild, sign and commit `checksums.json` as below (`--version` prints `gnomon-helper 1.11.0`).

1.11.1 (TD-2026-10-29-746 S2; Aegis S2 M-2, M-3) changes two rules, same protocol: `anchor.write` with a genesis row also needs `genesisSig`, an Ed25519 signature over `gnomon:log-genesis:v1\n` + the genesis bytes by the kernel key this helper process certified (`kernel.cert`), so a genesis row alone never moves the anchor; and `click.sign` signs only the click-approvable card kinds (an allowlist, `clickApprovableKinds`, shared vectors). The kernel sends a genesis and `click.sign` only to 1.11.1 (`HELPER_OP_MIN['anchor.genesis']`, `HELPER_OP_MIN['click.sign']`); a 1.11.0 helper keeps every other op. Rebuild, sign and commit `checksums.json` (`--version` prints `gnomon-helper 1.11.1`).

1.10.0 adds one row table to `decision.sign`: a `permission` decision (a destructive brokered Always) signs its gnomon-root-decision:v2 row only, and any further row is refused. No new op, no new entitlement, same protocol `gnomon-helper:v2`; the kernel's floor (`MIN_HELPER_VERSION`) stays 1.6.0. The kernel offers a destructive Always only when the running helper is 1.10.0 or newer (`ROW_TABLE_MIN_HELPER.permission`); with 1.9.0 the card offers allow and deny only. Rebuild, sign and check it with the same steps as 1.6.0 below (`--version` prints `gnomon-helper 1.10.0`), and commit `checksums.json`. Users get it only inside a new signed `Gnomon.app` (`packages/gnomon/scripts/release-darwin.mjs --notarize`, then `seal-npm-release.mjs` and `npm run publish:gnomon`; spec §18.1).

## Helper 1.7.0: rebuild, sign, notarize (founder, TD-2026-10-20-086 F4/F5)

1.7.0 raises the cached-unlock bounds to 12 h and 512 signatures with no separate idle limit (the session observer ends the unlock at lock, sleep or user switch) and reports them on a kept sign (`bounds`). The kernel accepts 1.6.0 and 1.7.0: with 1.6.0 it keeps the lower 1.6.0 bounds (15 min idle, 60 min, 64), so the longer unlock only takes effect once 1.7.0 is built, signed and notarized with the same steps as below (`--version` prints `gnomon-helper 1.7.0`), and `checksums.json` is committed. No new entitlement, same protocol `gnomon-helper:v2`.

## Helper 1.6.0: rebuild, sign, notarize (founder)

The kernel now requires protocol `gnomon-helper:v2` and helper 1.6.0 or later. Until the helper is rebuilt, every helper-backed step refuses with `version`.

```sh
node packages/gnomon-helper/scripts/build-darwin.mjs      # swift build -c release, bundle, codesign (Developer ID, runtime, timestamp), verify against HELPER_REQUIREMENT, checksums.json
node packages/gnomon-helper/scripts/notarize-darwin.mjs   # notarytool --keychain-profile gnomon-notary --wait, then staple
packages/gnomon-helper/bin/darwin/GnomonHelper.app/Contents/MacOS/gnomon-helper --version   # gnomon-helper 1.6.0
```

1.6.0 links AppKit, CoreGraphics and IOKit (for the session observer). It needs no new entitlement: the keychain group stays exactly `SW4BMQ8PNL.gnomon.prod`. Commit the updated `checksums.json`. Then restart the daemon, or re-run `gnomon setup` (its helper-line check must still pass).

## Manual oracle: an arm drops within 1 s of a screen lock

Guided form (only Touch ID needed; three rounds, a summary table and `~/.gnomon/lock-check-<date>.json`): `node packages/gnomon-helper/scripts/lock-check.mjs` (`--no-arm` for the handshake only). The manual steps follow.

No GUI arm path exists before V7, so drive the signed 1.6.0 helper directly. You need a provisioned approvals key; `key.list` gives its generation `<gen>`.

0. Stay logged in at the console (the helper refuses `session-locked` otherwise).
1. Start the helper with stdin held open and every output line timestamped:
   `mkfifo /tmp/gh.in; (cat /tmp/gh.in | <app>/Contents/MacOS/gnomon-helper serve | while read -r l; do echo "$(date +%T) $l"; done) & exec 3>/tmp/gh.in`
2. Open an arm. One Touch ID prompt appears, and its last line names the arm, both connIds and the bounds:
   `echo '{"id":1,"op":"arm.open","armId":"arm:01J0000000000000000000000A","gen":"<gen>","humanConnId":"conn:h","voiceConnId":"conn:v","hardSeconds":600,"maxSignatures":5,"reason":"oracle","messages":["Z25vbW9uOmFwcHJvdmU6djEKY2FyZDp4CmFsbG93CnNoYTI1NjowMApodW1hbg=="]}' >&3`
   Expected: `"kept":true,"ok":true`. Sending `{"id":2,"op":"info"}` shows `"arms":1`.
3. Look at a clock that shows seconds, then lock the screen (Ctrl-Cmd-Q). Unlock after about 5 s.
4. Pass: a line such as `{"arms":["arm:01J0…"],"cause":"screen-lock","push":"session","seq":1,"unlocks":0}` is stamped within 1 s of the lock. More pushes with `"arms":[]` (screensaver, display-sleep) are fine. `{"id":3,"op":"info"}` now shows `"arms":0`.
5. Repeat with Apple menu, Sleep (cause `system-sleep` or `display-sleep`) and with fast user switching (cause `user-switch`).
6. Close stdin with `exec 3>&-` (EOF). The helper exits, and every arm and unlock ends with it. In the daemon this is `approval.voice.disarm{reason:'helper-exit'}`.
