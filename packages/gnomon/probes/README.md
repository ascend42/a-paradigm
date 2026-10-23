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
| `p14-link-outbound` | A default-deny `sandbox-exec` `link` profile: one allowed outbound TCP, with every other path refused. SBPL accepts only `*` or `localhost` as the host. |
| `p14b-link-fdpass` | The kernel dials the peer and hands the connected socket to a deny-default child that has no `network*` allow (`subprocess.send(msg, socket)`). Checks: 4 MiB both ways, the peer's close, a redial hand-off, and every child-originated connect/UDP/listen/unix/file/exec refused. |
| `p14b-web-handoff` | The inbound twin of P14b (T-2026-10-18-020): the kernel listens on `127.0.0.1` and hands each accepted socket to a deny-default transport child with no `network-*` rule. Checks: 4 MiB both ways, the client's close, 5 repeated hand-offs, and EPERM for every child bind/listen (0.0.0.0, ::, en0, 127.0.0.1, ::1, no host), UDP bind, outbound TCP and unix connect. |

Engines are driven by "open this URL" only. Each page POSTs its report to the
probe's own loopback server, so the probes need no CDP and no Playwright.

## Windows (W1, docs/plans/gnomon-windows.md)

Unattended, on a Windows machine with the repo-built helper
(`packages/gnomon-helper/bin/win32/gnomon-helper.exe`):

| id | win32 arm |
|---|---|
| `p01-claude-cli` | resolves `claude.exe` from the kernel's win32 `knownBinaries` row (read from `src/platform/claude-code.ts`, never PATH), surveys WinGet/native/npm locations, records native PE vs npm shim and each version |
| `p-log-fsync` | the same arms (default `A,D,G,H1,H3`, N=20k) plus a raw `fs.fsyncSync`/`fdatasyncSync` bench; FlushFileBuffers semantics, `fullfsync` is a no-op off Apple |
| `p11-ws-framing` | judged on the child's private bytes (PowerShell sampler, ~10 ms) |
| `p14b-web-handoff`, `p14b-link-fdpass` | P14b-w (`_shared/win32-handoff.mjs`): node spawned directly, confined by `process.confine {pid}` from the same process, then handed sockets |
| `p10w-wfp` | read-only: can the non-elevated user add a WFP filter (`wfp-access.ps1`)? Adds nothing |

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
  That run records `verdict: partial` with `evidence.blocked: "prerequisites"`,
  which means pending, not a measured partial result. Don't commit it.
  Ctrl-C or a harness timeout runs the cleanups (`_shared/abort.mjs`): SE keys,
  keychain items, capture processes and temp build dirs. The P01 managed
  policy is the exception, because removing it needs sudo; the probe prints
  the exact `sudo rm` line instead.
  The helper is `_shared/helper/ProbeHelper.swift`, built into
  `GnomonHelperProbe.app` (bundle id `gnomon.probe` — never `gnomon.helper`, so it
  cannot pass the kernel's helper pin — App ID entitlement `SW4BMQ8PNL.gnomon.helper`
  from the one profile, access group `SW4BMQ8PNL.gnomon.probe`; it refuses production
  tags and services, Aegis H1) in a temp dir.
  The build steps:
  1. `xcrun swiftc -O _shared/helper/ProbeHelper.swift -o <app>/Contents/MacOS/gnomon-probe-helper`
  2. Write `Info.plist`, then copy the profile to `Contents/embedded.provisionprofile`.
  3. `codesign --force --options runtime --timestamp --entitlements helper.entitlements --sign "Developer ID Application: Matthew Canoy (SW4BMQ8PNL)" <app>`
  4. `codesign --verify --strict --deep -vv <app>`

  P00 has one option: `P00_SUBMIT=1` also notarizes and staples the stub.
- **P07** needs Full Disk Access for the terminal (for eslogger and the Safari
  history files) and root for `eslogger`. A positive control puts the token on
  `open`'s argv, which proves the capture can see it.
- **P01 manual** uses the `claude` path recorded in `results/p01-claude-cli.<os>.json`,
  never `PATH`. Keep `ANTHROPIC_API_KEY` unset.
- **P01b** (`p01b-permission-channel`, P8-D96) runs real `claude` under the
  generated session profile with `--permission-prompts host --permission-prompt-tool stdio`:
  about 15 short haiku turns on the subscription, around 3 minutes. Run it with
  `node packages/gnomon/probes/run.mjs p01b-permission-channel --timeout 900000`
  after `npm run build`. It needs no TTY.
- **P-resume** (`p-resume`, T-2026-10-19-014, before drain-and-resume slice B2) runs real `claude`
  with the adapter argv: a new session killed mid-Bash-call, a `--resume` with regenerated `--settings`
  and `--plugin-dir`, and a `--resume` under the profile exactly as generated. Three short haiku turns.
  Runs A and B append a probe-local `(allow file-write* (subpath "~/.claude/projects"))` after the
  generated profile, because the profile denies writes to `~/.claude` and no transcript is written
  without it. Run it yourself: `node packages/gnomon/probes/run.mjs p-resume --timeout 600000` after
  `npm run build`.
- **P-replay-order** (`p-replay-order`, T-2026-10-21-008, re-review M-1/M-4, darwin) runs the newest
  pinned `claude` (`~/.gnomon/bin/claude-<sha>`, else `~/.local/share/claude/versions/<newest>`) with the
  adapter's stream flags, haiku, about 10 one-word turns, no sandbox profile, env HOME/USER/LOGNAME/PATH
  only. It records when a queued message's replay line is written relative to message_start and result,
  and whether a blocking Stop hook emits `hook_response` lines. Finding (2.1.305): on consumption, never
  on receipt; `hook_response` only with `--include-hook-events`. No TTY needed:
  `node packages/gnomon/probes/run.mjs p-replay-order --timeout 900000`.
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
The probe fails if the two drift. The check compares content with line endings
normalized (CRLF to LF): on a Windows checkout git hands both files over with
CRLF, which is not drift. Run 39091956873 (windows-latest) recorded `fail` on
this check alone while Node, Chrome, Edge and Firefox all passed every gating
check; that was a harness bug, not an engine finding, so no engine falls back
to the bundled pure-JS verifier on that evidence.
