/**
 * signature-projection.test — THE SIGNATURE PROJECTION + `rippleFromContract`
 * (T-2026-07-15-008, STAGE 1: emit the signal, change NO verdict).
 *
 * The defect: the essence inlines a callee's whole essence into its caller, and
 * `codeEssence` is ONE monolithic `(fn:kind @[decs] mods:[..] * <tp> [params]
 * ret body)` string — signature and body are not separable slots. So a callee
 * BODY byte re-addresses every caller, and the caller's delta carries
 * `changedSlots: ['body']` identically whether the ripple was contract-bearing
 * (a genuine silent-mismerge catch) or body-internal (semantically COMMUTING).
 * Two commuting edits therefore contend the same caller essence → false KNOT,
 * measured 3/3 in the NEGCTRL-RIPPLE stratum of the Move-3 full run.
 *
 * The missing datum is "did the callee's SIGNATURE move, or only its body?".
 * Stage 1 computes it — `data.codeSignature` from the lens, `rippleFromContract`
 * on the delta — and NOTHING ELSE. `predict.ts` is untouched; every KNOT / CLEAN
 * / DANGLE verdict is byte-for-byte what it was. Stage 2 (flipping the `body`
 * scalar-conflict rule) is gated on re-scoring the evidence corpora for new
 * false-CLEANs first; §4 below pins the CURRENT (unflipped) behavior so that
 * flip is visible when it happens.
 *
 * §1 is the LOAD-BEARING test: the whole approach rests on `codeSignature` being
 * essence-NEUTRAL (`normalizedContract` in essence-hash.ts enumerates the hashed
 * slots and this is not one of them → no contentId moves, no stateId moves, no
 * `essenceTag`/`CCNF_ALGO_VERSION` bump, no fabric migration). The goldens below
 * were captured by RUNNING the pre-change (HEAD) lens over these exact fixtures
 * in a side-by-side harness; if any of them moves, the approach is invalid.
 */

import { describe, it, expect } from 'vitest';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as ts from 'typescript';
import { buildSymbolIndex, type AggregationResult } from '@a-company/premise-core';
import { codeCNFDetailed } from '../src/lens/ts-essence.js';
import { TsLens } from '../src/lens/ts-lens.js';
import { injectCodeUnits } from '../src/lens/lift-code-units.js';
import { buildWarpState, type WarpState } from '../src/warp/warp-state.js';
import { diff } from '../src/sem-delta.js';
import { predict } from '../src/predict.js';

// ---------------------------------------------------------------------------
// Harness — the SAME lift → fresh index → injectCodeUnits → buildWarpState
// assembly `absorb` runs, so an assertion here is a statement about what the
// oracle actually sees.
// ---------------------------------------------------------------------------

async function mkFixture(files: Record<string, string>): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'sig-proj-'));
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(dir, rel);
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, content, 'utf8');
  }
  return dir;
}

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

function changedFor(set: ReturnType<typeof diff>, symbol: string) {
  for (const d of set.deltas.values()) {
    if (d.symbol === symbol && d.kind === 'contract-changed') return d;
  }
  return undefined;
}

function cnfOf(source: string, stmt = 0): ReturnType<typeof codeCNFDetailed> {
  const sf = ts.createSourceFile('x.ts', source, ts.ScriptTarget.ES2022, true);
  return codeCNFDetailed(sf.statements[stmt]);
}

// ===========================================================================
// 1. THE LOAD-BEARING GUARD — no essence, contentId or stateId moves.
// ===========================================================================

/**
 * Captured by running the PRE-CHANGE (HEAD) lens over `GOLDEN_TREE` in a
 * side-by-side harness (both lenses, one process, same fixture dir). Every
 * value below is HEAD's output, not the current code's. The `essence:` prefix
 * pins `CCNF_ALGO_VERSION` + the exact compiler, so an unintended algorithm or
 * compiler bump also trips this test.
 */
const GOLDEN_STATE_ID =
  'state:v0:3b23ccfc0d0145d611549d0e02956b63a152318b5cec61126d511081839b4d3e';

const GOLDEN_CONTENT_IDS: Record<string, string> = {
  '#code:src/a.ts::Widget':
    'essence:v1.1:ts5.9.3:1ea3ac5a20b2efd9a44344f48445e1b88bb87e623a723d30888dcf9552210ff3',
  '#code:src/a.ts::Widget.constructor':
    'essence:v1.1:ts5.9.3:d2b029454bee960e80750f3c58b95163cab0a18f435a9709413153dfd235fc51',
  '#code:src/a.ts::Widget.gen':
    'essence:v1.1:ts5.9.3:1d98d4923ea34191fcabdd8c2cfd7d31e36984c55075837bb043e5334ac2d308',
  '#code:src/a.ts::Widget.m':
    'essence:v1.1:ts5.9.3:4d7439935b55ebcb972a88cdf9c32b8024b54ce9bb8acd434bd5ea5dc1712d65',
  '#code:src/a.ts::Widget.value':
    'essence:v1.1:ts5.9.3:fc147171808d88fad8480d1d189a9a370ae231fe73116a4f5fc3b76f4260d01b',
  '#code:src/a.ts::arrow':
    'essence:v1.1:ts5.9.3:df11aef60a72509a55d13612557dceedd3a72726e93284bbd8e68e4f4dd73b88',
  '#code:src/a.ts::caller':
    'essence:v1.1:ts5.9.3:0d350ce1e79f39675398234cee6d62db3ba0f2019c4803274ccc5276b6fd9ac1',
  '#code:src/a.ts::helper':
    'essence:v1.1:ts5.9.3:6473397752e06b0e1830e993162ecbc37628fa1335c66c8c73dbf489d6b60177',
  '#code:src/c.ts::cyc1':
    'essence:v1.1:ts5.9.3:scc:0cbf43d1bc464b3e630741ef5fd548e875fc35af2fb21b8f57a155c9619ad647:0',
  '#code:src/c.ts::cyc2':
    'essence:v1.1:ts5.9.3:scc:0cbf43d1bc464b3e630741ef5fd548e875fc35af2fb21b8f57a155c9619ad647:1',
  '#code:src/l.ts::r':
    'essence:v1.1:ts5.9.3:f443f7e4efc03c63498ea40f967c15334d32356e41140d991e498b73c68e5754',
  '#code:src/l.ts::t':
    'essence:v1.1:ts5.9.3:d6664494b4471311fe6b2c858e3e97e9070a353286eca8510709189eb3f87123',
};

/**
 * Deliberately exercises every slot the split touches: decorators, the full
 * fail-closed modifier set, accessors, a constructor, a generator, generics +
 * defaults, rest params, an arrow, an extern import, a self-referential SCC,
 * and a plain caller/callee pair.
 */
const GOLDEN_TREE: Record<string, string> = {
  'src/l.ts': `function t(){ return 1; }\nfunction r(){ return t() + 1; }`,
  'src/a.ts': `import { z } from 'zod';
export function helper(x: number = 2): number { return x * 2; }
export const arrow = async <T,>(a: T, ...rest: string[]): Promise<T> => { return a; };
@Dec({ k: 1 })
export abstract class Widget<T extends object = {}> {
  private readonly v: T;
  constructor(v: T) { this.v = v; }
  get value(): T { return this.v; }
  set value(next: T) { (this as any).v = next; }
  protected override async *gen(y = helper(3)): AsyncGenerator<number> { yield y; }
  public m(cb: (n: number) => void = () => {}): void { cb(z.number() as any); }
}
export function caller() { return helper() + arrow.length; }
`,
  'src/c.ts': `export function cyc1(): number { return cyc2() + 1; }
export function cyc2(): number { return cyc1() - 1; }
`,
};

describe('signature projection — ESSENCE-NEUTRAL (the load-bearing guard)', () => {
  it('every contentId and the stateId are byte-identical to the pre-change lens', async () => {
    const state = await stateOfTree('golden', GOLDEN_TREE);

    const actual: Record<string, string> = {};
    for (const [s, obj] of state.objects) actual[s] = obj.contentId;

    // Exact set equality: a MISSING or EXTRA unit is as much a regression as a
    // moved hash.
    expect(Object.keys(actual).sort()).toEqual(Object.keys(GOLDEN_CONTENT_IDS).sort());
    expect(actual).toEqual(GOLDEN_CONTENT_IDS);
    expect(state.stateId).toBe(GOLDEN_STATE_ID);
  });

  it('carries codeSignature on every unit WITHOUT it entering the hash', async () => {
    const state = await stateOfTree('golden', GOLDEN_TREE);
    for (const [s, obj] of state.objects) {
      const contract = obj.contract as Record<string, unknown>;
      expect(typeof contract.codeSignature, s).toBe('string');
      expect((contract.codeSignature as string).length, s).toBeGreaterThan(0);
      // Same universe, unchanged address — restated per-unit so a failure names
      // the offending symbol.
      expect(obj.contentId, s).toBe(GOLDEN_CONTENT_IDS[s]);
    }
  });

  it('the CNF is exactly signature + body — the split reconstructs it', () => {
    const d = cnfOf('function t(a: number = 1): number { return a + 1; }');
    expect(d.signature).toBe(
      '(fn:fndecl @[] mods:[] - <> [(param @[] mods:[] b:0:0 τ:number=num:1)] τ:number)',
    );
    // signature ends `ret)`; the CNF is `${sig-without-close} ${body})`.
    const stem = d.signature.slice(0, -1);
    expect(d.cnf.startsWith(stem + ' ')).toBe(true);
    expect(d.cnf.endsWith(')')).toBe(true);
    expect(d.signature.length).toBeLessThan(d.cnf.length);
  });

  it('a non-function-like unit FAILS CLOSED: signature === the whole CNF', () => {
    const d = cnfOf('class C { x = 1; }');
    expect(d.signature).toBe(d.cnf);
  });
});

// ===========================================================================
// 2. The projection's own behavior: stable under body edits, moves on contract.
// ===========================================================================
describe('signature projection — what moves it and what does not', () => {
  it('a body-only edit does NOT move the signature (but does move the CNF)', () => {
    const a = cnfOf('function t(){ return 1; }');
    const b = cnfOf('function t(){ return 99; }');
    expect(a.cnf).not.toBe(b.cnf);
    expect(a.signature).toBe(b.signature);
  });

  it('a required parameter, a return type, a modifier and a decorator all move it', () => {
    const base = cnfOf('function t(){ return 1; }').signature;
    expect(cnfOf('function t(a: number){ return 1; }').signature).not.toBe(base);
    expect(cnfOf('function t(): number { return 1; }').signature).not.toBe(base);
    expect(cnfOf('async function t(){ return 1; }').signature).not.toBe(base);
    expect(cnfOf('function t<T>(){ return 1; }').signature).not.toBe(base);
    const dec = cnfOf('class C { @Log m(){ return 1; } }');
    const plain = cnfOf('class C { m(){ return 1; } }');
    expect(dec.signature).not.toBe(plain.signature);
  });

  it('body edits cannot RENUMBER a signature free-ref slot', () => {
    // Signature slots (decorators/params/ret) serialize BEFORE the body, so they
    // hold the lowest first-appearance indices by construction — a body edit
    // that introduces a NEW free name can only append. This is the determinism
    // property that lets us compare raw (unsubstituted) signature strings.
    const one = cnfOf('function t(x = helper()) { other(); }');
    const two = cnfOf('function t(x = helper()) { brandNew(); other(); }');
    expect(one.cnf).not.toBe(two.cnf);
    expect(one.signature).toBe(two.signature);
    expect(one.signature).toContain('helper');
  });
});

// ===========================================================================
// 3. rippleFromContract — Trace's fixtures. The bit the engine never had.
// ===========================================================================
const RIPPLE_BASE = {
  'src/l.ts': `function t(){ return 1; }
function r(){ return t() + 1; }`,
};

describe('sem-delta — rippleFromContract: contract-bearing vs body-internal ripple', () => {
  it('callee const edit → caller ripples, signature HELD → rippleFromContract=false', async () => {
    const base = await stateOfTree('base', RIPPLE_BASE);
    const branch = await stateOfTree('A', {
      'src/l.ts': `function t(){ return 42; }
function r(){ return t() + 1; }`,
    });

    const d = diff(base, branch);
    const rDelta = changedFor(d, sym('src/l.ts', 'r'));
    const tDelta = changedFor(d, sym('src/l.ts', 't'));

    // r re-addressed with ZERO local edit (the existing ranking bit, unchanged).
    expect(rDelta).toBeDefined();
    expect(rDelta!.localChanged).toBe(false);
    expect(rDelta!.changedSlots).toContain('body');
    // THE NEW BIT: the ripple came from t's BODY, not its contract.
    expect(rDelta!.rippleFromContract).toBe(false);

    // t itself changed locally and has no moved targets → the empty OR is false.
    expect(tDelta!.localChanged).toBe(true);
    expect(tDelta!.rippleFromContract).toBe(false);
  });

  it('callee gains a required parameter → rippleFromContract=true', async () => {
    const base = await stateOfTree('base', RIPPLE_BASE);
    const branch = await stateOfTree('A', {
      'src/l.ts': `function t(n: number){ return 1; }
function r(){ return t() + 1; }`,
    });

    const d = diff(base, branch);
    const rDelta = changedFor(d, sym('src/l.ts', 'r'));

    expect(rDelta).toBeDefined();
    // Still a pure ripple by the OLD signal — indistinguishable before stage 1.
    expect(rDelta!.localChanged).toBe(false);
    expect(rDelta!.changedSlots).toContain('body');
    // THE NEW BIT: t's CONTRACT moved. This is the shape that must keep blocking.
    expect(rDelta!.rippleFromContract).toBe(true);
  });

  it('a callee return-type change is contract-bearing too', async () => {
    const base = await stateOfTree('base', RIPPLE_BASE);
    const branch = await stateOfTree('A', {
      'src/l.ts': `function t(): string { return '1'; }
function r(){ return t() + 1; }`,
    });
    const rDelta = changedFor(diff(base, branch), sym('src/l.ts', 'r'));
    expect(rDelta!.rippleFromContract).toBe(true);
  });

  it("a retirement INSIDE the callee is still body-internal to the caller", async () => {
    const base = await stateOfTree('base', {
      'src/d.ts': `function helper(){ return 1; }
function f(){ return helper(); }
function g(){ return f(); }`,
    });
    const branch = await stateOfTree('A', {
      'src/d.ts': `function f(){ return 0; }
function g(){ return f(); }`,
    });
    // f dropped a whole call — but f's own SIGNATURE held, so from g's seat this
    // still commutes. The retirement is f's local change and surfaces on f's
    // delta, not g's. Recording it explicitly: the bit is about the TARGET'S
    // CONTRACT, not about how large the target's body edit was.
    const gDelta = changedFor(diff(base, branch), sym('src/d.ts', 'g'));
    expect(gDelta).toBeDefined();
    expect(gDelta!.localChanged).toBe(false);
    expect(gDelta!.rippleFromContract).toBe(false);
  });

  it('FAILS CLOSED when a target is renamed away (cannot prove the contract held)', async () => {
    // A pure rename produces no delta at all (the essence is name-blind), so the
    // fixture renames AND edits: g's base target `f` has no counterpart in the
    // branch universe, and we refuse to guess.
    const base = await stateOfTree('base', {
      'src/d.ts': `function f(){ return 1; }
function g(){ return f(); }`,
    });
    const branch = await stateOfTree('A', {
      'src/d.ts': `function f2(n: number){ return 1; }
function g(){ return f2(0); }`,
    });
    const gDelta = changedFor(diff(base, branch), sym('src/d.ts', 'g'));
    expect(gDelta).toBeDefined();
    expect(gDelta!.rippleFromContract).toBe(true);
  });

  it('FAILS CLOSED on a BORN target (no base to compare a signature against)', async () => {
    const base = await stateOfTree('base', {
      'src/d.ts': `function g(){ return 1; }`,
    });
    const branch = await stateOfTree('A', {
      'src/d.ts': `function h(){ return 2; }
function g(){ return h(); }`,
    });
    const gDelta = changedFor(diff(base, branch), sym('src/d.ts', 'g'));
    expect(gDelta).toBeDefined();
    expect(gDelta!.rippleFromContract).toBe(true);
  });

  it('transitive body-only ripple stays false through two hops', async () => {
    const tree = (leaf: string) => ({
      'src/t.ts': `function leaf(){ return ${leaf}; }
function mid(){ return leaf(); }
function top(){ return mid(); }`,
    });
    const d = diff(await stateOfTree('base', tree('1')), await stateOfTree('A', tree('2')));
    const midDelta = changedFor(d, sym('src/t.ts', 'mid'));
    const topDelta = changedFor(d, sym('src/t.ts', 'top'));
    // mid's signature is unchanged even though its essence moved, so top reads
    // the ripple as body-internal — correctly: it still commutes.
    expect(midDelta!.rippleFromContract).toBe(false);
    expect(topDelta!.rippleFromContract).toBe(false);
  });

  it('a symbol with no moved targets reads false (the empty OR)', async () => {
    const base = await stateOfTree('base', RIPPLE_BASE);
    const branch = await stateOfTree('A', {
      'src/l.ts': `function t(){ return 1; }
function r(){ return t() + 7; }`,
    });
    const rDelta = changedFor(diff(base, branch), sym('src/l.ts', 'r'));
    expect(rDelta!.localChanged).toBe(true);
    expect(rDelta!.rippleFromContract).toBe(false);
  });
});

// ===========================================================================
// 4. STAGE-2 PENDING — the over-block, recorded as it stands TODAY.
// ===========================================================================
describe('STAGE-2 PENDING — the commuting pair still KNOTs (current behavior)', () => {
  /**
   * A edits callee `t`'s constant; B edits caller `r`'s constant. The two edits
   * are semantically INDEPENDENT and commute. Today both sides move `r`'s
   * essence — A by Merkle ripple, B by its own body — and predict's `body`
   * scalar-conflict rule contends them → KNOT on `r`. This is the false KNOT
   * measured 3/3 in the NEGCTRL-RIPPLE stratum.
   *
   * STAGE 1 CHANGES NO VERDICT. This test asserts the CURRENT (blocking)
   * behavior deliberately, and pins the new bit that would license the flip:
   * A's ripple on `r` carries `rippleFromContract === false`.
   *
   * STAGE 2 flips this — gated on re-scoring the two evidence corpora for new
   * false-CLEANs first, because the same predicate is shared verbatim with the
   * 12 real TRUE-INTERFERENCE ripple catches. When the flip lands, `r` leaves
   * `p.knots` and THIS TEST MUST BE UPDATED, not deleted: it is the record of
   * what the flip actually changed.
   */
  it('r knots today; the bit that would clear it is already present', async () => {
    const tree = (tBody: string, rBody: string) => ({
      'src/l.ts': `function t(){ return ${tBody}; }
function r(){ return t() + ${rBody}; }`,
    });
    const base = await stateOfTree('base', tree('1', '1'));
    const branchA = await stateOfTree('A', tree('42', '1')); // A edits the callee
    const branchB = await stateOfTree('B', tree('1', '99')); // B edits the caller

    const dA = diff(base, branchA);
    const dB = diff(base, branchB);
    const p = predict(dA, dB);

    const r = sym('src/l.ts', 'r');
    const rKnot = p.knots.find((k) => k.symbol === r);

    // CURRENT BEHAVIOR — the false KNOT. Do not "fix" this here.
    expect(rKnot).toBeDefined();
    expect(rKnot!.conflictingSlots).toContain('body');

    // The stage-2 predicate, already computed and already correct: A's side of
    // `r` is a body-internal ripple; B's side is a genuine local edit.
    expect(changedFor(dA, r)!.localChanged).toBe(false);
    expect(changedFor(dA, r)!.rippleFromContract).toBe(false);
    expect(changedFor(dB, r)!.localChanged).toBe(true);
  });

  it('the contract-bearing pair must KEEP knotting after the stage-2 flip', async () => {
    // Same shape, except A moves t's SIGNATURE. `rippleFromContract === true`
    // here, so the stage-2 predicate leaves this KNOT intact — the property
    // that stops the flip from converting real catches into false CLEANs.
    const base = await stateOfTree('base', {
      'src/l.ts': `function t(){ return 1; }
function r(){ return t() + 1; }`,
    });
    const branchA = await stateOfTree('A', {
      'src/l.ts': `function t(n: number){ return 1; }
function r(){ return t() + 1; }`,
    });
    const branchB = await stateOfTree('B', {
      'src/l.ts': `function t(){ return 1; }
function r(){ return t() + 99; }`,
    });

    const dA = diff(base, branchA);
    const dB = diff(base, branchB);
    const p = predict(dA, dB);

    const r = sym('src/l.ts', 'r');
    expect(p.knots.some((k) => k.symbol === r)).toBe(true);
    expect(changedFor(dA, r)!.rippleFromContract).toBe(true);
  });
});
