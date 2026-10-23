/**
 * @symbol #gui-folder-field
 *
 * #gui-folder-field, the model (no DOM; ui/folder-field.ts draws it). Component folder-field and rule
 * paths-are-chosen (TD-2026-10-23-162, Atelier session 2026-10-23-gnomon-folder-picker): a folder (or, in the file
 * variant, a file) on this Mac is CHOSEN, not typed. Recent folders first (New session), then the Mac's own chooser,
 * which the KERNEL opens (request.folder.choose, founder C1: the wrapper keeps zero page IPC), then a typed path
 * folded under "Type a path ▸" (open by default only when no chooser exists). Every choice is checked by the kernel
 * (request.folder.check, read-only) before the key that uses it is enabled.
 *
 * Every path the page shows is the kernel's escaped `display` string, rendered as textContent (design-system
 * folder-field `never`); the page sends the kernel's `real` path, never its own spelling of one.
 *
 * Three variants share one controller (FolderField): `recents` (New session, up to six recent folders, the centre
 * session's folder chosen else the most recent: founder C2), `compact` (Settings › Local model runner, Mods › Add
 * from folder) and `file` (Mods › Configure command). Founder C3: no drag from Finder (the Mac's chooser takes one);
 * C4: the home folder is allowed with the amber warning.
 */
import { projectHue } from '@a-company/gnomon-contracts';

export const FOLDER_CHOOSE_REQUEST = 'request.folder.choose' as const;
export const FOLDER_CHECK_REQUEST = 'request.folder.check' as const;
export const FOLDER_RECENT_REQUEST = 'request.folder.recent' as const;

export type FolderPurpose = 'session' | 'runner' | 'mod' | 'command';
export type FolderKind = 'folder' | 'file';
export type FolderWhy = 'ok' | 'not-absolute' | 'missing' | 'file' | 'not-a-file' | 'not-executable' | 'unreadable' | 'wrong-contents' | 'home' | 'outside-home' | 'timeout' | 'network' | 'device';

/** The kernel's request.folder.check answer (also inside a choose answer). */
export interface FolderCheck {
  ok: boolean;
  why: FolderWhy;
  real: string;
  display: string;
  name: string;
  home: 'inside' | 'outside' | 'home-or-above' | null;
  expectFound?: boolean;
  suggest?: { real: string; display: string };
}

/** One of request.folder.recent's folders. */
export interface FolderRecent {
  real: string;
  display: string;
  repoName: string;
  lastUsedAt: string;
}

export interface FolderRequest {
  kind: string;
  payload: Record<string, unknown>;
}

/** Design-system folder-field copy (the words are the system's; change them there first). */
export const FF_COPY = Object.freeze({
  title: 'New session',
  legend: 'folder',
  choose: 'Choose folder…',
  chooseFile: 'Choose file…',
  chooseAgain: 'Choose another…',
  choosing: 'Choosing…',
  typedClosed: 'Type a path ▸',
  typedOpen: 'Type a path ▾',
  clear: 'Clear',
  open: 'Open',
  opening: 'Opening…',
  cancel: 'cancel',
  empty: 'No recent folders yet. Choose the project folder this session works in.',
  opensIn: 'opens in ',
  outsideHome: ' · outside your home folder',
  chooserOpen: "The macOS folder chooser is open. If you don't see it, it may be behind this window.",
  fileChooserOpen: "The macOS file chooser is open. If you don't see it, it may be behind this window.",
  cancelledSr: 'No folder chosen. Nothing changed.',
  typedLabel: 'path',
  typedNote: 'a full path, or one starting with ~/ · checked as you type',
  found: '✓ folder found',
  fileFound: '✓ file found',
  checking: 'checking…',
  notAbsolute: '✕ Start the path with / or ~/',
  homeLead: '◆ This is your home folder.',
  homeRest: ' A session here can read every project in it, and auto-edits is off here. Choose a project folder inside it if you can.',
  hint: 'Suggested by `gnomon` in a terminal: check it, then Open.',
  noChooser: "This kernel can't open the macOS folder chooser here. Type a full path, or pick a recent folder.",
  fromTerminal: 'from terminal',
  justChosen: 'just chosen',
  openDisabled: Object.freeze({ none: 'choose a folder first', chooser: 'waiting for the chooser', invalid: 'fix the path first', unreadable: "Gnomon can't read this folder", refused: 'choose another folder' }),
  /** Mika 2026-10-23: Mods › Add beside a chosen folder that holds no manifest */
  modWrongContents: 'choose a folder with gnomon-manifest.json',
  none: Object.freeze({ session: 'none', runner: 'none · the bundled runner is used', mod: 'none · choose the folder that holds gnomon-manifest.json', command: 'none · it launches as it does today' }),
});

/** What the kernel's chooser is asked for, per purpose (the prompt itself is the kernel's fixed copy). */
const KIND_OF: Readonly<Record<FolderPurpose, FolderKind>> = Object.freeze({ session: 'folder', runner: 'folder', mod: 'folder', command: 'file' });
const EXPECT_OF: Readonly<Record<FolderPurpose, string | null>> = Object.freeze({ session: null, runner: 'cli.js', mod: 'gnomon-manifest.json', command: null });

export const chooseRequest = (purpose: FolderPurpose, startIn: string | null): FolderRequest => ({ kind: FOLDER_CHOOSE_REQUEST, payload: { kind: KIND_OF[purpose], purpose, ...(startIn ? { startIn } : {}) } });
export const chooseCancelRequest = (): FolderRequest => ({ kind: FOLDER_CHOOSE_REQUEST, payload: { cancel: true } });
export const checkRequest = (purpose: FolderPurpose, p: string): FolderRequest => ({ kind: FOLDER_CHECK_REQUEST, payload: { path: p, kind: KIND_OF[purpose], ...(EXPECT_OF[purpose] ? { expect: EXPECT_OF[purpose] } : {}) } });
export const recentRequest = (): FolderRequest => ({ kind: FOLDER_RECENT_REQUEST, payload: {} });

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const WHYS: ReadonlySet<string> = new Set(['ok', 'not-absolute', 'missing', 'file', 'not-a-file', 'not-executable', 'unreadable', 'wrong-contents', 'home', 'outside-home', 'timeout', 'network', 'device']);

/** A check answer in its shape, else null (an unknown answer is never trusted as ok). */
export function folderCheckOf(v: unknown): FolderCheck | null {
  if (!isObj(v) || typeof v.ok !== 'boolean' || !WHYS.has(String(v.why)) || str(v.real) === null || str(v.display) === null) return null;
  const home = v.home === 'inside' || v.home === 'outside' || v.home === 'home-or-above' ? v.home : null;
  const sg = isObj(v.suggest) && str(v.suggest.real) && str(v.suggest.display) ? { real: v.suggest.real as string, display: v.suggest.display as string } : undefined;
  return { ok: v.ok, why: v.why as FolderWhy, real: v.real as string, display: v.display as string, name: str(v.name) ?? '', home, ...(typeof v.expectFound === 'boolean' ? { expectFound: v.expectFound } : {}), ...(sg ? { suggest: sg } : {}) };
}

/** request.folder.recent's folders (malformed ones dropped), at most six. */
export function recentsOf(v: unknown): FolderRecent[] {
  const list = isObj(v) && Array.isArray(v.recent) ? v.recent : [];
  const out: FolderRecent[] = [];
  for (const r of list) {
    if (isObj(r) && str(r.real) && str(r.display) && str(r.repoName) !== null && str(r.lastUsedAt)) out.push({ real: r.real as string, display: r.display as string, repoName: r.repoName as string, lastUsedAt: r.lastUsedAt as string });
    if (out.length >= 6) break;
  }
  return out;
}

/** status.folders: null when this kernel does not serve the folder requests (it predates them). */
export function foldersStatusOf(status: unknown): { chooser: boolean } | null {
  const f = isObj(status) && isObj(status.folders) ? status.folders : null;
  return f ? { chooser: f.chooser === true } : null;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad = (n: number): string => String(n).padStart(2, '0');
/** A recent row's when: "today 14:06", "yesterday", "Oct 19" (local time). */
export function whenText(iso: string, now: Date): string {
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return '';
  const day = (d: Date): number => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const diff = Math.round((day(now) - day(t)) / 86_400_000);
  if (diff <= 0) return `today ${pad(t.getHours())}:${pad(t.getMinutes())}`;
  if (diff === 1) return 'yesterday';
  return `${MONTHS[t.getMonth()]} ${t.getDate()}`;
}

export interface CheckLine {
  tone: 'ok' | 'err' | 'warn';
  text: string;
  /** warn: the bold lead of the line */
  lead?: string;
  /** wrong-contents (runner): the folder to use instead */
  suggest?: { real: string; display: string };
}

/** The one check line under a field for a check answer (null: nothing to say; the opens-in line carries it). */
export function checkLine(c: FolderCheck, purpose: FolderPurpose, typed: boolean): CheckLine | null {
  const file = KIND_OF[purpose] === 'file';
  const choose = file ? FF_COPY.chooseFile : FF_COPY.choose;
  switch (c.why) {
    case 'not-absolute':
      return { tone: 'err', text: FF_COPY.notAbsolute };
    case 'missing':
      return { tone: 'err', text: `✕ Nothing at ${c.display}. Check the spelling, or use ${choose}.` };
    case 'file':
      return { tone: 'err', text: `✕ ${c.display} is a file. Choose the folder that holds it.` };
    case 'not-a-file':
      return { tone: 'err', text: `✕ ${c.display} is a folder. Choose the program itself.` };
    case 'not-executable':
      return { tone: 'err', text: `✕ ${c.display} can't be run (it isn't executable). Choose the program itself.` };
    case 'unreadable':
      // Aegis L1: grant THIS folder, and say what the grant means (a session here runs with that access)
      return { tone: 'err', text: `✕ Gnomon can't read ${c.display}: macOS hasn't allowed it. next: System Settings › Privacy & Security › Files and Folders, allow Gnomon this folder, then choose it again. Sessions opened here run with that access.` };
    case 'timeout':
      return { tone: 'err', text: `✕ ${c.display} didn't answer in time: its disk may be asleep or unplugged. next: reconnect it and choose the folder again, or choose another folder.` };
    case 'network':
      return { tone: 'err', text: `✕ ${c.display} is on a network share. Choose a folder on this Mac.` };
    case 'device':
      return { tone: 'err', text: `✕ ${c.display} is a device path, not a folder. Choose a folder on this Mac.` };
    case 'wrong-contents':
      if (purpose === 'runner') return c.suggest ? { tone: 'err', text: `✕ ${c.display} has no cli.js. Its dist folder does.`, suggest: c.suggest } : { tone: 'err', text: `✕ ${c.display} has no cli.js. Choose the folder that holds it.` };
      return { tone: 'err', text: `✕ ${c.display} has no gnomon-manifest.json. Choose the folder that holds it.` };
    case 'home':
      return { tone: 'warn', lead: FF_COPY.homeLead, text: FF_COPY.homeRest };
    default:
      return typed ? { tone: 'ok', text: file ? FF_COPY.fileFound : FF_COPY.found } : null;
  }
}

/** Where a choice came from (its row's when, and whether the typed field keeps it). */
export type ChoiceSource = 'recent' | 'chooser' | 'typed' | 'hint' | 'value';

export interface FolderChoice {
  real: string;
  display: string;
  name: string;
  source: ChoiceSource;
  /** the recent row's when, or "just chosen" / "from terminal" */
  when: string;
}

export interface FolderFieldState {
  purpose: FolderPurpose;
  /** the kernel serves request.folder.* (status.folders present) */
  offered: boolean;
  /** the kernel opens the Mac's chooser here (status.folders.chooser) */
  chooser: boolean;
  recents: FolderRecent[];
  /** chosen folders that are not recents (chooser, typed, hint), newest first; shown above the recents */
  extra: FolderChoice[];
  chosen: FolderChoice | null;
  check: FolderCheck | null;
  /** a check is in flight; `showChecking` once it has run past 150 ms */
  checking: boolean;
  showChecking: boolean;
  choosing: boolean;
  typedOpen: boolean;
  typed: string;
  /** a visually hidden status (the chooser was cancelled) */
  sr: string | null;
  /** the terminal's hint note (#bare-entry), shown above the field */
  hint: string | null;
  /** a session.open refusal, in place (the choice is kept) */
  refused: string | null;
  /** a failed request (refusal words), shown as the error line */
  error: string | null;
  opening: boolean;
  /** where focus should go after the next paint (consumed by the DOM layer) */
  focus: 'chosen' | 'choose' | 'typed' | null;
}

export interface FolderFieldOptions {
  purpose: FolderPurpose;
  /** log.append of one folder request; throws (an RpcError carries `refusal`) when refused */
  call: (req: FolderRequest) => Promise<unknown>;
  /** state changed: repaint */
  changed: () => void;
  /** a folder was chosen (any source): the New session sheet restores that folder's claude model */
  chose?: (real: string) => void;
  now?: () => Date;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (t: unknown) => void;
}

const refusalWords = (err: unknown): { text: string; why: string | null; retryAfterMs: number | null } => {
  const r = isObj(err) && isObj((err as { refusal?: unknown }).refusal) ? ((err as { refusal: Record<string, unknown> }).refusal) : null;
  const data = r && isObj(r.data) ? r.data : null;
  const msg = r ? `${String(r.code ?? '')}${r.reason ? ` ${String(r.reason)}` : ''}: ${String(r.message ?? '')}` : `nothing was sent (${err instanceof Error ? err.message.slice(0, 120) : 'failed'})`;
  return { text: msg, why: data && typeof data.why === 'string' ? data.why : null, retryAfterMs: data && typeof data.retryAfterMs === 'number' ? data.retryAfterMs : null };
};

/** The recents variant shows at most this many rows (design-system folder-field variants.recents). */
const MAX_ROWS = 6;

const parentOf = (p: string): string | null => {
  const i = p.replace(/\/+$/, '').lastIndexOf('/');
  return i > 0 ? p.slice(0, i) : i === 0 ? '/' : null;
};

/** The controller of one folder field (see the header). Kernel calls go through `call`; nothing here touches the DOM. */
export class FolderField {
  readonly #o: FolderFieldOptions;
  #s: FolderFieldState;
  #gen = 0;
  #chooseGen = 0;
  #typedTimer: unknown = null;
  #checkTimer: unknown = null;
  #pending: Promise<void> | null = null;
  /** the human toggled Type a path: a later status read no longer opens or folds it */
  #typedTouched = false;

  constructor(o: FolderFieldOptions) {
    this.#o = o;
    this.#s = FolderField.blank(o.purpose);
  }

  static blank(purpose: FolderPurpose): FolderFieldState {
    return { purpose, offered: false, chooser: false, recents: [], extra: [], chosen: null, check: null, checking: false, showChecking: false, choosing: false, typedOpen: false, typed: '', sr: null, hint: null, refused: null, error: null, opening: false, focus: null };
  }

  state(): Readonly<FolderFieldState> {
    return this.#s;
  }

  #set(p: Partial<FolderFieldState>): void {
    this.#s = { ...this.#s, ...p };
    this.#o.changed();
  }

  #timer(fn: () => void, ms: number): unknown {
    return (this.#o.setTimer ?? ((f: () => void, m: number) => setTimeout(f, m)))(fn, ms);
  }
  #clear(t: unknown): void {
    if (t !== null) (this.#o.clearTimer ?? ((x: unknown) => clearTimeout(x as ReturnType<typeof setTimeout>)))(t);
  }

  /** Read status.folders: whether the kernel serves the requests and opens the chooser. No chooser: typed open. */
  setStatus(status: unknown): void {
    const f = foldersStatusOf(status);
    const chooser = !!f?.chooser;
    this.#set({ offered: f !== null, chooser, typedOpen: this.#typedTouched ? this.#s.typedOpen || !chooser : !chooser });
  }

  /** Start over (the sheet opened, or a form was opened): keeps the status, drops the choice. */
  reset(): void {
    this.#gen++;
    this.#chooseGen++;
    this.#clear(this.#typedTimer);
    this.#clear(this.#checkTimer);
    this.#typedTimer = this.#checkTimer = null;
    const { offered, chooser } = this.#s;
    this.#typedTouched = false;
    this.#s = { ...FolderField.blank(this.#o.purpose), offered, chooser, typedOpen: !chooser };
    this.#o.changed();
  }

  /** New session: load the recents and choose the centre session's folder, else the most recent (founder C2). */
  async loadRecents(centre: string | null): Promise<void> {
    // a kernel that predates the folder requests: the typed field is open (no chooser), so focus starts in it
    if (!this.#s.offered) return this.#set({ focus: 'typed' });
    const gen = this.#gen;
    let recents: FolderRecent[] = [];
    try {
      recents = recentsOf(await this.#o.call(recentRequest()));
    } catch {
      recents = []; // the empty state: Choose folder… still works
    }
    if (gen !== this.#gen) return;
    this.#set({ recents });
    if (this.#s.chosen) return; // a hint (or a pick) came first: it wins
    const pick = (centre && recents.find((r) => r.real === centre)) || recents[0];
    if (pick) this.pickRecent(pick.real, 'chosen');
    else this.#set({ focus: 'choose' });
  }

  /** The rows of the list, in order: the extra choices (newest first), then the recents. */
  rows(): FolderChoice[] {
    const now = (this.#o.now ?? (() => new Date()))();
    const seen = new Set(this.#s.extra.map((e) => e.real));
    const all = [...this.#s.extra, ...this.#s.recents.filter((r) => !seen.has(r.real)).map((r): FolderChoice => ({ real: r.real, display: r.display, name: r.repoName, source: 'recent', when: whenText(r.lastUsedAt, now) }))];
    // design: up to six rows; a just-chosen folder pushes the oldest recent out (the sheet must fit a 720px window)
    if (all.length <= MAX_ROWS) return all;
    const chosen = this.#s.chosen?.real;
    const keep = all.slice(0, MAX_ROWS);
    const c = chosen ? all.findIndex((r) => r.real === chosen) : -1;
    if (c >= MAX_ROWS) keep[MAX_ROWS - 1] = all[c]!;
    return keep;
  }

  /** Choose a row (a click, an arrow key, or the sheet opening). */
  pickRecent(real: string, focus: FolderFieldState['focus'] = null): void {
    const row = this.rows().find((r) => r.real === real);
    if (!row) return;
    this.#cancelChooser();
    this.#clear(this.#typedTimer);
    this.#set({ chosen: row, typed: '', refused: null, error: null, sr: null, focus });
    void this.#check(row.real, false);
    this.#o.chose?.(row.real);
  }

  /** Compact: show a value the page already holds (the runner the form carries), checked by the kernel. */
  setValue(p: string | null): void {
    this.#gen++;
    if (!p) return this.#set({ chosen: null, check: null, checking: false, showChecking: false, error: null });
    this.#set({ chosen: { real: p, display: '', name: '', source: 'value', when: '' }, check: null, error: null });
    void this.#check(p, false);
  }

  /** The suggestion key ("Use …/dist"): choose it, checked like any choice. */
  useSuggestion(): void {
    const s = this.#s.check?.suggest;
    if (!s) return;
    this.#set({ chosen: { real: s.real, display: s.display, name: '', source: 'chooser', when: FF_COPY.justChosen }, typed: '', focus: 'chosen' });
    void this.#check(s.real, false);
    this.#o.chose?.(s.real);
  }

  clear(): void {
    this.#gen++;
    this.#set({ chosen: null, check: null, checking: false, showChecking: false, typed: '', error: null, refused: null, focus: 'choose' });
  }

  /** The terminal's folder hint (#bare-entry): a prefill is checked and chosen "from terminal"; else only the note. */
  setHint(note: string, prefill: string | null): void {
    this.#set({ hint: note });
    if (prefill === null) return;
    this.#set({ chosen: { real: prefill, display: '', name: '', source: 'hint', when: FF_COPY.fromTerminal }, focus: 'chosen' });
    void this.#check(prefill, false, true);
  }

  toggleTyped(): void {
    this.#typedTouched = true;
    this.#set({ typedOpen: !this.#s.typedOpen, focus: this.#s.typedOpen ? null : 'typed' });
  }

  /** A key in the typed field: checked 300 ms after the last key (design behaviour). */
  typedInput(v: string): void {
    this.#clear(this.#typedTimer);
    this.#gen++;
    this.#set({ typed: v, chosen: null, check: null, checking: false, showChecking: false, error: null, refused: null });
    const t = v.trim();
    if (!t) return;
    this.#typedTimer = this.#timer(() => {
      this.#typedTimer = null;
      void this.#check(t, true);
    }, 300);
  }

  /** Choose folder… / Choose another… / Choose file… (the human's trusted press only: the caller checks). */
  async choose(): Promise<void> {
    if (this.#s.choosing || !this.#s.chooser) return;
    const cg = ++this.#chooseGen;
    const startIn = parentOf(this.#s.chosen?.real || this.#s.recents[0]?.real || '') ?? null;
    this.#set({ choosing: true, sr: null, error: null, refused: null });
    let ans: unknown;
    try {
      ans = await this.#o.call(chooseRequest(this.#o.purpose, startIn));
    } catch (err) {
      if (cg !== this.#chooseGen) return;
      const w = refusalWords(err);
      if (w.why === 'no-chooser') return this.#set({ choosing: false, chooser: false, typedOpen: true, focus: 'typed' });
      return this.#set({ choosing: false, error: w.text, focus: 'choose' });
    }
    if (cg !== this.#chooseGen) return; // a recent was picked, or the sheet closed, while it was open
    if (!isObj(ans) || ans.cancelled === true) return this.#set({ choosing: false, sr: FF_COPY.cancelledSr, focus: 'choose' });
    const check = folderCheckOf(ans.check);
    if (!check) return this.#set({ choosing: false, error: 'the kernel answered no folder', focus: 'choose' });
    this.#gen++;
    const choice: FolderChoice = { real: check.real, display: check.display, name: check.name, source: 'chooser', when: FF_COPY.justChosen };
    const isRecent = this.#s.recents.some((r) => r.real === check.real);
    const extra = this.#o.purpose === 'session' && !isRecent ? [choice, ...this.#s.extra.filter((e) => e.real !== check.real)] : this.#s.extra;
    this.#set({ choosing: false, extra, chosen: isRecent ? (this.rows().find((r) => r.real === check.real) ?? choice) : choice, check, checking: false, showChecking: false, typed: '', focus: 'chosen' });
    this.#o.chose?.(check.real);
  }

  /** Close an open chooser (Esc, cancel, a recent picked): the kernel kills it; its answer is ignored. */
  #cancelChooser(): void {
    if (!this.#s.choosing) return;
    this.#chooseGen++;
    this.#s = { ...this.#s, choosing: false };
    void this.#o.call(chooseCancelRequest()).catch(() => undefined);
  }

  /** The sheet (or form) closes: an open chooser closes with it, timers stop. */
  closed(): void {
    this.#cancelChooser();
    this.#gen++;
    this.#clear(this.#typedTimer);
    this.#clear(this.#checkTimer);
    this.#typedTimer = this.#checkTimer = null;
  }

  async #check(p: string, typed: boolean, hint = false): Promise<void> {
    const gen = ++this.#gen;
    if (!this.#s.offered) {
      // a kernel that predates the folder requests: a typed absolute path goes as typed (the kernel refuses a bad one)
      const abs = p.startsWith('/');
      const c: FolderCheck = { ok: abs, why: abs ? 'ok' : 'not-absolute', real: abs ? p : '', display: '', name: '', home: null };
      return this.#set({ check: c, checking: false, showChecking: false, ...(typed && abs ? { chosen: { real: p, display: '', name: '', source: 'typed', when: '' } } : {}) });
    }
    this.#clear(this.#checkTimer);
    this.#checkTimer = this.#timer(() => {
      this.#checkTimer = null;
      if (gen === this.#gen && this.#s.checking) this.#set({ showChecking: true });
    }, 150);
    this.#set({ checking: true, showChecking: false });
    const run = async (): Promise<void> => {
      let ans: unknown;
      try {
        ans = await this.#o.call(checkRequest(this.#o.purpose, p));
      } catch (err) {
        const w = refusalWords(err);
        if (w.why === 'rate-limited' && gen === this.#gen) {
          await new Promise((res) => this.#timer(() => res(undefined), Math.min(10_000, Math.max(0, w.retryAfterMs ?? 2000)) + 50));
          if (gen !== this.#gen) return;
          try {
            ans = await this.#o.call(checkRequest(this.#o.purpose, p));
          } catch (err2) {
            if (gen === this.#gen) this.#set({ checking: false, showChecking: false, error: refusalWords(err2).text });
            return;
          }
        } else {
          if (gen === this.#gen) this.#set({ checking: false, showChecking: false, error: w.text });
          return;
        }
      }
      if (gen !== this.#gen) return; // a later choice or key replaced this one
      const c = folderCheckOf(ans);
      if (!c) return this.#set({ checking: false, showChecking: false, error: 'the kernel’s check gave no answer' });
      const cur = this.#s.chosen;
      // the kernel's escaped display and real path replace whatever the page held
      const chosen: FolderChoice | null = typed
        ? c.ok
          ? { real: c.real, display: c.display, name: c.name, source: 'typed', when: '' }
          : null
        : cur
          ? { ...cur, real: c.real || cur.real, display: c.display, name: cur.name || c.name }
          : null;
      const extra = hint && chosen && this.#o.purpose === 'session' && !this.#s.recents.some((r) => r.real === chosen.real) ? [chosen, ...this.#s.extra.filter((e) => e.real !== chosen.real)] : this.#s.extra;
      this.#set({ check: c, checking: false, showChecking: false, chosen, extra });
      if (typed && chosen) this.#o.chose?.(chosen.real);
    };
    const pending = run();
    this.#pending = pending;
    await pending;
    if (this.#pending === pending) this.#pending = null;
  }

  /** Wait for the check in flight (a submit right after ⌘N waits for the preselection's check). */
  async settled(): Promise<void> {
    while (this.#pending || this.#typedTimer !== null) {
      if (this.#typedTimer !== null) {
        this.#clear(this.#typedTimer);
        this.#typedTimer = null;
        const t = this.#s.typed.trim();
        if (t) await this.#check(t, true);
        continue;
      }
      await this.#pending;
    }
  }

  /** The path the key that uses the field sends (the kernel's real path), or null while it is not usable. */
  value(): string | null {
    const s = this.#s;
    if (!s.chosen || s.choosing || s.refused) return null;
    if (s.check) return s.check.ok ? s.check.real || s.chosen.real : null;
    // a recent row (the kernel listed it as an existing folder) is usable while its check runs
    return s.chosen.source === 'recent' ? s.chosen.real : null;
  }

  /** Why the key that uses it is disabled, in words (design copy open-disabled), or null when it is enabled. */
  whyOff(): string | null {
    const s = this.#s;
    const d = FF_COPY.openDisabled;
    if (s.choosing) return d.chooser;
    if (s.refused) return d.refused;
    if (s.check && !s.check.ok) return s.check.why === 'unreadable' ? d.unreadable : s.check.why === 'wrong-contents' && s.purpose === 'mod' ? FF_COPY.modWrongContents : d.invalid;
    if (s.typed.trim() && !s.chosen) return s.checking || this.#typedTimer !== null ? FF_COPY.checking : d.invalid;
    if (!s.chosen) return d.none;
    if (this.value() === null) return s.checking ? FF_COPY.checking : d.invalid;
    return null;
  }

  /** session.open answered with a refusal: shown in place, the choice kept (never a closed sheet). */
  setRefused(text: string | null): void {
    // a new attempt (null) also clears the last attempt's non-folder error (setOpenFailed)
    this.#set({ refused: text, opening: false, ...(text === null ? { error: null } : {}) });
  }

  /**
   * session.open was refused for a reason that is NOT the folder (the kernel, the binary, a limit): the words show in
   * place as the error line, the folder stays chosen and unmarked, and Open stays enabled for a retry.
   */
  setOpenFailed(text: string): void {
    this.#set({ error: text, refused: null, opening: false, focus: null });
  }

  setOpening(on: boolean): void {
    this.#set({ opening: on });
  }

  /** Consume the focus intent (the DOM layer, after a paint). */
  takeFocus(): FolderFieldState['focus'] {
    const f = this.#s.focus;
    this.#s = { ...this.#s, focus: null };
    return f;
  }
}

/* ── views (what ui/folder-field.ts draws) ───────────────────────────────────────────────────────────────────── */

export interface RowView {
  real: string;
  display: string;
  name: string;
  when: string;
  checked: boolean;
  /** chosen but failed its check (✕) */
  failed: boolean;
  hue: number;
  label: string;
}

export interface FolderFieldView {
  variant: 'recents' | 'compact';
  purpose: FolderPurpose;
  rows: RowView[];
  empty: boolean;
  /** compact: the value shown, or the none text */
  value: { display: string } | null;
  none: string;
  opens: { display: string; outside: boolean } | null;
  chooseLabel: string | null;
  choosing: boolean;
  clear: boolean;
  typedOpen: boolean;
  typedLabel: string;
  typed: string;
  line: CheckLine | null;
  checking: boolean;
  status: string | null;
  sr: string | null;
  hint: string | null;
  noChooser: string | null;
  error: string | null;
}

/** The field as drawn (recents for New session, compact for the others). */
export function fieldView(f: FolderField, variant: 'recents' | 'compact'): FolderFieldView {
  const s = f.state();
  const file = KIND_OF[s.purpose] === 'file';
  const typedSrc = s.typed.trim() !== '' || s.chosen?.source === 'typed';
  const rows = variant === 'recents'
    ? f.rows().map((r): RowView => {
        const checked = s.chosen?.real === r.real;
        const failed = checked && (!!s.refused || (!!s.check && !s.check.ok));
        const display = checked && s.chosen?.display ? s.chosen.display : r.display;
        return { real: r.real, display, name: r.name || display, when: r.when, checked, failed, hue: projectHue(r.real), label: `${r.name || display}, ${display}${r.when ? `, ${r.source === 'recent' ? `last used ${r.when}` : r.when}` : ''}` };
      })
    : [];
  const ok = !!s.chosen && !!s.check?.ok && !s.refused;
  const shownDisplay = s.check?.display || s.chosen?.display || '';
  const line = s.check && (s.chosen || typedSrc || !s.check.ok) ? checkLine(s.check, s.purpose, typedSrc && s.check.ok) : null;
  const chooseLabel = !s.chooser ? null : s.choosing ? FF_COPY.choosing : file ? FF_COPY.chooseFile : variant === 'compact' && s.chosen ? FF_COPY.chooseAgain : FF_COPY.choose;
  return {
    variant,
    purpose: s.purpose,
    rows,
    empty: variant === 'recents' && rows.length === 0,
    value: variant === 'compact' && s.chosen && shownDisplay && !typedSrc ? { display: shownDisplay } : null,
    none: FF_COPY.none[s.purpose],
    opens: variant === 'recents' && ok && shownDisplay ? { display: shownDisplay, outside: s.check?.home === 'outside' } : null,
    chooseLabel,
    choosing: s.choosing,
    clear: variant === 'compact' && !!s.chosen,
    typedOpen: s.typedOpen,
    typedLabel: s.typedOpen ? FF_COPY.typedOpen : FF_COPY.typedClosed,
    typed: s.typed,
    line: s.refused ? { tone: 'err', text: s.refused } : line,
    checking: s.showChecking,
    status: s.choosing ? (file ? FF_COPY.fileChooserOpen : FF_COPY.chooserOpen) : null,
    sr: s.sr,
    hint: s.hint,
    noChooser: s.offered && !s.chooser ? FF_COPY.noChooser : null,
    error: s.error,
  };
}
