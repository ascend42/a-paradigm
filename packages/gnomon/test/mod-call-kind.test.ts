/**
 * #mod-host `callKind` and the human reserve through a REAL mod child (Dimensions S1.4 pass P1; Aegis A4; G-MOD-21;
 * spec §12.3). The host tells the bridge what kind of call an append is bound to, from its own call context; the
 * value is host-internal: it is never read from the mod and never written to the mod's stdin. A budget refusal
 * reaches the mod as a code it can tell from an append that failed. Uses the unsandboxed launcher seam; no path
 * literals, no POSIX-only tools.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { MOD_ABI_DESCRIPTOR, canonicalJson } from '@a-company/gnomon-contracts';
import { createModKernelCall, MOD_APPEND_ROWS_PER_SEC, MOD_APPEND_TOOL_ROWS_PER_SEC, type ModAppendRow } from '../src/kernel/modhost/index.js';
import type { KernelCallRequest } from '../src/kernel/modhost/host.js';
import { unsandboxedModLauncher } from '../src/kernel/testing.js';
import { FIRST_PARTY_PROBE, PROBE_SOURCE, host, installFirstParty, rig } from './mod-helpers.js';

const cleanups: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  for (const c of cleanups.splice(0).reverse()) await c();
});

/**
 * The probe, plus: every byte of its stdin kept (`wire`: what the HOST wrote to the child), and `burst`, which
 * appends `n` rows one after another and reports each outcome with the error data the mod was given. Each burst
 * append FORGES `callKind: 'command'` in its own params: the mod has no say in its call kind.
 */
const SOURCE = (() => {
  const serve = 'serveMod({';
  const hang = "  if (input.op === 'hang')";
  if (!PROBE_SOURCE.includes(serve) || !PROBE_SOURCE.includes(hang)) throw new Error('the probe source changed: update mod-call-kind.test.ts');
  const ops = [
    "  if (input.op === 'wire') return { ok: true, wire };",
    "  if (input.op === 'burst') { const out = []; for (let i = 0; i < input.n; i++) { try { await api.kernel('log.append', { kind: 'modns.acme.probe.done', payload: { i }, callKind: 'command' }); out.push('ok'); } catch (e) { out.push({ code: e.code ?? null, message: e.message ?? null, data: e.data ?? null }); } } return { ok: true, out }; }",
  ].join('\n');
  return PROBE_SOURCE.replace(hang, `${ops}\n${hang}`)
    .replace(serve, `let wire = '';\nprocess.stdin.on('data', (c) => { wire += c.toString('utf8'); });\n${serve}`)
    .replaceAll('modns.acme.probe.', 'modns.gnomon.probe.');
})();

const GUI = { principal: 'p:abcdefgh/matt', connId: 'conn-7', surface: 'gui' as const };
const TOOL = { principal: 'p:abcdefgh/s-01', surface: 'bridge', agent: 'kit', hsid: 'hs-1', turn: 'turn:hs-1/4' } as const;
type Outcome = 'ok' | { code: number | null; message: string | null; data: { code?: string; gate?: string; data?: Record<string, unknown> } | null };
type Burst = { ok: boolean; out: Outcome[] };

async function started(opts: { appendFails?: () => boolean } = {}) {
  const r = rig();
  cleanups.push(r.cleanup);
  installFirstParty(r, undefined, SOURCE);
  const rows: ModAppendRow[] = [];
  const reqs: KernelCallRequest[] = [];
  // a fixed clock: every append of a test is in one window, whatever the machine's speed
  const bridge = createModKernelCall({ callAs: async () => ({}), append: async (row) => (opts.appendFails?.() ? Promise.reject(new Error('the log failed')) : (rows.push(row), { seq: rows.length })) }, { now: () => 7_000_000 });
  const { h } = host(r, { launcher: unsandboxedModLauncher }, { kernelCall: (req) => (reqs.push(req), bridge(req)), callTimeoutMs: 20_000 });
  cleanups.push(() => h.stopAll());
  await h.start(FIRST_PARTY_PROBE);
  const tool = async (input: Record<string, unknown>): Promise<Burst> => {
    const out = (await h.callTool(FIRST_PARTY_PROBE, 'probe.write', { who: true, ...input }, { hsid: 'hs-1', toolRelayedFor: { ...TOOL } })) as { out: Burst };
    return out.out;
  };
  const command = async (input: Record<string, unknown>): Promise<Burst> => {
    const out = (await h.relayCommand({ name: FIRST_PARTY_PROBE, commandId: 'probe.who', args: input, ...GUI })) as { out: Burst };
    return out.out;
  };
  return { h, rows, reqs, tool, command };
}

describe('S1.4 callKind: the host names the kind of the bound call; the mod has no say', () => {
  it('a tool call hands the bridge callKind tool, a command hands it command, whatever the mod puts in its own params', async () => {
    const { reqs, rows, tool, command } = await started();
    expect((await tool({ op: 'burst', n: 1 })).out).toEqual(['ok']);
    expect((await command({ op: 'burst', n: 1 })).out).toEqual(['ok']);
    expect(reqs.map((q) => [q.verb, q.callKind])).toEqual([
      ['log.append', 'tool'],
      ['log.append', 'command'],
    ]);
    // the forged value stayed where the mod put it (the verb's params, where the clamp drops it); it reached no row
    expect(reqs.map((q) => q.params.callKind)).toEqual(['command', 'command']);
    expect(JSON.stringify(rows)).not.toContain('callKind');
    for (const row of rows) expect(Object.keys(row).sort()).toEqual(expect.not.arrayContaining(['callKind']));
  });

  it('G-MOD-21 through a real child: 5 tool rows land and the sixth is refused, though the mod claims to be a command; 15 command rows then land in the same window', async () => {
    const { rows, reqs, tool, command } = await started();
    const burst = await tool({ op: 'burst', n: MOD_APPEND_TOOL_ROWS_PER_SEC + 1 });
    expect(burst.out.slice(0, MOD_APPEND_TOOL_ROWS_PER_SEC)).toEqual(Array.from({ length: MOD_APPEND_TOOL_ROWS_PER_SEC }, () => 'ok'));
    const sixth = burst.out[MOD_APPEND_TOOL_ROWS_PER_SEC] as Exclude<Outcome, 'ok'>;
    // what the MOD is given: the refusal object as its JSON-RPC error data, with the code that means "not written"
    expect(sixth.data).toMatchObject({ code: 'BAD_REQUEST', gate: 'usage', data: { modCode: 'APPEND_BUDGET', budget: 'tool-rows', written: false } });
    expect(typeof sixth.data!.data!.retryAfterMs).toBe('number');
    expect(rows).toHaveLength(MOD_APPEND_TOOL_ROWS_PER_SEC);
    // the human reserve is whole: every command row lands, in the window the tool rows are still in
    const reserve = MOD_APPEND_ROWS_PER_SEC - MOD_APPEND_TOOL_ROWS_PER_SEC;
    const human = await command({ op: 'burst', n: reserve + 1 });
    expect(human.out.slice(0, reserve)).toEqual(Array.from({ length: reserve }, () => 'ok'));
    expect((human.out[reserve] as Exclude<Outcome, 'ok'>).data).toMatchObject({ data: { modCode: 'APPEND_BUDGET', budget: 'rows', written: false } });
    expect(rows).toHaveLength(MOD_APPEND_ROWS_PER_SEC);
    expect(reqs.filter((q) => q.callKind === 'tool')).toHaveLength(MOD_APPEND_TOOL_ROWS_PER_SEC + 1);
    // and another tool call is still refused: the reserve was not handed back to tools
    expect(((await tool({ op: 'burst', n: 1 })).out[0] as Exclude<Outcome, 'ok'>).data).toMatchObject({ data: { modCode: 'APPEND_BUDGET', budget: 'tool-rows' } });
  });

  it('a budget refusal is DISTINGUISHABLE to the mod from an append that failed (Aegis A4)', async () => {
    let fail = true;
    const { tool } = await started({ appendFails: () => fail });
    // the log failed: the mod is told nothing it could read as "not written" (no refusal data, no modCode)
    const failed = (await tool({ op: 'burst', n: 1 })).out[0] as Exclude<Outcome, 'ok'>;
    expect(failed).not.toBe('ok');
    expect(failed.data).toBeNull();
    expect(JSON.stringify(failed)).not.toContain('APPEND_BUDGET');
    fail = false;
    // the failed try took a slot, so the fifth row of this burst is the sixth of the window
    const burst = (await tool({ op: 'burst', n: MOD_APPEND_TOOL_ROWS_PER_SEC })).out;
    const refused = burst[MOD_APPEND_TOOL_ROWS_PER_SEC - 1] as Exclude<Outcome, 'ok'>;
    expect(burst.slice(0, MOD_APPEND_TOOL_ROWS_PER_SEC - 1)).toEqual(Array.from({ length: MOD_APPEND_TOOL_ROWS_PER_SEC - 1 }, () => 'ok'));
    expect(refused.data?.data).toMatchObject({ modCode: 'APPEND_BUDGET', written: false });
    // the same JSON-RPC number as before S1.4 for a budget refusal; the two cases differ in the data, not by guessing
    expect([typeof refused.code, refused.code === failed.code]).toEqual(['number', false]);
  });
});

describe('S1.4: callKind never crosses the mod ABI wire', () => {
  it('nothing the host writes to the child holds callKind: not a tool.call, not a command.run, not a result, not a budget refusal', async () => {
    const { tool, command, h } = await started();
    await command({ op: 'burst', n: 2 });
    await tool({ op: 'burst', n: MOD_APPEND_TOOL_ROWS_PER_SEC + 1 }); // five results and one APPEND_BUDGET error
    await h.render(FIRST_PARTY_PROBE, 'probe.view', {});
    const wire = ((await h.callTool(FIRST_PARTY_PROBE, 'probe.read', { op: 'wire' })) as { wire: string }).wire;
    const lines = wire.split('\n').filter((l) => l.trim().length > 0).map((l) => JSON.parse(l) as { method?: string; params?: Record<string, unknown>; result?: unknown; error?: { data?: unknown } });
    // the host → mod requests of this test, each with exactly the keys the ABI gives it
    const byMethod = (m: string) => lines.filter((l) => l.method === m);
    expect(byMethod('command.run').length).toBe(1);
    expect(byMethod('tool.call').length).toBe(2);
    expect(byMethod('view.render').length).toBe(1);
    for (const l of byMethod('command.run')) expect(Object.keys(l.params!).sort()).toEqual(['args', 'callId', 'commandId', 'relayedFor']);
    expect(Object.keys(byMethod('tool.call')[0]!.params!).sort()).toEqual(['callId', 'cancelToken', 'input', 'name', 'relayedFor']);
    expect(Object.keys(byMethod('tool.call')[1]!.params!).sort()).toEqual(['callId', 'cancelToken', 'input', 'name']);
    // the answers to the mod's own requests: seven append results and the one refusal
    const answers = lines.filter((l) => l.method === undefined);
    expect(answers.filter((l) => l.error).length).toBe(1);
    expect(JSON.stringify(answers.find((l) => l.error)!.error!.data)).toContain('APPEND_BUDGET');
    // no key and no value named callKind anywhere on the wire, at any depth
    const keys = new Set<string>();
    const walk = (v: unknown): void => {
      if (Array.isArray(v)) v.forEach(walk);
      else if (v !== null && typeof v === 'object') for (const [k, x] of Object.entries(v)) (keys.add(k), walk(x));
    };
    lines.forEach(walk);
    expect([...keys].filter((k) => /call.?kind/i.test(k))).toEqual([]);
    expect(/call.?kind/i.test(wire)).toBe(false);
  });

  it('the mod ABI descriptor names neither callKind nor the budget code (modAbiId is hashed from it)', () => {
    const descriptor = canonicalJson(MOD_ABI_DESCRIPTOR);
    for (const word of ['callKind', 'APPEND_BUDGET', 'tool-rows']) expect([word, descriptor.includes(word)]).toEqual([word, false]);
  });
});
