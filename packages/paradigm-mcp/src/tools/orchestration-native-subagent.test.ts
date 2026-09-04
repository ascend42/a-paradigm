/**
 * Tests for native plugin-agent launch wiring (fix/sync-plugin-agents-to-claude-agents-dir).
 *
 * The paradigm Claude Code plugin ships five agents at plugins/paradigm/agents/
 * (architect, builder, reviewer, security, tester), loaded namespaced as
 * `paradigm:<role>` WITH real role-scoped tool guardrails. Execute-mode stage
 * agents must carry a `nativeSubagentType` of `paradigm:<role>` for those five
 * roles so a launcher can spawn them with their restrictions — while the portable
 * `subagentType: 'general-purpose'` default is preserved for every agent (the
 * fallback for hosts without namespaced plugin agents and for archetypes with no
 * plugin .md).
 */

import { describe, it, expect } from 'vitest';
import { buildAgentPromptInternal, PLUGIN_AGENT_ROLES } from './orchestration.js';

/** Minimal AgentDefinition sufficient for prompt assembly. */
function agentDef(name: string) {
  return {
    name,
    role: `${name} role`,
    focus: { reads: ['**/*'], writes: ['**/*'] },
  } as any;
}

function build(name: string) {
  return buildAgentPromptInternal({
    agent: agentDef(name),
    task: 'Implement feature X',
    symbols: ['#feature-x'],
  });
}

describe('native plugin-agent launch wiring', () => {
  const CORE_FIVE = ['architect', 'builder', 'reviewer', 'security', 'tester'];

  it('exposes exactly the five plugin-shipped roles as PLUGIN_AGENT_ROLES', () => {
    expect([...PLUGIN_AGENT_ROLES].sort()).toEqual([...CORE_FIVE].sort());
  });

  for (const role of CORE_FIVE) {
    it(`sets nativeSubagentType to paradigm:${role} for the core-5 role "${role}"`, () => {
      const result = build(role);
      expect(result.nativeSubagentType).toBe(`paradigm:${role}`);
      // Portable default is unchanged.
      expect(result.subagentType).toBe('general-purpose');
    });
  }

  for (const role of ['advocate', 'captain', 'compliance', 'documentor', 'some-noncore']) {
    it(`leaves nativeSubagentType undefined for the non-core role "${role}"`, () => {
      const result = build(role);
      expect(result.nativeSubagentType).toBeUndefined();
      // Portable default is still general-purpose.
      expect(result.subagentType).toBe('general-purpose');
    });
  }

  it('a mixed roster (core + non-core) marks only the core member', () => {
    const architect = build('architect');
    const nonCore = build('some-noncore');
    expect(architect.nativeSubagentType).toBe('paradigm:architect');
    expect(nonCore.nativeSubagentType).toBeUndefined();
    // subagentType is the portable default for BOTH.
    expect(architect.subagentType).toBe('general-purpose');
    expect(nonCore.subagentType).toBe('general-purpose');
  });

  it('native id is always paradigm:<role>, never bare or aliased', () => {
    for (const role of CORE_FIVE) {
      expect(build(role).nativeSubagentType).toMatch(/^paradigm:[a-z]+$/);
    }
  });
});
