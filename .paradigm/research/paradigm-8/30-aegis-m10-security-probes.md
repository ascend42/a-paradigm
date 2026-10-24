# 30 — Aegis: M1.0 security-critical probes (Gnomon spec v3.4) — 2026-10-17

Scope: §3.1, §3.4, §11.1–11.2, §14.7, §15, §16, §19.1 M1.0–M1.4, §A, and reviews 22/25/26. Read-only; nothing was run, so every result below is a prediction for the probe to confirm or overturn. Probes are in priority order: a failure higher on the list breaks a security claim that more of the spec depends on.

## Part 1 — Claims believed already false or unverifiable (fix the spec before code)

- **S29-K1 [critical] The macOS kernel-key custody "full" claim is false as designed (§3.1 "Forgery scope", §15.2, §16 custody row).**
  - The Keychain ACL trusts the *helper's* code signature. But any same-user process can run the helper and ask it for the key. The helper can't tell the kernel apart from an attacker, because the kernel is `node` running a script.
  - A session can do this too. §15.5's "deny `securityd` lookups for Gnomon's keystore items" can't be written in SBPL: `mach-lookup` filters per service, not per item. And denying `securityd` outright breaks Claude Code's OAuth Keychain item.
  - Fix, pick one:
    - (a) Ship the kernel as a Developer-ID-signed Node SEA. The helper becomes an XPC/launchd service that checks its peer with `xpc_connection_set_peer_code_signing_requirement` (or the Keychain ACL names the SEA directly).
    - (b) Mark macOS `kernelKeyCustody: partial`, the same as Windows, and restate §A.1(e) for both OS.
  - Separately: the helper must refuse to run when it is itself sandboxed (`sandbox_check(getpid(), NULL, 0)`), and the §15.5 securityd sentence must be removed.
- **S29-K2 [high] A presence prompt can be phished (§3.4 prompt text, §A.1 "cannot be forged without hardware presence").**
  - A same-user process that can drive the root or approvals key can show the kernel's exact wording and collect a real signature over its own content.
  - Windows: any same-user process can open a Hello/NGC key by name. macOS: same, unless the SE key sits in an access group only the helper's entitlement reaches.
  - Fix: §A.1 should say "presence proves a touch, not what was approved, against a same-user process that can reach the key". On macOS, close it with the S29-01 access group plus K1's caller check.
- **S29-K3 [high] "WFP filter on the job object" has nothing to key on (§11.2 rule 2b, §15.5 session, §16).**
  - WFP conditions match app ID, user/security-descriptor, AppContainer package SID, address and port. No job-object condition is known.
  - Adding filters needs BFE rights (Administrators or Network Configuration Operators), as review 22 H8 already noted.
  - The fix depends on S29-08.
- **S29-K4 [high] "NCrypt platform provider (TPM)" gives no Hello presence (§3.1, §16).**
  - The Platform Crypto Provider's UI policy is a password prompt, not Hello. Presence plus custom text means the Passport KSP (`MS_NGC_KEY_STORAGE_PROVIDER`) with `NCRYPT_USE_CONTEXT_PROPERTY`.
  - `KeyCredential.RequestSignAsync` takes no message, so KeyCredentialManager can't show kernel text.
  - NGC keys are TPM-backed only when a TPM exists; check `NCRYPT_IMPL_TYPE_PROPERTY`.
  - Fix the wording to "Passport KSP"; refuse when the key isn't hardware-backed.
- **S29-K5 [medium] "Approvals key … held in kernel memory keyed by connId" (§3.1) can't be literal.**
  - A Secure Enclave or NGC key never leaves hardware. What gets cached is an evaluated `LAContext` (macOS) or an authenticated NCrypt handle (Windows), and it lives in the **helper**.
  - So the helper is a long-lived per-connection state holder, and a helper crash drops every unlock and arm.
  - Fix the wording in §3.1, §15.2 and §14.7 ("a further unlock of this key").
- **S29-K6 [medium] The pipe PID check adds nothing against a same-user attacker (§15.1 row 7, §16).**
  - The pidfile is same-user writable.
  - Node's `net` doesn't expose `GetNamedPipeServerProcessId`.
  - `serverSig` is the real anchor. Fix: drop the PID check from claims, or state it as Python/helper-only.
- **S29-K7 [medium] The `#launch=` fragment may survive in browser History or session-restore files (§11.2 rule 2).**
  - The session profile allows broad reads, so a session could replay the token.
  - The theft rule then *revokes the legitimate GUI session*: a reliable denial of service plus a gate-class card on demand.
  - S29-05 decides this. Fix: deny session reads of browser profile directories, or make a second use of an already-consumed token only log, not revoke.
- **S29-K8 [medium, M4.1 but architectural] `NSWindow.sharingType = .none` is reportedly ignored by ScreenCaptureKit on macOS 15+ (unverified).**
  - Also, a WKWebView can't exclude a region of itself. The handle/challenge region must be a separate native panel owned by the wrapper.
  - Fix: M1.13 must not rule out native panels. Pull the capture-exclusion probe forward to M1.0 if the answer could change the wrapper's design.

## Part 2 — Probes

**S29-01 [P1] Secure Enclave root/approvals key: persistence, caller gating, cached unlock, prompt text.** OS: macOS. Runs on the founder's Mac today: yes, but it needs a Developer ID *provisioning profile*, not just the certificate.
- Claim: §3.1 root/approvals key, D38/D39, §15.2, G-ID-06/07.
- Experiment:
  - Build `gnomon-helper` as an `.app` bundle (a bare CLI can't carry the restricted `keychain-access-groups` entitlement).
  - Sign it with hardened runtime and an embedded Developer ID profile.
  - Create the key with `SecKeyCreateRandomKey` using `kSecAttrTokenIDSecureEnclave`, `kSecAttrIsPermanent`, `kSecUseDataProtectionKeychain`, `kSecAttrAccessGroup=<TEAM>.gnomon` and `SecAccessControl(.privateKeyUsage, .userPresence)`.
  - Check four things:
    - (a) A second, unsigned binary querying the same tag gets `errSecItemNotFound` or `errSecMissingEntitlement`.
    - (b) One `LAContext` run through `evaluateAccessControl(.useKeySign)` and then passed as `kSecUseAuthenticationContext` signs N times with no re-prompt, and `invalidate()` forces a prompt.
    - (c) A fresh `LAContext` always prompts.
    - (d) `localizedReason` shows a 300-character kernel string (record the truncation point and which app name is shown).
- PASS: all four hold.
- FAIL on (a), entitlement refused: fall back to CryptoKit `SecureEnclave.P256` with a wrapped `dataRepresentation` file (age-plugin-se pattern). This keeps presence, but any same-user process can use the blob, so phishing (K2) becomes a stated residual. §3.1's "never files" becomes "an SE-wrapped handle file, useless off this SE".
- FAIL on (b): the cached unlock becomes presence per decision.

**S29-02 [P1] Kernel-key Keychain ACL plus caller check (K1).** OS: macOS. Runs today: yes.
- Claim: §3.1 kernel key, §15.2, §16 custody row.
- Experiment:
  - Store an item whose ACL trusts only the helper.
  - Read it with `security find-generic-password -s gnomon-kernel-key -w`: expect a SecurityAgent prompt.
  - Run the helper from a plain shell with `helper read-kernel-key`: expect success, which **disproves the claim**.
  - Run it again under the session profile with `sandbox-exec -f session.sb helper …`.
  - Delete the item and replace it with an attacker item: expect `INTEGRITY_BROKEN` at the next daemon start, because the registry row is root-signed.
  - Then repeat with the K1(a) design (signed SEA kernel plus an XPC peer requirement).
- PASS: only the signed kernel obtains signatures, and the helper refuses when sandboxed.
- FAIL: `kernelKeyCustody: partial` on macOS.

**S29-03 [P1] Session profile endpoint-port deny.** OS: macOS. Runs today: yes.
- Claim: §11.2 rule 2b, §15.5 session, G-SBX-08. This deny is load-bearing because a session that reaches the port can raise a Reconnect prompt that looks identical to the real one.
- Experiment:
```
sandbox-exec -p '(version 1)(allow default)(deny network-outbound (remote ip "localhost:PORT"))' \
  curl -sv http://127.0.0.1:PORT/
```
  - The same command against PORT+1 should succeed.
  - Repeat from `node -e` (net.connect and WebSocket).
- Escape matrix. From inside the profile, try to make an **unsandboxed** same-user service connect for you:
  - `tmux -S /tmp/tmux-501/default send-keys`
  - `screen -x`
  - the VS Code/Cursor IPC sockets
  - the Docker socket
  - an `ssh -L` through `ssh-agent`
- PASS: the port is denied, and every escape route is denied or listed as a residual with a G-SBX case.
- FAIL on the port deny: the macOS attach race rests on presence alone; state it in §A.1.
- Escapes found: add `(deny network-outbound (remote unix-socket (subpath "/private/tmp/tmux-501")))`-style rules plus §A.2 text.

**S29-04 [P1] Process-info deny without breaking Claude.** OS: macOS. Runs today: yes.
- Claim: §11.2 rule 2b(b), §15.5 session.
- Experiment: add `(deny process-info*)(allow process-info* (target self))(deny sysctl-read (sysctl-name-prefix "kern.proc"))` (the prefix also covers `kern.procargs2`). Then run `ps -axww`, `pgrep -fl gnomon`, `lsof -p <kernelpid>`, and a Node `ps` call.
- Then run a real `claude -p` turn that uses the Bash tool, plus spawning and killing a child.
- PASS: no other process's pid or argv is visible, and Claude works.
- FAIL, Claude breaks: allow `(target children)` or same-sandbox, and narrow the claim to "no argv of other processes".

**S29-05 [P2] Private launch-token hand-off (LaunchServices).** OS: macOS. Runs today: yes (`eslogger` needs sudo).
- Claim: §11.2 rule 2, §16 hand-off row, M1.4 falsifier "a token on any argv".
- Experiment:
  - Start `sudo eslogger exec fork > ex.json` and `log stream --level debug`.
  - Have the helper read the token from stdin and call `NSWorkspace.open`.
  - Run each browser (Safari, Chrome, Firefox) cold, warm, and with a pending update.
  - grep the token in `ex.json` and the log.
  - After the page loads, grep the Chrome `History` and `Current Session` files, Safari `History.db`, and Firefox `places.sqlite` / `sessionstore` (K7).
- PASS: the token is found nowhere.
- FAIL, argv: drop the macOS browser token path and use presence, as on Windows.
- FAIL, history only: apply K7's fix.

**S29-06 [P2] Tauri: IPC off, one origin, stdin hand-off.** OS: both (macOS today: yes).
- Claim: §11.1 wrapper, §11.2 rules 3 and 10, G-GUI-12.
- Experiment:
  - Tauri v2 pinned, no `#[tauri::command]`, no capability that matches `http://127.0.0.1:*`, `withGlobalTauri:false`.
  - From the page console, try `window.__TAURI_INTERNALS__?.invoke('plugin:app|version')`, `plugin:event|listen`, `plugin:window|close`, and `webkit.messageHandlers.ipc.postMessage(...)`.
  - Check `location.origin === "http://127.0.0.1:<port>"` and `isSecureContext`.
  - Spawn the binary directly (not `open -a`) and read the token from stdin.
  - Navigation to another origin should be blocked by `on_navigation`.
- PASS: every invoke is denied, there is one origin, the token never shows on argv (`ps`), and a forged `serverSig` gives a blank window.
- FAIL, internals reachable: patch out the IPC init script, or use a custom-built WKWebView/WebView2 shell (no Electron).

**S29-07 [P2] Windows Hello presence and prompt text (K4).** OS: Windows. Runs today: not on the Mac itself. A Windows 11 ARM VM in Parallels with vTPM and a Hello PIN works for API behaviour, not for hardware claims.
- Claim: §3.4 S25-M1, G-WIN-03, `status.presencePromptText`.
- Experiment: `NCryptOpenStorageProvider(MS_NGC_KEY_STORAGE_PROVIDER)`, create a P-256 key, set `NCRYPT_USE_CONTEXT_PROPERTY` to the kernel text, then `NCryptSignHash`. Record:
  - whether the text appears;
  - whether `NCRYPT_PIN_CACHE_IS_GESTURE_REQUIRED_PROPERTY` forces a gesture on every signature;
  - the `IMPL_TYPE` hardware flag;
  - whether a second same-user process can open and use the key (expected: yes, which confirms K2);
  - whether a restricted-token process can.
- PASS: native text and per-signature presence. Otherwise use the helper-window form.

**S29-08 [P2] WFP endpoint-port deny (K3).** OS: Windows. Runs today: no.
- Claim: §11.2 rule 2b, §15.5, §16.
- Experiment:
  - Non-elevated `FwpmEngineOpen0` plus `FwpmFilterAdd0` at `FWPM_LAYER_ALE_AUTH_CONNECT_V4`, matching `ip_remote_port=PORT` AND `ALE_USER_ID` (an SD naming a per-session restricting SID): expect access denied without admin.
  - Then the same with an elevated install-time service.
  - Then an AppContainer with `internetClient` only, which blocks loopback by default.
- PASS: one of these blocks only session processes.
- FAIL on all: the Windows attach race rests on presence. Since every Windows browser launch is already a Reconnect prompt, §20 kill criterion (e) should apply to the Windows browser surface.

**S29-09 [P3] Pipe DACL, first instance, PID (K6).** OS: Windows. Runs today: no.
- Claim: §15.1 row 7, §16, G-WIN-01.
- Experiment:
  - Read back the DACL of a Node `net.createServer('\\\\.\\pipe\\x')` pipe; the default DACL is expected to grant Everyone read.
  - Have a squatter create the pipe first: the kernel's `FIRST_PIPE_INSTANCE` should fail closed.
  - Connect from a restricted-token process and from another user.
  - Confirm that a forged `serverSig` is refused.
- PASS: owner-only DACL via the helper, squatting detected, mutual auth holds.
- FAIL, Node can't adopt helper-created instances: the helper creates every instance and passes the handle across, or the kernel uses an N-API pipe.

**S29-10 [P3, de-risk now for M4.1] Voice custody and capture exclusion (K8).** OS: both. Runs today: macOS yes.
- Claim: §14.7 arms, §16 voice row.
- Experiment:
  - The daemon spawns a signed `gnomon-voice` under the `voice` profile: does TCC attribute the mic to it or to the responsible app?
  - A Tauri-owned `NSPanel` with `sharingType = .none`, captured with `screencapture` and a ScreenCaptureKit sample on macOS 15/26.
- PASS: the child is attributed and the panel is excluded.
- FAIL: `armCustody: client` (the reserved fallback), and the gate arm requires headphones-only delivery (no on-screen handle).

## Hand-off

None of these needs a code fix yet. Each one needs a spec decision when its probe comes back.
- **Arky** (spec text): K1, K2, K4, K5, K6.
- **Builder**: the M1.0 harness. Ordered by risk: S29-01/02 first (signing and provisioning profile), then 03/04, then 05/06; 07–09 need a Windows host.
- **Founder**: create a Developer ID provisioning profile for an App ID `<TEAM>.gnomon.helper` before S29-01. The certificate alone is not enough.
