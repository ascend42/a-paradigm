/**
 * decision-migration.test.ts — v5.39.0 / v6.0 University sub-phase 3.
 *
 * Covers:
 *   - `packages/paradigm/src/commands/migrate-decisions.ts` round-trip:
 *     - wisdom-decisions → TD-* entries with migrated_from: 'wisdom-decision';
 *       source wisdom files deleted.
 *     - lore entries with type: 'decision' → TD-* entries with
 *       migrated_from: 'lore-decision' + linked_lore; the lore entry is
 *       REWRITTEN in place to type: 'insight' with references.decision_id.
 *     - Idempotency: running twice produces no additional TD-* files.
 *
 *   - The companion-lore write pattern (D3 locked) for `recordDecision`:
 *     - writeCompanionLoreEntry produces a lore insight entry whose
 *       references.decision_id points at the canonical TD-* decision.
 *
 * Safety property preserved:
 *   The migration script must not duplicate decisions on re-run (idempotent).
 *   The companion-lore write must never throw or block the decision record.
 */

import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { recordDecision, writeCompanionLoreEntry } from '../src/utils/decision-loader.js';

// We import the CLI migration command directly via the paradigm package's
// compiled entry. The paradigm package is a sibling — reach for its source
// directly since both run under the same vitest hoisting root.
async function importMigrateDecisions() {
  // Dynamic import via relative path. paradigm CLI source under packages/paradigm.
  const mod = await import('../../paradigm/src/commands/migrate-decisions.js');
  return mod.migrateDecisionsCommand as (opts?: { dryRun?: boolean; json?: boolean }) => Promise<void>;
}

function mktemp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'paradigm-decmigr-'));
}

function writeYaml(filePath: string, data: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, yaml.dump(data, { lineWidth: 120, noRefs: true }), 'utf-8');
}

describe('decision-migration — wisdom-decisions', () => {
  let tmpDir: string | undefined;
  const origCwd = process.cwd();
  afterEach(() => {
    process.chdir(origCwd);
    if (tmpDir && fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
    tmpDir = undefined;
  });

  it('converts .paradigm/wisdom/decisions/*.yaml to TD-* entries with migrated_from tag and deletes source', async () => {
    tmpDir = mktemp();
    // Seed wisdom-decision
    writeYaml(path.join(tmpDir, '.paradigm', 'wisdom', 'decisions', 'wd-001.yaml'), {
      id: 'wd-001',
      title: 'Adopt TypeScript strict mode',
      status: 'accepted',
      date: '2026-04-10',
      symbols: ['#build'],
      context: 'We had type drift issues.',
      decision: 'Turn on strict.',
      rationale: 'Catches bugs earlier.',
      consequences: {
        positive: ['fewer bugs'],
        negative: ['more work'],
      },
    });

    process.chdir(tmpDir);
    const migrate = await importMigrateDecisions();
    await migrate();

    // Source wisdom file deleted
    expect(fs.existsSync(path.join(tmpDir, '.paradigm', 'wisdom', 'decisions', 'wd-001.yaml'))).toBe(false);

    // TD-* entry produced with migrated_from set
    const decisionsDir = path.join(tmpDir, '.paradigm', 'decisions');
    expect(fs.existsSync(decisionsDir)).toBe(true);
    const tds = fs.readdirSync(decisionsDir).filter(f => f.startsWith('TD-') && f.endsWith('.yaml'));
    expect(tds.length).toBe(1);
    const td = yaml.load(fs.readFileSync(path.join(decisionsDir, tds[0]), 'utf-8')) as {
      migrated_from?: string;
      title?: string;
      context?: string;
      consequences?: { positive?: string[] };
      symbols_affected?: string[];
    };
    expect(td.migrated_from).toBe('wisdom-decision');
    expect(td.title).toBe('Adopt TypeScript strict mode');
    expect(td.context).toBe('We had type drift issues.');
    expect(td.consequences?.positive).toEqual(['fewer bugs']);
    expect(td.symbols_affected).toEqual(['#build']);
  });

  it('is idempotent: second run produces no additional TD-* files', async () => {
    tmpDir = mktemp();
    writeYaml(path.join(tmpDir, '.paradigm', 'wisdom', 'decisions', 'wd-002.yaml'), {
      id: 'wd-002',
      title: 'Adopt ESM modules',
      status: 'accepted',
      date: '2026-04-11',
      decision: 'Go ESM-only.',
    });

    process.chdir(tmpDir);
    const migrate = await importMigrateDecisions();
    await migrate();

    const decisionsDir = path.join(tmpDir, '.paradigm', 'decisions');
    const afterFirst = fs.readdirSync(decisionsDir).filter(f => f.endsWith('.yaml'));
    expect(afterFirst.length).toBe(1);

    // Second run — source already deleted, nothing to add
    await migrate();
    const afterSecond = fs.readdirSync(decisionsDir).filter(f => f.endsWith('.yaml'));
    expect(afterSecond.length).toBe(1);
  });
});

describe('decision-migration — lore decisions', () => {
  let tmpDir: string | undefined;
  const origCwd = process.cwd();
  afterEach(() => {
    process.chdir(origCwd);
    if (tmpDir && fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
    tmpDir = undefined;
  });

  it('rewrites lore type=decision entries to type=insight with references.decision_id', async () => {
    tmpDir = mktemp();
    const loreFile = path.join(tmpDir, '.paradigm', 'lore', 'entries', '2026-04-15', 'L-2026-04-15-test-001.lore');
    writeYaml(loreFile, {
      id: 'L-2026-04-15-test-001',
      type: 'decision',
      timestamp: '2026-04-15T10:00:00Z',
      author: 'tester',
      title: 'Decide logging convention',
      summary: 'Use structured logger for all library code.',
      body: 'Original reasoning lives in the session.',
      symbols_touched: ['#logger'],
      decisions: [{ decision: 'Structured logger only.', rationale: 'Traceability.' }],
      tags: ['decision'],
    });

    process.chdir(tmpDir);
    const migrate = await importMigrateDecisions();
    await migrate();

    // TD-* created with migrated_from='lore-decision'
    const decisionsDir = path.join(tmpDir, '.paradigm', 'decisions');
    const tds = fs.readdirSync(decisionsDir).filter(f => f.endsWith('.yaml'));
    expect(tds.length).toBe(1);
    const td = yaml.load(fs.readFileSync(path.join(decisionsDir, tds[0]), 'utf-8')) as {
      migrated_from?: string;
      linked_lore?: string;
    };
    expect(td.migrated_from).toBe('lore-decision');
    expect(td.linked_lore).toBe('L-2026-04-15-test-001');

    // Lore entry rewritten: still exists, but type=insight + references.decision_id set
    expect(fs.existsSync(loreFile)).toBe(true);
    const rewritten = yaml.load(fs.readFileSync(loreFile, 'utf-8')) as {
      type: string;
      references?: { decision_id?: string };
      body?: string;
    };
    expect(rewritten.type).toBe('insight');
    expect(rewritten.references?.decision_id).toMatch(/^TD-\d{4}-\d{2}-\d{2}-\d{3}$/);
    expect(rewritten.body).toContain('migrated to TD-');
  });

  it('is idempotent for lore rewrites: second run does not re-rewrite or duplicate', async () => {
    tmpDir = mktemp();
    const loreFile = path.join(tmpDir, '.paradigm', 'lore', 'entries', '2026-04-15', 'L-2026-04-15-test-002.lore');
    writeYaml(loreFile, {
      id: 'L-2026-04-15-test-002',
      type: 'decision',
      timestamp: '2026-04-15T10:00:00Z',
      author: 'tester',
      title: 'Another decision',
      decisions: [{ decision: 'Adopt ESM.' }],
    });

    process.chdir(tmpDir);
    const migrate = await importMigrateDecisions();
    await migrate();

    const decisionsDir = path.join(tmpDir, '.paradigm', 'decisions');
    const first = fs.readdirSync(decisionsDir).filter(f => f.endsWith('.yaml')).length;
    expect(first).toBe(1);

    await migrate();
    const second = fs.readdirSync(decisionsDir).filter(f => f.endsWith('.yaml')).length;
    expect(second).toBe(1);
  });
});

describe('decision-migration — companion-lore for recordDecision (D3)', () => {
  let tmpDir: string | undefined;
  afterEach(() => {
    if (tmpDir && fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
    tmpDir = undefined;
  });

  it('writeCompanionLoreEntry writes a lore insight referencing the decision', () => {
    tmpDir = mktemp();
    const decision = recordDecision(tmpDir, {
      title: 'Go monorepo',
      decision: 'Consolidate into a single repo.',
      participants: [{ id: 'team', role: 'human', stance: 'supported' }],
      status: 'active',
      symbols_affected: ['#repo-layout'],
    });

    const loreId = writeCompanionLoreEntry(tmpDir, decision.id);
    expect(loreId).toBeTruthy();
    expect(loreId).toMatch(/^L-\d{4}-\d{2}-\d{2}-/);

    // Verify the lore file exists on disk and references the decision
    const today = new Date().toISOString().slice(0, 10);
    const loreDir = path.join(tmpDir, '.paradigm', 'lore', 'entries', today);
    expect(fs.existsSync(loreDir)).toBe(true);
    const loreFile = path.join(loreDir, `${loreId}.lore`);
    expect(fs.existsSync(loreFile)).toBe(true);

    const body = yaml.load(fs.readFileSync(loreFile, 'utf-8')) as {
      type?: string;
      references?: { decision_id?: string };
      symbols_touched?: string[];
    };
    expect(body.type).toBe('insight');
    expect(body.references?.decision_id).toBe(decision.id);
    expect(body.symbols_touched).toContain('#repo-layout');
  });

  it('returns null when the decision does not exist (best-effort)', () => {
    tmpDir = mktemp();
    const result = writeCompanionLoreEntry(tmpDir, 'TD-9999-99-99-999');
    expect(result).toBeNull();
  });
});
