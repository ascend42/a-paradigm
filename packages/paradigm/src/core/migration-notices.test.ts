import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as fsp from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { checkAndEmitMigrationNotices, isCohortC } from './migration-notices.js';

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
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'paradigm-migration-emit-'));
    fs.mkdirSync(path.join(tmpDir, '.paradigm'), { recursive: true });
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(async () => {
    logSpy.mockRestore();
    await fsp.rm(tmpDir, { recursive: true, force: true });
  });

  it('emits the notice and writes a marker for cohort C', async () => {
    fs.writeFileSync(
      path.join(tmpDir, '.purpose'),
      'aspects:\n  ~thing:\n    description: x\n',
      'utf8'
    );
    fs.writeFileSync(
      path.join(tmpDir, '.paradigm', 'roster.yaml'),
      'version: 1.0\nactive: [architect]\n',
      'utf8'
    );

    await checkAndEmitMigrationNotices(tmpDir);

    expect(logSpy).toHaveBeenCalled();
    const printed = logSpy.mock.calls.map((c) => String(c[0])).join('\n');
    expect(printed).toContain('Enforcement model changed');
    expect(fs.existsSync(path.join(tmpDir, '.paradigm', '.v6-0-4-migration-acknowledged'))).toBe(true);
  });

  it('does not emit twice when marker exists', async () => {
    fs.writeFileSync(
      path.join(tmpDir, '.purpose'),
      'aspects:\n  ~thing:\n    description: x\n',
      'utf8'
    );
    fs.writeFileSync(path.join(tmpDir, '.paradigm', 'roster.yaml'), 'active: [architect]\n', 'utf8');
    fs.writeFileSync(path.join(tmpDir, '.paradigm', '.v6-0-4-migration-acknowledged'), 'x\n', 'utf8');

    await checkAndEmitMigrationNotices(tmpDir);

    expect(logSpy).not.toHaveBeenCalled();
  });

  it('does not emit for projects with no .paradigm directory', async () => {
    await fsp.rm(path.join(tmpDir, '.paradigm'), { recursive: true });
    await checkAndEmitMigrationNotices(tmpDir);
    expect(logSpy).not.toHaveBeenCalled();
  });

  it('does not emit when compliance is rostered', async () => {
    fs.writeFileSync(path.join(tmpDir, '.purpose'), 'aspects:\n  ~x:\n    description: x\n', 'utf8');
    fs.writeFileSync(path.join(tmpDir, '.paradigm', 'roster.yaml'), 'active: [compliance]\n', 'utf8');
    await checkAndEmitMigrationNotices(tmpDir);
    expect(logSpy).not.toHaveBeenCalled();
  });
});
