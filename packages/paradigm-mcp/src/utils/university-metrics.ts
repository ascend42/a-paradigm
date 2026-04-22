/**
 * University Metrics — v6.0 (D7 locked).
 *
 * Local-only, privacy-preserving snapshot capture. Feeds the v6.3 sunset
 * review per spec §8. NEVER writes content bodies, entry titles, gate names,
 * or route paths. Counts + hashed salt only.
 *
 * Honors `config.metrics.local_snapshots_enabled`. When false, all capture
 * operations no-op.
 *
 * Storage: `.paradigm/university/.metrics/snapshot-YYYY-MM-DD.json` (idempotent
 * per-day; later captures on the same day overwrite). Retention: 90 days
 * (see `pruneOldSnapshots`).
 */

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import type { UniversityMetricsSnapshot } from '../types/university-metrics.js';
import type { PackLocation } from '../types/pack.js';
import { discoverPacks } from './pack-loader.js';
import { log } from './mcp-logger.js';

const UNIVERSITY_DIR = '.paradigm/university';
const METRICS_DIR = '.paradigm/university/.metrics';
const SALT_FILE = '.paradigm/.metrics-salt';
const CONFIG_FILE = '.paradigm/config.yaml';
const SNAPSHOT_SCHEMA_VERSION = '1' as const;
const DEFAULT_RETAIN_DAYS = 90;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

// ─────────────────────────────────────────────────────────────
// Salt + project hash (privacy)
// ─────────────────────────────────────────────────────────────

/**
 * Returns a stable per-project hash: `sha256(projectRootPath + salt)` as hex.
 * Creates the salt file (0o600) on first call; subsequent calls read it.
 * Salt is 32 bytes of real randomness from `crypto.randomBytes`.
 */
export function computeProjectSaltHash(rootDir: string): string {
  const saltPath = path.join(rootDir, SALT_FILE);
  let salt: string;

  if (fs.existsSync(saltPath)) {
    try {
      salt = fs.readFileSync(saltPath, 'utf8').trim();
      if (!salt) {
        salt = generateAndWriteSalt(saltPath);
      }
    } catch {
      // Read error → regenerate (privacy property isn't broken by changing salt)
      salt = generateAndWriteSalt(saltPath);
    }
  } else {
    salt = generateAndWriteSalt(saltPath);
  }

  return crypto
    .createHash('sha256')
    .update(path.resolve(rootDir) + salt)
    .digest('hex');
}

function generateAndWriteSalt(saltPath: string): string {
  const salt = crypto.randomBytes(32).toString('hex');
  try {
    fs.mkdirSync(path.dirname(saltPath), { recursive: true });
    // Write with 0o600 (owner rw only) — salt is a privacy primitive
    fs.writeFileSync(saltPath, salt, { mode: 0o600, encoding: 'utf8' });
    try {
      fs.chmodSync(saltPath, 0o600);
    } catch {
      // chmod failures are non-fatal (Windows, etc.)
    }
  } catch (err) {
    log.component('#university-metrics').warn('salt write failed; using ephemeral salt', {
      error: (err as Error).message,
    });
  }
  return salt;
}

// ─────────────────────────────────────────────────────────────
// Config probe
// ─────────────────────────────────────────────────────────────

/**
 * Returns true if `.paradigm/config.yaml` enables local snapshots. Default
 * is enabled (true) when config or the key is absent — matches D7 default.
 */
function localSnapshotsEnabled(rootDir: string): boolean {
  const cfgPath = path.join(rootDir, CONFIG_FILE);
  if (!fs.existsSync(cfgPath)) return true;
  try {
    const raw = fs.readFileSync(cfgPath, 'utf8');
    const cfg = yaml.load(raw) as { metrics?: { local_snapshots_enabled?: boolean } } | null;
    if (!cfg || !cfg.metrics) return true;
    return cfg.metrics.local_snapshots_enabled !== false;
  } catch {
    // Malformed config → default to enabled
    return true;
  }
}

// ─────────────────────────────────────────────────────────────
// Snapshot capture
// ─────────────────────────────────────────────────────────────

/**
 * Capture a metrics snapshot and write it to
 * `.paradigm/university/.metrics/snapshot-YYYY-MM-DD.json`.
 * Idempotent per-day — multiple calls on the same day overwrite.
 *
 * No-ops silently when `metrics.local_snapshots_enabled` is `false`.
 *
 * Privacy contract: no entry titles, no file contents, no gate names, no
 * route paths — counts + classifiers + hashed salt only. Asserted on write
 * via the type `UniversityMetricsSnapshot` (schema is count-only by design).
 */
export function captureSnapshot(rootDir: string): void {
  if (!localSnapshotsEnabled(rootDir)) {
    return;
  }

  const metricsDir = path.join(rootDir, METRICS_DIR);
  try {
    fs.mkdirSync(metricsDir, { recursive: true });
  } catch (err) {
    log.component('#university-metrics').warn('could not create metrics dir', {
      error: (err as Error).message,
    });
    return;
  }

  let packs: PackLocation[] = [];
  try {
    packs = discoverPacks(rootDir);
  } catch (err) {
    log.component('#university-metrics').warn('pack discovery failed during snapshot', {
      error: (err as Error).message,
    });
  }

  const byTenantKind = {
    first_party: 0,
    project: 0,
    external: 0,
  };
  for (const p of packs) {
    const kind = p.manifest.tenant_kind;
    if (kind === 'first-party') byTenantKind.first_party += 1;
    else if (kind === 'project') byTenantKind.project += 1;
    else if (kind === 'external') byTenantKind.external += 1;
  }

  const projectPack = capturePerProjectStats(rootDir, packs);

  const snapshot: UniversityMetricsSnapshot = {
    schema_version: SNAPSHOT_SCHEMA_VERSION,
    captured_at: new Date().toISOString(),
    project_salt_hash: computeProjectSaltHash(rootDir),
    packs: {
      count: packs.length,
      by_tenant_kind: byTenantKind,
    },
    project_pack: projectPack,
    activity: captureActivity(rootDir),
  };

  const today = new Date().toISOString().slice(0, 10);
  const outPath = path.join(metricsDir, `snapshot-${today}.json`);
  try {
    fs.writeFileSync(outPath, JSON.stringify(snapshot, null, 2), 'utf8');
  } catch (err) {
    log.component('#university-metrics').warn('snapshot write failed', {
      error: (err as Error).message,
    });
    return;
  }

  // Prune older than retention window on every capture (cheap)
  try {
    pruneOldSnapshots(rootDir);
  } catch {
    // non-fatal
  }
}

function capturePerProjectStats(
  rootDir: string,
  packs: PackLocation[],
): UniversityMetricsSnapshot['project_pack'] {
  const localUniDir = path.join(rootDir, UNIVERSITY_DIR);
  const localExists = fs.existsSync(localUniDir);

  const entryCounts = {
    notes: countFiles(path.join(localUniDir, 'content/notes'), '.md'),
    policies: countFiles(path.join(localUniDir, 'content/policies'), '.md'),
    quizzes: countFiles(path.join(localUniDir, 'content/quizzes'), '.yaml'),
    paths: countFiles(path.join(localUniDir, 'content/paths'), '.yaml'),
    diplomas: countFiles(path.join(localUniDir, 'diplomas'), '.yaml'),
  };

  // Discipline sub-packs are detectable from pack discovery (parentPackId set)
  const disciplines = packs.filter(p => p.parentPackId).length;

  const lastModifiedDaysAgo = localExists
    ? Math.max(0, Math.floor((Date.now() - findMaxMtime(path.join(localUniDir, 'content'))) / MS_PER_DAY))
    : 0;

  return {
    // `exists` reflects "the project has a project-tenant pack registered
    // (manifest present)". A v5 directory without pack.yaml reports
    // exists: false — its counts still surface in `entry_counts`.
    exists: packs.some(p => p.manifest.tenant_kind === 'project'),
    entry_counts: entryCounts,
    disciplines,
    last_modified_days_ago: lastModifiedDaysAgo,
  };
}

function captureActivity(rootDir: string): UniversityMetricsSnapshot['activity'] {
  // Diplomas are the local signal for "quiz completions". Count diplomas
  // earned in the last 30 days, based on file mtime (YAML `earnedAt` parsing
  // would require loading + parsing each file — mtime is cheap and
  // privacy-safe since we never surface the filename or contents).
  const diplomasDir = path.join(rootDir, UNIVERSITY_DIR, 'diplomas');
  const entriesCreatedWindow = 30 * MS_PER_DAY;
  const now = Date.now();

  const quizCompletions = countRecentFiles(diplomasDir, '.yaml', now - entriesCreatedWindow);

  // "entries created in last 30d" across all content dirs. Sum of recent
  // mtimes in notes/policies/quizzes/paths — mtime is the cheapest proxy
  // that doesn't require parsing. Good enough for the sunset-review signal.
  const contentRoot = path.join(rootDir, UNIVERSITY_DIR, 'content');
  const entriesCreated =
    countRecentFiles(path.join(contentRoot, 'notes'), '.md', now - entriesCreatedWindow) +
    countRecentFiles(path.join(contentRoot, 'policies'), '.md', now - entriesCreatedWindow) +
    countRecentFiles(path.join(contentRoot, 'quizzes'), '.yaml', now - entriesCreatedWindow) +
    countRecentFiles(path.join(contentRoot, 'paths'), '.yaml', now - entriesCreatedWindow);

  return {
    quiz_completions_last_30d: quizCompletions,
    entries_created_last_30d: entriesCreated,
  };
}

// ─────────────────────────────────────────────────────────────
// Snapshot read + prune
// ─────────────────────────────────────────────────────────────

/**
 * Load up to `days` most-recent snapshots (newest first). Silently drops
 * corrupt files. Returns empty list when the metrics dir does not exist.
 */
export function loadRecentSnapshots(rootDir: string, days: number): UniversityMetricsSnapshot[] {
  const metricsDir = path.join(rootDir, METRICS_DIR);
  if (!fs.existsSync(metricsDir)) return [];

  let files: string[];
  try {
    files = fs.readdirSync(metricsDir).filter(f => f.startsWith('snapshot-') && f.endsWith('.json'));
  } catch {
    return [];
  }

  files.sort((a, b) => b.localeCompare(a));  // lex-desc → newest first (YYYY-MM-DD)
  const cap = Math.max(0, days | 0);
  const selected = files.slice(0, cap);

  const results: UniversityMetricsSnapshot[] = [];
  for (const file of selected) {
    try {
      const raw = fs.readFileSync(path.join(metricsDir, file), 'utf8');
      const snap = JSON.parse(raw) as UniversityMetricsSnapshot;
      if (snap && typeof snap === 'object' && snap.schema_version === SNAPSHOT_SCHEMA_VERSION) {
        results.push(snap);
      }
    } catch {
      // corrupt snapshot — skip
    }
  }
  return results;
}

/**
 * Remove snapshots older than `retainDays` (default: 90). Idempotent.
 * Called automatically by `captureSnapshot` on every capture.
 */
export function pruneOldSnapshots(rootDir: string, retainDays: number = DEFAULT_RETAIN_DAYS): void {
  const metricsDir = path.join(rootDir, METRICS_DIR);
  if (!fs.existsSync(metricsDir)) return;

  let files: string[];
  try {
    files = fs.readdirSync(metricsDir).filter(f => f.startsWith('snapshot-') && f.endsWith('.json'));
  } catch {
    return;
  }

  const cutoff = Date.now() - retainDays * MS_PER_DAY;
  for (const file of files) {
    // Parse date from filename: "snapshot-YYYY-MM-DD.json"
    const m = file.match(/^snapshot-(\d{4}-\d{2}-\d{2})\.json$/);
    if (!m) continue;
    const ts = Date.parse(m[1]);
    if (isNaN(ts)) continue;
    if (ts < cutoff) {
      try {
        fs.unlinkSync(path.join(metricsDir, file));
      } catch {
        // non-fatal
      }
    }
  }
}

// ─────────────────────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────────────────────

function countFiles(dir: string, ext: string): number {
  if (!fs.existsSync(dir)) return 0;
  try {
    return fs.readdirSync(dir).filter(f => f.endsWith(ext)).length;
  } catch {
    return 0;
  }
}

function countRecentFiles(dir: string, ext: string, sinceMs: number): number {
  if (!fs.existsSync(dir)) return 0;
  try {
    const files = fs.readdirSync(dir).filter(f => f.endsWith(ext));
    let count = 0;
    for (const f of files) {
      try {
        const s = fs.statSync(path.join(dir, f));
        if (s.mtime.getTime() >= sinceMs) count += 1;
      } catch {
        // skip
      }
    }
    return count;
  } catch {
    return 0;
  }
}

function findMaxMtime(dir: string): number {
  if (!fs.existsSync(dir)) return Date.now();
  let max = 0;
  const walk = (d: string) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      const p = path.join(d, ent.name);
      try {
        if (ent.isDirectory()) {
          walk(p);
        } else {
          const s = fs.statSync(p);
          const ms = s.mtime.getTime();
          if (ms > max) max = ms;
        }
      } catch {
        // skip unreadable
      }
    }
  };
  walk(dir);
  return max || Date.now();
}
