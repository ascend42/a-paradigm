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
| `checksums.json` | sha256 of each binary in `bin/`; verified by the kernel at start (`G-HLP-01`). |

Build (macOS):

```sh
node packages/gnomon-helper/scripts/build-darwin.mjs              # signed: Developer ID identity from the keychain, profile from ~/.config/gnomon-signing
node packages/gnomon-helper/scripts/build-darwin.mjs --unsigned   # bundle only (CI)
node packages/gnomon-helper/scripts/notarize-darwin.mjs           # optional: notarytool --keychain-profile gnomon-notary, staple
```

Output: `bin/darwin/GnomonHelper.app` (gitignored) and its sha256 in `checksums.json`.
