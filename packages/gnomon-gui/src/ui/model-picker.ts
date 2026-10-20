/**
 * @symbol #gui-model-picker
 *
 * #gui-model-picker, the DOM side (decisions in core/model-picker.ts). Kept apart from app.ts (which mounts it once
 * and calls three hooks) so the chrome can be restyled without touching it:
 *
 *   - New session: a compact "claude model" select (+ a full-id field for "custom") injected after the route
 *     select; hidden for the local route; restored per folder; checked before the open is sent.
 *   - Session header: the model the KERNEL says the session runs (its rows), next to the backend, with a ▾ menu to
 *     switch. A switch needs the human's trusted click on the confirm sheet, which says truthfully what happens.
 *   - Settings → Session (read-only): any element with `data-gnomon-slot="session-model"` shows the focused
 *     session's model (the Settings sheet is another module; it only needs to carry the slot).
 * Every request is sent only on a trusted user event (G-GUI-04).
 */
import { CUSTOM, MODEL_CHOICES, modelChipText, modelLabel, openModelOf, sessionModelText, pickerProblem, rememberChoice, rememberedChoice, sessionModelOf, switchChoices, switchConfirmText, switchRequest, type StorageLike } from '../core/model-picker.js';

interface Caller {
  call<T = unknown>(method: string, params?: unknown): Promise<T>;
}
interface RowLike {
  kind: string;
  payload?: unknown;
}
export interface ModelPickerDeps {
  client: () => Caller | null;
  /** the focused session's rows (kernel log, oldest first) */
  rows: (hsid: string) => Iterable<RowLike>;
  /** is the session live (opened, not ended)? */
  live: (hsid: string) => boolean;
  focused: () => string | null;
  notice: (msg: string | null, fail?: boolean) => void;
  storage?: StorageLike;
}
export interface ModelPicker {
  /** the New-session sheet opened (restore the folder's choice) */
  onDialogOpen(): void;
  /** the session.open `model` for the sheet's route, or null when the custom id is invalid (the reason is shown) */
  openModel(route: string): string | null;
  /** remember the sheet's choice for the folder (after a trusted submit) */
  remember(cwd: string, model: string): void;
  /** the header chip for a session, appended to `into` (nothing for a local or unknown session) */
  headChip(into: HTMLElement, hsid: string | null): void;
  /** repaint the chip and the Settings slots (store change) */
  repaint(): void;
}

const el = <K extends keyof HTMLElementTagNameMap>(doc: Document, tag: K, attrs: Record<string, string> = {}, text?: string): HTMLElementTagNameMap[K] => {
  const e = doc.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (text !== undefined) e.textContent = text;
  return e;
};

export function mountModelPicker(doc: Document, d: ModelPickerDeps): ModelPicker {
  const st: StorageLike = d.storage ?? doc.defaultView!.localStorage;
  /* ── New-session sheet ─────────────────────────────────────────── */
  const route = doc.getElementById('ns-model') as HTMLSelectElement | null;
  const cwdIn = doc.getElementById('ns-cwd') as HTMLInputElement | null;
  const wrap = el(doc, 'span', { id: 'ns-claude-wrap', class: 'ns-claude' });
  const label = el(doc, 'label', { class: 'meta' }, 'claude model ');
  const sel = el(doc, 'select', { id: 'ns-claude-model', class: 'field', title: 'Which Claude model the session runs (claude --model). Remembered per folder.' });
  for (const m of MODEL_CHOICES) sel.appendChild(el(doc, 'option', { value: m }, m === CUSTOM ? 'custom id…' : m));
  label.appendChild(sel);
  const custom = el(doc, 'input', { id: 'ns-model-id', class: 'field', type: 'text', placeholder: 'claude-opus-5-5', spellcheck: 'false', maxlength: '64', 'aria-label': 'full model id' });
  custom.hidden = true;
  const why = el(doc, 'p', { id: 'ns-model-why', class: 'meta fail', role: 'status' });
  why.hidden = true;
  wrap.append(label, custom, why);
  route?.closest('label')?.after(wrap);
  const syncSheet = (): void => {
    const claude = !route || route.value === 'claude' || route.value === 'any';
    wrap.hidden = !claude;
    custom.hidden = sel.value !== CUSTOM;
    why.hidden = true;
  };
  sel.addEventListener('change', syncSheet);
  route?.addEventListener('change', syncSheet);
  const restore = (): void => {
    const r = rememberedChoice(st, cwdIn?.value.trim() || null);
    sel.value = r.choice;
    custom.value = r.custom;
    syncSheet();
  };
  cwdIn?.addEventListener('change', restore);

  /* ── header chip + switch ───────────────────────────────────────── */
  let chip: { hsid: string; btn: HTMLButtonElement; menu: HTMLElement } | null = null;
  const sheet = el(doc, 'div', { id: 'model-switch-dialog', class: 'overlay', role: 'dialog', 'aria-label': 'switch model' });
  sheet.hidden = true;
  const card = el(doc, 'form', { class: 'sheet-card', autocomplete: 'off' });
  const lines = el(doc, 'div', { class: 'model-switch-lines' });
  const customRow = el(doc, 'label', { class: 'meta' }, 'model id ');
  const customSwitch = el(doc, 'input', { id: 'model-switch-id', class: 'field', type: 'text', placeholder: 'claude-opus-5-5', spellcheck: 'false', maxlength: '64' });
  customRow.appendChild(customSwitch);
  const swWhy = el(doc, 'p', { class: 'meta fail', role: 'status' });
  swWhy.hidden = true;
  const foot = el(doc, 'div', { class: 'composer-foot' });
  const cancel = el(doc, 'button', { class: 'key', type: 'button' }, 'cancel');
  const go = el(doc, 'button', { class: 'key pri', type: 'submit' }, 'Switch');
  foot.append(cancel, go);
  card.append(lines, customRow, swWhy, foot);
  sheet.appendChild(card);
  doc.body.appendChild(sheet);
  let target: { hsid: string; from: string; to: string } | null = null;
  // Aegis L1 (G-GUI-04): the switch is armed only by the human's own gesture, recorded BEFORE the submit: a trusted
  // click on the Switch key (a keyboard press on the focused key is a trusted click too) or a trusted Enter in the
  // id field. A submit event's own isTrusted is not the gate (requestSubmit() and implicit submission blur it).
  let armed = false;
  const closeSheet = (): void => {
    sheet.hidden = true;
    target = null;
    armed = false;
  };
  go.addEventListener('click', (e) => {
    armed = e.isTrusted;
  });
  customSwitch.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') armed = e.isTrusted;
  });
  cancel.addEventListener('click', closeSheet);
  const paintLines = (): void => {
    if (!target) return;
    lines.replaceChildren(...switchConfirmText(target.from, target.to === CUSTOM ? customSwitch.value.trim() || 'the model you type' : target.to).map((t, i) => el(doc, 'p', { class: i === 0 ? 'title' : 'meta' }, t)));
  };
  customSwitch.addEventListener('input', paintLines);
  const openSheet = (hsid: string, from: string, to: string): void => {
    target = { hsid, from, to };
    customRow.hidden = to !== CUSTOM;
    customSwitch.value = '';
    swWhy.hidden = true;
    armed = false;
    paintLines();
    sheet.hidden = false;
    (to === CUSTOM ? customSwitch : go).focus();
  };
  card.addEventListener('submit', (e) => {
    e.preventDefault();
    const human = armed;
    armed = false; // one gesture, one submit
    if (!human || !target) return; // G-GUI-04: a switch is the human's own confirmed click or Enter
    const to = target.to === CUSTOM ? customSwitch.value.trim() : target.to;
    const bad = pickerProblem(target.to === CUSTOM ? CUSTOM : to, to);
    if (bad) {
      swWhy.textContent = bad;
      swWhy.hidden = false;
      return;
    }
    const { hsid } = target;
    closeSheet();
    const c = d.client();
    if (!c) return d.notice('not connected', true);
    void c.call('log.append', switchRequest(hsid, to)).then(
      () => d.notice(`model switched to ${modelLabel(to)} · the conversation continues`),
      (err: unknown) => d.notice(`model switch refused: ${err instanceof Error ? err.message : 'refused'}`, true),
    );
  });
  doc.addEventListener('click', (e) => {
    if (chip && !chip.menu.hidden && !(e.target as HTMLElement).closest('.model-wrap')) chip.menu.hidden = true;
  });

  const current = (hsid: string): ReturnType<typeof sessionModelOf> => sessionModelOf(d.rows(hsid));
  const paintChip = (): void => {
    if (!chip) return;
    const m = current(chip.hsid);
    const live = d.live(chip.hsid);
    chip.btn.textContent = `${modelChipText(m)}${live && !m?.uncertain && !m?.pending ? ' ▾' : ''}`;
    chip.btn.disabled = !live || !!m?.pending || !!m?.uncertain;
    chip.btn.title = m?.uncertain ? `Claude did not confirm the switch to ${modelLabel(m.uncertain)}; the next reply shows which model answered (${modelLabel(m.model)} on record).` : live ? `Model of this session (kernel): ${modelLabel(m?.model)}. Switch it; the conversation continues.` : `Model: ${modelLabel(m?.model)}`;
  };
  const paintSlots = (): void => {
    const h = d.focused();
    const m = h ? current(h) : null;
    for (const s of Array.from(doc.querySelectorAll('[data-gnomon-slot="session-model"]'))) s.textContent = sessionModelText(m);
  };

  return {
    onDialogOpen: restore,
    openModel(r: string): string | null {
      if (r === 'local') return 'local';
      const bad = pickerProblem(sel.value, custom.value);
      if (bad) {
        why.textContent = bad;
        why.hidden = false;
        (sel.value === CUSTOM ? custom : sel).focus();
        return null;
      }
      return openModelOf(r, sel.value, custom.value);
    },
    remember: (cwd, model) => {
      if (model !== 'local' && model !== 'any') rememberChoice(st, cwd.trim() || null, model);
    },
    headChip(into: HTMLElement, hsid: string | null): void {
      chip = null;
      if (!hsid) return;
      const m = current(hsid);
      if (!m || m.backend === 'local') return;
      const w = el(doc, 'span', { class: 'model-wrap mode-wrap' });
      const btn = el(doc, 'button', { class: 'key quiet model-btn kernel-owned', type: 'button', 'aria-haspopup': 'menu', 'aria-expanded': 'false' });
      const menu = el(doc, 'span', { class: 'mode-menu model-menu', role: 'menu' });
      menu.hidden = true;
      // opening the menu and the sheet only DISPLAYS (the preview harness clicks them); the send needs the armed gesture
      btn.addEventListener('click', () => {
        const cur = current(hsid)?.model ?? 'claude';
        menu.replaceChildren(...switchChoices(cur).map((to) => {
          const b = el(doc, 'button', { class: 'mode-item', type: 'button', role: 'menuitem', 'data-model': to });
          b.append(el(doc, 'span', { class: 'mode-name' }, to === CUSTOM ? 'custom id…' : to), el(doc, 'span', { class: 'mode-note' }, to === 'default' ? "Claude Code's default" : to === CUSTOM ? 'a full model id' : 'switch, keep the conversation'));
          b.addEventListener('click', () => {
            menu.hidden = true;
            openSheet(hsid, cur, to);
          });
          return b;
        }));
        menu.hidden = !menu.hidden;
        btn.setAttribute('aria-expanded', String(!menu.hidden));
      });
      w.append(btn, menu);
      into.append(doc.createTextNode(' · '), w);
      chip = { hsid, btn, menu };
      paintChip();
    },
    repaint(): void {
      paintChip();
      paintSlots();
    },
  };
}
