/**
 * Tests for the SyncProvider registry (#sync-provider) + claimant projection.
 *
 * - register/get round-trips a factory and memoizes the instance.
 * - getProvider(unknown) → undefined (the explicit local-only signal).
 * - projectClaimant encodes Loid's outbound rule (human→assignee;
 *   archetype/peer→unassigned + typed marker label, never false-assign).
 */

import { describe, it, expect, beforeEach } from 'vitest';

import { registerProvider, getProvider, _resetRegistry } from './registry.js';
import { projectClaimant } from './claimant-projection.js';
import type { SyncProvider, ProviderCapabilities, PushResult } from './provider.js';

function stubProvider(id: string): SyncProvider {
  return {
    id,
    capabilities: (): ProviderCapabilities => ({ push: true, comment: false, pull: false, close: false }),
    isAvailable: async () => true,
    push: async (): Promise<PushResult> => ({ ref: `${id}#1` }),
    comment: async () => undefined,
  };
}

describe('sync registry', () => {
  beforeEach(() => _resetRegistry());

  it('registers and resolves a provider by id', () => {
    registerProvider('stub', () => stubProvider('stub'));
    const p = getProvider('stub');
    expect(p).toBeDefined();
    expect(p!.id).toBe('stub');
  });

  it('returns undefined for an unregistered id (local-only signal)', () => {
    expect(getProvider('nope')).toBeUndefined();
  });

  it('memoizes the instance across lookups', () => {
    let constructed = 0;
    registerProvider('memo', () => {
      constructed++;
      return stubProvider('memo');
    });
    const a = getProvider('memo');
    const b = getProvider('memo');
    expect(a).toBe(b);
    expect(constructed).toBe(1);
  });

  it('re-registering replaces the factory and drops the cached instance', () => {
    registerProvider('x', () => stubProvider('x'));
    const first = getProvider('x');
    registerProvider('x', () => stubProvider('x'));
    const second = getProvider('x');
    expect(second).not.toBe(first);
  });
});

describe('projectClaimant (Loid\'s outbound rule)', () => {
  it('human → assignee = ref, no marker label', () => {
    expect(projectClaimant({ kind: 'human', ref: 'matt@x.com' }))
      .toEqual({ assignee: 'matt@x.com', labels: [] });
  });

  it('archetype → unassigned + paradigm:agent/<ref> label', () => {
    expect(projectClaimant({ kind: 'archetype', ref: 'builder' }))
      .toEqual({ labels: ['paradigm:agent/builder'] });
  });

  it('peer → unassigned + paradigm:peer/<ref> label', () => {
    expect(projectClaimant({ kind: 'peer', ref: 'agent-7' }))
      .toEqual({ labels: ['paradigm:peer/agent-7'] });
  });

  it('no claimant → empty projection', () => {
    expect(projectClaimant(undefined)).toEqual({ labels: [] });
  });

  it('never sets an assignee for a non-human claimant', () => {
    expect(projectClaimant({ kind: 'archetype', ref: 'forge' }).assignee).toBeUndefined();
    expect(projectClaimant({ kind: 'peer', ref: 'p1' }).assignee).toBeUndefined();
  });
});
