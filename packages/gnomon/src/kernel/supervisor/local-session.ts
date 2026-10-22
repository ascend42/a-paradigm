/**
 * @symbol #local-runner
 * @symbol #supervisor
 * @symbol ^subscription-only
 *
 * #supervisor's LOCAL path (spec §3.3, §6.1, §13; M1.8 slice 1): attended,
 * human-started sessions whose declared model is `local` or `any`. The
 * supervisor hands it every open with model local|any or backend local; it
 * owns the local sessions' send/stop/exit.
 *
 * open(): validate the lane (G-SUB-06: an endpoint outside loopback/LAN or a
 *   non-local compat ⇒ BILLING_REFUSED for every local open) → probe the
 *   endpoint (cached; model.probe + model.capabilities rows) → route (§13.3):
 *     any + incapable ⇒ session.routed{chosen:'claude'} and the supervisor's
 *       Claude path (null is returned);
 *     local + incapable ⇒ a `fallback` card through the M1.6 broker (task,
 *       reason, the estimate) + model.fallback.requested, and
 *       MODEL_UNAVAILABLE{cardId} to the caller — NO spawn (G-LCL-02). The
 *       card's `fallback-cloud` decision (fresh presence) opens a Claude
 *       session for the same requester (G-LCL-03); never automatic (D21, S7);
 *     capable ⇒ mint hsid → session.open{backend:'local'} → session.routed →
 *       permit.reserve{session.spawn, backend:'local', model, scope{user,
 *       session, repo}} (P8-D92: always granted, recorded with model and
 *       project — G-LAW-01c / G-LCL-04 as a METER, never a cap) →
 *       assertLocalPermit → the runner is never `claude` → the `session`
 *       sandbox profile (§15.5, the same generated profile as claude -p;
 *       G-LCL-06) → local.yaml in the session dir → DaemonChildren.intend
 *       {kind:'local-runner'} → spawn detached → track.
 * stdout: every line a turn.event first (S2); model_capabilities ⇒
 *   model.capabilities; model_repair ⇒ model.repair{argument}; message_end
 *   usage ⇒ turn.usage + fuse.recordStreamUsage against the SPAWN permit;
 *   agent_end ⇒ turn.result (remainder only) and the head turn permit
 *   released.
 * send(): a `turn` permit (backend local; the caller's, validated, or
 *   kernel-reserved) → session.inject{client} → turn.sent → prompt line
 *   (follow_up while a turn is in flight). stop(): interrupt = the `abort`
 *   command; otherwise abort + stdin close + the staged group stop.
 *
 * SLICE 2: the config is the root-signed local.signed.json (config.ts,
 *   loaded by the daemon); per-task endpoint choice = the first endpoint in
 *   config order capable for the task's floor; probeAll() at daemon start
 *   records model.probe/model.capabilities; the runner's sha256 pin is
 *   checked at every spawn; roots inside the Gnomon home are refused; the
 *   child gets contextTarget (min(~8k, n_ctx)) for compaction;
 *   send{steer:true} with a turn in flight writes the steer line under that
 *   turn's permit (session.inject + turn.steer), idle it is a normal send.
 * LOOPS STEP 8 (docs/specs/gnomon-loops.md §3.4, §3.6): openLoop(ref, req) is
 *   the ONE unattended open: a judge/summarize step of a trusted loop run,
 *   reachable only with the registry's run reference (loopRunRefInfo; a
 *   forged or released one is FORBIDDEN). session.open{attended:false,
 *   origin:'loop', loopRun}; surface 'none' (no tools), one step per turn,
 *   no kernel socket or session key in its env (LL5); a session.spawn permit
 *   with scope.loop = the paying (root) loop; never a fallback card and
 *   never Claude: no capable endpoint is LoopModelUnavailable (G-LCL-02,
 *   G-LOOP-13). Its model text never reaches a turn.event row (hash only);
 *   ask() hands it back to the runner, which stores it secret-scanned.
 * LOOPS STEP 10 (#loop-act, §3.2-§3.4, §4): openLoop(ref, {role:'act', act}) opens the same unattended session
 *   for an ACT step, in the run's live scratch worktree (kernel/git liveScratch: the cwd and the ONE root, the
 *   one root allowed inside the Gnomon home), under the `loop-act` profile (sandbox/loop-act.ts: outbound only to
 *   the endpoint's loopback port, writes only in the scratch). Its tools are the trust card's declared tools
 *   through the loop clamp (loopActTools; none ⇒ FORBIDDEN), its protected globs go to the child, which refuses
 *   a write to one with no card (a `protected-input:` tool result the turn reports as protectedHits ⇒ the node
 *   fails, G-LOOP-22). Tool lines are hashed in turn.event like model text (they carry model-written content).
 *   A LAN endpoint cannot serve an act step in 8.0 (LoopModelUnavailable 'act-needs-loopback-endpoint').
 * DEFERRED (reported): unattended local automations other than loops (law 5;
 * the scheduler still refuses them), the claude estimate on the card (null: no per-task
 * estimator yet), the darwin sandboxed e2e rig (G-LCL-06, G-LAW-01c with 6
 * children), `gnomon probe local` as a CLI verb.
 */
import { createHash } from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { hsidShort, mintHsid, refuse, RefusedError, turnId, COMPACTION_REASONS, type CompactionReason, type SessionCompactedPayload, type VoiceSentBy } from '@a-company/gnomon-contracts';
import type { DaemonChildren } from '../lifecycle/children.js';
import type { BudgetFuse, PermitV1 } from '../budget/fuse.js';
import type { ApprovalBroker } from '../broker/broker.js';
import { buildSessionPolicy, policyHash, type PolicyPath, type SessionPolicy } from '../manifest/policy.js';
import { defaultClaudeJson } from '../manifest/layers.js';
import { sessionLaunchPlan, type SessionLaunchInput, type SessionLaunchPlan } from '../sandbox/session.js';
import { LifecycleRefusal } from '../lifecycle/refusal.js';
import { buildSessionEnv, DARWIN_SCREEN_TMP_FALLBACK, sessionIdentity, type SessionIdentity } from '../runner/env.js';
import { managedFiles } from '../runner/preflight.js';
import { claudeCodePlatform } from '../../platform/claude-code.js';
import type { DarwinSessionExtras } from '../../platform/darwin/session-sbpl.js';
import { LineSplitter } from '../../adapters/claude-code/adapter.js';
import { abortLine, buildLocalArgv, followUpLine, LocalUsageMeter, parseLocalLine, promptLine, steerLine } from '../../adapters/local/runner.js';
import { prepareRunner, verifyNode } from '../local/runner-pin.js';
import { assertNotClaude, DEFAULT_CONTEXT_TARGET, DEFAULT_CTX_FLOOR, LOCAL_COMPAT_NAMES, validateLocalEndpoints, type LocalLaneConfig } from '../local/config.js';
import { classifyEndpoint } from '../local/endpoint.js';
import { probeLocalEndpoint, type LocalCapabilities, type ProbeFetch } from '../local/probe.js';
import { capability, routeModel, type DeclaredModel } from '../local/routing.js';
import { voiceTag, type VoiceAttribution, type VoiceTurnLink } from '../voice/voice-control.js';
import { loopRunRefInfo, type LoopRunRef, type LoopRunRefInfo } from '../loops/registry.js';
import { LOOP_ORIGIN, LOOP_SESSION_ENV_DROPPED, loopActTools } from './loop-clamp.js';
import { liveScratch, type Scratch } from '../git/scratch.js';
import { loopActLaunchPlan, type LoopActLaunchInput } from '../sandbox/loop-act.js';

const STDOUT_LINE_CAP = 4 * 1024 * 1024;
const EVENT_LINE_CAP = 64 * 1024;
const HISTORY_CAP = 32;

export type LocalLog = (kind: string, payload: Record<string, unknown>, ids?: { session?: string }) => Promise<void>;

export interface LocalOpenRequest {
  principal: string;
  principalClass: string;
  attended: boolean;
  cwd: string;
  worktree?: string;
  backend?: 'claude-code' | 'local';
  model?: string;
  systemPrompt?: string;
}

export interface LocalLaneOptions {
  log: LocalLog;
  children: Pick<DaemonChildren, 'intend' | 'track' | 'stop'>;
  fuse: Pick<BudgetFuse, 'reserve' | 'release' | 'recordStreamUsage' | 'permit'>;
  broker?: Pick<ApprovalBroker, 'raise'>;
  home: string;
  userHome?: string;
  kernelPrincipal: string;
  sock: string;
  env?: () => Readonly<Record<string, string | undefined>>;
  /** the OS identity for USER/LOGNAME/SHELL/TMPDIR (runner/env.ts); default sessionIdentity() */
  identity?: SessionIdentity | null;
  /** TD-2026-10-21-077: the joined session PATH the supervisor resolved (REQUIRED, Aegis L; null = the allowlisted PATH, win32) */
  sessionPath: string | null;
  /** Aegis M: write denies for the PATH dirs a session must not plant into (the in-home node dir); required with sessionPath */
  pathDenies: readonly PolicyPath[];
  endpointPort?: () => number | null;
  linkedFolders?: () => string[];
  platform?: string;
  macosMajor?: () => number | null;
  sipEnabled?: () => boolean | null;
  config?: LocalLaneConfig;
  /** TEST RIG ONLY: the probe's fetch */
  probeFetch?: ProbeFetch;
  probeTtlMs?: number;
  /** TEST RIG ONLY: the launch plan (default: the platform's `session` sandbox profile). The daemon never sets it. */
  launchPlan?: (i: SessionLaunchInput) => SessionLaunchPlan;
}

/** openLoop's request (the runner's model step). */
export interface LoopOpenRequest {
  role: 'judge' | 'summarize' | 'act';
  /** role act only: the node's declared tools (the clamp admits them), its protected globs and its turn cap */
  act?: { tools: readonly unknown[]; protect: readonly string[]; maxSteps: number };
  /** a configured endpoint id (model.profile); absent: the first capable endpoint in root-signed config order */
  profile?: string;
  systemPrompt: string;
  /** the reply cap per turn (the node's limits.tokens, under the lane's maxTokens) */
  maxTokens: number;
  /** the run aborts (pause, kill switch, daemon exit): the session is stopped */
  signal?: AbortSignal;
}

/** One model turn of a loop session. `text` is the model's free text: DATA, never steering (LL2). */
export interface LoopTurn {
  text: string | null;
  tokens: number;
  stopReason: string | null;
  error: string | null;
  /** an act turn: the protected paths the child refused (each is the node's fail, G-LOOP-22) */
  protectedHits?: string[];
}

export interface LoopSessionHandle {
  hsid: string;
  model: string;
  endpoint: string;
  permitId: string;
  /** send one kernel-composed turn (logged session.inject{origin:'kernel', channel:'loop'} first) and wait for its end */
  ask(text: string, o: { timeoutMs: number; receipt?: ReadonlyArray<Record<string, unknown>> }): Promise<LoopTurn>;
  close(): Promise<void>;
}

/** The local model cannot serve this loop step (endpoint down, incapable, none configured): the node's `unavailable`. */
export class LoopModelUnavailable extends Error {
  constructor(readonly why: string) {
    super(`#local-runner: no capable local model for the loop step (${why})`);
  }
}

interface LoopState {
  info: Readonly<LoopRunRefInfo>;
  /** an act session: its scratch and the protected writes the child refused */
  act?: { scratch: Readonly<Scratch>; hits: string[] };
  reply: string | null;
  tokens: number;
  fatal: string | null;
  pending: ((t: LoopTurn) => void) | null;
}

interface LocalSession {
  loop?: LoopState;
  hsid: string;
  /** the spawn cwd (realpath): #loop-land waits while an attended session in the repo is mid-turn */
  cwd: string;
  principalId: string;
  owner: string;
  model: string;
  child: ChildProcess;
  exited: Promise<void>;
  spawnPermit: PermitV1;
  turnPermits: string[];
  /** kernel clock (ms) when the last model turn closed (#gnomon-voice busy guard, V2a) */
  lastTurnEndAt?: number;
  state: 'running' | 'stopping' | 'exited';
  turns: number;
  seq: number;
  meter: LocalUsageMeter;
}

function refused(code: Parameters<typeof refuse>[0]['code'], message: string, data: Record<string, unknown> = {}): RefusedError {
  return new RefusedError(refuse({ code, data }), `#local-runner: ${message}`);
}

const sha = (s: string): string => `sha256:${createHash('sha256').update(s).digest('hex')}`;

/** The project a local session is recorded under (§4.1: project.yaml repoId when present). */
export function repoIdOf(cwd: string): string {
  try {
    const m = /^repoId:\s*['"]?([A-Za-z0-9._:/-]{1,128})['"]?\s*$/m.exec(fs.readFileSync(path.join(cwd, '.gnomon', 'project.yaml'), 'utf8'));
    if (m) return m[1]!;
  } catch {
    /* no project.yaml */
  }
  // slice 1 reading: the root-commit fallback needs a kernel git call (the `git` profile, Move 2); the path hash stands in
  let real = cwd;
  try {
    real = fs.realpathSync(cwd);
  } catch {
    /* keep cwd */
  }
  return `path:${createHash('sha256').update(real).digest('hex').slice(0, 16)}`;
}

/**
 * The typed session.compacted payload for a local runner compaction event
 * (T-2026-10-18-016, P8-D93), or null when the event is not a successful
 * compaction_end carrying its summary hash and both token counts as safe
 * non-negative integers (anything else stays only the raw turn.event).
 */
export function compactedPayloadOf(hsid: string, turn: string | null, ev: ReturnType<typeof parseLocalLine>): SessionCompactedPayload | null {
  if (ev.kind !== 'compaction' || ev.phase !== 'end' || ev.error !== null) return null;
  if (ev.summaryHash === null || ev.tokensBefore === null || ev.tokensAfter === null) return null;
  // reviewer r2: only safe non-negative integers, so the typed append can never throw on the runner's numbers
  const count = (n: number): boolean => Number.isSafeInteger(n) && n >= 0;
  if (!count(ev.tokensBefore) || !count(ev.tokensAfter)) return null;
  // Aegis r2: a closed reason enum; anything the runner says outside it is recorded as `unspecified`
  const reason: CompactionReason = (COMPACTION_REASONS as readonly string[]).includes(ev.reason ?? '') ? (ev.reason as CompactionReason) : 'unspecified';
  return { hsid, turn, reason, summaryHash: ev.summaryHash, tokensBefore: ev.tokensBefore, tokensAfter: ev.tokensAfter };
}

/** The assistant text of a message_end line (a loop session's reply), or null. */
function loopReplyOf(line: string): string | null {
  try {
    const j = JSON.parse(line) as { type?: unknown; message?: { role?: unknown; content?: unknown } };
    if (j.type !== 'message_end' || !j.message || j.message.role !== 'assistant') return null;
    return typeof j.message.content === 'string' ? j.message.content : null;
  } catch {
    return null;
  }
}

export class LocalLane {
  readonly #o: LocalLaneOptions;
  readonly #sessions = new Map<string, LocalSession>();
  readonly #history: Array<Record<string, unknown>> = [];
  readonly #usedTurnPermits = new Set<string>();
  readonly #probes = new Map<string, { at: number; caps: LocalCapabilities }>();
  readonly #platform: string;
  readonly #identity: SessionIdentity | null;
  readonly #sessionPath: string | null;

  constructor(o: LocalLaneOptions) {
    this.#o = o;
    this.#platform = o.platform ?? process.platform;
    this.#identity = o.identity !== undefined ? o.identity : sessionIdentity();
    this.#sessionPath = o.sessionPath;
  }

  /** Aegis L2: the OS home (passwd), never $HOME; the userHome seam still wins */
  #userHome(): string {
    return this.#o.userHome ?? this.#identity?.home ?? os.homedir();
  }

  has(hsid: unknown): boolean {
    return typeof hsid === 'string' && (this.#sessions.has(hsid) || this.#history.some((h) => h.hsid === hsid));
  }

  #forbiddenPorts(): number[] {
    const p = this.#o.endpointPort?.();
    return typeof p === 'number' ? [p] : [];
  }

  async #probe(ep: { id: string; base: string; model: string }): Promise<LocalCapabilities> {
    const hit = this.#probes.get(ep.id);
    if (hit && Date.now() - hit.at < (this.#o.probeTtlMs ?? 60_000)) return hit.caps;
    const caps = await probeLocalEndpoint(ep, { forbiddenPorts: this.#forbiddenPorts(), ...(this.#o.probeFetch ? { fetch: this.#o.probeFetch } : {}) });
    await this.#o.log('model.probe', { endpoint: ep.id, ok: caps.ok, ...(caps.error ? { error: caps.error } : {}) });
    if (caps.ok) await this.#o.log('model.capabilities', { backend: 'local', endpoint: ep.id, model: caps.model, tools: caps.tools, ctx: caps.nCtx, ctxSource: caps.nCtxSource, templateTools: caps.templateTools });
    this.#probes.set(ep.id, { at: Date.now(), caps });
    return caps;
  }

  /**
   * The daemon-start probe (§13.2 "records model.probe + model.capabilities for each configured endpoint"): every
   * endpoint that passes the loopback/LAN rule is probed once (cached for the next open); a refused one is skipped
   * here and refused at open (G-SUB-06). Never throws.
   */
  async probeAll(): Promise<Array<{ endpoint: string; ok: boolean }>> {
    const out: Array<{ endpoint: string; ok: boolean }> = [];
    for (const ep of this.#o.config?.endpoints ?? []) {
      const v = classifyEndpoint(ep.base, this.#forbiddenPorts());
      if (!v.ok || !LOCAL_COMPAT_NAMES.includes(ep.compat)) continue;
      const caps = await this.#probe({ id: ep.id, base: v.base, model: ep.model }).catch(() => null);
      out.push({ endpoint: ep.id, ok: caps?.ok === true });
    }
    return out;
  }

  /**
   * Route and (when local) spawn. Returns null when the declared model is `any` and Claude was chosen
   * (the supervisor's Claude path runs next). `openClaude` is the fallback-cloud card's effect.
   */
  async open(req: LocalOpenRequest, openClaude: (r: LocalOpenRequest) => Promise<unknown>): Promise<{ hsid: string; principalId: string; backend: 'local'; state: string; model: string } | null> {
    const declared: DeclaredModel = req.model === 'local' ? 'local' : req.model === 'any' ? 'any' : req.model === undefined || req.model === 'claude' ? (req.backend === 'local' ? 'local' : 'claude') : 'local';
    if (req.backend === 'claude-code' && declared === 'local') throw refused('BAD_REQUEST', 'model local is never served by backend claude-code (S7)', { reason: 'bad-params' });
    if (req.backend === 'local' && req.model === 'claude') throw refused('BAD_REQUEST', 'backend local cannot serve model claude', { reason: 'bad-params' });
    const cfg: LocalLaneConfig = this.#o.config ?? { endpoints: [] };
    let eps;
    try {
      eps = validateLocalEndpoints(cfg, this.#forbiddenPorts());
    } catch (err) {
      if (err instanceof RefusedError) await this.#o.log('session.refused', { hsid: null, code: 'local_endpoint_refused', refusal: err.refusal.code, ...(err.refusal.data ?? {}) }).catch(() => undefined);
      throw err;
    }
    // per-task endpoint choice (slice 2): the FIRST endpoint, in root-signed config order, that is capable for this
    // task's floor; none capable ⇒ the first endpoint's reason (no endpoint at all ⇒ no-endpoint)
    const floor = cfg.ctxFloor ?? DEFAULT_CTX_FLOOR;
    let first: (typeof eps)[number] | undefined;
    let caps: LocalCapabilities | null = null;
    let cap: ReturnType<typeof capability> = capability(null, floor, false);
    for (const e of eps) {
      const c = await this.#probe({ id: e.ep.id, base: e.v.base, model: e.ep.model });
      const k = capability(c, floor, e.ep.textTools === true);
      if (!first || k.capable) {
        first = e;
        caps = c;
        cap = k;
      }
      if (k.capable) break;
    }
    let route = routeModel(declared, cap, cfg.runner !== undefined);
    // an explicit backend pins the route: backend:'local' never falls through to Claude (reviewer, round 2)
    if (route.chosen === 'claude' && req.backend === 'local') route = { chosen: 'fallback', reason: route.reason };
    if (route.chosen === 'claude') {
      await this.#o.log('session.routed', { hsid: null, declared, chosen: 'claude', reason: route.reason });
      return null;
    }
    if (route.chosen === 'fallback') return this.#fallback(req, declared, route.reason, openClaude);
    return this.#spawn(req, declared, route.reason, route.tools ?? 'native', first!.ep, first!.v.base, caps!, cfg);
  }

  /**
   * Step 10 (Aegis M1): resolves once every loop session of `runId` has exited (the runner parks only after this; the
   * loop-act profile denies process-fork, so the child has no descendant to wait for).
   */
  async loopSessionsSettled(runId: string): Promise<void> {
    const live = [...this.#sessions.values()].filter((s) => s.loop?.info.runId === runId);
    await Promise.all(live.map((s) => s.exited.catch(() => undefined)));
  }

  /** Is this a loop session (origin 'loop')? Step 12's loop.request pre-gate refuses them (LL5). */
  isLoopSession(hsid: unknown): boolean {
    return typeof hsid === 'string' && this.#sessions.get(hsid)?.loop !== undefined;
  }

  /**
   * Loops step 8: an UNATTENDED local session for one judge/summarize step of a trusted loop run. `ref` must be a
   * live run reference the registry minted (its issued minter, held by the runner); anything else is FORBIDDEN before any row. No capable
   * endpoint (none configured, the profile names none, the endpoint is down or incapable, no runner) throws
   * LoopModelUnavailable: no spawn, no card, never Claude (8.0 is local only).
   */
  async openLoop(ref: LoopRunRef, req: LoopOpenRequest): Promise<LoopSessionHandle> {
    const info = loopRunRefInfo(ref);
    if (!info) throw refused('FORBIDDEN', 'an unattended open takes a trusted loop run reference from the runner', { reason: 'not-a-loop-run' });
    const live = info.live();
    if (!live.ok) throw refused('FORBIDDEN', `the loop cannot run: ${live.reason}`, { reason: 'loop-not-runnable' });
    if (req.role !== 'judge' && req.role !== 'summarize' && req.role !== 'act') throw refused('BAD_REQUEST', 'only judge, summarize and act steps open here', { reason: 'bad-params' });
    // step 10: an act step works ONLY in its run's live scratch, with only the tools its trust card admits (the clamp)
    let act: { scratch: Readonly<Scratch>; tools: string[]; protect: string[]; maxSteps: number } | null = null;
    if (req.role === 'act') {
      const scratch = liveScratch(info.runId);
      if (!req.act || !scratch || scratch.loopId !== info.loopId) throw refused('FORBIDDEN', 'an act step works only in its run\'s scratch worktree', { reason: 'no-scratch' });
      const tools = loopActTools(req.act.tools, info.trustCard);
      if (!tools.length) throw refused('FORBIDDEN', 'the loop\'s trust card admits no tools for this act step', { reason: 'no-trusted-tools' });
      const protect = req.act.protect.filter((g): g is string => typeof g === 'string' && g.length > 0 && g.length <= 512);
      act = { scratch, tools, protect, maxSteps: Math.max(1, Math.min(128, Math.floor(req.act.maxSteps) || 1)) };
    } else if (req.act) throw refused('BAD_REQUEST', 'act options are for act steps', { reason: 'bad-params' });
    if (req.signal?.aborted) throw new LoopModelUnavailable('aborted');
    const cfg: LocalLaneConfig = this.#o.config ?? { endpoints: [] };
    let eps;
    try {
      eps = validateLocalEndpoints(cfg, this.#forbiddenPorts());
    } catch (err) {
      throw new LoopModelUnavailable(err instanceof RefusedError ? `endpoint-refused:${err.refusal.code}` : 'endpoint-refused');
    }
    const loopRun = { loopId: info.loopId, runId: info.runId, nodeId: info.nodeId, scope: info.scope, repoKey: info.repoKey };
    const unavailable = async (why: string): Promise<never> => {
      await this.#o.log('session.refused', { hsid: null, code: 'model_unavailable', backend: 'local', origin: LOOP_ORIGIN, loopRun, why }).catch(() => undefined);
      throw new LoopModelUnavailable(why);
    };
    // Aegis step-8: only endpoints the root-signed config marks `loops: true` serve unattended loop steps
    const forLoops = eps.filter((e) => e.ep.loops === true);
    const pool = req.profile !== undefined ? forLoops.filter((e) => e.ep.id === req.profile) : forLoops;
    if (pool.length === 0) return unavailable(req.profile !== undefined ? 'no-profile' : 'no-loop-endpoint');
    if (!cfg.runner) return unavailable('no-runner');
    const floor = cfg.ctxFloor ?? DEFAULT_CTX_FLOOR;
    let pick: { e: (typeof eps)[number]; caps: LocalCapabilities } | null = null;
    let reason = 'no-endpoint';
    for (const e of pool) {
      // a failed probe is not cached for a loop step: each retry asks the endpoint again
      if (this.#probes.get(e.ep.id)?.caps.ok !== true) this.#probes.delete(e.ep.id);
      const c = await this.#probe({ id: e.ep.id, base: e.v.base, model: e.ep.model }).catch(() => null);
      // judge and summarize use no tools (surface 'none'): capable = reachable and n_ctx ≥ the floor; an act step uses
      // tools (native, or the text-tool fallback): the same test, the route's tools mode kept
      const k = capability(c, floor, true);
      if (k.capable && c) {
        pick = { e, caps: c };
        break;
      }
      reason = k.reason;
    }
    if (!pick) return unavailable(reason);
    let endpointPort: number | null = null;
    if (act) {
      // 8.0: an act session reaches its endpoint on loopback only (the loop-act profile allows one localhost port)
      endpointPort = loopbackPort(pick.e.v.base);
      if (endpointPort === null) return unavailable('act-needs-loopback-endpoint');
    }
    const lane: LocalOpenRequest = { principal: this.#o.kernelPrincipal, principalClass: 'kernel', attended: false, cwd: act ? act.scratch.tree : info.repoRoot, backend: 'local', model: 'local', systemPrompt: req.systemPrompt };
    const tools = pick.caps.tools ? 'native' : 'text';
    const opened = await this.#spawn(lane, 'local', 'capable', act ? tools : 'text', pick.e.ep, pick.e.v.base, pick.caps, cfg, { info, maxTokens: req.maxTokens, ...(act && endpointPort !== null ? { act: { ...act, endpointPort } } : {}) });
    const s = this.#sessions.get(opened.hsid)!;
    const close = async (): Promise<void> => {
      if (s.state === 'exited') return;
      s.state = 'stopping';
      try {
        s.child.stdin?.write(abortLine());
        s.child.stdin?.end();
      } catch {
        /* the pipe may already be gone */
      }
      await this.#o.children.stop(s.child, 'loop.step-ended').catch(() => undefined);
      await s.exited.catch(() => undefined);
    };
    // Aegis step-8 #1: a kill, brake, pause or untrust during the spawn gets no model turn
    const after = info.live();
    if (req.signal?.aborted || !after.ok) {
      await close();
      throw new LoopModelUnavailable(req.signal?.aborted ? 'aborted' : `not-runnable: ${after.ok ? '' : after.reason}`);
    }
    const onAbort = (): void => void close();
    req.signal?.addEventListener('abort', onAbort, { once: true });
    return {
      hsid: s.hsid, model: s.model, endpoint: pick.e.ep.id, permitId: s.spawnPermit.permitId,
      ask: (text, o) => this.#askLoop(s, text, o),
      close: async () => {
        req.signal?.removeEventListener('abort', onAbort);
        await close();
      },
    };
  }

  async #askLoop(s: LocalSession, text: string, o: { timeoutMs: number; receipt?: ReadonlyArray<Record<string, unknown>> }): Promise<LoopTurn> {
    const L = s.loop!;
    if (s.state !== 'running' || s.child.exitCode !== null || s.child.signalCode !== null) return { text: null, tokens: 0, stopReason: null, error: L.fatal ?? 'the loop session is not running' };
    if (L.pending) throw refused('BAD_REQUEST', 'a loop session takes one turn at a time', { reason: 'bad-params' });
    const permit = await this.#o.fuse.reserve({ principal: s.owner, principalClass: 'kernel', attended: false, kind: 'turn', backend: 'local', model: s.model, scope: { user: s.spawnPermit.scope.user, session: s.hsid, ...(s.spawnPermit.scope.repo ? { repo: s.spawnPermit.scope.repo } : {}), ...(s.spawnPermit.scope.loop ? { loop: s.spawnPermit.scope.loop } : {}) } });
    s.turnPermits.push(permit.permitId);
    const n = ++s.turns;
    const contentHash = sha(text);
    L.reply = null;
    L.tokens = 0;
    if (L.act) L.act.hits = [];
    const done = new Promise<LoopTurn>((resolve) => (L.pending = resolve));
    // L2: kernel-added bytes are logged before the child reads them; the receipt names every fenced data block
    await this.#o.log('session.inject', { hsid: s.hsid, origin: 'kernel', channel: 'loop', hash: contentHash, bytes: Buffer.byteLength(text, 'utf8'), ...(o.receipt ? { receipt: o.receipt.slice(0, 32) } : {}) }, { session: s.hsid });
    await this.#o.log('turn.sent', { hsid: s.hsid, turn: turnId(s.hsid, n), permitId: permit.permitId, contentHash, backend: 'local', origin: LOOP_ORIGIN }, { session: s.hsid });
    s.child.stdin?.write(promptLine(text));
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<LoopTurn>((resolve) => {
      timer = setTimeout(() => resolve({ text: null, tokens: L.tokens, stopReason: null, error: 'timeout' }), Math.max(1, o.timeoutMs));
      timer.unref?.();
    });
    const t = await Promise.race([done, timeout]);
    clearTimeout(timer);
    L.pending = null;
    return t;
  }

  async #fallback(req: LocalOpenRequest, declared: DeclaredModel, reason: string, openClaude: (r: LocalOpenRequest) => Promise<unknown>): Promise<never> {
    const detail = { task: 'session.open', cwd: req.cwd, declared, reason, estimate: { backend: 'claude-code', billing: 'subscription', usd: null } };
    let cardId: string | null = null;
    if (this.#o.broker) {
      const card = await this.#o.broker.raise({
        kind: 'fallback',
        requestedBy: req.principal,
        attended: req.attended,
        detail,
        lines: [`No capable local model (${reason}).`, 'Run this task on Claude (subscription) instead?'],
        effect: async (decision) => {
          await this.#o.log('model.fallback.decided', { cardId: card.cardId, decision });
          // S7: the ONLY way a model:local request reaches claude — a human's fallback-cloud decision
          if (decision === 'fallback-cloud') await openClaude({ ...req, backend: 'claude-code', model: 'claude' });
        },
      });
      cardId = card.cardId;
    }
    await this.#o.log('model.fallback.requested', { cardId, declared, reason, task: 'session.open' });
    throw refused('MODEL_UNAVAILABLE', `no capable local model (${reason}); ${cardId ? `fallback card ${cardId} raised` : 'no broker to raise a fallback card'}`, { ...(cardId ? { cardId } : {}), why: reason });
  }

  /** law 1 + S8 mirror: a local runner starts only under a live local session.spawn permit for this hsid. */
  assertLocalPermit(permit: PermitV1, hsid: string): void {
    const live = this.#o.fuse.permit(permit.permitId);
    if (live !== permit && JSON.stringify(live) !== JSON.stringify(permit)) throw refused('PERMIT_REQUIRED', 'the permit is not one the fuse granted', {});
    if (permit.kind !== 'session.spawn' || permit.backend !== 'local' || permit.hsid !== hsid || permit.billing !== 'local') {
      throw refused('PERMIT_REQUIRED', 'gnomon-local runs only under a local session.spawn permit for this session', { kind: permit.kind, backend: permit.backend });
    }
    if (Date.parse(permit.expiresAt) <= Date.now()) throw refused('PERMIT_REQUIRED', 'the spawn permit expired', {});
  }

  async #spawn(req: LocalOpenRequest, declared: DeclaredModel, reason: string, tools: 'native' | 'text', ep: LocalLaneConfig['endpoints'][number], base: string, caps: LocalCapabilities, cfg: LocalLaneConfig, loop?: { info: Readonly<LoopRunRefInfo>; maxTokens: number; act?: { scratch: Readonly<Scratch>; tools: string[]; protect: string[]; maxSteps: number; endpointPort: number } }): Promise<{ hsid: string; principalId: string; backend: 'local'; state: string; model: string }> {
    const pin = cfg.runner!;
    // before any row: claude never runs under a local permit (source paths), then the MANDATORY pin (round 2, Aegis H1):
    // the tree is copied into <home>/runners/<treeSha256>/ and the COPY is hashed; node is verified; we exec the copy
    assertNotClaude({ command: pin.node, args: [path.join(pin.dir, ...pin.entry.split('/'))] });
    if (typeof req.cwd !== 'string' || !path.isAbsolute(req.cwd) || !fs.existsSync(req.cwd) || !fs.statSync(req.cwd).isDirectory()) {
      throw refused('BAD_REQUEST', 'cwd must be an existing absolute directory', { reason: 'bad-params' });
    }
    if (req.worktree !== undefined && (typeof req.worktree !== 'string' || !path.isAbsolute(req.worktree) || !fs.existsSync(req.worktree) || !fs.statSync(req.worktree).isDirectory())) {
      throw refused('BAD_REQUEST', 'worktree must be an existing absolute directory', { reason: 'bad-params' });
    }
    // round 2 (M3): the roots are resolved ONCE (native realpath, fail closed) and only the resolved paths flow into the
    // policy, the child's config, the darwin extras and the spawn cwd; they are re-checked right before spawn
    const realRoot = (p: string): string => {
      try {
        return fs.realpathSync.native(p); // native: 8.3 short names expand on Windows
      } catch {
        throw refused('BAD_REQUEST', 'a session root could not be resolved', { reason: 'bad-params' });
      }
    };
    const cwdReal = realRoot(req.cwd);
    const wtReal = req.worktree !== undefined ? realRoot(req.worktree) : undefined;
    const rootsReal = [cwdReal, ...(wtReal ? [wtReal] : [])];
    // round 3 (R2): a tool root is never /, the user's home, or the Gnomon home or any ancestor of it
    {
      const rp = (p: string): string => {
        try {
          return fs.realpathSync.native(p);
        } catch {
          return path.resolve(p); // the homes need not exist yet; they are never roots
        }
      };
      const gh = rp(this.#o.home);
      const uh = rp(this.#userHome());
      for (const r of rootsReal) {
        const under = (a: string, b: string): boolean => a.startsWith(b.endsWith(path.sep) ? b : b + path.sep);
        // slice 2: a root INSIDE the Gnomon home (keys/, sessions/) is refused too — the tools would otherwise confine to it
        // step 10: the ONE exception is an act step's live scratch tree (<home>/loop-work/act-<runId>/tree, kernel-made)
        const scratchRoot = loop?.act !== undefined && r === loop.act.scratch.tree && liveScratch(loop.info.runId) === loop.act.scratch;
        if (r === path.parse(r).root || r === uh || gh === r || under(gh, r) || (under(r, gh) && !scratchRoot)) {
          throw refused('BAD_REQUEST', 'a session root may not be /, the user home, or the Gnomon home, an ancestor of it or a path inside it', { reason: 'bad-params' });
        }
      }
    }
    let runner: ReturnType<typeof prepareRunner>;
    try {
      runner = prepareRunner(this.#o.home, pin);
    } catch (err) {
      if (err instanceof RefusedError) throw err;
      throw refused('UNSUPPORTED', `the pinned runner could not be staged: ${(err as Error).message.slice(0, 200)}`, { session: 'spawn_failed' });
    }
    assertNotClaude({ command: runner.command, args: [runner.entry] });
    const hsid = mintHsid();
    const principalId = `${this.#o.kernelPrincipal.replace(/\/kernel$/, '')}/s-${hsidShort(hsid)}`;
    const model = caps.model ?? ep.model;
    // an act step's permit names the human repo, never its scratch path
    const repo = repoIdOf(loop?.act ? loop.act.scratch.repo : cwdReal);
    const userHome = this.#userHome();
    const loopRun = loop ? { loopId: loop.info.loopId, runId: loop.info.runId, nodeId: loop.info.nodeId, scope: loop.info.scope, repoKey: loop.info.repoKey } : null;
    await this.#o.log('session.open', { hsid, principalId, by: req.principal, cwd: req.cwd, worktree: req.worktree ?? null, roots: rootsReal, backend: 'local', model, declaredModel: declared, endpoint: ep.id, attended: !loop, ...(loopRun ? { principalClass: req.principalClass, origin: LOOP_ORIGIN, loopRun } : {}) }, { session: hsid });
    await this.#o.log('session.routed', { hsid, declared, chosen: 'local', reason, tools: loop && !loop.act ? 'none' : tools, ...(loop?.act ? { allowTools: loop.act.tools } : {}) }, { session: hsid });
    const dir = path.join(this.#o.home, 'sessions', hsidShort(hsid));
    const built = buildSessionEnv({ from: { ...(this.#o.env?.() ?? process.env), HOME: userHome }, hsid, sock: this.#o.sock, sessionKeyPath: path.join(dir, 'session.key'), identity: this.#identity, path: this.#sessionPath });
    const env = built.env;
    let envKeys = built.envKeys;
    if (loop) {
      // LL5: a loop session talks to nothing but its model endpoint (no socket, no session key: no loop.request)
      for (const k of LOOP_SESSION_ENV_DROPPED) delete env[k];
      envKeys = envKeys.filter((k) => !LOOP_SESSION_ENV_DROPPED.includes(k));
      // an act session's TMPDIR is its run's private tmp (the only other place the loop-act profile lets it write)
      if (loop.act) env.TMPDIR = loop.act.scratch.tmp;
    }
    let permit: PermitV1 | null = null;
    let child: ChildProcess | null = null;
    let tracked = false;
    let live: LocalSession | null = null;
    try {
      // a loop step's permit: scope.loop is the PAYING loop (the root caller), scope.user the human who trusted it
      permit = await this.#o.fuse.reserve({ principal: req.principal, principalClass: req.principalClass, attended: !loop, kind: 'session.spawn', backend: 'local', model, scope: { user: loop?.info.trustedBy ?? req.principal, session: hsid, repo, ...(loop ? { loop: loop.info.rootKey } : {}) }, ...(loop ? { limits: { tokens: loop.maxTokens } } : {}) });
      this.assertLocalPermit(permit, hsid);
      const row = claudeCodePlatform(this.#platform);
      const userClaudeDir = path.join(userHome, row?.userClaudeDir ?? '.claude');
      // the SAME session profile as claude -p (§15.5): keys/warpline/link/head unreadable, settings layers + linked mods unwritable
      const policy: SessionPolicy = buildSessionPolicy({
        home: this.#o.home,
        cwd: cwdReal,
        ...(wtReal ? { worktree: wtReal } : {}),
        userClaudeDir,
        userClaudeJson: defaultClaudeJson(userClaudeDir),
        userHome,
        managedSettingsPaths: row ? managedFiles(row) : [],
        linkedFolders: this.#o.linkedFolders?.() ?? [],
        endpointPort: this.#o.endpointPort?.() ?? null,
        extraDenyWrite: [...this.#o.pathDenies],
        localRunner: { node: pin.node, dir: pin.dir },
        // T-2026-10-18-010: the home is read-denied; only this session's dir (local.yaml) and the staged runner copy are readable
        homeReadable: [{ path: dir, match: 'subpath' }, { path: runner.copy, match: 'subpath' }],
      });
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
      const configPath = path.join(dir, 'local.yaml');
      const sessionCfg = {
        schemaVersion: 'gnomon-local-session:v1',
        session: hsid,
        cwd: wtReal ?? cwdReal,
        roots: rootsReal,
        endpoint: { base, model, compat: ep.compat },
        capabilities: { tools: tools === 'native', nCtx: caps.nCtx },
        // a loop judge/summarize step: no tools at all and one model step per turn (§3.4); an act step: only the
        // tools its trust card admits, its protected globs, the node's turn cap
        surface: loop && !loop.act ? 'none' : (ep.surface ?? 'compact'),
        maxSteps: loop ? (loop.act ? loop.act.maxSteps : 1) : (cfg.maxSteps ?? 16),
        ...(loop?.act ? { tools: loop.act.tools, protect: loop.act.protect } : {}),
        maxTokens: loop ? Math.max(16, Math.min(loop.maxTokens, cfg.maxTokens ?? 1024)) : (cfg.maxTokens ?? 1024),
        // the compaction working target: ~8k, never above what the endpoint holds
        contextTarget: Math.min(cfg.contextTarget ?? DEFAULT_CONTEXT_TARGET, caps.nCtx ?? DEFAULT_CONTEXT_TARGET),
        forbiddenPorts: this.#forbiddenPorts(),
        ...(req.systemPrompt !== undefined ? { systemPrompt: req.systemPrompt } : {}),
      };
      fs.writeFileSync(configPath, `${JSON.stringify(sessionCfg, null, 2)}\n`, { mode: 0o600 });
      const extras: DarwinSessionExtras = { uid: process.getuid?.() ?? 0, tmpdir: env.TMPDIR ?? DARWIN_SCREEN_TMP_FALLBACK, home: userHome, roots: rootsReal };
      const launch: SessionLaunchInput = { policy, binaryReal: runner.command, argv: [runner.entry, ...buildLocalArgv({ configPath, hsid })], extras };
      // step 10: an act step runs under `loop-act` (the session profile narrowed to its scratch and its endpoint port)
      const actLaunch: LoopActLaunchInput | null = loop?.act ? { ...launch, act: { home: this.#o.home, userHome, scratch: loop.act.scratch.tree, tmp: loop.act.scratch.tmp, repo: loop.act.scratch.repo, nodeModules: loop.act.scratch.nodeModules, endpointPort: loop.act.endpointPort, gitDeny: [loop.act.scratch.commonDir, ...loop.act.scratch.siblingWorktrees] } } : null;
      const plan = this.#o.launchPlan ? this.#o.launchPlan(actLaunch ?? launch) : actLaunch ? loopActLaunchPlan(actLaunch, this.#platform, this.#o.macosMajor, this.#o.sipEnabled) : sessionLaunchPlan(launch, this.#platform, this.#o.macosMajor, this.#o.sipEnabled);
      const intent = await this.#o.children.intend({ kind: 'local-runner', hsid });
      // re-check (M3): a root swapped since the check refuses; nothing between here and spawn awaits
      if (realRoot(req.cwd) !== cwdReal || (req.worktree !== undefined && realRoot(req.worktree) !== wtReal)) {
        throw refused('BAD_REQUEST', 'a session root moved between the check and the spawn', { reason: 'bad-params' });
      }
      // round 3 (Aegis H1, node half): node is re-hashed HERE, synchronously, with no await before spawn
      if (verifyNode(pin) !== runner.command) throw refused('PERMIT_REQUIRED', 'the node binary changed between staging and spawn', { why: 'runner-pin-mismatch', part: 'node' });
      child = spawn(plan.command, plan.args, { cwd: wtReal ?? cwdReal, env, detached: true, stdio: ['pipe', 'pipe', 'ignore'] });
      const c = child;
      const exited = new Promise<void>((r) => c.once('close', () => r()));
      const spawnError = await new Promise<Error | null>((resolve) => {
        c.once('error', (e) => resolve(e));
        c.once('spawn', () => resolve(null));
      });
      if (spawnError) throw refused('UNSUPPORTED', `spawn failed: ${spawnError.message}`, { session: 'spawn_failed' });
      await this.#o.children.track({ kind: 'local-runner', child: c, hsid, intent });
      tracked = true;
      const s: LocalSession = { hsid, cwd: wtReal ?? cwdReal, principalId, owner: req.principal, model, child: c, exited, spawnPermit: permit, turnPermits: [], state: 'running', turns: 0, seq: 0, meter: new LocalUsageMeter(), ...(loop ? { loop: { info: loop.info, reply: null, tokens: 0, fatal: null, pending: null, ...(loop.act ? { act: { scratch: loop.act.scratch, hits: [] } } : {}) } } : {}) };
      this.#sessions.set(hsid, s);
      live = s;
      this.#wire(s);
      await this.#o.log('session.sandbox', { hsid, sandbox: plan.sandbox, profile: actLaunch ? 'loop-act' : 'session', profileHash: plan.profileHash, policyHash: policyHash(policy), backend: 'local', runner: runner.command, runnerEntry: runner.entry, runnerTree: pin.treeSha256, envKeys, permitId: permit.permitId, ...(loop ? { origin: LOOP_ORIGIN } : {}) }, { session: hsid });
      return { hsid, principalId, backend: 'local', state: s.state, model };
    } catch (err) {
      if (tracked && child) {
        await this.#o.children.stop(child, 'open-failed').catch(() => undefined);
        if (live) await live.exited.catch(() => undefined);
      }
      if (!tracked) {
        if (child?.pid !== undefined && child.exitCode === null && child.signalCode === null) {
          try {
            process.kill(-child.pid, 'SIGKILL');
          } catch {
            child.kill('SIGKILL');
          }
        }
        if (permit) await this.#o.fuse.release(permit.permitId, permit.principal).catch(() => undefined);
        fs.rmSync(dir, { recursive: true, force: true });
      }
      await this.#o.log('session.refused', { hsid, code: 'spawn_failed', backend: 'local', ...(err instanceof RefusedError ? { refusal: err.refusal.code } : {}), ...(err instanceof LifecycleRefusal ? { sandbox: 'unavailable' } : {}) }, { session: hsid }).catch(() => undefined);
      if (err instanceof LifecycleRefusal) throw refused('UNSUPPORTED', err.message, { session: 'spawn_failed', sandbox: 'unavailable', ...err.detail });
      if (err instanceof RefusedError) throw err;
      throw refused('UNSUPPORTED', (err as Error).message, { session: 'spawn_failed' });
    }
  }

  #wire(s: LocalSession): void {
    const split = new LineSplitter(STDOUT_LINE_CAP);
    let chain: Promise<void> = Promise.resolve();
    const queue = (f: () => Promise<void>): void => {
      chain = chain.then(f).catch(() => undefined);
    };
    s.child.stdout?.setEncoding('utf8');
    s.child.stdout?.on('data', (chunk: string) => {
      split.push(chunk, (line) => queue(() => this.#onLine(s, line)), (bytes) => queue(() => this.#o.log('turn.event', { hsid: s.hsid, type: 'dropped', bytes, seq: ++s.seq }, { session: s.hsid })));
    });
    s.child.stdin?.on('error', () => undefined);
    void s.exited.then(() => queue(() => this.#onExit(s)));
  }

  async #onExit(s: LocalSession): Promise<void> {
    if (s.state === 'exited') return;
    s.state = 'exited';
    for (const p of [s.spawnPermit.permitId, ...s.turnPermits]) await this.#o.fuse.release(p, s.owner).catch(() => undefined);
    s.turnPermits = [];
    if (s.loop?.pending) s.loop.pending({ text: null, tokens: s.loop.tokens, stopReason: null, error: s.loop.fatal ?? 'the loop session exited' });
    this.#sessions.delete(s.hsid);
    this.#history.push({ hsid: s.hsid, principalId: s.principalId, backend: 'local', model: s.model, state: 'exited', turns: s.turns, code: s.child.exitCode, signal: s.child.signalCode, ...(s.loop ? { origin: LOOP_ORIGIN } : {}) });
    while (this.#history.length > HISTORY_CAP) this.#history.shift();
  }

  async #onLine(s: LocalSession, line: string): Promise<void> {
    const ev = parseLocalLine(line);
    const bytes = Buffer.byteLength(line);
    // S2: every driver event is a turn.event before anything acts on it
    // a loop session's model text is DATA the runner stores secret-scanned on its loop.node row: the turn.event
    // row of a message line carries its hash and size only (never unscanned model text in the log)
    // step 10: an act session's tool lines carry model-written paths and file content: hashed the same way
    const hashOnly = bytes > EVENT_LINE_CAP || (s.loop !== undefined && (ev.kind === 'message' || ev.kind === 'partial' || ev.kind === 'tool' || ev.type.startsWith('message') || ev.type.startsWith('tool')));
    await this.#o.log('turn.event', { hsid: s.hsid, type: ev.type, seq: ++s.seq, backend: 'local', ...(hashOnly ? { lineHash: sha(line), bytes } : { line }), ...(ev.kind === 'compaction' && ev.summaryHash ? { summaryHash: ev.summaryHash, summaryBytes: ev.summaryBytes } : {}) }, { session: s.hsid });
    if (s.loop && ev.kind === 'message') s.loop.reply = loopReplyOf(line) ?? s.loop.reply;
    if (s.loop && ev.kind === 'fatal') s.loop.fatal = ev.error ?? 'fatal';
    if (s.loop?.act && ev.kind === 'tool' && ev.phase === 'end' && ev.isError) {
      const hit = protectedHitOf(line);
      if (hit !== null && s.loop.act.hits.length < 64) s.loop.act.hits.push(hit);
    }
    const usage = async (source: 'turn.usage' | 'turn.result', tokens: number, extra: Record<string, unknown> = {}): Promise<void> => {
      if (source === 'turn.usage' && tokens <= 0) return;
      if (s.loop) s.loop.tokens += Math.max(0, tokens);
      await this.#o.log(source, { hsid: s.hsid, usage: { tokens }, backend: 'local', ...extra }, { session: s.hsid });
      await this.#o.fuse.recordStreamUsage({ source, permitId: s.spawnPermit.permitId, hsid: s.hsid, tokens });
    };
    switch (ev.kind) {
      case 'capabilities':
        await this.#o.log('model.capabilities', { hsid: s.hsid, backend: 'local', model: ev.model, tools: ev.tools, ctx: ev.ctx, compat: ev.compat, textTools: ev.textTools }, { session: s.hsid });
        return;
      case 'repair':
        await this.#o.log('model.repair', { hsid: s.hsid, argument: ev.tool, steps: ev.steps }, { session: s.hsid });
        return;
      case 'partial':
        await this.#o.log('turn.partial', { hsid: s.hsid, bytes: ev.bytes }, { session: s.hsid });
        return;
      case 'compaction': {
        // T-2026-10-18-016 (P8-D93): a SUCCESSFUL compaction_end is also a typed session.compacted row; the raw
        // turn.event line above stays the evidence (S2). A start, a failed end or an end without its numbers is
        // only the turn.event.
        const inFlight = s.turnPermits.length > 0 ? s.turns - s.turnPermits.length + 1 : s.turns;
        const row = compactedPayloadOf(s.hsid, inFlight > 0 ? turnId(s.hsid, inFlight) : null, ev);
        if (row) await this.#o.log('session.compacted', { ...row }, { session: s.hsid });
        return;
      }
      case 'message':
        // a message without usage is recorded as such (never silently zero)
        if (ev.tokens === null) await this.#o.log('turn.usage', { hsid: s.hsid, usage: null, backend: 'local' }, { session: s.hsid });
        else await usage('turn.usage', s.meter.message(ev.tokens));
        return;
      case 'end': {
        // review M2: turn.result{turn} names the turn it closes (the oldest in flight; the local lane never folds turns)
        const closing = s.turnPermits.length > 0 ? s.turns - s.turnPermits.length + 1 : 0;
        await usage('turn.result', s.meter.end(ev.tokens), { stopReason: ev.stopReason, isError: ev.stopReason === 'error', ...(ev.error ? { error: ev.error } : {}), ...(closing > 0 ? { turn: turnId(s.hsid, closing) } : {}) });
        const head = s.turnPermits.shift();
        s.lastTurnEndAt = Date.now();
        if (head) await this.#o.fuse.release(head, s.owner).catch(() => undefined);
        if (s.loop?.pending) s.loop.pending({ text: s.loop.reply, tokens: s.loop.tokens, stopReason: ev.stopReason, error: ev.error ?? (ev.stopReason === 'error' ? 'the model call failed' : null), ...(s.loop.act ? { protectedHits: [...s.loop.act.hits] } : {}) });
        return;
      }
      case 'response':
        // round 2 (steer race): the child refuses a steer that reaches it idle (it never queues it into the next
        // turn); the kernel records the refusal against the session — a steer that did not land
        if (ev.command === 'steer' && ev.success === false) await this.#o.log('turn.steer', { hsid: s.hsid, phase: 'refused', by: 'child', error: ev.error }, { session: s.hsid });
        return;
      default:
        return; // responses, tool/turn markers, fatal, unknown and malformed lines: logged above, never acted on
    }
  }

  #get(principal: string, hsid: unknown): LocalSession {
    const s = typeof hsid === 'string' ? this.#sessions.get(hsid) : undefined;
    if (!s || s.owner !== principal) throw refused('NOT_FOUND', 'no such session for this principal', { reason: 'not-found' });
    return s;
  }

  /** #gnomon-voice V2a: the local session's model turn is streaming now / when its last turn closed (kernel clock). */
  turnBusy(hsid: string): { streaming: boolean; endedAt: number | null } {
    const s = this.#sessions.get(hsid);
    return { streaming: !!s && s.state === 'running' && s.turnPermits.length > 0, endedAt: s?.lastTurnEndAt ?? null };
  }

  /** #loop-land (step 11, Aegis L7): every live ATTENDED local session (never a loop session), its cwd and turn state. */
  humanTurns(): Array<{ hsid: string; cwd: string; busy: boolean }> {
    return [...this.#sessions.values()].filter((s) => !s.loop && s.state === 'running').map((s) => ({ hsid: s.hsid, cwd: s.cwd, busy: this.turnBusy(s.hsid).streaming }));
  }

  /** The owner of a live local session, or undefined (#gnomon-voice attachment). */
  ownerOf(hsid: string): string | undefined {
    const s = this.#sessions.get(hsid);
    return s && s.state === 'running' ? s.owner : undefined;
  }

  async send(principal: string, p: { hsid: string; text: string; permitId?: string; steer?: boolean; source?: 'voice'; voice?: VoiceTurnLink; voiceAttribution?: VoiceAttribution; voiceOrigin?: { sentBy: VoiceSentBy } }): Promise<{ turn: string; steered?: boolean }> {
    const s = this.#get(principal, p.hsid);
    if (s.state !== 'running' || s.child.exitCode !== null || s.child.signalCode !== null) throw refused('NOT_FOUND', 'the session is not running', { reason: 'not-found' });
    if (typeof p.text !== 'string' || p.text.length === 0) throw refused('BAD_REQUEST', 'send takes non-empty text', { reason: 'bad-params' });
    // session.send{steer} (slice 2, §11.5): mid-turn text the child reads at its next step. It joins the IN-FLIGHT
    // turn, whose permit already pays for it (law 1: no new turn.sent, so no new permit); a permitId with steer is
    // refused. With no turn in flight there is nothing to steer: it is an ordinary send (a new permitted turn).
    if (p.steer === true && s.turnPermits.length > 0) {
      if (p.permitId !== undefined) throw refused('BAD_REQUEST', 'a steer joins the in-flight turn and takes no permit', { reason: 'bad-params' });
      // round 2 (M2): the in-flight turn's permit must still be live — an expired one pays for nothing
      const head = this.#o.fuse.permit(s.turnPermits[0]!);
      if (!head || Date.parse(head.expiresAt) <= Date.now()) throw refused('PERMIT_REQUIRED', 'the in-flight turn\'s permit is gone or expired; a steer cannot ride it', {});
      const contentHash = sha(p.text);
      const turn = turnId(s.hsid, s.turns - s.turnPermits.length + 1);
      await this.#o.log('session.inject', { hsid: s.hsid, origin: 'client', hash: contentHash, bytes: Buffer.byteLength(p.text, 'utf8'), ...voiceTag(p) }, { session: s.hsid });
      await this.#o.log('turn.steer', { hsid: s.hsid, turn, contentHash, permitId: s.turnPermits[0], backend: 'local' }, { session: s.hsid });
      s.child.stdin?.write(steerLine(p.text));
      return { turn, steered: true };
    }
    let permit: PermitV1 | undefined;
    if (p.permitId !== undefined) {
      permit = this.#o.fuse.permit(p.permitId);
      if (!permit || permit.kind !== 'turn' || permit.backend !== 'local' || permit.principal !== principal || (permit.hsid !== null && permit.hsid !== s.hsid) || Date.parse(permit.expiresAt) <= Date.now() || this.#usedTurnPermits.has(permit.permitId)) {
        throw refused('PERMIT_REQUIRED', 'session.send needs a live, unused local turn permit of yours for this session', {});
      }
    } else {
      permit = await this.#o.fuse.reserve({ principal, principalClass: 'human', attended: true, kind: 'turn', backend: 'local', model: s.model, scope: { user: principal, session: s.hsid } });
    }
    this.#usedTurnPermits.add(permit.permitId);
    const inFlight = s.turnPermits.length > 0;
    s.turnPermits.push(permit.permitId);
    const n = ++s.turns;
    const contentHash = sha(p.text);
    await this.#o.log('session.inject', { hsid: s.hsid, origin: 'client', hash: contentHash, bytes: Buffer.byteLength(p.text, 'utf8'), ...voiceTag(p) }, { session: s.hsid });
    await this.#o.log('turn.sent', { hsid: s.hsid, turn: turnId(s.hsid, n), permitId: permit.permitId, contentHash, backend: 'local', ...voiceTag(p), origin: p.voiceOrigin?.sentBy === 'unverified' ? 'voice-unverified' : p.voiceOrigin ? 'voice' : 'hand', ...(p.voiceOrigin ? { sentBy: p.voiceOrigin.sentBy } : {}) }, { session: s.hsid });
    s.child.stdin?.write(inFlight ? followUpLine(p.text) : promptLine(p.text));
    return { turn: turnId(s.hsid, n) };
  }

  async stop(principal: string, p: { hsid: string; interrupt?: boolean }): Promise<{ signals: string[]; exited: boolean }> {
    const s = this.#get(principal, p.hsid);
    if (p.interrupt) {
      if (s.state === 'running') s.child.stdin?.write(abortLine());
      return { signals: ['rpc:abort'], exited: false };
    }
    if (s.state === 'exited') return { signals: [], exited: true };
    s.state = 'stopping';
    try {
      s.child.stdin?.write(abortLine());
      s.child.stdin?.end();
    } catch {
      /* the pipe may already be gone */
    }
    const survivors = await this.#o.children.stop(s.child, 'session.stop');
    return { signals: ['rpc:abort', 'stdin:close', 'group:staged'], exited: !survivors };
  }

  status(): Array<Record<string, unknown>> {
    return [...[...this.#sessions.values()].map((s) => ({ hsid: s.hsid, principalId: s.principalId, backend: 'local', model: s.model, state: s.state, turns: s.turns, permitId: s.spawnPermit.permitId })), ...this.#history];
  }

  stateOf(hsid: string): string | null {
    return this.#sessions.get(hsid)?.state ?? (this.#history.some((h) => h.hsid === hsid) ? 'exited' : null);
  }
}

/** The loopback port of an endpoint base URL (127.0.0.0/8, ::1, localhost), or null for anything else. */
export function loopbackPort(base: string): number | null {
  let u: URL;
  try {
    u = new URL(base);
  } catch {
    return null;
  }
  const h = u.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (h !== 'localhost' && h !== '::1' && !/^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h)) return null;
  const port = u.port ? Number(u.port) : u.protocol === 'https:' ? 443 : u.protocol === 'http:' ? 80 : NaN;
  return Number.isInteger(port) && port > 0 && port < 65536 ? port : null;
}

/** A gnomon-local tool_execution_end line whose result is a protected-input refusal: the path, else null. */
function protectedHitOf(line: string): string | null {
  try {
    const j = JSON.parse(line) as { type?: unknown; result?: unknown };
    if (j.type !== 'tool_execution_end' || typeof j.result !== 'string' || !j.result.startsWith('protected-input:')) return null;
    return j.result.slice('protected-input:'.length).trim().split(' is a protected')[0]!.slice(0, 200);
  } catch {
    return null;
  }
}
