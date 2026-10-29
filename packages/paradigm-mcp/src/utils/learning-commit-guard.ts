/**
 * #learning-commit-guard — the pre-commit half of scoped learning S2
 * (TD-2026-10-28-820). Same shape as warpline's stake-guard: frozen,
 * schema-versioned rules and pure functions over staged content; the CLI
 * (`paradigm internal learning-guard --staged`) and the git pre-commit hook
 * do the I/O.
 *
 * SCOPE (review, Arky + Loid): only LEARNING STORES, taken from the registry
 * (listLearningStores rows of class pipeline or knowledge, project scope),
 * minus decisions, protocols, skills and the event stream, plus agent-state/
 * and learned/. Never decisions/, lore/, specs/, docs/, config.yaml,
 * remediations/, research/, graphs/ or generated indexes.
 *
 * Only what the commit ADDS is checked: the added lines of a JSONL file
 * (`git diff --cached -U0`), and for YAML/JSON the whole file when it is new,
 * else only the entries that are not in HEAD. A legacy row is never re-judged.
 *
 * Rules:
 *   - home-not-repo        an added row or entry with `home: user` or `home: machine`;
 *   - machine-path         one of THIS machine's own paths (home dir, learning
 *                          home, state dir), never a generic pattern;
 *   - human-feedback-public with `learning.visibility: public` (the default
 *                          when unset): an added entry tagged `human-taught`
 *                          whose home was only inferred (`home_source:
 *                          inferred`). The human confirms it belongs to the
 *                          repo and it passes (S3: repo notebooks never carry
 *                          the journal's `trigger`, so the rule keys on the
 *                          tag and home_source that promotion carries over).
 *
 * Changing a rule or the scope is a schema change: bump LEARNING_GUARD_SCHEMA.
 */

import * as path from 'path';
import * as yaml from 'js-yaml';
import { listLearningStores } from './learning-stores.js';

export const LEARNING_GUARD_SCHEMA = 'learning-guard:v3';

/** The PARADIGM_OVERRIDE id that lets one commit through (logged). */
export const LEARNING_GUARD_OVERRIDE_ID = 'learning-guard';

/** The line the CLI prints when it refuses; the hook blocks only on exit 1 WITH this line. */
export const LEARNING_GUARD_REFUSAL = '[paradigm] commit refused: staged learning data';

/** Registry rows of class pipeline/knowledge that are NOT learning data for the guard. */
export const GUARD_EXCLUDED_STORE_IDS: readonly string[] = Object.freeze(['decisions', 'protocols', 'skills', 'event-stream']);

/** Learning folders the registry does not list as rows. */
export const GUARD_EXTRA_RELS: readonly string[] = Object.freeze(['agent-state', 'learned']);

export const LEARNING_GUARD_DATA_EXTENSIONS: readonly string[] = Object.freeze(['.jsonl', '.json', '.yaml', '.yml']);

export type LearningVisibility = 'public' | 'private';

export interface GuardFile {
  /** Repo-relative path with forward slashes. */
  path: string;
  /** Staged content. */
  content: string;
  /** JSONL: the lines this commit adds (git diff --cached -U0). Absent = every line. */
  added?: string[];
  /** YAML/JSON: the HEAD content, when the file existed. Absent = a new file. */
  previous?: string;
}

export interface GuardViolation {
  path: string;
  /** 1-based index among the checked JSONL lines. */
  line?: number;
  rule: 'home-not-repo' | 'machine-path' | 'human-feedback-public';
  detail: string;
}

export interface GuardOptions {
  visibility?: LearningVisibility;
  /** This machine's own absolute paths (home dir, learning home, state dir). */
  localPaths?: string[];
}

let _rels: string[] | null = null;

/** Paths under `.paradigm/` the guard covers (files or folder prefixes), from the registry. */
export function guardedLearningRels(): string[] {
  if (_rels) return _rels;
  const root = path.resolve('/guard-root');
  const base = path.join(root, '.paradigm');
  const rels = listLearningStores(root, { homeDir: path.resolve('/guard-home') })
    .filter(s => (s.class === 'pipeline' || s.class === 'knowledge') && s.scope === 'project' && !GUARD_EXCLUDED_STORE_IDS.includes(s.id))
    .map(s => path.relative(base, s.path).split(path.sep).join('/'))
    .filter(r => r && !r.startsWith('..'));
  _rels = Array.from(new Set([...rels, ...GUARD_EXTRA_RELS])).sort();
  return _rels;
}

/** A staged path the guard reads: a learning-store data file under a `.paradigm/` folder. */
export function isGuardedPath(relPath: string): boolean {
  const p = relPath.replace(/\\/g, '/');
  const idx = p.startsWith('.paradigm/') ? 0 : p.indexOf('/.paradigm/') + 1;
  if (idx === 0 && !p.startsWith('.paradigm/')) return false;
  if (!LEARNING_GUARD_DATA_EXTENSIONS.some(ext => p.endsWith(ext))) return false;
  const rel = p.slice(idx + '.paradigm/'.length);
  return guardedLearningRels().some(g => rel === g || rel.startsWith(`${g}/`));
}

/** `learning.visibility` from a parsed config; public when unset or invalid. */
export function visibilityOf(config: unknown): LearningVisibility {
  const v = (config as { learning?: { visibility?: unknown } } | null)?.learning?.visibility;
  return v === 'private' ? 'private' : 'public';
}

function objectsOf(value: unknown, out: Array<Record<string, unknown>> = []): Array<Record<string, unknown>> {
  if (Array.isArray(value)) {
    for (const v of value) objectsOf(v, out);
  } else if (value && typeof value === 'object') {
    out.push(value as Record<string, unknown>);
    for (const v of Object.values(value as Record<string, unknown>)) objectsOf(v, out);
  }
  return out;
}

function machinePath(text: string, opts: GuardOptions): string | null {
  for (const p of opts.localPaths ?? []) {
    if (p && p.length > 3 && (text.includes(p) || text.includes(p.replace(/\\/g, '\\\\')))) return p;
  }
  return null;
}

/** Rules on one object, looking only at its OWN fields (nested entries are visited separately). */
function checkObject(obj: Record<string, unknown>, file: string, line: number | undefined, opts: GuardOptions, out: GuardViolation[]): void {
  if (obj.home === 'user' || obj.home === 'machine') {
    out.push({ path: file, line, rule: 'home-not-repo', detail: `home: ${obj.home} (user and machine data are never committed)` });
  }
  if ((opts.visibility ?? 'public') === 'public' && isHumanTaughtInferred(obj)) {
    out.push({ path: file, line, rule: 'human-feedback-public', detail: HUMAN_TAUGHT_INFERRED_DETAIL });
  }
  const own = Object.values(obj).filter(v => typeof v === 'string').join('\n');
  const mp = machinePath(own, opts);
  if (mp) out.push({ path: file, line, rule: 'machine-path', detail: `this machine's path ${mp}` });
}

/** The refusal detail for an inferred human-taught entry in a public repository. */
export const HUMAN_TAUGHT_INFERRED_DETAIL =
  'human-taught lesson whose home was only inferred, in a public repository: confirm this lesson belongs to the repo (paradigm teach --home repo)';

/** An entry tagged human-taught whose home the human never chose or confirmed. */
export function isHumanTaughtInferred(obj: Record<string, unknown>): boolean {
  return Array.isArray(obj.tags) && obj.tags.includes('human-taught') && obj.home_source === 'inferred';
}

function parseStructured(file: string, content: string): unknown {
  return file.endsWith('.json') ? JSON.parse(content) : yaml.loadAll(content);
}

/** Every violation in what the given staged files ADD. Unparsable added content is checked for machine paths only. */
export function learningGuardViolations(files: GuardFile[], opts: GuardOptions = {}): GuardViolation[] {
  const out: GuardViolation[] = [];
  for (const f of files) {
    if (!isGuardedPath(f.path)) continue;
    if (f.path.endsWith('.jsonl')) {
      const lines = f.added ?? f.content.split('\n');
      lines.forEach((raw, i) => {
        if (!raw.trim()) return;
        let parsed: unknown;
        try {
          parsed = JSON.parse(raw);
        } catch {
          const mp = machinePath(raw, opts);
          if (mp) out.push({ path: f.path, line: i + 1, rule: 'machine-path', detail: `this machine's path ${mp}` });
          return;
        }
        for (const obj of objectsOf(parsed)) checkObject(obj, f.path, i + 1, opts, out);
      });
      continue;
    }
    let current: unknown;
    try {
      current = parseStructured(f.path, f.content);
    } catch {
      if (f.previous === undefined) {
        const mp = machinePath(f.content, opts);
        if (mp) out.push({ path: f.path, rule: 'machine-path', detail: `this machine's path ${mp}` });
      }
      continue;
    }
    let before = new Set<string>();
    if (f.previous !== undefined) {
      try {
        before = new Set(objectsOf(parseStructured(f.path, f.previous)).map(o => JSON.stringify(o)));
      } catch { /* unparsable HEAD: every entry counts as changed */ }
    }
    for (const obj of objectsOf(current)) {
      if (before.has(JSON.stringify(obj))) continue; // unchanged entry: never re-judged
      checkObject(obj, f.path, undefined, opts, out);
    }
  }
  return out;
}

/** Whether PARADIGM_OVERRIDE (comma-separated ids) names the learning guard. */
export function learningGuardOverridden(envValue: string | undefined): boolean {
  return (envValue ?? '').split(',').map(s => s.trim()).includes(LEARNING_GUARD_OVERRIDE_ID);
}
