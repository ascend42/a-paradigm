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
 *   - **model** nodes are not built yet (step 8): their verdict is `unavailable` and they take that edge.
 *   - Act (model `role: act`) and write (`effect: write`) nodes are not built yet (step 10): a loop with one is
 *     refused at run start. Effective autonomy is the loop's own until strictness lands (step 9).
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
 */
import { randomBytes } from 'node:crypto';
import { mintId, sanitizeDisplayText, type CardV1 } from '@a-company/gnomon-contracts';
import { LOOP_BUDGET_DEFAULTS, LOOP_CALL_DEPTH_MAX, type CompiledLoop, type CompiledNode, type LoopBudgets } from '../../loops/index.js';
import type { RaiseInput } from '../broker/broker.js';
import { LOOP_CHECK_BACKENDS } from '../sandbox/loop-check.js';
import { RpcRefusal } from '../socket/rpc.js';
import { runCheck, type CheckExecInput, type CheckResult, type FilePin } from './check-exec.js';
import { dayKeyOf, type LoopLedger } from './ledger.js';
import type { LoopEntry, LoopRegistry } from './registry.js';
import { parseLoopTarget, type LoopAsker } from './trust.js';

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
  /** budget fields a compiled loop lacks */
  budgets: LoopBudgets;
}
export const LOOP_GLOBAL_CAPS: Readonly<LoopGlobalCaps> = Object.freeze({ repo: 2, global: 4, dayRuns: 240, dayComputeSec: 6 * 3600, choiceTtlMs: 3600_000, budgets: LOOP_BUDGET_DEFAULTS });
/** evidence tails kept on the loop.node row (each) */
export const LOOP_NODE_EVIDENCE_BYTES = 16 * 1024;
export const MODEL_NODES_LATER = 'model nodes land in step 8 (local model nodes, LP5)';
export const ACT_NODES_LATER = 'act and write nodes land in step 10 (scratch worktree, LP6a)';
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
  caps?: Partial<LoopGlobalCaps>;
  clock?: () => number;
  platform?: string;
  diag?: (event: string, data: Record<string, unknown>) => void;
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
  readonly startMs: number;
  constructor(
    readonly wallMs: number,
    readonly computeLimitMs: number,
    readonly clock: () => number,
    readonly parent?: Meter,
  ) {
    this.startMs = clock();
  }
  add(ms: number): void {
    this.computeMs += ms;
    this.parent?.add(ms);
  }
  exceeded(): string | null {
    if (this.clock() - this.startMs >= this.wallMs) return `run.wallMin (${Math.round(this.wallMs / 60_000)} min)`;
    if (this.computeMs >= this.computeLimitMs) return `run.computeSec (${Math.round(this.computeLimitMs / 1000)} s)`;
    return this.parent?.exceeded() ?? null;
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

/** Nodes this build cannot run (act and write: step 10). */
export function unsupportedNodes(c: CompiledLoop): string[] {
  return c.nodes.filter((n) => (n.type === 'model' && n.role === 'act') || (n.type === 'check' && n.effect === 'write')).map((n) => n.id);
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

  constructor(o: LoopRunnerOptions) {
    this.#o = o;
    this.#caps = { ...LOOP_GLOBAL_CAPS, ...(o.caps ?? {}) };
  }

  #now(): number {
    return (this.#o.clock ?? Date.now)();
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
    const platform = this.#o.platform ?? process.platform;
    if (!LOOP_CHECK_BACKENDS[platform]) throw new RpcRefusal('ENGINE', 'sandbox-unavailable', `no loop-check sandbox on ${platform}: loops run on macOS until the Windows backend (W5)`, { platform });
    const budgets = effectiveBudgets(entry.compiled.budgets, this.#caps.budgets);
    const today = dayKeyOf(this.#now());
    const mine = this.#o.ledger.day(today, key);
    const all = this.#o.ledger.day(today);
    if (mine.runs >= budgets.day.runs) throw new RpcRefusal('ENGINE', 'budget', `loop ${entry.loopId} used its ${budgets.day.runs} runs today (budgets.day.runs)`, { cap: 'day.runs' });
    if (mine.computeMs >= budgets.day.computeSec * 1000) throw new RpcRefusal('ENGINE', 'budget', `loop ${entry.loopId} used its ${budgets.day.computeSec} compute seconds today (budgets.day.computeSec)`, { cap: 'day.computeSec' });
    if (all.runs >= this.#caps.dayRuns) throw new RpcRefusal('ENGINE', 'budget', `loops used the global ${this.#caps.dayRuns} runs today`, { cap: 'global.dayRuns' });
    if (all.computeMs >= this.#caps.dayComputeSec * 1000) throw new RpcRefusal('ENGINE', 'budget', `loops used the global ${this.#caps.dayComputeSec} compute seconds today`, { cap: 'global.dayComputeSec' });
    const inRepo = [...this.#active.values()].filter((a) => a.repoKey === entry.repoKey).length;
    if (inRepo >= this.#caps.repo || this.#active.size >= this.#caps.global) {
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
    return { runId, done: a.done };
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
  }

  async #top(a: Active, entry: LoopEntry, budgets: LoopBudgets, trigger: Record<string, unknown>): Promise<LoopRunEnd> {
    const meter = new Meter(budgets.run.wallMin * 60_000, budgets.run.computeSec * 1000, () => this.#now());
    return this.#run({ entry, compiled: entry.compiled!, runId: a.runId, meter, depth: 0, abort: a.abort, top: a, budgets }, trigger);
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
    try {
      return await this.#runLive(ctx, ids, trigger, parentRunId);
    } finally {
      this.#live.delete(runId);
    }
  }

  async #runLive(ctx: WalkCtx, ids: { runId: string; loopId: string; scope: string; repoKey: string }, trigger: Record<string, unknown>, parentRunId: string | undefined): Promise<LoopRunEnd> {
    const { entry, runId } = ctx;
    await this.#o.append('loop.run.started', { ...ids, contentHash: entry.hash!.contentHash, trigger, budgets: ctx.budgets, autonomy: ctx.compiled.autonomy, rootKey: rootOf(ctx).entry.key, ...(parentRunId ? { parentRunId } : {}) });
    let end: LoopRunEnd;
    let toasted = false;
    let round = 1;
    try {
      const r = await this.#walk(ctx, (n) => (round = n), () => (toasted = true));
      end = r;
    } catch (err) {
      end = { reason: 'error', detail: err instanceof Error ? err.message.slice(0, 300) : 'the runner failed' };
      this.#o.diag?.('loops.run-failed', { runId, why: end.detail! });
    }
    if (end.terminal === '@pause') {
      await this.#o.append('loop.paused', { loopId: entry.loopId, scope: entry.scope, repoKey: entry.repoKey, runId, reason: end.detail ?? 'node-exit', by: 'kernel' });
      ctx.top.rerun = false;
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
    const over = ctx.meter.exceeded();
    if (over) return { reason: 'budget', detail: over };
    const today = dayKeyOf(this.#now());
    // a callee is funded from its root caller (§3.4): the root's key is charged and its day.computeSec applies
    const root = rootOf(ctx);
    if (this.#o.ledger.day(today, root.entry.key).computeMs >= root.budgets.day.computeSec * 1000) return { reason: 'budget', detail: `day.computeSec (${root.budgets.day.computeSec} s)` };
    if (this.#o.ledger.day(today).computeMs >= this.#caps.dayComputeSec * 1000) return { reason: 'budget', detail: `global dayComputeSec (${this.#caps.dayComputeSec} s)` };
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
    const closeRound = async (): Promise<void> => {
      await this.#o.append('loop.round', { runId, loopId: entry.loopId, round, nodeVisits: roundVisits, escalations: 0 });
    };
    for (;;) {
      if (at === '@goal' || at === '@stop' || at === '@pause') {
        await closeRound();
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
        await closeRound();
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
      const r = await this.#node(ctx, node, visit, fields, toasted);
      const edgeKey = r.edge;
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
      await this.#o.append('loop.node', {
        runId, loopId: entry.loopId, nodeId: at, type: node.type, visit, round, verdict: r.verdict, edge: edgeKey, next,
        durationMs: r.durationMs, evidenceRef: `loop-evidence:${runId}/${at}/${visit}`, effectiveAutonomy: compiled.autonomy,
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

  async #node(ctx: WalkCtx, node: CompiledNode, visit: number, fields: Record<string, string | number | undefined>, toasted: () => void): Promise<NodeResult> {
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
        const t0 = this.#now();
        const res = await (this.#o.check ?? runCheck)(input);
        const durationMs = Math.max(0, Math.round(res.durationMs ?? this.#now() - t0));
        ctx.meter.add(durationMs);
        const evidence = { stdoutTail: tail(res.evidence.stdoutTail), stderrTail: tail(res.evidence.stderrTail), redactions: res.evidence.redactions.length, exitCode: res.exitCode, ...(res.counts ? { counts: res.counts } : {}), ...(res.value !== undefined ? { value: res.value } : {}), ...(res.reason ? { reason: res.reason } : {}) };
        const aborted = res.reason === 'killed' || ctx.abort.signal.aborted;
        return { verdict: res.verdict, edge: res.verdict, durationMs, ...(res.detail ? { detail: res.detail.slice(0, 300) } : {}), evidence, ...(aborted ? { aborted } : {}) };
      }
      case 'model':
        return { verdict: 'unavailable', edge: 'unavailable', durationMs: 0, detail: MODEL_NODES_LATER };
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
        const cb = effectiveBudgets(callee.compiled.budgets, this.#caps.budgets);
        const childId = `${runId}-c${visit}${node.id.slice(0, 8)}`.slice(0, 64);
        const meter = new Meter(cb.run.wallMin * 60_000, cb.run.computeSec * 1000, () => this.#now(), ctx.meter);
        const end = await this.#run({ entry: callee, compiled: callee.compiled, runId: childId, meter, depth: ctx.depth + 1, abort: ctx.abort, top: ctx.top, budgets: cb, parent: ctx }, { type: 'call', runId, nodeId: node.id }, runId);
        const verdict = end.reason === 'goal' ? 'pass' : end.reason === 'budget' ? 'unsure' : 'fail';
        const aborted = !!ctx.top.stopping || ctx.abort.signal.aborted;
        // durationMs 0: the callee's compute is on its own run's rows (and already on this run's meter)
        return { verdict, edge: verdict, durationMs: 0, detail: `${node.callee} ended ${end.reason}`, extra: { calleeRunId: childId, calleeComputeMs: meter.computeMs }, ...(aborted ? { aborted } : {}) };
      }
    }
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
        detail: { loopId: ctx.entry.loopId, scope: ctx.entry.scope, repoKey: ctx.entry.repoKey, repo: ctx.entry.repoRoot, runId: ctx.runId, nodeId: node.id, origin: 'loop' },
        lines: [`Raised by loop ${ctx.entry.loopId} (run ${ctx.runId})`, text, 'Continue lets the loop go on (Touch ID); stop ends this run'],
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
    try {
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
    const t = parseLoopTarget(this.#o.registry, kind, payload);
    this.#o.registry.scan();
    const e = this.#o.registry.find(t.loopId, t.scope, t.repoKey);
    if (!e) throw new RpcRefusal('NOT_FOUND', 'not-found', `no ${t.scope} loop ${t.loopId}`);
    if (kind === 'request.loop.run') {
      const r = this.start(e.key, { type: 'manual', by: asker.principal });
      return 'runId' in r && 'done' in r ? { runId: r.runId, started: true } : r;
    }
    if (kind === 'request.loop.pause') return this.pause(e.key, asker.principal, 'human', asker.connId);
    if (kind === 'request.loop.resume') return this.resume(e.key, asker);
    throw new RpcRefusal('BAD_REQUEST', 'bad-params', `unknown loop request ${kind.slice(0, 64)}`);
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
