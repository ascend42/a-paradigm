/**
 * @symbol #gnomon-mod-sdk
 *
 * The mod side of `mod-abi:v1` (spec §12.3): `serveMod(definition)` speaks
 * JSON-RPC 2.0 NDJSON on stdin/stdout to #mod-host. Zero runtime dependencies
 * and a single bundled file (dist/runtime.js), so a mod VENDORS it into its own
 * folder (the example mod imports `./gnomon-mod-sdk.mjs`): the mod then runs
 * from its pinned snapshot only and reads no byte outside the approved tree
 * (§12.5 "a lazy import inside the mod can read nothing but the approved
 * bytes"). The `mod` profile has no read of node_modules or the SDK package,
 * so a bare `import '@a-company/gnomon-mod-sdk'` would not resolve inside the
 * sandbox — vendoring is the supported form (slice 2's `gnomon mod new` writes it).
 *
 * stdout is the protocol channel: a mod must never write to it directly; its
 * log goes to stderr (`ctx.log`), which the host keeps as a tail.
 */
import * as net from 'node:net';
import { MOD_ABI_ID, MOD_ABI_V1, type RelayedFor } from '@a-company/gnomon-contracts';

export type Block = Record<string, unknown>;

export interface CallContext {
  /** aborted when the host sends `cancel{cancelToken}` for this call */
  signal: AbortSignal;
  /** host-stamped on relayed view/command inputs; a mod can never assert who acted */
  relayedFor?: RelayedFor;
}

export interface ViewContext extends CallContext {
  width: number;
  prefs: { motion?: string; theme?: string };
}

export interface ModApi {
  state: { get(key: string): Promise<unknown>; set(key: string, value: unknown): Promise<void> };
  /** `kernel.call{verb, params}` (§12.3) — proxied under the mod's principal; `approve` is never proxied */
  kernel(verb: string, params?: Record<string, unknown>): Promise<unknown>;
  /** stderr line (the host's stderr tail); never stdout */
  log(message: string): void;
  /** CONNECT through the kernel's egress proxy (env GNOMON_EGRESS_PROXY); resolves an open tunnel socket */
  egress(host: string, port?: number): Promise<net.Socket>;
}

export interface ModDefinition {
  views?: Record<string, (input: unknown, ctx: ViewContext, api: ModApi) => Block | Promise<Block>>;
  commands?: Record<string, (args: unknown, ctx: CallContext, api: ModApi) => unknown>;
  tools?: Record<string, (input: unknown, ctx: CallContext, api: ModApi) => unknown>;
  onEvent?: (event: unknown, api: ModApi) => void;
  features?: string[];
}

export class ModCallError extends Error {
  constructor(
    readonly code: number,
    message: string,
    readonly data?: unknown,
  ) {
    super(message);
  }
}

interface Io {
  input: NodeJS.ReadableStream;
  output: { write(s: string): unknown };
  error: { write(s: string): unknown };
  env: Record<string, string | undefined>;
}

/** Serve a mod over stdio until `shutdown` or stdin closes. */
export function serveMod(def: ModDefinition, io: Io = { input: process.stdin, output: process.stdout, error: process.stderr, env: process.env }): void {
  let nextId = 1;
  const pending = new Map<number, { res: (v: unknown) => void; rej: (e: Error) => void }>();
  const inflight = new Map<string, AbortController>();
  const send = (msg: Record<string, unknown>): void => void io.output.write(`${JSON.stringify({ jsonrpc: '2.0', ...msg })}\n`);
  const call = (method: string, params: Record<string, unknown>): Promise<unknown> =>
    new Promise((res, rej) => {
      const id = nextId++;
      pending.set(id, { res, rej });
      send({ id, method, params });
    });

  const api: ModApi = {
    state: {
      get: async (key) => ((await call('state.get', { key })) as { value?: unknown })?.value,
      set: async (key, value) => void (await call('state.set', { key, value })),
    },
    kernel: async (verb, params = {}) => ((await call('kernel.call', { verb, params })) as { result?: unknown })?.result,
    log: (m) => void io.error.write(`${m}\n`),
    egress: (host, port = 443) => egressConnect(io.env.GNOMON_EGRESS_PROXY, host, port),
  };

  const handle = async (method: string, p: Record<string, unknown>): Promise<unknown> => {
    switch (method) {
      case 'init':
        if (p.abi !== MOD_ABI_V1) throw new ModCallError(-32602, `unsupported abi ${String(p.abi)}`);
        return { abi: MOD_ABI_V1, features: (def.features ?? []).filter((f) => Array.isArray(p.features) && p.features.includes(f)), modAbiId: MOD_ABI_ID };
      case 'health':
        return { ok: true, abi: MOD_ABI_V1 };
      case 'shutdown':
        setImmediate(() => process.exit(0));
        return {};
      case 'view.render':
      case 'tool.call':
      case 'command.run': {
        const token = typeof p.cancelToken === 'string' ? p.cancelToken : null;
        const ac = new AbortController();
        if (token) inflight.set(token, ac);
        try {
          const base: CallContext = { signal: ac.signal, ...(p.relayedFor ? { relayedFor: p.relayedFor as RelayedFor } : {}) };
          if (method === 'view.render') {
            const fn = def.views?.[String(p.viewId)];
            if (!fn) throw new ModCallError(-32601, `no view ${String(p.viewId)}`);
            return { block: await fn(p.input, { ...base, width: Number(p.width ?? 80), prefs: (p.prefs as ViewContext['prefs']) ?? {} }, api) };
          }
          if (method === 'tool.call') {
            const fn = def.tools?.[String(p.name)];
            if (!fn) throw new ModCallError(-32601, `no tool ${String(p.name)}`);
            return { result: await fn(p.input, base, api) };
          }
          const fn = def.commands?.[String(p.commandId)];
          if (!fn) throw new ModCallError(-32601, `no command ${String(p.commandId)}`);
          return { result: await fn(p.args, base, api) };
        } finally {
          if (token) inflight.delete(token);
        }
      }
      default:
        throw new ModCallError(-32601, `unknown method ${method}`);
    }
  };

  let buf = '';
  io.input.setEncoding?.('utf8');
  io.input.on('data', (chunk: string | Buffer) => {
    buf += chunk.toString();
    let nl: number;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(line) as Record<string, unknown>;
      } catch {
        continue;
      }
      if (typeof msg.method !== 'string') {
        const w = pending.get(msg.id as number);
        if (!w) continue;
        pending.delete(msg.id as number);
        const err = msg.error as { code: number; message: string; data?: unknown } | undefined;
        if (err) w.rej(new ModCallError(err.code, err.message, err.data));
        else w.res(msg.result);
        continue;
      }
      const params = (msg.params ?? {}) as Record<string, unknown>;
      if (msg.method === 'cancel') {
        inflight.get(String(params.cancelToken))?.abort();
        continue;
      }
      if (msg.method === 'event') {
        try {
          def.onEvent?.(params.event, api);
        } catch (e) {
          api.log(`event handler threw: ${(e as Error).message}`);
        }
        continue;
      }
      if (msg.id === undefined) continue;
      handle(msg.method, params).then(
        (result) => send({ id: msg.id, result }),
        (e: unknown) => {
          const err = e instanceof ModCallError ? e : new ModCallError(-32000, (e as Error)?.message ?? String(e));
          send({ id: msg.id, error: { code: err.code, message: err.message, ...(err.data !== undefined ? { data: err.data } : {}) } });
        },
      );
    }
  });
  io.input.on('end', () => process.exit(0));
}

/** HTTP CONNECT through the host's loopback egress proxy; rejects with the proxy's status line on refusal. */
export function egressConnect(proxy: string | undefined, host: string, port: number): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    const m = /^127\.0\.0\.1:(\d+)$/.exec(proxy ?? '');
    if (!m) return reject(new Error('no egress grant: GNOMON_EGRESS_PROXY is unset'));
    const s = net.connect({ host: '127.0.0.1', port: Number(m[1]) });
    let head = '';
    s.once('error', reject);
    s.once('connect', () => s.write(`CONNECT ${host}:${port} HTTP/1.1\r\nHost: ${host}:${port}\r\n\r\n`));
    const onData = (c: Buffer): void => {
      head += c.toString('latin1');
      const end = head.indexOf('\r\n\r\n');
      if (end < 0) return;
      s.off('data', onData);
      const status = head.slice(0, head.indexOf('\r\n'));
      if (/^HTTP\/1\.[01] 200/.test(status)) {
        const rest = Buffer.from(head.slice(end + 4), 'latin1');
        if (rest.length) s.unshift(rest);
        resolve(s);
      } else {
        s.destroy();
        reject(new Error(`egress refused: ${status}`));
      }
    };
    s.on('data', onData);
  });
}
