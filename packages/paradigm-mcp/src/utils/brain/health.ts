/**
 * #brain-health — read-only "doctor" for a brain: broken links, loose notes,
 * same-name notes (shared filename or shared title, case-insensitive). Day-one value, zero labelling.
 *
 *   computeHealth(view)                     // pure, over a BrainView
 *   brainHealth(rootHash, 'owner', opts)    // opens the view for you
 *
 * Consumes view.ts ONLY (never index-store): every record it sees has already
 * passed the gate choke point, so hidden files never contribute to counts,
 * order or names. Links into hidden files are status 'hidden' in the view and
 * are neither "broken" nor listed.
 */
import * as path from 'node:path';
import { log } from '../mcp-logger.js';
import { openBrainView } from './view.js';
import type { Audience, BrainOptions, BrainView, ViewFile } from './types.js';

export interface BrokenLink {
  fileId: string;
  relpath: string;
  /** Link target as written in the (visible) source note. */
  target: string;
  heading?: string;
  block?: string;
  kind: 'wikilink' | 'markdown';
}

export interface LooseNote {
  fileId: string;
  relpath: string;
  title?: string;
}

export interface SameNameGroup {
  /** Normalized (lowercased, trimmed) shared filename or title. */
  name: string;
  /** What the notes share: file name, title, or both (chained). */
  match: 'filename' | 'title' | 'both';
  files: Array<{ fileId: string; relpath: string }>;
}

export interface BrainHealth {
  rootHash: string;
  audience: Audience;
  scannedAt: string | null;
  /** Visible notes (markdown + text) considered. */
  notes: number;
  brokenLinks: BrokenLink[];
  looseNotes: LooseNote[];
  sameNameNotes: SameNameGroup[];
  counts: { brokenLinks: number; looseNotes: number; sameNameNotes: number };
}

function isNote(f: ViewFile): boolean {
  return f.kind === 'markdown' || f.kind === 'text';
}

function norm(s: string): string {
  return s.normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase();
}

function baseName(rel: string): string {
  return norm(path.posix.basename(rel).replace(/\.(md|markdown|txt)$/i, ''));
}

/**
 * Same-name groups: notes sharing a normalized filename OR a normalized title
 * (frontmatter title, else first H1, else filename). Chains merge (union-find),
 * so A~B by filename and B~C by title is one group.
 */
function sameNameGroups(notes: ViewFile[]): SameNameGroup[] {
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    let r = x;
    while (parent.get(r) !== r) r = parent.get(r)!;
    parent.set(x, r);
    return r;
  };
  const byId = new Map(notes.map((f) => [f.id, f]));
  for (const f of notes) parent.set(f.id, f.id);
  const keyed: Array<{ key: string; kind: 'filename' | 'title'; ids: string[] }> = [];
  const index = (kind: 'filename' | 'title', keyOf: (f: ViewFile) => string) => {
    const m = new Map<string, string[]>();
    for (const f of notes) {
      const k = keyOf(f);
      if (!k) continue;
      const g = m.get(k) ?? [];
      g.push(f.id);
      m.set(k, g);
    }
    for (const [key, ids] of m) if (ids.length > 1) keyed.push({ key, kind, ids });
  };
  index('filename', (f) => baseName(f.relpath));
  index('title', (f) => norm(f.title ?? ''));
  for (const { ids } of keyed) for (const id of ids.slice(1)) parent.set(find(id), find(ids[0]));

  const groups = new Map<string, { keys: Set<string>; kinds: Set<'filename' | 'title'> }>();
  for (const { key, kind, ids } of keyed) {
    const root = find(ids[0]);
    const g = groups.get(root) ?? { keys: new Set(), kinds: new Set() };
    g.keys.add(key);
    g.kinds.add(kind);
    groups.set(root, g);
  }
  const out: SameNameGroup[] = [];
  for (const [root, g] of groups) {
    const files = notes
      .filter((f) => find(f.id) === root)
      .map((f) => ({ fileId: f.id, relpath: byId.get(f.id)!.relpath }))
      .sort((a, b) => (a.relpath < b.relpath ? -1 : a.relpath > b.relpath ? 1 : 0));
    const name = [...g.keys].sort()[0];
    out.push({ name, match: g.kinds.size > 1 ? 'both' : [...g.kinds][0], files });
  }
  return out.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

/** Pure health computation over an already-gated view. Deterministic ordering (relpath). */
export function computeHealth(view: BrainView): BrainHealth {
  const files = view.files();
  const notes = files.filter(isNote);

  const brokenLinks: BrokenLink[] = [];
  for (const f of notes) {
    for (const l of f.links) {
      if (l.status !== 'missing') continue;
      brokenLinks.push({
        fileId: f.id,
        relpath: f.relpath,
        target: l.target,
        ...(l.heading ? { heading: l.heading } : {}),
        ...(l.block ? { block: l.block } : {}),
        kind: l.kind,
      });
    }
  }

  // Loose = a markdown note nothing links to and that links nowhere. A link to
  // a hidden file (rendered '[private]') still counts as a connection.
  const looseNotes: LooseNote[] = [];
  for (const f of notes) {
    if (f.kind !== 'markdown' || f.status !== 'indexed') continue;
    const outOk = f.links.some((l) => l.status === 'hidden' || (l.status === 'ok' && l.toId && l.toId !== f.id));
    if (f.inbound === 0 && !outOk) {
      looseNotes.push({ fileId: f.id, relpath: f.relpath, ...(f.title ? { title: f.title } : {}) });
    }
  }

  const sameNameNotes = sameNameGroups(notes);

  const s = view.summary();
  return {
    rootHash: view.rootHash,
    audience: view.audience,
    scannedAt: s.scannedAt,
    notes: notes.length,
    brokenLinks,
    looseNotes,
    sameNameNotes,
    counts: { brokenLinks: brokenLinks.length, looseNotes: looseNotes.length, sameNameNotes: sameNameNotes.length },
  };
}

/** Open the gated view and compute health. Owner by default (CLI / Platform). */
export function brainHealth(rootHash: string, audience: Audience = 'owner', opts?: BrainOptions): BrainHealth {
  const h = computeHealth(openBrainView(rootHash, audience, opts));
  log.component('#brain-health').debug('Health computed', { rootHash, audience, ...h.counts });
  return h;
}
