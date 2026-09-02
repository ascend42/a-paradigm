/**
 * Tests for task-settlement (#task-settlement, v7 §2-rev2).
 *
 * The whole point of this module is that "checks prove true" — so it's tested
 * hard. Covers: settlement fires ONLY when all siblings terminal; idempotency;
 * orphan self-settle; the reaper crashing a stale in-progress so the subtree
 * settles; a thrown chain stage recorded as chainLive:false with the failing
 * stage named; and the real-confidence preference in postflight.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

import {
  createTask,
  updateTask,
  completeTask,
  shelveTask,
  loadTask,
} from './task-loader.js';
import {
  settleParentIfComplete,
  reapStaleInProgress,
  isTerminal,
} from './task-settlement.js';

// ────────────────────────────────────────────────────────
// Harness
// ────────────────────────────────────────────────────────

let root: string;
let homeDir: string;
let priorHome: string | undefined;

const LIVENESS = (r: string) => path.join(r, '.paradigm/events/settlement-liveness.jsonl');

function readLiveness(r: string): Array<Record<string, unknown>> {
  const p = LIVENESS(r);
  if (!fs.existsSync(p)) return [];
  return fs.readFileSync(p, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l));
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'task-settlement-test-'));
  // Isolate journal/notebook writes: the settlement chain calls
  // autoPromoteJournalEntries, which keys off process.env.HOME. Without a
  // throwaway HOME, `npm test` promotes real ~/.paradigm journal entries into
  // notebooks, bypassing the Classroom gate on a developer machine.
  homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'task-settlement-home-'));
  priorHome = process.env.HOME;
  process.env.HOME = homeDir;
});

afterEach(() => {
  vi.restoreAllMocks();
  if (priorHome === undefined) delete process.env.HOME;
  else process.env.HOME = priorHome;
  for (const d of [root, homeDir]) {
    if (d && fs.existsSync(d)) fs.rmSync(d, { recursive: true, force: true });
  }
});

// ────────────────────────────────────────────────────────
// isTerminal predicate
// ────────────────────────────────────────────────────────

describe('isTerminal', () => {
  it('treats done/shelved/crashed as terminal, open/in-progress as not', () => {
    expect(isTerminal('done')).toBe(true);
    expect(isTerminal('shelved')).toBe(true);
    expect(isTerminal('crashed')).toBe(true);
    expect(isTerminal('open')).toBe(false);
    expect(isTerminal('in-progress')).toBe(false);
  });
});

// ────────────────────────────────────────────────────────
// All-siblings-terminal trigger
// ────────────────────────────────────────────────────────

describe('settleParentIfComplete — trigger', () => {
  it('does NOT settle while any sibling is non-terminal', async () => {
    const parent = await createTask(root, { blurb: 'epic' });
    const a = await createTask(root, { blurb: 'a', parentTaskId: parent });
    await createTask(root, { blurb: 'b', parentTaskId: parent });

    await completeTask(root, a); // a done, b still open

    const p = await loadTask(root, parent);
    expect(p?.settledAt).toBeUndefined();
  });

  it('settles the parent only once ALL siblings are terminal', async () => {
    const parent = await createTask(root, { blurb: 'epic' });
    const a = await createTask(root, { blurb: 'a', parentTaskId: parent });
    const b = await createTask(root, { blurb: 'b', parentTaskId: parent });

    await completeTask(root, a);
    expect((await loadTask(root, parent))?.settledAt).toBeUndefined();

    await completeTask(root, b); // last sibling → triggers settlement via updateTask hook

    const p = await loadTask(root, parent);
    expect(p?.settledAt).toBeTruthy();

    const records = readLiveness(root);
    expect(records.length).toBeGreaterThanOrEqual(1);
    const last = records[records.length - 1];
    expect(last.parentTaskId).toBe(parent);
    expect(last.settledAs).toBe('done');
  });

  it('settles as "shelved" when a sibling was shelved (not crashed)', async () => {
    const parent = await createTask(root, { blurb: 'epic' });
    const a = await createTask(root, { blurb: 'a', parentTaskId: parent });
    const b = await createTask(root, { blurb: 'b', parentTaskId: parent });

    await completeTask(root, a);
    await shelveTask(root, b);

    const records = readLiveness(root);
    const last = records[records.length - 1];
    expect(last.settledAs).toBe('shelved');
    expect((await loadTask(root, parent))?.settledAt).toBeTruthy();
  });
});

// ────────────────────────────────────────────────────────
// Idempotency
// ────────────────────────────────────────────────────────

describe('settleParentIfComplete — idempotency', () => {
  it('a second settlement pass is a no-op (settledAt already stamped)', async () => {
    const parent = await createTask(root, { blurb: 'epic' });
    const a = await createTask(root, { blurb: 'a', parentTaskId: parent });
    await completeTask(root, a);

    const firstStamp = (await loadTask(root, parent))?.settledAt;
    expect(firstStamp).toBeTruthy();
    const countAfterFirst = readLiveness(root).length;

    // Call settlement again directly — must not re-run the chain.
    await settleParentIfComplete(root, parent);

    expect((await loadTask(root, parent))?.settledAt).toBe(firstStamp);
    expect(readLiveness(root).length).toBe(countAfterFirst);
  });
});

// ────────────────────────────────────────────────────────
// Orphan policy
// ────────────────────────────────────────────────────────

describe('settleParentIfComplete — orphan', () => {
  it('child self-settles when its parent does not load', async () => {
    const orphan = await createTask(root, {
      blurb: 'orphan child',
      parentTaskId: 'T-2099-01-01-999', // non-existent parent
    });

    // Completing the orphan triggers settleParentIfComplete(missingParent, orphan).
    await completeTask(root, orphan);

    const o = await loadTask(root, orphan);
    expect(o?.settledAt).toBeTruthy();
    expect(o?.orphaned).toBe(true);

    const records = readLiveness(root);
    const last = records[records.length - 1];
    expect(last.settledAs).toBe('orphan');
  });
});

// ────────────────────────────────────────────────────────
// Reaper
// ────────────────────────────────────────────────────────

describe('reaper — stale in-progress', () => {
  it('crashes a stale in-progress task so its subtree settles', async () => {
    const parent = await createTask(root, { blurb: 'epic' });
    const a = await createTask(root, { blurb: 'a', parentTaskId: parent });
    const stale = await createTask(root, { blurb: 'stale', parentTaskId: parent });

    await completeTask(root, a);

    // Move `stale` to in-progress, then backdate started_at past the window.
    await updateTask(root, stale, { status: 'in-progress' });
    const old = new Date(Date.now() - 60 * 60 * 1000).toISOString(); // 60 min ago
    await updateTask(root, stale, { started_at: old });

    expect((await loadTask(root, parent))?.settledAt).toBeUndefined();

    // A settlement pass runs the reaper first → stale crashes → subtree settles.
    await settleParentIfComplete(root, parent);

    const crashed = await loadTask(root, stale);
    expect(crashed?.crashed_at).toBeTruthy();
    expect(crashed?.crash_reason).toBe('reaper:stale-in-progress');
    expect(crashed?.status).toBe('shelved'); // terminal status backing the crash marker

    const p = await loadTask(root, parent);
    expect(p?.settledAt).toBeTruthy();

    const records = readLiveness(root);
    const parentRecord = records.find(r => r.parentTaskId === parent);
    expect(parentRecord?.settledAs).toBe('crashed');
  });

  it('does NOT reap an in-progress task still inside the staleness window', async () => {
    const fresh = await createTask(root, { blurb: 'fresh' });
    await updateTask(root, fresh, { status: 'in-progress' }); // started_at = now

    const reaped = await reapStaleInProgress(root);
    expect(reaped).not.toContain(fresh);
    expect((await loadTask(root, fresh))?.status).toBe('in-progress');
  });

  it('honors PARADIGM_REAPER_STALE_MINUTES env override', async () => {
    const old = process.env.PARADIGM_REAPER_STALE_MINUTES;
    process.env.PARADIGM_REAPER_STALE_MINUTES = '1';
    try {
      const t = await createTask(root, { blurb: 't' });
      await updateTask(root, t, { status: 'in-progress' });
      await updateTask(root, t, { started_at: new Date(Date.now() - 5 * 60 * 1000).toISOString() });

      const reaped = await reapStaleInProgress(root);
      expect(reaped).toContain(t);
    } finally {
      if (old === undefined) delete process.env.PARADIGM_REAPER_STALE_MINUTES;
      else process.env.PARADIGM_REAPER_STALE_MINUTES = old;
    }
  });
});

// ────────────────────────────────────────────────────────
// Falsifiable liveness probe — severed chain
// ────────────────────────────────────────────────────────

describe('liveness probe — chainLive', () => {
  it('records chainLive:false and names the stage when a chain stage throws', async () => {
    // Sever the runPostflightLearning stage.
    const ambient = await import('../tools/ambient.js');
    vi.spyOn(ambient, 'runPostflightLearning').mockRejectedValue(new Error('boom'));

    const parent = await createTask(root, { blurb: 'epic' });
    const a = await createTask(root, { blurb: 'a', parentTaskId: parent });
    await completeTask(root, a);

    const records = readLiveness(root);
    const last = records[records.length - 1] as {
      chainLive: boolean;
      stages: Record<string, string>;
    };
    expect(last.chainLive).toBe(false);
    expect(last.stages.runPostflightLearning).toBe('threw');
    // Other stages still ran (record written in finally).
    expect(last.stages.recordWorkLog).toBe('ok');
  });

  it('records chainLive:true on a clean settlement (silence is signal)', async () => {
    const parent = await createTask(root, { blurb: 'epic' });
    const a = await createTask(root, { blurb: 'a', parentTaskId: parent });
    await completeTask(root, a);

    const records = readLiveness(root);
    const last = records[records.length - 1] as { chainLive: boolean; journalsWritten: number };
    expect(last.chainLive).toBe(true);
  });
});
