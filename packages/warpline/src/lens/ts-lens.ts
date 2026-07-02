/**
 * #ts-lens — the TS/TSX code-lens (spec §4, §5): lifts a directory of TS into
 * `CodeUnit[]` with checker-RESOLVED free references.
 *
 * This is the CHECKER-DEPENDENT half of the lens. `ts-essence.ts` (stage 1) is
 * the pure-syntactic CCNF producer; this layer instantiates ONE `ts.Program`
 * over the source tree and uses the checker for exactly one question —
 * "which declaration does this free name bind to" (§5.1, identity resolution
 * ONLY, never inferred types) — then aligns the resolved targets to the body's
 * positional `f:idx` slots so stage-3 substitution preserves call order (which
 * is meaning).
 *
 * The three determinism rules (§5) are enforced here:
 *   - §5.1 — checker is used for identity resolution only; written annotations
 *            are hashed syntactically by `ts-essence.ts`, inferred types never.
 *   - §5.2 — TypeScript is exact-pinned (package.json) and a FIXED, HARDCODED
 *            compiler-options baseline drives the Program (we do NOT read a
 *            discovered tsconfig); `TS_LENS_VERSION` stamps the compiler.
 *   - §5.3 — external ids are derived from the SYNTACTIC import statement
 *            (specifier-as-written + exported name), never checker module
 *            resolution / resolved path / installed version — stays deterministic
 *            even with no node_modules.
 */

import * as ts from 'typescript';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import type { CodeLens, CodeUnit, CodeRef, CodeEdgeKind } from './code-lens.js';
import { codeSymbol, codeStableKey } from './code-symbol.js';
import { codeCNFDetailed } from './ts-essence.js';

/**
 * The exact pinned TypeScript version (§5.2). Stage 3 stamps this into the
 * essence version tag (`essence:<algo>:ts<exact>:`, e.g. `essence:v1.1:ts5.9.3:`
 * — algo axis from `CCNF_ALGO_VERSION` in `ts-essence.ts`) so a different
 * compiler OR a different serialization algorithm is an explicitly different
 * content-address namespace — never a silent collision.
 */
export const TS_LENS_VERSION: string = ts.version;

/**
 * The FIXED, HARDCODED compiler-options baseline (§5.2). Identity-bearing
 * resolution MUST NOT depend on a discovered `tsconfig` — tsconfig affects what
 * parses, not how we normalize. `noEmit` (read-only), `skipLibCheck` (we never
 * surface diagnostics), `allowJs: false` (TS/TSX only — v1 ceiling §11).
 */
const BASELINE_COMPILER_OPTIONS: ts.CompilerOptions = {
  target: ts.ScriptTarget.ESNext,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  strict: true,
  skipLibCheck: true,
  noEmit: true,
  allowJs: false,
};

const TS_EXTENSIONS = ['.ts', '.tsx'] as const;

/** Directories we never descend into when enumerating source files. */
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.next', 'coverage']);

/** Declaration-file suffix check (`.d.ts` / `.d.tsx` / `.d.mts` / `.d.cts`). */
function isDeclarationFile(fileName: string): boolean {
  return /\.d\.[cm]?tsx?$/.test(fileName);
}

/**
 * Enumerate `.ts`/`.tsx` files under `rootDir`, SORTED (determinism §5). `.d.ts`
 * files are excluded — they declare types, not liftable code-units.
 */
async function enumerateSourceFiles(rootDir: string): Promise<string[]> {
  const out: string[] = [];
  const walk = async (dir: string): Promise<void> => {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (SKIP_DIRS.has(e.name)) continue;
        await walk(full);
      } else if (e.isFile()) {
        const ext = path.extname(e.name);
        if ((TS_EXTENSIONS as readonly string[]).includes(ext) && !isDeclarationFile(e.name)) {
          out.push(full);
        }
      }
    }
  };
  await walk(rootDir);
  // Sort by absolute path — deterministic, locale-independent (default codepoint).
  out.sort();
  return out;
}

/** A code-unit declaration node we lift, paired with its identity. */
interface UnitDecl {
  node: ts.Node; // the declaration to compute essence over
  qualifiedName: string;
  structuralPath: string;
  /** Whether this is a class declaration (its `references` are member/heritage). */
  isClass: boolean;
}

/**
 * A syntactic import binding: the local name → the specifier text AS WRITTEN +
 * the exported name (§5.3). `exportName` is `default` for default imports and
 * the bound name's source export for named imports; namespace imports record
 * `*` and the member is appended at the property-access site (handled by the
 * resolver via the bound name → namespace fallback).
 */
interface ImportBinding {
  specifier: string;
  exportName: string;
}

/**
 * Build the per-source-file map of import-bound local names → `ImportBinding`,
 * derived PURELY from the syntactic import statements (§5.3 — never checker
 * module resolution). Handles: default, named (incl. `as` aliases), and
 * namespace (`* as ns`) imports, plus `import x = require('...')`.
 */
function buildImportMap(sf: ts.SourceFile): Map<string, ImportBinding> {
  const map = new Map<string, ImportBinding>();
  for (const stmt of sf.statements) {
    if (ts.isImportDeclaration(stmt) && ts.isStringLiteral(stmt.moduleSpecifier)) {
      const specifier = stmt.moduleSpecifier.text;
      const clause = stmt.importClause;
      if (!clause) continue;
      // `import Default from '...'`
      if (clause.name) {
        map.set(clause.name.text, { specifier, exportName: 'default' });
      }
      const bindings = clause.namedBindings;
      if (bindings) {
        if (ts.isNamespaceImport(bindings)) {
          // `import * as ns from '...'` — record the namespace local name.
          map.set(bindings.name.text, { specifier, exportName: '*' });
        } else if (ts.isNamedImports(bindings)) {
          for (const el of bindings.elements) {
            // `import { exported as local }` — exportName is the SOURCE name.
            const exportName = el.propertyName ? el.propertyName.text : el.name.text;
            map.set(el.name.text, { specifier, exportName });
          }
        }
      }
    } else if (
      ts.isImportEqualsDeclaration(stmt) &&
      ts.isExternalModuleReference(stmt.moduleReference) &&
      ts.isStringLiteral(stmt.moduleReference.expression)
    ) {
      // `import x = require('...')` — the whole module bound to `x`.
      map.set(stmt.name.text, {
        specifier: stmt.moduleReference.expression.text,
        exportName: '*',
      });
    }
  }
  return map;
}

/** `extern:<specifier-as-written>#<exportName>` (§5.3). */
function externId(b: ImportBinding): string {
  return 'extern:' + b.specifier + '#' + b.exportName;
}

/**
 * Classify a free identifier's syntactic role → `calls` / `reads` / `types`
 * (§4 edgeKind). A reference in call position is `calls`; everything else in
 * value position is `reads`. (Type references are resolved separately and not
 * part of the VALUE-namespace `freeRefs`, so `types` is reserved for that path.)
 */
function edgeKindOf(id: ts.Identifier): CodeEdgeKind {
  // If the identifier is the expression head of a call, it's a `calls` edge;
  // any other value-position use is a `reads` edge. (`types` is reserved for the
  // type-namespace resolution path, which is not part of VALUE `freeRefs`.)
  const parent = id.parent;
  if (parent && ts.isCallExpression(parent) && parent.expression === id) return 'calls';
  return 'reads';
}

/** Is a class member a liftable function-like code-unit? */
function isLiftableMember(m: ts.ClassElement): boolean {
  return (
    ts.isMethodDeclaration(m) ||
    ts.isConstructorDeclaration(m) ||
    ts.isGetAccessorDeclaration(m) ||
    ts.isSetAccessorDeclaration(m) ||
    // arrow/function-expression bound to a class field
    (ts.isPropertyDeclaration(m) &&
      !!m.initializer &&
      (ts.isArrowFunction(m.initializer) || ts.isFunctionExpression(m.initializer)))
  );
}

/** A property name's textual label (for qualifiedName / structuralPath). */
function memberNameLabel(name: ts.PropertyName | undefined): string {
  if (!name) return 'anonymous';
  if (ts.isIdentifier(name) || ts.isPrivateIdentifier(name)) return name.text;
  if (ts.isStringLiteralLike(name)) return name.text;
  if (ts.isNumericLiteral(name)) return name.text;
  if (ts.isComputedPropertyName(name)) return '[computed]';
  return 'anonymous';
}

/** The structural-kind segment used in a structuralPath chain. */
function memberKindSegment(m: ts.ClassElement): string {
  if (ts.isConstructorDeclaration(m)) return 'ctor';
  if (ts.isGetAccessorDeclaration(m)) return 'get';
  if (ts.isSetAccessorDeclaration(m)) return 'set';
  if (ts.isMethodDeclaration(m)) return 'method';
  if (ts.isPropertyDeclaration(m)) return 'field';
  return 'member';
}

/**
 * Collect the liftable code-units in a SourceFile, with their qualified names
 * and structural paths. Walks top-level statements (functions, arrow/fn-expr
 * consts, classes) and, for classes, their liftable members.
 *
 * Overload handling (honest): TypeScript represents an overload set as multiple
 * `FunctionDeclaration` nodes sharing a name, with at most ONE bearing a body.
 * v1 lifts the IMPLEMENTATION signature (the one with a body) as the unit for
 * that `(name, kind)`; bodiless overload signatures are skipped (their meaning
 * is the implementation's). A default export gets `qualifiedName = 'default'`.
 */
function collectUnits(sf: ts.SourceFile): UnitDecl[] {
  const units: UnitDecl[] = [];
  // Top-level structural ordinals are assigned in source order per kind-agnostic
  // sibling index so the structuralPath is stable and reorder-sensitive-by-design.
  let topOrdinal = 0;

  for (const stmt of sf.statements) {
    const ord = topOrdinal++;

    // function declarations (incl. default-export function)
    if (ts.isFunctionDeclaration(stmt)) {
      if (!stmt.body) continue; // bodiless overload signature — skip (see docstring)
      const isDefault = hasModifierKind(stmt, ts.SyntaxKind.DefaultKeyword);
      const name = isDefault ? 'default' : stmt.name?.text ?? 'default';
      units.push({
        node: stmt,
        qualifiedName: name,
        structuralPath: `fn#${ord}`,
        isClass: false,
      });
      continue;
    }

    // const/let bound arrow or function-expression
    if (ts.isVariableStatement(stmt)) {
      let declOrdinal = 0;
      for (const decl of stmt.declarationList.declarations) {
        const dOrd = declOrdinal++;
        if (
          decl.initializer &&
          (ts.isArrowFunction(decl.initializer) || ts.isFunctionExpression(decl.initializer)) &&
          ts.isIdentifier(decl.name)
        ) {
          units.push({
            node: decl.initializer,
            qualifiedName: decl.name.text,
            structuralPath: `const#${ord}.${dOrd}`,
            isClass: false,
          });
        }
      }
      continue;
    }

    // export default <arrow|fnexpr>  → qualifiedName 'default'
    if (ts.isExportAssignment(stmt) && !stmt.isExportEquals) {
      const expr = stmt.expression;
      if (ts.isArrowFunction(expr) || ts.isFunctionExpression(expr)) {
        units.push({
          node: expr,
          qualifiedName: 'default',
          structuralPath: `default#${ord}`,
          isClass: false,
        });
      }
      continue;
    }

    // class declaration → the class is a unit; its members are units too.
    if (ts.isClassDeclaration(stmt)) {
      const isDefault = hasModifierKind(stmt, ts.SyntaxKind.DefaultKeyword);
      const className = isDefault && !stmt.name ? 'default' : stmt.name?.text ?? 'default';
      const classStruct = `class#${ord}`;
      units.push({
        node: stmt,
        qualifiedName: className,
        structuralPath: classStruct,
        isClass: true,
      });
      let memberOrdinal = 0;
      for (const m of stmt.members) {
        const mOrd = memberOrdinal++;
        if (!isLiftableMember(m)) continue;
        const seg = memberKindSegment(m);
        const memberName = ts.isConstructorDeclaration(m)
          ? 'constructor'
          : memberNameLabel(m.name as ts.PropertyName | undefined);
        // The essence node: for a property-bound arrow/fn, the initializer.
        let node: ts.Node = m;
        if (ts.isPropertyDeclaration(m) && m.initializer) node = m.initializer;
        units.push({
          node,
          qualifiedName: `${className}.${memberName}`,
          structuralPath: `${classStruct}/${seg}#${mOrd}`,
          isClass: false,
        });
      }
      continue;
    }
  }

  return units;
}

function hasModifierKind(n: ts.Node, kind: ts.SyntaxKind): boolean {
  const mods = ts.canHaveModifiers(n) ? ts.getModifiers(n) : undefined;
  return !!mods && mods.some((m) => m.kind === kind);
}

/**
 * The TS/TSX code-lens. Builds one `ts.Program` over the sorted source tree
 * against the fixed compiler baseline, then lifts each code-unit with its CCNF
 * essence and checker-resolved, positionally-aligned references.
 */
export class TsLens implements CodeLens {
  readonly extensions: readonly string[] = TS_EXTENSIONS;

  async lift(rootDir: string): Promise<CodeUnit[]> {
    const root = path.resolve(rootDir);
    const files = await enumerateSourceFiles(root);

    const program = ts.createProgram({
      rootNames: files,
      options: BASELINE_COMPILER_OPTIONS,
    });
    const checker = program.getTypeChecker();

    // PASS A — collect every liftable unit across all source files, and build a
    // declaration-node → code-unit-symbol map for local (case-a) resolution.
    interface FileUnits {
      sf: ts.SourceFile;
      relPath: string;
      units: UnitDecl[];
      imports: Map<string, ImportBinding>;
    }
    const fileUnits: FileUnits[] = [];
    const declToSymbol = new Map<ts.Declaration, string>();

    for (const abs of files) {
      const sf = program.getSourceFile(abs);
      if (!sf) continue;
      const relPath = toRel(root, abs);
      const units = collectUnits(sf);
      for (const u of units) {
        const sym = codeSymbol(relPath, u.qualifiedName);
        // Map the declaration NODE the unit was lifted from to its symbol. For
        // a function/class declaration this is `u.node`; for an arrow-const the
        // unit node is the initializer, but the checker resolves a use to the
        // VariableDeclaration — so map that too.
        registerDecl(declToSymbol, u.node, sym);
      }
      fileUnits.push({ sf, relPath, units, imports: buildImportMap(sf) });
    }

    // PASS B — compute essence + aligned references for each unit.
    const out: CodeUnit[] = [];
    for (const fu of fileUnits) {
      for (const u of fu.units) {
        out.push(
          this.liftUnit(u, fu.relPath, fu.imports, checker, root, declToSymbol),
        );
      }
    }

    // Determinism (§5): stable order by symbol key.
    out.sort((a, b) => (a.symbol < b.symbol ? -1 : a.symbol > b.symbol ? 1 : 0));
    return out;
  }

  private liftUnit(
    u: UnitDecl,
    relPath: string,
    imports: Map<string, ImportBinding>,
    checker: ts.TypeChecker,
    root: string,
    declToSymbol: Map<ts.Declaration, string>,
  ): CodeUnit {
    const references: CodeRef[] = [];
    let reducedFidelity = false;

    // Build the classifier + the per-index resolution TOGETHER. The classifier
    // is called for the SAME free names, in first-appearance order, that
    // populate `freeRefs` — so `references[idx]` aligns with `freeRefs[idx]`.
    // We resolve eagerly here (closing over `references`); the classifier only
    // needs to return edge/token, which we derive from the resolution.
    const detailed = codeCNFDetailed(u.node, {
      freeRefClassifier: () => 'edge', // placeholder; real classification below
    });

    // `detailed.freeRefs[idx]` ↔ `f:idx`. Resolve EACH, in order, building both
    // the references array AND re-deriving the cnf with a resolution-aware
    // classifier so `'token'`-classified names emit `free:name` (not `f:idx`).
    const classification: Array<'edge' | 'token'> = [];
    for (const fr of detailed.freeRefs) {
      const ref = this.resolveRef(fr.name, fr.node, imports, checker, root, declToSymbol);
      references.push(ref);
      classification.push(ref.kind === 'local' ? 'edge' : 'token');
      if (ref.kind === 'unresolved') reducedFidelity = true;
    }

    // Re-emit the CCNF with the resolution-aware classifier. Same first-appearance
    // ordering ⇒ the classifier sees names in the same index order; we map name
    // → classification by index.
    const nameToClass = new Map<string, 'edge' | 'token'>();
    detailed.freeRefs.forEach((fr, i) => nameToClass.set(fr.name, classification[i]));
    const finalCnf = codeCNFDetailed(u.node, {
      freeRefClassifier: (name) => nameToClass.get(name) ?? 'token',
    }).cnf;

    return {
      symbol: codeSymbol(relPath, u.qualifiedName),
      qualifiedName: u.qualifiedName,
      filePath: relPath,
      structuralPath: u.structuralPath,
      stableKey: codeStableKey(relPath, u.structuralPath),
      componentType: 'code-unit',
      codeEssence: finalCnf,
      references,
      ...(reducedFidelity ? { reducedFidelity: true } : {}),
    };
  }

  /**
   * Resolve a single free VALUE reference to one of the four §4 classes. The
   * ORDER of checks is the determinism contract:
   *   1. SYNTACTIC import (§5.3) — extern, derived from source text.
   *   2. checker resolution to a lifted local code-unit — local edge (§4a).
   *   3. checker resolution to a TS lib `.d.ts` — builtin (§4c).
   *   4. otherwise — builtin if a global symbol resolves, else unresolved (§4d).
   */
  private resolveRef(
    name: string,
    node: ts.Identifier,
    imports: Map<string, ImportBinding>,
    checker: ts.TypeChecker,
    root: string,
    declToSymbol: Map<ts.Declaration, string>,
  ): CodeRef {
    // 1. Imported name → extern id from the SYNTACTIC import (§5.3). This wins
    //    over checker module resolution by design — deterministic, node_modules-free.
    const imp = imports.get(name);
    if (imp) {
      return { kind: 'extern', id: externId(imp) };
    }

    // 2/3/4 — resolve via the checker (identity resolution ONLY, §5.1).
    let symbol = checker.getSymbolAtLocation(node);
    if (symbol && (symbol.flags & ts.SymbolFlags.Alias) !== 0) {
      // import aliases: follow to the aliased target.
      try {
        symbol = checker.getAliasedSymbol(symbol);
      } catch {
        /* keep the alias symbol if dealiasing fails */
      }
    }

    if (!symbol) {
      return { kind: 'unresolved', name };
    }

    const decls = symbol.declarations ?? [];
    if (decls.length === 0) {
      // A symbol with no declarations is a synthesized global (e.g. some
      // intrinsics) → treat as builtin.
      return { kind: 'builtin', name };
    }

    // Is ANY declaration a lifted local code-unit under rootDir?
    for (const d of decls) {
      const localSym = matchLocalDecl(d, declToSymbol);
      if (localSym) {
        return { kind: 'local', edgeKind: edgeKindOf(node), target: localSym };
      }
    }

    // Declared in a file under rootDir but NOT a lifted code-unit (e.g. a plain
    // const/import binding), OR declared in a lib/external .d.ts → builtin.
    const firstDecl = decls[0];
    const declFile = firstDecl.getSourceFile().fileName;
    const declAbs = path.resolve(declFile);
    const underRoot = isUnderRoot(root, declAbs);

    if (!underRoot) {
      // Declared outside rootDir. If it's a TS lib file → builtin; else it's an
      // external module the source reaches without a local import statement
      // (rare — e.g. a global from @types) → builtin (version-unpinned, §4c).
      return { kind: 'builtin', name };
    }

    // Under rootDir but not a code-unit we lift (a module-local non-function
    // binding). v1 lifts function-granularity meaning only; treat as builtin-like
    // local token (not an edge to a code-unit). Honest: it is not unresolved.
    return { kind: 'builtin', name };
  }
}

/** Register a unit's declaration node (and its variable parent) in the map. */
function registerDecl(map: Map<ts.Declaration, string>, node: ts.Node, sym: string): void {
  if (isDeclarationNode(node)) map.set(node, sym);
  // Arrow/fn-expr unit node → also map the enclosing VariableDeclaration (the
  // checker resolves a use of `const f = () => …` to the VariableDeclaration)
  // and the binding Identifier.
  const parent = node.parent;
  if (parent && ts.isVariableDeclaration(parent)) {
    map.set(parent, sym);
  }
  // class member property-bound arrow → map the PropertyDeclaration.
  if (parent && ts.isPropertyDeclaration(parent)) {
    map.set(parent, sym);
  }
}

function isDeclarationNode(n: ts.Node): n is ts.Declaration {
  return (
    ts.isFunctionDeclaration(n) ||
    ts.isClassDeclaration(n) ||
    ts.isMethodDeclaration(n) ||
    ts.isConstructorDeclaration(n) ||
    ts.isGetAccessorDeclaration(n) ||
    ts.isSetAccessorDeclaration(n) ||
    ts.isPropertyDeclaration(n) ||
    ts.isVariableDeclaration(n)
  );
}

/**
 * If a checker declaration corresponds to a lifted code-unit, return its symbol.
 * The declaration may be the registered node directly, or the parent (a
 * VariableDeclaration / PropertyDeclaration whose initializer is the unit node).
 */
function matchLocalDecl(d: ts.Declaration, declToSymbol: Map<ts.Declaration, string>): string | undefined {
  const direct = declToSymbol.get(d);
  if (direct) return direct;
  return undefined;
}

/** Is `abs` lexically under `root` (normalized prefix)? */
function isUnderRoot(root: string, abs: string): boolean {
  const rootN = root.endsWith(path.sep) ? root : root + path.sep;
  return abs === root || abs.startsWith(rootN);
}

/** Repo/root-relative POSIX path (determinism: forward slashes, no leading sep). */
function toRel(root: string, abs: string): string {
  return path.relative(root, abs).split(path.sep).join('/');
}
