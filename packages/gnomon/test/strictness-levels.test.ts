/**
 * #strictness-levels (M2.11-lite; spec §3.4, build plan step 9) over a REAL #approval-broker with a software approvals
 * key and a scripted presence provider (the run-mode rig's pattern, test/run-mode-helpers.ts).
 *
 *   G-STR-01 (manual subset)  agent, session, mod and voice principals, and a human off a first-party connection,
 *                             cannot set a level; no principal appends request.strictness.set or approval.strictness.*
 *                             through log.append; the book folds kernel-signed rows only
 *   G-STR-04 (manual subset)  tightening needs no presence; loosening needs FRESH presence (a cached unlock never
 *                             carries it, a declined prompt changes nothing), one level per step
 *   seam                      the level feeds run-mode.ts's ceiling; a raise and a repo mode tightening run the brake
 */
import { generateKeyPairSync, sign as cryptoSign } from 'node:crypto';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ApprovalBroker, approvalsKeyFrom, PresenceDenied, RunModeBook, RunModeControl, StrictnessBook, StrictnessControl, type PresenceProvider } from '../src/kernel/broker/index.js';
import { decisionMessage, KeyRing, signaturePreimage, SoftwareEd25519Signer } from '../src/kernel/log/signer.js';
import { refuseAppend } from '../src/kernel/socket/log-append.js';
import { RpcRefusal } from '../src/kernel/socket/rpc.js';
import { repoKeyOf } from '../src/kernel/supervisor/repo-hooks.js';
import { mintTestPresence } from '../src/kernel/testing.js';
import { repoArg, runStrictnessCommand, STRICTNESS_EXIT_OK, STRICTNESS_EXIT_USAGE } from '../src/cli/strictness-cli.js';
import { ASK_GUI, errOf, HUMAN, KP } from './run-mode-helpers.js';

const GUI = { connId: 'conn:gui', principal: HUMAN, principalClass: 'human', surface: 'browser', credential: 'gui' } as const;
const REPO = 'sha256:' + 'a'.repeat(64);

function rig() {
  const rows: Array<{ kind: string; payload: Record<string, unknown> }> = [];
  const book = new StrictnessBook({ principal: KP, isKernelKey: (k) => k === 'kernel-key' });
  const modeBook = new RunModeBook({ principal: KP, isKernelKey: (k) => k === 'kernel-key' });
  const log = async (kind: string, payload: Record<string, unknown>): Promise<void> => {
    rows.push({ kind, payload });
    const r = { seq: rows.length, kind, principal: KP, keyId: 'kernel-key', payload: structuredClone(payload) };
    book.fold(r);
    modeBook.fold(r);
  };
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const ring = new KeyRing();
  const keyId = ring.addP256(publicKey);
  const gate = { deny: false };
  const prompts: string[] = [];
  const presence: PresenceProvider = {
    prove: async (req) => {
      prompts.push(req.prompt.text);
      if (gate.deny) throw new PresenceDenied('declined at the prompt');
      return mintTestPresence(req.purpose, { bind: req.binding });
    },
  };
  const broker = new ApprovalBroker({ kernel: SoftwareEd25519Signer.generate('kernel'), kernelPrincipal: KP, log, approvals: approvalsKeyFrom(ring, (p) => (p === HUMAN ? keyId : undefined)), presence, guiSessions: () => 1 });
  const brakes: Array<{ repo: string; to: string; via: string }> = [];
  const control = new StrictnessControl({
    broker,
    book: () => book,
    logRequest: (payload, ids) => log('request.strictness.set', { ...payload, connId: ids.connId }),
    repoKeyOfPath: (abs) => repoKeyOf([abs]),
    onTighten: (repo, to) => void brakes.push({ repo, to, via: 'level' }),
  });
  const modes = new RunModeControl({
    broker,
    book: () => modeBook,
    sessions: { scope: () => null, live: () => [] },
    level: (r) => control.level(r),
    logRequest: (payload, ids) => log('request.mode.set', { ...payload, connId: ids.connId }),
    repoKeyOfPath: (abs) => repoKeyOf([abs]),
    userHome: '/nonexistent-home-for-tests',
    onRepoTighten: (repo, to) => void brakes.push({ repo, to, via: 'mode' }),
  });
  const sig = (cardId: string, decision: string) => cryptoSign('sha256', signaturePreimage('approve', decisionMessage({ cardId, decision, cardContentHash: broker.card(cardId)!.contentHash, approverPrincipalId: HUMAN })), { key: privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64');
  const approve = (cardId: string, decision: string) => broker.approve(GUI as never, { cardId, decision, decisionSig: sig(cardId, decision) });
  const kinds = (k: string) => rows.filter((r) => r.kind === k).map((r) => r.payload);
  return { rows, book, broker, control, modes, approve, kinds, gate, prompts, brakes };
}

describe('#strictness-levels: tighten and loosen (G-STR-04, the manual subset)', () => {
  it('a repo with no row is L0; tightening applies at once with NO presence, writes the request and the raised row, and runs the brake', async () => {
    const r = rig();
    expect(r.control.level(REPO)).toBe('L0');
    const out = await r.control.request(ASK_GUI, { repo: REPO, to: 'L2' });
    expect(out).toMatchObject({ changed: true, applied: true, from: 'L0', to: 'L2', presence: 'none' });
    expect(r.prompts).toHaveLength(0);
    expect(r.kinds('request.strictness.set')).toEqual([{ repo: REPO, to: 'L2', connId: 'conn:gui' }]);
    expect(r.kinds('approval.strictness.raised')).toEqual([expect.objectContaining({ repo: REPO, from: 'L0', to: 'L2', cause: 'manual', presence: 'none' })]);
    expect(r.control.level(REPO)).toBe('L2');
    expect(r.brakes).toEqual([{ repo: REPO, to: 'L2', via: 'level' }]);
    // the same level again changes nothing
    expect(await r.control.request(ASK_GUI, { repo: REPO, to: 'L2' })).toMatchObject({ changed: false, level: 'L2' });
  });

  it('loosening raises a strictness card, and only FRESH presence on allow lowers the level one step', async () => {
    const r = rig();
    await r.control.request(ASK_GUI, { repo: REPO, to: 'L3' });
    const out = (await r.control.request(ASK_GUI, { repo: REPO, to: 'L2' })) as { pending: true; cardId: string };
    expect(out).toMatchObject({ pending: true, from: 'L3', to: 'L2' });
    expect(r.control.level(REPO)).toBe('L3'); // nothing changes before the decision
    expect(r.broker.card(out.cardId)).toMatchObject({ kind: 'strictness', state: 'pending' });
    expect(r.control.status()).toMatchObject({ built: true, repos: [{ repoKey: REPO, level: 'L3', pendingCardId: out.cardId, pendingTo: 'L2' }] });
    // the same request returns the same card; a different one waits
    expect(await r.control.request(ASK_GUI, { repo: REPO, to: 'L2' })).toMatchObject({ cardId: out.cardId });
    await r.approve(out.cardId, 'allow');
    expect(r.prompts).toHaveLength(1);
    expect(r.kinds('approval.strictness.lowered')).toEqual([expect.objectContaining({ repo: REPO, from: 'L3', to: 'L2', presence: 'fresh' })]);
    expect(r.control.level(REPO)).toBe('L2');
  });

  it('a cached unlock never carries a loosening; a declined prompt or a deny keeps the level', async () => {
    const r = rig();
    await r.control.request(ASK_GUI, { repo: REPO, to: 'L1' });
    const perm = await r.broker.raise({ kind: 'permission', requestedBy: 'p:abcdefgh/s-x', attended: true, detail: { tool: 'Write' }, lines: ['Write x'], decisions: ['allow', 'deny'] });
    await r.approve(perm.cardId, 'allow');
    expect(r.broker.unlocks.has('conn:gui')).toBe(true);
    const n = r.prompts.length;
    const out = (await r.control.request(ASK_GUI, { repo: REPO, to: 'L0' })) as { cardId: string };
    r.gate.deny = true;
    const e = await errOf(r.approve(out.cardId, 'allow'));
    expect(e.refusal).toMatchObject({ code: 'FORBIDDEN', data: { reason: 'presence' } });
    expect(r.prompts.length).toBe(n + 1);
    expect(r.kinds('approval.strictness.lowered')).toHaveLength(0);
    expect(r.control.level(REPO)).toBe('L1');
    r.gate.deny = false;
    await r.approve(out.cardId, 'deny');
    expect(r.control.level(REPO)).toBe('L1');
  });

  it('loosening goes one level per step; tightening withdraws a pending loosening card', async () => {
    const r = rig();
    await r.control.request(ASK_GUI, { repo: REPO, to: 'L3' });
    const e = await errOf(r.control.request(ASK_GUI, { repo: REPO, to: 'L1' }));
    expect(e.refusal).toMatchObject({ code: 'BAD_REQUEST', data: { reason: 'bad-params' } });
    expect(e.message).toContain('one level per step');
    const step = (await r.control.request(ASK_GUI, { repo: REPO, to: 'L2' })) as { cardId: string };
    await r.approve(step.cardId, 'allow');
    expect(r.control.level(REPO)).toBe('L2');
    const loosen = (await r.control.request(ASK_GUI, { repo: REPO, to: 'L1' })) as { cardId: string };
    await r.control.request(ASK_GUI, { repo: REPO, to: 'L3' });
    expect(r.broker.card(loosen.cardId)?.state).not.toBe('pending');
    expect(r.control.level(REPO)).toBe('L3');
  });

  it('a folder names its repo by repo key; a bad payload is refused', async () => {
    const r = rig();
    const dir = path.resolve('/tmp', 'some-repo');
    await r.control.request(ASK_GUI, { repo: dir, to: 'L1' });
    expect(r.control.level(repoKeyOf([dir]))).toBe('L1');
    for (const bad of [{ repo: REPO, to: 'L4' }, { repoKey: REPO }, { repoKey: 'x', level: 'L1' }, { repo: 'relative', level: 'L1' }, { repoKey: REPO, repo: dir, level: 'L1' }, { repoKey: REPO, level: 'L1', extra: 1 }]) {
      expect((await errOf(r.control.request(ASK_GUI, bad))).refusal.code).toBe('BAD_REQUEST');
    }
    // the CLI's repo argument: a key as is, a folder resolved against the current folder
    expect(repoArg(REPO, dir)).toEqual({ repo: REPO });
    expect(repoArg('sub', dir)).toEqual({ repo: path.resolve(dir, 'sub') });
  });
});

describe('#strictness-levels: a loosening takes fresh presence only (Aegis step 9 review)', () => {
  it('an allow carried by a standing grant, a cached unlock or no presence is refused; nothing is lowered', async () => {
    const raised: any[] = [];
    const written: unknown[] = [];
    const book = new StrictnessBook({ principal: KP, isKernelKey: () => true });
    book.apply(REPO, 'L2');
    const control = new StrictnessControl({
      broker: { raise: async (i: any) => (raised.push(i), { cardId: 'card:1' }) as any, card: () => ({ state: 'pending' }) as any, strictnessSet: async (...a: unknown[]) => void written.push(a) } as any,
      book: () => book,
      logRequest: async () => undefined,
      repoKeyOfPath: (abs) => repoKeyOf([abs]),
    });
    await control.request(ASK_GUI, { repo: REPO, to: 'L1' });
    const effect = raised[0].effect as (d: string, ctx: Record<string, unknown>) => Promise<void>;
    for (const presence of ['standing:grant-1', 'cached', 'voice-armed', undefined]) {
      const e = await errOf(effect('allow', { connId: 'conn:gui', presence, token: null, rootSig: null }));
      expect(e.refusal).toMatchObject({ code: 'FORBIDDEN', data: { reason: 'presence' } });
    }
    expect(written).toHaveLength(0);
    expect(control.level(REPO)).toBe('L2');
    await effect('allow', { connId: 'conn:gui', presence: 'fresh', token: null, rootSig: null });
    expect(written).toHaveLength(1);
    expect(control.level(REPO)).toBe('L1');
  });
});

describe('#strictness-levels: who may set a level (G-STR-01, the manual subset)', () => {
  it('only the human on a gui or device connection; every other class and credential is refused FORBIDDEN{matrix}', async () => {
    const r = rig();
    for (const asker of [
      { connId: 'c1', principal: 'p:abcdefgh/s-1', principalClass: 'agent', credential: 'gui' },
      { connId: 'c2', principal: 'p:abcdefgh/s-2', principalClass: 'session', credential: 'device' },
      { connId: 'c3', principal: 'p:abcdefgh/mod-x', principalClass: 'mod', credential: 'gui' },
      { connId: 'c4', principal: 'p:abcdefgh/voice', principalClass: 'voice', credential: 'gui' },
      { connId: 'c5', principal: HUMAN, principalClass: 'human', credential: 'read-token' },
      { connId: 'c6', principal: HUMAN, principalClass: 'human', credential: undefined },
    ]) {
      const e = await errOf(r.control.request(asker, { repo: REPO, to: 'L3' }));
      expect(e.refusal).toMatchObject({ code: 'FORBIDDEN', data: { reason: 'matrix' } });
    }
    expect(r.rows).toHaveLength(0);
    expect(r.control.level(REPO)).toBe('L0');
  });

  it('no principal appends the request or the approval rows through log.append', () => {
    for (const cls of ['human', 'agent', 'mod', 'voice'] as const) {
      for (const kind of ['request.strictness.set', 'approval.strictness.raised', 'approval.strictness.lowered']) {
        let err: unknown;
        try {
          refuseAppend(cls, 'p:abcdefgh/x', { kind, payload: { repo: REPO, to: 'L0' } });
        } catch (x) {
          err = x;
        }
        expect(err).toBeInstanceOf(RpcRefusal);
        expect((err as RpcRefusal).refusal.code).toBe('FORBIDDEN');
      }
    }
  });

  it('the book folds kernel-signed rows only; an unknown level from a newer kernel folds as L3', () => {
    const book = new StrictnessBook({ principal: KP, isKernelKey: (k) => k === 'kernel-key' });
    book.fold({ seq: 1, kind: 'approval.strictness.lowered', principal: 'p:abcdefgh/s-1', keyId: 'kernel-key', payload: { repo: REPO, from: 'L0', to: 'L0' } });
    book.fold({ seq: 2, kind: 'approval.strictness.lowered', principal: KP, keyId: 'other-key', payload: { repo: REPO, from: 'L0', to: 'L0' } });
    expect(book.level(REPO)).toBe('L0');
    // Aegis S2 H-3: a raise only narrows, so it is honoured from any key in the chain; a lowering still needs a kernel key
    book.fold({ seq: 2, kind: 'approval.strictness.raised', principal: KP, keyId: 'other-key', payload: { repo: REPO, from: 'L0', to: 'L2' } });
    expect(book.level(REPO)).toBe('L2');
    book.fold({ seq: 2, kind: 'approval.strictness.lowered', principal: KP, keyId: 'other-key', payload: { repo: REPO, from: 'L2', to: 'L0' } });
    expect(book.level(REPO)).toBe('L2');
    book.fold({ seq: 3, kind: 'approval.strictness.raised', principal: KP, keyId: 'kernel-key', payload: { repo: REPO, from: 'L0', to: 'L9' } });
    expect(book.level(REPO)).toBe('L3');
  });
});

describe('#strictness-levels: the run-mode seam', () => {
  it('the level is the ceiling: L2 refuses auto-edits, L3 makes the effective mode manual; a repo mode tightening runs the brake', async () => {
    const r = rig();
    const dir = path.resolve('/tmp', 'proj-seam');
    const key = repoKeyOf([dir]);
    expect(r.modes.status()).toMatchObject({ strictness: { built: true } });
    await r.control.request(ASK_GUI, { repo: key, to: 'L2' });
    expect(r.modes.repoView(key)).toMatchObject({ level: 'L2', ceiling: 'ask' });
    const e = await errOf(r.modes.request(ASK_GUI, { repo: dir, to: 'auto-edits' }));
    expect(e.refusal).toMatchObject({ code: 'FORBIDDEN', data: { reason: 'strictness-mode' } });
    await r.control.request(ASK_GUI, { repo: key, to: 'L3' });
    expect(r.modes.repoView(key).effective).toBe('manual');
    await r.modes.request(ASK_GUI, { repo: dir, to: 'manual' });
    expect(r.brakes.filter((b) => b.via === 'mode')).toEqual([{ repo: key, to: 'manual', via: 'mode' }]);
  });
});

describe('#strictness-cli: local usage checks (nothing is sent)', () => {
  it('a bad verb, a bad level or a missing repo is refused with exit 64; --help prints the usage', async () => {
    const out: string[] = [];
    const io = { stdout: { write: (t: string) => void out.push(t) }, stderr: { write: (t: string) => void out.push(t) } } as never;
    for (const argv of [[], ['raise'], ['set', 'L2'], ['set', '.', 'L5'], ['show', 'a', 'b'], ['set', '.', 'L1', '--bogus']]) {
      expect(await runStrictnessCommand(argv, io, path.resolve('/tmp')), argv.join(' ')).toBe(STRICTNESS_EXIT_USAGE);
    }
    expect(await runStrictnessCommand(['--help'], io)).toBe(STRICTNESS_EXIT_OK);
    expect(out.join('')).toContain('gnomon strictness set <repo> <L0|L1|L2|L3>');
  });
});
