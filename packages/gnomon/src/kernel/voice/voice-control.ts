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
 *     the current attachment — is from an enrolled speaker, was not intercepted, was never forwarded before, the
 *     attachment is push-to-talk, the send's text equals the logged text, and its t0 lies outside every logged
 *     `voice.turn.agent` playback window `[t0, t1 + echoTailMs]` (echoTailMs default 750, §14.7 config).
 *   - `session.stop` to the attached session with `interrupt: true` only.
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
 *   (conversation-mode forwarding is off in V1) · a stop without interrupt ⇒ BAD_REQUEST{bad-params}.
 */
import { refuse, RefusedError, ulid, type RefusalCode } from '@a-company/gnomon-contracts';

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
export const VOICE_MODES_V1 = ['ptt', 'conversation'] as const;
export type VoiceMode = (typeof VOICE_MODES_V1)[number];

const SPEAKER_ID = /^spk:(?:[0-9a-z]{8}\/[a-z0-9][a-z0-9._-]{0,63}|unknown-[1-9][0-9]{0,5})$/;
const TURN_ID = /^[0-9A-Za-z][0-9A-Za-z:._-]{0,63}$/;
const SENS = ['normal', 'sensitive', 'secret'] as const;

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
}

/**
 * Aegis M4: the link a forwarded voice turn leaves on the KERNEL-signed rows. `session.inject` keeps origin 'client'
 * (INJECT_ORIGINS is a published closed set; a new 'voice' origin would move clientApiId) and gains `source: 'voice'`;
 * `turn.sent` carries `source: 'voice'` (§4.10) plus voiceSessionId, voiceTurnId and voiceTurnSeq (the cited voice.turn.user
 * row). Both payloads are opaque to event:v1 (no KIND_PAYLOADS / RESERVED_PAYLOAD_FIELDS row), so nothing published moves.
 */
export function voiceTag(p: { source?: 'voice'; voice?: VoiceTurnLink }): Record<string, unknown> {
  if (p.source !== 'voice') return {};
  return { source: 'voice', ...(p.voice ? { voiceSessionId: p.voice.voiceSessionId, voiceTurnId: p.voice.turnId, voiceTurnSeq: p.voice.turnSeq } : {}) };
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
  connId: string;
  session?: string;
  sensitivity?: string;
}

export interface VoiceControlOptions {
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
  text: string;
  attachment: string;
}
interface Attachment {
  voiceSessionId: string;
  hsid: string;
  owner: string;
  mode: VoiceMode;
  turns: number;
  /** kernel clock when the start row was written */
  startedAt: number;
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

export class VoiceControl {
  readonly #o: VoiceControlOptions;
  #attachment: Attachment | null = null;
  readonly #userTurns = new Map<string, UserTurn>();
  readonly #latestByConn = new Map<string, string>();
  readonly #lastTurnId = new Map<string, string>();
  /** client playback times and the kernel receipt time of each voice.turn.agent row */
  readonly #playback: Array<{ t0: number; t1: number; receivedAt: number }> = [];
  readonly #forwarded = new Set<string>();

  constructor(o: VoiceControlOptions) {
    this.#o = o;
  }

  #now(): number {
    return (this.#o.now ?? Date.now)();
  }

  get maxTurnAgeMs(): number {
    return this.#o.maxTurnAgeMs ?? VOICE_TURN_MAX_AGE_MS;
  }

  /** Aegis L4: keep only a recent window of turns and playback (a turn older than maxTurnAgeMs is refused anyway). */
  #prune(): void {
    const horizon = this.#now() - 2 * this.maxTurnAgeMs;
    for (const [id, t] of this.#userTurns) {
      if (t.receivedAt >= horizon && this.#userTurns.size <= VOICE_WINDOW_CAP) break; // insertion order = receipt order
      this.#userTurns.delete(id);
      this.#forwarded.delete(id);
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

  status(): Record<string, unknown> {
    const a = this.#attachment;
    return { attached: a ? { voiceSessionId: a.voiceSessionId, hsid: a.hsid, mode: a.mode, turns: a.turns } : null, echoTailMs: this.echoTailMs };
  }

  /** The human gesture: `voice.session.start{hsid, mode?}` / `voice.session.end{}` from a first-party human connection. */
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
    const extra = Object.keys(p).filter((k) => k !== 'hsid' && k !== 'mode');
    if (extra.length) throw bad(`voice.session.start takes {hsid, mode?} from the human (unknown: ${extra.slice(0, 4).join(', ')})`);
    if (typeof p.hsid !== 'string') throw bad('voice.session.start needs hsid');
    const mode = (p.mode ?? 'ptt') as VoiceMode;
    if (!VOICE_MODES_V1.includes(mode)) throw bad('mode is ptt or conversation');
    const owner = this.#o.sessions.ownerOf(p.hsid);
    if (owner === undefined || owner !== asker.principal) throw new RefusedError(refuse({ code: 'NOT_FOUND', data: { reason: 'not-found' } }), '#gnomon-voice: no such live session for this principal');
    const prev = this.#attachment;
    // Aegis L4: a human replaces only their own attachment (a gone session's attachment is anyone's to replace)
    if (prev && prev.owner !== asker.principal && this.#o.sessions.ownerOf(prev.hsid) === prev.owner) throw voiceRefusal('voice-target', "voice is attached to another human's session");
    if (prev) await this.#end(prev, asker.connId, asker.principal);
    const a: Attachment = { voiceSessionId: `vs:${ulid()}`, hsid: p.hsid, owner, mode, turns: 0, startedAt: this.#now() };
    const r = await this.#o.append({
      kind: 'voice.session.start',
      principal: asker.principal,
      payload: { voiceSessionId: a.voiceSessionId, hsid: a.hsid, mode, engines: null, device: null, audioRetention: 'none' },
      connId: asker.connId,
      session: a.hsid,
    });
    this.#attachment = a; // only after the row is written (log before effect)
    this.#o.onAttachmentChange?.();
    return { ...r, voiceSessionId: a.voiceSessionId, hsid: a.hsid, mode };
  }

  async #end(a: Attachment, connId: string, principal: string): Promise<unknown> {
    const r = await this.#o.append({ kind: 'voice.session.end', principal, payload: { voiceSessionId: a.voiceSessionId, turns: a.turns, compactedTo: null }, connId, session: a.hsid });
    if (this.#attachment === a) {
      this.#attachment = null;
      this.#o.onAttachmentChange?.();
    }
    return { ...r, voiceSessionId: a.voiceSessionId };
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
      if (!a || p.voiceSessionId !== a.voiceSessionId) throw voiceRefusal('voice-target', 'no such voice attachment');
      return this.#end(a, c.connId, c.principal);
    }
    const commit: Array<(seq: number) => void> = [];
    // Aegis M1: the kernel stamps its own receipt time on every turn row; a client-sent receivedAt is refused
    if (Object.hasOwn(p, 'receivedAt')) throw bad('receivedAt is stamped by the kernel');
    const receivedAt = this.#now();
    const stamped = kind === 'voice.turn.user' || kind === 'voice.turn.agent' ? { ...p, receivedAt } : { ...p };
    switch (kind) {
      case 'voice.turn.user': {
        const t = this.#checkTurnCommon(p, kind);
        if (typeof p.speakerId !== 'string' || !SPEAKER_ID.test(p.speakerId)) throw bad('speakerId is spk:<ns>/<name> or spk:unknown-N');
        if (typeof p.speakerEnrolled !== 'boolean' || typeof p.forwarded !== 'boolean') throw bad('speakerEnrolled and forwarded are booleans');
        const unknown = p.speakerId.startsWith('spk:unknown-');
        if (!unknown && !this.#o.enrolled().has(p.speakerId)) throw bad('speakerId is not a known (enrolled) speaker; label it spk:unknown-N');
        if (unknown && p.speakerEnrolled) throw bad('an unknown-N speaker is not enrolled');
        if (p.intercepted !== undefined && p.intercepted !== 'decision' && p.intercepted !== 'control') throw bad('intercepted is decision | control');
        if (p.intercepted !== undefined && p.forwarded !== false) throw bad('an intercepted turn is never forwarded');
        if (typeof p.text !== 'string') throw bad('text is a string');
        // Aegis M2: a per-turn mode claim, cross-checked at send against the human's attachment mode
        if (!(VOICE_MODES_V1 as readonly unknown[]).includes(p.mode)) throw bad("voice.turn.user needs mode: ptt | conversation (the client's claim for this turn)");
        const turn: UserTurn = { turnId: t.turnId, connId: c.connId, principal: c.principal, speakerId: p.speakerId, speakerEnrolled: p.speakerEnrolled, intercepted: p.intercepted as string | undefined, mode: p.mode as string, t0: t.t0, t1: t.t1, receivedAt, seq: 0, text: p.text, attachment: a?.voiceSessionId ?? '' };
        commit.push((seq) => {
          turn.seq = seq;
          this.#userTurns.set(t.turnId, turn);
          this.#latestByConn.set(c.connId, t.turnId);
          if (a) a.turns++;
        });
        break;
      }
      case 'voice.turn.agent': {
        const t = this.#checkTurnCommon(p, kind);
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
    return r;
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
    if (params.permitId !== undefined) throw bad('a voice send rides the attached session\'s permit; it never names one (§14.7)');
    if (!Array.isArray(params.content) || params.content.length !== 1 || !isObj(params.content[0]) || typeof params.content[0].text !== 'string' || Object.keys(params.content[0]).length !== 1) {
      throw bad('a voice send is content: [{text}] — the text of the cited voice.turn.user');
    }
    const text = params.content[0].text as string;
    this.#oneVoiceConn(c);
    const a = this.#attached(params.hsid);
    const latest = this.#latestByConn.get(c.connId);
    const turn = latest ? this.#userTurns.get(latest) : undefined;
    if (!turn || turn.principal !== c.principal || turn.attachment !== a.voiceSessionId || this.#forwarded.has(turn.turnId) || turn.text !== text) {
      throw voiceRefusal('voice-stale-utterance', 'the send cites no fresh voice.turn.user of this connection in this attachment (latest turn, never forwarded, same text)');
    }
    if (turn.intercepted) throw voiceRefusal('voice-grammar', 'an intercepted decision or control utterance never reaches a model', { turnId: turn.turnId });
    // Aegis M1: kernel-clock freshness and attachment order (client t0 AND kernel receipt both after the start)
    const now = this.#now();
    if (now - turn.receivedAt > this.maxTurnAgeMs) throw voiceRefusal('voice-stale-utterance', `the turn was received more than ${this.maxTurnAgeMs} ms ago`, { turnId: turn.turnId, maxAgeMs: this.maxTurnAgeMs });
    if (turn.receivedAt < a.startedAt || turn.t0 < a.startedAt) throw voiceRefusal('voice-stale-utterance', 'the turn precedes the attachment', { turnId: turn.turnId });
    if (!turn.speakerEnrolled || !this.#o.enrolled().has(turn.speakerId)) throw voiceRefusal('voice-speaker', 'only enrolled speakers are forwarded (G-VOX-06)', { turnId: turn.turnId });
    // Aegis M2 + L5: the turn's mode claim must equal the human's attachment mode; conversation mode is not forwarded in V1
    if (turn.mode !== a.mode) throw voiceRefusal('voice-off', "the turn's mode does not match the attachment", { turnId: turn.turnId, mode: turn.mode, attachmentMode: a.mode });
    if (a.mode !== 'ptt') throw voiceRefusal('voice-off', 'conversation-mode turns are not forwarded in this slice (push-to-talk only)', { turnId: turn.turnId, mode: 'conversation' });
    const tail = this.echoTailMs;
    // echo on the client's playback times ...
    if (this.#playback.some((w) => turn.t0 >= w.t0 && turn.t0 <= w.t1 + tail)) throw voiceRefusal('voice-echo', 'the utterance starts inside our playback or its echo tail', { turnId: turn.turnId, echoTailMs: tail });
    // ... and on the kernel's receipt times (Aegis M1): an agent row arrives at its playback's start or end, so its
    // kernel window is [received - duration, received + duration + tail]; the user turn began at received - its duration.
    const userStart = turn.receivedAt - (turn.t1 - turn.t0);
    if (this.#playback.some((w) => userStart >= w.receivedAt - (w.t1 - w.t0) && userStart <= w.receivedAt + (w.t1 - w.t0) + tail)) {
      throw voiceRefusal('voice-echo', 'the utterance starts inside our playback or its echo tail (kernel receipt times)', { turnId: turn.turnId, echoTailMs: tail, clock: 'kernel' });
    }
    this.#forwarded.add(turn.turnId);
    return this.#o.sessions.send(a.owner, { hsid: a.hsid, text, source: 'voice', voice: { voiceSessionId: a.voiceSessionId, turnId: turn.turnId, turnSeq: turn.seq } });
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

  /** A voice connection closed: its "latest turn" pointer goes with it. */
  connectionClosed(connId: string): void {
    this.#latestByConn.delete(connId);
  }
}
