/**
 * Cache-aligner rule (#cache-aligner): the generated CLAUDE.md's KV-cacheable
 * HEAD must be byte-stable when only VOLATILE inputs (version string, symbol
 * counts, timestamps, current arc) change. Volatile content lives in the
 * trailer below `ClaudeAdapter.TRAILER_MARKER`; the head above it must not move.
 */
import { describe, it, expect } from 'vitest';
import { ClaudeAdapter } from './claude.js';
import { createMockParadigmFiles } from '../../test-utils.js';
import type { ParadigmFiles } from './types.js';

const adapter = new ClaudeAdapter();

function withMeta(meta: ParadigmFiles['meta']): ParadigmFiles {
  const files = createMockParadigmFiles({ projectName: 'cache-proj' }) as ParadigmFiles;
  return { ...files, meta };
}

describe('CLAUDE.md cache-aligner (#cache-aligner)', () => {
  it('keeps the head byte-identical when only version/counts/date/arc change', () => {
    const a = adapter.generate(
      withMeta({ paradigmVersion: 'v2.0', symbolCount: 100, generatedAt: '2026-01-01T00:00:00Z', currentArc: 'Arc Alpha' }),
    );
    const b = adapter.generate(
      withMeta({ paradigmVersion: 'v9.9', symbolCount: 4242, generatedAt: '2026-08-31T12:00:00Z', currentArc: 'Arc Omega — totally different' }),
    );

    // Sanity: the two full documents DO differ (the volatile trailer changed).
    expect(a).not.toBe(b);

    // The cacheable head must be identical.
    expect(ClaudeAdapter.headOf(a)).toBe(ClaudeAdapter.headOf(b));
  });

  it('head is identical whether or not meta is supplied at all', () => {
    const withNoMeta = adapter.generate(createMockParadigmFiles({ projectName: 'cache-proj' }) as ParadigmFiles);
    const withSomeMeta = adapter.generate(withMeta({ paradigmVersion: 'v3.1', symbolCount: 7 }));
    expect(ClaudeAdapter.headOf(withNoMeta)).toBe(ClaudeAdapter.headOf(withSomeMeta));
  });

  it('the volatile trailer actually carries the version/count/arc (nothing lost)', () => {
    const doc = adapter.generate(withMeta({ paradigmVersion: 'v7.7', symbolCount: 314, currentArc: 'Warpline' }));
    const marker = doc.indexOf(ClaudeAdapter.TRAILER_MARKER);
    const head = doc.slice(0, marker);
    const trailer = doc.slice(marker);

    // Volatile values are BELOW the marker, never above it.
    expect(trailer).toContain('v7.7');
    expect(trailer).toContain('314');
    expect(trailer).toContain('Warpline');
    expect(head).not.toContain('v7.7');
    expect(head).not.toContain('Warpline');
  });

  it('head contains the stable structure (symbol legend + conventions)', () => {
    const head = ClaudeAdapter.headOf(adapter.generate(withMeta({ paradigmVersion: 'v2.0' })));
    expect(head).toContain('## Symbol System');
    expect(head).toContain('# cache-proj - Claude Context');
  });
});
