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
 *     prefers-color-scheme). Slice 1 keeps the choice in page memory: the
 *     spec stores it per device through the kernel (`config.prefs`, signed by
 *     the device key) and never in the browser — that round-trip is slice 2.
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
  { id: 'pane.shuttle.toggle', title: 'Pane: show/hide Shuttle view' },
  { id: 'stack.scope.toggle', title: 'Decision stack: this project / all projects' },
  { id: 'gui.reconnect', title: 'Reconnect' },
  { id: 'diag.send', title: 'Send a diagnostic note to gui.log' },
]);

/**
 * The commands a `kit.Button` inside a block (agent- or mod-authored data) may
 * name (Aegis M1.10 C6): presentation-only. `diag.send` (writes the human's
 * gui.log) and `gui.reconnect` (raises a presence prompt) are excluded, so a
 * block can never make a press look like a kernel or presence action.
 */
export const BLOCK_SAFE_COMMANDS: ReadonlySet<string> = new Set(
  GUI_COMMANDS.map((c) => c.id).filter((id) => id !== 'diag.send' && id !== 'gui.reconnect'),
);

export type Pane ='sessions' | 'transcript' | 'stack' | 'shuttle';
export const PANES: readonly Pane[] = Object.freeze(['sessions', 'transcript', 'stack', 'shuttle'] as const);

export interface Layout {
  name: string;
  visible: Record<Pane, boolean>;
  stackWide: boolean;
}

export const PRESETS: Readonly<Record<string, Layout>> = Object.freeze({
  desk: { name: 'desk', visible: { sessions: true, transcript: true, stack: true, shuttle: true }, stackWide: false },
  focus: { name: 'focus', visible: { sessions: false, transcript: true, stack: false, shuttle: false }, stackWide: false },
  decide: { name: 'decide', visible: { sessions: true, transcript: true, stack: true, shuttle: true }, stackWide: true },
});

/** Apply a preset; the transcript pane always stays visible (it is the page's purpose). */
export function applyPreset(name: string): Layout {
  const p = PRESETS[name] ?? PRESETS.desk!;
  return { name: p.name, visible: { ...p.visible, transcript: true }, stackWide: p.stackWide };
}

export function togglePane(l: Layout, pane: Pane): Layout {
  if (pane === 'transcript') return l;
  return { ...l, name: 'custom', visible: { ...l.visible, [pane]: !l.visible[pane] } };
}

/** Round-trip shape for the per-device preset save (kernel `config.prefs`, slice 2). */
export function serializeLayout(l: Layout): string {
  return JSON.stringify({ name: l.name, visible: l.visible, stackWide: l.stackWide });
}

export function parseLayout(s: string): Layout | null {
  try {
    const v = JSON.parse(s) as Partial<Layout>;
    if (!v || typeof v.name !== 'string' || !v.visible || typeof v.stackWide !== 'boolean') return null;
    const visible = {} as Record<Pane, boolean>;
    for (const p of PANES) visible[p] = p === 'transcript' ? true : v.visible[p] === true;
    return { name: v.name, visible, stackWide: v.stackWide };
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
