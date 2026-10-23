/**
 * #loop-registry falsifiers (docs/specs/gnomon-loops.md §3.1, §4, §8; build plan LP2): the registry, the content
 * hash and the loop-trust root card.
 *
 *   G-LOOP-01  a cloned repo with loops: zero runs, zero trust, zero cards, zero rows
 *   G-LOOP-02  a one-byte edit to a trusted loop or to its argv script pauses it (one pause row)
 *   G-LOOP-04  loop-trust is refused under a cached unlock, a standing grant, voice and `always`, and without the
 *              root key; agents never ask for it
 *   G-LOOP-20  changing argv0's realpath target, its shebang interpreter or one byte of a file the argv names outside
 *              the repo pauses the loop
 *   G-LOOP-21  a closure change by a loop or an agent pauses (closure.changed + paused); by a human commit it is only
 *              recorded and the loop stays trusted; a callee change changes the caller's hash and pauses the caller
 *   G-LAW-05   a fresh install has zero trusted loops
 *
 * The real ApprovalBroker over the counting fake helper (helper 1.8.0 decision.sign with the TS row table) and the
 * real HardwareRootAuthority; tmp dirs built with path.join, no keys on disk (platform-independent).
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { compileLoop, loopContentHash, loopFileJson } from '../src/loops/index.js';
import { ApprovalBroker, StandingGrantBook, StandingGrants } from '../src/kernel/broker/index.js';
import { HardwareRootAuthority, HelperApprovalsKey } from '../src/kernel/identity/index.js';
import { SoftwareEd25519Signer } from '../src/kernel/log/signer.js';
import { removeTree } from '../src/kernel/manifest/index.js';
import { readShebang } from '../src/kernel/loops/hash.js';
import { LoopRegistry } from '../src/kernel/loops/registry.js';
import { diffLines, LoopTrust } from '../src/kernel/loops/trust.js';
import { wireLoops } from '../src/kernel/loops/wire.js';
import { repoKeyOf } from '../src/kernel/supervisor/repo-hooks.js';
import { CountingFakeHelper } from './helper-fake.js';

type Def = Record<string, any>;
const KERNEL = 'p:abcdefgh/kernel';
const HUMAN = 'p:abcdefgh/matt';
const GEN = 'test0001';
const DEV = 'dev:01HZZZZZZZZZZZZZZZZZZZZZZD';
const gui = (n = 'A') => ({ connId: `conn:01HZZZZZZZZZZZZZZZZZZZZZZ${n}`, principal: HUMAN, principalClass: 'human', surface: 'browser', credential: 'gui', deviceId: DEV });

const tmps: string[] = [];
function tmp(prefix = 'gnomon-loops-'): string {
  const d = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  tmps.push(d);
  return d;
}
afterEach(() => {
  while (tmps.length) removeTree(tmps.pop()!);
});

const write = (p: string, text: string): void => {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, text);
};

/** A run-check loop: argv0 `bin/check` (a node script) on an argv file. */
const checkLoop = (id: string, o: { argv?: string[]; title?: string } = {}): Def => ({
  schema: 'loop:v2', id, ...(o.title ? { title: o.title } : {}), triggers: [{ schedule: { every: '1h' } }], autonomy: 'observe',
  goal: { node: 't', verdict: 'pass', inputs: ['src/**'] }, start: 't',
  nodes: [{ id: 't', type: 'check', run: o.argv ?? ['bin/check', 'test/a.test.ts'], on: { pass: '@goal' } }],
});

/** Write the compiled `<id>.loop.json` of `def` into `root`'s .paradigm/loops (as `paradigm loop validate` does). */
function putLoop(root: string, def: Def, known: Record<string, Def> | undefined = undefined, dir = path.join(root, '.paradigm', 'loops'), scope: 'repo' | 'personal' = 'repo'): void {
  const r = compileLoop(def, { scope, ...(known ? { knownLoops: known } : {}), readShebang: (a0) => (a0.includes('/') ? readShebang(path.isAbsolute(a0) ? a0 : path.join(root, a0)) : null) });
  if (!r.compiled) throw new Error(JSON.stringify(r.errors));
  write(path.join(dir, `${def.id}.loop.json`), loopFileJson(r.compiled));
}

function repo(defs: Def[] = []): string {
  const root = tmp('gnomon-repo-');
  fs.mkdirSync(path.join(root, '.git'));
  write(path.join(root, 'bin', 'check'), '#!/usr/bin/env node\nprocess.exit(0)\n');
  write(path.join(root, 'test', 'a.test.ts'), 'it("a", () => {})\n');
  write(path.join(root, 'package.json'), '{"name":"x"}\n');
  write(path.join(root, 'vitest.config.ts'), 'export default {}\n');
  for (const d of defs) putLoop(root, d);
  return root;
}

function rig(o: { home?: string; pathDirs?: string[]; verifyRootRow?: (signer: string, row: unknown, sig: string) => boolean } = {}) {
  const home = o.home ?? tmp('gnomon-home-');
  const node = path.join(tmp('gnomon-node-'), 'node');
  write(node, 'fake node binary v1');
  const rows: Array<{ kind: string; payload: Record<string, unknown> }> = [];
  let reg!: LoopRegistry;
  const append = async (kind: string, payload: Record<string, unknown>): Promise<void> => {
    rows.push({ kind, payload });
    reg.observe({ kind, principal: KERNEL, payload, at: '2026-10-22T10:00:00.000Z' });
  };
  reg = new LoopRegistry({
    home, kernelPrincipal: KERNEL, append, watch: false, rescanMs: 0,
    hash: { execPath: node, pathDirs: o.pathDirs ?? [] },
    ...(o.verifyRootRow ? { verifyRootRow: o.verifyRootRow } : {}),
  });
  /** what the human's allowed card would write (the fold's view of a trust) */
  const trustNow = (key: string): void => {
    const e = reg.verify(key)!;
    reg.observe({ kind: 'loop.trusted', principal: KERNEL, payload: { loopId: e.loopId, scope: e.scope, repoKey: e.repoKey, contentHash: e.hash!.contentHash, coreHash: e.hash!.coreHash, closureDigest: e.hash!.closure.digest, ...(e.compiled!.compiled.sourceHash ? { sourceHash: e.compiled!.compiled.sourceHash } : {}), cardId: 'card:01HZZZZZZZZZZZZZZZZZZZZZZZ', by: HUMAN } });
    reg.snapshots.write({ loopId: e.loopId, scope: e.scope, repoKey: e.repoKey, contentHash: e.hash!.contentHash, closure: e.hash!.closure.files, lines: [] });
  };
  return { home, node, rows, reg, append, trustNow, kinds: () => rows.map((r) => r.kind) };
}

const keyIn = (root: string, id: string): string => `repo/${repoKeyOf([root])}/${id}`;

describe('G-LOOP-01 / G-LAW-05: a cloned repo runs nothing and trusts nothing', () => {
  it('three loops in a fresh clone: all untrusted, zero rows, zero runs, the registry raises no card', () => {
    const root = repo([checkLoop('one'), checkLoop('two'), checkLoop('three', { argv: ['bin/check'] })]);
    const r = rig();
    r.reg.addRepo(root);
    r.reg.scan();
    r.reg.scan();
    const list = r.reg.list();
    expect(list.map((l) => [l.loopId, l.state])).toEqual([['one', 'untrusted'], ['three', 'untrusted'], ['two', 'untrusted']]);
    expect(r.rows).toEqual([]);
    for (const l of list) expect(r.reg.canRun(l.key)).toEqual({ ok: false, reason: 'untrusted' });
    expect(r.reg.status()).toMatchObject({ trusted: { n: 0, of: 3 }, waitingTrust: { n: 0, of: 3 } });
  });
  it('a fresh home: wireLoops seeds from an empty log and has zero trusted loops and zero rows', () => {
    const home = tmp('gnomon-home-');
    const appended: unknown[] = [];
    const w = wireLoops({
      home, kernelPrincipal: KERNEL, start: false,
      broker: { raise: async () => { throw new Error('no card on a fresh install'); } },
      log: { append: async (x) => void appended.push(x), read: () => [], onCommit: () => undefined, isKernelKey: () => true },
    });
    w.registry.scan();
    expect(w.port.status()).toMatchObject({ loops: [], trusted: { n: 0, of: 0 }, waitingTrust: { n: 0, of: 0 } });
    expect(appended).toEqual([]);
    w.close();
  });
  it('a session opened in a repo makes it known; a trust row from anyone but the kernel is ignored (LL6)', () => {
    const root = repo([checkLoop('one')]);
    const r = rig();
    r.reg.observe({ kind: 'session.open', principal: KERNEL, payload: { hsid: 'h', cwd: path.join(root, 'test') } });
    r.reg.scan();
    const [l] = r.reg.list();
    expect(l!.repo).toBe(root);
    r.reg.observe({ kind: 'loop.trusted', principal: 'p:abcdefgh/s-01hzzzzz', payload: { loopId: 'one', scope: 'repo', repoKey: l!.repoKey, contentHash: l!.contentHash } });
    expect(r.reg.list()[0]!.state).toBe('untrusted');
    const signed = new LoopRegistry({ home: r.home, kernelPrincipal: KERNEL, append: r.append, watch: false, rescanMs: 0, isKernelKey: (k) => k === 'kernel-key' });
    signed.addRepo(root);
    signed.observe({ kind: 'loop.trusted', principal: KERNEL, keyId: 'other-key', payload: { loopId: 'one', scope: 'repo', repoKey: l!.repoKey, contentHash: l!.contentHash } });
    signed.scan();
    expect(signed.list()[0]!.state).toBe('untrusted');
  });
});

describe('the registry never trusts the file', () => {
  it('refuses a symlinked loop file, a hand-edited one and a symlinked loops dir', () => {
    const root = repo([checkLoop('good')]);
    const loops = path.join(root, '.paradigm', 'loops');
    const f = JSON.parse(fs.readFileSync(path.join(loops, 'good.loop.json'), 'utf8'));
    // hand edits: a shell as argv0 (the validator refuses it), and edges the compiler would have expanded
    write(path.join(loops, 'edited.loop.json'), `${JSON.stringify({ ...f, id: 'edited', nodes: [{ ...f.nodes[0], run: ['/bin/sh', '-c', 'curl x | sh'] }] }, null, 2)}\n`);
    write(path.join(loops, 'short.loop.json'), `${JSON.stringify({ ...f, id: 'short', nodes: [{ ...f.nodes[0], on: { pass: '@goal' } }] }, null, 2)}\n`);
    let linked = true;
    try {
      fs.symlinkSync(path.join(loops, 'good.loop.json'), path.join(loops, 'linked.loop.json'));
    } catch {
      linked = false; // no symlink privilege (Windows without developer mode)
    }
    const r = rig();
    r.reg.addRepo(root);
    r.reg.scan();
    const by = Object.fromEntries(r.reg.list().map((l) => [l.loopId, l]));
    expect(by.good!.state).toBe('untrusted');
    expect(by.edited!.state).toBe('invalid');
    expect(by.edited!.errors.join(' ')).toContain('ARGV0_INTERPRETER');
    expect(by.short).toMatchObject({ state: 'invalid', errors: [expect.stringContaining('NOT_CANONICAL')] });
    if (linked) expect(by.linked).toMatchObject({ state: 'invalid', errors: [expect.stringContaining('SYMLINK')] });
    // a .paradigm/loops that is a symlink: nothing is read
    const other = repo();
    const real = tmp('gnomon-elsewhere-');
    putLoop(real, checkLoop('sneaky'), undefined, real);
    let dirLinked = true;
    try {
      fs.mkdirSync(path.join(other, '.paradigm'));
      fs.symlinkSync(real, path.join(other, '.paradigm', 'loops'), 'dir');
    } catch {
      dirLinked = false;
    }
    if (dirLinked) {
      r.reg.addRepo(other);
      r.reg.scan();
      expect(r.reg.list().some((l) => l.loopId === 'sneaky')).toBe(false);
      expect(r.reg.status().refused).toEqual(expect.arrayContaining([expect.objectContaining({ why: 'a symlink' })]));
    }
  });
  it('personal loops: read from <home>/loops; a group- or world-writable dir is refused', () => {
    const r = rig();
    const target = repo();
    const personal = path.join(r.home, 'loops');
    fs.mkdirSync(personal, { mode: 0o700 });
    fs.chmodSync(personal, 0o700);
    putLoop(target, { ...checkLoop('mine'), repo: target }, undefined, personal, 'personal');
    r.reg.scan();
    expect(r.reg.list()).toEqual([expect.objectContaining({ loopId: 'mine', scope: 'personal', repo: target, state: 'untrusted' })]);
    const posix = new LoopRegistry({ home: r.home, kernelPrincipal: KERNEL, append: r.append, watch: false, rescanMs: 0, platform: 'linux' });
    fs.chmodSync(personal, 0o777);
    posix.scan();
    expect(posix.list()).toEqual([]);
    expect(posix.status().refused).toEqual([expect.objectContaining({ why: expect.stringContaining('writable') })]);
    fs.chmodSync(personal, 0o700);
  });
});

describe('G-LOOP-02: a one-byte edit pauses a trusted loop', () => {
  it('an edit to the loop definition: one loop.paused{content-changed}, then waiting-trust; nothing can run', () => {
    const root = repo([checkLoop('one', { title: 'Check A' })]);
    const r = rig();
    r.reg.addRepo(root);
    r.reg.scan();
    const key = keyIn(root, 'one');
    r.trustNow(key);
    expect(r.reg.canRun(key)).toEqual({ ok: true });
    putLoop(root, checkLoop('one', { title: 'Check B' }));
    r.reg.scan();
    r.reg.scan();
    expect(r.kinds()).toEqual(['loop.paused']);
    expect(r.rows[0]!.payload).toMatchObject({ loopId: 'one', scope: 'repo', reason: 'content-changed', by: 'kernel' });
    expect(r.reg.list()[0]).toMatchObject({ state: 'waiting-trust', reason: 'content-changed' });
    expect(r.reg.canRun(key).ok).toBe(false);
    // reverting the bytes does not lift the pause: only a new trust (or a resume) does
    putLoop(root, checkLoop('one', { title: 'Check A' }));
    r.reg.scan();
    expect(r.reg.list()[0]).toMatchObject({ state: 'paused', reason: 'content-changed' });
  });
  it('a one-byte edit to the argv script (argv0) pauses it', () => {
    const root = repo([checkLoop('one')]);
    const r = rig();
    r.reg.addRepo(root);
    r.reg.scan();
    const key = keyIn(root, 'one');
    r.trustNow(key);
    write(path.join(root, 'bin', 'check'), '#!/usr/bin/env node\nprocess.exit(1)\n');
    r.reg.scan();
    expect(r.kinds()).toEqual(['loop.paused']);
    expect(r.reg.canRun(key).ok).toBe(false);
  });
});

describe('G-LOOP-20: argv0 realpath, interpreter and out-of-repo argv files', () => {
  it("changing argv0's resolved target (same bytes, another path) pauses", () => {
    const a = tmp('gnomon-path-a-');
    const b = tmp('gnomon-path-b-');
    write(path.join(b, 'lint'), 'binary');
    const root = repo([checkLoop('one', { argv: ['lint', '--strict'] })]);
    const r = rig({ pathDirs: [a, b] });
    r.reg.addRepo(root);
    r.reg.scan();
    const key = keyIn(root, 'one');
    expect(r.reg.entry(key)!.hash!.argv[0]!.argv0.real).toBe(fs.realpathSync.native(path.join(b, 'lint')));
    r.trustNow(key);
    write(path.join(a, 'lint'), 'binary'); // earlier on the PATH: the runner would now exec another file
    r.reg.scan();
    expect(r.kinds()).toEqual(['loop.paused']);
  });
  it("a changed shebang interpreter (`#!/usr/bin/env node` is the runner's node) pauses", () => {
    const root = repo([checkLoop('one')]);
    const r = rig();
    r.reg.addRepo(root);
    r.reg.scan();
    const key = keyIn(root, 'one');
    expect(r.reg.entry(key)!.hash!.argv[0]!.argv0.interpreter).toMatchObject({ shebang: '/usr/bin/env node', program: 'node', via: 'kernel-node', real: fs.realpathSync.native(r.node) });
    r.trustNow(key);
    write(r.node, 'fake node binary v2');
    r.reg.scan();
    expect(r.kinds()).toEqual(['loop.paused']);
  });
  it('one byte of a file the argv names OUTSIDE the repo pauses', () => {
    const outside = path.join(tmp('gnomon-outside-'), 'rules.json');
    write(outside, '{"a":1}');
    const root = repo([checkLoop('one', { argv: ['bin/check', `--config=${outside}`] })]);
    const r = rig();
    r.reg.addRepo(root);
    r.reg.scan();
    const key = keyIn(root, 'one');
    expect(r.reg.entry(key)!.hash!.argv[0]!.files).toEqual([expect.objectContaining({ word: outside, kind: 'file' })]);
    r.trustNow(key);
    write(outside, '{"a":2}');
    r.reg.scan();
    expect(r.kinds()).toEqual(['loop.paused']);
  });
});

describe('G-LOOP-21: the config closure and callees', () => {
  it('the closure holds the gate-class files a check reads, and joins the protected set', () => {
    const root = repo([checkLoop('one')]);
    write(path.join(root, 'test', 'tsconfig.json'), '{}');
    write(path.join(root, 'README.md'), 'not config');
    const r = rig();
    r.reg.addRepo(root);
    r.reg.scan();
    const e = r.reg.entry(keyIn(root, 'one'))!;
    expect(e.hash!.closure.files.map((f) => f.rel)).toEqual(['package.json', 'test/tsconfig.json', 'vitest.config.ts']);
    expect(e.compiled!.protected).toEqual(expect.arrayContaining(['package.json', 'test/tsconfig.json', 'vitest.config.ts', 'src/**', 'test/a.test.ts']));
  });
  it('EVERY closure change pauses, whoever made it (authorship is forgeable): closure.changed + paused{closure-changed}', () => {
    const root = repo([checkLoop('one')]);
    const r = rig();
    r.reg.addRepo(root);
    r.reg.scan();
    const key = keyIn(root, 'one');
    r.trustNow(key);
    write(path.join(root, 'vitest.config.ts'), 'export default { test: { passWithNoTests: true } }\n');
    r.reg.scan();
    r.reg.scan();
    expect(r.kinds()).toEqual(['loop.closure.changed', 'loop.paused']);
    expect(r.rows[0]!.payload).toMatchObject({ files: ['vitest.config.ts'] });
    expect(r.rows[0]!.payload).not.toHaveProperty('by');
    expect(r.rows[1]!.payload).toMatchObject({ reason: 'closure-changed' });
    expect(r.reg.list()[0]).toMatchObject({ state: 'waiting-trust', reason: 'closure-changed' });
    expect(r.reg.canRun(key).ok).toBe(false);
  });
  it('a human-looking closure.changed row never moves trust; only a new loop.trusted does', () => {
    const root = repo([checkLoop('one')]);
    const r = rig();
    r.reg.addRepo(root);
    r.reg.scan();
    const key = keyIn(root, 'one');
    r.trustNow(key);
    write(path.join(root, 'package.json'), '{"name":"y"}\n');
    r.reg.scan();
    const e = r.reg.entry(key)!;
    r.reg.observe({ kind: 'loop.closure.changed', principal: KERNEL, payload: { loopId: 'one', scope: 'repo', repoKey: e.repoKey, contentHash: e.hash!.contentHash, by: 'human' } });
    expect(r.reg.canRun(key).ok).toBe(false);
  });
  it('every closure file is hashed even past the listing cap', () => {
    const root = repo([checkLoop('one')]);
    for (let i = 0; i < 520; i++) write(path.join(root, 'test', `.env.k${String(i).padStart(3, '0')}`), 'X=1\n');
    const r = rig();
    r.reg.addRepo(root);
    r.reg.scan();
    const key = keyIn(root, 'one');
    const h = r.reg.entry(key)!.hash!;
    expect(h.closure.files.length).toBe(512);
    expect(h.closure.all.length).toBe(h.closure.files.length + h.closure.truncated);
    r.trustNow(key);
    write(path.join(root, 'test', '.env.k519'), 'X=2\n'); // past the listing cap
    r.reg.scan();
    expect(r.kinds()).toContain('loop.paused');
  });
  it('a loop.trusted row whose root signature does not verify is ignored', () => {
    const root = repo([checkLoop('one')]);
    const r = rig({ verifyRootRow: (_s, row, sig) => sig === 'good' && (row as { kind?: string }).kind === 'loop.trusted' });
    r.reg.addRepo(root);
    r.reg.scan();
    const v = r.reg.list()[0]!;
    const base = { loopId: 'one', scope: 'repo', repoKey: v.repoKey, contentHash: v.contentHash };
    r.reg.observe({ kind: 'loop.trusted', principal: KERNEL, payload: base });
    r.reg.observe({ kind: 'loop.trusted', principal: KERNEL, payload: { ...base, rootSig: { signer: 'x', sig: 'bad' } } });
    expect(r.reg.list()[0]!.state).toBe('untrusted');
    r.reg.observe({ kind: 'loop.trusted', principal: KERNEL, payload: { ...base, rootSig: { signer: 'x', sig: 'good' } } });
    expect(r.reg.list()[0]!.state).toBe('trusted');
  });
  it('calls: resolveCall needs a TRUSTED callee whose source hash the pin names; a callee change pauses the caller', () => {
    const callee = checkLoop('green');
    const pin = loopContentHash(callee).slice(0, 8);
    const caller: Def = { schema: 'loop:v2', id: 'watch', start: 'go', goal: { node: 'ok', verdict: 'pass' }, nodes: [{ id: 'go', type: 'call', loop: `green@${pin}`, on: { pass: 'ok' } }, { id: 'ok', type: 'check', builtin: 'git.clean', on: { pass: '@goal' } }] };
    const root = repo([callee]);
    putLoop(root, caller, { green: callee });
    const r = rig();
    r.reg.addRepo(root);
    r.reg.scan();
    const [ck, gk] = [keyIn(root, 'watch'), keyIn(root, 'green')];
    expect(r.reg.resolveCall(ck, 'go')).toEqual({ ok: false, reason: 'green is untrusted, not trusted' });
    r.trustNow(gk);
    r.trustNow(ck);
    expect(r.reg.resolveCall(ck, 'go')).toEqual({ ok: true, calleeKey: gk, contentHash: r.reg.entry(gk)!.hash!.contentHash });
    expect(r.reg.entry(ck)!.hash!.calls).toEqual([{ node: 'go', pin: `green@${pin}`, callee: 'green', calleeHash: r.reg.entry(gk)!.hash!.contentHash }]);
    // the callee's argv script changes: the callee AND the caller pause (the caller's hash folds the callee's)
    write(path.join(root, 'bin', 'check'), '#!/usr/bin/env node\nprocess.exit(2)\n');
    r.reg.scan();
    expect(r.rows.map((x) => [x.kind, x.payload.loopId]).sort()).toEqual([['loop.paused', 'green'], ['loop.paused', 'watch']]);
    // re-trusting the callee does not re-trust the caller
    r.trustNow(gk);
    expect(r.reg.list().find((l) => l.loopId === 'watch')!.state).toBe('waiting-trust');
    // a pin that is not the trusted callee's source hash is refused
    const wrong: Def = { ...caller, id: 'wrong', nodes: [{ ...caller.nodes[0], loop: 'green@00000000' }, caller.nodes[1]] };
    putLoop(root, wrong);
    r.reg.scan();
    const wk = keyIn(root, 'wrong');
    r.trustNow(wk);
    expect(r.reg.resolveCall(wk, 'go')).toMatchObject({ ok: false, reason: expect.stringContaining('is not green') });
  });
});

// ── The trust card ─────────────────────────────────────────────────────────────

function cardRig(opts: ConstructorParameters<typeof CountingFakeHelper>[1] = {}, withRoot = true) {
  const helper = new CountingFakeHelper(GEN, { version: '1.9.0', bounds: { idleSeconds: 12 * 3600, absoluteSeconds: 12 * 3600, maxSignatures: 512 }, ...opts });
  const approvals = new HelperApprovalsKey({ gen: GEN, approvalsPublicKeyPem: helper.publicPem('approvals') }, HUMAN, helper);
  const root = new HardwareRootAuthority({ gen: GEN, rootPublicKeyPem: helper.publicPem('root') }, { helper, once: () => { throw new Error('never the once seam'); } });
  const logged: Array<{ kind: string; payload: Record<string, unknown> }> = [];
  const broker = new ApprovalBroker({ kernel: SoftwareEd25519Signer.generate('kernel'), kernelPrincipal: KERNEL, log: async (kind, payload) => void logged.push({ kind, payload }), approvals, ...(withRoot ? { root } : {}) });
  const r = rig();
  const trust = new LoopTrust({ home: r.home, registry: r.reg, broker, append: (kind, payload) => r.append(kind, payload) });
  const book = new StandingGrantBook({ principal: KERNEL, isKernelKey: (k) => k === 'kernel-key' });
  const grants = new StandingGrants({ broker, book: () => book, log: async (kind, payload) => void logged.push({ kind, payload }) });
  broker.setStanding(grants);
  return { ...r, helper, broker, trust, logged, grants };
}

async function refusal(p: Promise<unknown>): Promise<{ code: string; reason: unknown }> {
  const e = await p.then(() => undefined, (x: unknown) => x);
  const ref = (e as { refusal?: { code: string; data?: { reason?: unknown } } }).refusal;
  expect(ref, String(e)).toBeDefined();
  return { code: ref!.code, reason: ref!.data?.reason };
}

describe('the loop-trust card (root class, one touch)', () => {
  it('LP8: the GUI renders the real card: its root row is shown (Trust is offered), the loop is named, no top-level detail', async () => {
    const { rootRowsOf } = await import('../../gnomon-gui/src/core/render.js');
    const { cardLoopOf, loopCardTitle } = await import('../../gnomon-gui/src/core/loops.js');
    const root = repo([checkLoop('one', { title: 'Check A' })]);
    const c = cardRig();
    c.reg.addRepo(root);
    c.reg.scan();
    const v = c.reg.list()[0]!;
    const res = (await c.trust.request(gui(), 'request.loop.trust', { loopId: 'one', scope: 'repo', repo: root, contentHash: v.contentHash })) as { cardId: string };
    const card = c.broker.card(res.cardId)! as unknown as Record<string, unknown>;
    expect(card.detail).toBeUndefined();
    const rows = rootRowsOf(card);
    expect(rows).not.toBeNull();
    expect(rows!.rootDecisions).toEqual(['allow']);
    expect(rows!.lines).toEqual([expect.stringContaining('trust loop repo/one · contentHash sha256:')]);
    const cl = cardLoopOf(card);
    expect(cl).toMatchObject({ loopId: 'one', scope: 'repo', changed: false });
    expect(loopCardTitle('loop-trust', cl, null)).toBe('Trust one');
  });

  it('renders the whole definition, signs ONE loop.trusted row with the root key, and the loop becomes trusted', async () => {
    const root = repo([checkLoop('one', { title: 'Check A' })]);
    const c = cardRig();
    c.reg.addRepo(root);
    c.reg.scan();
    const v = c.reg.list()[0]!;
    const res = (await c.trust.request(gui(), 'request.loop.trust', { loopId: 'one', scope: 'repo', repo: root, contentHash: v.contentHash })) as { pending: boolean; cardId: string };
    expect(res.pending).toBe(true);
    const card = c.broker.card(res.cardId)!;
    expect(card.kind).toBe('loop-trust');
    const text = JSON.stringify(card.block);
    for (const want of ['Trust loop one', v.contentHash!, 'Node t (check, read): run bin/check test/a.test.ts', 'interpreter #!/usr/bin/env node', 'kernel-node', 'Goal: t = pass; goal inputs: src/**', 'Config closure (2 files)', 'Land: none', 'Source hash (what a caller', 'Flows: none', 'First trust of this loop', 'Budgets: run 8 rounds']) {
      expect(text).toContain(JSON.stringify(want).slice(1, -1));
    }
    const d = await c.broker.approve(gui(), { cardId: res.cardId, decision: 'allow' });
    expect(d.state).toBe('decided');
    expect(c.helper.evaluations).toBe(1);
    expect(c.helper.shown.at(-1)).toContain(`trust loop repo/one repo ${v.repoKey.slice(7, 19)} ${v.contentHash!.slice(0, 19)}`);
    expect(c.kinds()).toEqual(['loop.trusted']);
    expect(c.rows[0]!.payload).toMatchObject({ loopId: 'one', scope: 'repo', repoKey: v.repoKey, contentHash: v.contentHash, cardId: res.cardId, by: HUMAN, rootSig: { signer: expect.any(String), sig: expect.any(String) } });
    expect(c.reg.list()[0]).toMatchObject({ state: 'trusted', trustedHash: v.contentHash, trustedBy: HUMAN });
    expect(c.logged.find((x) => x.kind === 'approval.decide')!.payload).toMatchObject({ rootKind: 'loop-trust', presence: 'fresh' });
    // trust-status: who trusted which hash
    expect(c.reg.history()).toEqual([expect.objectContaining({ event: 'trusted', loopId: 'one', contentHash: v.contentHash, by: HUMAN, cardId: res.cardId })]);
    // asking again is a no-op
    expect(await c.trust.request(gui(), 'request.loop.trust', { loopId: 'one', scope: 'repo', repo: root, contentHash: v.contentHash })).toMatchObject({ trusted: true, changed: false });
  });

  it('a changed loop: paused, and its next card shows the diff against the trusted version', async () => {
    const root = repo([checkLoop('one', { title: 'Check A' })]);
    const c = cardRig();
    c.reg.addRepo(root);
    c.reg.scan();
    const first = (await c.trust.request(gui(), 'request.loop.trust', { loopId: 'one', scope: 'repo', repo: root })) as { cardId: string };
    await c.broker.approve(gui(), { cardId: first.cardId, decision: 'allow' });
    putLoop(root, checkLoop('one', { title: 'Check B' }));
    c.reg.scan();
    expect(c.reg.list()[0]).toMatchObject({ state: 'waiting-trust' });
    const second = (await c.trust.request(gui(), 'request.loop.trust', { loopId: 'one', scope: 'repo', repo: root })) as { cardId: string; previousHash: string };
    const text = JSON.stringify(c.broker.card(second.cardId)!.block);
    expect(text).toContain('Changes since the trusted version');
    expect(text).toContain('- Title: Check A');
    expect(text).toContain('+ Title: Check B');
    await c.broker.approve(gui(), { cardId: second.cardId, decision: 'allow' });
    expect(c.reg.list()[0]).toMatchObject({ state: 'trusted' });
  });

  it('a closure-only change takes the short card (just the closure diff), still root class with fresh presence', async () => {
    const root = repo([checkLoop('one')]);
    const c = cardRig();
    c.reg.addRepo(root);
    c.reg.scan();
    const first = (await c.trust.request(gui(), 'request.loop.trust', { loopId: 'one', scope: 'repo', repo: root })) as { cardId: string };
    await c.broker.approve(gui(), { cardId: first.cardId, decision: 'allow' });
    write(path.join(root, 'vitest.config.ts'), 'export default { x: 1 }\n');
    c.reg.scan();
    expect(c.reg.list()[0]).toMatchObject({ state: 'waiting-trust', reason: 'closure-changed' });
    const before = c.helper.evaluations;
    const res = (await c.trust.request(gui(), 'request.loop.trust', { loopId: 'one', scope: 'repo', repo: root })) as { cardId: string; closureOnly: boolean };
    expect(res.closureOnly).toBe(true);
    const text = ((c.broker.card(res.cardId)!.block as { children: Array<{ type: string; text?: string }> }).children).filter((x) => x.type === 'Text').map((x) => x.text).join('\n');
    expect(text).toContain('Accept the config change for loop one');
    expect(text).toMatch(/vitest\.config\.ts: sha256:[0-9a-f]{12} → sha256:[0-9a-f]{12}/);
    expect(text).not.toContain('Node t (check');
    const d = await c.broker.approve(gui(), { cardId: res.cardId, decision: 'allow' });
    expect(d.presence).toBe('fresh');
    expect(c.helper.evaluations).toBe(before + 1);
    expect(c.reg.list()[0]).toMatchObject({ state: 'trusted' });
  });

  it('TOCTOU: a loop that changes while its card is open is not trusted; a stale contentHash is refused', async () => {
    const root = repo([checkLoop('one')]);
    const c = cardRig();
    c.reg.addRepo(root);
    c.reg.scan();
    const v = c.reg.list()[0]!;
    expect((await refusal(c.trust.request(gui(), 'request.loop.trust', { loopId: 'one', scope: 'repo', repo: root, contentHash: `sha256:${'0'.repeat(64)}` }))).code).toBe('BAD_REQUEST');
    const res = (await c.trust.request(gui(), 'request.loop.trust', { loopId: 'one', scope: 'repo', repo: root, contentHash: v.contentHash })) as { cardId: string };
    write(path.join(root, 'bin', 'check'), '#!/usr/bin/env node\nprocess.exit(9)\n');
    await refusal(c.broker.approve(gui(), { cardId: res.cardId, decision: 'allow' }));
    expect(c.kinds()).not.toContain('loop.trusted');
    expect(c.reg.list()[0]!.state).toBe('untrusted');
  });

  it('G-LOOP-04: a standing grant and the cached unlock never carry it; voice, agents and `always` are refused', async () => {
    const root = repo([checkLoop('one')]);
    const c = cardRig();
    c.reg.addRepo(root);
    // a live standing grant of every tuple on this device (its touch leaves the device's cached unlock)
    const g = await c.grants.request(gui(), { tuples: ['mode.loosen:auto-edits', 'permission:always', 'voice.widen', 'voice-arm:allow', 'daemon-stop:restart'], repos: [repoKeyOf([root])] });
    await c.broker.approve(gui(), { cardId: g.cardId, decision: 'allow' });
    const before = c.helper.evaluations;
    const res = (await c.trust.request(gui(), 'request.loop.trust', { loopId: 'one', scope: 'repo', repo: root })) as { cardId: string };
    expect(await refusal(c.broker.approve(gui(), { cardId: res.cardId, decision: 'always' }))).toMatchObject({ code: 'BAD_REQUEST' });
    expect((await refusal(c.broker.approve({ ...gui(), principalClass: 'voice' }, { cardId: res.cardId, decision: 'allow' }))).code).toBe('FORBIDDEN');
    const d = await c.broker.approve(gui(), { cardId: res.cardId, decision: 'allow' });
    expect(d.presence).toBe('fresh');
    expect(c.helper.evaluations).toBe(before + 1);
    expect(c.logged.map((x) => x.kind)).not.toContain('grant.standing.used');
    // the request itself: the human on a gui or device connection only
    for (const asker of [{ ...gui(), principalClass: 'agent' }, { ...gui(), principalClass: 'voice' }, { ...gui(), credential: 'read-token' }]) {
      expect(await refusal(c.trust.request(asker, 'request.loop.trust', { loopId: 'one', scope: 'repo', repo: root }))).toMatchObject({ code: 'FORBIDDEN', reason: 'matrix' });
    }
  });

  it('TD-2026-10-22-769: a helper older than the loop-trust row table (1.9.0) refuses the card when it is RAISED: update the Gnomon app', async () => {
    const root = repo([checkLoop('one')]);
    const c = cardRig({ version: '1.8.0' });
    c.reg.addRepo(root);
    const e = await c.trust.request(gui(), 'request.loop.trust', { loopId: 'one', scope: 'repo', repo: root }).then(() => null, (x: unknown) => x as { refusal: { code: string; data: Record<string, unknown> }; message: string });
    expect(e?.refusal).toMatchObject({ code: 'UNSUPPORTED', data: { reason: 'presence', why: 'helper-too-old', minVersion: '1.9.0', helperVersion: '1.8.0' } });
    expect(e?.message).toMatch(/update the Gnomon app/);
    expect(c.logged.map((x) => x.kind)).not.toContain('approval.request');
    expect(c.helper.evaluations).toBe(0);
  });

  it('G-LOOP-04: without the root key the card cannot be allowed and nothing is trusted', async () => {
    const root = repo([checkLoop('one')]);
    const c = cardRig({}, false);
    c.reg.addRepo(root);
    const res = (await c.trust.request(gui(), 'request.loop.trust', { loopId: 'one', scope: 'repo', repo: root })) as { cardId: string };
    await expect(c.broker.approve(gui(), { cardId: res.cardId, decision: 'allow' })).rejects.toThrow(/root/i);
    expect(c.kinds()).toEqual([]);
    expect(c.reg.list()[0]!.state).toBe('untrusted');
  });

  it('untrust is a tightening (no presence); delete revokes and removes a personal loop file', async () => {
    const root = repo([checkLoop('one')]);
    const c = cardRig();
    c.reg.addRepo(root);
    const res = (await c.trust.request(gui(), 'request.loop.trust', { loopId: 'one', scope: 'repo', repo: root })) as { cardId: string };
    await c.broker.approve(gui(), { cardId: res.cardId, decision: 'allow' });
    const prompts = c.helper.evaluations;
    expect(await c.trust.request(gui(), 'request.loop.untrust', { loopId: 'one', scope: 'repo', repo: root })).toMatchObject({ untrusted: true });
    expect(c.helper.evaluations).toBe(prompts);
    expect(c.kinds()).toEqual(['loop.trusted', 'loop.untrusted']);
    expect(c.rows[1]!.payload).toMatchObject({ by: HUMAN });
    expect(c.reg.list()[0]!.state).toBe('untrusted');
    // personal delete
    const personal = path.join(c.home, 'loops');
    fs.mkdirSync(personal, { mode: 0o700 });
    fs.chmodSync(personal, 0o700);
    putLoop(root, { ...checkLoop('mine'), repo: root }, undefined, personal, 'personal');
    c.reg.scan();
    expect(await c.trust.request(gui(), 'request.loop.delete', { loopId: 'mine', scope: 'personal' })).toEqual({ deleted: true, removedFile: true });
    expect(fs.existsSync(path.join(personal, 'mine.loop.json'))).toBe(false);
    expect(c.kinds().at(-1)).toBe('loop.deleted');
    // the runner's verbs land later
    expect(await refusal(c.trust.request(gui(), 'request.loop.run', { loopId: 'one', scope: 'repo', repo: root }))).toMatchObject({ code: 'ENGINE', reason: 'not-implemented' });
  });
});

describe('diffLines', () => {
  it('marks removed and added lines only', () => {
    expect(diffLines(['a', 'b', 'c'], ['a', 'x', 'c', 'd'])).toEqual(['+ x', '- b', '+ d']);
    expect(diffLines([], [])).toEqual([]);
  });
});

