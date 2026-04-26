/**
 * v6.0.4 Wave 5 — Doctor aspect-coverage line formatting (case H).
 *
 * Verifies the new "Aspect coverage" CheckResult emitted by `doctorCommand`
 * (packages/paradigm/src/commands/doctor/index.ts:450-509):
 *
 *   compliance rostered + aspects > 0   → "(claimant: rune)" status=ok
 *   NOT rostered + aspects > 0          → "(no claimant active)" status=info
 *   any roster + aspects == 0           → "(no aspects defined)"   status=info
 *   components == 0                     → line entirely suppressed
 *
 * The output is captured via console.log spy, then ANSI-stripped before
 * substring-matching to remain robust to chalk colorization.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { doctorCommand } from '../src/commands/doctor/index.js';
import { createTempProject } from '../src/test-utils.js';

const ANSI_RE = /\[[0-9;]*m/g;

let cleanup: (() => void) | undefined;

afterEach(() => {
  cleanup?.();
  cleanup = undefined;
  vi.restoreAllMocks();
});

function captureDoctorOutput(rootDir: string): Promise<string> {
  const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
  return doctorCommand({ rootDir }).then(() => {
    const lines = spy.mock.calls.map((args) => args.join(' ')).join('\n');
    return lines.replace(ANSI_RE, '');
  });
}

function writeRoster(rootDir: string, withCompliance: boolean) {
  const active = withCompliance
    ? ['architect', 'builder', 'compliance']
    : ['architect', 'builder'];
  const yaml = `version: '1.0'\nactive:\n${active
    .map((a) => `  - ${a}`)
    .join('\n')}\n`;
  fs.writeFileSync(path.join(rootDir, '.paradigm', 'roster.yaml'), yaml, 'utf8');
}

function writeScanIndex(rootDir: string, components: number, aspects: number) {
  const buildMap = (n: number, prefix: string) =>
    Object.fromEntries(
      Array.from({ length: n }, (_, i) => [`${prefix}-${i}`, { id: `${prefix}-${i}` }]),
    );
  const data = {
    $meta: { generatedAt: new Date().toISOString(), project: 'test' },
    components: buildMap(components, 'comp'),
    aspects: buildMap(aspects, 'asp'),
    features: {},
    flows: {},
    state: {},
    gates: {},
    signals: {},
  };
  fs.writeFileSync(
    path.join(rootDir, '.paradigm', 'scan-index.json'),
    JSON.stringify(data),
    'utf8',
  );
}

describe('doctorCommand — aspect coverage line (v6.0.4)', () => {
  it('H.1: compliance rostered + non-zero aspects → "(claimant: rune)"', async () => {
    const { rootDir, cleanup: c } = createTempProject({ withScanIndex: false });
    cleanup = c;
    writeRoster(rootDir, true);
    writeScanIndex(rootDir, 5, 3);

    const out = await captureDoctorOutput(rootDir);
    expect(out).toMatch(/Aspect coverage/);
    expect(out).toContain('5:3 components:aspects (claimant: rune)');
    expect(out).not.toContain('(no claimant active)');
    expect(out).not.toContain('(no aspects defined)');
  });

  it('H.2: NOT rostered + non-zero aspects → "(no claimant active)"', async () => {
    const { rootDir, cleanup: c } = createTempProject({ withScanIndex: false });
    cleanup = c;
    writeRoster(rootDir, false);
    writeScanIndex(rootDir, 5, 3);

    const out = await captureDoctorOutput(rootDir);
    expect(out).toMatch(/Aspect coverage/);
    expect(out).toContain('5:3 components:aspects');
    expect(out).toContain('(no claimant active)');
    expect(out).not.toContain('(claimant: rune)');
  });

  it('H.3a: zero aspects (any roster) → "(no aspects defined)"', async () => {
    const { rootDir, cleanup: c } = createTempProject({ withScanIndex: false });
    cleanup = c;
    writeRoster(rootDir, false);
    writeScanIndex(rootDir, 5, 0);

    const out = await captureDoctorOutput(rootDir);
    expect(out).toContain('5:0 components:aspects');
    expect(out).toContain('(no aspects defined)');
    expect(out).not.toContain('(no claimant active)');
  });

  it('H.3b: zero aspects + compliance rostered → "(claimant: rune)" wins (rostered branch checked first)', async () => {
    // Implementation precedence: complianceRostered branch is evaluated
    // before the aspectCount === 0 branch (doctor/index.ts:484-500), so
    // an unused-but-rostered Rune still gets credit.
    const { rootDir, cleanup: c } = createTempProject({ withScanIndex: false });
    cleanup = c;
    writeRoster(rootDir, true);
    writeScanIndex(rootDir, 5, 0);

    const out = await captureDoctorOutput(rootDir);
    expect(out).toContain('5:0 components:aspects');
    expect(out).toContain('(claimant: rune)');
    expect(out).not.toContain('(no aspects defined)');
  });

  it('H.4: zero components → aspect-coverage line entirely suppressed', async () => {
    const { rootDir, cleanup: c } = createTempProject({ withScanIndex: false });
    cleanup = c;
    writeRoster(rootDir, true);
    writeScanIndex(rootDir, 0, 0);

    const out = await captureDoctorOutput(rootDir);
    // Header may still mention "Aspect" elsewhere but the formatted line uses
    // a colon-and-space ratio. Assert neither the rostered nor the no-claimant
    // suffix appear, and no "components:aspects" pattern is rendered.
    expect(out).not.toContain('components:aspects');
    expect(out).not.toContain('(claimant: rune)');
    expect(out).not.toContain('(no claimant active)');
    expect(out).not.toContain('(no aspects defined)');
  });
});
