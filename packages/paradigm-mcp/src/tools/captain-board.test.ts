/**
 * v7 §3 — Captain Surface (#captain-board) tests.
 *
 * Covers the four parts of Round 4b:
 *  A. paradigm_captain_board read assembles a run-DAG from epic + children;
 *     claim writes claimant keeping status 'open'; archetype cannot override a
 *     human/peer claim; advance records blocked_on without changing status.
 *  B. session-open (buildRecoveryPreamble) proposes a claimant and WRITES it back.
 *  C. debrief self-heals when liveness shows no postflight (advise, never guard).
 *  D. ownership boundary — Cid never writes settledAt.
 *
 * All filesystem effects asserted in tmpdirs.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { handleCaptainTool, assembleCaptainBoard } from './captain.js';
import { emitTaskDag } from './orchestration.js';
import { createTask, loadTask, completeTask, updateTask } from '../utils/task-loader.js';
import { loadProjectContext, type ProjectContext } from '../utils/index-loader.js';

let root: string;

async function loadCtx(): Promise<ProjectContext> {
  return loadProjectContext(root);
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'captain-board-'));
  fs.mkdirSync(path.join(root, '.paradigm'), { recursive: true });
  fs.writeFileSync(
    path.join(root, '.paradigm', 'config.yaml'),
    'version: 2.0.0\nproject:\n  name: captain-board-test\n',
    'utf8',
  );
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

/** Minimal two-stage plan: builder → tester. */
function linearPlan() {
  return {
    task: 'Implement #feature-x',
    mode: 'faceted' as const,
    symbols: ['#feature-x'],
    estimatedAgents: 2,
    estimatedTokens: { min: 1000, max: 2000 },
    stages: [
      {
        stage: 0,
        canRunParallel: false,
        agents: [{ name: 'builder', task: 'Build #feature-x', dependsOn: [], required: true }],
      },
      {
        stage: 1,
        canRunParallel: false,
        agents: [{ name: 'tester', task: 'Test #feature-x', dependsOn: ['builder'], required: true }],
      },
    ],
  };
}

// ── Part A: read assembles a DAG ──────────────────────────

describe('A. captain_board read — DAG assembly', () => {
  it('assembles a run from epic + ordered children', async () => {
    const { epicTaskId } = await emitTaskDag(root, 'orch-1', 'Implement #feature-x', linearPlan());
    expect(epicTaskId).toBeTruthy();

    const board = await assembleCaptainBoard(root);
    expect(board.runs.length).toBe(1);
    const run = board.runs[0];
    expect(run.epicTaskId).toBe(epicTaskId);
    expect(run.nodes.length).toBe(2);
    // Ordered by stage: builder (0) then tester (1).
    expect(run.nodes[0].claimant?.ref).toBe('builder');
    expect(run.nodes[1].claimant?.ref).toBe('tester');
    // tester depends on builder's task-id.
    expect(run.nodes[1].dependsOn).toContain(run.nodes[0].taskId);
    // Epic was promoted to in-progress by emission → run in-progress.
    expect(run.runStatus).toBe('in-progress');
  });

  it('settled epic (settledAt present) is excluded from active runs', async () => {
    const epicId = await createTask(root, {
      blurb: 'epic',
      external_ref: { kind: 'orchestration', ref: 'orch-settled' },
      claimant: { kind: 'archetype', ref: 'orchestrator' },
    });
    // Loid's stamp (simulated): settledAt present → run is terminal, not surfaced.
    await updateTask(root, epicId, { settledAt: new Date().toISOString() });

    const board = await assembleCaptainBoard(root);
    expect(board.runs.find(r => r.epicTaskId === epicId)).toBeUndefined();
  });

  it('surfaces unclaimed open tasks with a summary', async () => {
    await createTask(root, { blurb: 'loose task A', priority: 'high', tags: ['#feature-x'] });
    await createTask(root, { blurb: 'loose task B', priority: 'low' });

    const board = await assembleCaptainBoard(root);
    expect(board.unclaimed.length).toBe(2);
    expect(board.summary.unclaimed).toBe(2);
    expect(board.summary.open).toBeGreaterThanOrEqual(2);
  });
});

// ── Part A: claim writes claimant, keeps status open ──────

describe('A. captain_board claim', () => {
  it('writes claimant and keeps status open', async () => {
    const ctx = await loadCtx();
    const taskId = await createTask(root, { blurb: 'claim me' });

    const res = await handleCaptainTool(
      'paradigm_captain_board',
      { action: 'claim', taskId, claimant: { kind: 'archetype', ref: 'builder' } },
      ctx,
    );
    expect(res.handled).toBe(true);
    const parsed = JSON.parse(res.text);
    expect(parsed.ok).toBe(true);

    const task = await loadTask(root, taskId);
    expect(task?.claimant?.ref).toBe('builder');
    expect(task?.claimant?.kind).toBe('archetype');
    expect(task?.status).toBe('open'); // claimant present + open = proposed, not started
  });

  it('archetype claim cannot override a human/peer claim', async () => {
    const ctx = await loadCtx();
    const taskId = await createTask(root, {
      blurb: 'human owns this',
      claimant: { kind: 'human', ref: 'matt' },
    });

    const res = await handleCaptainTool(
      'paradigm_captain_board',
      { action: 'claim', taskId, claimant: { kind: 'archetype', ref: 'builder' } },
      ctx,
    );
    const parsed = JSON.parse(res.text);
    expect(parsed.ok).toBe(false);

    const task = await loadTask(root, taskId);
    expect(task?.claimant?.kind).toBe('human'); // unchanged
    expect(task?.claimant?.ref).toBe('matt');
  });

  it('human claim overrides an archetype proposal', async () => {
    const ctx = await loadCtx();
    const taskId = await createTask(root, {
      blurb: 'cid proposed this',
      claimant: { kind: 'archetype', ref: 'builder' },
    });

    const res = await handleCaptainTool(
      'paradigm_captain_board',
      { action: 'claim', taskId, claimant: { kind: 'human', ref: 'matt' } },
      ctx,
    );
    expect(JSON.parse(res.text).ok).toBe(true);

    const task = await loadTask(root, taskId);
    expect(task?.claimant?.kind).toBe('human');
  });
});

// ── Part A: advance records blocked_on, status unchanged ──

describe('A. captain_board advance', () => {
  it('records blocked_on without changing status', async () => {
    const ctx = await loadCtx();
    const taskId = await createTask(root, { blurb: 'will be blocked' });

    const res = await handleCaptainTool(
      'paradigm_captain_board',
      { action: 'advance', taskId, blockedOn: 'waiting on upstream API' },
      ctx,
    );
    expect(JSON.parse(res.text).ok).toBe(true);

    const task = await loadTask(root, taskId);
    expect(task?.blocked_on).toBe('waiting on upstream API');
    expect(task?.status).toBe('open'); // status NOT changed (v7.0 has no 'blocked')
  });
});

// ── Part B: session-open proposes + writes a claimant ─────

describe('B. session-open proposes claimants (writes them back)', () => {
  it('writes a proposed claimant onto an unclaimed task', async () => {
    // Provide an agents manifest so the matcher can propose.
    fs.writeFileSync(
      path.join(root, '.paradigm', 'agents.yaml'),
      [
        'version: "1.0"',
        'team:',
        '  name: test',
        '  default_agent: builder',
        '  require_handoff: false',
        'agents:',
        '  builder:',
        '    name: builder',
        '    role: "Builds features"',
        '    focus:',
        '      reads: []',
        '      writes: []',
        '    triggers:',
        '      - type: keyword',
        '        match: ["build", "implement"]',
      ].join('\n'),
      'utf8',
    );

    const taskId = await createTask(root, {
      blurb: 'implement and build the widget',
      priority: 'high',
    });

    // Drive the real session-open path.
    const { buildRecoveryPreamble } = await import('./context.js');
    // Seed a checkpoint so the preamble is produced.
    const tracker = (await import('../utils/session-tracker.js')).getSessionTracker();
    tracker.setRootDir(root);
    tracker.saveCheckpoint({ phase: 'implementing', context: 'test session' });

    await buildRecoveryPreamble(root);

    const task = await loadTask(root, taskId);
    expect(task?.claimant?.kind).toBe('archetype');
    expect(task?.claimant?.ref).toBe('builder');
    expect(task?.status).toBe('open'); // proposal does not start the task
  });
});

// ── Part C: debrief self-heals on missing postflight ──────

describe('C. debrief postflight self-heal', () => {
  it('self-heals (no guard) when liveness shows no postflight', async () => {
    const ctx = await loadCtx();
    // No settlement-liveness.jsonl exists → sessionPostflightRan === false.
    const res = await handleCaptainTool(
      'paradigm_captain_debrief',
      {
        orchestrationId: 'orch-debrief-1',
        sessionSummary: 'did some work',
        touchedFiles: [],
      },
      ctx,
    );
    expect(res.handled).toBe(true);
    const report = JSON.parse(res.text.split('\n━━━')[0]);
    expect(report.postflight).toBeDefined();
    expect(report.postflight.ranThisSession).toBe(false);
    // Self-heal either ran postflight OR proposed an ADVISE block — never guard.
    // The stop hook is always cleared regardless (advise, not deadlock).
    expect(report.stopHookCleared).toBe(true);

    // Assert no GUARD remediation was authored.
    const remediationsDir = path.join(root, '.paradigm', 'remediations');
    if (fs.existsSync(remediationsDir)) {
      for (const f of fs.readdirSync(remediationsDir)) {
        const content = fs.readFileSync(path.join(remediationsDir, f), 'utf8');
        expect(content).not.toContain('severity: guard');
      }
    }
  });

  it('does NOT self-heal when liveness shows postflight ran', async () => {
    const ctx = await loadCtx();
    const eventsDir = path.join(root, '.paradigm', 'events');
    fs.mkdirSync(eventsDir, { recursive: true });
    fs.writeFileSync(
      path.join(eventsDir, 'settlement-liveness.jsonl'),
      JSON.stringify({
        ts: new Date().toISOString(),
        parentTaskId: 'T-x',
        settledAs: 'done',
        stages: { recordWorkLog: 'ok', runPostflightLearning: 'ok', autoPromoteJournalEntries: 'ok' },
        journalsWritten: 0,
        promoted: 0,
        chainLive: true,
      }) + '\n',
      'utf8',
    );

    const res = await handleCaptainTool(
      'paradigm_captain_debrief',
      {
        orchestrationId: 'orch-debrief-2',
        sessionSummary: 'work done',
        touchedFiles: [],
      },
      ctx,
    );
    const report = JSON.parse(res.text.split('\n━━━')[0]);
    expect(report.postflight.ranThisSession).toBe(true);
    expect(report.postflight.selfHealed).toBe(false);
    expect(report.postflight.blockProposed).toBe(false);
  });
});

// ── Part D: ownership boundary — Cid never writes settledAt ──

describe('D. ownership boundary', () => {
  it('claim does not write settledAt', async () => {
    const ctx = await loadCtx();
    const taskId = await createTask(root, { blurb: 'boundary task' });
    await handleCaptainTool(
      'paradigm_captain_board',
      { action: 'claim', taskId, claimant: { kind: 'archetype', ref: 'builder' } },
      ctx,
    );
    const task = await loadTask(root, taskId);
    expect(task?.settledAt).toBeUndefined();
  });

  it('advance does not write settledAt', async () => {
    const ctx = await loadCtx();
    const taskId = await createTask(root, { blurb: 'boundary task 2' });
    await handleCaptainTool(
      'paradigm_captain_board',
      { action: 'advance', taskId, blockedOn: 'blocked' },
      ctx,
    );
    const task = await loadTask(root, taskId);
    expect(task?.settledAt).toBeUndefined();
  });

  it('settled run derives runStatus from settledAt but board never stamps it', async () => {
    const { epicTaskId } = await emitTaskDag(root, 'orch-d', 'task', linearPlan());
    // Complete all children → settlement (Loid) stamps settledAt on the epic.
    const all = await assembleCaptainBoard(root);
    const run = all.runs.find(r => r.epicTaskId === epicTaskId)!;
    for (const node of run.nodes) {
      await completeTask(root, node.taskId);
    }
    // After settlement, a board READ must not have written settledAt itself —
    // it's Loid's settlement that did. Read again; the run drops out (settled).
    const board2 = await assembleCaptainBoard(root);
    expect(board2.runs.find(r => r.epicTaskId === epicTaskId)).toBeUndefined();
    // The epic carries settledAt (written by settlement, not the board).
    const epic = await loadTask(root, epicTaskId!);
    expect(epic?.settledAt).toBeTruthy();
  });
});
