import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { doctorCommand } from './doctor/index.js';
import { createTempProject } from '../test-utils.js';

let cleanup: (() => void) | undefined;
// Isolate from the real ~/.claude (always-on census, hook health): HOME and
// USERPROFILE point at an empty temp dir, and the healthy-path tests also pass
// it explicitly as doctorCommand's homeDir.
const realHome = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE };
let fakeHome = '';
beforeEach(() => {
  fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'doctor-home-'));
  process.env.HOME = fakeHome;
  process.env.USERPROFILE = fakeHome;
});

afterEach(() => {
  cleanup?.();
  cleanup = undefined;
  vi.restoreAllMocks();
  for (const [k, v] of Object.entries(realHome)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  fs.rmSync(fakeHome, { recursive: true, force: true });
});

/** A project that passes every doctor check. */
function healthyProject(opts: { withGit?: boolean } = {}): string {
  const { rootDir, cleanup: c } = createTempProject({
    withSpecs: true,
    withDocs: true,
    withPurpose: true,
    withScanIndex: true,
    ...(opts.withGit ? { withGit: true } : {}),
  });
  cleanup = c;
  fs.mkdirSync(path.join(rootDir, '.paradigm', 'prompts'), { recursive: true });
  fs.writeFileSync(path.join(rootDir, '.paradigm', 'specs', '.index.yaml'), 'version: 1.0.0\ndescription: stub\n', 'utf8');
  fs.writeFileSync(path.join(rootDir, '.paradigm', 'prompts', '.index.yaml'), 'version: 1.0.0\ndescription: stub\n', 'utf8');
  fs.writeFileSync(path.join(rootDir, '.premise'), '', 'utf8');
  fs.mkdirSync(path.join(rootDir, 'plugins', 'paradigm'), { recursive: true });
  fs.writeFileSync(path.join(rootDir, 'plugins', 'paradigm', 'hooks.json'), '{}', 'utf8');
  return rootDir;
}

describe('doctorCommand', () => {
  it('returns true for healthy project', async () => {
    const { rootDir, cleanup: c } = createTempProject({
      withSpecs: true,
      withDocs: true,
      withPurpose: true,
      withScanIndex: true,
    });
    cleanup = c;
    // Doctor checks for prompts dir, .premise file, and hooks
    fs.mkdirSync(path.join(rootDir, '.paradigm', 'prompts'), { recursive: true });
    // Satisfy docs-class index check — add .index.yaml stubs for specs and prompts
    fs.writeFileSync(path.join(rootDir, '.paradigm', 'specs', '.index.yaml'), 'version: 1.0.0\ndescription: stub\n', 'utf8');
    fs.writeFileSync(path.join(rootDir, '.paradigm', 'prompts', '.index.yaml'), 'version: 1.0.0\ndescription: stub\n', 'utf8');
    fs.writeFileSync(path.join(rootDir, '.premise'), '', 'utf8');
    // Create hooks so the hooks check passes
    fs.mkdirSync(path.join(rootDir, 'plugins', 'paradigm'), { recursive: true });
    fs.writeFileSync(path.join(rootDir, 'plugins', 'paradigm', 'hooks.json'), '{}', 'utf8');
    const result = await doctorCommand({ quiet: true, rootDir, homeDir: fakeHome });
    expect(result).toBe(true);
  });

  it('B1: Paradigm always-on text over the cap is advisory, so the project stays healthy', async () => {
    const rootDir = healthyProject();
    fs.appendFileSync(path.join(rootDir, '.paradigm', 'config.yaml'), '\ncontext:\n  always-on-max-chars: 100\n', 'utf8');
    fs.writeFileSync(path.join(rootDir, 'CLAUDE.md'), 'x'.repeat(150), 'utf8');
    expect(await doctorCommand({ quiet: true, rootDir, homeDir: fakeHome })).toBe(true);
  });

  it('reports an outdated Paradigm git hook (still running npx paradigm)', async () => {
    const { rootDir, cleanup: c } = createTempProject({
      withSpecs: true,
      withDocs: true,
      withPurpose: true,
      withScanIndex: true,
      withGit: true,
    });
    cleanup = c;
    fs.mkdirSync(path.join(rootDir, '.paradigm', 'prompts'), { recursive: true });
    fs.writeFileSync(path.join(rootDir, '.paradigm', 'specs', '.index.yaml'), 'version: 1.0.0\ndescription: stub\n', 'utf8');
    fs.writeFileSync(path.join(rootDir, '.paradigm', 'prompts', '.index.yaml'), 'version: 1.0.0\ndescription: stub\n', 'utf8');
    fs.writeFileSync(path.join(rootDir, '.premise'), '', 'utf8');
    fs.mkdirSync(path.join(rootDir, 'plugins', 'paradigm'), { recursive: true });
    fs.writeFileSync(path.join(rootDir, 'plugins', 'paradigm', 'hooks.json'), '{}', 'utf8');
    const hook = path.join(rootDir, '.git', 'hooks', 'pre-push');
    fs.writeFileSync(hook, '#!/bin/sh\n# Paradigm pre-push hook - reindex history before pushing\n# Installed by: paradigm hooks install\nnpx paradigm history reindex\n');
    const lines: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => { lines.push(a.join(' ')); });
    expect(await doctorCommand({ rootDir, homeDir: fakeHome })).toBe(false);
    expect(lines.join('\n')).toMatch(/Git pre-push hook[\s\S]*Outdated \(v1, current v3\) and still runs `npx paradigm`/);
    // Without the hook the same project is healthy.
    fs.rmSync(hook);
    expect(await doctorCommand({ quiet: true, rootDir, homeDir: fakeHome })).toBe(true);
  });

  it('detects missing .paradigm/', async () => {
    const { rootDir, cleanup: c } = createTempProject();
    cleanup = c;
    // Remove .paradigm directory
    fs.rmSync(path.join(rootDir, '.paradigm'), { recursive: true });
    const result = await doctorCommand({ quiet: true, rootDir });
    expect(result).toBe(false);
  });

  it('detects legacy .paradigm file', async () => {
    const { rootDir, cleanup: c } = createTempProject();
    cleanup = c;
    // Replace directory with file
    fs.rmSync(path.join(rootDir, '.paradigm'), { recursive: true });
    fs.writeFileSync(path.join(rootDir, '.paradigm'), 'version: 1.0', 'utf8');
    const result = await doctorCommand({ quiet: true, rootDir });
    // Legacy format results in 'warn' status, not 'ok', so not fully healthy
    expect(result).toBe(false);
  });

  it('detects invalid config.yaml', async () => {
    const { rootDir, cleanup: c } = createTempProject();
    cleanup = c;
    fs.writeFileSync(
      path.join(rootDir, '.paradigm', 'config.yaml'),
      '{{invalid yaml::: [',
      'utf8',
    );
    const result = await doctorCommand({ quiet: true, rootDir });
    expect(result).toBe(false);
  });

  it('detects missing specs directory', async () => {
    const { rootDir, cleanup: c } = createTempProject();
    cleanup = c;
    // No specs directory = missing status
    const result = await doctorCommand({ quiet: true, rootDir });
    expect(result).toBe(false);
  });

  it('detects stale scan index (>24h)', async () => {
    const { rootDir, cleanup: c } = createTempProject({ withScanIndex: true });
    cleanup = c;
    // Set mtime to 25 hours ago
    const indexPath = path.join(rootDir, '.paradigm', 'scan-index.json');
    const past = new Date(Date.now() - 25 * 60 * 60 * 1000);
    fs.utimesSync(indexPath, past, past);
    const result = await doctorCommand({ quiet: true, rootDir });
    expect(result).toBe(false);
  });

  it('detects missing root .purpose', async () => {
    const { rootDir, cleanup: c } = createTempProject({
      withSpecs: true,
      withDocs: true,
      withScanIndex: true,
    });
    cleanup = c;
    fs.mkdirSync(path.join(rootDir, '.paradigm', 'prompts'), { recursive: true });
    // No .purpose file at root
    const result = await doctorCommand({ quiet: true, rootDir });
    expect(result).toBe(false);
  });

  it('spec-presence check looks for probe.md (not legacy scan.md)', async () => {
    // Regression guard for the scan→probe rename. The template ships
    // `specs/probe.md`; doctor must check for that filename, not the legacy
    // `specs/scan.md`. A mismatch caused fresh projects to report
    // "Spec file not found" warnings for scan.md.
    const { rootDir, cleanup: c } = createTempProject({ withSpecs: true });
    cleanup = c;
    // createTempProject({ withSpecs: true }) writes logger.md, probe.md, symbols.md
    // (post-rename). Confirm the probe spec exists on disk.
    expect(fs.existsSync(path.join(rootDir, '.paradigm', 'specs', 'probe.md'))).toBe(true);
    expect(fs.existsSync(path.join(rootDir, '.paradigm', 'specs', 'scan.md'))).toBe(false);

    // Capture doctor output to verify no "Spec file not found" for either name.
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await doctorCommand({ rootDir });
    const allOutput = consoleSpy.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(allOutput).not.toMatch(/specs\/scan\.md.*not found/i);
    expect(allOutput).not.toMatch(/specs\/probe\.md.*not found/i);
  });

  it('classroom health: renders calmly with no certification data', async () => {
    // No .paradigm/events/classroom-certifications.jsonl → must not throw and
    // must show the calm "no certifications yet" line, never an error.
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const { rootDir, cleanup: c } = createTempProject({
      withSpecs: true,
      withDocs: true,
      withPurpose: true,
      withScanIndex: true,
    });
    cleanup = c;
    await doctorCommand({ rootDir });
    const allOutput =
      consoleSpy.mock.calls.map((a) => a.join(' ')).join('\n') +
      '\n' +
      writeSpy.mock.calls.map((a) => String(a[0])).join('');
    expect(allOutput).toContain('Classroom / learning health');
    expect(allOutput).toMatch(/No certifications yet/i);
  });

  it('classroom health: shows the repeat-failure-rate with an overturned cert', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const { rootDir, cleanup: c } = createTempProject({
      withSpecs: true,
      withDocs: true,
      withPurpose: true,
      withScanIndex: true,
    });
    cleanup = c;
    const eventsDir = path.join(rootDir, '.paradigm', 'events');
    fs.mkdirSync(eventsDir, { recursive: true });
    // 1 overturned + 1 survived = 2 resolved → rate 0.5 (not above the 0.5
    // warn threshold, and resolved < floor of 3, so no WARN — but the block
    // and rate must render without throwing).
    fs.writeFileSync(
      path.join(eventsDir, 'classroom-certifications.jsonl'),
      [
        JSON.stringify({ agent: 'builder', entryId: 'e1', outcome: 'overturned' }),
        // an EVIDENCED survival (T-2026-11-03-001): exercised and probed, so it counts as resolved
        JSON.stringify({ agent: 'builder', entryId: 'e2', outcome: 'survived', exercise: { timesExercised: 2, adversarialProbes: 1 } }),
      ].join('\n') + '\n',
      'utf8',
    );
    await doctorCommand({ rootDir });
    const allOutput =
      consoleSpy.mock.calls.map((a) => a.join(' ')).join('\n') +
      '\n' +
      writeSpy.mock.calls.map((a) => String(a[0])).join('');
    expect(allOutput).toContain('Classroom / learning health');
    expect(allOutput).toContain('repeat-failure-rate');
    expect(allOutput).toMatch(/0\.5/);
    // S4: the rate names its population (these rows have no home or author: legacy).
    expect(allOutput).toContain('repeat-failure-rate [population: legacy-prior]');
    // S4: the census line per home, with the legacy count.
    expect(allOutput).toMatch(/Learning census\s+classroom-certifications: repo 2 \(legacy 2\) · user 0 · machine 0 · last write/);
    // The healthy "loop is correcting" advisory fires on the overturned cert.
    expect(allOutput).toMatch(/loop is correcting/i);
  });

  it('classroom health (ruling 6): an empty exercises ledger is said plainly, not a silent n/a', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const rootDir = healthyProject();
    const eventsDir = path.join(rootDir, '.paradigm', 'events');
    fs.mkdirSync(eventsDir, { recursive: true });
    fs.writeFileSync(
      path.join(eventsDir, 'classroom-certifications.jsonl'),
      JSON.stringify({ agent: 'builder', entryId: 'e1', outcome: 'pending', ts: '2026-01-01T00:00:00.000Z' }) + '\n',
      'utf8',
    );
    const output = async () => {
      consoleSpy.mockClear();
      writeSpy.mockClear();
      await doctorCommand({ rootDir, homeDir: fakeHome });
      return consoleSpy.mock.calls.map((a) => a.join(' ')).join('\n') + '\n' + writeSpy.mock.calls.map((a) => String(a[0])).join('');
    };
    const empty = await output();
    expect(empty).toContain('no exercise events recorded yet (spec sub-phase 1): no cert can survive');
    expect(empty).not.toContain('n/a (no certs resolved yet)');

    fs.writeFileSync(
      path.join(eventsDir, 'classroom-exercises.jsonl'),
      JSON.stringify({ ts: '2026-01-02T00:00:00.000Z', certEntryId: 'e1', orchestrationId: 'o1', agent: 'builder', kind: 'application' }) + '\n',
      'utf8',
    );
    const withRows = await output();
    expect(withRows).not.toContain('no exercise events recorded yet');
  });

  it('quiet mode suppresses doctor console output', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const { rootDir, cleanup: c } = createTempProject();
    cleanup = c;
    await doctorCommand({ quiet: true, rootDir });
    // Doctor's own output is suppressed; only the logger may emit info lines
    const doctorCalls = consoleSpy.mock.calls.filter(
      (args) => {
        const str = String(args[0]);
        return !str.includes('[doctor]') && !str.includes('[doctor:');
      },
    );
    expect(doctorCalls).toHaveLength(0);
  });
});
