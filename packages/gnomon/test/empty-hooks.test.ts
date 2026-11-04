/**
 * #loop-git Aegis L4 (T-2026-10-23-002, T-2026-10-31-001): every kernel git call pins core.hooksPath at
 * EMPTY_HOOKS_PATH. On win32 that is a kernel-owned empty dir under LOCALAPPDATA, made LAZILY before the first git
 * spawn that pins it (hardenedGit, execTool), never at module load: a CLI command that runs no git writes nothing
 * under the user's home (test/guide-cli.test.ts asserts the empty temp HOME on every OS).
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const realPlatform = Object.getOwnPropertyDescriptor(process, 'platform')!;
const realLocal = process.env.LOCALAPPDATA;
const dirs: string[] = [];
afterEach(() => {
  Object.defineProperty(process, 'platform', realPlatform);
  if (realLocal === undefined) delete process.env.LOCALAPPDATA;
  else process.env.LOCALAPPDATA = realLocal;
  vi.resetModules();
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

describe('the empty hooks dir', () => {
  it('both flag sets pin it; another hooks path is not the pin', async () => {
    const { EMPTY_HOOKS_PATH, HARDENED_GIT_FLAGS, pinsEmptyHooks } = await import('../src/kernel/git/scratch.js');
    const { PUSH_GIT_FLAGS } = await import('../src/kernel/git/verb-exec.js');
    expect(pinsEmptyHooks(HARDENED_GIT_FLAGS)).toBe(true);
    expect(pinsEmptyHooks(PUSH_GIT_FLAGS)).toBe(true);
    expect(pinsEmptyHooks(['-c', 'core.hooksPath=/elsewhere', 'status'])).toBe(false);
    expect(HARDENED_GIT_FLAGS).toContain(`core.hooksPath=${EMPTY_HOOKS_PATH}`);
  });

  it('win32 (simulated): importing the git modules writes nothing; ensureEmptyHooksDir makes it once', async () => {
    const local = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'gnomon-hooks-')));
    dirs.push(local);
    process.env.LOCALAPPDATA = local;
    Object.defineProperty(process, 'platform', { ...realPlatform, value: 'win32' });
    vi.resetModules();
    const { EMPTY_HOOKS_PATH, ensureEmptyHooksDir } = await import('../src/kernel/git/scratch.js');
    await import('../src/kernel/git/verb-exec.js');
    expect(EMPTY_HOOKS_PATH).toBe(path.join(local, 'Gnomon', 'empty-hooks'));
    expect(fs.readdirSync(local)).toEqual([]); // nothing at load
    ensureEmptyHooksDir();
    expect(fs.statSync(EMPTY_HOOKS_PATH).isDirectory()).toBe(true);
    expect(fs.readdirSync(EMPTY_HOOKS_PATH)).toEqual([]);
    fs.rmSync(path.join(local, 'Gnomon'), { recursive: true });
    ensureEmptyHooksDir(); // once per process: the flag is set
    expect(fs.readdirSync(local)).toEqual([]);
  });

  it('off win32 ensureEmptyHooksDir is a no-op (the pin is /dev/null)', async () => {
    const { ensureEmptyHooksDir } = await import('../src/kernel/git/scratch.js');
    expect(() => ensureEmptyHooksDir('darwin')).not.toThrow();
    expect(() => ensureEmptyHooksDir('linux')).not.toThrow();
  });
});
