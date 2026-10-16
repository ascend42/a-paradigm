/**
 * #brain-view — THE gate choke point. The only module that imports index-store.
 *
 *   openBrainView(rootHash, 'agent' | 'owner', opts?)
 *
 * Filter BEFORE matching: the visible set is computed once from brain.yaml
 * gates; search / files / folders / link-resolution-for-display / inbound
 * counts only ever iterate the visible set, so counts, order and timing of
 * hidden records cannot leak.
 *
 *  - agent: only `open` files AND only when agent_access: metadata. Every
 *    respond() appends to egress.log and is leak-checked (fail closed).
 *  - owner: open + private. Sensitive gates only as {folder, gate, count}.
 *  - owner: links to hidden files render '[private]' (status hidden).
 *  - agent: links to hidden files render exactly like broken links
 *    (status 'missing', target '[missing]', no heading/block).
 *  - gate resolution throw → quarantined.
 */
import * as path from 'node:path';
import { log } from '../mcp-logger.js';
import { loadIndex, runScan } from './index-store.js';
import {
  governingZone,
  hardBlockReason,
  loadBrainConfig,
  safeResolveGate,
  stricter,
} from './config.js';
import { appendEgress } from './egress.js';
import {
  SENSITIVE_GATES,
  type Audience,
  type BrainConfig,
  type BrainGate,
  type BrainOptions,
  type BrainView,
  type FileKind,
  type IndexRecord,
  type LinkRef,
  type LockedZone,
  type ScanReport,
  type SearchHit,
  type ViewFile,
  type ViewLink,
  type ViewSummary,
} from './types.js';

const L = () => log.component('#brain-view');

/** Agent-audience target for every unresolved link (broken OR hidden — indistinguishable). */
export const AGENT_UNRESOLVED_TARGET = '[missing]';

export class BrainLeakError extends Error {
  constructor() {
    super('response blocked: it referenced a private file');
    this.name = 'BrainLeakError';
  }
}

/** Scan entrypoint for CLI / Platform (index-store stays private to this module). */
export function scanBrain(rootHash: string, opts?: BrainOptions): ScanReport {
  return runScan(rootHash, opts);
}

/** True when a scan has produced a readable index. */
export function hasIndex(rootHash: string, opts?: BrainOptions): boolean {
  return loadIndex(rootHash, opts) !== null;
}

function folderOf(rel: string): string {
  const d = path.posix.dirname(rel);
  return d === '.' ? '' : d;
}

function stripExt(p: string): string {
  return p.replace(/\.(md|markdown|txt)$/i, '');
}

function effectiveGate(r: IndexRecord, cfg: BrainConfig, opts?: BrainOptions): BrainGate {
  let gate: BrainGate;
  try {
    // cfg.root is a realpath and walked records are never symlinks → no per-record realpath.
    if (hardBlockReason(path.join(cfg.root, r.relpath), opts, { realpath: false })) return 'quarantined';
    gate = safeResolveGate(r.relpath, cfg);
  } catch {
    return 'quarantined';
  }
  if (r.status === 'quarantined') gate = stricter(gate, 'quarantined');
  else if (r.status === 'third-party-data') gate = stricter(gate, 'third-party-data');
  else if (r.status !== 'indexed' && r.status !== 'skipped') gate = 'quarantined';
  return gate;
}

function emptyView(rootHash: string, audience: Audience, agentAccess: 'off' | 'metadata', scannedAt: string | null, root: string, opts?: BrainOptions): BrainView {
  const summary: ViewSummary = {
    rootHash, audience, enabled: false, visible: 0,
    byKind: { markdown: 0, text: 0, other: 0 }, locked: 0, scannedAt, agentAccess,
  };
  return {
    rootHash,
    audience,
    enabled: false,
    summary: () => ({ ...summary, byKind: { ...summary.byKind } }),
    files: () => [],
    get: () => undefined,
    folders: () => [],
    search: () => [],
    lockedZones: () => [],
    respond: <T>(op: string, _ids: string[], payload: T): T => {
      if (audience === 'agent') recordAgentEgress(rootHash, root, op, [], payload, opts);
      return payload;
    },
  };
}

function recordAgentEgress(rootHash: string, root: string, op: string, fileIds: string[], payload: unknown, opts?: BrainOptions): void {
  let bytes = 0;
  try { bytes = Buffer.byteLength(JSON.stringify(payload) ?? '', 'utf8'); } catch { bytes = 0; }
  appendEgress(rootHash, { at: new Date().toISOString(), channel: 'mcp', op, fileIds, bytes, root }, opts);
}

/**
 * Open the gated view of one brain. Throws BrainConfigError if brain.yaml is
 * missing/malformed (callers render "not set up" — nothing is shown).
 */
export function openBrainView(rootHash: string, audience: Audience, opts?: BrainOptions): BrainView {
  const cfg = loadBrainConfig(rootHash, opts);
  if (audience !== 'agent' && audience !== 'owner') throw new Error('invalid audience');
  const idx = loadIndex(rootHash, opts);
  const scannedAt = idx?.scannedAt ?? null;
  if (audience === 'agent' && cfg.agent_access !== 'metadata') {
    return emptyView(rootHash, audience, cfg.agent_access, scannedAt, cfg.root, opts);
  }
  const records = idx?.records ?? [];

  // ── 1. Gate every record; split visible / hidden BEFORE any matching ──
  const visibleRecs: Array<{ r: IndexRecord; gate: 'open' | 'private' }> = [];
  const hidden: Array<{ r: IndexRecord; gate: BrainGate }> = [];
  for (const r of records) {
    const gate = effectiveGate(r, cfg, opts);
    const ok = audience === 'agent' ? gate === 'open' : gate === 'open' || gate === 'private';
    const statusOk = r.status === 'indexed' || r.status === 'skipped';
    if (ok && statusOk) visibleRecs.push({ r, gate: gate as 'open' | 'private' });
    else hidden.push({ r, gate });
  }

  // ── 2. Link resolution tables (hidden entries only ever yield '[private]') ──
  const byKey = new Map<string, { visible: IndexRecord[]; hidden: boolean }>();
  const addKey = (k: string, r: IndexRecord, vis: boolean) => {
    const key = k.toLowerCase();
    let e = byKey.get(key);
    if (!e) { e = { visible: [], hidden: false }; byKey.set(key, e); }
    if (vis) e.visible.push(r); else e.hidden = true;
  };
  const indexRec = (r: IndexRecord, vis: boolean) => {
    addKey(r.relpath, r, vis);
    addKey(stripExt(r.relpath), r, vis);
    const base = path.posix.basename(r.relpath);
    addKey(base, r, vis);
    addKey(stripExt(base), r, vis);
  };
  for (const { r } of visibleRecs) {
    indexRec(r, true);
    for (const a of r.aliases ?? []) addKey(a, r, true);
  }
  for (const { r } of hidden) indexRec(r, false);

  const resolve = (l: LinkRef, fromRel: string, fromId: string): ViewLink => {
    let keys: string[];
    if (l.kind === 'markdown') {
      const joined = path.posix.normalize(path.posix.join(folderOf(fromRel), l.target));
      if (joined.startsWith('..')) return { kind: l.kind, target: audience === 'agent' ? AGENT_UNRESOLVED_TARGET : l.target, status: 'missing' };
      keys = [joined, stripExt(joined)];
    } else {
      if (!l.target) {
        return { kind: l.kind, target: '', ...(l.heading ? { heading: l.heading } : {}), ...(l.block ? { block: l.block } : {}), status: 'ok', toId: fromId };
      }
      const t = l.target.replace(/^\.?\//, '');
      keys = [t, stripExt(t), path.posix.basename(t), stripExt(path.posix.basename(t))];
    }
    let hiddenHit = false;
    for (const k of keys) {
      const e = byKey.get(k.toLowerCase());
      if (!e) continue;
      if (e.visible.length) {
        const to = e.visible[0];
        const out: ViewLink = { kind: l.kind, target: l.target, status: 'ok', toId: to.id };
        if (l.heading) out.heading = l.heading;
        if (l.block) out.block = l.block;
        return out;
      }
      if (e.hidden) hiddenHit = true;
    }
    // Agent audience: a link to a hidden file is indistinguishable from a
    // broken one — both are status 'missing' with the SAME fixed target and no
    // heading/block (the as-written target of a hidden link would name the
    // hidden note). Owner audience keeps '[private]' vs the as-written target.
    if (audience === 'agent') return { kind: l.kind, target: AGENT_UNRESOLVED_TARGET, status: 'missing' };
    if (hiddenHit) return { kind: l.kind, target: '[private]', status: 'hidden' };
    const out: ViewLink = { kind: l.kind, target: l.target, status: 'missing' };
    if (l.heading) out.heading = l.heading;
    if (l.block) out.block = l.block;
    return out;
  };

  // ── 3. Build view files ──
  const files: ViewFile[] = visibleRecs.map(({ r, gate }) => ({
    id: r.id,
    relpath: r.relpath,
    folder: folderOf(r.relpath),
    kind: r.kind,
    ext: r.ext,
    size: r.size,
    ...(r.mtimeMs !== undefined ? { mtimeMs: r.mtimeMs } : {}),
    ...(r.hash ? { hash: r.hash } : {}),
    gate,
    status: r.status as 'indexed' | 'skipped',
    ...(r.title ? { title: r.title } : {}),
    headings: [...(r.headings ?? [])],
    tags: [...(r.tags ?? [])],
    aliases: [...(r.aliases ?? [])],
    relates: [...(r.relates ?? [])],
    links: (r.links ?? []).map((l) => resolve(l, r.relpath, r.id)),
    inbound: 0,
  }));
  files.sort((a, b) => (a.relpath < b.relpath ? -1 : a.relpath > b.relpath ? 1 : 0));
  const byId = new Map(files.map((f) => [f.id, f]));
  for (const f of files) {
    const seen = new Set<string>();
    for (const l of f.links) {
      if (l.status === 'ok' && l.toId && l.toId !== f.id && !seen.has(l.toId)) {
        seen.add(l.toId);
        const t = byId.get(l.toId);
        if (t) t.inbound++;
      }
    }
  }

  // ── 4. Owner-only locked aggregates (no filenames) ──
  const locked: LockedZone[] = [];
  if (audience === 'owner') {
    const agg = new Map<string, LockedZone>();
    for (const { r, gate } of hidden) {
      if (!SENSITIVE_GATES.includes(gate)) continue;
      let folder: string | null = null;
      if (r.status === 'indexed' || r.status === 'skipped' || r.status === 'third-party-data') {
        const z = governingZone(r.relpath, cfg);
        if (z && z.gate === gate) folder = z.glob.replace(/\/\*\*$/, '').replace(/\/\*$/, '');
      }
      const key = `${folder ?? '\u0000'}|${gate}`;
      const e = agg.get(key);
      if (e) e.count++;
      else agg.set(key, { folder, gate, count: 1 });
    }
    locked.push(...[...agg.values()].sort((a, b) => ((a.folder ?? '~') < (b.folder ?? '~') ? -1 : 1)));
  }

  // Agent leak guard: relpaths of every hidden record.
  const hiddenPaths = audience === 'agent' ? hidden.map((h) => h.r.relpath).filter((p) => p.length >= 3) : [];

  const byKind: Record<FileKind, number> = { markdown: 0, text: 0, other: 0 };
  for (const f of files) byKind[f.kind]++;
  const lockedCount = locked.reduce((n, z) => n + z.count, 0);

  const view: BrainView = {
    rootHash,
    audience,
    enabled: true,
    summary: () => ({
      rootHash, audience, enabled: true, visible: files.length, byKind: { ...byKind },
      locked: audience === 'owner' ? lockedCount : 0, scannedAt, agentAccess: cfg.agent_access,
    }),
    files: () => files.map(cloneFile),
    get: (id: string) => {
      const f = typeof id === 'string' ? byId.get(id) : undefined;
      return f ? cloneFile(f) : undefined;
    },
    folders: () => [...new Set(files.map((f) => f.folder))].sort(),
    search: (query: string, limit = 20) => searchFiles(files, query, limit).map((h) => ({ ...h, file: cloneFile(h.file) })),
    lockedZones: () => locked.map((z) => ({ ...z })),
    respond: <T>(op: string, fileIds: string[], payload: T): T => {
      if (audience !== 'agent') return payload;
      const ids = (Array.isArray(fileIds) ? fileIds : []).filter((id) => byId.has(id));
      let serialized = '';
      try { serialized = JSON.stringify(payload) ?? ''; } catch { throw new BrainLeakError(); }
      // Case-insensitive: a differently-cased spelling of a hidden path still counts as a leak.
      const hay = serialized.toLowerCase();
      for (const p of hiddenPaths) {
        const lp = p.toLowerCase();
        if (hay.includes(lp) || hay.includes(JSON.stringify(lp).slice(1, -1))) {
          L().warn('Blocked agent response referencing a gated path', { rootHash, op });
          recordAgentEgress(rootHash, cfg.root, `${op}:blocked`, [], null, opts);
          throw new BrainLeakError();
        }
      }
      recordAgentEgress(rootHash, cfg.root, op, ids, payload, opts);
      return payload;
    },
  };
  return view;
}

function cloneFile(f: ViewFile): ViewFile {
  return {
    ...f,
    headings: [...f.headings],
    tags: [...f.tags],
    aliases: [...f.aliases],
    relates: [...f.relates],
    links: f.links.map((l) => ({ ...l })),
  };
}

/** Plain case-insensitive substring match — no regex, no globbing. Visible files only. */
function searchFiles(files: ViewFile[], query: string, limit: number): SearchHit[] {
  if (typeof query !== 'string') return [];
  const q = query.normalize('NFKC').trim().toLowerCase().slice(0, 200);
  if (!q) return [];
  const lim = Math.max(1, Math.min(Number.isFinite(limit) ? Math.floor(limit) : 20, 100));
  const hits: SearchHit[] = [];
  for (const f of files) {
    const title = (f.title ?? '').toLowerCase();
    let best: SearchHit | null = null;
    const consider = (score: number, field: SearchHit['field']) => {
      if (!best || score > best.score) best = { file: f, score, field };
    };
    if (title === q) consider(100, 'title');
    else if (title.includes(q)) consider(60, 'title');
    if ([...f.tags, ...f.aliases].some((t) => t.toLowerCase() === q)) consider(55, 'topic');
    else if ([...f.tags, ...f.aliases].some((t) => t.toLowerCase().includes(q))) consider(40, 'topic');
    if (f.headings.some((h) => h.toLowerCase().includes(q))) consider(30, 'heading');
    if (f.relpath.toLowerCase().includes(q)) consider(20, 'path');
    if (best) hits.push(best);
  }
  hits.sort((a, b) => b.score - a.score || (a.file.relpath < b.file.relpath ? -1 : 1));
  return hits.slice(0, lim);
}
