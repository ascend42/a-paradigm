/**
 * `gnomon log quarantine` CLI (T-2026-10-17-009(a)): the interactive-TTY human
 * gate (residual until presence lands, M1.3), the instrument-readout voice
 * (`REFUSED  CODE  reason`, indented `next:`), refusal while the daemon runs,
 * no --yes. Platform-independent: streams are injected.
 */
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it } from 'vitest';
import { LOG_USAGE, runLogCommand, type LogCliIo } from '../src/cli/log-cli.js';
import { DatabaseSync } from 'node:sqlite';
import { acquireDaemonLock, kernelPrincipalOf, releaseDaemonLock } from '../src/kernel/lifecycle/index.js';
import { FileAnchorStore, KernelLog, readQuarantineIdentity, SoftwareEd25519Signer, type QuarantineOptions } from '../src/kernel/log/index.js';
import { quarantineWithSteps } from '../src/kernel/testing.js';

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

  it('the typed last 8 characters of the log id quarantine the home; the readout names the evidence and the genesis', async () => {
    const h = await home();
    const id = readQuarantineIdentity(h)!;
    const t = io(true, id.log.slice(-8));
    expect(await runLogCommand(['quarantine', '--home', h], t)).toBe(0);
    expect(t.out()).toMatch(new RegExp(`QUARANTINED {2}${id.log}\\n`));
    expect(t.out()).toMatch(/ {2}genesis +seq 1 {2}daemon\.log\.quarantined/);
    expect(readdirSync(path.dirname(h)).filter((n) => n.startsWith('.gnomon.quarantine-'))).toHaveLength(1);
    expect(readQuarantineIdentity(h)!.log).not.toBe(id.log);
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

  it('after a crash between the renames, a re-run reports COMPLETED (exit 0) with the evidence and next:', async () => {
    const h = await home();
    const o: QuarantineOptions = { home: h, signer: SoftwareEd25519Signer.generate(), kernelPrincipal: kernelPrincipalOf(), authorizedBy: 'interactive-confirm' };
    await expect(
      quarantineWithSteps(o, (s) => {
        if (s === 'moved') throw new Error('crash');
      }),
    ).rejects.toThrow();
    const t = io(true);
    expect(await runLogCommand(['quarantine', '--home', h], t)).toBe(0);
    expect(t.out()).toMatch(/^COMPLETED {2}interrupted quarantine installed\n/);
    expect(t.out()).toMatch(/ {2}evidence +\.gnomon\.quarantine-\S+ {2}\(/);
    expect(t.out()).toMatch(/\n {2}next: re-run/);
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

  it("nothing-to-quarantine has a next: step; the genesis principal is the daemon's (kernelPrincipalOf)", async () => {
    const parent = mkdtempSync(path.join(os.tmpdir(), 'gnomon-qcli-'));
    parents.push(parent);
    const t = io(true);
    expect(await runLogCommand(['quarantine', '--home', parent], t)).toBe(1);
    expect(t.err()).toMatch(/^REFUSED {2}BAD_REQUEST {2}nothing-to-quarantine\n {2}.+\n {2}next: /);
    const h = await home();
    const t2 = io(true, readQuarantineIdentity(h)!.log.slice(-8));
    expect(await runLogCommand(['quarantine', '--home', h], t2)).toBe(0);
    const db = new DatabaseSync(path.join(h, 'kernel.db'), { readOnly: true });
    try {
      expect((db.prepare('SELECT principal FROM chain WHERE seq = 1').get() as { principal: string }).principal).toBe(kernelPrincipalOf());
    } finally {
      db.close();
    }
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
