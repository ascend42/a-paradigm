/**
 * #always-rules RC5 (TD-2026-10-20-086): an exact Bash `always` rule also matches by sha256 over `{command}` alone, so
 * Claude's fresh free-text `description` (or a timeout) re-matches; any other key (run_in_background, …) on either
 * side still raises the card; a rule learned from a whole-input request (the old rows) matches both ways; a
 * different command, repo or tool never matches.
 */
import { describe, expect, it } from 'vitest';
import { inputHash } from '../src/kernel/supervisor/permission.js';
import { bashCommandHash, RuleBook, type RuleRow } from '../src/kernel/supervisor/rules.js';

const K = 'p:abcdefgh/kernel';
const KEY = 'kernel-key';
const REPO = `sha256:${'a'.repeat(64)}`;
const OTHER = `sha256:${'b'.repeat(64)}`;
const CARD = `card:01J${'1'.padStart(23, '0')}`;

function bookOf(input: Record<string, unknown>, tool = 'Bash'): RuleBook {
  const b = new RuleBook({ principal: K, isKernelKey: (k) => k === KEY });
  const rows: RuleRow[] = [
    { principal: K, keyId: KEY, kind: 'approval.request', payload: { card: { cardId: CARD, kind: 'permission' }, tool, tool_input: input } },
    { principal: K, keyId: KEY, kind: 'approval.decide', payload: { cardId: CARD, decision: 'always' } },
    { principal: K, keyId: KEY, kind: 'approval.rule.learned', payload: { cardId: CARD, tool, matchExact: true, presence: 'fresh', repoKey: REPO } },
  ];
  rows.forEach((r, i) => b.fold({ ...r, seq: i + 1 }));
  return b;
}
const m = (b: RuleBook, input: Record<string, unknown>, repo = REPO, tool = 'Bash') => b.match(repo, tool, inputHash(input), input);

describe('#always-rules RC5: Bash rules hash over {command}', () => {
  const learned = { command: 'npm test', description: 'run the tests', timeout: 60000 };
  it('a different description (or timeout, or none) still matches', () => {
    const b = bookOf(learned);
    expect(m(b, { command: 'npm test', description: 'Run the unit tests again' })?.ruleId).toBe(CARD);
    expect(m(b, { command: 'npm test', timeout: 5 })?.ruleId).toBe(CARD);
    expect(m(b, { command: 'npm test' })?.ruleId).toBe(CARD);
  });
  it('run_in_background (or any other key) on the later input still raises the card', () => {
    const b = bookOf(learned);
    expect(m(b, { command: 'npm test', description: 'x', run_in_background: true })).toBeNull();
    expect(m(b, { command: 'npm test', dangerouslyDisableSandbox: false })).toBeNull();
  });
  it('a rule learned with run_in_background matches only its exact whole input', () => {
    const bg = { command: 'npm test', run_in_background: true };
    const b = bookOf(bg);
    expect(m(b, bg)?.ruleId).toBe(CARD);
    expect(m(b, { command: 'npm test' })).toBeNull();
    expect(m(b, { command: 'npm test', run_in_background: true, description: 'new' })).toBeNull();
  });
  it('an old whole-input rule still matches (exactly, and by command)', () => {
    const b = bookOf(learned);
    expect(m(b, learned)?.ruleId).toBe(CARD);
    expect(b.match(REPO, 'Bash', inputHash(learned))?.ruleId).toBe(CARD); // no toolInput: the whole hash alone
  });
  it('a different command, repo or tool never matches', () => {
    const b = bookOf(learned);
    expect(m(b, { command: 'npm test ', description: 'run the tests' })).toBeNull();
    expect(m(b, { command: 'npm test' }, OTHER)).toBeNull();
    const w = bookOf({ command: 'npm test' }, 'PowerShell');
    expect(m(w, { command: 'npm test', description: 'x' }, REPO, 'PowerShell')).toBeNull();
  });
  it('bashCommandHash is the {command} hash, or null for another key or a non-text command', () => {
    expect(bashCommandHash({ command: 'ls', description: 'd' })).toBe(inputHash({ command: 'ls' }));
    expect(bashCommandHash({ command: 'ls', run_in_background: true })).toBeNull();
    expect(bashCommandHash({ command: 1 })).toBeNull();
    expect(bashCommandHash(null)).toBeNull();
  });
});
