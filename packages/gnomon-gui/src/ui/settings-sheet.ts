/**
 * @symbol #gui-settings
 * @symbol #gui-local-model
 *
 * #gui-settings, the DOM side of the Settings sheet (the model is core/settings.ts). The sheet is the static
 * `#settings` overlay in index.html; this module paints its body from the model with core/render.ts `h()` (text
 * nodes only, allowlisted attributes, no inline style) and routes a press:
 *
 *   - `[data-settings-run]` → the page's own `run(id)` (the palette's path), only for an id in SETTINGS_RUNS;
 *   - `[data-standing-revoke]` → `revoke(grantId)` (core/standing.ts revokeRequest through the page's client);
 *   - `[data-lm-act]`, `[data-lm-field]` and the form's submit → the Local model section's own press path
 *     (ui/local-model.ts; component settings-form: the form and request row kinds never run through SETTINGS_RUNS);
 *   - read-only rows have no control at all (a Check again key excepted, the section's own press path).
 *
 * Every press must be a trusted user event (G-GUI-04): a script-made click changes nothing.
 *
 * Section-focused open (design-system sheet.section_focused): open(section) scrolls to the section, focuses its
 * heading (tabindex -1) and marks the section `.focused` (a 2px key-edge rule) until focus leaves it; close returns
 * focus to whatever opened the sheet. Esc closes an open form (or the turn-off confirm) first, then the sheet.
 * A repaint keeps focus, and the caret in a field, on the same control.
 */
import { h, type MiniDoc, type MiniEl } from '../core/render.js';
import { folderFieldEl } from './folder-field.js';
import { SETTINGS_RUNS, type FieldView, type FormKey, type FormView, type ResultView, type SectionId, type SettingRow, type SettingsSection } from '../core/settings.js';

/** The Local model section's press path (ui/local-model.ts LocalModelController). */
export interface LocalPress {
  press(act: string, value: string | null, trusted: boolean): void;
  input(name: string, value: string): void;
  submit(trusted: boolean): void;
  advanced(open: boolean): void;
  /** Esc inside the sheet: close an open form or confirm; false when there is none */
  escape(): boolean;
  /** #gui-folder-field: a press in the runner's folder field (data-ff-act), and its typed path */
  folder?(act: string, real: string | null, trusted: boolean): void;
  folderInput?(value: string): void;
  /** after a paint: move focus where the folder field asked */
  afterPaint?(body: HTMLElement): void;
  sheetClosed(): void;
}

export interface SettingsDeps {
  model: () => SettingsSection[];
  run: (id: string) => void;
  revoke: (grantId: string) => void;
  local?: LocalPress;
  /** #gui-mcp-servers: a press on an `mcp:` key (ui/mcp-servers.ts) */
  mcp?: { press(act: string, value: string | null, trusted: boolean): void };
}

/** Where focus goes after a Local model press: a field, a key, or the section's heading. */
export type LocalFocus = { field: string } | { act: string } | { heading: true };

export interface SettingsSheet {
  /** open the sheet; with a section, in its section-focused state */
  open(section?: SectionId): void;
  close(): void;
  isOpen(): boolean;
  repaint(): void;
  /** Esc: an open form or confirm closes first, then the sheet */
  escape(): void;
  /** move focus inside the Local model section (after the repaint a press caused) */
  focusLocal(t: LocalFocus): void;
}

const setId = (el: MiniEl, id: string): MiniEl => (el.setAttribute('id', id), el);

/** Text with `code` spans (backticks in the copy). */
function rich(doc: MiniDoc, tag: string, attrs: Record<string, string> | null, text: string): MiniEl {
  const parts = text.split('`');
  return h(doc, tag, attrs, ...parts.map((p, i) => (i % 2 ? h(doc, 'code', null, p) : p)));
}

function keyEl(doc: MiniDoc, k: FormKey): MiniEl {
  const b = h(doc, 'button', { class: `key${k.pri ? ' pri' : ''}${k.quiet ? ' quiet' : ''}`, type: k.submit ? 'submit' : 'button', 'data-lm-act': k.act, ...(k.value ? { 'data-lm-value': k.value } : {}), ...(k.expanded !== undefined ? { 'aria-expanded': String(k.expanded) } : {}), ...(k.busy ? { 'aria-busy': 'true' } : {}), ...(k.title ? { title: k.title } : {}) }, k.label);
  if (k.disabled) (b as unknown as { disabled: boolean }).disabled = true;
  return b;
}

function resultEl(doc: MiniDoc, r: ResultView): MiniEl {
  return h(doc, 'p', { class: `sf-result${r.fail ? ' fail' : ''}`, role: r.fail ? 'alert' : 'status' }, r.lead ? h(doc, 'strong', null, r.lead) : null, r.text);
}

function fieldEl(doc: MiniDoc, f: FieldView): MiniEl {
  if (f.kind === 'seg') {
    const lid = `lm-${f.name}-label`;
    const seg = h(doc, 'span', { class: 'seg', role: 'radiogroup', 'aria-labelledby': lid });
    for (const o of f.options) {
      const b = h(doc, 'button', { class: `key quiet seg-key${o.pri ? ' current' : ''}`, type: 'button', role: 'radio', 'aria-checked': String(!!o.pri), 'data-lm-act': o.act, 'data-lm-value': o.value ?? '' }, o.label);
      seg.appendChild(b);
    }
    return h(doc, 'div', { class: 'sf-field', role: 'group', 'aria-labelledby': lid }, setId(h(doc, 'span', { class: 'sf-label' }, f.label), lid), seg, rich(doc, 'p', { class: 'sf-note' }, f.note));
  }
  if (f.kind === 'value') return h(doc, 'div', { class: 'sf-field' }, h(doc, 'span', { class: 'sf-label' }, f.label), h(doc, 'span', { class: 'settings-value' }, f.value));
  // #gui-folder-field compact: the legend is the field's label; the note says what the folder must hold
  if (f.kind === 'folder') return h(doc, 'div', { class: 'sf-field' }, folderFieldEl(doc, f.view, `lm-${f.name}`, { text: f.label, cls: 'sf-label' }), rich(doc, 'p', { class: 'sf-note' }, f.note));
  const err = `lm-err-${f.name}`;
  const input = h(doc, 'input', { class: `field ${f.width}`, type: 'text', name: `lm-${f.name}`, value: f.value, 'data-lm-field': f.name, maxlength: f.name === 'model' ? '128' : f.name === 'id' ? '64' : '256', ...(f.placeholder ? { placeholder: f.placeholder } : {}), ...(f.error ? { 'aria-invalid': 'true', 'aria-describedby': err } : {}) });
  input.setAttribute('spellcheck', 'false');
  input.setAttribute('autocomplete', 'off');
  // the ✕ message replaces the note (settings-form tokens.invalid), linked by aria-describedby
  return h(doc, 'label', { class: 'sf-field' }, h(doc, 'span', { class: 'sf-label' }, f.label), input, f.error ? setId(rich(doc, 'span', { class: 'sf-err', role: 'alert' }, f.error), err) : rich(doc, 'span', { class: 'sf-note' }, f.note));
}

function formEl(doc: MiniDoc, f: FormView): MiniEl {
  const form = h(doc, 'form', { class: 'set-form', 'aria-label': f.label });
  (form as unknown as { noValidate: boolean }).noValidate = true;
  form.appendChild(h(doc, 'p', { class: 'sf-lead' }, f.lead));
  if (f.result) form.appendChild(resultEl(doc, f.result));
  for (const x of f.fields) form.appendChild(fieldEl(doc, x));
  const adv = h(doc, 'details', { class: 'sf-adv' }, h(doc, 'summary', { class: 'key quiet', 'aria-label': 'Advanced: endpoint name and runner' }, `${f.advanced.label} ${f.advanced.open ? '▾' : '▸'}`), h(doc, 'div', null, ...f.advanced.fields.map((x) => fieldEl(doc, x))));
  if (f.advanced.open) (adv as unknown as { open: boolean }).open = true;
  form.appendChild(adv);
  if (f.changes) form.appendChild(h(doc, 'p', { class: 'sf-note' }, h(doc, 'strong', null, 'changes:'), ` ${f.changes}`));
  form.appendChild(h(doc, 'div', { class: 'sf-keys' }, ...f.keys.map((k) => keyEl(doc, k)), f.whyOff ? h(doc, 'span', { class: 'why-off' }, f.whyOff) : null));
  form.appendChild(h(doc, 'p', { class: 'sf-note' }, f.foot));
  return form;
}

function rowEl(doc: MiniDoc, r: SettingRow): MiniEl {
  if (r.kind === 'term') return h(doc, 'div', { class: 'settings-row sf-term', 'data-row': r.id }, h(doc, 'span', { class: 'settings-label' }), h(doc, 'p', { class: 'meta settings-how' }, r.text, h(doc, 'code', null, r.code)));
  const head = h(doc, 'span', { class: 'settings-label' }, r.label);
  if (r.kind === 'form') {
    const row = h(doc, 'div', { class: 'settings-row settings-form', 'data-row': r.id }, head);
    if (r.form) row.appendChild(formEl(doc, r.form));
    else if (r.confirm) row.appendChild(h(doc, 'div', { class: 'set-form', role: 'group', 'aria-label': r.confirm.label }, h(doc, 'p', { class: 'sf-lead' }, r.confirm.text), h(doc, 'div', { class: 'sf-keys' }, ...r.confirm.keys.map((k) => keyEl(doc, k)))));
    else if (r.keys.length === 1) row.appendChild(keyEl(doc, r.keys[0]!));
    else if (r.keys.length) row.appendChild(h(doc, 'div', { class: 'sf-keys' }, ...r.keys.map((k) => keyEl(doc, k))));
    if (r.result) row.appendChild(resultEl(doc, r.result));
    return row;
  }
  if (r.kind === 'request') {
    return h(doc, 'div', { class: 'settings-row settings-form', 'data-row': r.id }, head, h(doc, 'p', { class: 'sf-request', role: 'status' }, h(doc, 'span', { class: 'chip' }, r.chip), ` ${r.line}`), h(doc, 'div', { class: 'sf-keys' }, ...r.keys.map((k) => keyEl(doc, k))), h(doc, 'p', { class: 'meta settings-how' }, r.how));
  }
  const row = h(doc, 'div', { class: `settings-row settings-${r.kind}`, 'data-row': r.id }, head);
  const note = (s: string | undefined): void => {
    if (s) row.appendChild(h(doc, 'p', { class: 'meta settings-note' }, s));
  };
  if (r.kind === 'choice') {
    const seg = h(doc, 'span', { class: 'seg', role: 'radiogroup', 'aria-label': r.label });
    for (const o of r.options) {
      const b = h(doc, 'button', { class: `key quiet seg-key${o.current ? ' current' : ''}`, type: 'button', role: 'radio', 'aria-checked': String(o.current), 'data-settings-run': o.run, ...(o.note ? { title: o.note } : {}) }, o.label) as unknown as HTMLButtonElement;
      if (o.disabled) b.disabled = true;
      seg.appendChild(b);
    }
    row.appendChild(seg);
    note(r.note);
    // a disabled choice says why in words, not only in a tooltip (a disabled key takes no press and its title rarely
    // shows: the Install Workshop lesson, #gui-mods-panel)
    const why = r.options.filter((o) => o.disabled && o.note).map((o) => `${o.label}: ${o.note}`);
    if (why.length) note(why.join(' · '));
  } else if (r.kind === 'toggle') {
    row.appendChild(h(doc, 'button', { class: `key quiet seg-key${r.on ? ' current' : ''}`, type: 'button', 'aria-pressed': String(r.on), 'data-settings-run': r.run }, r.on ? 'Shown' : 'Hidden'));
    note(r.note);
  } else if (r.kind === 'action') {
    row.appendChild(h(doc, 'button', { class: 'key', type: 'button', 'data-settings-run': r.run }, r.note ?? r.label));
  } else if (r.kind === 'revoke') {
    row.appendChild(h(doc, 'button', { class: 'key', type: 'button', 'data-standing-revoke': r.grantId, title: 'End today’s grant now: every decision asks again' }, 'Revoke'));
    note(r.note);
  } else {
    row.setAttribute('data-readonly', 'true');
    if (r.grp) row.setAttribute('data-grp', 'start');
    if (r.live) row.setAttribute('aria-live', 'polite');
    row.appendChild(h(doc, 'span', { class: 'settings-value kernel-owned', ...(r.slot ? { 'data-gnomon-slot': r.slot } : {}), ...(r.title ? { title: r.title } : {}) }, r.mark ? h(doc, 'span', { class: 'mk' }, r.mark) : null, r.mark ? ' ' : null, r.value));
    if (r.how) row.appendChild(rich(doc, 'p', { class: 'meta settings-how' }, r.how));
    if (r.keys?.length) row.appendChild(h(doc, 'div', { class: 'sf-keys' }, ...r.keys.map((k) => keyEl(doc, k))));
  }
  return row;
}

/** Paint the model into `body` (cleared first). Exported for tests over a fake document and the reference shots. */
export function paintSettings(doc: MiniDoc, body: { firstChild: unknown; removeChild(c: unknown): unknown; appendChild(c: unknown): unknown }, sections: SettingsSection[], focused: SectionId | null = null): void {
  while (body.firstChild) body.removeChild(body.firstChild);
  for (const s of sections) body.appendChild(sectionEl(doc, s, focused === s.id));
}

/** One section: its heading (focusable for a section-focused open; "· kernel-owned" once when the kernel owns it). */
export function sectionEl(doc: MiniDoc, s: SettingsSection, focused = false): MiniEl {
  const hid = `settings-h-${s.id}`;
  const sec = h(doc, 'section', { class: `settings-sec${focused ? ' focused' : ''}`, 'data-section': s.id, 'aria-labelledby': hid, ...(s.owner ? { 'data-kernel-owned': 'true' } : {}) }, setId(h(doc, 'h3', { class: 'title settings-h', tabindex: '-1' }, s.title, s.owner ? ' ' : null, s.owner ? h(doc, 'span', { class: 'sec-owner' }, s.owner) : null), hid));
  if (s.intro) sec.appendChild(h(doc, 'p', { class: 'settings-intro' }, s.intro));
  for (const r of s.rows) sec.appendChild(rowEl(doc, r));
  return sec;
}

/**
 * Mika: no repaint while an IME composition is active in the sheet (a repaint replaces the field and ends the
 * composition mid-word). A repaint asked for meanwhile is owed and runs once the composition ends.
 */
export function compositionGate(): { start(): void; end(): boolean; hold(): boolean } {
  let composing = false;
  let owed = false;
  return {
    start: () => void (composing = true),
    /** the composition ended: true when a repaint was held meanwhile (the caller runs it now) */
    end: () => {
      composing = false;
      const o = owed;
      owed = false;
      return o;
    },
    /** true while composing (the repaint is skipped and owed) */
    hold: () => (composing ? (owed = true) : false),
  };
}

export function mountSettings(document: Document, d: SettingsDeps): SettingsSheet {
  const overlay = document.getElementById('settings')!;
  const body = document.getElementById('settings-body')!;
  let back: HTMLElement | null = null;
  let focused: SectionId | null = null;
  let painting = false;
  const ime = compositionGate();
  const repaint = (): void => {
    if (overlay.hidden) return;
    if (ime.hold()) return; // an IME composition is active: repaint once it ends
    // a repaint keeps focus (and the caret in a field) on the same control
    const a = document.activeElement as HTMLElement | null;
    const inBody = !!a && body.contains(a);
    const field = inBody ? a!.getAttribute('data-lm-field') : null;
    const sel = field || a?.dataset.ffTyped !== undefined ? [(a as HTMLInputElement).selectionStart, (a as HTMLInputElement).selectionEnd] : null;
    const keep = !inBody ? null : field ? `[data-lm-field="${CSS.escape(field)}"]` : a!.dataset.ffTyped !== undefined ? '[data-ff-typed]' : a!.dataset.ffAct ? `[data-ff-act="${CSS.escape(a!.dataset.ffAct)}"]` : a!.dataset.lmAct ? `[data-lm-act="${CSS.escape(a!.dataset.lmAct)}"]${a!.dataset.lmValue !== undefined ? `[data-lm-value="${CSS.escape(a!.dataset.lmValue)}"]` : ''}` : a!.dataset.settingsRun ? `[data-settings-run="${CSS.escape(a!.dataset.settingsRun)}"]` : a!.id ? `#${CSS.escape(a!.id)}` : a!.tagName === 'SUMMARY' ? '.sf-adv > summary' : null;
    painting = true;
    paintSettings(document as unknown as MiniDoc, body, d.model(), focused);
    painting = false;
    const el = keep ? (body.querySelector(keep) as HTMLElement | null) : null;
    if (el && !(el as HTMLButtonElement).disabled) {
      el.focus({ preventScroll: true });
      if (sel && el instanceof HTMLInputElement && sel[0] !== null) el.setSelectionRange(sel[0], sel[1]);
    } else if (el || (inBody && keep)) {
      // the pressed key went disabled while busy (Checking…, Turning off…): focus stays in its section, on the
      // heading, never dropped to the page body; the press's own outcome then moves it on
      const sec = (el ?? body).closest?.('[data-section]') ?? body.querySelector('[data-section="local-model"]');
      (sec?.querySelector('h3') as HTMLElement | null)?.focus({ preventScroll: true });
    }
    d.local?.afterPaint?.(body);
  };
  const close = (): void => {
    if (overlay.hidden) return;
    overlay.hidden = true;
    focused = null;
    d.local?.sheetClosed();
    back?.focus();
    back = null;
  };
  const open = (section?: SectionId): void => {
    if (overlay.hidden) back = document.activeElement as HTMLElement | null;
    overlay.hidden = false;
    focused = section ?? null;
    repaint();
    const heading = section ? (body.querySelector(`#settings-h-${CSS.escape(section)}`) as HTMLElement | null) : null;
    if (heading) {
      heading.scrollIntoView({ block: 'start' });
      heading.focus({ preventScroll: true });
    } else document.getElementById('settings-close')?.focus();
  };
  const focusLocal = (t: LocalFocus): void => {
    if (overlay.hidden) return;
    const sec = body.querySelector('[data-section="local-model"]');
    // #gui-folder-field: the runner has no text field; its first key (or its typed path, when open) takes the focus
    const el = !sec ? null : 'field' in t ? (sec.querySelector(`[data-lm-field="${CSS.escape(t.field)}"]`) ?? sec.querySelector(`[data-ff="lm-${CSS.escape(t.field)}"] [data-ff-typed], [data-ff="lm-${CSS.escape(t.field)}"] [data-ff-act]`)) : 'act' in t ? ([...sec.querySelectorAll(`[data-lm-act="${CSS.escape(t.act)}"]`)].find((b) => !(b as HTMLButtonElement).disabled) ?? null) : sec.querySelector('h3');
    (el as HTMLElement | null)?.focus();
  };
  // section-focused: the key-edge rule stays until focus leaves the section
  body.addEventListener('focusout', (e) => {
    if (painting || !focused) return;
    const sec = body.querySelector(`[data-section="${CSS.escape(focused)}"]`);
    const to = (e as FocusEvent).relatedTarget as Node | null;
    if (sec && to && !sec.contains(to)) {
      sec.classList.remove('focused');
      focused = null;
    }
  });
  body.addEventListener('click', (e) => {
    if (!e.isTrusted) return; // G-GUI-04: only the human's own press
    const t = e.target as HTMLElement;
    const rv = t.closest('[data-standing-revoke]') as HTMLElement | null;
    if (rv) return d.revoke(rv.dataset.standingRevoke!);
    const ff = t.closest('[data-ff-act]') as HTMLButtonElement | null;
    if (ff) {
      if (!ff.disabled) d.local?.folder?.(ff.dataset.ffAct!, ff.dataset.ffReal ?? null, e.isTrusted);
      return;
    }
    const lm = t.closest('[data-lm-act]') as HTMLButtonElement | null;
    if (lm) {
      // the submit key presses through the form's submit (Enter in a field presses it too)
      if (lm.disabled || lm.type === 'submit') return;
      if (lm.dataset.lmAct!.startsWith('mcp:')) return d.mcp?.press(lm.dataset.lmAct!, lm.dataset.lmValue ?? null, e.isTrusted);
      return d.local?.press(lm.dataset.lmAct!, lm.dataset.lmValue ?? null, e.isTrusted);
    }
    const b = t.closest('[data-settings-run]') as HTMLButtonElement | null;
    if (!b || b.disabled) return;
    const id = b.dataset.settingsRun!;
    if (!SETTINGS_RUNS.has(id)) return;
    d.run(id);
    repaint();
  });
  body.addEventListener('submit', (e) => {
    e.preventDefault(); // never a navigation
    if (!e.isTrusted) return; // G-GUI-04
    d.local?.submit(e.isTrusted);
  });
  body.addEventListener('input', (e) => {
    const f = e.target as HTMLInputElement;
    const name = f.dataset?.lmField;
    if (name) d.local?.input(name, f.value);
    if (f.dataset?.ffTyped !== undefined) d.local?.folderInput?.(f.value);
  });
  body.addEventListener('compositionstart', () => ime.start());
  body.addEventListener('compositionend', (e) => {
    // the composed text (some engines send their last input before this event, some after)
    const f = e.target as HTMLInputElement;
    const name = f.dataset?.lmField;
    const owed = ime.end();
    if (name) d.local?.input(name, f.value);
    if (owed) repaint();
  });
  // <details> toggle does not bubble: listen in the capture phase
  body.addEventListener(
    'toggle',
    (e) => {
      const t = e.target as HTMLDetailsElement;
      if (painting || !t.classList?.contains('sf-adv')) return;
      const s = t.querySelector('summary');
      if (s) s.textContent = `Advanced ${t.open ? '▾' : '▸'}`;
      d.local?.advanced(t.open);
    },
    true,
  );
  document.getElementById('settings-close')?.addEventListener('click', close);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close(); // a press on the scrim closes it
  });
  return {
    open,
    close,
    isOpen: () => !overlay.hidden,
    repaint,
    escape: () => {
      if (!d.local?.escape()) close();
    },
    focusLocal,
  };
}
