/**
 * Hand-built OracleRecord fixtures for the Guard's pure core. The shapes match
 * the engine's exported types — the compiler enforces the contract.
 */

import type { OracleRecord } from '@a-company/warpline';

type Convergence = OracleRecord['convergence'];
type Knot = OracleRecord['prediction']['knots'][number];
type Dangle = OracleRecord['prediction']['dangling'][number];

export function knot(symbol: string, over: Partial<Knot> = {}): Knot {
  return {
    stableKey: `src/x.ts::fn#${symbol}`,
    symbol,
    essenceA: 'essA',
    essenceB: 'essB',
    conflictingSlots: ['body'],
    direct: true,
    ...over,
  };
}

export function dangle(fromSymbol: string, over: Partial<Dangle> = {}): Dangle {
  return {
    fromKey: `src/x.ts::fn#${fromSymbol}`,
    fromSymbol,
    edgeKind: 'calls',
    danglingTargetSymbol: '#code:src/gone.ts::removed',
    retiredBy: 'A',
    direct: true,
    ...over,
  };
}

export interface RecordOptions {
  knots?: Knot[];
  dangling?: Dangle[];
  directContested?: string[];
  rippleOnly?: string[];
  gitConflicted?: boolean;
  conflictPaths?: string[];
  touchedA?: string[];
  touchedB?: string[];
}

export function makeRecord(o: RecordOptions = {}): OracleRecord {
  const directContested = o.directContested ?? [];
  const rippleOnly = o.rippleOnly ?? [];
  const divergeMeaningOnly = [...directContested, ...rippleOnly].sort();
  const convergence: Convergence = {
    agreeClean: [],
    agreeConflict: [],
    divergeGitOnly: [],
    divergeMeaningOnly,
    gitConflictUnmapped: [],
    directContested,
    rippleOnly,
    knotSize: directContested.length,
    flagCount: divergeMeaningOnly.length,
    score: divergeMeaningOnly.length === 0 ? 1 : 0.5,
    verdict: divergeMeaningOnly.length === 0 ? 'CONVERGENT' : 'DIVERGENT',
  };
  const justification = (ref: string, intent: string, touched: string[]) => ({
    schemaVersion: 1 as const,
    actor: 'test',
    intent,
    base: { ref: 'base', stateId: 'state:v0:base' },
    branch: { ref, stateId: `state:v0:${ref}` },
    semanticDelta: [],
    computedRipple: { touchedSymbols: touched, blastRadius: [], danglingRefs: [] },
    signature: 'test',
  });
  return {
    schemaVersion: 1,
    ts: '2026-07-16T00:00:00.000Z',
    repo: '/tmp/repo',
    branchA: 'main',
    branchB: 'feature/x',
    mergeBase: 'aaaabbbbccccddddeeeeffff0000111122223333',
    stateIds: { base: 'state:v0:base', A: 'state:v0:a', B: 'state:v0:b' },
    prediction: {
      autoClean: [],
      knots: o.knots ?? [],
      dangling: o.dangling ?? [],
    },
    gitReality: {
      conflicted: o.gitConflicted ?? false,
      conflictSymbols: [],
      conflictPaths: o.conflictPaths ?? [],
    },
    mergeClean:
      !(o.gitConflicted ?? false) && (o.knots ?? []).length === 0 && (o.dangling ?? []).length === 0,
    convergence,
    justifications: {
      A: justification('main', 'base tip intent', o.touchedA ?? []),
      B: justification('feature/x', 'head tip intent', o.touchedB ?? []),
    },
  };
}
