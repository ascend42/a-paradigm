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
 * answer and only with the fake claude. `GNOMON_E2E_REQUIRED=1` turns a skipped real-kernel e2e into a FAILURE, so
 * the job can never go green by skipping. These env reads are test-side: no `src` path reads either variable.
 */
export const E2E_SIP_STUB = process.env.GNOMON_E2E_SIP_STUB === '1';
export const E2E_REQUIRED = process.env.GNOMON_E2E_REQUIRED === '1';
/** the session floor as the e2e rig will meet it: the real one, or (CI stub) the real one with SIP answered true */
export function e2eSandboxOk(): boolean {
  return darwinFloor(undefined, E2E_SIP_STUB ? () => true : undefined).ok && (process.platform !== 'darwin' || fs.existsSync('/usr/bin/sandbox-exec'));
}
/** spread into `DaemonSeams.supervisor` next to the fake claude's `claudePath` */
export const E2E_SUPERVISOR_SEAMS: { sessionSipStub?: boolean } = E2E_SIP_STUB ? { sessionSipStub: true } : {};
/** with GNOMON_E2E_REQUIRED=1, a gate that would skip the file's real-kernel describe fails by name instead */
export function requireE2e(ok: boolean, what: string): void {
  if (!E2E_REQUIRED) return;
  describe(`${what}: required on this run (GNOMON_E2E_REQUIRED=1)`, () => {
    it('the real-kernel describe is not skipped', () => {
      expect({ what, runs: ok, platform: process.platform, sipStub: E2E_SIP_STUB }).toMatchObject({ runs: true });
    });
  });
}
