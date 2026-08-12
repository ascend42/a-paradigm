/**
 * #warpignore — Warpline's OWN, git-INDEPENDENT ignore mechanism (T-2026-08-12-002,
 * founder correction TD-2026-08-12-218).
 *
 * WHY THIS EXISTS. Warpline is native-first: the whole product runs with git
 * ABSENT. A tool that "never touches git" cannot then depend on git's
 * `.gitignore` to know what to skip — the story is incoherent. So Warpline owns
 * its own ignore file, `.warpignore`, and its own handler (this module), read and
 * applied everywhere Warpline walks a tree (snapshotDir, the lens walk behind
 * absorb, and thereby fork --into's phantom-symbol footgun). `warpline init`
 * still writes a `.gitignore` LINE for `.warpline/` so `git add -A` doesn't
 * swallow the fabric — but that is a courtesy to a COEXISTING git, not the
 * source of Warpline's own skip decisions.
 *
 * BUILT-IN DEFAULTS (always ignored, at any depth, even with NO `.warpignore`
 * present, and NOT un-ignorable by a `!` rule): `.git`, `.warpline`,
 * `.warpline-judge` (the Judge's witness/sandbox dir — tool state, never
 * meaning) and `node_modules`. Matched through the shared C-3 reserved-name
 * normalizer, so `.GIT`, `.git ` and `GIT~1` are covered too — the snapshot
 * filter and restoreTree's refusal must agree on the reserved set.
 *
 * COMPOSITION (not replacement). Callers OR this matcher with the legacy
 * `.warplineignore`/`.gitignore` matcher (ignore-rules.ts). This is deliberate:
 * the snapshot filter must stay a SUPERSET of the ref-snapshot / worktree-
 * semantics PROJECTION filter (see snapshot.ts's tree-semantics decision), or a
 * `.warpignore`-filtered seal would fail its own recovery. Adding `.warpignore`
 * (and `.warpline-judge`) only ever ENLARGES the exclude set, so the superset
 * invariant holds and recover stays honest.
 *
 * SYNTAX (gitignore-style, kept simple and hand-rolled — no third-party matcher,
 * so the native path carries no git-flavored dependency):
 *   - `#` comment lines and blank lines are skipped.
 *   - `!pattern` NEGATES (re-includes) — last matching rule wins (gitignore order).
 *   - a trailing `/` makes the rule DIRECTORY-ONLY (`dist/` matches the dir `dist`).
 *   - `*` matches within a path segment, `**` across segments, `?` one non-`/` char.
 *   - a leading `/` (or any non-trailing `/`) ANCHORS the pattern to the root;
 *     otherwise it matches at ANY depth.
 * Directories are PRUNED by the walk on a directory-entry match (gitignore
 * semantics: no re-inclusion inside an excluded directory).
 *
 * PURE + DETERMINISTIC: no clock, no ambient state, no console output. A matcher
 * precompiles each rule to a RegExp ONCE (loadWarpignore reads + parses once),
 * and the walk reuses the compiled rules across every path test — the "cache the
 * parse per root within a call" the hot walk needs, with no global mutable state.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { matchesReservedName } from './reserved-names.js';

/** Warpline's native ignore file — read from the walk ROOT (v1: root-level only). */
export const WARPIGNORE_FILE = '.warpignore' as const;

/**
 * The DEPRECATED legacy alias (ignore-rules.ts owned it first). `.warpignore` is
 * canonical (TD-2026-08-12-218); when it is absent this file is still read so
 * existing repos never break — with a one-time deprecation notice (see
 * `noteWarpignoreDeprecation`). `warpline init` only ever writes `.warpignore`.
 */
export const LEGACY_WARPIGNORE_FILE = '.warplineignore' as const;

/**
 * Names skipped at ANY depth regardless of the ignore file, and NOT re-includable
 * by a `!` rule (the floor). Matched through the C-3 normalizer (reserved-names).
 */
export const WARPIGNORE_DEFAULT_NAMES: ReadonlySet<string> = new Set([
  '.git',
  '.warpline',
  '.warpline-judge',
  'node_modules',
]);

/** The compiled ignore matcher for one root. */
export interface WarpignoreMatcher {
  /**
   * Should the walk skip `relPath` (posix, relative to the walk root)? `isDir`
   * (default false) gates directory-only (`foo/`) rules. Built-in defaults are
   * always ignored and cannot be negated.
   */
  isIgnored(relPath: string, isDir?: boolean): boolean;
}

interface Rule {
  negated: boolean;
  dirOnly: boolean;
  re: RegExp;
}

/** Escape a run of literal characters for embedding in a RegExp. */
function escapeLiteral(ch: string): string {
  return ch.replace(/[.+^${}()|[\]\\]/g, '\\$&');
}

/** Translate the glob part of a pattern to a RegExp body (segment-aware). */
function globToRegex(glob: string): string {
  let out = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        i++; // consume the second '*'
        if (glob[i + 1] === '/') {
          i++; // consume the '/' — `**/` matches zero or more leading segments
          out += '(?:.*/)?';
        } else {
          out += '.*'; // `**` matches across segment boundaries
        }
      } else {
        out += '[^/]*'; // `*` stays within a segment
      }
    } else if (c === '?') {
      out += '[^/]';
    } else {
      out += escapeLiteral(c);
    }
  }
  return out;
}

/** Compile one raw `.warpignore` line to a Rule, or null for blank/comment/empty. */
function compileRule(raw: string): Rule | null {
  let line = raw.replace(/\r$/, '');
  const trimmed = line.trim();
  if (trimmed === '' || trimmed.startsWith('#')) return null;

  // Trailing whitespace is not part of the pattern (gitignore trims it).
  let pattern = line.replace(/\s+$/, '');
  let negated = false;
  if (pattern.startsWith('!')) {
    negated = true;
    pattern = pattern.slice(1);
  } else if (pattern.startsWith('\\#') || pattern.startsWith('\\!')) {
    pattern = pattern.slice(1); // escaped leading '#'/'!' → literal
  }

  let dirOnly = false;
  if (pattern.endsWith('/')) {
    dirOnly = true;
    pattern = pattern.slice(0, -1);
  }
  if (pattern === '') return null;

  // A leading '/' — or any non-trailing '/' — anchors the pattern to the root;
  // otherwise it matches at any depth.
  let anchored = false;
  if (pattern.startsWith('/')) {
    anchored = true;
    pattern = pattern.slice(1);
  } else if (pattern.includes('/')) {
    anchored = true;
  }
  if (pattern === '') return null;

  const body = globToRegex(pattern);
  const prefix = anchored ? '^' : '(?:^|.*/)';
  return { negated, dirOnly, re: new RegExp(`${prefix}${body}$`) };
}

function rulesMatch(rules: Rule[], relPath: string, isDir: boolean): boolean {
  let ignored = false;
  for (const rule of rules) {
    if (rule.dirOnly && !isDir) continue;
    if (rule.re.test(relPath)) ignored = !rule.negated; // last match wins
  }
  return ignored;
}

/**
 * Build a matcher from raw `.warpignore` CONTENT (pure — the composition/test
 * seam). `null` content = the built-in defaults only.
 */
export function parseWarpignore(content: string | null): WarpignoreMatcher {
  const rules: Rule[] = [];
  if (content !== null) {
    for (const line of content.split('\n')) {
      const rule = compileRule(line);
      if (rule) rules.push(rule);
    }
  }
  return {
    isIgnored(relPath: string, isDir = false): boolean {
      const base = relPath.slice(relPath.lastIndexOf('/') + 1);
      // Un-negatable floor — checked BEFORE the file rules so no `!.git` (or any
      // spelling of it) can re-include a reserved name.
      if (matchesReservedName(base, WARPIGNORE_DEFAULT_NAMES)) return true;
      return rulesMatch(rules, relPath, isDir);
    },
  };
}

/** Read a file's content, or null when it is absent / not a regular file / unreadable. */
function readIfFile(p: string): string | null {
  try {
    if (fs.statSync(p).isFile()) return fs.readFileSync(p, 'utf8');
  } catch {
    // ENOENT or an unreadable file → null. A missing ignore file never fails a walk.
  }
  return null;
}

/**
 * Load the matcher for a walk rooted at `root`: the built-in defaults plus the
 * root `.warpignore` when present. Reads + parses ONCE; the returned matcher is
 * reused across the whole walk.
 *
 * CANONICAL-WITH-LEGACY-FALLBACK: `.warpignore` wins. When it is ABSENT, a legacy
 * `.warplineignore` is read through THIS handler too, so its rules keep applying
 * on the native path (existing repos don't break). Only ENLARGES the exclude set
 * — the superset invariant recover relies on holds. Present `.warpignore` shadows
 * the legacy file (canonical wins); the legacy alias then only rides the separate
 * ignore-rules matcher the callers already OR in.
 */
export function loadWarpignore(root: string): WarpignoreMatcher {
  const primary = readIfFile(path.join(root, WARPIGNORE_FILE));
  if (primary !== null) return parseWarpignore(primary);
  const legacy = readIfFile(path.join(root, LEGACY_WARPIGNORE_FILE));
  return parseWarpignore(legacy); // null → defaults only
}

/** Which ignore file (if any) governs `root`: canonical, deprecated legacy, or none. */
export function warpignoreSource(root: string): 'warpignore' | 'legacy' | 'defaults' {
  if (readIfFile(path.join(root, WARPIGNORE_FILE)) !== null) return 'warpignore';
  if (readIfFile(path.join(root, LEGACY_WARPIGNORE_FILE)) !== null) return 'legacy';
  return 'defaults';
}

/** The deprecation notice text when a legacy `.warplineignore` is in force, else null. */
export function warpignoreDeprecationNotice(root: string): string | null {
  return warpignoreSource(root) === 'legacy'
    ? `warpline: \`${LEGACY_WARPIGNORE_FILE}\` is deprecated — rename it to \`${WARPIGNORE_FILE}\` (the canonical native ignore file). ` +
        `It is still honored for now; \`warpline init\` writes \`${WARPIGNORE_FILE}\`.`
    : null;
}

/** Roots that have already been warned this process (the one-time dedup). */
const deprecationNotified = new Set<string>();

/**
 * ONE-TIME-PER-ROOT deprecation notice: returns the text the FIRST time `root`
 * is on the deprecated legacy alias, null on every subsequent call (and null when
 * there is no legacy file). Impure BY DESIGN — it holds the dedup state — but it
 * writes NOTHING: the CALLER emits to stderr, so this module stays console-free.
 */
export function noteWarpignoreDeprecation(root: string): string | null {
  const notice = warpignoreDeprecationNotice(root);
  if (!notice || deprecationNotified.has(root)) return null;
  deprecationNotified.add(root);
  return notice;
}

/** Test seam: forget which roots have been warned (so the once-guard can be re-exercised). */
export function __resetWarpignoreDeprecationNotices(): void {
  deprecationNotified.clear();
}
