import { describe, expect, it } from 'vitest';
import {
  APPROVE_SCOPE_KINDS,
  CLIENT_API_DESCRIPTOR,
  DECISION_SIG_DESCRIPTOR,
  DECISION_SIG_V2_MARKER,
  canonicalJson,
  decisionMessageV2,
  parseApproveScope,
  scopeDigest,
  sha256Tagged,
} from '../src/index.js';

// TD-2026-10-20-294 part 3: approve{scope} for prefix-scoped always rules (a deliberate clientApiId move).
describe('approve scope (TD-2026-10-20-294)', () => {
  it('approve publishes the scope param and the closed kinds', () => {
    const approve = CLIENT_API_DESCRIPTOR.verbs.find((v) => v.verb === 'approve')!;
    expect(approve.params).toContain('scope?');
    expect([...APPROVE_SCOPE_KINDS]).toEqual(['exact', 'prefix', 'file', 'repo-edits', 'tool']);
  });

  it('scoped edits (TD-2026-10-23-939 follow-up): file and repo-edits carry no other key; their digest is over the kind alone', () => {
    expect(parseApproveScope({ kind: 'file' })).toEqual({ kind: 'file' });
    expect(parseApproveScope({ kind: 'repo-edits' })).toEqual({ kind: 'repo-edits' });
    for (const bad of [{ kind: 'file', path: '/x' }, { kind: 'repo-edits', repo: 'x' }, { kind: 'repo' }]) expect(parseApproveScope(bad), JSON.stringify(bad)).toBeNull();
    expect(scopeDigest({ kind: 'file' })).not.toBe(scopeDigest({ kind: 'repo-edits' }));
    expect(scopeDigest({ kind: 'prefix', prefix: ['git', 'log'] })).toBe(scopeDigest({ kind: 'prefix', prefix: ['git', 'log'] }));
  });

  it('parses exact and 1-3 word prefixes only', () => {
    expect(parseApproveScope({ kind: 'exact' })).toEqual({ kind: 'exact' });
    expect(parseApproveScope({ kind: 'prefix', prefix: ['git', 'log'] })).toEqual({ kind: 'prefix', prefix: ['git', 'log'] });
    for (const bad of [
      null,
      'prefix',
      [],
      { kind: 'prefix', prefix: [] },
      { kind: 'prefix', prefix: ['a', 'b', 'c', 'd'] },
      { kind: 'prefix', prefix: [''] },
      { kind: 'prefix', prefix: ['git\nrm'] },
      { kind: 'prefix', prefix: [1] },
      { kind: 'prefix', prefix: ['git'], extra: 1 },
      { kind: 'exact', prefix: ['git'] },
      { kind: 'glob', prefix: ['git*'] },
    ]) expect(parseApproveScope(bad), JSON.stringify(bad)).toBeNull();
  });

  it('the scope digest is sha256 over canonicalJson of the scope', () => {
    expect(scopeDigest({ kind: 'prefix', prefix: ['git', 'log'] })).toBe(sha256Tagged(canonicalJson({ kind: 'prefix', prefix: ['git', 'log'] })));
    expect(scopeDigest({ kind: 'prefix', prefix: ['git', 'log'] })).not.toBe(scopeDigest({ kind: 'prefix', prefix: ['git'] }));
  });

  it('decisionSig binds the scope: the descriptor vector is the v2 layout with the scope digest last', () => {
    const v = DECISION_SIG_DESCRIPTOR.scope.vector;
    const lines = v.message.split('\n');
    expect(lines[0]).toBe(DECISION_SIG_V2_MARKER);
    expect(lines[2]).toBe('always');
    expect(lines[5]).toBe(v.scopeDigest);
    expect(v.message).toBe(decisionMessageV2({ ...DECISION_SIG_DESCRIPTOR.v2.vector.inputs, decision: 'always', answerDigest: scopeDigest({ kind: 'prefix', prefix: ['git', 'log'] }) }));
  });
});
