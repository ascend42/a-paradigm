# 29 — Arky: Gnomon Move 1 kickoff (scaffold, probes, Windows CI, first PRs) — 2026-10-17

Read-only review. Sources: `docs/specs/gnomon.md` v3.4 (§1–§5, §13, §15.5, §16, §18, §19.1, §22), `package.json`, `packages/warpline/{package.json,tsup.config.ts,vitest.config.ts,src/daemon/*}`, `.github/workflows/{ci,release}.yml`, `.github/actions/install-deps/action.yml`, `portal.yaml`, `packages/conductor/Package.swift`. Paradigm MCP tools weren't available in this context, so ripple, wisdom and fragility were not run. All the packages are new; the only existing code they touch is CI and the root scripts.

## 1. Package scaffold

The `packages/*` workspace glob already picks up new packages, and folders with no `package.json` are skipped (Conductor is the precedent). Keep every Gnomon package **out of the root `build` and `test` scripts** until the 8.0 cut, so 7.x releases can't break (`G-MIG-01`). Add `build:gnomon` and `test:gnomon` scripts instead. Mark every package `"private": true` until 8.0, because `release.yml` runs `changeset publish` on main.

| Dir | Name | Runtime | Build/test | Needed |
|---|---|---|---|---|
| `packages/gnomon-contracts/` | `@a-company/gnomon-contracts` 1.0.0 | TS, zero deps, plus JSON Schemas in `schemas/` | tsup esm+dts, vitest | **NOW** (M1.1) |
| `packages/gnomon/` | `@a-company/gnomon` 8.0.0, bins `gnomon`, `gnomond`, `gnomon-web` | TS on Node 24 (`engines >=24`) | tsup, vitest | **NOW** (kernel + probes) |
| `packages/gnomon-helper/` | `@a-company/gnomon-helper` 1.0.0 (npm shell holding prebuilt `bin/` + `checksums.json`) | `darwin/`: SwiftPM, swift-tools 5.9, macOS 14 (same as Conductor). `win32/`: blocked on OPEN 3 | `swift build -c release`, `codesign`; Windows TBD | **NOW** (probes P04, P05, P07) |
| `packages/gnomon-wrapper/` | `@a-company/gnomon-wrapper` 8.0.0 | Rust + Tauri 2, pinned exact; `rust-toolchain.toml` | `cargo build`, `cargo test` | **NOW, probe skeleton only** (P08 sets the real version pin) |
| `packages/gnomon-gui/` | `@a-company/gnomon-gui` | React SPA, Vite | vitest + Playwright | M1.10 |
| `packages/gnomon-local/` | `@a-company/gnomon-local` | TS; pi-ai and pi-agent-core pinned exact | tsup, vitest | M1.8 |
| `packages/gnomon-mod-sdk/`, `packages/gnomon-mods/` (workshop only) | | TS | tsup, vitest | M1.11 |
| `packages/gnomon-voice/` | | | | **Move 4, don't create** |

**Kernel rules**
- `packages/gnomon/package.json` has **no `dependencies` key at all**. `gnomon-contracts` is a **devDependency**, and tsup bundles devDependencies, so the kernel ships with zero runtime deps.
- `packages/gnomon/tsconfig.json` extends the base config but sets `lib: ["ES2023"]` and `types: ["node"]`, which removes the base config's DOM lib.
- Layout is `src/{kernel/<13 dirs per §18>,transport,adapters,platform/{darwin,win32,linux},clients,cli}`. That is §18 with `src/` added, to match the repo; it's a small departure from the spec and should be noted there.
- `test/fence.test.ts` checks `G-KRN-02`: every import under `src/kernel/**` is either `node:*`, a relative path, or `@a-company/gnomon-contracts`. It also scans `dist/` for bare requires.
- `test/sec-01.test.ts` checks `G-SEC-01`: no `dependencies` key in the kernel's `package.json`.
- `test/platform-registry.test.ts` is the skeleton for `G-WIN-05`: every test marked platform-specific needs a sibling test or an `n/a` row with a reason.

**Lifting from Warpline.** Copy, never import. `src/daemon/lifecycle.ts:1-72` (O_EXCL pidfile, `pidAlive`, `SUN_PATH_SAFE`) and the NDJSON framing in `protocol.ts` go into `src/kernel/socket/`. Both of those files import `warplineDirOf` from Warpline's fabric module, so that import must be cut. Also drop the `os.tmpdir()` fallback (`lifecycle.ts:44-50`), as §2.4 requires.

**`.purpose` files**
- One in each new package: `#gnomon-kernel` with `#gnomon-probes`, `#gnomon-contracts`, `#gnomon-helper`, `#gnomon-wrapper`.
- Replace the stub `.github/workflows/.purpose`, adding `#gnomon-ci`.

**portal.yaml.** Nothing for the scaffold or the probes. At M1.4, add `/`, `/assets/*`, `GET /rpc` (upgrade), `/blob/<sha>` and `/diag`, with single-purpose gates: `^gnomon-loopback` (bind + Host allowlist + origin lock + `Sec-Fetch-Site`), `^gnomon-gui-token` (launch→GUI token), `^gnomon-device-key` (socket mutual auth), `^gnomon-presence` and `^law-7`. Aegis designs these then.

## 2. M1.0 probes

**Common shape for every probe**
- Code goes in `packages/gnomon/probes/<id>/probe.mjs`: zero deps, runs with no build. Native code goes beside it or under `gnomon-helper/probes/`.
- `node packages/gnomon/probes/run.mjs <id>` writes `packages/gnomon/probes/results/<id>.<darwin|win32>.json`.
- Result shape is `probeResult:v1 {probe, os, osVersion, arch, toolVersions, verdict: pass|fail|partial, evidence, specRefs, at}`.
- A `fail` on a ruling ⇒ re-plan memo before any build that depends on it (§19.1 falsifier).

The probes are ordered by how likely they are to force a spec change.

| # | Probe | What it proves / what it unblocks | OS | Runs on this Mac? | Needs | Pass criterion |
|---|---|---|---|---|---|---|
| P00 | `sign-notary` | OPEN 1: signing + notary profile | mac | yes | Developer ID; App Store Connect API key or app-specific password | `codesign --verify --strict` passes on a signed Swift stub; `xcrun notarytool history --keychain-profile gnomon-notary` returns |
| P04 | `se-helper` | §3.1 root/approvals keys, `G-ID-07` | mac | yes | Touch ID, Secure Enclave | Signed helper creates an SE P-256 key gated on `.userPresence` and signs only after Touch ID; unsigned helper fails. **Key question:** a keychain-stored SE key needs `keychain-access-groups`, a restricted entitlement that needs an embedded provisioning profile (so an `.app`-bundled helper). The CryptoKit `dataRepresentation` blob avoids that but is a file, and `G-ID-07`'s wording may need to change. Record both paths. |
| P05 | `keychain-acl` | §16 kernel-key custody `full` | mac | yes | signed helper | Kernel-key item readable by the helper, and denied (or prompting) for `security find-generic-password` and an unsigned clone |
| P02 | `win-key-type` | §16 `G-WIN-03` probe form, S25-M1: KeyCredentialManager vs NCrypt, and whether kernel-written text can show in the prompt | win | **no** | Win11 with TPM 2.0 + Hello. A GH runner has neither. | One API gives non-exportable P-256 with presence on every sign. If prompt text can't be set, the helper-window form passes `partial`. |
| P10m | `sbx-deny-mac` | §15.5 session profile, `G-SBX-08` | mac | yes | none | Under `sandbox-exec`, `connect(127.0.0.1:<port>)` → EPERM, `ps`/`sysctl kern.proc` of another pid → denied, a write to a linked folder → denied, and an allowed write succeeds |
| P10w | `sbx-wfp-win` | §16 WFP port filter on a job object | win | **no** (CI covers only the mechanics) | **a standard-user account**. WFP filter creation normally needs admin, and GH runners are admin. | Filter blocks loopback:port for the job, applied by the helper **without elevation**. If elevation is needed, the spec needs a service or the row is `partial` (spec change). |
| P01 | `claude-cli` | OPEN 8: hook stdin `session_id` on 2.1.288+, `--setting-sources` semantics, stream-json `control_request` interrupt, `G-SUB-01` loopback override | both | yes; Windows on hardware | `claude` logged in (subscription) | All fields observed and recorded with the CLI version |
| P08 | `tauri-origin` | OPEN 10, `G-GUI-12` precursor | both | yes | Rust toolchain; WebView2 is on the runner | Pinned Tauri loads `http://127.0.0.1:<port>` as its only origin; `invoke` from the page is rejected with the IPC-off capability set; a navigation elsewhere is blocked |
| P07 | `launch-token` | §16 hand-off, `G-WEB-05` | both | mac yes | signed helper | mac: token reaches the browser through a LaunchServices `GetURL` Apple Event and never shows in `ps -axww` sampled every 10 ms. win: a private WebView2/Edge channel exists, otherwise record `fail`, which confirms the presence path. |
| P03 | `pipe-dacl` | §2.4, `G-WIN-01` precursor | win | no; CI yes | none | Second `FIRST_PIPE_INSTANCE` create fails, another-SID connect is denied, `GetNamedPipeServerProcessId` matches the pidfile |
| P11 | `ws-framing` | §2.1 transport child | both | yes; CI yes | none | RFC 6455 over `node:http` upgrade passes Autobahn-style frame cases; 4 MiB frames ≥ 100 MB/s; transport-child RSS < 60 MB |
| P09 | `ed25519-matrix` | OPEN 8, WebCrypto `serverSig` | both | yes; CI via Playwright | real Safari is a manual check | `crypto.subtle.verify('Ed25519')` works in WebKit, Safari, Chromium, Edge, Firefox, WKWebView and WebView2 |
| P06 | `local-caps` | §13.2 `model.capabilities` | both | yes (llama.cpp/Ollama on Metal) | Windows GPU box for meaningful numbers; CI CPU with a tiny GGUF for a smoke run | Tool-call detection + `n_ctx` from `/slots` recorded for each endpoint |
| P12 | `excalidraw-csp` | OPEN 12 | both | yes; CI yes | none | Self-hosted bundle loads under the §11.2 CSP with no `unsafe-eval`; bundle size and parse time recorded |

The optional Mod-socket spike (`T-SHU-01`) is deferred.

Coverage of the §19.1 M1.0 list: P00 and P04 together cover "macOS Secure Enclave helper signing", and P05 covers "Keychain ACL by code signature".

## 3. Windows CI from day one

**Install-deps fix (do this first).** Its rollup workaround hardcodes `@rollup/rollup-linux-x64-gnu`. A lockfile resolved on macOS will crash tsup on Windows in the same way. Change the action to install `@rollup/rollup-<platform>-<arch>[-gnu|-msvc]`, derived from `process.platform` and `process.arch`.

**New workflow `.github/workflows/gnomon.yml`**
- Trigger on push/PR with `paths: packages/gnomon*/**, .github/**`.
- Job `test`: matrix `os: [macos-14, windows-latest, ubuntu-latest]`, `node: [24]`, `fail-fast: false`. It runs `npm run build:gnomon` and `npm run test:gnomon`, which covers contracts, the kernel's platform-independent tests and the fence/SEC tests.
- Job `probes-ci`: matrix `[macos-14, windows-latest]`. Runs P03 (Windows), P08, P09, P11, P12 and P06 smoke, and uploads `probes/results/*.json` as artifacts. Real results are committed from hardware runs only.
- Job `native`:
  - macos-14: `swift build` the helper, unsigned. Signing secrets stay out of CI.
  - windows-latest: `cargo build` the wrapper.
- Make it a required check once green. Leave `ci.yml` unchanged.

## 4. First PRs after scaffold (PR-0)

PR-0 itself covers: the package skeletons, `.purpose` files, `gnomon.yml`, the install-deps fix, `run.mjs`, the result schema, and the fence/SEC/registry tests. Oracles: `G-SEC-01`, and `G-KRN-02` and `G-WIN-05` in their skeleton form.

1. **PR-1, macOS probes:** P00, P04, P05, P10m, P01-mac, P07-mac. Results are committed. A `fail` produces `30-arky-m10-replan.md`. Oracle: `G-WIN-03` (probe form, mac half).
2. **PR-2, CI probes on both OS:** P03, P08 (sets the Tauri pin in `packages/gnomon-wrapper/Cargo.toml`), P09, P11, P12, P06 smoke.
3. **PR-3, contracts core:** `event:v1`, hsid/aliases, `ref:v1`, `refusal:v1`, the `gnomon-rpc:v1` `hello` shape, and reservation of the P8-D58 values. No probe can change these. Oracles: `G-CON-01`, `G-CON-02` (partial).
4. **PR-4, `#kernel-log`:** chain + segments behind a `Signer` seam. The software kernel key comes first, hardware signers are plugged in after P04 and P02. Oracles: `G-LOG-01..04` on both OS.
5. **PR-5, `$daemon-lifecycle` core:** the lifted pidfile lock, unix socket at 0600 with no tmpdir fallback, clean re-exec env, idle exit without mods. Oracles: `G-DMN-01`, `G-DMN-02`. The named pipe waits for P03.

P02 and P10w (the Windows hardware probes) run as soon as a machine exists. Their results go in before M1.3 (identity) and M1.7 (session sandbox).

## 5. Founder decisions (minimal)

1. **Windows hardware:** a Win11 x64 machine with TPM 2.0 + Hello (+ a GPU for P06) and a standard-user account. A Parallels Win11-ARM VM with vTPM and a PIN can do P02 but not P10w on GPU/perf. CI cannot do P02 or P10w.
2. **Notarization:** create the `gnomon-notary` profile, or rule it deferred to 8.1. npm-installed binaries carry no quarantine flag, so founder-only 8.0 may need signing only.
3. **Windows code signing:** Azure Trusted Signing vs an OV cert. This blocks `G-HLP-01` on Windows.
4. **OPEN 3, Windows helper language:** I propose **Rust (`windows` crate)** as a third option to N-API or .NET. Tauri already brings a pinned Rust toolchain, and `windows-rs` covers NCrypt, KeyCredentialManager (WinRT), WFP, job objects and pipes. That would be one fewer toolchain.
5. **Accept split engines:** Gnomon requires Node ≥24 while the repo stays at ≥20.

## Risks
- **P04 and P10w are the likeliest to force spec edits:** P04 through SE key storage vs `G-ID-07`'s wording, P10w through WFP needing admin.
- **macOS deprecation:** `sandbox-exec` is still deprecated (OPEN 5). P10m should record the macOS version.
- **Hoisting:** hoisted `node_modules` can hide accidental kernel imports. The fence test, not workspace layout, is the guard.
