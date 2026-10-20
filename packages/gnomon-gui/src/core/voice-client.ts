/**
 * @symbol #gui
 *
 * #gui voice-app lifecycle, enrolment and notices (voice slice V2e GUI, T-2026-10-19-026). PURE.
 *
 * The founder's rule for V2e is SEAMLESS: no terminal step. The GUI starts and stops the voice app, shows its setup
 * phases, teaches Gnomon a voice, and shows the app's quiet notices. Everything here is a thin ADAPTER over a kernel
 * contract that was built in parallel; every shape assumption lives in this file (see ASSUMPTIONS below).
 *
 *   - `clientOf(status)` reads `status.voice.clientConnected` and `status.voice.client = {phase: idle | installing |
 *     downloading | starting | running | crashed | unavailable, downloadMb?: {n, of}, devUnsigned?, lastError?,
 *     unavailable?}` plus the enrolled voices (`status.voice.enrolled`, see ASSUMPTIONS). Unknown phases fail toward
 *     "not running" (the human is offered Start, never told a dead app is listening).
 *   - The human's gestures are `log.append` rows: `request.voice.client{op: 'start' | 'stop'}`,
 *     `request.voice.enrol{name, consent}` (the kernel raises a fresh-presence Touch ID card whose effect writes the
 *     root-signed enrolment row), and `request.voice.forget{name}` (no card).
 *   - The pill (core/voice.ts pillOf) is kernel-owned; `clientPillOf` only overrides it while NOTHING is attached (an
 *     attached live mic always keeps its louder state: never under-report).
 *   - Only a human-class connection gets any of these controls (`canAttach`); a voice connection never does.
 *
 * THE CONTRACT (the kernel's final V2e shapes, formerly "assumptions"; adjust here only):
 *   A1 enrolled voices: `status.voice.enrolled` (sorted names). Absent ⇒ unknown (no "teach your voice" nudge).
 *   A2 forget: `request.voice.forget{name}` → {forgotten: true, speakerId}; NO card (a forget narrows).
 *   A3 enrolment: the Touch ID card comes FIRST. `request.voice.enrol{name, consent}` → {pending: true, cardId}; the
 *      human allows the strictness card (detail.op 'voice.enrol'); its effect writes the root-signed enrolment row
 *      and sets `status.voice.enrolment = {name, phase: 'requested', at}`. The voice app then records the phrases
 *      and relays `ready | recording | recorded | done | failed | cancelled` (`phrase` 0-based, `of`, `error?`) into
 *      the same status field. The GUI re-reads status on the relevant rows and polls lightly while the dialog waits.
 *      The report carries no phrase text: ENROL_PHRASES below is the client's list (gnomon-voice enrol.ts; a
 *      gnomon-voice test pins the two equal).
 *   A4 the request.voice.enrol answer is `{pending: true, cardId}`; without one the GUI looks for a pending card
 *      whose detail.op is `voice.enrol` and offers to focus it.
 *   A5 notices: `status.voice.notice = {text, code?, at} | null` (relayed by the voice app, never a log row); a new
 *      `at` becomes a quiet toast, never a decision.
 *   A6 lifecycle rows: `voice.client.*`, `voice.enrol` and `voice.forget` rows change status.voice (the page
 *      re-reads status on them).
 */

export type ClientPhase = 'idle' | 'installing' | 'downloading' | 'starting' | 'running' | 'crashed' | 'unavailable';
export const CLIENT_PHASES: readonly ClientPhase[] = Object.freeze(['idle', 'installing', 'downloading', 'starting', 'running', 'crashed', 'unavailable'] as const);

export interface ClientView {
  /** the kernel reports the voice app's lifecycle at all */
  known: boolean;
  phase: ClientPhase;
  download: { n: number; of: number } | null;
  /** the kernel's download size (MB) when it reports a total only */
  downloadTotal: number | null;
  devUnsigned: boolean;
  lastError: string | null;
  unavailable: string | null;
  /** enrolled voice names, or null when the kernel does not say (A1) */
  enrolled: string[] | null;
}

const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null);

/** `spk:<ns>/<name>` or a plain name → the name. */
const nameOf = (v: unknown): string | null => {
  const o = obj(v);
  const s = o ? (str(o.name) ?? str(o.speakerId)) : str(v);
  if (!s) return null;
  const m = /^spk:[^/]*\/(.+)$/.exec(s);
  return m ? m[1]! : s;
};

/**
 * The kernel's status.voice.client.phase words (voice-child.ts VoiceChildPhase) → the GUI's. backoff is a crash
 * awaiting its restart; failed is a crash the human restarts (or unavailable, when the kernel names a reason).
 */
const KERNEL_PHASE: Readonly<Record<string, ClientPhase>> = Object.freeze({
  stopped: 'idle',
  preparing: 'installing',
  installing: 'installing',
  'downloading-models': 'downloading',
  starting: 'starting',
  running: 'running',
  backoff: 'crashed',
  failed: 'crashed',
  unavailable: 'unavailable',
});

/** The voice-app view from a `status` result (the adapter: every client-status assumption lives here). */
export function clientOf(status: unknown): ClientView {
  const v = obj(obj(status)?.voice);
  const c = obj(v?.client);
  const connected = v && typeof v.clientConnected === 'boolean' ? v.clientConnected : null;
  const raw = str(c?.phase);
  let phase: ClientPhase = raw && (CLIENT_PHASES as readonly string[]).includes(raw) ? (raw as ClientPhase) : raw && raw in KERNEL_PHASE ? KERNEL_PHASE[raw]! : 'idle';
  if (phase !== 'unavailable' && str(c?.unavailable) && (raw === 'failed' || raw === 'unavailable')) phase = 'unavailable';
  // the kernel's connection word wins over a stale phase: connected ⇒ running; a "running" claim while not connected ⇒ not running
  if (connected === true && (phase === 'idle' || phase === 'starting')) phase = 'running';
  if (connected === false && phase === 'running') phase = 'idle';
  // the kernel reports the download as its total (an integer MB); {n, of} is also understood
  const d = obj(c?.downloadMb);
  const total = num(c?.downloadMb);
  const n = num(d?.n);
  const of = num(d?.of);
  const list = Array.isArray(v?.enrolled) ? v!.enrolled : null;
  return {
    known: c !== null || connected !== null,
    phase,
    download: n !== null && of !== null && of > 0 ? { n: Math.min(n, of), of } : null,
    downloadTotal: total !== null && total > 0 ? total : null,
    devUnsigned: c?.devUnsigned === true,
    lastError: str(c?.lastError),
    unavailable: str(c?.unavailable),
    enrolled: list ? [...new Set(list.map(nameOf).filter((x): x is string => x !== null))] : null,
  };
}

/** The voice app is up (or coming up): Stop is offered, Start is not. */
export const clientBusy = (c: ClientView): boolean => c.phase === 'installing' || c.phase === 'downloading' || c.phase === 'starting' || c.phase === 'running';
/** Attach / Ambient while this holds starts the voice app in the same gesture. */
export const needsStart = (c: ClientView): boolean => c.known && (c.phase === 'idle' || c.phase === 'crashed');

export type PillAction = 'start' | 'restart' | 'enrol' | null;
export interface ClientPill {
  /** null: keep core/voice.ts pillOf as it is */
  label: string | null;
  className: string;
  title: string;
  action: PillAction;
  actionLabel: string;
  /** 0..1 while downloading, else null */
  progress: number | null;
}

const MB = (x: number): string => (x >= 100 ? String(Math.round(x)) : String(Math.round(x * 10) / 10));

/**
 * The pill's voice-app overlay while NOTHING is attached (attached: the live state always wins). The phases:
 * "Voice app not running" [Start voice] · "Setting up voice…" · "Downloading voice models · N of M MB" (bar) ·
 * "Starting…" · "Voice crashed · Restart" · "Voice unavailable · <why>" · running with no enrolled voice:
 * "Teach Gnomon your voice first" (unenrolled speech is never forwarded).
 */
export function clientPillOf(c: ClientView, attached: boolean, attachable: boolean): ClientPill {
  const none: ClientPill = { label: null, className: '', title: '', action: null, actionLabel: '', progress: null };
  if (attached || !c.known) return none;
  const act = (a: PillAction): PillAction => (attachable ? a : null);
  switch (c.phase) {
    case 'idle':
      return { label: 'Voice app not running', className: 'voice-noclient', title: 'The Gnomon voice app is not running. Start it here; no terminal needed.', action: act('start'), actionLabel: 'Start voice', progress: null };
    case 'installing':
      return { label: 'Setting up voice…', className: 'voice-noclient voice-setup', title: 'Gnomon is setting up the voice app.', action: null, actionLabel: '', progress: null };
    case 'downloading': {
      const d = c.download;
      return { label: d ? `Downloading voice models · ${MB(d.n)} of ${MB(d.of)} MB` : c.downloadTotal ? `Downloading voice models (${MB(c.downloadTotal)} MB)…` : 'Downloading voice models…', className: 'voice-noclient voice-setup', title: 'The voice models download once, then stay on this Mac.', action: null, actionLabel: '', progress: d ? d.n / d.of : null };
    }
    case 'starting':
      return { label: 'Starting…', className: 'voice-noclient voice-setup', title: 'The voice app is starting.', action: null, actionLabel: '', progress: null };
    case 'crashed':
      return { label: 'Voice crashed', className: 'voice-noclient voice-crashed', title: c.lastError ? `The voice app stopped: ${c.lastError}` : 'The voice app stopped unexpectedly.', action: act('restart'), actionLabel: 'Restart', progress: null };
    case 'unavailable':
      return { label: `Voice unavailable${c.unavailable ? ` · ${c.unavailable}` : ''}`, className: 'voice-noclient voice-unavailable', title: c.unavailable ?? 'Voice is not available on this machine.', action: null, actionLabel: '', progress: null };
    case 'running':
      if (c.enrolled !== null && c.enrolled.length === 0)
        return { label: 'Teach Gnomon your voice first', className: 'voice-off voice-nudge', title: 'Gnomon only forwards speech from an enrolled voice. Teach it yours (about a minute).', action: act('enrol'), actionLabel: 'Teach', progress: null };
      return none;
  }
}

export interface ClientMenuEntry {
  id: 'voice.client.start' | 'voice.client.stop' | 'voice.enrol';
  label: string;
  note: string;
}

/** The pill menu's voice-app items (human connections only; a voice connection gets none). */
export function clientMenuEntries(c: ClientView, attachable: boolean): ClientMenuEntry[] {
  if (!attachable || !c.known) return [];
  const out: ClientMenuEntry[] = [];
  if (clientBusy(c)) out.push({ id: 'voice.client.stop', label: 'Stop voice', note: 'quit the voice app; the mic closes' });
  else if (c.phase !== 'unavailable') out.push({ id: 'voice.client.start', label: c.phase === 'crashed' ? 'Restart voice' : 'Start voice', note: 'start the voice app' });
  out.push({ id: 'voice.enrol', label: 'Teach Gnomon your voice…', note: c.enrolled && c.enrolled.length ? `enrolled: ${c.enrolled.join(', ')}` : 'only enrolled voices are heard' });
  return out;
}

export type ClientRequest =
  | { kind: 'request.voice.client'; payload: { op: 'start' | 'stop' } }
  | { kind: 'request.voice.enrol'; payload: { name: string; consent: string } }
  | { kind: 'request.voice.forget'; payload: { name: string } };

export const clientRequest = (op: 'start' | 'stop'): ClientRequest => ({ kind: 'request.voice.client', payload: { op } });

/** The kernel's speaker-name rule (kernel/voice/enrolment.ts NAME): lowercase, ≤ 64. */
export const VOICE_NAME = /^[a-z0-9][a-z0-9._-]{0,63}$/;
/** "Matt C." → "matt-c." (the form shows the normalized name before sending). */
export const normalizeVoiceName = (s: string): string => s.trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9._-]/g, '').slice(0, 64);

/** The plain-language consent the human agrees to (recorded with the enrolment, §14.4). */
export function consentText(name: string): string {
  return `I, ${name}, agree that Gnomon may record three short phrases of my voice on this Mac and keep a voiceprint so it can recognise me. The voiceprint stays on this Mac, is never uploaded, and I can forget it at any time from this window.`;
}

export function enrolRequest(rawName: string, agreed: boolean): { ok: true; req: ClientRequest } | { ok: false; reason: string } {
  const name = normalizeVoiceName(rawName);
  if (!VOICE_NAME.test(name)) return { ok: false, reason: 'a name is letters, digits, dot, dash or underscore' };
  if (!agreed) return { ok: false, reason: 'tick the consent box to continue' };
  return { ok: true, req: { kind: 'request.voice.enrol', payload: { name, consent: consentText(name) } } };
}

/** A2: forget is its own request (no card). */
export const forgetRequest = (name: string): ClientRequest => ({ kind: 'request.voice.forget', payload: { name } });

/** The three phrases the voice app records (A3; the same list as gnomon-voice enrol.ts ENROL_PHRASES). */
export const ENROL_PHRASES: readonly string[] = Object.freeze([
  'The quick brown fox jumps over the lazy dog.',
  'Gnomon, please run the tests and tell me what failed.',
  'I enrol my voice on this computer, and it stays here.',
]);

/** form → confirm (the Touch ID card) → waiting (the voice app) → phrase … → done | failed */
export type EnrolStep = 'form' | 'confirm' | 'waiting' | 'phrase' | 'done' | 'failed';
export interface EnrolState {
  step: EnrolStep;
  name: string | null;
  /** the Touch ID card the request raised (A4) */
  cardId: string | null;
  phrases: readonly string[];
  /** the phrase being read (0-based) */
  index: number;
  recording: boolean;
  /** phrases recorded so far */
  recorded: number;
  error: string | null;
  /** when the card was allowed (ms): an enrolment report stamped before it is a previous attempt's */
  since: number | null;
}

export const enrolStart = (): EnrolState => ({ step: 'form', name: null, cardId: null, phrases: ENROL_PHRASES, index: 0, recording: false, recorded: 0, error: null, since: null });

/** The request was accepted: the Touch ID card is next (A3/A4). */
export function enrolSent(s: EnrolState, name: string, cardId: string | null): EnrolState {
  return { ...s, step: 'confirm', name, cardId, index: 0, recorded: 0, recording: false, error: null, since: null };
}

/** The card was allowed: the voice app records next. */
export function enrolAllowed(s: EnrolState, now: number): EnrolState {
  return { ...s, step: 'waiting', since: now, error: null };
}

/** Clock slack between the page and the kernel's `at` stamp (same Mac; generous). */
const AT_SLACK_MS = 5000;

/**
 * Fold `status.voice.enrolment` into the flow (A3). Only after the card was allowed; a report for another name, or
 * stamped before the allow (a previous attempt), changes nothing. Returns `s` itself when nothing changed.
 */
export function reduceEnrolStatus(s: EnrolState, status: unknown): EnrolState {
  if (s.step !== 'waiting' && s.step !== 'phrase') return s;
  if (!s.name || s.since === null) return s;
  const e = obj(obj(obj(status)?.voice)?.enrolment);
  if (!e || str(e.name) !== s.name) return s;
  const at = Date.parse(str(e.at) ?? '');
  if (Number.isFinite(at) && at < s.since - AT_SLACK_MS) return s;
  const of = num(e.of) ?? s.phrases.length;
  const idx = num(e.phrase);
  const here = idx !== null ? Math.min(idx, Math.max(0, of - 1)) : s.index;
  let next: EnrolState;
  switch (str(e.phase)) {
    case 'requested':
      next = { ...s, step: 'waiting', recording: false };
      break;
    case 'ready':
      next = { ...s, step: 'phrase', index: here, recording: false };
      break;
    case 'recording':
      next = { ...s, step: 'phrase', index: here, recording: true };
      break;
    case 'recorded': {
      const recorded = Math.max(s.recorded, (idx ?? s.index) + 1);
      next = { ...s, step: 'phrase', index: Math.min(recorded, of - 1), recorded, recording: false };
      break;
    }
    case 'done': {
      // Aegis L3: "done" only when the kernel's root-signed registry lists the name (status.voice.enrolled)
      const listed = Array.isArray(obj(obj(status)?.voice)?.enrolled) && (obj(obj(status)?.voice)!.enrolled as unknown[]).map(nameOf).includes(s.name);
      next = listed ? { ...s, step: 'done', recorded: of, recording: false, error: null } : { ...s, step: 'phrase', index: Math.max(0, of - 1), recorded: of, recording: false };
      break;
    }
    case 'failed':
    case 'cancelled':
      next = { ...s, step: 'failed', recording: false, error: str(e.error) ?? (e.phase === 'cancelled' ? 'the voice app cancelled the recording' : 'the recording failed') };
      break;
    default:
      return s;
  }
  return next.step === s.step && next.index === s.index && next.recording === s.recording && next.recorded === s.recorded && next.error === s.error ? s : next;
}

/** The one-line status of the flow, for the dialog and screen readers. */
export function enrolLine(s: EnrolState): string {
  switch (s.step) {
    case 'form':
      return 'Choose a name and read the consent.';
    case 'waiting':
      return 'Waiting for the voice app to start listening…';
    case 'phrase':
      return `Recording ${s.name ?? 'this voice'} — only ${s.name ?? 'that person'} should speak. Phrase ${s.index + 1} of ${s.phrases.length}: ${s.recording ? 'recording, read it aloud' : 'get ready to read it aloud'}`;
    case 'confirm':
      return 'Confirm with Touch ID, then read three short phrases aloud.';
    case 'done':
      return `Gnomon knows ${s.name}'s voice now.`;
    case 'failed':
      return `Not enrolled: ${s.error ?? 'the recording failed'}`;
  }
}

/** A Touch ID card from an enrolment request (A4: detail.op voice.enrol naming exactly this voice). */
export function isEnrolCard(card: { kind: string; card: Record<string, unknown> } | undefined, name: string | null): boolean {
  if (!card || !name) return false;
  const d = obj(card.card.detail);
  if (!d || d.op !== 'voice.enrol') return false;
  // Aegis L4: the card must name this voice (a nameless card is never taken for it)
  return nameOf(d.name ?? d.speakerId) === name;
}

/** A5: `status.voice.notice` as {text, at} (one line, bounded), or null. */
export function noticeOf(status: unknown): { text: string; at: string | null } | null {
  const n = obj(obj(obj(status)?.voice)?.notice);
  const t = str(n?.text);
  if (!t) return null;
  // Aegis L6: always attributed — the text is the voice app's, never the kernel's
  const one = `${NOTICE_PREFIX}${t.replace(/\s+/g, ' ').trim()}`;
  return { text: one.length > NOTICE_MAX ? `${one.slice(0, NOTICE_MAX - 1)}…` : one, at: str(n?.at) };
}
export const NOTICE_MAX = 140;
export const NOTICE_PREFIX = 'Voice app: ';
/** How long a quiet toast stays (ms). */
export const TOAST_MS = 6000;
/** A notice older than this when it is read (a backlog page) is not toasted: toasts are for now, not history. */
export const TOAST_MAX_AGE_MS = 30_000;
export function toastFresh(at: string | null, now: number): boolean {
  if (!at) return true;
  const t = Date.parse(at);
  return !Number.isFinite(t) || now - t <= TOAST_MAX_AGE_MS;
}

/** A6: rows whose arrival changes status.voice.client or the enrolled list (the page re-reads status). */
export const isClientRow = (kind: string): boolean => kind.startsWith('voice.client.') || kind === 'voice.enrol' || kind === 'voice.forget';

/** The light status poll while the enrol dialog waits on the voice app (A3: progress is status, not rows). */
export const ENROL_POLL_MS = 1000;

/** The LOUD dev-build banner text, or null. */
export const devBannerOf = (c: ClientView): string | null => (c.devUnsigned ? 'Voice is running an unsigned development build' : null);
