# Warpline "A v1" — the TS Code-Lens (AST-level code meaning) — build spec

> Decision: TD-2026-06-23-688 (fork resolved to A; AST code-meaning is bounded engineering).
> Grounded by the AST-absorb spike (`.paradigm/research/warpline-ast-absorb-spike.{md,ts}`).
> Team convergence: Arky (model + composition), Cid (essence algorithm), Jinx (the
> determinism kill-shots + the false-EQUAL hazard). Companion to `docs/specs/warpline-engine.md`.
> Status: design converged, pre-build. Branch `loom-ast-spike` → builds on `packages/warpline`.
> Read-only invariant (Phase-1) is preserved: the lens only ever reads a throwaway worktree.

## Goal
Lift real TS **code-units** (functions, methods, classes, arrow-consts, accessors) into the
existing WARP, so `warpline diff`/`oracle` see meaning in code, not only in `.purpose` symbols —
directly fixing the "0 deltas on a `.ts`-only commit" gap. A v1 is **additive behind the
locked essence/diff/predict/oracle contract**: code essences flow through `sem-delta`,
`predict`, and `oracle` with a ~6-line touch plus one new contract slot. No algebra changes.

## The honest determinism promise (read first — it bounds everything)
The thesis is "byte-identical contentIds across runs/machines" (`warpline-engine.md:41`). For
code that promise is **conditional and must be stated as such**: *byte-identical across
machines running Warpline's pinned compiler on the same source tree.* The spike's 10/10 were the
**purely-syntactic** half (it never instantiated a `Program`/checker). Everything that
reaches for the checker imports environment-dependence; the three rules in §5 are what make
the conditional promise true. Do not let "10/10" launder the unproven half.

## 1. Reuse (what we stand on)
- `computeEssences` / `buildEssenceGraph` / `tarjanSCCs` / `hashSCC` — `packages/warpline/src/warp/essence-hash.ts`. These key everything on `symbol: string` + lifted edges and are **blind to `source`/`componentType`** — verified. Reuse verbatim; code-units are just more nodes.
- `canonicalSerialize` — `warp/canonical.ts` (NFC, sorted keys, no-undefined). The CCNF emits a `CanonicalValue` straight into it; no new serializer.
- `absorb.ts` — already materializes a detached read-only worktree and calls `loadLiveGraph` → `buildWarpState`. The lens slots in between.
- `sem-delta.ts` / `predict.ts` / `oracle.ts` — the diff/commute/knot/dangle algebra. Consumed unchanged except the one `body` slot (§6).

## 2. Data model (Arky) — code-units are synthetic nodes in the SAME universe
Do NOT build a parallel WARP. The lens emits objects shaped like `SymbolEntry`, injected into
the live `SymbolIndex` **before** `computeEssences` runs.
- **kind** = `component`; **componentType** = `code-unit` (new, identity-bearing value — a code-unit "becoming" a `.purpose` component is correctly a kind change). No `SymbolType` enum widening.
- **symbol (the key)** = `#code:<rel-path>::<qualified-name>` (e.g. `#code:packages/warpline/src/predict.ts::isKnot`, `#code:.../checkout.ts::Checkout.submit`). The path/qname is a **LABEL** (provenance + rename tiebreaker), never hashed.
- **stableKey** = `<rel-path>::<structural-path>` where structural-path = chain of `(scopeKind, ordinal-among-siblings)` (e.g. `class#0/method#2`). Label, not hashed; path-fragile under cross-file move — recovered via essence-equality matching (same contentId, different stableKey ⇒ a move = the empty delta), exactly as `.purpose` rename recovery already works.
- **contract** gains ONE identity-bearing slot: `codeEssence` (the CCNF, §3).
- **edges** = the resolved free-reference graph (§4), emitted as `entry.references`.
- **`SourceType`** widens by one additive literal: `'purpose' | 'portal' | 'premise' | 'code'` (the only premise-core type touch).
- **Coexistence (TD-806):** `.purpose` symbols and code-units share one `WarpState.objects`. A code-unit edges **one-way** to its enclosing `.purpose` component (`#code:.../checkout.ts::submit --uses--> #checkout`, matched by file/anchor). **v1 does NOT make a component's essence depend on its functions' bodies** (avoids component-hash thrash); body-meaning lives at function granularity. Coverage counts both tiers.

## 3. The Code Canonical Normal Form (Cid) — what is identity vs label

| | Identity-bearing (hashed) | LABEL (carried, never hashed) |
|---|---|---|
| Names | nothing | the unit's own name; ALL bound identifiers (params, locals, catch, destructure bindings, nested-fn names, **type-param names**) → binding indices (§3.1) |
| Control flow | full structure: `if/else`, all loops, `switch`+**case order** (fallthrough is meaning), `try/catch/finally`, `return/throw/break/continue`, `await/yield`, labels, `&&`/`\|\|`/`??`, ternary | — |
| Operators | every operator token incl. compound-assign, `?.`, `!`, `...`, `typeof`/`instanceof`/`in`/`delete`/`void` | — |
| Literals | numeric VALUE (§3.3), string value (escapes→codepoints), template structure+chunks, `true/false/null/undefined`, regex pattern+flags, bigint | — |
| Member access | property name on `a.b`/`a?.b`; element `a[k]` keeps `k` as child; `this`/`super` fixed tokens | — |
| Types | **WRITTEN** annotations only (params/returns/locals/type-params incl. constraints/defaults, `as`/`satisfies`, predicates) → type-CCNF; unions/intersections sorted, tuples ordered | — |
| Modifiers (§3.2 — the false-EQUAL guard) | `async`, generator `*`, `static`, `readonly`, `abstract`, accessor get/set, param optional `?`, default-**presence**, rest `...`, definite-assignment `!`, decorators (as ref expressions) | — |
| Visibility | nothing (captured structurally by whether refs resolve) | `export`/`default`/`declare` keyword |
| Comments | **directive** comments `@ts-ignore`/`@ts-expect-error`/`@ts-nocheck`/`eslint-disable` (they change what compiles) | free prose, JSDoc prose (JSDoc `@deprecated`→type-contract is DEFERRED, §8) |
| Formatting | nothing | whitespace, newlines, semicolons, redundant parens, quote style, trailing commas, positions, file path |

### 3.1 Alpha-normalization — scope-resolved binding indices (Cid + Jinx; MUST-SOLVE)
The spike's flat first-declaration-order map is **unsound** (breaks under shadowing/hoisting
and is cross-scope-order-dependent → both false-DIFFER on rename and the dangerous
false-EQUAL on shadowing). v1 uses a deterministic binding pre-pass:
- Build the lexical scope tree honoring JS hoisting (`var`/fn → function scope; `let`/`const`/`class` → block; params → unit scope). Each **binding** gets `(depth, ordinal-within-its-scope-in-declaration-order)`. Each **use** serializes as `b:{depth}:{ordinal}` of the binding it lexically resolves to (nearest enclosing). Unresolved-inside-the-unit ⇒ a free reference (§4).
- Separate namespaces: values `b:`, **type-params `t:`**, labels `L:`. (Type-param alpha-normalization is MUST-SOLVE — the spike ignored `<T>` entirely, so `f<T>` vs `f<U>` falsely DIFFERed.)
- Destructuring: bound names → indices; source **property keys** read are identity-bearing.

### 3.2 The false-EQUAL guard (Jinx — sharpest risk)
A false-EQUAL (silent "no semantic change" on changed code) **corrupts the oracle invisibly** —
far worse than a false-DIFFER. The generic `forEachChild` serializer drops modifier keywords
and significant tokens. v1 MUST explicitly enumerate every meaning-bearing flag/token in the
CCNF (the Modifiers row above): `async`≠sync, `function*`≠`function`, `a?:T`≠`a:T`, `?.`≠`.`,
`??`≠`||`, `...rest`, `!`. The test suite is written as **adversarial false-EQUAL probes**, and
they are a v1 ship gate.

### 3.3 Literal normalization (determinism hazard, pinned)
Integers (incl. hex/oct/bin) → exact decimal string; bigint → decimal+`n`; **non-integer
numerics → normalized source lexeme, NOT a parsed IEEE-754 double** (round-trip is a
portability risk we refuse → `0.1`≠`1e-1` in v1, honest under-normalization). Strings/templates
NFC via `canonicalSerialize`; escapes resolved (`"A"`≡`"A"`).

## 4. Hash-by-target — closing the spike's frontier (Cid + Arky)
Free references resolve via the checker and become `⟨edgeKind, essence(target)⟩` — the SAME
Merkle-by-target rule `essence-hash.ts` runs for `.purpose` edges, so a consistent
cross-symbol rename is the empty delta, transitively.
- `ts.createProgram` once over the worktree (against the synthesized compiler options, §5.2); `checker.getSymbolAtLocation` (+ `getAliasedSymbol`) resolves each free `Identifier`/PropertyAccess-head, classified by declaration site:
  - **(a) module-local code-unit/symbol** → edge `⟨kind, essence(target)⟩` (the frontier-closing case).
  - **(b) imported/external** → a **stable external id derived from the import specifier AS WRITTEN + exported name** — `extern:<specifier-as-written>#<exportName>` — NOT the resolved path or version (see §5.3 / Conflict-1).
  - **(c) builtin/global** (`lib.*`) → fixed token `builtin:<name>` (version-unpinned by design — `Math.max` means `Math.max`; gating on `lib` choice would drift every hash).
  - **(d) unresolved** (JS-only, broken types) → degrade to `unresolved:<sha256(name)>` + **reduced-fidelity flag** (counts against coverage). Determinism preserved; rename-freedom honestly not guaranteed for that edge.
- **edgeKind** widens to `calls` / `reads` / `types` by syntactic role (additive — the edgeBag sort is kind-agnostic).
- **SCC / mutual recursion / import cycles:** reuse Tarjan + `hashSCC` verbatim; case-(a) targets populate `adj`; (b)/(c)/(d) are fixed-string leaves (never SCC nodes), exactly as the current extern-leaf path. **TEST a real code-level cycle** — denser than `.purpose`, never exercised before.

### 4.1 The f:idx ↔ local-reference alignment contract (stage-2 → stage-3, soundness-critical)
`ts-lens` (stage 2, BUILT) emits per code-unit: a `codeEssence` body where each resolved
**local** free reference is a positional `f:idx` token (builtins/externs/unresolved stay
`free:name`), plus `references: CodeRef[]` (all four kinds — local/extern/builtin/unresolved —
in first-appearance order). The `f:idx` counter increments **only for local refs**. Therefore
**stage 3 must substitute `f:idx` → essence(target) using `references.filter(r => r.kind ===
'local')[idx]`** (the idx-th LOCAL reference, first-appearance order), INLINE at the body slot.
Substituting against the unfiltered array — or collapsing to an unordered/sorted edge-set —
reintroduces the call-order false-EQUAL (`helper(); other();` vs `other(); helper();` MUST
DIFFER). Call order is meaning: the body keeps the positional slot; the edgeBag-as-set model
`.purpose` uses does NOT carry over for code bodies. (Stage-2 open notes: a module-local
non-function binding currently classifies as `builtin`/`free:name` — honest v1 ceiling, frontier
not closed for non-function locals; and `liftUnit` calls the CNF twice — both deferred to later.)

## 5. THE DETERMINISM DECISIONS (the load-bearing section; Cid + Jinx converged)

### 5.1 Checker for IDENTITY RESOLUTION ONLY — never inferred types
The essence is computed over **syntactic structure + WRITTEN annotations only.** Checker-
**inferred** types (`getTypeAtLocation`/`typeToString`) are EXCLUDED. The checker answers
exactly one question — "which declaration does this name bind to" (§4), a discrete, stable
query. Rationale: inferred-type *string form* is explicitly not stable across TS versions ×
`tsconfig` (`strict`, `lib`, `target`, …) × installed `@types`; hashing it means the same
source yields different content-addresses on two machines — the exact failure this project
exists to prevent. Written annotations are source artifacts and safe (`string`≠`number`
DIFFERs purely syntactically). **Consequence, stated honestly:** an annotated return type and
an equivalent inferred one produce different essences — correct under "written annotations are
stated meaning"; we do not chase inferred-type parity.

### 5.2 Pin + stamp the compiler (Jinx KS1 — confirmed: TS is caret-pinned `^5.0.0`/`^5.3.3`/`^5.7.0` today)
`@a-company/warpline` MUST pin TypeScript to an **exact** version (no caret), and the essence
version tag MUST embed it: `contentId = "essence:v1:ts<exact>:" + sha256(ccnf)`. A different
compiler ⇒ an explicitly different namespace, never a silent collision. The lens builds the
Program against a **fixed synthesized compiler-options baseline** (do not trust a discovered
`tsconfig` for identity-bearing resolution; tsconfig affects what *parses*, not how we
*normalize*). `.purpose` symbols stay `essence:v0:` — the two schemes interoperate because
Merkle-by-target is opaque to a target's version namespace.

### 5.3 External ids: specifier-as-written, NOT version-pinned — **Conflict-1 resolved**
Cid proposed pinning `name@version` (to never under-report a dependency meaning-change); Jinx
(KS3) + Arky showed a resolved-version/path id **drifts with `npm install`** → breaks
determinism non-locally (one unstable extern id poisons every transitive caller). **Resolution
(determinism wins, since determinism is the thesis):** v1 external ids = `extern:<specifier-as-
written>#<exportName>` — a pure function of source text. The honest cost: v1 cannot tell
`lib@1` from `lib@2`. Cid's concern is **deferred, not dropped** → a future low-weight
`dependency-version` delta class fed by the **lockfile** (not the hash), so upgrades surface
in `diff` without destabilizing content-addresses. (Open: T-loom-a-extern-id.)

## 6. Composition — the load-bearing requirement (Arky; ~6 lines + one slot)
- `essence-hash.ts`: ONE line in `normalizedContract` (`codeEssence: str(...)`, gated on `componentType==='code-unit'`) + add `!data.codeEssence` to the `isGenericContract` predicate (a non-empty body is rich content). No traversal/SCC change.
- `sem-delta.ts`: the ONE genuine new concept — add `bodyChanged`/`'body'` to `ContractChangeset`/`changedSlotsOf` (a body-internal change differs in `codeEssence` but no enumerated slot moved → today it would be an empty-slot delta). `'body'` is the analog of the existing `'steps'` slot. ~4 lines. **NOT** a new `SemDeltaKind`.
- `predict.ts`: add `'body'` to the scalar-conflict-slot list → two divergent body edits to the same function = a **KNOT** (a new, sharper `divergeMeaningOnly`: git may auto-merge textually-distant edits Warpline flags at function granularity). One line. Edge-add to a deleted code-unit = **DANGLE** via the existing pass, unchanged.
- `oracle.ts`: unchanged; code knots/dangles populate the existing cells. Path→symbol mapping optionally sharpens to code-units' files (deferrable).

## 7. MUST-SOLVE-IN-V1 correctness list (Jinx — these are requirements, not deferrals)
1. **Scope-correct alpha-normalization** incl. shadowing/hoisting/TDZ/block-vs-function + **type-param** namespace (§3.1). Rename-invariance IS the thesis; if scoping is wrong, the thesis is wrong.
2. **Coverage of real function forms:** FunctionDeclaration, arrow/function-expr bound to const/class-field, method, constructor, getter/setter — all mapped to one `function-like` shape keyed by enclosing-symbol-path. The spike saw only top-level `function` decls; the common forms must not produce silent-empty essences.
3. **Overloads + default exports:** key by `(name, arity, kind)` not bare name (a name-keyed `Record` drops overload signatures); synthesize `default@<modulePath>` for default exports.
4. **Modifier/token false-EQUAL guard** (§3.2) — explicit, tested.
5. **Directive comments** (`@ts-*`) hashed as identity (§3 table).
6. **The three determinism rules** (§5) — non-negotiable.

## 8. Fidelity tiers (TD-806) — visible markers, never silent-empty
v1 lifts to T1: functions/methods/constructors/accessors/arrow-consts/class-bodies (a class =
bag of member essences + resolved `extends`/`implements`). **DEFER-WITH-HONESTY** (emit an
explicit tier marker in output, fall to T3 opaque blob, count against meaning-coverage — never
absorb as empty): computed property names, `as const`/`satisfies` inferred widening (annotation
token IS hashed; inferred effect is not), barrel re-exports, decorators-beyond-expr,
namespaces/enums, ambient `.d.ts`, JSX structural hashing, module-init/IIFE/`eval`/runtime-
computed-keys, JSDoc `@deprecated`-as-contract. Coverage ratio reported plainly.

## 9. File plan + MVP build order (Arky)
**Sub-phase 0 (types):** `src/lens/code-lens.ts` (`CodeUnit`,`CodeLens`,registry sig), `src/lens/code-symbol.ts` (`codeSymbol`/`codeStableKey`), premise-core `SourceType += 'code'`.
**Sub-phase 1 (lens + essence-data):** `src/lens/ts-essence.ts` (productionized spike core: CCNF + scope-correct alpha-norm + modifier guard), `src/lens/ts-lens.ts` (`createProgram` → walk decls → checker resolution → `CodeUnit[]`), `src/lens/registry.ts`; the 2-line `essence-hash.ts` touch.
**Sub-phase 2 (absorb + delta):** `src/lens/lift-code-units.ts` (+`injectCodeUnits`), wire into `absorb.ts` (both ref + WORKTREE paths), the `body` slot in `sem-delta.ts`/`predict.ts`, `packages/warpline/.purpose` (#code-lens, #code-essence, $absorb-flow step). **Exact-pin TS in package.json.**
**Sub-phase 3 (tests, §10).**

Runnable checkpoints: (2) `ts-essence` 10/10 green → (3) `ts-lens` frontier test EQUAL → (4) `warpline absorb main` shows `#code:` objects → (5) `warpline diff` non-zero on a `.ts`-only commit → (6) `warpline oracle` produces a code-level `divergeMeaningOnly` fixture.

## 10. Test plan
- **Spike's 10 properties as regression** (through the REAL pipeline contentId, not the spike's standalone hash) + file-level reorder-invariance + the closed frontier (cross-symbol rename EQUAL).
- **Adversarial false-EQUAL probes** (§3.2): sync vs async, `function` vs `function*`, `a:T` vs `a?:T`, `.` vs `?.`, `||` vs `??`, shadowing variants — all must DIFFER. Ship gate.
- **Determinism:** absorb the same ref into two different temp dirs → byte-identical code-unit contentIds + identical stateId (the test that caught the Phase-1 filePath wart). Lens run twice → identical `CodeUnit[]` after sort.
- **SCC:** a real code-level mutual-recursion + import cycle.
- **Oracle:** a fixture branch-pair yielding a code-level `divergeMeaningOnly` (divergent body edits git auto-merges) and a code dangle (call to a deleted function).

## 11. v1 scope ceiling (sell honestly)
Structural identity modulo names/format/independent-order — **NOT** semantic equivalence
(`a+b`≠`b+a`; a refactor is a delta; only *rename* is the empty delta). TS/TSX only. Read-only
(no weave — that's the B-arc). Cross-machine determinism is conditional on Warpline's pinned
compiler + same source tree. Annotation-as-token (no type resolution/inference). One-way
code-unit→component edge. No cross-file move detection (essence-recovered). Full `createProgram`
per absorb (no incremental cache — correctness/determinism first).

## 12. Open questions
- T-loom-a-extern-id: the deferred lockfile-fed `dependency-version` delta class (§5.3).
- T-loom-a-program: confirm the fixed synthesized compiler-options baseline vs per-file program cost on a large repo.
- Coverage target: what meaning-coverage % on THIS repo's `packages/warpline` counts as "A v1 proven"?

## Amendments

### 2026-07-02 — CCNF v1.1: the decorator/modifier false-EQUAL classes closed (T-2026-07-02-008, GUARD-DECIDER Stream A)

**What was wrong.** Three CONFIRMED false-EQUAL classes were reproduced live against v1:
`@UseGuards(AuthGuard) m()` vs `m()` → EQUAL; `@Get('/users')` vs `@Get('/admin')` → EQUAL;
`private m()` vs `public m()` → EQUAL. Root cause: `serializeFunctionLike` enumerated exactly
four modifiers (`async`/`*`/`static`/`abstract`) and never read `ts.getDecorators()`, despite
the §3 Modifiers row listing decorators as identity-bearing. Architecturally, the whitelist +
the generic `forEachChild` fallback **failed open** — unhandled syntax was silently EQUAL,
the exact §3.2 hazard.

**What changed (CCNF algorithm `v1` → `v1.1`, `ts-essence.ts`).**
1. **Decorators are serialized** on function-likes AND parameters, in **source order**
   (decorator order is semantic — they compose). Decorator expressions go through the standard
   expression path, so their free references (e.g. `AuthGuard`) join the §4 reference frontier
   like any other ref (verified: a decorator ref to a lifted local function emits a `local`
   edge + `f:idx` slot — rename-consistency holds transitively).
2. **Fail-closed full-modifier serialization**: EVERY modifier present is serialized
   (canonical token name per `ts.SyntaxKind`, **sorted** — deterministic and insensitive to
   grammatically-legal keyword reordering). Accessibility (`public`/`private`/`protected`),
   `override`, `readonly`, `accessor`, `declare`, and any FUTURE modifier TypeScript adds are
   automatically identity-bearing. Same for type-parameter modifiers (`<const T>` ≠ `<T>`).
3. **Superseded row, stated honestly**: the §3 "Visibility → LABEL" row is superseded —
   `export`/`default`/`declare` are now identity-bearing under fail-closed. An over-wide guard
   is a visible, cheap false-DIFFER; an under-wide one is invisible oracle corruption. We
   choose the visible cost.

**Version bump rationale.** The serialization algorithm changed, so cross-version essence
comparison must be impossible: the essence tag gains an ALGORITHM axis —
`essence:v1.1:ts<exact>:` (`CCNF_ALGO_VERSION` in `ts-essence.ts`, stamped by
`lift-code-units.ts` `CODE_ESSENCE_TAG`). Pre-v1.1 history discontinuity is ACCEPTED: every
code-unit re-addresses under the new namespace; there is no silent cross-namespace collision
by construction. `.purpose` symbols stay `essence:v0:`.

**Institutional gate.** `packages/warpline/test/false-equal-probes.test.ts` is the per-TS-release
false-EQUAL ship gate (§3.2): adversarial NOT-EQUAL probes (decorators, modifiers, `<const T>`,
accessor kind) PLUS protective EQUAL controls (whitespace/comments, local/param/type-param
rename — the rename-is-the-empty-delta thesis must survive every serializer change). Run it
against every new pinned TypeScript version before bumping the pin.
