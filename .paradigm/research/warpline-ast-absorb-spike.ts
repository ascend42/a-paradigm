/**
 * WARPLINE AST-ABSORB SOUNDNESS SPIKE
 * Question: can TS code be lifted to a DETERMINISTIC, meaning-preserving essence
 * in BOUNDED effort? Mirrors packages/warpline essence-hash (canonical normal form,
 * names/positions stripped, Merkle-by-target). This is a throwaway prototype whose
 * only job is to produce DATA on four properties + locate where it gets hard.
 *
 * The "code lens": lift each top-level function/method to a Canonical Normal Form:
 *   - DROP  : formatting, comments, positions, AND the NAMES of locally-bound
 *             identifiers (alpha-normalized to de-Bruijn-ish indices).
 *   - KEEP  : control-flow structure, operators, literal values, member-access
 *             chains, type annotations, and FREE references (by name in v0 — the
 *             deferred hard part is hash-by-target, exactly what the .purpose
 *             engine already does with edges-by-target-essence).
 */
import * as ts from "typescript";
import { createHash } from "crypto";

const VERSION = "code-essence:v0";

function parse(code: string): ts.SourceFile {
  return ts.createSourceFile("x.ts", code, ts.ScriptTarget.Latest, /*setParentNodes*/ true);
}

// Collect every locally-bound identifier name within a function subtree, in
// source order of first declaration → assign a stable canonical index.
function collectBound(fn: ts.Node): Map<string, number> {
  const order: string[] = [];
  const seen = new Set<string>();
  const add = (name: string) => { if (!seen.has(name)) { seen.add(name); order.push(name); } };
  const visit = (n: ts.Node) => {
    if (ts.isParameter(n) && ts.isIdentifier(n.name)) add(n.name.text);
    else if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name)) add(n.name.text);
    else if (ts.isBindingElement(n) && ts.isIdentifier(n.name)) add(n.name.text);
    else if (ts.isFunctionDeclaration(n) && n.name) add(n.name.text);
    else if (ts.isCatchClause(n) && n.variableDeclaration && ts.isIdentifier(n.variableDeclaration.name))
      add(n.variableDeclaration.name.text);
    ts.forEachChild(n, visit);
  };
  ts.forEachChild(fn, visit); // skip the fn's own name (it's a free symbol to callers)
  const m = new Map<string, number>();
  order.forEach((name, i) => m.set(name, i));
  return m;
}

function op(kind: ts.SyntaxKind): string {
  return ts.tokenToString(kind) ?? ts.SyntaxKind[kind];
}

// Serialize a node to a canonical token stream. `bound` maps local names → indices.
function serialize(node: ts.Node, bound: Map<string, number>): string {
  if (ts.isIdentifier(node)) {
    const idx = bound.get(node.text);
    return idx !== undefined ? `b${idx}` : `free:${node.text}`;
  }
  if (ts.isStringLiteralLike(node)) return `str:${node.text}`;
  if (ts.isNumericLiteral(node)) return `num:${node.text}`;
  if (node.kind === ts.SyntaxKind.TrueKeyword) return "true";
  if (node.kind === ts.SyntaxKind.FalseKeyword) return "false";
  if (ts.isPropertyAccessExpression(node))
    return `(member ${serialize(node.expression, bound)} prop:${node.name.text})`;
  if (ts.isBinaryExpression(node))
    return `(bin ${op(node.operatorToken.kind)} ${serialize(node.left, bound)} ${serialize(node.right, bound)})`;
  if (ts.isPrefixUnaryExpression(node)) return `(pre ${op(node.operator)} ${serialize(node.operand, bound)})`;
  if (ts.isPostfixUnaryExpression(node)) return `(post ${op(node.operator)} ${serialize(node.operand, bound)})`;
  // parentheses carry no meaning — transparent
  if (ts.isParenthesizedExpression(node)) return serialize(node.expression, bound);

  // default: kind + ordered semantic children (forEachChild skips trivia/punctuation)
  const parts: string[] = [];
  ts.forEachChild(node, (c) => { parts.push(serialize(c, bound)); });
  return parts.length ? `(${ts.SyntaxKind[node.kind]} ${parts.join(" ")})` : `(${ts.SyntaxKind[node.kind]})`;
}

function hash(s: string): string {
  return `${VERSION}:${createHash("sha256").update(s, "utf8").digest("hex").slice(0, 16)}`;
}

// essence of a single function-like declaration
function fnEssence(fn: ts.Node): string {
  return hash(serialize(fn, collectBound(fn)));
}

// file essence = sorted bag of top-level function essences (reorder-invariant, like .purpose)
function fileEssence(code: string): { state: string; fns: Record<string, string> } {
  const sf = parse(code);
  const fns: Record<string, string> = {};
  sf.statements.forEach((s) => {
    if (ts.isFunctionDeclaration(s) && s.name) fns[s.name.text] = fnEssence(s);
  });
  const bag = Object.values(fns).sort().join("|");
  return { state: hash("file|" + bag), fns };
}

// ---- the experiment ----
type Case = { name: string; a: string; b: string; expect: "EQUAL" | "DIFFER"; probe: string };

const f = (body: string) => `function f${body}`;

const cases: Case[] = [
  { name: "determinism", probe: "same code twice → identical",
    a: f("(a, b) { return a + b; }"), b: f("(a, b) { return a + b; }"), expect: "EQUAL" },
  { name: "local-rename", probe: "rename params/locals → meaning unchanged",
    a: f("(a, b) { const s = a + b; return s; }"), b: f("(x, y) { const z = x + y; return z; }"), expect: "EQUAL" },
  { name: "format/whitespace", probe: "reflow whitespace+newlines → unchanged",
    a: f("(a,b){return a+b;}"), b: f("(a, b) {\n   return a   +   b;\n}"), expect: "EQUAL" },
  { name: "comments", probe: "add comments → unchanged",
    a: f("(a, b) { return a + b; }"), b: f("(a, b) { /* sum */ return a + b; // ret\n}"), expect: "EQUAL" },
  { name: "redundant-parens", probe: "(a+b) vs a+b → unchanged",
    a: f("(a, b) { return a + b; }"), b: f("(a, b) { return (a + b); }"), expect: "EQUAL" },
  { name: "operator-change", probe: "+ → - is a real semantic change",
    a: f("(a, b) { return a + b; }"), b: f("(a, b) { return a - b; }"), expect: "DIFFER" },
  { name: "literal-change", probe: "1 → 2 is a real change",
    a: f("() { return 1; }"), b: f("() { return 2; }"), expect: "DIFFER" },
  { name: "controlflow-change", probe: "adding an if branch is a real change",
    a: f("(a) { return a; }"), b: f("(a) { if (a) return a; return 0; }"), expect: "DIFFER" },
  { name: "type-annotation", probe: "param type is meaning (string vs number)",
    a: f("(a: string) { return a; }"), b: f("(a: number) { return a; }"), expect: "DIFFER" },
  { name: "arg-order", probe: "swap argument order is a real change",
    a: f("(a, b) { return a - b; }"), b: f("(a, b) { return b - a; }"), expect: "DIFFER" },
];

console.log("=".repeat(72));
console.log("WARPLINE AST-ABSORB SOUNDNESS SPIKE — per-function essence properties");
console.log("=".repeat(72));
let pass = 0;
for (const c of cases) {
  const ea = fnEssence(parse(c.a).statements[0]);
  const eb = fnEssence(parse(c.b).statements[0]);
  const got = ea === eb ? "EQUAL" : "DIFFER";
  const ok = got === c.expect;
  if (ok) pass++;
  console.log(`${ok ? "✅" : "❌"}  ${c.name.padEnd(20)} expect ${c.expect.padEnd(6)} got ${got.padEnd(6)}  — ${c.probe}`);
}
console.log(`\n  ${pass}/${cases.length} properties hold for the per-function lens.\n`);

// ---- file-level: reorder invariance (the .purpose "bag" trick) ----
console.log("-".repeat(72));
console.log("FILE-LEVEL: reorder two independent functions");
const fileA = `function alpha(a){return a+1;}\nfunction beta(b){return b*2;}`;
const fileB = `function beta(b){return b*2;}\nfunction alpha(a){return a+1;}`;
const rA = fileEssence(fileA), rB = fileEssence(fileB);
console.log(`  ${rA.state === rB.state ? "✅ EQUAL" : "❌ DIFFER"}  reorder top-level fns → file essence unchanged (bag-of-essences)`);

// ---- THE HARD CASE: cross-symbol rename (free-reference-by-name fails) ----
console.log("-".repeat(72));
console.log("THE HARD CASE — cross-symbol rename (the Unison / hash-by-target frontier)");
const callerBefore = `function f(){ return helper(1); }`;
const callerAfter  = `function f(){ return assist(1); }`; // helper renamed → assist, consistently
const eBefore = fnEssence(parse(callerBefore).statements[0]);
const eAfter  = fnEssence(parse(callerAfter).statements[0]);
console.log(`  caller essence before: ${eBefore}`);
console.log(`  caller essence after : ${eAfter}`);
console.log(`  ${eBefore === eAfter ? "✅ EQUAL (rename was free)" : "⚠️  DIFFER — free-ref-by-NAME moved the essence on a pure rename"}`);
console.log(`     → THIS is the deferred hard part: free references must hash BY TARGET ESSENCE,`);
console.log(`       not by name — exactly what packages/warpline essence-hash already does for .purpose edges.`);
