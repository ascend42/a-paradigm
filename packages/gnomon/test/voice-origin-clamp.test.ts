// @gnomon-platform: darwin
/**
 * ^voice-origin-clamp (TD-2026-10-21-514, spec §14.7 "Voice submodes"): G-VOX-17 (live session, the fake claude under
 * the real session profile), G-VOX-18 (every approval.auto modeRef is enumerated and asserted clamped, default deny)
 * and G-VOX-19 (#approval-broker: approving an origin-voice card by voice without readback + confirm is refused).
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { RefusedError } from '@a-company/gnomon-contracts';
import { RunModeControl } from '../src/kernel/broker/index.js';
import { voiceOriginConfirmRefusal } from '../src/kernel/broker/broker.js';
import { BudgetFuse } from '../src/kernel/budget/fuse.js';
import { DaemonChildren } from '../src/kernel/lifecycle/children.js';
import { processControlFor } from '../src/kernel/lifecycle/process-control.js';
import { SoftwareEd25519Signer } from '../src/kernel/log/signer.js';
import { darwinFloor } from '../src/kernel/sandbox/session.js';
import { createSessionPort } from '../src/kernel/supervisor/port.js';
import { repoKeyOf } from '../src/kernel/supervisor/repo-hooks.js';
import { SessionSupervisor } from '../src/kernel/supervisor/supervisor.js';
import { READ_ONLY_ASK_MODE_REF, READ_ONLY_MODE_REF } from '../src/kernel/supervisor/auto-edits.js';
import { CLAMP_ADMITS, clampAllows, pieceGuidance, VoiceClampBook, voiceClampLine, withVoiceOrigin } from '../src/kernel/supervisor/voice-clamp.js';
import { sessionWorld, setMode, trace, waitFor, type SessionWorld } from './session-helpers.js';
import { ASK_GUI, controlRig, HSID_A, HUMAN, KP } from './run-mode-helpers.js';
import { PKG_ROOT } from './helpers.js';

const SANDBOX_OK = darwinFloor().ok;
const SHA = `sha256:${'a'.repeat(64)}`;

let w: SessionWorld;
const live: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  for (const f of live.splice(0)) await f().catch(() => undefined);
  w?.cleanup();
});

function clampRig() {
  w = sessionWorld();
  const r = controlRig();
  const book = r.book;
  const log = async (kind: string, payload: Record<string, unknown>, ids?: Record<string, unknown>): Promise<void> => {
    r.rows.push({ kind, payload, ...(ids ? { ids } : {}) });
    book.fold({ seq: r.rows.length, kind, principal: KP, keyId: 'kernel-key', payload: structuredClone(payload) });
  };
  const kernel = SoftwareEd25519Signer.generate('kernel');
  const fuse = new BudgetFuse({ kernel, logId: 'log:01HZZZZZZZZZZZZZZZZZZZZZZZ', log, billing: { env: () => ({}), layers: () => [] } });
  const children = new DaemonChildren({ append: log, control: processControlFor('darwin'), boot: 'boot-test', graceMs: 500 });
  // eslint-disable-next-line prefer-const
  let control: RunModeControl;
  const sup: SessionSupervisor = new SessionSupervisor({
    log,
    children,
    fuse,
    broker: r.broker,
    home: w.home,
    userHome: w.userHome,
    kernelPrincipal: KP,
    sock: path.join(w.home, 'gnomon.sock'),
    claudePath: w.claude,
    env: () => ({ HOME: w.userHome, PATH: '/usr/bin:/bin' }),
    platform: 'darwin',
    watchMs: 10_000,
    allowScripts: true,
    runMode: (hsid, repoKey) => control.view(hsid, repoKey),
    // an exact rule (the WebFetch) and a prefix rule (`npm test …`), as #always-rules would derive them
    alwaysRule: (_repo, tool, _h, input) => {
      const i = input as Record<string, unknown>;
      if (tool === 'WebFetch' && i.url === 'https://example.com/r') return { ruleId: 'card:01HZZZZZZZZZZZZZZZZZZZEXACT' };
      if (tool === 'Bash' && typeof i.command === 'string' && i.command.startsWith('npm test')) return { ruleId: 'card:01HZZZZZZZZZZZZZZZZZZPREFIX' };
      return null;
    },
  });
  control = new RunModeControl({
    broker: r.broker,
    book: () => book,
    sessions: { scope: (h) => sup.scopeOf(h), live: () => sup.liveScopes() },
    logRequest: (payload, ids) => log('request.mode.set', { ...payload }, ids),
    repoKeyOfPath: (abs) => repoKeyOf([abs]),
    userHome: w.userHome,
    onChange: () => sup.noteModeChange(),
  });
  const port = createSessionPort(sup, control);
  live.push(() => children.stopAll('test-end'));
  const answers = () => trace(w).filter((t) => t.t === 'perm-answer');
  const pending = () => r.broker.cards().filter((c) => c.state === 'pending');
  return { ...r, sup, control, port, answers, pending, repo: repoKeyOf([w.cwd]) };
}

describe.skipIf(!SANDBOX_OK)('G-VOX-17 the voice-origin clamp in a live session (auto-edits)', () => {
  it('a voice-origin turn: the in-root Edit and both always rules card, read-only Bash passes; after turn.result the Edit auto-passes again', async () => {
    const r = clampRig();
    await r.control.request(ASK_GUI, { repo: r.repo, to: 'auto-edits' }).then((o) => r.approve((o as { cardId: string }).cardId, 'allow'));
    const req = (id: string, tool: string, input: Record<string, unknown>) => ({ request: { id, tool, input } });
    setMode(w, {
      permissionAsk: {
        steps: [
          req('e1', 'Write', { file_path: path.join(w.cwd, 'e.txt'), content: 'e' }),
          req('ro', 'Bash', { command: 'ls -la', description: 'look' }),
          req('rx', 'WebFetch', { url: 'https://example.com/r', prompt: 'read' }),
          req('rp', 'Bash', { command: 'npm test -- --watch=false' }),
        ],
        hold: false,
      },
    });
    const s = (await r.port.open({ principal: HUMAN, principalClass: 'human', connId: 'conn:gui', credential: 'gui' }, { cwd: w.cwd, attended: true })) as { hsid: string };
    await r.sup.send(HUMAN, { hsid: s.hsid, text: 'make the change', voiceOrigin: { sentBy: 'word' } });
    expect(await waitFor(() => r.answers().some((a) => a.id === 'ro') && r.pending().length >= 3, 10_000)).toBe(true);
    // the turn is stamped: origin voice, sentBy word
    expect(r.kinds('turn.sent').at(-1)).toMatchObject({ origin: 'voice', sentBy: 'word' });
    expect(r.answers().find((a) => a.id === 'ro')).toMatchObject({ behavior: 'allow' });
    expect(r.kinds('approval.auto').map((a) => a.modeRef)).toEqual(['mode:auto-edits:read-only']);
    const cards = r.pending();
    expect(cards).toHaveLength(3);
    for (const c of cards) {
      const raised = r.rows.find((x) => x.kind === 'approval.raise' && x.payload.cardId === c.cardId);
      expect(JSON.stringify(c.block)).toContain('Asked during a voice-sent turn (sent by send word). Check this was you.');
      if (raised) expect(raised.payload).toBeDefined();
    }
    expect(r.broker.cards().filter((c) => c.state === 'pending').every((c) => r.broker.card(c.cardId) !== undefined)).toBe(true);
    // deny all three: the turn ends, its result closes the clamp
    for (const c of cards) await r.approve(c.cardId, 'deny');
    expect(await waitFor(() => r.kinds('turn.result').length >= 1, 10_000)).toBe(true);
    const clampedAnswers = r.rows.filter((x) => x.kind === 'session.inject' && x.payload.channel === 'permission' && x.payload.clamp === 'voice');
    expect(clampedAnswers).toHaveLength(3); // !voice-clamp-applied on every clamped answer
    // a hand turn after the result: the Edit and both rules auto-pass again
    await r.sup.send(HUMAN, { hsid: s.hsid, text: 'again' });
    expect(r.kinds('turn.sent').at(-1)).toMatchObject({ origin: 'hand' });
    expect(r.kinds('turn.sent').at(-1)).not.toHaveProperty('sentBy');
    expect(await waitFor(() => r.kinds('approval.auto').length >= 5, 10_000)).toBe(true);
    expect(r.kinds('approval.auto').slice(1).map((a) => a.modeRef).sort()).toEqual(['mode:auto-edits', 'mode:auto-edits:read-only', 'rule:card:01HZZZZZZZZZZZZZZZZZZPREFIX', 'rule:card:01HZZZZZZZZZZZZZZZZZZZEXACT'].sort());
    expect(r.pending()).toHaveLength(0);
    expect(await waitFor(() => fs.existsSync(path.join(w.cwd, 'e.txt')))).toBe(true);
  }, 40_000);
});

describe.skipIf(!SANDBOX_OK)('Aegis M-3 live fold (fake claude foldPairs): a voice turn folded behind a hand turn', () => {
  it('is clamped while it runs inside the hand turn, and closes only with the shared result after its replay', async () => {
    const r = clampRig();
    await r.control.request(ASK_GUI, { repo: r.repo, to: 'auto-edits' }).then((o) => r.approve((o as { cardId: string }).cardId, 'allow'));
    const req = (id: string, tool: string, input: Record<string, unknown>) => ({ request: { id, tool, input } });
    // foldPairs: message 1 is replayed and held; message 2 is replayed mid-turn and ONE result answers both
    setMode(w, { foldPairs: true, permissionAsk: { steps: [req('f1', 'Write', { file_path: path.join(w.cwd, 'f.txt'), content: 'f' })], hold: false } });
    const s = (await r.port.open({ principal: HUMAN, principalClass: 'human', connId: 'conn:gui', credential: 'gui' }, { cwd: w.cwd, attended: true })) as { hsid: string };
    await r.sup.send(HUMAN, { hsid: s.hsid, text: 'hand first' });
    await r.sup.send(HUMAN, { hsid: s.hsid, text: 'then voice', voiceOrigin: { sentBy: 'word' } });
    // the folded voice turn's Write is clamped (a card), though the oldest outstanding turn is the hand one
    const ok = await waitFor(() => r.pending().length >= 1, 10_000);
    if (!ok) throw new Error(JSON.stringify(r.rows.map((x) => [x.kind, x.payload.answer ?? x.payload.modeRef ?? x.payload.origin ?? ''])) + JSON.stringify(trace(w).slice(-12)));
    expect(JSON.stringify(r.pending()[0]!.block)).toContain('Asked during a voice-sent turn');
    expect(r.kinds('approval.auto').map((a) => a.modeRef)).not.toContain('mode:auto-edits');
    await r.approve(r.pending()[0]!.cardId, 'deny');
    expect(await waitFor(() => r.kinds('turn.result').length >= 1, 10_000)).toBe(true);
    // the shared result closed both (both replays were seen first): the next hand turn's Write auto-passes
    // (the fake reads its mode once: message 3 is held, message 4 runs the same Write again, now in a hand pair)
    await r.sup.send(HUMAN, { hsid: s.hsid, text: 'after' });
    await r.sup.send(HUMAN, { hsid: s.hsid, text: 'after, again' });
    expect(await waitFor(() => r.kinds('approval.auto').some((a) => a.modeRef === 'mode:auto-edits'), 10_000)).toBe(true);
  }, 40_000);
});

describe('G-VOX-17 (pure): the clamp book', () => {
  it('opens on a voice turn, closes only with the result that closes that turn; a turn that never closes stays clamped', () => {
    const b = new VoiceClampBook();
    b.sent('t1', null);
    expect(b.active()).toBeNull();
    b.sent('t2', 'word');
    b.sent('t3', null);
    expect(b.active()).toBe('word');
    b.closed(['t1']);
    expect(b.active()).toBe('word'); // an earlier hand turn's result does not end the clamp
    b.replayed('t2');
    b.closed(['t2', 't3']);
    expect(b.active()).toBeNull();
    b.sent('t4', 'piece');
    expect(b.active()).toBe('piece'); // never closed ⇒ clamped until the session (and the book) ends
  });
  it('Aegis M-3 fold: a voice turn folded behind a hand turn closes only after ITS replay and a later result', () => {
    const b = new VoiceClampBook();
    b.sent('h1', null); // a hand turn running
    b.sent('v2', 'word'); // a voice turn queued behind it
    b.closed(['h1', 'v2']); // one result names both, but v2 was never consumed: stays clamped
    expect(b.active()).toBe('word');
    b.replayed('v2');
    b.closed(['v2']); // the result after its replay closes it
    expect(b.active()).toBeNull();
    b.replayed('nope'); // a replay of an unknown turn is ignored
    expect(b.outstanding()).toEqual([]);
  });

  it('the card names the voice origin and the kernel-composed line', () => {
    const plan = { detail: { tool: 'Edit' }, lines: ['Edit a.ts'], block: {} };
    const shown = withVoiceOrigin(plan, 'piece');
    expect(shown.detail).toEqual({ tool: 'Edit', origin: 'voice', sentBy: 'piece' });
    expect(shown.lines[0]).toBe('Asked during a voice-sent turn (sent as a piece). Check this was you.');
    expect(voiceClampLine('word')).toBe('Asked during a voice-sent turn (sent by send word). Check this was you.');
    expect(plan.lines).toEqual(['Edit a.ts']); // the plan itself is not mutated
  });
  it('pieces are numbered from the last non-piece turn', () => {
    const b = new VoiceClampBook();
    expect(b.nextPiece()).toBe(1);
    b.sent('a', 'piece');
    b.sent('b', 'piece');
    expect(b.nextPiece()).toBe(3);
    b.sent('c', null);
    expect(b.nextPiece()).toBe(1);
    expect(pieceGuidance(2)).toMatch(/^Voice piece 2 of an ongoing thought/);
  });
});

describe('G-VOX-18: every approval.auto modeRef is enumerated and clamped unless read-only (default deny)', () => {
  const src = fs.readFileSync(path.join(PKG_ROOT, 'src', 'kernel', 'supervisor', 'supervisor.ts'), 'utf8');
  it('the modeRefs the supervisor writes are exactly the auto-edits pass, the two read-only refs and rule:<id>', () => {
    const literal = [...src.matchAll(/modeRef: '([^']+)'/g)].map((m) => m[1]!);
    const templated = [...src.matchAll(/modeRef: `([a-z:-]+)\$\{/g)].map((m) => m[1]!);
    const named = [...src.matchAll(/modeRef: ([A-Za-z_]+)[ ,}]/g)].map((m) => m[1]!);
    expect(new Set(literal)).toEqual(new Set(['mode:auto-edits']));
    expect(new Set(templated)).toEqual(new Set(['rule:']));
    expect(new Set(named)).toEqual(new Set(['roRef']));
    const all = ['mode:auto-edits', 'rule:card:01HZZZZZZZZZZZZZZZZZZZZZZZZ', READ_ONLY_MODE_REF, READ_ONLY_ASK_MODE_REF];
    for (const ref of all) expect(clampAllows(ref)).toBe(ref.endsWith(':read-only'));
  });
  it('a modeRef added later is clamped by default', () => {
    for (const ref of ['mode:future', 'standing:x', 'rule:', '', 'mode:auto-edits:read-only-ish', 'mode:read-only']) expect(clampAllows(ref)).toBe(false);
    expect([...CLAMP_ADMITS].sort()).toEqual([READ_ONLY_ASK_MODE_REF, READ_ONLY_MODE_REF].sort());
  });
  it('every b.auto call in the supervisor sits behind a mayAuto gate', () => {
    const autos = src.split('await b.auto(').length - 1;
    const gates = [...src.matchAll(/^\s+if \(.*mayAuto\(/gm)].length;
    expect(autos).toBe(3);
    expect(gates).toBe(3);
  });
});

describe('G-VOX-19 #approval-broker: an origin-voice card approved by voice needs readback + confirm', () => {
  const errOf = async (p: Promise<unknown>): Promise<Record<string, unknown>> => {
    try {
      await p;
    } catch (e) {
      if (e instanceof RefusedError) return { code: e.refusal.code, gate: e.refusal.gate, ...(e.refusal.data as Record<string, unknown>) };
      throw e;
    }
    throw new Error('expected a refusal');
  };
  it('the pure rule: approving decisions only, both hashes required, deny unchanged', () => {
    expect(voiceOriginConfirmRefusal({ origin: 'voice' }, 'allow', {})?.refusal.data).toMatchObject({ reason: 'voice-readback-missing', cause: 'voice-origin-confirm' });
    expect(voiceOriginConfirmRefusal({ origin: 'voice' }, 'allow', { readbackHash: SHA })).not.toBeNull();
    expect(voiceOriginConfirmRefusal({ origin: 'voice' }, 'allow', { readbackHash: SHA, confirmHash: SHA })).toBeNull();
    expect(voiceOriginConfirmRefusal({ origin: 'voice' }, 'deny', {})).toBeNull();
    expect(voiceOriginConfirmRefusal({ origin: 'hand' }, 'allow', {})).toBeNull();
    expect(voiceOriginConfirmRefusal(null, 'allow', {})).toBeNull();
  });
  it('through broker.approve: a voice approve without readback is refused; a hand approve is not', async () => {
    const r = controlRig();
    const raise = () => r.broker.raise({ kind: 'permission', requestedBy: 'p:abcdefgh/session-1', hsid: HSID_A, attended: true, detail: { tool: 'Edit', origin: 'voice', sentBy: 'word' }, lines: [voiceClampLine('word'), 'Edit a.ts'], decisions: ['allow', 'deny'] } as never);
    const c1 = await raise();
    const GUI = { principal: HUMAN, principalClass: 'human', connId: 'conn:gui', credential: 'gui' };
    expect(await errOf(r.broker.approve(GUI as never, { cardId: c1.cardId, decision: 'allow', voice: {} } as never))).toMatchObject({ code: 'FORBIDDEN', gate: 'voice', reason: 'voice-readback-missing', cause: 'voice-origin-confirm' });
    expect(await errOf(r.broker.approve({ ...GUI, principalClass: 'voice', principal: 'p:abcdefgh/voice' } as never, { cardId: c1.cardId, decision: 'allow' } as never))).toMatchObject({ reason: 'voice-readback-missing' });
    // deny by voice is unchanged (voice approvals are off: voice-off)
    expect(await errOf(r.broker.approve(GUI as never, { cardId: c1.cardId, decision: 'deny', voice: {} } as never))).toMatchObject({ reason: 'voice-off' });
    // by hand it decides as always
    await r.approve(c1.cardId, 'allow', GUI);
    expect(r.broker.card(c1.cardId)?.state).not.toBe('pending');
  });
});
