/**
 * Tests for the human-facing `paradigm task` CLI (#task-cli).
 *
 * Covers: `add` (creates with a human claimant + prints the id), `resolveRef`
 * (@last / short suffix / fuzzy / ambiguous→exit), `ls` (default=active grouped
 * + `--mine` filter), `done` (→ completeTask), and an illegal transition
 * surfacing as error()-then-exit rather than a throw.
 *
 * All over real temp dirs against the real task-loader store.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import {
  createTask,
  loadTask,
  loadTasks,
  type Claimant,
} from '../../../../paradigm-mcp/src/utils/task-loader.js';

import {
  resolveRef,
  currentHumanRef,
  taskAddCommand,
  taskLsCommand,
  taskDoneCommand,
  taskStartCommand,
} from './index.js';

let root: string;
const HUMAN = (): Claimant => ({ kind: 'human', ref: currentHumanRef() });

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'task-cli-test-'));
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
  vi.restoreAllMocks();
});

/** Capture stdout writes during fn. */
async function capture(fn: () => Promise<void>): Promise<string> {
  const lines: string[] = [];
  const spy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk: any) => {
    lines.push(String(chunk));
    return true;
  });
  await fn();
  spy.mockRestore();
  return lines.join('');
}

// ── task add ──────────────────────────────────────────────

describe('taskAddCommand', () => {
  it('creates a task with a human claimant', async () => {
    await capture(() => taskAddCommand(['fix', 'the', 'parser'], { project: root }));
    const tasks = await loadTasks(root, { status: 'all', limit: 99 });
    expect(tasks).toHaveLength(1);
    expect(tasks[0].blurb).toBe('fix the parser');
    expect(tasks[0].claimant?.kind).toBe('human');
    expect(tasks[0].claimant?.ref).toBe(currentHumanRef());
  });

  it('prints the new id on the first line (greppable)', async () => {
    const output = await capture(() => taskAddCommand(['capture', 'me'], { project: root }));
    const firstLine = output.split('\n')[0];
    expect(firstLine).toMatch(/T-\d{4}-\d{2}-\d{2}-\d{3}/);
    expect(firstLine).toContain('added');
  });

  it('--json emits {id}', async () => {
    const output = await capture(() => taskAddCommand(['json', 'task'], { project: root, json: true }));
    const parsed = JSON.parse(output);
    expect(parsed.id).toMatch(/^T-/);
  });

  it('--start moves the new task to in-progress', async () => {
    await capture(() => taskAddCommand(['start', 'me'], { project: root, start: true }));
    const tasks = await loadTasks(root, { status: 'all', limit: 99 });
    expect(tasks[0].status).toBe('in-progress');
  });
});

// ── resolveRef ────────────────────────────────────────────

describe('resolveRef', () => {
  it('@last resolves the most-recent human-created task', async () => {
    await createTask(root, { blurb: 'first', claimant: HUMAN() });
    await new Promise(r => setTimeout(r, 5));
    const secondId = await createTask(root, { blurb: 'second', claimant: HUMAN() });
    const res = await resolveRef('@last', root);
    expect(res.task?.id).toBe(secondId);
  });

  it('resolves a full id', async () => {
    const id = await createTask(root, { blurb: 'full id task', claimant: HUMAN() });
    const res = await resolveRef(id, root);
    expect(res.task?.id).toBe(id);
  });

  it('resolves a short numeric suffix to the unique active task', async () => {
    const id = await createTask(root, { blurb: 'suffix task', claimant: HUMAN() });
    const suffix = id.match(/-(\d+)$/)![1];
    const res = await resolveRef(String(parseInt(suffix, 10)), root);
    expect(res.task?.id).toBe(id);
  });

  it('fuzzy-matches a unique active blurb', async () => {
    const id = await createTask(root, { blurb: 'refactor the widget loader', claimant: HUMAN() });
    const res = await resolveRef('widget', root);
    expect(res.task?.id).toBe(id);
  });

  it('returns an error (no throw) on an ambiguous fuzzy match', async () => {
    await createTask(root, { blurb: 'fix login bug', claimant: HUMAN() });
    await createTask(root, { blurb: 'fix logout bug', claimant: HUMAN() });
    const res = await resolveRef('fix', root);
    expect(res.task).toBeUndefined();
    expect(res.errorMessage).toBeTruthy();
    expect(res.candidates?.length).toBe(2);
  });

  it('returns an error when nothing matches', async () => {
    const res = await resolveRef('nonexistent', root);
    expect(res.task).toBeUndefined();
    expect(res.errorMessage).toBeTruthy();
  });
});

// ── task ls ───────────────────────────────────────────────

describe('taskLsCommand', () => {
  it('default view shows active tasks grouped by status', async () => {
    const openId = await createTask(root, { blurb: 'an open task', claimant: HUMAN() });
    const inProgId = await createTask(root, { blurb: 'a working task', claimant: HUMAN() });
    const { updateTask, completeTask } = await import('../../../../paradigm-mcp/src/utils/task-loader.js');
    await updateTask(root, inProgId, { status: 'in-progress' });
    const doneId = await createTask(root, { blurb: 'a finished task', claimant: HUMAN() });
    await completeTask(root, doneId);

    const output = await capture(() => taskLsCommand(undefined, { project: root }));
    expect(output).toContain('IN PROGRESS');
    expect(output).toContain('OPEN');
    expect(output).toContain('a working task');
    expect(output).toContain('an open task');
    // 'done' tasks are excluded from the active default view.
    expect(output).not.toContain('a finished task');
    expect(openId).toBeTruthy();
  });

  it('--mine filters to the current human claimant', async () => {
    await createTask(root, { blurb: 'mine', claimant: HUMAN() });
    await createTask(root, { blurb: 'someone elses', claimant: { kind: 'human', ref: 'other@example.com' } });
    await createTask(root, { blurb: 'an archetype task', claimant: { kind: 'archetype', ref: 'builder' } });

    const output = await capture(() => taskLsCommand(undefined, { project: root, mine: true }));
    expect(output).toContain('mine');
    expect(output).not.toContain('someone elses');
    expect(output).not.toContain('an archetype task');
  });

  it('renders the current human claimant as "you"', async () => {
    await createTask(root, { blurb: 'belongs to me', claimant: HUMAN() });
    const output = await capture(() => taskLsCommand(undefined, { project: root }));
    expect(output).toContain('(you)');
  });

  it('--json emits the raw task array', async () => {
    await createTask(root, { blurb: 'json me', claimant: HUMAN() });
    const output = await capture(() => taskLsCommand(undefined, { project: root, json: true }));
    const parsed = JSON.parse(output);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed[0].blurb).toBe('json me');
  });
});

// ── task done ─────────────────────────────────────────────

describe('taskDoneCommand', () => {
  it('completes a task via completeTask', async () => {
    const id = await createTask(root, { blurb: 'finish me', claimant: HUMAN() });
    await capture(() => taskDoneCommand(id, { project: root }));
    const task = await loadTask(root, id);
    expect(task?.status).toBe('done');
    expect(task?.completed).toBeTruthy();
  });
});

// ── illegal transition → error, not throw ─────────────────

describe('illegal transitions surface as error + exit (no throw)', () => {
  it('start on a done task exits non-zero instead of throwing', async () => {
    const id = await createTask(root, { blurb: 'already done', claimant: HUMAN() });
    const { completeTask } = await import('../../../../paradigm-mcp/src/utils/task-loader.js');
    await completeTask(root, id);

    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((): never => {
      throw new Error('__exit__');
    }) as never);
    const errSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    await expect(taskStartCommand(id, { project: root })).rejects.toThrow('__exit__');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(errSpy).toHaveBeenCalled();
  });
});
