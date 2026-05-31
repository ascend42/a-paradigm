/**
 * university-pack-selector.test.ts — fix for the ignored `pack` selector.
 *
 * Before this fix, the READ tools accepted `pack=<id>` but loaded entries from
 * the PROJECT index only, so a selected pack (which ships no `index.yaml`)
 * returned 0 results. Two hardcodes were at fault: `loadUniversityIndex` always
 * read the project index, and the content base was hardcoded to `content/`
 * whereas the first-party pack ships under `src/content/`.
 *
 * These tests lock the dual content-base probe + the in-memory scan fallback:
 *   1. `content/` layout pack → searchContent(..., packRoot) returns all entries.
 *   2. `src/content/` layout pack → same (locks the dual probe).
 *   3. Invariant: countPackEntries(packRoot) == unfiltered searchContent length.
 *   4. Project-pack regression: with an index.yaml present and NO packRoot, the
 *      path is unchanged (reads the index verbatim).
 *   5. Onboard + validate over a selected pack work and don't crash on
 *      `src/content/` packs.
 *   6. scanPackEntries shared seam: loadPackIndex scan == rebuildUniversityIndex
 *      for an identical `content/` fixture (entries + totalContent).
 */

import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  searchContent,
  getOnboardingSequence,
  validateUniversityContent,
  loadPackIndex,
  rebuildUniversityIndex,
} from '../src/utils/university-loader.js';

const tmpDirs: string[] = [];

function mktemp(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'paradigm-pack-selector-'));
  tmpDirs.push(d);
  return d;
}

const PACK_YAML = [
  'id: ai-literacy',
  'name: AI Literacy',
  'version: 1.0.0',
  'schema_version: "1"',
  'tenant_kind: discipline',
  'description: A test discipline pack.',
  'sections:',
  '  - id: foundations',
  '    name: Foundations',
  '    order: 1',
  '    style: track',
  '    default: true',
  '  - id: advanced',
  '    name: Advanced',
  '    order: 2',
  '    style: index',
].join('\n');

function note(id: string, title: string, section?: string): string {
  const fm = [
    '---',
    `id: ${id}`,
    `title: ${title}`,
    'type: note',
    'author: tester',
    'created: 2026-05-31',
    'updated: 2026-05-31',
    'difficulty: beginner',
    ...(section ? [`section: ${section}`] : []),
    '---',
    '',
    `Body for ${id}.`,
    '',
  ];
  return fm.join('\n');
}

function quizYaml(id: string, title: string, section?: string): string {
  return [
    `id: ${id}`,
    `title: ${title}`,
    'type: quiz',
    'author: tester',
    'difficulty: beginner',
    'passThreshold: 0.7',
    ...(section ? [`section: ${section}`] : []),
    'questions:',
    '  - id: q1',
    '    prompt: What is 2+2?',
    '    choices:',
    '      a: "3"',
    '      b: "4"',
    '    correct: b',
    '',
  ].join('\n');
}

function pathYaml(id: string, title: string, stepContentId: string): string {
  return [
    `id: ${id}`,
    `title: ${title}`,
    'type: path',
    'author: tester',
    'steps:',
    `  - content: ${stepContentId}`,
    '',
  ].join('\n');
}

/**
 * Build a pack at `<root>/.paradigm/university/<packId>/` with content under the
 * given sub-layout (`content` or `src/content`). Returns the absolute packRoot.
 *
 * Authors: 2 notes (one per section), 1 quiz, 1 path → 4 entries total.
 */
function buildPack(rootDir: string, packId: string, contentSub: 'content' | 'src/content'): string {
  const packRoot = path.join(rootDir, '.paradigm', 'university', packId);
  const base = path.join(packRoot, contentSub);
  fs.mkdirSync(path.join(base, 'notes'), { recursive: true });
  fs.mkdirSync(path.join(base, 'quizzes'), { recursive: true });
  fs.mkdirSync(path.join(base, 'paths'), { recursive: true });

  fs.writeFileSync(path.join(packRoot, 'pack.yaml'), PACK_YAML, 'utf8');
  fs.writeFileSync(path.join(base, 'notes', 'N-intro.md'), note('N-intro', 'Intro', 'foundations'), 'utf8');
  fs.writeFileSync(path.join(base, 'notes', 'N-deep.md'), note('N-deep', 'Deep Dive', 'advanced'), 'utf8');
  fs.writeFileSync(path.join(base, 'quizzes', 'Q-basics.yaml'), quizYaml('Q-basics', 'Basics Quiz', 'foundations'), 'utf8');
  fs.writeFileSync(path.join(base, 'paths', 'LP-start.yaml'), pathYaml('LP-start', 'Getting Started', 'N-intro'), 'utf8');

  return packRoot;
}

// Mirror of tools/university.ts countPackEntries — kept local so the invariant
// assertion (#3) does not import a non-exported tool helper.
function countPackEntries(packRoot: string): number {
  const subdirs = ['notes', 'policies', 'quizzes', 'paths'];
  for (const contentSub of ['content', 'src/content']) {
    const contentDir = path.join(packRoot, contentSub);
    if (!fs.existsSync(contentDir)) continue;
    let total = 0;
    for (const sub of subdirs) {
      const dir = path.join(contentDir, sub);
      if (!fs.existsSync(dir)) continue;
      total += fs.readdirSync(dir).filter(f => f.endsWith('.md') || f.endsWith('.yaml')).length;
    }
    if (total > 0) return total;
  }
  return 0;
}

describe('university pack selector — content/ layout', () => {
  afterEach(() => {
    while (tmpDirs.length) {
      const d = tmpDirs.pop()!;
      if (fs.existsSync(d)) fs.rmSync(d, { recursive: true, force: true });
    }
  });

  it('searchContent(..., packRoot) returns all authored entries', () => {
    const rootDir = mktemp();
    const packRoot = buildPack(rootDir, 'ai-literacy', 'content');

    const all = searchContent(rootDir, { limit: 100 }, packRoot);
    expect(all).toHaveLength(4);
    const ids = all.map(e => e.id).sort();
    expect(ids).toEqual(['LP-start', 'N-deep', 'N-intro', 'Q-basics']);
  });

  it('section filter narrows results to the selected section', () => {
    const rootDir = mktemp();
    const packRoot = buildPack(rootDir, 'ai-literacy', 'content');

    const foundations = searchContent(rootDir, { section: 'foundations', limit: 100 }, packRoot);
    expect(foundations.map(e => e.id).sort()).toEqual(['N-intro', 'Q-basics']);

    const advanced = searchContent(rootDir, { section: 'advanced', limit: 100 }, packRoot);
    expect(advanced.map(e => e.id)).toEqual(['N-deep']);
  });

  it('invariant: countPackEntries == unfiltered searchContent length', () => {
    const rootDir = mktemp();
    const packRoot = buildPack(rootDir, 'ai-literacy', 'content');

    const searchLen = searchContent(rootDir, { limit: 1000 }, packRoot).length;
    expect(countPackEntries(packRoot)).toBe(searchLen);
  });
});

describe('university pack selector — src/content/ layout (first-party)', () => {
  afterEach(() => {
    while (tmpDirs.length) {
      const d = tmpDirs.pop()!;
      if (fs.existsSync(d)) fs.rmSync(d, { recursive: true, force: true });
    }
  });

  it('searchContent(..., packRoot) finds entries under src/content (dual probe)', () => {
    const rootDir = mktemp();
    const packRoot = buildPack(rootDir, 'paradigm', 'src/content');

    const all = searchContent(rootDir, { limit: 100 }, packRoot);
    expect(all).toHaveLength(4);
    // `file` field must carry the actual probed sub so later body loads work.
    const intro = all.find(e => e.id === 'N-intro')!;
    expect(intro.file).toBe('src/content/notes/N-intro.md');
  });

  it('invariant holds for src/content layout', () => {
    const rootDir = mktemp();
    const packRoot = buildPack(rootDir, 'paradigm', 'src/content');
    const searchLen = searchContent(rootDir, { limit: 1000 }, packRoot).length;
    expect(countPackEntries(packRoot)).toBe(searchLen);
  });

  it('onboard + validate work over a src/content pack without crashing', () => {
    const rootDir = mktemp();
    const packRoot = buildPack(rootDir, 'paradigm', 'src/content');

    const seq = getOnboardingSequence(rootDir, undefined, packRoot);
    expect(seq.totalContent).toBe(4);
    expect(seq.paths.map(p => p.id)).toEqual(['LP-start']);
    // path body loaded via packRoot-threaded loadPath → step count resolves
    expect(seq.paths[0].steps).toBe(1);

    const result = validateUniversityContent(rootDir, {}, packRoot);
    expect(result.checked).toBe(4);
    // path step references N-intro which exists → no broken-path-step error
    expect(result.issues.some(i => i.check === 'broken-path-step')).toBe(false);
    // quiz is well-formed → no unreadable-quiz error
    expect(result.issues.some(i => i.check === 'unreadable-quiz')).toBe(false);
  });
});

describe('university pack selector — project-pack regression (no packRoot)', () => {
  afterEach(() => {
    while (tmpDirs.length) {
      const d = tmpDirs.pop()!;
      if (fs.existsSync(d)) fs.rmSync(d, { recursive: true, force: true });
    }
  });

  it('with an index.yaml present, no-packRoot search reads the index verbatim', () => {
    const rootDir = mktemp();
    // Project pack lives at <rootDir>/.paradigm/university/ with content/.
    const uniDir = path.join(rootDir, '.paradigm', 'university');
    const base = path.join(uniDir, 'content');
    fs.mkdirSync(path.join(base, 'notes'), { recursive: true });
    fs.writeFileSync(path.join(base, 'notes', 'N-a.md'), note('N-a', 'Alpha'), 'utf8');
    fs.writeFileSync(path.join(base, 'notes', 'N-b.md'), note('N-b', 'Beta'), 'utf8');

    // Build the project index (this is what every write + reindex does).
    const built = rebuildUniversityIndex(rootDir);
    expect(fs.existsSync(path.join(uniDir, 'index.yaml'))).toBe(true);

    // No packRoot → project path. Must return exactly the index entries.
    const results = searchContent(rootDir, { limit: 100 });
    expect(results.map(e => e.id).sort()).toEqual(['N-a', 'N-b']);
    expect(results.length).toBe(built.entries.length);
  });

  it('loadPackIndex scan == rebuildUniversityIndex entries for identical content/ fixture', () => {
    const rootDir = mktemp();
    // Project-pack fixture under content/ (no index.yaml present yet for scan).
    const uniDir = path.join(rootDir, '.paradigm', 'university');
    const base = path.join(uniDir, 'content');
    fs.mkdirSync(path.join(base, 'notes'), { recursive: true });
    fs.mkdirSync(path.join(base, 'quizzes'), { recursive: true });
    fs.writeFileSync(path.join(base, 'notes', 'N-x.md'), note('N-x', 'Ex', 'foundations'), 'utf8');
    fs.writeFileSync(path.join(base, 'quizzes', 'Q-y.yaml'), quizYaml('Q-y', 'Why Quiz'), 'utf8');

    // Scan path: loadPackIndex over the same dir (no index.yaml written yet).
    const scanned = loadPackIndex(uniDir, rootDir);
    // Rebuild path: writes the project index from the same content/.
    const rebuilt = rebuildUniversityIndex(rootDir);

    expect(scanned.totalContent).toBe(rebuilt.totalContent);
    expect(scanned.entries).toEqual(rebuilt.entries);
  });
});
