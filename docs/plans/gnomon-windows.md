# Gnomon on Windows: the parity pass

Handoff for a Claude Code session on the founder's Windows machine. Read this first, then `docs/specs/gnomon.md` §16 (platform table), §11 (identity), §15 (sandbox) and §18/§18.1 (install and distribution).

- **Branch:** `feat/gnomon` (pull first).
- **Decisions:** TD-2026-10-22-278 (this pass), TD-2026-10-21-758 (zero-build distribution), TD-2026-10-22-310 (8.0 is Apple silicon only), TD-2026-10-22-220 (Node 24, macOS 15).
- **Plan pages:** `.paradigm/research/paradigm-8/gnomon-windows-plan.html` (the founder-facing plan, by Arky and Aegis).
- **Tasks:** `.paradigm/tasks/` is gitignored, so the Mac's task records (T-2026-10-22-005 to 013) don't travel. On Windows, create one task per milestone from the table below with `paradigm_task` (tag `windows`).

## Decided

1. **Approvals are hybrid.** Routine cards (tool permission, ask-user, plan) are approved by click, with no presence. Windows Hello (PIN is acceptable) is required for: root provisioning and rotation, config and grant signing, gate-class cards, `always` rules, installs, budget resume, cloud fallback, `api-token`, link pairing, voice enrolment and arms, and loops (`loop-trust`, `grant.loop-envelope` and loop resume; docs/specs/gnomon-loops.md §3.1). `status` reports presence per class and `rootKeyCustody`.
2. **Install** goes to `%LOCALAPPDATA%\Programs\Gnomon\<version>\`, not MSIX. Because a same-user process can modify that folder, verify Authenticode before every launch, and open `node.exe` without `FILE_SHARE_WRITE|DELETE`, verify the hash and signature on that handle, and hold it across `CreateProcess`. Verify the child's image after spawn.
3. **x64 first.** Windows on ARM is not a target.
4. **The Mac 8.0 bar is the template:** compiled release pins (M1 `b0edca77`), the wrapper trust root (M2 `6f6c7f7d`), packaging and the publish gate (M3 `daa7af22`), and first run through the wrapper's `--cli` with an env allow-list (M4 `adbd1e12`).

## Set up the Windows machine

- Windows 11 23H2 or later, x64, TPM 2.0, Windows Hello set up (PIN is fine), working as a standard user.
- Git for Windows, Node 24.x, Visual Studio 2022 Build Tools (C++ workload, Windows SDK), Rust via rustup with the `stable-x86_64-pc-windows-msvc` toolchain, `cargo install tauri-cli`, and Claude Code (native installer, signed in with the subscription).
- Clone, then `git checkout feat/gnomon`, `npm ci`, `npm run build:gnomon`, `npm run typecheck`.
- Code signing (needed from W7): an Azure subscription with Trusted Signing (Basic tier) and identity validation. Don't buy an EV certificate.

## Milestones

Each milestone ends with its acceptance tests passing on this machine and an Aegis review before commit (as on the Mac).

| # | Scope | Acceptance |
|---|---|---|
| W0 | Dev environment and CI: pinned MSVC Rust toolchain shared by the wrapper and helper; real `cargo test` legs for both on `windows-latest`; remove the echo-only native leg (`.github/workflows/gnomon.yml` ~177) | CI green on Windows with real Rust tests |
| W1 | Probes on this machine: P03 (can Node adopt a pipe the helper created? decides pipe ownership), P10w (WFP), P14b-w (socket hand-off), P01 (`claude.exe` location), the log-fsync Windows arm, P11 (private bytes). Write `packages/gnomon/probes/results/*.win32.json` | results committed; decisions they settle recorded |
| W2 | Rust helper core (`packages/gnomon-helper/win32`, P8-D71): named pipe with an owner-only DACL and `FIRST_PIPE_INSTANCE`, job objects (`KILL_ON_JOB_CLOSE`), ACL apply and read-back, `MoveFileExW(MOVEFILE_WRITE_THROUGH)`, boot id, `ShellExecute`, restricted-token spawn. Same wire as the darwin helper. The README there is stale (still names KeyCredentialManager) | G-WIN-01, G-WIN-02, G-RUN-03, G-LOG-06 |
| W3 | Kernel Windows backends: the pipe endpoint (`endpoint.ts` ~114), process control (`process-control.ts` ~179-189), Authenticode verification through the helper (`helper-verifier.ts` ~11, 52), the claude verifier, anchor durability (`anchor.ts` ~151-164), the home DACL, and a Windows env allow-list (`env.ts` is POSIX-only: add `SYSTEMROOT`, a Windows PATH, and clear `WEBVIEW2_*`, `NODE_OPTIONS`, `__COMPAT_LAYER`) | kernel suite on Windows; a falsifier: with `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS` set in HKCU, no devtools port opens |
| W6 | Wrapper (Tauri/WebView2): Windows layout (`gnomon-wrapper.exe`, `node\node.exe`, `kernel\`, `helper\`); `build.rs` pins node.exe and the kernel tree; `codesign.rs` ~72 becomes WinVerifyTrust; node.exe pinned to OpenJS's own Authenticode signature; our binaries pinned by issuer and subject (Trusted Signing leaf certs rotate); Evergreen WebView2 checked at launch; DLL-planting checks beside node.exe | a swap between check and spawn fails; a planted `version.dll` doesn't load |
| | **Buildable:** W0–W3 and W6 | |
| W4 | Identity tier: a software root (DPAPI-wrapped) for click classes, plus Windows Hello (NCrypt/Passport KSP via the helper, probe P02) for the hybrid list; a permanent "presence: off for routine cards" banner; the kernel accepts decisions only from the verified wrapper GUI client (the GUI token bound to the pipe client); the browser surface refused; voice approvals refused | a non-GUI approve is refused; Hello classes prompt on biometric and PIN-only machines |
| W5 | Sandbox profiles: sessions at Low integrity (UIPI blocks SendInput into the wrapper), restricted token, job UI limits, ACLs, WFP per P10w; AppContainer/LPAC for transport, link and mod; report `partial` honestly where Windows can't match | G-SBX-08, G-WIN-06; a session's SendInput to the wrapper fails |
| W7 | `release-win32.mjs`: win-x64 Node in `bump-bundled-node.mjs` (same gpg provenance), sign everything with Trusted Signing, zip plus sha256, a `win32-x64` entry in the `seal-npm-release` appZips pin | `signtool verify /pa /all` on every binary |
| W8 | `@a-company/gnomon-win32-x64` (os win32, cpu x64) plus lockstep rules; the paradigm shim's Windows branch (`gnomon.js` ~24, `gnomon-app.js`); unzip with `%SystemRoot%\System32\tar.exe` by absolute path; install side by side per version; re-verify before every launch; a Windows publish gate | shim tests on Windows; a tampered zip is refused |
| W9 | Clean-machine test in Windows Sandbox: Node, Git, Claude Code, `npm i -g @a-company/paradigm`, `gnomon`, setup, then the desk; an upgrade over a running instance; uninstall (G-LAW-04) | **Shippable** |
| W10 | Voice: a Rust voice-io on WASAPI (communications category for echo cancellation) speaking `audio-io.ts`'s wire; sherpa-onnx-node win-x64 on CPU (DirectML later); `WDA_EXCLUDEFROMCAPTURE` | the voice probe and dictation tests |
| W11 | Optional hardening from Aegis: a broker service (one UAC prompt) so key custody isn't same-user readable; a SEA or per-launch kernel attestation (node's signature identifies node, not the kernel script; this applies to the Mac too) | Aegis's falsifiers |

## Known gaps to keep honest

- Without a broker (W11), keys are same-user readable: report `partial` custody.
- `%LOCALAPPDATA%` has no equivalent of macOS App Management: rely on handle-held verification.
- Unpackaged apps get no per-app microphone consent.
- The Mac helper also has no caller check yet (T-2026-10-22-004). Fix them consistently.

## Windows test traps (from earlier CI misses)

Put these in every builder brief:
- Tests that write keys into `<home>/keys` fail the POSIX `#identity dir-mode` check. Until W3 gives Windows a real check, mark such files `// @gnomon-platform: darwin, linux` with a platform-registry row (G-WIN-05).
- No `:` or other forbidden characters in path components or fixture names.
- Pin fixture and generated files to LF in `.gitattributes`, or hash and fixed-point checks fail.
- Never substring-match a raw path inside `JSON.stringify` output: backslashes come out doubled. Compare against `JSON.stringify(p).slice(1,-1)`, or parse first.
- Crash and respawn loops run several times slower on Windows: size timeouts for that.
- Build fixtures with `path.join(os.tmpdir(), …)`, never POSIX literals like `/r/f.ts`.
- Use `realpathSync.native`, which handles 8.3 short names like `RUNNER~1`.
- GUI bundle pin: re-run `npm run embed --workspace=@a-company/gnomon-gui` in the main checkout (not a worktree) and update the hash in `packages/gnomon/test/web-units.test.ts`. Contracts changes also make the GUI bundle stale.

## How to work

The same loop as the Mac 8.0 pass: a builder implements each milestone, Aegis reviews anything security-relevant, Mika reviews any UI change rendered, then commit with the symbol trailer. Record lore as you go. Read the Windows CI traps memory note if one exists. Don't publish anything: the founder publishes.
