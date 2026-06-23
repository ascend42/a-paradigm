/**
 * code-diff.test — STAGE 3b: `diff`/`predict` SEE code-body changes. This closes
 * the TD-806 "0 deltas on a .ts-only change" gap — a body-internal edit (a
 * literal/operator change with NO call-graph change) now differs in `codeEssence`
 * with no enumerated .purpose slot moving, so `sem-delta` surfaces a `'body'`
 * slot and `predict` treats divergent body edits to the SAME code-unit as a KNOT.
 *
 * The harness builds two real WarpStates from in-memory trees the SAME way
 * `absorb` does (lift → fresh index → injectCodeUnits → buildWarpState), so an
 * assertion here is a statement about what the oracle actually sees.
 */

import { describe, it, expect } from 'vitest';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  buildSymbolIndex,
  getAllSymbols,
  type AggregationResult,
} from '@a-company/premise-core';
import { TsLens } from '../src/lens/ts-lens.js';
import { injectCodeUnits } from '../src/lens/lift-code-units.js';
import { buildWarpState, type WarpState } from '../src/warp/warp-state.js';
import { diff } from '../src/sem-delta.js';
import { predict } from '../src/predict.js';

/** Write relPath → contents into a fresh temp dir; return its abs path. */
async function mkFixture(files: Record<string, string>): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'code-diff-'));
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(dir, rel);
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, content, 'utf8');
  }
  return dir;
}

/** An empty SymbolIndex (so we can inject code-units into a clean universe). */
function emptyIndex() {
  const result: AggregationResult = {
    symbols: [],
    purposeFiles: [],
    portalFiles: [],
    errors: [],
    timestamp: 0,
  };
  return buildSymbolIndex(result);
}

/**
 * Build a real WarpState from an in-memory tree — the SAME assembly `absorb`
 * uses (lift code-units → fresh index → injectCodeUnits → buildWarpState), with
 * `rootDir` set to the temp dir so filePaths are repo-relative (no false moves).
 * Cleans the temp dir on the way out.
 */
async function stateOfTree(ref: string, files: Record<string, string>): Promise<WarpState> {
  const dir = await mkFixture(files);
  try {
    const units = await new TsLens().lift(dir);
    const index = emptyIndex();
    injectCodeUnits(index, units);
    return buildWarpState(index, { ref, treeSha: null, rootDir: dir });
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

const sym = (file: string, qname: string) => `#code:${file}::${qname}`;

/** Find the contract-changed delta for a code symbol, by readable symbol name. */
function changedFor(state: ReturnType<typeof diff>, symbol: string) {
  for (const d of state.deltas.values()) {
    if (d.symbol === symbol && d.kind === 'contract-changed') return d;
  }
  return undefined;
}

/**
 * Resolve a readable code symbol to its `stableKey`. `predict.autoClean` is a
 * bare list of stableKeys (not symbol names) — knots/dangles carry the readable
 * name, autoClean does not — so commute assertions key on the stableKey.
 */
function keyOf(state: ReturnType<typeof diff>, symbol: string): string {
  for (const d of state.deltas.values()) {
    if (d.symbol === symbol) return d.stableKey;
  }
  throw new Error(`no delta for ${symbol}`);
}

// ===========================================================================
// 1. THE HEADLINE — code diff is non-zero on a .ts-only body change (TD-806).
// ===========================================================================
describe('code-diff — a .ts-only body change is a non-zero delta (closes TD-806)', () => {
  it('return 1 → return 2 surfaces a contract-changed delta on f with `body` slot', async () => {
    const base = await stateOfTree('base', {
      'src/a.ts': `function f(){ return 1; }`,
    });
    const branch = await stateOfTree('branch', {
      'src/a.ts': `function f(){ return 2; }`,
    });

    const delta = diff(base, branch);
    // The whole point: git shows a diff, Warpline now does too.
    expect(delta.deltas.size).toBeGreaterThan(0);

    const fDelta = changedFor(delta, sym('src/a.ts', 'f'));
    expect(fDelta).toBeDefined();
    expect(fDelta!.kind).toBe('contract-changed');
    expect(fDelta!.changedSlots).toContain('body');
    // The essence genuinely moved (not a rename / empty delta).
    expect(fDelta!.essenceBefore).not.toBe(fDelta!.essenceAfter);
  });

  it('CONTRAST — renaming a LOCAL var (no meaning change) stays a zero-delta', async () => {
    const base = await stateOfTree('base', {
      'src/r.ts': `function f(){ const x = 1; return x; }`,
    });
    const branch = await stateOfTree('branch', {
      // Local binding renamed x → y; alpha-normalization makes this the empty delta.
      'src/r.ts': `function f(){ const y = 1; return y; }`,
    });

    const delta = diff(base, branch);
    // No semantic delta for f — its body essence is unchanged under binding-index
    // alpha-normalization. (A rename, if any, is surfaced separately, not as a delta.)
    expect(changedFor(delta, sym('src/r.ts', 'f'))).toBeUndefined();
    expect(delta.deltas.has(sym('src/r.ts', 'f'))).toBe(false);
  });
});

// ===========================================================================
// 2. Code-level KNOT — two branches edit the SAME function's body divergently.
// ===========================================================================
describe('code-diff — divergent body edits to the same code-unit = KNOT', () => {
  it('base return 1; A→return 2; B→return 3 → predict knots f with conflictingSlots ⊇ [body]', async () => {
    const base = await stateOfTree('base', {
      'src/k.ts': `function f(){ return 1; }`,
    });
    const branchA = await stateOfTree('A', {
      'src/k.ts': `function f(){ return 2; }`,
    });
    const branchB = await stateOfTree('B', {
      'src/k.ts': `function f(){ return 3; }`,
    });

    const dA = diff(base, branchA);
    const dB = diff(base, branchB);
    const p = predict(dA, dB);

    const knot = p.knots.find((k) => k.symbol === sym('src/k.ts', 'f'));
    expect(knot).toBeDefined();
    expect(knot!.conflictingSlots).toContain('body');
    // Divergent essences (2 ≠ 3) is what makes it a knot, not a convergent merge.
    expect(knot!.essenceA).not.toBe(knot!.essenceB);
  });
});

// ===========================================================================
// 3. autoClean (commute) — disjoint code-units edited on each side.
// ===========================================================================
describe('code-diff — disjoint code-unit body edits COMMUTE → autoClean', () => {
  it('A edits f, B edits g (disjoint keys) → no knots; both keys autoClean', async () => {
    const base = await stateOfTree('base', {
      'src/c.ts': `function f(){ return 1; }
function g(){ return 10; }`,
    });
    const branchA = await stateOfTree('A', {
      // only f changes
      'src/c.ts': `function f(){ return 2; }
function g(){ return 10; }`,
    });
    const branchB = await stateOfTree('B', {
      // only g changes
      'src/c.ts': `function f(){ return 1; }
function g(){ return 20; }`,
    });

    const dA = diff(base, branchA);
    const dB = diff(base, branchB);
    const p = predict(dA, dB);

    expect(p.knots.length).toBe(0);
    expect(p.dangling.length).toBe(0);
    // f changed only on A, g only on B → disjoint touch sets → both commute.
    // autoClean is keyed by stableKey (not the readable symbol name).
    expect(p.autoClean).toContain(keyOf(dA, sym('src/c.ts', 'f')));
    expect(p.autoClean).toContain(keyOf(dB, sym('src/c.ts', 'g')));
  });
});

// ===========================================================================
// 4. Code-level DANGLE — B references a target A retired (a deleted function).
// ===========================================================================
describe('code-diff — call to a function the other branch deleted = DANGLE', () => {
  it('base f→helper + helper; A retires helper; B adds a new caller of helper → dangling', async () => {
    const base = await stateOfTree('base', {
      'src/d.ts': `function f(){ return helper(); }
function helper(){ return 1; }`,
    });
    // Branch A deletes `helper` entirely (and f no longer calls it — it stands alone).
    const branchA = await stateOfTree('A', {
      'src/d.ts': `function f(){ return 0; }`,
    });
    // Branch B keeps helper and ADDS a new function g that also calls helper —
    // a new edge to the target A retired.
    const branchB = await stateOfTree('B', {
      'src/d.ts': `function f(){ return helper(); }
function helper(){ return 1; }
function g(){ return helper(); }`,
    });

    const dA = diff(base, branchA);
    const dB = diff(base, branchB);
    const p = predict(dA, dB);

    // A retired #code:src/d.ts::helper; B added an edge (from g, born) to it.
    const dangle = p.dangling.find(
      (d) => d.danglingTargetSymbol === sym('src/d.ts', 'helper') && d.retiredBy === 'A',
    );
    expect(dangle).toBeDefined();
  });
});
