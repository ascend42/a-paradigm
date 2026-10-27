/**
 * #backend-adapter (spec §2.2): every adapter in BACKEND_ADAPTERS replays each of its fixture turns (recorded or synthetic) (kinds, types,
 * charged usage), parses any input without throwing, and never reads usage from model text.
 */
import { readdirSync, readFileSync } from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { BACKEND_ADAPTERS, claudeCodeAdapter, localAdapter, type AnyBackendAdapter, type BackendId, type DriverEvent, type UsageMeter } from '../src/adapters/index.js';
import { PKG_ROOT } from './helpers.js';

interface ReplayExpect {
  schema: 'gnomon-adapter-replay:v1';
  backend: BackendId;
  backendVersion: string;
  source: 'recorded' | 'synthetic';
  kinds: string[];
  types: string[];
  charged: number;
}

/** Each backend's fixture directory (src/adapters/<dir>/fixtures). */
const FIXTURE_DIRS: Record<BackendId, string> = { 'claude-code': 'claude-code', local: 'local' };
const ORACLE: Record<BackendId, string> = { 'claude-code': 'G-ADP-01', local: 'G-ADP-02' };

function fixturesOf(backend: BackendId): Array<{ name: string; lines: string[]; expect: ReplayExpect }> {
  const dir = path.join(PKG_ROOT, 'src', 'adapters', FIXTURE_DIRS[backend], 'fixtures');
  return readdirSync(dir)
    .filter((f) => f.endsWith('.jsonl'))
    .sort()
    .map((f) => ({
      name: f,
      lines: readFileSync(path.join(dir, f), 'utf8').split(/\r?\n/).filter(Boolean),
      expect: JSON.parse(readFileSync(path.join(dir, f.replace(/\.jsonl$/, '.expect.json')), 'utf8')) as ReplayExpect,
    }));
}

/** One fresh meter over the lines: each event's kind and type, and the tokens charged in all. */
function replayWith<E extends DriverEvent>(adapter: { parse(l: string): E; newMeter(): UsageMeter<E> }, lines: readonly string[]): { kinds: string[]; types: string[]; charged: number } {
  const m = adapter.newMeter();
  const kinds: string[] = [];
  const types: string[] = [];
  let charged = 0;
  for (const l of lines) {
    const ev = adapter.parse(l);
    kinds.push(ev.kind);
    types.push(ev.type);
    charged += m.charge(ev);
  }
  return { kinds, types, charged };
}
const replay = (adapter: AnyBackendAdapter, lines: readonly string[]) => (adapter.backend === 'claude-code' ? replayWith(adapter, lines) : replayWith(adapter, lines));

const MODEL_TEXT_KEYS = new Set(['text', 'content', 'delta', 'result', 'thinking']);
const POISON = ' input_tokens 99999 usage 77777';

/** Appends POISON to every string value held under a model-text key, at any depth. */
function poison(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(poison);
  if (v === null || typeof v !== 'object') return v;
  return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, typeof x === 'string' && MODEL_TEXT_KEYS.has(k) ? x + POISON : poison(x)]));
}

const MIB = 1 << 20;
const FUZZ: string[] = [
  '',
  ' ',
  '[1]',
  'null',
  '1',
  '"x"',
  'true',
  '{}',
  '{"type":null}',
  '{"type":{"nested":1}}',
  '['.repeat(100_000) + ']'.repeat(100_000),
  '{"a":'.repeat(10_000) + '1' + '}'.repeat(10_000),
  '['.repeat(100_000),
  `{"type":"assistant","message":${'{"a":'.repeat(5_000)}1${'}'.repeat(5_000)}}`,
  `{"type":"tool_request","id":"tr-1","toolCallId":"c","name":"n","args":${'{"a":'.repeat(5_000)}1${'}'.repeat(5_000)}}`,
  'x'.repeat(MIB),
  JSON.stringify('x'.repeat(MIB)),
  JSON.stringify({ type: 'message_update', delta: 'x'.repeat(MIB) }),
  JSON.stringify({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'x'.repeat(MIB) } } }),
];

const ADAPTERS = Object.values(BACKEND_ADAPTERS) as AnyBackendAdapter[];

describe('#backend-adapter: BACKEND_ADAPTERS', () => {
  it('G-ADP-02 local charge: agent_end charges only the remainder the messages did not (message 100, end 130 ⇒ 30)', () => {
    const m = localAdapter.newMeter();
    expect(m.charge(localAdapter.parse(JSON.stringify({ type: 'message_end', message: { content: 'x' }, usage: { input: 60, output: 40 } })))).toBe(100);
    expect(m.charge(localAdapter.parse(JSON.stringify({ type: 'agent_end', stopReason: 'stop', usage: { input: 100, output: 30 } })))).toBe(30);
  });
  it('is keyed by each adapter\'s own backend id', () => {
    for (const [id, a] of Object.entries(BACKEND_ADAPTERS)) expect(a.backend).toBe(id);
  });
  it('a capability exists only on the backend that has it (no fake methods)', () => {
    // @ts-expect-error -- claude-code has no SteerChannel: steering it is a compile error
    expect(claudeCodeAdapter.steerLine).toBeUndefined();
    expect('toolsSetLine' in claudeCodeAdapter).toBe(false);
    expect('allowLine' in localAdapter || 'setModelLine' in localAdapter || 'mcpResponseLine' in localAdapter).toBe(false);
    expect(localAdapter.steerLine('s')).toBe(`${JSON.stringify({ type: 'steer', message: 's' })}\n`);
  });
  it('turnLine: claude-code ignores inFlight; local sends a follow_up while a turn is in flight, else a prompt', () => {
    expect(claudeCodeAdapter.turnLine({ text: 'hi', inFlight: true })).toBe(claudeCodeAdapter.turnLine({ text: 'hi', inFlight: false }));
    expect(JSON.parse(localAdapter.turnLine({ text: 'hi', inFlight: false })).type).toBe('prompt');
    expect(JSON.parse(localAdapter.turnLine({ text: 'hi', inFlight: true })).type).toBe('follow_up');
    expect(JSON.parse(localAdapter.interruptLine()).type).toBe('abort');
    expect(JSON.parse(claudeCodeAdapter.interruptLine()).request.subtype).toBe('interrupt');
  });
});

for (const adapter of ADAPTERS) {
  const fixtures = fixturesOf(adapter.backend);
  describe(`#backend-adapter ${adapter.backend}`, () => {
    it('has at least one fixture turn', () => {
      expect(fixtures.length).toBeGreaterThan(0);
    });
    for (const fx of fixtures) {
      it(`${ORACLE[adapter.backend]} replay ${fx.name} (${fx.expect.source}): kinds, types and charged usage match ${fx.name.replace(/\.jsonl$/, '.expect.json')}`, () => {
        expect(fx.expect).toMatchObject({ schema: 'gnomon-adapter-replay:v1', backend: adapter.backend });
        expect(['recorded', 'synthetic']).toContain(fx.expect.source);
        expect(fx.expect.backendVersion).toBe(fx.name.slice(0, fx.name.indexOf('-turn.jsonl')));
        const r = replay(adapter, fx.lines);
        expect(r.kinds).toEqual(fx.expect.kinds);
        expect(r.types).toEqual(fx.expect.types);
        expect(r.charged).toBe(fx.expect.charged);
      });
      it(`${ORACLE[adapter.backend]} charge never reads model text (${fx.name}): poisoned text keys change neither kinds nor charged`, () => {
        const poisoned = fx.lines.map((l) => JSON.stringify(poison(JSON.parse(l))));
        expect(poisoned.some((l, i) => l !== JSON.stringify(JSON.parse(fx.lines[i]!)))).toBe(true);
        const r = replay(adapter, poisoned);
        expect(r.kinds).toEqual(fx.expect.kinds);
        expect(r.charged).toBe(fx.expect.charged);
      });
    }
    it('parse never throws on the fuzz corpus', () => {
      for (const l of FUZZ) {
        let ev: { kind: string; type: string } | undefined;
        expect(() => (ev = adapter.parse(l)), l.slice(0, 40)).not.toThrow();
        expect(typeof ev?.kind).toBe('string');
        expect(typeof ev?.type).toBe('string');
      }
    });
    it('tolerant: not json ⇒ malformed, an unknown type ⇒ unknown', () => {
      expect(adapter.parse('not json').kind).toBe('malformed');
      expect(adapter.parse('{"type":"zz_future"}')).toMatchObject({ kind: 'unknown', type: 'zz_future' });
    });
  });
}
