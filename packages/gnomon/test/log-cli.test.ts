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
import { acquireDaemonLock, releaseDaemonLock } from '../src/kernel/lifecycle/index.js';
import { KernelLog, readQuarantineIdentity, SoftwareEd25519Signer } from '../src/kernel/log/index.js';

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
});
