// @gnomon-platform: darwin
/**
 * #voice-origin (TD-2026-10-23-939, superseding TD-2026-10-21-514's edits-ask-first clamp; spec §14.7 "Voice
 * submodes"): a voice-sent turn gets EXACTLY a typed turn's permissions. G-VOX-17 (live session, the fake claude under
 * the real session profile): on auto-edits a voice turn raises no card for what the mode allows; on ask, an Always
 * rule saved from a voice turn's card answers the next voice turn. G-VOX-18: the supervisor has no voice override left
 * and still stamps the origin. G-VOX-19: voice still never approves a card.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { originOf, RefusedError } from '@a-company/gnomon-contracts';
import { RunModeControl } from '../src/kernel/broker/index.js';
import { BudgetFuse } from '../src/kernel/budget/fuse.js';
import { DaemonChildren } from '../src/kernel/lifecycle/children.js';
import { processControlFor } from '../src/kernel/lifecycle/process-control.js';
import { SoftwareEd25519Signer } from '../src/kernel/log/signer.js';
import { darwinFloor } from '../src/kernel/sandbox/session.js';
import { createSessionPort } from '../src/kernel/supervisor/port.js';
import { repoKeyOf } from '../src/kernel/supervisor/repo-hooks.js';
import { RuleBook } from '../src/kernel/supervisor/rules.js';
import { SessionSupervisor } from '../src/kernel/supervisor/supervisor.js';
import { pieceGuidance, VoicePieceCounter } from '../src/kernel/supervisor/voice-origin.js';
import { sessionWorld, setMode, trace, waitFor, type SessionWorld } from './session-helpers.js';
import { ASK_GUI, controlRig, HSID_A, HUMAN, KP } from './run-mode-helpers.js';
import { PKG_ROOT } from './helpers.js';

const SANDBOX_OK = darwinFloor().ok;

let w: SessionWorld;
const live: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  for (const f of live.splice(0)) await f().catch(() => undefined);
  w?.cleanup();
});

/** A live session over a REAL broker, the run-mode control and a REAL RuleBook (the daemon's #always-rules fold). */
function voiceRig() {
  w = sessionWorld();
  const r = controlRig();
  const book = r.book;
  const rules = new RuleBook({ principal: KP, isKernelKey: (k) => k === 'kernel-key' });
  const log = async (kind: string, payload: Record<string, unknown>, ids?: Record<string, unknown>): Promise<void> => {
    r.rows.push({ kind, payload, ...(ids ? { ids } : {}) });
    book.fold({ seq: r.rows.length, kind, principal: KP, keyId: 'kernel-key', payload: structuredClone(payload) });
  };
  const kernel = SoftwareEd25519Signer.generate('kernel');
  const fuse = new BudgetFuse({ kernel, logId: 'log:01HZZZZZZZZZZZZZZZZZZZZZZZ', log, billing: { env: () => ({}), layers: () => [] } });
  const children = new DaemonChildren({ append: log, control: processControlFor('darwin'), boot: 'boot-test', graceMs: 500 });
  // eslint-disable-next-line prefer-const
  let control: RunModeControl;
  let folded = 0;
  const syncRules = (): RuleBook => {
    // every row not yet folded, as the daemon's chain reader does (the broker logs through controlRig's own log, into r.rows)
    for (; folded < r.rows.length; folded++) {
      const x = r.rows[folded]!;
      rules.fold({ seq: folded + 1, kind: x.kind, principal: KP, keyId: 'kernel-key', payload: structuredClone(x.payload) });
    }
    return rules;
  };
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
    alwaysRule: (repoKey, tool, hash, input, ctx) => syncRules().match(repoKey, tool, hash, input, ctx),
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
  const openSession = async () => (await port.open({ principal: HUMAN, principalClass: 'human', connId: 'conn:gui', credential: 'gui' }, { cwd: w.cwd, attended: true })) as { hsid: string };
  return { ...r, sup, control, port, answers, pending, openSession, rules: syncRules, repo: repoKeyOf([w.cwd]) };
}

const req = (id: string | undefined, tool: string, input: Record<string, unknown>) => ({ request: { ...(id ? { id } : {}), tool, input } });
const VOICE_LINE = /Asked during a (voice-sent turn|turn holding words from a voice)/;

describe.skipIf(!SANDBOX_OK)('G-VOX-17 a voice-sent turn on auto-edits runs like a typed one', () => {
  for (const sentBy of ['word', 'unverified', 'piece'] as const) {
    it(`sentBy ${sentBy}: the in-root Write and the read-only Bash pass with no card; the turn is still stamped`, async () => {
      const r = voiceRig();
      await r.control.request(ASK_GUI, { repo: r.repo, to: 'auto-edits' }).then((o) => r.approve((o as { cardId: string }).cardId, 'allow'));
      setMode(w, { permissionAsk: { steps: [req('e1', 'Write', { file_path: path.join(w.cwd, 'e.txt'), content: 'e' }), req('ro', 'Bash', { command: 'ls -la', description: 'look' })], hold: false } });
      const s = await r.openSession();
      await r.sup.send(HUMAN, { hsid: s.hsid, text: 'make the change', voiceOrigin: { sentBy } });
      expect(await waitFor(() => r.answers().some((a) => a.id === 'e1') && r.answers().some((a) => a.id === 'ro'), 10_000)).toBe(true);
      expect(r.kinds('turn.sent').at(-1)).toMatchObject({ origin: originOf(sentBy), sentBy });
      expect(r.answers().find((a) => a.id === 'e1')).toMatchObject({ behavior: 'allow' });
      expect(r.answers().find((a) => a.id === 'ro')).toMatchObject({ behavior: 'allow' });
      expect(r.kinds('approval.auto').map((a) => a.modeRef).sort()).toEqual(['mode:auto-edits', 'mode:auto-edits:read-only']);
      expect(r.pending()).toHaveLength(0);
      expect(r.broker.cards().filter((c) => c.kind === 'permission')).toHaveLength(0); // no card at all
      expect(r.rows.some((x) => x.kind === 'session.inject' && 'clamp' in x.payload)).toBe(false);
      expect(await waitFor(() => fs.existsSync(path.join(w.cwd, 'e.txt')))).toBe(true);
    }, 40_000);
  }

  it('a Bash call auto-edits does NOT allow still cards, exactly as in a typed turn, with no voice line', async () => {
    const r = voiceRig();
    await r.control.request(ASK_GUI, { repo: r.repo, to: 'auto-edits' }).then((o) => r.approve((o as { cardId: string }).cardId, 'allow'));
    setMode(w, { permissionAsk: { steps: [req('b1', 'Bash', { command: 'paradigm lore record --type decision --title x' })], hold: true } });
    const s = await r.openSession();
    await r.sup.send(HUMAN, { hsid: s.hsid, text: 'record it', voiceOrigin: { sentBy: 'word' } });
    expect(await waitFor(() => r.pending().length === 1, 10_000)).toBe(true);
    const c = r.pending()[0]!;
    expect(JSON.stringify(c.block)).not.toMatch(VOICE_LINE);
    // the logged request carries no voice origin on the card (no detail.origin 'voice', no sentBy)
    const logged = JSON.stringify(r.rows.filter((x) => x.kind.startsWith('approval.') && JSON.stringify(x.payload).includes(c.cardId)));
    expect(logged).toContain(c.cardId);
    expect(logged).not.toMatch(/"origin":"voice|"sentBy"/);
    await r.approve(c.cardId, 'deny');
  }, 40_000);
});

describe.skipIf(!SANDBOX_OK)('G-VOX-17 ask: an Always rule saved from a voice turn card applies to the next voice turn', () => {
  it('Write and Bash card on the first voice turn; Always on both; the next voice turn passes both by rule:<cardId>', async () => {
    const r = voiceRig();
    expect(r.control.view(null as never, r.repo).effective).toBe('ask');
    const cmd = 'paradigm lore record --type decision --title x';
    setMode(w, { permissionAsk: { steps: [req(undefined, 'Write', { file_path: path.join(w.cwd, 'a.txt'), content: 'a' }), req(undefined, 'Bash', { command: cmd, description: 'record' })], hold: false } });
    const s = await r.openSession();
    await r.sup.send(HUMAN, { hsid: s.hsid, text: 'first', voiceOrigin: { sentBy: 'word' } });
    expect(await waitFor(() => r.pending().length === 2, 10_000)).toBe(true);
    const cards = r.pending();
    for (const c of cards) expect(JSON.stringify(c.block)).not.toMatch(VOICE_LINE);
    for (const c of cards) await r.approve(c.cardId, 'always');
    expect(await waitFor(() => r.kinds('turn.result').length >= 1, 10_000)).toBe(true);
    expect(r.kinds('approval.rule.learned')).toHaveLength(2);
    expect(r.rules().list().map((x) => x.ruleId).sort()).toEqual(cards.map((c) => c.cardId).sort());
    // the next VOICE turn (a different sentBy, too): the same Write and Bash pass by the saved rules, no card
    await r.sup.send(HUMAN, { hsid: s.hsid, text: 'again', voiceOrigin: { sentBy: 'unverified' } });
    expect(await waitFor(() => r.kinds('approval.auto').length >= 2, 10_000)).toBe(true);
    expect(r.kinds('approval.auto').map((a) => a.modeRef).sort()).toEqual(cards.map((c) => `rule:${c.cardId}`).sort());
    expect(r.pending()).toHaveLength(0);
  }, 40_000);
});

describe('G-VOX-17 (pure): the piece counter and the piece note', () => {
  it('pieces are numbered from the last non-piece turn', () => {
    const b = new VoicePieceCounter();
    expect(b.nextPiece()).toBe(1);
    b.sent('piece');
    b.sent('piece');
    expect(b.nextPiece()).toBe(3);
    b.sent(null);
    expect(b.nextPiece()).toBe(1);
    b.sent('piece');
    b.sent('word');
    expect(b.nextPiece()).toBe(1);
    expect(pieceGuidance(2)).toMatch(/^Voice piece 2 of an ongoing thought/);
  });
});

describe('G-VOX-18: no voice override is left in the supervisor; the origin is still stamped', () => {
  const src = fs.readFileSync(path.join(PKG_ROOT, 'src', 'kernel', 'supervisor', 'supervisor.ts'), 'utf8');
  it('mayAuto consults only the loop clamp; no card is rewritten for a voice turn and no answer carries clamp', () => {
    expect(src).toContain('const mayAuto = (modeRef: string): boolean => (loopBy !== null ? loopClampAllows(modeRef, loopBy.trustCard) : true);');
    expect(src).not.toMatch(/clampAllows\(|withVoiceOrigin|VoiceClampBook|voiceClamp|clamp: 'voice'|!voice-clamp-applied/);
    expect(fs.existsSync(path.join(PKG_ROOT, 'src', 'kernel', 'supervisor', 'voice-clamp.ts'))).toBe(false);
  });
  it("the turn.sent origin is stamped from sentBy: 'unverified' is voice-unverified, never hand", () => {
    expect(src).toContain("origin: sentBy === 'unverified' ? 'voice-unverified' : sentBy !== null ? 'voice' : 'hand'");
    expect(originOf('unverified')).toBe('voice-unverified');
    expect(originOf('word')).toBe('voice');
    expect(originOf('key')).toBe('hand');
  });
  it('every b.auto call in the supervisor still sits behind a mayAuto gate (the loop clamp needs it)', () => {
    const autos = src.split('await b.auto(').length - 1;
    const gates = [...src.matchAll(/^\s+if \(.*mayAuto\(/gm)].length;
    expect(autos).toBe(4); // mode, read-only, rule, and #kernel-mcp's kernel-verb pass (T-2026-10-23-002)
    expect(gates).toBe(4);
  });
});

describe('G-VOX-19 #approval-broker: voice never approves a card, whatever turn raised it', () => {
  const errOf = async (p: Promise<unknown>): Promise<Record<string, unknown>> => {
    try {
      await p;
    } catch (e) {
      if (e instanceof RefusedError) return { code: e.refusal.code, gate: e.refusal.gate, ...(e.refusal.data as Record<string, unknown>) };
      throw e;
    }
    throw new Error('expected a refusal');
  };
  it('the voice principal and the voice intent form are refused voice-off (allow, always and deny); by hand it decides', async () => {
    const r = controlRig();
    const c1 = await r.broker.raise({ kind: 'permission', requestedBy: 'p:abcdefgh/session-1', hsid: HSID_A, attended: true, detail: { tool: 'Edit' }, lines: ['Edit a.ts'], decisions: ['allow', 'deny', 'always'] } as never);
    const GUI = { principal: HUMAN, principalClass: 'human', connId: 'conn:gui', credential: 'gui' };
    const VOICE = { ...GUI, principalClass: 'voice', principal: 'p:abcdefgh/voice' };
    for (const decision of ['allow', 'always', 'deny']) {
      expect(await errOf(r.broker.approve(VOICE as never, { cardId: c1.cardId, decision } as never))).toMatchObject({ code: 'FORBIDDEN', gate: 'voice', reason: 'voice-off' });
      expect(await errOf(r.broker.approve(GUI as never, { cardId: c1.cardId, decision, voice: {} } as never))).toMatchObject({ code: 'FORBIDDEN', gate: 'voice', reason: 'voice-off' });
    }
    expect(r.broker.card(c1.cardId)?.state).toBe('pending');
    await r.approve(c1.cardId, 'allow', GUI);
    expect(r.broker.card(c1.cardId)?.state).not.toBe('pending');
  });
});
