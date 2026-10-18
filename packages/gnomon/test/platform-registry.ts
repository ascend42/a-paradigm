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
  // PR-5 $daemon-lifecycle core + #socket, macOS-first (P8-D78).
  { test: 'test/daemon-lifecycle.test.ts', platforms: ['darwin', 'linux'], na: 'Windows parity phase (P8-D78): unix-socket endpoint only; the named pipe via the signed helper waits for probe P03' },
  { test: 'test/socket-server.test.ts', platforms: ['darwin', 'linux'], na: 'Windows parity phase (P8-D78): unix-socket endpoint only; the named pipe via the signed helper waits for probe P03' },
  // M1.9 #scheduler + $daemon-lifecycle in the real daemon: unix socket + POSIX process groups (orphan sweep).
  { test: 'test/scheduler-daemon.test.ts', platforms: ['darwin', 'linux'], sibling: 'test/scheduler.test.ts', na: 'the scheduler logic and the children/orphan-sweep logic run on every platform in test/scheduler.test.ts and test/daemon-children.test.ts; the daemon-level half needs the unix socket and process groups (the pipe and job object are the Windows parity phase, P8-D78)' },
  { test: 'test/idle-exit.test.ts', platforms: ['darwin', 'linux'], na: 'Windows parity phase (P8-D78): unix-socket endpoint only; the named pipe via the signed helper waits for probe P03' },
  // M1.11 slice 2: #mod-host in the real daemon (unix socket + POSIX device-key modes).
  { test: 'test/mod-daemon.test.ts', platforms: ['darwin', 'linux'], sibling: 'test/mod-append-budget.test.ts', na: 'Windows parity phase (P8-D78): the daemon endpoint is a unix socket and device keys use POSIX modes; the pure clamp and budget half runs everywhere in the sibling' },
  // M1.12 slice 3 replay: the rig writes kernel keys into an owner-only keys/ dir (POSIX modes in #identity).
  { test: 'test/m112-replay.test.ts', platforms: ['darwin', 'linux'], na: 'Windows parity phase (P8-D78): owner-only keys/ is an ACL via the helper there, not a POSIX mode; replay itself is platform-independent code' },
  { test: 'test/socket-auth.test.ts', platforms: ['darwin', 'linux'], na: 'Windows parity phase (P8-D78): unix-socket endpoint and POSIX device-key modes only; the pipe (P03) and owner-only ACLs come there' },
  { test: 'test/socket-abi.test.ts', platforms: ['darwin', 'linux'], na: 'Windows parity phase (P8-D78): read tokens and the G-ABI/G-SOCK suites over the unix-socket endpoint with POSIX device-key and token-file modes; the pipe (P03) comes there' },
  { test: 'test/dev-launch.test.ts', platforms: ['darwin', 'linux'], na: 'Windows parity phase (P8-D78): #dev-launch writes owner-only POSIX key files and starts a daemon on the unix-socket endpoint; the pipe and owner-only DACLs come there' },
  { test: 'test/m112-conformance.test.ts', platforms: ['darwin', 'linux'], na: 'Windows parity phase (P8-D78): the published TS client and the conformance runner against a live kernel over the unix-socket endpoint with POSIX device-key modes; the pipe (P03) comes there (the display vectors run everywhere in gnomon-contracts)' },
  { test: 'test/socket-log-read.test.ts', platforms: ['darwin', 'linux'], na: 'Windows parity phase (P8-D78): log.read / subscriptions / ref.resolve over the unix-socket endpoint with POSIX device-key modes; the pipe (P03) comes there' },
  // M1.4 #web-endpoint: the darwin `transport` sandbox profile + the daemon `gnomon open` path (unix socket).
  // M1.7 #session-runner / #supervisor: the darwin `session` profile (sandbox-exec) and the fake-claude session rig (POSIX sh wrapper, process groups).
  { test: 'test/session-profile.test.ts', platforms: ['darwin', 'linux'], na: 'SBPL paths are POSIX; the win32 session backend (restricted token + ACEs + WFP) is the Windows parity phase (P8-D78) — its registry refusal and status `partial` (G-WIN-06) are asserted here with the platform passed as data' },
  { test: 'test/session-sandbox.test.ts', platforms: ['darwin'], na: 'enforcement of the darwin `session` profile under sandbox-exec; win32 is the parity phase (P8-D78); linux has no session mechanism yet (every class `none`, platform/session-denies.ts) and refuses (test/session-profile.test.ts)' },
  // M1.8 #local-runner: the LocalLane spawn path with the real gnomon-local child (POSIX process groups via DaemonChildren).
  { test: 'test/local-lane-spawn.test.ts', platforms: ['darwin', 'linux'], sibling: 'test/local-runner.test.ts', na: 'routing, fallback, probe, driver replay and the meter run on every platform in test/local-runner.test.ts; the spawn half needs POSIX process groups (the job object is the Windows parity phase, P8-D78)' },
  { test: 'test/local-config-daemon.test.ts', platforms: ['darwin', 'linux'], sibling: 'test/local-config.test.ts', na: 'the loader, high-water and pin logic run on every platform in the sibling; the two-boot chain-loop half needs the daemon unix-socket endpoint (the pipe is the Windows parity phase, P8-D78)' },
  { test: 'test/session-supervisor.test.ts', platforms: ['darwin'], na: 'the supervisor spawns only under a session profile, which exists only on darwin (linux/win32 refuse sandbox-unavailable, asserted in test/session-profile.test.ts); the fake claude is a POSIX sh wrapper' },
  { test: 'test/web-sandbox.test.ts', platforms: ['darwin'], na: 'Windows parity phase (P8-D78): the restricted-token + job-object transport profile; linux has no transport profile in §15.5 (the endpoint refuses, asserted platform-independently in test/web-units.test.ts)' },
  // M1.11 #mod-host: the darwin default-deny `mod` profile with a real sandboxed mod child.
  { test: 'test/mod-sandbox.test.ts', platforms: ['darwin'], sibling: 'test/mod-host.test.ts', na: 'enforcement of the darwin `mod` profile under sandbox-exec; win32 (restricted token + ACL + job object) is the parity phase (P8-D78); linux has no mod profile and refuses sandbox-unavailable (asserted in test/mod-host.test.ts on every platform)' },
  // PR-4 #kernel-log, macOS-first (P8-D78): file modes, kill -9, p99 + per-OS memory metric.
  { test: 'test/kernel-log-posix.test.ts', platforms: ['darwin', 'linux'], na: 'Windows parity phase (P8-D78): owner-only ACLs instead of modes, and the private-bytes memory metric (§16 memory row) are measured there' },
  // T-2026-10-17-009(a) quarantine: completing a quarantine records the kernel pub into an owner-only keys/ dir (POSIX modes in #identity).
  { test: 'test/kernel-log-quarantine.test.ts', platforms: ['darwin', 'linux'], na: 'Windows parity phase (P8-D78): owner-only keys/ is an ACL via the helper there, not a POSIX mode; the key-free quarantine logic (step list, keystore tripwire, Windows-valid evidence names) runs on every platform in test/kernel-log-quarantine-names.test.ts' },
  { test: 'test/log-cli-quarantine-posix.test.ts', platforms: ['darwin', 'linux'], na: 'Windows parity phase (P8-D78): completing a quarantine writes an owner-only keys/ dir (ACL via the helper there); the refusal/readout CLI cases run on every platform in test/log-cli.test.ts' },
  // T-2026-10-17-011: runs on ALL three platforms; marked only because it branches on process.platform.
  { test: 'test/boot-session.test.ts', platforms: ['darwin', 'linux', 'win32'], na: 'no sibling needed: one file asserts every platform inline — a UUID on macOS (kern.bootsessionuuid) / Linux (boot_id), `unknown` on win32 until the helper boot id of the parity phase (P8-D78, P8-D83)' },
];
