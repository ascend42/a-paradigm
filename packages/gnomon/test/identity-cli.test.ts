// @gnomon-platform: darwin, linux
/**
 * #identity M1.3 slice 1 — `gnomon identity init | status` with the
 * in-memory FakeHelper standing in for the Secure Enclave. Provisions a real
 * (hardware-shaped) root once; refuses a second init unless an explicit,
 * confirmed, logged rotate; refuses from a kernel-spawned shell; fails
 * closed on an unsigned helper; cleans up keys on a failed provision; the
 * provisioned home opens for the daemon and its device authenticates against
 * the new root. POSIX: owner-only keys/ modes and a shebang executable.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it } from 'vitest';
import { runIdentityCommand, type IdentityDeps } from '../src/cli/identity-cli.js';
import {
  acceptUnsignedHelperForTests,
  DEV_TEST_HELPER_ACK,
  identityJournalPath,
  openHardwareIdentity,
  readIdentity,
  readRegistry,
  registryPath,
} from '../src/kernel/identity/index.js';
import { removeTree } from '../src/kernel/manifest/index.js';
import { FakeHelper } from './helper-fake.js';

const tmps: string[] = [];
function tmp(): string {
  const d = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'gnomon-idc-')));
  tmps.push(d);
  return d;
}
afterEach(() => {
  while (tmps.length) removeTree(tmps.pop()!);
});

function exe(dir: string): string {
  const f = path.join(dir, 'gnomon-helper');
  fs.writeFileSync(f, `#!${process.execPath}\n`);
  fs.chmodSync(f, 0o755);
  return f;
}

function io() {
  const out: string[] = [];
  const err: string[] = [];
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  stdout.on('data', (d) => out.push(String(d)));
  stderr.on('data', (d) => err.push(String(d)));
  return { io: { stdin: new PassThrough(), stdout, stderr }, out, err, json: () => JSON.parse(out.join('').trim().split('\n').pop()!), errJson: () => {
      const last = err.join('').trim().split('\n').pop()!;
      return JSON.parse(last.slice(last.indexOf('{')));
    } };
}

function deps(fake: FakeHelper, extra: Partial<IdentityDeps> = {}): IdentityDeps {
  // the CLI closes its helper at the end; the fake SE outlives it (as the real one does)
  const view = { request: (r: Record<string, unknown>) => fake.request(r), get alive() { return fake.alive; }, onExit: () => undefined, close: async () => undefined };
  return { env: {}, verifier: acceptUnsignedHelperForTests(DEV_TEST_HELPER_ACK), start: () => view, once: () => (req) => fake.handle(req), ...extra };
}

async function init(home: string, fake: FakeHelper, args: string[] = [], extra: Partial<IdentityDeps> = {}) {
  const o = io();
  const helper = exe(tmp());
  const code = await runIdentityCommand(['init', '--home', home, '--helper', helper, '--name', 'matt', '--host', 'mac', ...args], o.io, deps(fake, extra));
  return { code, ...o };
}

describe('gnomon identity init', () => {
  it('provisions a root once: two root signatures with presence, identity.json + a device row that resolves under the new root', async () => {
    const home = tmp();
    const fake = new FakeHelper('unused00');
    const r = await init(home, fake);
    expect(r.code).toBe(0);
    const res = r.json();
    expect(res.provisioned).toBe(true);
    expect(res.principalId).toMatch(/^p:[0-9a-z]{8}\/matt$/);
    expect(fake.prompts.length).toBe(2); // approvals binding + device row, each a fresh touch
    expect(fake.signs.every((s) => s.key === 'root' && s.mode === 'fresh')).toBe(true);
    const rec = readIdentity(home)!;
    expect(rec.rootKeyId).toBe(res.rootKeyId);
    expect((fs.statSync(path.join(home, 'keys', 'identity.json')).mode & 0o777).toString(8)).toBe('600');
    // the daemon opens it, and the device row resolves under the hardware root
    const opened = await openHardwareIdentity(home, { verifier: acceptUnsignedHelperForTests(DEV_TEST_HELPER_ACK), start: () => fake });
    const reg = readRegistry(home, opened!.root);
    expect(reg.rejected).toEqual([]);
    expect([...reg.devices.values()].map((d) => d.principalId)).toEqual([rec.principalId]);
    expect(fs.readFileSync(identityJournalPath(home), 'utf8')).toMatch(/"op":"init"/);
    // nothing secret on stdout/stderr: no PEM private part, no seed
    expect(r.out.join('') + r.err.join('')).not.toMatch(/PRIVATE KEY/);
  });

  it('falsifier: a second init is refused while a root exists', async () => {
    const home = tmp();
    const fake = new FakeHelper('unused00');
    expect((await init(home, fake)).code).toBe(0);
    const before = fs.readFileSync(path.join(home, 'keys', 'identity.json'), 'utf8');
    const r = await init(home, fake);
    expect(r.code).toBe(1);
    expect(r.errJson().reason).toBe('exists');
    expect(fs.readFileSync(path.join(home, 'keys', 'identity.json'), 'utf8')).toBe(before);
  });

  it('rotate is explicit: refused without a TTY, refused without the typed confirmation, logged and signed by the old root when confirmed', async () => {
    const home = tmp();
    const fake = new FakeHelper('unused00');
    expect((await init(home, fake)).code).toBe(0);
    const old = readIdentity(home)!;
    expect((await init(home, fake, ['--rotate'], { isTty: false })).errJson().reason).toBe('not-interactive');
    expect((await init(home, fake, ['--rotate'], { confirm: async () => 'yes' })).errJson().reason).toBe('not-confirmed');
    const r = await init(home, fake, ['--rotate'], { confirm: async () => 'rotate' });
    expect(r.code).toBe(0);
    const now = readIdentity(home)!;
    expect(now.rootKeyId).not.toBe(old.rootKeyId);
    expect(now.rotatedFrom).toBe(old.rootKeyId);
    const journal = fs.readFileSync(identityJournalPath(home), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    const rot = journal.find((j) => j.op === 'rotate');
    expect(rot.row.from).toBe(old.rootKeyId);
    expect(rot.signer).toBe(old.rootKeyId); // signed by the OLD root
    expect(r.err.join('')).toMatch(/identity\.rotate/);
    expect(fs.readdirSync(path.join(home, 'keys')).some((f) => f.startsWith('registry.jsonl.rotated-'))).toBe(true);
    expect(fake.keys.has(`${old.gen}.root`)).toBe(false); // the old SE keys are retired
    const opened = await openHardwareIdentity(home, { verifier: acceptUnsignedHelperForTests(DEV_TEST_HELPER_ACK), start: () => fake });
    expect(readRegistry(home, opened!.root).devices.size).toBe(1);
    expect(fs.existsSync(registryPath(home))).toBe(true);
  });

  it('falsifier: refused from a kernel-spawned shell (GNOMON_HSID)', async () => {
    const fake = new FakeHelper('unused00');
    const r = await init(tmp(), fake, [], { env: { GNOMON_HSID: 'hs:x' } });
    expect(r.errJson().reason).toBe('forbidden');
    expect(fake.keys.size).toBe(2); // nothing created
  });

  it('falsifier: an unsigned or missing helper fails closed before any key exists', async () => {
    const home = tmp();
    const fake = new FakeHelper('unused00');
    const o = io();
    const code = await runIdentityCommand(['init', '--home', home, '--helper', exe(tmp())], o.io, { env: {}, start: () => fake }); // production verifier
    expect(code).toBe(1);
    expect(o.errJson().reason).toBe('helper-unavailable');
    const o2 = io();
    expect(await runIdentityCommand(['init', '--home', home, '--helper', path.join(tmp(), 'none')], o2.io, deps(fake))).toBe(1);
    expect(o2.errJson().reason).toBe('helper-unavailable');
    expect(readIdentity(home)).toBeNull();
  });

  it('a declined touch leaves no identity and deletes the keys it created', async () => {
    const home = tmp();
    const fake = new FakeHelper('unused00', { touch: false });
    const r = await init(home, fake);
    expect(r.code).toBe(1);
    expect(r.errJson().reason).toBe('provision-failed');
    expect(readIdentity(home)).toBeNull();
    expect(fake.keys.size).toBe(2); // only the constructor's keys remain
  });

  it('status reports unprovisioned, then hardware', async () => {
    const home = tmp();
    const o = io();
    await runIdentityCommand(['status', '--home', home], o.io);
    expect(o.json().state).toBe('unprovisioned');
    await init(home, new FakeHelper('unused00'));
    const o2 = io();
    await runIdentityCommand(['status', '--home', home], o2.io);
    expect(o2.json().state).toBe('hardware');
  });
});
