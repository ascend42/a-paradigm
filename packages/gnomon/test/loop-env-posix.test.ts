// @gnomon-platform: darwin, linux
/**
 * #loop-env, the POSIX half (TD-2026-10-23-268; Aegis M2, M3): env files are opened O_NOFOLLOW (a symlink is
 * refused), ~/.gnomon/loop-env must be owner-only by mode (0600/0400), and a FIFO is refused without blocking. win32
 * has no O_NOFOLLOW, no POSIX modes (the owner check is an ACL in the parity phase, P8-D78) and no mkfifo; the
 * platform-neutral rules (lookup order, refusal reasons, the repo-escape check) run on every OS in
 * test/loop-check.test.ts.
 */
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { resolveLoopEnvFiles } from '../src/kernel/loops/loop-env.js';

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length) fs.rmSync(dirs.pop()!, { recursive: true, force: true });
});
const tmp = (): string => {
  const d = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'gnomon-lep-')));
  dirs.push(d);
  return d;
};
const envFile = (dir: string, name: string, body: string, mode = 0o600): string => {
  const p = path.join(dir, name);
  fs.writeFileSync(p, body, { mode });
  fs.chmodSync(p, mode);
  return p;
};

describe('TD-2026-10-23-268: env files, POSIX semantics', () => {
  it('a repo env file that is a symlink is refused (O_NOFOLLOW)', () => {
    const d = tmp();
    envFile(d, 'a.env', 'X=1\n', 0o644);
    fs.symlinkSync(path.join(d, 'a.env'), path.join(d, 'link.env'));
    expect(resolveLoopEnvFiles(['X'], { files: [{ path: path.join(d, 'link.env'), shown: 'link.env', repoRoot: d }] })).toMatchObject({ ok: false, code: 'env-file', reason: expect.stringContaining('link.env is a symlink') });
  });

  it('a loose (0644) ~/.gnomon/loop-env is refused; 0400 is owner-only', () => {
    const loose = envFile(tmp(), 'loop-env', 'STRIPE_KEY=sk\n', 0o644);
    expect(resolveLoopEnvFiles(['STRIPE_KEY'], { files: [], home: loose })).toMatchObject({ ok: false, code: 'env-file', reason: expect.stringContaining('~/.gnomon/loop-env must be owner-only (chmod 600') });
    fs.chmodSync(loose, 0o400);
    expect(resolveLoopEnvFiles(['STRIPE_KEY'], { files: [], home: loose })).toEqual({ ok: true, env: { STRIPE_KEY: 'sk' } });
  });

  it('Aegis M3: a linked loop-env keeps the owner-only rule (0644 is refused)', () => {
    const homeFile = envFile(tmp(), 'loop-env', 'X=home\n');
    expect(resolveLoopEnvFiles(['X'], { files: [{ path: homeFile, shown: '~/.gnomon/loop-env' }], home: homeFile })).toEqual({ ok: true, env: { X: 'home' } });
    fs.chmodSync(homeFile, 0o644);
    expect(resolveLoopEnvFiles(['X'], { files: [{ path: homeFile, shown: '~/.gnomon/loop-env' }], home: homeFile })).toMatchObject({ ok: false, reason: expect.stringContaining('must be owner-only') });
  });

  it('Aegis M2: a FIFO is refused at once, never blocking the kernel', () => {
    const d = tmp();
    const fifo = path.join(d, 'pipe.env');
    expect(spawnSync('mkfifo', [fifo]).status).toBe(0);
    const t0 = Date.now();
    expect(resolveLoopEnvFiles(['X'], { files: [{ path: fifo, shown: 'pipe.env', repoRoot: d }] })).toEqual({ ok: false, code: 'env-file', reason: 'the env file pipe.env is not a regular file' });
    expect(Date.now() - t0).toBeLessThan(1000);
  });
});
