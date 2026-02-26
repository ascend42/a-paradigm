/**
 * Task Loader — Task CRUD for .paradigm/tasks/
 *
 * Storage layout:
 *   .paradigm/tasks/
 *     index.yaml
 *     entries/
 *       2026-02-26/
 *         T-2026-02-26-001.yaml
 */

import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';

const TASKS_ROOT = '.paradigm/tasks';
const ENTRIES_DIR = 'entries';
const INDEX_FILE = 'index.yaml';

// ── Types ─────────────────────────────────────────────────

export interface Task {
  id: string;
  blurb: string;
  priority: 'high' | 'medium' | 'low';
  status: 'open' | 'done' | 'shelved';
  tags: string[];
  created: string;
  session_link?: string;
  completed?: string;
  shelved?: string;
  related_lore?: string[];
  related_assessments?: string[];
}

export interface TaskFilter {
  status?: 'open' | 'done' | 'shelved' | 'all';
  priority?: 'high' | 'medium' | 'low';
  tag?: string;
  limit?: number;
}

export interface TaskIndex {
  version: string;
  total: number;
  open: number;
  done: number;
  shelved: number;
  last_updated: string;
}

// ── ID generation ─────────────────────────────────────────

function generateTaskId(rootDir: string, dateStr: string): string {
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

// ── Read operations ───────────────────────────────────────

const PRIORITY_ORDER: Record<string, number> = { high: 0, medium: 1, low: 2 };

function applyFilter(tasks: Task[], filter: TaskFilter): Task[] {
  let result = tasks;

  if (filter.status && filter.status !== 'all') {
    result = result.filter(t => t.status === filter.status);
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
    return new Date(b.created).getTime() - new Date(a.created).getTime();
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
        const task = yaml.load(content) as Task;
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
        return yaml.load(fs.readFileSync(filePath, 'utf8')) as Task;
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
    session_link: task.session_link,
    related_lore: task.related_lore,
  };

  fs.writeFileSync(path.join(datePath, `${id}.yaml`), yaml.dump(entry, { lineWidth: -1, noRefs: true }));
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
  const updated: Task = { ...task, ...safePartial };

  fs.writeFileSync(taskPath, yaml.dump(updated, { lineWidth: -1, noRefs: true }));
  await rebuildTaskIndex(rootDir);
  return true;
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

  let total = 0, open = 0, done = 0, shelved = 0;

  if (fs.existsSync(entriesPath)) {
    const dateDirs = fs.readdirSync(entriesPath).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d));
    for (const dateDir of dateDirs) {
      const dirPath = path.join(entriesPath, dateDir);
      const files = fs.readdirSync(dirPath).filter(f => f.endsWith('.yaml'));
      for (const file of files) {
        try {
          const task = yaml.load(fs.readFileSync(path.join(dirPath, file), 'utf8')) as Task;
          total++;
          if (task.status === 'open') open++;
          else if (task.status === 'done') done++;
          else if (task.status === 'shelved') shelved++;
        } catch {
          // Skip malformed
        }
      }
    }
  }

  const index: TaskIndex = { version: '1.0', total, open, done, shelved, last_updated: new Date().toISOString() };
  fs.mkdirSync(tasksRootPath, { recursive: true });
  fs.writeFileSync(path.join(tasksRootPath, INDEX_FILE), yaml.dump(index, { lineWidth: -1, noRefs: true }));
  return index;
}
