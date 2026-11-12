/**
 * #warpline-detect — is this project versioned by Warpline, and in which mode?
 *
 * Warpline is an optional, external tool (`@a-company/warpline`). Paradigm never
 * imports it; it only looks at the project tree so the generated instruction
 * files (CLAUDE.md, AGENTS.md, Cursor rules) can tell agents how to work in a
 * Warpline project. Detection reads files only — never PATH, never package
 * dependencies — so generated output stays byte-stable across machines.
 *
 *   - Warpline present: a `.warpline/` directory or a `.warpignore` file.
 *   - Mode `git` when `.git` exists (a directory, or a file in a worktree) in
 *     the root or any ancestor folder (no git call), so a project nested in a
 *     git repo is git mode; otherwise `native`. Same rule as Warpline's
 *     agentGuideModeOf, so both writers render the same block text.
 *   - Opt-out: `integrations: { warpline: { guidance: off } }` in
 *     .paradigm/config.yaml returns null (default `auto`).
 *
 * Never throws.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { log } from '../utils/logger.js';

export type WarplineMode = 'native' | 'git';

export interface WarplineDetection {
  mode: WarplineMode;
}

/** `integrations.warpline.guidance` from .paradigm/config.yaml; `auto` when unset or unreadable. */
export function readWarplineGuidance(rootDir: string): 'auto' | 'off' {
  const configPath = path.join(rootDir, '.paradigm', 'config.yaml');
  if (!fs.existsSync(configPath)) return 'auto';
  try {
    const raw = yaml.load(fs.readFileSync(configPath, 'utf8')) as Record<string, unknown> | null;
    const integrations = raw && typeof raw.integrations === 'object' && raw.integrations
      ? (raw.integrations as Record<string, unknown>)
      : null;
    const warpline = integrations && typeof integrations.warpline === 'object' && integrations.warpline
      ? (integrations.warpline as Record<string, unknown>)
      : null;
    return warpline?.guidance === 'off' ? 'off' : 'auto';
  } catch (err) {
    log.component('#warpline-detect').debug('Config unreadable; Warpline guidance stays auto', { error: (err as Error).message });
    return 'auto';
  }
}

/** A `.git` entry (directory or worktree file) in `dir` or any ancestor. No git call. */
export function hasGitAncestor(dir: string): boolean {
  let current = path.resolve(dir);
  for (;;) {
    if (fs.existsSync(path.join(current, '.git'))) return true;
    const parent = path.dirname(current);
    if (parent === current) return false;
    current = parent;
  }
}

export function detectWarpline(rootDir: string): WarplineDetection | null {
  try {
    const warplineDir = path.join(rootDir, '.warpline');
    const hasDir = fs.existsSync(warplineDir) && fs.statSync(warplineDir).isDirectory();
    const hasIgnore = fs.existsSync(path.join(rootDir, '.warpignore'));
    if (!hasDir && !hasIgnore) return null;
    if (readWarplineGuidance(rootDir) === 'off') return null;
    return { mode: hasGitAncestor(rootDir) ? 'git' : 'native' };
  } catch (err) {
    log.component('#warpline-detect').debug('Warpline detection failed', { error: (err as Error).message });
    return null;
  }
}

// ---------------------------------------------------------------------------
// Block markers (T-2026-11-12-001, Judge item 1)
// ---------------------------------------------------------------------------

/** Must equal WARPLINE_BLOCK_BEGIN / END in ide-adapters/types.ts (asserted by tests). */
const BEGIN_LINE = '<!-- warpline:begin -->';
const END_LINE = '<!-- warpline:end -->';

export interface WarplineBlockScan {
  /** [start, end) char span of each well-formed block; end is just after the end marker (before its line break). */
  blocks: Array<{ start: number; end: number }>;
  /** A begin without an end, an end without a begin, or a begin inside an open block. */
  malformed: boolean;
}

/**
 * Find Warpline blocks. A marker counts only as a WHOLE LINE (surrounding
 * whitespace and a CR allowed) OUTSIDE fenced code (``` or ~~~), so a doc that
 * quotes the markers inline or in a code sample is never mistaken for a block.
 */
export function scanWarplineBlocks(text: string): WarplineBlockScan {
  const blocks: WarplineBlockScan['blocks'] = [];
  let malformed = false;
  let fence: { ch: string; len: number } | null = null;
  let open: number | null = null;
  let pos = 0;
  for (const raw of text.split('\n')) {
    const lineStart = pos;
    pos += raw.length + 1;
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
    if (t === BEGIN_LINE) {
      if (open !== null) malformed = true;
      open = lineStart + raw.indexOf(BEGIN_LINE);
    } else if (t === END_LINE) {
      if (open === null) malformed = true;
      else {
        blocks.push({ start: open, end: lineStart + raw.indexOf(END_LINE) + END_LINE.length });
        open = null;
      }
    }
  }
  if (open !== null) malformed = true;
  return { blocks, malformed };
}

/** The single well-formed block's span, or null (none, several, or malformed markers). */
export function singleWarplineBlock(text: string): { start: number; end: number } | null {
  const scan = scanWarplineBlocks(text);
  return !scan.malformed && scan.blocks.length === 1 ? scan.blocks[0] : null;
}
