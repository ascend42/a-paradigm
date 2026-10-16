/**
 * listToolDefinitions — the full paradigm_* catalogue used by skill pin checks.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { listToolDefinitions } from './index.js';
import { hashToolSchema } from '../utils/skill-loader.js';

describe('listToolDefinitions', () => {
  it('lists inline + every tier of registry tools, unique, with schemas', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ltd-'));
    try {
      const tools = listToolDefinitions(root);
      const names = tools.map(t => t.name);
      expect(names).toContain('paradigm_search');
      expect(names).toContain('paradigm_orchestrate_inline');
      expect(new Set(names).size).toBe(names.length);
      for (const t of tools) expect(hashToolSchema(t.inputSchema)).toMatch(/^sha256:[0-9a-f]{64}$/);
      // Stable across calls (pins must be reproducible).
      const again = listToolDefinitions(root);
      expect(again.map(t => hashToolSchema(t.inputSchema))).toEqual(tools.map(t => hashToolSchema(t.inputSchema)));
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
