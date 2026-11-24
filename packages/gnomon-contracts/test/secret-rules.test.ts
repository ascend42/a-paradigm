/** secret-rules: the one pattern table (S1.2 ruling O4). The kernel's redactor is tested in gnomon (G-LOOP-27). */
import { describe, expect, it } from 'vitest';
import { SECRET_RULE_KINDS, SECRET_RULES, compileSecretRules, secretKindsIn } from '../src/secret-rules.js';
import { CLIENT_API_DESCRIPTOR } from '../src/client-api.js';

describe('secret-rules', () => {
  it('is a frozen ordered table of global rules that compile', () => {
    expect(Object.isFrozen(SECRET_RULES) && SECRET_RULES.every((r) => Object.isFrozen(r))).toBe(true);
    expect(SECRET_RULES.map((r) => r.kind)).toEqual([
      'private-key', 'private-key', 'aws-access-key', 'aws-secret', 'github-token', 'slack-token', 'anthropic-key', 'openai-key', 'jwt', 'npm-token', 'stripe-key', 'gitlab-token', 'url-password', 'google-api-key', 'bearer', 'generic-secret',
    ]);
    expect(SECRET_RULE_KINDS).toHaveLength(15);
    const compiled = compileSecretRules();
    expect(compiled).toHaveLength(SECRET_RULES.length);
    compiled.forEach((c, i) => {
      expect(c.re.source).toBe(new RegExp(SECRET_RULES[i]!.source).source);
      expect(c.re.global).toBe(true);
      expect(c.re.flags).toBe(SECRET_RULES[i]!.flags);
      expect(c.group).toBe(SECRET_RULES[i]!.group);
    });
    expect(compileSecretRules()[0]!.re).not.toBe(compiled[0]!.re);
  });

  it('secretKindsIn reports kinds only, each once, and keeps no state between calls', () => {
    const aws = `AKIA${'Q7RX'.repeat(4)}`;
    const gh = `ghp_${'a1B2'.repeat(9)}`;
    for (let i = 0; i < 3; i++) expect(secretKindsIn(`a ${aws} b ${aws} c ${gh}`)).toEqual(['aws-access-key', 'github-token']);
    expect(secretKindsIn(`postgres://user:${'p4ss'.repeat(3)}@db.invalid/x`)).toEqual(['url-password']);
    expect(secretKindsIn('-----BEGIN RSA PRIVATE KEY-----\nabc')).toEqual(['private-key']);
    expect(secretKindsIn('An ordinary sentence about tokens and keys.')).toEqual([]);
    expect(secretKindsIn('')).toEqual([]);
  });

  it('is not an input of the client API descriptor', () => {
    const text = JSON.stringify(CLIENT_API_DESCRIPTOR);
    expect(text.includes('PRIVATE KEY')).toBe(false);
    expect(text.includes('generic-secret')).toBe(false);
  });
});
