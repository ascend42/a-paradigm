/**
 * TD-2026-10-20-514 (G-ID-09, G-ID-10): EXACTLY ONE presence evaluation per card decision, root-class included,
 * counted by the CountingFakeHelper (helper 1.8.0 decision.sign) through the real HelperApprovalsKey, the real
 * HardwareRootAuthority (its synchronous `once` seam THROWS if anything calls it) and the real broker. Falsifiers:
 * nothing is appended and the card stays pending on a bad signature or a declined prompt; a concurrent pin between
 * prepare and commit refuses; re-submitted signatures refuse; a prompt held 90 s still installs; a second root
 * decision of the same home is refused at once. Platform-independent (no helper binary, no codesign); tmp paths
 * only, never a card id in a file name.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RefusedError } from '@a-company/gnomon-contracts';
import { ApprovalBroker, raiseInstallCard } from '../src/kernel/broker/index.js';
import { SoftwareEd25519Signer } from '../src/kernel/log/signer.js';
import { HardwareRootAuthority, HelperApprovalsKey } from '../src/kernel/identity/index.js';
import { appendGrantRow, appendSignedGrantRows, grantsPath, MANIFEST_FILE, readGrants, removeTree, stageInstall } from '../src/kernel/manifest/index.js';
import { CountingFakeHelper, FakeHelper } from './helper-fake.js';

const HUMAN = 'p:abcdefgh/matt';
const AGENT = 'p:abcdefgh/s-01hzzzzz';
const GEN = 'test0001';
const gui = (n = 'A') => ({ connId: `conn:01HZZZZZZZZZZZZZZZZZZZZZZ${n}`, principal: HUMAN, principalClass: 'human', surface: 'browser', credential: 'gui' });

const tmps: string[] = [];
function tmp(): string {
  const d = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'gnomon-1p-')));
  tmps.push(d);
  return d;
}
afterEach(() => {
  vi.restoreAllMocks();
  while (tmps.length) removeTree(tmps.pop()!);
});

function rig(opts: ConstructorParameters<typeof FakeHelper>[1] = {}, legacy = false) {
  const helper = legacy ? new FakeHelper(GEN, opts) : new CountingFakeHelper(GEN, opts);
  const approvals = new HelperApprovalsKey({ gen: GEN, approvalsPublicKeyPem: helper.publicPem('approvals') }, HUMAN, helper);
  let onceCalls = 0;
  const root = new HardwareRootAuthority({ gen: GEN, rootPublicKeyPem: helper.publicPem('root') }, { helper, once: () => { onceCalls++; throw new Error('the synchronous once seam is never used on the daemon path'); } });
  const rows: Array<{ kind: string; payload: Record<string, unknown> }> = [];
  const broker = new ApprovalBroker({ kernel: SoftwareEd25519Signer.generate('kernel'), kernelPrincipal: 'p:abcdefgh/kernel', log: async (kind, payload) => void rows.push({ kind, payload }), approvals, root });
  return { helper, approvals, root, broker, rows, onceCalls: () => onceCalls };
}

function stage(home: string, requires: Record<string, unknown> = { capabilities: [], egress: 'none' }, name = 'diff-lens'): string {
  const src = path.join(tmp(), name);
  fs.mkdirSync(src, { recursive: true });
  fs.writeFileSync(path.join(src, MANIFEST_FILE), JSON.stringify({ manifest: 2, publisher: 'acme', kind: 'mod', name, version: '1.0.0', abi: 'mod-abi:v1', provides: { tools: [{ name: 'lens.diff', effects: ['read'] }] }, requires }));
  const verify = new HardwareRootAuthority({ gen: GEN, rootPublicKeyPem: new FakeHelper(GEN).publicPem('root') }, {});
  const st = stageInstall({ home, source: src, via: 'package', requestedBy: AGENT, trust: verify });
  if (st.state !== 'staged') throw new Error('expected staged');
  return st.cardId;
}

const grantsBytes = (home: string): string => (fs.existsSync(grantsPath(home)) ? fs.readFileSync(grantsPath(home), 'utf8') : '');

async function refusal(p: Promise<unknown>): Promise<RefusedError> {
  const e = await p.then(() => undefined, (x: unknown) => x);
  expect(e).toBeInstanceOf(RefusedError);
  return e as RefusedError;
}

describe('G-ID-09: one presence per install decision (helper 1.8.0)', () => {
  it('install, minimal rows (trust + install): ONE prompt, the rows land, the once seam is never called', async () => {
    const home = tmp();
    const r = rig();
    const card = await raiseInstallCard(r.broker, { home, name: 'acme.diff-lens', cardId: stage(home), authority: r.root });
    const d = await r.broker.approve(gui(), { cardId: card.cardId, decision: 'install' });
    expect(d.state).toBe('decided');
    expect(r.helper.evaluations).toBe(1);
    expect(r.onceCalls()).toBe(0);
    const g = readGrants(home, r.root);
    expect(g.rejected).toEqual([]);
    expect(g.installs.map((x) => x.cardId)).toEqual([card.cardId]);
    const decide = r.rows.find((x) => x.kind === 'approval.decide')!.payload;
    expect(decide.rootSig).toBeDefined();
    expect(decide.rowsDigest).toMatch(/^sha256:/);
    expect(r.helper.shown[0]).toContain('install acme.diff-lens from package');
  });

  it('install with capability + egress rows (4 grant rows): still ONE prompt, every row anchored by the install', async () => {
    const home = tmp();
    const r = rig();
    const card = await raiseInstallCard(r.broker, { home, name: 'acme.diff-lens', cardId: stage(home, { capabilities: ['log.append:modns.acme.diff-lens.*'], egress: [{ host: 'api.example.com', purpose: 'p' }] }), authority: r.root });
    await r.broker.approve(gui(), { cardId: card.cardId, decision: 'install' });
    expect(r.helper.evaluations).toBe(1);
    const lines = grantsBytes(home).trim().split('\n').map((l) => JSON.parse(l).row.kind);
    expect(lines).toEqual(['grant.trust', 'grant.capability', 'grant.egress', 'grant.install']);
    const g = readGrants(home, r.root);
    expect(g.rejected).toEqual([]);
    expect([...g.egress.values()].map((s) => [...s])).toEqual([['api.example.com']]);
    expect(r.helper.shown[0]).toContain('egress api.example.com');
  });

  it('install deny: ONE prompt, no row', async () => {
    const home = tmp();
    const r = rig();
    const card = await raiseInstallCard(r.broker, { home, name: 'acme.diff-lens', cardId: stage(home), authority: r.root });
    await r.broker.approve(gui(), { cardId: card.cardId, decision: 'deny' });
    expect(r.helper.evaluations).toBe(1);
    expect(grantsBytes(home)).toBe('');
  });

  it('a helper below 1.8.0 takes the legacy path: the same rows, one prompt per signature (Aegis C6)', async () => {
    const home = tmp();
    const r = rig({}, true);
    const card = await raiseInstallCard(r.broker, { home, name: 'acme.diff-lens', cardId: stage(home), authority: r.root });
    await r.broker.approve(gui(), { cardId: card.cardId, decision: 'install' });
    expect(r.helper.evaluations).toBe(4); // decision + decision row + trust + install
    expect(readGrants(home, r.root).installs).toHaveLength(1);
    expect(r.onceCalls()).toBe(0);
  });
});

describe('G-ID-10: nothing appended on failure; the card stays pending', () => {
  for (const [what, opts] of [
    ['a bad root signature', { corruptSig: 3 }],
    ['a declined prompt', { touch: false }],
    ['a replaced helper line', { shown: 'Gnomon Helper: nothing to see' }],
  ] as const) {
    it(`${what}: grants.jsonl byte-identical, card pending`, async () => {
      const home = tmp();
      const r = rig(opts);
      const card = await raiseInstallCard(r.broker, { home, name: 'acme.diff-lens', cardId: stage(home), authority: r.root });
      const before = grantsBytes(home);
      await refusal(r.broker.approve(gui(), { cardId: card.cardId, decision: 'install' }));
      expect(grantsBytes(home)).toBe(before);
      expect(r.broker.card(card.cardId)!.state).toBe('pending');
    });
  }

  it('a concurrent pin row between prepare and commit refuses; nothing of the decision is appended', async () => {
    const home = tmp();
    let inject = (): void => undefined;
    const r = rig({ duringPrompt: () => inject() });
    const cardId = stage(home);
    const card = await raiseInstallCard(r.broker, { home, name: 'acme.diff-lens', cardId, authority: r.root });
    const other = new HardwareRootAuthority({ gen: GEN, rootPublicKeyPem: r.helper.publicPem('root') }, { once: (req) => r.helper.handle(req) });
    inject = () => {
      inject = () => undefined;
      appendGrantRow(home, other, { kind: 'grant.install', name: 'acme.diff-lens', manifestHash: `sha256:${'1'.repeat(64)}`, packageHash: `sha256:${'2'.repeat(64)}`, cardId: 'card:01HZZZZZZZZZZZZZZZZZZZZZZQ', source: 'package' });
    };
    const mid = (): string => grantsBytes(home);
    await refusal(r.broker.approve(gui(), { cardId: card.cardId, decision: 'install' }));
    const after = mid();
    expect(after.trim().split('\n')).toHaveLength(1); // only the concurrent row
    expect(r.broker.card(card.cardId)!.state).toBe('pending');
  });

  it('re-submitting the same signed rows is refused (replay), nothing appended', async () => {
    const home = tmp();
    const r = rig();
    const card = await raiseInstallCard(r.broker, { home, name: 'acme.diff-lens', cardId: stage(home), authority: r.root });
    await r.broker.approve(gui(), { cardId: card.cardId, decision: 'install' });
    const lines = grantsBytes(home).trim().split('\n').map((l) => JSON.parse(l) as { row: never; signer: string; sig: string });
    const before = grantsBytes(home);
    expect(() => appendSignedGrantRows(home, r.root, lines.map((l) => l.row), lines.map((l) => ({ signer: l.signer, sig: l.sig })))).toThrow(/moved|stale/);
    expect(grantsBytes(home)).toBe(before);
  });

  it('a prompt held 90 s still installs (challenge TTL 120 s; the token is minted after the touch)', async () => {
    const home = tmp();
    const t0 = performance.now();
    const r = rig({ duringPrompt: () => void vi.spyOn(performance, 'now').mockImplementation(() => t0 + 90_000) });
    const card = await raiseInstallCard(r.broker, { home, name: 'acme.diff-lens', cardId: stage(home), authority: r.root });
    await r.broker.approve(gui(), { cardId: card.cardId, decision: 'install' });
    expect(readGrants(home, r.root).installs).toHaveLength(1);
  });

  it('C5d: a second root decision of the same home while one is in flight is refused at once (never queued)', async () => {
    const home = tmp();
    let second: Promise<unknown> | null = null;
    const r = rig({ duringPrompt: () => void (second = r.broker.approve(gui('B'), { cardId: card2.cardId, decision: 'install' }).then(() => 'ok', (e: unknown) => e)) });
    const card1 = await raiseInstallCard(r.broker, { home, name: 'acme.diff-lens', cardId: stage(home), authority: r.root });
    const card2 = await raiseInstallCard(r.broker, { home, name: 'acme.other-lens', cardId: stage(home, undefined, 'other-lens'), authority: r.root });
    await r.broker.approve(gui(), { cardId: card1.cardId, decision: 'install' });
    const e = (await second) as RefusedError;
    expect(e).toBeInstanceOf(RefusedError);
    expect((e.refusal.data as { why?: string }).why).toBe('busy');
    expect(r.broker.card(card2.cardId)!.state).toBe('pending');
  });

  it('C5b: a supporting row without its anchor grants nothing; C5a: a torn tail is repaired before the next write', () => {
    const home = tmp();
    const h = new FakeHelper(GEN);
    const root = new HardwareRootAuthority({ gen: GEN, rootPublicKeyPem: h.publicPem('root') }, { once: (req) => h.handle(req) });
    appendGrantRow(home, root, { kind: 'grant.trust', manifestHash: `sha256:${'1'.repeat(64)}`, tier: 'local', cardId: 'card:01HZZZZZZZZZZZZZZZZZZZZZZQ' });
    expect(readGrants(home, root).rejected.map((x) => x.reason)).toEqual(['unanchored']);
    expect(readGrants(home, root).trust.size).toBe(0);
    fs.appendFileSync(grantsPath(home), '{"torn":');
    appendGrantRow(home, root, { kind: 'grant.trust', manifestHash: `sha256:${'2'.repeat(64)}`, tier: 'local' });
    const g = readGrants(home, root);
    expect(g.trust.get(`sha256:${'2'.repeat(64)}`)).toBe('local'); // the new row did not fuse with the torn line
  });
});
