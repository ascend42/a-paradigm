/**
 * symbol-index.search.test — regression coverage for searchSymbols() after the
 * multi-word tokenization fix.
 *
 * Contract under test (symbol-index.ts):
 *   - Multi-word queries tokenize on whitespace and match an entry when >=1 token
 *     appears across symbol / description / tags / componentType. Results are
 *     ordered by matchedTokens desc, then symbol-name match, then shorter symbol.
 *   - Single-token queries keep the prior literal-substring behavior across all
 *     four fields (no regression for hyphenated words like "session-tracker").
 *   - Empty / whitespace-only queries return [].
 */
import { describe, it, expect } from 'vitest';
import { buildSymbolIndex, searchSymbols } from './symbol-index.js';
import type { SymbolEntry, AggregationResult } from './types.js';

function entry(opts: {
  symbol: string;
  description?: string;
  tags?: string[];
  componentType?: string;
}): SymbolEntry {
  return {
    id: opts.symbol,
    symbol: opts.symbol,
    type: 'component',
    source: 'purpose',
    filePath: 'x/.purpose',
    data: {},
    references: [],
    referencedBy: [],
    tags: opts.tags,
    description: opts.description,
    componentType: opts.componentType,
  };
}

function indexOf(entries: SymbolEntry[]) {
  const result: AggregationResult = { symbols: entries, timestamp: Date.now() } as AggregationResult;
  return buildSymbolIndex(result);
}

describe('searchSymbols — multi-word tokenization', () => {
  it('matches entries containing >=1 query token, ordered by matchedTokens desc', () => {
    const index = indexOf([
      // 2 tokens present ("session" in symbol, "recovery" in description) — no
      // "checkpoint" anywhere, so exactly 2.
      entry({ symbol: '#session-tracker', description: 'crash recovery flow' }),
      // 1 token present ("recovery" in tags)
      entry({ symbol: '#foo', description: 'nothing', tags: ['recovery'] }),
      // 3 tokens present — should rank first
      entry({ symbol: '#session-recovery-checkpoint', description: 'the works' }),
      // 0 tokens — excluded entirely
      entry({ symbol: '#unrelated', description: 'zzz', tags: ['other'] }),
    ]);

    const results = searchSymbols(index, 'session recovery checkpoint');
    const symbols = results.map((r) => r.symbol);

    // Excluded: the zero-token entry never appears.
    expect(symbols).not.toContain('#unrelated');
    // Ordered by matchedTokens desc: 3-token entry first.
    expect(symbols[0]).toBe('#session-recovery-checkpoint');
    // The 1-token entry is present but ranks last of the three matches.
    expect(symbols).toContain('#foo');
    expect(symbols.indexOf('#foo')).toBeGreaterThan(symbols.indexOf('#session-tracker'));
  });

  it('tie-break: at equal matchedTokens, symbol-name match wins over description-only', () => {
    const index = indexOf([
      // 1 token, matched in DESCRIPTION only (no name match)
      entry({ symbol: '#alpha', description: 'this mentions payment somewhere' }),
      // 1 token, matched in the SYMBOL NAME
      entry({ symbol: '#payment', description: 'no keyword body' }),
    ]);
    const results = searchSymbols(index, 'payment nonexistenttoken');
    expect(results.map((r) => r.symbol)).toEqual(['#payment', '#alpha']);
  });

  it('tie-break: equal matchedTokens + equal name-match → shorter symbol first', () => {
    const index = indexOf([
      entry({ symbol: '#payment-form-widget-extended', description: '' }),
      entry({ symbol: '#payment', description: '' }),
    ]);
    const results = searchSymbols(index, 'payment other');
    expect(results.map((r) => r.symbol)).toEqual(['#payment', '#payment-form-widget-extended']);
  });

  it('matches a token that only appears in componentType', () => {
    const index = indexOf([
      entry({ symbol: '#thing', description: 'no keywords', componentType: 'middleware' }),
    ]);
    const results = searchSymbols(index, 'middleware absent');
    expect(results.map((r) => r.symbol)).toEqual(['#thing']);
  });
});

describe('searchSymbols — single-token (no regression)', () => {
  it('single hyphenated token still substring-matches across all four fields', () => {
    const index = indexOf([
      entry({ symbol: '#session-tracker', description: 'nope' }),          // symbol
      entry({ symbol: '#a', description: 'the session-tracker module' }),  // description
      entry({ symbol: '#b', description: 'x', tags: ['session-tracker'] }),// tags
      entry({ symbol: '#c', description: 'x', componentType: 'session-tracker' }), // componentType
      entry({ symbol: '#d', description: 'unrelated' }),                   // no match
    ]);
    const results = searchSymbols(index, 'session-tracker');
    const symbols = results.map((r) => r.symbol).sort();
    expect(symbols).toEqual(['#a', '#b', '#c', '#session-tracker']);
    expect(symbols).not.toContain('#d');
  });

  it('single token does NOT split on the hyphen (would over-match if tokenized)', () => {
    const index = indexOf([
      entry({ symbol: '#session-tracker', description: '' }),
      // Contains "session" and "tracker" separately but NOT the literal "session-tracker".
      entry({ symbol: '#other', description: 'a session about a fitness tracker' }),
    ]);
    const results = searchSymbols(index, 'session-tracker');
    expect(results.map((r) => r.symbol)).toEqual(['#session-tracker']);
  });
});

describe('searchSymbols — empty / whitespace', () => {
  it('empty string → []', () => {
    const index = indexOf([entry({ symbol: '#x', description: 'y' })]);
    expect(searchSymbols(index, '')).toEqual([]);
  });
  it('whitespace-only → []', () => {
    const index = indexOf([entry({ symbol: '#x', description: 'y' })]);
    expect(searchSymbols(index, '   \t  ')).toEqual([]);
  });
});
