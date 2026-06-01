/**
 * normalize-sections.test.ts — §5.3 golden matrix (gates D1).
 *
 * Deep-equality matrix asserting core's `normalizeSections` synthesis matches
 * the pack-loader contract byte-for-byte across the six canonical cases:
 *   - undefined           → [{main,Curriculum,1,track,default:true}]
 *   - []                  → same
 *   - single-no-default   → auto-promoted default:true
 *   - duplicate-id        → throws PackLoadError('manifest-invalid')
 *   - two-defaults        → throws
 *   - multi [2,0,1]       → sorted by order then id
 */

import { describe, it, expect } from 'vitest';
import { normalizeSections, PackLoadError } from '../index.js';

const IMPLICIT_DEFAULT = {
  id: 'main',
  name: 'Curriculum',
  order: 1,
  style: 'track',
  default: true,
};

describe('§5.3 normalizeSections golden matrix', () => {
  it('undefined → synthesized implicit default', () => {
    expect(normalizeSections(undefined)).toEqual([IMPLICIT_DEFAULT]);
  });

  it('null → synthesized implicit default', () => {
    expect(normalizeSections(null)).toEqual([IMPLICIT_DEFAULT]);
  });

  it('[] → synthesized implicit default (treated as missing)', () => {
    expect(normalizeSections([])).toEqual([IMPLICIT_DEFAULT]);
  });

  it('single section with no default → auto-promoted to default:true', () => {
    const out = normalizeSections([{ id: 'only', name: 'Only', order: 5, style: 'index' }]);
    expect(out).toEqual([{ id: 'only', name: 'Only', order: 5, style: 'index', default: true }]);
  });

  it('duplicate section id → throws PackLoadError(manifest-invalid)', () => {
    const dup = [
      { id: 'a', name: 'A', order: 1, style: 'track' },
      { id: 'a', name: 'A2', order: 2, style: 'track' },
    ];
    expect(() => normalizeSections(dup)).toThrow(PackLoadError);
    try {
      normalizeSections(dup);
    } catch (e) {
      expect((e as PackLoadError).errorClass).toBe('manifest-invalid');
    }
  });

  it('two defaults → throws PackLoadError(manifest-invalid)', () => {
    const two = [
      { id: 'a', name: 'A', order: 1, style: 'track', default: true },
      { id: 'b', name: 'B', order: 2, style: 'track', default: true },
    ];
    expect(() => normalizeSections(two)).toThrow(PackLoadError);
    try {
      normalizeSections(two);
    } catch (e) {
      expect((e as PackLoadError).errorClass).toBe('manifest-invalid');
    }
  });

  it('multi-section [order 2,0,1] → sorted by order then id', () => {
    const out = normalizeSections([
      { id: 'c', name: 'C', order: 2, style: 'track' },
      { id: 'a', name: 'A', order: 0, style: 'track' },
      { id: 'b', name: 'B', order: 1, style: 'track' },
    ]);
    expect(out.map(s => s.order)).toEqual([0, 1, 2]);
    expect(out.map(s => s.id)).toEqual(['a', 'b', 'c']);
  });

  it('ties on order → sorted by id (deterministic)', () => {
    const out = normalizeSections([
      { id: 'z', name: 'Z', order: 1, style: 'track' },
      { id: 'a', name: 'A', order: 1, style: 'track' },
    ]);
    expect(out.map(s => s.id)).toEqual(['a', 'z']);
  });

  it('invalid section id → throws PackLoadError(manifest-invalid)', () => {
    expect(() => normalizeSections([{ id: 'Bad ID', name: 'X', order: 1, style: 'track' }]))
      .toThrow(PackLoadError);
  });
});
