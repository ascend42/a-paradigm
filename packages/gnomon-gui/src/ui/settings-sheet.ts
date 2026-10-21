/**
 * @symbol #gui-settings
 *
 * #gui-settings, the DOM side of the Settings sheet (the model is core/settings.ts). The sheet is the static
 * `#settings` overlay in index.html; this module paints its body from the model with core/render.ts `h()` (text
 * nodes only, allowlisted attributes, no inline style) and routes a press:
 *
 *   - `[data-settings-run]` → the page's own `run(id)` (the palette's path), only for an id in SETTINGS_RUNS;
 *   - `[data-standing-revoke]` → `revoke(grantId)` (core/standing.ts revokeRequest through the page's client);
 *   - read-only rows have no control at all.
 *
 * Every press must be a trusted user event (G-GUI-04): a script-made click changes nothing.
 */
import { h, type MiniDoc, type MiniEl } from '../core/render.js';
import { SETTINGS_RUNS, type SettingRow, type SettingsSection } from '../core/settings.js';

export interface SettingsDeps {
  model: () => SettingsSection[];
  run: (id: string) => void;
  revoke: (grantId: string) => void;
}

export interface SettingsSheet {
  open(): void;
  close(): void;
  isOpen(): boolean;
  repaint(): void;
}

function rowEl(doc: MiniDoc, r: SettingRow): MiniEl {
  const head = h(doc, 'span', { class: 'settings-label' }, r.label);
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
    row.appendChild(h(doc, 'span', { class: 'settings-value kernel-owned', ...(r.slot ? { 'data-gnomon-slot': r.slot } : {}) }, r.value));
    row.appendChild(h(doc, 'p', { class: 'meta settings-how' }, r.how));
  }
  return row;
}

/** Paint the model into `body` (cleared first). Exported for tests over a fake document. */
export function paintSettings(doc: MiniDoc, body: { firstChild: unknown; removeChild(c: unknown): unknown; appendChild(c: unknown): unknown }, sections: SettingsSection[]): void {
  while (body.firstChild) body.removeChild(body.firstChild);
  for (const s of sections) {
    const sec = h(doc, 'section', { class: 'settings-sec', 'data-section': s.id, 'aria-label': s.title }, h(doc, 'p', { class: 'title settings-h' }, s.title));
    for (const r of s.rows) sec.appendChild(rowEl(doc, r));
    body.appendChild(sec);
  }
}

export function mountSettings(document: Document, d: SettingsDeps): SettingsSheet {
  const overlay = document.getElementById('settings')!;
  const body = document.getElementById('settings-body')!;
  const btn = document.getElementById('settings-btn');
  let back: HTMLElement | null = null;
  const repaint = (): void => {
    if (!overlay.hidden) paintSettings(document as unknown as MiniDoc, body, d.model());
  };
  const close = (): void => {
    if (overlay.hidden) return;
    overlay.hidden = true;
    btn?.setAttribute('aria-expanded', 'false');
    back?.focus();
    back = null;
  };
  const open = (): void => {
    back = document.activeElement as HTMLElement | null;
    overlay.hidden = false;
    btn?.setAttribute('aria-expanded', 'true');
    repaint();
    document.getElementById('settings-close')?.focus();
  };
  body.addEventListener('click', (e) => {
    if (!e.isTrusted) return; // G-GUI-04: only the human's own press
    const t = e.target as HTMLElement;
    const rv = t.closest('[data-standing-revoke]') as HTMLElement | null;
    if (rv) return d.revoke(rv.dataset.standingRevoke!);
    const b = t.closest('[data-settings-run]') as HTMLButtonElement | null;
    if (!b || b.disabled) return;
    const id = b.dataset.settingsRun!;
    if (!SETTINGS_RUNS.has(id)) return;
    d.run(id);
    repaint();
  });
  document.getElementById('settings-close')?.addEventListener('click', close);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close(); // a press on the scrim closes it
  });
  return { open, close, isOpen: () => !overlay.hidden, repaint };
}
