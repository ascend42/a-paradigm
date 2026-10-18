// @gnomon-platform: darwin, linux
/**
 * #identity M1.3 slice 1 — `gnomon identity init | status | purge-keys` with
 * the in-memory FakeHelper standing in for the Secure Enclave. Round 2: rotate
 * needs the OLD root's signature (H4), `--recover` for a lost root starts a
 * new namespace, init refuses while the SE holds another generation, a failed
 * rotate restores what it moved (R2), a failed first init leaves no registry
 * row (R3), cleanup goes through a fresh helper when the old one died and on
 * an interrupt (R4). POSIX: owner-only keys/ modes and a shebang executable.
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
  identityPath,
  openHardwareIdentity,
  readIdentity,
  readRegistry,
  registryPath,
  type HelperTransport,
} from '../src/kernel/identity/index.js';
import { removeTree } from '../src/kernel/manifest/index.js';
import { FakeHelper } from './helper-fake.js';

const DEV = acceptUnsignedHelperForTests(DEV_TEST_HELPER_ACK);
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
  return {
    io: { stdin: new PassThrough(), stdout, stderr },
    out,
    err,
    json: () => JSON.parse(out.join('').trim().split('\n').pop()!),
    errJson: () => {
      const last = err.join('').trim().split('\n').pop()!;
      return JSON.parse(last.slice(last.indexOf('{')));
    },
  };
}

/** The CLI closes its helper at the end; the fake SE outlives it. A start after a crash is a FRESH helper process. */
function deps(fake: FakeHelper, extra: Partial<IdentityDeps> = {}): IdentityDeps {
  const view: HelperTransport = {
    request: (r) => fake.request(r),
    get alive() {
      return fake.alive;
    },
    onExit: () => undefined,
    close: async () => undefined,
  };
  return {
    env: {},
    verifier: DEV,
    handleSignals: false,
    start: () => {
      fake.revive(); // every start is a new helper process over the same SE
      return view;
    },
    once: () => (req) => fake.handle(req),
    ...extra,
  };
}

async function run(home: string, fake: FakeHelper, args: string[] = [], extra: Partial<IdentityDeps> = {}) {
  const o = io();
  const code = await runIdentityCommand(['init', '--home', home, '--helper', exe(tmp()), '--name', 'matt', '--host', 'mac', ...args], o.io, deps(fake, extra));
  return { code, ...o };
}

const opened = (home: string, fake: FakeHelper) => openHardwareIdentity(home, { verifier: DEV, start: () => fake });

describe('gnomon identity init', () => {
  it('provisions a root once: two root touches, each prompt naming the digest the helper line shows; the device resolves under the new root', async () => {
    const home = tmp();
    const fake = new FakeHelper(null);
    const r = await run(home, fake);
    expect(r.code).toBe(0);
    const res = r.json();
    expect(res.mode).toBe('init');
    expect(fake.prompts.length).toBe(2);
    expect(fake.signs.every((s) => s.key === 'root' && s.mode === 'fresh')).toBe(true);
    // H3: what stderr told the human to look for is what the helper line shows
    const told = [...r.err.join('').matchAll(/must end with ([0-9a-f]{12})/g)].map((m) => m[1]);
    expect(told.length).toBe(2);
    told.forEach((d, i) => expect(fake.shown[i]!.endsWith(d!)).toBe(true));
    const rec = readIdentity(home)!;
    expect((fs.statSync(identityPath(home)).mode & 0o777).toString(8)).toBe('600');
    const reg = readRegistry(home, (await opened(home, fake))!.root);
    expect(reg.rejected).toEqual([]);
    expect([...reg.devices.values()].map((d) => d.principalId)).toEqual([rec.principalId]);
    expect(fs.readFileSync(identityJournalPath(home), 'utf8')).toMatch(/"op":"init"/);
    expect(r.out.join('') + r.err.join('')).not.toMatch(/PRIVATE KEY/);
  });

  it('falsifier (H4): init refuses while the Secure Enclave holds keys of another generation', async () => {
    const fake = new FakeHelper('stale001');
    const r = await run(tmp(), fake);
    expect(r.code).toBe(1);
    expect(r.errJson()).toMatchObject({ reason: 'keys-exist', gens: ['stale001'] });
    expect(fake.keys.size).toBe(2);
  });

  it('falsifier: a second init is refused while a root exists', async () => {
    const home = tmp();
    const fake = new FakeHelper(null);
    expect((await run(home, fake)).code).toBe(0);
    const before = fs.readFileSync(identityPath(home), 'utf8');
    const r = await run(home, fake);
    expect(r.errJson().reason).toBe('exists');
    expect(fs.readFileSync(identityPath(home), 'utf8')).toBe(before);
  });

  it('rotate: needs a TTY and the typed word; the OLD root signs the statement the helper demands; logged; old keys retired, not deleted', async () => {
    const home = tmp();
    const fake = new FakeHelper(null);
    expect((await run(home, fake)).code).toBe(0);
    const old = readIdentity(home)!;
    expect((await run(home, fake, ['--rotate'], { isTty: false })).errJson().reason).toBe('not-interactive');
    expect((await run(home, fake, ['--rotate'], { confirm: async () => 'yes' })).errJson().reason).toBe('not-confirmed');
    fake.prompts = [];
    const r = await run(home, fake, ['--rotate'], { confirm: async () => 'rotate' });
    expect(r.code).toBe(0);
    expect(fake.prompts.length).toBe(3); // old root + approvals binding + device
    const now = readIdentity(home)!;
    expect(now.rotatedFrom).toBe(old.rootKeyId);
    expect(now.ns).not.toBe(old.ns);
    const rot = fs.readFileSync(identityJournalPath(home), 'utf8').trim().split('\n').map((l) => JSON.parse(l)).find((j) => j.op === 'rotate');
    expect(rot).toMatchObject({ signer: old.rootKeyId, row: { fromGen: old.gen, toGen: now.gen } });
    expect(r.json()).toMatchObject({ retiredGen: old.gen, purge: `gnomon identity purge-keys --gen ${old.gen}` });
    expect(fake.keys.has(`${old.gen}.root`)).toBe(true);
    expect(fs.readdirSync(path.join(home, 'keys')).some((f) => f.startsWith('registry.jsonl.rotated-'))).toBe(true);
    expect(readRegistry(home, (await opened(home, fake))!.root).devices.size).toBe(1);
  });

  it('rotate offers to purge the old generation in the same run (one touch per key); declining keeps it', async () => {
    const home = tmp();
    const fake = new FakeHelper(null);
    expect((await run(home, fake)).code).toBe(0);
    const old = readIdentity(home)!;
    const r = await run(home, fake, ['--rotate'], { confirm: async () => 'rotate', confirmPurge: async () => 'purge' });
    expect(r.json()).toMatchObject({ retiredGen: old.gen, purgedOld: ['approvals', 'root'] });
    expect(fake.keys.has(`${old.gen}.root`)).toBe(false);
    const mid = readIdentity(home)!;
    const r2 = await run(home, fake, ['--rotate'], { confirm: async () => 'rotate', confirmPurge: async () => 'no' });
    expect(r2.json()).toMatchObject({ retiredGen: mid.gen, purge: `gnomon identity purge-keys --gen ${mid.gen}` });
    expect(fake.keys.has(`${mid.gen}.root`)).toBe(true);
  });

  it('falsifier (H4): rotate refuses when the old root is not in the Secure Enclave (no unsigned rotation)', async () => {
    const home = tmp();
    const fake = new FakeHelper(null);
    expect((await run(home, fake)).code).toBe(0);
    const old = readIdentity(home)!;
    fake.keys.delete(`${old.gen}.root`);
    fake.keys.delete(`${old.gen}.approvals`);
    const r = await run(home, fake, ['--rotate'], { confirm: async () => 'rotate' });
    expect(r.errJson().reason).toBe('old-root-missing');
    expect(readIdentity(home)!.rootKeyId).toBe(old.rootKeyId);
  });

  it('falsifier (H2): the helper refuses a new generation whose rotate statement the old root did not sign', async () => {
    const fake = new FakeHelper('test0001');
    await expect(fake.request({ op: 'key.create', key: 'root', gen: 'next0001' })).rejects.toMatchObject({ code: 'other-generation' });
    await expect(fake.request({ op: 'key.create', key: 'root', gen: 'next0001', rotate: { fromGen: 'test0001', statement: 'eA==', sig: 'eA==' } })).rejects.toMatchObject({ code: 'rotate-refused' });
  });

  it('--recover: a lost root starts a NEW namespace, logged as not signed by it; refused while the old keys are still there', async () => {
    const home = tmp();
    const fake = new FakeHelper(null);
    expect((await run(home, fake)).code).toBe(0);
    const old = readIdentity(home)!;
    expect((await run(home, fake, ['--recover'], { confirm: async () => 'recover' })).errJson().reason).toBe('old-root-present');
    fake.keys.clear(); // the Secure Enclave lost them
    const r = await run(home, fake, ['--recover'], { confirm: async () => 'recover' });
    expect(r.code).toBe(0);
    const now = readIdentity(home)!;
    expect(now.recoveredFrom).toBe(old.rootKeyId);
    expect(now.ns).not.toBe(old.ns);
    const j = fs.readFileSync(identityJournalPath(home), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    expect(j.find((x) => x.op === 'recover')).toMatchObject({ lostRoot: old.rootKeyId, signedByLostRoot: false });
    expect(r.err.join('')).toMatch(/identity\.recover/);
  });

  it('R2: a rotate that fails before the record is written restores identity.json and the registry byte for byte, and removes its new keys', async () => {
    const home = tmp();
    const fake = new FakeHelper(null);
    expect((await run(home, fake)).code).toBe(0);
    const idBefore = fs.readFileSync(identityPath(home), 'utf8');
    const regBefore = fs.readFileSync(registryPath(home), 'utf8');
    const keysBefore = [...fake.keys.keys()].sort();
    fake.opts.touchesAllowed = 2; // old root + approvals binding, then the device touch is declined
    const r = await run(home, fake, ['--rotate'], { confirm: async () => 'rotate' });
    expect(r.errJson()).toMatchObject({ reason: 'provision-failed', recordWritten: false });
    expect(fs.readFileSync(identityPath(home), 'utf8')).toBe(idBefore);
    expect(fs.readFileSync(registryPath(home), 'utf8')).toBe(regBefore);
    expect([...fake.keys.keys()].sort()).toEqual(keysBefore);
  });

  it('R3: a first init declined at the device touch leaves no identity, no registry row and no keys', async () => {
    const home = tmp();
    const fake = new FakeHelper(null, { touchesAllowed: 1 });
    const r = await run(home, fake);
    expect(r.errJson()).toMatchObject({ reason: 'provision-failed', createdKeysDeleted: ['root', 'approvals'] });
    expect(readIdentity(home)).toBeNull();
    expect(fs.existsSync(registryPath(home))).toBe(false);
    expect(fake.keys.size).toBe(0);
  });

  it('R4: when the helper dies mid-init, the keys are removed through a FRESH helper (which asks for presence)', async () => {
    const home = tmp();
    const fake = new FakeHelper(null, { crashOn: 'key.create:approvals' });
    const r = await run(home, fake);
    expect(r.code).toBe(1);
    expect(fake.keys.size).toBe(0);
    expect(fake.prompts.some((p) => /failed identity init/.test(p))).toBe(true);
  });

  it('R4: a declined cleanup prompt reports the leftover generation and the purge command', async () => {
    const home = tmp();
    const fake = new FakeHelper(null, { crashOn: 'key.create:approvals', touch: false });
    const r = await run(home, fake);
    const e = r.errJson();
    expect(e.leftoverGen).toMatch(/^[a-z0-9]{12}$/);
    expect(e.purge).toBe(`gnomon identity purge-keys --gen ${e.leftoverGen}`);
  });

  it('R4: an interrupt stops at the next step and cleans up', async () => {
    const home = tmp();
    const fake = new FakeHelper(null);
    let n = 0;
    const r = await run(home, fake, [], { interrupt: () => fake.prompts.length > 0 && ++n > 0 });
    expect(r.errJson().reason).toBe('interrupted');
    expect(readIdentity(home)).toBeNull();
    expect(fake.keys.size).toBe(0);
  });

  it('falsifier: refused from a kernel-spawned shell (hygiene; presence is the boundary)', async () => {
    const fake = new FakeHelper(null);
    expect((await run(tmp(), fake, [], { env: { GNOMON_HSID: 'hs:x' } })).errJson().reason).toBe('forbidden');
  });

  it('falsifier: an unsigned or missing helper fails closed before any key exists', async () => {
    const home = tmp();
    const fake = new FakeHelper(null);
    const o = io();
    expect(await runIdentityCommand(['init', '--home', home, '--helper', exe(tmp())], o.io, { env: {}, handleSignals: false, start: () => fake })).toBe(1);
    expect(o.errJson().reason).toBe('helper-unavailable');
    const o2 = io();
    expect(await runIdentityCommand(['init', '--home', home, '--helper', path.join(tmp(), 'none')], o2.io, deps(fake))).toBe(1);
    expect(o2.errJson().reason).toBe('helper-unavailable');
    expect(readIdentity(home)).toBeNull();
    expect(fake.keys.size).toBe(0);
  });

  it('status reports unprovisioned, then hardware', async () => {
    const home = tmp();
    const o = io();
    await runIdentityCommand(['status', '--home', home], o.io);
    expect(o.json().state).toBe('unprovisioned');
    await run(home, new FakeHelper(null));
    const o2 = io();
    await runIdentityCommand(['status', '--home', home], o2.io);
    expect(o2.json().state).toBe('hardware');
  });
});

describe('gnomon identity purge-keys', () => {
  it('deletes another generation with one fresh touch per key, and never the live identity', async () => {
    const home = tmp();
    const fake = new FakeHelper(null);
    expect((await run(home, fake)).code).toBe(0);
    const live = readIdentity(home)!;
    const o = io();
    expect(await runIdentityCommand(['purge-keys', '--home', home, '--gen', live.gen, '--helper', exe(tmp())], o.io, deps(fake))).toBe(1);
    expect(o.errJson().reason).toBe('in-use');
    // a retired generation from a rotate
    expect((await run(home, fake, ['--rotate'], { confirm: async () => 'rotate' })).code).toBe(0);
    fake.prompts = [];
    const o2 = io();
    expect(await runIdentityCommand(['purge-keys', '--home', home, '--gen', live.gen, '--helper', exe(tmp())], o2.io, deps(fake))).toBe(0);
    expect(o2.json()).toMatchObject({ purged: true, deleted: ['approvals', 'root'] });
    expect(fake.prompts.length).toBe(2);
    expect(fake.keys.has(`${live.gen}.root`)).toBe(false);
  });

  it('falsifier (reviewer round 3): refuses on a malformed identity.json, from a kernel-spawned shell, and while the daemon runs', async () => {
    const home = tmp();
    const fake = new FakeHelper('old00001');
    fs.mkdirSync(path.join(home, 'keys'), { recursive: true, mode: 0o700 });
    fs.writeFileSync(identityPath(home), '{not json', { mode: 0o600 });
    const o = io();
    expect(await runIdentityCommand(['purge-keys', '--home', home, '--gen', 'old00001', '--helper', exe(tmp())], o.io, deps(fake))).toBe(1);
    expect(o.errJson().reason).toBe('identity-malformed');
    const o2 = io();
    expect(await runIdentityCommand(['purge-keys', '--home', tmp(), '--gen', 'old00001', '--helper', exe(tmp())], o2.io, deps(fake, { env: { GNOMON_HSID: 'hs:x' } }))).toBe(1);
    expect(o2.errJson().reason).toBe('forbidden');
    const running = tmp();
    fs.writeFileSync(path.join(running, 'gnomon.pid'), JSON.stringify({ schemaVersion: 'daemonPid:v1', pid: process.pid, startedAt: new Date().toISOString(), socketPath: path.join(running, 'gnomon.sock') }));
    const o3 = io();
    expect(await runIdentityCommand(['purge-keys', '--home', running, '--gen', 'old00001', '--helper', exe(tmp())], o3.io, deps(fake))).toBe(1);
    expect(o3.errJson().reason).toBe('daemon-running');
    expect(fake.keys.size).toBe(2);
  });
});
