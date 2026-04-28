/**
 * override.test.ts — v6.1 Sprint 1 Wave 5 cases E + F
 *
 * Tests `paradigm override` CLI subcommands by direct import of the
 * handler functions (overrideClearOne / overrideList / overrideClearAll).
 * Subprocess pattern was tried first but failed in the full suite because
 * integration-build.test.ts rebuilds paradigm in parallel and the linked
 * binary state becomes inconsistent. Direct import avoids that entirely.
 *
 * Cases per spec §9:
 *   E — paradigm override <id> clears + writes event
 *   F — paradigm override list shows active
 *
 * Spec: .paradigm/research/v6.1-sprint-1-spec.md §5, §9
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as fsp from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import * as yaml from 'js-yaml';
import {
  overrideClearOne,
  overrideList,
  overrideClearAll,
} from '../src/commands/override.js';

let tmpDir: string;
let prevCwd: string;
let stdoutWriteSpy: ReturnType<typeof vi.spyOn>;
let stderrWriteSpy: ReturnType<typeof vi.spyOn>;
let exitSpy: ReturnType<typeof vi.spyOn>;
let stdoutCaptured: string;
let stderrCaptured: string;

function writeFixtureRemediation(
  cwd: string,
  id: string,
  fields: {
    claimant?: string;
    severity?: 'advise' | 'auto-author' | 'guard';
    reason?: string;
    unblock_hint?: string;
    created?: string;
    expires_at?: string;
  } = {}
): string {
  const remediationsDir = path.join(cwd, '.paradigm', 'remediations');
  fs.mkdirSync(remediationsDir, { recursive: true });
  const filePath = path.join(remediationsDir, `${id}.yaml`);
  const content = yaml.dump({
    id,
    claimant: fields.claimant ?? 'compliance',
    severity: fields.severity ?? 'guard',
    reason: fields.reason ?? 'test remediation',
    unblock_hint: fields.unblock_hint ?? 'resolve the underlying issue',
    created: fields.created ?? new Date().toISOString(),
    ...(fields.expires_at ? { expires_at: fields.expires_at } : {}),
  });
  fs.writeFileSync(filePath, content, 'utf8');
  return filePath;
}

beforeEach(async () => {
  tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'paradigm-override-'));
  prevCwd = process.cwd();
  process.chdir(tmpDir);
  stdoutCaptured = '';
  stderrCaptured = '';
  // Spy on process.stdout.write — cli-output.ts out()/json()/success() use this directly
  stdoutWriteSpy = vi.spyOn(process.stdout, 'write').mockImplementation(((chunk: string | Uint8Array) => {
    stdoutCaptured += typeof chunk === 'string' ? chunk : chunk.toString();
    return true;
  }) as typeof process.stdout.write);
  stderrWriteSpy = vi.spyOn(process.stderr, 'write').mockImplementation(((chunk: string | Uint8Array) => {
    stderrCaptured += typeof chunk === 'string' ? chunk : chunk.toString();
    return true;
  }) as typeof process.stderr.write);
  // Intercept process.exit so error paths don't kill the test runner
  exitSpy = vi.spyOn(process, 'exit').mockImplementation((code?: string | number | null | undefined) => {
    throw new Error(`process.exit(${code ?? 0})`);
  });
});

afterEach(async () => {
  stdoutWriteSpy.mockRestore();
  stderrWriteSpy.mockRestore();
  exitSpy.mockRestore();
  process.chdir(prevCwd);
  await fsp.rm(tmpDir, { recursive: true, force: true });
});

describe('paradigm override (cases E + F)', () => {
  // Case E: paradigm override <id> clears + writes event
  it('E.1 — `overrideClearOne(<id>)` archives the YAML', async () => {
    writeFixtureRemediation(tmpDir, 'rmd-test1');
    const sourcePath = path.join(tmpDir, '.paradigm/remediations/rmd-test1.yaml');
    const archivedPath = path.join(tmpDir, '.paradigm/remediations/.archived/rmd-test1.yaml');

    expect(fs.existsSync(sourcePath)).toBe(true);
    expect(fs.existsSync(archivedPath)).toBe(false);

    await overrideClearOne('rmd-test1');

    expect(fs.existsSync(sourcePath)).toBe(false);
    expect(fs.existsSync(archivedPath)).toBe(true);
  });

  it('E.2 — archived YAML carries archived_at stamp', async () => {
    writeFixtureRemediation(tmpDir, 'rmd-test2');
    await overrideClearOne('rmd-test2');

    const archivedContent = fs.readFileSync(
      path.join(tmpDir, '.paradigm/remediations/.archived/rmd-test2.yaml'),
      'utf8'
    );
    const parsed = yaml.load(archivedContent) as { archived_at?: string };
    expect(parsed.archived_at).toBeTruthy();
    expect(parsed.archived_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('E.3 — appends override event row to overrides.jsonl with mechanism: cli', async () => {
    writeFixtureRemediation(tmpDir, 'rmd-test3', { claimant: 'compliance' });
    await overrideClearOne('rmd-test3');

    const jsonlPath = path.join(tmpDir, '.paradigm/events/overrides.jsonl');
    expect(fs.existsSync(jsonlPath)).toBe(true);

    const rows = fs
      .readFileSync(jsonlPath, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line));

    expect(rows.length).toBe(1);
    expect(rows[0]).toMatchObject({
      remediation_id: 'rmd-test3',
      claimant: 'compliance',
      mechanism: 'cli',
      unblock_predicate_matched: false,
    });
    expect(rows[0].timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('E.4 — `overrideClearOne(<missing-id>)` triggers process.exit(1)', async () => {
    fs.mkdirSync(path.join(tmpDir, '.paradigm/remediations'), { recursive: true });
    await expect(overrideClearOne('rmd-doesnotexist')).rejects.toThrow('process.exit(1)');
  });

  // Case F: paradigm override list shows active
  it('F.1 — `overrideList` (empty) emits JSON [] in non-TTY', async () => {
    fs.mkdirSync(path.join(tmpDir, '.paradigm/remediations'), { recursive: true });
    await overrideList();

    // Find the JSON output among the calls (json() helper writes one)
    const allOutput = stdoutCaptured;
    expect(allOutput).toContain('[]');
  });

  it('F.2 — `overrideList` shows active remediations in non-TTY JSON', async () => {
    writeFixtureRemediation(tmpDir, 'rmd-listA', {
      claimant: 'compliance',
      severity: 'guard',
      reason: 'first',
    });
    writeFixtureRemediation(tmpDir, 'rmd-listB', {
      claimant: 'security',
      severity: 'advise',
      reason: 'second',
    });

    await overrideList();

    // json() pretty-prints multi-line — parse the whole captured stdout as JSON
    const parsed = JSON.parse(stdoutCaptured.trim()) as Array<{
      id: string;
      claimant: string;
      severity: string;
    }>;
    const ids = parsed.map((r) => r.id).sort();
    expect(ids).toEqual(['rmd-listA', 'rmd-listB']);

    const a = parsed.find((r) => r.id === 'rmd-listA')!;
    expect(a.claimant).toBe('compliance');
    expect(a.severity).toBe('guard');
  });

  it('F.3 — archived remediations are NOT shown in list', async () => {
    writeFixtureRemediation(tmpDir, 'rmd-active');
    writeFixtureRemediation(tmpDir, 'rmd-archive-me');

    // Archive one
    await overrideClearOne('rmd-archive-me');

    // Reset stdout capture for the list call
    stdoutCaptured = '';

    // List should only show the active one
    await overrideList();

    const parsed = JSON.parse(stdoutCaptured.trim()) as Array<{ id: string }>;
    const ids = parsed.map((r) => r.id);
    expect(ids).toEqual(['rmd-active']);
  });

  // clear-all flag check (sanity)
  it('clear-all without --force triggers process.exit(1)', async () => {
    writeFixtureRemediation(tmpDir, 'rmd-bulk1');
    await expect(overrideClearAll({ force: false })).rejects.toThrow('process.exit(1)');
    // Source should still exist
    expect(
      fs.existsSync(path.join(tmpDir, '.paradigm/remediations/rmd-bulk1.yaml'))
    ).toBe(true);
  });

  it('clear-all --force archives all active + writes one event row each', async () => {
    writeFixtureRemediation(tmpDir, 'rmd-bulkA');
    writeFixtureRemediation(tmpDir, 'rmd-bulkB');
    writeFixtureRemediation(tmpDir, 'rmd-bulkC');

    await overrideClearAll({ force: true });

    // All three archived
    expect(
      fs.existsSync(path.join(tmpDir, '.paradigm/remediations/.archived/rmd-bulkA.yaml'))
    ).toBe(true);
    expect(
      fs.existsSync(path.join(tmpDir, '.paradigm/remediations/.archived/rmd-bulkB.yaml'))
    ).toBe(true);
    expect(
      fs.existsSync(path.join(tmpDir, '.paradigm/remediations/.archived/rmd-bulkC.yaml'))
    ).toBe(true);

    // 3 event rows written (one per cleared remediation per spec §12 #6)
    const jsonlPath = path.join(tmpDir, '.paradigm/events/overrides.jsonl');
    const rows = fs
      .readFileSync(jsonlPath, 'utf8')
      .split('\n')
      .filter(Boolean);
    expect(rows.length).toBe(3);
  });
});
