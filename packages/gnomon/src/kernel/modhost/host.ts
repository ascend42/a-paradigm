/**
 * @symbol #mod-host
 *
 * #mod-host (spec §3.8, §12.1–§12.3, §15.5 row `mod`; §19.1 M1.11) — one
 * child process per mod, over `mod-abi:v1`, under the default-deny `mod`
 * profile, from its PINNED SNAPSHOT only.
 *
 * START (`start(name)`): #manifest-loader's `loadMod` decides what may load —
 * a root-signed `grant.install`, a snapshot that still hashes to its
 * `packageHash`, a manifest that matches its `manifestHash`, every required
 * capability and egress host granted, and (for a linked folder) a source tree
 * unchanged since the pin; a changed folder PAUSES the mod and stages the
 * re-approve card instead of loading (`mod.paused`, G-MOD-08). Then:
 *   - the effects in force: the union of the tools' declared effects, capped
 *     at `read` while a `grant.install{dev}` is live (§12.5); an EXPIRED dev
 *     period pauses the mod (`mod.dev.expired`) until re-carded — fail closed;
 *   - the egress proxy (egress-proxy.ts) when the mod holds `network` AND its
 *     declared hosts are granted; the profile then allows outbound to that
 *     port only, otherwise no network at all;
 *   - the launch plan from the `mod` profile registry (sandbox/mod.ts), or
 *     `sandbox-unavailable` (fail closed); `mod.sandbox{name, profile,
 *     sandbox, profileHash}` is logged;
 *   - spawn `node <entry>` (`index.mjs`, else `index.js`, inside the snapshot;
 *     manifest:v1 has no entry field) detached, env = {GNOMON_MOD_NAME,
 *     GNOMON_EGRESS_PROXY?} only — never the socket credential, never HOME;
 *   - tracked by the daemon's children (DaemonChildren `kind:'mod'`): §9.1 has
 *     no `mod.spawned` / `mod.exited` kind and adding one moves clientApiId, so
 *     mod children are tracked IN MEMORY (a mod orphaned by a daemon crash is
 *     not swept — the residual M1.9 states); `mod.stopped` is written by the
 *     children registry on every stop;
 *   - `init{abi, features}` must answer `mod-abi:v1` and THIS `modAbiId`, else
 *     the child is stopped and the start refused ABI; then `mod.health{ok}`.
 *
 * CALLS: host → mod calls are SERIALIZED per mod, so a mod → host request is
 * attributed to the call in force when it ARRIVES (effects.ts). Residual,
 * stated: a request a mod delays past its call's end is judged against the
 * idle context (read only), which can only narrow, never widen; binding each
 * request to a call id is slice 2. Each call
 * has a timeout; on expiry the host sends `cancel{cancelToken}` and, if the
 * call is not settled within the cancel grace, restarts the child (§12.3).
 * mod → host: `state.get` (read), `state.set` (write), `kernel.call` (by verb;
 * `approve` never; log.append only of the mod's own declared `modns.<name>.*`;
 * `session.send` only inside a tool call carrying the caller's hsid). A call
 * outside the effects in force ⇒ FORBIDDEN + `mod.effect.refused`. The egress
 * proxy refuses a tunnel opened while the call in force lacks `network`.
 * Rendered blocks pass the closed-kit gate (block.ts) and come back fenced and
 * labelled `mod:<name>` (+ `dev`); `mod.view.rendered{name, slot, ms}`.
 * RELAYS: `relayView` / `relayCommand` stamp `relayedFor{principal, connId}`
 * from the CALLER's authenticated connection — a mod can never name who acted.
 *
 * SUPERVISION: an unexpected exit ⇒ `mod.health{ok:false}` and a restart
 * (cap 3 per 10 min, then the mod stays down until started again); a crash
 * never reaches the kernel (G-MOD-03): every channel error is contained.
 *
 * SLICE 2 (named, not built): the socket wiring of the relays and of
 * kernel.call (the dispatcher's mod principal, scopes intersected, spend from
 * the caller's permit), the folder watch (fs.watch, 500 ms debounce), dev-mode
 * cards/expiry scheduling/cwd exclusion, the `gnomon-mods` MCP bridge, Tier 0
 * templates, `gnomon mod …` CLI, and wiring the host into startDaemon.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { MOD_ABI_ID, MOD_ABI_V1, type RelayedFor } from '@a-company/gnomon-contracts';
import type { RowVerifier } from '../identity/registry.js';
import { registerSeams } from '../internal-seams.js';
import { isLifecycleRefusal } from '../lifecycle/refusal.js';
import type { TrackInput } from '../lifecycle/children.js';
import { effectiveInstall, readGrants } from '../manifest/grants.js';
import { loadMod } from '../manifest/install.js';
import type { ManifestV1, ToolEffect } from '../manifest/manifest.js';
import { noEvents, type ManifestEventSink } from '../manifest/refusal.js';
import { checkEgressHost } from '../manifest/egress.js';
import type { TreeDiff } from '../manifest/snapshot.js';
import { modLaunchPlan, type ModLaunchInput } from '../sandbox/mod.js';
import type { ChildLaunchPlan } from '../sandbox/transport.js';
import { sanitizeModBlock } from './block.js';
import { ModChannel, ModRpcError } from './channel.js';
import { declaredEffects, effectsFor, methodEffect, type CallContext } from './effects.js';
import { EgressProxy, type EgressDial } from './egress-proxy.js';
import { ModRefusal } from './refusal.js';
import { blobsDir, ModState, stateDir } from './state.js';

const isLink = (p: string): boolean => {
  try {
    return fs.lstatSync(p).isSymbolicLink();
  } catch {
    return false;
  }
};

export const MOD_ENTRIES = Object.freeze(['index.mjs', 'index.js']);
export const DEFAULT_CALL_TIMEOUT_MS = 5_000;
export const DEFAULT_CANCEL_GRACE_MS = 1_000;
export const RESTART_CAP = Object.freeze({ n: 3, windowMs: 10 * 60_000 });

export interface ModChildrenPort {
  track(input: TrackInput): Promise<void>;
  stop(child: ChildProcess, reason: string): Promise<boolean>;
}

export interface KernelCallRequest {
  name: string;
  principal: string;
  verb: string;
  params: Record<string, unknown>;
  /** the caller's hsid (a tool call from a session), attached for the confused-deputy guard */
  hsid?: string;
}

export interface ModHostOptions {
  home: string;
  trust: RowVerifier;
  children: ModChildrenPort;
  emit?: ManifestEventSink;
  kernelPrincipal?: string;
  /** the kernel side of `kernel.call` (slice 2 wires the socket dispatcher); absent ⇒ ENGINE not-implemented */
  kernelCall?: (req: KernelCallRequest) => Promise<unknown>;
  platform?: string;
  callTimeoutMs?: number;
  cancelGraceMs?: number;
  now?: () => number;
}

/** Test seams only (kernel/testing.ts → internal-seams 'modhost'): never on ModHostOptions. */
export interface ModHostSeams {
  /** an unsandboxed launcher (tests on every OS); default = the `mod` profile registry */
  launcher?: (i: ModLaunchInput) => ChildLaunchPlan;
  /** the egress proxy's dialer (a local server standing in for the internet) */
  dial?: EgressDial;
}

export type ModStartResult =
  | { state: 'running'; name: string; packageHash: string; dev: boolean; effects: ToolEffect[]; sandbox: 'full' | 'none'; profileHash: string | null; egressPort: number | null }
  | { state: 'paused'; name: string; why: 'changed' | 'dev-expired'; cardId: string | null; files?: TreeDiff };

interface Running {
  name: string;
  child: ChildProcess;
  channel: ModChannel;
  manifest: ManifestV1;
  packageHash: string;
  dev: boolean;
  effects: Set<ToolEffect>;
  proxy: EgressProxy | null;
  state: ModState;
  sandbox: 'full' | 'none';
  profileHash: string | null;
  ctx: CallContext;
  stopping: boolean;
}

export interface RenderResult {
  label: string;
  dev: boolean;
  block: Record<string, unknown>;
  nodes: number;
  flags: string[];
}

export interface CallOptions {
  relayedFor?: RelayedFor;
  signal?: AbortSignal;
  timeoutMs?: number;
}

export class ModHost {
  readonly #o: ModHostOptions;
  readonly #emit: ManifestEventSink;
  readonly #running = new Map<string, Running>();
  readonly #paused = new Map<string, Extract<ModStartResult, { state: 'paused' }>>();
  readonly #queues = new Map<string, Promise<unknown>>();
  readonly #restarts = new Map<string, number[]>();
  readonly #stderr = new Map<string, string>();
  readonly #starting = new Map<string, Promise<ModStartResult>>();
  #closed = false;
  #seams: ModHostSeams = {};

  constructor(opts: ModHostOptions) {
    this.#o = opts;
    this.#emit = opts.emit ?? noEvents;
  }

  static {
    registerSeams('modhost', {
      create: (opts, seams) => {
        const h = new ModHost(opts);
        h.#seams = { ...seams };
        return h;
      },
    });
  }

  #now(): number {
    return this.#o.now?.() ?? Date.now();
  }

  #principal(name: string): string {
    return `p:${this.#o.trust.ns ?? '00000000'}/mod-${name}`;
  }

  /** Names of mods with a live child. */
  running(): string[] {
    return [...this.#running.keys()].sort();
  }

  /** Start (or return) the child for `name`. Paused mods return their pause; nothing from a changed tree loads. */
  start(name: string): Promise<ModStartResult> {
    const live = this.#running.get(name);
    if (live) return Promise.resolve(this.#runningResult(live));
    const inflight = this.#starting.get(name);
    if (inflight) return inflight;
    const p = this.#start(name).finally(() => this.#starting.delete(name));
    this.#starting.set(name, p);
    return p;
  }

  #runningResult(r: Running): ModStartResult {
    return { state: 'running', name: r.name, packageHash: r.packageHash, dev: r.dev, effects: [...r.effects].sort(), sandbox: r.sandbox, profileHash: r.profileHash, egressPort: r.proxy?.port ?? null };
  }

  async #start(name: string): Promise<ModStartResult> {
    if (this.#closed) throw new ModRefusal('NOT_RUNNING', 'the mod host is stopping', { name });
    const loaded = loadMod({ home: this.#o.home, name, trust: this.#o.trust, emit: this.#emit, ...(this.#o.kernelPrincipal ? { kernelPrincipal: this.#o.kernelPrincipal } : {}) });
    if (loaded.state === 'paused') {
      const p = { state: 'paused' as const, name, why: 'changed' as const, cardId: loaded.cardId, files: loaded.files };
      this.#paused.set(name, p);
      return p;
    }
    const grants = readGrants(this.#o.home, this.#o.trust);
    const row = effectiveInstall(grants, name)!;
    let dev = false;
    if (row.dev) {
      if (Date.parse(row.dev.until) > this.#now()) dev = true;
      else {
        this.#emit('mod.dev.expired', { name });
        const p = { state: 'paused' as const, name, why: 'dev-expired' as const, cardId: null };
        this.#paused.set(name, p);
        return p;
      }
    }
    this.#paused.delete(name);
    const m = loaded.manifest;
    let effects = declaredEffects(m);
    if (dev) effects = new Set([...effects].filter((e) => e === 'read'));
    const declaredHosts = Array.isArray(m.requires?.egress) ? m.requires.egress.map((e) => checkEgressHost(e.host)).filter((v) => v.ok).map((v) => v.host) : [];
    const granted = grants.egress.get(loaded.manifestHash) ?? new Set<string>();
    const hosts = new Set(declaredHosts.filter((h) => granted.has(h)));
    let proxy: EgressProxy | null = null;
    let running: Running | null = null;
    if (effects.has('network') && hosts.size > 0) {
      proxy = new EgressProxy({
        name,
        hosts,
        emit: this.#emit,
        ...(this.#seams.dial ? { dial: this.#seams.dial } : {}),
        allowNow: () => (running ? effectsFor(running.manifest, running.ctx, running.dev).has('network') : false),
      });
      await proxy.listen();
    }
    const entry = MOD_ENTRIES.map((e) => path.join(loaded.snapshotDir, e)).find((p) => fs.existsSync(p));
    try {
      if (!entry) throw new ModRefusal('UNDECLARED', `${name}'s snapshot has no ${MOD_ENTRIES.join(' / ')}`, { name });
      const sDir = stateDir(this.#o.home, name);
      const bDir = blobsDir(this.#o.home, name);
      for (const d of [sDir, bDir]) {
        // never `recursive` onto an existing path: a planted symlink must stay visible to the profile's real-dir check
        if (!fs.existsSync(d) && !isLink(d)) fs.mkdirSync(d, { mode: 0o700 });
      }
      const linked = row.source.startsWith('linked:') ? [row.source.slice(7)] : [];
      const input: ModLaunchInput = {
        home: this.#o.home,
        name,
        snapshotDir: loaded.snapshotDir,
        entry,
        stateDir: sDir,
        blobsDir: bDir,
        readPaths: loaded.readPaths,
        write: effects.has('write'),
        proxyPort: proxy?.port ?? null,
        denyRead: linked.filter((l) => fs.existsSync(l)),
        env: { GNOMON_MOD_NAME: name, ...(proxy ? { GNOMON_EGRESS_PROXY: `127.0.0.1:${proxy.port}` } : {}) },
      };
      let plan: ChildLaunchPlan;
      try {
        plan = this.#seams.launcher ? this.#seams.launcher(input) : modLaunchPlan(input, this.#o.platform);
      } catch (err) {
        if (isLifecycleRefusal(err)) {
          this.#emit('mod.health', { name, ok: false, why: 'sandbox-unavailable' });
          throw new ModRefusal('SANDBOX', err.message, { name, ...err.detail });
        }
        throw err;
      }
      this.#emit('mod.sandbox', { name, profile: 'mod', sandbox: plan.sandbox, profileHash: plan.profileHash });
      const child = spawn(plan.command, plan.args, { stdio: ['pipe', 'pipe', 'pipe'], env: plan.env, detached: true, windowsHide: true });
      child.on('error', () => undefined);
      const channel = new ModChannel(child, (method, params) => this.#onModRequest(name, method, params));
      try {
        await this.#o.children.track({ kind: 'mod', child, name });
      } catch (err) {
        // reviewer #1: never a live untracked child — kill it and refuse
        child.kill('SIGKILL');
        channel.close(new ModRefusal('CRASHED', 'the mod child was not tracked'));
        throw new ModRefusal('CRASHED', `${name} could not be tracked: ${(err as Error).message}`, { name });
      }
      if (this.#closed) {
        await this.#o.children.stop(child, 'shutdown');
        throw new ModRefusal('NOT_RUNNING', 'the mod host is stopping', { name });
      }
      running = { name, child, channel, manifest: m, packageHash: loaded.packageHash, dev, effects, proxy, state: new ModState(this.#o.home, name), sandbox: plan.sandbox, profileHash: plan.profileHash, ctx: { kind: 'idle' }, stopping: false };
      const r = running;
      this.#running.set(name, r);
      child.once('exit', (code, signal) => void this.#onExit(r, code, signal));
      let init: Record<string, unknown>;
      try {
        init = (await this.#withTimeout(r, r.channel.request('init', { abi: MOD_ABI_V1, features: ['cancel'] }), this.#o.callTimeoutMs ?? DEFAULT_CALL_TIMEOUT_MS, null)) as Record<string, unknown>;
      } catch (err) {
        await this.stop(name, 'init-failed');
        throw err instanceof ModRefusal ? err : new ModRefusal('ABI', `${name} did not answer init`, { name });
      }
      if (init?.abi !== MOD_ABI_V1 || init?.modAbiId !== MOD_ABI_ID) {
        await this.stop(name, 'abi-mismatch');
        throw new ModRefusal('ABI', `${name} answered abi ${String(init?.abi)} / modAbiId ${String(init?.modAbiId)}; the host speaks ${MOD_ABI_V1} ${MOD_ABI_ID}`, { name });
      }
      this.#emit('mod.health', { name, ok: true });
      return this.#runningResult(r);
    } catch (err) {
      if (!running) await proxy?.close();
      if (isLifecycleRefusal(err)) throw new ModRefusal('SANDBOX', err.message, { name });
      throw err;
    }
  }

  async #onExit(r: Running, code: number | null, signal: NodeJS.Signals | null): Promise<void> {
    this.#stderr.set(r.name, r.channel.stderrTail);
    if (this.#running.get(r.name) === r) this.#running.delete(r.name);
    await r.proxy?.close();
    if (r.stopping || this.#closed) return;
    this.#emit('mod.health', { name: r.name, ok: false, code, signal });
    const now = this.#now();
    const recent = (this.#restarts.get(r.name) ?? []).filter((t) => now - t < RESTART_CAP.windowMs);
    if (recent.length >= RESTART_CAP.n) {
      this.#restarts.set(r.name, recent);
      this.#emit('mod.health', { name: r.name, ok: false, why: 'restart-cap' });
      return; // out of restarts: down until started again
    }
    recent.push(now);
    this.#restarts.set(r.name, recent);
    await this.start(r.name).catch(() => undefined); // a failed restart (paused, sandbox, abi) is already logged
  }

  /** Restarts recorded in the current window (inspect / tests). */
  restarts(name: string): number {
    const now = this.#now();
    return (this.#restarts.get(name) ?? []).filter((t) => now - t < RESTART_CAP.windowMs).length;
  }

  /** `gnomon mod inspect` subset (§12.4): state, pin, dev, effects, sandbox, stderr tail. */
  inspect(name: string): Record<string, unknown> {
    const r = this.#running.get(name);
    const p = this.#paused.get(name);
    return {
      name,
      state: r ? 'running' : p ? 'paused' : 'stopped',
      ...(r ? { packageHash: r.packageHash, dev: r.dev, effects: [...r.effects].sort(), sandbox: r.sandbox, profileHash: r.profileHash, egressPort: r.proxy?.port ?? null } : {}),
      ...(p ? { paused: { why: p.why, cardId: p.cardId } } : {}),
      restarts: this.restarts(name),
      protocolErrors: r?.channel.protocolErrors ?? 0,
      stderrTail: r?.channel.stderrTail ?? this.#stderr.get(name) ?? '',
    };
  }

  async stop(name: string, reason = 'stopped'): Promise<void> {
    const r = this.#running.get(name);
    if (!r) return;
    r.stopping = true;
    this.#running.delete(name);
    let t: NodeJS.Timeout | undefined;
    await Promise.race([r.channel.request('shutdown', {}).catch(() => undefined), new Promise((res) => (t = setTimeout(res, 300)))]);
    clearTimeout(t);
    await this.#o.children.stop(r.child, reason);
    r.channel.close(new ModRefusal('NOT_RUNNING', `${name} stopped`, { name }));
    await r.proxy?.close();
  }

  async stopAll(reason = 'shutdown'): Promise<void> {
    this.#closed = true;
    await Promise.allSettled([...this.#starting.values()]); // reviewer #2: an in-flight start finishes (or refuses) before the sweep
    await Promise.all([...this.#running.keys()].map((n) => this.stop(n, reason)));
  }

  #require(name: string): Running {
    const r = this.#running.get(name);
    if (r) return r;
    if (this.#paused.has(name)) throw new ModRefusal('PAUSED', `${name} is paused until a card decides (§12.5)`, { name });
    throw new ModRefusal('NOT_RUNNING', `${name} is not running`, { name });
  }

  /** Serialize host → mod calls per mod: a mod → host request is judged by the call in force when it ARRIVES (call-id binding is slice 2). */
  #enqueue<T>(name: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.#queues.get(name) ?? Promise.resolve();
    const next = prev.then(fn, fn);
    this.#queues.set(name, next.catch(() => undefined));
    return next;
  }

  async #withTimeout(r: Running, p: Promise<unknown>, ms: number, cancelToken: string | null, signal?: AbortSignal): Promise<unknown> {
    let timer: NodeJS.Timeout | undefined;
    let onAbort: (() => void) | undefined;
    const expired = new Promise<'expired'>((res) => {
      timer = setTimeout(() => res('expired'), ms);
      if (signal) {
        onAbort = () => res('expired');
        if (signal.aborted) onAbort();
        else signal.addEventListener('abort', onAbort, { once: true });
      }
    });
    const settled = p.then(
      (v) => ({ ok: true as const, v }),
      (e: unknown) => ({ ok: false as const, e }),
    );
    const first = await Promise.race([settled, expired]);
    clearTimeout(timer);
    if (onAbort) signal?.removeEventListener('abort', onAbort);
    if (first !== 'expired') {
      if (first.ok) return first.v;
      throw first.e instanceof ModRpcError ? new ModRefusal('MOD_ERROR', `${r.name}: ${first.e.message}`, { name: r.name, rpcCode: first.e.error.code }) : first.e;
    }
    if (cancelToken) r.channel.notify('cancel', { cancelToken });
    let graceTimer: NodeJS.Timeout | undefined;
    const honoured = await Promise.race([settled.then(() => true), new Promise<boolean>((res) => (graceTimer = setTimeout(() => res(false), this.#o.cancelGraceMs ?? DEFAULT_CANCEL_GRACE_MS)))]);
    clearTimeout(graceTimer);
    if (!honoured && this.#running.get(r.name) === r) {
      // §12.3: cancel not honoured ⇒ the child is restarted
      r.stopping = true;
      this.#running.delete(r.name);
      this.#emit('mod.health', { name: r.name, ok: false, why: 'cancel-timeout' });
      await this.#o.children.stop(r.child, 'cancel-timeout');
      r.channel.close(new ModRefusal('TIMEOUT', 'restarted after an unhonoured cancel', { name: r.name }));
      await r.proxy?.close();
      const now = this.#now();
      const recent = (this.#restarts.get(r.name) ?? []).filter((t) => now - t < RESTART_CAP.windowMs);
      if (recent.length < RESTART_CAP.n) {
        recent.push(now);
        this.#restarts.set(r.name, recent);
        await this.start(r.name).catch(() => undefined);
      } else this.#emit('mod.health', { name: r.name, ok: false, why: 'restart-cap' });
    }
    throw new ModRefusal('TIMEOUT', `${r.name} did not answer within ${ms} ms${honoured ? '' : ' (cancel not honoured: restarted)'}`, { name: r.name, honoured });
  }

  async #call(name: string, method: string, params: Record<string, unknown>, ctx: CallContext, opts: CallOptions = {}): Promise<unknown> {
    return this.#enqueue(name, async () => {
      const r = this.#require(name);
      const cancelToken = method === 'view.render' || method === 'tool.call' ? randomUUID() : null;
      r.ctx = ctx;
      try {
        return await this.#withTimeout(r, r.channel.request(method, { ...params, ...(cancelToken ? { cancelToken } : {}) }), opts.timeoutMs ?? this.#o.callTimeoutMs ?? DEFAULT_CALL_TIMEOUT_MS, cancelToken, opts.signal);
      } finally {
        r.ctx = { kind: 'idle' };
        r.proxy?.closeTunnels(); // Aegis F2: a tunnel never outlives the call that opened it
      }
    });
  }

  async health(name: string): Promise<boolean> {
    try {
      const h = (await this.#call(name, 'health', {}, { kind: 'idle' })) as Record<string, unknown>;
      const ok = h?.ok === true && h?.abi === MOD_ABI_V1;
      this.#emit('mod.health', { name, ok });
      return ok;
    } catch {
      this.#emit('mod.health', { name, ok: false });
      return false;
    }
  }

  /** `view.render` (host-initiated: fixtures, previews). Clients go through relayView. */
  async render(name: string, viewId: string, input: unknown, opts: CallOptions & { width?: number; prefs?: { motion?: string; theme?: string } } = {}): Promise<RenderResult> {
    const r = this.#require(name);
    const view = r.manifest.provides?.views?.find((v) => v.id === viewId);
    if (!view) throw new ModRefusal('UNDECLARED', `${name} declares no view ${viewId}`, { name, viewId });
    const t0 = this.#now();
    const out = (await this.#call(name, 'view.render', { viewId, input: input ?? null, width: opts.width ?? 80, prefs: opts.prefs ?? {}, ...(opts.relayedFor ? { relayedFor: opts.relayedFor } : {}) }, { kind: 'view' }, opts)) as Record<string, unknown>;
    const s = sanitizeModBlock(out?.block, name);
    this.#emit('mod.view.rendered', { name, slot: view.slot, ms: this.#now() - t0 });
    return { label: `mod:${name}`, dev: r.dev, block: s.block, nodes: s.nodes, flags: s.flags };
  }

  /** The `mod.view` client relay: relayedFor is stamped from the caller's connection, never taken from input. */
  relayView(req: { name: string; viewId: string; input?: unknown; principal: string; connId: string; width?: number; prefs?: { motion?: string; theme?: string } }): Promise<RenderResult> {
    return this.render(req.name, req.viewId, req.input, { relayedFor: { principal: req.principal, connId: req.connId }, ...(req.width ? { width: req.width } : {}), ...(req.prefs ? { prefs: req.prefs } : {}) });
  }

  async runCommand(name: string, commandId: string, args: unknown, opts: CallOptions = {}): Promise<unknown> {
    const r = this.#require(name);
    if (!r.manifest.provides?.commands?.some((c) => c.id === commandId)) throw new ModRefusal('UNDECLARED', `${name} declares no command ${commandId}`, { name, commandId });
    const out = (await this.#call(name, 'command.run', { commandId, args: args ?? null, ...(opts.relayedFor ? { relayedFor: opts.relayedFor } : {}) }, { kind: 'command' }, opts)) as Record<string, unknown>;
    return out?.result ?? null;
  }

  /** The `mod.command` client relay (a GUI caller additionally needs a user gesture — the endpoint's rule, slice 2). */
  relayCommand(req: { name: string; commandId: string; args?: unknown; principal: string; connId: string }): Promise<unknown> {
    return this.runCommand(req.name, req.commandId, req.args, { relayedFor: { principal: req.principal, connId: req.connId } });
  }

  /** `tool.call` — effects in force = that tool's declared effects (∩ the dev cap). */
  async callTool(name: string, tool: string, input: unknown, opts: CallOptions & { hsid?: string } = {}): Promise<unknown> {
    const r = this.#require(name);
    if (!r.manifest.provides?.tools?.some((t) => t.name === tool)) throw new ModRefusal('UNDECLARED', `${name} declares no tool ${tool}`, { name, tool });
    const out = (await this.#call(name, 'tool.call', { name: tool, input: input ?? null }, { kind: 'tool', tool, ...(opts.hsid ? { hsid: opts.hsid } : {}) }, opts)) as Record<string, unknown>;
    return out?.result ?? null;
  }

  /** `event{event:v1}` — the filtered feed. Slice 1 forwards only the mod's own `modns.<name>.*` kinds (grant-bound kinds: slice 2). */
  sendEvent(name: string, event: { kind: string } & Record<string, unknown>): boolean {
    const r = this.#running.get(name);
    if (!r || typeof event?.kind !== 'string' || !event.kind.startsWith(`modns.${name}.`)) return false;
    r.channel.notify('event', { event });
    return true;
  }

  /** mod → host requests, under the effects of the call in force. */
  async #onModRequest(name: string, method: string, params: Record<string, unknown>): Promise<unknown> {
    const r = this.#running.get(name);
    if (!r) throw new ModRefusal('NOT_RUNNING', `${name} is not running`, { name });
    let effect: ToolEffect;
    try {
      effect = methodEffect(method, params);
      const allowed = effectsFor(r.manifest, r.ctx, r.dev);
      if (!allowed.has(effect)) throw new ModRefusal('EFFECT', `${name} called ${method}${method === 'kernel.call' ? ` ${String(params.verb)}` : ''} needing \`${effect}\` outside its effects in force [${[...allowed].sort().join(', ')}]${r.dev ? ' (dev mode: read only)' : ''}`, { name, method, effect });
      if (method === 'kernel.call') {
        const verb = String(params.verb);
        const vp = params.params && typeof params.params === 'object' && !Array.isArray(params.params) ? (params.params as Record<string, unknown>) : {};
        if (verb === 'log.append') {
          const kind = vp.kind;
          if (typeof kind !== 'string' || !kind.startsWith(`modns.${name}.`) || !r.manifest.provides?.events?.includes(kind)) throw new ModRefusal('VERB', `${name} may append only its own declared modns.${name}.* kinds`, { name, verb, kind: typeof kind === 'string' ? kind : null });
        }
        const hsid = r.ctx.kind === 'tool' ? r.ctx.hsid : undefined;
        if (verb === 'session.send') {
          // Aegis C1: the session is the CALLER's (context hsid), never one the mod names; the permit is the caller's, never the mod's
          if (!hsid) throw new ModRefusal('VERB', 'session.send through kernel.call needs the calling session (a tool call with its hsid)', { name, verb });
          if (vp.hsid !== undefined && vp.hsid !== hsid) throw new ModRefusal('VERB', 'session.send may target only the calling session', { name, verb });
          vp.hsid = hsid;
          delete vp.permitId;
        }
        if (!this.#o.kernelCall) throw new ModRefusal('NOT_IMPLEMENTED', 'kernel.call is not wired to the kernel yet (M1.11 slice 2)', { name, verb });
        return { result: await this.#o.kernelCall({ name, principal: this.#principal(name), verb, params: vp, ...(hsid ? { hsid } : {}) }) };
      }
    } catch (err) {
      if (err instanceof ModRefusal && (err.modCode === 'EFFECT' || err.modCode === 'APPROVE' || err.modCode === 'VERB')) {
        this.#emit('mod.effect.refused', { name, effect: err.detail.effect ?? (err.modCode === 'APPROVE' ? 'approve' : 'verb'), method, ...(method === 'kernel.call' ? { verb: String(params.verb) } : {}) });
      }
      throw err;
    }
    if (method === 'state.get') return { value: r.state.get(params.key) };
    r.state.set(params.key, params.value);
    return {};
  }
}
