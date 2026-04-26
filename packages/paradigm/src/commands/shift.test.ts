/**
 * v6.0.4 Wave 5 — `paradigm shift` Step 2c-nominate-compliance (case I).
 *
 * Tests the nomination prompt that runs only for cohort C
 * (existing roster + ~aspects defined + compliance NOT rostered).
 *
 * Surface under test: `runComplianceNominationStep` exported from shift.ts.
 * The function is invoked directly (rather than through the full
 * `shiftCommand` pipeline) because the latter pulls in init/scan/sync/hooks
 * and is unsuitable for an isolated unit test.
 *
 * For the TTY path, we mock `node:readline/promises`'s `createInterface`
 * to return a deterministic `question()` answer.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { runComplianceNominationStep } from './shift.js';

const ANSI_RE = /\[[0-9;]*m/g;

let tmpDir: string;
let cleanup: (() => void) | undefined;
let originalIsTTY: boolean | undefined;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'paradigm-shift-'));
  fs.mkdirSync(path.join(tmpDir, '.paradigm'), { recursive: true });
  cleanup = () => fs.rmSync(tmpDir, { recursive: true, force: true });
  // Default to TTY for nominal interactive cases; individual tests override.
  originalIsTTY = process.stdin.isTTY;
  Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true });
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  cleanup?.();
  cleanup = undefined;
  Object.defineProperty(process.stdin, 'isTTY', {
    value: originalIsTTY,
    configurable: true,
  });
  vi.restoreAllMocks();
  vi.doUnmock('node:readline/promises');
});

function writeRoster(active: string[]) {
  const data = `version: '1.0'\nproject: test\nactive:\n${active
    .map((a) => `  - ${a}`)
    .join('\n')}\n`;
  fs.writeFileSync(path.join(tmpDir, '.paradigm', 'roster.yaml'), data, 'utf8');
}

function writeAspectPurpose() {
  fs.writeFileSync(
    path.join(tmpDir, '.purpose'),
    'version: 2.0.0\naspects:\n  ~something:\n    description: x\n',
    'utf8',
  );
}

function rosterPath(): string {
  return path.join(tmpDir, '.paradigm', 'roster.yaml');
}

function skipMarkerPath(): string {
  return path.join(tmpDir, '.paradigm', '.compliance-nomination-skipped');
}

function authorityPath(): string {
  return path.join(tmpDir, '.paradigm', 'authority.yaml');
}

/**
 * Mock `node:readline/promises` so the nomination prompt receives a
 * deterministic answer. Must be called BEFORE invoking the step (vi.doMock
 * registers the mock for subsequent dynamic imports).
 */
function mockReadline(answer: string) {
  vi.doMock('node:readline/promises', () => ({
    createInterface: () => ({
      question: vi.fn().mockResolvedValue(answer),
      close: vi.fn(),
    }),
  }));
}

describe('runComplianceNominationStep — cohort gating', () => {
  // Pre-cwd: most internal predicates rely on absolute paths supplied through
  // arguments, so we don't need to mock process.cwd(). isCohortC takes
  // tmpDir directly via `cwd` parameter.

  it('I.1: cohort A (compliance already rostered) → no prompt fires', async () => {
    writeRoster(['architect', 'builder', 'compliance']);
    writeAspectPurpose();

    const consoleSpy = vi.spyOn(console, 'log');
    consoleSpy.mockClear();
    await runComplianceNominationStep(tmpDir, rosterPath(), {});
    const out = consoleSpy.mock.calls.map((c) => c.join(' ')).join('\n').replace(ANSI_RE, '');

    expect(out).not.toContain('Step 2c-nominate');
    expect(fs.existsSync(skipMarkerPath())).toBe(false);
  });

  it('I.2: cohort B (no aspects defined) → no prompt fires', async () => {
    writeRoster(['architect', 'builder']);
    // Note: no .purpose with aspects

    const consoleSpy = vi.spyOn(console, 'log');
    consoleSpy.mockClear();
    await runComplianceNominationStep(tmpDir, rosterPath(), {});
    const out = consoleSpy.mock.calls.map((c) => c.join(' ')).join('\n').replace(ANSI_RE, '');

    expect(out).not.toContain('Step 2c-nominate');
    expect(fs.existsSync(skipMarkerPath())).toBe(false);
  });

  it('I.3: cohort C + TTY + Y → prompt fires; roster updated; authority.yaml written', async () => {
    writeRoster(['architect', 'builder']);
    writeAspectPurpose();
    mockReadline('y');

    const consoleSpy = vi.spyOn(console, 'log');
    consoleSpy.mockClear();
    await runComplianceNominationStep(tmpDir, rosterPath(), {});
    const out = consoleSpy.mock.calls.map((c) => c.join(' ')).join('\n').replace(ANSI_RE, '');

    // Verify expected prompt copy fired.
    expect(out).toContain('Step 2c-nominate/6: Symbol enforcement');
    expect(out).toContain('Add Rune (compliance) to the roster');

    // Roster updated.
    const updated = yaml.load(fs.readFileSync(rosterPath(), 'utf8')) as {
      active?: string[];
    };
    expect(updated.active).toContain('compliance');

    // Authority.yaml written with archetype-default schema.
    expect(fs.existsSync(authorityPath())).toBe(true);
    const authority = yaml.load(fs.readFileSync(authorityPath(), 'utf8')) as {
      version: string;
      schema: string;
      claims: Record<string, { claimant: string; severity: string; source: string }>;
    };
    expect(authority.version).toBe('1.0');
    expect(authority.schema).toBe('v0-experimental');
    expect(authority.claims['aspect-coverage'].claimant).toBe('compliance');
    expect(authority.claims['aspect-coverage'].source).toBe('archetype-default');
  });

  it('I.4: cohort C + TTY + N → prompt fires; skip marker written; roster unchanged', async () => {
    writeRoster(['architect', 'builder']);
    writeAspectPurpose();
    mockReadline('n');

    const consoleSpy = vi.spyOn(console, 'log');
    consoleSpy.mockClear();
    await runComplianceNominationStep(tmpDir, rosterPath(), {});
    const out = consoleSpy.mock.calls.map((c) => c.join(' ')).join('\n').replace(ANSI_RE, '');

    expect(out).toContain('Add Rune (compliance) to the roster');
    expect(fs.existsSync(skipMarkerPath())).toBe(true);

    const updated = yaml.load(fs.readFileSync(rosterPath(), 'utf8')) as {
      active?: string[];
    };
    expect(updated.active).not.toContain('compliance');
    expect(fs.existsSync(authorityPath())).toBe(false);
  });

  it('I.5: cohort C + options.prompt === false → skip silently; marker written; no prompt', async () => {
    writeRoster(['architect', 'builder']);
    writeAspectPurpose();

    const consoleSpy = vi.spyOn(console, 'log');
    consoleSpy.mockClear();
    await runComplianceNominationStep(tmpDir, rosterPath(), { prompt: false });
    const out = consoleSpy.mock.calls.map((c) => c.join(' ')).join('\n').replace(ANSI_RE, '');

    expect(out).not.toContain('Step 2c-nominate');
    expect(fs.existsSync(skipMarkerPath())).toBe(true);
    expect(fs.existsSync(authorityPath())).toBe(false);
  });

  it('I.6: skip marker exists + cohort C → silent skip; no prompt', async () => {
    writeRoster(['architect', 'builder']);
    writeAspectPurpose();
    fs.writeFileSync(skipMarkerPath(), '', 'utf8');

    const consoleSpy = vi.spyOn(console, 'log');
    consoleSpy.mockClear();
    await runComplianceNominationStep(tmpDir, rosterPath(), {});
    const out = consoleSpy.mock.calls.map((c) => c.join(' ')).join('\n').replace(ANSI_RE, '');

    expect(out).not.toContain('Step 2c-nominate');
    // Roster still unchanged.
    const updated = yaml.load(fs.readFileSync(rosterPath(), 'utf8')) as {
      active?: string[];
    };
    expect(updated.active).not.toContain('compliance');
  });

  it('I.7: skip marker exists + options.force === true → marker honored upstream, helper still gates', async () => {
    // The helper itself only honors `--force` when the upstream caller (the
    // shift wrapper at lines 518-527) clears the marker. The helper bypasses
    // the marker check when options.force is true, so a Y answer should
    // succeed in writing the roster + authority.yaml.
    writeRoster(['architect', 'builder']);
    writeAspectPurpose();
    fs.writeFileSync(skipMarkerPath(), '', 'utf8');
    mockReadline('y');

    await runComplianceNominationStep(tmpDir, rosterPath(), { force: true });

    const updated = yaml.load(fs.readFileSync(rosterPath(), 'utf8')) as {
      active?: string[];
    };
    expect(updated.active).toContain('compliance');
    // Y branch clears the skip marker.
    expect(fs.existsSync(skipMarkerPath())).toBe(false);
    expect(fs.existsSync(authorityPath())).toBe(true);
  });

  it('I.8: non-TTY environment → silent skip; marker written', async () => {
    writeRoster(['architect', 'builder']);
    writeAspectPurpose();
    Object.defineProperty(process.stdin, 'isTTY', { value: false, configurable: true });

    const consoleSpy = vi.spyOn(console, 'log');
    consoleSpy.mockClear();
    await runComplianceNominationStep(tmpDir, rosterPath(), {});
    const out = consoleSpy.mock.calls.map((c) => c.join(' ')).join('\n').replace(ANSI_RE, '');

    expect(out).not.toContain('Step 2c-nominate');
    expect(fs.existsSync(skipMarkerPath())).toBe(true);
  });
});
