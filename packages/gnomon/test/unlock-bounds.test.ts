/**
 * T-2026-10-18-028 M2 + M3 (#approval-broker, #identity; spec §3.1 approvals
 * key). M2: the cached unlock has an ABSOLUTE TTL and a signature CAP, on the
 * broker side (UnlockStore) — the helper enforces the same pair independently
 * (Protocol.swift Bounds; unreachable from tests without the Secure Enclave,
 * stated as a residual). M3: unlock.drop is sent to the helper on EVERY
 * close and failure path, whether or not the broker still records the unlock,
 * and a drop the helper does not answer escalates (drop-all, then the helper
 * process is ended). Platform-independent: the FakeHelper stands in.
 */
import { describe, expect, it } from 'vitest';
import { RefusedError } from '@a-company/gnomon-contracts';
import { ApprovalBroker, LEGACY_HELPER_BOUNDS, UNLOCK_ABSOLUTE_MS, UNLOCK_IDLE_MS, UNLOCK_MAX_SIGNATURES, UnlockStore } from '../src/kernel/broker/index.js';

// TD-2026-10-20-086 F4: the kernel defaults moved to 12 h / 512 (test/unlock-device.test.ts); these M2 falsifiers run
// at the legacy helper bounds, which is what a 1.6.0 helper (the FakeHelper default, no `bounds`) holds the kernel to.
const LEGACY_ABS = LEGACY_HELPER_BOUNDS.absoluteMs;
const legacyStore = (clock: () => number, limits: { maxSignatures?: number } = {}) => new UnlockStore(clock, LEGACY_HELPER_BOUNDS.idleMs, { absoluteMs: LEGACY_ABS, ...limits });
import { HelperApprovalsKey, HelperUnavailableError, type HelperReply, type HelperTransport } from '../src/kernel/identity/index.js';
import { SoftwareEd25519Signer } from '../src/kernel/log/signer.js';
import { FakeHelper } from './helper-fake.js';

const HUMAN = 'p:abcdefgh/matt';
const AGENT = 'p:abcdefgh/s-01hzzzzz';
const GEN = 'test0001';
const A = 'conn:01HZZZZZZZZZZZZZZZZZZZZZZA';
const gui = (connId = A, isLive?: () => boolean) => ({ connId, principal: HUMAN, principalClass: 'human', surface: 'browser', credential: 'gui', ...(isLive ? { isLive } : {}) });

/** A FakeHelper that records every op it is sent. */
class RecordingHelper extends FakeHelper {
  ops: string[] = [];
  failOps = new Set<string>();
  /** sign with keep: put the unlock in, THEN fail (a reply lost to a timeout) */
  keepThenFail = false;
  recycled = 0;
  override async request(req: Record<string, unknown>): Promise<HelperReply> {
    this.ops.push(String(req.op));
    if (this.failOps.has(String(req.op))) throw new HelperUnavailableError('timeout', 'no answer (test)');
    if (this.keepThenFail && req.op === 'sign' && req.keep === true) {
      this.handle(req);
      throw new HelperUnavailableError('timeout', 'the reply was lost (test)');
    }
    return this.handle(req);
  }
  async recycle(): Promise<void> {
    this.recycled++;
    this.crash();
  }
}

function rig(o: { limits?: { absoluteMs?: number; maxSignatures?: number } } = {}) {
  const helper = new RecordingHelper(GEN);
  const approvals = new HelperApprovalsKey({ gen: GEN, approvalsPublicKeyPem: helper.publicPem('approvals') }, HUMAN, helper);
  const rows: Array<{ kind: string; payload: Record<string, unknown> }> = [];
  const mono = { t: 1_000_000 };
  const broker = new ApprovalBroker({
    kernel: SoftwareEd25519Signer.generate('kernel'),
    kernelPrincipal: 'p:abcdefgh/kernel',
    log: async (kind, payload) => void rows.push({ kind, payload }),
    approvals,
    mono: () => mono.t,
    ...(o.limits ? { unlockLimits: o.limits } : {}),
  });
  approvals.onHelperExit(() => void broker.helperExited());
  const permission = () => broker.raise({ kind: 'permission', requestedBy: AGENT, attended: true, detail: { tool: 'Bash', input: 'ls' }, lines: ['Bash: ls'], tool: 'Bash', toolInput: { command: 'ls' } });
  const decide = async (ctx = gui()) => broker.approve(ctx, { cardId: (await permission()).cardId, decision: 'allow' });
  const dropped = () => rows.filter((r) => r.kind === 'approval.unlock.dropped').map((r) => r.payload.reason);
  return { helper, approvals, broker, rows, mono, decide, dropped };
}

describe('M2: UnlockStore bounds', () => {
  it('defaults (F4): 12 h absolute = idle, 512 signatures; legacy helper 15 min / 60 min / 64', () => {
    expect([UNLOCK_IDLE_MS, UNLOCK_ABSOLUTE_MS, UNLOCK_MAX_SIGNATURES]).toEqual([12 * 3600_000, 12 * 3600_000, 512]);
    expect(LEGACY_HELPER_BOUNDS).toEqual({ idleMs: 15 * 60_000, absoluteMs: 60 * 60_000, maxSignatures: 64 });
  });

  it('FALSIFIER: steady use slides the idle timer but never the absolute TTL', () => {
    const now = { t: 0 };
    const s = legacyStore(() => now.t);
    s.open(A);
    for (let i = 0; i < 6; i++) {
      now.t += 10 * 60_000; // every 10 min: never idle
      expect(s.use(A), `use ${i}`).toBe('ok');
    }
    expect(now.t).toBe(LEGACY_ABS);
    now.t += 1;
    expect(s.state(A)).toBeNull();
    expect(s.ended()).toEqual([{ connId: A, reason: 'expired' }]);
    expect(s.use(A)).toBe('expired');
    expect(s.use(A)).toBe('none'); // dropped
  });

  it('FALSIFIER: the cap ends the unlock after exactly maxSignatures uses', () => {
    const s = legacyStore(() => 0, { maxSignatures: 3 });
    s.open(A);
    expect([s.use(A), s.use(A), s.use(A)]).toEqual(['ok', 'ok', 'ok']);
    expect(s.has(A)).toBe(false);
    expect(s.use(A)).toBe('exhausted');
  });

  it('status idleLeftMs never promises more than the absolute time left', () => {
    const now = { t: 0 };
    const s = legacyStore(() => now.t);
    s.open(A);
    while (now.t < LEGACY_ABS - 60_000) {
      now.t = Math.min(now.t + 10 * 60_000, LEGACY_ABS - 60_000);
      expect(s.use(A)).toBe('ok');
    }
    expect(s.state(A)).toEqual({ state: 'cached', idleLeftMs: 60_000 });
  });
});

describe('M2 in the broker: an ended unlock takes fresh presence again and is dropped in the helper', () => {
  it('FALSIFIER: past the absolute TTL the next decision is fresh; dropped{expired}; unlock.drop sent', async () => {
    const r = rig();
    expect((await r.decide()).presence).toBe('fresh');
    for (let i = 0; i < 6; i++) {
      r.mono.t += 10 * 60_000;
      expect((await r.decide()).presence, `cached ${i}`).toBe('cached');
    }
    r.mono.t += 1;
    const before = r.helper.ops.filter((o) => o === 'unlock.drop').length;
    expect((await r.decide()).presence).toBe('fresh');
    expect(r.dropped()).toContain('expired');
    expect(r.helper.ops.filter((o) => o === 'unlock.drop').length).toBe(before + 1);
    expect(r.helper.prompts.length).toBe(2);
  });

  it('FALSIFIER: after maxSignatures cached decisions the next is fresh; dropped{exhausted}', async () => {
    const r = rig({ limits: { maxSignatures: 2 } });
    expect((await r.decide()).presence).toBe('fresh');
    expect((await r.decide()).presence).toBe('cached');
    expect((await r.decide()).presence).toBe('cached');
    expect((await r.decide()).presence).toBe('fresh');
    expect(r.dropped()).toEqual(['exhausted']);
  });

  it('the expiry sweep drops an expired unlock on both sides', async () => {
    const r = rig();
    await r.decide();
    r.mono.t += UNLOCK_ABSOLUTE_MS + 1;
    await r.broker.expireDue();
    expect(r.dropped()).toContain('expired');
    expect(r.helper.unlocks.has(A)).toBe(false);
  });
});

describe('M3: unlock.drop on every close and failure path', () => {
  it('FALSIFIER: a close drops the helper unlock even when the broker holds none (diverged records)', async () => {
    const r = rig();
    r.helper.unlocks.add(A); // the helper kept one the broker never recorded
    await r.broker.connectionClosed(A);
    expect(r.helper.unlocks.has(A)).toBe(false);
    expect(r.dropped()).toEqual([]); // nothing to log on the broker side
  });

  it('FALSIFIER: the connection closes during a fresh keep-sign: the helper copy is dropped, nothing decided', async () => {
    const r = rig();
    const e = await r.decide(gui(A, () => false)).then(
      () => null,
      (x: unknown) => x,
    );
    expect(e).toBeInstanceOf(RefusedError);
    expect((e as RefusedError).refusal.data?.reason).toBe('gone');
    expect(r.helper.unlocks.has(A)).toBe(false);
    expect(r.broker.unlocks.has(A)).toBe(false);
    expect(r.rows.some((x) => x.kind === 'approval.decide')).toBe(false);
  });

  it('FALSIFIER: a keep-sign whose reply is lost (timeout) still drops the unlock the helper kept', async () => {
    const r = rig();
    r.helper.keepThenFail = true;
    await expect(r.decide()).rejects.toBeDefined();
    expect(r.helper.unlocks.has(A)).toBe(false);
  });

  it('FALSIFIER: a drop the helper does not answer escalates to drop-all, then ends the helper process', async () => {
    const r = rig();
    await r.decide();
    r.helper.failOps.add('conn.close'); // helper 1.6.0: a close goes out as conn.close (unlock + every arm naming the connId)
    await r.broker.connectionClosed(A);
    expect(r.helper.ops.slice(-3)).toEqual(['conn.close', 'unlock.drop-all', 'arm.close-all']);
    expect(r.helper.recycled).toBe(0);
    await r.decide(); // a fresh unlock again
    r.helper.failOps.add('unlock.drop-all');
    await r.broker.connectionClosed(A);
    expect(r.helper.recycled).toBe(1);
    expect(r.helper.unlocks.size).toBe(0);
  });

  it('no helper process running: the drop starts none', async () => {
    const helper = new RecordingHelper(GEN);
    const t: HelperTransport & { running: boolean } = Object.assign(Object.create(helper) as RecordingHelper, { running: false });
    const ak = new HelperApprovalsKey({ gen: GEN, approvalsPublicKeyPem: helper.publicPem('approvals') }, HUMAN, t);
    await ak.dropUnlock(A);
    expect(helper.ops).toEqual([]);
  });
});
