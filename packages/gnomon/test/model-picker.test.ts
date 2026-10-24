/**
 * #session-runner model picker (founder ask 2026-10-20): the Claude model a session runs is an allow-listed alias
 * or a strict `claude-…` id. Aegis: nothing that starts with `-` reaches `--model` (its value is the NEXT argv token
 * whatever it is), no whitespace, no `=`, no path.
 */
import { describe, expect, it } from 'vitest';
import { CLAUDE_MODEL_ALIASES, claudeModelProblem, isClaudeModel } from '@a-company/gnomon-contracts';
import { assertArgv, buildClaudeArgv } from '../src/adapters/claude-code/adapter.js';

const base = { uuid: '11111111-1111-4111-8111-111111111111', policyPath: '/s/policy.json', mcpConfigPath: '/s/mcp.json', settingSources: ['user'] as const };

describe('model picker: the model value', () => {
  it.each([...CLAUDE_MODEL_ALIASES, 'claude-opus-5-5', 'claude-sonnet-4-5-20250929', 'claude-haiku-4-5', 'claude-sonnet-4-5[1m]', 'claude-3.7-sonnet'])('%s is accepted and lands as the --model value', (m) => {
    expect(isClaudeModel(m)).toBe(true);
    const a = buildClaudeArgv({ ...base, model: m });
    expect(a[a.indexOf('--model') + 1]).toBe(m);
    expect(() => assertArgv(a)).not.toThrow();
  });
  it.each([
    ['a flag', '--dangerously-skip-permissions'],
    ['a flag eaten as the value', '--verbose'],
    ['a short flag', '-p'],
    ['a lone dash', '-'],
    ['a =-form flag', '--settings=/evil.json'],
    ['whitespace', 'opus --verbose'],
    ['a newline', 'opus\n--bare'],
    ['an unknown word', 'gpt-5'],
    ['uppercase', 'Opus'],
    ['a path', '/usr/bin/opus'],
    ['an empty string', ''],
    ['too long', `claude-${'a'.repeat(80)}`],
    ['a trailing dash', 'claude-opus-'],
    ['a routing value', 'local'],
    ['shell metacharacters', 'claude-opus;rm'],
  ])('%s is refused by buildClaudeArgv (TypeError) and never reaches argv', (_n, m) => {
    expect(isClaudeModel(m)).toBe(false);
    expect(claudeModelProblem(m)).not.toBeNull();
    expect(() => buildClaudeArgv({ ...base, model: m })).toThrow(/--model refused/);
  });
  it('a non-string model is refused', () => {
    expect(() => buildClaudeArgv({ ...base, model: 42 as never })).toThrow(/--model refused/);
  });
  it('the refusal never echoes the value', () => {
    expect(claudeModelProblem('--evil-token')).not.toContain('evil');
  });
  it('no model ⇒ no --model flag (Claude Code default)', () => {
    expect(buildClaudeArgv(base)).not.toContain('--model');
  });
});
