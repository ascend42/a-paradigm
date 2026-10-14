/**
 * symbol-resolution.test — user-typed names resolve fuzzily at the MCP
 * input boundaries (ripple, related, navigate); an ambiguous bare name lists
 * candidates instead of "not found" / "call paradigm_reindex".
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { registerTools } from './index.js';
import { invalidateFeatureCache } from '../utils/tool-registry.js';
import { loadProjectContext, flushStaticRebuilds } from '../utils/index-loader.js';

let tmpRoot: string;

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'symbol-resolution-'));
  fs.mkdirSync(path.join(tmpRoot, '.paradigm'), { recursive: true });
  fs.writeFileSync(path.join(tmpRoot, '.paradigm/config.yaml'), 'version: 2.0.0\nproject:\n  name: resolution\n');
  fs.mkdirSync(path.join(tmpRoot, 'src/auth'), { recursive: true });
  fs.writeFileSync(
    path.join(tmpRoot, 'src/auth/.purpose'),
    [
      'version: "2.0"',
      'components:',
      '  auth:',
      '    description: Auth module',
      '  checkout:',
      '    description: Checkout',
      '    gates: [^auth]',
      'gates:',
      '  auth:',
      '    description: Auth gate',
      '',
    ].join('\n'),
  );
});

afterEach(async () => {
  await flushStaticRebuilds();
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

async function harness() {
  const ctx = await loadProjectContext(tmpRoot);
  invalidateFeatureCache();
  const handlers = new Map<unknown, (req: { params: Record<string, unknown> }) => Promise<any>>();
  registerTools(
    { setRequestHandler: (s: unknown, h: any) => { handlers.set(s, h); }, sendToolListChanged: vi.fn(async () => {}) } as any,
    () => ctx,
    async () => {},
  );
  return async (name: string, args: Record<string, unknown>) => {
    const res = await handlers.get(CallToolRequestSchema)!({ params: { name, arguments: args } });
    return (res.content as Array<{ text: string }>).map((c) => c.text).join('\n');
  };
}

describe('user-input symbol resolution', () => {
  it('paradigm_related resolves a case variant to the canonical symbol', async () => {
    const call = await harness();
    const text = await call('paradigm_related', { symbol: '#Checkout' });
    expect(text).toContain('"symbol": "#checkout"');
    expect(text).toContain('"^auth"');
  });

  for (const [tool, args] of [
    ['paradigm_related', { symbol: 'auth' }],
    ['paradigm_ripple', { symbol: 'auth' }],
    ['paradigm_navigate', { intent: 'find', target: 'auth' }],
  ] as const) {
    it(`${tool} lists candidates for an ambiguous bare name`, async () => {
      const call = await harness();
      const text = await call(tool, args as Record<string, unknown>);
      expect(text).toContain('Ambiguous symbol');
      expect(text).toContain('"#auth"');
      expect(text).toContain('"^auth"');
      expect(text).not.toMatch(/not found|paradigm_reindex/i);
    });
  }
});
