/**
 * @symbol #loop-events
 *
 * #loop-events (docs/specs/gnomon-loops.md §2 triggers, §4 #loop-events; build plan step 7, LP4b). Event triggers
 * for RUNNABLE loops (trusted at their current hash, unpaused, not held by the kill switch), registered and
 * unregistered with the trust state exactly as #loop-timers does (registry.onChange, runner.onEvent): an untrusted,
 * paused or killed loop has no watcher and no subscription.
 *
 *   | Trigger         | Source                                                                                     |
 *   |-----------------|--------------------------------------------------------------------------------------------|
 *   | `file.changed`  | one recursive fs.watch per repo, matched against the loop's compiled flow globs            |
 *   | `commit.landed` | a watch on the git dir (HEAD, refs/heads, packed-refs), parsed directly (the kernel runs no git) |
 *   | `session.ended` | kernel `session.exited` rows (the session's `session.open` cwd inside the loop's repo)     |
 *   | `card.decided`  | kernel `approval.decide` rows whose card a run of `{loop, node}` raised (`loop.notified`)  |
 *
 * `sentinel.incident.opened` is refused at validation in 8.0 (schema.ts: "lands in 8.1").
 *
 * **Matching** reads kernel-stamped fields only (kind, path, sha, ref, hsid, cardId), never payload text (§3.4).
 * **The fs watch** ignores `.git`, every `node_modules` and the Gnomon home (check copies live in
 * `<home>/loop-work`), and refuses a path whose realpath leaves the repo (a symlink out is never followed).
 * **Debounce** is trailing per (loop, trigger): each event restarts the wait (`debounce`, at least `settleMs` for
 * watch events), capped at 3× the debounce so a busy repo still fires.
 *
 * **Each fire** hands off to `runner.start` FIRST (it re-checks trust, the kill switch, strictness and the day caps)
 * with kernel ids only (`{type:'event', kind, fireId, count, sha|hsid|cardId}`, never the path or ref, which could
 * reach a model prompt); only a fire that starts or queues a run writes the kernel
 * `loop.trigger.fired{loopId, scope, repoKey, trigger{…, path|ref}, eventId?}` row. A coalesced or refused fire is a
 * per-loop counter (`dropped()`), not a row. `gnomon replay` joins each run to its row by `fireId` (G-LOOP-17,
 * ledger.ts replayLoopRuns).
 *
 * **Self-trigger guard (G-LOOP-15).** An event whose causes chain includes a run of loop L never triggers L. The
 * chain: a row's `runId`, `cardId` (loop.notified) and `hsid` (session.open{origin:'loop', loopRun}), its `causes`
 * refs (`ev:`, `card:`, `hsid:`) transitively, and a run's `parentRunId` callers. A commit is L's only when a
 * kernel-signed `loop.landed{sha}` row names it (never a trailer or identity in the commit). A file change is L's while L's run is active and the path is in its
 * `land.paths`, or for a quiet window after a `loop.landed{paths}` row covering it.
 */
import { randomBytes } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { CompiledTrigger } from '../../loops/index.js';
import type { LoopEntry, LoopRegistry } from './registry.js';
import { loopKeyOf } from './registry.js';
import type { LoopRunner, LoopRunnerEvent } from './runner.js';

type EventTrigger = Extract<CompiledTrigger, { type: 'event' }>;

/** The kernel rows #loop-events folds (seeded at boot, then every committed row). */
export const LOOP_EVENT_INDEX_KINDS: readonly string[] = Object.freeze(['session.open', 'session.exited', 'approval.decide', 'loop.run.started', 'loop.run.ended', 'loop.notified', 'loop.landed']);
/** The floor of a watch event's debounce: a save or a ref update settles first. */
export const LOOP_EVENT_SETTLE_MS = 250;
/** How long after a `loop.landed{paths}` row a change to those paths is still the loop's own. */
export const LOOP_LANDED_QUIET_MS = 60_000;
const INDEX_CAP = 4096;
const SHA = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/;
const REF_HEADS = /^refs\/heads\/[^\0\s]+$/;
/** The trigger fields handed to runner.start besides type/kind/fireId/count: kernel ids only (never path or ref). */
const HANDOFF_FIELDS = ['sha', 'hsid', 'cardId', 'loop', 'node'] as const;

export interface LoopEventRow {
  id?: string;
  kind: string;
  principal: string;
  keyId?: string;
  at?: string;
  causes?: string[];
  payload?: unknown;
}

export interface LoopEventsOptions {
  home: string;
  registry: Pick<LoopRegistry, 'entries' | 'entry' | 'canRun' | 'onChange'>;
  runner: Pick<LoopRunner, 'start' | 'isHeld' | 'running' | 'onEvent'>;
  kernelPrincipal: string;
  isKernelKey?: (keyId: string) => boolean;
  /** writes a kernel row */
  append: (kind: string, payload: Record<string, unknown>) => Promise<unknown>;
  /** false: no fs.watch (tests drive handleFsEvent / checkRefs) */
  watch?: boolean;
  settleMs?: number;
  /** the debounce timer (default setTimeout, unref'd) */
  timer?: (fn: () => void, ms: number) => () => void;
  clock?: () => number;
  diag?: (event: string, data: Record<string, unknown>) => void;
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string | undefined => (typeof v === 'string' && v.length > 0 ? v : undefined);

/** A repo-relative POSIX glob (`*`, `**`, `?`, `{a,b}`) as a RegExp; a pattern with no wildcard also matches beneath it. */
export function globToRegExp(glob: string): RegExp {
  const g = glob.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '');
  let re = '';
  let wild = false;
  for (let i = 0; i < g.length; i++) {
    const c = g[i]!;
    if (c === '*') {
      wild = true;
      if (g[i + 1] === '*') {
        i++;
        if (g[i + 1] === '/') {
          i++;
          re += '(?:.*/)?';
        } else re += '.*';
      } else re += '[^/]*';
    } else if (c === '?') {
      wild = true;
      re += '[^/]';
    } else if (c === '{' && g.indexOf('}', i) > i) {
      wild = true;
      const end = g.indexOf('}', i);
      re += `(?:${g.slice(i + 1, end).split(',').map((a) => a.replace(/[.+^${}()|[\]\\*?]/g, '\\$&')).join('|')})`;
      i = end;
    } else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${re}${wild ? '' : '(?:/.*)?'}$`);
}

const within = (root: string, p: string): boolean => p === root || p.startsWith(root.endsWith(path.sep) ? root : root + path.sep);

function realOrNull(p: string): string | null {
  try {
    return fs.realpathSync.native(p);
  } catch {
    return null;
  }
}

/** The realpath of `abs`, or of its nearest existing ancestor joined with the rest (a deleted file still resolves). */
function realOfMaybeMissing(abs: string): string | null {
  let cur = abs;
  const rest: string[] = [];
  for (let i = 0; i < 256; i++) {
    const r = realOrNull(cur);
    if (r !== null) return rest.length ? path.join(r, ...rest.reverse()) : r;
    const up = path.dirname(cur);
    if (up === cur) return null;
    rest.push(path.basename(cur));
    cur = up;
  }
  return null;
}

// ── Git, read without running git ───────────────────────────────────────────

export interface GitDirs {
  gitDir: string;
  commonDir: string;
}

/**
 * The repo's git dir and common dir, validated the way git links them, else null (no commit.landed watch):
 *   - a `.git` DIRECTORY (not a symlink) with no `commondir` (or one naming itself): gitDir = commonDir = it;
 *   - a worktree's `.git` FILE `gitdir: <x>`: x is a real `<common>/worktrees/<name>` dir (not a symlink), its own
 *     `gitdir` file links back to THIS `.git` file, and its `commondir` resolves to `<common>`, a real directory.
 * Nothing outside the repo's .git (the common dir, for a worktree) is ever watched.
 */
export function gitDirsOf(repoRoot: string): GitDirs | null {
  const dot = path.join(repoRoot, '.git');
  const realDir = (p: string): string | null => {
    try {
      const st = fs.lstatSync(p);
      return st.isDirectory() && !st.isSymbolicLink() ? fs.realpathSync.native(p) : null;
    } catch {
      return null;
    }
  };
  let st: fs.Stats;
  try {
    st = fs.lstatSync(dot);
  } catch {
    return null;
  }
  if (st.isDirectory()) {
    const gitDir = realDir(dot);
    if (!gitDir) return null;
    const cd = readSmall(path.join(gitDir, 'commondir'), 4096)?.trim();
    if (cd && realDir(path.resolve(gitDir, cd)) !== gitDir) return null;
    return { gitDir, commonDir: gitDir };
  }
  if (!st.isFile()) return null;
  const m = /^gitdir:\s*(.+?)\s*$/m.exec(readSmall(dot, 4096) ?? '');
  if (!m) return null;
  const gitDir = realDir(path.resolve(repoRoot, m[1]!));
  if (!gitDir || path.basename(path.dirname(gitDir)) !== 'worktrees') return null;
  const back = readSmall(path.join(gitDir, 'gitdir'), 4096)?.trim();
  const realDot = realOrNull(dot);
  if (!back || !realDot || realOrNull(path.resolve(gitDir, back)) !== realDot) return null;
  const cd = readSmall(path.join(gitDir, 'commondir'), 4096)?.trim();
  const commonDir = cd ? realDir(path.resolve(gitDir, cd)) : null;
  if (!commonDir || commonDir !== path.dirname(path.dirname(gitDir))) return null;
  return { gitDir, commonDir };
}

function readSmall(p: string, max = 1 << 20): string | null {
  try {
    const st = fs.lstatSync(p);
    if (!st.isFile() || st.size > max) return null;
    return fs.readFileSync(p, 'utf8');
  } catch {
    return null;
  }
}

/** HEAD as {ref, sha}: a symbolic ref through its loose file, else packed-refs; a detached HEAD has ref null. */
export function readHead(d: GitDirs): { ref: string | null; sha: string | null } {
  const head = readSmall(path.join(d.gitDir, 'HEAD'), 4096)?.trim();
  if (!head) return { ref: null, sha: null };
  if (SHA.test(head)) return { ref: null, sha: head };
  const m = /^ref:\s*(\S+)$/.exec(head);
  if (!m || !REF_HEADS.test(m[1]!) || m[1]!.split('/').some((s) => s === '..' || s === '.')) return { ref: null, sha: null };
  const ref = m[1]!;
  const loose = readSmall(path.join(d.commonDir, ...ref.split('/')), 4096)?.trim();
  if (loose && SHA.test(loose)) return { ref, sha: loose };
  for (const line of (readSmall(path.join(d.commonDir, 'packed-refs'), 64 << 20) ?? '').split('\n')) {
    const sp = line.indexOf(' ');
    if (sp > 0 && line.slice(sp + 1).trim() === ref && SHA.test(line.slice(0, sp))) return { ref, sha: line.slice(0, sp) };
  }
  return { ref, sha: null };
}

// ── The component ───────────────────────────────────────────────────────────

interface Sub {
  key: string;
  entry: LoopEntry;
  realRoot: string;
  triggers: Array<{ idx: number; t: EventTrigger; re?: RegExp[] }>;
}

interface RepoWatch {
  realRoot: string;
  files: { close(): void } | null;
  git: { close(): void } | null;
  dirs: GitDirs | null;
  head: { ref: string | null; sha: string | null } | null;
  gitCancel?: () => void;
}

interface Pending {
  cancel: () => void;
  firstAt: number;
  fields: Obj;
  count: number;
  eventId?: string;
  debounceMs: number;
}

interface RunInfo {
  key: string;
  loopId: string;
  repoKey: string;
  parent?: string;
}

export class LoopEvents {
  readonly #o: LoopEventsOptions;
  readonly #settle: number;
  readonly #realHome: string;
  readonly #unsubs: Array<() => void> = [];
  #subs = new Map<string, Sub>();
  readonly #repos = new Map<string, RepoWatch>();
  readonly #pending = new Map<string, Pending>();
  // the causes-chain indexes (bounded, oldest dropped first)
  readonly #runs = new Map<string, RunInfo>();
  readonly #active = new Map<string, string>(); // loop key → live runId (from the rows)
  readonly #cards = new Map<string, { runId: string; key: string; loopId: string; nodeId: string; repoKey: string }>();
  readonly #sessions = new Map<string, { cwd?: string; runId?: string }>();
  readonly #rowLoops = new Map<string, string[]>();
  readonly #landedSha = new Map<string, string[]>();
  readonly #landedPaths: Array<{ keys: string[]; re: RegExp[]; until: number }> = [];
  readonly #dropped = new Map<string, { coalesced: number; refused: number }>();
  #closed = false;

  constructor(o: LoopEventsOptions) {
    this.#o = o;
    this.#settle = o.settleMs ?? LOOP_EVENT_SETTLE_MS;
    this.#realHome = realOfMaybeMissing(path.resolve(o.home)) ?? path.resolve(o.home);
    this.#unsubs.push(o.registry.onChange(() => this.reconcile()));
    this.#unsubs.push(o.runner.onEvent((e: LoopRunnerEvent) => this.reconcile(e)));
    this.reconcile();
  }

  #now(): number {
    return (this.#o.clock ?? Date.now)();
  }

  #timer(fn: () => void, ms: number): () => void {
    if (this.#o.timer) return this.#o.timer(fn, ms);
    const t = setTimeout(fn, ms);
    t.unref?.();
    return () => clearTimeout(t);
  }

  /** The same predicate #loop-timers uses: trusted at the current hash, unpaused, not held by the kill switch. */
  runnable(key: string): boolean {
    return !this.#closed && this.#o.registry.canRun(key).ok && !this.#o.runner.isHeld(key);
  }

  /** Loop keys subscribed now (tests, status). */
  keys(): string[] {
    return [...this.#subs.keys()].sort();
  }

  /** Repos with a live fs watch (`files`) or git watch (`git`), by realpath (tests, status). */
  watching(): Array<{ root: string; files: boolean; git: boolean }> {
    return [...this.#repos.values()].map((r) => ({ root: r.realRoot, files: r.files !== null, git: r.git !== null || r.dirs !== null })).sort((a, b) => (a.root < b.root ? -1 : 1));
  }

  /** Bring subscriptions and watches in line with the registry and the runner (trust, pause, kill, delete). */
  reconcile(e?: LoopRunnerEvent): void {
    if (this.#closed) return;
    if (e?.type === 'kill') this.#o.diag?.('loops.events-kill', {});
    const next = new Map<string, Sub>();
    for (const entry of this.#o.registry.entries()) {
      if (!entry.compiled || !this.runnable(entry.key)) continue;
      const triggers: Sub['triggers'] = [];
      entry.compiled.triggers.forEach((t, idx) => {
        if (t.type !== 'event') return;
        if (t.kind === 'file.changed') {
          const globs = t.paths ?? (t.flow ? entry.compiled!.flowPaths?.[t.flow] : undefined) ?? [];
          if (!globs.length) {
            this.#o.diag?.('loops.event-unresolved', { key: entry.key, flow: t.flow ?? null });
            return;
          }
          triggers.push({ idx, t, re: globs.map(globToRegExp) });
        } else if (t.kind === 'commit.landed' || t.kind === 'session.ended' || t.kind === 'card.decided') triggers.push({ idx, t });
      });
      if (!triggers.length) continue;
      const realRoot = realOrNull(entry.repoRoot);
      if (!realRoot) continue;
      next.set(entry.key, { key: entry.key, entry, realRoot, triggers });
    }
    this.#subs = next;
    // drop debounces of loops no longer subscribed
    for (const [pk, p] of [...this.#pending]) {
      const key = pk.slice(0, pk.lastIndexOf('#'));
      if (!next.has(key)) {
        p.cancel();
        this.#pending.delete(pk);
      }
    }
    // one watch per repo, only for the kinds some subscribed loop wants
    const want = new Map<string, { files: boolean; git: boolean }>();
    for (const s of next.values()) {
      const w = want.get(s.realRoot) ?? { files: false, git: false };
      for (const { t } of s.triggers) {
        if (t.kind === 'file.changed') w.files = true;
        if (t.kind === 'commit.landed') w.git = true;
      }
      if (w.files || w.git) want.set(s.realRoot, w);
    }
    for (const [root, r] of [...this.#repos]) {
      const w = want.get(root);
      if (!w?.files && r.files) {
        r.files.close();
        r.files = null;
      }
      if (!w?.git && (r.git || r.dirs)) {
        r.git?.close();
        r.gitCancel?.();
        r.git = null;
        r.dirs = null;
        r.head = null;
      }
      if (!r.files && !r.dirs) this.#repos.delete(root);
    }
    for (const [root, w] of want) {
      const r = this.#repos.get(root) ?? { realRoot: root, files: null, git: null, dirs: null, head: null };
      this.#repos.set(root, r);
      if (w.files && !r.files) r.files = this.#watchFiles(r);
      if (w.git && !r.dirs) this.#watchGit(r);
    }
  }

  #watchFiles(r: RepoWatch): { close(): void } | null {
    if (this.#o.watch === false) return { close: () => undefined };
    try {
      const w = fs.watch(r.realRoot, { recursive: true, persistent: false }, (_e, file) => {
        if (typeof file === 'string' && file) this.handleFsEvent(r.realRoot, file);
      });
      w.on('error', (err) => this.#o.diag?.('loops.watch-error', { root: r.realRoot, why: String(err).slice(0, 200) }));
      return { close: () => w.close() };
    } catch (err) {
      // no recursive watch here (an old Linux kernel, a removed folder): file.changed stays silent, said once
      this.#o.diag?.('loops.watch-unavailable', { root: r.realRoot, why: err instanceof Error ? err.message.slice(0, 200) : 'fs.watch failed' });
      return null;
    }
  }

  #watchGit(r: RepoWatch): void {
    const dirs = gitDirsOf(r.realRoot);
    if (!dirs) {
      this.#o.diag?.('loops.git-unavailable', { root: r.realRoot });
      return;
    }
    r.dirs = dirs;
    r.head = readHead(dirs);
    if (this.#o.watch === false) return;
    const onGit = (): void => {
      r.gitCancel?.();
      r.gitCancel = this.#timer(() => {
        r.gitCancel = undefined;
        this.checkRefs(r.realRoot);
      }, this.#settle);
    };
    const closers: Array<() => void> = [];
    /** `names`: the entries of a non-recursive dir watch that matter (null: every event, the refs/heads tree) */
    const watchOne = (dir: string, recursive: boolean, names: string[] | null): void => {
      try {
        const w = fs.watch(dir, { recursive, persistent: false }, (_e, file) => {
          if (names && typeof file === 'string' && !names.some((n) => file === n || file.startsWith(`${n}.`))) return;
          onGit();
        });
        w.on('error', () => undefined);
        closers.push(() => w.close());
      } catch (err) {
        this.#o.diag?.('loops.watch-unavailable', { root: r.realRoot, dir, why: err instanceof Error ? err.message.slice(0, 200) : 'fs.watch failed' });
      }
    };
    // never a recursive watch of the whole git dir: HEAD and packed-refs (non-recursive), and the refs/heads tree
    watchOne(dirs.commonDir, false, ['packed-refs', 'HEAD']);
    const heads = path.join(dirs.commonDir, 'refs', 'heads');
    if (realOrNull(heads) !== null && within(dirs.commonDir, realOrNull(heads)!)) watchOne(heads, true, null);
    if (dirs.gitDir !== dirs.commonDir) watchOne(dirs.gitDir, false, ['HEAD']);
    r.git = { close: () => closers.forEach((c) => c()) };
  }

  /**
   * One fs event from a repo's watch (`rel` relative to its realpath root). Returns the loop keys it was queued for.
   * Ignored: `.git`, any `node_modules`, the Gnomon home; refused: a path whose realpath leaves the repo.
   */
  handleFsEvent(realRoot: string, rel: string): string[] {
    if (this.#closed) return [];
    const f = rel.split(path.sep).join('/').replace(/^\.\//, '');
    if (!f || f.startsWith('/') || f.split('/').some((s) => s === '..')) return [];
    const segs = f.split('/');
    if (segs[0] === '.git' || segs.includes('node_modules')) return [];
    const abs = path.join(realRoot, ...segs);
    if (within(this.#realHome, abs)) return [];
    const real = realOfMaybeMissing(abs);
    if (real === null || !within(realRoot, real)) {
      this.#o.diag?.('loops.event-refused', { root: realRoot, why: 'symlink-escape' });
      return [];
    }
    if (within(this.#realHome, real)) return [];
    const queued: string[] = [];
    for (const s of this.#subs.values()) {
      if (s.realRoot !== realRoot) continue;
      if (this.#ownFileChange(s, f)) continue; // G-LOOP-15
      for (const tr of s.triggers) {
        if (tr.t.kind !== 'file.changed' || !tr.re!.some((re) => re.test(f))) continue;
        this.#schedule(s, tr.idx, tr.t, { path: f }, this.#settle);
        queued.push(s.key);
      }
    }
    return queued;
  }

  #ownFileChange(s: Sub, f: string): boolean {
    const now = this.#now();
    while (this.#landedPaths.length && this.#landedPaths[0]!.until < now) this.#landedPaths.shift();
    if (this.#landedPaths.some((l) => l.keys.includes(s.key) && l.re.some((re) => re.test(f)))) return true;
    // a land in flight (step 11 writes the repo under the run): the loop's own land paths are its own
    const live = this.#active.has(s.key) || this.#o.runner.running().some((r) => r.key === s.key);
    return live && (s.entry.compiled?.land?.paths ?? []).some((g) => globToRegExp(g).test(f));
  }

  /** Re-read a repo's HEAD; a new sha on the same branch is `commit.landed`. Returns the loop keys queued. */
  checkRefs(realRoot: string): string[] {
    const r = this.#repos.get(realRoot);
    if (this.#closed || !r?.dirs) return [];
    const prev = r.head;
    const cur = readHead(r.dirs);
    r.head = cur;
    if (!prev || !cur.sha || !prev.sha || prev.sha === cur.sha || prev.ref !== cur.ref) return [];
    // G-LOOP-15: a commit is a loop's own ONLY when a kernel-signed loop.landed{sha} row names it (never a trailer or an
    // identity in the commit, which anyone can write); land writes that row BEFORE it moves the ref (build plan step 11)
    const own = new Set<string>(this.#landedSha.get(cur.sha) ?? []);
    const queued: string[] = [];
    for (const s of this.#subs.values()) {
      if (s.realRoot !== realRoot) continue;
      if (own.has(s.key)) continue; // G-LOOP-15: the loop's own commit
      for (const tr of s.triggers) {
        if (tr.t.kind !== 'commit.landed') continue;
        this.#schedule(s, tr.idx, tr.t, { sha: cur.sha, ...(cur.ref ? { ref: cur.ref } : {}) }, this.#settle);
        queued.push(s.key);
      }
    }
    return queued;
  }

  // ── The kernel log ────────────────────────────────────────────────────────

  #isKernel(r: LoopEventRow): boolean {
    if (r.principal !== this.#o.kernelPrincipal) return false;
    if (this.#o.isKernelKey && (typeof r.keyId !== 'string' || !this.#o.isKernelKey(r.keyId))) return false;
    return true;
  }

  /** Boot: fold the history into the indexes; nothing fires. */
  seed(rows: Iterable<LoopEventRow>): void {
    for (const r of rows) this.#index(r);
  }

  /** A committed row: fold it, then match it (session.exited, approval.decide). Returns the loop keys queued. */
  observe(r: LoopEventRow): string[] {
    if (this.#closed || !this.#isKernel(r)) return [];
    const chain = this.#index(r);
    if (!isObj(r.payload)) return [];
    const p = r.payload;
    const queued: string[] = [];
    if (r.kind === 'session.exited') {
      const hsid = str(p.hsid);
      const cwd = hsid ? this.#sessions.get(hsid)?.cwd : undefined;
      if (!hsid || !cwd) return [];
      const realCwd = realOrNull(cwd) ?? path.resolve(cwd);
      for (const s of this.#subs.values()) {
        if (chain.includes(s.key) || !within(s.realRoot, realCwd)) continue;
        for (const tr of s.triggers) {
          if (tr.t.kind !== 'session.ended') continue;
          this.#schedule(s, tr.idx, tr.t, { hsid }, 0, r.id);
          queued.push(s.key);
        }
      }
    } else if (r.kind === 'approval.decide') {
      const cardId = str(p.cardId);
      const card = cardId ? this.#cards.get(cardId) : undefined;
      if (!cardId || !card) return [];
      for (const s of this.#subs.values()) {
        if (chain.includes(s.key) || s.entry.repoKey !== card.repoKey) continue;
        for (const tr of s.triggers) {
          if (tr.t.kind !== 'card.decided' || tr.t.loop !== card.loopId || tr.t.node !== card.nodeId) continue;
          this.#schedule(s, tr.idx, tr.t, { cardId, loop: card.loopId, node: card.nodeId }, 0, r.id);
          queued.push(s.key);
        }
      }
    }
    return queued;
  }

  /** The loop keys whose runs are in a run's chain (itself and its callers). */
  #runChain(runId: string | undefined): string[] {
    const out: string[] = [];
    for (let id = runId, i = 0; id && i < 16; i++) {
      const info = this.#runs.get(id);
      if (!info) break;
      if (!out.includes(info.key)) out.push(info.key);
      id = info.parent;
    }
    return out;
  }

  /** Fold one row into the indexes; returns the loops in its causes chain (G-LOOP-15). */
  #index(r: LoopEventRow): string[] {
    if (!this.#isKernel(r) || !isObj(r.payload)) return [];
    const p = r.payload;
    const put = <V>(m: Map<string, V>, k: string, v: V): void => {
      m.delete(k);
      m.set(k, v);
      if (m.size > INDEX_CAP) m.delete(m.keys().next().value!);
    };
    if (r.kind === 'loop.run.started') {
      const runId = str(p.runId);
      const loopId = str(p.loopId);
      const scope = str(p.scope);
      const repoKey = str(p.repoKey);
      if (runId && loopId && scope && repoKey) {
        const key = loopKeyOf(scope, repoKey, loopId);
        put(this.#runs, runId, { key, loopId, repoKey, ...(str(p.parentRunId) ? { parent: str(p.parentRunId)! } : {}) });
        if (!str(p.parentRunId)) this.#active.set(key, runId);
      }
    } else if (r.kind === 'loop.run.ended') {
      const info = this.#runs.get(str(p.runId) ?? '');
      if (info && this.#active.get(info.key) === p.runId) this.#active.delete(info.key);
    } else if (r.kind === 'session.open') {
      const hsid = str(p.hsid);
      const loopRun = isObj(p.loopRun) ? p.loopRun : undefined;
      if (hsid) put(this.#sessions, hsid, { ...(str(p.cwd) ? { cwd: str(p.cwd)! } : {}), ...(p.origin === 'loop' && str(loopRun?.runId) ? { runId: str(loopRun!.runId)! } : {}) });
    }
    // the chain: the row's own run, card, session and causes refs
    const chain = new Set<string>();
    const add = (keys: string[] | undefined): void => keys?.forEach((k) => chain.add(k));
    add(this.#runChain(str(p.runId)));
    const card = str(p.cardId) ? this.#cards.get(str(p.cardId)!) : undefined;
    if (card) add(this.#runChain(card.runId));
    const sess = str(p.hsid) ? this.#sessions.get(str(p.hsid)!) : undefined;
    if (sess?.runId) add(this.#runChain(sess.runId));
    for (const ref of Array.isArray(r.causes) ? r.causes : []) {
      if (typeof ref !== 'string') continue;
      const i = ref.indexOf(':');
      const scheme = ref.slice(0, i);
      const id = ref.slice(i + 1).split('@')[0]!;
      if (scheme === 'ev') add(this.#rowLoops.get(id));
      else if (scheme === 'card') add(this.#cards.get(id) ? this.#runChain(this.#cards.get(id)!.runId) : undefined);
      else if (scheme === 'hsid') add(this.#runChain(this.#sessions.get(id)?.runId));
    }
    if (r.kind === 'loop.notified') {
      const cardId = str(p.cardId);
      const runId = str(p.runId);
      const info = runId ? this.#runs.get(runId) : undefined;
      if (cardId && runId && info) put(this.#cards, cardId, { runId, key: info.key, loopId: info.loopId, nodeId: str(p.nodeId) ?? '', repoKey: info.repoKey });
    } else if (r.kind === 'loop.landed') {
      const keys = [...chain];
      const sha = str(p.sha);
      if (sha && keys.length) put(this.#landedSha, sha, keys);
      const paths = Array.isArray(p.paths) ? p.paths.filter((x): x is string => typeof x === 'string') : [];
      if (paths.length && keys.length) this.#landedPaths.push({ keys, re: paths.map(globToRegExp), until: this.#now() + LOOP_LANDED_QUIET_MS });
    }
    const out = [...chain];
    if (r.id && out.length) put(this.#rowLoops, r.id, out);
    return out;
  }

  // ── Debounce and fire ─────────────────────────────────────────────────────

  #schedule(s: Sub, idx: number, t: EventTrigger, fields: Obj, floorMs: number, eventId?: string): void {
    const pk = `${s.key}#${idx}`;
    const debounceMs = Math.max(t.debounceSec * 1000, floorMs);
    const now = this.#now();
    const p = this.#pending.get(pk);
    if (p) {
      p.cancel();
      p.fields = fields;
      p.count++;
      if (eventId) p.eventId = eventId;
    }
    const cur: Pending = p ?? { cancel: () => undefined, firstAt: now, fields, count: 1, debounceMs, ...(eventId ? { eventId } : {}) };
    // trailing, capped at 3× the debounce from the first event so a busy repo still fires
    const wait = Math.max(0, Math.min(debounceMs, cur.firstAt + 3 * debounceMs - now));
    cur.cancel = this.#timer(() => {
      if (this.#pending.get(pk) !== cur) return;
      this.#pending.delete(pk);
      void this.#fire(s.key, t, cur);
    }, wait);
    this.#pending.set(pk, cur);
  }

  /** Debounces waiting now (tests). */
  pending(): string[] {
    return [...this.#pending.keys()].sort();
  }

  /** Fires that did not hand off, per loop: coalesced into a run already flagged to rerun, or refused by the runner. */
  dropped(): Record<string, { coalesced: number; refused: number }> {
    return Object.fromEntries([...this.#dropped].map(([k, v]) => [k, { ...v }]));
  }

  #drop(key: string, why: 'coalesced' | 'refused'): void {
    const d = this.#dropped.get(key) ?? { coalesced: 0, refused: 0 };
    d[why]++;
    this.#dropped.set(key, d);
    if (this.#dropped.size > INDEX_CAP) this.#dropped.delete(this.#dropped.keys().next().value!);
  }

  /**
   * Hand off FIRST, write the row only when the hand-off took (Aegis step 7): a loop already running with its rerun
   * flag set, a spent day cap, a pause or strictness refusal writes no row (a per-loop counter instead), so churn in a
   * busy repo cannot flood the log. A run that starts (or queues) writes `loop.trigger.fired` with the same fireId;
   * replay joins them whatever their order. A coalesced fire sets the rerun flag; the rerun's trigger names its run.
   */
  async #fire(key: string, t: EventTrigger, p: Pending): Promise<void> {
    if (this.#closed || !this.runnable(key)) return;
    const entry = this.#o.registry.entry(key);
    if (!entry) return;
    const live = this.#o.runner.running().find((r) => r.key === key);
    if (live?.rerun) {
      this.#drop(key, 'coalesced');
      return;
    }
    const fireId = `lt-${randomBytes(8).toString('hex')}`;
    const row: Obj = { type: 'event', kind: t.kind, fireId, count: p.count, ...p.fields };
    // the hand-off carries kernel ids only: never the path or ref, which are repo-chosen names and would reach a
    // model prompt through `trigger.payload` (model-node.ts triggerFields); the row keeps them for replay and the GUI
    const handoff: Obj = { type: 'event', kind: t.kind, fireId, count: p.count };
    for (const k of HANDOFF_FIELDS) if (typeof p.fields[k] === 'string') handoff[k] = p.fields[k];
    let res: ReturnType<LoopEventsOptions['runner']['start']>;
    try {
      res = this.#o.runner.start(key, handoff);
    } catch (err) {
      this.#drop(key, 'refused');
      this.#o.diag?.('loops.trigger-refused', { key, kind: t.kind, why: err instanceof Error ? err.message.slice(0, 200) : 'refused' });
      return;
    }
    if ('coalesced' in res) {
      this.#drop(key, 'coalesced');
      return;
    }
    try {
      await this.#o.append('loop.trigger.fired', { loopId: entry.loopId, scope: entry.scope, repoKey: entry.repoKey, trigger: row, ...(p.eventId ? { eventId: p.eventId } : {}) });
    } catch (err) {
      // the run is already under way: replay reports it as started by an unknown fire (a divergence, not silence)
      this.#o.diag?.('loops.trigger-row-failed', { key, fireId, why: err instanceof Error ? err.message.slice(0, 200) : 'append failed' });
    }
  }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    for (const u of this.#unsubs.splice(0)) u();
    for (const p of this.#pending.values()) p.cancel();
    this.#pending.clear();
    for (const r of this.#repos.values()) {
      r.files?.close();
      r.git?.close();
      r.gitCancel?.();
    }
    this.#repos.clear();
    this.#subs.clear();
  }
}
