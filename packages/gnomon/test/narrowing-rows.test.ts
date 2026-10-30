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

  it('the narrowing set: revocations, denials of trust, fuse rungs, strictness raises; never a grant or a lowering', () => {
    for (const k of ['approval.rule.revoked', 'approval.rule.disabled', 'grant.standing.revoked', 'approval.strictness.raised', 'budget.ladder']) expect(isNarrowingRow(k, {}), k).toBe(true);
    expect(isNarrowingRow('tool.trust', { op: 'cleared' })).toBe(true);
    expect(isNarrowingRow('tool.trust', { op: 'dropped' })).toBe(true);
    for (const [k, p] of [['tool.trust', { op: 'set' }], ['approval.rule.learned', {}], ['approval.rule.enabled', {}], ['approval.strictness.lowered', {}], ['grant.standing', {}], ['permit.grant', {}], ['approval.mode.set', {}]] as const) expect(isNarrowingRow(k, p), k).toBe(false);
  });
});
