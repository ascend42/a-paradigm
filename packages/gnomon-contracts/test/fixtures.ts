/** Good and malformed fixtures per contract (G-CON-01). */
import { refuse } from '../src/index.js';

const ULID = '01J9Z6ABCDEFGHJKMNPQRSTVWX';
const ULID2 = '01J9Z6ABCDEFGHJKMNPQRSTVWY';
const H = `sha256:${'a'.repeat(64)}`;

export const goodEvent = {
  schemaVersion: 'event:v1',
  id: `ev:${ULID}`,
  log: `log:${ULID2}`,
  seq: 48213,
  at: '2026-10-17T12:00:00.000Z',
  principal: 'p:a1b2c3d4/ascend',
  keyId: `gkey:v1:${'b'.repeat(64)}`,
  deviceId: 'dev:a1b2c3d4/macbook',
  connId: `conn:${ULID}`,
  idem: H,
  session: `hsid:v1:${ULID}`,
  scope: { org: null, team: null, repo: 'repo:0123456789abcdef', loop: 'loop:nightly', contract: `contract:v1:${'c'.repeat(64)}` },
  audience: 'private',
  sensitivity: 'normal',
  kind: 'session.spawned',
  causes: [`ev:${ULID2}`, 'wl:pick/pick:v3:abc'],
  payload: { anything: true },
  ref: 'wl:pick/pick:v3:abc',
  refHash: H,
  prev: H,
  hash: H,
  sig: 'sig-bytes',
};

export const minimalEvent = {
  schemaVersion: 'event:v1',
  id: `ev:${ULID}`,
  log: `log:${ULID2}`,
  seq: 1,
  at: '2026-10-17T12:00:00Z',
  principal: 'p:a1b2c3d4/kernel',
  audience: 'private',
  sensitivity: 'normal',
  kind: 'daemon.start',
  prev: H,
  hash: H,
};

export const peerLinkEvent = {
  ...minimalEvent,
  principal: 'p:zz9x8y7w/kernel@0123abcd',
  kind: 'link.msg.in',
  causes: [`peer:log:${ULID2}/turn:hsid:v1:${ULID}/3`],
};

export const badEvents: Array<[string, unknown]> = [
  ['not an object', 42],
  ['missing hash', (({ hash: _h, ...r }) => r)(goodEvent)],
  ['wrong schemaVersion', { ...goodEvent, schemaVersion: 'event:v2' }],
  ['bad id prefix', { ...goodEvent, id: `evt:${ULID}` }],
  ['seq 0', { ...goodEvent, seq: 0 }],
  ['bad principal', { ...goodEvent, principal: 'ascend' }],
  ['bad audience', { ...goodEvent, audience: 'public' }],
  ['bad sensitivity', { ...goodEvent, sensitivity: 'low' }],
  ['org not null', { ...goodEvent, scope: { ...goodEvent.scope, org: 'acme' } }],
  ['bad hash', { ...goodEvent, hash: 'abc' }],
  ['unknown prop', { ...goodEvent, extra: 1 }],
  ['bad causes ref', { ...goodEvent, causes: ['voice:x'] }],
  ['bad kind grammar', { ...goodEvent, kind: 'NoDots' }],
];

export const goodRefusals = [
  refuse({ code: 'FORBIDDEN', gate: 'voice', data: { reason: 'voice-off' }, next: [{ verb: 'approve', params: {}, requires: ['cardId'], principal: 'human' }] }),
  refuse({ code: 'UNSUPPORTED', data: { offered: ['gnomon-rpc:v9'] } }),
  refuse({ code: 'BUDGET_DENIED', data: { cardId: `card:${ULID}` } }),
  refuse({ code: 'CAS_LOST' }),
  refuse({ code: 'FORBIDDEN', gate: 'link', data: { reason: 'peer-always' } }),
  refuse({
    code: 'GATE_REFUSED',
    verdict: 'KNOT',
    contested: [{ stableKey: 'k', symbol: 'f', rule: 'conflicting-slot', conflictingSlots: ['body'], rank: 'direct' }],
    pointers: { knotPayloadId: 'kp:1' },
  }),
];

export const badRefusals: Array<[string, unknown]> = [
  ['missing next', (({ next: _n, ...r }) => r)(refuse({ code: 'AUTH' }))],
  ['unknown code', { ...refuse({ code: 'AUTH' }), code: 'TEAPOT' }],
  ['bad retriable', { ...refuse({ code: 'AUTH' }), retriable: 'maybe' }],
  ['verdict number', { ...refuse({ code: 'AUTH' }), verdict: 3 }],
  ['next principal', { ...refuse({ code: 'AUTH' }), next: [{ verb: 'x', params: {}, requires: [], principal: 'mod' }] }],
  ['contested over cap', { ...refuse({ code: 'AUTH' }), contested: Array.from({ length: 33 }, (_, i) => ({ stableKey: `${i}`, symbol: 's', rule: null, conflictingSlots: [], rank: 'ripple' })), contestedTotal: 33 }],
  ['override principal', { ...refuse({ code: 'TRUST_HELD' }), override: { flag: 'acceptRisk', principal: 'agent' } }],
];

export const goodCard = {
  schemaVersion: 'card:v1',
  cardId: `card:${ULID}`,
  kind: 'permission',
  requestedBy: 'p:a1b2c3d4/session-tbm97kk4vsz44dzb',
  hsid: `hsid:v1:${ULID}`,
  attended: true,
  approverPolicy: { kind: 'self' },
  block: { schemaVersion: 'display-block:v1', block: 'inbox.card', data: {} },
  contentHash: H,
  flags: ['hidden-chars'],
  actions: [],
  state: 'pending',
  timeoutAt: '2026-10-17T12:05:00Z',
};

export const heldVoiceCard = {
  ...goodCard,
  state: 'held',
  heldUntil: '2026-10-17T12:00:03Z',
  heldDecision: 'allow',
  presence: 'voice-armed',
  via: 'voice',
  voice: { eligible: 'reversible', label: 'bash', readback: 'Allow bash', readbackHash: H, echo: 'Allowing bash' },
  voiceDecision: {
    armId: `arm:${ULID}`,
    armClass: 'reversible',
    humanConnId: `conn:${ULID}`,
    voiceConnId: `conn:${ULID2}`,
    turnId: 'vt-1',
    speakerId: 'spk:a1b2c3d4/ascend',
    asrConfidence: 0.97,
    mode: 'ptt',
  },
};

export const handoffCard = { ...goodCard, kind: 'handoff', direction: 'in', flags: ['peer'] };

export const badCards: Array<[string, unknown]> = [
  ['missing contentHash', (({ contentHash: _c, ...r }) => r)(goodCard)],
  ['bad cardId', { ...goodCard, cardId: ULID }],
  ['attended string', { ...goodCard, attended: 'yes' }],
  ['block not display-block', { ...goodCard, block: { schemaVersion: 'html' } }],
  ['held without heldUntil', { ...goodCard, state: 'held' }],
  ['handoff without direction', { ...goodCard, kind: 'handoff' }],
  ['asr out of range', { ...heldVoiceCard, voiceDecision: { ...heldVoiceCard.voiceDecision, asrConfidence: 2 } }],
];

export const goodHello = {
  clientApis: ['gnomon-rpc:v1'],
  features: ['subscription'],
  client: { name: 'gnomon-gui', version: '8.0.0', surface: 'wrapper', conformance: { suite: 'gnomon-conform', version: '1', reportHash: H } },
};

export const badHellos: Array<[string, unknown]> = [
  ['empty clientApis', { ...goodHello, clientApis: [] }],
  ['no client', { clientApis: ['gnomon-rpc:v1'], features: [] }],
  ['bad api id', { ...goodHello, clientApis: ['gnomon rpc'] }],
  ['client without version', { ...goodHello, client: { name: 'x' } }],
];
