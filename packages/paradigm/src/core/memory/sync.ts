/**
 * #memory-steward-sync — the `paradigm memory sync` engine (Memory Steward B2,
 * TD-2026-09-19-110). Keeps the NATIVE Claude Code MEMORY.md lean WITHOUT ever
 * losing the user's hand-curated content.
 *
 * Unlike A1 (pure), this module does I/O: it reads MEMORY.md + the memory/*.md
 * entries (via premise-core), and reads the typed stores (lore / habits /
 * decisions) to build a relevance-ranked projection. It NEVER writes here —
 * `computeSync` returns a fully-formed before/after; `writeSyncResult` (the only
 * mutator) performs the backup-first, atomic, fail-open write.
 *
 * THE FIVE SAFETY RAILS (each is a correctness requirement, not a nicety):
 *   1. Never delete real content silently. "Lean" = dedup + reorganize + DEMOTE
 *      stale blocks into an Archive section. Deletion stays in `memory prune`.
 *   2. Never rewrite the user's prose. Moved/reorganized blocks keep their body
 *      VERBATIM (we only rstrip trailing whitespace + reorder + add our own
 *      generated managed block / archive hints — never touch body bytes).
 *   3. Preview-first. `computeSync` is read-only; the CLI defaults to an advisory
 *      report (diff + hints). Only an explicit `--write` reaches `writeSyncResult`.
 *   4. Backup-then-atomic. `writeSyncResult` copies MEMORY.md to a timestamped
 *      .bak FIRST, then writes a temp file + renames. Any error leaves the
 *      original untouched (no partial writes).
 *   5. Fail-open on every harness assumption (missing dir/file, unreadable
 *      graph, malformed store) — degrade, never throw into the caller.
 *
 * IDEMPOTENCY: running sync twice with no store/memory changes produces byte-
 * identical output. The managed block carries NO timestamps; blocks are
 * rstripped + joined deterministically; the Archive region is captured as
 * "everything after the Archive heading" so already-demoted content is never
 * re-evaluated or double-wrapped.
 */

import { createHash } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

import {
  scanNativeMemory,
  resolveMemoryDir,
  extractSymbolMentions,
  loadLiveGraph,
  type ParsedMemoryEntry,
} from '@a-company/premise-core';

import { scoreEntry } from './score.js';

// Typed-store loaders. lore + habits live in this package; decisions are reached
// via the same relative-import edge the `paradigm memory route` command already
// builds against (TD-2026-09-19-110 A2 precedent — no new package coupling).
import { loadLoreEntries } from '../lore/storage.js';
import { loadHabits } from '../habits/loader.js';
import { loadDecisions } from '../../../../paradigm-mcp/src/utils/decision-loader.js';

// ── constants ───────────────────────────────────────────────

export const MANAGED_BEGIN = '<!-- PARADIGM:BEGIN curated (generated; edits overwritten) -->';
export const MANAGED_END = '<!-- PARADIGM:END -->';

export const ARCHIVE_HEADING = '## 🗄️ Archive — stale, pending review';
/** Tolerant matcher for the archive heading across emoji/whitespace variance. */
const ARCHIVE_HEADING_RE = /^##\s+.*Archive\s+—\s+stale/;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * A dated block whose newest date is within this many days is treated as ACTIVE
 * and is protected from demotion (an author who touched it recently means it).
 */
const ACTIVE_RECENT_DAYS = 180;

/** Hard cap on projection items when `--project` opts in (compact block). */
const PROJECTION_CAP = 8;

/** Max width of a single projection line before truncation. */
const PROJECTION_LINE_MAX = 80;

/**
 * Case-insensitive "this block is still load-bearing" markers. If ANY appears in
 * a block's heading+body (or an ancestor's), the block is never demoted. Broad by
 * design — false-protects, never false-demotes (the whole point of the rework).
 */
const ACTIVE_MARKERS = [
  '⭐',
  'START HERE',
  'ACTIVE',
  'IN PROGRESS',
  'LIVE',
  'CURRENT',
  'NEXT',
  'TODO',
  'WIP',
  '⚠',
];

/** A heading line: 1..6 '#' then whitespace then non-space. */
const HEADING_RE = /^(#{1,6})\s+\S/;

const DATE_RE = /\b20\d{2}-\d{2}-\d{2}\b/g;
/** Inline markdown link to a native-memory entry file, e.g. [title](foo.md). */
const MEMORY_LINK_RE = /\[[^\]]*\]\(([^)]+\.md)\)/g;

// ── public types ────────────────────────────────────────────

export interface DemotedInfo {
  heading: string;
  reason: string;
  applyHint: string;
}

export interface DedupInfo {
  heading: string;
}

export interface ProjectionItem {
  kind: 'decision' | 'lore' | 'habit' | 'native';
  id: string;
  title: string;
}

export interface SyncResult {
  memoryFile: string;
  existed: boolean;
  before: string;
  after: string;
  bytesBefore: number;
  bytesAfter: number;
  linesBefore: number;
  linesAfter: number;
  changed: boolean;
  demoted: DemotedInfo[];
  deduped: DedupInfo[];
  projectionItems: ProjectionItem[];
}

export interface SyncOptions {
  /** Override "now" (ms). Test seam. */
  now?: number;
  /**
   * Inject the Paradigm-curated projection block. OFF by default — a plain sync
   * only leans (dedup + demote) and never net-adds a projection. Opt in via the
   * CLI `--projection` flag (see NOTE below on the flag name).
   */
  project?: boolean;
  /** Hard cap on projection items (default 8). */
  projectionCap?: number;
}

// ── block parsing ───────────────────────────────────────────

interface Block {
  level: number;
  headingLine: string;
  /** Verbatim slice: heading line + body up to (not including) the next heading. */
  text: string;
  /** Body only (everything after the heading line), for staleness analysis. */
  bodyText: string;
}

interface TreeNode {
  block: Block;
  children: TreeNode[];
}

/**
 * Split raw markdown into an ordered list of heading-delimited blocks + any
 * preamble before the first heading. Concatenating `preamble` and every
 * block.text with '\n' reproduces the input exactly (verbatim guarantee).
 */
function splitBlocks(text: string): { preamble: string; blocks: Block[] } {
  const lines = text.split('\n');
  const headingIdx: number[] = [];
  lines.forEach((l, i) => {
    if (HEADING_RE.test(l)) headingIdx.push(i);
  });
  if (headingIdx.length === 0) return { preamble: text, blocks: [] };

  const preamble = headingIdx[0] > 0 ? lines.slice(0, headingIdx[0]).join('\n') : '';
  const blocks: Block[] = [];
  for (let h = 0; h < headingIdx.length; h++) {
    const startLine = headingIdx[h];
    const endLine = h + 1 < headingIdx.length ? headingIdx[h + 1] : lines.length;
    const headingLine = lines[startLine];
    const level = (headingLine.match(/^#+/)?.[0].length) ?? 1;
    const text = lines.slice(startLine, endLine).join('\n');
    const bodyText = lines.slice(startLine + 1, endLine).join('\n');
    blocks.push({ level, headingLine, text, bodyText });
  }
  return { preamble, blocks };
}

/** Build a heading-level tree from the flat, ordered block list. */
function buildTree(blocks: Block[]): TreeNode[] {
  const roots: TreeNode[] = [];
  const stack: TreeNode[] = [];
  for (const block of blocks) {
    const node: TreeNode = { block, children: [] };
    while (stack.length && stack[stack.length - 1].block.level >= block.level) stack.pop();
    if (stack.length) stack[stack.length - 1].children.push(node);
    else roots.push(node);
    stack.push(node);
  }
  return roots;
}

/** Collect a node + all its descendants (DFS, original order). */
function subtreeBlocks(node: TreeNode): Block[] {
  const out: Block[] = [node.block];
  for (const c of node.children) out.push(...subtreeBlocks(c));
  return out;
}

// ── managed block strip ─────────────────────────────────────

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Remove a previously-injected managed block (with surrounding blank lines). */
function stripManagedBlock(text: string): string {
  const re = new RegExp(`\\n*${escapeRe(MANAGED_BEGIN)}[\\s\\S]*?${escapeRe(MANAGED_END)}\\n*`, 'g');
  return text.replace(re, '\n\n');
}

/**
 * Split off the Archive region: everything from the Archive heading to EOF.
 * Because the Archive is always appended last, this reliably re-captures all
 * previously-demoted content so it is never re-parsed as a live block.
 */
function splitArchive(text: string): { live: string; existingArchive: string } {
  const lines = text.split('\n');
  const idx = lines.findIndex((l) => ARCHIVE_HEADING_RE.test(l));
  if (idx === -1) return { live: text, existingArchive: '' };
  const live = lines.slice(0, idx).join('\n');
  // Keep only the archived ENTRIES (below the heading); the heading is re-emitted
  // fresh so a re-run never stacks two Archive headings.
  const existingArchive = lines.slice(idx + 1).join('\n');
  return { live, existingArchive };
}

// ── staleness ───────────────────────────────────────────────

function collapsePrefix(symbol: string): string {
  return symbol.replace(/^([#$^!~])\1+/, '$1');
}

function rstrip(s: string): string {
  return s.replace(/\s+$/, '');
}

function trimEnds(s: string): string {
  return s.replace(/^\s+/, '').replace(/\s+$/, '');
}

function graphStale(bodyText: string, liveSymbols: Set<string> | null): string | null {
  if (!liveSymbols) return null;
  const mentions = extractSymbolMentions(bodyText);
  if (mentions.length === 0) return null;
  const dead = mentions.filter((m) => !liveSymbols.has(collapsePrefix(m)));
  if (dead.length !== mentions.length) return null;
  return `every referenced symbol is gone from the live graph (${dead.slice(0, 3).join(', ')}${dead.length > 3 ? '…' : ''})`;
}

/**
 * Does this text carry an active-signal marker (case-insensitive), OR any date
 * within the last ACTIVE_RECENT_DAYS of `now`? Either protects the block from
 * demotion. Substring-matched on purpose: it over-protects, never over-demotes.
 */
function hasActiveMarker(text: string, now: number): boolean {
  const upper = text.toUpperCase();
  for (const marker of ACTIVE_MARKERS) {
    if (upper.includes(marker.toUpperCase())) return true;
  }
  const found = text.match(DATE_RE);
  if (found) {
    for (const d of found) {
      const ts = Date.parse(d);
      if (Number.isNaN(ts)) continue;
      const ageDays = (now - ts) / MS_PER_DAY;
      // Recent (≤180d) OR future-dated → active. Older → no protection from date.
      if (ageDays <= ACTIVE_RECENT_DAYS) return true;
    }
  }
  return false;
}

/**
 * Should this node (with its subtree) be demoted to Archive? A block is demotable
 * ONLY if ALL of these hold (drastically narrowed 2026-09-20 — the old "shipped +
 * dated-old" heuristic false-flagged active, load-bearing sections):
 *
 *   1. It is a LEAF at heading level ≥3 (never a `#` title or `##` section, never
 *      a node that has child subsections).
 *   2. It is provably graph-stale: it cites symbols AND every one is gone from the
 *      live graph.
 *   3. It carries NO active-signal marker (see ACTIVE_MARKERS) and NO date within
 *      the last 180 days.
 *   4. No protected/active-marked ancestor in its parent chain (protection
 *      inherits down the subtree) — enforced by the caller via `ancestorProtected`.
 */
function demoteReason(
  node: TreeNode,
  ancestorProtected: boolean,
  liveSymbols: Set<string> | null,
  now: number,
): string | null {
  const b = node.block;
  // 1. leaf at level ≥3 only.
  if (b.level < 3) return null;
  if (node.children.length > 0) return null;
  // 4. inherited protection.
  if (ancestorProtected) return null;
  // 3. own active markers / recent dates.
  if (hasActiveMarker(b.text, now)) return null;
  // 2. provable graph-staleness.
  return graphStale(b.bodyText, liveSymbols);
}

/** Best-effort apply hint: resolve an in-block memory-file link to its entry id. */
function applyHintFor(
  block: Block,
  entriesByBasename: Map<string, ParsedMemoryEntry>,
  idOf: (file: string) => string,
): string {
  MEMORY_LINK_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = MEMORY_LINK_RE.exec(block.bodyText)) !== null) {
    const base = path.basename(m[1]);
    const entry = entriesByBasename.get(base);
    if (entry) {
      const id = idOf(entry.file);
      return `paradigm memory prune ${id}  (or: paradigm memory route ${id} --to lore)`;
    }
  }
  return 'paradigm memory review  (inline note — curate or delete by hand)';
}

// ── projection ──────────────────────────────────────────────

/** One terse projection line: `- [kind] title`, truncated to PROJECTION_LINE_MAX. */
function projectionLine(it: ProjectionItem): string {
  const raw = `- [${it.kind}] ${it.title}`.replace(/\s+/g, ' ').trim();
  return raw.length > PROJECTION_LINE_MAX ? raw.slice(0, PROJECTION_LINE_MAX - 1) + '…' : raw;
}

/**
 * Build a COMPACT, DEDUPED, CAPPED managed projection block. Opt-in (`--project`
 * / opts.project) only — the default lean pass never adds one. Rules:
 *   - gather from decisions (active) / recent lore / enabled habits / high-value
 *     native entries, in that priority order;
 *   - DEDUP against `existingText` (the current MEMORY.md, managed block already
 *     stripped): skip any item whose id OR title substring already appears — this
 *     kills the circular case where a decision/lore the user already wrote about
 *     (or a prior projection) gets re-injected;
 *   - CAP at `cap` items total, one terse line each;
 *   - if 0 items survive dedup+cap, return text=null → NO block is injected.
 */
async function buildProjection(
  rootDir: string,
  entries: ParsedMemoryEntry[],
  cap: number,
  now: number,
  idOf: (file: string) => string,
  existingText: string,
): Promise<{ text: string | null; items: ProjectionItem[] }> {
  // Decisions (active) — newest first, then id for a stable tiebreak.
  let decisions: ProjectionItem[] = [];
  try {
    const raw = loadDecisions(rootDir, { status: 'active' });
    decisions = raw
      .slice()
      .sort((a, b) => b.timestamp.localeCompare(a.timestamp) || a.id.localeCompare(b.id))
      .slice(0, cap)
      .map((d) => ({ kind: 'decision' as const, id: d.id, title: d.title }));
  } catch {
    decisions = [];
  }

  // Recent lore.
  let lore: ProjectionItem[] = [];
  try {
    const raw = await loadLoreEntries(rootDir, { limit: cap });
    lore = raw
      .slice()
      .sort((a, b) => b.timestamp.localeCompare(a.timestamp) || a.id.localeCompare(b.id))
      .slice(0, cap)
      .map((l) => ({ kind: 'lore' as const, id: l.id, title: l.title }));
  } catch {
    lore = [];
  }

  // Enabled habits — deterministic by id.
  let habits: ProjectionItem[] = [];
  try {
    const raw = loadHabits(rootDir);
    habits = raw
      .filter((h) => h.enabled)
      .slice()
      .sort((a, b) => a.id.localeCompare(b.id))
      .slice(0, cap)
      .map((h) => ({ kind: 'habit' as const, id: h.id, title: h.name }));
  } catch {
    habits = [];
  }

  // Still-valid, high-value native entries — lowest staleness first.
  let native: ProjectionItem[] = [];
  try {
    native = entries
      .filter((e) => e.kind !== 'index')
      .map((e) => ({ e, s: scoreEntry(e, { now }) }))
      .filter(({ e, s }) => e.graphValidity.verdict === 'valid' && s.score < 0.3)
      .sort((a, b) => a.s.score - b.s.score || a.e.file.localeCompare(b.e.file))
      .slice(0, cap)
      .map(({ e }) => ({
        kind: 'native' as const,
        id: idOf(e.file),
        title: e.name || path.basename(e.file),
      }));
  } catch {
    native = [];
  }

  // Priority-ordered union → dedup against the existing file → cap.
  const hay = existingText.toLowerCase();
  const combined = [...decisions, ...lore, ...habits, ...native];
  const deduped: ProjectionItem[] = [];
  const seenLine = new Set<string>();
  for (const it of combined) {
    const idHit = it.id && hay.includes(it.id.toLowerCase());
    const title = (it.title || '').trim();
    const titleHit = title.length > 0 && hay.includes(title.toLowerCase());
    if (idHit || titleHit) continue; // already covered by hand-written content
    const line = projectionLine(it);
    if (seenLine.has(line)) continue; // guard against identical terse lines
    seenLine.add(line);
    deduped.push(it);
    if (deduped.length >= cap) break;
  }

  if (deduped.length === 0) return { text: null, items: [] };

  const lines: string[] = [MANAGED_BEGIN];
  for (const it of deduped) lines.push(projectionLine(it));
  lines.push(MANAGED_END);

  return { text: rstrip(lines.join('\n')), items: deduped };
}

// ── compute (read-only) ─────────────────────────────────────

/**
 * Compute the lean rewrite of MEMORY.md WITHOUT writing anything. Safe to call
 * repeatedly; deterministic given unchanged stores.
 */
export async function computeSync(rootDir: string, opts: SyncOptions = {}): Promise<SyncResult> {
  const now = opts.now ?? Date.now();
  const projectionCap = opts.projectionCap ?? PROJECTION_CAP;
  const wantProjection = opts.project === true;

  const memoryDir = resolveMemoryDir(rootDir);
  const memoryFile = path.join(memoryDir, 'MEMORY.md');

  const empty: SyncResult = {
    memoryFile,
    existed: false,
    before: '',
    after: '',
    bytesBefore: 0,
    bytesAfter: 0,
    linesBefore: 0,
    linesAfter: 0,
    changed: false,
    demoted: [],
    deduped: [],
    projectionItems: [],
  };

  let before: string;
  try {
    if (!fs.existsSync(memoryFile)) return empty;
    before = fs.readFileSync(memoryFile, 'utf8');
  } catch {
    return empty;
  }

  // Scan entries (for the projection + link resolution). Fail-open.
  let entries: ParsedMemoryEntry[] = [];
  try {
    entries = await scanNativeMemory(rootDir);
  } catch {
    entries = [];
  }
  const entriesByBasename = new Map<string, ParsedMemoryEntry>();
  for (const e of entries) entriesByBasename.set(path.basename(e.file), e);

  // Stable id for a native-memory file (mirrors A2's stableId, kept local so this
  // module does not depend on the command layer).
  const idOf = (file: string): string => stableMemId(file);

  // Live symbols (fail-open: null → cannot prove anything stale).
  let liveSymbols: Set<string> | null = null;
  try {
    const graph = await loadLiveGraph(rootDir);
    liveSymbols = new Set(graph.allSymbols.map(collapsePrefix));
  } catch {
    liveSymbols = null;
  }

  // 1. strip managed block, split off the existing Archive region.
  const stripped = stripManagedBlock(before);
  const { live, existingArchive } = splitArchive(stripped);

  // 2. parse live content into blocks.
  const { preamble, blocks } = splitBlocks(live);
  const tree = buildTree(blocks);

  // 3. determine demotions (subtree roots). Descendants travel with the root.
  const demotedBlockSet = new Set<Block>();
  const demoted: DemotedInfo[] = [];
  const demotedArchiveChunks: string[] = [];

  const walk = (nodes: TreeNode[], ancestorProtected: boolean): void => {
    for (const node of nodes) {
      const reason = demoteReason(node, ancestorProtected, liveSymbols, now);
      if (reason) {
        const sub = subtreeBlocks(node);
        for (const b of sub) demotedBlockSet.add(b);
        const hint = applyHintFor(node.block, entriesByBasename, idOf);
        demoted.push({ heading: node.block.headingLine, reason, applyHint: hint });
        const bodyVerbatim = sub.map((b) => rstrip(b.text)).join('\n\n');
        demotedArchiveChunks.push(
          `<!-- demoted by paradigm memory sync: ${reason} · apply: ${hint} -->\n${bodyVerbatim}`,
        );
        // do NOT recurse — the whole subtree moved with this root.
      } else {
        // Protection inherits down: an active-marked ancestor shields its subtree.
        const childProtected = ancestorProtected || hasActiveMarker(node.block.text, now);
        walk(node.children, childProtected);
      }
    }
  };
  walk(tree, false);

  // 4. dedup: drop exact-duplicate LEAF blocks (keep first). Never dedup a parent
  // block (would orphan children).
  const childless = new Set<Block>();
  const markChildless = (nodes: TreeNode[]): void => {
    for (const n of nodes) {
      if (n.children.length === 0) childless.add(n.block);
      else markChildless(n.children);
    }
  };
  markChildless(tree);

  const seen = new Set<string>();
  const dedupedBlockSet = new Set<Block>();
  const deduped: DedupInfo[] = [];
  for (const block of blocks) {
    if (demotedBlockSet.has(block)) continue;
    if (!childless.has(block)) continue;
    const key = rstrip(block.text);
    if (seen.has(key)) {
      dedupedBlockSet.add(block);
      deduped.push({ heading: block.headingLine });
    } else {
      seen.add(key);
    }
  }

  // 5. projection (managed block) — OFF unless opts.project. Even when on, the
  // builder returns text=null if nothing survives dedup+cap → no block injected.
  let projectionText: string | null = null;
  let projectionItems: ProjectionItem[] = [];
  if (wantProjection) {
    const projection = await buildProjection(
      rootDir,
      entries,
      projectionCap,
      now,
      idOf,
      stripped, // dedup against the current file (own managed block already stripped)
    );
    projectionText = projection.text;
    projectionItems = projection.items;
  }

  // 6. assemble.
  const keptBlocks = blocks.filter((b) => !demotedBlockSet.has(b) && !dedupedBlockSet.has(b));
  const titleBlock = keptBlocks.find((b) => b.level === 1);

  const parts: string[] = [];
  if (preamble.trim()) parts.push(rstrip(preamble));

  let managedInserted = false;
  for (const block of keptBlocks) {
    parts.push(rstrip(block.text));
    if (projectionText && !managedInserted && block === titleBlock) {
      parts.push(projectionText);
      managedInserted = true;
    }
  }
  if (projectionText && !managedInserted) {
    // no level-1 title → managed block goes first (after any preamble).
    parts.splice(preamble.trim() ? 1 : 0, 0, projectionText);
  }

  // Archive section: existing archived entries + newly demoted, under ONE heading.
  // Trim both ends of the captured region so a re-run does not accrete blank
  // lines (idempotency).
  const archiveBody = [trimEnds(existingArchive), demotedArchiveChunks.join('\n\n')]
    .filter((s) => s.length > 0)
    .join('\n\n');
  if (archiveBody.length > 0) {
    parts.push(`${ARCHIVE_HEADING}\n\n${archiveBody}`);
  }

  const after = parts.join('\n\n') + '\n';

  return {
    memoryFile,
    existed: true,
    before,
    after,
    bytesBefore: Buffer.byteLength(before, 'utf8'),
    bytesAfter: Buffer.byteLength(after, 'utf8'),
    linesBefore: before.split('\n').length,
    linesAfter: after.split('\n').length,
    changed: before !== after,
    demoted,
    deduped,
    projectionItems,
  };
}

// ── write (the ONLY mutator) ────────────────────────────────

export interface WriteResult {
  backupPath: string;
}

/**
 * Backup-then-atomic write. Copies MEMORY.md to MEMORY.md.bak-<ts> FIRST, then
 * writes a temp file and renames it over the original. On ANY error the original
 * is left byte-for-byte untouched (no partial writes) and the error propagates.
 */
export function writeSyncResult(result: SyncResult): WriteResult {
  if (!result.existed) {
    throw new Error('refusing to write: MEMORY.md does not exist');
  }
  const dir = path.dirname(result.memoryFile);
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = path.join(dir, `MEMORY.md.bak-${ts}`);

  // Backup FIRST. If this throws, nothing has been touched.
  fs.copyFileSync(result.memoryFile, backupPath);

  // Atomic replace via temp + rename.
  const tmp = path.join(dir, `.MEMORY.md.tmp-${process.pid}-${Date.now()}`);
  try {
    fs.writeFileSync(tmp, result.after, 'utf8');
    fs.renameSync(tmp, result.memoryFile);
  } catch (err) {
    try {
      if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
    } catch {
      // best-effort cleanup
    }
    throw err; // original never renamed → intact
  }

  return { backupPath };
}

// ── local stable id (mirrors commands/memory stableId) ──────

/** Deterministic id for a native-memory file, matching the A2 CLI's stableId. */
export function stableMemId(file: string): string {
  const hash = createHash('sha1').update(path.resolve(file)).digest('hex').slice(0, 8);
  return `mem-${hash}`;
}

// ── minimal unified-ish diff (line based, no external dep) ──

/**
 * Compact line diff for the dry-run preview. Not a full unified diff — it groups
 * changed runs with a few lines of context, prefixing '-' / '+' / ' '.
 */
export function unifiedDiff(before: string, after: string, label = 'MEMORY.md'): string {
  const a = before.split('\n');
  const b = after.split('\n');
  const ops = lcsDiff(a, b);

  const out: string[] = [`--- a/${label}`, `+++ b/${label}`];
  const CONTEXT = 3;

  // Mark which context lines to keep: any equal line within CONTEXT of a change.
  const keep = new Array(ops.length).fill(false);
  for (let i = 0; i < ops.length; i++) {
    if (ops[i].tag !== 'equal') {
      for (let j = Math.max(0, i - CONTEXT); j <= Math.min(ops.length - 1, i + CONTEXT); j++) {
        keep[j] = true;
      }
    }
  }

  let anyChange = false;
  let gap = false;
  for (let i = 0; i < ops.length; i++) {
    if (!keep[i]) {
      if (!gap && anyChange) {
        out.push('  …');
        gap = true;
      }
      continue;
    }
    gap = false;
    const op = ops[i];
    if (op.tag === 'equal') out.push(`  ${op.line}`);
    else if (op.tag === 'del') {
      out.push(`- ${op.line}`);
      anyChange = true;
    } else {
      out.push(`+ ${op.line}`);
      anyChange = true;
    }
  }

  if (!anyChange) return '(no changes)';
  return out.join('\n');
}

interface DiffOp {
  tag: 'equal' | 'del' | 'add';
  line: string;
}

/** Classic LCS-based line diff. Fine for MEMORY.md-scale inputs. */
function lcsDiff(a: string[], b: string[]): DiffOp[] {
  const n = a.length;
  const m = b.length;
  // DP table of LCS lengths.
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const ops: DiffOp[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      ops.push({ tag: 'equal', line: a[i] });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      ops.push({ tag: 'del', line: a[i] });
      i++;
    } else {
      ops.push({ tag: 'add', line: b[j] });
      j++;
    }
  }
  while (i < n) ops.push({ tag: 'del', line: a[i++] });
  while (j < m) ops.push({ tag: 'add', line: b[j++] });
  return ops;
}
