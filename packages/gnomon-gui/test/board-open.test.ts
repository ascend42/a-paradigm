/**
 * #gui-board-open (boards S1.3 pass P4b-1): the opening rules as pure plans, the Dimensions list rows, and the ONE
 * store `followLog` is handed, which feeds both the GUI store and the dimension sessions and resets both.
 */
import { describe, expect, it } from 'vitest';
import { boardTitleOf, dimensionRows, followBoth, listRepoOf, listTime, openedHowOf, parseBoardCommand, planBoardCommand, planBoardKey, planBoardMenu, planBoardRow, type BoardAsk } from '../src/core/board-open.js';
import { followLog, RpcError } from '../src/core/client.js';
import type { DimListing } from '../src/core/dim-store.js';

const DIM = 'dim:01JF1XTVRE000000000000000D';
const listing = (o: Partial<DimListing> = {}): DimListing => ({ dim: DIM, title: 'auth handoff', repo: 'repo:aa', firstSeq: 3, lastSeq: 9, rows: 4, nodes: 2, ended: false, attached: ['hs-1'], firstAt: '2026-11-24T14:02:00.000Z', lastAt: '2026-11-24T14:09:00.000Z', partial: false, ...o });
const ask = (o: Partial<BoardAsk> = {}): BoardAsk => ({ hsid: 'hs-1', lastDim: null, last: null, sessionName: 'Totals are off', mintDim: () => 'dim:01NEW00000000000000000000A', ...o });

describe('#gui-board-open: how a board is opened', () => {
  it('/board with no board yet makes one titled with the session (titleFrom session); with one, it reopens the last', () => {
    expect(planBoardCommand(ask())).toEqual({ type: 'new', dim: 'dim:01NEW00000000000000000000A', title: 'Totals are off', titleFrom: 'session' });
    expect(planBoardCommand(ask({ lastDim: DIM, last: listing() }))).toEqual({ type: 'open', dim: DIM, attach: false, reopens: false, title: 'auth handoff' });
    expect(planBoardMenu(ask({ lastDim: DIM, last: listing() }))).toEqual(planBoardCommand(ask({ lastDim: DIM, last: listing() })));
    // a session with no name still gets a title
    expect(planBoardCommand(ask({ sessionName: '  ' }))).toMatchObject({ type: 'new', title: 'Board', titleFrom: 'session' });
  });
  it('/board <title> names a NEW one (titleFrom user), whatever the session already has; the title is one line, cut at the limit', () => {
    expect(planBoardCommand(ask({ lastDim: DIM, last: listing() }), '  plan\tB  ')).toEqual({ type: 'new', dim: 'dim:01NEW00000000000000000000A', title: 'plan B', titleFrom: 'user' });
    expect(boardTitleOf('x'.repeat(300))).toHaveLength(120);
  });
  it('an ended dimension says it reopens; a dimension this session is not attached to is attached then opened on the same press', () => {
    expect(planBoardCommand(ask({ lastDim: DIM, last: listing({ ended: true }) }))).toMatchObject({ type: 'open', reopens: true });
    expect(planBoardRow(listing({ attached: ['hs-other'] }), 'hs-1')).toEqual({ type: 'open', dim: DIM, attach: true, reopens: false, title: 'auth handoff' });
    expect(planBoardRow(listing({ ended: true }), 'hs-1')).toMatchObject({ attach: false, reopens: true });
  });
  it('⌥B only reopens: with no board it does nothing; with no session nothing opens at all', () => {
    expect(planBoardKey(ask())).toEqual({ type: 'none', why: 'no-board' });
    expect(planBoardKey(ask({ lastDim: DIM, last: listing() }))).toMatchObject({ type: 'open', dim: DIM });
    for (const plan of [planBoardCommand(ask({ hsid: null })), planBoardKey(ask({ hsid: null })), planBoardRow(listing(), null), planBoardCommand(ask({ hsid: null }), 'x')]) expect(plan).toEqual({ type: 'none', why: 'no-session' });
  });
  it('opened is `command` for a typed command and `menu` for a pointer entry and for ⌥B (no other value: the enum is hashed)', () => {
    expect([openedHowOf({ type: 'keydown' }), openedHowOf({ type: 'click' }), openedHowOf({ type: 'keydown' }, true), openedHowOf({ type: 'pointerup' })]).toEqual(['command', 'menu', 'menu', 'menu']);
  });
  it('the composer text: /board, /board <title>, /boards; nothing else', () => {
    expect(parseBoardCommand('/board')).toEqual({ cmd: 'board', arg: '' });
    expect(parseBoardCommand(' /board  plan B ')).toEqual({ cmd: 'board', arg: 'plan B' });
    expect(parseBoardCommand('/boards')).toEqual({ cmd: 'boards', arg: '' });
    for (const t of ['/boarding', 'a /board', '/board\nmore', 'board', '/boardsx']) expect(parseBoardCommand(t), t).toBeNull();
  });
});

describe('#gui-board-open: the Dimensions list', () => {
  const now = Date.parse('2026-11-24T18:00:00.000Z');
  it('prints the time from lastAt, says ended and partly held, newest first; a dimension still opening at link loss is listed', () => {
    const at = new Date(Date.parse('2026-11-24T14:09:00.000Z'));
    const hhmm = `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`;
    const rows = dimensionRows([listing(), listing({ dim: 'dim:01OTHER000000000000000000B', title: 'older', lastSeq: 5, ended: true, partial: true, attached: [] })], 'hs-1', [{ dim: 'dim:01PEND0000000000000000000C', title: 'still opening' }, { dim: DIM, title: 'known already' }], now);
    expect(rows.map((r) => [r.title, r.time, r.notes])).toEqual([
      ['still opening', '', ['was opening when the link went']],
      ['auth handoff', hhmm, []],
      ['older', hhmm, ['folded', 'partly held', 'not this session’s yet']],
    ]);
    expect(listTime('2026-11-20T14:09:00.000Z', now)).toMatch(/^Nov (19|20|21)$/);
    expect(listTime(null, now)).toBe('');
    expect(listTime('not a time', now)).toBe('');
  });
  it('the list is of the repo of a dimension the session is attached to, else the session’s own repo when the store knows it', () => {
    expect(listRepoOf([listing()], 'hs-1', null)).toBe('repo:aa');
    expect(listRepoOf([listing({ attached: [] })], 'hs-1', 'repo:aa')).toBe('repo:aa');
    expect(listRepoOf([listing({ attached: [] })], 'hs-1', '/Users/x/billing')).toBeNull();
  });
});

describe('#gui-board-open: followBoth, the one store followLog is handed', () => {
  const make = () => {
    const calls: string[] = [];
    let cursor: { logId: string; seq: number } | null = null;
    const gui = { cursor: () => cursor, adopt: (id: string) => void calls.push(`gui.adopt ${id}`), apply: (rows: unknown[]) => void calls.push(`gui.apply ${rows.length}`), advance: (n: number) => void ((cursor = { logId: 'L', seq: n }), calls.push(`gui.advance ${n}`)), reset: () => void ((cursor = null), calls.push('gui.reset')) };
    const dims = { apply: (rows: readonly unknown[]) => void calls.push(`dims.apply ${rows.length}`), reset: () => void calls.push('dims.reset') };
    return { calls, both: followBoth(gui, dims) };
  };
  it('every row the GUI store takes also goes to the sessions, GUI first; a reset resets both; the cursor is the GUI store’s', () => {
    const { calls, both } = make();
    both.apply([{ seq: 1 }, { seq: 2 }]);
    both.adopt('L');
    both.advance(2);
    both.reset();
    expect(calls).toEqual(['gui.apply 2', 'dims.apply 2', 'gui.adopt L', 'gui.advance 2', 'gui.reset', 'dims.reset']);
    expect(both.cursor()).toBeNull();
  });
  it('through the real followLog: each backlog page reaches both, and a cursor-epoch refusal resets both before the re-read', async () => {
    const { calls, both } = make();
    let reads = 0;
    const client = {
      call: async (_method: string, params?: { follow?: boolean }) => {
        if (params?.follow) return { logId: 'L2' };
        reads += 1;
        if (reads === 1) return { logId: 'L', rows: [{ seq: 1 }, { seq: 2 }], next: 2, caughtUp: false };
        // the log was replaced under the cursor: the kernel refuses, the page clears BOTH stores and reads again
        if (reads === 2) throw new RpcError({ code: 'BAD_REQUEST', reason: 'cursor-epoch', message: 'the log was replaced', next: [] } as never);
        return { logId: 'L2', rows: [{ seq: 1 }], next: 1, caughtUp: true };
      },
    };
    await followLog(client as never, both as never);
    expect(calls).toEqual(['gui.adopt L', 'gui.apply 2', 'dims.apply 2', 'gui.advance 2', 'gui.reset', 'dims.reset', 'gui.adopt L2', 'gui.apply 1', 'dims.apply 1', 'gui.advance 1', 'gui.adopt L2']);
  });
});
