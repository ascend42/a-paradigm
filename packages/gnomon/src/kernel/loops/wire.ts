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
 */
import type { CardV1 } from '@a-company/gnomon-contracts';
import type { RaiseInput } from '../broker/broker.js';
import * as fs from 'node:fs';
import { createRequire } from 'node:module';
import * as path from 'node:path';
import { pinParadigmCli, type CheckExecInput, type CheckResult, type FilePin } from './check-exec.js';
import { LOOP_RUN_KINDS, LoopLedger } from './ledger.js';
import { LOOP_FOLD_KINDS, LoopRegistry, type LoopRow } from './registry.js';
import { LoopRunner, type LoopGlobalCaps, type LoopToast } from './runner.js';
import { LoopTimers, type LoopScheduler } from './timers.js';
import { LoopTrust, type LoopAsker } from './trust.js';

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
}

/** The dispatcher's port (socket/dispatch.ts HumanRequestPort.loops). */
export interface LoopsPort {
  request(asker: LoopAsker, kind: string, payload: unknown): Promise<unknown>;
  status(): Record<string, unknown>;
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
    for (const v of o.log.read({ reader: { class: 'human' }, kinds: [...LOOP_RUN_KINDS] })) if (v.view === 'full' && v.event) runs.push(rowOf(v.event));
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
    ...(o.check ? { check: o.check } : {}), ...(o.paradigmCli ? { paradigmCli: o.paradigmCli } : {}), ...(o.toast ? { toast: o.toast } : {}),
    ...(o.caps ? { caps: o.caps } : {}), ...(o.clock ? { clock: o.clock } : {}), ...(o.platform ? { platform: o.platform } : {}), ...(o.diag ? { diag: o.diag } : {}),
  });
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
  if (o.start !== false) {
    registry.start();
    process.once('exit', onExit);
  }
  const RUNNER_KINDS = new Set(['request.loop.run', 'request.loop.pause', 'request.loop.resume']);
  return {
    registry,
    trust,
    ledger,
    runner,
    timers,
    recovered,
    port: {
      request: (asker, kind, payload) => (RUNNER_KINDS.has(kind) ? runner.request(asker, kind, payload) : trust.request(asker, kind, payload)),
      status: () => ({ ...registry.status(), ...runner.status(), ...(timers ? { uptime: timers.status() } : {}) }),
    },
    close: () => {
      process.removeListener('exit', onExit);
      timers?.close();
      runner.abortAll();
      registry.close();
    },
  };
}
