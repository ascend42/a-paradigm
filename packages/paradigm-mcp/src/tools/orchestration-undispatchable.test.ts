/**
 * Tests for undispatchable reporting in planAgentSequence (TD-2026-09-26-846).
 *
 * Before Phase 0 the planner silently dropped any override / recommended agent
 * absent from agents.yaml (forge, cid, compliance, advocate…). Now dispatch is
 * fed by #agent-registry and every skipped agent is recorded.
 */

import { describe, it, expect } from 'vitest';
import { planAgentSequence, suggestAgentsForTask, type AgentDefinition, type TaskClassification, type UndispatchableAgent } from './orchestration.js';

function def(name: string): AgentDefinition {
  return { name, role: `${name} role`, focus: { reads: ['**/*'], writes: ['**/*'] } };
}

function agentsOf(...names: string[]): Record<string, AgentDefinition> {
  return Object.fromEntries(names.map(n => [n, def(n)]));
}

function plannedNames(plan: ReturnType<typeof planAgentSequence>): string[] {
  return plan.stages.flatMap(s => s.agents.map(a => a.name));
}

describe('planAgentSequence undispatchable reporting', () => {
  it("records an unknown override agent as 'unknown-override' and still plans the rest", () => {
    const plan = planAgentSequence('Design the cache', agentsOf('architect'), ['architect', 'ghost']);
    expect(plannedNames(plan)).toContain('architect');
    expect(plannedNames(plan)).not.toContain('ghost');
    expect(plan.undispatchable).toEqual([{ name: 'ghost', reason: 'unknown-override' }]);
  });

  it('plans an override agent that the resolver dispatched even without agents.yaml (silent-drop regression)', () => {
    const plan = planAgentSequence('Build the thing', agentsOf('architect', 'forge'), ['architect', 'forge']);
    expect(plannedNames(plan)).toEqual(expect.arrayContaining(['architect', 'forge']));
    expect(plan.undispatchable).toBeUndefined();
  });

  it('makes an override agent depend on the last PLANNED agent, skipping undispatchable entries', () => {
    const plan = planAgentSequence('Build the cache', agentsOf('architect', 'builder'), ['architect', 'ghost', 'builder']);
    const builder = plan.stages.flatMap(s => s.agents).find(a => a.name === 'builder');
    expect(builder?.dependsOn).toEqual(['architect']);
    expect(plan.undispatchable).toEqual([{ name: 'ghost', reason: 'unknown-override' }]);
  });

  it('keeps plan-level undispatchable separate from the roster-level list', () => {
    const roster: UndispatchableAgent[] = [{ name: 'showrunner', reason: 'no-profile' }];
    const plan = planAgentSequence('Design the cache', agentsOf('architect'), ['architect'],
      undefined, undefined, undefined, roster);
    expect(plan.undispatchable).toBeUndefined();
    expect(roster).toEqual([{ name: 'showrunner', reason: 'no-profile' }]);
  });

  it('records a classification-recommended agent that is not dispatchable, using the resolver reason', () => {
    const classification: TaskClassification = {
      type: 'bugfix',
      confidence: 0.9,
      overrideHint: '',
      complexity: 'simple',
      recommendedAgents: ['architect', 'forge', 'composer'],
      securityRequired: false,
      costMultiplier: { min: 1, max: 1 },
      matchedKeywords: [],
      symbols: [],
    };
    // Resolver pre-seeded 'composer' as benched; 'forge' is simply absent.
    const seed: UndispatchableAgent[] = [{ name: 'composer', reason: 'benched' }];
    const plan = planAgentSequence('Fix the crash', agentsOf('architect'), undefined,
      classification, undefined, undefined, seed);
    expect(plannedNames(plan)).toContain('architect');
    expect(plan.undispatchable).toEqual([
      { name: 'forge', reason: 'unknown-override' },
      { name: 'composer', reason: 'benched' },
    ]);
  });
});

describe('suggestAgentsForTask with profile-derived triggers', () => {
  function derivedAgent(name: string, concepts: string[]): AgentDefinition {
    return { ...def(name), triggers: [{ type: 'keyword', match: concepts, derived: true }] };
  }
  const agents = {
    dba: derivedAgent('dba', ['database', 'schema', 'migration', 'index', 'view']),
    educator: derivedAgent('educator', ['study', 'quiz', 'test', 'exam']),
    finance: derivedAgent('finance', ['revenue', 'MRR', 'ARR', 'runway']),
  };
  const names = (task: string) => suggestAgentsForTask(task, agents).map(s => s.name);

  it('does not suggest dba for a single incidental concept ("review the index code")', () => {
    expect(names('review the index code')).not.toContain('dba');
  });

  it('does not match concepts as substrings ("latest array")', () => {
    const n = names('latest array');
    expect(n).not.toContain('educator');
    expect(n).not.toContain('finance');
  });

  it('still suggests on a real concept hit, case-insensitively', () => {
    expect(names('Add a Database migration for the users Schema')).toContain('dba');
    expect(names('model MRR and runway')).toContain('finance');
  });

  it('keeps substring matching for explicit agents.yaml triggers', () => {
    const explicit = { tester: { ...def('tester'), triggers: [{ type: 'keyword' as const, match: ['test'] }] } };
    expect(suggestAgentsForTask('latest array', explicit).map(s => s.name)).toContain('tester');
  });
});
