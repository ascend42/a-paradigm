/**
 * Shared rigs for the M1.7 session tests: a throwaway world (Gnomon home,
 * user home with ~/.claude, repo cwd, linked folder) and the FAKE claude
 * wrapper (test/fixtures/fake-claude.mjs behind a `#!/bin/sh` named
 * `claude`). Never the real claude binary, never Anthropic.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildSessionPolicy, type PolicyPath, type SessionPolicy } from '../src/kernel/manifest/policy.js';
import { darwinFloor } from '../src/kernel/sandbox/session.js';
import { PKG_ROOT } from './helpers.js';

export interface SessionWorld {
  root: string;
  home: string;
  userHome: string;
  cwd: string;
  linked: string;
  stubDir: string;
  claude: string;
  cleanup(): void;
}

export function sessionWorld(): SessionWorld {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'gnomon-sess-')));
  const home = path.join(root, 'gnomon-home');
  const userHome = path.join(root, 'userhome');
  const cwd = path.join(root, 'repo');
  const linked = path.join(root, 'linked-mod');
  const stubDir = path.join(root, 'stub');
  for (const d of [path.join(home, 'keys'), path.join(userHome, '.claude'), path.join(cwd, '.claude'), path.join(cwd, '.git', 'hooks'), linked, stubDir]) fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(home, 'keys', 'device.key'), 'secret');
  fs.writeFileSync(path.join(cwd, '.git', 'config'), '[core]\n');
  const claude = path.join(stubDir, 'bin', 'claude'); // its dir is write-denied in a session (Aegis H1): trace/mode live one level up
  fs.mkdirSync(path.dirname(claude));
  fs.writeFileSync(claude, `#!/bin/sh\nexec "${process.execPath}" "${path.join(PKG_ROOT, 'test', 'fixtures', 'fake-claude.mjs')}" "${claude}" "$0" "$@"\n`, { mode: 0o755 });
  return { root, home, userHome, cwd, linked, stubDir, claude, cleanup: () => fs.rmSync(root, { recursive: true, force: true }) };
}

export function setMode(w: SessionWorld, mode: Record<string, unknown>): void {
  fs.writeFileSync(path.join(w.stubDir, 'mode.json'), JSON.stringify(mode));
}

export function trace(w: SessionWorld): Array<Record<string, unknown>> {
  try {
    return fs.readFileSync(path.join(w.stubDir, 'trace.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as Record<string, unknown>);
  } catch {
    return [];
  }
}

export function worldPolicy(w: SessionWorld, endpointPort: number | null = null, extraDenyWrite: readonly PolicyPath[] = [], homeReadable: ReadonlyArray<{ path: string; match: 'literal' | 'subpath' }> = [], opts: { claudeTranscripts?: boolean; userClaudeDir?: string } = {}): SessionPolicy {
  return buildSessionPolicy({ home: w.home, cwd: w.cwd, userClaudeDir: opts.userClaudeDir ?? path.join(w.userHome, '.claude'), userHome: w.userHome, managedSettingsPaths: [], linkedFolders: [w.linked], endpointPort, extraDenyWrite, homeReadable, ...(opts.claudeTranscripts ? { claudeTranscripts: true } : {}) });
}

export async function waitFor(cond: () => boolean, ms = 5_000, step = 20): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (cond()) return true;
    await new Promise((r) => setTimeout(r, step));
  }
  return cond();
}

/**
 * S1.4 P5, the CI e2e job (Aegis ruling 1(a), 1(b)). `GNOMON_E2E_SIP_STUB=1` (the CI job only; GitHub's macOS runners
 * have SIP off) passes the `DaemonSeams.supervisor.sessionSipStub` flag, which stubs ONLY the session floor's SIP
 * answer, only with a `claudePath` seam (tests pass the fake). `GNOMON_E2E_REQUIRED=1` turns a skipped real-kernel e2e into a FAILURE, so
 * the job can never go green by skipping. These env reads are test-side: no `src` path reads either variable.
 */
export const E2E_SIP_STUB = process.env.GNOMON_E2E_SIP_STUB === '1';
export const E2E_REQUIRED = process.env.GNOMON_E2E_REQUIRED === '1';
/**
 * S1.4 P5 review (Aegis 1(b) item 8): the floors the e2e rig meets, each by name: the SESSION profile's floor and the
 * MOD profile's floor (macOS 15+ and SIP; with the CI stub SIP is answered true for both, never the macOS major),
 * and `/usr/bin/sandbox-exec`. Each is required by name through requireE2e.
 */
export function e2eFloors(): { session: boolean; mod: boolean; sandboxExec: boolean } {
  const sip = E2E_SIP_STUB ? () => true : undefined;
  const darwin = process.platform === 'darwin';
  return { session: darwin && darwinFloor(undefined, sip).ok, mod: darwin && darwinFloor(undefined, sip).ok, sandboxExec: darwin && fs.existsSync('/usr/bin/sandbox-exec') };
}
/** every floor, required by name under GNOMON_E2E_REQUIRED=1; true when the file's real-kernel describe can run */
export function e2eFloorsOk(what: string): boolean {
  const f = e2eFloors();
  for (const [name, ok] of Object.entries(f)) requireE2e(ok, `${what}: floor ${name}`);
  return f.session && f.mod && f.sandboxExec;
}
/** after a mod opened: the session and mod rows say sipStubbed exactly when this run stubbed SIP (darwin only) */
export function stubMarks(rows: Iterable<unknown>): { session: boolean; mod: boolean } {
  const all = [...rows].map((r) => (r as { event?: { kind?: string; payload?: Record<string, unknown> } }).event ?? {});
  const session = all.filter((e) => e.kind === 'session.sandbox' && typeof e.payload?.profileHash === 'string');
  const mod = all.filter((e) => e.kind === 'mod.sandbox');
  return { session: session.length > 0 && session.every((e) => e.payload?.sipStubbed === true), mod: mod.length > 0 && mod.every((e) => e.payload?.sipStubbed === true) };
}
/** spread into `DaemonSeams.supervisor` next to the fake claude's `claudePath` */
export const E2E_SUPERVISOR_SEAMS: { sessionSipStub?: boolean } = E2E_SIP_STUB ? { sessionSipStub: true } : {};
/** with GNOMON_E2E_REQUIRED=1, a gate that would skip the file's real-kernel describe fails by name instead */
export function requireE2e(ok: boolean, what: string): void {
  if (!E2E_REQUIRED) return;
  describe(`${what}: required on this run (GNOMON_E2E_REQUIRED=1)`, () => {
    it('the real-kernel describe is not skipped', () => {
      expect({ what, runs: ok, platform: process.platform, sipStubbed: E2E_SIP_STUB }).toMatchObject({ runs: true });
    });
  });
}
