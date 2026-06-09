/**
 * Tests for the stateless iteration-loop primitive (TD-2026-06-09-522).
 *
 * The spawner is mocked to return scripted SpawnResults with embedded
 * ```iteration-verdict blocks, and promotion is injected as a spy — so no real
 * agents spawn and no files are written.
 */

import { describe, it, expect, vi } from 'vitest';
import { Orchestrator } from './orchestrator.js';
import type { SpawnResult } from './agent-spawner.js';
import type { IterationDelta, IterationOptions } from './iteration-types.js';

// ── Helpers ──────────────────────────────────────────────────────────────

function verdictBlock(delta: Partial<IterationDelta>): string {
  return 'Round work summary.\n```iteration-verdict\n' + JSON.stringify({
    verdict: delta.verdict ?? 'changes-requested',
    whatChanged: delta.whatChanged ?? [],
    alreadyVerified: delta.alreadyVerified ?? [],
    openThreads: delta.openThreads ?? [],
    corrections: delta.corrections ?? [],
  }) + '\n```';
}

function makeResult(opts: {
  success?: boolean;
  delta?: Partial<IterationDelta>;
  rawContext?: string;
  symbols?: string[];
}): SpawnResult {
  const { success = true, delta, rawContext, symbols = [] } = opts;
  const context = rawContext !== undefined ? rawContext : (delta ? verdictBlock(delta) : '');
  return {
    success,
    sessionId: 'test',
    relay: {
      agent: 'builder',
      task: 't',
      status: success ? 'success' : 'failed',
      outputs: { artifacts: [], symbols, decisions: [] },
      handoff: context ? { to: '', reason: '', context } : undefined,
      metrics: { tokens_used: { input: 10, output: 5, total: 15 }, duration_ms: 1, files_read: 0, files_written: 0 },
    },
  };
}

function makeOrchestrator(results: SpawnResult[]) {
  const spawn = vi.fn();
  for (const r of results) spawn.mockResolvedValueOnce(r);
  const orch = new Orchestrator('/tmp/iteration-loop-test');
  // Replace the real spawner with a mock — no provider init, no spawning.
  (orch as unknown as { spawner: { spawn: typeof spawn } }).spawner = { spawn };
  return { orch, spawn };
}

const pingPong = (over: Partial<IterationOptions> = {}): IterationOptions => ({
  maxRounds: 5, mode: 'ping-pong', iterateAgent: 'builder', reviewAgent: 'reviewer', ...over,
});
const singleRole = (over: Partial<IterationOptions> = {}): IterationOptions => ({
  maxRounds: 3, mode: 'single-role', iterateAgent: 'builder', ...over,
});

// ── Validation ─────────────────────────────────────────────────────────────

describe('runIterationLoop validation', () => {
  it('throws when maxRounds < 1 (no implicit infinite loop)', async () => {
    const { orch } = makeOrchestrator([]);
    await expect(orch.runIterationLoop('t', singleRole({ maxRounds: 0 }))).rejects.toThrow(/maxRounds/);
  });

  it('throws when ping-pong mode has no reviewAgent', async () => {
    const { orch } = makeOrchestrator([]);
    await expect(
      orch.runIterationLoop('t', { maxRounds: 3, mode: 'ping-pong', iterateAgent: 'builder' }),
    ).rejects.toThrow(/reviewAgent/);
  });
});

// ── Delta assembly / threading ───────────────────────────────────────────────

describe('runIterationLoop delta threading', () => {
  it('threads round-1 open threads into the round-2 task', async () => {
    const { orch, spawn } = makeOrchestrator([
      makeResult({ delta: { verdict: 'changes-requested', whatChanged: ['did A'], openThreads: ['fix the null check'] } }),
      makeResult({ delta: { verdict: 'approved', openThreads: [] } }),
    ]);
    await orch.runIterationLoop('Build the widget', singleRole());
    const round2Task = spawn.mock.calls[1][1] as string;
    expect(round2Task).toContain('fix the null check');
    expect(round2Task).toContain('Iteration delta (entering round 2)');
  });
});

// ── Convergence + termination ────────────────────────────────────────────────

describe('runIterationLoop convergence', () => {
  it('ping-pong: stops the moment the reviewer approves', async () => {
    const { orch, spawn } = makeOrchestrator([
      makeResult({ delta: { verdict: 'changes-requested', openThreads: ['x'] } }), // round 1: builder
      makeResult({ delta: { verdict: 'approved' } }),                              // round 2: reviewer
      makeResult({ delta: { verdict: 'approved' } }),                              // should never run
    ]);
    const res = await orch.runIterationLoop('t', pingPong());
    expect(res.converged).toBe(true);
    expect(res.rounds).toHaveLength(2);
    expect(spawn).toHaveBeenCalledTimes(2);
    expect(res.rounds[1].agent).toBe('reviewer');
  });

  it('ping-pong: a fixer self-approving does NOT converge; only the reviewer ends it', async () => {
    const { orch, spawn } = makeOrchestrator([
      makeResult({ delta: { verdict: 'approved' } }),                // round 1: builder (fixer) self-approves — must be ignored
      makeResult({ delta: { verdict: 'approved' } }),                // round 2: reviewer approves — authoritative
      makeResult({ delta: { verdict: 'approved' } }),                // should never run
    ]);
    const res = await orch.runIterationLoop('t', pingPong());
    expect(res.converged).toBe(true);
    expect(res.rounds).toHaveLength(2);
    expect(res.rounds[1].agent).toBe('reviewer');
    expect(spawn).toHaveBeenCalledTimes(2);
  });

  it('single-role: approved with open threads does NOT converge; empty threads does', async () => {
    const { orch } = makeOrchestrator([
      makeResult({ delta: { verdict: 'approved', openThreads: ['still leaks'] } }), // weak self-approval
      makeResult({ delta: { verdict: 'approved', openThreads: [] } }),              // real convergence
    ]);
    const res = await orch.runIterationLoop('t', singleRole({ maxRounds: 2 }));
    expect(res.converged).toBe(true);
    expect(res.rounds).toHaveLength(2);
  });

  it('max-rounds without convergence → structured unresolved, surfacing open threads', async () => {
    const { orch } = makeOrchestrator([
      makeResult({ delta: { verdict: 'changes-requested', openThreads: ['a'] } }),
      makeResult({ delta: { verdict: 'changes-requested', openThreads: ['a', 'b'] } }),
    ]);
    const res = await orch.runIterationLoop('t', singleRole({ maxRounds: 2 }));
    expect(res.converged).toBe(false);
    expect(res.unresolved?.reason).toBe('max-rounds');
    expect(res.unresolved?.roundsRun).toBe(2);
    expect(res.unresolved?.openThreads).toEqual(['a', 'b']);
  });

  it('unparseable verdict → unresolved, never treated as a pass', async () => {
    const { orch, spawn } = makeOrchestrator([
      makeResult({ rawContext: 'I finished but emitted no verdict block.' }),
      makeResult({ delta: { verdict: 'approved' } }), // should never run
    ]);
    const res = await orch.runIterationLoop('t', singleRole());
    expect(res.converged).toBe(false);
    expect(res.unresolved?.reason).toBe('unparseable-verdict');
    expect(spawn).toHaveBeenCalledTimes(1);
  });

  it('spawn failure → unresolved spawn-failed, stops immediately', async () => {
    const { orch, spawn } = makeOrchestrator([
      makeResult({ success: false }),
      makeResult({ delta: { verdict: 'approved' } }), // should never run
    ]);
    const res = await orch.runIterationLoop('t', singleRole());
    expect(res.converged).toBe(false);
    expect(res.unresolved?.reason).toBe('spawn-failed');
    expect(spawn).toHaveBeenCalledTimes(1);
  });
});

// ── Belief-revision promotion gating (guardrail #3) ──────────────────────────

describe('runIterationLoop promotion gating', () => {
  it('promotes when a round reports explicit corrections', async () => {
    const promote = vi.fn();
    const { orch } = makeOrchestrator([
      makeResult({ delta: { verdict: 'changes-requested', corrections: ['was: skip null; now: null is reachable'], openThreads: ['t'] }, symbols: ['#widget'] }),
      makeResult({ delta: { verdict: 'approved' } }),
    ]);
    await orch.runIterationLoop('t', singleRole({ maxRounds: 2 }), promote);
    expect(promote).toHaveBeenCalledTimes(1);
    expect(promote.mock.calls[0][0]).toMatchObject({
      corrections: ['was: skip null; now: null is reachable'],
      symbols: ['#widget'],
      round: 1,
    });
  });

  it('promotes when a previously-settled claim is re-opened (settled→changed)', async () => {
    const promote = vi.fn();
    const { orch } = makeOrchestrator([
      makeResult({ delta: { verdict: 'changes-requested', alreadyVerified: ['auth path is safe'], openThreads: ['perf'] } }),
      makeResult({ delta: { verdict: 'approved', whatChanged: ['auth path is safe'], openThreads: [] } }),
    ]);
    await orch.runIterationLoop('t', singleRole({ maxRounds: 2 }), promote);
    // round 2 re-touched a settled claim → belief revised even with empty corrections
    expect(promote).toHaveBeenCalledTimes(1);
    expect(promote.mock.calls[0][0].round).toBe(2);
  });

  it('does NOT promote a "re-verified, nothing changed" round', async () => {
    const promote = vi.fn();
    const { orch } = makeOrchestrator([
      makeResult({ delta: { verdict: 'approved', whatChanged: [], corrections: [], openThreads: [] } }),
    ]);
    const res = await orch.runIterationLoop('t', singleRole({ maxRounds: 1 }), promote);
    expect(res.converged).toBe(true);
    expect(promote).not.toHaveBeenCalled();
  });
});
