/**
 * TD-2026-10-23-268 (Aegis review): a loop's named variables reach ONLY the check child. The kernel's own spawns
 * (the `git ls-files` that builds the check copy, with kernelEnv) never carry them, and the copy never carries the
 * loop's own env files. child_process is wrapped to record every spawnSync env (no sandbox needed: linux refuses
 * `sandbox-unavailable` after the copy, so the kernel's git spawn has run by then).
 */
import { spawnSync as realSpawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const seen: Array<{ cmd: string; env: Record<string, string | undefined> | undefined }> = [];
vi.mock('node:child_process', async (orig) => {
  const m = await orig<typeof import('node:child_process')>();
  return {
    ...m,
    spawnSync: (cmd: string, args: readonly string[], o?: { env?: Record<string, string | undefined> }) => {
      seen.push({ cmd, env: o?.env });
      return m.spawnSync(cmd, args as string[], o as never);
    },
  };
});

const { runCheck } = await import('../src/kernel/loops/check-exec.js');

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length) fs.rmSync(dirs.pop()!, { recursive: true, force: true });
});
const tmp = (): string => {
  const d = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'gnomon-lek-')));
  dirs.push(d);
  return d;
};
const gitEnv = { PATH: process.env.PATH ?? '', HOME: os.tmpdir(), GIT_CONFIG_NOSYSTEM: '1' } as Record<string, string>;

describe('the kernel never hands a loop\'s values to its own spawns', () => {
  it('kernelEnv (the copy\'s git ls-files) has no named variable; the loop\'s env file is not copied', async () => {
    const r = tmp();
    expect(realSpawnSync('git', ['init', '-q'], { cwd: r, env: gitEnv }).status).toBe(0);
    fs.writeFileSync(path.join(r, 'a.txt'), 'A');
    fs.writeFileSync(path.join(r, '.env.local'), 'STRIPE_KEY=sk_live_kernel_never\n');
    const h = tmp();
    seen.length = 0;
    const res = await runCheck({
      runId: 'k1', repo: r, home: h, platform: 'linux', envFrom: gitEnv, keepOnError: true,
      node: { id: 'c', builtin: 'git.clean', pass: { exit: 0 }, timeoutSec: 5, env: ['STRIPE_KEY'] },
      paradigmCli: { real: path.join(r, 'a.txt'), sha256: '0'.repeat(64) },
      envSource: { files: [{ path: path.join(r, '.env.local'), shown: '.env.local' }] },
      skipFiles: ['.env.local'],
    });
    expect(res.verdict).toBe('error');
    const git = seen.filter((x) => x.cmd === 'git');
    expect(git.length).toBeGreaterThan(0);
    for (const g of git) expect(Object.keys(g.env ?? {})).not.toContain('STRIPE_KEY');
    expect(JSON.stringify(seen.map((x) => x.env))).not.toContain('sk_live_kernel_never');
    expect(res.copy.kept).toBe(true);
    expect(fs.existsSync(path.join(res.copy.dir, 'repo', 'a.txt'))).toBe(true);
    expect(fs.existsSync(path.join(res.copy.dir, 'repo', '.env.local'))).toBe(false);
  });
});
