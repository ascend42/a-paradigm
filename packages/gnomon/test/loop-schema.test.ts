/**
 * #loop-schema falsifiers (docs/specs/gnomon-loops.md §2, §3.1, §3.4, §3.5; build plan LP1, 8.0 subset).
 * A table of good and bad definitions covering every validator rule, the spec's Examples A–D adjusted to the
 * 8.0 subset, and the canonical compile (stable, defaults filled, flows resolved). Pure tests.
 */
import { describe, expect, it } from 'vitest';
import {
  canonicalLoopJson,
  compileLoop,
  LANDS_IN_8_1,
  LOOP_BUDGET_DEFAULTS,
  loopContentHash,
  loopFileJson,
  programName,
  parseCount,
  parseDurationSec,
  validateLoop,
  type LoopValidateOptions,
} from '../src/loops/index.js';
import { INTERPRETER_DENYLIST } from '../src/kernel/supervisor/prefix-policy.js';
import { NEVER_STANDING_KINDS } from '../src/kernel/broker/standing-grant.js';

type Def = Record<string, unknown>;
const clone = <T>(v: T): T => structuredClone(v);

// ── The spec examples, adjusted to the 8.0 subset ────────────────────────────

/** Example A: flow health check (unchanged; local summarize). */
const EXAMPLE_A: Def = {
  schema: 'loop:v2',
  id: 'flow-health-checkout',
  flows: ['$checkout-flow'],
  triggers: [{ schedule: { daily: '07:30' } }, { event: { kind: 'file.changed', flow: '$checkout-flow' }, debounce: '5m' }],
  autonomy: 'observe',
  notify: { on: ['fail'], as: 'toast' },
  budgets: { run: { wallMin: 15, computeSec: 300 }, day: { runs: 12 } },
  goal: { node: 'drift', verdict: 'pass' },
  start: 'defn',
  nodes: [
    { id: 'defn', type: 'check', builtin: 'paradigm.flow-check', args: { flowId: '$checkout-flow', checkImplementation: true }, on: { pass: 'gates', fail: 'why' } },
    { id: 'gates', type: 'check', builtin: 'paradigm.purpose-validate', on: { pass: 'tests', fail: 'why' } },
    { id: 'tests', type: 'check', run: ['node_modules/.bin/vitest', 'run', 'test/checkout'], pass: { parse: 'junit', failed: 0 }, on: { pass: 'drift', fail: 'why' } },
    { id: 'drift', type: 'check', builtin: 'paradigm.drift', args: { symbols: ['$checkout-flow'] }, on: { pass: '@goal', fail: 'why' } },
    { id: 'why', type: 'model', role: 'summarize', model: { use: 'local' }, inputs: ['last.evidence'], on: { pass: 'tell', fail: 'tell', unsure: 'tell', unavailable: 'tell' } },
    { id: 'tell', type: 'notify', as: 'toast', text: '{{loop.id}} failed at {{failed.node}}', on: { any: '@stop' } },
  ],
};

/** Example B: fix until green, local only (no claude block, escalate never, no bash tool). */
const EXAMPLE_B: Def = {
  schema: 'loop:v2',
  id: 'green-typecheck-gnomon',
  triggers: [{ schedule: { daily: '02:00' } }],
  autonomy: 'act',
  budgets: { run: { rounds: 8, wallMin: 60, tokens: '400k' } },
  goal: { node: 'tsc', verdict: 'pass', inputs: ['packages/gnomon/tsconfig*.json', 'tsconfig.base.json'] },
  land: { paths: ['packages/gnomon/src/**'], message: 'fix(#gnomon): typecheck green, loop round {{round}}' },
  start: 'tsc',
  nodes: [
    { id: 'tsc', type: 'check', run: ['node_modules/.bin/tsc', '-p', 'packages/gnomon', '--noEmit'], pass: { parse: 'tsc', failed: 0 }, on: { pass: '@goal', fail: 'fix' } },
    {
      id: 'fix', type: 'model', role: 'act', model: { use: 'local', profile: 'coder' }, tools: ['read', 'edit'], inputs: ['tsc.evidence'],
      exit: { maxVisits: 8, maxFailStreak: 3 }, on: { pass: 'tsc', fail: 'tsc', unsure: 'ask', unavailable: 'ask' },
    },
    { id: 'ask', type: 'notify', as: 'card', choices: ['continue', 'stop'], on: { continue: 'fix', stop: '@stop', timeout: '@pause' } },
  ],
};

/** Example C: watcher on a file trigger (the sentinel trigger lands in 8.1), local judge, pinned call. */
const EXAMPLE_C: Def = {
  schema: 'loop:v2',
  id: 'typecheck-watch',
  triggers: [{ event: { kind: 'file.changed', flow: '$gnomon-kernel-flow' }, debounce: '1m' }],
  autonomy: 'act',
  budgets: { run: { wallMin: 20 }, day: { runs: 20 } },
  start: 'triage',
  nodes: [
    { id: 'triage', type: 'model', role: 'judge', model: { use: 'local' }, inputs: ['trigger.payload'], verdict: { classes: ['typecheck-regression', 'other'] }, on: { pass: 'fix', fail: 'tell', unsure: 'tell', unavailable: 'tell' } },
    { id: 'fix', type: 'call', loop: 'green-typecheck-gnomon@3f9a1c02', on: { pass: 'tell', fail: 'tell' } },
    { id: 'tell', type: 'notify', as: 'toast', text: 'change {{trigger.id}}: {{triage.class}} → {{last.outcome}}', on: { any: '@stop' } },
  ],
};

// The call pin is the callee's content hash (sha256 of canonicalJson(parsed)).
const PIN_B = loopContentHash(EXAMPLE_B).slice(0, 8);
(EXAMPLE_C.nodes as any[])[1].loop = `green-typecheck-gnomon@${PIN_B}`;

/** Example D: routine chore, in its 8.0 form (the spec's `effect: write` on reindex lands in 8.1, TD-2026-10-22-769). */
const EXAMPLE_D: Def = {
  schema: 'loop:v2',
  id: 'evening-tidy',
  triggers: [{ schedule: { daily: '18:30' }, catchUp: 'once' }],
  autonomy: 'act',
  budgets: { run: { wallMin: 20, computeSec: 900 }, day: { runs: 1 } },
  land: { paths: ['.paradigm/lore/**', '.paradigm/**/index*'], message: 'chore(#paradigm): evening tidy' },
  start: 'reindex',
  nodes: [
    { id: 'reindex', type: 'check', builtin: 'paradigm.reindex', on: { pass: 'digest', fail: 'digest' } },
    { id: 'digest', type: 'model', role: 'summarize', model: { use: 'local' }, inputs: ['day.lore', 'day.commits', 'day.loopRuns'], on: { any: 'tell' } },
    { id: 'tell', type: 'notify', as: 'toast', text: 'daily digest ready', attach: ['digest.text'], on: { any: '@stop' } },
  ],
};

const MINIMAL: Def = {
  schema: 'loop:v2',
  id: 'tiny',
  start: 'a',
  nodes: [{ id: 'a', type: 'check', run: ['node_modules/.bin/tsc', '--noEmit'], on: { pass: '@stop' } }],
};

/** Apply a mutation to a clone of a base definition. */
function mut(base: Def, f: (d: any) => void): Def {
  const d = clone(base);
  f(d);
  return d;
}

const codes = (d: unknown, opts?: LoopValidateOptions) => validateLoop(d, opts).errors.map((e) => e.code);
const issue = (d: unknown, code: string, opts?: LoopValidateOptions) => validateLoop(d, opts).errors.find((e) => e.code === code);

describe('#loop-schema: the spec examples (8.0 subset)', () => {
  it.each([['A', EXAMPLE_A], ['B', EXAMPLE_B], ['C', EXAMPLE_C], ['D', EXAMPLE_D]])('Example %s validates', (_n, def) => {
    const r = validateLoop(def, { knownLoops: { 'green-typecheck-gnomon': EXAMPLE_B } });
    expect(r.errors).toEqual([]);
    expect(r.ok).toBe(true);
  });

  it('the unadjusted Example B and C are refused, each 8.1 item with LANDS_IN_8_1 and "lands in 8.1"', () => {
    const b = mut(EXAMPLE_B, (d) => {
      d.claude = { optIn: true, caps: { run: { claudeUsd: 3 } } };
      d.nodes[1].model.escalate = 'on-unsure';
      d.nodes[1].tools = ['read', 'edit', { bash: [['node_modules/.bin/tsc', '--noEmit']] }];
    });
    const r = validateLoop(b);
    expect(r.errors.map((e) => e.path).sort()).toEqual(['claude', 'nodes[1].model.escalate', 'nodes[1].tools[2].bash']);
    for (const e of r.errors) {
      expect(e.code).toBe(LANDS_IN_8_1);
      expect(e.message).toMatch(/lands in 8\.1$/);
    }
    const c = mut(EXAMPLE_C, (d) => { d.triggers = [{ event: { kind: 'sentinel.incident.opened', severity: ['high'] }, debounce: '1m' }]; });
    expect(issue(c, LANDS_IN_8_1)?.path).toBe('triggers[0].event.kind');
  });

  it('TD-2026-10-22-769: the spec\'s Example D (a write check) is refused at validate with LANDS_IN_8_1', () => {
    const d = mut(EXAMPLE_D, (x) => { x.nodes[0].effect = 'write'; });
    const e = issue(d, LANDS_IN_8_1);
    expect(e?.path).toBe('nodes[0].effect');
    expect(e?.message).toBe('effect: write (a write check) lands in 8.1');
    expect(validateLoop(mut(EXAMPLE_D, (x) => { x.nodes[0].effect = 'read'; })).ok).toBe(true);
    expect(issue(mut(EXAMPLE_D, (x) => { x.nodes[0].effect = 'append'; }), LANDS_IN_8_1)).toBeUndefined();
  });
});

describe('#loop-schema: the rule table', () => {
  // [name, definition, expected code, expected path (optional)]
  const BAD: Array<[string, Def, string, string?]> = [
    // closed shape
    ['unknown root key', mut(MINIMAL, (d) => { d.extra = 1; }), 'UNKNOWN_KEY', 'extra'],
    ['unknown node key', mut(MINIMAL, (d) => { d.nodes[0].shell = true; }), 'UNKNOWN_KEY', 'nodes[0].shell'],
    ['unknown budget key', mut(MINIMAL, (d) => { d.budgets = { run: { forever: 1 } }; }), 'UNKNOWN_KEY', 'budgets.run.forever'],
    ['authoredBy is never read from YAML', mut(MINIMAL, (d) => { d.authoredBy = 'agent'; }), 'UNKNOWN_KEY', 'authoredBy'],
    ['wrong schema', mut(MINIMAL, (d) => { d.schema = 'loop:v1'; }), 'BAD_SCHEMA', 'schema'],
    // ids
    ['id not kebab', mut(MINIMAL, (d) => { d.id = 'Tiny_Loop'; }), 'BAD_ID', 'id'],
    ['id over 64', mut(MINIMAL, (d) => { d.id = `a${'-b'.repeat(32)}`; }), 'BAD_ID', 'id'],
    ['node id not kebab', mut(MINIMAL, (d) => { d.nodes[0].id = 'A'; d.start = 'A'; }), 'BAD_ID', 'nodes[0].id'],
    ['duplicate node id', mut(MINIMAL, (d) => { d.nodes.push(clone(d.nodes[0])); }), 'DUPLICATE_ID', 'nodes[1].id'],
    ['missing id', mut(MINIMAL, (d) => { delete d.id; }), 'REQUIRED', 'id'],
    // edges and start
    ['edge to an unknown node', mut(MINIMAL, (d) => { d.nodes[0].on.fail = 'nowhere'; }), 'UNKNOWN_TARGET', 'nodes[0].on.fail'],
    ['edge to an unknown terminal', mut(MINIMAL, (d) => { d.nodes[0].on.fail = '@done'; }), 'UNKNOWN_TARGET', 'nodes[0].on.fail'],
    ['edge key not a verdict of the node', mut(MINIMAL, (d) => { d.nodes[0].on.unsure = '@stop'; }), 'BAD_EDGE_KEY', 'nodes[0].on.unsure'],
    ['start names no node', mut(MINIMAL, (d) => { d.start = 'b'; }), 'UNKNOWN_TARGET', 'start'],
    ['no nodes', mut(MINIMAL, (d) => { d.nodes = []; }), 'BAD_TYPE', 'nodes'],
    // goal (§3.4, LL2)
    ['goal names a model node', mut(EXAMPLE_B, (d) => { d.goal.node = 'fix'; }), 'GOAL_NOT_CHECK', 'goal.node'],
    ['goal on a run check without inputs', mut(EXAMPLE_B, (d) => { delete d.goal.inputs; }), 'GOAL_INPUTS_REQUIRED', 'goal.inputs'],
    ['goal names no node', mut(EXAMPLE_B, (d) => { d.goal.node = 'ghost'; }), 'UNKNOWN_TARGET', 'goal.node'],
    ['a model verdict reaches @goal', mut(EXAMPLE_B, (d) => { d.nodes[1].on.pass = '@goal'; }), 'GOAL_VIA_MODEL', 'nodes[1].on.pass'],
    ['goal glob leaves the repo', mut(EXAMPLE_B, (d) => { d.goal.inputs = ['../other/**']; }), 'BAD_GLOB', 'goal.inputs[0]'],
    ['land path is absolute', mut(EXAMPLE_D, (d) => { d.land.paths = ['/etc/**']; }), 'BAD_GLOB', 'land.paths[0]'],
    // argv (§3.1)
    ['argv0 npx', mut(MINIMAL, (d) => { d.nodes[0].run = ['npx', 'tsc']; }), 'ARGV0_INTERPRETER', 'nodes[0].run[0]'],
    ['argv0 pnpx', mut(MINIMAL, (d) => { d.nodes[0].run = ['pnpx', 'tsc']; }), 'ARGV0_INTERPRETER', 'nodes[0].run[0]'],
    ['argv0 bunx', mut(MINIMAL, (d) => { d.nodes[0].run = ['bunx', 'tsc']; }), 'ARGV0_INTERPRETER', 'nodes[0].run[0]'],
    ['argv0 sh', mut(MINIMAL, (d) => { d.nodes[0].run = ['sh', '-c', 'true']; }), 'ARGV0_INTERPRETER', 'nodes[0].run[0]'],
    ['argv0 /bin/bash by path', mut(MINIMAL, (d) => { d.nodes[0].run = ['/bin/bash', 'x.sh']; }), 'ARGV0_INTERPRETER', 'nodes[0].run[0]'],
    ['argv0 node', mut(MINIMAL, (d) => { d.nodes[0].run = ['node', 'x.js']; }), 'ARGV0_INTERPRETER', 'nodes[0].run[0]'],
    ['argv0 node.exe', mut(MINIMAL, (d) => { d.nodes[0].run = ['C:\\Program Files\\nodejs\\node.exe', 'x.js']; }), 'ARGV0_INTERPRETER', 'nodes[0].run[0]'],
    ['argv0 python3', mut(MINIMAL, (d) => { d.nodes[0].run = ['python3', 'x.py']; }), 'ARGV0_INTERPRETER', 'nodes[0].run[0]'],
    ['argv0 python3.12 (python* rule)', mut(MINIMAL, (d) => { d.nodes[0].run = ['python3.12', 'x.py']; }), 'ARGV0_INTERPRETER', 'nodes[0].run[0]'],
    ['argv0 .cmd', mut(MINIMAL, (d) => { d.nodes[0].run = ['node_modules\\.bin\\tsc.cmd']; }), 'ARGV0_BATCH', 'nodes[0].run[0]'],
    ['argv0 .BAT', mut(MINIMAL, (d) => { d.nodes[0].run = ['build.BAT']; }), 'ARGV0_BATCH', 'nodes[0].run[0]'],
    ['argv templated', mut(MINIMAL, (d) => { d.nodes[0].run = ['node_modules/.bin/tsc', '-p', '{{trigger.path}}']; }), 'ARGV_TEMPLATED', 'nodes[0].run[2]'],
    ['argv empty', mut(MINIMAL, (d) => { d.nodes[0].run = []; }), 'ARGV_EMPTY', 'nodes[0].run'],
    ['builtin args templated', mut(EXAMPLE_A, (d) => { d.nodes[0].args.flowId = '{{trigger.flow}}'; }), 'ARGV_TEMPLATED', 'nodes[0].args.flowId'],
    ['check with run and builtin', mut(MINIMAL, (d) => { d.nodes[0].builtin = 'git.clean'; }), 'CHECK_RUN_XOR_BUILTIN', 'nodes[0]'],
    ['unknown builtin', mut(EXAMPLE_A, (d) => { d.nodes[1].builtin = 'paradigm.everything'; }), 'BAD_ENUM', 'nodes[1].builtin'],
    // tools (§3.4)
    ['judge with tools', mut(EXAMPLE_C, (d) => { d.nodes[0].tools = ['read']; }), 'TOOLS_NOT_ALLOWED', 'nodes[0].tools'],
    ['summarize with tools', mut(EXAMPLE_D, (d) => { d.nodes[1].tools = ['edit']; }), 'TOOLS_NOT_ALLOWED', 'nodes[1].tools'],
    ['verdict classes on a non-judge', mut(EXAMPLE_D, (d) => { d.nodes[1].verdict = { classes: ['a'] }; }), 'UNKNOWN_KEY', 'nodes[1].verdict'],
    // continuous (§3.5)
    ['continuous cooldown < 60 s', mut(EXAMPLE_B, (d) => { d.triggers = [{ continuous: { cooldown: '30s' } }]; d.budgets.day = { runs: 10 }; }), 'CONTINUOUS_COOLDOWN', 'triggers[0].continuous.cooldown'],
    ['continuous without cooldown', mut(EXAMPLE_B, (d) => { d.triggers = [{ continuous: {} }]; d.budgets.day = { runs: 10 }; }), 'CONTINUOUS_COOLDOWN', 'triggers[0].continuous.cooldown'],
    ['continuous without goal or rounds', mut(EXAMPLE_D, (d) => { d.triggers = [{ continuous: { cooldown: '2m' } }]; }), 'CONTINUOUS_NEEDS_GOAL', 'triggers'],
    ['continuous without a day cap', mut(EXAMPLE_B, (d) => { d.triggers = [{ continuous: { cooldown: '2m' } }]; }), 'CONTINUOUS_NEEDS_DAY_CAP', 'budgets.day'],
    // budgets
    ['budget zero', mut(MINIMAL, (d) => { d.budgets = { run: { rounds: 0 } }; }), 'BAD_NUMBER', 'budgets.run.rounds'],
    ['budget tokens malformed', mut(MINIMAL, (d) => { d.budgets = { day: { tokens: 'lots' } }; }), 'BAD_BUDGET', 'budgets.day.tokens'],
    ['negative escalations', mut(MINIMAL, (d) => { d.budgets = { escalations: { perRun: -1 } }; }), 'BAD_NUMBER', 'budgets.escalations.perRun'],
    // triggers
    ['schedule every < 60 s', mut(MINIMAL, (d) => { d.triggers = [{ schedule: { every: '10s' } }]; }), 'BAD_DURATION', 'triggers[0].schedule.every'],
    ['daily not HH:MM', mut(MINIMAL, (d) => { d.triggers = [{ schedule: { daily: '7:30pm' } }]; }), 'BAD_TIME', 'triggers[0].schedule.daily'],
    ['two trigger kinds in one entry', mut(MINIMAL, (d) => { d.triggers = [{ schedule: { daily: '07:00' }, continuous: { cooldown: '2m' } }]; }), 'BAD_TRIGGER', 'triggers[0]'],
    ['unknown event kind', mut(MINIMAL, (d) => { d.triggers = [{ event: { kind: 'push' } }]; }), 'BAD_ENUM', 'triggers[0].event.kind'],
    ['file.changed without a flow', mut(MINIMAL, (d) => { d.triggers = [{ event: { kind: 'file.changed' } }]; }), 'REQUIRED', 'triggers[0].event.flow'],
    // call
    ['call not pinned', mut(EXAMPLE_C, (d) => { d.nodes[1].loop = 'green-typecheck-gnomon'; }), 'BAD_CALL', 'nodes[1].loop'],
    ['call hash not 8 hex', mut(EXAMPLE_C, (d) => { d.nodes[1].loop = 'green-typecheck-gnomon@3F9A1C0Z'; }), 'BAD_CALL', 'nodes[1].loop'],
    ['call to itself', mut(EXAMPLE_C, (d) => { d.nodes[1].loop = 'typecheck-watch@00000000'; }), 'CALL_CYCLE', 'nodes[1].loop'],
    // scope
    ['repo on a repo loop', mut(MINIMAL, (d) => { d.repo = '/abs'; }), 'REPO_SCOPE', 'repo'],
    // notify
    ['card without choices', mut(EXAMPLE_B, (d) => { delete d.nodes[2].choices; }), 'REQUIRED', 'nodes[2].choices'],
    ['card edge not a choice', mut(EXAMPLE_B, (d) => { d.nodes[2].on.maybe = 'fix'; }), 'BAD_EDGE_KEY', 'nodes[2].on.maybe'],
    ['input ref to an unknown node', mut(EXAMPLE_B, (d) => { d.nodes[1].inputs = ['ghost.evidence']; }), 'BAD_INPUT_REF', 'nodes[1].inputs[0]'],
    // 8.0 subset
    ['model.use claude', mut(EXAMPLE_D, (d) => { d.nodes[1].model.use = 'claude'; }), LANDS_IN_8_1, 'nodes[1].model.use'],
    ['model.use any', mut(EXAMPLE_D, (d) => { d.nodes[1].model.use = 'any'; }), LANDS_IN_8_1, 'nodes[1].model.use'],
    ['escalate on-unavailable', mut(EXAMPLE_D, (d) => { d.nodes[1].model.escalate = 'on-unavailable'; }), LANDS_IN_8_1, 'nodes[1].model.escalate'],
    ['escalate both', mut(EXAMPLE_D, (d) => { d.nodes[1].model.escalate = 'both'; }), LANDS_IN_8_1, 'nodes[1].model.escalate'],
    ['cron trigger', mut(MINIMAL, (d) => { d.triggers = [{ schedule: { cron: '0 */2 * * 1-5' } }]; }), LANDS_IN_8_1, 'triggers[0].schedule.cron'],
    ['sentinel trigger', mut(MINIMAL, (d) => { d.triggers = [{ event: { kind: 'sentinel.incident.opened', severity: ['high'] } }]; }), LANDS_IN_8_1, 'triggers[0].event.kind'],
    ['bash tool', mut(EXAMPLE_B, (d) => { d.nodes[1].tools = [{ bash: [['node_modules/.bin/tsc']] }]; }), LANDS_IN_8_1, 'nodes[1].tools[0].bash'],
    ['envelope field', mut(MINIMAL, (d) => { d.envelope = { landPaths: ['src/**'] }; }), LANDS_IN_8_1, 'envelope'],
    ['envelopeId field', mut(MINIMAL, (d) => { d.envelopeId = 'env-1'; }), LANDS_IN_8_1, 'envelopeId'],
    ['claude opt-in block', mut(MINIMAL, (d) => { d.claude = { optIn: true }; }), LANDS_IN_8_1, 'claude'],
  ];

  it.each(BAD)('refuses: %s', (_name, def, code, path) => {
    const r = validateLoop(def);
    expect(r.ok).toBe(false);
    const hit = r.errors.find((e) => e.code === code);
    expect(hit, JSON.stringify(r.errors)).toBeTruthy();
    if (path !== undefined) expect(hit!.path).toBe(path);
    if (code === LANDS_IN_8_1) expect(hit!.message).toContain('lands in 8.1');
  });

  const GOOD: Array<[string, Def]> = [
    ['minimal', MINIMAL],
    ['argv0 by relative path to a direct binary', mut(MINIMAL, (d) => { d.nodes[0].run = ['node_modules/.bin/vitest', 'run']; })],
    ['model.use local, escalate never', mut(EXAMPLE_D, (d) => { d.nodes[1].model = { use: 'local', escalate: 'never', minConfidence: 0.8 }; })],
    ['tools none on a judge', mut(EXAMPLE_C, (d) => { d.nodes[0].tools = 'none'; })],
    ['continuous with rounds and day.computeSec', mut(EXAMPLE_D, (d) => { d.triggers = [{ continuous: { cooldown: 60 } }]; d.budgets.run.rounds = 4; d.budgets.day = { computeSec: 600 }; })],
    ['continuous with a goal and day.runs', mut(EXAMPLE_B, (d) => { d.triggers = [{ continuous: { cooldown: '2m' } }]; d.budgets.day = { runs: 6 }; })],
    ['weekly schedule', mut(MINIMAL, (d) => { d.triggers = [{ schedule: { weekly: { day: 'mon', at: '09:00' } } }]; })],
    ['every schedule', mut(MINIMAL, (d) => { d.triggers = [{ schedule: { every: '30m' } }]; })],
    ['card.decided event', mut(MINIMAL, (d) => { d.triggers = [{ event: { kind: 'card.decided', loop: 'other', node: 'ask' } }]; })],
    ['goal on a builtin check needs no inputs', EXAMPLE_A],
    ['json pass', mut(MINIMAL, (d) => { d.nodes[0].pass = { json: '$.summary.failed', op: '==', value: 0 }; })],
    ['personal loop names its repo', mut(MINIMAL, (d) => { d.repo = '/Users/me/code/app'; })],
  ];

  it.each(GOOD)('accepts: %s', (name, def) => {
    const r = validateLoop(def, name.startsWith('personal') ? { scope: 'personal' } : {});
    expect(r.errors).toEqual([]);
  });

  it('a card node: timeout goes to @pause and stop to a terminal, never to a node (Aegis step 5 #3)', () => {
    const card = (on: Record<string, string>) => ({ schema: 'loop:v2', id: 'c', start: 'a', nodes: [{ id: 'a', type: 'check', run: ['bin/check'], on: { pass: 'q', fail: 'q' } }, { id: 'q', type: 'notify', as: 'card', choices: ['continue', 'stop'], on }] });
    expect(codes(card({ continue: 'a', stop: '@stop', timeout: '@pause' }))).toEqual([]);
    expect(codes(card({ continue: 'a', stop: '@pause' }))).toEqual([]);
    expect(issue(card({ continue: 'a', stop: '@stop', timeout: 'a' }), 'CARD_EDGE')?.path).toBe('nodes[1].on.timeout');
    expect(issue(card({ continue: 'a', stop: 'a', timeout: '@pause' }), 'CARD_EDGE')?.path).toBe('nodes[1].on.stop');
    expect(codes(card({ any: 'a' })).filter((c) => c === 'CARD_EDGE')).toHaveLength(2);
  });

  it('a personal loop without repo is refused; a relative repo is refused', () => {
    expect(issue(MINIMAL, 'REQUIRED', { scope: 'personal' })?.path).toBe('repo');
    expect(issue(mut(MINIMAL, (d) => { d.repo = 'code/app'; }), 'BAD_PATH', { scope: 'personal' })?.path).toBe('repo');
  });

  it('every INTERPRETER_DENYLIST entry is refused as argv0 (the kernel list, not a copy)', () => {
    for (const name of INTERPRETER_DENYLIST) {
      expect(codes(mut(MINIMAL, (d) => { d.nodes[0].run = [name, 'x']; }))).toContain('ARGV0_INTERPRETER');
    }
  });

  it('a non-object is refused at the root', () => {
    expect(validateLoop('loop').errors[0]).toMatchObject({ path: '', code: 'BAD_TYPE' });
    expect(validateLoop(null).ok).toBe(false);
  });

  it('warns (does not refuse) an unreachable node', () => {
    const r = validateLoop(mut(MINIMAL, (d) => { d.nodes.push({ id: 'orphan', type: 'check', builtin: 'git.clean' }); }));
    expect(r.ok).toBe(true);
    expect(r.warnings).toContainEqual(expect.objectContaining({ code: 'UNREACHABLE_NODE', path: 'nodes[1].id' }));
  });
});

describe('#loop-schema: call graph', () => {
  /** A caller pinned to `calleeDef`'s real hash (or a fake pin for an unknown callee). */
  const caller = (id: string, callee: string, calleeDef?: unknown, edge = '@stop'): Def => ({
    schema: 'loop:v2', id, start: 'c',
    nodes: [{ id: 'c', type: 'call', loop: `${callee}@${calleeDef ? loopContentHash(calleeDef).slice(0, 8) : '0123abcd'}`, on: { pass: edge } }],
  });
  const leaf = (id: string): Def => ({ ...clone(MINIMAL), id });

  it('refuses an unknown callee when the known loops are given', () => {
    expect(issue(caller('a', 'b'), 'UNKNOWN_CALLEE', { knownLoops: {} })?.path).toBe('nodes[0].loop');
    expect(validateLoop(caller('a', 'b')).ok).toBe(true); // no set given: only a self-call is detectable
  });

  it('detects a cycle through known loops', () => {
    const known = new Map<string, unknown>([['b', caller('b', 'c')], ['c', caller('c', 'a')]]);
    const e = issue(caller('a', 'b'), 'CALL_CYCLE', { knownLoops: known });
    expect(e?.message).toContain('a → b → c → a');
    const known2 = { b: caller('b', 'c'), c: caller('c', 'b') };
    expect(codes(caller('a', 'b'), { knownLoops: known2 })).toContain('CALL_CYCLE');
  });

  it('allows depth 3 and refuses depth 4', () => {
    const d = leaf('d');
    const c3 = caller('c', 'd', d);
    const b3 = caller('b', 'c', c3);
    expect(validateLoop(caller('a', 'b', b3), { knownLoops: { b: b3, c: c3, d } }).errors).toEqual([]);
    const e = leaf('e');
    const d4 = caller('d', 'e', e);
    const c4 = caller('c', 'd', d4);
    const b4 = caller('b', 'c', c4);
    const hit = issue(caller('a', 'b', b4), 'CALL_DEPTH', { knownLoops: { b: b4, c: c4, d: d4, e } });
    expect(hit?.message).toContain('call depth 4');
  });

  it('refuses a pin that is not the callee content hash (one changed byte moves it)', () => {
    const b = leaf('b');
    expect(validateLoop(caller('a', 'b', b), { knownLoops: { b } }).errors).toEqual([]);
    const changed = mut(b, (x) => { x.title = 'changed'; });
    const hit = issue(caller('a', 'b', b), 'CALL_PIN_MISMATCH', { knownLoops: { b: changed } });
    expect(hit?.message).toContain(`b@${loopContentHash(changed).slice(0, 8)}`);
    // the hash is of the parsed definition: key order does not move it
    const reordered = Object.fromEntries(Object.entries(b).reverse());
    expect(loopContentHash(reordered)).toBe(loopContentHash(b));
  });

  it('a call that reaches @goal needs a callee with a goal (and the caller needs a goal block)', () => {
    const noGoal = leaf('b');
    const withCheck = (d: Def) => mut(d, (x) => { x.goal = { node: 'g' }; x.nodes.push({ id: 'g', type: 'check', builtin: 'git.clean', on: { pass: '@goal' } }); });
    const a = withCheck(caller('a', 'b', noGoal, '@goal'));
    expect(issue(a, 'CALL_GOAL_REQUIRED', { knownLoops: { b: noGoal } })?.path).toBe('nodes[0].loop');
    const goalB = mut(EXAMPLE_B, (x) => { x.id = 'b'; });
    expect(validateLoop(withCheck(caller('a', 'b', goalB, '@goal')), { knownLoops: { b: goalB } }).errors).toEqual([]);
    expect(codes(caller('a', 'b', goalB, '@goal'), { knownLoops: { b: goalB } })).toContain('GOAL_REQUIRED');
  });

  it('the compiled protected set is the union of goal inputs and argv paths across the call chain', () => {
    const b = mut(EXAMPLE_B, (x) => { x.id = 'b'; });
    const a = mut(EXAMPLE_A, (x) => {
      x.id = 'a';
      x.nodes.push({ id: 'fixer', type: 'call', loop: `b@${loopContentHash(b).slice(0, 8)}`, on: { any: '@stop' } });
      x.nodes[4].on = { pass: 'fixer', fail: 'tell', unsure: 'tell', unavailable: 'tell' };
    });
    const r = compileLoop(a, { knownLoops: { b } });
    expect(r.errors).toEqual([]);
    const prot = r.compiled!.protected;
    expect(prot).toEqual(expect.arrayContaining([
      'node_modules/**', '**/node_modules/**', 'node_modules/.bin/vitest', 'test/checkout',
      'packages/gnomon/tsconfig*.json', 'tsconfig.base.json', 'node_modules/.bin/tsc', 'packages/gnomon',
    ]));
    expect(prot).toEqual([...prot].sort());
    expect(r.compiled!.compiled.callsResolved).toBe(true);
    expect(compileLoop(a).compiled!.compiled.callsResolved).toBe(false);
  });
});

describe('#loop-schema: Aegis LP1 review', () => {
  it('@goal only from goal.node or a call; any @goal edge needs a goal block', () => {
    const twoChecks = mut(EXAMPLE_A, (d) => { d.nodes[2].on.pass = '@goal'; });
    expect(issue(twoChecks, 'GOAL_EDGE_NOT_GOAL_NODE')?.path).toBe('nodes[2].on.pass');
    const noGoal = mut(MINIMAL, (d) => { d.nodes[0].on.pass = '@goal'; });
    expect(issue(noGoal, 'GOAL_REQUIRED')?.path).toBe('goal');
    expect(issue(mut(EXAMPLE_D, (d) => { d.nodes[1].on = { any: '@goal' }; d.goal = { node: 'reindex' }; }), 'GOAL_VIA_MODEL')?.path).toBe('nodes[1].on.any');
  });

  it('the shared denylist covers Windows script hosts and exec wrappers', () => {
    for (const name of ['cmd', 'powershell', 'pwsh', 'wscript', 'cscript', 'mshta', 'arch', 'script', 'stdbuf', 'setsid', 'chroot', 'sandbox-exec', 'busybox']) {
      expect(INTERPRETER_DENYLIST.has(name)).toBe(true);
      expect(codes(mut(MINIMAL, (d) => { d.nodes[0].run = [name, 'x']; }))).toContain('ARGV0_INTERPRETER');
    }
  });

  it('refuses build tools and package managers as argv0, but not the direct checkers', () => {
    for (const argv of [['npm', 'test'], ['npm', 'exec', 'tsc'], ['make'], ['cargo', 'run'], ['node_modules/.bin/pnpm', 'test'], ['yarn.cmd.'.replace('.cmd.', ''), 'x'], ['go', 'test']]) {
      expect(codes(mut(MINIMAL, (d) => { d.nodes[0].run = argv; })), argv.join(' ')).toContain('ARGV0_BUILD_TOOL');
    }
    for (const argv of [['node_modules/.bin/tsc', '--noEmit'], ['node_modules/.bin/vitest', 'run'], ['node_modules/.bin/jest']]) {
      expect(codes(mut(MINIMAL, (d) => { d.nodes[0].run = argv; }))).toEqual([]);
    }
  });

  it('argv0 normalizes trailing dots and spaces, .exe and .com', () => {
    expect(programName('C:\\bin\\NODE.EXE. ')).toBe('node');
    expect(programName('bash.com')).toBe('bash');
    expect(programName('python3.exe.com')).toBe('python3');
    expect(codes(mut(MINIMAL, (d) => { d.nodes[0].run = ['node.exe. ', 'x']; }))).toContain('ARGV0_INTERPRETER');
    expect(codes(mut(MINIMAL, (d) => { d.nodes[0].run = ['make.com', 'x']; }))).toContain('ARGV0_BUILD_TOOL');
    expect(codes(mut(MINIMAL, (d) => { d.nodes[0].run = ['build.cmd. ', 'x']; }))).toContain('ARGV0_BATCH');
  });

  it('refuses non-finite numbers anywhere', () => {
    expect(issue(mut(MINIMAL, (d) => { d.budgets = { run: { rounds: Infinity } }; }), 'NON_FINITE')?.path).toBe('budgets.run.rounds');
    expect(issue(mut(EXAMPLE_A, (d) => { d.nodes[0].args.n = NaN; }), 'NON_FINITE')?.path).toBe('nodes[0].args.n');
  });

  it('never lands under node_modules', () => {
    expect(issue(mut(EXAMPLE_D, (d) => { d.land.paths = ['node_modules/x/**']; }), 'PROTECTED_PATH')?.path).toBe('land.paths[0]');
    expect(issue(mut(EXAMPLE_D, (d) => { d.land.paths = ['packages/a/node_modules/**']; }), 'PROTECTED_PATH')?.path).toBe('land.paths[0]');
  });

  it('records the argv0 shebang interpreter when a reader is given', () => {
    const r = compileLoop(EXAMPLE_B, { readShebang: (a0) => (a0 === 'node_modules/.bin/tsc' ? '/usr/bin/env node' : null) });
    expect(r.compiled!.nodes[0]).toMatchObject({ argv0Interpreter: '/usr/bin/env node' });
    expect(compileLoop(EXAMPLE_B).compiled!.nodes[0]).not.toHaveProperty('argv0Interpreter');
  });

  it('loop-choice is never standing (defence in depth)', () => {
    expect(NEVER_STANDING_KINDS.has('loop-choice')).toBe(true);
    expect(NEVER_STANDING_KINDS.has('loop-trust')).toBe(true);
  });
});

describe('#loop-schema: canonical compile', () => {
  it('fills every absent budget field with the global default, never unbounded', () => {
    const r = compileLoop(MINIMAL);
    expect(r.ok).toBe(true);
    expect(r.compiled!.budgets).toEqual(LOOP_BUDGET_DEFAULTS);
    const a = compileLoop(EXAMPLE_A).compiled!;
    expect(a.budgets.run).toEqual({ rounds: 8, wallMin: 15, tokens: 400_000, computeSec: 300 });
    expect(a.budgets.day).toEqual({ runs: 12, tokens: 2_000_000, computeSec: 7200 });
    expect(a.budgets.escalations).toEqual({ perRun: 0, perDay: 0 });
    const custom = compileLoop(MINIMAL, { budgetDefaults: { ...clone(LOOP_BUDGET_DEFAULTS) as any, run: { rounds: 2, wallMin: 5, tokens: 10, computeSec: 60 } } }).compiled!;
    expect(custom.budgets.run.rounds).toBe(2);
  });

  it('normalizes durations, counts, defaults and edges', () => {
    const b = compileLoop(EXAMPLE_B).compiled!;
    expect(b.budgets.run.tokens).toBe(400_000);
    expect(b.nodes[0]).toMatchObject({ effect: 'read', timeoutSec: 600, on: { pass: '@goal', fail: 'fix', error: '@stop' } });
    expect(b.nodes[1]).toMatchObject({ model: { use: 'local', escalate: 'never', profile: 'coder', minConfidence: 0.7 }, limits: { turns: 20, tokens: 80_000 }, tools: ['read', 'edit'] });
    expect(b.nodes[1]!.on).toEqual({ pass: 'tsc', fail: 'tsc', unsure: 'ask', unavailable: 'ask', error: '@stop' });
    expect(b.nodes[2]!.on).toEqual({ continue: 'fix', stop: '@stop', timeout: '@pause' });
    expect(b.land).toEqual({ paths: ['packages/gnomon/src/**'], message: 'fix(#gnomon): typecheck green, loop round {{round}}', maxWaitMin: 120 });
    const a = compileLoop(EXAMPLE_A).compiled!;
    expect(a.triggers[1]).toEqual({ type: 'event', kind: 'file.changed', flow: '$checkout-flow', debounceSec: 300 });
    expect(a.nodes[5]!.on).toEqual({ pass: '@stop' });
    const d = compileLoop(EXAMPLE_D).compiled!;
    expect(d.nodes[1]!.on).toEqual({ pass: 'tell', fail: 'tell', unsure: 'tell', unavailable: 'tell', error: 'tell' });
    expect(d.triggers[0]).toEqual({ type: 'schedule', daily: '18:30', catchUp: 'once' });
    const c = compileLoop(EXAMPLE_C).compiled!;
    expect(c.nodes[1]).toMatchObject({ callee: 'green-typecheck-gnomon', hash8: PIN_B });
  });

  it('is stable: key order of the input never changes the output', () => {
    const reversed = (v: unknown): unknown =>
      Array.isArray(v) ? v.map(reversed) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).reverse().map(([k, x]) => [k, reversed(x)])) : v;
    for (const ex of [EXAMPLE_A, EXAMPLE_B, EXAMPLE_C, EXAMPLE_D]) {
      const one = canonicalLoopJson(compileLoop(ex).compiled!);
      const two = canonicalLoopJson(compileLoop(reversed(ex)).compiled!);
      expect(two).toBe(one);
      expect(loopFileJson(compileLoop(reversed(ex)).compiled!)).toBe(loopFileJson(compileLoop(ex).compiled!));
      expect(JSON.parse(loopFileJson(compileLoop(ex).compiled!))).toEqual(JSON.parse(one));
    }
    const file = loopFileJson(compileLoop(MINIMAL).compiled!);
    expect(file.endsWith('}\n')).toBe(true);
    const keys = Object.keys(JSON.parse(file));
    expect(keys).toEqual([...keys].sort());
  });

  it('leaves flows symbolic with a warning when no flow index is given; resolves them when it is', () => {
    const sym = compileLoop(EXAMPLE_A);
    expect(sym.warnings.map((w) => w.code)).toContain('FLOWS_UNRESOLVED');
    expect(sym.compiled!.compiled.flowsResolved).toBe(false);
    expect(sym.compiled!.flowPaths).toBeUndefined();
    const idx = { '$checkout-flow': ['packages/checkout/**', 'packages/cart/**'] };
    const res = compileLoop(EXAMPLE_A, { flowIndex: idx });
    expect(res.warnings.map((w) => w.code)).not.toContain('FLOWS_UNRESOLVED');
    expect(res.compiled!.compiled.flowsResolved).toBe(true);
    expect(res.compiled!.flowPaths).toEqual(idx);
    expect(res.compiled!.triggers[1]).toMatchObject({ paths: idx['$checkout-flow'] });
    expect(issue(EXAMPLE_A, 'UNKNOWN_FLOW', { flowIndex: {} })?.path).toBe('flows[0]');
  });

  it('refuses to compile an invalid definition', () => {
    const r = compileLoop(mut(MINIMAL, (d) => { d.nodes[0].run = ['npx', 'x']; }));
    expect(r.ok).toBe(false);
    expect(r.compiled).toBeUndefined();
  });

  it('parses durations and counts', () => {
    expect(parseDurationSec('2m')).toBe(120);
    expect(parseDurationSec('1d')).toBe(86_400);
    expect(parseDurationSec(90)).toBe(90);
    expect(parseDurationSec('soon')).toBeNull();
    expect(parseCount('2M')).toBe(2_000_000);
    expect(parseCount('1.5k')).toBe(1500);
    expect(parseCount(0)).toBeNull();
  });
});

// ── TD-2026-10-23-268: env on check and act nodes, redact at the loop level ──────────────────────────────────────

describe('TD-2026-10-23-268: env and redact', () => {
  const withEnv = (envTsc: unknown, envFix?: unknown, redact?: unknown): Def => {
    const d = clone(EXAMPLE_B);
    const nodes = d.nodes as any[];
    nodes[0].env = envTsc;
    if (envFix !== undefined) nodes[1].env = envFix;
    if (redact !== undefined) d.redact = redact;
    return d;
  };
  it('a check and an act node may name secrets; they compile as names, redact off compiles, on and absent do not', () => {
    const r = compileLoop(withEnv(['STRIPE_KEY', 'DATABASE_URL', 'ANTHROPIC_API_KEY', 'AWS_SECRET_ACCESS_KEY'], ['GITHUB_TOKEN'], 'off'));
    expect(r.errors).toEqual([]);
    const [tsc, fix] = r.compiled!.nodes as any[];
    expect(tsc.env).toEqual(['STRIPE_KEY', 'DATABASE_URL', 'ANTHROPIC_API_KEY', 'AWS_SECRET_ACCESS_KEY']);
    expect(fix.env).toEqual(['GITHUB_TOKEN']);
    expect(r.compiled!.redact).toBe('off');
    expect(compileLoop(withEnv([], undefined, 'on')).compiled).not.toHaveProperty('redact');
    expect((compileLoop(withEnv([])).compiled!.nodes[0] as any).env).toBeUndefined();
    // a loop that uses neither compiles exactly as before (its hash does not move)
    const noSource = (c: any): string => canonicalLoopJson({ ...c, compiled: { ...c.compiled, sourceHash: undefined } });
    expect(noSource(compileLoop(withEnv([], undefined, 'on')).compiled!)).toBe(noSource(compileLoop(EXAMPLE_B).compiled!));
    // a YAML 1.1 boolean is accepted
    expect(compileLoop(withEnv([], undefined, false)).compiled!.redact).toBe('off');
  });
  it('hazard names are refused at validate: GNOMON_*, NODE_OPTIONS, NODE_PATH, DYLD_*, LD_* and kernel-set names; tool settings are not', () => {
    for (const n of ['GNOMON_SOCK', 'GNOMON_HOME', 'NODE_OPTIONS', 'NODE_PATH', 'DYLD_INSERT_LIBRARIES', 'LD_PRELOAD', 'HOME', 'PATH', 'TMPDIR', 'USER']) {
      const v = validateLoop(withEnv([n]));
      expect(v.errors.map((e) => [e.path, e.code]), n).toEqual([['nodes[0].env[0]', 'ENV_REFUSED']]);
    }
    expect(validateLoop(withEnv(['CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CONFIG_DIR', 'ANTHROPIC_BASE_URL', 'BASH_ENV', 'GIT_CONFIG_GLOBAL', 'PYTHONPATH'])).ok).toBe(true);
  });
  it('envFiles (<= 8, repo-relative without .., ~/ or absolute) and network on|off compile only when used', () => {
    const d = withEnv(['STRIPE_KEY']);
    d.envFiles = ['.env.local', '~/secrets/app.env', '/etc/app.env'];
    d.network = 'on';
    const c = compileLoop(d).compiled!;
    expect(c.envFiles).toEqual(['.env.local', '~/secrets/app.env', '/etc/app.env']);
    expect(c.network).toBe('on');
    const off = withEnv([]);
    off.network = 'off';
    off.envFiles = [];
    expect(compileLoop(off).compiled).not.toHaveProperty('network');
    expect(compileLoop(off).compiled).not.toHaveProperty('envFiles');
    const bad = (files: unknown): string[] => validateLoop({ ...withEnv([]), envFiles: files }).errors.map((e) => e.code);
    expect(bad(['../up.env'])).toEqual(['BAD_ENV_FILE']);
    expect(bad(['~x/a.env'])).toEqual(['BAD_ENV_FILE']);
    expect(bad(['a\\b.env'])).toEqual(['BAD_ENV_FILE']);
    expect(bad(['a.env', 'a.env'])).toEqual(['ENV_FILE_DUPLICATE']);
    expect(bad(Array.from({ length: 9 }, (_, i) => `e${i}.env`))).toEqual(['ENV_FILES_TOO_MANY']);
    expect(bad('a.env')).toEqual(['BAD_TYPE']);
    expect(validateLoop({ ...withEnv([]), network: 'maybe' }).errors.map((e) => e.code)).toEqual(['BAD_ENUM']);
    // Aegis L1: a config tools run is never an env file; a .env* dotenv is
    expect(bad(['package.json'])).toEqual(['ENV_FILE_CONFIG']);
    expect(bad(['cfg/tsconfig.json'])).toEqual(['ENV_FILE_CONFIG']);
    expect(bad(['vitest.config.ts'])).toEqual(['ENV_FILE_CONFIG']);
    expect(bad(['.env.loop', '.env.local', 'cfg/app.env'])).toEqual([]);
    // Aegis M4 (G-LOOP-22): the loop's repo env files are protected from act edits; out-of-repo ones are not repo paths
    const prot = compileLoop({ ...withEnv(['STRIPE_KEY']), envFiles: ['./.env.loop', 'cfg/app.env', '~/s.env', '/etc/x.env'] }).compiled!.protected;
    expect(prot).toEqual(expect.arrayContaining(['.env.loop', 'cfg/app.env']));
    expect(prot.some((x) => x.includes('s.env') || x.includes('/etc'))).toBe(false);
  });
  it('the shape: names match ^[A-Z_][A-Z0-9_]*$, at most 32, no duplicates; judge and summarize take no env; redact is on|off', () => {
    expect(validateLoop(withEnv(['stripe_key'])).errors.map((e) => e.code)).toEqual(['BAD_ENV_NAME']);
    expect(validateLoop(withEnv(['1KEY'])).errors.map((e) => e.code)).toEqual(['BAD_ENV_NAME']);
    expect(validateLoop(withEnv('STRIPE_KEY')).errors.map((e) => e.code)).toEqual(['BAD_TYPE']);
    expect(validateLoop(withEnv(['A', 'A'])).errors.map((e) => e.code)).toEqual(['ENV_DUPLICATE']);
    expect(validateLoop(withEnv(Array.from({ length: 33 }, (_, i) => `K${i}`))).errors.map((e) => e.code)).toEqual(['ENV_TOO_MANY']);
    expect(validateLoop(withEnv(Array.from({ length: 32 }, (_, i) => `K${i}`))).ok).toBe(true);
    expect(validateLoop(withEnv([], undefined, 'maybe')).errors.map((e) => [e.path, e.code])).toEqual([['redact', 'BAD_ENUM']]);
    const a = clone(EXAMPLE_A);
    (a.nodes as any[])[4].env = ['STRIPE_KEY'];
    expect(validateLoop(a).errors.map((e) => [e.path, e.code])).toEqual([['nodes[4].env', 'ENV_NOT_ALLOWED']]);
    const n = clone(EXAMPLE_A);
    (n.nodes as any[])[5].env = ['STRIPE_KEY'];
    expect(validateLoop(n).errors.map((e) => e.code)).toEqual(['UNKNOWN_KEY']);
  });
});
