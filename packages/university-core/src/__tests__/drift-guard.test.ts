/**
 * drift-guard.test.ts — §5.4 DRIFT-GUARD tests.
 *
 * Exercises exactly the inputs the named suites (286/46/355 + live serve)
 * don't, so the enumerated convergence deltas (D2/D3/D4) can never silently
 * re-drift.
 *
 *   §5.4.2  Policies-only pack through resolveContentBase  (catches D3)
 *   §5.4.3  saveNote round-trip with AND without packRoot  (catches D2)
 *   §5.4.4  countPackEntries parity                        (catches D4)
 */

import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  resolveContentBase,
  countPackEntries,
  saveNote,
  loadOrFabricatePackManifest,
} from '../index.js';

function mktemp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'uni-core-drift-'));
}

function write(file: string, body: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, body, 'utf8');
}

function policy(id: string): string {
  return [
    '---',
    `id: ${id}`,
    `title: Policy ${id}`,
    'type: policy',
    'author: t',
    'created: "2026-01-01"',
    'updated: "2026-01-01"',
    'tags: []',
    'symbols: []',
    'difficulty: beginner',
    '---',
    '',
    'Policy body',
    '',
  ].join('\n');
}

describe('§5.4.2 — policies-only pack resolves a content base (D3)', () => {
  let tmpDir: string | undefined;
  afterEach(() => {
    if (tmpDir && fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
    tmpDir = undefined;
  });

  it('resolveContentBase returns the base when only policies/ has content', () => {
    tmpDir = mktemp();
    const packRoot = path.join(tmpDir, 'pack');
    write(path.join(packRoot, 'content', 'policies', 'P-1.md'), policy('P-1'));

    const base = resolveContentBase(packRoot);
    expect(base).toBe(path.join(packRoot, 'content'));
  });

  it('resolveContentBase returns null when no layout exists', () => {
    tmpDir = mktemp();
    expect(resolveContentBase(path.join(tmpDir, 'empty'))).toBeNull();
  });

  it('prefers the base that CONTAINS content over an empty earlier base', () => {
    tmpDir = mktemp();
    const packRoot = path.join(tmpDir, 'pack');
    // empty content/ dir beside populated src/content/
    fs.mkdirSync(path.join(packRoot, 'content'), { recursive: true });
    write(path.join(packRoot, 'src', 'content', 'policies', 'P-1.md'), policy('P-1'));

    expect(resolveContentBase(packRoot)).toBe(path.join(packRoot, 'src', 'content'));
  });
});

describe('§5.4.3 — saveNote round-trip with/without packRoot (D2)', () => {
  let tmpDir: string | undefined;
  afterEach(() => {
    if (tmpDir && fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
    tmpDir = undefined;
  });

  const fm = {
    id: 'N-rt',
    title: 'Round Trip',
    type: 'note' as const,
    author: 'tester',
    created: '2026-01-01',
    updated: '2026-01-01',
    tags: [],
    symbols: [],
    difficulty: 'beginner' as const,
    prerequisites: [],
  };

  function scaffoldProjectPack(rootDir: string): string {
    const packRoot = path.join(rootDir, '.paradigm', 'university');
    write(
      path.join(packRoot, 'pack.yaml'),
      [
        'id: acme-project',
        'name: Acme',
        'version: 0.1.0',
        'schema_version: "1"',
        'tenant_kind: project',
        'description: project',
      ].join('\n') + '\n',
    );
    return packRoot;
  }

  it('MCP-default (positional packRoot) stamps pack_id', () => {
    tmpDir = mktemp();
    const packRoot = scaffoldProjectPack(tmpDir);
    const fp = saveNote(tmpDir, fm, 'body', packRoot);
    expect(fs.readFileSync(fp, 'utf8')).toContain('pack_id: acme-project');
    expect(fp).toBe(path.join(packRoot, 'content', 'notes', 'N-rt.md'));
  });

  it('MCP-default (options object) stamps pack_id', () => {
    tmpDir = mktemp();
    const packRoot = scaffoldProjectPack(tmpDir);
    const fp = saveNote(tmpDir, fm, 'body', { packRoot });
    expect(fs.readFileSync(fp, 'utf8')).toContain('pack_id: acme-project');
  });

  it('CLI flags (stampPackId false, resolveDefaultPack false) → no stamp, project dir', () => {
    tmpDir = mktemp();
    scaffoldProjectPack(tmpDir);
    // CLI no-packRoot write: stampPackId !!packRoot === false, resolveDefaultPack false
    const fp = saveNote(tmpDir, fm, 'body', { stampPackId: false, resolveDefaultPack: false });
    expect(fp).toBe(path.join(tmpDir, '.paradigm', 'university', 'content', 'notes', 'N-rt.md'));
    expect(fs.readFileSync(fp, 'utf8')).not.toContain('pack_id:');
  });

  it('CLI with explicit packRoot (stampPackId true) → stamps', () => {
    tmpDir = mktemp();
    const packRoot = scaffoldProjectPack(tmpDir);
    const fp = saveNote(tmpDir, fm, 'body', { packRoot, stampPackId: true, resolveDefaultPack: false });
    expect(fs.readFileSync(fp, 'utf8')).toContain('pack_id: acme-project');
  });
});

describe('§5.4.4 — countPackEntries parity (D4)', () => {
  let tmpDir: string | undefined;
  afterEach(() => {
    if (tmpDir && fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
    tmpDir = undefined;
  });

  it('counts notes + quizzes + paths across the content base', () => {
    tmpDir = mktemp();
    const packRoot = path.join(tmpDir, 'pack');
    write(path.join(packRoot, 'content', 'notes', 'N-1.md'), policy('N-1'));
    write(path.join(packRoot, 'content', 'notes', 'N-2.md'), policy('N-2'));
    write(path.join(packRoot, 'content', 'quizzes', 'Q-1.yaml'), 'id: Q-1\n');
    write(path.join(packRoot, 'content', 'paths', 'LP-1.yaml'), 'id: LP-1\n');
    expect(countPackEntries(packRoot)).toBe(4);
  });

  it('uses the first base that contains content (src/content fallback)', () => {
    tmpDir = mktemp();
    const packRoot = path.join(tmpDir, 'pack');
    fs.mkdirSync(path.join(packRoot, 'content'), { recursive: true });
    write(path.join(packRoot, 'src', 'content', 'notes', 'N-1.md'), policy('N-1'));
    expect(countPackEntries(packRoot)).toBe(1);
  });

  it('returns 0 for an empty pack', () => {
    tmpDir = mktemp();
    expect(countPackEntries(path.join(tmpDir, 'empty'))).toBe(0);
  });
});

describe('§5.4.1-adjacent — fabricated manifest synthesizes default section', () => {
  let tmpDir: string | undefined;
  afterEach(() => {
    if (tmpDir && fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
    tmpDir = undefined;
  });

  it('no-pack.yaml layout fabricates a single default section', () => {
    tmpDir = mktemp();
    const packRoot = path.join(tmpDir, '.paradigm', 'university');
    fs.mkdirSync(packRoot, { recursive: true });
    const manifest = loadOrFabricatePackManifest(packRoot);
    expect(manifest).not.toBeNull();
    expect(manifest!.sections).toEqual([
      { id: 'main', name: 'Curriculum', order: 1, style: 'track', default: true },
    ]);
  });
});
