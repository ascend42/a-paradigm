/**
 * #gnomon-probes — run.mjs writes a record the contracts validator accepts,
 * names it <id>.<platform>.json, and maps verdicts to exit codes.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { validateProbeResultV1 } from '@a-company/gnomon-contracts';
import { afterAll, describe, expect, it } from 'vitest';
import { PKG_ROOT } from './helpers.js';

const RUN = path.join(PKG_ROOT, 'probes', 'run.mjs');
const outDir = mkdtempSync(path.join(os.tmpdir(), 'gnomon-probe-results-'));
afterAll(() => rmSync(outDir, { recursive: true, force: true }));

const run = (...args: string[]) => spawnSync(process.execPath, [RUN, ...args], { encoding: 'utf8' });

describe('probes/run.mjs', () => {
  it('runs p-harness and writes a valid probeResult:v1', () => {
    const r = run('p-harness', '--out-dir', outDir);
    expect(r.stderr).toBe('');
    expect(r.status).toBe(0);
    const record = JSON.parse(readFileSync(path.join(outDir, `p-harness.${process.platform}.json`), 'utf8'));
    expect(validateProbeResultV1(record)).toEqual([]);
    expect(record.probe).toBe('p-harness');
    expect(record.verdict).toBe('pass');
    expect(record.os).toBe(process.platform);
    expect(record.toolVersions.node).toBe(process.version);
    expect(record.specRefs.length).toBeGreaterThan(0);
  });

  it.each([['../escape'], ['Bad_Id'], ['']])('refuses probe id %j with usage exit 64', (id) => {
    expect(run(id, '--out-dir', outDir).status).toBe(64);
  });

  it('refuses an unknown probe with usage exit 64', () => {
    expect(run('no-such-probe', '--out-dir', outDir).status).toBe(64);
  });
});
