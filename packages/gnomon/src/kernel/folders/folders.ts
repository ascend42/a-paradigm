/**
 * @symbol #folder-picker
 *
 * #folder-picker (TD-2026-10-23-162, Atelier session 2026-10-23-gnomon-folder-picker, rule paths-are-chosen): the
 * kernel half of the GUI's folder field. Three human requests, each dispatcher-only (log.append{kind, payload} like
 * request.local.probe): never a row, not in the §9.1 registry, so no contract id moves.
 *
 *   - request.folder.choose{kind:'folder'|'file', purpose?, startIn?}: the KERNEL opens the macOS chooser (founder
 *     C1: the wrapper keeps zero page IPC) with `osascript`, brought to the front. One at a time (a second call while
 *     one is open is refused `busy`); it answers {path, display, check} or {cancelled:true} (Esc, Cancel, or the
 *     chooser left open past CHOOSER_TIMEOUT_MS); {cancel:true} closes an open one. Aegis: the prompt is a FIXED string chosen by purpose and kind,
 *     never caller text, and `startIn` reaches AppleScript only as an argv item (`on run argv`), never inside the
 *     script, so nothing the page sends is ever AppleScript source. Not offered on Windows or Linux (no-chooser).
 *   - request.folder.check{path, kind?, expect?}: READ-ONLY. Expands a leading ~, realpaths, and classifies: ok,
 *     not-absolute, missing, file (a folder was wanted), not-a-file, not-executable, unreadable, wrong-contents,
 *     plus the home warnings `home` (the home folder or above it: allowed with the amber warning, founder C4) and
 *     `outside-home`. Nothing beyond stat and access is read (an `expect` name is stat'ed, never opened).
 *     Rate-limited (CHECK_BURST per CHECK_WINDOW_MS) since a typed path is checked as you type.
 *   - request.folder.recent{}: up to FOLDER_RECENT_MAX folders from the kernel's own session.open rows (human
 *     sessions), deduplicated by realpath, most recent first, missing folders dropped.
 *
 * Every answer's `display` is the ONE escape rule (display-path.ts) after ~-shortening: the GUI renders it as
 * textContent and never a path of its own (design-system folder-field `never`).
 * status.folders{chooser} says whether request.folder.choose is offered (it drives the GUI's no-chooser state).
 */
import { execFile } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { RpcRefusal } from '../socket/rpc.js';
import { displayPath } from './display-path.js';

export const FOLDER_CHOOSE_REQUEST = 'request.folder.choose' as const;
export const FOLDER_CHECK_REQUEST = 'request.folder.check' as const;
export const FOLDER_RECENT_REQUEST = 'request.folder.recent' as const;
/** The three dispatcher-only kinds (never rows; HUMAN_REQUEST_KINDS holds none of them). */
export const FOLDER_REQUESTS: readonly string[] = Object.freeze([FOLDER_CHOOSE_REQUEST, FOLDER_CHECK_REQUEST, FOLDER_RECENT_REQUEST]);

export const FOLDER_RECENT_MAX = 6;
/** How many session.open folders the fold keeps (newest); recent answers at most FOLDER_RECENT_MAX of them. */
export const FOLDER_FOLD_CAP = 64;
/** A chooser left open this long is closed and answers {cancelled:true, why:'timeout'}. */
export const CHOOSER_TIMEOUT_MS = 5 * 60_000;
export const CHECK_BURST = 20;
export const CHECK_WINDOW_MS = 10_000;
/** The longest path a check or a startIn takes (macOS PATH_MAX). */
export const FOLDER_PATH_MAX = 1024;
/** Aegis M1: every fs answer of one check (or one recent) lands within this, else why 'timeout'. */
export const FS_DEADLINE_MS = 2000;
/** Aegis M2: the chooser opens at most once per CHOOSER_GAP_MS and CHOOSER_PER_MINUTE times a minute. */
export const CHOOSER_GAP_MS = 1500;
export const CHOOSER_PER_MINUTE = 6;
/** recent() looks at most this many of the newest folders (Aegis M1: bounded fs work). */
export const FOLDER_RECENT_SCAN = 12;

export type ChooseKind = 'folder' | 'file';
export type ChoosePurpose = 'session' | 'runner' | 'mod' | 'command';
/** The names an `expect` may ask for (stat'ed inside the folder, never opened). */
export const FOLDER_EXPECTS: readonly string[] = Object.freeze(['cli.js', 'gnomon-manifest.json']);

/** The chooser's prompt: fixed copy (design-system folder-field copy.chooser-prompt), never caller text. */
// Aegis L3: null-prototype tables read through Object.hasOwn ('__proto__', 'toString' are never a purpose)
export const CHOOSER_PROMPTS: Readonly<Record<ChoosePurpose, string>> = Object.freeze(Object.assign(Object.create(null) as Record<ChoosePurpose, string>, {
  session: 'Choose the folder this session works in.',
  runner: 'Choose the folder that holds cli.js.',
  mod: 'Choose the folder that holds gnomon-manifest.json.',
  command: 'Choose the program this mod runs.',
}));
const PURPOSE_KIND: Readonly<Record<ChoosePurpose, ChooseKind>> = Object.freeze(Object.assign(Object.create(null) as Record<ChoosePurpose, ChooseKind>, { session: 'folder', runner: 'folder', mod: 'folder', command: 'file' }));
const isPurpose = (v: unknown): v is ChoosePurpose => typeof v === 'string' && Object.hasOwn(CHOOSER_PROMPTS, v);
// Aegis: the prompts are literal AppleScript string bodies; a quote or a backslash in one would be source
for (const p of Object.values(CHOOSER_PROMPTS)) if (!/^[A-Za-z0-9 .,'-]+$/.test(p)) throw new Error(`#folder-picker: unsafe chooser prompt ${p}`);

export type FolderWhy = 'ok' | 'not-absolute' | 'missing' | 'file' | 'not-a-file' | 'not-executable' | 'unreadable' | 'wrong-contents' | 'home' | 'outside-home' | 'timeout' | 'network' | 'device';
export type HomePlace = 'inside' | 'outside' | 'home-or-above';

export interface FolderCheck {
  /** usable: the key that uses it may be enabled (`home` and `outside-home` are warnings, still ok) */
  ok: boolean;
  why: FolderWhy;
  /** the realpath ('' when the path never resolved) */
  real: string;
  /** ~-shortened and escaped, for textContent only */
  display: string;
  /** the last path element, escaped */
  name: string;
  home: HomePlace | null;
  /** the `expect` name was found inside the folder */
  expectFound?: boolean;
  /** wrong-contents: a child folder that holds the expected name (the runner's "Use …/dist") */
  suggest?: { real: string; display: string };
}

export interface FolderRecent {
  real: string;
  display: string;
  /** the folder's last path element, escaped (the row's name) */
  repoName: string;
  /** ISO instant of the newest session.open in it */
  lastUsedAt: string;
}

export interface FolderAsker {
  /** the connection asking (the chooser's opener: only it may cancel, and its close aborts the chooser) */
  connId: string;
  principal: string | undefined;
  principalClass: string;
  credential: string | undefined;
}

/** What one osascript run came to. */
export interface ChooserRun {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}
export type ChooserRunner = (args: readonly string[], timeoutMs: number, signal: AbortSignal) => Promise<ChooserRun>;

export interface FolderOptions {
  kernelPrincipal: string;
  /** the user's home (default os.homedir()) */
  userHome?: string;
  platform?: NodeJS.Platform;
  /** test seam: runs osascript with these args (default /usr/bin/osascript through execFile) */
  runChooser?: ChooserRunner;
  clock?: () => number;
  chooserTimeoutMs?: number;
}

/** A session.open row as the fold reads it (the kernel's own rows only). */
export interface FolderRow {
  kind: string;
  principal?: string;
  at?: string;
  payload?: unknown;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const bad = (field: string, msg: string, data: Record<string, unknown> = {}): RpcRefusal => new RpcRefusal('BAD_REQUEST', 'bad-params', `#folder-picker: ${msg}`, { field, ...data });

/** The AppleScript lines (`osascript -e …` each) of one chooser: prompt fixed, startIn only ever as argv item 1. */
export function chooserScript(kind: ChooseKind, purpose: ChoosePurpose, withStart: boolean): string[] {
  const what = kind === 'file' ? 'file' : 'folder';
  return ['on run argv', 'activate', `set p to choose ${what} with prompt "${CHOOSER_PROMPTS[purpose]}"${withStart ? ' default location (POSIX file (item 1 of argv))' : ''}`, 'return POSIX path of p', 'end run'];
}

/** osascript's argv for one chooser: -e per line, then `--`-free trailing argv (osascript passes it to `on run`). */
export function chooserArgs(kind: ChooseKind, purpose: ChoosePurpose, startIn: string | null): string[] {
  return [...chooserScript(kind, purpose, startIn !== null).flatMap((l) => ['-e', l]), ...(startIn !== null ? [startIn] : [])];
}

const defaultRunner: ChooserRunner = (args, timeoutMs, signal) =>
  new Promise((resolve) => {
    execFile('/usr/bin/osascript', [...args], { timeout: timeoutMs, killSignal: 'SIGKILL', windowsHide: true, maxBuffer: 64 * 1024, signal }, (err, stdout, stderr) => {
      const e = err as (NodeJS.ErrnoException & { killed?: boolean; code?: number | string }) | null;
      // a kill by the abort signal (cancel) answers as a cancel; a kill by the timeout as a timeout
      resolve({ code: e ? (typeof e.code === 'number' ? e.code : -1) : 0, stdout: String(stdout ?? ''), stderr: signal.aborted ? '(-128)' : String(stderr ?? ''), timedOut: !signal.aborted && !!e?.killed });
    });
  });

/**
 * A platform's folder rules (G-WIN-05: a registry, not inline branches): the path module, the case rule (the warning
 * must match run-mode.ts isHomeOrAbove: folded on darwin and win32), the home separator and ~-prefix, the
 * before-any-fs refusal (Aegis M1/M3), and whether the native chooser is offered (macOS only in 8.0).
 */
interface FolderPlatform {
  P: typeof path.posix;
  fold: (s: string) => string;
  homeSep: string;
  tilde: RegExp;
  refusal: (p: string) => 'network' | 'device' | null;
  chooser: boolean;
}
const lower = (x: string): string => x.toLowerCase();
const posixRefusal = (p: string): 'network' | null => (/^\/+(net|network)(\/|$)/i.test(p) ? 'network' : null);
const POSIX_FOLDERS: FolderPlatform = { P: path.posix, fold: (x) => x, homeSep: '/', tilde: /^~\//, refusal: posixRefusal, chooser: false };
const FOLDER_PLATFORMS: Partial<Record<NodeJS.Platform, FolderPlatform>> = {
  darwin: { ...POSIX_FOLDERS, fold: lower, chooser: true },
  win32: {
    P: path.win32,
    fold: lower,
    homeSep: '\\',
    tilde: /^~[\\/]/,
    // device paths (\\?\, \\.\) first, then UNC (\\server, //server)
    refusal: (p) => (/^[\\/][\\/][?.][\\/]/.test(p) ? 'device' : /^[\\/][\\/]/.test(p) ? 'network' : null),
    chooser: false,
  },
};
Object.freeze(POSIX_FOLDERS);
Object.freeze(FOLDER_PLATFORMS);
const folderPlatform = (platform: NodeJS.Platform): FolderPlatform => (Object.hasOwn(FOLDER_PLATFORMS, platform) ? FOLDER_PLATFORMS[platform]! : POSIX_FOLDERS);
function pathsOf(platform: NodeJS.Platform): { P: typeof path.posix; fold: (s: string) => string } {
  const { P, fold } = folderPlatform(platform);
  return { P, fold };
}
const inside = (P: typeof path.posix, parent: string, child: string): boolean => {
  const rel = P.relative(parent, child);
  return rel !== '' && !rel.startsWith('..') && !P.isAbsolute(rel);
};

/** ~-shorten (the home itself is "~"), then the ONE escape rule. Aegis L5: path.relative, case-folded like run-mode. */
export function displayOf(real: string, home: string, platform: NodeJS.Platform = process.platform): string {
  const { P, fold } = pathsOf(platform);
  if (home && fold(P.resolve(real)) === fold(P.resolve(home))) return '~';
  if (home && inside(P, fold(P.resolve(home)), fold(P.resolve(real)))) return displayPath(`~${folderPlatform(platform).homeSep}${P.relative(P.resolve(home), P.resolve(real))}`);
  return displayPath(real);
}

/** Where a realpath sits against the home: inside it, outside it, or the home itself, one of its ancestors or a root. */
export function homePlace(real: string, home: string, platform: NodeJS.Platform = process.platform): HomePlace {
  const { P, fold } = pathsOf(platform);
  const r = fold(P.resolve(real));
  const h = fold(P.resolve(home));
  if (r === fold(P.parse(r).root) || r === h || inside(P, r, h)) return 'home-or-above';
  return inside(P, h, r) ? 'inside' : 'outside';
}

/**
 * Aegis M1/M3: a path that may block or reach the network is refused BEFORE any fs call: the macOS automounts
 * (/net, /Network) and, on win32, UNC (\\server, //server) and device paths (\\?\, \\.\).
 */
export function pathRefusal(p: string, platform: NodeJS.Platform): 'network' | 'device' | null {
  return folderPlatform(platform).refusal(p);
}

const TIMED_OUT = Symbol('timeout');
/** One fs promise under a deadline (the kernel loop never waits on a hung mount: Aegis M1). */
async function within<T>(p: Promise<T>, deadline: number): Promise<T | typeof TIMED_OUT> {
  let t: NodeJS.Timeout | undefined;
  const left = Math.max(0, deadline - Date.now());
  try {
    return await Promise.race([p, new Promise<typeof TIMED_OUT>((res) => (t = setTimeout(() => res(TIMED_OUT), left)))]);
  } finally {
    if (t) clearTimeout(t);
    p.catch(() => undefined);
  }
}

/**
 * The read-only check (request.folder.check's core): stat, access and realpath only, through fs.promises under one
 * deadline (FS_DEADLINE_MS: an answer of why 'timeout' past it). `kind:'file'` wants an executable file; `expect`
 * (folder kind) stats a name inside the folder.
 */
export async function checkFolder(input: string, o: { home: string; kind?: ChooseKind; expect?: string | null; platform?: NodeJS.Platform; deadlineMs?: number }): Promise<FolderCheck> {
  const home = o.home;
  const platform = o.platform ?? process.platform;
  const { P } = pathsOf(platform);
  const kind = o.kind ?? 'folder';
  const deadline = Date.now() + (o.deadlineMs ?? FS_DEADLINE_MS);
  const sep = folderPlatform(platform).tilde;
  const raw = input === '~' ? home : sep.test(input) ? P.join(home, input.slice(2)) : input;
  const shown = (p: string): string => displayOf(p, home, platform);
  const name = (p: string): string => displayPath(P.basename(p) || p);
  const refused = pathRefusal(raw, platform);
  if (refused) return { ok: false, why: refused, real: '', display: displayPath(input), name: name(input), home: null };
  if (!P.isAbsolute(raw)) return { ok: false, why: 'not-absolute', real: '', display: displayPath(input), name: name(input), home: null };
  const abs = P.resolve(raw);
  const errWhy = (err: unknown): FolderWhy => (['EACCES', 'EPERM'].includes(String((err as NodeJS.ErrnoException).code)) ? 'unreadable' : 'missing');
  let real: string;
  try {
    const r = await within(fs.promises.realpath(abs), deadline);
    if (r === TIMED_OUT) return { ok: false, why: 'timeout', real: '', display: shown(abs), name: name(abs), home: null };
    real = r;
  } catch (err) {
    return { ok: false, why: errWhy(err), real: '', display: shown(abs), name: name(abs), home: null };
  }
  // a symlink into an automount or a share: refused before it is stat'ed
  const refusedReal = pathRefusal(real, platform);
  if (refusedReal) return { ok: false, why: refusedReal, real: '', display: shown(abs), name: name(abs), home: null };
  const base = { real, display: shown(real), name: name(real), home: homePlace(real, home, platform) };
  const timedOut = { ok: false as const, why: 'timeout' as const, ...base };
  let st: fs.Stats;
  try {
    const r = await within(fs.promises.stat(real), deadline);
    if (r === TIMED_OUT) return timedOut;
    st = r;
  } catch (err) {
    return { ok: false, why: errWhy(err), ...base };
  }
  const can = async (mode: number): Promise<boolean | typeof TIMED_OUT> => {
    try {
      const r = await within(fs.promises.access(real, mode), deadline);
      return r === TIMED_OUT ? TIMED_OUT : true;
    } catch {
      return false;
    }
  };
  if (kind === 'file') {
    if (!st.isFile()) return { ok: false, why: 'not-a-file', ...base };
    const x = await can(fs.constants.X_OK);
    if (x === TIMED_OUT) return timedOut;
    if (!x) return { ok: false, why: 'not-executable', ...base };
    return { ok: true, why: base.home === 'outside' ? 'outside-home' : 'ok', ...base };
  }
  if (!st.isDirectory()) return { ok: false, why: 'file', ...base };
  const rx = await can(fs.constants.R_OK | fs.constants.X_OK);
  if (rx === TIMED_OUT) return timedOut;
  if (!rx) return { ok: false, why: 'unreadable', ...base };
  if (o.expect) {
    const has = async (dir: string): Promise<boolean | typeof TIMED_OUT> => {
      try {
        const r = await within(fs.promises.stat(P.join(dir, o.expect!)), deadline);
        return r === TIMED_OUT ? TIMED_OUT : r.isFile();
      } catch {
        return false;
      }
    };
    const found = await has(real);
    if (found === TIMED_OUT) return timedOut;
    if (!found) {
      // the runner's one hint (design copy wrong-contents.runner): a dist folder beside it that holds the name
      const dist = P.join(real, 'dist');
      const suggest = (await has(dist)) === true ? { real: dist, display: shown(dist) } : undefined;
      return { ok: false, why: 'wrong-contents', ...base, expectFound: false, ...(suggest ? { suggest } : {}) };
    }
  }
  const why: FolderWhy = base.home === 'home-or-above' ? 'home' : base.home === 'outside' ? 'outside-home' : 'ok';
  return { ok: true, why, ...base, ...(o.expect ? { expectFound: true } : {}) };
}

/** The kernel half of request.folder.choose / .check / .recent (see the header). */
export class FolderPicker {
  readonly #o: FolderOptions;
  readonly #home: string;
  readonly #platform: NodeJS.Platform;
  /** cwd → newest ISO instant, insertion order = recency */
  readonly #seen = new Map<string, string>();
  #choosing: { ac: AbortController; connId: string } | null = null;
  #checks: number[] = [];
  #opens: number[] = [];

  constructor(o: FolderOptions) {
    this.#o = o;
    this.#home = o.userHome ?? os.homedir();
    this.#platform = o.platform ?? process.platform;
  }

  #now(): number {
    return (this.#o.clock ?? Date.now)();
  }

  /** Is request.folder.choose offered here (status.folders.chooser)? macOS only in 8.0. */
  chooserOffered(): boolean {
    return folderPlatform(this.#platform).chooser;
  }

  status(): { chooser: boolean } {
    return { chooser: this.chooserOffered() };
  }

  /** Boot: fold the persistent session.open rows read from the log, in seq order. */
  seed(rows: Iterable<FolderRow>): void {
    for (const r of rows) this.observe(r);
  }

  /**
   * One committed row: the kernel's session.open of a session the HUMAN opened attended adds its cwd (newest last).
   * Aegis L2: principalClass must be 'human' and attended true (both lanes write both); no fs call here.
   */
  observe(e: FolderRow): void {
    if (e.kind !== 'session.open' || e.principal !== this.#o.kernelPrincipal || !isObj(e.payload)) return;
    const p = e.payload;
    if (p.principalClass !== 'human' || p.attended !== true) return;
    if (typeof p.cwd !== 'string' || !path.isAbsolute(p.cwd) || p.cwd.length > FOLDER_PATH_MAX || pathRefusal(p.cwd, this.#platform)) return;
    const at = typeof e.at === 'string' ? e.at : new Date(this.#now()).toISOString();
    this.#seen.delete(p.cwd);
    this.#seen.set(p.cwd, at);
    while (this.#seen.size > FOLDER_FOLD_CAP) this.#seen.delete(this.#seen.keys().next().value as string);
  }

  /** The connection closed: a chooser it opened is closed with it (Aegis M2). */
  connectionClosed(connId: string): void {
    if (this.#choosing?.connId === connId) this.#choosing.ac.abort();
  }

  #human(asker: FolderAsker, kind: string): void {
    if (asker.principalClass !== 'human' || !asker.principal || (asker.credential !== 'gui' && asker.credential !== 'device')) {
      throw new RpcRefusal('FORBIDDEN', 'matrix', `${kind} is the human's, on a gui or device connection (never voice, an agent, a mod or a session)`);
    }
  }

  /** One fs-touching ask (a check, a choose's startIn): CHECK_BURST per CHECK_WINDOW_MS, else rate-limited. */
  #take(field: string): void {
    const now = this.#now();
    this.#checks = this.#checks.filter((t) => now - t < CHECK_WINDOW_MS);
    if (this.#checks.length >= CHECK_BURST) {
      const retryAfterMs = Math.max(0, CHECK_WINDOW_MS - (now - this.#checks[0]!));
      throw new RpcRefusal('BAD_REQUEST', 'rate-limited', '#folder-picker: too many checks just now: try again in a moment', { field, why: 'rate-limited', retryAfterMs });
    }
    this.#checks.push(now);
  }

  /**
   * request.folder.recent{}: newest first, deduplicated by realpath, missing folders dropped. Aegis M1: async, the
   * newest FOLDER_RECENT_SCAN folders only, under one FS_DEADLINE_MS deadline (a folder that does not answer in time
   * is left out). Rate-limited like a check.
   */
  async recent(asker: FolderAsker, payload: unknown): Promise<{ recent: FolderRecent[] }> {
    this.#human(asker, FOLDER_RECENT_REQUEST);
    if (payload !== undefined && payload !== null && !(isObj(payload) && Object.keys(payload).length === 0)) throw bad('payload', `${FOLDER_RECENT_REQUEST} takes {}`);
    this.#take('payload');
    const deadline = Date.now() + FS_DEADLINE_MS;
    const newest = [...this.#seen].reverse().slice(0, FOLDER_RECENT_SCAN);
    const reals = await Promise.all(
      newest.map(async ([cwd]) => {
        try {
          const r = await within(fs.promises.realpath(cwd), deadline);
          if (r === TIMED_OUT || pathRefusal(r, this.#platform)) return null;
          const st = await within(fs.promises.stat(r), deadline);
          return st !== TIMED_OUT && st.isDirectory() ? r : null;
        } catch {
          return null; // a folder that no longer exists is left out
        }
      }),
    );
    const out: FolderRecent[] = [];
    const seen = new Set<string>();
    newest.forEach(([, at], i) => {
      const real = reals[i];
      if (!real || seen.has(real) || out.length >= FOLDER_RECENT_MAX) return;
      seen.add(real);
      out.push({ real, display: displayOf(real, this.#home, this.#platform), repoName: displayPath(path.basename(real) || real), lastUsedAt: at });
    });
    return { recent: out };
  }

  /** request.folder.check{path, kind?, expect?}: read-only, rate-limited, under the fs deadline. */
  async check(asker: FolderAsker, payload: unknown): Promise<FolderCheck> {
    this.#human(asker, FOLDER_CHECK_REQUEST);
    if (!isObj(payload)) throw bad('path', `${FOLDER_CHECK_REQUEST} takes {path, kind?, expect?}`);
    for (const k of Object.keys(payload)) if (!['path', 'kind', 'expect'].includes(k)) throw bad(k, `unknown field ${k.slice(0, 32)}`);
    const { path: p, kind, expect } = payload;
    if (typeof p !== 'string' || p.length === 0 || p.length > FOLDER_PATH_MAX || p.includes('\0')) throw bad('path', `path is a string of 1..${FOLDER_PATH_MAX} characters`);
    if (kind !== undefined && kind !== 'folder' && kind !== 'file') throw bad('kind', "kind is 'folder' or 'file'");
    if (expect !== undefined && (typeof expect !== 'string' || !FOLDER_EXPECTS.includes(expect) || kind === 'file')) throw bad('expect', `expect is one of ${FOLDER_EXPECTS.join(', ')} (folder kind only)`);
    this.#take('path');
    return checkFolder(p, { home: this.#home, platform: this.#platform, kind: (kind as ChooseKind | undefined) ?? 'folder', expect: (expect as string | undefined) ?? null });
  }

  /**
   * request.folder.choose{kind, purpose?, startIn?}: the macOS chooser, one at a time, at most once per
   * CHOOSER_GAP_MS and CHOOSER_PER_MINUTE a minute (Aegis M2). {cancel:true} closes an open chooser, from the
   * connection that opened it only (the GUI's Esc, cancel or a recent picked meanwhile); that connection closing
   * closes it too. The pending choose then answers {cancelled:true}.
   */
  async choose(asker: FolderAsker, payload: unknown): Promise<{ cancelled: true; why?: 'timeout' } | { cancelled: true; closed: boolean } | { path: string; display: string; check: FolderCheck }> {
    this.#human(asker, FOLDER_CHOOSE_REQUEST);
    if (!isObj(payload)) throw bad('kind', `${FOLDER_CHOOSE_REQUEST} takes {kind:'folder'|'file', purpose?, startIn?} or {cancel:true}`);
    if (Object.hasOwn(payload, 'cancel')) {
      if (payload.cancel !== true || Object.keys(payload).length !== 1) throw bad('cancel', 'cancel takes no other field: {cancel:true}');
      const open = this.#choosing;
      if (open && open.connId !== asker.connId) throw new RpcRefusal('FORBIDDEN', 'not-opener', '#folder-picker: only the window that opened the chooser can close it', { why: 'not-opener' });
      open?.ac.abort();
      return { cancelled: true, closed: open !== null };
    }
    // Aegis: no `prompt` field exists: the prompt is fixed by purpose; any other field is refused, never ignored
    for (const k of Object.keys(payload)) if (!['kind', 'purpose', 'startIn'].includes(k)) throw bad(k, `unknown field ${k.slice(0, 32)} (the chooser's prompt is fixed by purpose)`);
    const kind = payload.kind;
    if (kind !== 'folder' && kind !== 'file') throw bad('kind', "kind is 'folder' or 'file'");
    const purpose = payload.purpose === undefined ? (kind === 'file' ? 'command' : 'session') : payload.purpose;
    if (!isPurpose(purpose) || PURPOSE_KIND[purpose] !== kind) throw bad('purpose', `purpose is session, runner or mod for a folder, command for a file`);
    if (payload.startIn !== undefined) {
      const st = payload.startIn;
      if (typeof st !== 'string' || st.length === 0 || st.length > FOLDER_PATH_MAX || st.includes('\0')) throw bad('startIn', 'startIn is an absolute folder');
    }
    if (!this.chooserOffered()) throw new RpcRefusal('UNSUPPORTED', 'no-chooser', "#folder-picker: this kernel can't open the macOS folder chooser here: type a full path", { why: 'no-chooser', platform: this.#platform });
    if (this.#choosing) throw new RpcRefusal('BAD_REQUEST', 'busy', '#folder-picker: a chooser is already open: finish or cancel it first', { why: 'busy' });
    const now = this.#now();
    this.#opens = this.#opens.filter((t) => now - t < 60_000);
    const last = this.#opens[this.#opens.length - 1];
    const wait = Math.max(last !== undefined ? CHOOSER_GAP_MS - (now - last) : 0, this.#opens.length >= CHOOSER_PER_MINUTE ? 60_000 - (now - this.#opens[0]!) : 0);
    if (wait > 0) throw new RpcRefusal('BAD_REQUEST', 'rate-limited', '#folder-picker: the chooser just opened: try again in a moment', { field: 'kind', why: 'rate-limited', retryAfterMs: wait });
    if (typeof payload.startIn === 'string') this.#take('startIn'); // Aegis M1: a startIn is an fs check like any other
    // the slot is taken BEFORE the async startIn check, so a second choose meanwhile is refused busy
    const ac = new AbortController();
    this.#choosing = { ac, connId: asker.connId };
    this.#opens.push(now);
    try {
      let startIn: string | null = null;
      if (typeof payload.startIn === 'string') {
        const c = await checkFolder(payload.startIn, { home: this.#home, platform: this.#platform });
        startIn = c.ok ? c.real : null; // a startIn that is not a readable folder is dropped, never an error
      }
      if (ac.signal.aborted) return { cancelled: true };
      const run = await (this.#o.runChooser ?? defaultRunner)(chooserArgs(kind, purpose, startIn), this.#o.chooserTimeoutMs ?? CHOOSER_TIMEOUT_MS, ac.signal);
      if (ac.signal.aborted) return { cancelled: true };
      if (run.timedOut) return { cancelled: true, why: 'timeout' };
      if (run.code !== 0) {
        if (/-128\b/.test(run.stderr)) return { cancelled: true }; // "User canceled. (-128)"
        throw new RpcRefusal('ENGINE', 'chooser-failed', `#folder-picker: the macOS chooser did not open (${run.stderr.trim().slice(0, 120) || `exit ${String(run.code)}`})`, { why: 'chooser-failed' });
      }
      let chosen = run.stdout.replace(/\r?\n$/, '');
      if (chosen.length > 1) chosen = chosen.replace(/\/+$/, '');
      if (!path.isAbsolute(chosen)) throw new RpcRefusal('ENGINE', 'chooser-failed', '#folder-picker: the macOS chooser answered no path', { why: 'chooser-failed' });
      const check = await checkFolder(chosen, { home: this.#home, platform: this.#platform, kind });
      return { path: check.real || chosen, display: check.display, check };
    } finally {
      this.#choosing = null;
    }
  }
}
