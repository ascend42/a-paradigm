/**
 * University Metrics — CLI-side captureSnapshot (v6.0 sub-phase 2).
 *
 * Mirrors packages/paradigm-mcp/src/utils/university-metrics.ts but lives in
 * the CLI so the shift/doctor hooks don't require the paradigm-mcp package
 * as a runtime dependency. The format is pinned by `UniversityMetricsSnapshot`
 * (schema_version: "1") so snapshots written from either side interleave
 * cleanly on disk.
 *
 * Privacy contract (spec §8.2 + D7):
 *   - Counts + classifiers + hashed salt only.
 *   - NEVER writes content bodies, entry titles, gate names, or route paths.
 *   - Honors `metrics.local_snapshots_enabled` (default true).
 *
 * Retention: 90 days, pruned on every capture.
 */

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';

export interface UniversityMetricsSnapshot {
  schema_version: '1';
  captured_at: string;
  project_salt_hash: string;
  packs: {
    count: number;
    by_tenant_kind: { first_party: number; project: number; external: number };
  };
  project_pack: {
    exists: boolean;
    entry_counts: { notes: number; policies: number; quizzes: number; paths: number; diplomas: number };
    disciplines: number;
    last_modified_days_ago: number;
  };
  activity: {
    quiz_completions_last_30d: number;
    entries_created_last_30d: number;
  };
}

const UNIVERSITY_DIR = '.paradigm/university';
const METRICS_DIR = '.paradigm/university/.metrics';
const SALT_FILE = '.paradigm/.metrics-salt';
const CONFIG_FILE = '.paradigm/config.yaml';
const PACK_MANIFEST = 'pack.yaml';
const SNAPSHOT_SCHEMA_VERSION = '1' as const;
const DEFAULT_RETAIN_DAYS = 90;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

function computeProjectSaltHash(rootDir: string): string {
  const saltPath = path.join(rootDir, SALT_FILE);
  let salt: string;

  if (fs.existsSync(saltPath)) {
    try {
      salt = fs.readFileSync(saltPath, 'utf8').trim();
      if (!salt) salt = writeNewSalt(saltPath);
    } catch {
      salt = writeNewSalt(saltPath);
    }
  } else {
    salt = writeNewSalt(saltPath);
  }

  return crypto.createHash('sha256').update(path.resolve(rootDir) + salt).digest('hex');
}

function writeNewSalt(saltPath: string): string {
  const salt = crypto.randomBytes(32).toString('hex');
  try {
    fs.mkdirSync(path.dirname(saltPath), { recursive: true });
    fs.writeFileSync(saltPath, salt, { mode: 0o600, encoding: 'utf8' });
    try { fs.chmodSync(saltPath, 0o600); } catch { /* non-fatal on Windows */ }
  } catch {
    // Salt write failed — use ephemeral salt rather than throwing.
  }
  return salt;
}

function localSnapshotsEnabled(rootDir: string): boolean {
  const cfgPath = path.join(rootDir, CONFIG_FILE);
  if (!fs.existsSync(cfgPath)) return true;
  try {
    const raw = fs.readFileSync(cfgPath, 'utf8');
    const cfg = yaml.load(raw) as { metrics?: { local_snapshots_enabled?: boolean } } | null;
    if (!cfg || !cfg.metrics) return true;
    return cfg.metrics.local_snapshots_enabled !== false;
  } catch {
    return true;
  }
}

/** Discover packs locally — mirrors paradigm-mcp discovery but lightweight. */
function discoverPacksLite(rootDir: string): Array<{ tenantKind: string; parentPackId?: string }> {
  const out: Array<{ tenantKind: string; parentPackId?: string }> = [];

  // First-party
  const fpRoot = path.join(rootDir, 'node_modules', '@a-company', 'university');
  if (fs.existsSync(path.join(fpRoot, PACK_MANIFEST))) {
    try {
      const m = yaml.load(fs.readFileSync(path.join(fpRoot, PACK_MANIFEST), 'utf8')) as { tenant_kind?: string } | null;
      if (m?.tenant_kind) out.push({ tenantKind: m.tenant_kind });
    } catch { /* skip */ }
  }

  // Local project pack
  const localRoot = path.join(rootDir, UNIVERSITY_DIR);
  if (fs.existsSync(localRoot)) {
    const mainManifest = path.join(localRoot, PACK_MANIFEST);
    let parentId: string | undefined;
    if (fs.existsSync(mainManifest)) {
      try {
        const m = yaml.load(fs.readFileSync(mainManifest, 'utf8')) as { tenant_kind?: string; id?: string } | null;
        if (m?.tenant_kind) {
          out.push({ tenantKind: m.tenant_kind });
          parentId = m.id;
        }
      } catch { /* skip */ }
    }
    // Sub-packs
    try {
      const entries = fs.readdirSync(localRoot, { withFileTypes: true });
      for (const ent of entries) {
        if (!ent.isDirectory() || ent.name.startsWith('.')) continue;
        const subManifest = path.join(localRoot, ent.name, PACK_MANIFEST);
        if (!fs.existsSync(subManifest)) continue;
        try {
          const sm = yaml.load(fs.readFileSync(subManifest, 'utf8')) as { tenant_kind?: string } | null;
          if (sm?.tenant_kind) out.push({ tenantKind: sm.tenant_kind, parentPackId: parentId });
        } catch { /* skip */ }
      }
    } catch { /* skip */ }
  }

  return out;
}

function countFiles(dir: string, ext: string): number {
  if (!fs.existsSync(dir)) return 0;
  try {
    return fs.readdirSync(dir).filter(f => f.endsWith(ext)).length;
  } catch { return 0; }
}

function countRecentFiles(dir: string, ext: string, sinceMs: number): number {
  if (!fs.existsSync(dir)) return 0;
  let count = 0;
  try {
    for (const f of fs.readdirSync(dir).filter(f => f.endsWith(ext))) {
      try {
        const s = fs.statSync(path.join(dir, f));
        if (s.mtime.getTime() >= sinceMs) count += 1;
      } catch { /* skip */ }
    }
  } catch { /* skip */ }
  return count;
}

function findMaxMtime(dir: string): number {
  if (!fs.existsSync(dir)) return Date.now();
  let max = 0;
  const walk = (d: string): void => {
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const ent of entries) {
      const p = path.join(d, ent.name);
      try {
        if (ent.isDirectory()) walk(p);
        else {
          const ms = fs.statSync(p).mtime.getTime();
          if (ms > max) max = ms;
        }
      } catch { /* skip */ }
    }
  };
  walk(dir);
  return max || Date.now();
}

/**
 * Capture a metrics snapshot and write it to .paradigm/university/.metrics/
 * snapshot-YYYY-MM-DD.json. No-ops when metrics.local_snapshots_enabled is
 * false. Privacy-preserving: counts + classifiers only.
 */
export function captureSnapshot(rootDir: string): void {
  if (!localSnapshotsEnabled(rootDir)) return;

  const metricsDir = path.join(rootDir, METRICS_DIR);
  try { fs.mkdirSync(metricsDir, { recursive: true }); } catch { return; }

  const packs = discoverPacksLite(rootDir);

  const byTenantKind = { first_party: 0, project: 0, external: 0 };
  for (const p of packs) {
    if (p.tenantKind === 'first-party') byTenantKind.first_party += 1;
    else if (p.tenantKind === 'project') byTenantKind.project += 1;
    else if (p.tenantKind === 'external') byTenantKind.external += 1;
  }

  const localUniDir = path.join(rootDir, UNIVERSITY_DIR);
  const contentRoot = path.join(localUniDir, 'content');
  const localExists = fs.existsSync(localUniDir);

  const entryCounts = {
    notes: countFiles(path.join(contentRoot, 'notes'), '.md'),
    policies: countFiles(path.join(contentRoot, 'policies'), '.md'),
    quizzes: countFiles(path.join(contentRoot, 'quizzes'), '.yaml'),
    paths: countFiles(path.join(contentRoot, 'paths'), '.yaml'),
    diplomas: countFiles(path.join(localUniDir, 'diplomas'), '.yaml'),
  };

  const disciplines = packs.filter(p => p.parentPackId).length;
  const lastModifiedDaysAgo = localExists
    ? Math.max(0, Math.floor((Date.now() - findMaxMtime(contentRoot)) / MS_PER_DAY))
    : 0;

  const now = Date.now();
  const windowStart = now - 30 * MS_PER_DAY;

  const snapshot: UniversityMetricsSnapshot = {
    schema_version: SNAPSHOT_SCHEMA_VERSION,
    captured_at: new Date().toISOString(),
    project_salt_hash: computeProjectSaltHash(rootDir),
    packs: { count: packs.length, by_tenant_kind: byTenantKind },
    project_pack: {
      exists: packs.some(p => p.tenantKind === 'project' && !p.parentPackId),
      entry_counts: entryCounts,
      disciplines,
      last_modified_days_ago: lastModifiedDaysAgo,
    },
    activity: {
      quiz_completions_last_30d: countRecentFiles(path.join(localUniDir, 'diplomas'), '.yaml', windowStart),
      entries_created_last_30d:
        countRecentFiles(path.join(contentRoot, 'notes'), '.md', windowStart) +
        countRecentFiles(path.join(contentRoot, 'policies'), '.md', windowStart) +
        countRecentFiles(path.join(contentRoot, 'quizzes'), '.yaml', windowStart) +
        countRecentFiles(path.join(contentRoot, 'paths'), '.yaml', windowStart),
    },
  };

  const today = new Date().toISOString().slice(0, 10);
  const outPath = path.join(metricsDir, `snapshot-${today}.json`);
  try {
    fs.writeFileSync(outPath, JSON.stringify(snapshot, null, 2), 'utf8');
  } catch {
    return;
  }

  try { pruneOldSnapshots(rootDir); } catch { /* non-fatal */ }
}

export function pruneOldSnapshots(rootDir: string, retainDays: number = DEFAULT_RETAIN_DAYS): void {
  const metricsDir = path.join(rootDir, METRICS_DIR);
  if (!fs.existsSync(metricsDir)) return;

  let files: string[];
  try {
    files = fs.readdirSync(metricsDir).filter(f => f.startsWith('snapshot-') && f.endsWith('.json'));
  } catch { return; }

  const cutoff = Date.now() - retainDays * MS_PER_DAY;
  for (const file of files) {
    const m = file.match(/^snapshot-(\d{4}-\d{2}-\d{2})\.json$/);
    if (!m) continue;
    const ts = Date.parse(m[1]);
    if (isNaN(ts)) continue;
    if (ts < cutoff) {
      try { fs.unlinkSync(path.join(metricsDir, file)); } catch { /* non-fatal */ }
    }
  }
}

/**
 * Seed metrics.remote_consent: pending in .paradigm/config.yaml if the
 * field is absent (idempotent). Does nothing when config is unreadable.
 */
export function seedMetricsConsent(rootDir: string): void {
  const cfgPath = path.join(rootDir, CONFIG_FILE);
  if (!fs.existsSync(cfgPath)) return;

  let raw: string;
  try { raw = fs.readFileSync(cfgPath, 'utf8'); } catch { return; }

  let cfg: Record<string, unknown>;
  try { cfg = (yaml.load(raw) as Record<string, unknown>) ?? {}; } catch { return; }

  const existing = cfg.metrics as { remote_consent?: string; local_snapshots_enabled?: boolean } | undefined;
  if (existing && 'remote_consent' in existing) {
    return;  // already seeded
  }

  const updated: Record<string, unknown> = { ...cfg };
  updated.metrics = {
    ...(existing || {}),
    remote_consent: 'pending',
    local_snapshots_enabled: existing?.local_snapshots_enabled ?? true,
  };

  try {
    fs.writeFileSync(cfgPath, yaml.dump(updated, { lineWidth: -1, quotingType: '"' }), 'utf8');
  } catch {
    // non-fatal
  }
}
