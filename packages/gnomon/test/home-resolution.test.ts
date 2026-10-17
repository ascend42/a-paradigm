/**
 * $daemon-lifecycle (spec §2.4) — the platform-independent pieces of home
 * resolution and endpoint selection, split out of daemon-lifecycle.test.ts
 * (darwin/linux only) so they run on Windows too (T-2026-10-17-011).
 *
 * Paths are built with node:path, so the expectation is the host's own
 * absolute form ('/a/b' on POSIX, '<drive>:\a\b' on win32) — no
 * process.platform branch, hence no @gnomon-platform marker.
 */
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { LifecycleRefusal, resolveGnomonHome, selectSocketPath } from '../src/kernel/lifecycle/index.js';

describe('home resolution', () => {
  it('honours an absolute GNOMON_HOME (test seam) and defaults to ~/.gnomon', () => {
    const abs = path.resolve(path.sep, 'a', 'b');
    expect(resolveGnomonHome({ env: { GNOMON_HOME: abs } })).toBe(abs);
    const homedir = path.resolve(path.sep, 'Users', 'q');
    expect(resolveGnomonHome({ env: {}, homedir })).toBe(path.join(homedir, '.gnomon'));
    expect(() => resolveGnomonHome({ env: { GNOMON_HOME: path.join('rel', 'path') } })).toThrow(LifecycleRefusal);
  });

  it('normalises an absolute GNOMON_HOME (resolve, not a raw echo)', () => {
    const abs = path.resolve(path.sep, 'a', 'b');
    // a RAW string: path.join would already normalise the '..' away
    const raw = `${abs}${path.sep}c${path.sep}..`;
    expect(raw).not.toBe(abs);
    expect(resolveGnomonHome({ env: { GNOMON_HOME: raw } })).toBe(abs);
  });
});

describe('G-DMN-02 endpoint selection (pure)', () => {
  it('Windows refuses here: the named pipe is the parity phase (P8-D78)', () => {
    expect(selectSocketPath({ home: 'C:\\Users\\x\\.gnomon', platform: 'win32', env: {} })).toMatchObject({ ok: false });
  });
});
