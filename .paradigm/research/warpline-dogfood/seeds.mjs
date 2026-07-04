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
