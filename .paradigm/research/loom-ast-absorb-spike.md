# Loom AST-Absorb Soundness Spike — findings

> Decision gate: the team fork (A AST-code-meaning vs B write-path) hinged on ONE
> untested unknown — North's flip condition: *"if sound, deterministic AST→meaning is
> not achievable in bounded effort, take B."* This spike answers it with data.
> Read-only prototype (reproducible): `.paradigm/research/loom-ast-absorb-spike.ts`
> — run `npx tsx .paradigm/research/loom-ast-absorb-spike.ts` (tsx, TS 5.9.3).
> Date: 2026-06-23. Branch `loom-ast-spike` (off main, post loom-engine merge).

## Question
Can TypeScript **code** be lifted to a deterministic, meaning-preserving essence — the
same contract the built engine already enforces for `.purpose` symbols (canonical normal
form; the hash moves IFF the meaning moves; rename = the empty delta)? Is it **bounded
engineering** or **open research**?

## Method
A minimal "code lens": parse with the TS compiler API, walk each top-level function to a
**Canonical Normal Form** that DROPS formatting, comments, positions, and the **names of
locally-bound identifiers** (alpha-normalized to de-Bruijn-ish indices in declaration
order), while KEEPING control-flow structure, operators, literal values, member-access
chains, type annotations, and free references. `contentId = sha256(canonical)`,
version-tagged `code-essence:v0`. File essence = sorted bag of function essences.

## Results (data)

Per-function lens — **10/10 properties hold**:

| Property | Expect | Got | Probe |
|---|---|---|---|
| determinism | EQUAL | ✅ EQUAL | same code twice → identical |
| local-rename | EQUAL | ✅ EQUAL | rename params/locals → meaning unchanged |
| format/whitespace | EQUAL | ✅ EQUAL | reflow whitespace + newlines |
| comments | EQUAL | ✅ EQUAL | add comments |
| redundant-parens | EQUAL | ✅ EQUAL | `(a+b)` vs `a+b` |
| operator-change | DIFFER | ✅ DIFFER | `+`→`-` |
| literal-change | DIFFER | ✅ DIFFER | `1`→`2` |
| controlflow-change | DIFFER | ✅ DIFFER | add an `if` branch |
| type-annotation | DIFFER | ✅ DIFFER | `string` vs `number` param |
| arg-order | DIFFER | ✅ DIFFER | `a-b` vs `b-a` |

File-level: **reorder two independent top-level functions → file essence unchanged** ✅
(the `.purpose` bag-of-essences trick transfers directly to code).

## The frontier (reproduced, not hand-waved)
A **cross-symbol rename** (`helper`→`assist`, consistently at definition and call site)
moved the caller's essence (`33a0b7be…` → `1e6eaa08…`). This is the ONLY soundness gap,
and its cause is exact: free references are hashed **by NAME** in v0. The fix is **hash
free references by TARGET ESSENCE** — *the identical Merkle-by-target-essence rule the
built `packages/loom/src/warp/essence-hash.ts` already applies to `.purpose` edges*
(`⟨edgeKind, essence(target)⟩`), including its Tarjan-SCC handling for mutual recursion.

## Verdict: A is BOUNDED ENGINEERING, not open research

1. **Determinism — the thesis — is preserved.** The structural lift is exactly as
   deterministic as the `.purpose` essence (no embeddings, no heuristics, no probabilistic
   step). North's risk ("noisy/heuristic diffs corrupt the determinism claim") is
   **refuted** for the structural approach. Determinism is not a hope; the spike shows it.
2. **The core lens is small** (~200 lines for the per-function CNF + alpha-normalization;
   the prototype is a working subset already).
3. **The one hard part reuses machinery we already have.** Cross-symbol rename → hash-by-
   target is the SAME Merkle trick + SCC handling the engine ships today; the net-new piece
   is **name resolution** (bind a free reference to its declaration), which the TS type
   checker provides off-the-shelf (`getSymbolAtLocation`). Bounded, not novel.
4. **It is additive behind the existing contract** (Arky's prediction confirmed): a code
   lens emits per-function essences; `diff`/`predict`/`oracle` consume them unchanged. A is
   a Phase-3 lens, not a rewrite.

## What a real v1 needs (the build shape, beyond the spike)
- **Name resolution via the TS checker** (`createProgram` + `getSymbolAtLocation`) to
  classify each free reference as: module-local symbol (hash by its essence — closes the
  frontier), imported/external symbol (hash by a stable external id), or builtin.
- **Merkle traversal over the code-symbol dependency graph** + **Tarjan SCC** for mutual
  recursion (reuse `essence-hash.ts`'s existing SCC code).
- **Coverage beyond top-level functions**: classes/methods, arrow-assigned consts, exports,
  closures; map each to a code-WARP object under the GAP-1 (TD-806) fidelity tiers.
- **A per-language lens interface** so the WARP granularity is "symbol OR code-unit"; TS
  first, the interface keeps other languages additive.
- **Honest scope ceiling**: this is syntactic-structural identity modulo
  names/format/independent-order — NOT semantic-equivalence (e.g. `a+b` vs `b+a` correctly
  DIFFER). That is the right, Unison-consistent ceiling; do not promise more.

## Recommendation
The flip condition did **not** trigger → **commit to A** (AST-level code meaning) as the
next major push, scoped as an additive TS code-lens behind the existing essence/diff/
predict/oracle contract, closing the frontier with checker-backed hash-by-target. B (the
write path) remains valuable and unblocked — it becomes far stronger *after* A makes the
meaning layer thick (every B-voter agreed A gives B its teeth).
