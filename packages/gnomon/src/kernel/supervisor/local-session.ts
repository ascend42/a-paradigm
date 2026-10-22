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
 * DEFERRED (reported): unattended local automations (law 5; the scheduler
 * still refuses), the claude estimate on the card (null: no per-task
 * estimator yet), the darwin sandboxed e2e rig (G-LCL-06, G-LAW-01c with 6
 * children), `gnomon probe local` as a CLI verb.
 */
import { createHash } from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { releaseSession, sessionSidFor } from '../../platform/win32/session-sandbox.js';
import { hsidShort, mintHsid, refuse, RefusedError, turnId, COMPACTION_REASONS, type CompactionReason, type SessionCompactedPayload, type VoiceSentBy } from '@a-company/gnomon-contracts';
import type { DaemonChildren } from '../lifecycle/children.js';
import type { BudgetFuse, PermitV1 } from '../budget/fuse.js';
import type { ApprovalBroker } from '../broker/broker.js';
import { buildSessionPolicy, policyHash, type PolicyPath, type SessionPolicy } from '../manifest/policy.js';
import { defaultClaudeJson } from '../manifest/layers.js';
import { sessionLaunchPlan, type SessionLaunchInput, type SessionLaunchPlan } from '../sandbox/session.js';
import { LifecycleRefusal } from '../lifecycle/refusal.js';
import { buildSessionEnv, win32SessionTempDir, DARWIN_SCREEN_TMP_FALLBACK, sessionIdentity, type SessionIdentity } from '../runner/env.js';
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

interface LocalSession {
  hsid: string;
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

  async #spawn(req: LocalOpenRequest, declared: DeclaredModel, reason: string, tools: 'native' | 'text', ep: LocalLaneConfig['endpoints'][number], base: string, caps: LocalCapabilities, cfg: LocalLaneConfig): Promise<{ hsid: string; principalId: string; backend: 'local'; state: string; model: string }> {
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
        if (r === path.parse(r).root || r === uh || gh === r || under(gh, r) || under(r, gh)) {
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
    const repo = repoIdOf(cwdReal);
    const userHome = this.#userHome();
    await this.#o.log('session.open', { hsid, principalId, by: req.principal, cwd: req.cwd, worktree: req.worktree ?? null, roots: rootsReal, backend: 'local', model, declaredModel: declared, endpoint: ep.id, attended: true }, { session: hsid });
    await this.#o.log('session.routed', { hsid, declared, chosen: 'local', reason, tools }, { session: hsid });
    const dir = path.join(this.#o.home, 'sessions', hsidShort(hsid));
    const { env, envKeys } = buildSessionEnv({ from: { ...(this.#o.env?.() ?? process.env), HOME: userHome }, hsid, sock: this.#o.sock, sessionKeyPath: path.join(dir, 'session.key'), identity: this.#identity, path: this.#sessionPath, ...(this.#platform === 'win32' ? { tempDir: win32SessionTempDir(hsid) } : {}) });
    let permit: PermitV1 | null = null;
    let child: ChildProcess | null = null;
    let tracked = false;
    let live: LocalSession | null = null;
    try {
      permit = await this.#o.fuse.reserve({ principal: req.principal, principalClass: req.principalClass, attended: true, kind: 'session.spawn', backend: 'local', model, scope: { user: req.principal, session: hsid, repo } });
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
        surface: ep.surface ?? 'compact',
        maxSteps: cfg.maxSteps ?? 16,
        maxTokens: cfg.maxTokens ?? 1024,
        // the compaction working target: ~8k, never above what the endpoint holds
        contextTarget: Math.min(cfg.contextTarget ?? DEFAULT_CONTEXT_TARGET, caps.nCtx ?? DEFAULT_CONTEXT_TARGET),
        forbiddenPorts: this.#forbiddenPorts(),
        ...(req.systemPrompt !== undefined ? { systemPrompt: req.systemPrompt } : {}),
      };
      fs.writeFileSync(configPath, `${JSON.stringify(sessionCfg, null, 2)}\n`, { mode: 0o600 });
      const extras: DarwinSessionExtras = { uid: process.getuid?.() ?? 0, tmpdir: (this.#platform === 'win32' ? env.TEMP : env.TMPDIR) ?? DARWIN_SCREEN_TMP_FALLBACK, home: userHome, roots: rootsReal };
      const launch: SessionLaunchInput = { policy, binaryReal: runner.command, argv: [runner.entry, ...buildLocalArgv({ configPath, hsid })], extras, hsid };
      const plan = this.#o.launchPlan ? this.#o.launchPlan(launch) : sessionLaunchPlan(launch, this.#platform, this.#o.macosMajor, this.#o.sipEnabled);
      const intent = await this.#o.children.intend({ kind: 'local-runner', hsid });
      // re-check (M3): a root swapped since the check refuses; nothing between here and spawn awaits
      if (realRoot(req.cwd) !== cwdReal || (req.worktree !== undefined && realRoot(req.worktree) !== wtReal)) {
        throw refused('BAD_REQUEST', 'a session root moved between the check and the spawn', { reason: 'bad-params' });
      }
      // round 3 (Aegis H1, node half): node is re-hashed HERE, synchronously, with no await before spawn
      if (verifyNode(pin) !== runner.command) throw refused('PERMIT_REQUIRED', 'the node binary changed between staging and spawn', { why: 'runner-pin-mismatch', part: 'node' });
      child = spawn(plan.command, plan.args, { cwd: wtReal ?? cwdReal, env, detached: this.#platform !== 'win32', windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] }); // win32: stay in libuv's kill-on-close job
      const c = child;
      const exited = new Promise<void>((r) => c.once('close', () => r()));
      const spawnError = await new Promise<Error | null>((resolve) => {
        c.once('error', (e) => resolve(e));
        c.once('spawn', () => resolve(null));
      });
      if (spawnError) throw refused('UNSUPPORTED', `spawn failed: ${spawnError.message}`, { session: 'spawn_failed' });
      await this.#o.children.track({ kind: 'local-runner', child: c, hsid, intent });
      tracked = true;
      const s: LocalSession = { hsid, principalId, owner: req.principal, model, child: c, exited, spawnPermit: permit, turnPermits: [], state: 'running', turns: 0, seq: 0, meter: new LocalUsageMeter() };
      this.#sessions.set(hsid, s);
      live = s;
      this.#wire(s);
      await this.#o.log('session.sandbox', { hsid, sandbox: plan.sandbox, profile: 'session', profileHash: plan.profileHash, policyHash: policyHash(policy), backend: 'local', runner: runner.command, runnerEntry: runner.entry, runnerTree: pin.treeSha256, envKeys, permitId: permit.permitId }, { session: hsid });
      return { hsid, principalId, backend: 'local', state: s.state, model };
    } catch (err) {
      if (this.#platform === 'win32' && !live) {
        // W5: an open that failed before a live session undoes its win32 labels and grants
        try {
          releaseSession(sessionSidFor(hsid));
        } catch (e) {
          await this.#o.log('session.sandbox', { hsid, phase: 'release-failed', error: e instanceof Error ? e.message : String(e) }, { session: hsid }).catch(() => undefined);
        }
      }
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
    if (this.#platform === 'win32') {
      // W5: this session's win32 labels and grants (platform/win32/session-sandbox.ts releaseSession)
      try {
        releaseSession(sessionSidFor(s.hsid));
      } catch (err) {
        await this.#o.log('session.sandbox', { hsid: s.hsid, phase: 'session-grant-kept', error: err instanceof Error ? err.message : String(err) }, { session: s.hsid }).catch(() => undefined);
      }
    }
    for (const p of [s.spawnPermit.permitId, ...s.turnPermits]) await this.#o.fuse.release(p, s.owner).catch(() => undefined);
    s.turnPermits = [];
    this.#sessions.delete(s.hsid);
    this.#history.push({ hsid: s.hsid, principalId: s.principalId, backend: 'local', model: s.model, state: 'exited', turns: s.turns, code: s.child.exitCode, signal: s.child.signalCode });
    while (this.#history.length > HISTORY_CAP) this.#history.shift();
  }

  async #onLine(s: LocalSession, line: string): Promise<void> {
    const ev = parseLocalLine(line);
    const bytes = Buffer.byteLength(line);
    // S2: every driver event is a turn.event before anything acts on it
    await this.#o.log('turn.event', { hsid: s.hsid, type: ev.type, seq: ++s.seq, backend: 'local', ...(bytes > EVENT_LINE_CAP ? { lineHash: sha(line), bytes } : { line }), ...(ev.kind === 'compaction' && ev.summaryHash ? { summaryHash: ev.summaryHash, summaryBytes: ev.summaryBytes } : {}) }, { session: s.hsid });
    const usage = async (source: 'turn.usage' | 'turn.result', tokens: number, extra: Record<string, unknown> = {}): Promise<void> => {
      if (source === 'turn.usage' && tokens <= 0) return;
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
