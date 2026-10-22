/**
 * @symbol #loop-act
 * @symbol #loop-runner
 *
 * The propose step (docs/specs/gnomon-loops.md §3.3 effective autonomy, §3.4 protected goal inputs; build plan step
 * 10, G-LOOP-23 card half). After a run with act nodes, its scratch diff (parked at refs/gnomon/loops/<id>/<runId>)
 * becomes ONE `verdict` card in the stack with the diff, the files and the goal check's result. Why it proposes:
 *   - the effective autonomy: `propose` (declared, or act capped to propose by strictness L2), or `act` at L0/L1,
 *     which in 8.0 still proposes: "auto-land lands in step 11";
 *   - land hazards that ALWAYS force propose, whatever the autonomy (G-LOOP-23): the diff touches a protected path
 *     (goal.inputs, the config closure, argv-named paths, node_modules), deletes a tracked file, or adds a
 *     suppression marker (SUPPRESSION_MARKERS) on an added line, or touches an execution surface (EXECUTION_SURFACES:
 *     hooks, CI workflows, editor tasks, .envrc, .gitattributes, .gitmodules, any package.json); a diff too large to
 *     scan counts as a hazard too. The diff is parsed by structure (Aegis M5): header lines only between
 *     `diff --git` and the first `@@`, so an added line `++ x` (shown `+++ x`) is still an added line.
 *   - Paths and diff bytes are shown with control, format and bidi characters escaped visibly (Aegis M3), and every
 *     hazard path is listed in the reasons even when the file list is cut.
 * Accept keeps the commit parked for the land step (step 11); reject drops the parked ref. Model text never reaches
 * the card: its lines are kernel fields, file paths and the diff (repo bytes the loop wrote, shown as data).
 */
import { globToRegExp } from './events.js';
import type { Parked, ScratchChange } from '../git/scratch.js';
import type { EffectiveAutonomy } from './strictness-cap.js';

/** Suppression markers that force propose when a diff ADDS one (§3.4). */
export const SUPPRESSION_MARKERS: readonly RegExp[] = Object.freeze([/@ts-nocheck/, /@ts-ignore/, /eslint-disable/, /\.skip\b/, /\.only\b/, /\bxit\b/]);

/** The card shows at most this many diff lines and files. */
export const PROPOSE_DIFF_LINES = 160;
export const PROPOSE_FILE_LINES = 20;

/** Paths that run code on a checkout, a CI push or an editor open (Aegis L7): always propose. */
export const EXECUTION_SURFACES: readonly RegExp[] = Object.freeze([
  /^\.husky\//, /^\.github\/workflows\//, /^\.vscode\/(tasks|settings)\.json$/, /(^|\/)\.envrc$/, /(^|\/)\.gitattributes$/, /^\.gitmodules$/, /(^|\/)package\.json$/,
]);

/** Control, format (bidi included) and line-separator characters, shown as \u{…} (tab kept). */
export function visible(s: string): string {
  return s.replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, (c) => (c === '\t' ? c : `\\u{${c.codePointAt(0)!.toString(16)}}`));
}

/** The added lines of a git patch, by structure: headers only between `diff --git` and the first `@@`. */
export function addedLines(diff: string): Array<{ path: string | undefined; line: string }> {
  const out: Array<{ path: string | undefined; line: string }> = [];
  let file: string | undefined;
  let header = false;
  for (const line of diff.split('\n')) {
    if (line.startsWith('diff --git ')) {
      header = true;
      file = undefined;
      continue;
    }
    if (header) {
      if (line.startsWith('@@')) header = false;
      else if (line.startsWith('+++ b/')) file = line.slice(6);
      continue;
    }
    if (line.startsWith('+')) out.push({ path: file, line: line.slice(1) });
  }
  return out;
}

export interface LandHazard {
  kind: 'protected-input' | 'tracked-deletion' | 'suppression-marker' | 'execution-surface' | 'diff-unscanned';
  path?: string;
  marker?: string;
}

const isNodeModules = (p: string): boolean => p.split('/').some((c) => c.toLowerCase() === 'node_modules');

/** The land hazards in a parked diff (each one forces propose, G-LOOP-23). */
export function landHazards(parked: Pick<Parked, 'changes' | 'scanDiff' | 'scanComplete'>, protectedGlobs: readonly string[]): LandHazard[] {
  const out: LandHazard[] = [];
  const res = protectedGlobs.map((g) => new RegExp(globToRegExp(g).source, 'i'));
  for (const c of parked.changes) {
    if (isNodeModules(c.path) || res.some((re) => re.test(c.path))) out.push({ kind: 'protected-input', path: c.path });
    if (c.status === 'deleted') out.push({ kind: 'tracked-deletion', path: c.path });
    if (EXECUTION_SURFACES.some((re) => re.test(c.path))) out.push({ kind: 'execution-surface', path: c.path });
  }
  for (const { path: file, line } of addedLines(parked.scanDiff)) {
    for (const re of SUPPRESSION_MARKERS) {
      const m = re.exec(line);
      if (m && !out.some((h) => h.kind === 'suppression-marker' && h.path === file && h.marker === m[0])) out.push({ kind: 'suppression-marker', ...(file ? { path: file } : {}), marker: m[0] });
    }
  }
  if (!parked.scanComplete) out.push({ kind: 'diff-unscanned' });
  return out;
}

/** Why this run proposes instead of landing (8.0 never lands: step 11). */
export function proposeReasons(eff: Pick<EffectiveAutonomy, 'declared' | 'autonomy' | 'level' | 'capReason'>, hazards: readonly LandHazard[]): string[] {
  const out: string[] = [];
  if (eff.autonomy === 'propose') out.push(eff.declared === 'propose' ? 'the loop\'s autonomy is propose' : `strictness ${eff.level} caps act to propose${eff.capReason ? ` (${eff.capReason})` : ''}`);
  else out.push('act at this level would land the change itself: auto-land lands in step 11, so 8.0 proposes it');
  for (const h of hazards) {
    if (h.kind === 'protected-input') out.push(`it touches a protected goal input: ${h.path}`);
    else if (h.kind === 'tracked-deletion') out.push(`it deletes a tracked file: ${h.path}`);
    else if (h.kind === 'suppression-marker') out.push(`it adds a suppression marker ${h.marker}${h.path ? ` in ${h.path}` : ''}`);
    else if (h.kind === 'execution-surface') out.push(`it touches a file that runs code (hooks, CI, editor tasks, scripts): ${h.path}`);
    else out.push('the diff is too large to scan for land hazards');
  }
  return out.map(visible);
}

const STATUS: Record<ScratchChange['status'], string> = { added: 'A', modified: 'M', deleted: 'D' };

export interface ProposeCardInput {
  clampLine: string;
  runId: string;
  ending: string;
  goal: { node: string; verdict: string | null; met: boolean } | null;
  parked: Parked;
  reasons: readonly string[];
}

/** The verdict card's lines: the kernel line first, then kernel fields, files, reasons and the diff (as data). */
export function proposeLines(i: ProposeCardInput): string[] {
  const files = i.parked.changes;
  const lines = [
    i.clampLine,
    `Run ${i.runId} proposes a change to ${files.length} file${files.length === 1 ? '' : 's'} (the run ended ${i.ending})`,
    i.goal ? `Goal check ${i.goal.node}: ${i.goal.verdict ?? 'not run'}${i.goal.met ? ' (goal met)' : ''}` : 'This loop has no goal check',
    ...files.slice(0, PROPOSE_FILE_LINES).map((c) => `${STATUS[c.status]} ${visible(c.path)}`),
    ...(files.length > PROPOSE_FILE_LINES ? [`… and ${files.length - PROPOSE_FILE_LINES} more files`] : []),
    ...i.reasons.map((r) => `Proposed because ${visible(r)}`),
    `Parked at ${i.parked.ref} (${i.parked.sha.slice(0, 12)})`,
    'Accept keeps the commit parked for landing (landing arrives in step 11); reject drops it',
  ];
  const diff = i.parked.diff.split('\n');
  const shown = diff.slice(0, PROPOSE_DIFF_LINES);
  lines.push('Diff:', ...shown.map(visible));
  if (diff.length > shown.length || i.parked.diffTruncated) lines.push(`… the diff continues in the parked commit ${i.parked.sha.slice(0, 12)}`);
  return lines;
}
