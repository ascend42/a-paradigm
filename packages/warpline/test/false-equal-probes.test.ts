/**
 * false-equal-probes.test — the INSTITUTIONAL per-TS-release false-EQUAL ship gate
 * (spec §3.2; v1.1 amendment 2026-07-02, T-2026-07-02-008 / GUARD-DECIDER Stream A).
 *
 * A false-EQUAL (silent "no semantic change" on changed code) corrupts the oracle
 * invisibly — far worse than a false-DIFFER. This suite exists because v1 shipped
 * three CONFIRMED false-EQUAL classes (decorator removed / decorator arg changed /
 * accessibility changed): the four-modifier whitelist + the generic `forEachChild`
 * fallback FAILED OPEN. v1.1 serializes decorators (source order) and EVERY
 * modifier (fail-closed, sorted canonical names).
 *
 * RUN THIS SUITE AGAINST EVERY NEW PINNED TypeScript VERSION before bumping the
 * pin: new syntax a TS release adds is exactly the surface where fail-open would
 * silently return. Both halves are the gate:
 *   - the adversarial probes MUST DIFFER (a real change is never EQUAL), and
 *   - the protective controls MUST stay EQUAL (rename-is-the-empty-delta IS the
 *     thesis — an over-eager serializer that breaks rename-invariance fails the
 *     gate just as hard).
 */

import { describe, it, expect } from 'vitest';
import * as ts from 'typescript';
import { codeCNF, CCNF_ALGO_VERSION } from '../src/lens/ts-essence.js';
import { CODE_ESSENCE_TAG } from '../src/lens/lift-code-units.js';

/** Parse a snippet with parent pointers (required for scope/comment walks). */
function parse(code: string): ts.SourceFile {
  return ts.createSourceFile('x.ts', code, ts.ScriptTarget.Latest, /*setParentNodes*/ true);
}

/** CNF of the FIRST top-level statement. */
function cnf(code: string): string {
  return codeCNF(parse(code).statements[0]);
}

/** CNF of `function f...` (declaration form). */
function fn(body: string): string {
  return cnf(`function f${body}`);
}

/** CNF of the FIRST member of the first class in the snippet. */
function member(classBody: string): string {
  const sf = parse(`class C { ${classBody} }`);
  const cls = sf.statements.find((s) => ts.isClassDeclaration(s)) as ts.ClassDeclaration;
  const m = cls.members[0];
  if (!m) throw new Error('no class member parsed');
  return codeCNF(m);
}

// ===========================================================================
// 1. ADVERSARIAL PROBES — every pair MUST DIFFER (the confirmed v1 holes first).
// ===========================================================================
describe('false-EQUAL probes — decorators (confirmed v1 hole)', () => {
  it('decorator removed: @UseGuards(AuthGuard) m() ≠ m()', () => {
    expect(member(`@UseGuards(AuthGuard) m() { return 1; }`)).not.toBe(
      member(`m() { return 1; }`),
    );
  });

  it('decorator argument changed: @Get("/users") ≠ @Get("/admin")', () => {
    expect(member(`@Get('/users') m() { return 1; }`)).not.toBe(
      member(`@Get('/admin') m() { return 1; }`),
    );
  });

  it('decorator identity changed: @Get(x) ≠ @Post(x)', () => {
    expect(member(`@Get('/u') m() { return 1; }`)).not.toBe(
      member(`@Post('/u') m() { return 1; }`),
    );
  });

  it('decorator ORDER is semantic: @A @B m() ≠ @B @A m()', () => {
    expect(member(`@A @B m() { return 1; }`)).not.toBe(member(`@B @A m() { return 1; }`));
  });

  it('parameter decorator changed: @Body() ≠ @Query()', () => {
    expect(member(`m(@Body() b: string) { return b; }`)).not.toBe(
      member(`m(@Query() b: string) { return b; }`),
    );
  });

  it('parameter decorator removed: m(@Body() b) ≠ m(b)', () => {
    expect(member(`m(@Body() b: string) { return b; }`)).not.toBe(
      member(`m(b: string) { return b; }`),
    );
  });
});

describe('false-EQUAL probes — modifiers (fail-closed, confirmed v1 hole)', () => {
  it('accessibility: private m() ≠ public m()', () => {
    expect(member(`private m() { return 1; }`)).not.toBe(member(`public m() { return 1; }`));
  });

  it('accessibility presence: private m() ≠ m()', () => {
    expect(member(`private m() { return 1; }`)).not.toBe(member(`m() { return 1; }`));
  });

  it('override added: override m() ≠ m()', () => {
    expect(member(`override m() { return 1; }`)).not.toBe(member(`m() { return 1; }`));
  });

  it('parameter property readonly: constructor(readonly x) ≠ constructor(x)', () => {
    expect(member(`constructor(readonly x: number) {}`)).not.toBe(
      member(`constructor(x: number) {}`),
    );
  });

  it('parameter property accessibility: constructor(private x) ≠ constructor(public x)', () => {
    expect(member(`constructor(private x: number) {}`)).not.toBe(
      member(`constructor(public x: number) {}`),
    );
  });

  it('static (regression): static m() ≠ m()', () => {
    expect(member(`static m() { return 1; }`)).not.toBe(member(`m() { return 1; }`));
  });

  it('abstract (regression): abstract classes differ on the abstract member', () => {
    const abstractM = (() => {
      const sf = parse(`abstract class C { abstract m(): number; }`);
      const cls = sf.statements[0] as ts.ClassDeclaration;
      return codeCNF(cls.members[0]);
    })();
    const plainM = (() => {
      const sf = parse(`class C { m(): number { return 1; } }`);
      const cls = sf.statements[0] as ts.ClassDeclaration;
      return codeCNF(cls.members[0]);
    })();
    expect(abstractM).not.toBe(plainM);
  });

  it('async (regression): async m() ≠ m()', () => {
    expect(member(`async m() { return 1; }`)).not.toBe(member(`m() { return 1; }`));
  });

  it('export is identity-bearing under fail-closed: export function ≠ function', () => {
    // v1.1 consequence, stated honestly: the §3 "visibility is a label" row is
    // superseded by fail-closed EVERY-modifier serialization (amendment 2026-07-02).
    expect(cnf(`export function f() { return 1; }`)).not.toBe(cnf(`function f() { return 1; }`));
  });
});

describe('false-EQUAL probes — type parameters + accessor kind', () => {
  it('<const T> ≠ <T>', () => {
    expect(fn(`<const T>(x: T): T { return x; }`)).not.toBe(fn(`<T>(x: T): T { return x; }`));
  });

  it('getter ≠ plain method (node-kind regression)', () => {
    expect(member(`get v() { return 1; }`)).not.toBe(member(`v() { return 1; }`));
  });

  it('getter ≠ setter counterpart shape', () => {
    expect(member(`get v() { return this.x; }`)).not.toBe(member(`set v(n) { this.x = n; }`));
  });

  it('generator (regression): function* ≠ function', () => {
    expect(cnf(`function* f() { yield 1; }`)).not.toBe(cnf(`function f() { return 1; }`));
  });
});

// ===========================================================================
// 2. PROTECTIVE EQUAL CONTROLS — rename-is-the-empty-delta MUST SURVIVE v1.1.
//    These staying EQUAL is as important as the probes above differing.
// ===========================================================================
describe('false-EQUAL probes — protective EQUAL controls (the rename thesis)', () => {
  it('whitespace/formatting is not meaning', () => {
    expect(fn(`(a,b){return a+b;}`)).toBe(fn(`(a, b) {\n  return a   +   b;\n}`));
  });

  it('free-prose comments are not meaning', () => {
    expect(fn(`(a) { return a; }`)).toBe(fn(`(a) { /* the answer */ return a; // ok\n }`));
  });

  it('local variable rename is the empty delta', () => {
    expect(fn(`() { const total = 1; return total; }`)).toBe(
      fn(`() { const sum = 1; return sum; }`),
    );
  });

  it('parameter rename is the empty delta', () => {
    expect(fn(`(price: number) { return price * 2; }`)).toBe(
      fn(`(cost: number) { return cost * 2; }`),
    );
  });

  it('parameter rename UNDER a param decorator is still the empty delta', () => {
    expect(member(`m(@Body() payload: string) { return payload; }`)).toBe(
      member(`m(@Body() input: string) { return input; }`),
    );
  });

  it('local rename INSIDE a decorated method is still the empty delta', () => {
    expect(member(`@Get('/u') m() { const a = 1; return a; }`)).toBe(
      member(`@Get('/u') m() { const b = 1; return b; }`),
    );
  });

  it('type-parameter rename is the empty delta (incl. <const T>)', () => {
    expect(fn(`<const T>(x: T): T { return x; }`)).toBe(fn(`<const U>(x: U): U { return x; }`));
  });

  it('modifier serialization is order-insensitive where the grammar permits', () => {
    // Same modifier SET must serialize identically regardless of source order
    // (sorted canonical names) — a keyword reorder is not a meaning change.
    expect(member(`public static m() { return 1; }`)).toBe(
      member(`static public m() { return 1; }`),
    );
  });

  it('same decorator, same args → EQUAL (determinism)', () => {
    expect(member(`@UseGuards(AuthGuard) m() { return 1; }`)).toBe(
      member(`@UseGuards(AuthGuard) m() { return 1; }`),
    );
  });
});

// ===========================================================================
// 3. The version-tag discontinuity — cross-version comparison is impossible.
// ===========================================================================
describe('false-EQUAL probes — algorithm version tag', () => {
  it('the CCNF algorithm version is v1.1 and is stamped into the essence tag', () => {
    expect(CCNF_ALGO_VERSION).toBe('v1.1');
    expect(CODE_ESSENCE_TAG.startsWith('v1.1:ts')).toBe(true);
  });
});
