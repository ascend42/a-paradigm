/**
 * 8.0:local-lane (TD-2026-10-27-833 slice C5'a1, #mcp-servers trust, ^local-tool-grant contract half): the tool.trust
 * kind (closed, kernel-owned), the `tool` approve scope and rule match, the learned row's bindHash and the widened rule
 * tool name. One clientApiId move.
 */
import { describe, expect, it } from 'vitest';
import {
  ALWAYS_RULE_MATCHES,
  APPROVE_SCOPE_KINDS,
  CLIENT_API_DESCRIPTOR,
  CLIENT_API_ID,
  EVENT_KINDS,
  KIND_PAYLOADS,
  RESERVED_PAYLOAD_FIELDS,
  TOOL_NAME,
  TOOL_TRUST_OPS,
  TOOL_TRUST_WHYS,
  canonicalJson,
  parseApproveScope,
  scopeDigest,
  sha256Tagged,
  validateAlwaysRuleMatch,
  validateKindPayload,
} from '../src/index.js';

const H = `sha256:${'a'.repeat(64)}`;
const L = `hmac-sha256:${'b'.repeat(64)}`;
const set = { id: 'user::neurons', label: 'neurons', op: 'set', binding: H, why: 'human', launchHash: L, toolsHash: H };

describe("tool.trust (8.0:local-lane C5'a1)", () => {
  it('is a kernel kind with a closed payload and closed op/why', () => {
    expect(EVENT_KINDS['tool.trust']).toMatchObject({ kind: 'tool.trust', owner: 'kernel', reserved: '8.0:local-lane' });
    expect(KIND_PAYLOADS['tool.trust']).toEqual(['id', 'label', 'op', 'binding', 'why', 'launchHash', 'toolsHash']);
    expect([...TOOL_TRUST_OPS]).toEqual(['set', 'cleared', 'dropped']);
    expect([...TOOL_TRUST_WHYS]).toEqual(['human', 'launch-changed', 'tools-changed', 'disabled']);
    expect((CLIENT_API_DESCRIPTOR as unknown as { toolTrust: { ops: string[] } }).toolTrust.ops).toEqual([...TOOL_TRUST_OPS]);
  });
  it('set, cleared and dropped rows pass; each op takes only its own why', () => {
    expect(validateKindPayload('tool.trust', set)).toEqual([]);
    expect(validateKindPayload('tool.trust', { id: 'plugin:acme@1:fs', label: 'fs', op: 'cleared', binding: H, why: 'human' })).toEqual([]);
    for (const why of ['launch-changed', 'tools-changed', 'disabled']) expect(validateKindPayload('tool.trust', { id: 'user::neurons', label: 'neurons', op: 'dropped', binding: H, why })).toEqual([]);
    expect(validateKindPayload('tool.trust', { ...set, why: 'tools-changed' }).length).toBeGreaterThan(0);
    const { launchHash: _l, ...noLaunch } = set;
    expect(validateKindPayload('tool.trust', noLaunch).length).toBeGreaterThan(0);
    expect(validateKindPayload('tool.trust', { id: 'user::neurons', label: 'neurons', op: 'cleared', binding: H, why: 'disabled' }).length).toBeGreaterThan(0);
    expect(validateKindPayload('tool.trust', { id: 'user::neurons', label: 'neurons', op: 'dropped', binding: H, why: 'human' }).length).toBeGreaterThan(0);
  });
  it('never carries a command, a value or an open string: ids, labels and hashes are patterned', () => {
    expect(validateKindPayload('tool.trust', { ...set, id: 'project:/repo:x' }).length).toBeGreaterThan(0);
    expect(validateKindPayload('tool.trust', { ...set, id: 'first-party:paradigm' }).length).toBeGreaterThan(0);
    expect(validateKindPayload('tool.trust', { ...set, label: 'Not A Label' }).length).toBeGreaterThan(0);
    expect(validateKindPayload('tool.trust', { ...set, launchHash: 'sha256:abc' }).length).toBeGreaterThan(0);
    expect(validateKindPayload('tool.trust', { ...set, command: 'npx x' }).length).toBeGreaterThan(0);
    expect(validateKindPayload('tool.trust', { ...set, op: 'widened' }).length).toBeGreaterThan(0);
  });
});

describe('the tool scope and rule match (^local-tool-grant contract half)', () => {
  it('approve takes {kind:"tool"} with no other key; its digest is over the kind alone', () => {
    expect([...APPROVE_SCOPE_KINDS]).toContain('tool');
    expect(parseApproveScope({ kind: 'tool' })).toEqual({ kind: 'tool' });
    expect(parseApproveScope({ kind: 'tool', tool: 'x' })).toBeNull();
    expect(parseApproveScope({ kind: 'tool', server: 'fs' })).toBeNull();
    expect(scopeDigest({ kind: 'tool' })).toBe(sha256Tagged(canonicalJson({ kind: 'tool' })));
    expect(scopeDigest({ kind: 'tool' })).not.toBe(scopeDigest({ kind: 'file' }));
    expect(scopeDigest({ kind: 'tool' })).not.toBe(scopeDigest({ kind: 'repo-edits' }));
  });
  it('ALWAYS_RULE_MATCHES gains tool; approval.rule.learned gains bindHash', () => {
    expect([...ALWAYS_RULE_MATCHES]).toEqual(['exact', 'prefix', 'file', 'repo-edits', 'tool']);
    expect(validateAlwaysRuleMatch('tool')).toEqual([]);
    expect(validateAlwaysRuleMatch('class')).not.toEqual([]);
    expect(RESERVED_PAYLOAD_FIELDS['approval.rule.learned']).toMatchObject({ bindHash: '8.0:local-lane' });
  });
  it('TOOL_NAME accepts mcp:<server>/<tool> on the rule rows, and nothing looser', () => {
    for (const ok of ['Bash', 'mcp__neurons__search', 'mcp:neurons/search', 'mcp:fs-2/write_file.put', 'kernel:gnomon_git_push']) expect(TOOL_NAME.test(ok), ok).toBe(true);
    for (const bad of ['mcp:Neurons/search', 'mcp:/search', 'mcp:fs/', 'mcp:fs/a/b', 'mcp:fs/1tool', 'mcp:fs/ x', `mcp:${'a'.repeat(65)}/t`, `mcp:fs/${'t'.repeat(65)}`]) expect(TOOL_NAME.test(bad), bad).toBe(false);
    const ruleId = 'card:01HZZZZZZZZZZZZZZZZZZZZZZZ';
    const connId = 'conn:01HZZZZZZZZZZZZZZZZZZZZZZZ';
    expect(validateKindPayload('approval.rule.revoked', { ruleId, repoKey: H, tool: 'mcp:neurons/search', connId })).toEqual([]);
    expect(validateKindPayload('approval.rule.revoked', { ruleId, repoKey: H, tool: 'mcp:neurons/../x', connId }).length).toBeGreaterThan(0);
  });
  it('the move is pinned', () => {
    expect(CLIENT_API_ID).toBe('sha256:ef710386692316235e192831734ddd1b98c77b900456c20d59d674696976e6c3');
  });
});
