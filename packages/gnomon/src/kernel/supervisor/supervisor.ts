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
 *   'kernel', hash, bytes}. AskUserQuestion is an `ask-user` card (cached
 *   class, decision `answer` only, 10 min timeout ⇒ deny "no answer") with
 *   its turn.ask-user row: the note is checked against the KERNEL-held
 *   questions before presence (parseAskAnswer), the allow carries
 *   updatedInput = {...kernel-held input, answers}, and the answer text never
 *   reaches a non-sensitive row (approval.decide: noteHash/noteBytes). The
 *   answer IS inside the decisionSig preimage and the presence binding since
 *   P8-D98 (slice A2 of T-2026-10-19-001): an `answer` signs the decisionSig
 *   v2 message ending in its answerDigest (= the row's noteHash), so an
 *   answer rewritten on the wire fails decisionSig. ExitPlanMode is a `plan` card with its
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
 * #trace-capture (trace/): when the human traced the session's cwd (trace/mode.ts, read at every open and
 *   resume), every stdin line (#stdin) and every stdout line is teed, as sent and received, with kernel notes
 *   (spawn argv redacted, exit, drain interrupt) to `<cwd>/.gnomon/trace/`; the session.sandbox row says
 *   `traced: true` (or `traced: false, traceRefused`). The tee never blocks the session (bounded queue, counted drops).
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
import { hsidShort, mintHsid, refuse, RefusedError, turnId, validateKindPayload, type RefusalCode, type DrainExitReason, type ResumeRefusal } from '@a-company/gnomon-contracts';
import type { DaemonChildren } from '../lifecycle/children.js';
import type { BudgetFuse, PermitV1 } from '../budget/fuse.js';
import type { ApprovalBroker } from '../broker/broker.js';
import { ALWAYS_ASK_TOOLS, buildSessionPolicy, CLAUDE_TRANSCRIPTS_REL, claudePermissions, policyHash, realpathLoose, type PolicyPath, type SessionPolicy } from '../manifest/policy.js';
import { layersHash, gitHash, defaultClaudeJson } from '../manifest/layers.js';
import { verifiedGenerated } from '../manifest/generate.js';
import { ManifestRefusal } from '../manifest/refusal.js';
import { sessionLaunchPlan, sessionSandboxFidelity } from '../sandbox/session.js';
import { LifecycleRefusal } from '../lifecycle/refusal.js';
import { buildSessionEnv } from '../runner/env.js';
import { claudeAuthOk, claudeJsonProjection, claudeVersion, law7Layers, law7Scan, managedFiles, PreflightRefusal, realLoose, resolveClaudeBinary, type ClaudeRun, type Law7Input, type SessionRefusalCode } from '../runner/preflight.js';
import { commitPin, prepareClaude, readClaudePin } from '../runner/binary.js';
import { buildClaudeArgv, DEFAULT_SESSION_HOOKS, repoContextFor, settingSourcesFor, type SessionHooksMode, controlErrorLine, controlInterruptLine, LineSplitter, parseStreamLine, permissionAllowLine, permissionDenyLine, UsageMeter, userMessageLine, type AdapterEvent } from '../../adapters/claude-code/adapter.js';
import { answerFor, ASK_USER_TIMEOUT_MS, composePermission, MAX_ATTACHED_PLAN_CHARS, MAX_PENDING_PERMISSIONS, parseAskAnswer, PLAN_FILE, type AskQuestion, type CardKindP } from './permission.js';
import { claudeCodePlatform, type ClaudeCodePlatformRow } from '../../platform/claude-code.js';
import type { DarwinSessionExtras } from '../../platform/darwin/session-sbpl.js';
import { LocalLane, type LocalLaneOptions } from './local-session.js';
import { extractRepoHooks, hooksBlock, mergeHooks, MAX_PENDING_HOOK_CARDS, MAX_REFUSED_LOGGED, repoHookCard, repoKeyOf, type RepoHook } from './repo-hooks.js';
import { buildRepoContext, memoryChainOf, REPO_CONTEXT_ENV, REPO_CONTEXT_SETTINGS, repoContextLines, repoContextRow, repoSettingsInfo, repoSettingsLines, type RepoContext } from './repo-context.js';
import type { LocalLaneConfig } from '../local/config.js';
import { openTraceStream, redactArgv, TraceRefused, type TraceOpenOptions, type TraceStream } from '../trace/capture.js';
import { traceModeOf } from '../trace/mode.js';

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

/**
 * §2.4 rule 11 (TD-2026-10-19-908, T-2026-10-19-014 B1): how long a drain waits for every in-flight turn to reach
 * its boundary before it interrupts the ones still running. No root-signed config value names a drain deadline
 * yet, so this built-in default is used; a drain that interrupts on it says so on the interrupt's
 * session.inject{channel:'drain', deadlineMs, deadlineSource:'default'} row.
 */
export const DRAIN_DEADLINE_MS = 30_000;
/** After the deadline's interrupt, how long the drain waits for the interrupted turn's result line before it stops the child. */
export const DRAIN_INTERRUPT_GRACE_MS = 1_000;
/**
 * The `session.exited{reason}` a drained Claude session's stop writes (the record slice B2 reads; session.drained's
 * payload is closed to {uuid, reason}). `drain-clean`: the session was at a turn boundary, so B2 resumes it
 * normally. `drain-interrupted`: a turn was still running at the deadline and was interrupted, so B2 resumes it
 * IDLE with a visible "turn interrupted by update" note and never continues it (TD-2026-10-19-814 item 2;
 * probes/results/p-resume.darwin.json: a turn killed mid-tool re-issues the tool call on resume + continue).
 */
export const DRAIN_EXIT_REASONS = Object.freeze({ clean: 'drain-clean', interrupted: 'drain-interrupted' } as const satisfies Record<string, DrainExitReason>);
export type DrainOutcome = keyof typeof DRAIN_EXIT_REASONS;

export interface DrainOptions {
  /** default DRAIN_DEADLINE_MS (no root-signed config value exists for it) */
  deadlineMs?: number;
}
export interface DrainRecord {
  hsid: string;
  /** the backend session uuid session.drained carries (`--resume <uuid>`) */
  uuid: string;
  outcome: DrainOutcome;
}
export interface DrainReport {
  deadlineMs: number;
  deadlineSource: 'default' | 'caller';
  /** every live Claude session, each with a session.drained row before its session.exited{reason: DRAIN_EXIT_REASONS[outcome]} */
  sessions: DrainRecord[];
}

/** The note row a drain-interrupted session resumes with (TD-2026-10-19-814 item 2): it is idle and never continued. */
export const INTERRUPTED_NOTE = 'turn interrupted by update';

/**
 * §2.4 rule 11 (T-2026-10-19-014 B2): what the new kernel resumes a drained session from, read back from the
 * old kernel's kernel-signed rows (resume.ts planResume): its session.open, its last session.sandbox (layersHash,
 * gitHash, permitId), the permit.grant of that permit, and the session.drained row (its `ev:` id) whose
 * session.exited reason gave the outcome.
 */
export interface ResumeInput {
  hsid: string;
  uuid: string;
  drainedEventId: string;
  /** the session.drained row's chain time: the carry-over ruling resumes a permit only if it was live then */
  drainedAt: string;
  outcome: DrainOutcome;
  principal: string;
  /** the opener's class from the drained session's session.open row (Aegis L4: never assumed) */
  principalClass: string;
  cwd: string;
  worktree?: string;
  model?: string;
  layersHash: string;
  gitHash: string | null;
  permit: PermitV1 | null;
}

export type SupervisorLog = (kind: string, payload: Record<string, unknown>, ids?: { session?: string }) => Promise<void>;

export interface SupervisorOptions {
  log: SupervisorLog;
  children: Pick<DaemonChildren, 'intend' | 'track' | 'stop'>;
  fuse: Pick<BudgetFuse, 'reserve' | 'release' | 'recordStreamUsage' | 'quotaError' | 'permit'> & Partial<Pick<BudgetFuse, 'reattribute'>>;
  /** P8-D96: decisionOf/expire/noteOf/suspect answer the permission channel; absent (or raise-only) ⇒ every request is denied */
  broker?: Pick<ApprovalBroker, 'raise'> & Partial<Pick<ApprovalBroker, 'decisionOf' | 'expire' | 'noteOf' | 'suspect' | 'auto' | 'expireSessionBound'>>;
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
  /** S-L1: the standing `always` rule an exact (repoKey, tool, inputHash) matches, DERIVED from kernel-signed rows only (rules.ts RuleBook); absent ⇒ none */
  alwaysRule?: (repoKey: string, tool: string, inputHash: string) => { ruleId: string } | null;
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
  /** #trace-capture: is this cwd traced? default: the human's toggle in the Gnomon home (trace/mode.ts traceModeOf), read at every open and resume */
  traceMode?: (cwd: string) => boolean;
  /** TEST RIG ONLY: #trace-capture writer bounds and a stub sink (a slow disk) */
  traceOptions?: TraceOpenOptions;
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
  /** the backend session uuid (`--session-id`; session.drained{uuid} for `--resume`) */
  uuid: string;
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
  /** item 3: ExitPlanMode tool_use input.plan by tool_use id (bounded TOOL_ID_CAP) and the last plan-file Write content (display only) */
  planUses: Map<string, string>;
  lastPlanFile: string | null;
  policy: SessionPolicy;
  /** §2.4 rule 11: set when the drain wrote this session's session.drained row */
  drained?: DrainOutcome;
  /** #trace-capture: the raw stream tee when the cwd is traced */
  trace: TraceStream | null;
}

/** Env names whose VALUES the trace asserts never appear in a record (#trace-capture). */
const SECRET_ENV = /KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL/i;

interface PendingPermission {
  cardId: string | null;
  cardKind: CardKindP | null;
  /** ask-user: the validated questions the answer is checked against (kernel-held, from the request) */
  questions?: AskQuestion[];
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

/** The `turn.sent` / client `session.inject` contentHash of a turn's text (the exact bytes written to claude's stdin as the user message text). `gnomon trace` (#gnomon-trace) reuses it to check a transcript prompt against the log. */
export function turnContentHash(text: string): string {
  return sha(text);
}

/**
 * Aegis M1 (TD-2026-10-19-814): create `<userClaudeDir>/projects` (owner-only) when NOTHING is at that path. An
 * existing entry — a dir, or a link the policy then refuses to carve back — is left exactly as found.
 */
export function ensureTranscriptDir(userClaudeDir: string): void {
  const dir = path.join(userClaudeDir, CLAUDE_TRANSCRIPTS_REL);
  try {
    fs.lstatSync(dir);
    return;
  } catch {
    /* absent: create it */
  }
  try {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  } catch {
    /* a race or a read-only home: the policy resolves whatever is there and fails closed on a link */
  }
}

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
  /** §2.4 rule 11: set once a drain begins; session.open and session.send are refused ENGINE{draining} from then on */
  #drain: Promise<DrainReport> | null = null;
  /** §2.4 rule 11 (B2): hsids this kernel resumed after an upgrade */
  readonly #resumed = new Set<string>();
  /** Claude opens past the draining check and not yet settled: the drain waits for them before it collects sessions */
  #opening = 0;
  /** woken at every turn boundary (a result line), session exit and settled open */
  readonly #boundaryWaiters = new Set<() => void>();

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
    this.#refuseIfDraining('session.open');
    this.#opening++;
    try {
      return await this.#open(req);
    } finally {
      this.#opening--;
      this.#wake();
    }
  }

  async #open(req: OpenRequest): Promise<{ hsid: string; principalId: string; backend: 'claude-code' | 'local'; state: string; binaryPin?: string; model?: string }> {
    if (req.principalClass !== 'human' || req.attended !== true) {
      throw refused('FORBIDDEN', 'M1.7 slice 1 opens attended, human-started sessions only (agent/session/unattended opens wait for the broker decision, law 5)', { principalClass: req.principalClass });
    }
    this.#refuseIfDraining('session.open');
    // an explicit backend pins the route: claude-code never spawns gnomon-local (model local + claude-code ⇒ BAD_REQUEST in the lane)
    if (req.backend === 'local' || req.model === 'local' || (req.model === 'any' && req.backend !== 'claude-code')) {
      // §13.3: local ⇒ capable local or a fallback card; any ⇒ local if capable, else (null) Claude below
      const local = await this.#local.open(req, (r) => this.open(r));
      if (local) return local;
    }
    if (typeof req.cwd !== 'string' || !path.isAbsolute(req.cwd) || !fs.existsSync(req.cwd) || !fs.statSync(req.cwd).isDirectory()) {
      throw refused('BAD_REQUEST', 'cwd must be an existing absolute directory', { reason: 'bad-params' });
    }
    return this.#spawnClaude(req);
  }

  /**
   * §2.4 rule 11 (TD-2026-10-19-908; T-2026-10-19-014 B2): respawn a drained session with `--resume <uuid>`
   * through the ordinary spawn path, same hsid and uuid. Everything re-runs as for any spawn: the sandboxed
   * preflight (version, auth), law 7, the binary pin, layersHash and gitHash — which must EQUAL the drained
   * session's (a change refuses `layers-changed` / `git-changed`) — and the permit, which is re-attributed by
   * the fuse (permit.reattributed citing the drained row), never minted. Any failure leaves the session
   * stopped with its session.refused{code, resume} row. Nothing is sent to the child: a clean session is idle
   * until the human sends; an interrupted one also gets the INTERRUPTED_NOTE row and is never continued.
   * Cached unlocks and voice arms belong to the old process: this kernel's broker starts with none.
   */
  async resume(r: ResumeInput): Promise<{ hsid: string; principalId: string; backend: 'claude-code' | 'local'; state: string; binaryPin?: string }> {
    this.#refuseIfDraining('session.open');
    if (this.#sessions.has(r.hsid) || this.#resumed.has(r.hsid)) throw refused('BAD_REQUEST', `session ${r.hsid} is already resumed`, { reason: 'bad-params' });
    if (typeof r.cwd !== 'string' || !path.isAbsolute(r.cwd) || !fs.existsSync(r.cwd) || !fs.statSync(r.cwd).isDirectory()) {
      return this.#refuse(r.hsid, 'spawn_failed', 'the drained session\'s cwd is gone', { resume: 'cwd-gone' });
    }
    // Aegis L4: the class is carried from the session.open row; open() admits human-started sessions only, so must a resume
    if (r.principalClass !== 'human') return this.#refuse(r.hsid, 'spawn_failed', 'only a human-started session is resumed', { resume: 'not-human', principalClass: r.principalClass });
    this.#opening++;
    try {
      return await this.#spawnClaude({ principal: r.principal, principalClass: r.principalClass, attended: true, cwd: r.cwd, ...(r.worktree ? { worktree: r.worktree } : {}), ...(r.model ? { model: r.model } : {}) }, r);
    } finally {
      this.#opening--;
      this.#wake();
    }
  }

  /** Whether `hsid` is a session this kernel resumed after an upgrade (the `session.resume` hello feature gates it). */
  resumed(hsid: string): boolean {
    return this.#resumed.has(hsid);
  }

  async #spawnClaude(req: OpenRequest, r?: ResumeInput): Promise<{ hsid: string; principalId: string; backend: 'claude-code' | 'local'; state: string; binaryPin?: string; model?: string }> {
    const hsid = r?.hsid ?? mintHsid();
    const principalId = this.#principalFor(hsid);
    const uuid = r?.uuid ?? randomUUID();
    const userHome = this.#o.userHome ?? os.homedir();
    await this.#o.log('session.open', { hsid, principalId, by: req.principal, cwd: req.cwd, worktree: req.worktree ?? null, backend: 'claude-code', model: req.model ?? 'claude', attended: true, uuid, principalClass: req.principalClass, ...(r ? { resume: { drainedEventId: r.drainedEventId, outcome: r.outcome } } : {}) }, { session: hsid });
    const row = claudeCodePlatform(this.#platform);
    if (!row) return this.#refuse(hsid, 'spawn_failed', `no Claude Code platform row for ${this.#platform}`);
    const dir = path.join(this.#o.home, 'sessions', hsidShort(hsid));
    // reviewer 9: the child's HOME IS the user home whose layers were scanned
    const { env, envKeys } = buildSessionEnv({ from: { ...(this.#o.env?.() ?? process.env), HOME: userHome }, hsid, sock: this.#o.sock, sessionKeyPath: path.join(dir, 'session.key'), ...(repoContextFor(this.#o.hooksMode ?? DEFAULT_SESSION_HOOKS) ? { inject: REPO_CONTEXT_ENV } : {}) });
    let permit: PermitV1 | null = null;
    let child: ChildProcess | null = null;
    let tracked = false;
    let live: Session | null = null;
    let trace: TraceStream | null = null;
    let traceRefused: string | null = null;
    try {
      const bin = resolveClaudeBinary({ ...(this.#o.claudePath ? { explicit: this.#o.claudePath } : {}), row, home: userHome });
      const priv = await prepareClaude(this.#o.home, bin.real, { allowScripts: this.#o.allowScripts === true });
      const userClaudeDir = path.join(userHome, row.userClaudeDir);
      const userClaudeJson = defaultClaudeJson(userClaudeDir);
      const managed = managedFiles(row);
      const generated = verifiedGenerated(req.cwd, { home: this.#o.home });
      // P8-D97: the repo's context is staged BEFORE the policy (F3: its import targets are write-denied); the repo's CLAUDE.md dirs and a kernel-staged plugin of its skills/agents/commands (hooks stripped)
      let repoCtx: RepoContext | null = null;
      if (repoContextFor(this.#o.hooksMode ?? DEFAULT_SESSION_HOOKS)) {
        repoCtx = buildRepoContext({ cwd: req.cwd, userHome, outDir: path.join(dir, 'context') });
        await this.#o.log('gate-class.detected', repoContextRow(hsid, repoCtx, repoSettingsInfo([req.cwd, ...(req.worktree ? [req.worktree] : [])])), { session: hsid });
      }
      // Aegis M1 (TD-2026-10-19-814): the transcript dir exists BEFORE the spawn, so the profile's literal re-deny of it
      // names a real dir (the session can then neither remove, rename nor replace it). Never over an existing entry:
      // a link there is the policy's fail-closed case, not ours to repair.
      ensureTranscriptDir(userClaudeDir);
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
        ...((m) => ({ memoryDirs: m.chain, memorySubtree: m.top }))(memoryChainOf(req.cwd, userHome)), // P8-D97 (M1, R1): no session plants steering a later one loads
        memoryImports: repoCtx?.importTargets ?? [], // P8-D97 (F3)
        claudeTranscripts: true, // TD-2026-10-19-814 item 1: Claude Code saves transcripts under ~/.claude/projects (--resume)
      });
      // fail closed, reported: no transcript carve-back means this session cannot be resumed
      if (policy.allowWriteRefused) await this.#o.log('session.sandbox', { hsid, phase: 'transcripts-withheld', reason: policy.allowWriteRefused }, { session: hsid });
      if (r && policy.allowWriteRefused) throw new PreflightRefusal('spawn_failed', 'a resume needs its transcript dir writable', { resume: 'transcripts-withheld' });
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
      // P8-D94: in `audited` mode only the repo hooks the human approved reach Claude, through policy.json
      const approved = hooksMode === 'audited' ? await this.#auditRepoHooks(hsid, req, repoCtx ? repoContextLines(repoCtx) : []) : [];
      const hooks = approved.length ? mergeHooks(hooksJson.hooks, hooksBlock(approved)) : hooksJson.hooks;
      fs.writeFileSync(policyPath, `${JSON.stringify({ ...claudePermissions(policy), ...(repoCtx ? REPO_CONTEXT_SETTINGS : {}), ...(hooks ? { hooks } : {}) }, null, 2)}\n`, { mode: 0o600 });
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
      // §2.4 rule 11: the resumed session reads exactly the layers and git state it was drained with
      if (r && lHash !== r.layersHash) throw new PreflightRefusal('spawn_failed', 'the settings layers changed since the drain', { resume: 'layers-changed' });
      if (r && gHash !== r.gitHash) throw new PreflightRefusal('spawn_failed', 'the git state changed since the drain', { resume: 'git-changed' });
      let wHash = this.#watchHashOf(layerInput);
      const scan = async (): Promise<void> => {
        const hits = law7Scan(env, law7Layers(layerInput));
        if (!hits.length) return;
        await this.#o.log('billing.api.refused', { hsid, where: hits.map((h) => h.where), keys: hits.map((h) => h.key) }, { session: hsid }).catch(() => undefined);
        throw new PreflightRefusal('api_billing_refused', 'an API-billing path is set in a layer this session would read (law 7)', { hits: hits.map((h) => ({ where: h.where, key: h.key })) });
      };
      await scan();
      try {
        permit = r ? await this.#reattribute(r) : await this.#o.fuse.reserve({ principal: req.principal, principalClass: req.principalClass, attended: true, kind: 'session.spawn', backend: 'claude-code', model: req.model ?? 'claude', scope: { user: req.principal, session: hsid }, kernelSpawn: { hsid } });
      } catch (err) {
        if (err instanceof RefusedError && err.refusal.code === 'BILLING_REFUSED') throw new PreflightRefusal('api_billing_refused', err.message, { where: 'fuse' });
        throw err;
      }
      this.assertClaudePermit(permit, hsid);
      if (permit.billing !== 'subscription') throw new PreflightRefusal('api_billing_refused', 'api-token billing is not wired into the session spawn yet (M1.7 slice 2)', { billing: permit.billing });
      const settingSources = settingSourcesFor(hooksMode);
      const argv = buildClaudeArgv({ uuid, ...(r ? { resume: true } : {}), policyPath, mcpConfigPath, settingSources, ...(repoCtx ? { pluginDirs: repoCtx.pluginDir ? [repoCtx.pluginDir] : [], addDirs: repoCtx.memoryDirs } : {}), ...(req.systemPrompt !== undefined ? { appendSystemPrompt: req.systemPrompt } : {}), ...(req.model && req.model !== 'claude' && req.model !== 'any' ? { model: req.model } : {}) });
      const plan = sessionLaunchPlan({ policy, binaryReal: priv.exec, argv, extras }, this.#platform, this.#o.macosMajor, this.#o.sipEnabled);
      // Aegis L1: anything changed between the scan and now ⇒ scan again (a hit refuses)
      const wNow = this.#watchHashOf(layerInput);
      if (wNow !== wHash || gitHash(req.worktree ?? req.cwd) !== gHash) {
        await this.#o.log('session.layers.changed', { hsid, which: ['settings-or-git'], phase: 'pre-spawn' }, { session: hsid });
        await scan();
        wHash = wNow;
      }
      this.#refuseIfDraining('session.open'); // a drain that began during preflight: nothing is forked (the catch releases the permit)
      // #trace-capture: the human's per-folder toggle, read at every open and resume; a refused trace dir is reported on session.sandbox
      if (this.#o.traceMode?.(req.cwd) ?? traceModeOf(this.#o.home, req.cwd)) {
        try {
          trace = openTraceStream(req.cwd, hsid, { ...this.#o.traceOptions, secrets: Object.entries(env).filter(([k, v]) => SECRET_ENV.test(k) && typeof v === 'string').map(([, v]) => v) });
          trace.ctl({ event: 'spawn', argv: redactArgv(argv), envKeys, ...(r ? { resume: r.uuid } : {}) });
        } catch (e) {
          traceRefused = e instanceof TraceRefused ? e.reason : 'trace-unavailable';
        }
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
        hsid, uuid, principalId, owner: req.principal, cwd: req.cwd, ...(req.worktree ? { worktree: req.worktree } : {}), child: c, exited, spawnPermit: permit, turnPermits: [],
        watchHash: wHash, gitHash: gHash, layerInput, env, state: 'running', turns: 0, seq: 0, meter: new UsageMeter(), stderrBytes: 0, watch: null, pending: new Map(), toolNames: new Map(), requested: new Set(), planUses: new Map(), lastPlanFile: null, policy, trace,
      };
      this.#sessions.set(hsid, s);
      live = s;
      this.#wire(s); // round 3: wired BEFORE any further await — a failing row below still cleans up through the exit path
      await this.#o.log('session.sandbox', {
        hsid, sandbox: plan.sandbox, profile: 'session', profileHash: plan.profileHash, policyHash: policyHash(policy), layersHash: lHash, gitHash: gHash,
        binarySha256: `sha256:${priv.sha256}`, exec: priv.exec, version, envKeys, hooksMode, settingSources: [...settingSources], repoHooksApproved: approved.map((h) => h.hookId), permitId: permit.permitId, generated: generated ? [...generated.keys()] : [],
        ...(r ? { resumedFrom: r.drainedEventId, drainOutcome: r.outcome } : {}),
        ...(trace ? { traced: true } : traceRefused ? { traced: false, traceRefused } : {}),
      }, { session: hsid });
      if (r) {
        this.#resumed.add(hsid);
        // TD-2026-10-19-814 item 2: visible in the transcript; nothing is written to the child (no continue)
        if (r.outcome === 'interrupted') await this.#o.log('session.sandbox', { hsid, phase: 'resume-note', note: INTERRUPTED_NOTE, drainedEventId: r.drainedEventId }, { session: hsid });
      }
      return { hsid, principalId, backend: 'claude-code', state: s.state, ...(priv.pin === 'first-use' ? { binaryPin: `first-use pin ${priv.sha256} from ${priv.source}` } : {}) };
    } catch (err) {
      if (trace && !live) {
        trace.ctl({ event: 'open-failed' });
        void trace.close();
      }
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
      // Aegis L1: every refusal of a resume names why (RESUME_REFUSALS); planResume reads the row as terminal
      const rz = (cause: ResumeRefusal): Record<string, unknown> => (r ? { resume: cause } : {});
      if (err instanceof PreflightRefusal) return this.#refuse(hsid, err.code, err.message, { ...rz(err.code === 'api_billing_refused' ? 'billing-refused' : 'spawn-failed'), ...err.data });
      if (err instanceof LifecycleRefusal) return this.#refuse(hsid, 'spawn_failed', err.message, { sandbox: 'unavailable', ...rz('spawn-failed'), ...err.detail });
      if (err instanceof ManifestRefusal || err instanceof TypeError) return this.#refuse(hsid, 'spawn_failed', err.message, rz('spawn-failed'));
      if (err instanceof RefusedError) {
        await this.#o.log('session.refused', { hsid, code: 'spawn_failed', refusal: err.refusal.code, ...rz(err.refusal.code === 'PERMIT_REQUIRED' ? 'permit-unfit' : err.refusal.code === 'BILLING_REFUSED' ? 'billing-refused' : 'spawn-failed') }, { session: hsid }).catch(() => undefined);
        throw err;
      }
      return this.#refuse(hsid, 'spawn_failed', (err as Error).message, rz('spawn-failed'));
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
      split.push(chunk, (line) => {
        s.trace?.out(line); // #trace-capture: tee the line as received, before anything acts on it
        queue(() => this.#onLine(s, line));
      }, (bytes) => (s.trace?.ctl({ event: 'line-dropped', bytes }), queue(() => this.#o.log('turn.event', { hsid: s.hsid, type: 'dropped', bytes, seq: ++s.seq }, { session: s.hsid }))));
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
    if (s.trace) {
      s.trace.ctl({ event: 'exit', code: s.child.exitCode, signal: s.child.signalCode, ...(s.drained ? { drained: s.drained } : {}) });
      void s.trace.close(); // never awaited: a hung disk must not hold the exit path
    }
    this.#history.push({ hsid: s.hsid, principalId: s.principalId, state: 'exited', turns: s.turns, code: s.child.exitCode, signal: s.child.signalCode, ...(s.drained ? { drained: s.drained } : {}), ...(s.trace ? { traced: true } : {}) });
    while (this.#history.length > HISTORY_CAP) this.#history.shift();
    this.#wake();
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
        for (const t of ev.toolUses) {
          if (t.id !== null) bounded(s.toolNames, t.id, t.name);
          // item 3: plan text for an ExitPlanMode request that arrives with input:{} (2.1.302) — display only, bounded
          const inp = t.input !== null && typeof t.input === 'object' && !Array.isArray(t.input) ? (t.input as Record<string, unknown>) : null;
          if (!inp) continue;
          if (t.name === 'ExitPlanMode' && t.id !== null && typeof inp.plan === 'string' && inp.plan.length <= MAX_ATTACHED_PLAN_CHARS) bounded(s.planUses, t.id, inp.plan);
          if (t.name === 'Write' && typeof inp.file_path === 'string' && PLAN_FILE.test(inp.file_path) && typeof inp.content === 'string' && inp.content.length <= MAX_ATTACHED_PLAN_CHARS) s.lastPlanFile = inp.content;
        }
        if (ev.tokens !== null) await usage('turn.usage', s.meter.message(ev.messageId, ev.tokens));
        if (ev.quota) await this.#o.fuse.quotaError(s.hsid);
        return;
      case 'result': {
        await usage('turn.result', s.meter.result(ev.tokens), { cost: ev.costUsd, permission_denials: ev.permissionDenials, subtype: ev.subtype, isError: ev.isError });
        const head = s.turnPermits.shift(); // reviewer 7: FIFO — this result closes the oldest turn only
        if (head) await this.#o.fuse.release(head, s.owner).catch(() => undefined);
        this.#wake(); // §2.4 rule 11: a turn boundary
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
    const fromUse = ev.toolName === 'ExitPlanMode' && ev.toolUseId !== null ? s.planUses.get(ev.toolUseId) : undefined;
    const planText = ev.toolName !== 'ExitPlanMode' ? undefined : fromUse !== undefined ? { text: fromUse, source: 'tool_use' as const } : s.lastPlanFile !== null ? { text: s.lastPlanFile, source: 'plan-file' as const } : undefined;
    const plan = composePermission(ev, { repo, denyWrite: s.policy.denyWrite, ...(planText ? { planText } : {}) });
    if (plan.kind === 'auto-deny') {
      if (ev.toolName === 'AskUserQuestion') await this.#o.log('turn.ask-user', { hsid: s.hsid, toolUseId: ev.toolUseId, inputHash: plan.inputHash, cardId: null, requestId, answer: 'deny', why: plan.why }, { session: s.hsid });
      await this.#write(s, permissionDenyLine(requestId, plan.message), { answer: 'deny', requestId, why: plan.why, ...(plan.denyClass ? { denyClass: plan.denyClass } : {}) });
      return;
    }
    const b = this.#o.broker;
    const repoKey = repoKeyOf([s.cwd, ...(s.worktree ? [s.worktree] : [])]);
    if (plan.cardKind === 'permission' && b && typeof b.auto === 'function') {
      // S-L1: an exact (repo, tool, inputHash) match of a kernel-derived `always` rule ⇒ allow with no card, approval.auto first
      let rule: { ruleId: string } | null = null;
      try {
        rule = this.#o.alwaysRule?.(repoKey, ev.toolName, plan.inputHash) ?? null;
      } catch {
        rule = null; // an unreadable rule source never allows
      }
      if (rule) {
        // log-before-effect: no approval.auto row ⇒ no auto-allow; the request falls through to the card (never unanswered)
        let logged = false;
        try {
          await b.auto({ hsid: s.hsid, tool: ev.toolName, inputHash: plan.inputHash, modeRef: `rule:${rule.ruleId}` });
          logged = true;
        } catch {
          logged = false;
        }
        if (logged) {
          await this.#write(s, permissionAllowLine(requestId, structuredClone(ev.input)), { answer: 'allow', requestId, why: 'rule', modeRef: `rule:${rule.ruleId}` });
          return;
        }
      }
    }
    if (!b || typeof b.decisionOf !== 'function' || s.pending.size >= MAX_PENDING_PERMISSIONS) {
      await this.#write(s, permissionDenyLine(requestId, 'Denied: no approval surface could take this request.'), { answer: 'deny', requestId, why: !b || typeof b.decisionOf !== 'function' ? 'no-broker' : 'pending-cap' });
      return;
    }
    const entry: PendingPermission = { cardId: null, cardKind: plan.cardKind, ...(plan.questions ? { questions: plan.questions } : {}), input: structuredClone(ev.input), inputHash: plan.inputHash, toolName: ev.toolName, toolUseId: ev.toolUseId };
    s.pending.set(requestId, entry);
    let cardId: string;
    // ask-user: the answer is checked against the KERNEL-held questions before presence and before approval.decide,
    // and its text never reaches a non-sensitive row (approval.decide carries noteHash/noteBytes only)
    const qs = plan.questions;
    const ask = plan.cardKind === 'ask-user' && qs
      ? {
          timeoutMs: ASK_USER_TIMEOUT_MS,
          privateNote: true,
          checkNote: (decision: string, note: string | undefined): string | null => {
            if (decision !== 'answer') return null;
            const a = parseAskAnswer(qs, note);
            return 'error' in a ? a.error : null;
          },
        }
      : {};
    try {
      const card = await b.raise({ kind: plan.cardKind, requestedBy: s.principalId, hsid: s.hsid, attended: true, detail: plan.detail, lines: plan.lines, block: plan.block, toolInput: ev.input, tool: ev.toolName, decisions: plan.decisions as never, ...ask, ...(plan.cardKind === 'permission' ? { ruleScope: { repoKey } } : {}) });
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
    if (plan.cardKind === 'ask-user') await this.#o.log('turn.ask-user', { hsid: s.hsid, toolUseId: ev.toolUseId, inputHash: plan.inputHash, cardId, requestId, questions: qs?.length ?? 0 }, { session: s.hsid });
    if (plan.cardKind === 'plan') await this.#o.log('turn.plan',{ hsid: s.hsid, toolUseId: ev.toolUseId, inputHash: plan.inputHash, cardId, requestId }, { session: s.hsid });
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
    const note = e.cardId ? this.#o.broker?.noteOf?.(e.cardId) : undefined;
    if (e.cardKind === 'ask-user' && decision === 'answer' && e.questions) {
      // updatedInput = the KERNEL-held input + the answers validated against the kernel-held questions (re-checked here)
      const parsed = parseAskAnswer(e.questions, note);
      if (!('error' in parsed)) {
        const line = permissionAllowLine(requestId, { ...e.input, answers: parsed.answers });
        await this.#write(s, line, { answer: 'allow', requestId, cardId: e.cardId, decision, answers: Object.keys(parsed.answers).length });
        return;
      }
    }
    const a = e.cardKind ? answerFor(e.cardKind, decision, note) : { behavior: 'deny' as const, message: 'Denied.' };
    const line = a.behavior === 'allow' ? permissionAllowLine(requestId, e.input) : permissionDenyLine(requestId, a.message);
    await this.#write(s, line, { answer: a.behavior, requestId, cardId: e.cardId, decision });
  }

  /** session.inject{origin:'kernel'} (a byte COUNT and a hash, never the text), then the line — only while running. */
  async #write(s: Session, line: string, meta: Record<string, unknown>): Promise<void> {
    if (s.state !== 'running') return;
    await this.#o.log('session.inject', { hsid: s.hsid, origin: 'kernel', hash: sha(line), bytes: Buffer.byteLength(line, 'utf8'), channel: 'permission', ...meta }, { session: s.hsid });
    if (s.state !== 'running' || s.child.exitCode !== null || s.child.signalCode !== null) return;
    this.#stdin(s, line);
  }

  /** Every stdin line goes through here: #trace-capture tees it exactly as written. */
  #stdin(s: Session, line: string): void {
    s.trace?.in(line);
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
    this.#refuseIfDraining('session.send'); // §2.4 rule 11: no new turn starts once a drain began (Claude and gnomon-local)
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
    const contentHash = turnContentHash(p.text);
    await this.#o.log('session.inject', { hsid: s.hsid, origin: 'client', hash: contentHash, bytes: Buffer.byteLength(p.text, 'utf8') }, { session: s.hsid });
    await this.#o.log('turn.sent', { hsid: s.hsid, turn: turnId(s.hsid, n), permitId: permit.permitId, contentHash }, { session: s.hsid });
    this.#stdin(s, userMessageLine(p.text));
    return { turn: turnId(s.hsid, n) };
  }

  async stop(principal: string, p: { hsid: string; interrupt?: boolean }): Promise<{ signals: string[]; exited: boolean }> {
    if (this.#local.has(p.hsid)) return this.#local.stop(principal, p);
    const s = this.#get(principal, p.hsid);
    if (p.interrupt) {
      if (s.state === 'running') this.#stdin(s, controlInterruptLine());
      return { signals: ['control_request:interrupt'], exited: false };
    }
    return this.#stopSession(s, 'session.stop');
  }

  async #stopSession(s: Session, reason: string, expireWhy = 'session-exited'): Promise<{ signals: string[]; exited: boolean }> {
    if (s.state === 'exited') return { signals: [], exited: true };
    s.state = 'stopping';
    if (s.watch) clearInterval(s.watch);
    await this.#expirePending(s, expireWhy);
    const signals = ['control_request:interrupt', 'stdin:close'];
    try {
      this.#stdin(s, controlInterruptLine());
      s.trace?.ctl({ event: 'stdin-close', reason });
      s.child.stdin?.end();
    } catch {
      /* the pipe may already be gone */
    }
    const survivors = await this.#o.children.stop(s.child, reason);
    signals.push('group:staged');
    return { signals, exited: !survivors };
  }

  async #reattribute(r: ResumeInput): Promise<PermitV1> {
    if (!r.permit) throw new PreflightRefusal('spawn_failed', 'the drained session\'s permit is not on the chain', { resume: 'permit-missing' });
    if (!this.#o.fuse.reattribute) throw new PreflightRefusal('spawn_failed', 'this fuse cannot re-attribute a permit', { resume: 'permit-missing' });
    return this.#o.fuse.reattribute(r.permit, { hsid: r.hsid, principal: r.principal, drainedEventId: r.drainedEventId, drainedAt: r.drainedAt });
  }

  #refuseIfDraining(verb: string): void {
    if (this.#drain) throw refused('ENGINE', `the kernel is draining for an upgrade (§2.4 rule 11): ${verb} starts nothing new`, { reason: 'draining', verb });
  }

  #wake(): void {
    for (const w of [...this.#boundaryWaiters]) w();
  }

  /** Resolve true once `done()` holds (re-checked at every boundary), false when `ms` runs out first. */
  async #until(done: () => boolean, ms: number): Promise<boolean> {
    if (done()) return true;
    return new Promise<boolean>((resolve) => {
      const finish = (v: boolean): void => {
        clearTimeout(t);
        this.#boundaryWaiters.delete(check);
        resolve(v);
      };
      const check = (): void => {
        if (done()) finish(true);
      };
      const t = setTimeout(() => finish(done()), Math.max(0, ms));
      this.#boundaryWaiters.add(check);
    });
  }

  /** Whether a drain began (session.open / session.send refuse ENGINE{draining}). */
  draining(): boolean {
    return this.#drain !== null;
  }

  /**
   * §2.4 rule 11 (TD-2026-10-19-908; T-2026-10-19-014 B1): drain before an upgrade stop. Idempotent (a second
   * call gets the first drain). From the first call on, session.open and session.send are refused
   * ENGINE{draining}. The drain waits for the opens already past that check, then for every Claude session's
   * in-flight turns to reach their boundary (a result line), up to the deadline; a session still mid-turn then
   * gets the backend's interrupt control message (logged as session.inject{channel:'drain'}). For EVERY live
   * Claude session it then expires the session's pending cards with why `session-drained` (F4), writes
   * session.drained{uuid, reason:'upgrade'} (chain write before side effect) and stops the child, whose
   * session.exited row carries reason DRAIN_EXIT_REASONS[outcome] — the clean/interrupted record of slice B2.
   * Last, every other pending card bound to a session expires `session-drained`; a card bound to no session
   * (install, api-token, fallback) is left pending for the new kernel to raise again. gnomon-local sessions get
   * no session.drained (they cannot resume until slice B3, rule 11 "Order"): their turns are refused like
   * Claude's and the daemon's shutdown stops them (session.exited{reason:'upgrade'}).
   */
  drain(opts: DrainOptions = {}): Promise<DrainReport> {
    this.#drain ??= this.#runDrain(opts);
    return this.#drain;
  }

  async #runDrain(opts: DrainOptions): Promise<DrainReport> {
    const deadlineSource: DrainReport['deadlineSource'] = opts.deadlineMs === undefined ? 'default' : 'caller';
    const deadlineMs = opts.deadlineMs ?? DRAIN_DEADLINE_MS;
    const until = Date.now() + deadlineMs;
    const inTurn = (s: Session): boolean => s.state === 'running' && s.turnPermits.length > 0;
    await this.#until(() => this.#opening === 0, until - Date.now());
    await this.#until(() => [...this.#sessions.values()].every((s) => !inTurn(s)), until - Date.now());
    const live = [...this.#sessions.values()].filter((s) => s.state === 'running');
    const records = await Promise.all(live.map((s) => this.#drainSession(s, inTurn(s) ? 'interrupted' : 'clean', deadlineMs, deadlineSource)));
    await this.#o.broker?.expireSessionBound?.('session-drained').catch(() => []);
    return { deadlineMs, deadlineSource, sessions: records.filter((r): r is DrainRecord => r !== null) };
  }

  async #drainSession(s: Session, outcome: DrainOutcome, deadlineMs: number, deadlineSource: DrainReport['deadlineSource']): Promise<DrainRecord | null> {
    if (outcome === 'interrupted') {
      s.trace?.ctl({ event: 'drain-interrupt', deadlineMs, deadlineSource });
      // Aegis L5: a failed interrupt write is recorded, never swallowed (the drain still proceeds: the stop below ends the turn)
      await this.#write(s, controlInterruptLine(), { channel: 'drain', deadlineMs, deadlineSource }).catch(() =>
        this.#o.log('session.inject', { hsid: s.hsid, origin: 'kernel', channel: 'drain', deadlineMs, deadlineSource, failed: true }, { session: s.hsid }).catch(() => undefined),
      );
      await this.#until(() => s.state !== 'running' || s.turnPermits.length === 0, DRAIN_INTERRUPT_GRACE_MS);
    }
    if (s.state === 'exited') return null; // it ended by itself: its exit row is already written, there is nothing to resume
    await this.#expirePending(s, 'session-drained');
    const payload = { uuid: s.uuid, reason: 'upgrade' as const };
    const errors = validateKindPayload('session.drained', payload);
    if (errors.length) throw new Error(`#supervisor: session.drained payload: ${errors.join('; ')}`);
    await this.#o.log('session.drained', payload, { session: s.hsid });
    s.drained = outcome;
    await this.#stopSession(s, DRAIN_EXIT_REASONS[outcome], 'session-drained'); // F4 also for a request that arrived after the expiry above
    return { hsid: s.hsid, uuid: s.uuid, outcome };
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
      ...[...this.#sessions.values()].map((s) => ({ hsid: s.hsid, principalId: s.principalId, state: s.state, turns: s.turns, permitId: s.spawnPermit.permitId, ...(s.drained ? { drained: s.drained } : {}), ...(s.trace ? { traced: true } : {}) })),
      ...this.#history,
      ...this.#local.status(),
    ];
  }

  /** One session's state (tests, status): running | stopping | exited | null. */
  stateOf(hsid: string): string | null {
    return this.#sessions.get(hsid)?.state ?? (this.#history.some((h) => h.hsid === hsid) ? 'exited' : this.#local.stateOf(hsid));
  }
}
