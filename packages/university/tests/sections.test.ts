/**
 * sections.test.ts — v6.5 University Sections.
 *
 * Covers the server-side section integrity + assignment rule that gates
 * the v6.5 University Sections feature. Sections live at the
 * learning-path layer in pack.yaml; v6.5 implements only the `track`
 * style. Other styles parse-but-warn (UI degrades to track).
 *
 * Tests:
 *   - normalizeSections() input integrity (empty / undefined / sort /
 *     coerce / invalid drop / unknown-style warn / non-track style warn)
 *   - assignSectionId() rule precedence (explicit > default > sole > 'main')
 *   - loadSectionsFromYamlFile() against the first-party pack.yaml
 *
 * NOTE: the local `warn` helper in src/server/sections.ts writes to
 * `console.log` (not `console.warn`), so the spies below target
 * `console.log`. See sections.ts line 42.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as path from 'path';
import { fileURLToPath } from 'url';

import {
  normalizeSections,
  assignSectionId,
  loadSectionsFromYamlFile,
  IMPLICIT_DEFAULT_SECTIONS,
  type Section,
} from '../src/server/sections.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const UNI_ROOT = path.resolve(__dirname, '..');
const FIRST_PARTY_PACK_YAML = path.join(UNI_ROOT, 'src', 'content', 'pack.yaml');

// ─────────────────────────────────────────────────────────────
// normalizeSections — integrity
// ─────────────────────────────────────────────────────────────

describe('normalizeSections — implicit default fallback', () => {
  it('returns implicit default for empty array', () => {
    const result = normalizeSections([]);
    expect(result).toEqual(IMPLICIT_DEFAULT_SECTIONS);
    expect(result[0]).toEqual({ id: 'main', name: 'Main', order: 0, style: 'track', default: true });
  });

  it('returns implicit default for undefined', () => {
    const result = normalizeSections(undefined);
    expect(result).toEqual(IMPLICIT_DEFAULT_SECTIONS);
  });

  it('returns implicit default for null', () => {
    const result = normalizeSections(null);
    expect(result).toEqual(IMPLICIT_DEFAULT_SECTIONS);
  });

  it('returns implicit default when all entries are invalid', () => {
    // Suppress noisy chalk warn output during this test
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const result = normalizeSections([{ name: 'No ID' }, 'not-an-object']);
    expect(result).toEqual(IMPLICIT_DEFAULT_SECTIONS);
    logSpy.mockRestore();
  });

  it('returns a fresh array (not the shared singleton) so mutation is safe', () => {
    const a = normalizeSections([]);
    const b = normalizeSections([]);
    expect(a).not.toBe(IMPLICIT_DEFAULT_SECTIONS);
    expect(a).not.toBe(b);
  });
});

describe('normalizeSections — valid input', () => {
  it('returns a valid single section unchanged', () => {
    const input: unknown[] = [
      { id: 'courses', name: 'Courses', order: 0, style: 'track', default: true, description: 'Tracks' },
    ];
    const result = normalizeSections(input);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      id: 'courses',
      name: 'Courses',
      order: 0,
      style: 'track',
      default: true,
      description: 'Tracks',
    });
  });

  it('sorts sections by order ascending', () => {
    const input: unknown[] = [
      { id: 'b', name: 'B', order: 2, style: 'track' },
      { id: 'a', name: 'A', order: 0, style: 'track' },
      { id: 'c', name: 'C', order: 1, style: 'track' },
    ];
    const result = normalizeSections(input);
    expect(result.map(s => s.id)).toEqual(['a', 'c', 'b']);
  });

  it('coerces missing order to array index', () => {
    const input: unknown[] = [
      { id: 'first', name: 'First', style: 'track' },  // no order → 0
      { id: 'second', name: 'Second', style: 'track' }, // no order → 1
      { id: 'third', name: 'Third', order: 5, style: 'track' },
    ];
    const result = normalizeSections(input);
    // After coercion + sort by order: first(0), second(1), third(5)
    expect(result.map(s => ({ id: s.id, order: s.order }))).toEqual([
      { id: 'first', order: 0 },
      { id: 'second', order: 1 },
      { id: 'third', order: 5 },
    ]);
  });

  it('omits optional description when source has no description', () => {
    const result = normalizeSections([
      { id: 'a', name: 'A', order: 0, style: 'track' },
    ]);
    expect(result[0]).not.toHaveProperty('description');
  });

  it('omits default flag when source value is not strictly true', () => {
    const result = normalizeSections([
      { id: 'a', name: 'A', order: 0, style: 'track', default: false },
      { id: 'b', name: 'B', order: 1, style: 'track', default: 'true' /* string, not bool */ },
    ]);
    expect(result[0]).not.toHaveProperty('default');
    expect(result[1]).not.toHaveProperty('default');
  });
});

describe('normalizeSections — invalid entries dropped, valid siblings preserved', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  it('drops entry missing id, keeps valid sibling', () => {
    const input: unknown[] = [
      { name: 'No ID', order: 0, style: 'track' },
      { id: 'ok', name: 'OK', order: 1, style: 'track' },
    ];
    const result = normalizeSections(input);
    expect(result.map(s => s.id)).toEqual(['ok']);
    expect(logSpy).toHaveBeenCalled();
  });

  it('drops entry missing name, keeps valid sibling', () => {
    const input: unknown[] = [
      { id: 'no-name', order: 0, style: 'track' },
      { id: 'ok', name: 'OK', order: 1, style: 'track' },
    ];
    const result = normalizeSections(input);
    expect(result.map(s => s.id)).toEqual(['ok']);
  });

  it('drops entry missing style, keeps valid sibling', () => {
    const input: unknown[] = [
      { id: 'no-style', name: 'No Style', order: 0 },
      { id: 'ok', name: 'OK', order: 1, style: 'track' },
    ];
    const result = normalizeSections(input);
    expect(result.map(s => s.id)).toEqual(['ok']);
  });

  it('drops entry with unknown style, keeps valid sibling', () => {
    const input: unknown[] = [
      { id: 'weird', name: 'Weird', order: 0, style: 'kaleidoscope' },
      { id: 'ok', name: 'OK', order: 1, style: 'track' },
    ];
    const result = normalizeSections(input);
    expect(result.map(s => s.id)).toEqual(['ok']);
  });

  it('drops non-object entries (string, number, null)', () => {
    const input: unknown[] = [
      'just-a-string',
      42,
      null,
      { id: 'ok', name: 'OK', order: 0, style: 'track' },
    ];
    const result = normalizeSections(input);
    expect(result.map(s => s.id)).toEqual(['ok']);
  });
});

describe('normalizeSections — non-track styles', () => {
  it('keeps a section with style "index" but emits a fallback warn', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const input: unknown[] = [
      { id: 'all', name: 'All', order: 0, style: 'index' },
    ];
    const result = normalizeSections(input);
    expect(result).toHaveLength(1);
    expect(result[0].style).toBe('index');
    expect(result[0].id).toBe('all');
    // At least one warn message about the unimplemented style
    const warnCalls = logSpy.mock.calls.map(c => String(c[0]));
    expect(warnCalls.some(m => m.includes('not yet implemented'))).toBe(true);
    logSpy.mockRestore();
  });

  it('keeps chronological + featured styles with fallback warns', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const input: unknown[] = [
      { id: 'a', name: 'A', order: 0, style: 'chronological' },
      { id: 'b', name: 'B', order: 1, style: 'featured' },
    ];
    const result = normalizeSections(input);
    expect(result.map(s => s.style)).toEqual(['chronological', 'featured']);
    logSpy.mockRestore();
  });
});

// ─────────────────────────────────────────────────────────────
// assignSectionId — precedence rule
// ─────────────────────────────────────────────────────────────

describe('assignSectionId — explicit course value wins', () => {
  it('returns explicit course section verbatim, ignoring sections list', () => {
    const sections: Section[] = [
      { id: 'a', name: 'A', order: 0, style: 'track', default: true },
    ];
    // Spec: explicit values are NOT validated against the sections list.
    // Path-level authority wins; UI handles unknown ids gracefully.
    expect(assignSectionId('not-in-list', sections)).toBe('not-in-list');
  });

  it('trims whitespace around explicit value', () => {
    const sections: Section[] = [{ id: 'a', name: 'A', order: 0, style: 'track', default: true }];
    expect(assignSectionId('  courses  ', sections)).toBe('courses');
  });

  it('treats whitespace-only string as missing and falls through to default rule', () => {
    const sections: Section[] = [
      { id: 'a', name: 'A', order: 0, style: 'track', default: true },
    ];
    expect(assignSectionId('   ', sections)).toBe('a');
  });
});

describe('assignSectionId — default-section fallback', () => {
  it('returns id of section marked default when course omits section', () => {
    const sections: Section[] = [
      { id: 'a', name: 'A', order: 0, style: 'track' },
      { id: 'b', name: 'B', order: 1, style: 'track', default: true },
      { id: 'c', name: 'C', order: 2, style: 'track' },
    ];
    expect(assignSectionId(undefined, sections)).toBe('b');
  });

  it('returns sole section id when no default flag and exactly one section', () => {
    const sections: Section[] = [
      { id: 'only', name: 'Only', order: 0, style: 'track' },
    ];
    expect(assignSectionId(undefined, sections)).toBe('only');
  });

  it('returns "main" when sections list is empty', () => {
    // Matches the implicit-default id; gives flat (sectionless) packs a
    // stable bucket on every course summary.
    expect(assignSectionId(undefined, [])).toBe('main');
  });

  it('returns "main" when no default and multiple sections are declared', () => {
    // Defensive fallback per spec: if the pack has multiple sections but
    // forgot to mark one default, courses without explicit section land
    // in 'main' (which usually won't render, but won't break the UI).
    const sections: Section[] = [
      { id: 'a', name: 'A', order: 0, style: 'track' },
      { id: 'b', name: 'B', order: 1, style: 'track' },
    ];
    expect(assignSectionId(undefined, sections)).toBe('main');
  });
});

// ─────────────────────────────────────────────────────────────
// loadSectionsFromYamlFile — first-party pack
// ─────────────────────────────────────────────────────────────

describe('loadSectionsFromYamlFile — first-party pack.yaml', () => {
  it('reads the bundled paradigm-university pack.yaml and returns its sections', () => {
    const result = loadSectionsFromYamlFile(FIRST_PARTY_PACK_YAML);
    expect(result.length).toBeGreaterThanOrEqual(1);
    const courses = result.find(s => s.id === 'courses');
    expect(courses).toBeDefined();
    expect(courses).toMatchObject({
      id: 'courses',
      name: 'Courses',
      order: 0,
      style: 'track',
      default: true,
    });
  });

  it('returns implicit default for a missing file path', () => {
    const result = loadSectionsFromYamlFile(path.join(UNI_ROOT, 'does-not-exist.yaml'));
    expect(result).toEqual(IMPLICIT_DEFAULT_SECTIONS);
  });
});
