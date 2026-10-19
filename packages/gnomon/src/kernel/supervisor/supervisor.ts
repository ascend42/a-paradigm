/**
 * @symbol #supervisor
 * @symbol #session-runner
 * @symbol #claude-adapter
 * @symbol ^subscription-only
 *
 * #supervisor + #session-runner (spec §3.3, §6.1, §5 verbs 2–4, §9.1
 * session.* / turn.*, §10 laws 1 and 7; M1.7 SLICE 1, round 2). The ONE
 * place a `claude -p` process is started. Slice 1 serves ATTENDED,
 * HUMAN-started Claude Code sessions only (an agent/session/unattended open
 * is refused FORBIDDEN; the scheduler's run step still refuses, M1.9).
 *
 * open(): session.open → the child env (allowlist + scrub, HOME forced to the
 *   scanned user home) → claude resolved by explicit path / known locations
 *   (never PATH) → PINNED + PRIVATELY COPIED (runner/binary.ts, Aegis H1: the
 *   pin is logged; a different hash is claude_binary_changed; the kernel only
 *   ever executes `<home>/bin/claude-<sha>`, which sessions cannot write) →
 *   policy (M1.5 SessionPolicy + the binary's paths/links/versions dir and the
 *   user persistence paths write-denied) → policy.json + mcp.json from the
 *   generated plugin bytes verified against the kernel-held record (T-008) →
 *   preflight `--version` / `auth status` run UNDER the session profile →
 *   layersHash/gitHash → LAW 7 per spawn (T-009/Aegis C5; a hit is
 *   billing.api.refused + session.refused{api_billing_refused},
 *   BILLING_REFUSED, before any permit) → permit.reserve{session.spawn,
 *   claude-code, kernelSpawn} → assertClaudePermit → profile plan → the
 *   layers re-hashed right before spawn (a change re-runs law 7) →
 *   children.intend (intent row BEFORE the fork) → spawn detached with the
 *   exit listener attached SYNCHRONOUSLY → children.track. One catch from the
 *   permit to track releases the permit, kills a stray child, removes the
 *   session dir and logs session.refused{code}.
 * stdout: every line is a `turn.event` BEFORE anything acts on it (S2) — a
 *   line over 64 KiB is logged as {lineHash, bytes}; while the log queue is
 *   above its high-water mark stdout is PAUSED (backpressure, Aegis M3).
 *   Usage only from stream events → turn.usage/turn.result → the fuse's
 *   recordStreamUsage against the SPAWN permit (no double count);
 *   `init.apiKeySource ≠ none` kills the group (absent is logged `absent`).
 * P8-D96 permission channel (permission.ts): each `can_use_tool` request is
 *   answered EXACTLY ONCE by the kernel. The card is raised inside the stdout
 *   queue; its decision is awaited OUTSIDE it (stdout keeps draining). The
 *   pending map (per session, ≤ MAX_PENDING_PERMISSIONS) holds the
 *   kernel-held input: `updatedInput` is always it, never a client's. Only an
 *   `allow` (permission) / `approve-plan` (plan) decision allows; no broker, a
 *   failed raise, expiry, cancel, a duplicate requestId (both denied +
 *   approval.suspect), session exit — all deny or answer nothing. A response
 *   is written only while the session runs, after session.inject{origin:
 *   'kernel', hash, bytes}. AskUserQuestion is auto-denied ("ask in your
 *   reply") with its turn.ask-user row; ExitPlanMode is a `plan` card with its
 *   turn.plan row; a write under denyWrite is denied with no card. An unknown
 *   control_request subtype gets an error response. The assistant tool_use
 *   path raises NO card (one card per request).
 * send(): a `turn` permit — the caller's (live, unexpired, subscription,
 *   claude-code, this session, never used before) or kernel-reserved — law 7
 *   re-run → session.inject{client} → turn.sent → the user line. Turn
 *   permits are FIFO: each result releases the head only.
 * stop(): `interrupt` = the control_request line only (A23-4); otherwise
 *   staged: control message → close stdin → SIGTERM → SIGKILL on the group.
 * exit (any time, also before #wire): watch cleared, every permit released,
 *   the session moves to a bounded history.
 * LOCAL (M1.8 slice 1): an open with model local|any or backend local goes to
 *   #local-runner's lane (local-session.ts) — routing, the fallback card, the
 *   local spawn; `any` routed to Claude comes back here. send/stop/status of
 *   a local hsid are the lane's.
 * Mid-session watch (G-SUB-05): every `watchMs` the layers are re-hashed —
 *   ~/.claude.json only through its law-7 projection, so Claude's routine
 *   rewrites never fire — a change logs session.layers.changed{which} and a
 *   law-7 hit stops the session. The non-law-7 change's gate-class card is
 *   slice 2.
 */
import { createHash, randomUUID } from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { hsidShort, mintHsid, refuse, RefusedError, turnId, type RefusalCode } from '@a-company/gnomon-contracts';
import type { DaemonChildren } from '../lifecycle/children.js';
import type { BudgetFuse, PermitV1 } from '../budget/fuse.js';
import type { ApprovalBroker } from '../broker/broker.js';
import { ALWAYS_ASK_TOOLS, buildSessionPolicy, claudePermissions, policyHash, realpathLoose, type PolicyPath, type SessionPolicy } from '../manifest/policy.js';
import { layersHash, gitHash, defaultClaudeJson } from '../manifest/layers.js';
import { verifiedGenerated } from '../manifest/generate.js';
import { ManifestRefusal } from '../manifest/refusal.js';
import { sessionLaunchPlan, sessionSandboxFidelity } from '../sandbox/session.js';
import { LifecycleRefusal } from '../lifecycle/refusal.js';
import { buildSessionEnv } from '../runner/env.js';
import { claudeAuthOk, claudeJsonProjection, claudeVersion, law7Layers, law7Scan, managedFiles, PreflightRefusal, realLoose, resolveClaudeBinary, type ClaudeRun, type Law7Input, type SessionRefusalCode } from '../runner/preflight.js';
import { commitPin, prepareClaude, readClaudePin } from '../runner/binary.js';
import { buildClaudeArgv, DEFAULT_SESSION_HOOKS, repoContextFor, settingSourcesFor, type SessionHooksMode, controlErrorLine, controlInterruptLine, LineSplitter, parseStreamLine, permissionAllowLine, permissionDenyLine, UsageMeter, userMessageLine, type AdapterEvent } from '../../adapters/claude-code/adapter.js';
import { answerFor, composePermission, MAX_PENDING_PERMISSIONS } from './permission.js';
import { claudeCodePlatform, type ClaudeCodePlatformRow } from '../../platform/claude-code.js';
import type { DarwinSessionExtras } from '../../platform/darwin/session-sbpl.js';
import { LocalLane, type LocalLaneOptions } from './local-session.js';
import { extractRepoHooks, hooksBlock, mergeHooks, MAX_PENDING_HOOK_CARDS, MAX_REFUSED_LOGGED, repoHookCard, type RepoHook } from './repo-hooks.js';
import { buildRepoContext, REPO_CONTEXT_ENV, repoContextLines, repoContextRow, repoSettingsInfo, repoSettingsLines, type RepoContext } from './repo-context.js';
import type { LocalLaneConfig } from '../local/config.js';

export const STDOUT_LINE_CAP = 4 * 1024 * 1024;
export const STDERR_CAP = 64 * 1024;
/** A turn.event carries the full line only up to this size; above it {lineHash, bytes} (Aegis M3). */
export const EVENT_LINE_CAP = 64 * 1024;
/** Backpressure: pause stdout above this many queued log writes, resume below the low mark. */
export const QUEUE_HIGH = 256;
export const QUEUE_LOW = 32;
export const HISTORY_CAP = 32;
/** the detector's per-session memory of tool_use ids (oldest forgotten first) */
export const TOOL_ID_CAP = 1024;
function bounded(m: Map<string, string>, k: string, v: string): void {
  m.set(k, v);
  while (m.size > TOOL_ID_CAP) m.delete(m.keys().next().value!);
}
function boundedSet(m: Set<string>, k: string): void {
  m.add(k);
  while (m.size > TOOL_ID_CAP) m.delete(m.values().next().value!);
}

export type SupervisorLog = (kind: string, payload: Record<string, unknown>, ids?: { session?: string }) => Promise<void>;

export interface SupervisorOptions {
  log: SupervisorLog;
  children: Pick<DaemonChildren, 'intend' | 'track' | 'stop'>;
  fuse: Pick<BudgetFuse, 'reserve' | 'release' | 'recordStreamUsage' | 'quotaError' | 'permit'>;
  /** P8-D96: decisionOf/expire/noteOf/suspect answer the permission channel; absent (or raise-only) ⇒ every request is denied */
  broker?: Pick<ApprovalBroker, 'raise'> & Partial<Pick<ApprovalBroker, 'decisionOf' | 'expire' | 'noteOf' | 'suspect'>>;
  /** the Gnomon home (session dirs, the claude pin and its private copy) */
  home: string;
  /** the user's home (the ~/.claude layers); the child's HOME is forced to it */
  userHome?: string;
  /** the kernel principal `p:<ns>/kernel` (session principals are `p:<ns>/s-<hsid-short>`) */
  kernelPrincipal: string;
  /** the kernel socket path handed to the child as GNOMON_SOCK */
  sock: string;
  /** the root-signed config's claude path; else the platform's known locations (never PATH) */
  claudePath?: string;
  /** the env the child's allowlist is read from (default process.env) */
  env?: () => Readonly<Record<string, string | undefined>>;
  endpointPort?: () => number | null;
  linkedFolders?: () => string[];
  platform?: string;
  /** whose hooks run (T-2026-10-18-010 L4, P8-D94): the root-signed `config.sessions.hooks` mode; default `audited` */
  hooksMode?: SessionHooksMode;
  /** P8-D94: the human's per-hook decisions for (repoKey, setHash), read back from KERNEL-signed gate-class.decided rows; absent ⇒ none (no repo hook runs) */
  repoHookDecisions?: (repoKey: string, setHash: string) => ReadonlyMap<string, 'allow' | 'deny'>;
  watchMs?: number;
  /** TEST RIG ONLY (the fake claude is a #! wrapper): accept a script binary. The daemon never sets it. */
  allowScripts?: boolean;
  /** TEST RIG ONLY: the OS version probe (default: the platform's sw_vers). Tests pass a LOWER version to exercise the floor refusal. */
  macosMajor?: () => number | null;
  /** TEST RIG ONLY: the SIP probe (default: the platform's csrutil). Tests pass false to exercise the SIP refusal, true to run the rig on a SIP-off host. */
  sipEnabled?: () => boolean | null;
  /** #local-runner (M1.8): the local lane's endpoints + runner; absent ⇒ model:local raises a fallback card */
  local?: LocalLaneConfig;
  /** TEST RIG ONLY: the local probe's fetch */
  localProbeFetch?: LocalLaneOptions['probeFetch'];
}

export interface OpenRequest {
  principal: string;
  principalClass: string;
  attended: boolean;
  cwd: string;
  worktree?: string;
  backend?: 'claude-code' | 'local';
  model?: string;
  systemPrompt?: string;
}

interface Session {
  hsid: string;
  principalId: string;
  owner: string;
  cwd: string;
  worktree?: string;
  child: ChildProcess;
  exited: Promise<void>;
  spawnPermit: PermitV1;
  /** FIFO: the head is the turn the next result closes */
  turnPermits: string[];
  watchHash: string;
  gitHash: string;
  layerInput: Law7Input;
  env: Record<string, string>;
  state: 'running' | 'stopping' | 'exited';
  turns: number;
  seq: number;
  meter: UsageMeter;
  stderrBytes: number;
  watch: NodeJS.Timeout | null;
  /** P8-D96: unanswered can_use_tool requests by requestId (bounded: MAX_PENDING_PERMISSIONS) */
  pending: Map<string, PendingPermission>;
  /** Aegis detector: tool names by tool_use id (assistant messages) and the ids a can_use_tool request named — both bounded */
  toolNames: Map<string, string>;
  requested: Set<string>;
  policy: SessionPolicy;
}

interface PendingPermission {
  cardId: string | null;
  cardKind: 'permission' | 'plan' | null;
  input: Record<string, unknown>;
  inputHash: string;
  toolName: string;
  toolUseId: string | null;
  /** why the entry was closed before its card existed (a cancel / duplicate / exit during the raise): the expire `why` */
  closedWhy?: string;
}

const WIRE: Record<SessionRefusalCode, RefusalCode> = {
  claude_version: 'UNSUPPORTED',
  not_subscription_auth: 'UNSUPPORTED',
  spawn_failed: 'UNSUPPORTED',
  claude_binary_changed: 'UNSUPPORTED',
  bad_message: 'BAD_REQUEST',
  session_busy: 'UNSUPPORTED',
  api_billing_refused: 'BILLING_REFUSED',
  claude_binary_unsupported: 'UNSUPPORTED',
};

function refused(code: RefusalCode, message: string, data: Record<string, unknown> = {}): RefusedError {
  return new RefusedError(refuse({ code, data }), `#supervisor: ${message}`);
}

const sha = (s: string | Buffer): string => `sha256:${createHash('sha256').update(s).digest('hex')}`;

/** Aegis H1: every path a session could use to swap the binary the kernel runs next — write-denied. */
export function binaryDenies(row: ClaudeCodePlatformRow, userHome: string, sourceReal: string, explicit?: string): PolicyPath[] {
  const expand = (p: string): string => (p.startsWith('~/') ? path.join(userHome, p.slice(2)) : p);
  const linkLiteral = (p: string): string => path.join(realpathLoose(path.dirname(p)), path.basename(p)); // the link itself, parent resolved
  const out: PolicyPath[] = [
    { path: realpathLoose(sourceReal), match: 'literal', class: 'binary' },
    { path: realpathLoose(path.dirname(sourceReal)), match: 'subpath', class: 'binary' },
  ];
  for (const c of [...row.knownBinaries.map(expand), ...(explicit ? [explicit] : [])]) {
    if (!path.isAbsolute(c)) continue;
    out.push({ path: linkLiteral(c), match: 'literal', class: 'binary' }, { path: realpathLoose(c), match: 'literal', class: 'binary' });
  }
  return out;
}

export class SessionSupervisor {
  readonly #o: SupervisorOptions;
  readonly #sessions = new Map<string, Session>();
  readonly #history: Array<Record<string, unknown>> = [];
  readonly #usedTurnPermits = new Set<string>();
  /** P8-D94: raised, undecided repo-hook cards by repoKey|setHash|hookId (bounded: MAX_PENDING_HOOK_CARDS) */
  readonly #pendingHookCards = new Map<string, string>();
  readonly #platform: string;
  readonly #local: LocalLane;

  constructor(o: SupervisorOptions) {
    this.#o = o;
    this.#platform = o.platform ?? process.platform;
    this.#local = new LocalLane({
      log: o.log, children: o.children, fuse: o.fuse, ...(o.broker ? { broker: o.broker } : {}), home: o.home, ...(o.userHome ? { userHome: o.userHome } : {}),
      kernelPrincipal: o.kernelPrincipal, sock: o.sock, ...(o.env ? { env: o.env } : {}), ...(o.endpointPort ? { endpointPort: o.endpointPort } : {}),
      ...(o.linkedFolders ? { linkedFolders: o.linkedFolders } : {}), platform: this.#platform, ...(o.macosMajor ? { macosMajor: o.macosMajor } : {}),
      ...(o.sipEnabled ? { sipEnabled: o.sipEnabled } : {}), ...(o.local ? { config: o.local } : {}), ...(o.localProbeFetch ? { probeFetch: o.localProbeFetch } : {}),
    });
  }

  #principalFor(hsid: string): string {
    const ns = this.#o.kernelPrincipal.replace(/\/kernel$/, '');
    return `${ns}/s-${hsidShort(hsid)}`;
  }

  async #refuse(hsid: string | null, code: SessionRefusalCode, message: string, data: Record<string, unknown> = {}): Promise<never> {
    await this.#o.log('session.refused', { hsid, code, ...data }, hsid ? { session: hsid } : {}).catch(() => undefined);
    throw refused(WIRE[code], message, { session: code, ...data });
  }

  /** Aegis (M1.7): claude never starts without a live, law-7-scanned claude-code session.spawn permit for this hsid. */
  assertClaudePermit(permit: PermitV1, hsid: string): void {
    const live = this.#o.fuse.permit(permit.permitId);
    if (live !== permit && JSON.stringify(live) !== JSON.stringify(permit)) throw refused('PERMIT_REQUIRED', 'the permit is not one the fuse granted', {});
    if (permit.kind !== 'session.spawn' || permit.backend !== 'claude-code' || permit.hsid !== hsid) {
      throw refused('PERMIT_REQUIRED', 'claude runs only under a claude-code session.spawn permit for this session (S8)', { kind: permit.kind, backend: permit.backend });
    }
    if (Date.parse(permit.expiresAt) <= Date.now()) throw refused('PERMIT_REQUIRED', 'the spawn permit expired', {});
  }

  #watchHashOf(inp: Law7Input): string {
    const roots = [inp.cwd, ...(inp.worktree ? [inp.worktree] : [])];
    const l = layersHash({ cwd: inp.cwd, ...(inp.worktree ? { worktree: inp.worktree } : {}), userClaudeDir: inp.userClaudeDir, managedPaths: managedFiles(inp.row), excludeClaudeJson: true });
    const cj = claudeJsonProjection(inp.userClaudeJson, roots.flatMap((r) => [path.resolve(r), realLoose(r)]));
    return `${l}|${cj}`;
  }

  async open(req: OpenRequest): Promise<{ hsid: string; principalId: string; backend: 'claude-code' | 'local'; state: string; binaryPin?: string; model?: string }> {
    if (req.principalClass !== 'human' || req.attended !== true) {
      throw refused('FORBIDDEN', 'M1.7 slice 1 opens attended, human-started sessions only (agent/session/unattended opens wait for the broker decision, law 5)', { principalClass: req.principalClass });
    }
    // an explicit backend pins the route: claude-code never spawns gnomon-local (model local + claude-code ⇒ BAD_REQUEST in the lane)
    if (req.backend === 'local' || req.model === 'local' || (req.model === 'any' && req.backend !== 'claude-code')) {
      // §13.3: local ⇒ capable local or a fallback card; any ⇒ local if capable, else (null) Claude below
      const local = await this.#local.open(req, (r) => this.open(r));
      if (local) return local;
    }
    if (typeof req.cwd !== 'string' || !path.isAbsolute(req.cwd) || !fs.existsSync(req.cwd) || !fs.statSync(req.cwd).isDirectory()) {
      throw refused('BAD_REQUEST', 'cwd must be an existing absolute directory', { reason: 'bad-params' });
    }
    const hsid = mintHsid();
    const principalId = this.#principalFor(hsid);
    const uuid = randomUUID();
    const userHome = this.#o.userHome ?? os.homedir();
    await this.#o.log('session.open', { hsid, principalId, by: req.principal, cwd: req.cwd, worktree: req.worktree ?? null, backend: 'claude-code', model: req.model ?? 'claude', attended: true, uuid }, { session: hsid });
    const row = claudeCodePlatform(this.#platform);
    if (!row) return this.#refuse(hsid, 'spawn_failed', `no Claude Code platform row for ${this.#platform}`);
    const dir = path.join(this.#o.home, 'sessions', hsidShort(hsid));
    // reviewer 9: the child's HOME IS the user home whose layers were scanned
    const { env, envKeys } = buildSessionEnv({ from: { ...(this.#o.env?.() ?? process.env), HOME: userHome }, hsid, sock: this.#o.sock, sessionKeyPath: path.join(dir, 'session.key'), ...(repoContextFor(this.#o.hooksMode ?? DEFAULT_SESSION_HOOKS) ? { inject: REPO_CONTEXT_ENV } : {}) });
    let permit: PermitV1 | null = null;
    let child: ChildProcess | null = null;
    let tracked = false;
    let live: Session | null = null;
    try {
      const bin = resolveClaudeBinary({ ...(this.#o.claudePath ? { explicit: this.#o.claudePath } : {}), row, home: userHome });
      const priv = await prepareClaude(this.#o.home, bin.real, { allowScripts: this.#o.allowScripts === true });
      const userClaudeDir = path.join(userHome, row.userClaudeDir);
      const userClaudeJson = defaultClaudeJson(userClaudeDir);
      const managed = managedFiles(row);
      const generated = verifiedGenerated(req.cwd, { home: this.#o.home });
      const policy: SessionPolicy = buildSessionPolicy({
        home: this.#o.home,
        cwd: req.cwd,
        ...(req.worktree ? { worktree: req.worktree } : {}),
        userClaudeDir,
        userClaudeJson,
        userHome,
        managedSettingsPaths: managed,
        linkedFolders: this.#o.linkedFolders?.() ?? [],
        endpointPort: this.#o.endpointPort?.() ?? null,
        extraDenyWrite: binaryDenies(row, userHome, bin.real, this.#o.claudePath),
        // round 3 (Aegis H1): a Claude session can no more swap the local runner's node or source than a local one
        ...(this.#o.local?.runner ? { localRunner: { node: this.#o.local.runner.node, dir: this.#o.local.runner.dir } } : {}),
        // T-2026-10-18-010: the home is read-denied; only this session's dir and the private copy it execs are readable
        homeReadable: [{ path: dir, match: 'subpath' }, { path: priv.exec, match: 'literal' }],
      });
      const parse = (rel: string): Record<string, unknown> => {
        const b = generated?.get(rel);
        if (!b) return {};
        try {
          return JSON.parse(b.toString('utf8')) as Record<string, unknown>;
        } catch {
          return {};
        }
      };
      const hooksJson = parse('.gnomon/generated/hooks.json');
      const mcpJson = parse('.gnomon/generated/.mcp.json');
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
      const policyPath = path.join(dir, 'policy.json');
      const mcpConfigPath = path.join(dir, 'mcp.json');
      const hooksMode = this.#o.hooksMode ?? DEFAULT_SESSION_HOOKS;
      // P8-D97: the repo's CLAUDE.md dirs and a kernel-staged plugin of its skills/agents/commands (hooks stripped)
      let repoCtx: RepoContext | null = null;
      if (repoContextFor(hooksMode)) {
        repoCtx = buildRepoContext({ cwd: req.cwd, userHome, outDir: path.join(dir, 'context') });
        await this.#o.log('gate-class.detected', repoContextRow(hsid, repoCtx, repoSettingsInfo([req.cwd, ...(req.worktree ? [req.worktree] : [])])), { session: hsid });
      }
      // P8-D94: in `audited` mode only the repo hooks the human approved reach Claude, through policy.json
      const approved = hooksMode === 'audited' ? await this.#auditRepoHooks(hsid, req, repoCtx ? repoContextLines(repoCtx) : []) : [];
      const hooks = approved.length ? mergeHooks(hooksJson.hooks, hooksBlock(approved)) : hooksJson.hooks;
      fs.writeFileSync(policyPath, `${JSON.stringify({ ...claudePermissions(policy), ...(hooks ? { hooks } : {}) }, null, 2)}\n`, { mode: 0o600 });
      fs.writeFileSync(mcpConfigPath, `${JSON.stringify({ mcpServers: (mcpJson.mcpServers as Record<string, unknown> | undefined) ?? {} }, null, 2)}\n`, { mode: 0o600 });
      const extras: DarwinSessionExtras = { uid: process.getuid?.() ?? 0, tmpdir: os.tmpdir(), home: userHome, roots: [req.cwd, ...(req.worktree ? [req.worktree] : [])] };
      // Aegis H1: preflight runs the PRIVATE copy under the session profile, never unsandboxed
      const run: ClaudeRun = (args) =>
        new Promise((resolve) => {
          const p = sessionLaunchPlan({ policy, binaryReal: priv.exec, argv: args, extras }, this.#platform, this.#o.macosMajor, this.#o.sipEnabled);
          const ch = spawn(p.command, p.args, { cwd: req.cwd, env, stdio: ['ignore', 'pipe', 'ignore'] });
          let stdout = '';
          const t = setTimeout(() => ch.kill('SIGKILL'), 15_000);
          ch.stdout?.setEncoding('utf8');
          ch.stdout?.on('data', (d: string) => {
            if (stdout.length < 1 << 20) stdout += d;
          });
          ch.once('error', () => {
            clearTimeout(t);
            resolve({ status: null, stdout });
          });
          ch.once('close', (code) => {
            clearTimeout(t);
            resolve({ status: code, stdout });
          });
        });
      const version = await claudeVersion(run);
      await claudeAuthOk(run);
      // Aegis N1: trust on first use — the pin is written only after the sandboxed preflight passed
      commitPin(this.#o.home, priv);
      await this.#o.log('session.sandbox', { hsid, phase: 'binary-pin', pin: priv.pin, by: priv.pin === 'repin' ? 'repin' : priv.pin === 'first-use' ? 'first-use' : 'pinned', ...(priv.repin ? { from: priv.repin.from, to: priv.repin.to } : {}), binarySha256: `sha256:${priv.sha256}`, source: bin.real }, { session: hsid });
      // Aegis L1: hash first, then scan; re-checked right before the spawn
      const layerInput: Law7Input = { row, cwd: req.cwd, ...(req.worktree ? { worktree: req.worktree } : {}), userClaudeDir, userClaudeJson, policyPath, mcpConfigPath };
      const lHash = layersHash({ cwd: req.cwd, ...(req.worktree ? { worktree: req.worktree } : {}), userClaudeDir, managedPaths: managed, userClaudeJson });
      const gHash = gitHash(req.worktree ?? req.cwd);
      let wHash = this.#watchHashOf(layerInput);
      const scan = async (): Promise<void> => {
        const hits = law7Scan(env, law7Layers(layerInput));
        if (!hits.length) return;
        await this.#o.log('billing.api.refused', { hsid, where: hits.map((h) => h.where), keys: hits.map((h) => h.key) }, { session: hsid }).catch(() => undefined);
        throw new PreflightRefusal('api_billing_refused', 'an API-billing path is set in a layer this session would read (law 7)', { hits: hits.map((h) => ({ where: h.where, key: h.key })) });
      };
      await scan();
      try {
        permit = await this.#o.fuse.reserve({ principal: req.principal, principalClass: req.principalClass, attended: true, kind: 'session.spawn', backend: 'claude-code', model: req.model ?? 'claude', scope: { user: req.principal, session: hsid }, kernelSpawn: { hsid } });
      } catch (err) {
        if (err instanceof RefusedError && err.refusal.code === 'BILLING_REFUSED') throw new PreflightRefusal('api_billing_refused', err.message, { where: 'fuse' });
        throw err;
      }
      this.assertClaudePermit(permit, hsid);
      if (permit.billing !== 'subscription') throw new PreflightRefusal('api_billing_refused', 'api-token billing is not wired into the session spawn yet (M1.7 slice 2)', { billing: permit.billing });
      const settingSources = settingSourcesFor(hooksMode);
      const argv = buildClaudeArgv({ uuid, policyPath, mcpConfigPath, settingSources, ...(repoCtx ? { pluginDirs: repoCtx.pluginDir ? [repoCtx.pluginDir] : [], addDirs: repoCtx.memoryDirs } : {}), ...(req.systemPrompt !== undefined ? { appendSystemPrompt: req.systemPrompt } : {}), ...(req.model && req.model !== 'claude' && req.model !== 'any' ? { model: req.model } : {}) });
      const plan = sessionLaunchPlan({ policy, binaryReal: priv.exec, argv, extras }, this.#platform, this.#o.macosMajor, this.#o.sipEnabled);
      // Aegis L1: anything changed between the scan and now ⇒ scan again (a hit refuses)
      const wNow = this.#watchHashOf(layerInput);
      if (wNow !== wHash || gitHash(req.worktree ?? req.cwd) !== gHash) {
        await this.#o.log('session.layers.changed', { hsid, which: ['settings-or-git'], phase: 'pre-spawn' }, { session: hsid });
        await scan();
        wHash = wNow;
      }
      const intent = await this.#o.children.intend({ kind: 'session', hsid });
      child = spawn(plan.command, plan.args, { cwd: req.cwd, env, detached: true, stdio: ['pipe', 'pipe', 'pipe'] });
      // the exit/close listeners are attached SYNCHRONOUSLY, before any await. 'exit' only lets paused stdout
      // drain; the release path runs on 'close' (after stdout ended), so a result written just before exit is recorded
      const c = child;
      c.once('exit', () => {
        if (c.stdout?.isPaused()) c.stdout.resume();
      });
      const exited = new Promise<void>((r) => c.once('close', () => r()));
      const spawnError = await new Promise<Error | null>((resolve) => {
        c.once('error', (e) => resolve(e));
        c.once('spawn', () => resolve(null));
      });
      if (spawnError) throw new PreflightRefusal('spawn_failed', `spawn failed: ${spawnError.message}`);
      await this.#o.children.track({ kind: 'session', child: c, hsid, intent });
      tracked = true;
      const s: Session = {
        hsid, principalId, owner: req.principal, cwd: req.cwd, ...(req.worktree ? { worktree: req.worktree } : {}), child: c, exited, spawnPermit: permit, turnPermits: [],
        watchHash: wHash, gitHash: gHash, layerInput, env, state: 'running', turns: 0, seq: 0, meter: new UsageMeter(), stderrBytes: 0, watch: null, pending: new Map(), toolNames: new Map(), requested: new Set(), policy,
      };
      this.#sessions.set(hsid, s);
      live = s;
      this.#wire(s); // round 3: wired BEFORE any further await — a failing row below still cleans up through the exit path
      await this.#o.log('session.sandbox', {
        hsid, sandbox: plan.sandbox, profile: 'session', profileHash: plan.profileHash, policyHash: policyHash(policy), layersHash: lHash, gitHash: gHash,
        binarySha256: `sha256:${priv.sha256}`, exec: priv.exec, version, envKeys, hooksMode, settingSources: [...settingSources], repoHooksApproved: approved.map((h) => h.hookId), permitId: permit.permitId, generated: generated ? [...generated.keys()] : [],
      }, { session: hsid });
      return { hsid, principalId, backend: 'claude-code', state: s.state, ...(priv.pin === 'first-use' ? { binaryPin: `first-use pin ${priv.sha256} from ${priv.source}` } : {}) };
    } catch (err) {
      if (tracked && child) {
        // round 3: a failure after track — stop the group; the wired exit path releases the permits
        await this.#o.children.stop(child, 'open-failed').catch(() => undefined);
        if (live) await live.exited.catch(() => undefined);
      }
      if (!tracked) {
        // reviewer 6: one path from reserve to track — nothing leaks
        if (child?.pid !== undefined && child.exitCode === null && child.signalCode === null) {
          try {
            process.kill(-child.pid, 'SIGKILL'); // round 3: the whole group, not just the leader
          } catch {
            child.kill('SIGKILL');
          }
        }
        if (permit) await this.#o.fuse.release(permit.permitId, permit.principal).catch(() => undefined);
        fs.rmSync(dir, { recursive: true, force: true });
      }
      if (err instanceof PreflightRefusal) return this.#refuse(hsid, err.code, err.message, err.data);
      if (err instanceof LifecycleRefusal) return this.#refuse(hsid, 'spawn_failed', err.message, { sandbox: 'unavailable', ...err.detail });
      if (err instanceof ManifestRefusal || err instanceof TypeError) return this.#refuse(hsid, 'spawn_failed', err.message);
      if (err instanceof RefusedError) {
        await this.#o.log('session.refused', { hsid, code: 'spawn_failed', refusal: err.refusal.code }, { session: hsid }).catch(() => undefined);
        throw err;
      }
      return this.#refuse(hsid, 'spawn_failed', (err as Error).message);
    }
  }

  /**
   * P8-D94: extract the repo's hooks, apply the human's per-hook decisions pinned to this set's hash, and raise one
   * gate-class card per undecided hook. Returns the approved hooks only. Fail closed: no decision source, an
   * unreadable or oversized set, a refused hook or a failed raise ⇒ that hook (or the set) does not run.
   */
  async #auditRepoHooks(hsid: string, req: OpenRequest, contextLines: readonly string[] = []): Promise<RepoHook[]> {
    const roots = [req.cwd, ...(req.worktree ? [req.worktree] : [])];
    const set = extractRepoHooks(roots);
    if (set.status === 'none') return [];
    if (set.status !== 'ok') {
      await this.#o.log('gate-class.detected', { what: 'repo-hooks', hsid, repoKey: set.repoKey, status: set.status, why: set.why, run: 0 }, { session: hsid });
      return [];
    }
    const decided = this.#o.repoHookDecisions?.(set.repoKey, set.setHash) ?? new Map<string, 'allow' | 'deny'>();
    const approved = set.hooks.filter((h) => decided.get(h.hookId) === 'allow');
    const pending = set.hooks.filter((h) => !decided.has(h.hookId));
    const cards: string[] = [];
    for (const h of pending) {
      const key = `${set.repoKey}|${set.setHash}|${h.hookId}`;
      const open = this.#pendingHookCards.get(key);
      if (open) {
        cards.push(open);
        continue;
      }
      if (!this.#o.broker) continue;
      const c = repoHookCard(set, h, roots.join(' + '), [...repoSettingsLines(repoSettingsInfo(roots)), ...contextLines]);
      try {
        const card = await this.#o.broker.raise({
          kind: 'gate-class', requestedBy: this.#o.kernelPrincipal, hsid, attended: true, detail: c.detail, lines: c.lines, block: c.block,
          effect: async (decision) => {
            this.#pendingHookCards.delete(key);
            // only an explicit allow or deny is recorded: any other outcome (withdraw) leaves the hook undecided (re-raised next open)
            if (decision !== 'allow' && decision !== 'deny') return;
            await this.#o.log('gate-class.decided', { what: 'repo-hook', repoKey: set.repoKey, setHash: set.setHash, hookId: h.hookId, decision });
          },
        });
        this.#pendingHookCards.set(key, card.cardId);
        while (this.#pendingHookCards.size > MAX_PENDING_HOOK_CARDS) this.#pendingHookCards.delete(this.#pendingHookCards.keys().next().value!);
        cards.push(card.cardId);
      } catch {
        /* fail closed: the hook stays unapproved; the next open raises again */
      }
    }
    await this.#o.log('gate-class.detected', {
      what: 'repo-hooks', hsid, repoKey: set.repoKey, setHash: set.setHash, status: 'ok', hooks: set.hooks.length, refused: set.refused.slice(0, MAX_REFUSED_LOGGED), refusedCount: set.refused.length,
      approved: approved.map((h) => h.hookId), denied: set.hooks.filter((h) => decided.get(h.hookId) === 'deny').map((h) => h.hookId), pending: pending.map((h) => h.hookId), cards, run: approved.length,
    }, { session: hsid });
    return approved;
  }

  #wire(s: Session): void {
    const split = new LineSplitter(STDOUT_LINE_CAP);
    let chain: Promise<void> = Promise.resolve();
    let pending = 0;
    const out = s.child.stdout;
    const queue = (f: () => Promise<void>): void => {
      pending++;
      const exitedNow = s.child.exitCode !== null || s.child.signalCode !== null; // after exit, never pause: the pipe must drain
      if (pending > QUEUE_HIGH && out && !out.isPaused() && !exitedNow) out.pause(); // Aegis M3: backpressure
      chain = chain
        .then(f)
        .catch(() => undefined)
        .then(() => {
          pending--;
          if (pending < QUEUE_LOW && out?.isPaused() && s.state !== 'exited') out.resume();
        });
    };
    out?.setEncoding('utf8');
    out?.on('data', (chunk: string) => {
      split.push(chunk, (line) => queue(() => this.#onLine(s, line)), (bytes) => queue(() => this.#o.log('turn.event', { hsid: s.hsid, type: 'dropped', bytes, seq: ++s.seq }, { session: s.hsid })));
    });
    s.child.stderr?.on('data', (b: Buffer) => {
      s.stderrBytes += b.length; // capped: counted, never buffered
    });
    s.child.stdin?.on('error', () => undefined);
    void s.exited.then(() => queue(() => this.#onExit(s)));
    const ms = this.#o.watchMs ?? 500;
    s.watch = setInterval(() => queue(() => this.#watch(s)), ms);
    s.watch.unref();
  }

  async #onExit(s: Session): Promise<void> {
    if (s.state === 'exited') return;
    s.state = 'exited';
    if (s.watch) clearInterval(s.watch);
    s.watch = null;
    await this.#expirePending(s, 'session-exited');
    for (const p of [s.spawnPermit.permitId, ...s.turnPermits]) await this.#o.fuse.release(p, s.owner).catch(() => undefined);
    s.turnPermits = [];
    if (s.stderrBytes > STDERR_CAP) await this.#o.log('turn.event', { hsid: s.hsid, type: 'stderr.capped', bytes: s.stderrBytes, seq: ++s.seq }, { session: s.hsid }).catch(() => undefined);
    this.#sessions.delete(s.hsid);
    this.#history.push({ hsid: s.hsid, principalId: s.principalId, state: 'exited', turns: s.turns, code: s.child.exitCode, signal: s.child.signalCode });
    while (this.#history.length > HISTORY_CAP) this.#history.shift();
  }

  async #onLine(s: Session, line: string): Promise<void> {
    const ev = parseStreamLine(line);
    const bytes = Buffer.byteLength(line);
    // S2: every driver event is a turn.event before anything acts on it; big lines by hash (Aegis M3)
    await this.#o.log('turn.event', {
      hsid: s.hsid, type: ev.type, seq: ++s.seq,
      // Aegis A4: a control_request line (can_use_tool carries the tool input) is logged by hash only, never its text
      ...(bytes > EVENT_LINE_CAP || ev.type.startsWith('control_request') ? { lineHash: sha(line), bytes } : { line }),
      ...(ev.kind === 'init' ? { apiKeySource: ev.apiKeySource ?? 'absent' } : {}),
    }, { session: s.hsid });
    const usage = async (source: 'turn.usage' | 'turn.result', tokens: number, extra: Record<string, unknown> = {}): Promise<void> => {
      if (source === 'turn.usage' && tokens <= 0) return;
      await this.#o.log(source, { hsid: s.hsid, usage: { tokens }, ...extra }, { session: s.hsid });
      await this.#o.fuse.recordStreamUsage({ source, permitId: s.spawnPermit.permitId, hsid: s.hsid, tokens });
    };
    switch (ev.kind) {
      case 'init':
        if (ev.apiKeySource !== null && ev.apiKeySource !== 'none') {
          await this.#o.log('billing.api.refused', { hsid: s.hsid, where: ['init.apiKeySource'], keys: [ev.apiKeySource] }, { session: s.hsid });
          await this.#stopSession(s, 'api-key-source');
        }
        return;
      case 'partial':
        await this.#o.log('turn.partial', { hsid: s.hsid, bytes: ev.bytes }, { session: s.hsid });
        if (ev.usage) await usage('turn.usage', s.meter.message(ev.usage.messageId, ev.usage.tokens));
        return;
      case 'message':
        for (const t of ev.toolUses) if (t.id !== null) bounded(s.toolNames, t.id, t.name);
        if (ev.tokens !== null) await usage('turn.usage', s.meter.message(ev.messageId, ev.tokens));
        if (ev.quota) await this.#o.fuse.quotaError(s.hsid);
        return;
      case 'result': {
        await usage('turn.result', s.meter.result(ev.tokens), { cost: ev.costUsd, permission_denials: ev.permissionDenials, subtype: ev.subtype, isError: ev.isError });
        const head = s.turnPermits.shift(); // reviewer 7: FIFO — this result closes the oldest turn only
        if (head) await this.#o.fuse.release(head, s.owner).catch(() => undefined);
        if (ev.quota) await this.#o.fuse.quotaError(s.hsid);
        return;
      }
      case 'permission-request':
        if (ev.toolUseId !== null) boundedSet(s.requested, ev.toolUseId);
        await this.#onPermission(s, ev);
        return;
      case 'user':
        // Aegis detector: a gated tool that ran (Claude accepted it, or it did not error) with no can_use_tool request
        for (const r of ev.toolResults) {
          const tool = s.toolNames.get(r.toolUseId);
          if (!tool || !(ALWAYS_ASK_TOOLS as readonly string[]).includes(tool) || s.requested.has(r.toolUseId)) continue;
          if (r.decision === 'accept' || (r.decision === null && !r.isError)) {
            await this.#o.broker?.suspect?.('ungated-tool-use', { hsid: s.hsid, tool, toolUseId: r.toolUseId, decision: r.decision }, s.hsid).catch(() => undefined);
          }
        }
        return;
      case 'permission-malformed': {
        // Aegis A5: a good id with a bad body is denied, never left hanging; one pending under that id is denied with it
        const dup = s.pending.get(ev.requestId);
        if (dup) {
          s.pending.delete(ev.requestId);
          dup.closedWhy = 'duplicate-request-id';
          await this.#o.broker?.suspect?.('duplicate-request-id', { hsid: s.hsid, requestId: ev.requestId, cardId: dup.cardId }, s.hsid).catch(() => undefined);
          if (dup.cardId) await this.#o.broker?.expire?.(dup.cardId, 'duplicate-request-id').catch(() => false);
        }
        await this.#write(s, permissionDenyLine(ev.requestId, 'Denied: the permission request was malformed.'), { answer: 'deny', requestId: ev.requestId, why: 'malformed' });
        return;
      }
      case 'malformed':
        // Aegis A5: a can_use_tool line whose id cannot be answered
        if (ev.type === 'control_request.can_use_tool') await this.#o.broker?.suspect?.('malformed-permission-request', { hsid: s.hsid, bytes: ev.bytes }, s.hsid).catch(() => undefined);
        return;
      case 'control-cancel': {
        const e = s.pending.get(ev.requestId);
        if (!e) return; // an unknown requestId is never answered
        s.pending.delete(ev.requestId);
        e.closedWhy = 'cancelled';
        if (e.cardId) await this.#o.broker?.expire?.(e.cardId, 'cancelled').catch(() => false);
        return;
      }
      case 'control-request-unknown':
        if (ev.requestId !== null) await this.#write(s, controlErrorLine(ev.requestId, `unsupported control request: ${ev.subtype.slice(0, 64)}`), { answer: 'error', requestId: ev.requestId });
        return;
      default:
        return; // user replays, control responses, unknown types and malformed lines: logged above, never acted on
    }
  }

  /** P8-D96: one can_use_tool request (inside the stdout queue; the decision is awaited OUTSIDE it). */
  async #onPermission(s: Session, ev: Extract<AdapterEvent, { kind: 'permission-request' }>): Promise<void> {
    const { requestId } = ev;
    const dup = s.pending.get(requestId);
    if (dup) {
      // a requestId reused while pending: deny both, never pick one
      s.pending.delete(requestId);
      dup.closedWhy = 'duplicate-request-id';
      await this.#o.broker?.suspect?.('duplicate-request-id', { hsid: s.hsid, requestId, cardId: dup.cardId }, s.hsid).catch(() => undefined);
      if (dup.cardId) await this.#o.broker?.expire?.(dup.cardId, 'duplicate-request-id').catch(() => false);
      await this.#write(s, permissionDenyLine(requestId, 'Denied: the permission request id was reused.'), { answer: 'deny', requestId, why: 'duplicate-request-id' });
      return;
    }
    const repo = s.worktree ?? s.cwd;
    const plan = composePermission(ev, { repo, denyWrite: s.policy.denyWrite });
    if (ev.toolName === 'AskUserQuestion') await this.#o.log('turn.ask-user', { hsid: s.hsid, toolUseId: ev.toolUseId, inputHash: plan.inputHash, cardId: null, requestId, answer: 'deny' }, { session: s.hsid });
    if (plan.kind === 'auto-deny') {
      await this.#write(s, permissionDenyLine(requestId, plan.message), { answer: 'deny', requestId, why: plan.why, ...(plan.denyClass ? { denyClass: plan.denyClass } : {}) });
      return;
    }
    const b = this.#o.broker;
    if (!b || typeof b.decisionOf !== 'function' || s.pending.size >= MAX_PENDING_PERMISSIONS) {
      await this.#write(s, permissionDenyLine(requestId, 'Denied: no approval surface could take this request.'), { answer: 'deny', requestId, why: !b || typeof b.decisionOf !== 'function' ? 'no-broker' : 'pending-cap' });
      return;
    }
    const entry: PendingPermission = { cardId: null, cardKind: plan.cardKind, input: structuredClone(ev.input), inputHash: plan.inputHash, toolName: ev.toolName, toolUseId: ev.toolUseId };
    s.pending.set(requestId, entry);
    let cardId: string;
    try {
      const card = await b.raise({ kind: plan.cardKind, requestedBy: s.principalId, hsid: s.hsid, attended: true, detail: plan.detail, lines: plan.lines, block: plan.block, toolInput: ev.input, tool: ev.toolName, decisions: plan.decisions as never });
      cardId = card.cardId;
    } catch {
      await this.#respond(s, requestId, 'deny'); // a raise that throws ⇒ deny
      return;
    }
    if (s.pending.get(requestId) !== entry) {
      // answered (duplicate, exit) while the raise was in flight: the card must not stay decidable
      await b.expire?.(cardId, entry.closedWhy ?? 'answered').catch(() => false);
      return;
    }
    entry.cardId = cardId;
    if (plan.cardKind === 'plan') await this.#o.log('turn.plan', { hsid: s.hsid, toolUseId: ev.toolUseId, inputHash: plan.inputHash, cardId, requestId }, { session: s.hsid });
    void b.decisionOf(cardId).then(
      (d) => this.#respond(s, requestId, d, entry),
      () => this.#respond(s, requestId, 'deny', entry),
    ).catch(() => undefined);
  }

  /** Answer a pending request exactly once: the entry is deleted FIRST; written only while the session runs. */
  async #respond(s: Session, requestId: string, decision: string, expect?: PendingPermission): Promise<void> {
    const e = s.pending.get(requestId);
    if (!e || (expect && e !== expect)) return;
    s.pending.delete(requestId);
    const a = e.cardKind ? answerFor(e.cardKind, decision, e.cardId ? this.#o.broker?.noteOf?.(e.cardId) : undefined) : { behavior: 'deny' as const, message: 'Denied.' };
    const line = a.behavior === 'allow' ? permissionAllowLine(requestId, e.input) : permissionDenyLine(requestId, a.message);
    await this.#write(s, line, { answer: a.behavior, requestId, cardId: e.cardId, decision });
  }

  /** session.inject{origin:'kernel'} (a byte COUNT and a hash, never the text), then the line — only while running. */
  async #write(s: Session, line: string, meta: Record<string, unknown>): Promise<void> {
    if (s.state !== 'running') return;
    await this.#o.log('session.inject', { hsid: s.hsid, origin: 'kernel', hash: sha(line), bytes: Buffer.byteLength(line, 'utf8'), channel: 'permission', ...meta }, { session: s.hsid });
    if (s.state !== 'running' || s.child.exitCode !== null || s.child.signalCode !== null) return;
    s.child.stdin?.write(line);
  }

  /** Session exit or stop: every pending card expires into deny; nothing is written. */
  async #expirePending(s: Session, why: string): Promise<void> {
    const all = [...s.pending.values()];
    s.pending.clear();
    for (const e of all) e.closedWhy = why;
    for (const e of all) if (e.cardId) await this.#o.broker?.expire?.(e.cardId, why).catch(() => false);
  }

  async #watch(s: Session): Promise<void> {
    if (s.state !== 'running') return;
    const w = this.#watchHashOf(s.layerInput);
    const g = gitHash(s.worktree ?? s.cwd);
    const which = [...(w !== s.watchHash ? ['settings'] : []), ...(g !== s.gitHash ? ['git'] : [])];
    if (!which.length) return;
    s.watchHash = w;
    s.gitHash = g;
    await this.#o.log('session.layers.changed', { hsid: s.hsid, which }, { session: s.hsid });
    const hits = law7Scan(s.env, law7Layers(s.layerInput));
    if (hits.length) {
      await this.#o.log('billing.api.refused', { hsid: s.hsid, where: hits.map((h) => h.where), keys: hits.map((h) => h.key), midSession: true }, { session: s.hsid });
      await this.#stopSession(s, 'law-7-layer-changed');
    }
  }

  #get(principal: string, hsid: unknown): Session {
    const s = typeof hsid === 'string' ? this.#sessions.get(hsid) : undefined;
    if (!s || s.owner !== principal) throw refused('NOT_FOUND', 'no such session for this principal', { reason: 'not-found' });
    return s;
  }

  async send(principal: string, p: { hsid: string; text: string; permitId?: string; steer?: boolean }): Promise<{ turn: string; steered?: boolean }> {
    if (this.#local.has(p.hsid)) return this.#local.send(principal, p);
    const s = this.#get(principal, p.hsid);
    // M1.8 slice 2 serves steer on local sessions only; Claude's mid-turn steer is not built (refused, never ignored)
    if (p.steer === true) throw refused('BAD_REQUEST', 'session.send{steer} is served for local sessions only', { reason: 'bad-params' });
    if (s.state !== 'running' || s.child.exitCode !== null || s.child.signalCode !== null) throw refused('NOT_FOUND', 'the session is not running', { reason: 'not-found' });
    if (typeof p.text !== 'string' || p.text.length === 0) throw refused('BAD_REQUEST', 'send takes non-empty text', { reason: 'bad-params' });
    const hits = law7Scan(s.env, law7Layers(s.layerInput));
    if (hits.length) {
      await this.#o.log('billing.api.refused', { hsid: s.hsid, where: hits.map((h) => h.where), keys: hits.map((h) => h.key) }, { session: s.hsid });
      throw refused('BILLING_REFUSED', 'an API-billing path appeared in a layer this session reads (law 7)', { session: 'api_billing_refused' });
    }
    // round 3: prune used ids whose permits have expired (an expired permit is refused by the checks below anyway)
    for (const id of this.#usedTurnPermits) {
      const u = this.#o.fuse.permit(id);
      if (!u || Date.parse(u.expiresAt) <= Date.now()) this.#usedTurnPermits.delete(id);
    }
    let permit: PermitV1 | undefined;
    if (p.permitId !== undefined) {
      permit = this.#o.fuse.permit(p.permitId);
      // reviewer 9: live, unexpired, subscription, claude-code, this session, never used before
      if (
        !permit || permit.kind !== 'turn' || permit.backend !== 'claude-code' || permit.principal !== principal || (permit.hsid !== null && permit.hsid !== s.hsid) ||
        permit.billing !== 'subscription' || Date.parse(permit.expiresAt) <= Date.now() || this.#usedTurnPermits.has(permit.permitId)
      ) {
        throw refused('PERMIT_REQUIRED', 'session.send needs a live, unused claude-code subscription turn permit of yours for this session', {});
      }
    } else {
      permit = await this.#o.fuse.reserve({ principal, principalClass: 'human', attended: true, kind: 'turn', backend: 'claude-code', scope: { user: principal, session: s.hsid } });
    }
    this.#usedTurnPermits.add(permit.permitId);
    s.turnPermits.push(permit.permitId);
    const n = ++s.turns;
    const contentHash = sha(p.text);
    await this.#o.log('session.inject', { hsid: s.hsid, origin: 'client', hash: contentHash, bytes: Buffer.byteLength(p.text, 'utf8') }, { session: s.hsid });
    await this.#o.log('turn.sent', { hsid: s.hsid, turn: turnId(s.hsid, n), permitId: permit.permitId, contentHash }, { session: s.hsid });
    s.child.stdin?.write(userMessageLine(p.text));
    return { turn: turnId(s.hsid, n) };
  }

  async stop(principal: string, p: { hsid: string; interrupt?: boolean }): Promise<{ signals: string[]; exited: boolean }> {
    if (this.#local.has(p.hsid)) return this.#local.stop(principal, p);
    const s = this.#get(principal, p.hsid);
    if (p.interrupt) {
      if (s.state === 'running') s.child.stdin?.write(controlInterruptLine());
      return { signals: ['control_request:interrupt'], exited: false };
    }
    return this.#stopSession(s, 'session.stop');
  }

  async #stopSession(s: Session, reason: string): Promise<{ signals: string[]; exited: boolean }> {
    if (s.state === 'exited') return { signals: [], exited: true };
    s.state = 'stopping';
    if (s.watch) clearInterval(s.watch);
    await this.#expirePending(s, 'session-exited');
    const signals = ['control_request:interrupt', 'stdin:close'];
    try {
      s.child.stdin?.write(controlInterruptLine());
      s.child.stdin?.end();
    } catch {
      /* the pipe may already be gone */
    }
    const survivors = await this.#o.children.stop(s.child, reason);
    signals.push('group:staged');
    return { signals, exited: !survivors };
  }

  /** #local-runner's daemon-start probe of every configured local endpoint (model.probe / model.capabilities rows). */
  probeLocal(): Promise<Array<{ endpoint: string; ok: boolean }>> {
    return this.#local.probeAll();
  }

  /** status.sessionSandbox: the session profile's fidelity here (`unavailable` below the macOS floor or with SIP off, with the reason) */
  sandboxStatus(): Record<string, unknown> {
    return sessionSandboxFidelity(this.#platform, this.#o.macosMajor, this.#o.sipEnabled);
  }

  /** status.claudePin: the trust-on-first-use pin (spec §3.3) */
  pinStatus(): Record<string, unknown> | null {
    const p = readClaudePin(this.#o.home);
    return p ? { sha256: p.sha256, source: p.source, by: p.by, pinnedAt: p.pinnedAt, line: `${p.by} pin ${p.sha256} from ${p.source}` } : null;
  }

  /** status.sessions: live sessions + a bounded history of exited ones */
  status(): Array<Record<string, unknown>> {
    return [
      ...[...this.#sessions.values()].map((s) => ({ hsid: s.hsid, principalId: s.principalId, state: s.state, turns: s.turns, permitId: s.spawnPermit.permitId })),
      ...this.#history,
      ...this.#local.status(),
    ];
  }

  /** One session's state (tests, status): running | stopping | exited | null. */
  stateOf(hsid: string): string | null {
    return this.#sessions.get(hsid)?.state ?? (this.#history.some((h) => h.hsid === hsid) ? 'exited' : this.#local.stateOf(hsid));
  }
}
