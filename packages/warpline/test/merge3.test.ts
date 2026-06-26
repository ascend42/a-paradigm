/**
 * merge3.test — the token-level 3-way merge (Phase-C v2 materialization core).
 * The cardinal-sin component: a wrong merge silently corrupts, so this covers
 * disjoint resolution, true-overlap conflict DETECTION, inserts, deletes, and the
 * round-trip (join === text) property.
 */

import { describe, it, expect } from 'vitest';
import { tokenize, mergeText, merge3 } from '../src/fabric/merge3.js';

describe('tokenize', () => {
  it('round-trips: join(tokenize(s)) === s', () => {
    for (const s of [
      'export function foo() { return 1; } export function bar() { return 2; }',
      'a\n  b\tc;;;\n',
      'const x = 1.08 * y;',
      '',
    ]) {
      expect(tokenize(s).join('')).toBe(s);
    }
  });
});

describe('mergeText · disjoint changes auto-resolve', () => {
  it('THE HEADLINE — two symbols edited on the SAME line (git conflicts) merge clean', () => {
    const base = 'export function foo() { return 1; } export function bar() { return 2; }\n';
    const ours = 'export function foo() { return 10; } export function bar() { return 2; }\n';
    const theirs = 'export function foo() { return 1; } export function bar() { return 20; }\n';
    const r = mergeText(base, ours, theirs);
    expect(r.conflicts).toBe(0);
    expect(r.text).toBe('export function foo() { return 10; } export function bar() { return 20; }\n');
  });

  it('disjoint edits on different lines merge clean', () => {
    const base = 'a = 1;\nb = 2;\nc = 3;\n';
    const ours = 'a = 1;\nb = 22;\nc = 3;\n';
    const theirs = 'a = 11;\nb = 2;\nc = 3;\n';
    const r = mergeText(base, ours, theirs);
    expect(r.conflicts).toBe(0);
    expect(r.text).toBe('a = 11;\nb = 22;\nc = 3;\n');
  });

  it('only one side changes → take that side', () => {
    const base = 'x = 1;\n';
    expect(mergeText(base, 'x = 9;\n', base)).toEqual({ text: 'x = 9;\n', conflicts: 0 });
    expect(mergeText(base, base, 'x = 7;\n')).toEqual({ text: 'x = 7;\n', conflicts: 0 });
  });

  it('both sides make the identical change → take it (convergent)', () => {
    const base = 'x = 1;\n';
    const r = mergeText(base, 'x = 5;\n', 'x = 5;\n');
    expect(r).toEqual({ text: 'x = 5;\n', conflicts: 0 });
  });

  it('disjoint INSERTS both land', () => {
    const base = 'function a() {}\nfunction c() {}\n';
    const ours = 'function a() {}\nfunction b() {}\nfunction c() {}\n'; // insert b
    const theirs = 'function a() {}\nfunction c() {}\nfunction d() {}\n'; // append d
    const r = mergeText(base, ours, theirs);
    expect(r.conflicts).toBe(0);
    expect(r.text).toBe('function a() {}\nfunction b() {}\nfunction c() {}\nfunction d() {}\n');
  });

  it('a deletion on one side + an edit elsewhere on the other merge clean', () => {
    const base = 'keep1;\ndrop;\nkeep2;\n';
    const ours = 'keep1;\nkeep2;\n'; // delete `drop`
    const theirs = 'keep1;\ndrop;\nkeep2x;\n'; // edit keep2
    const r = mergeText(base, ours, theirs);
    expect(r.conflicts).toBe(0);
    expect(r.text).toBe('keep1;\nkeep2x;\n');
  });
});

describe('mergeText · true overlaps are CONFLICTS, never silently merged', () => {
  it('both change the SAME token differently → conflict flagged', () => {
    const base = 'x = 1;\n';
    const r = mergeText(base, 'x = 10;\n', 'x = 20;\n');
    expect(r.conflicts).toBeGreaterThan(0);
  });

  it('overlapping multi-token edits → conflict flagged', () => {
    const base = 'return a + b;\n';
    const r = mergeText(base, 'return a * b;\n', 'return a - b;\n');
    expect(r.conflicts).toBeGreaterThan(0);
  });
});

describe('merge3 · array-level (the primitive)', () => {
  it('handles empty base (both insert)', () => {
    const r = merge3([], ['a'], ['b']);
    // both inserted into an empty base at the same spot → overlap → conflict
    expect(r.conflicts).toBeGreaterThan(0);
  });
  it('identical inputs → unchanged, no conflict', () => {
    const r = merge3(['a', 'b'], ['a', 'b'], ['a', 'b']);
    expect(r).toEqual({ merged: ['a', 'b'], conflicts: 0 });
  });
});
