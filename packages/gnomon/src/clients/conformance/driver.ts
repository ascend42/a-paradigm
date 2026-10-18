/**
 * @symbol #client-conformance
 *
 * #client-conformance driver protocol (spec §12.8, G-CLI-02; M1.12 slice 2) —
 * the small LANGUAGE-NEUTRAL protocol the conformance runner speaks to a
 * client under test. One JSON object per line; the runner writes a request
 * `{id, op, …}`, the driver answers `{id, ok: true, …}` or
 * `{id, ok: false, error: {kind, code?, reason?, message}}` where `kind` is
 * `refused` (the kernel refused: `code` and `reason` from refusal:v1),
 * `client` (the client itself refused locally, e.g. a bad serverSig: `reason`)
 * or `driver` (the driver could not run the op).
 *
 *   connect     {socketPath, endpointPath?, kernelKey?, credential?, clientApis?, client}
 *               → {conn, hello, serverVerified, principal?, connId?}
 *   call        {conn, method, params?}            → {result}
 *   subscribe   {conn, params}                     → {result}   (log.read follow)
 *   events      {conn, subscription, n, timeoutMs} → {rows: [{seq, kind}], end?}
 *   closed      {conn, timeoutMs}                  → {closed}   (did the kernel close it?)
 *   close       {conn}                             → {}
 *   sanitize    {input}                            → {text, flags}
 *   row         {event}                            → {row}
 *   denominator {value}                            → {text | null}
 *
 * Credentials on the wire: `{kind:'device', principalId, deviceId,
 * privateKeyPem}` (PKCS#8) or `{kind:'read-token', token}`. The TS driver below
 * runs in-process but round-trips every request and answer through JSON, so
 * it is held to exactly what a subprocess driver (Python, …) sees.
 */
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { RefusedError, eventRow, renderDenominator, sanitizeDisplayText } from '@a-company/gnomon-contracts';
import { ClientAuthError, GnomonClient, type ClientCredential, type KernelKeyPin } from '../ts/client.js';

export type DriverRequest = { id?: number; op: string } & Record<string, unknown>;
export type DriverResponse = { id?: number; ok: boolean; error?: { kind: 'refused' | 'client' | 'driver'; code?: string; reason?: string; message: string } } & Record<string, unknown>;

export interface Driver {
  readonly language: string;
  request(req: DriverRequest): Promise<DriverResponse>;
  stop(): Promise<void>;
}

interface ConnEntry {
  c: GnomonClient;
  events: Array<Record<string, unknown>>;
  wake?: () => void;
}

const roundTrip = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/** The TypeScript client's driver (in-process, JSON round-tripped). */
export class TsClientDriver implements Driver {
  readonly language = 'typescript';
  readonly #conns = new Map<string, ConnEntry>();
  #n = 0;

  async request(raw: DriverRequest): Promise<DriverResponse> {
    const req = roundTrip(raw);
    try {
      return roundTrip({ id: req.id, ok: true, ...(await this.#op(req)) });
    } catch (err) {
      if (err instanceof RefusedError) return { id: req.id, ok: false, error: { kind: 'refused', code: err.refusal.code, reason: (err.refusal.data as { reason?: string } | undefined)?.reason, message: err.message } };
      if (err instanceof ClientAuthError) return { id: req.id, ok: false, error: { kind: 'client', reason: err.reason, message: err.message } };
      return { id: req.id, ok: false, error: { kind: 'driver', message: err instanceof Error ? err.message : String(err) } };
    }
  }

  async #op(r: DriverRequest): Promise<Record<string, unknown>> {
    const conn = (): ConnEntry => {
      const e = this.#conns.get(String(r.conn));
      if (!e) throw new Error(`unknown conn ${String(r.conn)}`);
      return e;
    };
    switch (r.op) {
      case 'connect': {
        const c = await GnomonClient.connect({
          socketPath: String(r.socketPath),
          ...(r.endpointPath ? { endpointPath: String(r.endpointPath) } : {}),
          ...(r.kernelKey ? { kernelKey: r.kernelKey as KernelKeyPin } : {}),
          ...(r.credential ? { credential: r.credential as ClientCredential } : {}),
          ...(r.clientApis ? { clientApis: r.clientApis as string[] } : {}),
          client: r.client as { name: string; version: string },
        });
        const id = `c${++this.#n}`;
        const entry: ConnEntry = { c, events: [] };
        this.#conns.set(id, entry);
        return { conn: id, hello: c.hello, serverVerified: c.serverVerified, principal: c.principal ?? null, connId: c.connId ?? null };
      }
      case 'call':
        return { result: await conn().c.callRaw(String(r.method), r.params) };
      case 'subscribe': {
        const e = conn();
        const res = await e.c.subscribe(r.params as Record<string, never>, {
          row: (row) => {
            e.events.push({ seq: row.seq, kind: 'event' in row ? row.event.kind : 'stub' in row ? row.stub.kind : row.kind });
            e.wake?.();
          },
          end: (end) => {
            e.events.push({ end });
            e.wake?.();
          },
        });
        const { cursor: _c, ...result } = res;
        return { result };
      }
      case 'events': {
        const e = conn();
        const want = Number(r.n);
        const deadline = Date.now() + Number(r.timeoutMs ?? 2000);
        while (e.events.filter((x) => 'seq' in x).length < want && !e.events.some((x) => 'end' in x) && Date.now() < deadline) {
          await new Promise<void>((res) => {
            e.wake = res;
            setTimeout(res, 50);
          });
        }
        const out = e.events.splice(0);
        const end = out.find((x) => 'end' in x);
        return { rows: out.filter((x) => 'seq' in x), ...(end ? { end: end.end } : {}) };
      }
      case 'closed': {
        const e = conn();
        const deadline = Date.now() + Number(r.timeoutMs ?? 1000);
        while (!e.c.closed && Date.now() < deadline) await new Promise((res) => setTimeout(res, 20));
        return { closed: e.c.closed };
      }
      case 'close':
        await conn().c.close();
        this.#conns.delete(String(r.conn));
        return {};
      case 'sanitize':
        return { ...sanitizeDisplayText(String(r.input)) };
      case 'row':
        return { row: eventRow(r.event as { kind: string; principal: string; at: string }) };
      case 'denominator':
        try {
          return { text: renderDenominator(r.value) };
        } catch {
          return { text: null };
        }
      default:
        throw new Error(`unknown op ${r.op}`);
    }
  }

  async stop(): Promise<void> {
    for (const e of this.#conns.values()) await e.c.close();
    this.#conns.clear();
  }
}

/** A driver in another process (any language): JSON lines on its stdin/stdout. */
export class SubprocessDriver implements Driver {
  readonly #p: ChildProcessWithoutNullStreams;
  readonly #wait = new Map<number, (r: DriverResponse) => void>();
  #buf = '';
  #n = 0;

  constructor(
    readonly language: string,
    command: string,
    args: readonly string[],
  ) {
    this.#p = spawn(command, [...args], { stdio: ['pipe', 'pipe', 'pipe'] });
    this.#p.stdout.setEncoding('utf8');
    this.#p.stdout.on('data', (chunk: string) => {
      this.#buf += chunk;
      let nl: number;
      while ((nl = this.#buf.indexOf('\n')) >= 0) {
        const line = this.#buf.slice(0, nl);
        this.#buf = this.#buf.slice(nl + 1);
        if (!line.trim()) continue;
        try {
          const r = JSON.parse(line) as DriverResponse;
          this.#wait.get(r.id as number)?.(r);
          this.#wait.delete(r.id as number);
        } catch {
          /* a non-JSON line from the driver is ignored */
        }
      }
    });
    this.#p.on('exit', () => {
      for (const cb of this.#wait.values()) cb({ ok: false, error: { kind: 'driver', message: 'driver exited' } });
      this.#wait.clear();
    });
  }

  request(req: DriverRequest): Promise<DriverResponse> {
    const id = ++this.#n;
    return new Promise((resolve) => {
      this.#wait.set(id, resolve);
      this.#p.stdin.write(`${JSON.stringify({ ...req, id })}\n`);
    });
  }

  stop(): Promise<void> {
    if (this.#p.exitCode !== null) return Promise.resolve();
    return new Promise((res) => {
      this.#p.once('exit', () => res());
      this.#p.stdin.end();
    });
  }
}
