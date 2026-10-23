/**
 * G-WIN-05 registry (spec §16 rule; research 29 §1). Every test file marked
 * platform-specific needs a row here naming either a sibling test file that
 * covers the other platform(s), or `na` with a reason.
 *
 * Marking: a test file is platform-specific when it carries the comment
 *   // @gnomon-platform: darwin            (or win32, linux; comma-separated)
 * Any test file that branches on `process.platform` must carry the marker
 * (test/platform-registry.test.ts enforces both directions).
 *
 * The marker is ENFORCED, not just documentation (T-2026-10-17-011):
 * vitest.config.ts excludes every test file whose marker does not list the
 * running `process.platform` (excludedTestFiles below). This registry stays
 * the record of WHY each exclusion exists; the registry test proves, for
 * every platform, that the excluded set equals the rows that do not list it.
 *
 * Zero imports beyond node builtins: vitest.config.ts loads this module.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

export type Platform = 'darwin' | 'win32' | 'linux';

export interface PlatformRow {
  /** Test file, relative to packages/gnomon (posix separators). */
  test: string;
  platforms: Platform[];
  /** Sibling test file covering the remaining platform(s). */
  sibling?: string;
  /** Why no sibling exists. Required when `sibling` is absent. */
  na?: string;
}

export const PLATFORMS: Platform[] = ['darwin', 'win32', 'linux'];

/** The marker line: `// @gnomon-platform: <p>[, <p>…]` at the start of any line. */
export const PLATFORM_MARKER = /^\s*\/\/\s*@gnomon-platform:\s*([a-z0-9, ]+)$/m;

/** The platforms a test source is marked for, or null when unmarked (= every platform). */
export function parsePlatformMarker(source: string): string[] | null {
  const m = PLATFORM_MARKER.exec(source);
  return m ? m[1]!.split(',').map((s) => s.trim()).filter(Boolean) : null;
}

/**
 * Test files (posix paths relative to `pkgRoot`, e.g. `test/x.test.ts`) that
 * are marked platform-specific and do NOT list `platform` — vitest.config.ts
 * excludes exactly these on that platform.
 */
export function excludedTestFiles(pkgRoot: string, platform: string): string[] {
  const out: string[] = [];
  const visit = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const full = path.join(dir, name);
      if (statSync(full).isDirectory()) visit(full);
      else if (name.endsWith('.test.ts')) {
        const marked = parsePlatformMarker(readFileSync(full, 'utf8'));
        if (marked && !marked.includes(platform)) out.push(path.relative(pkgRoot, full).split(path.sep).join('/'));
      }
    }
  };
  visit(path.join(pkgRoot, 'test'));
  return out.sort();
}

export const PLATFORM_REGISTRY: PlatformRow[] = [
  // spec §2.4 rule 10 auto-open: the real osascript smoke and the GUI setup endpoint on a terminal.
  { test: 'test/open-browser-darwin.test.ts', platforms: ['darwin'], sibling: 'test/open-browser.test.ts', na: 'auto-open is macOS only (osascript + LaunchServices); elsewhere the URL is printed as before, which the platform-free sibling covers with an injected platform and spawner' },
  // TD-2026-10-19-063 self-update: the 0600 hand-off files and the helper re-pin fixture (POSIX modes); the pure half is self-update.test.ts.
  { test: 'test/self-update-e2e.test.ts', platforms: ['darwin'], sibling: 'test/self-update.test.ts', na: 'the GUI leg needs gui.open, which mints a web launch only under the darwin transport profile (linux has none in §15.5 and refuses sandbox-unavailable, as test/wrapper-channel.test.ts); Windows parity phase (P8-D78): a real daemon on the unix-socket endpoint (named pipe waits for probe P03)' },
  { test: 'test/self-update-posix.test.ts', platforms: ['darwin', 'linux'], sibling: 'test/self-update.test.ts', na: 'POSIX file modes (0600 hand-off, executable helper fixture); Windows ACL custody is the Windows parity phase (P8-D78)' },
  // #prefix-policy win-alias (gate-class 8.3 / ADS words count on win32 only).
  { test: 'test/prefix-policy-alias-posix.test.ts', platforms: ['darwin', 'linux'], sibling: 'test/prefix-policy-alias-win32.test.ts' },
  { test: 'test/prefix-policy-alias-win32.test.ts', platforms: ['win32'], sibling: 'test/prefix-policy-alias-posix.test.ts' },
  // W2/W3 (docs/plans/gnomon-windows.md): the Windows platform helper against the real OS (pipe and home DACLs, job launcher, durable rename).
  { test: 'test/win32-approvals.test.ts', platforms: ['win32'], na: 'the W4 phase A approvals key lives in the Windows Software KSP via the win32 helper; the darwin Secure Enclave key is test/identity-hw.test.ts (founder hardware) and the broker logic for both is platform-independent in test/identity-hardware.test.ts' },
  { test: 'test/win32-helper.test.ts', platforms: ['win32'], na:'Windows-only mechanisms (DACL, job object, MoveFileExW); the POSIX equivalents are covered by test/socket-server.test.ts, test/daemon-lifecycle.test.ts and test/kernel-log-posix.test.ts' },
  { test: 'test/web-sandbox-win32.test.ts', platforms: ['win32'], sibling: 'test/web-sandbox.test.ts' },
  // PR-5 $daemon-lifecycle core + #socket, macOS-first (P8-D78).
  { test: 'test/daemon-lifecycle.test.ts', platforms: ['darwin', 'linux'], na: 'Windows parity phase (P8-D78): unix-socket endpoint only; the named pipe via the signed helper waits for probe P03' },
  { test: 'test/socket-server.test.ts', platforms: ['darwin', 'linux'], na: 'Windows parity phase (P8-D78): unix-socket endpoint only; the named pipe via the signed helper waits for probe P03' },
  // M1.9 #scheduler + $daemon-lifecycle in the real daemon: unix socket + POSIX process groups (orphan sweep).
  { test: 'test/scheduler-daemon.test.ts', platforms: ['darwin', 'linux'], sibling: 'test/scheduler.test.ts', na: 'the scheduler logic and the children/orphan-sweep logic run on every platform in test/scheduler.test.ts and test/daemon-children.test.ts; the daemon-level half needs the unix socket and process groups (the pipe and job object are the Windows parity phase, P8-D78)' },
  // T-2026-10-19-014 B0: the daemon-stop card; the daemon half runs the real unix-socket daemon.
  { test: 'test/daemon-stop.test.ts', platforms: ['darwin', 'linux'], na: 'Windows parity phase (P8-D78): unix-socket endpoint only; the named pipe via the signed helper waits for probe P03' },
  // T-2026-10-19-014 B0 (TD-2026-10-19-339): the daemon.stop human-device verb over the real unix-socket daemon.
  { test: 'test/daemon-stop-verb.test.ts', platforms: ['darwin', 'linux'], na: 'Windows parity phase (P8-D78): unix-socket endpoint only; the named pipe via the signed helper waits for probe P03' },
  { test: 'test/idle-exit.test.ts', platforms: ['darwin', 'linux'], na: 'Windows parity phase (P8-D78): unix-socket endpoint only; the named pipe via the signed helper waits for probe P03' },
  // M1.11 slice 2: #mod-host in the real daemon (unix socket + POSIX device-key modes).
  { test: 'test/mod-daemon.test.ts', platforms: ['darwin', 'linux'], sibling: 'test/mod-append-budget.test.ts', na: 'Windows parity phase (P8-D78): the daemon endpoint is a unix socket and device keys use POSIX modes; the pure clamp and budget half runs everywhere in the sibling' },
  // M1.12 slice 3 replay: the rig writes kernel keys into an owner-only keys/ dir (POSIX modes in #identity).
  { test: 'test/always-rules.test.ts', platforms: ['darwin', 'linux'], na: 'Windows parity phase (P8-D78): the rules CLI test records kernel pubs under an owner-only keys/ (a POSIX mode; an ACL via the helper on win32); the rule fold itself is platform-independent code' },
  { test: 'test/trace-cli.test.ts', platforms: ['darwin', 'linux'], na: 'Windows parity phase (P8-D78): the fixture writes a kernel log whose owner-only keys/ is an ACL via the helper there, not a POSIX mode (as m112-replay); the trace reader and trace mode are platform-independent code' },
  { test: 'test/m112-replay.test.ts', platforms: ['darwin', 'linux'], na: 'Windows parity phase (P8-D78): owner-only keys/ is an ACL via the helper there, not a POSIX mode; replay itself is platform-independent code' },
  // P8-D96 card composition: fixtures are POSIX paths (`/r/f.ts`), which path.resolve rewrites to drive paths on win32.
  { test: 'test/repo-context-imports.test.ts', platforms: ['darwin', 'linux'], sibling: 'test/repo-context.test.ts', na: 'P8-D97 (Aegis R2): the @ import resolver must be RE-REVIEWED before Windows parity (P8-D78): drive-letter (C:), extended-length (\\\\?\\) and UNC (\\\\server\\share) forms, ~ on win32 and case-folded containment; the platform-neutral audit (traversal, encoded @, depth, symlinks, subtree) runs everywhere in the sibling' },
  { test: 'test/permission-card.test.ts', platforms: ['darwin', 'linux'], na: 'Windows parity phase (P8-D78): the session runner and its permission channel are darwin-first; win32 path rendering and the case-folded deny path need win32 fixtures there' },
  // T-2026-10-18-030 (3): mkfifo + POSIX owner-only key modes.
  { test: 'test/voice-v2e-enrol.test.ts', platforms: ['darwin', 'linux'], na: 'writes 0600 root-signed enrolment rows with POSIX modes, like voice-enrolment.test.ts (P8-D78)' },
  { test: 'test/voice-v2e-e2e.test.ts', platforms: ['darwin'], sibling: 'test/voice-v2e-daemon.test.ts', na: 'the end-to-end voice turn needs a real session under the macOS session sandbox (fake claude) and the voice client runs on macOS only; the sibling covers the spawned, fd-authenticated child on darwin and linux' },
  { test: 'test/voice-v2e-client-pin.test.ts', platforms: ['darwin', 'linux'], sibling: 'test/voice-v2e.test.ts', na: 'copies the voice client into a 0700 dir with 0600 files and checks POSIX modes; the supervisor half of the refusal (phase unavailable, no spawn) runs on every OS in the sibling' },
  { test: 'test/voice-v2e-daemon.test.ts', platforms: ['darwin', 'linux'], na: 'boots a dev-home daemon over a unix socket and hands a child an inherited socketpair fd; the voice client itself runs on macOS only (voice-v2e.test.ts covers the supervisor, the adopted principal and request.voice.client on every OS)' },
  { test: 'test/voice-enrolment.test.ts', platforms: ['darwin', 'linux'], na: 'writes 0600 voice device keys with POSIX modes; on Windows key files are an ACL via the helper (P8-D78)' },
  { test: 'test/device-key-links.test.ts', platforms: ['darwin', 'linux'], na: 'the POSIX mode + nlink case of the strict device-key check; on win32 the key is owner-only by DACL read-back through the helper and nlink is checked there too (test/win32-helper.test.ts)' },
  { test: 'test/device-key-fifo.test.ts', platforms: ['darwin', 'linux'], na:'Windows has no FIFO in the filesystem namespace and no O_NONBLOCK flag (named pipes live under \\\\.\\pipe); device-key modes are an ACL via the helper there (P8-D78)' },
  // T-2026-10-18-028 M5: the helper exec/read denies enforced by sandbox-exec (the darwin session backend).
  // TD-2026-10-19-063: the claude publisher check is codesign on a private copy (the re-pin card logic runs everywhere in the sibling).
  { test: 'test/claude-verifier-darwin.test.ts', platforms: ['darwin'], sibling: 'test/claude-repin-card.test.ts', na: 'the publisher signature is Apple codesign (a Developer ID team); Windows Authenticode is the parity phase (P8-D78) and the Linux build carries no publisher signature, so their verifier is unavailable (a loud card), which the platform-free sibling covers with a fake verifier' },
  { test: 'test/session-helper-deny.test.ts', platforms: ['darwin'], na: 'the signed helper bundle and its SBPL denies are darwin-only; the Windows helper is a separate principal/service in the parity phase (P8-D78), and linux has no helper' },
  { test: 'test/decision-sig-v2.test.ts', platforms: ['darwin', 'linux'], na: 'Windows parity phase (P8-D78): its real-log fixtures write a home with POSIX owner-only key modes (keys/ 0700); the decisionSig layouts themselves are platform-free and the descriptor vector is checked in gnomon-contracts on every platform' },
  { test: 'test/socket-auth.test.ts', platforms: ['darwin', 'linux'], na: 'Windows parity phase (P8-D78): unix-socket endpoint and POSIX device-key modes only; the pipe (P03) and owner-only ACLs come there' },
  { test: 'test/socket-abi.test.ts', platforms: ['darwin', 'linux'], na: 'Windows parity phase (P8-D78): read tokens and the G-ABI/G-SOCK suites over the unix-socket endpoint with POSIX device-key and token-file modes; the pipe (P03) comes there' },
  { test: 'test/gui-session-e2e.test.ts', platforms: ['darwin'], na: 'the #gui session falsifier opens a fake-claude session, which runs only under the darwin session profile (linux/win32 refuse sandbox-unavailable, test/session-profile.test.ts); the GUI-credential projection itself is covered on every platform by test/socket-log-read.test.ts' },
  { test: 'test/dev-launch-session.test.ts', platforms: ['darwin'], na: 'the #dev-launch smoke opens a session, which runs only under the darwin session profile (linux/win32 refuse sandbox-unavailable, test/session-profile.test.ts); the fake claude is a POSIX sh wrapper' },
  { test: 'test/dev-launch.test.ts', platforms: ['darwin', 'linux'], na: 'Windows parity phase (P8-D78): #dev-launch writes owner-only POSIX key files and starts a daemon on the unix-socket endpoint; the pipe and owner-only DACLs come there' },
  // #gnomon-up: the real-home launcher — a provisioned home (owner-only keys/, a shebang helper to pin) and a daemon on the unix socket.
  { test: 'test/up-cli.test.ts', platforms: ['darwin', 'linux'], sibling: 'test/identity-hardware.test.ts', na: 'gnomon up provisions an owner-only keys/ dir (POSIX modes), pins a shebang executable and starts a daemon on the unix-socket endpoint; the key/presence/broker logic runs everywhere in the sibling; the pipe, owner-only DACLs and the Windows helper are the parity phase (P8-D78)' },
  // #bare-entry: bare `gnomon` = gnomon up + a folder hint — a provisioned home (owner-only keys/, a shebang helper) and a daemon on the unix socket.
  { test: 'test/bare-entry.test.ts', platforms: ['darwin', 'linux'], sibling: 'test/up-cli.test.ts', na: 'bare gnomon provisions an owner-only keys/ dir (POSIX modes), pins a shebang executable and starts a daemon on the unix-socket endpoint, like gnomon up; the launch-URL test is darwin-only (linux has no `transport` sandbox profile, so web-launch is refused, §15.5); the pipe, owner-only DACLs and the Windows helper are the parity phase (P8-D78)' },
  // #socket gui.open (T-2026-10-19-001 A3): bare gnomon into a running kernel — a provisioned home and a kernel on the unix socket.
  { test: 'test/gui-open.test.ts', platforms: ['darwin', 'linux'], sibling: 'test/human-device-verbs.test.ts', na: 'the handler and the shared cap are tested everywhere in the file; the running-kernel tests provision an owner-only keys/ dir (POSIX modes), pin a shebang executable, run the kernel on the unix-socket endpoint and are darwin-only inside the file (linux has no `transport` sandbox profile, so web-launch is refused, §15.5); the pipe, owner-only DACLs and the Windows helper are the parity phase (P8-D78)' },
  { test: 'test/install-darwin.test.ts', platforms: ['darwin', 'linux'], na: 'the #bare-entry installer links into /opt/homebrew/bin or /usr/local/bin with POSIX symlinks and directory write bits; Windows has neither path and needs a privilege for symlinks (its installer is the parity phase, P8-D78)' },
  // #gnomon-wrapper (M1.13 slice 1, macOS): the `--wrapper` launch channel — fd kinds (FIFO/file/tty), `ps` argv+env sampling, the unix-socket kernel.
  { test: 'test/wrapper-channel.test.ts', platforms: ['darwin', 'linux'], na: 'the three launch-grant tests are darwin-only (linux has no `transport` sandbox profile, so web-launch is refused, §15.5); Windows parity phase (P8-D78): the wrapper channel is checked by POSIX fstat fd kinds and sampled with POSIX `ps -E` / `ps e` (env of own-user processes); the kernel runs on the unix-socket endpoint. The Windows wrapper (WebView2) and its named-pipe channel are the parity phase (spec §16 GUI shell row)' },
  { test: 'test/wrapper-setup.test.ts', platforms: ['darwin', 'linux'], sibling: 'test/identity-hardware.test.ts', na: 'up --wrapper routed into the #setup-endpoint provisions through the #provisioner (owner-only keys/ dir, POSIX modes; a shebang helper pin) and runs the kernel on the unix-socket endpoint, like setup-endpoint.test.ts and wrapper-channel.test.ts; the launch-grant step is darwin-only inside the file (linux has no `transport` sandbox profile, §15.5); the Windows wrapper and helper are the parity phase (P8-D78)' },
  // #app-bundle / #release-darwin (T-2026-10-21-029, 8.0 M2): the relocatable Gnomon.app is macOS only in 8.0 (TD-2026-10-21-758).
  { test: 'test/app-upgrade-identity.test.ts', platforms: ['darwin', 'linux'], sibling: 'test/identity-hardware.test.ts', na: 'the 8.0 M4 app move/replace path is a macOS app bundle (TD-2026-10-21-758, macOS only in 8.0) and pins a POSIX-exec helper file; the identity logic it relies on runs on every platform in the sibling; Windows distribution is the parity phase (P8-D78)' },
  { test: 'test/app-bundle.test.ts', platforms: ['darwin', 'linux'], na: 'the release Gnomon.app bundle layout (Contents/Resources, Contents/Helpers) is a macOS app bundle and 8.0 ships macOS only (TD-2026-10-21-758); the lookups are POSIX-path logic that also runs on linux, and the transport-plan exec check is darwin-only inside the file (linux has no transport profile, §15.5); Windows distribution is the parity phase (P8-D78)' },
  { test: 'test/release-darwin.test.ts', platforms: ['darwin'], na: 'the release script assembles and signs a macOS .app with ditto, tar and codesign; 8.0 ships macOS only (TD-2026-10-21-758) and the Windows package is the parity phase (P8-D78)' },
  // #gnomon-npm-packaging (T-2026-10-21-030, 8.0 M3): the npm platform packages carry a ditto zip of the macOS app.
  { test: 'test/app-zip.test.ts', platforms: ['darwin', 'linux'], sibling: 'test/release-pins.test.ts', na: 'builds a release dist from shebang fake helper and voice-io executables (POSIX exec bits), as release-pins.test.ts does; 8.0 publishes darwin app zips only (TD-2026-10-21-758) and Windows is the parity phase (P8-D78)' },
  { test: 'test/gate-gnomon-publish.test.ts', platforms: ['darwin'], na: 'the publish gate unpacks the app zip with ditto and verifies it with codesign, stapler and spctl; 8.0 publishes darwin platform packages only (TD-2026-10-21-758), Windows and Linux packages are the parity phase (P8-D78)' },
  { test: 'test/pack-roundtrip.test.ts', platforms: ['darwin'], na: 'the round trip builds the zip with release-darwin, unpacks it with ditto and verifies it with codesign and spctl; 8.0 publishes darwin platform packages only (TD-2026-10-21-758), Windows and Linux packages are the parity phase (P8-D78)' },
  { test: 'test/gui-browser-darwin.test.ts', platforms: ['darwin'], na: 'headless Chrome smoke of the setup and launch pages (T-2026-10-19-006 item 6): Chrome is found at its macOS install path (skipped with a reason when absent), and the launch page needs the kernel GUI endpoint under the darwin `transport` sandbox profile (linux refuses web-launch, §15.5); the page logic itself is covered on every platform by packages/gnomon-gui tests; the Windows WebView2 shell is the parity phase (P8-D78)' },
  { test: 'test/up-launch-session.test.ts', platforms: ['darwin'], na: 'the #gnomon-up approve end to end opens a session, which runs only under the darwin session profile (linux/win32 refuse sandbox-unavailable, test/session-profile.test.ts), and the GUI endpoint under the darwin transport profile; the fake claude is a POSIX sh wrapper' },
  { test: 'test/m112-conformance.test.ts', platforms: ['darwin', 'linux'], na: 'Windows parity phase (P8-D78): the published TS client and the conformance runner against a live kernel over the unix-socket endpoint with POSIX device-key modes; the pipe (P03) comes there (the display vectors run everywhere in gnomon-contracts)' },
  { test: 'test/socket-log-read.test.ts', platforms: ['darwin', 'linux'], na: 'Windows parity phase (P8-D78): log.read / subscriptions / ref.resolve over the unix-socket endpoint with POSIX device-key modes; the pipe (P03) comes there' },
  // M1.4 #web-endpoint: the darwin `transport` sandbox profile + the daemon `gnomon open` path (unix socket).
  // M1.7 #session-runner / #supervisor: the darwin `session` profile (sandbox-exec) and the fake-claude session rig (POSIX sh wrapper, process groups).
  { test: 'test/session-profile.test.ts', platforms: ['darwin', 'linux'], na: 'SBPL paths are POSIX; the win32 session backend (restricted token + ACEs + WFP) is the Windows parity phase (P8-D78) — its registry refusal and status `partial` (G-WIN-06) are asserted here with the platform passed as data' },
  { test: 'test/repo-hooks.test.ts', platforms: ['darwin', 'linux'], na: 'P8-D94 extract: the symlinked-layer case needs symlink creation (privileged on win32); the win32 session backend is the Windows parity phase (P8-D78)' },
  { test: 'test/session-sandbox.test.ts', platforms: ['darwin'], sibling: 'test/session-sandbox-win32.test.ts', na: 'enforcement of the darwin `session` profile under sandbox-exec; the win32 sibling covers the restricted-token profile (W5); linux has no session mechanism yet (every class `none`, platform/session-denies.ts) and refuses (test/session-profile.test.ts)' },
  { test: 'test/session-sandbox-win32.test.ts', platforms: ['win32'], sibling: 'test/session-sandbox.test.ts' },
  // M1.8 #local-runner: the LocalLane spawn path with the real gnomon-local child (POSIX process groups via DaemonChildren).
  { test: 'test/local-lane-spawn.test.ts', platforms: ['darwin', 'linux'], sibling: 'test/local-runner.test.ts', na: 'routing, fallback, probe, driver replay and the meter run on every platform in test/local-runner.test.ts; the spawn half needs POSIX process groups (the job object is the Windows parity phase, P8-D78)' },
  // TD-2026-10-22-769 #local-config-request: the root card through the counting fake helper's decision.sign row table.
  { test: 'test/folders.test.ts', platforms: ['darwin', 'linux'], na: 'the folder verbs use POSIX permissions (a chmod 000 folder, an executable bit) and a unix-socket human device; the macOS chooser is not offered on Windows in 8.0 (status.folders.chooser false, refused no-chooser), and the GUI falls back to a typed path the kernel checks' },
  // T-2026-10-23-003 #mcp-servers: the human's own MCP servers in sessions.
  { test: 'test/mcp-servers.test.ts', platforms: ['darwin', 'linux'], na: 'the fixtures make POSIX executables (chmod 755) the session PATH resolves and check the store is 0600; on Windows discovery and rows work the same, a command resolves to .exe/.cmd (a .cmd is flagged a shell wrapper), and turning a server on is refused UNSUPPORTED (a root-class decision needs the root key, which lives in the Mac helper in 8.0), said in status.mcp.unsupported and on the Settings rows; the first-party Paradigm MCP still runs' },
  { test: 'test/mcp-servers-sandbox.test.ts', platforms: ['darwin'], na: 'it runs a stdio MCP server under the darwin session SBPL and measures the nested sandbox_apply refusal; the Windows session sandbox (Low integrity, session-sandbox-win32.test.ts) is inherited by the server the same way, and Linux has no session sandbox backend in 8.0' },
  { test: 'test/local-config-request.test.ts', platforms: ['darwin', 'linux'], sibling: 'test/dev-local.test.ts', na: 'the local.config row table pins POSIX absolute runner paths (the darwin helper is the only root signer in 8.0; a Windows click key refuses every root decision UNSUPPORTED, said on the card); the shared validator (loopback only, LAN lands in 8.1) and the dev-root copy refusal run on every platform in the sibling' },
  { test: 'test/local-config-daemon.test.ts', platforms: ['darwin', 'linux'], sibling: 'test/local-config.test.ts', na: 'the loader, high-water and pin logic run on every platform in the sibling; the two-boot chain-loop half needs the daemon unix-socket endpoint (the pipe is the Windows parity phase, P8-D78)' },
  { test: 'test/shell-readonly-cwd.test.ts', platforms: ['darwin', 'linux'], sibling: 'test/shell-readonly.test.ts', na: 'K1 anchoring is posix only (a win32 session keeps the unanchored rules): a real tmp git repo with POSIX symlinks and posix paths; the sibling runs the pure classifier table, brace/case/locals included, on every OS' },
  { test: 'test/auto-edits-anchor.test.ts', platforms: ['darwin', 'linux'], sibling: 'test/shell-readonly.test.ts', na: 'runs the anchored command under real /bin/zsh and /bin/bash; win32 is never anchored (its one case is asserted here and the sibling covers autoBashReadOnly on every OS)' },
  { test: 'test/shell-readonly-widen.test.ts', platforms: ['darwin', 'linux'], sibling: 'test/shell-readonly.test.ts', na: 'RW widening is anchored-only, and anchoring is posix only (a win32 session keeps the earlier rules): a real tmp git repo with a POSIX symlink and the anchor run under /bin/zsh and /bin/bash; the sibling asserts the unanchored refusals on every OS' },
  { test: 'test/shell-readonly-fs.test.ts', platforms: ['darwin', 'linux'], sibling: 'test/shell-readonly.test.ts', na: 'creates POSIX symlinks (out of the repo into a fake ~/.ssh) and runs shell commands over single-quoted posix tmp paths; the sibling runs the whole pure classifier table on every OS' },
  { test: 'test/voice-origin.test.ts', platforms: ['darwin'], na: 'G-VOX-17 opens a live session under the darwin session profile (linux/win32 refuse sandbox-unavailable); the fake claude is a POSIX sh wrapper. The pure halves in this file (the piece counter, G-VOX-18, G-VOX-19) run with it on darwin; G-VOX-20/20b/21 (test/voice-send-word.test.ts) run on every OS' },
  { test: 'test/run-modes-session.test.ts', platforms: ['darwin'], na: 'the P8-D87 run-mode falsifiers open live sessions, which run only under the darwin session profile (linux/win32 refuse sandbox-unavailable, test/session-profile.test.ts); the fake claude is a POSIX sh wrapper. The pure half (the control, the book, gate-class paths, autoEditPass) is test/run-modes.test.ts on every OS' },
  { test: 'test/git-verbs.test.ts', platforms: ['darwin', 'linux'], na: 'win32: the kernel-run git verbs (T-2026-10-23-002, #git-verbs) are darwin-first; git and gh are resolved from POSIX install folders and the fixtures shell out to POSIX git; the win32 resolution (git.exe / gh.exe, the Windows credential manager) is the parity phase (P8-D78)' },
  { test: 'test/git-verbs-sandbox.test.ts', platforms: ['darwin'], na: 'the git verbs under the REAL darwin session profile (sandbox-exec SBPL with the kernel-worktree regex denies); linux refuses sandbox-unavailable and the win32 session backend renders no regex deny yet (kernelWorktrees is darwin-only, supervisor.ts), so worktree carve-outs are the parity phase (P8-D78)' },
  { test: 'test/write-allow-sandbox.test.ts', platforms: ['darwin'], na: 'T-2026-10-23-004 deny-by-default writes are enforced by the darwin SBPL session profile (sandbox-exec); linux refuses sandbox-unavailable and the win32 session backend is a Low-integrity token whose write model is already allowlist-shaped (the parity phase, P8-D78)' },
  { test: 'test/kernel-mcp-session.test.ts', platforms: ['darwin'], na: 'the #kernel-mcp end to end opens a session, which runs only under the darwin session profile (linux/win32 refuse sandbox-unavailable, test/session-profile.test.ts); the fake claude is a POSIX sh wrapper; the JSON-RPC half is test/git-verbs.test.ts on darwin and linux' },
  { test: 'test/always-edit-scopes.test.ts', platforms: ['darwin'], na: 'the scoped edit rule falsifiers (TD-2026-10-23-939 follow-up) open live sessions, which run only under the darwin session profile (linux/win32 refuse sandbox-unavailable, test/session-profile.test.ts); the rule fold itself is covered everywhere by test/always-standing-rules.test.ts' },
  { test: 'test/permission-session.test.ts', platforms: ['darwin'], na: 'the P8-D96 permission-channel falsifiers open sessions, which run only under the darwin session profile (linux/win32 refuse sandbox-unavailable, test/session-profile.test.ts); the fake claude is a POSIX sh wrapper' },
  { test: 'test/session-resume.test.ts', platforms: ['darwin'], na: 'the §2.4 rule 11 resume falsifiers (T-2026-10-19-014 B2) drain and resume sessions, which run only under the darwin session profile (linux/win32 refuse sandbox-unavailable, test/session-profile.test.ts); the fake claude is a POSIX sh wrapper; the planner and sweep-exemption half is test/resume-plan.test.ts on every platform' },
  { test: 'test/session-model.test.ts', platforms: ['darwin'], na: 'the model picker and the mid-session switch (8.0:model-switch) open sessions, which run only under the darwin session profile (linux/win32 refuse sandbox-unavailable, test/session-profile.test.ts); the fake claude is a POSIX sh wrapper; the pure halves are test/resume-plan.test.ts and the contracts model-switch test on every OS' },
  { test: 'test/session-drain.test.ts', platforms: ['darwin'], na: 'the §2.4 rule 11 drain falsifiers (T-2026-10-19-014 B1) open sessions, which run only under the darwin session profile (linux/win32 refuse sandbox-unavailable, test/session-profile.test.ts); the fake claude is a POSIX sh wrapper; the daemon half (daemon.stop upgrade) is test/daemon-stop-verb.test.ts on darwin and linux' },
  { test: 'test/trace-capture.test.ts', platforms: ['darwin', 'linux'], na: '#trace-capture units assert POSIX modes (0700 / 0600) and O_NOFOLLOW refusals; win32 has no POSIX modes (its ACL posture is the P8-D78 parity phase) and sessions there refuse sandbox-unavailable, so no trace is ever opened on win32' },
  { test: 'test/table-talk-session.test.ts', platforms: ['darwin'], sibling: 'test/table-talk.test.ts', na: 'the table-talk S2 injection falsifiers open a live session with the fake claude, which runs only under the darwin session profile; the guidance bytes, the user-message shape and the projector are test/table-talk.test.ts on every platform' },
  { test: 'test/trace-session.test.ts', platforms: ['darwin'], na: 'the #trace-capture end-to-end falsifiers open sessions, which run only under the darwin session profile (linux/win32 refuse sandbox-unavailable, test/session-profile.test.ts); the fake claude is a POSIX sh wrapper; the writer and policy units are test/trace-capture.test.ts on darwin and linux' },
  { test: 'test/session-supervisor.test.ts', platforms: ['darwin'], na: 'the supervisor spawns only under a session profile, which exists only on darwin (linux/win32 refuse sandbox-unavailable, asserted in test/session-profile.test.ts); the fake claude is a POSIX sh wrapper' },
  { test: 'test/web-sandbox.test.ts', platforms: ['darwin'], sibling: 'test/web-sandbox-win32.test.ts', na: 'win32 sibling covers the confined transport (W5); linux has no transport profile in §15.5 (the endpoint refuses, asserted platform-independently in test/web-units.test.ts)' },
  // M1.11 #mod-host: the darwin default-deny `mod` profile with a real sandboxed mod child.
  // gnomon-loops step 4 #loop-check: the darwin `loop-check` profile under sandbox-exec with real check children.
  { test: 'test/loop-check-sandbox.test.ts', platforms: ['darwin'], sibling: 'test/loop-check.test.ts', na: 'enforcement of the darwin `loop-check` profile under sandbox-exec (G-SBX-07, G-SBX-04..06, G-SEC-02 end to end); the win32 backend (WRITE_RESTRICTED token + ACEs + job object, G:1596) is the Windows session\'s W5 and linux has no profile: both refuse sandbox-unavailable, asserted with the platform as data in the sibling, which also runs the parsers, scanner, env and copy on every platform' },
  // gnomon-loops step 5 #loop-runner: Example A minus why end to end under the darwin `loop-check` profile, and the kill switch against a real check process.
  { test: 'test/loop-model-e2e.test.ts', platforms: ['darwin', 'linux'], sibling: 'test/loop-model.test.ts', na: 'the model step end to end spawns the real gnomon-local child as a POSIX process group (the job object is the Windows parity phase, P8-D78, as test/local-lane-spawn.test.ts); the verdict parse, the prompt fence, G-LOOP-06/12/13/16, budgets and the run reference run on every platform with a scripted model port in the sibling' },
  // gnomon-loops step 10 #loop-act / #loop-git: a real git scratch and park repo, the real gnomon-local child as a POSIX process group.
  { test: 'test/loop-act-sandbox.test.ts', platforms: ['darwin'], sibling: 'test/loop-act.test.ts', na: 'the Aegis escape suite runs under the real darwin `loop-act` profile (sandbox-exec) and the kernel-side scratch refusals use mkfifo and case-insensitive APFS; win32 (W5) and linux have no loop-act backend and refuse sandbox-unavailable, asserted with the platform as data in the sibling, which also checks the SBPL tail, the collision and name refusals and the land hazards on every platform' },
  { test: 'test/loop-act-e2e.test.ts', platforms: ['darwin', 'linux'], sibling: 'test/loop-act.test.ts', na: 'the scratch worktree is built from real git plumbing with symlinked node_modules, and the act step spawns the real gnomon-local child as a POSIX process group (the job object is the Windows parity phase, P8-D78); win32 has no loop-act backend (W5) and the runner refuses its runs sandbox-unavailable. The clamp, the tool-layer protected-input deny, the land hazards, the propose reasons, the loop-act SBPL tail and the platform refusal run on every platform in the sibling' },
  // gnomon-loops step 11 #loop-land: the land against real git (index.lock, update-ref CAS, hard links, symlinks, POSIX uid).
  { test: 'test/loop-land-git.test.ts', platforms: ['darwin', 'linux'], sibling: 'test/loop-land.test.ts', na: 'the land mechanics run real git with POSIX file semantics (link() as a no-replace placement, symlinks, exec bits, a parent dir swapped for a symlink, process.getuid ownership); win32 has no loop-act backend (W5), so no act run ever parks a commit to land there. The lander\'s gate, wait, park, fold and trailer rules run on every platform in the sibling through its land seam' },
  { test: 'test/loop-runner-darwin.test.ts', platforms: ['darwin'], sibling: 'test/loop-runner.test.ts', na: 'the end-to-end loop runs its checks under the darwin `loop-check` profile (sandbox-exec); win32 (W5) and linux have no loop-check backend and the runner refuses their runs sandbox-unavailable, asserted with the platform as data in the sibling, which runs the whole graph walk, budgets, restart, replay and kill switch with an injected executor on every platform' },
  { test: 'test/mod-sandbox.test.ts', platforms: ['darwin'], sibling: 'test/mod-host.test.ts', na: 'enforcement of the darwin `mod` profile under sandbox-exec; win32 (restricted token + ACL + job object) is the parity phase (P8-D78); linux has no mod profile and refuses sandbox-unavailable (asserted in test/mod-host.test.ts on every platform)' },
  // T-2026-10-19-009 item 1: descendant sweep on stop over real processes (ps table, setsid escape).
  { test: 'test/daemon-children-tree.test.ts', platforms: ['darwin', 'linux'], sibling: 'test/daemon-children.test.ts', na: 'the sweep logic (witness re-check, pid reuse, unverifiable verdict) runs on every platform with a faked process table in test/daemon-children.test.ts; Windows has no ps or process groups, so its row has no snapshot and the verdict is unverifiable until the job-object parity phase (P8-D78)' },
  // T-2026-10-19-009 item 2: socket ownership (connect-probe reclaim, private bind + publish, 0700 dir).
  { test: 'test/socket-ownership.test.ts', platforms: ['darwin', 'linux'], na: 'unix-socket ownership only: on Windows the endpoint is a named pipe created by the signed helper with an owner-only DACL (Windows parity phase, P8-D78), which has no stale file to reclaim' },
  // T-2026-10-19-009 item 3: readiness handshake over real gnomond processes (ready pipe, lost race, classified exit).
  { test: 'test/socket-flood.test.ts', platforms: ['darwin', 'linux'], na: 'Windows parity phase (P8-D78): the flood, write-buffer and connection-cap falsifiers drive the unix-socket endpoint; the named pipe (P03) gets its own bounds there' },
  { test: 'test/daemon-ready.test.ts', platforms: ['darwin', 'linux'], sibling: 'test/daemon-exit-codes.test.ts', na: 'the exit-code table, the ready-line parser and the bounded stderr tail run on every platform in test/daemon-exit-codes.test.ts; the real-process handshake needs the unix-socket endpoint (the Windows named pipe is the parity phase, P8-D78)' },
  // PR-4 #kernel-log, macOS-first (P8-D78): file modes, kill -9, p99 + per-OS memory metric.
  { test: 'test/kernel-log-posix.test.ts', platforms: ['darwin', 'linux'], na: 'Windows parity phase (P8-D78): owner-only ACLs instead of modes, and the private-bytes memory metric (§16 memory row) are measured there' },
  // T-2026-10-17-009(a) quarantine: completing a quarantine records the kernel pub into an owner-only keys/ dir (POSIX modes in #identity).
  { test: 'test/kernel-log-quarantine.test.ts', platforms: ['darwin', 'linux'], na: 'Windows parity phase (P8-D78): owner-only keys/ is an ACL via the helper there, not a POSIX mode; the key-free quarantine logic (step list, keystore tripwire, Windows-valid evidence names) runs on every platform in test/kernel-log-quarantine-names.test.ts' },
  { test: 'test/log-cli-quarantine-posix.test.ts', platforms: ['darwin', 'linux'], na: 'Windows parity phase (P8-D78): completing a quarantine writes an owner-only keys/ dir (ACL via the helper there); the refusal/readout CLI cases run on every platform in test/log-cli.test.ts' },
  // M1.3 #identity: pinning + running the signed helper (POSIX exec bits, a shebang fake helper, owner-only keys/).
  { test: 'test/identity-helper-pin.test.ts', platforms: ['darwin', 'linux'], sibling: 'test/identity-hardware.test.ts', na: 'the key, presence and broker logic over the helper runs on every platform in the sibling (in-memory fake); the pin/spawn half needs POSIX exec bits and a shebang child; the Windows helper (Rust, P8-D71) is the parity phase (P8-D78)' },
  // T-2026-10-21-028 #release-pins: release sha256 pins for the helper and voice-io (shebang fakes, POSIX exec bits).
  { test: 'test/release-pins.test.ts', platforms: ['darwin', 'linux'], sibling: 'test/identity-hardware.test.ts', na: 'pins and spawns shebang fake helpers and voice-io executables (POSIX exec bits) and runs the release-manifest scripts on them; the Windows helper (Rust, P8-D71) and voice are the parity phase (P8-D78)' },
  { test: 'test/identity-cli.test.ts', platforms: ['darwin', 'linux'], sibling: 'test/identity-hardware.test.ts', na: 'gnomon identity init writes an owner-only keys/ dir (POSIX modes) and pins a shebang executable; the key/presence logic runs everywhere in the sibling; the Windows helper is the parity phase (P8-D78)' },
  { test: 'test/setup.test.ts', platforms: ['darwin', 'linux'], sibling: 'test/identity-hardware.test.ts', na: 'gnomon setup (#first-run) provisions through the #provisioner, which writes an owner-only keys/ dir (POSIX modes), symlinks a home and pins a shebang executable, like identity-cli.test.ts; the Windows helper is the parity phase (P8-D78)' },
  { test: 'test/setup-endpoint.test.ts', platforms: ['darwin', 'linux'], sibling: 'test/identity-hardware.test.ts', na: 'the #setup-endpoint provisions through the #provisioner (owner-only keys/ dir, POSIX modes; a shebang helper pin) like setup.test.ts; the Windows helper is the parity phase (P8-D78)' },
  { test: 'test/identity-hw.test.ts', platforms: ['darwin'], na: 'founder-run hardware test: the Developer-ID-signed helper and the Secure Enclave exist only on the founder\'s Mac. On darwin the real case runs only with GNOMON_HW_TESTS=1 (describe.runIf) and is otherwise one it.todo (describe.skipIf); the file is excluded on win32/linux by this marker. Windows Hello / TPM is probe P02 in the parity phase (P8-D78)' },
  // gnomon-loops step 7 #loop-events: runs on ALL three platforms; marked only because two real-watch cases skip on Linux and the symlink case on win32.
  { test: 'test/loop-events.test.ts', platforms: ['darwin', 'linux', 'win32'], na: 'no sibling needed: every trigger kind, debounce, the ignore rules, G-LOOP-15 and G-LOOP-17 run on every platform through handleFsEvent/checkRefs and the row path; only the real fs.watch cases skip on Linux (recursive watch is Node\'s userland walker there) and the symlink-escape case on win32 (symlinks need a privilege)' },
  // T-2026-10-17-011: runs on ALL three platforms; marked only because it branches on process.platform.
  { test: 'test/boot-session.test.ts', platforms: ['darwin', 'linux', 'win32'], na: 'no sibling needed: one file asserts every platform inline — a UUID on macOS (kern.bootsessionuuid) / Linux (boot_id), `unknown` on win32 until the helper boot id of the parity phase (P8-D78, P8-D83)' },
];
