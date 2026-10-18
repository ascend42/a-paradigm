/**
 * `gnomon log quarantine` CLI (T-2026-10-17-009(a)): the interactive-TTY human
 * gate (residual until presence lands, M1.3), the instrument-readout voice
 * (`REFUSED  CODE  reason`, indented `next:`), refusal while the daemon runs,
 * no --yes. Platform-independent: streams are injected. The cases that
 * complete a quarantine (they write the successor's kernel pub into an
 * owner-only keys/ dir, POSIX modes) live in test/log-cli-quarantine-posix.test.ts
 * (G-WIN-05 registry row; Windows parity phase P8-D78).
 */
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it } from 'vitest';
import { LOG_USAGE, runLogCommand, type LogCliIo } from '../src/cli/log-cli.js';
import { acquireDaemonLock, releaseDaemonLock } from '../src/kernel/lifecycle/index.js';
import { FileAnchorStore, KernelLog, readQuarantineIdentity, SoftwareEd25519Signer } from '../src/kernel/log/index.js';

const parents: string[] = [];
afterEach(() => {
  for (const p of parents.splice(0)) rmSync(p, { recursive: true, force: true });
});

async function home(): Promise<string> {
  const parent = mkdtempSync(path.join(os.tmpdir(), 'gnomon-qcli-'));
  parents.push(parent);
  const h = path.join(parent, '.gnomon');
  mkdirSync(h, { mode: 0o700 });
  const log = KernelLog.open({ home: h, kernelPrincipal: 'p:00000000/kernel', signer: SoftwareEd25519Signer.generate() });
  await log.append({ kind: 'session.open', principal: 'p:00000000/kernel' });
  await log.close();
  return h;
}

function io(tty: boolean, answer?: string): LogCliIo & { out: () => string; err: () => string } {
  const stdin = Object.assign(new PassThrough(), { isTTY: tty });
  if (answer !== undefined) stdin.end(`${answer}\n`);
  else stdin.end();
  let o = '';
  let e = '';
  return {
    stdin,
    stdout: { isTTY: tty, write: (c: string) => (o += c) },
    stderr: { write: (c: string) => (e += c) },
    out: () => o,
    err: () => e,
  };
}

describe('gnomon log quarantine (CLI)', () => {
  it('refuses without an interactive terminal: REFUSED  FORBIDDEN  not-interactive, indented next:', async () => {
    const h = await home();
    const t = io(false, 'whatever');
    expect(await runLogCommand(['quarantine', '--home', h], t)).toBe(1);
    expect(t.err()).toMatch(/^REFUSED {2}FORBIDDEN {2}not-interactive\n {2}.+\n {2}next: /);
    expect(readdirSync(path.dirname(h))).toEqual(['.gnomon']);
  });

  it('a wrong confirmation refuses not-confirmed and moves nothing', async () => {
    const h = await home();
    const t = io(true, 'nope');
    expect(await runLogCommand(['quarantine', '--home', h], t)).toBe(1);
    expect(t.out()).toContain('QUARANTINE');
    expect(t.err()).toMatch(/^REFUSED {2}FORBIDDEN {2}not-confirmed\n/);
    expect(readdirSync(path.dirname(h))).toEqual(['.gnomon']);
  });

  it('refuses while the daemon is running (pidfile), before asking anything', async () => {
    const h = await home();
    const pid = acquireDaemonLock(h, process.pid, { socketPath: path.join(h, 'gnomon.sock') });
    try {
      const t = io(true, readQuarantineIdentity(h)!.log.slice(-8));
      expect(await runLogCommand(['quarantine', '--home', h], t)).toBe(1);
      expect(t.err()).toMatch(/^REFUSED {2}FORBIDDEN {2}daemon-running\n/);
      expect(t.out()).toBe('');
    } finally {
      releaseDaemonLock(h, pid);
    }
    expect(existsSync(h)).toBe(true);
  });

  it('there is no --yes; the help states the M1.3 presence residual', async () => {
    const h = await home();
    const t = io(true);
    expect(await runLogCommand(['quarantine', '--home', h, '--yes'], t)).toBe(64);
    expect(t.err()).toMatch(/^REFUSED {2}BAD_REQUEST {2}usage\n.*there is no --yes/);
    expect(LOG_USAGE).toMatch(/M1\.3/);
    expect(LOG_USAGE).toMatch(/same-user process/);
  });

  it('shows every observed head and a disagreement WARNING before the prompt (anchor ahead of a truncated db)', async () => {
    const h = await home();
    const fa = new FileAnchorStore(h);
    const head = (fa.read() as { head: Parameters<FileAnchorStore['write']>[0] }).head;
    fa.write({ ...head, seq: head.seq + 5, hash: `sha256:${'cd'.repeat(32)}` }, true);
    const t = io(true, 'nope');
    await runLogCommand(['quarantine', '--home', h], t);
    const out = t.out();
    expect(out).toMatch(/ {4}db +seq 1 /);
    expect(out).toMatch(/ {4}file-anchor +seq 6 /);
    expect(out.indexOf('WARNING')).toBeGreaterThan(0);
    expect(out.indexOf('WARNING')).toBeLessThan(out.indexOf('type the last 8'));
  });

  it('nothing-to-quarantine has a next: step', async () => {
    const parent = mkdtempSync(path.join(os.tmpdir(), 'gnomon-qcli-'));
    parents.push(parent);
    const t = io(true);
    expect(await runLogCommand(['quarantine', '--home', parent], t)).toBe(1);
    expect(t.err()).toMatch(/^REFUSED {2}BAD_REQUEST {2}nothing-to-quarantine\n {2}.+\n {2}next: /);
  });

  it('an unreadable db is shown in the readout as unreadable (copy failed …)', async () => {
    const h = await home();
    const { renameSync } = await import('node:fs');
    renameSync(path.join(h, 'kernel.db'), path.join(path.dirname(h), 'aside.db'));
    mkdirSync(path.join(h, 'kernel.db'));
    const t = io(true, 'nope');
    await runLogCommand(['quarantine', '--home', h], t);
    expect(t.out()).toMatch(/ {4}db +unreadable \(copy failed: E[A-Z]+\)/);
  });
});
