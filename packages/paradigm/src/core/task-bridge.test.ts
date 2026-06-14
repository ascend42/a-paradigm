/**
 * Tests for the CLI orchestrator task-bridge (#task-bridge).
 *
 * Covers:
 *  - bridgeRunStart creates an epic (in-progress, no parent) + one child per
 *    stage with correct parentTaskId/stage/claimant/dependsOn/status.
 *  - bridgeStageComplete on the LAST stage child triggers settlement: the epic
 *    gets `settledAt` stamped and a settlement-liveness record is written.
 *  - a bridge write-failure NEVER propagates (degrades to an empty handle / a
 *    falsy result) so the CLI orchestration run is unaffected.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

import {
  bridgeRunStart,
  bridgeStageProgress,
  bridgeStageComplete,
  type BridgeStage,
} from './task-bridge.js';
import { loadTask, loadTasks } from '../../../paradigm-mcp/src/utils/task-loader.js';

let root: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'cli-task-bridge-test-'));
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

const LIVENESS = (r: string) =>
  path.join(r, '.paradigm/events/settlement-liveness.jsonl');

function readLiveness(r: string): Array<Record<string, unknown>> {
  const p = LIVENESS(r);
  if (!fs.existsSync(p)) return [];
  return fs
    .readFileSync(p, 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l));
}

/** Linear three-stage plan: architect → builder → tester. */
function linearStages(): BridgeStage[] {
  return [
    { agent: 'architect', stage: 0, subtask: 'Design feature X', dependsOn: [] },
    { agent: 'builder', stage: 1, subtask: 'Build feature X', dependsOn: ['architect'] },
    { agent: 'tester', stage: 2, subtask: 'Test feature X', dependsOn: ['builder'] },
  ];
}

describe('bridgeRunStart — epic + stage children', () => {
  it('creates one epic and one child per stage', async () => {
    const { epicTaskId, stageTaskIds } = await bridgeRunStart(
      root,
      'orch-cli-1',
      'Implement feature X',
      linearStages(),
    );

    expect(epicTaskId).toBeTruthy();
    expect(stageTaskIds.size).toBe(3);

    const all = await loadTasks(root, { status: 'all', limit: 9999 });
    expect(all.length).toBe(4); // epic + 3 children
  });

  it('epic is in-progress, has no parent, carries the orchestration external_ref', async () => {
    const { epicTaskId } = await bridgeRunStart(root, 'orch-cli-1', 'Implement feature X', linearStages());
    const epic = await loadTask(root, epicTaskId!);

    expect(epic!.status).toBe('in-progress');
    expect(epic!.parentTaskId).toBeUndefined();
    expect(epic!.claimant).toEqual({ kind: 'archetype', ref: 'orchestrator' });
    expect(epic!.external_ref).toEqual({ provider: 'orchestration', ref: 'orch-cli-1' });
  });

  it('children carry parentTaskId=epic, the right stage, archetype claimant, status open', async () => {
    const { epicTaskId, stageTaskIds } = await bridgeRunStart(
      root,
      'orch-cli-1',
      'Implement feature X',
      linearStages(),
    );

    const builder = await loadTask(root, stageTaskIds.get('builder')!);
    expect(builder!.parentTaskId).toBe(epicTaskId);
    expect(builder!.stage).toBe(1);
    expect(builder!.status).toBe('open');
    expect(builder!.claimant).toEqual({ kind: 'archetype', ref: 'builder' });
    expect(builder!.external_ref).toEqual({ provider: 'orchestration', ref: 'orch-cli-1' });
  });

  it('resolves dependsOn (agent-name edges) to upstream emitted task-ids', async () => {
    const { stageTaskIds } = await bridgeRunStart(root, 'orch-cli-1', 'X', linearStages());

    const architectId = stageTaskIds.get('architect')!;
    const builderId = stageTaskIds.get('builder')!;
    const architect = await loadTask(root, architectId);
    const builder = await loadTask(root, builderId);
    const tester = await loadTask(root, stageTaskIds.get('tester')!);

    expect(architect!.dependsOn).toBeUndefined(); // no upstream
    expect(builder!.dependsOn).toEqual([architectId]);
    expect(tester!.dependsOn).toEqual([builderId]);
  });
});

describe('bridgeStageComplete — settlement on last child', () => {
  it('stamps settledAt on the epic + writes a liveness record when the last child completes', async () => {
    const { epicTaskId, stageTaskIds } = await bridgeRunStart(
      root,
      'orch-cli-1',
      'Implement feature X',
      linearStages(),
    );

    // Progress + complete the first two children — epic must NOT settle yet.
    await bridgeStageProgress(root, stageTaskIds.get('architect'));
    await bridgeStageComplete(root, stageTaskIds.get('architect'), 'success');
    await bridgeStageProgress(root, stageTaskIds.get('builder'));
    await bridgeStageComplete(root, stageTaskIds.get('builder'), 'success');

    expect((await loadTask(root, epicTaskId!))?.settledAt).toBeUndefined();

    // The LAST child going terminal triggers settlement on the epic.
    await bridgeStageProgress(root, stageTaskIds.get('tester'));
    await bridgeStageComplete(root, stageTaskIds.get('tester'), 'success');

    const epic = await loadTask(root, epicTaskId!);
    expect(epic!.settledAt).toBeTruthy();

    const records = readLiveness(root);
    expect(records.length).toBeGreaterThanOrEqual(1);
    const last = records[records.length - 1];
    expect(last.parentTaskId).toBe(epicTaskId);
  });

  it('a failed last child (shelved) still settles the epic', async () => {
    const { epicTaskId, stageTaskIds } = await bridgeRunStart(
      root,
      'orch-cli-2',
      'X',
      [
        { agent: 'architect', stage: 0, subtask: 'a', dependsOn: [] },
        { agent: 'builder', stage: 1, subtask: 'b', dependsOn: ['architect'] },
      ],
    );

    await bridgeStageComplete(root, stageTaskIds.get('architect'), 'success');
    await bridgeStageComplete(root, stageTaskIds.get('builder'), 'failure'); // shelved → terminal

    const epic = await loadTask(root, epicTaskId!);
    expect(epic!.settledAt).toBeTruthy();
  });
});

describe('best-effort isolation — a bridge write-failure never propagates', () => {
  it('bridgeRunStart degrades to an empty handle when the task store is unwritable', async () => {
    // Make the tasks entries path a FILE so createTask's mkdirSync throws.
    const tasksDir = path.join(root, '.paradigm', 'tasks');
    fs.mkdirSync(tasksDir, { recursive: true });
    fs.writeFileSync(path.join(tasksDir, 'entries'), 'not a directory');

    const result = await bridgeRunStart(root, 'orch-fail', 'X', linearStages());

    expect(result.epicTaskId).toBeUndefined();
    expect(result.stageTaskIds.size).toBe(0);
  });

  it('bridgeStageProgress / bridgeStageComplete are no-ops (resolve false) for an undefined task-id', async () => {
    await expect(bridgeStageProgress(root, undefined)).resolves.toBe(false);
    await expect(bridgeStageComplete(root, undefined, 'success')).resolves.toBe(false);
  });

  it('bridgeStageComplete on a non-existent task-id does not throw', async () => {
    await expect(bridgeStageComplete(root, 'task-does-not-exist', 'success')).resolves.toBe(false);
  });
});
