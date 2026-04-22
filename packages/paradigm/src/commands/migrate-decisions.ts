/**
 * paradigm migrate decisions — v6.0 decision-store consolidation.
 *
 * Consolidates two legacy decision surfaces into the canonical TD-streams
 * store (`.paradigm/decisions/TD-*.yaml`):
 *   1. `.paradigm/wisdom/decisions/*.yaml` — ADR-style wisdom decisions.
 *      Converted to TD-* entries with migrated_from: 'wisdom-decision' and
 *      source files deleted after successful write.
 *   2. Lore entries with type: 'decision'. Draft TD-* entries with
 *      migrated_from: 'lore-decision' + linked_lore; the lore entry is
 *      REWRITTEN in place to type: 'insight' (not deleted) so the narrative
 *      timeline remains complete.
 *
 * Idempotent: re-running produces no duplicate TD-* files. Safe to run as
 * many times as needed while adopters stage the v6.0 migration.
 *
 * Hidden from `--help` (internal migration path). Runs only when the user
 * explicitly invokes `paradigm migrate decisions`.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { out, success, warn, error, dim, header } from '../utils/cli-output.js';

interface MigrateDecisionsOptions {
  dryRun?: boolean;
  json?: boolean;
}

interface WisdomDecisionFile {
  id: string;
  title?: string;
  status?: string;
  date?: string;
  symbols?: string[];
  context?: string;
  decision?: string;
  rationale?: { factors?: string[]; conclusion?: string } | string;
  consequences?: {
    positive?: string[];
    negative?: string[];
    mitigations?: string[];
  };
}

interface LoreEntry {
  id: string;
  type?: string;
  timestamp?: string;
  author?: string;
  title?: string;
  summary?: string;
  body?: string;
  symbols_touched?: string[];
  decisions?: Array<{ id?: string; decision?: string; rationale?: string }>;
  tags?: string[];
  references?: Record<string, string>;
  linked_lore?: string[];
}

interface MigrationResult {
  wisdomConverted: number;
  wisdomSkipped: number;
  loreConverted: number;
  loreSkipped: number;
  loreRewrittenToInsight: number;
  warnings: string[];
}

const DECISIONS_DIR = '.paradigm/decisions';
const WISDOM_DECISIONS_DIR = '.paradigm/wisdom/decisions';
const LORE_ENTRIES_DIR = '.paradigm/lore/entries';

export async function migrateDecisionsCommand(options: MigrateDecisionsOptions = {}): Promise<void> {
  const cwd = process.cwd();
  const decisionsDir = path.join(cwd, DECISIONS_DIR);

  header('paradigm migrate decisions');
  dim(`  target: .paradigm/decisions/`);
  if (options.dryRun) {
    dim('  mode:   dry-run (no writes)');
  }
  out('');

  const result: MigrationResult = {
    wisdomConverted: 0,
    wisdomSkipped: 0,
    loreConverted: 0,
    loreSkipped: 0,
    loreRewrittenToInsight: 0,
    warnings: [],
  };

  if (!options.dryRun) {
    fs.mkdirSync(decisionsDir, { recursive: true });
  }

  // Build a set of existing migrated_from ids (idempotence check).
  const alreadyMigrated = loadAlreadyMigrated(decisionsDir);

  // 1. Wisdom decisions
  migrateWisdomDecisions(cwd, decisionsDir, alreadyMigrated, options, result);

  // 2. Lore decisions
  migrateLoreDecisions(cwd, decisionsDir, alreadyMigrated, options, result);

  // Summary
  out('');
  header('Migration summary');
  out(`  wisdom decisions converted: ${result.wisdomConverted}`);
  if (result.wisdomSkipped > 0) dim(`  wisdom decisions skipped:   ${result.wisdomSkipped}`);
  out(`  lore decisions converted:   ${result.loreConverted}`);
  if (result.loreSkipped > 0) dim(`  lore decisions skipped:     ${result.loreSkipped}`);
  if (result.loreRewrittenToInsight > 0) {
    out(`  lore entries rewritten → insight: ${result.loreRewrittenToInsight}`);
  }
  if (result.warnings.length > 0) {
    out('');
    warn('Warnings:');
    for (const w of result.warnings) {
      dim(`  - ${w}`);
    }
  }
  out('');

  if (options.json) {
    out(JSON.stringify(result, null, 2));
  }

  success('migrate decisions complete');
}

// ────────────────────────────────────────────────────────────────
// Internals
// ────────────────────────────────────────────────────────────────

function loadAlreadyMigrated(decisionsDir: string): {
  wisdomIds: Set<string>;
  loreIds: Set<string>;
} {
  const wisdomIds = new Set<string>();
  const loreIds = new Set<string>();

  if (!fs.existsSync(decisionsDir)) return { wisdomIds, loreIds };

  try {
    const files = fs.readdirSync(decisionsDir).filter(f => f.endsWith('.yaml'));
    for (const f of files) {
      try {
        const raw = fs.readFileSync(path.join(decisionsDir, f), 'utf-8');
        const td = yaml.load(raw) as { migrated_from?: string; source_id?: string; linked_lore?: string; tags?: string[] } | null;
        if (!td) continue;

        // Record wisdom source by tag or by inline source_id we include in
        // the converted entry. (See writeTd.)
        const tags = td.tags || [];
        for (const tag of tags) {
          if (tag.startsWith('wisdom-decision:')) wisdomIds.add(tag.slice('wisdom-decision:'.length));
          if (tag.startsWith('lore-decision:')) loreIds.add(tag.slice('lore-decision:'.length));
        }
      } catch {
        // skip malformed
      }
    }
  } catch {
    // read failure → treat as fresh migration
  }

  return { wisdomIds, loreIds };
}

function migrateWisdomDecisions(
  rootDir: string,
  decisionsDir: string,
  alreadyMigrated: { wisdomIds: Set<string>; loreIds: Set<string> },
  options: MigrateDecisionsOptions,
  result: MigrationResult,
): void {
  const wisdomDir = path.join(rootDir, WISDOM_DECISIONS_DIR);
  if (!fs.existsSync(wisdomDir)) {
    dim('  no .paradigm/wisdom/decisions/ dir — skipping wisdom migration');
    return;
  }

  let files: string[];
  try {
    files = fs.readdirSync(wisdomDir).filter(f => f.endsWith('.yaml'));
  } catch (err) {
    result.warnings.push(`wisdom dir read failed: ${(err as Error).message}`);
    return;
  }

  for (const file of files) {
    const full = path.join(wisdomDir, file);
    let wd: WisdomDecisionFile;
    try {
      wd = yaml.load(fs.readFileSync(full, 'utf-8')) as WisdomDecisionFile;
    } catch (err) {
      result.warnings.push(`wisdom parse failed: ${file} — ${(err as Error).message}`);
      continue;
    }
    if (!wd || !wd.id) {
      result.warnings.push(`wisdom file missing id: ${file}`);
      continue;
    }

    if (alreadyMigrated.wisdomIds.has(wd.id)) {
      result.wisdomSkipped++;
      continue;
    }

    // Compose TD-* entry
    const date = wd.date || new Date().toISOString().slice(0, 10);
    const tdId = generateTdId(date, decisionsDir, result);

    const rationale = typeof wd.rationale === 'string'
      ? wd.rationale
      : wd.rationale
        ? { factors: wd.rationale.factors ?? [], conclusion: wd.rationale.conclusion ?? '' }
        : undefined;

    const td: Record<string, unknown> = {
      id: tdId,
      timestamp: new Date().toISOString(),
      title: wd.title || wd.id,
      decision: wd.decision || '',
      ...(rationale !== undefined ? { rationale } : {}),
      participants: [{ id: 'wisdom-migration', role: 'agent', stance: 'proposed' }],
      symbols_affected: wd.symbols || [],
      status: normalizeStatus(wd.status),
      ...(wd.context ? { context: wd.context } : {}),
      ...(wd.consequences ? { consequences: wd.consequences } : {}),
      date,
      migrated_from: 'wisdom-decision',
      tags: [`wisdom-decision:${wd.id}`, 'migrated'],
    };

    if (options.dryRun) {
      result.wisdomConverted++;
      continue;
    }

    try {
      fs.writeFileSync(
        path.join(decisionsDir, `${tdId}.yaml`),
        yaml.dump(td, { lineWidth: 120, noRefs: true }),
        'utf-8',
      );
      // Delete source file (per spec §6.3 step 1)
      fs.unlinkSync(full);
      result.wisdomConverted++;
    } catch (err) {
      result.warnings.push(`wisdom convert failed: ${file} — ${(err as Error).message}`);
    }
  }

  // Remove the wisdom/decisions dir if now empty
  if (!options.dryRun) {
    try {
      if (fs.existsSync(wisdomDir) && fs.readdirSync(wisdomDir).length === 0) {
        fs.rmdirSync(wisdomDir);
      }
    } catch {
      // non-fatal
    }
  }
}

function migrateLoreDecisions(
  rootDir: string,
  decisionsDir: string,
  alreadyMigrated: { wisdomIds: Set<string>; loreIds: Set<string> },
  options: MigrateDecisionsOptions,
  result: MigrationResult,
): void {
  const loreRoot = path.join(rootDir, LORE_ENTRIES_DIR);
  if (!fs.existsSync(loreRoot)) {
    dim('  no .paradigm/lore/entries/ dir — skipping lore migration');
    return;
  }

  // Walk year/month/day subdirs (or flat).
  const allLoreFiles = collectLoreFiles(loreRoot);

  for (const full of allLoreFiles) {
    let entry: LoreEntry;
    try {
      entry = yaml.load(fs.readFileSync(full, 'utf-8')) as LoreEntry;
    } catch (err) {
      result.warnings.push(`lore parse failed: ${path.relative(rootDir, full)} — ${(err as Error).message}`);
      continue;
    }
    if (!entry || entry.type !== 'decision' || !entry.id) continue;

    if (alreadyMigrated.loreIds.has(entry.id)) {
      result.loreSkipped++;
      continue;
    }

    // Compose TD-* entry
    const date = (entry.timestamp || new Date().toISOString()).slice(0, 10);
    const tdId = generateTdId(date, decisionsDir, result);

    const decisionText = entry.decisions?.[0]?.decision ?? entry.summary ?? entry.title ?? '';
    const rationaleText = entry.decisions?.[0]?.rationale ?? '';

    const td: Record<string, unknown> = {
      id: tdId,
      timestamp: entry.timestamp || new Date().toISOString(),
      title: entry.title || `Migrated lore decision ${entry.id}`,
      decision: decisionText,
      ...(rationaleText ? { rationale: rationaleText } : {}),
      participants: [{ id: entry.author || 'lore-migration', role: 'human', stance: 'proposed' }],
      symbols_affected: entry.symbols_touched || [],
      status: 'active',
      date,
      migrated_from: 'lore-decision',
      linked_lore: entry.id,
      tags: [`lore-decision:${entry.id}`, 'migrated'],
    };

    if (options.dryRun) {
      result.loreConverted++;
      result.loreRewrittenToInsight++;
      continue;
    }

    try {
      fs.writeFileSync(
        path.join(decisionsDir, `${tdId}.yaml`),
        yaml.dump(td, { lineWidth: 120, noRefs: true }),
        'utf-8',
      );
      result.loreConverted++;

      // Rewrite lore entry to type: 'insight' with references.decision_id.
      const rewritten: LoreEntry = {
        ...entry,
        type: 'insight',
        references: {
          ...(entry.references || {}),
          decision_id: tdId,
        },
        body: `${entry.body ? entry.body + '\n\n---\n\n' : ''}Original type was 'decision'; migrated to ${tdId} on ${new Date().toISOString().slice(0, 10)}.`,
      };
      fs.writeFileSync(full, yaml.dump(rewritten, { lineWidth: 120, noRefs: true }), 'utf-8');
      result.loreRewrittenToInsight++;
    } catch (err) {
      result.warnings.push(`lore convert failed: ${path.relative(rootDir, full)} — ${(err as Error).message}`);
    }
  }
}

function collectLoreFiles(dir: string): string[] {
  const results: string[] = [];
  const walk = (d: string): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      const p = path.join(d, ent.name);
      if (ent.isDirectory()) {
        walk(p);
      } else if (ent.isFile() && (ent.name.endsWith('.yaml') || ent.name.endsWith('.lore'))) {
        results.push(p);
      }
    }
  };
  walk(dir);
  return results;
}

function normalizeStatus(status: string | undefined): 'active' | 'superseded' | 'deprecated' | 'proposed' | 'rejected' {
  switch ((status || '').toLowerCase()) {
    case 'accepted':
      return 'active';
    case 'active':
    case 'proposed':
    case 'deprecated':
    case 'superseded':
    case 'rejected':
      return status!.toLowerCase() as 'active' | 'superseded' | 'deprecated' | 'proposed' | 'rejected';
    default:
      return 'active';
  }
}

/**
 * Generate a TD-YYYY-MM-DD-NNN id that doesn't collide with an existing
 * file in the decisions directory. Bumps the counter incrementally.
 */
function generateTdId(date: string, decisionsDir: string, result: MigrationResult): string {
  const existing = new Set<string>();
  try {
    for (const f of fs.readdirSync(decisionsDir)) {
      if (f.startsWith(`TD-${date}-`) && f.endsWith('.yaml')) {
        existing.add(f.replace('.yaml', ''));
      }
    }
  } catch {
    // ignore — fresh dir
  }
  for (let i = 1; i <= 999; i++) {
    const counter = String(i).padStart(3, '0');
    const id = `TD-${date}-${counter}`;
    if (!existing.has(id)) {
      existing.add(id);
      return id;
    }
  }
  // extremely unlikely — caller will see a duplicate filename warning
  result.warnings.push(`TD-id counter exhausted for ${date}`);
  return `TD-${date}-999`;
}

// ensure `error` is retained to keep the intended import set even when all
// error paths collapse into warnings (TypeScript unused-import guard).
void error;
