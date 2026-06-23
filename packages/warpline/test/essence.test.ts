/**
 * essence.test — the load-bearing wall.
 *   - rename (change name/path, same contract) → IDENTICAL contentId
 *   - change a contract slot (add a gate / change componentType) → DIFFERENT
 *   - determinism: hashing the same node twice → byte-identical id
 */

import { describe, it, expect } from 'vitest';
import {
  buildSymbolIndex,
  type AggregationResult,
  type SymbolEntry,
} from '@a-company/premise-core';
import { computeEssences } from '../src/warp/essence-hash.js';

function mkEntry(p: Partial<SymbolEntry> & { id: string; symbol: string }): SymbolEntry {
  return {
    type: 'component',
    source: 'purpose',
    filePath: 'src/x/.purpose',
    data: {},
    references: [],
    referencedBy: [],
    ...p,
  };
}

function indexOf(entries: SymbolEntry[]) {
  const result: AggregationResult = {
    symbols: entries,
    purposeFiles: [],
    portalFiles: [],
    errors: [],
    timestamp: 0,
  };
  return buildSymbolIndex(result);
}

function essenceFor(entries: SymbolEntry[], symbol: string): string {
  const index = indexOf(entries);
  const { contentIds } = computeEssences(
    index,
    entries.map((e) => e.symbol),
  );
  return contentIds.get(symbol)!;
}

describe('essence — rename is free', () => {
  it('changing only name + path → identical contentId', () => {
    const before = mkEntry({
      id: 'uuid-1',
      symbol: '#login-handler',
      componentType: 'service',
      filePath: 'src/auth/.purpose',
      data: { gates: ['^authenticated'], signals: ['!login-success'] },
    });
    const after = mkEntry({
      id: 'uuid-1', // SAME stable id
      symbol: '#auth-handler', // renamed
      componentType: 'service',
      filePath: 'src/authentication/.purpose', // moved
      data: { gates: ['^authenticated'], signals: ['!login-success'] },
    });
    expect(essenceFor([before], '#login-handler')).toBe(
      essenceFor([after], '#auth-handler'),
    );
  });
});

describe('essence — meaning moves the hash', () => {
  it('adding a gate → different contentId', () => {
    const before = mkEntry({
      id: 'uuid-2',
      symbol: '#checkout',
      componentType: 'view',
      data: { gates: ['^authenticated'] },
    });
    const after = mkEntry({
      id: 'uuid-2',
      symbol: '#checkout',
      componentType: 'view',
      data: { gates: ['^authenticated', '^payment-verified'] },
    });
    expect(essenceFor([before], '#checkout')).not.toBe(essenceFor([after], '#checkout'));
  });

  it('changing componentType → different contentId', () => {
    const before = mkEntry({ id: 'uuid-3', symbol: '#widget', componentType: 'view' });
    const after = mkEntry({ id: 'uuid-3', symbol: '#widget', componentType: 'service' });
    expect(essenceFor([before], '#widget')).not.toBe(essenceFor([after], '#widget'));
  });

  it('changing kind (retype) → different contentId', () => {
    const before = mkEntry({ id: 'uuid-4', symbol: '#thing', type: 'component' });
    const after = mkEntry({ id: 'uuid-4', symbol: '#thing', type: 'flow' });
    expect(essenceFor([before], '#thing')).not.toBe(essenceFor([after], '#thing'));
  });
});

describe('essence — determinism', () => {
  it('hashing the same node twice → byte-identical id', () => {
    const e = mkEntry({
      id: 'uuid-5',
      symbol: '#payment-form',
      componentType: 'view',
      data: { gates: ['^a', '^b'], signals: ['!x'], aspects: ['~pii'] },
    });
    const first = essenceFor([e], '#payment-form');
    const second = essenceFor([e], '#payment-form');
    expect(first).toBe(second);
    expect(first.startsWith('essence:v0:')).toBe(true);
  });

  it('set order does not matter (sorted before hashing)', () => {
    const a = mkEntry({ id: 'u', symbol: '#n', data: { gates: ['^a', '^b', '^c'] } });
    const b = mkEntry({ id: 'u', symbol: '#n', data: { gates: ['^c', '^a', '^b'] } });
    expect(essenceFor([a], '#n')).toBe(essenceFor([b], '#n'));
  });
});

describe('essence — Merkle by target essence', () => {
  it('renaming a referenced target does NOT move the referrer essence', () => {
    // referrer -> target. Rename target's NAME (and the edge), keep its contract.
    const targetA = mkEntry({ id: 't', symbol: '#dep', componentType: 'service', data: {} });
    const referrerA = mkEntry({
      id: 'r',
      symbol: '#consumer',
      data: { components: ['#dep'] },
      references: ['#dep'],
    });

    const targetB = mkEntry({ id: 't', symbol: '#dependency', componentType: 'service', data: {} });
    const referrerB = mkEntry({
      id: 'r',
      symbol: '#consumer',
      data: { components: ['#dependency'] },
      references: ['#dependency'],
    });

    expect(essenceFor([referrerA, targetA], '#consumer')).toBe(
      essenceFor([referrerB, targetB], '#consumer'),
    );
  });
});
