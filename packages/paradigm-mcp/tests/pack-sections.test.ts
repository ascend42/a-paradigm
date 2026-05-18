/**
 * pack-sections.test.ts — v6.5 University Sections.
 *
 * Top-3 smoke tests (per Tester intake):
 *   1. PARA back-compat — a pack with no `sections:` synthesizes exactly one
 *      `main` section flagged default:true; every entry maps to it.
 *   2. Implicit default synthesis — both the missing-field and empty-array
 *      cases produce the same single-section synthesized result.
 *   3. Validator negative trio (parametrized): duplicate id + two defaults +
 *      bad schema value all produce classifier-style messages without leaking
 *      manifest body (same SECRET_SENTINEL discipline as pack-loader.test.ts).
 */

import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  loadPackManifest,
  normalizeSections,
  PackLoadError,
} from '../src/utils/pack-loader.js';

const SECRET_SENTINEL = 'SECRET-GATE-DO-NOT-LEAK';

function mktemp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'paradigm-pack-sections-'));
}

function writePackYaml(dir: string, body: string): void {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'pack.yaml'), body, 'utf8');
}

const VALID_MINIMAL = [
  'id: example-pack',
  'name: Example Pack',
  'version: 1.0.0',
  'schema_version: "1"',
  'tenant_kind: project',
  'description: A test pack.',
].join('\n');

describe('pack-sections — implicit default synthesis (back-compat)', () => {
  let tmpDir: string | undefined;
  afterEach(() => {
    if (tmpDir && fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
    tmpDir = undefined;
  });

  it('synthesizes a single `main` default section when `sections:` is missing', () => {
    tmpDir = mktemp();
    writePackYaml(tmpDir, VALID_MINIMAL);
    const m = loadPackManifest(tmpDir);
    expect(m.sections).toBeDefined();
    expect(m.sections!).toHaveLength(1);
    expect(m.sections![0].id).toBe('main');
    expect(m.sections![0].default).toBe(true);
    expect(m.sections![0].style).toBe('track');
  });

  it('synthesizes a single `main` default section when `sections: []` is empty', () => {
    tmpDir = mktemp();
    writePackYaml(tmpDir, VALID_MINIMAL + '\nsections: []\n');
    const m = loadPackManifest(tmpDir);
    expect(m.sections).toHaveLength(1);
    expect(m.sections![0].id).toBe('main');
    expect(m.sections![0].default).toBe(true);
  });

  it('normalizeSections returns implicit default for undefined/null/[]', () => {
    expect(normalizeSections(undefined)).toEqual([
      { id: 'main', name: 'Curriculum', order: 1, style: 'track', default: true },
    ]);
    expect(normalizeSections(null)).toEqual([
      { id: 'main', name: 'Curriculum', order: 1, style: 'track', default: true },
    ]);
    expect(normalizeSections([])).toEqual([
      { id: 'main', name: 'Curriculum', order: 1, style: 'track', default: true },
    ]);
  });
});

describe('pack-sections — valid sections accepted', () => {
  let tmpDir: string | undefined;
  afterEach(() => {
    if (tmpDir && fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
    tmpDir = undefined;
  });

  it('accepts a three-section pack with one default and sorts by order', () => {
    tmpDir = mktemp();
    writePackYaml(
      tmpDir,
      VALID_MINIMAL +
        `
sections:
  - id: extras
    name: Extras
    order: 3
    style: index
  - id: core
    name: Core
    order: 1
    style: track
    default: true
  - id: middle
    name: Middle
    order: 2
    style: featured
`,
    );
    const m = loadPackManifest(tmpDir);
    expect(m.sections!.map((s) => s.id)).toEqual(['core', 'middle', 'extras']);
    expect(m.sections!.filter((s) => s.default).map((s) => s.id)).toEqual(['core']);
  });

  it('auto-promotes a single non-default section to default:true', () => {
    tmpDir = mktemp();
    writePackYaml(
      tmpDir,
      VALID_MINIMAL +
        `
sections:
  - id: only
    name: Only Section
    order: 1
    style: track
`,
    );
    const m = loadPackManifest(tmpDir);
    expect(m.sections!).toHaveLength(1);
    expect(m.sections![0].default).toBe(true);
  });
});

describe('pack-sections — validator negative trio (Tester smoke #3)', () => {
  let tmpDir: string | undefined;
  afterEach(() => {
    if (tmpDir && fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
    tmpDir = undefined;
  });

  it.each([
    {
      label: 'duplicate section id',
      sections: `
sections:
  - id: dupe
    name: First
    order: 1
    style: track
    default: true
  - id: dupe
    name: Second
    order: 2
    style: index
`,
      expectedDetailFragment: 'duplicate section id',
    },
    {
      label: 'two defaults',
      sections: `
sections:
  - id: a
    name: A
    order: 1
    style: track
    default: true
  - id: b
    name: B
    order: 2
    style: index
    default: true
`,
      expectedDetailFragment: 'at most one section may set default',
    },
    {
      label: 'bad style enum',
      sections: `
sections:
  - id: bad
    name: Bad
    order: 1
    style: not-a-real-style
`,
      expectedDetailFragment: 'style',
    },
  ])('rejects $label with manifest-invalid + classifier-only detail', ({ sections, expectedDetailFragment }) => {
    tmpDir = mktemp();
    // Plant the SECRET_SENTINEL inside the description so we can prove the
    // section schema error does not leak manifest body content.
    writePackYaml(
      tmpDir,
      [
        'id: leaky',
        'name: Leaky',
        'version: 1.0.0',
        'schema_version: "1"',
        'tenant_kind: project',
        `description: "innocent ${SECRET_SENTINEL} marker"`,
        sections,
      ].join('\n'),
    );

    try {
      loadPackManifest(tmpDir);
      throw new Error('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(PackLoadError);
      const pe = err as PackLoadError;
      expect(pe.errorClass).toBe('manifest-invalid');
      expect(pe.detail).toContain(expectedDetailFragment);
      // Security: the sentinel from `description` must not leak into the
      // section validation error surface.
      expect(pe.message).not.toContain(SECRET_SENTINEL);
      expect(pe.detail).not.toContain(SECRET_SENTINEL);
    }
  });
});

describe('pack-sections — schema bounds (Aegis review)', () => {
  it('rejects an id with uppercase letters', () => {
    expect(() => normalizeSections([{ id: 'Bad-ID', name: 'X', order: 1, style: 'track' }])).toThrow(PackLoadError);
  });

  it('rejects an id starting with a hyphen', () => {
    expect(() => normalizeSections([{ id: '-leading', name: 'X', order: 1, style: 'track' }])).toThrow(PackLoadError);
  });

  it('rejects an id longer than 64 chars', () => {
    const longId = 'a'.repeat(65);
    expect(() => normalizeSections([{ id: longId, name: 'X', order: 1, style: 'track' }])).toThrow(PackLoadError);
  });

  it('rejects a name longer than 120 chars', () => {
    expect(() =>
      normalizeSections([{ id: 'ok', name: 'x'.repeat(121), order: 1, style: 'track' }]),
    ).toThrow(PackLoadError);
  });

  it('rejects a description longer than 1000 chars', () => {
    expect(() =>
      normalizeSections([{ id: 'ok', name: 'X', order: 1, style: 'track', description: 'd'.repeat(1001) }]),
    ).toThrow(PackLoadError);
  });

  it('rejects order outside [0, 9999]', () => {
    expect(() => normalizeSections([{ id: 'a', name: 'X', order: -1, style: 'track' }])).toThrow(PackLoadError);
    expect(() => normalizeSections([{ id: 'a', name: 'X', order: 10000, style: 'track' }])).toThrow(PackLoadError);
  });

  it('rejects non-integer order', () => {
    expect(() => normalizeSections([{ id: 'a', name: 'X', order: 1.5, style: 'track' }])).toThrow(PackLoadError);
  });

  it('rejects more than 64 sections', () => {
    const tooMany = Array.from({ length: 65 }, (_, i) => ({
      id: `s${i}`,
      name: `S${i}`,
      order: i,
      style: 'track' as const,
    }));
    expect(() => normalizeSections(tooMany)).toThrow(PackLoadError);
  });

  it('rejects a non-boolean default field (strict bool)', () => {
    expect(() =>
      normalizeSections([{ id: 'a', name: 'X', order: 1, style: 'track', default: 'true' as unknown as boolean }]),
    ).toThrow(PackLoadError);
  });
});
