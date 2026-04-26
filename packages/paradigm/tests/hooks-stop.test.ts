/**
 * v6.0.4 Wave 5 — Stop hook regression tests (cases A-G).
 *
 * Spawns `bash` against `paradigm-common.sh` with seeded fixture project
 * directories. Verifies the agent-owned-enforcement gating: aspect drift +
 * aspect coverage advisories emit only when the `compliance` archetype is
 * on the roster, while syntax checks (Check 4 broken anchor), missing-
 * .purpose checks (Check 1/2), and lore-required (Check 7) stay
 * unconditional.
 *
 * Critical fixture concern: `paradigm-common.sh` invokes
 * `paradigm compliance-check --json --auto-heal --learn --trigger on-stop`
 * (lines 541-550). The v5.37.12 fail-closed fix BLOCKS on non-zero exit.
 * To isolate tests from the developer's globally-linked CLI we stub a
 * fake `paradigm` binary in a per-test PATH dir that emits the JSON the
 * hook expects (driftedCount/healedCount/usedButUndeclaredCount).
 *
 * Cohort coverage:
 *   A: rostered + drift              → blocks
 *   B: rostered + clean              → exits 0
 *   C: rostered + broken anchor      → blocks (Check 4)
 *   D: NOT rostered + broken anchor  → blocks (Check 4 unconditional)
 *   E: NOT rostered + drift          → exits 0; snapshot still recorded
 *   F: NOT rostered + missing .purpose → blocks (Check 1/2 unconditional)
 *   G: any roster + 3+ source files no lore → blocks (Check 7 unconditional)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync, type SpawnSyncReturns } from 'child_process';

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

const COMMON_SH = path.resolve(
  __dirname,
  '..',
  'src',
  'commands',
  'hooks',
  'scripts',
  'paradigm-common.sh',
);

interface FixtureOptions {
  /** Whether to roster the `compliance` archetype (cohort flip). */
  rosterCompliance: boolean;
  /** Optional `.purpose` files to seed. Map of relative path → contents. */
  purposes?: Record<string, string>;
  /** Optional source files to seed. Map of relative path → contents. */
  sources?: Record<string, string>;
  /** Stub `paradigm compliance-check --json` JSON payload. */
  complianceJson?: string;
  /** When true, omit the paradigm stub (simulates missing binary, exit 127). */
  noParadigmStub?: boolean;
  /**
   * Newline-separated git diff output to feed `MODIFIED`. The fixture also
   * physically creates each path under sources/purposes when listed.
   */
  modified: string[];
  /** Pre-seed `.paradigm/lore/entries/<today>/` with a stub entry. */
  withTodayLore?: boolean;
}

interface FixtureResult {
  rootDir: string;
  binDir: string;
  cleanup: () => void;
  run: () => SpawnSyncReturns<string>;
}

function seedFixture(opts: FixtureOptions): FixtureResult {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'paradigm-hooks-'));
  const binDir = fs.mkdtempSync(path.join(os.tmpdir(), 'paradigm-bin-'));

  // .paradigm/ scaffold
  fs.mkdirSync(path.join(rootDir, '.paradigm', 'events'), { recursive: true });
  fs.mkdirSync(path.join(rootDir, '.paradigm', 'lore', 'entries'), {
    recursive: true,
  });

  // roster.yaml — cohort flip
  const active = opts.rosterCompliance
    ? ['architect', 'builder', 'compliance']
    : ['architect', 'builder'];
  fs.writeFileSync(
    path.join(rootDir, '.paradigm', 'roster.yaml'),
    `version: '1.0'\nactive:\n${active.map((a) => `  - ${a}`).join('\n')}\n`,
    'utf8',
  );

  // .purpose files
  if (opts.purposes) {
    for (const [rel, content] of Object.entries(opts.purposes)) {
      const full = path.join(rootDir, rel);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, content, 'utf8');
    }
  }

  // source files
  if (opts.sources) {
    for (const [rel, content] of Object.entries(opts.sources)) {
      const full = path.join(rootDir, rel);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, content, 'utf8');
    }
  }

  // today-lore stub
  if (opts.withTodayLore) {
    const today = new Date().toISOString().slice(0, 10);
    const dir = path.join(rootDir, '.paradigm', 'lore', 'entries', today);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'L-stub.yaml'),
      'id: L-stub\ntitle: stub\n',
      'utf8',
    );
  }

  // Stub `paradigm` binary in binDir. The script invokes it with various
  // arguments; we only care about `compliance-check --json`. Default is a
  // clean response (drift=0). Any other invocation (e.g., `enforcement
  // resolve --json` for ENFORCEMENT_MAP) returns an empty string + exit 0.
  if (!opts.noParadigmStub) {
    const json = opts.complianceJson ?? '{"driftedCount":0,"healedCount":0,"usedButUndeclaredCount":0}';
    const stubPath = path.join(binDir, 'paradigm');
    fs.writeFileSync(
      stubPath,
      `#!/bin/sh
case "$1" in
  compliance-check)
    cat <<'JSON'
${json}
JSON
    exit 0
    ;;
  enforcement)
    # Empty enforcement map → all checks fall back to defaults
    exit 0
    ;;
  *)
    exit 0
    ;;
esac
`,
      'utf8',
    );
    fs.chmodSync(stubPath, 0o755);
  }

  return {
    rootDir,
    binDir,
    cleanup: () => {
      fs.rmSync(rootDir, { recursive: true, force: true });
      fs.rmSync(binDir, { recursive: true, force: true });
    },
    run: () => {
      // Source paradigm-common.sh from inside the fixture root, with the
      // stub binDir prepended to PATH so the shell finds our fake paradigm.
      const env: Record<string, string> = {
        PATH: opts.noParadigmStub ? '/usr/bin:/bin' : `${binDir}:/usr/bin:/bin`,
        HOME: rootDir,
        CWD: rootDir,
        MODIFIED: opts.modified.join('\n'),
      };
      // Use a single bash invocation that cd's into the fixture, sources
      // the script, then prints a structured tail we parse for assertions.
      const script = `
set +e
cd "${rootDir}"
. "${COMMON_SH}"
echo "===VIOLATION_COUNT==="
echo "$VIOLATION_COUNT"
echo "===VIOLATIONS==="
echo "$VIOLATIONS"
echo "===ADVISORY==="
echo "$ADVISORY"
echo "===HAS_COMPLIANCE_CLAIMANT==="
echo "$HAS_COMPLIANCE_CLAIMANT"
`;
      return spawnSync('bash', ['-c', script], {
        env,
        encoding: 'utf8',
      });
    },
  };
}

interface ParsedHookOutput {
  violationCount: number;
  violations: string;
  advisory: string;
  hasComplianceClaimant: string;
  raw: string;
}

function parseHookOutput(stdout: string): ParsedHookOutput {
  const sections = stdout.split(/===([A-Z_]+)===\n/);
  const out: Record<string, string> = {};
  for (let i = 1; i < sections.length; i += 2) {
    out[sections[i]] = (sections[i + 1] ?? '').trimEnd();
  }
  return {
    violationCount: Number(out.VIOLATION_COUNT?.trim() ?? '0') || 0,
    violations: out.VIOLATIONS ?? '',
    advisory: out.ADVISORY ?? '',
    hasComplianceClaimant: out.HAS_COMPLIANCE_CLAIMANT?.trim() ?? '',
    raw: stdout,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

let cleanups: Array<() => void> = [];

afterEach(() => {
  cleanups.forEach((fn) => fn());
  cleanups = [];
});

describe('paradigm-common.sh — cohort gating (v6.0.4)', () => {
  // -------------------------------------------------------------------------
  // Case A: compliance rostered + drift simulated → still blocks.
  // -------------------------------------------------------------------------
  it('A: compliance rostered + drift → emits "aspect anchor(s) have drifted" violation', () => {
    const fx = seedFixture({
      rosterCompliance: true,
      complianceJson:
        '{"driftedCount":2,"healedCount":0,"usedButUndeclaredCount":0}',
      purposes: {
        '.purpose':
          'version: 2.0.0\ncomponents:\n  foo:\n    description: bar\naspects:\n  ~something:\n    description: x\n',
      },
      sources: {
        // Empty modified list; drift signal comes from the stubbed paradigm JSON.
      },
      modified: [],
    });
    cleanups.push(fx.cleanup);

    const result = fx.run();
    expect(result.status).toBe(0);
    const parsed = parseHookOutput(result.stdout);
    expect(parsed.hasComplianceClaimant).toBe('true');
    expect(parsed.violations).toContain('aspect anchor(s) have drifted');
    expect(parsed.violationCount).toBeGreaterThanOrEqual(1);
  });

  // -------------------------------------------------------------------------
  // Case B: compliance rostered + clean repo → no violations.
  // -------------------------------------------------------------------------
  it('B: compliance rostered + clean repo → zero violations', () => {
    const fx = seedFixture({
      rosterCompliance: true,
      complianceJson:
        '{"driftedCount":0,"healedCount":0,"usedButUndeclaredCount":0}',
      purposes: {
        '.purpose': 'version: 2.0.0\ncomponents:\n  foo:\n    description: bar\n',
      },
      modified: [],
    });
    cleanups.push(fx.cleanup);

    const result = fx.run();
    const parsed = parseHookOutput(result.stdout);
    expect(parsed.hasComplianceClaimant).toBe('true');
    expect(parsed.violationCount).toBe(0);
    expect(parsed.violations).not.toContain('aspect anchor(s) have drifted');
  });

  // -------------------------------------------------------------------------
  // Case C: compliance rostered + Check 4 broken anchor → blocks.
  // -------------------------------------------------------------------------
  it('C: compliance rostered + broken anchor → Check 4 still blocks', () => {
    const fx = seedFixture({
      rosterCompliance: true,
      complianceJson:
        '{"driftedCount":0,"healedCount":0,"usedButUndeclaredCount":0}',
      purposes: {
        '.purpose':
          'version: 2.0.0\nanchors:\n  - missing/file.ts: nonexistent\n',
      },
      modified: [],
    });
    cleanups.push(fx.cleanup);

    const result = fx.run();
    const parsed = parseHookOutput(result.stdout);
    expect(parsed.hasComplianceClaimant).toBe('true');
    expect(parsed.violations).toContain('Aspect anchor');
    expect(parsed.violations).toContain('does not exist');
    expect(parsed.violationCount).toBeGreaterThanOrEqual(1);
  });

  // -------------------------------------------------------------------------
  // Case D: compliance NOT rostered + Check 4 broken anchor → still blocks.
  // -------------------------------------------------------------------------
  it('D: NOT rostered + broken anchor → Check 4 still blocks (syntax stays unconditional)', () => {
    const fx = seedFixture({
      rosterCompliance: false,
      complianceJson:
        '{"driftedCount":0,"healedCount":0,"usedButUndeclaredCount":0}',
      purposes: {
        '.purpose':
          'version: 2.0.0\nanchors:\n  - missing/file.ts: nonexistent\n',
      },
      modified: [],
    });
    cleanups.push(fx.cleanup);

    const result = fx.run();
    const parsed = parseHookOutput(result.stdout);
    expect(parsed.hasComplianceClaimant).toBe('false');
    expect(parsed.violations).toContain('Aspect anchor');
    expect(parsed.violations).toContain('does not exist');
    expect(parsed.violationCount).toBeGreaterThanOrEqual(1);
  });

  // -------------------------------------------------------------------------
  // Case E: compliance NOT rostered + drift → exits 0; snapshot still written.
  // -------------------------------------------------------------------------
  it('E: NOT rostered + drift → no drift violation; compliance-history.jsonl still snapshots', () => {
    const fx = seedFixture({
      rosterCompliance: false,
      complianceJson:
        '{"driftedCount":3,"healedCount":0,"usedButUndeclaredCount":0}',
      purposes: {
        '.purpose':
          'version: 2.0.0\ncomponents:\n  foo:\n    description: bar\naspects:\n  ~something:\n    description: x\n',
      },
      modified: [],
    });
    cleanups.push(fx.cleanup);

    const historyPath = path.join(
      fx.rootDir,
      '.paradigm',
      'events',
      'compliance-history.jsonl',
    );
    const before = fs.existsSync(historyPath)
      ? fs.readFileSync(historyPath, 'utf8').split('\n').filter(Boolean).length
      : 0;

    const result = fx.run();
    const parsed = parseHookOutput(result.stdout);

    expect(parsed.hasComplianceClaimant).toBe('false');
    // Drift detected upstream (compute is unconditional) but emission is gated.
    expect(parsed.violations).not.toContain('aspect anchor(s) have drifted');

    // Loid data continuity — snapshot row added.
    expect(fs.existsSync(historyPath)).toBe(true);
    const after = fs
      .readFileSync(historyPath, 'utf8')
      .split('\n')
      .filter(Boolean).length;
    expect(after).toBe(before + 1);
    const lastLine = fs
      .readFileSync(historyPath, 'utf8')
      .trimEnd()
      .split('\n')
      .pop()!;
    expect(lastLine).toMatch(/"timestamp":"/);
    expect(lastLine).toMatch(/"violations":/);
  });

  // -------------------------------------------------------------------------
  // Case F: compliance NOT rostered + missing .purpose for modified source
  //         → Check 1/2 still block (general framework hygiene).
  // -------------------------------------------------------------------------
  it('F: NOT rostered + modified source without covering .purpose → still blocks', () => {
    const fx = seedFixture({
      rosterCompliance: false,
      complianceJson:
        '{"driftedCount":0,"healedCount":0,"usedButUndeclaredCount":0}',
      // No .purpose anywhere
      sources: {
        'src/foo.ts': 'export const foo = 1;\n',
        'src/bar.ts': 'export const bar = 2;\n',
      },
      modified: ['src/foo.ts', 'src/bar.ts'],
    });
    cleanups.push(fx.cleanup);

    const result = fx.run();
    const parsed = parseHookOutput(result.stdout);
    expect(parsed.hasComplianceClaimant).toBe('false');
    // Check 1/2 emit messages mentioning missing .purpose / covering files.
    expect(parsed.violationCount).toBeGreaterThanOrEqual(1);
    expect(parsed.violations.toLowerCase()).toMatch(/\.purpose/);
  });

  // -------------------------------------------------------------------------
  // Case G: any roster + 3+ source files modified without lore → blocks (Check 7).
  // (Spec said 4+; actual threshold is 3 — see paradigm-common.sh:458.)
  // -------------------------------------------------------------------------
  it('G: 3+ source files modified without lore entry → Check 7 blocks (any roster)', () => {
    const fx = seedFixture({
      rosterCompliance: true,
      complianceJson:
        '{"driftedCount":0,"healedCount":0,"usedButUndeclaredCount":0}',
      // Provide a covering .purpose so Check 1/2 don't also fire (we want to
      // isolate the lore-required violation here).
      purposes: {
        'src/.purpose':
          'version: 2.0.0\ncomponents:\n  foo:\n    description: bar\n',
      },
      sources: {
        'src/a.ts': 'export const a = 1;\n',
        'src/b.ts': 'export const b = 2;\n',
        'src/c.ts': 'export const c = 3;\n',
        'src/.purpose':
          'version: 2.0.0\ncomponents:\n  foo:\n    description: bar\n',
      },
      // Include the .purpose update too so Check 1/2 are satisfied.
      modified: ['src/a.ts', 'src/b.ts', 'src/c.ts', 'src/.purpose'],
    });
    cleanups.push(fx.cleanup);

    const result = fx.run();
    const parsed = parseHookOutput(result.stdout);
    // Lore-required (Check 7) message contains "no lore entry".
    expect(parsed.violations).toContain('no lore entry');
    expect(parsed.violationCount).toBeGreaterThanOrEqual(1);
  });
});
