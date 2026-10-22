/**
 * @symbol #loop-runner
 *
 * #loop-runner, the runner core (docs/specs/gnomon-loops.md §2 graph semantics, §3.3 kill switch and resume
 * classes, §3.5 budgets, §4 "#loop-runner", "Restart", "Concurrency"; build plan step 5, LP3). Wired through
 * kernel/loops/wire.ts only.
 *
 * A run walks a TRUSTED loop's compiled graph from `start` (LL1: `registry.verify` + `canRun` before the run and
 * before EVERY node; a hash, closure, trust or pause change ends the run before its next node):
 *
 *   - **check** nodes run once through check-exec (`runCheck`, the `loop-check` sandbox) with argv0 and its
 *     interpreter pinned to the trusted hash's digests; the verdict is pass | fail | error.
 *   - **notify** `as: toast` writes `loop.notified{as:'toast', text}` (the text is a kernel-field template: loop.id,
 *     run.id, round, failed.node, last.node, last.outcome) and hands the toast to the GUI port; verdict `pass`.
 *     `as: card` raises a `loop-choice` card (continue is fresh presence and hand-only by the class table; stop is
 *     deny-direction) and waits; the answer is the edge key, and no answer by the card's TTL takes `timeout`.
 *   - **call** nodes check `registry.resolveCall()` (the callee is TRUSTED and the pin is its trusted hash; depth
 *     ≤ LOOP_CALL_DEPTH_MAX), then run the callee as a child run whose meter is chained to the caller's (a callee
 *     draws min(its own budget, the caller's remaining)). The callee's goal is `pass`, a budget stop `unsure`,
 *     anything else `fail`.
 *   - **model** nodes (step 8, model-node.ts): judge and summarize run as an unattended local session (origin
 *     'loop', LocalLane.openLoop through the `model` port) opened with a registry run reference minted per attempt;
 *     the verdict is the closed-enum JSON answer (else `unsure`); `unavailable` is retried 3 times with backoff, then
 *     takes its edge (compiled default @pause, with a toast). Never Claude in 8.0. Each step's spawn permit carries
 *     scope.loop = the root caller's key; the ledger folds its budget.usage tokens into the per-day counters, and the
 *     run meter holds run.tokens. A loop with model nodes and no configured local model (or a profile naming no
 *     configured endpoint) is refused at start.
 *   - **Thrash** (§3.5, k=3): in a loop with model or write steps, three rounds in a row whose check evidence hashes
 *     the same end the run `thrash` and write loop.paused{reason:'thrash'}; only a human resumes (fresh presence).
 *   - **Act** (step 10, #loop-act): a top-level run with act nodes first creates a scratch worktree at the branch
 *     head (kernel/git createScratch, outside the repo); its checks copy the SCRATCH, its act steps edit it through
 *     LocalLane.openLoop (role act: the clamp's tools, the protected globs, the `loop-act` profile). When the run
 *     ends, any change is parked at refs/gnomon/loops/<id>/<runId> (loop.parked) and becomes one `verdict` card
 *     (loop.proposed, propose.ts): 8.0 never lands (step 11). A called loop with act nodes is refused, and so are
 *     write checks (`effect: write`). The scratch tree is removed when the run ends.
 *   - **Strictness** (step 9, #loop-strictness, strictness-cap.ts): the `strictness` port's repo cap folds into the
 *     effective autonomy at run start, before EVERY node and on every `loop.node` row (Aegis M2). L3 or `manual`
 *     refuses the start FORBIDDEN{strictness-paused} and pauses a running loop before its next node
 *     (`loop.paused{reason:'strictness'}`); L1 and L2 cap the repo's concurrency (2 and 1).
 *
 * Terminals `@goal | @stop | @pause`; a missing edge goes to `@stop`. `@pause` writes `loop.paused` (a kernel pause:
 * resuming it takes fresh presence). Per-node `exit.maxVisits` / `exit.maxFailStreak` end the run `node-exit`.
 * Run-level budgets (LL3) are enforced HERE before every step: rounds (a round closes when the walk revisits a node),
 * wall minutes and compute seconds per run, runs and compute per loop-day, and global per-day caps; an absent field
 * is the global default. A check's timeout is cut to what the run has left.
 *
 * Rows (kernel principal; the ledger folds them back, ledger.ts): `loop.run.started`, `loop.node` (with `edge` and
 * `next`, so `gnomon replay` reproduces every edge, G-LOOP-17; evidence rides the row, labelled sensitive by the
 * kind's label table), `loop.round`, `loop.notified`, `loop.run.ended{reason, terminal?}`.
 *
 * Restart (G-LOOP-14): `recover()` at boot closes every started run with no end `daemon-restart`; nothing resumes
 * mid-step. Concurrency: one run per loop (a trigger during a run sets ONE rerun flag), at most `caps.repo` runs per
 * repo and `caps.global` overall (more wait in a FIFO). The kill switch (`request.loop.pause{all:true}`) aborts
 * every run (check-exec kills the process groups), and writes one `loop.paused{reason:'kill-switch'}` per loop.
 *
 * Step 6: `onEvent` tells #loop-timers when a run starts or ends (the continuous trigger, the uptime hold), when the
 * kill switch flips (every loop timer is dropped synchronously, before the pause rows) and when a loop resumes.
 */
import { randomBytes } from 'node:crypto';
import { mintId, sanitizeDisplayText, type CardV1 } from '@a-company/gnomon-contracts';
import { LOOP_BUDGET_DEFAULTS, LOOP_CALL_DEPTH_MAX, type CompiledLoop, type CompiledNode, type LoopBudgets } from '../../loops/index.js';
import type { RaiseInput } from '../broker/broker.js';
import { LOOP_CHECK_BACKENDS } from '../sandbox/loop-check.js';
import { RpcRefusal } from '../socket/rpc.js';
import { createHash } from 'node:crypto';
import { runCheck, type CheckExecInput, type CheckResult, type FilePin } from './check-exec.js';
import { dayKeyOf, type LoopLedger } from './ledger.js';
import { resolveInputs, runModelStep, type LoopModelPort, type ModelStepResult, type NodeNote } from './model-node.js';
import { authorLabel, parseTightened, type LoopEntry, type LoopRegistry, type LoopRunRef, type TightenedBudgets } from './registry.js';
import { loopClampLine } from '../supervisor/loop-clamp.js';
import { createScratch, dropParkedRef, GitRefusal, listScratchFiles, parkScratch, removeScratch, type Scratch } from '../git/scratch.js';
import { landHazards, proposeLines, proposeReasons } from './propose.js';
import { parseLoopTarget, type LoopAsker } from './trust.js';
import { effectiveAutonomy, FAIL_SAFE_CAP, OPEN_CAP, type EffectiveAutonomy, type RepoCap } from './strictness-cap.js';

/** Global caps and defaults (root-signed `~/.gnomon/config.yaml` `loops:` replaces these once it is read). */
export interface LoopGlobalCaps {
  /** runs at once per repo (`loops.concurrency.repo`) */
  repo: number;
  /** runs at once overall */
  global: number;
  /** top-level runs per day, all loops */
  dayRuns: number;
  /** compute seconds per day, all loops */
  dayComputeSec: number;
  /** a loop-choice card waits at most this long (then `timeout`) */
  choiceTtlMs: number;
  /** model tokens per day, all loops (local) */
  dayTokens: number;
  /** a model node's `unavailable` retries and their backoff (ms) */
  modelRetries: number;
  modelBackoffMs: readonly number[];
  /** thrash: this many rounds in a row with the same evidence hash pause the loop (§3.5, k=3) */
  thrashRounds: number;
  /** budget fields a compiled loop lacks */
  budgets: LoopBudgets;
}
export const LOOP_GLOBAL_CAPS: Readonly<LoopGlobalCaps> = Object.freeze({ repo: 2, global: 4, dayRuns: 240, dayComputeSec: 6 * 3600, choiceTtlMs: 3600_000, dayTokens: 8_000_000, modelRetries: 3, modelBackoffMs: Object.freeze([2_000, 8_000, 30_000]), thrashRounds: 3, budgets: LOOP_BUDGET_DEFAULTS });
/** evidence tails kept on the loop.node row (each) */
export const LOOP_NODE_EVIDENCE_BYTES = 16 * 1024;
export const NO_LOCAL_MODEL = 'no local model is configured for this loop (the root-signed local config marks no endpoint loops: true, or none matches model.profile)';
export const ACT_NODES_LATER = 'write checks (effect: write) are not built in 8.0 yet';
/** Paths an act node never edits beyond the loop's protected set: loop definitions (LL5) and the repo's Gnomon dir. */
export const ACT_ALWAYS_PROTECTED: readonly string[] = Object.freeze(['.paradigm/loops/**', '.gnomon/**', '**/node_modules/**']);
const KERNEL_PAUSES_NEED_PRESENCE = new Set(['kill-switch', 'thrash', 'strictness', 'budget', 'node-exit', 'unavailable', 'timeout']);

export type LoopRunEnd = {
  reason: string;
  terminal?: '@goal' | '@stop' | '@pause';
  detail?: string;
  lastVerdict?: string;
};

export interface LoopToast {
  loopId: string;
  runId: string;
  nodeId?: string;
  repo: string;
  text: string;
}

/** What #loop-timers hears from the runner (a run started or ended, the kill switch, a resume). */
export type LoopRunnerEvent = { type: 'started' | 'ended' | 'resumed'; key: string } | { type: 'kill' };

export interface LoopRunnerOptions {
  home: string;
  kernelPrincipal: string;
  registry: LoopRegistry;
  ledger: LoopLedger;
  /** append a kernel row; the committed row comes back to the ledger and registry through onCommit */
  append: (kind: string, payload: Record<string, unknown>, ids?: { connId?: string }) => Promise<void>;
  broker: { raise(input: RaiseInput): Promise<CardV1> };
  /** the check executor (default runCheck) */
  check?: (i: CheckExecInput) => Promise<CheckResult>;
  /** the pinned paradigm CLI entry builtins run through (null: builtins are `error`) */
  paradigmCli?: () => FilePin | null;
  /** a notify toast for the GUI (the loop.notified row is written either way) */
  toast?: (t: LoopToast) => void;
  /** the local model lane (supervisor.openLoop); absent: a loop with model nodes is refused */
  model?: LoopModelPort;
  caps?: Partial<LoopGlobalCaps>;
  clock?: () => number;
  platform?: string;
  diag?: (event: string, data: Record<string, unknown>) => void;
  /** step 9 (#loop-strictness): the repo's cap {level, effective run mode}; absent ⇒ as declared; a throw ⇒ L3 */
  strictness?: (repoKey: string) => RepoCap;
}

interface Active {
  runId: string;
  key: string;
  repoKey: string;
  abort: AbortController;
  /** why the run is being stopped from outside (pause, kill switch) */
  stopping?: string;
  rerun: boolean;
  done: Promise<LoopRunEnd>;
}

/** A run's meter, chained to the caller's for a call (a callee draws min(own, caller's remaining)). */
class Meter {
  computeMs = 0;
  tokens = 0;
  readonly startMs: number;
  constructor(
    readonly wallMs: number,
    readonly computeLimitMs: number,
    readonly clock: () => number,
    readonly parent?: Meter,
    readonly tokenLimit: number = Infinity,
  ) {
    this.startMs = clock();
  }
  add(ms: number): void {
    this.computeMs += ms;
    this.parent?.add(ms);
  }
  addTokens(n: number): void {
    this.tokens += n;
    this.parent?.addTokens(n);
  }
  exceeded(): string | null {
    if (this.clock() - this.startMs >= this.wallMs) return `run.wallMin (${Math.round(this.wallMs / 60_000)} min)`;
    if (this.computeMs >= this.computeLimitMs) return `run.computeSec (${Math.round(this.computeLimitMs / 1000)} s)`;
    if (this.tokens >= this.tokenLimit) return `run.tokens (${this.tokenLimit})`;
    return this.parent?.exceeded() ?? null;
  }
  remainingTokens(): number {
    return Math.min(this.tokenLimit - this.tokens, this.parent ? this.parent.remainingTokens() : Infinity);
  }
  remainingMs(): number {
    const own = Math.min(this.wallMs - (this.clock() - this.startMs), this.computeLimitMs - this.computeMs);
    return Math.min(own, this.parent ? this.parent.remainingMs() : Infinity);
  }
}

interface WalkCtx {
  entry: LoopEntry;
  compiled: CompiledLoop;
  runId: string;
  meter: Meter;
  depth: number;
  abort: AbortController;
  /** the outside stop reason holder (the top-level Active) */
  top: Active;
  budgets: LoopBudgets;
  /** the caller's walk (a callee's); the root's key and day budget pay for the whole chain */
  parent?: WalkCtx;
  /** what each node recorded on this run (model inputs read only these, never repo text) */
  notes: Map<string, NodeNote>;
  /** the trigger (model inputs read only its kernel-stamped fields) */
  trigger: Record<string, unknown>;
  /** step 10: the run's scratch worktree (top-level runs with act nodes) */
  scratch?: Scratch;
}

interface NodeResult {
  verdict: string;
  edge: string;
  durationMs: number;
  detail?: string;
  choice?: string;
  evidence?: Record<string, unknown>;
  aborted?: boolean;
  extra?: Record<string, unknown>;
  /** the kernel's edge, whatever the author's map says (a card that could not be raised ends the run) */
  forceNext?: '@stop' | '@pause';
}

const rootOf = (c: WalkCtx): WalkCtx => (c.parent ? rootOf(c.parent) : c);

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const fin = (v: unknown, d: number): number => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : d);
const tail = (s: string): string => (s.length > LOOP_NODE_EVIDENCE_BYTES ? s.slice(s.length - LOOP_NODE_EVIDENCE_BYTES) : s);

/** The effective budgets: the compiled ones, with the global default for any absent or malformed field (LL3). */
export function effectiveBudgets(b: Partial<LoopBudgets> | undefined, defaults: LoopBudgets = LOOP_BUDGET_DEFAULTS): LoopBudgets {
  const run = isObj(b?.run) ? b!.run : ({} as Partial<LoopBudgets['run']>);
  const day = isObj(b?.day) ? b!.day : ({} as Partial<LoopBudgets['day']>);
  const esc = isObj(b?.escalations) ? b!.escalations : ({} as Partial<LoopBudgets['escalations']>);
  return {
    run: { rounds: fin(run.rounds, defaults.run.rounds), wallMin: fin(run.wallMin, defaults.run.wallMin), tokens: fin(run.tokens, defaults.run.tokens), computeSec: fin(run.computeSec, defaults.run.computeSec) },
    day: { runs: fin(day.runs, defaults.day.runs), tokens: fin(day.tokens, defaults.day.tokens), computeSec: fin(day.computeSec, defaults.day.computeSec) },
    escalations: { perRun: fin(esc.perRun, defaults.escalations.perRun), perDay: fin(esc.perDay, defaults.escalations.perDay) },
  };
}

/** LP8: the effective budgets with a human's tightened caps applied (only ever lower). */
export function tightenBudgets(b: LoopBudgets, t: TightenedBudgets | null): LoopBudgets {
  if (!t) return b;
  const run = { ...b.run };
  const day = { ...b.day };
  for (const [f, x] of Object.entries(t.run) as Array<[keyof LoopBudgets['run'], number]>) run[f] = Math.min(run[f], x);
  for (const [f, x] of Object.entries(t.day) as Array<[keyof LoopBudgets['day'], number]>) day[f] = Math.min(day[f], x);
  return { ...b, run, day };
}

/** Nodes this build cannot run (write checks; act nodes run since step 10). */
export function unsupportedNodes(c: CompiledLoop): string[] {
  return c.nodes.filter((n) => n.type === 'check' && n.effect === 'write').map((n) => n.id);
}

/** Does a loop have act nodes (a scratch worktree and a propose step)? */
export function hasActNodes(c: CompiledLoop): boolean {
  return c.nodes.some((n) => n.type === 'model' && n.role === 'act');
}

/** A notify text: kernel fields only (§2 "text: kernel fields only"); anything else renders `?`. Sanitized, ≤ 500. */
export function renderNotifyText(template: string | undefined, f: Record<string, string | number | undefined>, fallback: string): string {
  const raw = (template ?? fallback).replace(/\{\{\s*([a-z][a-z.]*)\s*\}\}/g, (_m, k: string) => (f[k] !== undefined ? String(f[k]) : '?'));
  return sanitizeDisplayText(raw).text.slice(0, 500);
}

export class LoopRunner {
  readonly #o: LoopRunnerOptions;
  readonly #caps: LoopGlobalCaps;
  readonly #active = new Map<string, Active>();
  readonly #queue: Array<{ key: string; trigger: Record<string, unknown> }> = [];
  /** every run id in flight, callees included (recover() never closes a live run) */
  readonly #live = new Set<string>();
  /** the kill switch: set synchronously before any row; refuses every start until its rows are written */
  #killing = false;
  /** loops the kill switch paused, held here until each is resumed (covers the window before the rows fold) */
  readonly #killHeld = new Set<string>();
  #recovered = false;
  readonly #listeners = new Set<(e: LoopRunnerEvent) => void>();

  constructor(o: LoopRunnerOptions) {
    this.#o = o;
    this.#caps = { ...LOOP_GLOBAL_CAPS, ...(o.caps ?? {}) };
  }

  #now(): number {
    return (this.#o.clock ?? Date.now)();
  }

  // ── step 9 (#loop-strictness): the autonomy-check hook, re-read at start, at every node and at land ──
  effective(entry: Pick<LoopEntry, 'repoKey' | 'compiled'>): EffectiveAutonomy {
    let cap: RepoCap = OPEN_CAP;
    if (this.#o.strictness) {
      try {
        cap = this.#o.strictness(entry.repoKey);
      } catch {
        cap = FAIL_SAFE_CAP;
      }
    }
    return effectiveAutonomy({ autonomy: entry.compiled?.autonomy }, cap);
  }

  /** Listen for run starts and ends, the kill switch and resumes (#loop-timers). Listeners run synchronously. */
  onEvent(fn: (e: LoopRunnerEvent) => void): () => void {
    this.#listeners.add(fn);
    return () => this.#listeners.delete(fn);
  }

  #emit(e: LoopRunnerEvent): void {
    for (const fn of [...this.#listeners]) {
      try {
        fn(e);
      } catch (err) {
        this.#o.diag?.('loops.listener-failed', { event: e.type, why: err instanceof Error ? err.message.slice(0, 200) : 'listener failed' });
      }
    }
  }

  /** live run id → its loop key and the key of the walk's root (the run-reference minter vouches with these) */
  readonly #runRoots = new Map<string, { key: string; rootKey: string; top: Active }>();
  #minter: ReturnType<LoopRegistry['issueRunRefMinter']> | null = null;

  /** Why a loop's step may not open a model session now (the kill switch, its repo's strictness), or null. */
  #hold(key: string): string | null {
    if (this.isHeld(key)) return 'held by the kill switch';
    const e = this.#o.registry.entry(key);
    if (e?.compiled && this.effective(e).paused) return 'paused by its repo\'s strictness';
    return null;
  }

  /** The registry's minter, taken once at the first model step (Aegis step-8 #2: there is no public mint). */
  #mint(key: string, p: { runId: string; nodeId: string; rootKey: string }): LoopRunRef | null {
    this.#minter ??= this.#o.registry.issueRunRefMinter({
      vouch: (k, q) => {
        const r = this.#runRoots.get(q.runId);
        if (!r || !this.#live.has(q.runId) || r.key !== k || r.rootKey !== q.rootKey) return 'not a live run of this loop with this root';
        if (r.top.stopping || r.top.abort.signal.aborted) return 'the run is stopping';
        return this.#hold(r.rootKey) ?? this.#hold(k);
      },
      hold: (k) => this.#hold(k),
    });
    return this.#minter.mint(key, p);
  }

  /** Test seam and step-10 entry: mint a step reference; refused (null) unless the runner vouches for the step. */
  mintStepRef(key: string, p: { runId: string; nodeId: string; rootKey: string }): LoopRunRef | null {
    return this.#mint(key, p);
  }

  /** Held by the kill switch (until this loop is resumed), or the kill switch is running now. */
  isHeld(key: string): boolean {
    return this.#killing || this.#killHeld.has(key);
  }

  // ── Restart ─────────────────────────────────────────────────────────────────

  /** Boot: close every started run with no end `daemon-restart` (never resumed mid-step). Idempotent. */
  async recover(): Promise<number> {
    if (this.#recovered) return 0;
    this.#recovered = true;
    let n = 0;
    for (const r of this.#o.ledger.open()) {
      if (this.#live.has(r.runId)) continue;
      await this.#o.append('loop.run.ended', { runId: r.runId, loopId: r.loopId, ...(r.scope ? { scope: r.scope } : {}), ...(r.repoKey ? { repoKey: r.repoKey } : {}), reason: 'daemon-restart', rounds: r.rounds, computeMs: r.computeMs });
      n++;
    }
    return n;
  }

  // ── Starting runs ───────────────────────────────────────────────────────────

  /**
   * Start a run of `key` (manual or a trigger). Refuses (RpcRefusal) an untrusted or paused loop, a loop with nodes
   * this build cannot run, a platform with no loop-check sandbox, and a spent day cap. A run of the same loop in
   * flight sets its rerun flag; a full repo or global cap queues it.
   */
  start(key: string, trigger: Record<string, unknown>): { runId: string; done: Promise<LoopRunEnd> } | { coalesced: true; runId: string } | { queued: true } {
    if (this.#killing || this.#killHeld.has(key)) throw new RpcRefusal('FORBIDDEN', 'loop-not-runnable', `loop ${key.split('/').pop()} cannot run: paused (kill-switch); resume it first`, { state: 'paused (kill-switch)' });
    const active = this.#active.get(key);
    if (active) {
      active.rerun = true;
      return { coalesced: true, runId: active.runId };
    }
    const entry = this.#o.registry.verify(key);
    const can = this.#o.registry.canRun(key);
    if (!entry || !entry.compiled || !entry.hash || !can.ok) throw new RpcRefusal('FORBIDDEN', 'loop-not-runnable', `loop ${key.split('/').pop()} cannot run: ${can.ok ? 'not found' : can.reason} (nothing runs until you trust it: gnomon loop trust)`, { state: can.ok ? 'missing' : can.reason });
    const later = unsupportedNodes(entry.compiled);
    if (later.length) throw new RpcRefusal('ENGINE', 'not-implemented', `${ACT_NODES_LATER}: ${later.join(', ')}`, { nodes: later, milestone: 'loops-step-10' });
    const noModel = this.#modelRefusal(entry.compiled);
    if (noModel) throw new RpcRefusal('ENGINE', 'no-local-model', `loop ${entry.loopId}: ${NO_LOCAL_MODEL} (${noModel})`, { why: noModel });
    const platform = this.#o.platform ?? process.platform;
    if (!LOOP_CHECK_BACKENDS[platform]) throw new RpcRefusal('ENGINE', 'sandbox-unavailable', `no loop-check sandbox on ${platform}: loops run on macOS until the Windows backend (W5)`, { platform });
    // ── step 9 (#loop-strictness): L3 or manual runs nothing; L1/L2 cap the repo's concurrency ──
    const eff = this.effective(entry);
    if (eff.paused) throw new RpcRefusal('FORBIDDEN', 'strictness-paused', `loop ${entry.loopId} cannot run: its repo is at ${eff.level}${eff.mode === 'manual' ? ' in manual mode' : ''} (${eff.capReason})`, { gate: 'strictness', level: eff.level, mode: eff.mode });
    const repoCap = Math.min(this.#caps.repo, eff.concurrency ?? Infinity);
    const budgets = tightenBudgets(effectiveBudgets(entry.compiled.budgets, this.#caps.budgets), this.#o.registry.tightenedBudgets(entry.key, entry.hash?.contentHash));
    const today = dayKeyOf(this.#now());
    const mine = this.#o.ledger.day(today, key);
    const all = this.#o.ledger.day(today);
    if (mine.runs >= budgets.day.runs) throw new RpcRefusal('ENGINE', 'budget', `loop ${entry.loopId} used its ${budgets.day.runs} runs today (budgets.day.runs)`, { cap: 'day.runs' });
    if (mine.computeMs >= budgets.day.computeSec * 1000) throw new RpcRefusal('ENGINE', 'budget', `loop ${entry.loopId} used its ${budgets.day.computeSec} compute seconds today (budgets.day.computeSec)`, { cap: 'day.computeSec' });
    if (all.runs >= this.#caps.dayRuns) throw new RpcRefusal('ENGINE', 'budget', `loops used the global ${this.#caps.dayRuns} runs today`, { cap: 'global.dayRuns' });
    if (all.computeMs >= this.#caps.dayComputeSec * 1000) throw new RpcRefusal('ENGINE', 'budget', `loops used the global ${this.#caps.dayComputeSec} compute seconds today`, { cap: 'global.dayComputeSec' });
    if (entry.compiled.nodes.some((n) => n.type === 'model')) {
      if (mine.tokens >= budgets.day.tokens) throw new RpcRefusal('ENGINE', 'budget', `loop ${entry.loopId} used its ${budgets.day.tokens} model tokens today (budgets.day.tokens)`, { cap: 'day.tokens' });
      if (all.tokens >= this.#caps.dayTokens) throw new RpcRefusal('ENGINE', 'budget', `loops used the global ${this.#caps.dayTokens} model tokens today`, { cap: 'global.dayTokens' });
    }
    const inRepo = [...this.#active.values()].filter((a) => a.repoKey === entry.repoKey).length;
    if (inRepo >= repoCap || this.#active.size >= this.#caps.global) {
      if (!this.#queue.some((q) => q.key === key)) this.#queue.push({ key, trigger });
      return { queued: true };
    }
    const runId = `lr-${randomBytes(8).toString('hex')}`;
    const a: Active = { runId, key, repoKey: entry.repoKey, abort: new AbortController(), rerun: false, done: Promise.resolve({ reason: 'error' }) };
    this.#active.set(key, a);
    a.done = this.#top(a, entry, budgets, trigger)
      .catch((err: unknown): LoopRunEnd => {
        // a row that could not be written (the log closing) ends the run here; the boot sweep closes it daemon-restart
        this.#o.diag?.('loops.run-failed', { runId, why: err instanceof Error ? err.message.slice(0, 200) : 'failed' });
        return { reason: 'error' };
      })
      .finally(() => this.#after(a));
    this.#emit({ type: 'started', key });
    return { runId, done: a.done };
  }

  /** Why a loop's model nodes cannot run here (no lane, no endpoint or runner, a profile naming no endpoint), or null. */
  #modelRefusal(c: CompiledLoop): string | null {
    const models = c.nodes.filter((n): n is Extract<CompiledNode, { type: 'model' }> => n.type === 'model');
    if (!models.length) return null;
    if (!this.#o.model) return 'no local model lane';
    const cfg = this.#o.model.configured();
    if (!cfg.endpoints.length) return 'no local endpoint is marked loops: true in the root-signed local config';
    if (!cfg.runner) return 'no gnomon-local runner pinned';
    const missing = models.filter((n) => n.model.profile !== undefined && !cfg.endpoints.includes(n.model.profile)).map((n) => `${n.id}: profile ${n.model.profile}`);
    return missing.length ? `no configured endpoint for ${missing.join(', ')}` : null;
  }

  #after(a: Active): void {
    this.#active.delete(a.key);
    const next: Array<{ key: string; trigger: Record<string, unknown> }> = [];
    if (a.rerun && !a.stopping) next.push({ key: a.key, trigger: { type: 'rerun', of: a.runId } });
    next.push(...this.#queue.splice(0));
    for (const q of next) {
      try {
        this.start(q.key, q.trigger);
      } catch (err) {
        this.#o.diag?.('loops.start-refused', { key: q.key, why: err instanceof Error ? err.message.slice(0, 200) : 'refused' });
      }
    }
    this.#emit({ type: 'ended', key: a.key });
  }

  async #top(a: Active, entry: LoopEntry, budgets: LoopBudgets, trigger: Record<string, unknown>): Promise<LoopRunEnd> {
    const meter = new Meter(budgets.run.wallMin * 60_000, budgets.run.computeSec * 1000, () => this.#now(), undefined, budgets.run.tokens);
    return this.#run({ entry, compiled: entry.compiled!, runId: a.runId, meter, depth: 0, abort: a.abort, top: a, budgets, notes: new Map(), trigger }, trigger);
  }

  /** Stop a loop's run in flight before its next step (untrust, delete); no row beyond the run's own end. */
  stopRun(key: string, reason: string): boolean {
    const a = this.#active.get(key);
    if (!a) return false;
    this.#dequeue(key);
    a.stopping ??= reason;
    a.rerun = false;
    a.abort.abort();
    return true;
  }

  // ── The walk ────────────────────────────────────────────────────────────────

  async #run(ctx: WalkCtx, trigger: Record<string, unknown>, parentRunId?: string): Promise<LoopRunEnd> {
    const { entry, runId } = ctx;
    const ids = { runId, loopId: entry.loopId, scope: entry.scope, repoKey: entry.repoKey };
    this.#live.add(runId);
    this.#runRoots.set(runId, { key: entry.key, rootKey: rootOf(ctx).entry.key, top: ctx.top });
    try {
      return await this.#runLive(ctx, ids, trigger, parentRunId);
    } finally {
      this.#live.delete(runId);
      this.#runRoots.delete(runId);
    }
  }

  async #runLive(ctx: WalkCtx, ids: { runId: string; loopId: string; scope: string; repoKey: string }, trigger: Record<string, unknown>, parentRunId: string | undefined): Promise<LoopRunEnd> {
    const { entry, runId } = ctx;
    await this.#o.append('loop.run.started', { ...ids, contentHash: entry.hash!.contentHash, trigger, budgets: ctx.budgets, autonomy: ctx.compiled.autonomy, rootKey: rootOf(ctx).entry.key, ...(parentRunId ? { parentRunId } : {}) });
    let end: LoopRunEnd;
    let toasted = false;
    let round = 1;
    let scratchFailed: string | null = null;
    if (ctx.depth === 0 && hasActNodes(ctx.compiled)) {
      // step 10: act steps work in a scratch worktree at the branch head, outside the repo (G-GIT-01)
      try {
        ctx.scratch = createScratch({ home: this.#o.home, repo: entry.repoRoot, loopId: entry.loopId, runId });
      } catch (err) {
        scratchFailed = `the scratch worktree could not be created: ${err instanceof GitRefusal || err instanceof Error ? err.message.slice(0, 240) : 'failed'}`;
      }
    }
    try {
      try {
        if (scratchFailed) throw new Error(scratchFailed);
        const r = await this.#walk(ctx, (n) => (round = n), () => (toasted = true));
        end = r;
      } catch (err) {
        end = { reason: 'error', detail: err instanceof Error ? err.message.slice(0, 300) : 'the runner failed' };
        this.#o.diag?.('loops.run-failed', { runId, why: end.detail! });
      }
      if (ctx.scratch) {
        // Aegis M1: nothing of the act steps may still be writing the scratch when it is read for parking
        await this.#o.model?.settled?.(runId);
        await this.#propose(ctx, end);
      }
    } finally {
      if (ctx.scratch) removeScratch(ctx.scratch);
    }
    if (end.terminal === '@pause') {
      await this.#o.append('loop.paused', { loopId: entry.loopId, scope: entry.scope, repoKey: entry.repoKey, runId, reason: end.detail ?? 'node-exit', by: 'kernel' });
      ctx.top.rerun = false;
    } else if (end.reason === 'thrash') {
      // §3.5: a kernel safety pause; only a human resumes it, with fresh presence (resume-class)
      await this.#o.append('loop.paused', { loopId: entry.loopId, scope: entry.scope, repoKey: entry.repoKey, runId, reason: 'thrash', by: 'kernel', ...(end.detail ? { detail: end.detail } : {}) });
      ctx.top.rerun = false;
      await this.#toast(ctx, undefined, `${entry.loopId}: paused, no progress in ${this.#caps.thrashRounds} rounds (resume it yourself)`);
      toasted = true;
    } else if (end.reason === 'budget' && ctx.depth === 0) {
      // Aegis step 5 #5: a run-budget stop is a kernel pause; no rerun, and only a human resume (with presence) lifts it
      await this.#o.append('loop.paused', { loopId: entry.loopId, scope: entry.scope, repoKey: entry.repoKey, runId, reason: 'budget', by: 'kernel', ...(end.detail ? { cap: end.detail } : {}) });
      ctx.top.rerun = false;
    }
    // the loop-level notify (`notify: {on, as}`) when no notify node already toasted this run
    const outcome = end.reason === 'goal' ? 'goal' : end.lastVerdict === 'fail' || end.lastVerdict === 'error' ? 'fail' : end.reason === 'stop' ? 'stop' : null;
    if (!toasted && ctx.depth === 0 && outcome && ctx.compiled.notify.as === 'toast' && ctx.compiled.notify.on.includes(outcome)) {
      await this.#toast(ctx, undefined, `${entry.loopId}: ${outcome === 'goal' ? 'goal met' : outcome === 'fail' ? 'failed' : 'stopped'}`);
    }
    await this.#o.append('loop.run.ended', { ...ids, reason: end.reason, ...(end.terminal ? { terminal: end.terminal } : {}), ...(end.detail ? { detail: end.detail } : {}), rounds: round, computeMs: ctx.meter.computeMs });
    return end;
  }

  /** Why the run must stop before its next node, or null. */
  #gate(ctx: WalkCtx): LoopRunEnd | null {
    if (ctx.top.stopping) return { reason: ctx.top.stopping };
    if (ctx.abort.signal.aborted) return { reason: 'paused' };
    // this loop and every caller up the chain must still be trusted at the hash the run started on
    for (let c: WalkCtx | undefined = ctx; c; c = c.parent) {
      const e = this.#o.registry.verify(c.entry.key);
      const can = this.#o.registry.canRun(c.entry.key);
      const who = c === ctx ? '' : `caller ${c.entry.loopId}: `;
      if (!e || !can.ok) {
        const s = e ? this.#o.registry.stateOf(e) : { state: 'deleted' as const, reason: undefined };
        const reason = s.state === 'waiting-trust' ? (s.reason === 'closure-changed' ? 'closure-changed' : 'content-changed') : s.state === 'paused' ? (s.reason === 'kill-switch' ? 'kill-switch' : 'paused') : 'untrusted';
        return { reason, detail: `${who}${can.ok ? 'the loop is gone' : can.reason}` };
      }
      if (e.hash?.contentHash !== c.entry.hash?.contentHash) return { reason: 'content-changed', ...(who ? { detail: `${who}changed` } : {}) };
    }
    // ── step 9 (#loop-strictness): the repo rose to L3 or went manual mid-run ⇒ a kernel pause before this node ──
    if (this.effective(ctx.entry).paused) return { reason: 'strictness', terminal: '@pause', detail: 'strictness' };
    const over = ctx.meter.exceeded();
    if (over) return { reason: 'budget', detail: over };
    const today = dayKeyOf(this.#now());
    // a callee is funded from its root caller (§3.4): the root's key is charged and its day.computeSec applies
    const root = rootOf(ctx);
    if (this.#o.ledger.day(today, root.entry.key).computeMs >= root.budgets.day.computeSec * 1000) return { reason: 'budget', detail: `day.computeSec (${root.budgets.day.computeSec} s)` };
    if (this.#o.ledger.day(today).computeMs >= this.#caps.dayComputeSec * 1000) return { reason: 'budget', detail: `global dayComputeSec (${this.#caps.dayComputeSec} s)` };
    if (ctx.compiled.nodes.some((n) => n.type === 'model')) {
      if (this.#o.ledger.day(today, root.entry.key).tokens >= root.budgets.day.tokens) return { reason: 'budget', detail: `day.tokens (${root.budgets.day.tokens})` };
      if (this.#o.ledger.day(today).tokens >= this.#caps.dayTokens) return { reason: 'budget', detail: `global dayTokens (${this.#caps.dayTokens})` };
    }
    return null;
  }

  async #walk(ctx: WalkCtx, setRound: (n: number) => void, toasted: () => void): Promise<LoopRunEnd> {
    const { compiled, runId, entry } = ctx;
    const nodes = new Map(compiled.nodes.map((n) => [n.id, n]));
    const visits = new Map<string, number>();
    const streak = new Map<string, number>();
    let seen = new Set<string>();
    let roundVisits = 0;
    let round = 1;
    let at: string = compiled.start;
    let last: { nodeId?: string; verdict?: string; failed?: string } = {};
    let lastEvidence: string | undefined;
    // thrash (§3.5, k=3): the check evidence of each round, hashed; the same hash k rounds in a row is no progress
    const thrashWatch = compiled.nodes.some((n) => n.type === 'model' || (n.type === 'check' && n.effect === 'write'));
    let roundEvidence: string[] = [];
    // Aegis step-8 low: the streak carries across runs of the same loop (folded from loop.round{evidenceHash}), so a
    // continuous or scheduled loop that keeps failing the same way trips it too
    const carried = thrashWatch ? this.#o.ledger.thrash(entry.key) : null;
    let prevHash: string | null = carried?.hash ?? null;
    let sameRounds = carried?.same ?? 0;
    let thrash = false;
    /** close the round; `judge`: a round that ended normally (a revisit, @stop, @pause) feeds the thrash streak */
    const closeRound = async (judge = false): Promise<void> => {
      let evidenceHash: string | undefined;
      if (judge && thrashWatch && roundEvidence.length) {
        evidenceHash = `sha256:${createHash('sha256').update(roundEvidence.join('\n')).digest('hex')}`;
        sameRounds = evidenceHash === prevHash ? sameRounds + 1 : 1;
        prevHash = evidenceHash;
        thrash = sameRounds >= this.#caps.thrashRounds;
      }
      roundEvidence = [];
      await this.#o.append('loop.round', { runId, loopId: entry.loopId, round, nodeVisits: roundVisits, escalations: 0, ...(evidenceHash ? { evidenceHash } : {}) });
    };
    const thrashEnd = (): LoopRunEnd => ({ reason: 'thrash', detail: `the same check evidence ${this.#caps.thrashRounds} rounds in a row`, ...(last.verdict ? { lastVerdict: last.verdict } : {}) });
    for (;;) {
      if (at === '@goal' || at === '@stop' || at === '@pause') {
        await closeRound(at !== '@goal');
        if (thrash) return thrashEnd();
        const pauseWhy = at === '@pause' ? (last.verdict === 'unavailable' ? 'unavailable' : last.verdict === 'timeout' ? 'timeout' : 'node-exit') : undefined;
        return { reason: at === '@goal' ? 'goal' : at === '@stop' ? 'stop' : 'paused', terminal: at, ...(pauseWhy ? { detail: pauseWhy } : {}), ...(last.verdict ? { lastVerdict: last.verdict } : {}) };
      }
      const node = nodes.get(at);
      if (!node) {
        await closeRound();
        return { reason: 'error', detail: `no node ${at}` };
      }
      if (seen.has(at)) {
        // the walk came back to a node: the round closes (budgets.run.rounds counts these)
        await closeRound(true);
        if (thrash) return thrashEnd();
        round++;
        setRound(round);
        seen = new Set();
        roundVisits = 0;
        if (round > ctx.budgets.run.rounds) return { reason: 'budget', detail: `run.rounds (${ctx.budgets.run.rounds})`, ...(last.verdict ? { lastVerdict: last.verdict } : {}) };
      }
      const stop = this.#gate(ctx);
      if (stop) {
        await closeRound();
        return { ...stop, ...(last.verdict ? { lastVerdict: last.verdict } : {}) };
      }
      const visit = (visits.get(at) ?? 0) + 1;
      if (node.exit?.maxVisits !== undefined && visit > node.exit.maxVisits) {
        await closeRound();
        return { reason: 'node-exit', detail: `${at}: exit.maxVisits (${node.exit.maxVisits})`, ...(last.verdict ? { lastVerdict: last.verdict } : {}) };
      }
      visits.set(at, visit);
      seen.add(at);
      roundVisits++;
      const fields = { 'loop.id': entry.loopId, 'loop.title': compiled.title, 'run.id': runId, round, 'failed.node': last.failed, 'last.node': last.nodeId, 'last.outcome': last.verdict };
      const r = await this.#node(ctx, node, visit, fields, toasted, { last: lastEvidence, failed: last.failed });
      const eff = this.effective(entry); // step 9 (#loop-strictness): the row records the autonomy this node ran under
      const edgeKey = r.edge;
      if (node.type === 'check' || node.type === 'model') {
        ctx.notes.set(at, { type: node.type, verdict: r.verdict, ...(r.evidence ? { evidence: r.evidence } : {}), ...(typeof r.evidence?.reply === 'string' ? { text: r.evidence.reply } : {}) });
        lastEvidence = at;
      }
      if (node.type === 'check') roundEvidence.push(`${at}\u0000${r.verdict}\u0000${JSON.stringify(r.evidence ?? {})}`);
      let next: string | null = r.forceNext ?? node.on[edgeKey] ?? '@stop';
      if (node.type === 'notify' && node.as === 'card' && !r.forceNext) {
        // Aegis step 5 #3, enforced here too (an old compiled file): timeout pauses, stop ends the run
        if (edgeKey === 'timeout') next = '@pause';
        else if (edgeKey === 'stop' && next !== '@stop' && next !== '@pause') next = '@stop';
      }
      const s = r.verdict === 'pass' ? 0 : (streak.get(at) ?? 0) + 1;
      streak.set(at, s);
      const failExit = node.exit?.maxFailStreak !== undefined && s >= node.exit.maxFailStreak;
      if (r.aborted || failExit) next = null;
      if (node.type === 'model' && r.verdict === 'unavailable' && next === '@pause' && !r.aborted) {
        await this.#toast(ctx, at, `${entry.loopId}: paused, the local model is unavailable (${(r.detail ?? '').slice(0, 160)})`);
        toasted();
      }
      await this.#o.append('loop.node', {
        runId, loopId: entry.loopId, nodeId: at, type: node.type, visit, round, verdict: r.verdict, edge: edgeKey, next,
        durationMs: r.durationMs, evidenceRef: `loop-evidence:${runId}/${at}/${visit}`, effectiveAutonomy: eff.autonomy, ...(eff.capReason ? { capReason: eff.capReason } : {}),
        ...(r.detail ? { detail: r.detail } : {}), ...(r.choice ? { choice: r.choice } : {}), ...(r.evidence ? { evidence: r.evidence } : {}), ...(r.extra ?? {}),
      });
      last = { nodeId: at, verdict: r.verdict === 'error' && edgeKey === 'timeout' ? 'timeout' : r.verdict, failed: r.verdict === 'fail' || r.verdict === 'error' ? at : last.failed };
      if (edgeKey === 'timeout') last.verdict = 'timeout';
      if (r.aborted) {
        await closeRound();
        return { reason: ctx.top.stopping ?? 'paused', lastVerdict: r.verdict };
      }
      if (failExit) {
        await closeRound();
        return { reason: 'node-exit', detail: `${at}: exit.maxFailStreak (${node.exit!.maxFailStreak})`, lastVerdict: r.verdict };
      }
      at = next!;
    }
  }

  async #node(ctx: WalkCtx, node: CompiledNode, visit: number, fields: Record<string, string | number | undefined>, toasted: () => void, refs: { last?: string | undefined; failed?: string | undefined }): Promise<NodeResult> {
    const { entry, runId } = ctx;
    switch (node.type) {
      case 'check': {
        const pins = entry.hash!.argv.find((a) => a.node === node.id);
        const argv0: FilePin | undefined = pins?.argv0.real && pins.argv0.sha256 ? { real: pins.argv0.real, sha256: pins.argv0.sha256 } : undefined;
        const interp = pins?.argv0.interpreter;
        const interpreter: FilePin | undefined = interp?.real && interp.sha256 ? { real: interp.real, sha256: interp.sha256 } : undefined;
        const cli = node.builtin ? (this.#o.paradigmCli?.() ?? null) : null;
        if (node.builtin && !cli) return { verdict: 'error', edge: 'error', durationMs: 0, detail: 'no pinned paradigm CLI for loop builtins on this kernel' };
        const left = Math.max(1, Math.floor(ctx.meter.remainingMs() / 1000));
        const input: CheckExecInput = {
          runId: `${runId}-${node.id}-${visit}`.slice(0, 64).replace(/[^A-Za-z0-9_-]/g, '_'),
          repo: entry.repoRoot, home: this.#o.home,
          node: { id: node.id, ...(node.run ? { run: node.run } : {}), ...(node.builtin ? { builtin: node.builtin } : {}), ...(node.args ? { args: node.args } : {}), pass: node.pass, timeoutSec: Math.min(node.timeoutSec, left) },
          ...(argv0 ? { argv0 } : {}), ...(interpreter ? { interpreter } : {}), ...(cli ? { paradigmCli: cli } : {}),
          abort: ctx.abort.signal, keepOnError: true,
          ...(this.#o.platform ? { platform: this.#o.platform } : {}),
        };
        // step 10: in a run with a scratch worktree, checks copy the scratch (the act steps' edits), never the checkout
        const scratch = rootOf(ctx).scratch;
        if (scratch) {
          try {
            input.scratch = { tree: scratch.tree, files: listScratchFiles(scratch.tree) };
          } catch (err) {
            return { verdict: 'error', edge: 'error', durationMs: 0, detail: `the scratch could not be listed: ${err instanceof Error ? err.message.slice(0, 200) : 'failed'}` };
          }
        }
        const t0 = this.#now();
        const res = await (this.#o.check ?? runCheck)(input);
        const durationMs = Math.max(0, Math.round(res.durationMs ?? this.#now() - t0));
        ctx.meter.add(durationMs);
        const evidence = { stdoutTail: tail(res.evidence.stdoutTail), stderrTail: tail(res.evidence.stderrTail), redactions: res.evidence.redactions.length, exitCode: res.exitCode, ...(res.counts ? { counts: res.counts } : {}), ...(res.value !== undefined ? { value: res.value } : {}), ...(res.reason ? { reason: res.reason } : {}) };
        const aborted = res.reason === 'killed' || ctx.abort.signal.aborted;
        return { verdict: res.verdict, edge: res.verdict, durationMs, ...(res.detail ? { detail: res.detail.slice(0, 300) } : {}), evidence, ...(aborted ? { aborted } : {}) };
      }
      case 'model':
        return this.#model(ctx, node, fields, refs);
      case 'notify': {
        const text = renderNotifyText(node.text, fields, `${entry.loopId}: ${node.id}`);
        if (node.as === 'toast') {
          await this.#toast(ctx, node.id, text);
          toasted();
          return { verdict: 'pass', edge: 'pass', durationMs: 0 };
        }
        return this.#choice(ctx, node, text);
      }
      case 'call': {
        if (ctx.depth + 1 > LOOP_CALL_DEPTH_MAX) return { verdict: 'error', edge: 'error', durationMs: 0, detail: `call depth exceeds ${LOOP_CALL_DEPTH_MAX}` };
        const rc = this.#o.registry.resolveCall(entry.key, node.id);
        if (!rc.ok) return { verdict: 'error', edge: 'error', durationMs: 0, detail: rc.reason };
        const callee = this.#o.registry.entry(rc.calleeKey);
        if (!callee?.compiled || !callee.hash || callee.hash.contentHash !== rc.contentHash) return { verdict: 'error', edge: 'error', durationMs: 0, detail: `${node.callee} changed while resolving` };
        const later = unsupportedNodes(callee.compiled);
        if (later.length) return { verdict: 'error', edge: 'error', durationMs: 0, detail: `${node.callee}: ${ACT_NODES_LATER}` };
        if (hasActNodes(callee.compiled)) return { verdict: 'error', edge: 'error', durationMs: 0, detail: `${node.callee}: act nodes in a called loop are not built in 8.0 (only the top-level run has a scratch worktree)` };
        const noModel = this.#modelRefusal(callee.compiled);
        if (noModel) return { verdict: 'error', edge: 'error', durationMs: 0, detail: `${node.callee}: ${noModel}` };
        const cb = tightenBudgets(effectiveBudgets(callee.compiled.budgets, this.#caps.budgets), this.#o.registry.tightenedBudgets(callee.key, callee.hash?.contentHash));
        const childId = `${runId}-c${visit}${node.id.slice(0, 8)}`.slice(0, 64);
        const meter = new Meter(cb.run.wallMin * 60_000, cb.run.computeSec * 1000, () => this.#now(), ctx.meter, cb.run.tokens);
        const callTrigger = { type: 'call', runId, nodeId: node.id };
        const end = await this.#run({ entry: callee, compiled: callee.compiled, runId: childId, meter, depth: ctx.depth + 1, abort: ctx.abort, top: ctx.top, budgets: cb, parent: ctx, notes: new Map(), trigger: callTrigger }, callTrigger, runId);
        const verdict = end.reason === 'goal' ? 'pass' : end.reason === 'budget' ? 'unsure' : 'fail';
        const aborted = !!ctx.top.stopping || ctx.abort.signal.aborted;
        // durationMs 0: the callee's compute is on its own run's rows (and already on this run's meter)
        return { verdict, edge: verdict, durationMs: 0, detail: `${node.callee} ended ${end.reason}`, extra: { calleeRunId: childId, calleeComputeMs: meter.computeMs }, ...(aborted ? { aborted } : {}) };
      }
    }
  }

  /** A judge or summarize step (model-node.ts): local only, the verdict from the closed enum, budgets charged. */
  async #model(ctx: WalkCtx, node: Extract<CompiledNode, { type: 'model' }>, fields: Record<string, string | number | undefined>, refs: { last?: string | undefined; failed?: string | undefined }): Promise<NodeResult> {
    const port = this.#o.model;
    if (!port) return { verdict: 'unavailable', edge: 'unavailable', durationMs: 0, detail: NO_LOCAL_MODEL };
    let act: { tools: readonly unknown[]; protect: readonly string[]; maxSteps: number } | undefined;
    if (node.role === 'act') {
      if (!ctx.scratch) return { verdict: 'error', edge: 'error', durationMs: 0, detail: 'an act step needs its run\'s scratch worktree' };
      // an observe loop edits nothing (§2 autonomy): the act step does not run
      if (this.effective(ctx.entry).autonomy === 'observe') return { verdict: 'fail', edge: 'fail', durationMs: 0, detail: 'autonomy observe: act steps do not edit' };
      // Aegis H2: the kernel's protected set (goal.inputs, the config closure, argv-named paths, the callees') plus
      // node_modules and the loop definitions, refused at the tool layer with no card (G-LOOP-22)
      act = { tools: node.tools, protect: [...new Set([...ctx.entry.compiled!.protected, ...ACT_ALWAYS_PROTECTED])], maxSteps: node.limits.turns };
    }
    const blocks = resolveInputs(node.inputs, { notes: ctx.notes, ...(refs.last ? { last: refs.last } : {}), ...(refs.failed ? { failed: refs.failed } : {}), trigger: ctx.trigger, fields });
    const left = ctx.meter.remainingTokens();
    if (left <= 0) return { verdict: 'unsure', edge: 'unsure', durationMs: 0, detail: 'run.tokens spent' };
    // the reply cap per turn: the node's limit and the run's remaining tokens, halved so the one repair turn fits
    const maxTokens = Math.max(16, Math.floor(Math.min(node.limits.tokens, left) / 2));
    const rootKey = rootOf(ctx).entry.key;
    const t0 = this.#now();
    const res: ModelStepResult = await runModelStep({
      port, node, blocks, fields, maxTokens, signal: ctx.abort.signal,
      ref: () => this.#mint(ctx.entry.key, { runId: ctx.runId, nodeId: node.id, rootKey }),
      release: (r) => this.#minter?.release(r),
      remainingMs: () => ctx.meter.remainingMs(),
      retries: this.#caps.modelRetries, backoffMs: this.#caps.modelBackoffMs,
      ...(this.#o.diag ? { diag: this.#o.diag } : {}),
      ...(act ? { act } : {}),
    });
    const durationMs = Math.max(0, Math.round(this.#now() - t0));
    ctx.meter.add(durationMs);
    ctx.meter.addTokens(res.tokens);
    let verdict: string = res.verdict;
    let detail = res.detail;
    if ((verdict === 'pass' || verdict === 'fail') && res.tokens > node.limits.tokens) {
      verdict = 'unsure';
      detail = `limits.tokens (${node.limits.tokens}) exceeded: ${res.tokens}`;
    }
    // the model's free text is sensitive evidence (secret-scanned); the edge reads only the verdict
    const evidence: Record<string, unknown> = {
      inputs: res.receipt, attempts: res.attempts,
      ...(res.reply ? { reply: res.reply.text, redactions: res.reply.redactions } : {}),
      ...(res.summary !== undefined ? { summary: res.summary } : {}),
    };
    const extra: Record<string, unknown> = {
      model: { asked: 'local', used: res.model ?? null, escalated: false, ...(res.endpoint ? { endpoint: res.endpoint } : {}) },
      usage: { tokens: res.tokens }, role: node.role, ...(res.protectedHits?.length ? { protectedHits: res.protectedHits } : {}),
      ...(res.permitId ? { permitId: res.permitId } : {}), ...(res.hsid ? { hsid: res.hsid } : {}),
      ...(res.confidence !== undefined ? { confidence: res.confidence } : {}), ...(res.class !== undefined ? { class: res.class } : {}),
    };
    return { verdict, edge: verdict, durationMs, ...(detail ? { detail: detail.slice(0, 300) } : {}), evidence, extra, ...(res.aborted || ctx.abort.signal.aborted ? { aborted: true } : {}) };
  }

  /**
   * Step 10 propose: park what the run changed in its scratch and raise ONE `verdict` card (§3.3, §3.4, G-LOOP-23).
   * A run stopped from outside (pause, kill switch, untrust) parks its work and raises no card (§3.3 kill switch).
   */
  async #propose(ctx: WalkCtx, end: LoopRunEnd): Promise<void> {
    const s = ctx.scratch!;
    const { entry, runId } = ctx;
    const ids = { loopId: entry.loopId, runId };
    let parked;
    try {
      parked = parkScratch(s, { home: this.#o.home, message: ctx.compiled.land?.message ?? `loop ${entry.loopId}: proposed change`, loopTrailer: `${entry.loopId}@${entry.hash!.contentHash.replace(/^sha256:/, '').slice(0, 8)}`, now: () => this.#now() });
    } catch (err) {
      this.#o.diag?.('loops.park-failed', { runId, why: err instanceof Error ? err.message.slice(0, 200) : 'failed' });
      return;
    }
    if (!parked) return;
    const stopped = !!ctx.top.stopping || ctx.abort.signal.aborted;
    await this.#o.append('loop.parked', { ...ids, ref: parked.ref, sha: parked.sha, baseSha: s.headSha, reason: stopped ? (ctx.top.stopping ?? 'paused') : 'propose' });
    if (stopped) return;
    const eff = this.effective(entry);
    const hazards = landHazards(parked, [...(entry.compiled?.protected ?? []), ...ACT_ALWAYS_PROTECTED]);
    const reasons = proposeReasons(eff, hazards);
    const goalNode = ctx.compiled.goal?.node;
    const goal = goalNode ? { node: goalNode, verdict: ctx.notes.get(goalNode)?.verdict ?? null, met: end.reason === 'goal' } : null;
    const author = authorLabel(this.#o.registry.authoredBy(entry));
    const cardId = mintId('card');
    const paths = parked.changes.map((c) => c.path);
    try {
      await this.#o.broker.raise({
        kind: 'verdict', cardId, requestedBy: this.#o.kernelPrincipal, attended: false,
        detail: {
          op: 'loop.propose', origin: 'loop', loopId: entry.loopId, scope: entry.scope, repoKey: entry.repoKey, repo: entry.repoRoot, runId, authoredBy: author,
          ref: parked.ref, sha: parked.sha, baseSha: s.headSha, headRef: s.headRef, files: parked.changes.map((c) => ({ path: c.path, status: c.status })),
          goal, effectiveAutonomy: eff.autonomy, ...(eff.capReason ? { capReason: eff.capReason } : {}), hazards, reasons, diff: parked.diff, diffTruncated: parked.diffTruncated,
        },
        lines: proposeLines({ clampLine: loopClampLine(entry.loopId, author), runId, ending: end.terminal ?? end.reason, goal, parked, reasons }),
        effect: async (decision) => {
          // accept keeps the parked commit for the land step (11); reject drops the ref (the objects age out)
          if (decision === 'reject') dropParkedRef(this.#o.home, s.repo, parked.ref);
        },
      });
    } catch (err) {
      this.#o.diag?.('loops.propose-card-failed', { runId, why: err instanceof Error ? err.message.slice(0, 200) : 'refused' });
      return;
    }
    await this.#o.append('loop.proposed', { ...ids, cardId, paths, why: hazards.length ? 'land-hazard' : eff.autonomy === 'propose' ? 'autonomy' : 'auto-land-later', hazards: hazards.map((h) => h.kind), ref: parked.ref });
  }

  async #toast(ctx: WalkCtx, nodeId: string | undefined, text: string): Promise<void> {
    await this.#o.append('loop.notified', { runId: ctx.runId, loopId: ctx.entry.loopId, ...(nodeId ? { nodeId } : {}), as: 'toast', text });
    try {
      this.#o.toast?.({ loopId: ctx.entry.loopId, runId: ctx.runId, ...(nodeId ? { nodeId } : {}), repo: ctx.entry.repoRoot, text });
    } catch {
      /* the GUI port never stops a run */
    }
  }

  /** A decide node: a loop-choice card; the answer is the edge key (no answer by the TTL: `timeout`). */
  async #choice(ctx: WalkCtx, node: Extract<CompiledNode, { type: 'notify' }>, text: string): Promise<NodeResult> {
    const choices = node.choices ?? [];
    const bad = choices.filter((c) => c !== 'continue' && c !== 'stop');
    if (bad.length) return { verdict: 'error', edge: 'error', durationMs: 0, forceNext: '@stop', detail: `a loop-choice card offers continue and stop only (not ${bad.join(', ')})` };
    const ttl = Math.max(1000, Math.min(this.#caps.choiceTtlMs, ctx.meter.remainingMs()));
    const cardId = mintId('card');
    let settle!: (c: string) => void;
    const answered = new Promise<string>((res) => (settle = res));
    const timer = setTimeout(() => settle('timeout'), ttl);
    timer.unref?.();
    const onAbort = (): void => settle('aborted');
    ctx.abort.signal.addEventListener('abort', onAbort, { once: true });
    try {
      await this.#o.broker.raise({
        kind: 'loop-choice', cardId, requestedBy: this.#o.kernelPrincipal, attended: false,
        detail: { loopId: ctx.entry.loopId, scope: ctx.entry.scope, repoKey: ctx.entry.repoKey, repo: ctx.entry.repoRoot, runId: ctx.runId, nodeId: node.id, origin: 'loop', authoredBy: authorLabel(this.#o.registry.authoredBy(ctx.entry)) },
        // ^loop-origin-clamp: the kernel line names the loop and who authored it (§3.4; step 12: from the request rows)
        lines: [loopClampLine(ctx.entry.loopId, authorLabel(this.#o.registry.authoredBy(ctx.entry))), `Run ${ctx.runId}`, text, 'Continue lets the loop go on (Touch ID); stop ends this run'],
        decisions: choices as RaiseInput['decisions'], timeoutMs: ttl,
        effect: async (decision) => settle(decision),
      });
    } catch (err) {
      clearTimeout(timer);
      ctx.abort.signal.removeEventListener('abort', onAbort);
      return { verdict: 'error', edge: 'error', durationMs: 0, forceNext: '@stop', detail: `the loop-choice card could not be raised: ${err instanceof Error ? err.message.slice(0, 200) : 'refused'}` };
    }
    await this.#o.append('loop.notified', { runId: ctx.runId, loopId: ctx.entry.loopId, nodeId: node.id, as: 'card', cardId, text });
    const choice = await answered;
    clearTimeout(timer);
    ctx.abort.signal.removeEventListener('abort', onAbort);
    if (choice === 'aborted') return { verdict: 'error', edge: 'aborted', durationMs: 0, aborted: true, extra: { cardId } };
    const verdict = choice === 'continue' ? 'pass' : choice === 'stop' ? 'fail' : 'unavailable';
    return { verdict, edge: choice, durationMs: 0, choice, extra: { cardId } };
  }

  // ── Pause, resume, kill switch ──────────────────────────────────────────────

  /** Pause one loop (a tightening, no presence): its run, if any, stops before its next step (the check is killed). */
  async pause(key: string, by: string, reason = 'human', connId?: string): Promise<{ paused: boolean; stopped: boolean }> {
    const e = this.#o.registry.verify(key) ?? this.#o.registry.entry(key);
    if (!e) throw new RpcRefusal('NOT_FOUND', 'not-found', `no loop ${key.split('/').pop()}`);
    const s = this.#o.registry.stateOf(e);
    const a = this.#active.get(key);
    this.#dequeue(key);
    if (a) {
      a.stopping ??= reason === 'kill-switch' ? 'kill-switch' : 'paused';
      a.abort.abort();
    }
    if (s.state === 'paused') return { paused: false, stopped: !!a };
    await this.#o.append('loop.paused', { loopId: e.loopId, scope: e.scope, repoKey: e.repoKey, reason, by, ...(a ? { runId: a.runId } : {}) }, connId ? { connId } : undefined);
    return { paused: true, stopped: !!a };
  }

  /** The kill switch: stop every run (process groups killed) and pause every trusted loop, no presence. */
  async pauseAll(by: string, connId?: string): Promise<{ paused: number; stopped: number }> {
    // Aegis step 5 #4: the flag and the aborts happen synchronously, before any await: no run starts in between
    this.#killing = true;
    this.#queue.splice(0);
    const stopped = this.#active.size;
    const keys = new Set<string>();
    for (const a of this.#active.values()) {
      a.stopping = 'kill-switch';
      a.rerun = false;
      a.abort.abort();
      keys.add(a.key);
    }
    this.#emit({ type: 'kill' }); // #loop-timers drops every loop timer now, before any row is written
    try {
      // step 12 (Aegis): ONE kill-epoch row first, covering every loop (trusted, paused or untrusted): a pause made
      // before it (an agent's own) no longer lets that agent resume; only a human with presence lifts it
      await this.#o.append('loop.paused', { all: true, reason: 'kill-switch', by }, connId ? { connId } : undefined);
      this.#o.registry.scan();
      for (const e of this.#o.registry.entries()) if (this.#o.registry.stateOf(e).state === 'trusted') keys.add(e.key);
      for (const k of keys) this.#killHeld.add(k);
      let paused = 0;
      for (const key of keys) {
        const e = this.#o.registry.entry(key);
        if (!e) continue;
        await this.#o.append('loop.paused', { loopId: e.loopId, scope: e.scope, repoKey: e.repoKey, reason: 'kill-switch', by }, connId ? { connId } : undefined);
        paused++;
      }
      return { paused, stopped };
    } finally {
      this.#killing = false;
    }
  }

  /**
   * Resume: after a human (or agent) pause, at once; after a kernel pause (kill switch, budget, node exit, timeout,
   * unavailable, thrash, strictness), only through a loop-choice card decided `continue` with fresh presence (Aegis
   * M3). A content or closure change is not resumed: it takes a new trust.
   */
  async resume(key: string, asker: LoopAsker): Promise<unknown> {
    const e = this.#o.registry.verify(key) ?? this.#o.registry.entry(key);
    if (!e) throw new RpcRefusal('NOT_FOUND', 'not-found', `no loop ${key.split('/').pop()}`);
    const s = this.#o.registry.stateOf(e);
    if (s.state === 'waiting-trust') throw new RpcRefusal('FORBIDDEN', 'needs-trust', `loop ${e.loopId} changed (${s.reason ?? 'content-changed'}): trust the new version (gnomon loop trust) instead of resuming`);
    if (s.state !== 'paused') return { resumed: false, state: s.state };
    const ids = { loopId: e.loopId, scope: e.scope, repoKey: e.repoKey };
    if (!KERNEL_PAUSES_NEED_PRESENCE.has(s.reason ?? '')) {
      await this.#o.append('loop.resumed', { ...ids, by: asker.principal!, reason: s.reason ?? 'human' }, { connId: asker.connId });
      this.#killHeld.delete(key);
      this.#emit({ type: 'resumed', key });
      return { resumed: true };
    }
    const cardId = mintId('card');
    const card = await this.#o.broker.raise({
      kind: 'loop-choice', cardId, requestedBy: asker.principal!, attended: true,
      detail: { ...ids, repo: e.repoRoot, resume: true, pausedFor: s.reason },
      lines: [`Resume loop ${e.loopId}?`, `It was paused by the kernel (${s.reason}). Resuming lets it run on its triggers again`, 'Continue needs Touch ID; stop keeps it paused'],
      decisions: ['continue', 'stop'], handOnly: true, timeoutMs: this.#caps.choiceTtlMs,
      effect: async (decision, c) => {
        if (decision !== 'continue') return;
        await this.#o.append('loop.resumed', { ...ids, by: asker.principal!, cardId, reason: s.reason }, { connId: c.connId ?? asker.connId });
        this.#killHeld.delete(key);
        this.#emit({ type: 'resumed', key });
      },
    });
    return { pending: true, cardId: card.cardId, pausedFor: s.reason };
  }

  /**
   * Daemon exit: abort every run NOW (check-exec SIGKILLs each check's process group synchronously), so no check
   * outlives the kernel. No row is written; the next boot's recover() closes the runs `daemon-restart`.
   */
  abortAll(): void {
    this.#queue.splice(0);
    for (const a of this.#active.values()) {
      a.stopping ??= 'daemon-restart';
      a.rerun = false;
      a.abort.abort();
    }
  }

  #dequeue(key: string): void {
    for (let i = this.#queue.length - 1; i >= 0; i--) if (this.#queue[i]!.key === key) this.#queue.splice(i, 1);
  }

  // ── The human's requests ────────────────────────────────────────────────────

  /** request.loop.run | pause | resume from the human (gui or device connection), as the dispatcher stamped them. */
  async request(asker: LoopAsker, kind: string, payload: unknown): Promise<unknown> {
    if (asker.principalClass !== 'human' || (asker.credential !== 'gui' && asker.credential !== 'device') || !asker.principal) {
      throw new RpcRefusal('FORBIDDEN', 'matrix', `${kind} is the human's, on a gui or device connection`);
    }
    if (kind === 'request.loop.pause' && isObj(payload) && 'all' in payload) {
      if (payload.all !== true || Object.keys(payload).length !== 1) throw new RpcRefusal('BAD_REQUEST', 'bad-params', 'the kill switch is request.loop.pause{all:true} alone');
      return this.pauseAll(asker.principal, asker.connId);
    }
    const t = parseLoopTarget(this.#o.registry, kind, payload, kind === 'request.loop.budget' ? ['budgets'] : []);
    this.#o.registry.scan();
    const e = this.#o.registry.find(t.loopId, t.scope, t.repoKey);
    if (!e) throw new RpcRefusal('NOT_FOUND', 'not-found', `no ${t.scope} loop ${t.loopId}`);
    if (kind === 'request.loop.run') {
      const r = this.start(e.key, { type: 'manual', by: asker.principal });
      return 'runId' in r && 'done' in r ? { runId: r.runId, started: true } : r;
    }
    if (kind === 'request.loop.pause') return this.pause(e.key, asker.principal, 'human', asker.connId);
    if (kind === 'request.loop.resume') return this.resume(e.key, asker);
    if (kind === 'request.loop.budget') return this.tighten(e, (payload as Record<string, unknown>).budgets, asker);
    throw new RpcRefusal('BAD_REQUEST', 'bad-params', `unknown loop request ${kind.slice(0, 64)}`);
  }

  /**
   * LP8 (#gui-loops, steer-stop): a human tightens a loop's caps. Narrowing only: every field must be at or below the
   * cap in force (the file's, or an earlier tightening), so no presence; a looser cap is a change to the loop file and
   * waits for a loop-trust card. The row holds for the current content hash (the registry folds it).
   */
  async tighten(e: LoopEntry, raw: unknown, asker: LoopAsker): Promise<unknown> {
    const want = parseTightened(raw);
    if (!want) throw new RpcRefusal('BAD_REQUEST', 'bad-params', 'budgets is {run?: {rounds, wallMin, tokens, computeSec}, day?: {runs, tokens, computeSec}} of whole numbers above 0');
    if (!e.compiled || !e.hash) throw new RpcRefusal('ENGINE', 'not-compiled', `loop ${e.loopId} does not compile`);
    const cur = tightenBudgets(effectiveBudgets(e.compiled.budgets, this.#caps.budgets), this.#o.registry.tightenedBudgets(e.key, e.hash.contentHash));
    const looser: string[] = [];
    for (const [f, x] of Object.entries(want.run)) if (x > cur.run[f as keyof LoopBudgets['run']]) looser.push(`run.${f}`);
    for (const [f, x] of Object.entries(want.day)) if (x > cur.day[f as keyof LoopBudgets['day']]) looser.push(`day.${f}`);
    if (looser.length) throw new RpcRefusal('FORBIDDEN', 'needs-trust', `raising ${looser.join(', ')} is a change to the loop file: it waits for a loop-trust card`);
    await this.#o.append('loop.budget.tightened', { loopId: e.loopId, scope: e.scope, repoKey: e.repoKey, contentHash: e.hash.contentHash, budgets: want, by: asker.principal! }, { connId: asker.connId });
    return { tightened: true, budgets: tightenBudgets(cur, want) };
  }

  // ── Reads ───────────────────────────────────────────────────────────────────

  running(): Array<{ key: string; runId: string; rerun: boolean }> {
    return [...this.#active.values()].map((a) => ({ key: a.key, runId: a.runId, rerun: a.rerun }));
  }

  /** Resolves when no run is in flight (tests, shutdown). */
  async idle(): Promise<void> {
    while (this.#active.size) await Promise.allSettled([...this.#active.values()].map((a) => a.done));
  }

  /** For status.loops: running and queued runs and the recent ledger (no evidence: that stays on the rows). */
  status(): Record<string, unknown> {
    return {
      running: this.running(),
      queued: this.#queue.map((q) => q.key),
      caps: { repo: this.#caps.repo, global: this.#caps.global, dayRuns: this.#caps.dayRuns, dayComputeSec: this.#caps.dayComputeSec },
      runs: this.#o.ledger.recent({ limit: 50 }).map((r) => ({ ...r, nodes: r.nodes.slice(0, 64) })),
    };
  }
}
