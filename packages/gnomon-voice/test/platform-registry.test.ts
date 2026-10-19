import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { excludedTestFiles, PLATFORM_REGISTRY, type Platform } from './platform-registry.js';

const PKG_ROOT = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '..');

describe('G-WIN-05 (gnomon-voice)', () => {
  it.each(['darwin', 'win32', 'linux'] as Platform[])('the files excluded on %s are exactly the registry rows that omit it', (p) => {
    const expected = PLATFORM_REGISTRY.filter((r) => !r.platforms.includes(p)).map((r) => r.test).sort();
    expect(excludedTestFiles(PKG_ROOT, p)).toEqual(expected);
  });
  it('every row has a sibling or a reason', () => {
    for (const r of PLATFORM_REGISTRY) expect(Boolean(r.sibling || r.na)).toBe(true);
  });
});
