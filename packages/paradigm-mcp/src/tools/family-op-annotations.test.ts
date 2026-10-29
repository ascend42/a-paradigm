/**
 * #tool-family — per-op annotations of family tools, served as the MCP resource
 * paradigm://tool-annotations (schema io.gnomon/op-annotations:v1), never in tools/list.
 *
 * Generated over the real registry: every family (default + on-demand) is
 * checked op by op against its underlying legacy definition. Nothing here is
 * hand-listed, so a new op or a changed annotation is covered automatically.
 */
import { describe, it, expect, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ListToolsRequestSchema, CallToolRequestSchema, ListResourcesRequestSchema, ReadResourceRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { buildRegistry, buildToolSurface, registerTools } from './index.js';
import { registerResources } from '../resources/index.js';
import { FAMILY_META, LOCAL_ONLY_OPS } from './families.js';
import { familyOpsFromMap, OP_ANNOTATIONS_RESOURCE_URI, OP_ANNOTATIONS_SCHEMA } from '../utils/tool-family.js';
import { invalidateFeatureCache } from '../utils/tool-registry.js';
import type { ProjectContext } from '../utils/index-loader.js';

const HINTS = ['readOnlyHint', 'destructiveHint', 'idempotentHint', 'openWorldHint'];
type Doc = { schema: string; tools: Record<string, Record<string, Record<string, boolean>>> };

/** Independent oracle: the boolean hints the legacy definition itself declares. */
function declared(ann: Record<string, unknown> | undefined): Record<string, boolean> | undefined {
  const out: Record<string, boolean> = {};
  for (const [k, v] of Object.entries(ann ?? {})) if (HINTS.includes(k) && typeof v === 'boolean') out[k] = v;
  return Object.keys(out).length ? out : undefined;
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'op-annotations-'));
// The real surface: legacyDefs is every per-op definition by its own name
// (including paradigm_tags, whose family shares its name).
const surface = buildToolSurface(buildRegistry(root));
const opsByFamily = familyOpsFromMap();
const familyNames = FAMILY_META.filter(m => !m.plain).map(m => m.name);

function expectedFor(name: string): Record<string, Record<string, boolean>> {
  const out: Record<string, Record<string, boolean>> = {};
  for (const [op, legacy] of Object.entries(opsByFamily.get(name)!)) {
    const d = declared(surface.legacyDefs.get(legacy)?.annotations);
    if (d) out[op] = d;
  }
  return out;
}

/** A server wired like src/index.ts: tools + resources sharing the live listing. */
function wire() {
  invalidateFeatureCache();
  const handlers = new Map<unknown, (req: { params: Record<string, unknown> }) => Promise<any>>();
  const server = {
    setRequestHandler: (schema: unknown, h: any) => { handlers.set(schema, h); },
    sendToolListChanged: async () => {},
  };
  const ctx = { rootDir: root, index: {}, aggregation: { purposeFiles: [], symbols: [] }, gateConfig: null, projectName: 'x', wisdom: null, history: null } as unknown as ProjectContext;
  const tools = registerTools(server as any, () => ctx, async () => {});
  registerResources(server as any, () => ctx, { opAnnotations: tools.opAnnotations });
  return {
    listTools: async () => (await handlers.get(ListToolsRequestSchema)!({ params: {} })).tools as Array<Record<string, unknown>>,
    listResources: async () => (await handlers.get(ListResourcesRequestSchema)!({ params: {} })).resources as Array<Record<string, string>>,
    read: async () => (await handlers.get(ReadResourceRequestSchema)!({ params: { uri: OP_ANNOTATIONS_RESOURCE_URI } })).contents[0] as { uri: string; mimeType: string; text: string },
    call: (name: string, args: Record<string, unknown>) => handlers.get(CallToolRequestSchema)!({ params: { name, arguments: args } }),
  };
}

afterAll(() => { fs.rmSync(root, { recursive: true, force: true }); });

describe('family op annotations (generated, every family)', () => {
  it('covers every non-plain family', () => {
    expect(familyNames.length).toBeGreaterThan(0);
    for (const name of familyNames) expect(surface.families.has(name), name).toBe(true);
  });

  for (const name of familyNames) {
    it(`${name}: op map equals each op's declared annotations; undeclared ops are absent`, () => {
      const map = surface.families.get(name)!.opAnnotations;
      expect(map).toEqual(expectedFor(name));
      for (const [op, hints] of Object.entries(map)) {
        expect(op in opsByFamily.get(name)!, `${name}.${op}`).toBe(true);
        for (const k of Object.keys(hints)) expect(HINTS).toContain(k);
      }
    });

    it(`${name}: top-level annotations hold for every op`, () => {
      const ann = surface.families.get(name)!.definition.annotations as Record<string, boolean>;
      const perOp = Object.values(opsByFamily.get(name)!).map(l => declared(surface.legacyDefs.get(l)?.annotations));
      // readOnlyHint true ⇔ every op declares read-only.
      expect(ann.readOnlyHint).toBe(perOp.every(a => a?.readOnlyHint === true));
      // destructiveHint false ⇒ no op is (declared or defaulted) destructive.
      if (ann.destructiveHint === false) {
        for (const a of perOp) {
          expect(a, `${name}: undeclared op under destructiveHint:false`).toBeDefined();
          expect(a!.destructiveHint === false || (a!.readOnlyHint === true && a!.destructiveHint !== true)).toBe(true);
        }
      }
      if (perOp.some(a => a?.destructiveHint === true)) expect(ann.destructiveHint).toBe(true);
      if (ann.idempotentHint === true) expect(perOp.every(a => a?.idempotentHint === true)).toBe(true);
      if (ann.openWorldHint === false) expect(perOp.every(a => a?.openWorldHint === false)).toBe(true);
      if (perOp.some(a => a?.openWorldHint === true)) expect(ann.openWorldHint).toBe(true);
    });
  }
});

describe(`resource ${OP_ANNOTATIONS_RESOURCE_URI}`, () => {
  it('is listed as application/json', async () => {
    const res = (await wire().listResources()).find(r => r.uri === OP_ANNOTATIONS_RESOURCE_URI);
    expect(res?.mimeType).toBe('application/json');
  });

  it('content matches each exposed op\'s declared hints; keys are exactly the exposed family tools', async () => {
    const w = wire();
    const content = await w.read();
    expect(content.uri).toBe(OP_ANNOTATIONS_RESOURCE_URI);
    expect(content.mimeType).toBe('application/json');
    const doc = JSON.parse(content.text) as Doc;
    expect(doc.schema).toBe(OP_ANNOTATIONS_SCHEMA);
    // TD-2026-10-27-833: a constant over code — every family, whatever is listed
    expect(Object.keys(doc.tools).sort()).toEqual([...surface.families.keys()].sort());
    for (const [name, map] of Object.entries(doc.tools)) expect(map, name).toEqual(expectedFor(name));
    expect(doc.tools.paradigm_task.list.readOnlyHint).toBe(true);
    expect(doc.tools.paradigm_task.create.readOnlyHint).toBe(false);
    // Reported by the builder; visible with --reporter=verbose.
    console.info(`[tool-annotations] ${Object.keys(doc.tools).length} families, ${Buffer.byteLength(content.text)} bytes`);
  });

  it('is a constant over code: activation and the project never change it (TD-2026-10-27-833)', async () => {
    const w = wire();
    const before = (await w.read()).text;
    expect((JSON.parse(before) as Doc).tools.paradigm_sentinel).toEqual(expectedFor('paradigm_sentinel'));
    await w.call('paradigm_tool_activate', { feature: 'sentinel' });
    expect((await w.read()).text).toBe(before);
    // a hostile project: config naming tools and a planted annotation file change nothing
    fs.mkdirSync(path.join(root, '.paradigm'), { recursive: true });
    fs.writeFileSync(path.join(root, '.paradigm', 'config.yaml'), 'mcp:\n  tools:\n    enable: [sentinel, symphony]\n    legacy_listing: true\n');
    fs.writeFileSync(path.join(root, '.paradigm', 'tool-annotations.json'), JSON.stringify({ schema: OP_ANNOTATIONS_SCHEMA, tools: { paradigm_task: { create: { readOnlyHint: true, openWorldHint: false } } } }));
    let after: string;
    try {
      after = (await wire().read()).text;
    } finally {
      fs.rmSync(path.join(root, '.paradigm'), { recursive: true, force: true });
    }
    expect(after).toBe(before);
    expect((JSON.parse(after) as Doc).tools.paradigm_task.create.readOnlyHint).toBe(false);
  });

  it('LOCAL_ONLY_OPS: each is read-only and declares openWorldHint false; network families declare none (TD-2026-10-27-833)', async () => {
    const doc = JSON.parse((await wire().read()).text) as Doc;
    for (const [fam, ops] of Object.entries(LOCAL_ONLY_OPS)) {
      for (const op of ops) expect(doc.tools[fam]?.[op], `${fam}.${op}`).toMatchObject({ readOnlyHint: true, openWorldHint: false });
    }
    // families that reach the network or another process get no stamp (their own declarations stand)
    for (const fam of ['paradigm_symphony', 'paradigm_personas', 'paradigm_platform', 'paradigm_conductor', 'paradigm_loop', 'paradigm_brain', 'paradigm_university', 'paradigm_sentinel']) expect(LOCAL_ONLY_OPS[fam], fam).toBeUndefined();
  });

  it('tools/list carries no op-annotations _meta', async () => {
    const tools = await wire().listTools();
    for (const t of tools) expect(t._meta, t.name as string).toBeUndefined();
    expect(JSON.stringify(tools)).not.toContain('op-annotations');
  });
});
