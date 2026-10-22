import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as fsp from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import {
  checkAndEmitMigrationNotices,
  isCohortC,
  pendingNotices,
  acknowledgeNotice,
  findNotice,
  resetPrintedNoticesForTests,
  NO_NOTICES_ENV,
} from './migration-notices.js';

describe('isCohortC', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'paradigm-migration-'));
    fs.mkdirSync(path.join(tmpDir, '.paradigm'), { recursive: true });
  });

  afterEach(async () => {
    await fsp.rm(tmpDir, { recursive: true, force: true });
  });

  it('returns false when no .purpose file contains aspects', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.purpose'),
      'version: 2.0.0\ncomponents:\n  foo:\n    description: bar\n',
      'utf8'
    );
    expect(isCohortC(tmpDir)).toBe(false);
  });

  it('returns true when a .purpose file contains a ~aspect line and roster lacks compliance', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.purpose'),
      'version: 2.0.0\naspects:\n  ~something:\n    description: x\n',
      'utf8'
    );
    fs.writeFileSync(
      path.join(tmpDir, '.paradigm', 'roster.yaml'),
      'version: 1.0\nactive:\n  - architect\n  - builder\n',
      'utf8'
    );
    expect(isCohortC(tmpDir)).toBe(true);
  });

  it('returns false when compliance is on the roster, even with aspects defined', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.purpose'),
      'aspects:\n  ~something:\n    description: x\n',
      'utf8'
    );
    fs.writeFileSync(
      path.join(tmpDir, '.paradigm', 'roster.yaml'),
      'version: 1.0\nactive:\n  - architect\n  - compliance\n',
      'utf8'
    );
    expect(isCohortC(tmpDir)).toBe(false);
  });

  it('skips node_modules and .git when scanning', () => {
    fs.mkdirSync(path.join(tmpDir, 'node_modules', 'evil'), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, 'node_modules', 'evil', '.purpose'),
      'aspects:\n  ~bad:\n    description: x\n',
      'utf8'
    );
    expect(isCohortC(tmpDir)).toBe(false);
  });

  it('detects YAML-list aspect form (- ~name) — the standard .purpose shape', () => {
    // Regression: original regex /^\s*~/ missed `      - ~aspect-name`
    // which is the canonical YAML-list form used across this repo's .purpose
    // files (`aspects:\n      - ~rate-limited`). Smoke test caught this
    // before v6.0.4 publish.
    fs.writeFileSync(
      path.join(tmpDir, '.purpose'),
      'component: api-handler\naspects:\n      - ~rate-limited\n      - ~auth-required\n',
      'utf8'
    );
    fs.writeFileSync(
      path.join(tmpDir, '.paradigm', 'roster.yaml'),
      'version: 1.0\nactive:\n  - architect\n  - builder\n',
      'utf8'
    );
    expect(isCohortC(tmpDir)).toBe(true);
  });
});

describe('checkAndEmitMigrationNotices', () => {
  let tmpDir: string;
  let printed: string[];
  const write = (t: string) => { printed.push(t); };
  const marker = () => path.join(tmpDir, '.paradigm', '.v6-0-4-migration-acknowledged');

  function cohortC(): void {
    fs.writeFileSync(path.join(tmpDir, '.purpose'), 'aspects:\n  ~thing:\n    description: x\n', 'utf8');
    fs.writeFileSync(path.join(tmpDir, '.paradigm', 'roster.yaml'), 'version: 1.0\nactive: [architect]\n', 'utf8');
  }

  beforeEach(async () => {
    tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'paradigm-migration-emit-'));
    fs.mkdirSync(path.join(tmpDir, '.paradigm'), { recursive: true });
    printed = [];
    resetPrintedNoticesForTests();
    delete process.env[NO_NOTICES_ENV];
  });

  afterEach(async () => {
    delete process.env[NO_NOTICES_ENV];
    await fsp.rm(tmpDir, { recursive: true, force: true });
  });

  it('write command: emits the notice and writes the marker', async () => {
    cohortC();
    await checkAndEmitMigrationNotices(tmpDir, { readOnly: false, write });
    expect(printed.join('')).toContain('Enforcement model changed');
    expect(printed.join('')).toContain('will not appear again');
    expect(fs.existsSync(marker())).toBe(true);
  });

  it('read-only command: emits the notice but writes nothing', async () => {
    cohortC();
    const before = fs.readdirSync(path.join(tmpDir, '.paradigm')).sort();
    await checkAndEmitMigrationNotices(tmpDir, { readOnly: true, write });
    expect(printed.join('')).toContain('Enforcement model changed');
    expect(printed.join('')).toContain('paradigm notices ack v6.0.4');
    expect(fs.readdirSync(path.join(tmpDir, '.paradigm')).sort()).toEqual(before);
    expect(pendingNotices(tmpDir).map(n => n.id)).toEqual(['v6.0.4']);
  });

  it('prints at most once per process', async () => {
    cohortC();
    await checkAndEmitMigrationNotices(tmpDir, { readOnly: true, write });
    await checkAndEmitMigrationNotices(tmpDir, { readOnly: true, write });
    expect(printed.length).toBe(1);
  });

  it(`${NO_NOTICES_ENV}=1 hides the notice and writes nothing`, async () => {
    cohortC();
    process.env[NO_NOTICES_ENV] = '1';
    await checkAndEmitMigrationNotices(tmpDir, { readOnly: false, write });
    expect(printed).toEqual([]);
    expect(fs.existsSync(marker())).toBe(false);
  });

  it('defaults to stderr, never stdout', async () => {
    cohortC();
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const errSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      await checkAndEmitMigrationNotices(tmpDir, { readOnly: true });
      expect(logSpy).not.toHaveBeenCalled();
      expect(errSpy).toHaveBeenCalled();
    } finally {
      logSpy.mockRestore();
      errSpy.mockRestore();
    }
  });

  it('acknowledgeNotice silences it', async () => {
    cohortC();
    expect(acknowledgeNotice(tmpDir, findNotice('v6.0.4')!)).toBe(true);
    expect(pendingNotices(tmpDir)).toEqual([]);
    await checkAndEmitMigrationNotices(tmpDir, { readOnly: true, write });
    expect(printed).toEqual([]);
  });

  it('does not emit twice when marker exists', async () => {
    cohortC();
    fs.writeFileSync(marker(), 'x\n', 'utf8');
    await checkAndEmitMigrationNotices(tmpDir, { readOnly: false, write });
    expect(printed).toEqual([]);
  });

  it('does not emit for projects with no .paradigm directory', async () => {
    await fsp.rm(path.join(tmpDir, '.paradigm'), { recursive: true });
    await checkAndEmitMigrationNotices(tmpDir, { readOnly: false, write });
    expect(printed).toEqual([]);
  });

  it('does not emit when compliance is rostered', async () => {
    fs.writeFileSync(path.join(tmpDir, '.purpose'), 'aspects:\n  ~x:\n    description: x\n', 'utf8');
    fs.writeFileSync(path.join(tmpDir, '.paradigm', 'roster.yaml'), 'active: [compliance]\n', 'utf8');
    await checkAndEmitMigrationNotices(tmpDir, { readOnly: false, write });
    expect(printed).toEqual([]);
  });
});
