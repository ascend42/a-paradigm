/**
 * refresh-failure.test — a context refresh that THROWS must never fail a
 * tool call (Symbol Integrity Phase 1 review, item 5). The choke point logs a
 * warning and serves the call from the existing context — paradigm_reindex
 * included.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const failing = { on: false };

vi.mock('@a-company/premise-core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@a-company/premise-core')>();
  return {
    ...actual,
    getLiveIndex: vi.fn(async (root: string) => {
      if (failing.on) throw new Error('simulated live-index failure');
      return actual.getLiveIndex(root);
    }),
  };
});

const { CallToolRequestSchema } = await import('@modelcontextprotocol/sdk/types.js');
const { registerTools } = await import('../tools/index.js');
const { invalidateFeatureCache } = await import('./tool-registry.js');
const { loadProjectContext, resetFreshnessDebounce, flushStaticRebuilds } = await import('./index-loader.js');

let tmpRoot: string;

beforeEach(() => {
  failing.on = false;
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'refresh-failure-'));
  fs.mkdirSync(path.join(tmpRoot, '.paradigm'), { recursive: true });
  fs.writeFileSync(path.join(tmpRoot, '.paradigm/config.yaml'), 'version: 2.0.0\nproject:\n  name: refresh-failure\n');
  fs.mkdirSync(path.join(tmpRoot, 'src/a'), { recursive: true });
  fs.writeFileSync(path.join(tmpRoot, 'src/a/.purpose'), 'version: "2.0"\ncomponents:\n  steady:\n    description: Present at load\n');
});

afterEach(async () => {
  failing.on = false;
  await flushStaticRebuilds();
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

async function harness() {
  const ctx = await loadProjectContext(tmpRoot);
  invalidateFeatureCache();
  const handlers = new Map<unknown, (req: { params: Record<string, unknown> }) => Promise<any>>();
  const server = {
    setRequestHandler: (schema: unknown, h: any) => { handlers.set(schema, h); },
    sendToolListChanged: vi.fn(async () => {}),
  };
  registerTools(server as any, () => ctx, async () => {});
  const call = async (name: string, args: Record<string, unknown>) =>
    (await handlers.get(CallToolRequestSchema)!({ params: { name, arguments: args } })) as {
      content: Array<{ text: string }>;
      isError?: boolean;
    };
  return { ctx, call };
}

describe('refresh failure at the tool choke point', () => {
  it('serves paradigm_search from the existing context when the refresh throws', async () => {
    const { call } = await harness();
    failing.on = true;
    resetFreshnessDebounce(tmpRoot); // force the (failing) disk check
    const res = await call('paradigm_search', { query: 'steady', fuzzy: false });
    expect(res.isError).not.toBe(true);
    expect(res.content.map((c) => c.text).join('\n')).toContain('"#steady"');
  });

  it('paradigm_reindex still succeeds when the refresh throws', async () => {
    const { call } = await harness();
    failing.on = true;
    resetFreshnessDebounce(tmpRoot);
    const res = await call('paradigm_reindex', {});
    const text = res.content.map((c) => c.text).join('\n');
    expect(res.isError, text).not.toBe(true);
    expect(text).toContain('"success": true');
  });
});
