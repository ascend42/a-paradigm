/**
 * @symbol #loop-land
 * @symbol #loop-runner
 *
 * #loop-land, the land step's orchestration (docs/specs/gnomon-loops.md §3.2 "Landing", "Conflicts", "Commits",
 * "Revert signals", §3.3 effective autonomy at land; build plan step 11, LP6b). The git and file mechanics are
 * kernel/git/land.ts (`landCommit`); this module decides WHETHER and WHEN, and writes the rows.
 *
 * Two ways in (the 8.0 policy, from the spec):
 *   - **auto**: a run of an `act` loop whose effective autonomy is still `act` at land (L0, or L1 for a change with no
 *     gate-class path), that reached `@goal` on its check, has a `land` block, `decide` other than `before-land`, every
 *     changed path inside `land.paths`, no land hazard (G-LOOP-23: protected input, tracked deletion, suppression
 *     marker, execution surface, unscanned diff) and no gate-class path. Anything else proposes (the runner's card).
 *   - **approved**: the human accepted the propose card (`verdict` accept: fresh presence, hand-only).
 * Before every attempt the job is re-gated: the loop must still be trusted at the run's content hash; an auto job
 * also needs the loop runnable, not held by the kill switch, and `landDecision` (strictness-cap.ts) still `land`
 * with the cap re-read (otherwise it falls back to a propose card); L3 or `manual` waits (`held`) for both.
 *
 * Rows (kernel principal):
 *   - `loop.landed{loopId, runId, scope, repoKey, sha, parkedSha, baseSha, ref, paths, how, cardId?}` is written by
 *     landCommit's `beforeLand`, BEFORE the ref or any file moves (Aegis step 7, G-LOOP-15). It is what makes the
 *     commit the loop's own (the self-trigger guard in events.ts, revert detection here), never the trailer.
 *   - `loop.land.waiting{loopId, runId, reason, detail}` once per new reason while a waitable refusal holds (dirty,
 *     human-turn, index-lock, in-progress, held); with `undone: true, sha` when a row was written and the land was
 *     then put back (a CAS failure, a concurrent edit): that sha never landed.
 *   - `loop.parked{loopId, runId, ref, sha, reason, detail}` when it cannot land (a structural refusal, or
 *     `max-wait` after `land.maxWaitMin`); the commit stays at its park ref and the human gets a toast.
 *   - `merge.reverted{landedRef, revertSha, detectedBy, loopId, runId, scope, repoKey}` when a later commit on the
 *     branch reverts a landed loop commit (by content, or by a `This reverts commit` line), once per landed sha.
 *     Strictness signal scoring is 8.1: the row is the signal; nothing tightens on it yet.
 * Waiting jobs retry on a timer (`retryMs`) and on `nudge()` (wire.ts calls it on every turn.result and session
 * exit). A daemon restart drops waiting jobs; their commits stay parked (the retention sweep removes them).
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { findRevert, landCommit, type LandCommitInput, type LandResult, type LandStep } from '../git/land.js';
import { dropParkedRef, hardenedGit, hardenedGitEnv, loopWorkDir } from '../git/scratch.js';
import { visible } from './propose.js';
import { authorLabel, type LoopEntry, type LoopRegistry } from './registry.js';
import { landDecision, type EffectiveAutonomy } from './strictness-cap.js';

/** How long a landed commit is watched for a revert (the loops retention window). */
export const LAND_REVERT_WATCH_MS = 14 * 86_400_000;
/** A waiting land retries this often (and on every nudge). */
export const LAND_RETRY_MS = 30_000;
/** Kernel rows the lander folds (landed shas, undone lands, reverts already reported). */
export const LOOP_LAND_FOLD_KINDS: readonly string[] = Object.freeze(['loop.landed', 'loop.land.waiting', 'loop.parked', 'merge.reverted']);
/** A stale index.lock an interrupted land left: at least this old, and no newer than its loop.landed row. */
export const LAND_STALE_LOCK_MS = 10_000;

export interface LandJob {
  key: string;
  loopId: string;
  scope: string;
  repoKey: string;
  repo: string;
  runId: string;
  parkRepo: string;
  /** the park ref (refs/gnomon/loops/<id>/<runId>) */
  ref: string;
  parkedSha: string;
  baseSha: string;
  /** the branch the run started on (null: a detached HEAD, which never lands) */
  headRef: string | null;
  contentHash: string;
  message: string;
  maxWaitMin: number;
  how: 'auto' | 'approved';
  /** the propose card an approved land came from */
  cardId?: string;
  /** notify.on includes `landed` */
  notifyLanded: boolean;
  /** an auto job: does each changed path need a card (gate-class)? */
  gateClass?: boolean;
}

export type LandOutcome = { landed: true; sha: string } | { landed: false; state: 'waiting' | 'parked' | 'proposed'; reason: string; detail: string };

export interface LandToast {
  loopId: string;
  runId: string;
  repo: string;
  text: string;
}

export interface LoopLanderOptions {
  /** the Gnomon home (the park repo lives under it) */
  home: string;
  kernelPrincipal: string;
  isKernelKey?: (keyId: string, seq?: number) => boolean;
  append: (kind: string, payload: Record<string, unknown>) => Promise<void>;
  registry: Pick<LoopRegistry, 'entry' | 'entries' | 'canRun' | 'trustOf' | 'authoredBy'>;
  /** the loop's effective autonomy with the repo cap re-read (runner.effective) */
  effective: (entry: Pick<LoopEntry, 'repoKey' | 'compiled'>) => EffectiveAutonomy;
  /** the kill switch holds this loop */
  isHeld: (key: string) => boolean;
  /** a human attended session in the repo (its realpath) has a turn in flight */
  humanBusy?: (repo: string) => boolean;
  toast?: (t: LandToast) => void;
  /** an auto job the re-gate no longer lets land alone: raise the propose card instead (the runner's) */
  propose?: (job: LandJob, reason: string) => Promise<void>;
  diag?: (event: string, data: Record<string, unknown>) => void;
  clock?: () => number;
  retryMs?: number;
  /** the retry timer (default setTimeout, unref'd) */
  timer?: (fn: () => void, ms: number) => () => void;
  /** TEST seams: the land mechanics and their step hook */
  land?: (i: LandCommitInput) => Promise<LandResult>;
  step?: (name: LandStep, info: { repo: string; paths: string[] }) => void;
}

interface Waiting {
  job: LandJob;
  since: number;
  lastReason: string | null;
  cancel: (() => void) | null;
  busy: boolean;
  /** parked by the kill switch while an attempt was in flight: it never waits again */
  killed?: boolean;
}

/** A land's last state by run, folded from kernel rows (the boot reconcile reads it, Aegis M4). */
interface RunLand {
  state: 'waiting' | 'intent' | 'done' | 'undone' | 'parked';
  loopId: string;
  repoKey?: string;
  sha?: string;
  ref?: string;
  paths?: string[];
  at: number;
}

interface Landed {
  loopId: string;
  runId: string;
  scope?: string;
  repoKey: string;
  ref: string;
  at: number;
  undone?: boolean;
  reverted?: boolean;
}

/** A committed row as the lander reads it. */
export interface LandRow {
  /** Aegis S2 H-2: the row seq, so a sealed legacy kernel key is trusted only up to its seal */
  seq?: number;
  kind: string;
  principal?: string;
  keyId?: string;
  at?: string;
  payload?: unknown;
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string | undefined => (typeof v === 'string' && v.length > 0 ? v : undefined);
const OID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;

export class LoopLander {
  readonly #o: LoopLanderOptions;
  readonly #waiting = new Map<string, Waiting>();
  readonly #landed = new Map<string, Landed>();
  readonly #runs = new Map<string, RunLand>();
  #closed = false;

  constructor(o: LoopLanderOptions) {
    this.#o = o;
  }

  #now(): number {
    return (this.#o.clock ?? Date.now)();
  }

  // ── the fold (kernel-signed rows only) ──────────────────────────────────────

  seed(rows: Iterable<LandRow>): void {
    for (const r of rows) this.observe(r);
  }

  observe(r: LandRow): void {
    if (r.principal !== this.#o.kernelPrincipal || !isObj(r.payload)) return;
    if (this.#o.isKernelKey && (typeof r.keyId !== 'string' || !this.#o.isKernelKey(r.keyId, r.seq))) return;
    const p = r.payload;
    const at = r.at && Number.isFinite(Date.parse(r.at)) ? Date.parse(r.at) : this.#now();
    const runId = str(p.runId);
    const loopId = str(p.loopId);
    if (r.kind === 'loop.landed') {
      const sha = str(p.sha);
      const repoKey = str(p.repoKey);
      const ref = str(p.ref);
      if (sha && OID.test(sha) && loopId && runId && repoKey && ref) {
        const prev = this.#landed.get(sha);
        this.#landed.set(sha, { loopId, runId, repoKey, ref, at: prev?.at ?? at, ...(str(p.scope) ? { scope: str(p.scope)! } : {}) });
        const paths = Array.isArray(p.paths) ? p.paths.filter((x): x is string => typeof x === 'string') : undefined;
        this.#runs.set(runId, { state: p.phase === 'done' ? 'done' : 'intent', loopId, repoKey, sha, ref, ...(paths ? { paths } : {}), at });
      }
    } else if (r.kind === 'loop.land.waiting') {
      if (p.undone === true) {
        const l = this.#landed.get(str(p.sha) ?? '');
        if (l) l.undone = true;
        if (runId && loopId) this.#runs.set(runId, { ...(this.#runs.get(runId) ?? { loopId, at }), state: 'undone', at });
      } else if (runId && loopId) this.#runs.set(runId, { ...(this.#runs.get(runId) ?? { loopId }), state: 'waiting', at, ...(str(p.repoKey) ? { repoKey: str(p.repoKey)! } : {}) });
    } else if (r.kind === 'loop.parked' && p.land === true && runId && loopId) {
      this.#runs.set(runId, { ...(this.#runs.get(runId) ?? { loopId }), state: 'parked', at });
    } else if (r.kind === 'merge.reverted') {
      const l = this.#landed.get(str(p.landedRef) ?? '');
      if (l) l.reverted = true;
    }
  }

  /** Is `sha` a loop commit the kernel landed (and did not put back)? */
  landedBy(sha: string): { loopId: string; runId: string } | null {
    const l = this.#landed.get(sha);
    return l && !l.undone ? { loopId: l.loopId, runId: l.runId } : null;
  }

  // ── landing ─────────────────────────────────────────────────────────────────

  /** Try a land now; a waitable refusal keeps it waiting (retries until land.maxWaitMin), anything else parks it. */
  async request(job: LandJob): Promise<LandOutcome> {
    if (this.#closed) return { landed: false, state: 'parked', reason: 'held', detail: 'the kernel is stopping' };
    const prev = this.#waiting.get(job.runId);
    if (prev) {
      // an approval of a job already waiting (or a duplicate): the newest job wins, the wait clock keeps running
      prev.job = job;
      return this.#attempt(prev);
    }
    const w: Waiting = { job, since: this.#now(), lastReason: null, cancel: null, busy: false };
    this.#waiting.set(job.runId, w);
    return this.#attempt(w);
  }

  /**
   * The kill switch (Aegis M3): every waiting land, approved ones too, is parked now (loop.parked{kill-switch}). An
   * attempt already in flight finishes; it never waits again. A fresh approval given after the switch may still land.
   */
  async parkAll(by: string): Promise<number> {
    let n = 0;
    for (const w of [...this.#waiting.values()]) {
      this.#waiting.delete(w.job.runId);
      w.cancel?.();
      w.cancel = null;
      w.killed = true;
      await this.#park(w.job, 'kill-switch', `the kill switch (${by})`);
      n++;
    }
    return n;
  }

  async #park(job: LandJob, reason: string, detail: string): Promise<void> {
    await this.#o.append('loop.parked', { loopId: job.loopId, runId: job.runId, repoKey: job.repoKey, ref: job.ref, sha: job.parkedSha, reason, detail: visible(detail), land: true });
    await this.#toast(job, `${job.loopId}: could not land (${visible(detail).slice(0, 200)}); parked at ${job.ref}`);
  }

  /** Retry every waiting land (of one repo, or all) now: a turn ended, a session exited, a file changed. */
  async nudge(repoKey?: string): Promise<void> {
    for (const w of [...this.#waiting.values()]) if (!repoKey || w.job.repoKey === repoKey) await this.#attempt(w);
  }

  /** The waiting lands (status.loops). */
  waiting(): Array<{ loopId: string; runId: string; reason: string | null; since: number; how: string }> {
    return [...this.#waiting.values()].map((w) => ({ loopId: w.job.loopId, runId: w.job.runId, reason: w.lastReason, since: w.since, how: w.job.how }));
  }

  close(): void {
    this.#closed = true;
    for (const w of this.#waiting.values()) w.cancel?.();
    this.#waiting.clear();
  }

  /** Why this job may not land now: null (go), or a refusal (waitable or not), or a fallback to the propose card. */
  #gate(job: LandJob): { reason: string; detail: string; waitable: boolean; propose?: true } | null {
    if (!job.headRef) return { reason: 'branch-moved', detail: 'the run started on a detached HEAD', waitable: false };
    const entry = this.#o.registry.entry(job.key);
    const trust = this.#o.registry.trustOf(job.key);
    if (!entry || !trust || trust.contentHash !== job.contentHash) return { reason: 'held', detail: 'the loop is no longer trusted at the hash this run used', waitable: false };
    const eff = this.#o.effective(entry);
    if (eff.paused) return { reason: 'held', detail: `the repo is at ${eff.level}${eff.mode === 'manual' ? ' in manual mode' : ''}: landing waits`, waitable: true };
    if (job.how === 'auto') {
      if (this.#o.isHeld(job.key)) return { reason: 'held', detail: 'the kill switch holds this loop', waitable: false };
      const can = this.#o.registry.canRun(job.key);
      if (!can.ok) return { reason: 'held', detail: `the loop cannot run now (${can.reason})`, waitable: false };
      const d = landDecision(eff, { gateClass: job.gateClass === true });
      if (!d.land) return { reason: 'held', detail: d.reason, waitable: false, propose: true };
    }
    return null;
  }

  async #attempt(w: Waiting): Promise<LandOutcome> {
    const { job } = w;
    if (w.busy) return { landed: false, state: 'waiting', reason: w.lastReason ?? 'held', detail: 'an attempt is in flight' };
    w.busy = true;
    w.cancel?.();
    w.cancel = null;
    try {
      const g = this.#gate(job);
      let r: LandResult;
      if (g?.propose && this.#o.propose) {
        this.#waiting.delete(job.runId);
        await this.#o.propose(job, g.detail);
        return { landed: false, state: 'proposed', reason: g.reason, detail: g.detail };
      }
      if (g) r = { landed: false, reason: g.reason as never, detail: g.detail, waitable: g.waitable };
      else {
        const entry = this.#o.registry.entry(job.key)!;
        const trust = this.#o.registry.trustOf(job.key)!;
        const land = this.#o.land ?? landCommit;
        r = await land({
          repo: job.repo, parkRepo: job.parkRepo, parkedSha: job.parkedSha, baseSha: job.baseSha, headRef: job.headRef!,
          loopId: job.loopId, runId: job.runId, message: job.message,
          trailers: { onBehalfOf: trust.by ?? 'unknown', trustedBy: trust.cardId ?? 'unknown', loop: `${job.loopId}@${job.contentHash.replace(/^sha256:/, '').slice(0, 8)}`, authoredBy: authorLabel(this.#o.registry.authoredBy(entry)) },
          ...(this.#o.humanBusy ? { humanBusy: () => this.#o.humanBusy!(job.repo) } : {}),
          ...(this.#o.clock ? { now: this.#o.clock } : {}),
          ...(this.#o.step ? { step: this.#o.step } : {}),
          recoverDir: path.join(loopWorkDir(this.#o.home), 'recovered'),
          beforeLand: async (l) => {
            // G-LOOP-15: the loop's own commit, named BEFORE the ref moves (a throw here lands nothing)
            await this.#o.append('loop.landed', {
              loopId: job.loopId, runId: job.runId, scope: job.scope, repoKey: job.repoKey, sha: l.sha, parkedSha: job.parkedSha,
              baseSha: l.baseSha, ref: l.ref, paths: l.paths, how: job.how, ...(job.cardId ? { cardId: job.cardId } : {}), phase: 'intent',
            });
            // folded here too (the log's commit listener folds the same row; the set is idempotent)
            this.#landed.set(l.sha, { loopId: job.loopId, runId: job.runId, scope: job.scope, repoKey: job.repoKey, ref: l.ref, at: this.#now() });
          },
        });
      }
      if (r.landed) {
        this.#waiting.delete(job.runId);
        try {
          // the commit is on the branch now: its park ref goes (the objects age out of the park repo)
          dropParkedRef(this.#o.home, job.repo, job.ref);
        } catch (err) {
          this.#o.diag?.('loops.park-drop-failed', { runId: job.runId, why: err instanceof Error ? err.message.slice(0, 200) : 'failed' });
        }
        // Aegis M4: the land completed (the boot reconcile treats an intent with no done and no undone as interrupted).
        // The same kind with phase 'done': a new kind would move clientApiId (the plan's step 11 notes)
        await this.#o.append('loop.landed', { loopId: job.loopId, runId: job.runId, scope: job.scope, repoKey: job.repoKey, sha: r.sha, ref: r.ref, paths: r.paths, how: job.how, phase: 'done' });
        if (r.recovered?.length) await this.#toast(job, `${job.loopId}: ${r.recovered.length} file${r.recovered.length === 1 ? '' : 's'} changed while it landed; your version is kept at ${visible(r.recovered[0]!)}`);
        if (job.notifyLanded) await this.#toast(job, `${job.loopId}: landed ${r.sha.slice(0, 12)} on ${visible(r.ref.replace(/^refs\/heads\//, ''))} (${r.paths.length} file${r.paths.length === 1 ? '' : 's'})`);
        return { landed: true, sha: r.sha };
      }
      if (r.undone) {
        await this.#o.append('loop.land.waiting', { loopId: job.loopId, runId: job.runId, reason: r.reason, detail: visible(r.detail), sha: r.sha, undone: true, ...(r.conflict ? { conflict: true } : {}) });
        const l = this.#landed.get(r.sha ?? '');
        if (l) l.undone = true;
      }
      const waited = this.#now() - w.since;
      if (r.waitable && waited < job.maxWaitMin * 60_000 && !w.killed) {
        if (w.lastReason !== r.reason) {
          w.lastReason = r.reason;
          await this.#o.append('loop.land.waiting', { loopId: job.loopId, runId: job.runId, reason: r.reason, detail: visible(r.detail) });
        }
        this.#schedule(w);
        return { landed: false, state: 'waiting', reason: r.reason, detail: r.detail };
      }
      const reason = r.waitable ? 'max-wait' : r.reason;
      const detail = r.waitable ? `waited ${job.maxWaitMin} min (${r.detail})` : r.detail;
      this.#waiting.delete(job.runId);
      if (w.killed) return { landed: false, state: 'parked', reason: 'kill-switch', detail: 'the kill switch' };
      await this.#park(job, reason, detail);
      return { landed: false, state: 'parked', reason, detail };
    } catch (err) {
      // a row that could not be written: nothing more is attempted for this job (its commit stays parked)
      this.#waiting.delete(job.runId);
      this.#o.diag?.('loops.land-failed', { runId: job.runId, why: err instanceof Error ? err.message.slice(0, 200) : 'failed' });
      return { landed: false, state: 'parked', reason: 'held', detail: 'the land failed' };
    } finally {
      w.busy = false;
    }
  }

  #schedule(w: Waiting): void {
    if (this.#closed) return;
    const ms = this.#o.retryMs ?? LAND_RETRY_MS;
    const run = (): void => void this.#attempt(w);
    if (this.#o.timer) w.cancel = this.#o.timer(run, ms);
    else {
      const t = setTimeout(run, ms);
      t.unref?.();
      w.cancel = () => clearTimeout(t);
    }
  }

  async #toast(job: LandJob, text: string): Promise<void> {
    await this.#o.append('loop.notified', { runId: job.runId, loopId: job.loopId, as: 'toast', text });
    try {
      this.#o.toast?.({ loopId: job.loopId, runId: job.runId, repo: job.repo, text });
    } catch {
      /* the GUI port never stops a land */
    }
  }

  // ── boot reconcile (Aegis M4) ───────────────────────────────────────────────

  /**
   * At boot, after seed(): a land whose loop.landed{intent} has neither a done nor an undone row was interrupted (the
   * daemon stopped mid-land). Its leftover private index in the git dir marks it: that file goes, a stale index.lock
   * (older than LAND_STALE_LOCK_MS and no newer than the row) goes, and the `.gnomon-land-*` temps and moved-aside
   * originals beside its paths move to `<home>/loop-work/recovered/<runId>/`. The row then closes as done (the ref
   * moved) or undone, with a toast to check `git status`. A land that was waiting at the restart parks
   * (loop.parked{restart}) with a toast. Returns how many runs it closed.
   */
  async reconcile(): Promise<number> {
    const roots = new Map<string, string>();
    for (const e of this.#o.registry.entries()) if (!roots.has(e.repoKey)) roots.set(e.repoKey, e.repoRoot);
    let n = 0;
    for (const [runId, st] of [...this.#runs.entries()]) {
      if (this.#now() - st.at > LAND_REVERT_WATCH_MS) continue; // past retention: its park ref is gone too
      const repo = st.repoKey ? roots.get(st.repoKey) : undefined;
      const job = { loopId: st.loopId, runId, repo: repo ?? '', repoKey: st.repoKey ?? '' } as LandJob;
      if (st.state === 'waiting') {
        await this.#o.append('loop.parked', { loopId: st.loopId, runId, ...(st.repoKey ? { repoKey: st.repoKey } : {}), reason: 'restart', detail: 'the daemon restarted while it waited', land: true });
        await this.#toast(job, `${st.loopId}: a land that was waiting was parked when Gnomon restarted (run ${runId}); run the loop again to retry`);
        st.state = 'parked';
        n++;
        continue;
      }
      if (st.state !== 'intent' || !repo || !st.sha || !st.ref) continue;
      const moved: string[] = [];
      let tip = '';
      try {
        const env = { ...hardenedGitEnv(), GIT_CEILING_DIRECTORIES: path.dirname(repo) };
        const gitDir = fs.realpathSync.native(hardenedGit(['rev-parse', '--absolute-git-dir'], { cwd: repo, env }).stdout.toString('utf8').trim());
        tip = hardenedGit(['rev-parse', '--verify', '-q', `${st.ref}^{commit}`], { cwd: repo, env, allowFail: true }).stdout.toString('utf8').trim();
        const leftovers = fs.readdirSync(gitDir).filter((f) => /^gnomon-land-[0-9a-f]{16}\.index(\.lock)?$/.test(f));
        for (const f of leftovers) fs.rmSync(path.join(gitDir, f), { force: true });
        if (leftovers.length) {
          const lock = path.join(gitDir, 'index.lock');
          const ls = fs.lstatSync(lock, { throwIfNoEntry: false });
          if (ls?.isFile() && ls.mtimeMs <= st.at + 5_000 && this.#now() - ls.mtimeMs >= LAND_STALE_LOCK_MS) fs.rmSync(lock, { force: true });
        }
        const dirs = new Set((st.paths ?? []).map((p) => path.posix.dirname(p)).map((d) => (d === '.' ? '' : d)));
        const recovered = path.join(loopWorkDir(this.#o.home), 'recovered', runId);
        for (const d of dirs) {
          const abs = path.join(repo, ...(d ? d.split('/') : []));
          const dst = fs.lstatSync(abs, { throwIfNoEntry: false });
          if (!dst?.isDirectory() || dst.isSymbolicLink() || fs.realpathSync.native(abs) !== abs) continue;
          for (const f of fs.readdirSync(abs)) {
            if (!/^\.gnomon-land-[0-9a-f]{16}\.(tmp|bak|undo)$/.test(f)) continue;
            const to = path.join(recovered, ...(d ? d.split('/') : []), f);
            fs.mkdirSync(path.dirname(to), { recursive: true, mode: 0o700 });
            const fl = fs.lstatSync(path.join(abs, f));
            if (fl.isSymbolicLink()) fs.symlinkSync(fs.readlinkSync(path.join(abs, f)), to);
            else fs.copyFileSync(path.join(abs, f), to, fs.constants.COPYFILE_EXCL);
            fs.rmSync(path.join(abs, f), { force: true });
            moved.push(path.posix.join(d, f));
          }
        }
      } catch (err) {
        this.#o.diag?.('loops.land-reconcile-failed', { runId, why: err instanceof Error ? err.message.slice(0, 200) : 'failed' });
      }
      const where = moved.length ? `; ${moved.length} leftover file${moved.length === 1 ? '' : 's'} moved to ${path.join(loopWorkDir(this.#o.home), 'recovered', runId)}` : '';
      if (tip === st.sha) {
        await this.#o.append('loop.landed', { loopId: st.loopId, runId, repoKey: st.repoKey, sha: st.sha, ref: st.ref, phase: 'done', recovered: true });
        st.state = 'done';
        await this.#toast(job, `${st.loopId}: a land was interrupted by a restart after its commit moved the branch; check git status${where}`);
      } else {
        await this.#o.append('loop.land.waiting', { loopId: st.loopId, runId, reason: 'held', detail: `interrupted by a restart${where}`, sha: st.sha, undone: true });
        const l = this.#landed.get(st.sha);
        if (l) l.undone = true;
        st.state = 'undone';
        await this.#toast(job, `${st.loopId}: a land was interrupted by a restart and did not complete; check git status${where}`);
      }
      n++;
    }
    return n;
  }

  // ── revert detection (G-LOOP-09) ────────────────────────────────────────────

  /**
   * Look for reverts of landed loop commits (the 64 most recent inside the watch window): each found writes ONE
   * `merge.reverted` row. Read-only git (findRevert). Returns how many were found.
   */
  async scanReverts(): Promise<number> {
    const now = this.#now();
    const roots = new Map<string, string>();
    for (const e of this.#o.registry.entries()) if (!roots.has(e.repoKey)) roots.set(e.repoKey, e.repoRoot);
    const due = [...this.#landed.entries()].filter(([, l]) => !l.undone && !l.reverted && now - l.at <= LAND_REVERT_WATCH_MS).sort((a, b) => b[1].at - a[1].at).slice(0, 64);
    let n = 0;
    for (const [sha, l] of due) {
      const repo = roots.get(l.repoKey);
      if (!repo) continue;
      let found;
      try {
        found = findRevert(repo, sha, l.ref);
      } catch (err) {
        this.#o.diag?.('loops.revert-scan-failed', { sha, why: err instanceof Error ? err.message.slice(0, 200) : 'failed' });
        continue;
      }
      if (!found) continue;
      l.reverted = true;
      await this.#o.append('merge.reverted', { landedRef: sha, revertSha: found.sha, detectedBy: found.detectedBy, loopId: l.loopId, runId: l.runId, ...(l.scope ? { scope: l.scope } : {}), repoKey: l.repoKey });
      await this.#toast({ loopId: l.loopId, runId: l.runId, repo } as LandJob, `${l.loopId}: its commit ${sha.slice(0, 12)} was reverted (${found.sha.slice(0, 12)})`);
      n++;
    }
    return n;
  }
}
