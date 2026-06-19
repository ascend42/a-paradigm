import { describe, it, expect, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { doctorCommand } from './doctor/index.js';
import { createTempProject } from '../test-utils.js';

let cleanup: (() => void) | undefined;

afterEach(() => {
  cleanup?.();
  cleanup = undefined;
  vi.restoreAllMocks();
});

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
    const result = await doctorCommand({ quiet: true, rootDir });
    expect(result).toBe(true);
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
        JSON.stringify({ agent: 'builder', entryId: 'e2', outcome: 'survived' }),
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
    // The healthy "loop is correcting" advisory fires on the overturned cert.
    expect(allOutput).toMatch(/loop is correcting/i);
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
