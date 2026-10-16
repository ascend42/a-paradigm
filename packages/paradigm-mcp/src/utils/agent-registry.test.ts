/**
 * Tests for agent-registry.ts — roster + .agent profiles are authoritative for
 * dispatch; agents.yaml is an optional overlay (TD-2026-09-26-846).
 *
 * All inputs are injected (profiles / manifest / roster) so the tests never
 * touch ~/.paradigm/agents.
 */

import { describe, it, expect } from 'vitest';
import { resolveDispatchableAgents, AGENTS_YAML_DEPRECATION } from './agent-registry.js';
import { ROLE_PROMPTS } from './role-prompts.js';
import type { AgentProfile } from '../types/agents.js';
import type { AgentManifest } from '../tools/orchestration.js';

const ROOT = '/nonexistent-root-for-agent-registry-tests';

function profile(id: string, overrides: Partial<AgentProfile> = {}): AgentProfile {
  return {
    id,
    role: `${id} role`,
    description: `${id} description`,
    version: '1.0.0',
    personality: { style: 'deliberate', risk: 'balanced', verbosity: 'concise' },
    expertise: [],
    transferable: [],
    contexts: {},
    created: '2026-01-01T00:00:00.000Z',
    updated: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function manifest(agents: AgentManifest['agents']): AgentManifest {
  return {
    version: '1.0',
    team: { name: 't', default_agent: 'builder', require_handoff: false },
    orchestration: { default_mode: 'faceted' },
    agents,
  };
}

const architectDef = {
  name: 'architect',
  role: 'Architect from agents.yaml',
  focus: { reads: ['**/*'], writes: ['docs/**'] },
  defaultModel: 'opus' as const,
};

describe('resolveDispatchableAgents', () => {
  it('dispatches roster agents absent from agents.yaml when a profile exists (forge regression)', () => {
    const r = resolveDispatchableAgents(ROOT, {
      roster: ['architect', 'forge'],
      manifest: manifest({ architect: architectDef }),
      profiles: [profile('forge', { partners: [{ id: 'architect' }, { id: 'builder' }] })],
    });
    expect(Object.keys(r.agents).sort()).toEqual(['architect', 'forge']);
    expect(r.agents.forge.handoff_to).toEqual(['architect', 'builder']);
    expect(r.undispatchable).toEqual([]);
  });

  it("reports a roster member with neither profile nor manifest entry as 'no-profile'", () => {
    const r = resolveDispatchableAgents(ROOT, {
      roster: ['architect', 'showrunner'],
      manifest: manifest({ architect: architectDef }),
      profiles: [],
    });
    expect(r.agents.showrunner).toBeUndefined();
    expect(r.undispatchable).toEqual([{ name: 'showrunner', reason: 'no-profile' }]);
  });

  it("reports a benched profile as 'benched'", () => {
    const r = resolveDispatchableAgents(ROOT, {
      roster: ['composer'],
      manifest: null,
      profiles: [profile('composer', { benched: true })],
    });
    expect(r.agents.composer).toBeUndefined();
    expect(r.undispatchable).toEqual([{ name: 'composer', reason: 'benched' }]);
  });

  it('uses the union of profile and manifest ids when there is no roster', () => {
    const r = resolveDispatchableAgents(ROOT, {
      roster: null,
      manifest: manifest({ architect: architectDef }),
      profiles: [profile('forge'), profile('cid')],
    });
    expect(Object.keys(r.agents).sort()).toEqual(['architect', 'cid', 'forge']);
  });

  it('reports manifestUsed=false and no deprecation when agents.yaml is absent', () => {
    const r = resolveDispatchableAgents(ROOT, {
      roster: ['forge'],
      manifest: null,
      profiles: [profile('forge')],
    });
    expect(r.manifestUsed).toBe(false);
    expect(r.manifest).toBeNull();
    expect(r.deprecation).toBeUndefined();
    expect(r.orchestration).toBeUndefined();
  });

  it('lets agents.yaml role/defaultModel override the profile, and surfaces the deprecation', () => {
    const r = resolveDispatchableAgents(ROOT, {
      roster: ['architect'],
      manifest: manifest({ architect: architectDef }),
      profiles: [profile('architect')],
    });
    expect(r.agents.architect.role).toBe('Architect from agents.yaml');
    expect(r.agents.architect.defaultModel).toBe('opus');
    expect(r.agents.architect.description).toBe('architect description');
    expect(r.manifestUsed).toBe(true);
    expect(r.deprecation).toBe(AGENTS_YAML_DEPRECATION);
    expect(r.orchestration?.default_mode).toBe('faceted');
  });

  it('falls back to ROLE_PROMPTS then profile.role when agents.yaml has no entry', () => {
    const r = resolveDispatchableAgents(ROOT, {
      roster: ['architect', 'forge'],
      manifest: null,
      profiles: [profile('architect'), profile('forge')],
    });
    expect(r.agents.architect.role).toBe(ROLE_PROMPTS.architect);
    expect(r.agents.forge.role).toBe('forge role');
    expect(r.agents.forge.defaultModel).toBeUndefined();
  });

  it('derives triggers from attention.concepts/symbols and focus from attention.paths', () => {
    const r = resolveDispatchableAgents(ROOT, {
      roster: ['security'],
      manifest: null,
      profiles: [profile('security', {
        attention: { concepts: ['JWT', 'RBAC'], symbols: ['^*'], paths: ['auth/**'] },
      })],
    });
    expect(r.agents.security.triggers).toEqual([
      { type: 'keyword', match: ['JWT', 'RBAC'], derived: true },
      { type: 'symbol', match: ['^*'], derived: true },
    ]);
    expect(r.agents.security.focus).toEqual({ reads: ['auth/**'], writes: ['**/*'] });
  });

  it('derives handoff_to from collaboration.with when there are no partners', () => {
    const r = resolveDispatchableAgents(ROOT, {
      roster: ['builder'],
      manifest: null,
      profiles: [profile('builder', { collaboration: { with: { architect: { stance: 'supportive' } } } })],
    });
    expect(r.agents.builder.handoff_to).toEqual(['architect']);
    expect(r.agents.builder.triggers).toBeUndefined();
  });
});
