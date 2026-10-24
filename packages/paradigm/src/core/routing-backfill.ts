/**
 * Routing backfill (#routing-backfill, Gnomon orchestration design §9 / §12 Phase 0)
 *
 * Cold start for route advice: mines git history for rework and revert rates per
 * area and writes COUNTS ONLY to `.paradigm/learned/routing.json`. No commit
 * subjects, authors or prompt text are persisted. Two commit shas are persisted
 * (`builtFrom.headSha` and `cutoffSha`, both the HEAD at build time).
 *
 * The table is a `history-only` RISK-ORDERING PRIOR, not arm outcomes: `commits`
 * and `reworkOrRevert` are git-history touch counts per area. A fix( commit is
 * not a "clean/unclean" observation of any routing arm, so a consumer must not
 * treat them as Beta successes/failures. `cutoffSha`/`cutoffDate` let later
 * route.settled rows exclude commits at or before the cutoff. `settledCommits`
 * shows right-censoring: only commits older than the 14-day settle lag have had
 * time to attract a fix or revert.
 *
 * - Area = directory of the nearest `.purpose` file that DEFINES a symbol named in a
 *   commit's `Symbols:` trailer. Unresolvable symbols go to a separate `(unowned)`
 *   bucket flagged `unowned: true`, never part of shrinkage.
 * - Rework = subject starts with `fix(`; revert = a line-start `This reverts commit`
 *   in the final trailer block. A revert with no own trailer inherits the symbols
 *   of the commit it reverts (looked up by sha).
 * - Trailers are honoured ONLY in the final paragraph of the commit message
 *   (never the subject paragraph), so quoted or mid-body text cannot inject them.
 *   Poisoning risk remains: any committer can write a trailer in a commit
 *   message, so counts are advisory and must never gate anything.
 * - The window is anchored to the HEAD commit date and all dates derive from
 *   commit data (never the wall clock), so a rebuild on the same history is
 *   byte-identical.
 *
 * Git is run via argv (no shell) with NUL record / \x01 field delimiters.
 * Mirrors calibration.ts (events -> learned/*.json); does NOT write the
 * cross-repo ~/.paradigm/learned/routing-prior.json.
 */

import * as fs from 'fs';
import * as path from 'path';
import { execFileSync } from 'child_process';
import yaml from 'js-yaml';

import { log } from '../../../paradigm-mcp/src/utils/mcp-logger.js';

export const ROUTING_FILE = '.paradigm/learned/routing.json';
export const ROUTING_WINDOW_DAYS = 90;
export const UNOWNED_AREA = '(unowned)';

export interface RoutingArea {
  /** Commits (unique within this area) whose trailer symbols resolve here. */
  commits: number;
  reworkOrRevert: number;
  byType: { fix: number; revert: number };
  /** ISO (UTC) date of the newest commit counted here. */
  lastCommitDate: string;
  /** Commits dated at least settleLagDays before HEAD (had time to attract a fix). */
  settledCommits: number;
  /** True only for the `(unowned)` bucket; exclude from shrinkage. */
  unowned?: true;
}

export interface RoutingCoverage {
  commitsTotal: number;
  commitsWithTrailer: number;
  commitsSkippedNoTrailer: number;
  /** Commits counted in at least one area (not inflated by multi-area commits). */
  commitsUnique: number;
  /** .purpose files skipped (not a regular file, over 1 MiB, or unparsable). */
  purposeFilesSkipped: number;
}

export interface RoutingTable {
  version: 1;
  kind: 'history-only';
  semantics: string;
  windowDays: number;
  settleLagDays: number;
  builtFrom: { headSha: string | null };
  cutoffSha: string | null;
  cutoffDate: string | null;
  coverage: RoutingCoverage;
  areas: Record<string, RoutingArea>;
}

export interface ParsedCommit {
  sha: string;
  date: string;
  subject: string;
  body: string;
  symbols: string[];
  reverts: string[];
}

export const SETTLE_LAG_DAYS = 14;
const MAX_PURPOSE_BYTES = 1024 * 1024;
const SEMANTICS =
  'History-only risk-ordering prior. commits/reworkOrRevert are git touch counts per area, NOT clean/unclean arm outcomes; do not use as Beta counts. Exclude commits at or before cutoffSha from route.settled learning.';

const SYMBOL_RE = /^[#$^!~][A-Za-z0-9._-]+$/;
const SECTION_PREFIX: Record<string, string> = {
  features: '#',
  components: '#',
  flows: '$',
  gates: '^',
  signals: '!',
  aspects: '~',
};
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.worktrees']);

function git(root: string, args: string[]): string {
  return execFileSync('git', ['-C', root, ...args], {
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'ignore'],
  });
}

/** Paragraphs of a normalised message (blank-line separated, trimmed). */
function paragraphs(message: string): string[] {
  return message
    .replace(/\r\n?/g, '\n')
    .trim()
    .split(/\n[ \t]*\n/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
}

const TRAILER_LINE_RE = /^[A-Za-z][A-Za-z0-9-]*:\s/;

/** Final paragraph, only when it is not the subject paragraph. */
function finalBlock(message: string): string {
  const ps = paragraphs(message);
  return ps.length >= 2 ? ps[ps.length - 1] : '';
}

/** Extract symbols from `Symbols:` lines of the FINAL trailer block only. */
export function parseSymbolsTrailer(message: string): string[] {
  const found = new Set<string>();
  for (const line of finalBlock(message).split('\n')) {
    const m = /^Symbols:\s*(.*)$/i.exec(line.trim());
    if (!m) continue;
    for (const tok of m[1].split(',')) {
      const t = tok.trim();
      if (SYMBOL_RE.test(t)) found.add(t);
    }
  }
  return [...found].sort();
}

/**
 * Shas from line-start `This reverts commit <sha>` in the final block, or in the
 * paragraph just before a final all-trailer block (git places the revert line there
 * when a trailer follows it).
 */
export function parseReverts(message: string): string[] {
  const ps = paragraphs(message);
  if (ps.length < 2) return [];
  const blocks = [ps[ps.length - 1]];
  const last = ps[ps.length - 1];
  if (ps.length >= 3 && last.split('\n').every((l) => TRAILER_LINE_RE.test(l))) {
    blocks.push(ps[ps.length - 2]);
  }
  const shas = new Set<string>();
  for (const block of blocks) {
    for (const m of block.matchAll(/^This reverts commit ([0-9a-f]{7,40})/gm)) shas.add(m[1]);
  }
  return [...shas].sort();
}

/** Parse `git log -z` output with fields sha \x01 isoDate \x01 body. */
export function parseLog(raw: string): ParsedCommit[] {
  const commits: ParsedCommit[] = [];
  for (const rec of raw.split('\0')) {
    const rec2 = rec.replace(/^\n+/, '');
    if (!rec2) continue;
    const i1 = rec2.indexOf('\x01');
    const i2 = i1 < 0 ? -1 : rec2.indexOf('\x01', i1 + 1);
    if (i2 < 0) continue;
    const sha = rec2.slice(0, i1).trim();
    const ms = Date.parse(rec2.slice(i1 + 1, i2).trim());
    if (!Number.isFinite(ms)) continue;
    const message = rec2.slice(i2 + 1).replace(/\r\n?/g, '\n');
    const nl = message.indexOf('\n');
    const subject = nl < 0 ? message : message.slice(0, nl);
    commits.push({
      sha,
      date: new Date(ms).toISOString(),
      subject,
      body: message,
      symbols: parseSymbolsTrailer(message),
      reverts: parseReverts(message),
    });
  }
  return commits;
}

function walkPurposeFiles(root: string, dir: string, acc: string[]): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (!SKIP_DIRS.has(e.name)) walkPurposeFiles(root, full, acc);
    } else if (e.name === '.purpose') {
      acc.push(full);
    }
  }
}

function sectionIds(section: unknown): string[] {
  if (Array.isArray(section)) {
    return section
      .map((x) => (typeof x === 'string' ? x : (x as { id?: unknown })?.id))
      .filter((x): x is string => typeof x === 'string');
  }
  if (section && typeof section === 'object') return Object.keys(section as object);
  return [];
}

/** Map symbol (with prefix) -> area id (POSIX dir of the owning .purpose). First sorted path wins. */
export function buildSymbolOwners(root: string): { owners: Map<string, string>; skipped: number } {
  const files: string[] = [];
  walkPurposeFiles(root, root, files);
  const owners = new Map<string, string>();
  let skipped = 0;
  for (const file of files) {
    let doc: unknown;
    try {
      const st = fs.lstatSync(file);
      if (!st.isFile() || st.size > MAX_PURPOSE_BYTES) {
        skipped++;
        continue;
      }
      doc = yaml.load(fs.readFileSync(file, 'utf8'));
    } catch {
      skipped++;
      continue;
    }
    if (!doc || typeof doc !== 'object') continue;
    const rel = path.relative(root, path.dirname(file)).split(path.sep).join('/');
    const area = rel === '' ? '.' : rel;
    for (const [section, prefix] of Object.entries(SECTION_PREFIX)) {
      for (const rawId of sectionIds((doc as Record<string, unknown>)[section])) {
        const id = rawId.replace(/^[#$^!~]/, '');
        const key = prefix + id;
        if (!owners.has(key)) owners.set(key, area);
      }
    }
  }
  return { owners, skipped };
}

/** Pure aggregation, exported for tests. `cutoffMs` anchors the settle-lag split. */
export function aggregateRouting(
  commits: ParsedCommit[],
  owners: Map<string, string>,
  lookupSymbols: (sha: string) => string[],
  cutoffMs: number,
): { areas: Record<string, RoutingArea>; commitsWithTrailer: number; commitsUnique: number } {
  const areas: Record<string, RoutingArea> = {};
  const lagMs = SETTLE_LAG_DAYS * 86400 * 1000;
  let commitsWithTrailer = 0;
  let commitsUnique = 0;

  for (const c of commits) {
    const revert = c.reverts.length > 0;
    const fix = !revert && c.subject.startsWith('fix(');
    if (c.symbols.length > 0) commitsWithTrailer++;
    let symbols = c.symbols;
    if (revert && symbols.length === 0) {
      const inherited = new Set<string>();
      for (const sha of c.reverts) {
        const orig = commits.find((o) => o.sha.startsWith(sha));
        for (const s of orig ? orig.symbols : lookupSymbols(sha)) inherited.add(s);
      }
      symbols = [...inherited].sort();
    }
    if (symbols.length === 0) continue;
    const touched = new Set<string>();
    for (const s of symbols) touched.add(owners.get(s) ?? UNOWNED_AREA);
    commitsUnique++;
    const old = Date.parse(c.date) <= cutoffMs - lagMs;
    for (const area of touched) {
      const a = (areas[area] ??= {
        commits: 0,
        reworkOrRevert: 0,
        byType: { fix: 0, revert: 0 },
        lastCommitDate: c.date,
        settledCommits: 0,
        ...(area === UNOWNED_AREA ? { unowned: true as const } : {}),
      });
      a.commits++;
      if (c.date > a.lastCommitDate) a.lastCommitDate = c.date;
      if (old) a.settledCommits++;
      if (revert) {
        a.byType.revert++;
        a.reworkOrRevert++;
      } else if (fix) {
        a.byType.fix++;
        a.reworkOrRevert++;
      }
    }
  }
  const sorted: Record<string, RoutingArea> = {};
  for (const k of Object.keys(areas).sort()) sorted[k] = areas[k];
  return { areas: sorted, commitsWithTrailer, commitsUnique };
}

/** Build the routing table from git history under `root`. Never throws on a non-repo / empty repo. */
export function buildRoutingTable(root: string): RoutingTable {
  let headSha: string | null = null;
  let cutoffDate: string | null = null;
  let areas: Record<string, RoutingArea> = {};
  const coverage: RoutingCoverage = {
    commitsTotal: 0,
    commitsWithTrailer: 0,
    commitsSkippedNoTrailer: 0,
    commitsUnique: 0,
    purposeFilesSkipped: 0,
  };
  try {
    headSha = git(root, ['rev-parse', 'HEAD']).trim() || null;
  } catch {
    headSha = null;
  }
  if (headSha) {
    try {
      const headMs = Date.parse(git(root, ['log', '-1', '--format=%cI', 'HEAD']).trim());
      cutoffDate = new Date(headMs).toISOString();
      const since = Math.floor(headMs / 1000) - ROUTING_WINDOW_DAYS * 86400;
      const raw = git(root, ['log', '--no-merges', '-z', `--since=${since}`, '--format=%H%x01%cI%x01%B', 'HEAD']);
      const commits = parseLog(raw);
      const lookup = (sha: string): string[] => {
        try {
          return parseSymbolsTrailer(git(root, ['show', '-s', '--format=%B', sha]));
        } catch {
          return [];
        }
      };
      const { owners, skipped } = buildSymbolOwners(root);
      const agg = aggregateRouting(commits, owners, lookup, headMs);
      areas = agg.areas;
      coverage.commitsTotal = commits.length;
      coverage.commitsWithTrailer = agg.commitsWithTrailer;
      coverage.commitsSkippedNoTrailer = commits.length - agg.commitsWithTrailer;
      coverage.commitsUnique = agg.commitsUnique;
      coverage.purposeFilesSkipped = skipped;
    } catch (err) {
      log.component('#routing-backfill').warn('git history read failed (non-fatal)', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return {
    version: 1,
    kind: 'history-only',
    semantics: SEMANTICS,
    windowDays: ROUTING_WINDOW_DAYS,
    settleLagDays: SETTLE_LAG_DAYS,
    builtFrom: { headSha },
    cutoffSha: headSha,
    cutoffDate,
    coverage,
    areas,
  };
}

/** Build and write `.paradigm/learned/routing.json`. Returns the table and absolute path. */
export function writeRoutingBackfill(root: string): { table: RoutingTable; file: string } {
  const table = buildRoutingTable(root);
  const file = path.join(root, ...ROUTING_FILE.split('/'));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(table, null, 2) + '\n', 'utf8');
  log.component('#routing-backfill').info('routing backfill written', {
    areas: Object.keys(table.areas).length,
  });
  return { table, file };
}
