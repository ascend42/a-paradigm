/**
 * Tests for reconcile() — the pure inbound-sync brain (Phase 2b two-way).
 * Local is canonical; only legal transitions apply; illegal ones are conflicts.
 */

import { describe, it, expect } from 'vitest';
import { reconcile, BLOCKED_FROM_REMOTE } from './reconcile.js';
import type { Task } from '../utils/task-loader.js';
import type { RemoteState } from './provider.js';

const task = (over: Partial<Task> = {}): Task => ({
  id: 'T-2026-06-14-001', blurb: 'x', priority: 'medium', status: 'open', tags: [], created: '2026-06-14T00:00:00Z', ...over,
});
const remote = (over: Partial<RemoteState> = {}): RemoteState => ({ status: 'open', assignees: [], labels: [], ...over });

describe('reconcile — state', () => {
  it('agrees when both open', () => {
    expect(reconcile(task({ status: 'open' }), remote({ status: 'open' })).kind).toBe('agree');
  });

  it('applies done when the issue is closed-completed and local is in-progress', () => {
    const p = reconcile(task({ status: 'in-progress' }), remote({ status: 'closed', closedReason: 'completed' }));
    expect(p.kind).toBe('apply');
    expect(p.targetStatus).toBe('done');
  });

  it('applies shelved when the issue is closed-not-planned', () => {
    const p = reconcile(task({ status: 'open' }), remote({ status: 'closed', closedReason: 'not-planned' }));
    expect(p.targetStatus).toBe('shelved');
  });

  it('REOPENS (symmetric) when the issue is open but local is done', () => {
    const p = reconcile(task({ status: 'done' }), remote({ status: 'open' }));
    expect(p.kind).toBe('apply');
    expect(p.targetStatus).toBe('open');
  });

  it('reopens a shelved task when the issue is open', () => {
    const p = reconcile(task({ status: 'shelved' }), remote({ status: 'open' }));
    expect(p.targetStatus).toBe('open');
  });

  it('CONFLICTS when the issue is closed-completed but local is shelved (shelved→done illegal)', () => {
    const p = reconcile(task({ status: 'shelved' }), remote({ status: 'closed', closedReason: 'completed' }));
    expect(p.kind).toBe('conflict');
    expect(p.targetStatus).toBeUndefined();
    expect(p.drift[0]).toContain('local wins');
  });
});

describe('reconcile — blocked label', () => {
  it('sets a remote-origin blocked_on when the issue gains the blocked label', () => {
    const p = reconcile(task({ status: 'open' }), remote({ labels: ['blocked'] }));
    expect(p.blocked?.set).toBe(BLOCKED_FROM_REMOTE);
    expect(p.kind).toBe('apply');
  });

  it('clears a remote-origin blocked_on when the label is gone', () => {
    const p = reconcile(task({ status: 'open', blocked_on: BLOCKED_FROM_REMOTE }), remote({ labels: [] }));
    expect(p.blocked?.clear).toBe(true);
  });

  it('NEVER clobbers a locally-authored blocked_on', () => {
    const p = reconcile(task({ status: 'open', blocked_on: 'waiting on design' }), remote({ labels: [] }));
    expect(p.blocked).toBeUndefined();
  });
});

describe('reconcile — assignee (advisory only)', () => {
  it('flags a GitHub assignee on an unclaimed task as drift, never applies it', () => {
    const p = reconcile(task({ status: 'open' }), remote({ assignees: ['octocat'] }));
    expect(p.drift.some(d => d.includes('octocat'))).toBe(true);
    expect(p.targetStatus).toBeUndefined();
  });
});
