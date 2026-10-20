/**
 * @symbol #supervisor
 *
 * #supervisor run mode `auto-edits` (spec §3.4 "Run modes (D87)"): PURE — may
 * this `can_use_tool` request pass with no card? Only when ALL hold:
 *   - the tool is a file-editing tool (Edit, Write, MultiEdit, NotebookEdit;
 *     broker/run-mode.ts AUTO_EDIT_TOOLS) — never Bash, PowerShell, WebFetch
 *     or any other tool;
 *   - its path (file_path / notebook_path) is a non-empty ABSOLUTE string
 *     with no `..` segment (Aegis M4: a relative path is a card);
 *   - the session root it lies under is not the user's home, an ancestor of
 *     it, or `/` (Aegis M3: auto-edits never roots at $HOME);
 *   - it lies INSIDE one of the session's own roots (cwd, worktree), at the
 *     root as given or at its realpath, and is not the root itself;
 *   - NO component below that root is a symlink (Aegis H1: every existing
 *     component is lstat'd, the final one too; a dangling link to
 *     `.git/hooks/pre-commit` would otherwise read as a plain name while the
 *     Write follows it). A component that cannot be lstat'd for a reason
 *     other than ENOENT/ENOTDIR is a card too;
 *   - the path relative to that root is not gate-class (§15.7,
 *     manifest/layers.ts gateClassPathRule: .claude/**, CLAUDE*.md, .git/**,
 *     .gnomon/**, package.json and lockfiles, test config, pipelines, editor
 *     and toolchain dirs, lint/format configs, task runners, any non-ASCII
 *     name, …);
 *   - the card the request would raise carries no hidden or bidi characters
 *     (card.ts blockOf flags): such an edit is shown to the human, never
 *     passed unseen.
 * Anything else ⇒ `{ok:false, why}` and the caller raises the card as in `ask`.
 * `path` on a pass is where the write LANDS (the root's realpath + the
 * symlink-free rest), the path `approval.auto` logs.
 * Paths compare case-folded on darwin and win32 (case-insensitive default
 * filesystems), as the denyWrite check does.
 *
 * READ-ONLY BASH (TD-2026-10-20-294 part 1, autoBashReadOnly): a `Bash`
 * request also passes with no card under auto-edits — logged
 * `approval.auto{modeRef:'mode:auto-edits:read-only'}` — only when ALL hold:
 *   - its input keys are only `command`, `description`, `timeout` (any other
 *     key — `run_in_background`, `dangerouslyDisableSandbox`, an unknown one
 *     — is a card), the command is text and timeout (if any) a number;
 *   - no session root is the user's home, an ancestor of it, or `/`;
 *   - #shell-readonly classifyReadOnly proves the command read-only (it
 *     fails closed: unparsed or unproven ⇒ a card);
 *   - the card carries no hidden or bidi characters (blockOf flags).
 * The pass is never taken in `ask` or `manual` (the caller checks the
 * effective mode). Permission requests come from the session's own claude
 * child only, so no card on this path is peer-raised.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { gateClassPathRule } from '../manifest/layers.js';
import { blockOf } from '../broker/card.js';
import { AUTO_EDIT_TOOLS, isHomeOrAbove } from '../broker/run-mode.js';
import { classifyReadOnly } from './shell-readonly.js';

export type AutoEditWhy = 'tool' | 'no-path' | 'relative' | 'home-root' | 'outside-root' | 'symlink' | 'gate-class' | 'flagged';
export type AutoEditPass = { ok: true; path: string; root: string } | { ok: false; why: AutoEditWhy; rule?: string };

const realOr = (p: string): string | null => {
  try {
    return fs.realpathSync.native(p);
  } catch {
    return null;
  }
};

export function autoEditPass(tool: string, input: Record<string, unknown>, roots: readonly string[], cardLines: readonly string[], platform: string = process.platform, home: string = os.homedir()): AutoEditPass {
  const key = AUTO_EDIT_TOOLS[tool];
  if (!key) return { ok: false, why: 'tool' };
  const raw = input[key];
  if (typeof raw !== 'string' || raw.length === 0 || raw.includes('\u0000')) return { ok: false, why: 'no-path' };
  // M4: only an absolute path, with no `..` the kernel would have to resolve lexically while the OS follows links
  if (!path.isAbsolute(raw) || raw.split(/[\\/]+/).includes('..')) return { ok: false, why: 'relative' };
  const fold = platform === 'darwin' || platform === 'win32' ? (s: string) => s.toLowerCase() : (s: string) => s;
  const abs = path.resolve(raw);
  const absSegs = abs.slice(path.parse(abs).root.length).split(path.sep).filter(Boolean);
  for (const r of roots) {
    const realRoot = realOr(r);
    if (realRoot === null) continue;
    const forms = [...new Set([path.resolve(r), realRoot])];
    for (const base of forms) {
      const fb = fold(base);
      const fa = fold(abs);
      if (!(fa.startsWith(fb.endsWith(path.sep) ? fb : fb + path.sep))) continue;
      // Aegis re-check: the write uses the request's OWN letter case; on a case-sensitive volume `/vol/PROJ` is not
      // `/vol/proj`, so a prefix that matches only once case is folded goes to a card (the walk below checks `base`)
      const prefix = base.endsWith(path.sep) ? base : base + path.sep;
      if (!abs.startsWith(prefix)) return { ok: false, why: 'outside-root', rule: 'case-variant' };
      // inside this root: its rest, in the request's own letter case (segment counts survive case folding)
      const baseSegs = base.slice(path.parse(base).root.length).split(path.sep).filter(Boolean).length;
      const rest = absSegs.slice(baseSegs);
      if (rest.length === 0) continue;
      if (isHomeOrAbove(r, home, platform)) return { ok: false, why: 'home-root' };
      // H1: no symlink anywhere below the root, the final component included
      let cur = base;
      for (let i = 0; i < rest.length; i++) {
        cur = path.join(cur, rest[i]!);
        let st: fs.Stats;
        try {
          st = fs.lstatSync(cur);
        } catch (e) {
          const code = (e as NodeJS.ErrnoException).code;
          if (code === 'ENOENT' || code === 'ENOTDIR') break; // nothing further exists, so nothing further links
          return { ok: false, why: 'symlink', rule: `unreadable:${code ?? 'error'}` };
        }
        if (st.isSymbolicLink()) return { ok: false, why: 'symlink', rule: path.join(...rest.slice(0, i + 1)) };
      }
      const rel = path.join(...rest);
      const rule = gateClassPathRule(rel);
      if (rule) return { ok: false, why: 'gate-class', rule };
      if (blockOf(cardLines).flags.length > 0) return { ok: false, why: 'flagged' };
      return { ok: true, path: path.join(realRoot, rel), root: realRoot };
    }
  }
  return { ok: false, why: 'outside-root' };
}

export const READ_ONLY_MODE_REF = 'mode:auto-edits:read-only';
export const BASH_READ_ONLY_KEYS: readonly string[] = Object.freeze(['command', 'description', 'timeout']);
export type AutoBashPass = { ok: true } | { ok: false; why: string };

export function autoBashReadOnly(tool: string, input: Record<string, unknown>, roots: readonly string[], cardLines: readonly string[], gnomonHome: string, platform: string = process.platform, home: string = os.homedir()): AutoBashPass {
  if (tool !== 'Bash') return { ok: false, why: 'tool' };
  if (Object.keys(input).some((k) => !BASH_READ_ONLY_KEYS.includes(k))) return { ok: false, why: 'input-key' };
  if (typeof input.command !== 'string') return { ok: false, why: 'bad-input' };
  if (input.timeout !== undefined && typeof input.timeout !== 'number') return { ok: false, why: 'bad-input' };
  if (input.description !== undefined && typeof input.description !== 'string') return { ok: false, why: 'bad-input' };
  if (roots.length === 0 || roots.some((r) => isHomeOrAbove(r, home, platform))) return { ok: false, why: 'home-root' };
  if (blockOf(cardLines).flags.length > 0) return { ok: false, why: 'flagged' };
  const v = classifyReadOnly(input.command, { roots, home, gnomonHome, platform });
  return v.ok ? { ok: true } : { ok: false, why: `not-read-only: ${v.why}` };
}
