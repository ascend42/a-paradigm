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
 *   P8-D86–D88 (§4.11): kinds reconsider/strictness/incident, decisions
 *           extend/restart, flags irreversible/claim-mismatch, fields
 *           note (change-note:v1) and strictness{level, mode, reason}.
 */

import { Checker, canonicalJson, isPlainObject, sha256Tagged, SHA256_TAGGED, type ValidateOptions } from './internal.js';
import { ID_PATTERNS, HSID_PATTERN, CONTRACT_ID_PATTERN } from './ids.js';
import { ANY_PRINCIPAL_PATTERN } from './principal.js';
import { validateChangeNoteV1, changeNoteHasUnknownValue, RISK_TIERS, type ChangeNoteV1 } from './change-note.js';

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
  'reconsider',
  'strictness',
  'incident',
  // P8-D98 (TD-2026-10-19-528 F3): `gnomon daemon stop` raises a signed daemon-stop card decided with fresh presence.
  'daemon-stop',
] as const;
export type CardKind = (typeof CARD_KINDS)[number];

export const CARD_STATES = ['pending', 'held', 'decided', 'expired'] as const;
export type CardState = (typeof CARD_STATES)[number];

export const CARD_FLAGS = ['hidden-chars', 'bidi', 'voice-phrase', 'peer', 'irreversible', 'claim-mismatch'] as const;
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
  'extend',
  'restart',
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

/**
 * Strictness levels and run modes (§3.4, P8-D86–D88). Reserved M1.1; Move 1
 * sessions run as `ask` at L0. ADDITIVE with FAIL-SAFE semantics (orchestrator
 * ruling, round 2): an unknown level reads as L3 and an unknown mode as
 * `manual` — the strictest known values, never a looser one (there is no
 * bypass mode) — and a card carrying either is not decidable.
 */
export const STRICTNESS_LEVELS = ['L0', 'L1', 'L2', 'L3'] as const;
export type StrictnessLevel = (typeof STRICTNESS_LEVELS)[number];
export const RUN_MODES = ['manual', 'ask', 'auto-edits'] as const;
export type RunMode = (typeof RUN_MODES)[number];
export function failSafeStrictnessLevel(l: unknown): StrictnessLevel {
  return (STRICTNESS_LEVELS as readonly unknown[]).includes(l) ? (l as StrictnessLevel) : 'L3';
}
export function failSafeRunMode(m: unknown): RunMode {
  return (RUN_MODES as readonly unknown[]).includes(m) ? (m as RunMode) : 'manual';
}

/** Root-signed ~/.gnomon/config.yaml sections reserved M1.1 (§3.4, §4.11); ignored in project.yaml. */
export const ROOT_CONFIG_RESERVED_SECTIONS = ['strictness', 'review'] as const;

/** Signature domains (§3.1); the voice domain is reserved M1.1 (P8-D58). */
export const APPROVE_SIG_DOMAIN = 'gnomon:approve:v1' as const;
export const APPROVE_VOICE_SIG_DOMAIN = 'gnomon:approve-voice:v1' as const;

/**
 * decisionSig v2 (P8-D98, TD-2026-10-19-648; built by slice A2 in the kernel signer). The v1 message is the four
 * lines `cardId, decision, cardContentHash, approverPrincipalId`. The v2 message is version-marked by its FIRST line
 * and adds the answer digest, so an `answer{text}` decision binds the text the human approved:
 *   gnomon:decision:v2 \n cardId \n decision \n cardContentHash \n approverPrincipalId \n answerDigest
 * It is used when decision = `answer`; `answerDigest` = sha256:<hex> of the UTF-8 answer text. A v1 message never
 * starts with the marker (a cardId starts `card:`), so neither layout verifies as the other.
 */
export const DECISION_SIG_V2_MARKER = 'gnomon:decision:v2' as const;
export interface DecisionMessageV2Fields {
  cardId: string;
  decision: string;
  cardContentHash: string;
  approverPrincipalId: string;
  answerDigest: string;
}
export function decisionMessageV2(f: DecisionMessageV2Fields): string {
  return [DECISION_SIG_V2_MARKER, f.cardId, f.decision, f.cardContentHash, f.approverPrincipalId, f.answerDigest].join('\n');
}
/** Decisions whose decisionSig uses the v2 layout. */
export const DECISION_SIG_V2_DECISIONS = Object.freeze(['answer'] as const);

/**
 * Prefix-scoped `always` (TD-2026-10-20-294 part 3). `approve{decision:'always', scope}` on a Bash permission card:
 *   {kind:'exact'}                    the v1 exact rule (the same as no scope)
 *   {kind:'prefix', prefix:[1..3 words]} the rule matches a later Bash command only when it is ONE simple command of
 *                                     literal words whose argv starts with exactly these words (#always-rules).
 * A prefix scope is bound by decisionSig: the decision uses the v2 layout with its LAST line the scope digest
 * (scopeDigest: sha256 over canonicalJson({kind:'prefix', prefix})), so the line after the approver is the answer
 * digest for `answer` and the scope digest for a prefix `always` (the decision line tells them apart). An exact (or
 * absent) scope keeps the v1 message, unchanged.
 */
export const APPROVE_SCOPE_KINDS = Object.freeze(['exact', 'prefix'] as const);
export const APPROVE_SCOPE_PREFIX_MAX_WORDS = 3;
export const APPROVE_SCOPE_WORD_MAX_CHARS = 128;
export type ApproveScope = { kind: 'exact' } | { kind: 'prefix'; prefix: string[] };
/** Decisions that may carry a scope; a prefix scope decision uses the v2 layout (last line = scope digest). */
export const DECISION_SIG_V2_SCOPED_DECISIONS = Object.freeze(['always'] as const);

/** The scope, validated (shape only: 1–3 non-empty words, no NUL/newline), else null. */
export function parseApproveScope(v: unknown): ApproveScope | null {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  if (o.kind === 'exact') return Object.keys(o).length === 1 ? { kind: 'exact' } : null;
  if (o.kind !== 'prefix' || Object.keys(o).length !== 2 || !Array.isArray(o.prefix)) return null;
  const p = o.prefix as unknown[];
  if (p.length < 1 || p.length > APPROVE_SCOPE_PREFIX_MAX_WORDS) return null;
  if (!p.every((w) => typeof w === 'string' && w.length > 0 && w.length <= APPROVE_SCOPE_WORD_MAX_CHARS && !/[\0\n\r]/.test(w))) return null;
  return { kind: 'prefix', prefix: [...(p as string[])] };
}

/** sha256:<hex> over canonicalJson({kind:'prefix', prefix}) — the decisionSig v2 last line of a prefix `always`. */
export function scopeDigest(scope: { kind: 'prefix'; prefix: readonly string[] }): string {
  return sha256Tagged(canonicalJson({ kind: 'prefix', prefix: [...scope.prefix] }));
}

/**
 * `approval.expire{why}` values (§3.4). ADDITIVE. `session-drained` (P8-D98, TD-2026-10-19-528 F4): at a drain
 * (§2.4 rule 11) a session-bound card expires with this why; a card bound to no session is raised again by the
 * new kernel instead.
 */
export const CARD_EXPIRY_WHYS = ['timeout', 'cancelled', 'session-exited', 'duplicate-request-id', 'answered', 'session-drained'] as const;

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
  'M1.1:P8-D86-D88': Object.freeze({
    kind: ['reconsider', 'strictness', 'incident'],
    decision: ['extend', 'restart'],
    flag: ['irreversible', 'claim-mismatch'],
    field: ['note', 'strictness'],
  }),
  '8.0:P8-D98': Object.freeze({
    kind: ['daemon-stop'],
    expiryWhy: ['session-drained'],
  }),
});

/** card.strictness (§3.4): the level, the run mode and the kernel's reason line. */
export interface CardStrictness {
  level: StrictnessLevel;
  mode: RunMode;
  reason: string;
}

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
  /** change-note:v1 (§4.11), inside contentHash; agentClaims untrusted. Reserved M1.1 (P8-D86–D88). */
  note?: ChangeNoteV1;
  /** Reserved M1.1 (P8-D86–D88). */
  strictness?: CardStrictness;
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
  'note',
  'strictness',
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
 * Does the card carry a value this release does not know in a fail-safe field
 * (strictness.level, strictness.mode, note tiers / revert hows)? Such a card
 * validates tolerant (it renders) but is never decidable (round-2 ruling).
 */
export function hasUnknownFailSafeValue(card: Partial<Pick<CardV1, 'strictness' | 'note'>>): boolean {
  const st = card.strictness as { level?: unknown; mode?: unknown } | undefined;
  if (st && 'level' in st && !(STRICTNESS_LEVELS as readonly unknown[]).includes(st.level)) return true;
  if (st && 'mode' in st && !(RUN_MODES as readonly unknown[]).includes(st.mode)) return true;
  return changeNoteHasUnknownValue(card.note);
}

/** `extend` and `restart` are valid only on a `reconsider` card (§3.4, §7.3). */
export const RECONSIDER_ONLY_DECISIONS: readonly string[] = Object.freeze(['extend', 'restart']);

/**
 * Is the card decidable with this decision, from a client's point of view?
 * When the card's kind is given, `extend`/`restart` need a `reconsider` card.
 * Unknown state ⇒ never (§4.9). `held` ⇒ only `withdraw` (§14.7). `withdraw`
 * is valid only on a held card.
 */
export function isCardDecidable(
  card: Pick<CardV1, 'state'> & Partial<Pick<CardV1, 'kind' | 'strictness' | 'note'>>,
  decision?: string,
): boolean {
  // extend/restart only on a card KNOWN to be a reconsider card (unknown/omitted kind ⇒ no).
  if (decision !== undefined && RECONSIDER_ONLY_DECISIONS.includes(decision) && card.kind !== 'reconsider') return false;
  // fail-safe: a value this release does not know in a fail-safe field ⇒ render, never decide.
  if (hasUnknownFailSafeValue(card)) return false;
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
  if ('note' in v) for (const e of validateChangeNoteV1(v.note, { mode: c.mode, form: 'card' })) c.fail('note', e);
  if ('strictness' in v && c.obj('strictness', v.strictness)) {
    const st = v.strictness;
    c.closed('strictness', st, ['level', 'mode', 'reason']);
    c.required('strictness', st, ['level', 'mode', 'reason']);
    if ('level' in st) c.additiveEnum('strictness.level', st.level, STRICTNESS_LEVELS);
    if ('mode' in st) c.additiveEnum('strictness.mode', st.mode, RUN_MODES);
    if ('reason' in st) c.str('strictness.reason', st.reason);
  }
  if (c.mode === 'strict') {
    // extend/restart only on reconsider (§3.4) — also as a held decision.
    if (typeof v.heldDecision === 'string' && RECONSIDER_ONLY_DECISIONS.includes(v.heldDecision) && v.kind !== 'reconsider') {
      c.fail('heldDecision', `${v.heldDecision} is valid only on a reconsider card`);
    }
    // Producer cross-field checks on the change note (§3.4; G-CHG-01, G-CHG-04).
    const n = v.note as { agentClaims?: any; kernel?: any } | undefined;
    const flags = Array.isArray(v.flags) ? (v.flags as unknown[]) : [];
    const rank = (t: unknown) => (RISK_TIERS as readonly unknown[]).indexOf(t);
    const agentTier = rank(n?.agentClaims?.risk?.tier);
    const floor = rank(n?.kernel?.risk?.floor);
    if (agentTier >= 0 && floor >= 0 && agentTier < floor && !flags.includes('claim-mismatch')) {
      c.fail('flags', 'an agent tier below the kernel floor requires the claim-mismatch flag');
    }
    if (n?.agentClaims?.revert?.reversible === false && !flags.includes('irreversible')) {
      c.fail('flags', 'revert.reversible:false requires the irreversible flag');
    }
  }
  if (v.state === 'held' && !('heldUntil' in v)) c.fail('heldUntil', 'required on a held card');
  if ('cli' in v && !isPlainObject(v.cli)) c.fail('cli', 'must be an object');
  return c.errors;
}

export function isCardV1(value: unknown, opts: ValidateOptions = {}): value is CardV1 {
  return validateCardV1(value, opts).length === 0;
}
