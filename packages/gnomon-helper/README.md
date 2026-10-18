# @a-company/gnomon-helper

The signed platform helper for the Gnomon kernel (`docs/specs/gnomon.md` §16, §18).
The kernel never holds approval-capable key material; the helper does: hardware
keys with presence, Keychain / Credential Manager anchors and the kernel-key item,
the Windows named pipe with its owner-only DACL, job objects, the WFP port filter,
and the private launch-token URL hand-off.

**Status: M1.3 slice 1.** The darwin helper holds the root and approvals keys in the Secure Enclave and speaks `gnomon-helper:v1` (NDJSON over stdin/stdout, `serve` / `once`). Private, not published, outside the root build.

| Path | What |
|---|---|
| `darwin/` | SwiftPM package (swift-tools 5.9, macOS 14), executable `gnomon-helper`. Today it only prints its version. Signing (Developer ID, OPEN 1) never runs in CI. |
| `win32/` | Rust helper (P8-D71). Placeholder only. |
| `bin/` | Prebuilt, signed binaries land here at release time. |
| `checksums.json` | sha256 of each built binary in `bin/`. **Advisory**: the kernel does not read it; the pin is the code-signing requirement plus the version floor (`packages/gnomon/src/kernel/identity/helper.ts`). Spec `G-HLP-01` also names a checksum verified at start; that is not wired (reported gap). |

Build (macOS):

```sh
node packages/gnomon-helper/scripts/build-darwin.mjs              # signed: Developer ID identity from the keychain, profile from ~/.config/gnomon-signing
node packages/gnomon-helper/scripts/build-darwin.mjs --unsigned   # bundle only (CI)
node packages/gnomon-helper/scripts/notarize-darwin.mjs           # optional: notarytool --keychain-profile gnomon-notary, staple
```

Output: `bin/darwin/GnomonHelper.app` (gitignored) and its sha256 in `checksums.json`.

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
