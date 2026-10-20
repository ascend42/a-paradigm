/**
 * #gui run-mode control (spec §11.4 control + palette, §11.5 ⇧Tab; P8-D86/D87): the pure core (core/modes.ts), the
 * store's inline "auto-approved edit" line and mode rows, the palette entries, and the page wiring read from the
 * source (the app is browser glue; its decisions are the pure functions tested here).
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { BLOCK_SAFE_COMMANDS, filterCommands, GUI_COMMANDS, paletteEntries } from '../src/core/commands.js';
import { defaultScope, menuEntries, modeChip, modeLabel, modeRequest, nextRunMode, planChange, planFor, scopeEntries, SCOPE_LABEL, sessionModeOf, type SessionModeView } from '../src/core/modes.js';
import { chatItems, GuiStore, type Row } from '../src/core/store.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HSID = 'hsid:v1:01HZZZZZZZZZZZZZZZZZZZZZZA';
const REPO = `sha256:${'a'.repeat(64)}`;
const status = (s: Record<string, unknown>) => ({ runModes: { default: 'ask', strictness: { built: false }, repos: [], sessions: [{ hsid: HSID, repo: REPO, cwd: '/w', chosen: 'ask', source: 'default', repoMode: 'ask', level: null, ceiling: 'auto-edits', effective: 'ask', ...s }] } });
const view = (s: Partial<SessionModeView> = {}): SessionModeView => ({ hsid: HSID, repo: REPO, chosen: 'ask', source: 'default', repoMode: 'ask', ceiling: 'auto-edits', effective: 'ask', level: null, pendingCardId: null, ...s });

describe('run modes: the ⇧Tab cycle and what a choice does', () => {
  it('⇧Tab cycles manual → ask → auto-edits → manual, as in Claude Code', () => {
    expect(nextRunMode('manual')).toBe('ask');
    expect(nextRunMode('ask')).toBe('auto-edits');
    expect(nextRunMode('auto-edits')).toBe('manual');
  });

  it('a stricter mode is a tightening (no presence); a looser one a loosening (Touch ID); over the ceiling is blocked with its reason', () => {
    expect(planChange(view({ chosen: 'auto-edits' }), 'ask')).toEqual({ kind: 'tighten' });
    expect(planChange(view({ chosen: 'ask' }), 'manual')).toEqual({ kind: 'tighten' });
    expect(planChange(view({ chosen: 'ask' }), 'auto-edits')).toEqual({ kind: 'loosen' });
    expect(planChange(view({ chosen: 'manual' }), 'ask')).toEqual({ kind: 'loosen' });
    expect(planChange(view({ chosen: 'ask' }), 'ask')).toEqual({ kind: 'same' });
    expect(planChange(view({ ceiling: 'ask', level: 'L2' }), 'auto-edits')).toEqual({ kind: 'blocked', reason: 'ceiling ask at L2' });
  });

  it('the menu shows every mode, the current one marked, a loosening labelled Touch ID, a blocked one disabled with its reason', () => {
    const m = menuEntries(view({ ceiling: 'ask', level: 'L2' }));
    expect(m.map((e) => e.mode)).toEqual(['manual', 'ask', 'auto-edits']);
    expect(m.find((e) => e.mode === 'ask')).toMatchObject({ current: true, disabled: false });
    expect(m.find((e) => e.mode === 'auto-edits')).toMatchObject({ disabled: true, note: 'ceiling ask at L2' });
    expect(menuEntries(view()).find((e) => e.mode === 'auto-edits')?.note).toContain('needs Touch ID');
    expect(menuEntries(view()).find((e) => e.mode === 'manual')?.note).not.toContain('Touch ID'); // tightening: no presence
  });

  it('the control reads only status.runModes; an unknown value reads as manual (fail safe), an unknown session as none', () => {
    expect(sessionModeOf(status({}), HSID)).toEqual(view());
    expect(sessionModeOf(status({ chosen: 'auto-edits', effective: 'auto-edits', source: 'session', pendingCardId: 'card:01HZZZZZZZZZZZZZZZZZZZZZZZ' }), HSID)).toMatchObject({ chosen: 'auto-edits', pendingCardId: 'card:01HZZZZZZZZZZZZZZZZZZZZZZZ' });
    expect(sessionModeOf(status({ chosen: 'yolo', effective: 'yolo' }), HSID)).toMatchObject({ chosen: 'manual', effective: 'manual' });
    expect(sessionModeOf(status({}), 'hsid:v1:01HZZZZZZZZZZZZZZZZZZZZZZB')).toBeNull();
    expect(sessionModeOf({}, HSID)).toBeNull();
    expect(sessionModeOf(null, HSID)).toBeNull();
    expect(sessionModeOf(status({}), null)).toBeNull();
  });

  it('the label is `mode: <chosen> ▾`, and names the ceiling when it clamps, and a pending Touch ID', () => {
    expect(modeLabel(view())).toBe('mode: ask ▾');
    expect(modeLabel(view({ chosen: 'auto-edits', effective: 'ask', ceiling: 'ask' }))).toBe('mode: auto-edits → ask (ceiling) ▾');
    expect(modeLabel(view({ pendingCardId: 'card:x' }))).toBe('mode: ask · Touch ID pending ▾');
    expect(modeLabel(null)).toBe('mode: —');
    // fidelity 2: the header chip drops only the prefix (a clamp or a pending Touch ID still shows)
    expect(modeChip(view())).toBe('ask ▾');
    expect(modeChip(view({ chosen: 'auto-edits', effective: 'ask', ceiling: 'ask' }))).toBe('auto-edits → ask (ceiling) ▾');
    expect(modeChip(null)).toBe('mode: —');
    // F3 (TD-2026-10-20-086): the folder runs the root-signed default
    expect(modeLabel(view({ chosen: 'auto-edits', effective: 'auto-edits', source: 'config' }))).toBe('mode: auto-edits (default) ▾');
  });

  it('the request is log.append{kind: request.mode.set} for the session, or its repo', () => {
    expect(modeRequest(view(), 'manual', 'session')).toEqual({ kind: 'request.mode.set', payload: { hsid: HSID, to: 'manual' } });
    // F2: with no scope named, a session with a repo sets its folder; with none, the session
    expect(modeRequest(view(), 'manual')).toEqual({ kind: 'request.mode.set', payload: { repo: REPO, to: 'manual' } });
    expect(modeRequest(view({ repo: null }), 'manual')).toEqual({ kind: 'request.mode.set', payload: { hsid: HSID, to: 'manual' } });
    expect(modeRequest(view(), 'auto-edits', 'repo')).toEqual({ kind: 'request.mode.set', payload: { repo: REPO, to: 'auto-edits' } });
    expect(modeRequest(view({ repo: null }), 'ask', 'repo')).toBeNull();
  });
});

describe('run modes: the switch defaults to this folder (TD-2026-10-20-086 F2)', () => {
  it('the default scope is the folder; a session with its own mode, or with no repo, keeps session scope', () => {
    expect(defaultScope(view())).toBe('repo');
    expect(defaultScope(view({ source: 'repo' }))).toBe('repo');
    expect(defaultScope(view({ source: 'session' }))).toBe('session');
    expect(defaultScope(view({ repo: null }))).toBe('session');
    expect(defaultScope(null)).toBe('session');
    expect(SCOPE_LABEL.repo).toBe('this folder');
  });
  it('a folder choice is measured from the folder\'s mode, a session one from the session\'s', () => {
    const v = view({ chosen: 'manual', source: 'session', repoMode: 'auto-edits' });
    expect(planFor(v, 'auto-edits', 'repo')).toEqual({ kind: 'same' });
    expect(planFor(v, 'auto-edits', 'session')).toEqual({ kind: 'loosen' });
    expect(planFor(v, 'ask', 'repo')).toEqual({ kind: 'tighten' });
    expect(planFor(view({ ceiling: 'ask', level: 'L2' }), 'auto-edits', 'repo')).toEqual({ kind: 'blocked', reason: 'ceiling ask at L2' });
  });
  it('the menu names the scope, and offers the other one as the secondary entry', () => {
    expect(scopeEntries(view())).toEqual({ heading: 'for this folder (new sessions here start in it)', other: { scope: 'session', label: 'set for this session only instead…' } });
    expect(scopeEntries(view({ source: 'session' })).other).toEqual({ scope: 'repo', label: 'set for this folder instead…' });
    expect(scopeEntries(view({ repo: null })).other).toBeNull();
  });
  it('status carries the folder\'s mode (repoMode); an older kernel without it reads the chosen mode', () => {
    expect(sessionModeOf(status({ source: 'session', chosen: 'manual', effective: 'manual', repoMode: 'auto-edits' }), HSID)?.repoMode).toBe('auto-edits');
    const st = status({});
    delete (st.runModes.sessions[0] as Record<string, unknown>).repoMode;
    expect(sessionModeOf(st, HSID)?.repoMode).toBe('ask');
  });
  it('the page sends the menu choice and ⇧Tab with the default scope; the secondary entry opens the other scope\'s palette', () => {
    const app = readFileSync(path.join(ROOT, 'src', 'ui', 'app.ts'), 'utf8');
    expect(app).toMatch(/setMode\(b\.dataset\.mode as RunMode, defaultScope\(currentMode\(\)\), e\.isTrusted\)/);
    expect(app).toMatch(/const scope = defaultScope\(v\);[\s\S]{0,200}void setMode\(to, scope, trusted\)/);
    expect(app).toContain("openPalette(b.dataset.modeScope === 'repo' ? 'mode.repo.' : 'mode.')");
  });
});

describe('run modes: the palette and blocks', () => {
  it('the palette carries mode: manual|ask|auto-edits for the session and for the repo (⌘K)', () => {
    const ids = paletteEntries(null).map((c) => c.id);
    for (const id of ['mode.manual', 'mode.ask', 'mode.auto-edits', 'mode.repo.manual', 'mode.repo.ask', 'mode.repo.auto-edits']) expect(ids).toContain(id);
    expect(filterCommands(GUI_COMMANDS, 'auto-edits').map((c) => c.id).slice(0, 2)).toEqual(expect.arrayContaining(['mode.auto-edits']));
  });
  it('no block button can change a mode (a block press is presentation only)', () => {
    for (const id of BLOCK_SAFE_COMMANDS) expect(id.startsWith('mode.')).toBe(false);
  });
});

describe('run modes in the transcript: what auto-edits passed is shown inline', () => {
  const rows: Row[] = [
    { seq: 1, kind: 'session.open', session: HSID, view: 'full', payload: { hsid: HSID, cwd: '/w', model: 'claude' } },
    { seq: 2, kind: 'approval.mode.set', session: HSID, view: 'full', payload: { scope: { repo: REPO, hsid: HSID }, from: 'ask', to: 'auto-edits', presence: 'fresh' } },
    { seq: 3, kind: 'approval.auto', session: HSID, view: 'full', payload: { hsid: HSID, tool: 'Edit', path: '/w/src/a.ts', inputHash: 'sha256:00', modeRef: 'mode:auto-edits' } },
    { seq: 4, kind: 'approval.auto', session: HSID, view: 'full', payload: { hsid: HSID, tool: 'Write', inputHash: 'sha256:01', modeRef: 'rule:card:01HZZZZZZZZZZZZZZZZZZZZZZZ' } },
  ];
  it('approval.auto ⇒ a subtle "auto-approved edit · <path>" line; a rule ⇒ "auto-approved · <tool> (always rule)"; a mode change ⇒ a system line', () => {
    const { items } = chatItems(rows);
    expect(items.map((i) => [i.role, i.text])).toEqual([
      ['system', 'session opened · claude · /w'],
      ['system', 'run mode ask → auto-edits · Touch ID'],
      ['auto', 'auto-approved edit · /w/src/a.ts'],
      ['auto', 'auto-approved · Write (always rule)'],
    ]);
  });
  it('the store flags `modes` on a mode or session row, so the page re-reads status (no polling)', () => {
    const s = new GuiStore();
    const wire = (r: Row) => ({ seq: r.seq, view: 'full', event: { kind: r.kind, session: r.session, payload: r.payload } }); // log.read's row shape
    expect(s.apply([wire(rows[0]!)]).has('modes')).toBe(true);
    expect(s.apply([wire(rows[1]!)]).has('modes')).toBe(true);
    expect(s.apply([wire(rows[2]!)]).has('modes')).toBe(false);
    expect(chatItems(s.transcript(HSID)).items.map((i) => i.text)).toContain('auto-approved edit · /w/src/a.ts');
  });
});

describe('run modes: the page wiring (source read; the browser smoke drives the DOM)', () => {
  const app = readFileSync(path.join(ROOT, 'src', 'ui', 'app.ts'), 'utf8');
  const html = readFileSync(path.join(ROOT, 'static', 'index.html'), 'utf8');
  it('the header carries the kernel-owned mode button and its menu; the composer placeholder names ⇧Tab', () => {
    expect(html).toMatch(/id="mode-btn"[^>]*kernel-owned/);
    expect(html).toContain('id="mode-menu"');
    expect(html).toContain('Shift+Tab cycles the run mode');
  });
  it('⇧Tab in the composer cycles the mode on a trusted event only; a choice is sent only on a trusted gesture (G-GUI-04)', () => {
    expect(app).toMatch(/e\.key === 'Tab' && e\.shiftKey[\s\S]{0,200}cycleMode\(e\.isTrusted\)/);
    expect(app).toMatch(/async function setMode\(to: RunMode, scope: ModeScope, trusted: boolean\): Promise<void> \{\s*if \(!trusted\) return;/);
    expect(app).toMatch(/setMode\(b\.dataset\.mode as RunMode, defaultScope\(currentMode\(\)\), e\.isTrusted\)/);
  });
  it('a loosening is decided in the SAME gesture: the pending card is approved `allow` right after the request (the kernel asks for Touch ID)', () => {
    expect(app).toMatch(/client\.call<Record<string, unknown>>\('log\.append', req\);[\s\S]{0,200}r\.pending === true[\s\S]{0,300}client\.call\('approve', \{ cardId: r\.cardId, decision: 'allow' \}\)/);
  });
  it('the control is repainted from status on a mode row, never on a timer', () => {
    expect(app).toContain("if (w.has('modes') || w.has('voice')) void refreshStatus();");
    // the one timer is V2e's light status poll while the enrol dialog waits on the voice app (syncEnrolPoll), and the dictation tick + ~300 ms status poll while a draft exists (syncDictationTimer, TD-2026-10-20-262), and the ~300 ms status re-read while the voice app speaks (syncSpeakPoll, T-2026-10-19-026), and the 2 s re-read while voice is attached or the app is in a transient phase (syncClientPoll, T-2026-10-20-002)
    expect(app.replace(/function syncEnrolPoll\([\s\S]*?\n\}\n/, '').replace(/function syncDictationTimer\([\s\S]*?\n\}\n/, '').replace(/function syncSpeakPoll\([\s\S]*?\n\}\n/, '').replace(/function syncClientPoll\([\s\S]*?\n\}\n/, '')).not.toMatch(/setInterval\(|setTimeout\([^)]*refreshStatus/);
  });
});
