/**
 * @symbol #gui
 *
 * #gui command palette, layout presets and theme choice (spec §11.3, §11.4
 * chrome principle D42, `G-GUI-08`, `G-GUI-10`). PURE.
 *
 *   - The palette lists every GUI command and every kernel verb the
 *     principal may call (from `status.verbs[]`), by id, with its keybinding.
 *     Mod commands join with M1.11's mod host relays.
 *   - Layout presets are named arrangements of panes. KERNEL-OWNED chrome (the
 *     extension-risk badge, the connection/identity readout) is not a pane:
 *     no preset can name, move or hide it.
 *   - Theme: day (papercraft) | night (phosphor) | auto (OS
 *     prefers-color-scheme). #gui-settings keeps the choice (and the in-app
 *     motion override) per browser, like the Layout (core/settings.ts
 *     THEME_KEY); the spec's per-device kernel round-trip (`config.prefs`,
 *     signed by the device key) is still slice 2.
 */

export interface Command {
  id: string;
  title: string;
  keys?: string;
  /** a kernel verb (shown, gated by status.verbs[].available) */
  verb?: boolean;
  available?: boolean;
  why?: string;
}

export const GUI_COMMANDS: readonly Command[] = Object.freeze([
  { id: 'palette.open', title: 'Command palette', keys: '⌘K / Ctrl+K' },
  { id: 'session.new', title: 'New session', keys: '⌘N / Ctrl+N' },
  { id: 'composer.focus', title: 'Focus the composer', keys: '/' },
  // #gui-settings: the sheet that gathers every setting (also the header ⚙ key)
  { id: 'settings.open', title: 'Settings…', keys: '⌘, / Ctrl+,' },
  { id: 'view.kernel-feed', title: 'Kernel feed: every raw log row (S2.3: a view, never the default centre)' },
  { id: 'theme.day', title: 'Theme: day (papercraft)' },
  { id: 'theme.night', title: 'Theme: night (phosphor)' },
  { id: 'theme.auto', title: 'Theme: auto (follow the OS)' },
  { id: 'motion.reduce', title: 'Motion: reduce (in-app)' },
  { id: 'motion.system', title: 'Motion: follow the OS' },
  { id: 'layout.desk', title: 'Layout: desk (sessions · transcript · stack)' },
  { id: 'layout.focus', title: 'Layout: focus (transcript only)' },
  { id: 'layout.decide', title: 'Layout: decide (stack wide)' },
  { id: 'pane.sessions.toggle', title: 'Pane: show/hide sessions' },
  { id: 'pane.stack.toggle', title: 'Pane: show/hide decision stack' },
  { id: 'pane.workshop.toggle', title: 'Pane: show/hide the Workshop (needs you / working caps)' },
  // S5.2: where the Workshop (a sidebar-slot mod view) mounts; the mod's manifest slot never changes
  { id: 'workshop.footer', title: 'Workshop: footer strip (default)' },
  { id: 'workshop.right', title: 'Workshop: right column' },
  { id: 'workshop.left', title: 'Workshop: left column' },
  { id: 'stack.scope.toggle', title: 'Decision stack: this project / all projects' },
  // §11.4 run-mode commands (P8-D87): the focused session's folder (mode.repo.*, the default scope, F2 of
  // TD-2026-10-20-086), or this session only (mode.*); a looser mode asks for presence
  { id: 'mode.repo.manual', title: 'Mode: manual (this folder) — writes and commands wait on a plan' },
  { id: 'mode.repo.ask', title: 'Mode: ask (this folder) — every write and command asks' },
  { id: 'mode.repo.auto-edits', title: 'Mode: auto-edits (this folder) — edits in this folder pass', keys: '⇧Tab cycles' },
  { id: 'mode.manual', title: 'Mode: manual (this session only)' },
  { id: 'mode.ask', title: 'Mode: ask (this session only)' },
  { id: 'mode.auto-edits', title: 'Mode: auto-edits (this session only)' },
  // V2d voice (TD-2026-10-19-298): the focused session (or the attached one); the global hotkeys live in the voice app
  { id: 'voice.off', title: 'Voice: off — close the mic' },
  { id: 'voice.ptt', title: 'Voice: push-to-talk — hold the hotkey to talk', keys: 'hold ⌃⌥Space (voice app)' },
  { id: 'voice.ambient', title: 'Voice: ambient — the mic stays open (Touch ID the first time)' },
  // V2e (T-2026-10-19-026): the voice app's lifecycle and enrolment, no terminal step
  { id: 'voice.client.start', title: 'Voice: start the voice app' },
  { id: 'voice.client.stop', title: 'Voice: stop the voice app' },
  { id: 'voice.enrol', title: 'Voice: teach Gnomon your voice' },
  // dictation (TD-2026-10-20-262): the auto-send delay after silence, per machine (the pill menu has the same picks)
  { id: 'voice.delay.3000', title: 'Dictation: auto-send after 3 s of silence' },
  { id: 'voice.delay.5000', title: 'Dictation: auto-send after 5 s of silence (default)' },
  { id: 'voice.delay.8000', title: 'Dictation: auto-send after 8 s of silence' },
  { id: 'voice.delay.15000', title: 'Dictation: auto-send after 15 s of silence' },
  { id: 'voice.delay.off', title: 'Dictation: never auto-send (Send or Enter only)' },
  { id: 'voice.dictation.hold', title: 'Dictation: hold / resume the auto-send', keys: '⌃⌥H (voice app)' },
  { id: 'gui.reconnect', title: 'Reconnect' },
  { id: 'diag.send', title: 'Send a diagnostic note to gui.log' },
]);

/**
 * The commands a `kit.Button` inside a block (agent- or mod-authored data) may
 * name (Aegis M1.10 C6): presentation-only. `diag.send` (writes the human's
 * gui.log), `gui.reconnect` (raises a presence prompt), every `mode.*`
 * (changes a run mode, P8-D87) and every `voice.*` (opens or closes the mic, V2d) are excluded, so a block can never make a
 * press look like a kernel or presence action.
 */
export const BLOCK_SAFE_COMMANDS: ReadonlySet<string> = new Set(
  // Aegis S5 L4: no pane.* / workshop.* either: a mod button could otherwise hide the Workshop or the status line
  // #gui-settings: nor settings.* (a block must not open the permissions sheet under the human's pointer)
  GUI_COMMANDS.map((c) => c.id).filter((id) => id !== 'diag.send' && id !== 'gui.reconnect' && !id.startsWith('mode.') && !id.startsWith('voice.') && !id.startsWith('pane.') && !id.startsWith('workshop.') && !id.startsWith('settings.')),
);

export type Pane = 'sessions' | 'transcript' | 'stack' | 'workshop';
export const PANES: readonly Pane[] = Object.freeze(['sessions', 'transcript', 'stack', 'workshop'] as const);
/** S5.2: where the Workshop mounts when shown (the comp's footer strip, or its 76 px column on either edge). */
export type WorkshopPlace = 'footer' | 'right' | 'left';
export const WORKSHOP_PLACES: readonly WorkshopPlace[] = Object.freeze(['footer', 'right', 'left'] as const);

export interface Layout {
  name: string;
  visible: Record<Pane, boolean>;
  stackWide: boolean;
  workshop: WorkshopPlace;
}

export const PRESETS: Readonly<Record<string, Layout>> = Object.freeze({
  desk: { name: 'desk', visible: { sessions: true, transcript: true, stack: true, workshop: true }, stackWide: false, workshop: 'footer' },
  focus: { name: 'focus', visible: { sessions: false, transcript: true, stack: false, workshop: false }, stackWide: false, workshop: 'footer' },
  decide: { name: 'decide', visible: { sessions: true, transcript: true, stack: true, workshop: true }, stackWide: true, workshop: 'footer' },
});

/** Apply a preset; the transcript pane always stays visible (it is the page's purpose). A placement survives it. */
export function applyPreset(name: string, place: WorkshopPlace = 'footer'): Layout {
  const p = PRESETS[name] ?? PRESETS.desk!;
  return { name: p.name, visible: { ...p.visible, transcript: true }, stackWide: p.stackWide, workshop: place };
}

export function togglePane(l: Layout, pane: Pane): Layout {
  if (pane === 'transcript') return l;
  return { ...l, name: 'custom', visible: { ...l.visible, [pane]: !l.visible[pane] } };
}

/** S5.2: place the Workshop (and show it). */
export function placeWorkshop(l: Layout, place: WorkshopPlace): Layout {
  return { ...l, visible: { ...l.visible, workshop: true }, workshop: place };
}

/** Round-trip shape for the per-device preset save (localStorage now; kernel `config.prefs` later). */
export function serializeLayout(l: Layout): string {
  return JSON.stringify({ name: l.name, visible: l.visible, stackWide: l.stackWide, workshop: l.workshop });
}

export function parseLayout(s: string): Layout | null {
  try {
    const v = JSON.parse(s) as Partial<Layout> & { visible?: Record<string, unknown> };
    if (!v || typeof v.name !== 'string' || !v.visible || typeof v.stackWide !== 'boolean') return null;
    const visible = {} as Record<Pane, boolean>;
    // a layout saved before S5 named the footer `shuttle`
    for (const p of PANES) visible[p] = p === 'transcript' ? true : p === 'workshop' ? (v.visible.workshop ?? v.visible.shuttle) === true : v.visible[p] === true;
    const workshop = (WORKSHOP_PLACES as readonly unknown[]).includes(v.workshop) ? (v.workshop as WorkshopPlace) : 'footer';
    return { name: v.name, visible, stackWide: v.stackWide, workshop };
  } catch {
    return null;
  }
}

/** Palette entries: GUI commands then kernel verbs (from status.verbs). */
export function paletteEntries(status: { verbs?: Array<{ verb: string; access?: unknown; available?: boolean; milestone?: string }> } | null): Command[] {
  const verbs = (status?.verbs ?? [])
    .filter((v) => v.access !== false)
    .map((v): Command => ({ id: `verb.${v.verb}`, title: `kernel verb ${v.verb}`, verb: true, available: v.available === true, ...(v.available ? {} : { why: v.milestone ? `lands ${v.milestone}` : 'not served' }) }));
  return [...GUI_COMMANDS, ...verbs];
}

/** Subsequence match, ranked: id prefix, then title substring, then subsequence. */
export function filterCommands(all: readonly Command[], query: string): Command[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...all];
  const score = (c: Command): number => {
    const id = c.id.toLowerCase();
    const t = c.title.toLowerCase();
    if (id.startsWith(q)) return 0;
    if (t.includes(q) || id.includes(q)) return 1;
    let i = 0;
    for (const ch of `${id} ${t}`) if (ch === q[i]) i++;
    return i === q.length ? 2 : -1;
  };
  return all
    .map((c) => ({ c, s: score(c) }))
    .filter((x) => x.s >= 0)
    .sort((a, b) => a.s - b.s)
    .map((x) => x.c);
}

export type ThemeChoice = 'day' | 'night' | 'auto';

export function resolveTheme(choice: ThemeChoice, prefersDark: boolean): 'day' | 'night' {
  return choice === 'auto' ? (prefersDark ? 'night' : 'day') : choice;
}

export function resolveMotion(inApp: 'reduce' | 'system', prefersReduced: boolean): 'reduced' | 'full' {
  return inApp === 'reduce' || prefersReduced ? 'reduced' : 'full';
}
