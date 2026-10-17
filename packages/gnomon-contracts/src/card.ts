/**
 * card:v1 (spec §3.4 Q5, §14.7, §3.9) — the broker's decision card.
 *
 * Every closed enum here is ADDITIVE under §4.9: a client renders an unknown
 * value opaquely and treats a card in an unknown `state` as NOT decidable.
 * Values the next releases need are reserved now (M1.1) so `clientApiId` does
 * not move in Move 2 (P8-R9 linking) or Move 4 (P8-D58 voice):
 *   P8-D58: kinds voice-arm/grant, state held, decision withdraw, flag
 *           voice-phrase, presence voice-armed, via voice, the voice/voiceDecision blocks.
 *   P8-R9:  kinds handoff/declassify/peer-pair, flag peer, via link.
 */

import { Checker, isPlainObject, SHA256_TAGGED, type ValidateOptions } from './internal.js';
import { ID_PATTERNS, HSID_PATTERN, CONTRACT_ID_PATTERN } from './ids.js';
import { ANY_PRINCIPAL_PATTERN } from './principal.js';

export const CARD_V1 = 'card:v1' as const;

export const CARD_KINDS = [
  'permission',
  'budget',
  'knot',
  'tend',
  'verdict',
  'merge-conflict',
  'gate-class',
  'install',
  'fallback',
  'ask-user',
  'plan',
  'api-token',
  'voice-share',
  'voice-arm',
  'grant',
  'handoff',
  'declassify',
  'peer-pair',
] as const;
export type CardKind = (typeof CARD_KINDS)[number];

export const CARD_STATES = ['pending', 'held', 'decided', 'expired'] as const;
export type CardState = (typeof CARD_STATES)[number];

export const CARD_FLAGS = ['hidden-chars', 'bidi', 'voice-phrase', 'peer'] as const;
export type CardFlag = (typeof CARD_FLAGS)[number];

export const CARD_DECISIONS = [
  'allow',
  'always',
  'deny',
  'resume',
  'resolve',
  'accept',
  'reject',
  'install',
  'answer',
  'approve-plan',
  'fallback-cloud',
  'use-api-token',
  'withdraw',
] as const;
export type CardDecision = (typeof CARD_DECISIONS)[number];

export const PRESENCE_VALUES = ['fresh', 'cached', 'cli', 'voice-armed'] as const;
export const VIA_VALUES = ['gui', 'wrapper', 'cli', 'client', 'voice', 'link'] as const;
export const VOICE_ELIGIBILITY = ['none', 'reversible', 'gate', 'judgment'] as const;
export const VOICE_INELIGIBLE_REASONS = ['hand-only', 'class', 'flagged', 'voice-phrase', 'policy'] as const;
export const VOICE_ARM_CLASSES = ['reversible', 'gate'] as const;
export const VOICE_MODES = ['ptt', 'conversation'] as const;
export const HANDOFF_DIRECTIONS = ['out', 'in'] as const;
export const APPROVER_POLICY_KINDS = ['self'] as const;

/** Signature domains (§3.1); the voice domain is reserved M1.1 (P8-D58). */
export const APPROVE_SIG_DOMAIN = 'gnomon:approve:v1' as const;
export const APPROVE_VOICE_SIG_DOMAIN = 'gnomon:approve-voice:v1' as const;

/** Reserved values and the move that first uses them (§19.1 M1.1). */
export const CARD_RESERVED_VALUES = Object.freeze({
  'M1.1:P8-D58': Object.freeze({
    kind: ['voice-arm', 'grant'],
    state: ['held'],
    decision: ['withdraw'],
    flag: ['voice-phrase'],
    presence: ['voice-armed'],
    via: ['voice'],
  }),
  'M1.1:P8-R9': Object.freeze({
    kind: ['handoff', 'declassify', 'peer-pair'],
    flag: ['peer'],
    via: ['link'],
  }),
});

export interface CardVoiceBlock {
  eligible: (typeof VOICE_ELIGIBILITY)[number];
  reason?: (typeof VOICE_INELIGIBLE_REASONS)[number];
  label: string;
  readback: string;
  readbackHash: string;
  echo: string;
}

export interface CardVoiceDecision {
  armId: string;
  armClass: (typeof VOICE_ARM_CLASSES)[number];
  humanConnId: string;
  voiceConnId: string;
  turnId: string;
  confirmTurnId?: string;
  deckId?: string;
  ordinal?: number;
  label?: string;
  handleHash?: string;
  challengeHash?: string;
  readbackHash?: string;
  speakerId: string;
  asrConfidence: number;
  mode: (typeof VOICE_MODES)[number];
}

export interface CardV1 {
  schemaVersion: typeof CARD_V1;
  cardId: string;
  kind: CardKind | (string & {});
  /** handoff only (§3.4). */
  direction?: (typeof HANDOFF_DIRECTIONS)[number];
  requestedBy: string;
  hsid?: string;
  contractId?: string;
  nodeId?: string;
  attended: boolean;
  approverPolicy: { kind: 'self' };
  /** display-block:v1 — validated by its own contract (later PR); here: an object. */
  block: Record<string, unknown>;
  contentHash: string;
  flags?: Array<CardFlag | (string & {})>;
  /** kernel-signed actions; opaque here. */
  actions: unknown[];
  state: CardState | (string & {});
  heldUntil?: string;
  heldDecision?: string;
  voice?: CardVoiceBlock;
  decidedBy?: string;
  decidedAt?: string;
  decisionSig?: string;
  presence?: (typeof PRESENCE_VALUES)[number] | (string & {});
  via?: (typeof VIA_VALUES)[number] | (string & {});
  voiceDecision?: CardVoiceDecision;
  cli?: { pid: number; ppid: number; pgid: number; tty: string | null } | { client: string; connId: string };
  timeoutAt?: string;
}

export const CARD_V1_KEYS = [
  'schemaVersion',
  'cardId',
  'kind',
  'direction',
  'requestedBy',
  'hsid',
  'contractId',
  'nodeId',
  'attended',
  'approverPolicy',
  'block',
  'contentHash',
  'flags',
  'actions',
  'state',
  'heldUntil',
  'heldDecision',
  'voice',
  'decidedBy',
  'decidedAt',
  'decisionSig',
  'presence',
  'via',
  'voiceDecision',
  'cli',
  'timeoutAt',
] as const;
export const CARD_V1_REQUIRED = [
  'schemaVersion',
  'cardId',
  'kind',
  'requestedBy',
  'attended',
  'approverPolicy',
  'block',
  'contentHash',
  'actions',
  'state',
] as const;

/**
 * Is the card decidable with this decision, from a client's point of view?
 * Unknown state ⇒ never (§4.9). `held` ⇒ only `withdraw` (§14.7). `withdraw`
 * is valid only on a held card.
 */
export function isCardDecidable(card: Pick<CardV1, 'state'>, decision?: string): boolean {
  if (card.state === 'pending') return decision !== 'withdraw';
  if (card.state === 'held') return decision === 'withdraw';
  return false;
}

export function validateCardV1(value: unknown, opts: ValidateOptions = {}): string[] {
  const c = new Checker(opts.mode ?? 'strict');
  if (!c.obj('', value)) return c.errors;
  const v = value;
  c.closed('', v, CARD_V1_KEYS);
  c.required('', v, CARD_V1_REQUIRED);
  if ('schemaVersion' in v && v.schemaVersion !== CARD_V1) c.fail('schemaVersion', `must be ${CARD_V1}`);
  if ('cardId' in v) c.str('cardId', v.cardId, ID_PATTERNS.card, 'card:<ULID>');
  if ('kind' in v) c.additiveEnum('kind', v.kind, CARD_KINDS);
  if ('direction' in v) c.closedEnum('direction', v.direction, HANDOFF_DIRECTIONS);
  if (v.kind === 'handoff' && !('direction' in v)) c.fail('direction', 'required on a handoff card');
  if ('requestedBy' in v) c.str('requestedBy', v.requestedBy, ANY_PRINCIPAL_PATTERN, 'a principalId');
  if ('hsid' in v) c.str('hsid', v.hsid, HSID_PATTERN, 'an hsid');
  if ('contractId' in v) c.str('contractId', v.contractId, CONTRACT_ID_PATTERN, 'contract:v1:<64 hex>');
  if ('nodeId' in v) c.str('nodeId', v.nodeId);
  if ('attended' in v) c.bool('attended', v.attended);
  if ('approverPolicy' in v && c.obj('approverPolicy', v.approverPolicy)) {
    c.additiveEnum('approverPolicy.kind', v.approverPolicy.kind, APPROVER_POLICY_KINDS);
  }
  if ('block' in v && c.obj('block', v.block) && v.block.schemaVersion !== 'display-block:v1') {
    c.fail('block.schemaVersion', 'must be display-block:v1');
  }
  if ('contentHash' in v) c.str('contentHash', v.contentHash, SHA256_TAGGED, 'sha256:<hex>');
  if ('flags' in v && c.arr('flags', v.flags)) v.flags.forEach((f, i) => c.additiveEnum(`flags[${i}]`, f, CARD_FLAGS));
  if ('actions' in v) c.arr('actions', v.actions);
  if ('state' in v) c.additiveEnum('state', v.state, CARD_STATES);
  if ('heldDecision' in v) c.additiveEnum('heldDecision', v.heldDecision, CARD_DECISIONS);
  if ('presence' in v) c.additiveEnum('presence', v.presence, PRESENCE_VALUES);
  if ('via' in v) c.additiveEnum('via', v.via, VIA_VALUES);
  if ('voice' in v && c.obj('voice', v.voice)) {
    const vb = v.voice;
    c.required('voice', vb, ['eligible', 'label', 'readback', 'readbackHash', 'echo']);
    if ('eligible' in vb) c.additiveEnum('voice.eligible', vb.eligible, VOICE_ELIGIBILITY);
    if ('reason' in vb) c.additiveEnum('voice.reason', vb.reason, VOICE_INELIGIBLE_REASONS);
    for (const k of ['label', 'readback', 'echo'] as const) if (k in vb) c.str(`voice.${k}`, vb[k]);
    if ('readbackHash' in vb) c.str('voice.readbackHash', vb.readbackHash, SHA256_TAGGED, 'sha256:<hex>');
  }
  if ('voiceDecision' in v && c.obj('voiceDecision', v.voiceDecision)) {
    const d = v.voiceDecision;
    c.required('voiceDecision', d, ['armId', 'armClass', 'humanConnId', 'voiceConnId', 'turnId', 'speakerId', 'asrConfidence', 'mode']);
    if ('armId' in d) c.str('voiceDecision.armId', d.armId, ID_PATTERNS.arm, 'arm:<ULID>');
    if ('armClass' in d) c.additiveEnum('voiceDecision.armClass', d.armClass, VOICE_ARM_CLASSES);
    for (const k of ['humanConnId', 'voiceConnId'] as const) if (k in d) c.str(`voiceDecision.${k}`, d[k], ID_PATTERNS.conn, 'conn:<ULID>');
    if ('mode' in d) c.additiveEnum('voiceDecision.mode', d.mode, VOICE_MODES);
    if ('asrConfidence' in d && (typeof d.asrConfidence !== 'number' || d.asrConfidence < 0 || d.asrConfidence > 1)) {
      c.fail('voiceDecision.asrConfidence', 'must be a number in [0,1]');
    }
  }
  if (v.state === 'held' && !('heldUntil' in v)) c.fail('heldUntil', 'required on a held card');
  if ('cli' in v && !isPlainObject(v.cli)) c.fail('cli', 'must be an object');
  return c.errors;
}

export function isCardV1(value: unknown, opts: ValidateOptions = {}): value is CardV1 {
  return validateCardV1(value, opts).length === 0;
}
