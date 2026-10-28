/**
 * #local-tool-tier (slice C4'a; G-LCL-21): the tool-skill probe T2-T4 over a FAKE fetch. Each test passes and fails;
 * malformed, oversized and timed-out replies fail without throwing; a partial run grades from its prefix; the request
 * bodies are byte-stable; the same replies give the same tier; the fingerprint for Ollama and llama.cpp.
 */
import { describe, expect, it } from 'vitest';
import { fingerprintOf, PROBE_BODY_CAP, probeToolSkill, T4_EXPECTED, tierProbeBodies, type ProbeFetch } from '../src/kernel/local/probe.js';

const EP = { base: 'http://127.0.0.1:8080', model: 'qwen' };
const call = (name: string, args: unknown): unknown => ({ choices: [{ message: { tool_calls: [{ function: { name, arguments: typeof args === 'string' ? args : JSON.stringify(args) } }] } }] });
const RIGHT = { t2a: call('lookup_city', { code: 'K7' }), t2b: call('get_time', { tz: 'Europe/Lisbon' }), t3: call('archive_note', { id: 'n-42' }), t4: call('create_event', T4_EXPECTED) };
type Key = keyof typeof RIGHT;

/** A fake endpoint answering each tier request from `replies` (default: right); records the bodies it saw. */
function fake(replies: Partial<Record<Key, unknown | 'hang' | 'oversize' | 'malformed'>> = {}): { fetch: ProbeFetch; bodies: string[] } {
  const bodies: string[] = [];
  const fetch: ProbeFetch = async (_u, init) => {
    const body = String(init.body);
    bodies.push(body);
    const b = JSON.parse(body) as { tools: Array<{ function: { name: string } }>; messages: Array<{ role: string }> };
    const names = b.tools.map((t) => t.function.name);
    const key: Key = names.includes('lookup_city') ? (b.messages.some((m) => m.role === 'tool') ? 't2b' : 't2a') : names.includes('archive_note') ? 't3' : 't4';
    const r = Object.hasOwn(replies, key) ? replies[key] : RIGHT[key];
    if (r === 'hang') return new Promise<Response>((_res, rej) => init.signal?.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' }))));
    if (r === 'oversize') return new Response('x'.repeat(PROBE_BODY_CAP + 10));
    if (r === 'malformed') return new Response('{"choices": [');
    return new Response(JSON.stringify(r));
  };
  return { fetch, bodies };
}

describe('probeToolSkill (T2-T4)', () => {
  it('all four pass → 3; T1 failing → 0 with no request', async () => {
    expect(await probeToolSkill(EP, { t1: true, fetch: fake().fetch })).toEqual({ passed: 4, skill: 3, failed: null });
    const f = fake();
    expect(await probeToolSkill(EP, { t1: false, fetch: f.fetch })).toMatchObject({ passed: 0, skill: 0, failed: 't1' });
    expect(f.bodies).toEqual([]);
  });
  it('each test fails on a wrong call and the grade is the passing prefix (stops at the first failure)', async () => {
    const cases: Array<[Partial<Record<Key, unknown>>, number, string]> = [
      [{ t2a: call('get_time', { tz: 'UTC' }) }, 1, 't2'],
      [{ t2b: call('get_time', { tz: 'Lisbon' }) }, 1, 't2'],
      [{ t3: call('delete_note', { id: 'n-42' }) }, 2, 't3'],
      [{ t3: { choices: [{ message: { tool_calls: [{ function: { name: 'archive_note', arguments: '{"id":"n-42"}' } }, { function: { name: 'archive_note', arguments: '{"id":"n-42"}' } }] } }] } }, 2, 't3'],
      [{ t4: call('create_event', { ...T4_EXPECTED, priority: 'urgent' }) }, 3, 't4'],
      [{ t4: call('create_event', { ...T4_EXPECTED, extra: 1 }) }, 3, 't4'],
      [{ t4: call('create_event', { ...T4_EXPECTED, title: 'Other' }) }, 3, 't4'],
    ];
    for (const [r, passed, failed] of cases) {
      const f = fake(r);
      const got = await probeToolSkill(EP, { t1: true, fetch: f.fetch });
      expect(got, failed).toMatchObject({ passed, failed, why: 'wrong-call' });
      // nothing after the failing test is asked
      expect(f.bodies.length).toBe({ t2: r.t2a ? 1 : 2, t3: 3, t4: 4 }[failed as 't2' | 't3' | 't4']);
    }
  });
  it('malformed, oversized and timed-out replies fail without throwing', async () => {
    expect(await probeToolSkill(EP, { t1: true, fetch: fake({ t3: 'malformed' }).fetch })).toMatchObject({ passed: 2, failed: 't3' });
    expect(await probeToolSkill(EP, { t1: true, fetch: fake({ t2a: 'oversize' }).fetch })).toMatchObject({ passed: 1, failed: 't2' });
    expect(await probeToolSkill(EP, { t1: true, fetch: fake({ t4: 'hang' }).fetch, testTimeoutMs: 50 })).toMatchObject({ passed: 3, failed: 't4', why: 'timeout' });
    expect(await probeToolSkill(EP, { t1: true, fetch: fake({ t3: call('archive_note', '{not json') }).fetch })).toMatchObject({ passed: 2, failed: 't3' });
    const throwing: ProbeFetch = async () => { throw new Error('boom'); };
    expect(await probeToolSkill(EP, { t1: true, fetch: throwing })).toMatchObject({ passed: 1, skill: 1, failed: 't2' });
    expect(await probeToolSkill({ ...EP, base: 'https://api.anthropic.com' }, { t1: true, fetch: fake().fetch })).toMatchObject({ passed: 1, failed: 't2' });
  });
  it('the whole probe is capped (total timeout)', async () => {
    expect(await probeToolSkill(EP, { t1: true, fetch: fake({ t2a: 'hang' }).fetch, totalTimeoutMs: 30 })).toMatchObject({ failed: 't2', why: 'timeout' });
  });
  it('request bodies are byte-stable (constant prompts, temperature 0, seed 0, max_tokens 128); the same replies give the same tier', async () => {
    const a = fake();
    const b = fake();
    const ra = await probeToolSkill(EP, { t1: true, fetch: a.fetch });
    const rb = await probeToolSkill(EP, { t1: true, fetch: b.fetch });
    expect(ra).toEqual(rb);
    expect(a.bodies).toEqual(b.bodies);
    const bodies = tierProbeBodies('qwen');
    expect(a.bodies).toEqual([bodies.t2a, bodies.t2b, bodies.t3, bodies.t4]);
    for (const x of a.bodies) expect(JSON.parse(x)).toMatchObject({ temperature: 0, seed: 0, max_tokens: 128, tool_choice: 'required' });
    expect((JSON.parse(bodies.t3) as { tools: unknown[] }).tools).toHaveLength(16);
  });
});

describe('fingerprintOf', () => {
  const serve = (routes: Record<string, unknown>): ProbeFetch => async (u) => {
    const p = new URL(u).pathname;
    return Object.hasOwn(routes, p) ? new Response(JSON.stringify(routes[p])) : new Response('{}', { status: 404 });
  };
  it('llama.cpp: /props model_path plus the model id', async () => {
    expect(await fingerprintOf(EP, { fetch: serve({ '/props': { model_path: '/m/qwen.gguf' } }) })).toBe('llama.cpp:/m/qwen.gguf|qwen');
  });
  it('Ollama: the /api/tags digest of the model; none known → null', async () => {
    const d = 'a'.repeat(64);
    expect(await fingerprintOf(EP, { fetch: serve({ '/api/tags': { models: [{ name: 'other', digest: 'b'.repeat(64) }, { name: 'qwen', digest: d }] } }) })).toBe(`ollama:${d}`);
    expect(await fingerprintOf(EP, { fetch: serve({ '/api/tags': { models: [{ name: 'qwen', digest: 'not a digest' }] } }) })).toBeNull();
    expect(await fingerprintOf(EP, { fetch: serve({}) })).toBeNull();
  });
});
