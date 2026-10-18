/**
 * @symbol #mod-host
 *
 * The host side of the `mod-abi:v1` wire (spec §12.3): JSON-RPC 2.0, one
 * object per line, on the mod child's stdin (host → mod) and stdout
 * (mod → host), framed by #socket's byte-safe NdjsonDecoder (1 MiB per frame
 * from a mod — a §12.2 block is ≤ 256 KiB, so anything larger is hostile).
 *
 * Requests run both ways: the host calls the mod (init, health, view.render,
 * …) and the mod calls the host (state.get, state.set, kernel.call), answered
 * by the `onRequest` handler. A malformed or oversize frame from the mod is
 * dropped and counted (`protocolErrors`); a response to an unknown id is
 * ignored. stderr is the mod's log, kept as a bounded tail for
 * `gnomon mod inspect` (§12.4). The channel never throws on child output.
 */
import type { ChildProcess } from 'node:child_process';
import { jsonRpcCodeFor, RefusedError, type Refusal } from '@a-company/gnomon-contracts';
import { encodeFrame, NdjsonDecoder } from '../socket/framing.js';
import { ModRefusal } from './refusal.js';

export const MOD_FRAME_MAX_BYTES = 1024 * 1024;
export const STDERR_TAIL_BYTES = 8 * 1024;
/** mod → host requests in flight at once; beyond this the mod is answered BAD_REQUEST (reviewer #3). */
export const MAX_MOD_INFLIGHT = 16;

export interface RpcErrorObject {
  code: number;
  message: string;
  data?: unknown;
}

export class ModRpcError extends Error {
  constructor(readonly error: RpcErrorObject) {
    super(error.message);
  }
}

export type RequestHandler = (method: string, params: Record<string, unknown>) => Promise<unknown>;

export class ModChannel {
  readonly #child: ChildProcess;
  readonly #decoder = new NdjsonDecoder(MOD_FRAME_MAX_BYTES);
  readonly #pending = new Map<number, { res: (v: unknown) => void; rej: (e: Error) => void }>();
  #nextId = 1;
  #stderr = '';
  #closed = false;
  #inflight = 0;
  #paused = false;
  protocolErrors = 0;

  constructor(child: ChildProcess, onRequest: RequestHandler) {
    this.#child = child;
    child.stdin!.on('error', () => undefined);
    child.stderr!.on('data', (c: Buffer) => (this.#stderr = (this.#stderr + c.toString('utf8')).slice(-STDERR_TAIL_BYTES)));
    child.stdout!.on('data', (chunk: Buffer) => {
      for (const item of this.#decoder.push(chunk)) {
        if (item.kind !== 'frame') {
          this.protocolErrors++;
          continue;
        }
        this.#onFrame(item.value, onRequest);
      }
    });
    child.once('exit', () => this.close(new ModRefusal('CRASHED', 'the mod child exited with the call in flight')));
  }

  get stderrTail(): string {
    return this.#stderr;
  }

  #write(msg: Record<string, unknown>): void {
    if (this.#closed) return;
    try {
      // backpressure: while the mod is not draining its stdin, stop reading its stdout (it cannot flood the host's memory)
      if (!this.#child.stdin!.write(encodeFrame({ jsonrpc: '2.0', ...msg })) && !this.#paused) {
        this.#paused = true; // one 'drain' listener at a time
        this.#child.stdout!.pause();
        this.#child.stdin!.once('drain', () => {
          this.#paused = false;
          this.#child.stdout!.resume();
        });
      }
    } catch {
      this.protocolErrors++;
    }
  }

  #onFrame(msg: Record<string, unknown>, onRequest: RequestHandler): void {
    if (typeof msg.method === 'string') {
      const id = msg.id;
      const params = msg.params && typeof msg.params === 'object' && !Array.isArray(msg.params) ? (msg.params as Record<string, unknown>) : {};
      if (typeof id !== 'number' && typeof id !== 'string') return; // mod → host notifications: none in mod-abi:v1
      if (this.#inflight >= MAX_MOD_INFLIGHT) {
        this.#write({ id, error: errorObject(new ModRefusal('BUSY', `more than ${MAX_MOD_INFLIGHT} mod → host requests in flight`)) });
        return;
      }
      this.#inflight++;
      onRequest(msg.method, params)
        .then(
          (result) => this.#write({ id, result: result ?? {} }),
          (err: unknown) => this.#write({ id, error: errorObject(err) }),
        )
        .finally(() => this.#inflight--);
      return;
    }
    if (typeof msg.id !== 'number') {
      this.protocolErrors++;
      return;
    }
    const w = this.#pending.get(msg.id);
    if (!w) return;
    this.#pending.delete(msg.id);
    if (msg.error && typeof msg.error === 'object') w.rej(new ModRpcError(msg.error as RpcErrorObject));
    else w.res(msg.result);
  }

  request(method: string, params: Record<string, unknown>): Promise<unknown> {
    if (this.#closed) return Promise.reject(new ModRefusal('NOT_RUNNING', 'the mod channel is closed'));
    const id = this.#nextId++;
    return new Promise((res, rej) => {
      this.#pending.set(id, { res, rej });
      this.#write({ id, method, params });
    });
  }

  notify(method: string, params: Record<string, unknown>): void {
    this.#write({ method, params });
  }

  close(err: Error): void {
    if (this.#closed) return;
    this.#closed = true;
    for (const w of this.#pending.values()) w.rej(err);
    this.#pending.clear();
  }
}

function errorObject(err: unknown): RpcErrorObject {
  if (err instanceof ModRefusal || err instanceof RefusedError) {
    // a refusal:v1 is data, never a stack (e.g. the log's label-relaxed for a mod append)
    const r: Refusal = err.refusal;
    return { code: jsonRpcCodeFor(r.code), message: err.message, data: r };
  }
  return { code: -32603, message: 'internal error' }; // never leak a host stack to a mod
}
