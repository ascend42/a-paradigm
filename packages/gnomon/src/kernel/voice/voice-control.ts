/**
 * @symbol #gnomon-voice
 *
 * The kernel side of the voice principal, talk-only (voice slice V1, T-2026-10-19-026; TD-2026-10-19-194,
 * TD-2026-10-19-677; spec §14.1–14.4, §14.7 "Forwarding guards" and "No level, run modes", §4.10, §5 voice column).
 *
 * What the voice principal (`p:<ns>/voice`, its own device key) may do here, and nothing more:
 *   - `log.append voice.*` — shape-validated (speakerId known or `unknown-N`, turn ids monotone per kind, text
 *     ≤ 16 KiB, t0 ≤ t1); sensitivity never below the §9.1 kind default (voice.turn.* are `sensitive`). It may not
 *     append `voice.session.start` (attachment is a human gesture), `voice.enrol` / `voice.forget` (root-signed CLI
 *     acts) or `voice.share` (8.1 transport); `request.voice.arm` stays refused in log-append.ts (arms land in V7).
 *   - `session.send` to the ATTACHED session only, `source: 'voice'` forced here (a client value is ignored, never
 *     trusted). The turn rides the attached session's owner: the supervisor reserves the turn permit in the
 *     attaching human's name under that session's scope; the voice principal never reserves a permit of its own.
 *     It is forwarded only when the cited turn — the LATEST `voice.turn.user` this voice connection logged during
 *     the current attachment — is from an enrolled speaker, was not intercepted, was never forwarded before, its
 *     mode claim is within the attachment's CEILING, the send's text equals the logged text, and its t0 lies outside
 *     every logged `voice.turn.agent` playback window `[t0, t1 + echoTailMs]` (echoTailMs default 750, §14.7 config).
 *
 * V2a (TD-2026-10-19-298, spec §14.7 "Ceiling and ambient guards"): the attachment mode is a CEILING. A `ptt` turn
 * claim is forwardable under any ceiling; a `conversation` (ambient) claim only under a `conversation` ceiling. Under a
 * conversation ceiling EVERY turn, whatever mode it claims (Aegis V2a M1), needs
 *   - an `aec` claim on its voice.turn.user (`vpio` | `headphones`), else voice-off{cause: 'aec'};
 *   - an enrolled speaker (as for ptt);
 *   - the attached session's model not busy by the kernel's own clock: refused voice-playback{clock: 'kernel'} while
 *     the supervisor has a turn in flight (turn.sent until the main-chain reply ends: its message_stop after an end_turn
 *     stop_reason, re-armed by a Stop-hook continuation's message_start; the result only when no end was seen) and
 *     through echoTailMs after it ended
 *     (VoiceSessionsPort.busy, from supervisor state). This window covers model streaming plus the tail ONLY: client
 *     TTS that plays longer, a client that logs no voice.turn.agent, or a claimed turn duration of 0 can still get an
 *     echo past it (spec §14.7 residual risk); the client playback rows and the AEC claim are the rest of the defence.
 * No wake word and no ask clamp (founder rulings). TD-2026-10-20-125 (founder ruling, supersedes "ambient behaves like
 * typed"): ambient speech NEVER sends itself. The voice principal's direct `session.send` is refused voice-off{cause:
 * 'composer'} for any turn whose mode claim is not `ptt`; an accepted ambient turn is stamped forwardable and fills the
 * GUI composer, which a human sends (a key press). The PTT claim is the client's (the key lives in the voice app): the
 * kernel cannot see the key, so a voice principal that lies about `ptt` is outside this guard (spec §14.4.2).
 * Widening to `conversation` takes one fresh presence (Touch ID, a `strictness` card — the run-mode loosening path)
 * per first-party human connection (one GUI login); narrowing, re-attaching at ptt and ending take none. A
 * conversation ceiling with no forwarded turn for ambientIdleMs (default 10 min, never unbounded) is ended by the
 * kernel (voice.session.end{reason: 'idle'}). Privacy: a turn the kernel refuses at receipt (unknown speaker, over the
 * ceiling, no aec, busy, echo, no attachment) is stored with a keyed text hash, its duration and the refusal reason —
 * never its text — and is never forwardable; forwarded turns keep their full text (`sensitive`).
 *   - `session.stop` to the attached session with `interrupt: true` only.
 *
 * Dictation (TD-2026-10-20-262, spec §14.7 "Dictation"): the default client delivery is the GUI COMPOSER, not a direct
 * send. An accepted voice.turn.user row (not refused at receipt, not intercepted) carries a KERNEL-stamped
 * `forwardable: true` (a client-sent `forwardable` is BAD_REQUEST, like receivedAt); an intercepted row carries
 * `forwardable: false`; a refused row stays hash-only. The human then sends the composer text with `session.send{source:
 * 'voice'}` — an attribution HINT only (supervisor/port.ts): attributeHumanSend hash-matches each content part, in order,
 * against this attachment's pending turns (forwardable, unforwarded, the human's own `p:<ns>/voice` principal, the
 * attached hsid, received after the attachment started). All parts match ⇒ turn.sent{source: 'voice', voiceTurnSeqs,
 * voiceTurnSeq} and the parts join with ' '; some match ⇒ source 'voice-edited' plus the matched seqs; none ⇒ no voice
 * tag. Anything not 'voice' (edited sends included) joins its parts with '\n'. The GUI sends an edited draft as ONE
 * part, which normally matches no pending turn, so it carries no voice tag at all. Matched turns join #forwarded (a
 * later direct send of the same turn is refused). Attribution never refuses a human send. The 30 s freshness and latest-turn rules bind only the direct (voice principal) path.
 *
 * Attachment (§14.7 "voice is attached to a session only by a human gesture"): a HUMAN on a first-party connection
 * (GUI launch token or this home's human device) appends `voice.session.start{hsid, mode?}` / `voice.session.end`;
 * the kernel checks the session is the human's own, mints the voiceSessionId and writes the row. The voice child
 * and agents cannot attach. One attachment exists at a time; a new one replaces the old (whose end row is written).
 *
 * Refusals: FORBIDDEN, gate `voice`, reserved §14.7 reasons only (no new contract value):
 *   voice-target (no attachment, or not the attached session) · voice-conn (more than one live voice connection)
 *   · voice-stale-utterance (no turn, not this connection's latest turn, logged before the attachment, already
 *   forwarded, or text mismatch) · voice-speaker (speaker not enrolled now) · voice-grammar (an intercepted
 *   decision/control turn is never forwarded) · voice-echo (t0 inside a playback window + tail) · voice-off
 *   (a turn above the attachment's ceiling, or an ambient turn without aec) · voice-playback (V2a: the model is busy
 *   by the kernel's clock) · a stop without interrupt ⇒ BAD_REQUEST{bad-params}.
 *
 * Voice submodes (TD-2026-10-21-514, spec §14.7 "Voice submodes"; $send-by-word, $send-by-pieces):
 *   - the kernel HOLDS the send word (request.voice.sendword; persisted by the daemon at ~/.gnomon/voice/send-word.json)
 *     and stamps, at receipt, whether each accepted turn IS the send word (#send-word-matcher; never its text);
 *   - short words by ADJACENCY: a voice.turn.user{speakerBasis:'adjacent'} is accepted only when it is under
 *     SEND_WORD_SHORT_MS, is the held send word, and starts within SEND_WORD_ADJACENT_MS of a forwardable turn of that
 *     speaker or while that speaker's draft turns are pending; else it is refused voice-speaker at receipt (hash only);
 *   - request.voice.send.claim{hsid, by, turnSeq|turnSeqs} (human, gui/device): checks and CONSUMES the cited turns
 *     atomically (a second tab gets voice-stale-utterance) and binds {connId, hsid, by, expiresAt: now + 5 s};
 *     originFor() hands the binding to the next session.send{source:'voice'} of that connection, which gets
 *     origin 'voice' + sentBy (and the supervisor's clamp). An expired claim is dropped. Backstop (fail closed): a voice
 *     send while an unclaimed pending turn of the attachment is the send word is stamped origin 'voice' anyway;
 *   - the attachment's SEND CEILING (voice.session.start{send?}): key (default) < word < pieces; word and pieces need a
 *     conversation ceiling; pieces takes one fresh presence per GUI login (the voice.widen strictness card with
 *     send:'pieces') and is refused voice-strictness at strictness L2 or above.
 */
import { createHmac, randomBytes } from 'node:crypto';
import { refuse, RefusedError, ulid, type RefusalCode } from '@a-company/gnomon-contracts';
import { canonicalSendWord, isSendWord, VOICE_LIABILITY_ACK_HASH, VOICE_LIABILITY_ACK_TEXT, SEND_CLAIM_TTL_MS, SEND_WORD_ADJACENT_MS, SEND_WORD_CLAIM_MAX_AGE_MS, SEND_WORD_SHORT_MS, type SendWord, type VoiceSentBy } from '@a-company/gnomon-contracts';
import { TABLE_TALK_GUIDANCE } from './table-talk.js';

export const VOICE_ECHO_TAIL_MS_DEFAULT = 750;
/**
 * Aegis M1 (V1 conditions): a voice turn is forwardable for at most this long after the KERNEL received its
 * voice.turn.user row (kernel clock, never the client's t0/t1). PTT end-of-speech to send is sub-second in practice
 * (§14.2 budget < 800 ms); 30 s leaves room for a slow STT pass while bounding replay. Spec §14.7 Forwarding guards.
 */
export const VOICE_TURN_MAX_AGE_MS = 30_000;
/** Aegis L4: the kernel keeps at most this many recent user turns and playback windows (older ones cannot be sent anyway). */
export const VOICE_WINDOW_CAP = 256;
export const VOICE_TEXT_MAX_BYTES = 16 * 1024;
/** V2a: a conversation-ceiling attachment with no forwarded turn for this long is ended by the kernel (config voice.ambientIdleMs). */
export const VOICE_AMBIENT_IDLE_MS_DEFAULT = 10 * 60_000;
/** never unbounded: a configured idle timeout is clamped into [VOICE_AMBIENT_IDLE_MIN_MS, VOICE_AMBIENT_IDLE_MAX_MS] */
export const VOICE_AMBIENT_IDLE_MIN_MS = 10_000;
export const VOICE_AMBIENT_IDLE_MAX_MS = 60 * 60_000;
export const VOICE_AEC = ['vpio', 'headphones'] as const;
/** the clamped idle timeout for a configured value (non-finite, absent or non-positive ⇒ the default) */
export function ambientIdleMsOf(v: unknown): number {
  if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) return VOICE_AMBIENT_IDLE_MS_DEFAULT;
  return Math.min(VOICE_AMBIENT_IDLE_MAX_MS, Math.max(VOICE_AMBIENT_IDLE_MIN_MS, Math.floor(v)));
}
export const VOICE_MODES_V1 = ['ptt', 'conversation'] as const;
/** TD-2026-10-21-514: the attachment's send ceiling, in widening order */
export const VOICE_SEND_CEILINGS = ['key', 'word', 'pieces'] as const;
export type VoiceSendCeiling = (typeof VOICE_SEND_CEILINGS)[number];
const sendRank = (c: VoiceSendCeiling): number => VOICE_SEND_CEILINGS.indexOf(c);
/** a send word being taught is held for adjacency this long (the guided dialog renews it per take) */
export const SEND_WORD_TRIAL_MS = 2 * 60_000;
/** at most this many turns per piece claim */
export const PIECE_CLAIM_MAX_TURNS = 64;
export type VoiceMode = (typeof VOICE_MODES_V1)[number];

const SPEAKER_ID = /^spk:(?:[0-9a-z]{8}\/[a-z0-9][a-z0-9._-]{0,63}|unknown-[1-9][0-9]{0,5})$/;
const TURN_ID = /^[0-9A-Za-z][0-9A-Za-z:._-]{0,63}$/;
const SENS = ['normal', 'sensitive', 'secret'] as const;
const ASR_MODEL = /^[\w.-]{1,64}$/;
/** Aegis V2a M2: a failed idle end is retried after this long (the send path already refuses past idleAt) */
export const VOICE_IDLE_RETRY_MS = 5_000;

/** Kinds the voice principal may append, and the ones it may not (with why). */
const VOICE_APPENDABLE = ['voice.turn.user', 'voice.turn.agent', 'voice.deck', 'voice.focus', 'voice.tts.filtered', 'voice.bargein', 'voice.session.end'];
const VOICE_NOT_BY_VOICE: Readonly<Record<string, string>> = Object.freeze({
  'voice.session.start': 'voice is attached to a session only by a human gesture (§14.7 Forwarding guards)',
  'voice.enrol': 'enrolment is a root-signed CLI act (gnomon voice enrol, §14.4)',
  'voice.forget': 'deletion is a root-signed CLI act (gnomon voice forget, §14.4)',
  'voice.share': 'sharing needs per-speaker consent and the 8.1 transport (§14.3)',
});

export interface VoiceCaller {
  connId: string;
  principal: string;
}
export interface HumanAsker {
  connId: string;
  principal: string | undefined;
  principalClass: string;
  credential: string | undefined;
}

export interface VoiceSessionsPort {
  /** The owner principal of a live session (Claude or local), or undefined. */
  ownerOf(hsid: string): string | undefined;
  send(owner: string, p: { hsid: string; text: string; source: 'voice'; voice: VoiceTurnLink }): Promise<unknown>;
  stop(owner: string, p: { hsid: string; interrupt: true }): Promise<unknown>;
  /**
   * V2a kernel-side busy: is the session's model turn streaming now (turn.sent until the main-chain reply's
   * end_turn message_stop, re-armed by a new main-chain message_start), and when (kernel clock, ms) did its last reply end. From supervisor state, never a client claim. Absent ⇒ never busy (tests).
   */
  busy?(hsid: string): { streaming: boolean; endedAt: number | null };
}

/** V2a: what the kernel hands the presence path (daemon: a `strictness` card whose allow is fresh presence). */
export interface VoicePresenceRequest {
  asker: HumanAsker;
  hsid: string;
  from: VoiceMode | null;
  to: 'conversation';
  /** TD-2026-10-21-514: the card also grants the pieces send ceiling (detail.send 'pieces') */
  send?: 'pieces';
  /** run on allow (after Touch ID); rejects if the attachment could not be made */
  onAllow: () => Promise<void>;
}

/**
 * Aegis M4: the link a forwarded voice turn leaves on the KERNEL-signed rows. `session.inject` keeps origin 'client'
 * (INJECT_ORIGINS is a published closed set; a new 'voice' origin would move clientApiId) and gains `source: 'voice'`;
 * `turn.sent` carries `source: 'voice'` (§4.10) plus voiceSessionId, voiceTurnId and voiceTurnSeq (the cited voice.turn.user
 * row). Both payloads are opaque to event:v1 (no KIND_PAYLOADS / RESERVED_PAYLOAD_FIELDS row), so nothing published moves.
 */
export function voiceTag(p: { source?: 'voice'; voice?: VoiceTurnLink; voiceAttribution?: VoiceAttribution }): Record<string, unknown> {
  // TD-2026-10-20-262: a human send attributed to dictated turns (the direct voice path never carries one)
  if (p.voiceAttribution) return dictationTag(p.voiceAttribution);
  if (p.source !== 'voice') return {};
  return { source: 'voice', ...(p.voice ? { voiceSessionId: p.voice.voiceSessionId, voiceTurnId: p.voice.turnId, voiceTurnSeq: p.voice.turnSeq } : {}) };
}

/**
 * TD-2026-10-20-262 dictation: the attribution of a HUMAN send whose composer text came from voice turns. 'voice' ⇒ every
 * content part matched a pending turn, in order; 'voice-edited' ⇒ some did (the human edited the composer).
 */
export interface VoiceAttribution {
  source: 'voice' | 'voice-edited';
  voiceSessionId: string;
  turnIds: string[];
  /** chain seqs of the matched voice.turn.user rows, in content order */
  turnSeqs: number[];
}

/** The dictation tag on the kernel-signed turn.sent / session.inject rows (opaque payload fields, nothing published moves). */
export function dictationTag(a: VoiceAttribution | undefined): Record<string, unknown> {
  if (!a) return {};
  return { source: a.source, voiceSessionId: a.voiceSessionId, voiceTurnSeqs: [...a.turnSeqs], ...(a.source === 'voice' ? { voiceTurnSeq: a.turnSeqs[a.turnSeqs.length - 1] } : {}) };
}

/** The voice principal of a human's namespace: `p:<ns>/<name>` ⇒ `p:<ns>/voice` (undefined for a non-`p:` principal). */
export function voicePrincipalOf(human: string): string | undefined {
  const m = /^p:([^/]+)\/[^/]+$/.exec(human);
  return m ? `p:${m[1]}/voice` : undefined;
}

/** Aegis M4: what the kernel-signed turn.sent / session.inject rows carry to link a forwarded turn to its voice row. */
export interface VoiceTurnLink {
  voiceSessionId: string;
  turnId: string;
  /** chain seq of the cited voice.turn.user row */
  turnSeq: number;
}

export interface VoiceAppendRow {
  kind: string;
  principal: string;
  payload: Record<string, unknown>;
  /** absent on a kernel-initiated row (idle auto-off) */
  connId?: string;
  session?: string;
  sensitivity?: string;
}

export interface VoiceControlOptions {
  /** V2e: the kernel-spawned voice client's status (status.voice.clientConnected, status.voice.client). */
  clientStatus?: () => { clientConnected: boolean };
  /** V2e: status.voice.enrolment / status.voice.notice, relayed from the client (VoiceReports.status). */
  reportStatus?: () => Record<string, unknown>;
  sessions: VoiceSessionsPort;
  /** Write one row (as: userland); resolves with what log.append returns. */
  append(row: VoiceAppendRow): Promise<{ seq: number; hash: string; id?: string }>;
  /** Currently enrolled speakerIds (root-verified rows, enrolment.ts). */
  enrolled(): ReadonlySet<string>;
  /** Live authenticated voice-class connections (dispatch.ts). */
  voiceConnections(): readonly string[];
  echoTailMs?: number;
  /** Max kernel-clock age of a forwardable turn (default VOICE_TURN_MAX_AGE_MS). */
  maxTurnAgeMs?: number;
  /** Kernel clock (ms). Default Date.now. */
  now?: () => number;
  /** The attachment started, ended or was replaced (daemon: end every voice log.read follow subscription, Aegis M3). */
  onAttachmentChange?: () => void;
  /** Aegis M1 (T-2026-10-20-005): the kernel accepted a voice turn (not refused, not intercepted) or a direct send on this voice connection (VoiceReports.accepted). */
  onAccepted?: (connId: string, kind: 'turn' | 'send') => void;
  /**
   * Calibration (voice drops fix): take (and reset) the kernel's tally of client-local capture drops since the last
   * take (VoiceReports.takeLocalDrops), or undefined when there were none. Stamped as `localDrops` on rows.
   */
  localDrops?: () => Record<string, number> | undefined;
  /** V2a: raise the fresh-presence card for widening to conversation; resolves with its cardId. Absent ⇒ widening refused. */
  presence?: (req: VoicePresenceRequest) => Promise<{ cardId: string }>;
  /** V2a: idle auto-off for a conversation ceiling (clamped by ambientIdleMsOf; default 10 min) */
  ambientIdleMs?: number;
  /** V2a: the principal the kernel writes its own voice.session.end{reason: 'idle'} under */
  kernelPrincipal?: string;
  /** V2a L1: the state of a widening card (broker card state); absent ⇒ treated as pending */
  presenceState?: (cardId: string) => string | undefined;
  /** V2a M2: the kernel's idle end row could not be written (daemon: diagnostics + a kernel log row) */
  onIdleEndFailed?: (err: unknown) => void;
  /** Aegis M-5: the voice app's last send-now press (VoiceReports.sendNowPress; kernel clock ms) */
  sendNowPress?: () => { n: number; at: number } | null;
  /** TD-2026-10-21-514: the held send word's source (daemon: <home>/voice/send-word.json via a stat-keyed cache) */
  sendWordSource?: () => SendWord | null;
  /** TD-2026-10-21-514: the strictness level of the session's repo (pieces is refused at L2 or above); absent ⇒ not built */
  strictnessLevel?: (hsid: string) => string | null;
  /** V2a: arm the idle timer (default setTimeout, unref'd); tests drive checkIdle() instead */
  setTimer?: (fn: () => void, ms: number) => { clear(): void };
}

interface UserTurn {
  turnId: string;
  connId: string;
  principal: string;
  speakerId: string;
  speakerEnrolled: boolean;
  intercepted: string | undefined;
  /** the client's per-turn mode claim (Aegis M2), cross-checked against the human's attachment mode */
  mode: string;
  t0: number;
  t1: number;
  /** kernel clock when the row was received (Aegis M1) */
  receivedAt: number;
  seq: number;
  /** keyed hash of the text (the kernel never keeps a turn's plaintext in memory) */
  textHash: string;
  attachment: string;
  /** V2a: the ambient echo-cancellation claim */
  aec: string | undefined;
  /** V2a: refused at receipt (stored without text): never forwardable */
  refused: RefusedError | undefined;
  /** TD-2026-10-21-514: the whole utterance is the held send word (#send-word-matcher at receipt; the text is not kept) */
  isWord: boolean;
  /** Aegis L-3: a take of the word being taught: never forwardable, never a draft, never an adjacency anchor */
  trialTake?: boolean;
}
interface Attachment {
  voiceSessionId: string;
  hsid: string;
  owner: string;
  mode: VoiceMode;
  turns: number;
  /** kernel clock when the start row was written */
  startedAt: number;
  /** kernel clock of the last forwarded turn (or startedAt): the idle clock of a conversation ceiling */
  lastForwardAt: number;
  /** the first-party connection that attached (its presence grant) */
  connId: string;
  /** TD-2026-10-21-514: the send ceiling (key unless the human attached with send word or pieces) */
  send: VoiceSendCeiling;
}

export function voiceRefusal(reason: string, message: string, data: Record<string, unknown> = {}, code: RefusalCode = 'FORBIDDEN'): RefusedError {
  return new RefusedError(refuse({ code, gate: 'voice', data: { ...data, reason } }), `#gnomon-voice: ${message}`);
}
function bad(message: string, reason = 'bad-params'): RefusedError {
  return new RefusedError(refuse({ code: 'BAD_REQUEST', data: { reason } }), `#gnomon-voice: ${message}`);
}
const isObj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0;
/** Monotone order for client turn ids: shorter first, then lexicographic ("9" < "10"; ULIDs compare as time). */
export function turnIdAfter(next: string, prev: string | undefined): boolean {
  if (prev === undefined) return true;
  return next.length !== prev.length ? next.length > prev.length : next > prev;
}

/** V2a: the fields a hash-only voice.turn.user row keeps (no text, no free-form client field). */
const HASH_ONLY_KEEP = ['turnId', 'speakerId', 'speakerEnrolled', 't0', 't1', 'mode', 'aec', 'intercepted', 'asrModel', 'confidence', 'speakerScore', 'gatedSpeechMs', 'speakerBasis'];
/**
 * Calibration (voice drops fix 2026-10-20): the client's speaker-verification score, COARSE (a bucket, never the
 * number), and how much speech survived its speech gate (ms, rounded to 10). Numbers only, no text, no audio; kept on
 * refused hash-only rows too, so the verifier threshold can be calibrated against real turns.
 */
export const VOICE_SPEAKER_SCORE_BUCKETS = ['none', 'lt0.5', '0.5-0.65', '0.65-0.8', 'ge0.8'] as const;
export const VOICE_GATED_SPEECH_MAX_MS = 10 * 60_000;
/**
 * Calibration: the client-local drop reasons the kernel tallies from capture reports (request.voice.report{capture},
 * dropped, not contradicted, no kernel refusal) and stamps as `localDrops{reason: n}` on the next voice.turn.user and
 * voice.session.end row. Counts only (hash-only by construction): no text, no audio, no segment ids.
 */
export const VOICE_LOCAL_DROP_REASONS = ['too-short', 'echo', 'not-attached', 'no-words', 'barge-in'] as const;
/** bounded memory of past attachments (voiceSessionId → owner) for `continues` */
const PAST_CAP = 64;

export class VoiceControl {
  readonly #o: VoiceControlOptions;
  #attachment: Attachment | null = null;
  readonly #userTurns = new Map<string, UserTurn>();
  readonly #latestByConn = new Map<string, string>();
  readonly #lastTurnId = new Map<string, string>();
  /** client playback times and the kernel receipt time of each voice.turn.agent row */
  readonly #playback: Array<{ t0: number; t1: number; receivedAt: number }> = [];
  readonly #forwarded = new Set<string>();
  /** V2a: first-party human connections that gave the widening presence (one GUI login each); dropped on close */
  readonly #widened = new Set<string>();
  /** V2a: a pending widening card per asking connection */
  readonly #pendingWiden = new Map<string, { cardId: string; hsid: string; send?: 'pieces' }>();
  /** connections with a widening card out that have not closed (a grant never lands on a closed login) */
  readonly #liveConn = new Set<string>();
  readonly #past = new Map<string, string>();
  /** per-boot key for text hashes (a stored hash cannot be dictionary-tested against short utterances) */
  readonly #hashKey = randomBytes(32);
  #idleTimer: { clear(): void } | null = null;
  /** Aegis V2a M2: idle end rows that could not be written (surfaced in status.voice) */
  #idleEndFailures = 0;
  /** TD-2026-10-21-514: the held send word (the daemon loads and persists it) */
  #sendWord: SendWord | null = null;
  /** first-party human connections that gave the pieces presence (one GUI login each) */
  readonly #piecesGranted = new Set<string>();
  /** turns cited by a live piece claim (a second claim citing one is stale) */
  readonly #claimed = new Set<string>();
  /** Aegis M-5: the send-now press count already consumed by a send (each press stamps one send at most) */
  #sendNowUsed = 0;
  /** the one live send claim per human connection */
  readonly #claims = new Map<string, { hsid: string; by: VoiceSentBy; expiresAt: number; turnIds: string[] }>();

  constructor(o: VoiceControlOptions) {
    this.#o = o;
  }

  #now(): number {
    return (this.#o.now ?? Date.now)();
  }

  #hash(text: string): string {
    return `hmac-sha256:${createHmac('sha256', this.#hashKey).update(text, 'utf8').digest('hex')}`;
  }

  get maxTurnAgeMs(): number {
    return this.#o.maxTurnAgeMs ?? VOICE_TURN_MAX_AGE_MS;
  }

  get ambientIdleMs(): number {
    return ambientIdleMsOf(this.#o.ambientIdleMs);
  }

  /** a turn the human may still send from the composer (dictation): accepted, unforwarded, of the live attachment */
  #pendingDictation(t: UserTurn): boolean {
    return !t.refused && !t.intercepted && !t.trialTake && !this.#forwarded.has(t.turnId) && this.#attachment !== null && t.attachment === this.#attachment.voiceSessionId;
  }

  /**
   * Aegis L4: keep only a recent window of turns and playback (a turn older than maxTurnAgeMs is refused on the direct
   * path anyway). TD-2026-10-20-262: a pending dictation turn of the live attachment outlives the horizon (the composer
   * countdown can be held) but never the cap.
   */
  #prune(): void {
    const horizon = this.#now() - 2 * this.maxTurnAgeMs;
    for (const [id, t] of this.#userTurns) {
      if (this.#userTurns.size <= VOICE_WINDOW_CAP && (t.receivedAt >= horizon || this.#pendingDictation(t))) continue;
      this.#userTurns.delete(id);
      this.#forwarded.delete(id);
      this.#claimed.delete(id);
    }
    while (this.#playback.length > VOICE_WINDOW_CAP || (this.#playback.length > 0 && this.#playback[0]!.receivedAt < horizon)) this.#playback.shift();
  }

  get echoTailMs(): number {
    return this.#o.echoTailMs ?? VOICE_ECHO_TAIL_MS_DEFAULT;
  }

  /** The attached session's hsid (the voice reader's scope), or null. */
  attachedHsid(): string | null {
    return this.#attachment?.hsid ?? null;
  }

  /**
   * TABLE TALK (TD-2026-10-20-294): the per-turn guidance for a send to `hsid`, or null. Non-null only while voice
   * is attached to exactly that session and its owner still owns it; every turn then (typed or voice) carries it.
   */
  guidanceFor(hsid: string): string | null {
    const a = this.#attachment;
    if (!a || a.hsid !== hsid || this.#o.sessions.ownerOf(hsid) !== a.owner) return null;
    return TABLE_TALK_GUIDANCE;
  }

  /** The idle deadline (kernel clock) of a conversation ceiling, or null (ptt never idles out). */
  #idleAt(a: Attachment): number | null {
    return a.mode === 'conversation' ? a.lastForwardAt + this.ambientIdleMs : null;
  }

  /**
   * status.voice — the kernel-owned live-mic indicator (V2a): {attached, hsid, ceiling, since, idleAt}, since/idleAt as
   * ISO strings (no bare numbers), plus the attachment id, its turn count (a gauge) and the configured limits.
   */
  status(): Record<string, unknown> {
    const a = this.#attachment;
    const iso = (t: number | null): string | null => (t === null ? null : new Date(t).toISOString());
    return {
      attached: a !== null,
      hsid: a?.hsid ?? null,
      ceiling: a?.mode ?? null,
      since: a ? iso(a.startedAt) : null,
      idleAt: a ? iso(this.#idleAt(a)) : null,
      voiceSessionId: a?.voiceSessionId ?? null,
      turns: { n: a?.turns ?? 0 },
      echoTailMs: this.echoTailMs,
      ambientIdleMs: this.ambientIdleMs,
      idleEndFailures: { n: this.#idleEndFailures },
      // TD-2026-10-21-514: the send ceiling and the held send word (voiceStatusFor shows sendWord to the human class only)
      send: a?.send ?? null,
      sendWord: ((w) => (w ? { text: w.text, variants: [...w.variants] } : null))(this.#word()),
      // V2e: an explicit boolean (never absent) plus the supervised child's phase for the GUI pill
      clientConnected: this.#o.clientStatus?.().clientConnected === true,
      ...(this.#o.clientStatus ? { client: this.#o.clientStatus() } : {}),
      // V2e (GUI alignment A1): the enrolled speaker NAMES, read from the root-signed consented registry
      enrolled: [...this.#o.enrolled()].map((id) => id.slice(id.indexOf('/') + 1)).sort(),
      // V2e (A3/A5): the client's relayed enrolment progress and last notice (request.voice.report; no log kind)
      ...(this.#o.reportStatus ? this.#o.reportStatus() : {}),
    };
  }

  /** The human gesture: `voice.session.start{hsid, mode?, continues?}` / `voice.session.end{}` from a first-party human connection. */
  async humanAppend(asker: HumanAsker, kind: string, payload: unknown): Promise<unknown> {
    if (asker.principalClass !== 'human' || !asker.principal || (asker.credential !== 'gui' && asker.credential !== 'device')) {
      throw new RefusedError(refuse({ code: 'FORBIDDEN', data: { reason: 'kernel-owned', needs: 'first-party human-class connection' } }), `#gnomon-voice: ${kind} is a human gesture on a first-party connection`);
    }
    const p = payload === undefined ? {} : payload;
    if (!isObj(p)) throw bad(`${kind} payload must be an object`);
    if (kind === 'voice.session.end') {
      const extra = Object.keys(p).filter((k) => k !== 'voiceSessionId');
      if (extra.length) throw bad(`voice.session.end takes {voiceSessionId?} (unknown: ${extra.slice(0, 4).join(', ')})`);
      const a = this.#attachment;
      if (!a || (p.voiceSessionId !== undefined && p.voiceSessionId !== a.voiceSessionId)) throw voiceRefusal('voice-target', 'no such voice attachment');
      if (this.#o.sessions.ownerOf(a.hsid) !== undefined && a.owner !== asker.principal) throw voiceRefusal('voice-target', 'the attachment belongs to another human');
      return this.#end(a, asker.connId, asker.principal);
    }
    if (kind !== 'voice.session.start') throw new RefusedError(refuse({ code: 'FORBIDDEN', data: { reason: 'ungranted' } }), `#gnomon-voice: ${kind} is the voice principal's (§4.10)`);
    const extra = Object.keys(p).filter((k) => k !== 'hsid' && k !== 'mode' && k !== 'continues' && k !== 'send' && k !== 'liabilityAck');
    if (extra.length) throw bad(`voice.session.start takes {hsid, mode?, continues?, send?, liabilityAck?} from the human (unknown: ${extra.slice(0, 4).join(', ')})`);
    if (typeof p.hsid !== 'string') throw bad('voice.session.start needs hsid');
    const mode = (p.mode ?? 'ptt') as VoiceMode;
    if (!VOICE_MODES_V1.includes(mode)) throw bad('mode is ptt or conversation');
    // TD-2026-10-21-514: the send ceiling; word and pieces need ambient capture (a conversation ceiling)
    const send = (p.send ?? 'key') as VoiceSendCeiling;
    if (!VOICE_SEND_CEILINGS.includes(send)) throw bad('send is key, word or pieces');
    if (send !== 'key' && mode !== 'conversation') throw bad('send word and pieces need mode conversation (ambient capture)');
    if (send === 'pieces') this.#refusePiecesByLevel(p.hsid);
    // Aegis M-4: Send word and Pieces are liability modes: the human's attach carries the acknowledgement's hash
    // (shown in the GUI's dialog; for Pieces also on the presence card), and the kernel records it in the start row
    if (send !== 'key' && p.liabilityAck !== VOICE_LIABILITY_ACK_HASH) throw voiceRefusal('voice-off', `send ${send} needs the liability acknowledgement ("${VOICE_LIABILITY_ACK_TEXT}")`, { send, cause: 'liability-ack', ackHash: VOICE_LIABILITY_ACK_HASH });
    if (send === 'key' && p.liabilityAck !== undefined) throw bad('liabilityAck rides only a send word or pieces attach');
    if (p.continues !== undefined && typeof p.continues !== 'string') throw bad('continues names a prior voiceSessionId');
    const owner = this.#o.sessions.ownerOf(p.hsid);
    if (owner === undefined || owner !== asker.principal) throw new RefusedError(refuse({ code: 'NOT_FOUND', data: { reason: 'not-found' } }), '#gnomon-voice: no such live session for this principal');
    // V2a: `continues` names the human's OWN prior attachment (the current one or a remembered past one)
    const continues = typeof p.continues === 'string' ? p.continues : undefined;
    if (continues !== undefined) {
      const cur = this.#attachment;
      const of = cur && cur.voiceSessionId === continues ? cur.owner : this.#past.get(continues);
      if (of !== asker.principal) throw voiceRefusal('voice-target', 'continues names no voice attachment of yours', { continues });
    }
    const prev = this.#attachment;
    // Aegis L4: a human replaces only their own attachment (a gone session's attachment is anyone's to replace)
    if (prev && prev.owner !== asker.principal && this.#o.sessions.ownerOf(prev.hsid) === prev.owner) throw voiceRefusal('voice-target', "voice is attached to another human's session");
    // V2a widening: a conversation ceiling takes one fresh presence per first-party connection (one GUI login);
    // TD-2026-10-21-514: so does the pieces send ceiling (the same card, detail.send 'pieces')
    if ((mode === 'conversation' && !this.#widened.has(asker.connId)) || (send === 'pieces' && !this.#piecesGranted.has(asker.connId))) {
      // Aegis V2a L1: a pending card is reused only while it is still pending and for the same session; a denied or
      // expired card is dropped and a new one raised
      // a card the broker no longer knows counts as not pending (Aegis re-check); only an unwired presenceState
      // keeps the old reuse behaviour
      const live = (id: string): boolean => (this.#o.presenceState ? this.#o.presenceState(id) === 'pending' : true);
      const still = this.#pendingWiden.get(asker.connId);
      if (still && live(still.cardId) && still.hsid === p.hsid && still.send === (send === 'pieces' ? 'pieces' : undefined)) return { pending: true, cardId: still.cardId, hsid: still.hsid, mode };
      if (still && still.hsid !== p.hsid && live(still.cardId)) {
        throw bad(`a widening card for session ${still.hsid} is pending on this connection; decide it first`);
      }
      this.#pendingWiden.delete(asker.connId);
      if (!this.#o.presence) throw voiceRefusal('voice-off', 'widening to conversation needs fresh presence, and no presence path is wired', { mode, cause: 'presence' });
      const hsid = p.hsid;
      this.#liveConn.add(asker.connId);
      const card = await this.#o.presence({
        asker,
        hsid,
        from: prev && prev.owner === asker.principal ? prev.mode : null,
        to: 'conversation',
        ...(send === 'pieces' ? { send: 'pieces' as const } : {}),
        onAllow: async () => {
          this.#pendingWiden.delete(asker.connId);
          if (!this.#liveConn.has(asker.connId)) return; // the login closed while the card waited: nothing is granted
          this.#widened.add(asker.connId);
          if (send === 'pieces') {
            this.#refusePiecesByLevel(hsid); // re-checked at the effect (a level may have tightened meanwhile)
            this.#piecesGranted.add(asker.connId);
          }
          await this.#start(asker, hsid, 'conversation', continues, send);
        },
      });
      const granted = this.#widened.has(asker.connId) && (send !== 'pieces' || this.#piecesGranted.has(asker.connId));
      if (this.#liveConn.has(asker.connId) && !granted) this.#pendingWiden.set(asker.connId, { cardId: card.cardId, hsid, ...(send === 'pieces' ? { send: 'pieces' as const } : {}) });
      return { pending: true, cardId: card.cardId, hsid, mode };
    }
    return this.#start(asker, p.hsid, mode, continues, send);
  }

  /** TD-2026-10-21-514: pieces is refused at strictness L2 or above (an unreadable level refuses: fail closed). */
  #refusePiecesByLevel(hsid: string): void {
    let level: string | null;
    try {
      level = this.#o.strictnessLevel?.(hsid) ?? null;
    } catch {
      level = 'L3';
    }
    if (level === 'L2' || level === 'L3') throw voiceRefusal('voice-strictness', 'pieces is refused at strictness L2 or above', { send: 'pieces', level, ceiling: level });
  }

  async #start(asker: HumanAsker, hsid: string, mode: VoiceMode, continues: string | undefined, send: VoiceSendCeiling = 'key'): Promise<unknown> {
    const owner = this.#o.sessions.ownerOf(hsid);
    if (owner === undefined || owner !== asker.principal) throw new RefusedError(refuse({ code: 'NOT_FOUND', data: { reason: 'not-found' } }), '#gnomon-voice: no such live session for this principal');
    const prev = this.#attachment;
    if (prev && prev.owner !== asker.principal && this.#o.sessions.ownerOf(prev.hsid) === prev.owner) throw voiceRefusal('voice-target', "voice is attached to another human's session");
    if (prev) await this.#end(prev, asker.connId, asker.principal);
    const now = this.#now();
    const a: Attachment = { voiceSessionId: `vs:${ulid()}`, hsid, owner, mode, turns: 0, startedAt: now, lastForwardAt: now, connId: asker.connId, send };
    const r = await this.#o.append({
      kind: 'voice.session.start',
      principal: owner,
      payload: { voiceSessionId: a.voiceSessionId, hsid: a.hsid, mode, ...(send !== 'key' ? { send, liabilityAck: { principal: asker.principal, ackHash: VOICE_LIABILITY_ACK_HASH } } : {}), ...(continues ? { continues } : {}), engines: null, device: null, audioRetention: 'none' },
      connId: asker.connId,
      session: a.hsid,
    });
    this.#attachment = a; // only after the row is written (log before effect)
    this.#armIdle();
    this.#o.onAttachmentChange?.();
    return { ...r, voiceSessionId: a.voiceSessionId, hsid: a.hsid, mode, send };
  }

  async #end(a: Attachment, connId: string | undefined, principal: string, reason?: 'idle'): Promise<unknown> {
    const drops = this.#o.localDrops?.();
    const r = await this.#o.append({ kind: 'voice.session.end', principal, payload: { voiceSessionId: a.voiceSessionId, turns: a.turns, compactedTo: null, ...(reason ? { reason } : {}), ...(drops ? { localDrops: drops } : {}) }, ...(connId ? { connId } : {}), session: a.hsid });
    this.#past.set(a.voiceSessionId, a.owner);
    while (this.#past.size > PAST_CAP) this.#past.delete(this.#past.keys().next().value!);
    if (this.#attachment === a) {
      this.#attachment = null;
      this.#idleTimer?.clear();
      this.#idleTimer = null;
      this.#o.onAttachmentChange?.();
    }
    return { ...r, voiceSessionId: a.voiceSessionId };
  }

  #armIdle(retryMs?: number): void {
    this.#idleTimer?.clear();
    this.#idleTimer = null;
    const a = this.#attachment;
    const at = a ? this.#idleAt(a) : null;
    if (at === null) return;
    const ms = retryMs ?? Math.max(0, at - this.#now()) + 1;
    const set =
      this.#o.setTimer ??
      ((fn: () => void, d: number) => {
        const t = setTimeout(fn, d);
        t.unref?.();
        return { clear: () => clearTimeout(t) };
      });
    this.#idleTimer = set(() => void this.checkIdle().catch(() => undefined), ms);
  }

  /**
   * V2a idle auto-off: a conversation ceiling whose idle deadline passed is ended BY THE KERNEL
   * (voice.session.end{reason: 'idle'} under the kernel principal); the row reaches every log.read subscriber, so the
   * GUI's live-mic indicator flips. Returns whether it ended one. The timer calls this; tests call it directly.
   */
  async checkIdle(): Promise<boolean> {
    const a = this.#attachment;
    const at = a ? this.#idleAt(a) : null;
    if (!a || at === null) return false;
    if (this.#now() < at) {
      this.#armIdle();
      return false;
    }
    try {
      await this.#end(a, undefined, this.#o.kernelPrincipal ?? a.owner, 'idle');
    } catch (err) {
      // Aegis V2a M2: never swallowed — reported, and the timer re-armed; send() already refuses past idleAt (fail closed)
      this.#idleEndFailures++;
      this.#o.onIdleEndFailed?.(err);
      if (this.#attachment === a) this.#armIdle(VOICE_IDLE_RETRY_MS);
      return false;
    }
    return true;
  }

  /** `log.append voice.*` from the voice principal. */
  async voiceAppend(c: VoiceCaller, params: unknown): Promise<unknown> {
    if (!isObj(params)) throw bad('log.append params must be an object {kind, payload, sensitivity?}');
    const extra = Object.keys(params).filter((k) => k !== 'kind' && k !== 'payload' && k !== 'sensitivity');
    if (extra.length) throw bad(`log.append from the voice principal takes {kind, payload, sensitivity?} (unknown: ${extra.slice(0, 4).join(', ')})`);
    const kind = String(params.kind);
    const why = VOICE_NOT_BY_VOICE[kind];
    if (why) throw new RefusedError(refuse({ code: 'FORBIDDEN', data: { reason: 'ungranted', verb: 'log.append', kind, principalClass: 'voice' } }), `#gnomon-voice: ${why}`);
    if (!VOICE_APPENDABLE.includes(kind)) throw new RefusedError(refuse({ code: 'FORBIDDEN', data: { reason: 'ungranted', verb: 'log.append', kind, principalClass: 'voice' } }), `#gnomon-voice: ${kind} is not a voice:v1 kind (§4.10)`);
    const sensitivity = params.sensitivity;
    if (sensitivity !== undefined && !(SENS as readonly unknown[]).includes(sensitivity)) throw bad('sensitivity is normal | sensitive | secret');
    if (!isObj(params.payload)) throw bad(`${kind} needs a payload object`);
    const p = params.payload;
    const a = this.#attachment;
    if (kind === 'voice.session.end') {
      // V2a: the voice principal may end the attachment, never start it or set its mode
      if (Object.hasOwn(p, 'mode')) throw bad('the voice principal never sets the attachment mode (a human gesture)');
      if (!a || p.voiceSessionId !== a.voiceSessionId) throw voiceRefusal('voice-target', 'no such voice attachment');
      return this.#end(a, c.connId, c.principal);
    }
    const commit: Array<(seq: number) => void> = [];
    // Aegis M1: the kernel stamps its own receipt time on every turn row; a client-sent receivedAt is refused
    if (Object.hasOwn(p, 'receivedAt')) throw bad('receivedAt is stamped by the kernel');
    // TD-2026-10-20-262: forwardable is the kernel's verdict on the row, never a client claim
    if (Object.hasOwn(p, 'forwardable')) throw bad('forwardable is stamped by the kernel');
    // calibration: the local-drop tally is the kernel's (from capture reports), never a client claim
    if (Object.hasOwn(p, 'localDrops')) throw bad('localDrops is stamped by the kernel');
    const receivedAt = this.#now();
    let stamped: Record<string, unknown> = kind === 'voice.turn.user' || kind === 'voice.turn.agent' ? { ...p, receivedAt } : { ...p };
    let refusedAtReceipt: RefusedError | undefined;
    switch (kind) {
      case 'voice.turn.user': {
        const t = this.#checkTurnCommon(p, kind);
        if (typeof p.speakerId !== 'string' || !SPEAKER_ID.test(p.speakerId)) throw bad('speakerId is spk:<ns>/<name> or spk:unknown-N');
        if (typeof p.speakerEnrolled !== 'boolean' || typeof p.forwarded !== 'boolean') throw bad('speakerEnrolled and forwarded are booleans');
        // V2e item 4: the kernel decides who is enrolled. speakerEnrolled:true counts ONLY when speakerId is in the
        // root-signed consented registry (readEnrolled); any other claim — an unknown-N label, a forgotten or never
        // enrolled name — is treated as an unknown speaker: stored hash-only (no text) and never forwardable
        let enrolledNow = p.speakerEnrolled === true && !p.speakerId.startsWith('spk:unknown-') && this.#o.enrolled().has(p.speakerId);
        // TD-2026-10-21-514 short words by adjacency: the speaker is the draft speaker's, never verified on the segment
        if (p.speakerBasis !== undefined) {
          if (p.speakerBasis !== 'adjacent') throw bad("speakerBasis is 'adjacent'");
          if (enrolledNow && !this.#adjacentOk(p, receivedAt)) enrolledNow = false;
        }
        // Aegis L-1: a SHORT send word must pass the adjacency rule whether or not it says speakerBasis (a short
        // segment is never speaker-verified, so a bare enrolled claim on one proves nothing)
        if (enrolledNow && p.speakerBasis === undefined && num(p.t0) && num(p.t1) && p.t1 - p.t0 < SEND_WORD_SHORT_MS && typeof p.text === 'string' && isSendWord(p.text, this.#word()) && !this.#adjacentOk(p, receivedAt)) enrolledNow = false;
        if (p.intercepted !== undefined && p.intercepted !== 'decision' && p.intercepted !== 'control') throw bad('intercepted is decision | control');
        if (p.intercepted !== undefined && p.forwarded !== false) throw bad('an intercepted turn is never forwarded');
        if (typeof p.text !== 'string') throw bad('text is a string');
        // Aegis M2: a per-turn mode claim, checked at send against the human's attachment ceiling
        if (!(VOICE_MODES_V1 as readonly unknown[]).includes(p.mode)) throw bad("voice.turn.user needs mode: ptt | conversation (the client's claim for this turn)");
        if (p.aec !== undefined && !(VOICE_AEC as readonly unknown[]).includes(p.aec)) throw bad('aec is vpio | headphones');
        // Aegis V2a L3: the free-form ASR metadata is bounded on every row
        if (p.asrModel !== undefined && (typeof p.asrModel !== 'string' || !ASR_MODEL.test(p.asrModel))) throw bad('asrModel is ≤ 64 of [A-Za-z0-9_.-]');
        if (p.confidence !== undefined && (typeof p.confidence !== 'number' || !Number.isFinite(p.confidence) || p.confidence < 0 || p.confidence > 1)) throw bad('confidence is a number in 0..1');
        if (p.speakerScore !== undefined && !(VOICE_SPEAKER_SCORE_BUCKETS as readonly unknown[]).includes(p.speakerScore)) throw bad(`speakerScore is a bucket: ${VOICE_SPEAKER_SCORE_BUCKETS.join(' | ')}`);
        if (p.gatedSpeechMs !== undefined && (typeof p.gatedSpeechMs !== 'number' || !Number.isSafeInteger(p.gatedSpeechMs) || p.gatedSpeechMs < 0 || p.gatedSpeechMs > VOICE_GATED_SPEECH_MAX_MS || p.gatedSpeechMs % 10 !== 0)) throw bad(`gatedSpeechMs is an integer 0..${VOICE_GATED_SPEECH_MAX_MS}, a multiple of 10`);
        const turn: UserTurn = {
          turnId: t.turnId,
          connId: c.connId,
          principal: c.principal,
          speakerId: p.speakerId,
          speakerEnrolled: enrolledNow,
          intercepted: p.intercepted as string | undefined,
          mode: p.mode as string,
          t0: t.t0,
          t1: t.t1,
          receivedAt,
          seq: 0,
          textHash: this.#hash(p.text),
          attachment: a?.voiceSessionId ?? '',
          aec: p.aec as string | undefined,
          refused: undefined,
          isWord: typeof p.text === 'string' && isSendWord(p.text, this.#word()),
          ...(typeof p.text === 'string' && !isSendWord(p.text, this.#word()) && isSendWord(p.text, this.#trialWord()) ? { trialTake: true } : {}),
        };
        // V2a privacy: the guards decidable at receipt run now; a refused turn is stored without its text. V2e: an
        // unenrolled speaker's turn is refused at receipt even when intercepted (a decision or control phrase)
        if (!enrolledNow) refusedAtReceipt = voiceRefusal('voice-speaker', 'only enrolled speakers are forwarded (G-VOX-06)', { turnId: turn.turnId });
        else if (!turn.intercepted) {
          refusedAtReceipt = a ? this.#guards(turn, a) : voiceRefusal('voice-target', 'voice is not attached (attach is a human gesture)', { turnId: turn.turnId });
        }
        const drops = this.#o.localDrops?.();
        if (drops) stamped = { ...stamped, localDrops: drops };
        if (refusedAtReceipt) {
          turn.refused = refusedAtReceipt;
          const kept: Record<string, unknown> = {};
          for (const k of HASH_ONLY_KEEP) if (p[k] !== undefined) kept[k] = p[k];
          const d = (refusedAtReceipt.refusal.data ?? {}) as Record<string, unknown>;
          stamped = { ...kept, speakerEnrolled: enrolledNow, forwarded: false, receivedAt, textHash: turn.textHash, durationMs: t.t1 - t.t0, refusedReason: d.reason, ...(d.cause ? { refusedCause: d.cause } : {}), ...(drops ? { localDrops: drops } : {}) };
        } else {
          // TD-2026-10-20-262: the kernel's verdict — an accepted turn may go to the composer (or a direct send)
          // Aegis L-3: a take of the word being taught is shown to the dialog (trialTake) but never forwardable
          stamped = { ...stamped, forwardable: !turn.intercepted && !turn.trialTake, ...(turn.trialTake ? { trialTake: true } : {}) };
        }
        commit.push((seq) => {
          turn.seq = seq;
          this.#userTurns.set(t.turnId, turn);
          this.#latestByConn.set(c.connId, t.turnId);
          if (a) a.turns++;
          if (!turn.refused && !turn.intercepted) this.#o.onAccepted?.(c.connId, 'turn');
        });
        break;
      }
      case 'voice.turn.agent': {
        const t = this.#checkTurnCommon(p, kind);
        // V2e: source 'kernel-speakable' is the kernel's own speakable row; the voice principal can never write one
        if (p.source === 'kernel-speakable') throw bad("source 'kernel-speakable' is written by the kernel only");
        for (const k of ['textPlanned', 'textSpoken'] as const) if (typeof p[k] !== 'string') throw bad(`${k} is a string`);
        if (Buffer.byteLength(String(p.textPlanned), 'utf8') > VOICE_TEXT_MAX_BYTES) throw bad('textPlanned is at most 16 KiB');
        commit.push(() => this.#playback.push({ t0: t.t0, t1: t.t1, receivedAt }));
        break;
      }
      case 'voice.focus':
        if (typeof p.cardId !== 'string') throw bad('voice.focus{cardId}');
        break;
      case 'voice.tts.filtered':
      case 'voice.bargein':
        if (typeof p.turnId !== 'string' || !TURN_ID.test(p.turnId)) throw bad(`${kind}{turnId}`);
        if (kind === 'voice.bargein' && (!num(p.atMs) || typeof p.heardText !== 'string' || Buffer.byteLength(p.heardText, 'utf8') > VOICE_TEXT_MAX_BYTES)) throw bad('voice.bargein{turnId, atMs, heardText ≤ 16 KiB}');
        break;
      case 'voice.deck':
        if (typeof p.deckId !== 'string' || !Array.isArray(p.cardIds) || !p.cardIds.every((x) => typeof x === 'string') || typeof p.textHash !== 'string') throw bad('voice.deck{deckId, cardIds[], textHash}');
        break;
    }
    this.#prune();
    const r = await this.#o.append({ kind, principal: c.principal, payload: stamped, connId: c.connId, ...(a ? { session: a.hsid } : {}), ...(typeof sensitivity === 'string' ? { sensitivity } : {}) });
    for (const f of commit) f(r.seq);
    if (refusedAtReceipt) {
      // voice drops fix: the verdict and its V2a cause go back to the client, which ends the capture as dropped with them
      const d = (refusedAtReceipt.refusal.data ?? {}) as Record<string, unknown>;
      return { ...r, forwardable: false, refused: d.reason, ...(typeof d.cause === 'string' ? { refusedCause: d.cause } : {}) };
    }
    if (kind === 'voice.turn.user') return { ...r, forwardable: stamped.forwardable === true, ...(stamped.trialTake === true ? { trialTake: true } : {}) };
    return r;
  }

  /**
   * TD-2026-10-21-514: an adjacent short word is accepted only when it is under SEND_WORD_SHORT_MS, is the held send
   * word, and starts within SEND_WORD_ADJACENT_MS of an accepted turn of that speaker in this attachment, or while that
   * speaker has pending draft turns.
   */
  #adjacentOk(p: Record<string, unknown>, receivedAt: number): boolean {
    const a = this.#attachment;
    if (!a || !num(p.t0) || !num(p.t1) || p.t1 < p.t0 || p.t1 - p.t0 >= SEND_WORD_SHORT_MS) return false;
    // the held word, or the word being taught ("Teach Gnomon your send word": its takes are short words too)
    if (typeof p.text !== 'string' || !(isSendWord(p.text, this.#word()) || isSendWord(p.text, this.#trialWord()))) return false;
    const start = receivedAt - (p.t1 - p.t0);
    for (const t of this.#userTurns.values()) {
      if (t.speakerId !== p.speakerId || t.refused || t.intercepted || t.trialTake || t.attachment !== a.voiceSessionId || t.isWord) continue;
      if (this.#pendingDictation(t) || Math.abs(start - t.receivedAt) <= SEND_WORD_ADJACENT_MS) return true;
    }
    return false;
  }

  /** TD-2026-10-21-514: the held send word (null = none). The daemon persists it; this only holds it. */
  setSendWord(w: unknown): SendWord | null {
    if (w === null) {
      this.#sendWord = null;
      return null;
    }
    const c = canonicalSendWord(w);
    if (!c) throw bad('the send word is 1-3 words, never an approval or command phrase (validateSendWord)');
    this.#sendWord = c;
    return c;
  }

  sendWord(): SendWord | null {
    return this.#word();
  }

  /** TD-2026-10-21-514: the word being taught (adjacency only, never isWord, never a send), with its kernel-clock expiry */
  #trial: { word: SendWord; until: number } | null = null;
  setTrialWord(w: unknown, ttlMs = SEND_WORD_TRIAL_MS): SendWord | null {
    if (w === null) {
      this.#trial = null;
      return null;
    }
    const c = canonicalSendWord(w);
    if (!c) throw bad('the send word is 1-3 words, never an approval or command phrase (validateSendWord)');
    this.#trial = { word: c, until: this.#now() + ttlMs };
    return c;
  }
  #trialWord(): SendWord | null {
    if (this.#trial && this.#now() > this.#trial.until) this.#trial = null;
    return this.#trial?.word ?? null;
  }

  /** the held word: the daemon's file source when wired (the CLI and the GUI land in one file), else setSendWord's */
  #word(): SendWord | null {
    if (!this.#o.sendWordSource) return this.#sendWord;
    try {
      return this.#o.sendWordSource();
    } catch {
      return null; // an unreadable word never makes a word send
    }
  }

  /** The human's pending dictation turns of the live attachment on hsid (forwardable, unforwarded, unclaimed). */
  #pendingOf(human: string, hsid: string): { a: Attachment; pending: UserTurn[] } | null {
    const a = this.#attachment;
    const vp = voicePrincipalOf(human);
    if (!a || !vp || a.hsid !== hsid || a.owner !== human || this.#o.sessions.ownerOf(hsid) !== a.owner) return null;
    const pending = [...this.#userTurns.values()].filter((t) => t.principal === vp && t.attachment === a.voiceSessionId && t.receivedAt >= a.startedAt && t.seq > 0 && this.#pendingDictation(t) && !this.#claimed.has(t.turnId));
    return { a, pending };
  }

  /**
   * `request.voice.send.claim{hsid, by:'word'|'piece', turnSeq|turnSeqs}` from a first-party human connection
   * ($send-by-word, $send-by-pieces). Checks, consumes atomically and binds the connection's next voice send.
   */
  claimSend(asker: HumanAsker, payload: unknown): { claimed: true; by: VoiceSentBy; expiresAt: string } {
    if (asker.principalClass !== 'human' || !asker.principal || (asker.credential !== 'gui' && asker.credential !== 'device')) {
      throw new RefusedError(refuse({ code: 'FORBIDDEN', data: { reason: 'kernel-owned', needs: 'first-party human-class connection' } }), '#gnomon-voice: a send claim is a human gesture on a first-party connection');
    }
    if (!isObj(payload)) throw bad('request.voice.send.claim takes {hsid, by, turnSeq | turnSeqs}');
    const extra = Object.keys(payload).filter((k) => !['hsid', 'by', 'turnSeq', 'turnSeqs'].includes(k));
    if (extra.length) throw bad(`request.voice.send.claim takes {hsid, by, turnSeq | turnSeqs} (unknown: ${extra.slice(0, 4).join(', ')})`);
    const { hsid, by } = payload;
    if (typeof hsid !== 'string') throw bad('hsid is required');
    const seqOk = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v > 0;
    if (by === 'hotkey') {
      // Aegis M-5: the GUI announces a send-now send; it binds like any claim (the press itself is consumed at the send)
      if (payload.turnSeq !== undefined || payload.turnSeqs !== undefined) throw bad("by 'hotkey' cites no turn");
      if (!this.#pendingOf(asker.principal, hsid)) throw voiceRefusal('voice-target', 'voice is not attached to that session of yours');
      const at = this.#now() + SEND_CLAIM_TTL_MS;
      this.#claims.set(asker.connId, { hsid, by: 'hotkey', expiresAt: at, turnIds: [] });
      return { claimed: true, by: 'hotkey', expiresAt: new Date(at).toISOString() };
    }
    if (by === 'word') {
      if (!seqOk(payload.turnSeq) || payload.turnSeqs !== undefined) throw bad("by 'word' cites one turnSeq");
    } else if (by === 'piece') {
      const ts = payload.turnSeqs;
      if (!Array.isArray(ts) || ts.length === 0 || ts.length > PIECE_CLAIM_MAX_TURNS || !ts.every(seqOk) || new Set(ts).size !== ts.length || payload.turnSeq !== undefined) throw bad(`by 'piece' cites turnSeqs (1..${PIECE_CLAIM_MAX_TURNS} distinct seqs)`);
    } else throw bad("by is 'word', 'piece' or 'hotkey'");
    const got = this.#pendingOf(asker.principal, hsid);
    if (!got) throw voiceRefusal('voice-target', 'voice is not attached to that session of yours');
    const { a, pending } = got;
    const now = this.#now();
    const stale = (why: string, data: Record<string, unknown> = {}): RefusedError => voiceRefusal('voice-stale-utterance', why, { ...data, by });
    let turnIds: string[];
    if (by === 'word') {
      if (sendRank(a.send) < sendRank('word')) throw voiceRefusal('voice-off', "the attachment's send ceiling does not allow a send word", { send: a.send, cause: 'send-ceiling' });
      const t = pending.find((x) => x.seq === payload.turnSeq);
      if (!t) throw stale('the cited turn is not a pending turn of this attachment (already consumed by another send?)', { turnSeq: payload.turnSeq });
      if (!t.isWord) throw stale('the cited turn is not the send word', { turnSeq: t.seq, cause: 'not-send-word' });
      if (now - t.receivedAt > SEND_WORD_CLAIM_MAX_AGE_MS) throw stale(`the send word was received more than ${SEND_WORD_CLAIM_MAX_AGE_MS} ms ago`, { turnSeq: t.seq, maxAgeMs: SEND_WORD_CLAIM_MAX_AGE_MS });
      if (pending.some((x) => x !== t && !x.isWord && x.receivedAt > t.receivedAt)) throw stale('the send word must come after every pending draft turn', { turnSeq: t.seq, cause: 'order' });
      // consumed: never claimable, attributable or sendable again
      this.#forwarded.add(t.turnId);
      turnIds = [t.turnId];
    } else {
      if (sendRank(a.send) < sendRank('pieces')) throw voiceRefusal('voice-off', "the attachment's send ceiling does not allow pieces", { send: a.send, cause: 'send-ceiling' });
      this.#refusePiecesByLevel(hsid);
      const seqs = payload.turnSeqs as number[];
      const ts = seqs.map((q) => pending.find((x) => x.seq === q));
      if (ts.some((x) => x === undefined || x.isWord)) throw stale('every cited turn must be a pending draft turn of this attachment');
      turnIds = (ts as UserTurn[]).map((x) => x.turnId);
      for (const id of turnIds) this.#claimed.add(id);
    }
    // one live claim per connection: a replaced piece claim hands its turns back
    const prev = this.#claims.get(asker.connId);
    if (prev && prev.by === 'piece') for (const id of prev.turnIds) this.#claimed.delete(id);
    const expiresAt = now + SEND_CLAIM_TTL_MS;
    this.#claims.set(asker.connId, { hsid, by, expiresAt, turnIds });
    a.lastForwardAt = now;
    this.#armIdle();
    return { claimed: true, by, expiresAt: new Date(expiresAt).toISOString() };
  }

  /**
   * The origin of a human `session.send{source:'voice'}` (#supervisor stamps it on turn.sent): the connection's live
   * claim (consumed here; an expired one is dropped), else the fail-closed backstop — an unclaimed pending turn of the
   * attachment that is the send word stamps 'word' (and is consumed). null ⇒ hand. NEVER throws.
   */
  originFor(connId: string | undefined, human: string, hsid: string, attr: VoiceAttribution | null = null): { sentBy: VoiceSentBy } | null {
    try {
      const c = connId !== undefined ? this.#claims.get(connId) : undefined;
      if (c && connId !== undefined) {
        // Aegis H-1: any human send on a connection with a claim is voice-origin, whatever its source hint.
        // Aegis M-1: an EXPIRED claim, or one naming another session, never falls through to hand: it stamps voice
        // too (its word turn is already consumed), fail closed.
        this.#claims.delete(connId);
        if (c.by === 'piece' && c.hsid !== hsid) for (const id of c.turnIds) this.#claimed.delete(id);
        if (c.by === 'hotkey') this.#sendNowUsed = Math.max(this.#sendNowUsed, this.#o.sendNowPress?.()?.n ?? 0);
        return { sentBy: c.by };
      }
      // Aegis M-5 backstop: an unconsumed send-now press of the voice app within the claim TTL stamps this send a
      // hotkey (voice-origin) send, claim or not: the press is the voice principal's report, never verifiable here
      const press = this.#o.sendNowPress?.() ?? null;
      if (press && press.n > this.#sendNowUsed && Date.now() - press.at <= SEND_CLAIM_TTL_MS) {
        this.#sendNowUsed = press.n;
        return { sentBy: 'hotkey' };
      }
      const got = this.#pendingOf(human, hsid);
      const words = got ? got.pending.filter((t) => t.isWord) : [];
      if (words.length > 0) {
        for (const t of words) this.#forwarded.add(t.turnId);
        return { sentBy: 'word' };
      }
      // Aegis M-2: under a send ceiling of word or higher, a send whose parts matched an ambient (non-ptt) turn is a
      // piece unless a claim said otherwise (fail closed: ambient speech sent without a claim is still voice-origin)
      const a = this.#attachment;
      if (attr && a && a.hsid === hsid && sendRank(a.send) >= sendRank('word') && attr.turnIds.some((id) => this.#userTurns.get(id)?.mode !== 'ptt')) return { sentBy: 'piece' };
      return null;
    } catch {
      return { sentBy: 'word' }; // an origin check that fails is a voice origin (the clamp fails closed)
    }
  }

  #checkTurnCommon(p: Record<string, unknown>, kind: string): { turnId: string; t0: number; t1: number } {
    if (typeof p.turnId !== 'string' || !TURN_ID.test(p.turnId)) throw bad(`${kind}.turnId is a turn id (≤ 64 of [0-9A-Za-z:._-])`);
    if (!turnIdAfter(p.turnId, this.#lastTurnId.get(kind))) throw bad(`${kind}.turnId must be monotone (after ${this.#lastTurnId.get(kind)})`);
    if (!num(p.t0) || !num(p.t1) || p.t1 < p.t0) throw bad(`${kind} needs t0 ≤ t1 (wall ms)`);
    const text = kind === 'voice.turn.user' ? p.text : p.textSpoken;
    if (typeof text === 'string' && Buffer.byteLength(text, 'utf8') > VOICE_TEXT_MAX_BYTES) throw bad(`${kind} text is at most 16 KiB`);
    this.#lastTurnId.set(kind, p.turnId); // shape is checked; the order holds even if the write below fails (never reuse an id)
    return { turnId: p.turnId, t0: p.t0, t1: p.t1 };
  }

  /**
   * The content guards, run at receipt and again at send: speaker, ceiling, the ambient guards (aec, kernel busy)
   * and echo. Returns the refusal, or undefined when the turn may go.
   */
  #guards(turn: UserTurn, a: Attachment): RefusedError | undefined {
    // Aegis V2a M2: idle fails closed — past idleAt nothing is forwarded, even before the kernel's end row lands
    const idleAt = this.#idleAt(a);
    if (idleAt !== null && this.#now() >= idleAt) return voiceRefusal('voice-off', 'the ambient attachment is idle (ended by the kernel)', { turnId: turn.turnId, ceiling: a.mode, cause: 'idle' });
    if (!turn.speakerEnrolled || !this.#o.enrolled().has(turn.speakerId)) return voiceRefusal('voice-speaker', 'only enrolled speakers are forwarded (G-VOX-06)', { turnId: turn.turnId });
    // V2a: the attachment mode is a CEILING — ptt under any, conversation only under conversation
    if (turn.mode !== 'ptt' && turn.mode !== a.mode) return voiceRefusal('voice-off', "the turn's mode is above the attachment's ceiling", { turnId: turn.turnId, mode: turn.mode, ceiling: a.mode, cause: 'ceiling' });
    const tail = this.echoTailMs;
    const userStart = turn.receivedAt - (turn.t1 - turn.t0);
    // Aegis V2a M1: under a conversation ceiling the ambient guards run on EVERY turn, a ptt claim included (the claim
    // is the client's; the open mic is the kernel's fact)
    if (a.mode === 'conversation') {
      if (!turn.aec) return voiceRefusal('voice-off', 'a turn under a conversation ceiling needs echo cancellation (aec: vpio | headphones)', { turnId: turn.turnId, mode: turn.mode, ceiling: a.mode, cause: 'aec' });
      // V2a kernel-side busy: the supervisor's own turn state, independent of any client playback row
      const b = this.#o.sessions.busy?.(a.hsid);
      if (b && (b.streaming || (b.endedAt !== null && userStart <= b.endedAt + tail))) {
        return voiceRefusal('voice-playback', "the attached session's model turn is streaming (or inside its echo tail) by the kernel's clock", { turnId: turn.turnId, clock: 'kernel', streaming: b.streaming, echoTailMs: tail });
      }
    }
    // echo on the client's playback times ...
    if (this.#playback.some((w) => turn.t0 >= w.t0 && turn.t0 <= w.t1 + tail)) return voiceRefusal('voice-echo', 'the utterance starts inside our playback or its echo tail', { turnId: turn.turnId, echoTailMs: tail });
    // ... and on the kernel's receipt times (Aegis M1): an agent row arrives at its playback's start or end, so its
    // kernel window is [received - duration, received + duration + tail]; the user turn began at received - its duration.
    if (this.#playback.some((w) => userStart >= w.receivedAt - (w.t1 - w.t0) && userStart <= w.receivedAt + (w.t1 - w.t0) + tail)) {
      return voiceRefusal('voice-echo', 'the utterance starts inside our playback or its echo tail (kernel receipt times)', { turnId: turn.turnId, echoTailMs: tail, clock: 'kernel' });
    }
    return undefined;
  }

  #attached(hsid: unknown): Attachment {
    const a = this.#attachment;
    if (!a || typeof hsid !== 'string' || hsid !== a.hsid) throw voiceRefusal('voice-target', 'voice is not attached to that session (attach is a human gesture)');
    if (this.#o.sessions.ownerOf(a.hsid) !== a.owner) throw voiceRefusal('voice-target', 'the attached session is gone');
    return a;
  }

  #oneVoiceConn(c: VoiceCaller): void {
    const live = this.#o.voiceConnections();
    if (live.length > 1 || (live.length === 1 && live[0] !== c.connId)) throw voiceRefusal('voice-conn', 'more than one voice connection is live', { n: live.length });
  }

  /** `session.send` from the voice principal (the forwarding guards). */
  async send(c: VoiceCaller, params: unknown): Promise<unknown> {
    if (!isObj(params)) throw bad('session.send takes an object');
    const extra = Object.keys(params).filter((k) => !['hsid', 'content', 'source', 'permitId'].includes(k));
    if (extra.length) throw bad(`session.send from voice takes {hsid, content, source?} (unknown: ${extra.slice(0, 4).join(', ')})`);
    if (params.permitId !== undefined) throw bad("a voice send rides the attached session's permit; it never names one (§14.7)");
    if (!Array.isArray(params.content) || params.content.length !== 1 || !isObj(params.content[0]) || typeof params.content[0].text !== 'string' || Object.keys(params.content[0]).length !== 1) {
      throw bad('a voice send is content: [{text}] — the text of the cited voice.turn.user');
    }
    const text = params.content[0].text as string;
    this.#oneVoiceConn(c);
    const a = this.#attached(params.hsid);
    const latest = this.#latestByConn.get(c.connId);
    const turn = latest ? this.#userTurns.get(latest) : undefined;
    if (!turn || turn.principal !== c.principal || turn.attachment !== a.voiceSessionId || this.#forwarded.has(turn.turnId) || turn.textHash !== this.#hash(text)) {
      throw voiceRefusal('voice-stale-utterance', 'the send cites no fresh voice.turn.user of this connection in this attachment (latest turn, never forwarded, same text)');
    }
    if (turn.intercepted) throw voiceRefusal('voice-grammar', 'an intercepted decision or control utterance never reaches a model', { turnId: turn.turnId });
    // Aegis M1: kernel-clock freshness and attachment order (client t0 AND kernel receipt both after the start)
    const now = this.#now();
    if (now - turn.receivedAt > this.maxTurnAgeMs) throw voiceRefusal('voice-stale-utterance', `the turn was received more than ${this.maxTurnAgeMs} ms ago`, { turnId: turn.turnId, maxAgeMs: this.maxTurnAgeMs });
    if (turn.receivedAt < a.startedAt || turn.t0 < a.startedAt) throw voiceRefusal('voice-stale-utterance', 'the turn precedes the attachment', { turnId: turn.turnId });
    // V2a: a turn refused at receipt was stored without its text, so it is never forwarded
    if (turn.refused) throw turn.refused;
    const g = this.#guards(turn, a);
    if (g) throw g;
    // TD-2026-10-20-125 (founder ruling): ambient speech NEVER sends itself. Only a push-to-talk claim (the human held
    // the key) may ride the voice principal's direct send; an ambient turn fills the GUI composer and a human sends it.
    if (turn.mode !== 'ptt') throw voiceRefusal('voice-off', 'ambient speech never sends itself: it fills the composer and a human sends it (TD-2026-10-20-125)', { turnId: turn.turnId, mode: turn.mode, ceiling: a.mode, cause: 'composer' });
    this.#forwarded.add(turn.turnId);
    a.lastForwardAt = now;
    this.#armIdle();
    const sent = await this.#o.sessions.send(a.owner, { hsid: a.hsid, text, source: 'voice', voice: { voiceSessionId: a.voiceSessionId, turnId: turn.turnId, turnSeq: turn.seq } });
    this.#o.onAccepted?.(c.connId, 'send');
    return sent;
  }

  /**
   * TD-2026-10-20-262 dictation: attribute a HUMAN `session.send{source: 'voice'}` (the hint is the human's; the match
   * is the kernel's). Each content part, in order, is hash-matched against the attachment's pending turns: accepted
   * (forwardable), unforwarded, not intercepted, logged by the human's own `p:<ns>/voice` principal, the attachment is
   * this human's on this hsid, received after it started. All parts ⇒ 'voice'; some ⇒ 'voice-edited'; none ⇒ null.
   * Matched turns are claimed into #forwarded at once (release() hands them back if the send fails). NEVER throws:
   * attribution never refuses a human send. No freshness and no latest-turn rule here (the direct path keeps both).
   */
  attributeHumanSend(human: string, hsid: string, parts: readonly string[]): VoiceAttribution | null {
    try {
      const a = this.#attachment;
      const vp = voicePrincipalOf(human);
      if (!a || !vp || a.hsid !== hsid || a.owner !== human || parts.length === 0) return null;
      const pending = [...this.#userTurns.values()].filter(
        (t) => t.principal === vp && t.attachment === a.voiceSessionId && t.receivedAt >= a.startedAt && t.seq > 0 && this.#pendingDictation(t),
      );
      const matched: UserTurn[] = [];
      let from = 0;
      for (const part of parts) {
        const h = this.#hash(part);
        const i = pending.findIndex((t, k) => k >= from && t.textHash === h);
        if (i < 0) continue;
        matched.push(pending[i]!);
        from = i + 1;
      }
      if (matched.length === 0) return null;
      for (const t of matched) this.#forwarded.add(t.turnId);
      a.lastForwardAt = this.#now();
      this.#armIdle();
      return { source: matched.length === parts.length ? 'voice' : 'voice-edited', voiceSessionId: a.voiceSessionId, turnIds: matched.map((t) => t.turnId), turnSeqs: matched.map((t) => t.seq) };
    } catch {
      return null;
    }
  }

  /** The human send an attribution was made for failed: its turns are pending again. */
  releaseAttribution(attr: VoiceAttribution): void {
    for (const id of attr.turnIds) {
      this.#forwarded.delete(id);
      this.#claimed.delete(id);
    }
  }

  /** `session.stop` from the voice principal: interrupt only, attached session only. */
  async stop(c: VoiceCaller, params: unknown): Promise<unknown> {
    if (!isObj(params)) throw bad('session.stop takes an object');
    const extra = Object.keys(params).filter((k) => k !== 'hsid' && k !== 'interrupt');
    if (extra.length) throw bad(`session.stop takes {hsid, interrupt} (unknown: ${extra.slice(0, 4).join(', ')})`);
    if (params.interrupt !== true) throw bad('voice may only interrupt: session.stop{hsid, interrupt: true} (§5 voice column)'); // an allowed cell is never FORBIDDEN{matrix} (G-ABI-02)
    this.#oneVoiceConn(c);
    const a = this.#attached(params.hsid);
    return this.#o.sessions.stop(a.owner, { hsid: a.hsid, interrupt: true });
  }

  /** A connection closed: its "latest turn" pointer and (a human's) widening grant go with it. */
  connectionClosed(connId: string): void {
    this.#latestByConn.delete(connId);
    this.#widened.delete(connId);
    this.#piecesGranted.delete(connId);
    const c = this.#claims.get(connId);
    if (c?.by === 'piece') for (const id of c.turnIds) this.#claimed.delete(id);
    this.#claims.delete(connId);
    this.#liveConn.delete(connId);
    this.#pendingWiden.delete(connId);
  }

  /** Daemon shutdown: the idle timer goes. */
  close(): void {
    this.#idleTimer?.clear();
    this.#idleTimer = null;
  }
}
