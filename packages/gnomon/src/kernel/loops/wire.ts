/**
 * @symbol #loop-registry
 *
 * #loop-registry wiring (build plan merge rules: daemon.ts makes ONE wireLoops() call and dispatch.ts has ONE block
 * for the human's `request.loop.*`; everything else lives here). Builds the registry and the trust card handler,
 * seeds the fold from the kernel log (LOOP_FOLD_KINDS, kernel-signed rows only), keeps it current from every
 * committed row, and starts the watch and rescan timer. Returns the dispatcher's `requests.loops` port.
 */
import type { CardV1 } from '@a-company/gnomon-contracts';
import type { RaiseInput } from '../broker/broker.js';
import { LOOP_FOLD_KINDS, LoopRegistry, type LoopRow } from './registry.js';
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
}

/** The dispatcher's port (socket/dispatch.ts HumanRequestPort.loops). */
export interface LoopsPort {
  request(asker: LoopAsker, kind: string, payload: unknown): Promise<unknown>;
  status(): Record<string, unknown>;
}

export interface WiredLoops {
  registry: LoopRegistry;
  trust: LoopTrust;
  port: LoopsPort;
  close(): void;
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
  try {
    const seed: LoopRow[] = [];
    for (const v of o.log.read({ reader: { class: 'human' }, kinds: [...LOOP_FOLD_KINDS] })) {
      if (v.view === 'full' && v.event) seed.push({ kind: v.event.kind, principal: v.event.principal, ...(typeof v.event.keyId === 'string' ? { keyId: v.event.keyId } : {}), ...(v.event.at ? { at: v.event.at } : {}), payload: v.event.payload });
    }
    registry.seed(seed);
  } catch {
    /* an unreadable history trusts nothing: every loop shows untrusted (fail closed) */
  }
  o.log.onCommit((e) => registry.observe({ kind: e.kind, principal: e.principal, ...(typeof e.keyId === 'string' ? { keyId: e.keyId } : {}), ...(e.at ? { at: e.at } : {}), payload: e.payload }));
  const trust = new LoopTrust({ home: o.home, registry, broker: o.broker, append: (kind, payload, ids) => append(kind, payload, ids.connId) });
  if (o.start !== false) registry.start();
  return {
    registry,
    trust,
    port: { request: (asker, kind, payload) => trust.request(asker, kind, payload), status: () => registry.status() },
    close: () => registry.close(),
  };
}
