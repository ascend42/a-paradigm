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
 *   AskUserQuestion / ExitPlanMode ⇒ `ask-user` / `plan` cards via the broker;
 *   `init.apiKeySource ≠ none` kills the group (absent is logged `absent`).
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
import { buildSessionPolicy, claudePermissions, policyHash, realpathLoose, type PolicyPath, type SessionPolicy } from '../manifest/policy.js';
import { layersHash, gitHash, defaultClaudeJson } from '../manifest/layers.js';
import { verifiedGenerated } from '../manifest/generate.js';
import { ManifestRefusal } from '../manifest/refusal.js';
import { sessionLaunchPlan, sessionSandboxFidelity } from '../sandbox/session.js';
import { LifecycleRefusal } from '../lifecycle/refusal.js';
import { buildSessionEnv } from '../runner/env.js';
import { claudeAuthOk, claudeJsonProjection, claudeVersion, law7Layers, law7Scan, managedFiles, PreflightRefusal, realLoose, resolveClaudeBinary, type ClaudeRun, type Law7Input, type SessionRefusalCode } from '../runner/preflight.js';
import { commitPin, prepareClaude, readClaudePin } from '../runner/binary.js';
import { buildClaudeArgv, cardKindOfTool, controlInterruptLine, LineSplitter, parseStreamLine, UsageMeter, userMessageLine, type SettingSource } from '../../adapters/claude-code/adapter.js';
import { claudeCodePlatform, type ClaudeCodePlatformRow } from '../../platform/claude-code.js';
import type { DarwinSessionExtras } from '../../platform/darwin/session-sbpl.js';
import { LocalLane, type LocalLaneOptions } from './local-session.js';
import type { LocalLaneConfig } from '../local/config.js';

export const STDOUT_LINE_CAP = 4 * 1024 * 1024;
export const STDERR_CAP = 64 * 1024;
/** A turn.event carries the full line only up to this size; above it {lineHash, bytes} (Aegis M3). */
export const EVENT_LINE_CAP = 64 * 1024;
/** Backpressure: pause stdout above this many queued log writes, resume below the low mark. */
export const QUEUE_HIGH = 256;
export const QUEUE_LOW = 32;
export const HISTORY_CAP = 32;

export type SupervisorLog = (kind: string, payload: Record<string, unknown>, ids?: { session?: string }) => Promise<void>;

export interface SupervisorOptions {
  log: SupervisorLog;
  children: Pick<DaemonChildren, 'intend' | 'track' | 'stop'>;
  fuse: Pick<BudgetFuse, 'reserve' | 'release' | 'recordStreamUsage' | 'quotaError' | 'permit'>;
  broker?: Pick<ApprovalBroker, 'raise'>;
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
  /** --setting-sources (explicit; default user,project,local — p01) */
  settingSources?: readonly SettingSource[];
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
    const { env, envKeys } = buildSessionEnv({ from: { ...(this.#o.env?.() ?? process.env), HOME: userHome }, hsid, sock: this.#o.sock, sessionKeyPath: path.join(dir, 'session.key') });
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
      fs.writeFileSync(policyPath, `${JSON.stringify({ ...claudePermissions(policy), ...(hooksJson.hooks ? { hooks: hooksJson.hooks } : {}) }, null, 2)}\n`, { mode: 0o600 });
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
      const argv = buildClaudeArgv({ uuid, policyPath, mcpConfigPath, settingSources: this.#o.settingSources ?? ['user', 'project', 'local'], ...(req.systemPrompt !== undefined ? { appendSystemPrompt: req.systemPrompt } : {}), ...(req.model && req.model !== 'claude' && req.model !== 'any' ? { model: req.model } : {}) });
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
        watchHash: wHash, gitHash: gHash, layerInput, env, state: 'running', turns: 0, seq: 0, meter: new UsageMeter(), stderrBytes: 0, watch: null,
      };
      this.#sessions.set(hsid, s);
      live = s;
      this.#wire(s); // round 3: wired BEFORE any further await — a failing row below still cleans up through the exit path
      await this.#o.log('session.sandbox', {
        hsid, sandbox: plan.sandbox, profile: 'session', profileHash: plan.profileHash, policyHash: policyHash(policy), layersHash: lHash, gitHash: gHash,
        binarySha256: `sha256:${priv.sha256}`, exec: priv.exec, version, envKeys, permitId: permit.permitId, generated: generated ? [...generated.keys()] : [],
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
      ...(bytes > EVENT_LINE_CAP ? { lineHash: sha(line), bytes } : { line }),
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
        if (ev.tokens !== null) await usage('turn.usage', s.meter.message(ev.messageId, ev.tokens));
        for (const t of ev.toolUses) {
          const kind = cardKindOfTool(t.name);
          if (!kind) continue;
          const inputHash = sha(JSON.stringify(t.input ?? null));
          const card = this.#o.broker
            ? await this.#o.broker.raise({ kind, requestedBy: s.principalId, hsid: s.hsid, attended: true, detail: { tool: t.name, toolUseId: t.id, inputHash }, lines: [kind === 'ask-user' ? 'The session asks you a question' : 'The session proposes a plan'], toolInput: t.input, tool: t.name })
            : null;
          await this.#o.log(kind === 'ask-user' ? 'turn.ask-user' : 'turn.plan', { hsid: s.hsid, toolUseId: t.id, inputHash, cardId: card?.cardId ?? null }, { session: s.hsid });
        }
        if (ev.quota) await this.#o.fuse.quotaError(s.hsid);
        return;
      case 'result': {
        await usage('turn.result', s.meter.result(ev.tokens), { cost: ev.costUsd, permission_denials: ev.permissionDenials, subtype: ev.subtype, isError: ev.isError });
        const head = s.turnPermits.shift(); // reviewer 7: FIFO — this result closes the oldest turn only
        if (head) await this.#o.fuse.release(head, s.owner).catch(() => undefined);
        if (ev.quota) await this.#o.fuse.quotaError(s.hsid);
        return;
      }
      default:
        return; // user replays, control responses, unknown types and malformed lines: logged above, never acted on
    }
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

  async send(principal: string, p: { hsid: string; text: string; permitId?: string }): Promise<{ turn: string }> {
    if (this.#local.has(p.hsid)) return this.#local.send(principal, p);
    const s = this.#get(principal, p.hsid);
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
    await this.#o.log('session.inject', { hsid: s.hsid, origin: 'client', hash: contentHash, bytes: p.text }, { session: s.hsid });
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
