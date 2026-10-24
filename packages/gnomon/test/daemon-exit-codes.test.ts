/**
 * $daemon-lifecycle (spec §2.4 rule 2) — the classified exit codes and the
 * activator's bounded stderr tail (T-2026-10-19-009 item 3). Pure logic, every
 * platform; the real-process handshake is test/daemon-ready.test.ts.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  BoundedTail,
  classifyExitCode,
  DAEMON_EXIT,
  exitCodeOfLaunch,
  exitCodeOfRefusal,
  parseReadyLine,
  REFUSAL_EXIT_CLASS,
  reexecArgs,
  restartable,
} from '../src/kernel/lifecycle/index.js';
import { EXIT_NOT_RUNNING, EXIT_REFUSED, EXIT_USAGE, parseDaemonArgs, runDaemonCommand } from '../src/cli/daemon-cli.js';

describe('§2.4 rule 2: classified exit codes', () => {
  it('every code has exactly one class, and only transient/internal may restart', () => {
    expect(classifyExitCode(0)).toBe('ok');
    expect(classifyExitCode(DAEMON_EXIT.superseded)).toBe('superseded');
    expect(classifyExitCode(DAEMON_EXIT.usage)).toBe('config');
    expect(classifyExitCode(DAEMON_EXIT.config)).toBe('config');
    expect(classifyExitCode(DAEMON_EXIT.transient)).toBe('transient');
    expect(classifyExitCode(DAEMON_EXIT.internal)).toBe('internal');
    expect(classifyExitCode(1)).toBe('internal'); // a crashed interpreter is not a config verdict
    expect(classifyExitCode(null)).toBe('internal'); // killed by a signal
    expect(['ok', 'superseded', 'config'].map((c) => restartable(c as never))).toEqual([false, false, false]);
    expect(restartable('transient')).toBe(true);
    expect(restartable('internal')).toBe(true);
  });

  it('FALSIFIER: no configuration fault is classified restartable (a supervisor never loops on it)', () => {
    for (const r of ['unsafe-home', 'no-safe-endpoint', 'endpoint-acl', 'sandbox-unavailable', 'quarantine-pending'] as const) {
      expect(exitCodeOfRefusal(r)).toBe(DAEMON_EXIT.config);
      expect(restartable(classifyExitCode(exitCodeOfRefusal(r)))).toBe(false);
    }
    expect(exitCodeOfRefusal('already-running')).toBe(DAEMON_EXIT.superseded);
    expect(exitCodeOfRefusal('lock-race')).toBe(DAEMON_EXIT.transient);
    expect(exitCodeOfRefusal('endpoint-busy')).toBe(DAEMON_EXIT.transient);
    expect(Object.keys(REFUSAL_EXIT_CLASS).length).toBeGreaterThanOrEqual(11);
  });

  it('the activator exits 0 for ready and attached, and keeps the child class otherwise', () => {
    const id = { schemaVersion: 'gnomonReady:v1' as const, pid: 1, startedAt: 'x', socketPath: '/s', kernelPrincipal: 'k' };
    expect(exitCodeOfLaunch({ kind: 'ready', identity: id })).toBe(0);
    expect(exitCodeOfLaunch({ kind: 'attached', socketPath: '/s', via: 'superseded' })).toBe(0);
    expect(exitCodeOfLaunch({ kind: 'exited', code: 78, signal: null, class: 'config', stderrTail: '' })).toBe(DAEMON_EXIT.config);
    expect(exitCodeOfLaunch({ kind: 'exited', code: 4, signal: null, class: 'superseded', stderrTail: '' })).toBe(DAEMON_EXIT.transient);
    expect(exitCodeOfLaunch({ kind: 'timeout', pid: 1, stderrTail: '' })).toBe(DAEMON_EXIT.transient);
  });
});

describe('§2.4 rule 2: ready line and stderr tail', () => {
  it('parses only a well-formed gnomonReady:v1 line', () => {
    expect(parseReadyLine('{"schemaVersion":"gnomonReady:v1","pid":7,"startedAt":"t","socketPath":"/s","kernelPrincipal":"k"}')?.pid).toBe(7);
    expect(parseReadyLine('{"ready":true,"pid":7}')).toBeNull();
    expect(parseReadyLine('{"schemaVersion":"gnomonReady:v1","pid":"7","startedAt":"t","socketPath":"/s","kernelPrincipal":"k"}')).toBeNull();
    expect(parseReadyLine('not json')).toBeNull();
  });

  it('the stderr tail is bounded and keeps the newest bytes', () => {
    const t = new BoundedTail(10);
    t.push(Buffer.from('0123456789'));
    t.push(Buffer.from('abcdef'));
    expect(t.text()).toBe('6789abcdef');
    expect(t.dropped).toBe(6);
    t.push(Buffer.from('x'.repeat(25)));
    expect(t.text()).toBe('x'.repeat(10));
  });

  it('the re-exec passes --ready-fd and gnomond parses it (fd >= 3 only)', () => {
    expect(reexecArgs({ entry: 'g.js', home: '/h', readyFd: 3 }).slice(-2)).toEqual(['--ready-fd', '3']);
    expect(parseDaemonArgs(['--foreground', '--ready-fd', '3'])).toMatchObject({ foreground: true, readyFd: 3 });
    expect(typeof parseDaemonArgs(['--ready-fd', '1'])).toBe('string');
    expect(reexecArgs({ entry: 'g.js', home: '/h', readyFifo: '/t/gnomon-ready-x/ready' }).slice(-2)).toEqual(['--ready-fifo', '/t/gnomon-ready-x/ready']);
    expect(parseDaemonArgs(['--foreground', '--ready-fifo', '/t/r'])).toMatchObject({ readyFifo: '/t/r' });
    expect(typeof parseDaemonArgs(['--ready-fifo', 'rel/r'])).toBe('string');
  });

  it('client verbs keep 0/1/3 and the CLI-wide usage code 64 (unchanged since PR-5)', async () => {
    expect([EXIT_REFUSED, EXIT_NOT_RUNNING, EXIT_USAGE]).toEqual([1, 3, 64]);
    const err = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      expect(await runDaemonCommand(['bogus'], '/nonexistent/gnomond.js')).toBe(64);
      expect(await runDaemonCommand(['status', '--home', 'relative'], '/nonexistent/gnomond.js')).toBe(64);
    } finally {
      err.mockRestore();
    }
  });
});
