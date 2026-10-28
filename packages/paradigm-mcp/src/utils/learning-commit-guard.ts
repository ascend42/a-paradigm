/**
 * #learning-commit-guard — the pre-commit half of scoped learning S2
 * (TD-2026-10-28-820). Same shape as warpline's stake-guard: frozen,
 * schema-versioned rules and pure functions over staged content; the CLI
 * (`paradigm internal learning-guard --staged`) and the git pre-commit hook
 * do the I/O.
 *
 * A staged `.paradigm/**` data file (.jsonl, .json, .yaml, .yml) is refused
 * when it carries:
 *   - home-not-repo        any row or entry with `home: user` or `home: machine`
 *                          (user and machine data never get committed);
 *   - machine-path         an absolute path into a home directory (/Users/x/,
 *                          /home/x/, C:\Users\x\) or one of this machine's own
 *                          paths (home dir, learning home, state dir);
 *   - human-feedback-public with `learning.visibility: public` (the default
 *                          when unset): a `trigger: human_feedback` entry
 *                          without an explicit `home: repo`.
 * Source code, docs and markdown are never parsed, so prose that quotes a
 * path or a rule can never match.
 *
 * Changing a rule is a schema change: bump LEARNING_GUARD_SCHEMA.
 */

import * as yaml from 'js-yaml';

export const LEARNING_GUARD_SCHEMA = 'learning-guard:v1';

/** The PARADIGM_OVERRIDE id that lets one commit through (logged). */
export const LEARNING_GUARD_OVERRIDE_ID = 'learning-guard';

export const LEARNING_GUARD_DATA_EXTENSIONS: readonly string[] = Object.freeze(['.jsonl', '.json', '.yaml', '.yml']);

/** Generic home-directory paths (any user). */
export const MACHINE_PATH_PATTERNS: readonly RegExp[] = Object.freeze([
  /(?:^|[^A-Za-z0-9_.-])\/Users\/[^/\s"'`]+\//,
  /(?:^|[^A-Za-z0-9_.-])\/home\/[^/\s"'`]+\//,
  /[A-Za-z]:(?:\\\\|\\|\/)Users(?:\\\\|\\|\/)[^\\/\s"'`]+/i,
]);

export type LearningVisibility = 'public' | 'private';

export interface GuardFile {
  /** Repo-relative path with forward slashes. */
  path: string;
  content: string;
}

export interface GuardViolation {
  path: string;
  /** 1-based line for JSONL files. */
  line?: number;
  rule: 'home-not-repo' | 'machine-path' | 'human-feedback-public';
  detail: string;
}

export interface GuardOptions {
  visibility?: LearningVisibility;
  /** This machine's own absolute paths (home dir, learning home, state dir). */
  localPaths?: string[];
}

/** A staged path the guard reads: under a `.paradigm/` folder, with a data extension. */
export function isGuardedPath(relPath: string): boolean {
  const p = relPath.replace(/\\/g, '/');
  if (!(p.startsWith('.paradigm/') || p.includes('/.paradigm/'))) return false;
  return LEARNING_GUARD_DATA_EXTENSIONS.some(ext => p.endsWith(ext));
}

/** `learning.visibility` from a parsed config; public when unset or invalid. */
export function visibilityOf(config: unknown): LearningVisibility {
  const v = (config as { learning?: { visibility?: unknown } } | null)?.learning?.visibility;
  return v === 'private' ? 'private' : 'public';
}

function walk(value: unknown, visit: (obj: Record<string, unknown>) => void): void {
  if (Array.isArray(value)) {
    for (const v of value) walk(v, visit);
  } else if (value && typeof value === 'object') {
    visit(value as Record<string, unknown>);
    for (const v of Object.values(value as Record<string, unknown>)) walk(v, visit);
  }
}

function checkValue(value: unknown, file: string, line: number | undefined, opts: GuardOptions, out: GuardViolation[]): void {
  const visibility = opts.visibility ?? 'public';
  walk(value, obj => {
    if (obj.home === 'user' || obj.home === 'machine') {
      out.push({ path: file, line, rule: 'home-not-repo', detail: `home: ${obj.home} (user and machine data are never committed)` });
    }
    if (visibility === 'public' && obj.trigger === 'human_feedback' && obj.home !== 'repo') {
      out.push({ path: file, line, rule: 'human-feedback-public', detail: 'human_feedback entry without an explicit home: repo in a public repository' });
    }
  });
}

function machinePath(text: string, opts: GuardOptions): string | null {
  for (const p of opts.localPaths ?? []) {
    if (p && p.length > 3 && text.includes(p)) return p;
  }
  for (const re of MACHINE_PATH_PATTERNS) {
    const m = re.exec(text);
    if (m) return m[0].trim();
  }
  return null;
}

/** Every violation in the given staged files. Unparsable content is checked for machine paths only. */
export function learningGuardViolations(files: GuardFile[], opts: GuardOptions = {}): GuardViolation[] {
  const out: GuardViolation[] = [];
  for (const f of files) {
    if (!isGuardedPath(f.path)) continue;
    if (f.path.endsWith('.jsonl')) {
      f.content.split('\n').forEach((raw, i) => {
        if (!raw.trim()) return;
        const mp = machinePath(raw, opts);
        if (mp) out.push({ path: f.path, line: i + 1, rule: 'machine-path', detail: `machine path ${mp}` });
        try {
          checkValue(JSON.parse(raw), f.path, i + 1, opts, out);
        } catch { /* not JSON: machine-path check only */ }
      });
      continue;
    }
    const mp = machinePath(f.content, opts);
    if (mp) out.push({ path: f.path, rule: 'machine-path', detail: `machine path ${mp}` });
    try {
      const parsed = f.path.endsWith('.json') ? JSON.parse(f.content) : yaml.loadAll(f.content);
      checkValue(parsed, f.path, undefined, opts, out);
    } catch { /* unparsable: machine-path check only */ }
  }
  return out;
}

/** Whether PARADIGM_OVERRIDE (comma-separated ids) names the learning guard. */
export function learningGuardOverridden(envValue: string | undefined): boolean {
  return (envValue ?? '').split(',').map(s => s.trim()).includes(LEARNING_GUARD_OVERRIDE_ID);
}
