/**
 * #brain-index-store — the derived JSON index (metadata only) + incremental scan.
 *
 * MODULE-PRIVATE: only view.ts may import this file (enforced by
 * brain-security.test.ts). Every read of indexed data goes through the view
 * choke point so gate filtering happens before any matching.
 *
 * Order per file: hard-block/symlink refusal (walk) → size cap → DETECTORS →
 * (only if clean) parse → persist. Detector hits keep ONLY path + size.
 */
import * as fs from 'node:fs';
import * as crypto from 'node:crypto';
import * as path from 'node:path';
import { log } from '../mcp-logger.js';
import { atomicWriteFileSync } from './atomic.js';
import { assertBrainWritePath, appendZones, brainFile, loadBrainConfig, BrainConfigError } from './config.js';
import { readVerified, walkRoot, type WalkEntry } from './walk.js';
import { detect, DetectorTimeoutError, shouldReadForDetection } from './detect.js';
import { parseMarkdown, parseText, PARSED_EXTS } from './parse.js';
import type {
  BrainIndex,
  BrainOptions,
  BrainZone,
  FileKind,
  FlaggedFolder,
  IndexRecord,
  ScanReport,
} from './types.js';

const L = () => log.component('#brain-index-store');

export function loadIndex(rootHash: string, opts?: BrainOptions): BrainIndex | null {
  let text: string;
  try {
    text = fs.readFileSync(brainFile(rootHash, 'index', opts), 'utf8');
  } catch {
    return null;
  }
  try {
    const idx = JSON.parse(text) as BrainIndex;
    if (!idx || idx.version !== 1 || !Array.isArray(idx.records) || idx.rootHash !== rootHash) return null;
    if (!Array.isArray(idx.flagged)) idx.flagged = [];
    return idx;
  } catch {
    L().warn('Brain index unreadable — treating as empty', { rootHash });
    return null;
  }
}

function saveIndex(idx: BrainIndex, opts?: BrainOptions): void {
  const file = brainFile(idx.rootHash, 'index', opts);
  assertBrainWritePath(file, idx.root, opts);
  atomicWriteFileSync(file, JSON.stringify(idx));
}

function kindOf(ext: string): FileKind {
  if (ext === '.md' || ext === '.markdown') return 'markdown';
  if (ext === '.txt') return 'text';
  return 'other';
}

function folderOf(rel: string): string {
  const d = path.posix.dirname(rel);
  return d === '.' ? '' : d;
}

function isBinary(buf: Buffer): boolean {
  const n = Math.min(buf.length, 8192);
  for (let i = 0; i < n; i++) if (buf[i] === 0) return true;
  return false;
}

function minimal(id: string, e: WalkEntry, status: IndexRecord['status'], skipReason?: IndexRecord['skipReason']): IndexRecord {
  const r: IndexRecord = { id, relpath: e.relpath, size: e.size, status, kind: kindOf(e.ext), ext: e.ext };
  if (skipReason) r.skipReason = skipReason;
  return r;
}

/**
 * Full or incremental scan. Reuses records whose (size, mtime) are unchanged;
 * hashes only changed files. Atomic rewrite of index.json.
 */
export function runScan(rootHash: string, opts?: BrainOptions): ScanReport {
  const t0 = performance.now();
  const cfg = loadBrainConfig(rootHash, opts);
  if (!fs.existsSync(cfg.root)) throw new BrainConfigError('folder no longer exists');
  const { max_file_bytes, max_files, parse_ms } = cfg.limits;

  const walked = walkRoot(cfg.root, max_files, opts);

  // Name-based zones are appended (tighten-only) before anything is persisted.
  const zonesToAdd: BrainZone[] = walked.nameZones.map((z) => ({ glob: `${z.folder}/**`, gate: z.gate, source: 'name' }));

  const prev = loadIndex(rootHash, opts);
  const prevByPath = new Map<string, IndexRecord>();
  for (const r of prev?.records ?? []) prevByPath.set(r.relpath, r);
  const newPaths = new Set(walked.files.map((f) => f.relpath));
  // Rename candidates: previous records whose path vanished.
  const goneByIno = new Map<number, IndexRecord>();
  const goneByHash = new Map<string, IndexRecord>();
  for (const r of prev?.records ?? []) {
    if (newPaths.has(r.relpath) || r.status !== 'indexed') continue;
    if (typeof r.ino === 'number') goneByIno.set(r.ino, r);
    if (r.hash) goneByHash.set(r.hash, r);
  }

  const usedIds = new Set<string>();
  const newId = (e: WalkEntry): string => {
    let salt = 0;
    for (;;) {
      const id = 'f_' + crypto.createHash('sha256').update(`${rootHash}:${e.relpath}:${e.ino}:${salt}`).digest('hex').slice(0, 10);
      if (!usedIds.has(id)) return id;
      salt++;
    }
  };
  const claim = (id: string) => { usedIds.add(id); return id; };

  const records: IndexRecord[] = [];
  const flaggedMap = new Map<string, FlaggedFolder>();
  const flag = (folder: string, reason: FlaggedFolder['reason']) => {
    const key = `${reason}\u0000${folder}`;
    const f = flaggedMap.get(key);
    if (f) f.count++;
    else flaggedMap.set(key, { folder, reason, count: 1 });
  };
  const report: ScanReport = {
    rootHash, files: 0, added: 0, changed: 0, removed: 0, unchanged: 0, renamed: 0,
    quarantined: 0, thirdParty: 0, skipped: 0, refused: walked.refused,
    truncated: walked.truncated, zonesAdded: [], durationMs: 0,
  };

  for (const e of walked.files) {
    const p = prevByPath.get(e.relpath);
    if (p && p.status === 'indexed' && p.size === e.size && p.mtimeMs === e.mtimeMs && p.ino === e.ino && !usedIds.has(p.id)) {
      claim(p.id);
      records.push(p);
      report.unchanged++;
      continue;
    }
    if (p && p.status === 'skipped' && p.skipReason === 'too-large' && p.size === e.size && !usedIds.has(p.id)) {
      claim(p.id);
      records.push(p);
      report.unchanged++;
      report.skipped++;
      continue;
    }
    const baseId = p && !usedIds.has(p.id) ? p.id : null;
    if (p) report.changed++; else report.added++;

    const kind = kindOf(e.ext);
    if (e.size > max_file_bytes) {
      records.push(minimal(claim(baseId ?? newId(e)), e, 'skipped', 'too-large'));
      report.skipped++;
      continue;
    }

    const parsed = PARSED_EXTS.has(e.ext);
    const readForDetect = parsed || shouldReadForDetection(e.relpath, e.ext);
    let text: string | null = null;
    let buf: Buffer | null = null;
    if (readForDetect) {
      let got: Buffer | 'changed' | 'too-large';
      try {
        got = readVerified(e, max_file_bytes);
      } catch {
        records.push(minimal(claim(baseId ?? newId(e)), e, 'skipped', 'unreadable'));
        report.skipped++;
        continue;
      }
      if (got === 'changed') {
        L().warn('File changed between walk and read — skipped', { rootHash, id: baseId ?? undefined });
        records.push(minimal(claim(baseId ?? newId(e)), e, 'skipped', 'changed-during-read'));
        report.skipped++;
        continue;
      }
      if (got === 'too-large') {
        records.push(minimal(claim(baseId ?? newId(e)), e, 'skipped', 'too-large'));
        report.skipped++;
        continue;
      }
      buf = got;
      if (isBinary(buf)) {
        records.push(minimal(claim(baseId ?? newId(e)), e, 'skipped', 'binary'));
        report.skipped++;
        continue;
      }
      text = buf.toString('utf8');
    }

    const tStart = performance.now();
    // ── DETECTORS FIRST (fail closed: a throw quarantines) ──
    // parse_ms is a PRE-EMPTIVE budget: detection aborts once it is spent and
    // the file is quarantined as 'detector-timeout'.
    let secrets = false;
    let thirdParty = false;
    let timedOut = false;
    try {
      const d = detect(e.relpath, text, { budgetMs: parse_ms });
      secrets = d.secrets.length > 0;
      thirdParty = d.thirdParty;
    } catch (err) {
      secrets = true;
      timedOut = err instanceof DetectorTimeoutError;
    }
    if (secrets) {
      records.push(minimal(claim(baseId ?? newId(e)), e, 'quarantined', timedOut ? 'detector-timeout' : undefined));
      flag(folderOf(e.relpath), 'secret');
      report.quarantined++;
      continue;
    }
    if (thirdParty) {
      records.push(minimal(claim(baseId ?? newId(e)), e, 'third-party-data'));
      const folder = folderOf(e.relpath);
      flag(folder, 'third-party-data');
      if (folder) zonesToAdd.push({ glob: `${folder}/**`, gate: 'third-party-data', source: 'detector' });
      report.thirdParty++;
      continue;
    }

    // ── Rename detection (inode, then hash) ──
    const hash = buf ? crypto.createHash('sha256').update(buf).digest('hex') : undefined;
    let id = baseId;
    let renamedFrom: string | undefined;
    if (!id) {
      const cand = goneByIno.get(e.ino) ?? (hash ? goneByHash.get(hash) : undefined);
      if (cand && !usedIds.has(cand.id)) {
        id = cand.id;
        renamedFrom = cand.relpath;
        goneByIno.delete(cand.ino as number);
        if (cand.hash) goneByHash.delete(cand.hash);
        report.renamed++;
      }
    }
    id = claim(id ?? newId(e));

    const rec: IndexRecord = {
      id, relpath: e.relpath, size: e.size, status: 'indexed', kind, ext: e.ext,
      mtimeMs: e.mtimeMs, ino: e.ino,
    };
    if (hash) rec.hash = hash;
    if (parsed && text != null) {
      let doc;
      try {
        doc = kind === 'markdown' ? parseMarkdown(text, e.relpath) : parseText(e.relpath);
      } catch {
        doc = null;
      }
      if (!doc || performance.now() - tStart > parse_ms) {
        records.push(minimal(id, e, 'skipped', doc ? 'parse-timeout' : 'unreadable'));
        report.skipped++;
        continue;
      }
      rec.title = doc.title;
      rec.headings = doc.headings;
      rec.links = doc.links;
      rec.tags = doc.tags;
      rec.aliases = doc.aliases;
      rec.relates = doc.relates;
    } else {
      rec.title = path.posix.basename(e.relpath);
    }
    if (renamedFrom) rec.renamedFrom = renamedFrom;
    records.push(rec);
  }

  for (const r of prev?.records ?? []) if (!newPaths.has(r.relpath)) report.removed++;
  report.removed -= report.renamed;
  report.files = records.length;

  // Zones first (tighten-only), then the index.
  report.zonesAdded = appendZones(rootHash, zonesToAdd, opts);

  const idx: BrainIndex = {
    version: 1,
    rootHash,
    root: cfg.root,
    scannedAt: new Date().toISOString(),
    truncated: walked.truncated,
    records,
    flagged: [...flaggedMap.values()].sort((a, b) => (a.folder < b.folder ? -1 : a.folder > b.folder ? 1 : 0)),
  };
  saveIndex(idx, opts);
  report.durationMs = Math.round(performance.now() - t0);
  L().info('Brain scan complete', {
    rootHash, files: report.files, changed: report.changed, added: report.added,
    quarantined: report.quarantined, durationMs: report.durationMs,
  });
  return report;
}
