/**
 * #loop-schema, the compiled form's check (docs/specs/gnomon-loops.md §4 #loop-registry; build plan LP2): the kernel
 * re-validates every `<id>.loop.json` (decompile, validate, compile again, compare). Pure tests.
 */
import { describe, expect, it } from 'vitest';
import { compileLoop, loopContentHash, loopFileJson, validateCompiledLoop, type CompiledLoop } from '../src/loops/index.js';

type Def = Record<string, unknown>;
const clone = <T>(v: T): T => structuredClone(v);

const HEALTH: Def = {
  schema: 'loop:v2', id: 'flow-health', flows: ['$checkout-flow'],
  triggers: [{ schedule: { daily: '07:30' } }, { event: { kind: 'file.changed', flow: '$checkout-flow' }, debounce: '5m' }, { schedule: { weekly: { day: 'mon', at: '09:00' } }, catchUp: 'once' }],
  autonomy: 'observe', notify: { on: ['fail'], as: 'toast' },
  budgets: { run: { wallMin: 15, computeSec: 300 }, day: { runs: 12 } },
  goal: { node: 'drift', verdict: 'pass' }, start: 'defn',
  nodes: [
    { id: 'defn', type: 'check', builtin: 'paradigm.flow-check', args: { flowId: '$checkout-flow' }, on: { pass: 'tests', fail: 'why' } },
    { id: 'tests', type: 'check', run: ['node_modules/.bin/vitest', 'run', 'test/checkout'], pass: { parse: 'junit', failed: 0 }, on: { pass: 'drift', fail: 'why' } },
    { id: 'drift', type: 'check', builtin: 'paradigm.drift', on: { pass: '@goal', fail: 'why' } },
    { id: 'why', type: 'model', role: 'summarize', model: { use: 'local' }, inputs: ['last.evidence'], on: { any: 'tell' } },
    { id: 'tell', type: 'notify', as: 'toast', text: '{{loop.id}} failed', on: { any: '@stop' } },
  ],
};
const GREEN: Def = {
  schema: 'loop:v2', id: 'green', triggers: [{ continuous: { cooldown: '2m' } }], autonomy: 'act',
  budgets: { run: { rounds: 8, tokens: '400k' }, day: { runs: 4 }, escalations: { perRun: 0 } },
  goal: { node: 'tsc', verdict: 'pass', inputs: ['tsconfig.json'] },
  land: { paths: ['src/**'], message: 'fix(#x): green', maxWaitMin: 30 }, start: 'tsc',
  nodes: [
    { id: 'tsc', type: 'check', run: ['node_modules/.bin/tsc', '--noEmit'], pass: { parse: 'tsc', failed: 0 }, timeoutSec: 120, on: { pass: '@goal', fail: 'fix' } },
    { id: 'fix', type: 'model', role: 'act', model: { use: 'local', profile: 'coder' }, tools: ['read', 'edit', { paradigm: ['ripple'] }], limits: { tokens: '20k' }, exit: { maxVisits: 3 }, on: { pass: 'tsc', fail: 'tsc', unsure: 'ask', unavailable: 'ask' } },
    { id: 'ask', type: 'notify', as: 'card', choices: ['continue', 'stop'], on: { continue: 'fix', stop: '@stop', timeout: '@pause' } },
  ],
};
const CALLER: Def = {
  schema: 'loop:v2', id: 'caller', repo: '/abs/repo', triggers: [], start: 'go', goal: { node: 'ok', verdict: 'pass' },
  nodes: [
    { id: 'go', type: 'call', loop: `green@${loopContentHash(GREEN).slice(0, 8)}`, on: { pass: 'ok', fail: '@stop' } },
    { id: 'ok', type: 'check', builtin: 'git.clean', on: { pass: '@goal' } },
  ],
};

const compiledOf = (def: Def, scope: 'repo' | 'personal' = 'repo', flowIndex?: Record<string, string[]>): CompiledLoop => {
  const r = compileLoop(def, { scope, ...(flowIndex ? { flowIndex } : {}), readShebang: (a0) => (a0.endsWith('tsc') ? '/usr/bin/env node' : null) });
  if (!r.compiled) throw new Error(JSON.stringify(r.errors));
  return r.compiled;
};
const asFile = (c: CompiledLoop): Record<string, any> => JSON.parse(loopFileJson(c));

describe('validateCompiledLoop: the kernel never trusts the file', () => {
  it.each([
    ['health (flows resolved)', compiledOf(HEALTH, 'repo', { '$checkout-flow': ['src/checkout/**'] }), 'repo'],
    ['health (flows symbolic)', compiledOf(HEALTH), 'repo'],
    ['green (continuous, card, interpreter)', compiledOf(GREEN), 'repo'],
    ['caller (personal, call)', compiledOf(CALLER, 'personal'), 'personal'],
  ] as const)('%s round-trips', (_n, c, scope) => {
    const r = validateCompiledLoop(asFile(c), { scope, fileId: c.id });
    expect(r.errors).toEqual([]);
    expect(r.ok).toBe(true);
    expect(r.compiled!.compiled.sourceHash).toBe(c.compiled.sourceHash);
  });
  it('carries the source hash a pin names', () => {
    expect(compiledOf(GREEN).compiled.sourceHash).toBe(loopContentHash(GREEN));
  });
  it.each([
    ['an unknown root key', (f: any) => { f.shell = true; }, 'UNKNOWN_KEY'],
    ['an unknown node key', (f: any) => { f.nodes[0].sh = 'x'; }, 'UNKNOWN_KEY'],
    ['a templated argv', (f: any) => { f.nodes[0].run[1] = '{{x}}'; }, 'ARGV_TEMPLATED'],
    ['argv0 a shell', (f: any) => { f.nodes[0].run[0] = '/bin/sh'; }, 'ARGV0_INTERPRETER'],
    ['argv0 npx', (f: any) => { f.nodes[0].run[0] = 'npx'; }, 'ARGV0_INTERPRETER'],
    ['a model goal edge', (f: any) => { f.nodes[1].on.pass = '@goal'; }, 'GOAL_VIA_MODEL'],
    ['claude in 8.0', (f: any) => { f.nodes[1].model.use = 'claude'; }, 'LANDS_IN_8_1'],
    ['a hand-edited expanded edge set', (f: any) => { delete f.nodes[0].on.error; }, 'NOT_CANONICAL'],
    ['a bad source hash', (f: any) => { f.compiled.sourceHash = 'nope'; }, 'BAD_HASH'],
    ['a wrong version', (f: any) => { f.compiled.version = 2; }, 'BAD_COMPILED'],
  ] as const)('refuses %s', (_n, edit, code) => {
    const f = asFile(compiledOf(GREEN));
    edit(f);
    const r = validateCompiledLoop(f, { scope: 'repo', fileId: 'green' });
    expect(r.ok).toBe(false);
    expect(r.errors.map((e) => e.code)).toContain(code);
  });
  it('refuses a scope or file-name mismatch, and a repo field on a repo loop', () => {
    const f = asFile(compiledOf(GREEN));
    expect(validateCompiledLoop(f, { scope: 'personal', fileId: 'green' }).errors[0]!.code).toBe('BAD_SCOPE');
    expect(validateCompiledLoop(f, { scope: 'repo', fileId: 'other' }).errors[0]!.code).toBe('FILE_ID_MISMATCH');
    const g = clone(f);
    g.repo = '/x';
    expect(validateCompiledLoop(g, { scope: 'repo', fileId: 'green' }).errors.map((e) => e.code)).toContain('REPO_SCOPE');
    expect(validateCompiledLoop(null, { scope: 'repo' }).ok).toBe(false);
  });
});
