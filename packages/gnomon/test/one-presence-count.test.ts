/**
 * TD-2026-10-20-514 item 4: the presence COUNT of every decision family, through the real broker, the real
 * HelperApprovalsKey / HardwareRootAuthority and the CountingFakeHelper (helper 1.8.0 decision.sign). Exactly ONE
 * fresh evaluation per decision unless noted (a permission under a cached unlock = 0). The raise inputs mirror the
 * production raisers (desk/mcp-passthrough.ts, broker/api-token.ts, broker/standing-grant.ts, runner/repin-card.ts,
 * broker/daemon-stop.ts, broker/install-card.ts). Platform-independent: no helper binary, tmp paths, no card id in a
 * file name.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ApprovalBroker, raiseInstallCard, type RaiseInput } from '../src/kernel/broker/index.js';
import { SoftwareEd25519Signer } from '../src/kernel/log/signer.js';
import { HardwareRootAuthority, HelperApprovalsKey } from '../src/kernel/identity/index.js';
import { grantsPath, MANIFEST_FILE, readGrants, removeTree, stageInstall } from '../src/kernel/manifest/index.js';
import { CountingFakeHelper, FakeHelper } from './helper-fake.js';

const HUMAN = 'p:abcdefgh/matt';
const GEN = 'test0001';
const HSID = 'hsid:v1:01HZZZZZZZZZZZZZZZZZZZZZZA';
const gui = () => ({ connId: 'conn:01HZZZZZZZZZZZZZZZZZZZZZZA', principal: HUMAN, principalClass: 'human', surface: 'browser', credential: 'gui' });

const tmps: string[] = [];
function tmp(): string {
  const d = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'gnomon-1pc-')));
  tmps.push(d);
  return d;
}
afterEach(() => {
  while (tmps.length) removeTree(tmps.pop()!);
});

function rig() {
  const helper = new CountingFakeHelper(GEN);
  const approvals = new HelperApprovalsKey({ gen: GEN, approvalsPublicKeyPem: helper.publicPem('approvals') }, HUMAN, helper);
  const root = new HardwareRootAuthority({ gen: GEN, rootPublicKeyPem: helper.publicPem('root') }, { helper, once: () => { throw new Error('never the once seam'); } });
  const rows: Array<{ kind: string; payload: Record<string, unknown> }> = [];
  const broker = new ApprovalBroker({ kernel: SoftwareEd25519Signer.generate('kernel'), kernelPrincipal: 'p:abcdefgh/kernel', log: async (kind, payload) => void rows.push({ kind, payload }), approvals, root });
  let base = 0;
  return { helper, root, broker, rows, mark: () => void (base = helper.evaluations), prompts: () => helper.evaluations - base };
}

type R = ReturnType<typeof rig>;
async function decide(r: R, input: RaiseInput, decision: string): Promise<{ applied: string[] }> {
  const applied: string[] = [];
  const card = await r.broker.raise({ ...input, effect: (d) => void applied.push(d) });
  r.mark();
  const out = await r.broker.approve(gui(), { cardId: card.cardId, decision });
  expect(out.state).toBe('decided');
  return { applied };
}

const mcpConfig = (): RaiseInput => ({ kind: 'grant', requestedBy: HUMAN, attended: true, detail: { action: 'mod.mcp.config', name: 'acme.diff-lens', server: 'gm_acme_diff-lens', launchHash: `sha256:${'a'.repeat(64)}`, envNames: [], requestedVia: 'request-file' }, lines: ['Change the MCP launch of acme.diff-lens'], decisions: ['allow', 'deny'] });

describe('G-ID-09 counts: exactly one presence per decision', () => {
  for (const d of ['allow', 'deny']) {
    it(`mod.mcp.config ${d}: 1`, async () => {
      const r = rig();
      const { applied } = await decide(r, mcpConfig(), d);
      expect(r.prompts()).toBe(1);
      expect(applied).toEqual([d]);
      if (d === 'allow') expect(r.rows.find((x) => x.kind === 'approval.decide')!.payload.rootKind).toBe('mod.mcp.config');
    });
  }

  it('api-token use-api-token: 1', async () => {
    const r = rig();
    await decide(r, { kind: 'api-token', requestedBy: HUMAN, hsid: HSID, attended: true, detail: { hsid: HSID, reason: 'batch job', ttlMs: 3_600_000, use: 'one session' }, lines: ['Bill API credits for ONE session'] }, 'use-api-token');
    expect(r.prompts()).toBe(1);
    expect(r.rows.find((x) => x.kind === 'approval.decide')!.payload.rootSig).toBeDefined();
  });

  it('permission allow, fresh: 1; the next permission allow under the cached unlock: 0', async () => {
    const r = rig();
    const perm = (n: string): RaiseInput => ({ kind: 'permission', requestedBy: 'p:abcdefgh/s-01hzzzzz', hsid: HSID, attended: true, detail: { tool: 'Read', inputHash: `sha256:${n.repeat(64)}` }, lines: [`The session asks to run Read ${n}`] });
    await decide(r, perm('1'), 'allow');
    expect(r.prompts()).toBe(1);
    await decide(r, perm('2'), 'allow');
    expect(r.prompts()).toBe(0);
  });

  it('standing-grant allow: 1 (fresh, no root key)', async () => {
    const r = rig();
    await decide(r, { kind: 'grant', requestedBy: HUMAN, attended: true, standingGrant: true, detail: { action: 'standing.grant', scope: 'Read', ttlMs: 600_000 }, lines: ['Allow Read for 10 minutes'], decisions: ['allow', 'deny'] }, 'allow');
    expect(r.prompts()).toBe(1);
    expect(r.rows.find((x) => x.kind === 'approval.decide')!.payload.rootSig).toBeUndefined();
  });

  it('claude re-pin allow: 1', async () => {
    const r = rig();
    await decide(r, { kind: 'gate-class', requestedBy: 'p:abcdefgh/kernel', attended: true, detail: { target: 'claude-binary', from: `sha256:${'1'.repeat(64)}`, to: `sha256:${'2'.repeat(64)}`, version: '2.1.0', source: '/usr/local/bin/claude', signer: { team: 'Q6L2SF6YDW', verified: true, previous: 'Q6L2SF6YDW', expected: 'Q6L2SF6YDW' } }, lines: ['Re-pin the claude binary'], decisions: ['allow', 'deny'] }, 'allow');
    expect(r.prompts()).toBe(1);
  });

  it('daemon-stop accept: 1', async () => {
    const r = rig();
    await decide(r, { kind: 'daemon-stop', requestedBy: HUMAN, attended: true, detail: { reason: 'stop', connId: gui().connId }, lines: ['Stop the Gnomon kernel'], decisions: ['accept', 'reject'] }, 'accept');
    expect(r.prompts()).toBe(1);
  });

  it('install with ALL FIVE grant rows (trust, capability, egress, publisher binding, install): 1', async () => {
    const home = tmp();
    const r = rig();
    const src = path.join(tmp(), 'board');
    fs.mkdirSync(src, { recursive: true });
    fs.writeFileSync(path.join(src, MANIFEST_FILE), JSON.stringify({ manifest: 2, publisher: 'acme', kind: 'mod', name: 'board', version: '1.0.0', abi: 'mod-abi:v1', provides: { tools: [{ name: 'lens.diff', effects: ['read'] }] }, requires: { capabilities: ['log.append:modns.acme.board.*'], egress: [{ host: 'api.example.com', purpose: 'p' }] } }));
    const verify = new HardwareRootAuthority({ gen: GEN, rootPublicKeyPem: new FakeHelper(GEN).publicPem('root') }, {});
    const st = stageInstall({ home, source: src, via: 'git', git: { url: 'https://gitlab.com/acme/board', commit: 'b'.repeat(40) }, requestedBy: HUMAN, trust: verify });
    if (st.state !== 'staged') throw new Error('expected staged');
    const card = await raiseInstallCard(r.broker, { home, name: 'acme.board', cardId: st.cardId, authority: r.root });
    r.mark();
    await r.broker.approve(gui(), { cardId: card.cardId, decision: 'install' });
    expect(r.prompts()).toBe(1);
    const kinds = fs.readFileSync(grantsPath(home), 'utf8').trim().split('\n').map((l) => JSON.parse(l).row.kind);
    expect(kinds).toEqual(['grant.trust', 'grant.capability', 'grant.egress', 'grant.publisher', 'grant.install']);
    const g = readGrants(home, r.root);
    expect(g.rejected).toEqual([]);
    expect(g.publishers.get('acme')).toMatchObject({ host: 'gitlab.com', namespace: 'acme' });
  });
});

describe('Q2: status.helper.batch', () => {
  it("'available' on a 1.8.0 helper; 'unavailable (helper <1.8.0)' on an older one", async () => {
    expect(await rig().broker.refreshHelperBatch()).toBe('available');
    const old = new FakeHelper(GEN);
    const approvals = new HelperApprovalsKey({ gen: GEN, approvalsPublicKeyPem: old.publicPem('approvals') }, HUMAN, old);
    const b = new ApprovalBroker({ kernel: SoftwareEd25519Signer.generate('kernel'), kernelPrincipal: 'p:abcdefgh/kernel', log: async () => undefined, approvals });
    expect(b.helperBatch()).toBeNull();
    expect(await b.refreshHelperBatch()).toBe('unavailable (helper <1.8.0)');
    expect(b.helperBatch()).toBe('unavailable (helper <1.8.0)');
  });
});
