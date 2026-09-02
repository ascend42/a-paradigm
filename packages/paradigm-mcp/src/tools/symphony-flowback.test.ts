/**
 * Tests for the v7.1 Symphony peer status flow-back watcher
 * (#symphony-tools, !symphony-status-flowback).
 *
 * The watcher runs inside `paradigm_symphony_poll`: for each inbound
 * task-protocol note carrying `metadata.task.taskId`, it maps the note's intent
 * onto a LOCAL `updateTask` so loop-closure extends to the Symphony/peer path.
 *
 * Covered here:
 *   - task-complete → local task flips to `done`; parented task settles
 *     (settledAt stamped + a liveness record written).
 *   - task-failed → `shelved` (+ crash_reason recorded).
 *   - progress → `in-progress`.
 *   - a note for a NONEXISTENT local task is a clean no-op (no throw).
 *   - a second task-complete does NOT throw (already-terminal idempotency).
 *   - non-task-protocol notes / notes without taskId are ignored, so poll's
 *     normal output is unaffected.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

import { applyTaskStatusFlowBack } from './symphony.js';
import { createTask, loadTask } from '../utils/task-loader.js';
import type { SymphonyMessage, MessageIntent } from '../utils/symphony-loader.js';

let root: string;
let homeDir: string;
let priorHome: string | undefined;

const LIVENESS = (r: string) =>
  path.join(r, '.paradigm/events/settlement-liveness.jsonl');

function readLiveness(r: string): Array<Record<string, unknown>> {
  const p = LIVENESS(r);
  if (!fs.existsSync(p)) return [];
  return fs.readFileSync(p, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l));
}

/** Build a minimal task-protocol note carrying a task-id in metadata. */
function note(
  intent: MessageIntent,
  opts: { taskId?: string; text?: string } = {},
): SymphonyMessage {
  return {
    id: `msg-${Math.random().toString(36).slice(2)}`,
    timestamp: new Date().toISOString(),
    sender: { id: 'peer/cursor', name: 'Cursor Peer', type: 'agent' },
    intent,
    content: { text: opts.text ?? 'peer update' },
    symbols: [],
    metadata: opts.taskId ? { task: { taskId: opts.taskId } as any } : undefined,
  };
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'symphony-flowback-test-'));
  // Isolate HOME: a standalone task completion now fires the leaf learning chain
  // (T-2026-06-13-004), which writes journals under $HOME. Keep it off the real
  // ~/.paradigm so the test stays hermetic AND fast (no real-corpus I/O).
  homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'symphony-flowback-home-'));
  priorHome = process.env.HOME;
  process.env.HOME = homeDir;
});

afterEach(() => {
  if (priorHome === undefined) delete process.env.HOME;
  else process.env.HOME = priorHome;
  for (const d of [root, homeDir]) {
    if (d && fs.existsSync(d)) fs.rmSync(d, { recursive: true, force: true });
  }
});

describe('applyTaskStatusFlowBack — intent → local status mapping', () => {
  it('task-complete flips a local task to done', async () => {
    const id = await createTask(root, { blurb: 'peer work' });

    await applyTaskStatusFlowBack([note('task-complete', { taskId: id })], root);

    const t = await loadTask(root, id);
    expect(t?.status).toBe('done');
    expect(t?.completed).toBeTruthy();
  });

  it('task-failed shelves the task and records a crash_reason', async () => {
    const id = await createTask(root, { blurb: 'peer work' });

    await applyTaskStatusFlowBack(
      [note('task-failed', { taskId: id, text: 'build broke on peer' })],
      root,
    );

    const t = await loadTask(root, id);
    expect(t?.status).toBe('shelved');
    expect(t?.crash_reason).toContain('build broke on peer');
  });

  it('progress moves the task to in-progress', async () => {
    const id = await createTask(root, { blurb: 'peer work' });

    await applyTaskStatusFlowBack([note('progress', { taskId: id })], root);

    const t = await loadTask(root, id);
    expect(t?.status).toBe('in-progress');
    expect(t?.started_at).toBeTruthy();
  });
});

describe('applyTaskStatusFlowBack — settlement closes the loop for parented tasks', () => {
  it('task-complete on the last child settles the parent (settledAt + liveness)', async () => {
    const parent = await createTask(root, { blurb: 'epic' });
    const child = await createTask(root, { blurb: 'leaf', parentTaskId: parent });

    expect((await loadTask(root, parent))?.settledAt).toBeUndefined();

    await applyTaskStatusFlowBack([note('task-complete', { taskId: child })], root);

    const p = await loadTask(root, parent);
    expect(p?.settledAt).toBeTruthy();

    const liveness = readLiveness(root);
    expect(liveness.length).toBeGreaterThan(0);
  });
});

describe('applyTaskStatusFlowBack — best-effort / idempotency', () => {
  it('a note for a NONEXISTENT local task is a clean no-op', async () => {
    await expect(
      applyTaskStatusFlowBack(
        [note('task-complete', { taskId: 'T-2026-06-13-doesnotexist' })],
        root,
      ),
    ).resolves.toBeUndefined();
  });

  it('a second task-complete on an already-done task does not throw', async () => {
    const id = await createTask(root, { blurb: 'peer work' });

    await applyTaskStatusFlowBack([note('task-complete', { taskId: id })], root);
    expect((await loadTask(root, id))?.status).toBe('done');

    // Second delivery of the same terminal note — must be a graceful no-op.
    await expect(
      applyTaskStatusFlowBack([note('task-complete', { taskId: id })], root),
    ).resolves.toBeUndefined();

    expect((await loadTask(root, id))?.status).toBe('done');
  });

  it('ignores non-task-protocol notes and notes without a taskId (poll output unaffected)', async () => {
    const id = await createTask(root, { blurb: 'untouched' });

    await applyTaskStatusFlowBack(
      [
        note('task', { taskId: id }),        // assignment intent — not a trigger
        note('task-complete'),               // trigger intent but no taskId
        note('task-ack', { taskId: id }),    // ack is not a flow-back trigger
      ],
      root,
    );

    // Nothing should have changed the local task.
    expect((await loadTask(root, id))?.status).toBe('open');
  });
});
