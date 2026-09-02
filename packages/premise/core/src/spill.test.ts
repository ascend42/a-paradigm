import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  spillLargeOutput,
  retrieveSpilled,
  spillDirFor,
  DEFAULT_SPILL_THRESHOLD,
} from './spill.js';

describe('spillLargeOutput / retrieveSpilled (#spill)', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spill-test-'));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('keeps a small array inline (no spill, no file)', () => {
    const r = spillLargeOutput(['#a', '#b', '#c'], { kind: 'admit-changed', dir });
    expect(r.spilled).toBe(false);
    expect(r.handle).toBeNull();
    expect(r.path).toBeNull();
    expect(r.total).toBe(3);
    expect(r.truncatedPreview).toEqual(['#a', '#b', '#c']);
    expect(fs.existsSync(dir) ? fs.readdirSync(dir) : []).toHaveLength(0);
  });

  it('spills a large array over threshold and returns a bounded top-N preview + handle', () => {
    const big = Array.from({ length: 5000 }, (_, i) => `#symbol-${i}-with-a-fairly-long-name`);
    const r = spillLargeOutput(big, { kind: 'admit-changed', dir, previewCount: 20 });

    expect(r.spilled).toBe(true);
    expect(r.handle).toMatch(/^admit-changed-/);
    expect(r.total).toBe(5000);
    expect(Array.isArray(r.truncatedPreview)).toBe(true);
    expect(r.truncatedPreview as unknown[]).toHaveLength(20);
    expect((r.truncatedPreview as string[])[0]).toBe('#symbol-0-with-a-fairly-long-name');
    // The full payload is on disk.
    expect(r.path).not.toBeNull();
    expect(fs.existsSync(r.path!)).toBe(true);
    expect(r.summary).toContain(r.handle!);
  });

  it('rehydrates the spilled payload EXACTLY (lossless round-trip)', () => {
    const big = Array.from({ length: 3000 }, (_, i) => ({ id: `#s-${i}`, weight: i, note: 'x'.repeat(20) }));
    const r = spillLargeOutput(big, { kind: 'transcript', dir });
    expect(r.spilled).toBe(true);

    const back = retrieveSpilled(r.handle!, { dir });
    expect(back.found).toBe(true);
    expect(back.total).toBe(3000);
    expect(back.payload).toEqual(big);
  });

  it('retrieve supports offset/limit windows on array payloads', () => {
    const big = Array.from({ length: 1000 }, (_, i) => i);
    const r = spillLargeOutput(big, { kind: 'nums', dir, threshold: 100 });
    const win = retrieveSpilled(r.handle!, { dir, offset: 990, limit: 20 });
    expect(win.found).toBe(true);
    expect(win.total).toBe(1000);
    expect(win.window).toEqual({ offset: 990, limit: 20, returned: 10 });
    expect(win.payload).toEqual([990, 991, 992, 993, 994, 995, 996, 997, 998, 999]);
  });

  it('spills non-array payloads with a clipped preview, retrieve returns the whole object', () => {
    const obj = { blob: 'y'.repeat(DEFAULT_SPILL_THRESHOLD + 500), meta: { k: 1 } };
    const r = spillLargeOutput(obj, { kind: 'blob', dir });
    expect(r.spilled).toBe(true);
    expect(typeof r.truncatedPreview).toBe('string');
    const back = retrieveSpilled(r.handle!, { dir });
    expect(back.total).toBeNull(); // not an array
    expect(back.payload).toEqual(obj);
  });

  it('rejects a traversal handle and reports missing handles without throwing', () => {
    expect(retrieveSpilled('../../etc/passwd', { dir }).error).toBe('invalid handle');
    const missing = retrieveSpilled('nope-123-abc', { dir });
    expect(missing.found).toBe(false);
    expect(missing.error).toContain('not found');
  });

  it('spillDirFor is the canonical <root>/.paradigm/spill path', () => {
    expect(spillDirFor('/repo')).toBe(path.join('/repo', '.paradigm', 'spill'));
  });
});
