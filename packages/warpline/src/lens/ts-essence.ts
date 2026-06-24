/**
 * #code-essence — the pure-syntactic Code Canonical Normal Form (CCNF) producer.
 *
 * This is the SYNTACTIC HALF of the lens (spec §3): it computes the essence of
 * one declaration from structure + WRITTEN annotations ALONE. It instantiates
 * NO `ts.Program`/checker — identity-resolution of free references (§4) and the
 * checker-dependent half (§5) are layered on top by `ts-lens.ts`. The honest
 * 10/10 of the spike were exactly this purely-syntactic surface; this file
 * HARDENS it (scope-correct alpha-normalization, the false-EQUAL modifier guard,
 * type-param namespace, literal normalization).
 *
 * Output is a deterministic token STRING for one declaration. Equality of the
 * string is the v1 notion of structural identity modulo names/format/order.
 * Names, formatting, positions, free prose are DROPPED; control flow, operators,
 * literal values, member-access property names, written type annotations, and
 * meaning-bearing modifiers/tokens are KEPT.
 */

import * as ts from 'typescript';

/** A binding's stable coordinate within its OWN scope, by declaration order. */
interface BindingCoord {
  depth: number;
  ordinal: number;
}

/** The three independent identifier namespaces (spec §3.1). */
type NameSpace = 'value' | 'type' | 'label';

/**
 * One lexical scope. `value`/`type`/`label` are independent name→coord maps.
 * `kind` records what kind of scope this is so hoisting can target the nearest
 * FUNCTION scope for `var`/function-declarations while `let`/`const`/`class`
 * land in the nearest BLOCK.
 */
interface Scope {
  kind: 'unit' | 'function' | 'block' | 'catch';
  depth: number;
  parent: Scope | null;
  value: Map<string, BindingCoord>;
  type: Map<string, BindingCoord>;
  label: Map<string, BindingCoord>;
  // Per-namespace running ordinal counters (declaration order within this scope).
  ord: { value: number; type: number; label: number };
}

function nsMap(scope: Scope, ns: NameSpace): Map<string, BindingCoord> {
  return ns === 'value' ? scope.value : ns === 'type' ? scope.type : scope.label;
}

function mkScope(kind: Scope['kind'], depth: number, parent: Scope | null): Scope {
  return {
    kind,
    depth,
    parent,
    value: new Map(),
    type: new Map(),
    label: new Map(),
    ord: { value: 0, type: 0, label: 0 },
  };
}

/** Declare a name in a scope (first declaration wins its ordinal). */
function declare(scope: Scope, ns: NameSpace, name: string): void {
  const map = nsMap(scope, ns);
  if (map.has(name)) return; // re-declaration in the SAME scope keeps the first ordinal
  map.set(name, { depth: scope.depth, ordinal: scope.ord[ns]++ });
}

/** Nearest enclosing FUNCTION-like scope (where `var`/function-decls hoist to). */
function nearestFunctionScope(scope: Scope): Scope {
  let s: Scope | null = scope;
  while (s && s.kind === 'block' && s.parent) s = s.parent;
  return s ?? scope;
}

/** Resolve a use to its binding coord (nearest enclosing, shadowing-correct). */
function resolve(scope: Scope, ns: NameSpace, name: string): BindingCoord | undefined {
  let s: Scope | null = scope;
  while (s) {
    const found = nsMap(s, ns).get(name);
    if (found) return found;
    s = s.parent;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// PASS 1 — build the scope tree honoring JS hoisting.
//
// We attach a Scope to every node that OPENS one, and remember which scope each
// node lexically lives in, so PASS 2 can resolve uses without re-walking.
// ---------------------------------------------------------------------------

interface ScopeModel {
  /** Scope a node's IDENTIFIER USES resolve against (the scope the node sits in). */
  scopeOf: Map<ts.Node, Scope>;
  unitScope: Scope;
}

/** Does this node open its own VALUE scope (a function-like)? */
function isFunctionLike(n: ts.Node): boolean {
  return (
    ts.isFunctionDeclaration(n) ||
    ts.isFunctionExpression(n) ||
    ts.isArrowFunction(n) ||
    ts.isMethodDeclaration(n) ||
    ts.isConstructorDeclaration(n) ||
    ts.isGetAccessorDeclaration(n) ||
    ts.isSetAccessorDeclaration(n)
  );
}

/** Names bound by a binding-name (Identifier | ObjectBinding | ArrayBinding). */
function collectBindingNames(name: ts.BindingName, out: string[]): void {
  if (ts.isIdentifier(name)) {
    out.push(name.text);
  } else if (ts.isObjectBindingPattern(name) || ts.isArrayBindingPattern(name)) {
    for (const el of name.elements) {
      if (ts.isBindingElement(el)) collectBindingNames(el.name, out);
    }
  }
}

function buildScopeModel(unit: ts.Node): ScopeModel {
  const scopeOf = new Map<ts.Node, Scope>();
  const unitScope = mkScope('unit', 0, null);

  // The unit's own params + type-params bind in the unit scope. The unit's own
  // NAME is NOT bound (it is a free symbol to callers — spec §3 "own name → label").
  // Hoist function-scoped declarations (var/function-decl) within `current` first
  // so a use textually preceding the declaration still resolves (hoisting/TDZ
  // structural fidelity — we bind, value-presence is separate).

  const visit = (n: ts.Node, current: Scope) => {
    scopeOf.set(n, current);

    // --- declarations that bind into `current` (or a hoist target) ---

    // Parameters of a function-like bind in THAT function-like's own scope. We
    // handle them when we open the function scope (below), so skip here when the
    // parameter's parent is the function-like whose scope we just opened.

    if (ts.isVariableDeclaration(n)) {
      // Determine var vs let/const from the enclosing VariableDeclarationList flags.
      const list = n.parent && ts.isVariableDeclarationList(n.parent) ? n.parent : undefined;
      const isBlockScoped =
        !!list && (list.flags & (ts.NodeFlags.Let | ts.NodeFlags.Const)) !== 0;
      const target = isBlockScoped ? current : nearestFunctionScope(current);
      const names: string[] = [];
      collectBindingNames(n.name, names);
      for (const nm of names) declare(target, 'value', nm);
    } else if (ts.isFunctionDeclaration(n) && n.name) {
      // function declarations hoist to the nearest function scope.
      declare(nearestFunctionScope(current), 'value', n.name.text);
    } else if (ts.isClassDeclaration(n) && n.name) {
      // class declarations are block-scoped (TDZ), bind in current block.
      declare(current, 'value', n.name.text);
    }

    // --- scope openers ---

    if (isFunctionLike(n)) {
      // Function-likes open a new FUNCTION (value) scope. Params + this-fn's own
      // type-params bind there. (FunctionDeclaration name already hoisted above
      // into the OUTER scope; a named FunctionExpression's name binds INSIDE.)
      const fnScope = mkScope('function', current.depth + 1, current);
      scopeOf.set(n, current); // the function-like NODE itself sits in `current`

      const fnLike = n as ts.FunctionLikeDeclaration;

      // Named function expressions: the name is visible inside its own body.
      if (
        (ts.isFunctionExpression(n) || ts.isFunctionDeclaration(n)) &&
        (n as ts.FunctionExpression | ts.FunctionDeclaration).name &&
        ts.isFunctionExpression(n)
      ) {
        const nm = (n as ts.FunctionExpression).name;
        if (nm) declare(fnScope, 'value', nm.text);
      }

      // Type parameters → the `type` namespace of the function scope.
      const tps = (fnLike as ts.SignatureDeclaration).typeParameters;
      if (tps) {
        for (const tp of tps) declare(fnScope, 'type', tp.name.text);
      }

      // Parameters → the `value` namespace of the function scope.
      for (const p of fnLike.parameters) {
        const names: string[] = [];
        collectBindingNames(p.name, names);
        for (const nm of names) declare(fnScope, 'value', nm);
      }

      // Recurse: type-param constraints/defaults + param types/initializers +
      // body all resolve against fnScope.
      ts.forEachChild(n, (c) => visit(c, fnScope));
      return;
    }

    if (ts.isBlock(n) || ts.isCaseBlock(n) || ts.isModuleBlock(n)) {
      const blockScope = mkScope('block', current.depth + 1, current);
      scopeOf.set(n, current);
      ts.forEachChild(n, (c) => visit(c, blockScope));
      return;
    }

    // for / for-in / for-of open a block scope for their let/const binders.
    if (
      ts.isForStatement(n) ||
      ts.isForInStatement(n) ||
      ts.isForOfStatement(n)
    ) {
      const forScope = mkScope('block', current.depth + 1, current);
      scopeOf.set(n, current);
      ts.forEachChild(n, (c) => visit(c, forScope));
      return;
    }

    if (ts.isCatchClause(n)) {
      const catchScope = mkScope('catch', current.depth + 1, current);
      scopeOf.set(n, current);
      if (n.variableDeclaration) {
        const names: string[] = [];
        collectBindingNames(n.variableDeclaration.name, names);
        for (const nm of names) declare(catchScope, 'value', nm);
      }
      ts.forEachChild(n, (c) => visit(c, catchScope));
      return;
    }

    // Labeled statements declare a label in the current scope.
    if (ts.isLabeledStatement(n)) {
      declare(current, 'label', n.label.text);
    }

    ts.forEachChild(n, (c) => visit(c, current));
  };

  // The unit node itself: open its scope, bind ITS params + type-params here,
  // then walk children against unitScope.
  if (isFunctionLike(unit)) {
    const fnLike = unit as ts.FunctionLikeDeclaration;
    scopeOf.set(unit, unitScope);
    const tps = (fnLike as ts.SignatureDeclaration).typeParameters;
    if (tps) for (const tp of tps) declare(unitScope, 'type', tp.name.text);
    for (const p of fnLike.parameters) {
      const names: string[] = [];
      collectBindingNames(p.name, names);
      for (const nm of names) declare(unitScope, 'value', nm);
    }
    ts.forEachChild(unit, (c) => visit(c, unitScope));
  } else {
    // Class / other: treat the node as a unit scope and walk children.
    scopeOf.set(unit, unitScope);
    ts.forEachChild(unit, (c) => visit(c, unitScope));
  }

  return { scopeOf, unitScope };
}

// ---------------------------------------------------------------------------
// Literal normalization (spec §3.3).
// ---------------------------------------------------------------------------

/**
 * Integers (incl hex/oct/bin) → exact decimal; non-integers → normalized source
 * lexeme (§3.3). MUST be fed the RAW SOURCE TEXT (`node.getText()`), never the
 * scanner-normalized `node.text`: the scanner already collapses `1e-1`→`0.1` and
 * `1.0`→`1`, which would silently IEEE-754-round-trip non-integers. v1 refuses
 * that round-trip, so `0.1` ≠ `1e-1` by design.
 */
function normalizeNumeric(sourceText: string): string {
  const raw = sourceText.replace(/_/g, ''); // numeric separators carry no meaning
  // bigint handled separately (BigIntLiteral). Here: NumericLiteral only.
  // Integer forms: 0x.., 0o.., 0b.., or a pure decimal integer.
  if (/^0[xX][0-9a-fA-F]+$/.test(raw)) return BigInt(raw).toString(10);
  if (/^0[oO][0-7]+$/.test(raw)) return BigInt(raw).toString(10);
  if (/^0[bB][01]+$/.test(raw)) return BigInt(raw).toString(10);
  // Legacy octal (0755) — TS parses it; treat as octal integer.
  if (/^0[0-7]+$/.test(raw)) return BigInt('0o' + raw.slice(1)).toString(10);
  if (/^[0-9]+$/.test(raw)) return BigInt(raw).toString(10); // arbitrary-precision-safe integer
  // Non-integer (has '.', 'e'/'E', or a fractional part): refuse IEEE-754
  // round-trip, keep the source lexeme verbatim (separators stripped only).
  return raw;
}

/**
 * The RAW source lexeme of a numeric literal. `getText()` reads the original
 * span (so `1e-1` stays `1e-1`); falls back to `.text` for synthetic/unparented
 * nodes where `getText()` would throw.
 */
function rawNumericText(n: ts.NumericLiteral): string {
  try {
    const sf = n.getSourceFile();
    if (sf) return n.getText(sf);
  } catch {
    /* synthetic / unparented node — fall through to the scanned text */
  }
  return n.text;
}

/** Raw source lexeme of a bigint literal (parallels `rawNumericText`). */
function rawBigIntText(n: ts.BigIntLiteral): string {
  try {
    const sf = n.getSourceFile();
    if (sf) return n.getText(sf);
  } catch {
    /* synthetic / unparented node */
  }
  return n.text;
}

function normalizeBigInt(text: string): string {
  // text ends with 'n'. May be hex/oct/bin.
  const body = text.slice(0, -1).replace(/_/g, '');
  let v: bigint;
  if (/^0[xX]/.test(body)) v = BigInt(body);
  else if (/^0[oO]/.test(body)) v = BigInt(body);
  else if (/^0[bB]/.test(body)) v = BigInt(body);
  else v = BigInt(body);
  return v.toString(10) + 'n';
}

// ---------------------------------------------------------------------------
// PASS 2 — serialize to the canonical token string.
// ---------------------------------------------------------------------------

export interface CodeCNFOptions {
  /**
   * Classifies a FREE identifier name. Returning `'edge'` strips the name and
   * emits a positional `f:{idx}` token (idx = first-appearance order of the
   * distinct free name) — the lens later resolves these to edges-by-target (§4).
   * Returning `'token'` (or omitting the classifier) emits `free:{name}`, which
   * keeps stage 1 self-contained and spike-equivalent.
   */
  freeRefClassifier?: (name: string) => 'edge' | 'token';
}

/**
 * One free VALUE-namespace reference the body carries, in the SAME positional
 * order the CCNF uses for `f:{idx}` tokens (first-appearance of each distinct
 * free name). `freeRefs[idx]` aligns with the `f:idx` token in the body; `node`
 * is a representative occurrence the lens can hand to the checker for identity
 * resolution (§4). Stage 3 substitutes the resolved essence inline at the
 * positional slot, so this ORDER is meaning — a sorted edge-set would be wrong.
 */
export interface FreeRef {
  /** The free identifier name as written (a LABEL — the lens resolves it). */
  name: string;
  /** A representative occurrence of the free identifier (for checker resolution). */
  node: ts.Identifier;
}

/** The CCNF string plus its positionally-aligned free VALUE references (§4). */
export interface CodeCNFDetailed {
  /** The Code Canonical Normal Form token string (`codeCNF`'s output). */
  cnf: string;
  /** Free value-namespace refs, indexed to match the body's `f:idx` slots. */
  freeRefs: FreeRef[];
}

function op(kind: ts.SyntaxKind): string {
  return ts.tokenToString(kind) ?? ts.SyntaxKind[kind];
}

/**
 * Produce the CCNF token string for one declaration `node`.
 *
 * Thin wrapper over {@link codeCNFDetailed} — returns just the `.cnf`. The
 * stage-1 contract (`codeCNF(node, opts): string`) is unchanged; the detailed
 * form layers the positional free-ref list the lens needs for §4 resolution.
 */
export function codeCNF(node: ts.Node, opts: CodeCNFOptions = {}): string {
  return codeCNFDetailed(node, opts).cnf;
}

/**
 * Produce the CCNF token string AND the positionally-aligned free VALUE
 * references the body carries (§4 frontier-closing input).
 *
 * The single canonical ordering — first-appearance of each DISTINCT free
 * value-namespace name — drives BOTH the `f:{idx}` tokens emitted into the body
 * AND the index into `freeRefs`. So `freeRefs[idx]` is exactly the name behind
 * the `f:idx` token: the lens resolves `freeRefs[idx].node` via the checker and
 * substitutes the resolved target at that positional slot. ALL distinct free
 * names take a slot (a `'token'`-classified name still occupies its
 * first-appearance index and appears in `freeRefs`), but only `'edge'`-classified
 * names are emitted positionally as `f:idx`; `'token'` names are emitted by name
 * as `free:{name}` (stage-1-equivalent), and the lens consults `freeRefs` to map
 * them to extern/builtin/unresolved references at their own index.
 */
export function codeCNFDetailed(node: ts.Node, opts: CodeCNFOptions = {}): CodeCNFDetailed {
  const { scopeOf } = buildScopeModel(node);
  const classifier = opts.freeRefClassifier;

  // Positional free-ref indexing: first distinct free NAME → 0,1,2... This ONE
  // counter is shared by `f:{idx}` tokens AND the `freeRefs` array so they stay
  // perfectly aligned (the lens relies on `freeRefs[idx]` ↔ `f:idx`).
  const freeIndex = new Map<string, number>();
  const freeRefs: FreeRef[] = [];
  const indexOfFree = (id: ts.Identifier): number => {
    const name = id.text;
    let idx = freeIndex.get(name);
    if (idx === undefined) {
      idx = freeRefs.length;
      freeIndex.set(name, idx);
      freeRefs.push({ name, node: id });
    }
    return idx;
  };
  const freeRefToken = (id: ts.Identifier): string => {
    const idx = indexOfFree(id);
    const cls = classifier ? classifier(id.text) : 'token';
    // The positional slot token carries a leading U+001F (unit-separator) control
    // char so it cannot be forged from literal payload: str:/tmpl:/template-span
    // text is emitted via JSON.stringify, which escapes ALL control chars (< 0x20),
    // so a raw U+001F can never appear inside a literal. essence-hash substitutes on
    // the U+001F-anchored token, so a string that happens to read "f:0" is no longer
    // mistaken for slot 0. The readable "f:N" is kept after the sentinel (substring
    // assertions and debug dumps still see "f:N"). MUST match essence-hash.ts. (T-2026-06-24-003)
    if (cls === 'edge') return `\u001Ff:${idx}`;
    return `free:${id.text}`;
  };

  // Identifier serialization: resolve against the scope it sits in.
  const scopeFor = (n: ts.Node): Scope => {
    let cur: ts.Node | undefined = n;
    while (cur) {
      const s = scopeOf.get(cur);
      if (s) return s;
      cur = cur.parent;
    }
    // Should never happen for nodes inside the unit; fall back to a fresh unit.
    return mkScope('unit', 0, null);
  };

  const serializeIdent = (id: ts.Identifier, ns: NameSpace): string => {
    const scope = scopeFor(id);
    const coord = resolve(scope, ns, id.text);
    if (coord) {
      const prefix = ns === 'value' ? 'b' : ns === 'type' ? 't' : 'L';
      return `${prefix}:${coord.depth}:${coord.ordinal}`;
    }
    // Free in the VALUE namespace → classifier-driven. A free TYPE name is a
    // written-annotation token and is kept by name (it is identity-bearing
    // structure, not a local rename target). A free label can't occur.
    if (ns === 'value') return freeRefToken(id);
    if (ns === 'type') return `type:${id.text}`;
    return `label:${id.text}`;
  };

  // The serializer for ARBITRARY value-context nodes.
  const ser = (n: ts.Node): string => serialize(n);

  function serialize(n: ts.Node): string {
    // --- identifiers ---
    if (ts.isIdentifier(n)) return serializeIdent(n, 'value');

    // --- literals (§3.3) ---
    if (ts.isStringLiteralLike(n)) {
      // .text is the DECODED value (escapes already resolved by the scanner).
      return `str:${JSON.stringify(n.text.normalize('NFC'))}`;
    }
    if (ts.isNumericLiteral(n)) return `num:${normalizeNumeric(rawNumericText(n))}`;
    if (ts.isBigIntLiteral(n)) return `big:${normalizeBigInt(rawBigIntText(n))}`;
    if (ts.isRegularExpressionLiteral(n)) return `re:${n.text}`;
    if (n.kind === ts.SyntaxKind.TrueKeyword) return 'true';
    if (n.kind === ts.SyntaxKind.FalseKeyword) return 'false';
    if (n.kind === ts.SyntaxKind.NullKeyword) return 'null';
    if (n.kind === ts.SyntaxKind.ThisKeyword) return 'this';
    if (n.kind === ts.SyntaxKind.SuperKeyword) return 'super';

    // Template literals: structure + chunks (decoded text).
    if (ts.isNoSubstitutionTemplateLiteral(n)) {
      return `tmpl:${JSON.stringify(n.text.normalize('NFC'))}`;
    }
    if (ts.isTemplateExpression(n)) {
      const head = JSON.stringify(n.head.text.normalize('NFC'));
      const spans = n.templateSpans
        .map((sp) => `(span ${serialize(sp.expression)} ${JSON.stringify(sp.literal.text.normalize('NFC'))})`)
        .join(' ');
      return `(tmplx ${head} ${spans})`;
    }

    // --- parentheses: transparent (redundant parens carry no meaning) ---
    if (ts.isParenthesizedExpression(n)) return serialize(n.expression);

    // --- member access (§3 member row) ---
    if (ts.isPropertyAccessExpression(n)) {
      // `?.` vs `.` is meaning (§3.2). questionDotToken present ⇒ optional chain.
      const dot = n.questionDotToken ? '?.' : '.';
      return `(member ${dot} ${serialize(n.expression)} prop:${n.name.text})`;
    }
    if (ts.isElementAccessExpression(n)) {
      const dot = n.questionDotToken ? '?.[]' : '[]';
      return `(elem ${dot} ${serialize(n.expression)} ${serialize(n.argumentExpression)})`;
    }

    // --- call / new (carry optional-chain too) ---
    if (ts.isCallExpression(n)) {
      const q = n.questionDotToken ? '?.()' : '()';
      const typeArgs = n.typeArguments ? n.typeArguments.map(serializeType).join(' ') : '';
      const args = n.arguments.map(serialize).join(' ');
      return `(call ${q} ${serialize(n.expression)} <${typeArgs}> [${args}])`;
    }
    if (ts.isNewExpression(n)) {
      const typeArgs = n.typeArguments ? n.typeArguments.map(serializeType).join(' ') : '';
      const args = n.arguments ? n.arguments.map(serialize).join(' ') : '';
      return `(new ${serialize(n.expression)} <${typeArgs}> [${args}])`;
    }

    // --- operators ---
    if (ts.isBinaryExpression(n)) {
      return `(bin ${op(n.operatorToken.kind)} ${serialize(n.left)} ${serialize(n.right)})`;
    }
    if (ts.isPrefixUnaryExpression(n)) {
      return `(pre ${op(n.operator)} ${serialize(n.operand)})`;
    }
    if (ts.isPostfixUnaryExpression(n)) {
      return `(post ${op(n.operator)} ${serialize(n.operand)})`;
    }
    if (ts.isConditionalExpression(n)) {
      return `(cond ${serialize(n.condition)} ${serialize(n.whenTrue)} ${serialize(n.whenFalse)})`;
    }
    if (ts.isTypeOfExpression(n)) return `(typeof ${serialize(n.expression)})`;
    if (ts.isDeleteExpression(n)) return `(delete ${serialize(n.expression)})`;
    if (ts.isVoidExpression(n)) return `(void ${serialize(n.expression)})`;
    if (ts.isAwaitExpression(n)) return `(await ${serialize(n.expression)})`;
    if (ts.isYieldExpression(n)) {
      const star = n.asteriskToken ? '*' : '';
      const arg = n.expression ? serialize(n.expression) : '';
      return `(yield${star} ${arg})`;
    }
    if (ts.isNonNullExpression(n)) return `(nonnull ${serialize(n.expression)})`;
    if (ts.isAsExpression(n)) return `(as ${serialize(n.expression)} ${serializeType(n.type)})`;
    if (ts.isSatisfiesExpression(n)) {
      return `(satisfies ${serialize(n.expression)} ${serializeType(n.type)})`;
    }
    if (ts.isTypeAssertionExpression(n)) {
      return `(assert ${serializeType(n.type)} ${serialize(n.expression)})`;
    }
    if (ts.isSpreadElement(n)) return `(spread ${serialize(n.expression)})`;

    // --- functions encountered in expression position (nested) ---
    if (isFunctionLike(n)) return serializeFunctionLike(n);

    // --- variable declarations (capture the type annotation + initializer) ---
    if (ts.isVariableDeclaration(n)) {
      const name = serializeBindingName(n.name);
      const typ = n.type ? serializeType(n.type) : 'τ:none';
      const init = n.initializer ? serialize(n.initializer) : 'init:none';
      const definite = n.exclamationToken ? '!' : ''; // definite-assignment (§3.2)
      return `(vardecl${definite} ${name} ${typ} ${init})`;
    }
    if (ts.isVariableDeclarationList(n)) {
      const flavor =
        (n.flags & ts.NodeFlags.Const) !== 0
          ? 'const'
          : (n.flags & ts.NodeFlags.Let) !== 0
            ? 'let'
            : 'var';
      return `(varlist:${flavor} ${n.declarations.map(serialize).join(' ')})`;
    }

    // --- property assignments in object literals: key is identity-bearing ---
    if (ts.isPropertyAssignment(n)) {
      return `(prop ${serializePropertyName(n.name)} ${serialize(n.initializer)})`;
    }
    if (ts.isShorthandPropertyAssignment(n)) {
      return `(shorthand ${serializeIdent(n.name, 'value')})`;
    }
    if (ts.isSpreadAssignment(n)) {
      return `(spreadprop ${serialize(n.expression)})`;
    }

    // --- labeled / break / continue carry their label in the label namespace ---
    if (ts.isLabeledStatement(n)) {
      return `(labeled ${serializeIdent(n.label, 'label')} ${serialize(n.statement)})`;
    }
    if (ts.isBreakStatement(n)) {
      return `(break ${n.label ? serializeIdent(n.label, 'label') : '-'})`;
    }
    if (ts.isContinueStatement(n)) {
      return `(continue ${n.label ? serializeIdent(n.label, 'label') : '-'})`;
    }

    // --- switch: preserve CASE ORDER (fallthrough is meaning, §3) ---
    if (ts.isSwitchStatement(n)) {
      const clauses = n.caseBlock.clauses
        .map((c) => {
          if (ts.isCaseClause(c)) {
            return `(case ${serialize(c.expression)} [${c.statements.map(serialize).join(' ')}])`;
          }
          return `(default [${c.statements.map(serialize).join(' ')}])`;
        })
        .join(' ');
      return `(switch ${serialize(n.expression)} ${clauses})`;
    }

    // --- type-bearing nodes that appear in value walks ---
    if (ts.isTypeQueryNode(n) || ts.isTypeNode(n)) {
      return serializeType(n as ts.TypeNode);
    }

    // --- default: kind + ordered semantic children ---
    const parts: string[] = [];
    ts.forEachChild(n, (c) => {
      parts.push(ser(c));
    });
    return parts.length ? `(${ts.SyntaxKind[n.kind]} ${parts.join(' ')})` : `(${ts.SyntaxKind[n.kind]})`;
  }

  // --- binding names (destructuring) — bound names → indices; keys kept ---
  function serializeBindingName(name: ts.BindingName): string {
    if (ts.isIdentifier(name)) return serializeIdent(name, 'value');
    if (ts.isObjectBindingPattern(name)) {
      const els = name.elements
        .map((el) => {
          const key = el.propertyName ? serializePropertyName(el.propertyName) : '-';
          const dots = el.dotDotDotToken ? '...' : '';
          const target = serializeBindingName(el.name);
          const def = el.initializer ? `=${serialize(el.initializer)}` : '';
          return `(obel ${dots}${key} ${target}${def})`;
        })
        .join(' ');
      return `(objpat ${els})`;
    }
    if (ts.isArrayBindingPattern(name)) {
      const els = name.elements
        .map((el) => {
          if (ts.isOmittedExpression(el)) return '(hole)';
          const dots = el.dotDotDotToken ? '...' : '';
          const target = serializeBindingName(el.name);
          const def = el.initializer ? `=${serialize(el.initializer)}` : '';
          return `(arel ${dots}${target}${def})`;
        })
        .join(' ');
      return `(arrpat ${els})`;
    }
    return '(bind?)';
  }

  // --- property names: computed keys keep their expression; identifiers/strings
  //     keep their textual key (identity-bearing source-read, §3.1). ---
  function serializePropertyName(name: ts.PropertyName): string {
    if (ts.isIdentifier(name)) return `k:${name.text}`;
    if (ts.isStringLiteralLike(name)) return `k:${JSON.stringify(name.text.normalize('NFC'))}`;
    if (ts.isNumericLiteral(name)) return `k:${normalizeNumeric(rawNumericText(name))}`;
    if (ts.isComputedPropertyName(name)) return `kc:${serialize(name.expression)}`;
    if (ts.isPrivateIdentifier(name)) return `kp:${name.text}`;
    return 'k:?';
  }

  // --- WRITTEN type annotations (§3, §5.1): token structure ONLY, never inferred.
  //     Type-param names → `t:` indices; union/intersection sorted; tuples ordered. ---
  function serializeType(t: ts.TypeNode | undefined): string {
    if (!t) return 'τ:none';
    switch (t.kind) {
      case ts.SyntaxKind.AnyKeyword:
        return 'τ:any';
      case ts.SyntaxKind.UnknownKeyword:
        return 'τ:unknown';
      case ts.SyntaxKind.NumberKeyword:
        return 'τ:number';
      case ts.SyntaxKind.StringKeyword:
        return 'τ:string';
      case ts.SyntaxKind.BooleanKeyword:
        return 'τ:boolean';
      case ts.SyntaxKind.VoidKeyword:
        return 'τ:void';
      case ts.SyntaxKind.UndefinedKeyword:
        return 'τ:undefined';
      case ts.SyntaxKind.NullKeyword:
        return 'τ:null';
      case ts.SyntaxKind.NeverKeyword:
        return 'τ:never';
      case ts.SyntaxKind.ObjectKeyword:
        return 'τ:object';
      case ts.SyntaxKind.SymbolKeyword:
        return 'τ:symbol';
      case ts.SyntaxKind.BigIntKeyword:
        return 'τ:bigint';
    }
    if (ts.isTypeReferenceNode(t)) {
      const name = serializeEntityName(t.typeName);
      const args = t.typeArguments ? t.typeArguments.map(serializeType).join(' ') : '';
      return `(τref ${name} <${args}>)`;
    }
    if (ts.isArrayTypeNode(t)) return `(τarr ${serializeType(t.elementType)})`;
    if (ts.isTupleTypeNode(t)) {
      return `(τtuple ${t.elements.map((e) => serializeType(e as ts.TypeNode)).join(' ')})`;
    }
    if (ts.isUnionTypeNode(t)) {
      const members = t.types.map(serializeType).sort();
      return `(τunion ${members.join(' ')})`;
    }
    if (ts.isIntersectionTypeNode(t)) {
      const members = t.types.map(serializeType).sort();
      return `(τand ${members.join(' ')})`;
    }
    if (ts.isParenthesizedTypeNode(t)) return serializeType(t.type);
    if (ts.isLiteralTypeNode(t)) {
      return `(τlit ${serialize(t.literal)})`;
    }
    if (ts.isFunctionTypeNode(t) || ts.isConstructorTypeNode(t)) {
      const tps = t.typeParameters
        ? t.typeParameters.map((tp) => serializeTypeParam(tp)).join(' ')
        : '';
      const ps = t.parameters.map((p) => serializeParamType(p)).join(' ');
      const ret = serializeType(t.type);
      const tag = ts.isConstructorTypeNode(t) ? 'τctor' : 'τfn';
      return `(${tag} <${tps}> [${ps}] ${ret})`;
    }
    if (ts.isTypeOperatorNode(t)) {
      return `(τop ${op(t.operator)} ${serializeType(t.type)})`;
    }
    if (ts.isIndexedAccessTypeNode(t)) {
      return `(τindex ${serializeType(t.objectType)} ${serializeType(t.indexType)})`;
    }
    if (ts.isTypePredicateNode(t)) {
      const asserts = t.assertsModifier ? 'asserts ' : '';
      const param =
        ts.isIdentifier(t.parameterName)
          ? serializeIdent(t.parameterName, 'value')
          : 'this';
      const typ = t.type ? serializeType(t.type) : '';
      return `(τpred ${asserts}${param} ${typ})`;
    }
    if (ts.isTypeQueryNode(t)) {
      return `(τquery ${serializeEntityName(t.exprName)})`;
    }
    if (ts.isTypeLiteralNode(t)) {
      const members = t.members.map(serializeTypeMember).sort();
      return `(τobj ${members.join(' ')})`;
    }
    // Fallback: kind + children, type-aware where possible.
    const parts: string[] = [];
    ts.forEachChild(t, (c) => {
      parts.push(ts.isTypeNode(c) ? serializeType(c) : serialize(c));
    });
    return `(τ:${ts.SyntaxKind[t.kind]} ${parts.join(' ')})`;
  }

  function serializeTypeMember(m: ts.TypeElement): string {
    if (ts.isPropertySignature(m)) {
      const q = m.questionToken ? '?' : '';
      const ro = hasModifier(m, ts.SyntaxKind.ReadonlyKeyword) ? 'readonly ' : '';
      return `(τprop ${ro}${serializePropertyName(m.name)}${q} ${serializeType(m.type)})`;
    }
    if (ts.isMethodSignature(m)) {
      const q = m.questionToken ? '?' : '';
      const ps = m.parameters.map(serializeParamType).join(' ');
      return `(τmethod ${serializePropertyName(m.name)}${q} [${ps}] ${serializeType(m.type)})`;
    }
    if (ts.isIndexSignatureDeclaration(m)) {
      const ps = m.parameters.map(serializeParamType).join(' ');
      return `(τindexsig [${ps}] ${serializeType(m.type)})`;
    }
    const parts: string[] = [];
    ts.forEachChild(m, (c) => {
      parts.push(ts.isTypeNode(c) ? serializeType(c) : serialize(c));
    });
    return `(τmem:${ts.SyntaxKind[m.kind]} ${parts.join(' ')})`;
  }

  function serializeEntityName(name: ts.EntityName | ts.Identifier): string {
    if (ts.isIdentifier(name)) {
      // A type-name may resolve to a type-param (→ `t:` index) or be a free
      // written type token (kept by name — identity-bearing).
      const scope = scopeFor(name);
      const coord = resolve(scope, 'type', name.text);
      if (coord) return `t:${coord.depth}:${coord.ordinal}`;
      return `τn:${name.text}`;
    }
    return `(qname ${serializeEntityName(name.left)} ${name.right.text})`;
  }

  function serializeTypeParam(tp: ts.TypeParameterDeclaration): string {
    // The PARAM NAME is alpha-normalized to its `t:` index; constraint/default
    // are written-annotation structure.
    const idx = serializeEntityName(tp.name);
    const constraint = tp.constraint ? serializeType(tp.constraint) : '-';
    const def = tp.default ? serializeType(tp.default) : '-';
    return `(tparam ${idx} ${constraint} ${def})`;
  }

  // --- parameter (value-context): the false-EQUAL hot zone (§3.2). ---
  function serializeParam(p: ts.ParameterDeclaration): string {
    const rest = p.dotDotDotToken ? '...' : ''; // rest (§3.2)
    const opt = p.questionToken ? '?' : ''; // optional `?` (§3.2)
    const name = serializeBindingName(p.name);
    const typ = p.type ? serializeType(p.type) : 'τ:none';
    // default-PRESENCE is meaning; the default VALUE is also meaning (§3.2).
    const def = p.initializer ? `=${serialize(p.initializer)}` : '';
    const ro = hasModifier(p, ts.SyntaxKind.ReadonlyKeyword) ? 'readonly ' : '';
    return `(param ${ro}${rest}${name}${opt} ${typ}${def})`;
  }

  // Parameter inside a TYPE position (no initializer body of interest).
  function serializeParamType(p: ts.ParameterDeclaration): string {
    const rest = p.dotDotDotToken ? '...' : '';
    const opt = p.questionToken ? '?' : '';
    const name = ts.isIdentifier(p.name) ? `pn:${p.name.text}` : serializeBindingName(p.name);
    const typ = p.type ? serializeType(p.type) : 'τ:none';
    return `(τparam ${rest}${name}${opt} ${typ})`;
  }

  function hasModifier(n: ts.Node, kind: ts.SyntaxKind): boolean {
    const mods = ts.canHaveModifiers(n) ? ts.getModifiers(n) : undefined;
    return !!mods && mods.some((m) => m.kind === kind);
  }

  // --- the function-like serializer: the false-EQUAL guard lives here (§3.2) ---
  function serializeFunctionLike(n: ts.Node): string {
    const fn = n as ts.FunctionLikeDeclaration;

    // Modifier/token flags — each MUST distinguish a node from its counterpart.
    const async = hasModifier(n, ts.SyntaxKind.AsyncKeyword) ? 'async' : '-';
    const star =
      (ts.isFunctionDeclaration(n) ||
        ts.isFunctionExpression(n) ||
        ts.isMethodDeclaration(n)) &&
      (n as ts.FunctionDeclaration | ts.MethodDeclaration).asteriskToken
        ? '*'
        : '-';
    const stat = hasModifier(n, ts.SyntaxKind.StaticKeyword) ? 'static' : '-';
    const abstract = hasModifier(n, ts.SyntaxKind.AbstractKeyword) ? 'abstract' : '-';

    // Accessor get/set is a NODE-KIND distinction (a getter ≠ a method, §3.2).
    let formKind: string;
    if (ts.isGetAccessorDeclaration(n)) formKind = 'get';
    else if (ts.isSetAccessorDeclaration(n)) formKind = 'set';
    else if (ts.isConstructorDeclaration(n)) formKind = 'ctor';
    else if (ts.isMethodDeclaration(n)) formKind = 'method';
    else if (ts.isArrowFunction(n)) formKind = 'arrow';
    else if (ts.isFunctionExpression(n)) formKind = 'fnexpr';
    else formKind = 'fndecl';

    const tps = (fn as ts.SignatureDeclaration).typeParameters;
    const typeParams = tps ? tps.map(serializeTypeParam).join(' ') : '';
    const params = fn.parameters.map(serializeParam).join(' ');
    const ret = fn.type ? serializeType(fn.type) : 'τ:none';

    let body = 'body:none';
    if (fn.body) {
      if (ts.isBlock(fn.body)) {
        body = `(block ${fn.body.statements.map(serialize).join(' ')})`;
      } else {
        // arrow with expression body
        body = `(expr ${serialize(fn.body)})`;
      }
    }

    return (
      `(fn:${formKind} ${async} ${star} ${stat} ${abstract} ` +
      `<${typeParams}> [${params}] ${ret} ${body})`
    );
  }

  // --- directive comments (§3 table): @ts-ignore / @ts-expect-error / @ts-nocheck
  //     change what compiles → identity-bearing. Free prose is dropped. ---
  function collectDirectiveComments(unit: ts.Node): string {
    const sf = unit.getSourceFile();
    if (!sf) return '';
    const full = sf.text;
    const found: string[] = [];
    const ranges = ts.getLeadingCommentRanges(full, unit.getFullStart()) ?? [];
    for (const r of ranges) {
      const text = full.slice(r.pos, r.end);
      const m = text.match(/@ts-(ignore|expect-error|nocheck)/);
      if (m) found.push(`@ts-${m[1]}`);
      if (/eslint-disable/.test(text)) found.push('eslint-disable');
    }
    return found.length ? ` directives:[${found.sort().join(',')}]` : '';
  }

  // ENTRY: serialize the unit. Function-likes go through the guard path; a class
  // or other declaration goes through the generic serializer (don't crash).
  const directives = collectDirectiveComments(node);
  const core = isFunctionLike(node) ? serializeFunctionLike(node) : serialize(node);
  return { cnf: core + directives, freeRefs };
}
