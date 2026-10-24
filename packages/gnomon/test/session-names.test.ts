/**
 * #session-names (8.0:session-rename): the human's request.session.rename{hsid, name}. Validation and the contracts
 * normalisation, the owner check, reset-on-empty, and the fold that makes a name survive a replay (the kernel log is
 * the only store). The socket path and a real kernel restart are in socket-abi.test.ts.
 */
import * as fs from 'node:fs';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { sanitizeDisplayText, SESSION_NAME_MAX } from '@a-company/gnomon-contracts';
import { KernelLog, SoftwareEd25519Signer } from '../src/kernel/log/index.js';
import { SessionNames, SESSION_NAME_SEED_KINDS, type NameRow, type RenameAsker } from '../src/kernel/supervisor/session-names.js';
import { RpcRefusal } from '../src/kernel/socket/rpc.js';
import { HSID, HSID2, HUMAN, KERNEL } from './desk-fixtures.js';
import { startDaemon, kernelPrincipalOf } from '../src/kernel/lifecycle/index.js';
import { loadDevHome, provisionDevHome } from '../src/cli/dev-home.js';
import { recordKernelPub } from '../src/kernel/identity/index.js';
import { KeyRing } from '../src/kernel/log/index.js';
import { openKernelLog } from '../src/kernel/testing.js';
import { runSessionCommand } from '../src/cli/session-cli.js';
import { tempHome } from './daemon-helpers.js';

const GUI: RenameAsker = { connId: 'conn:01J00000000000000000000000', principal: HUMAN, principalClass: 'human', credential: 'gui' };
const open = (hsid: string, by: string, principal = KERNEL): NameRow => ({ kind: 'session.open', principal, session: hsid, payload: { hsid, by, cwd: '/tmp/x' } });

function rig() {
  const written: Array<{ kind: string; payload: Record<string, unknown> }> = [];
  const names = new SessionNames({ kernelPrincipal: KERNEL, append: async (kind, payload) => void written.push({ kind, payload }) });
  names.seed([open(HSID, HUMAN), open(HSID2, 'p:zzzzzzzz/other')]);
  return { names, written };
}
async function refusal(p: Promise<unknown>): Promise<RpcRefusal> {
  const e = await p.then(() => undefined, (x: unknown) => x);
  expect(e).toBeInstanceOf(RpcRefusal);
  return e as RpcRefusal;
}

describe('#session-names: the request', () => {
  it('writes request.session.rename then session.renamed with the normalised name; nameOf / namesFor show it', async () => {
    const t = rig();
    expect(await t.names.rename(GUI, { hsid: HSID, name: '  Fix   the build ' })).toEqual({ hsid: HSID, name: 'Fix the build', changed: true });
    expect(t.written).toEqual([
      { kind: 'request.session.rename', payload: { hsid: HSID, name: 'Fix the build' } },
      { kind: 'session.renamed', payload: { hsid: HSID, name: 'Fix the build' } },
    ]);
    expect(t.names.nameOf(HSID)).toBe('Fix the build');
    expect(t.names.namesFor(HUMAN)).toEqual([{ hsid: HSID, name: 'Fix the build' }]);
    expect(t.names.namesFor('p:zzzzzzzz/other')).toEqual([]);
    // the same name again is not a change (still logged: the human asked)
    expect(await t.names.rename(GUI, { hsid: HSID, name: 'Fix the build' })).toMatchObject({ changed: false });
  });
  it('sanitises with the ONE §4.5 sanitizer (invisible characters stripped, bidi controls visible)', async () => {
    const t = rig();
    const r = await t.names.rename(GUI, { hsid: HSID, name: 'pay​ment ‮evil' });
    expect(r.name).toBe(`payment ${sanitizeDisplayText('‮').text}evil`);
  });
  it("'' (or only whitespace) resets to the derived title", async () => {
    const t = rig();
    await t.names.rename(GUI, { hsid: HSID, name: 'Named' });
    expect(await t.names.rename(GUI, { hsid: HSID, name: ' \t ' })).toEqual({ hsid: HSID, name: null, changed: true });
    expect(t.written.at(-1)).toEqual({ kind: 'session.renamed', payload: { hsid: HSID, name: '' } });
    expect(t.names.nameOf(HSID)).toBeNull();
    expect(t.names.namesFor(HUMAN)).toEqual([]);
  });
  it('refuses a bad name with no row: too long, a control character, a format character, a non-string', async () => {
    const t = rig();
    for (const name of ['x'.repeat(SESSION_NAME_MAX + 1), 'a\u0000b', 'a\u001b[31mred', 'a؀b', 42, null]) {
      const e = await refusal(t.names.rename(GUI, { hsid: HSID, name }));
      expect(e.refusal.code, String(name)).toBe('BAD_REQUEST');
      expect(e.refusal.data).toMatchObject({ reason: 'bad-params', field: 'name' });
    }
    expect(await t.names.rename(GUI, { hsid: HSID, name: 'x'.repeat(SESSION_NAME_MAX) })).toMatchObject({ changed: true });
    expect(t.written).toHaveLength(2);
  });
  it('refuses a payload outside {hsid, name} and a malformed hsid', async () => {
    const t = rig();
    for (const p of [{ hsid: HSID, name: 'a', route: 'x' }, { hsid: 'nope', name: 'a' }, { name: 'a' }, [], 'x', null]) {
      expect((await refusal(t.names.rename(GUI, p))).refusal.code).toBe('BAD_REQUEST');
    }
    expect(t.written).toEqual([]);
  });
  it("human only, on a gui or device connection; another human's or an unknown session is NOT_FOUND", async () => {
    const t = rig();
    for (const a of [{ ...GUI, principalClass: 'agent' }, { ...GUI, credential: 'read-token' }, { ...GUI, credential: undefined }, { ...GUI, principal: undefined }]) {
      expect((await refusal(t.names.rename(a, { hsid: HSID, name: 'a' }))).refusal.code).toBe('FORBIDDEN');
    }
    expect((await refusal(t.names.rename({ ...GUI, credential: 'device' }, { hsid: HSID2, name: 'a' }))).refusal.code).toBe('NOT_FOUND');
    expect((await refusal(t.names.rename(GUI, { hsid: 'hsid:v1:01J000000000000000000000ZZ', name: 'a' }))).refusal.code).toBe('NOT_FOUND');
    expect(t.written).toEqual([]);
  });
});

describe('#session-names: the fold', () => {
  it('only the kernel principal\'s rows count, and a malformed session.renamed is ignored', () => {
    const n = new SessionNames({ kernelPrincipal: KERNEL, append: async () => undefined });
    n.seed([
      open(HSID, HUMAN, 'p:agent/claude'),
      { kind: 'session.renamed', principal: 'p:agent/claude', payload: { hsid: HSID, name: 'forged' } },
      open(HSID2, HUMAN),
      { kind: 'session.renamed', principal: KERNEL, payload: { hsid: HSID2, name: ' not normalised' } },
    ]);
    expect(n.nameOf(HSID)).toBeNull();
    expect(n.nameOf(HSID2)).toBeNull();
    expect(n.namesFor(HUMAN)).toEqual([]);
  });
  it('survives a replay: the rows go on a real kernel log, a fresh fold seeded from log.read has the last name', async () => {
    const parent = mkdtempSync(path.join(os.tmpdir(), 'gnomon-names-'));
    try {
      const home = path.join(parent, '.gnomon');
      mkdirSync(home, { mode: 0o700 });
      const signer = SoftwareEd25519Signer.generate();
      const log = KernelLog.open({ home, kernelPrincipal: KERNEL, signer });
      const names = new SessionNames({ kernelPrincipal: KERNEL, append: (kind, payload, ids) => log.append({ kind, principal: KERNEL, payload: { ...payload }, session: ids.session, connId: ids.connId }).then(() => undefined) });
      for (const h of [HSID, HSID2]) {
        const row = open(h, HUMAN);
        await log.append({ kind: row.kind, principal: KERNEL, session: h, payload: row.payload as Record<string, unknown> });
        names.observe(row);
      }
      await names.rename(GUI, { hsid: HSID, name: 'First' });
      await names.rename(GUI, { hsid: HSID, name: 'Second' });
      await names.rename(GUI, { hsid: HSID2, name: 'Gone soon' });
      await names.rename(GUI, { hsid: HSID2, name: '' });
      // a payload outside the closed check never reaches the chain (checked at append)
      await expect(log.append({ kind: 'session.renamed', principal: KERNEL, session: HSID, payload: { hsid: HSID, name: 'two  spaces' } })).rejects.toThrow();
      await log.close();
      const again = KernelLog.open({ home, kernelPrincipal: KERNEL, signer });
      const fresh = new SessionNames({ kernelPrincipal: KERNEL, append: async () => undefined });
      const seed: NameRow[] = [];
      for (const v of again.read({ reader: { class: 'human' }, kinds: SESSION_NAME_SEED_KINDS })) if (v.view === 'full') seed.push({ kind: v.event.kind, principal: v.event.principal, payload: v.event.payload });
      fresh.seed(seed);
      expect(fresh.nameOf(HSID)).toBe('Second');
      expect(fresh.nameOf(HSID2)).toBeNull();
      // the fold knows the owner again: the human can rename after the restart
      await expect(fresh.rename(GUI, { hsid: HSID2, name: 'Back' })).resolves.toMatchObject({ name: 'Back' });
      await again.close();
    } finally {
      rmSync(parent, { recursive: true, force: true });
    }
  });
});

describe('gnomon session rename (the raw form)', () => {
  const io = () => {
    const out: string[] = [];
    const err: string[] = [];
    return { out, err, io: { stdin: process.stdin, stdout: { write: (x: string) => (out.push(x), true) }, stderr: { write: (x: string) => (err.push(x), true) } } };
  };
  it('names the human\'s session over the socket, resets on "", refuses a bad name, an unknown hsid and bad usage', async () => {
    const t = tempHome('rn-');
    try {
      fs.mkdirSync(path.dirname(t.home), { recursive: true });
      const userHome = fs.realpathSync.native(path.dirname(t.home));
      const home = path.join(userHome, 'devhome');
      provisionDevHome(home, { userHome });
      const l = loadDevHome(home, { userHome });
      const K = kernelPrincipalOf(l.root);
      recordKernelPub(home, l.kernelKey.publicKeyPem);
      const ring = new KeyRing();
      ring.addEd25519(l.kernelKey.publicKeyPem);
      const log = openKernelLog({ home, kernelPrincipal: K, signer: l.kernel, keyRing: ring });
      await log.append({ kind: 'session.open', principal: K, session: HSID, payload: { hsid: HSID, by: l.device.principalId, cwd: '/tmp/x' } });
      await log.close();
      const down = io();
      expect(await runSessionCommand(['rename', HSID, 'x', '--home', home], down.io)).toBe(1);
      expect(down.err.join('')).toContain('not-running');
      const d = await startDaemon({ home, idleMs: 60_000, kernelSigner: l.kernel, rootAuthority: l.root });
      try {
        const ok = io();
        expect(await runSessionCommand(['rename', '--home', home, '--json', HSID, '  Fix the   build '], ok.io)).toBe(0);
        expect(JSON.parse(ok.out.join(''))).toEqual({ hsid: HSID, name: 'Fix the build', changed: true });
        const txt = io();
        expect(await runSessionCommand(['rename', HSID, '--home', home, '--', '-draft'], txt.io)).toBe(0);
        expect(txt.out.join('')).toContain(`RENAMED  ${HSID}: -draft`);
        const reset = io();
        expect(await runSessionCommand(['rename', HSID, '', '--home', home], reset.io)).toBe(0);
        expect(reset.out.join('')).toContain('back to the derived title');
        const bad = io();
        expect(await runSessionCommand(['rename', HSID, 'x'.repeat(SESSION_NAME_MAX + 1), '--home', home], bad.io)).toBe(1);
        expect(bad.err.join('')).toContain('BAD_REQUEST');
        const unknown = io();
        expect(await runSessionCommand(['rename', HSID2, 'x', '--home', home], unknown.io)).toBe(1);
        expect(unknown.err.join('')).toContain('NOT_FOUND');
        const usage = io();
        expect(await runSessionCommand(['rename', HSID, '--home', home], usage.io)).toBe(64);
      } finally {
        await d.shutdown('signal');
      }
    } finally {
      t.cleanup();
    }
  }, 60_000);
});
