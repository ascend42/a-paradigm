/**
 * @symbol #gui
 *
 * #gui voice controls (voice slice V2d, TD-2026-10-19-298; spec §11.4 header, §14.7 attachment). PURE.
 *
 *   - Three states: Mic off, push-to-talk (`ptt`), ambient (`conversation` on the wire). The header pill is
 *     KERNEL-OWNED: its state comes only from `status.voice` (re-read when a voice.session.* row arrives, and polled
 *     lightly while attached: core/voice-client.ts clientPollWanted, T-2026-10-20-002), never
 *     from the voice client's own claims. `voiceStatusOf` is the one adapter over the status shape (V1:
 *     `{attached: {voiceSessionId, hsid, mode, turns} | null}`; V2a: `{attached: boolean, hsid, ceiling: 'ptt' |
 *     'conversation' | null, since, idleAt, voiceSessionId, turns: {n}, echoTailMs, ambientIdleMs}`, where
 *     `ceiling` is what the attachment may hear now, i.e. its state). Unknown values fail toward the LOUDER
 *     indicator: an attached session whose mode is not `ptt` reads as ambient (the pill never under-reports).
 *   - The human's gesture is `log.append voice.session.start{hsid, mode, continues?}` (attach or switch) or
 *     `voice.session.end{voiceSessionId?}` (Off). Ambient → push-to-talk and Off are free; widening to ambient takes
 *     a fresh Touch ID once per GUI login (the kernel answers `{pending, cardId}` and the page approves it in the
 *     same gesture, as a run-mode loosening does).
 *   - Only a human-class connection is offered attach controls (`canAttach`); a voice connection never is.
 */

export type VoiceState = 'off' | 'ptt' | 'ambient';
export const VOICE_STATES: readonly VoiceState[] = Object.freeze(['off', 'ptt', 'ambient'] as const);
/** The wire name of each attached state (contracts VOICE_MODES_V1). */
export const WIRE_MODE: Readonly<Record<Exclude<VoiceState, 'off'>, 'ptt' | 'conversation'>> = Object.freeze({ ptt: 'ptt', ambient: 'conversation' });
/** Shown when the kernel does not name the hotkey (the Swift voice app owns it, V2b). */
export const DEFAULT_PTT_HOTKEY = '⌃⌥Space';
/** The kernel's default ambient idle auto-off, used in the note when the end row does not say. */
export const DEFAULT_IDLE_MINUTES = 10;

export interface VoiceView {
  /** the kernel reported a voice status at all (an older kernel does not) */
  known: boolean;
  state: VoiceState;
  hsid: string | null;
  voiceSessionId: string | null;
  /** a hard cap on the loudest state, only when the kernel names one (`maxMode`); else ambient (the kernel decides) */
  ceiling: VoiceState;
  since: string | null;
  idleAt: string | null;
  /** the voice app is connected: true / false, or null when the status does not tell */
  clientConnected: boolean | null;
  /** the kernel already holds this login's ambient presence (no Touch ID needed to widen) */
  ambientConfirmed: boolean;
  hotkey: string;
  /** a live input level 0..1 when the kernel relays one */
  level: number | null;
  /** the kernel's ambient idle auto-off (V2a ambientIdleMs), or null */
  ambientIdleMs: number | null;
}

const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);
const stateOfMode = (m: unknown): VoiceState => (m === 'ptt' ? 'ptt' : 'ambient');
const capOf = (c: unknown): VoiceState => (c === 'off' || c === 'none' ? 'off' : c === 'ptt' ? 'ptt' : 'ambient');

/** The voice view from a `status` result (the adapter: every status-shape assumption lives here). */
export function voiceStatusOf(status: unknown): VoiceView {
  const s = obj(status);
  const v = obj(s?.voice);
  const att = v ? v.attached : undefined;
  const a = obj(att) ?? (att === true ? v : null);
  const hsid = a ? str(a.hsid) : null;
  const attached = a !== null && hsid !== null;
  let clientConnected: boolean | null = null;
  if (v && typeof v.clientConnected === 'boolean') clientConnected = v.clientConnected;
  else if (v && typeof v.clients === 'number') clientConnected = v.clients > 0;
  else if (v && Array.isArray(v.clients)) clientConnected = v.clients.length > 0;
  // Aegis M (V2d): only an explicit kernel field decides; no guessing from client names (unsure ⇒ null)
  const level = a && typeof a.level === 'number' ? a.level : v && typeof v.level === 'number' ? v.level : null;
  return {
    known: v !== null,
    // V2a names the attachment's state `ceiling` (no `mode`); V1 names it `mode`
    state: attached ? stateOfMode(a!.mode !== undefined ? a!.mode : a!.ceiling) : 'off',
    hsid: attached ? hsid : null,
    voiceSessionId: attached ? str(a!.voiceSessionId) : null,
    ceiling: capOf(a?.maxMode ?? v?.maxMode),
    since: attached ? str(a!.since) : null,
    idleAt: attached ? str(a!.idleAt) : null,
    clientConnected,
    ambientConfirmed: v?.ambientConfirmed === true || v?.presence === 'fresh' || obj(v?.presence)?.ambient === true,
    hotkey: str(v?.hotkey) ?? DEFAULT_PTT_HOTKEY,
    level: level === null ? null : Math.max(0, Math.min(1, level)),
    ambientIdleMs: v && typeof v.ambientIdleMs === 'number' && v.ambientIdleMs > 0 ? v.ambientIdleMs : null,
  };
}

/** Only a first-party human connection attaches voice (a voice connection never is offered the controls). */
export function canAttach(status: unknown): boolean {
  return obj(status)?.principalKind === 'human';
}

/** The short name a session goes by in the GUI (as in the sessions list). */
export const sessionName = (hsid: string): string => hsid.slice(-10);

export interface Pill {
  state: VoiceState | 'noclient';
  label: string;
  /** the attached session, or '' */
  target: string;
  title: string;
  className: string;
}

/**
 * The header pill: grey Mic off, blue hold-to-talk, red pulsing Listening. Aegis M (V2d): never under-report a live
 * mic — when attached, the attached state ALWAYS keeps its class, label and meter, and the real voice-app condition is
 * appended to it: `clientTail` (core/voice-client.ts clientPillOf `.tail`: "· voice crashed: <lastError>", "· setting
 * up voice…", "· voice app not connected", "· teach Gnomon your voice first", T-2026-10-20-002) when the kernel reports
 * the client lifecycle, else "· voice app not connected" when the kernel says the voice app is not connected. Only with
 * nothing attached does the pill say "Voice app not running".
 */
export function pillOf(v: VoiceView, clientTail: string | null = null): Pill {
  const target = v.hsid ? sessionName(v.hsid) : '';
  const gone = v.clientConnected === false;
  const tail = clientTail ?? (gone ? ' · voice app not connected' : '');
  const goneCls = gone ? ' voice-noclient' : '';
  if (v.state === 'ambient') return { state: 'ambient', label: `Listening${tail}`, target, title: `Ambient: the mic is open for ${target}.${gone ? ' The kernel does not see the voice app connected.' : ''} Click to switch to push-to-talk or off.`, className: `voice-pill kernel-owned voice-ambient${goneCls}` };
  if (v.state === 'ptt') return { state: 'ptt', label: `Hold ${v.hotkey} to talk${tail}`, target, title: `Push-to-talk to ${target}.${gone ? ' The kernel does not see the voice app connected.' : ''} Click to change.`, className: `voice-pill kernel-owned voice-ptt${goneCls}` };
  if (gone) return { state: 'noclient', label: 'Voice app not running', target: '', title: 'The Gnomon voice app is not connected. Start it to talk.', className: 'voice-pill kernel-owned voice-off voice-noclient' };
  return { state: 'off', label: 'Mic off', target: '', title: v.known ? 'Voice is off. Click to attach it to the focused session.' : 'This kernel reports no voice status.', className: 'voice-pill kernel-owned voice-off' };
}

/**
 * Aegis L (V2d): the pending card a voice.session.start returned is approved in the same gesture only when it IS the
 * voice-widen presence card for the same session (kind strictness, detail.op voice.widen). Anything else is left to
 * the human in the stack.
 */
export function isVoiceWidenCard(card: { kind: string; hsid: string | null; card: Record<string, unknown> } | undefined, hsid: string | null): boolean {
  if (!card || !hsid || card.kind !== 'strictness') return false;
  const d = obj(card.card.detail);
  if (!d || d.op !== 'voice.widen') return false;
  const cardHsid = str(d.hsid) ?? card.hsid;
  return cardHsid === hsid;
}

/**
 * The "decide the pending card in the stack" notice (T-2026-10-20-002) names one card; it clears once that card has
 * been seen in the store and is no longer pending (decided, expired, or swept by a kernel restart). A card the store has
 * not seen yet (the answer can beat its row) keeps the notice. Returns the next tracker and whether to clear the notice.
 */
export function cardNoticeStep(t: { cardId: string; seen: boolean } | null, pending: { has(cardId: string): boolean }): { next: { cardId: string; seen: boolean } | null; clear: boolean } {
  if (!t) return { next: null, clear: false };
  if (pending.has(t.cardId)) return { next: t.seen ? t : { cardId: t.cardId, seen: true }, clear: false };
  return t.seen ? { next: null, clear: true } : { next: t, clear: false };
}

const RANK: Readonly<Record<VoiceState, number>> = Object.freeze({ off: 0, ptt: 1, ambient: 2 });

export type VoicePlan = { kind: 'same' } | { kind: 'free' } | { kind: 'presence' } | { kind: 'blocked'; reason: string };

/** What choosing `to` for session `hsid` does: same, free (narrowing, PTT, re-target), Touch ID (first widening to ambient) or blocked. */
export function planVoice(v: VoiceView, to: VoiceState, hsid: string | null, presenceDone: boolean): VoicePlan {
  if (to !== 'off' && !hsid) return { kind: 'blocked', reason: 'no session focused' };
  if (RANK[to] > RANK[v.ceiling]) return { kind: 'blocked', reason: `voice ceiling ${v.ceiling === 'ambient' ? 'ambient' : v.ceiling === 'ptt' ? 'push-to-talk' : 'off'}` };
  if (to === v.state && (to === 'off' || v.hsid === hsid)) return { kind: 'same' };
  if (to === 'ambient' && !v.ambientConfirmed && !presenceDone) return { kind: 'presence' };
  return { kind: 'free' };
}

export type VoiceRequest = { kind: 'voice.session.start'; payload: { hsid: string; mode: 'ptt' | 'conversation'; continues?: string; send?: 'word' | 'pieces' } } | { kind: 'voice.session.end'; payload: { voiceSessionId?: string } };

/** The `log.append` params of a voice choice (null: Off with nothing attached). A switch on the same session continues its voice session. */
export function voiceRequest(v: VoiceView, to: VoiceState, hsid: string | null): VoiceRequest | null {
  if (to === 'off') return v.state === 'off' ? null : { kind: 'voice.session.end', payload: v.voiceSessionId ? { voiceSessionId: v.voiceSessionId } : {} };
  if (!hsid) return null;
  const cont = v.state !== 'off' && v.hsid === hsid && v.voiceSessionId ? { continues: v.voiceSessionId } : {};
  return { kind: 'voice.session.start', payload: { hsid, mode: WIRE_MODE[to], ...cont } };
}

export const VOICE_HELP: Readonly<Record<VoiceState, string>> = Object.freeze({
  off: 'the mic is closed; nothing is heard',
  ptt: 'hold the hotkey to talk; released, the mic is closed',
  ambient: 'the mic stays open; talk freely (turns off after idle)',
});
export const VOICE_TITLE: Readonly<Record<VoiceState, string>> = Object.freeze({ off: 'Off', ptt: 'Push-to-talk', ambient: 'Ambient' });

export interface VoiceMenuEntry {
  id: string;
  state: VoiceState | null;
  label: string;
  note: string;
  current: boolean;
  disabled: boolean;
}

/**
 * The pill menu: Off / Push-to-talk / Ambient for the attached session (or the focused one when nothing is
 * attached), plus "Attach to <focused>" when the focused session is another one. A non-human connection gets the
 * states shown, every one disabled (it may not attach).
 */
export function voiceMenuEntries(v: VoiceView, focused: string | null, attachable: boolean, presenceDone: boolean): VoiceMenuEntry[] {
  const target = v.state !== 'off' ? v.hsid : focused;
  const out: VoiceMenuEntry[] = VOICE_STATES.map((s) => {
    const p = planVoice(v, s, target, presenceDone);
    return {
      id: `voice.${s}`,
      state: s,
      label: VOICE_TITLE[s],
      note: !attachable ? 'only you, from this window, can attach voice' : p.kind === 'blocked' ? p.reason : p.kind === 'presence' ? `${VOICE_HELP[s]} · needs Touch ID` : VOICE_HELP[s],
      current: p.kind === 'same',
      disabled: !attachable || p.kind === 'blocked',
    };
  });
  if (attachable && focused && v.state !== 'off' && v.hsid !== focused) {
    out.push({ id: 'voice.attach', state: null, label: `Attach to ${sessionName(focused)}`, note: `moves ${VOICE_TITLE[v.state].toLowerCase()} to the focused session`, current: false, disabled: false });
  }
  return out;
}

/** Rows whose arrival changes status.voice (the page re-reads status on them; motion-on-events, no polling). */
export const VOICE_ROW_KINDS: ReadonlySet<string> = new Set(['voice.session.start', 'voice.session.end', 'voice.session.mode', 'daemon.start']);
/** Rows that mean the voice app heard or said something (the pill's level meter kicks on them). */
export const VOICE_ACTIVITY_KINDS: ReadonlySet<string> = new Set(['voice.turn.user', 'voice.turn.agent', 'voice.bargein']);

const IDLE_REASONS: ReadonlySet<string> = new Set(['idle', 'idle-timeout', 'idle-auto-off', 'ambient-idle']);

/** The quiet note for a voice.session.end the kernel's idle auto-off wrote, or null for any other end. */
export function idleNoteOf(kind: string, payload: unknown, defaultIdleMs: number | null = null): string | null {
  if (kind !== 'voice.session.end') return null;
  const p = obj(payload);
  if (!p || typeof p.reason !== 'string' || !IDLE_REASONS.has(p.reason)) return null;
  const mins = typeof p.idleMinutes === 'number' ? p.idleMinutes : typeof p.idleMs === 'number' ? Math.round(p.idleMs / 60_000) : defaultIdleMs !== null ? Math.round(defaultIdleMs / 60_000) : DEFAULT_IDLE_MINUTES;
  return `Ambient turned off after ${Math.max(1, mins)} min idle`;
}

/** `spk:<ns>/<name>` → name; `spk:unknown-3` → `unknown speaker 3`. */
export function speakerName(id: unknown): string {
  if (typeof id !== 'string') return 'voice';
  const u = /^spk:unknown-(\d{1,6})$/.exec(id);
  if (u) return `unknown speaker ${u[1]}`;
  const m = /^spk:[^/]*\/(.+)$/.exec(id);
  const name = (m ? m[1]! : id.replace(/^spk:/, '')).replace(/\s+/g, ' ').trim() || 'voice';
  return name.length > SPEAKER_MAX ? `${name.slice(0, SPEAKER_MAX - 1)}…` : name; // Aegis L: capped
}
/** The longest speaker name shown (Aegis L, V2d). */
export const SPEAKER_MAX = 32;

/**
 * A voice refusal as one plain line (V2a reasons): voice-off with data.cause aec | ceiling | presence, and the busy
 * voice-playback (Claude's reply is still streaming, or inside its echo tail). Null for any other refusal (the page shows it as given).
 */
export function voiceRefusalNote(reason: string | null, data: Record<string, unknown> | null): string | null {
  const cause = data && typeof data.cause === 'string' ? data.cause : null;
  if (reason === 'voice-off') {
    if (cause === 'aec') return 'Ambient needs echo cancellation in the voice app (voice-off · aec)';
    if (cause === 'ceiling') return 'this session\'s voice ceiling does not allow that (voice-off · ceiling)';
    if (cause === 'presence') return 'Ambient needs Touch ID first (voice-off · presence)';
    return 'voice is off for this session (voice-off)';
  }
  if (reason === 'voice-playback') return `Claude is still finishing its reply; try again when it is done (voice-playback${data?.streaming === true ? ' · streaming' : ''})`;
  return null;
}

/*
 * Stop speaking (T-2026-10-19-026). The voice app reports its spoken-reply edges (request.voice.report{playback})
 * and the kernel relays them as status.voice.playback{playing, at}; the human's ⏹ / Esc is one log.append
 * request.voice.client{op:'stop-speaking'} (core/voice-client.ts stopSpeakingRequest), which bumps
 * status.voice.stopSpeakingSeq for the voice app to act on. Stopping only narrows: no card, no presence.
 */
/** The status re-read while the voice app is speaking (the button hides within one tick of the end). */
export const SPEAK_POLL_MS = 300;
/** After a voice row arrives, how long the page re-reads status to SEE a reply start (reports are never logged). */
export const SPEAK_WATCH_MS = 4000;

/** The voice app is reading a reply aloud now (status.voice.playback.playing; anything else is "not playing"). */
export function playbackPlaying(status: unknown): boolean {
  return obj(obj(obj(status)?.voice)?.playback)?.playing === true;
}

/** The ⏹ shows only for a human connection, with the voice app connected and speaking. */
export function stopSpeakingShown(status: unknown): boolean {
  return canAttach(status) && voiceStatusOf(status).clientConnected === true && playbackPlaying(status);
}

/** The 300 ms re-read runs while speech plays, or within the watch window after a voice row (to see it start). */
export function speakPollWanted(status: unknown, watchUntil: number | null, now: number): boolean {
  // a crashed client's stale playing:true lingers for the report TTL: poll only while the client is connected (Aegis L1)
  const connected = (status as { voice?: { clientConnected?: unknown } } | null)?.voice?.clientConnected === true;
  return (connected && playbackPlaying(status)) || (watchUntil !== null && now < watchUntil);
}

/** Esc stops speaking only when ⏹ is shown and Esc has nothing nearer to do: no open menu or dialog, not typing in the composer. */
export function escStopsSpeaking(o: { shown: boolean; menuOpen: boolean; dialogOpen: boolean; inComposer: boolean }): boolean {
  return o.shown && !o.menuOpen && !o.dialogOpen && !o.inComposer;
}
