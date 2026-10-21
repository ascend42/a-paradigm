import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { loadLoreEntries, loadLoreEntry, recordLoreEntry, migrateLegacyEntries } from './lore-loader.js';
import { isPathSafeLoreId } from './lore-legacy.js';

let root: string;
let entriesDir: string;

function tree(dir: string): string[] {
  const out: string[] = [];
  (function walk(d: string) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      out.push(path.relative(dir, p) + (e.isDirectory() ? '/' : ':' + fs.readFileSync(p, 'utf8')));
      if (e.isDirectory()) walk(p);
    }
  })(dir);
  return out.sort();
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-lore-legacy-'));
  entriesDir = path.join(root, '.paradigm', 'lore', 'entries');
  fs.mkdirSync(entriesDir, { recursive: true });
  fs.writeFileSync(path.join(entriesDir, 'old-a.yaml'), 'title: Old A\nsummary: first\ndate: "2026-02-21"\ntype: decision\n');
  fs.writeFileSync(path.join(entriesDir, 'old-b.yaml'), 'title: Old B\nsummary: second\ndate: "2026-02-21"\n');
  process.env.PARADIGM_AUTHOR = 'tester';
});

afterEach(() => {
  delete process.env.PARADIGM_AUTHOR;
  fs.rmSync(root, { recursive: true, force: true });
});

describe('MCP lore-loader: reads never migrate legacy entries', () => {
  it('loadLoreEntries shows legacy entries without moving a file', async () => {
    const before = tree(root);
    const entries = await loadLoreEntries(root);
    expect(entries.map(e => e.title).sort()).toEqual(['Old A', 'Old B']);
    expect(new Set(entries.map(e => e.id)).size).toBe(2);
    expect(tree(root)).toEqual(before);
  });

  it('loadLoreEntry finds a legacy entry by its planned id, read-only', async () => {
    const before = tree(root);
    const [first] = await loadLoreEntries(root);
    expect((await loadLoreEntry(root, first.id))?.title).toBe(first.title);
    expect(tree(root)).toEqual(before);
  });

  it('migration yields exactly what the read showed; writes migrate first', async () => {
    const shown = await loadLoreEntries(root);
    expect(migrateLegacyEntries(root)).toBe(2);
    expect(await loadLoreEntries(root)).toEqual(shown);

    fs.writeFileSync(path.join(entriesDir, 'old-c.yaml'), 'title: Old C\nsummary: third\ndate: "2026-02-22"\n');
    await recordLoreEntry(root, {
      id: '', type: 'insight', timestamp: '2026-10-21T00:00:00.000Z', author: 'tester',
      title: 'New', summary: 'n', symbols_touched: [],
    } as never);
    expect(fs.existsSync(path.join(entriesDir, 'old-c.yaml'))).toBe(false);
  });

  it('an id with a separator or `..` never builds a path', async () => {
    const outside = path.join(root, 'secret.lore');
    fs.writeFileSync(outside, 'id: x\ntitle: Secret\nsummary: s\ntimestamp: "2026-01-01T00:00:00Z"\nauthor: a\n');
    expect(await loadLoreEntry(root, 'L-2026-02-21-/../../../../secret')).toBeNull();
    expect(isPathSafeLoreId('L-2026-02-21-a-000000-001')).toBe(true);
    for (const bad of ['L-2026-02-21-/../x', 'L-2026-02-21-..', 'a/b', 'a\\b', '', 'x.y']) {
      expect(isPathSafeLoreId(bad)).toBe(false);
    }
    await expect(recordLoreEntry(root, {
      id: '../../escape', type: 'insight', timestamp: '2026-10-21T00:00:00.000Z', author: 'tester',
      title: 'Bad', summary: 'b', symbols_touched: [],
    } as never)).rejects.toThrow(/Invalid lore entry id/);
    expect(fs.existsSync(path.join(root, '.paradigm', 'escape.lore'))).toBe(false);
  });
});
