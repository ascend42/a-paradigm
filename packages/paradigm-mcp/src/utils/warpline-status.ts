/**
 * #warpline-status (T-2026-11-12-001) — the `warpline` field of paradigm_status.
 *
 * Mirrors packages/paradigm/src/core/warpline-detect.ts (the MCP server does
 * not depend on the CLI package): Warpline is present when the project has a
 * `.warpline/` directory or a `.warpignore` file; mode is `git` when `.git`
 * exists in the root or any ancestor folder (no git call), else `native`; `integrations.warpline.guidance: off` in
 * .paradigm/config.yaml hides it. File reads only, never throws.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';

/** Must equal WARPLINE_BLOCK_BEGIN / END in packages/paradigm/src/core/ide-adapters/types.ts. */
export const WARPLINE_BLOCK_BEGIN = '<!-- warpline:begin -->';
export const WARPLINE_BLOCK_END = '<!-- warpline:end -->';

/**
 * Exactly one well-formed Warpline block: markers count only as whole lines
 * outside fenced code (``` or ~~~). Mirrors scanWarplineBlocks in
 * packages/paradigm/src/core/warpline-detect.ts (a parity test compares them).
 */
export function hasSingleWarplineBlock(text: string): boolean {
  let fence: { ch: string; len: number } | null = null;
  let open = false;
  let blocks = 0;
  for (const raw of text.split('\n')) {
    const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
    const fm = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (fence) {
      if (fm && fm[1][0] === fence.ch && fm[1].length >= fence.len && fm[2].trim() === '') fence = null;
      continue;
    }
    if (fm && !(fm[1][0] === '`' && fm[2].includes('`'))) {
      fence = { ch: fm[1][0], len: fm[1].length };
      continue;
    }
    const t = line.trim();
    if (t === WARPLINE_BLOCK_BEGIN) {
      if (open) return false;
      open = true;
    } else if (t === WARPLINE_BLOCK_END) {
      if (!open) return false;
      open = false;
      blocks++;
    }
  }
  return !open && blocks === 1;
}

export interface WarplineStatus {
  mode: 'native' | 'git';
  /** Where an agent starts in a Warpline project. */
  start: 'warpline orient';
  /** CLAUDE.md carries exactly one well-formed Warpline block (`paradigm sync` adds it). */
  synced: boolean;
}

function guidanceOff(rootDir: string): boolean {
  try {
    const raw = yaml.load(fs.readFileSync(path.join(rootDir, '.paradigm', 'config.yaml'), 'utf8')) as Record<string, unknown> | null;
    const integrations = raw?.integrations as Record<string, unknown> | undefined;
    const warpline = integrations && typeof integrations === 'object' ? (integrations.warpline as Record<string, unknown> | undefined) : undefined;
    return !!warpline && typeof warpline === 'object' && warpline.guidance === 'off';
  } catch {
    return false;
  }
}

/** A `.git` entry (directory or worktree file) in `dir` or any ancestor. */
function hasGitAncestor(dir: string): boolean {
  let current = path.resolve(dir);
  for (;;) {
    if (fs.existsSync(path.join(current, '.git'))) return true;
    const parent = path.dirname(current);
    if (parent === current) return false;
    current = parent;
  }
}

/** The paradigm_status `warpline` field, or null when Warpline is not detected. */
export function getWarplineStatus(rootDir: string): WarplineStatus | null {
  try {
    const dir = path.join(rootDir, '.warpline');
    const hasDir = fs.existsSync(dir) && fs.statSync(dir).isDirectory();
    if (!hasDir && !fs.existsSync(path.join(rootDir, '.warpignore'))) return null;
    if (guidanceOff(rootDir)) return null;
    const claudeMd = path.join(rootDir, 'CLAUDE.md');
    let synced = false;
    try {
      synced = fs.statSync(claudeMd).isFile() && hasSingleWarplineBlock(fs.readFileSync(claudeMd, 'utf8'));
    } catch { /* no CLAUDE.md */ }
    return {
      mode: hasGitAncestor(rootDir) ? 'git' : 'native',
      start: 'warpline orient',
      synced,
    };
  } catch {
    return null;
  }
}
