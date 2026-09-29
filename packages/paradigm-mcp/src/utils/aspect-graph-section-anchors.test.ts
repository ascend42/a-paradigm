/**
 * #aspect-graph — heading/block anchors (D9, 7.12.0): materialize resolves the
 * section's live range, drift re-resolves the key, the column migration is
 * idempotent, and line anchors are untouched.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import initSqlJs from 'sql.js';
import type { SymbolEntry } from '@a-company/premise-core';
import { parseAnchorString } from '@a-company/premise-core';
import { openAspectGraph, closeAspectGraph, materializeAspects, checkDrift } from './aspect-graph.js';

const DOC = ['# Guide', '', '## Setup', 'install it', 'configure it', '', '## Usage', 'run it ^rule-1', ''].join('\n');

let root: string;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'ag-section-'));
  fs.mkdirSync(path.join(root, 'docs'));
  fs.writeFileSync(path.join(root, 'docs/guide.md'), DOC);
  fs.writeFileSync(path.join(root, 'src.ts'), Array.from({ length: 30 }, (_, i) => `line ${i + 1}`).join('\n'));
});
afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

function aspect(anchors: string[]): SymbolEntry {
  return {
    id: 'purpose-aspect-docs-rule', symbol: '~docs-rule', type: 'aspect', source: 'purpose',
    filePath: path.join(root, '.purpose'), data: {}, description: 'rule', references: [], referencedBy: [],
    anchors: anchors.map((a) => parseAnchorString(a)),
  } as SymbolEntry;
}

type Row = { file_path: string; start_line: number; end_line: number; anchor_kind: string; anchor_key: string | null };
const rows = (db: Awaited<ReturnType<typeof openAspectGraph>>): Row[] => {
  const r = db.exec('SELECT file_path, start_line, end_line, anchor_kind, anchor_key FROM anchors ORDER BY id')[0];
  return (r?.values ?? []).map((v) => ({
    file_path: v[0] as string, start_line: v[1] as number, end_line: v[2] as number,
    anchor_kind: v[3] as string, anchor_key: v[4] as string | null,
  }));
};

describe('aspect-graph section anchors', () => {
  it('materialize resolves heading/block to the current section range; line anchor unchanged', async () => {
    const db = await openAspectGraph(root);
    materializeAspects(db, [aspect(['docs/guide.md#Setup', 'docs/guide.md#^rule-1', 'src.ts:15-20'])], root);
    expect(rows(db)).toEqual([
      { file_path: 'docs/guide.md', start_line: 3, end_line: 5, anchor_kind: 'heading', anchor_key: 'Setup' },
      { file_path: 'docs/guide.md', start_line: 8, end_line: 8, anchor_kind: 'block', anchor_key: 'rule-1' },
      { file_path: 'src.ts', start_line: 15, end_line: 20, anchor_kind: 'lines', anchor_key: null },
    ]);
    const drift = checkDrift(db, root);
    expect(drift.map((d) => d.status)).toEqual(['clean', 'clean', 'clean']);
    closeAspectGraph(db);
  });

  it('heading that moved is clean at its new range (key wins, no line-shift heal)', async () => {
    const db = await openAspectGraph(root);
    materializeAspects(db, [aspect(['docs/guide.md#Setup'])], root);
    fs.writeFileSync(path.join(root, 'docs/guide.md'), 'intro\nmore intro\n' + DOC);
    const [d] = checkDrift(db, root);
    expect(d).toMatchObject({ status: 'clean', startLine: 5, endLine: 7, drifted: false });
    expect(rows(db)[0]).toMatchObject({ start_line: 5, end_line: 7 });
    closeAspectGraph(db);
  });

  it('heading rename = drift', async () => {
    const db = await openAspectGraph(root);
    materializeAspects(db, [aspect(['docs/guide.md#Setup'])], root);
    fs.writeFileSync(path.join(root, 'docs/guide.md'), DOC.replace('## Setup', '## Installation'));
    const [d] = checkDrift(db, root);
    expect(d).toMatchObject({ status: 'missing', exists: true, drifted: true });
    closeAspectGraph(db);
  });

  it('section content change = modified drift; whitespace-only = cosmetic', async () => {
    const db = await openAspectGraph(root);
    materializeAspects(db, [aspect(['docs/guide.md#Setup'])], root);
    fs.writeFileSync(path.join(root, 'docs/guide.md'), DOC.replace('install it', 'install   it'));
    expect(checkDrift(db, root)[0].status).toBe('cosmetic');
    fs.writeFileSync(path.join(root, 'docs/guide.md'), DOC.replace('install it', 'uninstall everything'));
    expect(checkDrift(db, root)[0]).toMatchObject({ status: 'modified', drifted: true });
    closeAspectGraph(db);
  });

  it('column migration is safe to run twice, including on a pre-7.12 DB', async () => {
    const SQL = await initSqlJs();
    const legacy = new SQL.Database();
    legacy.run(`CREATE TABLE anchors (
      id INTEGER PRIMARY KEY AUTOINCREMENT, aspect_id TEXT NOT NULL, file_path TEXT NOT NULL,
      start_line INTEGER NOT NULL, end_line INTEGER NOT NULL, content_hash TEXT, normalized_hash TEXT,
      materialized_at_commit TEXT, last_verified TEXT, drifted INTEGER DEFAULT 0)`);
    legacy.run(`INSERT INTO anchors (aspect_id, file_path, start_line, end_line) VALUES ('~old', 'src.ts', 1, 2)`);
    fs.mkdirSync(path.join(root, '.paradigm'), { recursive: true });
    fs.writeFileSync(path.join(root, '.paradigm/aspect-graph.db'), Buffer.from(legacy.export()));
    legacy.close();

    for (let i = 0; i < 2; i++) {
      const db = await openAspectGraph(root);
      const cols = (db.exec('PRAGMA table_info(anchors)')[0]?.values ?? []).map((r) => r[1]);
      expect(cols.filter((c) => c === 'anchor_kind')).toHaveLength(1);
      expect(cols.filter((c) => c === 'anchor_key')).toHaveLength(1);
      const old = db.exec(`SELECT anchor_kind, anchor_key FROM anchors WHERE aspect_id = '~old'`)[0].values[0];
      expect(old).toEqual(['lines', null]);
      closeAspectGraph(db, root);
    }
  });
});
