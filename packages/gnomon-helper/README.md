# @a-company/gnomon-helper

The signed platform helper for the Gnomon kernel (`docs/specs/gnomon.md` §16, §18).
The kernel never holds approval-capable key material; the helper does: hardware
keys with presence, Keychain / Credential Manager anchors and the kernel-key item,
the Windows named pipe with its owner-only DACL, job objects, the WFP port filter,
and the private launch-token URL hand-off.

**Status: helper 1.6.0, protocol `gnomon-helper:v2`.** The darwin helper holds the root and approvals keys in the Secure Enclave, the per-connId cached unlocks and (1.6.0) the voice arms per armId (spec §14.7, S29-K5). It speaks NDJSON over stdin/stdout (`serve` / `once`); v2 adds the arm ops, `conn.close` and an unsolicited session push. The kernel's floor is 1.6.0, so a 1.5.0 helper is refused until this one is rebuilt and signed. Private, not published, outside the root build.

| Path | What |
|---|---|
| `darwin/` | SwiftPM package (swift-tools 5.9, macOS 14), executable `gnomon-helper`: `--version`, `serve` (reader thread + main run loop with the session observer) and `once` (one request), speaking `gnomon-helper:v2`: key.list/create/public/delete, sign, unlock.drop(-all), arm.open/sign/close/close-all, conn.close, push `session`. `swift test` runs the unit tests in `darwin/Tests/`. CI builds it unsigned; signing (Developer ID) runs only on the founder's Mac. |
| `win32/` | Rust helper (P8-D71). Placeholder only. |
| `bin/` | Build output (gitignored): `bin/darwin/GnomonHelper.app` from `scripts/build-darwin.mjs`. |
| `checksums.json` | sha256 of each built binary in `bin/`. **Advisory**: the kernel does not read it; the pin is the code-signing requirement plus the version floor (`packages/gnomon/src/kernel/identity/helper.ts`). Spec `G-HLP-01` also names a checksum verified at start; that is not wired (reported gap). |

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

## Helper 1.6.0: rebuild, sign, notarize (founder)

The kernel now requires protocol `gnomon-helper:v2` and helper 1.6.0 or later. Until the helper is rebuilt, every helper-backed step refuses with `version`.

```sh
node packages/gnomon-helper/scripts/build-darwin.mjs      # swift build -c release, bundle, codesign (Developer ID, runtime, timestamp), verify against HELPER_REQUIREMENT, checksums.json
node packages/gnomon-helper/scripts/notarize-darwin.mjs   # notarytool --keychain-profile gnomon-notary --wait, then staple
packages/gnomon-helper/bin/darwin/GnomonHelper.app/Contents/MacOS/gnomon-helper --version   # gnomon-helper 1.6.0
```

1.6.0 links AppKit, CoreGraphics and IOKit (for the session observer). It needs no new entitlement: the keychain group stays exactly `SW4BMQ8PNL.gnomon.prod`. Commit the updated `checksums.json`. Then restart the daemon, or re-run `gnomon setup` (its helper-line check must still pass).

## Manual oracle: an arm drops within 1 s of a screen lock

No GUI arm path exists before V7, so drive the signed 1.6.0 helper directly. You need a provisioned approvals key; `key.list` gives its generation `<gen>`.

1. Start the helper with stdin held open and every output line timestamped:
   `mkfifo /tmp/gh.in; (cat /tmp/gh.in | <app>/Contents/MacOS/gnomon-helper serve | while read -r l; do echo "$(date +%T) $l"; done) & exec 3>/tmp/gh.in`
2. Open an arm. One Touch ID prompt appears, and its last line names the arm, both connIds and the bounds:
   `echo '{"id":1,"op":"arm.open","armId":"arm:01J0000000000000000000000A","gen":"<gen>","humanConnId":"conn:h","voiceConnId":"conn:v","hardSeconds":600,"reason":"oracle","messages":["Z25vbW9uOmFwcHJvdmU6djEKY2FyZDp4CmFsbG93CnNoYTI1NjowMApodW1hbg=="]}' >&3`
   Expected: `"kept":true,"ok":true`. Sending `{"id":2,"op":"info"}` shows `"arms":1`.
3. Look at a clock that shows seconds, then lock the screen (Ctrl-Cmd-Q). Unlock after about 5 s.
4. Pass: a line such as `{"arms":["arm:01J0…"],"cause":"screen-lock","push":"session","seq":1,"unlocks":0}` is stamped within 1 s of the lock. More pushes with `"arms":[]` (screensaver, display-sleep) are fine. `{"id":3,"op":"info"}` now shows `"arms":0`.
5. Repeat with Apple menu, Sleep (cause `system-sleep` or `display-sleep`) and with fast user switching (cause `user-switch`).
6. Close stdin with `exec 3>&-` (EOF). The helper exits, and every arm and unlock ends with it. In the daemon this is `approval.voice.disarm{reason:'helper-exit'}`.
