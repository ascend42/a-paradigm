/**
 * T-2026-10-18-030 (1) — the V8 inspector via SIGUSR1. A same-user `kill -USR1`
 * opens the inspector in a running Node process; no env scrub or execArgv check
 * sees it. The kernel therefore runs with exactly one Node flag,
 * `--disable-sigusr1`, and REFUSES to start without it: gnomond (the clean
 * re-exec passes it; the bin's shebang passes it), `gnomon up` and `gnomon dev
 * up` (the shebang; `unsafeRuntime` allows exactly that one flag and requires it).
 * The live falsifier (a running kernel signalled, no inspector) is POSIX and
 * lives in test/daemon-lifecycle.test.ts; these are the platform-independent guards.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { unsafeRuntime } from '../src/cli/launch-tty.js';
import { runForeground } from '../src/cli/daemon-cli.js';
import { DISABLE_SIGUSR1, reexecArgs, sigusr1Disabled, sigusr1Refusal } from '../src/kernel/lifecycle/env.js';
import { PKG_ROOT } from './helpers.js';
import { tempHome } from './daemon-helpers.js';

describe('the kernel requires --disable-sigusr1', () => {
  it('the flag name is the Node one', () => {
    expect(DISABLE_SIGUSR1).toBe('--disable-sigusr1');
  });

  it('sigusr1Disabled reads execArgv only (never NODE_OPTIONS, never a listener)', () => {
    expect(sigusr1Disabled(['--disable-sigusr1'])).toBe(true);
    expect(sigusr1Disabled([])).toBe(false);
    expect(sigusr1Disabled(['--disable-sigusr1=false'])).toBe(false); // exact flag only
    expect(sigusr1Disabled(['--no-disable-sigusr1'])).toBe(false);
    expect(sigusr1Refusal([])).toMatch(/without --disable-sigusr1/);
    expect(sigusr1Refusal(['--disable-sigusr1'])).toBeNull();
  });

  it('FALSIFIER: unsafeRuntime allows exactly --disable-sigusr1 and requires it', () => {
    expect(unsafeRuntime({ env: {}, execArgv: ['--disable-sigusr1'] })).toBeNull();
    for (const execArgv of [[], ['--inspect'], ['--disable-sigusr1', '--inspect=0'], ['--disable-sigusr1', '--disable-sigusr1'], ['--require', 'x', '--disable-sigusr1']]) {
      expect(unsafeRuntime({ env: {}, execArgv }), JSON.stringify(execArgv)).not.toBeNull();
    }
    expect(unsafeRuntime({ env: { NODE_OPTIONS: '--disable-sigusr1' }, execArgv: [] })).toMatch(/NODE_OPTIONS is set.*without --disable-sigusr1/);
  });

  it('FALSIFIER: the clean re-exec puts the flag before the entry (a node flag after the entry is a script arg)', () => {
    const a = reexecArgs({ entry: 'gnomond.js', home: 'h' });
    expect(a[0]).toBe('--disable-sigusr1');
    expect(a[1]).toBe('gnomond.js');
  });

  it('FALSIFIER: gnomond --foreground refuses without the flag before it opens the home', async () => {
    const t = tempHome();
    try {
      expect(await runForeground({ foreground: true, home: t.home, idleMs: 1000 }, { execArgv: [] })).toBe(78); // DAEMON_EXIT.config
    } finally {
      t.cleanup();
    }
  });

  it('both bins carry the shebang that passes the flag (source and the built dist)', () => {
    for (const f of ['src/cli/gnomon.ts', 'src/cli/gnomond.ts', 'dist/cli/gnomon.js', 'dist/cli/gnomond.js']) {
      const first = readFileSync(path.join(PKG_ROOT, f), 'utf8').split(/\r?\n/)[0] // a Windows checkout has CRLF;
      expect(first, f).toBe('#!/usr/bin/env -S node --disable-sigusr1');
    }
  });
});
