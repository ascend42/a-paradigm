/**
 * @symbol #gui-voice-ladder
 *
 * The voice trust ladder and the header pill (Atelier 2026-10-21-gnomon-voice, design-system gnomon.voice model +
 * pill; spec §11.4, §14.7). PURE.
 *
 * Voice is ONE choice: a ladder of rungs ordered by how much voice does on its own. Each rung maps onto the existing
 * machinery, the voice session state (core/voice.ts) and the send preset (core/voice-presets.ts):
 *
 *   Off        mic off             voice.session.end
 *   Talk       ptt × countdown     preset talk, attach ptt
 *   Dictate    open/toggle × key   preset dictate, attach conversation
 *   Send word  open/toggle × word  preset send-word, attach conversation + send word
 *   Pieces     open/toggle × pieces preset pieces, attach conversation + send pieces (Touch ID)
 *
 * The pill names the rung plus ONE live fact; it is kernel-owned (its state is status.voice, never the voice app's
 * claim). The rung shown while attached is the KERNEL's: status.voice.send ('key' | 'word' | 'pieces') wins over the
 * page's preset, so the pill never claims a send word the kernel did not attach.
 */
import { PIECE_CAP_MS, PIECE_GAP_MS, type SendWord, type VoicePreset } from '@a-company/gnomon-contracts';
import type { CaptureDisplay } from './capture.js';
import { refusalPhrase, type CaptureView } from './capture.js';
import type { VoiceState, VoiceView } from './voice.js';
import { ackedLine } from './voice-presets.js';
import { aecWords, deviceLine, type ClientView } from './voice-client.js';

export type Rung = 'off' | 'talk' | 'dictate' | 'word' | 'pieces';
export const RUNGS: readonly Rung[] = Object.freeze(['off', 'talk', 'dictate', 'word', 'pieces'] as const);

/** The rung's name on the ladder and in the pill (Off reads "Voice off" in the pill: never only a glyph). */
export const RUNG_NAME: Readonly<Record<Rung, string>> = Object.freeze({ off: 'Off', talk: 'Talk', dictate: 'Dictate', word: 'Send word', pieces: 'Pieces' });
export const PILL_NAME: Readonly<Record<Rung, string>> = Object.freeze({ ...RUNG_NAME, off: 'Voice off' });
/** What the rung does, in one line (its cost rides the line where it costs something). */
export const RUNG_LINE: Readonly<Record<Rung, string>> = Object.freeze({
  off: 'the mic is closed',
  talk: 'hold to speak; sends after release',
  dictate: 'open mic fills the box; you press Enter',
  word: 'say your word to send',
  pieces: 'each pause sends',
});

const PRESET_OF: Readonly<Record<Exclude<Rung, 'off'>, VoicePreset>> = Object.freeze({ talk: 'talk', dictate: 'dictate', word: 'send-word', pieces: 'pieces' });
/** The send preset a rung sets (Off keeps the last preset: the mic just closes). */
export const presetOfRung = (r: Rung): VoicePreset | null => (r === 'off' ? null : PRESET_OF[r]);
/** The voice session state a rung asks the kernel for. */
export const stateOfRung = (r: Rung): VoiceState => (r === 'off' ? 'off' : r === 'talk' ? 'ptt' : 'ambient');
/** The rung a palette command `voice.preset.<x>` names (off, talk, dictate, send-word, pieces), or null. */
export function rungOfPresetCommand(id: string): Rung | null {
  if (!id.startsWith('voice.preset.')) return null;
  const x = id.slice('voice.preset.'.length);
  return x === 'off' ? 'off' : x === 'talk' ? 'talk' : x === 'dictate' ? 'dictate' : x === 'send-word' ? 'word' : x === 'pieces' ? 'pieces' : null;
}
/** A voice state plus the send ceiling in the ladder's words (Off, Talk, Dictate, Send word, Pieces): never "ambient". */
export const rungNameOf = (state: VoiceState, send: 'word' | 'pieces' | 'key' | null): string =>
  state === 'off' ? 'Off' : state === 'ptt' ? 'Talk' : send === 'word' ? 'Send word' : send === 'pieces' ? 'Pieces' : 'Dictate';
/** The send ceiling a rung's attach carries (voice.session.start{send}); null is the kernel's default 'key'. */
export const sendOfRung = (r: Rung): 'word' | 'pieces' | null => (r === 'word' ? 'word' : r === 'pieces' ? 'pieces' : null);

/**
 * The rung in force. Detached: Off. Push-to-talk: Talk. Ambient: the kernel's send ceiling when it reports one
 * (status.voice.send), else the page's preset (an older kernel), never Talk (an ambient mic is at least Dictate).
 */
export function rungOf(v: Pick<VoiceView, 'state' | 'send'>, preset: VoicePreset): Rung {
  if (v.state === 'off') return 'off';
  if (v.state === 'ptt') return 'talk';
  if (v.send === 'word') return 'word';
  if (v.send === 'pieces') return 'pieces';
  if (v.send === 'key') return 'dictate';
  return preset === 'send-word' ? 'word' : preset === 'pieces' ? 'pieces' : 'dictate';
}

/** The Voice settings sheet's sections, in order (design-system gnomon.voice.setup). */
export type SheetSection = 'input' | 'voice' | 'sendword' | 'keys' | 'listen' | 'replies' | 'timing' | 'risk';
export const SHEET_SECTIONS: readonly SheetSection[] = Object.freeze(['input', 'voice', 'sendword', 'keys', 'listen', 'replies', 'timing', 'risk'] as const);

/* ── #voice-reply-mode (founder 2026-10-23: "just type back and not speak") ── */
/** 'speak' = Speak and show (the default); 'show' = Show only: replies are written, not played; voice input stays on. */
export type ReplyMode = 'speak' | 'show';
export const REPLY_MODE_NAME: Readonly<Record<ReplyMode, string>> = Object.freeze({ speak: 'Speak and show', show: 'Show only' });
/** The kernel's status.voice.replyMode (anything else, or an older kernel, reads as speak). */
export const replyModeOf = (status: unknown): ReplyMode => ((status as { voice?: { replyMode?: unknown } } | null)?.voice?.replyMode === 'show' ? 'show' : 'speak');
/** The request a reply-mode choice sends (the kernel persists it per kernel home, Aegis L3). */
export const replyModeRequest = (mode: ReplyMode): { kind: 'request.voice.client'; payload: { op: 'reply-mode'; mode: ReplyMode } } => ({ kind: 'request.voice.client', payload: { op: 'reply-mode', mode } });

export interface Readiness {
  /** the one-time liability acknowledgement (per user, this machine) */
  acked: boolean;
  sendWord: SendWord | null;
}

/**
 * Choosing a rung: ready → apply; else the sheet section that makes it ready. Send word without a word (or without
 * the acknowledgement, whose check sits right before the word's save) opens the send-word row; Pieces without the
 * acknowledgement opens the risk row. Pieces' Touch ID is the kernel's card at attach, not a setup step.
 */
export function chooseRung(r: Rung, o: Readiness): { kind: 'apply' } | { kind: 'setup'; section: SheetSection } {
  if (r === 'word' && !o.sendWord) return { kind: 'setup', section: 'sendword' };
  if ((r === 'word' || r === 'pieces') && !o.acked) return { kind: 'setup', section: r === 'word' ? 'sendword' : 'risk' };
  return { kind: 'apply' };
}

export interface RungEntry {
  rung: Rung;
  name: string;
  line: string;
  /** the right-hand tag: a key, a cost ('Touch ID') or a setup word ('set up'), or '' */
  tag: string;
  /** 'cost' and 'setup' tags are the amber tag; 'key' is plain */
  tagKind: 'key' | 'cost' | 'setup' | 'word' | null;
  current: boolean;
  /** not ready: choosing it opens the sheet at `needs` */
  needs: SheetSection | null;
  disabled: boolean;
  /** why it is disabled, in words (never only a tooltip) */
  why: string | null;
}

export interface LadderInput extends Readiness {
  rung: Rung;
  hotkey: string;
  /** a first-party human connection (only it may attach voice) */
  attachable: boolean;
  /** a session to attach to (focused or attached); without one only Off is offered */
  target: string | null;
  /** the kernel's hard cap on the loudest state */
  ceiling: VoiceState;
}

const RANK: Readonly<Record<VoiceState, number>> = Object.freeze({ off: 0, ptt: 1, ambient: 2 });

/** The ladder, top to bottom (Off first). */
export function ladderEntries(i: LadderInput): RungEntry[] {
  return RUNGS.map((r) => {
    const c = chooseRung(r, i);
    const needs = c.kind === 'setup' ? c.section : null;
    const st = stateOfRung(r);
    const why = !i.attachable ? 'only you, from this window, can attach voice' : r !== 'off' && !i.target ? 'open a session first' : RANK[st] > RANK[i.ceiling] ? `this session's voice ceiling is ${i.ceiling === 'ptt' ? 'Talk' : 'off'}` : null;
    let tag = '';
    let tagKind: RungEntry['tagKind'] = null;
    if (r === 'talk') [tag, tagKind] = [i.hotkey, 'key'];
    else if (r === 'word') [tag, tagKind] = needs ? ['set up', 'setup'] : [`“${i.sendWord!.text}”`, 'word'];
    else if (r === 'pieces') [tag, tagKind] = needs ? ['set up · Touch ID', 'setup'] : ['Touch ID', 'cost']; // Luna #5: the cost shows while not ready too
    return { rung: r, name: RUNG_NAME[r], line: RUNG_LINE[r], tag, tagKind, current: r === i.rung, needs, disabled: why !== null && !(r === 'off' && i.attachable), why: r === 'off' && i.attachable ? null : why };
  });
}

/**
 * Luna #6: which session a rung applies to. A rung goes to the FOCUSED session; when voice is on another one the
 * ladder says so ("applies to <B> · voice is on <A>"), and so does its accessible name. null when they agree.
 */
export function ladderTargetLine(focused: string | null, attached: string | null, name: (hsid: string) => string): string | null {
  return focused && attached && focused !== attached ? `applies to ${name(focused)} · voice is on ${name(attached)}` : null;
}
export const LADDER_ARIA = 'Voice: the trust ladder';
export const ladderAria = (target: string | null): string => (target ? `${LADDER_ARIA} · ${target}` : LADDER_ARIA);

/** The ladder's foot line: the mic key and how the open-mic rungs listen. */
export function ladderFoot(o: { micKeyBare: boolean; capture: 'open' | 'toggle' }): string {
  return `mic key ${micKeyName(o.micKeyBare)} · listen: ${o.capture === 'toggle' ? 'mic key' : 'always'}`;
}
export const micKeyName = (bare: boolean): string => (bare ? '`' : '⌃`');
/** The voice app's send-now key (shown as it is; the voice app owns it). */
export const SEND_NOW_KEY = '⌃⌥Return';

/* ── the header pill ───────────────────────────────────────────────── */

export interface PillInput {
  rung: Rung;
  hotkey: string;
  sendWord: string | null;
  attached: boolean;
  /** the attached session's short name, for the title only */
  target: string;
  clientConnected: boolean | null;
  /** the voice-app condition in words (core/voice-client.ts clientPillOf label or tail), or null */
  clientFact: string | null;
  /** Luna #7: a crash's cause (the voice app's own words), for the title and the accessible name only; never the fact */
  clientCause?: string | null;
  /** the voice-app condition's longer title (clientPillOf .title), appended to the pill's title */
  clientTitle?: string | null;
  /** the capture overlay (core/capture.ts captureDisplayOf) and the capture it shows, or null */
  capture: { display: CaptureDisplay; cap: Pick<CaptureView, 'reason' | 'refusal' | 'cause'> | null } | null;
  /** open-mic rungs under the mic key: the human closed the mic (status.voice.micWanted false) */
  micClosed: boolean;
  micKeyBare: boolean;
  /** seconds since the last heard turn on this page, or null */
  heardAgoS: number | null;
  /**
   * Board header-5b: a dictated draft waits on another session (core/dictation.ts dictationNote 'draft waiting'):
   * that session's short name, shown as the pill's fact ("draft waiting · billing"), never a loose header note
   */
  draftWaiting?: string | null;
  /** #voice-reply-mode (Mika Delta 10): Show only is named on the pill while a rung is on */
  replyMode?: ReplyMode;
}

export interface PillView {
  name: string;
  /** the one live fact ('' for none) */
  fact: string;
  /** the fact's colour: plain (secondary ink), note (warning ink: a draft waits elsewhere), fail (vermilion: speech was not sent) */
  tone: 'plain' | 'note' | 'fail';
  /** the mic is open: the dot is filled with its soft ring */
  live: boolean;
  /** the accessible name: the rung, the mic state and the fact in words */
  aria: string;
  title: string;
}

/** "heard Ns ago" shows for this long after a heard turn. */
export const HEARD_AGO_MAX_S = 60;

const DROP_FACT: Readonly<Record<string, string>> = Object.freeze({
  'too-short': 'too short to catch',
  echo: 'it overlapped my spoken reply',
  'barge-in': 'you talked over my reply',
  'no-words': 'heard sound, but no words',
  'not-enrolled': 'speaker not recognised',
  'not-attached': 'voice is not attached here',
  refused: 'the kernel refused it',
});

/** A drop's fact: "not sent · <the reason in words>" (the kernel's verdict when the voice app relayed one). */
export function dropFact(cap: Pick<CaptureView, 'reason' | 'refusal' | 'cause'>): string {
  if (cap.reason === 'refused' && cap.refusal) return `not sent · ${refusalPhrase(cap.refusal, cap.cause)}`;
  return `not sent · ${DROP_FACT[cap.reason ?? 'refused'] ?? 'the kernel refused it'}`;
}

/**
 * The pill: rung name + one live fact, first match wins:
 *   speech not sent (a sticky drop)     vermilion "not sent · <reason>"   (a mic-off drop is just "mic off · ⌃`")
 *   the voice app's condition            "voice app not running", "voice crashed" (its cause in the title and aria), "setting up voice…"
 *   a draft waits on another session     warning ink "draft waiting · <session>"
 *   capture                              "hearing you…", "catching that…", "got it", "heard, not confirmed"
 *   the mic key closed the mic           "mic off · ⌃`"
 *   a turn heard lately (not Send word)  "heard 4s ago"
 *   at rest                              Talk "hold ⌃⌥Space" · Dictate/Pieces "listening" · Send word "say “send”"
 * TD-2026-10-23-939: no "edits ask first" fact or amber edge (a voice-sent turn runs like a typed one).
 */
export function voicePillOf(i: PillInput): PillView {
  const name = PILL_NAME[i.rung];
  const live = i.attached && i.clientConnected !== false && ((stateOfRung(i.rung) === 'ambient' && !i.micClosed) || i.capture?.display.state === 'hearing');
  // Show only: replies are written, not played. Said in the accessible name and the title whenever a rung is on, and
  // on the pill itself beside the resting fact (rest()); a passing state (hearing, a drop) keeps the room for itself.
  const showOnly = i.replyMode === 'show' && i.rung !== 'off';
  const mk = (fact: string, tone: PillView['tone'] = 'plain'): PillView => {
    const mic = live ? 'mic open' : 'mic closed';
    const cause = fact === i.clientFact && i.clientCause ? i.clientCause : null;
    const title = `Voice: ${name}${i.target ? ` on ${i.target}` : ''} (${mic}).${showOnly ? ' Replies: show only (written, not spoken).' : ''} Kernel-owned: it shows what the kernel says. Click for the ladder.`;
    const aria = `Voice: ${name}, ${mic}${fact && fact !== 'show only' ? `, ${fact.replace(/^show only · /, '')}` : showOnly && live ? ', listening' : ''}${cause ? ` (${cause})` : ''}${showOnly ? ', replies shown only, not spoken' : ''}`;
    return { name, fact, tone, live, aria, title: i.clientTitle ? `${title} ${i.clientTitle}` : title };
  };
  // "show only" leads (a narrow header cuts the tail, never the mode); "listening" is the filled dot's, so it gives way
  const rest = (fact: string): PillView => mk(!showOnly ? fact : fact === 'listening' ? 'show only' : `show only · ${fact}`);
  const d = i.capture?.display;
  if (d && d.state === 'dropped' && i.capture?.cap) {
    if (i.capture.cap.reason === 'mic-off') return mk(`mic off · ${micKeyName(i.micKeyBare)}`);
    return mk(dropFact(i.capture.cap), 'fail');
  }
  if (i.clientFact) return mk(i.clientFact);
  if (i.draftWaiting) return mk(`draft waiting · ${i.draftWaiting}`, 'note');
  if (d && d.label !== null) {
    if (d.state === 'hearing') return mk('hearing you…');
    if (d.state === 'transcribing') return mk('catching that…');
    if (d.state === 'captured') return mk(d.className === 'capture-dropped' ? 'heard, not confirmed: check the transcript' : 'got it');
  }
  if (i.rung === 'off') return mk('');
  if (i.micClosed && stateOfRung(i.rung) === 'ambient') return mk(`mic off · ${micKeyName(i.micKeyBare)}`);
  if (i.rung !== 'word' && i.heardAgoS !== null && i.heardAgoS >= 0 && i.heardAgoS <= HEARD_AGO_MAX_S) return mk(`heard ${Math.max(1, Math.round(i.heardAgoS))}s ago`);
  if (i.rung === 'talk') return rest(`hold ${i.hotkey}`);
  if (i.rung === 'word') return rest(i.sendWord ? `say “${i.sendWord}”` : 'set up a send word');
  return rest('listening');
}

/**
 * clientPillOf's words as one lowercase fact ("Voice app not running" → "voice app not running"; " · x" → "x"). A
 * crash is just "voice crashed" (Luna #7): its cause goes into the title and the accessible name (crashCauseOf).
 */
export function clientFactOf(label: string | null, tail: string | null): string | null {
  const s = label ?? (tail ? tail.replace(/^\s*·\s*/, '') : null);
  if (!s) return null;
  const f = s.charAt(0).toLowerCase() + s.slice(1);
  return /^voice crashed\b/.test(f) ? 'voice crashed' : f;
}
/** A crashed voice app's cause in one line (the voice app's own sanitised words), or null. */
export function crashCauseOf(c: { phase: string; lastError: string | null }, line: (s: string) => string): string | null {
  return c.phase === 'crashed' && c.lastError ? line(c.lastError) : null;
}

/* ── the Voice settings sheet rows ─────────────────────────────────── */

export interface SheetRowView {
  id: SheetSection;
  label: string;
  value: string;
  tone: 'ok' | 'warn' | 'plain';
  /** the row's link, or null */
  action: { label: string; act: string } | null;
}

export interface SheetInput extends Readiness {
  enrolled: string[] | null;
  /** every enrolled print predates the voice check (core/voice-client.ts enrolNudgeOf 'reteach') */
  reteach: boolean;
  micKeyBare: boolean;
  capture: 'open' | 'toggle';
  delayMs: number | null;
  hotkey: string;
  attachable: boolean;
  /** when the acknowledgement was recorded (ISO), for "acknowledged · today"; null/absent = unknown */
  ackedAt?: string | null;
  now?: Date;
  /** founder request 2026-10-23: the voice app's mic (core/voice-client.ts clientOf); absent = no input row */
  client?: ClientView | null;
  /** #voice-reply-mode: the kernel's reply mode (absent = speak) */
  replyMode?: ReplyMode;
}

/**
 * Founder request 2026-10-23 ("a clear input selection inside gnomon"): the sheet's first row says which mic is in use,
 * how (transport, rate, echo cancelling), and when it is not the one chosen or has stopped. Its flow is the picker.
 */
export function inputRow(c: ClientView | null | undefined, attachable: boolean): SheetRowView | null {
  if (!c || !c.known) return null;
  const change = attachable && c.mic.known ? { label: 'change', act: 'input' } : null;
  if (c.micFault) return { id: 'input', label: 'input', value: `mic stopped · ${c.micFault.text}`, tone: 'warn', action: change };
  const d = c.micDevice;
  if (c.mic.missing) return { id: 'input', label: 'input', value: `${c.mic.chosenName ?? 'the chosen mic'} is not connected${d ? ` · using ${deviceLine(d)}` : ''}`, tone: 'warn', action: change };
  if (!d) return { id: 'input', label: 'input', value: c.phase === 'running' ? 'the voice app has not said which mic it uses' : 'voice is not running', tone: 'plain', action: change };
  const aec = aecWords(c.mic.aec);
  const how = c.mic.chosen === null ? 'system default' : 'chosen';
  return { id: 'input', label: 'input', value: `${deviceLine(d)}${aec ? ` · ${aec}` : ''} · ${how}${c.mic.on === false ? ' · mic off' : ''}`, tone: c.mic.on === false ? 'plain' : 'ok', action: change };
}

/**
 * The picker's choices: follow the system default, then every connected input, then a chosen one that is missing.
 * Mika 2026-10-23: drawn as the folder field's choice rows (name over detail, ✓, a right tag), so each carries its
 * name, its detail line and whether it is the input in use now (matched by name: the voice app reports the device in
 * use without its id). `label` is the whole line (the accessible name).
 */
export interface InputChoiceView {
  /** the device id, or '' for the system default */
  id: string;
  label: string;
  name: string;
  /** "bluetooth · 24 kHz", "follows macOS", "not connected", or '' */
  detail: string;
  checked: boolean;
  /** the input the mic is on right now */
  inUse: boolean;
}
export function inputChoices(c: ClientView): InputChoiceView[] {
  const using = c.micFault ? null : c.micDevice?.name ?? null;
  const out: InputChoiceView[] = [{ id: '', label: 'system default (follows macOS)', name: 'system default', detail: 'follows macOS', checked: c.mic.chosen === null, inUse: false }];
  for (const d of c.mic.inputs) {
    const detail = [d.transport, d.sampleRate ? `${Math.round(d.sampleRate / 100) / 10} kHz` : null].filter((x): x is string => !!x).join(' · ');
    out.push({ id: d.id, label: deviceLine(d), name: d.name, detail, checked: c.mic.chosen === d.id, inUse: using !== null && d.name === using });
  }
  if (c.mic.chosen !== null && !c.mic.inputs.some((d) => d.id === c.mic.chosen)) out.push({ id: c.mic.chosen, label: `${c.mic.chosenName ?? 'the chosen mic'} · not connected`, name: c.mic.chosenName ?? 'the chosen mic', detail: 'not connected', checked: true, inUse: false });
  return out;
}

const secs = (ms: number): string => `${Math.round(ms / 100) / 10} s`;
/** The pieces timing line (the gap that sends a piece and the cap), from the contracts' constants. */
export const PIECES_TIMING = `pieces pause ${secs(PIECE_GAP_MS)}, up to ${secs(PIECE_CAP_MS)}`;

/** The sheet's rows: input (when the voice app reports its mic), then the six (their inline flows are painted under them by ui/voice-settings.ts). */
export function sheetRows(i: SheetInput): SheetRowView[] {
  const variants = i.sendWord?.variants.length ?? 0;
  const voice: SheetRowView =
    i.enrolled === null
      ? { id: 'voice', label: 'your voice', value: 'this kernel does not list voices', tone: 'plain', action: null }
      : i.enrolled.length === 0
        ? { id: 'voice', label: 'your voice', value: 'not taught · no speech is sent until it is', tone: 'warn', action: i.attachable ? { label: 'teach', act: 'enrol' } : null }
        : i.reteach
          ? { id: 'voice', label: 'your voice', value: 'the voice check was upgraded · teach it again', tone: 'warn', action: i.attachable ? { label: 'retrain', act: 'enrol' } : null }
          : { id: 'voice', label: 'your voice', value: `taught · ${i.enrolled.join(', ')}`, tone: 'ok', action: i.attachable ? { label: 'retrain', act: 'enrol' } : null };
  const input = inputRow(i.client, i.attachable);
  return [
    ...(input ? [input] : []),
    voice,
    i.sendWord
      ? { id: 'sendword', label: 'send word', value: `“${i.sendWord.text}”${variants ? ` · ${variants} variant${variants === 1 ? '' : 's'}` : ''}`, tone: 'ok', action: i.attachable ? { label: 'change', act: 'sendword' } : null }
      : { id: 'sendword', label: 'send word', value: 'not set', tone: 'warn', action: i.attachable ? { label: 'set up', act: 'sendword' } : null },
    // a bare ` mic key is a warn (board gnomon-notices): while voice runs, ` types in no app; the row says so, not only the toast
    { id: 'keys', label: 'keys', value: `talk ${i.hotkey} · mic ${micKeyName(i.micKeyBare)} · send now ${SEND_NOW_KEY}${i.micKeyBare ? ' · while voice runs, ` types in no app' : ''}`, tone: i.micKeyBare ? 'warn' : 'plain', action: i.attachable ? { label: 'change', act: 'keys' } : null },
    { id: 'listen', label: 'listen', value: i.capture === 'toggle' ? `the mic key turns it on and off (${micKeyName(i.micKeyBare)})` : 'always on (open-mic rungs)', tone: 'plain', action: i.attachable ? { label: i.capture === 'toggle' ? 'keep always on' : 'use mic key', act: i.capture === 'toggle' ? 'listen.open' : 'listen.toggle' } : null },
    // #voice-reply-mode: the arrangement (spoken part, body, choices, slips) stays either way; only playback is off
    i.replyMode === 'show'
      ? { id: 'replies', label: 'replies', value: 'shown only · not spoken · voice input stays on', tone: 'plain', action: i.attachable ? { label: 'speak and show', act: 'reply.speak' } : null }
      : { id: 'replies', label: 'replies', value: 'spoken and shown', tone: 'plain', action: i.attachable ? { label: 'show only', act: 'reply.show' } : null },
    { id: 'timing', label: 'timing', value: `talk sends after ${i.delayMs === null ? 'you press Enter' : secs(i.delayMs)} · ${PIECES_TIMING}`, tone: 'plain', action: null },
    { id: 'risk', label: 'risk', value: i.acked ? ackedLine(i.ackedAt ?? null, i.now) : 'not acknowledged', tone: i.acked ? 'ok' : 'warn', action: i.acked || !i.attachable ? null : { label: 'review', act: 'risk' } },
  ];
}
