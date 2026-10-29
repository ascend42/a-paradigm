/**
 * 7.13 MCP surface cut — tools/list budget + family/alias dispatch contract.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { registerTools, listToolDefinitions } from './index.js';
import { LEGACY_TOOL_MAP } from './legacy-tool-map.js';
import { ANCHOR_TOOLS, DEFAULT_FAMILIES, ON_DEMAND } from './families.js';
import { canonicalizeToolRef } from '../utils/tool-family.js';
import { invalidateFeatureCache } from '../utils/tool-registry.js';
import { loadProjectContext, type ProjectContext } from '../utils/index-loader.js';
import { getSessionTracker } from '../utils/session-tracker.js';

const REPO_ROOT = path.resolve(__dirname, '../../../..');
const TOKEN_BUDGET = 8000;
const TOOL_BUDGET = 40;

type Handler = (req: { params: Record<string, unknown> }) => Promise<any>;

function makeServer() {
  const handlers = new Map<unknown, Handler>();
  const server = {
    setRequestHandler: (schema: unknown, h: Handler) => { handlers.set(schema, h); },
    sendToolListChanged: vi.fn(async () => {}),
  };
  return { server, handlers };
}

function register(ctx: ProjectContext) {
  invalidateFeatureCache();
  const { server, handlers } = makeServer();
  registerTools(server as any, () => ctx, async () => {});
  const list = async () => (await handlers.get(ListToolsRequestSchema)!({ params: {} })).tools as Array<Record<string, unknown>>;
  const call = async (name: string, args: Record<string, unknown> = {}) =>
    handlers.get(CallToolRequestSchema)!({ params: { name, arguments: args } }) as Promise<{ content: Array<{ text: string }>; isError?: boolean }>;
  return { server, list, call };
}

function stubCtx(rootDir: string): ProjectContext {
  return {
    rootDir,
    index: {} as ProjectContext['index'],
    aggregation: { purposeFiles: [], symbols: [] } as unknown as ProjectContext['aggregation'],
    gateConfig: null,
    projectName: 'budget',
    wisdom: null,
    history: null,
  };
}

/** A project where every feature detector fires. */
function worstCaseProject(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'budget-worst-'));
  for (const d of ['wisdom', 'history', 'lore', 'tasks', 'protocols', 'agents', 'notebooks', 'university']) {
    fs.mkdirSync(path.join(root, '.paradigm', d), { recursive: true });
  }
  const files: Record<string, string> = {
    '.paradigm/config.yaml': 'project: worst\nsentinel: true\n',
    '.paradigm/habits.yaml': 'habits: []\n',
    '.paradigm/flows.yaml': 'flows: {}\n',
    '.paradigm/fixtures.yaml': 'fixtures: {}\n',
    '.paradigm/agents.yaml': 'agents: {}\n',
    '.paradigm/aspect-graph.db': '',
    '.paradigm/scan-index.json': '{}',
    'nevr.yaml': 'name: x\n',
    'a.persona': 'id: a\n',
  };
  for (const [rel, body] of Object.entries(files)) fs.writeFileSync(path.join(root, rel), body);
  return root;
}

function budget(tools: Array<Record<string, unknown>>) {
  const json = JSON.stringify(tools);
  return { count: tools.length, tokens: Math.ceil(json.length / 4), json };
}

describe('tools/list budget (7.13)', () => {
  it('worst case (all detectors): ≤40 tools, <8000 tokens, no aliases key', async () => {
    const root = worstCaseProject();
    try {
      const { list } = register(stubCtx(root));
      const b = budget(await list());
      expect(b.count).toBeLessThanOrEqual(TOOL_BUDGET);
      expect(b.count).toBe(ANCHOR_TOOLS.length + DEFAULT_FAMILIES.length);
      expect(b.tokens).toBeLessThan(TOKEN_BUDGET);
      expect(b.json).not.toContain('"aliases"');
      // Per-op annotations live in paradigm://tool-annotations, never in tools/list.
      expect(b.json).not.toContain('op-annotations');
      expect(b.json).not.toContain('"_meta"');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('this repo: ≤40 tools, <8000 tokens, no aliases key', async () => {
    const { list } = register(stubCtx(REPO_ROOT));
    const tools = await list();
    const b = budget(tools);
    // Reported by the builder; visible with --reporter=verbose.
    console.info(`[tools-list-budget] repo default: ${b.count} tools, ~${b.tokens} tokens`);
    expect(b.count).toBeLessThanOrEqual(TOOL_BUDGET);
    expect(b.tokens).toBeLessThan(TOKEN_BUDGET);
    expect(b.json).not.toContain('"aliases"');
    expect(b.json).not.toContain('op-annotations');
  });
});

describe('legacy map completeness', () => {
  it('every registered legacy tool name is mapped (to a family op or an anchor)', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'budget-map-'));
    try {
      const listed = new Set([
        ...ANCHOR_TOOLS,
        ...DEFAULT_FAMILIES.map(f => f.name),
        ...ON_DEMAND.map(f => f.name),
      ]);
      const all = listToolDefinitions(root).map(t => t.name);
      const legacy = all.filter(n => !listed.has(n) || LEGACY_TOOL_MAP[n]);
      const unmapped = legacy.filter(n => !LEGACY_TOOL_MAP[n]);
      expect(unmapped).toEqual([]);
      // Map has no stale entries either: every key is a registered definition.
      const stale = Object.keys(LEGACY_TOOL_MAP).filter(k => !all.includes(k));
      expect(stale).toEqual([]);
      // Every target tool exists on the new surface.
      for (const t of Object.values(LEGACY_TOOL_MAP)) expect(listed.has(t.tool)).toBe(true);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('canonicalizeToolRef understands family forms', () => {
    expect(canonicalizeToolRef('paradigm_lore_record')).toEqual(['paradigm_lore_record']);
    expect(canonicalizeToolRef("paradigm_lore({op:'record'})")).toEqual(['paradigm_lore_record']);
    expect(canonicalizeToolRef('paradigm_lore.record')).toEqual(['paradigm_lore_record']);
    expect(canonicalizeToolRef('paradigm_flow')).toEqual(expect.arrayContaining(['paradigm_flow_check', 'paradigm_flows_affected']));
    expect(canonicalizeToolRef('paradigm_search')).toEqual(['paradigm_search']);
  });
});

describe('family + alias dispatch', () => {
  let root: string;
  let ctx: ProjectContext;
  let h: ReturnType<typeof register>;

  beforeAll(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'budget-dispatch-'));
    for (const d of ['lore', 'tasks']) fs.mkdirSync(path.join(root, '.paradigm', d), { recursive: true });
    fs.writeFileSync(path.join(root, '.paradigm', 'config.yaml'), 'project: dispatch\n');
    fs.mkdirSync(path.join(root, 'src'), { recursive: true });
    fs.writeFileSync(path.join(root, 'src', '.purpose'), 'name: src\ndescription: fixture\ncomponents: {}\n');
    ctx = await loadProjectContext(root);
    h = register(ctx);
    await h.call('paradigm_status', { response_format: 'concise' }); // absorb first-call recovery preamble
  });
  afterAll(() => { fs.rmSync(root, { recursive: true, force: true }); });

  const lastTool = () => getSessionTracker().getStats().toolCalls.at(-1)?.toolName;
  const norm = (s: string) => s
    .replace(/\d{4}-\d{2}-\d{2}T[\d:.]+Z/g, '<ts>')
    .replace(/L-\d{4}-\d{2}-\d{2}-[\w-]+/g, '<lore-id>')
    .replace(/T-\d{4}-\d{2}-\d{2}-\d+/g, '<task-id>')
    .replace(/"hashHint": "[0-9a-f]+"/g, '"hashHint": "<h>"')
    .replace(/"bytes": \d+/g, '"bytes": <n>')
    .replace(/(alpha|beta)/g, '<x>');

  it('every map key dispatches while hidden and is absent from tools/list', async () => {
    const listed = new Set((await h.list()).map(t => t.name as string));
    for (const legacy of Object.keys(LEGACY_TOOL_MAP)) {
      const target = LEGACY_TOOL_MAP[legacy];
      if (target.tool === legacy) continue; // anchor / name-collision (paradigm_tags)
      expect(listed.has(legacy), legacy).toBe(false);
    }
    // Spot-dispatch hidden aliases across tiers (core, feature, on-demand, advanced).
    for (const legacy of ['paradigm_lore_search', 'paradigm_task_list', 'paradigm_tags_suggest', 'paradigm_sentinel_stats', 'paradigm_conductor_list', 'paradigm_docs_manifest']) {
      const res = await h.call(legacy, { query: 'x' }).catch((e: Error) => ({ content: [{ text: `THREW ${e.message}` }] }));
      expect(res.content[0].text, legacy).not.toMatch(/Unknown tool/);
    }
  });

  it('deprecated alias writes a deprecation breadcrumb', async () => {
    await h.call('paradigm_lore_search', { query: 'none' });
    const crumbs = getSessionTracker().getBreadcrumbs(5);
    expect(crumbs.some(c => c.action === 'tool-deprecated-alias' && /paradigm_lore\(\{op:'search'\}\)/.test(c.summary))).toBe(true);
  });

  it('lore record/search: legacy and family produce identical output; toolsCalled gets legacy name', async () => {
    const rec = { title: 'alpha', summary: 'summary alpha', type: 'agent-session', symbols_touched: ['#src'] };
    const a = await h.call('paradigm_lore_record', rec);
    const b = await h.call('paradigm_lore', { op: 'record', ...rec, title: 'beta', summary: 'summary beta' });
    expect(lastTool()).toBe('paradigm_lore_record');
    expect(norm(b.content[0].text)).toBe(norm(a.content[0].text));

    const s1 = await h.call('paradigm_lore_search', { query: 'summary' });
    const s2 = await h.call('paradigm_lore', { op: 'search', query: 'summary' });
    expect(lastTool()).toBe('paradigm_lore_search');
    expect(s2.content[0].text).toBe(s1.content[0].text);
  });

  it('purpose add_component: legacy and family identical', async () => {
    const a = await h.call('paradigm_purpose_add_component', { purposeFile: 'src/.purpose', id: 'alpha', description: 'd' });
    const b = await h.call('paradigm_purpose', { op: 'add_component', purposeFile: 'src/.purpose', id: 'beta', description: 'd' });
    expect(lastTool()).toBe('paradigm_purpose_add_component');
    expect(norm(b.content[0].text)).toBe(norm(a.content[0].text));
  });

  it('task create: legacy and family identical', async () => {
    const a = await h.call('paradigm_task_create', { blurb: 'alpha task' });
    const b = await h.call('paradigm_task', { op: 'create', blurb: 'beta task' });
    expect(lastTool()).toBe('paradigm_task_create');
    expect(norm(b.content[0].text)).toBe(norm(a.content[0].text));
  });

  it('op validation: unknown op and missing required params echo the op params', async () => {
    const bad = await h.call('paradigm_lore', { op: 'nope' });
    expect(bad.isError).toBe(true);
    expect(bad.content[0].text).toMatch(/unknown op 'nope'.*Valid ops: .*\brecord\b/);
    const missing = await h.call('paradigm_task', { op: 'create' });
    expect(missing.isError).toBe(true);
    expect(missing.content[0].text).toMatch(/op 'create' missing required: blurb/);
    expect(missing.content[0].text).toMatch(/blurb\*/);
    const noOp = await h.call('paradigm_lore', {});
    expect(noOp.content[0].text).toMatch(/missing required 'op'/);
  });

  it('anchor folds: status check:plugins and reindex scope:workspace resolve to legacy names', async () => {
    await h.call('paradigm_reindex', { scope: 'workspace' });
    expect(lastTool()).toBe('paradigm_workspace_reindex');
  });

  it('tool_activate lists an on-demand family and emits list_changed', async () => {
    const before = (await h.list()).map(t => t.name);
    expect(before).not.toContain('paradigm_sentinel');
    const res = await h.call('paradigm_tool_activate', { feature: 'sentinel' });
    expect(JSON.parse(res.content[0].text).status).toBe('activated');
    expect(h.server.sendToolListChanged).toHaveBeenCalledTimes(1);
    expect((await h.list()).map(t => t.name)).toContain('paradigm_sentinel');
    await h.call('paradigm_tool_activate', { feature: 'sentinel' });
    expect(h.server.sendToolListChanged).toHaveBeenCalledTimes(1); // idempotent
  });
});

describe('config: mcp.tools.enable + legacy_listing', () => {
  it('enable lists on-demand tools; legacy_listing relists the pre-7.13 surface', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'budget-cfg-'));
    try {
      fs.mkdirSync(path.join(root, '.paradigm', 'lore'), { recursive: true });
      const cfg = path.join(root, '.paradigm', 'config.yaml');
      fs.writeFileSync(cfg, 'mcp:\n  tools:\n    enable: [symphony, fixtures]\n');
      const { list } = register(stubCtx(root));
      const names = (await list()).map(t => t.name);
      expect(names).toContain('paradigm_symphony');
      expect(names).toContain('paradigm_test_fixtures');
      expect(names).not.toContain('paradigm_lore_record');

      fs.writeFileSync(cfg, 'mcp:\n  tools:\n    legacy_listing: true\n');
      const withLegacy = await list();
      const legacyNames = withLegacy.map(t => t.name);
      expect(legacyNames).toContain('paradigm_lore');
      expect(legacyNames).toContain('paradigm_lore_record');
      expect(new Set(legacyNames).size).toBe(legacyNames.length);
      expect(JSON.stringify(withLegacy)).not.toContain('"aliases"');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('habits canonical tool names', () => {
  it('tool-called habits match family references and family-form toolsCalled', async () => {
    const { evaluateHabits, buildEvaluationContext } = await import('../utils/habits-loader.js');
    const habit = { id: 'h', name: 'h', description: '', category: 'collaboration', trigger: 'on-stop', severity: 'advisory', enabled: true, check: { type: 'tool-called', params: { tools: ["paradigm_lore({op:'record'})"] } } } as any;
    const ctx = buildEvaluationContext({ toolsCalled: ['paradigm_lore_record'], filesModified: ['a.ts'] });
    expect(evaluateHabits([habit], 'on-stop', ctx).evaluations[0].result).toBe('followed');
    const ctx2 = buildEvaluationContext({ toolsCalled: ['paradigm_lore.record'], filesModified: ['a.ts'] });
    expect(ctx2.toolsCalled).toEqual(['paradigm_lore_record']);
  });
});
