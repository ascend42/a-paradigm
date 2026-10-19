// @gnomon-platform: darwin, linux
/**
 * T-2026-10-18-030 (3): loadDeviceCredential opens the key O_NONBLOCK, so a FIFO
 * swapped in between the lstat and the open cannot hang it (a FIFO with no writer
 * blocks a blocking O_RDONLY open forever); fstat on the descriptor refuses it.
 * The swap is simulated: lstat of the key path reports the real key's stats while
 * the path is a FIFO. Mutation check: drop O_NONBLOCK and this test hangs to its timeout.
 */
import { execFileSync } from 'node:child_process';
import * as realFs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { privateTmpRoot } from './daemon-helpers.js';

const swap = { from: '', to: '' };
vi.mock('node:fs', async (orig) => {
  const actual = await orig<typeof import('node:fs')>();
  return { ...actual, lstatSync: ((p: string, o?: unknown) => (p === swap.from ? actual.lstatSync(swap.to) : actual.lstatSync(p, o as never))) as typeof actual.lstatSync };
});

const { DeviceKeyError, loadDeviceCredential, writeNewDeviceKey } = await import('../src/kernel/identity/index.js');

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length) realFs.rmSync(dirs.pop()!, { recursive: true, force: true });
});

describe('device key open is non-blocking', () => {
  it('FALSIFIER: a FIFO swapped in after the lstat is refused not-a-file, without hanging', () => {
    const d = realFs.realpathSync.native(realFs.mkdtempSync(path.join(privateTmpRoot(), 'dk-')));
    dirs.push(d);
    realFs.chmodSync(d, 0o700);
    const home = path.join(d, 'home');
    realFs.mkdirSync(path.join(home, 'keys'), { recursive: true, mode: 0o700 });
    const real = path.join(home, 'keys', 'real.key');
    writeNewDeviceKey(home, real);
    const fifo = path.join(home, 'keys', 'device.key');
    execFileSync('mkfifo', ['-m', '600', fifo]);
    swap.from = fifo;
    swap.to = real;
    const t0 = Date.now();
    let err: unknown;
    try {
      loadDeviceCredential(home, fifo);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(DeviceKeyError);
    expect((err as InstanceType<typeof DeviceKeyError>).reason).toBe('not-a-file');
    expect(Date.now() - t0).toBeLessThan(2000);
  }, 5000);
});
