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
export const ACK_KEY_PREFIX = 'gnomon.voice.liabilityAck.';
export const PRESET_LABELS: Readonly<Record<VoicePreset, string>> = Object.freeze({ talk: 'Talk', dictate: 'Dictate', 'send-word': 'Send word', pieces: 'Pieces' });
export const PRESET_NOTES: Readonly<Record<VoicePreset, string>> = Object.freeze({
  talk: 'hold the key; sends after the countdown',
  dictate: 'ambient words fill the draft; Enter sends',
  'send-word': 'say your send word to send; edits ask first',
  pieces: 'ambient speech is sent in pieces; edits ask first',
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
export function recordAck(st: StorageLike, principal: string): void {
  st.setItem(ACK_KEY_PREFIX + principal, ACK_TEXT);
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
export function sentLabel(p: unknown): { label: string; asksFirst: boolean } | null {
  const o = p && typeof p === 'object' ? (p as Record<string, unknown>) : null;
  if (!o || (o.source !== 'voice' && o.origin !== 'voice')) return null;
  if (o.origin === 'voice') return { label: o.sentBy === 'piece' ? 'spoken · sent as a piece' : 'spoken · sent by send word', asksFirst: true };
  return { label: o.sentBy === 'release' ? 'spoken · sent on release' : 'spoken · sent by you', asksFirst: false };
}

/** The session header chip while a voice-origin turn of that session is outstanding. */
export const CLAMP_CHIP = 'Voice turn: edits ask first';

/**
 * Display only (the kernel's clamp is the boundary): is a voice-origin turn of this session still open — a
 * turn.sent{origin:'voice'} after the session's last turn.result? Rows in log order.
 */
export function clampedFrom(rows: readonly { kind: string; session?: string | null; payload?: unknown }[], hsid: string): boolean {
  let open = false;
  for (const r of rows) {
    if (r.session !== hsid) continue;
    const p = r.payload && typeof r.payload === 'object' ? (r.payload as Record<string, unknown>) : null;
    if (r.kind === 'turn.sent' && p?.origin === 'voice') open = true;
    else if (r.kind === 'turn.result' || r.kind === 'session.exited') open = false;
  }
  return open;
}
