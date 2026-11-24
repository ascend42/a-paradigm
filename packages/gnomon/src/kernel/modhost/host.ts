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
 * CALLS: host → mod calls are SERIALIZED per mod, and every `view.render`,
 * `command.run` and `tool.call` carries a host-minted `callId` (M1.11 slice
 * 2). A mod → host request is judged against the call it ECHOES: the
 * `callId` of the call in force ⇒ that call's effects; no `callId` ⇒ idle
 * (`read` only — narrows, never widens); any other `callId` (another call,
 * an ended call, a guess) ⇒ FORBIDDEN `CALL` + `mod.effect.refused{why:
 * 'call-id'}`. Each call
 * has a timeout; on expiry the host sends `cancel{cancelToken}` and, if the
 * call is not settled within the cancel grace, restarts the child (§12.3).
 * mod → host: `state.get` (read), `state.set` (write), `kernel.call` (by verb;
 * `approve` never; log.append only of the mod's own declared `modns.<name>.*`;
 * `session.send` only inside a tool call carrying the caller's hsid). A call
 * outside the effects in force ⇒ FORBIDDEN + `mod.effect.refused`. The egress
 * proxy refuses a tunnel opened while the call in force lacks `network`.
 * Rendered blocks pass the closed-kit gate (block.ts) and come back fenced and
 * labelled `mod:<name>` (+ `dev`); `mod.view.rendered{name, slot, ms}`.
 * RELAYS: `relayView` / `relayCommand` stamp `relayedFor` from the CALLER's
 * authenticated connection — a mod can never name who acted. Its fields are fixed
 * per method by the contracts `pickRelayedFor` (S1.2): {principal, connId} for a
 * view; plus `surface` for a command, and only for a human-class caller; a tool
 * call gets {surface, agent} and, for a first-party or `log.read` mod only,
 * {principal, hsid, turn}. The same object is stamped on every row the mod
 * appends inside the call (CallStamp → bridge.clampModAppend).
 * COMMAND ARGS (S1.3, Aegis A4): a command's `args` are HOST-COMPOSED
 * (#composeRelayedArgs). For every mod a client `repo`, `hsid`, `focus`,
 * `paradigm` or `gesture` key and any prototype key is removed, and the mod
 * receives a null-prototype object. A `gnomon`-published mod alone gets
 * `args.hsid` and `args.repo`, both or neither: the client's `focus.hsid`
 * when the caller may join it and `focusRepo` knows it as a live session, and
 * that session's repo scope. The same repo scope is stamped on the envelope of
 * every row appended inside the call (CallStamp.scope). A mod names neither.
 *
 * SUPERVISION: an unexpected exit ⇒ `mod.health{ok:false}` and a restart
 * (cap 3 per 10 min, then the mod stays down until started again); a crash
 * never reaches the kernel (G-MOD-03): every channel error is contained.
 *
 * FOLDER WATCH (G-MOD-08, slice 2): a RUNNING linked mod's source folder is
 * watched (`fs.watch` recursive — FSEvents on macOS, ReadDirectoryChangesW on
 * Windows — `.git/**` ignored, FOLDER_DEBOUNCE_MS = 500 ms). A change stops
 * the child (`mod.stopped{reason:'changed'}`) and re-runs the start, whose
 * loadMod full rehash pauses the mod (`mod.paused`) and stages the re-approve
 * card — nothing from the changed tree loads; a no-op change (the tree still
 * hashes to the pin) simply restarts from the same snapshot. The watcher is
 * closed when the mod stops, pauses or the host stops.
 *
 * DAEMON (slice 2): startDaemon constructs the host (bridge.ts wires
 * kernel.call to the real dispatcher and the relays into it), lists it in
 * `status.mods`, and stops every mod before the children sweep at every exit.
 *
 * USER PAUSE (slice 3, control.ts): a `<home>/mods/<name>/paused` marker
 * (`gnomon mod pause`) makes every start return paused{why:'user'}.
 *
 * FEED (slice 3, feed.ts): feed() forwards a fixed projection of kernel
 * kinds to running mods requiring log.read (the Workshop's only input). A
 * starting log.read mod is first primed with feedBacklog (the state in force:
 * live sessions, pending cards, paused mods), through the same projection.
 *
 * STILL NAMED, NOT BUILT: dev-mode cards/expiry scheduling/cwd exclusion and
 * the dev re-pin (`mod.repinned`), the `gnomon-mods` MCP bridge, Tier 0
 * templates, `/blob` serving.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import os from 'node:os';
import * as path from 'node:path';
import { isModId, MOD_ABI_ID, MOD_ABI_V1, pickRelayedFor, type RelayedFor, type ToolRelayedFor } from '@a-company/gnomon-contracts';
import { ownsModKind } from '../manifest/mod-kind.js';
import type { RowVerifier } from '../identity/registry.js';
import { registerSeams } from '../internal-seams.js';
import { isLifecycleRefusal } from '../lifecycle/refusal.js';
import type { TrackInput } from '../lifecycle/children.js';
import { effectiveInstall, readGrants } from '../manifest/grants.js';
import { compatModAbiId, loadMod, publisherDisplayOf } from '../manifest/install.js';
import { userMcpServerNames } from '../manifest/user-mcp.js';
import type { ManifestV2, ToolEffect } from '../manifest/manifest.js';
import { noEvents, type ManifestEventSink } from '../manifest/refusal.js';
import { checkEgressHost } from '../manifest/egress.js';
import type { TreeDiff } from '../manifest/snapshot.js';
import { modLaunchPlan, type ModLaunchInput } from '../sandbox/mod.js';
import type { ChildLaunchPlan } from '../sandbox/transport.js';
import { sanitizeModBlock } from './block.js';
import { RowFold } from './fold.js';
import { ModChannel, ModRpcError } from './channel.js';
import { declaredEffects, effectsFor, methodEffect, type CallContext, type CallStamp } from './effects.js';
import { EgressProxy, type EgressDial } from './egress-proxy.js';
import { ModRefusal } from './refusal.js';
import { blobsDir, ModState, stateDir } from './state.js';
import { isUserPaused, modNames } from './control.js';
import { feedAccessOf, feedReaches, projectFeedEvent } from './feed.js';
import { PARADIGM_SUMMARY_CAPABILITY, ParadigmSliceCache, unfocusedSlice } from './paradigm-slice.js';
import { gateRunningChild } from '../lifecycle/sea.js';

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
/** §12.5: a linked folder's change is acted on after this quiet period. */
export const FOLDER_DEBOUNCE_MS = 500;
/** mod → host requests one mod may have in flight in the host at once (all methods; beyond ⇒ BUSY). */
export const MAX_MOD_HOST_INFLIGHT = 8;
/** Relay misses (an uninstalled name): individual manifest.refuse rows per window before folding. */
export const RELAY_MISS_ROWS_PER_WINDOW = 8;
export const RELAY_MISS_WINDOW_MS = 10_000;
/** Aegis R2-1: mod.effect.refused rows per mod per window before folding. */
export const EFFECT_REFUSED_ROWS_PER_WINDOW = 8;
export const EFFECT_REFUSED_WINDOW_MS = 10_000;
/** Sessions whose streaming edge the feed remembers (oldest forgotten first; a forgotten one just gets a second edge). */
export const MAX_STREAMING_TRACKED = 4096;
/** S0b: a mod id <publisher>.<name>; the principal label is mod-<publisher>.<name>. */
const MOD_NAME = { test: (s: string): boolean => isModId(s) };
const FOCUS_HSID = /^[A-Za-z0-9:._-]{1,128}$/;
/** Relayed-input keys only the HOST composes (a client value is replaced or dropped, never forwarded). */
export const HOST_INPUT_KEYS: readonly string[] = Object.freeze(['focus', 'hsid', 'paradigm']);
/**
 * Relayed COMMAND arg keys only the host composes (S1.3, Aegis A4): removed from the client's args for EVERY mod.
 * `gesture` is the socket's gesture stamp (socket/gesture.ts); it is removed here as well, so no caller class and no
 * host-level call can hand one to a mod.
 */
export const HOST_ARG_KEYS: readonly string[] = Object.freeze(['repo', 'hsid', 'focus', 'paradigm', 'gesture']);
/** Keys never copied from a client object onto a host-composed one (an own `__proto__` key would become its prototype). */
const PROTOTYPE_KEYS: readonly string[] = Object.freeze(['__proto__', 'constructor', 'prototype']);
/** event:v1 `scope.repo` (`repo:<16 hex>`): the only form `focusRepo` may return and the host may pass on. Never a path. */
const REPO_SCOPE = /^repo:[0-9a-f]{16}$/;
const ownPlain = (v: unknown): Record<string, unknown> | null => (v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
const own = (o: Record<string, unknown>, k: string): unknown => (Object.hasOwn(o, k) ? o[k] : undefined);

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
  /** the bound host → mod call (absent ⇒ idle); the bridge's per-call append budget keys on it */
  callId?: string;
  /** S1.2 C1: the host's stamp of the bound command or tool call (absent ⇒ idle, view or host-initiated); never mod input */
  stamp?: CallStamp;
}

export interface ModHostOptions {
  home: string;
  trust: RowVerifier;
  children: ModChildrenPort;
  emit?: ManifestEventSink;
  kernelPrincipal?: string;
  /** the kernel side of `kernel.call` (slice 2 wires the socket dispatcher); absent ⇒ ENGINE not-implemented */
  kernelCall?: (req: KernelCallRequest) => Promise<unknown>;
  /** a host → mod call left force (its callId can no longer bind a request) — the bridge drops that call's budget */
  onCallEnd?: (name: string, callId: string) => void;
  /**
   * K3: the SERVER-SIDE join of a focused hsid to its LIVE session's cwd (daemon: supervisor.scopeOf); null when
   * the hsid is not a live session. Client input never names a repo or a path: only this join picks one.
   */
  focusCwd?: (hsid: string) => string | null;
  /**
   * Aegis M1: the session principal of a LIVE hsid (daemon: supervisor.principalOf), so an agent or session
   * caller is joined only to its OWN session. Absent ⇒ agent/session callers are never joined (unfocused).
   */
  focusPrincipal?: (hsid: string) => string | null;
  /**
   * S1.3 (Aegis A4): the repo scope (`repo:<16 hex>`, event:v1 scope.repo; never a path) of a LIVE hsid, or null
   * when the hsid is not a live session (daemon: supervisor.scopeOf → deskRepoScope). It is the ONLY liveness test
   * for a command's focus: absent, or returning anything but a repo scope, ⇒ no command is ever given `hsid` or `repo`.
   */
  focusRepo?: (hsid: string) => string | null;
  /**
   * The state in force when a log.read mod starts (feed.ts FeedBacklog; daemon: snapshot() of the ONE fold it feeds as
   * rows are released, O(state), no disk read). Replayed through the same projection as the live feed, to that mod
   * only, right after its init; the live feed reaches the mod only after it. Absent ⇒ a mod's feed starts empty and
   * flows from its spawn (tests).
   */
  feedBacklog?: () => Iterable<{ kind?: unknown; seq?: unknown; at?: unknown; payload?: unknown }>;
  /** the user home the K1 projector never walks into (tests); default os.homedir() */
  userHome?: string;
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
  | { state: 'running'; name: string; packageHash: string; dev: boolean; effects: ToolEffect[]; sandbox: 'full' | 'partial' | 'none'; profileHash: string | null; egressPort: number | null }
  | { state: 'paused'; name: string; why: 'changed' | 'dev-expired' | 'user'; cardId: string | null; files?: TreeDiff };

interface Running {
  name: string;
  child: ChildProcess;
  channel: ModChannel;
  manifest: ManifestV2;
  packageHash: string;
  /** Aegis S0b L1: the publisher display status.mods carries for the GUI */
  publisherDisplay: { host: string | null; verified: boolean };
  dev: boolean;
  effects: Set<ToolEffect>;
  proxy: EgressProxy | null;
  state: ModState;
  sandbox: 'full' | 'partial' | 'none';
  profileHash: string | null;
  ctx: CallContext;
  /** the callId of the host → mod call in force (null while idle) */
  callId: string | null;
  stopping: boolean;
  /**
   * Aegis L (2026-10-23): the live feed reaches this mod only once its backlog prime is done, so a row released during
   * init reaches it once, in order (inside the backlog, never also live before it). True at once without a backlog.
   */
  primed: boolean;
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
  /** Aegis M1: the relaying caller's §5 class (host-side only, never sent to the mod) */
  relayedClass?: string;
  signal?: AbortSignal;
  timeoutMs?: number;
}

/** Host-composed (never mod text): what a mod refused ABI at init is waiting for. */
export const NEEDS_UPDATE_NOTE = 'needs an update for this Gnomon';
const needsUpdateText = (name: string): string => `${name} ${NEEDS_UPDATE_NOTE}: it was built for another mod ABI. Update it in the Mods panel, or install its current build`;

export class ModHost {
  readonly #o: ModHostOptions;
  readonly #emit: ManifestEventSink;
  readonly #running = new Map<string, Running>();
  readonly #paused = new Map<string, Extract<ModStartResult, { state: 'paused' }>>();
  readonly #queues = new Map<string, Promise<unknown>>();
  readonly #restarts = new Map<string, number[]>();
  readonly #stderr = new Map<string, string>();
  readonly #starting = new Map<string, Promise<ModStartResult>>();
  readonly #watchers = new Map<string, { close(): void }>();
  /** mods out of restarts: refused DOWN to relays until an operator start() */
  readonly #down = new Set<string>();
  /**
   * Mods refused ABI at init: name → the package hash that was refused. STICKY and in memory: a relay never respawns
   * the child for that pin (so a view paint cannot loop it into the restart cap and its misleading DOWN text). An
   * operator start, or a different pin (the Update card decided), tries once more. Bounded by the installed mods.
   */
  readonly #needsUpdate = new Map<string, string>();
  readonly #inflight = new Map<string, number>();
  /** hsids whose turn.partial edge was already fed (bounded) */
  readonly #streaming = new Set<string>();
  #misses!: RowFold;
  readonly #refusedFolds = new Map<string, RowFold>();
  #closed = false;
  #seams: ModHostSeams = {};
  readonly #slices = new ParadigmSliceCache();

  constructor(opts: ModHostOptions) {
    this.#o = opts;
    this.#emit = opts.emit ?? noEvents;
    this.#misses = new RowFold({
      perWindow: RELAY_MISS_ROWS_PER_WINDOW,
      windowMs: RELAY_MISS_WINDOW_MS,
      now: () => this.#now(),
      write: (payload) => this.#emit('manifest.refuse', payload),
      base: { code: 'NOT_INSTALLED', via: 'relay' },
      field: 'byName',
    });
  }

  /** Aegis R2-1: one fold per mod for mod.effect.refused, keyed by {effect, why, verb}. */
  #refused(name: string, row: Record<string, unknown>): void {
    let f = this.#refusedFolds.get(name);
    if (!f) {
      f = new RowFold({
        perWindow: EFFECT_REFUSED_ROWS_PER_WINDOW,
        windowMs: EFFECT_REFUSED_WINDOW_MS,
        now: () => this.#now(),
        write: (payload) => this.#emit('mod.effect.refused', payload),
        base: { name },
        field: 'byKey',
      });
      this.#refusedFolds.set(name, f);
    }
    f.hit(`${String(row.effect)}|${String(row.why ?? '')}|${String(row.verb ?? '')}`, row);
  }

  /** Write every folded mod.effect.refused counter row now (also on the fold timers, at stop and stopAll). */
  flushRefused(name?: string): void {
    for (const [n, f] of this.#refusedFolds) if (!name || n === name) f.flush();
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

  /** `status.mods` (§12.3 "status reports all three" ids; the running and paused mods). */
  status(): Record<string, unknown> {
    return {
      modAbiId: MOD_ABI_ID,
      running: [...this.#running.values()].map((r) => ({ name: r.name, packageHash: r.packageHash, dev: r.dev, sandbox: r.sandbox })).sort((a, b) => a.name.localeCompare(b.name)),
      needsUpdate: this.needsUpdate(),
      paused: this.#pausedView(),
      // Aegis S0b L1: per running mod id, {host, verified}, so GUI panel headers and offer chips show the publisher
      publishers: Object.fromEntries([...this.#running.values()].map((r) => [r.name, r.publisherDisplay]).sort(([a], [b]) => String(a).localeCompare(String(b)))),
      // #gui mod panels: the declared views of RUNNING mods (manifest ids/slots only; the GUI maps slot → region)
      views: [...this.#running.values()]
        .filter((r) => !r.stopping)
        .flatMap((r) => (r.manifest.provides?.views ?? []).map((v) => ({ name: r.name, viewId: v.id, slot: v.slot, placement: v.placement ?? 'append', dev: r.dev })))
        .sort((a, b) => (a.name === b.name ? a.viewId.localeCompare(b.viewId) : a.name.localeCompare(b.name))),
    };
  }

  /**
   * Paused mods (Aegis C2): the in-memory pauses PLUS every `gnomon mod pause`
   * marker on disk, so a user pause is visible from the moment it is written
   * and across kernel restarts, whether or not the mod was ever started.
   */
  #pausedView(): Array<{ name: string; why: string; cardId: string | null }> {
    const out = new Map<string, { name: string; why: string; cardId: string | null }>();
    for (const p of this.#paused.values()) out.set(p.name, { name: p.name, why: p.why, cardId: p.cardId });
    for (const n of modNames(this.#o.home)) if (!out.has(n) && isUserPaused(this.#o.home, n)) out.set(n, { name: n, why: 'user', cardId: null });
    return [...out.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * Aegis C2 fail-closed: a pause marker written while the child runs refuses
   * every call NOW (the pickup's next scan only reaps the child); the stop is
   * started here too.
   */
  #userPausedLive(r: Running): boolean {
    if (r.stopping || !isUserPaused(this.#o.home, r.name)) return false;
    this.#emit('mod.paused', { name: r.name, reason: 'user', files: [] });
    void this.stop(r.name, 'paused').catch(() => undefined);
    return true;
  }

  /** Mods whose linked folder is being watched (tests / inspect). */
  watching(): string[] {
    return [...this.#watchers.keys()].sort();
  }

  #watch(name: string, folder: string): void {
    if (this.#watchers.has(name) || this.#closed) return;
    let timer: NodeJS.Timeout | undefined;
    try {
      const w = fs.watch(folder, { recursive: true, persistent: false }, (_e, file) => {
        const f = typeof file === 'string' ? file.split(path.sep).join('/') : '';
        if (f === '.git' || f.startsWith('.git/')) return; // never hashed (§12.5 S25-L4)
        clearTimeout(timer);
        timer = setTimeout(() => void this.#onFolderChanged(name), FOLDER_DEBOUNCE_MS);
        timer.unref();
      });
      w.on('error', () => undefined);
      this.#watchers.set(name, {
        close: () => {
          clearTimeout(timer);
          w.close();
        },
      });
    } catch {
      // no watch on this folder (removed, unreadable): the full rehash at every start still pauses a changed tree
      this.#emit('mod.health', { name, ok: true, why: 'watch-unavailable' });
    }
  }

  #unwatch(name: string): void {
    this.#watchers.get(name)?.close();
    this.#watchers.delete(name);
  }

  /** G-MOD-08: a watched folder changed — stop the child, then let loadMod's full rehash decide (pause + card, or the same pin). */
  async #onFolderChanged(name: string): Promise<void> {
    if (this.#closed || !this.#running.has(name)) return;
    await this.stop(name, 'changed');
    await this.#launch(name).catch(() => undefined); // a refused start is already logged
  }

  /** Start (or return) the child for `name` — the OPERATOR path: it also lifts a restart-cap `down`. Paused mods return their pause; nothing from a changed tree loads. */
  start(name: string): Promise<ModStartResult> {
    this.#down.delete(name);
    this.#needsUpdate.delete(name); // one fresh attempt per operator start
    if (this.#paused.get(name)?.why === 'user') this.#paused.delete(name); // re-judged from the marker
    return this.#launch(name);
  }

  /**
   * Relay admission (F1): a relay never makes the host do work for a name it
   * has no business starting. Running ⇒ go. Paused ⇒ PAUSED straight from
   * memory (no loadMod: only a card decision or a watcher event re-runs it).
   * Down (restart cap) ⇒ DOWN until an operator start(). Not installed ⇒
   * NOT_INSTALLED with a folded manifest.refuse row (≤ 8 per 10 s window,
   * the rest counted). A relay-triggered start counts against RESTART_CAP.
   */
  async admit(name: string): Promise<void> {
    if (typeof name !== 'string' || !MOD_NAME.test(name)) throw new ModRefusal('NOT_INSTALLED', 'malformed mod name', { reason: 'not-found' });
    const live = this.#running.get(name);
    if (live && this.#userPausedLive(live)) throw new ModRefusal('PAUSED', `${name} is paused (gnomon mod pause)`, { name, why: 'user' });
    if (live) return;
    const p = this.#paused.get(name);
    if (p) throw new ModRefusal('PAUSED', `${name} is paused until a card decides (§12.5)`, { name, why: p.why, cardId: p.cardId });
    const refusedPin = this.#needsUpdate.get(name);
    if (refusedPin !== undefined) {
      if (effectiveInstall(readGrants(this.#o.home, this.#o.trust), name)?.packageHash === refusedPin) throw new ModRefusal('ABI', needsUpdateText(name), { name, why: 'needs-update' });
      this.#needsUpdate.delete(name); // another pin now: one fresh attempt
    }
    if (this.#down.has(name) || this.restarts(name) >= RESTART_CAP.n) {
      this.#down.add(name);
      throw new ModRefusal('DOWN', `${name} is down (restart cap ${RESTART_CAP.n} per ${RESTART_CAP.windowMs / 60_000} min); an operator start brings it back`, { name });
    }
    if (!effectiveInstall(readGrants(this.#o.home, this.#o.trust), name)) {
      this.#relayMiss(name);
      throw new ModRefusal('NOT_INSTALLED', `${name} is not installed`, { name, reason: 'not-found' });
    }
    if (!this.#starting.has(name)) {
      const now = this.#now();
      const recent = (this.#restarts.get(name) ?? []).filter((t) => now - t < RESTART_CAP.windowMs);
      recent.push(now);
      this.#restarts.set(name, recent);
    }
    const s = await this.#launch(name);
    if (s.state === 'paused') throw new ModRefusal('PAUSED', `${name} is paused until a card decides (§12.5)`, { name, why: s.why, cardId: s.cardId });
  }

  #relayMiss(name: string): void {
    this.#misses.hit(name, { name, code: 'NOT_INSTALLED', via: 'relay' });
  }

  /** Write the folded relay-miss counter row now (also on its window timer and at stopAll). */
  flushRelayMisses(): void {
    this.#misses.flush();
  }

  /** Names refused ABI at init and waiting for an update (status, the Mods panel). */
  needsUpdate(): string[] {
    return [...this.#needsUpdate.keys()].sort();
  }

  /** Names a relay is refused DOWN for (inspect / tests). */
  down(): string[] {
    return [...this.#down].sort();
  }

  #launch(name: string): Promise<ModStartResult> {
    const live = this.#running.get(name);
    if (live) return Promise.resolve(this.#runningResult(live));
    const inflight = this.#starting.get(name);
    if (inflight) return inflight;
    const p = this.#start(name).finally(() => this.#starting.delete(name));
    this.#starting.set(name, p);
    return p;
  }

  /** TD-2026-10-22-769 (Aegis L1): the kernel's mod egress proxies' loopback ports (never a local model endpoint). */
  loopbackPorts(): number[] {
    return [...this.#running.values()].map((r) => r.proxy?.port).filter((p): p is number => typeof p === 'number' && p > 0);
  }

  #runningResult(r: Running): ModStartResult {
    return { state: 'running', name: r.name, packageHash: r.packageHash, dev: r.dev, effects: [...r.effects].sort(), sandbox: r.sandbox, profileHash: r.profileHash, egressPort: r.proxy?.port ?? null };
  }

  async #start(name: string): Promise<ModStartResult> {
    if (this.#closed) throw new ModRefusal('NOT_RUNNING', 'the mod host is stopping', { name });
    if (MOD_NAME.test(name) && isUserPaused(this.#o.home, name)) {
      // `gnomon mod pause` (control.ts): nothing loads until `gnomon mod start`
      this.#unwatch(name);
      const p = { state: 'paused' as const, name, why: 'user' as const, cardId: null };
      this.#paused.set(name, p);
      return p;
    }
    const loaded = loadMod({ home: this.#o.home, name, trust: this.#o.trust, emit: this.#emit, userMcpServers: userMcpServerNames({ userHome: this.#o.userHome ?? os.homedir() }), ...(this.#o.kernelPrincipal ? { kernelPrincipal: this.#o.kernelPrincipal } : {}) });
    if (loaded.state === 'paused') {
      this.#unwatch(name);
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
        this.#unwatch(name);
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
      void gateRunningChild(child); // Aegis S1 M2: no mod RPC is read until the RUNNING child meets gnomon.node's pin
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
      running = { name, child, channel, manifest: m, packageHash: loaded.packageHash, publisherDisplay: publisherDisplayOf(m.publisher, loaded.source), dev, effects, proxy, state: new ModState(this.#o.home, name), sandbox: plan.sandbox, profileHash: plan.profileHash, ctx: { kind: 'idle' }, callId: null, stopping: false, primed: !this.#o.feedBacklog };
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
      // G-MOD-15: an installed first-party snapshot at an exactly listed superseded pin may answer with the ONE prior
      // id listed for it. Nothing is granted or re-tiered; the grant and the snapshot rehash stood in loadMod above.
      const prior = compatModAbiId(loaded, MOD_ABI_ID);
      const compat = init?.abi === MOD_ABI_V1 && prior !== null && init?.modAbiId === prior;
      if (init?.abi !== MOD_ABI_V1 || (init?.modAbiId !== MOD_ABI_ID && !compat)) {
        await this.stop(name, 'abi-mismatch');
        this.#needsUpdate.set(name, loaded.packageHash);
        // the echoes are MOD-SUPPLIED and this text reaches the GUI: shown only when they have the expected shape, clipped
        const shown = (v: unknown, re: RegExp): string => (typeof v === 'string' && v.length <= 80 && re.test(v) ? v : 'a malformed value');
        throw new ModRefusal('ABI', `${name} answered abi ${shown(init?.abi, /^mod-abi:v[0-9]{1,4}$/)} / modAbiId ${shown(init?.modAbiId, /^sha256:[0-9a-f]{64}$/)}; the host speaks ${MOD_ABI_V1} ${MOD_ABI_ID}`, { name });
      }
      // one row saying so (an existing key of mod.health; no contract id moves)
      if (compat) this.#emit('mod.health', { name, ok: true, why: 'abi-compat' });
      this.#primeFeed(r);
      this.#emit('mod.health', { name, ok: true });
      if (linked.length) this.#watch(name, linked[0]!); // re-armed on every successful start
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
    if (!this.#running.has(r.name)) this.#unwatch(r.name); // I1: a successful restart re-arms it
    await r.proxy?.close();
    if (r.stopping || this.#closed) return;
    this.#emit('mod.health', { name: r.name, ok: false, code, signal });
    const now = this.#now();
    const recent = (this.#restarts.get(r.name) ?? []).filter((t) => now - t < RESTART_CAP.windowMs);
    if (recent.length >= RESTART_CAP.n) {
      this.#restarts.set(r.name, recent);
      this.#down.add(r.name);
      this.#unwatch(r.name);
      this.#emit('mod.health', { name: r.name, ok: false, why: 'restart-cap' });
      return; // out of restarts: down until an operator starts it
    }
    recent.push(now);
    this.#restarts.set(r.name, recent);
    await this.#launch(r.name).catch(() => undefined); // a failed restart (paused, sandbox, abi) is already logged
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
      droppedNotifications: r?.channel.droppedNotifications ?? 0,
      stderrTail: r?.channel.stderrTail ?? this.#stderr.get(name) ?? '',
    };
  }

  async stop(name: string, reason = 'stopped'): Promise<void> {
    this.#unwatch(name);
    this.flushRefused(name);
    const r = this.#running.get(name);
    if (!r) return;
    r.stopping = true;
    this.#running.delete(name);
    if (reason === 'paused') this.#paused.set(name, { state: 'paused', name, why: 'user', cardId: null });
    let t: NodeJS.Timeout | undefined;
    await Promise.race([r.channel.request('shutdown', {}).catch(() => undefined), new Promise((res) => (t = setTimeout(res, 300)))]);
    clearTimeout(t);
    await this.#o.children.stop(r.child, reason);
    r.channel.close(new ModRefusal('NOT_RUNNING', `${name} stopped`, { name }));
    await r.proxy?.close();
  }

  async stopAll(reason = 'shutdown'): Promise<void> {
    this.#closed = true;
    for (const n of [...this.#watchers.keys()]) this.#unwatch(n);
    this.#misses.flush();
    this.flushRefused();
    await Promise.allSettled([...this.#starting.values()]); // reviewer #2: an in-flight start finishes (or refuses) before the sweep
    await Promise.all([...this.#running.keys()].map((n) => this.stop(n, reason)));
  }

  #require(name: string): Running {
    const r = this.#running.get(name);
    if (r && this.#userPausedLive(r)) throw new ModRefusal('PAUSED', `${name} is paused (gnomon mod pause)`, { name, why: 'user' });
    if (r) return r;
    if (this.#paused.has(name)) throw new ModRefusal('PAUSED', `${name} is paused until a card decides (§12.5)`, { name });
    throw new ModRefusal('NOT_RUNNING', `${name} is not running`, { name });
  }

  /** Serialize host → mod calls per mod: one call (one callId) is in force at a time. */
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
      this.#unwatch(r.name);
      this.#emit('mod.health', { name: r.name, ok: false, why: 'cancel-timeout' });
      await this.#o.children.stop(r.child, 'cancel-timeout');
      r.channel.close(new ModRefusal('TIMEOUT', 'restarted after an unhonoured cancel', { name: r.name }));
      await r.proxy?.close();
      const now = this.#now();
      const recent = (this.#restarts.get(r.name) ?? []).filter((t) => now - t < RESTART_CAP.windowMs);
      if (recent.length < RESTART_CAP.n) {
        recent.push(now);
        this.#restarts.set(r.name, recent);
        await this.#launch(r.name).catch(() => undefined);
      } else {
        this.#down.add(r.name);
        this.#emit('mod.health', { name: r.name, ok: false, why: 'restart-cap' });
      }
    }
    throw new ModRefusal('TIMEOUT', `${r.name} did not answer within ${ms} ms${honoured ? '' : ' (cancel not honoured: restarted)'}`, { name: r.name, honoured });
  }

  async #call(name: string, method: string, params: Record<string, unknown>, ctx: CallContext, opts: CallOptions = {}): Promise<unknown> {
    return this.#enqueue(name, async () => {
      const r = this.#require(name);
      const cancelToken = method === 'view.render' || method === 'tool.call' ? randomUUID() : null;
      const callId = method === 'view.render' || method === 'tool.call' || method === 'command.run' ? randomUUID() : null;
      r.ctx = ctx;
      r.callId = callId;
      try {
        return await this.#withTimeout(r, r.channel.request(method, { ...params, ...(cancelToken ? { cancelToken } : {}), ...(callId ? { callId } : {}) }), opts.timeoutMs ?? this.#o.callTimeoutMs ?? DEFAULT_CALL_TIMEOUT_MS, cancelToken, opts.signal);
      } finally {
        r.ctx = { kind: 'idle' };
        r.callId = null;
        if (callId) this.#o.onCallEnd?.(name, callId);
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
    if (opts.relayedFor) input = this.#composeRelayedInput(r, input, opts.relayedFor, opts.relayedClass ?? null);
    // C2 (G-MOD-13): exactly the view.render fields, whatever the caller object holds
    const rf = opts.relayedFor ? pickRelayedFor('view.render', opts.relayedFor as unknown as Record<string, unknown>, false) : null;
    const out = (await this.#call(name, 'view.render', { viewId, input: input ?? null, width: opts.width ?? 80, prefs: opts.prefs ?? {}, ...(rf ? { relayedFor: rf } : {}) }, { kind: 'view' }, opts)) as Record<string, unknown>;
    const s = sanitizeModBlock(out?.block, name);
    this.#emit('mod.view.rendered', { name, slot: view.slot, ms: this.#now() - t0 });
    return { label: `mod:${name}`, dev: r.dev, block: s.block, nodes: s.nodes, flags: s.flags };
  }

  /**
   * K3 (#paradigm-context-mod): a RELAYED render's input is host-composed. The client may only name the focused
   * session (`{focus:{hsid}}`, or the K0 `{hsid}`); the host keeps that hsid as display context and, for a mod
   * granted paradigm.read:summary, JOINS it server-side to the live session's cwd (focusCwd) and attaches the K1
   * `paradigm` slice. A client `paradigm`, `repo`, `path` or any other key never picks the repo: the slice mod's
   * input is exactly {hsid?, paradigm}; every other mod gets the client's non-host keys plus {hsid?}.
   */
  #composeRelayedInput(r: Running, input: unknown, rf: RelayedFor, cls: string | null): Record<string, unknown> {
    const client = input && typeof input === 'object' && !Array.isArray(input) ? (input as Record<string, unknown>) : {};
    const focus = client.focus && typeof client.focus === 'object' && !Array.isArray(client.focus) ? (client.focus as Record<string, unknown>).hsid : client.hsid;
    const hsid = typeof focus === 'string' && FOCUS_HSID.test(focus) ? focus : null;
    if ((r.manifest.requires?.capabilities ?? []).includes(PARADIGM_SUMMARY_CAPABILITY)) {
      let cwd: string | null = null;
      try {
        cwd = hsid && this.#mayJoin(rf, cls, hsid) ? (this.#o.focusCwd?.(hsid) ?? null) : null;
      } catch {
        cwd = null;
      }
      const paradigm = cwd ? this.#slices.get(cwd, this.#now(), this.#o.userHome ? { home: this.#o.userHome } : {}) : unfocusedSlice();
      return { ...(hsid && cwd ? { hsid } : {}), paradigm };
    }
    // Aegis S1.3 A4: composed onto a null-prototype object and prototype keys dropped. Copied onto `{}`, a client's
    // own `__proto__` key (JSON.parse makes one) became the prototype, and host reads of the result saw client values.
    const out: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    for (const k of Object.keys(client)) if (!HOST_INPUT_KEYS.includes(k) && !PROTOTYPE_KEYS.includes(k)) out[k] = client[k];
    if (hsid) out.hsid = hsid;
    return out;
  }

  /**
   * S1.3 (Aegis A4): a command's args are host-composed, for EVERY mod and every caller (a host-initiated
   * runCommand included). The client's own keys are copied onto a null-prototype object, minus HOST_ARG_KEYS
   * (`repo`, `hsid`, `focus`, `paradigm`, `gesture`) and the prototype keys: none of those ever reaches a mod from
   * a client. Args that are not a plain object compose to an empty one.
   *
   * `hsid` and `repo` are then SET by the host, both or neither, and only for a `gnomon`-published mod: the client
   * may name `focus: {hsid}`; the caller must be entitled to join it (#mayJoin: a human any session, an agent or
   * session principal only its own) AND `focusRepo` must know it as a LIVE session and return its repo scope
   * (`repo:<16 hex>`). A human naming a string that is no live session gets neither. A third-party mod gets
   * neither whatever the client names: `hsid` is identity (S1.2 C2) and a repo scope is not its to learn.
   * Returns the composed args and, when a focus was joined, the scope the call's rows are stamped with.
   */
  #composeRelayedArgs(r: Running, args: unknown, rf: Record<string, string> | null, cls: string | null): { args: Record<string, unknown>; scope: { repo: string } | null } {
    const client = ownPlain(args) ?? {};
    const out: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    for (const k of Object.keys(client)) if (!HOST_ARG_KEYS.includes(k) && !PROTOTYPE_KEYS.includes(k)) out[k] = client[k];
    if (r.manifest.publisher !== 'gnomon' || !rf || typeof rf.principal !== 'string') return { args: out, scope: null };
    const focus = ownPlain(own(client, 'focus'));
    const named = focus ? own(focus, 'hsid') : undefined;
    const hsid = typeof named === 'string' && FOCUS_HSID.test(named) ? named : null;
    if (!hsid) return { args: out, scope: null };
    let repo: string | null = null;
    try {
      const got = this.#mayJoin({ principal: rf.principal, connId: rf.connId ?? '' }, cls, hsid) ? (this.#o.focusRepo?.(hsid) ?? null) : null;
      repo = typeof got === 'string' && REPO_SCOPE.test(got) ? got : null;
    } catch {
      repo = null;
    }
    if (!repo) return { args: out, scope: null };
    out.hsid = hsid;
    out.repo = repo;
    return { args: out, scope: { repo } };
  }

  /**
   * Aegis M1: who may have a focus JOINED to a repo. The human class: any live hsid (the GUI's focus). An agent
   * or session principal: only its OWN session's hsid (the live session's principal is the caller). Every other
   * class that reaches mod.view (voice, mod; peers and read tokens are refused by the §5 matrix first) and an
   * unknown class: never (unfocused).
   */
  #mayJoin(rf: RelayedFor, cls: string | null, hsid: string): boolean {
    if (cls === 'human') return true;
    if (cls === 'agent' || cls === 'session') {
      const owner = this.#o.focusPrincipal?.(hsid) ?? null;
      return typeof owner === 'string' && owner.length > 0 && owner === rf.principal;
    }
    return false;
  }

  /** The `mod.view` client relay: relayedFor is stamped from the caller's connection, never taken from input. */
  relayView(req: { name: string; viewId: string; input?: unknown; principal: string; connId: string; principalClass: string; width?: number; prefs?: { motion?: string; theme?: string } }): Promise<RenderResult> {
    // the class stays host-side: the mod's relayedFor is exactly {principal, connId} (MOD_ABI relayedFor fields)
    return this.render(req.name, req.viewId, req.input, { relayedFor: { principal: req.principal, connId: req.connId }, relayedClass: req.principalClass, ...(req.width ? { width: req.width } : {}), ...(req.prefs ? { prefs: req.prefs } : {}) });
  }

  async runCommand(name: string, commandId: string, args: unknown, opts: CallOptions = {}): Promise<unknown> {
    const r = this.#require(name);
    if (!r.manifest.provides?.commands?.some((c) => c.id === commandId)) throw new ModRefusal('UNDECLARED', `${name} declares no command ${commandId}`, { name, commandId });
    // C1/C2: one pickRelayedFor output is both what the mod is sent and what its rows are stamped with
    const rf = opts.relayedFor ? pickRelayedFor('command.run', opts.relayedFor as unknown as Record<string, unknown>, false) : null;
    // S1.3 A4: the args are host-composed for every mod; a joined focus also scopes the rows of this call
    const composed = this.#composeRelayedArgs(r, args, rf, opts.relayedClass ?? null);
    const stamp: CallStamp | null = rf ? { relayedFor: rf, ...(composed.scope ? { scope: composed.scope } : {}) } : null;
    const out = (await this.#call(name, 'command.run', { commandId, args: composed.args, ...(rf ? { relayedFor: rf } : {}) }, { kind: 'command', ...(stamp ? { stamp } : {}) }, opts)) as Record<string, unknown>;
    return out?.result ?? null;
  }

  /** The `mod.command` client relay (a GUI caller additionally carries a gesture stamp: the socket's rule, socket/gesture.ts). */
  relayCommand(req: { name: string; commandId: string; args?: unknown; principal: string; connId: string; surface?: 'gui' | 'cli'; principalClass?: string }): Promise<unknown> {
    // A1: no surface (a non-human caller) stays absent; the row then folds as the unknown hand.
    // The class stays host-side (Aegis M1): it only decides whose focus may be joined, and is never sent to the mod.
    return this.runCommand(req.name, req.commandId, req.args, { relayedFor: { principal: req.principal, connId: req.connId, ...(req.surface ? { surface: req.surface } : {}) }, ...(req.principalClass ? { relayedClass: req.principalClass } : {}) });
  }

  /** `tool.call` — effects in force = that tool's declared effects (∩ the dev cap). */
  /**
   * C2 / A3: may this mod learn which session, principal and turn called it? Only a `gnomon`-published mod (the
   * loader enforces publisher gnomon ⇔ first-party tier, both ways) or one granted `log.read`. Anything else gets
   * neither `principal`, `hsid` nor `turn` on a tool call, and no `causes` on its rows (a turn ref holds the session
   * id). Its rows then carry no principal and a dimension fold reads them as the unknown hand.
   */
  #identityAllowed(r: Running): boolean {
    return r.manifest.publisher === 'gnomon' || feedAccessOf(r.manifest.requires?.capabilities).base;
  }

  /**
   * `toolRelayedFor` is the full HOST-KNOWN value of the calling session (the bridge supplies it from S1.4); it is
   * never read from tool input. A value without a principal, a tool surface and an agent label is not sent and not
   * stamped: rows the mod appends in that call then fold as the unknown hand, never as a human or a named agent.
   */
  async callTool(name: string, tool: string, input: unknown, opts: CallOptions & { hsid?: string; toolRelayedFor?: ToolRelayedFor } = {}): Promise<unknown> {
    const r = this.#require(name);
    if (!r.manifest.provides?.tools?.some((t) => t.name === tool)) throw new ModRefusal('UNDECLARED', `${name} declares no tool ${tool}`, { name, tool });
    const identity = this.#identityAllowed(r);
    // fail closed: the HOST-KNOWN value must be whole (principal, a tool surface, an agent label) or it vouches for nobody
    const whole = opts.toolRelayedFor ? pickRelayedFor('tool.call', opts.toolRelayedFor as unknown as Record<string, unknown>, true) : null;
    const complete = !!whole && !!whole.principal && !!whole.surface && !!whole.agent;
    // A3: an unentitled mod is told the surface and the agent label only; the session principal is identity
    const rf = complete ? pickRelayedFor('tool.call', whole, identity) : null;
    const stamp: CallStamp | null = rf ? { relayedFor: rf, ...(identity && rf.turn ? { causes: [rf.turn] } : {}) } : null;
    const out = (await this.#call(name, 'tool.call', { name: tool, input: input ?? null, ...(rf ? { relayedFor: rf } : {}) }, { kind: 'tool', tool, ...(opts.hsid ? { hsid: opts.hsid } : {}), ...(stamp ? { stamp } : {}) }, opts)) as Record<string, unknown>;
    return out?.result ?? null;
  }

  /** `event{event:v1}` — the filtered feed. Slice 1 forwards only the mod's own `modns.<name>.*` kinds (grant-bound kinds: slice 2). */
  sendEvent(name: string, event: { kind: string } & Record<string, unknown>): boolean {
    const r = this.#running.get(name);
    if (!r || typeof event?.kind !== 'string' || !ownsModKind(name, event.kind)) return false;
    r.channel.notify('event', { event });
    return true;
  }

  /**
   * The kernel-event feed (feed.ts, slice 3): every running mod whose
   * manifest requires `log.read` (granted at load) gets the PROJECTION of the
   * fixed feed kinds; nothing else. Returns how many mods it reached.
   */
  feed(event: { kind?: unknown; seq?: unknown; at?: unknown; payload?: unknown }): number {
    // Aegis M1: two projections — v1 (log.read) and v1 + the usage rows/fields (log.read:usage)
    const projected = projectFeedEvent(event, { usage: true });
    if (!projected) return 0;
    const base = projectFeedEvent(event);
    // review: turn.partial is coalesced to ONE edge per hsid (streaming started); turn.result / session.exited end it
    const hsid = typeof projected.payload.hsid === 'string' ? projected.payload.hsid : null;
    if (hsid && projected.kind === 'turn.partial') {
      if (this.#streaming.has(hsid)) return 0;
      if (this.#streaming.size >= MAX_STREAMING_TRACKED) this.#streaming.delete(this.#streaming.values().next().value!);
      this.#streaming.add(hsid);
    } else if (hsid && (projected.kind === 'turn.result' || projected.kind === 'session.exited')) this.#streaming.delete(hsid);
    let n = 0;
    for (const r of this.#running.values()) {
      if (r.stopping || !r.primed) continue;
      const access = feedAccessOf(r.manifest.requires?.capabilities);
      if (!feedReaches(access, projected.kind)) continue;
      const ev = access.usage ? projected : base;
      if (ev && r.channel.notify('event', { event: ev })) n++;
    }
    return n;
  }

  /**
   * A log.read mod's feed starts from the state in force (founder report 2026-10-23, "working 0 of 0" beside "1 live"):
   * the backlog rows, projected exactly as feed() projects them, to this mod only. feed() skips the mod until this is
   * done (Running.primed), so a row released during init arrives once, inside the backlog, in fold order.
   */
  #primeFeed(r: Running): void {
    // Aegis L: a runner stopped (or replaced) while it initialised is never primed, and never fed
    if (r.stopping || this.#closed || this.#running.get(r.name) !== r) return;
    try {
      const access = feedAccessOf(r.manifest.requires?.capabilities);
      if ((!access.base && !access.usage) || !this.#o.feedBacklog) return;
      for (const e of this.#o.feedBacklog()) {
        const ev = projectFeedEvent(e, { usage: access.usage });
        if (ev && feedReaches(access, ev.kind)) r.channel.notify('event', { event: ev });
      }
    } catch {
      /* an unreadable backlog primes nothing: the live feed still flows */
    } finally {
      r.primed = true; // the live feed carries on from the fold's head (feed() skipped it until now)
    }
  }

  /** The call a mod → host request is bound to: its echoed callId must name the call in force; none ⇒ idle. */
  #boundContext(r: Running, method: string, params: Record<string, unknown>): CallContext {
    const cid = params.callId;
    if (cid === undefined) return { kind: 'idle' };
    if (typeof cid === 'string' && r.callId !== null && cid === r.callId) return r.ctx;
    throw new ModRefusal('CALL', `${r.name} sent ${method} for a call that is not in force (callId mismatch)`, { name: r.name, method, why: 'call-id' });
  }

  /** mod → host requests, under the effects of the call they are bound to (its echoed callId). */
  async #onModRequest(name: string, method: string, params: Record<string, unknown>): Promise<unknown> {
    const r = this.#running.get(name);
    if (!r) throw new ModRefusal('NOT_RUNNING', `${name} is not running`, { name });
    const n = this.#inflight.get(name) ?? 0;
    if (n >= MAX_MOD_HOST_INFLIGHT) throw new ModRefusal('BUSY', `${name} has ${MAX_MOD_HOST_INFLIGHT} mod → host requests in the host already`, { name });
    this.#inflight.set(name, n + 1);
    try {
      return await this.#serveModRequest(r, name, method, params);
    } finally {
      const left = (this.#inflight.get(name) ?? 1) - 1;
      if (left > 0) this.#inflight.set(name, left);
      else this.#inflight.delete(name);
    }
  }

  async #serveModRequest(r: Running, name: string, method: string, params: Record<string, unknown>): Promise<unknown> {
    let effect: ToolEffect;
    let ctx: CallContext = { kind: 'idle' };
    try {
      ctx = this.#boundContext(r, method, params);
      effect = methodEffect(method, params);
      const allowed = effectsFor(r.manifest, ctx, r.dev);
      if (!allowed.has(effect)) throw new ModRefusal('EFFECT', `${name} called ${method}${method === 'kernel.call' ? ` ${String(params.verb)}` : ''} needing \`${effect}\` outside its effects in force [${[...allowed].sort().join(', ')}]${r.dev ? ' (dev mode: read only)' : ''}`, { name, method, effect });
      if (method === 'kernel.call') {
        const verb = String(params.verb);
        const vp = params.params && typeof params.params === 'object' && !Array.isArray(params.params) ? (params.params as Record<string, unknown>) : {};
        if (verb === 'log.append') {
          const kind = vp.kind;
          if (typeof kind !== 'string' || !ownsModKind(name, kind) || !r.manifest.provides?.events?.includes(kind)) throw new ModRefusal('VERB', `${name} may append only its own declared modns.${name}.* kinds`, { name, verb, kind: typeof kind === 'string' ? kind : null });
        }
        const hsid = ctx.kind === 'tool' ? ctx.hsid : undefined;
        if (verb === 'session.send') {
          // Aegis C1: the session is the CALLER's (context hsid), never one the mod names; the permit is the caller's, never the mod's
          if (!hsid) throw new ModRefusal('VERB', 'session.send through kernel.call needs the calling session (a tool call with its hsid)', { name, verb });
          if (vp.hsid !== undefined && vp.hsid !== hsid) throw new ModRefusal('VERB', 'session.send may target only the calling session', { name, verb });
          vp.hsid = hsid;
          delete vp.permitId;
        }
        if (!this.#o.kernelCall) throw new ModRefusal('NOT_IMPLEMENTED', 'kernel.call is not wired to the kernel yet (M1.11 slice 2)', { name, verb });
        const callId = typeof params.callId === 'string' ? params.callId : undefined;
        const stamp = (ctx.kind === 'command' || ctx.kind === 'tool') && ctx.stamp ? ctx.stamp : undefined;
        return { result: await this.#o.kernelCall({ name, principal: this.#principal(name), verb, params: vp, ...(hsid ? { hsid } : {}), ...(callId ? { callId } : {}), ...(stamp ? { stamp } : {}) }) };
      }
    } catch (err) {
      if (err instanceof ModRefusal && (err.modCode === 'EFFECT' || err.modCode === 'APPROVE' || err.modCode === 'VERB' || err.modCode === 'CALL')) {
        // R2-1: folded per mod; the verb is mod-supplied, so it is clipped
        this.#refused(name, { name, effect: err.detail.effect ?? (err.modCode === 'APPROVE' ? 'approve' : err.modCode === 'CALL' ? 'call-id' : 'verb'), method: String(method).slice(0, 64), ...(err.modCode === 'CALL' ? { why: 'call-id' } : {}), ...(method === 'kernel.call' ? { verb: String(params.verb).slice(0, 64) } : {}) });
      }
      throw err;
    }
    if (method === 'state.get') return { value: r.state.get(params.key) };
    r.state.set(params.key, params.value);
    return {};
  }
}
