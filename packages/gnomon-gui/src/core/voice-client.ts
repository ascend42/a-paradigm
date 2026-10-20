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
 *     root-signed enrolment row), and `request.voice.forget{name}` (ASSUMED name).
 *   - The pill (core/voice.ts pillOf) is kernel-owned; `clientPillOf` only overrides it while NOTHING is attached (an
 *     attached live mic always keeps its louder state: never under-report).
 *   - Only a human-class connection gets any of these controls (`canAttach`); a voice connection never does.
 *
 * ASSUMPTIONS (the kernel/client contract is being built in parallel; adjust here only):
 *   A1 enrolled voices: `status.voice.enrolled` (string[] of names or speakerIds, or [{name | speakerId}]), else
 *      `status.voice.speakers`. Absent ⇒ unknown (no "teach your voice" nudge; never a false nudge).
 *   A2 forget: `request.voice.forget{name}` (request.voice.enrol is enrol-only).
 *   A3 enrolment progress: the voice client logs rows of kind `voice.enrol.<step>` or `voice.enrolment.<step>`
 *      (any suffix) with payload `{name?, phase?: 'ready' | 'recording' | 'recorded' | 'done' | 'failed' |
 *      'cancelled', phrase?: number (0-based), of?: number, phrases?: string[], error?: string}`; the step suffix
 *      stands in for `phase` when absent. The root-signed `voice.enrol` row for the name means done.
 *   A4 the request.voice.enrol answer is `{pending: true, cardId}` (the Touch ID card); without one the GUI looks
 *      for a pending card whose detail.op is `voice.enrol` and offers to focus it.
 *   A5 client notices: rows `voice.notice` / `voice.client.notice` (or any voice.* row whose payload has a string
 *      `notice`) with `{text | message | notice}`; shown as a quiet toast, never as a decision.
 *   A6 lifecycle rows: `voice.client.*` and `request.voice.*` rows change status.voice.client (the page re-reads
 *      status on them; motion-on-events, no polling).
 */

export type ClientPhase = 'idle' | 'installing' | 'downloading' | 'starting' | 'running' | 'crashed' | 'unavailable';
export const CLIENT_PHASES: readonly ClientPhase[] = Object.freeze(['idle', 'installing', 'downloading', 'starting', 'running', 'crashed', 'unavailable'] as const);

export interface ClientView {
  /** the kernel reports the voice app's lifecycle at all */
  known: boolean;
  phase: ClientPhase;
  download: { n: number; of: number } | null;
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

/** The voice-app view from a `status` result (the adapter: every client-status assumption lives here). */
export function clientOf(status: unknown): ClientView {
  const v = obj(obj(status)?.voice);
  const c = obj(v?.client);
  const connected = v && typeof v.clientConnected === 'boolean' ? v.clientConnected : null;
  const raw = str(c?.phase);
  let phase: ClientPhase = raw && (CLIENT_PHASES as readonly string[]).includes(raw) ? (raw as ClientPhase) : 'idle';
  // the kernel's connection word wins over a stale phase: connected ⇒ running; a "running" claim while not connected ⇒ not running
  if (connected === true && (phase === 'idle' || phase === 'starting')) phase = 'running';
  if (connected === false && phase === 'running') phase = 'idle';
  const d = obj(c?.downloadMb);
  const n = num(d?.n);
  const of = num(d?.of);
  const list = Array.isArray(v?.enrolled) ? v!.enrolled : Array.isArray(v?.speakers) ? v!.speakers : null;
  return {
    known: c !== null || connected !== null,
    phase,
    download: n !== null && of !== null && of > 0 ? { n: Math.min(n, of), of } : null,
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
      return { label: d ? `Downloading voice models · ${MB(d.n)} of ${MB(d.of)} MB` : 'Downloading voice models…', className: 'voice-noclient voice-setup', title: 'The voice models download once, then stay on this Mac.', action: null, actionLabel: '', progress: d ? d.n / d.of : null };
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

/** A2 (assumed): forget is its own request. */
export const forgetRequest = (name: string): ClientRequest => ({ kind: 'request.voice.forget', payload: { name } });

/** Shown when the voice client does not name its own phrases (A3 `phrases`). */
export const ENROL_PHRASES: readonly string[] = Object.freeze([
  'Gnomon, open the latest session and tell me what changed.',
  'The quick brown fox jumps over the lazy dog near the riverbank.',
  'Approve that change, then read the next decision aloud.',
]);

export type EnrolStep = 'form' | 'waiting' | 'phrase' | 'confirm' | 'done' | 'failed';
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
}

export const enrolStart = (): EnrolState => ({ step: 'form', name: null, cardId: null, phrases: ENROL_PHRASES, index: 0, recording: false, recorded: 0, error: null });

/** The request was accepted: wait for the voice client to begin the phrases. */
export function enrolSent(s: EnrolState, name: string, cardId: string | null): EnrolState {
  return { ...s, step: 'waiting', name, cardId, index: 0, recorded: 0, recording: false, error: null };
}

const ENROL_KIND = /^voice\.enrol(?:ment)?\.([a-z.-]+)$/;
const ENROL_PHASES: ReadonlySet<string> = new Set(['ready', 'recording', 'recorded', 'done', 'failed', 'cancelled']);

/** Is this row part of an enrolment (progress from the client, or the root-signed result)? */
export const isEnrolRow = (kind: string): boolean => kind === 'voice.enrol' || kind === 'voice.forget' || ENROL_KIND.test(kind);

/** Fold one row into the flow (A3). Rows for another name, or before the request was sent, change nothing. */
export function reduceEnrol(s: EnrolState, kind: string, payload: unknown): EnrolState {
  if (s.step === 'form' || s.step === 'done' || !s.name) return s;
  const p = obj(payload) ?? {};
  const rowName = nameOf(p.name ?? p.speakerId);
  if (rowName !== null && rowName !== s.name) return s;
  if (kind === 'voice.enrol') return rowName === s.name ? { ...s, step: 'done', recording: false, error: null } : s;
  const m = ENROL_KIND.exec(kind);
  if (!m) return s;
  const phrases = Array.isArray(p.phrases) && p.phrases.length && p.phrases.every((x) => typeof x === 'string') ? (p.phrases as string[]).slice(0, 8) : s.phrases;
  const of = num(p.of) ?? phrases.length;
  const idx = num(p.phrase);
  const step = m[1]!.split('.').pop()!;
  const phase = str(p.phase) ?? (ENROL_PHASES.has(step) ? step : step === 'start' || step === 'begin' ? 'ready' : step === 'progress' ? 'recorded' : step === 'error' ? 'failed' : null);
  const at = idx !== null ? Math.min(idx, Math.max(0, of - 1)) : s.index;
  switch (phase) {
    case 'ready':
      return { ...s, step: 'phrase', phrases, index: at, recording: false };
    case 'recording':
      return { ...s, step: 'phrase', phrases, index: at, recording: true };
    case 'recorded': {
      const recorded = Math.max(s.recorded, (idx ?? s.index) + 1);
      return recorded >= of ? { ...s, step: 'confirm', phrases, recorded, recording: false } : { ...s, step: 'phrase', phrases, index: Math.min(recorded, of - 1), recorded, recording: false };
    }
    case 'done':
      return { ...s, step: 'confirm', recorded: of, recording: false };
    case 'failed':
    case 'cancelled':
      return { ...s, step: 'failed', recording: false, error: str(p.error) ?? str(p.reason) ?? (phase === 'cancelled' ? 'the voice app cancelled the recording' : 'the recording failed') };
    default:
      return s;
  }
}

/** The one-line status of the flow, for the dialog and screen readers. */
export function enrolLine(s: EnrolState): string {
  switch (s.step) {
    case 'form':
      return 'Choose a name and read the consent.';
    case 'waiting':
      return 'Waiting for the voice app to start listening…';
    case 'phrase':
      return `Phrase ${s.index + 1} of ${s.phrases.length}: ${s.recording ? 'recording, read it aloud' : 'get ready to read it aloud'}`;
    case 'confirm':
      return 'All phrases recorded. Finish with Touch ID.';
    case 'done':
      return `Gnomon knows ${s.name}'s voice now.`;
    case 'failed':
      return `Not enrolled: ${s.error ?? 'the recording failed'}`;
  }
}

/** A Touch ID card from an enrolment request (A4: kind strictness or presence, detail.op voice.enrol, the same name). */
export function isEnrolCard(card: { kind: string; card: Record<string, unknown> } | undefined, name: string | null): boolean {
  if (!card || !name) return false;
  const d = obj(card.card.detail);
  if (!d || (d.op !== 'voice.enrol' && d.op !== 'request.voice.enrol')) return false;
  const n = nameOf(d.name ?? d.speakerId);
  return n === null || n === name;
}

/** A5: the toast text of a client notice row, or null. */
export function noticeOf(kind: string, payload: unknown): string | null {
  if (!kind.startsWith('voice.')) return null;
  const p = obj(payload);
  if (!p) return null;
  const explicit = kind === 'voice.notice' || kind === 'voice.client.notice';
  const t = explicit ? (str(p.text) ?? str(p.message) ?? str(p.notice)) : str(p.notice);
  if (!t) return null;
  const one = t.replace(/\s+/g, ' ').trim();
  return one.length > NOTICE_MAX ? `${one.slice(0, NOTICE_MAX - 1)}…` : one;
}
export const NOTICE_MAX = 140;
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
export const isClientRow = (kind: string): boolean => kind.startsWith('voice.client.') || kind.startsWith('request.voice.') || kind === 'voice.enrol' || kind === 'voice.forget';

/** The LOUD dev-build banner text, or null. */
export const devBannerOf = (c: ClientView): string | null => (c.devUnsigned ? 'Voice is running an unsigned development build' : null);
