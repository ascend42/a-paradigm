/**
 * The Classroom — scenario bank (TD-2026-06-19-007).
 *
 * Proves: record → load → loadScenariosForAgent filter; appendScenarioOutcome
 * appends history and bumps repeat_failures on a `broke`; rebuildScenarioIndex
 * rolls up active/retired/byOrigin.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

import {
  recordScenario,
  loadScenarios,
  loadScenario,
  loadScenariosForAgent,
  appendScenarioOutcome,
  rebuildScenarioIndex,
} from './scenario-loader.js';

let projectDir: string;

beforeEach(() => {
  projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'scn-project-'));
});

afterEach(() => {
  fs.rmSync(projectDir, { recursive: true, force: true });
});

const make = (id: string, agent: string, origin: 'authored' | 'poison-pill' = 'authored') => ({
  id,
  scenario: `breaking probe for ${id}`,
  probes: [{ agent, learning_ref: `nb-${agent}-x`, claim: 'asserts X' }],
  origin,
  expected: { must: 'survive' as const },
});

describe('recordScenario / load', () => {
  it('records → loads → fetches by id', async () => {
    await recordScenario(projectDir, make('SC-a', 'builder'));
    const all = await loadScenarios(projectDir);
    expect(all).toHaveLength(1);
    expect(all[0].id).toBe('SC-a');
    expect(all[0].status).toBe('active');
    expect(all[0].repeat_failures).toBe(0);

    const one = await loadScenario(projectDir, 'SC-a');
    expect(one?.scenario).toContain('SC-a');
  });

  it('create-if-absent: a second record with the same id does not clobber history', async () => {
    await recordScenario(projectDir, make('SC-a', 'builder'));
    await appendScenarioOutcome(projectDir, 'SC-a', {
      term: 't1', agent: 'builder', result: 'broke', assessor: 'jinx', human_confirmed: true, at: 'now',
    });
    // Re-record same id → must NOT wipe the appended outcome.
    await recordScenario(projectDir, make('SC-a', 'builder'));
    const one = await loadScenario(projectDir, 'SC-a');
    expect(one?.outcome_history).toHaveLength(1);
    expect(one?.repeat_failures).toBe(1);
  });
});

describe('loadScenariosForAgent', () => {
  it('filters to scenarios whose probes target the agent', async () => {
    await recordScenario(projectDir, make('SC-builder', 'builder'));
    await recordScenario(projectDir, make('SC-mika', 'mika'));

    const builderScenarios = await loadScenariosForAgent(projectDir, 'builder');
    expect(builderScenarios.map(s => s.id)).toEqual(['SC-builder']);

    const mikaScenarios = await loadScenariosForAgent(projectDir, 'mika');
    expect(mikaScenarios.map(s => s.id)).toEqual(['SC-mika']);
  });
});

describe('appendScenarioOutcome', () => {
  it('appends history and bumps repeat_failures only on a broke', async () => {
    await recordScenario(projectDir, make('SC-a', 'builder'));

    expect(await appendScenarioOutcome(projectDir, 'SC-a', {
      term: 't1', agent: 'builder', result: 'survived', assessor: 'cid', human_confirmed: true, at: 'now',
    })).toBe(true);
    let one = await loadScenario(projectDir, 'SC-a');
    expect(one?.repeat_failures).toBe(0); // survived does not bump

    await appendScenarioOutcome(projectDir, 'SC-a', {
      term: 't2', agent: 'builder', result: 'broke', assessor: 'jinx', human_confirmed: true, at: 'now',
    });
    one = await loadScenario(projectDir, 'SC-a');
    expect(one?.outcome_history).toHaveLength(2);
    expect(one?.repeat_failures).toBe(1); // broke bumps

    // Missing scenario → false.
    expect(await appendScenarioOutcome(projectDir, 'SC-nope', {
      term: 't1', agent: 'builder', result: 'broke', assessor: 'x', human_confirmed: false, at: 'now',
    })).toBe(false);
  });
});

describe('rebuildScenarioIndex', () => {
  it('rolls up active/retired and byOrigin', async () => {
    await recordScenario(projectDir, make('SC-a', 'builder', 'authored'));
    await recordScenario(projectDir, make('SC-b', 'mika', 'poison-pill'));

    const index = await rebuildScenarioIndex(projectDir);
    expect(index.health.total).toBe(2);
    expect(index.health.active).toBe(2);
    expect(index.health.byOrigin.authored).toBe(1);
    expect(index.health.byOrigin['poison-pill']).toBe(1);
    expect(fs.existsSync(path.join(projectDir, '.paradigm', 'curriculum', 'scenarios', 'index.yaml'))).toBe(true);
  });
});
