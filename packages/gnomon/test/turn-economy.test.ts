/**
 * #turn-economy: the pure fold, the live tally, and the no-text guarantee (orchestration design §12, Phase 0 item 1).
 */
import { describe, expect, it } from 'vitest';
import { EconomyTally, foldTurnEconomy, type EconomyRow } from '../src/kernel/desk/turn-economy.js';
import { HSID, KERNEL } from './desk-fixtures.js';

const T = (n: number): string => `turn:${HSID}/${n}`;
let seq = 0;
const row = (kind: string, payload: Record<string, unknown>): EconomyRow => ({ kind, payload, seq: ++seq, principal: KERNEL, session: HSID });
const open = (): EconomyRow => row('session.open', { hsid: HSID });
const sent = (n: number): EconomyRow => row('turn.sent', { hsid: HSID, turn: T(n) });
const usage = (i: number, o: number, cr: number, cw: number) => ({ input_tokens: i, output_tokens: o, cache_read_input_tokens: cr, cache_creation_input_tokens: cw });
const asst = (id: string, tools: Array<[string, string]>, u = usage(10, 5, 100, 20), extra: Record<string, unknown> = {}, model = 'claude-opus'): EconomyRow =>
  row('turn.event', {
    hsid: HSID, type: 'assistant', seq,
    line: JSON.stringify({ type: 'assistant', message: { id, model, usage: u, content: tools.map(([tid, name]) => ({ type: 'tool_use', id: tid, name, input: { secret: 'SECRET-TEXT' } })).concat([{ type: 'text', text: 'SECRET-REPLY' } as never]) }, ...extra }),
  });
const result = (split: Record<string, number> | null, turn?: string): EconomyRow => row('turn.result', { hsid: HSID, usage: { tokens: 1 }, ...(split ? { split } : {}), ...(turn ? { turn } : {}) });

describe('foldTurnEconomy', () => {
  it('counts distinct main-chain messages, explore before the first edit, cache share', () => {
    const f = foldTurnEconomy([
      open(), sent(1),
      asst('m1', [['t1', 'Read']]), asst('m1', [['t2', 'Grep']]), // one message, two content-block lines
      asst('m2', [['t3', 'Glob'], ['t4', 'Edit']]),
      asst('m3', [['t5', 'Read']]), // after the first edit: not exploring
      result({ in: 100, out: 50, cacheRead: 700, cacheWrite: 200 }),
    ]);
    expect(f.rows).toHaveLength(1);
    expect(f.rows[0]).toMatchObject({ hsid: HSID, turn: T(1), foldedTurns: 1, modelCalls: 3, preEditExplore: { read: 1, grep: 1, glob: 1 }, ctxAtStart: 130, ctxAtStartSource: 'firstCall', edited: true, conductorModel: 'claude-opus', cacheReadShare: 0.7 });
  });

  it('ctxAtStart is the previous turn\'s context, the first call\'s for the first turn of an epoch (a resume included)', () => {
    const f = foldTurnEconomy([
      open(), sent(1), asst('a', [], usage(10, 5, 1000, 0)), result(null),
      sent(2), asst('b', [], usage(10, 5, 2000, 0)), result(null),
      open(), sent(1), asst('c', [], usage(10, 5, 3000, 0)), result(null), // resumed: /1 again
      sent(2), asst('d', [], usage(10, 5, 4000, 0)), result(null),
    ]);
    expect(f.rows.map((r) => [r.turn, r.ctxAtStart, r.ctxAtStartSource])).toEqual([[T(1), 1010, 'firstCall'], [T(2), 1010, 'prev'], [T(1), 3010, 'firstCall'], [T(2), 3010, 'prev']]);
    // two rows for /1 and two for /2, told apart by the epoch (the seq of their session.open)
    expect(new Set(f.rows.map((r) => `${r.epoch}|${r.turn}`)).size).toBe(4);
    expect(f.rows[0]!.epoch).not.toBe(f.rows[2]!.epoch);
  });

  it('a queued turn folded into one result (num_turns 2) is one row naming the latest turn', () => {
    const f = foldTurnEconomy([open(), sent(1), asst('a', [['t1', 'Read']]), sent(2), asst('b', []), result({ in: 1, out: 1, cacheRead: 1, cacheWrite: 1 }, T(2)), sent(3), asst('c', []), result(null)]);
    expect(f.rows.map((r) => [r.turn, r.foldedTurns, r.modelCalls, r.excludeFromMedians])).toEqual([[T(2), 2, 2, true], [T(3), 1, 1, false]]);
  });

  it('a result without turn pairs FIFO; a result with no outstanding turn makes no row', () => {
    const f = foldTurnEconomy([open(), sent(1), result(null), result(null)]);
    expect(f.rows.map((r) => r.turn)).toEqual([T(1)]);
    expect(f.coverage.unpaired).toBe(1);
  });

  it('subagent lines (parent_tool_use_id) fold by message.model, once per message, never into the main chain', () => {
    const f = foldTurnEconomy([
      open(), sent(1),
      asst('main', [['t1', 'Task']], usage(10, 5, 100, 0), {}, 'claude-opus'),
      asst('s1', [['t2', 'Read']], usage(1, 1, 10, 0), { parent_tool_use_id: 'toolu_x' }, 'claude-haiku'),
      asst('s1', [['t3', 'Grep']], usage(1, 1, 10, 0), { parent_tool_use_id: 'toolu_x' }, 'claude-haiku'), // same message again
      asst('s2', [], usage(2, 3, 5, 0), { parent_tool_use_id: 'toolu_x' }, 'claude-sonnet'),
      result(null),
    ]);
    expect(f.rows[0]).toMatchObject({ modelCalls: 1, subagentTokensByModel: { 'claude-haiku': 12, 'claude-sonnet': 10 }, subagentUncachedByModel: { 'claude-haiku': 2, 'claude-sonnet': 5 }, preEditExplore: { read: 0, grep: 0, glob: 0 } });
  });

  it('a truncated (hash-only) line lowers coverage and is never counted as a call or a tool', () => {
    const f = foldTurnEconomy([
      open(), sent(1),
      asst('m1', [['t1', 'Read']]),
      row('turn.event', { hsid: HSID, type: 'assistant', seq: 9, lineHash: 'sha256:abc', bytes: 70_000 }),
      row('turn.event', { hsid: HSID, type: 'control_request.can_use_tool', seq: 10, lineHash: 'sha256:def', bytes: 100 }),
      row('turn.event', { hsid: HSID, type: 'system.hook_response', seq: 11, line: '{"type":"system"}', lineHash: 'h', bytes: 5, lineKept: { dropped: ['output'] } }),
      result(null),
    ]);
    expect(f.rows[0]).toMatchObject({ modelCalls: 1, preEditExplore: { read: 1, grep: 0, glob: 0 }, lines: 3, truncatedLines: 2, hashOnly: 2, truncatedAssistant: 1, excludeFromMedians: true });
    expect(f.coverage).toEqual({ lines: 3, truncated: 2, truncatedAssistant: 1, unpaired: 0, unpairedLines: 0, share: 1 / 3 });
  });

  it('no row has a text field: only ids and numbers', () => {
    const f = foldTurnEconomy([open(), sent(1), asst('m1', [['t1', 'Read']]), asst('s', [], usage(1, 1, 1, 1), { parent_tool_use_id: 'x' }), result({ in: 1, out: 1, cacheRead: 1, cacheWrite: 1 })]);
    const walk = (v: unknown, path: string): void => {
      if (v !== null && typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(x, `${path}.${k}`);
      else if (typeof v === 'string') expect(['$.hsid', '$.turn', '$.subagentTokensByModel', '$.subagentUncachedByModel', '$.conductorModel', '$.ctxAtStartSource'].some((ok) => path === ok || path.startsWith(`${ok}.`))).toBe(true);
    };
    for (const r of f.rows) walk(r, '$');
    expect(JSON.stringify(f)).not.toContain('SECRET');
  });

  it('ignores rows of another principal when a kernel principal is given', () => {
    const f = foldTurnEconomy([{ ...open(), principal: 'p:evil/x' }, { ...sent(1), principal: 'p:evil/x' }, { ...result(null), principal: 'p:evil/x' }], { kernelPrincipal: KERNEL });
    expect(f.rows).toEqual([]);
  });
});

describe('turn.economy review fixes', () => {
  it('per-call context: ctxMax, callsOver140k and a bounded histogram', () => {
    const big = (id: string, ctx: number) => asst(id, [], usage(0, 1, ctx, 0));
    const f = foldTurnEconomy([open(), sent(1), big('a', 10_000), big('b', 60_000), big('b', 61_000), big('c', 150_000), big('d', 250_000), result(null)]);
    const r = f.rows[0]!;
    expect(r).toMatchObject({ modelCalls: 4, ctxMax: 250_000, callsOver140k: 2, ctxAtStart: 10_000 });
    expect(r.ctxHistogram).toEqual([1, 0, 1, 0, 1, 1]); // <20k, <50k, <100k, <140k, <200k, open
  });

  it('records the conductor model and the uncached subagent tokens, models sanitised, __proto__ safe', () => {
    const f = foldTurnEconomy([
      open(), sent(1), asst('m', [], usage(1, 1, 1, 1), {}, 'claude-opus-4'),
      asst('s1', [], usage(3, 4, 100, 100), { parent_tool_use_id: 'x' }, '__proto__'),
      asst('s2', [], usage(1, 1, 0, 0), { parent_tool_use_id: 'x' }, 'bad model\nname'),
      asst('s3', [], usage(1, 1, 0, 0), { parent_tool_use_id: 'x' }, 'constructor'),
      result(null),
    ]);
    const r = f.rows[0]!;
    expect(r.conductorModel).toBe('claude-opus-4');
    expect(Object.keys(r.subagentTokensByModel).sort()).toEqual(['__proto__', 'constructor', 'unknown']);
    expect(r.subagentUncachedByModel['__proto__']).toBe(7);
    expect(Object.getPrototypeOf(r.subagentTokensByModel)).toBe(Object.prototype);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('truncation attribution: hash-only, oversize and unparseable lines flag the row; they are never read', () => {
    const f = foldTurnEconomy([
      open(), sent(1), asst('m', []),
      row('turn.event', { hsid: HSID, type: 'assistant', line: '{not json' }),
      row('turn.event', { hsid: HSID, type: 'assistant', line: ' '.repeat(64 * 1024 + 1) }),
      result(null),
    ]);
    expect(f.rows[0]).toMatchObject({ modelCalls: 1, lines: 3, truncatedLines: 2, hashOnly: 0, truncatedAssistant: 2, excludeFromMedians: true });
  });

  it('a turn that ended with no result (a drain, then a resume) does not roll its lines into the resumed turn', () => {
    const f = foldTurnEconomy([open(), sent(1), asst('a', [['t1', 'Read']], usage(0, 1, 500, 0)), open(), sent(1), asst('b', [['t2', 'Glob']]), result(null)]);
    expect(f.rows).toHaveLength(1);
    expect(f.rows[0]).toMatchObject({ modelCalls: 1, preEditExplore: { read: 0, grep: 0, glob: 1 } });
    expect(f.coverage.unpaired).toBe(1);
  });

  it('a late background subagent line after the result is dropped and counted, not folded into the next turn', () => {
    const f = foldTurnEconomy([
      open(), sent(1), asst('a', []), result(null),
      asst('late', [], usage(1, 1, 1, 1), { parent_tool_use_id: 'x' }, 'claude-haiku'),
      sent(2), asst('b', []), result(null),
    ]);
    expect(f.rows[1]).toMatchObject({ turn: T(2), subagentTokensByModel: {} });
    expect(f.coverage.unpairedLines).toBe(1);
  });

  it('Bash rg / grep counts as grep without keeping the command; other Bash does not', () => {
    const bash = (id: string, command: string): EconomyRow => row('turn.event', { hsid: HSID, type: 'assistant', line: JSON.stringify({ type: 'assistant', message: { id, content: [{ type: 'tool_use', id: `t${id}`, name: 'Bash', input: { command } }] } }) });
    const f = foldTurnEconomy([open(), sent(1), bash('1', 'rg foo src'), bash('2', 'cat x | grep -n y'), bash('3', 'echo grep'), bash('4', 'ls'), result(null)]);
    expect(f.rows[0]).toMatchObject({ preEditExplore: { read: 0, grep: 2, glob: 0 }, edited: false });
    expect(JSON.stringify(f)).not.toContain('foo');
  });
});

describe('EconomyTally', () => {
  it('seeds from the human projection on first read, then follows commits, deduplicating by seq', () => {
    const all = [open(), sent(1), asst('m1', [['t1', 'Read']]), result(null)];
    const listeners: Array<(e: { seq: number; kind: string; principal?: string; session?: string; payload?: unknown }) => void> = [];
    const committed = all.slice(0, 3);
    const log = {
      read: () => [...committed.map((r) => ({ seq: r.seq!, view: 'full', event: { kind: r.kind, payload: r.payload, principal: r.principal, session: r.session } })), { seq: 99_999, view: 'hashed', event: { kind: 'turn.event', payload: {} } }],
      onCommit: (l: (typeof listeners)[number]) => (listeners.push(l), () => void listeners.splice(0)),
    };
    const t = new EconomyTally({ log, kernelPrincipal: KERNEL });
    listeners[0]!({ seq: all[3]!.seq!, kind: all[3]!.kind, principal: KERNEL, session: HSID, payload: all[3]!.payload }); // before the first read: kept out
    expect(t.stats().rows).toEqual([]);
    listeners[0]!({ seq: all[3]!.seq!, kind: all[3]!.kind, principal: KERNEL, session: HSID, payload: all[3]!.payload });
    listeners[0]!({ seq: all[3]!.seq!, kind: all[3]!.kind, principal: KERNEL, session: HSID, payload: all[3]!.payload }); // replayed seq
    const s = t.stats();
    expect(s.rows).toHaveLength(1);
    expect(s.rows[0]).toMatchObject({ modelCalls: 1, preEditExplore: { read: 1, grep: 0, glob: 0 } });
    t.close();
    expect(listeners).toHaveLength(0);
  });
});

describe('EconomyTally cap', () => {
  it('trims in batches past the cap without losing the newest rows', () => {
    const listeners: Array<(e: { seq: number; kind: string; principal?: string; session?: string; payload?: unknown }) => void> = [];
    const t = new EconomyTally({ log: { read: () => [], onCommit: (l) => (listeners.push(l), () => undefined) }, kernelPrincipal: KERNEL });
    t.stats();
    let n = 0;
    const emit = (kind: string, payload: Record<string, unknown>) => listeners[0]!({ seq: ++n, kind, principal: KERNEL, session: HSID, payload });
    emit('session.open', { hsid: HSID });
    for (let i = 1; i <= 52_000; i++) {
      emit('turn.sent', { hsid: HSID, turn: T(i) });
      emit('turn.result', { hsid: HSID });
    }
    const rows = t.stats().rows;
    expect(rows).toHaveLength(50_000);
    expect(rows[rows.length - 1]!.turn).toBe(T(52_000));
  });
});
