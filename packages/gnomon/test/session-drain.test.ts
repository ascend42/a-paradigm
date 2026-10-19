// @gnomon-platform: darwin
/**
 * $daemon-lifecycle + #supervisor — the §2.4 rule 11 drain (TD-2026-10-19-908, TD-2026-10-19-528 F4,
 * TD-2026-10-19-814 item 2; T-2026-10-19-014 slice B1), with the FAKE claude (test/fixtures/fake-claude.mjs)
 * under the real generated session profile and a REAL #approval-broker. Never the real claude.
 *
 * Falsifiers:
 *   - once a drain begins, session.open and session.send are refused ENGINE{draining}: no new turn starts;
 *   - a session idle at the drain is recorded clean (session.exited{reason:'drain-clean'});
 *   - a turn that reaches its boundary inside the deadline is recorded clean;
 *   - a session still mid-turn at the deadline gets the interrupt control message (session.inject{channel:'drain'})
 *     and is recorded interrupted (session.exited{reason:'drain-interrupted'});
 *   - every live Claude session gets session.drained{uuid, reason:'upgrade'} BEFORE its session.exited, and the
 *     uuid is the backend session id the session was opened with;
 *   - F4: a pending card bound to a session expires with why 'session-drained'; a card bound to no session stays pending.
 */
import { generateKeyPairSync } from 'node:crypto';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { RefusedError, validateKindPayload } from '@a-company/gnomon-contracts';
import { ApprovalBroker, approvalsKeyFrom, type PresenceProvider } from '../src/kernel/broker/index.js';
import { BudgetFuse } from '../src/kernel/budget/fuse.js';
import { DaemonChildren } from '../src/kernel/lifecycle/children.js';
import { processControlFor } from '../src/kernel/lifecycle/process-control.js';
import { KeyRing, SoftwareEd25519Signer } from '../src/kernel/log/signer.js';
import { darwinFloor } from '../src/kernel/sandbox/session.js';
import { DRAIN_EXIT_REASONS, SessionSupervisor } from '../src/kernel/supervisor/supervisor.js';
import { mintTestPresence } from '../src/kernel/testing.js';
import { sessionWorld, setMode, trace, waitFor, type SessionWorld } from './session-helpers.js';

const SANDBOX_OK = darwinFloor().ok;
const HUMAN = 'p:abcdefgh/founder';

let w: SessionWorld;
const live: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  for (const f of live.splice(0)) await f().catch(() => undefined);
  w?.cleanup();
});

function rig(o: { failDrainInject?: boolean } = {}) {
  w = sessionWorld();
  const rows: Array<{ kind: string; payload: Record<string, unknown>; session?: string }> = [];
  const log = async (kind: string, payload: Record<string, unknown>, ids: { session?: string } = {}): Promise<void> => {
    if (o.failDrainInject && kind === 'session.inject' && payload.channel === 'drain' && payload.failed !== true) throw new Error('write failed');
    rows.push({ kind, payload, ...(ids.session ? { session: ids.session } : {}) });
  };
  const kernel = SoftwareEd25519Signer.generate('kernel');
  const fuse = new BudgetFuse({ kernel, logId: 'log:01HZZZZZZZZZZZZZZZZZZZZZZZ', log, billing: { env: () => ({}), layers: () => [] } });
  const children = new DaemonChildren({ append: log, control: processControlFor('darwin'), boot: 'boot-test', graceMs: 500 });
  const { publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const ring = new KeyRing();
  const keyId = ring.addP256(publicKey);
  const presence: PresenceProvider = { prove: async (req) => mintTestPresence(req.purpose, { bind: req.binding }) };
  const broker = new ApprovalBroker({ kernel, kernelPrincipal: 'p:abcdefgh/kernel', log, approvals: approvalsKeyFrom(ring, (p) => (p === HUMAN ? keyId : undefined)), presence, guiSessions: () => 1 });
  const sup = new SessionSupervisor({ log, children, fuse, broker, home: w.home, userHome: w.userHome, kernelPrincipal: 'p:abcdefgh/kernel', sock: path.join(w.home, 'gnomon.sock'), claudePath: w.claude, env: () => ({ HOME: w.userHome, PATH: '/usr/bin:/bin' }), platform: 'darwin', watchMs: 10_000, allowScripts: true });
  live.push(() => children.stopAll('test-end'));
  const open = async (mode: Record<string, unknown>) => {
    setMode(w, mode);
    return sup.open({ principal: HUMAN, principalClass: 'human', attended: true, cwd: w.cwd });
  };
  const rowsOf = (kind: string, hsid?: string) => rows.filter((r) => r.kind === kind && (hsid === undefined || r.session === hsid || r.payload.hsid === hsid));
  const idxOf = (kind: string, hsid: string) => rows.findIndex((r) => r.kind === kind && (r.session === hsid || r.payload.hsid === hsid));
  return { rows, broker, sup, open, rowsOf, idxOf };
}

async function refusal(p: Promise<unknown>): Promise<RefusedError> {
  const e = await p.then(() => undefined, (x: unknown) => x);
  expect(e).toBeInstanceOf(RefusedError);
  return e as RefusedError;
}

const holdWrite = (id: string) => ({ permissionAsk: { steps: [{ request: { id, tool: 'Write', input: { file_path: path.join(w.cwd, `${id}.txt`), content: 'x' } } }], hold: true } });

describe.skipIf(!SANDBOX_OK)('§2.4 rule 11: drain (T-2026-10-19-014 B1)', () => {
  it('idle ⇒ clean, mid-turn at the deadline ⇒ interrupted; session.drained precedes session.exited; F4 cards; no new turn starts', async () => {
    const r = rig();
    const idle = await r.open({});
    const busy = await r.open(holdWrite('req-busy'));
    await r.sup.send(HUMAN, { hsid: busy.hsid, text: 'go' });
    expect(await waitFor(() => r.broker.cards().some((c) => c.hsid === busy.hsid && c.state === 'pending'))).toBe(true);
    const sessionCard = r.broker.cards().find((c) => c.hsid === busy.hsid)!;
    // a card bound to no session (an install / api-token / fallback card): it must survive the drain for re-raise
    const loose = await r.broker.raise({ kind: 'daemon-stop', requestedBy: HUMAN, attended: true, detail: { reason: 'stop', connId: 'conn:x' }, lines: ['not session-bound'], decisions: ['accept', 'reject'], timeoutMs: 60_000 });

    const draining = r.sup.drain({ deadlineMs: 400 });
    expect(r.sup.draining()).toBe(true);
    const sendRefused = await refusal(r.sup.send(HUMAN, { hsid: idle.hsid, text: 'one more' }));
    expect(sendRefused.refusal).toMatchObject({ code: 'ENGINE', data: { reason: 'draining' } });
    const openRefused = await refusal(r.open({}));
    expect(openRefused.refusal).toMatchObject({ code: 'ENGINE', data: { reason: 'draining' } });
    expect(r.rowsOf('turn.sent', idle.hsid)).toEqual([]); // the refused send started nothing

    const report = await draining;
    expect(report).toMatchObject({ deadlineMs: 400, deadlineSource: 'caller' });
    const byHsid = Object.fromEntries(report.sessions.map((s) => [s.hsid, s.outcome]));
    expect(byHsid).toEqual({ [idle.hsid]: 'clean', [busy.hsid]: 'interrupted' });

    for (const [s, outcome] of [[idle, 'clean'], [busy, 'interrupted']] as const) {
      const drained = r.rowsOf('session.drained', s.hsid);
      expect(drained).toHaveLength(1);
      expect(validateKindPayload('session.drained', drained[0]!.payload)).toEqual([]);
      const opened = r.rowsOf('session.open', s.hsid)[0]!.payload;
      expect(drained[0]!.payload).toEqual({ uuid: opened.uuid, reason: 'upgrade' });
      const exitedAt = r.idxOf('session.exited', s.hsid);
      expect(exitedAt).toBeGreaterThan(r.idxOf('session.drained', s.hsid));
      expect(r.rows[exitedAt]!.payload.reason).toBe(DRAIN_EXIT_REASONS[outcome]);
      expect(r.sup.stateOf(s.hsid)).toBe('exited');
      expect(r.sup.status().find((x) => x.hsid === s.hsid)).toMatchObject({ drained: outcome });
    }
    // the interrupt reached the busy session (and only it), with the deadline on its inject row
    const injects = r.rowsOf('session.inject', busy.hsid).filter((x) => x.payload.channel === 'drain');
    expect(injects).toHaveLength(1);
    expect(injects[0]!.payload).toMatchObject({ origin: 'kernel', deadlineMs: 400, deadlineSource: 'caller' });
    expect(r.rowsOf('session.inject', idle.hsid).filter((x) => x.payload.channel === 'drain')).toEqual([]);
    expect(trace(w).some((t) => t.t === 'stdin' && (t.m as { request?: { subtype?: string } }).request?.subtype === 'interrupt')).toBe(true);

    // F4: the session-bound card expired session-drained; the loose card is still pending
    expect(r.broker.card(sessionCard.cardId)?.state).toBe('expired');
    expect(r.rowsOf('approval.expire').filter((x) => x.payload.cardId === sessionCard.cardId).map((x) => x.payload.why)).toEqual(['session-drained']);
    expect(r.broker.card(loose.cardId)?.state).toBe('pending');
    expect(r.rowsOf('approval.expire').some((x) => x.payload.cardId === loose.cardId)).toBe(false);

    // idempotent: a second drain is the first one
    expect(await r.sup.drain()).toBe(report);
  });

  it('Aegis L5: a failed drain interrupt write is logged session.inject{channel:drain, failed:true}, not swallowed', async () => {
    const r = rig({ failDrainInject: true });
    const busy = await r.open(holdWrite('req-busy'));
    await r.sup.send(HUMAN, { hsid: busy.hsid, text: 'go' });
    expect(await waitFor(() => r.broker.cards().some((c) => c.hsid === busy.hsid && c.state === 'pending'))).toBe(true);
    const report = await r.sup.drain({ deadlineMs: 300 });
    expect(report.sessions.map((s) => s.hsid)).toContain(busy.hsid);
    const failed = r.rowsOf('session.inject', busy.hsid).filter((x) => x.payload.channel === 'drain');
    expect(failed.map((x) => x.payload)).toEqual([{ hsid: busy.hsid, origin: 'kernel', channel: 'drain', deadlineMs: 300, deadlineSource: 'caller', failed: true }]);
  });

  it('a turn that reaches its boundary inside the deadline is recorded clean (no interrupt)', async () => {
    const r = rig();
    // no `hold`: the fake finishes its turn (a result line) once its one request is answered
    const s = await r.open({ permissionAsk: { steps: [{ request: { id: 'req-late', tool: 'Write', input: { file_path: path.join(w.cwd, 'late.txt'), content: 'x' } } }] } });
    await r.sup.send(HUMAN, { hsid: s.hsid, text: 'go' });
    expect(await waitFor(() => r.broker.cards().some((c) => c.hsid === s.hsid && c.state === 'pending'))).toBe(true);
    const draining = r.sup.drain({ deadlineMs: 10_000 });
    // the turn is still running: the drain waits for it, and its card is still answerable
    await new Promise((res) => setTimeout(res, 150));
    expect(r.rowsOf('session.drained', s.hsid)).toEqual([]);
    const card = r.broker.cards().find((c) => c.hsid === s.hsid)!;
    await r.broker.expire(card.cardId, 'cancelled'); // the request is answered (deny); the fake ends its turn
    const started = Date.now();
    const report = await draining;
    expect(Date.now() - started).toBeLessThan(5_000); // well inside the 10 s deadline: the boundary, not the deadline, ended the wait
    expect(report.sessions).toEqual([{ hsid: s.hsid, uuid: r.rowsOf('session.open', s.hsid)[0]!.payload.uuid, outcome: 'clean' }]);
    expect(r.rowsOf('session.inject', s.hsid).filter((x) => x.payload.channel === 'drain')).toEqual([]);
    expect(r.rows[r.idxOf('session.exited', s.hsid)]!.payload.reason).toBe('drain-clean');
  });
});
