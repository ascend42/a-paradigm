/**
 * Regression tests for recordAntipattern — the project-scope wisdom writer.
 *
 * Reproduces the dealoracle field report: `paradigm_wisdom_record` (antipattern)
 * threw "Cannot read properties of undefined (reading 'push')" when an existing
 * antipatterns.yaml parsed to an object without an `antipatterns` array (empty
 * file, or a hand-edited file with only `version`). The safe default was being
 * overwritten by yaml.load with no normalization.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as yaml from 'js-yaml';
import { recordAntipattern } from './wisdom-loader.js';

const WISDOM_FILE = '.paradigm/wisdom/antipatterns.yaml';

function readAntipatterns(rootDir: string): any {
  return yaml.load(fs.readFileSync(path.join(rootDir, WISDOM_FILE), 'utf8'));
}

const sample = {
  id: 'api-001',
  symbols: ['#lazy-with-retry'],
  description: 'do not X',
  reason: 'because Y',
  alternative: 'do Z',
};

describe('recordAntipattern (project scope)', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wisdom-test-'));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('creates the file from scratch when none exists', async () => {
    await recordAntipattern(dir, sample);
    const data = readAntipatterns(dir);
    expect(data.antipatterns).toHaveLength(1);
    expect(data.antipatterns[0].id).toBe('api-001');
  });

  it('does NOT crash when the file exists but has no antipatterns key (the reported bug)', async () => {
    const filePath = path.join(dir, WISDOM_FILE);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, yaml.dump({ version: '1.0' })); // no `antipatterns:`

    await expect(recordAntipattern(dir, sample)).resolves.not.toThrow();
    expect(readAntipatterns(dir).antipatterns).toHaveLength(1);
  });

  it('does NOT crash on an empty file (yaml.load → undefined)', async () => {
    const filePath = path.join(dir, WISDOM_FILE);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, '');

    await expect(recordAntipattern(dir, sample)).resolves.not.toThrow();
    expect(readAntipatterns(dir).antipatterns).toHaveLength(1);
  });

  it('appends to an existing valid file without dropping prior entries', async () => {
    await recordAntipattern(dir, sample);
    await recordAntipattern(dir, { ...sample, id: 'api-002' });
    const data = readAntipatterns(dir);
    expect(data.antipatterns.map((a: any) => a.id)).toEqual(['api-001', 'api-002']);
  });
});
