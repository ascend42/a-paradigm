/**
 * #offer-router goldens (TD-2026-10-20-812, S1, Aegis D1/D3): the fold over committed rows and the two human requests.
 */
import { describe, expect, it } from 'vitest';
import { OfferRouter, deskRepoScope, openText, type CommittedRow, type OfferAsker, type RouterRow } from '../src/kernel/desk/offer-router.js';
import type { DeskMod } from '../src/kernel/desk/mcp-passthrough.js';
import { HSID, HSID2, HUMAN, KERNEL, assistantLine, deskMod, offerReply, toolResultLine, toolUseLine } from './desk-fixtures.js';

const GUI: OfferAsker = { connId: 'conn-1', principal: HUMAN, principalClass: 'human', credential: 'gui' };
const REPO = 'repo:0123456789abcdef';

function rig(opts: { mods?: DeskMod[]; pending?: boolean; owner?: string | undefined } = {}) {
  let n = 0;
  const written: Array<{ kind: string; payload: Record<string, unknown>; ids: Record<string, unknown> }> = [];
  const sent: Array<{ principal: string; hsid: string; text: string }> = [];
  let mods = opts.mods ?? [deskMod('constellation')];
  const r = new OfferRouter({
    kernelPrincipal: KERNEL,
    mods: () => mods,
    repoScopeOf: () => REPO,
    ownerOf: () => ('owner' in opts ? opts.owner : HUMAN),
    pendingCard: () => opts.pending === true,
    append: async (kind, payload, ids) => {
      written.push({ kind, payload, ids });
    },
    send: async (principal, hsid, text) => {
      sent.push({ principal, hsid, text });
      return { turn: `turn:${hsid}/2` };
    },
    mintOfferId: () => `offer:01J000000000000000000000${String(++n).padStart(2, '0')}`,
  });
  // the daemon appends what observe returns and feeds the committed row back
  const commit = (e: CommittedRow): RouterRow[] => {
    const rows = r.observe({ principal: KERNEL, ...e });
    for (const row of rows) r.observe({ kind: row.kind, principal: KERNEL, session: row.session, payload: row.payload });
    return rows;
  };
  const turn = (hsid: string, k: number, text: string | null): RouterRow[] => {
    commit({ kind: 'turn.sent', session: hsid, payload: { hsid, turn: `turn:${hsid}/${k}` } });
    if (text !== null) commit({ kind: 'turn.event', session: hsid, payload: { hsid, type: 'assistant', line: assistantLine(text) } });
    return commit({ kind: 'turn.result', session: hsid, payload: { hsid } });
  };
  return { r, written, sent, commit, turn, setMods: (m: DeskMod[]) => (mods = m) };
}

const BLOCK = { mod: 'constellation', kind: 'map-the-idea', question: 'Want me to map this on the board?' };

describe('#offer-router: offer.shown', () => {
  it('one valid block → one kernel offer.shown with phase/title/contextIn COPIED from the manifest (D3)', () => {
    const t = rig();
    const rows = t.turn(HSID, 1, offerReply('Here are three directions.', BLOCK));
    expect(rows).toEqual([{
      kind: 'offer.shown',
      session: HSID,
      payload: { offerId: 'offer:01J00000000000000000000001', hsid: HSID, mod: 'constellation', kind: 'map-the-idea', phase: 'diverge', title: 'Map it on constellation', contextIn: ['recent-messages'], question: BLOCK.question, replyTurnId: `turn:${HSID}/1` },
    }]);
  });

  it('a block cannot smuggle phase or title (closed keys ⇒ no offer)', () => {
    const t = rig();
    expect(t.turn(HSID, 1, offerReply('x', { ...BLOCK, title: 'Run rm -rf' }))).toEqual([]);
  });

  it('two blocks in one reply → none (at most one per reply)', () => {
    const t = rig();
    const two = `${offerReply('a', BLOCK)}\n\n${offerReply('b', { ...BLOCK, kind: 'pull-together' })}`;
    expect(t.turn(HSID, 1, two)).toEqual([]);
  });

  it('two assistant messages each with a block in one turn → none', () => {
    const t = rig();
    t.commit({ kind: 'turn.sent', session: HSID, payload: { hsid: HSID, turn: `turn:${HSID}/1` } });
    t.commit({ kind: 'turn.event', session: HSID, payload: { line: assistantLine(offerReply('a', BLOCK)) } });
    t.commit({ kind: 'turn.event', session: HSID, payload: { line: assistantLine(offerReply('b', BLOCK)) } });
    expect(t.commit({ kind: 'turn.result', session: HSID, payload: {} })).toEqual([]);
  });

  it('streaming: while another turn is outstanding, no offer', () => {
    const t = rig();
    t.commit({ kind: 'turn.sent', session: HSID, payload: { turn: `turn:${HSID}/1` } });
    t.commit({ kind: 'turn.sent', session: HSID, payload: { turn: `turn:${HSID}/2` } });
    t.commit({ kind: 'turn.event', session: HSID, payload: { line: assistantLine(offerReply('a', BLOCK)) } });
    expect(t.commit({ kind: 'turn.result', session: HSID, payload: {} })).toEqual([]);
  });

  it('a pending decision card → no offer', () => {
    expect(rig({ pending: true }).turn(HSID, 1, offerReply('a', BLOCK))).toEqual([]);
  });

  it('an uninstalled mod → plain text, no offer', () => {
    expect(rig().turn(HSID, 1, offerReply('a', { ...BLOCK, mod: 'neurons' }))).toEqual([]);
  });

  it('a non-offerable mod (no declared offers) or an undeclared kind → refused', () => {
    expect(rig({ mods: [deskMod('constellation', { offers: false })] }).turn(HSID, 1, offerReply('a', BLOCK))).toEqual([]);
    expect(rig().turn(HSID, 1, offerReply('a', { ...BLOCK, kind: 'delete-repo' }))).toEqual([]);
  });

  it('a subagent message (parent_tool_use_id set) is not the reply', () => {
    const t = rig();
    t.commit({ kind: 'turn.sent', session: HSID, payload: { turn: `turn:${HSID}/1` } });
    const sub = JSON.stringify({ type: 'assistant', parent_tool_use_id: 'toolu_1', message: { content: [{ type: 'text', text: offerReply('a', BLOCK) }] } });
    t.commit({ kind: 'turn.event', session: HSID, payload: { line: sub } });
    expect(t.commit({ kind: 'turn.result', session: HSID, payload: {} })).toEqual([]);
  });

  it('a row by a non-kernel principal is not folded as an offer', () => {
    const t = rig();
    t.r.observe({ kind: 'offer.shown', principal: HUMAN, session: HSID, payload: { offerId: 'offer:01J00000000000000000000009', hsid: HSID, mod: 'constellation', kind: 'map-the-idea', phase: 'diverge', title: 'Map it on constellation', contextIn: [], question: 'q?', replyTurnId: `turn:${HSID}/1` } });
    return expect(t.r.decide(GUI, { offerId: 'offer:01J00000000000000000000009', decision: 'open' })).rejects.toMatchObject({ refusal: { code: 'NOT_FOUND' } });
  });
});

describe('#offer-router: mutes', () => {
  it('not-now mutes that mod for the rest of the hsid (another session unaffected)', async () => {
    const t = rig();
    const [shown] = t.turn(HSID, 1, offerReply('a', BLOCK));
    await t.r.decide(GUI, { offerId: shown!.payload.offerId, decision: 'not-now' });
    expect(t.turn(HSID, 2, offerReply('b', BLOCK))).toEqual([]);
    expect(t.r.guidanceFor(HSID)).toBeNull();
    expect(t.turn(HSID2, 1, offerReply('c', BLOCK))).toHaveLength(1);
  });

  it('stop-here mutes every mod for the hsid', async () => {
    const t = rig({ mods: [deskMod('constellation'), deskMod('neurons')] });
    const [shown] = t.turn(HSID, 1, offerReply('a', BLOCK));
    await t.r.decide(GUI, { offerId: shown!.payload.offerId, decision: 'stop-here' });
    expect(t.turn(HSID, 2, offerReply('b', { ...BLOCK, mod: 'neurons' }))).toEqual([]);
  });

  it('a repo mute folds from request.offer.mute (and seed() replays it at boot)', async () => {
    const t = rig();
    await t.r.mute(GUI, { mod: 'constellation', scope: 'repo', repo: REPO, muted: true });
    expect(t.written.at(-1)).toMatchObject({ kind: 'request.offer.mute', payload: { mod: 'constellation', repo: REPO, muted: true }, ids: { connId: 'conn-1' } });
    expect(t.turn(HSID, 1, offerReply('a', BLOCK))).toEqual([]);
    expect(t.r.repoMuted(REPO, 'constellation')).toBe(true);
    const fresh = rig();
    fresh.r.seed([{ kind: 'request.offer.mute', principal: KERNEL, payload: { mod: 'constellation', scope: 'repo', repo: REPO, muted: true } }]);
    expect(fresh.r.repoMuted(REPO, 'constellation')).toBe(true);
    fresh.r.seed([{ kind: 'request.offer.mute', principal: KERNEL, payload: { mod: 'constellation', scope: 'repo', repo: REPO, muted: false } }]);
    expect(fresh.r.repoMuted(REPO, 'constellation')).toBe(false);
  });

  it('deskRepoScope derives repo:<16 hex> from a repoKey', () => {
    expect(deskRepoScope(`sha256:${'ab'.repeat(32)}`)).toBe(`repo:${'ab'.repeat(8)}`);
  });
});

describe('#offer-router: ^offer-accept (Aegis D1)', () => {
  it('open writes request.offer.decide + offer.decided and sends the KERNEL template as the human', async () => {
    const t = rig();
    const [shown] = t.turn(HSID, 1, offerReply('a', BLOCK));
    const id = shown!.payload.offerId as string;
    const res = await t.r.decide(GUI, { offerId: id, decision: 'open' });
    expect(res).toMatchObject({ offerId: id, decision: 'open' });
    expect(t.written.map((w) => w.kind)).toEqual(['request.offer.decide', 'offer.decided']);
    expect(t.written[1]!.payload).toEqual({ offerId: id, hsid: HSID, decision: 'open' });
    expect(t.sent).toEqual([{ principal: HUMAN, hsid: HSID, text: openText('Map it on constellation', 'open_board') }]);
    expect(t.sent[0]!.text).toBe('Open Map it on constellation: use the open_board tool.');
  });

  it('exactly one decision per offer: a replay is refused', async () => {
    const t = rig();
    const [shown] = t.turn(HSID, 1, offerReply('a', BLOCK));
    const id = shown!.payload.offerId as string;
    await t.r.decide(GUI, { offerId: id, decision: 'not-now' });
    await expect(t.r.decide(GUI, { offerId: id, decision: 'open' })).rejects.toMatchObject({ refusal: { code: 'BAD_REQUEST' } });
    // concurrent double-click: the second is refused before the first's row commits
    const t2 = rig();
    const [s2] = t2.turn(HSID, 1, offerReply('a', BLOCK));
    const a = t2.r.decide(GUI, { offerId: s2!.payload.offerId, decision: 'open' });
    const b = t2.r.decide(GUI, { offerId: s2!.payload.offerId, decision: 'open' });
    await expect(a).resolves.toBeTruthy();
    await expect(b).rejects.toMatchObject({ refusal: { code: 'BAD_REQUEST' } });
    expect(t2.sent).toHaveLength(1);
  });

  it('only the latest offer of the hsid is decidable; a dead or foreign session is refused', async () => {
    const t = rig();
    const [first] = t.turn(HSID, 1, offerReply('a', BLOCK));
    t.turn(HSID, 2, offerReply('b', { ...BLOCK, kind: 'pull-together' }));
    await expect(t.r.decide(GUI, { offerId: first!.payload.offerId, decision: 'open' })).rejects.toMatchObject({ refusal: { code: 'BAD_REQUEST' } });
    const dead = rig({ owner: undefined });
    const [d] = dead.turn(HSID, 1, offerReply('a', BLOCK));
    await expect(dead.r.decide(GUI, { offerId: d!.payload.offerId, decision: 'open' })).rejects.toMatchObject({ refusal: { code: 'NOT_FOUND' } });
    const foreign = rig({ owner: 'p:abcdefgh/someone' });
    const [f] = foreign.turn(HSID, 1, offerReply('a', BLOCK));
    await expect(foreign.r.decide(GUI, { offerId: f!.payload.offerId, decision: 'open' })).rejects.toMatchObject({ refusal: { code: 'FORBIDDEN' } });
  });

  it('human gui/device only: an agent, or a human without a first-party credential, is refused', async () => {
    const t = rig();
    const [shown] = t.turn(HSID, 1, offerReply('a', BLOCK));
    const p = { offerId: shown!.payload.offerId, decision: 'open' };
    await expect(t.r.decide({ ...GUI, principalClass: 'agent' }, p)).rejects.toMatchObject({ refusal: { code: 'FORBIDDEN' } });
    await expect(t.r.decide({ ...GUI, credential: 'session' }, p)).rejects.toMatchObject({ refusal: { code: 'FORBIDDEN' } });
    await expect(t.r.mute({ ...GUI, principalClass: 'agent' }, { mod: 'x', scope: 'repo', repo: REPO, muted: true })).rejects.toMatchObject({ refusal: { code: 'FORBIDDEN' } });
    await expect(t.r.decide(GUI, { offerId: shown!.payload.offerId, decision: 'yes' })).rejects.toMatchObject({ refusal: { code: 'BAD_REQUEST' } });
    expect(t.sent).toEqual([]);
  });
});

describe('#offer-router: offer.kept (D3)', () => {
  it('after open, the declared handoffTool on the mod\'s own server completing without error → one offer.kept', async () => {
    const t = rig();
    const [shown] = t.turn(HSID, 1, offerReply('a', BLOCK));
    const id = shown!.payload.offerId as string;
    await t.r.decide(GUI, { offerId: id, decision: 'open' });
    t.commit({ kind: 'turn.sent', session: HSID, payload: { turn: `turn:${HSID}/2` } });
    // another server's same-named tool and a different tool of the mod do not count
    expect(t.commit({ kind: 'turn.event', session: HSID, payload: { line: toolUseLine('t0', 'mcp__evil__open_board') } })).toEqual([]);
    expect(t.commit({ kind: 'turn.event', session: HSID, payload: { line: toolResultLine('t0') } })).toEqual([]);
    expect(t.commit({ kind: 'turn.event', session: HSID, payload: { line: toolUseLine('t1', 'mcp__gnomon-constellation__summarise') } })).toEqual([]);
    expect(t.commit({ kind: 'turn.event', session: HSID, payload: { line: toolResultLine('t1') } })).toEqual([]);
    // an errored call is not kept
    t.commit({ kind: 'turn.event', session: HSID, payload: { line: toolUseLine('t2', 'mcp__gnomon-constellation__open_board') } });
    expect(t.commit({ kind: 'turn.event', session: HSID, payload: { line: toolResultLine('t2', true) } })).toEqual([]);
    t.commit({ kind: 'turn.event', session: HSID, payload: { line: toolUseLine('t3', 'mcp__gnomon-constellation__open_board') } });
    expect(t.commit({ kind: 'turn.event', session: HSID, payload: { line: toolResultLine('t3') } })).toEqual([{ kind: 'offer.kept', session: HSID, payload: { offerId: id, hsid: HSID, mod: 'constellation', tool: 'open_board' } }]);
    t.commit({ kind: 'turn.event', session: HSID, payload: { line: toolUseLine('t4', 'mcp__gnomon-constellation__open_board') } });
    expect(t.commit({ kind: 'turn.event', session: HSID, payload: { line: toolResultLine('t4') } })).toEqual([]);
  });

  it('without open, the handoff tool running is not kept', () => {
    const t = rig();
    t.turn(HSID, 1, offerReply('a', BLOCK));
    t.commit({ kind: 'turn.event', session: HSID, payload: { line: toolUseLine('t1', 'mcp__gnomon-constellation__open_board') } });
    expect(t.commit({ kind: 'turn.event', session: HSID, payload: { line: toolResultLine('t1') } })).toEqual([]);
  });
});

describe('#offer-router: guidance roster', () => {
  it('lists offerable mods only; empty roster ⇒ no desk note', () => {
    const t = rig({ mods: [deskMod('constellation'), deskMod('quiet', { offers: false })] });
    const g = t.r.guidanceFor(HSID)!;
    expect(g).toContain('- constellation: map-the-idea (diverge) "Map it on constellation"');
    expect(g).not.toContain('quiet');
    t.setMods([]);
    expect(t.r.guidanceFor(HSID)).toBeNull();
  });
});
