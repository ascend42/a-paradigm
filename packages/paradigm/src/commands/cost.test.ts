/**
 * `paradigm cost` reports file sizes and nothing it did not measure.
 *
 * It used to print "MCP vs Static: N% reduction" and "Est. savings per
 * conversation: ~$…", computed from a hard-coded 150-tokens-per-query constant
 * against a baseline that assumed every .purpose file and scan-index.json was
 * loaded every conversation. Neither was a measurement.
 */

import { describe, it, expect, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { analyzeCost, costCommand, estimateTokens, COST_METHOD, COST_SCOPE } from './cost.js';

const PURPOSE = 'name: demo\ndescription: A demo feature\ncomponents:\n  demo-thing:\n    description: Does a thing\n';
const SCAN_INDEX = JSON.stringify({ symbols: Array.from({ length: 40 }, (_, i) => `#symbol-${i}`) });

function project(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cost-'));
  fs.mkdirSync(path.join(root, '.paradigm'), { recursive: true });
  fs.mkdirSync(path.join(root, 'src', 'demo'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src', 'demo', '.purpose'), PURPOSE);
  fs.writeFileSync(path.join(root, '.paradigm', 'scan-index.json'), SCAN_INDEX);
  return root;
}

async function capture(run: () => Promise<void>): Promise<string> {
  const chunks: string[] = [];
  const spy = vi.spyOn(process.stdout, 'write').mockImplementation((s: unknown) => { chunks.push(String(s)); return true; });
  try {
    await run();
  } finally {
    spy.mockRestore();
  }
  // eslint-disable-next-line no-control-regex
  return chunks.join('').replace(/\u001b\[[0-9;]*m/g, '');
}

describe('paradigm cost', () => {
  it('estimateTokens is characters / 3.5, rounded up', () => {
    expect(estimateTokens('')).toBe(0);
    expect(estimateTokens('a'.repeat(7))).toBe(2);
    expect(estimateTokens('a'.repeat(8))).toBe(3);
  });

  it('sizes each file from its character count and sums them', async () => {
    const root = project();
    try {
      const a = await analyzeCost(root);
      expect(a.sizes.purposeFiles).toHaveLength(1);
      expect(a.sizes.purposeTotal).toBe(Math.ceil(PURPOSE.length / 3.5));
      expect(a.sizes.scanIndex?.tokens).toBe(Math.ceil(SCAN_INDEX.length / 3.5));
      expect(a.sizes.scanIndex?.bytes).toBe(Buffer.byteLength(SCAN_INDEX));
      expect(a.sizes.total).toBe(a.sizes.purposeTotal + a.sizes.portalTotal + (a.sizes.scanIndex?.tokens ?? 0));
      expect(a.method).toBe(COST_METHOD);
      expect(a.scope).toBe(COST_SCOPE);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('--json carries no savings, reduction or per-query estimate', async () => {
    const root = project();
    try {
      const parsed = JSON.parse(await capture(() => costCommand(root, { json: true })));
      expect(Object.keys(parsed).sort()).toEqual(['mcpConfigured', 'method', 'notes', 'scope', 'sizes']);
      expect(parsed).not.toHaveProperty('savings');
      expect(parsed).not.toHaveProperty('dynamic');
      expect(parsed.method).toContain('characters / 3.5');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('text output labels sizes, says how they were counted, and claims no saving', async () => {
    const root = project();
    try {
      const text = await capture(() => costCommand(root, { detailed: true }));
      expect(text).toContain('Paradigm file sizes (estimated tokens)');
      expect(text).toContain('.purpose files (1)');
      expect(text).toContain('Total size on disk');
      expect(text).toContain('How counted: Estimated from file size: characters / 3.5');
      expect(text).toContain('They are not what an agent loads in a session');
      expect(text).toContain('src/demo/.purpose');
      expect(text).not.toMatch(/savings?|reduction|loaded every conversation|per conversation|\$\d|%/i);
      expect(text).not.toMatch(/Avg query|Typical conversation/i);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('notes a missing index and a missing MCP config without promising a saving', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cost-empty-'));
    try {
      const a = await analyzeCost(root);
      expect(a.sizes.total).toBe(0);
      expect(a.mcpConfigured).toBe(false);
      expect(a.notes.join('\n')).toContain('paradigm reindex');
      expect(a.notes.join('\n')).toContain('paradigm mcp setup');
      expect(a.notes.join('\n')).not.toMatch(/saving|%/i);
      fs.writeFileSync(path.join(root, '.mcp.json'), '{}\n');
      expect((await analyzeCost(root)).mcpConfigured).toBe(true);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
