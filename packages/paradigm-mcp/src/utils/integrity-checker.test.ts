/**
 * integrity-checker.test — Symbol Integrity Phase 1 (T-2026-10-13-001).
 *
 * Written FIRST (pre-fix). A symbol that is only ever REFERENCED (e.g. a
 * component's `gates: [^ghost]`) and never declared anywhere must be reported
 * as a broken/dangling reference. Pre-fix, the aggregator synthesizes a
 * "Referenced from ..." entry for ^ghost, so `definedIds` contains it and the
 * checker (which also only inspects flow-level refs) reports nothing.
 *
 * NOTE: imports @a-company/premise-core via its built dist — rebuild
 * premise-core (`npm run build` in packages/premise/core) after changing it.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { aggregateFromDirectory } from '@a-company/premise-core';
import { checkIntegrity } from './integrity-checker.js';

let tmpDir: string;

function write(rel: string, content: string): void {
  const abs = path.join(tmpDir, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'integrity-checker-'));
  write(
    'portal.yaml',
    [
      'version: 2.0.0',
      'gates:',
      '  authenticated:',
      '    description: User must be logged in',
      '    check: session.user != null',
      '    prizes: []',
      '',
    ].join('\n'),
  );
  write(
    'src/billing/.purpose',
    [
      'version: "2.0"',
      'components:',
      '  billing-page:',
      '    description: Billing page',
      '    gates: [^authenticated, ^ghost]',
      '',
    ].join('\n'),
  );
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('checkIntegrity — undeclared references', () => {
  it('reports an undeclared referenced gate (^ghost) as a broken reference', async () => {
    const aggregation = await aggregateFromDirectory(tmpDir);
    const report = checkIntegrity(aggregation, tmpDir);
    const ghost = report.brokenReferences.filter((b) => b.to === '^ghost');
    expect(ghost, `brokenReferences was ${JSON.stringify(report.brokenReferences)}`).toHaveLength(1);
    expect(ghost[0].from).toBe('#billing-page');
  });

  it('does not report a portal-declared gate (^authenticated) as broken', async () => {
    const aggregation = await aggregateFromDirectory(tmpDir);
    const report = checkIntegrity(aggregation, tmpDir);
    expect(report.brokenReferences.map((b) => b.to)).not.toContain('^authenticated');
  });

  it('does not flag portal + synthesized-reference overlap as a duplicate', async () => {
    const aggregation = await aggregateFromDirectory(tmpDir);
    const report = checkIntegrity(aggregation, tmpDir);
    expect(report.duplicateSymbols.map((d) => d.symbol)).not.toContain('^authenticated');
  });
});
