# s29-10-voice-custody — stub (no probe.mjs yet)

Spec §19.1 M1.0 S29-10; §14.7 arms and handles, §16 voice row (K8).

Claim to test: TCC microphone attribution of a daemon-spawned, signed
`gnomon-voice` running under the `voice` profile; and a wrapper-owned `NSPanel`
with `sharingType = .none` staying out of `screencapture` and ScreenCaptureKit
captures on macOS 15 and 26.

Not written yet, because both halves depend on artefacts that do not exist:

- **Mic attribution** needs a Developer-ID-signed `gnomon-voice` binary,
  spawned by the daemon (the TCC "responsible process" is the point of the
  test). The probe helper in `_shared/helper/` is a keychain/SE stub; signing a
  voice stub with the microphone usage string, then spawning it from a
  launchd-started parent, is M1.1 helper work.
- **Capture exclusion** needs the wrapper's panel (M1.13). An unsigned
  stand-in panel could be screenshotted today, but it would not test the
  wrapper's process or its signing, so its result could not be committed as
  this probe's.

When the signed helper lands (M1.1), write `probe.mjs` here: build and sign
`gnomon-voice` with the `_shared/signing.mjs` recipe, spawn it from a
launchd-started parent, have the founder record the app name the TCC dialog
shows, then show a `sharingType = .none` panel with a known colour and check
the pixels in a `screencapture -x` image and an `SCScreenshotManager` capture.
The Windows half (`WDA_EXCLUDEFROMCAPTURE`) belongs to the Windows parity phase
(P8-D78).
