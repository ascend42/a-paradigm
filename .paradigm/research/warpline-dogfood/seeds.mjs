// Warpline Move-3 dogfood — the AUTHORED stratified edit-pair catalog (harness-spec.md §1.1).
//
// This is the SOURCE of truth; `node build-catalog.mjs` materializes it to
// seed-catalog.jsonl (the artifact the file-plan §5 lists). Each seed is a
// deterministic, replayable edit-PAIR on real TypeScript: a `base` file set
// plus two whole-file patches (patchA, patchB) that two different agents apply
// in two worktrees off the SAME base selvage.
//
// TWO ENGINE CONSTRAINTS established empirically during the build (see
// pilot-results.md §Findings) that shape every seed:
//
//  (F1) ts-lens builds its TS program over the archived tree with NO node_modules /
//       tsconfig-paths, so CROSS-FILE call edges do NOT resolve — every resolvable
//       `#code` edge is INTRA-FILE. Hence every dependency-adjacent construction
//       (LINKED, the ripple-KNOT wedge) is authored INTRA-FILE.
//
//  (F2) admit()'s NOOP short-circuit uses stateId-equality (admit.ts:95), and
//       stateId is a hash of the DEDUPED essence SET. If a symbol's before- AND
//       after-essence BOTH already exist elsewhere in the tree, the deduped set is
//       unchanged and admit wrongly reports NOOP — even though `diff` (keyed by
//       stableKey) sees the change. (pick.ts abandoned this exact test for
//       diff-based detection; admit did not.) DEFENSE: every function body in this
//       catalog is GLOBALLY UNIQUE (a distinct constant per function-version), so
//       no essence ever collides and no spurious NOOP fires. The finding is
//       reported regardless — dogfooding surfaced it.
//
// Each seed row: { id, stratum, files, symbols, base, patchA, patchB, truth,
//                  expectWarpline, expectGit }.

// Unique-constant fn helper — every constant appears exactly once in the catalog.
const num = (name, expr) => `export function ${name}(x: number): number {\n  return ${expr};\n}\n`;

export const SEEDS = [
  // ── INDEPENDENT ×4 (baseline; disjoint symbols in DIFFERENT files) ───────────
  {
    id: 's1-indep', stratum: 'INDEPENDENT',
    files: ['src/s1a.ts', 'src/s1b.ts'],
    symbols: ['#code:src/s1a.ts::alpha', '#code:src/s1b.ts::bravo'],
    base: { 'src/s1a.ts': num('alpha', 'x * 301'), 'src/s1b.ts': num('bravo', 'x - 311') },
    patchA: { 'src/s1a.ts': num('alpha', 'x * 302') },
    patchB: { 'src/s1b.ts': num('bravo', 'x - 312') },
    truth: 'independent', expectWarpline: 'CLEAN/independent', expectGit: 'clean',
  },
  {
    id: 's2-indep', stratum: 'INDEPENDENT',
    files: ['src/s2a.ts', 'src/s2b.ts'],
    symbols: ['#code:src/s2a.ts::charlie', '#code:src/s2b.ts::delta'],
    base: { 'src/s2a.ts': num('charlie', 'x + 321'), 'src/s2b.ts': num('delta', 'x * x + 331') },
    patchA: { 'src/s2a.ts': num('charlie', 'x + 322') },
    patchB: { 'src/s2b.ts': num('delta', 'x * x + 332') },
    truth: 'independent', expectWarpline: 'CLEAN/independent', expectGit: 'clean',
  },
  {
    id: 's3-indep', stratum: 'INDEPENDENT',
    files: ['src/s3a.ts', 'src/s3b.ts'],
    symbols: ['#code:src/s3a.ts::echo', '#code:src/s3b.ts::foxtrot'],
    base: { 'src/s3a.ts': num('echo', 'x - 341'), 'src/s3b.ts': num('foxtrot', 'x + 351') },
    patchA: { 'src/s3a.ts': num('echo', 'x - 342') },
    patchB: { 'src/s3b.ts': num('foxtrot', 'x + 352') },
    truth: 'independent', expectWarpline: 'CLEAN/independent', expectGit: 'clean',
  },
  {
    id: 's4-indep', stratum: 'INDEPENDENT',
    files: ['src/s4a.ts', 'src/s4b.ts'],
    symbols: ['#code:src/s4a.ts::golf', '#code:src/s4b.ts::hotel'],
    base: { 'src/s4a.ts': num('golf', 'x * 361'), 'src/s4b.ts': num('hotel', 'x + 371') },
    patchA: { 'src/s4a.ts': num('golf', 'x * 362') },
    patchB: { 'src/s4b.ts': num('hotel', 'x + 372') },
    truth: 'independent', expectWarpline: 'CLEAN/independent', expectGit: 'clean',
  },

  // ── LINKED-CLEAN ×1 (dependency-adjacent, meaning commutes → CLEAN/linked) ────
  // A BORNS a new caller of foo (intra-file edge newHelper→foo); B changes foo's
  // body COMPATIBLY (same signature). The born symbol exists only on A's side, so
  // there is no shared key → autoClean; the new edge makes the changed sets
  // dependency-adjacent → confidence 'linked'. Merge is genuinely mergeable.
  {
    id: 's5-linked', stratum: 'LINKED-CLEAN',
    files: ['src/s5.ts'],
    symbols: ['#code:src/s5.ts::foo', '#code:src/s5.ts::newHelper'],
    base: { 'src/s5.ts': num('foo', 'x + 381') },
    patchA: { 'src/s5.ts': num('foo', 'x + 381') + 'export function newHelper(n: number): number {\n  return foo(n) * 383;\n}\n' },
    patchB: { 'src/s5.ts': num('foo', 'x + 382') },
    truth: 'mergeable', expectWarpline: 'CLEAN/linked', expectGit: 'clean',
  },

  // ── TRUE-INTERFERENCE ×2 (THE WEDGE: git merges CLEAN on disjoint hunks, but the
  //    merged result is BROKEN; warpline KNOTs via ripple-collision). A changes a
  //    callee's CONTRACT (adds a required param); B edits the caller's body in a
  //    DISJOINT hunk. Git 3-way merges clean → merged caller calls callee with the
  //    OLD arity → tsc TS2554. warpline: both sides contend the caller's essence
  //    (A via callee-ripple, B directly) → KNOT. truth=conflict. ──────────────────
  {
    id: 's6-interference', stratum: 'TRUE-INTERFERENCE',
    files: ['src/s6.ts'],
    symbols: ['#code:src/s6.ts::computeTax', '#code:src/s6.ts::totalWithTax'],
    base: {
      'src/s6.ts':
        'export function computeTax(amount: number): number {\n  return amount * 0.17;\n}\n' +
        'export function totalWithTax(amount: number): number {\n  const tax = computeTax(amount);\n  return amount + tax + 601;\n}\n',
    },
    patchA: {
      'src/s6.ts':
        'export function computeTax(amount: number, rate: number): number {\n  return amount * rate;\n}\n' +
        'export function totalWithTax(amount: number): number {\n  const tax = computeTax(amount);\n  return amount + tax + 601;\n}\n',
    },
    patchB: {
      'src/s6.ts':
        'export function computeTax(amount: number): number {\n  return amount * 0.17;\n}\n' +
        'export function totalWithTax(amount: number): number {\n  const tax = computeTax(amount);\n  return Math.round(amount + tax + 602);\n}\n',
    },
    truth: 'conflict', expectWarpline: 'KNOT', expectGit: 'clean-but-broken',
  },
  {
    id: 's7-interference', stratum: 'TRUE-INTERFERENCE',
    files: ['src/s7.ts'],
    symbols: ['#code:src/s7.ts::greet', '#code:src/s7.ts::announce'],
    base: {
      'src/s7.ts':
        'export function greet(name: string): string {\n  return "hi " + name + " 701";\n}\n' +
        'export function announce(name: string): string {\n  return greet(name).toUpperCase() + " 702";\n}\n',
    },
    patchA: {
      'src/s7.ts':
        'export function greet(name: string, title: string): string {\n  return "hi " + title + " " + name + " 703";\n}\n' +
        'export function announce(name: string): string {\n  return greet(name).toUpperCase() + " 702";\n}\n',
    },
    patchB: {
      'src/s7.ts':
        'export function greet(name: string): string {\n  return "hi " + name + " 701";\n}\n' +
        'export function announce(name: string): string {\n  return "[" + greet(name).toUpperCase() + " 704]";\n}\n',
    },
    truth: 'conflict', expectWarpline: 'KNOT', expectGit: 'clean-but-broken',
  },

  // ── NEGATIVE-CONTROL ×1 (same file, textually adjacent, but semantically
  //    INDEPENDENT symbols — no edge). A trap for false-KNOT / over-eager 'linked'.
  //    warpline must CLEAN/independent (NOT knot); git merges the adjacent hunks. ──
  {
    id: 's8-negctrl', stratum: 'NEGATIVE-CONTROL',
    files: ['src/s8.ts'],
    symbols: ['#code:src/s8.ts::ping', '#code:src/s8.ts::pong'],
    base: {
      'src/s8.ts':
        'export function ping(x: number): number {\n  return x + 391;\n}\n' +
        'export function pong(y: number): number {\n  return y - 401;\n}\n',
    },
    patchA: {
      'src/s8.ts':
        'export function ping(x: number): number {\n  return x + 392;\n}\n' +
        'export function pong(y: number): number {\n  return y - 401;\n}\n',
    },
    patchB: {
      'src/s8.ts':
        'export function ping(x: number): number {\n  return x + 391;\n}\n' +
        'export function pong(y: number): number {\n  return y - 402;\n}\n',
    },
    truth: 'independent', expectWarpline: 'CLEAN/independent', expectGit: 'clean',
  },
];

// ═══════════════════════════════════════════════════════════════════════════════
// FULL-RUN catalog (Move-3 ≥100-admission statistical run, T-2026-07-15-007).
// Generated deterministically — the generator IS the author; every instance is
// replayable and its ground truth is by construction. The pilot SEEDS above are
// untouched (pilot stays reproducible).
//
// Constructions were EMPIRICALLY validated in a sandbox before authoring
// (scratchpad/warpline-move3-full/sandbox2): git merge-tree + warpline admit
// verdicts confirmed per template. Two findings shape the catalog:
//
//  (F3) essence inlines local CALLEE BODIES: a callee body-only edit ripples into
//       the caller's essence, so callee-body × caller-body dual edits KNOT even
//       when both intents commute. Consequence 1: LINKED-CLEAN must use the
//       born-caller pattern (pilot s5). Consequence 2: an honest catalog must
//       NOT dodge this over-block — NEGCTRL-RIPPLE seeds measure it as
//       FALSE-KNOTs (graph-coupled but semantically commuting dual const-tweaks).
//  (F4) git line-merge conflicts on same-line/adjacent-line dual edits that
//       warpline's token-level merge3 composes cleanly — the AUTO-RESOLVE-WIN
//       construction (both linked and independent flavors validated: git
//       conflict=true, warpline CLEAN sealed).
//
// All full-run seed files live under src-dogfood/ in the throwaway monorepo
// clone. Every function body carries a globally-unique constant (allocator
// below) — defense-in-depth against essence dedup collisions (the admit NOOP
// bug is fixed, 4ae41b2a, but uniqueness keeps every oracle unambiguous).
// ═══════════════════════════════════════════════════════════════════════════════

let __c = 10000;
const uq = () => ++__c; // globally-unique constant allocator

const D = 'src-dogfood';

/** INDEPENDENT pair: two disjoint symbols in two files. Filler use applies side A only. */
function genIndependent(n) {
  const [c1, c2, c3, c4] = [uq(), uq(), uq(), uq()];
  const fa = `${D}/m${n}a.ts`;
  const fb = `${D}/m${n}b.ts`;
  const A = (c) => `export function ia${n}(x: number): number {\n  const k = x * 2;\n  return k + ${c};\n}\n`;
  const B = (c) => `export function ib${n}(y: number): number {\n  const k = y * 3;\n  return k - ${c};\n}\n`;
  return {
    id: `f${n}-ind`, stratum: 'INDEPENDENT',
    files: [fa, fb],
    symbols: [`#code:${fa}::ia${n}`, `#code:${fb}::ib${n}`],
    base: { [fa]: A(c1), [fb]: B(c2) },
    patchA: { [fa]: A(c3) },
    patchB: { [fb]: B(c4) },
    truth: 'independent', expectWarpline: 'CLEAN/independent', expectGit: 'clean',
  };
}

/** LINKED-CLEAN (git-clean; pilot-s5 pattern): A borns a caller of foo appended at
 *  file end; B edits foo's body compatibly. Meaning commutes; changed sets are
 *  dependency-adjacent via the born caller's edge → CLEAN/linked. */
function genLinkedPlain(n) {
  const [c1, c2, c3] = [uq(), uq(), uq()];
  const f = `${D}/m${n}.ts`;
  const foo = (c) => `export function lf${n}(x: number): number {\n  const k = x + 7;\n  return k + ${c};\n}\n`;
  const caller = `export function lh${n}(v: number): number {\n  return lf${n}(v) * ${c3};\n}\n`;
  return {
    id: `f${n}-linked`, stratum: 'LINKED-CLEAN',
    files: [f],
    symbols: [`#code:${f}::lf${n}`, `#code:${f}::lh${n}`],
    base: { [f]: foo(c1) },
    patchA: { [f]: foo(c1) + caller },
    patchB: { [f]: foo(c2) },
    truth: 'mergeable', expectWarpline: 'CLEAN/linked', expectGit: 'clean',
  };
}

/** AUTO-RESOLVE-WIN, linked flavor (sandbox-validated): one-line callee; A inserts
 *  a caller DIRECTLY on the next line (textually adjacent → git conflicts); B edits
 *  the callee's constant. warpline: born-caller edge → CLEAN/linked, token-merge seals. */
function genArwLinked(n) {
  const [c1, c2, c3] = [uq(), uq(), uq()];
  const f = `${D}/m${n}.ts`;
  const foo = (c) => `export function af${n}(x: number): number { return x + ${c}; }\n`;
  const caller = `export function ah${n}(v: number): number { return af${n}(v) * ${c3}; }\n`;
  return {
    id: `f${n}-arwL`, stratum: 'AUTO-RESOLVE-WIN-linked',
    files: [f],
    symbols: [`#code:${f}::af${n}`, `#code:${f}::ah${n}`],
    base: { [f]: foo(c1) },
    patchA: { [f]: foo(c1) + caller },
    patchB: { [f]: foo(c2) },
    truth: 'mergeable', expectWarpline: 'CLEAN/linked+sealed', expectGit: 'conflict',
  };
}

/** AUTO-RESOLVE-WIN, independent flavor (sandbox-validated): two UNRELATED one-line
 *  fns on the same line (even n) or adjacent lines (odd n); A edits fn1, B edits fn2.
 *  git line-merge conflicts; warpline token-merge composes → CLEAN/independent sealed. */
function genArwIndep(n) {
  const [c1, c2, c3, c4] = [uq(), uq(), uq(), uq()];
  const f = `${D}/m${n}.ts`;
  const sameLine = n % 2 === 0;
  const mk = (x, y) => sameLine
    ? `export function ax${n}(x: number): number { return x + ${x}; } export function ay${n}(y: number): number { return y - ${y}; }\n`
    : `export function ax${n}(x: number): number { return x + ${x}; }\nexport function ay${n}(y: number): number { return y - ${y}; }\n`;
  return {
    id: `f${n}-arwI`, stratum: 'AUTO-RESOLVE-WIN-indep',
    files: [f],
    symbols: [`#code:${f}::ax${n}`, `#code:${f}::ay${n}`],
    base: { [f]: mk(c1, c2) },
    patchA: { [f]: mk(c3, c2) },
    patchB: { [f]: mk(c1, c4) },
    truth: 'mergeable', expectWarpline: 'CLEAN/independent+sealed', expectGit: 'conflict',
  };
}

/** TRUE-INTERFERENCE, ripple flavor (pilot-s6 pattern): A adds a REQUIRED param to
 *  the callee (contract change); B edits the caller's body in a disjoint hunk. git
 *  3-way merges clean → merged caller calls old arity → tsc TS2554. warpline KNOTs. */
function genTiRipple(n) {
  const [c1, c2, c3] = [uq(), uq(), uq()];
  const f = `${D}/m${n}.ts`;
  const base =
    `export function tc${n}(amount: number): number {\n  return amount * ${c1};\n}\n` +
    `export function tt${n}(amount: number): number {\n  const tax = tc${n}(amount);\n  return amount + tax + ${c2};\n}\n`;
  const patchA =
    `export function tc${n}(amount: number, rate: number): number {\n  return amount * rate + ${c1};\n}\n` +
    `export function tt${n}(amount: number): number {\n  const tax = tc${n}(amount);\n  return amount + tax + ${c2};\n}\n`;
  const patchB =
    `export function tc${n}(amount: number): number {\n  return amount * ${c1};\n}\n` +
    `export function tt${n}(amount: number): number {\n  const tax = tc${n}(amount);\n  return Math.round(amount + tax + ${c3});\n}\n`;
  return {
    id: `f${n}-tiR`, stratum: 'TRUE-INTERFERENCE-ripple',
    files: [f],
    symbols: [`#code:${f}::tc${n}`, `#code:${f}::tt${n}`],
    base: { [f]: base }, patchA: { [f]: patchA }, patchB: { [f]: patchB },
    truth: 'conflict', expectWarpline: 'KNOT', expectGit: 'clean-but-broken',
  };
}

/** TRUE-INTERFERENCE, direct flavor: both sides rewrite the SAME one-line fn to
 *  contradictory bodies. git conflicts too → agree-conflict baseline (correct block). */
function genTiDirect(n) {
  const [c1, c2, c3] = [uq(), uq(), uq()];
  const f = `${D}/m${n}.ts`;
  const mk = (c) => `export function td${n}(x: number): number { return x * ${c}; }\n`;
  return {
    id: `f${n}-tiD`, stratum: 'TRUE-INTERFERENCE-direct',
    files: [f],
    symbols: [`#code:${f}::td${n}`],
    base: { [f]: mk(c1) }, patchA: { [f]: mk(c2) }, patchB: { [f]: mk(c3) },
    truth: 'conflict', expectWarpline: 'KNOT', expectGit: 'conflict',
  };
}

/** NEGATIVE-CONTROL (pilot-s8 pattern): same file, textually near but git-mergeable,
 *  semantically independent (no edge). Trap for false-KNOT / over-eager linked. */
function genNegCtrl(n) {
  const [c1, c2, c3, c4] = [uq(), uq(), uq(), uq()];
  const f = `${D}/m${n}.ts`;
  const mk = (x, y) =>
    `export function np${n}(x: number): number {\n  return x + ${x};\n}\n` +
    `export function nq${n}(y: number): number {\n  return y - ${y};\n}\n`;
  return {
    id: `f${n}-negctrl`, stratum: 'NEGATIVE-CONTROL',
    files: [f],
    symbols: [`#code:${f}::np${n}`, `#code:${f}::nq${n}`],
    base: { [f]: mk(c1, c2) },
    patchA: { [f]: mk(c3, c2) },
    patchB: { [f]: mk(c1, c4) },
    truth: 'independent', expectWarpline: 'CLEAN/independent', expectGit: 'clean',
  };
}

/** NEGCTRL-RIPPLE (the honest over-block trap, sandbox-validated as KNOT): callee
 *  and caller far apart (git-clean), BOTH sides make commuting const tweaks — A in
 *  the callee body, B in the caller body. Essence inlining makes the callee edit
 *  ripple into the caller → warpline KNOTs a semantically-mergeable pair. Authored
 *  truth = mergeable ⇒ scored FALSE-KNOT. Measures the cried-wolf cost honestly. */
function genNegCtrlRipple(n) {
  const [c1, c2, c3, c4] = [uq(), uq(), uq(), uq()];
  const f = `${D}/m${n}.ts`;
  const mk = (a, b) =>
    `export function rc${n}(): number {\n  return ${a};\n}\n\n` +
    `export function ru${n}(p: number): number {\n  return p * rc${n}() + ${b};\n}\n`;
  return {
    id: `f${n}-ncr`, stratum: 'NEGCTRL-RIPPLE',
    files: [f],
    symbols: [`#code:${f}::rc${n}`, `#code:${f}::ru${n}`],
    base: { [f]: mk(c1, c2) },
    patchA: { [f]: mk(c3, c2) },
    patchB: { [f]: mk(c1, c4) },
    truth: 'mergeable', expectWarpline: 'KNOT (over-block — expected FALSE-KNOT)', expectGit: 'clean',
  };
}

const GENERATORS = {
  'INDEPENDENT': genIndependent,
  'LINKED-CLEAN': genLinkedPlain,
  'AUTO-RESOLVE-WIN-linked': genArwLinked,
  'AUTO-RESOLVE-WIN-indep': genArwIndep,
  'TRUE-INTERFERENCE-ripple': genTiRipple,
  'TRUE-INTERFERENCE-direct': genTiDirect,
  'NEGATIVE-CONTROL': genNegCtrl,
  'NEGCTRL-RIPPLE': genNegCtrlRipple,
};

/** Build the full-run catalog: an ORDERED plan of stratum draws (the manifest
 *  generator decides the plan; this materializes it deterministically). */
export function genFullSeeds(plan) {
  let n = 100; // f100, f101, ... (disjoint from pilot ids s1-s8)
  return plan.map((stratum) => GENERATORS[stratum](n++));
}

/** Churn tombstone content for a seed's files (retires every symbol in the module). */
export function churnTombstone(seed, churnIndex) {
  const out = {};
  let i = 0;
  for (const file of seed.files) {
    out[file] = `// retired in rework (churn ${churnIndex})\nexport const graveyard_${churnIndex}_${i++} = ${churnIndex};\n`;
  }
  return out;
}
