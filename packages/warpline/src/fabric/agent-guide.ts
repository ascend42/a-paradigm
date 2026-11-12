/**
 * #warpline-agent-guide — the agent-readable block `warpline init` ships
 * (T-2026-11-12-001, Warpline awareness).
 *
 * WHY THIS EXISTS. Warpline is in no model's training data (TD-2026-07-21-766),
 * so a cold agent learns it only from what the project hands it at runtime. Before
 * this module `init` printed its agent hints to the TERMINAL only and wrote nothing
 * an agent reads on its next session, so an agent opening a Warpline project saw
 * no .git, no instructions, and reached for git. The block below is written into
 * AGENTS.md (created when absent) and into CLAUDE.md (only when it already exists
 * — Warpline never invents a host-specific file), between fixed markers.
 *
 * F4 "COLD" (founder decision D2, 2026-11-12): a cold agent is one that sees ONLY
 * what `warpline init` ships — this block, `warpline orient`, `--help`, the
 * descriptors and the refusals. Nothing from a repo-private notebook counts.
 *
 * BYTE PARITY: Paradigm's generated CLAUDE.md/AGENTS.md carry the SAME text as a
 * fallback (packages/paradigm ide-adapters), and a cross-package parity test
 * compares the two byte for byte. Change the text in both places or neither.
 *
 * IDEMPOTENT AND SURGICAL: only the text between `<!-- warpline:begin -->` and
 * `<!-- warpline:end -->` is ever replaced; a file with no block gets one
 * appended; text outside the markers is never touched; re-running never
 * duplicates.
 *
 * MARKERS ARE WHOLE LINES OUTSIDE CODE FENCES (judge review, 2026-11-12). A
 * marker matched as a plain substring let an inline mention — the setup guide
 * quoting `<!-- warpline:begin -->` in prose, copied into a CLAUDE.md — pair with
 * the real block's end and wipe everything between. scanAgentGuide applies the
 * same rules as Paradigm's scanWarplineBlocks (see there). A file the scan calls
 * malformed is LEFT ALONE and reported skipped with a note: replacing the
 * wrong span could destroy the user's text, which is the one thing this
 * function must never do. A UTF-8 BOM is preserved; CRLF files stay CRLF.
 *
 * NEVER FAILS INIT: each file is written atomically (a temp file in the same
 * directory, then rename — a crash leaves the old file or the new one, never half
 * of either) and through a symlink to its real target (a CLAUDE.md symlinked to
 * AGENTS.md is one file, written once). Any error on a file — read-only, a
 * directory, a vanished parent — yields `skipped` plus a note, never a throw.
 *
 * Library code: no console output (the CLI prints the result).
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';

export const AGENT_GUIDE_BEGIN = '<!-- warpline:begin -->' as const;
export const AGENT_GUIDE_END = '<!-- warpline:end -->' as const;

/** native = no git work tree (Warpline is the version control); git = git plus Warpline. */
export type AgentGuideMode = 'native' | 'git';

export type AgentGuideAction = 'created' | 'updated' | 'unchanged' | 'skipped';

export interface AgentGuideResult {
  mode: AgentGuideMode;
  agentsMd: AgentGuideAction;
  claudeMd: AgentGuideAction;
  /** why a file was skipped or treated specially, in words for the user. */
  notes: string[];
}

const NATIVE_LINES = [
  AGENT_GUIDE_BEGIN,
  '## Version control: Warpline',
  'This project is versioned by Warpline, not git (there is no .git). Warpline is not in your training data; it describes itself at runtime.',
  '- Start with `warpline orient` (where you are and what you can do next), then `warpline status` (what changed, by meaning). Add `--json` for structured output; `warpline --help` lists every command.',
  '- Save work: `warpline fork <you>` → edit → `warpline propose --agent <you> --native -m "<why>"` → `warpline admit <you> --native`.',
  '- If admit refuses with a KNOT, stop and ask the human. Only a human runs `warpline resolve`.',
  '- Never edit `.warpline/` by hand. Diagnose with `warpline health`.',
  AGENT_GUIDE_END,
] as const;

const GIT_LINES = [
  AGENT_GUIDE_BEGIN,
  '## Version control: Warpline',
  'This project uses git plus Warpline, which records the meaning of each change alongside commits. Use git as usual. Start with `warpline orient`; `warpline status` shows what changed by meaning, `warpline mirror status` shows whether the ledger is in step, `warpline health` diagnoses it. Never edit `.warpline/` by hand.',
  AGENT_GUIDE_END,
] as const;

/**
 * The exact block for a mode, markers included, lines joined with `\n` and NO
 * trailing newline. This string is the parity contract with Paradigm.
 */
export function renderAgentGuide(mode: AgentGuideMode): string {
  return (mode === 'git' ? GIT_LINES : NATIVE_LINES).join('\n');
}

/**
 * The content address of the guide text (both modes). F4 rows carry it so a
 * scored arm never pools runs whose subjects were handed different guides
 * (#f4-completion; "cold = what init ships", D2).
 */
export function agentGuideId(): string {
  const h = createHash('sha256').update(renderAgentGuide('native') + '\0' + renderAgentGuide('git'), 'utf8');
  return 'agentGuide:v1:' + h.digest('hex');
}

/**
 * The mode a project is in: `git` when the root is inside a git work tree — a
 * `.git` (directory, or the worktree/submodule FILE) at the root or any ancestor
 * — else `native`. A filesystem walk, not `git rev-parse`: it must answer with git
 * absent and give the same answer on every machine.
 */
export function agentGuideModeOf(root: string): AgentGuideMode {
  let dir = path.resolve(root);
  for (;;) {
    if (fs.existsSync(path.join(dir, '.git'))) return 'git';
    const parent = path.dirname(dir);
    if (parent === dir) return 'native';
    dir = parent;
  }
}

/** Where the one guide block sits in a text, or why the text cannot be edited safely. */
export type AgentGuideScan =
  | { kind: 'none' }
  | { kind: 'one'; start: number; end: number }
  | { kind: 'malformed'; reason: string };

/**
 * Find the block. The SAME rules as Paradigm's scanWarplineBlocks
 * (packages/paradigm/src/core/warpline-detect.ts) — a cross-package test
 * asserts the two agree:
 *   - a marker counts only as a WHOLE LINE, surrounding whitespace and a CR
 *     allowed (the span keeps that whitespace outside the replacement);
 *   - never inside fenced code: a fence opens on 3+ ` or ~ (a ` fence's info
 *     string may not contain `) and closes only on the SAME character, at least
 *     as long, with nothing after it — so a ~~~ example inside a ``` fence stays
 *     an example;
 *   - malformed (leave the file alone): more than one block, a begin inside an
 *     open block, a begin with no end, an end with no begin, or a file that ends
 *     inside an unclosed fence with no block found (appending would land inside
 *     the fence, and again on every run).
 * `end` excludes the end line's trailing whitespace and line break.
 */
export function scanAgentGuide(text: string): AgentGuideScan {
  const blocks: Array<{ start: number; end: number }> = [];
  let problem: string | null = null;
  let fence: { ch: string; len: number } | null = null;
  let open: number | null = null;
  let pos = 0;
  for (const raw of text.split('\n')) {
    const lineStart = pos;
    pos += raw.length + 1;
    const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
    const fm = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (fence) {
      if (fm && fm[1]![0] === fence.ch && fm[1]!.length >= fence.len && fm[2]!.trim() === '') fence = null;
      continue;
    }
    if (fm && !(fm[1]![0] === '`' && fm[2]!.includes('`'))) {
      fence = { ch: fm[1]![0]!, len: fm[1]!.length };
      continue;
    }
    const t = line.trim();
    if (t === AGENT_GUIDE_BEGIN) {
      if (open !== null) problem ??= `has a ${AGENT_GUIDE_BEGIN} line inside an open block`;
      open = lineStart + raw.indexOf(AGENT_GUIDE_BEGIN);
    } else if (t === AGENT_GUIDE_END) {
      if (open === null) problem ??= `has a ${AGENT_GUIDE_END} line with no ${AGENT_GUIDE_BEGIN} before it`;
      else {
        blocks.push({ start: open, end: lineStart + raw.indexOf(AGENT_GUIDE_END) + AGENT_GUIDE_END.length });
        open = null;
      }
    }
  }
  if (open !== null) problem ??= `has ${AGENT_GUIDE_BEGIN} with no ${AGENT_GUIDE_END} line after it`;
  if (problem === null && blocks.length > 1) problem = `has ${blocks.length} warpline blocks`;
  if (problem === null && blocks.length === 0 && fence !== null) {
    problem = `ends inside an unclosed ${fence.ch.repeat(fence.len)} code fence`;
  }
  if (problem !== null) return { kind: 'malformed', reason: problem };
  if (blocks.length === 0) return { kind: 'none' };
  return { kind: 'one', start: blocks[0]!.start, end: blocks[0]!.end };
}

/** Splice `block` into `current`; null (with the reason) when the markers are unsafe. */
function splice(current: string, block: string): { text: string } | { reason: string } {
  const bom = current.startsWith('﻿') ? '﻿' : '';
  const text = current.slice(bom.length);
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const body = eol === '\n' ? block : block.replace(/\n/g, eol);
  const scan = scanAgentGuide(text);
  if (scan.kind === 'malformed') return { reason: scan.reason };
  if (scan.kind === 'one') return { text: bom + text.slice(0, scan.start) + body + text.slice(scan.end) };
  if (text.length === 0) return { text: bom + body + eol };
  const sep = text.endsWith(eol) ? eol : eol + eol;
  return { text: bom + text + sep + body + eol };
}

let tmpCounter = 0;

/** Write via a temp file in the SAME directory + rename, keeping the old file mode. */
function writeAtomic(target: string, data: string, mode?: number): void {
  const tmp = path.join(path.dirname(target), `.${path.basename(target)}.warpline-tmp.${process.pid}.${tmpCounter++}`);
  try {
    fs.writeFileSync(tmp, data, { encoding: 'utf8', ...(mode !== undefined ? { mode } : {}) });
    if (mode !== undefined) fs.chmodSync(tmp, mode);
    fs.renameSync(tmp, target);
  } catch (err) {
    fs.rmSync(tmp, { force: true });
    throw err;
  }
}

function ensureIn(
  file: string,
  block: string,
  createIfAbsent: boolean,
  notes: string[],
  written: Map<string, AgentGuideAction>,
): AgentGuideAction {
  const name = path.basename(file);
  try {
    let st: fs.Stats | null = null;
    try {
      st = fs.statSync(file);
    } catch {
      st = null;
    }
    if (st === null) {
      if (!createIfAbsent) return 'skipped';
      writeAtomic(file, block + '\n');
      written.set(fs.realpathSync(file), 'created');
      return 'created';
    }
    if (!st.isFile()) {
      notes.push(`${name} is not a regular file — left alone`);
      return 'skipped';
    }
    // Through a symlink to the REAL file: renaming over the link would replace it.
    const real = fs.realpathSync(file);
    const already = written.get(real);
    if (already !== undefined) {
      notes.push(`${name} is the same file as one already written — written once`);
      return 'unchanged';
    }
    const current = fs.readFileSync(real, 'utf8');
    const next = splice(current, block);
    if ('reason' in next) {
      notes.push(`${name} ${next.reason} — left alone (fix the markers, then re-run \`warpline init\`)`);
      return 'skipped';
    }
    written.set(real, 'unchanged');
    if (next.text === current) return 'unchanged';
    try {
      fs.accessSync(real, fs.constants.W_OK);
    } catch {
      notes.push(`${name} is not writable — left alone`);
      return 'skipped';
    }
    writeAtomic(real, next.text, st.mode & 0o7777);
    written.set(real, 'updated');
    return 'updated';
  } catch (err) {
    notes.push(`${name} could not be written (${(err as Error).message}) — left alone`);
    return 'skipped';
  }
}

/**
 * Write the agent guide into AGENTS.md (created when absent) and CLAUDE.md (only
 * when it already exists). Idempotent; never touches text outside the markers;
 * never throws for a file it cannot write (that file is `skipped` with a note).
 */
export function ensureAgentGuide(root: string, mode: AgentGuideMode = agentGuideModeOf(root)): AgentGuideResult {
  const block = renderAgentGuide(mode);
  const notes: string[] = [];
  const written = new Map<string, AgentGuideAction>();
  const agentsMd = ensureIn(path.join(root, 'AGENTS.md'), block, true, notes, written);
  const claudeMd = ensureIn(path.join(root, 'CLAUDE.md'), block, false, notes, written);
  return { mode, agentsMd, claudeMd, notes };
}
