/**
 * TD-2026-10-20-086 F4 + F5 (#approval-broker, #identity; spec §3.1 approvals key, §3.4). F4: the cached unlock
 * lasts until screen lock, sleep or user switch, capped at 12 h and 512 signatures (no separate idle limit), and a
 * helper that does not report its bounds (1.6.0) keeps the LOWER legacy bounds (15 min idle, 60 min, 64). F5: the
 * unlock is keyed by the GUI DEVICE (launch-token deviceId), so it survives a reconnect of the same device (this
 * supersedes S25-H1), never reaches another device, and a CLI connection with the same deviceId never uses it.
 * Platform-independent: the FakeHelper stands in for the signed helper.
 */
import { describe, expect, it } from 'vitest';
import { ApprovalBroker, helperBoundsOf, LEGACY_HELPER_BOUNDS, lowerBounds, UNLOCK_ABSOLUTE_MS, UNLOCK_IDLE_MS, UNLOCK_MAX_SIGNATURES, unlockKeyOf, UnlockStore } from '../src/kernel/broker/index.js';
import { HelperApprovalsKey } from '../src/kernel/identity/index.js';
import { SoftwareEd25519Signer } from '../src/kernel/log/signer.js';
import { FakeHelper } from './helper-fake.js';

const HUMAN = 'p:abcdefgh/matt';
const AGENT = 'p:abcdefgh/s-01hzzzzz';
const GEN = 'test0001';
const A = 'conn:01HZZZZZZZZZZZZZZZZZZZZZZA';
const B = 'conn:01HZZZZZZZZZZZZZZZZZZZZZZB';
const C = 'conn:01HZZZZZZZZZZZZZZZZZZZZZZC';
const DEV = 'dev:01HZZZZZZZZZZZZZZZZZZZZZZD';
const DEV2 = 'dev:01HZZZZZZZZZZZZZZZZZZZZZZE';
const NEW_BOUNDS = { idleSeconds: 12 * 3600, absoluteSeconds: 12 * 3600, maxSignatures: 512 };
const gui = (connId: string, deviceId: string | null = DEV) => ({ connId, principal: HUMAN, principalClass: 'human', surface: 'browser', credential: 'gui', ...(deviceId ? { deviceId } : {}) });

function rig(o: { bounds?: typeof NEW_BOUNDS } = {}) {
  const helper = new FakeHelper(GEN, o.bounds ? { bounds: o.bounds } : {});
  const approvals = new HelperApprovalsKey({ gen: GEN, approvalsPublicKeyPem: helper.publicPem('approvals') }, HUMAN, helper);
  const rows: Array<{ kind: string; payload: Record<string, unknown>; ids?: { connId?: string } }> = [];
  const mono = { t: 1_000_000 };
  const broker = new ApprovalBroker({
    kernel: SoftwareEd25519Signer.generate('kernel'),
    kernelPrincipal: 'p:abcdefgh/kernel',
    log: async (kind, payload, ids) => void rows.push({ kind, payload, ...(ids ? { ids } : {}) }),
    approvals,
    mono: () => mono.t,
  });
  approvals.onHelperExit(() => void broker.helperExited());
  approvals.onHelperPush((p) => void broker.helperSessionEnded(p.cause));
  const permission = () => broker.raise({ kind: 'permission', requestedBy: AGENT, attended: true, detail: { tool: 'Bash', input: 'ls' }, lines: ['Bash: ls'], tool: 'Bash', toolInput: { command: 'ls' } });
  const decide = async (ctx: Record<string, unknown> = gui(A)) => broker.approve(ctx as never, { cardId: (await permission()).cardId, decision: 'allow' });
  const dropped = () => rows.filter((r) => r.kind === 'approval.unlock.dropped').map((r) => r.payload);
  return { helper, approvals, broker, rows, mono, decide, dropped };
}

describe('F4: the unlock bounds', () => {
  it('defaults are 12 h and 512 signatures with no separate idle limit; the legacy helper bounds are 15 min / 60 min / 64', () => {
    expect([UNLOCK_ABSOLUTE_MS, UNLOCK_MAX_SIGNATURES, UNLOCK_IDLE_MS]).toEqual([12 * 3600_000, 512, 12 * 3600_000]);
    expect(LEGACY_HELPER_BOUNDS).toEqual({ idleMs: 15 * 60_000, absoluteMs: 60 * 60_000, maxSignatures: 64 });
  });

  it('a helper that reports no bounds (1.6.0), or malformed ones, reads as the legacy bounds; the lower side always wins', () => {
    expect(helperBoundsOf(undefined)).toEqual(LEGACY_HELPER_BOUNDS);
    expect(helperBoundsOf({ idleSeconds: 'x', absoluteSeconds: 1, maxSignatures: 1 })).toEqual(LEGACY_HELPER_BOUNDS);
    expect(helperBoundsOf(NEW_BOUNDS)).toEqual({ idleMs: 12 * 3600_000, absoluteMs: 12 * 3600_000, maxSignatures: 512 });
    expect(lowerBounds({ idleMs: 10, absoluteMs: 100, maxSignatures: 5 }, { idleMs: 50, absoluteMs: 20, maxSignatures: 9 })).toEqual({ idleMs: 10, absoluteMs: 20, maxSignatures: 5 });
    // a helper claiming MORE than the kernel never widens the kernel's cap
    expect(lowerBounds({ idleMs: 10, absoluteMs: 100, maxSignatures: 5 }, { idleMs: 1e12, absoluteMs: 1e12, maxSignatures: 1e9 })).toEqual({ idleMs: 10, absoluteMs: 100, maxSignatures: 5 });
  });

  it('FALSIFIER: steady use lasts the whole 12 h (no idle end), then the next decision is fresh', () => {
    const now = { t: 0 };
    const s = new UnlockStore(() => now.t);
    s.open(A);
    now.t += 3 * 3600_000; // three hours of no decisions: still cached (the lock is the idle signal)
    expect(s.use(A)).toBe('ok');
    now.t = UNLOCK_ABSOLUTE_MS;
    expect(s.use(A)).toBe('ok');
    now.t += 1;
    expect(s.use(A)).toBe('expired');
  });

  it('with an older helper the kernel uses the LOWER bound: 15 min idle ends the unlock', async () => {
    const r = rig();
    expect((await r.decide()).presence).toBe('fresh');
    expect(r.broker.unlocks.boundsOf(unlockKeyOf(gui(A)))).toEqual(LEGACY_HELPER_BOUNDS);
    r.mono.t += 15 * 60_000 + 1;
    expect((await r.decide()).presence).toBe('fresh');
    expect(r.dropped().map((d) => d.reason)).toContain('idle');
  });

  it('with helper 1.7.0 the unlock survives two idle hours and ends at 12 h', async () => {
    const r = rig({ bounds: NEW_BOUNDS });
    expect((await r.decide()).presence).toBe('fresh');
    expect(r.broker.unlocks.boundsOf(unlockKeyOf(gui(A)))).toEqual({ idleMs: 12 * 3600_000, absoluteMs: 12 * 3600_000, maxSignatures: 512 });
    r.mono.t += 2 * 3600_000;
    expect((await r.decide()).presence).toBe('cached');
    r.mono.t += 10 * 3600_000 + 1;
    expect((await r.decide()).presence).toBe('fresh');
    expect(r.dropped().map((d) => d.reason)).toContain('expired');
  });
});

describe('F5: the unlock belongs to the GUI device, not the connection', () => {
  it('the device key is udev:<40 hex>, fits the helper connId shape, and never names the raw device id; no deviceId or a CLI ⇒ the connId', () => {
    const k = unlockKeyOf(gui(A));
    expect(k).toMatch(/^udev:[0-9a-f]{40}$/);
    expect(k).not.toContain(DEV);
    expect(unlockKeyOf(gui(B))).toBe(k);
    expect(unlockKeyOf(gui(A, DEV2))).not.toBe(k);
    expect(unlockKeyOf(gui(A, null))).toBe(A);
    expect(unlockKeyOf({ connId: C, credential: 'device', deviceId: DEV })).toBe(C);
  });

  it('FALSIFIER: the unlock survives a reconnect on the same device (no second prompt)', async () => {
    const r = rig({ bounds: NEW_BOUNDS });
    expect((await r.decide(gui(A))).presence).toBe('fresh');
    await r.broker.connectionClosed(A);
    expect(r.dropped()).toEqual([]);
    expect(r.broker.unlockStateFor(B, DEV)).toMatchObject({ state: 'cached' });
    expect((await r.decide(gui(B))).presence).toBe('cached');
    expect(r.helper.prompts.length).toBe(1);
    expect(r.rows.find((x) => x.kind === 'approval.unlock')!.payload).toMatchObject({ connId: A, scope: 'device' });
    // Aegis M1: the new connection's first use is a kernel row, once
    expect(r.rows.filter((x) => x.kind === 'approval.unlock.joined').map((x) => x.payload)).toEqual([{ connId: B, scope: 'device' }]);
    await r.decide(gui(B));
    expect(r.rows.filter((x) => x.kind === 'approval.unlock.joined')).toHaveLength(1);
  });

  it('FALSIFIER: the unlock dies on screen lock (the helper push), and the next decision prompts', async () => {
    const r = rig({ bounds: NEW_BOUNDS });
    await r.decide(gui(A));
    r.helper.sessionEvent('screen-lock');
    await new Promise((res) => setTimeout(res, 0));
    expect(r.broker.unlockStateFor(B, DEV)).toBeNull();
    const d = r.dropped();
    expect(d).toHaveLength(1);
    expect(d[0]).toMatchObject({ connId: A, reason: 'screen-lock', scope: 'device' });
    expect((await r.decide(gui(B))).presence).toBe('fresh');
    expect(r.helper.prompts.length).toBe(2);
  });

  it('another device never uses it', async () => {
    const r = rig({ bounds: NEW_BOUNDS });
    await r.decide(gui(A));
    expect((await r.decide(gui(B, DEV2))).presence).toBe('fresh');
  });

  it('a CLI (device credential) with the SAME deviceId never uses the GUI unlock: it prompts every time', async () => {
    const r = rig({ bounds: NEW_BOUNDS });
    await r.decide(gui(A));
    const d = await r.decide({ connId: C, principal: HUMAN, principalClass: 'human', surface: 'cli', credential: 'device', deviceId: DEV });
    expect(d.presence).toBe('cli');
    expect(r.helper.prompts.length).toBe(2);
  });

  it('a GUI context with no deviceId keeps the per-connection unlock, dropped on close', async () => {
    const r = rig({ bounds: NEW_BOUNDS });
    await r.decide(gui(A, null));
    await r.broker.connectionClosed(A);
    expect(r.dropped()).toEqual([{ connId: A, reason: 'closed' }]);
    expect((await r.decide(gui(B, null))).presence).toBe('fresh');
  });

  it('the 512-signature cap ends the device unlock', async () => {
    const r = rig({ bounds: { ...NEW_BOUNDS, maxSignatures: 2 } });
    expect((await r.decide()).presence).toBe('fresh');
    expect((await r.decide()).presence).toBe('cached');
    expect((await r.decide(gui(B))).presence).toBe('cached');
    expect((await r.decide(gui(B))).presence).toBe('fresh');
    expect(r.dropped().map((d) => d.reason)).toEqual(['exhausted']);
  });
});
