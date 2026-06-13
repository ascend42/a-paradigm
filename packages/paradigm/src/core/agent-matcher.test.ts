/**
 * Tests for agent-matcher — T-003 roster reachability.
 *
 * Context: the static classification path in the orchestrator only ever reaches
 * the core five archetypes (architect/security/builder/reviewer/tester). Any
 * OTHER installed agent (product/North, forge/Loid, researcher/Scout, dx/Helix,
 * …) was unreachable by the auto-router. T-003 makes the trigger-based matcher
 * (`suggestAgentsForTask`) the primary suggestion source so the full installed
 * roster becomes reachable.
 *
 * `suggestAgentsForTask` is the reachability primitive the orchestrator's
 * matcher-augmentation step (orchestrator.ts → buildPlan) depends on. These
 * tests prove that primitive surfaces previously-unroutable agents. See the
 * test report for the orchestrator-integration seam left untested.
 */

import { describe, it, expect } from 'vitest';
import { suggestAgentsForTask } from './agent-matcher.js';
import type { AgentDefinition } from '../commands/team/types.js';

// ────────────────────────────────────────────────────────
// Roster fixture — core five PLUS previously-unroutable agents.
// ────────────────────────────────────────────────────────

function agent(
  name: string,
  keywords: string[],
  overrides: Partial<AgentDefinition> = {},
): AgentDefinition {
  return {
    name,
    role: `${name} agent role`,
    focus: { reads: [], writes: [] },
    triggers: keywords.length
      ? [{ type: 'keyword', match: keywords }]
      : [],
    handoff_to: [],
    ...overrides,
  };
}

/**
 * A realistic installed roster: the hardcoded core five the static router knows,
 * plus the ecosystem/role agents it could never reach.
 */
function fullRoster(): Record<string, AgentDefinition> {
  return {
    // Core five (always reachable by the static path)
    architect: agent('architect', ['design', 'architecture']),
    builder: agent('builder', ['implement', 'build']),
    security: agent('security', ['auth', 'security']),
    reviewer: agent('reviewer', ['review']),
    tester: agent('tester', ['test']),
    // Previously-unroutable installed agents (only reachable via the matcher)
    product: agent('product', ['roadmap', 'product strategy', 'prioritize', 'pricing']),
    forge: agent('forge', ['notebook', 'learning loop', 'pattern extraction']),
    researcher: agent('researcher', ['research', 'investigate', 'prior art', 'feasibility']),
    dx: agent('dx', ['developer experience', 'onboarding', 'cli ergonomics']),
  };
}

describe('suggestAgentsForTask — roster reachability (T-003)', () => {
  it('surfaces product/North for a product-strategy task it would otherwise miss', () => {
    const suggestions = suggestAgentsForTask(
      'Help shape the product roadmap and prioritize the pricing strategy',
      fullRoster(),
    );
    const names = suggestions.map(s => s.name);
    expect(names).toContain('product');
  });

  it('surfaces forge/Loid for a learning-loop task', () => {
    const suggestions = suggestAgentsForTask(
      'Improve the notebook learning loop and pattern extraction',
      fullRoster(),
    );
    expect(suggestions.map(s => s.name)).toContain('forge');
  });

  it('surfaces researcher/Scout for a research/feasibility task', () => {
    const suggestions = suggestAgentsForTask(
      'Research the prior art and feasibility of the approach',
      fullRoster(),
    );
    expect(suggestions.map(s => s.name)).toContain('researcher');
  });

  it('returns the reachable set including non-core agents, not just the core five', () => {
    const suggestions = suggestAgentsForTask(
      'Design the product roadmap and research the developer experience onboarding',
      fullRoster(),
    );
    const names = new Set(suggestions.map(s => s.name));
    // At least one previously-unroutable agent must be reachable here.
    const nonCore = ['product', 'forge', 'researcher', 'dx'];
    expect(nonCore.some(n => names.has(n))).toBe(true);
  });

  it('does not suggest agents whose triggers do not match (no spurious roster bloat)', () => {
    const suggestions = suggestAgentsForTask(
      'Implement the build for the new feature',
      fullRoster(),
    );
    const names = suggestions.map(s => s.name);
    expect(names).toContain('builder');
    // A pure build task should not drag in product/research.
    expect(names).not.toContain('product');
    expect(names).not.toContain('researcher');
  });

  it('returns an empty list when no triggers match (matcher is non-fatal/non-bloating)', () => {
    const suggestions = suggestAgentsForTask(
      'qwx zzz unmatchable gibberish token',
      fullRoster(),
    );
    expect(suggestions).toEqual([]);
  });

  it('attaches a confidence level usable by the orchestrator augmentation gate', () => {
    const suggestions = suggestAgentsForTask(
      'Improve the product roadmap, product strategy, and pricing prioritize plan',
      fullRoster(),
    );
    const product = suggestions.find(s => s.name === 'product');
    expect(product).toBeDefined();
    // Orchestrator drops `low` matches; multi-keyword hits should clear that bar.
    expect(['high', 'medium', 'low']).toContain(product!.confidence);
    expect(product!.confidence).not.toBe('low');
  });
});
