/**
 * #loop-land orchestration units, every platform (build plan step 11, LP6b). The git mechanics are replaced through
 * the lander's `land` seam (the real ones are test/loop-land-git.test.ts and the end to end in loop-act-e2e).
 *
 *   gate         an approved land needs the loop trusted at the run's hash; an auto land also needs it runnable, not
 *                held by the kill switch, and strictness still letting it land alone (else the propose card)
 *   wait/park    a waitable refusal writes ONE loop.land.waiting per reason and retries; after land.maxWaitMin it
 *                parks (max-wait) with a toast; a structural refusal parks at once; L3 waits (held)
 *   G-LOOP-15    loop.landed is written inside the land, before the ref moves; an undone land is marked undone
 *   fold         only kernel-signed loop.landed rows name a loop's commit (a forged row is ignored)
 *   D3           the commit message: trailer-shaped lines stripped, the kernel's trailers last, values one ASCII line
 */
import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { indexTrailerOk, landMessage, trailerValue, type LandCommitInput, type LandResult } from '../src/kernel/git/land.js';
import { LoopLander, type LandJob } from '../src/kernel/loops/land.js';
import { effectiveAutonomy, landDecision, type RepoCap } from '../src/kernel/loops/strictness-cap.js';
import { landHazards, proposeReasons } from '../src/kernel/loops/propose.js';
import { AUTO_LAND_LATER, LOOP_AUTO_LAND } from '../src/kernel/loops/runner.js';
import { gateClassPathRule } from '../src/kernel/manifest/layers.js';
import { humanBusyIn } from '../src/kernel/loops/wire.js';

const K = 'p:abcdefgh/kernel';
const HASH = `sha256:${'c'.repeat(64)}`;
const SHA = 'a'.repeat(40);
const LAND = 'b'.repeat(40);

function job(extra: Partial<LandJob> = {}): LandJob {
  return {
    key: 'repo/rk/fixer', loopId: 'fixer', scope: 'repo', repoKey: 'rk', repo: '/r', runId: 'lr-1', parkRepo: '/home/loop-work/park/x.git',
    ref: 'refs/gnomon/loops/fixer/lr-1', parkedSha: SHA, baseSha: 'd'.repeat(40), headRef: 'refs/heads/main', contentHash: HASH,
    message: 'fix: x', maxWaitMin: 1, how: 'auto', notifyLanded: true, ...extra,
  };
}

function rig(o: { results?: LandResult[]; cap?: RepoCap; trusted?: string | null; held?: boolean; canRun?: boolean } = {}) {
  const rows: Array<{ kind: string; payload: Record<string, unknown> }> = [];
  const toasts: string[] = [];
  const proposed: string[] = [];
  const calls: LandCommitInput[] = [];
  let now = 1_000_000;
  const timers: Array<() => void> = [];
  const state = { cap: o.cap ?? { level: 'L0', mode: 'auto-edits' } as RepoCap, results: [...(o.results ?? [])] };
  const lander = new LoopLander({
    home: '/home', kernelPrincipal: K,
    append: async (kind, payload) => {
      rows.push({ kind, payload });
    },
    registry: {
      entry: () => ({ key: 'repo/rk/fixer', repoKey: 'rk', compiled: { autonomy: 'act' } }) as any,
      entries: () => [],
      canRun: () => (o.canRun === false ? { ok: false, reason: 'paused' } : { ok: true }) as any,
      trustOf: () => (o.trusted === null ? null : { contentHash: o.trusted ?? HASH, by: 'p:abcdefgh/matt', cardId: 'card:01HZZZZZZZZZZZZZZZZZZZZZZZ' }) as any,
      authoredBy: () => 'file' as any,
    },
    effective: (e) => effectiveAutonomy({ autonomy: (e.compiled as any)?.autonomy }, state.cap),
    isHeld: () => o.held === true,
    toast: (t) => toasts.push(t.text),
    propose: async (_j, reason) => {
      proposed.push(reason);
    },
    clock: () => now,
    timer: (fn) => {
      timers.push(fn);
      return () => undefined;
    },
    land: async (i) => {
      calls.push(i);
      const r = state.results.shift() ?? { landed: false, reason: 'dirty', detail: 'still dirty', waitable: true };
      if (r.landed || r.undone) await i.beforeLand({ sha: r.landed ? r.sha : r.sha!, paths: ['src/a.ts'], ref: i.headRef, baseSha: i.baseSha });
      return r;
    },
  });
  return { lander, rows, toasts, proposed, calls, timers, state, advance: (ms: number) => (now += ms), kinds: () => rows.map((r) => r.kind) };
}

const landed = (): LandResult => ({ landed: true, sha: LAND, parkedSha: SHA, baseSha: 'd'.repeat(40), ref: 'refs/heads/main', paths: ['src/a.ts'] });

describe('#loop-land: landing, waiting and parking', () => {
  it('a land writes loop.landed inside the land (before the ref moves), then toasts; the trailers name the trust card', async () => {
    const r = rig({ results: [landed()] });
    expect(await r.lander.request(job())).toEqual({ landed: true, sha: LAND });
    // Aegis M4: the intent row inside the land, the done row after it (the boot reconcile pairs them)
    expect(r.kinds()).toEqual(['loop.landed', 'loop.landed', 'loop.notified']);
    expect(r.rows[0]!.payload).toMatchObject({ loopId: 'fixer', runId: 'lr-1', sha: LAND, parkedSha: SHA, ref: 'refs/heads/main', paths: ['src/a.ts'], how: 'auto', phase: 'intent' });
    expect(r.rows[1]!.payload).toMatchObject({ sha: LAND, phase: 'done' });
    expect(r.calls[0]!.recoverDir).toBe('/home/loop-work/recovered');
    expect(r.calls[0]!.trailers).toEqual({ onBehalfOf: 'p:abcdefgh/matt', trustedBy: 'card:01HZZZZZZZZZZZZZZZZZZZZZZZ', loop: 'fixer@cccccccc', authoredBy: 'file' });
    expect(r.toasts).toEqual(['fixer: landed bbbbbbbbbbbb on main (1 file)']);
    expect(r.lander.landedBy(LAND)).toEqual({ loopId: 'fixer', runId: 'lr-1' });
    expect(r.lander.waiting()).toEqual([]);
  });

  it('a waitable refusal writes one waiting row per reason, retries, and parks max-wait after land.maxWaitMin', async () => {
    const r = rig();
    expect(await r.lander.request(job())).toMatchObject({ landed: false, state: 'waiting', reason: 'dirty' });
    await r.lander.nudge();
    r.state.results.push({ landed: false, reason: 'human-turn', detail: 'a turn', waitable: true });
    await r.lander.nudge('rk');
    expect(r.rows.map((x) => `${x.kind}:${x.payload.reason}`)).toEqual(['loop.land.waiting:dirty', 'loop.land.waiting:human-turn']);
    expect(r.timers.length).toBeGreaterThan(0);
    r.advance(61_000);
    r.timers.at(-1)!();
    await new Promise((res) => setTimeout(res, 0));
    expect(r.rows.at(-2)).toMatchObject({ kind: 'loop.parked', payload: { reason: 'max-wait', ref: 'refs/gnomon/loops/fixer/lr-1', sha: SHA } });
    expect(r.toasts.at(-1)).toMatch(/^fixer: could not land \(waited 1 min/);
    expect(r.lander.waiting()).toEqual([]);
  });

  it('a structural refusal parks at once; an undone land (row written, then put back) is marked and parks', async () => {
    const r = rig({ results: [{ landed: false, reason: 'attributes', detail: 'src/a.ts has a .gitattributes entry', waitable: false }] });
    expect(await r.lander.request(job())).toMatchObject({ state: 'parked', reason: 'attributes' });
    expect(r.kinds()).toEqual(['loop.parked', 'loop.notified']);
    expect(r.rows[0]!.payload).toMatchObject({ reason: 'attributes', land: true });
    const u = rig({ results: [{ landed: false, reason: 'branch-moved', detail: 'compare-and-swap failed', waitable: false, undone: true, sha: LAND }] });
    expect(await u.lander.request(job())).toMatchObject({ state: 'parked', reason: 'branch-moved' });
    expect(u.kinds()).toEqual(['loop.landed', 'loop.land.waiting', 'loop.parked', 'loop.notified']);
    expect(u.rows[1]!.payload).toMatchObject({ undone: true, sha: LAND });
    expect(u.lander.landedBy(LAND)).toBeNull();
  });

  it('the gate: untrusted at the run\'s hash parks; L3 waits (held) then lands; a detached start never lands', async () => {
    const t = rig({ trusted: `sha256:${'e'.repeat(64)}` });
    expect(await t.lander.request(job({ how: 'approved', cardId: 'card:x' }))).toMatchObject({ state: 'parked', reason: 'held' });
    expect(t.calls).toEqual([]);
    const s = rig({ cap: { level: 'L3', mode: 'auto-edits' }, results: [landed()] });
    expect(await s.lander.request(job({ how: 'approved', cardId: 'card:x' }))).toMatchObject({ state: 'waiting', reason: 'held' });
    expect(s.calls).toEqual([]);
    s.state.cap = { level: 'L2', mode: 'ask' };
    await s.lander.nudge();
    expect(s.rows.find((x) => x.kind === 'loop.landed')!.payload).toMatchObject({ how: 'approved', cardId: 'card:x' });
    const d = rig();
    expect(await d.lander.request(job({ headRef: null }))).toMatchObject({ state: 'parked', reason: 'branch-moved' });
  });

  it('an auto land re-gated at L2 or for a gate-class path raises the propose card instead; the kill switch parks', async () => {
    const r = rig({ cap: { level: 'L2', mode: 'ask' } });
    expect(await r.lander.request(job())).toMatchObject({ state: 'proposed' });
    expect(r.proposed).toEqual(['act → propose (L2)']);
    const g = rig();
    expect(await g.lander.request(job({ gateClass: true }))).toMatchObject({ state: 'proposed' });
    expect(g.proposed).toEqual(['gate-class paths never land without a card']);
    const k = rig({ held: true });
    expect(await k.lander.request(job())).toMatchObject({ state: 'parked', reason: 'held' });
    expect(k.calls).toEqual([]);
    // an approved land is the human's decision: L2 and the kill switch do not stop it
    const a = rig({ cap: { level: 'L2', mode: 'ask' }, held: true, results: [landed()] });
    expect(await a.lander.request(job({ how: 'approved', cardId: 'card:x' }))).toEqual({ landed: true, sha: LAND });
  });

  it('only kernel-signed loop.landed rows fold (a forged row names nothing); merge.reverted marks it reverted', () => {
    const r = rig();
    r.lander.observe({ kind: 'loop.landed', principal: 'p:abcdefgh/agent', payload: { loopId: 'fixer', runId: 'lr-9', repoKey: 'rk', sha: LAND, ref: 'refs/heads/main' } });
    expect(r.lander.landedBy(LAND)).toBeNull();
    r.lander.observe({ kind: 'loop.landed', principal: K, payload: { loopId: 'fixer', runId: 'lr-9', repoKey: 'rk', sha: LAND, ref: 'refs/heads/main' } });
    expect(r.lander.landedBy(LAND)).toEqual({ loopId: 'fixer', runId: 'lr-9' });
    r.lander.observe({ kind: 'loop.land.waiting', principal: K, payload: { sha: LAND, undone: true } });
    expect(r.lander.landedBy(LAND)).toBeNull();
  });
});

describe('#loop-land: the kill switch and the restart (Aegis M3, M4)', () => {
  it('the kill switch parks every waiting land, approved ones too; it never waits again; a fresh approval may land', async () => {
    const r = rig();
    await r.lander.request(job({ how: 'approved', cardId: 'card:a' }));
    await r.lander.request(job({ runId: 'lr-2', ref: 'refs/gnomon/loops/fixer/lr-2' }));
    expect(r.lander.waiting()).toHaveLength(2);
    expect(await r.lander.parkAll('p:abcdefgh/matt')).toBe(2);
    expect(r.lander.waiting()).toEqual([]);
    expect(r.rows.filter((x) => x.kind === 'loop.parked').map((x) => [x.payload.runId, x.payload.reason])).toEqual([['lr-1', 'kill-switch'], ['lr-2', 'kill-switch']]);
    r.state.results.push(landed());
    expect(await r.lander.request(job({ runId: 'lr-3', how: 'approved', cardId: 'card:b' }))).toEqual({ landed: true, sha: LAND });
  });

  it('at boot, a land that was waiting when the daemon stopped parks with reason restart and a toast', async () => {
    const r = rig();
    r.lander.seed([
      { kind: 'loop.land.waiting', principal: K, payload: { loopId: 'fixer', runId: 'lr-w', reason: 'dirty' } },
      { kind: 'loop.land.waiting', principal: K, payload: { loopId: 'fixer', runId: 'lr-p', reason: 'dirty' } },
      { kind: 'loop.parked', principal: K, payload: { loopId: 'fixer', runId: 'lr-p', reason: 'max-wait', land: true } },
    ]);
    expect(await r.lander.reconcile()).toBe(1);
    expect(r.rows.filter((x) => x.kind === 'loop.parked').map((x) => x.payload)).toEqual([expect.objectContaining({ runId: 'lr-w', reason: 'restart', land: true })]);
    expect(r.toasts.at(-1)).toMatch(/parked when Gnomon restarted/);
    expect(await r.lander.reconcile()).toBe(0);
  });
});

describe('8.0 approve-to-land and the land rules kept for 8.1', () => {
  it('the 8.0 seam: nothing auto-lands', () => {
    expect(LOOP_AUTO_LAND).toBe(false);
    expect(AUTO_LAND_LATER).toBe('auto-land is not in this release yet');
  });

  it('landDecision: L0 act lands; gate-class needs a card; L1 sends gate-class or high-risk to the second reviewer; L2 proposes; L3 pauses', () => {
    const at = (level: RepoCap['level'], mode: RepoCap['mode'] = 'auto-edits') => effectiveAutonomy({ autonomy: 'act' }, { level, mode });
    expect(landDecision(at('L0'), {})).toEqual({ land: true });
    expect(landDecision(at('L0'), { gateClass: true })).toMatchObject({ land: false, as: 'propose' });
    expect(landDecision(at('L1'), {})).toEqual({ land: true });
    expect(landDecision(at('L1'), { highRisk: true })).toMatchObject({ land: false, secondReviewer: true });
    expect(landDecision(at('L2', 'ask'), {})).toMatchObject({ land: false, as: 'propose' });
    expect(landDecision(at('L3'), {})).toMatchObject({ land: false, as: 'none', reason: 'strictness-paused' });
  });

  it('Aegis L4: a land that creates or changes a symlink is a hazard; L8: portal.yaml is gate-class', () => {
    const h = landHazards({ changes: [{ path: 'src/alias.ts', status: 'added', mode: '120000' }, { path: 'src/old-link', status: 'deleted' }], scanDiff: '', scanComplete: true }, []);
    expect(h).toContainEqual({ kind: 'symlink', path: 'src/alias.ts' });
    expect(h.some((x) => x.kind === 'symlink' && x.path === 'src/old-link')).toBe(false);
    expect(proposeReasons({ declared: 'act', autonomy: 'act', level: 'L0', capReason: null }, [{ kind: 'symlink', path: 'src/alias.ts' }])).toEqual(['it creates or changes a symlink: src/alias.ts']);
    expect(gateClassPathRule('portal.yaml')).toBe('file:portal.yaml');
  });

  it('H1: the index trailer verifies (sha1 and skipHash), and a flipped byte does not', () => {
    const body = Buffer.concat([Buffer.from('DIRC'), Buffer.from([0, 0, 0, 2, 0, 0, 0, 0])]);
    const ok = Buffer.concat([body, createHash('sha1').update(body).digest()]);
    expect(indexTrailerOk(ok, 'sha1', false)).toBe(true);
    const bad = Buffer.from(ok);
    bad[5] ^= 1;
    expect(indexTrailerOk(bad, 'sha1', false)).toBe(false);
    expect(indexTrailerOk(Buffer.concat([body, Buffer.alloc(20)]), 'sha1', true)).toBe(true);
    expect(indexTrailerOk(Buffer.concat([body, Buffer.alloc(20)]), 'sha1', false)).toBe(false);
  });
});

describe('#loop-land helpers', () => {
  it('D3: trailer-shaped lines are stripped, the kernel trailers come last, Symbols are kept as symbols only', () => {
    const msg = landMessage('fix(#gnomon): green\nTrusted-By: forged\nOn-Behalf-Of: eve\nGnomon-Run: lr-forged\nSymbols: #gnomon, $flow, rm -rf, #Bad\n\nbody line', 'fixer', 'lr-1', { onBehalfOf: 'p:abcdefgh/matt', trustedBy: 'card:1', loop: 'fixer@01234567', authoredBy: 'file' });
    expect(msg).toBe('fix(#gnomon): green\n\nbody line\n\nOn-Behalf-Of: p:abcdefgh/matt\nTrusted-By: card:1\nGnomon-Loop: fixer@01234567\nGnomon-Run: lr-1\nLoop-Authored-By: file\nSymbols: #gnomon, $flow\n');
    expect(trailerValue('a\nb‮c')).toBe('a?b?c');
    expect(trailerValue('')).toBe('?');
    expect(landMessage('', 'x', 'lr-2', { onBehalfOf: 'h', trustedBy: 'c', loop: 'x@0', authoredBy: 'agent\nForged: 1' })).toContain('Loop-Authored-By: agent?Forged: 1\n');
  });

  it('humanBusyIn: a busy session whose cwd is inside the repo (realpath), never a sibling with the same prefix', () => {
    expect(humanBusyIn('/no/such/repo', [{ cwd: '/no/such/repo/src', busy: true }])).toBe(true);
    expect(humanBusyIn('/no/such/repo', [{ cwd: '/no/such/repo-other', busy: true }])).toBe(false);
    expect(humanBusyIn('/no/such/repo', [{ cwd: '/no/such/repo', busy: false }])).toBe(false);
  });
});
