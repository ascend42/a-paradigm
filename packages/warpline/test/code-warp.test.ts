/**
 * code-warp.test — STAGE 3a: code-unit essences SOUND + DETERMINISTIC inside the
 * WARP. These are the FALSIFIABLE GATES (spec §4.1, §10): the cross-symbol-rename
 * frontier must CLOSE, call-order must DIFFER (inline-positional, not sorted-set),
 * code-level SCCs must resolve, and the whole thing must be byte-deterministic.
 *
 * The harness runs the REAL pipeline contentId (TsLens → fresh SymbolIndex →
 * injectCodeUnits → computeEssences), never the lens's standalone CCNF — so an
 * EQUAL/ DIFFER here is a statement about the content-address the oracle sees.
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
import { computeEssences } from '../src/warp/essence-hash.js';

/** Write relPath → contents into a fresh temp dir; return its abs path. */
async function mkFixture(files: Record<string, string>): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'code-warp-'));
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(dir, rel);
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, content, 'utf8');
  }
  return dir;
}

/** An empty `.purpose`-family SymbolIndex (so we can inject code-units into it). */
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
 * The FULL stage-3 pipeline over a tree of `.ts` files: lift → fresh index →
 * inject → compute whole-universe essences → return the symbol→contentId map.
 * Cleans the temp dir on the way out.
 */
async function essencesOfTree(files: Record<string, string>): Promise<Map<string, string>> {
  const dir = await mkFixture(files);
  try {
    const units = await new TsLens().lift(dir);
    const index = emptyIndex();
    injectCodeUnits(index, units);
    const universe = getAllSymbols(index).map((e) => e.symbol);
    return computeEssences(index, universe).contentIds;
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

const sym = (file: string, qname: string) => `#code:${file}::${qname}`;

// ===========================================================================
// 1. Frontier EQUAL — the cross-symbol-rename frontier CLOSES.
// ===========================================================================
describe('code-warp — frontier (cross-symbol rename is the empty delta)', () => {
  it("f's contentId is identical whether the local helper is named `helper` or `assist`", async () => {
    const a = await essencesOfTree({
      'src/a.ts': `function f(){ return helper(); }
function helper(){ return 1; }`,
    });
    const b = await essencesOfTree({
      // `helper` renamed → `assist` consistently (def + call).
      'src/a.ts': `function f(){ return assist(); }
function assist(){ return 1; }`,
    });
    const fa = a.get(sym('src/a.ts', 'f'))!;
    const fb = b.get(sym('src/a.ts', 'f'))!;
    expect(fa).toBeDefined();
    expect(fb).toBeDefined();
    // Merkle-by-target: substituting the target's ESSENCE (not its name) at the
    // f:0 slot means the consistent rename never moves f's content-address.
    expect(fa).toBe(fb);
  });
});

// ===========================================================================
// 2. Call-order DIFFER — the §4.1 payoff (inline-positional, NOT sorted-set).
// ===========================================================================
describe('code-warp — call order is meaning', () => {
  it('f(){a();b();} vs f(){b();a();} → DIFFER', async () => {
    const tree = (order: string) => ({
      'src/x.ts': `function a(){ return 1; }
function b(){ return 2; }
function f(){ ${order} }`,
    });
    const ab = await essencesOfTree(tree('a();b();'));
    const ba = await essencesOfTree(tree('b();a();'));
    const f1 = ab.get(sym('src/x.ts', 'f'))!;
    const f2 = ba.get(sym('src/x.ts', 'f'))!;
    expect(f1).toBeDefined();
    expect(f2).toBeDefined();
    // If substitution collapsed to a sorted/unordered edge-set, these would be
    // EQUAL — the silent call-order false-EQUAL. They MUST DIFFER.
    expect(f1).not.toBe(f2);
  });
});

// ===========================================================================
// 2b. String literals are OPAQUE — the f:N slot substitution must not reach
//     inside string content (regression for the U+001F-sentinel fix).
// ===========================================================================
describe('code-warp — string literals are opaque to slot substitution', () => {
  it('two functions differing ONLY in a string literal ("f:0" vs "f:00") do NOT collide', async () => {
    // Each f calls a local `helper` → a real positional slot at index 0. Each
    // also RETURNS a string literal that happens to read like a slot token.
    const tree = (lit: string) => ({
      'src/x.ts': `function helper(){ return 1; }
function f(){ helper(); return ${JSON.stringify(lit)}; }`,
    });
    const a = await essencesOfTree(tree('f:0'));
    const b = await essencesOfTree(tree('f:00'));
    const fa = a.get(sym('src/x.ts', 'f'))!;
    const fb = b.get(sym('src/x.ts', 'f'))!;
    expect(fa).toBeDefined();
    expect(fb).toBeDefined();
    // Before the fix, the body-wide regex /\bf:(\d+)\b/ matched the `f:0`/`f:00`
    // INSIDE the string literal (str:"f:0") and rewrote it to helper's essence —
    // collapsing both bodies to the same content-address: a silent false-EQUAL
    // meaning collision. The U+001F-anchored slot token makes string content
    // unforgeable, so the two distinct literals stay distinct. (T-2026-06-24-003)
    expect(fa).not.toBe(fb);
  });
});

// ===========================================================================
// 3. Different-target DIFFER — calling a different-bodied local differs.
// ===========================================================================
describe('code-warp — different target differs', () => {
  it('f calling `helper` (returns 1) vs `other` (returns 99) → DIFFER', async () => {
    const a = await essencesOfTree({
      'src/t.ts': `function f(){ return helper(); }
function helper(){ return 1; }`,
    });
    const b = await essencesOfTree({
      'src/t.ts': `function f(){ return other(); }
function other(){ return 99; }`,
    });
    const fa = a.get(sym('src/t.ts', 'f'))!;
    const fb = b.get(sym('src/t.ts', 'f'))!;
    // The target's body differs → its essence differs → the inlined slot differs
    // → f differs. (Contrast the frontier test, where only the NAME changed.)
    expect(fa).not.toBe(fb);
  });
});

// ===========================================================================
// 4. Determinism — same tree, lift+inject+compute twice → byte-identical.
// ===========================================================================
describe('code-warp — determinism', () => {
  it('the SAME tree computed twice → identical code-unit contentIds', async () => {
    const tree = {
      'src/one.ts': `export function alpha(n: number): number { return beta(n) + 1; }
export function beta(n: number): number { return n * 2; }
export const gamma = (n: number) => alpha(n);
export class K { m(): number { return beta(2); } }`,
      'src/two.ts': `import { map } from 'rxjs';
export function delta(): unknown { return map(1); }`,
    };
    const first = await essencesOfTree(tree);
    const second = await essencesOfTree(tree);
    // Compare the full code-unit contentId map byte-for-byte.
    const norm = (m: Map<string, string>) =>
      JSON.stringify([...m.entries()].filter(([k]) => k.startsWith('#code:')).sort());
    expect(norm(first)).toBe(norm(second));
    // And sanity: there ARE code-units in the map.
    expect([...first.keys()].some((k) => k.startsWith('#code:'))).toBe(true);
  });
});

// ===========================================================================
// 5. SCC / mutual recursion — a real code-level cycle resolves (scc tag),
//    a body change inside the cycle moves the essences, deterministic.
// ===========================================================================
describe('code-warp — code-level SCC (mutual recursion)', () => {
  it('a(){return b();} b(){return a();} → both resolve with an scc tag', async () => {
    const ids = await essencesOfTree({
      'src/s.ts': `function a(){ return b(); }
function b(){ return a(); }`,
    });
    const ea = ids.get(sym('src/s.ts', 'a'))!;
    const eb = ids.get(sym('src/s.ts', 'b'))!;
    expect(ea).toBeDefined();
    expect(eb).toBeDefined();
    // Both members get the compiler-pinned SCC namespace.
    expect(ea).toMatch(/^essence:v1:ts[\d.]+:scc:/);
    expect(eb).toMatch(/^essence:v1:ts[\d.]+:scc:/);
  });

  it('changing a body inside the cycle changes the essences', async () => {
    const base = await essencesOfTree({
      'src/s.ts': `function a(){ return b(); }
function b(){ return a(); }`,
    });
    const changed = await essencesOfTree({
      // b's body gains a real statement before the recursive call.
      'src/s.ts': `function a(){ return b(); }
function b(){ const x = 5; return a(); }`,
    });
    expect(base.get(sym('src/s.ts', 'a'))).not.toBe(changed.get(sym('src/s.ts', 'a')));
    expect(base.get(sym('src/s.ts', 'b'))).not.toBe(changed.get(sym('src/s.ts', 'b')));
  });

  it('the cycle resolves identically across two runs (determinism under SCC)', async () => {
    const tree = {
      'src/s.ts': `function a(){ return b(); }
function b(){ return a(); }`,
    };
    const first = await essencesOfTree(tree);
    const second = await essencesOfTree(tree);
    expect(first.get(sym('src/s.ts', 'a'))).toBe(second.get(sym('src/s.ts', 'a')));
    expect(first.get(sym('src/s.ts', 'b'))).toBe(second.get(sym('src/s.ts', 'b')));
  });
});

// ===========================================================================
// 6. Mixed universe — a .purpose component + code-units coexist; tags split.
// ===========================================================================
describe('code-warp — mixed .purpose + code universe', () => {
  it('a .purpose component (v0) and code-units (v1:ts...) coexist with no error', async () => {
    // Lift code-units from a tree, then inject them ALONGSIDE a .purpose entry
    // built the normal way, into one index → one computeEssences universe.
    const dir = await mkFixture({
      'src/m.ts': `export function f(): number { return 1; }`,
    });
    try {
      const units = await new TsLens().lift(dir);
      const result: AggregationResult = {
        symbols: [
          {
            id: 'uuid-purpose-1',
            symbol: '#checkout',
            type: 'component',
            source: 'purpose',
            filePath: 'src/checkout/.purpose',
            data: { gates: ['^authenticated'] },
            references: [],
            referencedBy: [],
            componentType: 'view',
          },
        ],
        purposeFiles: [],
        portalFiles: [],
        errors: [],
        timestamp: 0,
      };
      const index = buildSymbolIndex(result);
      injectCodeUnits(index, units);
      const universe = getAllSymbols(index).map((e) => e.symbol);
      const ids = computeEssences(index, universe).contentIds;

      const purpose = ids.get('#checkout')!;
      const code = ids.get(sym('src/m.ts', 'f'))!;
      expect(purpose).toBeDefined();
      expect(code).toBeDefined();
      // .purpose stays v0; code carries the compiler-pinned v1 tag.
      expect(purpose).toMatch(/^essence:v0:/);
      expect(code).toMatch(/^essence:v1:ts[\d.]+:/);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});

// ===========================================================================
// 7. Tag check — a code-unit contentId is in the pinned compiler namespace.
// ===========================================================================
describe('code-warp — version tag', () => {
  it('a code-unit contentId starts essence:v1:ts5.9.3:', async () => {
    const ids = await essencesOfTree({
      'src/v.ts': `export function f(): number { return 1; }`,
    });
    const id = ids.get(sym('src/v.ts', 'f'))!;
    expect(id).toBeDefined();
    // Exact-pinned compiler (package.json typescript 5.9.3).
    expect(id.startsWith('essence:v1:ts5.9.3:')).toBe(true);
  });
});
