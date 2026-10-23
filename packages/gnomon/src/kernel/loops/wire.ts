/**
 * @symbol #loop-registry
 *
 * #loop-registry wiring (build plan merge rules: daemon.ts makes ONE wireLoops() call and dispatch.ts has ONE block
 * for the human's `request.loop.*`; everything else lives here). Builds the registry and the trust card handler,
 * seeds the fold from the kernel log (LOOP_FOLD_KINDS, kernel-signed rows only), keeps it current from every
 * committed row, and starts the watch and rescan timer. Returns the dispatcher's `requests.loops` port.
 *
 * #loop-runner (step 5): the run ledger is seeded from the log's LOOP_RUN_KINDS and kept current the same way; the
 * runner serves `request.loop.run|pause|resume` (pause{all:true} is the kill switch), and at boot closes every
 * started run with no end `daemon-restart` (G-LOOP-14). status.loops adds running, queued and recent runs.
 *
 * #loop-timers (step 6): given the daemon's scheduler, the loops' schedule and continuous triggers become scheduler
 * timers that hand off to the runner, and the `loop` idle holder keeps the daemon up for them (status.loops.uptime).
 *
 * #loop-strictness (step 9): given the repo cap source (the daemon's strictness levels and run modes), the runner
 * folds it into each loop's effective autonomy; `brake(repoKey)` is the repo brake (a level raise or a repo mode
 * tightening pauses the repo's running loops at once, `loop.paused{reason:'strictness'}`); status.loops.effective
 * carries each loop's effective autonomy and capReason for the GUI ("act → propose (L2)").
 *
 * #loop-land (step 11): the runner's lander folds `loop.landed`, undone lands and `merge.reverted` from the log,
 * retries waiting lands on every committed `turn.result` and `session.exited`, waits while a human session in the
 * repo has a turn in flight (`humanTurns`, the supervisor's own streaming state), and scans landed loop commits for
 * reverts at boot and every LAND_REVERT_SCAN_MS. status.loops.landing lists the waiting lands.
 */
import { sweepCheckCopies } from './check-exec.js';
import { sweepLoopScratch } from '../git/scratch.js';
/** The default retention window for kept check copies, scratch run dirs and parked refs (loops.retentionDays). */
export const LOOP_RETENTION_DAYS = 14;
import type { CardV1 } from '@a-company/gnomon-contracts';
import type { RaiseInput } from '../broker/broker.js';
import * as fs from 'node:fs';
import { createRequire } from 'node:module';
import * as path from 'node:path';
import { pinParadigmCli, type CheckExecInput, type CheckResult, type FilePin } from './check-exec.js';
import { LOOP_RUN_KINDS, LOOP_TOKEN_KINDS, LoopLedger } from './ledger.js';
import type { LoopModelPort } from './model-node.js';
import { LOOP_FOLD_KINDS, LoopRegistry, type LoopRow } from './registry.js';
import { LoopRunner, type LoopGlobalCaps, type LoopToast } from './runner.js';
import type { RepoCap } from './strictness-cap.js';
import { LoopTimers, type LoopScheduler } from './timers.js';
import { LOOP_EVENT_INDEX_KINDS, LoopEvents, type LoopEventRow } from './events.js'; // #loop-events (step 7)
import { LoopTrust, type LoopAsker } from './trust.js';
import { LoopAgentOps, type LoopAgentAsker } from './agent-ops.js';
import { LOOP_LAND_FOLD_KINDS } from './land.js'; // #loop-land (step 11)

/** How often landed loop commits are checked for reverts (read-only git). */
export const LAND_REVERT_SCAN_MS = 60_000;

/** The slice of the kernel log the loops need. */
export interface LoopsLog {
  append(input: { kind: string; principal: string; payload: unknown; connId?: string }): Promise<unknown>;
  read(q: { reader: { class: 'human' }; kinds: string[] }): Iterable<{ view: string; event?: { kind: string; principal: string; keyId?: string; at?: string; payload?: unknown } }>;
  onCommit(listener: (e: { kind: string; principal: string; keyId?: string; at?: string; payload?: unknown }) => void): unknown;
  isKernelKey(keyId: string): boolean;
}

export interface WireLoopsOptions {
  home: string;
  log: LoopsLog;
  kernelPrincipal: string;
  broker: { raise(input: RaiseInput): Promise<CardV1>; card?(cardId: string): CardV1 | undefined };
  /** the root authority: a loop.trusted row folds only when its rootSig verifies */
  root?: { verifyRow(signer: string, row: unknown, sigB64: string): boolean };
  diag?: (event: string, data: Record<string, unknown>) => void;
  /** tests: no fs watch, no timer */
  start?: boolean;
  rescanMs?: number;
  /** #loop-runner seams: the check executor, the builtins' pinned paradigm CLI, the GUI toast, caps, clock */
  /** TD-2026-10-23-268: the kernel's own loopback ports (its web transport), denied to `network: on` checks */
  kernelPorts?: () => readonly number[];
  check?: (i: CheckExecInput) => Promise<CheckResult>;
  paradigmCli?: () => FilePin | null;
  toast?: (t: LoopToast) => void;
  caps?: Partial<LoopGlobalCaps>;
  clock?: () => number;
  platform?: string;
  /** #loop-timers: the daemon's scheduler (absent: no loop timers; manual runs only) */
  scheduler?: LoopScheduler;
  /** the `loop` idle holder */
  holdIdle?: () => () => void;
  /** the zone daily/weekly loop times are read in (default the host's) */
  tz?: string;
  /** #loop-runner step 8: the local model lane (supervisor.openLoop + the configured endpoints); absent: model loops refuse */
  model?: LoopModelPort;
  /** #loop-strictness: the repo's cap {level, effective run mode} (absent: loops run as declared) */
  strictness?: (repoKey: string) => RepoCap;
  /** #loop-agent-ops (step 12, LL5): is this hsid a loop session (supervisor.isLoopSession)? */
  isLoopSession?: (hsid: string) => boolean;
  /** #loop-land (step 11): the live human sessions' cwd and whether a turn is in flight (a land waits for them) */
  humanTurns?: () => Array<{ cwd: string; busy: boolean }>;
}

/** The dispatcher's port (socket/dispatch.ts HumanRequestPort.loops). */
export interface LoopsPort {
  request(asker: LoopAsker, kind: string, payload: unknown): Promise<unknown>;
  status(): Record<string, unknown>;
  /** #loop-agent-ops (step 12): an agent's loop.request, the asker stamped from its connection */
  agent(asker: LoopAgentAsker, payload: unknown): Promise<unknown>;
}

export interface WiredLoops {
  registry: LoopRegistry;
  trust: LoopTrust;
  ledger: LoopLedger;
  runner: LoopRunner;
  timers: LoopTimers | null;
  /** resolves once the boot sweep closed the runs a previous daemon left open */
  recovered: Promise<number>;
  port: LoopsPort;
  /** the repo brake (#loop-strictness): pause every running loop of the repo now; resolves to the loops paused */
  brake(repoKey: string, by?: string): Promise<number>;
  /** TD-2026-10-22-769: a local config applied; start refusals whose cause cleared are dropped (their alerts clear) */
  localConfigApplied(): void;
  close(): void;
}

/**
 * The paradigm CLI loop builtins run through, pinned ONCE (the first builtin check after boot) and then fixed for the
 * daemon's life: `@a-company/paradigm` as Node resolves it from this module (Gnomon ships as paradigm's dependency,
 * so its install is found walking up), its `dist/index.js` and a digest of the whole dist dir (pinParadigmCli, the
 * same pin check-exec verifies before every builtin). Not found (the signed app alone, no paradigm install): null,
 * and builtin checks fail closed (`error`).
 */
export function paradigmCliResolver(resolve: () => string = () => createRequire(import.meta.url).resolve('@a-company/paradigm/package.json')): () => FilePin | null {
  let pin: FilePin | null | undefined;
  return () => {
    if (pin !== undefined) return pin;
    try {
      const entry = path.join(path.dirname(resolve()), 'dist', 'index.js');
      pin = fs.statSync(entry).isFile() ? pinParadigmCli(entry) : null;
    } catch {
      pin = null;
    }
    return pin;
  };
}

export function wireLoops(o: WireLoopsOptions): WiredLoops {
  const append = (kind: string, payload: Record<string, unknown>, connId?: string): Promise<void> =>
    o.log.append({ kind, principal: o.kernelPrincipal, payload: { ...payload }, ...(connId ? { connId } : {}) }).then(() => undefined);
  const registry = new LoopRegistry({
    home: o.home,
    kernelPrincipal: o.kernelPrincipal,
    isKernelKey: (k) => o.log.isKernelKey(k),
    ...(o.root ? { verifyRootRow: (signer: string, row: unknown, sig: string) => o.root!.verifyRow(signer, row, sig) } : {}),
    append: (kind, payload) => append(kind, payload),
    ...(o.diag ? { diag: o.diag } : {}),
    ...(o.rescanMs !== undefined ? { rescanMs: o.rescanMs } : {}),
  });
  const ledger = new LoopLedger({ kernelPrincipal: o.kernelPrincipal, isKernelKey: (k) => o.log.isKernelKey(k) });
  const rowOf = (e: { kind: string; principal: string; keyId?: string; at?: string; payload?: unknown }): LoopRow => ({ kind: e.kind, principal: e.principal, ...(typeof e.keyId === 'string' ? { keyId: e.keyId } : {}), ...(e.at ? { at: e.at } : {}), payload: e.payload });
  try {
    const seed: LoopRow[] = [];
    for (const v of o.log.read({ reader: { class: 'human' }, kinds: [...LOOP_FOLD_KINDS] })) if (v.view === 'full' && v.event) seed.push(rowOf(v.event));
    registry.seed(seed);
  } catch {
    /* an unreadable history trusts nothing: every loop shows untrusted (fail closed) */
  }
  try {
    const runs: LoopRow[] = [];
    // step 8: the fuse's permit.grant and budget.usage rows too (model tokens fold by permitId into the day counters)
    for (const v of o.log.read({ reader: { class: 'human' }, kinds: [...LOOP_RUN_KINDS, ...LOOP_TOKEN_KINDS] })) if (v.view === 'full' && v.event) runs.push(rowOf(v.event));
    ledger.seed(runs);
  } catch {
    /* an unreadable run history: no open run to close, day counts start at zero (the global caps still bound) */
  }
  o.log.onCommit((e) => {
    const r = rowOf(e);
    registry.observe(r);
    ledger.observe(r);
  });
  let stopRun: (key: string, reason: string) => void = () => undefined;
  const trust = new LoopTrust({ home: o.home, registry, broker: o.broker, append: (kind, payload, ids) => append(kind, payload, ids.connId), onRevoke: (key, reason) => stopRun(key, reason) });
  const runner = new LoopRunner({
    home: o.home, kernelPrincipal: o.kernelPrincipal, registry, ledger, broker: o.broker,
    append: (kind, payload, ids) => append(kind, payload, ids?.connId),
    ...(o.kernelPorts ? { kernelPorts: o.kernelPorts } : {}),
    ...(o.check ? { check: o.check } : {}), ...(o.paradigmCli ? { paradigmCli: o.paradigmCli } : {}), ...(o.toast ? { toast: o.toast } : {}),
    ...(o.caps ? { caps: o.caps } : {}), ...(o.clock ? { clock: o.clock } : {}), ...(o.platform ? { platform: o.platform } : {}), ...(o.diag ? { diag: o.diag } : {}),
    ...(o.strictness ? { strictness: o.strictness } : {}),
    ...(o.model ? { model: o.model } : {}),
    ...(o.humanTurns ? { humanBusy: (repo: string) => humanBusyIn(repo, o.humanTurns!()) } : {}),
    isKernelKey: (k: string) => o.log.isKernelKey(k),
  });
  // ── #loop-land (step 11): landed shas, undone lands and reported reverts fold from kernel rows ──
  try {
    const landRows: LoopRow[] = [];
    for (const v of o.log.read({ reader: { class: 'human' }, kinds: [...LOOP_LAND_FOLD_KINDS] })) if (v.view === 'full' && v.event) landRows.push(rowOf(v.event));
    runner.lander.seed(landRows);
  } catch {
    /* an unreadable history: no landed commit to watch for reverts yet */
  }
  // Aegis M4: lands a previous daemon left mid-way (or waiting) are closed and the human told
  const reconciled = o.start !== false ? runner.lander.reconcile().catch((err: unknown) => {
    o.diag?.('loops.land-reconcile-failed', { why: err instanceof Error ? err.message.slice(0, 200) : 'failed' });
    return 0;
  }) : Promise.resolve(0);
  void reconciled;
  o.log.onCommit((e) => {
    runner.lander.observe(rowOf(e));
    // a turn ended or a session exited: a land waiting on the human may go now
    if (e.kind === 'turn.result' || e.kind === 'session.exited') void runner.lander.nudge();
  });
  // ── end #loop-land ──
  stopRun = (key, reason) => void runner.stopRun(key, reason);
  const recovered = runner.recover().catch((err: unknown) => {
    o.diag?.('loops.recover-failed', { why: err instanceof Error ? err.message.slice(0, 200) : 'recover failed' });
    return 0;
  });
  // daemon exit: no check process group outlives the kernel (the next boot closes the runs daemon-restart)
  const onExit = (): void => runner.abortAll();
  const timers = o.scheduler
    ? new LoopTimers({ registry, runner, scheduler: o.scheduler, ...(o.tz ? { tz: o.tz } : {}), ...(o.clock ? { clock: o.clock } : {}), ...(o.holdIdle ? { holdIdle: o.holdIdle } : {}), ...(o.diag ? { diag: o.diag } : {}) })
    : null;
  // ── #loop-events (build plan step 7, LP4b): event triggers, registered with the trust state like the timers ──
  const closers: Array<() => void> = []; // run by close()
  const events = new LoopEvents({
    home: o.home, registry, runner, kernelPrincipal: o.kernelPrincipal, isKernelKey: (k) => o.log.isKernelKey(k),
    append: (kind, payload) => append(kind, payload), watch: o.start !== false,
    ...(o.clock ? { clock: o.clock } : {}), ...(o.diag ? { diag: o.diag } : {}),
  });
  try {
    const idx: LoopEventRow[] = [];
    for (const v of o.log.read({ reader: { class: 'human' }, kinds: [...LOOP_EVENT_INDEX_KINDS] })) if (v.view === 'full' && v.event) idx.push(v.event as LoopEventRow);
    events.seed(idx);
  } catch {
    /* an unreadable history: no card or session to match yet (the self-trigger guard still sees every new row) */
  }
  o.log.onCommit((e) => void events.observe(e as LoopEventRow));
  closers.push(() => events.close());
  // ── end #loop-events ──
  if (o.start !== false) {
    registry.start();
    process.once('exit', onExit);
    // #loop-land: reverts of landed loop commits (merge.reverted), at boot and then on a slow timer
    const scan = (): void => void runner.lander.scanReverts().catch((err: unknown) => o.diag?.('loops.revert-scan-failed', { why: err instanceof Error ? err.message.slice(0, 200) : 'failed' }));
    scan();
    const revertTimer = setInterval(scan, LAND_REVERT_SCAN_MS);
    revertTimer.unref?.();
    closers.push(() => clearInterval(revertTimer));
    // retention (loops.retentionDays, default LOOP_RETENTION_DAYS until the root config is read): kept check copies,
    // stale scratch run dirs (a daemon restart mid-run) and parked refs past the window, once at boot
    try {
      const ms = LOOP_RETENTION_DAYS * 86_400_000;
      sweepCheckCopies(o.home, ms);
      sweepLoopScratch(o.home, ms);
    } catch (err) {
      o.diag?.('loops.sweep-failed', { why: err instanceof Error ? err.message.slice(0, 200) : 'sweep failed' });
    }
  }
  const agentOps = new LoopAgentOps({
    registry, runner, ledger, trust,
    append: (kind, payload, ids) => append(kind, payload, ids.connId),
    ...(o.toast ? { toast: o.toast } : {}),
    ...(o.isLoopSession ? { isLoopSession: o.isLoopSession } : {}),
    ...(o.tz ? { tz: o.tz } : {}), ...(o.clock ? { clock: o.clock } : {}),
  });
  const RUNNER_KINDS = new Set(['request.loop.run', 'request.loop.pause', 'request.loop.resume', 'request.loop.budget']);
  const brake = async (repoKey: string, by = 'kernel'): Promise<number> => {
    let n = 0;
    for (const r of runner.running()) {
      if (registry.entry(r.key)?.repoKey !== repoKey) continue;
      const res = await runner.pause(r.key, by, 'strictness').catch((err: unknown) => {
        o.diag?.('loops.brake-failed', { key: r.key, why: err instanceof Error ? err.message.slice(0, 200) : 'pause failed' });
        return null;
      });
      if (res?.stopped) n++;
    }
    return n;
  };
  const effective = (): Record<string, unknown> => {
    const out: Record<string, unknown> = {};
    for (const e of registry.entries()) {
      if (!e.compiled) continue;
      const x = runner.effective(e);
      out[e.key] = { declared: x.declared, autonomy: x.autonomy, level: x.level, mode: x.mode, paused: x.paused, capReason: x.capReason };
    }
    return out;
  };
  return {
    registry,
    trust,
    ledger,
    runner,
    timers,
    recovered,
    port: {
      request: (asker, kind, payload) => (RUNNER_KINDS.has(kind) ? runner.request(asker, kind, payload) : trust.request(asker, kind, payload)),
      status: () => ({ ...registry.status(), ...runner.status(), ...(timers ? { uptime: timers.status() } : {}), effective: effective(), landing: runner.lander.waiting() }),
      agent: (asker, payload) => agentOps.request(asker, payload),
    },
    brake,
    localConfigApplied: () => runner.recheckStartRefusals(),
    close: () => {
      process.removeListener('exit', onExit);
      for (const c of closers.splice(0)) c(); // #loop-events, the revert scan
      runner.lander.close(); // #loop-land: waiting lands stop retrying (their commits stay parked)
      timers?.close();
      runner.abortAll();
      registry.close();
    },
  };
}

/** Is a human session whose cwd is inside `repo` (realpath) mid-turn? */
export function humanBusyIn(repo: string, sessions: ReadonlyArray<{ cwd: string; busy: boolean }>): boolean {
  for (const x of sessions) {
    if (!x.busy) continue;
    let cwd: string;
    try {
      cwd = fs.realpathSync.native(x.cwd);
    } catch {
      cwd = path.resolve(x.cwd);
    }
    if (cwd === repo || cwd.startsWith(repo.endsWith(path.sep) ? repo : repo + path.sep)) return true;
  }
  return false;
}
