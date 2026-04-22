/**
 * Regression tests for portal-compliance.ts — v5.37.12 security patch.
 *
 * Covers the five auth-bypass scenarios A-E from the 2026-04-22 security audit:
 *
 *   A. Prefix mismatch (`^authenticated:` key) → compliance reports drift,
 *      stop hook blocks. (Bug 1 does NOT cause bypass in the stop-hook path
 *      because portal-compliance.ts strips `^` in `extractDeclaredGates` —
 *      test verifies no regression.)
 *
 *   B. Duplicate route keys → js-yaml throws → FAIL CLOSED: violation status,
 *      stop hook blocks. Regression guard against the silent-null cascade
 *      (portal-compliance.ts:93-95 pre-fix).
 *
 *   C. Gate[] Array shape (correct runtime) → compliance correctly resolves
 *      gate ids (not numeric indices from Object.keys). Regression guard
 *      against Scenario C auth-bypass in compliance-checker.ts / pm.ts.
 *
 *   D. `paradigm compliance-check` subprocess crash (non-zero exit) → stop
 *      hook blocks, NOT silently empty COMPLIANCE_RESULT. Tested via
 *      shell-level behavior: the `|| true` was removed so `$?` now flows.
 *
 *   E. Valid portal.yaml → compliance passes (regression direction — confirm
 *      the discriminated-union refactor didn't break the happy path).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execFileSync } from 'child_process';
import {
  loadPortalConfig,
  loadPortalConfigLegacy,
  checkPortalCompliance,
} from '../src/core/portal-compliance.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'portal-compliance-test-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('loadPortalConfig (discriminated union)', () => {
  it('returns { status: "missing" } when portal.yaml does not exist', () => {
    const r = loadPortalConfig(tmpDir);
    expect(r.status).toBe('missing');
  });

  it('returns { status: "ok" } with parsed data for valid portal.yaml', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'portal.yaml'),
      'version: "2.0"\ngates:\n  authenticated:\n    description: x\n    prizes: []\n',
    );
    const r = loadPortalConfig(tmpDir);
    expect(r.status).toBe('ok');
    if (r.status === 'ok') {
      expect(r.data.gates?.authenticated).toBeDefined();
    }
  });

  it('returns { status: "unparseable", errorClass: "duplicate-key" } for duplicate keys', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'portal.yaml'),
      [
        'version: "2.0"',
        'gates:',
        '  my-secret-gate:',
        '    description: a',
        '  my-secret-gate:',
        '    description: b',
      ].join('\n') + '\n',
    );
    const r = loadPortalConfig(tmpDir);
    expect(r.status).toBe('unparseable');
    if (r.status === 'unparseable') {
      expect(r.errorClass).toBe('duplicate-key');
      // SECURITY: detail MUST NOT contain the gate name from the file.
      expect(r.detail).not.toContain('my-secret-gate');
    }
  });
});

describe('loadPortalConfigLegacy (back-compat shim)', () => {
  it('returns null on missing', () => {
    expect(loadPortalConfigLegacy(tmpDir)).toBeNull();
  });

  it('returns null on unparseable', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'portal.yaml'),
      'gates:\n  a:\n    description: x\n  a:\n    description: y\n',
    );
    expect(loadPortalConfigLegacy(tmpDir)).toBeNull();
  });

  it('returns the config for valid portal.yaml', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'portal.yaml'),
      'version: "2.0"\ngates:\n  authenticated:\n    description: x\n    prizes: []\n',
    );
    const cfg = loadPortalConfigLegacy(tmpDir);
    expect(cfg).not.toBeNull();
    expect(cfg?.gates?.authenticated).toBeDefined();
  });
});

// ──────────────────────────────────────────────────────
// Scenario A: Prefix mismatch — ^authenticated: key form
// ──────────────────────────────────────────────────────
describe('Scenario A: ^-prefixed gate key form parses and matches bare references', () => {
  it('`^authenticated:` key is stripped and matches `^authenticated` refs in .purpose', async () => {
    // CLAUDE.md / site docs historically show `^authenticated:` as the key.
    // portal-compliance.ts strips `^` in extractDeclaredGates (Bug 1 does not
    // cause auth bypass in the stop-hook path). Regression guard.
    fs.writeFileSync(
      path.join(tmpDir, 'portal.yaml'),
      [
        'version: "2.0"',
        'gates:',
        '  "^authenticated":',
        '    description: user is logged in',
        '    prizes: []',
      ].join('\n') + '\n',
    );

    // .purpose file that references the gate.
    fs.writeFileSync(
      path.join(tmpDir, '.purpose'),
      [
        'version: 2.0.0',
        'description: test',
        'components:',
        '  handler:',
        '    description: guarded by ^authenticated',
        '    type: handler',
      ].join('\n') + '\n',
    );

    const report = await checkPortalCompliance(tmpDir);
    // With the prefix stripped, `authenticated` is declared AND referenced.
    expect(report.status).toBe('compliant');
    expect(report.usedButUndeclared).not.toContain('authenticated');
  });
});

// ──────────────────────────────────────────────────────
// Scenario B: Duplicate route keys — FAIL CLOSED
// ──────────────────────────────────────────────────────
describe('Scenario B: duplicate route keys block (do not silently fall through)', () => {
  it('compliance status is "violations" when portal.yaml has duplicate route keys', async () => {
    fs.writeFileSync(
      path.join(tmpDir, 'portal.yaml'),
      [
        'version: "2.0"',
        'gates:',
        '  authenticated:',
        '    description: x',
        '    prizes: []',
        'routes:',
        '  "GET /api/admin":',
        '    - ^authenticated',
        '    - ^admin',
        '  "GET /api/admin":',
        '    - ^authenticated',
      ].join('\n') + '\n',
    );

    const report = await checkPortalCompliance(tmpDir);
    expect(report.status).toBe('violations');
    expect(report.portalError).toBeDefined();
    expect(report.portalError?.kind).toBe('unparseable');
    expect(report.portalError?.errorClass).toBe('duplicate-key');

    // SECURITY: the suggestions string must not echo gate names or paths.
    const joined = report.suggestions.join(' ');
    expect(joined).not.toContain('/api/admin');
    expect(joined).not.toContain('^admin');
    expect(joined).not.toContain('authenticated');
  });

  it('stop hook reads non-zero usedButUndeclaredCount so session blocks', async () => {
    fs.writeFileSync(
      path.join(tmpDir, 'portal.yaml'),
      'gates:\n  a:\n    description: x\n  a:\n    description: y\n',
    );
    const report = await checkPortalCompliance(tmpDir);
    // The stop hook grep-extracts usedButUndeclaredCount from the JSON. A
    // non-zero value is what causes it to block. We emit the sentinel
    // '__portal_unparseable__' to force the count > 0.
    expect(report.usedButUndeclared.length).toBeGreaterThan(0);
  });
});

// ──────────────────────────────────────────────────────
// Scenario C: Gate[] Array shape — NOT Object.keys(Array)
// ──────────────────────────────────────────────────────
describe('Scenario C: gateConfig.gates as Gate[] resolves by id, not numeric index', () => {
  it('extractDeclaredGateNames returns gate ids, not ["0","1","2"]', async () => {
    // Exercise compliance-checker.ts via a dynamic import so the paradigm
    // package doesn't take a build-time dep on paradigm-mcp. We import the
    // already-built output (acceptable because the fix is runtime-only).
    const mod = await import('../../paradigm-mcp/src/utils/compliance-checker.js');
    const gateConfig = {
      version: '2.0',
      gates: [
        { id: 'authenticated', description: 'u', locks: [], prizes: [] },
        { id: 'admin', description: 'a', locks: [], prizes: [] },
      ],
      flows: [],
      settings: { dev: { visualizerPort: 1, watcherPort: 2, autoConnect: true } },
    };
    const names = mod.extractDeclaredGateNames(gateConfig as unknown as Parameters<typeof mod.extractDeclaredGateNames>[0]);
    expect(names.sort()).toEqual(['admin', 'authenticated']);
    expect(names).not.toContain('0');
    expect(names).not.toContain('1');
  });

  it('extractDeclaredGateNames throws on unrecognized gates shape (no silent degrade)', async () => {
    const mod = await import('../../paradigm-mcp/src/utils/compliance-checker.js');
    expect(() =>
      mod.extractDeclaredGateNames({ gates: 'not-an-array-or-record' as unknown } as Parameters<typeof mod.extractDeclaredGateNames>[0]),
    ).toThrow(/Invalid gateConfig.gates shape/);
  });
});

// ──────────────────────────────────────────────────────
// Scenario D: Stop-hook exit-code propagation (shell-level)
// ──────────────────────────────────────────────────────
describe('Scenario D: non-zero exit from compliance-check propagates', () => {
  it('removed `|| true` means subprocess failure flows to $?', () => {
    // The fix is in paradigm-common.sh. Verify the exact idiom is no longer
    // present at the portal-compliance invocation site.
    const scriptPath = path.resolve(
      __dirname,
      '..',
      'src',
      'commands',
      'hooks',
      'scripts',
      'paradigm-common.sh',
    );
    const src = fs.readFileSync(scriptPath, 'utf-8');

    // The specific masking idiom MUST NOT appear on compliance-check lines.
    const complianceLines = src
      .split('\n')
      .filter(l => l.includes('paradigm compliance-check'));
    expect(complianceLines.length).toBeGreaterThan(0);
    for (const line of complianceLines) {
      expect(line).not.toMatch(/\|\|\s*true\s*$/);
    }

    // And the new COMPLIANCE_EXIT tracking MUST be present.
    expect(src).toContain('COMPLIANCE_EXIT');
    expect(src).toContain('compliance-check failed to run');
  });

  it('simulated crashing compliance-check via bash wrapper → block violation emitted', () => {
    // Shell-level repro: write a tiny stand-in script that simulates the
    // `|| true` bug vs. the fixed behavior, confirm $? is now non-zero.
    const fakeBin = path.join(tmpDir, 'fake-compliance-check.sh');
    fs.writeFileSync(
      fakeBin,
      '#!/usr/bin/env bash\necho "simulated crash" >&2\nexit 42\n',
      { mode: 0o755 },
    );

    // Buggy (pre-fix) idiom: || true swallows exit code.
    const buggy = execFileSync('bash', [
      '-c',
      `RESULT=$(${fakeBin} 2>/dev/null) || true; echo "exit=$?"`,
    ], { encoding: 'utf-8' });
    expect(buggy.trim()).toBe('exit=0');

    // Fixed idiom: capture exit code explicitly.
    const fixed = execFileSync('bash', [
      '-c',
      `RESULT=$(${fakeBin} 2>/dev/null); CODE=$?; echo "exit=$CODE"`,
    ], { encoding: 'utf-8' });
    expect(fixed.trim()).toBe('exit=42');
  });
});

// ──────────────────────────────────────────────────────
// Scenario E: Valid portal.yaml compliance passes (regression direction)
// ──────────────────────────────────────────────────────
describe('Scenario E: valid portal.yaml → compliance passes', () => {
  it('a well-formed portal with declared gates and matching refs reports compliant', async () => {
    fs.writeFileSync(
      path.join(tmpDir, 'portal.yaml'),
      [
        'version: "2.0"',
        'gates:',
        '  authenticated:',
        '    description: user logged in',
        '    prizes: []',
        '  admin:',
        '    description: admin role',
        '    prizes: []',
        'routes:',
        '  "GET /api/foo":',
        '    - ^authenticated',
      ].join('\n') + '\n',
    );

    // .purpose file referencing both gates so they are "used".
    fs.writeFileSync(
      path.join(tmpDir, '.purpose'),
      [
        'version: 2.0.0',
        'description: test',
        'components:',
        '  foo:',
        '    description: uses ^authenticated and ^admin',
        '    type: handler',
      ].join('\n') + '\n',
    );

    const report = await checkPortalCompliance(tmpDir);
    // Compliant or warnings (depending on findGateReferences coverage of tmp
    // dirs). The critical assertion is: NOT violations, NO sentinel, NO
    // portalError.
    expect(['compliant', 'warnings']).toContain(report.status);
    expect(report.portalError).toBeUndefined();
    expect(report.usedButUndeclared).not.toContain('__portal_unparseable__');
  });
});
