# Gnomon M1.0 probes

Spec: `docs/specs/gnomon.md` §19.1, "M1.0 probe set". Each probe is
`<id>/probe.mjs`: zero dependencies and no build step. Run one with:

    node packages/gnomon/probes/run.mjs <id> [--out-dir <dir>] [--timeout <ms>]

Each run writes `results/<id>.<os>.json` (`probeResult:v1`). Commit results
from hardware runs only. `_shared/` holds code the probes import (the browser
harness, the signing recipe and the Swift helper stub). It is not a probe,
because its id cannot match the runner's id pattern.

On a non-darwin OS, the macOS probes record `verdict: partial` with a reason.
The Windows halves belong to the Windows parity phase (P8-D78).

## Unattended (an agent can run these)

| id | what it measures |
|---|---|
| `p06-local-caps` | `n_ctx` from `/slots` and `/props`, plus tool-call capability, for each llama.cpp endpoint. Configure with `P06_ENDPOINTS=http://127.0.0.1:8080,…`, or set `P06_GGUF=<model>` to let the probe start `llama-server`. No endpoint gives `partial`: "recorded, not failed". |
| `p09-ed25519-matrix` | WebCrypto Ed25519 in Node and in every local engine (Chrome, Chrome for Testing, headless shell, Edge, Firefox, WKWebView), each loaded under the §11.2 CSP. |
| `p12-excalidraw-csp` | The pinned Excalidraw, bundled with esbuild in a temp dir and loaded under the §11.2 CSP: mount, scene, PNG/SVG export, every CSP violation, size and parse time. Needs network for `npm install`. |
| `p14-link-outbound` | A default-deny `sandbox-exec` `link` profile: one allowed outbound TCP, with every other path refused. |

Engines are driven by "open this URL" only. Each page POSTs its report to the
probe's own loopback server, so the probes need no CDP and no Playwright.

## Founder-run

Run these in a terminal (a TTY). Each one prints what to do at every step.
With no TTY, or with `GNOMON_PROBE_UNATTENDED=1`, a probe runs only its
prompt-free half and records `partial`.

    node packages/gnomon/probes/run.mjs p00-sign-notary
    node packages/gnomon/probes/run.mjs p04-se-helper --timeout 1800000
    node packages/gnomon/probes/run.mjs p05-keychain-acl --timeout 1800000
    sudo -v && node packages/gnomon/probes/run.mjs p07-launch-token --timeout 3600000
    node packages/gnomon/probes/run.mjs p01-claude-cli-manual --timeout 1800000

- **P00, P04, P05** read `~/.config/gnomon-signing/gnomon-helper.provisionprofile`,
  the `gnomon-notary` notarytool profile (P00 only) and the identity
  `Developer ID Application: Matthew Canoy (SW4BMQ8PNL)`. If any of these is
  missing, the probe stops with
  `MISSING PREREQUISITE: … — see docs/private/gnomon-founder-steps.html section 1`.
  The helper is `_shared/helper/ProbeHelper.swift`, built into
  `GnomonHelperProbe.app` (bundle id `gnomon.helper`, App ID
  `SW4BMQ8PNL.gnomon.helper`, access group `SW4BMQ8PNL.gnomon`) in a temp dir.
  The build steps:
  1. `xcrun swiftc -O _shared/helper/ProbeHelper.swift -o <app>/Contents/MacOS/gnomon-helper`
  2. Write `Info.plist`, then copy the profile to `Contents/embedded.provisionprofile`.
  3. `codesign --force --options runtime --timestamp --entitlements helper.entitlements --sign "Developer ID Application: Matthew Canoy (SW4BMQ8PNL)" <app>`
  4. `codesign --verify --strict --deep -vv <app>`

  P00 has one option: `P00_SUBMIT=1` also notarizes and staples the stub.
- **P07** needs Full Disk Access for the terminal (for eslogger and the Safari
  history files) and root for `eslogger`. A positive control puts the token on
  `open`'s argv, which proves the capture can see it.
- **P01 manual** uses the `claude` path recorded in `results/p01-claude-cli.<os>.json`,
  never `PATH`. Keep `ANTHROPIC_API_KEY` unset.
- **S29-10** is a stub (`s29-10-voice-custody/README.md`). It needs the signed
  helper (M1.1) and the wrapper panel (M1.13).

## P09: Safari by hand

Open `p09-ed25519-matrix/safari.html` in real Safari (File > Open File). It
prints one line. Paste that line back, or record it with
`P09_SAFARI_LINE="<line>" node packages/gnomon/probes/run.mjs p09-ed25519-matrix`.

Line format:

    ed25519 <m> verify · <m> forged · <m> rfc8032 · <m> spki · <m> non-canonical-s · <m> empty-msg · PASS|FAIL · safari <version> · <file|http>

Each `<m>` is what `verify()` did: `✓` accepted, `✕` rejected, `?` not reached.
A correct engine shows `✓ verify · ✕ forged · ✓ rfc8032 · ✓ spki` and ends in
`PASS`. `forged` covers a flipped signature byte and a flipped message byte,
and is `✕` only if both are rejected. `rfc8032` is RFC 8032 §7.1 TEST 2. The
last two marks are informational and do not gate: `non-canonical-s` (S + L
should be rejected, `✕`) and `empty-msg` (TEST 1, an empty message). If the
engine has no Ed25519, the line reads `ed25519 ✕ unsupported (<error>) · FAIL`.

`safari.html` is generated from `ed25519-test.js` by `make-safari-html.mjs`.
The probe fails if the two drift.
