/**
 * #gui-settings: the header theme switch and the Settings sheet. The sheet lists only existing GUI commands (and the
 * standing Revoke), kernel-owned values are read-only with a how-to line, the theme choice persists per browser and
 * applies, and the palette and ⌘, open it.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { applyPreset, BLOCK_SAFE_COMMANDS, filterCommands, GUI_COMMANDS, paletteEntries, resolveTheme } from '../src/core/commands.js';
import { MOTION_KEY, parseMotion, parseTheme, SETTINGS_RUNS, settingsModel, THEME_KEY, themeSwitchEntries, unlockSeenOf, type SettingRow, type SettingsInput } from '../src/core/settings.js';
import type { SessionModeView } from '../src/core/modes.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const app = readFileSync(path.join(ROOT, 'src', 'ui', 'app.ts'), 'utf8');
const sheet = readFileSync(path.join(ROOT, 'src', 'ui', 'settings-sheet.ts'), 'utf8');
const html = readFileSync(path.join(ROOT, 'static', 'index.html'), 'utf8');
const K = 'p:7k2m9q4x/kernel';

const MODE: SessionModeView = { hsid: 'hsid:v1:X', repo: 'billing', chosen: 'ask', source: 'repo', repoMode: 'ask', ceiling: 'ask', effective: 'ask', level: 'L2', pendingCardId: null };
const STATUS = {
  principalKind: 'human',
  clientApiId: 'sha256:other',
  kernelKeyId: 'kk:abcdef0123456789',
  web: { listening: true, bundleHash: 'sha256:53b2cd7a8d74c94306f388e48249f176d37de86a1246995c905d3486db63fc81' },
  voice: { attached: false, clientConnected: true, client: { phase: 'running' }, enrolled: [{ name: 'matt' }] },
  standing: { built: true, active: [{ grantId: 'sg:1', tuples: ['voice.widen'], repos: ['billing'], expiresAt: '2026-10-20T22:00:00.000Z', uses: 2 }] },
};
const input = (o: Partial<SettingsInput> = {}): SettingsInput => ({
  theme: 'auto',
  motion: 'system',
  prefersDark: true,
  prefersReduced: false,
  layout: applyPreset('desk'),
  status: STATUS,
  mode: MODE,
  dictationDelayMs: 5000,
  connection: { principal: 'p:7k2m9q4x/matt', connId: 'conn:01HZZZZZZZZZZZZZZZZZZZZZZB', surface: 'wrapper', clientApiDrift: true },
  gui: { name: 'gnomon-gui', version: '8.0.0-test' },
  unlock: { state: 'open', at: '2026-10-20T14:00:00.000Z', reason: null },
  time: (iso) => iso.slice(11, 16),
  ...o,
});
const rows = (i: SettingsInput = input()): SettingRow[] => settingsModel(i).flatMap((s) => s.rows);
const runsOf = (r: SettingRow): string[] => (r.kind === 'choice' ? r.options.map((o) => o.run) : r.kind === 'toggle' || r.kind === 'action' ? [r.run] : []);

describe('#gui-settings theme switch: persistence and application', () => {
  it('a stored choice parses; anything else is auto', () => {
    expect(['day', 'night', 'auto', null, '', 'dusk'].map((v) => parseTheme(v as string | null))).toEqual(['day', 'night', 'auto', 'auto', 'auto', 'auto']);
    expect([parseMotion('reduce'), parseMotion(null), parseMotion('x')]).toEqual(['reduce', 'system', 'system']);
  });
  it('day applies papercraft even when the OS is dark (the founder\'s Mac); auto follows the OS', () => {
    expect(resolveTheme(parseTheme('day'), true)).toBe('day');
    expect(resolveTheme(parseTheme(null), true)).toBe('night');
  });
  it('the switch marks exactly the choice and names what auto shows now', () => {
    const e = themeSwitchEntries('day', true);
    expect(e.map((x) => [x.run, x.current])).toEqual([['theme.day', true], ['theme.night', false], ['theme.auto', false]]);
    expect(themeSwitchEntries('auto', true).find((x) => x.choice === 'auto')!.title).toContain('night now');
    expect(themeSwitchEntries('auto', false).find((x) => x.choice === 'auto')!.title).toContain('day now');
  });
  it('app.ts keeps the choice per browser on a theme/motion command and reads it at start', () => {
    expect(app).toMatch(/keep\(THEME_KEY, \(theme = parseTheme\(id\.slice\(6\)\)\)\)/);
    expect(app).toMatch(/keep\(MOTION_KEY, \(motion = parseMotion/);
    expect(app).toMatch(/theme = parseTheme\(stored\(THEME_KEY\)\)/);
    expect([THEME_KEY, MOTION_KEY]).toEqual(['gnomon.gui.theme', 'gnomon.gui.motion']);
  });
  it('the header carries the Day / Night / Auto switch and the ⚙ key, outside every pane', () => {
    for (const r of ['theme.day', 'theme.night', 'theme.auto']) expect(html).toContain(`data-run="${r}"`);
    expect(html).toMatch(/id="theme-switch"[^>]*role="radiogroup"/);
    expect(html.indexOf('id="settings-btn"')).toBeLessThan(html.indexOf('<main'));
    expect(html.indexOf('id="theme-switch"')).toBeLessThan(html.indexOf('<main'));
  });
});

describe('#gui-settings sheet: only allowed controls', () => {
  it('every control names an existing GUI command in SETTINGS_RUNS (no new kernel verb)', () => {
    const ids = new Set(GUI_COMMANDS.map((c) => c.id));
    for (const id of SETTINGS_RUNS) expect(ids.has(id), id).toBe(true);
    for (const r of rows()) for (const run of runsOf(r)) expect(SETTINGS_RUNS.has(run), run).toBe(true);
    // the only other control is the standing Revoke (an existing request, core/standing.ts revokeRequest)
    expect(rows().filter((r) => r.kind === 'revoke').map((r) => r.id)).toEqual(['standing']);
  });
  it('nothing kernel-owned is a toggle: panes are sessions, stack and workshop only; no reconnect/diag/session-only mode', () => {
    for (const id of SETTINGS_RUNS) {
      expect(id).not.toMatch(/^(gui\.reconnect|diag\.|verb\.|voice\.(off|ptt|ambient)$|mode\.(manual|ask|auto-edits)$|pane\.transcript)/);
      if (id.startsWith('pane.')) expect(['pane.sessions.toggle', 'pane.stack.toggle', 'pane.workshop.toggle']).toContain(id);
    }
  });
  it('the five sections in order', () => {
    expect(settingsModel(input()).map((s) => s.id)).toEqual(['appearance', 'layout', 'voice', 'permissions', 'about']);
  });
  it('the folder run mode is the F2 folder switch; a choice above the ceiling is disabled with its reason', () => {
    const m = rows().find((r) => r.id === 'folder-mode');
    expect(m?.kind).toBe('choice');
    if (m?.kind !== 'choice') return;
    expect(m.options.map((o) => o.run)).toEqual(['mode.repo.manual', 'mode.repo.ask', 'mode.repo.auto-edits']);
    expect(m.options.find((o) => o.run === 'mode.repo.auto-edits')).toMatchObject({ disabled: true, note: 'ceiling ask at L2' });
    expect(m.options.find((o) => o.current)!.run).toBe('mode.repo.ask');
  });
  it('settings.open is in the palette and is not block-safe', () => {
    expect(filterCommands(paletteEntries(null), 'settings')[0]!.id).toBe('settings.open');
    expect(BLOCK_SAFE_COMMANDS.has('settings.open')).toBe(false);
  });
});

describe('#gui-settings sheet: kernel-owned items are read-only', () => {
  it('ceiling, unlock, connection, build, clientApiId, listening mode, hotkeys and the always-shown regions are read-only, each with a how line', () => {
    const by = new Map(rows().map((r) => [r.id, r]));
    for (const id of ['mode-ceiling', 'unlock', 'connection', 'build', 'client-api', 'voice-mode', 'voice-hotkey', 'kernel-regions']) {
      const r = by.get(id);
      expect(r?.kind, id).toBe('readonly');
      if (r?.kind === 'readonly') expect(r.how.length, id).toBeGreaterThan(10);
    }
  });
  it('a how line never sends the human to a terminal', () => {
    const states: SettingsInput[] = [input(), input({ status: null, connection: null, mode: null }), input({ mode: { ...MODE, repo: null } }), input({ status: { principalKind: 'agent' } })];
    for (const i of states) for (const r of rows(i)) if (r.kind === 'readonly') expect(r.how, r.id).not.toMatch(/terminal|`gnomon |\bgnomon (mode|voice|approve|up)\b/i);
  });
  it('the unlock row states the bounds and that a lock ends it', () => {
    const u = rows().find((r) => r.id === 'unlock');
    expect(u).toMatchObject({ kind: 'readonly', value: expect.stringContaining('active since 14:00') });
    if (u?.kind === 'readonly') expect(u.how).toMatch(/12 h or 512 signatures.*Lock the screen/);
  });
  it('the clientApiId drift is named', () => {
    const r = rows().find((x) => x.id === 'client-api');
    if (r?.kind === 'readonly') expect(r.value).toContain('the kernel speaks');
  });
  it('the sheet renders read-only rows with no control, through h() only (no inline style, no HTML sinks)', () => {
    expect(sheet).toMatch(/row\.setAttribute\('data-readonly', 'true'\)/);
    expect(sheet).not.toMatch(/setAttribute\(\s*['"]style|\.style\b|innerHTML|insertAdjacentHTML/);
    expect(readFileSync(path.join(ROOT, 'src', 'ui', 'standing-feed.ts'), 'utf8')).not.toMatch(/setAttribute\(\s*['"]style/); // the CSP refuses it
    expect(sheet).toMatch(/if \(!e\.isTrusted\) return;/);
    expect(sheet).toMatch(/if \(!SETTINGS_RUNS\.has\(id\)\) return;/);
  });
});

describe('#gui-settings unlock fold (kernel rows only)', () => {
  const conn = 'conn:A';
  it('opens and ends on kernel rows for this connection or this device; another principal or connection is ignored', () => {
    expect(unlockSeenOf([{ kind: 'approval.unlock', at: 't1', principal: K, payload: { connId: conn } }], conn).state).toBe('open');
    expect(unlockSeenOf([{ kind: 'approval.unlock', at: 't1', principal: 'p:7k2m9q4x/matt', payload: { connId: conn } }], conn).state).toBe('none');
    expect(unlockSeenOf([{ kind: 'approval.unlock', at: 't1', principal: K, payload: { connId: 'conn:B' } }], conn).state).toBe('none');
    expect(unlockSeenOf([{ kind: 'approval.unlock', at: 't1', principal: K, payload: { connId: 'conn:B', scope: 'device' } }], conn).state).toBe('open');
    expect(unlockSeenOf([{ kind: 'approval.unlock', principal: K, payload: { scope: 'device' } }, { kind: 'approval.unlock.dropped', at: 't2', principal: K, payload: { scope: 'device', reason: 'screen-lock' } }], conn)).toEqual({ state: 'ended', at: 't2', reason: 'screen-lock' });
  });
  it('a kernel restart clears it', () => {
    expect(unlockSeenOf([{ kind: 'approval.unlock', principal: K, payload: { scope: 'device' } }, { kind: 'daemon.start', principal: K }], conn).state).toBe('none');
  });
});

describe('#gui-settings opens from ⚙, ⌘, and the palette', () => {
  it('app.ts routes settings.open, the ⚙ key and ⌘, to the sheet; Esc closes it', () => {
    expect(app).toMatch(/else if \(id === 'settings\.open'\) settings\.open\(\);/);
    expect(app).toMatch(/\$\('settings-btn'\)\.addEventListener\('click'/);
    expect(app).toMatch(/\(e\.metaKey \|\| e\.ctrlKey\) && !e\.altKey && !e\.shiftKey && e\.key === ','\) \{[\s\S]{0,160}settings\.open\(\);/);
    expect(app).toMatch(/e\.key === 'Escape' && settings\.isOpen\(\)\) \{\s*settings\.close\(\);/);
    expect(html).toMatch(/id="settings" class="overlay" hidden/);
    expect(html).toMatch(/role="dialog" aria-modal="true" aria-labelledby="settings-title"/);
  });
});
