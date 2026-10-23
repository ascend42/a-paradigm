/**
 * @symbol #gui-voice-settings
 *
 * The voice ladder popover and the Voice settings sheet, the DOM side (Atelier 2026-10-21-gnomon-voice: direction.html,
 * setup-home.html, teach.html; design-system gnomon.voice). The models are pure (core/voice-ladder.ts,
 * core/send-word-teach.ts, core/voice-client.ts); this module builds their elements with core/render.ts `h()` (text
 * nodes only, allowlisted attributes, no inline style) and routes a press to the page through ONE `act` callback.
 *
 *   - The pill's popover is the ladder only (role menu, rungs are menuitemradio), a foot line with the mic key and
 *     the listen mode, and a "voice settings…" link. A rung that is not ready opens the sheet at its section.
 *   - The sheet is a right-side drawer (role dialog, aria-modal: Tab stays inside it while open, trapNext, and focus
 *     returns to where it came from on close): input (the mic in use and its picker with a live meter, founder request
 *     2026-10-23), your voice, send word, keys, listen, timing, risk. Teaching
 *     opens inline under its row (one prompt, a live "I heard", one counter, then the risk check right before save:
 *     the sentence naming the word, then the ACK_TEXT box, or "acknowledged · <date>" once this user acknowledged);
 *     there is no modal over the sheet.
 *
 * Every press must be a trusted user event (G-GUI-04): a script-made click changes nothing.
 */
import { DELAY_CHOICES, delayLabel, serializeDelay } from '../core/dictation.js';
import { h, type MiniDoc, type MiniEl } from '../core/render.js';
import { teachAckLine, teachCounter, teachHeardLine, teachPrompt, teachShowsRisk, teachVariants, teachVariantsLine, TEACH_DROP_VARIANTS, TEACH_PICKS, type TeachState } from '../core/send-word-teach.js';
import { consentText, enrolLine, normalizeVoiceName, type EnrolState } from '../core/voice-client.js';
import { micKeyName, RUNG_NAME, type InputChoiceView, type RungEntry, type SheetRowView, type SheetSection } from '../core/voice-ladder.js';
import { ACK_TEXT, riskSentence } from '../core/voice-presets.js';

/* ── the ladder popover ─────────────────────────────────────────────── */

/** The ladder's children: the target line (when the rung applies elsewhere), one button per rung, then the foot (mic key · listen, and the settings link). */
export function ladderEls(doc: MiniDoc, entries: readonly RungEntry[], foot: string, target: string | null = null): MiniEl[] {
  const out: MiniEl[] = [];
  // Luna #6: a rung applies to the focused session; when voice is on another, say so first
  if (target) out.push(h(doc, 'p', { class: 'meta ladder-target', role: 'note' }, target));
  for (const e of entries) {
    const tag = e.tag ? h(doc, 'span', { class: `rung-tag${e.tagKind === 'cost' || e.tagKind === 'setup' ? ' tag' : ''}` }, e.tag) : h(doc, 'span', { class: 'rung-tag' });
    const b = h(
      doc,
      'button',
      {
        class: `rung${e.current ? ' current' : ''}${e.needs ? ' needs-setup' : ''}`,
        type: 'button',
        role: 'menuitemradio',
        'aria-checked': String(e.current),
        'data-rung': e.rung,
        ...(e.needs ? { 'data-needs': e.needs } : {}),
        'aria-disabled': String(e.disabled),
        'aria-label': `${e.name}: ${e.line}${e.needs ? ' (set up first)' : ''}${e.why ? ` (${e.why})` : ''}`,
      },
      h(doc, 'span', { class: 'rung-r', 'aria-hidden': 'true' }),
      h(doc, 'span', { class: 'rung-text' }, h(doc, 'strong', { class: 'rung-name' }, e.name), h(doc, 'span', { class: 'rung-line' }, e.why ?? e.line)),
      tag,
    );
    if (e.disabled) b.setAttribute('disabled', '');
    out.push(b);
  }
  out.push(h(doc, 'div', { class: 'ladder-foot' }, h(doc, 'span', null, foot), h(doc, 'button', { class: 'link', type: 'button', role: 'menuitem', 'data-vs-open': 'voice' }, 'voice settings…')));
  return out;
}

/* ── the sheet ──────────────────────────────────────────────────────── */

export type FlowView =
  | { kind: 'teach'; s: TeachState; attached: boolean }
  | { kind: 'enrol'; s: EnrolState; name: string; agreed: boolean; enrolled: string[] | null; forgetArmed: string | null; level: number | null }
  /** word: the held send word (the sentence names it), or null */
  | { kind: 'risk'; rung: 'word' | 'pieces' | null; ack: boolean; word?: string | null }
  | { kind: 'keys'; bare: boolean }
  /** founder request 2026-10-23: the input picker and its live meter (the level is set without a repaint) */
  | { kind: 'input'; choices: InputChoiceView[]; on: boolean | null };

/** The section a flow opens under. */
export const flowSection = (f: FlowView): SheetSection => (f.kind === 'teach' ? 'sendword' : f.kind === 'enrol' ? 'voice' : f.kind);

export interface SheetView {
  rows: SheetRowView[];
  flow: FlowView | null;
  delayMs: number | null;
  /** a first-party human connection (the controls are offered) */
  attachable: boolean;
}

const btn = (doc: MiniDoc, attrs: Record<string, string>, label: string, disabled = false): MiniEl => {
  const b = h(doc, 'button', { type: 'button', ...attrs }, label);
  if (disabled) b.setAttribute('disabled', '');
  return b;
};
const checkbox = (doc: MiniDoc, attrs: Record<string, string>, on: boolean, label: string): MiniEl => {
  const i = h(doc, 'input', { type: 'checkbox', ...attrs });
  if (on) i.setAttribute('checked', '');
  return h(doc, 'label', { class: 'vs-check' }, i, ` ${label}`);
};

function teachEls(doc: MiniDoc, f: Extract<FlowView, { kind: 'teach' }>): MiniEl[] {
  const s = f.s;
  const out: MiniEl[] = [];
  const prompt = !f.attached && s.step === 'takes' ? 'Turn voice on for a session first (Talk or Dictate): the take is heard through it.' : teachPrompt(s);
  if (prompt) out.push(h(doc, 'p', { class: 'vs-prompt', role: 'status', 'aria-live': 'polite' }, prompt));
  if (s.step === 'pick') {
    const row = h(doc, 'div', { class: 'vs-row', role: 'group', 'aria-label': 'send word suggestions' });
    TEACH_PICKS.forEach((w, n) => row.appendChild(btn(doc, { class: `key${n === 0 ? ' pri' : ''}`, 'data-vs-pick': w, 'data-vs-focus': `pick-${n}` }, w)));
    out.push(row);
    out.push(h(doc, 'div', { class: 'vs-row' }, h(doc, 'input', { class: 'field vs-custom', type: 'text', maxlength: '32', placeholder: 'your own…', 'aria-label': 'your own send word (1 to 3 words)', 'data-vs-custom': '1', 'data-vs-focus': 'custom' }), btn(doc, { class: 'key', 'data-vs-teach': 'custom' }, 'use it')));
  }
  if (s.step === 'confirm-common') out.push(h(doc, 'div', { class: 'vs-row' }, btn(doc, { class: 'key pri', 'data-vs-teach': 'common-yes', 'data-vs-focus': 'common-yes' }, `use “${s.word}”`), btn(doc, { class: 'key', 'data-vs-teach': 'common-no' }, 'pick another')));
  const counter = teachCounter(s);
  if (counter) out.push(h(doc, 'p', { class: 'vs-counter' }, counter));
  const heard = teachHeardLine(s);
  if (heard) out.push(h(doc, 'p', { class: `vs-heard${s.trial?.last?.verdict === 'correct' ? ' ok' : ''}`, 'aria-live': 'polite' }, heard));
  const variants = teachVariantsLine(s);
  if (variants) out.push(h(doc, 'p', { class: 'meta vs-variants' }, variants));
  // Aegis R-1: at save each collected mishearing is an UNTICKED opt-in; only ticked ones are kept
  if (TEACH_DROP_VARIANTS && s.step === 'done' && teachVariants(s).length) {
    const list = h(doc, 'div', { class: 'vs-variant-list', role: 'group', 'aria-label': 'heard differently: keep any?' });
    teachVariants(s).forEach(({ variant, kept, label }, n) => list.appendChild(checkbox(doc, { 'data-vs-variant': variant, 'data-vs-focus': `variant-${n}` }, kept, label)));
    out.push(list);
  }
  if (s.hint) out.push(h(doc, 'p', { class: 'meta vs-hint' }, s.hint));
  if (teachShowsRisk(s)) {
    // Luna #3: the render's sentence with the word; the box is ACK_TEXT itself; an earlier acknowledgement shows its date, not a pre-ticked box
    const prior = teachAckLine(s);
    out.push(h(doc, 'div', { class: 'vs-risk' }, h(doc, 'p', { class: 'vs-risk-text' }, riskSentence({ word: s.word })), prior ? h(doc, 'p', { class: 'meta vs-acked' }, prior) : checkbox(doc, { 'data-vs-ack': 'teach', 'data-vs-focus': 'ack' }, s.ack, ACK_TEXT)));
    out.push(h(doc, 'div', { class: 'vs-row' }, btn(doc, { class: 'key pri', 'data-vs-teach': 'save', 'data-vs-focus': 'save' }, `save “${s.word}”`, !s.ack || (s.trial?.correct ?? 0) === 0), btn(doc, { class: 'key', 'data-vs-teach': 'cancel' }, 'cancel')));
  } else if (s.step === 'exhausted') {
    out.push(h(doc, 'div', { class: 'vs-row' }, btn(doc, { class: 'key pri', 'data-vs-teach': 'retry', 'data-vs-focus': 'retry' }, 'try again'), btn(doc, { class: 'key', 'data-vs-teach': 'other' }, 'pick another'), btn(doc, { class: 'key', 'data-vs-teach': 'cancel' }, 'cancel')));
  } else if (s.step === 'takes') {
    out.push(h(doc, 'div', { class: 'vs-row' }, btn(doc, { class: 'key', 'data-vs-teach': 'cancel' }, 'cancel')));
  } else {
    out.push(h(doc, 'div', { class: 'vs-row' }, btn(doc, { class: 'key', 'data-vs-teach': 'cancel' }, 'cancel')));
  }
  return out;
}

function enrolEls(doc: MiniDoc, f: Extract<FlowView, { kind: 'enrol' }>): MiniEl[] {
  const s = f.s;
  const out: MiniEl[] = [];
  const form = s.step === 'form' || s.step === 'failed';
  out.push(h(doc, 'p', { class: 'vs-prompt', role: 'status', 'aria-live': 'polite' }, enrolLine(s)));
  if (form) {
    const norm = normalizeVoiceName(f.name);
    out.push(h(doc, 'label', { class: 'meta vs-label' }, 'your name ', h(doc, 'input', { class: 'field', type: 'text', maxlength: '64', placeholder: 'matt', value: f.name, 'data-vs-enrol-name': '1', 'data-vs-focus': 'enrol-name', 'aria-label': 'your name' })));
    if (f.name && norm !== f.name) out.push(h(doc, 'p', { class: 'meta' }, `saved as “${norm}”`));
    out.push(h(doc, 'div', { class: 'vs-risk' }, h(doc, 'p', { class: 'vs-risk-text' }, consentText(norm || 'your name')), checkbox(doc, { 'data-vs-enrol-agree': '1', 'data-vs-focus': 'enrol-agree' }, f.agreed, 'I agree')));
    out.push(h(doc, 'div', { class: 'vs-row' }, btn(doc, { class: 'key pri', 'data-vs-enrol': 'go', 'data-vs-focus': 'enrol-go' }, s.step === 'failed' ? 'try again' : 'continue'), btn(doc, { class: 'key', 'data-vs-enrol': 'cancel' }, 'cancel')));
  } else if (s.step === 'confirm') {
    out.push(h(doc, 'div', { class: 'vs-row' }, btn(doc, { class: 'key pri', 'data-vs-enrol': 'go', 'data-vs-focus': 'enrol-go' }, 'confirm with Touch ID'), btn(doc, { class: 'key', 'data-vs-enrol': 'cancel' }, 'cancel')));
  } else if (s.step === 'waiting' || s.step === 'phrase') {
    if (s.step === 'phrase') {
      out.push(h(doc, 'p', { class: 'vs-counter' }, `phrase ${s.index + 1} of ${s.phrases.length}${s.recording ? ' · recording' : ' · get ready'}`));
      out.push(h(doc, 'p', { class: 'vs-heard' }, `“${s.phrases[s.index] ?? ''}”`));
    }
    out.push(h(doc, 'span', { class: `vs-meter${s.recording ? ' recording' : ''}`, 'aria-hidden': 'true', 'data-vs-meter': '1' }, h(doc, 'span', null), h(doc, 'span', null), h(doc, 'span', null), h(doc, 'span', null), h(doc, 'span', null)));
    out.push(h(doc, 'div', { class: 'vs-row' }, btn(doc, { class: 'key', 'data-vs-enrol': 'cancel' }, 'close')));
  } else {
    out.push(h(doc, 'div', { class: 'vs-row' }, btn(doc, { class: 'key pri', 'data-vs-enrol': 'cancel', 'data-vs-focus': 'enrol-done' }, 'done')));
  }
  if (form && f.enrolled && f.enrolled.length) {
    const list = h(doc, 'div', { class: 'vs-voices' }, h(doc, 'p', { class: 'meta' }, 'enrolled voices'));
    for (const n of f.enrolled) list.appendChild(h(doc, 'div', { class: 'vs-voice' }, h(doc, 'span', null, n), btn(doc, { class: 'link', 'data-vs-forget': n, 'data-armed': f.forgetArmed === n ? 'true' : 'false' }, f.forgetArmed === n ? `forget ${n}? confirm` : 'forget')));
    out.push(list);
  }
  return out;
}

function riskEls(doc: MiniDoc, f: Extract<FlowView, { kind: 'risk' }>): MiniEl[] {
  return [
    h(doc, 'div', { class: 'vs-risk' }, h(doc, 'p', { class: 'vs-risk-text' }, riskSentence({ word: f.word ?? null, pieces: f.rung === 'pieces' })), checkbox(doc, { 'data-vs-ack': 'risk', 'data-vs-focus': 'ack' }, f.ack, ACK_TEXT)),
    h(doc, 'div', { class: 'vs-row' }, btn(doc, { class: 'key pri', 'data-vs-risk': 'go', 'data-vs-focus': 'risk-go' }, f.rung ? `turn on ${RUNG_NAME[f.rung]}` : 'acknowledge', !f.ack), btn(doc, { class: 'key', 'data-vs-risk': 'cancel' }, 'cancel')),
  ];
}

function keysEls(doc: MiniDoc, f: Extract<FlowView, { kind: 'keys' }>): MiniEl[] {
  const seg = h(doc, 'span', { class: 'seg', role: 'radiogroup', 'aria-label': 'mic key' });
  seg.appendChild(btn(doc, { class: `key quiet seg-key${f.bare ? '' : ' current'}`, role: 'radio', 'aria-checked': String(!f.bare), 'data-vs-mickey': 'ctrl', 'data-vs-focus': 'mickey-ctrl' }, '⌃` (` inside Gnomon)'));
  seg.appendChild(btn(doc, { class: `key quiet seg-key${f.bare ? ' current' : ''}`, role: 'radio', 'aria-checked': String(f.bare), 'data-vs-mickey': 'bare', 'data-vs-focus': 'mickey-bare' }, '` everywhere'));
  return [
    h(doc, 'p', { class: 'vs-prompt' }, `mic key: ${micKeyName(f.bare)}`),
    seg,
    h(doc, 'p', { class: 'meta vs-warn' }, 'A bare ` everywhere: while Gnomon voice runs, ` will not type in any app.'),
    h(doc, 'p', { class: 'meta' }, 'Talk and send now are the voice app’s own keys; they are shown as they are.'),
    h(doc, 'div', { class: 'vs-row' }, btn(doc, { class: 'key', 'data-vs-keys': 'done' }, 'done')),
  ];
}

/**
 * The input picker (founder request 2026-10-23). Mika 2026-10-23: the choices are the folder field's choice rows
 * (.ff-list / .ff-row, the system's stacked radiogroup; .plain drops the project swatch and lets a long device name
 * wrap) instead of a new stacked segmented control: ✓ and weight 600 on the chosen row, the detail line under the
 * name, "in use" on the input the mic is on now. Roving tabindex: Tab enters on the chosen row, the arrows MOVE focus
 * and Enter or Space chooses (choosing restarts the mic on that input, so arrowing through must not switch it). Then
 * the live level as a meter (role meter, 0..100, a word for it), the remembered-choice note and done.
 */
function inputEls(doc: MiniDoc, f: Extract<FlowView, { kind: 'input' }>): MiniEl[] {
  const list = h(doc, 'div', { class: 'ff-list vs-inputs', role: 'radiogroup', 'aria-label': 'input' });
  const at = Math.max(0, f.choices.findIndex((c) => c.checked));
  f.choices.forEach((c, i) =>
    list.appendChild(
      h(
        doc,
        'button',
        { type: 'button', role: 'radio', class: 'ff-row plain', 'aria-checked': String(c.checked), tabindex: i === at ? '0' : '-1', 'aria-label': `${c.label}${c.inUse ? ', in use' : ''}`, 'data-vs-input': c.id, 'data-vs-focus': `input:${c.id}` },
        h(doc, 'span', { class: 'ff-mk', 'aria-hidden': 'true' }, c.checked ? '✓' : ''),
        h(doc, 'span', { class: 'ff-text' }, h(doc, 'span', { class: 'ff-name' }, c.name), c.detail ? h(doc, 'span', { class: 'ff-path' }, c.detail) : null),
        h(doc, 'span', { class: 'ff-when' }, c.inUse ? 'in use' : ''),
      ),
    ),
  );
  return [
    list,
    h(
      doc,
      'div',
      { class: 'vs-row' },
      h(doc, 'span', { class: 'vs-meter', role: 'meter', 'aria-label': 'input level', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': '0', 'aria-valuetext': 'quiet', 'data-vs-meter': '1' }, h(doc, 'span', null), h(doc, 'span', null), h(doc, 'span', null), h(doc, 'span', null), h(doc, 'span', null)),
      h(doc, 'span', { class: 'meta' }, f.on === false ? 'the mic is off; the meter moves when it is on' : 'the meter moves when sound arrives on the input in use'),
    ),
    h(doc, 'p', { class: 'meta' }, 'A chosen mic is remembered; when it is unplugged, Gnomon listens on the system default until it is back.'),
    h(doc, 'div', { class: 'vs-row' }, btn(doc, { class: 'key', 'data-vs-input-done': '1', 'data-vs-focus': 'input-done' }, 'done')),
  ];
}

/** The timing row's control: the Talk auto-send delay as a segmented control, then the pieces line. */
function timingEls(doc: MiniDoc, delayMs: number | null, attachable: boolean): MiniEl[] {
  const seg = h(doc, 'span', { class: 'seg vs-seg', role: 'radiogroup', 'aria-label': 'Talk sends after' });
  for (const d of DELAY_CHOICES) seg.appendChild(btn(doc, { class: `key quiet seg-key${d === delayMs ? ' current' : ''}`, role: 'radio', 'aria-checked': String(d === delayMs), 'data-vs-delay': serializeDelay(d), 'data-vs-focus': `delay-${serializeDelay(d)}` }, delayLabel(d), !attachable));
  return [h(doc, 'div', { class: 'vs-row vs-timing' }, seg)];
}

/** The sheet body: each row, its inline flow under it (one at a time), the timing control in the timing row. */
export function sheetEls(doc: MiniDoc, v: SheetView): MiniEl[] {
  const open = v.flow ? flowSection(v.flow) : null;
  return v.rows.map((r) => {
    const sec = h(doc, 'section', { class: `vs-sec${open === r.id ? ' open' : ''}`, 'data-vs-section': r.id, 'aria-label': r.label });
    sec.appendChild(
      h(
        doc,
        'div',
        { class: 'vs-head' },
        h(doc, 'span', { class: 'vs-k' }, r.label),
        // ok reads by its mark and weight, in ink (board gnomon-status-colour)
        h(doc, 'span', { class: `vs-v${r.tone === 'ok' ? ' ok' : r.tone === 'warn' ? ' warn' : ''}` }, r.tone === 'ok' ? `✓ ${r.value}` : r.value),
        r.action && open !== r.id ? btn(doc, { class: 'link', 'data-vs-act': r.action.act, 'data-vs-focus': `act-${r.id}` }, r.action.label) : h(doc, 'span', null),
      ),
    );
    if (r.id === 'timing') for (const e of timingEls(doc, v.delayMs, v.attachable)) sec.appendChild(e);
    if (v.flow && open === r.id) {
      const els = v.flow.kind === 'teach' ? teachEls(doc, v.flow) : v.flow.kind === 'enrol' ? enrolEls(doc, v.flow) : v.flow.kind === 'risk' ? riskEls(doc, v.flow) : v.flow.kind === 'input' ? inputEls(doc, v.flow) : keysEls(doc, v.flow);
      sec.appendChild(h(doc, 'div', { class: 'vs-flow' }, ...els));
    }
    return sec;
  });
}

/** A stable key for a sheet view (repaints only when it changes; the live level is set without a repaint). */
export function sheetKey(v: SheetView): string {
  const f = v.flow && v.flow.kind === 'enrol' ? { ...v.flow, level: null } : v.flow;
  return JSON.stringify({ ...v, flow: f });
}

/* ── mounting ──────────────────────────────────────────────────────── */

/**
 * Luna #11: the drawer is aria-modal, so Tab stays inside it. Given the sheet's focusable controls in order, the one
 * focused now and the direction, where focus must go instead of leaving (wrapping at either end, or entering from
 * outside), or null to let the browser move it.
 */
export function trapNext<T>(items: readonly T[], active: T | null, back: boolean): T | null {
  if (!items.length) return null;
  const i = active === null ? -1 : items.indexOf(active);
  if (i < 0) return back ? items[items.length - 1]! : items[0]!;
  if (back && i === 0) return items[items.length - 1]!;
  if (!back && i === items.length - 1) return items[0]!;
  return null;
}
const FOCUSABLE = 'button:not([disabled]):not([tabindex="-1"]), input:not([disabled]):not([tabindex="-1"]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';
/** A flow's first control to focus: never a roving group's inactive row (tabindex -1). */
const FLOW_FIRST = '.vs-flow [data-vs-focus]:not([tabindex="-1"])';
/** The level the input meter calls "sound arriving" (0..1; room noise sits below it). */
export const METER_SOUND = 0.1;

export interface VoiceSheetDeps {
  view: () => SheetView;
  /** a press in the sheet: the action and its value; `trusted` is the browser's flag (G-GUI-04) */
  act: (action: string, value: string, trusted: boolean) => void;
  /** typing in a field: the field and its text (no request leaves the page) */
  input: (field: 'custom' | 'enrol-name', text: string) => void;
  onClose: () => void;
}

export interface VoiceSheet {
  open(section?: SheetSection): void;
  close(): void;
  isOpen(): boolean;
  repaint(force?: boolean): void;
  /** the live input level (enrolment meter), 0..1, without a repaint */
  level(n: number | null): void;
}

export function mountVoiceSheet(document: Document, d: VoiceSheetDeps): VoiceSheet {
  const overlay = document.getElementById('voice-settings')!;
  const body = document.getElementById('voice-settings-body')!;
  const card = (overlay.querySelector('.voice-sheet') as HTMLElement | null) ?? overlay;
  let back: HTMLElement | null = null;
  let shown = '';
  const repaint = (force = false): void => {
    if (overlay.hidden) return;
    const v = d.view();
    const key = sheetKey(v);
    if (!force && key === shown) return;
    shown = key;
    // keep the focused control (and a text field's caret) across a repaint
    const a = document.activeElement as HTMLElement | null;
    const fk = a && body.contains(a) ? a.dataset.vsFocus : undefined;
    const sec = a && body.contains(a) ? (a.closest('[data-vs-section]') as HTMLElement | null)?.dataset.vsSection : undefined;
    const sel = a instanceof HTMLInputElement && a.type === 'text' ? [a.selectionStart, a.selectionEnd, a.value] as const : null;
    while (body.firstChild) body.removeChild(body.firstChild);
    for (const el of sheetEls(document as unknown as MiniDoc, v)) body.appendChild(el as unknown as Node);
    const again = fk ? (body.querySelector(`[data-vs-focus="${fk}"]`) as HTMLElement | null) : null;
    if (again) {
      if (sel && again instanceof HTMLInputElement) {
        if (!again.value) again.value = sel[2];
        again.focus();
        again.setSelectionRange(sel[0], sel[1]);
      } else again.focus();
    } else if (fk) {
      // the focused control went away (a step moved on): the flow's first control (a roving group's current row), else
      // (the flow closed: done, cancel) its row's key, else the sheet's close key. Mika 2026-10-23: was the close key
      // after every done, which threw a keyboard user to the top of the drawer.
      const from = sec ? body.querySelector(`[data-vs-section="${sec}"] [data-vs-act]`) : null;
      ((body.querySelector(FLOW_FIRST) as HTMLElement | null) ?? (from as HTMLElement | null) ?? document.getElementById('voice-settings-close'))?.focus();
    }
  };
  const close = (): void => {
    if (overlay.hidden) return;
    overlay.hidden = true;
    shown = '';
    d.onClose();
    back?.focus();
    back = null;
  };
  const open = (section?: SheetSection): void => {
    if (overlay.hidden) back = document.activeElement as HTMLElement | null;
    overlay.hidden = false;
    repaint(true);
    const sec = section ? (body.querySelector(`[data-vs-section="${section}"]`) as HTMLElement | null) : null;
    sec?.scrollIntoView?.({ block: 'nearest' });
    ((sec?.querySelector(FLOW_FIRST) as HTMLElement | null) ?? (sec?.querySelector('[data-vs-focus]') as HTMLElement | null) ?? document.getElementById('voice-settings-close'))?.focus();
  };
  body.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    const el = t.closest('[data-vs-act], [data-vs-pick], [data-vs-teach], [data-vs-enrol], [data-vs-forget], [data-vs-risk], [data-vs-mickey], [data-vs-delay], [data-vs-keys], [data-vs-input], [data-vs-input-done]') as HTMLElement | null;
    if (!el || (el as HTMLButtonElement).disabled) return;
    const ds = el.dataset;
    if (ds.vsInput !== undefined) return d.act('input', ds.vsInput, e.isTrusted);
    if (ds.vsInputDone !== undefined) return d.act('input-done', '', e.isTrusted);
    const [action, value] = ds.vsAct !== undefined ? ['act', ds.vsAct] : ds.vsPick !== undefined ? ['pick', ds.vsPick] : ds.vsTeach !== undefined ? ['teach', ds.vsTeach] : ds.vsEnrol !== undefined ? ['enrol', ds.vsEnrol] : ds.vsForget !== undefined ? ['forget', ds.vsForget] : ds.vsRisk !== undefined ? ['risk', ds.vsRisk] : ds.vsMickey !== undefined ? ['mickey', ds.vsMickey] : ds.vsDelay !== undefined ? ['delay', ds.vsDelay] : ['keys', ds.vsKeys ?? ''];
    if (action === 'teach' && value === 'custom') {
      const f = body.querySelector('[data-vs-custom]') as HTMLInputElement | null;
      return d.act('pick', f?.value ?? '', e.isTrusted);
    }
    d.act(action, value, e.isTrusted);
  });
  body.addEventListener('change', (e) => {
    const t = e.target as HTMLInputElement;
    if (t.dataset.vsAck !== undefined) d.act('ack', `${t.dataset.vsAck}:${t.checked ? '1' : '0'}`, e.isTrusted);
    else if (t.dataset.vsVariant !== undefined) d.act('variant', `${t.checked ? '1' : '0'}:${t.dataset.vsVariant}`, e.isTrusted);
    else if (t.dataset.vsEnrolAgree !== undefined) d.act('agree', t.checked ? '1' : '0', e.isTrusted);
  });
  body.addEventListener('input', (e) => {
    const t = e.target as HTMLInputElement;
    if (t.dataset.vsCustom !== undefined) d.input('custom', t.value);
    else if (t.dataset.vsEnrolName !== undefined) d.input('enrol-name', t.value);
  });
  body.addEventListener('keydown', (e) => {
    const t = e.target as HTMLInputElement;
    // Mika 2026-10-23: the input rows are one Tab stop; the arrows move focus (roving tabindex), Home and End jump, and
    // Enter or Space chooses (a button's own press), never the arrows: each choice restarts the mic on that input
    if (t.dataset.vsInput !== undefined && !e.metaKey && !e.ctrlKey && !e.altKey) {
      const rows = [...body.querySelectorAll<HTMLElement>('[data-vs-input]')];
      const i = rows.indexOf(t);
      const to = e.key === 'ArrowDown' || e.key === 'ArrowRight' ? (i + 1) % rows.length : e.key === 'ArrowUp' || e.key === 'ArrowLeft' ? (i - 1 + rows.length) % rows.length : e.key === 'Home' ? 0 : e.key === 'End' ? rows.length - 1 : -1;
      if (to >= 0) {
        e.preventDefault();
        rows.forEach((r, n) => r.setAttribute('tabindex', n === to ? '0' : '-1'));
        rows[to]!.focus();
      }
      return;
    }
    if (e.key !== 'Enter') return;
    if (t.dataset.vsCustom !== undefined) {
      e.preventDefault();
      d.act('pick', t.value, e.isTrusted);
    } else if (t.dataset.vsEnrolName !== undefined) {
      e.preventDefault();
      d.act('enrol', 'go', e.isTrusted);
    }
  });
  // Luna #11: Tab is trapped inside the open drawer (aria-modal); closing hands focus back to where it came from
  // (on the document, so a focus that fell outside the drawer, e.g. to the page after a repaint, is brought back too)
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Tab' || overlay.hidden || e.metaKey || e.ctrlKey || e.altKey) return;
    const items = [...card.querySelectorAll<HTMLElement>(FOCUSABLE)];
    const a = document.activeElement as HTMLElement | null;
    const to = trapNext(items, a && card.contains(a) ? a : null, e.shiftKey);
    if (to) {
      e.preventDefault();
      to.focus();
    }
  });
  document.getElementById('voice-settings-close')?.addEventListener('click', close);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close(); // a press on the scrim closes it
  });
  const level = (n: number | null): void => {
    const m = body.querySelector('[data-vs-meter]') as HTMLElement | null;
    const v = n === null ? 0 : Math.max(0, Math.min(1, n));
    m?.style.setProperty('--level', String(v));
    // Mika 2026-10-23: the input picker's meter is a role=meter (not a live region: it changes 4 times a second)
    if (m?.getAttribute('role') === 'meter') {
      m.setAttribute('aria-valuenow', String(Math.round(v * 100)));
      m.setAttribute('aria-valuetext', n === null ? 'no level reported' : v >= METER_SOUND ? 'sound arriving' : 'quiet');
    }
  };
  return { open, close, isOpen: () => !overlay.hidden, repaint, level };
}
