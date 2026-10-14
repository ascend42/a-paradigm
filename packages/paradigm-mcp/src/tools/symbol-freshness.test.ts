/**
 * symbol-freshness.test — Symbol Integrity Phase 1 (T-2026-10-13-001).
 *
 * Written FIRST (pre-fix). The MCP server loads ProjectContext once and hands
 * the SAME context to every tool call (getContext() in src/index.ts). A
 * .purpose file written by the user/agent outside the MCP write tools is
 * invisible to paradigm_search until an explicit reindex/reload. Contract:
 * a newly written component is findable without an explicit reload.
 *
 * Harness mirrors brain.test.ts: registerTools() against a fake server whose
 * getContext() returns a context loaded ONCE before the write.
 *
 * NOTE: imports @a-company/premise-core via its built dist — rebuild
 * premise-core after changing it.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { registerTools } from './index.js';
import { invalidateFeatureCache } from '../utils/tool-registry.js';
import { loadProjectContext, flushStaticRebuilds, FRESHNESS_DEBOUNCE_MS, type ProjectContext } from '../utils/index-loader.js';

let tmpRoot: string;

function write(rel: string, content: string): void {
  const abs = path.join(tmpRoot, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
}

function server(getContext: () => ProjectContext) {
  invalidateFeatureCache();
  const handlers = new Map<unknown, (req: { params: Record<string, unknown> }) => Promise<any>>();
  const s = {
    setRequestHandler: (schema: unknown, h: any) => { handlers.set(schema, h); },
    sendToolListChanged: vi.fn(async () => {}),
  };
  // No-op reload: the server must not depend on an explicit reload for freshness.
  registerTools(s as any, getContext, async () => {});
  return {
    call: async (name: string, args: Record<string, unknown>) =>
      (await handlers.get(CallToolRequestSchema)!({ params: { name, arguments: args } })) as {
        content: Array<{ text: string }>;
        isError?: boolean;
      },
  };
}

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'symbol-freshness-'));
  write('.paradigm/config.yaml', 'version: 2.0.0\nproject:\n  name: freshness-test\n');
  write('src/early/.purpose', 'version: "2.0"\ncomponents:\n  early-bird:\n    description: Present at load\n');
});

afterEach(async () => {
  await flushStaticRebuilds();
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

describe('MCP symbol freshness', () => {
  it('paradigm_search finds a component written after context load, without reindex', async () => {
    const ctx = await loadProjectContext(tmpRoot);
    const srv = server(() => ctx);

    // Sanity: the pre-existing component is searchable.
    const before = await srv.call('paradigm_search', { query: 'early-bird', fuzzy: false });
    expect(before.content.map((c) => c.text).join('\n')).toContain('"#early-bird"');

    write('src/late/.purpose', 'version: "2.0"\ncomponents:\n  late-comer:\n    description: Written after load\n');
    // ensureFreshContext debounces disk checks per root; a real agent's next
    // call lands well past the window. Wait it out — no reload, no reindex.
    await new Promise((r) => setTimeout(r, FRESHNESS_DEBOUNCE_MS + 50));

    const after = await srv.call('paradigm_search', { query: 'late-comer', fuzzy: false });
    const text = after.content.map((c) => c.text).join('\n');
    expect(text, 'late-comer should be found without an explicit reindex').toContain('"#late-comer"');
  });
});
