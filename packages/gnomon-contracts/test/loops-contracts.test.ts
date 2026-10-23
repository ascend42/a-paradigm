/**
 * 8.0:loops (docs/specs/gnomon-loops.md §3–§5; build step 2): the ONE clientApiId move for Gnomon loops.
 * Card kinds loop-trust and loop-choice, decisions continue/stop (loop-choice only), the kernel-owned loop.* and
 * request.loop.* kinds, the userland agent kind loop.request, labels, payload docs and the descriptor `loops` block.
 * loop.row stays the userland #learning-loop ledger; the runner's per-round row is the kernel-owned loop.round.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  ADDITIVE_ENUMS,
  CARD_DECISIONS,
  CARD_KINDS,
  CARD_RESERVED_VALUES,
  CLIENT_API_DESCRIPTOR,
  CLIENT_API_ID,
  computeClientApiId,
  defaultLabelsFor,
  EVENT_KINDS,
  EVENT_KIND_NAMES,
  isCardDecidable,
  isKnownKind,
  kindOwner,
  LOOP_AUTONOMY,
  LOOP_CHOICE_ONLY_DECISIONS,
  LOOP_PAUSE_REASONS,
  LOOP_REQUEST_OPS,
  LOOP_RUN_END_REASONS,
  LOOP_VERDICTS,
  RESERVATION_TAGS,
  RESERVED_KIND_PAYLOADS,
  RESERVED_PAYLOAD_FIELDS,
  validateCardV1,
  validateEventV1,
} from '../src/index.js';
import * as F from './fixtures.js';

const TAG = '8.0:loops';
const KERNEL_LOOP_KINDS = [
  'loop.trusted',
  'loop.untrusted',
  'loop.closure.changed',
  'loop.run.started',
  'loop.node',
  'loop.round',
  'loop.notified',
  'loop.proposed',
  'loop.landed',
  'loop.land.waiting',
  'loop.parked',
  'loop.run.ended',
  'loop.trigger.fired',
  'loop.deleted',
  'loop.resumed',
  'loop.budget.tightened', // LP8: a human tightened a loop's caps
];
const REQUEST_LOOP_KINDS = ['request.loop.trust', 'request.loop.untrust', 'request.loop.pause', 'request.loop.resume', 'request.loop.run', 'request.loop.delete', 'request.loop.budget'];
const ALL_LOOP_KINDS = [...KERNEL_LOOP_KINDS, ...REQUEST_LOOP_KINDS, 'loop.request'];

describe('8.0:loops card kinds and decisions', () => {
  it('loop-trust and loop-choice are card kinds; continue and stop are decisions; all reserved under 8.0:loops', () => {
    for (const k of ['loop-trust', 'loop-choice']) expect(CARD_KINDS).toContain(k);
    for (const d of ['continue', 'stop']) expect(CARD_DECISIONS).toContain(d);
    expect(CARD_RESERVED_VALUES[TAG]).toEqual({ kind: ['loop-trust', 'loop-choice'], decision: ['continue', 'stop'] });
    expect(ADDITIVE_ENUMS['card.kind']).toEqual(expect.arrayContaining(['loop-trust', 'loop-choice']));
    expect(LOOP_CHOICE_ONLY_DECISIONS).toEqual(['continue', 'stop']);
  });
  it('round-trips: each loop card validates strict, pending and held', () => {
    for (const kind of ['loop-trust', 'loop-choice']) {
      const card = { ...F.goodCard, kind };
      expect(validateCardV1(card)).toEqual([]);
      expect(validateCardV1(JSON.parse(JSON.stringify(card)))).toEqual([]);
    }
    for (const d of ['continue', 'stop']) {
      const held = { ...F.goodCard, kind: 'loop-choice', state: 'held', heldUntil: F.goodCard.timeoutAt, heldDecision: d };
      expect(validateCardV1(held)).toEqual([]);
    }
  });
  it('continue/stop only on a loop-choice card (strict producer rule and isCardDecidable)', () => {
    for (const d of ['continue', 'stop']) {
      expect(validateCardV1({ ...F.goodCard, kind: 'permission', state: 'held', heldUntil: F.goodCard.timeoutAt, heldDecision: d }).join()).toMatch(/only on a loop-choice card/);
      expect(validateCardV1({ ...F.goodCard, kind: 'permission', state: 'held', heldUntil: F.goodCard.timeoutAt, heldDecision: d }, { mode: 'tolerant' })).toEqual([]);
      expect(isCardDecidable({ state: 'pending', kind: 'loop-choice' }, d)).toBe(true);
      expect(isCardDecidable({ state: 'pending', kind: 'loop-trust' }, d)).toBe(false);
      expect(isCardDecidable({ state: 'pending', kind: 'reconsider' }, d)).toBe(false);
      expect(isCardDecidable({ state: 'pending' }, d)).toBe(false); // unknown/omitted kind ⇒ never
    }
    // extend/restart stay reconsider-only, untouched by the loops rule
    expect(isCardDecidable({ state: 'pending', kind: 'loop-choice' }, 'extend')).toBe(false);
    expect(isCardDecidable({ state: 'pending', kind: 'loop-trust' }, 'allow')).toBe(true);
    expect(isCardDecidable({ state: 'pending', kind: 'loop-trust' }, 'deny')).toBe(true);
  });
});

describe('8.0:loops event kinds', () => {
  it('the tag is a release tag; every loop kind is registered under it', () => {
    expect(RESERVATION_TAGS).toContain(TAG);
    const tagged = EVENT_KIND_NAMES.filter((k) => EVENT_KINDS[k]!.reserved === TAG);
    expect([...tagged].sort()).toEqual([...ALL_LOOP_KINDS].sort());
  });
  it('the runner and request kinds are kernel-owned; loop.request is userland (the agent ask, §5)', () => {
    for (const k of [...KERNEL_LOOP_KINDS, ...REQUEST_LOOP_KINDS, 'loop.paused']) expect(kindOwner(k), k).toBe('kernel');
    expect(kindOwner('loop.request')).toBe('userland');
  });
  it('loop.row|open|closed stay userland (the #learning-loop ledger); the runner ledger is the kernel-owned loop.round', () => {
    for (const k of ['loop.row', 'loop.open', 'loop.closed']) {
      expect(kindOwner(k), k).toBe('userland');
      expect(EVENT_KINDS[k]!.reserved).toBeUndefined();
    }
    expect(EVENT_KINDS['loop.round']).toMatchObject({ owner: 'kernel', reserved: TAG });
    expect(RESERVED_KIND_PAYLOADS['loop.round']).toEqual(expect.arrayContaining(['runId', 'loopId', 'iter', 'verdict', 'nodeVisits', 'escalations', 'landedSha']));
  });
  it('labels: private + normal by default; loop.node evidence is a sensitive field, as oracle.result is', () => {
    for (const k of ALL_LOOP_KINDS) expect(defaultLabelsFor(k), k).toEqual({ audience: 'private', sensitivity: 'normal' });
    expect(EVENT_KINDS['loop.node']!.fieldLabels).toEqual({ evidence: 'sensitive', evidenceRef: 'sensitive' });
    expect(EVENT_KINDS['oracle.result']!.fieldLabels).toEqual({ evidence: 'sensitive' });
    expect(EVENT_KINDS['loop.landed']!.fieldLabels).toEqual({ paths: 'sensitive' });
    expect(EVENT_KINDS['loop.proposed']!.fieldLabels).toEqual({ paths: 'sensitive' });
  });
  it('every loop kind has a payload doc; loop.paused and session.open carry the reserved loop fields', () => {
    for (const k of ALL_LOOP_KINDS) expect(Array.isArray(RESERVED_KIND_PAYLOADS[k]), k).toBe(true);
    expect(RESERVED_KIND_PAYLOADS['request.loop.pause']).toContain('all'); // the kill switch
    expect(RESERVED_KIND_PAYLOADS['loop.request']).toEqual(['op', 'loopId', 'scope', 'repo', 'hsid']);
    expect(RESERVED_PAYLOAD_FIELDS['loop.paused']).toEqual({ loopId: TAG, runId: TAG, reason: TAG, by: TAG });
    expect(RESERVED_PAYLOAD_FIELDS['session.open']).toMatchObject({ origin: TAG, loopRun: TAG });
  });
  it('round-trips: an event:v1 of each loop kind validates strict with default labels', () => {
    for (const kind of ALL_LOOP_KINDS) {
      expect(isKnownKind(kind), kind).toBe(true);
      const e = { ...F.minimalEvent, kind };
      expect(validateEventV1(e, { checkDefaultLabels: true }), kind).toEqual([]);
      expect(validateEventV1(JSON.parse(JSON.stringify(e)), { checkDefaultLabels: true }), kind).toEqual([]);
    }
    // the loop namespace is closed: an unregistered loop.* kind is refused
    expect(validateEventV1({ ...F.minimalEvent, kind: 'loop.not-a-kind' }).join()).toMatch(/unregistered kind/);
  });
  it('the published event schema names every loop kind (so clientApiId covers them)', () => {
    const schema = readFileSync(fileURLToPath(new URL('../schemas/event.v1.schema.json', import.meta.url)), 'utf8');
    for (const k of ALL_LOOP_KINDS) expect(schema, k).toContain(`"${k}"`);
  });
});

describe('8.0:loops descriptor and the one clientApiId move', () => {
  it('the descriptor publishes the loops closed values', () => {
    const loops = (CLIENT_API_DESCRIPTOR as unknown as { loops: Record<string, unknown> }).loops;
    expect(loops.verdicts).toEqual([...LOOP_VERDICTS]);
    expect(loops.autonomy).toEqual([...LOOP_AUTONOMY]);
    expect(loops.requestOps).toEqual([...LOOP_REQUEST_OPS]);
    expect(loops.pauseReasons).toEqual([...LOOP_PAUSE_REASONS]);
    expect(loops.runEndReasons).toEqual([...LOOP_RUN_END_REASONS]);
    expect(loops.sessionOrigin).toBe('loop');
    expect(loops.choiceOnlyDecisions).toEqual(['continue', 'stop']);
    expect(loops.killSwitch).toEqual({ kind: 'request.loop.pause', payload: { all: true } });
    expect(LOOP_VERDICTS).toEqual(['pass', 'fail', 'unsure', 'unavailable', 'error']);
    expect(LOOP_PAUSE_REASONS).toContain('kill-switch');
    expect(LOOP_RUN_END_REASONS).toContain('daemon-restart');
  });
  it('clientApiId moved once to the pinned value, and the pin file agrees', () => {
    expect(computeClientApiId()).toBe(CLIENT_API_ID);
    expect(CLIENT_API_ID).toBe('sha256:295c5ac772b6c621b465943a106c441a7572603090f96f7f01293f7af0cec298');
    const pin = JSON.parse(readFileSync(fileURLToPath(new URL('../schemas/client-api.ids.json', import.meta.url)), 'utf8')) as { clientApiId: string };
    expect(pin.clientApiId).toBe(CLIENT_API_ID);
  });
});
