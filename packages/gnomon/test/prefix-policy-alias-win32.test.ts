// @gnomon-platform: win32
/**
 * #prefix-policy: the win-alias gate-class rule (gateClassOf, prefix-policy.ts) is win32-only. on win32 a ':' word reads as a drive or an alternate data stream and 'HEAD~3' as an 8.3 short name (win-alias): a card, never an auto-allow.
 * Sibling: test/prefix-policy-alias-posix.test.ts.
 */
import { describe, expect, it } from 'vitest';
import { inputHash } from '../src/kernel/supervisor/permission.js';
import { RuleBook, type RuleRow } from '../src/kernel/supervisor/rules.js';

const K = 'p:abcdefgh/kernel';
const KEY = 'kernel-key';
const REPO = `sha256:${'a'.repeat(64)}`;
const CTX = { prefixRules: true, roots: ['/work/repo'] };
const CARD = `card:01J${'7'.padStart(23, '0')}`;
const PREFIX = ['git', 'log'];
const by = { principal: K, keyId: KEY };
const rows: RuleRow[] = [
  { ...by, kind: 'approval.request', payload: { card: { cardId: CARD, kind: 'permission' }, tool: 'Bash', tool_input: { command: 'git log' } } },
  { ...by, kind: 'approval.decide', payload: { cardId: CARD, decision: 'always', scope: { kind: 'prefix', prefix: PREFIX } } },
  { ...by, kind: 'approval.rule.learned', payload: { cardId: CARD, tool: 'Bash', match: 'prefix', prefix: PREFIX, presence: 'fresh', repoKey: REPO } },
];
const book = new RuleBook({ principal: K, isKernelKey: (k) => k === KEY });
for (const r of rows) book.fold(r);
const m = (command: string) => book.match(REPO, 'Bash', inputHash({ command }), { command }, CTX);

describe('#prefix-policy win-alias (win32)', () => {
  it('git log --pretty=format:%h and git log HEAD~3 under a [git, log] rule', () => {
    expect(m('git log --oneline')).not.toBeNull();
    expect(m('git log --pretty=format:%h')).toBeNull();
    expect(m('git log HEAD~3')).toBeNull();
  });
});
