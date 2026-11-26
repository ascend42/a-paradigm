/**
 * #dim-cli (S1.3 P2; spec §12.7; scale amendment A9): `gnomon dim replay` and `gnomon dim stats`, the pure half.
 * The folds, the printed lines and the argument handling run on every platform here; the same commands over a
 * real verified log (kernel keys under the home) are in test/dimension-relay.test.ts.
 */
import * as fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { DIM_KINDS, dimHash, foldDim, type DimRow } from '@a-company/gnomon-contracts';
import { DIM_STATS_UNDO_NOTE, DIM_USAGE, foldDimStats, replayDim, replayLines, runDimCommand, statsReadout, stripControl, stripControlDeep, sumDimStats, type DimCliRow } from '../src/cli/dim-cli.js';
import { PKG_ROOT } from './helpers.js';
import { dimId, rectOp, ulid } from './dimension-helpers.js';

const A = 'hsid:v1:01HZZZZZZZZZZZZZZZZZZZZZZA';
const B = 'hsid:v1:01HZZZZZZZZZZZZZZZZZZZZZZB';
const GUI = { principal: 'p:00000000/founder', connId: 'conn:1', surface: 'gui' };
const AGENT = { principal: 'p:00000000/s-01hzzzzz', surface: 'bridge', agent: 'kit', hsid: A, turn: `turn:${A}/1` };
const VOICE = { ...AGENT, surface: 'voice' };
const CONTROL = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u;

const io = () => {
  const out: string[] = [];
  const err: string[] = [];
  return { io: { stdout: { write: (s: string) => out.push(s) }, stderr: { write: (s: string) => err.push(s) } }, out, err };
};

describe('gnomon dim replay (S1.3; Aegis: replay output is stripped of control characters)', () => {
  const D = dimId(1);
  const HOSTILE = 'line one\nREFUSED  FORGED  line\u001b[2J\u001b]0;title\u0007 \u202egnp.exe\u2028next\u200b';
  const rows: DimRow[] = [
    { seq: 3, kind: DIM_KINDS.start, payload: { v: 1, dim: D, title: `Plan\u001b[31m\nfake`, attached: [A], opened: 'command', relayedFor: GUI } },
    { seq: 4, kind: DIM_KINDS.op, payload: { v: 1, dim: D, ops: [{ type: 'add', node: { id: ulid(1), kind: 'text', x: 1, y: 2, z: 'V', text: HOSTILE } }, rectOp(2, { label: 'ok\r\nlabel' })], relayedFor: GUI } },
    { seq: 5, kind: DIM_KINDS.op, payload: { v: 1, dim: D, ops: [{ type: 'add', node: { id: ulid(3), kind: 'acme:widget\u0007', x: 5, y: 5, z: 'W', secret: 'carried\u001b[0m' } }], relayedFor: { ...AGENT, agent: 'kit\u001b[1m\nroot' } } },
    { seq: 6, kind: DIM_KINDS.op, payload: { v: 1, dim: D, ops: [rectOp(4)] } },
  ];

  it('stripControl removes control, format, line-separator and paragraph-separator code points, at any depth for --json', () => {
    expect(stripControl(HOSTILE)).toBe('line oneREFUSED  FORGED  line[2J]0;title gnp.exenext');
    expect(CONTROL.test(stripControl(HOSTILE))).toBe(false);
    const deep = stripControlDeep(JSON.parse('{"k\\u001b":["a\\nb",{"x\\u202e":"c\\u0000d","n":7}],"ok":true,"__proto__":{"evil":1}}')) as Record<string, unknown>;
    expect(JSON.parse(JSON.stringify(deep))).toEqual(JSON.parse('{"k":["ab",{"x":"cd","n":7}],"ok":true,"__proto__":{"evil":1}}'));
    // a key read from the log stays a key: it never becomes a prototype
    expect([Object.getPrototypeOf(deep), Object.keys(deep), (deep as { evil?: unknown }).evil]).toEqual([null, ['k', 'ok', '__proto__'], undefined]);
    expect(CONTROL.test(JSON.stringify(deep))).toBe(false);
  });

  it('the printed lines carry no control character: a mark cannot forge a line or steer a terminal; a carried field is never printed', () => {
    const state = replayDim(rows, D);
    const lines = replayLines(state);
    const text = [...lines.head.map(([l, v]) => `${l}  ${v}`), ...lines.marks].join('\n');
    for (const line of text.split('\n')) expect([line, CONTROL.test(line)]).toEqual([line, false]);
    expect(lines.marks).toHaveLength(4);
    expect(lines.head).toContainEqual(['title', 'Plan[31mfake']);
    expect(lines.head).toContainEqual(['hash', dimHash(foldDim(rows))]);
    expect(lines.marks.some((m) => m.includes('by human (p:00000000/founder)') && m.includes('line oneREFUSED'))).toBe(true);
    // a person's forensic replay: the valid principal is shown, the agent label outside its pattern is not
    expect(lines.marks.some((m) => m.includes('(fallback)') && m.includes(`by agent (label not shown) (${AGENT.principal})`))).toBe(true);
    expect(text.includes('kit')).toBe(false);
    expect(lines.marks.some((m) => m.includes('by unknown hand'))).toBe(true);
    expect(text.includes('carried')).toBe(false);
    // --to stops the fold after that seq
    expect([replayDim(rows, D, 4).nodes.size, replayDim(rows, D, 3).nodes.size, replayDim(rows, D, 2).seq]).toEqual([2, 0, 0]);
  });

  it('G-DDL-01 for the CLI: a 10,000-op log replays with ONE foldDim from the first row, each row read once; a scrub to a seq reads no row past it', () => {
    const N = 10_000;
    const all: DimRow[] = [{ seq: 1, kind: DIM_KINDS.start, payload: { v: 1, dim: D, title: 'Big', attached: [A], opened: 'command', relayedFor: GUI } }];
    for (let i = 0; i < N; i++) all.push({ seq: i + 2, kind: DIM_KINDS.op, payload: { v: 1, dim: D, ops: [i % 10 === 9 ? { type: 'delete', id: ulid(i - 1) } : rectOp(i)], relayedFor: GUI } });
    let passes = 0;
    let reads = 0;
    const counted: Iterable<DimRow> = {
      [Symbol.iterator]: () => {
        passes += 1;
        let i = 0;
        return { next: () => (i < all.length ? ((reads += 1), { done: false, value: all[i++]! }) : { done: true, value: undefined }) };
      },
    };
    const state = replayDim(counted, D);
    expect([passes, reads]).toEqual([1, N + 1]);
    expect([state.ops, state.seq, state.nodes.size, state.gone.size, state.unapplied]).toEqual([N, N + 1, 8000, 1000, 0]);
    expect(dimHash(state)).toBe(dimHash(foldDim(all)));
    // scrub to 20 seqs: one pass each, and the fold stops at the first row past the seq
    for (let k = 1; k <= 20; k++) {
      const to = k * 500;
      passes = 0;
      reads = 0;
      const at = replayDim(counted, D, to);
      expect([to, passes, reads, at.seq]).toEqual([to, 1, to + 1, to]);
    }
    // work is counted, not timed (no latency claim is made here); and the CLI never folds row by row
    const src = fs.readFileSync(path.join(PKG_ROOT, 'src', 'cli', 'dim-cli.ts'), 'utf8');
    expect(/foldDimRow\s*\(/.test(src)).toBe(false);
  });

  it('arguments: usage, an unknown verb, a missing or malformed dimension and a bad --to are refused without echoing the argument', async () => {
    const help = io();
    expect(await runDimCommand(['--help'], help.io)).toBe(0);
    expect(help.out.join('')).toBe(DIM_USAGE);
    const none = io();
    expect(await runDimCommand([], none.io)).toBe(64);
    for (const argv of [['zap\u001b[2J'], ['replay'], ['replay', 'dim:nope\u001b[2J'], ['replay', D, '--to', 'x\u001b'], ['replay', D, '--to'], ['stats', '--to', '3'], ['stats', 'relative/home\u0007']]) {
      const w = io();
      expect([argv, await runDimCommand(argv, w.io)]).toEqual([argv, 64]);
      expect(w.out).toEqual([]);
      expect(w.err.join('')).toMatch(/^REFUSED {2}USAGE {2}/);
      expect(CONTROL.test(w.err.join('').replace(/\n/g, ''))).toBe(false);
    }
  });
});

describe('gnomon dim stats: the five A9 signals on a fixture log', () => {
  const D1 = dimId(1);
  const D2 = dimId(2);
  const T0 = Date.parse('2026-11-24T10:00:00.000Z');
  const at = (ms: number): string => new Date(T0 + ms).toISOString();
  let seq = 0;
  const row = (kind: string, ms: number, payload: Record<string, unknown>): DimCliRow => ({ seq: ++seq, kind, at: at(ms), payload: { v: 1, ...payload } });
  const arrow = (n: number, from: string) => ({ type: 'add', node: { id: ulid(n), kind: 'arrow', x: 0, y: 0, z: 'V', points: [0, 0, 1, 1], from } });
  const rows: DimCliRow[] = [
    row(DIM_KINDS.start, 0, { dim: D1, title: 'One', attached: [A], opened: 'command', relayedFor: GUI }),
    row(DIM_KINDS.op, 1_000, { dim: D1, ops: [rectOp(1), rectOp(2)], relayedFor: GUI }),
    // the agent draws two marks, one of them pointing at the human's mark 1: a round trip
    row(DIM_KINDS.op, 2_000, { dim: D1, ops: [arrow(10, ulid(1)), rectOp(11)], relayedFor: AGENT }),
    // an agent row that cites only its own mark is not one
    row(DIM_KINDS.op, 3_000, { dim: D1, ops: [{ type: 'move', ids: [ulid(11)], dx: 1, dy: 1 }], relayedFor: AGENT }),
    // the human deletes agent mark 11, then undoes: the mark comes back under a new id, as a HUMAN mark (Aegis B3)
    row(DIM_KINDS.op, 4_000, { dim: D1, ops: [{ type: 'delete', id: ulid(11) }], relayedFor: GUI }),
    row(DIM_KINDS.op, 5_000, { dim: D1, ops: [rectOp(12)], relayedFor: GUI }),
    row(DIM_KINDS.end, 300_000, { dim: D1, ops: 7, nodes: 4 }),
    // reopened from the menu; a second session attaches; the GUI row after it belongs to that session
    row(DIM_KINDS.start, 400_000, { dim: D1, attached: [A], opened: 'menu', relayedFor: GUI }),
    row(DIM_KINDS.attach, 401_000, { dim: D1, hsid: B, relayedFor: GUI }),
    row(DIM_KINDS.op, 402_000, { dim: D1, ops: [rectOp(3)], relayedFor: GUI }),
    row(DIM_KINDS.op, 403_000, { dim: D1, ops: [rectOp(20)], relayedFor: VOICE }),
    // a row with no stamp: the unknown hand, neither human nor agent
    row(DIM_KINDS.op, 404_000, { dim: D1, ops: [rectOp(30)] }),
    row(DIM_KINDS.end, 405_000, { dim: D1, ops: 10, nodes: 7 }),
    // D2: opened by an offer and closed 10 s later untouched; reopened, an agent draws, closed 10 s later: both quick, no human op
    row(DIM_KINDS.start, 500_000, { dim: D2, title: 'Two', attached: [A], opened: 'offer', relayedFor: GUI }),
    row(DIM_KINDS.end, 510_000, { dim: D2, ops: 0, nodes: 0 }),
    row(DIM_KINDS.start, 520_000, { dim: D2, attached: [A], opened: 'offer', relayedFor: GUI }),
    row(DIM_KINDS.op, 521_000, { dim: D2, ops: [rectOp(40)], relayedFor: AGENT }),
    row(DIM_KINDS.end, 530_000, { dim: D2, ops: 1, nodes: 1 }),
    // a third span with a human op inside the minute is not counted
    row(DIM_KINDS.start, 600_000, { dim: D2, attached: [A], opened: 'command', relayedFor: GUI }),
    row(DIM_KINDS.op, 601_000, { dim: D2, ops: [rectOp(41)], relayedFor: GUI }),
    row(DIM_KINDS.end, 602_000, { dim: D2, ops: 2, nodes: 2 }),
    // rows that are not a dimension's are ignored
    { seq: ++seq, kind: 'turn.event', payload: { dim: D1 } },
    { seq: ++seq, kind: DIM_KINDS.op, payload: 'not an object' },
  ];

  it('per dimension: reopens, agent-mark survival, round trips, voice co-occurrence, closed inside a minute with no human op, and ops by session', () => {
    const per = foldDimStats(rows);
    expect(Object.keys(per).sort()).toEqual([D1, D2].sort());
    expect(per[D1]).toEqual({
      rows: 13,
      reopens: 1,
      openedBy: { command: 1, menu: 1 },
      // the agent added 10, 11 and (by voice) 20; 11 was deleted and came back as a human mark
      agentMarks: { added: 3, surviving: 2 },
      roundTrips: 1,
      voice: { rows: 1, withHumanRows: true },
      closedQuick: 0,
      // one session attached: A. After B attaches, a GUI row has no stamped session: the nearest preceding attach row names it
      opsBySession: { [A]: 6, [B]: 2 },
    });
    expect(per[D2]).toEqual({ rows: 8, reopens: 2, openedBy: { command: 1, offer: 2 }, agentMarks: { added: 1, surviving: 1 }, roundTrips: 0, voice: { rows: 0, withHumanRows: false }, closedQuick: 2, opsBySession: { [A]: 2 } });
    const total = sumDimStats(per);
    expect(total).toMatchObject({ dimensions: 2, rows: 21, reopens: 3, agentMarks: { added: 4, surviving: 3 }, roundTrips: 1, closedQuick: 2, voiceWithHuman: 1 });
  });

  it('the stamped session of a tool row wins over the attach rows, and one fold per dimension decides what survives', () => {
    const per = foldDimStats(rows);
    // the voice row carries hsid A although B attached last
    expect(per[D1]!.opsBySession[A]).toBe(6);
    const text = statsReadout(per[D1]!).map(([l, v]) => `${l}  ${v}`).join('\n');
    expect(text).toContain('agent marks  2 of 3 still on the board');
    expect(text).toContain('voice rows  1 (beside human rows)');
    expect(DIM_STATS_UNDO_NOTE).toContain("undoing a delete of an agent's mark adds it again as a human mark");
    const src = fs.readFileSync(path.join(PKG_ROOT, 'src', 'cli', 'dim-cli.ts'), 'utf8');
    expect(src.match(/\bfoldDim\(/g)!.length).toBeLessThanOrEqual(3); // replay, the hand probe, the per-dimension survival fold
  });

  it('rows without a time are never counted as closed quickly, and an empty log folds to nothing', () => {
    const untimed = rows.filter((r) => (r.payload as { dim?: string }).dim === D2).map(({ at: _at, ...r }) => r);
    expect(foldDimStats(untimed)[D2]!.closedQuick).toBe(0);
    expect(foldDimStats([])).toEqual({});
    expect(sumDimStats({})).toMatchObject({ dimensions: 0, rows: 0 });
  });

  it('L5: maps keyed by strings from the log have no prototype, so a session or dimension named __proto__ or constructor is counted like any other', () => {
    const rows: DimCliRow[] = [];
    let n = 0;
    for (const dim of ['__proto__', 'constructor', 'toString']) {
      rows.push({ seq: ++n, kind: DIM_KINDS.start, payload: JSON.parse(`{"v":1,"dim":"${dim}","title":"t","attached":["__proto__"],"opened":"__proto__"}`) });
      rows.push({ seq: ++n, kind: DIM_KINDS.attach, payload: { v: 1, dim, hsid: 'constructor' } });
      rows.push({ seq: ++n, kind: DIM_KINDS.op, payload: { v: 1, dim, ops: [rectOp(n)], relayedFor: GUI } });
      rows.push({ seq: ++n, kind: DIM_KINDS.op, payload: { v: 1, dim, ops: [rectOp(n)], relayedFor: { ...AGENT, hsid: '__proto__' } } });
    }
    const per = foldDimStats(rows);
    expect(Object.getPrototypeOf(per)).toBeNull();
    expect(Object.keys(per).sort()).toEqual(['__proto__', 'constructor', 'toString']);
    for (const dim of Object.keys(per)) {
      const s = per[dim]!;
      expect([Object.getPrototypeOf(s.opsBySession), Object.getPrototypeOf(s.openedBy)]).toEqual([null, null]);
      expect([dim, Object.keys(s.opsBySession).sort(), s.opsBySession['__proto__'], s.opsBySession.constructor, s.openedBy.unknown, s.rows]).toEqual([dim, ['__proto__', 'constructor'], 1, 1, 1, 4]);
    }
    const total = sumDimStats(per);
    expect([total.dimensions, total.rows, total.opsBySession['__proto__'], total.opsBySession.constructor]).toEqual([3, 12, 3, 3]);
    expect(({} as { rows?: unknown }).rows).toBeUndefined(); // nothing was set on Object.prototype
    const json = JSON.parse(JSON.stringify(stripControlDeep({ dimensions: per }))) as { dimensions: Record<string, unknown> };
    expect(Object.keys(json.dimensions).sort()).toEqual(['__proto__', 'constructor', 'toString']);
  });
});
