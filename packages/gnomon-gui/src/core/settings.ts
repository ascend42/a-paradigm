/**
 * @symbol #gui-settings
 *
 * #gui-settings: the header theme switch and the Settings sheet (⚙ key, ⌘, and the palette's "Settings…"). PURE.
 * The founder's UI-first rule: every setting the GUI already has gets a guided control here; nothing is new to the
 * kernel. The sheet only gathers what exists.
 *
 *   - Every actionable control names an EXISTING GUI command id (core/commands.ts GUI_COMMANDS) that the page
 *     runs through its one `run()` path, or the standing-grant Revoke (core/standing.ts revokeRequest). The
 *     closed list is SETTINGS_RUNS; test/settings.test.ts proves every control is in it. No new kernel verb.
 *   - Kernel-owned values (the mode ceiling, the cached unlock and its bounds, the connection, the bundle pin, the
 *     rung in force) render READ-ONLY with a `how` line: how to change it, never a terminal-only path.
 *   - The Layout rows are the presets and the pane toggles only: a kernel-owned region (the voice pill, the
 *     extension-risk badge, the connection readout, the mode control, the status line) is never a row here.
 *   - Theme and in-app motion persist per browser (localStorage THEME_KEY / MOTION_KEY, a presentation
 *     preference like the Layout; the kernel `config.prefs` round-trip stays slice 2 of M1.10).
 *   - The cached unlock has no status field today, so its state is folded from the kernel-signed rows the page
 *     already reads (`approval.unlock`, `approval.unlock.dropped`, `daemon.start`), read-only.
 */
import { CLIENT_API_ID, type VoicePreset } from '@a-company/gnomon-contracts';
import { GUI_COMMANDS, PRESETS, WORKSHOP_PLACES, resolveMotion, resolveTheme, type Layout, type ThemeChoice } from './commands.js';
import { defaultScope, MODE_HELP, planFor, RUN_MODES, type SessionModeView } from './modes.js';
import { isKernelPrincipal, standingStatusOf, STANDING_TUPLE_TEXT } from './standing.js';
import { clientBusy, clientOf } from './voice-client.js';
import { canAttach, voiceStatusOf } from './voice.js';
import { rungOf, RUNG_NAME } from './voice-ladder.js';

export const THEME_KEY = 'gnomon.gui.theme';
export const MOTION_KEY = 'gnomon.gui.motion';
export const THEME_CHOICES: readonly ThemeChoice[] = Object.freeze(['day', 'night', 'auto'] as const);

/** A stored theme choice; anything else (nothing stored, a private window, a stale value) is auto. */
export function parseTheme(v: string | null | undefined): ThemeChoice {
  return v === 'day' || v === 'night' || v === 'auto' ? v : 'auto';
}
export function parseMotion(v: string | null | undefined): 'reduce' | 'system' {
  return v === 'reduce' ? 'reduce' : 'system';
}

export interface ThemeSwitchEntry {
  choice: ThemeChoice;
  run: string;
  glyph: string;
  label: string;
  current: boolean;
  title: string;
}

/** The header's Day / Night / Auto segmented switch: which is chosen, and what auto resolves to right now. */
export function themeSwitchEntries(choice: ThemeChoice, prefersDark: boolean): ThemeSwitchEntry[] {
  const now = resolveTheme('auto', prefersDark);
  return [
    { choice: 'day', run: 'theme.day', glyph: '☀', label: 'Day', current: choice === 'day', title: 'Day: papercraft, whatever the Mac is set to' },
    { choice: 'night', run: 'theme.night', glyph: '☾', label: 'Night', current: choice === 'night', title: 'Night: phosphor, whatever the Mac is set to' },
    { choice: 'auto', run: 'theme.auto', glyph: '◐', label: 'Auto', current: choice === 'auto', title: `Auto: follow the Mac's appearance (${now} now)` },
  ];
}

/* ── the sheet's model ───────────────────────────────────────────── */

export interface SettingOption {
  run: string;
  label: string;
  current: boolean;
  disabled?: boolean;
  note?: string;
}
export type SettingRow =
  | { kind: 'choice'; id: string; label: string; options: SettingOption[]; note?: string }
  | { kind: 'toggle'; id: string; label: string; run: string; on: boolean; note?: string }
  | { kind: 'action'; id: string; label: string; run: string; note?: string }
  | { kind: 'revoke'; id: string; label: string; grantId: string; note?: string }
  | { kind: 'readonly'; id: string; label: string; value: string; how: string; slot?: string };

export type SectionId = 'appearance' | 'layout' | 'voice' | 'permissions' | 'about';
export interface SettingsSection {
  id: SectionId;
  title: string;
  rows: SettingRow[];
}

/** The run ids a Settings control may name: existing GUI commands only (plus the standing Revoke, a kind of its own). */
export const SETTINGS_RUNS: ReadonlySet<string> = new Set(
  GUI_COMMANDS.map((c) => c.id).filter(
    (id) =>
      id.startsWith('theme.') ||
      id.startsWith('motion.') ||
      id.startsWith('layout.') ||
      id === 'pane.sessions.toggle' ||
      id === 'pane.stack.toggle' ||
      id === 'pane.workshop.toggle' ||
      id.startsWith('workshop.') ||
      id.startsWith('mode.repo.') ||
      id === 'voice.client.start' ||
      id === 'voice.client.stop' ||
      id === 'voice.settings.open',
  ),
);

/** The cached unlock as this page last saw it logged (kernel rows only). */
export interface UnlockSeen {
  state: 'none' | 'open' | 'ended';
  at: string | null;
  reason: string | null;
}

/**
 * Fold the kernel feed's unlock rows (oldest first): `approval.unlock` opens, `approval.unlock.dropped` ends,
 * `daemon.start` clears (a new kernel holds no unlock). Only kernel-principal rows for this connection or this
 * device (scope 'device') count; anything else is ignored. Never a guess of "unlocked" from anything else.
 */
export function unlockSeenOf(rows: Iterable<{ kind: string; at?: string; principal?: string; payload?: unknown }>, connId: string | null, kernel?: string | null): UnlockSeen {
  let out: UnlockSeen = { state: 'none', at: null, reason: null };
  for (const r of rows) {
    if (r.kind === 'daemon.start') {
      out = { state: 'none', at: null, reason: null };
      continue;
    }
    if (r.kind !== 'approval.unlock' && r.kind !== 'approval.unlock.dropped') continue;
    if (!isKernelPrincipal(r.principal, kernel)) continue; // Aegis L1: the connected home's kernel only
    const p = r.payload && typeof r.payload === 'object' ? (r.payload as Record<string, unknown>) : {};
    if (!(p.scope === 'device' || (connId !== null && p.connId === connId))) continue;
    out = r.kind === 'approval.unlock' ? { state: 'open', at: r.at ?? null, reason: null } : { state: 'ended', at: r.at ?? null, reason: typeof p.reason === 'string' ? p.reason : null };
  }
  return out;
}

/** The bounds the kernel enforces on a cached unlock (unlock.ts, F4/F5): shown as text, never configurable here. */
export const UNLOCK_BOUNDS_TEXT = 'It ends when the screen locks, the Mac sleeps or you switch user, and at the latest after 12 h or 512 signatures (an older Touch ID helper ends it sooner: 15 min idle, 60 min, 64).';

export interface SettingsInput {
  theme: ThemeChoice;
  motion: 'reduce' | 'system';
  prefersDark: boolean;
  prefersReduced: boolean;
  layout: Layout;
  status: Record<string, unknown> | null;
  /** the focused session's run mode (status.runModes), or null */
  mode: SessionModeView | null;
  /** the page's voice preset (core/voice-presets.ts), for the rung readout on an older kernel; absent = dictate */
  voicePreset?: VoicePreset;
  /** #gui-model-picker: the focused session's model text (core/model-picker.ts sessionModelText); absent = no row */
  sessionModel?: string;
  /** this page's connection, or null when not connected */
  connection: { principal: string; connId: string; surface: string; clientApiDrift: boolean } | null;
  gui: { name: string; version: string };
  unlock: UnlockSeen;
  /** a clock for "until 18:00" (tests pass a fixed formatter) */
  time?: (iso: string) => string;
}

const short = (s: string, n = 12): string => (s.length > n + 4 ? `${s.slice(0, n)}…${s.slice(-4)}` : s);
const timeOf = (iso: string): string => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};

export function settingsModel(i: SettingsInput): SettingsSection[] {
  const fmt = i.time ?? timeOf;
  const s = i.status;
  const look = resolveTheme(i.theme, i.prefersDark);
  const appearance: SettingRow[] = [
    {
      kind: 'choice',
      id: 'theme',
      label: 'Theme',
      options: themeSwitchEntries(i.theme, i.prefersDark).map((e) => ({ run: e.run, label: `${e.glyph} ${e.label}`, current: e.current, note: e.title })),
      note: `showing ${look === 'day' ? 'day (papercraft)' : 'night (phosphor)'}${i.theme === 'auto' ? `: the Mac is in ${i.prefersDark ? 'dark' : 'light'} mode` : ''} · kept in this browser`,
    },
    {
      kind: 'choice',
      id: 'motion',
      label: 'Motion',
      options: [
        { run: 'motion.system', label: 'Follow the Mac', current: i.motion === 'system' },
        { run: 'motion.reduce', label: 'Reduce', current: i.motion === 'reduce' },
      ],
      note: resolveMotion(i.motion, i.prefersReduced) === 'reduced' ? `reduced${i.motion === 'system' ? ' (the Mac asks for it)' : ''}: stamps and fly-offs are instant` : 'full: cards stamp and fly off',
    },
    {
      kind: 'choice',
      id: 'workshop-place',
      label: 'Workshop placement',
      options: WORKSHOP_PLACES.map((p) => ({ run: `workshop.${p}`, label: p === 'footer' ? 'Footer strip' : p === 'right' ? 'Right column' : 'Left column', current: i.layout.visible.workshop && i.layout.workshop === p })),
      note: i.layout.visible.workshop ? 'under 900 px wide it is always the footer' : 'hidden now: a placement shows it again',
    },
  ];

  const layout: SettingRow[] = [
    {
      kind: 'choice',
      id: 'preset',
      label: 'Preset',
      options: Object.keys(PRESETS).map((n) => ({ run: `layout.${n}`, label: n === 'desk' ? 'Desk' : n === 'focus' ? 'Focus' : n === 'decide' ? 'Decide' : n, current: i.layout.name === n, note: n === 'desk' ? 'sessions · chat · stack' : n === 'focus' ? 'the chat only' : 'the stack wide' })),
      note: i.layout.name === 'custom' ? 'custom: you changed a pane' : 'kept in this browser',
    },
    { kind: 'toggle', id: 'pane-sessions', label: 'Sessions pane', run: 'pane.sessions.toggle', on: i.layout.visible.sessions },
    { kind: 'toggle', id: 'pane-stack', label: 'Decision stack', run: 'pane.stack.toggle', on: i.layout.visible.stack },
    { kind: 'toggle', id: 'pane-workshop', label: 'Workshop', run: 'pane.workshop.toggle', on: i.layout.visible.workshop },
    { kind: 'readonly', id: 'kernel-regions', label: 'Always shown', value: 'the voice pill, the run-mode control, the connection readout, the browser risk badge (and the chat itself)', how: 'Kernel-owned: no preset, pane switch or mod can hide them; the chat is the page itself.' },
  ];

  const voice: SettingRow[] = [];
  const human = canAttach(s);
  const c = clientOf(s);
  const v = voiceStatusOf(s);
  if (!s) voice.push({ kind: 'readonly', id: 'voice-app', label: 'Voice app', value: 'not connected', how: 'Reconnect (⌘K, then “Reconnect”) to see and change voice.' });
  else if (!human || !c.known) voice.push({ kind: 'readonly', id: 'voice-app', label: 'Voice app', value: !human ? 'not offered on this connection' : 'this kernel does not report a voice app', how: !human ? 'Only the Gnomon window you opened yourself controls voice.' : 'Update Gnomon to a build with voice; nothing to set here until then.' });
  else {
    const phase = c.phase === 'running' ? 'running' : c.phase === 'crashed' ? `stopped after a crash${c.backoff ? ' (restarting)' : ''}` : c.phase === 'unavailable' ? `unavailable${c.unavailable ? `: ${c.unavailable}` : ''}` : c.phase === 'idle' ? 'not running' : c.phase;
    voice.push(
      clientBusy(c)
        ? { kind: 'action', id: 'voice-app', label: `Voice app · ${phase}`, run: 'voice.client.stop', note: 'Stop voice: quit the voice app; the mic closes' }
        : c.phase === 'unavailable'
          ? { kind: 'readonly', id: 'voice-app', label: 'Voice app', value: phase, how: 'The voice app cannot run on this Mac as installed; the mic pill says why.' }
          : { kind: 'action', id: 'voice-app', label: `Voice app · ${phase}`, run: 'voice.client.start', note: c.phase === 'crashed' ? 'Restart voice' : 'Start voice' },
    );
    // Atelier 2026-10-21 (#gui-voice-settings, Luna #2): everything voice configures lives in ONE Voice settings sheet;
    // General Settings only starts/stops the voice app, links the sheet and reads out the rung in force
    voice.push({ kind: 'action', id: 'voice-settings', label: 'Your voice, send word, keys, listening, timing, risk', run: 'voice.settings.open', note: 'Voice settings…' });
  }
  if (s && human) {
    const rung = rungOf(v, i.voicePreset ?? 'dictate');
    voice.push({ kind: 'readonly', id: 'voice-rung', label: 'Voice', value: rung === 'off' ? `${RUNG_NAME.off}: no session has the mic` : `${RUNG_NAME[rung]} on ${v.hsid ? v.hsid.slice(-10) : 'a session'}`, how: 'Chosen live from the voice pill in the header (Off, Talk, Dictate, Send word, Pieces).' });
  }

  const permissions: SettingRow[] = [];
  const m = i.mode;
  if (!m) permissions.push({ kind: 'readonly', id: 'folder-mode', label: 'Folder run mode', value: 'no live session focused', how: 'Open or focus a session on the left: its folder’s run mode shows here and in the chat header (mode ▾).' });
  else if (!m.repo) permissions.push({ kind: 'readonly', id: 'folder-mode', label: 'Run mode', value: `${m.chosen} (this session; it has no folder)`, how: 'Change it from the chat header’s mode ▾ or ⇧Tab in the composer.' });
  else {
    const own = defaultScope(m) === 'session';
    permissions.push({
      kind: 'choice',
      id: 'folder-mode',
      label: `Run mode · this folder (${short(m.repo, 16)})`,
      options: RUN_MODES.map((mode) => {
        const p = planFor(m, mode, 'repo');
        return { run: `mode.repo.${mode}`, label: mode, current: p.kind === 'same', disabled: p.kind === 'blocked', note: p.kind === 'blocked' ? p.reason : p.kind === 'loosen' ? `${MODE_HELP[mode]} · needs Touch ID` : MODE_HELP[mode] };
      }),
      note: own ? `this session runs its own mode (${m.chosen}); the folder’s applies to new sessions here` : `new sessions in this folder start in it${m.source === 'config' ? ' · now the signed default' : ''}`,
    });
    permissions.push({ kind: 'readonly', id: 'mode-ceiling', label: 'Mode ceiling', value: `${m.ceiling}${m.level ? ` at ${m.level}` : ''}`, how: 'Kernel-owned (§3.4 strictness): strictness levels are not built yet, so the ceiling allows all three modes. A choice above it shows disabled with its reason.' });
  }
  if (i.sessionModel !== undefined) {
    // #gui-model-picker: read-only here (the slot repaints live); the switch is the chat header's model ▾
    permissions.push({ kind: 'readonly', id: 'session-model', label: 'Session model', value: i.sessionModel, how: 'Switch it from the chat header’s model ▾: the conversation continues, the prompt cache restarts. Claude Code checks the model; a running turn finishes first.', slot: 'session-model' });
  }
  const st = standingStatusOf(s);
  const g = st.active[0] ?? null;
  if (!st.built) permissions.push({ kind: 'readonly', id: 'standing', label: 'Today’s grant', value: 'not offered by this kernel', how: 'Each decision asks on its own; nothing to set.' });
  else if (g)
    permissions.push({
      kind: 'revoke',
      id: 'standing',
      label: `Today’s grant · on · ${g.uses} use${g.uses === 1 ? '' : 's'} · until ${fmt(g.expiresAt)} or the screen locks`,
      grantId: g.grantId,
      note: `covers: ${g.tuples.map((t) => (STANDING_TUPLE_TEXT as Record<string, string>)[t] ?? t).join('; ')}${g.repos.length ? ` · in ${g.repos.map((r) => short(r, 16)).join(', ')}` : ''}`,
    });
  else permissions.push({ kind: 'readonly', id: 'standing', label: 'Today’s grant', value: st.pendingCardId ? 'waiting on its card in the stack' : 'off', how: st.pendingCardId ? 'Decide its grant card in the stack.' : 'Offered as “Let Gnomon handle these today” at the first card of the day that needs your password.' });
  const u = i.unlock;
  permissions.push({
    kind: 'readonly',
    id: 'unlock',
    label: 'Touch ID unlock',
    value: u.state === 'open' ? `active since ${u.at ? fmt(u.at) : 'this login'}, until the screen locks` : u.state === 'ended' ? `ended${u.at ? ` ${fmt(u.at)}` : ''}${u.reason ? ` (${u.reason})` : ''}` : 'no unlock seen since this page connected', // Aegis M1: never a claim about the next card
    how: `Kernel-owned. ${UNLOCK_BOUNDS_TEXT} Lock the screen to end it now.`,
  });

  const web = s && typeof s.web === 'object' && s.web ? (s.web as Record<string, unknown>) : null;
  const kApi = s && typeof s.clientApiId === 'string' ? s.clientApiId : null;
  const about: SettingRow[] = [
    { kind: 'readonly', id: 'build', label: 'GUI build', value: `${i.gui.name} ${i.gui.version}${web && typeof web.bundleHash === 'string' ? ` · bundle ${short(web.bundleHash, 15)}` : ''}`, how: 'The kernel serves this bundle pinned by its hash; a Gnomon update brings a new one.' },
    { kind: 'readonly', id: 'client-api', label: 'clientApiId', value: `${short(CLIENT_API_ID, 15)}${kApi && kApi !== CLIENT_API_ID ? ` · the kernel speaks ${short(kApi, 15)}` : ''}`, how: kApi && kApi !== CLIENT_API_ID ? 'The kernel and this page differ (additive drift): restarting Gnomon reloads the matching page.' : 'This page and the kernel agree.' },
    i.connection
      ? { kind: 'readonly', id: 'connection', label: 'Kernel connection', value: `${i.connection.principal} · ${i.connection.connId.slice(-8)} · ${i.connection.surface === 'wrapper' ? 'Gnomon.app' : 'browser'}${s && typeof s.kernelKeyId === 'string' ? ` · key ${short(s.kernelKeyId, 10)}` : ''}`, how: 'Kernel-owned. It ends when this window closes; Reconnect (⌘K) asks for your presence.' }
      : { kind: 'readonly', id: 'connection', label: 'Kernel connection', value: 'not connected', how: 'Use the Reconnect button on the page (or ⌘K, then “Reconnect”).' },
  ];

  return [
    { id: 'appearance', title: 'Appearance', rows: appearance },
    { id: 'layout', title: 'Layout', rows: layout },
    { id: 'voice', title: 'Voice', rows: voice },
    { id: 'permissions', title: 'Permissions', rows: permissions },
    { id: 'about', title: 'About', rows: about },
  ];
}
