/**
 * @symbol #gui-dictation
 *
 * #gui voice presets (TD-2026-10-21-514, spec §14.7 "Voice submodes"). PURE: the preset the human picked (per
 * machine), the send policy it implies, the attach payload's send ceiling, the one-time liability acknowledgement
 * (per user) that Send word and Pieces need, the held send word from status.voice.sendWord, and the transcript label
 * a turn.sent row earns.
 *
 *   Talk (ptt × countdown) · Dictate (open × key) · Send word (open × word) · Pieces (open × pieces)
 *
 * Voice may narrow the mode, never widen it: a preset only changes what the GUI does with the draft and the send
 * ceiling it asks for when attaching; the kernel's ceilings (presence for ambient and pieces) still apply.
 */
import { canonicalSendWord, LIABILITY_SEND_POLICIES, VOICE_LIABILITY_ACK_TEXT, VOICE_PRESETS, type SendPolicy, type SendWord, type VoicePreset } from '@a-company/gnomon-contracts';

export const PRESET_KEY = 'gnomon.voice.preset';
/** TD-2026-10-21-514: how ambient presets listen: always on ('open') or toggled by the mic key ('toggle'), per machine */
export const CAPTURE_KEY = 'gnomon.voice.capture';
export const parseCapturePref = (v: string | null): 'open' | 'toggle' => (v === 'toggle' ? 'toggle' : 'open');
/** The capture kind the kernel-spawned voice client runs with: Talk is push-to-talk; the ambient presets use the preference. */
export function captureOf(p: VoicePreset, pref: 'open' | 'toggle'): 'ptt' | 'open' | 'toggle' {
  return VOICE_PRESETS[p].capture === 'ptt' ? 'ptt' : pref;
}
export const ACK_KEY_PREFIX = 'gnomon.voice.liabilityAck.';
export const PRESET_LABELS: Readonly<Record<VoicePreset, string>> = Object.freeze({ talk: 'Talk', dictate: 'Dictate', 'send-word': 'Send word', pieces: 'Pieces' });
export const PRESET_NOTES: Readonly<Record<VoicePreset, string>> = Object.freeze({
  talk: 'hold the key; sends after the countdown',
  dictate: 'open-mic words fill the draft; Enter sends',
  'send-word': 'say your send word to send',
  pieces: 'open-mic speech is sent in pieces',
});
export const ACK_TEXT = VOICE_LIABILITY_ACK_TEXT;

export interface StorageLike {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
}

export function parsePreset(v: string | null): VoicePreset {
  return v !== null && Object.hasOwn(VOICE_PRESETS, v) ? (v as VoicePreset) : 'talk';
}

export const policyOf = (p: VoicePreset): SendPolicy => VOICE_PRESETS[p].send;
export const isLiability = (p: VoicePreset): boolean => (LIABILITY_SEND_POLICIES as readonly string[]).includes(policyOf(p));

/** The send ceiling a preset asks for when attaching (voice.session.start{send}); talk and dictate ask for none. */
export function attachSend(p: VoicePreset): 'word' | 'pieces' | null {
  const s = policyOf(p);
  return s === 'word' || s === 'pieces' ? s : null;
}

/** The liability acknowledgement, recorded once per user (principal) on this machine. */
export const acked = (st: StorageLike, principal: string | null): boolean => !!principal && st.getItem(ACK_KEY_PREFIX + principal) === ACK_TEXT;
/** Luna #3: when the acknowledgement was recorded (ISO), stored beside it; null when not acked or recorded before the date was kept. */
export const ACK_AT_SUFFIX = '.at';
export function ackedAt(st: StorageLike, principal: string | null): string | null {
  if (!principal || !acked(st, principal)) return null;
  const at = st.getItem(ACK_KEY_PREFIX + principal + ACK_AT_SUFFIX);
  return at && !Number.isNaN(new Date(at).getTime()) ? at : null;
}
export function recordAck(st: StorageLike, principal: string, now: Date = new Date()): void {
  st.setItem(ACK_KEY_PREFIX + principal, ACK_TEXT);
  st.setItem(ACK_KEY_PREFIX + principal + ACK_AT_SUFFIX, now.toISOString());
}

/** When the acknowledgement was made, in words: 'today', else a short date; '' when unknown. */
export function ackWhen(iso: string | null, now: Date = new Date()): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  if (d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate()) return 'today';
  return d.toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' });
}
/** "acknowledged · today" (or the date; plain "acknowledged" for one recorded before the date was kept). */
export const ackedLine = (iso: string | null, now: Date = new Date()): string => {
  const w = ackWhen(iso, now);
  return w ? `acknowledged · ${w}` : 'acknowledged';
};

/**
 * The risk check's paragraph (Atelier 2026-10-21 direction.html): what sends, and that a voice-sent turn runs like a typed
 * one (TD-2026-10-23-939). With a send
 * word it names the word; Pieces names the pause. The box under it is ACK_TEXT itself (its hash is the kernel's).
 */
export function riskSentence(o: { word: string | null; pieces?: boolean }): string {
  // TD-2026-10-23-496: the send word sends the whole draft, words Gnomon couldn't check as you included
  if (!o.pieces && o.word) return `When you say “${o.word}”, Gnomon sends everything in the draft, even words it couldn't check as you. Anyone near your mic, or a video playing, can send with this word, and a voice-sent turn runs under your run mode and Always rules, like a message you typed.`;
  return 'When you pause, Gnomon sends what you dictated. Another voice or a video could be taken for yours, and a voice-sent turn runs under your run mode and Always rules, like a message you typed.';
}

/**
 * Choosing a preset: a liability preset without the acknowledgement asks for it first ('needs-ack'); a word preset
 * with no held send word opens the guided "Teach Gnomon your send word" ('needs-word'); else it applies.
 */
export function choosePreset(p: VoicePreset, o: { acked: boolean; sendWord: SendWord | null }): 'apply' | 'needs-ack' | 'needs-word' {
  if (isLiability(p) && !o.acked) return 'needs-ack';
  if (policyOf(p) === 'word' && !o.sendWord) return 'needs-word';
  return 'apply';
}

/** status.voice.sendWord (human class only) → the held send word, canonical, or null. */
export function sendWordOf(status: unknown): SendWord | null {
  const v = (status as { voice?: { sendWord?: unknown } } | null | undefined)?.voice?.sendWord;
  return v ? canonicalSendWord(v) : null;
}

/** The transcript label of a sent turn, from its kernel-signed turn.sent payload (origin, sentBy, source). */
export function sentLabel(p: unknown): { label: string } | null {
  const o = p && typeof p === 'object' ? (p as Record<string, unknown>) : null;
  if (!o || (o.source !== 'voice' && o.origin !== 'voice' && o.origin !== 'voice-unverified')) return null;
  // the plain origin, for the record (TD-2026-10-23-939: a voice-sent turn runs like a typed one; nothing asks first)
  if (o.origin === 'voice-unverified') return { label: 'spoken · unverified voice · sent by you' };
  if (o.origin === 'voice') return { label: o.sentBy === 'piece' ? 'spoken · sent as a piece' : o.sentBy === 'hotkey' ? 'spoken · sent by send-now' : 'spoken · sent by send word' };
  return { label: o.sentBy === 'release' ? 'spoken · sent on release' : 'spoken · sent by you' };
}

/**
 * Luna #10: a voice-sent turn's "who" line in words, never a glyph: "you · spoken · sent by <how>" (the speaker, then
 * the sent label, or plain "spoken" when the kernel signed no turn.sent label), "· edited" when the human edited it.
 */
export function voiceWho(o: { speaker: string; edited: boolean; sent: string | null }): { who: string; sent: string } {
  // board gnomon-status-colour: a voice turn reads by the word "voice", never by a hue
  return { who: o.speaker === 'voice' ? 'voice' : `${o.speaker} · voice`, sent: `· ${o.sent ?? 'spoken'}${o.edited ? ' · edited' : ''}` };
}
/** Luna #10: the tag before a reply's spoken part, in words ("voice" carries it, never a hue: board gnomon-status-colour). */
export const saidTag = (by: 'kernel' | 'reply'): string => (by === 'kernel' ? 'voice · said aloud' : 'voice · spoken part');

