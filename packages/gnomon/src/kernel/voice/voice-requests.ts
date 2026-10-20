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

/** The client's relayed progress and notices (in memory only). */
export class VoiceReports {
  #enrolment: EnrolmentReport | null = null;
  #notice: { text: string; code?: string; at: string } | null = null;
  #dictation: DictationReport | null = null;
  /** the voice connection whose holdToggles counter is the baseline (a new client starts its own count) */
  #dictationConn: string | undefined;
  readonly #now: () => number;

  constructor(now: () => number = Date.now) {
    this.#now = now;
  }

  /** request.voice.report payload → state. Throws TypeError on a bad shape. `connId` is the reporting voice connection. */
  report(p: unknown, connId?: string): { ok: true } {
    const shape = `${VOICE_REPORT_REQUEST} payload is {enrolment?, notice?, dictation?}`;
    if (!p || typeof p !== 'object' || Array.isArray(p)) throw bad(shape);
    const o = p as Record<string, unknown>;
    if (Object.keys(o).some((k) => k !== 'enrolment' && k !== 'notice' && k !== 'dictation') || (o.enrolment === undefined && o.notice === undefined && o.dictation === undefined)) throw bad(shape);
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
    if (enrolment) this.#enrolment = enrolment;
    if (notice) this.#notice = notice;
    if (dictation) {
      this.#dictation = dictation;
      this.#dictationConn = connId;
    }
    return { ok: true };
  }

  /** The kernel's own: an allowed GUI enrolment asks the client to record (status.voice.enrolment{name, phase:'requested'}). */
  requested(name: string): void {
    this.#enrolment = { name, phase: 'requested', at: new Date(this.#now()).toISOString() };
  }

  /** status.voice.enrolment / notice / dictation (null when none, or stale past the TTL). */
  status(): { enrolment: EnrolmentReport | null; notice: { text: string; code?: string; at: string } | null; dictation: DictationReport | null } {
    const fresh = <T extends { at: string }>(x: T | null): T | null => (x && this.#now() - Date.parse(x.at) <= VOICE_REPORT_TTL_MS ? x : null);
    return { enrolment: fresh(this.#enrolment), notice: fresh(this.#notice), dictation: fresh(this.#dictation) };
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
