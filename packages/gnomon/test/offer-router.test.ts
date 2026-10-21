/**
 * #offer-router goldens (TD-2026-10-20-812, S1, Aegis D1/D3): the fold over committed rows and the two human requests.
 */
import { describe, expect, it } from 'vitest';
import { OfferRouter, deskRepoScope, openText, type CommittedRow, type OfferAsker, type RouterRow } from '../src/kernel/desk/offer-router.js';
import { serverNameOf, type DeskMod } from '../src/kernel/desk/mcp-passthrough.js';
import { HSID, HSID2, HUMAN, KERNEL, assistantLine, assistantLineOf, deskMod, messageDeltaLine, messageStartLine, messageStopLine, offerReply, toolResultLine, toolUseLine } from './desk-fixtures.js';

const GUI: OfferAsker = { connId: 'conn-1', principal: HUMAN, principalClass: 'human', credential: 'gui' };
const REPO = 'repo:0123456789abcdef';

function rig(opts: { mods?: DeskMod[]; pending?: boolean; owner?: string | undefined; served?: string[]; failDecidedRow?: boolean } = {}) {
  let n = 0;
  const written: Array<{ kind: string; payload: Record<string, unknown>; ids: Record<string, unknown> }> = [];
  const sent: Array<{ principal: string; hsid: string; text: string }> = [];
  const diags: Array<{ event: string; data: Record<string, unknown> }> = [];
  let mods = opts.mods ?? [deskMod('constellation')];
  let failDecided = opts.failDecidedRow === true;
  const r = new OfferRouter({
    kernelPrincipal: KERNEL,
    mods: () => mods,
    repoScopeOf: () => REPO,
    ownerOf: () => ('owner' in opts ? opts.owner : HUMAN),
    pendingCard: () => opts.pending === true,
    append: async (kind, payload, ids) => {
      if (kind === 'offer.decided' && failDecided) {
        failDecided = false;
        throw new Error('disk full');
      }
      written.push({ kind, payload, ids });
    },
    // H1b: by default every fixture mod's server was added to the session
    sessionServers: () => new Set(opts.served ?? mods.map((m) => serverNameOf(m.name))),
    diag: (event, data) => diags.push({ event, data }),
    send: async (principal, hsid, text) => {
      sent.push({ principal, hsid, text });
      return { turn: `turn:${hsid}/2` };
    },
    mintOfferId: () => `offer:01J000000000000000000000${String(++n).padStart(2, '0')}`,
  });
  // the daemon appends what observe returns and feeds the committed row back; offer.suppressed rows (T-2026-10-21-006)
  // are collected in `suppressed` so a test reads "no offer" as [] (the raw return is checked in its own test)
  const suppressed: Array<Record<string, unknown>> = [];
  const commit = (e: CommittedRow): RouterRow[] => {
    const rows = r.observe({ principal: KERNEL, ...e });
    for (const row of rows) r.observe({ kind: row.kind, principal: KERNEL, session: row.session, payload: row.payload });
    for (const row of rows) if (row.kind === 'offer.suppressed') suppressed.push(row.payload);
    return rows.filter((row) => row.kind !== 'offer.suppressed');
  };
  const turn = (hsid: string, k: number, text: string | null): RouterRow[] => {
    commit({ kind: 'turn.sent', session: hsid, payload: { hsid, turn: `turn:${hsid}/${k}` } });
    if (text !== null) commit({ kind: 'turn.event', session: hsid, payload: { hsid, type: 'assistant', line: assistantLine(text) } });
    return commit({ kind: 'turn.result', session: hsid, payload: { hsid } });
  };
  return { r, written, sent, diags, suppressed, commit, turn, setMods: (m: DeskMod[]) => (mods = m) };
}

const BLOCK = { mod: 'acme.constellation', kind: 'map-the-idea', question: 'Want me to map this on the board?' };

describe('#offer-router: offer.shown', () => {
  it('one valid block → one kernel offer.shown with phase/title/contextIn COPIED from the manifest (D3)', () => {
    const t = rig();
    const rows = t.turn(HSID, 1, offerReply('Here are three directions.', BLOCK));
    expect(rows).toEqual([{
      kind: 'offer.shown',
      session: HSID,
      payload: { offerId: 'offer:01J00000000000000000000001', hsid: HSID, mod: 'acme.constellation', kind: 'map-the-idea', phase: 'diverge', title: 'Map it on acme.constellation', contextIn: ['recent-messages'], question: BLOCK.question, replyTurnId: `turn:${HSID}/1` },
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
    expect(rig().turn(HSID, 1, offerReply('a', { ...BLOCK, mod: 'acme.neurons' }))).toEqual([]);
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

  it('H1b: a mod whose server was not added to THIS session (needs-config, muted at spawn, name taken) is never offered', () => {
    const t = rig({ served: [] });
    expect(t.turn(HSID, 1, offerReply('a', BLOCK))).toEqual([]);
    expect(t.r.guidanceFor(HSID)).toBeNull();
  });

  it('L4: a row with no principal is not folded either', async () => {
    const t = rig();
    t.r.observe({ kind: 'offer.shown', session: HSID, payload: { offerId: 'offer:01J00000000000000000000009', hsid: HSID, mod: 'acme.constellation', kind: 'map-the-idea', phase: 'diverge', title: 'Map it on acme.constellation', contextIn: [], question: 'q?', replyTurnId: `turn:${HSID}/1` } });
    await expect(t.r.decide(GUI, { offerId: 'offer:01J00000000000000000000009', decision: 'open' })).rejects.toMatchObject({ refusal: { code: 'NOT_FOUND' } });
  });

  it('a row by a non-kernel principal is not folded as an offer', () => {
    const t = rig();
    t.r.observe({ kind: 'offer.shown', principal: HUMAN, session: HSID, payload: { offerId: 'offer:01J00000000000000000000009', hsid: HSID, mod: 'acme.constellation', kind: 'map-the-idea', phase: 'diverge', title: 'Map it on acme.constellation', contextIn: [], question: 'q?', replyTurnId: `turn:${HSID}/1` } });
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
    expect(t.turn(HSID, 2, offerReply('b', { ...BLOCK, mod: 'acme.neurons' }))).toEqual([]);
  });

  it('a repo mute: request.offer.mute names a live hsid, the kernel writes offer.muted (and seed() replays it at boot)', async () => {
    const t = rig();
    await t.r.mute(GUI, { mod: 'acme.constellation', scope: 'repo', hsid: HSID, muted: true });
    // S0b: the human names a live session they own; the kernel derives the repo and writes offer.muted
    expect(t.written.at(-2)).toMatchObject({ kind: 'request.offer.mute', payload: { mod: 'acme.constellation', scope: 'repo', hsid: HSID, muted: true }, ids: { connId: 'conn-1' } });
    expect(t.written.at(-2)!.payload).not.toHaveProperty('repo');
    expect(t.written.at(-1)).toMatchObject({ kind: 'offer.muted', payload: { mod: 'acme.constellation', repo: REPO, muted: true, hsid: HSID } });
    expect(t.turn(HSID, 1, offerReply('a', BLOCK))).toEqual([]);
    expect(t.r.repoMuted(REPO, 'acme.constellation')).toBe(true);
    const fresh = rig();
    fresh.r.seed([{ kind: 'offer.muted', principal: KERNEL, payload: { mod: 'acme.constellation', repo: REPO, muted: true, hsid: HSID } }]);
    expect(fresh.r.repoMuted(REPO, 'acme.constellation')).toBe(true);
    fresh.r.seed([{ kind: 'offer.muted', principal: KERNEL, payload: { mod: 'acme.constellation', repo: REPO, muted: false, hsid: HSID } }]);
    expect(fresh.r.repoMuted(REPO, 'acme.constellation')).toBe(false);
    // a request row alone (or a client-supplied repo) folds nothing: only the kernel-owned offer.muted counts
    fresh.r.seed([{ kind: 'request.offer.mute', principal: KERNEL, payload: { mod: 'acme.constellation', scope: 'repo', repo: REPO, muted: true } }]);
    fresh.r.seed([{ kind: 'offer.muted', principal: HUMAN, payload: { mod: 'acme.constellation', repo: REPO, muted: true, hsid: HSID } }]);
    expect(fresh.r.repoMuted(REPO, 'acme.constellation')).toBe(false);
    expect(fresh.r.repoMuted(REPO, 'acme.constellation')).toBe(false);
  });

  it('S0b: a mute names a live session the asker owns; a dead or foreign session, or a client repo key, is refused', async () => {
    const m = { mod: 'acme.constellation', scope: 'repo', hsid: HSID, muted: true };
    await expect(rig({ owner: undefined }).r.mute(GUI, m)).rejects.toMatchObject({ refusal: { code: 'NOT_FOUND' } });
    await expect(rig({ owner: 'p:abcdefgh/someone' }).r.mute(GUI, m)).rejects.toMatchObject({ refusal: { code: 'FORBIDDEN' } });
    const t = rig();
    await expect(t.r.mute(GUI, { ...m, repo: REPO })).rejects.toMatchObject({ refusal: { code: 'BAD_REQUEST' } });
    expect(t.written).toEqual([]);
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
    expect(t.sent).toEqual([{ principal: HUMAN, hsid: HSID, text: openText('Map it on acme.constellation', 'mcp__gm_acme_constellation__open_board') }]);
    expect(t.sent[0]!.text).toBe('Open Map it on acme.constellation: use the mcp__gm_acme_constellation__open_board tool.');
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

  it('L1: the next turn.sent retires the shown offer', async () => {
    const t = rig();
    const [shown] = t.turn(HSID, 1, offerReply('a', BLOCK));
    t.commit({ kind: 'turn.sent', session: HSID, payload: { turn: `turn:${HSID}/2` } });
    await expect(t.r.decide(GUI, { offerId: shown!.payload.offerId, decision: 'open' })).rejects.toMatchObject({ refusal: { code: 'BAD_REQUEST' } });
  });

  it('L5: decided once the request row commits; a retry after a failed offer.decided row is a replay with no second request row', async () => {
    const t = rig({ failDecidedRow: true });
    const [shown] = t.turn(HSID, 1, offerReply('a', BLOCK));
    const p = { offerId: shown!.payload.offerId, decision: 'open' };
    await expect(t.r.decide(GUI, p)).rejects.toThrow('disk full');
    await expect(t.r.decide(GUI, p)).rejects.toMatchObject({ refusal: { code: 'BAD_REQUEST' } });
    expect(t.written.filter((w) => w.kind === 'request.offer.decide')).toHaveLength(1);
    expect(t.sent).toEqual([]);
  });

  it('L5: a failed open send is reported on the diag channel', async () => {
    const t = rig();
    const [shown] = t.turn(HSID, 1, offerReply('a', BLOCK));
    const r2 = new OfferRouter({
      kernelPrincipal: KERNEL, mods: () => [deskMod('constellation')], repoScopeOf: () => REPO, ownerOf: () => HUMAN, pendingCard: () => false,
      append: async () => undefined, send: async () => Promise.reject(new Error('not running')), sessionServers: () => new Set(['gm_acme_constellation']),
      diag: (event, data) => t.diags.push({ event, data }),
    });
    r2.observe({ kind: 'offer.shown', principal: KERNEL, session: HSID, payload: shown!.payload });
    await expect(r2.decide(GUI, { offerId: shown!.payload.offerId, decision: 'open' })).rejects.toThrow('not running');
    expect(t.diags.map((d) => d.event)).toEqual(['send.failed']);
  });

  it('human gui/device only: an agent, or a human without a first-party credential, is refused', async () => {
    const t = rig();
    const [shown] = t.turn(HSID, 1, offerReply('a', BLOCK));
    const p = { offerId: shown!.payload.offerId, decision: 'open' };
    await expect(t.r.decide({ ...GUI, principalClass: 'agent' }, p)).rejects.toMatchObject({ refusal: { code: 'FORBIDDEN' } });
    await expect(t.r.decide({ ...GUI, credential: 'session' }, p)).rejects.toMatchObject({ refusal: { code: 'FORBIDDEN' } });
    await expect(t.r.mute({ ...GUI, principalClass: 'agent' }, { mod: 'acme.x', scope: 'repo', hsid: HSID, muted: true })).rejects.toMatchObject({ refusal: { code: 'FORBIDDEN' } });
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
    expect(t.commit({ kind: 'turn.event', session: HSID, payload: { line: toolUseLine('t1', 'mcp__gm_acme_constellation__summarise') } })).toEqual([]);
    expect(t.commit({ kind: 'turn.event', session: HSID, payload: { line: toolResultLine('t1') } })).toEqual([]);
    // an errored call is not kept
    t.commit({ kind: 'turn.event', session: HSID, payload: { line: toolUseLine('t2', 'mcp__gm_acme_constellation__open_board') } });
    expect(t.commit({ kind: 'turn.event', session: HSID, payload: { line: toolResultLine('t2', true) } })).toEqual([]);
    t.commit({ kind: 'turn.event', session: HSID, payload: { line: toolUseLine('t3', 'mcp__gm_acme_constellation__open_board') } });
    expect(t.commit({ kind: 'turn.event', session: HSID, payload: { line: toolResultLine('t3') } })).toEqual([{ kind: 'offer.kept', session: HSID, payload: { offerId: id, hsid: HSID, mod: 'acme.constellation', tool: 'open_board' } }]);
    t.commit({ kind: 'turn.event', session: HSID, payload: { line: toolUseLine('t4', 'mcp__gm_acme_constellation__open_board') } });
    expect(t.commit({ kind: 'turn.event', session: HSID, payload: { line: toolResultLine('t4') } })).toEqual([]);
  });

  it('M3: a mod muted after the open never counts as kept (diag kept.refused); the server not added to the session is not watched', async () => {
    const t = rig();
    const [shown] = t.turn(HSID, 1, offerReply('a', BLOCK));
    await t.r.decide(GUI, { offerId: shown!.payload.offerId, decision: 'open' });
    await t.r.mute(GUI, { mod: 'acme.constellation', scope: 'repo', hsid: HSID, muted: true });
    t.commit({ kind: 'turn.event', session: HSID, payload: { line: toolUseLine('t1', 'mcp__gm_acme_constellation__open_board') } });
    expect(t.commit({ kind: 'turn.event', session: HSID, payload: { line: toolResultLine('t1') } })).toEqual([]);
    expect(t.diags.map((d) => d.event)).toEqual(['kept.refused']);
  });

  it('L7: mutes survive session.exited (kept until the state is evicted)', async () => {
    const t = rig();
    const [shown] = t.turn(HSID, 1, offerReply('a', BLOCK));
    await t.r.decide(GUI, { offerId: shown!.payload.offerId, decision: 'not-now' });
    t.commit({ kind: 'session.exited', session: HSID, payload: { hsid: HSID } });
    expect(t.turn(HSID, 2, offerReply('b', BLOCK))).toEqual([]);
  });

  it('without open, the handoff tool running is not kept', () => {
    const t = rig();
    t.turn(HSID, 1, offerReply('a', BLOCK));
    t.commit({ kind: 'turn.event', session: HSID, payload: { line: toolUseLine('t1', 'mcp__gm_acme_constellation__open_board') } });
    expect(t.commit({ kind: 'turn.event', session: HSID, payload: { line: toolResultLine('t1') } })).toEqual([]);
  });
});

describe('#offer-router: guidance roster', () => {
  it('lists offerable mods only; empty roster ⇒ no desk note', () => {
    const t = rig({ mods: [deskMod('constellation'), deskMod('quiet', { offers: false })] });
    const g = t.r.guidanceFor(HSID)!;
    expect(g).toContain('- acme.constellation: map-the-idea (diverge) "Map it on acme.constellation"');
    expect(g).not.toContain('quiet');
    t.setMods([]);
    expect(t.r.guidanceFor(HSID)).toBeNull();
  });
});

describe('#offer-router: evaluated when the reply ends, not at turn.result (T-2026-10-21-006)', () => {
  const ev = (line: string): CommittedRow => ({ kind: 'turn.event', session: HSID, payload: { hsid: HSID, line } });
  const sent = (k: number): CommittedRow => ({ kind: 'turn.sent', session: HSID, payload: { hsid: HSID, turn: `turn:${HSID}/${k}` } });
  const result: CommittedRow = { kind: 'turn.result', session: HSID, payload: { hsid: HSID } };
  /** one streamed main-chain message: message_start, its text, message_delta(stop), message_stop; returns every row produced */
  const reply = (t: ReturnType<typeof rig>, id: string, text: string, stop = 'end_turn'): RouterRow[] => [
    ...t.commit(ev(messageStartLine(id))),
    ...t.commit(ev(assistantLineOf(text, { id }))),
    ...t.commit(ev(messageDeltaLine(stop))),
    ...t.commit(ev(messageStopLine())),
  ];
  const suppressions = (t: ReturnType<typeof rig>) => t.suppressed;

  it('the founder\'s timing: reply 2 ends, turn 3 is sent before turn 2\'s turn.result ⇒ the offer is shown', () => {
    const t = rig();
    t.turn(HSID, 1, 'Hello.');
    t.commit(sent(2));
    const rows = reply(t, 'msg_2', offerReply('Here are three directions.', BLOCK));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.kind).toBe('offer.shown');
    expect(rows[0]!.payload.replyTurnId).toBe(`turn:${HSID}/2`);
    t.commit(sent(3)); // 8 s after message_stop, 22 s before turn 2's turn.result
    expect(t.commit(result)).toEqual([]); // turn 2's turn.result, ~30 s late
    expect(suppressions(t).filter((d) => d.turn === `turn:${HSID}/2`)).toEqual([]);
  });

  it('a turn.result arriving after the evaluation is not counted again (shown once; a suppression once)', () => {
    const t = rig();
    t.commit(sent(1));
    const shown = reply(t, 'msg_1', offerReply('a', BLOCK));
    expect(shown).toHaveLength(1);
    expect(t.commit(result)).toEqual([]);
    t.commit(sent(2));
    expect(reply(t, 'msg_2', 'plain')).toEqual([]);
    expect(t.commit(result)).toEqual([]);
    expect(suppressions(t)).toEqual([{ hsid: HSID, turn: `turn:${HSID}/2`, why: 'no-block' }]);
    // an assistant line carrying stop_reason AND the message_delta: still one evaluation
    t.commit(sent(3));
    const third = [
      ...t.commit(ev(assistantLineOf(offerReply('b', BLOCK), { id: 'msg_3', stopReason: 'end_turn' }))),
      ...t.commit(ev(messageDeltaLine('end_turn'))),
      ...t.commit(ev(messageStopLine())),
      ...t.commit(result),
    ];
    expect(third.map((r) => r.kind)).toEqual(['offer.shown']);
    expect(suppressions(t)).toHaveLength(1);
  });

  it('an assistant line with stop_reason end_turn ends the reply too', () => {
    const t = rig();
    t.commit(sent(1));
    expect(t.commit(ev(assistantLineOf(offerReply('a', BLOCK), { stopReason: 'end_turn' })))[0]?.kind).toBe('offer.shown');
  });

  it('a tool_use stop does not evaluate; the final message of the turn is the reply', () => {
    const t = rig();
    t.commit(sent(1));
    // an offer block before a tool call is not the reply's end
    expect(reply(t, 'msg_1', offerReply('a', BLOCK), 'tool_use')).toEqual([]);
    expect(suppressions(t)).toEqual([]);
    t.commit(ev(toolResultLine('t1')));
    expect(reply(t, 'msg_2', 'Done, no offer.')).toEqual([]);
    expect(suppressions(t)).toEqual([{ hsid: HSID, turn: `turn:${HSID}/1`, why: 'no-block' }]);
    // a later final message with the block is shown
    t.commit(result);
    t.commit(sent(2));
    t.commit(ev(messageStartLine('msg_3')));
    t.commit(ev(assistantLineOf('Thinking.', { id: 'msg_3' })));
    t.commit(ev(messageDeltaLine('tool_use')));
    expect(reply(t, 'msg_4', offerReply('Here.', BLOCK))[0]?.payload.replyTurnId).toBe(`turn:${HSID}/2`);
  });

  it('a sub-agent message (parent_tool_use_id set) is ignored, even with end_turn', () => {
    const t = rig();
    t.commit(sent(1));
    t.commit(ev(messageStartLine('msg_sub', 'toolu_task')));
    t.commit(ev(assistantLineOf(offerReply('sub', BLOCK), { id: 'msg_sub', parent: 'toolu_task', stopReason: 'end_turn' })));
    expect(t.commit(ev(messageDeltaLine('end_turn', 'toolu_task')))).toEqual([]);
    expect(suppressions(t)).toEqual([]);
    // the main chain's own end evaluates its own text, not the sub-agent's
    expect(reply(t, 'msg_main', 'Main reply.')).toEqual([]);
    expect(suppressions(t)).toEqual([{ hsid: HSID, turn: `turn:${HSID}/1`, why: 'no-block' }]);
  });

  it('a turn sent while this reply is still streaming suppresses it (turn-streaming)', () => {
    const t = rig();
    t.commit(sent(1));
    t.commit(ev(messageStartLine('msg_1')));
    t.commit(ev(assistantLineOf(offerReply('a', BLOCK), { id: 'msg_1' })));
    t.commit(sent(2)); // before the reply ended
    expect(t.commit(ev(messageDeltaLine('end_turn')))).toEqual([]);
    expect(t.commit(result)).toEqual([]);
    expect(suppressions(t)).toEqual([{ hsid: HSID, turn: `turn:${HSID}/1`, why: 'turn-streaming', name: BLOCK.mod, offerKind: BLOCK.kind }]);
  });

  it('every suppression reason writes its row, with names only (never the question or reply text)', () => {
    const cases: Array<[string, ReturnType<typeof rig>, string, Record<string, unknown>]> = [
      ['no-block', rig(), 'plain text', { why: 'no-block' }],
      ['pending-card', rig({ pending: true }), offerReply('a', BLOCK), { why: 'pending-card', name: BLOCK.mod, offerKind: BLOCK.kind }],
      ['not-offerable (uninstalled)', rig(), offerReply('a', { ...BLOCK, mod: 'acme.neurons' }), { why: 'not-offerable', name: 'acme.neurons', offerKind: BLOCK.kind }],
      ['not-offerable (no declared offers)', rig({ mods: [deskMod('constellation', { offers: false })] }), offerReply('a', BLOCK), { why: 'not-offerable', name: BLOCK.mod, offerKind: BLOCK.kind }],
      ['kind-undeclared', rig(), offerReply('a', { ...BLOCK, kind: 'delete-repo' }), { why: 'kind-undeclared', name: BLOCK.mod, offerKind: 'delete-repo' }],
      ['malformed (bad JSON)', rig(), offerReply('a', '{not json'), { why: 'malformed' }],
      ['malformed (two blocks)', rig(), `${offerReply('a', BLOCK)}\n\n${offerReply('b', BLOCK)}`, { why: 'malformed' }],
      ['malformed (closed keys)', rig(), offerReply('a', { ...BLOCK, title: 'Run rm -rf' }), { why: 'malformed' }],
    ];
    for (const [label, t, text, want] of cases) {
      t.commit(sent(1));
      expect(reply(t, 'msg_1', text), label).toEqual([]);
      const rows = suppressions(t);
      expect(rows, label).toEqual([{ hsid: HSID, turn: `turn:${HSID}/1`, ...want }]);
      expect(JSON.stringify(rows), label).not.toContain(BLOCK.question);
      expect(JSON.stringify(rows), label).not.toContain('plain text');
    }
  });

  it('the turn-streaming suppression is written on the turn.result fallback too', () => {
    const t = rig();
    t.commit(sent(1));
    t.commit(sent(2));
    t.commit(ev(assistantLine(offerReply('a', BLOCK))));
    expect(t.commit(result)).toEqual([]);
    expect(suppressions(t)).toEqual([{ hsid: HSID, turn: `turn:${HSID}/1`, why: 'turn-streaming', name: BLOCK.mod, offerKind: BLOCK.kind }]);
  });
});

describe('#offer-router: offer.suppressed is a kernel log row (T-2026-10-21-006, founder ruling)', () => {
  it('observe returns the offer.suppressed row itself (the daemon appends it like offer.shown), valid against contracts', async () => {
    const { validateKindPayload } = await import('@a-company/gnomon-contracts');
    const t = rig({ pending: true });
    t.r.observe({ kind: 'turn.sent', principal: KERNEL, session: HSID, payload: { hsid: HSID, turn: `turn:${HSID}/1` } });
    t.r.observe({ kind: 'turn.event', principal: KERNEL, session: HSID, payload: { line: assistantLineOf(offerReply('a', BLOCK)) } });
    // review R2: the message_delta end_turn defers the evaluation to its message_stop
    expect(t.r.observe({ kind: 'turn.event', principal: KERNEL, session: HSID, payload: { line: messageDeltaLine('end_turn') } })).toEqual([]);
    const rows = t.r.observe({ kind: 'turn.event', principal: KERNEL, session: HSID, payload: { line: messageStopLine() } });
    expect(rows).toEqual([{ kind: 'offer.suppressed', session: HSID, payload: { hsid: HSID, turn: `turn:${HSID}/1`, why: 'pending-card', name: BLOCK.mod, offerKind: BLOCK.kind } }]);
    expect(validateKindPayload('offer.suppressed', rows[0]!.payload)).toEqual([]);
    // the committed row folds into nothing (it is not a router input)
    expect(t.r.observe({ kind: 'offer.suppressed', principal: KERNEL, session: HSID, payload: rows[0]!.payload })).toEqual([]);
    expect(t.diags).toEqual([]);
  });

  it('volume: at most one row per completed turn; a plain reply in a session with no offerable mod writes nothing', () => {
    const none = rig({ mods: [deskMod('constellation', { offers: false })] });
    for (let k = 1; k <= 3; k++) none.turn(HSID, k, 'plain');
    expect(none.suppressed).toEqual([]);
    // ...but a block there is still a named suppression (the model offered something it could not)
    none.turn(HSID, 4, offerReply('a', BLOCK));
    expect(none.suppressed).toEqual([{ hsid: HSID, turn: `turn:${HSID}/4`, why: 'not-offerable', name: BLOCK.mod, offerKind: BLOCK.kind }]);
    const t = rig();
    for (let k = 1; k <= 3; k++) {
      t.commit({ kind: 'turn.sent', session: HSID, payload: { turn: `turn:${HSID}/${k}` } });
      t.commit({ kind: 'turn.event', session: HSID, payload: { line: assistantLineOf('plain', { id: `m${k}`, stopReason: 'end_turn' }) } });
      t.commit({ kind: 'turn.event', session: HSID, payload: { line: messageDeltaLine('end_turn') } });
      t.commit({ kind: 'turn.result', session: HSID, payload: {} });
    }
    expect(t.suppressed.map((p) => p.turn)).toEqual([1, 2, 3].map((k) => `turn:${HSID}/${k}`));
  });
});

describe('#offer-router: turn.result{turn} pairs by id (review M2)', () => {
  const ev = (line: string): CommittedRow => ({ kind: 'turn.event', session: HSID, payload: { hsid: HSID, line } });
  const sent = (k: number): CommittedRow => ({ kind: 'turn.sent', session: HSID, payload: { hsid: HSID, turn: `turn:${HSID}/${k}` } });
  const resultOf = (k: number): CommittedRow => ({ kind: 'turn.result', session: HSID, payload: { hsid: HSID, turn: `turn:${HSID}/${k}`, subtype: 'success', isError: false } });
  it('a folded queued turn (two turn.sent, one result naming the second) closes both; the next turn is evaluated normally', () => {
    const t = rig();
    t.commit(sent(1));
    t.commit(sent(2)); // folded into turn 1 by Claude Code
    t.commit(ev(assistantLine(offerReply('a', BLOCK))));
    t.commit(resultOf(2));
    // nothing is left outstanding: turn 3's block is not suppressed as turn-streaming
    t.commit(sent(3));
    t.commit(ev(assistantLine(offerReply('b', BLOCK))));
    const rows = t.commit(resultOf(3));
    expect(rows.map((r) => r.kind)).toEqual(['offer.shown']);
    expect(rows[0]!.payload.replyTurnId).toBe(`turn:${HSID}/3`);
  });
});

describe('#offer-router: session boundaries and errored turns (review R3, R4)', () => {
  const ev = (line: string): CommittedRow => ({ kind: 'turn.event', session: HSID, payload: { hsid: HSID, line } });
  const sent = (k: number): CommittedRow => ({ kind: 'turn.sent', session: HSID, payload: { hsid: HSID, turn: `turn:${HSID}/${k}` } });
  for (const boundary of ['session.exited', 'session.open', 'session.drained'] as const) {
    it(`R3: ${boundary} drops outstanding turns and the message text (a resumed session restarts at /1)`, () => {
      const t = rig();
      t.commit(sent(1));
      t.commit(sent(2)); // never answered: the session ended
      t.commit(ev(assistantLine(offerReply('stale', BLOCK))));
      t.commit({ kind: boundary, session: HSID, payload: boundary === 'session.drained' ? { uuid: '00000000-0000-4000-8000-000000000000', reason: 'restart' } : { hsid: HSID } });
      // the resumed session: turn ids restart at /1, nothing stale is outstanding or carried over
      t.commit(sent(1));
      t.commit(ev(assistantLine(offerReply('fresh', BLOCK))));
      const rows = t.commit({ kind: 'turn.result', session: HSID, payload: { hsid: HSID, turn: `turn:${HSID}/1`, subtype: 'success', isError: false } });
      expect(rows.map((r) => r.kind)).toEqual(['offer.shown']);
      expect(t.suppressed).toEqual([]);
    });
  }
  it('R4: the turn.result fallback writes no row for an errored or interrupted turn', () => {
    for (const payload of [{ isError: true, subtype: 'success' }, { isError: false, subtype: 'error_during_execution' }, { isError: false, subtype: 'error_max_turns' }]) {
      const t = rig();
      t.commit(sent(1));
      t.commit(ev(assistantLine(offerReply('a', BLOCK))));
      expect(t.commit({ kind: 'turn.result', session: HSID, payload: { hsid: HSID, ...payload } })).toEqual([]);
      expect(t.suppressed).toEqual([]);
      // the next turn is evaluated normally
      t.commit(sent(2));
      t.commit(ev(assistantLine('plain')));
      t.commit({ kind: 'turn.result', session: HSID, payload: { hsid: HSID, subtype: 'success', isError: false } });
      expect(t.suppressed).toEqual([{ hsid: HSID, turn: `turn:${HSID}/2`, why: 'no-block' }]);
    }
  });
});

describe('#offer-router: an interleaved stream (review R1)', () => {
  const ev = (line: string): CommittedRow => ({ kind: 'turn.event', session: HSID, payload: { hsid: HSID, line } });
  const sent = (k: number): CommittedRow => ({ kind: 'turn.sent', session: HSID, payload: { hsid: HSID, turn: `turn:${HSID}/${k}` } });
  const resultOf = (k: number): CommittedRow => ({ kind: 'turn.result', session: HSID, payload: { hsid: HSID, turn: `turn:${HSID}/${k}`, subtype: 'success', isError: false } });
  const reply = (t: ReturnType<typeof rig>, id: string, text: string): RouterRow[] => [
    ...t.commit(ev(messageStartLine(id))),
    ...t.commit(ev(assistantLineOf(text, { id }))),
    ...t.commit(ev(messageDeltaLine('end_turn'))),
    ...t.commit(ev(messageStopLine())),
  ];
  it("turn 2's reply ends before turn 1's turn.result: turn 2 is evaluated for itself and its offer is shown", () => {
    const t = rig();
    t.commit(sent(1));
    expect(reply(t, 'msg_1', 'plain')).toEqual([]);
    t.commit(sent(2));
    const rows = reply(t, 'msg_2', offerReply('Here.', BLOCK));
    expect(rows.map((r) => r.kind)).toEqual(['offer.shown']);
    expect(rows[0]!.payload.replyTurnId).toBe(`turn:${HSID}/2`);
    expect(t.commit(resultOf(1))).toEqual([]);
    expect(t.commit(resultOf(2))).toEqual([]);
    expect(t.suppressed).toEqual([{ hsid: HSID, turn: `turn:${HSID}/1`, why: 'no-block' }]);
  });
  it("turn 1's turn.result does not clear the text of turn 2's message that already started (the fallback still sees it)", () => {
    const t = rig();
    t.commit(sent(1));
    reply(t, 'msg_1', 'plain');
    t.commit(sent(2));
    t.commit(ev(messageStartLine('msg_2')));
    t.commit(ev(assistantLineOf(offerReply('Here.', BLOCK), { id: 'msg_2' })));
    expect(t.commit(resultOf(1))).toEqual([]);
    // turn 2's end is never seen (no partial messages): turn.result evaluates its text
    const rows = t.commit(resultOf(2));
    expect(rows.map((r) => r.kind)).toEqual(['offer.shown']);
    expect(rows[0]!.payload.replyTurnId).toBe(`turn:${HSID}/2`);
  });
  it('an evaluated turn awaiting its turn.result does not count as streaming for the next reply', () => {
    const t = rig();
    t.commit(sent(1));
    reply(t, 'msg_1', 'plain');
    t.commit(sent(2));
    t.commit(sent(3)); // still streaming when turn 2 ends: that one does suppress
    reply(t, 'msg_2', offerReply('Here.', BLOCK));
    expect(t.suppressed.at(-1)).toEqual({ hsid: HSID, turn: `turn:${HSID}/2`, why: 'turn-streaming', name: BLOCK.mod, offerKind: BLOCK.kind });
  });
});

describe('#offer-router: a Stop-hook continuation replaces the evaluation (review R2)', () => {
  const ev = (line: string): CommittedRow => ({ kind: 'turn.event', session: HSID, payload: { hsid: HSID, line } });
  const sent = (k: number): CommittedRow => ({ kind: 'turn.sent', session: HSID, payload: { hsid: HSID, turn: `turn:${HSID}/${k}` } });
  const resultOf = (k: number): CommittedRow => ({ kind: 'turn.result', session: HSID, payload: { hsid: HSID, turn: `turn:${HSID}/${k}`, subtype: 'success', isError: false } });
  const replayOf = (text: string): string => JSON.stringify({ type: 'user', isReplay: true, parent_tool_use_id: null, message: { role: 'user', content: [{ type: 'text', text }] } });
  const reply = (t: ReturnType<typeof rig>, id: string, text: string): RouterRow[] => [
    ...t.commit(ev(messageStartLine(id))),
    ...t.commit(ev(assistantLineOf(text, { id }))),
    ...t.commit(ev(messageDeltaLine('end_turn'))),
    ...t.commit(ev(messageStopLine())),
  ];
  it('the end_turn evaluation runs at message_stop, not at message_delta', () => {
    const t = rig();
    t.commit(sent(1));
    t.commit(ev(messageStartLine('msg_1')));
    t.commit(ev(assistantLineOf(offerReply('a', BLOCK), { id: 'msg_1' })));
    expect(t.commit(ev(messageDeltaLine('end_turn')))).toEqual([]);
    expect(t.commit(ev(messageStopLine())).map((r) => r.kind)).toEqual(['offer.shown']);
  });
  for (const withReplays of [true, false]) {
    it(`a continuation message before turn.result retires the shown offer and its own end is evaluated (${withReplays ? 'replay lines' : 'no replay lines'})`, async () => {
      const t = rig();
      t.commit(sent(1));
      if (withReplays) t.commit(ev(replayOf('hi')));
      const first = reply(t, 'msg_1', offerReply('a', BLOCK));
      expect(first.map((r) => r.kind)).toEqual(['offer.shown']);
      const stale = first[0]!.payload.offerId as string;
      // the Stop hook blocked: Claude continues in the same turn
      const second = reply(t, 'msg_2', 'Fixed the purpose file.');
      // re-review M-2: the retirement is a kernel row (ids only), not only in memory
      expect(second).toEqual([{ kind: 'offer.retired', session: HSID, payload: { offerId: stale, hsid: HSID, why: 'continued' } }]);
      expect(t.suppressed).toEqual([{ hsid: HSID, turn: `turn:${HSID}/1`, why: 'no-block' }]);
      expect(t.commit(resultOf(1))).toEqual([]);
      await expect(t.r.decide(GUI, { offerId: stale, decision: 'open' })).rejects.toMatchObject({ refusal: { code: 'BAD_REQUEST', data: { reason: 'retired' } } });
    });
  }
  it('a Stop hook block line retires the offer at once', async () => {
    const t = rig();
    t.commit(sent(1));
    const first = reply(t, 'msg_1', offerReply('a', BLOCK));
    const rows = t.commit(ev(JSON.stringify({ type: 'system', subtype: 'hook_response', hook_event: 'Stop', exit_code: 2, outcome: 'error' })));
    expect(rows.map((r) => r.kind)).toEqual(['offer.retired']);
    await expect(t.r.decide(GUI, { offerId: first[0]!.payload.offerId, decision: 'open' })).rejects.toMatchObject({ refusal: { data: { reason: 'retired' } } });
  });
  it('re-review L-1: with replay lines a queued turn not yet consumed does not suppress the reply as streaming', () => {
    const t = rig();
    t.commit(sent(1));
    t.commit(ev(replayOf('hi')));
    t.commit(ev(messageStartLine('msg_1')));
    t.commit(ev(assistantLineOf(offerReply('a', BLOCK), { id: 'msg_1' })));
    t.commit(sent(2)); // queued: Claude Code has not replayed it
    expect(reply(t, 'msg_1', offerReply('a', BLOCK)).map((r) => r.kind)).toEqual(['offer.shown']);
    // without replay lines the same shape still counts turn 2 as streaming (started marks are not trustworthy)
    const u = rig();
    u.commit(sent(1));
    u.commit(ev(messageStartLine('msg_1')));
    u.commit(sent(2));
    expect(reply(u, 'msg_1', offerReply('a', BLOCK))).toEqual([]);
    expect(u.suppressed.map((x) => x.why)).toEqual(['turn-streaming']);
  });
  it('re-review L-1: with no replay lines a continuation of the newest evaluated turn stays in that turn', () => {
    const t = rig();
    t.commit(sent(1));
    reply(t, 'msg_1', 'plain');
    t.commit(sent(2));
    const shown = reply(t, 'msg_2', offerReply('b', BLOCK));
    expect(shown.map((r) => r.kind)).toEqual(['offer.shown']);
    expect(shown[0]!.payload.replyTurnId).toBe(`turn:${HSID}/2`);
    // the Stop hook continues turn 2 before either result: turn 2's offer is retired, turn 1 is untouched
    const cont = t.commit(ev(messageStartLine('msg_3')));
    expect(cont).toEqual([{ kind: 'offer.retired', session: HSID, payload: { offerId: shown[0]!.payload.offerId, hsid: HSID, why: 'continued' } }]);
  });
  it('re-review M-4: the Stop hook block match is exact (outcome blocked, decision block or exit_code 2)', () => {
    const hook = (o: Record<string, unknown>) => ev(JSON.stringify({ type: 'system', subtype: 'hook_response', hook_event: 'Stop', ...o }));
    for (const [o, retires] of [
      [{ outcome: 'blocked' }, true],
      [{ decision: 'block' }, true],
      [{ exit_code: 2, outcome: 'error' }, true],
      [{ outcome: 'non-blocking' }, false],
      [{ outcome: 'Blocked by policy' }, false],
      [{ exit_code: 0, outcome: 'success' }, false],
      [{ exit_code: 1, outcome: 'error' }, false],
    ] as const) {
      const t = rig();
      t.commit(sent(1));
      reply(t, 'msg_1', offerReply('a', BLOCK));
      expect(t.commit(hook(o)).map((r) => r.kind)).toEqual(retires ? ['offer.retired'] : []);
    }
  });
  it('re-review M-2: a decided offer is not retired by a continuation; seed() replays offer.retired after a restart', async () => {
    const t = rig();
    t.commit(sent(1));
    const first = reply(t, 'msg_1', offerReply('a', BLOCK));
    const id = first[0]!.payload.offerId as string;
    await t.r.decide(GUI, { offerId: id, decision: 'not-now' });
    expect(reply(t, 'msg_2', 'More.').filter((r) => r.kind === 'offer.retired')).toEqual([]);
    // a restart: the persistent rows seed a fresh router; the retired offer stays undecidable
    const t2 = rig();
    const shown = { ...first[0]!.payload };
    t2.r.seed([
      { kind: 'offer.shown', principal: KERNEL, session: HSID, payload: shown },
      { kind: 'offer.retired', principal: KERNEL, session: HSID, payload: { offerId: id, hsid: HSID, why: 'continued' } },
    ]);
    await expect(t2.r.decide(GUI, { offerId: id, decision: 'open' })).rejects.toMatchObject({ refusal: { data: { reason: 'retired' } } });
    // a non-kernel offer.retired is not folded
    const t3 = rig();
    t3.r.seed([
      { kind: 'offer.shown', principal: KERNEL, session: HSID, payload: shown },
      { kind: 'offer.retired', principal: HUMAN, session: HSID, payload: { offerId: id, hsid: HSID, why: 'continued' } },
    ]);
    await expect(t3.r.decide(GUI, { offerId: id, decision: 'not-now' })).resolves.toMatchObject({ decision: 'not-now' });
  });
  it('with replay lines, a queued message folded mid-turn settles the earlier turn without a row; the reply is evaluated for the folded-in turn', () => {
    const t = rig();
    t.commit(sent(3));
    t.commit(ev(replayOf('check')));
    t.commit(ev(messageStartLine('msg_a')));
    t.commit(ev(assistantLineOf('Running it.', { id: 'msg_a' })));
    t.commit(ev(messageDeltaLine('tool_use')));
    t.commit(ev(messageStopLine()));
    t.commit(sent(4));
    t.commit(ev(replayOf('so what happened?'))); // folded into turn 3
    const rows = reply(t, 'msg_b', offerReply('Here is what happened.', BLOCK));
    expect(rows.map((r) => r.kind)).toEqual(['offer.shown']);
    expect(rows[0]!.payload.replyTurnId).toBe(`turn:${HSID}/4`);
    expect(t.commit(resultOf(4))).toEqual([]);
    expect(t.suppressed).toEqual([]);
  });
});
