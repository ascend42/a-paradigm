/**
 * university-phase0-onboard-search.test.ts — Phase 0 MCP loader gaps (spec
 * fix-university-pack-selector-full.md §C1–C4).
 *
 * Locks the loader-layer behavior the onboard/search tools depend on:
 *
 *   C1 — onboard is SECTION-AWARE for packs that DECLARE sections in pack.yaml.
 *        A sections-only pack (no categories, no config.yaml) returns a
 *        non-empty, section-ordered `sections` grouping AND keeps the flat
 *        paths/suggestedContent/extracurricular/totalContent fields populated.
 *   C1 back-compat — a pack with NO declared sections (and the no-packRoot
 *        project path) omits `sections` entirely → response shape unchanged.
 *   C2 — searchContentWithMeta surfaces `total` (pre-slice) so truncation at
 *        the default limit (20) is visible to callers.
 *   C4 — resolveContentBase prefers the base that CONTAINS content over an
 *        empty-but-existing sibling base.
 */

import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  getOnboardingSequence,
  searchContent,
  searchContentWithMeta,
  resolveContentBase,
  packDeclaresSections,
  rebuildUniversityIndex,
  loadDiplomas,
  saveDiploma,
} from '../src/utils/university-loader.js';
import type { Diploma } from '../src/types/university.js';
import { isProjectUniversityRoot } from '../src/tools/university.js';

const tmpDirs: string[] = [];

function mktemp(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'paradigm-phase0-'));
  tmpDirs.push(d);
  return d;
}

afterEach(() => {
  while (tmpDirs.length) {
    const d = tmpDirs.pop()!;
    if (fs.existsSync(d)) fs.rmSync(d, { recursive: true, force: true });
  }
});

// A valid sections-only pack manifest: 3 declared sections in a deliberately
// NON-sorted order (so the test proves the loader sorts by `order`), no
// categories anywhere, no config.yaml. tenant_kind: project (subdir pack —
// mirrors the shipped ai-literacy pack).
const SECTIONS_PACK_YAML = [
  'id: ai-literacy',
  'name: AI Literacy',
  'version: 1.0.0',
  'schema_version: "1"',
  'tenant_kind: project',
  'description: Sections-only test pack.',
  'origin_hint: authored',
  'sections:',
  '  - id: glossary',
  '    name: Glossary',
  '    order: 2',
  '    style: index',
  '  - id: foundations',
  '    name: Foundations',
  '    order: 0',
  '    style: track',
  '    default: true',
  '  - id: tools',
  '    name: Tools',
  '    order: 1',
  '    style: track',
].join('\n');

// A pack manifest with NO sections: key at all → "no declared sections."
const NO_SECTIONS_PACK_YAML = [
  'id: plain-pack',
  'name: Plain Pack',
  'version: 1.0.0',
  'schema_version: "1"',
  'tenant_kind: project',
  'description: No declared sections.',
  'origin_hint: authored',
].join('\n');

function note(id: string, title: string, opts: { section?: string; order?: number } = {}): string {
  return [
    '---',
    `id: ${id}`,
    `title: ${title}`,
    'type: note',
    'author: tester',
    'created: 2026-05-31',
    'updated: 2026-05-31',
    'difficulty: beginner',
    ...(opts.section ? [`section: ${opts.section}`] : []),
    ...(opts.order !== undefined ? [`order: ${opts.order}`] : []),
    '---',
    '',
    `Body for ${id}.`,
    '',
  ].join('\n');
}

function pathYaml(id: string, title: string, stepContentId: string, section?: string): string {
  return [
    `id: ${id}`,
    `title: ${title}`,
    'type: path',
    'author: tester',
    ...(section ? [`section: ${section}`] : []),
    'steps:',
    `  - content: ${stepContentId}`,
    '',
  ].join('\n');
}

/**
 * Build a sections-only pack at `<root>/.paradigm/university/ai-literacy/`.
 * Entries:
 *   - N-f1 (foundations, order 1), N-f0 (foundations, order 0)  — proves entry sort
 *   - N-t1 (tools)
 *   - N-untagged (NO section → falls into default `foundations`)
 *   - LP-start (foundations) — a learning path, so `paths` is non-empty
 * 5 entries; glossary section declared but EMPTY (proves empty sections survive).
 */
function buildSectionsPack(rootDir: string): string {
  const packRoot = path.join(rootDir, '.paradigm', 'university', 'ai-literacy');
  const base = path.join(packRoot, 'content');
  fs.mkdirSync(path.join(base, 'notes'), { recursive: true });
  fs.mkdirSync(path.join(base, 'paths'), { recursive: true });

  fs.writeFileSync(path.join(packRoot, 'pack.yaml'), SECTIONS_PACK_YAML, 'utf8');
  fs.writeFileSync(path.join(base, 'notes', 'N-f1.md'), note('N-f1', 'F One', { section: 'foundations', order: 1 }), 'utf8');
  fs.writeFileSync(path.join(base, 'notes', 'N-f0.md'), note('N-f0', 'F Zero', { section: 'foundations', order: 0 }), 'utf8');
  fs.writeFileSync(path.join(base, 'notes', 'N-t1.md'), note('N-t1', 'T One', { section: 'tools' }), 'utf8');
  fs.writeFileSync(path.join(base, 'notes', 'N-untagged.md'), note('N-untagged', 'Untagged'), 'utf8');
  fs.writeFileSync(path.join(base, 'paths', 'LP-start.yaml'), pathYaml('LP-start', 'Start', 'N-f0', 'foundations'), 'utf8');

  return packRoot;
}

describe('C1 — onboard, sections-only pack', () => {
  it('packDeclaresSections is true for a raw pack.yaml with a non-empty sections array', () => {
    const rootDir = mktemp();
    const packRoot = buildSectionsPack(rootDir);
    expect(packDeclaresSections(packRoot)).toBe(true);
  });

  it('returns a non-empty, section-ordered sequence (not the project fallback)', () => {
    const rootDir = mktemp();
    const packRoot = buildSectionsPack(rootDir);

    const seq = getOnboardingSequence(rootDir, undefined, packRoot);

    // Flat fields stay populated (additive contract).
    expect(seq.totalContent).toBe(5);
    expect(seq.paths.map(p => p.id)).toEqual(['LP-start']);
    expect(seq.paths[0].steps).toBe(1); // path body loaded via packRoot
    expect(seq.suggestedContent.length).toBeGreaterThan(0);

    // Section grouping present and ordered by section `order` (foundations=0,
    // tools=1, glossary=2) — NOT manifest declaration order.
    expect(seq.sections).toBeDefined();
    expect(seq.sections!.map(s => s.id)).toEqual(['foundations', 'tools', 'glossary']);
    expect(seq.sections!.map(s => s.name)).toEqual(['Foundations', 'Tools', 'Glossary']);

    // foundations: N-f0(order0), N-f1(order1), then untagged + LP-start (no
    // order → sorted after, by id). Untagged entry lands in the default section.
    const foundations = seq.sections!.find(s => s.id === 'foundations')!;
    expect(foundations.entries.map(e => e.id)).toEqual([
      'N-f0', 'N-f1', 'LP-start', 'N-untagged',
    ]);

    const tools = seq.sections!.find(s => s.id === 'tools')!;
    expect(tools.entries.map(e => e.id)).toEqual(['N-t1']);

    // Declared-but-empty section is preserved with an empty entries list.
    const glossary = seq.sections!.find(s => s.id === 'glossary')!;
    expect(glossary.entries).toEqual([]);

    // Every entry is accounted for across sections exactly once.
    const grouped = seq.sections!.flatMap(s => s.entries.map(e => e.id)).sort();
    expect(grouped).toEqual(['LP-start', 'N-f0', 'N-f1', 'N-t1', 'N-untagged']);
  });
});

describe('C1 back-compat — no declared sections omits `sections`', () => {
  it('a pack with NO sections: key returns no `sections` field (category path)', () => {
    const rootDir = mktemp();
    const packRoot = path.join(rootDir, '.paradigm', 'university', 'plain-pack');
    const base = path.join(packRoot, 'content', 'notes');
    fs.mkdirSync(base, { recursive: true });
    fs.writeFileSync(path.join(packRoot, 'pack.yaml'), NO_SECTIONS_PACK_YAML, 'utf8');
    fs.writeFileSync(path.join(base, 'N-a.md'), note('N-a', 'Alpha'), 'utf8');

    expect(packDeclaresSections(packRoot)).toBe(false);

    const seq = getOnboardingSequence(rootDir, undefined, packRoot);
    expect(seq.sections).toBeUndefined();
    expect(seq.totalContent).toBe(1);
  });

  it('no-selector (project) onboard omits `sections` and keeps the flat shape', () => {
    const rootDir = mktemp();
    const base = path.join(rootDir, '.paradigm', 'university', 'content', 'notes');
    fs.mkdirSync(base, { recursive: true });
    fs.writeFileSync(path.join(base, 'N-a.md'), note('N-a', 'Alpha'), 'utf8');
    fs.writeFileSync(path.join(base, 'N-b.md'), note('N-b', 'Beta'), 'utf8');
    // Project path reads the persisted index.yaml (built by every write/reindex).
    rebuildUniversityIndex(rootDir);

    const seq = getOnboardingSequence(rootDir); // no packRoot
    expect(seq.sections).toBeUndefined();
    expect(seq.totalContent).toBe(2);
    // Exact pre-C1 key set — guards the byte-identical project path.
    expect(Object.keys(seq).sort()).toEqual([
      'diplomaCount', 'extracurricular', 'paths', 'suggestedContent', 'totalContent',
    ]);
  });
});

function diploma(id: string, student: string, source: string): Diploma {
  return {
    id,
    type: 'path',
    student,
    earnedAt: '2026-05-31T00:00:00.000Z',
    source,
    score: 1,
    total: 1,
    percentage: 100,
    passed: true,
  };
}

describe('C1.3 — diploma scoping (regression: no double-join on default path)', () => {
  it('no-pack onboard reads project diplomas (completed path + diplomaCount)', () => {
    const rootDir = mktemp();
    const base = path.join(rootDir, '.paradigm', 'university', 'content');
    fs.mkdirSync(path.join(base, 'paths'), { recursive: true });
    fs.writeFileSync(path.join(base, 'paths', 'LP-foo.yaml'), pathYaml('LP-foo', 'Foo Path', 'plsat:x'), 'utf8');
    rebuildUniversityIndex(rootDir);

    // Write a diploma to the PROJECT diplomas dir (no packRoot).
    saveDiploma(rootDir, diploma('D-1', 'alice', 'LP-foo'));

    // Direct loadDiplomas no-pack read must find it (guards the double-join).
    expect(loadDiplomas(rootDir, { student: 'alice' })).toHaveLength(1);

    // Onboard with a student (the tool always supplies one) → diploma resolves.
    const seq = getOnboardingSequence(rootDir, 'alice');
    expect(seq.diplomaCount).toBe(1);
    const lpFoo = seq.paths.find(p => p.id === 'LP-foo');
    expect(lpFoo?.completed).toBe(true);
  });

  it('pack-scoped diploma read/write agree (saveDiploma + loadDiplomas same dir)', () => {
    const rootDir = mktemp();
    const packRoot = buildSectionsPack(rootDir);

    // saveDiploma(packRoot) writes <packRoot>/diplomas; loadDiplomas(packRoot)
    // must read the same dir (no double-join).
    saveDiploma(rootDir, diploma('D-2', 'bob', 'LP-start'), packRoot);
    expect(fs.existsSync(path.join(packRoot, 'diplomas', 'D-2.yaml'))).toBe(true);
    expect(loadDiplomas(rootDir, { student: 'bob' }, packRoot)).toHaveLength(1);

    // And onboard over the pack marks the matching path complete.
    const seq = getOnboardingSequence(rootDir, 'bob', packRoot);
    expect(seq.diplomaCount).toBe(1);
    expect(seq.paths.find(p => p.id === 'LP-start')?.completed).toBe(true);
  });
});

describe('C2 — search total-count surfaces truncation', () => {
  it('searchContentWithMeta returns total (pre-slice) and returned (post-slice)', () => {
    const rootDir = mktemp();
    const packRoot = path.join(rootDir, '.paradigm', 'university', 'big-pack');
    const base = path.join(packRoot, 'content', 'notes');
    fs.mkdirSync(base, { recursive: true });
    fs.writeFileSync(path.join(packRoot, 'pack.yaml'), NO_SECTIONS_PACK_YAML, 'utf8');

    // 25 entries → default limit of 20 truncates.
    for (let i = 0; i < 25; i++) {
      const id = `N-${String(i).padStart(2, '0')}`;
      fs.writeFileSync(path.join(base, `${id}.md`), note(id, `Note ${i}`), 'utf8');
    }

    const meta = searchContentWithMeta(rootDir, {}, packRoot);
    expect(meta.total).toBe(25);
    expect(meta.returned).toBe(20);
    expect(meta.entries.length).toBe(20);

    // Back-compat: searchContent returns exactly the sliced entries.
    const plain = searchContent(rootDir, {}, packRoot);
    expect(plain.length).toBe(20);
    expect(plain.map(e => e.id)).toEqual(meta.entries.map(e => e.id));

    // A larger limit lifts the truncation.
    const all = searchContentWithMeta(rootDir, { limit: 100 }, packRoot);
    expect(all.total).toBe(25);
    expect(all.returned).toBe(25);
  });
});

describe('C3a — rebuild guard: project index untouched on non-project pack writes', () => {
  it('isProjectUniversityRoot is true ONLY for <rootDir>/.paradigm/university', () => {
    const rootDir = mktemp();
    const projectUni = path.join(rootDir, '.paradigm', 'university');
    const subPack = path.join(projectUni, 'ai-literacy');

    expect(isProjectUniversityRoot(rootDir, projectUni)).toBe(true);
    // Trailing-slash / non-normalized form still equal (path.resolve normalizes).
    expect(isProjectUniversityRoot(rootDir, projectUni + path.sep)).toBe(true);
    // A subdir pack with tenant_kind: project is NOT the project root.
    expect(isProjectUniversityRoot(rootDir, subPack)).toBe(false);
    // An unrelated path is not.
    expect(isProjectUniversityRoot(rootDir, path.join(rootDir, 'elsewhere'))).toBe(false);
  });

  it('the guarded rebuild does NOT rewrite the project index for a subdir pack', () => {
    const rootDir = mktemp();

    // Seed a project pack with a built index.yaml (the artifact we must not churn).
    const projBase = path.join(rootDir, '.paradigm', 'university', 'content', 'notes');
    fs.mkdirSync(projBase, { recursive: true });
    fs.writeFileSync(path.join(projBase, 'N-proj.md'), note('N-proj', 'Project Note'), 'utf8');
    rebuildUniversityIndex(rootDir);
    const indexPath = path.join(rootDir, '.paradigm', 'university', 'index.yaml');
    const before = fs.readFileSync(indexPath, 'utf8');

    // A write targets a subdir pack (ai-literacy). Replicate the tool's exact
    // guard: rebuild only when the write target IS the project university dir.
    const packRoot = buildSectionsPack(rootDir);
    if (isProjectUniversityRoot(rootDir, packRoot)) rebuildUniversityIndex(rootDir);

    // Project index.yaml is byte-identical — no churn from the pack write.
    expect(fs.readFileSync(indexPath, 'utf8')).toBe(before);
    // It also still describes only the project note, not the pack's entries.
    expect(before).toContain('N-proj');
    expect(before).not.toContain('N-untagged');
  });

  it('the guarded rebuild DOES run when the write target is the project dir', () => {
    const rootDir = mktemp();
    const projBase = path.join(rootDir, '.paradigm', 'university', 'content', 'notes');
    fs.mkdirSync(projBase, { recursive: true });
    fs.writeFileSync(path.join(projBase, 'N-a.md'), note('N-a', 'Alpha'), 'utf8');

    const projectUni = path.join(rootDir, '.paradigm', 'university');
    expect(isProjectUniversityRoot(rootDir, projectUni)).toBe(true);
    if (isProjectUniversityRoot(rootDir, projectUni)) rebuildUniversityIndex(rootDir);

    const indexPath = path.join(projectUni, 'index.yaml');
    expect(fs.existsSync(indexPath)).toBe(true);
    expect(fs.readFileSync(indexPath, 'utf8')).toContain('N-a');
  });
});

describe('C4 — resolveContentBase prefers the base that CONTAINS content', () => {
  it('empty content/ beside populated src/content/ resolves to src/content', () => {
    const rootDir = mktemp();
    const packRoot = path.join(rootDir, '.paradigm', 'university', 'probe-pack');
    // content/ exists but is empty (dirs only, no files).
    fs.mkdirSync(path.join(packRoot, 'content', 'notes'), { recursive: true });
    // src/content/ is populated.
    const src = path.join(packRoot, 'src', 'content', 'notes');
    fs.mkdirSync(src, { recursive: true });
    fs.writeFileSync(path.join(src, 'N-a.md'), note('N-a', 'Alpha'), 'utf8');

    const base = resolveContentBase(packRoot);
    expect(base).toBe(path.join(packRoot, 'src', 'content'));

    // And reads resolve there.
    const entries = searchContent(rootDir, { limit: 100 }, packRoot);
    expect(entries.map(e => e.id)).toEqual(['N-a']);
    expect(entries[0].file).toBe('src/content/notes/N-a.md');
  });

  it('populated content/ wins over src/content/ (probe order preserved)', () => {
    const rootDir = mktemp();
    const packRoot = path.join(rootDir, '.paradigm', 'university', 'probe-pack2');
    const c = path.join(packRoot, 'content', 'notes');
    fs.mkdirSync(c, { recursive: true });
    fs.writeFileSync(path.join(c, 'N-a.md'), note('N-a', 'Alpha'), 'utf8');
    const src = path.join(packRoot, 'src', 'content', 'notes');
    fs.mkdirSync(src, { recursive: true });
    fs.writeFileSync(path.join(src, 'N-b.md'), note('N-b', 'Beta'), 'utf8');

    expect(resolveContentBase(packRoot)).toBe(path.join(packRoot, 'content'));
    const entries = searchContent(rootDir, { limit: 100 }, packRoot);
    expect(entries.map(e => e.id)).toEqual(['N-a']);
  });
});
