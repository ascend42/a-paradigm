/**
 * 8.0:loops (docs/specs/gnomon-loops.md §3.1, §3.3; build step 2): the #approval-broker class rows of the two loop
 * card kinds. loop-trust allow is ROOT class (fresh presence AND the root key, like `grant`), never standing, never
 * `always`, never by voice. loop-choice continue is fresh and hand-only; stop is deny-direction (cached).
 */
import { describe, expect, it } from 'vitest';
import { RefusedError, voiceDecisionCheck } from '@a-company/gnomon-contracts';
import { ApprovalBroker, NEVER_STANDING_KINDS, StandingGrantBook, StandingGrants, standingTupleOf } from '../src/kernel/broker/index.js';
import { baseClass, KIND_DECISIONS, STANDING_DECISIONS, validDecisions } from '../src/kernel/broker/classes.js';
import { HelperApprovalsKey } from '../src/kernel/identity/index.js';
import { DEV_TEST_ROOT_ACK, DevTestRootAuthority } from '../src/kernel/identity/root-authority.js';
import { SoftwareEd25519Signer } from '../src/kernel/log/signer.js';
import { FakeHelper } from './helper-fake.js';

const HUMAN = 'p:abcdefgh/matt';
const KERNEL = 'p:abcdefgh/kernel';
const GEN = 'test0001';
const A = 'conn:01HZZZZZZZZZZZZZZZZZZZZZZA';
const DEV = 'dev:01HZZZZZZZZZZZZZZZZZZZZZZD';
const REPO = `sha256:${'a'.repeat(64)}`;
const NEW_BOUNDS = { idleSeconds: 12 * 3600, absoluteSeconds: 12 * 3600, maxSignatures: 512 };
const ALL = ['mode.loosen:auto-edits', 'permission:always', 'voice.widen', 'voice-arm:allow', 'daemon-stop:restart'];
const gui = () => ({ connId: A, principal: HUMAN, principalClass: 'human', surface: 'browser', credential: 'gui', deviceId: DEV });

function rig() {
  const helper = new FakeHelper(GEN, { bounds: NEW_BOUNDS });
  const approvals = new HelperApprovalsKey({ gen: GEN, approvalsPublicKeyPem: helper.publicPem('approvals') }, HUMAN, helper);
  const rows: Array<{ kind: string; payload: Record<string, unknown> }> = [];
  const now = { t: Date.UTC(2026, 9, 22, 9) };
  const log = async (kind: string, payload: Record<string, unknown>) => void rows.push({ kind, payload });
  const broker = new ApprovalBroker({ kernel: SoftwareEd25519Signer.generate('kernel'), kernelPrincipal: KERNEL, log, approvals, root: new DevTestRootAuthority(DEV_TEST_ROOT_ACK), clock: () => now.t, mono: () => now.t });
  const book = new StandingGrantBook({ principal: KERNEL, isKernelKey: (k) => k === 'kernel-key' });
  const grants = new StandingGrants({ broker, book: () => book, log, clock: () => now.t });
  broker.setStanding(grants);
  /** a live standing grant of every tuple on this GUI device (its touch also leaves the device's cached unlock) */
  const mint = async () => {
    const r = await grants.request(gui(), { tuples: ALL, repos: [REPO] });
    await broker.approve(gui(), { cardId: r.cardId, decision: 'allow' });
  };
  const trustCard = () => broker.raise({ kind: 'loop-trust', requestedBy: KERNEL, attended: true, detail: { loopId: 'flow-health', contentHash: `sha256:${'c'.repeat(64)}` }, lines: ['Trust loop flow-health'], decisions: ['allow', 'deny'] });
  const choiceCard = () => broker.raise({ kind: 'loop-choice', requestedBy: KERNEL, attended: true, detail: { loopId: 'green-typecheck', runId: 'run-1', nodeId: 'ask' }, lines: ['Loop green-typecheck asks: continue?'], decisions: ['continue', 'stop'] });
  return { helper, broker, rows, mint, trustCard, choiceCard, kinds: () => rows.map((r) => r.kind) };
}

async function refusal(p: Promise<unknown>): Promise<{ code: string; reason: unknown }> {
  const e = await p.then(
    () => undefined,
    (x: unknown) => x,
  );
  expect(e).toBeInstanceOf(RefusedError);
  return { code: (e as RefusedError).refusal.code, reason: (e as RefusedError).refusal.data?.reason };
}

describe('8.0:loops class rows (classes.ts)', () => {
  it('loop-trust: allow root, deny fresh; loop-choice: continue fresh, stop cached', () => {
    expect(KIND_DECISIONS['loop-trust']).toEqual({ allow: 'root', deny: 'fresh' });
    expect(KIND_DECISIONS['loop-choice']).toEqual({ continue: 'fresh', stop: 'cached' });
    expect(baseClass('loop-trust', 'allow')).toBe('root');
    expect(baseClass('loop-choice', 'continue')).toBe('fresh');
    expect(baseClass('loop-choice', 'stop')).toBe('cached');
    // a flag never lowers a class: an irreversible loop-choice stop takes presence
    expect(baseClass('loop-choice', 'stop', ['irreversible'])).toBe('fresh');
  });
  it('never always: neither kind takes `always` (so no always-rule is ever learned from one), nor any standing-rule decision', () => {
    for (const kind of ['loop-trust', 'loop-choice']) {
      expect(validDecisions(kind)).not.toContain('always');
      expect(baseClass(kind, 'always')).toBeUndefined();
      for (const d of STANDING_DECISIONS) expect(validDecisions(kind), `${kind}:${d}`).not.toContain(d);
    }
    expect(validDecisions('loop-trust')).not.toContain('continue');
    expect(validDecisions('loop-choice')).not.toContain('allow');
  });
  it('never standing: loop-trust is in NEVER_STANDING_KINDS, and no tuple names either kind', () => {
    expect(NEVER_STANDING_KINDS.has('loop-trust')).toBe(true);
    for (const d of ['allow', 'deny']) expect(standingTupleOf({ kind: 'loop-trust' }, d, {}, REPO)).toBeNull();
    for (const d of ['continue', 'stop']) expect(standingTupleOf({ kind: 'loop-choice' }, d, {}, REPO)).toBeNull();
  });
  it('never by voice in 8.0: every decision of both kinds is hand-only (stop by voice is 8.1)', () => {
    for (const cls of ['reversible', 'gate', 'judgment']) {
      for (const d of ['allow', 'deny']) expect(voiceDecisionCheck(cls, 'loop-trust', d, [])).toEqual({ ok: false, reason: 'voice-hand-only' });
      for (const d of ['continue', 'stop']) expect(voiceDecisionCheck(cls, 'loop-choice', d, [])).toEqual({ ok: false, reason: 'voice-hand-only' });
    }
  });
});

describe('8.0:loops cards through the broker', () => {
  it('a loop-trust card is root-capable (its detail carries rootRows and rootDecisions [allow]); always is refused', async () => {
    const r = rig();
    const c = await r.trustCard();
    expect(c.kind).toBe('loop-trust');
    const raised = r.rows.find((x) => x.kind === 'approval.request')!.payload as { card: { block: unknown } };
    expect(JSON.stringify(raised.card.block)).toContain('allow');
    expect(await refusal(r.broker.approve(gui(), { cardId: c.cardId, decision: 'always' }))).toMatchObject({ code: 'BAD_REQUEST' });
    expect(await refusal(r.broker.approve(gui(), { cardId: c.cardId, decision: 'continue' }))).toMatchObject({ code: 'BAD_REQUEST' });
    await expect(r.broker.raise({ kind: 'loop-trust', requestedBy: KERNEL, attended: true, detail: {}, lines: ['x'], decisions: ['always'] })).rejects.toBeInstanceOf(RefusedError);
  });
  it('FALSIFIER: a live standing grant and the cached unlock never carry a loop-trust decision', async () => {
    const r = rig();
    await r.mint();
    const prompts = r.helper.prompts.length;
    const c = await r.trustCard();
    // deny is fresh class: it prompts, it is not standing
    const d = await r.broker.approve(gui(), { cardId: c.cardId, decision: 'deny' });
    expect(String(d.presence)).not.toMatch(/^standing:/);
    expect(d.presence).toBe('fresh');
    expect(r.helper.prompts.length).toBe(prompts + 1);
    // allow is root class: fresh presence (its own prompt, never standing, never the cached unlock) AND the root key
    const c2 = await r.trustCard();
    const a = await r.broker.approve(gui(), { cardId: c2.cardId, decision: 'allow' });
    expect(a.presence).toBe('fresh');
    expect(r.helper.prompts.length).toBe(prompts + 2);
    const decided = r.rows.filter((x) => x.kind === 'approval.decide').at(-1)!.payload;
    expect(decided).toMatchObject({ cardId: c2.cardId, decision: 'allow', presence: 'fresh', rootKind: 'loop-trust' });
    expect(decided.rootSig).toMatchObject({ signer: expect.stringMatching(/^gkey-p256:v1:/), sig: expect.any(String) });
    expect(r.kinds()).not.toContain('grant.standing.used');
  });
  it('loop-choice: continue takes fresh presence even under a cached unlock; stop rides the cached unlock', async () => {
    const r = rig();
    await r.mint(); // the grant's touch leaves the device's cached unlock
    const prompts = r.helper.prompts.length;
    const go = await r.choiceCard();
    expect((await r.broker.approve(gui(), { cardId: go.cardId, decision: 'continue' })).presence).toBe('fresh');
    expect(r.helper.prompts.length).toBe(prompts + 1);
    const halt = await r.choiceCard();
    expect((await r.broker.approve(gui(), { cardId: halt.cardId, decision: 'stop' })).presence).toBe('cached');
    expect(r.helper.prompts.length).toBe(prompts + 1);
    expect(r.kinds()).not.toContain('grant.standing.used');
  });
  it('voice and agents never decide a loop card', async () => {
    const r = rig();
    const c = await r.choiceCard();
    expect((await refusal(r.broker.approve({ ...gui(), principalClass: 'voice' }, { cardId: c.cardId, decision: 'stop' }))).code).toBe('FORBIDDEN');
    expect(await refusal(r.broker.approve({ ...gui(), principalClass: 'agent' }, { cardId: c.cardId, decision: 'continue' }))).toMatchObject({ code: 'FORBIDDEN', reason: 'matrix' });
  });
});
