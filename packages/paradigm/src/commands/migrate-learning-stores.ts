/**
 * paradigm migrate learning-stores — 7.12.0 learning-store consolidation.
 *
 *   paradigm migrate learning-stores --dry-run   # plan per step, zero writes
 *   paradigm migrate learning-stores [--apply] [--json]
 *
 * Steps (each idempotent):
 *   1. Back up every original the run will touch →
 *      .paradigm/backups/learning-stores-<ts>/originals/<rel path>
 *   2. Legacy .paradigm/wisdom/decisions/*.yaml → .paradigm/decisions/ TD store
 *      (reuses `paradigm migrate decisions`' wisdom converter; idempotent via
 *      the `wisdom-decision:<id>` tag), then rmdir wisdom/decisions if empty.
 *   3. Unengaged "Work completed … — review outcome" rows in
 *      events/nominations.jsonl → backups/…/nominations-boilerplate.jsonl (D1).
 *   4. Habits whose file patterns point at removed University paths — REPORT
 *      only, unless --apply (then moved into the backup dir).
 *   5. Marker .paradigm/migrations/learning-stores.done.
 *
 * Global ~/.paradigm/wisdom/decisions is REPORTED, never touched. Lore,
 * journals, notebooks, and the falsifiability ledgers are never touched.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { out, success, warn, dim, header, kv, json as jsonOut } from '../utils/cli-output.js';
import {
  loadAlreadyMigrated,
  migrateWisdomDecisions,
  type MigrationResult as DecisionMigrationResult,
} from './migrate-decisions.js';

export interface MigrateLearningStoresOptions {
  dryRun?: boolean;
  /** Also move dead-path habits (step 4) into the backup dir. */
  apply?: boolean;
  json?: boolean;
  /** Override the home directory (tests). */
  homeDir?: string;
}

export interface LearningStoresStep {
  step: number;
  id: 'backup' | 'wisdom-decisions' | 'nomination-boilerplate' | 'stale-habits' | 'marker';
  /** Human-readable plan / outcome line. */
  summary: string;
  /** Items (relative paths / ids) this step acts on or reports. */
  items: string[];
  /** True when the step changed (or, in dry-run, would change) files. */
  writes: boolean;
}

export interface LearningStoresMigrationResult {
  dryRun: boolean;
  /** True when the marker existed and there was nothing left to do. */
  noop: boolean;
  backupDir?: string;
  steps: LearningStoresStep[];
  globalWisdomDecisions: { path: string; files: number };
  warnings: string[];
}

export const MARKER_REL = path.join('.paradigm', 'migrations', 'learning-stores.done');
const WISDOM_DECISIONS_REL = path.join('.paradigm', 'wisdom', 'decisions');
const NOMINATIONS_REL = path.join('.paradigm', 'events', 'nominations.jsonl');
const HABITS_REL = path.join('.paradigm', 'habits');
const DECISIONS_REL = path.join('.paradigm', 'decisions');

/** The exact D1 boilerplate generateBrief used to emit for `work-completed`. */
export const WORK_COMPLETED_BRIEF = /: Work completed on [\s\S]* — review outcome$/;

const isYaml = (f: string) => f.endsWith('.yaml') || f.endsWith('.yml');

function listYaml(dir: string): string[] {
  try {
    return fs.existsSync(dir) ? fs.readdirSync(dir).filter(isYaml).sort() : [];
  } catch {
    return [];
  }
}

interface NominationRow {
  line: string;
  parsed: { brief?: string; engaged?: boolean; response?: string } | null;
}

function readNominations(file: string): NominationRow[] {
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, 'utf8')
    .split('\n')
    .filter(l => l.trim())
    .map(line => {
      try {
        return { line, parsed: JSON.parse(line) };
      } catch {
        return { line, parsed: null };
      }
    });
}

export function isBoilerplateNomination(row: NominationRow['parsed']): boolean {
  if (!row || typeof row.brief !== 'string') return false;
  if (row.engaged || row.response) return false; // engaged rows are real signal — keep
  return WORK_COMPLETED_BRIEF.test(row.brief);
}

/** Static (non-glob) prefix of a file pattern. */
function staticPrefix(pattern: string): string {
  const idx = pattern.search(/[*?[{]/);
  const lit = idx === -1 ? pattern : pattern.slice(0, idx);
  return idx === -1 ? lit : lit.replace(/[^/]*$/, '');
}

/**
 * Habits whose file patterns reference University paths that no longer exist
 * (University → packs in 7.11.0). Returns habit file names.
 */
export function findStaleUniversityHabits(rootDir: string): string[] {
  const dir = path.join(rootDir, HABITS_REL);
  if (!fs.existsSync(dir)) return [];
  const stale: string[] = [];
  for (const f of fs.readdirSync(dir).filter(n => n.endsWith('.habit')).sort()) {
    try {
      const h = yaml.load(fs.readFileSync(path.join(dir, f), 'utf8')) as
        | { check?: { params?: { patterns?: unknown } } }
        | null;
      const patterns = h?.check?.params?.patterns;
      if (!Array.isArray(patterns)) continue;
      const dead = patterns.some(p => {
        if (typeof p !== 'string' || !/university/i.test(p)) return false;
        const prefix = staticPrefix(p);
        return prefix !== '' && !fs.existsSync(path.join(rootDir, prefix));
      });
      if (dead) stale.push(f);
    } catch {
      // unparsable habit — not ours to judge
    }
  }
  return stale;
}

function copyInto(rootDir: string, backupDir: string, rel: string): void {
  const src = path.join(rootDir, rel);
  const dst = path.join(backupDir, 'originals', rel);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(src, dst);
}

/**
 * Core migration. Pure w.r.t. process state (no cwd, no console) so it is
 * testable against temp dirs.
 */
export function migrateLearningStores(
  rootDir: string,
  options: MigrateLearningStoresOptions = {},
): LearningStoresMigrationResult {
  const root = path.resolve(rootDir);
  const dryRun = !!options.dryRun;
  const home = options.homeDir ?? os.homedir();
  const warnings: string[] = [];

  // ── Plan ──
  const wisdomDir = path.join(root, WISDOM_DECISIONS_REL);
  const wisdomFiles = listYaml(wisdomDir);
  const wisdomDirExists = fs.existsSync(wisdomDir);
  const nominationsPath = path.join(root, NOMINATIONS_REL);
  const nominationRows = readNominations(nominationsPath);
  const boilerplate = nominationRows.filter(r => isBoilerplateNomination(r.parsed));
  const staleHabits = findStaleUniversityHabits(root);
  const globalWisdomDir = path.join(home, '.paradigm', 'wisdom', 'decisions');
  const globalWisdomDecisions = { path: globalWisdomDir, files: listYaml(globalWisdomDir).length };
  const markerPath = path.join(root, MARKER_REL);

  const willMoveHabits = !!options.apply && staleHabits.length > 0;
  const hasWork = wisdomDirExists || boilerplate.length > 0 || willMoveHabits;
  const markerExists = fs.existsSync(markerPath);

  const toBackup = [
    ...wisdomFiles.map(f => path.join(WISDOM_DECISIONS_REL, f)),
    ...(boilerplate.length > 0 ? [NOMINATIONS_REL] : []),
    ...(willMoveHabits ? staleHabits.map(f => path.join(HABITS_REL, f)) : []),
  ];

  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const backupDir = toBackup.length > 0 ? path.join(root, '.paradigm', 'backups', `learning-stores-${ts}`) : undefined;

  const steps: LearningStoresStep[] = [];
  const result: LearningStoresMigrationResult = {
    dryRun,
    noop: !hasWork && markerExists,
    ...(backupDir ? { backupDir: path.relative(root, backupDir) } : {}),
    steps,
    globalWisdomDecisions,
    warnings,
  };

  // Step 1 — backup
  if (backupDir && !dryRun) {
    for (const rel of toBackup) {
      try {
        copyInto(root, backupDir, rel);
      } catch (err) {
        warnings.push(`backup failed for ${rel}: ${(err as Error).message}`);
      }
    }
  }
  steps.push({
    step: 1,
    id: 'backup',
    summary: toBackup.length > 0
      ? `${dryRun ? 'would back up' : 'backed up'} ${toBackup.length} original(s) → ${path.relative(root, backupDir!)}`
      : 'nothing to back up',
    items: toBackup,
    writes: toBackup.length > 0,
  });

  // A failed backup aborts every destructive step.
  const backupOk = warnings.length === 0;

  // Step 2 — wisdom decisions → TD store
  let wisdomSummary = 'no legacy .paradigm/wisdom/decisions/';
  if (wisdomDirExists) {
    if (dryRun) {
      wisdomSummary = `would migrate ${wisdomFiles.length} legacy wisdom decision(s) → .paradigm/decisions/ and remove the dir`;
    } else if (backupOk) {
      const decisionsDir = path.join(root, DECISIONS_REL);
      fs.mkdirSync(decisionsDir, { recursive: true });
      const already = loadAlreadyMigrated(decisionsDir);
      const dm: DecisionMigrationResult = {
        wisdomConverted: 0, wisdomSkipped: 0, loreConverted: 0, loreSkipped: 0,
        loreRewrittenToInsight: 0, warnings: [],
      };
      migrateWisdomDecisions(root, decisionsDir, already, { dryRun: false }, dm);
      warnings.push(...dm.warnings);
      // Sources already migrated on a prior run are skipped (not deleted) by the
      // converter; they are backed up above, so remove them now.
      for (const f of listYaml(wisdomDir)) {
        try {
          const wd = yaml.load(fs.readFileSync(path.join(wisdomDir, f), 'utf8')) as { id?: string } | null;
          if (wd?.id && already.wisdomIds.has(wd.id)) fs.unlinkSync(path.join(wisdomDir, f));
        } catch { /* leave it; reported below */ }
      }
      try {
        if (fs.existsSync(wisdomDir) && fs.readdirSync(wisdomDir).length === 0) fs.rmdirSync(wisdomDir);
      } catch { /* non-fatal */ }
      const left = fs.existsSync(wisdomDir) ? fs.readdirSync(wisdomDir).length : 0;
      wisdomSummary = `migrated ${dm.wisdomConverted}, already-migrated ${dm.wisdomSkipped}` +
        (left === 0 ? '; removed .paradigm/wisdom/decisions/' : `; ${left} file(s) left in place (see warnings)`);
    } else {
      wisdomSummary = 'skipped — backup failed';
    }
  }
  steps.push({ step: 2, id: 'wisdom-decisions', summary: wisdomSummary, items: wisdomFiles, writes: wisdomDirExists });

  // Step 3 — nomination boilerplate
  let nomSummary = 'no "Work completed" boilerplate nominations';
  if (boilerplate.length > 0) {
    if (dryRun) {
      nomSummary = `would move ${boilerplate.length}/${nominationRows.length} unengaged "Work completed" nomination(s) to the backup dir`;
    } else if (backupOk && backupDir) {
      fs.mkdirSync(backupDir, { recursive: true });
      fs.writeFileSync(
        path.join(backupDir, 'nominations-boilerplate.jsonl'),
        boilerplate.map(r => r.line).join('\n') + '\n',
        'utf8',
      );
      const keep = nominationRows.filter(r => !isBoilerplateNomination(r.parsed)).map(r => r.line);
      // Atomic rewrite: a crash mid-write must never truncate the live stream.
      const tmp = `${nominationsPath}.tmp-${process.pid}`;
      fs.writeFileSync(tmp, keep.length > 0 ? keep.join('\n') + '\n' : '', 'utf8');
      fs.renameSync(tmp, nominationsPath);
      nomSummary = `moved ${boilerplate.length} boilerplate nomination(s); ${keep.length} kept`;
    } else {
      nomSummary = 'skipped — backup failed';
    }
  }
  steps.push({
    step: 3,
    id: 'nomination-boilerplate',
    summary: nomSummary,
    items: boilerplate.map(r => (r.parsed as { id?: string } | null)?.id ?? '?'),
    writes: boilerplate.length > 0,
  });

  // Step 4 — stale University habits (report unless --apply)
  let habitSummary = 'no habits reference removed University paths';
  if (staleHabits.length > 0) {
    if (!options.apply) {
      habitSummary = `${staleHabits.length} habit(s) reference removed University paths — report only (re-run with --apply to move them to the backup dir)`;
    } else if (dryRun) {
      habitSummary = `would move ${staleHabits.length} stale habit(s) to the backup dir`;
    } else if (backupOk) {
      for (const f of staleHabits) {
        try {
          fs.unlinkSync(path.join(root, HABITS_REL, f));
        } catch (err) {
          warnings.push(`habit remove failed: ${f} — ${(err as Error).message}`);
        }
      }
      habitSummary = `moved ${staleHabits.length} stale habit(s) to the backup dir`;
    } else {
      habitSummary = 'skipped — backup failed';
    }
  }
  steps.push({ step: 4, id: 'stale-habits', summary: habitSummary, items: staleHabits, writes: willMoveHabits });

  // Step 5 — marker
  const writeMarker = !markerExists || hasWork;
  if (writeMarker && !dryRun && backupOk) {
    fs.mkdirSync(path.dirname(markerPath), { recursive: true });
    fs.writeFileSync(
      markerPath,
      JSON.stringify({ migration: 'learning-stores', version: '7.12.0', ts: new Date().toISOString(), backupDir: result.backupDir ?? null }) + '\n',
      'utf8',
    );
  }
  steps.push({
    step: 5,
    id: 'marker',
    summary: writeMarker ? `${dryRun ? 'would write' : 'wrote'} ${MARKER_REL}` : `${MARKER_REL} present — nothing to do`,
    items: [MARKER_REL],
    writes: writeMarker,
  });

  return result;
}

/** Cheap detector used by `paradigm migrate` (migrations.ts) auto-detect. */
export function learningStoresMigrationNeeded(rootDir: string): { needed: boolean; reasons: string[] } {
  const root = path.resolve(rootDir);
  const reasons: string[] = [];
  if (fs.existsSync(path.join(root, WISDOM_DECISIONS_REL))) reasons.push('legacy .paradigm/wisdom/decisions/ present');
  const boiler = readNominations(path.join(root, NOMINATIONS_REL)).filter(r => isBoilerplateNomination(r.parsed)).length;
  if (boiler > 0) reasons.push(`${boiler} "Work completed" boilerplate nomination(s)`);
  return { needed: reasons.length > 0, reasons };
}

export async function migrateLearningStoresCommand(options: MigrateLearningStoresOptions = {}): Promise<void> {
  const res = migrateLearningStores(process.cwd(), options);

  if (options.json) {
    jsonOut(res);
    return;
  }

  header('paradigm migrate learning-stores');
  if (res.dryRun) dim('  mode: dry-run (no writes)');
  if (res.noop) {
    success('learning-stores already migrated — nothing to do');
    return;
  }
  for (const s of res.steps) {
    out(`  ${s.step}. ${s.id}: ${s.summary}`);
  }
  kv('global ~/.paradigm/wisdom/decisions', `${res.globalWisdomDecisions.files} file(s) — report only, never touched`);
  if (res.warnings.length > 0) {
    warn('Warnings:');
    for (const w of res.warnings) dim(`  - ${w}`);
  }
  success(res.dryRun ? 'dry-run complete — re-run without --dry-run to apply' : 'migrate learning-stores complete');
}
