/**
 * @symbol #loop-registry
 *
 * #loop-registry (docs/specs/gnomon-loops.md §3.1, §4; build plan LP2). Knows every loop definition the kernel can
 * see and whether it may run:
 *
 *   - **Where.** Compiled `.paradigm/loops/*.loop.json` in each known repo (a repo is known from a kernel-signed
 *     `session.open{cwd}` row, a live session, or a human's loop request naming it) and `<home>/loops/*.loop.json`
 *     (personal). Every directory and file is lstat'd: a symlink is refused, the repo loops dir must realpath to
 *     `<repo>/.paradigm/loops`, the personal dir must not be group- or world-writable or another user's (POSIX).
 *     Watched (fs.watch, non-recursive) and rescanned on a timer, so argv and closure changes are seen too.
 *   - **Never trusts the file.** Each file is parsed and re-validated with the schema module
 *     (validateCompiledLoop), then hashed (hash.ts: canonical JSON, argv0 and its interpreter, argv files, the config
 *     closure, callee hashes). The kernel-side protected set adds the callees' and the closure's paths.
 *   - **State is a fold** of kernel-signed rows only (LL6): `loop.trusted|untrusted|closure.changed|paused|resumed|
 *     deleted`, keyed by {loopId, scope, repoKey}. A loop is `untrusted` (never trusted, or revoked), `trusted`
 *     (its current hash is the trusted hash, no pause), `waiting-trust` (it was trusted, its hash changed),
 *     `paused` (trusted hash, but a pause row stands), `deleted`, or `invalid` (the file is refused).
 *   - **Changes.** A trusted loop whose hash changes gets ONE `loop.paused{reason:'content-changed'}` and nothing runs
 *     until a new card. When ONLY the config closure changed (coreHash unchanged) it writes `loop.closure.changed`
 *     and `loop.paused{reason:'closure-changed'}` whoever made the change (Aegis LP2: authorship is forgeable, and
 *     the kernel never runs git on repo config); the human re-trusts through a closure-only loop-trust card.
 *   - **Calls.** resolveCall() is the runner's check before a call node runs: the callee is in the same scope and
 *     repo, TRUSTED at its current hash, and the pin (`id@hash8`) is the callee's trusted source hash.
 *
 * A cloned repo therefore runs nothing and raises no card (G-LOOP-01); this module never raises a card at all.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { randomBytes } from 'node:crypto';
import { canonicalJson } from '@a-company/gnomon-contracts';
import { formatLoopIssue, LOOP_CALL_DEPTH_MAX, validateCompiledLoop, type CompiledLoop, type LoopIssue } from '../../loops/index.js';
import { repoKeyOf } from '../supervisor/repo-hooks.js';
import { loopEnvNames } from './loop-env.js';
import { computeLoopHash, createFileHashCache, runPathWords, type ClosureFile, type FileHashCache, type HashContext, type LoopHash } from './hash.js';

export type LoopScopeName = 'repo' | 'personal';
export type LoopState = 'untrusted' | 'trusted' | 'waiting-trust' | 'paused' | 'deleted' | 'invalid';

/** The kernel rows this fold reads (seed kinds for log.read at boot). */
export const LOOP_FOLD_KINDS: readonly string[] = Object.freeze(['loop.trusted', 'loop.untrusted', 'loop.closure.changed', 'loop.paused', 'loop.resumed', 'loop.deleted', 'session.open', 'loop.request', 'loop.budget.tightened']);

/**
 * Step 12 (§3.1 "Attribution"): who authored a loop's current definition. The kernel stamps `{principal, hsid}` from
 * the CONNECTION of an agent's `loop.request{op:'create'|'update', sourceHash}` (agent-ops.ts) and writes it as a
 * kernel row; a definition whose source hash matches no such row is `file` (a git pull, an editor, a postinstall).
 */
export type LoopAuthor = { principal: string; hsid: string | null; at?: string; basis: 'agent-key-claim' } | 'file';

/** The display form of an author: the principal's name ("arky"), or `file`. */
export function authorLabel(a: LoopAuthor): string {
  return a === 'file' ? 'file' : (a.principal.split('/').pop() ?? a.principal);
}
export const LOOP_FILE_SUFFIX = '.loop.json';
export const LOOP_FILE_MAX_BYTES = 1024 * 1024;
export const LOOP_FILES_PER_DIR_MAX = 256;
export const LOOP_REPOS_MAX = 256;
const FILE_RE = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*\.loop\.json$/;
const KEBAB = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const REPO_KEY = /^sha256:[0-9a-f]{64}$/;
const CONTENT_HASH = /^sha256:[0-9a-f]{64}$/;

/** An opaque capability: a trusted loop's run step (the registry's run-reference minter). Its fields are labels; the facts are private. */
export interface LoopRunRef {
  readonly runId: string;
  readonly loopId: string;
  readonly nodeId: string;
}

/** What a live run reference stands for (loopRunRefInfo). */
export interface LoopRunRefInfo {
  key: string;
  loopId: string;
  scope: LoopScopeName;
  repoKey: string;
  repoRoot: string;
  runId: string;
  nodeId: string;
  /** the loop whose budget pays (the root caller) */
  rootKey: string;
  contentHash: string;
  /** who authored the definition (`file` until step 12's request rows) */
  authoredBy: string;
  /** the human who trusted it */
  trustedBy?: string;
  trustCard?: string;
  /** TD-2026-10-23-268 (Aegis F4): the env names the trusted node declares at contentHash (an act step gets no other) */
  nodeEnv: readonly string[];
  released: boolean;
  /** still trusted at the run's hash and runnable now? */
  live(): { ok: true } | { ok: false; reason: string };
}

/** Module-private: only the issued minter mints; a forged object is not a key here. */
const RUN_REFS = new WeakMap<object, LoopRunRefInfo>();

/** The facts behind a run reference, or null for anything the registry did not mint or already released. */
export function loopRunRefInfo(ref: unknown): Readonly<LoopRunRefInfo> | null {
  if (typeof ref !== 'object' || ref === null) return null;
  const i = RUN_REFS.get(ref);
  return i && !i.released ? i : null;
}

export interface LoopRow {
  kind: string;
  principal?: string;
  keyId?: string;
  at?: string;
  payload?: unknown;
}

export interface TrustRecord {
  contentHash: string;
  coreHash?: string;
  closureDigest?: string;
  sourceHash?: string;
  cardId?: string;
  by?: string;
  at?: string;
}

export interface TrustEvent {
  event: 'trusted' | 'untrusted' | 'closure.changed' | 'paused' | 'resumed' | 'deleted';
  loopId: string;
  scope: LoopScopeName;
  repoKey: string;
  contentHash?: string;
  by?: string;
  cardId?: string;
  reason?: string;
  at?: string;
}

interface Fold {
  trusted: TrustRecord | null;
  paused: { reason: string; by?: string; at?: number; epoch: number } | null;
  deleted: { contentHash: string | null } | null;
  /** when the loop last became runnable (the `at` of its latest loop.trusted or loop.resumed row) */
  since?: number;
}

export interface LoopEntry {
  key: string;
  loopId: string;
  scope: LoopScopeName;
  repoKey: string;
  /** the repo the loop runs in (a repo loop's own repo; a personal loop's `repo`) */
  repoRoot: string;
  file: string;
  errors: LoopIssue[];
  /** the re-validated definition, its protected set extended with callees and the config closure */
  compiled?: CompiledLoop;
  /** the parsed file (hashed canonically) */
  parsed?: unknown;
  hash?: LoopHash;
  /** call nodes that cannot resolve now (an untrusted callee, a pin mismatch, a cycle) */
  callIssues: string[];
}

export interface LoopView {
  key: string;
  loopId: string;
  scope: LoopScopeName;
  repo: string;
  repoKey: string;
  file: string;
  title?: string;
  state: LoopState;
  reason?: string;
  contentHash?: string;
  trustedHash?: string;
  trustedBy?: string;
  trustedAt?: string;
  cardId?: string;
  errors: string[];
  callIssues: string[];
  /** step 12: who authored the current definition (a kernel-stamped loop.request row), else `file` */
  authoredBy?: LoopAuthor;
  /**
   * LP8 (#gui-loops): the compiled definition's drawable shape, for the GUI's list and graph (status.loops is the
   * human class's). Ids, types, roles, edges, trigger words, caps and land paths only: never argv, prompts or text.
   */
  shape?: LoopShape;
}

/** LP8: what the GUI draws of a compiled loop (loopShapeOf). */
export interface LoopShape {
  triggers: string[];
  autonomy: string;
  start: string;
  goal?: string;
  land?: string[];
  budgets: { run: Record<string, number | string>; day: Record<string, number | string> };
  authoredBy: string;
  nodes: Array<{ id: string; type: string; role?: string; as?: string; callee?: string; on: Record<string, string> }>;
  /** LP8: the cap fields a human tightened (request.loop.budget), as `run.rounds` */
  tightened?: string[];
}

/** LP8: the shape's caps with a human's tightened ones applied (the lower of each), and which fields were tightened. */
function withTightened(sh: LoopShape, t: TightenedBudgets | null): LoopShape {
  if (!t) return sh;
  const run = { ...sh.budgets.run };
  const day = { ...sh.budgets.day };
  for (const [f, x] of Object.entries(t.run)) if (typeof run[f] !== 'number' || x < (run[f] as number)) run[f] = x;
  for (const [f, x] of Object.entries(t.day)) if (typeof day[f] !== 'number' || x < (day[f] as number)) day[f] = x;
  return { ...sh, budgets: { run, day }, tightened: [...Object.keys(t.run).map((f) => `run.${f}`), ...Object.keys(t.day).map((f) => `day.${f}`)] };
}

/** LP8: the drawable shape of a compiled loop (no argv, prompt or notify text). */
export function loopShapeOf(c: CompiledLoop): LoopShape {
  const trig = c.triggers.map((t) => {
    if (t.type === 'schedule') return t.every !== undefined ? `every ${t.every}s` : t.daily !== undefined ? `daily ${t.daily}` : `weekly ${t.weekly?.day ?? ''} ${t.weekly?.at ?? ''}`.trim();
    if (t.type === 'event') return t.kind === 'file.changed' ? 'on change' : t.kind;
    return 'continuous';
  });
  const pick = (o: Record<string, unknown> | undefined): Record<string, number | string> => {
    const out: Record<string, number | string> = {};
    for (const [k, v] of Object.entries(o ?? {})) if (typeof v === 'number' || typeof v === 'string') out[k] = v;
    return out;
  };
  return {
    triggers: trig,
    autonomy: c.autonomy,
    start: c.start,
    ...(c.goal ? { goal: c.goal.node } : {}),
    ...(c.land ? { land: [...c.land.paths] } : {}),
    budgets: { run: pick(c.budgets.run as unknown as Record<string, unknown>), day: pick(c.budgets.day as unknown as Record<string, unknown>) },
    authoredBy: 'file',
    nodes: c.nodes.map((n) => ({
      id: n.id,
      type: n.type,
      ...(n.type === 'model' ? { role: n.role } : {}),
      ...(n.type === 'check' ? { role: n.effect } : {}),
      ...(n.type === 'notify' ? { as: n.as } : {}),
      ...(n.type === 'call' ? { callee: n.callee } : {}),
      on: { ...n.on },
    })),
  };
}

/** LP8: caps a human tightened (request.loop.budget): positive whole numbers, each only ever lowered. */
export interface TightenedBudgets {
  run: Partial<Record<'rounds' | 'wallMin' | 'tokens' | 'computeSec', number>>;
  day: Partial<Record<'runs' | 'tokens' | 'computeSec', number>>;
}
export const TIGHTEN_FIELDS = Object.freeze({ run: ['rounds', 'wallMin', 'tokens', 'computeSec'], day: ['runs', 'tokens', 'computeSec'] } as const);

/** The closed shape of a tightened-caps object, or null. */
export function parseTightened(v: unknown): TightenedBudgets | null {
  if (!isObj(v)) return null;
  const out: TightenedBudgets = { run: {}, day: {} };
  let n = 0;
  for (const k of Object.keys(v)) if (k !== 'run' && k !== 'day') return null;
  for (const scope of ['run', 'day'] as const) {
    const o = v[scope];
    if (o === undefined) continue;
    if (!isObj(o)) return null;
    for (const [f, x] of Object.entries(o)) {
      if (!(TIGHTEN_FIELDS[scope] as readonly string[]).includes(f) || typeof x !== 'number' || !Number.isSafeInteger(x) || x < 1) return null;
      (out[scope] as Record<string, number>)[f] = x;
      n++;
    }
  }
  return n ? out : null;
}

/** The lower of two tightened sets, field by field. */
export function minTightened(a: TightenedBudgets, b: TightenedBudgets): TightenedBudgets {
  const out: TightenedBudgets = { run: { ...a.run }, day: { ...a.day } };
  for (const scope of ['run', 'day'] as const) for (const [f, x] of Object.entries(b[scope])) {
    const cur = (out[scope] as Record<string, number | undefined>)[f];
    (out[scope] as Record<string, number>)[f] = cur === undefined ? x : Math.min(cur, x);
  }
  return out;
}

export interface LoopRegistryOptions {
  /** the Gnomon home; the personal loops dir is `<home>/loops` unless `personalDir` says otherwise */
  home: string;
  personalDir?: string;
  kernelPrincipal: string;
  /** a row counts only when signed by a kernel key (absent ⇒ the principal check alone) */
  isKernelKey?: (keyId: string) => boolean;
  /** append a kernel row; the committed row comes back through observe() */
  append: (kind: string, payload: Record<string, unknown>) => Promise<void>;
  /** hashing inputs (the runner's node and PATH); tests pin them */
  hash?: Pick<HashContext, 'execPath' | 'pathDirs' | 'platform'>;
  /**
   * Verify a loop.trusted row's root signature (the root authority's verifyRow); given, a row whose rootSig does not
   * verify over the signed row is ignored. Absent: the kernel principal and key checks alone.
   */
  verifyRootRow?: (signer: string, row: unknown, sigB64: string) => boolean;
  /** the trusted version's closure files (for the changed-file list); default the snapshot store in <home>/loop-trust */
  trustedClosure?: (contentHash: string) => ClosureFile[] | null;
  diag?: (event: string, data: Record<string, unknown>) => void;
  /** rescan period (ms); 0 = no timer. Default 30 s. */
  rescanMs?: number;
  /** watch the loop dirs (default true) */
  watch?: boolean;
  platform?: NodeJS.Platform;
  uid?: number;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);
/** The repo-relative closure files that differ between two listings (all of `now` when the old one is unknown). */
export function closureChanges(before: readonly ClosureFile[] | null, now: readonly ClosureFile[]): string[] {
  if (before === null) return now.map((x) => x.rel).sort();
  const was = new Map(before.map((x) => [x.rel, x.sha256]));
  const is = new Map(now.map((x) => [x.rel, x.sha256]));
  return [...new Set([...was.keys(), ...is.keys()])].filter((k) => was.get(k) !== is.get(k)).sort();
}

export const loopKeyOf = (scope: string, repoKey: string, loopId: string): string => `${scope}/${repoKey}/${loopId}`;

/** The repo root a session folder belongs to: the nearest ancestor holding `.git` or `.paradigm`, else the folder. */
export function repoRootOf(cwd: string): string {
  let d = path.resolve(cwd);
  for (let i = 0; i < 64; i++) {
    for (const marker of ['.git', '.paradigm']) {
      try {
        fs.lstatSync(path.join(d, marker));
        return d;
      } catch {
        /* keep walking */
      }
    }
    const up = path.dirname(d);
    if (up === d) break;
    d = up;
  }
  return path.resolve(cwd);
}

/** The trusted-version snapshots (`<home>/loop-trust/<hex>.json`, 0600 in a 0700 dir): the card's lines and closure. */
export interface LoopSnapshot {
  loopId: string;
  scope: LoopScopeName;
  repoKey: string;
  contentHash: string;
  closure: ClosureFile[];
  /** the definition lines the trust card showed (the diff base of the next card) */
  lines: string[];
}

export class LoopSnapshots {
  readonly #dir: string;
  constructor(home: string) {
    this.#dir = path.join(home, 'loop-trust');
  }
  #file(contentHash: string): string | null {
    return CONTENT_HASH.test(contentHash) ? path.join(this.#dir, `${contentHash.slice('sha256:'.length)}.json`) : null;
  }
  read(contentHash: string): LoopSnapshot | null {
    const f = this.#file(contentHash);
    if (!f) return null;
    try {
      const st = fs.lstatSync(f);
      if (!st.isFile() || st.size > LOOP_FILE_MAX_BYTES) return null;
      const v = JSON.parse(fs.readFileSync(f, 'utf8')) as LoopSnapshot;
      return isObj(v) && v.contentHash === contentHash && Array.isArray(v.lines) && Array.isArray(v.closure) ? v : null;
    } catch {
      return null;
    }
  }
  write(s: LoopSnapshot): void {
    const f = this.#file(s.contentHash);
    if (!f) return;
    fs.mkdirSync(this.#dir, { recursive: true, mode: 0o700 });
    const st = fs.lstatSync(this.#dir);
    if (st.isSymbolicLink() || !st.isDirectory()) throw new Error('#loop-registry: the loop-trust dir is not a real directory');
    const tmp = `${f}.tmp-${process.pid}-${randomBytes(6).toString('hex')}`;
    fs.writeFileSync(tmp, `${JSON.stringify(s)}\n`, { mode: 0o600, flag: 'wx' });
    fs.renameSync(tmp, f);
  }
}

export class LoopRegistry {
  readonly #o: LoopRegistryOptions;
  readonly #cache: FileHashCache = createFileHashCache();
  readonly #repos = new Map<string, string>(); // repoKey → realpath root
  readonly #entries = new Map<string, LoopEntry>();
  readonly #folds = new Map<string, Fold>();
  /** step 12: loop key → source hash → the agent that authored it (kernel-stamped loop.request rows) */
  readonly #authored = new Map<string, Map<string, { principal: string; hsid: string | null; at?: string; basis: 'agent-key-claim' }>>();
  /** step 12 (Aegis): kill-switch epochs folded so far; a pause records the epoch it was made in */
  #killEpoch = 0;
  /** LP8: tightened caps per loop key, for one content hash (loop.budget.tightened) */
  readonly #tightened = new Map<string, { contentHash: string; budgets: TightenedBudgets }>();
  readonly #history: TrustEvent[] = [];
  readonly #pending = new Set<string>();
  readonly #watchers = new Map<string, { close(): void }>();
  readonly #dirIssues = new Map<string, string>();
  readonly #snapshots: LoopSnapshots;
  #timer: NodeJS.Timeout | null = null;
  #closed = false;
  readonly #listeners = new Set<() => void>();

  constructor(o: LoopRegistryOptions) {
    this.#o = o;
    this.#snapshots = new LoopSnapshots(o.home);
  }

  get snapshots(): LoopSnapshots {
    return this.#snapshots;
  }

  get personalDir(): string {
    return this.#o.personalDir ?? path.join(this.#o.home, 'loops');
  }

  // ── Repos ────────────────────────────────────────────────────────────────────

  /** Know a repo (its root is realpath'd); returns its repo key. The oldest falls out past LOOP_REPOS_MAX. */
  addRepo(root: string): string | null {
    let real: string;
    try {
      real = fs.realpathSync.native(root);
      if (!fs.statSync(real).isDirectory()) return null;
    } catch {
      return null;
    }
    const key = repoKeyOf([real]);
    if (!this.#repos.has(key)) {
      this.#repos.set(key, real);
      while (this.#repos.size > LOOP_REPOS_MAX) {
        const old = this.#repos.keys().next().value as string;
        this.#repos.delete(old);
        this.#unwatch(old);
      }
      if (!this.#closed && this.#timer) this.#watchRepo(key, real);
    }
    return key;
  }

  repos(): Array<{ repoKey: string; root: string }> {
    return [...this.#repos].map(([repoKey, root]) => ({ repoKey, root }));
  }

  // ── The fold ─────────────────────────────────────────────────────────────────

  seed(rows: Iterable<LoopRow>): void {
    for (const r of rows) this.observe(r);
  }

  /**
   * Called after every scan and every folded trust row (#loop-timers reconciles its timers here). A listener must
   * not throw; one that does is reported and skipped.
   */
  onChange(fn: () => void): () => void {
    this.#listeners.add(fn);
    return () => this.#listeners.delete(fn);
  }

  #changed(): void {
    for (const fn of [...this.#listeners]) {
      try {
        fn();
      } catch (err) {
        this.#o.diag?.('loops.listener-failed', { why: err instanceof Error ? err.message.slice(0, 200) : 'listener failed' });
      }
    }
  }

  /** When the loop last became runnable (ms; its latest trusted or resumed row), or null when unknown. */
  runnableSince(key: string): number | null {
    return this.#folds.get(key)?.since ?? null;
  }

  /** One committed row. Only the kernel's own rows count (LL6); a malformed row is ignored. */
  observe(r: LoopRow): void {
    if (r.principal !== this.#o.kernelPrincipal) return;
    if (this.#o.isKernelKey && (typeof r.keyId !== 'string' || !this.#o.isKernelKey(r.keyId))) return;
    const p = r.payload;
    if (!isObj(p)) return;
    if (r.kind === 'session.open') {
      const cwd = str(p.cwd);
      if (cwd && path.isAbsolute(cwd)) this.addRepo(repoRootOf(cwd));
      return;
    }
    if (!LOOP_FOLD_KINDS.includes(r.kind)) return;
    if (r.kind === 'loop.paused' && p.all === true) {
      // step 12 (Aegis): ONE kill-epoch row per kill switch covers every loop, trusted, paused or untrusted
      this.#killEpoch++;
      this.#changed();
      return;
    }
    const loopId = str(p.loopId);
    const scope = p.scope === 'repo' || p.scope === 'personal' ? p.scope : undefined;
    const repoKey = str(p.repoKey);
    if (!loopId || !KEBAB.test(loopId) || !scope || !repoKey || !REPO_KEY.test(repoKey)) return;
    const key = loopKeyOf(scope, repoKey, loopId);
    if (r.kind === 'loop.budget.tightened') {
      // LP8: a human's tightened caps hold for the content hash they were set on (a changed loop starts from its file)
      const contentHash = str(p.contentHash);
      const b = parseTightened(p.budgets);
      if (!contentHash || !CONTENT_HASH.test(contentHash) || !b) return;
      const prev = this.#tightened.get(key);
      this.#tightened.set(key, { contentHash, budgets: prev && prev.contentHash === contentHash ? minTightened(prev.budgets, b) : b });
      this.#changed();
      return;
    }
    if (r.kind === 'loop.request') {
      // step 12: only the kernel's own request rows (stamped from the connection) attribute a definition
      const sourceHash = str(p.sourceHash);
      const by = str(p.by);
      if ((p.op !== 'create' && p.op !== 'update') || !sourceHash || !/^[0-9a-f]{64}$/.test(sourceHash) || !by) return;
      const authored = this.#authored.get(key) ?? new Map<string, { principal: string; hsid: string | null; at?: string; basis: 'agent-key-claim' }>();
      authored.delete(sourceHash);
      authored.set(sourceHash, { principal: by, hsid: str(p.hsid) ?? null, ...(r.at ? { at: r.at } : {}), basis: 'agent-key-claim' });
      if (authored.size > 16) authored.delete(authored.keys().next().value!);
      this.#authored.set(key, authored);
      this.#changed();
      return;
    }
    const f = this.#fold(key);
    const contentHash = str(p.contentHash);
    const ev: TrustEvent = { event: r.kind.slice('loop.'.length) as TrustEvent['event'], loopId, scope, repoKey, ...(contentHash ? { contentHash } : {}), ...(str(p.by) ? { by: str(p.by)! } : {}), ...(str(p.cardId) ? { cardId: str(p.cardId)! } : {}), ...(str(p.reason) ? { reason: str(p.reason)! } : {}), ...(r.at ? { at: r.at } : {}) };
    switch (r.kind) {
      case 'loop.trusted': {
        if (!contentHash || !CONTENT_HASH.test(contentHash)) return;
        if (this.#o.verifyRootRow) {
          const sig = isObj(p.rootSig) ? p.rootSig : null;
          const { rootSig: _r, ...signed } = p;
          if (!sig || typeof sig.signer !== 'string' || typeof sig.sig !== 'string' || !this.#o.verifyRootRow(sig.signer, { kind: 'loop.trusted', ...signed }, sig.sig)) return;
        }
        f.trusted = { contentHash, ...(str(p.coreHash) ? { coreHash: str(p.coreHash)! } : {}), ...(str(p.closureDigest) ? { closureDigest: str(p.closureDigest)! } : {}), ...(str(p.sourceHash) ? { sourceHash: str(p.sourceHash)! } : {}), ...(str(p.cardId) ? { cardId: str(p.cardId)! } : {}), ...(str(p.by) ? { by: str(p.by)! } : {}), ...(r.at ? { at: r.at } : {}) };
        if (f.paused && (f.paused.reason === 'content-changed' || f.paused.reason === 'closure-changed')) f.paused = null;
        f.deleted = null;
        if (r.at && Number.isFinite(Date.parse(r.at))) f.since = Date.parse(r.at);
        break;
      }
      case 'loop.untrusted':
        f.trusted = null;
        break;
      case 'loop.closure.changed':
        // recorded only: trust moves to a new closure only through a new loop.trusted row (Aegis LP2 #1)
        break;
      case 'loop.paused':
        f.paused = { reason: str(p.reason) ?? 'human', ...(str(p.by) ? { by: str(p.by)! } : {}), ...(r.at && Number.isFinite(Date.parse(r.at)) ? { at: Date.parse(r.at) } : {}), epoch: this.#killEpoch };
        break;
      case 'loop.resumed':
        f.paused = null;
        if (r.at && Number.isFinite(Date.parse(r.at))) f.since = Date.parse(r.at);
        break;
      case 'loop.deleted':
        f.trusted = null;
        f.deleted = { contentHash: contentHash ?? null };
        break;
    }
    for (const k of [...this.#pending]) if (k.startsWith(`${key}#`) && k.endsWith(`#${r.kind}`)) this.#pending.delete(k);
    this.#history.push(ev);
    if (this.#history.length > 4096) this.#history.splice(0, this.#history.length - 4096);
    this.#changed();
  }

  #fold(key: string): Fold {
    let f = this.#folds.get(key);
    if (!f) {
      f = { trusted: null, paused: null, deleted: null };
      this.#folds.set(key, f);
    }
    return f;
  }

  /** LP8: the caps a human tightened for this loop's current content hash, or null. */
  tightenedBudgets(key: string, contentHash: string | undefined): TightenedBudgets | null {
    const t = this.#tightened.get(key);
    return t && contentHash && t.contentHash === contentHash ? t.budgets : null;
  }

  trustOf(key: string): TrustRecord | null {
    return this.#folds.get(key)?.trusted ?? null;
  }

  /** The loop's pause as folded (reason and who), or null. Step 12: an agent resumes only its own `agent` pause. */
  /** How many kill switches the log holds (each `loop.paused{all:true}` row is one epoch). */
  killEpoch(): number {
    return this.#killEpoch;
  }

  pauseOf(key: string): { reason: string; by?: string; at?: number; epoch: number } | null {
    const p = this.#folds.get(key)?.paused;
    return p ? { ...p } : null;
  }

  /**
   * Step 12 (§3.1): who authored this entry's CURRENT definition. A kernel request row whose sourceHash is the
   * compiled definition's source hash names the agent (principal and hsid from its connection); anything else is
   * `file`. An authored row never trusts anything: it only attributes.
   */
  authoredBy(e: LoopEntry): LoopAuthor {
    const source = e.compiled?.compiled.sourceHash;
    const a = source ? this.#authored.get(e.key)?.get(source) : undefined;
    return a ? { ...a } : 'file';
  }

  /** Every trust event, oldest first (who trusted which hash and when). */
  history(): TrustEvent[] {
    return [...this.#history];
  }

  // ── Scanning ─────────────────────────────────────────────────────────────────

  /** Rescan every known repo and the personal dir, then apply the change rules. */
  scan(): void {
    if (this.#closed) return;
    const next = new Map<string, LoopEntry>();
    for (const [repoKey, root] of this.#repos) for (const e of this.#readRepo(repoKey, root)) next.set(e.key, e);
    for (const e of this.#readPersonal()) next.set(e.key, e);
    this.#entries.clear();
    for (const [k, e] of next) this.#entries.set(k, e);
    this.#hashAll();
    for (const e of this.#entries.values()) this.#detectChange(e);
    this.#changed();
  }

  /** Recompute now (the runner calls this before every run and every node) and return the entry, or null. */
  verify(key: string): LoopEntry | null {
    this.scan();
    return this.#entries.get(key) ?? null;
  }

  #issue(dir: string, why: string): void {
    if (this.#dirIssues.get(dir) !== why) this.#o.diag?.('loops.dir-refused', { dir, why });
    this.#dirIssues.set(dir, why);
  }

  /** Real directory (never a symlink); null when absent; a string is the refusal. */
  #realDir(p: string): 'absent' | 'ok' | string {
    let st: fs.Stats;
    try {
      st = fs.lstatSync(p);
    } catch {
      return 'absent';
    }
    if (st.isSymbolicLink()) return 'a symlink';
    if (!st.isDirectory()) return 'not a directory';
    return 'ok';
  }

  #readRepo(repoKey: string, root: string): LoopEntry[] {
    const paradigm = path.join(root, '.paradigm');
    const dir = path.join(paradigm, 'loops');
    for (const d of [paradigm, dir]) {
      const r = this.#realDir(d);
      if (r === 'absent') return [];
      if (r !== 'ok') {
        this.#issue(d, r);
        return [];
      }
    }
    try {
      if (fs.realpathSync.native(dir) !== path.join(root, '.paradigm', 'loops')) {
        this.#issue(dir, 'resolves outside the repo');
        return [];
      }
    } catch {
      return [];
    }
    this.#dirIssues.delete(dir);
    return this.#readDir(dir, 'repo', () => ({ repoKey, root }));
  }

  #readPersonal(): LoopEntry[] {
    const dir = this.personalDir;
    const r = this.#realDir(dir);
    if (r === 'absent') return [];
    if (r !== 'ok') {
      this.#issue(dir, r);
      return [];
    }
    if ((this.#o.platform ?? process.platform) !== 'win32') {
      const st = fs.lstatSync(dir);
      if ((st.mode & 0o022) !== 0) {
        this.#issue(dir, 'group- or world-writable (personal loops live in a 0700 dir)');
        return [];
      }
      const uid = this.#o.uid ?? (typeof process.getuid === 'function' ? process.getuid() : undefined);
      if (uid !== undefined && st.uid !== uid) {
        this.#issue(dir, "owned by another user");
        return [];
      }
    }
    this.#dirIssues.delete(dir);
    return this.#readDir(dir, 'personal', (c) => {
      if (!c?.repo) return null;
      const root = repoRootOf(c.repo);
      let real = root;
      try {
        real = fs.realpathSync.native(root);
      } catch {
        /* the repo is gone: hashed against the named path (argv files show as missing) */
      }
      return { repoKey: repoKeyOf([real]), root: real };
    });
  }

  #readDir(dir: string, scope: LoopScopeName, repoOf: (c: CompiledLoop | undefined) => { repoKey: string; root: string } | null): LoopEntry[] {
    let names: string[];
    try {
      names = fs.readdirSync(dir).filter((n) => n.endsWith(LOOP_FILE_SUFFIX)).sort();
    } catch {
      return [];
    }
    if (names.length > LOOP_FILES_PER_DIR_MAX) {
      this.#issue(dir, `more than ${LOOP_FILES_PER_DIR_MAX} loops`);
      names = names.slice(0, LOOP_FILES_PER_DIR_MAX);
    }
    const out: LoopEntry[] = [];
    for (const name of names) {
      const file = path.join(dir, name);
      const loopId = name.slice(0, -LOOP_FILE_SUFFIX.length);
      const bad = (code: string, message: string): void => {
        const repo = repoOf(undefined);
        // a personal loop that cannot be read has no repo: keyed under the personal dir itself
        const where = repo ?? { repoKey: repoKeyOf([dir]), root: dir };
        out.push({ key: loopKeyOf(scope, where.repoKey, loopId), loopId, scope, repoKey: where.repoKey, repoRoot: where.root, file, errors: [{ path: '', code, message }], callIssues: [] });
      };
      if (!FILE_RE.test(name)) {
        this.#issue(file, 'not a kebab-case <id>.loop.json name');
        continue;
      }
      let st: fs.Stats;
      try {
        st = fs.lstatSync(file);
      } catch {
        continue;
      }
      if (st.isSymbolicLink()) {
        bad('SYMLINK', 'a loop file is a regular file, never a symlink');
        continue;
      }
      if (!st.isFile()) {
        bad('NOT_A_FILE', 'not a regular file');
        continue;
      }
      if (st.size > LOOP_FILE_MAX_BYTES) {
        bad('TOO_LARGE', `larger than ${LOOP_FILE_MAX_BYTES} bytes`);
        continue;
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
      } catch {
        bad('BAD_JSON', 'not JSON');
        continue;
      }
      const v = validateCompiledLoop(parsed, { scope, fileId: loopId });
      if (!v.ok || !v.compiled) {
        bad(v.errors[0]?.code ?? 'INVALID', v.errors.map(formatLoopIssue).slice(0, 8).join('; '));
        out.at(-1)!.errors = v.errors;
        continue;
      }
      const repo = repoOf(v.compiled);
      if (!repo) {
        bad('REQUIRED', 'a personal loop names its repo');
        continue;
      }
      out.push({ key: loopKeyOf(scope, repo.repoKey, loopId), loopId, scope, repoKey: repo.repoKey, repoRoot: repo.root, file, errors: [], compiled: v.compiled, parsed, callIssues: [] });
    }
    return out;
  }

  /** Callees of an entry: same scope; a repo loop's callee is in the same repo. */
  #calleeOf(e: LoopEntry, id: string): LoopEntry | undefined {
    if (e.scope === 'repo') return this.#entries.get(loopKeyOf('repo', e.repoKey, id));
    return [...this.#entries.values()].find((x) => x.scope === 'personal' && x.loopId === id && x.compiled);
  }

  #hashAll(): void {
    const memo = new Map<string, string | null>();
    const visiting = new Set<string>();
    const hashOf = (e: LoopEntry, depth: number): string | null => {
      if (memo.has(e.key)) return memo.get(e.key)!;
      if (!e.compiled) {
        memo.set(e.key, null);
        return null;
      }
      if (visiting.has(e.key)) {
        e.callIssues.push('call cycle');
        return null;
      }
      visiting.add(e.key);
      const ctx: HashContext = { repoRoot: e.repoRoot, cache: this.#cache, ...(this.#o.hash ?? {}) };
      const h = computeLoopHash(e.parsed, e.compiled, ctx, (callee) => {
        const c = this.#calleeOf(e, callee);
        if (!c) return null;
        if (depth + 1 > LOOP_CALL_DEPTH_MAX) {
          e.callIssues.push(`call depth exceeds ${LOOP_CALL_DEPTH_MAX} at ${callee}`);
          return null;
        }
        return hashOf(c, depth + 1);
      });
      visiting.delete(e.key);
      e.hash = h;
      // the kernel's protected set: own + every callee's (transitively) + the config closure
      const prot = new Set<string>(e.compiled.protected);
      for (const w of runPathWords(e.compiled)) prot.add(w);
      for (const f of h.closure.all) prot.add(f.rel);
      for (const c of h.calls) {
        const ce = this.#calleeOf(e, c.callee);
        if (ce?.compiled) for (const x of ce.compiled.protected) prot.add(x);
      }
      e.compiled = { ...e.compiled, protected: [...prot].sort() };
      memo.set(e.key, h.contentHash);
      return h.contentHash;
    };
    for (const e of this.#entries.values()) hashOf(e, 0);
    // call issues that need the trust fold: an untrusted callee or a pin that is not the trusted callee's
    for (const e of this.#entries.values()) {
      if (!e.compiled) continue;
      for (const n of e.compiled.nodes) {
        if (n.type !== 'call') continue;
        const r = this.#resolve(e, n.id);
        if (!r.ok) e.callIssues.push(`${n.id}: ${r.reason}`);
      }
      e.callIssues = [...new Set(e.callIssues)];
    }
  }

  // ── State ────────────────────────────────────────────────────────────────────

  stateOf(e: LoopEntry): { state: LoopState; reason?: string } {
    const f = this.#folds.get(e.key);
    const current = e.hash?.contentHash;
    if (f?.deleted && (f.deleted.contentHash === null || f.deleted.contentHash === current)) return { state: 'deleted' };
    if (!e.compiled || !current) return { state: 'invalid', reason: e.errors[0]?.code ?? 'INVALID' };
    if (!f?.trusted) return { state: 'untrusted' };
    if (f.trusted.contentHash !== current) return { state: 'waiting-trust', reason: f.paused?.reason ?? (f.trusted.coreHash === e.hash?.coreHash ? 'closure-changed' : 'content-changed') };
    if (f.paused) return { state: 'paused', reason: f.paused.reason };
    return { state: 'trusted' };
  }

  #write(key: string, hash: string, kind: string, payload: Record<string, unknown>): void {
    const tag = `${key}#${hash}#${kind}`;
    if (this.#pending.has(tag)) return;
    this.#pending.add(tag);
    this.#o.append(kind, payload).catch((err: unknown) => {
      this.#pending.delete(tag);
      this.#o.diag?.('loops.append-failed', { kind, why: err instanceof Error ? err.message.slice(0, 200) : 'append failed' });
    });
  }

  /** A trusted loop whose hash moved: one pause (content), or the closure rule (§3.1). */
  #detectChange(e: LoopEntry): void {
    const f = this.#folds.get(e.key);
    const h = e.hash;
    if (!f?.trusted || !h || f.trusted.contentHash === h.contentHash) return;
    if (f.paused && (f.paused.reason === 'content-changed' || f.paused.reason === 'closure-changed')) return;
    const ids = { loopId: e.loopId, scope: e.scope, repoKey: e.repoKey };
    const closureOnly = f.trusted.coreHash !== undefined && f.trusted.coreHash === h.coreHash;
    if (closureOnly) {
      // Aegis LP2 #1: EVERY closure change pauses, whoever made it: commit authorship and trailers are forgeable by
      // an agent, so the kernel never asks git who landed it. The human re-trusts through the closure-only card.
      // TODO(loops step 11): exempt changes whose commit sha is in the kernel-recorded set of human-attended commits.
      const before = this.#o.trustedClosure ? this.#o.trustedClosure(f.trusted.contentHash) : (this.#snapshots.read(f.trusted.contentHash)?.closure ?? null);
      const changed = closureChanges(before, h.closure.all);
      this.#write(e.key, h.contentHash, 'loop.closure.changed', { ...ids, digest: h.closure.digest, contentHash: h.contentHash, coreHash: h.coreHash, files: changed.slice(0, 64) });
      this.#write(e.key, h.contentHash, 'loop.paused', { ...ids, contentHash: h.contentHash, trustedHash: f.trusted.contentHash, reason: 'closure-changed', by: 'kernel' });
      return;
    }
    this.#write(e.key, h.contentHash, 'loop.paused', { ...ids, contentHash: h.contentHash, trustedHash: f.trusted.contentHash, reason: 'content-changed', by: 'kernel' });
  }

  // ── Reads ────────────────────────────────────────────────────────────────────

  entries(): LoopEntry[] {
    return [...this.#entries.values()];
  }

  entry(key: string): LoopEntry | null {
    return this.#entries.get(key) ?? null;
  }

  /** Find by id: a repo loop needs its repo key; a personal loop's id is unique in the personal dir. */
  find(loopId: string, scope: LoopScopeName, repoKey?: string): LoopEntry | null {
    if (scope === 'repo') return repoKey ? (this.#entries.get(loopKeyOf('repo', repoKey, loopId)) ?? null) : null;
    return [...this.#entries.values()].find((e) => e.scope === 'personal' && e.loopId === loopId && (!repoKey || e.repoKey === repoKey)) ?? null;
  }

  view(e: LoopEntry): LoopView {
    const s = this.stateOf(e);
    const t = this.#folds.get(e.key)?.trusted;
    return {
      key: e.key, loopId: e.loopId, scope: e.scope, repo: e.repoRoot, repoKey: e.repoKey, file: e.file,
      ...(e.compiled?.title ? { title: e.compiled.title } : {}),
      state: s.state, ...(s.reason ? { reason: s.reason } : {}),
      ...(e.hash ? { contentHash: e.hash.contentHash } : {}),
      ...(t ? { trustedHash: t.contentHash, ...(t.by ? { trustedBy: t.by } : {}), ...(t.at ? { trustedAt: t.at } : {}), ...(t.cardId ? { cardId: t.cardId } : {}) } : {}),
      errors: e.errors.map(formatLoopIssue),
      callIssues: [...e.callIssues],
      authoredBy: this.authoredBy(e),
      ...(e.compiled ? { shape: withTightened({ ...loopShapeOf(e.compiled), authoredBy: authorLabel(this.authoredBy(e)) }, this.tightenedBudgets(e.key, e.hash?.contentHash)) } : {}),
    };
  }

  list(): LoopView[] {
    return this.entries().map((e) => this.view(e)).sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  }

  /** May this loop run now? (trusted at its current hash, no pause) */
  canRun(key: string): { ok: true } | { ok: false; reason: string } {
    const e = this.#entries.get(key);
    if (!e) return { ok: false, reason: 'no such loop' };
    const s = this.stateOf(e);
    return s.state === 'trusted' ? { ok: true } : { ok: false, reason: s.reason ? `${s.state} (${s.reason})` : s.state };
  }

  #resolve(e: LoopEntry, nodeId: string): { ok: true; callee: LoopEntry; contentHash: string } | { ok: false; reason: string } {
    const n = e.compiled?.nodes.find((x) => x.id === nodeId);
    if (!n || n.type !== 'call') return { ok: false, reason: 'not a call node' };
    const c = this.#calleeOf(e, n.callee);
    if (!c || !c.compiled || !c.hash) return { ok: false, reason: `no loop ${n.callee} in this scope` };
    const s = this.stateOf(c);
    if (s.state !== 'trusted') return { ok: false, reason: `${n.callee} is ${s.state}, not trusted` };
    const t = this.#folds.get(c.key)!.trusted!;
    const source = t.sourceHash ?? c.compiled.compiled.sourceHash;
    if (!source || !source.startsWith(n.hash8)) return { ok: false, reason: `the pin ${n.loop} is not ${n.callee}'s trusted hash${source ? ` (${n.callee}@${source.slice(0, 8)})` : ''}` };
    return { ok: true, callee: c, contentHash: c.hash.contentHash };
  }

  /**
   * The runner's call check (before a call node runs): the callee is in the same scope (and repo), TRUSTED at its
   * current hash, and the pin names its trusted source hash. Recomputes first.
   */
  resolveCall(callerKey: string, nodeId: string): { ok: true; calleeKey: string; contentHash: string } | { ok: false; reason: string } {
    const e = this.verify(callerKey);
    if (!e) return { ok: false, reason: 'no such loop' };
    const r = this.#resolve(e, nodeId);
    return r.ok ? { ok: true, calleeKey: r.callee.key, contentHash: r.contentHash } : r;
  }

  /** Aegis F6: what a call node's callee hands its children (its current definition), or null (no callee). */
  calleeEnv(callerKey: string, nodeId: string): { names: string[]; envFiles: string[]; network: boolean } | null {
    const e = this.#entries.get(callerKey);
    const n = e?.compiled?.nodes.find((x) => x.id === nodeId);
    if (!e || !n || n.type !== 'call') return null;
    const c = this.#calleeOf(e, n.callee);
    return c?.compiled ? { names: loopEnvNames(c.compiled), envFiles: [...(c.compiled.envFiles ?? [])], network: c.compiled.network === 'on' } : null;
  }

  #minterIssued = false;

  /**
   * Step 8 (§3.4, §3.6; Aegis step-8 #2): the run-reference minter, issued ONCE to its holder (the runner, at its first
   * model step); a second issue throws, so there is no public mint. The holder's `vouch(key, p)` must confirm the step
   * (the run is live, the node is a judge, summarize or act node of that loop, rootKey is the walk's real root) and
   * `extra()` adds its own holds (strictness pause, kill switch) to the reference's live() check. A reference is minted
   * only for a loop TRUSTED at its current hash and runnable now; it is an opaque, frozen object whose facts live in a
   * module-private table (loopRunRefInfo). The holder releases it when the step ends; a released reference opens
   * nothing.
   */
  issueRunRefMinter(o: { vouch: (key: string, p: { runId: string; nodeId: string; rootKey: string }) => string | null; hold: (key: string) => string | null }): {
    mint(key: string, p: { runId: string; nodeId: string; rootKey: string }): LoopRunRef | null;
    release(ref: LoopRunRef): void;
  } {
    if (this.#minterIssued) throw new Error('#loop-registry: the run-reference minter was already issued');
    this.#minterIssued = true;
    return {
      mint: (key, p) => (o.vouch(key, p) === null ? this.#mintRunRef(key, p, o.hold) : null),
      release: (ref) => {
        const i = RUN_REFS.get(ref);
        if (i) i.released = true;
      },
    };
  }

  #mintRunRef(key: string, p: { runId: string; nodeId: string; rootKey: string }, hold: (key: string) => string | null): LoopRunRef | null {
    const e = this.verify(key);
    if (!e || !e.hash || !this.canRun(key).ok || hold(key) !== null) return null;
    const node = e.compiled?.nodes.find((n) => n.id === p.nodeId);
    // step 10: act steps too (LocalLane.openLoop then requires the run's live scratch and the clamp's tools)
    if (!node || node.type !== 'model' || (node.role !== 'judge' && node.role !== 'summarize' && node.role !== 'act')) return null;
    const contentHash = e.hash.contentHash;
    const t = this.#folds.get(key)?.trusted;
    const ref: LoopRunRef = Object.freeze({ runId: p.runId, loopId: e.loopId, nodeId: p.nodeId });
    RUN_REFS.set(ref, {
      key, loopId: e.loopId, scope: e.scope, repoKey: e.repoKey, repoRoot: e.repoRoot, runId: p.runId, nodeId: p.nodeId, rootKey: p.rootKey, contentHash,
      // attribution comes from the kernel's request rows (step 12); until then a definition with no request row is `file` (§3.1)
      authoredBy: authorLabel(this.authoredBy(e)), ...(t?.by ? { trustedBy: t.by } : {}), ...(t?.cardId ? { trustCard: t.cardId } : {}),
      nodeEnv: Object.freeze([...(node.env ?? [])]),
      released: false,
      live: () => {
        const now = this.verify(key);
        const can = this.canRun(key);
        if (!now || !can.ok) return { ok: false, reason: can.ok ? 'the loop is gone' : can.reason };
        if (now.hash?.contentHash !== contentHash) return { ok: false, reason: 'the loop changed since the run started' };
        const held = hold(key);
        return held === null ? { ok: true } : { ok: false, reason: held };
      },
    });
    return ref;
  }

  /** status.loops (the human class): every loop, the count waiting for trust, refused dirs. */
  status(): Record<string, unknown> {
    const loops = this.list();
    return {
      loops,
      waitingTrust: { n: loops.filter((l) => l.state === 'waiting-trust').length, of: loops.length },
      trusted: { n: loops.filter((l) => l.state === 'trusted').length, of: loops.length },
      repos: { n: this.#repos.size, of: LOOP_REPOS_MAX },
      ...(this.#dirIssues.size ? { refused: [...this.#dirIssues].map(([dir, why]) => ({ dir, why })) } : {}),
      trustStatus: this.history().filter((h) => h.event === 'trusted' || h.event === 'untrusted' || h.event === 'deleted' || h.event === 'closure.changed').slice(-200),
    };
  }

  // ── Watch and timer ──────────────────────────────────────────────────────────

  start(): void {
    if (this.#closed || this.#timer) return;
    const ms = this.#o.rescanMs ?? 30_000;
    this.#timer = setInterval(() => this.#safeScan(), ms > 0 ? ms : 2 ** 30);
    this.#timer.unref();
    if (this.#o.watch !== false) {
      for (const [k, root] of this.#repos) this.#watchRepo(k, root);
      this.#watch('personal', this.personalDir);
    }
    this.#safeScan();
  }

  #safeScan(): void {
    try {
      this.scan();
    } catch (err) {
      this.#o.diag?.('loops.scan-failed', { why: err instanceof Error ? err.message.slice(0, 200) : 'scan failed' });
    }
  }

  #watchRepo(repoKey: string, root: string): void {
    if (this.#o.watch === false) return;
    this.#watch(repoKey, path.join(root, '.paradigm', 'loops'));
  }

  #watch(id: string, dir: string): void {
    if (this.#watchers.has(id) || this.#realDir(dir) !== 'ok') return;
    let t: NodeJS.Timeout | undefined;
    try {
      const w = fs.watch(dir, { persistent: false }, () => {
        clearTimeout(t);
        t = setTimeout(() => this.#safeScan(), 250);
        t.unref();
      });
      w.on('error', () => undefined);
      this.#watchers.set(id, { close: () => { clearTimeout(t); w.close(); } });
    } catch {
      /* no watch: the timer still rescans */
    }
  }

  #unwatch(id: string): void {
    this.#watchers.get(id)?.close();
    this.#watchers.delete(id);
  }

  close(): void {
    this.#closed = true;
    this.#listeners.clear();
    if (this.#timer) clearInterval(this.#timer);
    this.#timer = null;
    for (const id of [...this.#watchers.keys()]) this.#unwatch(id);
  }

  /** A stable digest of the registry's view (tests, diagnostics). */
  digest(): string {
    return canonicalJson(this.list());
  }
}
