/**
 * Gnomon slice C2' (#capability-index): Paradigm's real tools/list is the golden input of the kernel's narrowing
 * (packages/gnomon/test/capability-index.test.ts). This test keeps that fixture honest: the fixture's tool names
 * must be the live worst-case list's (every feature detector on), and the paradigm://tool-annotations document
 * (S-P) must be the live one. Regenerate with
 * `PARADIGM_TOOLS_FIXTURE=write npx vitest run src/tools/tools-list-fixture.test.ts`.
 */
import { describe, it, expect, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { registerTools } from './index.js';
import { invalidateFeatureCache } from '../utils/tool-registry.js';
import type { ProjectContext } from '../utils/index-loader.js';

const FIXTURE = path.resolve(__dirname, '../../../gnomon/test/fixtures/paradigm-tools-list.json');
const ANN_FIXTURE = path.resolve(__dirname, '../../../gnomon/test/fixtures/paradigm-tool-annotations.json');

function worstCaseProject(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fixture-worst-'));
  for (const d of ['wisdom', 'history', 'lore', 'tasks', 'protocols', 'agents', 'notebooks', 'university']) fs.mkdirSync(path.join(root, '.paradigm', d), { recursive: true });
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

async function liveList(): Promise<{ tools: Array<Record<string, unknown>>; annotations: unknown }> {
  const root = worstCaseProject();
  try {
    invalidateFeatureCache();
    const handlers = new Map<unknown, (req: { params: Record<string, unknown> }) => Promise<any>>();
    const server = { setRequestHandler: (s: unknown, h: any) => { handlers.set(s, h); }, sendToolListChanged: vi.fn(async () => {}) };
    const ctx = { rootDir: root, index: {}, aggregation: { purposeFiles: [], symbols: [] }, gateConfig: null, projectName: 'fixture', wisdom: null, history: null } as unknown as ProjectContext;
    const reg = registerTools(server as any, () => ctx, async () => {});
    const tools = (await handlers.get(ListToolsRequestSchema)!({ params: {} })).tools;
    return { tools, annotations: reg.opAnnotations() };
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

describe('gnomon capability-index fixture', () => {
  it('names the same tools as the live worst-case tools/list', async () => {
    const { tools, annotations } = await liveList();
    if (process.env.PARADIGM_TOOLS_FIXTURE === 'write') {
      fs.writeFileSync(FIXTURE, `${JSON.stringify({ tools }, null, 2)}\n`);
      fs.writeFileSync(ANN_FIXTURE, `${JSON.stringify(annotations, null, 2)}\n`);
    }
    expect(JSON.parse(fs.readFileSync(ANN_FIXTURE, 'utf8'))).toEqual(annotations);
    const fixture = JSON.parse(fs.readFileSync(FIXTURE, 'utf8')) as { tools: Array<{ name: string }> };
    expect(fixture.tools.map((t) => t.name).sort()).toEqual(tools.map((t) => String(t.name)).sort());
  });
});
