/**
 * #gui-wordmark-menu (board header-5b, design-system gnomon.voice.header; refs/header-5b.html option C): the header
 * row is four things (wordmark menu, palette, quiet kernel status, voice pill), every control 28px and nowrap; the
 * menu's keyboard model; the pill as the Start action while the voice app can't run; quiet status; the palette still
 * reaches every tool the header no longer shows.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { applyPreset, filterCommands, GUI_COMMANDS, paletteEntries } from '../src/core/commands.js';
import { appMenuModel, APP_MENU_RUNS, HEADER_ITEMS, linkView, menuKey, PANES_RUN, triggerKey, whoLine } from '../src/core/header.js';
import { themeSwitchEntries } from '../src/core/settings.js';
import { canAttach, voiceStatusOf } from '../src/core/voice.js';
import { clientOf, clientPillOf, pillActionOf } from '../src/core/voice-client.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HTML = readFileSync(path.join(ROOT, 'static', 'index.html'), 'utf8');
const CSS = readFileSync(path.join(ROOT, 'static', 'styles.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const APP = readFileSync(path.join(ROOT, 'src', 'ui', 'app.ts'), 'utf8');
const HEAD = HTML.slice(HTML.indexOf('<header class="chrome">') + '<header class="chrome">'.length, HTML.indexOf('</header>'));

/** The header's top-level elements: each line of the header markup is one child (index.html keeps one per line). */
const children = HEAD.split('\n').filter((l) => l.trim());
/** A CSS rule's body for an exact selector list (the first match). */
const rule = (sel: string): string => {
  const i = CSS.indexOf(`\n${sel} {`);
  expect(i, sel).toBeGreaterThanOrEqual(0);
  return CSS.slice(i, CSS.indexOf('}', i));
};

describe('the header row is four things (board header-5b)', () => {
  it('wordmark menu · palette · quiet kernel status · voice pill, plus the narrow-width pane toggles and the spacer', () => {
    expect(HEADER_ITEMS).toEqual(['wordmark-menu', 'palette', 'kernel-status', 'voice-pill']);
    const items = children.filter((l) => !/class="key pane-toggle"/.test(l) && l !== '<span class="spacer"></span>');
    expect(items).toHaveLength(4);
    expect(items[0]).toMatch(/^<span class="wm-wrap"><button id="wordmark-btn" class="wordmark-btn"/);
    expect(items[1]).toMatch(/^<button id="palette-btn" class="palfield"/);
    expect(items[2]).toMatch(/^<span class="kstat kernel-owned"><span id="conn" class="link-dot kernel-owned"[\s\S]*<span id="risk" class="risk-chip kernel-owned"(?![^>]*\shidden)[^>]*>/);
    expect(items[3]).toMatch(/^<span class="voice-wrap"><button id="voice-pill" class="voice-pill kernel-owned voice-off"/);
    // the pane toggles stay, at the two ends (shown below 900px only)
    expect(children[0]).toMatch(/id="toggle-sessions" class="key pane-toggle"/);
    expect(children[children.length - 1]).toMatch(/id="toggle-stack" class="key pane-toggle"/);
  });
  it('the removed keys are gone, each with one home elsewhere (the Gnomon menu and ⌘K)', () => {
    for (const id of ['theme-switch', 'settings-btn', 'layout-btn', 'layout-menu', 'mods-btn', 'voice-action', 'voice-note']) expect(HTML, id).not.toContain(`id="${id}"`);
    expect(readFileSync(path.join(ROOT, 'src', 'ui', 'mods-panel.ts'), 'utf8')).not.toMatch(/mods-btn|insertBefore/);
    for (const id of ['theme-switch', 'settings-btn', 'layout-btn', 'voice-action', 'voice-note', 'mods-btn']) expect(APP, id).not.toContain(`$('${id}')`);
    // the voice note had two jobs: the idle auto-off is a toast now, a waiting draft is the pill's fact
    expect(APP).toContain('draftWaiting: (draftWaitingShown = draftWaitingOf()),');
  });
});

describe('every header control is 28px and never wraps', () => {
  it('Mika 2026-10-23: at 1024 the "started · 9m" text ellipsizes before the model key is clipped', () => {
    expect(CSS).toContain('.chead-meta { display: contents; white-space: pre; }');
    expect(CSS).toContain('.chead-meta > * { flex: none; white-space: pre; }');
    expect(CSS).toContain('.chead-meta > .chead-when { flex: 0 1000 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; }');
    const app = readFileSync(path.join(ROOT, 'src', 'ui', 'app.ts'), 'utf8');
    expect(app).toMatch(/h\(doc, 'span', \{ class: 'chead-when' \}/);
    expect(CSS).toContain('.chead-meta > .pink { flex: none;'); // the project never shrinks: its name is capped instead
    expect(CSS).toMatch(/@media \(max-width: 1279px\) \{ \.chead-proj \{ max-width: 10ch; \} \}/);
    expect(CSS).toContain('@container chead-l (max-width: 339px) { .chead-meta > .chead-backend { display: none; } }'); // the backend word gives way before the project
    expect(app).toMatch(/class: 'chead-backend'/); // the project name gives way before the model key
    expect(CSS).toContain('.chead #transcript-title { min-width: 5ch; flex-shrink: 100; }'); // the title gives way before the project
  });
  it('one height and nowrap on each control; the row itself does not wrap, even under 900px', () => {
    for (const sel of ['.wordmark-btn', '.palfield', '.link-dot', '.risk-chip', '.chrome .key']) {
      const r = rule(sel);
      expect(r, sel).toMatch(/height: (28px|var\(--key-h\))/); // header-control = key-h (28)
      expect(r, sel).toMatch(/white-space: nowrap/);
    }
    expect(CSS).toMatch(/\n\.voice-pill \{[^}]*height: 28px;[^}]*white-space: nowrap;/);
    expect(rule('.chrome')).toBeTruthy();
    expect(CSS).toMatch(/\n\.chrome \{ flex-wrap: nowrap; min-width: 0; \}/);
    expect(CSS).not.toMatch(/\.chrome \{[^}]*flex-wrap: wrap/);
    // the old wrapping combos: .seg wraps (fine in the Settings sheet), so the menu's theme row overrides it
    expect(rule('.menu-theme')).toMatch(/flex-wrap: nowrap/);
    expect(rule('.menu-theme .seg-key')).toMatch(/height: var\(--key-h\);[^}]*white-space: nowrap/);
    // one edge style for the pill: the app's trouble is in its words, never a dashed edge
    expect(CSS).not.toMatch(/\.voice-pill\.voice-trouble \{ border-style: dashed/);
  });
  it('narrow widths truncate, never squeeze: below 1040px the risk chip reads "browser · risk" and the pill fact caps at 20ch', () => {
    expect(CSS).toMatch(/@media \(max-width: 1040px\) \{ \.risk-long, \.pal-ph2 \{ display: none; \} \.voice-fact \{ max-width: 20ch; \} \}/);
    expect(rule('.voice-fact')).toMatch(/overflow: hidden; text-overflow: ellipsis; min-width: 0/);
    expect(rule('.palfield .pal-ph')).toMatch(/text-overflow: ellipsis/);
    // the risk chip keeps its full text for assistive tech and in title= whatever the width
    expect(HEAD).toMatch(/<span id="risk"[^>]*title="A browser extension with all-sites access[^"]*">browser&nbsp;·&nbsp;<span class="risk-long" aria-hidden="true">extension&nbsp;<\/span>risk<span class="sr-only">: a browser extension/);
    expect(rule('.risk-chip')).toMatch(/color: var\(--warn-ink\); background: transparent; border: 1px solid var\(--warn-edge\)/); // outlined, never filled
  });
  it('Aegis: the narrow chip still says "risk": the chip\'s visible text outside .risk-long (and .sr-only) contains it', () => {
    const chip = /<span id="risk"[^>]*>([\s\S]*?)<\/span><\/span>/.exec(HEAD)![1]!;
    const narrow = chip.replace(/<span class="risk-long"[^>]*>[\s\S]*?<\/span>/, '').replace(/<span class="sr-only">[\s\S]*$/, '').replace(/&nbsp;/g, ' ');
    expect(narrow).toBe('browser · risk');
    expect(narrow).toContain('risk');
    expect(chip.replace(/<span class="sr-only">[\s\S]*$/, '').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ')).toBe('browser · extension risk'); // wide
  });
  it('Aegis: the risk chip shows from boot on the browser surface, before attach; only the wrapper hides it', () => {
    expect(APP).toMatch(/const SURFACE = hostSurface\(\);[\s\S]{0,300}\n\$\('risk'\)\.hidden = SURFACE === 'wrapper';/);
    const attach = APP.slice(APP.indexOf('async function attach('), APP.indexOf('\n}\n', APP.indexOf('async function attach(')));
    expect(attach).not.toContain("$('risk')");
  });
});

describe('the wordmark menu', () => {
  const rows = (panesOpen = false) => appMenuModel({ layout: applyPreset('desk'), panesOpen, theme: themeSwitchEntries('auto', true), who: 'kernel connected · ascend · conn …4f2a91c0 · log 1204' });
  it('holds Layout presets, Day / Night / Auto, Mods…, Voice settings…, Settings… ⌘, and the who line, in that order', () => {
    const r = rows();
    const labels = r.map((x) => (x.kind === 'item' ? x.name : x.kind === 'head' ? `[${x.label}]` : x.kind === 'theme' ? x.options.map((o) => o.label).join('|') : x.kind === 'who' ? `who:${x.text}` : '—'));
    expect(labels).toEqual(['[layout]', 'Desk', 'Focus', 'Decide', 'Panes and Workshop…', '—', '[theme]', 'Day|Night|Auto', '—', 'Mods…', 'Voice settings…', 'Settings…', '—', 'who:kernel connected · ascend · conn …4f2a91c0 · log 1204']);
    expect(r.find((x) => x.kind === 'item' && x.run === 'layout.desk')).toMatchObject({ radio: true, checked: true });
    expect(r.find((x) => x.kind === 'item' && x.run === PANES_RUN)).toMatchObject({ expands: true, expanded: false });
    // the panes and Workshop rows open in place
    expect(rows(true).filter((x) => x.kind === 'item').map((x) => (x.kind === 'item' ? x.run : ''))).toContain('pane.workshop.toggle');
    // every row is an existing GUI command (or the in-place panes toggle)
    const ids = new Set(GUI_COMMANDS.map((c) => c.id));
    for (const run of APP_MENU_RUNS) expect(run === PANES_RUN || ids.has(run), run).toBe(true);
  });
  it('the trigger: ▾ always visible, aria-haspopup / aria-expanded, a hover and a pressed state, a title naming its contents', () => {
    expect(HEAD).toMatch(/<button id="wordmark-btn" class="wordmark-btn" type="button" aria-haspopup="menu" aria-expanded="false" aria-controls="wordmark-menu" title="Gnomon: layout, theme, mods, voice settings, settings"><span class="wordmark">Gnomon<\/span><span class="wm-caret" aria-hidden="true">▾<\/span><\/button><div id="wordmark-menu" class="mode-menu wordmark-menu" role="menu" aria-label="Gnomon" hidden><\/div>/);
    expect(CSS).not.toMatch(/\.wm-caret \{[^}]*display: none/);
    expect(rule('.wordmark-btn:hover')).toMatch(/border-color: var\(--rule\); background: var\(--sheet\)/);
    expect(rule('.wordmark-btn[aria-expanded="true"]')).toMatch(/border-color: var\(--key-edge\); background: var\(--sheet\)/);
    expect(rule('.wordmark-btn:active')).toMatch(/transform: translate/);
    expect(rule('.wordmark-btn:focus-visible')).toMatch(/outline: 2px solid var\(--key-edge\)/);
    expect(APP).toMatch(/\$\('wordmark-btn'\)\.setAttribute\('aria-expanded', 'true'\)/);
    expect(APP).toMatch(/\$\('wordmark-btn'\)\.setAttribute\('aria-expanded', 'false'\)/);
  });
  it('keyboard: Enter / Space (the button\'s click) open on the first row, ↓ / ↑ open on the first / last, arrows wrap, Home / End, Esc closes and focus returns, Tab closes', () => {
    expect(triggerKey('ArrowDown')).toBe('first');
    expect(triggerKey('ArrowUp')).toBe('last');
    expect(triggerKey('Enter')).toBeNull(); // the native button click handles Enter and Space (no double toggle)
    expect(triggerKey(' ')).toBeNull();
    expect(menuKey('ArrowDown', 2, 5)).toEqual({ kind: 'move', to: 3 });
    expect(menuKey('ArrowDown', 4, 5)).toEqual({ kind: 'move', to: 0 });
    expect(menuKey('ArrowUp', 0, 5)).toEqual({ kind: 'move', to: 4 });
    expect(menuKey('ArrowDown', -1, 5)).toEqual({ kind: 'move', to: 0 });
    expect(menuKey('Home', 3, 5)).toEqual({ kind: 'move', to: 0 });
    expect(menuKey('End', 0, 5)).toEqual({ kind: 'move', to: 4 });
    expect(menuKey('Escape', 2, 5)).toEqual({ kind: 'close', focusTrigger: true });
    expect(menuKey('Tab', 2, 5)).toEqual({ kind: 'close', focusTrigger: false });
    expect(menuKey('x', 2, 5)).toBeNull();
    // the wiring: a key press click (detail 0) focuses the first row; ↓/↑ on the trigger; the menu's own keydown
    expect(APP).toMatch(/\$\('wordmark-btn'\)\.addEventListener\('click', \(e\) => \(\$\('wordmark-menu'\)\.hidden \? openAppMenu\(e\.detail === 0 \? 'first' : null\) : closeAppMenu\(true\)\)\);/);
    expect(APP).toMatch(/const at = \$\('wordmark-menu'\)\.hidden \? triggerKey\(e\.key\) : null;/);
    expect(APP).toMatch(/const step = menuKey\(e\.key, items\.indexOf\(document\.activeElement as HTMLElement\), items\.length\);/);
    expect(APP).toMatch(/function closeAppMenu\(focusTrigger = false\): void \{[\s\S]{0,200}if \(focusTrigger\) \$\('wordmark-btn'\)\.focus\(\);/);
    // Esc with focus outside the menu (a pointer opened it) closes it too, before any other Esc meaning
    expect(APP).toMatch(/\} else if \(e\.key === 'Escape' && !\$\('wordmark-menu'\)\.hidden\) \{\s*closeAppMenu\(true\);/);
    // an outside click closes it; a row runs only an allowed command, on the human's own press
    expect(APP).toMatch(/if \(!\$\('wordmark-menu'\)\.hidden && !\(e\.target as HTMLElement\)\.closest\('\.wm-wrap'\)\) closeAppMenu\(\);/);
    expect(APP).toMatch(/if \(!e\.isTrusted\) return;[^\n]*\n\s*const b = \(e\.target as HTMLElement\)\.closest\('\[data-run\]'\)/);
  });
  it('rows are menuitem / menuitemradio (aria-checked) and the theme row is a group of radios', () => {
    const fn = APP.slice(APP.indexOf('function appMenuRowEl('), APP.indexOf('function paintAppMenu('));
    expect(fn).toContain("role: r.radio ? 'menuitemradio' : 'menuitem'");
    expect(fn).toContain("if (r.radio) attrs['aria-checked'] = String(!!r.checked);");
    expect(fn).toContain("if (r.expands) attrs['aria-expanded'] = String(!!r.expanded);");
    expect(fn).toMatch(/role: 'group', 'aria-label': 'Theme'/);
    expect(fn).toMatch(/role: 'menuitemradio', 'aria-checked': String\(o\.checked\)/);
  });
});

describe('quiet kernel status', () => {
  it('the link is a dot, with a word only when not connected (the word stays for screen readers)', () => {
    expect(linkView('connected', { principal: 'ascend', connId: 'conn:01HZZZZ4f2a91c0' })).toMatchObject({ ok: true, word: 'connected', wordShown: false });
    for (const [s, w] of [['restarting', 'restarting…'], ['none', 'not connected'], ['connecting', 'connecting…']] as const) expect(linkView(s)).toMatchObject({ ok: false, word: w, wordShown: true });
    expect(whoLine('connected', { principal: 'ascend', connId: 'conn:01HZZZZ4f2a91c0' }, 1204)).toBe('kernel connected · ascend · conn …4f2a91c0 · log 1204');
    expect(whoLine('none', null, 9)).toBe('kernel not connected');
    expect(APP).toContain("w.className = lv.wordShown ? 'link-word' : 'link-word sr-only';");
    expect(HEAD).toMatch(/<span id="conn" class="link-dot kernel-owned" role="status" aria-live="polite"/);
    expect(rule('.link-dot.ok .ld')).toMatch(/background: var\(--ink\)/);
  });
});

describe('the pill is the Start action while the voice app can\'t run', () => {
  const human = (voice: unknown) => ({ principalKind: 'human', voice });
  const down = (client: Record<string, unknown>, more: Record<string, unknown> = {}) => human({ attached: false, hsid: null, ceiling: null, clientConnected: false, client, ...more });
  const view = (status: unknown) => {
    const attached = voiceStatusOf(status).state !== 'off';
    return pillActionOf(clientPillOf(clientOf(status), attached, canAttach(status)), attached);
  };
  it('"○ Start voice · app not running"; its aria-label says what a click does', () => {
    const v = view(down({ phase: 'idle' }));
    expect(v).toMatchObject({ action: 'start', name: 'Start voice', fact: 'app not running' });
    expect(v!.aria).toMatch(/^Start voice: starts the voice app\./);
    expect(v!.title).toMatch(/Click: start the voice app\.$/);
    expect(view(down({ phase: 'crashed', lastError: 'audio device gone' }))).toMatchObject({ action: 'restart', name: 'Restart voice', fact: 'voice crashed' });
  });
  it('attached, the live rung stands (the action is the ladder\'s first row); a connection that may not act keeps the plain pill', () => {
    const cp = clientPillOf(clientOf(down({ phase: 'idle' })), true, true);
    expect(pillActionOf(cp, true)).toBeNull();
    expect(pillActionOf(clientPillOf(clientOf({ principalKind: 'voice', voice: { attached: false, client: { phase: 'idle' } } }), false, false), false)).toBeNull();
  });
  it('the page: the pill click runs the action (no menu, no aria-haspopup then); there is no separate Start key', () => {
    expect(APP).toMatch(/if \(pa\) \{\s*btn\.dataset\.action = pa\.action;\s*btn\.removeAttribute\('aria-haspopup'\);\s*btn\.removeAttribute\('aria-expanded'\);/);
    expect(APP).toContain("btn.setAttribute('aria-label', pa ? pa.aria : pv.aria);");
    expect(APP).toContain("put($('voice-label'), pa ? pa.name : pv.name);");
    expect(APP).toMatch(/const a = \$\('voice-pill'\)\.dataset\.action;\s*if \(a\) return voiceAct\(a, e\.isTrusted\);/);
    expect(HTML).not.toContain('id="voice-action"');
  });
});

describe('the palette reaches every tool the header no longer shows', () => {
  it('Layout, theme, Mods, Voice settings, Settings and the Gnomon menu itself, by their words', () => {
    const all = paletteEntries(null);
    const first = (q: string) => filterCommands(all, q)[0]?.id;
    expect(first('layout')).toMatch(/^layout\./);
    expect(first('theme')).toMatch(/^theme\./);
    expect(first('mods')).toBe('mods.open');
    expect(first('voice settings')).toBe('voice.settings.open');
    expect(first('settings')).toBe('settings.open');
    expect(first('gnomon menu')).toBe('menu.gnomon');
    expect(all.find((c) => c.id === 'theme.auto')!.title).toBe("Theme: Auto (follow the Mac's appearance)");
    expect(all.find((c) => c.id === 'layout.desk')!.title).toBe('Layout: Desk (sessions · chat · stack)');
    expect(APP).toContain("else if (id === 'menu.gnomon') openAppMenu('first');");
  });
});
