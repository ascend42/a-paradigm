/**
 * golden.test.ts — §5.1 READ-PATH BYTE-IDENTICAL guarantee.
 *
 * Asserts that the core loader reproduces the read/index/search/onboard/
 * validate contract across BOTH content layouts (`content/` project pack and
 * `src/content/` first-party pack), plus a sections-declaring pack and one
 * that does not. These pin the entry sets, onboard sequences, search totals,
 * and validation issue sets that the 286 paradigm-mcp suite exercises through
 * the re-export shim.
 */

import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  rebuildUniversityIndex,
  loadPackIndex,
  getOnboardingSequence,
  searchContent,
  searchContentWithMeta,
  validateUniversityContent,
} from '../index.js';

function mktemp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'uni-core-golden-'));
}

function write(file: string, body: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, body, 'utf8');
}

function note(id: string, extra: Record<string, unknown> = {}): string {
  const fm = {
    id,
    title: `Title ${id}`,
    type: 'note',
    author: 'tester',
    created: '2026-01-01',
    updated: '2026-01-02',
    tags: ['onboarding'],
    symbols: [],
    difficulty: 'beginner',
    ...extra,
  };
  const lines = Object.entries(fm).map(([k, v]) => `${k}: ${JSON.stringify(v)}`);
  return `---\n${lines.join('\n')}\n---\n\nBody for ${id}\n`;
}

describe('§5.1 golden — content/ project-pack layout', () => {
  let tmpDir: string | undefined;
  afterEach(() => {
    if (tmpDir && fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
    tmpDir = undefined;
  });

  it('rebuildUniversityIndex yields the expected entry set', () => {
    tmpDir = mktemp();
    const uni = path.join(tmpDir, '.paradigm', 'university');
    write(path.join(uni, 'content', 'notes', 'N-1.md'), note('N-1'));
    write(path.join(uni, 'content', 'notes', 'N-2.md'), note('N-2', { difficulty: 'advanced', tags: [] }));

    const index = rebuildUniversityIndex(tmpDir);
    expect(index.totalContent).toBe(2);
    const byId = Object.fromEntries(index.entries.map(e => [e.id, e]));
    expect(byId['N-1'].file).toBe('content/notes/N-1.md');
    expect(byId['N-1'].type).toBe('note');
    expect(byId['N-2'].difficulty).toBe('advanced');
  });

  it('onboard suggests beginner/onboarding content only', () => {
    tmpDir = mktemp();
    const uni = path.join(tmpDir, '.paradigm', 'university');
    write(path.join(uni, 'content', 'notes', 'N-1.md'), note('N-1'));
    write(path.join(uni, 'content', 'notes', 'N-adv.md'), note('N-adv', { difficulty: 'advanced', tags: [] }));
    rebuildUniversityIndex(tmpDir);

    const seq = getOnboardingSequence(tmpDir);
    const ids = seq.suggestedContent.map(e => e.id);
    expect(ids).toContain('N-1');
    expect(ids).not.toContain('N-adv');
    // Legacy/no-selector path → no section-grouped branch.
    expect(seq.sections).toBeUndefined();
  });

  it('search totals + filters are stable', () => {
    tmpDir = mktemp();
    const uni = path.join(tmpDir, '.paradigm', 'university');
    write(path.join(uni, 'content', 'notes', 'N-1.md'), note('N-1', { tags: ['alpha'] }));
    write(path.join(uni, 'content', 'notes', 'N-2.md'), note('N-2', { tags: ['beta'] }));
    rebuildUniversityIndex(tmpDir);

    const all = searchContentWithMeta(tmpDir, {});
    expect(all.total).toBe(2);
    expect(all.returned).toBe(2);
    const filtered = searchContent(tmpDir, { tag: 'alpha' });
    expect(filtered.map(e => e.id)).toEqual(['N-1']);
  });
});

describe('§5.1 golden — src/content first-party layout (scan, no index.yaml)', () => {
  let tmpDir: string | undefined;
  afterEach(() => {
    if (tmpDir && fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
    tmpDir = undefined;
  });

  it('loadPackIndex scans src/content and labels file paths correctly', () => {
    tmpDir = mktemp();
    const packRoot = path.join(tmpDir, 'pack');
    write(path.join(packRoot, 'src', 'content', 'notes', 'N-1.md'), note('N-1'));
    write(path.join(packRoot, 'src', 'content', 'notes', 'N-2.md'), note('N-2'));

    const index = loadPackIndex(packRoot, tmpDir);
    expect(index.totalContent).toBe(2);
    const byId = Object.fromEntries(index.entries.map(e => [e.id, e]));
    expect(byId['N-1'].file).toBe('src/content/notes/N-1.md');
  });

  it('content/ and src/content/ layouts yield identical entry sets for the same content', () => {
    tmpDir = mktemp();
    const contentPack = path.join(tmpDir, 'a');
    const srcPack = path.join(tmpDir, 'b');
    for (const id of ['N-1', 'N-2']) {
      write(path.join(contentPack, 'content', 'notes', `${id}.md`), note(id));
      write(path.join(srcPack, 'src', 'content', 'notes', `${id}.md`), note(id));
    }
    const a = loadPackIndex(contentPack, tmpDir);
    const b = loadPackIndex(srcPack, tmpDir);

    // File label differs by layout; everything else (id/type/section/order/...)
    // must be identical.
    const strip = (e: { file: string }) => ({ ...e, file: e.file.replace(/^(content|src\/content)\//, '') });
    expect(a.entries.map(strip)).toEqual(b.entries.map(strip));
    expect(a.totalContent).toBe(b.totalContent);
  });
});

describe('§5.1 golden — section-declaring vs non-declaring onboard', () => {
  let tmpDir: string | undefined;
  afterEach(() => {
    if (tmpDir && fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
    tmpDir = undefined;
  });

  function packYaml(sections?: string): string {
    return [
      'id: secpack',
      'name: Sec Pack',
      'version: 0.1.0',
      'schema_version: "1"',
      'tenant_kind: project',
      'description: section pack',
      ...(sections ? [sections] : []),
    ].join('\n') + '\n';
  }

  it('a pack DECLARING sections gets the section-grouped onboard branch', () => {
    tmpDir = mktemp();
    const packRoot = path.join(tmpDir, 'pack');
    write(
      path.join(packRoot, 'pack.yaml'),
      packYaml('sections:\n  - { id: intro, name: Intro, order: 1, style: track }\n  - { id: deep, name: Deep, order: 2, style: track }'),
    );
    write(path.join(packRoot, 'content', 'notes', 'N-1.md'), note('N-1', { section: 'intro', order: 1 }));
    write(path.join(packRoot, 'content', 'notes', 'N-2.md'), note('N-2', { section: 'deep', order: 1 }));

    const seq = getOnboardingSequence(tmpDir, undefined, packRoot);
    expect(seq.sections).toBeDefined();
    expect(seq.sections!.map(s => s.id)).toEqual(['intro', 'deep']);
    expect(seq.sections!.find(s => s.id === 'intro')!.entries.map(e => e.id)).toEqual(['N-1']);
    expect(seq.sections!.find(s => s.id === 'deep')!.entries.map(e => e.id)).toEqual(['N-2']);
  });

  it('a pack WITHOUT a sections block keeps the flat (no sections) shape', () => {
    tmpDir = mktemp();
    const packRoot = path.join(tmpDir, 'pack');
    write(path.join(packRoot, 'pack.yaml'), packYaml());
    write(path.join(packRoot, 'content', 'notes', 'N-1.md'), note('N-1'));

    const seq = getOnboardingSequence(tmpDir, undefined, packRoot);
    expect(seq.sections).toBeUndefined();
  });
});

describe('§5.1 golden — validation issue sets', () => {
  let tmpDir: string | undefined;
  afterEach(() => {
    if (tmpDir && fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
    tmpDir = undefined;
  });

  it('flags broken-path-step and dangling-section-ref', () => {
    tmpDir = mktemp();
    const packRoot = path.join(tmpDir, 'pack');
    write(
      path.join(packRoot, 'pack.yaml'),
      [
        'id: vpack',
        'name: V',
        'version: 0.1.0',
        'schema_version: "1"',
        'tenant_kind: project',
        'description: v',
        'sections:',
        '  - { id: intro, name: Intro, order: 1, style: track }',
      ].join('\n') + '\n',
    );
    // a note referencing a non-existent section
    write(path.join(packRoot, 'content', 'notes', 'N-1.md'), note('N-1', { section: 'ghost' }));
    // a learning path with a broken step
    write(
      path.join(packRoot, 'content', 'paths', 'LP-1.yaml'),
      'id: LP-1\ntitle: Path\nauthor: t\ncreated: "2026-01-01"\nupdated: "2026-01-01"\ntags: []\nordered: true\nsteps:\n  - { content: NOPE, required: true }\n',
    );

    const result = validateUniversityContent(tmpDir, {}, packRoot);
    const checks = new Set(result.issues.map(i => i.check));
    expect(checks.has('broken-path-step')).toBe(true);
    expect(checks.has('dangling-section-ref')).toBe(true);
  });
});
