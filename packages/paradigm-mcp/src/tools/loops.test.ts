/**
 * #loop-mcp / #loop-files — the paradigm_loop family (file ops) over a temp repo: create (yaml, definition,
 * template), update, validate (compiled JSON written, stale JSON removed), list, get, the on-demand listing and
 * the `loops` detector. The YAML forms of the spec examples (8.0 subset) parse and validate.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { registerTools } from './index.js';
import { runLoopOp, runLoopKernelOp, setLoopKernelPort, LOOP_KERNEL_TOOL_NAMES } from './loops.js';
import { invalidateFeatureCache, FEATURE_DETECTORS } from '../utils/tool-registry.js';
import type { ProjectContext } from '../utils/index-loader.js';
import { loadFlowIndex, parseLoopYaml, validateLoopFile, validateAllLoops } from '../utils/loop-files.js';
import { loopTemplate, LOOP_TEMPLATE_NAMES } from '../utils/loop-templates.js';
import { loopContentHash, validateLoop } from '@a-company/gnomon/loops';

let root: string;

function stubCtx(rootDir: string): ProjectContext {
  return {
    rootDir,
    index: {} as ProjectContext['index'],
    aggregation: { purposeFiles: [], symbols: [] } as unknown as ProjectContext['aggregation'],
    gateConfig: null,
    projectName: 'loops',
    wisdom: null,
    history: null,
  };
}

function server(rootDir: string) {
  invalidateFeatureCache();
  const handlers = new Map<unknown, (req: { params: Record<string, unknown> }) => Promise<any>>();
  const s = { setRequestHandler: (schema: unknown, h: any) => { handlers.set(schema, h); }, sendToolListChanged: vi.fn(async () => {}) };
  registerTools(s as any, () => stubCtx(rootDir), async () => {});
  return {
    list: async () => ((await handlers.get(ListToolsRequestSchema)!({ params: {} })).tools as Array<{ name: string }>).map((t) => t.name),
    call: async (name: string, args: Record<string, unknown>) =>
      (await handlers.get(CallToolRequestSchema)!({ params: { name, arguments: args } })) as { content: Array<{ text: string }>; isError?: boolean },
  };
}

const lastJson = (text: string) => JSON.parse(text.slice(text.indexOf('{')));
const loopsDir = () => path.join(root, '.paradigm', 'loops');
const file = (name: string) => path.join(loopsDir(), name);

const GOOD_YAML = `schema: loop:v2
id: tiny
start: a
nodes:
  - { id: a, type: check, run: [node_modules/.bin/tsc, --noEmit], on: { pass: '@stop' } }
`;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'loops-mcp-'));
  fs.mkdirSync(path.join(root, '.paradigm'), { recursive: true });
});
afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe('paradigm_loop file ops', () => {
  it('create writes the YAML and the compiled JSON; a second create is refused', () => {
    const r = runLoopOp(root, 'create', { yaml: GOOD_YAML });
    expect(r).toMatchObject({ id: 'tiny', ok: true, written: true, file: '.paradigm/loops/tiny.yaml', compiledFile: '.paradigm/loops/tiny.loop.json' });
    expect(fs.readFileSync(file('tiny.yaml'), 'utf8')).toBe(GOOD_YAML);
    const compiled = JSON.parse(fs.readFileSync(file('tiny.loop.json'), 'utf8'));
    expect(compiled).toMatchObject({ schema: 'loop:v2', id: 'tiny', budgets: { run: { rounds: 8 } } });
    expect(runLoopOp(root, 'create', { yaml: GOOD_YAML })).toMatchObject({ error: expect.stringContaining('already exists') });
  });

  it('create from a definition object dumps YAML', () => {
    const def = parseLoopYaml(GOOD_YAML).value as Record<string, unknown>;
    const r = runLoopOp(root, 'create', { definition: { ...def, id: 'from-object' } });
    expect(r).toMatchObject({ ok: true, id: 'from-object' });
    expect(fs.existsSync(file('from-object.yaml'))).toBe(true);
  });

  it('an invalid definition is never written; issues carry paths and codes', () => {
    const bad = GOOD_YAML.replace('node_modules/.bin/tsc', 'npx');
    const r = runLoopOp(root, 'create', { yaml: bad });
    expect(r).toMatchObject({ ok: false, written: false });
    expect((r.errors as any[])[0]).toMatchObject({ path: 'nodes[0].run[0]', code: 'ARGV0_INTERPRETER' });
    expect(fs.existsSync(file('tiny.yaml'))).toBe(false);
    const later = runLoopOp(root, 'create', { yaml: GOOD_YAML.replace('start: a', 'start: a\ntriggers: [{ schedule: { cron: "0 * * * *" } }]') });
    expect((later.errors as any[]).map((e) => e.code)).toContain('LANDS_IN_8_1');
    expect(runLoopOp(root, 'create', { yaml: 'schema: [unclosed' })).toMatchObject({ error: expect.any(String) });
  });

  it('the file name must match the id', () => {
    const r = runLoopOp(root, 'create', { id: 'other', yaml: GOOD_YAML });
    expect((r.errors as any[]).map((e) => e.code)).toContain('FILE_ID_MISMATCH');
  });

  it('update replaces an existing loop and refuses a missing one', () => {
    runLoopOp(root, 'create', { yaml: GOOD_YAML });
    const next = GOOD_YAML.replace('start: a', 'title: Tiny\nstart: a');
    expect(runLoopOp(root, 'update', { id: 'tiny', yaml: next })).toMatchObject({ ok: true });
    expect(JSON.parse(fs.readFileSync(file('tiny.loop.json'), 'utf8')).title).toBe('Tiny');
    expect(runLoopOp(root, 'update', { id: 'nope', yaml: GOOD_YAML.replace('id: tiny', 'id: nope') })).toMatchObject({ error: expect.stringContaining('use create') });
  });

  it('validate writes the compiled JSON on success and removes a stale one on failure', () => {
    fs.mkdirSync(loopsDir(), { recursive: true });
    fs.writeFileSync(file('tiny.yaml'), GOOD_YAML);
    const ok = runLoopOp(root, 'validate', {});
    expect(ok).toMatchObject({ ok: true, results: [{ id: 'tiny', ok: true, compiledFile: '.paradigm/loops/tiny.loop.json' }] });
    const first = fs.readFileSync(file('tiny.loop.json'), 'utf8');
    runLoopOp(root, 'validate', { id: 'tiny' });
    expect(fs.readFileSync(file('tiny.loop.json'), 'utf8')).toBe(first); // stable
    fs.writeFileSync(file('tiny.yaml'), GOOD_YAML.replace('start: a', 'start: a\nshell: true'));
    const bad = runLoopOp(root, 'validate', { id: 'tiny' });
    expect(bad).toMatchObject({ results: [{ ok: false, removedStale: true }] });
    expect(fs.existsSync(file('tiny.loop.json'))).toBe(false);
  });

  it('list reports validity and the compiled state; get returns YAML, issues and compiled JSON', () => {
    fs.mkdirSync(loopsDir(), { recursive: true });
    fs.writeFileSync(file('tiny.yaml'), GOOD_YAML);
    expect(runLoopOp(root, 'list', {})).toEqual({ loops: [expect.objectContaining({ id: 'tiny', ok: true, compiled: 'missing' })], orphans: [] });
    runLoopOp(root, 'validate', {});
    expect((runLoopOp(root, 'list', {}).loops as any[])[0].compiled).toBe('fresh');
    fs.writeFileSync(file('tiny.yaml'), GOOD_YAML.replace('start: a', 'title: Changed\nstart: a'));
    expect((runLoopOp(root, 'list', {}).loops as any[])[0]).toMatchObject({ compiled: 'stale', title: 'Changed' });
    const got = runLoopOp(root, 'get', { id: 'tiny' });
    expect(got).toMatchObject({ id: 'tiny', ok: true, yaml: expect.stringContaining('title: Changed') });
    expect((got.compiled as any).id).toBe('tiny');
    expect(runLoopOp(root, 'get', { id: 'ghost' })).toMatchObject({ error: expect.any(String) });
  });

  it('validate sees the other loops: a call to an unknown loop and a call cycle are refused', () => {
    const caller = (id: string, callee: string) => `schema: loop:v2\nid: ${id}\nstart: c\nnodes:\n  - { id: c, type: call, loop: ${callee}@0123abcd, on: { pass: '@stop' } }\n`;
    fs.mkdirSync(loopsDir(), { recursive: true });
    fs.writeFileSync(file('a.yaml'), caller('a', 'b'));
    expect(((runLoopOp(root, 'validate', { id: 'a' }).results as any[])[0].errors as any[]).map((e) => e.code)).toContain('UNKNOWN_CALLEE');
    fs.writeFileSync(file('b.yaml'), caller('b', 'a'));
    const r = runLoopOp(root, 'validate', {});
    expect((r.results as any[]).every((x) => x.errors.some((e: any) => e.code === 'CALL_CYCLE'))).toBe(true);
  });

  it('flows resolve through .paradigm/flow-index.json', () => {
    fs.writeFileSync(path.join(root, '.paradigm', 'flow-index.json'), JSON.stringify({
      flows: { '$checkout-flow': { id: '$checkout-flow', definedIn: 'packages/checkout/.purpose', steps: [{ symbol: '#cart' }] } },
    }));
    fs.writeFileSync(path.join(root, '.paradigm', 'scan-index.json'), JSON.stringify({
      components: { cart: { symbol: '#cart', path: path.join(root, 'packages', 'cart', '.purpose') } },
    }));
    expect(loadFlowIndex(root)).toEqual({ '$checkout-flow': ['packages/cart/**', 'packages/checkout/**'] });
    const r = runLoopOp(root, 'create', { id: 'health', template: 'flow-health' });
    expect(r).toMatchObject({ ok: true });
    const compiled = JSON.parse(fs.readFileSync(file('health.loop.json'), 'utf8'));
    expect(compiled.flowPaths).toEqual({ '$checkout-flow': ['packages/cart/**', 'packages/checkout/**'] });
    expect(compiled.compiled.flowsResolved).toBe(true);
  });

  it('a flow index written on Windows resolves to the same globs (never widens to **)', () => {
    fs.writeFileSync(path.join(root, '.paradigm', 'flow-index.json'), JSON.stringify({
      flows: {
        '$checkout-flow': { id: '$checkout-flow', definedIn: 'packages\\checkout\\.purpose', steps: [{ symbol: '#cart' }] },
        '$elsewhere': { id: '$elsewhere', definedIn: 'D:\\other\\repo\\.purpose' },
      },
    }));
    fs.writeFileSync(path.join(root, '.paradigm', 'scan-index.json'), JSON.stringify({
      components: { cart: { symbol: '#cart', path: 'packages\\cart\\.purpose' } },
    }));
    const idx = loadFlowIndex(root)!;
    expect(idx['$checkout-flow']).toEqual(['packages/cart/**', 'packages/checkout/**']);
    expect(idx['$elsewhere']).not.toContain('**');
  });
});

describe('Aegis LP1 review: file hardening', () => {
  it('refuses a symlinked loops dir and a symlinked loop file; never writes through a symlink', () => {
    const elsewhere = fs.mkdtempSync(path.join(os.tmpdir(), 'loops-elsewhere-'));
    try {
      fs.symlinkSync(elsewhere, loopsDir());
      expect(runLoopOp(root, 'create', { yaml: GOOD_YAML })).toMatchObject({ error: expect.stringContaining('symlink') });
      expect(fs.readdirSync(elsewhere)).toEqual([]);
      expect(runLoopOp(root, 'list', {})).toMatchObject({ error: expect.stringContaining('symlink') });
      fs.unlinkSync(loopsDir());
      fs.mkdirSync(loopsDir());
      fs.writeFileSync(path.join(elsewhere, 'tiny.yaml'), GOOD_YAML);
      fs.symlinkSync(path.join(elsewhere, 'tiny.yaml'), file('tiny.yaml'));
      const r = runLoopOp(root, 'validate', { id: 'tiny' });
      expect((r.results as any[])[0]).toMatchObject({ ok: false, errors: [expect.objectContaining({ code: 'SYMLINK' })] });
      expect(runLoopOp(root, 'update', { id: 'tiny', yaml: GOOD_YAML })).toMatchObject({ error: expect.stringContaining('symlink') });
      expect(fs.readFileSync(path.join(elsewhere, 'tiny.yaml'), 'utf8')).toBe(GOOD_YAML);
      fs.unlinkSync(file('tiny.yaml'));
      // a symlink at the compiled target is replaced, never followed
      fs.writeFileSync(file('tiny.yaml'), GOOD_YAML);
      fs.writeFileSync(path.join(elsewhere, 'victim.json'), 'keep');
      fs.symlinkSync(path.join(elsewhere, 'victim.json'), file('tiny.loop.json'));
      expect((runLoopOp(root, 'validate', { id: 'tiny' }).results as any[])[0].ok).toBe(true);
      expect(fs.readFileSync(path.join(elsewhere, 'victim.json'), 'utf8')).toBe('keep');
      expect(fs.lstatSync(file('tiny.loop.json')).isFile()).toBe(true);
    } finally {
      fs.rmSync(elsewhere, { recursive: true, force: true });
    }
  });

  it('validate accepts only files directly in .paradigm/loops/', () => {
    fs.mkdirSync(path.join(root, 'other'), { recursive: true });
    fs.writeFileSync(path.join(root, 'other', 'tiny.yaml'), GOOD_YAML);
    expect(validateLoopFile(root, 'other/tiny.yaml').errors[0]!.code).toBe('NOT_IN_LOOPS_DIR');
    expect(validateLoopFile(root, '.paradigm/loops/../../other/tiny.yaml').errors[0]!.code).toBe('NOT_IN_LOOPS_DIR');
    expect(fs.existsSync(path.join(root, 'other', 'tiny.loop.json'))).toBe(false);
  });

  it('orphan compiled JSON is reported by list and removed by validate --all; stale cleanup runs even with write:false', () => {
    runLoopOp(root, 'create', { yaml: GOOD_YAML });
    fs.unlinkSync(file('tiny.yaml'));
    expect(runLoopOp(root, 'list', {})).toMatchObject({ loops: [], orphans: ['.paradigm/loops/tiny.loop.json'] });
    expect(runLoopOp(root, 'validate', {})).toMatchObject({ removedOrphans: ['.paradigm/loops/tiny.loop.json'] });
    expect(fs.existsSync(file('tiny.loop.json'))).toBe(false);
    runLoopOp(root, 'create', { yaml: GOOD_YAML });
    fs.writeFileSync(file('tiny.yaml'), GOOD_YAML.replace('start: a', 'start: a\nshell: true'));
    const r = validateAllLoops(root, { write: false });
    expect(r.results[0]).toMatchObject({ ok: false, removedStale: true });
    expect(fs.existsSync(file('tiny.loop.json'))).toBe(false);
  });

  it('YAML .nan and .inf are refused', () => {
    const r = runLoopOp(root, 'create', { yaml: GOOD_YAML.replace('start: a', 'budgets: { run: { rounds: .inf } }\nstart: a') });
    expect((r.errors as any[]).map((e) => e.code)).toContain('NON_FINITE');
    const n = runLoopOp(root, 'create', { yaml: GOOD_YAML.replace('start: a', 'budgets: { day: { runs: .nan } }\nstart: a') });
    expect((n.errors as any[]).map((e) => e.code)).toContain('NON_FINITE');
  });

  it('call pins are checked against the callee file (hash of the parsed YAML) and argv0 shebangs are recorded', () => {
    fs.mkdirSync(path.join(root, 'node_modules', '.bin'), { recursive: true });
    fs.writeFileSync(path.join(root, 'node_modules', '.bin', 'tsc'), '#!/usr/bin/env node\nrequire("x");\n');
    runLoopOp(root, 'create', { yaml: GOOD_YAML });
    const compiled = JSON.parse(fs.readFileSync(file('tiny.loop.json'), 'utf8'));
    expect(compiled.nodes[0].argv0Interpreter).toBe('/usr/bin/env node');
    expect(compiled.protected).toEqual(expect.arrayContaining(['node_modules/**', 'node_modules/.bin/tsc']));
    const pin = loopContentHash(parseLoopYaml(GOOD_YAML).value).slice(0, 8);
    const caller = (h: string) => `schema: loop:v2\nid: caller\nstart: c\nnodes:\n  - { id: c, type: call, loop: tiny@${h}, on: { any: '@stop' } }\n`;
    expect(runLoopOp(root, 'create', { yaml: caller('00000000') })).toMatchObject({ ok: false, errors: [expect.objectContaining({ code: 'CALL_PIN_MISMATCH' })] });
    expect(runLoopOp(root, 'create', { yaml: caller(pin) })).toMatchObject({ ok: true });
    // reformatting the callee YAML (same parsed definition) keeps the pin
    fs.writeFileSync(file('tiny.yaml'), `# comment\n${GOOD_YAML}`);
    expect((runLoopOp(root, 'validate', { id: 'caller' }).results as any[])[0].ok).toBe(true);
  });
});

describe('templates (spec Examples A–D, 8.0 subset)', () => {
  it.each(LOOP_TEMPLATE_NAMES.map((n) => [n]))('the %s template parses and validates', (name) => {
    const text = loopTemplate(`ex-${name}`, name, { flow: '$checkout-flow' });
    const parsed = parseLoopYaml(text);
    expect(parsed.error).toBeUndefined();
    const r = validateLoop(parsed.value);
    expect(r.errors).toEqual([]);
  });

  it('the default template validates and create writes every template (template, or its older name example)', () => {
    expect(validateLoop(parseLoopYaml(loopTemplate('plain')).value).errors).toEqual([]);
    for (const name of LOOP_TEMPLATE_NAMES) expect(runLoopOp(root, 'create', { id: `ex-${name}`, template: name })).toMatchObject({ ok: true });
    expect(runLoopOp(root, 'create', { id: 'old-name', example: 'tidy' })).toMatchObject({ ok: true });
    expect(runLoopOp(root, 'create', { id: 'x', template: 'nope' })).toMatchObject({ error: expect.stringContaining('template is one of') });
  });

  it('create passes flow and dir to the template and refuses unsafe ones', () => {
    expect(runLoopOp(root, 'create', { id: 'fh', template: 'flow-health', flow: '$checkout-flow' })).toMatchObject({ ok: true });
    expect(fs.readFileSync(file('fh.yaml'), 'utf8')).toContain('flows: [$checkout-flow]');
    expect(runLoopOp(root, 'create', { id: 'gr', template: 'green', dir: 'packages/app' })).toMatchObject({ ok: true });
    expect(fs.readFileSync(file('gr.yaml'), 'utf8')).toContain('-p, packages/app/tsconfig.json');
    expect(runLoopOp(root, 'create', { id: 'bad1', template: 'flow-health', flow: '$x]\nautonomy: act' })).toMatchObject({ error: expect.stringContaining('$kebab-id') });
    expect(runLoopOp(root, 'create', { id: 'bad2', template: 'green', dir: '../elsewhere' })).toMatchObject({ error: expect.stringContaining('repo-relative') });
    expect(fs.existsSync(file('bad1.yaml')) || fs.existsSync(file('bad2.yaml'))).toBe(false);
  });
});

describe('paradigm_loop family surface', () => {
  it('the loops detector fires on .paradigm/loops/', () => {
    expect(FEATURE_DETECTORS.loops!(root)).toBe(false);
    fs.mkdirSync(loopsDir(), { recursive: true });
    expect(FEATURE_DETECTORS.loops!(root)).toBe(true);
  });

  it('on-demand: not listed by default, listed after activation, and family dispatch works', async () => {
    fs.mkdirSync(loopsDir(), { recursive: true });
    const h = server(root);
    expect(await h.list()).not.toContain('paradigm_loop');
    const act = await h.call('paradigm_tool_activate', { feature: 'loops' });
    expect(act.isError).toBeFalsy();
    expect(await h.list()).toContain('paradigm_loop');
    const created = await h.call('paradigm_loop', { op: 'create', yaml: GOOD_YAML });
    expect(lastJson(created.content[0].text)).toMatchObject({ ok: true, id: 'tiny' });
    const listed = await h.call('paradigm_loop', { op: 'list' });
    expect(lastJson(listed.content[0].text).loops[0]).toMatchObject({ id: 'tiny', compiled: 'fresh' });
  });
});

describe('paradigm_loop kernel ops (LP7, build step 12)', () => {
  const sent: Array<Record<string, unknown>> = [];
  beforeEach(() => {
    sent.length = 0;
    setLoopKernelPort(async (p) => {
      sent.push(p);
      return { ok: true, op: p.op };
    });
  });
  afterEach(() => setLoopKernelPort(null));

  it('each op sends one loop.request with the repo target and no principal or hsid (the kernel stamps those)', async () => {
    expect(await runLoopKernelOp(root, 'run', { id: 'tiny' })).toEqual({ ok: true, op: 'run' });
    await runLoopKernelOp(root, 'pause', { id: 'tiny', personal: true });
    await runLoopKernelOp(root, 'resume', { id: 'tiny' });
    await runLoopKernelOp(root, 'delete', { id: 'tiny' });
    await runLoopKernelOp(root, 'runs', { id: 'tiny', limit: 500 });
    await runLoopKernelOp(root, 'logs', { runId: 'lr-abc' });
    await runLoopKernelOp(root, 'trust_status', {});
    expect(sent).toEqual([
      { op: 'run', loopId: 'tiny', scope: 'repo', repo: root },
      { op: 'pause', loopId: 'tiny', scope: 'personal' },
      { op: 'resume', loopId: 'tiny', scope: 'repo', repo: root },
      { op: 'delete', loopId: 'tiny', scope: 'repo', repo: root },
      { op: 'runs', loopId: 'tiny', scope: 'repo', repo: root, limit: 50 },
      { op: 'logs', runId: 'lr-abc', scope: 'repo', repo: root },
      { op: 'trust-status', scope: 'repo', repo: root },
    ]);
    for (const p of sent) expect(Object.keys(p)).not.toContain('principal');
    expect(await runLoopKernelOp(root, 'run', { id: 'Not_Kebab' })).toHaveProperty('error');
    expect(await runLoopKernelOp(root, 'logs', { runId: '../x' })).toHaveProperty('error');
  });

  it('create sends op create with the compiled source hash, so the kernel attributes the file to this agent', async () => {
    const srv = server(root);
    const res = lastJson((await srv.call('paradigm_loop_create', { yaml: GOOD_YAML })).content[0]!.text);
    expect(res.written).toBe(true);
    expect(sent).toHaveLength(1);
    const compiled = JSON.parse(fs.readFileSync(file('tiny.loop.json'), 'utf8'));
    expect(sent[0]).toEqual({ op: 'create', loopId: 'tiny', scope: 'repo', repo: root, sourceHash: compiled.compiled.sourceHash });
    expect(res.kernel).toEqual({ ok: true, op: 'create' });
  });

  it('without a kernel the op says "needs Gnomon running", and create still writes the file', async () => {
    setLoopKernelPort(async () => {
      throw new Error('needs Gnomon running (connect ENOENT)');
    });
    expect(await runLoopKernelOp(root, 'run', { id: 'tiny' })).toMatchObject({ needsGnomon: true, error: expect.stringMatching(/^needs Gnomon running/) });
    const srv = server(root);
    const res = lastJson((await srv.call('paradigm_loop_create', { yaml: GOOD_YAML })).content[0]!.text);
    expect(res.written).toBe(true);
    expect(res.kernel).toMatchObject({ needsGnomon: true });
  });

  it('the default port, with an empty Gnomon home, answers "needs Gnomon running"', async () => {
    setLoopKernelPort(null);
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'loops-mcp-home-'));
    const was = process.env.GNOMON_HOME;
    process.env.GNOMON_HOME = home;
    try {
      expect(await runLoopKernelOp(root, 'pause', { id: 'tiny' })).toMatchObject({ needsGnomon: true, error: expect.stringMatching(/^needs Gnomon running/) });
    } finally {
      if (was === undefined) delete process.env.GNOMON_HOME;
      else process.env.GNOMON_HOME = was;
      fs.rmSync(home, { recursive: true, force: true });
    }
  });

  it('the grouped paradigm_loop tool routes every kernel op', async () => {
    fs.mkdirSync(loopsDir(), { recursive: true });
    const h = server(root);
    await h.call('paradigm_tool_activate', { feature: 'loops' });
    expect(await h.list()).toContain('paradigm_loop');
    for (const n of LOOP_KERNEL_TOOL_NAMES) {
      const op = n.slice('paradigm_loop_'.length);
      const res = await h.call('paradigm_loop', { op, id: 'tiny', runId: 'lr-abc' });
      expect(res.isError ?? false).toBe(false);
    }
    expect(sent.map((p) => p.op)).toEqual(['run', 'pause', 'resume', 'delete', 'runs', 'logs', 'trust-status']);
  });
});
