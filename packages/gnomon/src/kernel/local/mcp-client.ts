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
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { PolicyPath } from '../manifest/policy.js';
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

/**
 * remote-refused   an http/sse server (never reached from a local session)
 * label-reserved   (Aegis L3) its label is gnomon, kernel, another server's, or paradigm for a non-first-party server
 * launch-writable  (Aegis H1) a launch-closure path IS a session root or holds one, so it cannot be write-denied
 *                  without taking the root away: the server is refused
 */
export type ServerFit = 'ok' | 'remote-refused' | 'launch-writable' | 'label-reserved';
/** Aegis L3: labels no third-party server may take. */
export const RESERVED_LABELS: readonly string[] = Object.freeze(['gnomon', 'kernel'])

/** Commands whose launch reads project files beside the cwd (package manifests, installed packages, lockfiles, venvs). */
const PROJECT_RUNNERS = new Set(['node', 'npx', 'npm', 'pnpm', 'pnpx', 'yarn', 'bun', 'bunx', 'tsx', 'ts-node', 'deno', 'uv', 'uvx', 'python', 'python3', 'pipx', 'poetry']);
/** What a project runner reads from the cwd (each a launch-closure path when the command is one of them). */
export const PROJECT_LAUNCH_FILES: readonly string[] = Object.freeze(['package.json', 'node_modules', 'package-lock.json', 'npm-shrinkwrap.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'yarn.lock', '.yarnrc.yml', '.pnp.cjs', 'bun.lockb', 'bun.lock', '.npmrc', 'deno.json', 'deno.lock', 'pyproject.toml', 'uv.lock', 'requirements.txt', 'setup.py', 'setup.cfg', 'poetry.lock', '.python-version', '.venv', 'venv']);

const pathLike = (a: string): boolean => path.isAbsolute(a) || a.startsWith('./') || a.startsWith('../') || a.startsWith('.\\') || /[\\/]/.test(a) || /\.(?:[cm]?[jt]s|py|sh|rb|exe|cmd|bat)$/i.test(a);
const realOr = (p: string): string => {
  try {
    return fs.realpathSync.native(p);
  } catch {
    return path.resolve(p);
  }
};
const within = (p: string, root: string): boolean => {
  const r = path.relative(root, p);
  return r === '' || (!r.startsWith('..') && !path.isAbsolute(r));
};

/**
 * Aegis H1: a server's LAUNCH CLOSURE — every file whose content decides what the server runs: its resolved command,
 * each path-like arg (absolute, or resolved against the spawn cwd), and for a project runner (node, npx, uv, python…)
 * the project files it reads beside the cwd (PROJECT_LAUNCH_FILES). Paths that do not exist yet are included (a model
 * could create them).
 */
export function launchClosure(s: Pick<LocalMcpServer, 'command' | 'args'>, cwd: string): Array<{ path: string; match: 'literal' | 'subpath' }> {
  const out = new Map<string, 'literal' | 'subpath'>();
  const add = (p: string): void => {
    const r = realOr(p);
    let match: 'literal' | 'subpath' = 'literal';
    try {
      if (fs.statSync(r).isDirectory()) match = 'subpath';
    } catch {
      /* absent: denied as written */
    }
    if (out.get(r) !== 'subpath') out.set(r, match);
  };
  if (s.command) add(s.command);
  for (const a of s.args ?? []) if (a && !a.startsWith('-') && pathLike(a)) add(path.resolve(cwd, a));
  const base = s.command ? path.basename(s.command).replace(/\.(exe|cmd|bat)$/i, '').toLowerCase() : '';
  if (PROJECT_RUNNERS.has(base) || /^python3(\.\d+)?$/.test(base)) {
    for (const f of PROJECT_LAUNCH_FILES) {
      const p = path.join(cwd, f);
      out.set(realOr(p), f === 'node_modules' || f === '.venv' || f === 'venv' ? 'subpath' : 'literal');
    }
  }
  return [...out].map(([p, match]) => ({ path: p, match }));
}

/**
 * Aegis H1: the write-denies a LOCAL session needs so no model-written file decides what its servers run: every
 * launch-closure path inside the session's writable roots (no overlap skip: inside the roots is exactly the danger).
 * A closure path that IS a root or holds one cannot be denied without taking the root away: that server is refused
 * `launch-writable`.
 */
export function launchDenies(servers: readonly LocalMcpServer[], cwd: string, roots: readonly string[]): { denies: PolicyPath[]; refused: Array<{ id: string; name: string; fit: ServerFit }>; servers: LocalMcpServer[] } {
  const rs = roots.map(realOr);
  const denies: PolicyPath[] = [];
  const refused: Array<{ id: string; name: string; fit: ServerFit }> = [];
  const kept: LocalMcpServer[] = [];
  for (const s of servers) {
    if (s.transport !== 'stdio') {
      kept.push(s); // the pool refuses it remote-refused
      continue;
    }
    const closure = launchClosure(s, cwd);
    if (closure.some((c) => rs.some((r) => within(r, c.path)))) {
      refused.push({ id: s.id, name: s.name, fit: 'launch-writable' });
      continue;
    }
    for (const c of closure) if (rs.some((r) => within(c.path, r)) && !denies.some((d) => d.path === c.path)) denies.push({ path: c.path, match: c.match, class: 'binary' });
    kept.push(s);
  }
  return { denies, refused, servers: kept };
}

/**
 * Aegis H2: a server's env — the session's, minus every kernel credential and handle (LOOP_SESSION_ENV_DROPPED and any
 * GNOMON_* name), plus the server's own (whose names #mcp-servers already hazard-checked; a GNOMON_* one is dropped).
 */
export function serverEnv(sessionEnv: Readonly<Record<string, string | undefined>>, own: Readonly<Record<string, string>> | undefined, dropped: readonly string[]): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(sessionEnv)) if (!dropped.includes(k) && !/^GNOMON_/i.test(k)) out[k] = v;
  for (const [k, v] of Object.entries(own ?? {})) if (!/^GNOMON_/i.test(k)) out[k] = v;
  return out;
}

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
      // Aegis L5: only a `…/tool-annotations` URI, or a resource that carries the explicit io.gnomon/op-annotations marker
      if (Array.isArray(r.resources)) for (const x of r.resources) if (isObj(x) && typeof x.uri === 'string' && x.uri.length <= 512) listed.push({ uri: x.uri, json: isObj(x._meta) && x._meta['io.gnomon/op-annotations'] === true });
      cursor = typeof r.nextCursor === 'string' && r.nextCursor ? r.nextCursor : undefined;
      if (!cursor || listed.length >= 256) break;
    }
    const ranked = [...listed.filter((x) => /\/tool-annotations$/.test(x.uri)), ...listed.filter((x) => x.json && !/\/tool-annotations$/.test(x.uri))]; // json = marked
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
  get pid(): number | undefined {
    return this.#child.pid;
  }

  /**
   * Aegis M3: reap the server's whole process group, ALWAYS (even after the leader exited, its children may live on):
   * `process.kill(-pid, 'SIGKILL')` on POSIX (servers are spawned detached, so pid = pgid), ESRCH ignored; on Windows
   * the process itself (it stays in the daemon's kill-on-close job).
   */
  kill(): void {
    const pid = this.#child.pid;
    if (pid !== undefined) killGroup(pid);
    try {
      this.#child.kill('SIGKILL');
    } catch {
      /* gone */
    }
  }
}

/** SIGKILL a process group (POSIX) or process (win32); a missing group (ESRCH) or a non-leader is ignored. */
export function killGroup(pid: number): void {
  try {
    if (process.platform !== 'win32') process.kill(-pid, 'SIGKILL');
    else process.kill(pid, 'SIGKILL');
  } catch {
    /* ESRCH: gone */
  }
}

/** Aegis M4: list_changed storms — at most this many relists per server per minute (past it the server is stale). */
export const RELISTS_PER_MINUTE = 6;
/** … and at least this long between two relists of one server. */
export const RELIST_MIN_GAP_MS = 2_000;
/** Aegis M5: a server that failed to start or list is not tried again for this long (kernel-wide, per launch). */
export const FAILURE_TTL_MS = 60_000;

/** What a server listed, as the kernel caches it per launch. */
export interface ListedServer {
  tools: Array<Record<string, unknown>>;
  annotations: unknown;
}

/** The kernel-lifetime tools/list cache (LocalLane owns one; bounded, oldest dropped). */
export class McpListCache {
  readonly #m = new Map<string, ListedServer>();
  readonly #failed = new Map<string, { at: number; why: string }>();
  /** Aegis M5: a recent failure of this launch (within FAILURE_TTL_MS), or undefined */
  failure(k: string, now = Date.now()): string | undefined {
    const f = this.#failed.get(k);
    if (f && now - f.at < FAILURE_TTL_MS) return f.why;
    this.#failed.delete(k);
    return undefined;
  }
  fail(k: string, why: string, now = Date.now()): void {
    this.#failed.set(k, { at: now, why });
    if (this.#failed.size > LIST_CACHE_MAX) this.#failed.delete(this.#failed.keys().next().value as string);
  }
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
  /** Aegis M3: register each spawned server with the daemon's children (stopped with the daemon) */
  track?: (child: ChildProcess, label: string) => void;
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
  /** Aegis M4: relist throttle */
  relist: { inflight: boolean; pending: boolean; last: number; recent: number[]; stale: boolean };
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
      // Aegis L3: a label taken by another server, a kernel label, or `paradigm` for anything but the first-party server
      if (labels.has(label) || RESERVED_LABELS.includes(label) || (label === 'paradigm' && s.trust !== 'first-party')) {
        this.refused.push({ id: s.id, name: s.name, fit: 'label-reserved' });
        continue;
      }
      labels.add(label);
      this.#servers.push({ s, label, key: launchKey(s, o.repo), client: null, starting: null, error: null, starts: 0, relist: { inflight: false, pending: false, last: 0, recent: [], stale: false } });
    }
  }

  get labels(): string[] {
    return this.#servers.map((p) => p.label);
  }

  /** How many server processes this session has spawned and still holds. */
  get live(): number {
    return this.#servers.filter((p) => p.client && !p.client.dead).length;
  }

  /** Aegis M3: every pid this session ever spawned (each group is killed at close, live or not). */
  readonly #pids = new Set<number>();

  #start(p: PoolServer, signal?: AbortSignal): Promise<McpStdioClient> {
    if (this.#closed) return Promise.reject(new McpError('the session is closed', 'exited'));
    if (p.client && !p.client.dead) return Promise.resolve(p.client);
    if (p.starting) return p.starting;
    // Aegis M3: a dead server's group is reaped before it is started again
    if (p.client?.pid !== undefined) killGroup(p.client.pid);
    if (p.starts >= MAX_STARTS) return Promise.reject(new McpError(`not restarted after ${MAX_STARTS} starts in this session (${p.error ?? 'failed'})`, 'exited'));
    p.starts++;
    p.starting = (async () => {
      const child = this.#o.spawn(p.s);
      if (child.pid !== undefined) this.#pids.add(child.pid);
      this.#o.track?.(child, p.label);
      const c = new McpStdioClient(child, {
        ...(this.#o.maxMessageBytes ? { maxMessageBytes: this.#o.maxMessageBytes } : {}),
        ...(this.#o.listTimeoutMs ? { listTimeoutMs: this.#o.listTimeoutMs } : {}),
        onListChanged: () => this.#relistSoon(p),
        onExit: (why) => {
          p.error = why;
        },
      });
      p.client = c;
      try {
        await c.initialize(signal ? { signal } : {});
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

  async #listed(c: McpStdioClient, p: PoolServer, signal?: AbortSignal): Promise<ListedServer> {
    const o = signal ? { signal } : {};
    const tools = await c.listTools(o);
    const annotations = p.s.trust === 'enabled' ? null : await c.readOpAnnotations(o).catch(() => null);
    const v = { tools, annotations };
    this.#o.cache?.set(p.key, v);
    return v;
  }

  #narrow(p: PoolServer, v: ListedServer): CapabilityEntry[] {
    return narrow(v.tools, p.label, { trust: p.s.trust, opAnnotations: v.annotations });
  }

  /**
   * Aegis M4: a list_changed — one relist in flight plus one pending, at least RELIST_MIN_GAP_MS apart, at most
   * RELISTS_PER_MINUTE a minute; past the cap the server is STALE (its last list stands, no more relists this session).
   */
  #relistSoon(p: PoolServer): void {
    const r = p.relist;
    if (r.stale || this.#closed) return;
    if (r.inflight) {
      r.pending = true;
      return;
    }
    const now = Date.now();
    r.recent = r.recent.filter((t) => now - t < 60_000);
    if (r.recent.length >= RELISTS_PER_MINUTE) {
      r.stale = true;
      p.error = 'stale: too many tools/list_changed';
      return;
    }
    const wait = Math.max(0, r.last + RELIST_MIN_GAP_MS - now);
    r.inflight = true;
    const t = setTimeout(() => {
      r.last = Date.now();
      r.recent.push(r.last);
      void this.#relist(p)
        .catch(() => undefined)
        .finally(() => {
          r.inflight = false;
          if (r.pending) {
            r.pending = false;
            this.#relistSoon(p);
          }
        });
    }, wait);
    t.unref?.();
  }

  async #relist(p: PoolServer): Promise<void> {
    const c = p.client;
    if (!c || c.dead || this.#closed) return;
    const v = await this.#listed(c, p, AbortSignal.timeout(this.#o.listTimeoutMs ?? LIST_TIMEOUT_MS));
    if (!this.#closed) this.#o.onChanged?.(p.label, this.#narrow(p, v));
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
          if (hit) return this.#narrow(p, hit);
          // Aegis M5: a launch that just failed is not retried at every open (briefly cached)
          const failed = this.#o.cache?.failure(p.key);
          if (failed) throw new Error(`failed recently: ${failed}`);
          // Aegis M5: one deadline per server for start + list + annotations at open
          const signal = AbortSignal.timeout(this.#o.listTimeoutMs ?? LIST_TIMEOUT_MS);
          return this.#narrow(p, await this.#listed(await this.#start(p, signal), p, signal));
        } catch (e) {
          p.error = (e as Error).message.slice(0, 200);
          if (!/^failed recently/.test(p.error)) this.#o.cache?.fail(p.key, p.error);
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
    // Aegis M3: every group this session ever spawned (restarted servers' old groups too)
    for (const pid of this.#pids) killGroup(pid);
    await Promise.all(waits);
  }
}
