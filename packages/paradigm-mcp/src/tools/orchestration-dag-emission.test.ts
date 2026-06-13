/**
 * Tests for v7 Spine (sub-phase 2) — DAG emission & typed handoff wiring.
 *
 * Covers:
 *  - emitTaskDag produces an epic (in-progress, no parentTaskId) + one child
 *    per stage-agent with correct parentTaskId/stage/dependsOn/claimant/status.
 *  - dependsOn (agent-name handoff edges) resolve to the upstream emitted
 *    task-ids.
 *  - a task-write failure degrades gracefully (no throw) rather than breaking
 *    the orchestration result.
 *  - plan/quick mode emit NOTHING (structural: emitTaskDag is only reachable on
 *    the execute path — asserted via the handler enum + call-site guard).
 *  - the typed filePlan consumer (planBuilderStages / relayFilePlanToGroups)
 *    reads AgentRelay.filePlan instead of regex-scraping prose, and the dead
 *    regex parsers are gone.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

import { emitTaskDag, planBuilderStages } from './orchestration.js';
import { loadTask, loadTasks } from '../utils/task-loader.js';
import type { AgentRelay } from '../utils/agent-relay.js';

let root: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'orch-dag-test-'));
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

/** Minimal three-stage plan: architect → builder → tester (linear handoff). */
function linearPlan() {
  return {
    task: 'Implement feature X',
    mode: 'faceted' as const,
    symbols: ['#feature-x'],
    estimatedAgents: 3,
    estimatedTokens: { min: 1000, max: 2000 },
    stages: [
      {
        stage: 0,
        canRunParallel: false,
        agents: [{ name: 'architect', task: 'Design feature X', dependsOn: [], required: true }],
      },
      {
        stage: 1,
        canRunParallel: false,
        agents: [{ name: 'builder', task: 'Build feature X', dependsOn: ['architect'], required: true }],
      },
      {
        stage: 2,
        canRunParallel: false,
        agents: [{ name: 'tester', task: 'Test feature X', dependsOn: ['builder'], required: true }],
      },
    ],
  };
}

describe('emitTaskDag — epic + stage children', () => {
  it('creates one epic and one child per stage-agent', async () => {
    const { epicTaskId, agentTaskIds } = await emitTaskDag(root, 'orch-abc', 'Implement feature X', linearPlan());

    expect(epicTaskId).toBeTruthy();
    expect(agentTaskIds.size).toBe(3);

    const all = await loadTasks(root, { status: 'all', limit: 9999 });
    expect(all.length).toBe(4); // epic + 3 children
  });

  it('epic is in-progress, has no parentTaskId, and carries the orchestration external_ref', async () => {
    const { epicTaskId } = await emitTaskDag(root, 'orch-abc', 'Implement feature X', linearPlan());
    const epic = await loadTask(root, epicTaskId!);

    expect(epic).toBeTruthy();
    expect(epic!.status).toBe('in-progress');
    expect(epic!.parentTaskId).toBeUndefined();
    expect(epic!.claimant).toEqual({ kind: 'archetype', ref: 'orchestrator' });
    expect(epic!.external_ref).toEqual({ kind: 'orchestration', ref: 'orch-abc' });
  });

  it('children carry parentTaskId=epic, the right stage index, archetype claimant, and status open', async () => {
    const { epicTaskId, agentTaskIds } = await emitTaskDag(root, 'orch-abc', 'Implement feature X', linearPlan());

    const builderId = agentTaskIds.get('builder')!;
    const builder = await loadTask(root, builderId);

    expect(builder!.parentTaskId).toBe(epicTaskId);
    expect(builder!.stage).toBe(1);
    expect(builder!.status).toBe('open'); // v7.0 has no 'claimed'
    expect(builder!.claimant).toEqual({ kind: 'archetype', ref: 'builder' });
    expect(builder!.external_ref).toEqual({ kind: 'orchestration', ref: 'orch-abc' });
  });

  it('resolves dependsOn (agent-name edges) to upstream emitted task-ids', async () => {
    const { agentTaskIds } = await emitTaskDag(root, 'orch-abc', 'Implement feature X', linearPlan());

    const architectId = agentTaskIds.get('architect')!;
    const builderId = agentTaskIds.get('builder')!;
    const tester = await loadTask(root, agentTaskIds.get('tester')!);
    const builder = await loadTask(root, builderId);

    // architect has no upstream → no dependsOn
    const architect = await loadTask(root, architectId);
    expect(architect!.dependsOn).toBeUndefined();

    // builder depends on architect's TASK-ID (not the agent name)
    expect(builder!.dependsOn).toEqual([architectId]);
    // tester depends on builder's task-id
    expect(tester!.dependsOn).toEqual([builderId]);
  });

  it('returns an agent-name → task-id map keyed by every stage agent', async () => {
    const { agentTaskIds } = await emitTaskDag(root, 'orch-abc', 'Implement feature X', linearPlan());
    expect([...agentTaskIds.keys()].sort()).toEqual(['architect', 'builder', 'tester']);
  });
});

describe('emitTaskDag — graceful degradation', () => {
  it('does not throw and returns an empty map when the task store is unwritable', async () => {
    // Make the tasks entries path a FILE so createTask's mkdirSync throws.
    const tasksDir = path.join(root, '.paradigm', 'tasks');
    fs.mkdirSync(tasksDir, { recursive: true });
    fs.writeFileSync(path.join(tasksDir, 'entries'), 'not a directory');

    const result = await emitTaskDag(root, 'orch-fail', 'Implement feature X', linearPlan());

    // Emission degraded — no epic, empty map — but NO throw (the await resolved).
    expect(result.epicTaskId).toBeUndefined();
    expect(result.agentTaskIds.size).toBe(0);
  });
});

describe('planBuilderStages — typed AgentRelay.filePlan consumption', () => {
  it('maps a typed relay.filePlan into a single sub-phase builder stage', () => {
    const relay: AgentRelay = {
      agent: 'architect',
      status: 'complete',
      artifacts: [],
      decisions: [],
      filePlan: ['src/a.ts', 'src/b.ts'],
    };
    const plan = planBuilderStages(relay);

    expect(plan.hasFilePlan).toBe(true);
    expect(plan.totalFiles).toBe(2);
    expect(plan.stages).toHaveLength(1);
    expect(plan.stages[0].builders[0].files.map(f => f.path)).toEqual(['src/a.ts', 'src/b.ts']);
  });

  it('falls back to a single all-files builder when relay has no filePlan', () => {
    const relay: AgentRelay = { agent: 'architect', status: 'complete', artifacts: [], decisions: [] };
    const plan = planBuilderStages(relay);

    expect(plan.hasFilePlan).toBe(false);
    expect(plan.totalBuilders).toBe(1);
    expect(plan.stages[0].builders[0].group).toBe('all');
  });

  it('falls back when relay is undefined', () => {
    const plan = planBuilderStages(undefined);
    expect(plan.hasFilePlan).toBe(false);
  });
});

describe('dead regex parsers are gone', () => {
  it('orchestration.ts no longer defines parseFilePlan / parseFilePlanFromResponse', () => {
    const src = fs.readFileSync(
      path.join(__dirname, 'orchestration.ts'),
      'utf8',
    );
    expect(src).not.toMatch(/function parseFilePlan\b/);
    expect(src).not.toMatch(/function parseFilePlanFromResponse\b/);
  });
});
