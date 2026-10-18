// @gnomon-platform: darwin, linux
/**
 * `gnomon log quarantine` CLI cases that COMPLETE a quarantine
 * (T-2026-10-17-009(a)): the successor home's kernel pub is recorded into an
 * owner-only `keys/` dir, which #identity checks with POSIX modes. On Windows
 * owner-only is an ACL via the helper of the Windows parity phase (P8-D78,
 * spec §16); until then these cases are registered darwin/linux in
 * test/platform-registry.ts. The refusal/readout cases that never write a key
 * run everywhere in test/log-cli.test.ts.
 */
import { mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it } from 'vitest';
import { runLogCommand, type LogCliIo } from '../src/cli/log-cli.js';
import { DatabaseSync } from 'node:sqlite';
import { kernelPrincipalOf } from '../src/kernel/lifecycle/index.js';
import { KernelLog, readQuarantineIdentity, SoftwareEd25519Signer, type QuarantineOptions } from '../src/kernel/log/index.js';
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

describe('gnomon log quarantine (CLI): completing a quarantine (owner-only keys/, POSIX)', () => {
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
});
