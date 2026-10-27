/**
 * @symbol #local-mcp-client
 *
 * #local-mcp-client (TD-2026-10-27-833 slice C2'): the kernel's own minimal MCP client, so a LOCAL session reaches
 * the same MCP servers a Claude session gets (founder: every server enabled for Claude sessions is available to local
 * ones). stdio only, newline-delimited JSON-RPC 2.0:
 *
 *   initialize (+ notifications/initialized), tools/list (paged, bounded), tools/call, resources/list and
 *   resources/read (only to find an op-annotations document, schema io.gnomon/op-annotations:v1: a resource whose URI
 *   ends `/tool-annotations` is read first, then other application/json resources, at most OP_ANNOTATION_READS reads of
 *   at most OP_ANNOTATIONS_MAX_BYTES each, and only for a trusted server), notifications/tools/list_changed (the pool
 *   re-lists AND re-reads the annotations: there is no resource-changed notification), notifications/cancelled sent
 *   when the broker's signal aborts a call.
 *
 * Bounds: one message at most MCP_MESSAGE_MAX_BYTES (a longer line kills the server: a crash), every request a
 * timeout (init/list LIST_TIMEOUT_MS; a call the broker's deadline), at most MAX_TOOLS tools and MAX_LIST_PAGES pages,
 * at most MAX_PENDING requests in flight. A crash or exit rejects every pending request; the next use restarts the
 * server, at most MAX_STARTS starts per server per session.
 *
 * LocalMcpPool (one per local session): the session's servers come from #mcp-servers (McpServers.composeLocal: the
 * first-party Paradigm MCP as trust `first-party`, then every server ENABLED for this session's repo at its current
 * launch hash — a project-scope server only ever in its own repo — with the store entry's trust, default `enabled`).
 * A remote http/sse server is never reached: it is refused with fit `remote-refused`. Each stdio server is spawned
 * LAZILY, at its first use in the session, through the session's `spawn` (LocalLane: the session's own launch plan,
 * sessionLaunchPlan with the session's policy, so it has exactly the session's files and network, as Claude-session
 * servers do). Building the index at open is a use only on a cache miss: the kernel keeps each server's last
 * tools/list + annotations keyed by its launch (command, args, env, repo), so a later session in the same repo spawns
 * the server only when the model first calls one of its tools. closeAll() reaps every server (session exit).
 */
import type { ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { narrow, OP_ANNOTATIONS_MAX_BYTES, OP_ANNOTATIONS_SCHEMA, type CapabilityEntry, type ServerTrust } from './capability-index.js';
import type { BrokerTarget, TargetCall } from './tool-broker.js';

export const MCP_PROTOCOL_VERSION = '2025-06-18';
export const MCP_MESSAGE_MAX_BYTES = 4 * 1024 * 1024;
export const LIST_TIMEOUT_MS = 15_000;
export const MAX_LIST_PAGES = 16;
export const MAX_TOOLS = 256;
export const MAX_PENDING = 32;
export const OP_ANNOTATION_READS = 4;
export const LIST_CACHE_MAX = 64;
/** A server that crashed this many times in one session is not started again in it. */
export const MAX_STARTS = 3;

/** One server a local session may reach (from #mcp-servers). */
export interface LocalMcpServer {
  /** the #mcp-servers row id (`first-party:paradigm`, `<source>:<owner>:<name>`) */
  id: string;
  /** the session name (mcp.json key) */
  name: string;
  transport: 'stdio' | 'http' | 'sse';
  command?: string;
  args?: readonly string[];
  env?: Readonly<Record<string, string>>;
  trust: ServerTrust;
}

export type ServerFit = 'ok' | 'remote-refused';

/** The label a server goes by in ids, provenance (`mcp:<label>`) and tool.brokered{server}. */
export const serverLabel = (name: string): string => {
  const l = name.toLowerCase().replace(/[^a-z0-9_-]/g, '-').replace(/^[^a-z0-9]+/, '').slice(0, 64);
  return l || 'server';
};

export class McpError extends Error {
  constructor(message: string, readonly code: 'timeout' | 'aborted' | 'exited' | 'protocol' | 'remote' | 'busy') {
    super(message);
  }
}

const isObj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);

export interface McpClientOptions {
  maxMessageBytes?: number;
  listTimeoutMs?: number;
  onListChanged?: () => void;
  onExit?: (why: string) => void;
}

interface Pending {
  resolve: (v: Record<string, unknown>) => void;
  reject: (e: Error) => void;
}

/** One stdio MCP server, over a child the caller spawned (confined by the caller's launch plan). */
export class McpStdioClient {
  readonly #child: ChildProcess;
  readonly #o: McpClientOptions;
  readonly #pending = new Map<number, Pending>();
  #id = 0;
  #buf = '';
  #bufBytes = 0;
  #dead: string | null = null;
  #caps: Record<string, unknown> = {};
  readonly exited: Promise<void>;

  constructor(child: ChildProcess, o: McpClientOptions = {}) {
    this.#child = child;
    this.#o = o;
    this.exited = new Promise((r) => child.once('close', () => r()));
    child.stdout?.setEncoding('utf8');
    child.stdout?.on('data', (chunk: string) => this.#data(chunk));
    child.stdin?.on('error', () => undefined);
    child.once('error', (e) => this.#die(`spawn failed: ${e.message}`));
    child.once('close', (code, sig) => this.#die(`the server exited (${sig ?? code})`));
  }

  get dead(): string | null {
    return this.#dead;
  }

  get capabilities(): Record<string, unknown> {
    return this.#caps;
  }

  #data(chunk: string): void {
    const max = this.#o.maxMessageBytes ?? MCP_MESSAGE_MAX_BYTES;
    let rest = chunk;
    for (;;) {
      const nl = rest.indexOf('\n');
      const part = nl < 0 ? rest : rest.slice(0, nl);
      this.#buf += part;
      this.#bufBytes += Buffer.byteLength(part, 'utf8');
      if (this.#bufBytes > max) {
        this.#die(`a message over ${max} bytes`);
        this.kill();
        return;
      }
      if (nl < 0) return;
      const line = this.#buf.trim();
      this.#buf = '';
      this.#bufBytes = 0;
      rest = rest.slice(nl + 1);
      if (line) this.#message(line);
    }
  }

  #message(line: string): void {
    let m: unknown;
    try {
      m = JSON.parse(line);
    } catch {
      return; // not JSON-RPC: ignored (a server's stray log line)
    }
    if (!isObj(m)) return;
    if (typeof m.method === 'string' && m.id === undefined) {
      if (m.method === 'notifications/tools/list_changed') this.#o.onListChanged?.();
      return;
    }
    if (typeof m.method === 'string') {
      // a server-to-client request (sampling, roots, elicitation): the kernel offers none of them
      this.#send({ jsonrpc: '2.0', id: m.id, error: { code: -32601, message: 'not supported by the gnomon kernel' } });
      return;
    }
    if (typeof m.id !== 'number') return;
    const p = this.#pending.get(m.id);
    if (!p) return;
    this.#pending.delete(m.id);
    if (isObj(m.error)) p.reject(new McpError(typeof m.error.message === 'string' ? m.error.message.slice(0, 500) : 'the server returned an error', 'remote'));
    else p.resolve(isObj(m.result) ? m.result : {});
  }

  #die(why: string): void {
    if (this.#dead) return;
    this.#dead = why;
    for (const p of this.#pending.values()) p.reject(new McpError(why, 'exited'));
    this.#pending.clear();
    this.#o.onExit?.(why);
  }

  #send(m: Record<string, unknown>): void {
    if (this.#dead) return;
    try {
      this.#child.stdin?.write(`${JSON.stringify(m)}\n`);
    } catch {
      /* the close handler reports it */
    }
  }

  /** One request; rejects on timeout (deadline), abort (notifications/cancelled sent), exit or a server error. */
  request(method: string, params: Record<string, unknown> | undefined, o: { signal?: AbortSignal; deadline?: number; timeoutMs?: number } = {}): Promise<Record<string, unknown>> {
    if (this.#dead) return Promise.reject(new McpError(this.#dead, 'exited'));
    if (this.#pending.size >= MAX_PENDING) return Promise.reject(new McpError('too many requests in flight', 'busy'));
    if (o.signal?.aborted) return Promise.reject(new McpError('aborted', 'aborted'));
    const id = ++this.#id;
    const ms = o.deadline !== undefined ? Math.max(0, o.deadline - Date.now()) : (o.timeoutMs ?? this.#o.listTimeoutMs ?? LIST_TIMEOUT_MS);
    return new Promise((resolve, reject) => {
      const cleanup = (): void => {
        clearTimeout(timer);
        o.signal?.removeEventListener('abort', onAbort);
        this.#pending.delete(id);
      };
      const cancel = (reason: string): void => this.#send({ jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: id, reason } });
      const onAbort = (): void => {
        cleanup();
        cancel('aborted');
        reject(new McpError('aborted', 'aborted'));
      };
      const timer = setTimeout(() => {
        cleanup();
        cancel('timeout');
        reject(new McpError(`${method} timed out after ${ms} ms`, 'timeout'));
      }, ms);
      timer.unref?.();
      o.signal?.addEventListener('abort', onAbort, { once: true });
      this.#pending.set(id, {
        resolve: (v) => {
          cleanup();
          resolve(v);
        },
        reject: (e) => {
          cleanup();
          reject(e);
        },
      });
      this.#send({ jsonrpc: '2.0', id, method, ...(params ? { params } : {}) });
    });
  }

  async initialize(o: { signal?: AbortSignal } = {}): Promise<void> {
    const r = await this.request('initialize', { protocolVersion: MCP_PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: 'gnomon-kernel', version: '8' } }, o);
    this.#caps = isObj(r.capabilities) ? r.capabilities : {};
    this.#send({ jsonrpc: '2.0', method: 'notifications/initialized' });
  }

  async listTools(o: { signal?: AbortSignal } = {}): Promise<Array<Record<string, unknown>>> {
    const out: Array<Record<string, unknown>> = [];
    let cursor: string | undefined;
    for (let page = 0; page < MAX_LIST_PAGES; page++) {
      const r = await this.request('tools/list', cursor ? { cursor } : undefined, o);
      if (Array.isArray(r.tools)) for (const t of r.tools) if (isObj(t) && out.length < MAX_TOOLS) out.push(t);
      cursor = typeof r.nextCursor === 'string' && r.nextCursor ? r.nextCursor : undefined;
      if (!cursor || out.length >= MAX_TOOLS) break;
    }
    return out;
  }

  /**
   * The server's op-annotations document, or null: resources/list (when the server advertises resources), then
   * resources/read of `…/tool-annotations` URIs first and other application/json ones after, at most
   * OP_ANNOTATION_READS reads; the first whose text (≤ OP_ANNOTATIONS_MAX_BYTES) parses to schema
   * io.gnomon/op-annotations:v1. Its shape is checked by narrow() (parseOpAnnotations).
   */
  async readOpAnnotations(o: { signal?: AbortSignal } = {}): Promise<unknown> {
    if (!isObj(this.#caps.resources)) return null;
    const listed: Array<{ uri: string; json: boolean }> = [];
    let cursor: string | undefined;
    for (let page = 0; page < 4; page++) {
      const r = await this.request('resources/list', cursor ? { cursor } : undefined, o).catch(() => ({}) as Record<string, unknown>);
      if (Array.isArray(r.resources)) for (const x of r.resources) if (isObj(x) && typeof x.uri === 'string' && x.uri.length <= 512) listed.push({ uri: x.uri, json: x.mimeType === 'application/json' });
      cursor = typeof r.nextCursor === 'string' && r.nextCursor ? r.nextCursor : undefined;
      if (!cursor || listed.length >= 256) break;
    }
    const ranked = [...listed.filter((x) => /\/tool-annotations$/.test(x.uri)), ...listed.filter((x) => x.json && !/\/tool-annotations$/.test(x.uri))];
    for (const x of ranked.slice(0, OP_ANNOTATION_READS)) {
      const r = await this.request('resources/read', { uri: x.uri }, o).catch(() => null);
      const c = r && Array.isArray(r.contents) ? r.contents.find((y) => isObj(y) && typeof y.text === 'string') : undefined;
      const text = isObj(c) ? (c.text as string) : '';
      if (!text || Buffer.byteLength(text, 'utf8') > OP_ANNOTATIONS_MAX_BYTES) continue;
      try {
        const j = JSON.parse(text) as unknown;
        if (isObj(j) && j.schema === OP_ANNOTATIONS_SCHEMA) return j;
      } catch {
        /* not JSON */
      }
    }
    return null;
  }

  async callTool(name: string, args: Record<string, unknown>, o: { signal?: AbortSignal; deadline?: number }): Promise<{ text: string; isError: boolean }> {
    const r = await this.request('tools/call', { name, arguments: args }, o);
    const text = Array.isArray(r.content) ? r.content.filter(isObj).map((c) => (c.type === 'text' && typeof c.text === 'string' ? c.text : `[${typeof c.type === 'string' ? c.type.slice(0, 32) : 'content'} omitted]`)).join('\n') : '';
    return { text, isError: r.isError === true };
  }

  /** Reap: the server's process group (posix: spawned detached) or the process. */
  kill(): void {
    const pid = this.#child.pid;
    if (pid === undefined || this.#child.exitCode !== null || this.#child.signalCode !== null) return;
    try {
      if (process.platform !== 'win32') process.kill(-pid, 'SIGKILL');
      else this.#child.kill('SIGKILL');
    } catch {
      try {
        this.#child.kill('SIGKILL');
      } catch {
        /* gone */
      }
    }
  }
}

/** What a server listed, as the kernel caches it per launch. */
export interface ListedServer {
  tools: Array<Record<string, unknown>>;
  annotations: unknown;
}

/** The kernel-lifetime tools/list cache (LocalLane owns one; bounded, oldest dropped). */
export class McpListCache {
  readonly #m = new Map<string, ListedServer>();
  get(k: string): ListedServer | undefined {
    return this.#m.get(k);
  }
  set(k: string, v: ListedServer): void {
    this.#m.delete(k);
    this.#m.set(k, v);
    if (this.#m.size > LIST_CACHE_MAX) this.#m.delete(this.#m.keys().next().value as string);
  }
  get size(): number {
    return this.#m.size;
  }
}

/** The cache key of one server's launch in one repo (values hashed, never kept in clear). */
export function launchKey(s: LocalMcpServer, repo: string): string {
  return createHash('sha256').update(JSON.stringify([s.id, s.name, s.command ?? null, s.args ?? [], Object.entries(s.env ?? {}).sort(), s.trust, repo])).digest('hex');
}

export interface LocalMcpPoolOptions {
  servers: readonly LocalMcpServer[];
  /** the session's spawn: the server's command under the SESSION's launch plan (stdio piped, stderr ignored) */
  spawn: (s: LocalMcpServer) => ChildProcess;
  /** the session's repo (the cache key) */
  repo: string;
  cache?: McpListCache;
  listTimeoutMs?: number;
  maxMessageBytes?: number;
  /** a server re-listed after notifications/tools/list_changed: its new entries */
  onChanged?: (label: string, entries: CapabilityEntry[]) => void;
}

interface PoolServer {
  s: LocalMcpServer;
  label: string;
  key: string;
  client: McpStdioClient | null;
  starting: Promise<McpStdioClient> | null;
  /** last failure (spawn, initialize, crash) */
  error: string | null;
  starts: number;
}

/** One local session's MCP servers (never shared across sessions). */
export class LocalMcpPool {
  readonly #o: LocalMcpPoolOptions;
  readonly #servers: PoolServer[] = [];
  readonly refused: Array<{ id: string; name: string; fit: ServerFit }> = [];
  #closed = false;

  constructor(o: LocalMcpPoolOptions) {
    this.#o = o;
    const labels = new Set<string>();
    for (const s of o.servers) {
      if (s.transport !== 'stdio' || !s.command) {
        this.refused.push({ id: s.id, name: s.name, fit: 'remote-refused' });
        continue;
      }
      const label = serverLabel(s.name);
      if (labels.has(label) || label === 'gnomon') continue; // a name that would collide with another (or the kernel's own)
      labels.add(label);
      this.#servers.push({ s, label, key: launchKey(s, o.repo), client: null, starting: null, error: null, starts: 0 });
    }
  }

  get labels(): string[] {
    return this.#servers.map((p) => p.label);
  }

  /** How many server processes this session has spawned and still holds. */
  get live(): number {
    return this.#servers.filter((p) => p.client && !p.client.dead).length;
  }

  #start(p: PoolServer): Promise<McpStdioClient> {
    if (this.#closed) return Promise.reject(new McpError('the session is closed', 'exited'));
    if (p.client && !p.client.dead) return Promise.resolve(p.client);
    if (p.starting) return p.starting;
    if (p.starts >= MAX_STARTS) return Promise.reject(new McpError(`not restarted after ${MAX_STARTS} starts in this session (${p.error ?? 'failed'})`, 'exited'));
    p.starts++;
    p.starting = (async () => {
      const child = this.#o.spawn(p.s);
      const c = new McpStdioClient(child, {
        ...(this.#o.maxMessageBytes ? { maxMessageBytes: this.#o.maxMessageBytes } : {}),
        ...(this.#o.listTimeoutMs ? { listTimeoutMs: this.#o.listTimeoutMs } : {}),
        onListChanged: () => void this.#relist(p).catch(() => undefined),
        onExit: (why) => {
          p.error = why;
        },
      });
      p.client = c;
      try {
        await c.initialize();
      } catch (e) {
        c.kill();
        throw e;
      }
      if (this.#closed) c.kill();
      return c;
    })().finally(() => {
      p.starting = null;
    });
    return p.starting;
  }

  async #listed(c: McpStdioClient, p: PoolServer): Promise<ListedServer> {
    const tools = await c.listTools();
    const annotations = p.s.trust === 'enabled' ? null : await c.readOpAnnotations().catch(() => null);
    const v = { tools, annotations };
    this.#o.cache?.set(p.key, v);
    return v;
  }

  #narrow(p: PoolServer, v: ListedServer): CapabilityEntry[] {
    return narrow(v.tools, p.label, { trust: p.s.trust, opAnnotations: v.annotations });
  }

  async #relist(p: PoolServer): Promise<void> {
    const c = p.client;
    if (!c || c.dead || this.#closed) return;
    const v = await this.#listed(c, p);
    this.#o.onChanged?.(p.label, this.#narrow(p, v));
  }

  /**
   * Every server's narrow entries, in server order. A cache hit spawns nothing; a miss spawns the server (its first
   * use) and lists it. A server that fails is left out (its error kept), never fatal.
   */
  async index(): Promise<{ entries: CapabilityEntry[]; failed: Array<{ label: string; error: string }> }> {
    const res = await Promise.all(
      this.#servers.map(async (p) => {
        try {
          const hit = this.#o.cache?.get(p.key);
          return this.#narrow(p, hit ?? (await this.#listed(await this.#start(p), p)));
        } catch (e) {
          p.error = (e as Error).message.slice(0, 200);
          return null;
        }
      }),
    );
    const failed = this.#servers.flatMap((p, i) => (res[i] === null ? [{ label: p.label, error: p.error ?? 'failed' }] : []));
    return { entries: res.flatMap((r) => r ?? []), failed };
  }

  /** The broker target of one server (no gate of its own: the broker's class gate decides). */
  target(label: string): BrokerTarget | null {
    const p = this.#servers.find((x) => x.label === label);
    if (!p) return null;
    return {
      server: p.label,
      provenance: `mcp:${p.label}`,
      ownsGate: false,
      list: async () => {
        const c = await this.#start(p);
        return (await c.listTools()).map((t) => ({ name: String(t.name), description: typeof t.description === 'string' ? t.description : '', inputSchema: isObj(t.inputSchema) ? t.inputSchema : {} }));
      },
      call: async (name: string, args: Record<string, unknown>, o: TargetCall) => {
        try {
          const c = await this.#start(p);
          if (o.signal.aborted) return { text: 'cancelled', isError: true, why: 'cancelled' };
          o.onRunning?.();
          return await c.callTool(name, args, { signal: o.signal, deadline: o.deadline });
        } catch (e) {
          const err = e as McpError;
          if (err.code === 'aborted') return { text: 'cancelled: the call was aborted', isError: true, why: 'cancelled' };
          if (err.code === 'timeout') return { text: `the ${name} call timed out`, isError: true };
          return { text: `the ${p.label} server failed: ${err.message.slice(0, 200)}`, isError: true };
        }
      },
    };
  }

  /** Session exit: every server reaped; later uses refuse. */
  async closeAll(): Promise<void> {
    this.#closed = true;
    const waits: Array<Promise<void>> = [];
    for (const p of this.#servers) {
      if (!p.client) continue;
      p.client.kill();
      waits.push(Promise.race([p.client.exited, new Promise<void>((r) => setTimeout(r, 2000).unref?.())]));
    }
    await Promise.all(waits);
  }
}
