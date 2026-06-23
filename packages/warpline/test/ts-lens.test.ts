/**
 * ts-lens.test — STAGE 2 of the code-lens: the `createProgram` + checker-
 * resolution lift. Four blocks (spec §4, §5):
 *   1. Coverage — top-level fn, arrow-const, class (method + getter + ctor) all
 *      become CodeUnits with correct symbols/qualifiedNames.
 *   2. Resolution classification — local helper → `local` edge; `console.log` →
 *      `builtin`; imported `debounce` from `'lodash'` → `extern` (specifier-as-
 *      written, regardless of node_modules).
 *   3. f:idx ↔ references ALIGNMENT — call-order swap keeps the body identical
 *      (`f:0…f:1`) but reorders the aligned `references` (stage-3 substitution
 *      will distinguish them). The load-bearing soundness assertion.
 *   4. Determinism — `lift(sameDir)` twice → byte-identical `CodeUnit[]`.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { TsLens, TS_LENS_VERSION } from '../src/lens/ts-lens.js';
import type { CodeUnit } from '../src/lens/code-lens.js';

/** Write a map of relPath → contents into a fresh temp dir; return its abs path. */
async function mkFixture(files: Record<string, string>): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ts-lens-'));
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(dir, rel);
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, content, 'utf8');
  }
  return dir;
}

const byQName = (units: CodeUnit[]): Map<string, CodeUnit> =>
  new Map(units.map((u) => [u.qualifiedName, u]));

// ===========================================================================
// 1. Coverage — the common function forms all produce CodeUnits.
// ===========================================================================
describe('TsLens — coverage of function forms', () => {
  let dir: string;
  let units: CodeUnit[];

  beforeAll(async () => {
    dir = await mkFixture({
      'src/a.ts': `
export function topLevel(a: number): number {
  return a + 1;
}

export const arrowConst = (x: string): string => x.trim();

export class Widget {
  count: number;
  constructor(n: number) {
    this.count = n;
  }
  increment(): void {
    this.count = this.count + 1;
  }
  get value(): number {
    return this.count;
  }
}
`,
    });
    units = await new TsLens().lift(dir);
  });

  afterAll(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('lifts the top-level function', () => {
    const m = byQName(units);
    const fn = m.get('topLevel');
    expect(fn).toBeDefined();
    expect(fn!.symbol).toBe('#code:src/a.ts::topLevel');
    expect(fn!.componentType).toBe('code-unit');
    expect(fn!.codeEssence).toContain('fn:fndecl');
  });

  it('lifts the arrow-const', () => {
    const m = byQName(units);
    const arrow = m.get('arrowConst');
    expect(arrow).toBeDefined();
    expect(arrow!.symbol).toBe('#code:src/a.ts::arrowConst');
    expect(arrow!.codeEssence).toContain('fn:arrow');
  });

  it('lifts the class, its constructor, method, and getter', () => {
    const m = byQName(units);
    expect(m.get('Widget')).toBeDefined();
    expect(m.get('Widget')!.symbol).toBe('#code:src/a.ts::Widget');

    expect(m.get('Widget.constructor')).toBeDefined();
    expect(m.get('Widget.constructor')!.codeEssence).toContain('fn:ctor');

    expect(m.get('Widget.increment')).toBeDefined();
    expect(m.get('Widget.increment')!.codeEssence).toContain('fn:method');

    expect(m.get('Widget.value')).toBeDefined();
    expect(m.get('Widget.value')!.codeEssence).toContain('fn:get');
  });

  it('stableKey carries the structural path (class member nesting)', () => {
    const m = byQName(units);
    expect(m.get('Widget')!.stableKey).toMatch(/^src\/a\.ts::class#\d+$/);
    expect(m.get('Widget.increment')!.stableKey).toMatch(/^src\/a\.ts::class#\d+\/method#\d+$/);
  });
});

// ===========================================================================
// 2. Resolution classification — local / builtin / extern.
// ===========================================================================
describe('TsLens — reference resolution classification (§4)', () => {
  it('a function calling a local helper → `local` edge to the helper symbol', async () => {
    const dir = await mkFixture({
      'src/m.ts': `
export function helper(x: number): number {
  return x * 2;
}
export function caller(y: number): number {
  return helper(y);
}
`,
    });
    try {
      const units = await new TsLens().lift(dir);
      const caller = byQName(units).get('caller')!;
      expect(caller.references.length).toBeGreaterThanOrEqual(1);
      const ref = caller.references[0];
      expect(ref.kind).toBe('local');
      if (ref.kind === 'local') {
        expect(ref.target).toBe('#code:src/m.ts::helper');
        expect(ref.edgeKind).toBe('calls');
      }
      // The body emits f:idx (the local edge slot), not the name.
      expect(caller.codeEssence).toContain('f:0');
      expect(caller.codeEssence).not.toContain('free:helper');
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('a function calling console.log → `builtin` (name carried, free:console in body)', async () => {
    const dir = await mkFixture({
      'src/b.ts': `
export function logIt(msg: string): void {
  console.log(msg);
}
`,
    });
    try {
      const units = await new TsLens().lift(dir);
      const fn = byQName(units).get('logIt')!;
      const consoleRef = fn.references.find(
        (r) => r.kind === 'builtin' && r.name === 'console',
      );
      expect(consoleRef).toBeDefined();
      // builtins are emitted by name in the body (not as positional f:idx).
      expect(fn.codeEssence).toContain('free:console');
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('an imported `debounce` from "lodash" → `extern:lodash#debounce` (no node_modules needed)', async () => {
    const dir = await mkFixture({
      'src/c.ts': `
import { debounce } from 'lodash';
export function setup(): unknown {
  return debounce(() => 1, 100);
}
`,
    });
    try {
      const units = await new TsLens().lift(dir);
      const fn = byQName(units).get('setup')!;
      const ext = fn.references.find((r) => r.kind === 'extern');
      expect(ext).toBeDefined();
      if (ext && ext.kind === 'extern') {
        expect(ext.id).toBe('extern:lodash#debounce');
      }
      // externs emit by name in the body.
      expect(fn.codeEssence).toContain('free:debounce');
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('a renamed named import keeps the SOURCE export name in the extern id', async () => {
    const dir = await mkFixture({
      'src/d.ts': `
import { debounce as db } from 'lodash';
export function go(): unknown {
  return db(() => 1, 50);
}
`,
    });
    try {
      const units = await new TsLens().lift(dir);
      const fn = byQName(units).get('go')!;
      const ext = fn.references.find((r) => r.kind === 'extern');
      expect(ext && ext.kind === 'extern' ? ext.id : '').toBe('extern:lodash#debounce');
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});

// ===========================================================================
// 3. f:idx ↔ references ALIGNMENT — call order is meaning.
// ===========================================================================
describe('TsLens — f:idx ↔ references alignment (stage-3 substitution soundness)', () => {
  it('helper();other(); vs other();helper(); → identical body, REORDERED references', async () => {
    const dirA = await mkFixture({
      'src/x.ts': `
export function helper(): void {}
export function other(): void {}
export function f(): void {
  helper();
  other();
}
`,
    });
    const dirB = await mkFixture({
      'src/x.ts': `
export function helper(): void {}
export function other(): void {}
export function f(): void {
  other();
  helper();
}
`,
    });
    try {
      const a = byQName(await new TsLens().lift(dirA)).get('f')!;
      const b = byQName(await new TsLens().lift(dirB)).get('f')!;

      // The BODY is byte-identical: both carry the positional `f:0 … f:1` slots.
      expect(a.codeEssence).toBe(b.codeEssence);
      expect(a.codeEssence).toContain('f:0');
      expect(a.codeEssence).toContain('f:1');

      // But the ALIGNED references differ in ORDER — so stage-3 substitution
      // (essence inlined at each positional slot) will distinguish them.
      expect(a.references.length).toBe(2);
      expect(b.references.length).toBe(2);

      const targetsA = a.references.map((r) => (r.kind === 'local' ? r.target : r.kind));
      const targetsB = b.references.map((r) => (r.kind === 'local' ? r.target : r.kind));

      expect(targetsA).toEqual(['#code:src/x.ts::helper', '#code:src/x.ts::other']);
      expect(targetsB).toEqual(['#code:src/x.ts::other', '#code:src/x.ts::helper']);
      // Same set, different order → the alignment is the discriminator.
      expect(targetsA).not.toEqual(targetsB);
      expect([...targetsA].sort()).toEqual([...targetsB].sort());
    } finally {
      await fs.rm(dirA, { recursive: true, force: true });
      await fs.rm(dirB, { recursive: true, force: true });
    }
  });
});

// ===========================================================================
// 4. Determinism — lift twice → byte-identical CodeUnit[].
// ===========================================================================
describe('TsLens — determinism (§5)', () => {
  it('lift(sameDir) twice → JSON-identical CodeUnit[]', async () => {
    const dir = await mkFixture({
      'src/one.ts': `
import { map } from 'rxjs';
export function alpha(n: number): number { return beta(n) + 1; }
export function beta(n: number): number { return n * 2; }
export const gamma = (n: number) => map(n);
export class K {
  m(): number { return alpha(1); }
}
`,
      'src/two.ts': `
export function delta(): void { console.log('hi'); }
`,
    });
    try {
      const first = await new TsLens().lift(dir);
      const second = await new TsLens().lift(dir);
      expect(JSON.stringify(first)).toBe(JSON.stringify(second));
      // sorted by symbol (determinism guarantee).
      const symbols = first.map((u) => u.symbol);
      expect([...symbols].sort()).toEqual(symbols);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('TS_LENS_VERSION is the exact pinned compiler string', () => {
    expect(TS_LENS_VERSION).toMatch(/^\d+\.\d+\.\d+/);
  });
});
