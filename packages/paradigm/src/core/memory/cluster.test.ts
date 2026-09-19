/**
 * Tests for #memory-steward-cluster (Memory Steward A1).
 */

import { describe, it, expect } from 'vitest';
import type { ParsedMemoryEntry } from '@a-company/premise-core';
import { clusterEntries } from './cluster.js';

function entry(file: string, body: string): ParsedMemoryEntry {
  return {
    file,
    kind: 'entry',
    name: file,
    description: '',
    type: 'feedback',
    body,
    mtimeMs: 0,
    symbolMentions: [],
    fileMentions: [],
    graphValidity: { deadSymbols: [], deadFiles: [], verdict: 'valid' },
  };
}

describe('clusterEntries', () => {
  it('groups near-duplicate bodies and omits singletons', () => {
    const a = entry('/m/a.md', 'always update the changelog and commit after each change round');
    const b = entry('/m/b.md', 'always update the changelog and commit after every change round');
    const c = entry('/m/c.md', 'completely unrelated note about warpline field test runbook seeds');

    const map = clusterEntries([a, b, c]);
    expect(map.has('/m/a.md')).toBe(true);
    expect(map.has('/m/b.md')).toBe(true);
    expect(map.get('/m/a.md')).toBe(map.get('/m/b.md')); // same cluster
    expect(map.has('/m/c.md')).toBe(false); // singleton omitted
  });

  it('returns an empty map for fewer than two entries', () => {
    expect(clusterEntries([]).size).toBe(0);
    expect(clusterEntries([entry('/m/a.md', 'x y z')]).size).toBe(0);
  });

  it('uses a deterministic cluster id (smallest basename)', () => {
    const a = entry('/m/zzz.md', 'shared tokens alpha beta gamma delta epsilon');
    const b = entry('/m/aaa.md', 'shared tokens alpha beta gamma delta epsilon');
    const map = clusterEntries([a, b]);
    expect(map.get('/m/aaa.md')).toBe('dup:aaa.md');
    expect(map.get('/m/zzz.md')).toBe('dup:aaa.md');
  });

  it('respects a custom threshold', () => {
    const a = entry('/m/a.md', 'one two three four five six');
    const b = entry('/m/b.md', 'one two three seven eight nine'); // half overlap
    expect(clusterEntries([a, b], { threshold: 0.9 }).size).toBe(0);
    expect(clusterEntries([a, b], { threshold: 0.2 }).size).toBe(2);
  });
});
