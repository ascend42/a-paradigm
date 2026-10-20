/**
 * P8-D98 (T-2026-10-19-001): the batched clientApiId move of TD-2026-10-19-528, -648 and -908.
 * Falsifiers: the id moved exactly once (pinned in m1-1-reservations/display/mod-abi), every new kind's payload
 * check is closed, the human-device verbs refuse every non-human class, `match` accepts only 'exact', and the
 * reserved hello features, reasons, card values and decisionSig v2 layout are in the descriptor.
 */
import { describe, expect, it } from 'vitest';
import {
  DAEMON_STOP_REASONS,
  D98_CLOSED_VALUES,
  ADDITIVE_ENUMS,
  CARD_EXPIRY_WHYS,
  CARD_KINDS,
  CLIENT_API_DESCRIPTOR,
  CLIENT_API_ID,
  CLIENT_METHODS,
  D98_REASON_ROUTES,
  DECISION_SIG_DESCRIPTOR,
  DECISION_SIG_V2_MARKER,
  EVENT_KINDS,
  HUMAN_DEVICE_VERBS,
  KIND_PAYLOADS,
  MOD_ABI_ID,
  REFUSAL_REASONS,
  RESERVED_HELLO_FEATURES,
  RESERVED_PAYLOAD_FIELDS,
  VERBS,
  computeClientApiId,
  decisionMessageV2,
  validateAlwaysRuleMatch,
  validateKindPayload,
  validateLogReadCursor,
  TRACE_REFUSALS,
} from '../src/index.js';

const ULID = '01J00000000000000000000000';
const GOOD: Record<string, Record<string, unknown>> = {
  'session.drained': { uuid: '0f8fad5b-d9cb-469f-a165-70867728950e', reason: 'upgrade' },
  'permit.reattributed': { permitId: `permit:v1:${ULID}`, hsid: `hsid:v1:${ULID}`, drainedEventId: `ev:${ULID}`, renewedByDrain: true, expiresAt: '2026-10-19T12:00:00.000Z' },
  'approval.rule.revoked': { ruleId: `card:${ULID}`, repoKey: `sha256:${'b'.repeat(64)}`, tool: 'Bash', connId: `conn:${ULID}` },
  'approval.effect.failed': { cardId: `card:${ULID}`, decision: 'answer', effect: 'tool-answer', reason: 'session-gone' },
};

describe('P8-D98 kinds: registered, kernel-owned, closed payload checks', () => {
  it('each new kind is registered and has a closed payload key list', () => {
    for (const k of Object.keys(GOOD)) {
      expect(EVENT_KINDS[k], k).toMatchObject({ owner: 'kernel', reserved: '8.0:P8-D98' });
      expect(KIND_PAYLOADS[k], k).toEqual(Object.keys(GOOD[k]!));
    }
  });
  it('a well-formed payload passes; an extra field, a missing field or a bad value is refused', () => {
    for (const [k, good] of Object.entries(GOOD)) {
      expect(validateKindPayload(k, good), k).toEqual([]);
      expect(validateKindPayload(k, { ...good, extra: 1 }).length, `${k} extra`).toBeGreaterThan(0);
      const [first] = Object.keys(good);
      const { [first!]: _, ...missing } = good;
      expect(validateKindPayload(k, missing).length, `${k} missing`).toBeGreaterThan(0);
      expect(validateKindPayload(k, { ...good, [first!]: 42 }).length, `${k} bad`).toBeGreaterThan(0);
    }
    expect(validateKindPayload('session.drained', { ...GOOD['session.drained']!, reason: 'crash' }).length).toBeGreaterThan(0);
    expect(validateKindPayload('approval.effect.failed', { ...GOOD['approval.effect.failed']!, reason: 'free text here' }).length).toBeGreaterThan(0);
    // carry-over ruling: a re-attributed permit is always renewed, with an ISO expiry
    expect(validateKindPayload('permit.reattributed', { ...GOOD['permit.reattributed']!, renewedByDrain: false }).length).toBeGreaterThan(0);
    expect(validateKindPayload('permit.reattributed', { ...GOOD['permit.reattributed']!, expiresAt: 'tomorrow' }).length).toBeGreaterThan(0);
  });
  it('a kind with no closed check is an error, never a pass', () => {
    expect(validateKindPayload('session.open', {}).length).toBeGreaterThan(0);
  });
  it('claimGen, match and expire.why are reserved payload fields', () => {
    expect(RESERVED_PAYLOAD_FIELDS['contract.claimed']).toEqual({ claimGen: '8.0:P8-D98' });
    expect(RESERVED_PAYLOAD_FIELDS['approval.rule.learned']).toEqual({ match: '8.0:P8-D98', prefix: '8.0:TD-2026-10-20-294' });
    expect(RESERVED_PAYLOAD_FIELDS['approval.decide']).toEqual({ scope: '8.0:TD-2026-10-20-294' });
    expect(RESERVED_PAYLOAD_FIELDS['approval.expire']).toEqual({ why: '8.0:P8-D98' });
  });
});

describe('F2 (amended TD-2026-10-20-294): the always-rule match field is closed to exact | prefix', () => {
  it('exact and prefix pass; anything else is refused', () => {
    expect(validateAlwaysRuleMatch('exact')).toEqual([]);
    expect(validateAlwaysRuleMatch('prefix')).toEqual([]);
    for (const bad of ['PREFIX', 'glob', 'regex', 'EXACT', '', null, undefined, 1, ['exact']]) expect(validateAlwaysRuleMatch(bad).length, String(bad)).toBeGreaterThan(0);
  });
});

describe('human-device verbs (gui.open, rules.revoke, daemon.stop)', () => {
  it('are callable only by the human class; agent, read token, peer and every other class are false', () => {
    expect(HUMAN_DEVICE_VERBS.map((v) => v.verb)).toEqual(['gui.open', 'rules.revoke', 'daemon.stop']);
    expect(HUMAN_DEVICE_VERBS.map((v) => v.n)).toEqual([13, 14, 15]);
    for (const v of HUMAN_DEVICE_VERBS) {
      expect(v.humanOnly).toBe(true);
      expect(v.access).toEqual({ human: 'verified human device', agent: false, session: false, mod: false, voice: false, readToken: false, peer: false });
      expect(CLIENT_METHODS).toContain(v.verb);
    }
    expect(VERBS).toHaveLength(12); // law 3's twelve kernel verbs are unchanged
    expect(HUMAN_DEVICE_VERBS.find((v) => v.verb === 'gui.open')!.params).toEqual(['cwdHint?']);
    expect(HUMAN_DEVICE_VERBS.find((v) => v.verb === 'rules.revoke')!.params).toEqual(['ruleId']);
  });

  it('daemon.stop{reason?} (TD-2026-10-19-339): reason is closed to stop and upgrade, published so clientApiId covers it', () => {
    const v = HUMAN_DEVICE_VERBS.find((x) => x.verb === 'daemon.stop')!;
    expect(v.params).toEqual(['reason?']);
    expect(v.refusals).toEqual(['FORBIDDEN', 'BAD_REQUEST', 'ENGINE']);
    expect([...DAEMON_STOP_REASONS]).toEqual(['stop', 'upgrade']);
    expect(D98_CLOSED_VALUES['daemon.stop.reason' as keyof typeof D98_CLOSED_VALUES]).toEqual(['stop', 'upgrade']);
    expect(CLIENT_API_DESCRIPTOR.closedValues).toMatchObject({ 'daemon.stop.reason': ['stop', 'upgrade'] });
  });
});

describe('#trace-capture wire (TD-2026-10-19-057; Aegis M5 G-HON)', () => {
  it('session.sandbox{traced, traceRefused} are reserved under D98 and the refusal values are a published closed set', () => {
    expect(RESERVED_PAYLOAD_FIELDS['session.sandbox']).toMatchObject({ traced: '8.0:P8-D98', traceRefused: '8.0:P8-D98' });
    expect([...TRACE_REFUSALS]).toEqual(['trace-unsafe', 'trace-unavailable']);
    expect(D98_CLOSED_VALUES).toMatchObject({ 'session.sandbox.traceRefused': ['trace-unsafe', 'trace-unavailable'] });
    expect(CLIENT_API_DESCRIPTOR.closedValues).toMatchObject({ 'session.sandbox.traceRefused': ['trace-unsafe', 'trace-unavailable'] });
  });
});

describe('drain-and-resume wire (§2.4 rule 11, T-2026-10-19-014 B1/B2; Aegis M1 G-HON)', () => {
  it('every B1/B2 wire field is reserved under D98 and every new value is a published closed set', () => {
    expect(RESERVED_PAYLOAD_FIELDS['session.open']).toMatchObject({ resume: '8.0:P8-D98', principalClass: '8.0:P8-D98' });
    expect(RESERVED_PAYLOAD_FIELDS['session.sandbox']).toEqual({ resumedFrom: '8.0:P8-D98', drainOutcome: '8.0:P8-D98', note: '8.0:P8-D98', drainedEventId: '8.0:P8-D98', traced: '8.0:P8-D98', traceRefused: '8.0:P8-D98' });
    expect(RESERVED_PAYLOAD_FIELDS['session.inject']).toMatchObject({ deadlineMs: '8.0:P8-D98', deadlineSource: '8.0:P8-D98', failed: '8.0:P8-D98' });
    expect(D98_CLOSED_VALUES).toMatchObject({
      'session.open.resume.outcome': ['clean', 'interrupted'],
      'session.sandbox.drainOutcome': ['clean', 'interrupted'],
      'session.sandbox.phase.resume': ['resume-note'],
      'session.sandbox.note': ['turn interrupted by update'],
      'session.exited.reason.drain': ['drain-clean', 'drain-interrupted'],
      'session.inject.channel.drain': ['drain'],
      'session.inject.deadlineSource': ['default', 'caller'],
      'session.refused.resume': ['cwd-gone', 'not-human', 'transcripts-withheld', 'layers-changed', 'git-changed', 'permit-missing', 'permit-unfit', 'billing-refused', 'spawn-failed'],
    });
    expect(RESERVED_PAYLOAD_FIELDS['session.refused']).toEqual({ resume: '8.0:P8-D98' });
    expect(CLIENT_API_DESCRIPTOR.closedValues).toMatchObject({ 'session.exited.reason.drain': ['drain-clean', 'drain-interrupted'] });
  });
});

describe('reserved values', () => {
  it('hello features, reasons, card kind and expiry why', () => {
    expect([...RESERVED_HELLO_FEATURES]).toEqual(['journal.cursor', 'session.resume']);
    expect(D98_REASON_ROUTES).toMatchObject({
      'stale-claim': { code: 'CAS_LOST' }, 'claim-expired': { code: 'CAS_LOST' }, 'claim-superseded': { code: 'CAS_LOST' },
      'cursor-epoch': { code: 'BAD_REQUEST' }, draining: { code: 'ENGINE' },
    });
    for (const r of Object.keys(D98_REASON_ROUTES)) expect(REFUSAL_REASONS).toContain(r);
    expect(CARD_KINDS).toContain('daemon-stop');
    expect(CARD_EXPIRY_WHYS).toContain('session-drained');
    expect(ADDITIVE_ENUMS['approval.expire.why']).toContain('session-drained');
  });
  it('the log.read cursor is {logId, seq}, closed', () => {
    expect(validateLogReadCursor({ logId: `log:${ULID}`, seq: 3 })).toEqual([]);
    expect(validateLogReadCursor({ logId: `log:${ULID}`, seq: 3, hash: 'x' }).length).toBeGreaterThan(0);
    expect(validateLogReadCursor({ seq: 3 }).length).toBeGreaterThan(0);
    expect(validateLogReadCursor({ logId: 'ev:x', seq: 0 }).length).toBeGreaterThan(0);
  });
});

describe('decisionSig v2 layout (built by slice A2)', () => {
  it('is version-marked on its first line, carries the answer digest, and its vector is in the descriptor', () => {
    const m = decisionMessageV2({ cardId: `card:${ULID}`, decision: 'answer', cardContentHash: 'sha256:c', approverPrincipalId: 'p:local/x', answerDigest: 'sha256:a' });
    expect(m.split('\n')).toEqual([DECISION_SIG_V2_MARKER, `card:${ULID}`, 'answer', 'sha256:c', 'p:local/x', 'sha256:a']);
    expect(DECISION_SIG_V2_MARKER).toBe('gnomon:decision:v2');
    expect(DECISION_SIG_DESCRIPTOR.v2.decisions).toEqual(['answer']);
    expect(DECISION_SIG_DESCRIPTOR.v2.vector.message).toBe(
      `gnomon:decision:v2\ncard:${ULID}\nanswer\nsha256:${'c'.repeat(64)}\np:local/founder\nsha256:${'a'.repeat(64)}`,
    );
    expect((CLIENT_API_DESCRIPTOR as { decisionSig: unknown }).decisionSig).toBe(DECISION_SIG_DESCRIPTOR);
  });
  it('changing the layout moves clientApiId; modAbiId is not an input', () => {
    const changed = { ...CLIENT_API_DESCRIPTOR, decisionSig: { ...DECISION_SIG_DESCRIPTOR, v2: { ...DECISION_SIG_DESCRIPTOR.v2, marker: 'gnomon:decision:v3' } } };
    expect(computeClientApiId(changed)).not.toBe(CLIENT_API_ID);
    expect(MOD_ABI_ID).toBe('sha256:7aaf92f46dc35fc35141557c1f89088958f220e6bf53ea31a630bb06430ba082');
  });
});
