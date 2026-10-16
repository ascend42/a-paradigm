/**
 * #brain-declared — declared.yaml: the ONLY source of Brain symbols.
 *
 *   loadDeclared(rootHash, opts)                  → DeclaredDoc (empty when absent)
 *   saveDeclared(rootHash, doc, opts)             → backup + atomic write
 *   declareFromSuggestion(rootHash, s, opts)      → confirm a suggestion into a component
 *   addDeclaredRelate(rootHash, relate, opts)     → brain→code cross-link
 *   declaredSymbols(doc)                          → ['#lease-and-housing', …]
 *
 * Internal, .purpose-compatible shape (never shown to users). Writes reuse the
 * Memory Steward discipline: timestamped backup of the previous file under
 * <brainDir>/backups/ (last 10 kept), then atomic rename. Never inside the
 * user's folder (assertBrainWritePath).
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as yaml from 'js-yaml';
import { log } from '../mcp-logger.js';
import { atomicWriteFileSync } from './atomic.js';
import { assertBrainWritePath, brainDir, brainFile, loadBrainConfig } from './config.js';
import type { BrainOptions } from './types.js';
import type { Suggestion } from './suggest.js';

export interface DeclaredComponent {
  description: string;
  tags: string[];
  /** 'f_<id>:<relpath>' anchors. */
  anchors: string[];
  provenance: { by: 'human'; suggestion?: string; at: string };
}

export interface DeclaredRelate {
  file: string;
  /** e.g. 'a-paradigm/#skill-loader' */
  target: string;
  via: 'frontmatter' | 'confirm';
}

export interface DeclaredDoc {
  version: 1;
  components: Record<string, DeclaredComponent>;
  relates: DeclaredRelate[];
}

const MAX_BACKUPS = 10;

export function emptyDeclared(): DeclaredDoc {
  return { version: 1, components: {}, relates: [] };
}

/** Kebab-case symbol id from a free-text label ('' when nothing usable remains). */
export function toSymbolId(label: string): string {
  return String(label)
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}

function normalize(raw: unknown): DeclaredDoc {
  const doc = emptyDeclared();
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return doc;
  const r = raw as Record<string, unknown>;
  const comps = r.components;
  if (comps && typeof comps === 'object' && !Array.isArray(comps)) {
    for (const [id, c] of Object.entries(comps as Record<string, unknown>)) {
      const key = toSymbolId(id);
      if (!key || !c || typeof c !== 'object') continue;
      const cc = c as Record<string, unknown>;
      const prov = (cc.provenance && typeof cc.provenance === 'object' ? cc.provenance : {}) as Record<string, unknown>;
      doc.components[key] = {
        description: typeof cc.description === 'string' ? cc.description : key,
        tags: Array.isArray(cc.tags) ? cc.tags.filter((t): t is string => typeof t === 'string') : ['topic'],
        anchors: Array.isArray(cc.anchors) ? cc.anchors.filter((a): a is string => typeof a === 'string') : [],
        provenance: {
          by: 'human',
          ...(typeof prov.suggestion === 'string' ? { suggestion: prov.suggestion } : {}),
          at: typeof prov.at === 'string' ? prov.at : new Date(0).toISOString(),
        },
      };
    }
  }
  if (Array.isArray(r.relates)) {
    for (const x of r.relates) {
      if (!x || typeof x !== 'object') continue;
      const xx = x as Record<string, unknown>;
      if (typeof xx.file !== 'string' || typeof xx.target !== 'string') continue;
      doc.relates.push({ file: xx.file, target: xx.target, via: xx.via === 'frontmatter' ? 'frontmatter' : 'confirm' });
    }
  }
  return doc;
}

export function loadDeclared(rootHash: string, opts?: BrainOptions): DeclaredDoc {
  let text: string;
  try {
    text = fs.readFileSync(brainFile(rootHash, 'declared', opts), 'utf8');
  } catch {
    return emptyDeclared();
  }
  try {
    return normalize(yaml.load(text));
  } catch {
    // Malformed declared.yaml: refuse to guess (writes will back it up first).
    log.component('#brain-declared').warn('declared.yaml is malformed; treating as empty', { rootHash });
    return emptyDeclared();
  }
}

/** Backup (if present) then atomic write. Returns the backup path, or null when there was nothing to back up. */
export function saveDeclared(rootHash: string, doc: DeclaredDoc, opts?: BrainOptions): { backupPath: string | null } {
  const cfg = loadBrainConfig(rootHash, opts);
  const file = brainFile(rootHash, 'declared', opts);
  assertBrainWritePath(file, cfg.root, opts);
  let backupPath: string | null = null;
  if (fs.existsSync(file)) {
    const dir = path.join(brainDir(rootHash, opts), 'backups');
    backupPath = path.join(dir, `declared-${new Date().toISOString().replace(/[:.]/g, '-')}-${process.pid}.yaml`);
    assertBrainWritePath(backupPath, cfg.root, opts);
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    fs.copyFileSync(file, backupPath);
    pruneBackups(dir);
  }
  const clean = normalize(doc);
  atomicWriteFileSync(file, yaml.dump(clean, { lineWidth: 120, noRefs: true, sortKeys: false }));
  log.component('#brain-declared').info('declared.yaml written', { rootHash, components: Object.keys(clean.components).length, backedUp: backupPath !== null });
  return { backupPath };
}

function pruneBackups(dir: string): void {
  try {
    const all = fs.readdirSync(dir).filter((n) => n.startsWith('declared-') && n.endsWith('.yaml')).sort();
    for (const n of all.slice(0, Math.max(0, all.length - MAX_BACKUPS))) fs.unlinkSync(path.join(dir, n));
  } catch { /* best effort */ }
}

export interface DeclareResult {
  componentId: string;
  created: boolean;
  backupPath: string | null;
}

/** Confirm an accepted suggestion into declared.yaml (merge anchors when the component exists). */
export function declareFromSuggestion(rootHash: string, s: Suggestion, opts?: BrainOptions): DeclareResult {
  const id = toSymbolId(s.label);
  if (!id) throw new Error('suggestion label has no usable name');
  const doc = loadDeclared(rootHash, opts);
  const existing = doc.components[id];
  const anchors = [...new Set([...(existing?.anchors ?? []), ...s.anchors])].sort();
  doc.components[id] = {
    description: existing?.description ?? s.label,
    tags: existing?.tags ?? ['topic'],
    anchors,
    provenance: { by: 'human', suggestion: s.id, at: new Date().toISOString() },
  };
  const { backupPath } = saveDeclared(rootHash, doc, opts);
  return { componentId: id, created: !existing, backupPath };
}

/** Human-confirmed brain→code relate (deduped). */
export function addDeclaredRelate(rootHash: string, relate: DeclaredRelate, opts?: BrainOptions): { backupPath: string | null; added: boolean } {
  const doc = loadDeclared(rootHash, opts);
  if (doc.relates.some((r) => r.file === relate.file && r.target === relate.target)) return { backupPath: null, added: false };
  doc.relates.push(relate);
  return { ...saveDeclared(rootHash, doc, opts), added: true };
}

/** The brain's symbol set — ONLY what the human declared. */
export function declaredSymbols(doc: DeclaredDoc): string[] {
  return Object.keys(doc.components).map((k) => `#${k}`).sort();
}
