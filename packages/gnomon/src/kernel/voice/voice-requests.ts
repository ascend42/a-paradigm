/**
 * @symbol #gnomon-voice
 *
 * The dispatcher-only voice requests of slice V2e (T-2026-10-19-026). None is a §9.1 kind and none is ever written
 * as a row under its own name, so CLIENT_API_ID does not move (the same path as request.voice.client):
 *
 *   request.voice.enrol{name, consent}  human only → a fresh-presence `strictness` card, detail.op 'voice.enrol';
 *                                       its allow effect writes the root-signed enrolment row (enrolSpeaker, the
 *                                       row `gnomon voice enrol` writes). Reply {pending, cardId}.
 *   request.voice.forget{name}          human only, NO card: a forget narrows (spec D62: narrowing needs no
 *                                       presence). Writes the root-signed forget row (forgetSpeaker). Reply
 *                                       {forgotten: true, speakerId}.
 *   request.voice.report{enrolment?, notice?}
 *                                       voice principal only: the client's enrolment recording progress and its
 *                                       notices, held in memory and relayed in status.voice.enrolment /
 *                                       status.voice.notice (bounded, kernel-stamped `at`). Never logged.
 *   request.voice.report{dictation}     TD-2026-10-20-262: the client's dictation edges {activity: speaking |
 *                                       transcribing | idle, holdToggles (monotone per voice connection)}, relayed
 *                                       as status.voice.dictation{activity, holdToggles, at}. In memory only.
 *   request.voice.report{playback}      T-2026-10-19-026: the client's spoken-reply edges {playing: boolean}, relayed
 *                                       as status.voice.playback{playing, at} (the GUI's ⏹ Stop speaking). In memory.
 *   request.voice.report{capture}       T-2026-10-20-005 A1 (TD-2026-10-20-086): the client's per-segment capture state
 *                                       {state: idle | hearing | transcribing | captured | dropped, segId, reason?
 *                                       (dropped only, closed CAPTURE_DROP_REASONS), level? (hearing only, 0..1)},
 *                                       relayed as status.voice.capture{…, at} with the SHORT VOICE_CAPTURE_TTL_MS so a
 *                                       crashed client never leaves "hearing" lit. In memory only.
 *                                       B1 (T-2026-10-20-005, V1/V2/V4): capture.text{committed, tail} = the live
 *                                       PARTIAL words of the open segment, on hearing / transcribing only. Sanitised
 *                                       (control + bidi characters to spaces, whitespace collapsed), capped at
 *                                       CAPTURE_TEXT_MAX together, kept in memory with the same capture TTL, NEVER a
 *                                       row, never voice.turn.user, never sent to a session. voiceStatusFor projects
 *                                       it to a HUMAN-class connection on the gui credential only (V2).
 *   request.voice.client{op:'stop-speaking'} (dispatch.ts, human only) bumps status.voice.stopSpeakingSeq; the
 *                                       client re-reads status (300 ms while speaking) and stops playback on a change.
 */
import type { CardV1 } from '@a-company/gnomon-contracts';
import type { RootAuthority } from '../identity/root-authority.js';
import { enrolSpeaker, forgetSpeaker, speakerIdFor } from './enrolment.js';

export const VOICE_FORGET_REQUEST = 'request.voice.forget' as const;
export const VOICE_REPORT_REQUEST = 'request.voice.report' as const;

/** the phases the CLIENT reports; 'requested' is the kernel's own (an allowed GUI enrolment card) */
/** TD-2026-10-20-262: the client's dictation activity edges */
export const DICTATION_ACTIVITY = ['speaking', 'transcribing', 'idle'] as const;
export type DictationActivity = (typeof DICTATION_ACTIVITY)[number];
export interface DictationReport {
  activity: DictationActivity;
  /** the hold-toggle hotkey presses this client made (monotone; the GUI holds or releases its send countdown on a change) */
  holdToggles: number;
  at: string;
}

/** T-2026-10-19-026: the client's spoken-reply state (status.voice.playback) */
export interface PlaybackReport {
  playing: boolean;
  at: string;
}

/** T-2026-10-20-005 A1: the client's per-segment capture states and drop reasons (closed; mirrors gnomon-voice). */
export const CAPTURE_STATES = ['idle', 'hearing', 'transcribing', 'captured', 'dropped'] as const;
export type CaptureState = (typeof CAPTURE_STATES)[number];
export const CAPTURE_DROP_REASONS = ['too-short', 'echo', 'not-attached', 'no-words', 'not-enrolled', 'barge-in', 'refused'] as const;
export type CaptureDropReason = (typeof CAPTURE_DROP_REASONS)[number];
export interface CaptureReport {
  state: CaptureState;
  /** the client's opaque segment id */
  segId: string;
  /** dropped only */
  reason?: CaptureDropReason;
  /** hearing only: the measured mic level, 0..1 (A2) */
  level?: number;
  /** B1: hearing / transcribing only, the live partial words (in memory only; projected to the gui credential only) */
  text?: CaptureText;
  /** Aegis M1: on a terminal state, the state is the voice app's claim ('client'); the kernel's cross-check is `kernel` */
  claim?: 'client';
  /**
   * Aegis M1: what the kernel saw on this voice connection in the window. 'accepted': it accepted a turn (or a direct
   * send) and the state shown is captured, whatever the client said; 'unconfirmed': the client said captured and the
   * kernel accepted nothing.
   */
  kernel?: 'accepted' | 'unconfirmed';
  /** Aegis M1: the client's own drop reason when the kernel overrode it to captured */
  clientReason?: CaptureDropReason;
  at: string;
}
/** Aegis M1: a kernel acceptance is matched to a terminal capture report within this window */
export const VOICE_CAPTURE_ACCEPT_WINDOW_MS = 5_000;
/** status.voice.capture goes stale this fast: a crashed client never leaves "hearing" lit (the client re-reports ≤ 1 s) */
export const VOICE_CAPTURE_TTL_MS = 5_000;
const SEG_ID = /^[a-z0-9][a-z0-9-]{0,31}$/;
const CAPTURE_KEYS = ['state', 'segId', 'reason', 'level', 'text'];
/** B1: the live partial words of one segment (committed + tail) are capped at this many characters together */
export const CAPTURE_TEXT_MAX = 600;
/** B1: the live partial words; `committed` never shrinks within a segment (client-side LocalAgreement-2), `tail` may */
export interface CaptureText {
  committed: string;
  tail: string;
}
/** the fields status.voice.capture may carry for every viewer (the kernel's own cross-check fields included; never `text`) */
const CAPTURE_STATUS_KEYS = ['state', 'segId', 'reason', 'level', 'claim', 'kernel', 'clientReason', 'at'];
/** B1 (V2): `text` is added to the allow-list for a human-class connection on the gui credential only */
const CAPTURE_GUI_KEYS = [...CAPTURE_STATUS_KEYS, 'text'];

/**
 * The status.voice view for one connection. V2 (TD-2026-10-20-086): the partial words (`capture.text`, B1) are kept
 * for a HUMAN-class connection on the `gui` credential only (Aegis L1); every other class or credential (device,
 * voice, read token) gets the capture without them. Every other unknown field is dropped too (an allow-list).
 */
export function voiceStatusFor(voice: Record<string, unknown>, credential: string | undefined, cls?: string): Record<string, unknown> {
  const c = voice.capture as Record<string, unknown> | null | undefined;
  if (!c || typeof c !== 'object') return voice;
  const allowed = cls === 'human' && credential === 'gui' ? CAPTURE_GUI_KEYS : CAPTURE_STATUS_KEYS;
  return { ...voice, capture: Object.fromEntries(Object.entries(c).filter(([k]) => allowed.includes(k))) };
}

export const ENROL_PHASES = ['ready', 'recording', 'recorded', 'done', 'failed', 'cancelled'] as const;
export type EnrolPhase = (typeof ENROL_PHASES)[number] | 'requested';
const NOTICE_CODE = /^[a-z0-9][a-z0-9.-]{0,63}$/;
const NAME = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const NOTICE_MAX = 280;
const ERROR_MAX = 200;
/** a relayed report goes stale (dropped from status) after this TTL */
export const VOICE_REPORT_TTL_MS = 10 * 60_000;
/** an enrolment card waits this long for the human (TTL) */
export const VOICE_ENROL_CARD_TTL_MS = 5 * 60_000;

export interface EnrolmentReport {
  name: string;
  phase: EnrolPhase;
  phrase?: number;
  of?: number;
  error?: string;
  at: string;
}

function bad(msg: string): TypeError {
  return new TypeError(msg);
}
const smallInt = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 && v <= 100;
const plain = (s: string, max: number): string => s.replace(/[\u0000-\u001f\u007f‪-‮⁦-⁩]/g, ' ').slice(0, max);
/** B1: partial words: control, bidi, zero-width and line/paragraph separators become spaces; whitespace collapses */
const words = (s: string): string =>
  s
    .replace(/[\u0000-\u001f\u007f-\u009f\u00ad\u061c\u180e\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff\ufff9-\ufffb]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
/** B1: capture.text → {committed, tail}, sanitised and capped at CAPTURE_TEXT_MAX together (the committed words first). */
function captureText(v: unknown): CaptureText {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw bad('capture.text is {committed, tail}');
  const t = v as Record<string, unknown>;
  if (Object.keys(t).some((k) => k !== 'committed' && k !== 'tail') || typeof t.committed !== 'string' || typeof t.tail !== 'string') throw bad('capture.text is {committed, tail} (strings)');
  // a hostile client cannot make the kernel scan megabytes: anything far past the cap is refused, not trimmed
  if (t.committed.length + t.tail.length > CAPTURE_TEXT_MAX * 4) throw bad(`capture.text is at most ${CAPTURE_TEXT_MAX} characters`);
  const committed = [...words(t.committed)].slice(0, CAPTURE_TEXT_MAX).join('');
  const tail = [...words(t.tail)].slice(0, Math.max(0, CAPTURE_TEXT_MAX - [...committed].length - (committed ? 1 : 0))).join('');
  return { committed, tail };
}

/** The client's relayed progress and notices (in memory only). */
export class VoiceReports {
  #enrolment: EnrolmentReport | null = null;
  #notice: { text: string; code?: string; at: string } | null = null;
  #dictation: DictationReport | null = null;
  #playback: PlaybackReport | null = null;
  #capture: CaptureReport | null = null;
  /** Aegis L3: the voice connection that reported the capture slot (cleared when it closes) */
  #captureConn: string | undefined;
  /** Aegis M1: the kernel's acceptances on each voice connection, not yet matched to a terminal capture report */
  #accepted: Array<{ connId: string; kind: 'turn' | 'send'; at: number }> = [];
  /** the human's ⏹ Stop speaking presses (request.voice.client{op:'stop-speaking'}); the client acts on a change */
  #stopSpeakingSeq = 0;
  /** the voice connection whose holdToggles counter is the baseline (a new client starts its own count) */
  #dictationConn: string | undefined;
  readonly #now: () => number;

  constructor(now: () => number = Date.now) {
    this.#now = now;
  }

  /** request.voice.report payload → state. Throws TypeError on a bad shape. `connId` is the reporting voice connection. */
  report(p: unknown, connId?: string): { ok: true } {
    const shape = `${VOICE_REPORT_REQUEST} payload is {enrolment?, notice?, dictation?, playback?, capture?}`;
    if (!p || typeof p !== 'object' || Array.isArray(p)) throw bad(shape);
    const o = p as Record<string, unknown>;
    const keys = ['enrolment', 'notice', 'dictation', 'playback', 'capture'];
    if (Object.keys(o).some((k) => !keys.includes(k)) || keys.every((k) => o[k] === undefined)) throw bad(shape);
    const at = new Date(this.#now()).toISOString();
    let enrolment: EnrolmentReport | undefined;
    if (o.enrolment !== undefined) {
      const e = o.enrolment as Record<string, unknown> | null;
      if (!e || typeof e !== 'object' || Object.keys(e).some((k) => !['name', 'phase', 'phrase', 'of', 'error'].includes(k))) throw bad('enrolment is {name, phase, phrase?, of?, error?}');
      if (typeof e.name !== 'string' || !NAME.test(e.name)) throw bad('enrolment.name is a speaker name');
      if (!(ENROL_PHASES as readonly unknown[]).includes(e.phase)) throw bad(`enrolment.phase is ${ENROL_PHASES.join(' | ')}`);
      if ((e.phrase !== undefined && !smallInt(e.phrase)) || (e.of !== undefined && !smallInt(e.of))) throw bad('enrolment.phrase / of are integers 0..100');
      if (e.error !== undefined && typeof e.error !== 'string') throw bad('enrolment.error is a string');
      enrolment = { name: e.name, phase: e.phase as EnrolPhase, ...(e.phrase !== undefined ? { phrase: e.phrase as number } : {}), ...(e.of !== undefined ? { of: e.of as number } : {}), ...(typeof e.error === 'string' ? { error: plain(e.error, ERROR_MAX) } : {}), at };
    }
    let notice: { text: string; code?: string; at: string } | undefined;
    if (o.notice !== undefined) {
      const n = o.notice as Record<string, unknown> | null;
      if (!n || typeof n !== 'object' || Object.keys(n).some((k) => k !== 'text' && k !== 'code') || typeof n.text !== 'string' || !n.text.trim()) throw bad('notice is {text, code?}');
      if (n.code !== undefined && (typeof n.code !== 'string' || !NOTICE_CODE.test(n.code))) throw bad('notice.code is ≤ 64 of [a-z0-9.-]');
      notice = { text: plain(n.text, NOTICE_MAX), ...(typeof n.code === 'string' ? { code: n.code } : {}), at };
    }
    let dictation: DictationReport | undefined;
    if (o.dictation !== undefined) {
      const d = o.dictation as Record<string, unknown> | null;
      if (!d || typeof d !== 'object' || Array.isArray(d) || Object.keys(d).some((k) => k !== 'activity' && k !== 'holdToggles')) throw bad('dictation is {activity, holdToggles}');
      if (!(DICTATION_ACTIVITY as readonly unknown[]).includes(d.activity)) throw bad(`dictation.activity is ${DICTATION_ACTIVITY.join(' | ')}`);
      if (typeof d.holdToggles !== 'number' || !Number.isSafeInteger(d.holdToggles) || d.holdToggles < 0) throw bad('dictation.holdToggles is a non-negative integer');
      const sameConn = this.#dictationConn === connId;
      if (this.#dictation && sameConn && d.holdToggles < this.#dictation.holdToggles) throw bad(`dictation.holdToggles is monotone (was ${this.#dictation.holdToggles})`);
      dictation = { activity: d.activity as DictationActivity, holdToggles: d.holdToggles, at };
    }
    let playback: PlaybackReport | undefined;
    if (o.playback !== undefined) {
      const b = o.playback as Record<string, unknown> | null;
      if (!b || typeof b !== 'object' || Array.isArray(b) || Object.keys(b).some((k) => k !== 'playing') || typeof b.playing !== 'boolean') throw bad('playback is {playing: boolean}');
      playback = { playing: b.playing, at };
    }
    let capture: CaptureReport | undefined;
    if (o.capture !== undefined) {
      const c = o.capture as Record<string, unknown> | null;
      if (!c || typeof c !== 'object' || Array.isArray(c) || Object.keys(c).some((k) => !CAPTURE_KEYS.includes(k))) throw bad('capture is {state, segId, reason?, level?, text?}');
      if (!(CAPTURE_STATES as readonly unknown[]).includes(c.state)) throw bad(`capture.state is ${CAPTURE_STATES.join(' | ')}`);
      if (typeof c.segId !== 'string' || !SEG_ID.test(c.segId)) throw bad('capture.segId is ≤ 32 of [a-z0-9-]');
      if (c.state === 'dropped' ? !(CAPTURE_DROP_REASONS as readonly unknown[]).includes(c.reason) : c.reason !== undefined) throw bad(`capture.reason is ${CAPTURE_DROP_REASONS.join(' | ')}, on dropped only`);
      if (c.level !== undefined && (c.state !== 'hearing' || typeof c.level !== 'number' || !Number.isFinite(c.level) || c.level < 0 || c.level > 1)) throw bad('capture.level is 0..1, on hearing only');
      if (c.text !== undefined && c.state !== 'hearing' && c.state !== 'transcribing') throw bad('capture.text is on hearing / transcribing only');
      const text = c.text !== undefined ? captureText(c.text) : undefined;
      capture = { state: c.state as CaptureState, segId: c.segId, ...(c.reason !== undefined ? { reason: c.reason as CaptureDropReason } : {}), ...(c.level !== undefined ? { level: Math.round((c.level as number) * 100) / 100 } : {}), ...(text && (text.committed || text.tail) ? { text } : {}), at };
      capture = this.#crossCheck(capture, connId);
    }
    if (capture) {
      this.#capture = capture;
      this.#captureConn = connId;
    }
    if (playback) this.#playback = playback;
    if (enrolment) this.#enrolment = enrolment;
    if (notice) this.#notice = notice;
    if (dictation) {
      this.#dictation = dictation;
      this.#dictationConn = connId;
    }
    return { ok: true };
  }

  /**
   * Aegis M1: the kernel accepted a voice.turn.user (not refused, not intercepted) or a direct session.send on this
   * voice connection. A later terminal capture report on the same connection is checked against it.
   */
  accepted(connId: string, kind: 'turn' | 'send'): void {
    this.#accepted.push({ connId, kind, at: this.#now() });
    if (this.#accepted.length > 16) this.#accepted.splice(0, this.#accepted.length - 16);
  }

  /** Aegis L3: a voice connection closed: its capture slot and its unmatched acceptances go with it. */
  connectionClosed(connId: string): void {
    if (this.#captureConn === connId) {
      this.#capture = null;
      this.#captureConn = undefined;
    }
    this.#accepted = this.#accepted.filter((a) => a.connId !== connId);
  }

  /** Take (consume) this connection's freshest unmatched acceptance of `kinds` inside the window. */
  #take(connId: string | undefined, kinds: ReadonlyArray<'turn' | 'send'>): boolean {
    const now = this.#now();
    this.#accepted = this.#accepted.filter((a) => now - a.at <= VOICE_CAPTURE_ACCEPT_WINDOW_MS);
    for (let i = this.#accepted.length - 1; i >= 0; i--) {
      const a = this.#accepted[i]!;
      if (a.connId === connId && kinds.includes(a.kind)) {
        this.#accepted.splice(i, 1);
        return true;
      }
    }
    return false;
  }

  /**
   * Aegis M1: a compromised client cannot mask a delivered turn. A terminal state is marked claim:'client'. A drop the
   * kernel contradicts (it accepted the turn, or for 'refused' it accepted the send) is shown as captured with
   * kernel:'accepted' and the client's reason kept as clientReason; a captured with no acceptance is kernel:'unconfirmed'.
   */
  #crossCheck(c: CaptureReport, connId: string | undefined): CaptureReport {
    if (c.state === 'captured') return { ...c, claim: 'client', kernel: this.#take(connId, ['turn', 'send']) ? 'accepted' : 'unconfirmed' };
    if (c.state === 'dropped') {
      // 'refused' after a logged turn is a real refusal of the send: the turn's acceptance is matched (consumed) to it
      const contradicted = c.reason === 'refused' ? this.#take(connId, ['send']) || (this.#take(connId, ['turn']) && false) : this.#take(connId, ['turn', 'send']);
      if (contradicted) return { state: 'captured', segId: c.segId, claim: 'client', kernel: 'accepted', clientReason: c.reason!, at: c.at };
      return { ...c, claim: 'client' };
    }
    if (c.state === 'idle') return { ...c, claim: 'client' };
    return c;
  }

  /** request.voice.client{op:'stop-speaking'} (human only): one more stop for the client to act on. */
  stopSpeaking(): { stopSpeakingSeq: number } {
    this.#stopSpeakingSeq++;
    return { stopSpeakingSeq: this.#stopSpeakingSeq };
  }

  /** The kernel's own: an allowed GUI enrolment asks the client to record (status.voice.enrolment{name, phase:'requested'}). */
  requested(name: string): void {
    this.#enrolment = { name, phase: 'requested', at: new Date(this.#now()).toISOString() };
  }

  /** status.voice.enrolment / notice / dictation (null when none, or stale past the TTL). */
  status(): { enrolment: EnrolmentReport | null; notice: { text: string; code?: string; at: string } | null; dictation: DictationReport | null; playback: PlaybackReport | null; capture: CaptureReport | null; stopSpeakingSeq: number } {
    const fresh = <T extends { at: string }>(x: T | null, ttl = VOICE_REPORT_TTL_MS): T | null => (x && this.#now() - Date.parse(x.at) <= ttl ? x : null);
    return { enrolment: fresh(this.#enrolment), notice: fresh(this.#notice), dictation: fresh(this.#dictation), playback: fresh(this.#playback), capture: fresh(this.#capture, VOICE_CAPTURE_TTL_MS), stopSpeakingSeq: this.#stopSpeakingSeq };
  }
}

export interface VoiceEnrolCardsOptions {
  home: string;
  root: RootAuthority;
  broker: { raise(input: Record<string, unknown>): Promise<CardV1> };
  onChange?: () => void;
  /** an allowed enrolment: ask the client to record the speaker's phrases */
  onEnrolled?: (name: string) => void;
}

/** GUI enrolment: one fresh-presence card per request; the allow effect writes the root-signed row. */
export class VoiceEnrolCards {
  readonly #o: VoiceEnrolCardsOptions;
  constructor(o: VoiceEnrolCardsOptions) {
    this.#o = o;
  }

  async enrol(asker: { connId: string; principal: string }, p: { name: string; consent: string }): Promise<{ pending: true; cardId: string }> {
    if (this.#o.root.ns === null) throw bad('this home has no root identity yet (gnomon setup)');
    const speakerId = speakerIdFor(this.#o.root.ns, p.name); // throws TypeError on a bad name
    if (p.consent.trim().length === 0 || p.consent.length > 1024) throw bad('enrolment needs recorded consent (1..1024 chars)');
    const card = await this.#o.broker.raise({
      kind: 'strictness',
      requestedBy: asker.principal,
      attended: true,
      detail: { op: 'voice.enrol', name: p.name, speakerId, consent: p.consent, connId: asker.connId },
      lines: [`Voice: enrol the speaker "${p.name}"`, `Consent recorded: ${plain(p.consent, 200)}`, 'Only enrolled speakers are sent to a session; the voiceprint never leaves this Mac', 'Allow needs Touch ID; deny or no answer enrols nobody'],
      decisions: ['allow', 'deny'],
      timeoutMs: VOICE_ENROL_CARD_TTL_MS,
      effect: async (decision: string) => {
        if (decision !== 'allow') return;
        await enrolSpeaker(this.#o.home, this.#o.root, { name: p.name, consent: p.consent });
        this.#o.onEnrolled?.(p.name);
        this.#o.onChange?.();
      },
    });
    return { pending: true, cardId: card.cardId };
  }

  async forget(p: { name: string }): Promise<{ forgotten: true; speakerId: string }> {
    const row = await forgetSpeaker(this.#o.home, this.#o.root, { name: p.name });
    this.#o.onChange?.();
    return { forgotten: true, speakerId: row.speakerId };
  }
}
