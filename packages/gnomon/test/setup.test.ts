// @gnomon-platform: darwin, linux
/**
 * #first-run / #provisioner / #setup-preflight (spec §2.4 rule 9, §3.1
 * Provisioner; T-2026-10-19-005 MVP-a) — the guided `gnomon setup` over the
 * FakeHelper, and the Aegis invariants as falsifiers:
 *   G-SET-01 happy path: exactly two root prompts, each digest shown big on the terminal first (I2, I7)
 *   G-SET-02 I1: a dropped or replaced helper line refuses; a multi-line "line" never passes
 *   G-SET-03 I4: GNOMON_HOME is not read; a symlinked ~/.gnomon is refused
 *   G-SET-04 I6: a leftover generation is never adopted; purging it takes presence per key
 *   G-SET-05 I7/I8: one provisioning run at a time; a third root sign never happens
 *   G-SET-06 I9: a fault at any step before commit leaves no record and no keys
 *   G-SET-07 I10 + ^unprovisioned-only: an existing identity is shown, never adopted; a missing registry row is completed with fresh presence
 * POSIX: owner-only keys/ modes and a shebang helper executable (like identity-cli.test.ts).
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it } from 'vitest';
import { runBareCommand } from '../src/cli/bare-cli.js';
import { groupDigest, runSetup, runSetupCommand, type GuiSetupDeps, type SetupDeps } from '../src/cli/setup-cli.js';
import { runUp } from '../src/cli/up-cli.js';
import {
  acceptUnsignedHelperForTests,
  DEV_TEST_HELPER_ACK,
  deviceKeyPath,
  writeNewDeviceKey,
  HardwareRootAuthority,
  helperLineShows,
  identityPath,
  Provisioner,
  provisionLockPath,
  readIdentity,
  readRegistry,
  registryPath,
  ROOT_PROMPT_BUDGET,
  type HelperTransport,
} from '../src/kernel/identity/index.js';
import { privateTmpRoot } from './daemon-helpers.js';
import { FakeHelper } from './helper-fake.js';

const DEV = acceptUnsignedHelperForTests(DEV_TEST_HELPER_ACK);
const roots: string[] = [];
function tmp(): string {
  const d = fs.realpathSync.native(fs.mkdtempSync(path.join(privateTmpRoot(), 'gnomon-set-')));
  roots.push(d);
  return d;
}
afterEach(() => {
  while (roots.length) fs.rmSync(roots.pop()!, { recursive: true, force: true });
});

function exe(dir: string): string {
  const f = path.join(dir, 'gnomon-helper');
  fs.writeFileSync(f, `#!${process.execPath}\n`);
  fs.chmodSync(f, 0o755);
  return f;
}

function io(answers: string[] = []) {
  const out: string[] = [];
  const err: string[] = [];
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  stdout.on('data', (d) => out.push(String(d)));
  stderr.on('data', (d) => err.push(String(d)));
  for (const a of answers) stdin.write(`${a}\n`);
  return { io: { stdin, stdout, stderr }, text: () => out.join(''), errText: () => err.join('') };
}

/** Each start is a fresh helper process over the same fake SE; `ops` records every request. */
function view(fake: FakeHelper, ops: string[], gate?: (r: Record<string, unknown>) => void): () => HelperTransport {
  return () => {
    fake.revive();
    return {
      request: async (r) => {
        ops.push(`${String(r.op)}:${String(r.key)}`);
        gate?.(r);
        return fake.request(r);
      },
      get alive() {
        return fake.alive;
      },
      onExit: () => undefined,
      close: async () => undefined,
    };
  };
}

function deps(userHome: string, fake: FakeHelper, ops: string[] = [], extra: Partial<GuiSetupDeps> = {}): GuiSetupDeps {
  return {
    userHome,
    verifier: DEV,
    startHelper: view(fake, ops),
    once: () => (req) => fake.handle(req),
    helperPath: exe(tmp()),
    surface: 'cli',
    isTty: true,
    handleSignals: false,
    runtime: { env: {}, execArgv: ['--disable-sigusr1'] },
    platform: 'darwin',
    exec: (f) => (f.endsWith('sw_vers') ? '15.1\n' : 'System Integrity Protection status: enabled.\n'),
    ...extra,
  };
}

const lastLine = (s: string): string => s.slice(s.lastIndexOf('\n') + 1);
/** Rewrite identity.json in place (a same-user tamper). */
function editRecord(home: string, f: (r: Record<string, unknown>) => Record<string, unknown>): void {
  const p = identityPath(home);
  fs.writeFileSync(p, `${JSON.stringify(f(JSON.parse(fs.readFileSync(p, 'utf8'))), null, 2)}\n`);
}
const homeOf = (u: string): string => path.join(u, '.gnomon');

describe('gnomon setup (#first-run)', () => {
  it('G-SET-01: welcome, preflight, name, then EXACTLY two root prompts, each digest shown big first and matching the helper line (I2, I7)', async () => {
    const u = tmp();
    const fake = new FakeHelper(null);
    const o = io(['']); // accept the prefilled name
    const r = await runSetup(o.io, deps(u, fake));
    expect(r).toMatchObject({ code: 0, provisioned: true });
    const t = o.text();
    expect(t).toContain('Welcome to Gnomon');
    expect(t).toContain('EXACTLY 2 Touch ID prompts');
    expect(t).toContain('Touch ID 1 of 2: your root key vouches for your approvals key');
    expect(t).toContain("Touch ID 2 of 2: the root registers this Mac's device key");
    expect(fake.signs.length).toBe(ROOT_PROMPT_BUDGET.init);
    expect(fake.signs.every((s) => s.key === 'root' && s.mode === 'fresh')).toBe(true);
    const told = [...t.matchAll(/root key signs 1: ([0-9a-f]{12})"/g)].map((m) => m[1]!);
    expect(told.length).toBe(2);
    told.forEach((d, i) => {
      expect(t).toContain(`        ${groupDigest(d)}\n`);
      expect(lastLine(fake.shown[i]!)).toMatch(new RegExp(`^Gnomon Helper: root key signs 1: ${d}; row \\S`)); // the helper's real line is LAST and BEGINS with it
    });
    // I2: the digest is on the terminal only, never in a file of the home; the lock is gone
    for (const f of fs.readdirSync(path.join(homeOf(u), 'keys'))) for (const d of told) expect(fs.readFileSync(path.join(homeOf(u), 'keys', f), 'utf8')).not.toContain(d);
    expect(fs.existsSync(provisionLockPath(homeOf(u)))).toBe(false);
    expect(readIdentity(homeOf(u))!.principalId).toMatch(/\//);
  });

  it('G-SET-02 (I1): a helper that drops or replaces its own line gets no committed signature; a multi-line "line" never passes', async () => {
    for (const shown of [null, 'Gnomon Helper: root key signs 1: 000000000000']) {
      const u = tmp();
      const fake = new FakeHelper(null, { shown });
      const o = io(['']);
      const r = await runSetup(o.io, deps(u, fake));
      expect(r.code).toBe(1);
      expect(o.errText()).toContain('helper-line-mismatch');
      expect(fs.existsSync(identityPath(homeOf(u)))).toBe(false);
      expect(fake.keys.size).toBe(0);
    }
    // a reason that imitates the helper line cannot stand in for it: the checked line is one line, the helper's own
    expect(helperLineShows('Gnomon: sign …\nGnomon Helper: root key signs 1: abcdefabcdef', 'root', 'abcdefabcdef')).toBe(false);
    expect(helperLineShows('Gnomon Helper: root key signs 1: abcdefabcdef; row gnomon-approvals-key:v1', 'root', 'abcdefabcdef')).toBe(true);
    expect(helperLineShows('Gnomon Helper: root key signs 2: abcdefabcdef 111111111111', 'root', 'abcdefabcdef')).toBe(false);
  });

  it('G-SET-03 (I4): GNOMON_HOME is never read, and a symlinked ~/.gnomon is refused before any key exists', async () => {
    const u = tmp();
    const decoy = tmp();
    const fake = new FakeHelper(null);
    const r = await runSetup(io(['']).io, deps(u, fake, [], { runtime: { env: { GNOMON_HOME: decoy }, execArgv: ['--disable-sigusr1'] } }));
    expect(r.code).toBe(0);
    expect(fs.readdirSync(decoy)).toEqual([]);
    expect(readIdentity(homeOf(u))).not.toBeNull();

    const u2 = tmp();
    const real = tmp();
    fs.symlinkSync(real, homeOf(u2));
    const fake2 = new FakeHelper(null);
    const o = io(['']);
    expect((await runSetup(o.io, deps(u2, fake2))).code).toBe(1);
    expect(o.errText()).toContain('unsafe-home');
    expect(fake2.keys.size).toBe(0);
    expect(fs.readdirSync(real)).toEqual([]);
  });

  it('G-SET-04 (I6): a leftover generation is never adopted; declining stops, purging takes a touch per key', async () => {
    const u = tmp();
    const fake = new FakeHelper('test0001');
    const ops: string[] = [];
    const o = io(['no']);
    expect((await runSetup(o.io, deps(u, fake, ops))).code).toBe(1);
    expect(o.errText()).toContain('keys-exist');
    expect(fake.keys.has('test0001.root')).toBe(true);
    expect(ops.filter((x) => x.startsWith('key.create'))).toEqual([]);

    const o2 = io(['purge', '']);
    const r = await runSetup(o2.io, deps(u, fake, ops));
    expect(r.code).toBe(0);
    expect(fake.prompts.filter((p) => /delete the (approvals|root) key of generation test0001/.test(p)).length).toBe(2);
    expect(fake.keys.has('test0001.root')).toBe(false);
    expect(readIdentity(homeOf(u))!.gen).not.toBe('test0001');
  });

  it('G-SET-04 (MEDIUM-2): a generation that is the live root of the GNOMON_HOME home is never purged; purgeGeneration re-checks every visible record under the lock', async () => {
    const fake = new FakeHelper(null);
    const other = path.join(tmp(), 'other-home');
    const p = new Provisioner({ home: other, helperPath: exe(tmp()), verifier: DEV, start: view(fake, []), once: () => (q) => fake.handle(q) });
    const made = await p.provision({ mode: 'init', existing: null, name: 'matt', host: 'mac' });
    expect(made.ok).toBe(true);
    const gen = readIdentity(other)!.gen;
    const prompts = fake.prompts.length;

    const u = tmp();
    const o = io(['purge']);
    const r = await runSetup(o.io, deps(u, fake, [], { runtime: { env: { GNOMON_HOME: other }, execArgv: ['--disable-sigusr1'] } }));
    expect(r.code).toBe(1);
    expect(o.errText()).toContain('in-use');
    expect(fake.prompts.length).toBe(prompts); // no delete prompt
    expect(fake.keys.has(`${gen}.root`)).toBe(true);

    // the engine itself: its own home's live generation, and any home it is told about, refuse under the lock
    expect(await p.purgeGeneration(gen)).toMatchObject({ ok: false, reason: 'in-use' });
    const q = new Provisioner({ home: homeOf(u), helperPath: exe(tmp()), verifier: DEV, start: view(fake, []) });
    expect(await q.purgeGeneration(gen, { alsoCheckHomes: [other] })).toMatchObject({ ok: false, reason: 'in-use' });
    expect(fake.keys.has(`${gen}.root`)).toBe(true);
  });

  it('G-SET-05 (I7, I8): two concurrent runs — the second refuses provisioning-locked and sends no key.create; a third root sign is never asked', async () => {
    const u = tmp();
    const home = homeOf(u);
    const fake = new FakeHelper(null);
    const ops: string[] = [];
    let rootSigns = 0;
    const start = view(fake, ops, (r) => {
      if (r.op === 'sign' && r.key === 'root' && ++rootSigns >= 3) throw new Error('third root prompt: an attack');
    });
    const mk = () => new Provisioner({ home, helperPath: exe(tmp()), verifier: DEV, start, once: () => (q) => fake.handle(q) });
    const [a, b] = await Promise.all([mk().provision({ mode: 'init', existing: null, name: 'matt', host: 'mac' }), mk().provision({ mode: 'init', existing: null, name: 'matt', host: 'mac' })]);
    const outcomes = [a, b].map((x) => (x.ok ? 'ok' : x.reason)).sort();
    expect(outcomes).toEqual(['ok', 'provisioning-locked']);
    expect(ops.filter((x) => x.startsWith('key.create')).length).toBe(2);
    expect(rootSigns).toBe(2);

    // a live holder's lock (this process) refuses setup before any key exists
    const u2 = tmp();
    fs.writeFileSync(provisionLockPath(homeOf(u2)), JSON.stringify({ pid: process.pid }));
    const fake2 = new FakeHelper(null);
    const ops2: string[] = [];
    const o = io(['']);
    expect((await runSetup(o.io, deps(u2, fake2, ops2))).code).toBe(1);
    expect(o.errText()).toContain('provisioning-locked');
    expect(ops2.filter((x) => x.startsWith('key.create'))).toEqual([]);
  });

  it('G-SET-05 (L4, L5, L6): a dead holder\'s lock is taken over; a lock taken over mid-run stops before any key; one lock path per home; the home is created 0700', async () => {
    const u = tmp();
    const home = homeOf(u);
    expect(provisionLockPath(`${home}${path.sep}`)).toBe(provisionLockPath(home));
    expect(provisionLockPath(path.join(u, '.', '.gnomon'))).toBe(provisionLockPath(home));
    fs.writeFileSync(provisionLockPath(home), JSON.stringify({ pid: 2147483646 })); // a holder that is not alive
    const fake = new FakeHelper(null);
    expect((await runSetup(io(['']).io, deps(u, fake))).code).toBe(0);
    expect((fs.statSync(home).mode & 0o777).toString(8)).toBe('700');

    const u2 = tmp();
    const home2 = homeOf(u2);
    const fake2 = new FakeHelper(null);
    const ops: string[] = [];
    const start = view(fake2, ops, (r) => {
      if (r.op === 'key.list' && fs.existsSync(provisionLockPath(home2))) {
        fs.rmSync(provisionLockPath(home2)); // another run takes the lock over
        fs.writeFileSync(provisionLockPath(home2), JSON.stringify({ pid: process.pid }));
      }
    });
    const p = new Provisioner({ home: home2, helperPath: exe(tmp()), verifier: DEV, start, once: () => (q) => fake2.handle(q) });
    expect(await p.provision({ mode: 'init', existing: null, name: 'matt', host: 'mac' })).toMatchObject({ ok: false, reason: 'provisioning-locked' });
    expect(ops.filter((x) => x.startsWith('key.create'))).toEqual([]);
    expect(fs.existsSync(provisionLockPath(home2))).toBe(true); // the other run's lock is not removed
  });

  it('G-SET-06 (I9): a fault at every step before commit leaves no record, no registry row, no keys and no lock', async () => {
    for (const step of ['create-root', 'create-approvals', 'sign-approvals-binding', 'sign-device-row', 'commit']) {
      const u = tmp();
      const fake = new FakeHelper(null);
      const o = io(['']);
      const r = await runSetup(o.io, deps(u, fake, [], { fault: (s) => {
        if (s === step) throw new Error(`fault at ${s}`);
      } }));
      expect(r.code, step).toBe(1);
      expect(fs.existsSync(identityPath(homeOf(u))), step).toBe(false);
      expect(fs.existsSync(registryPath(homeOf(u))), step).toBe(false);
      expect(fake.keys.size, step).toBe(0);
      expect(fs.existsSync(provisionLockPath(homeOf(u))), step).toBe(false);
    }
  });

  it('G-SET-07 (I10, ^unprovisioned-only): a crash after commit keeps the keys; setup shows the identity and completes the row with one fresh, shown touch', async () => {
    const u = tmp();
    const home = homeOf(u);
    const fake = new FakeHelper(null);
    const r = await runSetup(io(['']).io, deps(u, fake, [], { fault: (s) => {
      if (s === 'registry') throw new Error('crash between identity.json and the registry row');
    } }));
    expect(r.code).toBe(1);
    const rec = readIdentity(home)!;
    expect(fake.keys.size).toBe(2); // after commit, keys are never deleted
    const verify = new HardwareRootAuthority({ gen: rec.gen, rootPublicKeyPem: rec.rootPublicKeyPem }, {});
    expect(readRegistry(home, verify).devices.get(rec.deviceId)).toBeUndefined();

    // the record's helperPath is the pinned one (I5): reuse a valid executable there
    // HIGH-1: completion appends the row the root signed during setup (saved in the record): ZERO new signatures
    expect(rec.pendingDeviceRow?.row.keyId).toBe(rec.deviceKeyId);
    const before = fake.signs.length;
    const o = io(['complete']);
    const done = await runSetup(o.io, deps(u, fake));
    expect(done.code).toBe(0);
    expect(o.text()).toContain(`created    ${rec.createdAt}`);
    expect(fake.signs.length - before).toBe(0);
    expect(fake.prompts.length).toBe(2);
    expect(readRegistry(home, verify).devices.get(rec.deviceId)?.principalId).toBe(rec.principalId);
    expect(readIdentity(home)!.gen).toBe(rec.gen); // never re-keyed

    const again = io([]);
    expect((await runSetup(again.io, deps(u, fake))).code).toBe(0);
    expect(again.text()).toContain('Nothing to do');
    expect(fake.signs.length - before).toBe(0);
  });

  it('G-SET-07 (HIGH-1 falsifiers): completion is never a signing oracle — a swapped device key, an edited deviceId or a record without the saved row refuse with 0 signs', async () => {
    const crashAt = (s: string) => {
      if (s === 'registry') throw new Error('crash');
    };
    const cases: Array<[string, (home: string) => void, string]> = [
      ['swapped device key', (h) => (fs.rmSync(deviceKeyPath(h)), writeNewDeviceKey(h)), 'device-conflict'],
      ['edited deviceId', (h) => editRecord(h, (r) => ({ ...r, deviceId: `${String(r.deviceId)}x` })), 'device-conflict'],
      ['no saved row', (h) => editRecord(h, (r) => ({ ...r, pendingDeviceRow: undefined })), 'no-saved-device-row'],
    ];
    for (const [what, tamper, reason] of cases) {
      const u = tmp();
      const home = homeOf(u);
      const fake = new FakeHelper(null);
      expect((await runSetup(io(['']).io, deps(u, fake, [], { fault: crashAt }))).code, what).toBe(1);
      tamper(home);
      const before = fake.signs.length;
      const o = io(['complete']);
      expect((await runSetup(o.io, deps(u, fake))).code, what).toBe(1);
      expect(o.errText(), what).toContain(reason);
      expect(fake.signs.length - before, what).toBe(0);
      expect(fs.existsSync(registryPath(home)) ? fs.readFileSync(registryPath(home), 'utf8').trim() : '', what).toBe('');
    }
  });

  it('L6: the engine re-judges the home under the lock — a symlinked home refuses unsafe-home before any key', async () => {
    const u = tmp();
    const real = tmp();
    fs.symlinkSync(real, homeOf(u));
    const fake = new FakeHelper(null);
    const ops: string[] = [];
    const p = new Provisioner({ home: homeOf(u), helperPath: exe(tmp()), verifier: DEV, start: view(fake, ops), once: () => (q) => fake.handle(q) });
    expect(await p.provision({ mode: 'init', existing: null, name: 'matt', host: 'mac' })).toMatchObject({ ok: false, reason: 'unsafe-home' });
    expect(ops.filter((x) => x.startsWith('key.'))).toEqual([]);
    expect(fs.readdirSync(real)).toEqual([]);
  });

  it('L7: up on a home whose registry row is missing names gnomon setup', async () => {
    const u = tmp();
    const fake = new FakeHelper(null);
    expect((await runSetup(io(['']).io, deps(u, fake, [], { fault: (s) => {
      if (s === 'registry') throw new Error('crash');
    } }))).code).toBe(1);
    const o = io([]);
    const code = await runUp(o.io, { userHome: u, verifier: DEV, startHelper: view(fake, []), runtime: { env: {}, execArgv: ['--disable-sigusr1'] }, start: () => Promise.reject(new Error('must not start')) }, {});
    expect(code).toBe(1);
    expect(o.errText()).toContain('device-unregistered');
    expect(o.errText()).toContain('next: gnomon setup');
  });

  it('bare gnomon continues into up when setup finds the Mac already set up (another run won the race)', async () => {
    const donor = tmp();
    const fake = new FakeHelper(null);
    expect((await runSetup(io(['']).io, deps(donor, fake))).code).toBe(0);
    const u = tmp();
    const out: string[] = [];
    const base = io([]);
    // the home is unprovisioned when bare checks; a racing run provisions it before setup reads it
    const stdout = {
      isTTY: true,
      write: (s: string) => {
        if (s.includes('Welcome to Gnomon') && !fs.existsSync(path.join(homeOf(u), 'keys'))) fs.cpSync(path.join(homeOf(donor), 'keys'), path.join(homeOf(u), 'keys'), { recursive: true }), fs.chmodSync(path.join(homeOf(u), 'keys'), 0o700);
        out.push(s);
        return true;
      },
    };
    const run = runBareCommand([], { stdin: base.io.stdin, stdout, stderr: base.io.stderr }, {
      userHome: u,
      cwd: u,
      verifier: DEV,
      startHelper: view(fake, []),
      runtime: { env: {}, execArgv: ['--disable-sigusr1'] },
      start: () => Promise.reject(new Error('reached up')),
      setup: deps(u, fake),
    });
    const got = await run.catch((e: Error) => e.message);
    await new Promise((r) => setImmediate(r));
    expect(got, base.errText()).toBe('reached up');
    expect(out.join('')).toContain('Already set up');
  });

  it('routing: bare gnomon on a TTY with an unprovisioned home runs setup first; off a TTY it is up\'s refusal naming gnomon setup', async () => {
    const u = tmp();
    const fake = new FakeHelper('test0001');
    const o = io(['no']);
    const code = await runBareCommand([], o.io, { userHome: u, cwd: u, setup: deps(u, fake) });
    expect(code).toBe(1);
    expect(o.text()).toContain('Welcome to Gnomon');
    expect(o.errText()).toContain('keys-exist');

    const o2 = io([]);
    expect(await runBareCommand([], o2.io, { userHome: u, cwd: u, runtime: { env: {}, execArgv: ['--disable-sigusr1'] } })).toBe(1);
    expect(o2.text()).not.toContain('Welcome to Gnomon');
    expect(o2.errText()).toContain('next: gnomon setup');
  });
});

describe('round 3: gnomon setup on an already-set-up Mac continues into the launch', () => {
  it('code 0 with a home calls continueUp even when nothing was provisioned this run', async () => {
    const u = tmp();
    const fake = new FakeHelper(null);
    expect((await runSetup(io(['']).io, deps(u, fake))).provisioned).toBe(true);
    let continued = 0;
    const code = await runSetupCommand(['--cli'], io().io, { ...deps(u, fake), continueUp: async () => (continued++, 0) });
    expect(code).toBe(0);
    expect(continued).toBe(1);
  });
});
