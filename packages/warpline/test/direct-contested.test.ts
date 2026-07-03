/**
 * direct-contested.test — DIRECT-CONTESTED / KNOT-SIZE RANKING (T-2026-07-03-002).
 *
 * Ground truth (275 real merges, 18 divergeMeaningOnly hits) proved flag VOLUME
 * inversely predicts payoff: ≤6-symbol flag sets were 50% churn-validated while
 * every ≥10-symbol set — incl. seven 48-176-symbol avalanches rippling out of ~2
 * genuinely contested units via essence transitivity (Merkle-by-target) — was 0%.
 * These tests pin the additive ranking layer that partitions each flag set:
 *
 *   directContested — the unit's OWN content changed on ≥1 side
 *   rippleOnly      — flagged only because edge-target essences shifted
 *
 * The ranking is PRESENTATION+DATA ONLY: knot/dangle/autoClean/verdict semantics
 * must not move (a policy change would invalidate the committed base-rate
 * evidence), so every test also re-asserts the unchanged flag set.
 *
 * The harness builds real WarpStates from in-memory trees the SAME way `absorb`
 * does (lift → fresh index → injectCodeUnits → buildWarpState) — an assertion
 * here is a statement about what the oracle actually sees.
 */

import { describe, it, expect } from 'vitest';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  buildSymbolIndex,
  type AggregationResult,
} from '@a-company/premise-core';
import { TsLens } from '../src/lens/ts-lens.js';
import { injectCodeUnits } from '../src/lens/lift-code-units.js';
import { buildWarpState, type WarpState } from '../src/warp/warp-state.js';
import { diff } from '../src/sem-delta.js';
import { predict } from '../src/predict.js';
import { score } from '../src/oracle.js';

/** Write relPath → contents into a fresh temp dir; return its abs path. */
async function mkFixture(files: Record<string, string>): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'direct-contested-'));
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

/** Build a real WarpState from an in-memory tree (the absorb assembly). */
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

/** The contract-changed delta for a code symbol, by readable symbol name. */
function changedFor(set: ReturnType<typeof diff>, symbol: string) {
  for (const d of set.deltas.values()) {
    if (d.symbol === symbol && d.kind === 'contract-changed') return d;
  }
  return undefined;
}

// ===========================================================================
// 1. diff() — localChanged separates an OWN edit from a ripple re-address.
// ===========================================================================
describe('sem-delta — localChanged: own edit vs Merkle-by-target ripple', () => {
  it('editing t flags t localChanged=true and its untouched caller r localChanged=false', async () => {
    const base = await stateOfTree('base', {
      'src/l.ts': `function t(){ return 1; }
function r(){ return t(); }`,
    });
    const branch = await stateOfTree('branch', {
      'src/l.ts': `function t(){ return 99; }
function r(){ return t(); }`,
    });

    const delta = diff(base, branch);
    const tDelta = changedFor(delta, sym('src/l.ts', 't'));
    const rDelta = changedFor(delta, sym('src/l.ts', 'r'));

    // t's own body moved.
    expect(tDelta).toBeDefined();
    expect(tDelta!.localChanged).toBe(true);
    // r's contentId re-addressed (Merkle-by-target) with ZERO local edit.
    expect(rDelta).toBeDefined();
    expect(rDelta!.essenceBefore).not.toBe(rDelta!.essenceAfter);
    expect(rDelta!.localChanged).toBe(false);
    // The ranking layer is additive: the ripple delta still carries the 'body'
    // slot exactly as before (knot semantics unchanged).
    expect(rDelta!.changedSlots).toContain('body');
  });
});

// ===========================================================================
// 2. THE AVALANCHE — 2 contested units, many transitive referrers. The output
//    must rank 2 direct + collapse the rest to a ripple count.
// ===========================================================================
describe('ranking — avalanche: 2 contested units → many ripple referrers', () => {
  // u1⇄u2 form an SCC (the types.ts shape from the zod avalanches): ANY member
  // edit moves the whole unit hash, so every member AND every referrer
  // re-addresses on BOTH sides — the 48-176-symbol flag sets of ground truth.
  const referrers = Array.from({ length: 10 }, (_, i) => `function r${i}(){ return u1(${i}); }`).join('\n');
  const tree = (u1Body: string, u2Body: string) => ({
    'src/knot.ts': `function u1(n: number): number { return n <= 0 ? ${u1Body} : u2(n - 1); }
function u2(n: number): number { return n <= 0 ? ${u2Body} : u1(n - 1); }
${referrers}`,
  });

  it('knots carry direct flags; score partitions the flag set 2 direct / 10 ripple', async () => {
    const base = await stateOfTree('base', tree('1', '2'));
    const branchA = await stateOfTree('A', tree('111', '2')); // A edits u1 only
    const branchB = await stateOfTree('B', tree('1', '222')); // B edits u2 only

    const dA = diff(base, branchA);
    const dB = diff(base, branchB);
    const p = predict(dA, dB);

    const u1 = sym('src/knot.ts', 'u1');
    const u2 = sym('src/knot.ts', 'u2');
    const rSyms = Array.from({ length: 10 }, (_, i) => sym('src/knot.ts', `r${i}`));

    // The avalanche is real: all 12 knot (SCC members + every referrer).
    const knotSyms = p.knots.map((k) => k.symbol);
    expect(knotSyms).toContain(u1);
    expect(knotSyms).toContain(u2);
    for (const r of rSyms) expect(knotSyms).toContain(r);

    // The ranking signal: exactly the two own-edited units are direct.
    const directSyms = p.knots.filter((k) => k.direct).map((k) => k.symbol).sort();
    expect(directSyms).toEqual([u1, u2]);
    for (const k of p.knots) {
      if (k.symbol !== u1 && k.symbol !== u2) expect(k.direct).toBe(false);
    }

    // Oracle scoring with git CLEAN (the divergeMeaningOnly cell) — the record
    // partitions the flags and knotSize is the ranking key.
    const c = score(p, [], [branchA, branchB]);
    expect(c.flagCount).toBe(p.knots.length);
    expect(c.knotSize).toBe(2);
    expect(c.directContested).toEqual([u1, u2]);
    expect(c.rippleOnly.length).toBe(10);
    expect(c.rippleOnly).toEqual(rSyms.slice().sort());
    // Partition invariant: direct ∪ ripple == divergeMeaningOnly, no overlap.
    expect([...c.directContested, ...c.rippleOnly].sort()).toEqual(
      c.divergeMeaningOnly.slice().sort(),
    );

    // ADDITIVE-ONLY guard: verdict/score semantics unchanged by ranking.
    expect(c.verdict).toBe('DIVERGENT');
    expect(c.divergeMeaningOnly.length).toBe(12);
  });
});

// ===========================================================================
// 3. PURE DANGLE — a retired target: the dangling REFERENCE is direct-contested
//    on the referencing side (it authored the edge).
// ===========================================================================
describe('ranking — pure dangle: the dangling reference is direct-contested', () => {
  it('A retires helper; B births g calling helper → g is direct, zero ripple', async () => {
    const base = await stateOfTree('base', {
      'src/d.ts': `function f(){ return helper(); }
function helper(){ return 1; }`,
    });
    const branchA = await stateOfTree('A', {
      'src/d.ts': `function f(){ return 0; }`,
    });
    const branchB = await stateOfTree('B', {
      'src/d.ts': `function f(){ return helper(); }
function helper(){ return 1; }
function g(){ return helper(); }`,
    });

    const dA = diff(base, branchA);
    const dB = diff(base, branchB);
    const p = predict(dA, dB);

    const g = sym('src/d.ts', 'g');
    const dangle = p.dangling.find(
      (d) => d.danglingTargetSymbol === sym('src/d.ts', 'helper') && d.retiredBy === 'A',
    );
    expect(dangle).toBeDefined();
    expect(dangle!.fromSymbol).toBe(g);
    // The edge-add IS the referencing side's own content — direct by construction.
    expect(dangle!.direct).toBe(true);

    const c = score(p, [], [branchA, branchB]);
    expect(c.directContested).toContain(g);
    expect(c.rippleOnly).toEqual([]);
    expect(c.knotSize).toBe(c.flagCount);
  });
});

// ===========================================================================
// 4. score() back-compat — absent direct flags default to DIRECT (surfaced,
//    never silently collapsed), and old-shape predictions still partition.
// ===========================================================================
describe('ranking — score() defaults and additive shape', () => {
  it('a prediction without direct flags ranks every flag direct (conservative)', () => {
    const prediction = {
      autoClean: [],
      knots: [
        { stableKey: 'k1', symbol: '#a', conflictingSlots: ['body'] },
        { stableKey: 'k2', symbol: '#b', conflictingSlots: ['body'] },
      ],
      dangling: [],
    };
    const c = score(prediction, [], [] as never[]);
    expect(c.directContested).toEqual(['#a', '#b']);
    expect(c.rippleOnly).toEqual([]);
    expect(c.knotSize).toBe(2);
    expect(c.flagCount).toBe(2);
  });

  it('explicit direct:false knots collapse to rippleOnly; git-conflicted flags are excluded (partition is over divergeMeaningOnly)', () => {
    const prediction = {
      autoClean: [],
      knots: [
        { stableKey: 'k1', symbol: '#direct', conflictingSlots: ['body'], direct: true },
        { stableKey: 'k2', symbol: '#ripple', conflictingSlots: ['body'], direct: false },
        { stableKey: 'k3', symbol: '#gitToo', conflictingSlots: ['body'], direct: true },
      ],
      dangling: [],
    };
    // #gitToo also conflicts in git → agreeConflict, NOT part of the meaning-only flag set.
    const c = score(prediction, ['#gitToo'], [] as never[]);
    expect(c.divergeMeaningOnly).toEqual(['#direct', '#ripple']);
    expect(c.directContested).toEqual(['#direct']);
    expect(c.rippleOnly).toEqual(['#ripple']);
    expect(c.knotSize).toBe(1);
    expect(c.flagCount).toBe(2);
    expect(c.agreeConflict).toEqual(['#gitToo']);
  });
});
