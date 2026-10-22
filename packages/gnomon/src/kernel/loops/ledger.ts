/**
 * @symbol #loop-runner
 *
 * The run ledger (docs/specs/gnomon-loops.md §4 "#loop-runner", "Restart"; LL6). A PURE fold of the runner's
 * kernel-signed rows, so everything the runner knows after a restart comes back from the log:
 *
 *   loop.run.started{runId, loopId, scope, repoKey, contentHash, trigger, budgets, parentRunId?}
 *   loop.node{runId, loopId, nodeId, type, visit, round, verdict, edge, next, durationMs, evidenceRef, evidence?, …}
 *   loop.round{runId, loopId, round, nodeVisits, escalations}
 *   loop.notified{runId, loopId, nodeId, as, text, cardId?}
 *   loop.run.ended{runId, loopId, scope, repoKey, reason, terminal?, rounds, computeMs}  (terminal: the @goal/@stop/@pause
 *                                                                                     the walk reached, when it did)
 *
 *   - **Open runs** (a start with no end) are what the boot sweep closes `daemon-restart`; nothing resumes mid-step.
 *   - **Day windows** come from chain time (the row's `at`), as the fuse's do: top-level runs started and compute
 *     spent per loop key and globally, per local calendar day. The counters are their OWN fold, never touched by the
 *     eviction of run records (Aegis step 5 #1), and a callee's compute is charged to the ROOT caller's key (`rootKey`
 *     on loop.run.started, else the parent run's), so the caller's day.computeSec funds its calls (§3.4).
 *   - **Replay (G-LOOP-17).** Every loop.node row names the edge it took (`edge`, the verdict or choice key) and
 *     where it went (`next`); `replayLoopRuns` reproduces each run's walk from the rows alone and reports a
 *     divergence when a row's `next` is not the node the following row ran, or the end does not match the terminal.
 *
 * - **Model tokens (step 8).** A loop model step's spawn permit names the paying loop (`permit.grant{permit.scope.loop}`
 *   = the root caller's key); the ledger maps each such permitId to that key and folds the permit's `budget.usage`
 *   tokens into the same per-day counters (the key and '*'), so `day.tokens` and the global day cap survive a restart.
 *
 * Only rows from the kernel principal (and, when given, a kernel key) are folded: a forged row changes nothing.
 */
import type { LoopRow } from './registry.js';

export const LOOP_RUN_KINDS: readonly string[] = Object.freeze(['loop.run.started', 'loop.node', 'loop.round', 'loop.notified', 'loop.run.ended']);
/** The fuse rows a loop model step's tokens come from (folded by permitId; step 8). */
export const LOOP_TOKEN_KINDS: readonly string[] = Object.freeze(['permit.grant', 'budget.usage']);
/** permitIds remembered for the token fold (oldest dropped first). */
export const LOOP_LEDGER_MAX_PERMITS = 4096;
/** Runs kept in memory for status and the CLI (older ones stay in the log). */
export const LOOP_LEDGER_MAX_RUNS = 500;
/** loop.node records kept per run in memory (the log keeps all). */
export const LOOP_LEDGER_MAX_NODES = 256;
/** Day counters kept (today's window, plus slack for a clock change). */
export const LOOP_LEDGER_DAYS = 8;

export interface LoopNodeRecord {
  nodeId: string;
  type?: string;
  visit: number;
  round?: number;
  verdict: string;
  edge?: string;
  next?: string | null;
  durationMs?: number;
  evidenceRef?: string;
  detail?: string;
  choice?: string;
  at?: string;
}

export interface LoopRunRecord {
  runId: string;
  loopId: string;
  scope?: string;
  repoKey?: string;
  /** scope/repoKey/loopId (the registry key) */
  key?: string;
  /** the key whose day budget pays for this run (its own, or the root caller's for a callee) */
  rootKey?: string;
  contentHash?: string;
  trigger?: unknown;
  parentRunId?: string;
  startedAt?: string;
  endedAt?: string;
  reason?: string;
  rounds: number;
  computeMs: number;
  nodes: LoopNodeRecord[];
  notified: number;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

/** The local calendar day of an ISO instant (the day window's key). */
export function dayKeyOf(iso: string | number | undefined): string {
  const d = new Date(iso ?? Date.now());
  if (Number.isNaN(d.getTime())) return 'unknown';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export interface LoopLedgerOptions {
  kernelPrincipal: string;
  isKernelKey?: (keyId: string) => boolean;
  max?: number;
}

export class LoopLedger {
  readonly #o: LoopLedgerOptions;
  readonly #runs = new Map<string, LoopRunRecord>();
  /** day → (key | '*') → counters; independent of the run records (never evicted with them) */
  readonly #days = new Map<string, Map<string, { runs: number; computeMs: number; tokens: number }>>();
  /** thrash (§3.5): per loop key, the last round's evidence hash and how many rounds in a row carried it */
  readonly #thrash = new Map<string, { hash: string; same: number }>();
  /** a loop step's permitId → the paying loop key (permit.grant scope.loop) */
  readonly #permits = new Map<string, string>();

  constructor(o: LoopLedgerOptions) {
    this.#o = o;
  }

  seed(rows: Iterable<LoopRow>): void {
    for (const r of rows) this.observe(r);
  }

  observe(r: LoopRow): void {
    const tokenRow = LOOP_TOKEN_KINDS.includes(r.kind);
    if (!LOOP_RUN_KINDS.includes(r.kind) && !tokenRow) return;
    if (r.principal !== this.#o.kernelPrincipal) return;
    if (this.#o.isKernelKey && (typeof r.keyId !== 'string' || !this.#o.isKernelKey(r.keyId))) return;
    const p = r.payload;
    if (!isObj(p)) return;
    if (tokenRow) return this.#token(r.kind, p, r.at);
    const runId = str(p.runId);
    const loopId = str(p.loopId);
    if (!runId || !loopId) return;
    if (r.kind === 'loop.run.started') {
      if (this.#runs.has(runId)) return;
      const scope = str(p.scope);
      const repoKey = str(p.repoKey);
      const key = scope && repoKey ? `${scope}/${repoKey}/${loopId}` : undefined;
      const parentRunId = str(p.parentRunId);
      const rootKey = str(p.rootKey) ?? (parentRunId ? this.#runs.get(parentRunId)?.rootKey : undefined) ?? key;
      this.#runs.set(runId, {
        runId, loopId, ...(scope ? { scope } : {}), ...(repoKey ? { repoKey } : {}), ...(key ? { key } : {}), ...(rootKey ? { rootKey } : {}),
        ...(str(p.contentHash) ? { contentHash: str(p.contentHash)! } : {}), ...(p.trigger !== undefined ? { trigger: p.trigger } : {}),
        ...(parentRunId ? { parentRunId } : {}), ...(r.at ? { startedAt: r.at } : {}),
        rounds: 0, computeMs: 0, nodes: [], notified: 0,
      });
      if (!parentRunId) this.#bump(dayKeyOf(r.at), rootKey, 1, 0);
      const max = this.#o.max ?? LOOP_LEDGER_MAX_RUNS;
      while (this.#runs.size > max) {
        // drop the oldest ENDED run; open runs are never dropped (the restart sweep and the counters need them)
        const old = [...this.#runs.values()].find((x) => x.reason !== undefined);
        if (!old) break;
        this.#runs.delete(old.runId);
      }
      return;
    }
    const run = this.#runs.get(runId);
    if (!run) return;
    if (r.kind === 'loop.node') {
      const nodeId = str(p.nodeId);
      const verdict = str(p.verdict);
      if (!nodeId || !verdict) return;
      const d = num(p.durationMs);
      if (d !== undefined && d > 0) {
        run.computeMs += d;
        this.#bump(dayKeyOf(r.at), run.rootKey, 0, d);
      }
      if (run.nodes.length < LOOP_LEDGER_MAX_NODES) {
        run.nodes.push({
          nodeId, verdict, visit: num(p.visit) ?? 0, ...(str(p.type) ? { type: str(p.type)! } : {}), ...(num(p.round) !== undefined ? { round: num(p.round)! } : {}),
          ...(str(p.edge) ? { edge: str(p.edge)! } : {}), ...(p.next === null || typeof p.next === 'string' ? { next: p.next } : {}),
          ...(d !== undefined ? { durationMs: d } : {}), ...(str(p.evidenceRef) ? { evidenceRef: str(p.evidenceRef)! } : {}),
          ...(str(p.detail) ? { detail: str(p.detail)! } : {}), ...(str(p.choice) ? { choice: str(p.choice)! } : {}), ...(r.at ? { at: r.at } : {}),
        });
      }
    } else if (r.kind === 'loop.round') {
      run.rounds = Math.max(run.rounds, num(p.round) ?? 0);
      const h = str(p.evidenceHash);
      if (h && run.key) {
        const t = this.#thrash.get(run.key);
        this.#thrash.set(run.key, { hash: h, same: t?.hash === h ? t.same + 1 : 1 });
      }
    } else if (r.kind === 'loop.notified') {
      run.notified++;
    } else if (r.kind === 'loop.run.ended') {
      if (run.reason !== undefined) return;
      run.reason = str(p.reason) ?? 'error';
      // a thrash end pauses the loop (only a human resumes it): the streak starts over after it
      if (run.reason === 'thrash' && run.key) this.#thrash.delete(run.key);
      if (r.at) run.endedAt = r.at;
    }
  }

  /** The thrash streak a loop carries into its next run (null: none); a thrash end resets it. */
  thrash(key: string): { hash: string; same: number } | null {
    return this.#thrash.get(key) ?? null;
  }

  run(runId: string): LoopRunRecord | null {
    return this.#runs.get(runId) ?? null;
  }

  /** Started with no end (the restart sweep closes these `daemon-restart`). */
  open(): LoopRunRecord[] {
    return [...this.#runs.values()].filter((r) => r.reason === undefined);
  }

  /** Newest first; optionally one loop (by key or by id). */
  recent(o: { key?: string; loopId?: string; limit?: number } = {}): LoopRunRecord[] {
    const out = [...this.#runs.values()].filter((r) => (!o.key || r.key === o.key) && (!o.loopId || r.loopId === o.loopId)).reverse();
    return out.slice(0, o.limit ?? 50);
  }

  #token(kind: string, p: Record<string, unknown>, at: string | undefined): void {
    if (kind === 'permit.grant') {
      const permit = isObj(p.permit) ? p.permit : null;
      const scope = permit && isObj(permit.scope) ? permit.scope : null;
      const loop = scope ? str(scope.loop) : undefined;
      const id = permit ? str(permit.permitId) : undefined;
      if (!id || !loop || permit!.backend !== 'local') return;
      this.#permits.set(id, loop);
      while (this.#permits.size > LOOP_LEDGER_MAX_PERMITS) this.#permits.delete(this.#permits.keys().next().value!);
      return;
    }
    // budget.usage: a malformed or over-permit row counts nothing (as the fuse's own restore)
    if (p.malformed === true || p.overPermit === true) return;
    const id = str(p.permitId);
    const key = id ? this.#permits.get(id) : undefined;
    const tokens = num(p.tokens);
    if (!key || tokens === undefined || tokens <= 0) return;
    this.#bump(dayKeyOf(at), key, 0, 0, tokens);
  }

  #bump(day: string, key: string | undefined, runs: number, computeMs: number, tokens = 0): void {
    let m = this.#days.get(day);
    if (!m) {
      m = new Map();
      this.#days.set(day, m);
      // the counters keep the last LOOP_LEDGER_DAYS days (a day window is today's)
      while (this.#days.size > LOOP_LEDGER_DAYS) this.#days.delete([...this.#days.keys()].sort()[0]!);
    }
    for (const k of key ? [key, '*'] : ['*']) {
      const c = m.get(k) ?? { runs: 0, computeMs: 0, tokens: 0 };
      c.runs += runs;
      c.computeMs += computeMs;
      c.tokens += tokens;
      m.set(k, c);
    }
  }

  /** Top-level runs started, compute and model tokens charged on `day` to `key` (a callee's go to its root caller), or all. */
  day(day: string, key?: string): { runs: number; computeMs: number; tokens: number } {
    const c = this.#days.get(day)?.get(key ?? '*');
    return { runs: c?.runs ?? 0, computeMs: c?.computeMs ?? 0, tokens: c?.tokens ?? 0 };
  }
}

// ── Replay (G-LOOP-17) ───────────────────────────────────────────────────────

export interface LoopReplayRun {
  loopId: string;
  /** [nodeId, verdict, edge, next] per visit, in log order */
  edges: Array<[string, string, string | null, string | null]>;
  ended: string | null;
}

export interface LoopReplayDivergence {
  runId: string;
  detail: string;
}

/**
 * Reproduce every edge each run took, from its rows alone (pure; `gnomon replay` folds this). A row whose `next` is
 * not the node the following row ran, or a run whose end names a `terminal` its last edge did not go to, is a
 * divergence. Runs cut short (budget, node-exit, kill switch, pause, daemon-restart) name no terminal.
 */
export function replayLoopRuns(rows: Iterable<{ kind: string; payload?: unknown }>): { runs: Record<string, LoopReplayRun>; divergences: LoopReplayDivergence[] } {
  const runs: Record<string, LoopReplayRun> = {};
  const divergences: LoopReplayDivergence[] = [];
  for (const r of rows) {
    if (!LOOP_RUN_KINDS.includes(r.kind) || !isObj(r.payload)) continue;
    const p = r.payload;
    const runId = str(p.runId);
    if (!runId) continue;
    if (r.kind === 'loop.run.started') {
      runs[runId] ??= { loopId: str(p.loopId) ?? '?', edges: [], ended: null };
      continue;
    }
    const run = runs[runId];
    if (!run) continue;
    if (r.kind === 'loop.node') {
      const nodeId = str(p.nodeId) ?? '?';
      const prev = run.edges[run.edges.length - 1];
      if (prev && prev[3] !== nodeId) divergences.push({ runId, detail: `${prev[0]} went to ${prev[3] ?? 'nowhere'} but ${nodeId} ran next` });
      if (run.ended !== null) divergences.push({ runId, detail: `${nodeId} ran after the run ended` });
      run.edges.push([nodeId, str(p.verdict) ?? '?', str(p.edge) ?? null, typeof p.next === 'string' ? p.next : null]);
    } else if (r.kind === 'loop.run.ended') {
      run.ended = str(p.reason) ?? 'error';
      const want = str(p.terminal);
      const last = run.edges[run.edges.length - 1];
      if (want && last && last[3] !== want) divergences.push({ runId, detail: `the run ended ${run.ended} but its last edge went to ${last[3] ?? 'nowhere'}` });
    }
  }
  return { runs, divergences };
}
