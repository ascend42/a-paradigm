/**
 * @symbol #supervisor
 * @symbol #session-runner
 * @symbol #claude-adapter
 * @symbol ^subscription-only
 *
 * #supervisor + #session-runner (spec §3.3, §6.1, §5 verbs 2–4, §9.1
 * session.* / turn.*, §10 laws 1 and 7; M1.7 SLICE 1). The ONE place a
 * `claude -p` process is started. Slice 1 serves ATTENDED, HUMAN-started
 * Claude Code sessions only (an agent/session/unattended open is refused
 * FORBIDDEN; the scheduler's run step still refuses, M1.9).
 *
 * open(): session.open → preflight (claude by explicit path / known
 *   locations, never PATH; realpath + sha; version ≥ 2.1.288; `auth status`
 *   = claude.ai/firstParty) → session dir `<home>/sessions/<hsid-short>/`
 *   with policy.json (claudePermissions of the M1.5 SessionPolicy + the
 *   verified generated hooks) and mcp.json (the verified generated servers;
 *   T-008: bytes re-verified against the kernel-held record, never the
 *   repo's on trust) → the child env (allowlist + scrub) → LAW 7 per spawn
 *   (T-009/Aegis C5): every layer the child reads for THIS cwd, the session's
 *   own files and the child env (preflight.ts law7Layers) — a hit is
 *   billing.api.refused{where} + session.refused{code:'api_billing_refused'}
 *   and BILLING_REFUSED, before any permit → permit.reserve{session.spawn,
 *   backend:'claude-code', kernelSpawn} (the fuse runs its own law-7 scan) →
 *   assertClaudePermit (Aegis: claude never runs without a law-7-scanned
 *   claude-code session.spawn permit for THIS hsid, live in the fuse) → the
 *   generated `session` profile (sandbox/session.ts; no backend ⇒ refused,
 *   never unsandboxed) → children.intend (session.spawned{intent} BEFORE the
 *   fork) → spawn detached (own pgid) → children.track (running row with boot
 *   + start-time witness) → session.sandbox{…hashes}.
 * stdout: every line is a `turn.event` BEFORE anything acts on it (S2);
 *   usage only from stream events → turn.usage/turn.result → the fuse's
 *   recordStreamUsage against the SPAWN permit (UsageMeter: no double
 *   count); AskUserQuestion / ExitPlanMode ⇒ `ask-user` / `plan` cards via
 *   the broker + turn.ask-user / turn.plan; `init.apiKeySource ≠ none` kills
 *   the group; quota errors are recorded (P8-D92). Lines over 4 MiB dropped
 *   (turn.event{type:'dropped'}); stderr capped at 64 KiB.
 * send(): a `turn` permit (the caller's, validated, or reserved by the
 *   kernel for the owner — law 7 scanned again, per spawn layers too) →
 *   session.inject{origin:'client'} → turn.sent → the stream-json user line.
 * stop(): `interrupt` = the control_request line only (A23-4); otherwise
 *   staged: control message → close stdin → SIGTERM → SIGKILL on the group
 *   (DaemonChildren.stop) and the permits released.
 * Mid-session watch (G-SUB-05): layersHash + gitHash are re-read every
 *   `watchMs` (default 500 ms); a change logs session.layers.changed{which}
 *   and re-runs the law-7 scan — a hit stops the session (interrupt then
 *   staged stop) and logs billing.api.refused. The non-law-7 change's
 *   gate-class card is slice 2.
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
import { buildSessionPolicy, claudePermissions, policyHash, type SessionPolicy } from '../manifest/policy.js';
import { layersHash, gitHash, defaultClaudeJson } from '../manifest/layers.js';
import { verifiedGenerated } from '../manifest/generate.js';
import { ManifestRefusal } from '../manifest/refusal.js';
import { sessionLaunchPlan } from '../sandbox/session.js';
import { LifecycleRefusal } from '../lifecycle/refusal.js';
import { buildSessionEnv } from '../runner/env.js';
import { claudeAuthOk, claudeVersion, law7Layers, law7Scan, managedFiles, PreflightRefusal, resolveClaudeBinary, type SessionRefusalCode } from '../runner/preflight.js';
import { buildClaudeArgv, cardKindOfTool, controlInterruptLine, LineSplitter, parseStreamLine, UsageMeter, userMessageLine, type SettingSource } from '../../adapters/claude-code/adapter.js';
import { claudeCodePlatform, type ClaudeCodePlatformRow } from '../../platform/claude-code.js';

export const STDOUT_LINE_CAP = 4 * 1024 * 1024;
export const STDERR_CAP = 64 * 1024;

export type SupervisorLog = (kind: string, payload: Record<string, unknown>, ids?: { session?: string }) => Promise<void>;

export interface SupervisorOptions {
  log: SupervisorLog;
  children: Pick<DaemonChildren, 'intend' | 'track' | 'stop'>;
  fuse: Pick<BudgetFuse, 'reserve' | 'release' | 'recordStreamUsage' | 'quotaError' | 'permit'>;
  broker?: Pick<ApprovalBroker, 'raise'>;
  /** the Gnomon home (session dirs live in <home>/sessions/) */
  home: string;
  /** the user's home (the ~/.claude layers) */
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
  spawnPermit: PermitV1;
  turnPermits: Set<string>;
  binarySha256: string;
  layersHash: string;
  gitHash: string;
  layerInput: Parameters<typeof law7Layers>[0];
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
};

function refused(code: RefusalCode, message: string, data: Record<string, unknown> = {}): RefusedError {
  return new RefusedError(refuse({ code, data }), `#supervisor: ${message}`);
}

const sha = (s: string | Buffer): string => `sha256:${createHash('sha256').update(s).digest('hex')}`;

export class SessionSupervisor {
  readonly #o: SupervisorOptions;
  readonly #sessions = new Map<string, Session>();
  readonly #platform: string;

  constructor(o: SupervisorOptions) {
    this.#o = o;
    this.#platform = o.platform ?? process.platform;
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

  #row(): ClaudeCodePlatformRow | null {
    return claudeCodePlatform(this.#platform);
  }

  async open(req: OpenRequest): Promise<{ hsid: string; principalId: string; backend: 'claude-code'; state: string }> {
    if (req.principalClass !== 'human' || req.attended !== true) {
      throw refused('FORBIDDEN', 'M1.7 slice 1 opens attended, human-started sessions only (agent/session/unattended opens wait for the broker decision, law 5)', { principalClass: req.principalClass });
    }
    if (req.backend === 'local' || req.model === 'local') throw refused('UNSUPPORTED', 'local sessions are #local-runner (M1.8)', {});
    if (typeof req.cwd !== 'string' || !path.isAbsolute(req.cwd) || !fs.existsSync(req.cwd) || !fs.statSync(req.cwd).isDirectory()) {
      throw refused('BAD_REQUEST', 'cwd must be an existing absolute directory', { reason: 'bad-params' });
    }
    const hsid = mintHsid();
    const principalId = this.#principalFor(hsid);
    const uuid = randomUUID();
    const userHome = this.#o.userHome ?? os.homedir();
    await this.#o.log('session.open', { hsid, principalId, by: req.principal, cwd: req.cwd, worktree: req.worktree ?? null, backend: 'claude-code', model: req.model ?? 'claude', attended: true, uuid }, { session: hsid });
    const row = this.#row();
    if (!row) return this.#refuse(hsid, 'spawn_failed', `no Claude Code platform row for ${this.#platform}`);
    // preflight: binary, version, subscription auth — with the child's own env
    const baseEnv = this.#o.env?.() ?? process.env;
    const short = hsidShort(hsid);
    const dir = path.join(this.#o.home, 'sessions', short);
    const { env, envKeys } = buildSessionEnv({ from: baseEnv, hsid, sock: this.#o.sock, sessionKeyPath: path.join(dir, 'session.key') });
    let bin;
    let version: string;
    try {
      bin = resolveClaudeBinary({ ...(this.#o.claudePath ? { explicit: this.#o.claudePath } : {}), row, home: userHome });
      version = claudeVersion(bin.real, env);
      claudeAuthOk(bin.real, env);
    } catch (err) {
      if (err instanceof PreflightRefusal) return this.#refuse(hsid, err.code, err.message, err.data);
      throw err;
    }
    // the session's own files: policy.json + mcp.json from verified generated bytes (T-008)
    const userClaudeDir = path.join(userHome, row.userClaudeDir);
    const userClaudeJson = defaultClaudeJson(userClaudeDir);
    const managed = managedFiles(row);
    let policy: SessionPolicy;
    let generated: Map<string, Buffer> | null;
    try {
      generated = verifiedGenerated(req.cwd, { home: this.#o.home });
      policy = buildSessionPolicy({
        home: this.#o.home,
        cwd: req.cwd,
        ...(req.worktree ? { worktree: req.worktree } : {}),
        userClaudeDir,
        userClaudeJson,
        managedSettingsPaths: managed,
        linkedFolders: this.#o.linkedFolders?.() ?? [],
        endpointPort: this.#o.endpointPort?.() ?? null,
      });
    } catch (err) {
      if (err instanceof ManifestRefusal || err instanceof TypeError) return this.#refuse(hsid, 'spawn_failed', err.message);
      throw err;
    }
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
    // LAW 7 per spawn (T-009 / Aegis C5): before any permit
    const layerInput = { row, cwd: req.cwd, ...(req.worktree ? { worktree: req.worktree } : {}), userClaudeDir, userClaudeJson, policyPath, mcpConfigPath };
    const hits = law7Scan(env, law7Layers(layerInput));
    if (hits.length) {
      await this.#o.log('billing.api.refused', { hsid, where: hits.map((h) => h.where), keys: hits.map((h) => h.key) }, { session: hsid }).catch(() => undefined);
      return this.#refuse(hsid, 'api_billing_refused', 'an API-billing path is set in a layer this session would read (law 7)', { hits: hits.map((h) => ({ where: h.where, key: h.key })) });
    }
    const lHash = layersHash({ cwd: req.cwd, ...(req.worktree ? { worktree: req.worktree } : {}), userClaudeDir, managedPaths: managed, userClaudeJson });
    const gHash = gitHash(req.worktree ?? req.cwd);
    // law 1 + law 7 in the fuse
    let permit: PermitV1;
    try {
      permit = await this.#o.fuse.reserve({ principal: req.principal, principalClass: req.principalClass, attended: true, kind: 'session.spawn', backend: 'claude-code', model: req.model ?? 'claude', scope: { user: req.principal, session: hsid }, kernelSpawn: { hsid } });
    } catch (err) {
      if (err instanceof RefusedError && err.refusal.code === 'BILLING_REFUSED') await this.#o.log('session.refused', { hsid, code: 'api_billing_refused', where: 'fuse' }, { session: hsid }).catch(() => undefined);
      throw err;
    }
    const releaseSpawn = (): Promise<void> => this.#o.fuse.release(permit.permitId, permit.principal).catch(() => undefined);
    this.assertClaudePermit(permit, hsid);
    if (permit.billing !== 'subscription') {
      await releaseSpawn();
      return this.#refuse(hsid, 'api_billing_refused', 'api-token billing is not wired into the session spawn yet (M1.7 slice 2)', { billing: permit.billing });
    }
    const argv = buildClaudeArgv({ uuid, policyPath, mcpConfigPath, settingSources: this.#o.settingSources ?? ['user', 'project', 'local'], ...(req.systemPrompt !== undefined ? { appendSystemPrompt: req.systemPrompt } : {}), ...(req.model && req.model !== 'claude' && req.model !== 'any' ? { model: req.model } : {}) });
    let plan;
    try {
      plan = sessionLaunchPlan({ policy, binaryReal: bin.real, argv, extras: { uid: process.getuid?.() ?? 0, tmpdir: os.tmpdir(), home: userHome, roots: [req.cwd, ...(req.worktree ? [req.worktree] : [])] } }, this.#platform);
    } catch (err) {
      await releaseSpawn();
      if (err instanceof LifecycleRefusal) return this.#refuse(hsid, 'spawn_failed', err.message, { sandbox: 'unavailable' });
      throw err;
    }
    const intent = await this.#o.children.intend({ kind: 'session', hsid });
    const child = spawn(plan.command, plan.args, { cwd: req.cwd, env, detached: true, stdio: ['pipe', 'pipe', 'pipe'] });
    const spawnError = await new Promise<Error | null>((resolve) => {
      child.once('error', (e) => resolve(e));
      child.once('spawn', () => resolve(null));
    });
    if (spawnError) {
      await releaseSpawn();
      return this.#refuse(hsid, 'spawn_failed', `spawn failed: ${spawnError.message}`);
    }
    try {
      await this.#o.children.track({ kind: 'session', child, hsid, intent });
    } catch (err) {
      child.kill('SIGKILL');
      await releaseSpawn();
      return this.#refuse(hsid, 'spawn_failed', (err as Error).message);
    }
    const s: Session = {
      hsid, principalId, owner: req.principal, cwd: req.cwd, ...(req.worktree ? { worktree: req.worktree } : {}), child, spawnPermit: permit, turnPermits: new Set(),
      binarySha256: bin.sha256, layersHash: lHash, gitHash: gHash, layerInput, env, state: 'running', turns: 0, seq: 0, meter: new UsageMeter(), stderrBytes: 0, watch: null,
    };
    this.#sessions.set(hsid, s);
    await this.#o.log('session.sandbox', {
      hsid, sandbox: plan.sandbox, profile: 'session', profileHash: plan.profileHash, policyHash: policyHash(policy), layersHash: lHash, gitHash: gHash,
      binarySha256: `sha256:${bin.sha256}`, version, envKeys, permitId: permit.permitId, generated: generated ? [...generated.keys()] : [],
    }, { session: hsid });
    this.#wire(s);
    return { hsid, principalId, backend: 'claude-code', state: 'running' };
  }

  #wire(s: Session): void {
    const split = new LineSplitter(STDOUT_LINE_CAP);
    let chain: Promise<void> = Promise.resolve();
    const queue = (f: () => Promise<void>): void => {
      chain = chain.then(f).catch(() => undefined);
    };
    s.child.stdout?.setEncoding('utf8');
    s.child.stdout?.on('data', (chunk: string) => {
      split.push(chunk, (line) => queue(() => this.#onLine(s, line)), (bytes) => queue(() => this.#o.log('turn.event', { hsid: s.hsid, type: 'dropped', bytes, seq: ++s.seq }, { session: s.hsid })));
    });
    s.child.stderr?.on('data', (b: Buffer) => {
      s.stderrBytes += b.length; // capped: counted, never buffered past STDERR_CAP
    });
    s.child.stdin?.on('error', () => undefined);
    s.child.once('exit', () => {
      queue(async () => {
        s.state = 'exited';
        if (s.watch) clearInterval(s.watch);
        for (const p of [s.spawnPermit.permitId, ...s.turnPermits]) await this.#o.fuse.release(p, s.owner).catch(() => undefined);
        s.turnPermits.clear();
        if (s.stderrBytes > STDERR_CAP) await this.#o.log('turn.event', { hsid: s.hsid, type: 'stderr.capped', bytes: s.stderrBytes, seq: ++s.seq }, { session: s.hsid }).catch(() => undefined);
      });
    });
    const ms = this.#o.watchMs ?? 500;
    s.watch = setInterval(() => queue(() => this.#watch(s)), ms);
    s.watch.unref();
  }

  async #onLine(s: Session, line: string): Promise<void> {
    const ev = parseStreamLine(line);
    // S2: every driver event is a turn.event before anything acts on it
    await this.#o.log('turn.event', { hsid: s.hsid, type: ev.type, seq: ++s.seq, line }, { session: s.hsid });
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
        for (const p of s.turnPermits) await this.#o.fuse.release(p, s.owner).catch(() => undefined);
        s.turnPermits.clear();
        if (ev.quota) await this.#o.fuse.quotaError(s.hsid);
        return;
      }
      default:
        return; // user replays, control responses, unknown types and malformed lines: logged above, never acted on
    }
  }

  async #watch(s: Session): Promise<void> {
    if (s.state !== 'running') return;
    const inp = s.layerInput;
    const managed = managedFiles(inp.row);
    const l = layersHash({ cwd: inp.cwd, ...(inp.worktree ? { worktree: inp.worktree } : {}), userClaudeDir: inp.userClaudeDir, managedPaths: managed, userClaudeJson: inp.userClaudeJson });
    const g = gitHash(s.worktree ?? s.cwd);
    const which = [...(l !== s.layersHash ? ['settings'] : []), ...(g !== s.gitHash ? ['git'] : [])];
    if (!which.length) return;
    s.layersHash = l;
    s.gitHash = g;
    await this.#o.log('session.layers.changed', { hsid: s.hsid, which }, { session: s.hsid });
    const hits = law7Scan(s.env, law7Layers(inp));
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
    const s = this.#get(principal, p.hsid);
    if (s.state !== 'running') throw refused('NOT_FOUND', 'the session is not running', { reason: 'not-found' });
    if (typeof p.text !== 'string' || p.text.length === 0) throw refused('BAD_REQUEST', 'send takes non-empty text', { reason: 'bad-params' });
    // law 7 again for the turn, over this session's layers
    const hits = law7Scan(s.env, law7Layers(s.layerInput));
    if (hits.length) {
      await this.#o.log('billing.api.refused', { hsid: s.hsid, where: hits.map((h) => h.where), keys: hits.map((h) => h.key) }, { session: s.hsid });
      throw refused('BILLING_REFUSED', 'an API-billing path appeared in a layer this session reads (law 7)', { session: 'api_billing_refused' });
    }
    let permit: PermitV1 | undefined;
    if (p.permitId !== undefined) {
      permit = this.#o.fuse.permit(p.permitId);
      if (!permit || permit.kind !== 'turn' || permit.backend !== 'claude-code' || permit.principal !== principal || (permit.hsid !== null && permit.hsid !== s.hsid)) {
        throw refused('PERMIT_REQUIRED', 'session.send needs a live claude-code turn permit of yours for this session', {});
      }
    } else {
      permit = await this.#o.fuse.reserve({ principal, principalClass: 'human', attended: true, kind: 'turn', backend: 'claude-code', scope: { user: principal, session: s.hsid } });
    }
    s.turnPermits.add(permit.permitId);
    const n = ++s.turns;
    const line = userMessageLine(p.text);
    const contentHash = sha(p.text);
    await this.#o.log('session.inject', { hsid: s.hsid, origin: 'client', hash: contentHash, bytes: p.text }, { session: s.hsid });
    await this.#o.log('turn.sent', { hsid: s.hsid, turn: turnId(s.hsid, n), permitId: permit.permitId, contentHash }, { session: s.hsid });
    s.child.stdin?.write(line);
    return { turn: turnId(s.hsid, n) };
  }

  async stop(principal: string, p: { hsid: string; interrupt?: boolean }): Promise<{ signals: string[]; exited: boolean }> {
    const s = this.#get(principal, p.hsid);
    if (p.interrupt) {
      if (s.state === 'running') s.child.stdin?.write(controlInterruptLine());
      return { signals: ['control_request:interrupt'], exited: s.state === 'exited' };
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

  /** status.sessions */
  status(): Array<Record<string, unknown>> {
    return [...this.#sessions.values()].map((s) => ({ hsid: s.hsid, principalId: s.principalId, state: s.state, turns: s.turns, permitId: s.spawnPermit.permitId }));
  }
}
