/**
 * @symbol #gui
 *
 * #gui voice controls (voice slice V2d, TD-2026-10-19-298; spec §11.4 header, §14.7 attachment). PURE.
 *
 *   - Three states: Mic off, push-to-talk (`ptt`), ambient (`conversation` on the wire). The header pill is
 *     KERNEL-OWNED: its state comes only from `status.voice` (re-read when a voice.session.* row arrives), never
 *     from the voice client's own claims. `voiceStatusOf` is the one adapter over the status shape (V1:
 *     `{attached: {voiceSessionId, hsid, mode, turns} | null}`; V2a: `{attached: true, hsid, mode, ceiling, since,
 *     idleAt}` or the nested form with those fields). Unknown values fail toward the LOUDER indicator: an attached
 *     session whose mode is not `ptt` reads as ambient (the pill never under-reports a live mic).
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
  /** the loudest state the kernel allows here (`ambient` when it does not say) */
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
}

const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);
const stateOfMode = (m: unknown): VoiceState => (m === 'ptt' ? 'ptt' : 'ambient');
const ceilingOf = (c: unknown): VoiceState => (c === 'off' || c === 'none' ? 'off' : c === 'ptt' ? 'ptt' : 'ambient');

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
  else if (Array.isArray(s?.clients)) clientConnected = (s.clients as unknown[]).some((c) => {
    const o = obj(c);
    return !!o && (o.principalKind === 'voice' || o.surface === 'voice' || (typeof o.principal === 'string' && o.principal.startsWith('voice:')));
  });
  const level = a && typeof a.level === 'number' ? a.level : v && typeof v.level === 'number' ? v.level : null;
  return {
    known: v !== null,
    state: attached ? stateOfMode(a!.mode) : 'off',
    hsid: attached ? hsid : null,
    voiceSessionId: attached ? str(a!.voiceSessionId) : null,
    ceiling: ceilingOf(a?.ceiling ?? v?.ceiling),
    since: attached ? str(a!.since) : null,
    idleAt: attached ? str(a!.idleAt) : null,
    clientConnected,
    ambientConfirmed: v?.ambientConfirmed === true || v?.presence === 'fresh' || obj(v?.presence)?.ambient === true,
    hotkey: str(v?.hotkey) ?? DEFAULT_PTT_HOTKEY,
    level: level === null ? null : Math.max(0, Math.min(1, level)),
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

/** The header pill: grey Mic off, blue hold-to-talk, red pulsing Listening; the voice app missing says so. */
export function pillOf(v: VoiceView): Pill {
  const target = v.hsid ? sessionName(v.hsid) : '';
  if (v.clientConnected === false) {
    return { state: 'noclient', label: 'Voice app not running', target, title: `The Gnomon voice app is not connected${target ? ` (voice is still attached to ${target})` : ''}. Start it to talk.`, className: 'voice-pill kernel-owned voice-noclient' };
  }
  if (v.state === 'ambient') return { state: 'ambient', label: 'Listening', target, title: `Ambient: the mic is open for ${target}. Click to switch to push-to-talk or off.`, className: 'voice-pill kernel-owned voice-ambient' };
  if (v.state === 'ptt') return { state: 'ptt', label: `Hold ${v.hotkey} to talk`, target, title: `Push-to-talk to ${target}. Click to change.`, className: 'voice-pill kernel-owned voice-ptt' };
  return { state: 'off', label: 'Mic off', target: '', title: v.known ? 'Voice is off. Click to attach it to the focused session.' : 'This kernel reports no voice status.', className: 'voice-pill kernel-owned voice-off' };
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

export type VoiceRequest = { kind: 'voice.session.start'; payload: { hsid: string; mode: 'ptt' | 'conversation'; continues?: string } } | { kind: 'voice.session.end'; payload: { voiceSessionId?: string } };

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
export const VOICE_ACTIVITY_KINDS: ReadonlySet<string> = new Set(['voice.turn.user', 'voice.turn.partial', 'voice.turn.agent', 'voice.bargein']);

const IDLE_REASONS: ReadonlySet<string> = new Set(['idle', 'idle-timeout', 'idle-auto-off', 'ambient-idle']);

/** The quiet note for a voice.session.end the kernel's idle auto-off wrote, or null for any other end. */
export function idleNoteOf(kind: string, payload: unknown): string | null {
  if (kind !== 'voice.session.end') return null;
  const p = obj(payload);
  if (!p || typeof p.reason !== 'string' || !IDLE_REASONS.has(p.reason)) return null;
  const mins = typeof p.idleMinutes === 'number' ? p.idleMinutes : typeof p.idleMs === 'number' ? Math.round(p.idleMs / 60_000) : DEFAULT_IDLE_MINUTES;
  return `Ambient turned off after ${Math.max(1, mins)} min idle`;
}

/** `spk:<ns>/<name>` → name; `spk:unknown-3` → `unknown speaker 3`. */
export function speakerName(id: unknown): string {
  if (typeof id !== 'string') return 'voice';
  const u = /^spk:unknown-(\d+)$/.exec(id);
  if (u) return `unknown speaker ${u[1]}`;
  const m = /^spk:[^/]*\/(.+)$/.exec(id);
  return m ? m[1]! : id.replace(/^spk:/, '') || 'voice';
}
