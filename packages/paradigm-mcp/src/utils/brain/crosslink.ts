/**
 * #brain-crosslink — brain→code cross-links with a staleness PROOF.
 *
 *   checkCrossLinks(rootHash, audience, opts) → CrossLink[]
 *   resolveCrossLinkTarget(target, workspacePath, opts) → { verdict, reason }
 *
 * Sources: frontmatter `relates:` of VISIBLE files (via view.ts) plus
 * human-confirmed declared.yaml relates. Targets look like
 * 'a-paradigm/#skill-loader' (<member>/<symbol>).
 *
 * Verdicts:
 *   valid           member index loaded, symbol present (after exports filter)
 *   provably-stale  member index loaded AND the symbol is absent from it
 *   unknown         no workspace / member missing / index unreadable (no symbol
 *                   categories, or zero symbols) / index outdated (a member
 *                   .purpose is newer than scan-index.json) / not exported
 *                   — never claim stale without proof.
 *
 * Index shape: `paradigm index` and paradigm_reindex both write probe-core's
 * generateScanIndex output — top-level category maps (components, flows,
 * gates, signals, aspects, …) keyed by id, each item carrying `symbol` — which
 * is exactly what buildIndexFromScanData reads.
 *
 * Read-only: loads brain.yaml.workspace via loadWorkspaceConfig and the
 * member's .paradigm/scan-index.json; never writes anything.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { getAllSymbols } from '@a-company/premise-core';
import { log } from '../mcp-logger.js';
import { buildIndexFromScanData, filterByExports, loadWorkspaceConfig, type WorkspaceConfig } from '../workspace-loader.js';
import { loadBrainConfig, resolveHomedir } from './config.js';
import { loadDeclared } from './declared.js';
import { openBrainView } from './view.js';
import type { Audience, BrainOptions } from './types.js';

export type CrossLinkVerdict = 'valid' | 'provably-stale' | 'unknown';

export type CrossLinkReason =
  | 'present'
  | 'symbol-absent'
  | 'no-workspace'
  | 'workspace-unreadable'
  | 'bad-target'
  | 'member-missing'
  | 'index-unreadable'
  | 'index-outdated'
  | 'not-exported';

export interface CrossLink {
  fileId: string;
  relpath: string;
  target: string;
  via: 'frontmatter' | 'confirm';
  verdict: CrossLinkVerdict;
  reason: CrossLinkReason;
}

const TARGET_RE = /^([A-Za-z0-9._-]+)\/([#$^!~][A-Za-z0-9._-]+)$/;

interface MemberSymbols {
  raw: Set<string>;
  exported: Set<string>;
}

type MemberLoad = MemberSymbols | 'member-missing' | 'index-unreadable' | 'index-outdated';

/** Category maps buildIndexFromScanData reads; an index with none of them proves nothing. */
const SCAN_CATEGORIES = ['components', 'flows', 'gates', 'signals', 'aspects'] as const;

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'out', 'coverage', '.next', '.turbo', '.cache']);
const MAX_WALK_DIRS = 20_000;

/**
 * True when any .purpose file under `root` is newer than `indexMtimeMs`.
 * Bounded walk (skips vendored/build dirs and symlinks); an exhausted budget
 * counts as outdated — we cannot prove freshness, so we must not prove staleness.
 */
function purposeNewerThan(root: string, indexMtimeMs: number): boolean {
  const stack = [root];
  let dirs = 0;
  while (stack.length) {
    const dir = stack.pop()!;
    if (++dirs > MAX_WALK_DIRS) return true;
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      if (e.isSymbolicLink()) continue;
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name)) stack.push(path.join(dir, e.name));
      } else if (e.isFile() && e.name === '.purpose') {
        try {
          if (fs.statSync(path.join(dir, e.name)).mtimeMs > indexMtimeMs) return true;
        } catch { /* vanished mid-walk */ }
      }
    }
  }
  return false;
}

function expandHome(p: string, opts?: BrainOptions): string {
  return p === '~' || p.startsWith('~/') ? path.join(resolveHomedir(opts), p.slice(1)) : p;
}

function loadMember(ws: WorkspaceConfig, wsPath: string, name: string): MemberLoad {
  const member = ws.members.find((m) => m.name === name);
  if (!member || !member.path) return 'member-missing';
  const root = path.resolve(path.dirname(wsPath), member.path);
  const indexPath = path.join(root, '.paradigm', 'scan-index.json');
  let scanData: Record<string, unknown>;
  let indexMtimeMs: number;
  try {
    indexMtimeMs = fs.statSync(indexPath).mtimeMs;
    scanData = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
    if (!scanData || typeof scanData !== 'object' || Array.isArray(scanData)) return 'index-unreadable';
  } catch {
    return 'index-unreadable';
  }
  const hasCategory = SCAN_CATEGORIES.some((k) => {
    const v = scanData[k];
    return v !== null && typeof v === 'object' && !Array.isArray(v);
  });
  if (!hasCategory) return 'index-unreadable';
  try {
    const index = buildIndexFromScanData(scanData);
    const raw = new Set(getAllSymbols(index).map((e) => e.symbol));
    if (raw.size === 0) return 'index-unreadable';
    if (purposeNewerThan(root, indexMtimeMs)) return 'index-outdated';
    const exported = member.exports && member.exports.length > 0
      ? new Set(getAllSymbols(filterByExports(index, member.exports)).map((e) => e.symbol))
      : raw;
    return { raw, exported };
  } catch {
    return 'index-unreadable';
  }
}

/** Resolver bound to one workspace file (members cached per call). */
export function crossLinkResolver(workspace: string | undefined, opts?: BrainOptions): (target: string) => { verdict: CrossLinkVerdict; reason: CrossLinkReason } {
  let ws: WorkspaceConfig | null = null;
  let wsPath = '';
  let wsError: CrossLinkReason | null = null;
  if (!workspace) wsError = 'no-workspace';
  else {
    wsPath = path.resolve(expandHome(workspace, opts));
    try { ws = loadWorkspaceConfig(wsPath); } catch { wsError = 'workspace-unreadable'; }
  }
  const cache = new Map<string, MemberLoad>();
  return (target: string) => {
    const m = TARGET_RE.exec(String(target ?? '').trim());
    if (!m) return { verdict: 'unknown', reason: 'bad-target' };
    if (wsError || !ws) return { verdict: 'unknown', reason: wsError ?? 'no-workspace' };
    const [, member, symbol] = m;
    let load = cache.get(member);
    if (!load) { load = loadMember(ws, wsPath, member); cache.set(member, load); }
    if (typeof load === 'string') return { verdict: 'unknown', reason: load };
    if (load.exported.has(symbol)) return { verdict: 'valid', reason: 'present' };
    if (load.raw.has(symbol)) return { verdict: 'unknown', reason: 'not-exported' };
    return { verdict: 'provably-stale', reason: 'symbol-absent' };
  };
}

export function resolveCrossLinkTarget(target: string, workspace: string | undefined, opts?: BrainOptions): { verdict: CrossLinkVerdict; reason: CrossLinkReason } {
  return crossLinkResolver(workspace, opts)(target);
}

/**
 * Every cross-link visible to `audience`, with its verdict. Declared relates on
 * files the audience cannot see are dropped (the view decides visibility).
 */
export function checkCrossLinks(rootHash: string, audience: Audience = 'owner', opts?: BrainOptions): CrossLink[] {
  const cfg = loadBrainConfig(rootHash, opts);
  const view = openBrainView(rootHash, audience, opts);
  const resolve = crossLinkResolver(cfg.workspace, opts);
  const out: CrossLink[] = [];
  const seen = new Set<string>();
  const push = (fileId: string, relpath: string, target: string, via: CrossLink['via']) => {
    const key = `${fileId}|${target}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ fileId, relpath, target, via, ...resolve(target) });
  };
  for (const f of view.files()) {
    for (const t of f.relates) push(f.id, f.relpath, t, 'frontmatter');
  }
  for (const r of loadDeclared(rootHash, opts).relates) {
    const f = view.get(r.file);
    if (f) push(f.id, f.relpath, r.target, r.via);
  }
  log.component('#brain-crosslink').debug('Cross-links checked', {
    rootHash, audience, total: out.length, stale: out.filter((c) => c.verdict === 'provably-stale').length,
  });
  return out;
}
