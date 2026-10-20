/**
 * TD-2026-10-20-086 F6 (#standing-grant, #approval-broker): the daily standing grant. One root-class `grant` card
 * mints grant.standing; a covered decision on the same GUI device then takes no presence prompt, records
 * approval.decide{presence:'standing:<id>'} and the notify row grant.standing.used; Revoke and the screen lock end
 * it; never-standing kinds still prompt; forged rows are ignored; a non-human, a CLI and another device can neither
 * mint nor use one. Platform-independent: the FakeHelper stands in for the signed helper.
 */
import { describe, expect, it } from 'vitest';
import { RefusedError, STANDING_GRANT_MAX_MS } from '@a-company/gnomon-contracts';
import { ApprovalBroker, StandingGrantBook, StandingGrants, standingTupleOf, unlockKeyOf } from '../src/kernel/broker/index.js';
import { HelperApprovalsKey } from '../src/kernel/identity/index.js';
import { DEV_TEST_ROOT_ACK, DevTestRootAuthority } from '../src/kernel/identity/root-authority.js';
import { SoftwareEd25519Signer } from '../src/kernel/log/signer.js';
import { FakeHelper } from './helper-fake.js';

const HUMAN = 'p:abcdefgh/matt';
const AGENT = 'p:abcdefgh/s-01hzzzzz';
const KERNEL = 'p:abcdefgh/kernel';
const GEN = 'test0001';
const A = 'conn:01HZZZZZZZZZZZZZZZZZZZZZZA';
const B = 'conn:01HZZZZZZZZZZZZZZZZZZZZZZB';
const C = 'conn:01HZZZZZZZZZZZZZZZZZZZZZZC';
const DEV = 'dev:01HZZZZZZZZZZZZZZZZZZZZZZD';
const DEV2 = 'dev:01HZZZZZZZZZZZZZZZZZZZZZZE';
const REPO = `sha256:${'a'.repeat(64)}`;
const OTHER = `sha256:${'b'.repeat(64)}`;
const NEW_BOUNDS = { idleSeconds: 12 * 3600, absoluteSeconds: 12 * 3600, maxSignatures: 512 };
const gui = (connId = A, deviceId = DEV) => ({ connId, principal: HUMAN, principalClass: 'human', surface: 'browser', credential: 'gui', deviceId });
const ALL = ['mode.loosen:auto-edits', 'permission:always', 'voice.widen', 'voice-arm:allow', 'daemon-stop:restart', 'reconsider:extend'];

function rig() {
  const helper = new FakeHelper(GEN, { bounds: NEW_BOUNDS });
  const approvals = new HelperApprovalsKey({ gen: GEN, approvalsPublicKeyPem: helper.publicPem('approvals') }, HUMAN, helper);
  const rows: Array<{ kind: string; payload: Record<string, unknown> }> = [];
  const now = { t: Date.UTC(2026, 9, 20, 9) };
  const log = async (kind: string, payload: Record<string, unknown>) => void rows.push({ kind, payload });
  const broker = new ApprovalBroker({ kernel: SoftwareEd25519Signer.generate('kernel'), kernelPrincipal: KERNEL, log, approvals, root: new DevTestRootAuthority(DEV_TEST_ROOT_ACK), clock: () => now.t, mono: () => now.t });
  const book = new StandingGrantBook({ principal: KERNEL, isKernelKey: (k) => k === 'kernel-key' });
  const grants = new StandingGrants({ broker, book: () => book, log, clock: () => now.t });
  broker.setStanding(grants);
  approvals.onHelperPush((p) => void broker.helperSessionEnded(p.cause));
  const mint = async (tuples = ALL, repos = [REPO], ctx = gui()) => {
    const r = await grants.request(ctx, { tuples, repos });
    await broker.approve(ctx, { cardId: r.cardId, decision: 'allow' });
    return r.cardId;
  };
  const loosen = (repo = REPO) => broker.raise({ kind: 'strictness', requestedBy: HUMAN, attended: true, detail: { op: 'mode.loosen', scope: { repo, hsid: null }, from: 'ask', to: 'auto-edits' }, lines: ['Loosen run mode'], decisions: ['allow', 'deny'] });
  const permission = (repo = REPO) => broker.raise({ kind: 'permission', requestedBy: AGENT, attended: true, detail: { tool: 'Bash', input: 'make' }, lines: ['Bash: make'], tool: 'Bash', toolInput: { command: 'make' }, ruleScope: { repoKey: repo } });
  const kinds = () => rows.map((r) => r.kind);
  return { helper, broker, rows, now, book, grants, mint, loosen, permission, kinds };
}

async function refusal(p: Promise<unknown>): Promise<Record<string, unknown>> {
  const e = await p.then(
    () => undefined,
    (x: unknown) => x,
  );
  expect(e).toBeInstanceOf(RefusedError);
  return { code: (e as RefusedError).refusal.code, reason: (e as RefusedError).refusal.data?.reason };
}

describe('F6: minting a standing grant', () => {
  it('one grant card (root class: one fresh presence + the root key) mints grant.standing for this device, ≤ 12 h', async () => {
    const r = rig();
    const id = await r.mint();
    expect(r.helper.prompts.length).toBe(1);
    const row = r.rows.find((x) => x.kind === 'grant.standing')!.payload;
    expect(row).toMatchObject({ grantId: id, cardId: id, tuples: [...ALL].sort(), repos: [REPO], device: unlockKeyOf(gui()), by: HUMAN });
    expect(Date.parse(String(row.expiresAt)) - r.now.t).toBe(STANDING_GRANT_MAX_MS);
    expect(r.kinds().indexOf('request.grant.standing')).toBeLessThan(r.kinds().indexOf('grant.standing'));
    expect(r.rows.find((x) => x.kind === 'approval.decide')!.payload).toMatchObject({ cardId: id, decision: 'allow', presence: 'fresh' });
    expect(r.grants.status()).toMatchObject({ built: true, active: [{ grantId: id, uses: 0 }] });
  });

  it('FALSIFIER: a non-human, a CLI (device credential) or a GUI without a device can never mint one', async () => {
    const r = rig();
    for (const asker of [{ ...gui(), principalClass: 'agent' }, { ...gui(), principalClass: 'voice' }, { ...gui(), credential: 'device' }, { ...gui(), deviceId: '' }]) {
      expect(await refusal(r.grants.request(asker, { tuples: ALL, repos: [REPO] }))).toMatchObject({ code: 'FORBIDDEN', reason: 'matrix' });
    }
    expect(await refusal(r.grants.request(gui(), { tuples: ['install'], repos: [] }))).toMatchObject({ code: 'BAD_REQUEST' });
    expect(r.kinds()).not.toContain('request.grant.standing');
  });
});

describe('F6: using it', () => {
  it('a covered mode loosen takes NO prompt: approval.decide{presence standing:<id>} then grant.standing.used', async () => {
    const r = rig();
    const id = await r.mint();
    const c = await r.loosen();
    const d = await r.broker.approve(gui(), { cardId: c.cardId, decision: 'allow' });
    expect(d.presence).toBe(`standing:${id}`);
    expect(r.helper.prompts.length).toBe(1);
    const decideAt = r.rows.findIndex((x) => x.kind === 'approval.decide' && x.payload.cardId === c.cardId);
    expect(r.rows[decideAt]!.payload).toMatchObject({ presence: `standing:${id}` });
    expect(r.rows[decideAt + 1]).toMatchObject({ kind: 'grant.standing.used', payload: { grantId: id, cardId: c.cardId, tuple: 'mode.loosen:auto-edits', decision: 'allow', repo: REPO } });
  });

  it('a permission `always` in a granted repo is standing and still learns the rule', async () => {
    const r = rig();
    const id = await r.mint();
    const c = await r.permission();
    expect((await r.broker.approve(gui(), { cardId: c.cardId, decision: 'always' })).presence).toBe(`standing:${id}`);
    expect(r.rows.find((x) => x.kind === 'approval.rule.learned')!.payload).toMatchObject({ presence: `standing:${id}`, repoKey: REPO });
    expect(r.helper.prompts.length).toBe(1);
  });

  it('the unlock survives a reconnect, so the grant does too (same device, new connection)', async () => {
    const r = rig();
    const id = await r.mint(ALL, [REPO], gui(A));
    await r.broker.connectionClosed(A);
    expect((await r.broker.approve(gui(B), { cardId: (await r.loosen()).cardId, decision: 'allow' })).presence).toBe(`standing:${id}`);
  });

  it('a repo the grant does not name, another device, or a CLI connection still prompts', async () => {
    const r = rig();
    await r.mint();
    expect((await r.broker.approve(gui(), { cardId: (await r.loosen(OTHER)).cardId, decision: 'allow' })).presence).toBe('fresh');
    expect((await r.broker.approve(gui(B, DEV2), { cardId: (await r.loosen()).cardId, decision: 'allow' })).presence).toBe('fresh');
    const cli = { connId: C, principal: HUMAN, principalClass: 'human', surface: 'cli', credential: 'device', deviceId: DEV };
    expect((await r.broker.approve(cli, { cardId: (await r.loosen()).cardId, decision: 'allow' })).presence).toBe('cli');
    expect(r.kinds()).not.toContain('grant.standing.used');
  });

  it('FALSIFIER: never-standing kinds still prompt — gate-class, fallback-cloud, install, a peer-flagged always, an upgrade (binary change)', async () => {
    const r = rig();
    await r.mint();
    let prompts = r.helper.prompts.length;
    const cases: Array<[Parameters<ApprovalBroker['raise']>[0], string]> = [
      [{ kind: 'gate-class', requestedBy: AGENT, attended: true, detail: { path: '.claude/settings.json' }, lines: ['gate'], decisions: ['allow', 'deny'] }, 'allow'],
      [{ kind: 'fallback', requestedBy: AGENT, attended: true, detail: { model: 'x' }, lines: ['fallback'] }, 'fallback-cloud'],
      [{ kind: 'permission', requestedBy: AGENT, attended: true, detail: { tool: 'Bash' }, lines: ['peer'], tool: 'Bash', toolInput: { command: 'ls' }, flags: ['peer'], ruleScope: { repoKey: REPO } }, 'allow'],
      [{ kind: 'daemon-stop', requestedBy: KERNEL, attended: true, detail: { reason: 'upgrade', connId: 'kernel', update: 'a new build' }, lines: ['upgrade'], decisions: ['accept', 'reject'] }, 'accept'],
      [{ kind: 'declassify', requestedBy: AGENT, attended: true, detail: { what: 'x' }, lines: ['declassify'] }, 'accept'],
    ];
    for (const [input, decision] of cases) {
      const c = await r.broker.raise(input);
      const d = await r.broker.approve(gui(), { cardId: c.cardId, decision });
      expect(String(d.presence), `${String(input.kind)} ${decision}`).not.toMatch(/^standing:/);
      expect(r.helper.prompts.length, `${String(input.kind)} prompted`).toBe(++prompts);
    }
    expect(r.kinds()).not.toContain('grant.standing.used');
    // the policy itself: no tuple for root/install, gate-class, fallback, declassify, peer or a binary change
    expect(standingTupleOf({ kind: 'install' }, 'install', {}, REPO)).toBeNull();
    expect(standingTupleOf({ kind: 'gate-class' }, 'allow', {}, REPO)).toBeNull();
    expect(standingTupleOf({ kind: 'permission', flags: ['peer'] }, 'always', {}, REPO)).toBeNull();
    expect(standingTupleOf({ kind: 'daemon-stop' }, 'accept', { reason: 'upgrade', update: 'x', binaryUnchanged: true }, null)).toBeNull();
    expect(standingTupleOf({ kind: 'daemon-stop' }, 'accept', { reason: 'upgrade', binaryUnchanged: true }, null)).toEqual({ tuple: 'daemon-stop:restart', repo: null });
    expect(standingTupleOf({ kind: 'strictness' }, 'allow', { op: 'mode.loosen', to: 'ask', scope: { repo: REPO } }, null)).toBeNull();
    expect(standingTupleOf({ kind: 'reconsider' }, 'extend', { repo: REPO }, null)).toEqual({ tuple: 'reconsider:extend', repo: REPO });
  });
});

describe('F6: it ends', () => {
  it('FALSIFIER: expiry — past expiresAt the same decision prompts again', async () => {
    const r = rig();
    await r.mint();
    r.now.t += STANDING_GRANT_MAX_MS + 1;
    expect(r.grants.status()).toMatchObject({ active: [] });
    expect((await r.broker.approve(gui(), { cardId: (await r.loosen()).cardId, decision: 'allow' })).presence).toBe('fresh');
  });

  it('FALSIFIER: Revoke is a tighten with no presence; the next use prompts', async () => {
    const r = rig();
    const id = await r.mint();
    const prompts = r.helper.prompts.length;
    expect(await r.grants.revoke(gui(), { grantId: id })).toEqual({ revoked: true, grantId: id });
    expect(r.helper.prompts.length).toBe(prompts);
    expect(r.rows.find((x) => x.kind === 'grant.standing.revoked')!.payload).toEqual({ grantId: id, by: HUMAN, reason: 'human' });
    expect((await r.broker.approve(gui(), { cardId: (await r.loosen()).cardId, decision: 'allow' })).presence).toBe('fresh');
    expect(await refusal(r.grants.revoke({ ...gui(), principalClass: 'agent' }, { grantId: id }))).toMatchObject({ code: 'FORBIDDEN' });
  });

  it('FALSIFIER: the screen lock ends every grant (grant.standing.revoked{reason screen-lock})', async () => {
    const r = rig();
    const id = await r.mint();
    r.helper.sessionEvent('screen-lock');
    await new Promise((res) => setTimeout(res, 0));
    expect(r.rows.find((x) => x.kind === 'grant.standing.revoked')!.payload).toEqual({ grantId: id, by: null, reason: 'screen-lock' });
    expect((await r.broker.approve(gui(), { cardId: (await r.loosen()).cardId, decision: 'allow' })).presence).toBe('fresh');
  });
});

describe('F6: the fold reads kernel-signed rows only', () => {
  const grantRow = (over: Record<string, unknown> = {}) => ({ seq: 1, kind: 'grant.standing', principal: KERNEL, keyId: 'kernel-key', payload: { grantId: 'card:01HZZZZZZZZZZZZZZZZZZZZZZG', cardId: 'card:01HZZZZZZZZZZZZZZZZZZZZZZG', tuples: ['permission:always', 'install:install'], repos: [REPO, 'not-a-repo'], device: unlockKeyOf(gui()), expiresAt: new Date(Date.UTC(2026, 9, 20, 20)).toISOString(), by: HUMAN }, ...over });
  const now = Date.UTC(2026, 9, 20, 9);

  it('a kernel-signed row folds (unknown tuples and bad repos dropped)', () => {
    const b = new StandingGrantBook({ principal: KERNEL, isKernelKey: (k) => k === 'kernel-key' });
    b.fold(grantRow());
    expect(b.active(now)).toEqual([expect.objectContaining({ tuples: ['permission:always'], repos: [REPO] })]);
  });

  it('FALSIFIER: a forged grant (another principal, a non-kernel key) covers nothing; a forged revoke ends nothing', () => {
    const b = new StandingGrantBook({ principal: KERNEL, isKernelKey: (k) => k === 'kernel-key' });
    b.fold(grantRow({ principal: AGENT }));
    b.fold(grantRow({ keyId: 'agent-key' }));
    expect(b.active(now)).toEqual([]);
    b.fold(grantRow());
    b.fold({ seq: 2, kind: 'grant.standing.revoked', principal: AGENT, keyId: 'agent-key', payload: { grantId: 'card:01HZZZZZZZZZZZZZZZZZZZZZZG', by: AGENT, reason: 'human' } });
    expect(b.active(now)).toHaveLength(1);
    b.fold({ seq: 3, kind: 'grant.standing.revoked', principal: KERNEL, keyId: 'kernel-key', payload: { grantId: 'card:01HZZZZZZZZZZZZZZZZZZZZZZG', by: HUMAN, reason: 'human' } });
    expect(b.active(now)).toEqual([]);
    expect(b.lastSeq).toBe(3);
  });

  it('a non-human connection never USES a grant (match answers null), even on the granted device', () => {
    const b = new StandingGrantBook({ principal: KERNEL, isKernelKey: (k) => k === 'kernel-key' });
    b.fold(grantRow());
    const g = new StandingGrants({ broker: { raise: async () => { throw new Error('no'); }, card: () => undefined }, book: () => b, log: async () => undefined, clock: () => now });
    const card = { kind: 'permission' } as never;
    expect(g.match(gui() as never, card, 'always', {}, REPO)).toMatchObject({ tuple: 'permission:always' });
    expect(g.match({ ...gui(), principalClass: 'agent' } as never, card, 'always', {}, REPO)).toBeNull();
    expect(g.match({ ...gui(), credential: 'device' } as never, card, 'always', {}, REPO)).toBeNull();
    expect(g.match({ ...gui(), principalClass: 'voice' } as never, card, 'always', {}, REPO)).toBeNull();
  });
});
