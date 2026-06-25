/**
 * false-autofold-gate.test — THE SHIP-GATE for multi-writer auto-admission.
 *
 * Jinx's gate (T-2026-06-25-013): the engine's essence is structural-by-design
 * (names/format stripped, Merkle-by-target). The hypothesis under test is that it
 * is therefore BLIND to CROSS-SYMBOL semantic conflicts — two edits to DIFFERENT
 * symbols that are individually structurally-disjoint (so `predict` returns
 * autoClean) yet TOGETHER produce a semantically wrong program. As a read-only
 * oracle that's a tolerable false-negative; as a PRIMARY store that AUTO-ADMITS,
 * the auto-fold ships the bug with no human byte-diff in the loop — the VCS
 * cardinal sin.
 *
 * This is a CHARACTERIZATION test: it asserts the engine's ACTUAL behavior on a
 * corpus of genuine cross-symbol semantic conflicts and MEASURES the false-CLEAN
 * rate (adversarial pairs that consolidate reports CLEAN / decisions:0). The
 * controls prove the engine is NOT trivially blind — it DOES catch same-symbol
 * knots and code-level dangles. If a future engine starts catching an adversarial
 * case, its assertion flips and we revisit (that's the signal we want).
 *
 * DECISION RULE: a materially non-zero false-CLEAN rate ⇒ multi-writer must NOT
 * auto-admit a cross-symbol-spanning WEFT without human/peer confirmation. Run
 * THIS before building SCRATCH+CAS+WEFT (Phase C).
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { consolidate, type ConsolidateForecast } from '../src/consolidate.js';

const execFileAsync = promisify(execFile);

/** A throwaway git repo with arbitrary files on base/branchA/branchB. */
class FixtureRepo {
  constructor(public readonly dir: string) {}
  static async create(prefix: string): Promise<FixtureRepo> {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
    const repo = new FixtureRepo(dir);
    await repo.git('init', '-q', '-b', 'base');
    await repo.git('config', 'user.email', 'gate@warpline.test');
    await repo.git('config', 'user.name', 'Warpline Gate');
    await repo.git('config', 'commit.gpgsign', 'false');
    return repo;
  }
  async git(...args: string[]): Promise<string> {
    const { stdout } = await execFileAsync('git', args, { cwd: this.dir, encoding: 'utf8' });
    return stdout.trim();
  }
  async write(files: Record<string, string | null>): Promise<void> {
    for (const [rel, body] of Object.entries(files)) {
      const full = path.join(this.dir, rel);
      if (body === null) {
        await fs.rm(full, { force: true });
      } else {
        await fs.mkdir(path.dirname(full), { recursive: true });
        await fs.writeFile(full, body, 'utf8');
      }
    }
  }
  async commitAll(msg: string): Promise<void> {
    await this.git('add', '-A');
    await this.git('commit', '-q', '-m', msg);
  }
  async destroy(): Promise<void> {
    await fs.rm(this.dir, { recursive: true, force: true });
  }
}

type Outcome = 'autofold' | 'knot' | 'dangle';

/**
 * linkage = WHY the engine does or doesn't see the conflict:
 *  - dependent      : a dependency edge links the conflicting symbols in-graph, so
 *                     Merkle-by-target propagation moves the dependent's essence on
 *                     BOTH sides → CAUGHT (knot). Auto-admit is SAFE here.
 *  - independent    : same file, no edge between them and no common in-graph
 *                     dependent → BLIND (autofold). A real false-CLEAN.
 *  - cross-file     : composed across an import boundary (refs are extern, never a
 *                     local code-unit edge) → BLIND even WITH a calling relationship.
 *  - control        : not an adversarial pair (knot/dangle/clean controls).
 */
type Linkage = 'dependent' | 'independent' | 'cross-file' | 'control';

interface Scenario {
  name: string;
  category: string;
  linkage: Linkage;
  /** true = a GENUINE cross-symbol semantic conflict (a false-CLEAN if autofolded). */
  adversarial: boolean;
  /** why the merged program is semantically wrong (human judgment, not computed). */
  note: string;
  expect: Outcome;
  base: Record<string, string>;
  a: Record<string, string | null>;
  b: Record<string, string | null>;
}

// ── Dangle precedence mirrors predict(): a dangle outranks a knot outranks clean. ──
function classify(f: ConsolidateForecast): Outcome {
  if (f.dangling.length > 0) return 'dangle';
  if (f.knots.length > 0) return 'knot';
  return 'autofold';
}

async function runScenario(sc: Scenario): Promise<ConsolidateForecast> {
  const repo = await FixtureRepo.create('warpline-gate-');
  try {
    await repo.write(sc.base);
    await repo.commitAll('base');
    await repo.git('checkout', '-q', '-b', 'branchA');
    await repo.write(sc.a);
    await repo.commitAll('A');
    await repo.git('checkout', '-q', 'base');
    await repo.git('checkout', '-q', '-b', 'branchB');
    await repo.write(sc.b);
    await repo.commitAll('B');
    await repo.git('checkout', '-q', 'base');
    return await consolidate(['branchA', 'branchB'], { cwd: repo.dir });
  } finally {
    await repo.destroy();
  }
}

// ── helpers to keep fixture bodies terse but valid TS ──
const fn = (name: string, body: string) => `export function ${name}() {\n  ${body}\n}\n`;

const SCENARIOS: Scenario[] = [
  // ════ THE CONTRAST PAIR — the same double-tax conflict, caught vs blind ════
  // 1a. DOUBLE-TAX, SAME FILE (dependency edge: applyTax CALLS rate). A bakes the
  //     factor into rate; B adds it again in applyTax. Because applyTax Merkle-
  //     includes rate, A's rate-change moves applyTax's essence too → both sides
  //     move applyTax → CAUGHT as a knot. Auto-admit is SAFE here.
  {
    name: 'double-tax-samefile',
    category: 'double-applied-transform',
    linkage: 'dependent',
    adversarial: true,
    note: 'rate*1.08 AND applyTax*1.08 → 1.1664 (taxed twice); applyTax calls rate ⇒ Merkle links them',
    expect: 'knot',
    base: { 'src/money.ts': fn('rate', 'return 100 * 1.0;') + fn('applyTax', 'return rate();') },
    a: { 'src/money.ts': fn('rate', 'return 100 * 1.08;') + fn('applyTax', 'return rate();') },
    b: { 'src/money.ts': fn('rate', 'return 100 * 1.0;') + fn('applyTax', 'return rate() * 1.08;') },
  },
  // 1b. DOUBLE-TAX, CROSS FILE (SAME conflict, applyTax IMPORTS rate). A cross-file
  //     ref is an EXTERN, not a local code-unit edge — so applyTax's essence does
  //     NOT Merkle-include rate. A moves rate, B moves applyTax, no propagation →
  //     autofold. The IDENTICAL bug the same-file case caught is now BLIND.
  {
    name: 'double-tax-crossfile',
    category: 'double-applied-transform',
    linkage: 'cross-file',
    adversarial: true,
    note: 'SAME double-tax, but applyTax imports rate (extern) → no Merkle link → silently auto-folds',
    expect: 'autofold',
    base: {
      'src/rate.ts': fn('rate', 'return 100 * 1.0;'),
      'src/tax.ts': `import { rate } from './rate';\n` + fn('applyTax', 'return rate();'),
    },
    a: { 'src/rate.ts': fn('rate', 'return 100 * 1.08;') },
    b: { 'src/tax.ts': `import { rate } from './rate';\n` + fn('applyTax', 'return rate() * 1.08;') },
  },
  // 2. DOUBLE-DISCOUNT, SAME FILE (dependency edge) — caught for the same reason.
  {
    name: 'double-discount-samefile',
    category: 'double-applied-transform',
    linkage: 'dependent',
    adversarial: true,
    note: 'listPrice*0.9 AND checkout*0.9 → 0.81; checkout calls listPrice ⇒ caught',
    expect: 'knot',
    base: { 'src/cart.ts': fn('listPrice', 'return 50;') + fn('checkout', 'return listPrice();') },
    a: { 'src/cart.ts': fn('listPrice', 'return 50 * 0.9;') + fn('checkout', 'return listPrice();') },
    b: { 'src/cart.ts': fn('listPrice', 'return 50;') + fn('checkout', 'return listPrice() * 0.9;') },
  },
  // 3. NULL-CONTRACT DRIFT, SAME FILE (dependency edge: format CALLS lookup) — caught.
  {
    name: 'nullable-drift-samefile',
    category: 'contract-drift',
    linkage: 'dependent',
    adversarial: true,
    note: 'lookup may return null (A) but format dereferences it (B); format calls lookup ⇒ caught',
    expect: 'knot',
    base: { 'src/find.ts': `export function lookup(): string { return "x"; }\n` + `export function format(): number { return lookup().length; }\n` },
    a: { 'src/find.ts': `export function lookup(): string | null { return null; }\n` + `export function format(): number { return lookup().length; }\n` },
    b: { 'src/find.ts': `export function lookup(): string { return "x"; }\n` + `export function format(): number { return lookup().length + 1; }\n` },
  },
  // ──── THE BLIND SPOT — independent symbols, no in-graph dependency link ────
  // 4. SPLIT INVARIANT (round-trip). encode/decode must be inverses; no caller in
  //    the fixture links them → no Merkle path → BLIND (autofold).
  {
    name: 'roundtrip-broken',
    category: 'split-invariant',
    linkage: 'independent',
    adversarial: true,
    note: 'encode +5 but decode -2 → no longer inverses; nothing links them in-graph',
    expect: 'autofold',
    base: { 'src/codec.ts': fn('encode', 'return 0 + 1;') + fn('decode', 'return 0 - 1;') },
    a: { 'src/codec.ts': fn('encode', 'return 0 + 5;') + fn('decode', 'return 0 - 1;') },
    b: { 'src/codec.ts': fn('encode', 'return 0 + 1;') + fn('decode', 'return 0 - 2;') },
  },
  // 5. SPLIT INVARIANT (bounds). start<end must hold; independent symbols → BLIND.
  {
    name: 'bounds-inverted',
    category: 'split-invariant',
    linkage: 'independent',
    adversarial: true,
    note: 'windowStart=200 (A) and windowEnd=50 (B) → start>end; independent ⇒ blind',
    expect: 'autofold',
    base: { 'src/win.ts': fn('windowStart', 'return 0;') + fn('windowEnd', 'return 100;') },
    a: { 'src/win.ts': fn('windowStart', 'return 200;') + fn('windowEnd', 'return 100;') },
    b: { 'src/win.ts': fn('windowStart', 'return 0;') + fn('windowEnd', 'return 50;') },
  },
  // 6. SHARED CONSTANT SKEW. client/server version must match; independent → BLIND.
  {
    name: 'version-skew',
    category: 'constant-skew',
    linkage: 'independent',
    adversarial: true,
    note: 'clientVersion=2 (A) but serverVersion=3 (B) → handshake mismatch; independent ⇒ blind',
    expect: 'autofold',
    base: { 'src/proto.ts': fn('clientVersion', 'return 1;') + fn('serverVersion', 'return 1;') },
    a: { 'src/proto.ts': fn('clientVersion', 'return 2;') + fn('serverVersion', 'return 1;') },
    b: { 'src/proto.ts': fn('clientVersion', 'return 1;') + fn('serverVersion', 'return 3;') },
  },
  // 7. UNITS MISMATCH across an IMPORT boundary (sec→ms). Cross-file extern → BLIND.
  {
    name: 'units-ms-vs-sec',
    category: 'units-cross-file',
    linkage: 'cross-file',
    adversarial: true,
    note: 'producer returns ms (5000) but consumer still adds it as seconds; cross-file ⇒ blind',
    expect: 'autofold',
    base: {
      'src/producer.ts': fn('timeout', 'return 5;'),
      'src/consumer.ts': `import { timeout } from './producer';\n` + fn('deadline', 'return timeout() + 1;'),
    },
    a: { 'src/consumer.ts': `import { timeout } from './producer';\n` + fn('deadline', 'return timeout() + 2;') },
    b: { 'src/producer.ts': fn('timeout', 'return 5000;') },
  },
  // ── CONTROLS — the engine MUST catch these (proves it isn't trivially blind). ──
  // 8. SAME-SYMBOL KNOT: both edit foo()'s body to different essences.
  {
    name: 'control-same-symbol-knot',
    category: 'control',
    linkage: 'control',
    adversarial: false,
    note: 'both branches edit foo() body differently → genuine knot the engine sees',
    expect: 'knot',
    base: { 'src/k.ts': fn('foo', 'return 1;') + fn('bar', 'return 2;') },
    a: { 'src/k.ts': fn('foo', 'return 10;') + fn('bar', 'return 2;') },
    b: { 'src/k.ts': fn('foo', 'return 20;') + fn('bar', 'return 2;') },
  },
  // 9. CODE-LEVEL DANGLE: B's caller calls helper; A deletes helper.
  {
    name: 'control-dangle',
    category: 'control',
    linkage: 'control',
    adversarial: false,
    note: 'caller→helper edge with helper retired → dangle the engine catches',
    expect: 'dangle',
    base: { 'src/d.ts': fn('caller', 'return 0;') + fn('pad', 'return 1;') + fn('helper', 'return 42;') },
    a: { 'src/d.ts': fn('caller', 'return 0;') + fn('pad', 'return 1;') },
    b: { 'src/d.ts': fn('caller', 'return helper();') + fn('pad', 'return 1;') + fn('helper', 'return 42;') },
  },
  // 10. TRUE-NEGATIVE: genuinely independent edits to different symbols — CLEAN is
  //     CORRECT here (not a false-CLEAN). Guards against over-counting the rate.
  {
    name: 'control-independent-clean',
    category: 'control',
    linkage: 'control',
    adversarial: false,
    note: 'unrelated body edits to foo and bar — semantically independent, clean is right',
    expect: 'autofold',
    base: { 'src/i.ts': fn('foo', 'return 1;') + fn('bar', 'return 2;') },
    a: { 'src/i.ts': fn('foo', 'return 111;') + fn('bar', 'return 2;') },
    b: { 'src/i.ts': fn('foo', 'return 1;') + fn('bar', 'return 222;') },
  },
];

describe('FALSE-AUTOFOLD GATE — does the engine auto-fold genuine cross-symbol semantic conflicts?', () => {
  const got = new Map<string, Outcome>();

  beforeAll(async () => {
    for (const sc of SCENARIOS) {
      const f = await runScenario(sc);
      got.set(sc.name, classify(f));
    }
  }, 600_000);

  it.each(SCENARIOS)('$category · $name → $expect', (sc) => {
    expect(got.get(sc.name)).toBe(sc.expect);
  });

  it('controls prove the engine is not trivially blind (catches knot + dangle)', () => {
    expect(got.get('control-same-symbol-knot')).toBe('knot');
    expect(got.get('control-dangle')).toBe('dangle');
    expect(got.get('control-independent-clean')).toBe('autofold');
  });

  it('MEASURE — false-CLEAN rate by linkage (the gate verdict)', () => {
    const adversarial = SCENARIOS.filter((s) => s.adversarial);
    const linked = adversarial.filter((s) => s.linkage === 'dependent');
    const unlinked = adversarial.filter((s) => s.linkage === 'independent' || s.linkage === 'cross-file');
    const linkedCaught = linked.filter((s) => got.get(s.name) !== 'autofold');
    const unlinkedBlind = unlinked.filter((s) => got.get(s.name) === 'autofold');
    const overallBlind = adversarial.filter((s) => got.get(s.name) === 'autofold');

    const lines = ['', '  FALSE-AUTOFOLD GATE — cross-symbol semantic conflicts:'];
    for (const s of adversarial) {
      const o = got.get(s.name);
      const mark = o === 'autofold' ? '✗ FALSE-CLEAN' : `✓ caught(${o})`;
      lines.push(`    [${s.linkage.padEnd(11)}] ${mark}  ${s.name} — ${s.note}`);
    }
    lines.push('');
    lines.push(`  dependency-LINKED conflicts caught:   ${linkedCaught.length}/${linked.length}  (Merkle-by-target propagation → SAFE to auto-admit)`);
    lines.push(`  UNLINKED (indep/cross-file) blind:    ${unlinkedBlind.length}/${unlinked.length}  (← the false-CLEAN — UNSAFE to auto-admit)`);
    lines.push(`  overall false-CLEAN rate:             ${overallBlind.length}/${adversarial.length} = ${((overallBlind.length / adversarial.length) * 100).toFixed(0)}%`);
    lines.push('');
    lines.push('  FINDING: the engine catches a cross-symbol semantic conflict IFF a dependency path');
    lines.push('  links the conflicting symbols in the lifted graph. It is BLIND to conflicts between');
    lines.push('  independent symbols and across extern/cross-file boundaries (refs are extern, not edges).');
    lines.push('  GATE VERDICT for Phase C: auto-admit a WEFT ONLY when its conflict surface is dependency-');
    lines.push('  connected in-graph; a WEFT spanning independent symbols or cross-file refs needs human/peer');
    lines.push('  confirmation. Silent wrong-merge is the VCS cardinal sin.');
    // eslint-disable-next-line no-console
    console.log(lines.join('\n'));

    // Hard assertion of the gate's core claim: the blind spot is real AND non-empty
    // (there exist genuine semantic conflicts the engine silently auto-folds).
    expect(unlinked.length).toBeGreaterThan(0);
    expect(unlinkedBlind.length).toBe(unlinked.length);
  });
});
