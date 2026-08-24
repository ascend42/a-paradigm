/**
 * code-essence.test — the SYNTACTIC CCNF (codeCNF) properties + the v1 ship gate.
 *
 * We assert directly on the canonical token STRING (no hashing needed): EQUAL
 * strings ⇒ identical meaning under the v1 notion; DIFFERing strings ⇒ a real
 * change. Three blocks:
 *   1. the spike's 10 properties (regression — now through the hardened lens),
 *   2. the adversarial false-EQUAL probes (§3.2) — the SHIP GATE: each MUST DIFFER,
 *   3. the soundness fixes the spike got WRONG: type-param rename invariance and
 *      shadowing-correct scope resolution.
 */

import { describe, it, expect } from 'vitest';
import * as ts from 'typescript';
import { codeCNF } from '../src/lens/ts-essence.js';

/** Parse a code snippet and return its SourceFile (parents set for comments/scope). */
function parse(code: string): ts.SourceFile {
  return ts.createSourceFile('x.ts', code, ts.ScriptTarget.Latest, /*setParentNodes*/ true);
}

/** CNF of the FIRST top-level statement parsed as a declaration. */
function cnf(code: string): string {
  return codeCNF(parse(code).statements[0]);
}

/** Parse `function f<...>(...) {...}` form; return the FunctionDeclaration. */
function fn(body: string): string {
  return cnf(`function f${body}`);
}

/** Extract the arrow/function-expression initializer of `const name = <fn>`. */
function arrowConst(code: string): string {
  const sf = parse(code);
  const stmt = sf.statements[0];
  if (!ts.isVariableStatement(stmt)) throw new Error('expected a variable statement');
  const init = stmt.declarationList.declarations[0].initializer;
  if (!init) throw new Error('no initializer');
  return codeCNF(init);
}

/** Extract the first member of the first class declaration (method/accessor). */
function classMember(code: string, predicate: (m: ts.ClassElement) => boolean): string {
  const sf = parse(code);
  const cls = sf.statements.find((s) => ts.isClassDeclaration(s)) as ts.ClassDeclaration;
  const member = cls.members.find(predicate);
  if (!member) throw new Error('member not found');
  return codeCNF(member);
}

// ===========================================================================
// 1. The spike's 10 properties (regression).
// ===========================================================================
describe('codeCNF — spike regression properties', () => {
  it('determinism: same code twice → EQUAL', () => {
    expect(fn('(a, b) { return a + b; }')).toBe(fn('(a, b) { return a + b; }'));
  });

  it('local-rename: rename params/locals → EQUAL', () => {
    expect(fn('(a, b) { const s = a + b; return s; }')).toBe(
      fn('(x, y) { const z = x + y; return z; }'),
    );
  });

  it('format/whitespace: reflow → EQUAL', () => {
    expect(fn('(a,b){return a+b;}')).toBe(fn('(a, b) {\n   return a   +   b;\n}'));
  });

  it('comments: add free prose → EQUAL', () => {
    expect(fn('(a, b) { return a + b; }')).toBe(
      fn('(a, b) { /* sum */ return a + b; // ret\n}'),
    );
  });

  it('redundant-parens: (a+b) vs a+b → EQUAL', () => {
    expect(fn('(a, b) { return a + b; }')).toBe(fn('(a, b) { return (a + b); }'));
  });

  it('operator-change: + vs - → DIFFER', () => {
    expect(fn('(a, b) { return a + b; }')).not.toBe(fn('(a, b) { return a - b; }'));
  });

  it('literal-change: 1 vs 2 → DIFFER', () => {
    expect(fn('() { return 1; }')).not.toBe(fn('() { return 2; }'));
  });

  it('controlflow-change: add an if branch → DIFFER', () => {
    expect(fn('(a) { return a; }')).not.toBe(fn('(a) { if (a) return a; return 0; }'));
  });

  it('written-type-annotation: string vs number → DIFFER', () => {
    expect(fn('(a: string) { return a; }')).not.toBe(fn('(a: number) { return a; }'));
  });

  it('arg-order: swap operand order → DIFFER', () => {
    expect(fn('(a, b) { return a - b; }')).not.toBe(fn('(a, b) { return b - a; }'));
  });
});

// ===========================================================================
// 2. Adversarial false-EQUAL probes (§3.2) — the SHIP GATE. Each MUST DIFFER.
// ===========================================================================
describe('codeCNF — false-EQUAL guard (ship gate)', () => {
  it('sync vs async → DIFFER', () => {
    expect(fn('(){}')).not.toBe(cnf('async function f(){}'));
  });

  it('function vs function* (generator) → DIFFER', () => {
    expect(fn('(){}')).not.toBe(cnf('function* f(){}'));
  });

  it('required vs optional param (a:T vs a?:T) → DIFFER', () => {
    expect(arrowConst('const g = (a: T) => a;')).not.toBe(
      arrowConst('const g = (a?: T) => a;'),
    );
  });

  it('member vs optional-chain (a.b vs a?.b) → DIFFER', () => {
    expect(fn('(a) { return a.b; }')).not.toBe(fn('(a) { return a?.b; }'));
  });

  it('logical-or vs nullish (|| vs ??) → DIFFER', () => {
    expect(fn('(a, b) { return a || b; }')).not.toBe(fn('(a, b) { return a ?? b; }'));
  });

  it('rest vs non-rest param (...a vs a) → DIFFER', () => {
    expect(fn('(...a) { return a; }')).not.toBe(fn('(a) { return a; }'));
  });

  it('getter vs method of the same name → DIFFER', () => {
    const getter = classMember('class C { get x() { return 1; } }', ts.isGetAccessorDeclaration);
    const method = classMember('class C { x() { return 1; } }', ts.isMethodDeclaration);
    expect(getter).not.toBe(method);
  });

  // Extra guard coverage beyond the explicit list — these are cheap and load-bearing.
  it('default-presence: (a) vs (a = 1) → DIFFER', () => {
    expect(fn('(a) { return a; }')).not.toBe(fn('(a = 1) { return a; }'));
  });

  it('definite-assignment: let x vs let x! (in body) → DIFFER', () => {
    expect(fn('() { let x: number; return x; }')).not.toBe(
      fn('() { let x!: number; return x; }'),
    );
  });

  it('static vs instance method → DIFFER', () => {
    const inst = classMember('class C { m() {} }', ts.isMethodDeclaration);
    const stat = classMember('class C { static m() {} }', ts.isMethodDeclaration);
    expect(inst).not.toBe(stat);
  });
});

// ===========================================================================
// 3. Soundness fixes the spike got WRONG.
// ===========================================================================
describe('codeCNF — type-param alpha-normalization (spike got this wrong)', () => {
  it('f<T>(x:T):T vs f<U>(x:U):U → EQUAL', () => {
    expect(fn('<T>(x: T): T { return x; }')).toBe(fn('<U>(x: U): U { return x; }'));
  });

  it('but a DIFFERENT type structure still DIFFERs (T[] vs T)', () => {
    expect(fn('<T>(x: T): T { return x; }')).not.toBe(
      fn('<T>(x: T[]): T[] { return x[0]; }'),
    );
  });
});

describe('codeCNF — shadowing soundness (the false-EQUAL the flat map hid)', () => {
  it('inner block redeclares an outer name vs does not → DIFFER', () => {
    // A: inner `x` shadows the param `x` — the inner return reads the LOCAL x.
    const shadow = fn('(x) { { const x = 1; return x; } }');
    // B: no inner redeclaration — the inner return reads the PARAM x.
    const noShadow = fn('(x) { { return x; } }');
    expect(shadow).not.toBe(noShadow);
  });

  it('two alpha-equivalent fns with locals declared in different textual order across independent sibling scopes → EQUAL', () => {
    // Two sibling blocks each declare one local; swapping which block declares
    // which NAME first must not move the essence — each local is scope-local and
    // alpha-normalized within its own scope.
    const a = fn('() { { const p = 1; foo(p); } { const q = 2; bar(q); } }');
    const b = fn('() { { const m = 1; foo(m); } { const n = 2; bar(n); } }');
    expect(a).toBe(b);
  });

  it('a shadowed use resolves to the inner binding, not the outer (rename-invariant)', () => {
    // Renaming both the outer and inner bindings consistently → EQUAL.
    const a = fn('(outer) { const inner = outer; { const inner = 9; return inner; } }');
    const b = fn('(p) { const q = p; { const q = 9; return q; } }');
    expect(a).toBe(b);
  });
});

// ===========================================================================
// 4. Free-reference classifier behavior (stage-1 self-contained vs edge mode).
// ===========================================================================
describe('codeCNF — free-reference classifier', () => {
  it('default classifier emits free:{name} (spike-equivalent)', () => {
    const out = codeCNF(parse('function f(){ return helper(1); }').statements[0]);
    expect(out).toContain('free:helper');
  });

  it('edge classifier strips the name → positional f:{idx}', () => {
    const node = parse('function f(){ return helper(1); }').statements[0];
    const out = codeCNF(node, { freeRefClassifier: () => 'edge' });
    expect(out).toContain('f:0');
    expect(out).not.toContain('helper');
  });

  it('edge mode: consistent cross-symbol rename is the empty delta (frontier closed)', () => {
    // helper → assist, consistently. With names stripped to positional f:0, the
    // caller essence is identical — the deferred hard part the spike flagged.
    const before = codeCNF(parse('function f(){ return helper(1); }').statements[0], {
      freeRefClassifier: () => 'edge',
    });
    const after = codeCNF(parse('function f(){ return assist(1); }').statements[0], {
      freeRefClassifier: () => 'edge',
    });
    expect(before).toBe(after);
  });

  it('default mode: rename of a free ref DIFFERs (by-name, honest under-resolution)', () => {
    const before = codeCNF(parse('function f(){ return helper(1); }').statements[0]);
    const after = codeCNF(parse('function f(){ return assist(1); }').statements[0]);
    expect(before).not.toBe(after);
  });
});

// ===========================================================================
// 5. Literal normalization (§3.3).
// ===========================================================================
describe('codeCNF — literal normalization (§3.3)', () => {
  it('hex/oct/bin integers normalize to the same decimal → EQUAL', () => {
    expect(fn('() { return 0xff; }')).toBe(fn('() { return 255; }'));
    expect(fn('() { return 0o17; }')).toBe(fn('() { return 15; }'));
    expect(fn('() { return 0b1010; }')).toBe(fn('() { return 10; }'));
  });

  it('numeric separators carry no meaning → EQUAL', () => {
    expect(fn('() { return 1_000; }')).toBe(fn('() { return 1000; }'));
  });

  it('non-integer numerics are NOT IEEE-754 round-tripped (0.1 ≠ 1e-1 by design)', () => {
    expect(fn('() { return 0.1; }')).not.toBe(fn('() { return 1e-1; }'));
  });

  it('bigint normalizes to decimal+n → EQUAL', () => {
    expect(fn('() { return 0xffn; }')).toBe(fn('() { return 255n; }'));
  });

  it('string escapes resolve to the same codepoints → EQUAL', () => {
    expect(fn('() { return "\\u0041"; }')).toBe(fn('() { return "A"; }'));
  });
});
