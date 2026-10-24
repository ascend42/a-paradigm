// @gnomon-platform: darwin, linux
/**
 * $daemon-lifecycle + #approval-broker — `gnomon daemon stop` as a signed daemon-stop card (T-2026-10-19-014 B0,
 * founder ruling F3 of TD-2026-10-19-528, spec §3.1 I3).
 * Falsifiers: a stop request raises a daemon-stop card and only a fresh-presence accept stops; reject and expiry
 * keep the kernel running; agent, session, mod, voice, read-token, peer and GUI launch-token connections never
 * raise one; a cached unlock never decides one; the real daemon refuses an unknown connection and exits with
 * reason `stop` (exit 0, no restart).
 */
import { generateKeyPairSync, sign as cryptoSign } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { RefusedError, validateCardV1 } from '@a-company/gnomon-contracts';
import { ApprovalBroker, approvalsKeyFrom, DaemonStopCards, PresenceDenied, type PresenceProvider } from '../src/kernel/broker/index.js';
import { approveMessage, KeyRing, signaturePreimage, SoftwareEd25519Signer } from '../src/kernel/log/signer.js';
import { mintTestPresence } from '../src/kernel/testing.js';
import { startDaemon, type DaemonEvent } from '../src/kernel/lifecycle/index.js';
import { DAEMON_EXIT } from '../src/kernel/lifecycle/exit-codes.js';
import { tempHome } from './daemon-helpers.js';

const HUMAN = 'p:abcdefgh/matt';
const KERNEL = 'p:abcdefgh/kernel';
const GUI_CONN = 'conn:01HZZZZZZZZZZZZZZZZZZZZZZA';
const CLI_CONN = 'conn:01HZZZZZZZZZZZZZZZZZZZZZZC';

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()!();
});

function rig(touch: { on: boolean } = { on: true }) {
  const kernel = SoftwareEd25519Signer.generate('kernel');
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const ring = new KeyRing();
  const keyId = ring.addP256(publicKey);
  const sig = (cardId: string, decision: string, contentHash: string) =>
    cryptoSign('sha256', signaturePreimage('approve', approveMessage({ cardId, decision, cardContentHash: contentHash, approverPrincipalId: HUMAN })), { key: privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64');
  const prompts: string[] = [];
  const presence: PresenceProvider = {
    prove: async (req) => {
      prompts.push(req.prompt.text);
      if (!touch.on) throw new PresenceDenied('the human did not touch');
      return mintTestPresence(req.purpose, { bind: req.binding });
    },
  };
  const rows: Array<{ kind: string; payload: Record<string, unknown> }> = [];
  const now = { t: Date.UTC(2026, 9, 19, 12) };
  const broker = new ApprovalBroker({
    kernel,
    kernelPrincipal: KERNEL,
    log: async (kind, payload) => void rows.push({ kind, payload }),
    approvals: approvalsKeyFrom(ring, (p) => (p === HUMAN ? keyId : undefined)),
    presence,
    clock: () => now.t,
    mono: () => now.t,
    guiSessions: () => 1,
  });
  const stops: string[] = [];
  const cards = new DaemonStopCards(broker, (reason) => stops.push(reason), 60_000);
  const human = { connId: CLI_CONN, principal: HUMAN, principalClass: 'human', credential: 'device' };
  return { broker, cards, stops, rows, now, sig, prompts, human };
}

const tick = (): Promise<void> => new Promise((r) => setImmediate(r));
const cliApprover = { connId: CLI_CONN, principal: HUMAN, principalClass: 'human', surface: 'cli', credential: 'device' };
const guiApprover = { connId: GUI_CONN, principal: HUMAN, principalClass: 'human', surface: 'browser', credential: 'gui' };

async function refusalOf(p: Promise<unknown>): Promise<{ code: string; reason: unknown }> {
  const e = await p.then(
    () => undefined,
    (x: unknown) => x,
  );
  expect(e).toBeInstanceOf(RefusedError);
  return { code: (e as RefusedError).refusal.code, reason: (e as RefusedError).refusal.data?.reason };
}

describe('daemon-stop card (F3)', () => {
  it('a stop request raises one signed daemon-stop card; a fresh-presence accept stops with the reason', async () => {
    const r = rig();
    const card = await r.cards.request(r.human);
    expect(validateCardV1(card, { mode: 'strict' })).toEqual([]);
    expect(card).toMatchObject({ kind: 'daemon-stop', requestedBy: HUMAN, state: 'pending', attended: true });
    expect(card.actions.map((a) => (a as { decision: string }).decision).sort()).toEqual(['accept', 'reject']);
    expect(r.rows.map((x) => x.kind)).toEqual(['approval.request']);
    // a second request while one is pending gets the same card: no stacked prompts
    expect((await r.cards.request(r.human)).cardId).toBe(card.cardId);
    const d = await r.broker.approve(cliApprover, { cardId: card.cardId, decision: 'accept', decisionSig: r.sig(card.cardId, 'accept', card.contentHash) });
    expect(d).toMatchObject({ state: 'decided', presence: 'cli' });
    expect(r.prompts).toHaveLength(1);
    expect(r.stops).toEqual([]); // the approve reply leaves before the kernel stops
    await tick();
    expect(r.stops).toEqual(['stop']);
  });

  it('two requests at the same moment share the in-flight raise: one card, one approval.request row (Aegis L5)', async () => {
    const r = rig();
    const [a, b, c] = await Promise.all([r.cards.request(r.human), r.cards.request(r.human), r.cards.request(r.human)]);
    expect(b.cardId).toBe(a.cardId);
    expect(c.cardId).toBe(a.cardId);
    expect(r.broker.cards().filter((x) => x.kind === 'daemon-stop')).toHaveLength(1);
    expect(r.rows.map((x) => x.kind)).toEqual(['approval.request']);
  });

  it('Aegis L2: a request for a DIFFERENT reason is refused BAD_REQUEST{bad-params}, never handed the pending card', async () => {
    const r = rig();
    const card = await r.cards.request(r.human, 'stop');
    const e = await r.cards.request(r.human, 'upgrade').then(() => undefined, (x: unknown) => x);
    expect(e).toBeInstanceOf(RefusedError);
    expect((e as RefusedError).refusal).toMatchObject({ code: 'BAD_REQUEST', data: { reason: 'bad-params', pendingReason: 'stop', cardId: card.cardId } });
    // in flight too: the raise that has not landed yet answers only its own reason
    const r2 = rig();
    const [a, b] = await Promise.all([r2.cards.request(r2.human, 'upgrade'), r2.cards.request(r2.human, 'stop').then(() => undefined, (x: unknown) => x)]);
    expect(a.kind).toBe('daemon-stop');
    expect((b as RefusedError).refusal).toMatchObject({ code: 'BAD_REQUEST', data: { reason: 'bad-params', pendingReason: 'upgrade' } });
    expect(r2.broker.cards().filter((x) => x.kind === 'daemon-stop')).toHaveLength(1);
    // the same reason still gets the same card
    expect((await r.cards.request(r.human, 'stop')).cardId).toBe(card.cardId);
  });

  it('reject, a declined Touch ID and expiry all keep the kernel running', async () => {
    const touch = { on: false };
    const r = rig(touch);
    const c1 = await r.cards.request(r.human);
    expect(await refusalOf(r.broker.approve(cliApprover, { cardId: c1.cardId, decision: 'accept', decisionSig: r.sig(c1.cardId, 'accept', c1.contentHash) }))).toMatchObject({ code: 'FORBIDDEN', reason: 'presence' });
    touch.on = true;
    r.now.t += 3_000; // the declined prompt's cooldown
    expect(await r.broker.approve(cliApprover, { cardId: c1.cardId, decision: 'reject', decisionSig: r.sig(c1.cardId, 'reject', c1.contentHash) })).toMatchObject({ state: 'decided' });
    const c2 = await r.cards.request(r.human);
    expect(c2.cardId).not.toBe(c1.cardId);
    r.now.t += 60_001;
    expect(await r.broker.expireDue()).toEqual([c2.cardId]);
    expect(r.broker.card(c2.cardId)!.state).toBe('expired');
    await tick();
    expect(r.stops).toEqual([]);
  });

  it('agent, session, mod, voice, read-token, peer and GUI launch-token connections never raise one', async () => {
    const r = rig();
    for (const [principalClass, credential] of [['agent', 'device'], ['session', 'device'], ['mod', 'device'], ['voice', 'device'], ['readToken', 'read-token'], ['peer', 'device'], ['human', 'gui'], ['none', undefined]] as const) {
      expect(await refusalOf(r.cards.request({ connId: CLI_CONN, principal: 'p:abcdefgh/x', principalClass, credential })), `${principalClass}/${credential}`).toEqual({ code: 'FORBIDDEN', reason: 'matrix' });
    }
    expect(r.rows).toEqual([]);
    expect(r.broker.cards()).toEqual([]);
  });

  it('a cached unlock never decides a daemon-stop card: fresh presence every time', async () => {
    const touch = { on: true };
    const r = rig(touch);
    // open a cached unlock on the GUI connection with a fresh-presence permission decision
    const p = await r.broker.raise({ kind: 'permission', requestedBy: 'p:abcdefgh/s-01hzzzzz', attended: true, detail: { tool: 'Bash' }, lines: ['Bash: ls'], tool: 'Bash' });
    await r.broker.approve(guiApprover, { cardId: p.cardId, decision: 'allow', decisionSig: r.sig(p.cardId, 'allow', p.contentHash) });
    touch.on = false;
    const c = await r.cards.request(r.human);
    expect(await refusalOf(r.broker.approve(guiApprover, { cardId: c.cardId, decision: 'accept', decisionSig: r.sig(c.cardId, 'accept', c.contentHash) }))).toMatchObject({ code: 'FORBIDDEN', reason: 'presence' });
    expect(r.broker.card(c.cardId)!.state).toBe('pending');
    await tick();
    expect(r.stops).toEqual([]);
  });
});

describe('the daemon side of daemon stop', () => {
  it('requestStop refuses a connection that is not an authenticated human device; shutdown(stop) exits 0-class with daemon.exit{reason:stop}', async () => {
    const t = tempHome();
    cleanups.push(t.cleanup);
    const events: DaemonEvent[] = [];
    const d = await startDaemon({ home: t.home, idleMs: 60_000, onEvent: (e) => events.push(e) });
    cleanups.push(() => d.shutdown('signal'));
    expect(await refusalOf(d.requestStop('conn:01HZZZZZZZZZZZZZZZZZZZZZZQ'))).toEqual({ code: 'FORBIDDEN', reason: 'matrix' });
    expect(d.status().connections).toBe(0);
    let exited = false;
    void d.exited.then(() => (exited = true));
    await tick();
    expect(exited).toBe(false);
    await d.shutdown('stop');
    expect(await d.exited).toBe('stop');
    expect(events.at(-1)).toEqual({ kind: 'daemon.exit', reason: 'stop' });
    // gnomond maps every handle.exited reason to DAEMON_EXIT.ok: the no-restart class
    expect(DAEMON_EXIT.ok).toBe(0);
  });
});
