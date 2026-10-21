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
 *   - The sheet is a right-side drawer (role dialog): your voice, send word, keys, listen, timing, risk. Teaching
 *     opens inline under its row (one prompt, a live "I heard", one counter, then the risk check right before save);
 *     there is no modal over the sheet.
 *
 * Every press must be a trusted user event (G-GUI-04): a script-made click changes nothing.
 */
import { DELAY_CHOICES, delayLabel, serializeDelay } from '../core/dictation.js';
import { h, type MiniDoc, type MiniEl } from '../core/render.js';
import { teachCounter, teachHeardLine, teachPrompt, teachShowsRisk, teachVariantsLine, TEACH_PICKS, type TeachState } from '../core/send-word-teach.js';
import { consentText, enrolLine, normalizeVoiceName, type EnrolState } from '../core/voice-client.js';
import { micKeyName, RUNG_NAME, type RungEntry, type SheetRowView, type SheetSection } from '../core/voice-ladder.js';
import { ACK_TEXT } from '../core/voice-presets.js';

/* ── the ladder popover ─────────────────────────────────────────────── */

/** The ladder's children: one button per rung, then the foot (mic key · listen, and the settings link). */
export function ladderEls(doc: MiniDoc, entries: readonly RungEntry[], foot: string): MiniEl[] {
  const out: MiniEl[] = [];
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
  | { kind: 'risk'; rung: 'word' | 'pieces' | null; ack: boolean }
  | { kind: 'keys'; bare: boolean };

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
  if (s.hint) out.push(h(doc, 'p', { class: 'meta vs-hint' }, s.hint));
  if (teachShowsRisk(s)) {
    out.push(h(doc, 'div', { class: 'vs-risk' }, h(doc, 'p', { class: 'vs-risk-text' }, ACK_TEXT), checkbox(doc, { 'data-vs-ack': 'teach', 'data-vs-focus': 'ack' }, s.ack, 'I understand')));
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
    h(doc, 'div', { class: 'vs-risk' }, h(doc, 'p', { class: 'vs-risk-text' }, ACK_TEXT), checkbox(doc, { 'data-vs-ack': 'risk', 'data-vs-focus': 'ack' }, f.ack, 'I understand')),
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
        h(doc, 'span', { class: `vs-v${r.tone === 'ok' ? ' ok' : r.tone === 'warn' ? ' warn' : ''}` }, r.value),
        r.action && open !== r.id ? btn(doc, { class: 'link', 'data-vs-act': r.action.act, 'data-vs-focus': `act-${r.id}` }, r.action.label) : h(doc, 'span', null),
      ),
    );
    if (r.id === 'timing') for (const e of timingEls(doc, v.delayMs, v.attachable)) sec.appendChild(e);
    if (v.flow && open === r.id) {
      const els = v.flow.kind === 'teach' ? teachEls(doc, v.flow) : v.flow.kind === 'enrol' ? enrolEls(doc, v.flow) : v.flow.kind === 'risk' ? riskEls(doc, v.flow) : keysEls(doc, v.flow);
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
      // the focused control went away (a step moved on): the flow's first control, else the sheet's close key
      ((body.querySelector('.vs-flow [data-vs-focus]') as HTMLElement | null) ?? document.getElementById('voice-settings-close'))?.focus();
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
    ((sec?.querySelector('.vs-flow [data-vs-focus]') as HTMLElement | null) ?? (sec?.querySelector('[data-vs-focus]') as HTMLElement | null) ?? document.getElementById('voice-settings-close'))?.focus();
  };
  body.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    const el = t.closest('[data-vs-act], [data-vs-pick], [data-vs-teach], [data-vs-enrol], [data-vs-forget], [data-vs-risk], [data-vs-mickey], [data-vs-delay], [data-vs-keys]') as HTMLElement | null;
    if (!el || (el as HTMLButtonElement).disabled) return;
    const ds = el.dataset;
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
    else if (t.dataset.vsEnrolAgree !== undefined) d.act('agree', t.checked ? '1' : '0', e.isTrusted);
  });
  body.addEventListener('input', (e) => {
    const t = e.target as HTMLInputElement;
    if (t.dataset.vsCustom !== undefined) d.input('custom', t.value);
    else if (t.dataset.vsEnrolName !== undefined) d.input('enrol-name', t.value);
  });
  body.addEventListener('keydown', (e) => {
    const t = e.target as HTMLInputElement;
    if (e.key !== 'Enter') return;
    if (t.dataset.vsCustom !== undefined) {
      e.preventDefault();
      d.act('pick', t.value, e.isTrusted);
    } else if (t.dataset.vsEnrolName !== undefined) {
      e.preventDefault();
      d.act('enrol', 'go', e.isTrusted);
    }
  });
  document.getElementById('voice-settings-close')?.addEventListener('click', close);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close(); // a press on the scrim closes it
  });
  const level = (n: number | null): void => {
    const m = body.querySelector('[data-vs-meter]') as HTMLElement | null;
    m?.style.setProperty('--level', String(n === null ? 0 : Math.max(0, Math.min(1, n))));
  };
  return { open, close, isOpen: () => !overlay.hidden, repaint, level };
}
