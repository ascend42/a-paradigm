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
