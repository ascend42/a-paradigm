/**
 * T-2026-10-18-028 L2 (#approval-broker): at most ONE outstanding fresh
 * presence prompt per connection, and a cooldown after a prompt that did not
 * yield presence. Refused FORBIDDEN{presence} with data.why
 * prompt-outstanding | prompt-cooldown. Platform-independent, in-process.
 */
import { generateKeyPairSync, sign as cryptoSign } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { RefusedError, validateRefusalV1 } from '@a-company/gnomon-contracts';
import { ApprovalBroker, approvalsKeyFrom, PresenceDenied, PROMPT_COOLDOWN_MS, type PresenceProvider } from '../src/kernel/broker/index.js';
import { approveMessage, KeyRing, signaturePreimage, SoftwareEd25519Signer } from '../src/kernel/log/signer.js';
import { mintTestPresence } from '../src/kernel/testing.js';

const HUMAN = 'p:abcdefgh/matt';
const AGENT = 'p:abcdefgh/s-01hzzzzz';
const A = 'conn:01HZZZZZZZZZZZZZZZZZZZZZZA';
const B = 'conn:01HZZZZZZZZZZZZZZZZZZZZZZB';
const H = (connId = A) => ({ connId, principal: HUMAN, principalClass: 'human', surface: 'browser', credential: 'gui' });

/** A presence provider the test answers by hand: each prove() waits until resolved or declined. */
function manual() {
  const pending: Array<{ ok: () => void; no: () => void }> = [];
  let shown = 0;
  const provider: PresenceProvider = {
    prove: (req) =>
      new Promise((resolve, reject) => {
        shown++;
        pending.push({ ok: () => resolve(mintTestPresence(req.purpose, { bind: req.binding })), no: () => reject(new PresenceDenied('declined')) });
      }),
  };
  return { provider, pending, shown: () => shown };
}

function rig(presence: PresenceProvider) {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const ring = new KeyRing();
  const keyId = ring.addP256(publicKey);
  const sig = (cardId: string, decision: string, contentHash: string) =>
    cryptoSign('sha256', signaturePreimage('approve', approveMessage({ cardId, decision, cardContentHash: contentHash, approverPrincipalId: HUMAN })), { key: privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64');
  const rows: Array<{ kind: string; payload: Record<string, unknown> }> = [];
  const mono = { t: 1_000 };
  const broker = new ApprovalBroker({
    kernel: SoftwareEd25519Signer.generate('kernel'),
    kernelPrincipal: 'p:abcdefgh/kernel',
    log: async (kind, payload) => void rows.push({ kind, payload }),
    approvals: approvalsKeyFrom(ring, (p) => (p === HUMAN ? keyId : undefined)),
    presence,
    mono: () => mono.t,
    guiSessions: () => 1,
  });
  // `always` is fresh-class: every one prompts, whatever unlock the connection holds
  const decide = async (connId = A) => {
    const c = await broker.raise({ kind: 'permission', requestedBy: AGENT, attended: true, detail: { tool: 'Bash', input: 'ls' }, lines: ['Bash: ls'], tool: 'Bash', toolInput: { command: 'ls' }, ruleScope: { repoKey: 'sha256:' + '0'.repeat(64) } }); // `always` needs a rule scope (always-rules)
    return broker.approve(H(connId), { cardId: c.cardId, decision: 'always', decisionSig: sig(c.cardId, 'always', c.contentHash) });
  };
  return { broker, rows, mono, decide };
}

async function why(p: Promise<unknown>): Promise<{ reason: unknown; why: unknown; retryAfterMs?: unknown }> {
  const e = await p.then(
    () => null,
    (x: unknown) => x,
  );
  expect(e).toBeInstanceOf(RefusedError);
  const r = (e as RefusedError).refusal;
  expect(validateRefusalV1(r)).toEqual([]);
  const d = (r.data ?? {}) as Record<string, unknown>;
  return { reason: d.reason, why: d.why, ...(d.retryAfterMs !== undefined ? { retryAfterMs: d.retryAfterMs } : {}) };
}

const tick = () => new Promise((r) => setImmediate(r));

describe('L2: one outstanding fresh prompt per connection', () => {
  it('FALSIFIER: a second prompt on the same connection is refused while the first is open; another connection is not affected', async () => {
    const m = manual();
    const r = rig(m.provider);
    const first = r.decide();
    await tick();
    expect(m.shown()).toBe(1);
    expect(await why(r.decide())).toEqual({ reason: 'presence', why: 'prompt-outstanding' });
    expect(m.shown()).toBe(1); // nothing was shown for the refused one
    const other = r.decide(B);
    await tick();
    expect(m.shown()).toBe(2);
    m.pending[0]!.ok();
    m.pending[1]!.ok();
    expect((await first).state).toBe('decided');
    expect((await other).state).toBe('decided');
    expect(r.rows.some((x) => x.kind === 'approval.presence.denied' && x.payload.why === 'prompt-outstanding')).toBe(true);
  });

  it('an accepted prompt starts no cooldown: the next fresh decision prompts at once', async () => {
    const m = manual();
    const r = rig(m.provider);
    const a = r.decide();
    await tick();
    m.pending[0]!.ok();
    await a;
    const b = r.decide();
    await tick();
    expect(m.shown()).toBe(2);
    m.pending[1]!.ok();
    expect((await b).state).toBe('decided');
  });
});

describe('L2: cooldown after an unproved prompt', () => {
  it('FALSIFIER: after a decline the connection waits PROMPT_COOLDOWN_MS; nothing is shown inside it; then it prompts again', async () => {
    const m = manual();
    const r = rig(m.provider);
    const a = r.decide();
    await tick();
    m.pending[0]!.no();
    expect((await why(a)).reason).toBe('presence');
    r.mono.t += PROMPT_COOLDOWN_MS - 1;
    expect(await why(r.decide())).toEqual({ reason: 'presence', why: 'prompt-cooldown', retryAfterMs: 1 });
    expect(m.shown()).toBe(1);
    // another connection is not cooled
    const other = r.decide(B);
    await tick();
    expect(m.shown()).toBe(2);
    m.pending[1]!.ok();
    await other;
    r.mono.t += 1;
    const again = r.decide();
    await tick();
    expect(m.shown()).toBe(3);
    m.pending[2]!.ok();
    expect((await again).state).toBe('decided');
  });

  it('a closed connection forgets its cooldown state', async () => {
    const m = manual();
    const r = rig(m.provider);
    const a = r.decide();
    await tick();
    m.pending[0]!.no();
    await a.catch(() => undefined);
    await r.broker.connectionClosed(A);
    const b = r.decide();
    await tick();
    expect(m.shown()).toBe(2);
    m.pending[1]!.ok();
    await b;
  });
});
