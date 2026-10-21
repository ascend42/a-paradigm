/**
 * @symbol #gui-dictation
 *
 * #gui voice dictation (TD-2026-10-20-262, T-2026-10-19-026). PURE reducer + the one adapter over the kernel's
 * dictation contract. The app is browser glue: it feeds events in, paints the state out, and performs the send the
 * state asks for.
 *
 *   - Composer input: a `voice.turn.user` row goes into the composer only when the kernel stamped it
 *     `forwardable: true` and not `trialTake` (a take of the send word being taught is never a draft), its text is non-empty, it carries no `intercepted`, it is for the attached session, it
 *     arrived live after dictation started (`seq > sinceSeq`: no backlog) and it was not inserted before (seq
 *     high-water). Consecutive turns append with one space.
 *   - The ring: armed while a draft exists, no hold, a delay is set (not off), the voice app is idle, the session is
 *     not streaming its turn, the attached session is the GUI's focused one, and nothing is sending. Arming starts the
 *     ring at the full delay; any new speech, transcription, inserted turn or streaming resets it to the full delay.
 *     A tick past the delay marks `sending` (the app performs it, then `sent` / `sendFailed`).
 *   - Hold, with WHO set it (Aegis M1): 'gui' (typing, clicking into a draft, [Hold], a failed send), 'voice' (the
 *     voice app's ⌃⌥H: status.voice.dictation.holdToggles, applied by parity since the last value seen on the same
 *     voice connection, Aegis L5) or 'detached' (Aegis M2). A voice toggle may set hold or clear a voice-set hold,
 *     never a GUI-set or detached one: only [Resume] or a send clears those. The composer's send (Enter / ⌘Enter /
 *     [send]) is the ONE send control: it sends now and clears hold and the draft.
 *   - Controls per state (draftState / DRAFT_CONTROLS): [Hold] / [Resume] show only beside a push-to-talk countdown;
 *     an ambient draft or auto-send off has no countdown, so no hold control.
 *   - No live attachment, never an auto-send (Aegis M2): when the attachment's hsid is not the draft's (moved, ended,
 *     the idle auto-off), the draft is held with reason 'detached'.
 *   - Send: unedited ⇒ one content part per turn in order, source voice (the kernel attributes them: 🎙); edited ⇒ the
 *     composer text as ONE part, source voice as a hint only, which matches no pending turn, so the kernel attributes
 *     nothing and it reads as a typed message (Aegis L1).
 *   - Ambient never auto-sends (TD-2026-10-20-125, founder ruling): a part whose turn is not a push-to-talk claim
 *     (`mode` other than exactly 'ptt', missing included: fail closed) marks the draft AMBIENT. An ambient draft never
 *     arms the ring and shows no hold control; only the composer's send (Enter / ⌘Enter / [send], a human key press) sends it. A misidentified voice can only fill
 *     the box, never act. PTT drafts keep the ring (the key hold was the human's gesture).
 *   - Never send words not shown (Aegis M3): an edit made while a send is in flight keeps hold and the edited text,
 *     and turns heard in flight append to it.
 *   - Send word (TD-2026-10-21-514, $send-by-word; the 'word' send policy): a turn whose WHOLE cleaned text is the held
 *     send word (exact or an enrolled variant, #send-word-matcher) is a command, never appended. It does nothing with
 *     no draft, or unless the current draft has been VISIBLE for SEND_WORD_VISIBLE_MS ('painted' events: stamped after
 *     paint by a double rAF, only while the page is visible and the draft's session is focused and attached; any text
 *     change resets it). A near miss is neither sent nor appended (nearMiss: "Did you say '<word>'?"). A match starts
 *     a SEND_WORD_GRACE_MS grace ("Sending… Esc keeps it"); then the send carries claim {by:'word', turnSeq}: the app
 *     appends request.voice.send.claim before the one send path.
 */

import { matchSendWord, PIECE_CAP_MS, PIECE_GAP_MS, SEND_WORD_GRACE_MS, SEND_WORD_VISIBLE_MS, sanitizeDisplayText, type SendPolicy, type SendWord } from '@a-company/gnomon-contracts';

export type Activity = 'speaking' | 'transcribing' | 'idle';
export const DELAY_CHOICES: readonly (number | null)[] = Object.freeze([3000, 5000, 8000, 15000, null]);
export const DEFAULT_DELAY_MS = 5000;
export const DELAY_KEY = 'gnomon.dictation.delayMs';
/** The status poll while a draft exists (the ENROL_POLL_MS precedent). */
export const DICTATION_POLL_MS = 300;

export interface DraftPart {
  seq: number;
  /** the exact words the voice app sent, when they are safe to send as-is (the kernel hash-matches them for 🎙); else the shown text */
  send?: string;
  text: string;
  /** TD-2026-10-20-125: the turn was not a push-to-talk claim (ambient): the draft never auto-sends */
  ambient?: true;
}

export interface DictationState {
  /** the session the draft belongs to (the attached one when the first part went in) */
  hsid: string | null;
  /** the attached session now (status.voice) */
  attached: string | null;
  /** the GUI's focused session is the draft's session */
  focusedHere: boolean;
  /** rows at or below this seq are backlog (never inserted) */
  sinceSeq: number;
  /** the highest voice row seq considered (each row once) */
  lastSeq: number;
  parts: DraftPart[];
  /** the composer text as the reducer knows it (the parts joined, or the human's edit) */
  text: string;
  edited: boolean;
  hold: boolean;
  activity: Activity;
  busy: boolean;
  lastActivityAt: number;
  ringStartedAt: number | null;
  /** null = off (never auto-send) */
  delayMs: number | null;
  sending: boolean;
  /** the last holdToggles value seen, or null before the first */
  holdToggles: number | null;
  /** the last part seq the in-flight send carries (turns heard while it is in flight stay for the next draft) */
  sentThrough: number;
  /** who set the hold (Aegis M1): a voice toggle never clears a 'gui' or 'detached' hold */
  holdBy: HoldBy | null;
  /** the voice connection the holdToggles baseline belongs to (Aegis L5); another one ⇒ a new baseline */
  holdEpoch: string | null;
  /** the human edited the composer while the send was in flight (Aegis M3) */
  editedInFlight: boolean;
  /** TD-2026-10-21-514: the send policy (key | countdown | word | pieces) and the held send word */
  policy: SendPolicy;
  sendWord: SendWord | null;
  /** the page is visible (document.visibilityState) */
  pageVisible: boolean;
  /** when the CURRENT draft text was first painted while visible + focused + attached (null: not yet, or reset) */
  visibleSince: number | null;
  /** a recognised send word's grace ("Sending… Esc keeps it"): the word turn's seq and when it began */
  grace: { seq: number; startedAt: number } | null;
  /** a near miss of the send word (the pill asks "Did you say '<word>'?") */
  nearMiss: string | null;
  /** the in-flight send's claim: the word turn (send word) or the piece's turns (pieces) */
  claim: { by: 'word'; turnSeq: number } | { by: 'piece'; turnSeqs: number[] } | { by: 'hotkey' } | null;
  /** Aegis M-5: the voice app's send key was pressed on an EDITED draft: held; only Enter sends it */
  hotkeyHeld: boolean;
  /** $send-by-pieces: when the current piece's first part arrived (the cap runs from here) */
  pieceStartedAt: number | null;
}

export type HoldBy = 'gui' | 'voice' | 'detached';

export type DictationEvent =
  | { type: 'start'; sinceSeq: number; now: number }
  | { type: 'context'; attached: string | null; focused: string | null; now: number }
  | { type: 'turnRow'; seq: number; hsid: string | null; payload: unknown; now: number }
  | { type: 'activity'; activity: Activity; now: number }
  | { type: 'holdToggle'; count: number; epoch?: string | null; now: number }
  | { type: 'hold'; hold: boolean; now: number }
  | { type: 'userEdit'; text: string; now: number }
  | { type: 'focusComposer'; now: number }
  | { type: 'blurComposer'; now: number }
  | { type: 'busy'; busy: boolean; now: number }
  | { type: 'tick'; now: number }
  | { type: 'sendNow'; now: number }
  | { type: 'sent'; now: number }
  | { type: 'sendFailed'; now: number }
  | { type: 'setDelay'; delayMs: number | null; now: number }
  | { type: 'setPolicy'; policy: SendPolicy; sendWord: SendWord | null; now: number }
  | { type: 'painted'; now: number }
  | { type: 'pageVisible'; visible: boolean; now: number }
  | { type: 'graceCancel'; now: number }
  /** Aegis M-5: the voice app's send-now press (⌃⌥Return): a voice-origin send of an UNEDITED draft only */
  | { type: 'sendNowKey'; now: number };

export function initialDictation(delayMs: number | null = DEFAULT_DELAY_MS): DictationState {
  return { hsid: null, attached: null, focusedHere: false, sinceSeq: Number.POSITIVE_INFINITY, lastSeq: 0, parts: [], text: '', edited: false, hold: false, activity: 'idle', busy: false, lastActivityAt: 0, ringStartedAt: null, delayMs, sending: false, holdToggles: null, sentThrough: 0, holdBy: null, holdEpoch: null, editedInFlight: false, policy: 'countdown', sendWord: null, pageVisible: true, visibleSince: null, grace: null, nearMiss: null, claim: null, pieceStartedAt: null, hotkeyHeld: false };
}

/**
 * $send-by-pieces (TD-2026-10-21-514): the current piece may go now — unedited dictated parts, not held, the session
 * attached and not busy (its streaming state, from the kernel's rows), and either a PIECE_GAP_MS gap since the last
 * speech (the voice app idle) or the piece reached PIECE_CAP_MS (it never grows past the cap).
 */
export function pieceDue(s: DictationState, now: number): boolean {
  if (s.policy !== 'pieces' || !s.parts.length || s.edited || s.hold || s.sending || s.busy || s.attached === null || s.attached !== s.hsid) return false;
  const gap = s.activity === 'idle' && now - s.lastActivityAt >= PIECE_GAP_MS;
  const cap = s.pieceStartedAt !== null && now - s.pieceStartedAt >= PIECE_CAP_MS;
  return gap || cap;
}

/** The piece ring's drained fraction 0..1 toward the gap (null when no piece is gathering). */
export function pieceFraction(s: DictationState, now: number): number | null {
  if (s.policy !== 'pieces' || !s.parts.length || s.edited || s.hold || s.sending) return null;
  return Math.min(1, Math.max(0, (now - s.lastActivityAt) / PIECE_GAP_MS));
}

/** The draft may be sent by the word now: a draft, visible ≥ SEND_WORD_VISIBLE_MS, page visible, focused, attached, idle. */
export function wordReady(s: DictationState, now: number): boolean {
  return hasDraft(s) && s.policy === 'word' && s.pageVisible && s.focusedHere && s.attached !== null && s.attached === s.hsid && !s.sending && s.visibleSince !== null && now - s.visibleSince >= SEND_WORD_VISIBLE_MS;
}

const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null);

export const hasDraft = (s: DictationState): boolean => s.text.trim().length > 0;

/** TD-2026-10-20-125: the draft holds ambient speech (never auto-sent; a key press sends it). */
export const ambientDraft = (s: DictationState): boolean => s.parts.some((p) => p.ambient === true);

/** A voice.turn.user payload is a push-to-talk claim (exactly 'ptt'); anything else is ambient (fail closed). */
export const pttTurn = (payload: unknown): boolean => obj(payload)?.mode === 'ptt';

/** The ring may run now (a PTT-only draft, no hold, a delay, idle, not streaming, focused here, not sending). */
export function armed(s: DictationState): boolean {
  return hasDraft(s) && s.parts.length > 0 && s.policy === 'countdown' && !ambientDraft(s) && !s.hold && s.attached !== null && s.attached === s.hsid && s.delayMs !== null && s.activity === 'idle' && !s.busy && s.focusedHere && !s.sending;
}

/** Re-derive the ring after an event: `reset` restarts it at the full delay when armed. */
function settle(s: DictationState, now: number, reset: boolean): DictationState {
  if (!armed(s)) return s.ringStartedAt === null ? s : { ...s, ringStartedAt: null };
  if (reset || s.ringStartedAt === null) return { ...s, ringStartedAt: now };
  return s;
}

/** A voice.turn.user payload goes into the composer (the kernel contract; every assumption lives here). */
export function insertableText(payload: unknown): string | null {
  return turnText(payload)?.shown ?? null;
}

/**
 * A turn's composer text (`shown`: sanitized by the contracts §4.5 rules, Aegis L4 — bidi controls become visible
 * glyphs, control characters and hidden characters go — then whitespace collapsed) and the text the send carries
 * (`send`): the voice app's exact words when sanitizing changed nothing but whitespace (so the kernel's hash match
 * still attributes the turn), else the shown text (never send characters the human was not shown).
 */
export function turnText(payload: unknown): { shown: string; send: string } | null {
  const p = obj(payload);
  if (!p || p.forwardable !== true || p.partial === true) return null;
  // a take of the send word being taught (the attended trial) is never a draft, whatever else the row says
  if (p.trialTake === true) return null;
  if (p.intercepted !== undefined && p.intercepted !== null && p.intercepted !== false) return null;
  if (p.refusal !== undefined || p.refused !== undefined) return null;
  if (typeof p.text !== 'string') return null;
  const clean = sanitizeDisplayText(p.text);
  const shown = clean.text.replace(/\s+/g, ' ').trim();
  if (!shown) return null;
  return { shown, send: clean.flags.length === 0 && clean.text === p.text ? p.text : shown };
}

const append = (text: string, t: string): string => (!text ? t : /\s$/.test(text) ? text + t : `${text} ${t}`);

/** After a send: the turns heard while it was in flight stay as the next (unedited) draft; hold and the rest clear. */
function cleared(s: DictationState): DictationState {
  const rest = s.parts.filter((p) => p.seq > s.sentThrough);
  // Aegis M3: an edit made in flight is what the human sees: keep it (in-flight turns already appended to it), held
  if (s.editedInFlight) return { ...s, parts: rest, edited: true, hold: true, holdBy: 'gui', sending: false, ringStartedAt: null, editedInFlight: false };
  return { ...s, hsid: rest.length ? s.hsid : s.attached, parts: rest, text: rest.map((p) => p.text).join(' '), edited: false, hold: false, holdBy: null, sending: false, ringStartedAt: null, editedInFlight: false };
}

/** Aegis M2: a draft whose session is not the live attachment is held ('detached'); never auto-sent. */
function detach(s: DictationState): DictationState {
  if (!s.parts.length || (s.attached !== null && s.attached === s.hsid)) return s;
  if (s.hold && s.holdBy !== 'voice') return s;
  return { ...s, hold: true, holdBy: 'detached' };
}
const lastPartSeq = (s: DictationState): number => (s.parts.length ? s.parts[s.parts.length - 1]!.seq : 0);

export function reduceDictation(s: DictationState, e: DictationEvent): DictationState {
  switch (e.type) {
    case 'start':
      return { ...s, sinceSeq: e.sinceSeq, lastSeq: Math.max(s.lastSeq, e.sinceSeq) };
    case 'context': {
      // the draft keeps its session; with no draft the dictation follows the attachment
      const hsid = hasDraft(s) || s.parts.length ? s.hsid : e.attached;
      const focusedHere = hsid !== null && e.focused === hsid;
      const lost = (s.focusedHere && !focusedHere) || s.attached !== e.attached;
      const n = detach({ ...s, attached: e.attached, hsid, focusedHere, ...(lost ? { visibleSince: null, grace: null } : {}) });
      return settle(n, e.now, !s.focusedHere && n.focusedHere);
    }
    case 'turnRow': {
      if (e.seq <= s.sinceSeq || e.seq <= s.lastSeq) return s;
      const n0 = { ...s, lastSeq: e.seq };
      const tt = turnText(e.payload);
      if (tt === null || !e.hsid || e.hsid !== s.attached) return n0;
      const t = tt.shown;
      // TD-2026-10-21-514: under the word policy the send word is a COMMAND (never appended); a near miss is neither
      if (s.policy === 'word' && s.sendWord) {
        const m = matchSendWord(tt.shown, s.sendWord);
        if (m === 'exact' || m === 'variant') {
          if (s.grace || !wordReady(s, e.now)) return { ...n0, nearMiss: null }; // no draft, or not visible long enough: nothing
          return { ...n0, nearMiss: null, grace: { seq: e.seq, startedAt: e.now } };
        }
        if (m === 'near') return { ...n0, nearMiss: s.sendWord.text };
      }
      if ((hasDraft(s) || s.parts.length) && s.hsid !== e.hsid) return n0; // a draft for another session: never mixed
      const n = { ...n0, hsid: e.hsid, parts: [...s.parts, { seq: e.seq, text: t, ...(tt.send !== t ? { send: tt.send } : {}), ...(pttTurn(e.payload) ? {} : { ambient: true as const }) }], text: append(s.text, t), lastActivityAt: e.now, visibleSince: null, grace: null, nearMiss: null, pieceStartedAt: s.parts.length && s.pieceStartedAt !== null ? s.pieceStartedAt : e.now };
      return settle(n, e.now, true);
    }
    case 'activity': {
      const n = { ...s, activity: e.activity, lastActivityAt: e.now };
      return settle(n, e.now, true);
    }
    case 'holdToggle': {
      const epoch = e.epoch ?? null;
      // a baseline: the first value, a lower one (a kernel restart) or another voice connection (Aegis L5)
      if (s.holdToggles === null || e.count < s.holdToggles || epoch !== s.holdEpoch) return { ...s, holdToggles: e.count, holdEpoch: epoch };
      if ((e.count - s.holdToggles) % 2 === 0) return { ...s, holdToggles: e.count };
      // Aegis M1: the voice hotkey sets hold or clears its own; a GUI-set or detached hold stays
      const n: DictationState = !s.hold ? { ...s, holdToggles: e.count, hold: true, holdBy: 'voice' } : s.holdBy === 'voice' ? { ...s, holdToggles: e.count, hold: false, holdBy: null } : { ...s, holdToggles: e.count };
      return settle(n, e.now, n.hold !== s.hold);
    }
    case 'hold':
      return settle(e.hold ? { ...s, hold: true, holdBy: 'gui' } : { ...s, hold: false, holdBy: null }, e.now, e.hold !== s.hold);
    case 'userEdit': {
      if (e.text === s.text) return s;
      const n = { ...s, text: e.text, edited: true, hold: true, holdBy: 'gui' as const, editedInFlight: s.editedInFlight || s.sending, visibleSince: null, grace: null };
      if (!e.text.trim()) return settle({ ...n, parts: [], edited: false, hsid: s.attached }, e.now, false); // emptied: no draft left (hold stays)
      return settle(n, e.now, false);
    }
    case 'focusComposer':
      return hasDraft(s) ? settle({ ...s, hold: true, holdBy: 'gui' }, e.now, false) : s;
    case 'blurComposer':
      return s;
    case 'busy':
      if (e.busy === s.busy) return s;
      return settle({ ...s, busy: e.busy, lastActivityAt: e.now }, e.now, true);
    case 'tick':
      // $send-by-pieces: the piece is due (gap or cap): send its parts with the piece claim
      if (pieceDue(s, e.now)) return { ...s, sending: true, ringStartedAt: null, sentThrough: lastPartSeq(s), claim: { by: 'piece', turnSeqs: s.parts.map((p) => p.seq) } };
      // the send word's grace ran out: send with the claim (still ready: visible, focused, attached)
      if (s.grace && e.now - s.grace.startedAt >= SEND_WORD_GRACE_MS) {
        if (!wordReady(s, e.now)) return { ...s, grace: null };
        return { ...s, grace: null, sending: true, ringStartedAt: null, sentThrough: lastPartSeq(s), claim: { by: 'word', turnSeq: s.grace.seq } };
      }
      if (!armed(s) || s.ringStartedAt === null || s.delayMs === null) return s;
      return e.now - s.ringStartedAt >= s.delayMs ? { ...s, sending: true, ringStartedAt: null, sentThrough: lastPartSeq(s) } : s;
    case 'sendNow':
      return hasDraft(s) && !s.sending ? { ...s, sending: true, ringStartedAt: null, sentThrough: lastPartSeq(s), grace: null, claim: null } : s;
    case 'sent':
      return settle({ ...cleared(s), claim: null, visibleSince: null, nearMiss: null, pieceStartedAt: null, hotkeyHeld: false }, e.now, true);
    case 'sendFailed':
      return settle({ ...s, sending: false, hold: true, holdBy: 'gui', editedInFlight: false, claim: null }, e.now, false); // never loop a refused send: wait for the human
    case 'setPolicy':
      return settle({ ...s, policy: e.policy, sendWord: e.sendWord, grace: null, nearMiss: null, ...(e.policy === 'countdown' ? {} : { ringStartedAt: null }) }, e.now, true);
    case 'painted':
      // stamped after paint (double rAF) only while visible + focused + attached; the first paint of this text wins
      if (!hasDraft(s) || s.visibleSince !== null || !s.pageVisible || !s.focusedHere || s.attached === null || s.attached !== s.hsid) return s;
      return { ...s, visibleSince: e.now };
    case 'pageVisible':
      return e.visible === s.pageVisible ? s : { ...s, pageVisible: e.visible, ...(e.visible ? {} : { visibleSince: null, grace: null }) };
    case 'sendNowKey':
      if (!hasDraft(s) || s.sending) return s;
      // never send typed text on a key the voice app reports: an edited draft is held for Enter
      if (s.edited) return { ...s, hold: true, holdBy: 'gui', hotkeyHeld: true, ringStartedAt: null };
      return { ...s, sending: true, ringStartedAt: null, sentThrough: lastPartSeq(s), grace: null, claim: { by: 'hotkey' } };
    case 'graceCancel':
      return s.grace ? { ...s, grace: null, hold: true, holdBy: 'gui' } : s;
    case 'setDelay':
      return settle({ ...s, delayMs: e.delayMs }, e.now, true);
  }
}

/** The ring's remaining milliseconds, or null when it is not running. */
export function ringRemaining(s: DictationState, now: number): number | null {
  if (!armed(s) || s.ringStartedAt === null || s.delayMs === null) return null;
  return Math.max(0, s.delayMs - (now - s.ringStartedAt));
}

/** The ring's drained fraction 0..1 (0 = full), or null. */
export function ringFraction(s: DictationState, now: number): number | null {
  const r = ringRemaining(s, now);
  return r === null || s.delayMs === null ? null : 1 - r / s.delayMs;
}

export interface SendRequest {
  hsid: string;
  content: { text: string }[];
  /** voice when the draft holds dictated turns; absent for a typed-only message */
  source?: 'voice';
}

/** TD-2026-10-21-514: the claim the app appends (request.voice.send.claim) right before a send-word send. */
export function sendClaim(s: DictationState): { hsid: string; by: 'word'; turnSeq: number } | { hsid: string; by: 'piece'; turnSeqs: number[] } | { hsid: string; by: 'hotkey' } | null {
  if (!s.claim || !s.hsid) return null;
  if (s.claim.by === 'hotkey') return { hsid: s.hsid, by: 'hotkey' };
  return s.claim.by === 'word' ? { hsid: s.hsid, by: 'word', turnSeq: s.claim.turnSeq } : { hsid: s.hsid, by: 'piece', turnSeqs: [...s.claim.turnSeqs] };
}

export const HOTKEY_EDITED_NOTE = 'Edited draft: press Enter to send';

/** The `session.send` params the draft makes, or null (nothing, or no session). */
export function sendRequest(s: DictationState): SendRequest | null {
  if (!s.hsid || !hasDraft(s)) return null;
  if (!s.edited && s.parts.length) return { hsid: s.hsid, content: s.parts.map((p) => ({ text: p.send ?? p.text })), source: 'voice' };
  // Aegis H-1: a send-word (or piece) send always carries the voice hint, even when the draft was emptied and retyped
  return { hsid: s.hsid, content: [{ text: s.text }], ...(s.parts.length || s.claim ? { source: 'voice' as const } : {}) };
}

/** TD-2026-10-20-125: an ambient draft waits for the human's key press. */
export const AMBIENT_DRAFT_NOTE = 'draft · Enter sends (an open-mic draft never sends itself)';

/**
 * The draft's state as the controls see it (founder report 2026-10-20: one send control, Hold only beside a countdown).
 *   - 'idle': no dictated draft (the bar is hidden).
 *   - 'ambient': the draft holds ambient speech: no countdown exists, so there is nothing to hold.
 *   - 'ptt-countdown': a push-to-talk draft with a delay set and no hold (the ring may be paused by speech or streaming).
 *   - 'ptt-held': a push-to-talk draft with a delay set, held (by the GUI, the voice hotkey or a detach).
 *   - 'ptt-manual': a push-to-talk draft with auto-send off: no countdown, nothing to hold.
 * A new dictation mode adds a state here and a row in DRAFT_CONTROLS; the composer's own send stays the one send.
 */
export type DraftState = 'idle' | 'ambient' | 'ptt-countdown' | 'ptt-held' | 'ptt-manual' | 'word-grace' | 'piece-ring';

export interface DraftControls {
  /** the hold control beside the countdown: [Hold], [Resume], or none */
  hold: 'hold' | 'resume' | null;
  /** the countdown ring may show (it shows only while it runs: ringFraction) */
  ring: boolean;
  /** TD-2026-10-21-514: the send word's grace line ("Sending… Esc keeps it") */
  grace?: boolean;
  /** the pieces batch ring (a piece is gathering; it sends at the gap or the cap) */
  pieceRing?: boolean;
}

/** Per state, the dictation bar's controls. Sending is never here: the composer's send (Enter / ⌘Enter / [send]) is the one send control. */
export const DRAFT_CONTROLS: Readonly<Record<DraftState, Readonly<DraftControls>>> = Object.freeze({
  idle: Object.freeze({ hold: null, ring: false }),
  ambient: Object.freeze({ hold: null, ring: false }),
  'ptt-countdown': Object.freeze({ hold: 'hold' as const, ring: true }),
  'ptt-held': Object.freeze({ hold: 'resume' as const, ring: false }),
  'ptt-manual': Object.freeze({ hold: null, ring: false }),
  'word-grace': Object.freeze({ hold: null, ring: false, grace: true }),
  'piece-ring': Object.freeze({ hold: null, ring: false, pieceRing: true }),
});

export const WORD_GRACE_LINE = 'Sending… Esc keeps it';

export function draftState(s: DictationState): DraftState {
  if (!hasDraft(s) || !s.parts.length) return 'idle';
  if (s.grace) return 'word-grace';
  if (s.policy === 'pieces' && !s.edited && !s.hold) return 'piece-ring';
  if (ambientDraft(s)) return 'ambient';
  if (s.delayMs === null) return 'ptt-manual';
  return s.hold ? 'ptt-held' : 'ptt-countdown';
}

export const draftControls = (s: DictationState): DraftControls => DRAFT_CONTROLS[draftState(s)];

/** The pill's dictation note: "draft waiting" when a draft waits on another focused session, "held", or null. */
export function dictationNote(s: DictationState): string | null {
  if (!hasDraft(s) || !s.parts.length) return null;
  if (!s.focusedHere) return 'draft waiting';
  if (s.hold && s.holdBy === 'detached') return 'draft held · voice detached';
  if (s.grace) return WORD_GRACE_LINE;
  if (s.hotkeyHeld) return HOTKEY_EDITED_NOTE;
  if (s.nearMiss) return `Did you say '${s.nearMiss}'? Say it again or press Enter`;
  if (s.policy === 'word' && s.sendWord) return `draft · say '${s.sendWord.text}' or press Enter`;
  if (s.policy === 'pieces') return s.edited || s.hold ? 'piece held · Enter sends' : s.busy ? 'piece waiting · Claude is answering' : 'sending in pieces · edits ask first';
  if (ambientDraft(s)) return AMBIENT_DRAFT_NOTE; // nothing counts down, so a hold means nothing here
  if (s.hold) return 'draft held';
  if (s.delayMs === null) return 'draft · auto-send off';
  return null;
}

/** The aria-live line ("sending in N s"), or ''. Whole seconds only, so the live region speaks once a second at most. */
export function liveLine(s: DictationState, now: number): string {
  if (s.sending) return 'sending';
  const r = ringRemaining(s, now);
  if (r !== null) return `sending in ${Math.ceil(r / 1000)} s`;
  const note = dictationNote(s);
  return note ?? '';
}

/** The auto-send setting as stored in localStorage, per machine: '3000' | '5000' | '8000' | '15000' | 'off'; anything else ⇒ the default. */
export function parseDelay(v: string | null): number | null {
  if (v === 'off') return null;
  const n = v === null ? NaN : Number(v);
  return DELAY_CHOICES.includes(n) ? n : DEFAULT_DELAY_MS;
}
export const serializeDelay = (d: number | null): string => (d === null ? 'off' : String(d));
export const delayLabel = (d: number | null): string => (d === null ? 'off' : `${d / 1000} s`);

export interface DictationStatus {
  activity: Activity;
  holdToggles: number | null;
  /** TD-2026-10-21-514: the voice app's ⌃⌥Return count (a change sends the draft: a hand origin) */
  sendNows: number | null;
  /** the voice connection the counter belongs to (Aegis L5): status.voice.dictation.connEpoch, else the client restart count */
  epoch: string | null;
}
/** status.voice.dictation = {activity, holdToggles, at} (the adapter; an older kernel reports none ⇒ idle, null). */
export function dictationStatusOf(status: unknown): DictationStatus {
  const d = obj(obj(obj(status)?.voice)?.dictation);
  const a = d?.activity;
  const ce = d?.connEpoch;
  const restarts = obj(obj(obj(status)?.voice)?.client)?.restarts;
  const epoch = typeof ce === 'string' || typeof ce === 'number' ? `c:${ce}` : typeof restarts === 'number' ? `r:${restarts}` : null;
  return { activity: a === 'speaking' || a === 'transcribing' ? a : 'idle', holdToggles: typeof d?.holdToggles === 'number' && Number.isSafeInteger(d.holdToggles) ? d.holdToggles : null, sendNows: typeof d?.sendNows === 'number' && Number.isSafeInteger(d.sendNows) ? d.sendNows : null, epoch };
}
