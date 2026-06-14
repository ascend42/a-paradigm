/**
 * Tests for task-loader — Task CRUD + v7 Spine DAG schema/loader.
 *
 * Covers the sub-phase 0–1 surface: generateTaskId sequencing, applyFilter
 * (status incl. in-progress + 'active' meta, priority sort, malformed `created`,
 * limit), assertTransition (legal + illegal), normalizeTask (session_link
 * inference), and a create→in-progress→done round-trip with index consistency.
 *
 * `generateTaskId` is module-private; it's exercised indirectly through
 * createTask (which is the real contract).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as yaml from 'js-yaml';

import {
  createTask,
  updateTask,
  completeTask,
  shelveTask,
  loadTask,
  loadTasks,
  rebuildTaskIndex,
  assertTransition,
  normalizeTask,
  type Task,
  type TaskIndex,
  type TaskStatus,
} from './task-loader.js';

// ────────────────────────────────────────────────────────
// Harness
// ────────────────────────────────────────────────────────

let root: string;

const ENTRIES = (r: string) => path.join(r, '.paradigm/tasks/entries');

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'task-loader-test-'));
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

/** Write a raw task YAML into the date-partitioned store, bypassing createTask. */
function writeRaw(task: Partial<Task> & { id: string; created: string }): void {
  const dateStr = task.created.slice(0, 10);
  const dir = path.join(ENTRIES(root), dateStr);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${task.id}.yaml`), yaml.dump(task, { lineWidth: -1, noRefs: true }));
}

function readIndex(): TaskIndex {
  return yaml.load(fs.readFileSync(path.join(root, '.paradigm/tasks/index.yaml'), 'utf8')) as TaskIndex;
}

// ────────────────────────────────────────────────────────
// generateTaskId (via createTask)
// ────────────────────────────────────────────────────────

describe('generateTaskId (via createTask)', () => {
  it('starts at 001 on an empty dir', async () => {
    const id = await createTask(root, { blurb: 'first' });
    expect(id).toMatch(/^T-\d{4}-\d{2}-\d{2}-001$/);
  });

  it('increments the sequence within a date', async () => {
    const a = await createTask(root, { blurb: 'a' });
    const b = await createTask(root, { blurb: 'b' });
    const c = await createTask(root, { blurb: 'c' });
    const seq = (id: string) => parseInt(id.slice(-3), 10);
    expect(seq(b)).toBe(seq(a) + 1);
    expect(seq(c)).toBe(seq(b) + 1);
  });

  it('rolls over past gaps (max+1, not count+1)', async () => {
    const today = new Date().toISOString().slice(0, 10);
    // Seed a sparse dir: 001 and 005 present, nothing between.
    writeRaw({ id: `T-${today}-001`, created: new Date().toISOString(), blurb: 'x', priority: 'low', status: 'open', tags: [] });
    writeRaw({ id: `T-${today}-005`, created: new Date().toISOString(), blurb: 'y', priority: 'low', status: 'open', tags: [] });
    const next = await createTask(root, { blurb: 'next' });
    expect(next).toBe(`T-${today}-006`);
  });
});

// ────────────────────────────────────────────────────────
// applyFilter (via loadTasks)
// ────────────────────────────────────────────────────────

describe('applyFilter (via loadTasks)', () => {
  beforeEach(() => {
    // Hand-seed a deterministic set across one date.
    const day = '2026-06-10';
    const mk = (n: string, hour: string, status: TaskStatus, priority: Task['priority']): Task => ({
      id: `T-${day}-${n}`,
      blurb: `task ${n}`,
      priority,
      status,
      tags: status === 'open' ? ['needs-review'] : [],
      created: `${day}T${hour}:00:00.000Z`,
    });
    writeRaw(mk('001', '01', 'open', 'low'));
    writeRaw(mk('002', '02', 'in-progress', 'high'));
    writeRaw(mk('003', '03', 'done', 'medium'));
    writeRaw(mk('004', '04', 'shelved', 'high'));
  });

  it('filters by explicit status', async () => {
    const open = await loadTasks(root, { status: 'open', limit: 99 });
    expect(open.map(t => t.id)).toEqual(['T-2026-06-10-001']);

    const inProg = await loadTasks(root, { status: 'in-progress', limit: 99 });
    expect(inProg.map(t => t.id)).toEqual(['T-2026-06-10-002']);
  });

  it("'active' meta-status = open ∪ in-progress (excludes done/shelved)", async () => {
    const active = await loadTasks(root, { status: 'active', limit: 99 });
    const ids = active.map(t => t.id).sort();
    expect(ids).toEqual(['T-2026-06-10-001', 'T-2026-06-10-002']);
  });

  it("'all' returns every status", async () => {
    const all = await loadTasks(root, { status: 'all', limit: 99 });
    expect(all.length).toBe(4);
  });

  it('sorts by priority then recency', async () => {
    const all = await loadTasks(root, { status: 'all', limit: 99 });
    // high (002@02:00, 004@04:00) → newest-high first, then medium, then low.
    expect(all.map(t => t.priority)).toEqual(['high', 'high', 'medium', 'low']);
    expect(all[0].id).toBe('T-2026-06-10-004'); // 04:00 > 02:00 within high
    expect(all[1].id).toBe('T-2026-06-10-002');
  });

  it('honors limit', async () => {
    const two = await loadTasks(root, { status: 'all', limit: 2 });
    expect(two.length).toBe(2);
  });

  it('filters by tag', async () => {
    const tagged = await loadTasks(root, { status: 'all', tag: 'needs-review', limit: 99 });
    expect(tagged.map(t => t.id)).toEqual(['T-2026-06-10-001']);
  });

  it('survives a malformed `created` (falls back to id date, never NaN)', async () => {
    // Write into a VALID date dir (so the loader scans it) but with a malformed
    // `created` FIELD — exercises the NaN guard in the recency sort.
    const dir = path.join(ENTRIES(root), '2026-06-10');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'T-2026-06-10-099.yaml'),
      yaml.dump({ id: 'T-2026-06-10-099', created: 'not-a-date', blurb: 'broken', priority: 'low', status: 'open', tags: [] }),
    );
    const open = await loadTasks(root, { status: 'open', limit: 99 });
    // It loads (not skipped) and participates in sort without throwing.
    expect(open.find(t => t.id === 'T-2026-06-10-099')).toBeTruthy();
  });
});

// ────────────────────────────────────────────────────────
// assertTransition
// ────────────────────────────────────────────────────────

describe('assertTransition', () => {
  it('allows all legal transitions', () => {
    expect(assertTransition('open', 'in-progress')).toBe(true);
    expect(assertTransition('open', 'done')).toBe(true);
    expect(assertTransition('open', 'shelved')).toBe(true);
    expect(assertTransition('in-progress', 'done')).toBe(true);
    expect(assertTransition('in-progress', 'open')).toBe(true);
    expect(assertTransition('in-progress', 'shelved')).toBe(true);
    expect(assertTransition('shelved', 'open')).toBe(true);
  });

  it('treats a no-op (from === to) as legal', () => {
    expect(assertTransition('open', 'open')).toBe(true);
    expect(assertTransition('done', 'done')).toBe(true);
  });

  it('rejects illegal transitions', () => {
    expect(assertTransition('done', 'open')).toBe(false); // done is terminal
    expect(assertTransition('done', 'in-progress')).toBe(false);
    expect(assertTransition('shelved', 'done')).toBe(false); // must reopen first
    expect(assertTransition('shelved', 'in-progress')).toBe(false);
  });
});

// ────────────────────────────────────────────────────────
// normalizeTask
// ────────────────────────────────────────────────────────

describe('normalizeTask', () => {
  const base = (): Task => ({
    id: 'T-2026-06-10-001',
    blurb: 'x',
    priority: 'low',
    status: 'open',
    tags: [],
    created: '2026-06-10T00:00:00.000Z',
  });

  it('infers github provider from a github session_link', () => {
    const t = normalizeTask({ ...base(), session_link: 'https://github.com/x/y/pull/1' });
    expect(t.external_ref).toEqual({ provider: 'github', ref: 'https://github.com/x/y/pull/1' });
    expect(t.session_link).toBeUndefined();
  });

  it('infers session provider', () => {
    const t = normalizeTask({ ...base(), session_link: 'session-abc-123' });
    expect(t.external_ref?.provider).toBe('session');
  });

  it('falls back to url provider', () => {
    const t = normalizeTask({ ...base(), session_link: 'some-other-anchor' });
    expect(t.external_ref?.provider).toBe('url');
  });

  it('is a no-op when external_ref already present (provider shape)', () => {
    const existing = { provider: 'symphony', ref: 'agent-7' };
    const t = normalizeTask({ ...base(), session_link: 'github.com/x', external_ref: existing });
    expect(t.external_ref).toBe(existing);
    // session_link is left intact (only deleted when it actually heals).
    expect(t.session_link).toBe('github.com/x');
  });

  it('heals legacy external_ref.kind → external_ref.provider (1:1 value carry-over)', () => {
    // Old YAML carried the closed `{ kind, ref }` shape.
    const t = normalizeTask({ ...base(), external_ref: { kind: 'github', ref: 'a/b#3' } } as any);
    expect(t.external_ref?.provider).toBe('github');
    expect((t.external_ref as any)?.kind).toBeUndefined();
    expect(t.external_ref?.ref).toBe('a/b#3');
  });

  it('does not overwrite provider when both kind and provider present', () => {
    const t = normalizeTask({ ...base(), external_ref: { kind: 'url', provider: 'github', ref: 'r' } } as any);
    expect(t.external_ref?.provider).toBe('github');
    expect((t.external_ref as any)?.kind).toBe('url'); // untouched — provider already set
  });

  it('heals session_link on load via loadTask (provider shape)', async () => {
    writeRaw({ id: 'T-2026-06-10-009', created: '2026-06-10T00:00:00.000Z', blurb: 'legacy', priority: 'low', status: 'open', tags: [], session_link: 'https://github.com/a/b' });
    const loaded = await loadTask(root, 'T-2026-06-10-009');
    expect(loaded?.external_ref?.provider).toBe('github');
    expect(loaded?.session_link).toBeUndefined();
  });

  it('heals legacy external_ref.kind on load via loadTask', async () => {
    writeRaw({ id: 'T-2026-06-10-010', created: '2026-06-10T00:00:00.000Z', blurb: 'legacy ext', priority: 'low', status: 'open', tags: [], external_ref: { kind: 'orchestration', ref: 'run-9' } } as any);
    const loaded = await loadTask(root, 'T-2026-06-10-010');
    expect(loaded?.external_ref?.provider).toBe('orchestration');
    expect((loaded?.external_ref as any)?.kind).toBeUndefined();
  });
});

// ────────────────────────────────────────────────────────
// Round-trip: create → in-progress → done, index consistency
// ────────────────────────────────────────────────────────

describe('round-trip create → in-progress → done', () => {
  it('stamps started_at, transitions legally, and keeps index counts consistent', async () => {
    const id = await createTask(root, { blurb: 'do the thing', priority: 'high' });

    let idx = readIndex();
    expect(idx.total).toBe(1);
    expect(idx.open).toBe(1);
    expect(idx.in_progress).toBe(0);
    expect(idx.roots).toContain(id);

    // open → in-progress stamps started_at
    expect(await updateTask(root, id, { status: 'in-progress' })).toBe(true);
    let task = await loadTask(root, id);
    expect(task?.status).toBe('in-progress');
    expect(task?.started_at).toBeTruthy();

    idx = readIndex();
    expect(idx.open).toBe(0);
    expect(idx.in_progress).toBe(1);
    expect(idx.done).toBe(0);

    // in-progress → done
    expect(await completeTask(root, id)).toBe(true);
    task = await loadTask(root, id);
    expect(task?.status).toBe('done');
    expect(task?.completed).toBeTruthy();

    idx = readIndex();
    expect(idx.in_progress).toBe(0);
    expect(idx.done).toBe(1);
    expect(idx.total).toBe(1);
  });

  it('rejects an illegal transition (done → open) with the not-found failure shape', async () => {
    const id = await createTask(root, { blurb: 'terminal' });
    await completeTask(root, id);
    // done → open is illegal; updateTask returns false (same as not-found).
    expect(await updateTask(root, id, { status: 'open' })).toBe(false);
    const task = await loadTask(root, id);
    expect(task?.status).toBe('done'); // unchanged
  });

  it('records DAG edges (parentTaskId / dependsOn) and roots excludes children', async () => {
    const epic = await createTask(root, { blurb: 'epic', external_ref: { provider: 'orchestration', ref: 'run-1' } });
    const child = await createTask(root, {
      blurb: 'stage 1',
      parentTaskId: epic,
      dependsOn: [epic],
      stage: 1,
      claimant: { kind: 'archetype', ref: 'builder' },
    });

    const loadedChild = await loadTask(root, child);
    expect(loadedChild?.parentTaskId).toBe(epic);
    expect(loadedChild?.dependsOn).toEqual([epic]);
    expect(loadedChild?.claimant).toEqual({ kind: 'archetype', ref: 'builder' });

    const idx = await rebuildTaskIndex(root);
    expect(idx.roots).toContain(epic);
    expect(idx.roots).not.toContain(child);
  });

  it('returns false for updates to a missing task', async () => {
    expect(await updateTask(root, 'T-2099-01-01-001', { blurb: 'nope' })).toBe(false);
  });

  it('shelve transitions and counts', async () => {
    const id = await createTask(root, { blurb: 'later' });
    expect(await shelveTask(root, id)).toBe(true);
    const idx = readIndex();
    expect(idx.shelved).toBe(1);
    expect(idx.open).toBe(0);
  });
});
