/**
 * Which prefixed tokens in a description are read as symbol references.
 * A token that is not a symbol must never become a reference stub.
 */
import { describe, it, expect } from 'vitest';
import { extractSymbolReferences, proseSymbolId } from './aggregator.js';
import type { ParsedPurposeFile } from './types.js';

function refsFor(description: string, extra: Record<string, unknown> = {}): string[] {
  const parsed = [
    {
      filePath: 'pkg/.purpose',
      directory: 'pkg',
      data: { components: { host: { description, ...extra } } },
    },
  ] as unknown as ParsedPurposeFile[];
  return extractSymbolReferences(parsed).map((r) => r.symbol);
}

describe('proseSymbolId', () => {
  it('keeps kebab-case ids', () => {
    expect(proseSymbolId('#', 'payment-form')).toBe('payment-form');
    expect(proseSymbolId('$', 'checkout-flow')).toBe('checkout-flow');
    expect(proseSymbolId('^', 'authenticated')).toBe('authenticated');
    expect(proseSymbolId('#', 'p09-matrix')).toBe('p09-matrix');
  });

  it('trims the punctuation that ends a sentence', () => {
    expect(proseSymbolId('^', 'peer-paired.')).toBe('peer-paired');
    expect(proseSymbolId('#', 'fabric-lock.')).toBe('fabric-lock');
    expect(proseSymbolId('#', 'trailing-')).toBe('trailing');
  });

  it('rejects all-caps names such as environment variables', () => {
    for (const id of ['HOME', 'CLAUDE_PROJECT_DIR', 'XDG_RUNTIME_DIR', 'USER', 'N', 'TEMP']) {
      expect(proseSymbolId('$', id)).toBeNull();
      expect(proseSymbolId('#', id)).toBeNull();
    }
  });

  it('rejects ids that are not kebab-case shaped', () => {
    expect(proseSymbolId('#', 'session.active')).toBeNull();
    expect(proseSymbolId('#', 'block_id')).toBeNull();
    expect(proseSymbolId('#', 'renameBtn')).toBeNull();
    expect(proseSymbolId('#', 'TimelineBuilder')).toBeNull();
    expect(proseSymbolId('#', 'a--b')).toBeNull();
  });

  it('rejects hex colours and colour placeholders, for # only', () => {
    for (const id of ['rrggbb', 'rgb', 'rrggbbaa', 'fff', 'cccccc', 'aabbcc', 'a1b2c3', 'f00', 'e5e5e5ff']) {
      expect(proseSymbolId('#', id)).toBeNull();
    }
    // a flow named like a colour placeholder is still a flow
    expect(proseSymbolId('$', 'rgb')).toBe('rgb');
  });

  it('keeps component names that only happen to be spelled with hex letters', () => {
    for (const id of ['feed', 'facade', 'cafe', 'decade', 'badge']) {
      expect(proseSymbolId('#', id)).toBe(id);
    }
  });
});

describe('extractSymbolReferences: prose', () => {
  it('reads real symbols of all five kinds from a description', () => {
    expect(refsFor('Uses #cart-store in $checkout-flow behind ^authenticated, emits !order-placed, under ~audit-required')).toEqual([
      '#cart-store',
      '$checkout-flow',
      '^authenticated',
      '!order-placed',
      '~audit-required',
    ]);
  });

  it('never turns non-symbols into references', () => {
    expect(
      refsFor('Reads $HOME and $CLAUDE_PROJECT_DIR, paints #rrggbb / #1a2b3c on #rename_btn, sets #session.active, loops ~N times'),
    ).toEqual([]);
  });

  it('a symbol at the end of a sentence is the symbol, not a second one with a dot', () => {
    expect(refsFor('Guarded by ^peer-paired. Also see #fabric-lock.')).toEqual(['^peer-paired', '#fabric-lock']);
  });

  it('still skips framework aliases', () => {
    expect(refsFor('imports from $lib and $app')).toEqual([]);
  });

  it('keeps a structured reference exactly as written', () => {
    // Not prose: an explicit list entry is a deliberate reference, so an odd
    // shape is reported as an undeclared reference instead of being dropped.
    expect(refsFor('plain', { gates: ['^OddGate'], components: ['#LegacyThing'] })).toEqual(['^OddGate', '#LegacyThing']);
  });
});
