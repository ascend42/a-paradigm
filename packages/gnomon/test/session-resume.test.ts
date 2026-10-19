// @gnomon-platform: darwin
/**
 * $daemon-lifecycle + #supervisor — the §2.4 rule 11 RESUME (TD-2026-10-19-908, TD-2026-10-19-528 F4,
 * TD-2026-10-19-814 item 2; T-2026-10-19-014 slice B2; G-DMN-04 amended), with the FAKE claude
 * (test/fixtures/fake-claude.mjs) under the real generated session profile, a REAL #approval-broker and a REAL
 * #budget-fuse. An "old kernel" (supervisor + broker + fuse + children) drains; a fresh "new kernel" on the same
 * rows reads them back with planResume and resumes. Never the real claude.
 *
 * Falsifiers:
 *   - drained then exited ⇒ resumed (same hsid, `--resume <same uuid>`); drained with no exit ⇒ swept, never
 *     resumed (the planner + sweep half is test/resume-plan.test.ts, every platform);
 *   - the layers changed between drain and resume ⇒ stopped with session.refused{resume:'layers-changed'};
 *   - the permit no longer checks out (expired) ⇒ stopped with the refusal, nothing minted;
 *   - the permit is re-attributed (permit.reattributed citing the drained row), never minted (no permit.reserve /
 *     permit.grant for the session in the new kernel: the permit.* rows are counted);
 *   - no cached unlock survives (the new broker holds none);
 *   - drain-interrupted ⇒ resumed idle with the "turn interrupted by update" note, and the fake claude receives
 *     no user message; drain-clean ⇒ no note, nothing sent either;
 *   - the old kernel's pending card is retired (approval.expire) and a decision against its id is refused;
 *   - a client without the session.resume hello feature is refused on a resumed session, not degraded.
 */
import { generateKeyPairSync } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { mintId, RefusedError } from '@a-company/gnomon-contracts';
import { ApprovalBroker, approvalsKeyFrom, type PresenceProvider } from '../src/kernel/broker/index.js';
import { BudgetFuse } from '../src/kernel/budget/fuse.js';
import { DaemonChildren } from '../src/kernel/lifecycle/children.js';
import { processControlFor } from '../src/kernel/lifecycle/process-control.js';
import { KeyRing, SoftwareEd25519Signer } from '../src/kernel/log/signer.js';
import { darwinFloor } from '../src/kernel/sandbox/session.js';
import { createSessionPort } from '../src/kernel/supervisor/port.js';
import { INTERRUPTED_NOTE, planResume, resumeAfterUpgrade, type ResumeRow } from '../src/kernel/supervisor/resume.js';
import { SessionSupervisor } from '../src/kernel/supervisor/supervisor.js';
import { mintTestPresence } from '../src/kernel/testing.js';
import { sessionWorld, setMode, trace, waitFor, type SessionWorld } from './session-helpers.js';

const SANDBOX_OK = darwinFloor().ok;
const HUMAN = 'p:abcdefgh/founder';
const KERNEL = 'p:abcdefgh/kernel';
const LOG_ID = 'log:01HZZZZZZZZZZZZZZZZZZZZZZZ';
const TRUST = { principals: [KERNEL], isKernelKey: (k: string) => k === 'key:kernel' };

let w: SessionWorld;
const live: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  for (const f of live.splice(0)) await f().catch(() => undefined);
  w?.cleanup();
});

type Row = ResumeRow & { payload: Record<string, unknown> };

/** One kernel (supervisor + broker + fuse + children) writing into the shared, kernel-signed `rows`. */
function kernel(rows: Row[], opts: { clock?: () => number } = {}) {
  const log = async (kind: string, payload: Record<string, unknown>, ids: { session?: string } = {}): Promise<void> => {
    rows.push({ id: mintId('ev'), kind, principal: KERNEL, keyId: 'key:kernel', payload, ...(ids.session ? { session: ids.session } : {}) });
  };
  const signer = SoftwareEd25519Signer.generate('kernel');
  const fuse = new BudgetFuse({ kernel: signer, logId: LOG_ID, log, billing: { env: () => ({}), layers: () => [] }, ...(opts.clock ? { clock: opts.clock } : {}) });
  const children = new DaemonChildren({ append: log, control: processControlFor('darwin'), boot: 'boot-test', graceMs: 500 });
  const { publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const ring = new KeyRing();
  const keyId = ring.addP256(publicKey);
  const presence: PresenceProvider = { prove: async (req) => mintTestPresence(req.purpose, { bind: req.binding }) };
  const broker = new ApprovalBroker({ kernel: signer, kernelPrincipal: KERNEL, log, approvals: approvalsKeyFrom(ring, (p) => (p === HUMAN ? keyId : undefined)), presence, guiSessions: () => 1 });
  const sup = new SessionSupervisor({ log, children, fuse, broker, home: w.home, userHome: w.userHome, kernelPrincipal: KERNEL, sock: path.join(w.home, 'gnomon.sock'), claudePath: w.claude, env: () => ({ HOME: w.userHome, PATH: '/usr/bin:/bin' }), platform: 'darwin', watchMs: 10_000, allowScripts: true });
  live.push(() => children.stopAll('test-end'));
  return { broker, sup, fuse };
}

function world() {
  w = sessionWorld();
  const rows: Row[] = [];
  const old = kernel(rows);
  const open = async (mode: Record<string, unknown>) => {
    setMode(w, mode);
    return old.sup.open({ principal: HUMAN, principalClass: 'human', attended: true, cwd: w.cwd });
  };
  const of = (kind: string, hsid: string, from = 0) => rows.slice(from).filter((r) => r.kind === kind && (r.session === hsid || r.payload.hsid === hsid));
  return { rows, old, open, of };
}

const holdWrite = (id: string) => ({ permissionAsk: { steps: [{ request: { id, tool: 'Write', input: { file_path: path.join(w.cwd, `${id}.txt`), content: 'x' } } }], hold: true } });

async function drained(r: ReturnType<typeof world>) {
  const idle = await r.open({});
  const busy = await r.open(holdWrite('req-busy'));
  await r.old.sup.send(HUMAN, { hsid: busy.hsid, text: 'go' });
  expect(await waitFor(() => r.old.broker.cards().some((c) => c.hsid === busy.hsid && c.state === 'pending'))).toBe(true);
  // a card bound to no session, left pending by the old kernel (F4)
  const loose = await r.old.broker.raise({ kind: 'daemon-stop', requestedBy: HUMAN, attended: true, detail: { reason: 'stop', connId: 'conn:x' }, lines: ['not session-bound'], decisions: ['accept', 'reject'], timeoutMs: 60_000 });
  const report = await r.old.sup.drain({ deadlineMs: 400 });
  expect(Object.fromEntries(report.sessions.map((s) => [s.hsid, s.outcome]))).toEqual({ [idle.hsid]: 'clean', [busy.hsid]: 'interrupted' });
  return { idle, busy, loose };
}

async function refusal(p: Promise<unknown>): Promise<RefusedError> {
  const e = await p.then(() => undefined, (x: unknown) => x);
  expect(e).toBeInstanceOf(RefusedError);
  return e as RefusedError;
}

describe.skipIf(!SANDBOX_OK)('§2.4 rule 11: resume after an upgrade (T-2026-10-19-014 B2)', () => {
  it('resumes clean and interrupted sessions with the same uuid; permit re-attributed, never minted; note; nothing sent; old card retired; feature gate', async () => {
    const r = world();
    const { idle, busy, loose } = await drained(r);
    const uuidOf = (hsid: string) => r.of('session.drained', hsid)[0]!.payload.uuid as string;
    const traceFrom = trace(w).length;
    const boot = r.rows.length;

    const plan = planResume(r.rows, TRUST);
    expect(plan.resume.map((c) => [c.hsid, c.outcome]).sort()).toEqual([[idle.hsid, 'clean'], [busy.hsid, 'interrupted']].sort());
    expect(plan.unfinished).toEqual([]);
    expect(plan.cards.map((c) => c.cardId)).toEqual([loose.cardId]);

    setMode(w, {});
    const fresh = kernel(r.rows);
    const report = await resumeAfterUpgrade(plan, { supervisor: fresh.sup, broker: fresh.broker });
    expect(report.refused).toEqual([]);
    expect(report.resumed.map((x) => x.hsid).sort()).toEqual([idle.hsid, busy.hsid].sort());
    expect(report.retired).toEqual([{ cardId: loose.cardId, kind: 'daemon-stop' }]);

    for (const s of [idle, busy]) {
      expect(fresh.sup.stateOf(s.hsid)).toBe('running');
      expect(fresh.sup.resumed(s.hsid)).toBe(true);
      // the permit: re-attributed once, citing the drained row; never reserved or granted again (count permit.*)
      const permitRows = r.rows.slice(boot).filter((x) => x.kind.startsWith('permit.') && (x.session === s.hsid || x.payload.hsid === s.hsid));
      expect(permitRows.map((x) => x.kind)).toEqual(['permit.reattributed']);
      expect(permitRows[0]!.payload).toEqual({ permitId: r.of('session.sandbox', s.hsid).find((x) => typeof x.payload.permitId === 'string')!.payload.permitId, hsid: s.hsid, drainedEventId: r.of('session.drained', s.hsid)[0]!.id });
      expect(r.rows.slice(boot).some((x) => x.kind === 'permit.reserve' || x.kind === 'permit.grant')).toBe(false);
      // --resume <the same uuid>
      expect(r.of('session.open', s.hsid, boot)[0]!.payload).toMatchObject({ uuid: uuidOf(s.hsid), resume: { drainedEventId: r.of('session.drained', s.hsid)[0]!.id } });
    }
    expect(await waitFor(() => trace(w).slice(traceFrom).filter((t) => t.t === 'resume').length === 2)).toBe(true); // the children trace after spawn
    const resumes = trace(w).slice(traceFrom).filter((t) => t.t === 'resume').map((t) => t.uuid).sort();
    expect(resumes).toEqual([uuidOf(idle.hsid), uuidOf(busy.hsid)].sort());
    const argvs = trace(w).slice(traceFrom).filter((t) => t.t === 'argv').map((t) => t.args as string[]);
    for (const a of argvs) expect(a).not.toContain('--session-id');

    // interrupted ⇒ the visible note; clean ⇒ none
    expect(r.of('session.sandbox', busy.hsid, boot).filter((x) => x.payload.phase === 'resume-note').map((x) => x.payload.note)).toEqual([INTERRUPTED_NOTE]);
    expect(r.of('session.sandbox', idle.hsid, boot).filter((x) => x.payload.phase === 'resume-note')).toEqual([]);
    // nothing auto-sent: no user message reaches either resumed child, no turn starts
    await new Promise((res) => setTimeout(res, 300));
    expect(trace(w).slice(traceFrom).filter((t) => t.t === 'stdin' && (t.m as { type?: string }).type === 'user')).toEqual([]);
    expect(r.rows.slice(boot).filter((x) => x.kind === 'turn.sent' || (x.kind === 'session.inject' && x.payload.origin === 'client'))).toEqual([]);

    // no cached unlock carries over
    expect(fresh.broker.unlocks.size()).toBe(0);

    // the old pending card: retired on the chain, and a decision against its id is refused
    expect(r.rows.slice(boot).filter((x) => x.kind === 'approval.expire' && x.payload.cardId === loose.cardId).map((x) => x.payload.why)).toEqual(['cancelled']);
    const old = await refusal(fresh.broker.approve({ connId: 'conn:01HZZZZZZZZZZZZZZZZZZZZZZZ', principal: HUMAN, principalClass: 'human', surface: null, credential: 'device' } as never, { cardId: loose.cardId, decision: 'accept', decisionSig: 'AAAA' }));
    expect(old.refusal.code).toBe('NOT_FOUND');
    expect(fresh.broker.card(loose.cardId)).toBeUndefined();

    // a second boot over the same rows resumes nothing again (permit.reattributed / the new open consume the record)
    expect(planResume(r.rows, TRUST).resume).toEqual([]);
    expect(planResume(r.rows, TRUST).cards).toEqual([]);

    // the session.resume feature gate: refused without it, served with it
    const port = createSessionPort(fresh.sup);
    for (const verb of ['send', 'stop'] as const) {
      const call = verb === 'send' ? port.send({ principal: HUMAN, principalClass: 'human', features: ['journal.cursor'] }, { hsid: idle.hsid, content: [{ text: 'hi' }] }) : port.stop({ principal: HUMAN, principalClass: 'human', features: [] }, { hsid: idle.hsid });
      const e = await refusal(call);
      expect(e.refusal).toMatchObject({ code: 'FORBIDDEN', data: { reason: 'matrix', needs: 'session.resume' } });
    }
    expect(r.rows.slice(boot).filter((x) => x.kind === 'turn.sent')).toEqual([]);
    await port.send({ principal: HUMAN, principalClass: 'human', features: ['journal.cursor', 'session.resume'] }, { hsid: idle.hsid, content: [{ text: 'hi' }] });
    expect(r.of('turn.sent', idle.hsid, boot)).toHaveLength(1);
  });

  it('the layers changed between drain and resume ⇒ stopped with the refusal; nothing re-attributed', async () => {
    const r = world();
    const { idle } = await drained(r);
    fs.writeFileSync(path.join(w.userHome, '.claude', 'settings.json'), JSON.stringify({ model: 'changed-after-drain' }));
    const boot = r.rows.length;
    const fresh = kernel(r.rows);
    const report = await resumeAfterUpgrade(planResume(r.rows, TRUST), { supervisor: fresh.sup });
    expect(report.resumed).toEqual([]);
    expect(report.refused.map((x) => x.hsid)).toContain(idle.hsid);
    expect(r.of('session.refused', idle.hsid, boot).map((x) => x.payload.resume)).toEqual(['layers-changed']);
    expect(r.rows.slice(boot).filter((x) => x.kind.startsWith('permit.'))).toEqual([]);
    expect(fresh.sup.stateOf(idle.hsid)).not.toBe('running');
    expect(trace(w).some((t) => t.t === 'resume')).toBe(false);
  });

  it('the permit no longer checks out (expired) ⇒ stopped with the refusal; nothing minted', async () => {
    const r = world();
    const { idle } = await drained(r);
    const boot = r.rows.length;
    const fresh = kernel(r.rows, { clock: () => Date.now() + 2 * 60 * 60_000 });
    const report = await resumeAfterUpgrade(planResume(r.rows, TRUST), { supervisor: fresh.sup });
    expect(report.resumed).toEqual([]);
    expect(report.refused.map((x) => x.hsid)).toContain(idle.hsid);
    expect(r.of('session.refused', idle.hsid, boot)[0]!.payload).toMatchObject({ code: 'spawn_failed', refusal: 'PERMIT_REQUIRED' });
    expect(r.rows.slice(boot).filter((x) => x.kind.startsWith('permit.'))).toEqual([]);
    expect(trace(w).some((t) => t.t === 'resume')).toBe(false);
  });
});
