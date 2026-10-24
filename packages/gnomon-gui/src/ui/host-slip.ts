/**
 * @symbol #gui-host-hints
 *
 * The host slip's DOM (design-system host-slip, a variant of the offer-slip pattern; core/host-hints.ts is the model).
 * Mounted by ui/app.ts under the reply whose text named an instruction that does not run in Gnomon. The reply above it
 * is untouched. The tab and the line are GUI words; the quoted instruction and a command's argument are model text,
 * drawn as text nodes (render.ts h(), never innerHTML). The keys are GUI-made (labels from the table), quiet keys.
 *
 * Actions, trusted presses only (wireHostSlips): Copy writes the command the slip SHOWS to the clipboard (the same
 * string the <code> holds; nothing is run or sent), and an open key runs one palette command from HOST_OPEN_IDS (a
 * screen opens; nothing is decided). Recognition never acts on its own.
 */
import { h, type MiniDoc, type MiniEl } from '../core/render.js';
import { HOST_OPEN_IDS, type HostHint, type HostOpenId } from '../core/host-hints.js';

export const HOST_GLYPH = '⊙';

/** One reply's host slips. `item` is the reply's transcript key; each key names its hint by `<item>:<n>`. */
export function renderHostSlips(doc: MiniDoc, item: string, hints: readonly HostHint[], copied: string | null = null): MiniEl[] {
  return hints.map((hint, n) => {
    const ref = `${item}:${n}`;
    const a = hint.action;
    const cmd = a?.kind === 'copy' ? h(doc, 'code', { class: 'host-cmd', 'data-host-cmd': ref }, a.command) : null;
    const key =
      a?.kind === 'copy'
        ? h(doc, 'button', { class: 'key quiet', type: 'button', 'data-host-copy': ref, 'aria-label': `Copy: ${a.command}` }, copied === ref ? 'Copied' : 'Copy')
        : a?.kind === 'open'
          ? h(doc, 'button', { class: 'key quiet', type: 'button', 'data-host-open': a.id }, a.label)
          : null;
    return h(
      doc,
      'div',
      { class: 'slip host-slip', role: 'note', 'aria-label': 'in Gnomon', 'data-host': ref },
      h(doc, 'div', { class: 'slip-tab' }, h(doc, 'span', { class: 'slip-g', 'aria-hidden': 'true' }, HOST_GLYPH), ' in Gnomon · ', h(doc, 'code', null, hint.said)),
      h(doc, 'div', { class: 'slip-q' }, hint.line),
      cmd,
      key ? h(doc, 'div', { class: 'slip-acts' }, key) : null,
    );
  });
}

const isOpenId = (s: string): s is HostOpenId => (HOST_OPEN_IDS as readonly string[]).includes(s);

/** Delegated host-slip presses on the transcript: trusted clicks only (a script-made click does nothing). */
export function wireHostSlips(root: HTMLElement, on: { copy: (ref: string, e: Event) => void; open: (id: HostOpenId, e: Event) => void }): void {
  root.addEventListener('click', (e) => {
    if (!e.isTrusted) return;
    const t = e.target as HTMLElement | null;
    const c = t?.closest('.host-slip [data-host-copy]') as HTMLElement | null;
    if (c) {
      e.preventDefault();
      return on.copy(c.dataset.hostCopy ?? '', e);
    }
    const o = t?.closest('.host-slip [data-host-open]') as HTMLElement | null;
    const id = o?.dataset.hostOpen ?? '';
    if (o && isOpenId(id)) {
      e.preventDefault();
      on.open(id, e);
    }
  });
}
