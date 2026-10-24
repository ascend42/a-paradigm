/**
 * @symbol #gui-wordmark-menu
 *
 * #gui-wordmark-menu (board header-5b, Atelier 2026-10-21-gnomon-voice refs/header-5b.html option C; design-system
 * gnomon.voice.header and gnomon.layout). PURE.
 *
 *   - The header row is four things: the wordmark menu "Gnomon ▾", the ⌘K palette field, quiet kernel status (the
 *     link dot and the browser-risk chip) and the kernel-owned voice pill (HEADER_ITEMS). Every control is 28px and
 *     never wraps. The narrow-width pane toggles sit at the row's two ends and are not items.
 *   - The rare tools live in the wordmark menu (and ⌘K), never as header keys: Layout presets with the panes and
 *     Workshop placement behind "Panes and Workshop…", Day / Night / Auto, Mods…, Voice settings…, Settings… ⌘,, and
 *     a who's-connected line (appMenuModel). Every row runs an existing GUI command (APP_MENU_RUNS); kernel-owned
 *     chrome (the pill, the link, the risk chip, the run mode) is never a row.
 *   - Keyboard (WAI-ARIA menu button): Enter / Space are the trigger button's own click (opens, the first row takes
 *     focus); ↓ opens on the first row and ↑ on the last (triggerKey); inside, ↑ / ↓ wrap, Home / End, Esc closes
 *     and focus returns to the trigger, Tab closes (menuKey).
 *   - Quiet status: the link is a dot and gains a word only when not connected (linkView); the who line names the
 *     principal, the connection and the log head (whoLine).
 */
import { PRESETS, WORKSHOP_PLACES, type Layout } from './commands.js';
import type { ThemeSwitchEntry } from './settings.js';

/** The header row's items, in order (index.html `<header class="chrome">`; the pane toggles are not items). */
export const HEADER_ITEMS: readonly string[] = Object.freeze(['wordmark-menu', 'palette', 'kernel-status', 'voice-pill']);

export type AppMenuRow =
  | { kind: 'head'; label: string }
  | { kind: 'rule' }
  | { kind: 'item'; run: string; name: string; note?: string; kbd?: string; radio?: boolean; checked?: boolean; expands?: boolean; expanded?: boolean }
  | { kind: 'theme'; options: Array<{ run: string; label: string; checked: boolean; title: string }> }
  | { kind: 'who'; text: string };

/** The menu-only run that shows or hides the panes and Workshop rows in place (not a palette command). */
export const PANES_RUN = 'menu.panes';

const PRESET_NOTE: Readonly<Record<string, string>> = Object.freeze({ desk: 'sessions · chat · stack', focus: 'the chat only', decide: 'the stack wide' });
const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

/** The wordmark menu, top to bottom (refs/header-5b.html option C). */
export function appMenuModel(i: { layout: Layout; panesOpen: boolean; theme: readonly ThemeSwitchEntry[]; who: string; loops?: { note: string; paused: boolean; off?: boolean } | null }): AppMenuRow[] {
  const rows: AppMenuRow[] = [{ kind: 'head', label: 'layout' }];
  for (const name of Object.keys(PRESETS)) rows.push({ kind: 'item', run: `layout.${name}`, name: cap(name), note: PRESET_NOTE[name] ?? '', radio: true, checked: i.layout.name === name });
  rows.push({ kind: 'item', run: PANES_RUN, name: 'Panes and Workshop…', note: 'show or hide a pane, move the Workshop', expands: true, expanded: i.panesOpen });
  if (i.panesOpen) {
    const v = i.layout.visible;
    rows.push({ kind: 'item', run: 'pane.sessions.toggle', name: `${v.sessions ? 'Hide' : 'Show'} sessions` });
    rows.push({ kind: 'item', run: 'pane.stack.toggle', name: `${v.stack ? 'Hide' : 'Show'} the stack` });
    rows.push({ kind: 'item', run: 'pane.workshop.toggle', name: `${v.workshop ? 'Hide' : 'Show'} the Workshop` });
    for (const p of WORKSHOP_PLACES) rows.push({ kind: 'item', run: `workshop.${p}`, name: `Workshop: ${p}`, note: p === 'footer' ? 'a strip under the desk' : `a column on the ${p}`, radio: true, checked: v.workshop && i.layout.workshop === p });
  }
  // #gui-loops (board running-indicator): the Loops leaf and Pause all loops, when the kernel serves loops
  if (i.loops) {
    rows.push({ kind: 'rule' });
    rows.push({ kind: 'item', run: 'loops.open', name: 'Loops…', note: i.loops.note });
    if (!i.loops.paused && !i.loops.off) rows.push({ kind: 'item', run: 'loops.pause-all', name: 'Pause all loops', note: 'no presence · resuming needs it' });
  }
  rows.push({ kind: 'rule' }, { kind: 'head', label: 'theme' });
  rows.push({ kind: 'theme', options: i.theme.map((e) => ({ run: e.run, label: e.label, checked: e.current, title: e.title })) });
  rows.push({ kind: 'rule' });
  rows.push({ kind: 'item', run: 'mods.open', name: 'Mods…', note: 'installed, available, add from folder' });
  rows.push({ kind: 'item', run: 'voice.settings.open', name: 'Voice settings…' });
  rows.push({ kind: 'item', run: 'settings.open', name: 'Settings…', kbd: '⌘,' });
  rows.push({ kind: 'rule' }, { kind: 'who', text: i.who });
  return rows;
}

/** Every run a wordmark-menu row may name: existing GUI commands only (presentation), plus the in-place panes toggle. */
export const APP_MENU_RUNS: ReadonlySet<string> = new Set([
  ...Object.keys(PRESETS).map((n) => `layout.${n}`),
  PANES_RUN,
  'pane.sessions.toggle',
  'pane.stack.toggle',
  'pane.workshop.toggle',
  ...WORKSHOP_PLACES.map((p) => `workshop.${p}`),
  'theme.day',
  'theme.night',
  'theme.auto',
  'mods.open',
  'voice.settings.open',
  'settings.open',
  'loops.open',
  'loops.pause-all',
]);

/** A key on the trigger while the menu is closed: ↓ opens on the first row, ↑ on the last (Enter / Space are its click). */
export function triggerKey(key: string): 'first' | 'last' | null {
  return key === 'ArrowDown' ? 'first' : key === 'ArrowUp' ? 'last' : null;
}

export type MenuStep = { kind: 'move'; to: number } | { kind: 'close'; focusTrigger: boolean } | null;

/** A key inside the open menu, `at` the focused row's index among `n` focusable rows (-1: none focused). */
export function menuKey(key: string, at: number, n: number): MenuStep {
  if (key === 'Escape') return { kind: 'close', focusTrigger: true };
  if (key === 'Tab') return { kind: 'close', focusTrigger: false };
  if (n <= 0) return null;
  if (key === 'ArrowDown') return { kind: 'move', to: at < 0 ? 0 : (at + 1) % n };
  if (key === 'ArrowUp') return { kind: 'move', to: at < 0 ? n - 1 : (at - 1 + n) % n };
  if (key === 'Home') return { kind: 'move', to: 0 };
  if (key === 'End') return { kind: 'move', to: n - 1 };
  return null;
}

export type LinkState = 'connecting' | 'connected' | 'restarting' | 'none';

/**
 * The kernel link, quiet when well: a filled dot alone while connected (its word kept for screen readers only);
 * every other state shows its word beside an empty dot, so the state never rides on colour alone.
 */
export function linkView(state: LinkState, who: { principal: string; connId: string } | null = null): { ok: boolean; word: string; wordShown: boolean; title: string } {
  const word = state === 'connected' ? 'connected' : state === 'restarting' ? 'restarting…' : state === 'connecting' ? 'connecting…' : 'not connected';
  const title = state === 'connected' && who ? `kernel connected · ${who.principal} · conn …${who.connId.slice(-8)} (Gnomon menu, Settings → About)` : `kernel ${word}`;
  return { ok: state === 'connected', word, wordShown: state !== 'connected', title };
}

/** The wordmark menu's who line: "kernel connected · ascend · conn …4f2a91c0 · log 1204", or the link's word. */
export function whoLine(state: LinkState, who: { principal: string; connId: string } | null, head: number): string {
  if (state !== 'connected' || !who) return `kernel ${linkView(state).word}`;
  return `kernel connected · ${who.principal} · conn …${who.connId.slice(-8)} · log ${head}`;
}
