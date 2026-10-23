/**
 * #gui-folder-field (TD-2026-10-23-162, design-system component folder-field, rule paths-are-chosen): every state of
 * the three variants, the kernel requests each sends, and the keyboard order (roving radios, then Choose folder…,
 * then Type a path, then the model, then Open).
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { binaryChangedLine, cardOutcomeOf, RepinReturn, type KeptChoice, checkLine, chooseRequest, REPIN_COPY, checkRequest, fieldView, FolderField, FF_COPY, folderCheckOf, foldersStatusOf, recentsOf, whenText, type FolderCheck, type FolderRequest } from '../src/core/folder-field.js';
import type { MiniDoc, MiniEl } from '../src/core/render.js';
import { GuiStore } from '../src/core/store.js';
import { folderFieldEl, routeFolderPress } from '../src/ui/folder-field.js';

const ROOT = path.resolve(__dirname, '..');

class FText {
  constructor(readonly data: string) {}
}
class FEl implements MiniEl {
  className = '';
  disabled = false;
  readonly attrs = new Map<string, string>();
  children: Array<FEl | FText> = [];
  constructor(readonly tag: string) {}
  appendChild(c: unknown): unknown {
    this.children.push(c as FEl | FText);
    return c;
  }
  setAttribute(n: string, v: string): void {
    this.attrs.set(n, v);
  }
  get text(): string {
    return this.children.map((c) => (c instanceof FText ? c.data : c.text)).join('');
  }
  all(): FEl[] {
    return [this, ...this.children.flatMap((c) => (c instanceof FEl ? c.all() : []))];
  }
}
const fdoc: MiniDoc = { createElement: (t) => new FEl(t), createTextNode: (s) => new FText(s) };

const HOME = '/Users/me';
const ok = (real: string, extra: Partial<FolderCheck> = {}): FolderCheck => ({ ok: true, why: 'ok', real, display: real.replace(HOME, '~'), name: real.split('/').pop()!, home: 'inside', ...extra });
const RECENTS = [
  { real: `${HOME}/code/a-paradigm`, display: '~/code/a-paradigm', repoName: 'a-paradigm', lastUsedAt: '2026-10-23T14:06:00' },
  { real: `${HOME}/code/a-atelier`, display: '~/code/a-atelier', repoName: 'a-atelier', lastUsedAt: '2026-10-22T11:40:00' },
  { real: '/Volumes/Work/client-site', display: '/Volumes/Work/client-site', repoName: 'client-site', lastUsedAt: '2026-10-17T09:00:00' },
];

/** A field over a fake kernel: answers per request kind; timers run when flushed. */
function rig(purpose: 'session' | 'runner' | 'mod' | 'command', kernel: (req: FolderRequest) => unknown, status: unknown = { folders: { chooser: true } }) {
  const sent: FolderRequest[] = [];
  const timers: Array<() => void> = [];
  const chose: string[] = [];
  let paints = 0;
  const f = new FolderField({
    purpose,
    call: async (req) => {
      sent.push(req);
      const r = kernel(req);
      if (r instanceof Error) throw r;
      return r;
    },
    changed: () => void paints++,
    chose: (r) => chose.push(r),
    now: () => new Date('2026-10-23T15:00:00'),
    setTimer: (fn) => (timers.push(fn), timers.length),
    clearTimer: () => undefined,
  });
  f.setStatus(status);
  const flush = async () => {
    while (timers.length) timers.shift()!();
    await new Promise((r) => setTimeout(r, 0));
  };
  return { f, sent, flush, chose, paints: () => paints, view: (v: 'recents' | 'compact' = purpose === 'session' ? 'recents' : 'compact') => fieldView(f, v) };
}
const refusal = (code: string, why: string, extra: Record<string, unknown> = {}) => Object.assign(new Error(why), { refusal: { code, reason: why, message: why, next: [], data: { why, ...extra } } });

describe('requests and answers', () => {
  it('choose asks by purpose (the prompt is the kernel’s), check expects what the folder must hold, and odd answers are dropped', () => {
    expect(chooseRequest('session', '/Users/me/code')).toEqual({ kind: 'request.folder.choose', payload: { kind: 'folder', purpose: 'session', startIn: '/Users/me/code' } });
    expect(chooseRequest('command', null)).toEqual({ kind: 'request.folder.choose', payload: { kind: 'file', purpose: 'command' } });
    expect(checkRequest('runner', '~/x')).toEqual({ kind: 'request.folder.check', payload: { path: '~/x', kind: 'folder', expect: 'cli.js' } });
    expect(checkRequest('mod', '/m').payload.expect).toBe('gnomon-manifest.json');
    expect(folderCheckOf({ ok: 'yes', why: 'ok', real: '/', display: '/' })).toBeNull();
    expect(folderCheckOf({ ok: true, why: 'weird', real: '/', display: '/' })).toBeNull();
    expect(recentsOf({ recent: [...RECENTS, { real: 1 }, ...RECENTS, ...RECENTS] })).toHaveLength(6);
    expect(foldersStatusOf({})).toBeNull();
    expect(foldersStatusOf({ folders: { chooser: false } })).toEqual({ chooser: false });
  });
  it('when: today hh:mm, yesterday, Mon d', () => {
    const now = new Date('2026-10-23T15:00:00');
    expect(whenText('2026-10-23T14:06:00', now)).toBe('today 14:06');
    expect(whenText('2026-10-22T23:00:00', now)).toBe('yesterday');
    expect(whenText('2026-10-19T08:00:00', now)).toBe('Oct 19');
  });
  it('every check line in the system’s words', () => {
    const c = (why: FolderCheck['why'], extra: Partial<FolderCheck> = {}) => checkLine({ ...ok('/Users/me/x'), ok: false, why, ...extra }, 'session', true);
    expect(c('not-absolute')!.text).toBe('✕ Start the path with / or ~/');
    expect(c('missing')!.text).toBe('✕ Nothing at ~/x. Check the spelling, or use Choose folder….');
    expect(c('file')!.text).toBe('✕ ~/x is a file. Choose the folder that holds it.');
    expect(c('unreadable')!.text).toContain("macOS hasn't allowed it. next: System Settings › Privacy & Security › Files and Folders");
    expect(checkLine({ ...ok('/r'), ok: false, why: 'wrong-contents', suggest: { real: '/r/dist', display: '/r/dist' } }, 'runner', false)).toMatchObject({ tone: 'err', text: '✕ /r has no cli.js. Its dist folder does.', suggest: { real: '/r/dist' } });
    expect(checkLine({ ...ok('/m'), ok: false, why: 'wrong-contents' }, 'mod', false)!.text).toBe('✕ /m has no gnomon-manifest.json. Choose the folder that holds it.');
    expect(checkLine({ ...ok(HOME), why: 'home', home: 'home-or-above' }, 'session', false)).toEqual({ tone: 'warn', lead: FF_COPY.homeLead, text: FF_COPY.homeRest });
    expect(checkLine(ok('/x'), 'session', true)!.text).toBe('✓ folder found');
    expect(checkLine(ok('/x'), 'session', false)).toBeNull();
    expect(checkLine({ ...ok('/x/t.sh'), ok: false, why: 'not-executable' }, 'command', true)!.text).toContain("can't be run");
    // Aegis L1: grant THIS folder, and say sessions run under that access; M1/M3: timeout, network, device
    expect(c('unreadable')!.text).toContain('allow Gnomon this folder, then choose it again. Sessions opened here run with that access.');
    expect(c('timeout')!.text).toContain("didn't answer in time");
    expect(c('network')!.text).toBe('✕ ~/x is on a network share. Choose a folder on this Mac.');
    expect(c('device')!.text).toContain('is a device path');
    expect(folderCheckOf({ ok: false, why: 'network', real: '', display: '/net/x' })?.why).toBe('network');
  });
});

describe('recents (New session): every state', () => {
  const kernel = (extra: (req: FolderRequest) => unknown = () => undefined) => (req: FolderRequest) => extra(req) ?? (req.kind === 'request.folder.recent' ? { recent: RECENTS } : req.kind === 'request.folder.check' ? ok(String(req.payload.path)) : { cancelled: true });

  it('empty: no recents, focus on Choose folder…, Open says choose a folder first', async () => {
    const r = rig('session', (req) => (req.kind === 'request.folder.recent' ? { recent: [] } : null));
    await r.f.loadRecents(null);
    const v = r.view();
    expect(v.empty).toBe(true);
    expect(r.f.takeFocus()).toBe('choose');
    expect(r.f.whyOff()).toBe('choose a folder first');
    const el = folderFieldEl(fdoc, v, 'ns', { text: 'folder', cls: 'meta' }) as FEl;
    expect(el.text).toContain(FF_COPY.empty);
  });
  it('recents: the centre session’s folder is chosen (C2), else the most recent; Open is usable at once (⌘N then Enter)', async () => {
    const r = rig('session', kernel());
    await r.f.loadRecents(`${HOME}/code/a-atelier`);
    expect(r.f.state().chosen?.real).toBe(`${HOME}/code/a-atelier`);
    expect(r.f.value()).toBe(`${HOME}/code/a-atelier`); // a kernel-listed recent while its check runs
    expect(r.chose).toEqual([`${HOME}/code/a-atelier`]); // the remembered model is restored for it
    expect(r.f.takeFocus()).toBe('chosen');
    await r.f.settled();
    const v = r.view();
    expect(v.rows.map((x) => [x.name, x.checked, x.when])).toEqual([['a-paradigm', false, 'today 14:06'], ['a-atelier', true, 'yesterday'], ['client-site', false, 'Oct 17']]);
    expect(v.opens).toEqual({ display: '~/code/a-atelier', outside: false });
    const s = rig('session', kernel());
    await s.f.loadRecents('/somewhere/else');
    expect(s.f.state().chosen?.real).toBe(`${HOME}/code/a-paradigm`);
  });
  it('chosen elsewhere: outside the home folder says so on the opens-in line', async () => {
    const r = rig('session', kernel((req) => (req.kind === 'request.folder.check' && String(req.payload.path).startsWith('/Volumes') ? ok('/Volumes/Work/client-site', { why: 'outside-home', home: 'outside' }) : undefined)));
    await r.f.loadRecents(null);
    r.f.pickRecent('/Volumes/Work/client-site');
    await r.f.settled();
    expect(r.view().opens).toEqual({ display: '/Volumes/Work/client-site', outside: true });
  });
  it('chooser-open, chosen (just chosen, on top), cancelled (nothing changes, sr status)', async () => {
    let answer: unknown = { cancelled: true };
    const r = rig('session', kernel((req) => (req.kind === 'request.folder.choose' ? answer : undefined)));
    await r.f.loadRecents(null);
    await r.f.settled();
    const p = r.f.choose();
    expect(r.view().status).toBe(FF_COPY.chooserOpen);
    expect(r.view().chooseLabel).toBe('Choosing…');
    expect(r.f.whyOff()).toBe('waiting for the chooser');
    expect(r.sent.find((x) => x.kind === 'request.folder.choose')!.payload).toEqual({ kind: 'folder', purpose: 'session', startIn: `${HOME}/code` });
    await p;
    expect(r.f.state().chosen?.real).toBe(`${HOME}/code/a-paradigm`);
    expect(r.view().sr).toBe(FF_COPY.cancelledSr);
    expect(r.f.takeFocus()).toBe('choose');
    answer = { path: `${HOME}/code/a-new-thing`, display: '~/code/a-new-thing', check: ok(`${HOME}/code/a-new-thing`) };
    await r.f.choose();
    const v = r.view();
    expect(v.rows[0]).toMatchObject({ name: 'a-new-thing', checked: true, when: 'just chosen' });
    expect(v.opens?.display).toBe('~/code/a-new-thing');
    expect(r.f.takeFocus()).toBe('chosen');
    expect(r.chose.at(-1)).toBe(`${HOME}/code/a-new-thing`);
  });
  it('a recent picked while the chooser is open closes it (cancel request) and the late answer is ignored', async () => {
    let release: (v: unknown) => void = () => undefined;
    const sent: FolderRequest[] = [];
    const f = new FolderField({ purpose: 'session', changed: () => undefined, call: (req) => (sent.push(req), req.kind === 'request.folder.choose' && !('cancel' in req.payload) ? new Promise((res) => (release = res)) : Promise.resolve(req.kind === 'request.folder.recent' ? { recent: RECENTS } : req.kind === 'request.folder.check' ? ok(String(req.payload.path)) : { cancelled: true, closed: true })) });
    f.setStatus({ folders: { chooser: true } });
    await f.loadRecents(null);
    const p = f.choose();
    f.pickRecent(`${HOME}/code/a-atelier`);
    expect(sent.some((x) => x.payload.cancel === true)).toBe(true);
    release({ path: '/late', display: '/late', check: ok('/late') });
    await p;
    expect(f.state().chosen?.real).toBe(`${HOME}/code/a-atelier`);
  });
  it('typed-open, checking (past 150 ms only), found, not-absolute, missing, not-a-folder, unreadable', async () => {
    const answers: Record<string, FolderCheck> = {
      '~/scratch': ok(`${HOME}/scratch`),
      'code/x': { ...ok(''), ok: false, why: 'not-absolute', real: '', display: 'code/x' },
      '~/nope': { ...ok(`${HOME}/nope`), ok: false, why: 'missing', real: '' },
      '~/q.pdf': { ...ok(`${HOME}/q.pdf`), ok: false, why: 'file' },
      '~/Taxes': { ...ok(`${HOME}/Taxes`), ok: false, why: 'unreadable' },
    };
    const r = rig('session', kernel((req) => (req.kind === 'request.folder.check' && String(req.payload.path) in answers ? answers[String(req.payload.path)] : undefined)));
    await r.f.loadRecents(null);
    await r.f.settled();
    r.f.toggleTyped();
    expect(r.view().typedLabel).toBe('Type a path ▾');
    expect(r.f.takeFocus()).toBe('typed');
    r.f.typedInput('~/scratch');
    expect(r.f.whyOff()).toBe('checking…');
    await r.flush(); // the 300 ms debounce fires; the 150 ms "checking…" timer fires too
    await r.f.settled();
    expect(r.view().line).toEqual({ tone: 'ok', text: '✓ folder found' });
    expect(r.f.value()).toBe(`${HOME}/scratch`);
    expect(r.view().rows.every((x) => !x.checked)).toBe(true); // typing clears the row choice
    for (const [p, why, off] of [['code/x', '✕ Start the path with / or ~/', 'fix the path first'], ['~/nope', '✕ Nothing at', 'fix the path first'], ['~/q.pdf', 'is a file', 'fix the path first'], ['~/Taxes', "Gnomon can't read", "Gnomon can't read this folder"]] as const) {
      r.f.typedInput(p);
      await r.flush();
      await r.f.settled();
      expect(r.view().line?.text, p).toContain(why);
      expect(r.f.value(), p).toBeNull();
      expect(r.f.whyOff(), p).toBe(off);
    }
  });
  it('home-or-above: allowed with the amber warning (C4)', async () => {
    const r = rig('session', kernel((req) => (req.kind === 'request.folder.check' ? ok(HOME, { why: 'home', home: 'home-or-above', display: '~' }) : undefined)));
    await r.f.loadRecents(null);
    await r.f.settled();
    expect(r.f.value()).toBe(HOME);
    expect(r.view().line?.tone).toBe('warn');
    const el = folderFieldEl(fdoc, r.view(), 'ns', { text: 'folder', cls: 'meta' }) as FEl;
    const warn = el.all().find((e) => e.className === 'ff-warn')!;
    expect(warn.attrs.get('role')).toBe('status');
    expect(warn.text).toBe(`${FF_COPY.homeLead}${FF_COPY.homeRest}`);
  });
  it('terminal hint: checked and chosen "from terminal", never submitted', async () => {
    const r = rig('session', kernel());
    r.f.setHint(FF_COPY.hint, `${HOME}/proj`);
    await r.f.loadRecents(null);
    await r.f.settled();
    expect(r.f.state().chosen).toMatchObject({ real: `${HOME}/proj`, when: 'from terminal' });
    expect(r.view().rows[0]).toMatchObject({ checked: true, when: 'from terminal' });
    expect(r.view().hint).toBe(FF_COPY.hint);
  });
  it('no-chooser: the typed path opens by default and the chooser key is gone; a no-chooser refusal falls back the same way', async () => {
    const r = rig('session', kernel(), { folders: { chooser: false } });
    expect(r.view().chooseLabel).toBeNull();
    expect(r.view().typedOpen).toBe(true);
    expect(r.view().noChooser).toBe(FF_COPY.noChooser);
    const s = rig('session', kernel((req) => (req.kind === 'request.folder.choose' ? refusal('UNSUPPORTED', 'no-chooser') : undefined)));
    await s.f.choose();
    expect(s.view().typedOpen).toBe(true);
    expect(s.view().chooseLabel).toBeNull();
  });
  it('opening and refused: the choice stays, ✕ on the row, Open says choose another folder', async () => {
    const r = rig('session', kernel());
    await r.f.loadRecents(null);
    await r.f.settled();
    r.f.setOpening(true);
    expect(r.f.state().opening).toBe(true);
    r.f.setRefused('BAD_REQUEST  ~/code/a-paradigm is no longer there · next: choose the folder again');
    expect(r.f.state().chosen?.real).toBe(`${HOME}/code/a-paradigm`);
    expect(r.view().rows[0]).toMatchObject({ checked: true, failed: true });
    expect(r.f.whyOff()).toBe('choose another folder');
    expect(r.view().line).toMatchObject({ tone: 'err' });
  });
  it('a rate-limited check is retried once after the kernel’s retryAfterMs', async () => {
    let n = 0;
    const r = rig('session', kernel((req) => (req.kind === 'request.folder.check' && n++ === 0 ? refusal('BAD_REQUEST', 'rate-limited', { retryAfterMs: 10 }) : undefined)));
    await r.f.loadRecents(null);
    await r.flush();
    await r.flush();
    await r.f.settled();
    expect(r.f.state().check?.ok).toBe(true);
    expect(r.sent.filter((x) => x.kind === 'request.folder.check')).toHaveLength(2);
  });
});

describe('compact and file variants', () => {
  it('runner: none · the bundled runner is used; Choose folder… → wrong-contents with "Use …/dist"; Use → found; Clear', async () => {
    const r = rig('runner', (req) => (req.kind === 'request.folder.choose' ? { path: '/r', display: '~/r', check: { ...ok('/r'), ok: false, why: 'wrong-contents', display: '~/r', suggest: { real: '/r/dist', display: '~/r/dist' } } } : req.kind === 'request.folder.check' ? ok(String(req.payload.path), { display: '~/r/dist' }) : null));
    expect(r.view().value).toBeNull();
    expect(r.view().none).toBe('none · the bundled runner is used');
    expect(r.view().chooseLabel).toBe('Choose folder…');
    await r.f.choose();
    expect(r.view().line).toMatchObject({ tone: 'err', suggest: { display: '~/r/dist' } });
    expect(r.f.value()).toBeNull();
    const el = folderFieldEl(fdoc, r.view(), 'lm-runner', { text: 'use another runner (optional)', cls: 'sf-label' }) as FEl;
    expect(el.all().find((e) => e.attrs.get('data-ff-act') === 'use')!.text).toBe('Use ~/r/dist');
    r.f.useSuggestion();
    await r.f.settled();
    expect(r.f.value()).toBe('/r/dist');
    expect(r.view().value).toEqual({ display: '~/r/dist' });
    expect(r.view().chooseLabel).toBe('Choose another…');
    expect(r.view().clear).toBe(true);
    r.f.clear();
    expect(r.f.value()).toBeNull();
    expect(r.view().value).toBeNull();
  });
  it('Mods › Add: a chosen folder without a manifest says so beside Add (Mika), not "fix the path first"', async () => {
    const r = rig('mod', (req) => (req.kind === 'request.folder.choose' ? { path: '/n', display: '~/notes', check: { ...ok('/n'), ok: false, why: 'wrong-contents', display: '~/notes' } } : null));
    await r.f.choose();
    expect(r.f.whyOff()).toBe('choose a folder with gnomon-manifest.json');
  });
  it('file (Mods › Configure command): Choose file…, the file chooser status, an executable file found', async () => {
    let release: (v: unknown) => void = () => undefined;
    const f = new FolderField({ purpose: 'command', changed: () => undefined, call: (req) => (req.kind === 'request.folder.choose' ? new Promise((res) => (release = res)) : Promise.resolve(null)) });
    f.setStatus({ folders: { chooser: true } });
    expect(fieldView(f, 'compact').chooseLabel).toBe('Choose file…');
    expect(fieldView(f, 'compact').none).toBe('none · it launches as it does today');
    const p = f.choose();
    expect(fieldView(f, 'compact').status).toBe(FF_COPY.fileChooserOpen);
    release({ path: '/opt/bin/mcp', display: '/opt/bin/mcp', check: ok('/opt/bin/mcp', { home: 'outside', why: 'outside-home' }) });
    await p;
    expect(f.value()).toBe('/opt/bin/mcp');
  });
  it('a kernel that predates the folder requests: a typed absolute path goes as typed, no chooser', async () => {
    const r = rig('mod', () => null, {});
    expect(r.view().chooseLabel).toBeNull();
    r.f.typedInput('/m');
    await r.flush();
    await r.f.settled();
    expect(r.f.value()).toBe('/m');
    expect(r.sent).toEqual([]);
  });
});

describe('drawn: roles, never-rules, keyboard order', () => {
  it('the recents are one radiogroup with ONE tab stop (the chosen row); then Choose folder…, then Type a path; no placeholder anywhere', async () => {
    const r = rig('session', (req) => (req.kind === 'request.folder.recent' ? { recent: RECENTS } : req.kind === 'request.folder.check' ? ok(String(req.payload.path)) : null));
    await r.f.loadRecents(`${HOME}/code/a-atelier`);
    await r.f.settled();
    r.f.toggleTyped();
    const el = folderFieldEl(fdoc, r.view(), 'ns', { text: 'folder', cls: 'meta' }) as FEl;
    const all = el.all();
    expect(all[0]!.tag).toBe('fieldset');
    expect(all.find((e) => e.tag === 'legend')!.text).toBe('folder');
    const group = all.find((e) => e.attrs.get('role') === 'radiogroup')!;
    expect(group.attrs.get('aria-label')).toBe('Recent folders');
    const rows = all.filter((e) => e.attrs.get('role') === 'radio');
    expect(rows.map((x) => x.attrs.get('tabindex'))).toEqual(['-1', '0', '-1']);
    expect(rows[1]!.attrs.get('aria-checked')).toBe('true');
    expect(rows[1]!.attrs.get('aria-label')).toBe('a-atelier, ~/code/a-atelier, last used yesterday');
    // Tab order (document order of the focusables): the chosen radio, Choose folder…, Type a path, the typed field
    const focusables = all.filter((e) => (e.tag === 'button' && e.attrs.get('tabindex') !== '-1') || e.tag === 'input');
    expect(focusables.map((e) => e.attrs.get('data-ff-act') ?? (e.tag === 'input' ? 'typed-input' : '?'))).toEqual(['row', 'choose', 'typed', 'typed-input']);
    expect(all.find((e) => e.attrs.get('data-ff-act') === 'typed')!.attrs.get('aria-expanded')).toBe('true');
    expect(all.some((e) => e.attrs.has('placeholder'))).toBe(false);
  });
  it('the New session sheet: role=dialog named by its h2; the folder, the model, then cancel and Open (primary) in order; no cwd copy', () => {
    const html = readFileSync(path.join(ROOT, 'static', 'index.html'), 'utf8');
    const form = /<form id="new-session-form"[^]*?<\/form>/.exec(html)![0];
    expect(form).toMatch(/role="dialog" aria-modal="true" aria-labelledby="ns-title"/);
    expect(form).toContain('<h2 id="ns-title" class="title">New session</h2>');
    const order = ['id="ns-folder"', 'id="ns-model"', 'id="ns-cancel"', 'id="ns-why"', 'id="ns-open" class="key pri" type="submit">Open<'].map((k) => form.indexOf(k));
    expect(order.every((x, i) => x > 0 && (i === 0 || x > order[i - 1]!))).toBe(true);
    expect(form).not.toMatch(/\bcwd\b|placeholder/);
  });
  it('app.ts keeps the sheet open until session.open answers, shows a refusal in place, and Esc closes it (and the chooser)', () => {
    const app = readFileSync(path.join(ROOT, 'src', 'ui', 'app.ts'), 'utf8');
    const sub = app.slice(app.indexOf('async function submitNewSession('), app.indexOf('\n}', app.indexOf('async function submitNewSession(')));
    expect(sub.indexOf('await openSession(')).toBeLessThan(sub.indexOf('closeNewSessionSheet()'));
    expect(sub).toContain('nsField.setRefused(');
    expect(app).toMatch(/e\.key === 'Escape' && !\$\('new-session-dialog'\)\.hidden\) \{[\s\S]{0,200}closeNewSessionSheet\(\)/);
    expect(app.slice(app.indexOf('function closeNewSessionSheet('), app.indexOf('function closeNewSessionSheet(') + 300)).toContain('nsField.closed()');
  });
  it('no placeholder path survives in the GUI sources (design never: a placeholder that looks like a value)', () => {
    for (const f of ['src/core/local-model.ts', 'src/ui/mods-panel.ts', 'static/index.html']) expect(readFileSync(path.join(ROOT, f), 'utf8'), f).not.toMatch(/\/Users\/you\/|\/absolute\/path\/to|\/opt\/homebrew\/bin\/…/);
  });
});

describe('review fixes (Mika, built review 2026-10-23)', () => {
  const kernel = (extra: (req: FolderRequest) => unknown = () => undefined) => (req: FolderRequest) => extra(req) ?? (req.kind === 'request.folder.recent' ? { recent: RECENTS } : req.kind === 'request.folder.check' ? ok(String(req.payload.path)) : { cancelled: true });
  it('a refusal that is not about the folder keeps the folder unmarked and Open enabled; the next attempt clears it', async () => {
    const r = rig('session', kernel());
    await r.f.loadRecents(null);
    await r.f.settled();
    r.f.setOpenFailed('UNAVAILABLE preview: there is no kernel, so no session was opened');
    expect(r.view().rows[0]).toMatchObject({ checked: true, failed: false });
    expect(r.view().error).toMatch(/^UNAVAILABLE/);
    expect(r.f.whyOff()).toBeNull();
    expect(r.f.value()).toBe(`${HOME}/code/a-paradigm`);
    r.f.setRefused(null);
    expect(r.view().error).toBeNull();
  });
  it('the recents show at most six rows; a just-chosen folder pushes the oldest recent out, and the chosen row is never dropped', async () => {
    const many = Array.from({ length: 6 }, (_, i) => ({ real: `${HOME}/code/p${i}`, display: `~/code/p${i}`, repoName: `p${i}`, lastUsedAt: '2026-10-22T10:00:00' }));
    let answer: unknown = null;
    const r = rig('session', (req) => (req.kind === 'request.folder.recent' ? { recent: many } : req.kind === 'request.folder.choose' ? answer : req.kind === 'request.folder.check' ? ok(String(req.payload.path)) : undefined));
    await r.f.loadRecents(null);
    await r.f.settled();
    answer = { check: ok(`${HOME}/code/new`) };
    await r.f.choose();
    const rows = r.view().rows;
    expect(rows).toHaveLength(6);
    expect(rows[0]).toMatchObject({ real: `${HOME}/code/new`, checked: true });
    expect(rows.some((x) => x.real === `${HOME}/code/p5`)).toBe(false);
    r.f.pickRecent(`${HOME}/code/p5`);
    expect(r.view().rows.some((x) => x.real === `${HOME}/code/p5`)).toBe(false); // not a row: picking it does nothing
  });
  it('Choosing… stays focusable (aria-disabled, not disabled) so focus does not fall to <body>', async () => {
    const r = rig('session', kernel((req) => (req.kind === 'request.folder.choose' ? new Promise(() => undefined) : undefined)));
    await r.f.loadRecents(null);
    await r.f.settled();
    void r.f.choose();
    const el = folderFieldEl(fdoc, r.view(), 'ns-ff', { text: 'folder', cls: 'meta' }) as unknown as FEl;
    const key = el.all().find((e) => e.attrs.get('data-ff-act') === 'choose')!;
    expect(key.disabled).toBe(false);
    expect(key.attrs.get('aria-disabled')).toBe('true');
    expect(key.attrs.get('aria-busy')).toBe('true');
  });
  it('the New session sheet keeps Tab inside it (aria-modal: trapNext), and a non-folder refusal keeps Open for a retry', () => {
    const app = readFileSync(path.join(ROOT, 'src/ui/app.ts'), 'utf8');
    const trap = app.slice(app.indexOf("const dlg = $('new-session-dialog');"), app.indexOf("$('ns-cancel').addEventListener"));
    expect(trap).toContain('trapNext(items');
    expect(app).toContain('else nsField.setOpenFailed(why);');
  });
  it('a typed home folder shows the amber warning once, under the field', async () => {
    const r = rig('session', kernel((req) => (req.kind === 'request.folder.check' ? ok(HOME, { why: 'home', home: 'home-or-above', display: '~' }) : undefined)));
    await r.f.loadRecents(null);
    await r.f.settled();
    r.f.toggleTyped();
    r.f.typedInput('~');
    await r.flush();
    await r.f.settled();
    const el = folderFieldEl(fdoc, r.view(), 'ns-ff', { text: 'folder', cls: 'meta' }) as unknown as FEl;
    expect(el.all().filter((e) => e.className === 'ff-warn')).toHaveLength(1);
  });
  it('a kernel without the folder requests puts focus in the typed path when the sheet opens', async () => {
    const r = rig('session', () => null, {});
    await r.f.loadRecents(null);
    expect(r.f.takeFocus()).toBe('typed');
  });
  it('the opens-in path and the warning lead are styled as the <strong> the DOM draws; the sheet scrolls when taller than the window', () => {
    const css = readFileSync(path.join(ROOT, 'static/styles.css'), 'utf8');
    expect(css).toMatch(/\.ff-opens strong \{ font-weight: 600; color: var\(--ink\); \}/);
    expect(css).toMatch(/\.ff-warn strong \{ font-weight: 600; \}/);
    expect(css).toMatch(/\.ns-card \{[^}]*max-height: calc\(86vh - 16px\); overflow-y: auto;/);
  });
});

describe('open-failed with one key: a changed claude binary (TD-2026-10-19-063, founder field test 2026-10-23)', () => {
  const kernel = (req: FolderRequest) => (req.kind === 'request.folder.recent' ? { recent: RECENTS } : req.kind === 'request.folder.check' ? ok(String(req.payload.path)) : { cancelled: true });
  const repinData = { session: 'claude_binary_changed', cardId: 'card:repin-1', next: 'approve the re-pin card', expected: 'aa', found: 'bb' };
  it('the words are plain: no code, no symbol prefix, no offline CLI hint; the key only when the refusal names its card', () => {
    const withCard = binaryChangedLine(repinData)!;
    expect(withCard).toEqual({ text: 'Claude Code updated itself, so its binary no longer matches the one Gnomon pinned. next: review the re-pin card.', cardId: 'card:repin-1' });
    expect(withCard.text).not.toMatch(/UNSUPPORTED|#supervisor|#session-runner|sha256|gnomon session repin-claude/);
    const denied = binaryChangedLine({ session: 'claude_binary_changed', next: 're-pin denied; restart Gnomon to re-offer' })!;
    expect(denied).toEqual({ text: 'Claude Code updated itself, so its binary no longer matches the one Gnomon pinned. next: re-pin denied; restart Gnomon to re-offer.', cardId: null });
    expect(binaryChangedLine({ session: 'claude_binary_changed' })!.text).toMatch(/next: restart Gnomon to be offered the re-pin card again\.$/);
    expect(binaryChangedLine({ session: 'claude_version' })).toBeNull();
    expect(binaryChangedLine(null)).toBeNull();
  });
  it('the keyed open-failed line keeps the folder chosen, Open enabled, and draws one key that runs only on a trusted press', async () => {
    const r = rig('session', kernel);
    await r.f.loadRecents(null);
    await r.f.settled();
    const line = binaryChangedLine(repinData)!;
    const pressed: string[] = [];
    r.f.setOpenFailed(line.text, { label: REPIN_COPY.key, title: REPIN_COPY.keyTitle, press: () => pressed.push(line.cardId!) });
    expect(r.view().rows[0]).toMatchObject({ checked: true, failed: false });
    expect(r.f.value()).toBe(`${HOME}/code/a-paradigm`);
    expect(r.f.whyOff()).toBeNull();
    expect(r.view().errorKey).toEqual({ label: 'Review re-pin card', title: REPIN_COPY.keyTitle });
    const el = folderFieldEl(fdoc, r.view(), 'ns-ff', { text: 'folder', cls: 'meta' }) as unknown as FEl;
    const err = el.all().find((e) => e.className === 'sf-err')!;
    expect(err.attrs.get('role')).toBe('alert');
    expect(err.text).toBe(`✕ ${line.text} Review re-pin card`);
    const keys = el.all().filter((e) => e.attrs.get('data-ff-act') === 'error-key');
    expect(keys).toHaveLength(1);
    expect(keys[0]!.className).toBe('key');
    expect(routeFolderPress(r.f, 'error-key', null, false)).toBe(true); // G-GUI-04: a script-made press does nothing
    expect(pressed).toEqual([]);
    routeFolderPress(r.f, 'error-key', null, true);
    expect(pressed).toEqual(['card:repin-1']);
  });
  it('no card: the words show with no key; a new attempt or another error drops the key with its line', async () => {
    const r = rig('session', kernel);
    await r.f.loadRecents(null);
    await r.f.settled();
    r.f.setOpenFailed(binaryChangedLine({ session: 'claude_binary_changed', next: 're-pin denied; restart Gnomon to re-offer' })!.text);
    expect(r.view().errorKey).toBeNull();
    const el = folderFieldEl(fdoc, r.view(), 'ns-ff', { text: 'folder', cls: 'meta' }) as unknown as FEl;
    expect(el.all().some((e) => e.attrs.get('data-ff-act') === 'error-key')).toBe(false);
    let pressed = 0;
    r.f.setOpenFailed('x', { label: 'K', title: 't', press: () => void pressed++ });
    r.f.setRefused(null); // the next Open attempt
    expect(r.view().error).toBeNull();
    expect(r.view().errorKey).toBeNull();
    r.f.pressErrorKey();
    expect(pressed).toBe(0);
    r.f.setOpenFailed('x', { label: 'K', title: 't', press: () => void pressed++ });
    r.f.setOpenFailed('UNAVAILABLE preview: there is no kernel');
    expect(r.view().errorKey).toBeNull();
    r.f.pressErrorKey();
    expect(pressed).toBe(0);
  });
  it('the sheet shows the plain line for a changed binary, and its key closes the sheet before it focuses the card', () => {
    const app = readFileSync(path.join(ROOT, 'src/ui/app.ts'), 'utf8');
    const sub = app.slice(app.indexOf('async function submitNewSession('), app.indexOf('/** Modal sheets that hide the stack'));
    expect(sub).toContain('binaryChangedLine(refused.refusal?.data)');
    expect(sub).toContain('press: () => reviewRepinCard(cardId)');
    const review = app.slice(app.indexOf('function reviewRepinCard('), app.indexOf('function reviewRepinCard(') + 260);
    expect(review.indexOf('repinReturn.hold(cardId, k)')).toBeLessThan(review.indexOf('closeNewSessionSheet()'));
    expect(review.indexOf('closeNewSessionSheet()')).toBeLessThan(review.indexOf("focusCard(cardId, 're-pin card')"));
  });
});

describe('the way back from the re-pin card (founder field test 2026-10-23: no starting over)', () => {
  const kernel = (req: FolderRequest) => (req.kind === 'request.folder.recent' ? { recent: RECENTS } : req.kind === 'request.folder.check' ? ok(String(req.payload.path)) : { cancelled: true });
  it('only THAT card decided allow returns the held choice; deny, expiry and another card do not', () => {
    const rr = new RepinReturn<string>();
    expect(rr.outcome('card:repin-1', 'allow')).toBeNull(); // nothing held
    rr.hold('card:repin-1', 'choice');
    expect(rr.outcome('card:other', 'allow')).toBeNull();
    expect(rr.cardId).toBe('card:repin-1');
    expect(rr.outcome('card:repin-1', 'allow')).toBe('choice');
    expect(rr.cardId).toBeNull(); // once
    expect(rr.outcome('card:repin-1', 'allow')).toBeNull();
    rr.hold('card:repin-1', 'choice');
    expect(rr.outcome('card:repin-1', 'deny')).toBeNull();
    expect(rr.cardId).toBeNull();
    rr.hold('card:repin-1', 'choice');
    expect(rr.outcome('card:repin-1', 'expire')).toBeNull();
    rr.hold('card:repin-1', 'a');
    rr.hold('card:repin-2', 'b'); // the newest card only
    expect(rr.outcome('card:repin-1', 'allow')).toBeNull();
    expect(rr.outcome('card:repin-2', 'allow')).toBe('b');
  });
  it('the store names each outcome, and the key reads back (a cardId with colons kept whole)', () => {
    const st = new GuiStore();
    const a = st.apply([{ seq: 1, kind: 'approval.decide', payload: { cardId: 'card:repin-1', decision: 'allow' } }]);
    expect(a.has('card-outcome:allow:card:repin-1')).toBe(true);
    const e = st.apply([{ seq: 2, kind: 'approval.expire', payload: { cardId: 'card:repin-2' } }]);
    expect(e.has('card-outcome:expire:card:repin-2')).toBe(true);
    expect(cardOutcomeOf('card-outcome:allow:card:repin-1')).toEqual({ decision: 'allow', cardId: 'card:repin-1' });
    expect(cardOutcomeOf('card-out:card:repin-1')).toBeNull();
    expect(cardOutcomeOf('card-outcome:allow:')).toBeNull();
  });
  it('the kept folder comes back chosen after a reset, checked again, its model restored, and Open usable', async () => {
    const r = rig('session', kernel);
    await r.f.loadRecents(null);
    await r.f.settled();
    r.f.pickRecent(`${HOME}/code/a-atelier`, 'chosen');
    await r.f.settled();
    const kept = r.f.keep() as KeptChoice;
    expect(kept.chosen.real).toBe(`${HOME}/code/a-atelier`);
    r.f.reset(); // the sheet closed and opened again
    expect(r.f.value()).toBeNull();
    const chose = r.chose.length;
    r.f.restore(kept);
    await r.f.loadRecents(null); // recents load after: the kept choice wins over the most recent
    await r.f.settled();
    expect(r.f.value()).toBe(`${HOME}/code/a-atelier`);
    expect(r.f.whyOff()).toBeNull();
    expect(r.view().rows.find((x) => x.checked)?.real).toBe(`${HOME}/code/a-atelier`);
    expect(r.chose.slice(chose)).toEqual([`${HOME}/code/a-atelier`]); // the folder's remembered model follows
    expect(r.view().error).toBeNull();
  });
  it('the sheet reopens on allow with Open focused, never opens the session itself', () => {
    const app = readFileSync(path.join(ROOT, 'src/ui/app.ts'), 'utf8');
    const on = app.slice(app.indexOf('store.onChange((what) => {\n  if (repinReturn.cardId'), app.indexOf('/** Modal sheets that hide the stack'));
    expect(on).toContain("if (kept && $('new-session-dialog').hidden) openNewSessionSheet(kept);");
    expect(on).not.toMatch(/submitNewSession|openSession\(/);
    const open = app.slice(app.indexOf('function openNewSessionSheet('), app.indexOf('function closeNewSessionSheet('));
    expect(open).toContain("$<HTMLButtonElement>('ns-open').focus()");
  });
});
