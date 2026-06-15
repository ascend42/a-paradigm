/**
 * paradigm task — human-facing task CLI (#task-cli)
 *
 * Phase 1 of the task-management expansion (TD-2026-06-13-768). LOCAL-ONLY:
 * a thin facilitation skin over the existing task store (paradigm-mcp's
 * task-loader). No GitHub / sync (that's Phase 2).
 *
 * Architecture: calls the task-loader functions directly via the relative-import
 * precedent (see core/habits/evaluator.ts). The ONE field the CLI adds on top of
 * the store is `claimant: {kind:'human', ref:<git user.email>}` — it powers the
 * `you` column and `--mine`. Everything else is store behavior, unchanged.
 *
 * Output goes through cli-output.ts helpers per CLAUDE.md (never raw console.log).
 */

import { execSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as yaml from 'js-yaml';

import {
  createTask,
  loadTasks,
  loadTask,
  updateTask,
  completeTask,
  shelveTask,
  assertTransition,
  type Task,
  type Claimant,
  type TaskFilterStatus,
} from '../../../../paradigm-mcp/src/utils/task-loader.js';

import { out, success, warn, error, dim, header, kv, json } from '../../utils/cli-output.js';

// ── shared option/helper surface ──────────────────────────

interface CommonOptions {
  project?: string;
  json?: boolean;
}

function resolveRoot(options: CommonOptions): string {
  return options.project ? path.resolve(options.project) : process.cwd();
}

/**
 * The current human's claimant ref — git `user.email`, falling back to the OS
 * username. Stamped on CLI-created tasks and used to render `you` / filter `--mine`.
 */
export function currentHumanRef(): string {
  try {
    const email = execSync('git config user.email', { encoding: 'utf-8', timeout: 3000 }).trim();
    if (email) return email;
  } catch {
    // git not available / not configured
  }
  try {
    const username = os.userInfo().username;
    if (username) return username;
  } catch {
    // userInfo can fail in sandboxed environments
  }
  return 'unknown';
}

function humanClaimant(): Claimant {
  return { kind: 'human', ref: currentHumanRef() };
}

/** The short numeric handle (`004`) used as the visible task reference. */
function shortId(id: string): string {
  const m = id.match(/-(\d+)$/);
  return m ? m[1] : id;
}

const ACTIVE: TaskFilterStatus = 'active';

function isTerminal(t: Task): boolean {
  return t.status === 'done' || t.status === 'shelved';
}

/**
 * Render a task's claimant for the `you` column:
 *   - human whose ref == current git user → `you`
 *   - other human → the ref
 *   - archetype → the role id (the ref IS the role, e.g. "builder")
 *   - peer → the agentId (ref)
 */
function renderClaimant(t: Task, me: string): string {
  if (!t.claimant) return '';
  const { kind, ref } = t.claimant;
  if (kind === 'human') return ref === me ? 'you' : ref;
  return ref;
}

/** A task is blocked if any dependency is non-terminal, or `blocked_on` is set. */
function isBlocked(t: Task, byId: Map<string, Task>): boolean {
  if (t.blocked_on) return true;
  for (const dep of t.dependsOn || []) {
    const d = byId.get(dep);
    if (d && !isTerminal(d)) return true;
  }
  return false;
}

function priorityGlyph(t: Task): string {
  if (t.status === 'in-progress') return '▸';
  if (t.priority === 'low') return '○';
  return '●';
}

function metaSuffix(t: Task): string {
  const tags = (t.tags || []).join(', ');
  const inner = tags ? `${t.priority} · ${tags}` : t.priority;
  return `[${inner}]`;
}

// ── resolveRef ────────────────────────────────────────────

export interface ResolveResult {
  task?: Task;
  /** Set when resolution failed or was ambiguous. The caller prints + exits. */
  errorMessage?: string;
  /** Candidate lines to list on an ambiguous match. */
  candidates?: string[];
}

/**
 * Human-friendly id resolution, shared by every mutating command.
 *
 * Order:
 *   1. `@last`     → most-recent task created by the current human claimant
 *   2. full id     → `T-YYYY-MM-DD-NNN`
 *   3. short suffix → `001` / `4` → the unique ACTIVE task whose id ends `-NNN`
 *                     (ambiguous across dates → list candidates, never guess)
 *   4. fuzzy        → case-insensitive substring over ACTIVE blurbs
 *                     (one → use; many → list; none → error)
 *
 * Never throws; never guesses on ambiguity.
 */
export async function resolveRef(ref: string, rootDir: string): Promise<ResolveResult> {
  const all = await loadTasks(rootDir, { status: 'all', limit: 9999 });

  // 1. @last — most-recent task created by the current human.
  if (ref === '@last') {
    const me = currentHumanRef();
    const mine = all
      .filter(t => t.claimant?.kind === 'human' && t.claimant.ref === me)
      .sort((a, b) => (b.created || '').localeCompare(a.created || ''));
    if (mine.length === 0) {
      return { errorMessage: 'No tasks created by you yet — `@last` has nothing to resolve.' };
    }
    return { task: mine[0] };
  }

  // 2. Full id.
  if (/^T-\d{4}-\d{2}-\d{2}-\d+$/.test(ref)) {
    const exact = all.find(t => t.id === ref);
    if (exact) return { task: exact };
    return { errorMessage: `No task with id ${ref}.` };
  }

  const active = all.filter(t => t.status === 'open' || t.status === 'in-progress');

  // 3. Short numeric suffix → unique ACTIVE task ending in -NNN.
  if (/^\d+$/.test(ref)) {
    const n = parseInt(ref, 10);
    const matches = active.filter(t => {
      const m = t.id.match(/-(\d+)$/);
      return m && parseInt(m[1], 10) === n;
    });
    if (matches.length === 1) return { task: matches[0] };
    if (matches.length > 1) {
      return {
        errorMessage: `Suffix "${ref}" is ambiguous across dates — use a full id:`,
        candidates: matches.map(t => `  ${t.id}  ${t.blurb}`),
      };
    }
    // fall through to fuzzy (a bare number could also be a blurb substring)
  }

  // 4. Fuzzy: case-insensitive substring over ACTIVE blurbs.
  const needle = ref.toLowerCase();
  const fuzzy = active.filter(t => t.blurb.toLowerCase().includes(needle));
  if (fuzzy.length === 1) return { task: fuzzy[0] };
  if (fuzzy.length > 1) {
    return {
      errorMessage: `"${ref}" matches ${fuzzy.length} active tasks — be more specific:`,
      candidates: fuzzy.map(t => `  ${shortId(t.id)}  ${t.blurb}`),
    };
  }
  return { errorMessage: `No active task matches "${ref}".` };
}

/** Resolve-or-exit: prints the error/candidates and exits non-zero on failure. */
async function resolveOrExit(ref: string, rootDir: string): Promise<Task> {
  const res = await resolveRef(ref, rootDir);
  if (!res.task) {
    error(res.errorMessage || `Could not resolve "${ref}".`);
    for (const c of res.candidates || []) out(c);
    process.exit(1);
  }
  return res.task;
}

// ── task add ──────────────────────────────────────────────

interface AddOptions extends CommonOptions {
  priority?: string;
  tag?: string[];
  start?: boolean;
  fromThread?: boolean;
}

export async function taskAddCommand(blurbParts: string[], options: AddOptions): Promise<void> {
  const rootDir = resolveRoot(options);

  if (options.fromThread) {
    await addFromThread(rootDir, options);
    return;
  }

  const blurb = blurbParts.join(' ').trim();
  if (!blurb) {
    error('Nothing to add — provide a blurb: `paradigm task add fix the parser`');
    process.exit(1);
  }

  const priority = normalizePriority(options.priority);
  const tags = options.tag || [];

  const id = await createTask(rootDir, {
    blurb,
    priority,
    tags,
    claimant: humanClaimant(),
  });

  if (options.start) {
    await updateTask(rootDir, id, { status: 'in-progress' });
  }

  if (options.json) {
    json({ id });
    return;
  }

  // First line is the greppable id.
  success(`${id}  added`);
  dim(`${blurb}  ${metaSuffix({ blurb, priority, tags, status: 'open' } as Task)}`);
  if (options.start) dim('→ in-progress');
}

function normalizePriority(p?: string): 'high' | 'medium' | 'low' {
  if (p === 'high' || p === 'low') return p;
  return 'medium';
}

/**
 * `task add --from-thread` — drain thread looseEnds into real tasks. EXPLICIT
 * and human-driven: we print the loose ends, create one task per line (claimant
 * human, tag `from-thread`), and never auto-clear thread.md (auto-absorb = spam).
 */
async function addFromThread(rootDir: string, options: AddOptions): Promise<void> {
  const fs = await import('fs');
  const { parseThread } = await import('../thread.js');

  const threadPath = path.join(rootDir, '.paradigm', 'thread.md');
  if (!fs.existsSync(threadPath)) {
    warn('No thread.md found — nothing to import.');
    return;
  }
  const data = parseThread(fs.readFileSync(threadPath, 'utf8'));
  const ends = data.looseEnds || [];
  if (ends.length === 0) {
    out('No loose ends in thread.md.');
    return;
  }

  const created: { id: string; blurb: string }[] = [];
  for (const line of ends) {
    const id = await createTask(rootDir, {
      blurb: line,
      priority: 'medium',
      tags: ['from-thread'],
      claimant: humanClaimant(),
    });
    created.push({ id, blurb: line });
  }

  if (options.json) {
    json({ created: created.map(c => c.id) });
    return;
  }

  header(`Imported ${created.length} loose end${created.length === 1 ? '' : 's'} as tasks`);
  for (const c of created) {
    success(`${c.id}  ${c.blurb}`);
  }
  dim('Thread.md was NOT cleared. Run `paradigm thread clear` once you have verified these.');
}

// ── task ls ───────────────────────────────────────────────

interface LsOptions extends CommonOptions {
  priority?: string;
  tag?: string;
  limit?: string;
  mine?: boolean;
  board?: boolean;
}

const LS_STATUS_MAP: Record<string, TaskFilterStatus> = {
  active: 'active',
  open: 'open',
  done: 'done',
  shelved: 'shelved',
  all: 'all',
};

export async function taskLsCommand(statusArg: string | undefined, options: LsOptions): Promise<void> {
  const rootDir = resolveRoot(options);

  if (options.board) {
    await renderBoard(rootDir, options);
    return;
  }

  const status = LS_STATUS_MAP[statusArg || 'active'];
  if (!status) {
    error(`Unknown status "${statusArg}" — use active | open | done | shelved | all.`);
    process.exit(1);
  }

  const limit = options.limit ? parseInt(options.limit, 10) : 20;
  const me = currentHumanRef();

  let tasks = await loadTasks(rootDir, {
    status,
    priority: options.priority as Task['priority'] | undefined,
    tag: options.tag,
    limit: 9999,
  });

  if (options.mine) {
    tasks = tasks.filter(t => t.claimant?.kind === 'human' && t.claimant.ref === me);
  }

  // byId map for blocked detection (over the full active set, pre-limit).
  const byId = new Map<string, Task>();
  const allForDeps = await loadTasks(rootDir, { status: 'all', limit: 9999 });
  for (const t of allForDeps) byId.set(t.id, t);

  tasks = tasks.slice(0, limit);

  if (options.json) {
    json(tasks);
    return;
  }

  if (tasks.length === 0) {
    dim('No tasks.');
    return;
  }

  // Default (active) view groups by status: IN PROGRESS then OPEN.
  if (status === 'active') {
    const inProgress = tasks.filter(t => t.status === 'in-progress');
    const open = tasks.filter(t => t.status === 'open');
    if (inProgress.length > 0) {
      header('IN PROGRESS');
      for (const t of inProgress) out(renderRow(t, me, byId));
    }
    if (open.length > 0) {
      header('OPEN');
      for (const t of open) out(renderRow(t, me, byId));
    }
    return;
  }

  header(status.toUpperCase());
  for (const t of tasks) out(renderRow(t, me, byId));
}

function renderRow(t: Task, me: string, byId: Map<string, Task>): string {
  const glyph = priorityGlyph(t);
  const handle = shortId(t.id).padStart(3, ' ');
  const claim = renderClaimant(t, me);
  const claimCol = claim ? `  (${claim})` : '';
  const blocked = isBlocked(t, byId) ? '  ⛔ blocked' : '';
  return `  ${glyph} ${handle}  ${t.blurb}${claimCol}  ${metaSuffix(t)}${blocked}`;
}

/**
 * `--board` → the rich run-DAG view. Reuse assembleCaptainBoard rather than
 * re-deriving the DAG. Plain `ls` stays cheap (no symbol-graph load).
 */
async function renderBoard(rootDir: string, options: LsOptions): Promise<void> {
  const { assembleCaptainBoard } = await import('../../../../paradigm-mcp/src/tools/captain.js');
  const board = await assembleCaptainBoard(rootDir, { proposeClaimants: true });

  if (options.json) {
    json(board);
    return;
  }

  const me = currentHumanRef();

  header(`BOARD — ${board.summary.runs} run(s), ${board.summary.open} open, ${board.summary.inFlight} in flight, ${board.summary.unclaimed} unclaimed`);

  for (const run of board.runs) {
    header(`▶ ${run.blurb}  [${run.runStatus}]`);
    for (const node of run.nodes) {
      const stage = node.stage !== undefined ? `s${node.stage} ` : '';
      const claim = node.claimant ? `  (${node.claimant.kind === 'human' && node.claimant.ref === me ? 'you' : node.claimant.ref})` : '';
      const fragile = node.fragileSymbols.length > 0 ? `  ⚠ ${node.fragileSymbols.join(', ')}` : '';
      out(`  ${stage}${shortId(node.taskId)}  ${node.blurb}  [${node.status}]${claim}${fragile}`);
    }
  }

  if (board.unclaimed.length > 0) {
    header('UNCLAIMED');
    for (const u of board.unclaimed) {
      const proposed = u.proposedClaimant ? `  → ${u.proposedClaimant.ref}?` : '';
      out(`  ${shortId(u.taskId)}  ${u.blurb}  [${u.priority}]${proposed}`);
    }
  }
}

// ── task start / done / shelve ────────────────────────────

/**
 * Best-effort OUTBOUND GitHub projection of a CLI transition (two-way sync,
 * Phase 2b). Linked tasks only; no provider/offline ⇒ silent no-op. Never throws
 * — the canonical local write already happened.
 */
async function fireSyncCli(rootDir: string, taskId: string, event: 'start' | 'done' | 'shelved' | 'reopen', reason?: string): Promise<void> {
  try {
    const { projectTransition } = await import('../../../../paradigm-mcp/src/sync/sync-layer.js');
    await projectTransition(rootDir, taskId, event, { reason });
  } catch {
    /* best-effort */
  }
}

export async function taskStartCommand(ref: string, options: CommonOptions): Promise<void> {
  const rootDir = resolveRoot(options);
  const task = await resolveOrExit(ref, rootDir);

  if (!assertTransition(task.status, 'in-progress')) {
    error(`Cannot start ${shortId(task.id)} — it is ${task.status}.`);
    process.exit(1);
  }

  await updateTask(rootDir, task.id, { status: 'in-progress' });
  await fireSyncCli(rootDir, task.id, 'start');
  if (options.json) { json({ id: task.id, status: 'in-progress' }); return; }
  success(`${shortId(task.id)}  → in-progress`);
  dim(task.blurb);
}

interface DoneOptions extends CommonOptions {
  ripple?: boolean;
}

export async function taskDoneCommand(ref: string, options: DoneOptions): Promise<void> {
  const rootDir = resolveRoot(options);
  const task = await resolveOrExit(ref, rootDir);

  if (!assertTransition(task.status, 'done')) {
    error(`Cannot complete ${shortId(task.id)} — it is ${task.status}.`);
    process.exit(1);
  }

  // completeTask closes the learning loop from the terminal (settlement fires
  // inside updateTask when the task has a parent).
  await completeTask(rootDir, task.id);
  // Outbound: a done task closes its linked GitHub issue (completed).
  await fireSyncCli(rootDir, task.id, 'done');

  // Best-effort ripple over any symbol tags (#component / #flow / …). Closing a
  // symbol-bound task surfaces what else just got fragile. Commander defaults
  // boolean options to true; `--no-ripple` flips it false. Ripple NEVER blocks
  // or fails the close.
  let rippleSummary: string[] = [];
  if (options.ripple !== false) {
    rippleSummary = await rippleForTask(task, rootDir);
  }

  if (options.json) {
    json({ id: task.id, status: 'done', ...(rippleSummary.length ? { ripple: rippleSummary } : {}) });
    return;
  }
  success(`${shortId(task.id)}  ✓ done`);
  dim(task.blurb);
  if (rippleSummary.length > 0) {
    dim(`↯ touches: ${rippleSummary.join(', ')}`);
  }
  if (task.related_lore && task.related_lore.length > 0) {
    dim(`lore: ${task.related_lore.join(', ')}`);
  }
}

/**
 * Best-effort blast-radius for a closed task's symbol tags. Reuses the same
 * premise-core aggregation the `paradigm ripple` command uses — but stays terse
 * (a flat de-duped list of directly-dependent symbols), and NEVER throws: a
 * failure (no symbols, no index, aggregation error) returns []. The `done`
 * always completes cleanly regardless.
 *
 * "Symbol tags" are tags that look like symbols (start with #/$/^/!/~). Most
 * tasks tag a `#component`; we ripple each and union the direct dependents.
 */
async function rippleForTask(task: Task, rootDir: string): Promise<string[]> {
  const symbolTags = (task.tags || []).filter(t => /^[#$^!~]/.test(t));
  if (symbolTags.length === 0) return [];

  try {
    const { aggregateFromDirectory, buildSymbolIndex, getSymbol } = await import('@a-company/premise-core');
    const result = await aggregateFromDirectory(rootDir);
    const index = buildSymbolIndex(result);

    const touched = new Set<string>();
    for (const sym of symbolTags) {
      const entry = getSymbol(index, sym);
      if (!entry) continue;
      for (const dep of entry.referencedBy || []) touched.add(dep);
    }
    return Array.from(touched).sort();
  } catch {
    // Best-effort: any failure ⇒ no ripple line, done still succeeds.
    return [];
  }
}

export async function taskShelveCommand(ref: string, options: CommonOptions): Promise<void> {
  const rootDir = resolveRoot(options);
  const task = await resolveOrExit(ref, rootDir);

  if (!assertTransition(task.status, 'shelved')) {
    error(`Cannot shelve ${shortId(task.id)} — it is ${task.status}.`);
    process.exit(1);
  }

  await shelveTask(rootDir, task.id);
  await fireSyncCli(rootDir, task.id, 'shelved');
  if (options.json) { json({ id: task.id, status: 'shelved' }); return; }
  success(`${shortId(task.id)}  shelved`);
  dim(task.blurb);
}

// ── task sync (Phase 2b two-way) ──────────────────────────

interface SyncOptions extends CommonOptions {}

/**
 * `task sync [<ref>]` — INBOUND two-way pull. Reconciles linked GitHub issues
 * back into the local store through the enforced writers (a pull never bypasses
 * the state machine). No ref = sweep all linked tasks. Prints a per-task verdict.
 */
export async function taskSyncCommand(ref: string | undefined, options: SyncOptions): Promise<void> {
  const rootDir = resolveRoot(options);
  const { syncTask, syncAllLinked } = await import('../../../../paradigm-mcp/src/sync/sync-layer.js');

  const verdicts = ref
    ? [await syncTask(rootDir, (await resolveOrExit(ref, rootDir)).id)]
    : await syncAllLinked(rootDir);

  if (options.json) { json({ verdicts }); return; }

  if (verdicts.length === 0) {
    dim('No GitHub-linked tasks to sync.');
    return;
  }
  const synced = verdicts.filter(v => v.status === 'synced');
  const conflicts = verdicts.filter(v => v.status === 'conflict');
  for (const v of synced) success(`${shortId(v.taskId)}  synced${v.targetStatus ? ` → ${v.targetStatus}` : ''}`);
  for (const v of conflicts) {
    warn(`${shortId(v.taskId)}  conflict (local wins)`);
    for (const d of v.drift) dim(`  ${d}`);
  }
  const skipped = verdicts.filter(v => ['offline', 'remote-error', 'unlinked', 'no-pull'].includes(v.status));
  if (skipped.some(v => v.status === 'offline')) dim('GitHub unavailable for some tasks — `gh auth login` to enable.');
  out('');
  dim(`${synced.length} synced · ${conflicts.length} conflict · ${verdicts.filter(v => v.status === 'agree').length} unchanged · ${skipped.length} skipped`);
}

// ── task show ─────────────────────────────────────────────

export async function taskShowCommand(ref: string, options: CommonOptions): Promise<void> {
  const rootDir = resolveRoot(options);
  const task = await resolveOrExit(ref, rootDir);

  if (options.json) { json(task); return; }

  header(task.id);
  kv('blurb', task.blurb);
  kv('status', task.status);
  kv('priority', task.priority);
  if (task.tags && task.tags.length > 0) kv('tags', task.tags.join(', '));
  if (task.claimant) kv('claimant', `${task.claimant.kind}:${task.claimant.ref}`);
  kv('created', task.created);
  if (task.started_at) kv('started', task.started_at);
  if (task.completed) kv('completed', task.completed);
  if (task.shelved) kv('shelved', task.shelved);
  if (task.parentTaskId) kv('parent', task.parentTaskId);
  if (task.dependsOn && task.dependsOn.length > 0) kv('depends', task.dependsOn.join(', '));
  if (task.blocked_on) kv('blocked_on', task.blocked_on);
  if (task.related_lore && task.related_lore.length > 0) kv('lore', task.related_lore.join(', '));
  if (task.external_ref) {
    const ext = task.external_ref;
    kv('external', `${ext.provider}:${ext.ref}${ext.url ? ` (${ext.url})` : ''}`);
  }
}

// ── task edit ─────────────────────────────────────────────

interface EditOptions extends CommonOptions {
  blurb?: string;
  priority?: string;
  tag?: string[];
  addTag?: string[];
  reopen?: boolean;
}

export async function taskEditCommand(ref: string, options: EditOptions): Promise<void> {
  const rootDir = resolveRoot(options);
  const task = await resolveOrExit(ref, rootDir);

  const partial: Partial<Task> = {};
  const changed: string[] = [];

  if (options.blurb !== undefined) {
    partial.blurb = options.blurb;
    changed.push(`blurb → "${options.blurb}"`);
  }
  if (options.priority !== undefined) {
    partial.priority = normalizePriority(options.priority);
    changed.push(`priority → ${partial.priority}`);
  }
  if (options.tag !== undefined) {
    // -t/--tag replaces tags wholesale.
    partial.tags = options.tag;
    changed.push(`tags → [${partial.tags.join(', ')}]`);
  }
  if (options.addTag !== undefined && options.addTag.length > 0) {
    const base = partial.tags ?? task.tags ?? [];
    const merged = Array.from(new Set([...base, ...options.addTag]));
    partial.tags = merged;
    changed.push(`+tags [${options.addTag.join(', ')}]`);
  }
  if (options.reopen) {
    if (!assertTransition(task.status, 'open')) {
      error(`Cannot reopen ${shortId(task.id)} — it is ${task.status}.`);
      process.exit(1);
    }
    partial.status = 'open';
    changed.push('status → open');
  }

  if (changed.length === 0) {
    warn('Nothing to edit — pass -b/-p/-t/--add-tag/--reopen.');
    return;
  }

  const ok = await updateTask(rootDir, task.id, partial);
  if (!ok) {
    error(`Edit rejected for ${shortId(task.id)} (illegal transition or task not found).`);
    process.exit(1);
  }

  // Outbound: a reopen (→ open) reopens the linked GitHub issue (symmetric sync).
  if (options.reopen) await fireSyncCli(rootDir, task.id, 'reopen');

  if (options.json) { json({ id: task.id, changed }); return; }
  success(`${shortId(task.id)}  edited`);
  for (const c of changed) dim(`  ${c}`);
}

// ── sync: link / push (Phase 2a — TD-2026-06-13-768) ──────────
//
// LOCAL-FIRST overlay. `link` is a pure local write (no network). `push`
// resolves a provider from config/--provider; with no/unavailable provider it
// prints a hint and leaves the task UNTOUCHED. A provider failure is best-effort
// and never corrupts the local task.

interface LinkOptions extends CommonOptions {
  provider?: string;
}

/**
 * Infer the provider id from a url/ref when `--provider` is not given. Only
 * github is recognized at Phase 2a; anything else falls back to a generic 'url'
 * anchor (a valid inert external_ref with no registered provider).
 */
function inferProvider(urlOrRef: string): string {
  const lower = urlOrRef.toLowerCase();
  if (lower.includes('github.com') || /^[^/\s]+\/[^/#\s]+#\d+$/.test(urlOrRef)) return 'github';
  if (lower.startsWith('http://') || lower.startsWith('https://')) return 'url';
  return 'url';
}

/** `task link <ref> <url-or-id>` — record an external_ref locally. No network. */
export async function taskLinkCommand(ref: string, urlOrId: string, options: LinkOptions): Promise<void> {
  const rootDir = resolveRoot(options);
  const task = await resolveOrExit(ref, rootDir);

  const provider = options.provider || inferProvider(urlOrId);
  const isUrl = /^https?:\/\//i.test(urlOrId);
  const external_ref = {
    provider,
    ref: urlOrId,
    ...(isUrl ? { url: urlOrId } : {}),
  };

  const ok = await updateTask(rootDir, task.id, { external_ref });
  if (!ok) {
    error(`Link rejected for ${shortId(task.id)} (task not found).`);
    process.exit(1);
  }

  if (options.json) { json({ id: task.id, external_ref }); return; }
  success(`${shortId(task.id)}  linked`);
  dim(`${provider}: ${urlOrId}`);
}

interface PushOptions extends CommonOptions {
  provider?: string;
  repo?: string;
}

/**
 * Read the optional `sync:` block from .paradigm/config.yaml. Absent ⇒
 * local-only. Shape: `sync: { provider: github, github: { repo: owner/repo } }`.
 * A missing/malformed config is swallowed (returns {}) — config is opt-in.
 */
function readSyncConfig(rootDir: string): { provider?: string; repo?: string } {
  try {
    const cfgPath = path.join(rootDir, '.paradigm', 'config.yaml');
    if (!fs.existsSync(cfgPath)) return {};
    const cfg = yaml.load(fs.readFileSync(cfgPath, 'utf8')) as { sync?: { provider?: string; github?: { repo?: string } } } | undefined;
    const sync = cfg?.sync;
    if (!sync) return {};
    return { provider: sync.provider, repo: sync.github?.repo };
  } catch {
    return {};
  }
}

/**
 * `task push <ref> [--repo owner/repo]` — create an external item for a task and
 * record the returned anchor. Local-first: no/unavailable provider ⇒ a clear
 * hint and the task is left untouched. A provider throw never corrupts local.
 */
export async function taskPushCommand(ref: string, options: PushOptions): Promise<void> {
  const rootDir = resolveRoot(options);
  const task = await resolveOrExit(ref, rootDir);

  const cfg = readSyncConfig(rootDir);
  const providerId = options.provider || cfg.provider;

  if (!providerId) {
    warn('No sync provider configured — task left local-only.');
    dim('Add a `sync:` block to .paradigm/config.yaml (e.g. provider: github, github: { repo: owner/repo }) or pass --provider.');
    return;
  }

  // Resolve via the registry. Import the github provider module for its
  // self-registration side-effect (the CLI may opt into a concrete provider;
  // the core task-loader never does).
  const { getProvider } = await import('../../../../paradigm-mcp/src/sync/registry.js');
  if (providerId === 'github') {
    await import('../../../../paradigm-mcp/src/sync/providers/github.js');
  }
  const provider = getProvider(providerId);

  if (!provider) {
    warn(`No provider registered for "${providerId}" — task left local-only.`);
    dim('Known provider at this phase: github.');
    return;
  }

  // Honor --repo / config repo by re-instantiating github with the repo set.
  let effectiveProvider = provider;
  const repo = options.repo || cfg.repo;
  if (providerId === 'github' && repo) {
    const { GithubProvider } = await import('../../../../paradigm-mcp/src/sync/providers/github.js');
    effectiveProvider = new GithubProvider({ repo });
  }

  let available = false;
  try {
    available = await effectiveProvider.isAvailable();
  } catch {
    available = false;
  }
  if (!available) {
    warn(`${providerId} is not available — task left local-only.`);
    if (providerId === 'github') dim('Authenticate with `gh auth login`, then retry.');
    return;
  }

  try {
    const result = await effectiveProvider.push(task);
    const external_ref = {
      provider: providerId,
      ref: result.ref,
      ...(result.url ? { url: result.url } : {}),
      syncedAt: new Date().toISOString(),
    };
    await updateTask(rootDir, task.id, { external_ref });

    if (options.json) { json({ id: task.id, external_ref }); return; }
    success(`${shortId(task.id)}  pushed → ${result.ref}`);
    if (result.url) dim(result.url);
  } catch (err) {
    // Best-effort: a provider failure NEVER corrupts the local task.
    error(`Push to ${providerId} failed — task left untouched locally.`);
    dim(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  }
}

// ── task sync-commit (Phase 2b — TD-2026-06-13-768) ───────────
//
// Driven by the post-commit hook: when a commit's `Symbols:` trailer touches a
// symbol bound to a linked external item, drop a one-line "touched" comment on
// that item — PROVIDER-AGNOSTICALLY (the hook never names a provider; it calls
// this command, which resolves the provider from the registry by the linked
// task's `external_ref.provider`).
//
// HARD TENET: ENTIRELY best-effort. A commit is sacred. No linked task, no
// registered/comment-capable provider, un-authed, or ANY throw ⇒ silent
// success. This command MUST exit 0 always and NEVER print to stderr/block.

interface SyncCommitOptions extends CommonOptions {
  hash?: string;
  symbols?: string;
}

/** Split a `Symbols:` trailer CSV into a clean set (drops empties/whitespace). */
function parseSymbolCsv(csv: string | undefined): Set<string> {
  const out = new Set<string>();
  for (const raw of (csv || '').split(',')) {
    const s = raw.trim();
    if (s) out.add(s);
  }
  return out;
}

/**
 * `task sync-commit --hash <sha> --symbols <csv>` — comment on every linked,
 * comment-capable external item whose task's symbol tags intersect the touched
 * symbols. Best-effort end to end: it swallows everything and always resolves.
 */
export async function taskSyncCommitCommand(options: SyncCommitOptions): Promise<void> {
  try {
    const rootDir = resolveRoot(options);
    const touched = parseSymbolCsv(options.symbols);
    if (touched.size === 0) return; // nothing to match against — clean no-op

    const all = await loadTasks(rootDir, { status: 'all', limit: 9999 });

    // Candidate tasks: have a symbol tag intersecting the trailer AND a linked
    // external_ref. We resolve providers lazily and only for providers we see.
    const candidates = all.filter(t => {
      if (!t.external_ref?.provider) return false;
      return (t.tags || []).some(tag => touched.has(tag));
    });
    if (candidates.length === 0) return;

    const { getProvider } = await import('../../../../paradigm-mcp/src/sync/registry.js');

    // Opt into concrete providers we encounter (registry self-registration is a
    // module side-effect; the core never imports concrete providers). github is
    // the only implemented provider at this phase.
    const providersSeen = new Set(candidates.map(t => t.external_ref!.provider));
    if (providersSeen.has('github')) {
      await import('../../../../paradigm-mcp/src/sync/providers/github.js');
    }

    const shortSha = (options.hash || '').slice(0, 7) || '(unknown)';
    const symbolList = Array.from(touched).join(', ');
    const message = `Commit ${shortSha}: touched ${symbolList}`;

    for (const task of candidates) {
      const ref = task.external_ref!;
      try {
        const provider = getProvider(ref.provider);
        if (!provider) continue; // unregistered ⇒ local-only, skip silently
        if (!provider.capabilities().comment) continue; // not comment-capable
        await provider.comment(ref, message);
      } catch {
        // One item's failure never affects the others or the exit code.
      }
    }
  } catch {
    // Absolute best-effort: ANY failure ⇒ silent success.
  }
  // Always succeeds. No output: the hook redirects, and a commit is sacred.
}
