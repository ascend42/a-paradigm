/**
 * @symbol #gui-host-hints
 *
 * The host slip's DOM (design-system host-slip, a variant of the offer-slip pattern; core/host-hints.ts is the model).
 * Mounted by ui/app.ts under the reply whose text named an instruction that does not run in Gnomon: one slip per reply
 * (tab "⊙ note · gnomon"), one item per instruction. The reply above it is untouched. The tab and the line are GUI words; the quoted instruction and a command's argument are model text,
 * drawn as text nodes (render.ts h(), never innerHTML). The keys are GUI-made (labels from the table), quiet keys.
 *
 * Actions, trusted presses only (wireHostSlips): Copy writes the command the slip SHOWS to the clipboard (the same
 * string the <code> holds; nothing is run or sent), and an open key runs one palette command from HOST_OPEN_IDS (a
 * screen opens; nothing is decided). Recognition never acts on its own.
 */
import { h, type MiniDoc, type MiniEl } from '../core/render.js';
import { HOST_OPEN_IDS, NO_SLASH, type HostHint, type HostOpenId } from '../core/host-hints.js';

export const HOST_GLYPH = '⊙';
/** The tab: the gnomon family glyph, then "note · gnomon" (as an offer's "offer · mod:<name>"): Gnomon's words, not the agent's. */
export const HOST_TAB = 'note · gnomon';

/** A said instruction that is a command (a slash command or a claude line) is drawn as code; prose is quoted. */
const isCommandSaid = (said: string): boolean => /^(?:\/|claude\b)/.test(said);
/** NO_SLASH-led lines after the first drop the repeated lead ("Slash commands don't run in Gnomon."), and a line equal to the one before it is not repeated. */
function linesOf(hints: readonly HostHint[]): Array<string | null> {
  let saidNoSlash = false;
  let prev: string | null = null;
  return hints.map((hint) => {
    const lead = hint.line.startsWith(NO_SLASH);
    const core = lead ? hint.line.slice(NO_SLASH.length).trim() : hint.line;
    const shown = core === prev ? null : lead && (!saidNoSlash || !core) ? hint.line : core;
    if (lead) saidNoSlash = true;
    prev = core;
    return shown;
  });
}

/**
 * One reply's host slip: ONE slip (group-by-space-before-boxes; Mika 2026-10-23, Delta 10), one item per hint, in
 * reading order. `item` is the reply's transcript key; each key names its hint by `<item>:<n>`. Returns [] or [slip].
 */
export function renderHostSlips(doc: MiniDoc, item: string, hints: readonly HostHint[], copied: string | null = null): MiniEl[] {
  if (!hints.length) return [];
  const lines = linesOf(hints);
  const items = hints.map((hint, n) => {
    const ref = `${item}:${n}`;
    const a = hint.action;
    const said = isCommandSaid(hint.said) ? h(doc, 'code', null, hint.said) : `“${hint.said}”`;
    // Aegis M1: the reply's argument (always the command's tail) is underlined and labelled; the text copied is the
    // whole <code>'s text, the same string as a.command (app.ts onHostCopy checks it)
    const argAt = a?.kind === 'copy' && a.arg && a.command.endsWith(a.arg) ? a.command.length - a.arg.length : -1;
    const cmd =
      a?.kind === 'copy'
        ? argAt > 0
          ? h(doc, 'code', { class: 'host-cmd', 'data-host-cmd': ref }, a.command.slice(0, argAt), h(doc, 'span', { class: 'host-arg' }, a.command.slice(argAt)))
          : h(doc, 'code', { class: 'host-cmd', 'data-host-cmd': ref }, a.command)
        : null;
    const argNote = argAt > 0 ? h(doc, 'div', { class: 'host-note' }, 'underlined: named in the reply, not by Gnomon') : null;
    const warn = hint.warn ? h(doc, 'div', { class: 'host-note host-warn' }, hint.warn) : null;
    const key =
      a?.kind === 'copy'
        ? h(doc, 'button', { class: 'key quiet', type: 'button', 'data-host-copy': ref, 'aria-label': `${copied === ref ? 'Copied' : 'Copy'}: ${a.command}` }, copied === ref ? 'Copied' : 'Copy')
        : a?.kind === 'open'
          ? h(doc, 'button', { class: 'key quiet', type: 'button', 'data-host-open': a.id, 'data-host-ref': ref }, a.label)
          : null;
    return h(
      doc,
      'div',
      { class: 'host-item', 'data-host': ref },
      h(doc, 'div', { class: 'host-said' }, said),
      lines[n] ? h(doc, 'div', { class: 'slip-q' }, lines[n]) : null,
      cmd,
      argNote,
      warn,
      key ? h(doc, 'div', { class: 'slip-acts' }, key) : null,
    );
  });
  return [
    h(
      doc,
      'div',
      { class: 'slip host-slip', role: 'note', 'aria-label': 'note from Gnomon', 'data-host': item },
      h(doc, 'div', { class: 'slip-tab' }, h(doc, 'span', { class: 'slip-g', 'aria-hidden': 'true' }, HOST_GLYPH), ` ${HOST_TAB}`),
      ...items,
    ),
  ];
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
