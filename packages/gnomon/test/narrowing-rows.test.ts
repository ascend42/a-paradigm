/**
 * Aegis S2 H-3 (TD-2026-10-29-746, option b): a narrowing row is honoured from any key in the chain; a granting or
 * loosening row still needs a kernel key. Pure folds: a certified session learns an Always rule (kernel key A), a
 * certless session revokes it (key X, not trusted by the next start), and a certified restart (only A trusted, X not)
 * must keep it revoked.
 */
import { describe, expect, it } from 'vitest';
import { inputHash } from '../src/kernel/supervisor/permission.js';
import { RuleBook, type RuleRow } from '../src/kernel/supervisor/rules.js';
import { isNarrowingRow } from '../src/kernel/log/narrowing.js';

const K = 'p:abcdefgh/kernel';
const A = 'gkey:v1:' + 'a'.repeat(64); // the certified kernel key
const X = 'gkey:v1:' + 'f'.repeat(64); // a certless session's key after the seal
const REPO = `sha256:${'a'.repeat(64)}`;
const CARD = 'card:01J00000000000000000000001';
const CTX = { prefixRules: true, roots: ['/work/repo'] };

const learned = (keyId: string): RuleRow[] => {
  const by = { principal: K, keyId };
  return [
    { ...by, seq: 1, kind: 'approval.request', payload: { card: { cardId: CARD, kind: 'permission' }, tool: 'Bash', tool_input: { command: 'git log -n 5' } } },
    { ...by, seq: 2, kind: 'approval.decide', payload: { cardId: CARD, decision: 'always', scope: { kind: 'prefix', prefix: ['git', 'log'] } } },
    { ...by, seq: 3, kind: 'approval.rule.learned', payload: { cardId: CARD, tool: 'Bash', match: 'prefix', prefix: ['git', 'log'], presence: 'fresh', repoKey: REPO } },
  ] as RuleRow[];
};
const fold = (rows: RuleRow[]) => {
  const b = new RuleBook({ principal: K, isKernelKey: (k) => k === A }); // the certified restart trusts A only
  for (const r of rows) b.fold(r);
  return b;
};
const matches = (b: RuleBook) => b.match(REPO, 'Bash', inputHash({ command: 'git log --oneline' }), { command: 'git log --oneline' }, CTX);

describe('H-3: narrowing rows from any key in the chain', () => {
  it('FALSIFIER: a rule learned under a certified key, revoked by a certless session, stays revoked after a certified restart', () => {
    expect(matches(fold(learned(A)))).toMatchObject({ ruleId: CARD });
    const revoked = [...learned(A), { principal: K, keyId: X, seq: 4, kind: 'approval.rule.revoked', payload: { ruleId: CARD } } as RuleRow];
    expect(matches(fold(revoked))).toBeNull();
    const off = [...learned(A), { principal: K, keyId: X, seq: 4, kind: 'approval.rule.disabled', payload: { ruleId: CARD, until: null } } as RuleRow];
    expect(matches(fold(off))).toBeNull();
  });

  it('FALSIFIER: a granting row from an untrusted key still widens nothing', () => {
    expect(matches(fold(learned(X)))).toBeNull();
  });

  it('FALSIFIER (re-check H-1): an untrusted off row that SHORTENS an indefinite off never turns the rule back on early', () => {
    const offNull = { principal: K, keyId: A, seq: 4, kind: 'approval.rule.disabled', payload: { ruleId: CARD, until: null } } as RuleRow;
    const shorter = { principal: K, keyId: X, seq: 5, kind: 'approval.rule.disabled', payload: { ruleId: CARD, until: '2000-01-01T00:00:00.000Z' } } as RuleRow;
    expect(matches(fold([...learned(A), offNull, shorter]))).toBeNull(); // still off (indefinitely), not expired in 2000
  });

  it('FALSIFIER (re-check H-1): an untrusted strictness row only ever raises', async () => {
    const { StrictnessBook } = await import('../src/kernel/broker/strictness.js');
    const b = new StrictnessBook({ principal: K, isKernelKey: (k) => k === A });
    b.fold({ seq: 1, kind: 'approval.strictness.raised', principal: K, keyId: A, payload: { repo: REPO, from: 'L0', to: 'L2' } });
    b.fold({ seq: 2, kind: 'approval.strictness.raised', principal: K, keyId: X, payload: { repo: REPO, from: 'L2', to: 'L1' } }); // a "raise" that loosens
    expect(b.level(REPO)).toBe('L2');
    b.fold({ seq: 3, kind: 'approval.strictness.raised', principal: K, keyId: X, payload: { repo: REPO, from: 'L2', to: 'L3' } });
    expect(b.level(REPO)).toBe('L3');
  });

  it('the narrowing set: pure revocations and trust drops; never a grant, a lowering or a fuse rung', () => {
    for (const k of ['approval.rule.revoked', 'grant.standing.revoked']) expect(isNarrowingRow(k, {}), k).toBe(true);
    for (const k of ['budget.ladder', 'approval.strictness.raised', 'approval.rule.disabled']) expect(isNarrowingRow(k, {}), k).toBe(false); // decided per row in their books
    expect(isNarrowingRow('tool.trust', { op: 'cleared' })).toBe(true);
    expect(isNarrowingRow('tool.trust', { op: 'dropped' })).toBe(true);
    for (const [k, p] of [['tool.trust', { op: 'set' }], ['approval.rule.learned', {}], ['approval.rule.enabled', {}], ['approval.strictness.lowered', {}], ['grant.standing', {}], ['permit.grant', {}], ['approval.mode.set', {}]] as const) expect(isNarrowingRow(k, p), k).toBe(false);
  });
});

describe('re-check H-2: loop rows keep their seq; a loop pause or tightening narrows from any key', () => {
  const KP2 = 'p:abcdefgh/kernel';
  const L = 'gkey:v1:' + 'b'.repeat(64); // a sealed legacy key, bounded to seq <= 10
  const CH = `sha256:${'c'.repeat(64)}`;
  const CH2 = `sha256:${'d'.repeat(64)}`;
  const ids = { loopId: 'nightly', scope: 'repo', repoKey: REPO };
  const mk = async () => {
    const { mkdtempSync } = await import('node:fs');
    const os = await import('node:os');
    const path = await import('node:path');
    const { LoopRegistry, loopKeyOf } = await import('../src/kernel/loops/registry.js');
    const home = mkdtempSync(path.join(os.tmpdir(), 'gnomon-narrow-'));
    const reg = new LoopRegistry({ home, kernelPrincipal: KP2, append: async () => undefined, watch: false, rescanMs: 0, isKernelKey: (k: string, s?: number) => k === A || (k === L && s !== undefined && s <= 10) } as never);
    return { reg, key: loopKeyOf('repo', REPO, 'nightly') };
  };
  it('a pre-seal pause and tightening under a bounded legacy key survive the seal (the seq reaches the check)', async () => {
    const { reg, key } = await mk();
    reg.observe({ kind: 'loop.paused', principal: KP2, keyId: L, seq: 5, payload: { ...ids, reason: 'human', by: 'p:abcdefgh/matt' } } as never);
    reg.observe({ kind: 'loop.budget.tightened', principal: KP2, keyId: L, seq: 6, payload: { ...ids, contentHash: CH, budgets: { run: { rounds: 3 } } } } as never);
    expect(reg.pauseOf(key)?.reason).toBe('human');
    expect(reg.tightenedBudgets(key, CH)?.run.rounds).toBe(3);
  });
  it('FALSIFIER: from an untrusted key a pause of a running loop and a lower cap count; replacing caps, re-pausing or resuming does not', async () => {
    const { reg, key } = await mk();
    reg.observe({ kind: 'loop.budget.tightened', principal: KP2, keyId: A, seq: 20, payload: { ...ids, contentHash: CH, budgets: { run: { rounds: 3 } } } } as never);
    reg.observe({ kind: 'loop.budget.tightened', principal: KP2, keyId: X, seq: 21, payload: { ...ids, contentHash: CH2, budgets: { run: { rounds: 99 } } } } as never);
    expect(reg.tightenedBudgets(key, CH)?.run.rounds).toBe(3);
    reg.observe({ kind: 'loop.budget.tightened', principal: KP2, keyId: X, seq: 22, payload: { ...ids, contentHash: CH, budgets: { run: { rounds: 2 } } } } as never);
    expect(reg.tightenedBudgets(key, CH)?.run.rounds).toBe(2);
    reg.observe({ kind: 'loop.paused', principal: KP2, keyId: X, seq: 23, payload: { ...ids, reason: 'human', by: 'p:abcdefgh/matt' } } as never);
    expect(reg.pauseOf(key)?.reason).toBe('human');
    reg.observe({ kind: 'loop.paused', principal: KP2, keyId: X, seq: 24, payload: { ...ids, reason: 'content-changed', by: 'kernel' } } as never);
    expect(reg.pauseOf(key)?.reason).toBe('human');
    reg.observe({ kind: 'loop.resumed', principal: KP2, keyId: X, seq: 25, payload: { ...ids } } as never);
    expect(reg.pauseOf(key)).not.toBeNull();
  });
});
