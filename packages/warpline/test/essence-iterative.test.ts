/**
 * essence-iterative.test — the essence walk is ITERATIVE, and it did not move
 * a single content address doing it.
 *
 * WHY THIS FILE EXISTS. `essenceOf` used to reach itself through TWO resolvers
 * (the singleton edge resolver, and the SCC unit's out-of-unit resolver, with
 * `essenceOf` calling `hashSCC` in turn) — one mutual recursion with two entry
 * arms. JS call depth was therefore the length of the longest chain in the SCC
 * condensation, and it blew at roughly a THOUSAND (measured: 1,050 resolves,
 * 1,080 throws `Maximum call stack size exceeded` on a default stack). Not an
 * object-count ceiling — 125,008 objects hash fine when the graph is shallow.
 *
 * Two things have to be true at once, and the second is the dangerous one:
 *   1. depth far past the old ceiling now resolves           (deepChain, cycleTail)
 *   2. every `essence:` id is BYTE-IDENTICAL to the recursive walk's
 *
 * (2) is pinned with a literal captured from the PRE-CHANGE code. If an id
 * moves, every strand's recorded contentId stops matching what the code
 * computes and the fabric's history becomes unverifiable — a failure that
 * passes every functional test, which is exactly why it is a golden literal
 * here and not a self-consistency check.
 */

import { describe, it, expect } from 'vitest';
import {
  buildSymbolIndex,
  getAllSymbols,
  type AggregationResult,
  type SymbolEntry,
} from '@a-company/premise-core';
import { computeEssences } from '../src/warp/essence-hash.js';

function e(p: Partial<SymbolEntry> & { id: string; symbol: string }): SymbolEntry {
  return {
    type: 'component',
    source: 'purpose',
    filePath: 'src/x/.purpose',
    data: {},
    references: [],
    referencedBy: [],
    ...p,
  } as SymbolEntry;
}

function indexOf(entries: SymbolEntry[]) {
  const agg: AggregationResult = {
    symbols: entries,
    purposeFiles: [],
    portalFiles: [],
    errors: [],
    timestamp: 0,
  };
  return buildSymbolIndex(agg);
}

function essencesOf(entries: SymbolEntry[], order?: (s: string[]) => string[]) {
  const index = indexOf(entries);
  const syms = getAllSymbols(index).map((s) => s.symbol);
  return computeEssences(index, order ? order(syms) : syms).contentIds;
}

/* ───────────────────────── the golden fixture ──────────────────────────── */

/**
 * One graph touching every branch of the walk: a rich contract, a GENERIC
 * contract (folds the uuid), a flow with ordered steps, a gate, an aspect, a
 * true SCC of three, a self-loop singleton, a code-unit with inline `f:N` slot
 * substitution and a pinned compiler tag, and a 12-deep DAG chain.
 */
function goldenFixture(): SymbolEntry[] {
  const entries: SymbolEntry[] = [
    e({
      id: 'u-rich',
      symbol: '#rich',
      componentType: 'service',
      data: {
        gates: ['^b', '^a', '^a'],
        signals: ['!z', '!y'],
        aspects: ['~m'],
        states: ['s2', 's1'],
        category: 'core',
        severity: 'high',
        'applies-to': ['#q'],
        enforcement: 'strict',
      },
      references: ['^a', '#chain0', '#scc-a', '#nowhere'],
    }),
    e({ id: 'u-generic', symbol: '#generic' }),
    e({
      id: 'u-flow',
      symbol: '$flow',
      type: 'flow',
      data: {
        steps: [
          { component: '#chain1', action: 'go', description: 'prose dropped' },
          { component: '#chain2', action: 'stop' },
        ],
      },
      references: ['#chain1', '#chain2'],
    }),
    e({ id: 'u-gate', symbol: '^a', type: 'gate', data: { severity: 'low' } }),
    e({ id: 'u-aspect', symbol: '~m', type: 'aspect', appliesTo: ['#rich'], enforcement: 'advisory' }),
    e({ id: 'u-sa', symbol: '#scc-a', componentType: 'view', data: { gates: ['^a'] }, references: ['#scc-b'] }),
    e({ id: 'u-sb', symbol: '#scc-b', componentType: 'view', references: ['#scc-c'] }),
    e({ id: 'u-sc', symbol: '#scc-c', componentType: 'view', references: ['#scc-a', '#chain0'] }),
    e({ id: 'u-self', symbol: '#self', componentType: 'service', references: ['#self', '#chain0'] }),
    e({
      id: 'u-code',
      symbol: '#code:foo',
      componentType: 'code-unit',
      data: {
        essenceTag: 'v1:ts5.9.3',
        // The U+001F sentinel is what makes `f:N` a SLOT rather than literal
        // text (T-2026-06-24-003). Written as an escape on purpose: the raw
        // control character is invisible in an editor, and a fixture whose
        // meaning depends on a byte you cannot see is a fixture that silently
        // stops testing the substitution path. `free:log` carries no sentinel
        // and must survive untouched.
        codeEssence: 'fn(\u001Ff:0,\u001Ff:1,free:log)',
        codeLocalTargets: ['#chain0', '#scc-a'],
      },
      references: ['#chain0', '#scc-a'],
    }),
  ];
  for (let i = 0; i < 12; i++) {
    entries.push(
      e({
        id: `u-c${i}`,
        symbol: `#chain${i}`,
        componentType: 'service',
        data: { gates: ['^a'] },
        references: i + 1 < 12 ? [`#chain${i + 1}`] : ['#nowhere'],
      }),
    );
  }
  return entries;
}

/**
 * Captured from the RECURSIVE implementation, before the iterative rewrite.
 * These are not "whatever the code says" — they are the pre-change bytes.
 * A diff here means the fabric's recorded contentIds no longer match.
 */
const GOLDEN: Record<string, string> = {
  '#chain0': 'essence:v0:fbabc677f8dbf8f6a56bf06e3b5ccf30212c9cf5fa7994f7f40962eca905c0b5',
  '#chain1': 'essence:v0:4ebdc2146704f20343f93d355f80802b6268b2ef3ea5409239dbe4b821f9bd61',
  '#chain10': 'essence:v0:10941ec2d846ce4321e25a814d8cba9b8988215ed19ebf29b08130b4f8574dcc',
  '#chain11': 'essence:v0:b6b8ed6969ebbc676d30e8c6655882351a8cf500cdb46a3c212e1160fc0cbc7d',
  '#chain2': 'essence:v0:f1c7700db0577ca4d75c90eed902b3165418e184d2a1dc952709ca12c2d6e365',
  '#chain3': 'essence:v0:d5da1da120abeb9ea08dd0936ac344cb0c53c2860670f87ea3fce0059d857287',
  '#chain4': 'essence:v0:ff1d00aeeeccb42dfc98dbe136fd2b9b933ac13f88fad0339a7ae510bf077b04',
  '#chain5': 'essence:v0:819f3527c92e44d6883a96cd8b8b6f2059c611b49902e96830d0155af28ec2ae',
  '#chain6': 'essence:v0:8e9506017bfa6f798a7f6b0733fb5d4354d1629e71487301b7c4c1aa1a8a7a59',
  '#chain7': 'essence:v0:5ab96b24035c3d4d4c8256dfed9729202446edacb6e7db6c016e6b4d1d8edd75',
  '#chain8': 'essence:v0:5c07e9ad89833ae7b272d99785605c259d2a699fc019281b6f12a7b163d71d40',
  '#chain9': 'essence:v0:31b3a6b92f333598e1028edfa8c0ff4b24d258d8f33563e05d83dee298c8f113',
  '#code:foo': 'essence:v1:ts5.9.3:68978b10628dddf3c1832fe4dc805f694caeebee0c193e9f181d35695d5e8847',
  '#generic': 'essence:v0:17643cbca2f52f5d5f0c765a22f3b8b4acdd54ac3c8c2b3e7584de7cabc9ea03',
  '#rich': 'essence:v0:23dfda944c4dff9e213df30d4ebac367d0c663581b1a864f344de38daad87f89',
  '#scc-a': 'essence:v0:scc:f4765facc3ed44ed7d6ed244bfb8b473df233d1e13150361f7808a80add504a3:0',
  '#scc-b': 'essence:v0:scc:f4765facc3ed44ed7d6ed244bfb8b473df233d1e13150361f7808a80add504a3:2',
  '#scc-c': 'essence:v0:scc:f4765facc3ed44ed7d6ed244bfb8b473df233d1e13150361f7808a80add504a3:1',
  '#self': 'essence:v0:a9fcdc120f59701f4438393afed28487604a8c073f6ad571ad2e0b61463a7393',
  '$flow': 'essence:v0:3a735370ac56600677725aa3d53d9147dd4aaae98048a08734f28299ade5b447',
  '^a': 'essence:v0:651888655ab2da7a0c18f6da3c7fc1481acd9403c6bfa4ae3272fde0392b7989',
  '~m': 'essence:v0:7f6eb1689ffc7d9ba7eabdb41dae51590078d76400f84067fe4fbe1725bee6b3',
};

describe('essence — content addresses did not move', () => {
  it('every contentId is byte-identical to the pre-iterative recursive walk', () => {
    const got = Object.fromEntries([...essencesOf(goldenFixture())].sort());
    // Whole-map equality, not a spot check: a new or vanished symbol is a
    // divergence too, and `toEqual` on the object catches all three shapes.
    expect(got).toEqual(GOLDEN);
  });

  it('the SCC unit still hashes AS A UNIT — one shared hash, distinct ordinals', () => {
    const ids = essencesOf(goldenFixture());
    const members = ['#scc-a', '#scc-b', '#scc-c'].map((s) => ids.get(s)!);
    const hashes = new Set(members.map((v) => v.split(':').slice(0, 4).join(':')));
    expect(hashes.size).toBe(1); // one unit hash
    expect(new Set(members.map((v) => v.split(':').pop())).size).toBe(3); // distinct ordinals
  });
});

/* ─────────────────────── depth past the old ceiling ────────────────────── */

/** A pure DAG chain n0 -> n1 -> ... -> n(depth-1). Condensation depth = depth. */
function chain(depth: number): SymbolEntry[] {
  const entries: SymbolEntry[] = [];
  for (let i = 0; i < depth; i++) {
    entries.push(
      e({
        id: `u${i}`,
        symbol: `#n${i}`,
        componentType: 'service',
        references: i + 1 < depth ? [`#n${i + 1}`] : [],
      }),
    );
  }
  return entries;
}

describe('essence — the recursion ceiling is gone', () => {
  // DEPTH is a COST/MARGIN trade, so it is MEASURED rather than guessed.
  // Two different recursion shapes have to be caught, and they die at very
  // different depths because what matters is FRAMES, not levels:
  //   - the original walk (essenceOf -> localCNF -> arrow -> arrow, ~4 frames
  //     per level) was bracketed on this fixture at 1,000 resolves / 2,000
  //     throws; finer, in-process: 1,050 / 1,080.
  //   - a naive re-recursion inside `resolve` itself (ONE frame per level) does
  //     NOT overflow until ~8,000 — measured, by mutating this exact source.
  // A 4,000-deep guard therefore passes the second mutant, which is precisely
  // the regression most likely to be reintroduced by a future edit to
  // `resolve`. 12,000 reds both with margin and costs ~1.5s; a 25,000-deep
  // version cost ~73s under parallel suite load, buying margin nobody needs at
  // the price of a flaky suite. The unbounded claim belongs in the ceiling
  // measurement, not in CI.
  const DEPTH = 12_000;

  it(`resolves a ${DEPTH}-deep dependency chain, and the answer is order-independent`, () => {
    const entries = chain(DEPTH);

    // Natural order starts at the chain HEAD — the worst case, the one that
    // drove the old walk to full depth on its very first call.
    const natural = essencesOf(entries);
    expect(natural.size).toBe(DEPTH);

    // Reversed order resolves the TAIL first, so every dependency is already
    // memoized and the old walk stayed shallow. Identical output is the real
    // assertion: the deep walk computes the same thing the shallow one does,
    // not merely "it completed".
    const reversed = essencesOf(entries, (s) => [...s].reverse());
    expect(Object.fromEntries([...natural].sort())).toEqual(
      Object.fromEntries([...reversed].sort()),
    );

    // And the chain is genuinely deep: distinct meaning at every link, so no
    // memo shortcut could have collapsed it.
    expect(new Set(natural.values()).size).toBe(DEPTH);
  });

  it('folds a cycle sitting at the BOTTOM of a chain deeper than the old ceiling', () => {
    const DEEP = 3_000;
    // chain -> ... -> #n4999 -> #cyc-a -> #cyc-b -> #cyc-c -> #cyc-a
    const entries = chain(DEEP);
    entries[DEEP - 1] = e({
      id: `u${DEEP - 1}`,
      symbol: `#n${DEEP - 1}`,
      componentType: 'service',
      references: ['#cyc-a'],
    });
    const cycle: SymbolEntry[] = [
      e({ id: 'c-a', symbol: '#cyc-a', componentType: 'view', references: ['#cyc-b'] }),
      e({ id: 'c-b', symbol: '#cyc-b', componentType: 'view', references: ['#cyc-c'] }),
      e({ id: 'c-c', symbol: '#cyc-c', componentType: 'view', references: ['#cyc-a'] }),
    ];
    const ids = essencesOf([...entries, ...cycle]);

    for (const m of ['#cyc-a', '#cyc-b', '#cyc-c']) {
      expect(ids.get(m)).toMatch(/^essence:v0:scc:[0-9a-f]{64}:[012]$/);
    }

    // THE POINT: the unit hash the deep walk produced is the same one the SAME
    // cycle produces standing alone. The cycle has no out-of-unit edges, so its
    // hash cannot depend on the 5,000 links that lead to it — and if the deep
    // walk had degraded the fold (placeholders where real essences belong, or a
    // different member ordering) this is where it would show.
    const alone = essencesOf(cycle);
    for (const m of ['#cyc-a', '#cyc-b', '#cyc-c']) {
      expect(ids.get(m)).toBe(alone.get(m));
    }
  });
});
