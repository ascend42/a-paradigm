/**
 * #approval-broker expire() vs an in-flight approve (Aegis A3, P8-D96 round
 * 2): the decision is claimed synchronously after approve's last re-check,
 * so expire() cannot interleave between that check and the settle; while a
 * decision is in flight, expire() defers like expireDue does, and the
 * deferred expiry applies if the decision fails. Platform-independent.
 */
import { generateKeyPairSync, sign as cryptoSign } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { RefusedError } from '@a-company/gnomon-contracts';
import { ApprovalBroker, approvalsKeyFrom, PresenceDenied, type PresenceProvider } from '../src/kernel/broker/index.js';
import { approveMessage, KeyRing, signaturePreimage, SoftwareEd25519Signer } from '../src/kernel/log/signer.js';
import { mintTestPresence } from '../src/kernel/testing.js';

const HUMAN = 'p:abcdefgh/matt';
const GUI = { connId: 'conn:1', principal: HUMAN, principalClass: 'human', surface: 'browser', credential: 'gui' } as const;

function rig(presence: PresenceProvider, onRow?: (kind: string, broker: ApprovalBroker) => Promise<void>) {
  const rows: Array<{ kind: string; payload: Record<string, unknown> }> = [];
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const ring = new KeyRing();
  const keyId = ring.addP256(publicKey);
  // eslint-disable-next-line prefer-const
  let broker: ApprovalBroker;
  broker = new ApprovalBroker({
    kernel: SoftwareEd25519Signer.generate('kernel'),
    kernelPrincipal: 'p:abcdefgh/kernel',
    log: async (kind, payload) => {
      rows.push({ kind, payload });
      await onRow?.(kind, broker);
    },
    approvals: approvalsKeyFrom(ring, (p) => (p === HUMAN ? keyId : undefined)),
    presence,
  });
  const sig = (cardId: string, decision: string) => cryptoSign('sha256', signaturePreimage('approve', approveMessage({ cardId, decision, cardContentHash: broker.card(cardId)!.contentHash, approverPrincipalId: HUMAN })), { key: privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64');
  const raise = () => broker.raise({ kind: 'permission', requestedBy: 'p:abcdefgh/s-01hzzzzz', attended: true, detail: { tool: 'Write' }, lines: ['x'], decisions: ['allow', 'deny'] });
  return { broker, rows, sig, raise };
}

const touch: PresenceProvider = { prove: async (req) => mintTestPresence(req.purpose, { bind: req.binding }) };

describe('Aegis A3: expire() never interleaves with a decision', () => {
  it('an expire() that lands after the re-check (here: inside the approval.decide append) is refused; the decision settles', async () => {
    const expireResults: boolean[] = [];
    const r = rig(touch, async (kind, b) => {
      if (kind === 'approval.decide') expireResults.push(await b.expire(cardId, 'session-exited'));
    });
    const cardId = (await r.raise()).cardId;
    const decided = await r.broker.approve(GUI as never, { cardId, decision: 'allow', decisionSig: r.sig(cardId, 'allow') });
    expect(decided.state).toBe('decided');
    expect(expireResults).toEqual([false]);
    expect(await r.broker.decisionOf(cardId)).toBe('allow');
    expect(r.rows.filter((x) => x.kind === 'approval.expire')).toEqual([]);
  });

  it('an expire() while presence is pending defers; the decision wins if it succeeds', async () => {
    let release!: () => void;
    const gate = new Promise<void>((res) => (release = res));
    const r = rig({ prove: async (req) => (await gate, mintTestPresence(req.purpose, { bind: req.binding })) });
    const cardId = (await r.raise()).cardId;
    const p = r.broker.approve(GUI as never, { cardId, decision: 'allow', decisionSig: r.sig(cardId, 'allow') });
    await new Promise((res) => setTimeout(res, 10));
    expect(await r.broker.expire(cardId, 'session-exited')).toBe(false);
    release();
    expect((await p).state).toBe('decided');
    expect(await r.broker.decisionOf(cardId)).toBe('allow');
    expect(r.rows.filter((x) => x.kind === 'approval.expire')).toEqual([]);
  });

  it('a deferred expire() applies when the in-flight decision fails (presence declined)', async () => {
    let release!: () => void;
    const gate = new Promise<void>((res) => (release = res));
    const r = rig({ prove: async () => (await gate, Promise.reject(new PresenceDenied('no touch'))) });
    const cardId = (await r.raise()).cardId;
    const p = r.broker.approve(GUI as never, { cardId, decision: 'allow', decisionSig: r.sig(cardId, 'allow') }).then(() => null, (e: unknown) => e);
    await new Promise((res) => setTimeout(res, 10));
    expect(await r.broker.expire(cardId, 'cancelled')).toBe(false);
    release();
    expect(await p).toBeInstanceOf(RefusedError);
    expect(await r.broker.decisionOf(cardId)).toBe('deny');
    expect(r.rows.filter((x) => x.kind === 'approval.expire').map((x) => x.payload)).toEqual([expect.objectContaining({ cardId, into: 'deny', why: 'cancelled' })]);
  });
});
