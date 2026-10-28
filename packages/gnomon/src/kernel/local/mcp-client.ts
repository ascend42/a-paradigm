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
import { inlineOf, shellOf } from '../desk/mcp-servers.js';
import { realPrefix as realLoose } from '../runner/env.js';
import { narrow, OP_ANNOTATIONS_MAX_BYTES, OP_ANNOTATIONS_SCHEMA, type CapabilityEntry, type ServerTrust } from './capability-index.js';
import type { BrokerTarget, TargetCall } from './tool-broker.js';
import type { StagedSnapshot } from './paradigm-stage.js';
import { bindingOf, toolsHashOf, type PoolTrust } from './trust-book.js';

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
  /**
   * `first-party` (the verified staged Paradigm pin) or `enabled`. Slice C5'a1: `trusted` is never taken from here any
   * more; the pool asks the kernel's TrustBook (PoolTrust) and checks the binding. A `trusted` value is read as enabled.
   */
  trust: ServerTrust;
  /** slice C5'a1: the #mcp-servers launch hash (declHash, keyed; excludes trust and repo): the trust binding's launch half */
  launchHash?: string | null;
  /** slice C5'a1: a plugin server's plugin version (part of the trust binding) */
  pluginVersion?: string | null;
  /**
   * TD-2026-10-27-833: the first-party Paradigm MCP from its VERIFIED staged copy (#paradigm-stage): its dir, the
   * snapshot recheckStaged compares right before spawn, and the repo root it is launched for (args[1]).
   */
  staged?: { dir: string; snapshot: StagedSnapshot; repo: string };
  /** TD-2026-10-27-833: refused before launch (e.g. pin-mismatch); launchCheck lists it and never runs it */
  refused?: { fit: ServerFit; why: string };
}

/**
 * pin-mismatch     (TD-2026-10-27-833) the first-party Paradigm MCP has no verified staged pin (not staged, tampered,
 *                  or a staged file changed before spawn): not offered, never `first-party` trust
 * remote-refused   an http/sse server (never reached from a local session)
 * label-reserved   (Aegis L3) its label is gnomon, kernel, another server's, or paradigm for a non-first-party server
 * launch-writable  (Aegis H1) its command, a path-like arg, a path-like env segment or a PATH entry lies inside a
 *                  writable root (launchCheck): the server is refused
 */
export type ServerFit = 'ok' | 'remote-refused' | 'launch-writable' | 'label-reserved' | 'pin-mismatch';
/** Aegis L3: labels no third-party server may take. */
export const RESERVED_LABELS: readonly string[] = Object.freeze(['gnomon', 'kernel'])

const realOr = (p: string): string => {
  try {
    return fs.realpathSync.native(p);
  } catch {
    return path.resolve(p);
  }
};
/** `p` inside (or equal to) `root`; case-insensitive on darwin and win32 (APFS and NTFS fold case by default). */
export function within(p: string, root: string, platform: string = process.platform): boolean {
  const fold = platform === 'darwin' || platform === 'win32';
  const r = path.relative(fold ? root.toLowerCase() : root, fold ? p.toLowerCase() : p);
  return r === '' || (!r.startsWith('..') && !path.isAbsolute(r));
}
const pathLike = (a: string): boolean => path.isAbsolute(a) || a.startsWith('./') || a.startsWith('../') || a.startsWith('.\\') || /[\\/]/.test(a) || /\.(?:[cm]?[jt]s|py|sh|rb|exe|cmd|bat)$/i.test(a);

export interface LaunchCheckInput {
  /** the session's writable roots (cwd, worktree) */
  roots: readonly string[];
  /** the neutral spawn cwd (relative paths resolve against it) */
  cwd: string;
  /** the session env PATH (a server's own env PATH replaces it) */
  sessionPath: string | undefined;
  /** the user's home (`~`, `$HOME`, `${HOME}`, `%USERPROFILE%` expand to it) */
  home?: string;
  platform?: string;
}

/**
 * The path candidates one arg or env value names (Aegis MF1/MF2): the whole text, the text after its first `=`, the
 * rest of a short flag (`-I/repo` → `/repo`), the text after a `-flag:` (`-javaagent:C:\repo\a.jar`); each with
 * `file://` stripped and a leading `~`, `$HOME`, `${HOME}` or `%USERPROFILE%` expanded.
 */
export function pathCandidates(v: string, home: string | undefined): string[] {
  const raw = new Set<string>([v]);
  const eq = v.indexOf('=');
  if (eq >= 0) raw.add(v.slice(eq + 1));
  const short = /^-{1,2}[A-Za-z](.+)$/.exec(v);
  if (short) raw.add(short[1]!);
  const colon = /^-{1,2}[A-Za-z][\w.-]*:(.+)$/.exec(v);
  if (colon) raw.add(colon[1]!);
  const out = new Set<string>();
  for (let c of raw) {
    c = c.replace(/^["']|["']$/g, '').replace(/^file:\/\//i, '');
    if (home) c = c.replace(/^(?:~|\$HOME|\$\{HOME\}|%USERPROFILE%)(?=$|[\\/])/i, home);
    if (c) out.add(c);
  }
  return [...out];
}

/** Every form of a root a value could spell it in (lexical, realpath, `~/…`, `$HOME/…`), for the substring backstop. */
function rootForms(roots: readonly string[], home: string | undefined): string[] {
  const out = new Set<string>();
  for (const r of roots) {
    for (const f of [r, realOr(r)]) {
      out.add(f);
      if (home) {
        for (const h of [home, realOr(home)]) {
          if (f === h || f.startsWith(h + path.sep)) {
            const rest = f.slice(h.length);
            out.add(`~${rest}`);
            out.add(`$HOME${rest}`);
            out.add(`\${HOME}${rest}`);
          }
        }
      }
    }
  }
  return [...out].filter((f) => f.length > 1);
}

/** `text` contains `form` ending at a path boundary (end, a separator, a quote, `=`, `:` or `;`). */
function containsAtBoundary(text: string, form: string, fold: boolean): boolean {
  const t = fold ? text.toLowerCase() : text;
  const f = fold ? form.toLowerCase() : form;
  let i = t.indexOf(f);
  while (i >= 0) {
    const after = t[i + f.length];
    if (after === undefined || /[\\/"'=:;,\s]/.test(after)) return true;
    i = t.indexOf(f, i + 1);
  }
  return false;
}

/**
 * Aegis H1 (re-check): what decides what a server runs must never be model-writable. The server is spawned in a
 * NEUTRAL cwd (an empty, kernel-made, write-denied dir under the Gnomon home, outside every root), so nothing a runner
 * reads beside its cwd (package.json, node_modules, .npmrc, pyproject, `python -m` packages, `go run .`, bunfig, .env,
 * tsconfig…) comes from the repo. It is REFUSED `launch-writable` when:
 *   - it runs a shell (`sh -c`, `cmd /c`…) or inline code (`node -e`, `python -c`…): Gnomon cannot see what it loads;
 *   - its command, any path candidate of any arg or env value (pathCandidates: whole, after `=`, a short flag's rest,
 *     `file://` stripped, `~`/`$HOME`/`%USERPROFILE%` expanded; env values split on the path delimiter) or any PATH
 *     entry lies inside a writable root — checked lexically and by the realpath of its longest existing prefix
 *     (realLoose: a path that does not exist yet still resolves through a symlinked parent), case-folded on darwin
 *     and win32;
 *   - BACKSTOP: any arg or env value CONTAINS a root's text at a path boundary (lexical, realpath, `~/…`, `$HOME/…`),
 *     which catches quoting and key=value forms the parser misses.
 * A neutral dir inside a root refuses every server.
 */
export function launchCheck(servers: readonly LocalMcpServer[], i: LaunchCheckInput): { refused: Array<{ id: string; name: string; fit: ServerFit; why: string }>; servers: LocalMcpServer[] } {
  const platform = i.platform ?? process.platform;
  const fold = platform === 'darwin' || platform === 'win32';
  const roots = [...new Set([...i.roots, ...i.roots.map(realOr)])];
  const forms = rootForms(i.roots, i.home);
  const inRoot = (p: string): boolean => {
    const abs = path.resolve(i.cwd, p);
    return roots.some((r) => within(abs, r, platform) || within(realLoose(abs), r, platform));
  };
  const named = (v: string, splitDelim: boolean): boolean => {
    const parts = splitDelim ? v.split(path.delimiter) : [v];
    for (const part of parts) for (const c of pathCandidates(part, i.home)) if (pathLike(c) && inRoot(c)) return true;
    return forms.some((f) => containsAtBoundary(v, f, fold));
  };
  const refused: Array<{ id: string; name: string; fit: ServerFit; why: string }> = [];
  const kept: LocalMcpServer[] = [];
  for (const s of servers) {
    if (s.refused) {
      refused.push({ id: s.id, name: s.name, fit: s.refused.fit, why: s.refused.why });
      continue;
    }
    if (s.transport !== 'stdio') {
      kept.push(s); // the pool refuses it remote-refused
      continue;
    }
    // TD-2026-10-27-833: the ONE exception to the arg rule — a first-party server launched from its verified staged
    // copy as `node <staged>/<entry> <repoRoot>` may name the repo root as its LAST positional, and only exactly a
    // session root (the project dir it serves, not launch material). Its entry must lie inside the staged dir.
    let repoArg = -1;
    if (s.trust === 'first-party' && s.staged) {
      const a = s.args ?? [];
      if (a.length !== 2 || !within(realOr(a[0]!), s.staged.dir, platform)) {
        refused.push({ id: s.id, name: s.name, fit: 'launch-writable', why: 'the first-party launch is not `<staged entry> <repo root>`' });
        continue;
      }
      if (a[1] === s.staged.repo && i.roots.includes(a[1]!)) repoArg = 1;
    }
    const why = ((): string | null => {
      if (inRoot(i.cwd)) return 'the neutral spawn directory lies inside a session root';
      // Aegis MF3: a shell or inline code: Gnomon cannot see what it loads
      const sh = s.command ? shellOf(s.command) : null;
      const inline = s.command ? inlineOf(s.command, s.args ?? []) : null;
      if (sh || inline) return `it runs ${sh ? `a shell (${sh})` : `inline code (${inline})`}: Gnomon cannot see what it loads`;
      if (s.command && (inRoot(s.command) || forms.some((f) => containsAtBoundary(s.command!, f, fold)))) return 'its command lies inside a session root';
      for (const [k, a] of (s.args ?? []).entries()) if (k !== repoArg && a && named(a, false)) return 'an argument names a path inside a session root';
      for (const [k, v] of Object.entries(s.env ?? {})) {
        if (k.toUpperCase() === 'PATH') continue;
        if (named(v, true)) return `env ${k} names a path inside a session root`;
      }
      const envPath = Object.entries(s.env ?? {}).find(([k]) => k.toUpperCase() === 'PATH')?.[1] ?? i.sessionPath ?? '';
      for (const seg of envPath.split(path.delimiter)) for (const c of seg ? pathCandidates(seg, i.home) : []) if (inRoot(c)) return 'a PATH entry lies inside a session root';
      return null;
    })();
    if (why) refused.push({ id: s.id, name: s.name, fit: 'launch-writable', why });
    else kept.push(s);
  }
  return { refused, servers: kept };
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
  /** TEST SEAM: how a process group is killed (default killGroup) */
  killGroup?: (pid: number) => void;
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
  #leaderClosed = false;
  #caps: Record<string, unknown> = {};
  readonly exited: Promise<void>;

  constructor(child: ChildProcess, o: McpClientOptions = {}) {
    this.#child = child;
    this.#o = o;
    this.exited = new Promise((r) => child.once('close', () => r()));
    // Aegis M3 (re-check): the group is killed ONCE, when its leader closes (its children may outlive it), and the pid
    // is forgotten: a closed client is never signalled again (a reused pgid could be an unrelated group)
    child.once('close', () => {
      if (this.#leaderClosed) return;
      this.#leaderClosed = true;
      const pid = child.pid;
      // win32: no process groups (the server sits in the daemon's kill-on-close job); a pid kill after close is unsafe
      if (pid !== undefined && process.platform !== 'win32') (o.killGroup ?? killGroup)(pid);
    });
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
    return this.#leaderClosed ? undefined : this.#child.pid;
  }

  /** the leader process has closed (its group was killed then; never signalled again) */
  get closed(): boolean {
    return this.#leaderClosed;
  }

  /**
   * Aegis M3: reap the server's whole process group while its leader is live: `process.kill(-pid, 'SIGKILL')` on POSIX
   * (servers are spawned detached, so pid = pgid), ESRCH ignored; on Windows the process itself (it stays in the
   * daemon's kill-on-close job). After the leader closes nothing is signalled (pid reuse).
   */
  kill(): void {
    // Aegis M3 (re-check): only a group whose leader has NOT closed is signalled (the close handler did the rest)
    if (this.#leaderClosed) return;
    const pid = this.#child.pid;
    if (pid !== undefined) (this.#o.killGroup ?? killGroup)(pid);
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

/**
 * Slice C5'a1: the newest listing of one server id in this daemon run (any repo): what request.mcp.trust previews and
 * commits against (`listedOf`). Hashes and the label only; the tools come from the cache entry while it is still held.
 */
export interface ListedIndex {
  id: string;
  label: string;
  launchHash: string;
  pluginVersion: string | null;
  toolsHash: string;
  /** epoch ms of the listing */
  at: number;
  /** the cache key it was listed under */
  key: string;
}

/** The kernel-lifetime tools/list cache (the daemon owns one, shared by every LocalLane session; bounded, oldest dropped). */
export class McpListCache {
  readonly #m = new Map<string, ListedServer>();
  /** slice C5'a1 (Arky 5): newest listing per server id */
  readonly #newest = new Map<string, ListedIndex>();
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
  set(k: string, v: ListedServer, meta?: Omit<ListedIndex, 'key' | 'at'>, now = Date.now()): void {
    this.#m.delete(k);
    this.#m.set(k, v);
    if (this.#m.size > LIST_CACHE_MAX) this.#m.delete(this.#m.keys().next().value as string);
    if (meta) {
      this.#newest.delete(meta.id);
      this.#newest.set(meta.id, { ...meta, key: k, at: now });
      if (this.#newest.size > LIST_CACHE_MAX) this.#newest.delete(this.#newest.keys().next().value as string);
    }
  }
  /** Slice C5'a1: the newest listing of a server id in this daemon run, with its tools while the cache still holds them. */
  newest(id: string): (ListedIndex & { tools: Array<Record<string, unknown>> | null }) | null {
    const n = this.#newest.get(id);
    if (!n) return null;
    return { ...n, tools: this.#m.get(n.key)?.tools ?? null };
  }
  /**
   * Slice C5'a3 (status.rules paused): the newest listing in this daemon run of the server a tool rule names by its
   * label (mcp:<label>/<tool>); several ids under one label: the newest. null: never listed in this run.
   */
  newestByLabel(label: string): (ListedIndex & { tools: Array<Record<string, unknown>> | null }) | null {
    let best: ListedIndex | null = null;
    for (const n of this.#newest.values()) if (n.label === label && (!best || n.at >= best.at)) best = n;
    return best ? this.newest(best.id) : null;
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
  /** slice C5'a1: the kernel's TrustBook (absent: no server is trusted; first-party stays first-party) */
  trust?: PoolTrust;
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
  /** slice C5'a1: the last listing narrowed, the trust it was narrowed under, and its binding */
  listed: ListedServer | null;
  eff: ServerTrust;
  binding: string | null;
  toolsHash: string | null;
  /** slice C5'a1: a trusted server narrowed from a cache hit lists once more at its first spawn */
  relistOnSpawn: boolean;
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
      // TD-2026-10-27-833: only a verified staged pin carries `first-party` trust
      if (s.trust === 'first-party' && !s.staged) {
        this.refused.push({ id: s.id, name: s.name, fit: 'pin-mismatch' });
        continue;
      }
      const label = serverLabel(s.name);
      // Aegis L3: a label taken by another server, a kernel label, or `paradigm` for anything but the first-party server
      if (labels.has(label) || RESERVED_LABELS.includes(label) || (label === 'paradigm' && s.trust !== 'first-party')) {
        this.refused.push({ id: s.id, name: s.name, fit: 'label-reserved' });
        continue;
      }
      labels.add(label);
      this.#servers.push({ s, label, key: launchKey(s, o.repo), client: null, starting: null, error: null, starts: 0, relist: { inflight: false, pending: false, last: 0, recent: [], stale: false }, listed: null, eff: s.trust === 'first-party' ? 'first-party' : 'enabled', binding: null, toolsHash: null, relistOnSpawn: false });
    }
  }

  get labels(): string[] {
    return this.#servers.map((p) => p.label);
  }

  /** How many server processes this session has spawned and still holds. */
  get live(): number {
    return this.#servers.filter((p) => p.client && !p.client.dead).length;
  }

  #start(p: PoolServer, signal?: AbortSignal): Promise<McpStdioClient> {
    if (this.#closed) return Promise.reject(new McpError('the session is closed', 'exited'));
    if (p.client && !p.client.dead) return Promise.resolve(p.client);
    if (p.starting) return p.starting;
    if (p.starts >= MAX_STARTS) return Promise.reject(new McpError(`not restarted after ${MAX_STARTS} starts in this session (${p.error ?? 'failed'})`, 'exited'));
    p.starts++;
    p.starting = (async () => {
      // a replaced client whose leader still lives is reaped first (never one that already closed)
      if (p.client && !p.client.closed) p.client.kill();
      const child = this.#o.spawn(p.s);
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
      // slice C5'a1: a trusted server narrowed from the cache lists once more at its first spawn, BEFORE its first call;
      // a changed list re-narrows (the binding check drops trust) and a failed one stops believing its labels
      if (p.relistOnSpawn && !this.#closed) {
        p.relistOnSpawn = false;
        const before = p.toolsHash;
        try {
          const v = await this.#listed(c, p, signal ?? AbortSignal.timeout(this.#o.listTimeoutMs ?? LIST_TIMEOUT_MS));
          if (toolsHashOf(v.tools) !== before) {
            const entries = this.#narrow(p, v);
            if (!this.#closed) this.#o.onChanged?.(p.label, entries);
          }
        } catch {
          if (p.eff === 'trusted') p.eff = 'enabled';
        }
      }
      return c;
    })().finally(() => {
      p.starting = null;
    });
    return p.starting;
  }

  async #listed(c: McpStdioClient, p: PoolServer, signal?: AbortSignal): Promise<ListedServer> {
    const o = signal ? { signal } : {};
    const tools = await c.listTools(o);
    // slice C5'a1 (trap: trust flapping): op-annotation resources are read for the FIRST-PARTY server only, so trust
    // given while a server was listed as untrusted never changes what was listed
    const annotations = p.s.trust === 'first-party' ? await c.readOpAnnotations(o).catch(() => null) : null;
    const v = { tools, annotations };
    const meta = p.s.trust !== 'first-party' && p.s.launchHash ? { id: p.s.id, label: p.label, launchHash: p.s.launchHash, pluginVersion: p.s.pluginVersion ?? null, toolsHash: toolsHashOf(tools) } : undefined;
    this.#o.cache?.set(p.key, v, meta);
    return v;
  }

  /**
   * Slice C5'a1: narrow under the server's EFFECTIVE trust: first-party for the staged pin; trusted only while the
   * TrustBook holds this id with exactly this listing's binding; else enabled. A held trust whose binding differs is
   * dropped (one row, everywhere) and this listing narrows as enabled.
   */
  #narrow(p: PoolServer, v: ListedServer): CapabilityEntry[] {
    const toolsHash = toolsHashOf(v.tools);
    p.listed = v;
    p.toolsHash = toolsHash;
    p.binding = p.s.trust !== 'first-party' && p.s.launchHash ? bindingOf({ id: p.s.id, launchHash: p.s.launchHash, pluginVersion: p.s.pluginVersion ?? null, toolsHash }) : null;
    p.eff = this.#effective(p, toolsHash);
    // Aegis L2: trusted with no live client (a cache hit, or trust set after one): its first spawn re-lists once
    if (p.eff === 'trusted' && (!p.client || p.client.dead)) p.relistOnSpawn = true;
    return narrow(v.tools, p.label, { trust: p.eff, opAnnotations: p.eff === 'first-party' ? v.annotations : null });
  }

  #effective(p: PoolServer, toolsHash: string): ServerTrust {
    if (p.s.trust === 'first-party') return 'first-party';
    const t = this.#o.trust?.of(p.s.id);
    if (!t) return 'enabled';
    if (p.binding !== null && t.binding === p.binding) return 'trusted';
    // the launch (declHash or plugin version) or the tool list moved: trust ends everywhere, with a row
    this.#o.trust!.drop(p.s.id, t.launchHash !== p.s.launchHash ? 'launch-changed' : t.toolsHash !== toolsHash ? 'tools-changed' : 'launch-changed');
    return 'enabled';
  }

  /**
   * Slice C5'a1 (the broker's call-time check): how much the kernel believes this server's labels NOW: first-party;
   * trusted only while the TrustBook still holds the binding this session narrowed under; else enabled (a read tool
   * then takes a card, grace entries included).
   */
  trustLive(label: string): ServerTrust {
    const p = this.#servers.find((x) => x.label === label);
    if (!p) return 'enabled';
    if (p.eff === 'first-party') return 'first-party';
    if (p.eff !== 'trusted' || p.binding === null) return 'enabled';
    return this.#o.trust?.of(p.s.id)?.binding === p.binding ? 'trusted' : 'enabled';
  }

  /**
   * Slice C5'a2 (^local-tool-grant): the trust half of a tool rule's bindHash NOW: the TrustBook binding this session
   * narrowed under while it still holds, `first-party:<toolsHash>` for the staged pin, else null (not ruleable).
   */
  trustBindingOf(label: string): string | null {
    const p = this.#servers.find((x) => x.label === label);
    if (!p) return null;
    const live = this.trustLive(label);
    if (live === 'first-party') return p.toolsHash ? `first-party:${p.toolsHash}` : null;
    return live === 'trusted' ? p.binding : null;
  }

  /** Slice C5'a1: the labels of the servers with this id in this session. */
  labelsOf(id: string): string[] {
    return this.#servers.filter((p) => p.s.id === id).map((p) => p.label);
  }

  /** Slice C5'a1: re-narrow one server's last listing under its trust now (a trust row folded), or null when never listed. */
  renarrow(label: string): CapabilityEntry[] | null {
    const p = this.#servers.find((x) => x.label === label);
    return p?.listed ? this.#narrow(p, p.listed) : null;
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
          if (hit) {
            const entries = this.#narrow(p, hit);
            // slice C5'a1: re-checked at its first spawn (the cached list may be older than the binary)
            if (p.eff === 'trusted') p.relistOnSpawn = true;
            return entries;
          }
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
          // slice C5'a1: a call that runs with no card only because the server's labels were believed is refused when
          // that trust ended while it started (the first-spawn re-list found a change)
          if (o.trustedRead && this.trustLive(p.label) === 'enabled') return { text: `${p.label} changed, so Gnomon stopped trusting its tool labels: call ${name} again (it will ask)`, isError: true, why: 'trust-dropped' };
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
