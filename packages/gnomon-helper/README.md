# @a-company/gnomon-helper

The signed platform helper for the Gnomon kernel (`docs/specs/gnomon.md` §16, §18).
The kernel never holds approval-capable key material; the helper does: hardware
keys with presence, Keychain / Credential Manager anchors and the kernel-key item,
the Windows named pipe with its owner-only DACL, job objects, the WFP port filter,
and the private launch-token URL hand-off.

**Status: PR-0 scaffold.** Private, not published, outside the root build.

| Path | What |
|---|---|
| `darwin/` | SwiftPM package (swift-tools 5.9, macOS 14), executable `gnomon-helper`. Today it only prints its version. Signing (Developer ID, OPEN 1) never runs in CI. |
| `win32/` | Rust helper (P8-D71). Placeholder only. |
| `bin/` | Prebuilt, signed binaries land here at release time. |
| `checksums.json` | sha256 of each binary in `bin/`; verified by the kernel at start (`G-HLP-01`). |

Build (macOS):

```sh
cd packages/gnomon-helper/darwin && swift build
.build/debug/gnomon-helper --version
```
