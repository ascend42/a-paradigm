/**
 * paradigm memory — the Memory Steward CLI (Memory Steward A2, TD-2026-09-19-110).
 *
 * A curation surface over Claude Code's NATIVE memory store
 * (~/.claude/projects/<slug>/memory/). It NEVER auto-deletes: `review` surfaces
 * stale / misrouted / duplicate entries as an advisory digest (and refreshes
 * advisory remediations for the Stop hook), and the apply-by-id subcommands
 * (prune / route / merge / pin) act only on entries the scan returned.
 *
 * Layering:
 *   - A0 (premise-core #native-memory-scan): scanNativeMemory + path resolution.
 *   - A1 (core/memory): scoreEntry / clusterEntries / deriveFinding — pure.
 *   - A2 (this file): I/O + CLI. Reuses existing typed homes as routing targets:
 *       lore  → core/lore/storage.recordLore
 *       task  → paradigm-mcp task-loader.createTask (relative-import precedent,
 *               same edge the `paradigm task` CLI already builds against)
 *       habits→ a DISABLED `.habit` stub in .paradigm/habits/ for human curation
 *       decisions → a STUB decision YAML in .paradigm/decisions/ (NOT a
 *               cross-package lift onto paradigm-mcp's decision-loader; the user
 *               completes it — see TD-2026-09-19-110 A2 handoff).
 *
 * FAIL-OPEN DISCIPLINE: every native-memory write is guarded (target must be
 * inside the resolved memory dir) and wrapped so a surprise never crashes the
 * CLI. Output goes through cli-output.ts helpers per CLAUDE.md (never raw
 * console.log).
 */

import { createHash } from 'crypto';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as yaml from 'js-yaml';

import {
  scanNativeMemory,
  resolveMemoryDir,
  type ParsedMemoryEntry,
  type GraphValidityVerdict,
} from '@a-company/premise-core';

import { scoreEntry, deriveFinding } from '../../core/memory/score.js';
import { clusterEntries } from '../../core/memory/cluster.js';
import type { MemoryFinding, MemorySuggestion } from '../../core/memory/types.js';

import { out, success, warn, error, dim, header, kv, json } from '../../utils/cli-output.js';

import { recordLore } from '../../core/lore/storage.js';
import type { LoreEntry } from '../../core/lore/types.js';
import { createTask, type Claimant } from '../../../../paradigm-mcp/src/utils/task-loader.js';

// ── shared surface ──────────────────────────────────────────

interface CommonOptions {
  project?: string;
  json?: boolean;
}

const ROUTE_TARGETS = ['habits', 'decisions', 'task', 'lore'] as const;
export type RouteTarget = (typeof ROUTE_TARGETS)[number];

const REMEDIATIONS_DIR = path.join('.paradigm', 'remediations');
const ARCHIVED_DIRNAME = '.archived';
const REVIEW_STAMP_FILE = path.join('.paradigm', '.memory-last-review');
const PINS_FILE = path.join('.paradigm', 'memory-pins.json');
const MEMORY_CLAIMANT = 'memory';
const REM_ID_PREFIX = 'rmd-mem-';

function resolveRoot(options: CommonOptions): string {
  return options.project ? path.resolve(options.project) : process.cwd();
}

/** Deterministic id for a memory entry, stable across re-runs (NOT a timestamp). */
export function stableId(file: string): string {
  const hash = createHash('sha1').update(path.resolve(file)).digest('hex').slice(0, 8);
  return `mem-${hash}`;
}

/** The remediation id that mirrors a memory entry's stable id (one per entry). */
function remediationId(entryFile: string): string {
  return REM_ID_PREFIX + createHash('sha1').update(path.resolve(entryFile)).digest('hex').slice(0, 8);
}

/**
 * Path-safety gate: is `file` really inside the resolved memory dir? Every
 * write/delete on a native-memory file MUST pass this first.
 */
export function isInsideMemoryDir(file: string, memoryDir: string): boolean {
  const rel = path.relative(path.resolve(memoryDir), path.resolve(file));
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

// ── digest ──────────────────────────────────────────────────

export interface DigestItem {
  id: string;
  entryFile: string;
  name: string;
  suggestion: MemorySuggestion;
  /** 0..1 staleness. */
  score: number;
  verdict: GraphValidityVerdict;
  rationale: string;
  clusterId?: string;
  expiresAt: string;
  target: { file: string; symbol?: string };
  applyCommand: string;
}

export interface Digest {
  root: string;
  scanned: number;
  pinned: number;
  items: DigestItem[];
}

interface BuildOptions {
  now?: number;
}

/**
 * Scan → score → cluster → derive. Pinned entries and the MEMORY.md index are
 * never surfaced as findings. Deterministic order (by id) so re-runs are stable.
 */
export async function buildDigest(rootDir: string, opts: BuildOptions = {}): Promise<Digest> {
  const now = opts.now ?? Date.now();
  let entries: ParsedMemoryEntry[] = [];
  try {
    entries = await scanNativeMemory(rootDir);
  } catch {
    entries = [];
  }

  const clusters = clusterEntries(entries);
  const pins = loadPins(rootDir);

  // clusterId → the stable ids of its members (for the `merge` apply command).
  const clusterMembers = new Map<string, string[]>();
  for (const e of entries) {
    const cid = clusters.get(e.file);
    if (!cid) continue;
    const list = clusterMembers.get(cid) ?? [];
    list.push(stableId(e.file));
    clusterMembers.set(cid, list);
  }

  const items: DigestItem[] = [];
  for (const entry of entries) {
    if (entry.kind === 'index') continue; // never prune/route the generated index
    if (pins.has(path.resolve(entry.file))) continue; // pinned → down-ranked out

    const score = scoreEntry(entry, { now });
    const clusterId = clusters.get(entry.file);
    if (clusterId) score.clusterId = clusterId;

    const finding = deriveFinding(score, { now });
    if (!finding) continue;

    const id = stableId(entry.file);
    items.push({
      id,
      entryFile: entry.file,
      name: entry.name || path.basename(entry.file),
      suggestion: finding.suggestion,
      score: round2(score.score),
      verdict: entry.graphValidity.verdict,
      rationale: finding.rationale,
      clusterId,
      expiresAt: finding.expiresAt,
      target: finding.target,
      applyCommand: applyCommandFor(id, finding, clusterId, clusterMembers),
    });
  }

  items.sort((a, b) => a.id.localeCompare(b.id));

  return { root: rootDir, scanned: entries.length, pinned: pins.size, items };
}

function applyCommandFor(
  id: string,
  finding: MemoryFinding,
  clusterId: string | undefined,
  clusterMembers: Map<string, string[]>,
): string {
  switch (finding.suggestion) {
    case 'prune':
      return `paradigm memory prune ${id}`;
    case 'route:habits':
      return `paradigm memory route ${id} --to habits`;
    case 'route:decisions':
      return `paradigm memory route ${id} --to decisions`;
    case 'route:task':
      return `paradigm memory route ${id} --to task`;
    case 'route:lore':
      return `paradigm memory route ${id} --to lore`;
    case 'pin':
      return `paradigm memory pin ${id}`;
    case 'merge': {
      const others = (clusterId ? clusterMembers.get(clusterId) ?? [] : []).filter((x) => x !== id);
      return `paradigm memory merge ${id}${others.length ? ' ' + others.join(' ') : ''}`;
    }
    default:
      return `paradigm memory review`;
  }
}

// ── review command ──────────────────────────────────────────

const SUGGESTION_HEADINGS: Record<MemorySuggestion, string> = {
  prune: 'Prune (provably stale — nothing it references still exists)',
  merge: 'Merge (near-duplicate)',
  'route:habits': 'Route → habits (feedback/tips)',
  'route:task': 'Route → tasks (project/status)',
  'route:decisions': 'Route → decisions (durable "why")',
  'route:lore': 'Route → lore',
  pin: 'Pin (high-value durable knowledge)',
};

interface ReviewOptions extends CommonOptions {
  interactive?: boolean;
}

export async function reviewCommand(options: ReviewOptions = {}): Promise<void> {
  const root = resolveRoot(options);

  let digest: Digest;
  try {
    digest = await buildDigest(root);
  } catch (err) {
    error(`memory review failed: ${(err as Error).message}`);
    return;
  }

  // Refresh advisory remediations + the review stamp regardless of output mode.
  const remResult = await emitRemediations(root, digest);
  writeReviewStamp(root);

  if (options.json) {
    json({
      root,
      scanned: digest.scanned,
      pinned: digest.pinned,
      findings: digest.items,
      remediations: remResult,
    });
    return;
  }

  header('Memory Steward — review');
  kv('memory entries scanned', String(digest.scanned));
  kv('pinned (down-ranked)', String(digest.pinned));
  kv('findings', String(digest.items.length));

  if (digest.items.length === 0) {
    out('');
    success('No memory hygiene findings. Nothing to do.');
    return;
  }

  const groups = new Map<MemorySuggestion, DigestItem[]>();
  for (const item of digest.items) {
    const list = groups.get(item.suggestion) ?? [];
    list.push(item);
    groups.set(item.suggestion, list);
  }

  for (const suggestion of Object.keys(SUGGESTION_HEADINGS) as MemorySuggestion[]) {
    const list = groups.get(suggestion);
    if (!list || list.length === 0) continue;
    header(SUGGESTION_HEADINGS[suggestion]);
    for (const item of list) {
      out(`  ${item.id}  [staleness ${item.score.toFixed(2)} · ${item.verdict}]  ${item.name}`);
      dim(`    ${item.rationale}`);
      dim(`    → ${item.applyCommand}`);
    }
  }

  out('');
  dim(
    `${remResult.written} advisory remediation(s) refreshed, ${remResult.cleared} cleared. ` +
      `Review stamp updated.`,
  );

  if (options.interactive) {
    await runInteractive(root, digest);
  }
}

// ── remediation emission (idempotent) ───────────────────────

interface RemediationRecord {
  id: string;
  claimant: string;
  severity: 'advise';
  reason: string;
  unblock_hint: string;
  created: string;
  expires_at?: string;
  target?: { file?: string; symbol?: string };
}

export interface EmitResult {
  written: number;
  cleared: number;
}

/**
 * Write/refresh one advisory remediation per finding, and archive memory-owned
 * remediations whose finding has resolved. IDEMPOTENT: the id is derived from
 * the entry path, so a re-run overwrites (never duplicates) and preserves the
 * original `created` stamp — capping ONE active remediation per memory entry.
 */
export async function emitRemediations(rootDir: string, digest: Digest): Promise<EmitResult> {
  const dir = path.join(rootDir, REMEDIATIONS_DIR);
  let written = 0;
  let cleared = 0;

  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch {
    return { written, cleared };
  }

  const desiredIds = new Set<string>();

  for (const item of digest.items) {
    const id = remediationId(item.entryFile);
    desiredIds.add(id);
    const filePath = path.join(dir, `${id}.yaml`);

    // Preserve the original created stamp on refresh (stable content, no churn).
    let created = new Date().toISOString();
    try {
      if (fs.existsSync(filePath)) {
        const prev = yaml.load(fs.readFileSync(filePath, 'utf8')) as RemediationRecord | null;
        if (prev && typeof prev.created === 'string') created = prev.created;
      }
    } catch {
      // fall through with a fresh created stamp
    }

    const record: RemediationRecord = {
      id,
      claimant: MEMORY_CLAIMANT,
      severity: 'advise',
      reason: `Native memory: ${item.name} — ${item.rationale}`,
      unblock_hint: `Curate with: ${item.applyCommand} (or ignore; this advisory self-clears after ~14 days).`,
      created,
      expires_at: item.expiresAt,
      // Persist only the basename, never the absolute ~/.claude path: these YAML
      // files are commit-eligible and must not leak the user's home path/slug
      // across the repo boundary. Apply resolves entries by hashed id, not this.
      target: item.target.symbol
        ? { file: path.basename(item.target.file), symbol: item.target.symbol }
        : { file: path.basename(item.target.file) },
    };

    try {
      fs.writeFileSync(filePath, yaml.dump(record, { lineWidth: 100, sortKeys: false }), 'utf8');
      written++;
    } catch {
      // fail-open: skip this one
    }
  }

  // Archive memory-owned remediations that are no longer backed by a finding.
  try {
    for (const name of fs.readdirSync(dir)) {
      if (!name.startsWith(REM_ID_PREFIX)) continue;
      if (!name.endsWith('.yaml')) continue;
      const id = name.replace(/\.yaml$/, '');
      if (desiredIds.has(id)) continue;
      if (archiveRemediationFile(dir, name)) cleared++;
    }
  } catch {
    // fail-open
  }

  return { written, cleared };
}

function archiveRemediationFile(remediationsDir: string, filename: string): boolean {
  try {
    const src = path.join(remediationsDir, filename);
    if (!fs.existsSync(src)) return false;
    const archiveDir = path.join(remediationsDir, ARCHIVED_DIRNAME);
    fs.mkdirSync(archiveDir, { recursive: true });
    fs.renameSync(src, path.join(archiveDir, filename));
    return true;
  } catch {
    return false;
  }
}

function clearRemediationForEntry(rootDir: string, entryFile: string): void {
  const dir = path.join(rootDir, REMEDIATIONS_DIR);
  const filename = `${remediationId(entryFile)}.yaml`;
  archiveRemediationFile(dir, filename);
}

// ── review stamp + pins state ───────────────────────────────

export function writeReviewStamp(rootDir: string): void {
  try {
    const file = path.join(rootDir, REVIEW_STAMP_FILE);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, new Date().toISOString() + '\n', 'utf8');
  } catch {
    // fail-open
  }
}

interface PinsState {
  pins: string[];
}

/** Load the set of pinned (durable) memory entry file paths (resolved absolute). */
export function loadPins(rootDir: string): Set<string> {
  try {
    const file = path.join(rootDir, PINS_FILE);
    if (!fs.existsSync(file)) return new Set();
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as PinsState;
    const list = Array.isArray(parsed?.pins) ? parsed.pins : [];
    return new Set(list.map((p) => path.resolve(p)));
  } catch {
    return new Set();
  }
}

function savePins(rootDir: string, pins: Set<string>): void {
  const file = path.join(rootDir, PINS_FILE);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const state: PinsState = { pins: Array.from(pins).sort() };
  fs.writeFileSync(file, JSON.stringify(state, null, 2) + '\n', 'utf8');
}

// ── entry archival (path-safe) ──────────────────────────────

/**
 * Move a native-memory entry into the `.archived` sibling inside the memory dir.
 * Returns false (touching NOTHING) if the file is not inside the memory dir.
 */
export function archiveEntryFile(file: string, memoryDir: string): boolean {
  if (!isInsideMemoryDir(file, memoryDir)) return false;
  try {
    if (!fs.existsSync(file)) return false;
    const archiveDir = path.join(memoryDir, ARCHIVED_DIRNAME);
    fs.mkdirSync(archiveDir, { recursive: true });
    let dest = path.join(archiveDir, path.basename(file));
    if (fs.existsSync(dest)) {
      dest = path.join(archiveDir, `${path.basename(file)}.${Date.now().toString(36)}`);
    }
    fs.renameSync(file, dest);
    return true;
  } catch {
    return false;
  }
}

// ── id resolution ───────────────────────────────────────────

async function resolveEntry(rootDir: string, id: string): Promise<ParsedMemoryEntry | null> {
  let entries: ParsedMemoryEntry[] = [];
  try {
    entries = await scanNativeMemory(rootDir);
  } catch {
    return null;
  }
  return entries.find((e) => stableId(e.file) === id) ?? null;
}

// ── apply: prune ────────────────────────────────────────────

/**
 * Return-shaped applier result contracts. These are the callable-from-anywhere
 * cores (CLI wrapper + Platform write router both call them). An applier does NO
 * console output and NEVER sets process.exitCode — it holds ALL path-safety
 * (isInsideMemoryDir), archive-not-delete, and fail-open behavior inside, and
 * reports success/failure purely through its return value.
 */
export interface ApplyPruneResult {
  ok: boolean;
  archived?: string;
  file?: string;
  error?: string;
}

export interface ApplyRouteResult {
  ok: boolean;
  destination?: string;
  archivedSource?: boolean;
  /** The source memory file that was routed (for the CLI's success/JSON echo). */
  file?: string;
  error?: string;
}

export interface ApplyMergeResult {
  ok: boolean;
  primary?: string;
  /** Absolute path of the primary (for the CLI's success message). */
  primaryFile?: string;
  merged?: string[];
  archived?: string[];
  error?: string;
}

export interface ApplyPinResult {
  ok: boolean;
  pinned?: string;
  /** The pinned memory file (for the CLI's JSON echo). */
  file?: string;
  error?: string;
}

/**
 * Prune (archive-not-delete) a native-memory entry by id. Path-safe: refuses any
 * file outside the resolved memory dir. Pure return shape — no output, no exit
 * code.
 */
export async function applyPrune(root: string, id: string): Promise<ApplyPruneResult> {
  const memoryDir = resolveMemoryDir(root);
  const entry = await resolveEntry(root, id);
  if (!entry) {
    return { ok: false, error: `No memory entry matches id "${id}". Run \`paradigm memory review\` for current ids.` };
  }
  if (!isInsideMemoryDir(entry.file, memoryDir)) {
    return { ok: false, error: `Refusing to prune: ${entry.file} is outside the resolved memory dir.` };
  }
  const ok = archiveEntryFile(entry.file, memoryDir);
  if (!ok) {
    return { ok: false, error: `Could not archive ${entry.file} (already gone or unwritable).` };
  }
  clearRemediationForEntry(root, entry.file);
  return { ok: true, archived: path.basename(entry.file), file: entry.file };
}

export async function pruneCommand(id: string, options: CommonOptions = {}): Promise<void> {
  const root = resolveRoot(options);
  const result = await applyPrune(root, id);
  if (!result.ok) {
    error(result.error!);
    process.exitCode = 1;
    return;
  }
  if (options.json) {
    json({ id, action: 'prune', archived: true, file: result.file });
    return;
  }
  success(`Pruned (archived) ${path.basename(result.file!)} → ${ARCHIVED_DIRNAME}/`);
}

// ── apply: route ────────────────────────────────────────────

interface RouteOptions extends CommonOptions {
  to?: string;
}

/**
 * Route a native-memory entry into a typed home (lore/task/habits/decisions),
 * then archive the source. Validates the target, enforces path-safety, and
 * catches any writer throw — all reported through the return shape. No output,
 * no exit code.
 */
export async function applyRoute(root: string, id: string, to: RouteTarget): Promise<ApplyRouteResult> {
  const memoryDir = resolveMemoryDir(root);
  const target = (String(to || '')).toLowerCase() as RouteTarget;

  if (!ROUTE_TARGETS.includes(target)) {
    return { ok: false, error: `--to must be one of: ${ROUTE_TARGETS.join(', ')}` };
  }

  const entry = await resolveEntry(root, id);
  if (!entry) {
    return { ok: false, error: `No memory entry matches id "${id}". Run \`paradigm memory review\` for current ids.` };
  }
  if (!isInsideMemoryDir(entry.file, memoryDir)) {
    return { ok: false, error: `Refusing to route: ${entry.file} is outside the resolved memory dir.` };
  }

  let destination: string;
  try {
    switch (target) {
      case 'lore':
        destination = await routeToLore(root, entry);
        break;
      case 'task':
        destination = await routeToTask(root, entry);
        break;
      case 'habits':
        destination = routeToHabits(root, entry);
        break;
      case 'decisions':
        destination = routeToDecisionStub(root, entry);
        break;
      default:
        return { ok: false, error: `Unsupported route target: ${target}` };
    }
  } catch (err) {
    return { ok: false, error: `Route to ${target} failed: ${(err as Error).message}` };
  }

  const archived = archiveEntryFile(entry.file, memoryDir);
  clearRemediationForEntry(root, entry.file);

  return { ok: true, destination, archivedSource: archived, file: entry.file };
}

export async function routeCommand(id: string, options: RouteOptions = {}): Promise<void> {
  const root = resolveRoot(options);
  const to = (options.to || '').toLowerCase() as RouteTarget;
  const result = await applyRoute(root, id, to);
  if (!result.ok) {
    error(result.error!);
    process.exitCode = 1;
    return;
  }

  if (options.json) {
    json({ id, action: `route:${to}`, destination: result.destination, archivedSource: result.archivedSource, file: result.file });
    return;
  }
  success(`Routed ${path.basename(result.file!)} → ${to}: ${result.destination}`);
  if (to === 'decisions') {
    warn('Decision written as a STUB (status: proposed). Complete the decision/rationale fields before use.');
  }
  if (to === 'habits') {
    dim('Imported as a DISABLED .habit stub — enable it after a human review.');
  }
  if (result.archivedSource) dim(`Source archived → ${ARCHIVED_DIRNAME}/`);
}

function firstLine(body: string, max = 120): string {
  const line = (body || '').split('\n').map((l) => l.trim()).find((l) => l.length > 0) ?? '';
  return line.length > max ? line.slice(0, max - 1) + '…' : line;
}

async function routeToLore(rootDir: string, entry: ParsedMemoryEntry): Promise<string> {
  const loreEntry: LoreEntry = {
    id: '',
    type: 'human-note',
    timestamp: new Date().toISOString(),
    author: '',
    title: entry.name || path.basename(entry.file),
    summary: entry.description || firstLine(entry.body) || 'Imported from native memory.',
    symbols_touched: entry.symbolMentions,
    body: entry.body,
    tags: ['from-native-memory'],
  };
  await recordLore(rootDir, loreEntry);
  return loreEntry.id || '(lore entry recorded)';
}

function currentHumanRef(): string {
  try {
    const email = execSync('git config user.email', { encoding: 'utf-8', timeout: 3000 }).trim();
    if (email) return email;
  } catch {
    // git not configured
  }
  try {
    return os.userInfo().username || 'unknown';
  } catch {
    return 'unknown';
  }
}

async function routeToTask(rootDir: string, entry: ParsedMemoryEntry): Promise<string> {
  const title = entry.name || firstLine(entry.body) || path.basename(entry.file);
  const detail = entry.description || firstLine(entry.body);
  const blurb = detail && detail !== title ? `${title}: ${detail}` : title;
  const claimant: Claimant = { kind: 'human', ref: currentHumanRef() };
  const id = await createTask(rootDir, {
    blurb,
    priority: 'medium',
    tags: ['from-native-memory'],
    claimant,
  });
  return id;
}

/**
 * Route feedback memory into the habits system as a DISABLED `.habit` file for
 * human curation. Disabled so it never fires a check until a human converts the
 * freeform note into a real habit definition.
 */
function routeToHabits(rootDir: string, entry: ParsedMemoryEntry): string {
  const dir = path.join(rootDir, '.paradigm', 'habits');
  fs.mkdirSync(dir, { recursive: true });
  const slug = stableId(entry.file);
  const habit = {
    id: slug,
    name: entry.name || `Imported memory: ${path.basename(entry.file)}`,
    description: [entry.description, entry.body].filter(Boolean).join('\n\n').trim() ||
      'Imported from native memory.',
    category: 'documentation',
    trigger: 'postflight',
    severity: 'advisory',
    check: { type: 'context-checked', params: {} },
    enabled: false,
  };
  const file = path.join(dir, `${slug}.habit`);
  fs.writeFileSync(file, yaml.dump(habit, { lineWidth: 100, sortKeys: false }), 'utf8');
  return path.relative(rootDir, file);
}

/**
 * Write a STUB decision YAML the user completes. We do NOT lift paradigm-mcp's
 * decision-loader into the CLI build graph (TD-2026-09-19-110 A2 handoff): the
 * cross-package coupling isn't warranted for a scaffold.
 */
export function routeToDecisionStub(rootDir: string, entry: ParsedMemoryEntry): string {
  const dir = path.join(rootDir, '.paradigm', 'decisions');
  fs.mkdirSync(dir, { recursive: true });
  const date = new Date().toISOString().slice(0, 10);
  // Collision-safe id: never overwrite an existing decision. Take max+1 over
  // today's TD-<date>-NNN files, then guard with an existence check. (A random
  // counter risked clobbering a real ratified decision — same-day id collision.)
  const prefix = `TD-${date}-`;
  let maxN = 0;
  try {
    for (const f of fs.readdirSync(dir)) {
      const m = f.match(/^TD-\d{4}-\d{2}-\d{2}-(\d+)\.yaml$/);
      if (m && f.startsWith(prefix)) maxN = Math.max(maxN, Number(m[1]));
    }
  } catch {
    /* fail-open: empty dir → maxN stays 0 */
  }
  let n = maxN + 1;
  let id = `${prefix}${String(n).padStart(3, '0')}`;
  while (fs.existsSync(path.join(dir, `${id}.yaml`))) {
    n += 1;
    id = `${prefix}${String(n).padStart(3, '0')}`;
  }
  const stub = {
    id,
    timestamp: new Date().toISOString(),
    title: entry.name || `Decision from native memory (${path.basename(entry.file)})`,
    decision: `TODO (complete): imported from native memory.\n\n${entry.body}`.trim(),
    rationale: 'TODO (complete): why was this decided?',
    status: 'proposed',
    tags: ['from-native-memory', 'stub'],
  };
  const file = path.join(dir, `${id}.yaml`);
  fs.writeFileSync(file, yaml.dump(stub, { lineWidth: 100, sortKeys: false }), 'utf8');
  return path.relative(rootDir, file);
}

// ── apply: merge ────────────────────────────────────────────

/**
 * Merge same-cluster near-duplicates: append each dup's body into the primary,
 * then archive the dups. Guards that ≥2 ids resolve, all share ONE cluster, and
 * every file is inside the memory dir. Pure return shape — `archived` is the list
 * of dup ids actually archived. No output, no exit code.
 */
export async function applyMerge(root: string, ids: string[]): Promise<ApplyMergeResult> {
  const memoryDir = resolveMemoryDir(root);

  if (!ids || ids.length < 2) {
    return { ok: false, error: 'merge needs at least two ids (a primary and one or more duplicates).' };
  }

  let entries: ParsedMemoryEntry[] = [];
  try {
    entries = await scanNativeMemory(root);
  } catch {
    entries = [];
  }
  const byId = new Map(entries.map((e) => [stableId(e.file), e] as const));
  const clusters = clusterEntries(entries);

  const resolved: ParsedMemoryEntry[] = [];
  for (const id of ids) {
    const e = byId.get(id);
    if (!e) {
      return { ok: false, error: `No memory entry matches id "${id}".` };
    }
    resolved.push(e);
  }

  // Guard: all must share ONE cluster (they must actually be near-duplicates).
  const clusterIds = new Set(resolved.map((e) => clusters.get(e.file)));
  if (clusterIds.size !== 1 || clusterIds.has(undefined)) {
    return { ok: false, error: 'Refusing to merge: the given ids are not all in the same near-duplicate cluster.' };
  }

  for (const e of resolved) {
    if (!isInsideMemoryDir(e.file, memoryDir)) {
      return { ok: false, error: `Refusing to merge: ${e.file} is outside the resolved memory dir.` };
    }
  }

  const [primary, ...dups] = resolved;

  // Append each dup's body into the primary, then archive the dups.
  try {
    const merged =
      fs.readFileSync(primary.file, 'utf8').replace(/\s*$/, '') +
      dups
        .map(
          (d) =>
            `\n\n<!-- merged from ${path.basename(d.file)} (${stableId(d.file)}) -->\n${d.body.trim()}`,
        )
        .join('') +
      '\n';
    fs.writeFileSync(primary.file, merged, 'utf8');
  } catch (err) {
    return { ok: false, error: `Merge failed while writing primary: ${(err as Error).message}` };
  }

  const archivedIds: string[] = [];
  for (const d of dups) {
    if (archiveEntryFile(d.file, memoryDir)) archivedIds.push(stableId(d.file));
    clearRemediationForEntry(root, d.file);
  }
  // The primary's finding (if any) is now resolved too.
  clearRemediationForEntry(root, primary.file);

  return {
    ok: true,
    primary: stableId(primary.file),
    primaryFile: primary.file,
    merged: dups.map((d) => stableId(d.file)),
    archived: archivedIds,
  };
}

export async function mergeCommand(ids: string[], options: CommonOptions = {}): Promise<void> {
  const root = resolveRoot(options);
  const result = await applyMerge(root, ids);
  if (!result.ok) {
    error(result.error!);
    process.exitCode = 1;
    return;
  }

  if (options.json) {
    json({
      action: 'merge',
      primary: result.primary,
      merged: result.merged,
      archived: result.archived!.length,
    });
    return;
  }
  success(`Merged ${result.merged!.length} duplicate(s) into ${path.basename(result.primaryFile!)} (${result.archived!.length} archived).`);
}

// ── apply: pin ──────────────────────────────────────────────

/**
 * Pin an entry so future reviews down-rank it. Persists the pin set; any write
 * failure is reported through the return shape. No output, no exit code.
 */
export async function applyPin(root: string, id: string): Promise<ApplyPinResult> {
  const entry = await resolveEntry(root, id);
  if (!entry) {
    return { ok: false, error: `No memory entry matches id "${id}". Run \`paradigm memory review\` for current ids.` };
  }
  const pins = loadPins(root);
  pins.add(path.resolve(entry.file));
  try {
    savePins(root, pins);
  } catch (err) {
    return { ok: false, error: `Could not save pin: ${(err as Error).message}` };
  }
  clearRemediationForEntry(root, entry.file);
  return { ok: true, pinned: path.basename(entry.file), file: entry.file };
}

export async function pinCommand(id: string, options: CommonOptions = {}): Promise<void> {
  const root = resolveRoot(options);
  const result = await applyPin(root, id);
  if (!result.ok) {
    error(result.error!);
    process.exitCode = 1;
    return;
  }
  if (options.json) {
    json({ id, action: 'pin', pinned: true, file: result.file });
    return;
  }
  success(`Pinned ${path.basename(result.file!)} — future reviews will down-rank it.`);
}

// ── interactive wrapper (optional) ──────────────────────────

async function runInteractive(rootDir: string, digest: Digest): Promise<void> {
  const promptsMod = await import('prompts');
  const prompts = promptsMod.default;

  for (const item of digest.items) {
    const { apply } = await prompts({
      type: 'confirm',
      name: 'apply',
      message: `${item.name} — ${item.suggestion}? (${item.applyCommand})`,
      initial: false,
    });
    if (!apply) continue;

    switch (item.suggestion) {
      case 'prune':
        await pruneCommand(item.id, { project: rootDir });
        break;
      case 'route:habits':
        await routeCommand(item.id, { project: rootDir, to: 'habits' });
        break;
      case 'route:decisions':
        await routeCommand(item.id, { project: rootDir, to: 'decisions' });
        break;
      case 'route:task':
        await routeCommand(item.id, { project: rootDir, to: 'task' });
        break;
      case 'route:lore':
        await routeCommand(item.id, { project: rootDir, to: 'lore' });
        break;
      case 'pin':
        await pinCommand(item.id, { project: rootDir });
        break;
      case 'merge':
        dim(`Skipping ${item.id}: run \`${item.applyCommand}\` manually to merge.`);
        break;
    }
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// ── sync command (Memory Steward B2) ────────────────────────

interface SyncCliOptions extends CommonOptions {
  write?: boolean;
  /**
   * Opt IN to the curated projection block. OFF by default (default sync only
   * leans — dedup + demote — and never net-adds a projection).
   *
   * NOTE: named `--projection`, NOT `--project`, because `-p, --project <path>`
   * is the established project-root option across every `paradigm memory`
   * subcommand. See the report in the handoff for this collision.
   */
  projection?: boolean;
}

/**
 * `paradigm memory sync` — keep the whole native MEMORY.md lean WITHOUT losing
 * hand-written content. ADVISORY by default: it prints a human report (size, the
 * demotable leaf entries with their prune/route hints, dedup candidates, the
 * unified diff, and — only with `--projection` — a projection preview) and writes
 * NOTHING. `--write` backs up MEMORY.md first, then writes atomically; any error
 * leaves the original intact. Projection is OFF unless `--projection` is passed.
 */
export async function syncCommand(options: SyncCliOptions = {}): Promise<void> {
  const root = resolveRoot(options);
  const wantProjection = options.projection === true;

  let result: import('../../core/memory/sync.js').SyncResult;
  try {
    const { computeSync } = await import('../../core/memory/sync.js');
    result = await computeSync(root, { project: wantProjection });
  } catch (err) {
    error(`memory sync failed: ${(err as Error).message}`);
    process.exitCode = 1;
    return;
  }

  if (options.json) {
    json({
      root,
      memoryFile: result.memoryFile,
      existed: result.existed,
      changed: result.changed,
      bytesBefore: result.bytesBefore,
      bytesAfter: result.bytesAfter,
      linesBefore: result.linesBefore,
      linesAfter: result.linesAfter,
      demoted: result.demoted,
      deduped: result.deduped,
      projectionEnabled: wantProjection,
      projectionItems: result.projectionItems,
      wrote: false,
    });
    if (options.write && result.existed && result.changed) {
      await applyWrite(result, /* jsonMode */ true);
    }
    return;
  }

  if (!result.existed) {
    warn('No native MEMORY.md found for this project; nothing to sync.');
    return;
  }

  header(`Memory Steward — sync ${options.write ? '(write)' : '(advisory report)'}`);
  kv('MEMORY.md', result.memoryFile);
  kv('bytes', `${result.bytesBefore} → ${result.bytesAfter} (projected)`);
  kv('lines', `${result.linesBefore} → ${result.linesAfter} (projected)`);
  kv('demotable leaf entries', String(result.demoted.length));
  kv('dedup candidates', String(result.deduped.length));
  if (wantProjection) {
    kv('projection items', String(result.projectionItems.length));
  } else {
    dim('projection: OFF (pass --projection to include a curated block)');
  }

  if (!result.changed) {
    out('');
    success('MEMORY.md is already lean; no changes.');
    return;
  }

  if (result.demoted.length > 0) {
    header('Demotable leaf entries (→ Archive on --write, NEVER deleted)');
    for (const d of result.demoted) {
      out(`  ${d.heading}`);
      dim(`    ${d.reason}`);
      dim(`    → ${d.applyHint}`);
    }
  }
  if (result.deduped.length > 0) {
    header('Dedup candidates (exact-duplicate blocks; first kept)');
    for (const d of result.deduped) out(`  ${d.heading}`);
  }
  if (wantProjection && result.projectionItems.length > 0) {
    header('Projection preview (curated block; --write to inject)');
    for (const it of result.projectionItems) {
      out(`  [${it.kind}] ${it.title}`);
    }
  }

  if (!options.write) {
    const { unifiedDiff } = await import('../../core/memory/sync.js');
    header('Diff (advisory — pass --write to apply)');
    out(unifiedDiff(result.before, result.after));
    out('');
    dim('Nothing was written. Re-run with --write to back up + apply.');
    return;
  }

  await applyWrite(result, /* jsonMode */ false);
}

async function applyWrite(
  result: import('../../core/memory/sync.js').SyncResult,
  jsonMode: boolean,
): Promise<void> {
  try {
    const { writeSyncResult } = await import('../../core/memory/sync.js');
    const { backupPath } = writeSyncResult(result);
    if (jsonMode) {
      json({ wrote: true, backupPath, bytesAfter: result.bytesAfter });
      return;
    }
    out('');
    success(`Backed up → ${path.basename(backupPath)}`);
    success(`Wrote lean MEMORY.md (${result.bytesBefore} → ${result.bytesAfter} bytes).`);
  } catch (err) {
    error(`memory sync write failed (original left intact): ${(err as Error).message}`);
    process.exitCode = 1;
  }
}
