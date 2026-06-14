/**
 * Task Loader — Task CRUD for .paradigm/tasks/
 *
 * Storage layout:
 *   .paradigm/tasks/
 *     index.yaml
 *     entries/
 *       2026-02-26/
 *         T-2026-02-26-001.yaml
 *
 * v7 "Spine" (sub-phases 0–1): the Task schema is extended into a claimant-owned
 * DAG. All new fields are OPTIONAL — old YAML loads unchanged. The status machine
 * is enforced by `assertTransition`; `normalizeTask` lazily heals the legacy
 * `session_link` field into `external_ref` on load (files heal on next write).
 *
 * NOTE: the §2 learning wiring (settlement, settledAt write-logic, calibration)
 * is intentionally NOT implemented here. `settledAt` exists as a field only.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { log } from './mcp-logger.js';

const TASKS_ROOT = '.paradigm/tasks';
const ENTRIES_DIR = 'entries';
const INDEX_FILE = 'index.yaml';

// ── Types ─────────────────────────────────────────────────

/** Who owns a task. archetype: role id ("builder"); human: git user/email; peer: Symphony agentId. */
export type ClaimantKind = 'archetype' | 'human' | 'peer';
export interface Claimant {
  kind: ClaimantKind;
  ref: string;
}

/** External anchors for a task (renamed from the orphan `session_link`). */
export type ExternalRefKind = 'github' | 'session' | 'symphony' | 'orchestration' | 'url';
export interface ExternalRef {
  kind: ExternalRefKind;
  ref: string;
}

/**
 * v7.0 LEANER SCOPE: 4 states only. `claimed`/`blocked` are fast-follow
 * (justified only by Symphony peer-claims, which don't exist yet).
 */
export type TaskStatus = 'open' | 'in-progress' | 'done' | 'shelved';

export interface Task {
  id: string; // immutable
  blurb: string;
  priority: 'high' | 'medium' | 'low';
  status: TaskStatus;
  tags: string[];
  created: string; // immutable

  // ── DAG (v7 Spine) ──
  claimant?: Claimant;
  parentTaskId?: string;
  dependsOn?: string[];
  stage?: number;

  // ── Lifecycle stamps ──
  started_at?: string; // stamped on entering 'in-progress'
  completed?: string;
  shelved?: string;
  /** Loid's idempotency stamp (learning settled). Written by §2 settlement. */
  settledAt?: string;
  /**
   * §2 reaper crash markers. `crashed` is an internal settle-state, NOT a
   * TaskStatus value (v7.0 statuses stay `open|in-progress|done|shelved`). The
   * reaper stamps these alongside a real terminal `status:'shelved'` so the node
   * is terminal-in-index AND identifiable as a crash. `isTerminal`/`settledAs`
   * read `crashed_at` to distinguish a reaped crash from a deliberate shelve.
   */
  crashed_at?: string;
  crash_reason?: string;
  /** §2 orphan marker: parentTaskId set but parent failed to load; child self-settled. */
  orphaned?: boolean;

  /**
   * Cid-owned blocking reason (v7 §3 captain board `advance`). v7.0 has no
   * `blocked` status, so a blocked node is recorded as `blocked_on` (the reason)
   * with its live `status` left untouched. Written ONLY by Cid; cleared when the
   * block resolves. Not a status — purely a present-tense annotation Cid owns.
   */
  blocked_on?: string;

  // ── References ──
  external_ref?: ExternalRef; // renamed from orphan session_link
  related_lore?: string[];
  /** @deprecated alias-shimmed to external_ref on load */
  session_link?: string;
  /** @deprecated alias for related_lore — still consumed at tasks.ts:53,135 */
  related_assessments?: string[];
}

/** `'active'` is a meta-status meaning open ∪ in-progress (shelved/done excluded). */
export type TaskFilterStatus = 'open' | 'in-progress' | 'done' | 'shelved' | 'active' | 'all';

export interface TaskFilter {
  status?: TaskFilterStatus;
  priority?: 'high' | 'medium' | 'low';
  tag?: string;
  limit?: number;
}

export interface TaskIndex {
  version: string;
  total: number;
  open: number;
  in_progress: number;
  done: number;
  shelved: number;
  /** Task-ids with no parentTaskId (DAG roots). */
  roots: string[];
  last_updated: string;
}

// ── Normalization (read-side lazy-healing shim) ───────────

/**
 * Heal legacy YAML on load: if `session_link` is present and `external_ref` is
 * not, infer the ref kind and rewrite. Mutates and returns the same object.
 * Files heal lazily — the rewritten value persists on the next `updateTask`.
 */
export function normalizeTask(raw: Task): Task {
  if (raw && raw.session_link && !raw.external_ref) {
    const ref = raw.session_link;
    const lower = ref.toLowerCase();
    let kind: ExternalRefKind;
    if (lower.includes('github')) kind = 'github';
    else if (lower.includes('session')) kind = 'session';
    else kind = 'url';
    raw.external_ref = { kind, ref };
    delete raw.session_link;
  }
  return raw;
}

// ── ID generation ─────────────────────────────────────────

export function generateTaskId(rootDir: string, dateStr: string): string {
  const datePath = path.join(rootDir, TASKS_ROOT, ENTRIES_DIR, dateStr);

  if (!fs.existsSync(datePath)) {
    return `T-${dateStr}-001`;
  }

  const existing = fs.readdirSync(datePath)
    .filter(f => f.startsWith('T-') && f.endsWith('.yaml'))
    .map(f => {
      const match = f.match(/T-\d{4}-\d{2}-\d{2}-(\d+)\.yaml/);
      return match ? parseInt(match[1], 10) : 0;
    });

  const next = existing.length > 0 ? Math.max(...existing) + 1 : 1;
  return `T-${dateStr}-${String(next).padStart(3, '0')}`;
}

// ── Status state-machine ──────────────────────────────────

/**
 * v7.0 (4-state) transition table:
 *   open        → in-progress | done | shelved
 *   in-progress → done | open | shelved
 *   shelved     → open
 *   done        → (terminal)
 *
 * Returns true if the transition is legal. A no-op (from === to) is legal.
 */
export function assertTransition(from: TaskStatus, to: TaskStatus): boolean {
  if (from === to) return true;
  const allowed: Record<TaskStatus, TaskStatus[]> = {
    'open': ['in-progress', 'done', 'shelved'],
    'in-progress': ['done', 'open', 'shelved'],
    'shelved': ['open'],
    'done': [],
  };
  return (allowed[from] ?? []).includes(to);
}

// ── Read operations ───────────────────────────────────────

const PRIORITY_ORDER: Record<string, number> = { high: 0, medium: 1, low: 2 };

const ACTIVE_STATUSES: TaskStatus[] = ['open', 'in-progress'];

function matchesStatus(task: Task, filterStatus: TaskFilterStatus): boolean {
  if (filterStatus === 'all') return true;
  if (filterStatus === 'active') return ACTIVE_STATUSES.includes(task.status);
  return task.status === filterStatus;
}

/**
 * Resolve a task's effective creation timestamp for recency sort. Guards against
 * a missing/malformed `created` by falling back to the date embedded in the
 * `T-YYYY-MM-DD-NNN` id, then to epoch 0.
 */
function createdTime(task: Task): number {
  const t = task.created ? new Date(task.created).getTime() : NaN;
  if (!Number.isNaN(t)) return t;
  const m = task.id?.match(/^T-(\d{4}-\d{2}-\d{2})-/);
  if (m) {
    const fromId = new Date(m[1]).getTime();
    if (!Number.isNaN(fromId)) return fromId;
  }
  return 0;
}

function applyFilter(tasks: Task[], filter: TaskFilter): Task[] {
  let result = tasks;

  if (filter.status && filter.status !== 'all') {
    result = result.filter(t => matchesStatus(t, filter.status!));
  }
  if (filter.priority) {
    result = result.filter(t => t.priority === filter.priority);
  }
  if (filter.tag) {
    result = result.filter(t => t.tags.includes(filter.tag!));
  }

  result.sort((a, b) => {
    const priDiff = (PRIORITY_ORDER[a.priority] ?? 1) - (PRIORITY_ORDER[b.priority] ?? 1);
    if (priDiff !== 0) return priDiff;
    return createdTime(b) - createdTime(a);
  });

  if (filter.limit) {
    result = result.slice(0, filter.limit);
  }

  return result;
}

export async function loadTasks(rootDir: string, filter?: TaskFilter): Promise<Task[]> {
  const entriesPath = path.join(rootDir, TASKS_ROOT, ENTRIES_DIR);
  if (!fs.existsSync(entriesPath)) return [];

  const effectiveFilter: TaskFilter = { status: 'open', limit: 20, ...filter };
  const tasks: Task[] = [];

  const dateDirs = fs.readdirSync(entriesPath)
    .filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d))
    .sort()
    .reverse();

  for (const dateDir of dateDirs) {
    const dirPath = path.join(entriesPath, dateDir);
    const files = fs.readdirSync(dirPath).filter(f => f.endsWith('.yaml')).sort();

    for (const file of files) {
      try {
        const content = fs.readFileSync(path.join(dirPath, file), 'utf8');
        const task = normalizeTask(yaml.load(content) as Task);
        tasks.push(task);
      } catch {
        // Skip malformed files
      }
    }
  }

  return applyFilter(tasks, effectiveFilter);
}

export async function loadTask(rootDir: string, taskId: string): Promise<Task | null> {
  const dateMatch = taskId.match(/^T-(\d{4}-\d{2}-\d{2})-/);
  if (dateMatch) {
    const filePath = path.join(rootDir, TASKS_ROOT, ENTRIES_DIR, dateMatch[1], `${taskId}.yaml`);
    if (fs.existsSync(filePath)) {
      try {
        return normalizeTask(yaml.load(fs.readFileSync(filePath, 'utf8')) as Task);
      } catch {
        return null;
      }
    }
  }

  // Fallback scan
  const tasks = await loadTasks(rootDir, { status: 'all', limit: 9999 });
  return tasks.find(t => t.id === taskId) || null;
}

// ── Write operations ──────────────────────────────────────

export async function createTask(
  rootDir: string,
  task: {
    blurb: string;
    priority?: string;
    tags?: string[];
    session_link?: string;
    related_lore?: string[];
    claimant?: Claimant;
    parentTaskId?: string;
    dependsOn?: string[];
    stage?: number;
    external_ref?: ExternalRef;
  },
): Promise<string> {
  const now = new Date();
  const dateStr = now.toISOString().slice(0, 10);
  const datePath = path.join(rootDir, TASKS_ROOT, ENTRIES_DIR, dateStr);
  fs.mkdirSync(datePath, { recursive: true });

  const id = generateTaskId(rootDir, dateStr);

  const entry: Task = {
    id,
    blurb: task.blurb,
    priority: (task.priority as Task['priority']) || 'medium',
    status: 'open',
    tags: task.tags || [],
    created: now.toISOString(),
    related_lore: task.related_lore,
    claimant: task.claimant,
    parentTaskId: task.parentTaskId,
    dependsOn: task.dependsOn,
    stage: task.stage,
    external_ref: task.external_ref,
    session_link: task.session_link,
  };

  // Heal a legacy session_link into external_ref at creation time too.
  normalizeTask(entry);

  fs.writeFileSync(path.join(datePath, `${id}.yaml`), yaml.dump(pruneUndefined(entry), { lineWidth: -1, noRefs: true }));
  await rebuildTaskIndex(rootDir);
  return id;
}

export async function updateTask(rootDir: string, taskId: string, partial: Partial<Task>): Promise<boolean> {
  const task = await loadTask(rootDir, taskId);
  if (!task) return false;

  const dateStr = task.created.slice(0, 10);
  const taskPath = path.join(rootDir, TASKS_ROOT, ENTRIES_DIR, dateStr, `${taskId}.yaml`);
  if (!fs.existsSync(taskPath)) return false;

  const { id: _id, created: _created, ...safePartial } = partial;

  // Enforce the status state-machine on a status change. An illegal transition
  // returns the same failure shape as not-found (false), it does not throw.
  if (safePartial.status !== undefined && safePartial.status !== task.status) {
    if (!assertTransition(task.status, safePartial.status)) {
      log.component('#task-loader').warn('Illegal task status transition rejected', {
        taskId, from: task.status, to: safePartial.status,
      });
      return false;
    }
    // Stamp started_at when entering in-progress for the first time.
    if (safePartial.status === 'in-progress' && !task.started_at && safePartial.started_at === undefined) {
      safePartial.started_at = new Date().toISOString();
    }
  }

  const updated: Task = { ...task, ...safePartial };

  fs.writeFileSync(taskPath, yaml.dump(pruneUndefined(updated), { lineWidth: -1, noRefs: true }));
  await rebuildTaskIndex(rootDir);

  // §2: settlement trigger. When a task reaches terminal AND has a parent, check
  // whether the parent's whole sibling-set is now terminal and, if so, fire the
  // learning chain (recordWorkLog → runPostflightLearning → autoPromoteJournalEntries).
  // Gated INSIDE updateTask (the real chokepoint) so completeTask, shelveTask, and
  // direct status sets all trigger without drifting. Best-effort: a settlement
  // failure must NEVER break this write — log and continue.
  //
  // Lazy/dynamic import breaks the task-settlement ⇄ task-loader cycle at
  // module-eval time (mirrors the autoPromoteJournalEntries pattern).
  if (isTerminalStatus(updated.status) && updated.parentTaskId) {
    try {
      const { settleParentIfComplete } = await import('./task-settlement.js');
      await settleParentIfComplete(rootDir, updated.parentTaskId, updated.id);
    } catch (err) {
      log.component('#task-loader').warn('Settlement after updateTask failed (non-fatal)', {
        taskId, parentTaskId: updated.parentTaskId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return true;
}

/**
 * §2 terminal predicate for the loader hook gate. v7.0 terminal statuses are
 * `done`/`shelved` (a reaper crash is recorded as `shelved` + `crashed_at`).
 * Kept here as a local mirror so the loader does not statically import
 * task-settlement (which would re-introduce the import cycle).
 */
function isTerminalStatus(status: TaskStatus): boolean {
  return status === 'done' || status === 'shelved';
}

export async function completeTask(rootDir: string, taskId: string): Promise<boolean> {
  return updateTask(rootDir, taskId, { status: 'done', completed: new Date().toISOString() });
}

export async function shelveTask(rootDir: string, taskId: string): Promise<boolean> {
  return updateTask(rootDir, taskId, { status: 'shelved', shelved: new Date().toISOString() });
}

// ── Index ─────────────────────────────────────────────────

export async function rebuildTaskIndex(rootDir: string): Promise<TaskIndex> {
  const entriesPath = path.join(rootDir, TASKS_ROOT, ENTRIES_DIR);
  const tasksRootPath = path.join(rootDir, TASKS_ROOT);

  let total = 0, open = 0, inProgress = 0, done = 0, shelved = 0;
  const roots: string[] = [];

  if (fs.existsSync(entriesPath)) {
    const dateDirs = fs.readdirSync(entriesPath).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d));
    for (const dateDir of dateDirs) {
      const dirPath = path.join(entriesPath, dateDir);
      const files = fs.readdirSync(dirPath).filter(f => f.endsWith('.yaml'));
      for (const file of files) {
        try {
          const task = normalizeTask(yaml.load(fs.readFileSync(path.join(dirPath, file), 'utf8')) as Task);
          total++;
          if (task.status === 'open') open++;
          else if (task.status === 'in-progress') inProgress++;
          else if (task.status === 'done') done++;
          else if (task.status === 'shelved') shelved++;
          if (!task.parentTaskId && task.id) roots.push(task.id);
        } catch {
          // Skip malformed
        }
      }
    }
  }

  const index: TaskIndex = {
    version: '1.1',
    total,
    open,
    in_progress: inProgress,
    done,
    shelved,
    roots,
    last_updated: new Date().toISOString(),
  };
  fs.mkdirSync(tasksRootPath, { recursive: true });
  fs.writeFileSync(path.join(tasksRootPath, INDEX_FILE), yaml.dump(index, { lineWidth: -1, noRefs: true }));
  return index;
}

// ── Helpers ───────────────────────────────────────────────

/** Strip undefined-valued keys so emitted YAML stays clean (old behavior parity). */
function pruneUndefined<T extends Record<string, unknown>>(obj: T): T {
  const out = {} as T;
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) (out as Record<string, unknown>)[k] = v;
  }
  return out;
}
