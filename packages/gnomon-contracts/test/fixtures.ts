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
  ['strictness level unknown (strict)', { ...goodCard, strictness: { level: 'L4', mode: 'ask', reason: 'x' } }],
  ['run mode bypass (strict)', { ...goodCard, strictness: { level: 'L0', mode: 'bypass', reason: 'x' } }],
  ['extend held on a permission card', { ...goodCard, state: 'held', heldUntil: '2026-10-17T12:00:03Z', heldDecision: 'extend' }],
  ['strictness missing reason', { ...goodCard, strictness: { level: 'L0', mode: 'ask' } }],
  ['note with kernel field in agentClaims', { ...goodCard, note: { agentClaims: { verified: { n: 1, of: 1 } } } }],
];

/** 32 random bytes, base64url (T-2026-10-18-016). */
export const CLIENT_NONCE = 'q2Nh3ZUc0kPq6vBv8w1mEa1tYxQnJw7oZrF5K9dL2sM';

export const goodHello = {
  clientApis: ['gnomon-rpc:v1'],
  features: ['subscription'],
  clientNonce: CLIENT_NONCE,
  client: { name: 'gnomon-gui', version: '8.0.0', surface: 'wrapper', conformance: { suite: 'gnomon-conform', version: '1', reportHash: H } },
};

export const badHellos: Array<[string, unknown]> = [
  ['empty clientApis', { ...goodHello, clientApis: [] }],
  ['no client', { clientApis: ['gnomon-rpc:v1'], features: [], clientNonce: CLIENT_NONCE }],
  ['no clientNonce', { clientApis: ['gnomon-rpc:v1'], features: [], client: { name: 'x', version: '1' } }],
  ['clientNonce too short', { ...goodHello, clientNonce: 'abc' }],
  ['clientNonce not base64url', { ...goodHello, clientNonce: `${CLIENT_NONCE.slice(0, 40)}+/=` }],
  ['bad api id', { ...goodHello, clientApis: ['gnomon rpc'] }],
  ['client without version', { ...goodHello, client: { name: 'x' } }],
];

/* ── M1.1 part 2 (spec v3.9 §4.11, P8-D86–D88) ─────────────────────────────── */

export const goodAgentClaims = {
  testedHow: { summary: 'unit + replay fixtures', refs: [`ev:${ULID}`, 'sym:#approval-broker'] },
  risk: { tier: 'medium', why: 'touches the broker class table', blast: ['sym:#approval-broker'] },
  revert: { how: 'auto', steps: 'git revert <sha>', reversible: true },
  draftedBy: 'p:a1b2c3d4/session-tbm97kk4vsz44dzb',
};
export const goodChangeNote = {
  agentClaims: goodAgentClaims,
  kernel: {
    verified: { n: 1, of: 2 },
    risk: { floor: 'high', effective: 'high', reasons: ['gate-class path'] },
    revert: { how: 'auto', ref: 'wl:pick/abc' },
  },
};
/** The agent's form on contract.claim{op:'built', note}: agentClaims only. */
export const claimFormChangeNote = { agentClaims: goodAgentClaims };

export const badChangeNotes: Array<[string, unknown]> = [
  ['missing agentClaims', { kernel: goodChangeNote.kernel }],
  ['kernel field smuggled into agentClaims', { ...goodChangeNote, agentClaims: { ...goodAgentClaims, verified: { n: 2, of: 2 } } }],
  ['unknown risk tier', { ...goodChangeNote, agentClaims: { ...goodAgentClaims, risk: { ...goodAgentClaims.risk, tier: 'none' } } }],
  ['agent revert how', { ...goodChangeNote, agentClaims: { ...goodAgentClaims, revert: { ...goodAgentClaims.revert, how: 'exec' } } }],
  ['kernel revert how command', { ...goodChangeNote, kernel: { ...goodChangeNote.kernel, revert: { how: 'command' } } }],
  ['reversible not boolean', { ...goodChangeNote, agentClaims: { ...goodAgentClaims, revert: { ...goodAgentClaims.revert, reversible: 'no' } } }],
  ['blast not a sym ref', { ...goodChangeNote, agentClaims: { ...goodAgentClaims, risk: { ...goodAgentClaims.risk, blast: ['src/x.ts'] } } }],
  ['verified n negative', { ...goodChangeNote, kernel: { ...goodChangeNote.kernel, verified: { n: -1, of: 2 } } }],
  // TS-only: semantic checks the JSON Schema cannot express.
  ['card form without kernel', claimFormChangeNote],
  ['summary over 1 KiB (UTF-8 bytes)', { ...goodChangeNote, agentClaims: { ...goodAgentClaims, testedHow: { summary: 'é'.repeat(513), refs: [] } } }],
  ['verified n > of', { ...goodChangeNote, kernel: { ...goodChangeNote.kernel, verified: { n: 3, of: 2 } } }],
  ['effective below floor', { ...goodChangeNote, kernel: { ...goodChangeNote.kernel, risk: { floor: 'high', effective: 'medium', reasons: [] } } }],
  ['effective below agent tier', { ...goodChangeNote, kernel: { ...goodChangeNote.kernel, risk: { floor: 'low', effective: 'low', reasons: [] } } }],
  ['effective above max(floor, agent tier) (strict equality)', { ...goodChangeNote, kernel: { ...goodChangeNote.kernel, risk: { floor: 'low', effective: 'high', reasons: [] } } }],
];
export const changeNoteTsOnly = [
  'card form without kernel',
  'summary over 1 KiB (UTF-8 bytes)',
  'verified n > of',
  'effective below floor',
  'effective below agent tier',
  'effective above max(floor, agent tier) (strict equality)',
];

export const goodFinding = {
  fid: 'f-1',
  round: 2,
  class: 'missing-await',
  severity: 'important',
  locus: { path: 'src/kernel/broker.ts', lines: '40-52', symbol: '#approval-broker' },
  instances: [{ path: 'src/kernel/fuse.ts', lines: '9' }],
  claim: 'promise not awaited before the decision is signed',
  fingerprint: H,
};
export const badFindings: Array<[string, unknown]> = [
  ['round 0', { ...goodFinding, round: 0 }],
  ['unknown severity', { ...goodFinding, severity: 'blocker' }],
  ['locus without path', { ...goodFinding, locus: { lines: '1' } }],
  ['bad line range', { ...goodFinding, locus: { path: 'a', lines: 'ten' } }],
  ['fingerprint untagged', { ...goodFinding, fingerprint: 'abc' }],
  ['missing instances', (({ instances: _i, ...r }) => r)(goodFinding)],
  ['unknown field', { ...goodFinding, verdict: 'pass' }],
  ['inverted line range', { ...goodFinding, locus: { path: 'a', lines: '9-3' } }],
];
export const findingTsOnly = ['inverted line range'];

export const reconsiderCard = {
  ...goodCard,
  kind: 'reconsider',
  flags: ['irreversible', 'claim-mismatch'],
  note: goodChangeNote,
  strictness: { level: 'L2', mode: 'ask', reason: 'fresh presence: repo at L2 — 3 reverts / 12 landed' },
};
export const strictnessCard = { ...goodCard, kind: 'strictness', strictness: { level: 'L1', mode: 'auto-edits', reason: 'loosen L1 → L0' } };
export const incidentCard = { ...goodCard, kind: 'incident', state: 'decided', heldDecision: 'accept' };
export const badClaimNotes: Array<[string, unknown]> = [
  ['kernel part present', goodChangeNote],
  ['missing agentClaims', {}],
  ['unknown top-level field', { ...claimFormChangeNote, verified: { n: 1, of: 1 } }],
];

export const badCardsNoteFlags: Array<[string, unknown]> = [
  ['agent tier below floor without claim-mismatch', { ...goodCard, kind: 'reconsider', note: goodChangeNote, flags: ['irreversible'] }],
  [
    'reversible:false without irreversible',
    {
      ...goodCard,
      kind: 'reconsider',
      flags: ['claim-mismatch'],
      note: { ...goodChangeNote, agentClaims: { ...goodAgentClaims, revert: { ...goodAgentClaims.revert, reversible: false } } },
    },
  ],
];
