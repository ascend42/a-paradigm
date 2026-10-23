/**
 * @symbol #gui-folder-field
 *
 * #gui-folder-field, the DOM side (the model and the words are core/folder-field.ts). Draws a FolderFieldView with
 * core/render.ts `h()` (text nodes only, allowlisted attributes): every path is the kernel's escaped display string,
 * as textContent. Presses are routed by `data-ff-act` inside a `[data-ff="<id>"]` host, so one sheet can hold more
 * than one field (Mods: Add from folder and Configure command):
 *
 *   - choose (Choose folder… / Choose another… / Choose file…), typed (Type a path ▸), clear, use (the runner's
 *     "Use …/dist"), row (a recent folder; data-ff-real names it);
 *   - the typed path is the input `[data-ff-typed]`.
 *
 * mountFolderField wires one field into a host that it owns (the New session sheet): roving tabindex on the recents
 * (arrows move AND choose, Home/End jump, Tab leaves the list), focus moved where the controller asks after a paint,
 * and every press a trusted user event (G-GUI-04). Sheets that repaint their whole body (Settings, Mods) draw the
 * field with folderFieldEl and route `[data-ff-act]` through their own press paths with routeFolderPress.
 */
import { h, type MiniDoc, type MiniEl } from '../core/render.js';
import { fieldView, FF_COPY, type FolderFieldView, type FolderField } from '../core/folder-field.js';

const setId = (el: MiniEl, id: string): MiniEl => (el.setAttribute('id', id), el);

/** `code` spans for backticks in the copy (the hint names `gnomon`). */
function rich(doc: MiniDoc, tag: string, attrs: Record<string, string> | null, text: string): MiniEl {
  return h(doc, tag, attrs, ...text.split('`').map((p, i) => (i % 2 ? h(doc, 'code', null, p) : p)));
}

function lineEl(doc: MiniDoc, v: FolderFieldView, id: string, inLabel: boolean): MiniEl | null {
  if (v.error) return setId(h(doc, inLabel ? 'span' : 'p', { class: 'sf-err', role: 'alert' }, `✕ ${v.error}`), `${id}-err`);
  if (v.checking) return h(doc, inLabel ? 'span' : 'p', { class: 'sf-note', role: 'status' }, FF_COPY.checking);
  const l = v.line;
  if (!l) return null;
  if (l.tone === 'warn') return h(doc, 'p', { class: 'ff-warn', role: 'status' }, h(doc, 'strong', null, l.lead ?? ''), l.text);
  if (l.tone === 'ok') return h(doc, inLabel ? 'span' : 'p', { class: 'sf-note' }, h(doc, 'strong', null, '✓'), l.text.replace(/^✓/, ''));
  const err = setId(h(doc, inLabel ? 'span' : 'p', { class: 'sf-err', role: 'alert' }, l.text), `${id}-err`);
  if (l.suggest) err.appendChild(h(doc, 'span', null, ' ', h(doc, 'button', { class: 'key quiet', type: 'button', 'data-ff-act': 'use' }, `Use ${l.suggest.display}`)));
  return err;
}

/** One folder field as drawn (variant recents or compact). `id` scopes its element ids and its press routing. */
export function folderFieldEl(doc: MiniDoc, v: FolderFieldView, id: string, legend: { text: string; cls: string }): MiniEl {
  const ff = h(doc, 'fieldset', { class: 'ff', 'data-ff': id }, h(doc, 'legend', { class: legend.cls }, legend.text));
  if (v.hint) ff.appendChild(rich(doc, 'p', { class: 'ff-hint', role: 'status' }, v.hint));
  if (v.variant === 'recents') {
    if (v.empty) ff.appendChild(h(doc, 'p', { class: 'ff-empty' }, FF_COPY.empty));
    else {
      const list = h(doc, 'div', { class: 'ff-list', role: 'radiogroup', 'aria-label': 'Recent folders' });
      const focusable = v.rows.findIndex((r) => r.checked);
      v.rows.forEach((r, i) => {
        list.appendChild(
          h(
            doc,
            'button',
            { type: 'button', role: 'radio', class: 'ff-row', 'aria-checked': String(r.checked), tabindex: i === (focusable < 0 ? 0 : focusable) ? '0' : '-1', title: r.display, 'aria-label': r.label, 'data-ff-act': 'row', 'data-ff-real': r.real, ...(r.failed ? { 'aria-invalid': 'true' } : {}) },
            h(doc, 'span', { class: 'ff-mk', 'aria-hidden': 'true' }, r.checked ? (r.failed ? '✕' : '✓') : ''),
            h(doc, 'span', { class: `swatch h${r.hue}`, 'aria-hidden': 'true' }),
            h(doc, 'span', { class: 'ff-text' }, h(doc, 'span', { class: 'ff-name' }, r.name), h(doc, 'span', { class: 'ff-path' }, r.display)),
            h(doc, 'span', { class: 'ff-when' }, r.when),
          ),
        );
      });
      ff.appendChild(list);
    }
    if (v.opens) ff.appendChild(h(doc, 'p', { class: 'ff-opens' }, FF_COPY.opensIn, h(doc, 'strong', null, v.opens.display), v.opens.outside ? FF_COPY.outsideHome : ''));
  } else {
    ff.appendChild(h(doc, 'div', { class: 'ff-value' }, v.value ? h(doc, 'span', { class: 'ff-p' }, h(doc, 'strong', null, v.value.display)) : h(doc, 'span', { class: 'ff-p ff-none' }, v.none)));
  }
  const keys = h(doc, 'div', { class: 'ff-keys' });
  if (v.chooseLabel) {
    // busy, not disabled: a disabled key drops the focus the human pressed it with to <body> (the controller ignores
    // a second press while the chooser is open)
    keys.appendChild(h(doc, 'button', { class: 'key', type: 'button', 'data-ff-act': 'choose', ...(v.choosing ? { 'aria-busy': 'true', 'aria-disabled': 'true' } : {}) }, v.chooseLabel));
  }
  if (v.clear) keys.appendChild(h(doc, 'button', { class: 'key quiet', type: 'button', 'data-ff-act': 'clear' }, FF_COPY.clear));
  keys.appendChild(h(doc, 'button', { class: 'key quiet', type: 'button', 'data-ff-act': 'typed', 'aria-expanded': String(v.typedOpen), 'aria-controls': `${id}-typed` }, v.typedLabel));
  ff.appendChild(keys);
  if (v.status) ff.appendChild(h(doc, 'p', { class: 'ff-status', role: 'status' }, v.status));
  if (v.noChooser) ff.appendChild(h(doc, 'p', { class: 'ff-status', role: 'status' }, v.noChooser));
  const typedLine = v.typedOpen && v.typed.trim() !== '';
  // the amber warning is ONE line, under the field (it was drawn inside the typed label AND again under it)
  const warnOnly = v.line?.tone === 'warn' && !v.error && !v.checking;
  if (v.typedOpen) {
    const input = h(doc, 'input', { class: 'field', type: 'text', 'data-ff-typed': id, value: v.typed, maxlength: '1024', ...(typedLine && (v.error || v.line?.tone === 'err') ? { 'aria-invalid': 'true', 'aria-describedby': `${id}-err` } : {}) });
    input.setAttribute('spellcheck', 'false');
    input.setAttribute('autocomplete', 'off');
    const label = setId(h(doc, 'label', { class: 'ff-typed sf-field' }, h(doc, 'span', { class: 'meta' }, FF_COPY.typedLabel), input), `${id}-typed`);
    const l = typedLine && !warnOnly ? lineEl(doc, v, id, true) : null;
    label.appendChild(l ?? h(doc, 'span', { class: 'sf-note' }, FF_COPY.typedNote));
    ff.appendChild(label);
  }
  if (!typedLine) {
    const l = lineEl(doc, v, id, false);
    if (l) ff.appendChild(l);
  } else if (warnOnly) {
    const l = lineEl(doc, v, id, false);
    if (l) ff.appendChild(l);
  }
  if (v.sr) ff.appendChild(h(doc, 'p', { class: 'sr-only', role: 'status' }, v.sr));
  return ff;
}

/** A press inside a field's host, for sheets that own their own event path. Returns true when it was a field press. */
export function routeFolderPress(field: FolderField, act: string, real: string | null, trusted: boolean): boolean {
  if (!trusted) return true; // G-GUI-04: a script-made press changes nothing
  if (act === 'choose') void field.choose();
  else if (act === 'typed') field.toggleTyped();
  else if (act === 'clear') field.clear();
  else if (act === 'use') field.useSuggestion();
  else if (act === 'row' && real) field.pickRecent(real, 'chosen');
  else return false;
  return true;
}

/** Move focus where the controller asked (after a paint). */
export function focusFolder(host: ParentNode, field: FolderField): void {
  const f = field.takeFocus();
  if (!f) return;
  const sel = f === 'chosen' ? '.ff-row[aria-checked="true"]' : f === 'choose' ? '[data-ff-act="choose"]' : '[data-ff-typed]';
  const el = (host.querySelector(sel) ?? (f === 'chosen' ? host.querySelector('[data-ff-act="choose"]') : null)) as HTMLElement | null;
  el?.focus();
}

export interface MountedFolderField {
  paint(): void;
}

/**
 * Wire a field into a host it owns (the New session sheet). `onEnter` is the sheet's submit for Enter on a row or in
 * the typed field (design behaviour: "Enter anywhere submits the sheet").
 */
export function mountFolderField(doc: Document, host: HTMLElement, field: FolderField, o: { id: string; variant: 'recents' | 'compact'; legend: { text: string; cls: string }; onEnter?: (trusted: boolean) => void }): MountedFolderField {
  const paint = (): void => {
    const active = doc.activeElement as HTMLElement | null;
    const keep = active && host.contains(active) ? (active.dataset.ffTyped !== undefined ? { typed: true, caret: (active as HTMLInputElement).selectionStart } : { act: active.dataset.ffAct, real: active.dataset.ffReal }) : null;
    host.replaceChildren(folderFieldEl(doc as unknown as MiniDoc, fieldView(field, o.variant), o.id, o.legend) as unknown as Node);
    if (keep && 'typed' in keep) {
      const i = host.querySelector('[data-ff-typed]') as HTMLInputElement | null;
      if (i) {
        i.focus();
        if (typeof keep.caret === 'number') i.setSelectionRange(keep.caret, keep.caret);
      }
    } else if (keep?.act) {
      const sel = keep.act === 'row' && keep.real ? `[data-ff-act="row"][data-ff-real="${CSS.escape(keep.real)}"]` : `[data-ff-act="${CSS.escape(keep.act)}"]`;
      (host.querySelector(sel) as HTMLElement | null)?.focus();
    }
    focusFolder(host, field);
  };
  host.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest('[data-ff-act]') as HTMLButtonElement | null;
    if (!b || b.disabled || !host.contains(b)) return;
    routeFolderPress(field, b.dataset.ffAct!, b.dataset.ffReal ?? null, e.isTrusted);
  });
  host.addEventListener('input', (e) => {
    const t = e.target as HTMLInputElement;
    if (t.dataset.ffTyped !== undefined) field.typedInput(t.value);
  });
  host.addEventListener('keydown', (e) => {
    const t = e.target as HTMLElement;
    if (e.key === 'Enter' && (t.classList.contains('ff-row') || t.dataset.ffTyped !== undefined) && o.onEnter) {
      e.preventDefault();
      return o.onEnter(e.isTrusted);
    }
    if (!t.classList.contains('ff-row')) return;
    const rows = [...host.querySelectorAll<HTMLElement>('.ff-row')];
    const i = rows.indexOf(t);
    const to = e.key === 'ArrowDown' || e.key === 'ArrowRight' ? (i + 1) % rows.length : e.key === 'ArrowUp' || e.key === 'ArrowLeft' ? (i - 1 + rows.length) % rows.length : e.key === 'Home' ? 0 : e.key === 'End' ? rows.length - 1 : -1;
    if (to < 0) return;
    e.preventDefault();
    if (!e.isTrusted) return; // G-GUI-04
    field.pickRecent(rows[to]!.dataset.ffReal!, 'chosen');
  });
  return { paint };
}
