# @a-company/gnomon-helper

The signed platform helper for the Gnomon kernel (`docs/specs/gnomon.md` §16, §18).
The kernel never holds approval-capable key material; the helper does: hardware
keys with presence, Keychain / Credential Manager anchors and the kernel-key item,
the Windows named pipe with its owner-only DACL, job objects, the WFP port filter,
and the private launch-token URL hand-off.

**Status: M1.3 slice 1.** The darwin helper holds the root and approvals keys in the Secure Enclave and speaks `gnomon-helper:v1` (NDJSON over stdin/stdout, `serve` / `once`). Private, not published, outside the root build.

| Path | What |
|---|---|
| `darwin/` | SwiftPM package (swift-tools 5.9, macOS 14), executable `gnomon-helper`: `--version`, `serve` (NDJSON loop) and `once` (one request) speaking `gnomon-helper:v1` — key.list/create/public/delete, sign, unlock.drop(-all). CI builds it unsigned; signing (Developer ID) runs only on the founder's Mac. |
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
