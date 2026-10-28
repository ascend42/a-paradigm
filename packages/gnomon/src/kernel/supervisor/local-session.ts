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
 * SLICE C1 (#local-tool-broker, TD-2026-10-27-833; kernel/local/tool-broker.ts): at open an attended session
 *   gets ONE tools_set line (after its session.sandbox row, which names the offered tools) with the kernel SDK
 *   tools the C1 narrowing allows (offeredKernelTools: classed, never the worktree verbs); none when the
 *   supervisor serves no kernel verbs (win32) and NEVER for a loop session. The child's tool_request is a typed
 *   tool-request event: its turn.event row is hash-only (the args are model text), and it is answered OUTSIDE the
 *   stdout queue (a card may wait on a human) with tool_response; every call logs one hash-only tool.brokered row.
 *   stop (interrupt or full) and exit cancel the calls in flight; exit also expires the session's verb cards.
 * SLICE B2 (#local-working-memory, TD-2026-10-27-833; kernel/local/working-memory.ts): an ATTENDED session gets a
 *   kernel-owned WorkingMemory (<session dir>/memory.jsonl, owner = the opener) and `memory: true` in its local.yaml
 *   (the child offers note/forget). The kernel writes the goal (each new prompt; a follow_up's goal when the run
 *   before it ends), every file the session edited (write_file/edit tool ends) and the last failing tool, and
 *   answers note/forget tool_requests from the store (never the LocalToolBroker); every change is one hash-only
 *   session.memory row and, when the render changed, one memory_set line. Their tool_execution_* lines are
 *   hash-only (they carry the note text). A LOOP session has no memory (off): no store, no memory flag, no
 *   memory tools — the loop clamps are unchanged. humanRequest serves the human-only dispatcher requests
 *   request.session.compact{hsid} (compact line; the child compacts at its next model step), request.session.context
 *   {hsid, target} (clamped to [the 0.85 floor, n_ctx]; above the signed config is notify-and-proceed, labelled
 *   aboveConfig on the session.context row and the reply; a lower target re-renders memory first) and
 *   request.session.memory.delete{hsid} (live or ended; the owner recorded in memory.jsonl; the file is unlinked;
 *   one session.memory{op:'delete'} row). The session dir is never pruned while it holds memory.
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
import { releaseSession, sessionSidFor } from '../../platform/win32/session-sandbox.js';
import { HSID_PATTERN, HSID_V1_PATTERN, hsidShort, mintHsid, refuse, RefusedError, turnId, COMPACTION_REASONS, type CompactionReason, type SessionCompactedPayload, type VoiceSentBy } from '@a-company/gnomon-contracts';
import type { DaemonChildren } from '../lifecycle/children.js';
import type { BudgetFuse, PermitV1 } from '../budget/fuse.js';
import type { ApprovalBroker } from '../broker/broker.js';
import { buildSessionPolicy, policyHash, type PolicyPath, type SessionPolicy } from '../manifest/policy.js';
import { defaultClaudeJson } from '../manifest/layers.js';
import { sessionLaunchPlan, type SessionLaunchInput, type SessionLaunchPlan } from '../sandbox/session.js';
import { LifecycleRefusal } from '../lifecycle/refusal.js';
import { applyLoopEnv, buildSessionEnv, loopEnvHazard, win32SessionTempDir, DARWIN_SCREEN_TMP_FALLBACK, sessionIdentity, type SessionIdentity } from '../runner/env.js';
import { managedFiles } from '../runner/preflight.js';
import { claudeCodePlatform } from '../../platform/claude-code.js';
import type { DarwinSessionExtras } from '../../platform/darwin/session-sbpl.js';
import { LineSplitter } from '../../adapters/line-splitter.js';
import { localAdapter, type LocalAdapter, type LocalEvent } from '../../adapters/local/runner.js';
import type { UsageMeter } from '../../adapters/backend-adapter.js';
import { kernelSdkTarget, LocalToolBroker, offeredKernelTools, type BrokerTarget, type BrokeredTool } from '../local/tool-broker.js';
import { LOCAL_RESERVED_TOOL_NAMES, offerWithin, type CapabilityEntry } from '../local/capability-index.js';
import { launchCheck, serverLabel, LocalMcpPool, McpListCache, serverEnv, type LocalMcpServer, type ServerFit } from '../local/mcp-client.js';
import type { GitVerbs, VerbSession } from '../git/kernel-verbs.js';
import type { RunMode } from '@a-company/gnomon-contracts';
import { KERNEL_MCP_SERVER } from '../git/verbs.js';
import { repoKeyOf } from './repo-hooks.js';
import { inputHash } from './permission.js';
import { prepareRunner, verifyNode, type LocalRunnerPin } from '../local/runner-pin.js';
import { readParadigmPin, recheckStaged } from '../local/paradigm-stage.js';
import { assertNotClaude, DEFAULT_CONTEXT_TARGET, DEFAULT_CTX_FLOOR, LOCAL_COMPAT_NAMES, validateLocalEndpoints, type LocalLaneConfig } from '../local/config.js';
import { classifyEndpoint, loopbackPort } from '../local/endpoint.js';
import { probeLocalEndpoint, type LocalCapabilities, type ProbeFetch } from '../local/probe.js';
import { capability, routeModel, type DeclaredModel } from '../local/routing.js';
import { voiceTag, type VoiceAttribution, type VoiceTurnLink } from '../voice/voice-control.js';
import { loopRunRefInfo, type LoopRunRef, type LoopRunRefInfo } from '../loops/registry.js';
import { LOOP_ORIGIN, LOOP_SESSION_ENV_DROPPED, loopActTools } from './loop-clamp.js';
import { liveScratch, type Scratch } from '../git/scratch.js';
import { answerMemoryTool, MEMORY_FILE, MEMORY_TOOL_NAMES, memoryOwnerOf, memoryRowsOf, memorySlotTokens, WorkingMemory, type MemoryChange } from '../local/working-memory.js';
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
  broker?: Pick<ApprovalBroker, 'raise'> & Partial<Pick<ApprovalBroker, 'decisionOf' | 'expire'>>;
  /** slice C1: the kernel's own SDK server's verbs, brokered to attended local sessions (absent: no brokered tools) */
  gitVerbs?: Pick<GitVerbs, 'tools' | 'call'> & Partial<Pick<GitVerbs, 'closeSession' | 'openSession'>>;
  /** slice C1 (Aegis M3): the run-mode book (SupervisorOptions.runMode): a manual session's verbs refuse, its tools are read-only */
  runMode?: (hsid: string, repoKey: string) => { effective: RunMode } | null;
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
  /**
   * slice C2' (#local-mcp-client): the MCP servers an attended local session in `ctx.cwd` may reach — the same set a
   * Claude session gets there (McpServers.composeLocal: first-party Paradigm + the enabled servers). Absent: none.
   */
  localMcp?: (ctx: { hsid: string; cwd: string; worktree?: string }) => readonly LocalMcpServer[];
  /** slice C2': with localMcp, the same write-denies Claude sessions get (#mcp-servers: what the next session's server runs) */
  mcpDenyWrite?: (ctx: { cwd: string; worktree?: string }) => readonly PolicyPath[];
}

/** The last endpoint probe as status.local.lastProbe shows it. */
export interface LocalProbeState {
  endpoint: string;
  at: string;
  ok: boolean;
  why: string;
  error?: string;
  tools: boolean;
  contextSize: number | null;
}

/** openLoop's request (the runner's model step). */
export interface LoopOpenRequest {
  role: 'judge' | 'summarize' | 'act';
  /** role act only: the node's declared tools (the clamp admits them), its protected globs and its turn cap */
  /**
   * role act only: the node's declared tools (the clamp admits them), its protected globs, its turn cap and (TD-2026-10-23-268)
   * the values of its `env` names, read by the runner from the loop's env files (never stored; refused unless every
   * name is one the trusted node declares)
   */
  act?: { tools: readonly unknown[]; protect: readonly string[]; maxSteps: number; env?: Readonly<Record<string, string>> };
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
  meter: UsageMeter<LocalEvent>;
  /** T-2026-10-26-003: the size of the run's latest assistant text (its last message is the reply); null = no message yet */
  replyBytes?: number | null;
  /** TD-2026-10-27-833: the step cap written to this session's local.yaml; turn.result carries it so "step limit" names its number */
  maxSteps: number;
  /** slice C1: the resolved roots (the brokered kernel verbs see them as the session's cwd and worktree) */
  roots: { cwd: string; worktree?: string };
  /** slice C1: this session's brokered tools (a loop session's offers none and refuses every call) */
  tools?: LocalToolBroker;
  /** slice C2': the session's MCP servers (#local-mcp-client; attended sessions only), reaped at exit */
  mcp?: { pool: LocalMcpPool; kernel: BrokeredTool[]; entries: Map<string, CapabilityEntry[]>; manual: boolean; bound: Map<string, string>; offeredHash: string };
  /** slice C2': how this session's MCP servers are spawned (its own launch plan, env and cwd) */
  mcpLaunch?: { launch: SessionLaunchInput; env: Record<string, string | undefined>; cwd: string; servers: readonly LocalMcpServer[]; refused: Array<{ id: string; name: string; fit: ServerFit; why: string }>; failed: Array<{ label: string; error: string }>; firstParty?: { launch: SessionLaunchInput; stateDir: string; nodePin: Pick<LocalRunnerPin, 'node' | 'nodeSha256'> } };
  /** slice B2: the kernel-owned working memory (attended sessions only; a loop session has none) */
  memory?: WorkingMemory;
  /** slice B2: the hash of the last memory_set sent (a change that renders the same block sends nothing) */
  memorySent?: string;
  /** slice B2: goals of follow_ups queued behind the running turn (each becomes the goal when the run before it ends) */
  pendingGoals: Array<{ text: string; untrusted?: `tool:${string}` }>;
  /** slice B2: write_file/edit paths by toolCallId, until their tool end (bounded) */
  toolPaths: Map<string, string | null>;
  /** Aegis L1: the id of the empty block a memory delete pushed, until the child acknowledges THAT block */
  memoryDeletePending?: string;
  /** Aegis L1 (a): memory_set ids (ms-N) */
  memorySetSeq: number;
  /** slice B2: the context target in effect, the signed config's, the endpoint's n_ctx and the reply budget */
  context: { target: number; config: number; nCtx: number | null; maxTokens: number };
}

/** Slice C2' (Aegis functional note): why a server failed, in words a human can act on. */
function readableFailure(error: string, srv: LocalMcpServer | undefined, userHome: string | null): string {
  const underHome = userHome && srv && [srv.command ?? '', ...(srv.args ?? [])].some((a) => path.isAbsolute(a) && (a === userHome || a.startsWith(userHome + path.sep)));
  return underHome ? `${error} — it is installed under your home folder (nvm, ~/.npm, the uv cache…), which local sessions cannot read yet` : `${error} — it could not start or list its tools under the local session's sandbox`;
}
const userHomeOf = (h: string | undefined): string | null => (h ? path.resolve(h) : (process.env.HOME ?? null));
const serverLabelOf = (s: LocalMcpServer): string => serverLabel(s.name);

/**
 * TD-2026-10-27-833: the env the staged first-party Paradigm MCP adds to the stripped server env — HOME (USERPROFILE
 * on win32) at its per-session kernel-owned global dir, the staged mode, and git config from the env (which wins over
 * the repo's .git/config): no fsmonitor, no hooks path, no system config.
 */
export function stagedParadigmEnv(stateDir: string, platform: string): Record<string, string> {
  return {
    HOME: stateDir,
    ...(platform === 'win32' ? { USERPROFILE: stateDir } : {}),
    PARADIGM_GNOMON_STAGED: '1',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_COUNT: '2',
    GIT_CONFIG_KEY_0: 'core.fsmonitor',
    GIT_CONFIG_VALUE_0: 'false',
    GIT_CONFIG_KEY_1: 'core.hooksPath',
    GIT_CONFIG_VALUE_1: platform === 'win32' ? 'NUL' : '/dev/null',
  };
}

/** Slice C2' (Aegis M4): the hash of an offered set (names, classes, schemas, descriptions, targets). */
const offeredHash = (tools: readonly BrokeredTool[]): string => createHash('sha256').update(JSON.stringify(tools.map((t) => [t.name, t.class, t.description, t.parameters, t.target?.server ?? null]))).digest('hex');

/** Slice B2: the human-only dispatcher requests a local session serves (dispatcher-only: never §9.1 rows themselves). */
export const LOCAL_SESSION_COMPACT_REQUEST = 'request.session.compact' as const;
export const LOCAL_SESSION_CONTEXT_REQUEST = 'request.session.context' as const;
export const LOCAL_SESSION_MEMORY_DELETE_REQUEST = 'request.session.memory.delete' as const;
/** Aegis M2: the human reads a session's memory, and lists the sessions that hold memory. */
export const LOCAL_SESSION_MEMORY_READ_REQUEST = 'request.session.memory.read' as const;
export const LOCAL_SESSION_MEMORY_LIST_REQUEST = 'request.session.memory.list' as const;
export const LOCAL_SESSION_REQUESTS: readonly string[] = Object.freeze([LOCAL_SESSION_COMPACT_REQUEST, LOCAL_SESSION_CONTEXT_REQUEST, LOCAL_SESSION_MEMORY_DELETE_REQUEST, LOCAL_SESSION_MEMORY_READ_REQUEST, LOCAL_SESSION_MEMORY_LIST_REQUEST]);
/** Slice B2: the asker of a human request (stamped by the dispatcher). */
export interface LocalSessionAsker {
  connId: string;
  principal: string | undefined;
  principalClass: string;
  credential: string | undefined;
}
/** Slice B2: the smallest context target (gnomon-local MIN_CONTEXT_TARGET) and the 0.85 headroom rule. */
const MIN_CONTEXT_TARGET = 1024;
const TARGET_HEADROOM = 0.85;
const PENDING_GOALS_CAP = 32;
const TOOL_PATHS_CAP = 256;
/** The files whose successful tool end records a file-ref. */
const EDIT_TOOLS: readonly string[] = Object.freeze(['write_file', 'edit']);

/** A target with no tools (no kernel verbs served): every brokered call is unknown-tool. */
const NO_TARGET: BrokerTarget = { server: KERNEL_MCP_SERVER, provenance: 'kernel', ownsGate: false, list: async () => [], call: async () => ({ text: 'no such tool', isError: true }) };
/** Aegis L7: past this many bytes queued on a child's stdin (it stopped reading), the session is stopped. */
export const CHILD_STDIN_HIGH_WATER = 8 * 1024 * 1024;

function refused(code: Parameters<typeof refuse>[0]['code'], message: string, data: Record<string, unknown> = {}): RefusedError {
  return new RefusedError(refuse({ code, data }), `#local-runner: ${message}`);
}

/** #backend-adapter: this lane's wire codec (argv, parse, meter, turn / interrupt lines, steer and tool-broker channels). */
const drv: LocalAdapter = localAdapter;
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
export function compactedPayloadOf(hsid: string, turn: string | null, ev: LocalEvent): SessionCompactedPayload | null {
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
  /** slice C2': each MCP server's last tools/list per launch + repo (a hit spawns nothing until the first call) */
  readonly #mcpCache = new McpListCache();
  readonly #history: Array<Record<string, unknown>> = [];
  readonly #usedTurnPermits = new Set<string>();
  readonly #probes = new Map<string, { at: number; caps: LocalCapabilities }>();
  readonly #platform: string;
  readonly #identity: SessionIdentity | null;
  readonly #sessionPath: string | null;
  /** the root-signed lane config; replaced by setConfig (TD-2026-10-22-769 hot apply). A live session keeps its spawn-time copy. */
  #config: LocalLaneConfig | undefined;
  /** status.local.lastProbe / lastFallback (Mika: the Settings section's health rows) */
  #lastProbe: LocalProbeState | null = null;
  /** status.local.probing: the probes of a configured endpoint in flight (the automatic one and Check again) */
  readonly #probing = new Map<symbol, { endpoint: string; since: string }>();
  /** bumped by setConfig: a probe that started under an older config records nothing */
  #gen = 0;
  #lastFallback: { at: string; cardId: string | null; cwd: string; title: string | null; reason: string; outcome: string } | null = null;

  constructor(o: LocalLaneOptions) {
    this.#o = o;
    this.#config = o.config;
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

  /**
   * TD-2026-10-22-769: apply a newly loaded root-signed config (or none) without a restart. The probe cache is cleared
   * (an endpoint id may now name another base or model); sessions already running keep the config they were spawned
   * with (#spawn copies what it needs).
   */
  setConfig(config: LocalLaneConfig | undefined): void {
    this.#config = config;
    this.#gen++;
    this.#probes.clear();
    this.#lastProbe = null;
  }

  /** status.local.probing: the oldest probe of a configured endpoint in flight (its endpoint and start), or null. */
  probing(): { endpoint: string; since: string } | null {
    let first: { endpoint: string; since: string } | null = null;
    for (const p of this.#probing.values()) if (!first || p.since < first.since) first = p;
    return first;
  }

  /**
   * A probe of the configured endpoint whose base, model and compat these are (Check again, request.local.probe): its
   * id, or null when no configured endpoint matches (a check of an unsaved address records nothing here).
   */
  configuredEndpoint(ep: { base: string; model: string; compat: string }): string | null {
    const norm = (b: string): string => b.replace(/\/+$/, '');
    return this.#config?.endpoints.find((e) => norm(e.base) === norm(ep.base) && e.model === ep.model && e.compat === ep.compat)?.id ?? null;
  }

  /** Mark a probe of configured endpoint `id` in flight (status.local.probing); the returned function ends it. */
  beginProbe(id: string): () => void {
    const token = Symbol(id);
    this.#probing.set(token, { endpoint: id, since: new Date().toISOString() });
    return () => void this.#probing.delete(token);
  }

  /**
   * A fresh probe of configured endpoint `id` landed outside the open path (Check again): it refreshes the probe cache
   * and status.local.lastProbe, as the automatic probe does. `why` overrides the capability reason (model-missing).
   * A probe begun under an older config (`gen`, from probeGen) records nothing.
   */
  recordProbe(id: string, caps: LocalCapabilities, o: { why?: string; gen?: number } = {}): void {
    if (o.gen !== undefined && o.gen !== this.#gen) return;
    if (!this.#config?.endpoints.some((e) => e.id === id)) return;
    this.#probes.set(id, { at: Date.now(), caps });
    this.#setLastProbe(id, caps, o.why);
  }

  /** The config generation (recordProbe's `gen`: read it before the probe starts). */
  probeGen(): number {
    return this.#gen;
  }

  #setLastProbe(id: string, caps: LocalCapabilities, why?: string): void {
    const k = capability(caps, this.#config?.ctxFloor ?? DEFAULT_CTX_FLOOR, false);
    this.#lastProbe = { endpoint: id, at: new Date().toISOString(), ok: k.capable && why === undefined, why: why ?? k.reason, ...(caps.error ? { error: caps.error.slice(0, 200) } : {}), tools: caps.tools, contextSize: caps.nCtx };
  }

  /** The last probe of any endpoint (state for Settings: ok, why, tools, context), or null since the config applied. */
  lastProbe(): Readonly<LocalProbeState> | null {
    return this.#lastProbe;
  }

  /** The last fallback card a model:local open raised (its outcome follows the decision), or null. */
  lastFallback(): Readonly<{ at: string; cardId: string | null; cwd: string; title: string | null; reason: string; outcome: string }> | null {
    return this.#lastFallback;
  }

  /** The config new opens use (status, tests). */
  config(): LocalLaneConfig | undefined {
    return this.#config;
  }

  #forbiddenPorts(): number[] {
    const p = this.#o.endpointPort?.();
    return typeof p === 'number' ? [p] : [];
  }

  async #probe(ep: { id: string; base: string; model: string }): Promise<LocalCapabilities> {
    const hit = this.#probes.get(ep.id);
    if (hit && Date.now() - hit.at < (this.#o.probeTtlMs ?? 60_000)) return hit.caps;
    const gen = this.#gen;
    const end = this.beginProbe(ep.id);
    let caps: LocalCapabilities;
    try {
      caps = await probeLocalEndpoint(ep, { forbiddenPorts: this.#forbiddenPorts(), ...(this.#o.probeFetch ? { fetch: this.#o.probeFetch } : {}) });
    } finally {
      end();
    }
    await this.#o.log('model.probe', { endpoint: ep.id, ok: caps.ok, ...(caps.error ? { error: caps.error } : {}) });
    if (caps.ok) await this.#o.log('model.capabilities', { backend: 'local', endpoint: ep.id, model: caps.model, tools: caps.tools, ctx: caps.nCtx, ctxSource: caps.nCtxSource, templateTools: caps.templateTools });
    if (gen === this.#gen) {
      // a probe begun under an older config neither caches nor shows (setConfig cleared both)
      this.#probes.set(ep.id, { at: Date.now(), caps });
      this.#setLastProbe(ep.id, caps);
    }
    return caps;
  }

  /**
   * The daemon-start probe (§13.2 "records model.probe + model.capabilities for each configured endpoint"): every
   * endpoint that passes the loopback/LAN rule is probed once (cached for the next open); a refused one is skipped
   * here and refused at open (G-SUB-06). Never throws.
   */
  async probeAll(): Promise<Array<{ endpoint: string; ok: boolean }>> {
    const out: Array<{ endpoint: string; ok: boolean }> = [];
    for (const ep of this.#config?.endpoints ?? []) {
      const v = classifyEndpoint(ep.base, this.#forbiddenPorts());
      if (!v.ok || !LOCAL_COMPAT_NAMES.includes(ep.compat) || loopbackPort(v.base) === null) continue; // Aegis L3: loopback only in 8.0
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
    const cfg: LocalLaneConfig = this.#config ?? { endpoints: [] };
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
    let act: { scratch: Readonly<Scratch>; tools: string[]; protect: string[]; maxSteps: number; named?: Record<string, string> } | null = null;
    if (req.role === 'act') {
      const scratch = liveScratch(info.runId);
      if (!req.act || !scratch || scratch.loopId !== info.loopId) throw refused('FORBIDDEN', 'an act step works only in its run\'s scratch worktree', { reason: 'no-scratch' });
      const tools = loopActTools(req.act.tools, info.trustCard);
      if (!tools.length) throw refused('FORBIDDEN', 'the loop\'s trust card admits no tools for this act step', { reason: 'no-trusted-tools' });
      const protect = req.act.protect.filter((g): g is string => typeof g === 'string' && g.length > 0 && g.length <= 512);
      // TD-2026-10-23-268 (Aegis F4): the act env is bounded by the TRUSTED node (the registry's run reference, at the
      // run's content hash): a name it does not declare, or a hazard, is refused and nothing spawns
      const named: Record<string, string> = {};
      for (const [k, v] of Object.entries(req.act.env ?? {})) {
        const why = loopEnvHazard(k);
        if (why || !info.nodeEnv.includes(k) || typeof v !== 'string' || v.length === 0) throw refused('FORBIDDEN', `env ${k.slice(0, 64)} is not one the trusted act node declares${why ? ` (${why})` : ''}`, { reason: 'env-not-declared' });
        named[k] = v;
      }
      act = { scratch, tools, protect, maxSteps: Math.max(1, Math.min(128, Math.floor(req.act.maxSteps) || 1)), ...(Object.keys(named).length ? { named } : {}) };
    } else if (req.act) throw refused('BAD_REQUEST', 'act options are for act steps', { reason: 'bad-params' });
    if (req.signal?.aborted) throw new LoopModelUnavailable('aborted');
    const cfg: LocalLaneConfig = this.#config ?? { endpoints: [] };
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
        s.child.stdin?.write(drv.interruptLine());
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
    s.child.stdin?.write(drv.turnLine({ text, inFlight: false }));
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
          if (this.#lastFallback?.cardId === card.cardId) this.#lastFallback = { ...this.#lastFallback, outcome: decision };
          await this.#o.log('model.fallback.decided', { cardId: card.cardId, decision });
          // S7: the ONLY way a model:local request reaches claude — a human's fallback-cloud decision
          if (decision === 'fallback-cloud') await openClaude({ ...req, backend: 'claude-code', model: 'claude' });
        },
      });
      cardId = card.cardId;
    }
    // the session has no title yet (it never opened): the GUI names it by its folder
    this.#lastFallback = { at: new Date().toISOString(), cardId, cwd: req.cwd, title: null, reason, outcome: cardId ? 'pending' : 'no-card' };
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

  async #spawn(req: LocalOpenRequest, declared: DeclaredModel, reason: string, tools: 'native' | 'text', ep: LocalLaneConfig['endpoints'][number], base: string, caps: LocalCapabilities, cfg: LocalLaneConfig, loop?: { info: Readonly<LoopRunRefInfo>; maxTokens: number; act?: { scratch: Readonly<Scratch>; tools: string[]; protect: string[]; maxSteps: number; endpointPort: number; named?: Record<string, string> } }): Promise<{ hsid: string; principalId: string; backend: 'local'; state: string; model: string }> {
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
    await this.#o.log('session.open', { hsid, principalId, by: req.principal, cwd: req.cwd, worktree: req.worktree ?? null, roots: rootsReal, backend: 'local', model, declaredModel: declared, endpoint: ep.id, attended: !loop, ...(loopRun ? { principalClass: req.principalClass, origin: LOOP_ORIGIN, loopRun } : { principalClass: req.principalClass }) }, { session: hsid }); // Aegis L2 (#folder-picker): every row names its opener's class
    await this.#o.log('session.routed', { hsid, declared, chosen: 'local', reason, tools: loop && !loop.act ? 'none' : tools, ...(loop?.act ? { allowTools: loop.act.tools } : {}) }, { session: hsid });
    const dir = path.join(this.#o.home, 'sessions', hsidShort(hsid));
    const built = buildSessionEnv({ from: { ...(this.#o.env?.() ?? process.env), HOME: userHome }, hsid, sock: this.#o.sock, sessionKeyPath: path.join(dir, 'session.key'), identity: this.#identity, path: this.#sessionPath, ...(this.#platform === 'win32' ? { tempDir: win32SessionTempDir(hsid) } : {}) });
    const env = built.env;
    let envKeys = built.envKeys;
    if (loop) {
      // LL5: a loop session talks to nothing but its model endpoint (no socket, no session key: no loop.request)
      for (const k of LOOP_SESSION_ENV_DROPPED) delete env[k];
      envKeys = envKeys.filter((k) => !LOOP_SESSION_ENV_DROPPED.includes(k));
      // an act session's TMPDIR is its run's private tmp (the only other place the loop-act profile lets it write)
      if (loop.act) env.TMPDIR = loop.act.scratch.tmp;
      // TD-2026-10-23-268: exactly the variables the trusted act node names (bounded and hazard-checked in openLoop)
      if (loop.act?.named) {
        applyLoopEnv(env, loop.act.named);
        envKeys = [...new Set([...envKeys, ...Object.keys(loop.act.named)])].sort();
      }
    }
    let permit: PermitV1 | null = null;
    let child: ChildProcess | null = null;
    let tracked = false;
    let live: LocalSession | null = null;
    /** slice C2': the neutral MCP cwd this open made (removed if the open fails) */
    let neutralMade: string | null = null;
    /** TD-2026-10-27-833: the staged Paradigm server's global dir this open made (removed if the open fails) */
    let stateMade: string | null = null;
    try {
      // a loop step's permit: scope.loop is the PAYING loop (the root caller), scope.user the human who trusted it
      permit = await this.#o.fuse.reserve({ principal: req.principal, principalClass: req.principalClass, attended: !loop, kind: 'session.spawn', backend: 'local', model, scope: { user: loop?.info.trustedBy ?? req.principal, session: hsid, repo, ...(loop ? { loop: loop.info.rootKey } : {}) }, ...(loop ? { limits: { tokens: loop.maxTokens } } : {}) });
      this.assertLocalPermit(permit, hsid);
      const row = claudeCodePlatform(this.#platform);
      const userClaudeDir = path.join(userHome, row?.userClaudeDir ?? '.claude');
      // the SAME session profile as claude -p (§15.5): keys/warpline/link/head unreadable, settings layers + linked mods unwritable
      // slice C2' (Aegis H1): the servers this session may run are fixed HERE, before its profile, so the profile
      // write-denies every launch-closure path inside the roots (a model-written file never decides what a server runs)
      let mcpServers: LocalMcpServer[] = [];
      if (!loop && this.#o.localMcp) {
        try {
          mcpServers = [...this.#o.localMcp({ hsid, cwd: cwdReal, ...(wtReal ? { worktree: wtReal } : {}) })];
        } catch {
          mcpServers = [];
        }
      }
      // Aegis H1 (re-check): servers run in a NEUTRAL cwd (empty, kernel-made, write-denied, under the Gnomon home and
      // outside every root) and are refused launch-writable when anything that decides what they run is in a root
      const neutralCwd = path.join(this.#o.home, 'sessions', `${hsidShort(hsid)}-mcp`); // a sibling of the session dir, never inside it
      // TD-2026-10-27-833: the staged first-party Paradigm MCP runs with the runner's PINNED node (one node trust root,
      // verifyNode'd by prepareRunner and again right before spawn), HOME at an empty per-session kernel-owned global
      // dir (never the user's ~/.paradigm), the staged mode on and git's fsmonitor and hooks off
      const stateDir = path.join(this.#o.home, 'sessions', `${hsidShort(hsid)}-pg`);
      mcpServers = mcpServers.map((m) => (m.staged ? { ...m, command: runner.command, env: { ...(m.env ?? {}), ...stagedParadigmEnv(stateDir, this.#platform) } } : m));
      const closure = launchCheck(mcpServers, { roots: [cwdReal, ...(wtReal ? [wtReal] : [])], cwd: neutralCwd, sessionPath: env.PATH, home: userHome });
      const policyInput: Parameters<typeof buildSessionPolicy>[0] = {
        home: this.#o.home,
        cwd: cwdReal,
        ...(wtReal ? { worktree: wtReal } : {}),
        userClaudeDir,
        userClaudeJson: defaultClaudeJson(userClaudeDir),
        userHome,
        managedSettingsPaths: row ? managedFiles(row) : [],
        linkedFolders: this.#o.linkedFolders?.() ?? [],
        endpointPort: this.#o.endpointPort?.() ?? null,
        // slice C2': a session that can run MCP servers cannot swap what the next session's servers run
        extraDenyWrite: [...this.#o.pathDenies, ...(closure.servers.length && this.#o.mcpDenyWrite ? this.#o.mcpDenyWrite({ cwd: cwdReal, ...(wtReal ? { worktree: wtReal } : {}) }) : [])],
        localRunner: { node: pin.node, dir: pin.dir },
        // T-2026-10-18-010: the home is read-denied; only this session's dir (local.yaml) and the staged runner copy are readable
        homeReadable: [{ path: dir, match: 'subpath' }, { path: runner.copy, match: 'subpath' }],
        // T-2026-10-23-004: deny-by-default writes — the OS temp dir stays writable
        ...(this.#platform !== 'win32' ? { tmpdir: os.tmpdir() } : {}),
      };
      const policy: SessionPolicy = buildSessionPolicy(policyInput);
      // Aegis H2: an MCP server's OWN profile: the session's, minus the session dir and the runner copy (no session
      // key, local.yaml or memory.jsonl is readable to third-party code)
      // Aegis H1: the neutral cwd is its only readable home path (empty: made 0700, then 0500 once it exists)
      let mcpPolicy: SessionPolicy | null = null;
      let paradigmPolicy: SessionPolicy | null = null;
      if (closure.servers.length) {
        // Aegis (final H1 lows): made non-recursively; an existing one is used only when it is an empty, owned, real
        // directory (never a symlink); the chmod never follows a link
        fs.mkdirSync(path.dirname(neutralCwd), { recursive: true, mode: 0o700 });
        try {
          fs.mkdirSync(neutralCwd, { mode: 0o700 });
          neutralMade = neutralCwd;
        } catch (e) {
          if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
          const st = fs.lstatSync(neutralCwd);
          const owned = this.#platform === 'win32' || st.uid === process.getuid?.();
          if (st.isSymbolicLink() || !st.isDirectory() || !owned || fs.readdirSync(neutralCwd).length) throw refused('UNSUPPORTED', 'the neutral MCP directory exists and is not an empty directory of the kernel user', { session: 'spawn_failed' });
          neutralMade = neutralCwd;
        }
        if (this.#platform !== 'win32' && !fs.lstatSync(neutralCwd).isSymbolicLink()) fs.chmodSync(neutralCwd, 0o500);
        mcpPolicy = buildSessionPolicy({ ...policyInput, homeReadable: [{ path: realRoot(neutralCwd) ?? neutralCwd, match: 'subpath' }], extraDenyWrite: [...(policyInput.extraDenyWrite ?? []), { path: realRoot(neutralCwd) ?? neutralCwd, match: 'subpath', class: 'binary' }] });
        // TD-2026-10-27-833: the staged Paradigm server's OWN profile — third-party servers keep the neutral cwd only;
        // this one also reads its staged dir and reads/writes its per-session global dir, and never the user's
        // ~/.paradigm or ~/.conductor
        const fpStaged = closure.servers.find((m) => m.staged);
        if (fpStaged?.staged) {
          fs.mkdirSync(stateDir, { mode: 0o700 }); // non-recursive: an existing (planted) dir fails the open
          stateMade = stateDir;
          const stateReal = realRoot(stateDir);
          paradigmPolicy = buildSessionPolicy({
            ...policyInput,
            homeReadable: [{ path: realRoot(neutralCwd), match: 'subpath' }, { path: fpStaged.staged.dir, match: 'subpath' }, { path: stateReal, match: 'subpath' }],
            extraDenyWrite: [...(policyInput.extraDenyWrite ?? []), { path: realRoot(neutralCwd), match: 'subpath', class: 'binary' }],
            extraDenyRead: ['.paradigm', '.conductor'].map((n) => ({ path: path.join(userHome, n), match: 'subpath' as const, class: 'keys' as const })),
            mcpStateDir: stateReal,
          });
          if (paradigmPolicy.mcpStateRefused) throw refused('UNSUPPORTED', `the Paradigm MCP state dir was withheld: ${paradigmPolicy.mcpStateRefused}`, { session: 'spawn_failed' });
        }
      }
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
        // slice B2: kernel working memory for attended sessions only (a loop session's memory is off)
        ...(loop ? {} : { memory: true }),
      };
      fs.writeFileSync(configPath, `${JSON.stringify(sessionCfg, null, 2)}\n`, { mode: 0o600 });
      // Aegis (C2' re-check, low): the runner speaks stdio only (gnomon-local never reads GNOMON_SOCK) and MCP servers
      // never need the kernel: both profiles deny connecting to the kernel socket (the agentSockets path-literal deny)
      const extras: DarwinSessionExtras = { uid: process.getuid?.() ?? 0, tmpdir: (this.#platform === 'win32' ? env.TEMP : env.TMPDIR) ?? DARWIN_SCREEN_TMP_FALLBACK, home: userHome, roots: rootsReal, ...(path.isAbsolute(this.#o.sock) ? { agentSockets: [this.#o.sock] } : {}) };
      const launch: SessionLaunchInput = { policy, binaryReal: runner.command, argv: [runner.entry, ...drv.argv({ configPath, hsid })], extras, hsid };
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
      const s: LocalSession = { hsid, cwd: wtReal ?? cwdReal, principalId, owner: req.principal, model, child: c, exited, spawnPermit: permit, turnPermits: [], state: 'running', turns: 0, seq: 0, meter: drv.newMeter(), maxSteps: sessionCfg.maxSteps, roots: { cwd: cwdReal, ...(wtReal ? { worktree: wtReal } : {}) }, pendingGoals: [], memorySetSeq: 0, toolPaths: new Map(), context: { target: sessionCfg.contextTarget, config: cfg.contextTarget ?? DEFAULT_CONTEXT_TARGET, nCtx: caps.nCtx, maxTokens: sessionCfg.maxTokens }, ...(loop ? {} : { memory: new WorkingMemory({ file: path.join(dir, MEMORY_FILE), hsid, owner: req.principal }) }), ...(loop ? { loop: { info: loop.info, reply: null, tokens: 0, fatal: null, pending: null, ...(loop.act ? { act: { scratch: loop.act.scratch, hits: [] } } : {}) } } : {}) };
      // Aegis H2: the servers get their own policy and an env without any kernel credential or handle
      if (mcpPolicy) s.mcpLaunch = { launch: { ...launch, policy: mcpPolicy }, env: serverEnv(env, undefined, LOOP_SESSION_ENV_DROPPED), cwd: neutralCwd, servers: closure.servers, refused: closure.refused, failed: [], ...(paradigmPolicy && stateMade ? { firstParty: { launch: { ...launch, policy: paradigmPolicy }, stateDir: stateMade, nodePin: { node: pin.node, nodeSha256: pin.nodeSha256 } } } : {}) };
      else if (closure.refused.length) s.mcpLaunch = undefined;
      this.#sessions.set(hsid, s);
      live = s;
      // slice C1: the brokered tools (a loop session: none, every call refused), built before stdout is read (Aegis L7)
      s.tools = await this.#toolBroker(s);
      this.#wire(s);
      const offered = s.tools.offered.map((t) => t.name);
      await this.#o.log('session.sandbox', { hsid, sandbox: plan.sandbox, ...(plan.partial?.length ? { partial: [...plan.partial] } : {}), profile: actLaunch ? 'loop-act' : 'session', profileHash: plan.profileHash, policyHash: policyHash(policy), backend: 'local', runner: runner.command, runnerEntry: runner.entry, runnerTree: pin.treeSha256, envKeys, permitId: permit.permitId, ...(loop ? { origin: LOOP_ORIGIN } : { brokeredTools: offered }) }, { session: hsid });
      if (offered.length) this.#write(s, drv.toolsSetLine(s.tools.offered));
      return { hsid, principalId, backend: 'local', state: s.state, model };
    } catch (err) {
      // slice C2': a failed open removes the neutral MCP cwd it made
      if (neutralMade && !live) {
        try {
          fs.chmodSync(neutralMade, 0o700);
          fs.rmSync(neutralMade, { recursive: true, force: true });
        } catch {
          /* gone */
        }
      }
      if (stateMade && !live) fs.rmSync(stateMade, { recursive: true, force: true });
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
        // slice B2: the session dir is never pruned while it holds working memory (kept until the human deletes it)
        if (!fs.existsSync(path.join(dir, MEMORY_FILE))) fs.rmSync(dir, { recursive: true, force: true });
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
      // Aegis M1: the receipt time is stamped HERE, before the queue (a brokered call's deadline counts from it)
      split.push(chunk, (line) => {
        const at = Date.now();
        // Aegis N4: a tool_cancel is honoured HERE, ahead of the serial queue (it only removes privilege); its
        // turn.event row is still written in order below
        if (line.length < 256 && line.includes('"tool_cancel"')) {
          const ev = drv.parse(line);
          if (ev.kind === 'tool-cancel' && ev.id !== null) s.tools?.cancel(ev.id);
        }
        queue(() => this.#onLine(s, line, at));
      }, (bytes) => queue(() => this.#o.log('turn.event', { hsid: s.hsid, type: 'dropped', bytes, seq: ++s.seq }, { session: s.hsid })));
    });
    s.child.stdin?.on('error', () => undefined);
    void s.exited.then(() => queue(() => this.#onExit(s)));
  }

  /** Slice C1: the session's brokered tools — the kernel SDK server's (C1 narrowing), none for a loop session. */
  async #toolBroker(s: LocalSession): Promise<LocalToolBroker> {
    const verbs = s.loop ? undefined : this.#o.gitVerbs;
    const target = verbs ? kernelSdkTarget(verbs, () => (s.state === 'running' ? this.#verbSession(s) : null)) : NO_TARGET;
    // Aegis M3: a session in manual mode at open is offered no mutate/destructive tool at all
    const manual = this.#mode(s) === 'manual';
    const kernelTools = verbs ? await offeredKernelTools(target, { manual }).catch(() => []) : [];
    // Aegis N5: an hsid opened here is never a closed one (a same-process resume)
    if (verbs) this.#o.gitVerbs?.openSession?.(s.hsid);
    // slice C2': the session's MCP servers, narrowed (#capability-index); a loop session gets none
    let tools: BrokeredTool[] = kernelTools;
    if (!s.loop && s.mcpLaunch) {
      // exactly the servers whose launch closure the session profile write-denies (fixed at open)
      const servers = s.mcpLaunch.servers;
      if (servers.length) {
        const pool = new LocalMcpPool({ servers, repo: s.cwd, cache: this.#mcpCache, spawn: (srv) => this.#spawnMcp(s, srv), onChanged: (label, entries) => this.#mcpChanged(s, label, entries),
          // Aegis M3: stopped with the daemon too (kind mcp-server: no session rows)
          track: (child, label) => void this.#o.children.track({ kind: 'mcp-server', child, hsid: s.hsid, name: `mcp:${label}` }).catch(() => undefined) });
        s.mcp = { pool, kernel: kernelTools, entries: new Map(), manual, bound: new Map(), offeredHash: '' };
        const ix = await pool.index();
        // functional note (Aegis): a server that cannot start under the local profile says why, readably
        s.mcpLaunch.failed = ix.failed.map((f) => ({ label: f.label, error: readableFailure(f.error, servers.find((x) => serverLabelOf(x) === f.label), userHomeOf(this.#o.userHome)) }));
        for (const label of pool.labels) s.mcp.entries.set(label, ix.entries.filter((e) => e.server === label));
        tools = this.#mcpOffer(s);
        s.mcp.offeredHash = offeredHash(tools);
      }
    }
    return new LocalToolBroker({ hsid: s.hsid, principalId: s.principalId, repo: s.roots.worktree ?? s.roots.cwd, loop: s.loop !== undefined, log: this.#o.log, ...(this.#o.broker ? { broker: this.#o.broker } : {}), target, tools, running: () => s.state === 'running', progress: (id) => this.#write(s, drv.toolProgressLine(id)), manual: () => this.#mode(s) === 'manual' });
  }

  /**
   * Slice C2': the offered set — the kernel verbs, then narrow tools in index order (servers in compose order, Paradigm
   * first) while they fit the ledger's tools slot (offerWithin: toolsSlotTokens of the session's context target);
   * a manual session gets read-class narrow tools only (Aegis M3). C3' replaces this rule with selection.
   */
  #mcpOffer(s: LocalSession): BrokeredTool[] {
    const m = s.mcp!;
    // Aegis M4: a name once offered from one server is never rebound to another in this session; Aegis L3: names are
    // de-duplicated (first in index order wins) BEFORE the budget
    const seen = new Set<string>();
    const all = [...m.entries.values()].flat().filter((e) => {
      if ((m.manual && e.class !== 'read') || seen.has(e.name)) return false;
      const b = m.bound.get(e.name);
      if (b !== undefined && b !== e.server) return false;
      seen.add(e.name);
      return true;
    });
    const chosen = offerWithin(m.kernel, all, { contextTarget: s.context.target, reserved: LOCAL_RESERVED_TOOL_NAMES });
    for (const e of chosen) if (!m.bound.has(e.name)) m.bound.set(e.name, e.server);
    return [...m.kernel, ...chosen.flatMap((e) => {
      const target = m.pool.target(e.server);
      return target ? [{ name: e.name, description: e.description, parameters: e.parameters, class: e.class, entry: e, target }] : [];
    })];
  }

  /** Slice C2': why this session's MCP servers were refused or failed (readable; no GUI surface yet). */
  mcpReport(hsid: string): { refused: Array<{ id: string; name: string; fit: string; why?: string }>; failed: Array<{ label: string; error: string }>; firstParty: { staged: boolean; version: string | null; treeSha256: string | null; source: string | null; sourceKind: string | null; dirty: boolean | null } } | null {
    const s = this.#sessions.get(hsid);
    if (!s?.mcpLaunch) return null;
    // TD-2026-10-27-833: what the staged Paradigm MCP of this session is (the pin it verified at open)
    const pin = s.mcpLaunch.firstParty ? readParadigmPin(this.#o.home) : null;
    return { refused: [...s.mcpLaunch.refused, ...(s.mcp?.pool.refused ?? [])], failed: [...s.mcpLaunch.failed], firstParty: { staged: !!pin, version: pin?.version ?? null, treeSha256: pin?.treeSha256 ?? null, source: pin?.source ?? null, sourceKind: pin?.sourceKind ?? null, dirty: pin?.dirty ?? null } };
  }

  /** Slice C2': a server's notifications/tools/list_changed — re-narrowed, re-offered, one new tools_set. */
  #mcpChanged(s: LocalSession, label: string, entries: CapabilityEntry[]): void {
    if (!s.mcp || !s.tools || s.state !== 'running') return;
    s.mcp.entries.set(label, entries);
    const tools = this.#mcpOffer(s);
    // Aegis M4: a tools_set only when the offered set actually changed
    const h = offeredHash(tools);
    if (h === s.mcp.offeredHash) return;
    s.mcp.offeredHash = h;
    s.tools.setTools(tools);
    this.#write(s, drv.toolsSetLine(s.tools.offered));
  }

  /** Slice C2': one MCP server of a local session, spawned under the SESSION's own launch plan (its files, its network). */
  #spawnMcp(s: LocalSession, srv: LocalMcpServer): ChildProcess {
    const m = s.mcpLaunch;
    if (!m || !srv.command || s.state !== 'running') throw new Error('the session is not running');
    // TD-2026-10-27-833: the staged Paradigm server spawns under its OWN profile, and only after a synchronous node
    // re-hash and a size/mtime/inode re-check of every staged file (nothing awaits between these and spawn)
    const fp = srv.staged ? m.firstParty : undefined;
    if (srv.staged) {
      if (!fp) throw new Error('pin-mismatch: no profile for the staged Paradigm MCP');
      const changed = recheckStaged(srv.staged.snapshot);
      let nodeOk = true;
      try {
        nodeOk = verifyNode(fp.nodePin) === srv.command;
      } catch {
        nodeOk = false;
      }
      if (changed || !nodeOk) {
        const why = changed ?? 'the pinned node changed';
        void this.#o.log('session.sandbox', { hsid: s.hsid, phase: 'mcp-pin-mismatch', server: 'paradigm', why }, { session: s.hsid }).catch(() => undefined);
        throw new Error(`pin-mismatch: ${why}`);
      }
    }
    const input: SessionLaunchInput = { ...(fp ? fp.launch : m.launch), binaryReal: srv.command, argv: [...(srv.args ?? [])] };
    const plan = this.#o.launchPlan ? this.#o.launchPlan(input) : sessionLaunchPlan(input, this.#platform, this.#o.macosMajor, this.#o.sipEnabled);
    const env = serverEnv(m.env, srv.env, LOOP_SESSION_ENV_DROPPED);
    // Aegis H1: the neutral cwd, never the repo (the repo reaches the server only through its expanded args/env)
    return spawn(plan.command, plan.args, { cwd: m.cwd, env, detached: this.#platform !== 'win32', windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] });
  }

  /** Aegis M3: the session's effective run mode from the run-mode book, as Claude sessions read it (unreadable ⇒ manual). */
  #mode(s: LocalSession): RunMode {
    try {
      const m = this.#o.runMode?.(s.hsid, repoKeyOf([s.roots.cwd, ...(s.roots.worktree ? [s.roots.worktree] : [])]))?.effective ?? 'ask';
      // a local session never runs auto-edits through a verb: ask stands in for it (one card per verb, always)
      return m === 'manual' ? 'manual' : 'ask';
    } catch {
      return 'manual'; // an unreadable mode never loosens anything
    }
  }

  /**
   * Slice C1: what a kernel verb knows of a local session: its run mode (manual or ask; Aegis M3), never plan-approved
   * (a local session has no plan approval yet), never guarded worktrees (no kernel-worktree denies in its profile). The
   * brokered path adds local, the call's signal and deadline (kernelSdkTarget).
   */
  #verbSession(s: LocalSession): VerbSession {
    const roots = [s.roots.cwd, ...(s.roots.worktree ? [s.roots.worktree] : [])];
    return { hsid: s.hsid, principalId: s.principalId, cwd: s.roots.cwd, ...(s.roots.worktree ? { worktree: s.roots.worktree } : {}), repoKey: repoKeyOf(roots), mode: this.#mode(s), planApproved: false, loop: s.loop !== undefined, worktreesGuarded: false, local: true };
  }

  /** Aegis L7: write to the child's stdin; a child that stopped reading (past CHILD_STDIN_HIGH_WATER) is stopped. */
  #write(s: LocalSession, line: string): void {
    const w = s.child.stdin;
    if (!w || s.state !== 'running') return;
    if (w.writableLength > CHILD_STDIN_HIGH_WATER) {
      s.state = 'stopping';
      s.tools?.cancelAll();
      void this.#o.log('session.refused', { hsid: s.hsid, code: 'stdin-backpressure', backend: 'local', queuedBytes: w.writableLength }, { session: s.hsid }).catch(() => undefined);
      void this.#o.children.stop(s.child, 'stdin-backpressure').catch(() => undefined);
      return;
    }
    try {
      w.write(line);
    } catch {
      /* the pipe may already be gone */
    }
  }

  /** Slice B2: one session.memory row per change (hash-only), then memory_set when the render changed. */
  async #memoryChanged(s: LocalSession, changes: readonly MemoryChange[]): Promise<string | null> {
    if (!s.memory || !changes.length) return null;
    for (const row of memoryRowsOf(s.hsid, changes)) await this.#o.log('session.memory', row, { session: s.hsid });
    return this.#pushMemory(s);
  }

  /** Slice B2: the memory block rendered for the session's target, written when it differs from the last one sent. */
  #pushMemory(s: LocalSession, target = s.context.target): string | null {
    if (!s.memory) return null;
    const r = s.memory.render(target);
    if (r.hash === s.memorySent) return null;
    s.memorySent = r.hash;
    // Aegis L1 (a)/(b): every block carries an id the child echoes; the caller learns whether (and what) was written
    const id = `ms-${++s.memorySetSeq}`;
    this.#write(s, drv.memorySetLine(r, id));
    return id;
  }

  /** Aegis L1 (c): stop a session at once (state first, no await before the stop is under way). */
  #stopNow(s: LocalSession, why: string): void {
    s.state = 'stopping';
    s.tools?.cancelAll();
    void this.#o.children.stop(s.child, why).catch(() => undefined);
  }

  /**
   * Slice B2: a tool start/end of an attended session: the files it edited and the last failing tool. Aegis L7: paths
   * are keyed by toolCallId; a second start with an id already in flight poisons it (null), so a reused id never credits
   * the wrong file. Aegis H1: the recorded path is the KERNEL's form (fileRefOf), never the model's raw string.
   */
  async #memoryTool(s: LocalSession, ev: Extract<LocalEvent, { kind: 'tool' }>): Promise<void> {
    if (!s.memory || ev.tool === null || MEMORY_TOOL_NAMES.includes(ev.tool)) return;
    if (ev.phase === 'start') {
      if (ev.toolCallId === null || !EDIT_TOOLS.includes(ev.tool)) return;
      if (s.toolPaths.has(ev.toolCallId)) s.toolPaths.set(ev.toolCallId, null);
      else if (ev.path !== null && s.toolPaths.size < TOOL_PATHS_CAP) s.toolPaths.set(ev.toolCallId, ev.path);
      return;
    }
    const p = ev.toolCallId !== null ? s.toolPaths.get(ev.toolCallId) : undefined;
    if (ev.toolCallId !== null) s.toolPaths.delete(ev.toolCallId);
    if (ev.isError === false && typeof p === 'string') {
      const rel = this.#fileRefOf(s, p);
      if (rel !== null) await this.#memoryChanged(s, s.memory.addFileRef(rel));
    } else if (ev.isError === true) {
      // the error text is TOOL output: its entry is labelled tool:<server> and renders in the data section
      const brokered = s.tools?.offered.some((t) => t.name === ev.tool) ?? false;
      const head = (ev.errorHead ?? '').replace(/^<tool-data [^>]*>\n?/, '').slice(0, 200);
      await this.#memoryChanged(s, s.memory.setToolError(ev.tool, head, brokered ? `tool:${KERNEL_MCP_SERVER}` : 'tool:local'));
    }
  }

  /**
   * Aegis H1: the kernel's form of an edited path — resolved against the session cwd, realpath'd, required to exist under
   * one of the session roots, made relative to that root. Anything else records nothing.
   */
  #fileRefOf(s: LocalSession, raw: string): string | null {
    // Aegis R3: refuse network-style and device paths before ANY filesystem call (UNC, //host, /net/, \\?\, NUL)
    if (raw.includes('\0') || /^[\\/]{2}/.test(raw) || /^\/net(?:\/|$)/.test(raw) || (process.platform === 'win32' && /^[A-Za-z]:(?![\\/])/.test(raw))) return null;
    const roots = [s.roots.worktree, s.roots.cwd].filter((r): r is string => r !== undefined);
    // Aegis R5: `..` is outside only as a whole first segment (`..env.bak` is a file name)
    const inside = (root: string, p: string): string | null => {
      const rel = path.relative(root, p);
      return rel && rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel) ? rel : null;
    };
    // Aegis R3: the LEXICAL path must be inside a root before realpath is asked anything
    const lexical = path.resolve(s.cwd, raw);
    if (!roots.some((r) => inside(r, lexical) !== null)) return null;
    try {
      const real = fs.realpathSync.native(lexical);
      for (const root of roots) {
        const rel = inside(root, real);
        if (rel !== null && fs.statSync(real).isFile()) return rel;
      }
    } catch {
      /* gone, or not resolvable: nothing to record */
    }
    return null;
  }

  /** Slice B2: note/forget answered from the session's working memory (never the LocalToolBroker). */
  async #memoryRequest(s: LocalSession, ev: Extract<LocalEvent, { kind: 'tool-request' }>): Promise<void> {
    const r = ev.error !== null || ev.name === null ? { content: `refused: ${ev.error ?? 'no tool name'}`, isError: true, changes: [] } : answerMemoryTool(s.memory!, ev.name, ev.args);
    await this.#memoryChanged(s, r.changes);
    this.#write(s, drv.toolResponseLine({ id: ev.id!, content: r.content, isError: r.isError, provenance: 'kernel' }));
  }

  /**
   * Slice B2: a goal from the human's prompt (the render goes out before the prompt line, so the child has it at once).
   * Aegis L8: only a hand-typed or verified-voice turn is the trusted goal; unverified voice renders as data.
   */
  async #setGoal(s: LocalSession, g: { text: string; untrusted?: `tool:${string}` }): Promise<void> {
    if (s.memory) await this.#memoryChanged(s, s.memory.setGoal(g.text, g.untrusted ?? true));
  }

  /** Aegis L2: an hsid's session dir, or null (hsidShort takes only hsid:v1:, never v1d:). */
  #sessionDir(hsid: string): string | null {
    if (!HSID_V1_PATTERN.test(hsid)) return null;
    return path.join(this.#o.home, 'sessions', hsidShort(hsid));
  }

  /** Slice B2 / Aegis M2: an ended session's memory file and its meta-line owner, or null. */
  #endedMemory(hsid: string): string | null {
    const dir = this.#sessionDir(hsid);
    return dir ? path.join(dir, MEMORY_FILE) : null;
  }

  /**
   * Slice B2: the human-only local-session requests (dispatcher-only; see LOCAL_SESSION_REQUESTS). The asker must be the
   * human on a gui or device connection and the session's owner. Refusals are RefusedErrors (asRpcRefusal on the wire).
   */
  async humanRequest(asker: LocalSessionAsker, kind: string, payload: unknown): Promise<Record<string, unknown>> {
    if (asker.principalClass !== 'human' || (asker.credential !== 'gui' && asker.credential !== 'device') || !asker.principal) {
      throw refused('FORBIDDEN', `${kind.slice(0, 40)} is the human's, on a gui or device connection`, { reason: 'matrix' });
    }
    const keys = kind === LOCAL_SESSION_CONTEXT_REQUEST ? ['hsid', 'target'] : kind === LOCAL_SESSION_MEMORY_LIST_REQUEST ? [] : kind === LOCAL_SESSION_MEMORY_DELETE_REQUEST ? ['hsid', 'stop'] : ['hsid'];
    if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) throw refused('BAD_REQUEST', `${kind} takes {${keys.join(', ')}}`, { reason: 'bad-params' });
    const p = payload as Record<string, unknown>;
    const extra = Object.keys(p).filter((k) => !keys.includes(k));
    if (extra.length) throw refused('BAD_REQUEST', `${kind} takes {${keys.join(', ')}}`, { reason: 'bad-params' });
    if (kind === LOCAL_SESSION_MEMORY_LIST_REQUEST) return this.#listMemory(asker.principal);
    if (typeof p.hsid !== 'string' || !HSID_PATTERN.test(p.hsid)) throw refused('BAD_REQUEST', `${kind} takes {${keys.join(', ')}}`, { reason: 'bad-params' });
    const hsid = p.hsid;
    if (kind === LOCAL_SESSION_MEMORY_DELETE_REQUEST) {
      if (p.stop !== undefined && typeof p.stop !== 'boolean') throw refused('BAD_REQUEST', `${kind}: stop must be a boolean`, { reason: 'bad-params', field: 'stop' });
      return this.#deleteMemory(asker.principal, hsid, p.stop === true);
    }
    if (kind === LOCAL_SESSION_MEMORY_READ_REQUEST) return this.#readMemory(asker.principal, hsid);
    const s = this.#sessions.get(hsid);
    if (!s || s.owner !== asker.principal || s.state !== 'running') throw refused('NOT_FOUND', 'no such running local session for this principal', { reason: 'not-found' });
    if (s.loop) throw refused('FORBIDDEN', 'a loop session takes no context requests', { reason: 'loop-session' });
    if (kind === LOCAL_SESSION_COMPACT_REQUEST) {
      this.#write(s, drv.compactLine());
      return { hsid, when: s.turnPermits.length > 0 ? 'next-step' : 'next-run' };
    }
    if (kind !== LOCAL_SESSION_CONTEXT_REQUEST) throw refused('BAD_REQUEST', `unknown request ${kind.slice(0, 40)}`, { reason: 'bad-params' });
    if (typeof p.target !== 'number' || !Number.isSafeInteger(p.target) || p.target < 1) throw refused('BAD_REQUEST', `${kind}: target must be a positive integer`, { reason: 'bad-params', field: 'target' });
    const c = s.context;
    // the human may raise past the signed config up to n_ctx (founder Q4: notify-and-proceed, labelled); with n_ctx
    // unknown the config is the ceiling. Lowering is always free; the floor is the 0.85 rule for the reply budget.
    const ceiling = c.nCtx ?? Math.max(c.config, c.target);
    const floor = Math.max(MIN_CONTEXT_TARGET, Math.floor(c.maxTokens / TARGET_HEADROOM) + 1);
    if (floor > ceiling) throw refused('BAD_REQUEST', `${kind}: the reply budget leaves no room under n_ctx`, { reason: 'bad-params', field: 'target' });
    const target = Math.min(ceiling, Math.max(floor, p.target));
    const previous = c.target;
    const aboveConfig = target > c.config;
    const row = { hsid, target, previous, requested: p.target, configTarget: c.config, nCtx: c.nCtx, aboveConfig };
    await this.#o.log('session.context', row, { session: hsid });
    c.target = target;
    // a lower target shrinks the memory slot: the smaller block goes first (it fits both); a higher one after
    if (target < previous) this.#pushMemory(s, target);
    this.#write(s, drv.setContextLine(target));
    if (target >= previous) this.#pushMemory(s, target);
    return { hsid, target, previous, requested: p.target, clamped: target !== p.target, aboveConfig, configTarget: c.config, nCtx: c.nCtx, memorySlot: memorySlotTokens(target), ...(aboveConfig ? { notice: `the context target ${target} is above the signed config (${c.config}); it applies to this session only` } : {}) };
  }

  /**
   * Slice B2: the human deletes a session's working memory (live or ended); the owner is the one memory.jsonl names. A
   * live session must acknowledge the empty block (Aegis L1): a child that refuses it is stopped.
   */
  async #deleteMemory(principal: string, hsid: string, stop = false): Promise<Record<string, unknown>> {
    const s = this.#sessions.get(hsid);
    if (s?.memory) {
      if (s.owner !== principal) throw refused('NOT_FOUND', 'no such session memory for this principal', { reason: 'not-found' });
      s.pendingGoals = [];
      // Aegis L1 (b): an ack is owed only when an empty block was actually written (its id)
      const written = await this.#memoryChanged(s, s.memory.deleteAll());
      s.memoryDeletePending = written ?? undefined;
      // Aegis L1 (d): `stop: true` ends the session too (its history is the other copy of the text)
      if (stop && s.state === 'running') this.#stopNow(s, 'memory-delete-stop');
      return { hsid, deleted: true, live: true, stopped: stop, ...(stop ? {} : { notice: 'working memory is deleted; the session\'s own history still holds what it saw until a compaction or the session ends (send stop:true to end it now)' }) };
    }
    const file = this.#endedMemory(hsid);
    const meta = file ? memoryOwnerOf(file) : null;
    if (!file || !meta || meta.hsid !== hsid || meta.owner !== principal) throw refused('NOT_FOUND', 'no such session memory for this principal', { reason: 'not-found' });
    fs.rmSync(file, { force: true });
    await this.#o.log('session.memory', { hsid, op: 'delete', bytes: 0 }, { session: hsid });
    return { hsid, deleted: true, live: false };
  }

  /** Aegis M2: request.session.memory.read — the current entries of a session the asker owns (live or ended). */
  async #readMemory(principal: string, hsid: string): Promise<Record<string, unknown>> {
    const s = this.#sessions.get(hsid);
    if (s?.memory) {
      if (s.owner !== principal) throw refused('NOT_FOUND', 'no such session memory for this principal', { reason: 'not-found' });
      return { hsid, live: true, entries: s.memory.entries() };
    }
    const file = this.#endedMemory(hsid);
    const meta = file ? memoryOwnerOf(file) : null;
    if (!file || !meta || meta.hsid !== hsid || meta.owner !== principal) throw refused('NOT_FOUND', 'no such session memory for this principal', { reason: 'not-found' });
    return { hsid, live: false, entries: new WorkingMemory({ file, hsid, owner: principal }).entries() };
  }

  /** Aegis M2: request.session.memory.list — the asker's sessions that hold working memory (meta-line owner), at most 256. */
  async #listMemory(principal: string): Promise<Record<string, unknown>> {
    const root = path.join(this.#o.home, 'sessions');
    const out: Array<{ hsid: string; live: boolean }> = [];
    let names: string[] = [];
    try {
      names = fs.readdirSync(root);
    } catch {
      /* no sessions yet */
    }
    for (const n of names.sort()) {
      if (out.length >= 256) break;
      const meta = memoryOwnerOf(path.join(root, n, MEMORY_FILE));
      if (meta && meta.owner === principal && HSID_V1_PATTERN.test(meta.hsid) && hsidShort(meta.hsid) === n) out.push({ hsid: meta.hsid, live: this.#sessions.get(meta.hsid)?.state === 'running' });
    }
    return { sessions: out };
  }

  /** Slice C1: one tool_request, answered outside the stdout queue (a card may wait on a human). */
  async #brokered(s: LocalSession, ev: Extract<LocalEvent, { kind: 'tool-request' }>, receivedAt: number): Promise<void> {
    if (ev.id === null) return; // no usable id: nothing to answer (the child's own timeout ends the call)
    // slice B2: the memory tools of an attended session are the kernel's own store (a loop session has none: they
    // fall through to the broker, which refuses them)
    if (s.memory && ev.name !== null && MEMORY_TOOL_NAMES.includes(ev.name)) return this.#memoryRequest(s, ev);
    if (!s.tools) {
      // Aegis L7: never unanswered, never unlogged (the broker is built before stdout is read; this is the backstop)
      await this.#o.log('tool.brokered', { hsid: s.hsid, server: KERNEL_MCP_SERVER, argsHash: inputHash(ev.args ?? null), decision: 'not-running', bytes: 0, isError: true }, { session: s.hsid }).catch(() => undefined);
      this.#write(s, drv.toolResponseLine({ id: ev.id, content: 'The session is not ready for brokered tools.', isError: true, provenance: 'kernel' }));
      return;
    }
    const r = await s.tools.handle({ id: ev.id, toolCallId: ev.toolCallId, name: ev.name, args: ev.args, error: ev.error, receivedAt });
    this.#write(s, drv.toolResponseLine(r));
  }

  async #onExit(s: LocalSession): Promise<void> {
    if (s.state === 'exited') return;
    s.state = 'exited';
    // slice C1: calls in flight are cancelled (their cards expire, no target runs) and the session's verb cards expire
    s.tools?.cancelAll();
    if (s.tools?.offered.length) await this.#o.gitVerbs?.closeSession?.(s.hsid).catch(() => undefined);
    // slice C2': every MCP server this session spawned is reaped, and its neutral cwd removed
    await s.mcp?.pool.closeAll().catch(() => undefined);
    if (s.mcpLaunch) {
      try {
        fs.chmodSync(s.mcpLaunch.cwd, 0o700);
        fs.rmSync(s.mcpLaunch.cwd, { recursive: true, force: true });
      } catch {
        /* already gone */
      }
      // TD-2026-10-27-833: the staged Paradigm server's per-session global dir goes with the session
      if (s.mcpLaunch.firstParty) fs.rmSync(s.mcpLaunch.firstParty.stateDir, { recursive: true, force: true });
    }
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
    if (s.loop?.pending) s.loop.pending({ text: null, tokens: s.loop.tokens, stopReason: null, error: s.loop.fatal ?? 'the loop session exited' });
    this.#sessions.delete(s.hsid);
    this.#history.push({ hsid: s.hsid, principalId: s.principalId, backend: 'local', model: s.model, state: 'exited', turns: s.turns, code: s.child.exitCode, signal: s.child.signalCode, ...(s.loop ? { origin: LOOP_ORIGIN } : {}) });
    while (this.#history.length > HISTORY_CAP) this.#history.shift();
  }

  async #onLine(s: LocalSession, line: string, receivedAt: number = Date.now()): Promise<void> {
    let ev: LocalEvent;
    try {
      ev = drv.parse(line);
    } catch {
      // Aegis L2: a line the parser cannot take is still one hash-only row
      await this.#o.log('turn.event', { hsid: s.hsid, type: 'malformed', seq: ++s.seq, backend: 'local', lineHash: sha(line), bytes: Buffer.byteLength(line) }, { session: s.hsid });
      return;
    }
    const bytes = Buffer.byteLength(line);
    // S2: every driver event is a turn.event before anything acts on it
    // a loop session's model text is DATA the runner stores secret-scanned on its loop.node row: the turn.event
    // row of a message line carries its hash and size only (never unscanned model text in the log)
    // step 10: an act session's tool lines carry model-written paths and file content: hashed the same way
    // slice C1: a tool_request line carries model-written args: hashed for every session (tool.brokered is hash-only too)
    // Aegis L3: so are the tool_execution_* lines of a brokered tool (they echo its args and the kernel's result)
    // slice B2: so are the memory tools' (note carries model-written text; session.memory rows are hash-only)
    const brokeredTool = ev.kind === 'tool' && ev.tool !== null && ((s.tools?.offered.some((t) => t.name === ev.tool) ?? false) || (s.memory !== undefined && MEMORY_TOOL_NAMES.includes(ev.tool)));
    const hashOnly = bytes > EVENT_LINE_CAP || ev.kind === 'tool-request' || brokeredTool || (s.loop !== undefined && (ev.kind === 'message' || ev.kind === 'partial' || ev.kind === 'tool' || ev.type.startsWith('message') || ev.type.startsWith('tool')));
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
        s.replyBytes = ev.textBytes;
        // a message without usage is recorded as such (never silently zero)
        if (ev.tokens === null) await this.#o.log('turn.usage', { hsid: s.hsid, usage: null, backend: 'local' }, { session: s.hsid });
        else await usage('turn.usage', s.meter.charge(ev));
        return;
      case 'end': {
        // review M2: turn.result{turn} names the turn it closes (the oldest in flight; the local lane never folds turns)
        const closing = s.turnPermits.length > 0 ? s.turns - s.turnPermits.length + 1 : 0;
        // T-2026-10-26-003: usage.tokens stays the meter's remainder (charged once); runUsage is the run's whole
        // agent_end usage (input + output, the summariser included) and replyBytes the final reply's size (0 = no
        // answer), so the GUI can say how the turn really ended; maxSteps the session's step cap (TD-2026-10-27-833)
        const runUsage = { tokens: ev.tokens, input: ev.input, output: ev.output };
        const replyBytes = s.replyBytes ?? 0;
        s.replyBytes = null;
        await usage('turn.result', s.meter.charge(ev), { stopReason: ev.stopReason, isError: ev.stopReason === 'error', runUsage, replyBytes, maxSteps: s.maxSteps, ...(ev.error ? { error: ev.error } : {}), ...(closing > 0 ? { turn: turnId(s.hsid, closing) } : {}) });
        const head = s.turnPermits.shift();
        s.lastTurnEndAt = Date.now();
        if (head) await this.#o.fuse.release(head, s.owner).catch(() => undefined);
        // slice B2: the follow_up queued behind this run starts now: its text is the goal
        const nextGoal = s.pendingGoals.shift();
        if (nextGoal !== undefined) await this.#setGoal(s, nextGoal);
        if (s.loop?.pending) s.loop.pending({ text: s.loop.reply, tokens: s.loop.tokens, stopReason: ev.stopReason, error: ev.error ?? (ev.stopReason === 'error' ? 'the model call failed' : null), ...(s.loop.act ? { protectedHits: [...s.loop.act.hits] } : {}) });
        return;
      }
      case 'tool':
        // slice B2: edited files and the last failing tool (attended sessions)
        await this.#memoryTool(s, ev);
        return;
      case 'tool-request':
        // slice C1: answered OUTSIDE this queue — a mutate call's card may wait minutes on a human
        void this.#brokered(s, ev, receivedAt).catch(() => undefined);
        return;
      case 'tool-cancel':
        // Aegis M1/N4: already honoured in the stdout handler, ahead of the queue (cancel is idempotent)
        if (ev.id !== null) s.tools?.cancel(ev.id);
        return;
      case 'response':
        // round 2 (steer race): the child refuses a steer that reaches it idle (it never queues it into the next
        // turn); the kernel records the refusal against the session — a steer that did not land
        if (ev.command === 'steer' && ev.success === false) await this.#o.log('turn.steer', { hsid: s.hsid, phase: 'refused', by: 'child', error: ev.error }, { session: s.hsid });
        // Aegis L1: the child refused a memory block or a target: the next change re-sends (memorySent cleared), one row
        if ((ev.command === 'memory_set' || ev.command === 'set_context') && ev.success === false) {
          s.memorySent = undefined;
          // a delete the child did not take is not a delete: the session stops BEFORE anything is awaited (Aegis L1 c);
          // only the reply to the delete's own block counts (Aegis L1 a)
          if (ev.command === 'memory_set' && s.memoryDeletePending !== undefined && ev.id === s.memoryDeletePending) {
            s.memoryDeletePending = undefined;
            this.#stopNow(s, 'memory-delete-refused');
          }
          await this.#o.log('session.memory', { hsid: s.hsid, op: 'refused', bytes: 0, why: 'child-refused' }, { session: s.hsid });
        }
        if (ev.command === 'memory_set' && ev.success === true && ev.id !== null && ev.id === s.memoryDeletePending) s.memoryDeletePending = undefined;
        return;
      default:
        return; // other tool/turn markers, context reports (slice B1), fatal, unknown and malformed lines: logged above, never acted on
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

  async send(principal: string, p: { hsid: string; text: string; permitId?: string; steer?: boolean; source?: 'voice'; voice?: VoiceTurnLink; voiceAttribution?: VoiceAttribution; origin?: 'kernel'; voiceOrigin?: { sentBy: VoiceSentBy } }): Promise<{ turn: string; steered?: boolean }> {
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
      s.child.stdin?.write(drv.steerLine(p.text));
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
    // Aegis R1: a kernel-composed turn (a Desk offer's open text) is logged origin 'kernel', as the Claude lane does
    await this.#o.log('session.inject', { hsid: s.hsid, origin: p.origin === 'kernel' ? 'kernel' : 'client', hash: contentHash, bytes: Buffer.byteLength(p.text, 'utf8'), ...voiceTag(p) }, { session: s.hsid });
    await this.#o.log('turn.sent', { hsid: s.hsid, turn: turnId(s.hsid, n), permitId: permit.permitId, contentHash, backend: 'local', ...voiceTag(p), origin: p.voiceOrigin?.sentBy === 'unverified' ? 'voice-unverified' : p.voiceOrigin ? 'voice' : 'hand', ...(p.voiceOrigin ? { sentBy: p.voiceOrigin.sentBy } : {}) }, { session: s.hsid });
    // slice B2: the prompt is the goal (memory_set goes out BEFORE the prompt line); a follow_up's when its run starts
    // Aegis L8: a hand-typed turn or a verified voice send is the trusted goal; unverified voice is data
    // Aegis R1: a kernel-composed turn (a mod offer's title) is DATA (tool:offer), never the trusted goal
    const untrusted: `tool:${string}` | undefined = p.origin === 'kernel' ? 'tool:offer' : p.voiceOrigin?.sentBy === 'unverified' || (p.source === 'voice' && p.voiceOrigin === undefined) ? 'tool:voice' : undefined;
    const goal = { text: p.text, ...(untrusted ? { untrusted } : {}) };
    if (!inFlight) await this.#setGoal(s, goal);
    else if (s.memory && s.pendingGoals.length < PENDING_GOALS_CAP) s.pendingGoals.push(goal);
    s.child.stdin?.write(drv.turnLine({ text: p.text, inFlight }));
    return { turn: turnId(s.hsid, n) };
  }

  async stop(principal: string, p: { hsid: string; interrupt?: boolean }): Promise<{ signals: string[]; exited: boolean }> {
    const s = this.#get(principal, p.hsid);
    if (p.interrupt) {
      if (s.state === 'running') s.child.stdin?.write(drv.interruptLine());
      // slice C1 (G-LCL-15): the child cancels its brokered calls on abort; the kernel cancels its side too
      s.tools?.cancelAll();
      return { signals: ['rpc:abort'], exited: false };
    }
    if (s.state === 'exited') return { signals: [], exited: true };
    s.state = 'stopping';
    s.tools?.cancelAll();
    try {
      s.child.stdin?.write(drv.interruptLine());
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

/** The loopback port of a base URL (moved to kernel/local/endpoint.ts, shared with #local-config-request). */
export { loopbackPort };

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
