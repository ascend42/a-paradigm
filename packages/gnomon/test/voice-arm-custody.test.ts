/**
 * #approval-broker voice-arm custody (helper 1.6.0, V5 of TD-2026-10-19-194; spec §14.7, S29-K5,
 * S26-C3, G-BRK-06). Platform-free: an in-memory FakeHelper speaks protocol v2. The real helper's push
 * framing over a child's stdout is covered by test/identity-helper-pin.test.ts (POSIX shebang child).
 */
import { describe, expect, it } from 'vitest';
import { ApprovalBroker, VoiceArmCustody } from '../src/kernel/broker/index.js';
import { approveMessage, SoftwareEd25519Signer } from '../src/kernel/log/signer.js';
import { HelperApprovalsKey, parseHelperPush, SupervisedHelper } from '../src/kernel/identity/index.js';
import { FakeHelper } from './helper-fake.js';

const HUMAN = 'p:abcdefgh/matt';
const GEN = 'test0001';
const H = 'conn:01HZZZZZZZZZZZZZZZZZZZZZZA';
const V = 'conn:01HZZZZZZZZZZZZZZZZZZZZZZB';
const ARM1 = 'arm:01HZZZZZZZZZZZZZZZZZZZZZZ1';
const ARM2 = 'arm:01HZZZZZZZZZZZZZZZZZZZZZZ2';

function rig() {
  const helper = new FakeHelper(GEN);
  const key = new HelperApprovalsKey({ gen: GEN, approvalsPublicKeyPem: helper.publicPem('approvals') }, HUMAN, helper);
  const rows: Array<{ kind: string; payload: Record<string, unknown> }> = [];
  const log = async (kind: string, payload: Record<string, unknown>): Promise<void> => void rows.push({ kind, payload });
  const broker = new ApprovalBroker({ kernel: SoftwareEd25519Signer.generate('kernel'), kernelPrincipal: 'p:abcdefgh/kernel', log, approvals: key });
  const arms = new VoiceArmCustody(log, key);
  // the daemon's wiring (lifecycle/daemon.ts)
  key.onHelperExit(() => void broker.helperExited());
  key.onHelperExit(() => void arms.helperExited());
  key.onHelperPush((p) => {
    void arms.helperPushed(p);
    void broker.helperSessionEnded(p.cause);
  });
  const open = async (armId: string, human = H, voice = V): Promise<void> => {
    await key.openArm({ armId, humanConnId: human, voiceConnId: voice, hardSeconds: 3600, prompt: 'Arm voice approvals', messages: [approveMessage('card:01HZZZZZZZZZZZZZZZZZZZZZZZ', 'allow', 'sha256:00', HUMAN)] });
    arms.opened({ armId, humanConnId: human, voiceConnId: voice });
  };
  const disarms = () => rows.filter((r) => r.kind === 'approval.voice.disarm').map((r) => r.payload);
  return { helper, key, broker, arms, rows, open, disarms };
}

const tick = () => new Promise((r) => setImmediate(r));

describe('voice arm custody (helper 1.6.0)', () => {
  it('a pushed screen-lock event disarms every arm (one approval.voice.disarm row each) within the push', async () => {
    const r = rig();
    await r.open(ARM1);
    await r.open(ARM2, H, 'conn:01HZZZZZZZZZZZZZZZZZZZZZZC');
    expect(r.helper.arms.size).toBe(2);
    r.helper.sessionEvent('screen-lock');
    await tick();
    expect(r.disarms()).toEqual([
      { armId: ARM1, reason: 'screen-lock', cause: 'screen-lock' },
      { armId: ARM2, reason: 'screen-lock', cause: 'screen-lock' },
    ]);
    expect(r.arms.armIds()).toEqual([]);
    expect(r.helper.arms.size).toBe(0);
    // a second event finds nothing left: no duplicate rows
    r.helper.sessionEvent('system-sleep');
    await tick();
    expect(r.disarms()).toHaveLength(2);
  });

  it('a push also drops every cached-unlock reference the broker holds', async () => {
    const r = rig();
    r.broker.unlocks.open(H);
    r.helper.sessionEvent('user-switch');
    await tick();
    expect(r.broker.unlocks.size()).toBe(0);
    expect(r.rows).toContainEqual({ kind: 'approval.unlock.dropped', payload: { connId: H, reason: 'user-switch', cause: 'user-switch' } });
  });

  it('helper EOF (exit/crash) disarms every arm with reason helper-exit', async () => {
    const r = rig();
    await r.open(ARM1);
    await r.open(ARM2, 'conn:01HZZZZZZZZZZZZZZZZZZZZZZD', V);
    r.helper.crash();
    await tick();
    expect(r.disarms()).toEqual([
      { armId: ARM1, reason: 'helper-exit' },
      { armId: ARM2, reason: 'helper-exit' },
    ]);
  });

  it('closing a connection closes, in the helper, every arm naming it (conn.close)', async () => {
    const r = rig();
    await r.open(ARM1);
    await r.broker.connectionClosed(V);
    await r.arms.connectionClosed(V);
    expect(r.helper.arms.size).toBe(0);
    expect(r.disarms()).toEqual([{ armId: ARM1, reason: 'conn-closed' }]);
  });

  it('G-BRK-06: a voice signature comes only from arm.sign under a live arm for that pair', async () => {
    const r = rig();
    const msg = 'card:01HZZZZZZZZZZZZZZZZZZZZZZZ\nallow\nsha256:00\n' + HUMAN;
    await expect(r.key.signUnderArm({ armId: ARM1, humanConnId: H, voiceConnId: V, messages: [msg] })).rejects.toMatchObject({ code: 'no-arm' });
    await r.open(ARM1);
    expect(await r.key.signUnderArm({ armId: ARM1, humanConnId: H, voiceConnId: V, messages: [msg] })).toHaveLength(1);
    await expect(r.key.signUnderArm({ armId: ARM1, humanConnId: 'conn:01HZZZZZZZZZZZZZZZZZZZZZZE', voiceConnId: V, messages: [msg] })).rejects.toMatchObject({ code: 'no-arm' });
    // the voice domain under a connId unlock is refused
    await expect(r.helper.request({ op: 'sign', key: 'approvals', gen: GEN, mode: 'cached', connId: H, messages: [Buffer.from('gnomon:approve-voice:v1\n' + msg).toString('base64')] })).rejects.toMatchObject({ code: 'domain-refused' });
    // the hand domain under an arm is refused
    await expect(r.helper.request({ op: 'arm.sign', armId: ARM1, gen: GEN, humanConnId: H, voiceConnId: V, messages: [Buffer.from('gnomon:approve:v1\n' + msg).toString('base64')] })).rejects.toMatchObject({ code: 'domain-refused' });
  });

  it('a supervised helper forwards pushes from the current process only', async () => {
    const procs: FakeHelper[] = [];
    const sup = new SupervisedHelper(() => {
      const f = new FakeHelper(GEN);
      procs.push(f);
      return f;
    }, () => 1e9 + procs.length * 1e6);
    const seen: string[] = [];
    sup.onPush((p) => seen.push(p.cause));
    await sup.request({ op: 'arm.close-all' });
    procs[0]!.sessionEvent('display-sleep');
    procs[0]!.crash();
    await sup.request({ op: 'arm.close-all' });
    procs[0]!.sessionEvent('screensaver'); // a stale process: ignored
    procs[1]!.sessionEvent('screen-lock');
    expect(seen).toEqual(['display-sleep', 'screen-lock']);
  });

  it('parseHelperPush accepts only a well-formed session push', () => {
    expect(parseHelperPush({ push: 'session', cause: 'screen-lock', arms: [], unlocks: 0, seq: 1 })).not.toBeNull();
    expect(parseHelperPush({ push: 'session', cause: 'lid', arms: [], unlocks: 0, seq: 1 })).toBeNull();
    expect(parseHelperPush({ push: 'session', cause: 'screen-lock', arms: [], unlocks: 0, seq: 1, id: 3 })).toBeNull();
    expect(parseHelperPush({ push: 'other', cause: 'screen-lock', arms: [], unlocks: 0, seq: 1 })).toBeNull();
    expect(parseHelperPush({ push: 'session', cause: 'screen-lock', arms: [1], unlocks: 0, seq: 1 })).toBeNull();
  });
});
