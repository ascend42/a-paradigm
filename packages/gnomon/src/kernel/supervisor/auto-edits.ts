/**
 * @symbol #supervisor
 *
 * #supervisor run mode `auto-edits` (spec §3.4 "Run modes (D87)"): PURE — may
 * this `can_use_tool` request pass with no card? Only when ALL hold:
 *   - the tool is a file-editing tool (Edit, Write, MultiEdit, NotebookEdit;
 *     broker/run-mode.ts AUTO_EDIT_TOOLS) — never Bash, PowerShell, WebFetch
 *     or any other tool;
 *   - its path (file_path / notebook_path) is a non-empty string that
 *     resolves, through every symlink of its existing prefix (policy.ts
 *     realpathLoose), INSIDE one of the session's own roots (cwd, worktree),
 *     and is not the root itself;
 *   - the path relative to that root is not gate-class (§15.7,
 *     manifest/layers.ts gateClassPathRule: .claude/**, CLAUDE*.md, .git/**,
 *     .gnomon/**, package.json and lockfiles, test config, pipelines, …);
 *   - the card the request would raise carries no hidden or bidi characters
 *     (card.ts blockOf flags): such an edit is shown to the human, never
 *     passed unseen.
 * Anything else ⇒ `{ok:false, why}` and the caller raises the card as in `ask`.
 * Paths compare case-folded on darwin and win32 (case-insensitive default
 * filesystems), as the denyWrite check does.
 */
import * as path from 'node:path';
import { realpathLoose } from '../manifest/policy.js';
import { gateClassPathRule } from '../manifest/layers.js';
import { blockOf } from '../broker/card.js';
import { AUTO_EDIT_TOOLS } from '../broker/run-mode.js';

export type AutoEditPass = { ok: true; path: string; root: string } | { ok: false; why: 'tool' | 'no-path' | 'outside-root' | 'gate-class' | 'flagged'; rule?: string };

export function autoEditPass(tool: string, input: Record<string, unknown>, roots: readonly string[], cardLines: readonly string[], platform: string = process.platform): AutoEditPass {
  const key = AUTO_EDIT_TOOLS[tool];
  if (!key) return { ok: false, why: 'tool' };
  const raw = input[key];
  if (typeof raw !== 'string' || raw.length === 0 || raw.includes('\u0000')) return { ok: false, why: 'no-path' };
  const fold = platform === 'darwin' || platform === 'win32' ? (s: string) => s.toLowerCase() : (s: string) => s;
  for (const r of roots) {
    const root = realpathLoose(r);
    const abs = realpathLoose(path.isAbsolute(raw) ? raw : path.resolve(r, raw));
    const rel = path.relative(fold(root), fold(abs));
    if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) continue;
    const rule = gateClassPathRule(rel);
    if (rule) return { ok: false, why: 'gate-class', rule };
    if (blockOf(cardLines).flags.length > 0) return { ok: false, why: 'flagged' };
    return { ok: true, path: abs, root };
  }
  return { ok: false, why: 'outside-root' };
}
