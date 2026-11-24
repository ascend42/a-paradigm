// #compliance-check-timings: `paradigm compliance-check --timings` reports where the time went.
// Without the flag the JSON the Stop hooks parse must be exactly what it was.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { complianceCheckCommand, SectionTimer, type ComplianceTimings } from './compliance.js';
import { createTempProject } from '../test-utils.js';

const realHome = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE };
let fakeHome = '';
let rootDir = '';
let printed: string[] = [];
let written: string[] = [];

beforeEach(() => {
  fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'compliance-home-'));
  process.env.HOME = fakeHome;
  process.env.USERPROFILE = fakeHome;
  rootDir = createTempProject({ withPurpose: true }).rootDir;
  fs.writeFileSync(
    path.join(rootDir, 'portal.yaml'),
    'version: 1.0.0\ngates:\n  signed-in:\n    description: a session exists\n',
    'utf8',
  );
  fs.mkdirSync(path.join(rootDir, 'src'), { recursive: true });
  fs.writeFileSync(path.join(rootDir, 'src', '.purpose'), 'components:\n  api:\n    gates: [^signed-in]\n', 'utf8');
  vi.spyOn(process, 'cwd').mockReturnValue(rootDir);
  printed = [];
  written = [];
  vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => { printed.push(args.join(' ')); });
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(process.stdout, 'write').mockImplementation(((chunk: string | Uint8Array) => {
    written.push(String(chunk));
    return true;
  }) as typeof process.stdout.write);
});

afterEach(() => {
  vi.restoreAllMocks();
  process.exitCode = 0;
  for (const [k, v] of Object.entries(realHome)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  fs.rmSync(rootDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  fs.rmSync(fakeHome, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

function jsonResult(): Record<string, unknown> {
  const line = printed.find((l) => l.startsWith('{'));
  if (!line) throw new Error('no JSON line printed');
  return JSON.parse(line) as Record<string, unknown>;
}

describe('compliance-check --timings', () => {
  it('without --timings the JSON has exactly the keys it had before', async () => {
    await complianceCheckCommand({ json: true, autoHeal: true, trigger: 'on-stop' });
    expect(Object.keys(jsonResult()).sort()).toEqual(['drift', 'habits', 'portal', 'structuredViolations', 'violations']);
  });

  it('with --timings the JSON gains a timings key and nothing else changes', async () => {
    await complianceCheckCommand({ json: true, autoHeal: true, trigger: 'on-stop' });
    const plain = jsonResult();
    printed = [];
    await complianceCheckCommand({ json: true, autoHeal: true, trigger: 'on-stop', timings: true });
    const timed = jsonResult();
    const { timings, ...rest } = timed as { timings: ComplianceTimings } & Record<string, unknown>;
    // sentinel recording may differ in a count between two runs; every other field is identical
    expect(Object.keys(rest).sort()).toEqual(Object.keys(plain).sort());
    expect(rest.portal).toEqual(plain.portal);
    expect(rest.drift).toEqual(plain.drift);
    expect(rest.violations).toEqual(plain.violations);

    expect(timings.startupMs).toBeGreaterThan(0);
    expect(timings.commandMs).toBeGreaterThanOrEqual(0);
    const names = timings.sections.map((s) => s.section);
    for (const expected of ['habits', 'habits.load', 'habits.evaluate', 'drift', 'portal', 'portal.file-list', 'portal.gate-files', 'portal.references', 'portal.nested-declared']) {
      expect(names).toContain(expected);
    }
    // Where the portal check's file list came from: this fixture is not a git repository
    expect(timings.fileList?.source).toBe('walk');
    expect(timings.fileList?.fallbackReason).toBe('not-a-git-repo');
    expect(timings.fileList?.files).toBeGreaterThan(0);
    // No learning pass was asked for, so none is timed
    expect(names).not.toContain('learn');
    for (const s of timings.sections) {
      expect(typeof s.ms).toBe('number');
      expect(s.ms).toBeGreaterThanOrEqual(0);
    }
    // Top-level sections run one after another inside the command
    const topLevel = timings.sections.filter((s) => !s.section.includes('.')).reduce((sum, s) => sum + s.ms, 0);
    expect(topLevel).toBeLessThanOrEqual(timings.commandMs + 1);
  });

  it('the human report prints a Timings block only with --timings', async () => {
    await complianceCheckCommand({ trigger: 'on-stop' });
    expect(written.join('')).not.toContain('Timings');
    await complianceCheckCommand({ trigger: 'on-stop', timings: true });
    const text = written.join('');
    expect(text).toContain('Timings');
    expect(text).toContain('portal.gate-files');
    expect(text).toContain('start-up');
    expect(text).toContain('directory walk');
    expect(text).toContain('not a git repository');
  });
});

describe('SectionTimer', () => {
  it('records a section even when the timed function throws', async () => {
    const timer = new SectionTimer();
    expect(() => timer.timeSync('boom', () => { throw new Error('x'); })).toThrow('x');
    await expect(timer.time('async-boom', async () => { throw new Error('y'); })).rejects.toThrow('y');
    expect(timer.timeSync('ok', () => 7)).toBe(7);
    expect(timer.sections.map((s) => s.section)).toEqual(['boom', 'async-boom', 'ok']);
  });
});
